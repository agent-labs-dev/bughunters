import { describe, expect, it } from 'vitest';
import { estimateDecisionCost } from './cache.js';

describe('estimateDecisionCost', () => {
  it('prices a Jev decision by input size', () => {
    expect(estimateDecisionCost(4_000_000, 'jev')).toBeCloseTo(0.042);
  });

  it('charges nothing for deciders that make no paid call', () => {
    // A run on the heuristic decider must not report model spend: that number
    // is how someone checks whether a model was contacted at all.
    for (const decider of ['heuristic', 'local', 'model'] as const) {
      expect(estimateDecisionCost(4_000_000, decider)).toBe(0);
    }
  });
});
