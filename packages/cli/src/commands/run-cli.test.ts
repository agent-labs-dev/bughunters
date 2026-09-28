import { describe, expect, it } from 'vitest';
import { parseRunFlags } from './run-cli.js';
import { ConfigError } from '@bugpatrol/core';

describe('parseRunFlags', () => {
  it('defaults to changed-only with models enabled', () => {
    expect(parseRunFlags([])).toEqual({ mode: 'changed-only', noModels: false, commit: 'working-tree' });
  });

  it('parses the mode flags', () => {
    expect(parseRunFlags(['--all']).mode).toBe('all');
    expect(parseRunFlags(['--smoke']).mode).toBe('smoke');
  });

  it('parses --screens in both spellings', () => {
    expect(parseRunFlags(['--screens', '/a,/b']).only).toEqual(['/a', '/b']);
    expect(parseRunFlags(['--screens=/a, /b']).only).toEqual(['/a', '/b']);
  });

  it('rejects an unknown flag rather than silently running the default mode', () => {
    // A mistyped --smoek that quietly runs changed-only is noticed three weeks
    // later, when the coverage was never what anyone thought.
    expect(() => parseRunFlags(['--smoek'])).toThrow(ConfigError);
  });

  it('rejects a flag that is missing its value', () => {
    expect(() => parseRunFlags(['--screens'])).toThrow(ConfigError);
  });
});
