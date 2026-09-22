import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sha256 } from './fingerprint.js';
import { paths, type BaselineManifest } from './paths.js';

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
 * directory is on disk under `.autoqa/baselines/`; in CI it is backed by object
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
    const manifest = JSON.parse(readFileSync(file, 'utf8')) as BaselineManifest;
    return new BaselineStore(root, manifest);
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
    return join(this.root, '.autoqa', 'baselines', `${hash}.png`);
  }

  pathFor(key: BaselineKey): string | undefined {
    const entry = this.get(key);
    return entry ? this.objectPath(entry.sha256) : undefined;
  }

  put(key: BaselineKey, viewport: string, image: Buffer): BaselineEntry {
    const hash = sha256(image);
    const target = this.objectPath(hash);
    mkdirSync(join(this.root, '.autoqa', 'baselines'), { recursive: true });
    // Content-addressed: an identical capture is already stored, so re-writing
    // it would only churn mtimes.
    if (!existsSync(target)) writeFileSync(target, image);

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
    writeFileSync(paths.baselineManifest(this.root), `${JSON.stringify(this.manifest, null, 2)}\n`);
  }
}
