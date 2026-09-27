import { readFileSync, readdirSync } from 'node:fs';
import { expect, it } from 'vitest';
it('pins external workflow actions and keeps privileged PR triggers out of CI', () => {
  const dir = new URL('../../../../.github/workflows/', import.meta.url);
  for (const file of readdirSync(dir).filter(name => /\.ya?ml$/.test(name))) {
    const source = readFileSync(new URL(file, dir), 'utf8');
    expect(source).not.toContain('pull_request_target:');
    for (const match of source.matchAll(/uses:\s*([^\s#]+)/g)) {
      if (!match[1]!.startsWith('./')) expect(match[1]).toMatch(/@[a-f0-9]{40}$/);
    }
  }
});
