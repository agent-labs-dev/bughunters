import { request } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { Control } from './control.js';
import { startViewer } from './viewer.js';

describe('private desktop viewer boundaries', () => {
  let viewer: Awaited<ReturnType<typeof startViewer>> | undefined;
  afterEach(async () => {
    await viewer?.close();
    viewer = undefined;
  });
  it('requires its capability for frames and disables every input endpoint by default', async () => {
    let changes = 0,
      inputs = 0;
    viewer = await startViewer({
      port: 0,
      allowTakeover: false,
      owner: () => 'agent',
      frame: async () => Buffer.from('png'),
      change: async () => {
        changes++;
      },
      input: async () => {
        inputs++;
      },
    });
    const url = new URL(viewer.url),
      origin = url.origin;
    const headers = { Authorization: `Bearer ${url.hash.slice(1)}`, Origin: origin };
    expect((await fetch(`${origin}/`)).status).toBe(200);
    expect((await fetch(`${origin}/frame`)).status).toBe(401);
    expect((await fetch(`${origin}/frame`, { headers })).status).toBe(200);
    for (const path of ['/control', '/input'])
      expect((await fetch(`${origin}${path}`, { method: 'POST', headers, body: '{}' })).status).toBe(403);
    expect(changes).toBe(0);
    expect(inputs).toBe(0);
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(`${origin}/state`, { headers: { ...headers, Host: 'attacker.example' } }, (response) => {
        response.resume();
        resolve(response.statusCode);
      });
      req.on('error', reject);
      req.end();
    });
    expect(status).toBe(403);
  });
  it('rejects cross-origin input and malformed data even when takeover is enabled', async () => {
    let inputs = 0;
    viewer = await startViewer({
      port: 0,
      allowTakeover: true,
      owner: () => 'human',
      frame: async () => Buffer.from('png'),
      change: async () => {},
      input: async () => {
        inputs++;
      },
    });
    const url = new URL(viewer.url),
      origin = url.origin;
    const headers = { Authorization: `Bearer ${url.hash.slice(1)}`, Origin: 'https://attacker.example' };
    expect(
      (await fetch(`${origin}/input`, { method: 'POST', headers, body: '{"kind":"press","key":"Return"}' })).status,
    ).toBe(403);
    headers.Origin = origin;
    expect(
      (await fetch(`${origin}/input`, { method: 'POST', headers, body: '{"kind":"shell","command":"bad"}' })).status,
    ).toBe(409);
    expect((await fetch(`${origin}/input`, { method: 'POST', headers, body: 'x'.repeat(16385) })).status).toBe(409);
    expect(inputs).toBe(0);
  });
  it('lets takeover wait for in-flight input, pauses queued agent work, and wakes it on close', async () => {
    const events: string[] = [];
    const control = new Control((owner) => events.push(owner));
    let finish!: () => void;
    const pending = control.agent(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    const takeover = control.change('human');
    expect(control.owner).toBe('agent');
    finish();
    await pending;
    await takeover;
    let acted = false;
    const paused = control.agent(async () => {
      acted = true;
    });
    await control.human(async () => {});
    expect(acted).toBe(false);
    control.close();
    await expect(paused).rejects.toThrow('closed');
    expect(acted).toBe(false);
    expect(events).toEqual(['human']);
  });
});
