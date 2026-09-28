import { createHash } from 'node:crypto';
import { InfrastructureError } from '@bugpatrol/core';
import type { Page } from 'playwright';

export type StabilityOptions = {
  consecutiveIdenticalFrames: number;
  intervalMs: number;
  timeoutMs: number;
};

export type StabilityResult = {
  frames: number;
  elapsedMs: number;
  hash: string;
};

/**
 * The difference between "we waited 2 seconds" and "the frame is stable".
 *
 * Polling sleeps are the single most common cause of intermittent visual
 * failures in existing tools (spec 7.3). Instead of a timeout, this captures
 * repeatedly until N consecutive frames are byte-identical, and on timeout it
 * raises an INFRASTRUCTURE error rather than letting an unstable frame become
 * a diff. Reporting "this screen never settled" is honest; reporting it as a
 * regression is not.
 */
export async function waitForStableFrame(page: Page, options: StabilityOptions): Promise<StabilityResult> {
  const started = Date.now();

  await page.evaluate(() => document.fonts.ready);

  let previous: string | undefined;
  let identical = 1;
  let frames = 0;

  while (Date.now() - started < options.timeoutMs) {
    const buffer = await page.screenshot({ animations: 'disabled', caret: 'hide' });
    const hash = createHash('sha256').update(buffer).digest('hex');
    frames++;

    if (hash === previous) {
      identical++;
      if (identical >= options.consecutiveIdenticalFrames) {
        return { frames, elapsedMs: Date.now() - started, hash };
      }
    } else {
      identical = 1;
      previous = hash;
    }

    await page.waitForTimeout(options.intervalMs);
  }

  throw new InfrastructureError(
    `The page at ${page.url()} never reached a stable frame within ${options.timeoutMs}ms (${frames} frames captured). ` +
      'Bugpatrol could not test this screen; this is not reported as a product regression.',
  );
}
