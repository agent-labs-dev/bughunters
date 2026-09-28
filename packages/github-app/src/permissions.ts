export type PermissionLevel = 'read' | 'write';

export type PermissionSpec = {
  name: string;
  level: PermissionLevel;
  neededFor: string;
  /** 'always', or the config flag that unlocks the request. */
  requestedWhen: 'always' | string;
};

/**
 * Most tools in this category request a broad, fixed permission set. Bugpatrol
 * requests the minimum for the mode actually in use, and asks for more only
 * when the feature that needs it is enabled (spec 10.1).
 *
 * The row that matters is `contents: write`: read-only access to code is the
 * default, and write access is a separate, deliberate grant. An org that only
 * wants reports never grants it.
 */
export const PERMISSIONS: PermissionSpec[] = [
  { name: 'metadata', level: 'read', neededFor: 'Identifying the repo', requestedWhen: 'always' },
  { name: 'contents', level: 'read', neededFor: 'Cloning, reading config, mapping changes', requestedWhen: 'always' },
  { name: 'checks', level: 'write', neededFor: 'Check runs and file/line annotations', requestedWhen: 'always' },
  { name: 'issues', level: 'write', neededFor: 'Filing bugs and questions', requestedWhen: 'always' },
  { name: 'pull_requests', level: 'write', neededFor: 'The sticky PR comment', requestedWhen: 'always' },
  { name: 'actions', level: 'read', neededFor: 'Reading CI artifacts', requestedWhen: 'surfaces.readArtifacts' },
  { name: 'contents', level: 'write', neededFor: 'Creating the fix branch and commits', requestedWhen: 'surfaces.fixPRs' },
];

export function requiredPermissions(enabled: { fixPRs: boolean; readArtifacts?: boolean }): PermissionSpec[] {
  return PERMISSIONS.filter((p) => {
    if (p.requestedWhen === 'always') return true;
    if (p.requestedWhen === 'surfaces.fixPRs') return enabled.fixPRs;
    if (p.requestedWhen === 'surfaces.readArtifacts') return enabled.readArtifacts ?? false;
    return false;
  });
}

export const SUBSCRIBED_EVENTS = [
  'installation',
  'installation_repositories',
  'push',
  'pull_request',
  'check_suite',
  'issue_comment',
] as const;

export const LABELS = {
  root: 'bugpatrol',
  bug: 'bugpatrol:bug',
  question: 'bugpatrol:question',
  regression: 'bugpatrol:regression',
  a11y: 'bugpatrol:a11y',
  content: 'bugpatrol:content',
  flow: 'bugpatrol:flow',
  fix: 'bugpatrol-fix',
  needsDecision: 'needs-decision',
} as const;
