import { expect, it } from 'vitest';
import { formatCost } from './ui/cost.js';
it('distinguishes confirmed zero cost from missing or partial billing data', () => {
  expect(formatCost(0, true)).toBe('$0.000');
  expect(formatCost(0, false)).toBe('unknown');
  expect(formatCost(0.25, undefined)).toBe('unknown');
  expect(formatCost(NaN, true)).toBe('unknown');
  expect(formatCost(0.25, true)).toBe('$0.250');
});
