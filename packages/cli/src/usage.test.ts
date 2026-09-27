import { expect, it } from 'vitest';
import { USAGE } from './usage.js';
it('separates implemented commands from planned capabilities', () => {
  const [available, planned] = USAGE.split('Not yet available');
  expect(available).toContain('baseline update');
  expect(available).toContain('artifacts prune');
  expect(available).not.toContain('bughunters recon');
  expect(planned).toContain('API testing');
});
