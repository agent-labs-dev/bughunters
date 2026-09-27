import type { LessonRole } from '@bughunters/core';
import type { AgentSession } from '../session.js';
import type { Tool } from '../types.js';

const roles: LessonRole[] = ['explorer', 'judge', 'fixer'];

/**
 * Lets a role save what it learned about this app or its code while it works,
 * so that a later session does not have to find it again. A role can also save
 * a lesson for another role: the judge sees why a fix did not work, and the
 * fixer needs that lesson next time. Returns no tool when memory is off.
 */
export function lessonTools(session: AgentSession, role: LessonRole): Tool[] {
  const memory = session.config.agents.memory;
  if (!memory.enabled) return [];
  let saved = 0;
  return [{
    name: 'save_lesson',
    description: 'Save one lasting fact about this app or its code for later sessions: one short, specific '
      + 'sentence. Use "for" to save it for another role (explorer, judge, or fixer).',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        for: { type: 'string', enum: roles },
        scope: { type: 'string', description: 'A screen id, or leave it out for the whole app.' },
      },
      required: ['text'],
      additionalProperties: false,
    },
    async run(input) {
      if (saved >= memory.maxPerSession) {
        return { content: [{ type: 'text', text: 'The lesson limit for this session is reached.' }] };
      }
      const text = (session.vars.redact(String(input.text ?? '')) as string).trim().slice(0, 240);
      if (!text) return { content: [{ type: 'text', text: 'The lesson needs a text.' }], isError: true };
      const target = roles.includes(input.for as LessonRole) ? input.for as LessonRole : role;
      const [lesson] = await session.workspace.upsertLessons([{ role: target, text, source: 'agent',
        scope: input.scope ? String(input.scope) : undefined }]);
      saved++;
      session.emit({ kind: 'lesson', summary: `Learned (${target}): ${lesson!.text}` });
      return { content: [{ type: 'text', text: `Saved ${lesson!.id} for the ${target}.` }] };
    },
  }];
}
