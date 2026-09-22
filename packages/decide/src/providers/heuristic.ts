import type { Answer, Decider, Question } from '@autoqa/core';

/**
 * Rule-only, zero model, zero network. This is what makes
 * `autoqa run --no-models` and the air-gapped deployment real rather than
 * aspirational: with this decider installed, the deterministic tier runs end to
 * end with no egress whatsoever.
 *
 * It is deliberately timid. Every answer comes back at low confidence, which
 * under the routing rules means findings go to a human rather than being
 * auto-suppressed.
 */
export class HeuristicDecider implements Decider {
  readonly name = 'heuristic' as const;

  async ask(state: string, questions: Record<string, Question>): Promise<Record<string, Answer>> {
    const severe = /"severity":\s*"(critical|major)"/.test(state);
    const anyAssertion = /"assertions":\s*\[\s*\{/.test(state);

    const out: Record<string, Answer> = {};
    for (const [key, q] of Object.entries(questions)) {
      out[key] = this.answer(key, q, { severe, anyAssertion });
    }
    return out;
  }

  private answer(key: string, q: Question, ctx: { severe: boolean; anyAssertion: boolean }): Answer {
    switch (q.type) {
      case 'noul': {
        const value = key === 'is_anomalous' ? (ctx.anyAssertion ? 1 : 0) : 0;
        // Never confident enough to suppress. That is the point.
        return { kind: 'noul', value, confidence: 0.4 };
      }
      case 'choice': {
        const fallback = key === 'route' ? 'question' : Object.keys(q.criteria)[0]!;
        const value = q.criteria[fallback] ? fallback : Object.keys(q.criteria)[0]!;
        const probabilities = Object.fromEntries(
          Object.keys(q.criteria).map((k) => [k, k === value ? 0.4 : 0.6 / (Object.keys(q.criteria).length - 1)]),
        );
        return { kind: 'choice', value, probabilities, confidence: 0.4 };
      }
      case 'score': {
        const index = ctx.severe ? q.legend.length - 2 : 1;
        const probabilities = q.legend.map((_, i) => (i === index ? 0.4 : 0.6 / (q.legend.length - 1)));
        return { kind: 'score', value: index, probabilities, confidence: 0.4, legend: q.legend };
      }
    }
  }
}
