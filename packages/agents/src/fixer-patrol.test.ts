import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseConfig, type Issue } from '@autoqa/core';
import { FakeDriver } from './testing/fake-driver.js';
import { AgentSession } from './session.js';
import { Vars } from './vars.js';
import { Workspace } from './workspace.js';
import { runFixer } from './roles/fixer.js';
import { runPatrol } from './patrol.js';
import type { Runtime } from './types.js';

const exec = promisify(execFile);
async function git(cwd: string, ...args: string[]) {
  return exec('git', args, { cwd });
}

async function repoFixture() {
  const root = await mkdtemp(join(tmpdir(), 'autoqa-fixer-'));
  const source = join(root, 'source');
  await exec('mkdir', ['-p', source]);
  await git(source, 'init');
  await git(source, 'config', 'user.email', 'test@example.com');
  await git(source, 'config', 'user.name', 'AutoQA Test');
  await git(source, 'config', 'commit.gpgsign', 'false');
  await git(source, 'config', 'core.hooksPath', '/dev/null');
  await writeFile(join(source, 'app.txt'), 'broken\n');
  await git(source, 'add', '-A');
  await git(source, 'commit', '-m', 'initial');
  const workspace = new Workspace(root);
  const issue: Issue = { version: 1, id: 'iss_1', fingerprint: 'fp', title: 'Screen is broken',
    body: 'What happened: broken\nExpected: fixed', severity: 'major', status: 'new',
    candidateIds: [], evidence: { steps: [{ kind: 'open', url: 'fake://home' }] },
    judgement: { by: 'judge', reason: 'visible', at: 'now' }, occurrences: 1,
    firstSeenAt: 'now', lastSeenAt: 'now' };
  await workspace.saveIssue(issue);
  const config = parseConfig({ version: 1, app: { source: 'source', connect: { url: 'fake://home' } },
    agents: { fixer: { enabled: true, use: { runtime: 'cli', command: 'fake' }, verify: 'test -f app.txt' } } });
  const record = await workspace.startSession('fixer');
  return { root, source, workspace, config,
    session: new AgentSession(root, config, new Vars(), record.id, 'fixer') };
}

describe('fixer', () => {
  it('creates a worktree branch, captures diff, verifies, and commits locally', async () => {
    const f = await repoFixture();
    try {
      const runtime: Runtime = { label: 'cli:fake', async run(task) {
        expect(task.system).toContain('You are a senior engineer on this codebase');
        expect(task.prompt).toContain('Run the routine (none), then:\n1. Open fake://home');
        await writeFile(join(task.workdir!, 'app.txt'), 'fixed\n');
        return { stop: 'done', steps: 1, costUsd: 0, summary: 'Fixed screen' };
      } };
      const [proposal] = await runFixer(f.session, runtime);
      expect(proposal).toMatchObject({ status: 'proposed', branch: 'autoqa/fix-iss_1' });
      expect(proposal?.diff).toContain('+fixed');
      expect((await f.workspace.readIssue('iss_1'))).toMatchObject({ status: 'fix-proposed', fixId: 'fix_iss_1' });
      expect((await git(proposal!.worktree, 'log', '-1', '--pretty=%s')).stdout.trim())
        .toBe('fix: screen is broken');
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  });

  it('marks a proposal failed when the runtime changes nothing', async () => {
    const f = await repoFixture();
    try {
      const runtime: Runtime = { label: 'cli:fake', async run() {
        return { stop: 'done', steps: 0, costUsd: 0 };
      } };
      const [proposal] = await runFixer(f.session, runtime);
      expect(proposal).toMatchObject({ status: 'failed', error: 'The fixer made no change and gave no reason.' });
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  });

  it('records a declined fix when the runtime explains why nothing changed', async () => {
    const f = await repoFixture();
    try {
      const runtime: Runtime = { label: 'cli:fake', async run() {
        return { stop: 'done', steps: 1, costUsd: 0, summary: 'The overlay is hidden by design (app.txt:1).' };
      } };
      const [proposal] = await runFixer(f.session, runtime);
      expect(proposal).toMatchObject({ status: 'declined', summary: 'The overlay is hidden by design (app.txt:1).' });
      expect(proposal!.error).toBeUndefined();
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  });

  it('retries a failed proposal from a clean worktree', async () => {
    const f = await repoFixture();
    try {
      let attempts = 0;
      const runtime: Runtime = { label: 'cli:fake', async run(task) {
        attempts++;
        if (attempts === 1) {
          await writeFile(join(task.workdir!, 'scratch.txt'), 'leftover');
          return { stop: 'error', steps: 1, costUsd: 0, error: 'first attempt failed' };
        }
        await expect(readFile(join(task.workdir!, 'scratch.txt'), 'utf8')).rejects.toThrow();
        await writeFile(join(task.workdir!, 'app.txt'), 'fixed\n');
        return { stop: 'done', steps: 1, costUsd: 0, summary: '**Fixed** the screen' };
      } };
      expect((await runFixer(f.session, runtime))[0]?.status).toBe('failed');
      const [proposal] = await runFixer(f.session, runtime);
      expect(proposal?.status).toBe('proposed');
      expect(proposal?.summary).toBe('**Fixed** the screen');
      expect((await f.workspace.readIssue('iss_1'))?.status).toBe('fix-proposed');
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  });

  it('keeps a verified diff proposed when the commit hook rejects it', async () => {
    const f = await repoFixture();
    try {
      const hooks = join(f.root, 'hooks');
      await mkdir(hooks);
      const hook = join(hooks, 'pre-commit');
      await writeFile(hook, '#!/bin/sh\necho "error: rejected by test hook" >&2\nexit 1\n');
      await chmod(hook, 0o755);
      await git(f.source, 'config', 'core.hooksPath', hooks);
      const runtime: Runtime = { label: 'cli:fake', async run(task) {
        await writeFile(join(task.workdir!, 'app.txt'), 'fixed\n');
        return { stop: 'done', steps: 1, costUsd: 0, summary: 'Fixed' };
      } };
      const [proposal] = await runFixer(f.session, runtime);
      expect(proposal?.status).toBe('proposed');
      expect(proposal?.error).toContain('rejected by test hook');
      expect((await f.workspace.readIssue('iss_1'))?.status).toBe('fix-proposed');
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  });
});

describe('patrol', () => {
  const config = parseConfig({ version: 1, app: { connect: { url: 'fake://home' } },
    agents: { fixer: { enabled: false }, patrol: { cycles: 1 } } });

  it('runs explorer then judge and closes the driver', async () => {
    const root = await mkdtemp(join(tmpdir(), 'autoqa-patrol-'));
    const driver = new FakeDriver({ home: { elements: [] } });
    const roles: string[] = [];
    try {
      await runPatrol({ root, config, once: true, createDriver: () => driver, createRuntime: () => ({
        label: 'scripted', async run(task) {
          roles.push(task.role);
          if (task.role === 'explorer') {
            expect(task.system).toContain('You are the explorer on an automated QA team');
            expect(task.prompt).toContain('KNOWN SCREENS');
            await task.tools.find((item) => item.name === 'report_bug')!.run({ title: 'Broken home',
              what_is_wrong: 'Blank', expected: 'Content', severity: 'major' });
          } else if (task.role === 'judge') {
            expect(task.system).toContain('You are the QA lead on an automated QA team');
            expect(task.prompt).toContain('CANDIDATES');
          }
          return { stop: 'done', steps: 1, costUsd: 0, summary: 'Done' };
        },
      }) });
      expect(roles).toEqual(['explorer', 'judge']);
      expect(driver.closed).toBe(true);
      expect((await new Workspace(root).readAgents()).patrol?.state).toBe('stopped');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('leaves known screen routines for the explorer to revisit', async () => {
    const root = await mkdtemp(join(tmpdir(), 'autoqa-patrol-'));
    const workspace = new Workspace(root);
    const now = new Date().toISOString();
    await workspace.saveRoutine({ version: 1, id: 'screen-home', description: 'Home', platform: 'web',
      steps: [{ kind: 'press', key: 'Enter' }], createdAt: now, updatedAt: now });
    await workspace.upsertScreen({ id: 'home', name: 'Home', description: 'Home', platform: 'web',
      routineId: 'screen-home' });
    const driver = new FakeDriver({ home: { elements: [] } });
    try {
      await runPatrol({ root, config, once: true, createDriver: () => driver,
        createRuntime: () => ({ label: 'scripted', async run() {
          return { stop: 'done', steps: 0, costUsd: 0, summary: 'Done' };
        } }) });
      expect(driver.actions).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('tears down when explorer throws', async () => {
    const root = await mkdtemp(join(tmpdir(), 'autoqa-patrol-'));
    const driver = new FakeDriver({ home: { elements: [] } });
    const withTeardown = parseConfig({ version: 1,
      app: { connect: { url: 'fake://home' }, teardown: [{ run: 'touch stopped.txt' }] },
      agents: { fixer: { enabled: false }, patrol: { cycles: 1 } } });
    try {
      await expect(runPatrol({ root, config: withTeardown, once: true, createDriver: () => driver,
        createRuntime: () => ({ label: 'scripted', async run() { throw new Error('boom'); } }) }))
        .rejects.toThrow('boom');
      expect(driver.closed).toBe(true);
      expect(await readFile(join(root, 'stopped.txt'), 'utf8')).toBe('');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
