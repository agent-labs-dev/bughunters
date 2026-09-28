import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from './config/load.js';
import { findProjectRoot, instructionsPath, legacyLayout, paths } from './paths.js';

function project(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'bugpatrol-paths-')));
  mkdirSync(join(root, '.bugpatrol'));
  writeFileSync(paths.config(root), 'version: 1\n');
  return root;
}

describe('paths', () => {
  it('keeps the config in .bugpatrol/ and all local data in .bugpatrol/runs/', () => {
    const root = '/repo';
    expect(paths.config(root)).toBe('/repo/.bugpatrol/bugpatrol.yml');
    for (const file of [
      paths.issue(root, 'i'),
      paths.session(root, 's'),
      paths.worktrees(root),
      paths.memory(root),
      paths.run(root, 'r'),
      paths.baselines(root),
      paths.publish(root),
    ]) {
      expect(file.startsWith('/repo/.bugpatrol/runs/')).toBe(true);
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
    const start = realpathSync(mkdtempSync(join(tmpdir(), 'bugpatrol-none-')));
    expect(findProjectRoot(start)).toBe(start);
  });
});

describe('instructionsPath', () => {
  it('uses app.instructions, else .bugpatrol/instructions.md when it exists', () => {
    const root = project();
    expect(instructionsPath(root)).toBeUndefined();
    writeFileSync(join(root, '.bugpatrol', 'instructions.md'), '# App\n');
    expect(instructionsPath(root)).toBe(join(root, '.bugpatrol', 'instructions.md'));
    expect(instructionsPath(root, 'docs/guide.md')).toBe(join(root, 'docs', 'guide.md'));
  });
});

describe('layout', () => {
  it('keeps .bughunters/bughunters.yml in a repo from before the rename', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'bugpatrol-legacy-')));
    mkdirSync(join(root, '.bughunters'));
    writeFileSync(join(root, '.bughunters', 'bughunters.yml'), 'version: 1\napp: { connect: { url: "http://x" } }\n');
    expect(paths.config(root)).toBe(join(root, '.bughunters', 'bughunters.yml'));
    expect(paths.memory(root)).toBe(join(root, '.bughunters', 'runs', 'memory.json'));
    mkdirSync(join(root, 'src'));
    expect(findProjectRoot(join(root, 'src'))).toBe(root);
    expect(loadConfig(root).app.connect?.url).toBe('http://x');
  });

  it('uses .bugpatrol/ when both folders have a config', () => {
    const root = project();
    mkdirSync(join(root, '.bughunters'));
    writeFileSync(join(root, '.bughunters', 'bughunters.yml'), 'version: 1\n');
    expect(paths.config(root)).toBe(join(root, '.bugpatrol', 'bugpatrol.yml'));
  });
});

describe('legacyLayout', () => {
  it('tells how to move a bughunters.yml at the root into .bugpatrol/', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'bugpatrol-old-')));
    expect(legacyLayout(root)).toBeUndefined();
    writeFileSync(join(root, 'bughunters.yml'), 'version: 1\n');
    expect(legacyLayout(root)).toContain('mv bughunters.yml .bugpatrol/bugpatrol.yml');
    expect(() => loadConfig(root)).toThrow(/now keeps its config in \.bugpatrol/);
  });
});

it('rejects an id that is not one path segment at each file-backed record', () => {
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
    for (const value of ['../private', '/absolute', '..', '.', 'x/y', 'x\\y', 'x\0y', '']) {
      expect(() => reader('/project', value)).toThrow('Invalid workspace record');
    }
    for (const value of ['ses_20260927_ab12', '__start', 'settings.usage'])
      expect(reader('/project', value)).toContain(value);
  }
});
