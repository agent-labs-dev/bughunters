import { execFileSync } from 'node:child_process';
import { ConfigError, type Issue, type TriageFile } from '@autoqa/core';
import { Workspace } from '@autoqa/agents';

/**
 * `autoqa issue list | dismiss <id> --reason "..." [--by name] | reopen <id>`
 *
 * The judge is a model, and a model is sometimes wrong. A human override is
 * the last word: a dismissed issue closes, and its fingerprints go into
 * triage.json, so the same finding does not come back on the next patrol.
 */
export async function runIssueCommand(args: string[], root: string, log: (line: string) => void): Promise<void> {
  const [action, id, ...rest] = args;
  const workspace = new Workspace(root);

  if (action === 'list' || action === undefined) {
    const issues = await workspace.listIssues();
    for (const issue of issues.sort(bySeverity)) {
      log(`${issue.id}  ${issue.severity.padEnd(8)} ${issue.status.padEnd(12)} x${issue.occurrences}  ${issue.title}`);
    }
    if (issues.length === 0) log('No issues.');
    return;
  }

  if (!id) throw new ConfigError(`autoqa issue ${action} needs an issue id`);
  const issue = await workspace.readIssue(id);
  if (!issue) throw new ConfigError(`No issue ${id}. Run \`autoqa issue list\`.`);

  if (action === 'dismiss') {
    const reason = flagValue(rest, '--reason');
    if (!reason) throw new ConfigError('autoqa issue dismiss needs --reason "why this is not a problem"');
    const by = flagValue(rest, '--by') ?? author();
    const at = new Date().toISOString();
    await workspace.saveIssue({ ...issue, status: 'dismissed', closedBy: { by, reason, at } });
    await workspace.recordTriage(await dismissedFingerprints(workspace, issue, reason, at));
    log(`Dismissed ${issue.id}: ${issue.title}`);
    return;
  }

  if (action === 'reopen') {
    await workspace.saveIssue({ ...issue, status: 'new', closedBy: undefined });
    log(`Reopened ${issue.id}. Its fingerprints stay in triage.json until the judge files it again.`);
    return;
  }

  throw new ConfigError(`Unknown issue action: ${action}. Use list, dismiss or reopen.`);
}

/** The issue's own fingerprint and every candidate it collected. */
async function dismissedFingerprints(
  workspace: Workspace,
  issue: Issue,
  reason: string,
  at: string,
): Promise<TriageFile['fingerprints']> {
  const entries: TriageFile['fingerprints'] = {
    [issue.fingerprint]: { decision: 'dismissed', issueId: issue.id, reason, at },
  };
  const ids = new Set(issue.candidateIds);
  for (const session of await workspace.listSessions(Infinity)) {
    for (const candidate of await workspace.readCandidates(session.id)) {
      if (!ids.has(candidate.id)) continue;
      entries[candidate.fingerprint] = { decision: 'dismissed', issueId: issue.id, reason, at };
    }
  }
  return entries;
}

function flagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function author(): string {
  try {
    return execFileSync('git', ['config', 'user.name'], { encoding: 'utf8' }).trim() || 'human';
  } catch {
    return process.env.USER ?? 'human';
  }
}

const RANK: Record<Issue['severity'], number> = { critical: 0, major: 1, minor: 2, cosmetic: 3 };

function bySeverity(a: Issue, b: Issue): number {
  return RANK[a.severity] - RANK[b.severity] || b.lastSeenAt.localeCompare(a.lastSeenAt);
}
