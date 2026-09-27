import { describe, expect, it, vi } from 'vitest';
import { parseConfig } from '@bughunters/core';
import { PolicyDriver } from './policy.js';
import type { Driver, Observation } from './types.js';
function fixture(test = false) {
  const act = vi.fn(async () => ({ ok: true }));
  const observation = { elements: [{ ref: 'save', name: 'Save draft' }, { ref: 'delete', name: 'Delete account' }] } as Observation;
  const driver = { platform: 'web', act, observe: async () => observation } as unknown as Driver;
  const policy = parseConfig({ version: 1, app: { connect: { url: 'https://app.test' }, safety: { mode: test ? 'test' : 'observe' } } }).app.safety;
  return { act, driver: new PolicyDriver(driver, policy, ['https://app.test']) };
}
describe('shared driver action policy', () => {
  it('denies mutations and navigation by default', async () => {
    const { act, driver } = fixture();
    for (const action of [{ kind: 'tap', ref: 'save' }, { kind: 'type', value: 'x' }, { kind: 'press', key: 'Enter' }, { kind: 'open', url: 'https://app.test' }, { kind: 'back' }] as const) {
      expect((await driver.act(action)).ok).toBe(false);
    }
    expect(act).not.toHaveBeenCalled();
  });
  it('permits named test actions but rejects destructive and unknown targets', async () => {
    const { act, driver } = fixture(true);
    expect((await driver.act({ kind: 'tap', ref: 'save' })).ok).toBe(true);
    expect((await driver.act({ kind: 'tap', locator: { name: 'Delete account' } })).ok).toBe(false);
    expect((await driver.act({ kind: 'tap', ref: 'missing' })).ok).toBe(false);
    expect((await driver.act({ kind: 'open', url: 'https://app.test.evil.test' })).ok).toBe(false);
    expect(act).toHaveBeenCalledOnce();
  });
});
