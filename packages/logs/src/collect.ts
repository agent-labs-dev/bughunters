import type { BugpatrolConfig, LogRecord, LogSource, LogWindow, SessionFlow } from '@bugpatrol/core';
import type { LogCollector } from './collector.js';
import { FileCollector } from './collectors/file.js';
import { StreamCollector } from './collectors/stream.js';
import { WebhookCollector } from './collectors/webhook.js';

export type CollectorContext = {
  /** The project root: relative paths and commands resolve here. */
  root: string;
  /** Redacts a message with the run's variables before it is kept. */
  redact?: (text: string) => string;
  /** Progress and non-fatal failures, written for a human. */
  onLog?: (message: string) => void;
};

/** Build the collector for one configured source. */
export function createCollector(source: LogSource, context: CollectorContext): LogCollector {
  switch (source.kind) {
    case 'file':
      return new FileCollector(context.root, {
        name: source.name,
        path: source.path,
        maxBytes: source.maxBytes,
        match: source.match,
      });
    case 'stream':
      return new StreamCollector(context.root, {
        name: source.name,
        command: source.command,
        match: source.match,
      });
    case 'webhook':
      return new WebhookCollector({
        name: source.name,
        port: source.port,
        path: source.path,
        match: source.match,
      });
  }
}

/**
 * Every configured source, opened together. A source that cannot start is
 * reported and skipped rather than failing the run: log collection is
 * evidence, and missing evidence must never stop a patrol.
 */
export class LogCollectorSet {
  private readonly entries: Array<{ source: LogSource; collector: LogCollector }>;

  constructor(
    private readonly context: CollectorContext,
    config: BugpatrolConfig,
  ) {
    this.entries = config.logs.map((source) => ({ source, collector: createCollector(source, context) }));
  }

  /** The sources this set reads, in config order. */
  get sources(): LogSource[] {
    return this.entries.map((entry) => entry.source);
  }

  async start(): Promise<void> {
    for (const { source, collector } of this.entries) {
      try {
        await collector.start();
        if (collector instanceof WebhookCollector) {
          this.context.onLog?.(`Log source ${source.name} is listening on ${collector.url}`);
        }
      } catch (error) {
        this.context.onLog?.(`Log source ${source.name} did not start: ${reason(error)}`);
      }
    }
  }

  /** Read every source, redact what it found, and merge it in time order. */
  async read(window?: LogWindow): Promise<LogRecord[]> {
    const records: LogRecord[] = [];
    for (const { source, collector } of this.entries) {
      try {
        records.push(...(await collector.read(window)));
      } catch (error) {
        this.context.onLog?.(`Log source ${source.name} could not be read: ${reason(error)}`);
      }
    }
    const redact = this.context.redact;
    return records
      .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
      .map((record) => (redact === undefined ? record : { ...record, message: redact(record.message) }));
  }

  async stop(): Promise<void> {
    for (const { collector } of this.entries) {
      try {
        await collector.stop();
      } catch {
        // A source that will not close must not hold the run open.
      }
    }
  }

  /** What each source contributed, so an empty flow view is explainable. */
  summarize(records: LogRecord[]): SessionFlow['sources'] {
    return this.entries.map(({ source }) => ({
      name: source.name,
      kind: source.kind,
      collected: records.filter((record) => record.source === source.name).length,
    }));
  }
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
