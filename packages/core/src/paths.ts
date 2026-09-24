import { join } from 'node:path';

/**
 * The committed manifest is small, diffs cleanly, and makes a baseline change
 * reviewable in the pull request. The pixels live in content-addressed object
 * storage; putting them in git is what makes every CI clone pay (spec 12.1).
 */
export const AUTOQA_DIR = '.autoqa';

export const paths = {
  dir: (root: string) => join(root, AUTOQA_DIR),
  /** Committed. Human-reviewable. */
  appModel: (root: string) => join(root, AUTOQA_DIR, 'appmodel.json'),
  /** Committed. Hashes + image digest, NOT the pixels. */
  baselineManifest: (root: string) => join(root, AUTOQA_DIR, 'baselines.manifest.json'),
  /** Committed. Reviewable in PRs -- a ledger nobody can audit is a mute button. */
  intents: (root: string) => join(root, AUTOQA_DIR, 'intents.json'),
  /** Gitignored. Local run output. */
  runs: (root: string) => join(root, AUTOQA_DIR, 'runs'),
  run: (root: string, runId: string) => join(root, AUTOQA_DIR, 'runs', runId),
  /** Progress for the run currently in flight. Gitignored, rewritten per screen. */
  live: (root: string) => join(root, AUTOQA_DIR, 'runs', 'live.json'),
  appMap: (root: string) => join(root, AUTOQA_DIR, 'appmap.json'),
  /** What the judge already decided, by fingerprint, so a decided finding does not come back. */
  triage: (root: string) => join(root, AUTOQA_DIR, 'triage.json'),
  agentBaselines: (root: string) => join(root, AUTOQA_DIR, 'agent-baselines'),
  agentBaseline: (root: string, id: string) => join(root, AUTOQA_DIR, 'agent-baselines', `${id}.png`),
  agentBaselineSnapshot: (root: string, id: string) => join(root, AUTOQA_DIR, 'agent-baselines', `${id}.snapshot.json`),
  worktrees: (root: string) => join(root, AUTOQA_DIR, 'worktrees'),
  routines: (root: string) => join(root, AUTOQA_DIR, 'routines'),
  routine: (root: string, id: string) => join(root, AUTOQA_DIR, 'routines', `${id}.json`),
  issues: (root: string) => join(root, AUTOQA_DIR, 'issues'),
  issue: (root: string, id: string) => join(root, AUTOQA_DIR, 'issues', `${id}.json`),
  fixes: (root: string) => join(root, AUTOQA_DIR, 'fixes'),
  fix: (root: string, id: string) => join(root, AUTOQA_DIR, 'fixes', `${id}.json`),
  sessions: (root: string) => join(root, AUTOQA_DIR, 'sessions'),
  session: (root: string, id: string) => join(root, AUTOQA_DIR, 'sessions', id),
  agents: (root: string) => join(root, AUTOQA_DIR, 'agents.json'),
  config: (root: string) => join(root, 'autoqa.yml'),
} as const;

export type BaselineManifest = {
  version: 1;
  /** Every entry was captured in this image. Changing it invalidates them all. */
  imageDigest: string;
  entries: Record<string, { sha256: string; viewport: string; bytes: number; capturedAt: string }>;
};
