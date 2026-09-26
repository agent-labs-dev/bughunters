import type { Finding, Run } from '@bughunters/core';
import { ExitCode } from '@bughunters/core';

export type CheckAnnotation = {
  path: string;
  start_line: number;
  end_line: number;
  annotation_level: 'failure' | 'warning' | 'notice';
  title: string;
  message: string;
};

export type CheckRunPayload = {
  name: string;
  conclusion: 'success' | 'failure' | 'neutral' | 'action_required';
  output: { title: string; summary: string; annotations: CheckAnnotation[] };
};

/** GitHub caps annotations per request. */
const MAX_ANNOTATIONS = 50;

/**
 * Annotations are where Bughunters meets engineers in their normal workflow: a red
 * squiggle on the changed component is worth more than a report nobody opens
 * (spec 5.1).
 *
 * Note the conclusion mapping. An infrastructure failure is `neutral`, never
 * `failure` -- conflating "could not test" with "found a bug" is how CI gets
 * distrusted.
 */
export function buildCheckRun(run: Run, findings: Finding[]): CheckRunPayload {
  const blocking = findings.filter((f) => f.route === 'check');

  const conclusion: CheckRunPayload['conclusion'] =
    run.exitCode === ExitCode.Infrastructure
      ? 'neutral'
      : run.exitCode === ExitCode.ReconRequired
        ? 'action_required'
        : blocking.length > 0
          ? 'failure'
          : 'success';

  const annotations: CheckAnnotation[] = findings
    .filter((f) => f.suspectedFiles.length > 0)
    .slice(0, MAX_ANNOTATIONS)
    .map((f) => ({
      path: String(f.suspectedFiles[0]),
      start_line: 1,
      end_line: 1,
      annotation_level: f.route === 'check' ? 'failure' : f.severity === 'cosmetic' ? 'notice' : 'warning',
      title: f.ruleId,
      message: f.summary,
    }));

  return {
    name: 'Bughunters',
    conclusion,
    output: {
      title: summaryTitle(run, blocking.length),
      summary: [
        `Mode: \`${run.mode}\` · ${run.plan.coverage.screensSelected}/${run.plan.coverage.screensTotal} screens · mapping confidence ${(run.plan.mappingConfidence * 100).toFixed(0)}%`,
        '',
        run.exitCode === ExitCode.Infrastructure
          ? 'Bughunters could not test this change. This is an infrastructure failure and does not indicate a product defect.'
          : blocking.length > 0
            ? `${blocking.length} tier-1 regression(s). Only deterministic regressions can turn this check red.`
            : 'No tier-1 regressions.',
        run.suppressionCount > 0 ? `\n${run.suppressionCount} finding(s) suppressed by the Intent Ledger.` : '',
      ].join('\n'),
      annotations,
    },
  };
}

function summaryTitle(run: Run, blockingCount: number): string {
  if (run.exitCode === ExitCode.Infrastructure) return 'Could not test';
  if (run.exitCode === ExitCode.ReconRequired) return 'Recon required';
  return blockingCount > 0 ? `${blockingCount} regression(s)` : 'No regressions';
}
