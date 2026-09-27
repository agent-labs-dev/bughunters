import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publishRelease, validateRelease } from './release.mjs';
const input = { version: '0.2.0', sha: 'a'.repeat(40), tarball: 'bughunters-0.2.0.tgz', integrity: 'sha512-test' };
function fixture() {
  const calls = []; let tag; let pkg; let failRelease = false;
  const io = {
    async getTag() { return tag; }, async createTag(_tag, sha) { calls.push('tag'); tag = sha; },
    async getPackage(version) { return version === 'latest' ? { version: '0.1.0' } : pkg; },
    async publish() { calls.push('npm'); pkg = { bughuntersSource: input.sha, dist: { integrity: input.integrity } }; },
    async ensureRelease() { calls.push('release'); if (failRelease) throw new Error('GitHub unavailable'); },
  };
  return { calls, io, setTag(value) { tag = value; }, setPackage(value) { pkg = value; }, fail(value) { failRelease = value; } };
}
test('reserves source before publishing and resumes after a GitHub release failure', async () => {
  const f = fixture(); f.fail(true);
  await assert.rejects(publishRelease(input, f.io), /GitHub unavailable/);
  assert.deepEqual(f.calls, ['tag', 'npm', 'release']);
  f.fail(false); await publishRelease(input, f.io);
  assert.deepEqual(f.calls, ['tag', 'npm', 'release', 'release']);
});
test('refuses conflicting tags and packages without publishing again', async () => {
  const f = fixture(); f.setTag('b'.repeat(40));
  await assert.rejects(publishRelease(input, f.io), /different source/);
  assert.deepEqual(f.calls, []);
  f.setTag(input.sha); f.setPackage({ bughuntersSource: input.sha, dist: { integrity: 'wrong' } });
  await assert.rejects(publishRelease(input, f.io), /different package bytes/);
  assert.deepEqual(f.calls, []);
});
test('rejects version injection, malformed sources and accidental stable downgrades', async () => {
  assert.throws(() => validateRelease('0.2.0; echo bad', input.sha));
  assert.throws(() => validateRelease('0.2.0', 'main'));
  const f = fixture(); await assert.rejects(publishRelease({ ...input, version: '0.0.9' }, f.io), /newer/);
  assert(!f.calls.includes('npm'));
});
