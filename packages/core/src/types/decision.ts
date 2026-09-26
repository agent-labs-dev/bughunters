import type { DecisionId, ScreenId } from './ids.js';

export type Question =
  | { type: 'noul'; instructions: string }
  | { type: 'choice'; instructions: string; criteria: Record<string, string> }
  | { type: 'score'; instructions: string; legend: string[] };

export type Answer =
  | { kind: 'noul'; value: number; confidence: number }
  | { kind: 'choice'; value: string; probabilities: Record<string, number>; confidence: number }
  | { kind: 'score'; value: number; probabilities: number[]; confidence: number; legend: string[] };

/**
 * The decider is an interface on purpose: Jev is early access and rate-limited,
 * so nothing structural may depend on a specific provider (spec 4.6). Because
 * answers are typed, the caller never knows which implementation ran.
 */
export interface Decider {
  readonly name: 'jev' | 'model';
  ask(state: string, questions: Record<string, Question>): Promise<Record<string, Answer>>;
}

export type DeciderName = Decider['name'];

/** Every decision is replayable: model version, state hash, answers, confidences. */
export type DecisionRecord = {
  id: DecisionId;
  screenId: ScreenId;
  /** Keys the cache. Unchanged state = no model call at all. */
  stateHash: string;
  decider: DeciderName;
  modelVersion: string;
  answers: Record<string, Answer>;
  thresholds: { high: number; low: number };
  outcome: 'check' | 'issue' | 'question' | 'intent' | 'ignore' | 'escalate';
  latencyMs: number;
  costUsd: number;
  /** The feedback signal used to tune thresholds per repo. */
  humanReversedAt?: Date;
};
