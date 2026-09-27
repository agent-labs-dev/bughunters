import { describe, expect, it } from 'vitest';
import { permitsUrl } from './origin.js';
describe('network origin policy', () => {
  it.each(['https://example.test.evil.test/', 'https://example.test@evil.test/', 'https://user:pass@example.test/', 'http://example.test/', 'https://example.test:444/', 'file:///etc/passwd', 'javascript:alert(1)', '//evil.test/'])('rejects %s', (url) => {
    expect(permitsUrl(url, ['https://example.test'], 'https://example.test/')).toBe(false);
  });
  it('permits relative navigation and normalizes default ports', () => {
    expect(permitsUrl('/settings', ['https://example.test'], 'https://example.test/')).toBe(true);
    expect(permitsUrl('https://example.test:443/settings', ['https://example.test'])).toBe(true);
  });
});
