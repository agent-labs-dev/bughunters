import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { diffWithPixelmatch } from './pixelmatch.js';

const W = 60;
const H = 40;
let dir: string;

function writePng(name: string, patch?: { x: number; y: number; w: number; h: number }): string {
  const png = new PNG({ width: W, height: H });
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      png.data[i] = 240;
      png.data[i + 1] = 240;
      png.data[i + 2] = 240;
      png.data[i + 3] = 255;
    }
  }
  if (patch) {
    for (let y = patch.y; y < patch.y + patch.h; y++) {
      for (let x = patch.x; x < patch.x + patch.w; x++) {
        const i = (y * W + x) * 4;
        png.data[i] = 220;
        png.data[i + 1] = 30;
        png.data[i + 2] = 30;
      }
    }
  }
  const path = join(dir, name);
  writeFileSync(path, PNG.sync.write(png));
  return path;
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'autoqa-diff-'));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('diffWithPixelmatch', () => {
  it('reports two identical images as identical', async () => {
    // Regression: pixelmatch renders unchanged pixels as a dimmed copy of the
    // original unless diffMask is set, so scanning RGB marked every pixel as
    // changed and a clean screen failed its own baseline.
    const result = await diffWithPixelmatch({ baselinePath: writePng('a.png'), actualPath: writePng('b.png') });
    expect(result.identical).toBe(true);
    expect(result.changedPixels).toBe(0);
    expect(result.regions).toEqual([]);
  });

  it('counts exactly the changed pixels and locates the region', async () => {
    const result = await diffWithPixelmatch({
      baselinePath: writePng('base.png'),
      actualPath: writePng('changed.png', { x: 5, y: 5, w: 15, h: 10 }),
    });
    expect(result.changedPixels).toBe(150);
    expect(result.regions).toEqual([{ x: 5, y: 5, width: 15, height: 10 }]);
  });

  it('excludes a masked region from both the numerator and the denominator', async () => {
    const result = await diffWithPixelmatch({
      baselinePath: writePng('mb.png'),
      actualPath: writePng('mc.png', { x: 5, y: 5, w: 15, h: 10 }),
      masks: [{ selector: '.live', x: 0, y: 0, width: 30, height: 30 }],
    });
    expect(result.identical).toBe(true);
    expect(result.comparedPixels).toBe(W * H - 900);
    // The masked fraction travels with the result so a hollow test is visible.
    expect(result.maskedFraction).toBeCloseTo(900 / (W * H));
  });

  it('fails on a dimension change rather than comparing mismatched images', async () => {
    const tall = new PNG({ width: W, height: H * 2 });
    const tallPath = join(dir, 'tall.png');
    writeFileSync(tallPath, PNG.sync.write(tall));
    const result = await diffWithPixelmatch({ baselinePath: writePng('d.png'), actualPath: tallPath });
    expect(result.dimensionMismatch).toEqual({ baseline: [W, H], actual: [W, H * 2] });
  });
});
