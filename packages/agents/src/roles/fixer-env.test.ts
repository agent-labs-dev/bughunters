import { execFileSync } from 'node:child_process';
import { lstat, mkdir, mkdtemp, readFile, readlink, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { linkEnvFiles } from './fixer.js';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'bugpatrol-env-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: 'pipe' });

describe('linkEnvFiles', () => {
  it('links every ignored .env file into a new worktree and keeps what the worktree has', async () => {
    const source = join(root, 'app');
    await mkdir(join(source, 'apps/desktop'), { recursive: true });
    await mkdir(join(source, 'node_modules/pkg'), { recursive: true });
    git(source, 'init', '-q');
    await writeFile(join(source, '.gitignore'), '.env*\nnode_modules\n');
    await writeFile(join(source, 'README.md'), 'app\n');
    git(source, 'add', '.');
    git(source, '-c', 'user.email=a@b', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'init');
    await writeFile(join(source, '.env'), 'KEY=1\n');
    await writeFile(join(source, '.env.local'), 'LOCAL=1\n');
    await writeFile(join(source, 'apps/desktop/.env'), 'DESKTOP=1\n');
    await writeFile(join(source, 'node_modules/pkg/.env'), 'NO=1\n');
    await writeFile(join(source, '.envrc-notes'), 'not an env file\n');

    const worktree = join(root, 'wt');
    git(source, 'worktree', 'add', '-q', '-b', 'fix', worktree, 'HEAD');
    await writeFile(join(worktree, '.env.local'), 'OWN=1\n');

    const linked = await linkEnvFiles(source, worktree);

    expect(linked.sort()).toEqual(['.env', 'apps/desktop/.env']);
    expect(await readlink(join(worktree, '.env'))).toBe(join(source, '.env'));
    expect(await readFile(join(worktree, 'apps/desktop/.env'), 'utf8')).toBe('DESKTOP=1\n');
    expect(await readFile(join(worktree, '.env.local'), 'utf8')).toBe('OWN=1\n');
    await expect(lstat(join(worktree, 'node_modules/pkg/.env'))).rejects.toThrow();
    // A second call changes nothing.
    expect(await linkEnvFiles(source, worktree)).toEqual([]);
  });
});
