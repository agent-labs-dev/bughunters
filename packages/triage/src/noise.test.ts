import { describe, expect, it } from 'vitest';
import { applyNoiseControls, isQuarantined, flakeRate, DEFAULT_NOISE } from './noise.js';
import type { RootCauseGroup } from './cluster.js';
import { id } from '@autoqa/core';
import type { Finding, Severity } from '@autoqa/core';

function group(n: number, severity: Severity = 'minor'): RootCauseGroup {
  const finding = {
    id: id.finding(`f${n}`),
    runId: id.run('r1'),
    fingerprint: `fp${n}`,
    ruleId: 'layout/overlap',
    tier: 'tier1',
    classification: 'regression',
    severity,
    confidence: 0.9,
    route: 'issue',
    summary: 'x',
    evidence: {},
    suspectedFiles: [],
    status: 'open',
  } satisfies Finding;
  return { id: id.group(`g${n}`), findings: [finding], screens: [], ruleIds: ['layout/overlap'], representative: finding };
}

describe('applyNoiseControls', () => {
  it('files one summary issue once the per-run cap is exceeded', () => {
    const groups = Array.from({ length: 15 }, (_, i) => group(i));
    const decision = applyNoiseControls(groups, { isFirstRun: false });
    expect(decision.individual).toHaveLength(DEFAULT_NOISE.perRunIssueCap);
    expect(decision.summarized).toHaveLength(5);
  });

  it('keeps the most severe groups as individual issues', () => {
    const groups = [...Array.from({ length: 12 }, (_, i) => group(i)), group(99, 'critical')];
    const decision = applyNoiseControls(groups, { isFirstRun: false });
    expect(decision.individual[0]!.representative.severity).toBe('critical');
  });

  it('blocks nothing on a first run', () => {
    const decision = applyNoiseControls([group(1)], { isFirstRun: true });
    expect(decision.blockingAllowed).toBe(false);
    expect(decision.notes.join(' ')).toContain('reporting only');
  });
});

describe('flake quarantine', () => {
  it('quarantines a finding that fails to reproduce twice', () => {
    expect(isQuarantined({ fingerprint: 'a', failures: 3, reproductions: 1 })).toBe(true);
    expect(isQuarantined({ fingerprint: 'a', failures: 3, reproductions: 2 })).toBe(false);
  });

  it('reports a flake rate rather than hiding the instability', () => {
    expect(flakeRate({ fingerprint: 'a', failures: 4, reproductions: 1 })).toBe(0.75);
  });
});
