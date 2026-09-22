import type { Finding } from '@autoqa/core';
import { LABELS } from './permissions.js';

export type IssuePayload = { title: string; body: string; labels: string[] };

/**
 * An issue written the way a good QA engineer writes one (spec 5.3): what I
 * did, what I expected, what happened, the evidence, the suspected cause, and
 * severity and confidence as NUMBERS rather than adjectives.
 */
export function buildIssue(finding: Finding, context: { expected?: string; reportUrl?: string }): IssuePayload {
  const body = [
    `**What I did**`,
    finding.evidence.reproSteps?.length
      ? finding.evidence.reproSteps.map((s, i) => `${i + 1}. \`${JSON.stringify(s)}\``).join('\n')
      : `Loaded \`${finding.screenId ?? 'the screen'}\`.`,
    '',
    `**What I expected**`,
    context.expected ?? 'The screen to match its approved baseline.',
    '',
    `**What happened**`,
    finding.summary,
    '',
    `**Evidence**`,
    finding.evidence.before ? `- Baseline: ${finding.evidence.before}` : '',
    finding.evidence.after ? `- Actual: ${finding.evidence.after}` : '',
    finding.evidence.diff ? `- Diff: ${finding.evidence.diff}` : '',
    finding.evidence.clip ? `- Clip: ${finding.evidence.clip}` : '',
    finding.evidence.console?.length ? `- Console:\n\`\`\`\n${finding.evidence.console.slice(0, 10).join('\n')}\n\`\`\`` : '',
    context.reportUrl ? `- [Full report](${context.reportUrl})` : '',
    '',
    `**Suspected cause**`,
    finding.suspectedFiles.length > 0
      ? finding.suspectedFiles.map((f) => `- \`${f}\``).join('\n')
      : '_No source mapping resolved for this screen, so this finding is unattributed._',
    '',
    `**Severity and confidence**`,
    `severity \`${finding.severity}\` · confidence \`${finding.confidence.toFixed(2)}\` · tier \`${finding.tier}\` · fingerprint \`${finding.fingerprint}\``,
    '',
    `---`,
    `If this is intended, comment \`/autoqa accept ${finding.id} --reason "why"\` and AutoQA will not raise it again.`,
  ]
    .filter(Boolean)
    .join('\n');

  return { title: finding.summary.slice(0, 120), body, labels: labelsFor(finding) };
}

export function labelsFor(finding: Finding): string[] {
  const labels: string[] = [LABELS.root];
  if (finding.route === 'question') {
    labels.push(LABELS.question, LABELS.needsDecision);
  } else {
    labels.push(LABELS.bug);
  }
  if (finding.classification === 'regression') labels.push(LABELS.regression);
  if (finding.classification === 'a11y') labels.push(LABELS.a11y);
  if (finding.classification === 'content') labels.push(LABELS.content);
  if (finding.classification === 'flow') labels.push(LABELS.flow);
  return labels;
}

/**
 * A question is a first-class outcome, not a failure of the tool. The answer
 * becomes a Ledger entry, which is how AutoQA gets QUIETER over time instead of
 * louder -- the property every tool in this category currently lacks.
 */
export function buildQuestion(finding: Finding, question: string): IssuePayload {
  return {
    title: question.slice(0, 120),
    body: [
      question,
      '',
      `**Evidence**`,
      finding.summary,
      finding.evidence.diff ? `\nDiff: ${finding.evidence.diff}` : '',
      '',
      `**Answer with one of:**`,
      `- \`/autoqa accept ${finding.id} --reason "this is intended"\``,
      `- \`/autoqa mute ${finding.fingerprint} --expires 30d\``,
      `- \`/autoqa explain ${finding.id}\` to see the underlying evidence`,
      '',
      '_Nothing is blocked while this question is open._',
    ]
      .filter(Boolean)
      .join('\n'),
    labels: [LABELS.root, LABELS.question, LABELS.needsDecision],
  };
}
