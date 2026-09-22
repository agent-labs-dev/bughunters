import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveArtifactPath } from './server.js';

let root: string;
let outside: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'autoqa-dash-'));
  outside = mkdtempSync(join(tmpdir(), 'autoqa-secret-'));
  mkdirSync(join(root, '.autoqa', 'runs', 'latest'), { recursive: true });
  writeFileSync(join(root, '.autoqa', 'runs', 'latest', 'shot.png'), 'png');
  writeFileSync(join(root, '.autoqa', 'runs', 'latest', 'run.json'), '{}');
  writeFileSync(join(root, '.autoqa', 'notes.txt'), 'plain text');
  writeFileSync(join(root, '.env'), 'SECRET=1');
  writeFileSync(join(outside, 'id_rsa'), 'PRIVATE KEY');
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

describe('resolveArtifactPath', () => {
  it('serves an artifact inside .autoqa', () => {
    expect(resolveArtifactPath(root, '.autoqa/runs/latest/shot.png')).toBeDefined();
  });

  it('rejects a relative traversal out of the project', () => {
    expect(resolveArtifactPath(root, '../../../etc/passwd')).toBeUndefined();
  });

  it('rejects a traversal that starts inside .autoqa', () => {
    expect(resolveArtifactPath(root, '.autoqa/runs/../../../etc/passwd')).toBeUndefined();
  });

  it('rejects an absolute path', () => {
    expect(resolveArtifactPath(root, join(outside, 'id_rsa'))).toBeUndefined();
  });

  it('rejects a file inside the project but outside .autoqa', () => {
    // The project root holds .env and source; only the artifact directory is served.
    expect(resolveArtifactPath(root, '.env')).toBeUndefined();
  });

  it('rejects a non-artifact extension even inside .autoqa', () => {
    expect(resolveArtifactPath(root, '.autoqa/notes.txt')).toBeUndefined();
  });

  it('rejects a symlink that escapes the artifact directory', () => {
    // Containment is checked on the RESOLVED path, so a symlink pointing at a
    // key outside the tree does not become a readable "artifact".
    const link = join(root, '.autoqa', 'escape.png');
    symlinkSync(join(outside, 'id_rsa'), link);
    expect(resolveArtifactPath(root, '.autoqa/escape.png')).toBeUndefined();
  });

  it('rejects a directory', () => {
    expect(resolveArtifactPath(root, '.autoqa/runs')).toBeUndefined();
  });

  it('rejects a path that does not exist', () => {
    expect(resolveArtifactPath(root, '.autoqa/runs/latest/missing.png')).toBeUndefined();
  });
});
