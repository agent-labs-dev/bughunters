// A deliberately tiny app used as Bugpatrol's own test subject.
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
const port = Number(process.env.PORT ?? 3300);

// Set BREAK to inject a known defect. Each value maps to exactly one detector,
// which is what makes this a scoring corpus rather than a demo: a run against
// BREAK=contrast should produce one finding, from one rule.
const BREAKS = {
  // A pure repaint: no geometry moves, so only the pixel diff can catch it.
  color: 'button { background: #d81b60 !important; }',
  // The sticky footer stretches to full height and swallows the page, so the
  // primary action is still painted but no longer reachable at its centre point.
  occlusion: 'footer { top: 0 !important; }',
  contrast: '.card p, .card h2 { color: #cdd1d8 !important; }',
  tiny: '[data-testid=save] { width: 12px !important; height: 12px !important; padding: 0 !important; font-size: 0 !important; }',
  clipped: '.card { width: 150px !important; overflow: hidden !important; white-space: nowrap !important; }',
};

const BREAK = process.env.BREAK ?? '';
if (BREAK && !(BREAK in BREAKS)) {
  process.stderr.write(`unknown BREAK=${BREAK}; expected one of ${Object.keys(BREAKS).join(', ')}\n`);
  process.exit(2);
}
const BREAK_STYLE = BREAK ? BREAKS[BREAK] : '';

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
  const html = readFileSync(join(here, file), 'utf8').replaceAll('{{BREAK_STYLE}}', BREAK_STYLE);
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
}).listen(port, () => {
  process.stdout.write(`fixture-app on http://localhost:${port}${BREAK ? ` (BREAK=${BREAK})` : ''}\n`);
});
