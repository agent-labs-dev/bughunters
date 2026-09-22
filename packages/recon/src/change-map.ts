import type { AppModel, FileRef, ScreenId, TestPlan, TestPlanItem } from '@autoqa/core';

export type ChangeMapInput = {
  model: AppModel;
  changedFiles: FileRef[];
  /** Files that more than this fraction of screens depend on are "shared". */
  sharedComponentThreshold?: number;
  /** Below this, the run falls back to a smoke set and says so. */
  lowConfidenceThreshold?: number;
};

/**
 * Phase 2. Pure computation, no model calls in the common path, seconds not
 * minutes.
 *
 * The output is an explicit plan with a REASON on every item, because a QA tool
 * that hides what it tested cannot be trusted (spec, Phase 2).
 */
export function buildTestPlan(input: ChangeMapInput): TestPlan {
  const { model, changedFiles } = input;
  const sharedThreshold = input.sharedComponentThreshold ?? 0.3;
  const lowConfidence = input.lowConfidenceThreshold ?? 0.6;

  const items = new Map<string, TestPlanItem>();
  const totalScreens = model.screens.length;

  // 2. Direct hits, via the inverse map.
  // 3. Shared-component blast radius. The most valuable and most easily missed
  //    step: a design-token change touches everything.
  let mapped = 0;
  for (const file of changedFiles) {
    const screens = model.fileIndex[String(file)] ?? [];
    if (screens.length === 0) continue;
    mapped++;
    const isShared = totalScreens > 0 && screens.length / totalScreens >= sharedThreshold;
    for (const screenId of screens) {
      add(items, {
        target: { screenId },
        reason: isShared ? 'shared-component' : 'direct-change',
        viaFile: file,
      });
    }
  }

  // 4. Flow expansion: any flow containing an affected screen.
  const affected = new Set([...items.values()].map((i) => i.target.screenId).filter(Boolean) as ScreenId[]);
  for (const flow of model.flows) {
    if (!flow.screens.some((s) => affected.has(s))) continue;
    add(items, { target: { flowId: flow.id }, reason: 'flow-member' });
    for (const screenId of flow.screens) {
      add(items, { target: { screenId }, reason: 'flow-member' });
    }
  }

  const mappingConfidence = changedFiles.length === 0 ? 1 : mapped / changedFiles.length;

  // 5. Fallback. New files, config-only changes, or a weak map fall back to a
  //    smoke set, and the run is MARKED low-confidence rather than silently
  //    under-testing.
  if (mappingConfidence < lowConfidence) {
    for (const screenId of smokeSet(model)) {
      add(items, { target: { screenId }, reason: 'smoke-fallback' });
    }
  }

  // 6. Always-run invariants.
  for (const invariant of ALWAYS_ON) {
    add(items, { target: { invariant }, reason: 'always-on' });
  }

  const selected = new Set([...items.values()].map((i) => i.target.screenId).filter(Boolean));

  return {
    items: [...items.values()],
    mappingConfidence,
    coverage: { screensSelected: selected.size, screensTotal: totalScreens },
  };
}

export const ALWAYS_ON = ['boot-health', 'build-success', 'console-errors', 'network-failures'] as const;

/** Highest-centrality screens plus every entry point. */
export function smokeSet(model: AppModel, limit = 10): ScreenId[] {
  const degree = new Map<ScreenId, number>();
  for (const edge of model.edges) {
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1);
  }

  const entryPoints = new Set(
    model.flows.filter((f) => f.criticality === 'entry').flatMap((f) => f.screens.slice(0, 1)),
  );

  const ranked = [...model.screens]
    .filter((s) => s.state === 'active')
    .sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0))
    .map((s) => s.id);

  return [...new Set([...entryPoints, ...ranked])].slice(0, limit);
}

function add(items: Map<string, TestPlanItem>, item: TestPlanItem): void {
  const key = JSON.stringify(item.target);
  const existing = items.get(key);
  // A direct hit is a stronger reason than a fallback, so it wins the slot.
  if (existing && rank(existing.reason) >= rank(item.reason)) return;
  items.set(key, item);
}

function rank(reason: TestPlanItem['reason']): number {
  return { 'direct-change': 4, 'shared-component': 3, 'flow-member': 2, 'smoke-fallback': 1, 'always-on': 0 }[reason];
}

/** The inverse map, built from screen -> files during Recon (spec 1.5). */
export function buildFileIndex(model: Pick<AppModel, 'screens'>): Record<string, ScreenId[]> {
  const index: Record<string, ScreenId[]> = {};
  for (const screen of model.screens) {
    for (const file of screen.sourceFiles) {
      (index[String(file)] ??= []).push(screen.id);
    }
  }
  return index;
}
