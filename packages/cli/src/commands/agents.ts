import { ConfigError, InfrastructureError, type AgentRole, type BughuntersConfig } from '@bughunters/core';
import { createDriver } from '@bughunters/drivers';
import { AgentSession, Vars, Workspace, createRuntime, replayRoutine, runExplorer, runJudge, runtimeProblem,
  applyRetest, runFixCycle, runPatrol, runPublisher, retestFix, startApp, syncGitHub } from '@bughunters/agents';
import { resolveDecider } from '@bughunters/decide';

type AgentFlags = Record<string, string | string[] | boolean | number>;

/** Rejects ambiguous agent flags before an app or agent runtime starts. */
export function parseAgentFlags(command: string, args: string[]): AgentFlags {
  const flags: AgentFlags = {};
  if (command === 'replay') {
    if (args.length !== 1 || args[0]?.startsWith('-')) {
      throw new ConfigError('replay needs one routine id');
    }
    return { id: args[0]! };
  }
  const values: Record<string, string[]> = {
    explore: ['--goal', '--steps'],
    judge: ['--session'],
    fix: ['--issue'],
    retest: ['--issue'],
    publish: ['--issue'],
    patrol: [],
  };
  if (!values[command]) throw new ConfigError(`Unknown agent command ${command}`);
  for (let index = 0; index < args.length; index++) {
    const flag = args[index]!;
    if (command === 'patrol' && flag === '--once') {
      flags.once = true;
      continue;
    }
    if (command === 'publish' && flag === '--dry-run') {
      flags.dryRun = true;
      continue;
    }
    if (!values[command]!.includes(flag)) {
      throw new ConfigError(`Unknown flag for ${command}: ${flag}`);
    }
    const value = args[++index];
    if (!value || value.startsWith('--')) {
      throw new ConfigError(`${flag} needs a value`);
    }
    if (flag === '--session' || flag === '--issue') {
      const key = flag.slice(2);
      const ids = [value];
      while (args[index + 1] && !args[index + 1]!.startsWith('--')) {
        ids.push(args[++index]!);
      }
      flags[key] = [...(flags[key] as string[] ?? []), ...ids];
    } else if (flag === '--steps') {
      const number = Number(value);
      if (!Number.isInteger(number) || number < 1) {
        throw new ConfigError('--steps needs a positive integer');
      }
      flags.steps = number;
    } else {
      flags.goal = value;
    }
  }
  return flags;
}

/** The roles each command runs. A retest runs the explorer and the judge. */
function rolesFor(command: string, config: BughuntersConfig): AgentRole[] {
  switch (command) {
    case 'explore': return ['explorer'];
    case 'judge': case 'publish': return ['judge'];
    case 'retest': return ['explorer', 'judge'];
    case 'fix': return ['fixer', 'explorer', 'judge'];
    case 'patrol': return config.agents.fixer.enabled ? ['explorer', 'judge', 'fixer'] : ['explorer', 'judge'];
    default: return [];
  }
}

/**
 * Every role needs an LLM: stop before the app starts when one cannot reach
 * it, and say which decider will run, because no Jev key costs more.
 */
export function preflight(command: string, config: BughuntersConfig, env: NodeJS.ProcessEnv = process.env): string[] {
  const problems = rolesFor(command, config)
    .map((role) => runtimeProblem(role, config.agents[role].use, env))
    .filter((problem): problem is string => Boolean(problem));
  if (problems.length) throw new ConfigError(problems.join('\n'));
  return ['explore', 'patrol'].includes(command) ? [resolveDecider(config.decisions, env).reason] : [];
}

/** Owns lifecycle cleanup for a single agent command, including interrupted runs. */
export async function runAgentCommand(
  command: string,
  args: string[],
  root: string,
  config: BughuntersConfig,
  log: (message: string) => void,
): Promise<void> {
  const flags = parseAgentFlags(command, args);
  for (const line of preflight(command, config)) log(line);
  const workspace = new Workspace(root);
  if (command === 'patrol') {
    await runPatrol({ root, config, once: Boolean(flags.once), onLog: log });
    return;
  }
  if (command === 'publish') {
    const outcomes = await runPublisher(root, config, { onLog: log,
      issueIds: flags.issue as string[] | undefined, dryRun: Boolean(flags.dryRun) });
    if (!flags.dryRun) await syncGitHub(root, config, { onLog: log });
    log(`${outcomes.length} item(s) handled`);
    return;
  }
  const vars = new Vars(config.app.secrets);
  if (command === 'judge') {
    const recent = (await workspace.listSessions())
      .filter((item) => item.role === 'explorer')
      .slice(0, 1)
      .map((item) => item.id);
    const ids = flags.session as string[] | undefined ?? recent;
    if (!ids.length) throw new ConfigError('No explorer session to judge');
    const record = await workspace.startSession('judge');
    const session = new AgentSession(root, config, vars, record.id, 'judge', undefined, log);
    const outcome = await runJudge(session, createRuntime(config.agents.judge.use), { sessionIds: ids });
    log(outcome.summary ?? outcome.stop);
    return;
  }
  if (command === 'fix') {
    const proposals = await runFixCycle(root, config, { onLog: log,
      issueIds: flags.issue as string[] | undefined,
    });
    log(`${proposals.length} fix proposal(s)`);
    return;
  }
  if (command === 'retest') {
    const ids = flags.issue as string[] | undefined;
    if (ids?.length !== 1) throw new ConfigError('retest needs --issue <id>');
    const issue = await workspace.readIssue(ids[0]!);
    const fix = issue?.fixId ? await workspace.readFix(issue.fixId) : undefined;
    if (!issue || !fix) throw new ConfigError(`No existing fix for ${ids[0]}`);
    const result = await retestFix(root, config, issue, fix, (fix.retests?.length ?? 0) + 1, { onLog: log });
    applyRetest(config, fix, result);
    await workspace.saveFix(fix);
    log(`Retest: ${result.outcome} — ${result.reason}`);
    return;
  }
  let app: Awaited<ReturnType<typeof startApp>> | undefined;
  let driver: ReturnType<typeof createDriver> | undefined;
  let activeSession: AgentSession | undefined;
  const onSignal = () => {
    if (activeSession) {
      activeSession.cancelled = true;
    }
    log('Interrupt received; tearing down after the current operation.');
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  try {
    app = await startApp(config.app, { root, vars, emit: log });
    driver = createDriver(config, vars.resolve.bind(vars));
    await driver.connect();
    if (command === 'replay') {
      const record = await workspace.startSession('explorer');
      const session = new AgentSession(root, config, vars, record.id, 'explorer', driver, log);
      activeSession = session;
      const replay = await replayRoutine(session, String(flags.id));
      await workspace.endSession(record.id, {
        status: replay.ok ? 'finished' : 'failed',
        summary: replay.ok ? `Replayed ${flags.id}` : replay.error,
      });
      if (!replay.ok) throw new InfrastructureError(`Replay failed: ${replay.error}`);
      log(`Replayed ${flags.id}${replay.degraded ? ' (degraded)' : ''}`);
      return;
    }
    const record = await workspace.startSession('explorer');
    const session = new AgentSession(root, config, vars, record.id, 'explorer', driver, log);
    activeSession = session;
    const outcome = await runExplorer(session, createRuntime(config.agents.explorer.use), {
      goal: flags.goal as string | undefined,
      maxSteps: flags.steps as number | undefined,
    });
    log(outcome.summary ?? outcome.stop);
  } finally {
    try {
      try {
        await driver?.close();
      } finally {
        await app?.stop();
      }
    } finally {
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
    }
  }
}
