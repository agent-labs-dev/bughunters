import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveArtifactPath } from './server.js';

let root: string;
let outside: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bugpatrol-dash-'));
  outside = mkdtempSync(join(tmpdir(), 'bugpatrol-secret-'));
  mkdirSync(join(root, '.bugpatrol', 'runs', 'latest'), { recursive: true });
  writeFileSync(join(root, '.bugpatrol', 'runs', 'latest', 'shot.png'), 'png');
  writeFileSync(join(root, '.bugpatrol', 'runs', 'latest', 'run.json'), '{}');
  writeFileSync(join(root, '.bugpatrol', 'notes.txt'), 'plain text');
  writeFileSync(join(root, '.env'), 'SECRET=1');
  writeFileSync(join(outside, 'id_rsa'), 'PRIVATE KEY');
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

describe('resolveArtifactPath', () => {
  it('serves an artifact inside .bugpatrol', () => {
    expect(resolveArtifactPath(root, '.bugpatrol/runs/latest/shot.png')).toBeDefined();
  });

  it('rejects a relative traversal out of the project', () => {
    expect(resolveArtifactPath(root, '../../../etc/passwd')).toBeUndefined();
  });

  it('rejects a traversal that starts inside .bugpatrol', () => {
    expect(resolveArtifactPath(root, '.bugpatrol/runs/../../../etc/passwd')).toBeUndefined();
  });

  it('rejects an absolute path', () => {
    expect(resolveArtifactPath(root, join(outside, 'id_rsa'))).toBeUndefined();
  });

  it('rejects a file inside the project but outside .bugpatrol', () => {
    // The project root holds .env and source; only the artifact directory is served.
    expect(resolveArtifactPath(root, '.env')).toBeUndefined();
  });

  it('rejects a non-artifact extension even inside .bugpatrol', () => {
    expect(resolveArtifactPath(root, '.bugpatrol/notes.txt')).toBeUndefined();
  });

  it('rejects a symlink that escapes the artifact directory', () => {
    // Containment is checked on the RESOLVED path, so a symlink pointing at a
    // key outside the tree does not become a readable "artifact".
    const link = join(root, '.bugpatrol', 'escape.png');
    symlinkSync(join(outside, 'id_rsa'), link);
    expect(resolveArtifactPath(root, '.bugpatrol/escape.png')).toBeUndefined();
  });

  it('rejects a directory', () => {
    expect(resolveArtifactPath(root, '.bugpatrol/runs')).toBeUndefined();
  });

  it('rejects a path that does not exist', () => {
    expect(resolveArtifactPath(root, '.bugpatrol/runs/latest/missing.png')).toBeUndefined();
  });
});

describe('dashboard project isolation', () => {
  it('rejects traversal and symlinked run records', async () => {
    const { ProjectReader } = await import('./project.js');
    const reader = new ProjectReader(root);
    writeFileSync(join(outside, 'run.json'), JSON.stringify({ run: { id: 'outside' }, findings: [] }));
    mkdirSync(join(root, '.bugpatrol/runs/gate'), { recursive: true });
    symlinkSync(outside, join(root, '.bugpatrol/runs/gate/linked'));
    expect(reader.readRun(outside)).toBeUndefined();
    expect(reader.readRun('../../outside')).toBeUndefined();
    expect(reader.readRun('linked')).toBeUndefined();
    mkdirSync(join(root, '.bugpatrol/runs/gate/valid'));
    symlinkSync(join(outside, 'run.json'), join(root, '.bugpatrol/runs/gate/valid/run.json'));
    expect(reader.readRun('valid')).toBeUndefined();
  });

  it('rejects untrusted hosts and remote bindings', async () => {
    const { startDashboard } = await import('./server.js');
    const { request } = await import('node:http');
    await expect(startDashboard({ root, host: '0.0.0.0' })).rejects.toThrow('loopback');
    const dashboard = await startDashboard({ root, port: 0 });
    try {
      const status = await new Promise((resolve, reject) => {
        const req = request(dashboard.url + '/api/state', { headers: { host: 'attacker.example' } }, (res) => {
          res.resume(); res.once('end', () => resolve(res.statusCode));
        });
        req.once('error', reject); req.end();
      });
      expect(status).toBe(403);
      expect((await fetch(dashboard.url + '/api/state')).status).toBe(200);
      expect((await fetch(dashboard.url + '/api/state', { headers: { origin: 'https://attacker.example' } })).status).toBe(403);
    } finally { await dashboard.close(); }
  });
});
