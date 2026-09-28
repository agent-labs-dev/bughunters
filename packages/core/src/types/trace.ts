import type { Answer, DeciderName } from './decision.js';
import type { FindingId, RunId } from './ids.js';
import type { Severity } from './finding.js';

/**
 * The record of what Bugpatrol actually did on one screen, and why it concluded
 * what it concluded.
 *
 * This exists because "trust me, it is a regression" is not good enough. Spec
 * 11.5 requires every consequential action to be replayable: which commit was
 * tested, what the plan was and why, which model made which decision at what
 * confidence, and what was suppressed by whom. The trace is that record, and it
 * is what the dashboard renders -- a finding you cannot audit is a finding
 * nobody will act on.
 */
export type CheckOutcome = {
  ruleId: string;
  /** False when the rule ran and found nothing, which is worth showing too. */
  fired: boolean;
  severity?: Severity;
  message?: string;
  detail?: Record<string, number | string | boolean>;
};

export type DiffTrace = {
  engine: string;
  identical: boolean;
  changedPixels: number;
  changedFraction: number;
  maskedFraction: number;
  maskedRegionCount: number;
  regionCount: number;
  regions: Array<{ x: number; y: number; width: number; height: number }>;
  dimensionMismatch?: { baseline: [number, number]; actual: [number, number] };
  enginesAgreed: boolean;
  crossCheckChangedPixels?: number;
  degraded?: string;
  durationMs: number;
};

export type DecisionTrace = {
  decider: DeciderName | 'none';
  /** Why no decider ran: offline mode, exhausted budget, or nothing to decide. */
  skippedReason?: string;
  stateHash?: string;
  stateChars?: number;
  answers?: Record<string, Answer>;
  costUsd?: number;
};

export type ScreenTrace = {
  screenId: string;
  viewport: string;
  url: string;
  title?: string;
  /** Why this screen was in the plan at all. */
  planReason: string;
  baselineCreated: boolean;
  artifacts: { actual?: string; baseline?: string; diff?: string };
  stability?: { frames: number; elapsedMs: number };
  maskedSelectors: string[];
  missingFonts: string[];
  consoleErrors: string[];
  links: Array<{ href: string; text: string; external: boolean; download?: boolean; type?: string }>;
  diff?: DiffTrace;
  /** Every rule that ran, including the ones that found nothing. */
  checks: CheckOutcome[];
  decision?: DecisionTrace;
  findingIds: FindingId[];
};

/**
 * Per-finding explanation. `routeReason` is the sentence the router produced
 * when it decided where this finding should surface -- discarding it was the
 * difference between a tool that shows its work and one that asserts.
 */
export type FindingTrace = {
  findingId: FindingId;
  routeReason: string;
  /** Set when a ledger entry suppressed it, so suppression stays auditable. */
  suppressedBy?: { intentId: string; reason: string; decidedBy: string };
};

export type RunTrace = {
  version: 1;
  runId: RunId;
  screens: ScreenTrace[];
  findings: FindingTrace[];
  /** Suppressed findings never reach the findings list, so they are counted here. */
  suppressed: Array<{ ruleId: string; screenId: string; reason: string; decidedBy: string }>;
};

/**
 * Progress written DURING a run, one update per captured screen.
 *
 * The run artifacts are only written when the run completes, so without this
 * the dashboard has nothing to show while Bugpatrol is actually working -- and
 * watching it walk the app is most of the value of having a dashboard at all.
 */
export type LiveProgress = {
  version: 1;
  runId: string;
  status: 'running' | 'finished' | 'failed';
  startedAt: string;
  updatedAt: string;
  /** What the plan said to capture, so progress reads as N of M. */
  plannedCaptures: number;
  currentStep?: string;
  captured: Array<{
    screenId: string;
    viewport: string;
    url: string;
    title?: string;
    actual: string;
    baselineCreated: boolean;
    changedPixels?: number;
    links: Array<{ href: string; text: string; external: boolean; download?: boolean; type?: string }>;
  }>;
  /** Set when the run ended, so the UI can stop showing a spinner. */
  finishedRunId?: string;
  error?: string;
};
