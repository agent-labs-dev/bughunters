import type { ElementGeometry } from '@autoqa/core';

export type Box = { x: number; y: number; width: number; height: number };

export function intersects(a: Box, b: Box): boolean {
  return !(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);
}

export function intersectionArea(a: Box, b: Box): number {
  if (!intersects(a, b)) return 0;
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w * h;
}

export function area(b: Box): number {
  return b.width * b.height;
}

export function centre(b: Box): { x: number; y: number } {
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

export function visibleInteractive(elements: ElementGeometry[]): ElementGeometry[] {
  return elements.filter((e) => e.visible && e.interactive);
}

/** Relative luminance, per WCAG 2.x. */
export function luminance(rgb: [number, number, number]): number {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}

export function contrastRatio(fg: [number, number, number], bg: [number, number, number]): number {
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

export function parseColor(value: string | undefined): [number, number, number] | undefined {
  if (!value) return undefined;
  const m = value.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1]!, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  return undefined;
}

/** WCAG 2.x AA: 3:1 for large text (>= 24px), 4.5:1 otherwise. */
export function requiredContrast(fontSize: number | undefined): number {
  return (fontSize ?? 16) >= 24 ? 3 : 4.5;
}
