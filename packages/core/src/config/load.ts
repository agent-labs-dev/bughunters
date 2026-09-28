import { existsSync, readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import type { z } from 'zod';
import { ConfigError } from '../errors.js';
import { BUGPATROL_DIR, CONFIG_FILENAME, legacyLayout, paths } from '../paths.js';
import type { runSchema } from './schema.js';
import { type BugpatrolConfig, bugpatrolConfigSchema } from './schema.js';

/**
 * Config precedence: CLI flags > repo bugpatrol.yml > org defaults > detected
 * defaults (spec 9.3). This loader handles the middle two; the CLI layers flags
 * on top of whatever comes back. `root` is the project root: the folder that
 * holds `.bugpatrol/`.
 */
export function loadConfig(root = process.cwd(), overrides: Partial<BugpatrolConfig> = {}): BugpatrolConfig {
  const path = paths.config(root);
  if (!existsSync(path)) {
    const legacy = legacyLayout(root);
    if (legacy) throw new ConfigError(legacy);
    throw new ConfigError(
      `No ${BUGPATROL_DIR}/${CONFIG_FILENAME} found in ${root} or above it. Run \`bugpatrol init\` first.`,
    );
  }

  let raw: unknown;
  try {
    raw = parseYaml(readFileSync(path, 'utf8'));
  } catch (cause) {
    throw new ConfigError(`${CONFIG_FILENAME} is not valid YAML`, { cause });
  }

  return parseConfig(mergeShallow(raw, overrides), path);
}

export function parseConfig(raw: unknown, source = '<inline>'): BugpatrolConfig {
  const result = bugpatrolConfigSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join('.') || '<root>'}: ${i.message}`).join('\n');
    throw new ConfigError(`Invalid config in ${source}:\n${issues}`);
  }
  return result.data;
}

function mergeShallow(raw: unknown, overrides: Partial<BugpatrolConfig>): unknown {
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
 * `bugpatrol run` and the web driver need it; other platforms start through
 * `app.setup` (ADR 0005).
 */
export function requireRun(config: BugpatrolConfig): z.infer<typeof runSchema> {
  if (!config.run) {
    throw new ConfigError('This command needs a `run` block (command and url) in bugpatrol.yml.');
  }
  return config.run;
}
