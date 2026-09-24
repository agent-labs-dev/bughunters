import { type AutoQAConfig } from '@autoqa/core';
import { createDriver as makeDriver, type Driver } from '@autoqa/drivers';
import { createRuntime } from './runtime/index.js';
import { Workspace } from './workspace.js';
import { Vars } from './vars.js';
import { startApp } from './lifecycle.js';
import { AgentSession } from './session.js';
import { runExplorer } from './roles/explorer.js';
import { runJudge } from './roles/judge.js';
import { runFixer } from './roles/fixer.js';

export type PatrolOptions = {
  root: string;
  config: AutoQAConfig;
  once?: boolean;
  onLog?: (message: string) => void;
  createDriver?: typeof makeDriver;
  createRuntime?: typeof createRuntime;
};

/** Every cycle owns app setup, driver connection, roles, and teardown. */
export async function runPatrol(options: PatrolOptions): Promise<void> {
  const { root, config } = options;
  const workspace = new Workspace(root);
  const runtime = options.createRuntime ?? createRuntime;
  let interrupted = false;
  let activeSession: AgentSession | undefined;
  const onSignal = () => {
    interrupted = true;
    if (activeSession) {
      activeSession.cancelled = true;
    }
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  try {
    for (let cycle = 1; !interrupted; cycle++) {
      if (config.agents.patrol.cycles && cycle > config.agents.patrol.cycles) {
        break;
      }
      await workspace.setPatrol({ state: 'running', cycle, startedAt: new Date().toISOString() });
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
        if (config.agents.fixer.enabled && !interrupted) {
          const record = await workspace.startSession('fixer');
          const session = new AgentSession(root, config, vars, record.id, 'fixer', undefined, options.onLog);
          activeSession = session;
          await runFixer(session, runtime(config.agents.fixer.use));
        }
      } finally {
        try {
          await driver?.close();
        } finally {
          await app?.stop();
        }
      }
      const nextAt = new Date(Date.now() + config.agents.patrol.intervalMinutes * 60_000).toISOString();
      await workspace.setPatrol({ state: 'stopped', nextAt });
      if (options.once || interrupted) {
        break;
      }
      await new Promise<void>((done) => {
        const finish = () => {
          clearTimeout(timer);
          process.off('SIGINT', stop);
          process.off('SIGTERM', stop);
          done();
        };
        const timer = setTimeout(finish, config.agents.patrol.intervalMinutes * 60_000);
        const stop = () => finish();
        process.once('SIGINT', stop);
        process.once('SIGTERM', stop);
      });
    }
  } finally {
    await workspace.setPatrol({ state: 'stopped' });
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  }
}
