import { describe, expect, it } from 'vitest';
import { decisionsSchema } from '@bughunters/core';
import { createDecider, resolveDecider, type DeciderEnv } from './index.js';

const jev = decisionsSchema.parse({ decider: 'jev' });
const model = decisionsSchema.parse({ decider: 'model' });

function resolve(config: typeof jev, env: DeciderEnv = {}, noModels = false) {
  return resolveDecider(config, env, { noModels });
}

describe('resolveDecider', () => {
  it.each([
    ['TYPESAFE_API_KEY', 'jev:typesafe'],
    ['OPENROUTER_API_KEY', 'jev:openrouter'],
    ['AI_GATEWAY_API_KEY', 'jev:vercel'],
  ] as const)('routes a lone %s to %s', (key, via) => {
    expect(resolve(jev, { [key]: 'secret' }).via).toBe(via);
  });

  it.each([
    ['OPENROUTER_API_KEY', 'model:openrouter'],
    ['AI_GATEWAY_API_KEY', 'model:vercel'],
    ['OPENAI_API_KEY', 'model:openai'],
    ['ANTHROPIC_API_KEY', 'model:anthropic'],
  ] as const)('routes a lone %s to %s for model', (key, via) => {
    expect(resolve(model, { [key]: 'secret' }).via).toBe(via);
  });

  it('uses a custom route only when both endpoint and key exist', () => {
    expect(resolve(model, { BUGHUNTERS_MODEL_ENDPOINT: 'https://example.test/chat/completions' }).via).toBe('heuristic');
    expect(resolve(model, { BUGHUNTERS_MODEL_ENDPOINT: 'https://example.test/chat/completions', BUGHUNTERS_MODEL_API_KEY: 'secret' }).via).toBe('model:custom');
  });

  it('applies Jev and model auto precedence', () => {
    const all = {
      TYPESAFE_API_KEY: 'a', OPENROUTER_API_KEY: 'b', AI_GATEWAY_API_KEY: 'c',
      OPENAI_API_KEY: 'd', ANTHROPIC_API_KEY: 'e', BUGHUNTERS_MODEL_ENDPOINT: 'https://example.test', BUGHUNTERS_MODEL_API_KEY: 'f',
    };
    expect(resolve(jev, all).via).toBe('jev:typesafe');
    expect(resolve(model, all).via).toBe('model:openrouter');
    expect(resolve(jev, { ...all, TYPESAFE_API_KEY: undefined }).via).toBe('jev:openrouter');
    expect(resolve(model, { ...all, OPENROUTER_API_KEY: undefined }).via).toBe('model:vercel');
    expect(resolve(model, { ...all, OPENROUTER_API_KEY: undefined, AI_GATEWAY_API_KEY: undefined }).via).toBe('model:openai');
    expect(resolve(model, { ...all, OPENROUTER_API_KEY: undefined, AI_GATEWAY_API_KEY: undefined, OPENAI_API_KEY: undefined }).via).toBe('model:anthropic');
  });

  it('explicit via ignores other route keys, then Jev falls through to model', () => {
    const config = decisionsSchema.parse({ decider: 'jev', jev: { via: 'vercel' }, model: { via: 'openai' } });
    expect(resolve(config, { TYPESAFE_API_KEY: 'a', OPENROUTER_API_KEY: 'b', OPENAI_API_KEY: 'c' }).via).toBe('model:openai');
    expect(resolve(config, { TYPESAFE_API_KEY: 'a', AI_GATEWAY_API_KEY: 'b' }).via).toBe('jev:vercel');
    expect(resolve(decisionsSchema.parse({ decider: 'model', model: { via: 'anthropic' } }), { OPENAI_API_KEY: 'a' }).via).toBe('heuristic');
  });

  it('explains missing keys and respects noModels and explicit heuristic', () => {
    const fallback = resolve(jev);
    expect(fallback.via).toBe('heuristic');
    expect(fallback.reason).toContain('TYPESAFE_API_KEY');
    expect(fallback.reason).toContain('OPENROUTER_API_KEY');
    expect(fallback.reason).toContain('AI_GATEWAY_API_KEY');
    expect(resolve(model).reason).toContain('ANTHROPIC_API_KEY');
    expect(resolve(jev, { TYPESAFE_API_KEY: 'a' }, true).via).toBe('heuristic');
    expect(resolve(decisionsSchema.parse({ decider: 'heuristic' }), { TYPESAFE_API_KEY: 'a' }).via).toBe('heuristic');
    expect(createDecider(jev, {}, { noModels: true }).name).toBe('heuristic');
  });

  it('prefers configured model name over environment override', () => {
    const config = decisionsSchema.parse({ decider: 'model', model: { via: 'openai', name: 'my-model' } });
    expect(resolve(config, { OPENAI_API_KEY: 'secret', BUGHUNTERS_MODEL_NAME: 'other' }).reason).toContain('(my-model)');
    expect(resolve(model, { OPENAI_API_KEY: 'secret', BUGHUNTERS_MODEL_NAME: 'other' }).reason).toContain('(other)');
    expect(resolve(model, { OPENAI_API_KEY: 'secret' }).reason).toContain('(gpt-5-mini)');
  });
});
