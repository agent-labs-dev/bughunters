import type { Finding, Run } from '@bugpatrol/core';

/** Marker used to find and edit the sticky comment in place, never append. */
export const STICKY_MARKER = '<!-- bugpatrol:sticky-comment -->';

/**
 * One comment per PR, edited on every run. The commands are listed inline
 * because `/bugpatrol accept` is the most important affordance in the product: it
 * is the one-action escape hatch that turns a false positive into permanent
 * context instead of a grudge (spec 5.2).
 */
export function renderPrComment(input: {
  run: Run;
  findings: Finding[];
  reportUrl?: string;
  suppressed: number;
}): string {
  const { run, findings } = input;
  const blocking = findings.filter((f) => f.route === 'check');
  const questions = findings.filter((f) => f.route === 'question');
  const issues = findings.filter((f) => f.route === 'issue');

  const verdict =
    run.status === 'infra-error'
      ? '**Bugpatrol could not test this change.** This is an infrastructure failure, not a product failure, and it does not block the merge.'
      : blocking.length > 0
        ? `**${blocking.length} tier-1 regression(s).** These block the merge.`
        : '**No regressions.**';

  return [
    STICKY_MARKER,
    '### Bugpatrol',
    '',
    verdict,
    '',
    `Tested ${run.plan.coverage.screensSelected} of ${run.plan.coverage.screensTotal} screens in \`${run.mode}\` mode` +
      (run.plan.mappingConfidence < 0.6 ? ' — **low mapping confidence**, so a smoke set was used as a fallback.' : '.'),
    '',
    ...(blocking.length > 0 ? ['#### Blocking', ...blocking.map(bullet), ''] : []),
    ...(issues.length > 0 ? ['#### Filed as issues', ...issues.map(bullet), ''] : []),
    ...(questions.length > 0
      ? ['#### Needs a decision', ...questions.map(bullet), '', '_A question is a first-class outcome, not a failure. Answering one writes the Intent Ledger so it is never asked again._', '']
      : []),
    input.suppressed > 0 ? `${input.suppressed} finding(s) suppressed by the Intent Ledger.\n` : '',
    '<details><summary>Test plan</summary>\n',
    '| Target | Why |',
    '| --- | --- |',
    ...run.plan.items
      .slice(0, 50)
      .map((i) => `| \`${i.target.screenId ?? i.target.flowId ?? i.target.invariant}\` | ${i.reason} |`),
    '\n</details>',
    '',
    input.reportUrl ? `[Full report](${input.reportUrl})` : '',
    '',
    '<sub>`/bugpatrol run` · `/bugpatrol run --all` · `/bugpatrol explain <id>` · `/bugpatrol accept <id>` · `/bugpatrol mute <fingerprint>` · `/bugpatrol fix <id>` · `/bugpatrol baseline update`</sub>',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

function bullet(finding: Finding): string {
  return `- **${finding.summary}** _(${finding.ruleId}, ${finding.severity}, \`${finding.fingerprint}\`)_`;
}
