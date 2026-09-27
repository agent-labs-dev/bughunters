import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { readEvidence } from './evidence.js';
it('rejects traversal, symlinks to host files, and non-image evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bh-evidence-'));
  try {
    const data = join(root, '.bughunters/runs'); await mkdir(data, { recursive: true });
    await writeFile(join(root, 'private.png'), 'secret');
    await symlink(join(root, 'private.png'), join(data, 'link.png'));
    await writeFile(join(data, 'bad.png'), 'not an image');
    await expect(readEvidence(root, 'private.png')).rejects.toThrow('inside');
    await expect(readEvidence(root, '.bughunters/runs/link.png')).rejects.toThrow('inside');
    await expect(readEvidence(root, '.bughunters/runs/bad.png')).rejects.toThrow('PNG');
  } finally { await rm(root, { recursive: true, force: true }); }
});
