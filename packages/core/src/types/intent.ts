import type { IntentId, ProjectId, ScreenId, FindingId } from './ids.js';

export type IntentScope =
  | { kind: 'fingerprint'; fingerprint: string }
  | { kind: 'screen'; screenId: ScreenId }
  | { kind: 'selector'; screenId: ScreenId; selector: string }
  | { kind: 'rule'; ruleId: string }
  | { kind: 'rule-on-screen'; ruleId: string; screenId: ScreenId };

export type IntentDecision =
  | 'intended'
  | 'not-intended'
  | 'mute'
  | 'tune-tolerance'
  | 'exclude-screen';

/**
 * The Intent Ledger is AutoQA's institutional memory: the answer to a tool that
 * keeps flagging deliberate behaviour until people stop reading it. Entries
 * suppress matching findings AND are injected into the tier-2 state so the
 * decider recognises a known-intended class rather than rediscovering it.
 */
export type Intent = {
  id: IntentId;
  projectId: ProjectId;
  scope: IntentScope;
  decision: IntentDecision;
  reason: string;
  decidedBy: string;
  decidedAt: Date;
  /** Suppressions expire unless renewed, so they get revisited. */
  expiresAt?: Date;
  /** The question this answered, if it came from one. */
  sourceQuestionId?: FindingId;
};
