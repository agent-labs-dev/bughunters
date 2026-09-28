import type { BugpatrolConfig, ViewportConfig } from '@bugpatrol/core';
import { InfrastructureError, requireRun } from '@bugpatrol/core';
import { type Browser, type BrowserContext, chromium, type Page } from 'playwright';
import {
  buildFreezeScript,
  DETERMINISTIC_CHROMIUM_ARGS,
  FONT_AUDIT_SOURCE,
  type FontAudit,
  STABILITY_STYLESHEET,
} from './determinism.js';

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
  config: BugpatrolConfig,
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
    await blockThirdParty(context, requireRun(config).url);
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

export async function auditFonts(page: Page): Promise<FontAudit> {
  return (await page.evaluate(FONT_AUDIT_SOURCE)) as FontAudit;
}

export async function assertNoFontFallback(page: Page, failOnFallback: boolean): Promise<string[]> {
  const audit = await auditFonts(page);
  const problems = [...new Set([...audit.missing, ...audit.failed])];
  if (problems.length > 0 && failOnFallback) {
    const detail = [
      audit.missing.length > 0 ? `rendered in a substitute: ${audit.missing.join(', ')}` : '',
      audit.failed.length > 0 ? `failed to load: ${audit.failed.join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('; ');
    throw new InfrastructureError(
      `Visible text did not render in its intended font (${detail}). ` +
        'Bundle these in the runner image or fix the font request, or baselines will drift between machines.',
    );
  }
  return problems;
}
