import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseConfig, type Candidate, type FixProposal, type Issue } from '@autoqa/core';
import { FakeDriver } from './testing/fake-driver.js';
import { AgentSession } from './session.js';
import { Vars } from './vars.js';
import { Workspace } from './workspace.js';
import { runFixer } from './roles/fixer.js';
import { retestFix, retestTargets, runFixCycle } from './roles/retest.js';
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
      expect(proposal).toMatchObject({ status: 'retesting', branch: 'autoqa/fix-iss_1' });
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
      expect(proposal?.status).toBe('retesting');
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

describe('fix cycle', () => {
  it('records a fixed verdict and the explorer and judge sessions', async () => {
    const f = await repoFixture();
    try {
      const issue = (await f.workspace.readIssue('iss_1'))!;
      await f.workspace.saveIssue({ ...issue, evidence: { ...issue.evidence, routineId: 'enter-app' } });
      await f.workspace.saveRoutine({ version: 1, id: 'enter-app', description: 'Enter app', platform: 'web',
        steps: [{ kind: 'open', url: 'fake://home' }], createdAt: 'now', updatedAt: 'now' });
      const config = parseConfig({ ...f.config, app: { ...f.config.app,
        setup: [{ run: 'pwd > retest-cwd; echo "$AUTOQA_SOURCE" > retest-source', cwd: 'source' }] } });
      const driver = new FakeDriver({ home: { elements: [] } });
      const roles: string[] = [];
      const [fix] = await runFixCycle(f.root, config, { createDriver: () => driver,
        createRuntime: () => ({ label: 'scripted', async run(task) {
          roles.push(task.role);
          if (task.role === 'fixer') await writeFile(join(task.workdir!, 'app.txt'), 'fixed\n');
          if (task.role === 'explorer') {
            await task.tools.find((tool) => tool.name === 'run_routine')!.run({ id: 'enter-app' });
            await task.tools.find((tool) => tool.name === 'replay_issue_steps')!.run({ target: 1 });
            await task.tools.find((tool) => tool.name === 'capture_after')!
              .run({ target: 1, note: 'Reached home', reached: true });
          }
          if (task.role === 'judge') await task.tools.find((tool) => tool.name === 'verdict')!
            .run({ outcome: 'fixed', reason: 'The problem is gone.' });
          return { stop: 'done', steps: 1, costUsd: 0, summary: 'Done' };
        } }),
      });
      expect(roles).toEqual(['fixer', 'explorer', 'judge']);
      expect(fix?.status).toBe('verified');
      expect(fix?.retests?.[0]?.after).toContain('retest-after-1.png');
      expect((await f.workspace.listSessions()).map((item) => item.role)).toEqual(expect.arrayContaining(['explorer', 'judge']));
      expect((await readFile(join(fix!.worktree, 'retest-cwd'), 'utf8')).trim()).toBe(await realpath(fix!.worktree));
      expect((await readFile(join(fix!.worktree, 'retest-source'), 'utf8')).trim()).toBe(fix!.worktree);
      expect((await f.workspace.readRoutine('enter-app'))?.lastReplay).toBeUndefined();
    } finally { await rm(f.root, { recursive: true, force: true }); }
  });

  it('feeds a not-fixed verdict into a second fixer attempt', async () => {
    const f = await repoFixture();
    try {
      let fixes = 0;
      let verdicts = 0;
      const [fix] = await runFixCycle(f.root, f.config, { createDriver: () => new FakeDriver({ home: { elements: [] } }),
        createRuntime: () => ({ label: 'scripted', async run(task) {
          if (task.role === 'fixer') {
            fixes++;
            if (fixes === 2) {
              expect(task.prompt).toContain('Your last change did not fix the issue. The QA lead said: Still broken.');
              expect(task.prompt).toContain('retest-after-1.png');
            }
            await writeFile(join(task.workdir!, 'app.txt'), `fix ${fixes}\n`);
          }
          if (task.role === 'explorer') await task.tools.find((tool) => tool.name === 'capture_after')!
            .run({ target: 1, note: 'Home', reached: true });
          if (task.role === 'judge') await task.tools.find((tool) => tool.name === 'verdict')!
            .run({ outcome: ++verdicts === 1 ? 'not-fixed' : 'fixed', reason: verdicts === 1 ? 'Still broken.' : 'Fixed.' });
          return { stop: 'done', steps: 1, costUsd: 0, summary: 'Done' };
        } }) });
      expect(fixes).toBe(2);
      expect(fix?.status).toBe('verified');
      expect(fix?.retests?.map((item) => item.outcome)).toEqual(['not-fixed', 'fixed']);
      expect(fix?.diff).toContain('+fix 2');
    } finally { await rm(f.root, { recursive: true, force: true }); }
  });

  it('leaves a fix proposed when retest is disabled', async () => {
    const f = await repoFixture();
    try {
      const config = parseConfig({ ...f.config, agents: { ...f.config.agents,
        fixer: { ...f.config.agents.fixer, retest: { enabled: false } } } });
      const [fix] = await runFixCycle(f.root, config, { createRuntime: () => ({ label: 'scripted', async run(task) {
        await writeFile(join(task.workdir!, 'app.txt'), 'fixed\n');
        return { stop: 'done', steps: 1, costUsd: 0, summary: 'Done' };
      } }) });
      expect(fix?.status).toBe('proposed');
      expect(fix?.retests).toBeUndefined();
    } finally { await rm(f.root, { recursive: true, force: true }); }
  });

  it('stops after the configured number of not-fixed attempts', async () => {
    const f = await repoFixture();
    try {
      let fixes = 0;
      const [fix] = await runFixCycle(f.root, f.config, {
        createDriver: () => new FakeDriver({ home: { elements: [] } }),
        createRuntime: () => ({ label: 'scripted', async run(task) {
          if (task.role === 'fixer') await writeFile(join(task.workdir!, 'app.txt'), `fix ${++fixes}\n`);
          if (task.role === 'explorer') await task.tools.find((tool) => tool.name === 'capture_after')!
            .run({ target: 1, note: 'Still broken', reached: true });
          if (task.role === 'judge') await task.tools.find((tool) => tool.name === 'verdict')!
            .run({ outcome: 'not-fixed', reason: 'Still broken.' });
          return { stop: 'done', steps: 1, costUsd: 0, summary: 'Done' };
        } }),
      });
      expect(fixes).toBe(2);
      expect(fix?.retests).toHaveLength(2);
      expect(fix?.status).toBe('proposed');
    } finally { await rm(f.root, { recursive: true, force: true }); }
  });

  it('captures a fallback screenshot when the explorer stops without capture_after', async () => {
    const f = await repoFixture();
    try {
      const [fix] = await runFixCycle(f.root, f.config, { createDriver: () => new FakeDriver({ home: { elements: [] } }),
        createRuntime: () => ({ label: 'scripted', async run(task) {
          if (task.role === 'fixer') await writeFile(join(task.workdir!, 'app.txt'), 'fixed\n');
          if (task.role === 'judge') {
            expect(task.prompt).toContain('reached: false');
            await task.tools.find((tool) => tool.name === 'verdict')!
              .run({ outcome: 'unclear', reason: 'Could not confirm the screen.' });
          }
          return { stop: 'done', steps: 1, costUsd: 0, summary: 'Done' };
        } }) });
      expect(fix?.retests?.[0]).toMatchObject({ outcome: 'unclear', note: expect.stringContaining('without capture_after') });
      expect(fix?.retests?.[0]?.after).toContain('retest-after-1.png');
    } finally { await rm(f.root, { recursive: true, force: true }); }
  });
});

describe('multi-screen retest', () => {
  async function screensFixture() {
    const f = await repoFixture();
    const driver = new FakeDriver({ usage: { elements: [] }, memories: { elements: [] } }, 'usage');
    const beforeUsage = 'before-usage.png';
    const beforeMemories = 'before-memories.png';
    await writeFile(join(f.root, beforeUsage), (await driver.observe()).screenshot);
    driver.current = 'memories';
    await writeFile(join(f.root, beforeMemories), (await driver.observe()).screenshot);
    driver.current = 'usage';
    const record = await f.workspace.startSession('explorer');
    const issue = (await f.workspace.readIssue('iss_1'))!;
    issue.screenId = 'usage';
    issue.evidence = { screenshot: beforeUsage };
    issue.candidateIds = ['cand_usage', 'cand_memories'];
    for (const [id, screenId, screenshot] of [
      ['cand_usage', 'usage', beforeUsage], ['cand_memories', 'memories', beforeMemories],
    ] as [string, string, string][]) {
      const candidate: Candidate = { id, sessionId: record.id, screenId, source: 'explorer',
        fingerprint: id, summary: 'Broken', severity: 'major',
        evidence: { screenshot, steps: [{ kind: 'open', url: `fake://${screenId}` }] }, createdAt: 'now' };
      await f.workspace.appendCandidate(record.id, candidate);
    }
    const fix: FixProposal = { version: 1, id: 'fix_iss_1', issueId: issue.id, status: 'retesting',
      runtime: 'scripted', repo: f.source, worktree: f.source, branch: 'test', startedAt: 'now' };
    return { ...f, driver, issue, fix };
  }

  it('captures both affected screens and gives the judge both image pairs', async () => {
    const f = await screensFixture();
    try {
      expect(await retestTargets(f.workspace, f.issue)).toMatchObject([
        { screenId: 'usage', before: 'before-usage.png' },
        { screenId: 'memories', before: 'before-memories.png' },
      ]);
      const retest = await retestFix(f.root, f.config, f.issue, f.fix, 1, {
        createDriver: () => f.driver,
        createRuntime: () => ({ label: 'scripted', async run(task) {
          if (task.role === 'explorer') {
            expect(task.prompt).toContain('1. screen usage');
            expect(task.prompt).toContain('2. screen memories');
            expect(task.maxSteps).toBeGreaterThanOrEqual(24);
            for (const target of [1, 2]) {
              const before = await task.tools.find((tool) => tool.name === 'view_before')!.run({ target });
              expect(before.content.filter((item) => item.type === 'image')).toHaveLength(1);
              await task.tools.find((tool) => tool.name === 'replay_issue_steps')!.run({ target });
              const capture = await task.tools.find((tool) => tool.name === 'capture_after')!
                .run({ target, note: `Reached ${target}`, reached: true });
              expect(capture.done).toBeUndefined();
            }
            expect((await task.tools.find((tool) => tool.name === 'finish_retest')!
              .run({ summary: 'Reached both screens' })).done).toBe(true);
          } else {
            const view = await task.tools.find((tool) => tool.name === 'view_retest')!.run({});
            expect(view.content.filter((item) => item.type === 'image')).toHaveLength(4);
            expect(view.content.map((item) => item.type === 'text' ? item.text : '').join('\n'))
              .toContain('Screen 2: memories — reached: true');
            await task.tools.find((tool) => tool.name === 'verdict')!
              .run({ outcome: 'fixed', reason: 'Gone on both screens.' });
          }
          return { stop: 'done', steps: 1, costUsd: 0 };
        } }),
      });
      expect(retest.shots).toMatchObject([
        { screenId: 'usage', reached: true, note: 'Reached 1' },
        { screenId: 'memories', reached: true, note: 'Reached 2' },
      ]);
      expect(retest.shots?.every((shot) => Boolean(shot.after))).toBe(true);
      expect(retest.before).toBe(retest.shots?.[0]?.before);
      expect(retest.after).toBe(retest.shots?.[0]?.after);
      expect(retest.note).toBe(retest.shots?.[0]?.note);
    } finally { await rm(f.root, { recursive: true, force: true }); }
  });

  it('refuses the first finish with a missing target and accepts the second', async () => {
    const f = await screensFixture();
    try {
      const retest = await retestFix(f.root, f.config, f.issue, f.fix, 1, {
        createDriver: () => f.driver,
        createRuntime: () => ({ label: 'scripted', async run(task) {
          if (task.role === 'explorer') {
            await task.tools.find((tool) => tool.name === 'capture_after')!
              .run({ target: 1, note: 'Usage reached', reached: true });
            const finish = task.tools.find((tool) => tool.name === 'finish_retest')!;
            const first = await finish.run({ summary: 'Could not reach memories' });
            expect(first.isError).toBe(true);
            expect(first.done).toBeUndefined();
            expect(first.content[0]).toMatchObject({ text: expect.stringContaining('2') });
            expect((await finish.run({ summary: 'Could not reach memories' })).done).toBe(true);
          } else {
            await task.tools.find((tool) => tool.name === 'verdict')!
              .run({ outcome: 'unclear', reason: 'Memories was not reached.' });
          }
          return { stop: 'done', steps: 1, costUsd: 0 };
        } }),
      });
      expect(retest.shots?.[1]).toMatchObject({ reached: false,
        note: 'The explorer did not reach this screen.' });
      expect(retest.shots?.[1]?.after).toBeUndefined();
    } finally { await rm(f.root, { recursive: true, force: true }); }
  });

  it('deduplicates candidates on the same screen', async () => {
    const f = await screensFixture();
    try {
      f.issue.candidateIds.push('cand_memories_again');
      const session = (await f.workspace.listSessions())[0]!;
      await f.workspace.appendCandidate(session.id, { id: 'cand_memories_again', sessionId: session.id,
        screenId: 'memories', source: 'pixel-diff', fingerprint: 'again', summary: 'Same screen',
        severity: 'major', evidence: { screenshot: 'another.png' }, createdAt: 'now' });
      expect(await retestTargets(f.workspace, f.issue)).toHaveLength(2);
    } finally { await rm(f.root, { recursive: true, force: true }); }
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

  it('stops the patrol app before starting the worktree retest', async () => {
    const f = await repoFixture();
    try {
      const config = parseConfig({ ...f.config, app: { ...f.config.app,
        teardown: [{ run: 'touch patrol-stopped' }] }, agents: { ...f.config.agents, patrol: { cycles: 1 } } });
      let connections = 0;
      await runPatrol({ root: f.root, config, once: true,
        createDriver: () => {
          connections++;
          if (connections === 2) expect(existsSync(join(f.root, 'patrol-stopped'))).toBe(true);
          return new FakeDriver({ home: { elements: [] } });
        },
        createRuntime: () => ({ label: 'scripted', async run(task) {
          if (task.role === 'fixer') await writeFile(join(task.workdir!, 'app.txt'), 'fixed\n');
          if (task.role === 'explorer' && task.tools.some((tool) => tool.name === 'capture_after'))
            await task.tools.find((tool) => tool.name === 'capture_after')!.run({ target: 1, note: 'Home', reached: true });
          if (task.role === 'judge' && task.tools.some((tool) => tool.name === 'verdict'))
            await task.tools.find((tool) => tool.name === 'verdict')!.run({ outcome: 'fixed', reason: 'Gone.' });
          return { stop: 'done', steps: 1, costUsd: 0, summary: 'Done' };
        } }),
      });
      expect(connections).toBe(2);
      expect((await f.workspace.readFix('fix_iss_1'))?.status).toBe('verified');
    } finally { await rm(f.root, { recursive: true, force: true }); }
  });
});
