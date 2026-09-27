import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseConfig } from '@bughunters/core';
import { AgentSession } from '../session.js';
import { Vars } from '../vars.js';
import { Workspace } from '../workspace.js';
import { lessonTools } from './memory.js';

async function session(memory: Record<string, unknown> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'bughunters-memory-'));
  const config = parseConfig({ version: 1, app: { connect: { url: 'http://x' } }, agents: { memory } });
  const workspace = new Workspace(root);
  const record = await workspace.startSession('judge');
  const vars = new Vars();
  vars.set('TOKEN', 'secret-value');
  return { root, workspace, session: new AgentSession(root, config, vars, record.id, 'judge') };
}

describe('save_lesson', () => {
  it('saves a lesson for its own role or for another role, with secrets hidden', async () => {
    const f = await session({ maxPerSession: 2 });
    try {
      const [tool] = lessonTools(f.session, 'judge');
      await tool!.run({ text: 'Mark all as read on Tasks is intended.' });
      await tool!.run({ text: 'Change the .web.tsx file too, token secret-value.', for: 'fixer', scope: 'settings-usage' });
      const limited = await tool!.run({ text: 'One too many.' });
      const lessons = (await f.workspace.readMemory()).lessons;
      expect(lessons.map((lesson) => [lesson.role, lesson.source])).toEqual([['judge', 'agent'], ['fixer', 'agent']]);
      expect(lessons[1]).toMatchObject({ scope: 'settings-usage', text: 'Change the .web.tsx file too, token {{TOKEN}}.' });
      expect(JSON.stringify(limited)).toContain('limit');
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  });

  it('is not there when memory is off', async () => {
    const f = await session({ enabled: false });
    try {
      expect(lessonTools(f.session, 'fixer')).toEqual([]);
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  });
});
