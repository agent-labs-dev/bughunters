import type { Decider, Finding, GroupId } from '@bughunters/core';
import { id, shortHash } from '@bughunters/core';
import { SAME_ROOT_CAUSE } from '@bughunters/decide';

export type RootCauseGroup = {
  id: GroupId;
  findings: Finding[];
  /** The screens this one cause surfaced on. Reported once, not N times. */
  screens: string[];
  ruleIds: string[];
  representative: Finding;
};

/**
 * The same root cause commonly surfaces on twenty screens at once -- one broken
 * shared component, one design token, one i18n key. Unclustered, that is twenty
 * issues, and the tool gets muted within a week (spec 4.2).
 *
 * Pass 1 is deterministic and free. Pass 2 only sees the pairs pass 1 could not
 * resolve, which keeps the model call count proportional to genuine ambiguity
 * rather than to finding count.
 */
export async function cluster(
  findings: Finding[],
  options: { decider?: Decider; changedFilesByFinding?: Map<string, string[]> } = {},
): Promise<RootCauseGroup[]> {
  const deterministic = deterministicPass(findings, options.changedFilesByFinding);
  if (!options.decider || deterministic.length < 2) return deterministic;
  return modelPass(deterministic, options.decider);
}

/** Pass 1: identical fingerprints, then identical rule + changed-file sets. */
export function deterministicPass(
  findings: Finding[],
  changedFilesByFinding?: Map<string, string[]>,
): RootCauseGroup[] {
  const buckets = new Map<string, Finding[]>();
  for (const finding of findings) {
    const files = changedFilesByFinding?.get(finding.id) ?? finding.suspectedFiles;
    const key = [finding.ruleId, [...files].sort().join(',')].join('::');
    const bucket = buckets.get(key);
    if (bucket) bucket.push(finding);
    else buckets.set(key, [finding]);
  }
  return [...buckets.entries()].map(([key, group]) => toGroup(key, group));
}

/** Pass 2: one Noul per residual pair, over a compact description of each. */
async function modelPass(groups: RootCauseGroup[], decider: Decider): Promise<RootCauseGroup[]> {
  const merged: RootCauseGroup[] = [];
  const consumed = new Set<string>();

  for (let i = 0; i < groups.length; i++) {
    const a = groups[i]!;
    if (consumed.has(a.id)) continue;
    let current = a;

    for (let j = i + 1; j < groups.length; j++) {
      const b = groups[j]!;
      if (consumed.has(b.id)) continue;
      const state = JSON.stringify({
        findingA: describe(current.representative),
        findingB: describe(b.representative),
      });
      const answers = await decider.ask(state, { same_root_cause: SAME_ROOT_CAUSE });
      const answer = answers['same_root_cause'];
      // Merging is a form of silencing: it hides N-1 findings behind one
      // report, so it needs confidence, not just a majority probability.
      if (answer?.kind === 'noul' && answer.value >= 0.5 && answer.confidence >= 0.85) {
        current = toGroup(current.id, [...current.findings, ...b.findings]);
        consumed.add(b.id);
      }
    }
    merged.push(current);
  }
  return merged;
}

function toGroup(key: string, findings: Finding[]): RootCauseGroup {
  const representative = [...findings].sort((a, b) => severityRank(b) - severityRank(a))[0]!;
  return {
    id: id.group(`grp_${shortHash(key, 10)}`),
    findings,
    screens: [...new Set(findings.map((f) => f.screenId).filter(Boolean) as string[])],
    ruleIds: [...new Set(findings.map((f) => f.ruleId))],
    representative,
  };
}

function describe(finding: Finding): Record<string, unknown> {
  return {
    rule: finding.ruleId,
    screen: finding.screenId,
    classification: finding.classification,
    summary: finding.summary,
    files: finding.suspectedFiles,
  };
}

function severityRank(f: Finding): number {
  return { cosmetic: 0, minor: 1, major: 2, critical: 3 }[f.severity];
}
