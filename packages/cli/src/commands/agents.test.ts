import { describe, expect, it } from 'vitest';
import { parseAgentFlags } from './agents.js';

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
