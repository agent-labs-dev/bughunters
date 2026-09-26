import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RecipeResolution, StackProfile } from '@bughunters/core';

export type BringUpCandidate = {
  command: string;
  rung: RecipeResolution;
  /** Which file implied this. Detection is a first guess, never silent. */
  source: string;
  confidence: number;
};

/**
 * The bring-up ladder, cheapest rung first (spec 1.1). Rungs 1-3 are pure file
 * reading and cost nothing; rung 4 (docs) and rung 5 (agentic trial) are only
 * reached when the cheap rungs come up empty, and rung 5 is budget-capped so
 * Recon terminates predictably rather than burning tokens.
 */
export function detectBringUp(root: string): BringUpCandidate[] {
  const candidates: BringUpCandidate[] = [];

  // Rung 2: precedent -- the command CI already uses is the one that works.
  for (const workflow of listWorkflows(root)) {
    const content = readFileSync(workflow, 'utf8');
    const match = content.match(/run:\s*(?:pnpm|npm|yarn|bun)\s+(?:run\s+)?(dev|start|preview|serve)\b/);
    if (match) {
      candidates.push({ command: match[0].replace(/^run:\s*/, ''), rung: 'precedent', source: workflow, confidence: 0.8 });
    }
  }

  // Rung 3: convention.
  const pkgPath = join(root, 'package.json');
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { scripts?: Record<string, string> };
    const manager = detectPackageManager(root);
    for (const script of ['dev', 'start', 'preview', 'serve']) {
      if (pkg.scripts?.[script]) {
        candidates.push({
          command: `${manager} ${script === 'start' ? 'start' : `run ${script}`}`,
          rung: 'convention',
          source: 'package.json',
          confidence: script === 'dev' ? 0.7 : 0.5,
        });
      }
    }
  }
  if (existsSync(join(root, 'docker-compose.yml')) || existsSync(join(root, 'compose.yaml'))) {
    candidates.push({ command: 'docker compose up', rung: 'convention', source: 'docker-compose.yml', confidence: 0.5 });
  }
  if (existsSync(join(root, 'Procfile'))) {
    candidates.push({ command: 'foreman start', rung: 'convention', source: 'Procfile', confidence: 0.3 });
  }

  return candidates.sort((a, b) => b.confidence - a.confidence);
}

export function detectPackageManager(root: string): NonNullable<StackProfile['packageManager']> {
  if (existsSync(join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(root, 'bun.lockb'))) return 'bun';
  if (existsSync(join(root, 'yarn.lock'))) return 'yarn';
  return 'npm';
}

/**
 * Stack detection, in order of reliability (spec, Phase 0). Everything detected
 * is written into the config with its provenance, so a human can see WHY a
 * value was chosen and correct it.
 */
export function detectStack(root: string): StackProfile {
  const detectedFrom: string[] = [];
  let framework: string | undefined;

  const signatures: Array<[string, string]> = [
    ['next.config.js', 'next'],
    ['next.config.ts', 'next'],
    ['next.config.mjs', 'next'],
    ['vite.config.ts', 'vite'],
    ['vite.config.js', 'vite'],
    ['angular.json', 'angular'],
    ['manage.py', 'django'],
    ['Gemfile', 'rails'],
    ['go.mod', 'go'],
    ['Cargo.toml', 'rust'],
    ['app.json', 'expo'],
  ];
  for (const [file, name] of signatures) {
    if (!existsSync(join(root, file))) continue;
    framework ??= name;
    detectedFrom.push(file);
  }

  const packageManager = detectPackageManager(root);
  detectedFrom.push(`${packageManager} lockfile`);

  return {
    framework,
    packageManager,
    detectedFrom,
    confidence: framework ? 0.8 : 0.3,
  };
}

function listWorkflows(root: string): string[] {
  const dir = join(root, '.github', 'workflows');
  if (!existsSync(dir)) return [];
  try {
    // Intentionally shallow: CI workflows are not nested.
    const { readdirSync } = require('node:fs') as typeof import('node:fs');
    return readdirSync(dir)
      .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
      .map((f) => join(dir, f));
  } catch {
    return [];
  }
}
