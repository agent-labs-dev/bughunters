import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveArtifactPath } from './server.js';

let root: string;
let outside: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bughunters-dash-'));
  outside = mkdtempSync(join(tmpdir(), 'bughunters-secret-'));
  mkdirSync(join(root, '.bughunters', 'runs', 'latest'), { recursive: true });
  writeFileSync(join(root, '.bughunters', 'runs', 'latest', 'shot.png'), 'png');
  writeFileSync(join(root, '.bughunters', 'runs', 'latest', 'run.json'), '{}');
  writeFileSync(join(root, '.bughunters', 'notes.txt'), 'plain text');
  writeFileSync(join(root, '.env'), 'SECRET=1');
  writeFileSync(join(outside, 'id_rsa'), 'PRIVATE KEY');
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

describe('resolveArtifactPath', () => {
  it('serves an artifact inside .bughunters', () => {
    expect(resolveArtifactPath(root, '.bughunters/runs/latest/shot.png')).toBeDefined();
  });

  it('rejects a relative traversal out of the project', () => {
    expect(resolveArtifactPath(root, '../../../etc/passwd')).toBeUndefined();
  });

  it('rejects a traversal that starts inside .bughunters', () => {
    expect(resolveArtifactPath(root, '.bughunters/runs/../../../etc/passwd')).toBeUndefined();
  });

  it('rejects an absolute path', () => {
    expect(resolveArtifactPath(root, join(outside, 'id_rsa'))).toBeUndefined();
  });

  it('rejects a file inside the project but outside .bughunters', () => {
    // The project root holds .env and source; only the artifact directory is served.
    expect(resolveArtifactPath(root, '.env')).toBeUndefined();
  });

  it('rejects a non-artifact extension even inside .bughunters', () => {
    expect(resolveArtifactPath(root, '.bughunters/notes.txt')).toBeUndefined();
  });

  it('rejects a symlink that escapes the artifact directory', () => {
    // Containment is checked on the RESOLVED path, so a symlink pointing at a
    // key outside the tree does not become a readable "artifact".
    const link = join(root, '.bughunters', 'escape.png');
    symlinkSync(join(outside, 'id_rsa'), link);
    expect(resolveArtifactPath(root, '.bughunters/escape.png')).toBeUndefined();
  });

  it('rejects a directory', () => {
    expect(resolveArtifactPath(root, '.bughunters/runs')).toBeUndefined();
  });

  it('rejects a path that does not exist', () => {
    expect(resolveArtifactPath(root, '.bughunters/runs/latest/missing.png')).toBeUndefined();
  });
});
