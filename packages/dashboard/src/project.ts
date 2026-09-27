import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { confinedFile } from './files.js';
import { paths, type AppModel, type Finding, type Intent, type LiveProgress, type Run, type RunTrace } from '@bughunters/core';

export type RunRecord = {
  id: string;
  dir: string;
  run: Run;
  findings: Finding[];
  trace?: RunTrace;
  mtimeMs: number;
};

export type RunSummary = {
  id: string;
  status: Run['status'];
  exitCode: number;
  mode: string;
  commit: string;
  startedAt: string;
  endedAt?: string;
  screensSelected: number;
  screensTotal: number;
  findings: { total: number; blocking: number; issues: number; questions: number };
  suppressed: number;
  costUsd: number;
};

/**
 * Reads the `.bughunters/` directory that the CLI writes. The dashboard is a
 * READER: it never mutates run state, so a browser tab left open cannot
 * corrupt a run or race the CLI writing one.
 */
export class ProjectReader {
  constructor(private readonly root: string) {}

  get bughuntersDir(): string {
    return paths.dir(this.root);
  }

  hasProject(): boolean {
    return existsSync(paths.config(this.root)) || existsSync(this.bughuntersDir);
  }

  /** Newest first. `latest/` holds loose capture artifacts, not a run. */
  listRunIds(): string[] {
    const dir = paths.runs(this.root);
    if (!existsSync(dir)) return [];
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name !== 'latest')
      .map((e) => ({ name: e.name, mtime: safeMtime(join(dir, e.name)) }))
      .sort((a, b) => b.mtime - a.mtime)
      .map((e) => e.name);
  }

  readRun(runId: string): RunRecord | undefined {
    if (!/^[a-zA-Z0-9_-]+$/.test(runId)) return undefined;
    const dir = join(paths.runs(this.root), runId);
    const runFile = confinedFile(paths.runs(this.root), join(dir, 'run.json'));
    if (!runFile) return undefined;

    try {
      const parsed = JSON.parse(readFileSync(runFile, 'utf8')) as { run: Run; findings: Finding[] };
      const traceFile = confinedFile(paths.runs(this.root), join(dir, 'trace.json'));
      const trace = traceFile
        ? (JSON.parse(readFileSync(traceFile, 'utf8')) as RunTrace)
        : undefined;
      return { id: runId, dir, run: parsed.run, findings: parsed.findings, trace, mtimeMs: safeMtime(dir) };
    } catch {
      // A run still being written is not an error worth surfacing; it will
      // appear on the next poll once the CLI finishes the file.
      return undefined;
    }
  }

  listRuns(limit = 50): RunSummary[] {
    return this.listRunIds()
      .slice(0, limit)
      .map((id) => this.readRun(id))
      .filter((r): r is RunRecord => r !== undefined)
      .map(summarize);
  }

  latestRun(): RunRecord | undefined {
    for (const id of this.listRunIds()) {
      const record = this.readRun(id);
      if (record) return record;
    }
    return undefined;
  }

  readAppModel(): AppModel | undefined {
    const file = confinedFile(paths.dir(this.root), paths.appModel(this.root));
    if (!file) return undefined;
    try {
      return JSON.parse(readFileSync(file, 'utf8')) as AppModel;
    } catch {
      return undefined;
    }
  }

  readIntents(): Intent[] {
    const file = confinedFile(paths.dir(this.root), paths.intents(this.root));
    if (!file) return [];
    try {
      return (JSON.parse(readFileSync(file, 'utf8')) as { intents: Intent[] }).intents ?? [];
    } catch {
      return [];
    }
  }

  /** Progress for a run currently in flight, if one is. */
  readLive(): LiveProgress | undefined {
    const file = confinedFile(paths.dir(this.root), paths.live(this.root));
    if (!file) return undefined;
    try {
      return JSON.parse(readFileSync(file, 'utf8')) as LiveProgress;
    } catch {
      // Half-written file; the next poll will catch it.
      return undefined;
    }
  }

  readConfigRaw(): string | undefined {
    const file = confinedFile(paths.dir(this.root), paths.config(this.root));
    return file ? readFileSync(file, 'utf8') : undefined;
  }
}

export function summarize(record: RunRecord): RunSummary {
  const { run, findings } = record;
  return {
    id: record.id,
    status: run.status,
    exitCode: run.exitCode,
    mode: run.mode,
    commit: run.commit,
    startedAt: String(run.startedAt),
    endedAt: run.endedAt ? String(run.endedAt) : undefined,
    screensSelected: run.plan.coverage.screensSelected,
    screensTotal: run.plan.coverage.screensTotal,
    findings: {
      total: findings.length,
      blocking: findings.filter((f) => f.route === 'check').length,
      issues: findings.filter((f) => f.route === 'issue').length,
      questions: findings.filter((f) => f.route === 'question').length,
    },
    suppressed: run.suppressionCount,
    costUsd: run.cost.decisionUsd + run.cost.visionUsd + run.cost.frontierUsd,
  };
}

function safeMtime(path: string): number {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}
