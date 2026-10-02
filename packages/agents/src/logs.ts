import type { BugpatrolConfig, LogWindow, SessionFlow } from '@bugpatrol/core';
import { buildFlow, LogCollectorSet } from '@bugpatrol/logs';
import type { Vars } from './vars.js';
import type { Workspace } from './workspace.js';

export type LogCaptureOptions = {
  config: BugpatrolConfig;
  root: string;
  vars: Vars;
  onLog?: (message: string) => void;
};

/**
 * The configured log sources as one set, or undefined when the project
 * configures none. Everything the sources collect is redacted with the run's
 * variables before it is kept, exactly like the rest of the run.
 */
export function logCollectorSet(options: LogCaptureOptions): LogCollectorSet | undefined {
  if (options.config.logs.length === 0) return undefined;
  return new LogCollectorSet(
    {
      root: options.root,
      redact: (text) => options.vars.redact(text) as string,
      onLog: options.onLog,
    },
    options.config,
  );
}

export type SessionFlowOptions = {
  workspace: Workspace;
  sessionId: string;
  collectors: LogCollectorSet;
  window: LogWindow;
  onLog?: (message: string) => void;
};

/**
 * Read the sources, keep what they found, and merge it with the session's own
 * actions into the flow view. A failure here is reported and swallowed: the
 * flow is evidence, and missing evidence must never fail a patrol.
 */
export async function captureSessionFlow(options: SessionFlowOptions): Promise<SessionFlow | undefined> {
  const { workspace, sessionId, collectors } = options;
  try {
    const session = await workspace.readSession(sessionId);
    if (!session) return undefined;
    const logs = await collectors.read(options.window);
    await workspace.saveSessionLogs(sessionId, logs);
    const flow = buildFlow({
      session,
      events: await workspace.readEvents(sessionId),
      signals: await workspace.readSignals(sessionId),
      logs,
      sources: collectors.summarize(logs),
      window: options.window,
    });
    await workspace.saveSessionFlow(sessionId, flow);
    return flow;
  } catch (error) {
    options.onLog?.(`Could not build the session flow: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}
