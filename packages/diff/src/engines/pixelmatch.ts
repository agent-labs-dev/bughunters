import { readFileSync, writeFileSync } from 'node:fs';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { boundingRegions, isMasked, maskedPixelCount } from '../mask-accounting.js';
import type { DiffRequest, DiffResult, MaskRegion } from '../types.js';

/**
 * The reference implementation. ISC-licensed, pixel-exact, a few hundred lines.
 * Bugpatrol uses it as the cross-check on an odiff disagreement rather than as the
 * primary, because it is roughly 6.6x slower on full-page screenshots and this
 * tool is meant to run constantly (spec 5.2).
 */
export async function diffWithPixelmatch(req: DiffRequest): Promise<DiffResult> {
  const started = performance.now();
  const baseline = PNG.sync.read(readFileSync(req.baselinePath));
  const actual = PNG.sync.read(readFileSync(req.actualPath));
  const masks = req.masks ?? [];

  if (baseline.width !== actual.width || baseline.height !== actual.height) {
    return {
      engine: 'pixelmatch',
      identical: false,
      changedPixels: baseline.width * baseline.height,
      changedFraction: 1,
      comparedPixels: 0,
      totalPixels: baseline.width * baseline.height,
      maskedFraction: 0,
      maskedRegionCount: masks.length,
      regions: [],
      dimensionMismatch: {
        baseline: [baseline.width, baseline.height],
        actual: [actual.width, actual.height],
      },
      durationMs: performance.now() - started,
    };
  }

  const { width, height } = baseline;
  const diff = new PNG({ width, height });

  pixelmatch(baseline.data, actual.data, diff.data, width, height, {
    threshold: req.threshold ?? 0,
    // `antialiasing: true` means "do not count antialiased pixels", matching
    // odiff's option of the same name. pixelmatch spells the inverse, so the
    // two engines only agree if this is negated.
    includeAA: !(req.antialiasing ?? false),
    // Without diffMask, pixelmatch renders unchanged pixels as a dimmed copy of
    // the original rather than leaving them blank, so scanning the RGB channels
    // marks every pixel as changed. diffMask makes unchanged pixels fully
    // transparent, which is the only reliable per-pixel signal.
    diffMask: true,
  });

  // Masked pixels are excluded after the fact rather than pre-painted, so the
  // mask never itself becomes a source of difference between the two images.
  const changed: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = diff.data[(y * width + x) * 4 + 3];
      if (alpha === 0) continue;
      if (isMasked(x, y, masks)) continue;
      changed.push({ x, y });
    }
  }

  if (req.diffOutPath) writeFileSync(req.diffOutPath, PNG.sync.write(diff));

  return finalize('pixelmatch', changed, width, height, masks, started, req.diffOutPath);
}

export function finalize(
  engine: DiffResult['engine'],
  changed: Array<{ x: number; y: number }>,
  width: number,
  height: number,
  masks: MaskRegion[],
  started: number,
  diffImagePath?: string,
): DiffResult {
  const totalPixels = width * height;
  const masked = maskedPixelCount(masks, width, height);
  const comparedPixels = Math.max(1, totalPixels - masked);
  return {
    engine,
    identical: changed.length === 0,
    changedPixels: changed.length,
    changedFraction: changed.length / comparedPixels,
    comparedPixels,
    totalPixels,
    maskedFraction: masked / totalPixels,
    maskedRegionCount: masks.length,
    regions: boundingRegions(changed),
    diffImagePath,
    durationMs: performance.now() - started,
  };
}
