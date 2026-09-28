import { sha256 } from '@bugpatrol/core';
import type { InvariantViolation } from '@bugpatrol/invariants';

export type ScreenState = {
  screen: { id: string; description: string; purpose?: string; primaryAction?: string };
  product: { summary: string; audience: string; domainVocabulary: string[] };
  assertions: Array<{ rule: string; severity: string; detail: string }>;
  diff?: { changedPixels: number; changedPercent: number; maskedPercent: number; regions: number };
  dom?: { addedNodes: number; removedNodes: number; textChanges: Array<{ from: string; to: string }> };
  console?: string[];
  network?: Array<{ url: string; status?: number; sameOrigin: boolean }>;
  /** Injected Ledger summaries, so known-intended behaviour is recognised. */
  knownIntents?: string[];
  history?: { flakeRate: number; lastDecision?: string };
};

/** Hard cap on serialized state size. Cost scales with input tokens. */
export const MAX_STATE_CHARS = 16_000;

const MAX_ASSERTIONS = 40;
const MAX_CONSOLE_LINES = 20;
const MAX_TEXT_CHANGES = 25;

/**
 * Builds the compact textual state the decider reasons over.
 *
 * Pruning is not an optimisation, it is the design. The decision layer is
 * text-only, so Bugpatrol's default reasoning path carries no image tokens at all
 * -- and a 4,000-token text digest is a small fraction of the cost of a
 * screenshot at useful resolution, and faster to produce (spec 4.4).
 */
export function buildState(input: ScreenState): { text: string; hash: string } {
  const pruned: ScreenState = {
    ...input,
    assertions: dedupeAssertions(input.assertions).slice(0, MAX_ASSERTIONS),
    console: input.console?.slice(0, MAX_CONSOLE_LINES),
    dom: input.dom ? { ...input.dom, textChanges: input.dom.textChanges.slice(0, MAX_TEXT_CHANGES) } : undefined,
  };

  let text = JSON.stringify(pruned, null, 1);
  if (text.length > MAX_STATE_CHARS) {
    // Truncate the assertions rather than the screen and product context: the
    // context is what lets the decider say "this is inconsistent with how the
    // product works" instead of just "something changed".
    pruned.assertions = pruned.assertions.slice(0, 15);
    text = JSON.stringify(pruned, null, 1).slice(0, MAX_STATE_CHARS);
  }

  return { text, hash: sha256(text) };
}

/**
 * Repeated identical assertions (the same rule firing on 30 list rows) are
 * collapsed with a count. Serializing all 30 costs tokens and tells the
 * decider nothing the count does not.
 */
function dedupeAssertions(assertions: ScreenState['assertions']): ScreenState['assertions'] {
  const groups = new Map<string, { entry: ScreenState['assertions'][number]; count: number }>();
  for (const a of assertions) {
    const key = `${a.rule}::${a.severity}`;
    const existing = groups.get(key);
    if (existing) existing.count++;
    else groups.set(key, { entry: a, count: 1 });
  }
  return [...groups.values()].map(({ entry, count }) =>
    count === 1 ? entry : { ...entry, detail: `${entry.detail} (and ${count - 1} more like it)` },
  );
}

export function violationsToAssertions(violations: InvariantViolation[]): ScreenState['assertions'] {
  return violations.map((v) => ({ rule: v.ruleId, severity: v.severity, detail: v.message }));
}
