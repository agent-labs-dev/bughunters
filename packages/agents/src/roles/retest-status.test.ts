import { describe, expect, it } from 'vitest';
import { bughuntersConfigSchema, type FixProposal, type Retest } from '@bughunters/core';
import { applyRetest } from './retest.js';

const config = bughuntersConfigSchema.parse({ version: 1, app: { platform: 'electron' } });
const fix = (): FixProposal => ({ version: 1, id: 'fix_1', issueId: 'iss_1', status: 'retesting', runtime: 'cli',
  repo: '/repo', branch: 'b', worktree: '/wt', startedAt: '2026-01-01T00:00:00.000Z' });
const retest = (outcome: Retest['outcome']): Retest => ({ attempt: 1, outcome, reason: '', at: '2026-01-01T00:00:00.000Z' });

describe('applyRetest', () => {
  it('keeps a fix in retesting after a setup error, and the error is not an attempt', () => {
    const item = fix();
    for (let i = 0; i < 5; i++) applyRetest(config, item, retest('error'));
    expect(item.status).toBe('retesting');
    applyRetest(config, item, retest('not-fixed'));
    expect(item.status).toBe('retesting');
    applyRetest(config, item, retest('not-fixed'));
    expect(item.status).toBe('proposed');
    expect(item.retests).toHaveLength(7);
  });

  it('marks a fix verified when the judge says fixed', () => {
    const item = fix();
    applyRetest(config, item, retest('fixed'));
    expect(item.status).toBe('verified');
  });
});
