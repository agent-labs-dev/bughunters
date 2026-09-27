import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdir, realpath } from 'node:fs/promises';
import lockfile from 'proper-lockfile';
import { InfrastructureError, paths } from '@bughunters/core';

type Lease = { active: boolean; controller: AbortController };
const ownership = new AsyncLocalStorage<Map<string, Lease>>();

export function workspaceSignal(): AbortSignal | undefined {
  return [...(ownership.getStore()?.values() ?? [])].find((lease) => lease.active)?.controller.signal;
}

/** A renewable, cross-process lease held across the complete operation, including idle time. */
export async function withWorkspaceLock<T>(root: string, work: () => Promise<T>): Promise<T> {
  await mkdir(paths.data(root), { recursive: true });
  const directory = await realpath(paths.data(root));
  const inherited = ownership.getStore();
  const existing = inherited?.get(directory);
  if (existing?.active) {
    existing.controller.signal.throwIfAborted();
    return work();
  }
  const lease: Lease = { active: true, controller: new AbortController() };
  let release: () => Promise<void>;
  try {
    release = await lockfile.lock(directory, {
      stale: 120_000, update: 10_000, retries: 0,
      onCompromised(error) { lease.controller.abort(error); },
    });
  } catch (cause) {
    throw new InfrastructureError('Another process owns this workspace, or its lease cannot be acquired. A crashed owner expires after two minutes.', { cause });
  }
  try {
    return await ownership.run(new Map([...(inherited ?? []), [directory, lease]]), async () => {
      const result = await work();
      lease.controller.signal.throwIfAborted();
      return result;
    });
  } finally {
    lease.active = false;
    lease.controller.abort(new Error('Workspace operation ended'));
    await release().catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ERELEASED') throw error; });
  }
}
