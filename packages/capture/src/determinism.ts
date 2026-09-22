import type { DeterminismConfig } from '@autoqa/core';

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

export type FontAudit = { requested: string[]; missing: string[] };

/**
 * A glyph falling back to an unbundled family is a determinism violation, not a
 * diff. It fails the run loudly (spec 7.1) rather than producing a mysterious
 * text-shaped diff on another machine.
 */
export const FONT_AUDIT_SOURCE = String.raw`
(() => {
  const requested = new Set();
  for (const el of document.querySelectorAll('*')) {
    const family = getComputedStyle(el).fontFamily;
    if (family) for (const part of family.split(',')) requested.add(part.trim().replace(/^["']|["']$/g, ''));
  }
  const missing = [...requested].filter((family) => {
    if (!family || family.startsWith('-') || ['serif','sans-serif','monospace','cursive','fantasy','system-ui'].includes(family)) return false;
    return !document.fonts.check('12px "' + family + '"');
  });
  return { requested: [...requested], missing };
})()
`;
