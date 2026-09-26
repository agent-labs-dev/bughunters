import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * Everything Bughunters owns lives in one folder at the project root:
 *
 *   .bughunters/
 *     bughunters.yml     committed: the config
 *     instructions.md    committed: the app guide for the explorer
 *     runs/              gitignored: sessions, issues, fixes, worktrees, memory
 *
 * The gate's committed manifest is small, diffs cleanly, and makes a baseline
 * change reviewable in the pull request. The pixels live in content-addressed
 * object storage; putting them in git is what makes every CI clone pay (spec 12.1).
 */
export const BUGHUNTERS_DIR = '.bughunters';
/** The gitignored part of BUGHUNTERS_DIR. */
export const DATA_DIR = 'runs';
export const CONFIG_FILENAME = 'bughunters.yml';

const data = (root: string, ...parts: string[]) => join(root, BUGHUNTERS_DIR, DATA_DIR, ...parts);

export const paths = {
  dir: (root: string) => join(root, BUGHUNTERS_DIR),
  /** Gitignored. All local output: nothing under it is committed. */
  data: (root: string) => data(root),
  /** Committed. */
  config: (root: string) => join(root, BUGHUNTERS_DIR, CONFIG_FILENAME),
  /** Committed. Human-reviewable. */
  appModel: (root: string) => join(root, BUGHUNTERS_DIR, 'appmodel.json'),
  /** Committed. Hashes + image digest, NOT the pixels. */
  baselineManifest: (root: string) => join(root, BUGHUNTERS_DIR, 'baselines.manifest.json'),
  /** Committed. Reviewable in PRs -- a ledger nobody can audit is a mute button. */
  intents: (root: string) => join(root, BUGHUNTERS_DIR, 'intents.json'),
  /** The local pixel store behind the manifest. */
  baselines: (root: string) => data(root, 'baselines'),
  /** Gate run output. */
  runs: (root: string) => data(root, 'gate'),
  run: (root: string, runId: string) => data(root, 'gate', runId),
  /** Progress for the gate run currently in flight. Rewritten per screen. */
  live: (root: string) => data(root, 'gate', 'live.json'),
  appMap: (root: string) => data(root, 'appmap.json'),
  /** What the judge already decided, by fingerprint, so a decided finding does not come back. */
  triage: (root: string) => data(root, 'triage.json'),
  memory: (root: string) => data(root, 'memory.json'),
  agentBaselines: (root: string) => data(root, 'agent-baselines'),
  agentBaseline: (root: string, id: string) => data(root, 'agent-baselines', `${id}.png`),
  agentBaselineSnapshot: (root: string, id: string) => data(root, 'agent-baselines', `${id}.snapshot.json`),
  worktrees: (root: string) => data(root, 'worktrees'),
  routines: (root: string) => data(root, 'routines'),
  routine: (root: string, id: string) => data(root, 'routines', `${id}.json`),
  issues: (root: string) => data(root, 'issues'),
  issue: (root: string, id: string) => data(root, 'issues', `${id}.json`),
  fixes: (root: string) => data(root, 'fixes'),
  fix: (root: string, id: string) => data(root, 'fixes', `${id}.json`),
  publish: (root: string) => data(root, 'publish'),
  sessions: (root: string) => data(root, 'sessions'),
  session: (root: string, id: string) => data(root, 'sessions', id),
  agents: (root: string) => data(root, 'agents.json'),
} as const;

/**
 * The project root: the nearest folder at or above `start` that holds
 * `.bughunters/bughunters.yml`, so a command works from any subfolder, the
 * way git does. With no config anywhere above, `start` itself.
 */
export function findProjectRoot(start: string): string {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(paths.config(dir))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return resolve(start);
    dir = parent;
  }
}

/**
 * The app guide for the explorer: `app.instructions` when it is set, else
 * `.bughunters/instructions.md` when that file exists.
 */
export function instructionsPath(root: string, configured?: string): string | undefined {
  if (configured) return resolve(root, configured);
  const fallback = join(root, BUGHUNTERS_DIR, 'instructions.md');
  return existsSync(fallback) ? fallback : undefined;
}

/**
 * Earlier versions kept bughunters.yml and instructions.md at the project root,
 * and the local data directly under `.bughunters/`. Returns how to move to the
 * current layout, or undefined when there is nothing old here.
 */
export function legacyLayout(root: string): string | undefined {
  if (!existsSync(join(root, CONFIG_FILENAME))) return undefined;
  return [
    `Bughunters now keeps its config in ${BUGHUNTERS_DIR}/. Run this command in ${root}:`,
    `  mkdir -p ${BUGHUNTERS_DIR} && mv ${CONFIG_FILENAME} instructions.md ${BUGHUNTERS_DIR}/`,
    `Then remove the \`instructions:\` line from ${BUGHUNTERS_DIR}/${CONFIG_FILENAME}.`,
    `Bughunters now writes its local data in ${BUGHUNTERS_DIR}/${DATA_DIR}/. Add ${BUGHUNTERS_DIR}/${DATA_DIR}/ to .gitignore.`,
  ].join('\n');
}

export type BaselineManifest = {
  version: 1;
  /** Every entry was captured in this image. Changing it invalidates them all. */
  imageDigest: string;
  entries: Record<string, { sha256: string; viewport: string; bytes: number; capturedAt: string }>;
};
