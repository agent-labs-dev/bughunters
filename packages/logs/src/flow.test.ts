import type { AgentEvent, SessionSummary } from '@bugpatrol/core';
import { describe, expect, it } from 'vitest';
import { buildFlow } from './flow.js';

const session: SessionSummary = {
  version: 1,
  id: 's1',
  role: 'explorer',
  startedAt: '2024-03-05T06:00:00.000Z',
  endedAt: '2024-03-05T06:01:00.000Z',
  status: 'finished',
  steps: 3,
  costUsd: 0,
  screensFound: [],
  candidates: 0,
  issues: [],
};

function event(at: string, summary: string, kind: AgentEvent['kind'] = 'tool-call'): AgentEvent {
  return { at, sessionId: 's1', role: 'explorer', kind, summary };
}

describe('buildFlow', () => {
  it('merges actions, requests and logs in time order', () => {
    const flow = buildFlow({
      session,
      events: [event('2024-03-05T06:00:05.000Z', 'tapped Save')],
      signals: [{ at: '2024-03-05T06:00:06.000Z', kind: 'request', text: 'POST /api/save 500' }],
      logs: [{ at: '2024-03-05T06:00:06.500Z', source: 'api', level: 'error', message: 'save failed' }],
      sources: [{ name: 'api', kind: 'file', collected: 1 }],
    });
    expect(flow.entries.map((entry) => entry.kind)).toEqual(['action', 'request', 'log']);
    expect(flow.sessionId).toBe('s1');
    expect(flow.durationMs).toBe(60_000);
  });

  it('marks a log close behind a failure as correlated', () => {
    const flow = buildFlow({
      session,
      events: [event('2024-03-05T06:00:05.000Z', 'boom', 'error')],
      signals: [],
      logs: [
        { at: '2024-03-05T06:00:06.000Z', source: 'api', message: 'within window' },
        { at: '2024-03-05T06:00:20.000Z', source: 'api', message: 'far away' },
      ],
      sources: [],
    });
    const logs = flow.entries.filter((entry) => entry.kind === 'log');
    expect(logs[0]?.correlated).toBe(true);
    expect(logs[1]?.correlated).toBeUndefined();
  });

  it('correlates against the most recent failure', () => {
    const flow = buildFlow({
      session,
      events: [
        event('2024-03-05T06:00:05.000Z', 'first', 'error'),
        event('2024-03-05T06:00:15.000Z', 'second', 'error'),
      ],
      signals: [],
      logs: [{ at: '2024-03-05T06:00:16.000Z', source: 'api', message: 'answer to the second' }],
      sources: [],
    });
    expect(flow.entries.find((entry) => entry.kind === 'log')?.correlated).toBe(true);
  });

  it('honours a custom correlation window', () => {
    const flow = buildFlow({
      session,
      events: [event('2024-03-05T06:00:05.000Z', 'boom', 'error')],
      signals: [],
      logs: [{ at: '2024-03-05T06:00:06.000Z', source: 'api', message: 'x' }],
      sources: [],
      correlationMs: 100,
    });
    expect(flow.entries.find((entry) => entry.kind === 'log')?.correlated).toBeUndefined();
  });
});
