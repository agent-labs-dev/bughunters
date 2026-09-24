import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { sha256 } from '@autoqa/core';
import { PROBE_SOURCE, type ScreenSnapshot } from '@autoqa/invariants';
import { observeDom, resolveTarget, stepFor } from './dom.js';
import type { ActResult, Driver, DriverAction, Observation, UiElement } from './types.js';

export type WebOptions = {
  url: string;
  viewport: { width: number; height: number };
  headless?: boolean;
};

type TargetResult = { degraded: boolean; element?: UiElement };

/** Browser and CDP drivers share observation and action semantics across startup modes. */
export class WebDriver implements Driver {
  readonly platform: 'web' | 'electron' = 'web';
  protected browser?: Browser;
  protected context?: BrowserContext;
  protected page?: Page;
  protected lastObservation?: Observation;
  private readonly errors = new Map<Page, string[]>();
  private readonly watched = new WeakSet<Page>();

  constructor(protected readonly options: WebOptions) {}

  async connect(): Promise<void> {
    this.browser = await chromium.launch({ headless: this.options.headless ?? true });
    this.context = await this.browser.newContext({
      viewport: this.options.viewport,
      reducedMotion: 'reduce',
    });
    this.context.on('page', (page) => this.watch(page));
    this.page = await this.context.newPage();
    this.watch(this.page);
    await this.page.goto(this.options.url);
  }

  protected activePage(): Page {
    if (!this.page) {
      throw new Error('Driver is not connected');
    }
    return this.page;
  }

  protected watch(page: Page): void {
    if (this.watched.has(page)) {
      return;
    }
    this.watched.add(page);
    const errors: string[] = [];
    this.errors.set(page, errors);
    page.on('console', (message) => {
      if (message.type() === 'error') {
        errors.push(message.text());
      }
    });
    page.on('pageerror', (error) => errors.push(`${error.name}: ${error.message}`));
  }

  async observe(): Promise<Observation> {
    const page = this.activePage();
    const context = this.context!;
    for (const candidate of context.pages()) {
      this.watch(candidate);
    }
    const [screenshot, elements, title] = await Promise.all([
      page.screenshot({ fullPage: false }),
      observeDom(page),
      page.title(),
    ]);
    await this.captureProbe();
    const windows = await Promise.all(context.pages().map(async (candidate, index) => ({
      id: String(index),
      title: await candidate.title().catch(() => ''),
      location: candidate.url(),
      active: candidate === page,
    })));
    const size = page.viewportSize() ?? await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    const errors = this.errors.get(page) ?? [];
    const observation: Observation = {
      platform: this.platform,
      location: page.url(),
      title,
      screenshot,
      viewport: { ...size, scale: 1 },
      elements,
      windows,
      volatileRegions: [],
      consoleErrors: errors.splice(0),
      at: new Date().toISOString(),
    };
    this.lastObservation = observation;
    return observation;
  }

  private async tap(page: Page, action: Extract<DriverAction, { kind: 'tap' }>): Promise<TargetResult> {
    const target = action.ref ?? action.locator;
    if (!target) {
      throw new Error('Tap needs a target');
    }
    const resolved = await resolveTarget(page, target, this.lastObservation);
    if (resolved.locator) {
      await resolved.locator.click();
    } else {
      await page.mouse.click(resolved.point!.x, resolved.point!.y);
    }
    return { degraded: resolved.degraded, element: resolved.element };
  }

  private async type(page: Page, action: Extract<DriverAction, { kind: 'type' }>): Promise<TargetResult> {
    const target = action.ref ?? action.locator;
    let result: TargetResult = { degraded: false };
    if (target) {
      const resolved = await resolveTarget(page, target, this.lastObservation);
      result = { degraded: resolved.degraded, element: resolved.element };
      if (resolved.locator) {
        await resolved.locator.fill(action.value);
      } else {
        await page.mouse.click(resolved.point!.x, resolved.point!.y);
        await page.keyboard.insertText(action.value);
      }
    } else {
      await page.keyboard.insertText(action.value);
    }
    if (action.submit) {
      await page.keyboard.press('Enter');
    }
    return result;
  }

  private async scroll(page: Page, action: Extract<DriverAction, { kind: 'scroll' }>): Promise<TargetResult> {
    const target = action.ref ?? action.locator;
    let result: TargetResult = { degraded: false };
    if (target) {
      const resolved = await resolveTarget(page, target, this.lastObservation);
      result = { degraded: resolved.degraded, element: resolved.element };
      if (resolved.locator) {
        await resolved.locator.scrollIntoViewIfNeeded();
      }
    }
    const distance = 550;
    const x = action.direction === 'left' ? -distance : action.direction === 'right' ? distance : 0;
    const y = action.direction === 'up' ? -distance : action.direction === 'down' ? distance : 0;
    await page.mouse.wheel(x, y);
    return result;
  }

  private async switchWindow(action: Extract<DriverAction, { kind: 'window' }>): Promise<void> {
    const match = action.match.toLowerCase();
    const pages = this.context!.pages();
    const found = await Promise.all(pages.map(async (candidate) => ({
      candidate,
      title: await candidate.title().catch(() => ''),
    })));
    const chosen = found.find(({ candidate, title }) =>
      candidate.url().toLowerCase().includes(match) || title.toLowerCase().includes(match));
    if (!chosen) {
      throw new Error(`Window not found: ${action.match}`);
    }
    this.page = chosen.candidate;
    await this.page.bringToFront();
  }

  async act(action: DriverAction): Promise<ActResult> {
    try {
      const page = this.activePage();
      let result: TargetResult = { degraded: false };
      switch (action.kind) {
        case 'tap':
          result = await this.tap(page, action);
          break;
        case 'type':
          result = await this.type(page, action);
          break;
        case 'scroll':
          result = await this.scroll(page, action);
          break;
        case 'press':
          await page.keyboard.press(playwrightKey(action.key));
          break;
        case 'back':
          await page.goBack();
          break;
        case 'open':
          await page.goto(action.url);
          break;
        case 'wait':
          await page.waitForTimeout(action.ms);
          break;
        case 'window':
          await this.switchWindow(action);
          break;
      }
      await this.activePage().waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
      const fallback = 'locator' in action ? action.locator : undefined;
      return {
        ok: true,
        degraded: result.degraded,
        step: stepFor(action, result.element, fallback),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: message.slice(0, 200) };
    }
  }

  async settle(
    options: { timeoutMs?: number; intervalMs?: number } = {},
  ): Promise<{ frames: number; stable: boolean }> {
    const page = this.activePage();
    const timeout = options.timeoutMs ?? 5000;
    const interval = options.intervalMs ?? 150;
    const start = Date.now();
    let previous = '';
    let frames = 0;
    while (Date.now() - start < timeout) {
      const current = sha256(await page.screenshot({ fullPage: false }));
      frames++;
      if (current === previous) {
        return { frames, stable: true };
      }
      previous = current;
      await page.waitForTimeout(interval);
    }
    return { frames, stable: false };
  }

  snapshot(observation: Observation, screenId: string): ScreenSnapshot {
    const probe = this.probe;
    if (!probe) {
      throw new Error('Observe before taking a snapshot');
    }
    return {
      ...probe,
      screenId,
      viewport: {
        name: this.platform === 'web' ? 'window' : 'desktop',
        width: observation.viewport.width,
        height: observation.viewport.height,
      },
      consoleErrors: observation.consoleErrors,
    };
  }

  private probe?: Omit<ScreenSnapshot, 'screenId' | 'viewport' | 'consoleErrors'>;

  protected async captureProbe(): Promise<void> {
    this.probe = await this.activePage().evaluate(PROBE_SOURCE) as typeof this.probe;
  }

  async close(): Promise<void> {
    await this.context?.close();
    await this.browser?.close();
  }
}

const KEY_NAMES: Record<string, string> = {
  enter: 'Enter', return: 'Enter', esc: 'Escape', escape: 'Escape', tab: 'Tab', space: 'Space',
  backspace: 'Backspace', delete: 'Delete', up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft',
  right: 'ArrowRight', arrowup: 'ArrowUp', arrowdown: 'ArrowDown', arrowleft: 'ArrowLeft',
  arrowright: 'ArrowRight', home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown',
  cmd: 'Meta', command: 'Meta', meta: 'Meta', ctrl: 'Control', control: 'Control', alt: 'Alt',
  option: 'Alt', shift: 'Shift',
};

/**
 * Models write key names loosely ("enter", "cmd+k", "Esc"), and Playwright
 * rejects anything that is not its exact name. Each part of a chord is mapped
 * on its own; anything unknown passes through unchanged.
 */
export function playwrightKey(key: string): string {
  return key
    .split('+')
    .map((part) => KEY_NAMES[part.trim().toLowerCase()] ?? part.trim())
    .join('+');
}
