import type { Answer, Route } from '@bugpatrol/core';

export type Thresholds = { high: number; low: number };

export type RoutingInput = {
  answers: Record<string, Answer>;
  thresholds: Thresholds;
  /** Set when a tier-1 deterministic rule fired. Only these may block a merge. */
  hasDeterministicRegression: boolean;
  /** Set when a Ledger entry already covers this fingerprint. */
  matchedLedger: boolean;
};

export type RoutingOutcome = {
  route: Route | 'escalate';
  reason: string;
};

/**
 * The asymmetry here is the load-bearing safety property of the whole system:
 * Bugpatrol may be wrong about RAISING something, but it must never be wrong
 * about SILENCING something. A missed bug is recoverable; a suppressed real
 * bug is not.
 *
 * Concretely: auto-suppression and auto-fix both require high confidence,
 * while raising a question has no confidence floor at all.
 */
export function route(input: RoutingInput): RoutingOutcome {
  const { answers, thresholds } = input;

  if (input.matchedLedger) {
    return { route: 'intent', reason: 'A ledger entry already covers this finding.' };
  }

  // The gate is decided before any answer is read. A decider is
  // non-deterministic, so letting it suppress or escalate a tier-1 regression
  // would make the same pixels pass on one run and block on the next -- and a
  // red Check must always mean the same pixels changed (spec, "Routing").
  // Only a human-approved ledger entry, checked above, may silence one.
  if (input.hasDeterministicRegression) {
    return { route: 'check', reason: 'Deterministic tier-1 regression; the decision layer cannot override the gate.' };
  }

  const anomalous = answers['is_anomalous'];
  if (anomalous?.kind === 'noul' && anomalous.value < 0.5 && anomalous.confidence >= thresholds.high) {
    return { route: 'ignore', reason: 'Confidently not anomalous versus the modelled product.' };
  }

  const needsFrontier = answers['needs_frontier'];
  if (needsFrontier?.kind === 'noul' && needsFrontier.value >= 0.5) {
    return { route: 'escalate', reason: 'The decider flagged this as too ambiguous for a confident call.' };
  }

  const proposed = answers['route'];
  if (proposed?.kind !== 'choice') {
    return { route: 'question', reason: 'No routing answer was returned, so a human decides.' };
  }

  // Below the high threshold nothing is ever auto-suppressed or auto-blocked.
  if (proposed.confidence < thresholds.low) {
    return { route: 'question', reason: 'Confidence below the low threshold; always ask.' };
  }
  if (proposed.confidence < thresholds.high) {
    return { route: 'question', reason: 'Confidence between thresholds; ask rather than act.' };
  }

  if (proposed.value === 'intent' || proposed.value === 'ignore') {
    // Suppression requires high confidence. It has it here, or we would have
    // returned above.
    return { route: proposed.value, reason: 'High-confidence suppression.' };
  }

  if (proposed.value === 'check') {
    // Only a tier-1 deterministic regression may fail a Check, and those
    // returned above. A red build must always mean the same thing.
    return {
      route: 'issue',
      reason: 'Routed to a check, but no deterministic regression backs it, so it files an issue instead.',
    };
  }

  return { route: proposed.value as Route, reason: 'High-confidence routing decision.' };
}

/** Auto-fix preconditions that live in the decision layer (spec 6.1). */
export function fixEligible(input: RoutingInput): boolean {
  const proposed = input.answers['route'];
  const needsFrontier = input.answers['needs_frontier'];
  if (input.matchedLedger) return false;
  if (proposed?.kind !== 'choice' || proposed.confidence < input.thresholds.high) return false;
  if (needsFrontier?.kind === 'noul' && needsFrontier.value >= 0.5) return false;
  return true;
}

export function severityFrom(answer: Answer | undefined): 'cosmetic' | 'minor' | 'major' | 'critical' {
  if (answer?.kind !== 'score') return 'minor';
  const legend = answer.legend as Array<'cosmetic' | 'minor' | 'major' | 'critical'>;
  return legend[Math.max(0, Math.min(legend.length - 1, Math.round(answer.value)))] ?? 'minor';
}
