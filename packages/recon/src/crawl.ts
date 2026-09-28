import { sha256 } from '@bugpatrol/core';

export type CrawlBudget = {
  maxScreens: number;
  maxDepth: number;
  maxActionsPerScreen: number;
  maxWallClockMs: number;
};

export type CrawlFrontierItem = { url: string; depth: number; via?: string };

/**
 * Query parameters that are known to be dynamic and must not make two visits to
 * the same screen look like two different screens.
 */
const DYNAMIC_PARAMS = /^(utm_[a-z]+|_ga|session|sid|token|timestamp|ts|nonce|cache)$/i;

/**
 * Collapses list/detail routes so `/items/123` and `/items/456` are recognised
 * as the same screen template. Without this the crawler walks a product
 * catalogue forever and the AppModel becomes a list of rows.
 */
export function normalizeUrl(rawUrl: string): string {
  const url = new URL(rawUrl);

  for (const key of [...url.searchParams.keys()]) {
    if (DYNAMIC_PARAMS.test(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  url.hash = '';

  const segments = url.pathname.split('/').map((segment) => {
    if (/^\d+$/.test(segment)) return ':id';
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment)) return ':uuid';
    if (/^[0-9a-f]{24}$/i.test(segment)) return ':oid';
    if (segment.length > 20 && /\d/.test(segment) && /[a-z]/i.test(segment)) return ':slug';
    return segment;
  });

  url.pathname = segments.join('/');
  return url.toString();
}

/** Dedup key: hash(normalizedUrl + structuralDomHash). */
export function dedupKey(url: string, structuralDomHash: string): string {
  return sha256(`${normalizeUrl(url)}\n${structuralDomHash}`);
}

export type BudgetStop = { stopped: true; reason: string } | { stopped: false };

/**
 * Recon terminating predictably matters more than Recon being exhaustive
 * (spec 1.3). Every budget here is enforced, not advisory.
 */
export class CrawlBudgetGuard {
  private screens = 0;
  private readonly startedAt = Date.now();

  constructor(private readonly budget: CrawlBudget) {}

  admit(item: CrawlFrontierItem): BudgetStop {
    if (this.screens >= this.budget.maxScreens) {
      return { stopped: true, reason: `Reached maxScreens (${this.budget.maxScreens}).` };
    }
    if (Date.now() - this.startedAt >= this.budget.maxWallClockMs) {
      return { stopped: true, reason: `Reached the wall-clock budget (${this.budget.maxWallClockMs}ms).` };
    }
    if (item.depth > this.budget.maxDepth) {
      return { stopped: true, reason: `Reached maxDepth (${this.budget.maxDepth}) at ${item.url}.` };
    }
    this.screens++;
    return { stopped: false };
  }

  get visited(): number {
    return this.screens;
  }
}

/** Breadth-first frontier with a visited set keyed on the dedup key. */
export class Frontier {
  private readonly queue: CrawlFrontierItem[] = [];
  private readonly seen = new Set<string>();

  push(item: CrawlFrontierItem, structuralDomHash = ''): boolean {
    const key = dedupKey(item.url, structuralDomHash);
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    this.queue.push(item);
    return true;
  }

  shift(): CrawlFrontierItem | undefined {
    return this.queue.shift();
  }

  get size(): number {
    return this.queue.length;
  }
}
