import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { AgentReader } from './agents.js';
import { layoutGraph } from './ui/graph-layout.js';
import { writeAgentFixture } from './fixtures/agent-workspace.js';
import { startDashboard, watchProject, type Dashboard } from './server.js';

let root: string;
let dashboard: Dashboard | undefined;

beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'bughunters-agents-')); });
afterEach(async () => {
  await dashboard?.close();
  dashboard = undefined;
  rmSync(root, { recursive: true, force: true });
});

describe('AgentReader', () => {
  it('prefers transitions and replay prerequisites over visit-order links', () => {
    writeAgentFixture(root);
    const file = join(root, '.bughunters', 'appmap.json');
    const map = JSON.parse(readFileSync(file, 'utf8'));
    map.screens[0].transitions = [
      { to: 'settings', kind: 'tap', via: 'Settings', count: 3, steps: 1 },
      { to: 'home', kind: 'back', count: 1, steps: 1 },
      { to: 'missing', kind: 'open', count: 1, steps: 1 },
    ];
    map.screens[4].links = ['home'];
    for (const screen of map.screens.slice(0, 4)) screen.routineId = `screen-${screen.id}`;
    writeFileSync(file, JSON.stringify(map));
    const routine = { version: 1, id: 'enter-app', description: 'Enter', platform: 'electron',
      screenId: null, steps: [], createdAt: '', updatedAt: '' };
    mkdirSync(join(root, '.bughunters', 'routines'), { recursive: true });
    writeFileSync(join(root, '.bughunters', 'routines', 'enter-app.json'), JSON.stringify(routine));
    for (const [id, screenId, requires] of [
      ['screen-settings', 'settings', ['screen-home']],
      ['screen-billing', 'billing', ['enter-app']],
      ['screen-projects', 'projects', ['missing']],
    ] as const) writeFileSync(join(root, '.bughunters', 'routines', `${id}.json`),
      JSON.stringify({ ...routine, id, screenId, requires }));
    const result = new AgentReader(root).screens();
    expect(result.entryId).toBe('__start');
    expect(result.screens.find((screen) => screen.id === '__start'))
      .toMatchObject({ name: 'App start', virtual: true });
    expect(result.edges.filter((edge) => edge.from === 'home'))
      .toEqual([{ from: 'home', to: 'settings', kind: 'tap', via: 'Settings', count: 3, steps: 1 },
        { from: 'home', to: 'settings', kind: 'route', via: 'route', count: 1, steps: 0 }]);
    expect(result.edges).toContainEqual({ from: '__start', to: 'billing', kind: 'route',
      via: 'route', count: 1, steps: 0 });
    expect(result.edges).toContainEqual({ from: '__start', to: 'projects', kind: 'route',
      via: 'route', count: 1, steps: 0 });
    expect(result.edges).toContainEqual({ from: 'profile', to: 'home', kind: 'other',
      via: undefined, count: 1, steps: 0 });
    expect(result.edges.some((edge) => edge.from === 'projects')).toBe(false);
  });

  it('connects screens through routineId when routines have no screenId', () => {
    const dir = join(root, '.bughunters');
    mkdirSync(join(dir, 'routines'), { recursive: true });
    const ids = ['signin', 'home', 'settings', 'browse'];
    writeFileSync(join(dir, 'appmap.json'), JSON.stringify({ version: 1, platform: 'web', updatedAt: '',
      screens: ids.map((id) => ({ id, name: id, routineId: `screen-${id}`, links: [],
        lastSeenAt: '2026-01-01', firstSeenAt: '2026-01-01' })) }));
    for (const [id, requires] of [
      ['enter-app', []], ['screen-signin', []], ['screen-home', ['enter-app']],
      ['screen-settings', ['screen-home']], ['screen-browse', ['enter-app']],
    ] as const) writeFileSync(join(dir, 'routines', `${id}.json`),
      JSON.stringify({ id, requires, screenId: null, steps: [] }));
    const result = new AgentReader(root).screens();
    expect(result.edges.filter((edge) => edge.from === '__start').map((edge) => edge.to).sort())
      .toEqual(['browse', 'home', 'signin']);
    expect(result.edges).toContainEqual({ from: 'home', to: 'settings', kind: 'route',
      via: 'route', count: 1, steps: 0 });
    const reached = new Set(['__start']);
    for (let pass = 0; pass < result.screens.length; pass++) for (const edge of result.edges) {
      if (reached.has(edge.from)) reached.add(edge.to);
    }
    expect(reached.size).toBe(result.screens.length);
    expect(layoutGraph(result.screens, result.edges, result.entryId).unlinkedY).toBeNull();
  });

  it('tolerates missing and corrupt state and fills all three roles', () => {
    const reader = new AgentReader(root);
    expect(reader.issues()).toEqual([]);
    expect(reader.sessions()).toEqual([]);
    expect(reader.appmap().screens).toEqual([]);
    expect((reader.overview() as { agents: { state: string }[] }).agents.map((agent) => agent.state))
      .toEqual(['off', 'off', 'off']);
    mkdirSync(join(root, '.bughunters', 'issues'), { recursive: true });
    writeFileSync(join(root, '.bughunters', 'agents.json'), '{');
    writeFileSync(join(root, '.bughunters', 'issues', 'broken.json'), '{');
    expect(reader.issues()).toEqual([]);
    expect(reader.agents()).toBeUndefined();
  });

  it('skips a torn last event line and sorts attention by severity then recency', () => {
    writeAgentFixture(root);
    const file = join(root, '.bughunters', 'sessions', 'ses_live', 'events.jsonl');
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
    expect(overview.live.screenshot).toContain('.bughunters/sessions/ses_live/');
  });

  it('joins an issue to its proposal and candidates', () => {
    writeAgentFixture(root);
    const detail = new AgentReader(root).issue('iss-billing');
    expect(detail?.candidates.map((candidate) => candidate.id)).toEqual(['cand-ses_live-0']);
    expect(new AgentReader(root).issue('iss-settings')?.fix?.diff).toContain('+new padding');
    const billing = new AgentReader(root).screens().screens.find((screen) => screen.id === 'billing');
    expect(billing?.openIssues).toBe(1);
  });

  it('passes GitHub state into issue rows and the overview', () => {
    writeAgentFixture(root);
    const reader = new AgentReader(root);
    const issue = reader.issues().find((item) => item.id === 'iss-settings')!;
    const fix = reader.issue(issue.id)!.fix!;
    writeFileSync(join(root, '.bughunters', 'issues', `${issue.id}.json`), JSON.stringify({ ...issue,
      github: { number: 8, url: 'https://github.com/o/r/issues/8', at: 'now', state: 'open' } }));
    writeFileSync(join(root, '.bughunters', 'fixes', `${fix.id}.json`), JSON.stringify({ ...fix,
      pr: { number: 7, url: 'https://github.com/o/r/pull/7', draft: false, state: 'merged' } }));
    expect(reader.issues().find((item) => item.id === issue.id)).toMatchObject({
      github: { state: 'open' }, pr: { state: 'merged' },
    });
    expect((reader.overview() as { github: string }).github).toContain('1 merged');
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
  it('picks up .bughunters created after start', async () => {
    let changes = 0;
    const watcher = watchProject(root, () => { changes += 1; });
    expect(watcher).toBeDefined();
    try {
      mkdirSync(join(root, '.bughunters'));
      await new Promise((done) => setTimeout(done, 700));
      expect(changes).toBeGreaterThan(0);
    } finally {
      watcher?.close();
    }
  });
});

describe('stale status', () => {
  it('shows work from a dead process as stopped', () => {
    const root = mkdtempSync(join(tmpdir(), 'bughunters-stale-'));
    try {
      // A pid far above any real one: the process cannot exist.
      const dead = 2 ** 22 + 12345;
      mkdirSync(join(root, '.bughunters', 'sessions', 'ses_1'), { recursive: true });
      writeFileSync(join(root, '.bughunters', 'agents.json'), JSON.stringify({
        version: 1,
        patrol: { cycle: 1, state: 'running', startedAt: '2026-01-01T00:00:00.000Z', pid: dead },
        agents: [{ role: 'fixer', state: 'working', activity: 'Fixing 9 issues', runtime: 'cli:claude',
          updatedAt: '2026-01-01T00:00:00.000Z', spentUsd: 0, pid: dead }],
      }));
      writeFileSync(join(root, '.bughunters', 'sessions', 'ses_1', 'session.json'), JSON.stringify({
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
