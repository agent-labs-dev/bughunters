import { randomBytes } from 'node:crypto';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv-provider.js';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { Tool, ToolResult } from './types.js';

type Options = {
  onCall?: (name: string, input: Record<string, unknown>, result: ToolResult, ms: number) => void;
  maxCalls?: number;
};

type McpContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string };

/**
 * Serves a role's tools to a CLI agent (ADR 0005). The server is stateless:
 * each HTTP request gets its own MCP server and transport, because a
 * stateless transport accepts only one initialize. The call budget lives out
 * here, so it holds across every client session the CLI opens.
 */
export async function serveTools(tools: Tool[], opts: Options = {}): Promise<{ url: string; close(): Promise<void> }> {
  const budget = { calls: 0 };
  // A per-session capability URL works with every supported CLI MCP client.
  // It is written only to the private temporary config, never to the activity feed.
  const endpoint = `/mcp/${randomBytes(32).toString('base64url')}`;
  const validator = new AjvJsonSchemaValidator();
  const validatedTools = tools.map((tool) => {
    const validate = validator.getValidator<Record<string, unknown>>(tool.inputSchema);
    return { ...tool, async run(input: Record<string, unknown>) {
      const checked = validate(input);
      if (!checked.valid) return { content: [{ type: 'text' as const, text: `Invalid arguments: ${checked.errorMessage}` }], isError: true };
      return tool.run(checked.data);
    } };
  });

  const http = createServer((request, response) => {
    if (request.url !== endpoint) {
      response.writeHead(404).end();
      return;
    }
    const address = http.address();
    const authority = address && typeof address !== 'string' ? `127.0.0.1:${address.port}` : '';
    if (request.headers.host !== authority || (request.headers.origin && request.headers.origin !== `http://${authority}`)) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    void handle(request, response, validatedTools, opts, budget).catch((error) => {
      if (!response.headersSent) {
        response.writeHead(500).end(String(error));
      }
    });
  });

  http.requestTimeout = 30_000;
  http.headersTimeout = 10_000;

  await new Promise<void>((done, reject) => {
    http.once('error', reject);
    http.listen(0, '127.0.0.1', () => {
      http.off('error', reject);
      done();
    });
  });

  const address = http.address();
  if (!address || typeof address === 'string') {
    throw new Error('MCP server did not bind');
  }

  return {
    url: `http://127.0.0.1:${address.port}${endpoint}`,
    async close() {
      http.closeAllConnections();
      await new Promise<void>((done) => http.close(() => done()));
    },
  };
}

async function handle(
  request: IncomingMessage,
  response: ServerResponse,
  tools: Tool[],
  opts: Options,
  budget: { calls: number },
): Promise<void> {
  let body: unknown;
  if (request.method === 'POST') {
    try { body = await readBody(request); }
    catch (error) {
      response.writeHead(error instanceof RangeError ? 413 : 400).end('Invalid request body');
      return;
    }
  }
  const server = buildServer(tools, opts, budget);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  response.on('close', () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(request, response, body);
}

function buildServer(tools: Tool[], opts: Options, budget: { calls: number }): Server {
  const server = new Server({ name: 'bugpatrol', version: '0.0.0' }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema as { type: 'object'; [key: string]: unknown },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const input = request.params.arguments ?? {};
    const started = Date.now();
    const result = await callTool(tools, name, input, opts, budget);
    opts.onCall?.(name, input, result, Date.now() - started);
    return { content: result.content.map(toMcp), isError: result.isError ?? false };
  });

  return server;
}

async function callTool(
  tools: Tool[],
  name: string,
  input: Record<string, unknown>,
  opts: Options,
  budget: { calls: number },
): Promise<ToolResult> {
  // `finish` is always allowed, so an agent out of steps can still hand back.
  if (name !== 'finish' && budget.calls >= (opts.maxCalls ?? Infinity)) {
    return { content: [{ type: 'text', text: 'The step budget is used. Call finish now.' }], isError: true };
  }
  if (name !== 'finish') {
    budget.calls++;
  }

  const tool = tools.find((item) => item.name === name);
  if (!tool) {
    return { content: [{ type: 'text', text: `Unknown tool ${name}` }], isError: true };
  }
  try {
    return await tool.run(input);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
  }
}

function toMcp(part: ToolResult['content'][number]): McpContent {
  if (part.type === 'text') return { type: 'text', text: part.text };
  return { type: 'image', data: part.png.toString('base64'), mimeType: 'image/png' };
}

/** Bound memory before the transport parses attacker-controlled JSON. */
function readBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    const cleanup = () => { request.off('data', data); request.off('end', end); request.off('error', fail); request.off('aborted', aborted); };
    const fail = (error: Error) => { cleanup(); request.resume(); reject(error); };
    const aborted = () => fail(new Error('Request aborted'));
    const data = (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 1_048_576) { fail(new RangeError('Request too large')); return; }
      chunks.push(chunk);
    };
    const end = () => {
      cleanup();
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (error) { reject(error); }
    };
    request.on('data', data).once('end', end).once('error', fail).once('aborted', aborted);
  });
}
