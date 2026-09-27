import { createServer, type RequestListener } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { WebDriver } from './web.js';
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
async function server(handler: RequestListener) {
  const http = createServer(handler);
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  cleanup.push(() => new Promise<void>((resolve) => { http.closeAllConnections(); http.close(() => resolve()); }));
  return `http://127.0.0.1:${(http.address() as { port: number }).port}`;
}
describe('browser network policy', () => {
  it('blocks a redirect to an unlisted origin before contacting it', async () => {
    let contacted = 0;
    const outside = await server((_req, res) => { contacted++; res.end('outside'); });
    const origin = await server((req, res) => { res.writeHead(302, { location: req.url === '/' ? '/second' : outside }); res.end(); });
    const driver = new WebDriver({ url: origin, viewport: { width: 400, height: 300 }, policy: { origins: [origin], mutations: true } });
    cleanup.push(() => driver.close());
    await expect(driver.connect()).rejects.toThrow();
    expect(contacted).toBe(0);
  });
  it('blocks startup POST requests in observation mode', async () => {
    let writes = 0;
    const origin = await server((req, res) => {
      if (req.method === 'POST') { writes++; res.end('written'); return; }
      res.setHeader('content-type', 'text/html');
      res.end('<script>fetch("/write", {method:"POST"}).catch(()=>{}).finally(()=>document.title="done")</script>');
    });
    const driver = new WebDriver({ url: origin, viewport: { width: 400, height: 300 }, policy: { origins: [origin], mutations: false } });
    cleanup.push(() => driver.close());
    await driver.connect();
    await driver.settle();
    expect((await driver.observe()).title).toBe('done');
    expect(writes).toBe(0);
  });
});
