import { afterEach, describe, expect, it, vi } from 'vitest';
import { decisionsSchema, InfrastructureError, type Question } from '@bughunters/core';
import { resolveDecider } from '../index.js';
import { JevDecider, normalizeAnswers } from './jev.js';

const questions: Record<string, Question> = {
  yes: { type: 'noul', instructions: 'Is it broken?' },
  category: { type: 'choice', instructions: 'Choose one', criteria: { billing: 'Billing issue', technical: 'Technical issue' } },
  mood: { type: 'score', instructions: 'Rate mood', legend: ['Calm', 'Frustrated'] },
};

afterEach(() => vi.unstubAllGlobals());

describe('JevDecider', () => {
  it.each([
    ['typesafe', 'TYPESAFE_API_KEY', 'https://api.typesafe.ai/v1/systemone', 'jev-latest'],
    ['openrouter', 'OPENROUTER_API_KEY', 'https://openrouter.ai/api/v1/systemone', 'jev-latest'],
    ['vercel', 'AI_GATEWAY_API_KEY', 'https://ai-gateway.vercel.sh/typesafe/v1/systemone', 'typesafe-ai/jev'],
  ] as const)('sends System One format via %s', async (via, key, url, model) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ answers: {} }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const config = decisionsSchema.parse({ decider: 'jev', jev: { via } });
    await resolveDecider(config, { [key]: 'secret' }).decider.ask('screen state', questions);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [calledUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe(url);
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer secret');
    expect(JSON.parse(init.body as string)).toEqual({
      model, state: 'screen state',
      questions: {
        yes: questions.yes, category: questions.category,
        mood: { type: 'score', instructions: 'Rate mood', criteria: ['Calm', 'Frustrated'] },
      },
    });
  });

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

  it('raises InfrastructureError for non-2xx', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"message":"denied"}', { status: 403 })));
    await expect(new JevDecider({ apiKey: 'secret' }).ask('state', questions)).rejects.toThrow(InfrastructureError);
  });
});
