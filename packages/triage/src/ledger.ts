import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { Finding, Intent, IntentScope, ProjectId } from '@bugpatrol/core';
import { id, paths } from '@bugpatrol/core';

export type LedgerFile = { version: 1; intents: Intent[] };

/**
 * The Intent Ledger. The answer to the single biggest adoption risk in this
 * category: a tool that keeps flagging deliberate behaviour until people stop
 * reading it.
 *
 * It is committed to the repo on purpose. A ledger nobody can audit is just a
 * mute button (spec 4.5).
 */
export class IntentLedger {
  constructor(private intents: Intent[] = []) {}

  static load(root: string): IntentLedger {
    const file = paths.intents(root);
    if (!existsSync(file)) return new IntentLedger([]);
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as LedgerFile;
    return new IntentLedger(
      parsed.intents.map((i) => ({
        ...i,
        decidedAt: new Date(i.decidedAt),
        expiresAt: i.expiresAt ? new Date(i.expiresAt) : undefined,
      })),
    );
  }

  save(root: string): void {
    const file: LedgerFile = { version: 1, intents: this.intents };
    writeFileSync(paths.intents(root), `${JSON.stringify(file, null, 2)}\n`);
  }

  get all(): readonly Intent[] {
    return this.intents;
  }

  /** Expired suppressions stop suppressing, so a decision gets revisited. */
  activeAt(now = new Date()): Intent[] {
    return this.intents.filter((i) => !i.expiresAt || i.expiresAt > now);
  }

  match(finding: Finding, now = new Date()): Intent | undefined {
    return this.activeAt(now).find((intent) => scopeMatches(intent.scope, finding));
  }

  add(entry: Omit<Intent, 'id' | 'decidedAt'> & { decidedAt?: Date }): Intent {
    const intent: Intent = {
      ...entry,
      id: id.intent(`intent_${this.intents.length + 1}_${Date.now().toString(36)}`),
      decidedAt: entry.decidedAt ?? new Date(),
    };
    this.intents.push(intent);
    return intent;
  }

  /** Removes expired entries. Surfaced via `bugpatrol intent prune`. */
  prune(now = new Date()): Intent[] {
    const expired = this.intents.filter((i) => i.expiresAt && i.expiresAt <= now);
    this.intents = this.intents.filter((i) => !expired.includes(i));
    return expired;
  }

  /**
   * Ledger summaries are injected into every tier-2 state, so the decider can
   * recognise a known-intended CLASS of behaviour rather than rediscovering it
   * one finding at a time.
   */
  summaries(): string[] {
    return this.activeAt().map((i) => `${describeScope(i.scope)}: ${i.decision} -- ${i.reason}`);
  }

  /** Rule ids suppressed project-wide, handed to the invariant engine. */
  disabledRuleIds(): string[] {
    return this.activeAt()
      .filter((i) => i.scope.kind === 'rule' && (i.decision === 'intended' || i.decision === 'mute'))
      .map((i) => (i.scope as { kind: 'rule'; ruleId: string }).ruleId);
  }
}

export function scopeMatches(scope: IntentScope, finding: Finding): boolean {
  switch (scope.kind) {
    case 'fingerprint':
      return scope.fingerprint === finding.fingerprint;
    case 'screen':
      return scope.screenId === finding.screenId;
    case 'rule':
      return scope.ruleId === finding.ruleId;
    case 'rule-on-screen':
      return scope.ruleId === finding.ruleId && scope.screenId === finding.screenId;
    case 'selector':
      // Selector scope needs the violation selector, which lives on the
      // evidence rather than the finding, so it matches at screen level and is
      // narrowed by the caller.
      return scope.screenId === finding.screenId;
  }
}

export function describeScope(scope: IntentScope): string {
  switch (scope.kind) {
    case 'fingerprint':
      return `finding ${scope.fingerprint}`;
    case 'screen':
      return `screen ${scope.screenId}`;
    case 'rule':
      return `rule ${scope.ruleId}`;
    case 'rule-on-screen':
      return `rule ${scope.ruleId} on screen ${scope.screenId}`;
    case 'selector':
      return `selector ${scope.selector} on screen ${scope.screenId}`;
  }
}

export function emptyLedger(projectId: ProjectId): IntentLedger {
  void projectId;
  return new IntentLedger([]);
}
