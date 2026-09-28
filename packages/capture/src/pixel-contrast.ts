import { PNG } from 'pngjs';
import { contrastRatio, parseColor, requiredContrast } from '@bugpatrol/invariants';
import type { ElementGeometry } from '@bugpatrol/core';

type Box = { x: number; y: number; width: number; height: number };

/**
 * Measures the contrast of text as it actually rendered, from the screenshot.
 *
 * Reconstructing "what is behind this text" from the DOM is unreliable in ways
 * that cannot be fully fixed: decorative layers set `pointer-events: none` and
 * drop out of `elementsFromPoint`, heroes are positioned siblings rather than
 * ancestors, and gradients, images and blend modes have no single colour. The
 * pixels have none of those problems.
 *
 * The background is the most common colour in the text's box and the
 * foreground is the pixel furthest from it. That is a LOWER bound on the true
 * text contrast, because anti-aliasing only ever blends glyph pixels toward the
 * background -- so a pixel measurement at or above the threshold proves the text
 * passes, whatever the DOM said.
 */
export function measurePixelContrast(png: PNG, box: Box, deviceScaleFactor: number): number | undefined {
  const x0 = Math.max(0, Math.floor(box.x * deviceScaleFactor));
  const y0 = Math.max(0, Math.floor(box.y * deviceScaleFactor));
  const x1 = Math.min(png.width, Math.ceil((box.x + box.width) * deviceScaleFactor));
  const y1 = Math.min(png.height, Math.ceil((box.y + box.height) * deviceScaleFactor));
  if (x1 - x0 < 2 || y1 - y0 < 2) return undefined;

  const counts = new Map<number, number>();
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * png.width + x) * 4;
      const key = (png.data[i]! << 16) | (png.data[i + 1]! << 8) | png.data[i + 2]!;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  let bgKey = 0;
  let bgCount = -1;
  for (const [key, count] of counts) {
    if (count > bgCount) {
      bgKey = key;
      bgCount = count;
    }
  }
  const bg: [number, number, number] = [(bgKey >> 16) & 255, (bgKey >> 8) & 255, bgKey & 255];

  let best = 1;
  for (const key of counts.keys()) {
    const ratio = contrastRatio([(key >> 16) & 255, (key >> 8) & 255, key & 255], bg);
    if (ratio > best) best = ratio;
  }
  return best;
}

function intersects(a: Box, b: Box): boolean {
  return !(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);
}

/**
 * Attaches a pixel measurement to every element whose DOM-computed contrast
 * fails, so the contrast rule can drop the ones the rendered page disproves.
 * Only failing elements are measured: the pixels are there to overrule false
 * alarms, and measuring every passing element would cost time for nothing.
 */
export function confirmContrastWithPixels(
  elements: ElementGeometry[],
  screenshot: Buffer,
  options: { deviceScaleFactor: number; masks: Box[]; scroll?: { x: number; y: number } },
): void {
  let png: PNG | undefined;
  for (const e of elements) {
    if (!e.visible) continue;
    const fg = parseColor(e.color);
    const bg = parseColor(e.backgroundColor);
    if (!fg || !bg) continue;
    if (contrastRatio(fg, bg) >= requiredContrast(e.fontSize)) continue;

    const box = {
      x: e.box.x + (options.scroll?.x ?? 0),
      y: e.box.y + (options.scroll?.y ?? 0),
      width: e.box.width,
      height: e.box.height,
    };
    // Masked regions are painted over by the capture, so their pixels say
    // nothing about the text underneath.
    if (options.masks.some((m) => intersects(m, box))) continue;

    png ??= PNG.sync.read(screenshot);
    const measured = measurePixelContrast(png, box, options.deviceScaleFactor);
    if (measured !== undefined) e.pixelContrast = measured;
  }
}
