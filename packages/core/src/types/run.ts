import type { FileRef, FindingId, FlowId, ProjectId, RunId, ScreenId } from './ids.js';

export type TestPlanReason = 'direct-change' | 'shared-component' | 'flow-member' | 'smoke-fallback' | 'always-on';

export type TestPlanItem = {
  target: { screenId?: ScreenId; viewport?: string; flowId?: FlowId; invariant?: string };
  /** Printed in the report. A QA tool that hides what it tested cannot be trusted. */
  reason: TestPlanReason;
  viaFile?: FileRef;
};

export type TestPlan = {
  items: TestPlanItem[];
  mappingConfidence: number;
  coverage: { screensSelected: number; screensTotal: number };
};

export type RunMode = 'changed-only' | 'all' | 'smoke';
export type RunTrigger = 'push' | 'pr' | 'schedule' | 'manual' | 'slash';

export type RunCost = {
  decisionUsd: number;
  visionUsd: number;
  frontierUsd: number;
  tokens: number;
};

export type Run = {
  id: RunId;
  projectId: ProjectId;
  modelVersion: number;
  trigger: RunTrigger;
  mode: RunMode;
  commit: string;
  changedFiles: FileRef[];
  plan: TestPlan;
  status: 'running' | 'passed' | 'failed' | 'infra-error' | 'incomplete';
  exitCode: 0 | 1 | 2 | 3 | 4;
  startedAt: Date;
  endedAt?: Date;
  cost: RunCost;
  findingIds: FindingId[];
  /** What the Intent Ledger hid. Always shown in the report, never silent. */
  suppressionCount: number;
};
