import type { LogLevel, LogRecord } from '@bugpatrol/core';

/**
 * Most backends print one of these words somewhere in the line. Nothing about
 * the format is assumed beyond that, so an unrecognised format still yields a
 * message; it just has no level.
 */
const LEVELS: ReadonlyArray<readonly [LogLevel, RegExp]> = [
  ['error', /\b(error|fatal|panic|critical|exception|traceback)\b/i],
  ['warn', /\b(warn|warning)\b/i],
  ['debug', /\b(debug|trace)\b/i],
  ['info', /\b(info|notice)\b/i],
];

/** An ISO-8601 timestamp at the start of a line, bracketed or bare. */
const LEADING_TIMESTAMP = /^\[?(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)\]?/;

export function levelOf(line: string): LogLevel | undefined {
  for (const [level, pattern] of LEVELS) {
    if (pattern.test(line)) return level;
  }
  return undefined;
}

/**
 * The line's own timestamp when it carries a parseable one, else the moment we
 * read it. Correlation is only as good as this, so a line with no timestamp is
 * placed at read time rather than dropped.
 */
export function timestampOf(line: string, fallback: string): string {
  const found = LEADING_TIMESTAMP.exec(line);
  if (!found?.[1]) return fallback;
  const parsed = new Date(found[1]);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

/**
 * Split text into records. A line is kept when it is not blank and matches the
 * configured pattern, when there is one. Redaction happens in the collector
 * set, never here, so this stays a pure function of the stream.
 */
export function parseLines(
  text: string,
  source: string,
  match?: string,
  fallback = new Date().toISOString(),
): LogRecord[] {
  const filter = match === undefined ? undefined : new RegExp(match);
  const records: LogRecord[] = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    if (filter && !filter.test(line)) continue;
    records.push({ at: timestampOf(line, fallback), source, level: levelOf(line), message: line });
  }
  return records;
}

/** Keep only the records inside a window. Used by the sources that buffer text. */
export function inWindow(records: LogRecord[], window: { from: string; to: string }): LogRecord[] {
  return records.filter((record) => record.at >= window.from && record.at <= window.to);
}
