import { randomUUID } from 'node:crypto';
import { fingerprint, shortHash, type Candidate, type Locator, type Routine, type RoutineStep } from '@autoqa/core';
import type { DriverAction, Observation, UiElement } from '@autoqa/drivers';
import { evaluateScreen } from '../evaluate.js';
import { replayRoutine } from '../replay.js';
import type { AgentSession } from '../session.js';
import type { Tool, ToolResult } from '../types.js';

const text = (value: string): ToolResult => ({ content: [{ type: 'text', text: value }] });
const schema = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object', properties, required, additionalProperties: false,
});
const string = { type: 'string' };
const boolean = { type: 'boolean' };
const arg = (input: Record<string, unknown>, key: string) => String(input[key] ?? '');
const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'screen';

function elementLine(element: UiElement): string {
  const box = element.box;
  const flags = [element.value !== undefined ? `value=${JSON.stringify(element.value)}` : '',
    element.focused ? 'focused' : '', element.enabled ? '' : 'disabled'].filter(Boolean).join(' ');
  return `[${element.ref}] ${element.role} ${JSON.stringify(element.name)}` +
    ` (${box.x},${box.y} ${box.width}x${box.height})${flags ? ` ${flags}` : ''}`;
}

function observationText(observation: Observation): string {
  const windows = observation.windows?.map((window) =>
    `${window.active ? '*' : ' '} ${window.title} (${window.location})`).join('; ') ?? '(none)';
  return [`Location: ${observation.location}`, `Windows: ${windows}`, 'Elements:',
    ...observation.elements.slice(0, 117).map(elementLine)].slice(0, 120).join('\n');
}

async function observe(session: AgentSession, label: string, summary?: string): Promise<ToolResult> {
  const observation = await session.driver!.observe();
  const screenshot = await session.capture(observation, label);
  return {
    content: [
      { type: 'image', png: observation.screenshot },
      { type: 'text', text: session.vars.redact(observationText(observation)) as string },
    ],
    meta: { summary: summary ?? `Looked at ${observation.title || observation.location}`, screenshot },
  };
}

/** Where the app is: the location and the window, since one URL can host two windows. */
function screenKey(observation: Observation): string {
  const active = observation.windows?.find((window) => window.active);
  return `${observation.location}|${active?.title ?? ''}`;
}

/**
 * The last recorded screen, but only if the app is still on it. After a
 * window switch or a navigation with no record_screen, a report names no
 * screen rather than the wrong one.
 */
function currentScreenId(session: AgentSession): string | undefined {
  const observation = session.lastObservation;
  if (!observation || !session.lastScreenLocation) return session.lastScreenId;
  return screenKey(observation) === session.lastScreenLocation ? session.lastScreenId : undefined;
}

/** One sentence for the activity feed, named by what a person would see. */
function describe(session: AgentSession, action: DriverAction): string {
  const named = (ref?: string) => {
    const element = ref ? session.lastObservation?.elements.find((item) => item.ref === ref) : undefined;
    return element ? `"${element.name}"` : 'the screen';
  };
  switch (action.kind) {
    case 'tap':
      return `Tapped ${named(action.ref)}`;
    case 'type':
      return `Typed into ${named(action.ref)}`;
    case 'press':
      return `Pressed ${action.key}`;
    case 'scroll':
      return `Scrolled ${action.direction}`;
    case 'back':
      return 'Went back';
    case 'open':
      return 'Opened a link';
    case 'wait':
      return `Waited ${Math.round(action.ms / 1000)}s`;
    case 'window':
      return `Switched to the "${action.match}" window`;
  }
}

async function act(session: AgentSession, action: DriverAction, recorded?: RoutineStep): Promise<ToolResult> {
  const summary = describe(session, action);
  const result = await session.driver!.act(action);
  if (!result.ok) return failed(session, result.error ?? 'Action failed', summary);
  if (recorded ?? result.step) session.trail.push((recorded ?? result.step)!);
  await session.driver!.settle();
  return observe(session, action.kind, summary);
}

/**
 * A failed action returns the screen as it is now, not only the error. The
 * usual cause is a ref from an older list, and without the new list the
 * model spends its next step on `look`.
 */
async function failed(session: AgentSession, error: string, summary: string): Promise<ToolResult> {
  const current = await observe(session, 'failed', `${summary}: failed`);
  const hint = /unknown element ref/i.test(error)
    ? ' The screen changed since that list. Use a ref from the list below.'
    : '';
  return {
    content: [{ type: 'text', text: `Error: ${error}.${hint}` }, ...current.content],
    isError: true,
    meta: current.meta,
  };
}

async function saveRoutine(session: AgentSession, id: string, description: string,
  screenId?: string): Promise<Routine> {
  const prior = await session.workspace.readRoutine(id);
  const now = new Date().toISOString();
  const steps = compactSteps(session.trail.slice(session.anchor.index));
  const routine: Routine = {
    version: 1,
    id,
    description,
    platform: session.config.app.platform,
    requires: session.anchor.routineId && session.anchor.routineId !== id ? [session.anchor.routineId] : [],
    steps, screenId,
    expect: endState(session),
    createdAt: prior?.createdAt ?? now,
    updatedAt: now,
  };
  await session.workspace.saveRoutine(routine);
  session.anchor = { routineId: id, index: session.trail.length };
  return routine;
}

/**
 * Up to six names that identify where the routine ended. Test ids first, as
 * the most stable; names with digits are left out, because times, counts and
 * dates change between runs, and so are loading placeholders.
 */
function endState(session: AgentSession): Routine['expect'] {
  const elements = session.lastObservation?.elements ?? [];
  // A loading state is on the way to the end, not the end itself.
  const transient = (name: string) => /skeleton|spinner|loading|opening|please wait/i.test(name);
  const stable = (name: string) => name.length > 1 && name.length <= 60 && !/\d/.test(name) && !transient(name);
  const byTestId = elements.filter((item) => item.testId && !transient(item.testId)).map((item) => item.testId!);
  const byName = elements.filter((item) => item.interactive && stable(item.name)).map((item) => item.name);
  const names = [...new Set([...byTestId, ...byName])].slice(0, 6);
  return names.length ? { elements: names } : undefined;
}

function compactSteps(steps: RoutineStep[]): RoutineStep[] {
  const compacted: RoutineStep[] = [];
  for (const step of steps) {
    if (step.kind === 'wait') continue;
    const previous = compacted.at(-1);
    if (previous && sameStep(previous, step)) continue;
    compacted.push(step);
  }
  return compacted;
}

function sameStep(left: RoutineStep, right: RoutineStep): boolean {
  return stepSignature(left) === stepSignature(right);
}

function locatorSignature(locator?: Locator): string {
  if (!locator) return '';
  if (locator.testId) return `id:${locator.testId}`;
  if (locator.role && locator.name) return `role:${locator.role}:${locator.name}`;
  if (locator.text) return `text:${locator.text}`;
  if (locator.selector) return `selector:${locator.selector}`;
  return `point:${locator.point?.x},${locator.point?.y}`;
}

function stepSignature(step: RoutineStep): string {
  if (step.kind === 'tap') return `tap:${locatorSignature(step.target)}`;
  if (step.kind === 'type') {
    return `type:${locatorSignature(step.target)}:${step.value}:${Boolean(step.submit)}`;
  }
  if (step.kind === 'scroll') {
    return `scroll:${locatorSignature(step.target)}:${step.direction}`;
  }
  if (step.kind === 'press') return `press:${step.key}`;
  if (step.kind === 'open') return `open:${step.url}`;
  if (step.kind === 'window') return `window:${step.match}`;
  return step.kind;
}

/** Tool calls operate on refs; only replayable locators and placeholders enter routines. */
export function explorerTools(session: AgentSession): Tool[] {
  const tools: Tool[] = [
    {
      name: 'look',
      description: 'Observe the current screen.',
      inputSchema: schema({}),
      run: () => observe(session, 'look'),
    },
    {
      name: 'tap',
      description: 'Tap one element by its latest ref.',
      inputSchema: schema({ ref: string }, ['ref']),
      async run(input) {
        const ref = arg(input, 'ref');
        await session.activity(`Tapping ${ref}`);
        return act(session, { kind: 'tap', ref });
      },
    },
    {
      name: 'type',
      description: 'Type in a field, preserving {{NAME}} placeholders for secrets.',
      inputSchema: schema({ ref: string, text: string, submit: boolean }, ['text']),
      async run(input) {
        const value = arg(input, 'text');
        const ref = input.ref as string | undefined;
        const submit = Boolean(input.submit);
        const summary = describe(session, { kind: 'type', ref, value });
        await session.activity('Typing in a field');
        const result = await session.driver!.act({
          kind: 'type',
          ref,
          value: session.vars.resolve(value),
          submit,
        });
        if (!result.ok) return failed(session, result.error ?? 'Action failed', summary);
        session.trail.push({
          kind: 'type',
          target: result.step?.kind === 'type' ? result.step.target : undefined,
          value: session.vars.redact(value) as string,
          submit,
        });
        await session.driver!.settle();
        return observe(session, 'type', summary);
      },
    },
    {
      name: 'press',
      description: 'Press one key.',
      inputSchema: schema({ key: string }, ['key']),
      run: (input) => act(session, { kind: 'press', key: arg(input, 'key') }),
    },
    {
      name: 'scroll',
      description: 'Scroll one direction.',
      inputSchema: schema({
        direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] },
        ref: string,
      }, ['direction']),
      run(input) {
        const direction = input.direction as 'up' | 'down' | 'left' | 'right';
        return act(session, { kind: 'scroll', direction, ref: input.ref as string | undefined });
      },
    },
    {
      name: 'back',
      description: 'Go back.',
      inputSchema: schema({}),
      run: () => act(session, { kind: 'back' }),
    },
    {
      name: 'open',
      description: 'Open a URL or deep link; placeholders resolve only in the driver.',
      inputSchema: schema({ url: string }, ['url']),
      run(input) {
        const url = arg(input, 'url');
        return act(session,
          { kind: 'open', url: session.vars.resolve(url) },
          { kind: 'open', url: session.vars.redact(url) as string });
      },
    },
    {
      name: 'wait',
      description: 'Wait up to ten seconds.',
      inputSchema: schema({ seconds: { type: 'number' } }, ['seconds']),
      run(input) {
        const ms = Math.min(10_000, Math.max(0, Number(input.seconds) * 1000));
        return act(session, { kind: 'wait', ms }, { kind: 'wait', ms });
      },
    },
    {
      name: 'record_screen',
      description: 'Record this screen, its routine, and automatic findings.',
      inputSchema: schema({ id: string, name: string, description: string },
        ['id', 'name', 'description']),
      async run(input) {
        const id = slug(arg(input, 'id'));
        const name = arg(input, 'name');
        const description = arg(input, 'description');
        await session.activity(`Recording ${name}`);
        await session.driver!.settle();
        const observation = await session.driver!.observe();
        const screenshot = await session.capture(observation, id);
        const snapshot = session.driver!.snapshot(observation, id);
        const findings = await evaluateScreen(session, { screenId: id, observation, snapshot });
        const previous = session.lastScreenId;
        const routineId = `screen-${id}`;
        await saveRoutine(session, routineId, description, id);
        await session.workspace.upsertScreen({
          id,
          name,
          description,
          platform: observation.platform,
          location: observation.location,
          routineId,
          lastScreenshot: screenshot,
        });
        if (previous && previous !== id) {
          await session.workspace.upsertScreen({ id: previous, links: [id], visits: 0 });
        }
        session.lastScreenId = id;
        session.lastScreenLocation = screenKey(observation);
        const screens = (await session.workspace.readAppMap())?.screens ?? [];
        const names = screens.map((screen) => screen.id).join(', ') || id;
        const found = findings.length
          ? `${findings.length} automatic finding(s): ${findings.map((item) => item.summary).join('; ')}`
          : 'no automatic findings';
        session.emit({
          kind: 'screen',
          summary: `Recorded ${name} (${found.split(':')[0]})`,
          screenId: id,
          screenshot,
        });
        return {
          ...text(`Recorded ${name}. ${found}. Known screens: ${names}`),
          meta: { summary: '', screenshot, screenId: id },
        };
      },
    },
    {
      name: 'save_routine',
      description: 'Save actions since the last anchor; use enter-app after sign-in or onboarding.',
      inputSchema: schema({ id: string, description: string }, ['id', 'description']),
      async run(input) {
        const id = slug(arg(input, 'id'));
        const routine = await saveRoutine(session, id, arg(input, 'description'));
        return text(`Saved ${routine.id} with ${routine.steps.length} step(s).`);
      },
    },
    {
      name: 'run_routine',
      description: 'Replay a known routine without model navigation.',
      inputSchema: schema({ id: string }, ['id']),
      async run(input) {
        const id = arg(input, 'id');
        const result = await replayRoutine(session, id);
        if (!result.ok) {
          return {
            ...text(`Routine ${id} failed at step ${result.failedStep ?? 'dependency'}: ${result.error}`),
            isError: true,
          };
        }
        session.anchor = { routineId: id, index: session.trail.length };
        await session.driver!.settle();
        return observe(session, `routine-${id}`, `Replayed the routine ${id}`);
      },
    },
    {
      name: 'report_bug',
      description: 'Report a visible product bug for judge review.',
      inputSchema: schema({
        title: string,
        what_is_wrong: string,
        expected: string,
        severity: { type: 'string', enum: ['cosmetic', 'minor', 'major', 'critical'] },
      }, ['title', 'what_is_wrong', 'expected', 'severity']),
      async run(input) {
        const title = arg(input, 'title');
        if (!session.lastScreenshot) {
          await session.capture(await session.driver!.observe(), 'reported-bug');
        }
        const screenId = currentScreenId(session);
        const candidate: Candidate = {
          id: `can_${shortHash(`${session.sessionId}:${title}:${randomUUID()}`)}`,
          sessionId: session.sessionId,
          screenId,
          source: 'explorer',
          fingerprint: fingerprint({
            screenId: screenId ?? 'unknown',
            ruleId: 'explorer',
            domNodeSignature: title.toLowerCase(),
          }),
          summary: session.vars.redact(title) as string,
          detail: session.vars.redact(
            `${arg(input, 'what_is_wrong')}\nExpected: ${arg(input, 'expected')}`) as string,
          severity: input.severity as Candidate['severity'],
          evidence: {
            screenshot: session.lastScreenshot,
            routineId: session.anchor.routineId,
            steps: session.trail.slice(session.anchor.index),
          },
          route: { to: 'judge', reason: 'Explorer reported a visible bug' },
          createdAt: new Date().toISOString(),
        };
        await session.workspace.appendCandidate(session.sessionId, candidate);
        session.emit({ kind: 'candidate', summary: title, screenshot: session.lastScreenshot });
        return text(`Reported ${candidate.id}: ${title}`);
      },
    },
    {
      name: 'list_screens',
      description: 'List known screens and their routines.',
      inputSchema: schema({}),
      async run() {
        const screens = (await session.workspace.readAppMap())?.screens ?? [];
        const lines = screens.map((screen) =>
          `${screen.id}: ${screen.name} (${screen.routineId ?? 'no routine'})`);
        return text(lines.join('\n') || '(none)');
      },
    },
    {
      name: 'finish',
      description: 'Finish exploring with a short summary.',
      inputSchema: schema({ summary: string }, ['summary']),
      async run(input) {
        return { ...text(arg(input, 'summary')), done: true };
      },
    },
  ];
  if (session.driver?.platform === 'web' || session.driver?.platform === 'electron') {
    tools.push({
      name: 'switch_window',
      description: 'Switch to a web or Electron window.',
      inputSchema: schema({ match: string }, ['match']),
      run: (input) => act(session, { kind: 'window', match: arg(input, 'match') }),
    });
  }
  return tools;
}
