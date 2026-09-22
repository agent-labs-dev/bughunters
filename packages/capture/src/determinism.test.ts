import { describe, expect, it } from 'vitest';
import { buildFreezeScript, DETERMINISTIC_CHROMIUM_ARGS, STABILITY_STYLESHEET } from './determinism.js';

const config = {
  image: '',
  freezeClockAt: '2026-01-01T00:00:00.000Z',
  timezone: 'UTC',
  locale: 'en-US',
  randomSeed: 7,
  stabilityGate: { consecutiveIdenticalFrames: 2, intervalMs: 120, timeoutMs: 10_000 },
  failOnFontFallback: true,
  blockThirdPartyRequests: true,
};

describe('determinism contract', () => {
  it('disables GPU rasterisation and sub-pixel text', () => {
    // Both vary between runners and are a top source of cross-machine drift.
    expect(DETERMINISTIC_CHROMIUM_ARGS).toContain('--disable-gpu');
    expect(DETERMINISTIC_CHROMIUM_ARGS).toContain('--disable-lcd-text');
  });

  it('kills animation, transition and the blinking caret', () => {
    expect(STABILITY_STYLESHEET).toContain('animation-duration: 0s');
    expect(STABILITY_STYLESHEET).toContain('transition-duration: 0s');
    expect(STABILITY_STYLESHEET).toContain('caret-color: transparent');
  });

  it('freezes the clock to the configured instant', () => {
    const script = buildFreezeScript(config);
    expect(script).toContain(String(Date.parse('2026-01-01T00:00:00.000Z')));
    expect(script).toContain('static now()');
  });

  it('seeds Math.random deterministically', () => {
    expect(buildFreezeScript(config)).toContain('let seed = 7');
  });

  it('produces the same script for the same config', () => {
    expect(buildFreezeScript(config)).toBe(buildFreezeScript(config));
  });
});
