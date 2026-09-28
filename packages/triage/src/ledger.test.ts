import type { Finding } from '@bugpatrol/core';
import { id } from '@bugpatrol/core';
import { describe, expect, it } from 'vitest';
import { IntentLedger } from './ledger.js';

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: id.finding('f1'),
    runId: id.run('r1'),
    fingerprint: 'abc123',
    screenId: id.screen('s1'),
    ruleId: 'layout/overlap',
    tier: 'tier1',
    classification: 'regression',
    severity: 'major',
    confidence: 0.9,
    route: 'check',
    summary: 'Two controls overlap.',
    evidence: {},
    suspectedFiles: [],
    status: 'open',
    ...overrides,
  };
}

describe('IntentLedger', () => {
  it('suppresses a matching fingerprint', () => {
    const ledger = new IntentLedger();
    ledger.add({
      projectId: id.project('p1'),
      scope: { kind: 'fingerprint', fingerprint: 'abc123' },
      decision: 'intended',
      reason: 'The overlap is the intended hover treatment.',
      decidedBy: 'ada',
    });
    expect(ledger.match(finding())).toBeDefined();
    expect(ledger.match(finding({ fingerprint: 'other' }))).toBeUndefined();
  });

  it('stops suppressing once an entry expires', () => {
    const ledger = new IntentLedger();
    ledger.add({
      projectId: id.project('p1'),
      scope: { kind: 'rule', ruleId: 'layout/overlap' },
      decision: 'mute',
      reason: 'Temporary, while the header is rebuilt.',
      decidedBy: 'ada',
      expiresAt: new Date('2026-01-01'),
    });
    expect(ledger.match(finding(), new Date('2025-12-01'))).toBeDefined();
    expect(ledger.match(finding(), new Date('2026-02-01'))).toBeUndefined();
  });

  it('exposes summaries for injection into the decision state', () => {
    const ledger = new IntentLedger();
    ledger.add({
      projectId: id.project('p1'),
      scope: { kind: 'screen', screenId: id.screen('s1') },
      decision: 'intended',
      reason: 'This dashboard is intentionally dense.',
      decidedBy: 'ada',
    });
    expect(ledger.summaries()[0]).toContain('intentionally dense');
  });

  it('reports rule-scoped suppressions so the invariant engine can skip them', () => {
    const ledger = new IntentLedger();
    ledger.add({
      projectId: id.project('p1'),
      scope: { kind: 'rule', ruleId: 'usability/tap-target' },
      decision: 'intended',
      reason: 'Desktop-only product.',
      decidedBy: 'ada',
    });
    expect(ledger.disabledRuleIds()).toEqual(['usability/tap-target']);
  });
});
