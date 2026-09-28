import {
  horizontalScroll,
  layoutShift,
  occlusion,
  offViewport,
  overflow,
  overlap,
  zeroSizeInteractive,
} from './rules/layout.js';
import { brokenImagery, consoleErrors, contrast, tapTarget, unstyledContent } from './rules/usability.js';
import type { InvariantRule, InvariantViolation, ScreenSnapshot } from './types.js';

/**
 * The layout invariant engine. No mature open-source library does this, and it
 * is the highest-value deterministic check in the product (spec 5.2): it is
 * what turns "the diff is 4.3%" into a sentence an engineer can act on.
 */
export const RULES: InvariantRule[] = [
  occlusion,
  overlap,
  zeroSizeInteractive,
  offViewport,
  overflow,
  horizontalScroll,
  layoutShift,
  tapTarget,
  contrast,
  brokenImagery,
  unstyledContent,
  consoleErrors,
];

export const RULES_BY_ID = new Map(RULES.map((r) => [r.id, r]));

export type EvaluateOptions = {
  /** Rule ids to skip, from the Intent Ledger or config. */
  disabled?: string[];
  baseline?: ScreenSnapshot;
};

export function evaluateAll(snapshot: ScreenSnapshot, options: EvaluateOptions = {}): InvariantViolation[] {
  const disabled = new Set(options.disabled ?? []);
  const out: InvariantViolation[] = [];
  for (const rule of RULES) {
    if (disabled.has(rule.id)) continue;
    // A change-aware rule with no baseline has nothing to compare against;
    // running it anyway is how first-run avalanches happen.
    if (rule.changeAware && !options.baseline) continue;
    out.push(...rule.evaluate(snapshot, options.baseline));
  }
  return out.sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
}

function severityRank(s: InvariantViolation['severity']): number {
  return { cosmetic: 0, minor: 1, major: 2, critical: 3 }[s];
}
