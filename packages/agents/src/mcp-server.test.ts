import { request } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { serveTools } from './mcp-server.js';

const servers: Awaited<ReturnType<typeof serveTools>>[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => server.close())); });
async function fixture() {
  const run = vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'ok' }] }));
  const server = await serveTools([{ name: 'probe', description: 'test',
    inputSchema: { type: 'object', properties: { count: { type: 'integer', minimum: 1 } }, required: ['count'], additionalProperties: false }, run }]);
  servers.push(server);
  return { ...server, run };
}
const body = (args: unknown) => JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'probe', arguments: args } });
const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
describe('local tool authorization', () => {
  it('requires the session capability and does not reuse it across sessions', async () => {
    const a = await fixture(); const b = await fixture();
    expect(new URL(a.url).pathname).not.toBe(new URL(b.url).pathname);
    const unknown = new URL('/mcp', a.url);
    expect((await fetch(unknown, { method: 'POST', headers, body: body({ count: 1 }) })).status).toBe(404);
    expect(a.run).not.toHaveBeenCalled();
  });
  it.each<Record<string, string>>([{ host: 'attacker.example' }, { origin: 'https://attacker.example' }])('rejects untrusted request headers %j', async (extra) => {
    const server = await fixture();
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(server.url, { method: 'POST', headers: { ...headers, ...extra } }, (res) => {
        res.resume(); res.once('end', () => resolve(res.statusCode));
      });
      req.once('error', reject); req.end(body({ count: 1 }));
    });
    expect(status).toBe(403);
    expect(server.run).not.toHaveBeenCalled();
  });
  it('validates arguments before invoking a tool', async () => {
    const server = await fixture();
    for (const args of [{}, { count: 0 }, { count: '1' }, { count: 1, unexpected: true }]) {
      const response = await fetch(server.url, { method: 'POST', headers, body: body(args) });
      expect((await response.json()).result.isError).toBe(true);
    }
    expect(server.run).not.toHaveBeenCalled();
    const response = await fetch(server.url, { method: 'POST', headers, body: body({ count: 1 }) });
    expect((await response.json()).result.isError).toBe(false);
    expect(server.run).toHaveBeenCalledOnce();
  });
  it('rejects oversized and malformed JSON before dispatch', async () => {
    const server = await fixture();
    expect((await fetch(server.url, { method: 'POST', headers, body: 'x'.repeat(1_048_577) })).status).toBe(413);
    expect((await fetch(server.url, { method: 'POST', headers, body: '{' })).status).toBe(400);
    expect(server.run).not.toHaveBeenCalled();
  });
});
