import { describe, expect, it } from 'vitest';
import { inWindow, levelOf, parseLines, timestampOf } from './parse.js';

describe('levelOf', () => {
  it('reads a level out of the line, most severe first', () => {
    expect(levelOf('2024-01-01T00:00:00Z ERROR something broke')).toBe('error');
    expect(levelOf('warn: disk almost full')).toBe('warn');
    expect(levelOf('info: started')).toBe('info');
    expect(levelOf('debug trace detail')).toBe('debug');
  });

  it('prefers the more severe word when a line holds more than one', () => {
    expect(levelOf('error then a warning')).toBe('error');
  });

  it('leaves a line with no recognisable level without one', () => {
    expect(levelOf('just a plain message')).toBeUndefined();
  });
});

describe('timestampOf', () => {
  it('lifts an ISO timestamp off the front of the line', () => {
    expect(timestampOf('2024-03-05T06:07:08.500Z boom', 'fallback')).toBe('2024-03-05T06:07:08.500Z');
  });

  it('accepts a bracketed timestamp', () => {
    expect(timestampOf('[2024-03-05T06:07:08Z] boom', 'fallback')).toBe('2024-03-05T06:07:08.000Z');
  });

  it('falls back to the read time when the line carries none', () => {
    expect(timestampOf('no timestamp here', 'fallback')).toBe('fallback');
  });
});

describe('parseLines', () => {
  it('drops blank lines and labels every record with the source', () => {
    const records = parseLines('a\n\n  \nb', 'api', undefined, 'now');
    expect(records.map((record) => record.message)).toEqual(['a', 'b']);
    expect(records.every((record) => record.source === 'api')).toBe(true);
  });

  it('keeps only the lines matching the configured pattern', () => {
    const records = parseLines('keep this\ndrop that\nkeep too', 'api', 'keep');
    expect(records.map((record) => record.message)).toEqual(['keep this', 'keep too']);
  });

  it('uses each line timestamp when present and the read time otherwise', () => {
    const records = parseLines('2024-03-05T06:07:08Z x\nno stamp', 'api', undefined, 'read-time');
    expect(records[0]?.at).toBe('2024-03-05T06:07:08.000Z');
    expect(records[1]?.at).toBe('read-time');
  });
});

describe('inWindow', () => {
  it('keeps only the records inside the window', () => {
    const records = [
      { at: '2024-01-01T00:00:00.000Z', source: 'a', message: 'x' },
      { at: '2024-01-01T00:00:05.000Z', source: 'a', message: 'y' },
      { at: '2024-01-01T00:00:10.000Z', source: 'a', message: 'z' },
    ];
    const kept = inWindow(records, { from: '2024-01-01T00:00:04.000Z', to: '2024-01-01T00:00:06.000Z' });
    expect(kept.map((record) => record.message)).toEqual(['y']);
  });
});
