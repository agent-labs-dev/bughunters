import { describe, expect, it } from 'vitest';
import { route, fixEligible, severityFrom } from './thresholds.js';
import type { Answer } from '@autoqa/core';

const thresholds = { high: 0.85, low: 0.55 };

function choice(value: string, confidence: number): Answer {
  return { kind: 'choice', value, probabilities: { [value]: confidence }, confidence };
}
function noul(value: number, confidence: number): Answer {
  return { kind: 'noul', value, confidence };
}

const base = { thresholds, hasDeterministicRegression: false, matchedLedger: false };

describe('route', () => {
  it('never auto-suppresses below the high threshold', () => {
    // The governing asymmetry: over-asking is fine, over-silencing is not.
    for (const confidence of [0.1, 0.5, 0.6, 0.84]) {
      const out = route({ ...base, answers: { route: choice('ignore', confidence) } });
      expect(out.route).toBe('question');
    }
  });

  it('suppresses only with high confidence', () => {
    expect(route({ ...base, answers: { route: choice('ignore', 0.95) } }).route).toBe('ignore');
  });

  it('downgrades a check to an issue when no deterministic regression backs it', () => {
    // A red build must always mean the same thing: tier-1 pixels changed.
    const out = route({ ...base, answers: { route: choice('check', 0.99) } });
    expect(out.route).toBe('issue');
  });

  it('allows a check when tier 1 fired', () => {
    const out = route({
      ...base,
      hasDeterministicRegression: true,
      answers: { route: choice('check', 0.99) },
    });
    expect(out.route).toBe('check');
  });

  it('escalates when the decider says it is out of its depth', () => {
    const out = route({ ...base, answers: { route: choice('ignore', 0.99), needs_frontier: noul(1, 0.9) } });
    expect(out.route).toBe('escalate');
  });

  it('asks a human when no routing answer came back at all', () => {
    expect(route({ ...base, answers: {} }).route).toBe('question');
  });

  it('honours a ledger match before anything else', () => {
    const out = route({ ...base, matchedLedger: true, answers: { route: choice('check', 0.99) } });
    expect(out.route).toBe('intent');
  });
});

describe('fixEligible', () => {
  it('refuses a fix below the high confidence threshold', () => {
    expect(fixEligible({ ...base, answers: { route: choice('issue', 0.8) } })).toBe(false);
  });

  it('refuses a fix the decider called ambiguous', () => {
    expect(
      fixEligible({ ...base, answers: { route: choice('issue', 0.99), needs_frontier: noul(1, 0.9) } }),
    ).toBe(false);
  });

  it('allows a fix on a confident, unambiguous, unsuppressed finding', () => {
    expect(fixEligible({ ...base, answers: { route: choice('issue', 0.99), needs_frontier: noul(0, 0.9) } })).toBe(true);
  });
});

describe('severityFrom', () => {
  it('maps a score answer onto the legend', () => {
    expect(
      severityFrom({ kind: 'score', value: 3, probabilities: [], confidence: 0.9, legend: ['cosmetic', 'minor', 'major', 'critical'] }),
    ).toBe('critical');
  });

  it('defaults to minor when no score came back', () => {
    expect(severityFrom(undefined)).toBe('minor');
  });
});

describe('offline gating', () => {
  it('still blocks on a deterministic regression when no decider ran', () => {
    // --no-models must keep working as a merge gate. The decision layer
    // classifies and suppresses; it does not grant permission to block.
    const out = route({ ...base, hasDeterministicRegression: true, answers: {} });
    expect(out.route).toBe('check');
  });

  it('does not invent a block when tier 1 was clean', () => {
    expect(route({ ...base, answers: {} }).route).toBe('question');
  });

  it('never lets a decider suppress or escalate a deterministic regression', () => {
    // The gate must be reproducible: the same pixels must block on every run,
    // whatever a non-deterministic decider answers.
    const answerSets: Record<string, Answer>[] = [
      { route: choice('intent', 0.99) },
      { route: choice('ignore', 0.99) },
      { route: choice('question', 0.22), needs_frontier: noul(0.62, 0.62) },
      { is_anomalous: noul(0.01, 0.99) },
    ];
    for (const answers of answerSets) {
      expect(route({ ...base, hasDeterministicRegression: true, answers }).route).toBe('check');
    }
  });

  it('lets only a ledger entry silence a deterministic regression', () => {
    const out = route({ ...base, hasDeterministicRegression: true, matchedLedger: true, answers: {} });
    expect(out.route).toBe('intent');
  });
});
