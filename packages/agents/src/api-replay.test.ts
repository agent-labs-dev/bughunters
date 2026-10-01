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

it('replays API create/read paths using each newly created entity id', async () => {
  let id = 0;
  const reads: string[] = [];
  const server = createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    if (request.method === 'POST') response.end(JSON.stringify({ result: { id: `entity-${++id}` } }));
    else {
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
        capture: { RESPONSE_ENTITY: '/result/id' },
      },
      { kind: 'request' as const, method: 'GET' as const, url: '/{{RESPONSE_ENTITY}}' },
    ];
    expect((await replaySteps(session, steps)).ok).toBe(true);
    expect((await replaySteps(session, steps)).ok).toBe(true);
    expect(reads).toEqual(['/entity-1', '/entity-2']);
  } finally {
    await driver.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
}, 20000);
