import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findProjectRoot, instructionsPath, legacyLayout, paths } from './paths.js';
import { loadConfig } from './config/load.js';

function project(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'bughunters-paths-')));
  mkdirSync(join(root, '.bughunters'));
  writeFileSync(paths.config(root), 'version: 1\n');
  return root;
}

describe('paths', () => {
  it('keeps the config in .bughunters/ and all local data in .bughunters/runs/', () => {
    const root = '/repo';
    expect(paths.config(root)).toBe('/repo/.bughunters/bughunters.yml');
    for (const file of [
      paths.issue(root, 'i'),
      paths.session(root, 's'),
      paths.worktrees(root),
      paths.memory(root),
      paths.run(root, 'r'),
      paths.baselines(root),
      paths.publish(root),
    ]) {
      expect(file.startsWith('/repo/.bughunters/runs/')).toBe(true);
    }
  });
});

describe('findProjectRoot', () => {
  it('finds the project from a subfolder, the way git does', () => {
    const root = project();
    mkdirSync(join(root, 'src', 'deep'), { recursive: true });
    expect(findProjectRoot(join(root, 'src', 'deep'))).toBe(root);
    expect(findProjectRoot(root)).toBe(root);
  });

  it('returns the start folder when no project is above it', () => {
    const start = realpathSync(mkdtempSync(join(tmpdir(), 'bughunters-none-')));
    expect(findProjectRoot(start)).toBe(start);
  });
});

describe('instructionsPath', () => {
  it('uses app.instructions, else .bughunters/instructions.md when it exists', () => {
    const root = project();
    expect(instructionsPath(root)).toBeUndefined();
    writeFileSync(join(root, '.bughunters', 'instructions.md'), '# App\n');
    expect(instructionsPath(root)).toBe(join(root, '.bughunters', 'instructions.md'));
    expect(instructionsPath(root, 'docs/guide.md')).toBe(join(root, 'docs', 'guide.md'));
  });
});

describe('legacyLayout', () => {
  it('tells how to move a bughunters.yml at the root into .bughunters/', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'bughunters-old-')));
    expect(legacyLayout(root)).toBeUndefined();
    writeFileSync(join(root, 'bughunters.yml'), 'version: 1\n');
    expect(legacyLayout(root)).toContain('mv bughunters.yml instructions.md .bughunters/');
    expect(() => loadConfig(root)).toThrow(/now keeps its config in \.bughunters/);
  });
});

it('rejects caller-controlled paths at every file-backed record boundary', () => {
  const readers = [
    paths.run,
    paths.session,
    paths.routine,
    paths.issue,
    paths.fix,
    paths.agentBaseline,
    paths.agentBaselineSnapshot,
  ];
  for (const reader of readers) {
    for (const value of ['../private', '/absolute', '..', 'x/y', 'x\\y', 'x\0y', '']) {
      expect(() => reader('/project', value)).toThrow('Invalid workspace record');
    }
    expect(reader('/project', 'ses_20260927_ab12')).toContain('ses_20260927_ab12');
  }
});
