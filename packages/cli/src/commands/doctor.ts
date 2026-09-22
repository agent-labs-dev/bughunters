import { existsSync } from 'node:fs';
import { ExitCode, paths, type AutoQAConfig, type ExitCodeValue } from '@autoqa/core';

export type DoctorCheck = { name: string; ok: boolean; detail: string; fatal: boolean };

/**
 * `autoqa doctor` verifies the determinism contract can actually be honoured
 * here. It runs before anything else because a baseline captured outside the
 * pinned image is worse than no baseline: it will diff against CI forever and
 * nobody will know why.
 */
export function runChecks(root: string, config: AutoQAConfig | undefined): DoctorCheck[] {
  const checks: DoctorCheck[] = [];

  checks.push({
    name: 'config',
    ok: existsSync(paths.config(root)),
    detail: existsSync(paths.config(root)) ? 'autoqa.yml found' : 'No autoqa.yml. Run `autoqa init`.',
    fatal: true,
  });

  const nodeMajor = Number(process.versions.node.split('.')[0]);
  checks.push({
    name: 'node',
    ok: nodeMajor >= 22,
    detail: `Node ${process.versions.node} (need >= 22)`,
    fatal: true,
  });

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
    detail: existsSync(paths.appModel(root)) ? 'AppModel present' : 'No AppModel. Run `autoqa recon`.',
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

export function doctorExitCode(checks: DoctorCheck[]): ExitCodeValue {
  return checks.some((c) => c.fatal && !c.ok) ? ExitCode.Usage : ExitCode.Clean;
}
