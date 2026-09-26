import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeInitialConfig } from './init.js';
import { parseConfig } from '@bughunters/core';
import { parse } from 'yaml';

function fixtureRepo(pkg: Record<string, unknown> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'bughunters-init-'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { dev: 'vite' }, ...pkg }));
  writeFileSync(join(root, 'pnpm-lock.yaml'), '');
  writeFileSync(join(root, 'vite.config.ts'), '');
  mkdirSync(join(root, '.github'), { recursive: true });
  return root;
}

describe('writeInitialConfig', () => {
  it('writes a config that parses against the schema', () => {
    const root = fixtureRepo();
    const { configPath } = writeInitialConfig(root);
    const raw = parse(readFileSync(configPath, 'utf8'));
    expect(() => parseConfig(raw)).not.toThrow();
  });

  it('detects the framework and the bring-up command with provenance', () => {
    const root = fixtureRepo();
    const { stack, configPath } = writeInitialConfig(root);
    expect(stack.framework).toBe('vite');
    expect(stack.packageManager).toBe('pnpm');
    const text = readFileSync(configPath, 'utf8');
    expect(text).toContain('pnpm run dev');
    expect(text).toContain('detected from package.json');
  });

  it('marks what it could not determine with TODO rather than guessing silently', () => {
    const root = fixtureRepo({ scripts: {} });
    const { configPath, notes } = writeInitialConfig(root);
    expect(readFileSync(configPath, 'utf8')).toContain('TODO');
    expect(notes.join(' ')).toContain('bring-up command');
  });

  it('ships conservative defaults: no fix PRs, no mutations, exact tolerance', () => {
    const root = fixtureRepo();
    const { configPath } = writeInitialConfig(root);
    const config = parseConfig(parse(readFileSync(configPath, 'utf8')));
    expect(config.surfaces.fixPRs).toBe(false);
    expect(config.production.allowMutations).toBe(false);
    expect(config.tolerance.default).toBe('exact');
  });

  it('writes a least-privilege workflow', () => {
    const root = fixtureRepo();
    const { workflowPath } = writeInitialConfig(root);
    const workflow = readFileSync(workflowPath, 'utf8');
    expect(workflow).toContain('contents: read');
    expect(workflow).not.toContain('contents: write');
  });

  it('never overwrites an existing config', () => {
    const root = fixtureRepo();
    writeFileSync(join(root, 'bughunters.yml'), '# mine\n');
    const { notes } = writeInitialConfig(root);
    expect(readFileSync(join(root, 'bughunters.yml'), 'utf8')).toBe('# mine\n');
    expect(notes.join(' ')).toContain('left untouched');
  });
});
