import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ExitCode,
  fingerprint as makeFingerprint,
  id,
  paths,
  type AutoQAConfig,
  type ExitCodeValue,
  type Finding,
  type Run,
  type RunMode,
} from '@autoqa/core';
import { AutoQAError, InfrastructureError } from '@autoqa/core';
import { evaluateAll, type ScreenSnapshot } from '@autoqa/invariants';
import { createDecider, buildState, violationsToAssertions, route as routeDecision, severityFrom, SCREEN_QUESTIONS, Budget, estimateDecisionCost } from '@autoqa/decide';
import { IntentLedger, cluster, applyNoiseControls } from '@autoqa/triage';
import { renderHtml, toJUnit, toSarif } from '@autoqa/report';

export type RunOptions = {
  root: string;
  config: AutoQAConfig;
  mode: RunMode;
  commit: string;
  noModels: boolean;
  isFirstRun: boolean;
  /** Supplied by the capture layer. Injected so the pipeline is testable. */
  snapshots: ScreenSnapshot[];
  /** Baseline snapshots keyed by screen id, when one exists. */
  baselines?: Map<string, ScreenSnapshot>;
};

export type RunResult = { run: Run; findings: Finding[]; exitCode: ExitCodeValue };

/**
 * The run pipeline: tier 1 deterministic checks, then the decision layer on
 * anything non-clean, then triage, then the four report surfaces.
 *
 * The rule that shapes all of it: only a tier-1 deterministic regression may
 * fail a check. Everything the decision layer produces becomes an issue, a
 * question, or a suggestion -- never a red build -- so a red check always means
 * the same thing.
 */
export async function executeRun(options: RunOptions): Promise<RunResult> {
  const { config, root } = options;
  const runId = id.run(`run_${Date.now().toString(36)}`);
  const startedAt = new Date();

  const ledger = IntentLedger.load(root);
  const decider = createDecider(config.decisions, process.env as Record<string, string>, {
    noModels: options.noModels,
  });
  const budget = new Budget(config.decisions.budget.perRunUsd);

  const findings: Finding[] = [];
  let suppressed = 0;
  let decisionUsd = 0;
  let incomplete = false;

  for (const snapshot of options.snapshots) {
    const baseline = options.baselines?.get(snapshot.screenId);
    const violations = evaluateAll(snapshot, {
      baseline,
      disabled: ledger.disabledRuleIds(),
    });
    if (violations.length === 0) continue;

    const hasDeterministicRegression = violations.some(
      (v) => v.severity === 'critical' || v.severity === 'major',
    );

    const { text, hash } = buildState({
      screen: { id: snapshot.screenId, description: snapshot.url },
      product: { summary: '', audience: '', domainVocabulary: [] },
      assertions: violationsToAssertions(violations),
      console: snapshot.consoleErrors,
      knownIntents: ledger.summaries(),
    });
    void hash;

    const estimate = estimateDecisionCost(text.length);
    let answers = {};
    if (budget.canSpend(estimate)) {
      answers = await decider.ask(text, SCREEN_QUESTIONS);
      budget.record(estimate);
      decisionUsd += estimate;
    } else {
      // Budget exhausted. The run is INCOMPLETE, not green: a tool that
      // silently converts "I ran out of budget" into "passing" is worse than
      // no tool (spec 13.3).
      incomplete = true;
    }

    for (const violation of violations) {
      const fp = makeFingerprint({
        screenId: snapshot.screenId,
        ruleId: violation.ruleId,
        regions: violation.region ? [violation.region] : [],
      });

      const draft: Finding = {
        id: id.finding(`fnd_${fp}`),
        runId,
        fingerprint: fp,
        screenId: id.screen(snapshot.screenId),
        ruleId: violation.ruleId,
        tier: 'tier1',
        classification: 'regression',
        severity: violation.severity,
        confidence: 1,
        route: 'issue',
        summary: violation.message,
        evidence: { console: snapshot.consoleErrors.slice(0, 10) },
        suspectedFiles: [],
        status: 'open',
      };

      const matched = ledger.match(draft);
      if (matched) {
        suppressed++;
        continue;
      }

      const outcome = routeDecision({
        answers,
        thresholds: config.decisions.confidence,
        hasDeterministicRegression,
        matchedLedger: false,
      });

      findings.push({
        ...draft,
        severity: severityFrom((answers as Record<string, never>)['severity']) ?? violation.severity,
        route: outcome.route === 'escalate' ? 'question' : outcome.route,
        status: outcome.route === 'question' ? 'question' : 'open',
      });
    }
  }

  const groups = await cluster(findings);
  const noise = applyNoiseControls(groups, { isFirstRun: options.isFirstRun });

  const blocking = noise.blockingAllowed ? findings.filter((f) => f.route === 'check') : [];
  const exitCode: ExitCodeValue = blocking.length > 0 ? ExitCode.Regression : ExitCode.Clean;

  const run: Run = {
    id: runId,
    projectId: id.project('local'),
    modelVersion: 1,
    trigger: 'manual',
    mode: options.mode,
    commit: options.commit,
    changedFiles: [],
    plan: {
      items: options.snapshots.map((s) => ({ target: { screenId: id.screen(s.screenId) }, reason: 'always-on' as const })),
      mappingConfidence: 1,
      coverage: { screensSelected: options.snapshots.length, screensTotal: options.snapshots.length },
    },
    status: incomplete ? 'incomplete' : blocking.length > 0 ? 'failed' : 'passed',
    exitCode,
    startedAt,
    endedAt: new Date(),
    cost: { decisionUsd, visionUsd: 0, frontierUsd: 0, tokens: 0 },
    findingIds: findings.map((f) => f.id),
    suppressionCount: suppressed,
  };

  writeArtifacts(root, run, findings, {
    suppressed,
    notes: [...noise.notes, ...(incomplete ? ['Budget exhausted: this run is INCOMPLETE, not clean.'] : [])],
  });

  return { run, findings, exitCode };
}

function writeArtifacts(
  root: string,
  run: Run,
  findings: Finding[],
  meta: { suppressed: number; notes: string[] },
): void {
  const dir = paths.run(root, run.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'report.html'), renderHtml({ run, findings, suppressed: meta.suppressed, quarantined: 0, notes: meta.notes }));
  writeFileSync(join(dir, 'junit.xml'), toJUnit(run, findings));
  writeFileSync(join(dir, 'results.sarif'), toSarif(findings));
  writeFileSync(join(dir, 'run.json'), `${JSON.stringify({ run, findings }, null, 2)}\n`);
}

export function exitCodeForError(error: unknown): ExitCodeValue {
  if (error instanceof InfrastructureError) return ExitCode.Infrastructure;
  if (error instanceof AutoQAError) return error.exitCode;
  return ExitCode.Infrastructure;
}
