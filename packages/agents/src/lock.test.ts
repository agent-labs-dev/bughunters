import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { paths } from '@bughunters/core';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { withWorkspaceLock, workspaceSignal } from './lock.js';
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function root() { const path = await mkdtemp(join(tmpdir(), 'bh-lock-')); roots.push(path); return path; }
describe('workspace ownership', () => {
  it('rejects a concurrent independent operation while permitting nested work', async () => {
    const path = await root();
    let release!: () => void; let entered!: () => void;
    const ready = new Promise<void>((resolve) => { entered = resolve; });
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const first = withWorkspaceLock(path, async () => {
      await withWorkspaceLock(path, async () => { expect(workspaceSignal()?.aborted).toBe(false); });
      entered(); await pending;
    });
    await ready;
    try { await expect(withWorkspaceLock(path, async () => {})).rejects.toThrow('owns this workspace'); }
    finally { release(); await first; }
    await expect(withWorkspaceLock(path, async () => 'next')).resolves.toBe('next');
  });
  it('excludes a separate Node process for the entire operation', async () => {
    const path = await root();
    const dependency = createRequire(import.meta.url).resolve('proper-lockfile');
    await withWorkspaceLock(path, async () => {
      await promisify(execFile)(process.execPath, ['-e',
        "require(process.argv[1]).lock(process.argv[2]).then(release => release().then(() => process.exit(2)), error => process.exit(error.code === 'ELOCKED' ? 0 : 1))",
        dependency, paths.data(path)]);
    });
  });

  it('releases ownership after failure', async () => {
    const path = await root();
    await expect(withWorkspaceLock(path, async () => { throw new Error('synthetic'); })).rejects.toThrow('synthetic');
    await expect(withWorkspaceLock(path, async () => 'recovered')).resolves.toBe('recovered');
  });
});
