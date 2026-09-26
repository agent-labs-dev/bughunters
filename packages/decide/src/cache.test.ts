import { describe, expect, it } from 'vitest';
import { estimateDecisionCost } from './cache.js';

describe('estimateDecisionCost', () => {
  it('prices a Jev decision by input size', () => {
    expect(estimateDecisionCost(4_000_000, 'jev')).toBeCloseTo(0.042);
  });

  it('budgets a general model call', () => {
    expect(estimateDecisionCost(4_000, 'model')).toBeCloseTo(0.021);
  });

});
