import { describe, expect, it } from 'vitest';
import type { Question } from '@bugpatrol/core';
import { normalizeAnswers } from './answers.js';

const questions: Record<string, Question> = {
  yes: { type: 'noul', instructions: 'Is it broken?' },
  category: { type: 'choice', instructions: 'Choose one', criteria: { billing: 'Billing issue', technical: 'Technical issue' } },
  mood: { type: 'score', instructions: 'Rate mood', legend: ['Calm', 'Frustrated'] },
};

describe('normalizeAnswers', () => {
  it('parses documented answer fields and preserves the score float', () => {
    expect(normalizeAnswers({
      yes: { type: 'noul', noul: 0.95 },
      category: { type: 'choice', choice: 'billing', probabilities: { billing: 0.88, technical: 0.12 }, confidence: 0.81 },
      mood: { type: 'score', score: 1.05, legend: { '0': 'Calm', '1': 'Frustrated' }, probabilities: { '0': 0.0, '1': 0.95 }, confidence: 0.92 },
    }, questions)).toEqual({
      yes: { kind: 'noul', value: 0.95, confidence: 0.95 },
      category: { kind: 'choice', value: 'billing', probabilities: { billing: 0.88, technical: 0.12 }, confidence: 0.81 },
      mood: { kind: 'score', value: 1.05, probabilities: [0, 0.95], confidence: 0.92, legend: ['Calm', 'Frustrated'] },
    });
  });

  it('drops invented options and malformed required numbers; tolerates legacy value', () => {
    expect(normalizeAnswers({
      yes: { value: Number.NaN },
      category: { choice: 'invented', confidence: 1 },
      mood: { value: 1, confidence: 2, probabilities: { '1': 1.5 } },
    }, questions)).toEqual({ mood: { kind: 'score', value: 1, confidence: 1, probabilities: [0, 1], legend: ['Calm', 'Frustrated'] } });
  });
});
