import { describe, expect, it } from 'vitest';
import { estimateDecisionCost } from './cache.js';

describe('estimateDecisionCost', () => {
  it('budgets a general model call', () => {
    expect(estimateDecisionCost(4_000)).toBeCloseTo(0.021);
  });
});
