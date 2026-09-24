import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { paths, type FixProposal, type Issue, type RoutineStep } from '@autoqa/core';
import type { AgentSession } from '../session.js';
import type { RoleOutcome, Runtime, Tool } from '../types.js';
import { fixerSystem } from '../prompts.js';

const exec = promisify(execFile);
const ranks = {
  cosmetic: 0,
  minor: 1,
  major: 2,
  critical: 3,
};
const result = (text: string) => ({ content: [{ type: 'text' as const, text }] });

async function git(cwd: string, ...args: string[]): Promise<string> {
  const output = await exec('git', args, { cwd, maxBuffer: 4 * 1024 * 1024 });
  return output.stdout.trim();
}

function confined(worktree: string, path: string): string {
  const file = resolve(worktree, path);
  if (file !== worktree && !file.startsWith(worktree + sep)) throw new Error('Path leaves worktree');
  return file;
}

async function existingPath(worktree: string, path: string): Promise<string> {
  const file = confined(worktree, path);
  const real = await realpath(file);
  if (real !== worktree && !real.startsWith(worktree + sep)) throw new Error('Path leaves worktree');
  return file;
}

function modelTools(worktree: string): Tool[] {
  return [
    {
      name: 'read_file',
      description: 'Read a file in the worktree.',
      inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
      async run(input) {
        const path = await existingPath(worktree, String(input.path));
        return result(await readFile(path, 'utf8'));
      },
    },
    {
      name: 'list_files',
      description: 'List files in a directory.',
      inputSchema: { type: 'object', properties: { dir: { type: 'string' } } },
      async run(input) {
        const path = await existingPath(worktree, String(input.dir ?? '.'));
        return result((await readdir(path)).join('\n'));
      },
    },
    {
      name: 'search',
      description: 'Search tracked files with git grep.',
      inputSchema: { type: 'object', properties: { pattern: { type: 'string' } } },
      async run(input) {
        try {
          return result((await git(worktree, 'grep', '-n', String(input.pattern))).slice(-4000));
        } catch {
          return result('No matches');
        }
      },
    },
    {
      name: 'write_file',
      description: 'Write a file in the worktree.',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' }, content: { type: 'string' } },
      },
      async run(input) {
        const file = confined(worktree, String(input.path));
        const parent = resolve(file, '..');
        const real = await realpath(parent);
        if (real !== worktree && !real.startsWith(worktree + sep)) throw new Error('Path leaves worktree');
        try {
          await existingPath(worktree, String(input.path));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        await writeFile(file, String(input.content));
        return result(`Wrote ${relative(worktree, file)}`);
      },
    },
    {
      name: 'run',
      description: 'Run a command in the worktree with a five-minute timeout.',
      inputSchema: { type: 'object', properties: { command: { type: 'string' } } },
      async run(input) {
        try {
          const output = await exec('/bin/sh', ['-c', String(input.command)],
            { cwd: worktree, timeout: 300_000, maxBuffer: 4 * 1024 * 1024 });
          return result((output.stdout + output.stderr).slice(-4000));
        } catch (error) {
          return { ...result(String(error).slice(-4000)), isError: true };
        }
      },
    },
  ];
}

function finishTool(): Tool {
  return {
    name: 'finish',
    description: 'Finish with a summary.',
    inputSchema: { type: 'object', properties: { summary: { type: 'string' } } },
    async run(input) {
      return { ...result(String(input.summary ?? '')), done: true };
    },
  };
}

/**
 * The configured message (default `fix: <title>`), cut to 72 characters: the
 * plain conventional form, which most repositories accept. A rejection returns the hook's
 * last line so the dashboard can say why.
 */
async function commitFix(
  worktree: string,
  title: string,
  template: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const lowered = `${title.charAt(0).toLowerCase()}${title.slice(1)}`;
  const subject = template.replaceAll('{title}', lowered);
  const message = subject.length > 72 ? `${subject.slice(0, 69).trimEnd()}...` : subject;
  try {
    await git(worktree, 'commit', '-m', message);
    return { ok: true };
  } catch (error) {
    const output = error as Error & { stdout?: string; stderr?: string };
    const lines = `${output.stderr ?? ''}\n${output.stdout ?? ''}`.split('\n').map((line) => line.trim());
    const reason = lines.filter((line) => /✗|error|not allowed|fail/i.test(line)).slice(0, 2).join(' ');
    return { ok: false, reason: reason || 'the commit hook rejected the commit' };
  }
}

/**
 * Reads the issue again before the write. A fix takes minutes, and a human
 * may close the issue meanwhile; a human decision is never overwritten.
 */
async function updateIssue(session: AgentSession, id: string, patch: Partial<Issue>): Promise<void> {
  const current = await session.workspace.readIssue(id);
  if (!current || current.status === 'dismissed') return;
  await session.workspace.saveIssue({ ...current, ...patch });
}

/** Each issue gets an isolated branch; a proposal is committed locally after verification. */
export async function runFixer(
  session: AgentSession, runtime: Runtime, opts: { issueIds?: string[] } = {},
): Promise<FixProposal[]> {
  const config = session.config.agents.fixer;
  const source = resolve(session.root, session.config.app.source);
  const all = await session.workspace.listIssues();
  const fixes = await session.workspace.listFixes();
  // A 'running' proposal older than the time limit belongs to a fixer that
  // was killed; without this, its issue would wait for it forever.
  const abandoned = (fix: FixProposal) =>
    fix.status === 'running' && Date.now() - Date.parse(fix.startedAt) > config.timeoutMs;
  const failed = new Set(fixes
    .filter((fix) => fix.status === 'failed' || abandoned(fix))
    .map((fix) => fix.issueId));
  const eligible = all.filter((issue) => {
    if (opts.issueIds) return opts.issueIds.includes(issue.id);
    const pending = ['new', 'filed'].includes(issue.status) || failed.has(issue.id);
    if (issue.status === 'dismissed') return false;
    return pending && (!issue.fixId || failed.has(issue.id))
      && ranks[issue.severity] >= ranks[config.minSeverity];
  });
  // A fixer run is minutes of a coding agent. The worst issues go first, and
  // the rest wait for the next cycle instead of queueing an hour of work.
  const selected = opts.issueIds
    ? eligible
    : eligible
      .sort((a, b) => ranks[b.severity] - ranks[a.severity] || b.occurrences - a.occurrences)
      .slice(0, config.maxPerCycle);
  const proposals: FixProposal[] = [];
  await session.activity(`Fixing ${selected.length} issue(s)`, 0, runtime.label);
  for (const issue of selected) {
    // A stop request ends the queue between fixes, never inside one.
    if (session.cancelled) break;
    const branch = `autoqa/fix-${issue.id}`;
    const worktree = join(paths.worktrees(session.root), issue.id);
    await mkdir(paths.worktrees(session.root), { recursive: true });
    let existing = false;
    try {
      await realpath(worktree);
      existing = true;
    } catch {
      await git(source, 'worktree', 'add', '-b', branch, worktree, 'HEAD');
    }
    if (existing && failed.has(issue.id)) {
      const base = await git(worktree, 'merge-base', 'HEAD', await git(source, 'rev-parse', 'HEAD'));
      await git(worktree, 'reset', '--hard', base);
      await git(worktree, 'clean', '-fd');
    }
    const proposal: FixProposal = {
      version: 1,
      id: `fix_${issue.id}`,
      issueId: issue.id,
      status: 'running',
      runtime: runtime.label,
      repo: source,
      branch,
      worktree,
      startedAt: new Date().toISOString(),
    };
    await session.workspace.saveFix(proposal);
    await session.workspace.saveIssue({ ...issue, status: 'fixing' });
    session.emit({ kind: 'fix', summary: `Fixing ${issue.title}` });
    try {
      const outcome = await runOne(session, runtime, issue, worktree);
      if (outcome.stop !== 'done') {
        throw new Error(outcome.error ?? `Fixer stopped: ${outcome.stop}`);
      }
      proposal.costUsd = outcome.costUsd;
      proposal.summary = outcome.summary;
      await git(worktree, 'add', '-A');
      proposal.diffStat = await git(worktree, 'diff', '--cached', '--stat');
      proposal.diff = Buffer.from(await git(worktree, 'diff', '--cached'))
        .subarray(0, 200_000).toString('utf8');
      if (!proposal.diff) {
        // No change plus an explanation is a finding too: the fixer read the
        // code and says the report is wrong or the behaviour is intended.
        proposal.status = outcome.summary ? 'declined' : 'failed';
        if (!outcome.summary) proposal.error = 'The fixer made no change and gave no reason.';
        await updateIssue(session, issue.id, { status: issue.status });
        proposal.endedAt = new Date().toISOString();
        await session.workspace.saveFix(proposal);
        proposals.push(proposal);
        continue;
      }
      if (config.verify) {
        try {
          await exec('/bin/sh', ['-c', config.verify], {
            cwd: worktree,
            timeout: 300_000,
            maxBuffer: 4 * 1024 * 1024,
          });
        } catch (error) {
          const output = error as Error & { stdout?: string; stderr?: string };
          throw new Error(`Verification failed: ${(output.stderr || output.stdout || output.message).slice(-4000)}`);
        }
      }
      proposal.status = 'proposed';
      const committed = await commitFix(worktree, issue.title, config.commitMessage);
      if (!committed.ok) {
        // The diff is the proposal; a commit is only a convenience. A repo's
        // commit hook (scope rules, lint) must never throw a good fix away,
        // and AutoQA never bypasses a hook with --no-verify.
        proposal.error = `Left uncommitted in the worktree: ${committed.reason}`;
      }
      if (committed.ok && config.openPRs === 'draft') {
        await git(worktree, 'push', '-u', 'origin', branch);
        const output = await exec('gh', ['pr', 'create', '--draft', '--title', issue.title,
          '--body', issue.body], { cwd: worktree });
        const url = output.stdout.trim();
        proposal.pr = {
          url,
          number: Number(url.split('/').pop()),
          draft: true,
        };
        proposal.status = 'opened';
      }
      await updateIssue(session, issue.id, { status: 'fix-proposed', fixId: proposal.id });
    } catch (error) {
      proposal.status = 'failed';
      proposal.error = String(error);
      await updateIssue(session, issue.id, { status: issue.status });
    }
    proposal.endedAt = new Date().toISOString();
    await session.workspace.saveFix(proposal);
    proposals.push(proposal);
  }
  await session.workspace.endSession(session.sessionId, {
    summary: `${proposals.length} fix proposal(s)`,
    issues: proposals.map((item) => item.issueId),
  });
  await session.idle(proposals.reduce((sum, item) => sum + (item.costUsd ?? 0), 0));
  return proposals;
}

async function runOne(session: AgentSession, runtime: Runtime, issue: Issue, worktree: string): Promise<RoleOutcome> {
  const config = session.config.agents.fixer;
  const evidencePaths = Object.entries(issue.evidence)
    .filter(([key]) => ['screenshot', 'baseline', 'diff'].includes(key))
    .map(([key, value]) => `${key}: ${resolve(session.root, String(value))}`);
  const evidence = evidencePaths.join('\n');
  const steps = (issue.evidence.steps ?? []).map((step, index) => `${index + 1}. ${stepWords(step)}`);
  const repro = `Run the routine ${issue.evidence.routineId ?? '(none)'}, then:\n${steps.join('\n')}`;
  return runtime.run({
    role: 'fixer',
    sessionId: session.sessionId,
    workdir: worktree,
    system: fixerSystem(),
    prompt: `Issue: ${issue.title}\nSeverity: ${issue.severity}\n${issue.body}\nEvidence:\n${evidence}\n` +
      `Reproduction: ${repro}`,
    tools: runtime.label.startsWith('cli:') ? [finishTool()] : [...modelTools(worktree), finishTool()],
    maxSteps: config.maxSteps,
    budgetUsd: config.budgetUsd,
    timeoutMs: config.timeoutMs,
  }, session.emit);
}

function stepWords(step: RoutineStep): string {
  if (step.kind === 'tap') {
    return `Tap ${step.target.name ?? step.target.testId ?? step.target.text ?? step.target.selector ?? 'target'}`;
  }
  if (step.kind === 'type') {
    return `Type ${step.value}${step.submit ? ' and submit' : ''}`;
  }
  if (step.kind === 'scroll') return `Scroll ${step.direction}`;
  if (step.kind === 'press') return `Press ${step.key}`;
  if (step.kind === 'open') return `Open ${step.url}`;
  if (step.kind === 'window') return `Switch to window ${step.match}`;
  if (step.kind === 'wait') return `Wait ${step.ms} ms`;
  return 'Go back';
}
