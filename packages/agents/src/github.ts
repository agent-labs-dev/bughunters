import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { AutoQAConfig, FixProposal, Issue } from '@autoqa/core';
import { commitFix } from './roles/fixer.js';
import { Workspace } from './workspace.js';

export type Gh = (args: string[], opts?: { cwd?: string; input?: string }) => Promise<string>;

export const defaultGh: Gh = (args, opts) => new Promise((resolve, reject) => {
  const child = execFile('gh', args, { cwd: opts?.cwd, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
    if (error) reject(Object.assign(error, { stderr, stdout }));
    else resolve(stdout.trim());
  });
  child.stdin?.end(opts?.input);
});

const git = async (cwd: string, ...args: string[]) =>
  (await promisify(execFile)('git', args, { cwd, maxBuffer: 16 * 1024 * 1024 })).stdout.trim();
const json = (value: unknown) => JSON.stringify(value);
const errorText = (error: unknown) => `${String(error)} ${(error as { stderr?: string }).stderr ?? ''}`;
const missing = (error: unknown) => /404|not found/i.test(errorText(error));

export async function ghReady(gh: Gh = defaultGh): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    await gh(['--version']);
    await gh(['auth', 'status']);
    return { ok: true };
  } catch { return { ok: false, reason: 'GitHub publish skipped: gh is not logged in' }; }
}

export async function resolveRepo(gh: Gh, config: AutoQAConfig, source: string): Promise<{ repo: string; defaultBranch: string }> {
  const repo = config.agents.github.repo ?? await gh(['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'], { cwd: source });
  const defaultBranch = await gh(['repo', 'view', repo, '--json', 'defaultBranchRef', '-q', '.defaultBranchRef.name'], { cwd: source });
  return { repo, defaultBranch };
}

export async function ensureAssetsBranch(gh: Gh, repo: string, branch: string): Promise<void> {
  try { await gh(['api', `repos/${repo}/git/ref/heads/${branch}`]); return; }
  catch (error) { if (!missing(error)) throw error; }
  const blob = JSON.parse(await gh(['api', '-X', 'POST', `repos/${repo}/git/blobs`, '--input', '-'],
    { input: json({ content: 'Images for AutoQA reports. Not code; do not merge.', encoding: 'utf-8' }) })) as { sha: string };
  const tree = JSON.parse(await gh(['api', '-X', 'POST', `repos/${repo}/git/trees`, '--input', '-'],
    { input: json({ tree: [{ path: 'README.md', mode: '100644', type: 'blob', sha: blob.sha }] }) })) as { sha: string };
  const commit = JSON.parse(await gh(['api', '-X', 'POST', `repos/${repo}/git/commits`, '--input', '-'],
    { input: json({ message: 'Initialize AutoQA report assets', tree: tree.sha, parents: [] }) })) as { sha: string };
  await gh(['api', '-X', 'POST', `repos/${repo}/git/refs`, '--input', '-'],
    { input: json({ ref: `refs/heads/${branch}`, sha: commit.sha }) });
}

export async function uploadImage(gh: Gh, repo: string, branch: string, localPath: string, issueId: string): Promise<string> {
  const bytes = await readFile(localPath);
  const remotePath = `${issueId}/${createHash('sha256').update(bytes).digest('hex').slice(0, 12)}-${basename(localPath)}`;
  try { await gh(['api', `repos/${repo}/contents/${remotePath}?ref=${encodeURIComponent(branch)}`]); }
  catch (error) {
    if (!missing(error)) throw error;
    await gh(['api', '-X', 'PUT', `repos/${repo}/contents/${remotePath}`, '--input', '-'],
      { input: json({ message: 'AutoQA report image', content: bytes.toString('base64'), branch }) });
  }
  return `https://github.com/${repo}/blob/${branch}/${remotePath}?raw=true`;
}

export async function ensureLabels(gh: Gh, repo: string, labels: string[]): Promise<void> {
  for (const label of labels) try {
    await gh(['label', 'create', label, '--repo', repo, '--color', '5319e7', '--description', 'Filed by AutoQA']);
  } catch (error) { if (!/already exists/i.test(errorText(error))) throw error; }
}

export function limitBody(body: string): string {
  return body.length <= 60_000 ? body : `${body.slice(0, 60_000)}\n\n…(cut; the full report is in the AutoQA dashboard)`;
}

async function withBody<T>(body: string, run: (file: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'autoqa-gh-'));
  const file = join(dir, 'body.md');
  try { await writeFile(file, limitBody(body)); return await run(file); }
  finally { await rm(dir, { recursive: true, force: true }); }
}

const fromUrl = (url: string) => ({ url: url.trim(), number: Number(url.trim().split('/').at(-1)) });

export async function createPr(gh: Gh, input: { repo: string; defaultBranch: string; title: string; body: string;
  labels: string[]; draft: boolean; fix: FixProposal; issue: Issue; commitMessage: string; memoryRoot?: string }): Promise<{ number: number; url: string }> {
  const { fix } = input;
  if (await git(fix.worktree, 'status', '--porcelain')) {
    await git(fix.worktree, 'add', '-A');
    const committed = await commitFix(fix.worktree, input.issue.title, input.commitMessage);
    if (!committed.ok) {
      if (input.memoryRoot) await new Workspace(input.memoryRoot).upsertLessons([{ role: 'fixer',
        source: 'commit-hook', text: `The commit hook rejected a commit: ${committed.reason}. Make the change pass it.`.slice(0, 200) }]);
      throw new Error(committed.reason);
    }
    fix.commit = await git(fix.worktree, 'rev-parse', 'HEAD');
    if (fix.error?.startsWith('Left uncommitted')) fix.error = undefined;
  }
  if (!fix.commit) {
    // A fix from before AutoQA recorded its commit: trust the branch head
    // only when the branch has commits of its own past the default branch.
    await git(fix.worktree, 'fetch', '-q', 'origin', input.defaultBranch);
    const own = Number(await git(fix.worktree, 'rev-list', '--count', `origin/${input.defaultBranch}..HEAD`));
    if (own > 0) fix.commit = await git(fix.worktree, 'rev-parse', 'HEAD');
  }
  if (!fix.commit) throw new Error('The fix branch has no fix commit.');
  await git(fix.worktree, 'push', '-u', 'origin', fix.branch);
  return withBody(input.body, async (file) => fromUrl(await gh(['pr', 'create', '--repo', input.repo,
    '--base', input.defaultBranch, '--head', fix.branch, '--title', input.title, '--body-file', file,
    ...(input.draft ? ['--draft'] : []), ...input.labels.flatMap((label) => ['--label', label])], { cwd: fix.worktree })));
}

export async function createIssue(gh: Gh, input: { repo: string; title: string; body: string; labels: string[] }): Promise<{ number: number; url: string }> {
  return withBody(input.body, async (file) => fromUrl(await gh(['issue', 'create', '--repo', input.repo,
    '--title', input.title, '--body-file', file, ...input.labels.flatMap((label) => ['--label', label])])));
}

export async function closeIssue(gh: Gh, repo: string, number: number, comment: string,
  reason: 'completed' | 'not planned'): Promise<void> {
  await gh(['issue', 'close', String(number), '--repo', repo, '--comment', comment, '--reason', reason]);
}

export async function closeOnGitHub(root: string, config: AutoQAConfig, issue: Issue,
  gh: Gh = defaultGh, onLog: (message: string) => void = console.error): Promise<void> {
  if (!config.agents.github.enabled || !issue.github) return;
  try {
    const ready = await ghReady(gh);
    if (!ready.ok) { onLog(ready.reason); return; }
    const { repo } = await resolveRepo(gh, config, resolve(root, config.app.source));
    await closeIssue(gh, repo, issue.github.number, issue.closedBy?.reason ?? 'Fixed by AutoQA',
      issue.status === 'dismissed' ? 'not planned' : 'completed');
  } catch (error) { onLog(`GitHub close failed: ${String(error)}`); }
}
