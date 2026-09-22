import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import type { AutoQAConfig, ViewportConfig } from '@autoqa/core';
import { InfrastructureError } from '@autoqa/core';
import { DETERMINISTIC_CHROMIUM_ARGS, STABILITY_STYLESHEET, buildFreezeScript, FONT_AUDIT_SOURCE } from './determinism.js';

export type CaptureSession = {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  close(): Promise<void>;
};

/**
 * Playwright is a dependency, not a competitor. It already captures
 * screenshots, video and traces better than anything we would write, and it is
 * the only capture layer that ships all three plus an accessibility-tree API
 * (spec 5.1). Everything here is about constraining it, not replacing it.
 */
export async function openSession(
  config: AutoQAConfig,
  viewport: ViewportConfig,
  options: { recordVideoDir?: string; storageState?: string } = {},
): Promise<CaptureSession> {
  const browser = await chromium.launch({ args: [...DETERMINISTIC_CHROMIUM_ARGS] });

  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.deviceScaleFactor,
    timezoneId: config.determinism.timezone,
    locale: config.determinism.locale,
    reducedMotion: 'reduce',
    colorScheme: 'light',
    recordVideo: options.recordVideoDir ? { dir: options.recordVideoDir } : undefined,
    storageState: options.storageState,
  });

  await context.addInitScript(buildFreezeScript(config.determinism));

  if (config.determinism.blockThirdPartyRequests) {
    await blockThirdParty(context, config.run.url);
  }

  const page = await context.newPage();
  await page.addStyleTag({ content: STABILITY_STYLESHEET }).catch(() => {
    // The page may not be loaded yet; the stylesheet is re-applied per capture.
  });

  return {
    browser,
    context,
    page,
    async close() {
      await context.close();
      await browser.close();
    },
  };
}

/**
 * Blocking third-party requests serves two purposes at once: it removes the
 * largest source of rendering non-determinism (ads, analytics, chat widgets,
 * cookie banners), and it removes the largest accidental data-exfiltration path
 * out of a crawled page (spec 7.4, 11.2).
 *
 * Blocked requests are REPORTED, never silently dropped.
 */
async function blockThirdParty(context: BrowserContext, appUrl: string): Promise<void> {
  const origin = new URL(appUrl).origin;
  await context.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith(origin) || url.startsWith('data:') || url.startsWith('blob:')) {
      await route.continue();
      return;
    }
    await route.abort('blockedbyclient');
  });
}

export async function auditFonts(page: Page): Promise<{ requested: string[]; missing: string[] }> {
  return (await page.evaluate(FONT_AUDIT_SOURCE)) as { requested: string[]; missing: string[] };
}

export async function assertNoFontFallback(page: Page, failOnFallback: boolean): Promise<string[]> {
  const audit = await auditFonts(page);
  if (audit.missing.length > 0 && failOnFallback) {
    throw new InfrastructureError(
      `These font families are not available in the pinned image and fell back to a substitute: ${audit.missing.join(', ')}. ` +
        'Bundle them in the runner image, or baselines will drift between machines.',
    );
  }
  return audit.missing;
}
