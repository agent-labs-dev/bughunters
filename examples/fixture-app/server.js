// A deliberately tiny app used as AutoQA's own test subject.
//
// It exists to make the M0 and M3 acceptance criteria checkable:
//   M0 - changing BREAK=color produces exactly one failing Check
//   M3 - three consecutive runs with no change produce zero diffs
//
// Every source of non-determinism a real app has (a clock, randomness, a
// web font, an animation) is present on purpose, so the determinism contract
// is exercised rather than assumed.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 3000);

// Set BREAK to inject a known defect. Each value maps to exactly one detector,
// which is what makes the fixture usable as a scoring corpus.
//   color     -> pixel diff only
//   occlusion -> layout/occlusion
//   contrast  -> usability/contrast
//   tiny      -> usability/tap-target
//   overflow  -> layout/overflow
const BREAK = process.env.BREAK ?? '';

const routes = {
  '/': 'index.html',
  '/settings': 'settings.html',
};

createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${port}`);
  const file = routes[url.pathname];
  if (!file) {
    res.writeHead(404, { 'content-type': 'text/html' });
    res.end('<h1>Not found</h1>');
    return;
  }
  const html = readFileSync(join(here, file), 'utf8').replaceAll('{{BREAK}}', BREAK);
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
}).listen(port, () => {
  process.stdout.write(`fixture-app on http://localhost:${port}${BREAK ? ` (BREAK=${BREAK})` : ''}\n`);
});
