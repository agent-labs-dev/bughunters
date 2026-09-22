import { createHash } from 'node:crypto';

export function sha256(input: string | Uint8Array): string {
  return createHash('sha256').update(input).digest('hex');
}

/** Short, stable, readable in a GitHub comment. */
export function shortHash(input: string, length = 12): string {
  return sha256(input).slice(0, length);
}

export type RegionBox = { x: number; y: number; width: number; height: number };

export type FingerprintInput = {
  screenId: string;
  ruleId: string;
  regions?: RegionBox[];
  domNodeSignature?: string;
};

/**
 * Grid size, in CSS px, used to bucket diff regions. Deliberately coarse: a
 * finding that shifts by a few pixels must keep its identity rather than
 * re-reporting as new, otherwise suppression, dedup and flake history all
 * break (spec 4.1).
 */
export const REGION_GRID_PX = 32;

export function normalizeRegionSignature(regions: RegionBox[] = [], grid = REGION_GRID_PX): string {
  if (regions.length === 0) return 'none';
  const buckets = new Set<string>();
  for (const r of regions) {
    const x0 = Math.floor(r.x / grid);
    const y0 = Math.floor(r.y / grid);
    const x1 = Math.floor((r.x + r.width) / grid);
    const y1 = Math.floor((r.y + r.height) / grid);
    buckets.add(`${x0},${y0},${x1},${y1}`);
  }
  return [...buckets].sort().join('|');
}

const FIELD_SEPARATOR = String.fromCharCode(0);

/**
 * fingerprint = hash(screenId, ruleId, normalizedRegionSignature, domNodeSignature)
 *
 * The one property that matters: it must survive across runs. Everything
 * downstream -- the Intent Ledger, clustering, flake quarantine -- is keyed on
 * it, so instability here silently degrades all three.
 */
export function fingerprint(input: FingerprintInput): string {
  const parts = [
    input.screenId,
    input.ruleId,
    normalizeRegionSignature(input.regions),
    input.domNodeSignature ?? 'none',
  ];
  return shortHash(parts.join(FIELD_SEPARATOR), 16);
}

/** hash(content) + imageDigest. An image change invalidates the baseline. */
export function baselineKey(contentHash: string, imageDigest: string): string {
  return `${contentHash}@${imageDigest}`;
}
