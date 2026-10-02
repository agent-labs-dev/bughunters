import { open, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { LogRecord } from '@bugpatrol/core';
import type { LogCollector } from '../collector.js';
import { parseLines } from '../parse.js';

export type FileLogSource = {
  name: string;
  /** Relative to the project root. */
  path: string;
  maxBytes: number;
  match?: string;
};

/**
 * Tails one log file. The session reads from the size the file had when it
 * opened, so a long-lived log is never re-read and what the file gained is
 * exactly what the session produced.
 */
export class FileCollector implements LogCollector {
  readonly name: string;
  private readonly file: string;
  private offset = 0;

  constructor(
    root: string,
    private readonly source: FileLogSource,
  ) {
    this.name = source.name;
    this.file = resolve(root, source.path);
  }

  async start(): Promise<void> {
    this.offset = await sizeOf(this.file);
  }

  async read(): Promise<LogRecord[]> {
    const length = await sizeOf(this.file);
    if (length <= this.offset) return [];
    // A file that grew past the cap keeps its tail: the newest lines are the
    // ones this session just wrote.
    const from = Math.max(this.offset, length - this.source.maxBytes);
    const handle = await open(this.file, 'r');
    try {
      const buffer = Buffer.alloc(length - from);
      await handle.read(buffer, 0, buffer.length, from);
      return parseLines(buffer.toString('utf8'), this.name, this.source.match);
    } finally {
      await handle.close();
    }
  }

  async stop(): Promise<void> {
    // The file is read on demand, so there is nothing to release.
  }
}

async function sizeOf(file: string): Promise<number> {
  try {
    return (await stat(file)).size;
  } catch (error) {
    // A source the app has not created yet contributes nothing; it is not a failure.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw error;
  }
}
