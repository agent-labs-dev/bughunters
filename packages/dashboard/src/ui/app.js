// AutoQA dashboard. Vanilla ES modules on purpose: no build step means the UI
// is served straight from source, so `autoqa dashboard` works from a clone with
// nothing compiled but the CLI itself.

const view = document.getElementById('view');
const tabs = document.getElementById('tabs');
const liveEl = document.getElementById('live');
const rootEl = document.getElementById('root');

const state = {
  view: 'runs',
  runs: [],
  selectedRunId: null,
  detail: null,
  graph: null,
  live: null,
  root: '',
};

// ---------------------------------------------------------------- data

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} -> ${response.status}`);
  return response.json();
}

const artifact = (path) => `/api/artifact?path=${encodeURIComponent(path)}`;

async function refresh({ keepSelection = true } = {}) {
  const snapshot = await getJson('/api/state');
  state.runs = snapshot.runs;
  state.live = snapshot.live;
  state.root = snapshot.root;
  rootEl.textContent = snapshot.root;

  // Follow the newest run unless the user has deliberately pinned an older one.
  const stillExists = state.runs.some((r) => r.id === state.selectedRunId);
  if (!keepSelection || !stillExists) state.selectedRunId = state.runs[0]?.id ?? null;

  if (state.view === 'runs' && state.selectedRunId) {
    state.detail = await getJson(`/api/runs/${encodeURIComponent(state.selectedRunId)}`);
  }
  if (state.view === 'graph') {
    state.graph = await getJson('/api/graph');
  }
  render();
}

function connectLive() {
  const source = new EventSource('/api/events');
  source.addEventListener('changed', () => refresh());
  source.onopen = () => liveEl.classList.remove('stale');
  source.onerror = () => liveEl.classList.add('stale');
}

// ---------------------------------------------------------------- render

function render() {
  for (const button of tabs.querySelectorAll('button')) {
    button.classList.toggle('active', button.dataset.view === state.view);
  }
  view.innerHTML = '';
  const banner = renderLiveBanner();
  if (banner) view.append(banner);
  view.append(state.view === 'graph' ? renderGraph() : renderRuns());
}

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value !== undefined && value !== null) node.setAttribute(key, String(value));
  }
  for (const child of [].concat(children)) if (child) node.append(child);
  return node;
}

/** Shown only while a run is actually in flight. */
function renderLiveBanner() {
  const live = state.live;
  if (!live || live.status !== 'running') return null;
  const done = live.captured.length;
  const total = live.plannedCaptures || done;
  return el('div', { class: 'runbanner' }, [
    el('span', { class: 'spinner' }),
    el('span', { text: `Run in progress — ${done}/${total} captures` }),
    live.currentStep ? el('span', { class: 'muted', text: live.currentStep }) : null,
  ]);
}

function renderRuns() {
  if (state.runs.length === 0) {
    return el('div', {
      class: 'empty',
      html: state.live?.status === 'running'
        ? 'First run in progress — switch to <strong>App map</strong> to watch it walk the app.'
        : 'No runs yet. Run <code>autoqa run</code> in this project and results appear here automatically.',
    });
  }

  const list = el('div', { class: 'card runlist' },
    state.runs.map((run) => {
      const button = el('button', {
        class: `runitem${run.id === state.selectedRunId ? ' active' : ''}`,
        onclick: async () => {
          state.selectedRunId = run.id;
          state.detail = await getJson(`/api/runs/${encodeURIComponent(run.id)}`);
          render();
        },
      }, [
        el('div', { class: 'row' }, [
          el('span', { class: `badge ${verdictClass(run)}`, text: verdictLabel(run) }),
          el('span', { class: 'mono', text: shortCommit(run.commit) }),
        ]),
        el('div', { class: 'when', text: `${formatTime(run.startedAt)} · ${run.mode} · ${run.findings.total} finding(s)` }),
      ]);
      return button;
    }),
  );

  return el('div', { class: 'layout' }, [list, renderDetail()]);
}

function renderDetail() {
  if (!state.detail) return el('div', { class: 'card empty', text: 'Select a run.' });
  const { run, findings, trace } = state.detail;

  const header = el('div', {}, [
    el('h2', {}, [
      el('span', { class: `badge ${verdictClass(summaryOf(run, findings))}`, text: verdictLabel(summaryOf(run, findings)) }),
      el('span', { text: `  ${run.mode} run on ${shortCommit(run.commit)}` }),
    ]),
    el('div', { class: 'kv' }, [
      el('span', { text: `${run.plan.coverage.screensSelected}/${run.plan.coverage.screensTotal} screens` }),
      el('span', { text: `exit ${run.exitCode}` }),
      el('span', { text: `${run.suppressionCount} suppressed` }),
      el('span', { text: `$${(run.cost.decisionUsd ?? 0).toFixed(5)} decision spend` }),
      el('span', { text: formatTime(run.startedAt) }),
    ]),
  ]);

  const children = [header];

  if (!trace) {
    children.push(el('div', { class: 'notes' }, [
      el('p', { text: 'This run predates the trace format, so only its findings are available.' }),
    ]));
  }

  const byScreen = new Map();
  for (const finding of findings) {
    const key = String(finding.screenId ?? '');
    if (!byScreen.has(key)) byScreen.set(key, []);
    byScreen.get(key).push(finding);
  }

  // A trace screen is one page at one viewport, and it records exactly which
  // findings it produced. Grouping by page alone listed the mobile findings
  // under desktop too, so every finding appeared twice.
  const byId = new Map(findings.map((f) => [f.id, f]));
  for (const screen of trace?.screens ?? []) {
    const own = Array.isArray(screen.findingIds)
      ? screen.findingIds.map((id) => byId.get(id)).filter(Boolean)
      : byScreen.get(screen.screenId) ?? [];
    children.push(renderScreen(screen, own, trace));
  }

  if (trace?.suppressed?.length) {
    children.push(el('div', { class: 'screen' }, [
      el('h3', { text: `Suppressed by the Intent Ledger (${trace.suppressed.length})` }),
      ...trace.suppressed.map((s) =>
        el('div', { class: 'finding' }, [
          el('div', { text: `${s.ruleId} on ${s.screenId}` }),
          el('div', { class: 'why', text: `"${s.reason}" — ${s.decidedBy}` }),
        ]),
      ),
    ]));
  }

  return el('div', { class: 'card detail' }, children);
}

function renderScreen(screen, findings, trace) {
  const shots = [];
  if (screen.artifacts.baseline) shots.push(shot(screen.artifacts.baseline, 'expected'));
  if (screen.artifacts.actual) shots.push(shot(screen.artifacts.actual, 'actual'));
  if (screen.artifacts.diff) shots.push(shot(screen.artifacts.diff, 'diff'));

  const fired = screen.checks.filter((c) => c.fired);
  const passed = screen.checks.filter((c) => !c.fired);

  return el('section', { class: 'screen' }, [
    el('div', { class: 'screen-head' }, [
      el('strong', { text: screen.title || screen.screenId }),
      el('span', { class: 'vp', text: `${screen.viewport} · ${screen.url}` }),
      screen.baselineCreated ? el('span', { class: 'badge info', text: 'baseline created' }) : null,
    ]),

    shots.length ? el('div', { class: 'shots' }, shots) : null,

    el('div', { class: 'checks' }, [
      ...fired.map((c) => el('span', { class: `chk fired sev-${c.severity ?? 'minor'}`, title: c.message ?? '', text: c.ruleId })),
      ...passed.map((c) => el('span', { class: 'chk', title: 'ran, found nothing', text: c.ruleId })),
    ]),

    ...groupFindings(findings).map((group) => renderGroup(group, trace)),

    renderReasoning(screen),
  ]);
}

/** Same rule, same claim, different element: one problem. Mirrors graph.ts. */
function problemKey(finding) {
  return `${finding.ruleId}|${finding.route}|${(finding.summary ?? '').replace(/"[^"]*"/, '"…"')}`;
}

function groupFindings(findings) {
  const groups = new Map();
  for (const finding of findings) {
    const key = problemKey(finding);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(finding);
  }
  return [...groups.values()];
}

function renderGroup(group, trace) {
  if (group.length === 1) return renderFinding(group[0], trace);
  const first = group[0];
  const card = renderFinding({ ...first, summary: first.summary.replace(/"[^"]*"/, `${group.length} elements`) }, trace);
  const selectors = group.map((f) => (f.summary.match(/"([^"]*)"/) ?? [])[1]).filter(Boolean);
  card.append(el('details', { class: 'members' }, [
    el('summary', { text: `The same problem on ${group.length} elements` }),
    el('ul', {}, selectors.map((sel) => el('li', {}, [el('code', { text: sel })]))),
  ]));
  return card;
}

function renderFinding(finding, trace) {
  const why = trace?.findings?.find((t) => t.findingId === finding.id)?.routeReason;
  return el('div', { class: `finding sev-${finding.severity}` }, [
    el('div', { text: finding.summary }),
    why ? el('div', { class: 'why', text: `Routed to ${finding.route}: ${why}` }) : null,
    el('div', { class: 'meta', text: `${finding.ruleId} · ${finding.tier} · ${finding.severity} · ${finding.fingerprint}` }),
  ]);
}

/**
 * The "show your work" panel. Everything that led to the verdict for this
 * screen: how the capture settled, what the diff measured, what was masked,
 * and what the decision layer was asked.
 */
function renderReasoning(screen) {
  const rows = [];
  const add = (label, value) => { if (value !== undefined && value !== null && value !== '') rows.push([label, value]); };

  if (screen.stability) add('Capture settled', `after ${screen.stability.frames} frame(s), ${screen.stability.elapsedMs}ms`);
  add('Selected because', screen.planReason);

  if (screen.diff) {
    const d = screen.diff;
    add('Pixel diff', d.identical
      ? `identical (${d.engine}, ${Math.round(d.durationMs)}ms)`
      : `${d.changedPixels} px across ${d.regionCount} region(s) — ${(d.changedFraction * 100).toFixed(3)}% of compared area (${d.engine})`);
    add('Masked', `${(d.maskedFraction * 100).toFixed(1)}% of the screen, ${d.maskedRegionCount} region(s)`);
    if (!d.enginesAgreed) add('Engines disagreed', `cross-check saw ${d.crossCheckChangedPixels} px`);
    // First line only: older runs stored the loader's full multi-line dump.
    if (d.degraded) add('Degraded', d.degraded.split('\n')[0].replace(/(: \/\S+)+.*$/, ''));
    if (d.dimensionMismatch) add('Dimensions changed', `${d.dimensionMismatch.baseline.join('x')} → ${d.dimensionMismatch.actual.join('x')}`);
  }

  if (screen.maskedSelectors?.length) add('Mask selectors', screen.maskedSelectors.join(', '));
  if (screen.missingFonts?.length) add('Missing fonts', screen.missingFonts.join(', '));
  if (screen.consoleErrors?.length) add('Console errors', screen.consoleErrors.slice(0, 5).join(' | '));
  if (screen.links?.length) add('Links found', `${screen.links.length} (${screen.links.filter((l) => l.external).length} external)`);

  if (screen.decision) {
    const d = screen.decision;
    add('Decision layer', d.decider === 'none' ? `not consulted — ${d.skippedReason}` : `${d.decider}, $${(d.costUsd ?? 0).toFixed(6)}`);
    if (d.stateChars) add('State digest', `${d.stateChars} chars (hash ${String(d.stateHash ?? '').slice(0, 12)})`);
    for (const [key, answer] of Object.entries(d.answers ?? {})) {
      add(`· ${key}`, `${answer.value} (confidence ${Number(answer.confidence).toFixed(2)})`);
    }
  }

  return el('details', { class: 'reasoning' }, [
    el('summary', { text: 'How AutoQA reached this' }),
    el('table', {}, rows.map(([k, v]) => el('tr', {}, [el('td', { text: k }), el('td', { text: String(v) })]))),
  ]);
}

function shot(path, caption) {
  const img = el('img', { src: artifact(path), alt: caption, loading: 'lazy', onclick: () => openLightbox(path, caption) });
  return el('figure', {}, [img, el('figcaption', { text: caption })]);
}

// ---------------------------------------------------------------- graph

const NODE_W = 190;
const NODE_H = 170;
const GAP_X = 70;
const GAP_Y = 46;

function renderGraph() {
  const graph = state.graph;
  if (!graph || graph.nodes.length === 0) {
    return el('div', {
      class: 'empty',
      html: 'Nothing mapped yet. Run <code>autoqa run</code> — the map is built from the screens it captured and the links it found on them.',
    });
  }

  // Deterministic layered layout: column = distance from the entry point.
  const columns = new Map();
  for (const node of [...graph.nodes].sort((a, b) => a.depth - b.depth || a.id.localeCompare(b.id))) {
    if (!columns.has(node.depth)) columns.set(node.depth, []);
    columns.get(node.depth).push(node);
  }

  const position = new Map();
  let maxRows = 0;
  for (const [depth, nodes] of [...columns.entries()].sort((a, b) => a[0] - b[0])) {
    maxRows = Math.max(maxRows, nodes.length);
    nodes.forEach((node, row) => {
      position.set(node.id, { x: depth * (NODE_W + GAP_X), y: row * (NODE_H + GAP_Y) });
    });
  }

  // Only links between ADJACENT columns are drawn directly: they cross nothing
  // but the empty gap between the two columns. Every other link -- back to an
  // earlier column (every page links home and to the nav), within a column, or
  // skipping columns -- used to be drawn straight through the cards in its way.
  // Those now travel only through empty space: out into the gap beside their
  // own column, up to a gutter above the map, across, and down the gap beside
  // the target's column. A lane offset keeps parallel links from stacking.
  const colOf = (at) => Math.round(at.x / (NODE_W + GAP_X));
  const routed = graph.edges.filter((e) => {
    const f = position.get(e.from);
    const t = position.get(e.to);
    return f && t && colOf(t) !== colOf(f) + 1;
  }).length;
  const gutter = routed > 0 ? Math.min(140, 28 + routed * 2) : 0;
  const padX = GAP_X / 2;
  for (const at of position.values()) {
    at.y += gutter;
    at.x += padX;
  }

  const width = padX + (columns.size - 1) * (NODE_W + GAP_X) + NODE_W + padX;
  const height = gutter + Math.max(1, maxRows) * (NODE_H + GAP_Y);

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  const laneSpan = GAP_X / 2 - 6;
  let lane = 0;
  for (const edge of graph.edges) {
    const from = position.get(edge.from);
    const to = position.get(edge.to);
    if (!from || !to) continue;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    const y1 = from.y + NODE_H / 2;
    const y2 = to.y + NODE_H / 2;
    let d;
    let indirect = false;
    if (colOf(to) === colOf(from) + 1) {
      const x1 = from.x + NODE_W;
      const x2 = to.x;
      const mid = (x1 + x2) / 2;
      d = `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`;
    } else {
      indirect = true;
      const i = lane++;
      const offset = (i * 5) % laneSpan - laneSpan / 2;
      const outX = from.x + NODE_W + GAP_X / 2 + offset;
      const inX = to.x - GAP_X / 2 + offset;
      const topY = Math.max(6, gutter - 10 - ((i * 4) % Math.max(10, gutter - 20)));
      d = `M ${from.x + NODE_W} ${y1} L ${outX} ${y1} L ${outX} ${topY} L ${inX} ${topY} L ${inX} ${y2} L ${to.x} ${y2}`;
    }
    path.setAttribute('d', d);
    const target = graph.nodes.find((n) => n.id === edge.to);
    const cls = ['edge'];
    if (target && target.state !== 'visited') cls.push('dim');
    if (indirect) cls.push('back');
    path.setAttribute('class', cls.join(' '));
    path.dataset.from = edge.from;
    path.dataset.to = edge.to;
    svg.append(path);
  }

  const canvas = el('div', { class: 'graph' });
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.append(svg);

  for (const node of graph.nodes) {
    const at = position.get(node.id);
    if (!at) continue;
    const card = renderNode(node);
    card.style.left = `${at.x}px`;
    card.style.top = `${at.y}px`;
    // Hover a screen to see only its links; everything else fades.
    card.addEventListener('mouseenter', () => highlightEdges(svg, node.id));
    card.addEventListener('mouseleave', () => highlightEdges(svg, null));
    canvas.append(card);
  }

  const legend = el('div', { class: 'legend' }, [
    el('span', {}, [el('i', { class: 'swatch' }), el('span', { text: 'captured' })]),
    el('span', {}, [el('i', { class: 'swatch discovered' }), el('span', { text: 'linked, never captured' })]),
    el('span', {}, [el('i', { class: 'swatch external' }), el('span', { text: 'external — recorded, never followed' })]),
    el('span', {}, [el('i', { class: 'dot blocking' }), el('span', { text: 'blocking' })]),
    el('span', {}, [el('i', { class: 'dot issue' }), el('span', { text: 'issue' })]),
    el('span', {}, [el('i', { class: 'dot question' }), el('span', { text: 'question' })]),
  ]);

  const notes = el('div', { class: 'notes' }, (graph.notes ?? []).map((n) => el('p', { text: n })));

  return el('div', { class: 'graphwrap' }, [notes, legend, canvas]);
}

function highlightEdges(svg, id) {
  svg.classList.toggle('focused', id !== null);
  for (const path of svg.querySelectorAll('path')) {
    path.classList.toggle('hot', id !== null && (path.dataset.from === id || path.dataset.to === id));
  }
}

function renderNode(node) {
  const shot = Object.values(node.screenshots)[0];
  const viewport = Object.keys(node.screenshots)[0];

  const media = shot
    ? el('img', { src: artifact(shot), alt: node.label, loading: 'lazy', onclick: () => openLightbox(shot, `${node.label} · ${viewport}`) })
    : el('div', { class: 'placeholder', text: node.state === 'external' ? 'external link' : 'never captured' });

  const dots = [];
  if (node.findings.blocking) dots.push(el('span', {}, [el('i', { class: 'dot blocking' }), el('span', { text: ` ${node.findings.blocking}` })]));
  if (node.findings.issues) dots.push(el('span', {}, [el('i', { class: 'dot issue' }), el('span', { text: ` ${node.findings.issues}` })]));
  if (node.findings.questions) dots.push(el('span', {}, [el('i', { class: 'dot question' }), el('span', { text: ` ${node.findings.questions}` })]));

  return el('div', {
    class: `node ${node.state}${node.findings.blocking ? ' has-blocking' : ''}`,
    title: `${node.title || node.url}${node.totalFindings ? ` — ${node.totalFindings} finding(s) across all elements and viewports` : ''}`,
  }, [
    media,
    el('div', { class: 'cap' }, [
      el('div', { class: 't', text: node.label }),
      el('div', { class: 's' }, dots.length ? dots : [el('span', { text: node.state === 'visited' ? 'clean' : node.state })]),
    ]),
  ]);
}

// ---------------------------------------------------------------- lightbox

const lightbox = document.getElementById('lightbox');
const lightboxImg = document.getElementById('lightbox-img');
const lightboxCaption = document.getElementById('lightbox-caption');

function openLightbox(path, caption) {
  lightboxImg.src = artifact(path);
  lightboxCaption.textContent = `${caption} — ${path}`;
  lightbox.hidden = false;
}
lightbox.addEventListener('click', () => { lightbox.hidden = true; });
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') lightbox.hidden = true; });

// ---------------------------------------------------------------- boot

tabs.addEventListener('click', async (event) => {
  const target = event.target.closest('button');
  if (!target) return;
  state.view = target.dataset.view;
  await refresh();
});

function summaryOf(run, findings) {
  return { exitCode: run.exitCode, status: run.status, findings: { blocking: findings.filter((f) => f.route === 'check').length } };
}

function verdictClass(summary) {
  if (summary.exitCode === 4) return 'info';
  if (summary.findings.blocking > 0) return 'fail';
  if (summary.status === 'incomplete') return 'warn';
  return 'pass';
}

function verdictLabel(summary) {
  if (summary.exitCode === 4) return 'could not test';
  if (summary.findings.blocking > 0) return `${summary.findings.blocking} blocking`;
  if (summary.status === 'incomplete') return 'incomplete';
  return 'pass';
}

/** Abbreviate a real SHA; leave a human label like `working-tree` intact. */
function shortCommit(commit) {
  return /^[0-9a-f]{40}$/i.test(commit) ? commit.slice(0, 8) : commit;
}

function formatTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

connectLive();
refresh({ keepSelection: false }).catch((error) => {
  view.append(el('div', { class: 'empty', text: String(error) }));
});
