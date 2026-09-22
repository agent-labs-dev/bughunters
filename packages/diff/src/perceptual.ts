import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';

export type PerceptualScore = {
  /** 1.0 is identical. Below ~0.99 is usually visible to a person. */
  ssim: number;
  /** Reported alongside the exact diff, never instead of it (spec 7.6). */
  interpretation: 'imperceptible' | 'subtle' | 'obvious';
};

const WINDOW = 8;
const C1 = (0.01 * 255) ** 2;
const C2 = (0.03 * 255) ** 2;

/**
 * A windowed SSIM over the luma channel. This exists to separate anti-aliasing
 * noise from real change: a font-rendering shift touching 500 pixels can score
 * 0.998, which is the correct answer for "did a user notice?" and the wrong
 * answer for "did the pixels change?".
 *
 * It is a SECOND SIGNAL. It never relaxes the tier-1 gate.
 */
export function ssim(baselinePath: string, actualPath: string): PerceptualScore {
  const a = PNG.sync.read(readFileSync(baselinePath));
  const b = PNG.sync.read(readFileSync(actualPath));
  if (a.width !== b.width || a.height !== b.height) {
    return { ssim: 0, interpretation: 'obvious' };
  }

  const lumaA = toLuma(a.data, a.width, a.height);
  const lumaB = toLuma(b.data, b.width, b.height);

  let total = 0;
  let windows = 0;
  for (let y = 0; y + WINDOW <= a.height; y += WINDOW) {
    for (let x = 0; x + WINDOW <= a.width; x += WINDOW) {
      total += windowSsim(lumaA, lumaB, a.width, x, y);
      windows++;
    }
  }

  const score = windows === 0 ? 1 : total / windows;
  return { ssim: score, interpretation: interpret(score) };
}

function interpret(score: number): PerceptualScore['interpretation'] {
  if (score >= 0.995) return 'imperceptible';
  if (score >= 0.97) return 'subtle';
  return 'obvious';
}

function toLuma(data: Buffer, width: number, height: number): Float64Array {
  const out = new Float64Array(width * height);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    out[i] = 0.2126 * data[p]! + 0.7152 * data[p + 1]! + 0.0722 * data[p + 2]!;
  }
  return out;
}

function windowSsim(a: Float64Array, b: Float64Array, width: number, ox: number, oy: number): number {
  const n = WINDOW * WINDOW;
  let sumA = 0;
  let sumB = 0;
  for (let y = 0; y < WINDOW; y++) {
    for (let x = 0; x < WINDOW; x++) {
      const i = (oy + y) * width + ox + x;
      sumA += a[i]!;
      sumB += b[i]!;
    }
  }
  const meanA = sumA / n;
  const meanB = sumB / n;

  let varA = 0;
  let varB = 0;
  let cov = 0;
  for (let y = 0; y < WINDOW; y++) {
    for (let x = 0; x < WINDOW; x++) {
      const i = (oy + y) * width + ox + x;
      const da = a[i]! - meanA;
      const db = b[i]! - meanB;
      varA += da * da;
      varB += db * db;
      cov += da * db;
    }
  }
  varA /= n - 1;
  varB /= n - 1;
  cov /= n - 1;

  return (
    ((2 * meanA * meanB + C1) * (2 * cov + C2)) /
    ((meanA ** 2 + meanB ** 2 + C1) * (varA + varB + C2))
  );
}
