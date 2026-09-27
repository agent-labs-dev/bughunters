import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { overlayBughunters } from './overlay.js';

describe('overlayBughunters', () => {
  it('gives the retest the checkout scripts, and restores the worktree after it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bughunters-overlay-'));
    const worktree = join(root, '.bughunters', 'runs', 'worktrees', 'iss_1');
    try {
      await mkdir(join(root, '.bughunters', 'runs'), { recursive: true });
      await writeFile(join(root, '.bughunters', 'mint.sh'), 'new script');
      await writeFile(join(root, '.bughunters', 'added.sh'), 'only in the checkout');
      await writeFile(join(root, '.bughunters', 'runs', 'agents.json'), '{}');
      await mkdir(join(worktree, '.bughunters'), { recursive: true });
      await writeFile(join(worktree, '.bughunters', 'mint.sh'), 'committed script');

      const restore = await overlayBughunters(root, root, worktree);
      expect(await readFile(join(worktree, '.bughunters', 'mint.sh'), 'utf8')).toBe('new script');
      expect(await readFile(join(worktree, '.bughunters', 'added.sh'), 'utf8')).toBe('only in the checkout');
      await expect(readFile(join(worktree, '.bughunters', 'runs', 'agents.json'))).rejects.toThrow();

      await restore();
      expect(await readFile(join(worktree, '.bughunters', 'mint.sh'), 'utf8')).toBe('committed script');
      await expect(readFile(join(worktree, '.bughunters', 'added.sh'))).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('does nothing when the config is outside the source repo', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bughunters-overlay-'));
    try {
      await mkdir(join(root, 'config', '.bughunters'), { recursive: true });
      await writeFile(join(root, 'config', '.bughunters', 'mint.sh'), 'script');
      await mkdir(join(root, 'wt'), { recursive: true });
      await (await overlayBughunters(join(root, 'config'), join(root, 'app'), join(root, 'wt')))();
      await expect(readFile(join(root, 'wt', '.bughunters', 'mint.sh'))).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
