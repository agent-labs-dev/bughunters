import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { appSchema, InfrastructureError } from '@autoqa/core';
import { startApp } from './lifecycle.js';
import { Vars } from './vars.js';

describe('startApp', () => {
  it('captures values for later commands and keeps a ready background process', async () => {
    const root = await mkdtemp(join(tmpdir(), 'autoqa-life-'));
    const vars = new Vars();
    const emitted: string[] = [];
    try {
      const app = appSchema.parse({
        setup: [
          { run: 'echo "CDP :9624"', capture: { CDP_PORT: 'CDP :(\\d+)' } },
          { run: 'test "${CDP_PORT}" = 9624' },
          { run: 'echo READY; sleep 20', background: true, readyWhen: 'READY', timeoutMs: 1000 },
        ],
        teardown: [{ run: 'echo goodbye' }, { run: 'exit 2' }],
      });
      const running = await startApp(app, { root, vars, emit: (line) => emitted.push(line) });
      expect(vars.resolve('{{CDP_PORT}}')).toBe('9624');
      await expect(running.stop()).resolves.toBeUndefined();
      expect(emitted.some((line) => line.includes('Teardown: ran'))).toBe(true);
      expect(emitted.some((line) => line.includes('failed'))).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('redacts failure output', async () => {
    const vars = new Vars();
    vars.set('TOKEN', 'secret-value');
    const app = appSchema.parse({ setup: [{ run: 'echo secret-value; exit 3' }] });
    await expect(startApp(app, { root: process.cwd(), vars })).rejects.toBeInstanceOf(InfrastructureError);
    await expect(startApp(app, { root: process.cwd(), vars })).rejects.toThrow('{{TOKEN}}');
  });
});
