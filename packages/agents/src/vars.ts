import type { AppConfig } from '@bugpatrol/core';

/** Captures and allowlisted secrets share one redaction and interpolation path. */
export class Vars {
  private readonly values = new Map<string, string>();

  constructor(secrets: AppConfig['secrets'] = [], env: NodeJS.ProcessEnv = process.env) {
    for (const name of secrets) {
      if (env[name] !== undefined) {
        this.set(name, env[name]);
      }
    }
  }

  set(name: string, value: string): void {
    this.values.set(name, value);
  }

  has(name: string): boolean {
    return this.values.has(name);
  }

  names(): string[] {
    return [...this.values.keys()];
  }

  entries(): [string, string][] {
    return [...this.values.entries()];
  }

  resolve(text: string): string {
    const placeholder = /\{\{([A-Za-z_][A-Za-z_0-9]*)\}\}|\$\{([A-Za-z_][A-Za-z_0-9]*)\}/g;
    return text.replace(placeholder, (match, strict: string | undefined, env: string | undefined) => {
      const name = strict ?? env ?? '';
      const value = this.values.get(name);
      if (value !== undefined) {
        return value;
      }
      if (env !== undefined) {
        return process.env[name] ?? match;
      }
      throw new Error(`Unknown variable ${name}. Available: ${this.names().join(', ') || '(none)'}`);
    });
  }

  redact(value: unknown): unknown {
    if (Buffer.isBuffer(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const entries = this.entries().filter(([, secret]) => secret.length >= 4);
      entries.sort((a, b) => b[1].length - a[1].length);
      let result = value;
      for (const [name, secret] of entries) {
        result = result.replaceAll(secret, `{{${name}}}`);
      }
      return result;
    }
    if (Array.isArray(value)) {
      return value.map((item) => this.redact(item));
    }
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, this.redact(item)]));
    }
    return value;
  }
}
