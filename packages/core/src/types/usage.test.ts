import { describe, expect, it } from 'vitest';
import { addUsage, formatUsage, usageFrom, usageOf } from './usage.js';
import type { AgentEvent } from './agents.js';

describe('usageFrom', () => {
  it('reads OpenAI and OpenRouter usage, with cached prompt tokens inside the input', () => {
    expect(usageFrom({ prompt_tokens: 1200, completion_tokens: 80, prompt_tokens_details: { cached_tokens: 1000 }, cost: 0.01 }))
      .toEqual({ input: 1200, output: 80, cacheRead: 1000 });
  });

  it('adds the Anthropic cache tokens to the input, because Anthropic counts them apart', () => {
    expect(usageFrom({ input_tokens: 2, output_tokens: 4, cache_read_input_tokens: 10440, cache_creation_input_tokens: 15169 }))
      .toEqual({ input: 25611, output: 4, cacheRead: 10440, cacheWrite: 15169 });
  });

  it('reads Codex usage, where the input already holds the cached tokens', () => {
    expect(usageFrom({ input_tokens: 17799, cached_input_tokens: 8064, cache_write_input_tokens: 0, output_tokens: 5 }))
      .toEqual({ input: 17799, output: 5, cacheRead: 8064 });
  });

  it('returns undefined for a block with no token counts', () => {
    expect(usageFrom(undefined)).toBeUndefined();
    expect(usageFrom({ cost: 0.1 })).toBeUndefined();
  });
});

describe('addUsage and formatUsage', () => {
  it('adds each field, and keeps the estimate flag', () => {
    const sum = addUsage({ input: 1000, output: 10, cacheRead: 500, listCostUsd: 0.1 }, { input: 200, output: 0, estimated: true });
    expect(sum).toEqual({ input: 1200, output: 10, cacheRead: 500, listCostUsd: 0.1, estimated: true });
    expect(formatUsage(sum)).toBe('~1.2k in (500 cached), 10 out tokens');
    expect(formatUsage(undefined)).toBe('no token usage reported');
  });
});

describe('usageOf', () => {
  it('adds up the events of a session, in total and for each model', () => {
    const event = (model: string, input: number, output: number): AgentEvent =>
      ({ at: '', sessionId: 's', role: 'explorer', kind: 'tool-result', summary: '', model, tokens: { input, output } });
    const result = usageOf([event('glm', 100, 10), event('gpt-mini', 50, 0), event('glm', 200, 20),
      { at: '', sessionId: 's', role: 'explorer', kind: 'thought', summary: 'no tokens' }]);
    expect(result.tokens).toEqual({ input: 350, output: 30 });
    expect(result.tokensByModel).toEqual({ glm: { input: 300, output: 30 }, 'gpt-mini': { input: 50, output: 0 } });
    expect(usageOf([])).toEqual({});
  });
});
