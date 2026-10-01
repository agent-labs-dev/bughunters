import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseConfig } from '@bugpatrol/core';
import { ApiDriver } from '@bugpatrol/drivers';
import { expect, it } from 'vitest';
import { replaySteps } from './replay.js';
import { AgentSession } from './session.js';
import { Vars } from './vars.js';
import { Workspace } from './workspace.js';

it.each(['string', 'numeric'])(
  'replays fresh %s ids without rewriting literal request data',
  async (kind) => {
    let id = 0;
    const reads: string[] = [];
    const limits: number[] = [];
    const server = createServer(async (request, response) => {
      response.setHeader('content-type', 'application/json');
      if (request.method === 'POST') {
        const chunks = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        limits.push(JSON.parse(Buffer.concat(chunks).toString()).limit);
        response.end(JSON.stringify({ result: { id: kind === 'numeric' ? ++id : `entity-${++id}` }, parent: 1 }));
      } else {
        reads.push(request.url!);
        response.end(JSON.stringify({ result: { id: request.url!.slice(1) } }));
      }
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No API port');
    const root = await mkdtemp(join(tmpdir(), 'bugpatrol-api-replay-'));
    const vars = new Vars();
    const driver = new ApiDriver({
      url: `http://127.0.0.1:${address.port}`,
      headers: {},
      methods: ['GET', 'POST'],
      timeoutMs: 1000,
      viewport: { width: 900, height: 600 },
      redact: (value) => vars.redact(value) as string,
    });
    try {
      await driver.connect();
      const record = await new Workspace(root).startSession('explorer');
      const session = new AgentSession(
        root,
        parseConfig({ version: 1, app: { platform: 'api', connect: { url: `http://127.0.0.1:${address.port}` } } }),
        vars,
        record.id,
        'explorer',
        driver,
      );
      const steps = [
        {
          kind: 'request' as const,
          method: 'POST' as const,
          url: '/entities',
          body: '{"limit":10}',
          capture: { RESPONSE_ENTITY: '/result/id' },
        },
        { kind: 'request' as const, method: 'GET' as const, url: '/{{RESPONSE_ENTITY}}' },
      ];
      expect((await replaySteps(session, steps)).ok).toBe(true);
      expect((await replaySteps(session, steps)).ok).toBe(true);
      expect(reads).toEqual(kind === 'numeric' ? ['/1', '/2'] : ['/entity-1', '/entity-2']);
      expect(limits).toEqual([10, 10]);
      expect(JSON.parse((await driver.observe()).http!.body)).toEqual({
        result: { id: kind === 'numeric' ? '2' : 'entity-2' },
      });
    } finally {
      await driver.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(root, { recursive: true, force: true });
    }
  },
  20000,
);
