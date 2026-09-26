import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { ExitCode, legacyLayout, paths, type BughuntersConfig, type ExitCodeValue } from '@bughunters/core';
import { runtimeProblem } from '@bughunters/agents';
import { resolveDecider } from '@bughunters/decide';

export type DoctorCheck = { name: string; ok: boolean; detail: string; fatal: boolean };

/**
 * `bughunters doctor` verifies the determinism contract can actually be honoured
 * here. It runs before anything else because a baseline captured outside the
 * pinned image is worse than no baseline: it will diff against CI forever and
 * nobody will know why.
 */
export function runChecks(root: string, config: BughuntersConfig | undefined): DoctorCheck[] {
  const checks: DoctorCheck[] = [];

  checks.push({
    name: 'config',
    ok: existsSync(paths.config(root)),
    detail: existsSync(paths.config(root))
      ? `${paths.config(root)} found`
      : legacyLayout(root) ?? 'No .bughunters/bughunters.yml. Run `bughunters init`.',
    fatal: true,
  });

  const nodeMajor = Number(process.versions.node.split('.')[0]);
  checks.push({
    name: 'node',
    ok: nodeMajor >= 22,
    detail: `Node ${process.versions.node} (need >= 22)`,
    fatal: true,
  });

  if (config) checks.push(...agentChecks(config));
  // The pinned image and the AppModel belong to the deterministic web gate
  // (`bughunters run`). They do not apply to the agents.
  if (config && !config.run) return checks;

  const image = config?.determinism.image ?? '';
  const pinned = image.includes('@sha256:');
  checks.push({
    name: 'pinned-image',
    ok: pinned,
    detail: pinned
      ? `Runner image pinned: ${image}`
      : 'determinism.image is not pinned by digest. Baselines captured outside a pinned image will drift against CI.',
    // Not fatal locally -- the local loop is useful without it -- but CI
    // refuses to publish baselines from an unpinned image.
    fatal: false,
  });

  checks.push({
    name: 'app-model',
    ok: existsSync(paths.appModel(root)),
    detail: existsSync(paths.appModel(root)) ? 'AppModel present' : 'No AppModel. Run `bughunters recon`.',
    fatal: false,
  });

  checks.push({
    name: 'intent-ledger',
    ok: true,
    detail: existsSync(paths.intents(root)) ? 'Intent Ledger present' : 'No Intent Ledger yet (created on first accept)',
    fatal: false,
  });

  return checks;
}

/** The checks that the agent commands need: an LLM for each agent, the decider, and gh for GitHub. */
function agentChecks(config: BughuntersConfig, env: NodeJS.ProcessEnv = process.env): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  const roles = (['explorer', 'judge', 'fixer'] as const)
    .filter((role) => role !== 'fixer' || config.agents.fixer.enabled);
  for (const role of roles) {
    const use = config.agents[role].use;
    const problem = runtimeProblem(role, use, env);
    const label = use.runtime === 'cli' ? `cli: ${use.agent ?? use.command.split(' ')[0]}` : `${use.via}: ${use.model ?? 'default model'}`;
    checks.push({ name: role, ok: !problem, detail: problem ?? `The ${role} uses ${label}`, fatal: true });
  }
  const decider = resolveDecider(config.decisions, env as Record<string, string>);
  checks.push({ name: 'decider', ok: Boolean(decider.decider), detail: decider.reason, fatal: false });
  if (config.agents.github.enabled) {
    const installed = spawnSync('gh', ['--version'], { stdio: 'ignore' }).status === 0;
    const loggedIn = installed && spawnSync('gh', ['auth', 'status'], { stdio: 'ignore' }).status === 0;
    checks.push({ name: 'github', ok: loggedIn, fatal: false, detail: !installed
      ? 'agents.github is on, but the gh CLI is not installed. Install it from https://cli.github.com'
      : loggedIn ? 'gh is logged in' : 'agents.github is on, but gh is not logged in. Run `gh auth login`.' });
  }
  return checks;
}

export function doctorExitCode(checks: DoctorCheck[]): ExitCodeValue {
  return checks.some((c) => c.fatal && !c.ok) ? ExitCode.Usage : ExitCode.Clean;
}
