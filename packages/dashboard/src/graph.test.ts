import { describe, expect, it } from 'vitest';
import type { LiveProgress, RunTrace } from '@autoqa/core';
import { buildGraph } from './graph.js';
import type { RunRecord } from './project.js';

function screenTrace(screenId: string, links: Array<{ href: string; external?: boolean }> = []) {
  return {
    screenId,
    viewport: 'desktop',
    url: `http://localhost:3000${screenId}`,
    title: `Page ${screenId}`,
    planReason: 'always-on',
    baselineCreated: false,
    artifacts: { actual: `/run/${screenId}.png` },
    maskedSelectors: [],
    missingFonts: [],
    consoleErrors: [],
    links: links.map((l) => ({ href: l.href, text: l.href, external: l.external ?? false })),
    checks: [],
    findingIds: [],
  };
}

function record(trace: Partial<RunTrace>, findings: unknown[] = []): RunRecord {
  return {
    id: 'run_1',
    dir: '/run',
    mtimeMs: 0,
    run: { plan: { coverage: { screensSelected: 1, screensTotal: 1 } } } as never,
    findings: findings as never,
    trace: { version: 1, runId: 'run_1' as never, findings: [], suppressed: [], screens: [], ...trace } as RunTrace,
  };
}

describe('buildGraph', () => {
  it('reports an empty graph honestly rather than inventing one', () => {
    const graph = buildGraph(undefined, undefined);
    expect(graph.source).toBe('empty');
    expect(graph.nodes).toHaveLength(0);
  });

  it('derives nodes and edges from what the run actually saw', () => {
    const graph = buildGraph(undefined, record({
      screens: [screenTrace('/', [{ href: 'http://localhost:3000/settings' }]), screenTrace('/settings')],
    }));
    expect(graph.source).toBe('run-trace');
    expect(graph.nodes.map((n) => n.id).sort()).toEqual(['/', '/settings']);
    expect(graph.edges).toEqual([{ from: '/', to: '/settings', label: 'http://localhost:3000/settings', kind: 'nav' }]);
  });

  it('marks a linked-but-never-captured screen as discovered', () => {
    // Showing the gap is the point: a map that only draws what was tested
    // implies the rest does not exist.
    const graph = buildGraph(undefined, record({
      screens: [screenTrace('/', [{ href: 'http://localhost:3000/billing' }])],
    }));
    const billing = graph.nodes.find((n) => n.id === '/billing');
    expect(billing?.state).toBe('discovered');
    expect(billing?.screenshots).toEqual({});
    expect(graph.notes.join(' ')).toContain('never been captured');
  });

  it('marks an off-origin link as external', () => {
    const graph = buildGraph(undefined, record({
      screens: [screenTrace('/', [{ href: 'https://example.com/docs', external: true }])],
    }));
    expect(graph.nodes.find((n) => n.state === 'external')).toBeDefined();
  });

  it('layers nodes by distance from the entry point, deterministically', () => {
    const trace = {
      screens: [
        screenTrace('/', [{ href: 'http://localhost:3000/a' }]),
        screenTrace('/a', [{ href: 'http://localhost:3000/b' }]),
        screenTrace('/b'),
      ],
    };
    const first = buildGraph(undefined, record(trace));
    const second = buildGraph(undefined, record(trace));
    const depths = (g: typeof first) => Object.fromEntries(g.nodes.map((n) => [n.id, n.depth]));
    expect(depths(first)).toEqual({ '/': 0, '/a': 1, '/b': 2 });
    expect(depths(second)).toEqual(depths(first));
  });

  it('parks an unreachable screen past the deepest reachable one instead of hiding it', () => {
    const graph = buildGraph(undefined, record({
      screens: [screenTrace('/', [{ href: 'http://localhost:3000/a' }]), screenTrace('/a'), screenTrace('/orphan')],
    }));
    const orphan = graph.nodes.find((n) => n.id === '/orphan')!;
    expect(orphan.depth).toBeGreaterThan(1);
  });

  it('attributes findings to the screen they were found on', () => {
    const graph = buildGraph(undefined, record(
      { screens: [screenTrace('/')] },
      [
        { screenId: '/', route: 'check', severity: 'critical' },
        { screenId: '/', route: 'question', severity: 'minor' },
      ],
    ));
    const home = graph.nodes.find((n) => n.id === '/')!;
    expect(home.findings).toEqual({ blocking: 1, issues: 0, questions: 1 });
    expect(home.severity).toBe('critical');
  });

  it('prefers a run in flight, so the map fills in as AutoQA walks', () => {
    const live: LiveProgress = {
      version: 1,
      runId: 'pending',
      status: 'running',
      startedAt: '', updatedAt: '',
      plannedCaptures: 4,
      currentStep: 'Capturing /settings',
      captured: [{ screenId: '/', viewport: 'desktop', url: 'http://localhost:3000/', actual: '/a.png', baselineCreated: false, links: [] }],
    };
    const graph = buildGraph(undefined, record({ screens: [screenTrace('/old')] }), live);
    expect(graph.nodes.map((n) => n.id)).toEqual(['/']);
    expect(graph.notes[0]).toContain('1 of 4');
  });

  it('falls back to the finished run once the live run completes', () => {
    const live = { version: 1, runId: 'x', status: 'finished', startedAt: '', updatedAt: '', plannedCaptures: 1, captured: [] } as LiveProgress;
    const graph = buildGraph(undefined, record({ screens: [screenTrace('/done')] }), live);
    expect(graph.nodes.map((n) => n.id)).toEqual(['/done']);
  });
});
