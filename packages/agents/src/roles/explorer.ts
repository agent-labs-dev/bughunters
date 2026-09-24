import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Runtime, RoleOutcome, Tool } from '../types.js';
import type { AgentSession } from '../session.js';
import { explorerTools } from '../tools/explorer.js';
import { explorerPrompt, explorerSystem } from '../prompts.js';

const STOP_REASONS: Record<RoleOutcome['stop'], string> = {
  done: 'finished',
  'max-steps': 'used all its steps',
  budget: 'reached its budget',
  timeout: 'reached its time limit',
  error: 'stopped on an error',
};

/**
 * The finish tool's text when the explorer wrote one. Otherwise a sentence
 * AutoQA writes itself: the model's last thought at a step limit is a note to
 * itself ("I'll open Settings next"), not a summary of the session.
 */
function sessionSummary(outcome: RoleOutcome, screens: number, candidates: number): string {
  if (outcome.stop === 'done' && outcome.summary) return outcome.summary;
  return `The explorer ${STOP_REASONS[outcome.stop]} after ${outcome.steps} steps. `
    + `It knows ${screens} screen(s) and raised ${candidates} candidate(s).`;
}

function stopOnCancellation(session: AgentSession, tool: Tool): Tool {
  return {
    ...tool,
    async run(input) {
      const result = await tool.run(input);
      return session.cancelled ? { ...result, done: true } : result;
    },
  };
}

/** Runs the app-facing role with its shared QA instructions and current map. */
export async function runExplorer(
  session: AgentSession,
  runtime: Runtime,
  opts: { goal?: string; maxSteps?: number } = {},
): Promise<RoleOutcome> {
  const config = session.config.agents.explorer;
  const map = await session.workspace.readAppMap();
  const routines = await session.workspace.listRoutines();
  const guide = session.config.app.instructions;
  const instructions = guide ? await readFile(resolve(session.root, guide), 'utf8') : '';
  const task = {
    role: 'explorer' as const,
    sessionId: session.sessionId,
    system: explorerSystem(session.config.app.platform, instructions),
    prompt: explorerPrompt({
      goal: opts.goal,
      screens: map?.screens ?? [],
      routines,
      placeholders: session.vars.names(),
      maxSteps: opts.maxSteps ?? config.maxSteps,
    }),
    tools: explorerTools(session).map((tool) => stopOnCancellation(session, tool)),
    maxSteps: opts.maxSteps ?? config.maxSteps,
    budgetUsd: config.budgetUsd,
    timeoutMs: config.timeoutMs,
  };
  await session.activity('Exploring the app', 0, runtime.label);
  session.emit({ kind: 'session-start', summary: 'Explorer started' });
  try {
    const outcome = await runtime.run(task, session.emit);
    const candidates = await session.workspace.readCandidates(session.sessionId);
    const screens = (await session.workspace.readAppMap())?.screens ?? [];
    outcome.summary = sessionSummary(outcome, screens.length, candidates.length);
    await session.workspace.endSession(session.sessionId, {
      status: outcome.stop === 'error' ? 'failed' : 'finished',
      steps: outcome.steps,
      costUsd: outcome.costUsd + session.decisionSpentUsd,
      summary: outcome.summary,
      candidates: candidates.length,
      screensFound: screens.map((item) => item.id),
    });
    session.emit({ kind: 'session-end', summary: outcome.summary ?? `Explorer stopped: ${outcome.stop}` });
    await session.idle(outcome.costUsd + session.decisionSpentUsd);
    return outcome;
  } catch (error) {
    await session.workspace.endSession(session.sessionId, { status: 'failed', summary: String(error) });
    await session.idle();
    throw error;
  }
}
