import { describe, expect, it } from 'vitest';
import { Vars } from './vars.js';

describe('Vars', () => {
  it('resolves captures and allowlisted environment values', () => {
    const vars = new Vars(['TOKEN'], { TOKEN: 'top-secret' });
    vars.set('CDP_PORT', '9624');
    expect(vars.resolve('{{TOKEN}}:${CDP_PORT}')).toBe('top-secret:9624');
    expect(vars.has('CDP_PORT')).toBe(true);
  });

  it('lists names but never values for an unknown strict placeholder', () => {
    const vars = new Vars();
    vars.set('TOKEN', 'top-secret');
    expect(() => vars.resolve('{{MISSING}}')).toThrow('Available: TOKEN');
    expect(() => vars.resolve('{{MISSING}}')).not.toThrow('top-secret');
  });

  it('redacts nested strings, preferring the longest value, and preserves buffers', () => {
    const vars = new Vars();
    vars.set('SHORT', 'abcd');
    vars.set('LONG', 'abcdef');
    const png = Buffer.from('abcdef');
    expect(vars.redact({ nested: ['abcdef and abcd'], png })).toEqual({ nested: ['{{LONG}} and {{SHORT}}'], png });
    expect(vars.redact(png)).toBe(png);
  });
});
