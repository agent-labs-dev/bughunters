import type { Answer, DeciderName, DecisionRecord } from '@bughunters/core';

/**
 * Keyed on the state hash. This is the single largest cost and latency saving
 * in the system (spec 4.4): a screen whose state has not changed since the last
 * run costs zero model calls, because the previous decision is still the right
 * one.
 */
export interface DecisionCache {
  get(stateHash: string): Promise<DecisionRecord | undefined>;
  set(record: DecisionRecord): Promise<void>;
}

export class InMemoryDecisionCache implements DecisionCache {
  private readonly entries = new Map<string, DecisionRecord>();

  async get(stateHash: string): Promise<DecisionRecord | undefined> {
    return this.entries.get(stateHash);
  }

  async set(record: DecisionRecord): Promise<void> {
    this.entries.set(record.stateHash, record);
  }
}

export type BudgetState = {
  spentUsd: number;
  capUsd: number;
};

/**
 * When a budget is exhausted the run stops escalating and marks itself
 * INCOMPLETE. It never reports untested screens as passing -- a tool that
 * silently converts "I ran out of budget" into "green" is worse than no tool
 * (spec 13.3).
 */
export class Budget {
  private spent = 0;
  private exhausted = false;

  constructor(private readonly capUsd: number) {}

  canSpend(estimateUsd: number): boolean {
    return this.spent + estimateUsd <= this.capUsd;
  }

  record(usd: number): void {
    this.spent += usd;
    if (this.spent >= this.capUsd) this.exhausted = true;
  }

  get isExhausted(): boolean {
    return this.exhausted;
  }

  get state(): BudgetState {
    return { spentUsd: this.spent, capUsd: this.capUsd };
  }
}

/** Jev pricing: $0.042 per million input tokens, output free (spec 4.2). */
export const JEV_USD_PER_INPUT_TOKEN = 0.042 / 1_000_000;

/**
 * What one decision on a state of this size costs with a given decider.
 *
 * Jev uses its published input rate. The general model estimate assumes the
 * spec 4.8 mid-tier frontier rate ($3/M input, $15/M output), including prompt
 * and output tokens. Heuristic and local make no paid call.
 */
export function estimateDecisionCost(stateChars: number, decider: DeciderName = 'jev'): number {
  // ~4 chars per token is close enough for a budget guard.
  if (decider === 'jev') return (stateChars / 4) * JEV_USD_PER_INPUT_TOKEN;
  if (decider === 'model') return ((stateChars / 4 + 1500) * 3 + 900 * 15) / 1_000_000;
  return 0;
}

export function answersSummary(answers: Record<string, Answer>): string {
  return Object.entries(answers)
    .map(([k, a]) => `${k}=${'value' in a ? a.value : '?'}@${a.confidence.toFixed(2)}`)
    .join(' ');
}
