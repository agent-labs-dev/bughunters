export type SlashCommand =
  | { kind: 'run'; all: boolean }
  | { kind: 'explain'; findingId: string }
  | { kind: 'accept'; findingId: string; reason?: string }
  | { kind: 'mute'; fingerprint: string; expiresInDays?: number }
  | { kind: 'fix'; findingId: string }
  | { kind: 'baseline-update' };

/**
 * `/autoqa accept` is the most important command in the product: the one-action
 * escape hatch that converts a false positive into permanent context instead of
 * a grudge (spec 5.2).
 */
export function parseSlashCommand(body: string): SlashCommand | undefined {
  const line = body
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith('/autoqa'));
  if (!line) return undefined;

  const [, verb, ...rest] = line.split(/\s+/);

  switch (verb) {
    case 'run':
      return { kind: 'run', all: rest.includes('--all') };
    case 'explain':
      return rest[0] ? { kind: 'explain', findingId: rest[0] } : undefined;
    case 'accept': {
      if (!rest[0]) return undefined;
      const reasonMatch = line.match(/--reason\s+"([^"]+)"/);
      return { kind: 'accept', findingId: rest[0], reason: reasonMatch?.[1] };
    }
    case 'mute': {
      if (!rest[0]) return undefined;
      const expiry = line.match(/--expires\s+(\d+)d/);
      return { kind: 'mute', fingerprint: rest[0], expiresInDays: expiry ? Number(expiry[1]) : undefined };
    }
    case 'fix':
      return rest[0] ? { kind: 'fix', findingId: rest[0] } : undefined;
    case 'baseline':
      return rest[0] === 'update' ? { kind: 'baseline-update' } : undefined;
    default:
      return undefined;
  }
}
