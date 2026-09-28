import type { Finding, Run } from '@bugpatrol/core';
import { id } from '@bugpatrol/core';
import { describe, expect, it } from 'vitest';
import { renderHtml } from './html.js';
import { toJUnit } from './junit.js';
import { renderPrComment, STICKY_MARKER } from './pr-comment.js';
import { toSarif } from './sarif.js';

const run: Run = {
  id: id.run('run_1'),
  projectId: id.project('p1'),
  modelVersion: 1,
  trigger: 'pr',
  mode: 'changed-only',
  commit: 'abcdef1234567890',
  changedFiles: [id.file('src/Button.tsx')],
  plan: {
    items: [
      { target: { screenId: id.screen('/settings') }, reason: 'shared-component', viaFile: id.file('src/Button.tsx') },
    ],
    mappingConfidence: 0.9,
    coverage: { screensSelected: 1, screensTotal: 12 },
  },
  status: 'failed',
  exitCode: 1,
  startedAt: new Date('2026-09-20T00:00:00Z'),
  cost: { decisionUsd: 0.00017, visionUsd: 0, frontierUsd: 0, tokens: 4000 },
  findingIds: [id.finding('f1')],
  suppressionCount: 2,
};

const finding: Finding = {
  id: id.finding('f1'),
  runId: run.id,
  fingerprint: 'fp_abc',
  screenId: id.screen('/settings'),
  ruleId: 'layout/occlusion',
  tier: 'tier1',
  classification: 'regression',
  severity: 'critical',
  confidence: 0.97,
  route: 'check',
  summary: 'The Save button is covered by the sticky footer and cannot be clicked.',
  evidence: {},
  suspectedFiles: [id.file('src/Button.tsx')],
  status: 'open',
};

describe('renderHtml', () => {
  it('renders the test plan with the reason each item was selected', () => {
    const html = renderHtml({ run, findings: [finding], suppressed: 2, quarantined: 0, notes: [] });
    expect(html).toContain('shared-component');
    expect(html).toContain('1/12 screens');
  });

  it('always reports what was suppressed', () => {
    const html = renderHtml({ run, findings: [], suppressed: 7, quarantined: 1, notes: [] });
    expect(html).toContain('<strong>7</strong>');
    expect(html).toContain('<strong>1</strong>');
  });
});

describe('renderPrComment', () => {
  it('carries the sticky marker so it is edited rather than appended', () => {
    expect(renderPrComment({ run, findings: [finding], suppressed: 0 })).toContain(STICKY_MARKER);
  });

  it('distinguishes an infrastructure failure from a product failure', () => {
    const body = renderPrComment({ run: { ...run, status: 'infra-error', exitCode: 4 }, findings: [], suppressed: 0 });
    expect(body).toContain('could not test');
    expect(body).toContain('does not block');
  });

  it('flags low mapping confidence instead of silently under-testing', () => {
    const body = renderPrComment({
      run: { ...run, plan: { ...run.plan, mappingConfidence: 0.3 } },
      findings: [],
      suppressed: 0,
    });
    expect(body).toContain('low mapping confidence');
  });
});

describe('exports', () => {
  it('emits JUnit with the blocking finding as a failure', () => {
    const xml = toJUnit(run, [finding]);
    expect(xml).toContain('failures="1"');
    expect(xml).toContain('layout/occlusion');
  });

  it('marks only blocking findings as SARIF errors', () => {
    const blocking = JSON.parse(toSarif([finding]));
    expect(blocking.runs[0].results[0].level).toBe('error');
    const advisory = JSON.parse(toSarif([{ ...finding, route: 'issue' }]));
    expect(advisory.runs[0].results[0].level).toBe('warning');
  });

  it('carries the fingerprint so SARIF consumers can dedupe across runs', () => {
    const sarif = JSON.parse(toSarif([finding]));
    expect(sarif.runs[0].results[0].partialFingerprints.bugpatrolFingerprint).toBe('fp_abc');
  });
});

describe('JUnit attribution and completeness', () => {
  it('attributes a finding only to its screen and viewport', () => {
    const plan = {
      ...run.plan,
      items: [
        { target: { screenId: id.screen('/settings'), viewport: 'desktop' }, reason: 'always-on' as const },
        { target: { screenId: id.screen('/settings'), viewport: 'mobile' }, reason: 'always-on' as const },
        { target: { screenId: id.screen('/other'), viewport: 'desktop' }, reason: 'always-on' as const },
      ],
    };
    const xml = toJUnit({ ...run, plan }, [{ ...finding, viewport: 'mobile' }]);
    expect(xml.match(/<failure /g)).toHaveLength(1);
    expect(xml).toContain('name="/settings @desktop" />');
    expect(xml).toContain('name="/other @desktop" />');
    expect(xml).toContain('tests="3" failures="1"');
  });
  it('records an incomplete run as an error even without selected tests', () => {
    const xml = toJUnit({ ...run, status: 'incomplete', plan: { ...run.plan, items: [] } }, []);
    expect(xml).toContain('tests="1" failures="0" errors="1"');
    expect(xml).toContain('<error type="incomplete">');
  });
  it('retains unmatched blocking findings and counts failed cases, not findings', () => {
    const xml = toJUnit(run, [finding, { ...finding, id: id.finding('second') }]);
    expect(xml).toContain('tests="1" failures="1"');
    expect(toJUnit({ ...run, plan: { ...run.plan, items: [] } }, [finding])).toContain('<failure');
  });
});
