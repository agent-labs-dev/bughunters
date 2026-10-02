import { spawn } from 'node:child_process';
import type { LogRecord, LogWindow } from '@bugpatrol/core';
import type { LogCollector } from '../collector.js';
import { inWindow, parseLines } from '../parse.js';

export type StreamLogSource = {
  name: string;
  /** A shell command whose stdout is the log stream. */
  command: string;
  match?: string;
};

/**
 * Reads a command's stdout as a log stream. The command starts when the
 * session starts and stops when it ends, so a backend that only streams
 * (`docker logs -f`, `journalctl -f`, a dev server) is covered without being
 * asked to write a file.
 */
export class StreamCollector implements LogCollector {
  readonly name: string;
  private child?: ReturnType<typeof spawn>;
  private output = '';

  constructor(
    private readonly root: string,
    private readonly source: StreamLogSource,
  ) {
    this.name = source.name;
  }

  async start(): Promise<void> {
    const child = spawn('/bin/sh', ['-c', this.source.command], {
      cwd: this.root,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    // A command that cannot start must not take the patrol with it.
    child.on('error', () => undefined);
    child.stdout?.on('data', (chunk: Buffer) => {
      this.output += chunk.toString();
    });
    this.child = child;
  }

  async read(window?: LogWindow): Promise<LogRecord[]> {
    const records = parseLines(this.output, this.name, this.source.match);
    return window ? inWindow(records, window) : records;
  }

  async stop(): Promise<void> {
    this.child?.kill('SIGTERM');
    this.child = undefined;
  }
}
