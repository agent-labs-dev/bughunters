import { describe, expect, it } from 'vitest';
import { evaluate } from './tolerance.js';
import type { DiffResult } from './types.js';

const base: DiffResult = {
  engine: 'odiff',
  identical: true,
  changedPixels: 0,
  changedFraction: 0,
  comparedPixels: 1_000_000,
  totalPixels: 1_000_000,
  maskedFraction: 0,
  maskedRegionCount: 0,
  regions: [],
  durationMs: 1,
};

describe('evaluate', () => {
  it('passes on an identical capture', () => {
    expect(evaluate(base).pass).toBe(true);
  });

  it('fails on a dimension change without reporting a meaningless percentage', () => {
    const v = evaluate({ ...base, identical: false, dimensionMismatch: { baseline: [1440, 900], actual: [1440, 1200] } });
    expect(v.pass).toBe(false);
    expect(v.reason).toContain('changed size');
  });

  it('flags a heavily masked screen as a hollow test even when it passes', () => {
    // A 60%-masked diff is not a passing diff; the report has to say so.
    const v = evaluate({ ...base, maskedFraction: 0.6, maskedRegionCount: 3 });
    expect(v.pass).toBe(true);
    expect(v.flags.join(' ')).toContain('hollow-test');
  });

  it('flags a region that is both masked and tolerance-relaxed', () => {
    const v = evaluate({ ...base, maskedRegionCount: 1 }, { relaxedRegionSelectors: ['.chart'] });
    expect(v.flags.join(' ')).toContain('masked-and-relaxed');
  });

  it('names the consequence rather than only the pixel count', () => {
    const v = evaluate({ ...base, identical: false, changedPixels: 4200, changedFraction: 0.0042, regions: [{ x: 0, y: 0, width: 10, height: 10 }] });
    expect(v.pass).toBe(false);
    expect(v.reason).toMatch(/region/);
  });
});
