import { ConfigError, ExitCode, describeExit, type RunMode } from '@bughunters/core';
import type { RunResult } from './run-pipeline.js';

export type RunFlags = {
  mode: RunMode;
  noModels: boolean;
  only?: string[];
  commit: string;
};

/**
 * `bughunters run [--all | --smoke | --screens a,b] [--no-models] [--commit sha]`
 *
 * Unknown flags are rejected rather than ignored: a mistyped `--smoek` that
 * silently runs the default mode is the kind of thing that gets noticed three
 * weeks later, when the coverage was never what anyone thought.
 */
export function parseRunFlags(args: string[]): RunFlags {
  const flags: RunFlags = { mode: 'changed-only', noModels: false, commit: 'working-tree' };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    switch (arg) {
      case '--all':
        flags.mode = 'all';
        break;
      case '--smoke':
        flags.mode = 'smoke';
        break;
      case '--no-models':
        flags.noModels = true;
        break;
      case '--screens': {
        const value = args[++i];
        if (!value) throw new ConfigError('--screens needs a comma-separated list, e.g. --screens /settings,/billing');
        flags.only = value.split(',').map((s) => s.trim()).filter(Boolean);
        break;
      }
      case '--commit': {
        const value = args[++i];
        if (!value) throw new ConfigError('--commit needs a value');
        flags.commit = value;
        break;
      }
      default:
        if (arg.startsWith('--screens=')) {
          flags.only = arg.slice('--screens='.length).split(',').map((s) => s.trim()).filter(Boolean);
          break;
        }
        throw new ConfigError(`Unknown flag for \`bughunters run\`: ${arg}`);
    }
  }

  return flags;
}

/**
 * The terminal summary. It leads with the verdict, then says what was NOT
 * checked -- coverage, suppressions and baselines created are the numbers that
 * tell you whether a green result means anything.
 */
export function formatRunSummary(result: RunResult): string {
  const { run, findings } = result;
  const blocking = findings.filter((f) => f.route === 'check');
  const questions = findings.filter((f) => f.route === 'question');
  const issues = findings.filter((f) => f.route === 'issue');

  const lines: string[] = [''];

  lines.push(
    blocking.length > 0
      ? `FAIL  ${blocking.length} tier-1 regression(s)`
      : run.status === 'incomplete'
        ? 'INCOMPLETE  the run did not finish deciding every screen'
        : 'PASS  no tier-1 regressions',
  );
  lines.push(
    `      ${run.plan.coverage.screensSelected}/${run.plan.coverage.screensTotal} screen(s), ${run.plan.items.length} capture(s), mode ${run.mode}`,
  );

  if (blocking.length > 0) {
    lines.push('', 'Blocking:');
    for (const f of blocking) lines.push(`  - ${f.summary}  [${f.ruleId}]`);
  }
  if (issues.length > 0) {
    lines.push('', 'Issues:');
    for (const f of issues.slice(0, 10)) lines.push(`  - ${f.summary}  [${f.ruleId}]`);
    if (issues.length > 10) lines.push(`  ... and ${issues.length - 10} more`);
  }
  if (questions.length > 0) {
    lines.push('', 'Needs a decision:');
    for (const f of questions.slice(0, 10)) lines.push(`  - ${f.summary}  [${f.ruleId}]`);
    if (questions.length > 10) lines.push(`  ... and ${questions.length - 10} more`);
  }

  if (run.suppressionCount > 0) {
    lines.push('', `${run.suppressionCount} finding(s) suppressed by the Intent Ledger.`);
  }
  for (const note of result.notes) lines.push(`note: ${note}`);

  lines.push('', `Report: ${result.reportPath}`);
  lines.push(`Exit ${run.exitCode} (${describeExit(run.exitCode)})`);
  if (run.exitCode === ExitCode.Clean && run.cost.decisionUsd > 0) {
    lines.push(`Decision spend: $${run.cost.decisionUsd.toFixed(5)}`);
  }
  lines.push('');

  return lines.join('\n');
}
