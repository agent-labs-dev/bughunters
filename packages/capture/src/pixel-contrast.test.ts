import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { measurePixelContrast } from './pixel-contrast.js';

function image(
  width: number,
  height: number,
  bg: number[],
  fg?: { x: number; y: number; w: number; h: number; c: number[] },
): PNG {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const inFg = fg && x >= fg.x && x < fg.x + fg.w && y >= fg.y && y < fg.y + fg.h;
      const c = inFg ? fg!.c : bg;
      const i = (y * width + x) * 4;
      png.data[i] = c[0]!;
      png.data[i + 1] = c[1]!;
      png.data[i + 2] = c[2]!;
      png.data[i + 3] = 255;
    }
  }
  return png;
}

describe('measurePixelContrast', () => {
  it('measures black text on white as 21:1', () => {
    const png = image(40, 20, [255, 255, 255], { x: 10, y: 5, w: 6, h: 8, c: [0, 0, 0] });
    expect(measurePixelContrast(png, { x: 0, y: 0, width: 40, height: 20 }, 1)).toBeCloseTo(21, 0);
  });

  it('takes the most common colour as the background', () => {
    const png = image(40, 20, [29, 78, 216], { x: 10, y: 5, w: 6, h: 8, c: [243, 245, 238] });
    const measured = measurePixelContrast(png, { x: 0, y: 0, width: 40, height: 20 }, 1)!;
    expect(measured).toBeGreaterThan(4.5);
  });

  it('scales the box by the device pixel ratio', () => {
    const png = image(80, 40, [255, 255, 255], { x: 20, y: 10, w: 12, h: 16, c: [0, 0, 0] });
    expect(measurePixelContrast(png, { x: 0, y: 0, width: 40, height: 20 }, 2)).toBeCloseTo(21, 0);
  });

  it('returns nothing for a box too small to measure', () => {
    expect(
      measurePixelContrast(image(10, 10, [255, 255, 255]), { x: 0, y: 0, width: 1, height: 1 }, 1),
    ).toBeUndefined();
  });

  it('clamps a box that runs off the image', () => {
    const png = image(20, 20, [255, 255, 255], { x: 15, y: 15, w: 5, h: 5, c: [0, 0, 0] });
    expect(measurePixelContrast(png, { x: 10, y: 10, width: 100, height: 100 }, 1)).toBeCloseTo(21, 0);
  });
});
