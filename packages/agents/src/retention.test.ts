import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { paths } from '@bughunters/core';
import { pruneArtifacts } from './retention.js';
it('previews retention and preserves referenced, live, corrupt and baseline data', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bh-retention-'));
  try {
    for (const id of ['old', 'kept', 'live', 'corrupt']) {
      const dir = paths.session(root, id); await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'session.json'), id === 'corrupt' ? '{broken' : JSON.stringify({ status: id === 'live' ? 'running' : 'finished', endedAt: '2020-01-01T00:00:00Z' }));
    }
    await writeFile(join(paths.data(root), 'appmap.json'), JSON.stringify({ screenshot: '.bughunters/runs/sessions/kept/image.png' }));
    await mkdir(paths.baselines(root)); await writeFile(join(paths.baselines(root), 'keep'), 'baseline');
    await symlink(paths.baselines(root), paths.session(root, 'escape'));
    const preview = await pruneArtifacts(root, { olderThanDays: 30 });
    expect(preview.map(item => item.path)).toEqual(['.bughunters/runs/sessions/old']);
    expect(await readFile(join(paths.session(root, 'old'), 'session.json'), 'utf8')).toContain('finished');
    expect(await pruneArtifacts(root, { olderThanDays: 30, apply: true })).toEqual(preview);
    await expect(readFile(join(paths.session(root, 'old'), 'session.json'))).rejects.toThrow();
    expect(await readFile(join(paths.baselines(root), 'keep'), 'utf8')).toBe('baseline');
    await writeFile(join(paths.data(root), 'appmap.json'), '{bad');
    await expect(pruneArtifacts(root, { olderThanDays: 30, apply: true })).rejects.toThrow();
    await expect(pruneArtifacts(root, { olderThanDays: 0 })).rejects.toThrow('positive');
  } finally { await rm(root, { recursive: true, force: true }); }
});
