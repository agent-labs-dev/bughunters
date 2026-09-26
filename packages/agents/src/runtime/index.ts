import type { RoleRuntime } from '@bughunters/core';
import type { Runtime } from '../types.js';
import { CliRuntime } from './cli.js';
import { ModelRuntime } from './model.js';

/** Selects the configured execution loop without changing the role's tool contract. */
export function createRuntime(use: RoleRuntime, opts: { fetch?: typeof fetch } = {}): Runtime {
  return use.runtime === 'model' ? new ModelRuntime(use, opts) : new CliRuntime(use);
}

/** Gives status displays a stable, short label for a configured runtime. */
export function describeRuntime(use: RoleRuntime): string {
  return use.runtime === 'model' ? `model:${use.via}/${use.model}` : `cli:${use.command.split(/\s+/)[0] ?? 'shell'}`;
}

export { CliRuntime, ModelRuntime };
