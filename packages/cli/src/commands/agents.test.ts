import { describe, expect, it } from 'vitest';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseConfig } from '@bughunters/core';
import { parseAgentFlags, preflight } from './agents.js';

describe('preflight', () => {
  const bin = mkdtempSync(join(tmpdir(), 'bughunters-bin-'));
  writeFileSync(join(bin, 'claude'), '#!/bin/sh\n');
  chmodSync(join(bin, 'claude'), 0o755);
  const config = (agents: Record<string, unknown>) => parseConfig({ version: 1, app: { connect: { url: 'http://x' } }, agents });

  it('stops when a role has no key or no CLI, and names the fix', () => {
    expect(() => preflight('explore', config({}), { PATH: bin })).toThrow(/OPENROUTER_API_KEY is not set/);
    expect(() => preflight('judge', config({ judge: { use: 'codex' } }), { PATH: bin })).toThrow(/`codex`, but it is not on PATH/);
  });

  it('checks only the roles that the command runs', () => {
    const cfg = config({ explorer: { use: 'claude' }, judge: { use: 'claude' } });
    expect(() => preflight('explore', cfg, { PATH: bin })).not.toThrow();
    expect(() => preflight('fix', cfg, { PATH: bin })).not.toThrow();
    expect(() => preflight('fix', config({ explorer: { use: 'claude' }, judge: { use: 'claude' }, fixer: { use: 'kimi' } }), { PATH: bin }))
      .toThrow(/kimi/);
  });

  it('says which decider runs, and asks for a Jev key when there is none', () => {
    const cfg = config({ explorer: { use: 'claude' } });
    expect(preflight('explore', cfg, { PATH: bin })[0]).toContain('Set a Jev key');
    expect(preflight('explore', cfg, { PATH: bin, TYPESAFE_API_KEY: 'k' })[0]).toContain('jev via typesafe');
  });
});

describe('agent command flags', () => {
  it('accepts each command shape and repeated ids', () => {
    expect(parseAgentFlags('explore', ['--goal', 'Open Settings', '--steps', '12']))
      .toEqual({ goal: 'Open Settings', steps: 12 });
    expect(parseAgentFlags('judge', ['--session', 'a', 'b', '--session', 'c']))
      .toEqual({ session: ['a', 'b', 'c'] });
    expect(parseAgentFlags('fix', ['--issue', 'x', 'y'])).toEqual({ issue: ['x', 'y'] });
    expect(parseAgentFlags('retest', ['--issue', 'x'])).toEqual({ issue: ['x'] });
    expect(parseAgentFlags('patrol', ['--once'])).toEqual({ once: true });
    expect(parseAgentFlags('replay', ['enter-app'])).toEqual({ id: 'enter-app' });
  });

  it('rejects unknown flags and invalid step counts', () => {
    expect(() => parseAgentFlags('explore', ['--steps', '0'])).toThrow();
    expect(() => parseAgentFlags('patrol', ['--bad'])).toThrow();
    expect(() => parseAgentFlags('replay', [])).toThrow();
  });
});
