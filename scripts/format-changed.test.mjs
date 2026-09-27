import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formattableFiles } from './format-changed.mjs';
test('formats unique source paths, including spaces, without generated output', () => {
  assert.deepEqual(
    formattableFiles([
      'a file.ts',
      'a file.ts',
      'a.mts',
      'dist/a.js',
      'node_modules/a.js',
      '.bughunters/runs/secret.json',
      'pnpm-lock.yaml',
      'packages/bughunters/src/ui/app.js',
      'image.png',
      'docs/a.md',
    ]),
    ['a file.ts', 'a.mts', 'docs/a.md'],
  );
});
