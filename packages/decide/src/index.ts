import type { Decider, DecisionsConfig } from '@bugpatrol/core';
import { MODEL_ROUTES, ModelDecider, type ModelVia } from './providers/model.js';

export * from './answers.js';
export * from './cache.js';
export { MODEL_ROUTES } from './providers/model.js';
export * from './questions.js';
export * from './state.js';
export * from './thresholds.js';
export { ModelDecider };

export type DeciderEnv = {
  OPENROUTER_API_KEY?: string;
  AI_GATEWAY_API_KEY?: string;
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  BUGPATROL_MODEL_ENDPOINT?: string;
  BUGPATROL_MODEL_API_KEY?: string;
  BUGPATROL_MODEL_NAME?: string;
};

export const MODEL_KEYS = {
  openrouter: 'OPENROUTER_API_KEY',
  vercel: 'AI_GATEWAY_API_KEY',
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  custom: 'BUGPATROL_MODEL_API_KEY',
} as const;
const modelOrder = ['openrouter', 'vercel', 'openai', 'anthropic', 'custom'] as const;

/** No decider means no key: the findings then keep their deterministic route. */
export type Resolution = { decider?: Decider; via: string; reason: string };

/**
 * The decider is a general model prompted into a typed contract. Routes are
 * tried in order: OpenRouter, Vercel AI Gateway, OpenAI, Anthropic, then a
 * custom endpoint (spec 4.6). With no key there is no decider.
 */
export function resolveDecider(config: DecisionsConfig, env: DeciderEnv): Resolution {
  const routes = config.model.via === 'auto' ? modelOrder : [config.model.via];
  for (const via of routes) {
    const key = env[MODEL_KEYS[via]];
    if (!key || (via === 'custom' && !env.BUGPATROL_MODEL_ENDPOINT)) continue;
    const name = config.model.name || env.BUGPATROL_MODEL_NAME || MODEL_ROUTES[via].model;
    const endpoint = via === 'custom' ? env.BUGPATROL_MODEL_ENDPOINT : MODEL_ROUTES[via].endpoint;
    return {
      decider: new ModelDecider({ via: via as ModelVia, apiKey: key, endpoint, model: name }),
      via: `model:${via}`,
      reason: `Decider: model via ${via} (${name}).`,
    };
  }

  const missing = routes
    .map((via) => (via === 'custom' ? 'BUGPATROL_MODEL_ENDPOINT and BUGPATROL_MODEL_API_KEY' : MODEL_KEYS[via]))
    .join(', ')
    .replace(/, ([^,]*)$/, ' or $1');
  return { via: 'none', reason: `Decider: none, because no ${missing} is set.` };
}
