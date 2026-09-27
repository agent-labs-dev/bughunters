import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { judgedRetests, type BughuntersConfig, type Candidate, type FixProposal, type Issue, type Retest, type RetestOutcome,
  type RetestShot, type RoutineStep } from '@bughunters/core';
import { createDriver as makeDriver, type Driver } from '@bughunters/drivers';
import { startApp } from '../lifecycle.js';
import { explorerRetestSystem, judgeRetestSystem } from '../prompts.js';
import { replayRoutine, replaySteps } from '../replay.js';
import { createRuntime as makeRuntime } from '../runtime/index.js';
import { AgentSession } from '../session.js';
import { explorerTools } from '../tools/explorer.js';
import type { Tool } from '../types.js';
import { Vars } from '../vars.js';
import { lessonsFor, Workspace } from '../workspace.js';
import { reflectOnSession } from './reflect.js';
import { stopOnCancellation } from './explorer.js';
import { overlayBughunters } from './overlay.js';
import { lessonTools } from '../tools/memory.js';
import { linkEnvFiles, runFixer, stepWords } from './fixer.js';
import { closeOnGitHub } from '../github.js';

const exec = promisify(execFile);
const schema = (properties: Record<string, unknown> = {}, required: string[] = []) =>
  ({ type: 'object', properties, required, additionalProperties: false });
const string = { type: 'string' };
const response = (value: string) => ({ content: [{ type: 'text' as const, text: value }] });
async function image(root: string, file?: string): Promise<{ type: 'image'; png: Buffer }[]> {
  if (!file) return [];
  try { return [{ type: 'image', png: await readFile(resolve(root, file)) }]; } catch { return []; }
}

type Deps = {
  createDriver?: typeof makeDriver;
  createRuntime?: typeof makeRuntime;
  onLog?: (message: string) => void;
  onSession?: (session?: AgentSession) => void;
  isInterrupted?: () => boolean;
  isMerged?: (fix: FixProposal) => Promise<boolean>;
};

type Target = { shot: RetestShot; steps: RoutineStep[] };

async function loadRetestTargets(workspace: Workspace, issue: Issue): Promise<Target[]> {
  const targets: Target[] = [];
  const add = (screenId: string | undefined, routineId: string | undefined,
    before: string | undefined, steps: RoutineStep[] = []) => {
    const existing = targets.find(({ shot }) =>
      shot.screenId && screenId ? shot.screenId === screenId
        : shot.routineId && routineId ? shot.routineId === routineId
          : shot.before && before ? shot.before === before : false);
    if (existing) {
      existing.shot.screenId ??= screenId;
      existing.shot.routineId ??= routineId;
      existing.shot.before ??= before;
      if (!existing.steps.length) existing.steps = steps;
      return;
    }
    if (targets.length >= 6) return;
    targets.push({ shot: { screenId, routineId, before }, steps });
  };
  if (issue.screenId || issue.evidence.routineId || issue.evidence.screenshot || issue.evidence.steps?.length)
    add(issue.screenId, issue.evidence.routineId, issue.evidence.screenshot, issue.evidence.steps);
  const ids = new Set(issue.candidateIds);
  if (ids.size && targets.length < 6) {
    const found = new Map<string, Candidate>();
    for (const session of await workspace.listSessions(Infinity)) {
      for (const candidate of await workspace.readCandidates(session.id)) {
        if (ids.has(candidate.id)) found.set(candidate.id, candidate);
      }
      if (found.size === ids.size) break;
    }
    for (const id of issue.candidateIds) {
      const candidate = found.get(id);
      if (!candidate) continue;
      add(candidate.screenId, candidate.evidence.routineId,
        candidate.evidence.screenshot, candidate.evidence.steps);
    }
  }
  return targets;
}

export async function retestTargets(workspace: Workspace, issue: Issue): Promise<RetestShot[]> {
  return (await loadRetestTargets(workspace, issue)).map((target) => target.shot);
}

/** The explorer repeats the flow; only the judge decides whether the fix worked. */
export async function retestFix(root: string, config: BughuntersConfig, issue: Issue,
  fix: FixProposal, attempt: number, deps: Deps, options: { build?: 'main' } = {}): Promise<Retest> {
  const workspace = new Workspace(root);
  const targets = await loadRetestTargets(workspace, issue);
  const retest: Retest = { attempt, outcome: 'unclear', reason: '', shots: targets.map((target) => target.shot),
    before: targets[0]?.shot.before, at: new Date().toISOString(), costUsd: 0, build: options.build };
  if (!config.agents.explorer.enabled || !config.agents.judge.enabled) {
    return { ...retest, outcome: 'skipped', reason: 'The explorer or judge is disabled.' };
  }
  if (!targets.some((target) => target.shot.routineId || target.steps.length)) {
    return { ...retest, outcome: 'skipped', reason: 'The issue has no replayable flow.' };
  }
  if (!options.build) {
    try {
      const head = (await exec('git', ['rev-parse', 'HEAD'], { cwd: fix.worktree })).stdout.trim();
      const dirty = (await exec('git', ['status', '--porcelain'], { cwd: fix.worktree })).stdout.trim();
      if (dirty || head !== fix.commit) throw new Error('Commit clean changes before retesting.');
      retest.commit = head;
      retest.configHash = createHash('sha256').update(JSON.stringify(config)).digest('hex');
    } catch (error) { return { ...retest, outcome: 'error', reason: String(error) }; }
  }
  const runtime = deps.createRuntime ?? makeRuntime;
  const vars = new Vars(config.app.secrets);
  let app: Awaited<ReturnType<typeof startApp>> | undefined;
  let driver: Driver | undefined;
  let restore = async () => {};
  try {
    // A worktree made before this rule existed has no .env links yet.
    if (!options.build) await linkEnvFiles(fix.repo, fix.worktree);
    if (!options.build) restore = await overlayBughunters(root, fix.repo, fix.worktree);
    if (!options.build && config.agents.fixer.retest.prepare) {
      await exec('/bin/sh', ['-c', config.agents.fixer.retest.prepare],
        { cwd: fix.worktree, timeout: 600_000, maxBuffer: 4 * 1024 * 1024 });
    }
    app = await startApp(config.app, { root, vars, emit: deps.onLog,
      source: options.build === 'main' ? undefined : fix.worktree });
    driver = (deps.createDriver ?? makeDriver)(config, vars.resolve.bind(vars));
    await driver.connect();
    const record = await workspace.startSession('explorer');
    retest.explorerSessionId = record.id;
    const session = new AgentSession(root, config, vars, record.id, 'explorer', driver, deps.onLog);
    deps.onSession?.(session);
    const explorerRuntime = runtime(config.agents.explorer.use);
    await session.activity(`Retesting ${issue.title}`, 0, explorerRuntime.label);
    session.emit({ kind: 'session-start', summary: `Retesting the fix for: ${issue.title}` });
    let steps = 0;
    let cost = 0;
    let explorerStop = 'done';
    try {
      const targetSchema = { target: { type: 'integer', minimum: 1, maximum: targets.length } };
      const selected = (input: Record<string, unknown>) =>
        Number.isInteger(input.target) ? targets[Number(input.target) - 1] : undefined;
      let finishTried = false;
      let finishSummary = '';
      const allowed = new Set(['look', 'tap', 'type', 'press', 'scroll', 'back', 'open', 'wait',
        'run_routine', 'switch_window', 'save_lesson']);
      const tools: Tool[] = explorerTools(session).filter((tool) => allowed.has(tool.name)).map((tool) =>
        tool.name !== 'run_routine' ? tool : { ...tool, async run(input) {
          const id = String(input.id ?? '');
          const result = await replayRoutine(session, id, { save: false, onFixBuild: !options.build });
          if (!result.ok) return { ...response(`Routine ${id} failed at step ${result.failedStep ?? 'dependency'}: ${result.error}`), isError: true };
          await driver!.settle();
          const observation = await driver!.observe();
          const screenshot = await session.capture(observation, `routine-${id}`);
          return { content: [{ type: 'image' as const, png: observation.screenshot },
            { type: 'text' as const, text: session.vars.redact(`Replayed ${id}. Elements: ${observation.elements.map((item) => `[${item.ref}] ${item.role} ${item.name}`).join('; ')}`) as string }],
          meta: { screenshot, summary: `Replayed the routine ${id}` } };
        } });
      tools.push({
        name: 'replay_issue_steps', description: 'Replay the target steps after the routine.',
        inputSchema: schema(targetSchema, ['target']),
        async run(input) {
          const target = selected(input);
          if (!target) return { ...response('Choose a valid target number.'), isError: true };
          const result = await replaySteps(session, target.steps);
          if (!result.ok) return { ...response(`Issue steps failed at ${result.failedStep}: ${result.error}`), isError: true };
          await driver!.settle();
          const observation = await driver!.observe();
          const screenshot = await session.capture(observation, `retest-steps-${input.target}`);
          return { content: [{ type: 'image', png: observation.screenshot },
            { type: 'text', text: session.vars.redact(`Replayed issue steps. Elements: ${observation.elements.map((item) => `[${item.ref}] ${item.role} ${item.name}`).join('; ')}`) as string }],
          meta: { screenshot, summary: `Replayed steps for screen ${input.target}` } };
        },
      }, {
        name: 'view_before', description: 'View the target screenshot before the fix.',
        inputSchema: schema(targetSchema, ['target']),
        async run(input) {
          const target = selected(input);
          if (!target) return { ...response('Choose a valid target number.'), isError: true };
          const content: Awaited<ReturnType<Tool['run']>>['content'] = [
            { type: 'text', text: `Screen ${input.target}: ${target.shot.screenId ?? '(unknown)'}` }];
          content.push(...await image(root, target.shot.before));
          return { content };
        },
      }, {
        name: 'capture_after', description: 'Capture the screen after replaying the flow.',
        inputSchema: schema({ ...targetSchema, note: string, reached: { type: 'boolean' } }, ['target', 'note', 'reached']),
        async run(input) {
          const target = selected(input);
          if (!target) return { ...response('Choose a valid target number.'), isError: true };
          await driver!.settle();
          const observation = await driver!.observe();
          target.shot.after = await session.capture(observation, `retest-after-${input.target}`);
          target.shot.note = String(input.note ?? '');
          target.shot.reached = input.reached === true;
          return { ...response(`Captured after screenshot for screen ${input.target}: ${target.shot.after}`),
            meta: { screenshot: target.shot.after, summary: `Retest capture: ${target.shot.note}` } };
        },
      }, {
        name: 'finish_retest', description: 'Finish after capturing every target.',
        inputSchema: schema({ summary: string }, ['summary']),
        async run(input) {
          const missing = targets.flatMap((target, index) => target.shot.after ? [] : [index + 1]);
          if (missing.length && !finishTried) {
            finishTried = true;
            return { ...response(`Missing captures for target numbers: ${missing.join(', ')}. Capture them, then finish again.`),
              isError: true };
          }
          finishSummary = String(input.summary ?? '');
          return { ...response(finishSummary), done: true };
        },
      });
      const guide = config.app.instructions;
      const instructions = guide ? await readFile(resolve(root, guide), 'utf8') : '';
      const result = await explorerRuntime.run({
        role: 'explorer', sessionId: record.id, signal: session.signal,
        system: explorerRetestSystem(config.app.platform, instructions,
          lessonsFor(await workspace.readMemory(), 'explorer')).replace('a build with a proposed fix',
          options.build === 'main' ? 'the main build after a merged fix' : 'a build with a proposed fix'),
        prompt: `Issue: ${issue.title}\nSeverity: ${issue.severity}\n${issue.body}\nTargets:\n${targets.map((target, index) =>
          `${index + 1}. screen ${target.shot.screenId ?? '(unknown)'} — routine ${target.shot.routineId ?? '(none)'} — steps: ${target.steps.map(stepWords).join('; ') || '(none)'}`).join('\n')}`,
        tools: tools.map((tool) => stopOnCancellation(session, tool)),
        maxSteps: Math.max(config.agents.fixer.retest.maxSteps, 12 * targets.length),
        budgetUsd: config.agents.fixer.retest.budgetUsd,
        timeoutMs: config.agents.explorer.timeoutMs,
      }, session.emit);
      steps = result.steps;
      cost = result.costUsd;
      explorerStop = result.stop;
      if (!finishSummary && !targets.some((target) => target.shot.after))
        targets[0]!.shot.note = `The explorer stopped without capture_after (${result.stop}).`;
    } finally {
      if (!targets.some((target) => target.shot.after) && targets[0]) {
        targets[0].shot.note ??= 'The explorer stopped without capture_after.';
        targets[0].shot.reached = false;
        try { targets[0].shot.after = await session.capture(await driver.observe(), 'retest-after-1'); }
        catch { /* no screen */ }
      }
      for (const target of targets) if (!target.shot.after) {
        target.shot.reached = false;
        target.shot.note = 'The explorer did not reach this screen.';
      }
      retest.after = targets[0]?.shot.after;
      retest.note = targets[0]?.shot.note;
      retest.costUsd = (retest.costUsd ?? 0) + cost;
      await workspace.endSession(record.id, { summary: `Retest capture: ${retest.note ?? 'No capture'}`
        + (explorerStop === 'done' ? '' : `; stopped: ${explorerStop}`),
        steps, costUsd: cost });
      session.emit({ kind: 'session-end', summary: `Retest capture: ${retest.note ?? 'No capture'}` });
      await session.idle(cost);
      await reflectOnSession(root, config, record.id, { vars, createRuntime: deps.createRuntime,
        onLog: deps.onLog });
      deps.onSession?.();
    }
  } catch (error) {
    retest.outcome = 'error';
    retest.reason = `Retest preparation or exploration failed: ${String(error)}`;
    // Teardown runs after the error and logs its own; this keeps the cause in the log too.
    deps.onLog?.(retest.reason);
    return retest;
  } finally {
    try { await driver?.close(); } finally {
      try { await app?.stop(); } finally { await restore(); }
    }
  }
  if (!targets.some((target) => target.shot.after)) {
    retest.outcome = 'unclear';
    retest.reason = retest.note ?? 'The explorer did not reach the issue screen.';
    return retest;
  }
  const record = await workspace.startSession('judge');
  retest.judgeSessionId = record.id;
  const session = new AgentSession(root, config, vars, record.id, 'judge', undefined, deps.onLog);
  deps.onSession?.(session);
  let judged: { outcome: RetestOutcome; reason: string } | undefined;
  let cost = 0;
  let steps = 0;
  let stop = 'error';
  try {
    const judgeRuntime = runtime(config.agents.judge.use);
    await session.activity(`Judging retest for ${issue.title}`, 0, judgeRuntime.label);
    session.emit({ kind: 'session-start', summary: `Judging the retest for: ${issue.title}` });
    const tools: Tool[] = [{
      name: 'view_retest', description: 'View issue details and before and after screenshots.', inputSchema: schema(),
      async run() {
        const content: Awaited<ReturnType<Tool['run']>>['content'] = [
          { type: 'text', text: `Issue: ${issue.title}\nFixer: ${fix.summary ?? ''}` },
        ];
        for (const [index, target] of targets.entries()) {
          const shot = target.shot;
          content.push({ type: 'text', text: `Screen ${index + 1}: ${shot.screenId ?? '(unknown)'} — reached: ${shot.reached === true} — explorer: ${shot.note ?? ''}` });
          content.push(...await image(root, shot.before), ...await image(root, shot.after));
        }
        return { content };
      },
    }, {
      name: 'verdict', description: 'Decide if the issue was fixed.',
      inputSchema: schema({ outcome: { type: 'string', enum: ['fixed', 'not-fixed', 'unclear'] }, reason: string }, ['outcome', 'reason']),
      async run(input) {
        judged = { outcome: input.outcome as RetestOutcome, reason: String(input.reason ?? '') };
        return { ...response(`Retest verdict: ${judged.outcome} — ${judged.reason}`), done: true };
      },
    }, ...lessonTools(session, 'judge')];
    const result = await judgeRuntime.run({ role: 'judge', sessionId: record.id, signal: session.signal,
      system: judgeRetestSystem(lessonsFor(await workspace.readMemory(), 'judge')),
      prompt: `Issue: ${issue.title}\n${issue.body}\nFixer summary: ${fix.summary ?? ''}\nScreens:\n${targets.map((target, index) =>
        `${index + 1}. ${target.shot.screenId ?? '(unknown)'} — reached: ${target.shot.reached === true} — explorer: ${target.shot.note ?? ''}`).join('\n')}`,
      tools, maxSteps: 6, budgetUsd: config.agents.judge.budgetUsd,
      timeoutMs: config.agents.judge.timeoutMs }, session.emit);
    cost = result.costUsd;
    steps = result.steps;
    stop = result.stop;
    retest.outcome = judged?.outcome ?? 'unclear';
    retest.reason = judged?.reason ?? `The judge gave no verdict (${stop})`;
  } catch (error) {
    retest.outcome = 'error';
    retest.reason = `Judge retest failed: ${String(error)}`;
  } finally {
    retest.costUsd = (retest.costUsd ?? 0) + cost;
    await workspace.endSession(record.id, { summary: `Retest verdict: ${retest.outcome} — ${retest.reason}`,
      steps, costUsd: cost, status: retest.outcome === 'error' ? 'failed' : 'finished' });
    session.emit({ kind: 'session-end', summary: `Retest verdict: ${retest.outcome} — ${retest.reason}` });
    await session.idle(cost);
    deps.onSession?.();
  }
  if (!options.build && retest.outcome === 'fixed') {
    const head = (await exec('git', ['rev-parse', 'HEAD'], { cwd: fix.worktree })).stdout.trim();
    const dirty = (await exec('git', ['status', '--porcelain'], { cwd: fix.worktree })).stdout.trim();
    if (dirty || head !== retest.commit) { retest.outcome = 'error'; retest.reason = 'The source changed during verification. Commit and retest.'; }
  }
  return retest;
}

/** A fix that waits for a retest: none yet, or the last one stopped on an error. */
function needsRetest(fix: FixProposal): boolean {
  const last = fix.retests?.at(-1);
  return !last || last.outcome === 'error';
}

/**
 * Records a retest on its fix and sets the fix status. Only a verdict counts
 * as an attempt: a retest that stopped on an error keeps the fix in
 * 'retesting', so the next cycle tries again.
 */
export function applyRetest(config: BughuntersConfig, fix: FixProposal, result: Retest): void {
  fix.retests = [...(fix.retests ?? []), result];
  const attemptsLeft = judgedRetests(fix.retests).length < config.agents.fixer.retest.attempts;
  if (result.outcome === 'fixed') fix.status = result.commit && result.commit === fix.commit ? 'verified' : 'proposed';
  else if (result.outcome === 'error') fix.status = 'retesting';
  else if (result.outcome === 'not-fixed' && attemptsLeft) fix.status = 'retesting';
  else fix.status = 'proposed';
}

async function defaultBranch(repo: string): Promise<string> {
  try {
    const { stdout } = await exec('git', ['-C', repo, 'symbolic-ref', 'refs/remotes/origin/HEAD']);
    return stdout.trim().split('/').at(-1) || 'main';
  } catch { return 'main'; }
}

async function merged(fix: FixProposal, branch: string): Promise<boolean> {
  if (fix.pr) {
    try {
      const { stdout } = await exec('gh', ['pr', 'view', fix.pr.url, '--json', 'state', '-q', '.state'],
        { cwd: fix.repo });
      return stdout.trim() === 'MERGED';
    } catch { /* gh is unavailable; check git below. */ }
  }
  // The branch head is no proof: a branch with no commit of its own sits on
  // its base, which is always on the default branch. Only the fix commit is.
  // A squash merge leaves no ancestor either; the PR state above covers it.
  if (!fix.commit) return false;
  try {
    await exec('git', ['-C', fix.repo, 'fetch', '-q', 'origin']);
    await exec('git', ['-C', fix.repo, 'merge-base', '--is-ancestor', fix.commit, `origin/${branch}`]);
    return true;
  } catch { return false; }
}

/** Recheck merged fixes against the main checkout; return issue ids for later GitHub sync. */
export async function recheckMerged(root: string, config: BughuntersConfig, deps: Deps = {}): Promise<{ closed: string[] }> {
  const workspace = new Workspace(root);
  const closed: string[] = [];
  if (!config.agents.explorer.enabled || !config.agents.judge.enabled) return { closed };
  for (const fix of await workspace.listFixes()) {
    if (deps.isInterrupted?.()) break;
    if (!fix.pr && !fix.branch) continue;
    if (fix.retests?.some((item) => item.build === 'main' && ['fixed', 'not-fixed'].includes(item.outcome))) continue;
    const issue = await workspace.readIssue(fix.issueId);
    if (!issue || !['new', 'filed', 'fixing', 'fix-proposed'].includes(issue.status)) continue;
    const branch = await defaultBranch(fix.repo);
    if (!(fix.pr?.state ? fix.pr.state === 'merged' : await (deps.isMerged?.(fix) ?? merged(fix, branch)))) continue;
    const result = await retestFix(root, config, issue, fix, (fix.retests?.length ?? 0) + 1, deps, { build: 'main' });
    fix.retests = [...(fix.retests ?? []), result];
    await workspace.saveFix(fix);
    if (result.outcome === 'fixed') {
      const at = new Date().toISOString();
      const fixedIssue: Issue = { ...issue, status: 'fixed',
        closedBy: { by: 'Bughunters', reason: `The fix merged, and a recheck on ${branch} did not find the problem.`, at } };
      await workspace.saveIssue(fixedIssue);
      await closeOnGitHub(root, config, fixedIssue, undefined, deps.onLog);
      closed.push(issue.id);
    }
    if (result.outcome === 'fixed' || result.outcome === 'not-fixed') {
      const record = await workspace.startSession('judge');
      await workspace.appendEvent(record.id, { sessionId: record.id, role: 'system', kind: 'issue',
        summary: result.outcome === 'fixed' ? `Fixed: ${issue.title}` : `The merged fix did not remove: ${issue.title}` });
      await workspace.endSession(record.id, { summary: `Merged fix recheck: ${result.outcome}` });
    }
  }
  return { closed };
}

/** Run fix attempts and app retests until each issue has a verdict or exhausts its budget. */
export async function runFixCycle(root: string, config: BughuntersConfig, deps: Deps & { issueIds?: string[] } = {}): Promise<FixProposal[]> {
  const workspace = new Workspace(root);
  const changed = new Map<string, FixProposal>();
  // The first pass takes new issues; later passes only refix what the judge
  // sent back, so a retry loop never grows into a queue of new fixes.
  let issueIds = deps.issueIds;
  for (;;) {
    if (deps.isInterrupted?.()) break;
    let proposals: FixProposal[] = [];
    if (config.agents.fixer.enabled) {
      const record = await workspace.startSession('fixer');
      const session = new AgentSession(root, config, new Vars(config.app.secrets), record.id, 'fixer', undefined, deps.onLog);
      deps.onSession?.(session);
      try { proposals = await runFixer(session, (deps.createRuntime ?? makeRuntime)(config.agents.fixer.use), { issueIds }); }
      finally { deps.onSession?.(); }
    }
    const pending = (await workspace.listFixes()).filter((fix) => fix.status === 'retesting'
      && (!deps.issueIds || deps.issueIds.includes(fix.issueId))
      && (proposals.some((item) => item.id === fix.id) || needsRetest(fix)));
    const retryIds: string[] = [];
    for (const fix of pending) {
      if (deps.isInterrupted?.()) break;
      const issue = await workspace.readIssue(fix.issueId);
      if (!issue) continue;
      const result = await retestFix(root, config, issue, fix, (fix.retests?.length ?? 0) + 1, deps);
      applyRetest(config, fix, result);
      if (fix.status === 'retesting' && result.outcome === 'not-fixed') retryIds.push(fix.issueId);
      await workspace.saveFix(fix);
      changed.set(fix.id, fix);
    }
    for (const proposal of proposals) {
      const current = await workspace.readFix(proposal.id) ?? proposal;
      changed.set(current.id, current);
    }
    if (!retryIds.length || deps.isInterrupted?.()) break;
    issueIds = retryIds;
  }
  return [...changed.values()];
}
