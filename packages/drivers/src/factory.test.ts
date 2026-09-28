import { describe, expect, it } from 'vitest';
import { ConfigError, bugpatrolConfigSchema } from '@bugpatrol/core';
import { createDriver } from './factory.js';

const vars = (value: string) => value;

describe('createDriver', () => {
  it('requires a CDP endpoint for Electron', () => {
    const config = bugpatrolConfigSchema.parse({ version: 1, app: { platform: 'electron' } });
    expect(() => createDriver(config, vars)).toThrow(ConfigError);
    expect(() => createDriver(config, vars)).toThrow('app.connect.cdp');
  });

  it.each(['ios', 'android'] as const)('requires an app id for %s', (platform) => {
    const config = bugpatrolConfigSchema.parse({ version: 1, app: { platform } });
    expect(() => createDriver(config, vars)).toThrow(ConfigError);
    expect(() => createDriver(config, vars)).toThrow('app.connect.appId');
  });
});
