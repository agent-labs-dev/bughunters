import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseConfig } from '@bughunters/core';
import type { Runtime } from '../types.js';
import { Vars } from '../vars.js';
import { Workspace } from '../workspace.js';
import { reflectOnSession } from './reflect.js';

const config = parseConfig({ version: 1, app: { connect: { url: 'fake://home' } } });

describe('reflection', () => {
  it('sends failed taps and repeated types to a fake runtime and saves redacted lessons', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bughunters-reflect-'));
    try {
      const workspace = new Workspace(root);
      const session = await workspace.startSession('explorer');
      const event = (kind: 'tool-call' | 'tool-result', tool: string, input?: unknown, output?: string) =>
        workspace.appendEvent(session.id, { sessionId: session.id, role: 'explorer', kind, tool,
          summary: output ? `${tool}: failed` : `Called ${tool}`, input, output });
      await event('tool-call', 'tap', { ref: 'e1' });
      await event('tool-result', 'tap', undefined, 'Error: no target');
      await event('tool-call', 'type', { ref: 'e2', text: 'one' });
      await event('tool-result', 'type');
      await event('tool-call', 'type', { ref: 'e2', text: 'two' });
      await event('tool-result', 'type');
      await workspace.endSession(session.id, { summary: 'Finished.' });
      const vars = new Vars(); vars.set('TOKEN', 'secret-value');
      const runtime: Runtime = { label: 'fake', async run(task) {
        expect(task.prompt).toContain('Failed tap');
        expect(task.prompt).toContain('Typed into e2 again: "two"');
        await task.tools.find((tool) => tool.name === 'add_lesson')!.run({
          text: 'On Login, use secret-value in the token field.', scope: 'login',
        });
        return { stop: 'done', steps: 1, costUsd: 0, summary: '' };
      } };
      await reflectOnSession(root, config, session.id, { vars, createRuntime: () => runtime });
      expect((await workspace.readMemory()).lessons[0]).toMatchObject({
        scope: 'login', text: 'On Login, use {{TOKEN}} in the token field.',
      });
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('does not call a runtime for a clean session', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bughunters-reflect-'));
    try {
      const workspace = new Workspace(root);
      const session = await workspace.startSession('explorer');
      await workspace.endSession(session.id, { summary: 'Finished.' });
      await reflectOnSession(root, config, session.id, { createRuntime: () => { throw new Error('called'); } });
      expect((await workspace.readMemory()).lessons).toEqual([]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
