import { readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { paths, type AgentEvent, type AgentRole, type AgentStatus, type AgentsFile, type AppMap,
  type Candidate, type FixProposal, type Issue, type MemoryFile, type Routine, type SessionSummary } from '@autoqa/core';

const roles: AgentRole[] = ['explorer', 'judge', 'fixer'];
const severity = { critical: 0, major: 1, minor: 2, cosmetic: 3 };
const open = new Set(['new', 'filed', 'fixing', 'fix-proposed']);

/** Files are written by live agents; a torn or missing read is ordinary, not a server failure. */
function readJson<T>(file: string): T | undefined {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

function list(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function jsonLines<T>(file: string): T[] {
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  // The last line can be in flight. A complete but invalid line is skipped too.
  return raw.split('\n').flatMap((line) => {
    try {
      return line.trim() ? [JSON.parse(line) as T] : [];
    } catch {
      return [];
    }
  });
}

/**
 * A status file says what a process was doing when it last wrote. When that
 * process is gone (killed, crashed, the laptop slept), "working" is a lie, so
 * the reader checks the pid before it believes it. A record with no pid is
 * taken at its word.
 */
export function processAlive(pid: number | undefined): boolean {
  if (!pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

const STOPPED = 'Stopped: its process ended.';

export class AgentReader {
  constructor(private readonly root: string) {}

  memory(): MemoryFile {
    const value = readJson<MemoryFile>(paths.memory(this.root));
    return Array.isArray(value?.lessons) ? value : { version: 1, lessons: [] };
  }

  agents(): AgentsFile | undefined {
    const value = readJson<AgentsFile>(paths.agents(this.root));
    if (!Array.isArray(value?.agents)) return undefined;
    const agents = value.agents
      .filter((agent) => agent && roles.includes(agent.role) && typeof agent.state === 'string')
      .map((agent) => {
        const busy = agent.state === 'working' || agent.state === 'waiting';
        return busy && !processAlive(agent.pid) ? { ...agent, state: 'idle' as const, activity: STOPPED } : agent;
      });
    const patrol = value.patrol?.state === 'running' && !processAlive(value.patrol.pid)
      ? { ...value.patrol, state: 'stopped' as const, nextAt: undefined }
      : value.patrol;
    return { ...value, agents, patrol };
  }

  appmap(): AppMap {
    const value = readJson<AppMap>(paths.appMap(this.root));
    if (!Array.isArray(value?.screens)) return { version: 1, platform: 'web', screens: [], updatedAt: '' };
    return { ...value, screens: value.screens.filter((screen) =>
      screen && typeof screen.id === 'string' && typeof screen.lastSeenAt === 'string') };
  }

  issues(): (Issue & { pr?: FixProposal['pr'] })[] {
    const fixes = this.fixes();
    return list(paths.issues(this.root)).filter((name) => name.endsWith('.json'))
      .map((name) => readJson<Issue>(join(paths.issues(this.root), name)))
      .filter((issue): issue is Issue => Boolean(issue?.id && issue.title && issue.lastSeenAt
        && issue.evidence && issue.judgement && Array.isArray(issue.candidateIds)))
      .map((issue) => ({ ...issue, pr: fixes.find((fix) => fix.id === issue.fixId || fix.issueId === issue.id)?.pr }))
      .sort((a, b) => (severity[a.severity] ?? 9) - (severity[b.severity] ?? 9)
        || b.lastSeenAt.localeCompare(a.lastSeenAt));
  }

  fixes(): FixProposal[] {
    return list(paths.fixes(this.root)).filter((name) => name.endsWith('.json'))
      .map((name) => readJson<FixProposal>(join(paths.fixes(this.root), name)))
      .filter((fix): fix is FixProposal => Boolean(fix?.id && fix.issueId));
  }

  routines(): Routine[] {
    return list(paths.routines(this.root)).filter((name) => name.endsWith('.json'))
      .map((name) => readJson<Routine>(join(paths.routines(this.root), name)))
      .filter((routine): routine is Routine => Boolean(routine?.id && Array.isArray(routine.steps)));
  }

  sessions(limit = 50): SessionSummary[] {
    return list(paths.sessions(this.root)).filter((id) => /^[\w-]+$/.test(id))
      .map((id) => ({ id, value: readJson<SessionSummary>(join(paths.session(this.root, id), 'session.json')) }))
      .filter(({ id, value }) => value?.id === id)
      .map(({ value }) => value)
      .filter((session): session is SessionSummary => Boolean(session?.id && session.startedAt
        && Array.isArray(session.screensFound) && Array.isArray(session.issues)))
      .map((session) => (session.status === 'running' && !processAlive(session.pid)
        ? { ...session, status: 'failed' as const, summary: session.summary ?? `Interrupted. ${STOPPED}` }
        : session))
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, limit);
  }

  session(id: string): { session: SessionSummary; events: AgentEvent[]; candidates: Candidate[] } | undefined {
    const session = this.sessions(Infinity).find((entry) => entry.id === id);
    if (!session) return undefined;
    const dir = paths.session(this.root, id);
    return {
      session,
      events: jsonLines<AgentEvent>(join(dir, 'events.jsonl')),
      candidates: jsonLines<Candidate>(join(dir, 'candidates.jsonl')),
    };
  }

  issue(id: string): { issue: Issue; fix?: FixProposal; candidates: Candidate[]; routine?: Routine } | undefined {
    const issue = this.issues().find((entry) => entry.id === id);
    if (!issue) return undefined;
    const fix = this.fixes().find((entry) => entry.id === issue.fixId || entry.issueId === id);
    const routine = this.routines().find((entry) => entry.id === issue.evidence?.routineId);
    const ids = new Set(issue.candidateIds);
    const candidates = this.sessions(Infinity).flatMap((session) =>
      jsonLines<Candidate>(join(paths.session(this.root, session.id), 'candidates.jsonl')))
      .filter((candidate) => ids.has(candidate.id));
    return { issue, fix, candidates, routine };
  }

  screens(): Omit<AppMap, 'screens'> & { screens: (AppMap['screens'][number] & { openIssues: number })[] } {
    const map = this.appmap();
    const issues = this.issues().filter((issue) => open.has(issue.status));
    return { ...map, screens: map.screens.map((screen) => ({
      ...screen,
      openIssues: issues.filter((issue) => issue.screenId === screen.id).length,
    })) };
  }

  overview(now = new Date()): object {
    const agentFile = this.agents();
    const appmap = this.appmap();
    const issues = this.issues();
    const sessions = this.sessions(Infinity);
    const today = now.toLocaleDateString('en-CA');
    const agents: AgentStatus[] = roles.map((role) => agentFile?.agents.find((agent) => agent.role === role) ?? {
      role, state: 'off', runtime: '', updatedAt: '', spentUsd: 0,
    });
    const active = sessions.find((session) => session.status === 'running');
    const detail = active ? this.session(active.id) : undefined;
    const events = detail?.events.filter(isFeedEvent).slice(-12) ?? [];
    const screenshot = [...(detail?.events ?? [])].reverse().find((event) => event.screenshot)?.screenshot;
    const openIssues = issues.filter((issue) => open.has(issue.status));
    const fixes = this.fixes();
    const attention = openIssues
      .filter((issue) => ['new', 'filed', 'fix-proposed'].includes(issue.status))
      .slice(0, 8)
      .map((issue) => {
        const fix = fixes.find((entry) => entry.id === issue.fixId || entry.issueId === issue.id);
        return { ...issue, pr: fix?.pr, fix: fix ? { status: fix.status } : undefined };
      });
    const prStates = fixes.map((fix) => fix.pr?.state).filter(Boolean);
    const issueStates = issues.map((issue) => issue.github?.state).filter(Boolean);
    const github = fixes.some((fix) => fix.pr) || issues.some((issue) => issue.github)
      ? `PRs: ${['open', 'merged', 'closed'].map((state) => `${prStates.filter((item) => item === state).length} ${state}`).join(' · ')} · `
        + `Issues: ${['open', 'closed'].map((state) => `${issueStates.filter((item) => item === state).length} ${state}`).join(' · ')}`
      : undefined;
    return {
      project: { name: basename(this.root), platform: appmap.platform },
      patrol: agentFile?.patrol ?? { state: 'stopped', cycle: 0 },
      agents,
      counts: {
        issuesOpen: openIssues.length,
        issuesBySeverity: Object.fromEntries(Object.keys(severity).map((key) => [key,
          openIssues.filter((issue) => issue.severity === key).length])),
        fixesProposed: fixes.filter((fix) => fix.status === 'proposed').length,
        screens: appmap.screens.length,
        sessionsToday: sessions.filter((session) =>
          new Date(session.startedAt).toLocaleDateString('en-CA') === today).length,
        spentTodayUsd: sessions.filter((session) => new Date(session.startedAt).toLocaleDateString('en-CA') === today)
          .reduce((sum, session) => sum + session.costUsd, 0),
      },
      attention,
      github,
      live: detail ? { summary: detail.session, events, screenshot } : null,
      recentSessions: sessions.slice(0, 6),
      screens: [...appmap.screens].sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt)).slice(0, 8),
    };
  }
}

/**
 * The feed shows what the agent did, not how it thought about it. Reasoning
 * and the raw tool call are one level down (the session timeline's toggle);
 * a tool result with an empty summary is one that another event already
 * reports, such as a recorded screen.
 */
export function isFeedEvent(event: AgentEvent): boolean {
  if (event.kind === 'thought' || event.kind === 'tool-call') return false;
  return event.summary.trim().length > 0;
}
