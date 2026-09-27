import { expect, it } from 'vitest';
import { WebDriver } from './web.js';
it('masks private web content and removes its text before observation leaves the driver', async () => {
  const driver = new WebDriver({ url: 'data:text/html,<div data-private style="width:100px;height:100px;background:red">secret-value</div><input value="private-value"><button>Public</button>', viewport: { width: 300, height: 300 } });
  try {
    await driver.connect();
    const observation = await driver.observe();
    expect(JSON.stringify(observation.elements)).not.toContain('secret-value');
    expect(JSON.stringify(observation.elements)).not.toContain('private-value');
    expect(observation.elements.some(item => item.name === 'Public' || item.text === 'Public')).toBe(true);
    const snapshot = driver.snapshot(observation, 'test');
    expect(snapshot.elements.some(item => item.selector.includes('data-private'))).toBe(false);
  } finally { await driver.close(); }
});
