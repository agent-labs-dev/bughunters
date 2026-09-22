import type { Answer, Decider, Question } from '@autoqa/core';
import { HeuristicDecider } from './heuristic.js';

export type ModelDeciderOptions = {
  /** Any chat-completions-compatible endpoint. */
  endpoint: string;
  apiKey: string;
  model: string;
};

/**
 * A general model prompted into the same typed contract. This is the fallback
 * that makes the Jev dependency non-structural: Jev is early access, gated
 * behind a waitlist and rate-limited, and a production tool cannot hard-depend
 * on that (spec 4.6).
 *
 * The contract it must satisfy is the interface, not the prompt -- so swapping
 * deciders is a config change and the caller never knows which one ran.
 */
export class ModelDecider implements Decider {
  readonly name = 'model' as const;

  constructor(private readonly options: ModelDeciderOptions) {}

  async ask(state: string, questions: Record<string, Question>): Promise<Record<string, Answer>> {
    // M4. Until then, the interface is honoured by degrading to the timid
    // decider rather than by throwing -- callers must always get valid,
    // low-confidence answers, which route to a human.
    void this.options;
    void state;
    return new HeuristicDecider().ask(state, questions);
  }
}

/**
 * A locally hosted classifier or small model, for air-gapped deployments where
 * "is this data sent to a model provider?" is a procurement blocker rather than
 * a preference (spec 11.2).
 */
export class LocalDecider implements Decider {
  readonly name = 'local' as const;

  constructor(private readonly endpoint = 'http://127.0.0.1:11434') {}

  async ask(state: string, questions: Record<string, Question>): Promise<Record<string, Answer>> {
    void this.endpoint;
    return new HeuristicDecider().ask(state, questions);
  }
}
