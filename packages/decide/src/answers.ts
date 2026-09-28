import type { Answer, Question } from '@bugpatrol/core';

/**
 * Answers are schema-constrained upstream, but re-validated here: a malformed
 * answer must never silently become a routing decision. Invalid individual
 * answers are omitted so the caller's conservative route applies.
 */
export function normalizeAnswers(
  raw: Record<string, unknown>,
  questions: Record<string, Question>,
): Record<string, Answer> {
  const out: Record<string, Answer> = {};
  for (const [key, question] of Object.entries(questions)) {
    const value = raw[key];
    if (!isObject(value)) continue;
    switch (question.type) {
      case 'noul': {
        const probability = finite(value['noul'] ?? value['value']);
        if (probability === undefined) break;
        const p = clamp(probability);
        out[key] = { kind: 'noul', value: p, confidence: Math.max(p, 1 - p) };
        break;
      }
      case 'choice': {
        const chosen = value['choice'] ?? value['value'];
        const confidence = finite(value['confidence']);
        if (typeof chosen !== 'string' || !Object.hasOwn(question.criteria, chosen) || confidence === undefined) break;
        const probabilities: Record<string, number> = {};
        if (isObject(value['probabilities'])) {
          for (const option of Object.keys(question.criteria)) {
            const p = finite(value['probabilities'][option]);
            if (p !== undefined) probabilities[option] = clamp(p);
          }
        }
        out[key] = {
          kind: 'choice',
          value: chosen,
          probabilities,
          confidence: clamp(confidence),
        };
        break;
      }
      case 'score': {
        const score = finite(value['score'] ?? value['value']);
        const confidence = finite(value['confidence']);
        if (score === undefined || confidence === undefined) break;
        const rawProbabilities = value['probabilities'];
        const probabilities = question.legend.map((_, index) => {
          const p = Array.isArray(rawProbabilities)
            ? finite(rawProbabilities[index])
            : isObject(rawProbabilities)
              ? finite(rawProbabilities[String(index)])
              : undefined;
          return p === undefined ? 0 : clamp(p);
        });
        out[key] = {
          kind: 'score',
          value: score,
          probabilities,
          confidence: clamp(confidence),
          legend: question.legend,
        };
        break;
      }
    }
  }
  return out;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}
