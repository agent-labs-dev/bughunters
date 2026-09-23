import type { AppModel, LiveProgress } from '@autoqa/core';
import type { RunRecord } from './project.js';

export type GraphNodeState =
  | 'visited'
  /** Linked to from a visited screen, but AutoQA has never captured it. */
  | 'discovered'
  /** Off-origin. Recorded as a finding, never followed (spec 11.1). */
  | 'external';

export type GraphNode = {
  id: string;
  label: string;
  title?: string;
  url: string;
  state: GraphNodeState;
  /** Layer from the entry point, for deterministic layout. */
  depth: number;
  /** Per-viewport thumbnails, keyed by viewport name. */
  screenshots: Record<string, string>;
  /**
   * Distinct problems: one per rule and message, however many elements and
   * viewports it repeats on. One muted text style on 84 changelog entries is
   * one problem, and the map should say so.
   */
  findings: { blocking: number; issues: number; questions: number };
  /** Raw finding count before grouping, for the tooltip. */
  totalFindings: number;
  /** Highest severity seen on this screen in the source run. */
  severity?: 'cosmetic' | 'minor' | 'major' | 'critical';
};

export type GraphEdge = {
  from: string;
  to: string;
  label: string;
  kind: 'nav' | 'action';
};

export type AppGraph = {
  /** Where the structure came from, so the UI never implies a crawl happened. */
  source: 'appmodel' | 'run-trace' | 'empty';
  nodes: GraphNode[];
  edges: GraphEdge[];
  entryId?: string;
  notes: string[];
};

/**
 * The app map.
 *
 * Preference order matters. An approved AppModel is the real answer -- it is
 * what Recon built and a human corrected. Before Recon exists, the graph is
 * derived from what the last run actually saw: the screens it captured, plus
 * every link it found on them.
 *
 * That derived graph is genuinely useful rather than a placeholder, because it
 * makes the gap visible: a `discovered` node is somewhere the app links to that
 * AutoQA has never looked at. Showing coverage honestly is the whole point --
 * a map that only draws what was tested implies the rest does not exist.
 */
export function buildGraph(
  model: AppModel | undefined,
  run: RunRecord | undefined,
  live?: LiveProgress,
): AppGraph {
  // A run in flight wins: watching the map fill in as AutoQA walks the app is
  // the point of having it live, and the finished run is one refresh away.
  if (live?.status === 'running' && live.captured.length > 0) return fromLive(live);
  if (model && model.screens.length > 0) return fromAppModel(model, run);
  if (run?.trace && run.trace.screens.length > 0) return fromRunTrace(run);
  return { source: 'empty', nodes: [], edges: [], notes: ['No AppModel and no run with a trace yet.'] };
}

function fromLive(live: LiveProgress): AppGraph {
  const asTrace: RunRecord = {
    id: live.runId,
    dir: '',
    mtimeMs: 0,
    run: undefined as never,
    findings: [],
    trace: {
      version: 1,
      runId: live.runId as never,
      findings: [],
      suppressed: [],
      screens: live.captured.map((c) => ({
        screenId: c.screenId,
        viewport: c.viewport,
        url: c.url,
        title: c.title,
        planReason: 'always-on',
        baselineCreated: c.baselineCreated,
        artifacts: { actual: c.actual },
        maskedSelectors: [],
        missingFonts: [],
        consoleErrors: [],
        links: c.links,
        checks: [],
        findingIds: [],
      })),
    },
  };
  const graph = fromRunTrace(asTrace);
  graph.notes = [
    `Run in progress — ${live.captured.length} of ${live.plannedCaptures} capture(s) done${live.currentStep ? `. ${live.currentStep}` : ''}.`,
    ...graph.notes.slice(1),
  ];
  return graph;
}

function fromAppModel(model: AppModel, run: RunRecord | undefined): AppGraph {
  const findings = findingCounts(run);
  const shots = screenshotsByScreen(run);

  const nodes: GraphNode[] = model.screens.map((screen) => ({
    id: screen.urlPattern,
    label: screen.title || screen.urlPattern,
    title: screen.description,
    url: screen.urlPattern,
    state: 'visited',
    depth: 0,
    screenshots: shots[screen.urlPattern] ?? {},
    findings: findings.counts[screen.urlPattern] ?? { blocking: 0, issues: 0, questions: 0 },
    totalFindings: findings.totals[screen.urlPattern] ?? 0,
    severity: findings.severity[screen.urlPattern],
  }));

  const byId = new Map(model.screens.map((s) => [s.id, s.urlPattern]));
  const edges: GraphEdge[] = model.edges.flatMap((edge) => {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    return from && to ? [{ from, to, label: edge.action.kind, kind: edge.kind }] : [];
  });

  const entryId = nodes[0]?.id;
  assignDepths(nodes, edges, entryId);
  return {
    source: 'appmodel',
    nodes,
    edges,
    entryId,
    notes: [
      model.approvedAt
        ? `AppModel v${model.version}, approved by ${model.approvedBy ?? 'unknown'}.`
        : `AppModel v${model.version} is NOT approved yet, so nothing blocks on it.`,
    ],
  };
}

function fromRunTrace(run: RunRecord): AppGraph {
  const trace = run.trace!;
  const findings = findingCounts(run);
  const shots = screenshotsByScreen(run);
  const notes = [
    'Derived from the last run, not from a crawl. Recon has not built an AppModel yet, so this shows what the run actually touched plus everything it saw linked.',
  ];

  const visited = new Map<string, GraphNode>();
  for (const screen of trace.screens) {
    const existing = visited.get(screen.screenId);
    if (existing) continue;
    visited.set(screen.screenId, {
      id: screen.screenId,
      label: screen.title || screen.screenId,
      title: screen.url,
      url: screen.url,
      state: 'visited',
      depth: 0,
      screenshots: shots[screen.screenId] ?? {},
      findings: findings.counts[screen.screenId] ?? { blocking: 0, issues: 0, questions: 0 },
      totalFindings: findings.totals[screen.screenId] ?? 0,
      severity: findings.severity[screen.screenId],
    });
  }

  const nodes = [...visited.values()];
  const edges: GraphEdge[] = [];
  const seenEdges = new Set<string>();
  const discovered = new Map<string, GraphNode>();

  let nonPages = 0;
  const skipped = new Set<string>();
  for (const screen of trace.screens) {
    for (const link of screen.links) {
      if (!isPageLink(link)) {
        if (!skipped.has(link.href)) {
          skipped.add(link.href);
          nonPages++;
        }
        continue;
      }
      const targetId = link.external ? link.href : pathOf(link.href);
      if (targetId === screen.screenId) continue;

      if (!visited.has(targetId) && !discovered.has(targetId)) {
        discovered.set(targetId, {
          id: targetId,
          label: link.external ? hostOf(link.href) : targetId,
          title: link.text || link.href,
          url: link.href,
          state: link.external ? 'external' : 'discovered',
          depth: 0,
          screenshots: {},
          findings: { blocking: 0, issues: 0, questions: 0 },
          totalFindings: 0,
        });
      }

      const key = `${screen.screenId}->${targetId}`;
      if (seenEdges.has(key)) continue;
      seenEdges.add(key);
      edges.push({ from: screen.screenId, to: targetId, label: link.text || targetId, kind: 'nav' });
    }
  }

  const all = [...nodes, ...discovered.values()];
  const unvisited = all.filter((n) => n.state === 'discovered').length;
  if (unvisited > 0) {
    notes.push(`${unvisited} screen(s) are linked from what was tested but have never been captured.`);
  }

  if (nonPages > 0) {
    notes.push(`${nonPages} link(s) to feeds, files or API endpoints are not drawn, because they are not screens.`);
  }

  const entryId = trace.screens[0]?.screenId;
  assignDepths(all, edges, entryId);
  return { source: 'run-trace', nodes: all, edges, entryId, notes };
}

/**
 * BFS layering from the entry point. Deterministic on purpose: a graph that
 * reshuffles on every reload is one nobody can compare against last week's.
 */
export function assignDepths(nodes: GraphNode[], edges: GraphEdge[], entryId: string | undefined): void {
  if (!entryId) return;
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    const list = adjacency.get(edge.from) ?? [];
    list.push(edge.to);
    adjacency.set(edge.from, list);
  }

  const depths = new Map<string, number>([[entryId, 0]]);
  const queue = [entryId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of adjacency.get(current) ?? []) {
      if (depths.has(next)) continue;
      depths.set(next, depths.get(current)! + 1);
      queue.push(next);
    }
  }

  // Anything unreachable from the entry point is parked one layer past the
  // deepest reachable node rather than hidden -- an orphaned route is a finding
  // in its own right (spec 8.5).
  const maxDepth = Math.max(0, ...depths.values());
  for (const node of nodes) node.depth = depths.get(node.id) ?? maxDepth + 1;
}

function findingCounts(run: RunRecord | undefined): {
  counts: Record<string, { blocking: number; issues: number; questions: number }>;
  totals: Record<string, number>;
  severity: Record<string, GraphNode['severity']>;
} {
  const counts: Record<string, { blocking: number; issues: number; questions: number }> = {};
  const totals: Record<string, number> = {};
  const severity: Record<string, GraphNode['severity']> = {};
  if (!run) return { counts, totals, severity };

  const rank = { cosmetic: 0, minor: 1, major: 2, critical: 3 } as const;
  const seen = new Set<string>();
  for (const finding of run.findings) {
    const key = String(finding.screenId ?? '');
    if (!key) continue;
    totals[key] = (totals[key] ?? 0) + 1;

    const current = severity[key];
    if (!current || rank[finding.severity] > rank[current]) severity[key] = finding.severity;

    const problem = `${key}\u0000${finding.route}\u0000${problemKey(finding.ruleId, finding.summary)}`;
    if (seen.has(problem)) continue;
    seen.add(problem);
    counts[key] ??= { blocking: 0, issues: 0, questions: 0 };
    if (finding.route === 'check') counts[key].blocking++;
    else if (finding.route === 'issue') counts[key].issues++;
    else if (finding.route === 'question') counts[key].questions++;
  }
  return { counts, totals, severity };
}

/**
 * Two findings are the same problem when they are the same rule saying the
 * same thing about different elements. The element is the quoted selector in
 * the summary, so removing it leaves the claim itself.
 */
export function problemKey(ruleId: string | undefined, summary: string | undefined): string {
  // Tolerant of partial records: the dashboard reads run files from disk, and
  // an older or hand-edited file must not take the whole map down.
  return `${ruleId ?? ''}\u0000${(summary ?? '').replace(/"[^"]*"/, '"…"')}`;
}

const NON_PAGE_EXTENSION = /\.(xml|rss|atom|json|txt|csv|pdf|zip|gz|tar|dmg|exe|msi|pkg|apk|ipa|deb|rpm|png|jpe?g|gif|svg|webp|ico|mp4|mp3|wav|woff2?|ttf|otf|js|css|map)$/i;
const FEED_SEGMENT = /^(rss|atom|feed|feeds|sitemap)(\.xml)?$/i;

/**
 * Whether a link leads to a screen. Feeds, downloads and API endpoints are
 * links but not screens, and drawing them as unvisited pages overstates how
 * much of the app is untested. Markup hints win where present; otherwise the
 * path decides.
 */
export function isPageLink(link: { href: string; download?: boolean; type?: string }): boolean {
  if (link.download) return false;
  if (link.type && !/html/i.test(link.type)) return false;
  let path: string;
  try {
    path = new URL(link.href).pathname;
  } catch {
    return true;
  }
  if (/^\/api(\/|$)/i.test(path)) return false;
  if (NON_PAGE_EXTENSION.test(path)) return false;
  const last = path.split('/').filter(Boolean).pop() ?? '';
  if (FEED_SEGMENT.test(last)) return false;
  return true;
}

/** Screenshot paths per screen, per viewport, relative to the run directory. */
function screenshotsByScreen(run: RunRecord | undefined): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const screen of run?.trace?.screens ?? []) {
    if (!screen.artifacts.actual) continue;
    out[screen.screenId] ??= {};
    out[screen.screenId]![screen.viewport] = screen.artifacts.actual;
  }
  return out;
}

function pathOf(href: string): string {
  try {
    return new URL(href).pathname;
  } catch {
    return href;
  }
}

function hostOf(href: string): string {
  try {
    return new URL(href).host;
  } catch {
    return href;
  }
}
