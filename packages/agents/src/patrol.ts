import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { type BughuntersConfig } from '@bughunters/core';
import { createDriver as makeDriver, type Driver } from '@bughunters/drivers';
import { createRuntime } from './runtime/index.js';
import { Workspace } from './workspace.js';
import { Vars } from './vars.js';
import { startApp } from './lifecycle.js';
import { AgentSession } from './session.js';
import { runExplorer } from './roles/explorer.js';
import { runJudge } from './roles/judge.js';
import { recheckMerged, runFixCycle } from './roles/retest.js';
import { runPublisher } from './roles/publish.js';
import { syncGitHub } from './github.js';
import { cleanWorktrees } from './roles/worktrees.js';

const exec = promisify(execFile);

async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await exec('git', args, { cwd })).stdout.trim();
}

/**
 * Check out the latest `patrol.pull` commit in the source repository, so each
 * cycle tests the latest code. A detached HEAD works in a linked worktree, where
 * another worktree can hold the branch. A failure keeps the current checkout.
 */
export async function pullSource(root: string, config: BughuntersConfig,
  onLog?: (message: string) => void): Promise<boolean> {
  const target = config.agents.patrol.pull;
  if (!target) return false;
  const slash = target.indexOf('/');
  const remote = target.slice(0, slash);
  const branch = target.slice(slash + 1);
  const source = resolve(root, config.app.source);
  try {
    if (await git(source, 'status', '--porcelain', '--untracked-files=no')) {
      onLog?.(`Did not pull ${target}: the source repository has uncommitted changes.`);
      return false;
    }
    await git(source, 'fetch', '-q', remote, `+refs/heads/${branch}:refs/remotes/${remote}/${branch}`);
    await git(source, 'checkout', '-q', '--detach', `${remote}/${branch}`);
    onLog?.(`Pulled ${target} at ${await git(source, 'rev-parse', '--short', 'HEAD')}.`);
    return true;
  } catch (error) {
    const reason = (error as { stderr?: string }).stderr?.trim() || (error as Error).message;
    onLog?.(`Did not pull ${target}: ${reason}. The cycle uses the current checkout.`);
    return false;
  }
}

/** The HEAD commit of the source repository, or undefined when it has uncommitted changes. */
export async function sourceCommit(root: string, config: BughuntersConfig): Promise<string | undefined> {
  const source = resolve(root, config.app.source);
  try {
    if (await git(source, 'status', '--porcelain', '--untracked-files=no')) return undefined;
    return await git(source, 'rev-parse', 'HEAD');
  } catch { return undefined; }
}

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function wait(minutes: number): Promise<void> {
  return new Promise<void>((done) => {
    const finish = () => {
      clearTimeout(timer);
      process.off('SIGINT', finish);
      process.off('SIGTERM', finish);
      done();
    };
    const timer = setTimeout(finish, minutes * 60_000);
    process.once('SIGINT', finish);
    process.once('SIGTERM', finish);
  });
}

export type PatrolOptions = {
  root: string;
  config: BughuntersConfig;
  once?: boolean;
  /** Run the first cycle also when the commit did not change. */
  force?: boolean;
  onLog?: (message: string) => void;
  createDriver?: typeof makeDriver;
  createRuntime?: typeof createRuntime;
};

/** Every cycle owns app setup, driver connection, roles, and teardown. */
export async function runPatrol(options: PatrolOptions): Promise<void> {
  const { root, config } = options;
  const workspace = new Workspace(root);
  const previous = (await workspace.readAgents()).patrol;
  // A cron job can start a patrol while the last one still runs.
  if (previous?.state === 'running' && previous.pid && previous.pid !== process.pid && alive(previous.pid)) {
    options.onLog?.(`A patrol already runs (pid ${previous.pid}): did not start another.`);
    return;
  }
  const runtime = options.createRuntime ?? createRuntime;
  let interrupted = false;
  let activeSession: AgentSession | undefined;
  const onSignal = () => {
    interrupted = true;
    if (activeSession) {
      activeSession.cancelled = true;
    }
  };
  const idle = () => workspace.setPatrol({ state: 'stopped',
    nextAt: new Date(Date.now() + config.agents.patrol.intervalMinutes * 60_000).toISOString() });
  // The commit of the last full cycle, also from an earlier run, so a cron job
  // with --once tests only new commits. --force tests the first cycle anyway.
  let tested = options.force ? undefined : previous?.commit;
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  try {
    for (let cycle = 1; !interrupted; cycle++) {
      if (config.agents.patrol.cycles && cycle > config.agents.patrol.cycles) {
        break;
      }
      if (cycle > 1) {
        await wait(config.agents.patrol.intervalMinutes);
        if (interrupted) break;
      }
      await workspace.setPatrol({ state: 'running', cycle, startedAt: new Date().toISOString() });
      await pullSource(root, config, options.onLog);
      if (config.agents.github.enabled) await syncGitHub(root, config, { onLog: options.onLog });
      await cleanWorktrees(root, config, { onLog: options.onLog });
      const commit = await sourceCommit(root, config);
      if (commit && commit === tested) {
        options.onLog?.(`No new commit since the last cycle (${commit.slice(0, 7)}): skipped the cycle.`);
        await idle();
        if (options.once) break;
        continue;
      }
      for (const role of ['explorer', 'judge', 'fixer'] as const) {
        if (!config.agents[role].enabled) {
          await workspace.setAgentStatus(role, { state: 'off' });
        }
      }
      const vars = new Vars(config.app.secrets);
      let app: Awaited<ReturnType<typeof startApp>> | undefined;
      let driver: Driver | undefined;
      try {
        app = await startApp(config.app, { root, vars, emit: options.onLog });
        driver = (options.createDriver ?? makeDriver)(config, vars.resolve.bind(vars));
        await driver.connect();
        let explorerId: string | undefined;
        if (config.agents.explorer.enabled && !interrupted) {
          const record = await workspace.startSession('explorer');
          explorerId = record.id;
          const session = new AgentSession(root, config, vars, record.id, 'explorer', driver, options.onLog);
          activeSession = session;
          if (!interrupted) {
            await runExplorer(session, runtime(config.agents.explorer.use));
          } else {
            await workspace.endSession(record.id, { summary: 'Interrupted' });
          }
          activeSession = undefined;
        }
        if (config.agents.judge.enabled && explorerId && !interrupted) {
          const record = await workspace.startSession('judge');
          const session = new AgentSession(root, config, vars, record.id, 'judge', undefined, options.onLog);
          activeSession = session;
          await runJudge(session, runtime(config.agents.judge.use), { sessionIds: [explorerId] });
        }
      } finally {
        try {
          await driver?.close();
        } finally {
          await app?.stop();
        }
      }
      if (!interrupted && config.agents.explorer.enabled && config.agents.judge.enabled) {
        await recheckMerged(root, config, { createDriver: options.createDriver,
          createRuntime: options.createRuntime, onLog: options.onLog,
          onSession: (session) => { activeSession = session; }, isInterrupted: () => interrupted });
      }
      if (!interrupted) await runFixCycle(root, config, {
        createDriver: options.createDriver,
        createRuntime: options.createRuntime,
        onLog: options.onLog,
        onSession: (session) => { activeSession = session; },
        isInterrupted: () => interrupted,
      });
      if (!interrupted && config.agents.github.enabled) await runPublisher(root, config, {
        createRuntime: options.createRuntime, onLog: options.onLog,
        onSession: (session) => { activeSession = session; },
      });
      if (!interrupted && config.agents.github.enabled) await syncGitHub(root, config, { onLog: options.onLog });
      if (!interrupted && commit) {
        tested = commit;
        await workspace.setPatrol({ commit });
      }
      await idle();
      if (options.once || interrupted) {
        break;
      }
    }
  } finally {
    // No cycle follows, so the dashboard must not show a next patrol.
    await workspace.setPatrol({ state: 'stopped', nextAt: undefined });
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  }
}
