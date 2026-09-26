import { execFile } from 'node:child_process';
import { lstat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { paths, type BughuntersConfig, type FixProposal } from '@bughunters/core';
import { Workspace } from '../workspace.js';

const exec = promisify(execFile);
const git = async (repo: string, ...args: string[]) =>
  (await exec('git', ['-C', repo, ...args])).stdout.trim();
const message = (error: unknown) =>
  ((error as { stderr?: string }).stderr || String(error)).trim();

/** Remove finished fix checkouts without discarding local work or unpublished commits. */
export async function cleanWorktrees(root: string, _config: BughuntersConfig,
  deps: { onLog?: (message: string) => void } = {}): Promise<{
    removed: string[]; kept: { id: string; reason: string }[];
  }> {
  const workspace = new Workspace(root);
  const issues = new Map((await workspace.listIssues()).map((issue) => [issue.id, issue]));
  const removed: string[] = [];
  const kept: { id: string; reason: string }[] = [];
  const worktrees = resolve(paths.worktrees(root)) + sep;
  for (const fix of await workspace.listFixes()) {
    // The worktree is gone, but its branch may still wait for a safe delete
    // (for example, the PR merged after the worktree went away).
    if (fix.worktreeRemovedAt) { await deleteBranch(fix, deps.onLog); continue; }
    if (fix.status === 'running' || fix.status === 'retesting') {
      kept.push({ id: fix.id, reason: 'active fix' });
      continue;
    }
    if (!resolve(fix.worktree).startsWith(worktrees)) {
      kept.push({ id: fix.id, reason: 'outside Bughunters worktrees' });
      continue;
    }
    try { await lstat(fix.worktree); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        kept.push({ id: fix.id, reason: message(error) });
        continue;
      }
      fix.worktreeRemovedAt = new Date().toISOString();
      await workspace.saveFix(fix);
      removed.push(fix.id);
      try { await git(fix.repo, 'worktree', 'prune'); }
      catch (pruneError) { deps.onLog?.(`Worktree prune failed: ${message(pruneError)}`); }
      continue;
    }
    try {
      if (await git(fix.worktree, 'status', '--porcelain')) {
        kept.push({ id: fix.id, reason: 'uncommitted changes' });
        continue;
      }
      const issue = issues.get(fix.issueId);
      const done = fix.pr?.state === 'merged' || fix.pr?.state === 'closed'
        || issue?.status === 'dismissed' || issue?.status === 'fixed';
      if (!done) {
        if (fix.status !== 'declined' && fix.status !== 'failed') continue;
        const base = await git(fix.worktree, 'merge-base', 'HEAD', await git(fix.repo, 'rev-parse', 'HEAD'));
        if (Number(await git(fix.worktree, 'rev-list', '--count', `${base}..HEAD`)) > 0) {
          kept.push({ id: fix.id, reason: 'local commits' });
          continue;
        }
      }
      await git(fix.repo, 'worktree', 'remove', fix.worktree);
      fix.worktreeRemovedAt = new Date().toISOString();
      await workspace.saveFix(fix);
      removed.push(fix.id);
      await deleteBranch(fix, deps.onLog);
      try { await git(fix.repo, 'worktree', 'prune'); }
      catch (pruneError) { deps.onLog?.(`Worktree prune failed: ${message(pruneError)}`); }
    } catch (error) {
      kept.push({ id: fix.id, reason: message(error) });
    }
  }
  return { removed, kept };
}

async function deleteBranch(fix: FixProposal, onLog?: (message: string) => void): Promise<void> {
  if (!fix.branch) return;
  try { await git(fix.repo, 'show-ref', '--verify', '--quiet', `refs/heads/${fix.branch}`); }
  catch { return; }
  let sameRemote = false;
  try {
    await git(fix.repo, 'fetch', '-q', 'origin', fix.branch);
    sameRemote = await git(fix.repo, 'rev-parse', fix.branch)
      === await git(fix.repo, 'rev-parse', `origin/${fix.branch}`);
  } catch { /* A missing remote branch is not proof that deletion is safe. */ }
  // A branch with no commit of its own (a declined fix) only points at an old
  // commit of the checkout's history, so deleting it loses nothing.
  let empty = false;
  try { await git(fix.repo, 'merge-base', '--is-ancestor', fix.branch, 'HEAD'); empty = true; } catch { /* It has its own commits. */ }
  if (fix.pr?.state !== 'merged' && !sameRemote && !empty) {
    onLog?.(`Kept branch ${fix.branch}: no merged PR or matching remote commit.`);
    return;
  }
  try {
    await git(fix.repo, 'branch', '-d', fix.branch);
  } catch (error) {
    // A squash merge leaves the branch "not fully merged" for git, but the PR
    // is merged: the change is on the default branch, so nothing is lost.
    if (sameRemote || fix.pr?.state === 'merged') {
      try { await git(fix.repo, 'branch', '-D', fix.branch); return; }
      catch (forceError) { error = forceError; }
    }
    onLog?.(`Kept branch ${fix.branch}: ${message(error)}`);
  }
}
