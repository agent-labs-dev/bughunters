import { createServer, type Server } from 'node:http';
import type { LogRecord, LogWindow } from '@bugpatrol/core';
import type { LogCollector } from '../collector.js';
import { inWindow, parseLines } from '../parse.js';

export type WebhookLogSource = {
  name: string;
  /** The loopback port to listen on. 0 asks the OS for a free one. */
  port: number;
  /** The path the backend POSTs newline-delimited lines to. */
  path: string;
  match?: string;
};

/**
 * Receives logs a backend pushes, instead of reading them. The listener is
 * loopback-only, so a backend on another host reaches it through whatever
 * tunnel the team already runs, and nothing else on the network can write into
 * a patrol's evidence.
 */
export class WebhookCollector implements LogCollector {
  readonly name: string;
  private server?: Server;
  private port = 0;
  private readonly lines: string[] = [];

  constructor(private readonly source: WebhookLogSource) {
    this.name = source.name;
  }

  /** Where the backend should POST. Only meaningful once `start` has resolved. */
  get url(): string {
    return `http://127.0.0.1:${this.port}${this.source.path}`;
  }

  async start(): Promise<void> {
    const server = createServer((request, response) => {
      if (request.method !== 'POST' || (request.url ?? '').split('?')[0] !== this.source.path) {
        response.writeHead(404).end();
        return;
      }
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        for (const line of Buffer.concat(chunks).toString('utf8').split('\n')) {
          if (line.trim() !== '') this.lines.push(line);
        }
        response.writeHead(202).end();
      });
    });
    await new Promise<void>((done) => {
      server.listen(this.source.port, '127.0.0.1', done);
    });
    const address = server.address();
    this.port = address !== null && typeof address === 'object' ? address.port : this.source.port;
    this.server = server;
  }

  async read(window?: LogWindow): Promise<LogRecord[]> {
    const records = parseLines(this.lines.join('\n'), this.name, this.source.match);
    return window ? inWindow(records, window) : records;
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    if (server === undefined) return;
    await new Promise<void>((done) => server.close(() => done()));
  }
}
