import type { DeterminismConfig } from '@bughunters/core';

/**
 * Chromium launch flags that pin rasterisation. GPU rendering varies between
 * runners, and sub-pixel LCD antialiasing varies between font stacks; both are
 * disabled so the same page produces the same pixels on every GPU-less runner
 * (spec 7.2).
 */
export const DETERMINISTIC_CHROMIUM_ARGS = [
  '--disable-gpu',
  '--disable-lcd-text',
  '--disable-font-subpixel-positioning',
  '--force-color-profile=srgb',
  '--disable-partial-raster',
  '--disable-skia-runtime-opts',
  '--force-device-scale-factor=1',
  '--hide-scrollbars',
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-features=PaintHolding,LazyFrameLoading',
  '--run-all-compositor-stages-before-draw',
] as const;

/** CSS injected before capture. Kills motion; the caret is masked separately. */
export const STABILITY_STYLESHEET = `
*, *::before, *::after {
  animation-duration: 0s !important;
  animation-delay: 0s !important;
  animation-iteration-count: 1 !important;
  transition-duration: 0s !important;
  transition-delay: 0s !important;
  scroll-behavior: auto !important;
  caret-color: transparent !important;
}
html { -webkit-font-smoothing: antialiased; }
`;

/**
 * Init script freezing time and randomness. Runs before any page script, so an
 * app that reads Date.now() at module scope still sees the frozen instant.
 *
 * Note this freezes rather than mocks: a timer still fires, but everything the
 * page can observe about "now" is constant, which is what a stable screenshot
 * requires.
 */
export function buildFreezeScript(config: DeterminismConfig): string {
  const epoch = new Date(config.freezeClockAt).getTime();
  return `(() => {
  const FROZEN = ${epoch};
  const RealDate = Date;
  class FrozenDate extends RealDate {
    constructor(...args) { super(...(args.length === 0 ? [FROZEN] : args)); }
    static now() { return FROZEN; }
  }
  globalThis.Date = FrozenDate;
  const origPerfNow = performance.now.bind(performance);
  void origPerfNow;
  performance.now = () => 0;

  // Deterministic PRNG (mulberry32). Seeded per run so a page that renders
  // random ids or shuffled content still renders the same pixels.
  let seed = ${config.randomSeed} >>> 0;
  Math.random = () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
})();`;
}

export type FontAudit = {
  /** Primary families actually rendering visible text. */
  requested: string[];
  /** Families whose declared face never loaded, so the text rendered in a substitute. */
  missing: string[];
  /** Faces that failed outright (404, CORS, corrupt file) AND that visible text depends on. */
  failed: string[];
};

/**
 * A glyph falling back to an unbundled family is a determinism violation, not a
 * diff. It fails the run loudly (spec 7.1) rather than producing a mysterious
 * text-shaped diff on another machine.
 *
 * The question this answers is narrow on purpose: for each piece of VISIBLE
 * TEXT, did the font it asked for FIRST actually render? Three things that
 * look like fallbacks are not:
 *
 *  - Later families in a stack. `"Inter", "Inter Fallback", sans-serif` only
 *    ever renders the fallback while Inter is loading. next/font generates
 *    exactly this pattern for every font, so flagging stack members made every
 *    Next.js app fail its own determinism check.
 *  - Faces that have not loaded yet. The audit awaits `document.fonts.ready`
 *    first, because the browser only fetches a webfont once text needs it.
 *  - Other weights. The check uses the element's real weight and style, since
 *    a loaded 400 face says nothing about whether the 700 face arrived.
 *
 * System fonts have no FontFace, and the FontFace API cannot tell whether one is
 * installed -- `check()` returns true when no face matches. Those are covered
 * structurally by the pinned image and its bundled font set instead.
 */
export const FONT_AUDIT_SOURCE = String.raw`
(async () => {
  await document.fonts.ready;

  const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui',
    'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'emoji', 'math', 'fangsong']);
  const clean = (f) => f.trim().replace(/^["']|["']$/g, '');
  const norm = (f) => clean(f).toLowerCase();

  const declared = new Map();
  const failed = new Set();
  for (const face of document.fonts) {
    const key = norm(face.family);
    declared.set(key, (declared.get(key) || 0) + 1);
    if (face.status === 'error') failed.add(clean(face.family));
  }

  function rendersText(el) {
    for (const child of el.childNodes) {
      if (child.nodeType === 3 && child.textContent.trim().length > 0) return true;
    }
    return false;
  }

  const requested = new Set();
  const missing = new Set();
  for (const el of document.querySelectorAll('body *')) {
    if (!rendersText(el)) continue;
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none') continue;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;

    const primary = clean(style.fontFamily.split(',')[0] || '');
    if (!primary || primary.startsWith('-') || GENERIC.has(primary.toLowerCase())) continue;
    requested.add(primary);

    // Only a family with a declared face can be verified here.
    if (!declared.has(primary.toLowerCase())) continue;
    const probe = style.fontStyle + ' ' + style.fontWeight + ' 16px "' + primary + '"';
    if (!document.fonts.check(probe)) missing.add(primary);
  }

  // A face that errored but that no visible text asks for first -- next/font's
  // local("Arial")-style fallbacks on a machine without Arial -- changes no
  // pixel, so it is not a determinism problem.
  const relevantFailures = [...failed].filter((f) => requested.has(f));
  return { requested: [...requested], missing: [...missing], failed: relevantFailures };
})()
`;
