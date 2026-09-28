import { describe, expect, it } from 'vitest';
import { parseSlashCommand } from './slash-commands.js';
import { requiredPermissions } from './permissions.js';
import { buildCheckRun } from './checks.js';
import { buildIssue, labelsFor } from './issues.js';
import { id, ExitCode } from '@bugpatrol/core';
import type { Finding, Run } from '@bugpatrol/core';

const run: Run = {
  id: id.run('r1'),
  projectId: id.project('p1'),
  modelVersion: 1,
  trigger: 'pr',
  mode: 'changed-only',
  commit: 'abc',
  changedFiles: [],
  plan: { items: [], mappingConfidence: 1, coverage: { screensSelected: 3, screensTotal: 10 } },
  status: 'failed',
  exitCode: 1,
  startedAt: new Date(),
  cost: { decisionUsd: 0, visionUsd: 0, frontierUsd: 0, tokens: 0 },
  findingIds: [],
  suppressionCount: 0,
};

const finding: Finding = {
  id: id.finding('f1'),
  runId: run.id,
  fingerprint: 'fp1',
  screenId: id.screen('/settings'),
  ruleId: 'layout/occlusion',
  tier: 'tier1',
  classification: 'regression',
  severity: 'critical',
  confidence: 0.97,
  route: 'check',
  summary: 'The Save button is unreachable.',
  evidence: {},
  suspectedFiles: [id.file('src/Settings.tsx')],
  status: 'open',
};

describe('parseSlashCommand', () => {
  it('parses run and run --all', () => {
    expect(parseSlashCommand('/bugpatrol run')).toEqual({ kind: 'run', all: false });
    expect(parseSlashCommand('/bugpatrol run --all')).toEqual({ kind: 'run', all: true });
  });

  it('parses accept with a reason', () => {
    expect(parseSlashCommand('/bugpatrol accept f1 --reason "intentional"')).toEqual({
      kind: 'accept',
      findingId: 'f1',
      reason: 'intentional',
    });
  });

  it('parses a mute expiry so suppressions get revisited', () => {
    expect(parseSlashCommand('/bugpatrol mute fp1 --expires 30d')).toEqual({
      kind: 'mute',
      fingerprint: 'fp1',
      expiresInDays: 30,
    });
  });

  it('finds the command on any line of a longer comment', () => {
    expect(parseSlashCommand('Looks intentional to me.\n\n/bugpatrol accept f1')).toMatchObject({ kind: 'accept' });
  });

  it('ignores unrelated comments', () => {
    expect(parseSlashCommand('lgtm')).toBeUndefined();
  });
});

describe('requiredPermissions', () => {
  it('never requests contents:write unless fix PRs are enabled', () => {
    const readonly = requiredPermissions({ fixPRs: false });
    expect(readonly.some((p) => p.name === 'contents' && p.level === 'write')).toBe(false);

    const writable = requiredPermissions({ fixPRs: true });
    expect(writable.some((p) => p.name === 'contents' && p.level === 'write')).toBe(true);
  });
});

describe('buildCheckRun', () => {
  it('fails the check on a tier-1 regression', () => {
    expect(buildCheckRun(run, [finding]).conclusion).toBe('failure');
  });

  it('reports an infrastructure failure as neutral, not a product failure', () => {
    const payload = buildCheckRun({ ...run, exitCode: ExitCode.Infrastructure, status: 'infra-error' }, []);
    expect(payload.conclusion).toBe('neutral');
    expect(payload.output.summary).toContain('could not test');
  });

  it('asks for action when recon is required', () => {
    expect(buildCheckRun({ ...run, exitCode: ExitCode.ReconRequired }, []).conclusion).toBe('action_required');
  });

  it('annotates the mapped source file', () => {
    const payload = buildCheckRun(run, [finding]);
    expect(payload.output.annotations[0]).toMatchObject({ path: 'src/Settings.tsx', annotation_level: 'failure' });
  });
});

describe('buildIssue', () => {
  it('reports severity and confidence as numbers, not adjectives', () => {
    expect(buildIssue(finding, {}).body).toContain('confidence `0.97`');
  });

  it('says so explicitly when no source mapping resolved', () => {
    const body = buildIssue({ ...finding, suspectedFiles: [] }, {}).body;
    expect(body).toContain('unattributed');
  });

  it('always offers the one-action escape hatch', () => {
    expect(buildIssue(finding, {}).body).toContain('/bugpatrol accept');
  });

  it('labels a question so it never looks like a confirmed bug', () => {
    const labels = labelsFor({ ...finding, route: 'question' });
    expect(labels).toContain('needs-decision');
    expect(labels).not.toContain('bugpatrol:bug');
  });
});
