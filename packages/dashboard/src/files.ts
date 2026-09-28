import { realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, sep } from 'node:path';

/** Follow symlinks before checking containment, including links on individual files. */
export function confinedFile(root: string, file: string): string | undefined {
  try {
    const resolved = realpathSync(file);
    const path = relative(realpathSync(root), resolved);
    if (!path || path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)) return;
    return statSync(resolved).isFile() ? resolved : undefined;
  } catch { return undefined; }
}
