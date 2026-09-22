import { describe, expect, it } from 'vitest';
import { buildState, MAX_STATE_CHARS } from './state.js';

const product = { summary: 'A project tracker', audience: 'small teams', domainVocabulary: ['Project'] };
const screen = { id: 's1', description: 'The dashboard' };

describe('buildState', () => {
  it('produces a stable hash for identical state', () => {
    const a = buildState({ screen, product, assertions: [] });
    const b = buildState({ screen, product, assertions: [] });
    expect(a.hash).toBe(b.hash);
  });

  it('collapses repeated assertions instead of serializing every row', () => {
    const assertions = Array.from({ length: 30 }, () => ({
      rule: 'usability/tap-target',
      severity: 'minor',
      detail: 'too small',
    }));
    const { text } = buildState({ screen, product, assertions });
    expect(text).toContain('and 29 more like it');
    expect(text.split('usability/tap-target').length - 1).toBe(1);
  });

  it('stays under the state cap even with a pathological input', () => {
    const assertions = Array.from({ length: 5000 }, (_, i) => ({
      rule: `rule-${i}`,
      severity: 'major',
      detail: 'x'.repeat(200),
    }));
    const { text } = buildState({ screen, product, assertions });
    expect(text.length).toBeLessThanOrEqual(MAX_STATE_CHARS);
  });
});
