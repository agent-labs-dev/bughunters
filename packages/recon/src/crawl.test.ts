import { describe, expect, it } from 'vitest';
import { normalizeUrl, Frontier, CrawlBudgetGuard } from './crawl.js';

describe('normalizeUrl', () => {
  it('collapses list/detail routes into one screen template', () => {
    expect(normalizeUrl('http://app/items/123')).toBe(normalizeUrl('http://app/items/456'));
  });

  it('collapses uuids and object ids', () => {
    expect(normalizeUrl('http://app/u/3f2504e0-4f89-11d3-9a0c-0305e82c3301')).toContain(':uuid');
    expect(normalizeUrl('http://app/u/507f1f77bcf86cd799439011')).toContain(':oid');
  });

  it('strips known-dynamic query params but keeps meaningful ones', () => {
    expect(normalizeUrl('http://app/list?utm_source=x&page=2')).toBe('http://app/list?page=2');
  });

  it('is order independent for query params', () => {
    expect(normalizeUrl('http://app/l?b=2&a=1')).toBe(normalizeUrl('http://app/l?a=1&b=2'));
  });
});

describe('Frontier', () => {
  it('does not revisit a screen with the same structure', () => {
    const f = new Frontier();
    expect(f.push({ url: 'http://app/items/1', depth: 0 }, 'hashA')).toBe(true);
    expect(f.push({ url: 'http://app/items/2', depth: 0 }, 'hashA')).toBe(false);
  });

  it('treats the same route with a different structure as a new screen', () => {
    const f = new Frontier();
    f.push({ url: 'http://app/items/1', depth: 0 }, 'hashA');
    expect(f.push({ url: 'http://app/items/2', depth: 0 }, 'hashB')).toBe(true);
  });
});

describe('CrawlBudgetGuard', () => {
  it('stops at maxScreens rather than running forever', () => {
    const guard = new CrawlBudgetGuard({ maxScreens: 2, maxDepth: 5, maxActionsPerScreen: 5, maxWallClockMs: 60_000 });
    expect(guard.admit({ url: 'http://app/a', depth: 0 }).stopped).toBe(false);
    expect(guard.admit({ url: 'http://app/b', depth: 0 }).stopped).toBe(false);
    expect(guard.admit({ url: 'http://app/c', depth: 0 }).stopped).toBe(true);
  });

  it('stops at maxDepth', () => {
    const guard = new CrawlBudgetGuard({ maxScreens: 99, maxDepth: 1, maxActionsPerScreen: 5, maxWallClockMs: 60_000 });
    expect(guard.admit({ url: 'http://app/a', depth: 2 }).stopped).toBe(true);
  });
});
