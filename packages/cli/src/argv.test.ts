import { describe, expect, it } from 'vitest';
import { legacyEnv, withDefaultCommand } from './argv.js';

describe('withDefaultCommand', () => {
  it('starts the patrol with no command, and keeps the patrol flags', () => {
    expect(withDefaultCommand([])).toEqual(['patrol']);
    expect(withDefaultCommand(['--once'])).toEqual(['patrol', '--once']);
    expect(withDefaultCommand(['--once', '--force'])).toEqual(['patrol', '--once', '--force']);
  });

  it('passes a command and the help and version flags through', () => {
    expect(withDefaultCommand(['init', '--yes'])).toEqual(['init', '--yes']);
    expect(withDefaultCommand(['patrol', '--once'])).toEqual(['patrol', '--once']);
    expect(withDefaultCommand(['--help'])).toEqual(['--help']);
    expect(withDefaultCommand(['-v'])).toEqual(['-v']);
  });
});

describe('legacyEnv', () => {
  it('fills each BUGPATROL_ var from its BUGHUNTERS_ var, and keeps a value that is set', () => {
    const env = { BUGHUNTERS_MODEL_API_KEY: 'old', BUGHUNTERS_MODEL_NAME: 'old', BUGPATROL_MODEL_NAME: 'new' };
    legacyEnv(env);
    expect(env).toMatchObject({ BUGPATROL_MODEL_API_KEY: 'old', BUGPATROL_MODEL_NAME: 'new' });
  });
});
