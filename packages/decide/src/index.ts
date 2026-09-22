import type { Decider, DecisionsConfig } from '@autoqa/core';
import { JevDecider } from './providers/jev.js';
import { LocalDecider, ModelDecider } from './providers/model.js';
import { HeuristicDecider } from './providers/heuristic.js';

export * from './questions.js';
export * from './state.js';
export * from './thresholds.js';
export * from './cache.js';
export { JevDecider, ModelDecider, LocalDecider, HeuristicDecider };

export type DeciderEnv = {
  TYPESAFE_API_KEY?: string;
  AUTOQA_MODEL_ENDPOINT?: string;
  AUTOQA_MODEL_API_KEY?: string;
  AUTOQA_MODEL_NAME?: string;
};

/**
 * Access paths are tried in order: the official SDK path against
 * api.typesafe.ai, then a gateway route, then ModelDecider (spec 4.6).
 * `--no-models` short-circuits all of it to the heuristic decider.
 */
export function createDecider(
  config: DecisionsConfig,
  env: DeciderEnv = process.env as DeciderEnv,
  options: { noModels?: boolean } = {},
): Decider {
  if (options.noModels || config.decider === 'heuristic') return new HeuristicDecider();
  if (config.decider === 'local') return new LocalDecider();

  if (config.decider === 'jev') {
    if (env.TYPESAFE_API_KEY) return new JevDecider({ apiKey: env.TYPESAFE_API_KEY });
    // Falling through rather than failing: Jev is waitlisted, and a missing key
    // must degrade the tool, not break it.
  }

  if (env.AUTOQA_MODEL_ENDPOINT && env.AUTOQA_MODEL_API_KEY) {
    return new ModelDecider({
      endpoint: env.AUTOQA_MODEL_ENDPOINT,
      apiKey: env.AUTOQA_MODEL_API_KEY,
      model: env.AUTOQA_MODEL_NAME ?? 'default',
    });
  }

  return new HeuristicDecider();
}
