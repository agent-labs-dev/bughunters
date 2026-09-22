import type { ToleranceConfig } from '@autoqa/core';
import type { DiffResult } from './types.js';

export type ToleranceVerdict = {
  pass: boolean;
  /** Why, in a sentence that names a consequence (spec 8.8). */
  reason: string;
  /** The highest-risk configuration: a region both masked AND relaxed. */
  flags: string[];
};

export type RegionTolerance = {
  screen: string;
  selector: string;
  mode: 'exact' | 'perceptual';
  threshold: number;
  reason?: string;
};

export function regionTolerancesFor(config: ToleranceConfig, screenPattern: string): RegionTolerance[] {
  return config.regions.filter((r) => r.screen === screenPattern || r.screen === '*');
}

/**
 * The tier-1 gate is exact by default and there is no global threshold knob.
 * The research is blunt about why: every tool that ships one has a user who
 * turned it up until the build went green, and a documented case of a
 * zero-threshold config reporting a completely missing button as PASSING.
 *
 * Perceptual scores are reported alongside the exact verdict, never in place
 * of it.
 */
export function evaluate(
  diff: DiffResult,
  opts: { maskedFractionWarnAt?: number; relaxedRegionSelectors?: string[] } = {},
): ToleranceVerdict {
  const flags: string[] = [];
  const warnAt = opts.maskedFractionWarnAt ?? 0.25;

  if (diff.maskedFraction >= warnAt) {
    flags.push(
      `hollow-test: ${(diff.maskedFraction * 100).toFixed(1)}% of this screen is masked and was never compared`,
    );
  }
  if ((opts.relaxedRegionSelectors?.length ?? 0) > 0 && diff.maskedRegionCount > 0) {
    flags.push('masked-and-relaxed: a region is both masked and tolerance-relaxed');
  }

  if (diff.dimensionMismatch) {
    return {
      pass: false,
      reason: `The screenshot changed size (${diff.dimensionMismatch.baseline.join('x')} to ${diff.dimensionMismatch.actual.join('x')}), so the page layout changed at the document level.`,
      flags,
    };
  }

  if (diff.identical) {
    return { pass: true, reason: 'Pixel-identical to the baseline outside masked regions.', flags };
  }

  return {
    pass: false,
    reason: `${diff.changedPixels} pixels changed across ${diff.regions.length} region(s) (${(diff.changedFraction * 100).toFixed(3)}% of the compared area).`,
    flags,
  };
}
