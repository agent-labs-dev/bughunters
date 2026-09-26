import { ConfigError, type BughuntersConfig } from '@bughunters/core';
import type { Driver } from './types.js';
import { WebDriver } from './web.js';
import { ElectronDriver } from './electron.js';
import { MaestroDriver } from './maestro.js';

/** Pick the transport configured for the app while resolving captured endpoints. */
export function createDriver(config: BughuntersConfig, vars: (value: string) => string): Driver {
  const { platform, connect } = config.app;
  if (platform === 'web') {
    const url = connect.url ?? config.run?.url;
    if (!url) {
      throw new ConfigError('Web driver requires app.connect.url or run.url');
    }
    const viewport = config.viewports[0]!;
    return new WebDriver({
      url: vars(url),
      viewport: { width: viewport.width, height: viewport.height },
    });
  }
  if (platform === 'electron') {
    if (!connect.cdp) {
      throw new ConfigError('Electron driver requires app.connect.cdp');
    }
    return new ElectronDriver(vars(connect.cdp));
  }
  if (!connect.appId) {
    throw new ConfigError(`${platform} driver requires app.connect.appId`);
  }
  return new MaestroDriver(platform, {
    appId: vars(connect.appId),
    device: connect.device ? vars(connect.device) : undefined,
  });
}
