import { maskScreenshot, overlaps, permitsUrl, type PrivacyRegion, type AppConfig } from '@bughunters/core';
import type { Driver, DriverAction, Observation, ActResult } from './types.js';

export type ActionPolicy = AppConfig['safety'];
const destructive = /\b(delete|remove|destroy|revoke|cancel|deactivate|purge|wipe|reset|purchase|pay|send|publish)\b/i;

/** The same fence surrounds exploration and replay because both use Driver.act. */
export class PolicyDriver implements Driver {
  readonly platform;
  constructor(private readonly driver: Driver, private readonly policy: ActionPolicy, private readonly origins: string[], private readonly regions: PrivacyRegion[] = []) {
    this.platform = driver.platform;
  }
  connect() { return this.driver.connect(); }
  async observe() {
    const observation = await this.driver.observe();
    if (!this.regions.length) return observation;
    return { ...observation, screenshot: maskScreenshot(observation.screenshot, this.regions, observation.viewport.scale),
      elements: observation.elements.filter((item) => !this.regions.some((region) => overlaps(item.box, region))) };
  }
  settle(options?: Parameters<Driver['settle']>[0]) { return this.driver.settle(options); }
  snapshot(observation: Observation, screenId: string) { const snapshot = this.driver.snapshot(observation, screenId);
    return { ...snapshot, elements: snapshot.elements.filter((item) => !this.regions.some((region) => overlaps(item.box, region))) }; }
  close() { return this.driver.close(); }

  async act(action: DriverAction): Promise<ActResult> {
    const deny = (reason: string): ActResult => ({ ok: false, error: `Action denied: ${reason}` });
    if (action.kind === 'wait') {
      if (!Number.isFinite(action.ms) || action.ms < 0 || action.ms > 10_000) return deny('wait must be between 0 and 10000 ms');
      return this.driver.act(action);
    }
    if (action.kind === 'scroll') return this.driver.act(action);
    // Navigation, back, and keyboard shortcuts can also mutate application state.
    if (this.policy.mode !== 'test') return deny('set app.safety.mode: test only for an isolated test environment');
    if (action.kind === 'open') {
      if (this.platform === 'web' || this.platform === 'electron') {
        if (!permitsUrl(action.url, this.origins)) return deny('URL is outside the configured HTTP origins');
      } else {
        try {
          const url = new URL(action.url);
          const permitted = this.policy.deepLinkOrigins.some((allowed) => {
            const other = new URL(allowed);
            return url.protocol === other.protocol && url.host === other.host;
          });
          if (!permitted || url.username || url.password || ['file:', 'javascript:', 'data:'].includes(url.protocol)) return deny('deep link is not allowed');
        } catch { return deny('invalid deep link'); }
      }
    }
    if (!this.policy.allowDestructive && (action.kind === 'tap' || action.kind === 'type')) {
      const observation = await this.driver.observe();
      const target = action.ref ? observation.elements.find((item) => item.ref === action.ref)
        : action.locator ? observation.elements.find((item) =>
          action.locator?.testId ? item.testId === action.locator.testId :
          action.locator?.selector ? item.selector === action.locator.selector :
          action.locator?.name ? item.name === action.locator.name : false)
        : observation.elements.find((item) => item.focused);
      if (!target || destructive.test(`${target.name} ${target.text ?? ''}`)) return deny('target is unknown or potentially destructive');
    }
    if (!this.policy.allowDestructive && action.kind === 'press' && /delete|backspace|enter|return|space/i.test(action.key)) {
      return deny('use a named control; destructive keyboard activation is disabled');
    }
    return this.driver.act(action);
  }
}
