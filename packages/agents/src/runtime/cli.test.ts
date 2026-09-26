import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '@bughunters/core';
import { serveTools } from '../mcp-server.js';
import type { RoleTask, Tool } from '../types.js';
import { CliRuntime } from './cli.js';

const echo: Tool = {
  name: 'echo',
  description: 'Echo',
  inputSchema: { type: 'object', properties: { value: { type: 'string' } } },
  async run(input) {
    return { content: [{ type: 'text', text: String(input.value) }] };
  },
};
const finish: Tool = {
  name: 'finish',
  description: 'Finish',
  inputSchema: { type: 'object' },
  async run() {
    return { content: [{ type: 'text', text: 'all done' }], done: true };
  },
};
const require = createRequire(import.meta.url);
const canListen = await new Promise<boolean>((done) => {
  const server = createServer();
  server.once('error', () => done(false));
  server.listen(0, '127.0.0.1', () => server.close(() => done(true)));
});
function task(workdir: string): RoleTask {
  return {
    role: 'fixer',
    sessionId: 'session',
    system: 'system',
    prompt: 'prompt',
    tools: [echo, finish],
    maxSteps: 2,
    budgetUsd: 1,
    timeoutMs: 5000,
    workdir,
  };
}

describe('MCP and CLI runtime', () => {
  it.skipIf(!canListen)('serves unchanged schemas to sequential SDK client sessions with a call budget', async () => {
    const server = await serveTools([echo, finish], { maxCalls: 1 });
    try {
      for (let n = 0; n < 2; n++) {
        const client = new Client({ name: 'test', version: '1' });
        const transport = new StreamableHTTPClientTransport(new URL(server.url));
        await client.connect(transport);
        const listed = await client.listTools();
        expect(listed.tools[0]?.inputSchema).toEqual(echo.inputSchema);
        const result = await client.callTool({ name: 'echo', arguments: { value: 'hi' } });
        expect((result.content as { type: string; text: string }[])[0]).toMatchObject({
          type: 'text',
          text: n === 0 ? 'hi' : 'The step budget is used. Call finish now.',
        });
        await client.close();
      }
    } finally {
      await server.close();
    }
  });

  it.skipIf(!canListen)('runs a CLI that calls echo and finish over MCP', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bughunters-cli-test-'));
    const script = join(root, 'client.mjs');
    const clientUrl = pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/index.js')).href;
    const transportUrl = pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/streamableHttp.js')).href;
    const source = `import { readFile } from 'node:fs/promises';
import { Client } from ${JSON.stringify(clientUrl)};
import { StreamableHTTPClientTransport } from ${JSON.stringify(transportUrl)};
const config = JSON.parse(await readFile(process.argv[2], 'utf8'));
const client = new Client({ name: 'fake-cli', version: '1' });
await client.connect(new StreamableHTTPClientTransport(new URL(config.mcpServers.bughunters.url)));
await client.callTool({ name: 'echo', arguments: { value: 'hello' } });
await client.callTool({ name: 'finish', arguments: {} });
await client.close();
console.log('cli complete');
`;
    await writeFile(script, source);
    try {
      const events: Partial<AgentEvent>[] = [];
      const runtime = new CliRuntime({ runtime: 'cli', command: `node ${JSON.stringify(script)} {mcp}` });
      const outcome = await runtime.run(task(root), (event) => events.push(event));
      expect(outcome).toMatchObject({ stop: 'done', summary: 'all done' });
      const calls = events.filter((event) => event.kind === 'tool-call').map((event) => event.tool);
      expect(calls).toEqual(['echo', 'finish']);
      expect(events.some((event) => event.kind === 'thought')).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.skipIf(!canListen)('times out a CLI process', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bughunters-cli-timeout-'));
    try {
      const runtime = new CliRuntime({ runtime: 'cli', command: 'sleep 10' });
      expect((await runtime.run({ ...task(root), timeoutMs: 100 }, () => {})).stop).toBe('timeout');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
