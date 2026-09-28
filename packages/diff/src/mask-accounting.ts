import type { RegionBox } from '@bugpatrol/core';
import type { MaskRegion } from './types.js';

export function isMasked(x: number, y: number, masks: MaskRegion[]): boolean {
  for (const m of masks) {
    if (x >= m.x && x < m.x + m.width && y >= m.y && y < m.y + m.height) return true;
  }
  return false;
}

/**
 * Masked area, de-overlapped. Masked pixels come out of the numerator AND the
 * denominator of the diff score (spec 7.5), so double-counting overlapping
 * masks would inflate the reported masked fraction and understate the risk.
 */
export function maskedPixelCount(masks: MaskRegion[], width: number, height: number): number {
  if (masks.length === 0 || width <= 0 || height <= 0) return 0;
  const seen = new Set<number>();
  for (const m of masks) {
    const x0 = Math.max(0, Math.floor(m.x));
    const y0 = Math.max(0, Math.floor(m.y));
    const x1 = Math.min(width, Math.ceil(m.x + m.width));
    const y1 = Math.min(height, Math.ceil(m.y + m.height));
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) seen.add(y * width + x);
  }
  return seen.size;
}

/** Coarse connected-component grouping. Feeds the fingerprint region signature. */
export function boundingRegions(pixels: Array<{ x: number; y: number }>, gridPx = 32): RegionBox[] {
  if (pixels.length === 0) return [];
  const cells = new Map<string, RegionBox>();
  for (const p of pixels) {
    const key = `${Math.floor(p.x / gridPx)},${Math.floor(p.y / gridPx)}`;
    const cell = cells.get(key);
    if (!cell) {
      cells.set(key, { x: p.x, y: p.y, width: 1, height: 1 });
      continue;
    }
    const right = Math.max(cell.x + cell.width, p.x + 1);
    const bottom = Math.max(cell.y + cell.height, p.y + 1);
    cell.x = Math.min(cell.x, p.x);
    cell.y = Math.min(cell.y, p.y);
    cell.width = right - cell.x;
    cell.height = bottom - cell.y;
  }
  return [...cells.values()].sort((a, b) => a.y - b.y || a.x - b.x);
}

/** odiff reports diff lines rather than pixels; collapse runs of rows into boxes. */
export function boundingRegionsFromLines(lines: number[]): RegionBox[] {
  if (lines.length === 0) return [];
  const sorted = [...lines].sort((a, b) => a - b);
  const out: RegionBox[] = [];
  let start = sorted[0]!;
  let prev = start;
  for (const line of sorted.slice(1)) {
    if (line - prev > 1) {
      out.push({ x: 0, y: start, width: 0, height: prev - start + 1 });
      start = line;
    }
    prev = line;
  }
  out.push({ x: 0, y: start, width: 0, height: prev - start + 1 });
  return out;
}
