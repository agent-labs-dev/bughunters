import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { BUGHUNTERS_DIR, DATA_DIR } from '@bughunters/core';

async function files(dir: string, skip: string): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (path === skip) continue;
    if (entry.isDirectory()) out.push(...await files(path, skip));
    else if (entry.isFile()) out.push(path);
  }
  return out;
}

/**
 * Puts the checkout's `.bughunters/` files (not `runs/`) into a fix worktree
 * for a retest, and returns a function that restores the worktree.
 *
 * The retest runs the setup commands in the worktree, so a script such as
 * `.bughunters/mint-user.sh` comes from the worktree's commit. A change to it
 * that is not committed yet would be missing. The restore puts the worktree
 * back as it was, so the fix commit never carries these files.
 */
export async function overlayBughunters(root: string, source: string, worktree: string): Promise<() => Promise<void>> {
  const where = relative(source, root);
  if (where.startsWith('..') || where.split(sep)[0] === '..') return async () => {};
  const from = join(root, BUGHUNTERS_DIR);
  const saved: Array<{ path: string; content?: Buffer }> = [];
  for (const file of await files(from, join(from, DATA_DIR))) {
    const target = join(worktree, where, relative(root, file));
    const content = await readFile(file);
    let before: Buffer | undefined;
    try {
      before = await readFile(target);
    } catch {
      before = undefined;
    }
    if (before?.equals(content)) continue;
    saved.push({ path: target, content: before });
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  return async () => {
    for (const item of saved.reverse()) {
      if (item.content) await writeFile(item.path, item.content);
      else await rm(item.path, { force: true });
    }
  };
}
