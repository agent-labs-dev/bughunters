import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BaselineStore, baselineKeyFor } from './baseline-store.js';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bugpatrol-baseline-'));
  mkdirSync(join(root, '.bugpatrol'), { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const DIGEST = 'sha256:aaa';
const png = Buffer.from('fake-png-bytes');

describe('BaselineStore', () => {
  it('stores and retrieves a baseline by screen and viewport', () => {
    const store = BaselineStore.load(root, DIGEST);
    const key = baselineKeyFor('/settings', 'desktop');
    store.put(key, 'desktop', png);
    expect(store.has(key)).toBe(true);
    expect(existsSync(store.pathFor(key)!)).toBe(true);
  });

  it('keeps viewports separate', () => {
    const store = BaselineStore.load(root, DIGEST);
    store.put(baselineKeyFor('/x', 'desktop'), 'desktop', png);
    expect(store.has(baselineKeyFor('/x', 'mobile'))).toBe(false);
  });

  it('survives a save/load round trip', () => {
    const store = BaselineStore.load(root, DIGEST);
    store.put(baselineKeyFor('/x', 'desktop'), 'desktop', png);
    store.save();
    expect(BaselineStore.load(root, DIGEST).count).toBe(1);
  });

  it('treats baselines as stale when the runner image changes', () => {
    // Comparing across images is what produces a diff storm nobody can explain.
    const store = BaselineStore.load(root, DIGEST);
    store.put(baselineKeyFor('/x', 'desktop'), 'desktop', png);
    store.save();

    const reloaded = BaselineStore.load(root, 'sha256:bbb');
    expect(reloaded.isStaleFor('sha256:bbb')).toBe(true);
    expect(reloaded.invalidateAll('sha256:bbb')).toBe(1);
    expect(reloaded.count).toBe(0);
  });

  it('is not stale when empty, so a fresh repo does not report an invalidation', () => {
    expect(BaselineStore.load(root, DIGEST).isStaleFor('sha256:other')).toBe(false);
  });

  it('is content-addressed, so an identical capture reuses the stored object', () => {
    const store = BaselineStore.load(root, DIGEST);
    const a = store.put(baselineKeyFor('/x', 'desktop'), 'desktop', png);
    const b = store.put(baselineKeyFor('/y', 'desktop'), 'desktop', png);
    expect(a.sha256).toBe(b.sha256);
  });
});
