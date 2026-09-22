import { describe, expect, it } from 'vitest';
import { evaluateAll } from './registry.js';
import type { ScreenSnapshot } from './types.js';

function snapshot(overrides: Partial<ScreenSnapshot> = {}): ScreenSnapshot {
  return {
    screenId: 'screen-1',
    viewport: { name: 'desktop', width: 1440, height: 900 },
    url: 'http://localhost:3000/',
    elements: [],
    document: { scrollWidth: 1440, clientWidth: 1440, scrollHeight: 900, clientHeight: 900, hasStylesheets: true },
    images: [],
    consoleErrors: [],
    ...overrides,
  };
}

function el(selector: string, box: [number, number, number, number], extra: Record<string, unknown> = {}) {
  return {
    selector,
    box: { x: box[0], y: box[1], width: box[2], height: box[3] },
    visible: true,
    interactive: true,
    zIndex: 0,
    hitSelector: selector,
    ...extra,
  } as ScreenSnapshot['elements'][number];
}

describe('evaluateAll', () => {
  it('reports occlusion as critical and names what is covering the element', () => {
    const v = evaluateAll(
      snapshot({ elements: [el('#save', [10, 10, 100, 40], { hitSelector: '.sticky-footer' })] }),
    );
    const occ = v.find((x) => x.ruleId === 'layout/occlusion');
    expect(occ?.severity).toBe('critical');
    expect(occ?.message).toContain('.sticky-footer');
  });

  it('flags a zero-size interactive element', () => {
    const v = evaluateAll(snapshot({ elements: [el('#ghost', [10, 10, 0, 0])] }));
    expect(v.some((x) => x.ruleId === 'layout/zero-size-interactive')).toBe(true);
  });

  it('does not treat nesting as an overlap bug', () => {
    const parent = el('#card', [0, 0, 200, 100], { hitSelector: '#card-link' });
    const child = el('#card-link', [10, 10, 100, 40], { hitSelector: '#card-link' });
    const v = evaluateAll(snapshot({ elements: [parent, child] }));
    expect(v.some((x) => x.ruleId === 'layout/overlap')).toBe(false);
  });

  it('skips change-aware rules when there is no baseline', () => {
    // Otherwise the first run against any app produces an avalanche.
    const s = snapshot({ consoleErrors: ['TypeError: x is not a function'] });
    expect(evaluateAll(s).some((x) => x.ruleId === 'runtime/console-errors')).toBe(false);
  });

  it('reports only NEW console errors once a baseline exists', () => {
    const baseline = snapshot({ consoleErrors: ['old error'] });
    const current = snapshot({ consoleErrors: ['old error', 'new error'] });
    const v = evaluateAll(current, { baseline });
    const errors = v.filter((x) => x.ruleId === 'runtime/console-errors');
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toContain('new error');
  });

  it('only fires horizontal scroll when it is a regression', () => {
    const wide = { scrollWidth: 1600, clientWidth: 1440, scrollHeight: 900, clientHeight: 900, hasStylesheets: true };
    const alreadyWide = snapshot({ document: wide });
    expect(evaluateAll(alreadyWide, { baseline: alreadyWide }).some((x) => x.ruleId === 'layout/horizontal-scroll')).toBe(false);
    expect(evaluateAll(alreadyWide, { baseline: snapshot() }).some((x) => x.ruleId === 'layout/horizontal-scroll')).toBe(true);
  });

  it('orders violations with the most severe first', () => {
    const v = evaluateAll(
      snapshot({
        elements: [el('#save', [10, 10, 100, 40], { hitSelector: '.overlay' }), el('#tiny', [500, 10, 10, 10])],
      }),
    );
    expect(v[0]!.severity).toBe('critical');
  });

  it('honours disabled rule ids from the Intent Ledger', () => {
    const v = evaluateAll(snapshot({ elements: [el('#tiny', [0, 0, 10, 10])] }), {
      disabled: ['usability/tap-target'],
    });
    expect(v.some((x) => x.ruleId === 'usability/tap-target')).toBe(false);
  });

  it('every violation message names a consequence rather than a number alone', () => {
    const v = evaluateAll(snapshot({ elements: [el('#save', [10, 10, 100, 40], { hitSelector: '.overlay' })] }));
    for (const violation of v) {
      expect(violation.message.length).toBeGreaterThan(30);
      expect(violation.message).toMatch(/[a-z]/);
    }
  });
});
