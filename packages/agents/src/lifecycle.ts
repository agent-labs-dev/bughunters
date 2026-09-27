import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { InfrastructureError, type AppCommand, type AppConfig } from '@bughunters/core';
import { runProcess } from './process.js';
import { Vars } from './vars.js';

type Options = { root: string; vars: Vars; emit?: (summary: string) => void; source?: string };

/** Shell commands belong to the app configuration. A source override swaps commands rooted at app.source into the worktree; every command receives BUGHUNTERS_SOURCE. Output is redacted. */
export async function startApp(app: AppConfig, opts: Options): Promise<{ vars: Vars; stop(): Promise<void> }> {
  const children: ChildProcess[] = [];
  const report = (message: string) => opts.emit?.(opts.vars.redact(message) as string);
  const configuredSource = resolve(opts.root, app.source);
  const effectiveSource = opts.source ?? configuredSource;

  async function run(command: AppCommand, phase: 'Setup' | 'Teardown'): Promise<void> {
    const shell = opts.vars.resolveConfig(command.run);
    const configuredCwd = resolve(opts.root, opts.vars.resolveConfig(command.cwd ?? '.'));
    const cwd = opts.source && configuredCwd === configuredSource ? opts.source : configuredCwd;
    const env = { ...process.env, ...Object.fromEntries(opts.vars.entries()), BUGHUNTERS_SOURCE: effectiveSource };
    const started = Date.now();
    if (!command.background) {
      const result = await runProcess('/bin/sh', ['-c', shell], { cwd, env, timeoutMs: command.timeoutMs });
      const output = result.stdout + result.stderr;
      for (const [name, pattern] of Object.entries(command.capture)) {
        const match = new RegExp(pattern).exec(output);
        if (match?.[1] !== undefined) opts.vars.set(name, match[1]);
      }
      if (result.code !== 0 || result.timedOut || result.overflow) {
        throw new InfrastructureError(`${phase} command failed (${result.timedOut ? 'timeout' : result.overflow ? 'output limit' : `exit ${result.code}`}): ${opts.vars.redact(output.slice(-4000))}`);
      }
      report(`${phase}: completed (${((Date.now() - started) / 1000).toFixed(1)}s)`);
      return;
    }
    const child = spawn('/bin/sh', ['-c', shell], {
      cwd,
      env,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let settled = false;
    const captures = Object.entries(command.capture).map(([name, pattern]) => [name, new RegExp(pattern)] as const);
    const append = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-4 * 1024 * 1024);
      for (const [name, pattern] of captures) {
        const match = pattern.exec(output);
        if (match?.[1] !== undefined) {
          opts.vars.set(name, match[1]);
        }
      }
    };
    child.stdout?.on('data', append);
    child.stderr?.on('data', append);
    const exit = new Promise<number>((done, reject) => {
      child.once('error', reject);
      child.once('exit', (code) => {
        settled = true;
        done(code ?? 1);
      });
    });
    void exit.catch(() => undefined);
    const timeout = setTimeout(() => killGroup(child, 'SIGKILL'), command.timeoutMs);
    try {
      if (command.background) {
        if (command.readyWhen) {
          const ready = new RegExp(command.readyWhen);
          await new Promise<void>((done, reject) => {
            const wait = setTimeout(() => finish(new Error('timed out waiting for ready output')), command.timeoutMs);
            const finish = (error?: Error) => {
              clearTimeout(wait);
              child.stdout?.off('data', check);
              child.stderr?.off('data', check);
              child.off('exit', onExit);
              child.off('error', finish);
              if (error) {
                reject(error);
              } else {
                done();
              }
            };
            const check = () => {
              if (ready.test(output)) {
                finish();
              }
            };
            const onExit = () => finish(new Error('exited before ready'));
            child.stdout?.on('data', check);
            child.stderr?.on('data', check);
            child.once('exit', onExit);
            child.once('error', finish);
            check();
          });
        }
        children.push(child);
        void exit.catch(() => undefined);
      } else {
        const code = await exit;
        if (code !== 0) {
          throw new Error(`exit ${code}`);
        }
      }
      report(`${phase}: ran \`${shell}\` (${((Date.now() - started) / 1000).toFixed(1)}s)`);
    } catch (cause) {
      if (!settled) {
        killGroup(child, 'SIGKILL');
        await exit.catch(() => undefined);
      }
      const tail = output.trim().split('\n').slice(-20).join('\n');
      const message = `${phase} command \`${opts.vars.redact(shell)}\` failed: ${String(cause)}`;
      throw new InfrastructureError(`${message}\n${opts.vars.redact(tail)}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  try {
    for (const command of app.setup) {
      await run(command, 'Setup');
    }
  } catch (error) {
    // A setup that fails halfway may already hold resources (a test run, an
    // identity). Teardown undoes what it can before the error goes up.
    for (const command of app.teardown) {
      try {
        await run(command, 'Teardown');
      } catch (cause) {
        report(String(cause));
      }
    }
    for (const child of children) {
      killGroup(child);
    }
    throw error;
  }
  return {
    vars: opts.vars,
    async stop() {
      for (const command of app.teardown) {
        try {
          await run(command, 'Teardown');
        } catch (error) {
          report(String(error));
        }
      }
      await Promise.all(children.map(async (child) => {
        if (child.exitCode !== null || child.signalCode !== null) {
          return;
        }
        killGroup(child);
        const timer = setTimeout(() => killGroup(child, 'SIGKILL'), 5_000);
        await new Promise<void>((done) => child.once('exit', () => done()));
        clearTimeout(timer);
      }));
    },
  };
}

function killGroup(child: ChildProcess, signal: NodeJS.Signals = 'SIGTERM'): void {
  if (!child.pid) {
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
}
