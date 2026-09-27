import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ExitCode,
  fingerprint as makeFingerprint,
  id,
  paths,
  type BughuntersConfig,
  type ExitCodeValue,
  type Finding,
  type Run,
  type RunMode,
  type RunTrigger,
  type Severity,
  type TestPlanItem,
  type RunTrace,
  type ScreenTrace,
  type FindingTrace,
  type CheckOutcome,
} from '@bughunters/core';
import { RULES, evaluateAll, type InvariantViolation, type ScreenSnapshot } from '@bughunters/invariants';
import { evaluate as evaluateTolerance, type CrossCheckResult } from '@bughunters/diff';
import {
  Budget,
  SCREEN_QUESTIONS,
  buildState,
  resolveDecider,
  type Resolution,
  estimateDecisionCost,
  route as routeDecision,
  severityFrom,
  violationsToAssertions,
} from '@bughunters/decide';
import { IntentLedger, applyNoiseControls, cluster } from '@bughunters/triage';
import { renderHtml, toJUnit, toSarif } from '@bughunters/report';

/** One screen, in one viewport, after capture and comparison. */
export type CapturedScreen = {
  screenId: string;
  url: string;
  viewport: string;
  snapshot: ScreenSnapshot;
  baselineSnapshot?: ScreenSnapshot;
  /** Absent when this run created the baseline rather than comparing to one. */
  comparison?: CrossCheckResult;
  baselineCreated: boolean;
  artifacts: { actual: string; baseline?: string; diff?: string };
  planReason: TestPlanItem['reason'];
  /** Capture provenance, carried into the trace so a run can be audited. */
  stability?: { frames: number; elapsedMs: number };
  maskedSelectors?: string[];
  missingFonts?: string[];
};

export type PipelineOptions = {
  root: string;
  config: BughuntersConfig;
  mode: RunMode;
  trigger: RunTrigger;
  commit: string;
  noModels: boolean;
  isFirstRun: boolean;
  screens: CapturedScreen[];
  totalScreens: number;
  notes?: string[];
};

export type RunResult = {
  run: Run;
  findings: Finding[];
  exitCode: ExitCodeValue;
  reportPath: string;
  runDir: string;
  trace: RunTrace;
  notes: string[];
};

/** Every rule id the trace can report on, including the visual ones. */
const ALL_RULE_IDS: string[] = [
  'visual/pixel-diff',
  'visual/baseline-missing',
  'visual/hollow-test',
  'visual/masked-and-relaxed',
  'visual/engine-disagreement',
  ...RULES.map((r) => r.id),
];

export const PIXEL_DIFF_RULE = 'visual/pixel-diff';
export const BASELINE_MISSING_RULE = 'visual/baseline-missing';

/**
 * Tier 1 runs first and for free, the decision layer only sees screens that are
 * already non-clean, then triage, then the report surfaces.
 *
 * The rule that shapes all of it: only a tier-1 deterministic regression may
 * fail a Check. Everything the decision layer produces becomes an issue, a
 * question, or a suggestion -- never a red build -- so a red Check always means
 * the same thing.
 */
export async function executeRun(options: PipelineOptions): Promise<RunResult> {
  const { config, root } = options;
  const runId = id.run(`run_${Date.now().toString(36)}`);
  const startedAt = new Date();

  const ledger = IntentLedger.load(root);
  const disabled = ledger.disabledRuleIds();
  const resolution: Resolution = options.noModels
    ? { via: 'none', reason: 'Decider: none because --no-models was set.' }
    : resolveDecider(config.decisions, process.env as Record<string, string>);
  const { decider } = resolution;
  const budget = new Budget(config.decisions.budget.perRunUsd);

  const findings: Finding[] = [];
  const notes = [...(options.notes ?? [])];
  notes.push(resolution.reason);
  let suppressed = 0;
  let decisionUsd = 0;
  let incomplete = options.screens.length === 0;
  if (incomplete) notes.push('No screens were selected: nothing was verified.');

  const screenTraces: ScreenTrace[] = [];
  const findingTraces: FindingTrace[] = [];
  const suppressedTrace: RunTrace['suppressed'] = [];

  const seenDegradations = new Set<string>();
  for (const screen of options.screens) {
    if (!screen.baselineCreated && !screen.comparison) incomplete = true;
    const violations = evaluateAll(screen.snapshot, { baseline: screen.baselineSnapshot, disabled });
    const visual = visualViolations(screen, config);
    const all = [...visual, ...violations];

    const trace: ScreenTrace = {
      screenId: screen.screenId,
      viewport: screen.viewport,
      url: screen.url,
      title: screen.snapshot.title,
      planReason: screen.planReason,
      baselineCreated: screen.baselineCreated,
      artifacts: screen.artifacts,
      stability: screen.stability,
      maskedSelectors: screen.maskedSelectors ?? [],
      missingFonts: screen.missingFonts ?? [],
      consoleErrors: screen.snapshot.consoleErrors,
      links: (screen.snapshot.links ?? []).map((l) => ({ href: l.href, text: l.text, external: l.external, download: l.download, type: l.type })),
      diff: screen.comparison ? toDiffTrace(screen.comparison) : undefined,
      checks: describeChecks(all, disabled),
      findingIds: [],
    };
    screenTraces.push(trace);

    // A clean screen still gets a trace. "Nothing fired here" is exactly what
    // someone auditing a green run needs to see.
    if (all.length === 0) {
      trace.decision = { decider: 'none', skippedReason: 'Tier 1 was clean, so nothing needed deciding.' };
      continue;
    }

    const { text, hash } = buildState({
      screen: { id: screen.screenId, description: screen.url },
      product: { summary: '', audience: '', domainVocabulary: [] },
      assertions: violationsToAssertions(all),
      diff: screen.comparison
        ? {
            changedPixels: screen.comparison.primary.changedPixels,
            changedPercent: screen.comparison.primary.changedFraction * 100,
            maskedPercent: screen.comparison.primary.maskedFraction * 100,
            regions: screen.comparison.primary.regions.length,
          }
        : undefined,
      console: screen.snapshot.consoleErrors,
      knownIntents: ledger.summaries(),
    });

    const estimate = decider ? estimateDecisionCost(text.length) : 0;
    let answers = {};
    if (!decider) {
      trace.decision = {
        decider: 'none',
        skippedReason: options.noModels
          ? 'Offline mode (--no-models): the deterministic tier decided this on its own.'
          : 'No decider key is set: the deterministic tier decided this on its own.',
        stateHash: hash,
        stateChars: text.length,
      };
    } else if (budget.canSpend(estimate)) {
      answers = await decider.ask(text, SCREEN_QUESTIONS);
      budget.record(estimate);
      decisionUsd += estimate;
      trace.decision = {
        decider: decider.name,
        stateHash: hash,
        stateChars: text.length,
        answers,
        costUsd: estimate,
      };
    } else {
      // Budget exhausted. The run is INCOMPLETE, not green: a tool that
      // silently converts "I ran out of budget" into "passing" is worse than
      // no tool (spec 13.3).
      incomplete = true;
      trace.decision = {
        decider: 'none',
        skippedReason: `Per-run budget of $${config.decisions.budget.perRunUsd} was exhausted before this screen.`,
        stateHash: hash,
        stateChars: text.length,
      };
    }

    for (const violation of all) {
      const fp = makeFingerprint({
        screenId: `${screen.screenId}::${screen.viewport}`,
        ruleId: violation.ruleId,
        regions: violation.region ? [violation.region] : [],
        // The element, not just where it is: two violations of one rule inside
        // a single 32px grid cell otherwise shared a fingerprint, and with it a
        // finding id, a ledger entry and a dashboard slot. Safe now that probe
        // selectors are unique in the document.
        domNodeSignature: violation.selector,
      });

      const draft: Finding = {
        id: id.finding(`fnd_${fp}`),
        runId,
        fingerprint: fp,
        screenId: id.screen(screen.screenId),
        ruleId: violation.ruleId,
        tier: 'tier1',
        classification: classify(violation.ruleId),
        severity: violation.severity,
        confidence: 1,
        route: 'issue',
        summary: violation.message,
        evidence: {
          before: screen.artifacts.baseline ? id.artifact(screen.artifacts.baseline) : undefined,
          after: id.artifact(screen.artifacts.actual),
          diff: screen.artifacts.diff ? id.artifact(screen.artifacts.diff) : undefined,
          console: screen.snapshot.consoleErrors.slice(0, 10),
        },
        suspectedFiles: [],
        status: 'open',
      };

      const matchedIntent = ledger.match(draft);
      if (matchedIntent) {
        suppressed++;
        suppressedTrace.push({
          ruleId: violation.ruleId,
          screenId: screen.screenId,
          reason: matchedIntent.reason,
          decidedBy: matchedIntent.decidedBy,
        });
        continue;
      }

      const outcome = routeDecision({
        answers,
        thresholds: config.decisions.confidence,
        hasDeterministicRegression: violation.severity === 'critical' || violation.severity === 'major',
        matchedLedger: false,
      });

      trace.findingIds.push(draft.id);
      findingTraces.push({ findingId: draft.id, routeReason: outcome.reason });
      findings.push({
        ...draft,
        // The decider grades user impact, but it may only ever soften a tier-1
        // severity that the deterministic layer already established -- it must
        // not quietly downgrade a critical into a cosmetic.
        severity: worstOf(violation.severity, severityFrom(answers['severity' as keyof typeof answers])),
        route: outcome.route === 'escalate' ? 'question' : outcome.route,
        status: outcome.route === 'question' ? 'question' : 'open',
      });
    }
  }

  const groups = await cluster(findings);
  const noise = applyNoiseControls(groups, { isFirstRun: options.isFirstRun });
  notes.push(...noise.notes);
  if (incomplete) notes.push('This run is INCOMPLETE: coverage, baseline evidence, or decision budget was unavailable.');

  const created = options.screens.filter((s) => s.baselineCreated).length;
  if (created > 0) {
    notes.push(`${created} baseline(s) captured for the first time. Nothing can regress against a baseline it just created.`);
  }
  for (const screen of options.screens) {
    // First line only: the underlying loader error can be a dozen lines of
    // symbol dumps, and the note exists to flag the degradation, not to debug it.
    if (screen.comparison?.degraded) {
      const line = screen.comparison.degraded.split('\n')[0]!;
      if (!seenDegradations.has(line)) {
        seenDegradations.add(line);
        notes.push(line);
      }
    }
  }

  const blocking = noise.blockingAllowed ? findings.filter((f) => f.route === 'check') : [];
  if (!noise.blockingAllowed && findings.some((f) => f.route === 'check')) {
    notes.push('First run: regressions are reported but do not block.');
  }

  const exitCode: ExitCodeValue = blocking.length > 0 ? ExitCode.Regression : incomplete ? ExitCode.Infrastructure : ExitCode.Clean;
  const selected = new Set(options.screens.map((s) => s.screenId));

  const run: Run = {
    id: runId,
    projectId: id.project('local'),
    modelVersion: 1,
    trigger: options.trigger,
    mode: options.mode,
    commit: options.commit,
    changedFiles: [],
    plan: {
      items: options.screens.map((s) => ({
        target: { screenId: id.screen(`${s.screenId} @${s.viewport}`) },
        reason: s.planReason,
      })),
      mappingConfidence: 1,
      coverage: { screensSelected: selected.size, screensTotal: options.totalScreens },
    },
    status: incomplete ? 'incomplete' : blocking.length > 0 ? 'failed' : 'passed',
    exitCode,
    startedAt,
    endedAt: new Date(),
    cost: { decisionUsd, visionUsd: 0, frontierUsd: 0, tokens: 0 },
    findingIds: findings.map((f) => f.id),
    suppressionCount: suppressed,
  };

  const trace: RunTrace = {
    version: 1,
    runId,
    screens: screenTraces,
    findings: findingTraces,
    suppressed: suppressedTrace,
  };

  const { reportPath, runDir } = writeArtifacts(root, run, findings, { suppressed, notes, trace });
  return { run, findings, exitCode, reportPath, runDir, trace, notes };
}

/**
 * Turns the pixel comparison into tier-1 violations. The tolerance policy owns
 * the pass/fail call, so the hollow-test and masked-and-relaxed flags it raises
 * travel with the finding instead of being dropped on the floor.
 */
function visualViolations(screen: CapturedScreen, config: BughuntersConfig): InvariantViolation[] {
  if (screen.baselineCreated) return [];
  if (!screen.comparison) {
    return [
      {
        ruleId: BASELINE_MISSING_RULE,
        message: `No baseline exists for "${screen.screenId}" at ${screen.viewport}, so this screen was captured but not verified.`,
        severity: 'minor',
      },
    ];
  }

  const relaxed = config.tolerance.regions.filter((r) => screen.url.includes(r.screen)).map((r) => r.selector);
  const verdict = evaluateTolerance(screen.comparison.primary, { relaxedRegionSelectors: relaxed });

  const out: InvariantViolation[] = [];
  // A flag is worth reporting even when the diff passed -- that is the whole
  // point of surfacing a green result that is green because the test got weaker.
  for (const flag of verdict.flags) {
    out.push({
      ruleId: `visual/${flag.split(':')[0]}`,
      message: flag.slice(flag.indexOf(':') + 1).trim(),
      severity: 'minor',
      detail: { maskedFraction: screen.comparison.primary.maskedFraction },
    });
  }

  if (verdict.pass) return out;

  out.unshift({
    ruleId: PIXEL_DIFF_RULE,
    message: `"${screen.screenId}" no longer matches its baseline at ${screen.viewport}: ${verdict.reason}`,
    severity: screen.comparison.primary.dimensionMismatch ? 'major' : 'major',
    region: screen.comparison.primary.regions[0],
    detail: {
      changedPixels: screen.comparison.primary.changedPixels,
      changedFraction: screen.comparison.primary.changedFraction,
      maskedFraction: screen.comparison.primary.maskedFraction,
      engine: screen.comparison.primary.engine,
      enginesAgreed: screen.comparison.agreed,
    },
  });

  if (!screen.comparison.agreed) {
    // Two engines that share a colour-distance implementation disagreeing means
    // something is wrong with the capture, not the app.
    out.push({
      ruleId: 'visual/engine-disagreement',
      message: `The two diff engines disagree on "${screen.screenId}" (${screen.comparison.primary.changedPixels} vs ${screen.comparison.crossCheck?.changedPixels} pixels), which points at the capture rather than the app.`,
      severity: 'minor',
    });
  }

  return out;
}

function toDiffTrace(comparison: CrossCheckResult): NonNullable<ScreenTrace['diff']> {
  const p = comparison.primary;
  return {
    engine: p.engine,
    identical: p.identical,
    changedPixels: p.changedPixels,
    changedFraction: p.changedFraction,
    maskedFraction: p.maskedFraction,
    maskedRegionCount: p.maskedRegionCount,
    regionCount: p.regions.length,
    regions: p.regions.slice(0, 200),
    dimensionMismatch: p.dimensionMismatch,
    enginesAgreed: comparison.agreed,
    crossCheckChangedPixels: comparison.crossCheck?.changedPixels,
    degraded: comparison.degraded,
    durationMs: p.durationMs,
  };
}

/**
 * Every rule that could have fired, with whether it did. Listing the silent
 * ones is the point: a reader needs to know a check ran and passed, not just
 * that no finding appeared.
 */
function describeChecks(fired: InvariantViolation[], disabled: string[]): CheckOutcome[] {
  const byRule = new Map<string, InvariantViolation>();
  for (const v of fired) if (!byRule.has(v.ruleId)) byRule.set(v.ruleId, v);

  const out: CheckOutcome[] = [];
  for (const rule of ALL_RULE_IDS) {
    if (disabled.includes(rule)) continue;
    const hit = byRule.get(rule);
    out.push(hit ? { ruleId: rule, fired: true, severity: hit.severity, message: hit.message, detail: hit.detail } : { ruleId: rule, fired: false });
  }
  for (const [ruleId, v] of byRule) {
    if (!ALL_RULE_IDS.includes(ruleId)) {
      out.push({ ruleId, fired: true, severity: v.severity, message: v.message, detail: v.detail });
    }
  }
  return out;
}

function classify(ruleId: string): Finding['classification'] {
  if (ruleId.startsWith('visual/')) return 'regression';
  if (ruleId.startsWith('usability/contrast')) return 'a11y';
  if (ruleId.startsWith('runtime/')) return 'functional-bug';
  return 'regression';
}

const SEVERITY_RANK: Record<Severity, number> = { cosmetic: 0, minor: 1, major: 2, critical: 3 };

function worstOf(a: Severity, b: Severity): Severity {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

function writeArtifacts(
  root: string,
  run: Run,
  findings: Finding[],
  meta: { suppressed: number; notes: string[]; trace: RunTrace },
): { reportPath: string; runDir: string } {
  const dir = paths.run(root, run.id);
  mkdirSync(dir, { recursive: true });
  const reportPath = join(dir, 'report.html');
  writeFileSync(
    reportPath,
    renderHtml({ run, findings, suppressed: meta.suppressed, quarantined: 0, notes: meta.notes }),
  );
  writeFileSync(join(dir, 'junit.xml'), toJUnit(run, findings));
  writeFileSync(join(dir, 'results.sarif'), toSarif(findings));
  writeFileSync(join(dir, 'run.json'), `${JSON.stringify({ run, findings }, null, 2)}\n`);
  writeFileSync(join(dir, 'trace.json'), `${JSON.stringify(meta.trace, null, 2)}\n`);
  return { reportPath, runDir: dir };
}
