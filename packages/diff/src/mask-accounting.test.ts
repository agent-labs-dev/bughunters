import { describe, expect, it } from 'vitest';
import { boundingRegionsFromLines, isMasked, maskedPixelCount } from './mask-accounting.js';

describe('maskedPixelCount', () => {
  it('does not double-count overlapping masks', () => {
    const masks = [
      { selector: 'a', x: 0, y: 0, width: 10, height: 10 },
      { selector: 'b', x: 5, y: 5, width: 10, height: 10 },
    ];
    // 100 + 100 - 25 overlap = 175, not 200.
    expect(maskedPixelCount(masks, 100, 100)).toBe(175);
  });

  it('clamps masks to the image bounds', () => {
    const masks = [{ selector: 'a', x: 90, y: 90, width: 100, height: 100 }];
    expect(maskedPixelCount(masks, 100, 100)).toBe(100);
  });
});

describe('isMasked', () => {
  it('treats the mask box as half-open', () => {
    const masks = [{ selector: 'a', x: 0, y: 0, width: 10, height: 10 }];
    expect(isMasked(9, 9, masks)).toBe(true);
    expect(isMasked(10, 10, masks)).toBe(false);
  });
});

describe('boundingRegionsFromLines', () => {
  it('collapses contiguous rows into one region', () => {
    expect(boundingRegionsFromLines([4, 5, 6, 20, 21])).toEqual([
      { x: 0, y: 4, width: 0, height: 3 },
      { x: 0, y: 20, width: 0, height: 2 },
    ]);
  });
});
