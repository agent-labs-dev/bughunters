import { describe, expect, it } from 'vitest';
import { HeuristicDecider } from './heuristic.js';
import { SCREEN_QUESTIONS } from '../questions.js';
import { route } from '../thresholds.js';

describe('HeuristicDecider', () => {
  it('answers every declared question with a valid typed answer', async () => {
    const answers = await new HeuristicDecider().ask('{"assertions":[{"rule":"x"}]}', SCREEN_QUESTIONS);
    for (const key of Object.keys(SCREEN_QUESTIONS)) {
      expect(answers[key]).toBeDefined();
    }
    const choiceAnswer = answers['classification'];
    expect(choiceAnswer?.kind).toBe('choice');
    if (choiceAnswer?.kind === 'choice') {
      // It may never invent an option outside the declared criteria.
      expect(Object.keys(SCREEN_QUESTIONS['classification']!.type === 'choice' ? (SCREEN_QUESTIONS['classification'] as { criteria: Record<string, string> }).criteria : {})).toContain(choiceAnswer.value);
    }
  });

  it('routes everything to a human, because it is never confident', async () => {
    const answers = await new HeuristicDecider().ask('{"assertions":[{"rule":"x"}]}', SCREEN_QUESTIONS);
    const outcome = route({
      answers,
      thresholds: { high: 0.85, low: 0.55 },
      hasDeterministicRegression: false,
      matchedLedger: false,
    });
    expect(outcome.route).toBe('question');
  });
});
