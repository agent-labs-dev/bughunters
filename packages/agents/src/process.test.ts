import { describe, expect, it } from 'vitest';
import { runProcess } from './process.js';

const options = { cwd: process.cwd(), timeoutMs: 5_000 };
describe('owned processes', () => {
  it('kills a process that ignores termination before returning', async () => {
    const started = Date.now();
    const result = await runProcess(process.execPath, ['-e', "process.on('SIGTERM',()=>{});setInterval(()=>{},100)"], { ...options, timeoutMs: 300 });
    expect(result.timedOut).toBe(true);
    expect(Date.now() - started).toBeLessThan(4_000);
    expect(result.code).toBeNull();
  });
  it('cancels running work and rejects already cancelled work', async () => {
    const controller = new AbortController();
    const running = runProcess(process.execPath, ['-e', 'setInterval(()=>{},100)'], { ...options, signal: controller.signal });
    controller.abort();
    expect((await running).cancelled).toBe(true);
    await expect(runProcess(process.execPath, ['-e', 'process.exit(0)'], { ...options, signal: controller.signal })).rejects.toThrow();
  });
  it('bounds output and stops a flooding process', async () => {
    const result = await runProcess(process.execPath, ['-e', "setInterval(()=>process.stdout.write('x'.repeat(4096)),1)"], { ...options, maxBytes: 1024 });
    expect(result.overflow).toBe(true);
    expect(Buffer.byteLength(result.stdout + result.stderr)).toBeLessThanOrEqual(1024);
  });
  it('reports spawn errors without leaving a timer behind', async () => {
    await expect(runProcess('/does-not-exist/bughunters', [], options)).rejects.toThrow();
  });
});
