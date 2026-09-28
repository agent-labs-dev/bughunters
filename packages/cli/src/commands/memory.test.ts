import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Workspace } from '@bugpatrol/agents';
import { runMemoryCommand } from './memory.js';

describe('bugpatrol memory', () => {
  it('adds, lists, and removes a lesson', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bugpatrol-memory-cli-'));
    try {
      const lines: string[] = [];
      const log = (line: string) => { lines.push(line); };
      await runMemoryCommand(['add', '--role', 'judge', 'Check the guide.', '--scope', 'welcome'], root, log);
      const id = (await new Workspace(root).readMemory()).lessons[0]!.id;
      await runMemoryCommand(['list', '--role', 'judge'], root, log);
      expect(lines.join('\n')).toContain(`${id}  judge  1  human  welcome  Check the guide.`);
      await runMemoryCommand(['remove', id], root, log);
      expect((await new Workspace(root).readMemory()).lessons).toEqual([]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
