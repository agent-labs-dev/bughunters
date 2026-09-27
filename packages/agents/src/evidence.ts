import { open, realpath } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { paths } from '@bughunters/core';
const signature = Buffer.from('89504e470d0a1a0a', 'hex');
/** Evidence references cannot turn model review or publication into arbitrary file reads. */
export async function readEvidence(root: string, path: string): Promise<Buffer> {
  const base = await realpath(paths.data(root));
  const file = await realpath(resolve(root, path));
  if (!file.startsWith(base + sep) || !file.toLowerCase().endsWith('.png')) throw new Error('Evidence must be a PNG inside the workspace data directory.');
  const handle = await open(file, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 20 * 1024 * 1024) throw new Error('Evidence exceeds the 20 MiB image limit.');
    const bytes = await handle.readFile();
    if (bytes.length < 24 || !bytes.subarray(0, 8).equals(signature) || bytes.readUInt32BE(16) > 16384 || bytes.readUInt32BE(20) > 16384) throw new Error('Evidence is not a supported PNG.');
    return bytes;
  } finally { await handle.close(); }
}
