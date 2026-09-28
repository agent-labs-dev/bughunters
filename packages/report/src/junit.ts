import type { Finding, Run } from '@bugpatrol/core';

/** JUnit for CI dashboards. Cheap to emit, broad compatibility (spec 5.4). */
export function toJUnit(run: Run, findings: Finding[]): string {
  const blocking = findings.filter((f) => f.route === 'check');
  const attributed = new Set<Finding>();
  let failedCases = 0;
  const cases = run.plan.items.map((item, index) => {
    const target = item.target.screenId ?? item.target.flowId ?? item.target.invariant ?? `item-${index}`;
    const name = item.target.viewport ? `${target} @${item.target.viewport}` : target;
    const failures = blocking.filter(
      (f) =>
        (f.screenId !== undefined &&
          f.screenId === item.target.screenId &&
          (f.viewport === undefined || f.viewport === item.target.viewport)) ||
        (f.flowId !== undefined && f.flowId === item.target.flowId),
    );
    if (failures.length === 0) return `    <testcase classname="bugpatrol" name="${escapeXml(name)}" />`;
    failedCases++;
    failures.forEach((finding) => attributed.add(finding));
    const body = failures
      .map((f) => `      <failure type="${escapeXml(f.ruleId)}">${escapeXml(f.summary)}</failure>`)
      .join('\n');
    return `    <testcase classname="bugpatrol" name="${escapeXml(name)}">\n${body}\n    </testcase>`;
  });
  // Never discard a blocking finding merely because an older plan lacks its target.
  for (const finding of blocking.filter((item) => !attributed.has(item))) {
    failedCases++;
    cases.push(
      `    <testcase classname="bugpatrol" name="${escapeXml(finding.id)}"><failure type="${escapeXml(finding.ruleId)}">${escapeXml(finding.summary)}</failure></testcase>`,
    );
  }
  const incomplete = run.status === 'incomplete' || run.status === 'infra-error';
  if (incomplete)
    cases.push(
      '    <testcase classname="bugpatrol" name="Run completeness"><error type="incomplete">Bugpatrol could not complete verification.</error></testcase>',
    );

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<testsuites>',
    `  <testsuite name="Bugpatrol" tests="${cases.length}" failures="${failedCases}" errors="${incomplete ? 1 : 0}" timestamp="${run.startedAt.toISOString()}">`,
    ...cases,
    '  </testsuite>',
    '</testsuites>',
    '',
  ].join('\n');
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
