import { expect, it } from 'vitest';
import { PNG } from 'pngjs';
import { maskScreenshot } from './privacy.js';
it('replaces sensitive pixels opaquely at device scale and preserves other pixels', () => {
  const source = new PNG({ width: 4, height: 4 }); source.data.fill(255);
  const masked = PNG.sync.read(maskScreenshot(PNG.sync.write(source), [{ x: 0, y: 0, width: 1, height: 1 }], 2));
  expect([...masked.data.subarray(0, 4)]).toEqual([0, 0, 0, 255]);
  expect([...masked.data.subarray(20, 24)]).toEqual([0, 0, 0, 255]);
  expect([...masked.data.subarray(24, 28)]).toEqual([255, 255, 255, 255]);
});
