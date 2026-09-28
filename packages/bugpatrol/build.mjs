import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const entry = join(here, '../cli/dist/bin.js');
if (!existsSync(entry)) throw new Error(`Build the workspace first: missing ${entry}`);

const pkg = JSON.parse(await readFile(join(here, 'package.json'), 'utf8'));
await build({
  entryPoints: [entry],
  outfile: join(here, 'dist/bin.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: Object.keys(pkg.dependencies),
  define: { __BUGPATROL_VERSION__: JSON.stringify(pkg.version) },
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
});

const source = join(here, '../dashboard/src/ui');
const target = join(here, 'src/ui');
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
for (const file of await readdir(source, { withFileTypes: true })) {
  if (file.isFile() && /\.(?:html|js|css|png|jpe?g|svg|json)$/.test(file.name) && !/\.(?:test|spec)\./.test(file.name)) {
    await copyFile(join(source, file.name), join(target, file.name));
  }
}
