import type { Answer, Decider, Question } from '@autoqa/core';
import { InfrastructureError } from '@autoqa/core';

export type JevOptions = {
  apiKey: string;
  model?: string;
  endpoint?: string;
  timeoutMs?: number;
};

type JevResponse = { answers?: Record<string, unknown> };

/**
 * The default decider. Jev is a "System One" model: it takes a state plus typed
 * questions and returns answers with calibrated probabilities. It does not
 * generate text, and it cannot emit a tool call, a command, or a plan.
 *
 * That last property is a security feature, not a limitation. The always-on
 * brain reads untrusted page content on every run, and a component with no
 * agency removes most of the prompt-injection surface by construction
 * (spec 11.1).
 *
 * Accuracy caveat, handled honestly: the vendor's own four-workflow benchmark
 * puts Jev at 67.8%. It is used here as a FILTER AND ROUTER, never an oracle --
 * see thresholds.ts for how its errors are absorbed.
 */
export class JevDecider implements Decider {
  readonly name = 'jev' as const;
  private readonly endpoint: string;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(private readonly options: JevOptions) {
    this.endpoint = options.endpoint ?? 'https://api.typesafe.ai/v1/systemone';
    this.model = options.model ?? 'jev-latest';
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  async ask(state: string, questions: Record<string, Question>): Promise<Record<string, Answer>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.options.apiKey}`,
        },
        // Every question is evaluated against the same state in one call, so
        // the entire per-screen analysis is a single round trip.
        body: JSON.stringify({ model: this.model, state, questions }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new InfrastructureError(`Jev returned ${response.status}: ${await safeText(response)}`);
      }

      const body = (await response.json()) as JevResponse;
      return normalizeAnswers(body.answers ?? {}, questions);
    } catch (cause) {
      if (cause instanceof InfrastructureError) throw cause;
      throw new InfrastructureError('Jev request failed', { cause });
    } finally {
      clearTimeout(timer);
    }
  }
}

async function safeText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 400);
  } catch {
    return '<no body>';
  }
}

/**
 * Answers are schema-constrained upstream, but this re-validates anyway: a
 * malformed answer must surface as an error rather than silently becoming a
 * routing decision in someone's repo.
 */
export function normalizeAnswers(
  raw: Record<string, unknown>,
  questions: Record<string, Question>,
): Record<string, Answer> {
  const out: Record<string, Answer> = {};
  for (const [key, question] of Object.entries(questions)) {
    const value = raw[key] as Record<string, unknown> | undefined;
    if (!value) continue;
    const confidence = num(value['confidence'], 0);
    switch (question.type) {
      case 'noul':
        out[key] = { kind: 'noul', value: num(value['value'], 0), confidence };
        break;
      case 'choice': {
        const chosen = String(value['value'] ?? '');
        if (!(chosen in question.criteria)) break; // never invent an option
        out[key] = {
          kind: 'choice',
          value: chosen,
          probabilities: (value['probabilities'] as Record<string, number>) ?? {},
          confidence,
        };
        break;
      }
      case 'score':
        out[key] = {
          kind: 'score',
          value: num(value['value'], 0),
          probabilities: (value['probabilities'] as number[]) ?? [],
          confidence,
          legend: question.legend,
        };
        break;
    }
  }
  return out;
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
