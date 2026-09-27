import { browserExecutablePath } from '@bughunters/capture';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { ExitCode, legacyLayout, paths, type BughuntersConfig, type ExitCodeValue } from '@bughunters/core';
import { runtimeProblem } from '@bughunters/agents';

export type DoctorCheck = { name: string; ok: boolean; detail: string; fatal: boolean };

/**
 * `bughunters doctor` verifies the determinism contract can actually be honoured
 * here. It runs before anything else because a baseline captured outside the
 * pinned image is worse than no baseline: it will diff against CI forever and
 * nobody will know why.
 */
type DoctorDeps = { platform?: NodeJS.Platform; browserPath?: () => string;
  command?: (command: string, args: string[]) => { status: number | null; stdout?: string } };
export function runChecks(root: string, config: BughuntersConfig | undefined, deps: DoctorDeps = {}): DoctorCheck[] {
  const checks: DoctorCheck[] = [];

  checks.push({
    name: 'config',
    ok: existsSync(paths.config(root)) && Boolean(config),
    detail: existsSync(paths.config(root))
      ? config ? `${paths.config(root)} parsed` : 'Config exists but is invalid. Check the YAML and schema before running agents.'
      : legacyLayout(root) ?? 'No .bughunters/bughunters.yml. Run `bughunters init`.',
    fatal: true,
  });

  const [nodeMajor = 0, nodeMinor = 0] = process.versions.node.split('.').map(Number);
  checks.push({
    name: 'node',
    ok: nodeMajor > 22 || (nodeMajor === 22 && nodeMinor >= 13),
    detail: `Node ${process.versions.node} (need >= 22.13)`,
    fatal: true,
  });

  const platform = deps.platform ?? process.platform;
  const command = deps.command ?? ((name, args) => spawnSync(name, args, { encoding: 'utf8', timeout: 5_000, maxBuffer: 1024 * 1024 }));
  checks.push({ name: 'platform', ok: ['linux', 'darwin'].includes(platform), fatal: true,
    detail: ['linux', 'darwin'].includes(platform) ? `Supported host: ${platform}` : 'Use Linux or macOS; Windows host process execution is not supported.' });
  if (config) {
    checks.push(...agentChecks(config));
    if (config.app.platform === 'web' || config.run) {
      const executable = (deps.browserPath ?? browserExecutablePath)();
      checks.push({ name: 'browser', ok: existsSync(executable), fatal: true,
        detail: existsSync(executable) ? 'The matching Chromium executable is installed.' : 'Install the matching browser: npx playwright@1.63.0 install chromium (Linux CI: add --with-deps).' });
    }
    if (config.app.platform === 'electron') checks.push({ name: 'electron-cdp', ok: Boolean(config.app.connect.cdp), fatal: true,
      detail: config.app.connect.cdp ? 'CDP endpoint configured; this check does not prove the app is reachable.' : 'Set app.connect.cdp and launch a test build with remote debugging enabled.' });
    if (['ios', 'android'].includes(config.app.platform)) {
      const maestro = command('maestro', ['--version']).status === 0;
      checks.push({ name: 'maestro', ok: maestro, fatal: true, detail: maestro ? 'Maestro is installed.' : 'Install Maestro and connect a test simulator/emulator before exploring.' });
      const ios = config.app.platform === 'ios';
      const bridge = ios ? platform === 'darwin' && command('xcrun', ['--find', 'simctl']).status === 0 : command('adb', ['get-state']).stdout?.trim() === 'device';
      checks.push({ name: ios ? 'ios-tools' : 'android-device', ok: Boolean(bridge), fatal: true,
        detail: bridge ? 'Platform bridge is available; confirm the configured app/device before running.' : ios ? 'iOS requires macOS, Xcode and a booted simulator.' : 'Start an Android emulator or connect a device and check adb get-state.' });
    }
    const fixer = config.agents.fixer;
    if (fixer.enabled) {
      const isolated = fixer.execution.mode === 'docker';
      const ok = !isolated || (fixer.use.runtime !== 'cli' && command('docker', ['info', '--format', '{{.ServerVersion}}']).status === 0);
      checks.push({ name: 'fixer-execution', ok, fatal: true, detail: ok ? isolated ? 'Docker is reachable; the worker image must contain the project tools.' : 'Trusted-host execution is explicitly enabled.' : fixer.use.runtime === 'cli' ? 'Choose a model fixer for Docker isolation or explicitly set execution.mode: trusted-host.' : 'Start Docker and ensure this user can reach its daemon.' });
    }
    for (const role of ['explorer', 'judge', 'fixer'] as const) {
      const settings = config.agents[role];
      if (settings.enabled && settings.use.runtime === 'cli' && settings.budgetUsd !== undefined) checks.push({ name: `${role}-budget`, ok: false, fatal: true, detail: 'CLI runtimes cannot enforce budgetUsd; configure time/step limits instead.' });
    }
  }
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

/** The checks that the agent commands need: an LLM for each agent, and gh for GitHub. */
function agentChecks(config: BughuntersConfig, env: NodeJS.ProcessEnv = process.env): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  const roles = (['explorer', 'judge', 'fixer'] as const)
    .filter((role) => config.agents[role].enabled);
  for (const role of roles) {
    const use = config.agents[role].use;
    const problem = runtimeProblem(role, use, env);
    const label = use.runtime === 'cli' ? `cli: ${use.agent ?? use.command.split(' ')[0]}` : `${use.via}: ${use.model ?? 'default model'}`;
    checks.push({ name: role, ok: !problem, detail: problem ?? `The ${role} uses ${label}`, fatal: true });
  }
  if (config.agents.github.enabled) {
    const installed = spawnSync('gh', ['--version'], { stdio: 'ignore', timeout: 5_000 }).status === 0;
    const loggedIn = installed && spawnSync('gh', ['auth', 'status'], { stdio: 'ignore', timeout: 5_000 }).status === 0;
    checks.push({ name: 'github', ok: loggedIn, fatal: false, detail: !installed
      ? 'agents.github is on, but the gh CLI is not installed. Install it from https://cli.github.com'
      : loggedIn ? 'gh is logged in' : 'agents.github is on, but gh is not logged in. Run `gh auth login`.' });
  }
  return checks;
}

export function doctorExitCode(checks: DoctorCheck[]): ExitCodeValue {
  return checks.some((c) => c.fatal && !c.ok) ? ExitCode.Usage : ExitCode.Clean;
}
