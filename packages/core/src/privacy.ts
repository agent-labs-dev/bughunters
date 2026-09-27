import { PNG } from 'pngjs';
export type PrivacyRegion = { x: number; y: number; width: number; height: number };
export function overlaps(a: PrivacyRegion, b: PrivacyRegion): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}
/** Opaque pixel replacement, never blur. Coordinates are logical pixels. */
export function maskScreenshot(bytes: Buffer, regions: PrivacyRegion[], scale = 1): Buffer {
  if (!regions.length) return bytes;
  const png = PNG.sync.read(bytes);
  for (const region of regions) {
    const left = Math.max(0, Math.floor(region.x * scale));
    const top = Math.max(0, Math.floor(region.y * scale));
    const right = Math.min(png.width, Math.ceil((region.x + region.width) * scale));
    const bottom = Math.min(png.height, Math.ceil((region.y + region.height) * scale));
    for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
      const offset = (y * png.width + x) * 4;
      png.data[offset] = 0; png.data[offset + 1] = 0; png.data[offset + 2] = 0; png.data[offset + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}
