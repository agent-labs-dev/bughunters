import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { parseConfig } from '@bughunters/core';
import { runWorker } from './worker.js';

it.skipIf(process.env.BUGHUNTERS_DOCKER_TEST !== '1')('isolates a real worker and removes it after completion', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bh-docker-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root });
  try {
    git('init', '-q'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.com');
    await writeFile(join(root, 'app.txt'), 'test'); git('add', '.');
    git('-c', 'commit.gpgsign=false', 'commit', '-qm', 'initial');
    git('worktree', 'add', '-qb', 'worker', join(root, 'work'));
    const settings = parseConfig({ version: 1, app: { connect: { url: 'http://localhost' } } }).agents.fixer.execution;
    process.env.BUGHUNTERS_WORKER_SECRET = 'not-forwarded';
    const result = await runWorker(join(root, 'work'), settings, `set -eu
      test -z "\${BUGHUNTERS_WORKER_SECRET:-}"
      test ! -e /var/run/docker.sock
      if echo bad > /.escape; then exit 1; fi
      if echo bad > /work/.git; then exit 1; fi
      echo passed > /work/result
    `);
    expect(result.code, result.stderr).toBe(0);
    expect((await readFile(join(root, 'work/result'), 'utf8')).trim()).toBe('passed');
    expect(execFileSync('docker', ['ps', '-aq', '--filter', 'name=bughunters-'], { encoding: 'utf8' }).trim()).toBe('');
  } finally { delete process.env.BUGHUNTERS_WORKER_SECRET; await rm(root, { recursive: true, force: true }); }
}, 60_000);
