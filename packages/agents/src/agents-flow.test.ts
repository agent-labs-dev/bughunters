import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseConfig, paths } from '@autoqa/core';
import { AgentSession } from './session.js';
import { Vars } from './vars.js';
import { Workspace } from './workspace.js';
import { FakeDriver, type FakeScreen } from './testing/fake-driver.js';
import { explorerTools } from './tools/explorer.js';
import { judgeTools, pendingCandidates } from './tools/judge.js';
import { replayRoutine } from './replay.js';

const element = (ref: string, name: string) => ({ ref, role: 'button', name,
  box: { x: 10, y: 10, width: 40, height: 40 }, interactive: true, enabled: true });
const config = parseConfig({ version: 1, app: { connect: { url: 'fake://home' } },
  decisions: { decider: 'heuristic' } });
const run = async (tools: ReturnType<typeof explorerTools> | ReturnType<typeof judgeTools>,
  name: string, input: Record<string, unknown> = {}) => {
  const tool = tools.find((item) => item.name === name);
  if (!tool) throw new Error(`Missing ${name}`);
  return tool.run(input);
};

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'autoqa-flow-'));
  const screens: Record<string, FakeScreen> = {
    home: { elements: [element('e1', 'Settings')], next: { e1: 'settings' }, color: 20 },
    settings: { elements: [element('e2', 'Save')], color: 70 },
  };
  const driver = new FakeDriver(screens);
  const workspace = new Workspace(root);
  const record = await workspace.startSession('explorer');
  const vars = new Vars();
  vars.set('SECRET', 'super-secret-value');
  const session = new AgentSession(root, config, vars, record.id, 'explorer', driver);
  return { root, screens, driver, workspace, session };
}

describe('explorer, replay, and judge', () => {
  it('returns image observations, keeps secrets as placeholders, and records screens and candidates', async () => {
    const f = await fixture();
    try {
      const tools = explorerTools(f.session);
      const looked = await run(tools, 'look');
      expect(looked.content.map((part) => part.type)).toEqual(['image', 'text']);
      expect(JSON.stringify(looked.content.filter((part) => part.type === 'text'))).toContain('[e1] button');
      await run(tools, 'type', { text: '{{SECRET}}' });
      expect(f.driver.actions[0]).toMatchObject({ kind: 'type', value: 'super-secret-value' });
      await run(tools, 'save_routine', { id: 'enter-app', description: 'Enter app' });
      const first = await run(tools, 'record_screen', { id: 'Home', name: 'Home', description: 'Launcher' });
      expect(JSON.stringify(first)).toContain('no automatic findings');
      await run(tools, 'wait', { seconds: 0 });
      await run(tools, 'tap', { ref: 'e1' });
      await run(tools, 'record_screen', { id: 'Settings', name: 'Settings', description: 'Settings pane' });
      const map = await f.workspace.readAppMap();
      expect(map?.screens.find((item) => item.id === 'home')?.links).toContain('settings');
      expect((await f.workspace.readRoutine('screen-settings'))?.requires).toEqual(['screen-home']);
      expect((await f.workspace.readRoutine('screen-settings'))?.steps.map((step) => step.kind)).toEqual(['tap']);
      f.screens.settings!.color = 230;
      await run(tools, 'record_screen', { id: 'settings', name: 'Settings', description: 'Settings pane' });
      const candidates = await f.workspace.readCandidates(f.session.sessionId);
      expect(candidates.some((item) => item.source === 'pixel-diff')).toBe(true);
      expect(candidates.find((item) => item.source === 'pixel-diff')?.evidence.steps).toEqual([]);
      await run(tools, 'report_bug', { title: 'Save does nothing', what_is_wrong: 'No confirmation',
        expected: 'A confirmation', severity: 'major' });
      const reported = (await f.workspace.readCandidates(f.session.sessionId))
        .find((item) => item.source === 'explorer');
      expect(reported?.evidence.routineId).toBe('screen-settings');
      expect(reported?.evidence.steps).toEqual([]);
      await new Promise((done) => setTimeout(done, 20));
      const events = await readFile(join(paths.session(f.root, f.session.sessionId), 'events.jsonl'), 'utf8');
      const routines = await readFile(paths.routine(f.root, 'enter-app'), 'utf8');
      expect(events + routines).not.toContain('super-secret-value');
      expect(routines).toContain('{{SECRET}}');
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  });

  it('replays dependencies once, breaks cycles, and records failures', async () => {
    const f = await fixture();
    try {
      const now = new Date().toISOString();
      const base = { version: 1 as const, platform: 'web' as const, description: 'path',
        createdAt: now, updatedAt: now };
      await f.workspace.saveRoutine({ ...base, id: 'a', requires: ['b'],
        steps: [{ kind: 'press', key: 'A' }] });
      await f.workspace.saveRoutine({ ...base, id: 'b', requires: ['a'],
        steps: [{ kind: 'press', key: 'B' }] });
      expect((await replayRoutine(f.session, 'a')).ok).toBe(true);
      expect(f.driver.actions.map((item) => item.kind)).toEqual(['press', 'press']);
      expect((f.driver.actions[0] as { key: string }).key).toBe('B');
      f.session.completedRoutines.clear();
      f.driver.failAt = 3;
      const failed = await replayRoutine(f.session, 'a');
      expect(failed).toMatchObject({ ok: false, error: 'Required routine b: fake action failed' });
      expect((await f.workspace.readRoutine('b'))?.lastReplay?.ok).toBe(false);
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  });

  it('files and merges issues, dismisses changes with baseline updates, and hides decisions', async () => {
    const f = await fixture();
    try {
      const tools = explorerTools(f.session);
      await run(tools, 'record_screen', { id: 'home', name: 'Home', description: 'Launcher' });
      await run(tools, 'report_bug', { title: 'Save does nothing', what_is_wrong: 'No confirmation',
        expected: 'A confirmation', severity: 'major' });
      const first = (await pendingCandidates(f.session, [f.session.sessionId]))[0]!;
      const judge = judgeTools(f.session, [f.session.sessionId], 'fake-judge');
      expect((await run(judge, 'file_issue', {
        candidate_ids: [first.id], title: first.summary, body: 'What happened: nothing', severity: 'major',
      })).isError).toBe(true);
      const longTitle = 'The save control does not work when someone tries to update their settings in the desktop app';
      await run(judge, 'file_issue', { candidate_ids: [first.id], title: longTitle,
        body: 'What happened: nothing', severity: 'major', reason: 'The save control has no effect.' });
      const filed = (await f.workspace.listIssues())[0]!;
      expect(filed.title.length).toBeLessThanOrEqual(80);
      expect(filed.title.endsWith('…')).toBe(true);
      expect(await pendingCandidates(f.session, [f.session.sessionId])).toEqual([]);
      await run(tools, 'report_bug', { title: 'Save does nothing', what_is_wrong: 'No confirmation',
        expected: 'A confirmation', severity: 'major' });
      const second = (await pendingCandidates(f.session, [f.session.sessionId]))[0]!;
      await run(judge, 'file_issue', { candidate_ids: [second.id], title: second.summary,
        body: 'What happened: nothing', severity: 'major', reason: 'The save control has no effect.' });
      expect((await f.workspace.listIssues())[0]?.occurrences).toBe(2);
      expect((await f.workspace.listIssues())[0]?.judgement.reason).toBe('The save control has no effect.');
      f.screens.home!.color = 240;
      await run(tools, 'record_screen', { id: 'home', name: 'Home', description: 'Launcher' });
      const visual = (await pendingCandidates(f.session, [f.session.sessionId]))
        .find((item) => item.source === 'pixel-diff')!;
      const before = await readFile(paths.agentBaseline(f.root, 'home'));
      await run(judge, 'dismiss', { candidate_ids: [visual.id], reason: 'Accepted design', update_baseline: true });
      expect((await readFile(paths.agentBaseline(f.root, 'home'))).equals(before)).toBe(false);
      const stillPending = await pendingCandidates(f.session, [f.session.sessionId]);
      expect(stillPending.some((item) => item.id === visual.id)).toBe(false);
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  });

  it('compacts routines and keeps only steps after the current anchor as evidence', async () => {
    const f = await fixture();
    try {
      const tools = explorerTools(f.session);
      await run(tools, 'look');
      await run(tools, 'press', { key: 'Enter' });
      await run(tools, 'save_routine', { id: 'enter-app', description: 'Entry' });
      await run(tools, 'wait', { seconds: 0 });
      await run(tools, 'press', { key: 'Home' });
      await run(tools, 'press', { key: 'Home' });
      await run(tools, 'tap', { ref: 'e1' });
      f.session.trail.push({
        kind: 'tap',
        target: { role: 'button', name: 'Settings', point: { x: 99, y: 99 } },
      });
      await run(tools, 'save_routine', { id: 'settings', description: 'Open settings' });
      expect((await f.workspace.readRoutine('settings'))?.steps).toHaveLength(2);
      await run(tools, 'press', { key: 'Home' });
      await run(tools, 'report_bug', {
        title: 'Settings is broken', what_is_wrong: 'Wrong content', expected: 'Settings', severity: 'major',
      });
      const candidate = (await f.workspace.readCandidates(f.session.sessionId)).at(-1);
      expect(candidate?.evidence.routineId).toBe('settings');
      expect(candidate?.evidence.steps).toEqual([{ kind: 'press', key: 'Home' }]);
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  });

  it('retries a targeted replay and skips completed dependencies', async () => {
    const f = await fixture();
    try {
      const now = new Date().toISOString();
      const base = { version: 1 as const, platform: 'web' as const, description: 'path',
        createdAt: now, updatedAt: now };
      await f.workspace.saveRoutine({ ...base, id: 'enter-app', steps: [{ kind: 'press', key: 'Enter' }] });
      await f.workspace.saveRoutine({ ...base, id: 'settings', requires: ['enter-app'],
        steps: [{ kind: 'tap', target: { role: 'button', name: 'Settings' } }] });
      const originalAct = f.driver.act.bind(f.driver);
      let attempts = 0;
      f.driver.act = async (action) => {
        if (action.kind === 'tap' && ++attempts < 3) {
          return { ok: false, error: 'not loaded', degraded: true };
        }
        return originalAct(action);
      };
      expect(await replayRoutine(f.session, 'settings')).toMatchObject({ ok: true, degraded: true });
      expect(attempts).toBe(3);
      f.driver.current = 'home';
      expect((await replayRoutine(f.session, 'settings')).ok).toBe(true);
      expect(f.driver.actions.filter((action) => action.kind === 'press')).toHaveLength(1);
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  });

  it('does not offer window switching on iOS', async () => {
    const f = await fixture();
    try {
      const ios = new AgentSession(f.root, f.session.config, f.session.vars,
        f.session.sessionId, 'explorer', new FakeDriver(f.screens, 'home', 'ios'));
      expect(explorerTools(ios).some((tool) => tool.name === 'switch_window')).toBe(false);
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  });
});
