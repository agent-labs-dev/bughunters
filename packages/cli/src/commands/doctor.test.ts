import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseConfig } from '@bughunters/core';
import { runChecks } from './doctor.js';

function project(): string {
  const root = mkdtempSync(join(tmpdir(), 'bughunters-doctor-'));
  mkdirSync(join(root, '.bughunters'));
  writeFileSync(join(root, '.bughunters', 'bughunters.yml'), 'version: 1\n');
  return root;
}

describe('runChecks', () => {
  it('checks each agent LLM, and leaves out the gate checks without a run block', () => {
    const config = parseConfig({ version: 1, app: { connect: { url: 'http://localhost:3000' } }, agents: { explorer: { use: { runtime: 'model', via: 'openrouter' } } } });
    const checks = runChecks(project(), config);
    const names = checks.map((check) => check.name);
    expect(names).toEqual(expect.arrayContaining(['config', 'node', 'explorer', 'judge']));
    expect(names).not.toContain('decider');
    expect(names).not.toContain('fixer');
    expect(names).not.toContain('pinned-image');
    expect(names).not.toContain('app-model');
    const explorer = checks.find((check) => check.name === 'explorer')!;
    expect(explorer.ok).toBe(false);
    expect(explorer.detail).toContain('OPENROUTER_API_KEY is not set');
  });

  it('keeps the gate checks for a gate config', () => {
    const config = parseConfig({ version: 1, run: { command: 'npm run dev', url: 'http://localhost:3000' } });
    expect(runChecks(project(), config).map((check) => check.name)).toContain('pinned-image');
  });
});
