import { ConfigError } from '@bugpatrol/core';

/**
 * `bugpatrol` alone, or with only patrol flags, is `bugpatrol patrol`: the
 * patrol is the main command. The help and version flags stay as they are.
 */
export function withDefaultCommand(args: string[]): string[] {
  const [first] = args;
  if (first === undefined) return ['patrol'];
  if (['--help', '-h', '--version', '-v'].includes(first)) return args;
  return first.startsWith('-') ? ['patrol', ...args] : args;
}

/**
 * The env vars from before the rename (BUGHUNTERS_MODEL_API_KEY and the rest)
 * still work: each one fills its BUGPATROL_ var when that var is not set.
 */
export function legacyEnv(env: NodeJS.ProcessEnv): void {
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith('BUGHUNTERS_')) continue;
    const current = `BUGPATROL_${key.slice('BUGHUNTERS_'.length)}`;
    if (env[current] === undefined) env[current] = value;
  }
}

/** Selects a profile without changing the project root or consuming command flags. */
export function configArgs(args: string[]): { args: string[]; configFile?: string } {
  const index = args.indexOf('--config');
  if (index === -1) return { args };
  const configFile = args[index + 1];
  if (!configFile || configFile.startsWith('-')) throw new ConfigError('--config requires a file path');
  const remaining = [...args.slice(0, index), ...args.slice(index + 2)];
  if (remaining.includes('--config')) throw new ConfigError('Specify --config only once');
  return { args: remaining, configFile };
}
