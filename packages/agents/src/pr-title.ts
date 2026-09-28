/**
 * Pull request titles in the Conventional Commits form: `type(scope): description`.
 * Most repositories squash-merge, so the PR title becomes the commit on the
 * default branch, and their release tools and hooks read that form.
 */
export const PR_TYPES = ['fix', 'feat', 'perf', 'refactor', 'test', 'chore', 'docs', 'style'] as const;

const MAX = 72;
const FORM = /^[a-z]+(\([a-z0-9][a-z0-9._/-]*\))?!?: \S.*$/;

/** The scope of a commit template such as `fix(app): {title}`, if it has one. */
export function templateScope(template: string): string | undefined {
  return /^[a-z]+\(([^)]+)\)/.exec(template)?.[1];
}

export function isConventional(title: string): boolean {
  return FORM.test(title) && title.length <= MAX;
}

export function buildPrTitle(input: {
  type: string;
  scope?: string;
  description: string;
}): { ok: true; title: string } | { ok: false; reason: string } {
  const type = input.type.trim().toLowerCase();
  if (!(PR_TYPES as readonly string[]).includes(type)) {
    return { ok: false, reason: `The type "${input.type}" is not one of: ${PR_TYPES.join(', ')}.` };
  }
  const scope = input.scope?.trim().toLowerCase();
  let description = input.description.trim().replace(/\.+$/, '');
  // "Expand the sidebar" → "expand the sidebar", but keep "API" or "iOS" as written.
  if (/^[A-Z][a-z]/.test(description)) description = description[0]!.toLowerCase() + description.slice(1);
  const title = `${type}${scope ? `(${scope})` : ''}: ${description}`;
  if (!description) return { ok: false, reason: 'The description is missing.' };
  if (title.length > MAX) {
    return {
      ok: false,
      reason: `The title "${title}" has ${title.length} characters; the limit is ${MAX}. Write a shorter description.`,
    };
  }
  if (!FORM.test(title)) {
    return { ok: false, reason: `The title "${title}" is not in the form type(scope): description.` };
  }
  return { ok: true, title };
}
