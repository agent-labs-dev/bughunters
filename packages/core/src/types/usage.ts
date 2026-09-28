import type { AgentEvent, SessionSummary } from './agents.js';

/**
 * Token usage, for cost control and for model comparisons. `input` counts all
 * prompt tokens, cached ones included; `cacheRead` and `cacheWrite` say how
 * many of them hit or filled a prompt cache.
 */
export type TokenUsage = {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
  /** The provider's list price for these tokens, when it reports one (claude does). Not always what the user pays. */
  listCostUsd?: number;
  /** True when Bugpatrol counted characters because the provider reported no usage. */
  estimated?: boolean;
};

const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

/**
 * Reads the usage block of an OpenAI, OpenRouter, Anthropic, Claude Code, or
 * Codex response. Undefined when the block has no token counts.
 */
export function usageFrom(raw: unknown): TokenUsage | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const u = raw as Record<string, unknown>;
  if ('prompt_tokens' in u || 'completion_tokens' in u) {
    const details = u.prompt_tokens_details as Record<string, unknown> | undefined;
    return clean({ input: num(u.prompt_tokens), output: num(u.completion_tokens),
      cacheRead: num(details?.cached_tokens), cacheWrite: num(details?.cache_write_tokens) });
  }
  if ('input_tokens' in u || 'output_tokens' in u) {
    // Anthropic counts cached tokens apart from input_tokens; Codex counts
    // them inside input_tokens and names them cached_input_tokens.
    const cacheRead = num(u.cache_read_input_tokens);
    const cacheWrite = num(u.cache_creation_input_tokens);
    if ('cached_input_tokens' in u) {
      return clean({ input: num(u.input_tokens), output: num(u.output_tokens),
        cacheRead: num(u.cached_input_tokens), cacheWrite: num(u.cache_write_input_tokens) });
    }
    return clean({ input: num(u.input_tokens) + cacheRead + cacheWrite, output: num(u.output_tokens), cacheRead, cacheWrite });
  }
  return undefined;
}

function clean(usage: TokenUsage): TokenUsage {
  const out: TokenUsage = { input: usage.input, output: usage.output };
  if (usage.cacheRead) out.cacheRead = usage.cacheRead;
  if (usage.cacheWrite) out.cacheWrite = usage.cacheWrite;
  return out;
}

export function addUsage(a: TokenUsage | undefined, b: TokenUsage | undefined): TokenUsage | undefined {
  if (!a) return b && { ...b };
  if (!b) return a;
  const sum: TokenUsage = { input: a.input + b.input, output: a.output + b.output };
  const cacheRead = (a.cacheRead ?? 0) + (b.cacheRead ?? 0);
  const cacheWrite = (a.cacheWrite ?? 0) + (b.cacheWrite ?? 0);
  const listCostUsd = (a.listCostUsd ?? 0) + (b.listCostUsd ?? 0);
  if (cacheRead) sum.cacheRead = cacheRead;
  if (cacheWrite) sum.cacheWrite = cacheWrite;
  if (listCostUsd) sum.listCostUsd = listCostUsd;
  if (a.estimated || b.estimated) sum.estimated = true;
  return sum;
}

/** "25.6k in (10.4k cached), 4 out". */
export function formatUsage(usage: TokenUsage | undefined): string {
  if (!usage) return 'no token usage reported';
  const k = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
  const cached = usage.cacheRead ? ` (${k(usage.cacheRead)} cached)` : '';
  return `${usage.estimated ? '~' : ''}${k(usage.input)} in${cached}, ${k(usage.output)} out tokens`;
}

/** The token sum of a session's events, in total and for each model. */
export function usageOf(events: AgentEvent[]): Pick<SessionSummary, 'tokens' | 'tokensByModel'> {
  let tokens: TokenUsage | undefined;
  const byModel: Record<string, TokenUsage> = {};
  for (const event of events) {
    if (!event.tokens) continue;
    tokens = addUsage(tokens, event.tokens);
    const model = event.model ?? 'unknown';
    byModel[model] = addUsage(byModel[model], event.tokens)!;
  }
  return tokens ? { tokens, tokensByModel: byModel } : {};
}

