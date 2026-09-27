import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
const exec = promisify(execFile);
const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const temp = await mkdtemp(join(tmpdir(), 'bughunters-package-'));
let dashboard;
const app = createServer((_req, res) => { res.setHeader('content-type', 'text/html'); res.end('<html><body style="font-family:Arial;background:white;color:black"><h1>Package test</h1></body></html>'); });
try {
  const { stdout } = await exec('npm', ['pack', '--json', '--pack-destination', temp], { cwd: join(repo, 'packages/bughunters') });
  const [packed] = JSON.parse(stdout);
  const names = packed.files.map(file => file.path);
  for (const file of ['LICENSE', 'NOTICE', 'README.md', 'dist/bin.js', 'src/ui/index.html', 'src/ui/app.js']) assert(names.includes(file), `Missing ${file}`);
  assert(!names.some(name => /(^|\/)(node_modules|\.env|.*\.test\.)/.test(name)), 'Unexpected development/private files');
  await writeFile(join(temp, 'package.json'), '{"private":true}');
  await exec('npm', ['install', '--omit=dev', '--no-audit', '--no-fund', join(temp, packed.filename)], { cwd: temp, timeout: 180_000 });
  const installed = join(temp, 'node_modules/bughunters');
  for (const file of ['LICENSE', 'NOTICE']) assert.equal(await readFile(join(installed, file), 'utf8'), await readFile(join(repo, file), 'utf8'));
  const pkg = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'));
  assert(!Object.values(pkg.dependencies).some(version => version.startsWith('workspace:')));
  const bin = join(installed, 'dist/bin.js');
  const cli = (...args) => exec(process.execPath, [bin, ...args], { cwd: temp, timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
  assert.equal((await cli('--version')).stdout.trim(), pkg.version);
  assert.match((await cli('--help')).stdout, /bughunters/);
  dashboard = spawn(process.execPath, [bin, 'dashboard', '--port', '0'], { cwd: temp, stdio: ['ignore', 'pipe', 'pipe'] });
  const url = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`Dashboard did not start: ${output}`)), 10_000);
    dashboard.once('error', error => { clearTimeout(timer); reject(error); });
    dashboard.once('exit', () => { clearTimeout(timer); reject(new Error(`Dashboard exited: ${output}`)); });
    const read = chunk => {
      output += chunk.toString();
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) { clearTimeout(timer); resolve(match[0]); }
    };
    dashboard.stdout.on('data', read); dashboard.stderr.on('data', read);
  });
  assert.match(await (await fetch(url)).text(), /<html/i);
  const asset = await fetch(`${url}/app.js`); assert.equal(asset.status, 200); assert((await asset.text()).length > 100);
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  await mkdir(join(temp, '.bughunters'));
  await writeFile(join(temp, '.bughunters/bughunters.yml'), `version: 1\nrun:\n  command: unused\n  url: http://127.0.0.1:${app.address().port}\nviewports:\n  - { name: desktop, width: 400, height: 300 }\ndeterminism:\n  failOnFontFallback: false\n`);
  await cli('baseline', 'update', '--no-models');
  await cli('run', '--all', '--no-models');
  console.log(`Installed package ${pkg.version}: notices, CLI, dashboard and real browser gate passed.`);
} finally {
  if (dashboard && dashboard.exitCode === null) {
    const closed = once(dashboard, 'close'); dashboard.kill('SIGTERM');
    const timer = setTimeout(() => dashboard.kill('SIGKILL'), 1_000);
    await closed; clearTimeout(timer);
  }
  app.closeAllConnections(); if (app.listening) await new Promise(resolve => app.close(resolve));
  await rm(temp, { recursive: true, force: true });
}
