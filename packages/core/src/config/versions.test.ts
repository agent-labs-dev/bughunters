import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
it('keeps the browser packages and digest-pinned runner image in sync', () => {
  const root = new URL('../../../../', import.meta.url);
  const version = (name: string) => JSON.parse(readFileSync(new URL(`packages/${name}/package.json`, root), 'utf8')).dependencies.playwright as string;
  const capture = version('capture');
  expect(version('drivers')).toBe(capture);
  expect(version('bughunters')).toBe(capture);
  const docker = readFileSync(new URL('images/runner/Dockerfile', root), 'utf8');
  expect(docker).toMatch(new RegExp(`FROM mcr\\.microsoft\\.com/playwright:v${capture.replaceAll('.', '\\.')}(-noble|-jammy)@sha256:[a-f0-9]{64}`));
});
