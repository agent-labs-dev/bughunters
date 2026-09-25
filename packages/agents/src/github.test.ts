import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FixProposal, Issue } from '@autoqa/core';
import { createIssue, createPr, ensureAssetsBranch, uploadImage, type Gh } from './github.js';

let dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))); dirs = []; });
const temp = async () => { const dir = await mkdtemp(join(tmpdir(), 'autoqa-gh-test-')); dirs.push(dir); return dir; };
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

describe('GitHub client', () => {
  it('creates an orphan assets branch only when the ref is missing', async () => {
    const calls: string[][] = [];
    const gh: Gh = async (args) => {
      calls.push(args);
      if (args[1]?.endsWith('/git/ref/heads/assets')) throw new Error('404 Not Found');
      if (args[2]?.endsWith('/git/blobs')) return JSON.stringify({ sha: 'blob' });
      if (args[2]?.endsWith('/git/trees')) return JSON.stringify({ sha: 'tree' });
      if (args[2]?.endsWith('/git/commits')) return JSON.stringify({ sha: 'commit' });
      return '{}';
    };
    await ensureAssetsBranch(gh, 'o/r', 'assets');
    expect(calls.filter((args) => args.includes('POST'))).toHaveLength(4);
    const ref = calls.at(-1)!;
    expect(ref).toContain('repos/o/r/git/refs');
    calls.length = 0;
    await ensureAssetsBranch(async (args) => { calls.push(args); return '{}'; }, 'o/r', 'assets');
    expect(calls).toHaveLength(1);
  });
  it('skips upload of an existing image', async () => {
    const dir = await temp();
    const path = join(dir, 'screen.png');
    await writeFile(path, 'png');
    const calls: string[][] = [];
    const url = await uploadImage(async (args) => { calls.push(args); return '{}'; }, 'o/r', 'assets', path, 'iss_1');
    expect(calls).toHaveLength(1);
    expect(url).toMatch(/iss_1\/[a-f0-9]{12}-screen\.png\?raw=true$/);
  });
  it('passes labels and a temporary body file to issue create', async () => {
    let body = '';
    const gh: Gh = async (args) => { body = await readFile(args[args.indexOf('--body-file') + 1]!, 'utf8');
      expect(args).toContain('--label'); expect(args).toContain('autoqa'); return 'https://github.com/o/r/issues/8'; };
    expect(await createIssue(gh, { repo: 'o/r', title: 'Broken', body: 'Full report', labels: ['autoqa'] }))
      .toEqual({ number: 8, url: 'https://github.com/o/r/issues/8' });
    expect(body).toBe('Full report');
  });
  it('commits an uncommitted worktree, pushes it, and creates a PR', async () => {
    const dir = await temp();
    const remote = join(dir, 'remote.git'); const source = join(dir, 'source'); const worktree = join(dir, 'fix');
    execFileSync('git', ['init', '--bare', remote]);
    execFileSync('git', ['init', source]);
    git(source, 'config', 'user.email', 'test@example.com'); git(source, 'config', 'user.name', 'Test');
    git(source, 'config', 'commit.gpgsign', 'false');
    await writeFile(join(source, 'app.txt'), 'broken');
    git(source, 'add', '-A'); git(source, 'commit', '-m', 'initial'); git(source, 'remote', 'add', 'origin', remote);
    git(source, 'push', '-u', 'origin', 'HEAD');
    git(source, 'worktree', 'add', '-b', 'fix-branch', worktree, 'HEAD');
    git(worktree, 'config', 'commit.gpgsign', 'false');
    await writeFile(join(worktree, 'app.txt'), 'fixed');
    const fix: FixProposal = { version: 1, id: 'fix_1', issueId: 'iss_1', status: 'proposed', runtime: 'fake',
      repo: source, branch: 'fix-branch', worktree, startedAt: 'now', error: 'Left uncommitted in the worktree: hook' };
    const issue = { id: 'iss_1', title: 'Broken screen' } as Issue;
    const gh: Gh = async (args) => { expect(args).toContain('--body-file'); return 'https://github.com/o/r/pull/4'; };
    const opened = await createPr(gh, { repo: 'o/r', defaultBranch: 'master', title: 'Fix screen', body: 'Report',
      labels: [], draft: true, fix, issue, commitMessage: 'fix: {title}' });
    expect(opened.number).toBe(4);
    expect(fix.commit).toBe(git(worktree, 'rev-parse', 'HEAD'));
    expect(fix.error).toBeUndefined();
    expect(git(worktree, 'status', '--porcelain')).toBe('');
    expect(git(source, 'ls-remote', 'origin', 'refs/heads/fix-branch')).toContain(fix.commit);
  });
});
