import { describe, expect, it } from 'vitest';
import { OdiffUnavailableError, summarizeLoaderError } from './odiff.js';

// What the loader actually printed on a glibc 2.36 host: one line per library,
// each carrying two absolute paths.
const LOADER_DUMP = [
  "/w/node_modules/odiff-bin/bin/odiff.exe: /lib/x86_64-linux-gnu/libm.so.6: version `GLIBC_2.38' not found (required by /w/node_modules/odiff-bin/bin/odiff.exe)",
  "/w/node_modules/odiff-bin/bin/odiff.exe: /lib/x86_64-linux-gnu/libc.so.6: version `GLIBC_2.38' not found (required by /w/node_modules/odiff-bin/bin/odiff.exe)",
].join('\n');

describe('summarizeLoaderError', () => {
  it('reduces a loader dump to the one fact that matters', () => {
    expect(summarizeLoaderError(new Error(LOADER_DUMP))).toBe(
      "needs GLIBC_2.38, which this system's C library does not provide",
    );
  });

  it('explains other failure shapes in plain words', () => {
    expect(summarizeLoaderError(new Error('spawn odiff ENOENT'))).toBe('binary not found');
    expect(summarizeLoaderError(new Error('Exec format error'))).toBe('built for a different CPU architecture');
  });

  it('keeps the error to one line and the raw dump on the cause', () => {
    const cause = new Error(LOADER_DUMP);
    const error = new OdiffUnavailableError(cause);
    expect(error.message).not.toContain('\n');
    expect(error.message).not.toContain('/lib/');
    expect(error.cause).toBe(cause);
  });
});
