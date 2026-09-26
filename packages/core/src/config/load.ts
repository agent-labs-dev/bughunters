import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { bughuntersConfigSchema, type BughuntersConfig } from './schema.js';
import type { z } from 'zod';
import type { runSchema } from './schema.js';
import { ConfigError } from '../errors.js';

export const CONFIG_FILENAME = 'bughunters.yml';

/**
 * Config precedence: CLI flags > repo bughunters.yml > org defaults > detected
 * defaults (spec 9.3). This loader handles the middle two; the CLI layers flags
 * on top of whatever comes back.
 */
export function loadConfig(cwd = process.cwd(), overrides: Partial<BughuntersConfig> = {}): BughuntersConfig {
  const path = resolve(cwd, CONFIG_FILENAME);
  if (!existsSync(path)) {
    throw new ConfigError(`No ${CONFIG_FILENAME} found in ${cwd}. Run \`bughunters init\` first.`);
  }

  let raw: unknown;
  try {
    raw = parseYaml(readFileSync(path, 'utf8'));
  } catch (cause) {
    throw new ConfigError(`${CONFIG_FILENAME} is not valid YAML`, { cause });
  }

  return parseConfig(mergeShallow(raw, overrides), path);
}

export function parseConfig(raw: unknown, source = '<inline>'): BughuntersConfig {
  const result = bughuntersConfigSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join('.') || '<root>'}: ${i.message}`)
      .join('\n');
    throw new ConfigError(`Invalid config in ${source}:\n${issues}`);
  }
  return result.data;
}

function mergeShallow(raw: unknown, overrides: Partial<BughuntersConfig>): unknown {
  if (typeof raw !== 'object' || raw === null) return raw;
  return { ...(raw as Record<string, unknown>), ...overrides };
}

/**
 * Resolves ${VAR} references against the environment. Applied to the config
 * only at run time, in the process that drives the browser -- resolved values
 * never reach the model context, the artifacts, or the report.
 */
export function resolveSecretRefs<T>(value: T, env: NodeJS.ProcessEnv = process.env): T {
  if (typeof value === 'string') {
    return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_, name: string) => {
      const found = env[name];
      if (found === undefined) throw new ConfigError(`Secret ${name} is not set in the environment`);
      return found;
    }) as unknown as T;
  }
  if (Array.isArray(value)) return value.map((v) => resolveSecretRefs(v, env)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = resolveSecretRefs(v, env);
    return out as T;
  }
  return value;
}

/**
 * The `run` block, for commands that start a web app themselves. Only
 * `bughunters run` and the web driver need it; other platforms start through
 * `app.setup` (ADR 0005).
 */
export function requireRun(config: BughuntersConfig): z.infer<typeof runSchema> {
  if (!config.run) {
    throw new ConfigError('This command needs a `run` block (command and url) in bughunters.yml.');
  }
  return config.run;
}
