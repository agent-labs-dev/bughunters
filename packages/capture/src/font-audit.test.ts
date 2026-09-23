import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { chromium, type Browser, type Page } from 'playwright';
import { auditFonts } from './browser.js';

// A real TTF, embedded as a data URL so the face genuinely loads. DejaVu ships
// with Playwright's system dependencies on Linux, which is what CI installs.
const FONT_FILE = [
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/TTF/DejaVuSans.ttf',
].find((f) => existsSync(f));

if (!FONT_FILE) {
  throw new Error('font-audit tests need DejaVuSans.ttf; install it (e.g. `playwright install --with-deps`).');
}
const FONT_URL = `data:font/ttf;base64,${readFileSync(FONT_FILE).toString('base64')}`;

let browser: Browser;
let page: Page;

beforeAll(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
}, 60_000);
afterAll(async () => {
  await browser?.close();
});

async function audit(css: string, body: string) {
  await page.setContent(`<!doctype html><html><head><style>${css}</style></head><body>${body}</body></html>`);
  return auditFonts(page);
}

const loadable = `@font-face { font-family: "Brand"; src: url(${FONT_URL}); }`;

describe('font audit', () => {
  it('does not flag an unused fallback face later in the stack', async () => {
    // The next/font pattern. "Brand Fallback" is declared with a local() source
    // that does not exist here, but it only renders while Brand is loading.
    const result = await audit(
      `${loadable}
       @font-face { font-family: "Brand Fallback"; src: local("Definitely Not Installed"); }
       p { font-family: "Brand", "Brand Fallback", sans-serif; }`,
      '<p>Hello</p>',
    );
    expect(result.missing).toEqual([]);
    expect(result.requested).toContain('Brand');
  });

  it('does not flag a fallback face that errored but never renders', async () => {
    // next/font declares fallbacks like local("Courier New"). On a machine
    // without that font the face ERRORS -- but the primary loaded, so no pixel
    // came from it.
    const result = await audit(
      `${loadable}
       @font-face { font-family: "Brand Fallback"; src: url(data:font/ttf;base64,AAAA); }
       p { font-family: "Brand", "Brand Fallback", monospace; }`,
      '<p>Hello</p>',
    );
    expect(result.failed).toEqual([]);
    expect(result.missing).toEqual([]);
  });

  it('waits for fonts to load before judging', async () => {
    // Without awaiting document.fonts.ready, a webfont the text needs is still
    // "unloaded" at audit time and looks like a fallback.
    const result = await audit(`${loadable} p { font-family: "Brand"; }`, '<p>Hello</p>');
    expect(result.missing).toEqual([]);
  });

  it('flags visible text whose declared font failed to load', async () => {
    const result = await audit(
      `@font-face { font-family: "Broken"; src: url(data:font/ttf;base64,AAAA); }
       p { font-family: "Broken", sans-serif; }`,
      '<p>Hello</p>',
    );
    expect(result.missing).toContain('Broken');
    expect(result.failed).toContain('Broken');
  });

  it('ignores hidden text', async () => {
    const result = await audit(
      `@font-face { font-family: "Broken"; src: url(data:font/ttf;base64,AAAA); }
       p { font-family: "Broken"; display: none; }`,
      '<p>Hello</p>',
    );
    expect(result.missing).toEqual([]);
  });

  it('ignores a font requested only by elements that render no text', async () => {
    const result = await audit(
      `@font-face { font-family: "Broken"; src: url(data:font/ttf;base64,AAAA); }
       div { font-family: "Broken"; width: 10px; height: 10px; }`,
      '<div></div>',
    );
    expect(result.missing).toEqual([]);
  });

  it('does not try to verify system fonts it has no face for', async () => {
    // The FontFace API cannot tell whether a system font is installed; that is
    // the pinned image's job, not this check's.
    const result = await audit('p { font-family: "Some System Font", sans-serif; }', '<p>Hello</p>');
    expect(result.missing).toEqual([]);
    expect(result.requested).toContain('Some System Font');
  });
});
