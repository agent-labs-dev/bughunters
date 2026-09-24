import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { AgentReader } from './agents.js';
import { writeAgentFixture } from './fixtures/agent-workspace.js';
import { startDashboard, watchProject, type Dashboard } from './server.js';

let root: string;
let dashboard: Dashboard | undefined;

beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'autoqa-agents-')); });
afterEach(async () => {
  await dashboard?.close();
  dashboard = undefined;
  rmSync(root, { recursive: true, force: true });
});

describe('AgentReader', () => {
  it('tolerates missing and corrupt state and fills all three roles', () => {
    const reader = new AgentReader(root);
    expect(reader.issues()).toEqual([]);
    expect(reader.sessions()).toEqual([]);
    expect(reader.appmap().screens).toEqual([]);
    expect((reader.overview() as { agents: { state: string }[] }).agents.map((agent) => agent.state))
      .toEqual(['off', 'off', 'off']);
    mkdirSync(join(root, '.autoqa', 'issues'), { recursive: true });
    writeFileSync(join(root, '.autoqa', 'agents.json'), '{');
    writeFileSync(join(root, '.autoqa', 'issues', 'broken.json'), '{');
    expect(reader.issues()).toEqual([]);
    expect(reader.agents()).toBeUndefined();
  });

  it('skips a torn last event line and sorts attention by severity then recency', () => {
    writeAgentFixture(root);
    const file = join(root, '.autoqa', 'sessions', 'ses_live', 'events.jsonl');
    appendFileSync(file, '{"at":');
    const reader = new AgentReader(root);
    expect(reader.session('ses_live')?.events).toHaveLength(25);
    expect(reader.session('../escape')).toBeUndefined();
    const overview = reader.overview() as {
      attention: { id: string; fix?: { status: string } }[];
      agents: unknown[];
      counts: { issuesOpen: number };
      live: { events: { kind: string }[]; screenshot: string };
    };
    expect(overview.attention.map((issue) => issue.id)).toEqual(['iss-billing', 'iss-settings', 'iss-profile']);
    expect(overview.attention.find((issue) => issue.id === 'iss-settings')?.fix?.status).toBe('proposed');
    expect(overview.agents).toHaveLength(3);
    expect(overview.counts.issuesOpen).toBe(3);
    expect(overview.live.events.length).toBeGreaterThan(0);
    expect(overview.live.events.length).toBeLessThanOrEqual(12);
    expect(overview.live.events.every((event) => event.kind !== 'thought' && event.kind !== 'tool-call')).toBe(true);
    expect(overview.live.screenshot).toContain('.autoqa/sessions/ses_live/');
  });

  it('joins an issue to its proposal and candidates', () => {
    writeAgentFixture(root);
    const detail = new AgentReader(root).issue('iss-billing');
    expect(detail?.candidates.map((candidate) => candidate.id)).toEqual(['cand-ses_live-0']);
    expect(new AgentReader(root).issue('iss-settings')?.fix?.diff).toContain('+new padding');
    const billing = new AgentReader(root).screens().screens.find((screen) => screen.id === 'billing');
    expect(billing?.openIssues).toBe(1);
  });
});

const canBind = await new Promise<boolean>((done) => {
  const server = createServer();
  server.once('error', () => done(false));
  server.listen(0, '127.0.0.1', () => server.close(() => done(true)));
});

describe.skipIf(!canBind)('agent API', () => {
  it('serves overview, detail and routine summaries', async () => {
    writeAgentFixture(root);
    dashboard = await startDashboard({ root, port: 0 });
    const overview = await (await fetch(`${dashboard.url}/api/overview`)).json();
    expect(overview.project.platform).toBe('electron');
    expect(overview.attention[0].severity).toBe('critical');
    expect(overview.recentSessions).toHaveLength(2);
    const issue = await (await fetch(`${dashboard.url}/api/issues/iss-settings`)).json();
    expect(issue.fix.status).toBe('proposed');
    const routines = await (await fetch(`${dashboard.url}/api/routines`)).json();
    expect(routines).toHaveLength(2);
    expect(routines[0].steps).toBe(1);
  });


});


describe('watchProject', () => {
  it('picks up .autoqa created after start', async () => {
    let changes = 0;
    const watcher = watchProject(root, () => { changes += 1; });
    expect(watcher).toBeDefined();
    try {
      mkdirSync(join(root, '.autoqa'));
      await new Promise((done) => setTimeout(done, 700));
      expect(changes).toBeGreaterThan(0);
    } finally {
      watcher?.close();
    }
  });
});

describe('stale status', () => {
  it('shows work from a dead process as stopped', () => {
    const root = mkdtempSync(join(tmpdir(), 'autoqa-stale-'));
    try {
      // A pid far above any real one: the process cannot exist.
      const dead = 2 ** 22 + 12345;
      mkdirSync(join(root, '.autoqa', 'sessions', 'ses_1'), { recursive: true });
      writeFileSync(join(root, '.autoqa', 'agents.json'), JSON.stringify({
        version: 1,
        patrol: { cycle: 1, state: 'running', startedAt: '2026-01-01T00:00:00.000Z', pid: dead },
        agents: [{ role: 'fixer', state: 'working', activity: 'Fixing 9 issues', runtime: 'cli:claude',
          updatedAt: '2026-01-01T00:00:00.000Z', spentUsd: 0, pid: dead }],
      }));
      writeFileSync(join(root, '.autoqa', 'sessions', 'ses_1', 'session.json'), JSON.stringify({
        version: 1, id: 'ses_1', role: 'fixer', pid: dead, startedAt: '2026-01-01T00:00:00.000Z',
        status: 'running', steps: 0, costUsd: 0, screensFound: [], candidates: 0, issues: [],
      }));
      const reader = new AgentReader(root);
      expect(reader.agents()?.patrol?.state).toBe('stopped');
      expect(reader.agents()?.agents[0]).toMatchObject({ state: 'idle', activity: 'Stopped: its process ended.' });
      expect(reader.sessions()[0]?.status).toBe('failed');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
