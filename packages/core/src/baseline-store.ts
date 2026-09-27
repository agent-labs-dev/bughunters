import { z } from 'zod';
import { ConfigError, InfrastructureError } from './errors.js';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { sha256 } from './fingerprint.js';
import { paths, type BaselineManifest } from './paths.js';

const manifestSchema = z.object({
  version: z.literal(1), imageDigest: z.string(),
  entries: z.record(z.object({ sha256: z.string().regex(/^[a-f0-9]{64}$/), viewport: z.string(),
    bytes: z.number().int().nonnegative(), capturedAt: z.string() })),
});
export type BaselineKey = string;

export type BaselineEntry = {
  sha256: string;
  viewport: string;
  bytes: number;
  capturedAt: string;
};

export function baselineKeyFor(screenId: string, viewport: string): BaselineKey {
  return `${screenId}::${viewport}`;
}

/**
 * The committed manifest holds hashes and the image digest; the pixels live
 * beside it as content-addressed objects (spec 12.1). In local mode the object
 * directory is on disk under `.bughunters/runs/baselines/`; in CI it is backed by object
 * storage, which is why nothing here assumes a path shape beyond the hash.
 */
export class BaselineStore {
  private constructor(
    private readonly root: string,
    private manifest: BaselineManifest,
  ) {}

  static load(root: string, imageDigest: string): BaselineStore {
    const file = paths.baselineManifest(root);
    if (!existsSync(file)) {
      return new BaselineStore(root, { version: 1, imageDigest, entries: {} });
    }
    try { return new BaselineStore(root, manifestSchema.parse(JSON.parse(readFileSync(file, 'utf8')))); }
    catch (cause) { throw new ConfigError('Invalid baseline manifest; restore a reviewed manifest before testing.', { cause }); }
  }

  /**
   * A baseline is addressed by `hash(content) + imageDigest`. When the runner
   * image changes, every baseline captured in the old one is stale by
   * definition -- so they are invalidated and re-captured rather than compared
   * across images, which is what produces a diff storm nobody can explain.
   */
  isStaleFor(imageDigest: string): boolean {
    return this.count > 0 && this.manifest.imageDigest !== imageDigest;
  }

  get imageDigest(): string {
    return this.manifest.imageDigest;
  }

  get count(): number {
    return Object.keys(this.manifest.entries).length;
  }

  has(key: BaselineKey): boolean {
    return this.manifest.entries[key] !== undefined;
  }

  get(key: BaselineKey): BaselineEntry | undefined {
    return this.manifest.entries[key];
  }

  /** Absolute path to the stored pixels for a hash. */
  objectPath(hash: string): string {
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new ConfigError('Invalid baseline content hash');
    return join(paths.baselines(this.root), `${hash}.png`);
  }

  pathFor(key: BaselineKey): string | undefined {
    const entry = this.get(key);
    return entry ? this.objectPath(entry.sha256) : undefined;
  }

  /** Missing or corrupted approved evidence must never become a new reference. */
  verify(key: BaselineKey): string {
    const entry = this.get(key);
    const file = entry && this.pathFor(key);
    if (!entry || !file || !existsSync(file)) throw new InfrastructureError(`Approved baseline unavailable for ${key}. Restore baseline objects or explicitly run bughunters baseline update.`);
    const bytes = readFileSync(file);
    if (bytes.length !== entry.bytes || sha256(bytes) !== entry.sha256) throw new InfrastructureError(`Baseline integrity check failed for ${key}. Restore the approved object.`);
    return file;
  }

  put(key: BaselineKey, viewport: string, image: Buffer): BaselineEntry {
    const hash = sha256(image);
    const target = this.objectPath(hash);
    mkdirSync(paths.baselines(this.root), { recursive: true });
    // Content-addressed: an identical capture is already stored, so re-writing
    // it would only churn mtimes.
    if (!existsSync(target)) writeFileSync(target, image, { flag: 'wx' });
    else if (sha256(readFileSync(target)) !== hash) throw new InfrastructureError('Existing baseline object is corrupted; restore it before updating.');

    const entry: BaselineEntry = {
      sha256: hash,
      viewport,
      bytes: image.byteLength,
      capturedAt: new Date().toISOString(),
    };
    this.manifest.entries[key] = entry;
    return entry;
  }

  /** Drops every entry, used when the image digest moves. */
  invalidateAll(imageDigest: string): number {
    const dropped = this.count;
    this.manifest = { version: 1, imageDigest, entries: {} };
    return dropped;
  }

  save(): void {
    mkdirSync(paths.dir(this.root), { recursive: true });
    const target = paths.baselineManifest(this.root);
    const temporary = `${target}.${randomUUID()}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(this.manifest, null, 2)}\n`);
    renameSync(temporary, target);
  }
}
