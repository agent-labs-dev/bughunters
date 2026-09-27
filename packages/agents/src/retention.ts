import { lstat, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { paths } from '@bughunters/core';
import { withWorkspaceLock } from './lock.js';

type Entry = { path: string; bytes: number };
async function entries(dir: string) {
  try { return await readdir(dir, { withFileTypes: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
}
async function size(dir: string): Promise<number> {
  let bytes = 0;
  for (const entry of await entries(dir)) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) bytes += await size(path);
    else if (entry.isFile()) bytes += (await lstat(path)).size;
  }
  return bytes;
}
/** Preview by default. References, malformed state and live work always win over age. */
export async function pruneArtifacts(root: string, options: { olderThanDays: number; apply?: boolean; now?: number }): Promise<Entry[]> {
  if (!Number.isInteger(options.olderThanDays) || options.olderThanDays < 1) throw new Error('Retention must be a positive whole number of days.');
  return withWorkspaceLock(root, async () => {
    const references: string[] = [];
    const data = paths.data(root);
    const canonicalData = await realpath(data);
    if (!canonicalData.startsWith((await realpath(root)) + sep)) throw new Error('Workspace data leaves the project.');
    // Do not parse run histories, worktrees or baseline stores as retention policy.
    const skipped = new Set(['sessions', 'gate', 'worktrees', 'baselines', 'agent-baselines']);
    const collect = async (dir: string, top = false): Promise<void> => {
      for (const entry of await entries(dir)) {
        if (top && skipped.has(entry.name)) continue;
        const path = join(dir, entry.name);
        if (entry.isDirectory()) await collect(path);
        else if (entry.isFile() && entry.name.endsWith('.json')) references.push(JSON.stringify(JSON.parse(await readFile(path, 'utf8'))));
      }
    };
    await collect(data, true); // Corrupt policy metadata aborts pruning, never becomes an empty reference set.
    const protectedText = references.join('\n');
    const cutoff = (options.now ?? Date.now()) - options.olderThanDays * 86_400_000;
    const planned: Entry[] = [];
    for (const [parent, metadata] of [[paths.sessions(root), 'session.json'], [paths.runs(root), 'run.json']] as const) {
      const canonicalParent = await realpath(parent).catch(() => undefined);
      if (!canonicalParent) continue;
      if (!canonicalParent.startsWith(canonicalData + sep) || (await lstat(parent)).isSymbolicLink()) throw new Error('Retention directory leaves workspace data.');
      for (const entry of await entries(parent)) {
        if (!entry.isDirectory() || !/^[a-zA-Z0-9_-]+$/.test(entry.name)) continue;
        const path = join(parent, entry.name);
        if (protectedText.includes(entry.name)) continue;
        let value: Record<string, unknown>;
        try { value = JSON.parse(await readFile(join(path, metadata), 'utf8')); } catch { continue; }
        const record = (value.run ?? value) as Record<string, unknown>;
        if (!['finished', 'infra-error', 'failed', 'incomplete', 'cancelled', 'passed', 'clean', 'regressions', 'completed'].includes(String(record.status))) continue;
        const ended = Date.parse(String(record.endedAt ?? record.finishedAt ?? ''));
        if (!Number.isFinite(ended) || ended >= cutoff) continue;
        let candidates = '';
        try { candidates = await readFile(join(path, 'candidates.jsonl'), 'utf8'); } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') continue;
        }
        let referenced = false;
        try { referenced = candidates.split('\n').filter(Boolean).some(line => {
          const item = JSON.parse(line) as { id?: string };
          return item.id ? protectedText.includes(item.id) : true;
        }); } catch { continue; }
        if (referenced) continue;
        if (!(await realpath(path)).startsWith(canonicalParent + sep)) continue;
        planned.push({ path: relative(root, path), bytes: await size(path) });
        if (options.apply) await rm(path, { recursive: true });
      }
    }
    return planned;
  });
}
