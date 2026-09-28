import { type Browser, type BrowserContext, chromium, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { observeDom, resolveTarget } from './dom.js';
import { WebDriver } from './web.js';

let browser: Browser;
let context: BrowserContext;
let page: Page;

class FixtureDriver extends WebDriver {
  bind(browserValue: Browser, contextValue: BrowserContext, pageValue: Page): void {
    this.browser = browserValue;
    this.context = contextValue;
    this.page = pageValue;
  }
}

beforeAll(async () => {
  browser = await chromium.launch();
  context = await browser.newContext({ viewport: { width: 800, height: 600 } });
  page = await context.newPage();
  await page.setContent(`
    <label for="email">Email address</label>
    <input id="email" type="email" value="before">
    <label>Unbound note</label>
    <label>Middle name <input id="middle"></label>
    <input data-testid="secret" type="password" value="not-a-secret" aria-label="Password">
    <input placeholder="Search things">
    <button data-testid="save">Save</button>
    <button>Save</button>
    <h1>Dashboard</h1>
    <div role="button" aria-label="More options">...</div>
  `);
});

afterAll(async () => {
  await browser?.close();
});

describe('DOM driver', () => {
  it('records document-order refs, accessible names, safe values, and unique selectors', async () => {
    const elements = await observeDom(page);
    expect(elements.map((element) => element.ref)).toEqual(elements.map((_, index) => `e${index + 1}`));
    expect(elements.find((element) => element.selector === '#email')?.name).toBe('Email address');
    expect(elements.find((element) => element.testId === 'secret')).toMatchObject({
      name: 'Password',
      value: '••••',
    });
    expect(elements.filter((element) => element.name === 'Email address')).toHaveLength(1);
    expect(elements.filter((element) => element.name === 'Middle name')).toHaveLength(1);
    expect(elements.find((element) => element.name === 'Unbound note')?.role).toBe('label');
    expect(elements.find((element) => element.name === 'Search things')?.role).toBe('textbox');
    expect(elements.find((element) => element.name === 'Dashboard')?.role).toBe('heading');
    for (const element of elements) expect(await page.locator(element.selector!).count()).toBe(1);
  });

  it('resolves locators in priority order and marks point fallback degraded', async () => {
    const byId = await resolveTarget(page, { testId: 'save', role: 'button', name: 'Other' });
    expect(await byId.locator?.getAttribute('data-testid')).toBe('save');
    const byRole = await resolveTarget(page, { testId: 'missing', role: 'button', name: 'Save' });
    expect(byRole.degraded).toBe(false);
    const byText = await resolveTarget(page, { text: 'Dashboard' });
    expect(await byText.locator?.textContent()).toBe('Dashboard');
    const byPoint = await resolveTarget(page, { testId: 'missing', point: { x: 12, y: 34 } });
    expect(byPoint).toMatchObject({ point: { x: 12, y: 34 }, degraded: true });
  });

  it('acts on refs and records stable locators without refs', async () => {
    const driver = new FixtureDriver({ url: '', viewport: { width: 800, height: 600 } });
    driver.bind(browser, context, page);
    const observation = await driver.observe();
    const input = observation.elements.find((element) => element.name === 'Email address')!;
    const typed = await driver.act({ kind: 'type', ref: input.ref, value: 'after' });
    expect(typed).toMatchObject({
      ok: true,
      step: {
        kind: 'type',
        target: { role: 'textbox', name: 'Email address', selector: '#email' },
      },
    });
    expect(JSON.stringify(typed.step)).not.toContain('"ref"');
    expect(await page.locator('#email').inputValue()).toBe('after');
    const appended = await driver.act({ kind: 'type', ref: input.ref, value: ' more', append: true });
    expect(await page.locator('#email').inputValue()).toBe('after more');
    expect(appended.step).toMatchObject({ kind: 'type', append: true });
    const save = observation.elements.find((element) => element.testId === 'save')!;
    const tapped = await driver.act({ kind: 'tap', ref: save.ref });
    expect(tapped).toMatchObject({ ok: true, step: { kind: 'tap', target: { testId: 'save' } } });
  });
});
