import type { RegionBox } from '@bughunters/core';

export type DiffEngineName = 'odiff' | 'pixelmatch';

export type MaskRegion = RegionBox & { selector: string };

export type DiffRequest = {
  baselinePath: string;
  actualPath: string;
  diffOutPath?: string;
  /** Resolved mask geometry. Excluded from BOTH numerator and denominator. */
  masks?: MaskRegion[];
  /** Colour distance threshold, 0-1. Ignored by the exact gate. */
  threshold?: number;
  antialiasing?: boolean;
};

/**
 * A diff score is never the only number reported (spec 7.6). Raw pixel delta,
 * perceptual score, masked percentage and region count all travel together, so
 * a human can see when a green result is green because the test got weaker
 * rather than because the app got better.
 */
export type DiffResult = {
  engine: DiffEngineName;
  /** True when the images are pixel-identical outside the masked regions. */
  identical: boolean;
  changedPixels: number;
  /** Fraction of the UNMASKED area that changed. */
  changedFraction: number;
  comparedPixels: number;
  totalPixels: number;
  /** Surfaced next to every diff. A 60%-masked diff is a hollow test. */
  maskedFraction: number;
  maskedRegionCount: number;
  regions: RegionBox[];
  /** Set when the two images have different dimensions -- always a failure. */
  dimensionMismatch?: { baseline: [number, number]; actual: [number, number] };
  diffImagePath?: string;
  durationMs: number;
};

export type CrossCheckResult = {
  primary: DiffResult;
  /** Only populated when the primary and the reference implementation disagree. */
  crossCheck?: DiffResult;
  agreed: boolean;
  /**
   * Set when the comparison ran in a reduced configuration -- for example when
   * odiff's native binary could not start and only pixelmatch ran. Surfaced in
   * the report: a result produced by a weaker setup must say so.
   */
  degraded?: string;
};
