import type { HttpMethod } from '@bugpatrol/core';
import { z } from 'zod';
import type { ActResult, DriverAction, Observation } from './types.js';
import { WebDriver } from './web.js';

type ApiOptions = {
  url: string;
  headers: Record<string, string>;
  methods: HttpMethod[];
  timeoutMs: number;
  viewport: { width: number; height: number };
  redact: (value: string) => string;
};

const MAX_RESPONSE_BYTES = 1024 * 1024;
const captureSchema = z.record(z.string().regex(/^RESPONSE_[A-Z0-9_]+$/), z.string().regex(/^(?:\/(?:[^~]|~[01])*)*$/));

function responseCaptures(body: string, pointers: Record<string, string>): Record<string, string> {
  const parsed: unknown = JSON.parse(body);
  return Object.fromEntries(
    Object.entries(pointers).map(([name, pointer]) => {
      let value = parsed;
      for (const part of pointer.split('/').slice(1)) {
        const key = part.replaceAll('~1', '/').replaceAll('~0', '~');
        if (typeof value !== 'object' || value === null || !Object.hasOwn(value, key))
          throw new Error(`Response capture ${name}: JSON pointer ${pointer} did not resolve`);
        value = (value as Record<string, unknown>)[key];
      }
      if ((typeof value !== 'string' && typeof value !== 'number') || value === '[redacted]')
        throw new Error(`Response capture ${name} requires an unredacted string or number`);
      return [name, String(value)];
    }),
  );
}

function redactCredentials(text: string): string {
  try {
    const value: unknown = JSON.parse(text);
    return JSON.stringify(
      value,
      (key, item: unknown) => (/(?:token|password|secret|authorization|cookie)$/i.test(key) ? '[redacted]' : item),
      2,
    );
  } catch {
    return text;
  }
}

/** A screenshot here is explicitly a rendered HTTP transcript, never a product UI. */
export class ApiDriver extends WebDriver {
  override readonly platform = 'api';
  private readonly origin: string;
  private location: string;
  private http?: Observation['http'];

  constructor(private readonly api: ApiOptions) {
    super({ url: 'about:blank', viewport: api.viewport });
    const endpoint = new URL(api.url);
    if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password)
      throw new Error('API endpoint must be an HTTP URL without embedded credentials');
    this.origin = endpoint.origin;
    this.location = endpoint.href;
  }

  override async connect(): Promise<void> {
    await super.connect();
    await this.render('API response evidence', `Ready for requests to ${this.origin}`);
  }

  override async act(action: DriverAction): Promise<ActResult> {
    if (action.kind === 'wait') return super.act(action);
    if (action.kind !== 'request') return { ok: false, error: 'Use request to exercise an API endpoint' };
    try {
      const pointers = captureSchema.parse(action.capture ?? {});
      const url = new URL(action.url, this.api.url);
      if (url.origin !== this.origin || url.username || url.password)
        throw new Error('API requests must stay on the configured origin without embedded credentials');
      if (!this.api.methods.includes(action.method))
        throw new Error(`Method ${action.method} is not allowed by app.connect.methods`);
      if (action.body && ['GET', 'HEAD'].includes(action.method))
        throw new Error('GET and HEAD cannot have a request body');
      if (Buffer.byteLength(action.body ?? '') > MAX_RESPONSE_BYTES) throw new Error('Request body exceeds 1 MiB');
      const headers = new Headers(this.api.headers);
      for (const [name, value] of Object.entries(action.headers ?? {})) headers.set(name, value);
      if (['host', 'connection', 'proxy-authorization'].some((name) => headers.has(name)))
        throw new Error('Host, connection and proxy authorization headers cannot be overridden');
      const response = await fetch(url, {
        method: action.method,
        headers,
        body: action.body,
        redirect: 'manual',
        signal: AbortSignal.timeout(this.api.timeoutMs),
      });
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (reader) {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > MAX_RESPONSE_BYTES)
              throw new Error('Response exceeds 1 MiB; evidence was not silently truncated');
            chunks.push(value);
          }
        } finally {
          await reader.cancel();
          reader.releaseLock();
        }
      }
      const sanitized = redactCredentials(Buffer.concat(chunks).toString('utf8'));
      const captures = Object.keys(pointers).length ? responseCaptures(sanitized, pointers) : undefined;
      const body = this.api.redact(sanitized);
      this.http = {
        method: action.method,
        status: response.status,
        body,
        contentType: response.headers.get('content-type'),
      };
      this.location = url.href;
      const status = `${action.method} ${url.pathname}${url.search} → ${response.status}`;
      await this.render(
        status,
        `${status}\nContent-Type: ${response.headers.get('content-type') ?? '(absent)'}\n\n${body}`,
      );
      return { ok: true, step: action, captures };
    } catch (error) {
      return { ok: false, retryable: false, error: this.api.redact(String(error)) };
    }
  }

  private async render(title: string, evidence: string): Promise<void> {
    const page = this.activePage();
    await page.setContent(
      '<!doctype html><meta charset="utf-8"><title>API response evidence</title><style>body{font:16px monospace;background:#f6f8fa;color:#17202a;margin:24px}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style><h1>API response evidence</h1><pre></pre>',
    );
    // Remote response bytes are text, never executable HTML or script.
    await page.locator('pre').evaluate((element, value) => {
      element.textContent = value;
    }, this.api.redact(evidence));
    await page.evaluate((value) => {
      document.title = value;
    }, this.api.redact(title));
  }

  override async observe(): Promise<Observation> {
    const observation = await super.observe();
    return { ...observation, location: this.api.redact(this.location), windows: undefined, http: this.http };
  }
}
