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
