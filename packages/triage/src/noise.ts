import type { Finding } from '@bughunters/core';
import type { RootCauseGroup } from './cluster.js';

export type NoiseConfig = {
  /** Above this many new root causes, file one summary issue instead of N. */
  perRunIssueCap: number;
  /** Nothing blocks on a project's first approved run. */
  firstRunQuarantine: boolean;
  /** Failures to reproduce before a finding is quarantined. */
  flakeRetries: number;
};

export const DEFAULT_NOISE: NoiseConfig = {
  perRunIssueCap: 10,
  firstRunQuarantine: true,
  flakeRetries: 2,
};

export type NoiseDecision = {
  /** Groups that get their own issue. */
  individual: RootCauseGroup[];
  /** Groups folded into a single summary issue, if the cap was hit. */
  summarized: RootCauseGroup[];
  /** Whether anything at all may block this run. */
  blockingAllowed: boolean;
  notes: string[];
};

/**
 * Noise kills adoption faster than missed bugs. A tool reporting 40% false
 * positives is worse than no tool, because it trains engineers to ignore red
 * (spec 0.2). Everything here exists to keep the first encounter survivable.
 */
export function applyNoiseControls(
  groups: RootCauseGroup[],
  options: { isFirstRun: boolean; config?: NoiseConfig },
): NoiseDecision {
  const config = options.config ?? DEFAULT_NOISE;
  const notes: string[] = [];

  const ranked = [...groups].sort(
    (a, b) => severityRank(b.representative) - severityRank(a.representative) || b.screens.length - a.screens.length,
  );

  let individual = ranked;
  let summarized: RootCauseGroup[] = [];
  if (ranked.length > config.perRunIssueCap) {
    // A first-run avalanche is expected. It must not spam the repo.
    individual = ranked.slice(0, config.perRunIssueCap);
    summarized = ranked.slice(config.perRunIssueCap);
    notes.push(
      `${summarized.length} further root causes were folded into one summary issue (per-run cap is ${config.perRunIssueCap}).`,
    );
  }

  const blockingAllowed = !(options.isFirstRun && config.firstRunQuarantine);
  if (!blockingAllowed) {
    notes.push('First approved run: reporting only, nothing blocks.');
  }

  return { individual, summarized, blockingAllowed, notes };
}

export type FlakeRecord = { fingerprint: string; failures: number; reproductions: number };

/**
 * A finding that fails to reproduce on retry, twice, is quarantined: still
 * reported, never blocking. Quarantine is a signal that the baseline or the
 * determinism contract needs attention, and it is surfaced as such rather than
 * being quietly dropped.
 */
export function isQuarantined(record: FlakeRecord, config: NoiseConfig = DEFAULT_NOISE): boolean {
  return record.failures - record.reproductions >= config.flakeRetries;
}

export function flakeRate(record: FlakeRecord): number {
  if (record.failures === 0) return 0;
  return (record.failures - record.reproductions) / record.failures;
}

export function quarantine(finding: Finding): Finding {
  return { ...finding, status: 'quarantined', route: finding.route === 'check' ? 'issue' : finding.route };
}

function severityRank(f: Finding): number {
  return { cosmetic: 0, minor: 1, major: 2, critical: 3 }[f.severity];
}
