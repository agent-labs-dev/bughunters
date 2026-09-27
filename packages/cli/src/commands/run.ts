import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BughuntersError,
  id,
  BaselineStore,
  ExitCode,
  InfrastructureError,
  requireRun,
  baselineKeyFor,
  paths,
  shortHash,
  type AppModel,
  type BughuntersConfig,
  type ExitCodeValue,
  type LiveProgress,
  type RunMode,
  type ViewportConfig,
} from '@bughunters/core';
import { captureScreen, openSession, watchConsole } from '@bughunters/capture';
import { startApp } from '@bughunters/capture';
import { diff } from '@bughunters/diff';
import type { ScreenSnapshot } from '@bughunters/invariants';
import { executeRun, type CapturedScreen, type RunResult } from './run-pipeline.js';

export { executeRun } from './run-pipeline.js';
export type { CapturedScreen, RunResult } from './run-pipeline.js';

export type ScreenTarget = { id: string; url: string };

export type RunCommandOptions = {
  root: string;
  config: BughuntersConfig;
  mode: RunMode;
  commit: string;
  noModels: boolean;
  /** Explicit `--screens /a,/b` selection. */
  only?: string[];
  onProgress?: (message: string) => void;
  /** Explicit approval operation; verification never changes the manifest. */
  updateBaselines?: boolean;
};

/**
 * The full `bughunters run`: bring the app up, capture every selected screen at
 * every viewport, compare against the baseline, then hand the results to the
 * pipeline.
 *
 * Bring-up and capture failures surface as InfrastructureError and exit 4.
 * They are never reported as regressions -- "Bughunters could not test" is a
 * different statement from "Bughunters found a bug" (spec 5.1).
 */
export async function runCommand(options: RunCommandOptions): Promise<RunResult> {
  const { config, root } = options;
  const log = options.onProgress ?? (() => {});
  const notes: string[] = [];

  const model = loadAppModel(root);
  const targets = resolveTargets(config, model, options);
  const totalScreens = model?.screens.length ?? targets.length;

  const imageDigest = config.determinism.image || 'unpinned';
  if (imageDigest === 'unpinned') {
    notes.push(
      'determinism.image is not pinned by digest, so these baselines are only valid on this machine. See docs/determinism-contract.md.',
    );
  }

  const store = BaselineStore.load(root, imageDigest);
  if (!options.updateBaselines && store.isStaleFor(imageDigest)) {
    throw new InfrastructureError('The runner image differs from the approved baselines. Review and run bughunters baseline update explicitly.');
  }
  if (options.updateBaselines && store.isStaleFor(imageDigest)) {
    // Comparing across images is what produces a diff storm nobody can explain.
    const previousDigest = store.imageDigest;
    const dropped = store.invalidateAll(imageDigest);
    notes.push(
      `The runner image changed (${previousDigest} -> ${imageDigest}), so ${dropped} baseline(s) were invalidated and re-captured rather than compared across images.`,
    );
  }
  const isFirstRun = options.updateBaselines === true;
  if (!targets.length) throw new InfrastructureError('No active screens were selected; nothing can be verified.');
  if (!options.updateBaselines) for (const viewport of config.viewports) for (const target of targets) {
    store.verify(baselineKeyFor(target.id, viewport.name));
    store.verifySnapshot(baselineKeyFor(target.id, viewport.name));
  }

  log(`Starting the app: ${requireRun(config).command}`);
  const server = await startApp(config, { cwd: root });
  if (server.external) log(`Using the app already serving at ${requireRun(config).url}`);

  const captured: CapturedScreen[] = [];
  const runId = id.run(`run_${randomUUID()}`);
  const runDir = paths.run(root, runId);
  mkdirSync(runDir, { recursive: true });

  // Progress is published per screen so the dashboard can show the app being
  // walked rather than a blank page until the run finishes.
  const live = new LiveProgressWriter(root, targets.length * config.viewports.length);
  live.start();

  try {
    for (const viewport of config.viewports) {
      live.step(`Opening a browser at ${viewport.name}`);
      const session = await openSession(config, viewport);
      watchConsole(session.page);
      try {
        for (const target of targets) {
          log(`Capturing ${target.id} at ${viewport.name}`);
          live.step(`Capturing ${target.id} at ${viewport.name}`);
          const screen = await captureOne({ target, viewport, session, config, store, runDir, root, updateBaselines: options.updateBaselines });
          captured.push(screen);
          live.captured(screen);
        }
      } finally {
        await session.close();
      }
    }
  } catch (error) {
    live.failed(error);
    throw error;
  } finally {
    // Always return the machine to the state we found it in, even on failure.
    // A dev server left holding the port makes the next run fail for an
    // unrelated reason, which is the worst kind of flake to debug.
    if (!server.external) await server.stop();
  }

  if (options.updateBaselines) store.save();
  live.step('Evaluating findings');

  const result = await executeRun({
    root,
    runId,
    config,
    mode: options.mode,
    trigger: 'manual',
    commit: options.commit,
    noModels: options.noModels,
    isFirstRun,
    screens: captured,
    totalScreens,
    notes,
  });

  live.finished(result.run.id);
  return result;
}

/**
 * Writes `.bughunters/runs/gate/live.json` as the run proceeds.
 *
 * Every write is best-effort: a dashboard that cannot be updated must never be
 * the reason a run fails. The file is rewritten whole rather than appended, so
 * a reader always sees a complete JSON document or the previous one.
 */
class LiveProgressWriter {
  private readonly state: LiveProgress;

  constructor(private readonly root: string, plannedCaptures: number) {
    this.state = {
      version: 1,
      runId: `pending_${Date.now().toString(36)}`,
      status: 'running',
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      plannedCaptures,
      captured: [],
    };
  }

  start(): void {
    this.flush();
  }

  step(message: string): void {
    this.state.currentStep = message;
    this.flush();
  }

  captured(screen: CapturedScreen): void {
    this.state.captured.push({
      screenId: screen.screenId,
      viewport: screen.viewport,
      url: screen.url,
      title: screen.snapshot.title,
      actual: screen.artifacts.actual,
      baselineCreated: screen.baselineCreated,
      changedPixels: screen.comparison?.primary.changedPixels,
      links: (screen.snapshot.links ?? []).map((l) => ({ href: l.href, text: l.text, external: l.external, download: l.download, type: l.type })),
    });
    this.flush();
  }

  finished(runId: string): void {
    this.state.status = 'finished';
    this.state.finishedRunId = runId;
    this.state.currentStep = undefined;
    this.flush();
  }

  failed(error: unknown): void {
    this.state.status = 'failed';
    this.state.error = error instanceof Error ? error.message.split('\n')[0] : String(error);
    this.flush();
  }

  private flush(): void {
    this.state.updatedAt = new Date().toISOString();
    try {
      mkdirSync(paths.runs(this.root), { recursive: true });
      writeFileSync(paths.live(this.root), `${JSON.stringify(this.state, null, 2)}\n`);
    } catch {
      // Progress reporting is not worth failing a run over.
    }
  }
}

async function captureOne(args: {
  target: ScreenTarget;
  viewport: ViewportConfig;
  session: Awaited<ReturnType<typeof openSession>>;
  config: BughuntersConfig;
  store: BaselineStore;
  runDir: string;
  root: string;
  updateBaselines?: boolean;
}): Promise<CapturedScreen> {
  const { target, viewport, session, config, store, runDir } = args;
  const slug = `${slugify(target.id)}--${slugify(viewport.name)}-${shortHash(baselineKeyFor(target.id, viewport.name))}`;
  const actualPath = join(runDir, `${slug}.actual.png`);

  const output = await captureScreen(session.page, config, {
    screenId: target.id,
    url: target.url,
    viewport,
    outPath: actualPath,
  });

  const key = baselineKeyFor(target.id, viewport.name);
  const baselinePath = args.updateBaselines ? undefined : store.verify(key);

  // First sight of this screen: record the baseline and say so. Nothing can
  // regress against a baseline it just created, and reporting otherwise would
  // be the first-run avalanche.
  if (args.updateBaselines) {
    store.put(key, viewport.name, readFileSync(actualPath), output.snapshot);
    return {
      screenId: target.id,
      url: target.url,
      viewport: viewport.name,
      snapshot: output.snapshot,
      baselineCreated: true,
      artifacts: { actual: actualPath },
      planReason: 'always-on',
      stability: output.stability,
      maskedSelectors: [...new Set(output.masks.map((m) => m.selector))],
      missingFonts: output.missingFonts,
    };
  }

  const diffPath = join(runDir, `${slug}.diff.png`);
  const comparison = await diff({
    baselinePath: baselinePath!,
    actualPath,
    diffOutPath: diffPath,
    masks: output.masks,
    // Tier 1 is exact. Per-region tolerance is applied by the tolerance policy
    // downstream, never by loosening the comparison itself.
    threshold: 0,
    antialiasing: false,
  });

  return {
    screenId: target.id,
    url: target.url,
    viewport: viewport.name,
    snapshot: output.snapshot,
    baselineSnapshot: store.verifySnapshot(key) as ScreenSnapshot,
    comparison,
    baselineCreated: false,
    artifacts: {
      actual: actualPath,
      baseline: baselinePath,
      diff: comparison.primary.identical ? undefined : diffPath,
    },
    planReason: 'always-on',
    stability: output.stability,
    maskedSelectors: [...new Set(output.masks.map((m) => m.selector))],
    missingFonts: output.missingFonts,
  };
}

/**
 * Screen selection, in order of authority: an explicit `--screens` flag, then
 * the approved AppModel, then the single configured entry URL.
 *
 * That last fallback is what makes `run` useful before Recon exists -- it is
 * the M0 walking skeleton, and it is honest about covering one screen rather
 * than implying it swept the app.
 */
export function resolveTargets(
  config: BughuntersConfig,
  model: AppModel | undefined,
  options: { only?: string[]; mode: RunMode },
): ScreenTarget[] {
  const base = new URL(requireRun(config).url);

  if (options.only && options.only.length > 0) {
    return options.only.map((path) => ({ id: path, url: new URL(path, base).toString() }));
  }

  if (model && model.screens.length > 0) {
    const screens = model.screens.filter((s) => s.state === 'active');
    const selected = options.mode === 'smoke' ? screens.slice(0, 10) : screens;
    return selected.map((s) => ({ id: s.urlPattern, url: new URL(s.urlPattern, base).toString() }));
  }

  return [{ id: base.pathname, url: base.toString() }];
}

function loadAppModel(root: string): AppModel | undefined {
  const file = paths.appModel(root);
  if (!existsSync(file)) return undefined;
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as AppModel;
  } catch (cause) {
    throw new BughuntersError(`${file} is not valid JSON`, ExitCode.Usage, { cause });
  }
}

export function slugify(value: string): string {
  return value.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '') || 'root';
}

export function exitCodeForError(error: unknown): ExitCodeValue {
  if (error instanceof InfrastructureError) return ExitCode.Infrastructure;
  if (error instanceof BughuntersError) return error.exitCode;
  return ExitCode.Infrastructure;
}
