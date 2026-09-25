import type { Decider, DecisionsConfig } from '@autoqa/core';
import { JevDecider } from './providers/jev.js';
import { LocalDecider, MODEL_ROUTES, ModelDecider, type ModelVia } from './providers/model.js';
import { HeuristicDecider } from './providers/heuristic.js';

export * from './questions.js';
export * from './state.js';
export * from './thresholds.js';
export * from './cache.js';
export { JevDecider, ModelDecider, LocalDecider, HeuristicDecider };
export { MODEL_ROUTES } from './providers/model.js';

export type DeciderEnv = {
  TYPESAFE_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  AI_GATEWAY_API_KEY?: string;
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  AUTOQA_MODEL_ENDPOINT?: string;
  AUTOQA_MODEL_API_KEY?: string;
  AUTOQA_MODEL_NAME?: string;
};

const JEV_ROUTES = {
  typesafe: { key: 'TYPESAFE_API_KEY', endpoint: 'https://api.typesafe.ai/v1/systemone', model: 'jev-latest' },
  openrouter: { key: 'OPENROUTER_API_KEY', endpoint: 'https://openrouter.ai/api/v1/systemone', model: 'jev-latest' },
  vercel: { key: 'AI_GATEWAY_API_KEY', endpoint: 'https://ai-gateway.vercel.sh/typesafe/v1/systemone', model: 'typesafe-ai/jev' },
} as const;
export const MODEL_KEYS = {
  openrouter: 'OPENROUTER_API_KEY',
  vercel: 'AI_GATEWAY_API_KEY',
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  custom: 'AUTOQA_MODEL_API_KEY',
} as const;
const jevOrder = ['typesafe', 'openrouter', 'vercel'] as const;
const modelOrder = ['openrouter', 'vercel', 'openai', 'anthropic', 'custom'] as const;

type Resolution = { decider: Decider; via: string; reason: string };

/**
 * Access paths are tried in order: TypeSafe, then gateway routes through
 * OpenRouter and Vercel AI Gateway, then ModelDecider (spec 4.6).
 * `--no-models` short-circuits to the heuristic. A missing key degrades the
 * tool rather than breaking it, because Jev is waitlisted.
 */
export function resolveDecider(
  config: DecisionsConfig,
  env: DeciderEnv,
  options: { noModels?: boolean } = {},
): Resolution {
  if (options.noModels) return {
    decider: new HeuristicDecider(),
    via: 'heuristic',
    reason: 'Decider: heuristic because --no-models was set.',
  };
  if (config.decider === 'heuristic') return {
    decider: new HeuristicDecider(),
    via: 'heuristic',
    reason: 'Decider: heuristic by configuration.',
  };
  if (config.decider === 'local') return {
    decider: new LocalDecider(),
    via: 'local',
    reason: 'Decider: local by configuration.',
  };

  let jevMissing = '';
  if (config.decider === 'jev') {
    const routes = config.jev.via === 'auto' ? jevOrder : [config.jev.via];
    for (const via of routes) {
      const route = JEV_ROUTES[via];
      const key = env[route.key];
      if (key) return {
        decider: new JevDecider({ apiKey: key, endpoint: route.endpoint, model: route.model }),
        via: `jev:${via}`,
        reason: `Decider: jev via ${via} (${route.model}).`,
      };
    }
    jevMissing = `decider is jev, but no ${routes
      .map((via) => JEV_ROUTES[via].key)
      .join(', ')
      .replace(/, ([^,]*)$/, ' or $1')} is set`;
  }

  const routes = config.model.via === 'auto' ? modelOrder : [config.model.via];
  for (const via of routes) {
    const key = env[MODEL_KEYS[via]];
    if (!key || (via === 'custom' && !env.AUTOQA_MODEL_ENDPOINT)) continue;
    const name = config.model.name || env.AUTOQA_MODEL_NAME || MODEL_ROUTES[via].model;
    const endpoint = via === 'custom' ? env.AUTOQA_MODEL_ENDPOINT : MODEL_ROUTES[via].endpoint;
    return {
      decider: new ModelDecider({ via: via as ModelVia, apiKey: key, endpoint, model: name }),
      via: `model:${via}`,
      reason: jevMissing
        ? `Decider: model via ${via} (${name}) because ${jevMissing}.`
        : `Decider: model via ${via} (${name}).`,
    };
  }

  const modelMissing = routes
    .map((via) => via === 'custom' ? 'AUTOQA_MODEL_ENDPOINT and AUTOQA_MODEL_API_KEY' : MODEL_KEYS[via])
    .join(', ')
    .replace(/, ([^,]*)$/, ' or $1');
  return {
    decider: new HeuristicDecider(),
    via: 'heuristic',
    reason: `Decider: heuristic because ${jevMissing ? `${jevMissing}, and ` : ''}no ${modelMissing} is set.`,
  };
}

export function createDecider(
  config: DecisionsConfig,
  env: DeciderEnv = process.env as DeciderEnv,
  options: { noModels?: boolean } = {},
): Decider {
  return resolveDecider(config, env, options).decider;
}
