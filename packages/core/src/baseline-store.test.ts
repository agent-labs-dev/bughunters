import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BaselineStore, baselineKeyFor } from './baseline-store.js';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bughunters-baseline-'));
  mkdirSync(join(root, '.bughunters'), { recursive: true });
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

describe('approved baseline integrity', () => {
  it('does not recreate missing or corrupted objects during verification', async () => {
    const { writeFileSync, unlinkSync } = await import('node:fs');
    const store = BaselineStore.load(root, DIGEST);
    store.put('screen', 'desktop', png);
    const file = store.verify('screen');
    writeFileSync(file, 'tampered');
    expect(() => store.verify('screen')).toThrow('integrity');
    unlinkSync(file);
    expect(() => store.verify('screen')).toThrow('unavailable');
    expect(existsSync(file)).toBe(false);
  });
  it('rejects path-shaped hashes in a manifest', async () => {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(root, '.bughunters/baselines.manifest.json'), JSON.stringify({ version: 1, imageDigest: DIGEST,
      entries: { screen: { sha256: '../../outside', viewport: 'desktop', bytes: 1, capturedAt: 'now' } } }));
    expect(() => BaselineStore.load(root, DIGEST)).toThrow('Invalid baseline manifest');
  });
});
