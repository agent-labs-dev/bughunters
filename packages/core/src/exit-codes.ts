/**
 * Exit semantics are strictly separated (spec 5.1). Conflating an
 * infrastructure failure with a product failure is how CI gets distrusted:
 * "Bughunters could not test" is a different statement from "Bughunters found a bug",
 * and only the latter may ever turn a build red.
 */
export const ExitCode = {
  /** Clean, or non-blocking findings only. */
  Clean: 0,
  /** A tier-1 deterministic regression. The only exit that blocks a merge. */
  Regression: 1,
  /** Configuration or usage error. */
  Usage: 2,
  /** Recon required, or the AppModel is unapproved. */
  ReconRequired: 3,
  /** Could not boot, browser crashed, no network. Never blocks on its own. */
  Infrastructure: 4,
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];

export function describeExit(code: ExitCodeValue): string {
  switch (code) {
    case ExitCode.Clean:
      return 'clean, or non-blocking findings only';
    case ExitCode.Regression:
      return 'tier-1 regression detected';
    case ExitCode.Usage:
      return 'configuration or usage error';
    case ExitCode.ReconRequired:
      return 'recon required, or the AppModel is unapproved';
    case ExitCode.Infrastructure:
      return 'infrastructure error -- Bughunters could not test';
  }
}

export function blocksMerge(code: ExitCodeValue): boolean {
  return code === ExitCode.Regression;
}
