import type { Finding, Run } from '@autoqa/core';

/** JUnit for CI dashboards. Cheap to emit, broad compatibility (spec 5.4). */
export function toJUnit(run: Run, findings: Finding[]): string {
  const blocking = findings.filter((f) => f.route === 'check');
  const cases = run.plan.items.map((item, index) => {
    const target = item.target.screenId ?? item.target.flowId ?? item.target.invariant ?? `item-${index}`;
    const failures = blocking.filter((f) => f.screenId === item.target.screenId || f.flowId === item.target.flowId);
    if (failures.length === 0) {
      return `    <testcase classname="autoqa" name="${escapeXml(target)}" />`;
    }
    const body = failures
      .map((f) => `      <failure type="${escapeXml(f.ruleId)}">${escapeXml(f.summary)}</failure>`)
      .join('\n');
    return `    <testcase classname="autoqa" name="${escapeXml(target)}">\n${body}\n    </testcase>`;
  });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<testsuites>',
    `  <testsuite name="AutoQA" tests="${run.plan.items.length}" failures="${blocking.length}" timestamp="${run.startedAt.toISOString()}">`,
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
