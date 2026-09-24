import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { appendFile, copyFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { paths, shortHash, type Candidate, type Issue, type TriageFile } from '@autoqa/core';
import type { AgentSession } from '../session.js';
import type { Tool, ToolResult } from '../types.js';

const exec = promisify(execFile);
const response = (value: string): ToolResult => ({ content: [{ type: 'text', text: value }] });
const schema = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
const string = { type: 'string' };

function issueTitle(value: string): string {
  if (value.length <= 80) return value;
  const words = value.trim().split(/\s+/);
  let title = '';
  for (const word of words) {
    const next = title ? `${title} ${word}` : word;
    if (next.length > 79) break;
    title = next;
  }
  return `${title || value.slice(0, 79)}…`;
}

async function decisions(session: AgentSession, sessionId: string): Promise<Set<string>> {
  try {
    const lines = await readFile(join(paths.session(session.root, sessionId), 'decisions.jsonl'), 'utf8');
    return new Set(lines.trim().split('\n').filter(Boolean).map((line) =>
      (JSON.parse(line) as { candidateId: string }).candidateId));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Set();
    throw error;
  }
}

/** Excludes candidates already accepted or dismissed in the requested sessions. */
export async function pendingCandidates(session: AgentSession, sessionIds: string[]): Promise<Candidate[]> {
  const issues = await session.workspace.listIssues();
  const filed = new Set(issues.flatMap((item) => item.candidateIds));
  const pending: Candidate[] = [];
  for (const id of sessionIds) {
    const dismissed = await decisions(session, id);
    for (const candidate of await session.workspace.readCandidates(id)) {
      if (candidate.route?.to === 'judge' && !filed.has(candidate.id) && !dismissed.has(candidate.id)) {
        pending.push(candidate);
      }
    }
  }
  return pending;
}

async function image(session: AgentSession, file: string | undefined): Promise<ToolResult['content']> {
  if (!file) return [];
  try {
    return [{ type: 'image', png: await readFile(resolve(session.root, file)) }];
  } catch {
    return [];
  }
}

/** Pixel diffs are left out: an accepted visual change moves the baseline instead. */
function triageEntries(
  candidates: Candidate[],
  decision: 'filed' | 'dismissed',
  reason: string,
  issueId?: string,
): TriageFile['fingerprints'] {
  const at = new Date().toISOString();
  const entries: TriageFile['fingerprints'] = {};
  for (const candidate of candidates) {
    if (candidate.source === 'pixel-diff') continue;
    entries[candidate.fingerprint] = { decision, issueId, reason, at };
  }
  return entries;
}

/** Judge tools make every acceptance or dismissal auditable. */
export function judgeTools(session: AgentSession, sessionIds: string[], runtimeLabel: string): Tool[] {
  return [
    {
      name: 'list_candidates',
      description: 'List undecided candidates and existing issues.',
      inputSchema: schema({}),
      async run() {
        const candidates = await pendingCandidates(session, sessionIds);
        const issues = await session.workspace.listIssues();
        const summary = {
          candidates: candidates.map((item) => ({
            id: item.id,
            summary: item.summary,
            severity: item.severity,
            fingerprint: item.fingerprint,
          })),
          issues: issues.map((item) => ({
            id: item.id,
            title: item.title,
            fingerprint: item.fingerprint,
            status: item.status,
          })),
        };
        return response(JSON.stringify(summary));
      },
    },
    {
      name: 'view_candidate',
      description: 'Inspect a candidate and its screenshot, baseline, and diff before deciding.',
      inputSchema: schema({ id: string }, ['id']),
      async run(input) {
        const candidate = (await pendingCandidates(session, sessionIds)).find((item) => item.id === input.id);
        if (!candidate) return { ...response('Unknown or decided candidate'), isError: true };
        return { content: [
          { type: 'text', text: JSON.stringify(candidate, null, 2) },
          ...await image(session, candidate.evidence.screenshot),
          ...await image(session, candidate.evidence.baseline),
          ...await image(session, candidate.evidence.diff),
        ] };
      },
    },
    {
      name: 'file_issue',
      description: 'File a real user problem with an 80-character title, Markdown body, and one-sentence reason; '
        + 'merge candidates with the same cause. To add candidates to an OPEN issue, pass its issue_id and a '
        + 'reason; the title, body and severity are then not needed.',
      inputSchema: schema({
        candidate_ids: { type: 'array', items: string },
        issue_id: string,
        title: string,
        body: string,
        severity: { type: 'string', enum: ['cosmetic', 'minor', 'major', 'critical'] },
        reason: string,
      }, ['candidate_ids', 'reason']),
      async run(input) {
        if (typeof input.reason !== 'string' || !input.reason.trim()) {
          return { ...response('A one-sentence reason is required'), isError: true };
        }
        const named = typeof input.issue_id === 'string' && input.issue_id
          ? await session.workspace.readIssue(input.issue_id)
          : undefined;
        if (input.issue_id && (!named || named.status === 'dismissed')) {
          return { ...response(`No open issue ${String(input.issue_id)}`), isError: true };
        }
        if (!named && (!input.title || !input.body || !input.severity)) {
          return { ...response('A new issue needs a title, a body and a severity'), isError: true };
        }
        const ids = input.candidate_ids as string[];
        const candidates = (await pendingCandidates(session, sessionIds)).filter((item) => ids.includes(item.id));
        if (candidates.length !== ids.length || !ids.length) {
          return { ...response('Unknown or decided candidate id'), isError: true };
        }
        const first = candidates[0]!;
        const now = new Date().toISOString();
        // A named issue wins; otherwise the same fingerprint means the same issue.
        const existing = named ?? (await session.workspace.findIssueByFingerprint(first.fingerprint));
        let issue: Issue;
        if (existing && existing.status !== 'dismissed') {
          // One more occurrence per judging, however many candidates it merges.
          issue = {
            ...existing,
            candidateIds: [...new Set([...existing.candidateIds, ...ids])],
            occurrences: existing.occurrences + 1,
            lastSeenAt: now,
          };
        } else {
          issue = {
            version: 1,
            id: `iss_${shortHash(`${first.fingerprint}:${now}`)}`,
            fingerprint: first.fingerprint,
            title: issueTitle(String(input.title)),
            body: String(input.body),
            severity: input.severity as Issue['severity'],
            status: 'new',
            screenId: first.screenId,
            candidateIds: ids,
            evidence: first.evidence,
            judgement: { by: runtimeLabel, reason: input.reason.trim(), at: now },
            occurrences: 1,
            firstSeenAt: now,
            lastSeenAt: now,
          };
        }
        if (session.config.agents.judge.fileTo === 'github' && !issue.github) {
          const cwd = resolve(session.root, session.config.app.source);
          const output = await exec('gh', ['issue', 'create', '--title', issue.title, '--body', issue.body], { cwd });
          const url = output.stdout.trim();
          issue.github = { url, number: Number(url.split('/').pop()) };
          issue.status = 'filed';
        }
        await session.workspace.saveIssue(issue);
        await session.workspace.recordTriage(triageEntries(candidates, 'filed', issue.judgement.reason, issue.id));
        const merged = Boolean(existing && existing.status !== 'dismissed');
        const verb = merged ? `Added to (x${issue.occurrences})` : 'Filed';
        session.emit({ kind: 'issue', summary: `${verb} ${issue.title}` });
        return response(`${verb} ${issue.id}: ${issue.title}`);
      },
    },
    {
      name: 'dismiss',
      description: 'Dismiss noise with a reason; set update_baseline for an expected visual change.',
      inputSchema: schema({
        candidate_ids: { type: 'array', items: string },
        reason: string,
        update_baseline: { type: 'boolean' },
      }, ['candidate_ids', 'reason']),
      async run(input) {
        const ids = input.candidate_ids as string[];
        const candidates = (await pendingCandidates(session, sessionIds)).filter((item) => ids.includes(item.id));
        if (candidates.length !== ids.length || !ids.length) {
          return { ...response('Unknown or decided candidate id'), isError: true };
        }
        for (const candidate of candidates) {
          if (input.update_baseline && candidate.screenId && candidate.evidence.screenshot) {
            await copyFile(resolve(session.root, candidate.evidence.screenshot),
              paths.agentBaseline(session.root, candidate.screenId));
            const snapshot = join(paths.session(session.root, candidate.sessionId),
              `${candidate.screenId}.snapshot.json`);
            try {
              await copyFile(snapshot, paths.agentBaselineSnapshot(session.root, candidate.screenId));
            } catch {
              // Explorer-only reports may not have a structural snapshot.
            }
          }
          await appendFile(join(paths.session(session.root, candidate.sessionId), 'decisions.jsonl'),
            JSON.stringify({ candidateId: candidate.id, decision: 'dismiss', reason: input.reason,
              at: new Date().toISOString() }) + '\n');
        }
        await session.workspace.recordTriage(triageEntries(candidates, 'dismissed', String(input.reason)));
        return response(`Dismissed ${candidates.length} candidate(s).`);
      },
    },
    {
      name: 'finish',
      description: 'Finish judging with one sentence per decision.',
      inputSchema: schema({ summary: string }, ['summary']),
      async run(input) {
        return { ...response(String(input.summary)), done: true };
      },
    },
  ];
}
