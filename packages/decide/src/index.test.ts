import { describe, expect, it } from 'vitest';
import { decisionsSchema } from '@bughunters/core';
import { resolveDecider, type DeciderEnv } from './index.js';

const model = decisionsSchema.parse({});

function resolve(config: typeof model, env: DeciderEnv = {}) {
  return resolveDecider(config, env);
}

describe('resolveDecider', () => {
  it.each([
    ['OPENROUTER_API_KEY', 'model:openrouter'],
    ['AI_GATEWAY_API_KEY', 'model:vercel'],
    ['OPENAI_API_KEY', 'model:openai'],
    ['ANTHROPIC_API_KEY', 'model:anthropic'],
  ] as const)('routes a lone %s to %s for model', (key, via) => {
    expect(resolve(model, { [key]: 'secret' }).via).toBe(via);
  });

  it('uses a custom route only when both endpoint and key exist', () => {
    expect(resolve(model, { BUGHUNTERS_MODEL_ENDPOINT: 'https://example.test/chat/completions' }).via).toBe('none');
    expect(resolve(model, { BUGHUNTERS_MODEL_ENDPOINT: 'https://example.test/chat/completions', BUGHUNTERS_MODEL_API_KEY: 'secret' }).via).toBe('model:custom');
  });

  it('applies the auto precedence', () => {
    const all = {
      OPENROUTER_API_KEY: 'b', AI_GATEWAY_API_KEY: 'c',
      OPENAI_API_KEY: 'd', ANTHROPIC_API_KEY: 'e', BUGHUNTERS_MODEL_ENDPOINT: 'https://example.test', BUGHUNTERS_MODEL_API_KEY: 'f',
    };
    expect(resolve(model, all).via).toBe('model:openrouter');
    expect(resolve(model, { ...all, OPENROUTER_API_KEY: undefined }).via).toBe('model:vercel');
    expect(resolve(model, { ...all, OPENROUTER_API_KEY: undefined, AI_GATEWAY_API_KEY: undefined }).via).toBe('model:openai');
    expect(resolve(model, { ...all, OPENROUTER_API_KEY: undefined, AI_GATEWAY_API_KEY: undefined, OPENAI_API_KEY: undefined }).via).toBe('model:anthropic');
  });

  it('an explicit via ignores the other route keys', () => {
    const config = decisionsSchema.parse({ model: { via: 'openai' } });
    expect(resolve(config, { OPENROUTER_API_KEY: 'b', OPENAI_API_KEY: 'c' }).via).toBe('model:openai');
    expect(resolve(decisionsSchema.parse({ model: { via: 'anthropic' } }), { OPENAI_API_KEY: 'a' }).via).toBe('none');
  });

  it('has no decider without a key, and says which key to set', () => {
    const fallback = resolve(model);
    expect(fallback.via).toBe('none');
    expect(fallback.decider).toBeUndefined();
    expect(fallback.reason).toContain('OPENROUTER_API_KEY');
    expect(fallback.reason).toContain('ANTHROPIC_API_KEY');
  });

  it('ignores the old Jev settings', () => {
    const legacy = decisionsSchema.parse({ decider: 'jev', jev: { via: 'typesafe' } });
    expect(resolve(legacy, { OPENAI_API_KEY: 'a' }).via).toBe('model:openai');
  });

  it('prefers configured model name over environment override', () => {
    const config = decisionsSchema.parse({ model: { via: 'openai', name: 'my-model' } });
    expect(resolve(config, { OPENAI_API_KEY: 'secret', BUGHUNTERS_MODEL_NAME: 'other' }).reason).toContain('(my-model)');
    expect(resolve(model, { OPENAI_API_KEY: 'secret', BUGHUNTERS_MODEL_NAME: 'other' }).reason).toContain('(other)');
    expect(resolve(model, { OPENAI_API_KEY: 'secret' }).reason).toContain('(gpt-5-mini)');
  });
});
