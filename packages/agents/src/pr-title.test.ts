import { describe, expect, it } from 'vitest';
import { buildPrTitle, isConventional, templateScope } from './pr-title.js';

describe('PR titles', () => {
  it('builds type(scope): description in lower case with no period', () => {
    expect(buildPrTitle({ type: 'fix', scope: 'app', description: 'Expand the sidebar in a narrow window.' }))
      .toEqual({ ok: true, title: 'fix(app): expand the sidebar in a narrow window' });
    expect(buildPrTitle({ type: 'feat', description: 'API keys per workspace' }))
      .toEqual({ ok: true, title: 'feat: API keys per workspace' });
  });

  it('refuses an unknown type and a long title, and says why', () => {
    expect(buildPrTitle({ type: 'bugfix', description: 'x' })).toMatchObject({ ok: false, reason: expect.stringContaining('not one of') });
    const long = buildPrTitle({ type: 'fix', scope: 'app', description: 'a'.repeat(80) });
    expect(long).toMatchObject({ ok: false, reason: expect.stringContaining('the limit is 72') });
  });

  it('reads the scope of a commit template', () => {
    expect(templateScope('fix(app): {title}')).toBe('app');
    expect(templateScope('fix: {title}')).toBeUndefined();
    expect(isConventional('fix(app): expand the sidebar')).toBe(true);
    expect(isConventional('Expand the sidebar')).toBe(false);
  });
});
