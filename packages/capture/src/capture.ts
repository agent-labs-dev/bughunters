import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Page } from 'playwright';
import type { BugpatrolConfig, MaskConfig, ViewportConfig } from '@bugpatrol/core';
import { sha256 } from '@bugpatrol/core';
import { PROBE_SOURCE, type ScreenSnapshot } from '@bugpatrol/invariants';
import { STABILITY_STYLESHEET } from './determinism.js';
import { waitForStableFrame } from './stability-gate.js';
import { assertNoFontFallback } from './browser.js';
import { confirmContrastWithPixels } from './pixel-contrast.js';

export type CaptureRequest = {
  screenId: string;
  url: string;
  viewport: ViewportConfig;
  outPath: string;
  fullPage?: boolean;
};

export type CaptureOutput = {
  screenId: string;
  viewport: string;
  path: string;
  sha256: string;
  snapshot: ScreenSnapshot;
  /** Surfaced next to every diff so a hollow test is visible as one. */
  masks: Array<{ selector: string; x: number; y: number; width: number; height: number }>;
  stability: { frames: number; elapsedMs: number };
  missingFonts: string[];
};

export async function captureScreen(
  page: Page,
  config: BugpatrolConfig,
  request: CaptureRequest,
): Promise<CaptureOutput> {
  await page.goto(request.url, { waitUntil: 'load' });
  await page.addStyleTag({ content: STABILITY_STYLESHEET });

  const missingFonts = await assertNoFontFallback(page, config.determinism.failOnFontFallback);
  const stability = await waitForStableFrame(page, config.determinism.stabilityGate);

  const masks = await resolveMasks(page, config.mask, request.url);
  const consoleErrors = collectedErrors.get(page) ?? [];

  mkdirSync(dirname(request.outPath), { recursive: true });
  const buffer = await page.screenshot({
    path: request.outPath,
    fullPage: request.fullPage ?? true,
    animations: 'disabled',
    caret: 'hide',
    // Playwright paints over masked elements. Bugpatrol still records the geometry
    // so the masked fraction can be reported rather than silently applied.
    mask: masks.map((m) => page.locator(m.selector)),
  });

  const probe = (await page.evaluate(PROBE_SOURCE)) as Omit<ScreenSnapshot, 'screenId' | 'viewport' | 'consoleErrors'> & {
    document: ScreenSnapshot['document'] & { scrollX?: number; scrollY?: number };
  };

  // Element boxes are viewport-relative; the full-page screenshot is in page
  // coordinates, so the scroll offset joins them.
  confirmContrastWithPixels(probe.elements, buffer, {
    deviceScaleFactor: request.viewport.deviceScaleFactor ?? 1,
    masks,
    scroll: { x: probe.document.scrollX ?? 0, y: probe.document.scrollY ?? 0 },
  });

  return {
    screenId: request.screenId,
    viewport: request.viewport.name,
    path: request.outPath,
    sha256: sha256(buffer),
    masks,
    stability: { frames: stability.frames, elapsedMs: stability.elapsedMs },
    missingFonts,
    snapshot: {
      ...probe,
      screenId: request.screenId,
      viewport: { name: request.viewport.name, width: request.viewport.width, height: request.viewport.height },
      consoleErrors,
    },
  };
}

async function resolveMasks(page: Page, masks: MaskConfig[], url: string) {
  const out: Array<{ selector: string; x: number; y: number; width: number; height: number }> = [];
  for (const mask of masks) {
    if (mask.screen && !url.includes(mask.screen)) continue;
    const boxes = await page
      .locator(mask.selector)
      .all()
      .catch(() => []);
    for (const locator of boxes) {
      const box = await locator.boundingBox().catch(() => null);
      if (box) out.push({ selector: mask.selector, ...box });
    }
  }
  return out;
}

const collectedErrors = new WeakMap<Page, string[]>();

/** Attach once per page. Console errors feed a tier-1 detector. */
export function watchConsole(page: Page): void {
  const errors: string[] = [];
  collectedErrors.set(page, errors);
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(`${error.name}: ${error.message}`));
}
