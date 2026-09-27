import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
const exec = promisify(execFile);
export function validateRelease(version, sha) {
  assert.match(version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/, 'Use an explicit stable version, e.g. 0.2.0');
  assert.match(sha, /^[a-f0-9]{40}$/, 'A full source commit is required');
}
export function newerThan(version, previous) {
  const a = version.split('.').map(Number); const b = previous.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
/** Every retry must describe the same source and exact tarball. */
export async function publishRelease(input, io) {
  validateRelease(input.version, input.sha);
  const tag = `v${input.version}`;
  const existingTag = await io.getTag(tag);
  if (existingTag) assert.equal(existingTag, input.sha, 'Release tag points at different source');
  const published = await io.getPackage(input.version);
  if (published) {
    assert.equal(published.bughuntersSource, input.sha, 'Published version has different source');
    assert.equal(published.dist?.integrity, input.integrity, 'Published version has different package bytes');
  } else {
    const latest = await io.getPackage('latest');
    if (latest) assert(newerThan(input.version, latest.version), 'A new stable release must be newer than latest');
  }
  if (!existingTag) await io.createTag(tag, input.sha);
  if (!published) {
    await io.publish(input.tarball);
    const confirmed = await io.getPackage(input.version);
    assert.equal(confirmed?.dist?.integrity, input.integrity, 'Registry did not confirm the uploaded package');
    assert.equal(confirmed?.bughuntersSource, input.sha, 'Registry did not confirm the source commit');
  }
  await io.ensureRelease(tag, input.tarball);
}

const run = async (command, args) => (await exec(command, args, { maxBuffer: 8 * 1024 * 1024, timeout: 180_000 })).stdout.trim();
async function optional(command, args) {
  try { return JSON.parse(await run(command, args)); }
  catch (error) {
    if (/HTTP 404|E404/.test(`${error.stdout ?? ''}\n${error.stderr ?? ''}`)) return undefined;
    throw error;
  }
}
async function main() {
  const version = process.env.RELEASE_VERSION ?? '';
  const sha = process.env.GITHUB_SHA ?? '';
  validateRelease(version, sha);
  assert.equal(process.env.GITHUB_REF, 'refs/heads/main', 'Release from main only');
  const repo = process.env.GITHUB_REPOSITORY;
  assert.match(repo ?? '', /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/);
  const source = JSON.parse(await run('gh', ['api', `repos/${repo}/commits/${sha}`]));
  assert.equal(source.commit.verification.verified, true, 'Source commit must have a GitHub Verified signature');
  if (process.argv[2] === 'prepare') {
    const file = 'packages/bughunters/package.json';
    const pkg = JSON.parse(await readFile(file, 'utf8'));
    pkg.version = version; pkg.bughuntersSource = sha;
    await writeFile(file, `${JSON.stringify(pkg, null, 2)}\n`);
    return;
  }
  assert.equal(process.argv[2], 'publish');
  const tarball = resolve(process.argv[3] ?? '');
  const bytes = await readFile(tarball);
  const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
  const assetDigest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  await publishRelease({ version, sha, tarball, integrity }, {
    getTag: async tag => (await optional('gh', ['api', `repos/${repo}/git/ref/tags/${tag}`]))?.object.sha,
    createTag: (tag, commit) => run('gh', ['api', '-X', 'POST', `repos/${repo}/git/refs`, '-f', `ref=refs/tags/${tag}`, '-f', `sha=${commit}`]),
    getPackage: release => optional('npm', ['view', `bughunters@${release}`, '--json']),
    publish: file => run('npm', ['publish', file, '--provenance', '--access', 'public']),
    ensureRelease: async (tag, file) => {
      const release = await optional('gh', ['api', `repos/${repo}/releases/tags/${tag}`]);
      if (!release) await run('gh', ['release', 'create', tag, file, '--repo', repo, '--verify-tag', '--generate-notes']);
      else {
        const asset = release.assets.find(item => item.name === basename(file));
        if (asset) assert.equal(asset.digest, assetDigest, 'Existing release asset has different bytes');
        else await run('gh', ['release', 'upload', tag, file, '--repo', repo]);
      }
    },
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
