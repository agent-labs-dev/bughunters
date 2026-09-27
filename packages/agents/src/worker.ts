import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { access, lstat, readdir, realpath } from 'node:fs/promises';
import type { BughuntersConfig } from '@bughunters/core';
import { ConfigError } from '@bughunters/core';
import { runProcess } from './process.js';

type Worker = BughuntersConfig['agents']['fixer']['execution'];
/** Deliberately excludes provider, GitHub, cloud and application credentials. */
export function workerEnvironment(names: string[] = []): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, LANG: 'C.UTF-8', TZ: 'UTC' };
  for (const name of names) if (process.env[name] !== undefined) env[name] = process.env[name];
  return env;
}

export function dockerArguments(worktree: string, settings: Worker, command: string, name: string): string[] {
  if (worktree.includes(',')) throw new ConfigError('Docker worktree paths cannot contain commas.');
  return ['run', '--rm', '--name', name, '--init', '--network', settings.network,
    '--cap-drop=ALL', '--security-opt=no-new-privileges', '--read-only',
    '--pids-limit=128', '--memory=2g', '--cpus=2', '--user', `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`,
    '--tmpfs', '/tmp:rw,nosuid,nodev,size=268435456', '--env', 'HOME=/tmp',
    '--mount', `type=bind,source=${worktree},target=/work`,
    // A linked worktree's gitdir points outside /work. Protect its pointer from writes.
    '--mount', `type=bind,source=${worktree}/.git,target=/work/.git,readonly`,
    '--workdir', '/work', ...settings.env.flatMap((key) => ['--env', key]),
    settings.image, '/bin/sh', '-c', command];
}

export async function runWorker(worktree: string, settings: Worker, command: string, signal?: AbortSignal, timeoutMs = 300_000) {
  const cwd = await realpath(worktree);
  const env = workerEnvironment(settings.env);
  if (settings.mode === 'trusted-host') return runProcess('/bin/sh', ['-c', command], { cwd, env, signal, timeoutMs });
  if (!(await lstat(resolve(cwd, '.git'))).isFile()) throw new ConfigError('Docker workers require a linked worktree, not a checkout with a .git directory.');
  const name = `bughunters-${randomUUID()}`;
  try {
    return await runProcess('docker', dockerArguments(cwd, settings, command, name), { cwd, env, signal, timeoutMs });
  } finally {
    // Killing the Docker client does not necessarily kill the container.
    await runProcess('docker', ['rm', '--force', name], { cwd, env, timeoutMs: 10_000 }).catch(() => undefined);
  }
}

export async function checkedWorker(worktree: string, settings: Worker, command: string, signal?: AbortSignal, timeoutMs?: number): Promise<void> {
  const output = await runWorker(worktree, settings, command, signal, timeoutMs);
  if (output.code !== 0 || output.timedOut || output.cancelled || output.overflow) {
    throw new Error(`Worker command failed: ${(output.stderr || output.stdout).slice(-4000) || 'cancelled, timed out, or exceeded limits'}`);
  }
}

export function requireTrustedCli(label: string, settings: Worker): void {
  if (label.startsWith('cli:') && settings.mode !== 'trusted-host') {
    throw new ConfigError('Native CLI fixers require execution.mode: trusted-host. Use a model fixer for Docker isolation.');
  }
}

/** Do not let untrusted source changes turn Git maintenance into host execution. */
export async function assertSafeGit(worktree: string, settings: Worker): Promise<void> {
  if (settings.mode === 'trusted-host') return;
  const git = async (...args: string[]) => (await promisify(execFile)('git', args, { cwd: worktree })).stdout.trim();
  let external = '';
  try { external = await git('config', '--get-regexp', '^(filter\\.|core\\.fsmonitor)'); }
  catch (error) { if ((error as { code?: number }).code !== 1) throw error; }
  if (external) throw new ConfigError('Docker fixing requires a checkout without Git filters or fsmonitor commands. Use a clean clone or explicit trusted-host execution.');
  const hooks = resolve(worktree, await git('rev-parse', '--git-path', 'hooks'));
  let files: string[];
  try { files = await readdir(hooks); } catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) return;
    throw error;
  }
  for (const file of files) {
    if (file.endsWith('.sample')) continue;
    let executable = false;
    try { await access(resolve(hooks, file), constants.X_OK); executable = true; } catch { /* Not executable. */ }
    if (executable) throw new ConfigError('Docker fixing cannot execute host Git hooks. Move checks into fixer.verify, use a clean clone, or explicitly select trusted-host execution.');
  }
}
