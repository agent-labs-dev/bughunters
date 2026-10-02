import type { LogRecord, LogWindow } from '@bugpatrol/core';

/**
 * The contract every log source implements. A collector is opened when a
 * session starts and read when it ends, so a backend only has to write its
 * logs somewhere; Bugpatrol never has to understand the backend's stack, its
 * language or its log library.
 */
export interface LogCollector {
  /** The configured source name. It labels every record and the flow view. */
  readonly name: string;
  /** Begin listening. Called once, before the session runs. */
  start(): Promise<void>;
  /** Everything collected so far, restricted to the window when one is given. */
  read(window?: LogWindow): Promise<LogRecord[]>;
  /** Release the source. Called even when the session failed. */
  stop(): Promise<void>;
}
