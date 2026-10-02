import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SessionFlow } from '@bugpatrol/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AgentReader } from './agents.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bugpatrol-flow-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const flow: SessionFlow = {
  version: 1,
  sessionId: 's1',
  role: 'explorer',
  startedAt: '2024-03-05T06:00:00.000Z',
  sources: [{ name: 'api', kind: 'file', collected: 1 }],
  entries: [{ at: '2024-03-05T06:00:06.000Z', kind: 'log', summary: 'save failed', correlated: true }],
};

describe('AgentReader.flow', () => {
  it('reads a session flow artifact from the project', () => {
    const dir = join(root, '.bugpatrol', 'runs', 'sessions', 's1');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'flow.json'), JSON.stringify(flow));
    expect(new AgentReader(root).flow('s1')).toEqual(flow);
  });

  it('returns undefined when the session has no flow yet', () => {
    expect(new AgentReader(root).flow('missing')).toBeUndefined();
  });
});
