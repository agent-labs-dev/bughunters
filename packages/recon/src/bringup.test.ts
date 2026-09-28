import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { detectBringUp } from './bringup.js';

it('discovers existing CI startup commands in the ESM package', () => {
  const root = mkdtempSync(join(tmpdir(), 'bh-bringup-'));
  try {
    mkdirSync(join(root, '.github/workflows'), { recursive: true });
    writeFileSync(join(root, '.github/workflows/ci.yml'), 'steps:\n  - run: pnpm run dev\n');
    expect(detectBringUp(root)).toMatchObject([{ command: 'pnpm run dev', rung: 'precedent' }]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
