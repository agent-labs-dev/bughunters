import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { PROBE_SOURCE, evaluateAll, type ScreenSnapshot } from '@autoqa/invariants';

let browser: Browser;
let page: Page;

beforeAll(async () => {
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1024, height: 700 } });
}, 60_000);
afterAll(async () => {
  await browser?.close();
});

async function snapshot(html: string): Promise<ScreenSnapshot> {
  await page.setContent(`<!doctype html><html><body style="margin:0">${html}</body></html>`);
  const probe = (await page.evaluate(PROBE_SOURCE)) as Omit<ScreenSnapshot, 'screenId' | 'viewport' | 'consoleErrors'>;
  return { ...probe, screenId: '/', viewport: { name: 'desktop', width: 1024, height: 700 }, consoleErrors: [] };
}

const rules = (s: ScreenSnapshot) => evaluateAll(s).map((v) => v.ruleId);

describe('probe: contrast against what is actually painted', () => {
  it('composites a translucent background over the dark layer beneath it', async () => {
    // White text on 18% white glass over navy. It renders as white-on-dark;
    // reading only the glass colour made it white-on-white, 1.00:1.
    const s = await snapshot(`
      <div style="background:#081222;padding:40px">
        <button id="glass" style="background:rgba(255,255,255,0.18);color:#fff;border:0;padding:12px 24px;font-size:16px">Channels</button>
      </div>`);
    expect(rules(s)).not.toContain('usability/contrast');
  });

  it('still flags genuinely unreadable text', async () => {
    const s = await snapshot(`<p style="color:#cdd1d8;background:#fff;font-size:16px">Low contrast</p>`);
    expect(rules(s)).toContain('usability/contrast');
  });

  it('treats semi-transparent black as a real layer, not as transparent', async () => {
    // rgba(0, 0, 0, 0.5) used to match a startsWith("rgba(0, 0, 0, 0") check
    // and be skipped, so dark overlays were ignored entirely.
    const s = await snapshot(`
      <div style="background:#fff">
        <div style="background:rgba(0,0,0,0.5);padding:20px">
          <p style="color:#fff;font-size:16px;margin:0">On a dark overlay</p>
        </div>
      </div>`);
    const text = s.elements.find((e) => e.selector.includes('p'))!;
    // 50% black over white is mid-grey. Canvas stores alpha in 8 bits, so 0.5
    // round-trips as 128/255 and the channel can land on 127 or 128.
    const [r, g, b] = text.backgroundColor!.match(/\d+/g)!.map(Number);
    for (const channel of [r, g, b]) expect(Math.abs(channel! - 128)).toBeLessThanOrEqual(1);
  });

  it('reads oklch() colours, which Tailwind v4 emits for every utility', async () => {
    const s = await snapshot(`<button style="background:oklch(0.52 0.21 278);color:#fff;border:0;padding:12px;font-size:16px">Continue</button>`);
    const button = s.elements.find((e) => e.selector.includes('button'))!;
    expect(button.backgroundColor).not.toBe('rgb(255, 255, 255)');
    expect(rules(s)).not.toContain('usability/contrast');
  });

  it('sees a positioned sibling painted behind the text, not just ancestors', async () => {
    // A transparent header over a full-bleed hero: the hero is a sibling, so an
    // ancestor walk reached the pale page background and reported 1.4:1.
    const s = await snapshot(`
      <div style="background:#cad5b2;position:relative;height:300px">
        <div style="position:absolute;inset:0;background:#1d4ed8"></div>
        <header style="position:relative;padding:20px">
          <a href="/docs" style="color:#f3f5ee;font-size:16px">Docs</a>
        </header>
      </div>`);
    const link = s.elements.find((e) => e.selector.includes(' a') || e.selector.endsWith('a'))!;
    expect(link.backgroundColor).toBe('rgb(29, 78, 216)');
    expect(rules(s)).not.toContain('usability/contrast');
  });

  it('declines to judge text over a hero image it cannot read', async () => {
    const s = await snapshot(`
      <div style="position:relative;height:300px">
        <img alt="" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==" style="position:absolute;inset:0;width:100%;height:100%">
        <p style="position:relative;color:#eee;font-size:16px;padding:20px">Caption</p>
      </div>`);
    expect(rules(s)).not.toContain('usability/contrast');
  });

  it('declines to judge text over a background image rather than guessing', async () => {
    const s = await snapshot(`
      <div style="background-image:linear-gradient(#000,#fff);padding:20px">
        <p style="color:#777;font-size:16px;margin:0">Over a gradient</p>
      </div>`);
    const text = s.elements.find((e) => e.selector.includes('p'))!;
    expect(text.backgroundColor).toBeUndefined();
    expect(rules(s)).not.toContain('usability/contrast');
  });
});

describe('probe: zero-size interactive elements', () => {
  it('does not flag a responsive variant hidden with display:none', async () => {
    // Tailwind's `hidden md:flex`: 0x0 on purpose, unreachable by design.
    const s = await snapshot(`<nav><a href="/a" style="display:none">Desktop link</a></nav>`);
    expect(rules(s)).not.toContain('layout/zero-size-interactive');
  });

  it('does not flag a link inside a display:none ancestor', async () => {
    const s = await snapshot(`<div style="display:none"><a href="/a">Hidden</a></div>`);
    expect(rules(s)).not.toContain('layout/zero-size-interactive');
  });

  it('still flags a rendered button that collapsed to nothing', async () => {
    const s = await snapshot(`<button style="width:0;height:0;padding:0;border:0;overflow:hidden">Save</button>`);
    expect(rules(s)).toContain('layout/zero-size-interactive');
  });
});

describe('probe: the rendered pixels overrule the DOM', () => {
  async function snapshotWithPixels(html: string): Promise<ScreenSnapshot> {
    const s = await snapshot(html);
    const shot = await page.screenshot({ fullPage: true });
    const { confirmContrastWithPixels } = await import('./pixel-contrast.js');
    confirmContrastWithPixels(s.elements, shot, { deviceScaleFactor: 1, masks: [] });
    return s;
  }

  it('drops a false alarm from a decorative layer the DOM cannot see', async () => {
    // The nebula-web /download pattern. The blue hero sets pointer-events:none,
    // so elementsFromPoint skips it and the DOM reads light text on the pale
    // page background (1.4:1). The screenshot shows light text on blue.
    const s = await snapshotWithPixels(`
      <div style="background:#cad5b2;position:relative;height:300px">
        <div style="position:absolute;inset:0;background:#1d4ed8;pointer-events:none"></div>
        <header style="position:relative;padding:20px">
          <a href="/docs" style="color:#f3f5ee;font-size:16px">Docs</a>
        </header>
      </div>`);
    const link = s.elements.find((e) => e.selector.endsWith('a'))!;
    expect(link.pixelContrast).toBeGreaterThan(4.5);
    expect(rules(s)).not.toContain('usability/contrast');
  });

  it('confirms a genuine failure and reports the measured ratio', async () => {
    const s = await snapshotWithPixels(`<p style="color:#b9bec7;background:#fff;font-size:16px;padding:8px">Faint label</p>`);
    const finding = evaluateAll(s).find((v) => v.ruleId === 'usability/contrast');
    expect(finding?.message).toContain('Confirmed on the rendered pixels');
    expect(finding?.detail?.pixelConfirmed).toBe(true);
  });
});

describe('probe: selectors', () => {
  it('escapes Tailwind class names so reported selectors are valid CSS', async () => {
    const s = await snapshot(`<p class="text-muted-foreground/60 text-[12px] md:flex">Label</p>`);
    const selector = s.elements.find((e) => e.selector.includes('text-'))!.selector;
    // querySelector throws on an invalid selector; this must resolve.
    const found = await page.evaluate((sel) => document.querySelector(sel)?.textContent, selector);
    expect(found).toBe('Label');
  });
});
