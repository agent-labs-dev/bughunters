import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import { BaselineStore, baselineKeyFor, parseConfig, paths } from '@bughunters/core';
import { runCommand } from './run.js';
it('requires explicit baseline approval and does not mutate approved state during verification', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bh-baseline-cli-'));
  const server = createServer((_req, res) => { res.setHeader('content-type', 'text/html'); res.end('<html><body style="font-family:Arial">Ready</body></html>'); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const config = parseConfig({ version: 1, run: { command: 'unused', url }, viewports: [{ name: 'desktop', width: 400, height: 300 }], determinism: { failOnFontFallback: false } });
    const options = { root, config, mode: 'all' as const, commit: 'synthetic', noModels: true };
    await expect(runCommand(options)).rejects.toThrow('Approved baseline unavailable');
    await runCommand({ ...options, updateBaselines: true });
    const manifest = await readFile(paths.baselineManifest(root), 'utf8');
    expect((await runCommand(options)).exitCode).toBe(0);
    expect(await readFile(paths.baselineManifest(root), 'utf8')).toBe(manifest);
    const store = BaselineStore.load(root, 'unpinned');
    await unlink(store.verify(baselineKeyFor('/', 'desktop')));
    await expect(runCommand(options)).rejects.toThrow('unavailable');
    expect(await readFile(paths.baselineManifest(root), 'utf8')).toBe(manifest);
  } finally {
    server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
}, 20_000);
