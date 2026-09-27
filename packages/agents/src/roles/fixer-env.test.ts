import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseConfig } from '@bughunters/core';
import { modelTools } from './fixer.js';
import { assertSafeGit, dockerArguments, requireTrustedCli, workerEnvironment } from '../worker.js';
const execution = parseConfig({ version: 1, app: { connect: { url: 'http://localhost' } } }).agents.fixer.execution;

describe('fixer boundary', () => {
  it('defaults to a resource-bounded offline worker without host credentials', () => {
    expect(execution.mode).toBe('docker');
    const args = dockerArguments('/worktree', execution, 'echo ok', 'test-worker');
    expect(args).toContain('--network'); expect(args).toContain('none');
    expect(args).toContain('--cap-drop=ALL'); expect(args).toContain('--read-only');
    expect(args).toContain('type=bind,source=/worktree/.git,target=/work/.git,readonly');
    process.env.BUGHUNTERS_TEST_PRIVATE = 'private';
    try {
      expect(workerEnvironment().BUGHUNTERS_TEST_PRIVATE).toBeUndefined();
      expect(workerEnvironment(['BUGHUNTERS_TEST_PRIVATE']).BUGHUNTERS_TEST_PRIVATE).toBe('private');
    } finally { delete process.env.BUGHUNTERS_TEST_PRIVATE; }
    expect(() => requireTrustedCli('cli:claude', execution)).toThrow('trusted-host');
  });
  it('denies Git metadata and symlink escapes in file tools', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bh-worker-'));
    try {
      await mkdir(join(root, 'work'));
      await writeFile(join(root, 'secret'), 'private');
      await symlink(join(root, 'secret'), join(root, 'work', 'escape'));
      const tools = modelTools(join(root, 'work'), execution);
      await expect(tools.find(t => t.name === 'write_file')!.run({ path: '.git', content: 'bad' })).rejects.toThrow('Git metadata');
      await expect(tools.find(t => t.name === 'read_file')!.run({ path: 'escape' })).rejects.toThrow('leaves worktree');
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it('rejects host command extensions rather than bypassing them', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bh-git-policy-'));
    try {
      execFileSync('git', ['init', '-q'], { cwd: root });
      execFileSync('git', ['config', 'core.hooksPath', '/dev/null'], { cwd: root });
      await expect(assertSafeGit(root, execution)).resolves.toBeUndefined();
      execFileSync('git', ['config', 'filter.private.clean', 'sh bad.sh'], { cwd: root });
      await expect(assertSafeGit(root, execution)).rejects.toThrow('Git filters');
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
