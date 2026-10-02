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

/** The keys structured loggers put a line's time and level under. */
const TIME_KEYS = ['timestamp', 'time', 'ts', '@timestamp'] as const;
const LEVEL_KEYS = ['level', 'severity', 'levelname'] as const;

/** The line as a JSON object when a structured logger wrote it, else undefined. */
function structured(line: string): Record<string, unknown> | undefined {
  if (!line.trimStart().startsWith('{')) return undefined;
  try {
    const value: unknown = JSON.parse(line);
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function wordLevel(text: string): LogLevel | undefined {
  for (const [level, pattern] of LEVELS) {
    if (pattern.test(text)) return level;
  }
  return undefined;
}

/**
 * A structured line states its own level, and that wins: an info line whose
 * message mentions an error is still an info line.
 */
export function levelOf(line: string): LogLevel | undefined {
  const fields = structured(line);
  for (const key of LEVEL_KEYS) {
    const stated = fields?.[key];
    if (typeof stated === 'string') return wordLevel(stated);
  }
  return wordLevel(line);
}

/** Epoch seconds or milliseconds, or any string `Date` reads, as ISO-8601. */
function isoOf(value: unknown): string | undefined {
  const parsed =
    typeof value === 'number'
      ? new Date(value < 1e11 ? value * 1000 : value)
      : typeof value === 'string'
        ? new Date(value)
        : undefined;
  return parsed === undefined || Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

/**
 * The line's own timestamp when it carries a parseable one - leading the line,
 * or under a structured logger's time key - else the moment we read it. Correlation is only as good as this, so a line with no timestamp is
 * placed at read time rather than dropped.
 */
export function timestampOf(line: string, fallback: string): string {
  const found = LEADING_TIMESTAMP.exec(line);
  if (found?.[1]) return isoOf(found[1]) ?? fallback;
  const fields = structured(line);
  for (const key of TIME_KEYS) {
    const stated = isoOf(fields?.[key]);
    if (stated) return stated;
  }
  return fallback;
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
