import { describe, expect, it } from 'vitest';
import { bugpatrolArgs } from './args.js';

describe('bugpatrolArgs', () => {
  it('shows the help with no command, as bughunters did before', () => {
    expect(bugpatrolArgs([])).toEqual(['--help']);
  });

  it('passes every command through', () => {
    expect(bugpatrolArgs(['patrol', '--once'])).toEqual(['patrol', '--once']);
    expect(bugpatrolArgs(['dashboard', '--port', '5000'])).toEqual(['dashboard', '--port', '5000']);
  });
});
