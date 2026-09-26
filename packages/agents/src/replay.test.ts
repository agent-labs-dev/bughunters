import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseConfig, type Routine } from '@bughunters/core';
import { AgentSession } from './session.js';
import { Vars } from './vars.js';
import { Workspace } from './workspace.js';
import { FakeDriver, type FakeScreen } from './testing/fake-driver.js';
import { replayRoutine, replaySteps } from './replay.js';

const config = parseConfig({ version: 1, app: { connect: { url: 'fake://home' } }, decisions: { decider: 'heuristic' } });
const button = (ref: string, name: string) => ({
  ref, role: 'button', name, box: { x: 10, y: 10, width: 40, height: 40 }, interactive: true, enabled: true,
});
const screens: Record<string, FakeScreen> = {
  home: { elements: [button('e1', 'Open settings')], next: { e1: 'settings' } },
  settings: { elements: [button('e2', 'Save'), button('e3', 'Cancel')] },
};

// Step 0 closes a banner that is not there this time; step 1 is the real path.
function routine(expect?: Routine['expect']): Routine {
  return {
    version: 1,
    id: 'open-settings',
    description: 'Open settings',
    platform: 'web',
    steps: [
      { kind: 'tap', target: { name: 'Dismiss banner', role: 'button' } },
      { kind: 'tap', target: { name: 'Open settings', role: 'button' } },
    ],
    expect,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'bughunters-replay-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function replay(value: Routine) {
  const workspace = new Workspace(root);
  await workspace.saveRoutine(value);
  const record = await workspace.startSession('explorer');
  const session = new AgentSession(root, config, new Vars(), record.id, 'explorer', new FakeDriver(screens));
  // A short retry window: the rule under test is the skip, not the wait.
  const result = await replayRoutine(session, value.id, { windowMs: 200 });
  return { result, saved: await workspace.readRoutine(value.id) };
}

// FakeDriver finds a locator by ref, testId or name; see testing/fake-driver.ts.
describe('replayRoutine end check', () => {
  it('stores a failure from a fix build but leaves success on that build unsaved', async () => {
    const workspace = new Workspace(root);
    const record = await workspace.startSession('explorer');
    const driver = new FakeDriver(screens);
    const session = new AgentSession(root, config, new Vars(), record.id, 'explorer', driver);
    await workspace.saveRoutine(routine());
    expect((await replayRoutine(session, 'open-settings', { windowMs: 10, save: false, onFixBuild: true })).ok).toBe(false);
    expect((await workspace.readRoutine('open-settings'))?.lastReplay).toMatchObject({ ok: false, onFixBuild: true });
    await workspace.saveRoutine({ ...routine({ elements: ['Save', 'Cancel'] }), lastReplay: undefined });
    expect((await replayRoutine(session, 'open-settings', { windowMs: 10, save: false, onFixBuild: true })).ok).toBe(true);
    expect((await workspace.readRoutine('open-settings'))?.lastReplay).toBeUndefined();
  });
  it('skips a missing step when the routine still ends where it should', async () => {
    const { result, saved } = await replay(routine({ elements: ['Save', 'Cancel'] }));
    expect(result).toMatchObject({ ok: true, degraded: true });
    expect(saved?.lastReplay).toMatchObject({ ok: true, skipped: [0] });
  });

  it('fails at the skipped step when the end does not match', async () => {
    const { result } = await replay(routine({ elements: ['Delete account', 'Billing'] }));
    expect(result).toMatchObject({ ok: false, failedStep: 0 });
  });

  it('fails at the first miss when the routine has no end check', async () => {
    const { result } = await replay(routine());
    expect(result).toMatchObject({ ok: false, failedStep: 0 });
  });
});

describe('replaySteps', () => {
  it('replays a path from the current screen', async () => {
    const record = await new Workspace(root).startSession('explorer');
    const driver = new FakeDriver(screens);
    const session = new AgentSession(root, config, new Vars(), record.id, 'explorer', driver);
    const result = await replaySteps(session, [{ kind: 'tap', target: { role: 'button', name: 'Open settings' } }], { windowMs: 50 });
    expect(result).toMatchObject({ ok: true, degraded: false });
    expect(driver.current).toBe('settings');
  });

  it('stops at the first failed step without skipping it', async () => {
    const record = await new Workspace(root).startSession('explorer');
    const driver = new FakeDriver(screens);
    const session = new AgentSession(root, config, new Vars(), record.id, 'explorer', driver);
    const result = await replaySteps(session, [
      { kind: 'tap', target: { role: 'button', name: 'Missing' } },
      { kind: 'tap', target: { role: 'button', name: 'Open settings' } },
    ], { windowMs: 50 });
    expect(result).toMatchObject({ ok: false, failedStep: 0 });
    expect(driver.current).toBe('home');
  });
});
