import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileCollector } from './file.js';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'bugpatrol-logs-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('FileCollector', () => {
  it('reads only what the file gained after the session opened', async () => {
    const file = join(root, 'app.log');
    await writeFile(file, 'before the session\n');
    const collector = new FileCollector(root, { name: 'api', path: 'app.log', maxBytes: 1 << 20 });
    await collector.start();
    await appendFile(file, '2024-03-05T06:07:08Z ERROR the new failure\n');
    const records = await collector.read();
    expect(records.map((record) => record.message)).toEqual(['2024-03-05T06:07:08Z ERROR the new failure']);
    expect(records[0]?.level).toBe('error');
    expect(records[0]?.source).toBe('api');
    await collector.stop();
  });

  it('contributes nothing when the file does not exist yet', async () => {
    const collector = new FileCollector(root, { name: 'api', path: 'missing.log', maxBytes: 1 << 20 });
    await collector.start();
    expect(await collector.read()).toEqual([]);
  });

  it('keeps the newest lines when the file grew past the cap', async () => {
    const file = join(root, 'app.log');
    await writeFile(file, '');
    const collector = new FileCollector(root, { name: 'api', path: 'app.log', maxBytes: 12 });
    await collector.start();
    await appendFile(file, 'aaaaaaaaaa\nbbbbbbbbbb\n');
    const records = await collector.read();
    expect(records.map((record) => record.message)).toEqual(['bbbbbbbbbb']);
    await collector.stop();
  });

  it('applies the configured match filter', async () => {
    const file = join(root, 'app.log');
    await writeFile(file, '');
    const collector = new FileCollector(root, { name: 'api', path: 'app.log', maxBytes: 1 << 20, match: 'ERROR' });
    await collector.start();
    await appendFile(file, 'INFO ok\nERROR bad\n');
    const records = await collector.read();
    expect(records.map((record) => record.message)).toEqual(['ERROR bad']);
    await collector.stop();
  });
});
