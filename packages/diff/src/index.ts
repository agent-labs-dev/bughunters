import { diffWithOdiff, OdiffUnavailableError } from './engines/odiff.js';
import { diffWithPixelmatch } from './engines/pixelmatch.js';
import type { CrossCheckResult, DiffRequest, DiffResult } from './types.js';

export * from './types.js';
export * from './tolerance.js';
export * from './perceptual.js';
export * from './mask-accounting.js';
export { diffWithOdiff, diffWithPixelmatch, OdiffUnavailableError };

/** How far the two engines may disagree before the result is untrustworthy. */
const DISAGREEMENT_PIXELS = 4;

/**
 * odiff runs first because it is ~6.6x faster. pixelmatch only runs when the
 * result is non-trivial, and its job is to validate odiff rather than replace
 * it: a genuine disagreement between two engines that share a colour-distance
 * implementation means something is wrong with the capture, not the app, and
 * that should be reported as such rather than silently averaged.
 */
export async function diff(req: DiffRequest): Promise<CrossCheckResult> {
  let primary: DiffResult;
  try {
    primary = await diffWithOdiff(req);
  } catch (error) {
    if (!(error instanceof OdiffUnavailableError)) throw error;
    // The fast engine cannot start on this host. pixelmatch is the reference
    // implementation and produces the same verdict, so the run continues --
    // but the degradation is reported rather than hidden, because losing the
    // cross-check means a disagreement can no longer be detected.
    return {
      primary: await diffWithPixelmatch(req),
      agreed: true,
      degraded: `odiff is unavailable on this host, so only pixelmatch ran: ${error.message}`,
    };
  }

  if (primary.identical || primary.dimensionMismatch) {
    return { primary, agreed: true };
  }

  const crossCheck = await diffWithPixelmatch({ ...req, diffOutPath: undefined });
  const delta = Math.abs(primary.changedPixels - crossCheck.changedPixels);
  const agreed = delta <= DISAGREEMENT_PIXELS;

  return agreed ? { primary, agreed: true } : { primary, crossCheck, agreed: false };
}

export function summarize(result: DiffResult): string {
  if (result.dimensionMismatch) return 'screenshot dimensions changed';
  if (result.identical) return 'identical';
  return `${result.changedPixels} px changed in ${result.regions.length} region(s), ${(result.maskedFraction * 100).toFixed(1)}% masked`;
}
