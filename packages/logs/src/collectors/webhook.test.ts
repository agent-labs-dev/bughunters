import { afterEach, describe, expect, it } from 'vitest';
import { WebhookCollector } from './webhook.js';

let collector: WebhookCollector | undefined;

afterEach(async () => {
  await collector?.stop();
  collector = undefined;
});

describe('WebhookCollector', () => {
  it('receives the newline-delimited lines the backend POSTs', async () => {
    collector = new WebhookCollector({ name: 'api', port: 0, path: '/logs' });
    await collector.start();
    const response = await fetch(collector.url, {
      method: 'POST',
      body: '2024-03-05T06:07:08Z ERROR boom\nwarn: later\n',
    });
    expect(response.status).toBe(202);
    const records = await collector.read();
    expect(records.map((record) => record.message)).toEqual(['2024-03-05T06:07:08Z ERROR boom', 'warn: later']);
    expect(records[0]?.level).toBe('error');
  });

  it('refuses a GET and an unknown path', async () => {
    collector = new WebhookCollector({ name: 'api', port: 0, path: '/logs' });
    await collector.start();
    const get = await fetch(collector.url);
    expect(get.status).toBe(404);
    const wrong = await fetch(collector.url.replace('/logs', '/other'), { method: 'POST', body: 'x' });
    expect(wrong.status).toBe(404);
    expect(await collector.read()).toEqual([]);
  });

  it('applies the configured match filter', async () => {
    collector = new WebhookCollector({ name: 'api', port: 0, path: '/logs', match: 'ERROR' });
    await collector.start();
    await fetch(collector.url, { method: 'POST', body: 'INFO ok\nERROR bad\n' });
    const records = await collector.read();
    expect(records.map((record) => record.message)).toEqual(['ERROR bad']);
  });
});
