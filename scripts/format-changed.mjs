import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { lstatSync, readFileSync, writeFileSync } from 'node:fs';
import * as prettier from 'prettier';

export function formattableFiles(names) {
  return [...new Set(names)].filter(
    (name) =>
      /\.(?:[cm]?[jt]sx?|json|md|ya?ml|css|html)$/.test(name) &&
      !/(^|\/)(node_modules|dist|runs|coverage)\//.test(name) &&
      name !== 'pnpm-lock.yaml' &&
      !name.startsWith('packages/bughunters/src/ui/'),
  );
}
async function main() {
  const base = process.env.FORMAT_BASE ?? 'HEAD';
  // Argument arrays preserve paths and prevent ref/path values becoming shell code.
  execFileSync('git', ['rev-parse', '--verify', `${base}^{commit}`]);
  const tracked = execFileSync(
    'git',
    ['diff', '--name-only', '-z', '--diff-filter=ACMR', base, '--'],
    { encoding: 'utf8' },
  );
  const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], {
    encoding: 'utf8',
  });
  const files = formattableFiles((tracked + untracked).split('\0').filter(Boolean)).filter(
    (file) => {
      try {
        return lstatSync(file).isFile();
      } catch {
        return false;
      }
    },
  );
  let failed = false;
  for (const file of files) {
    if ((await prettier.getFileInfo(file, { ignorePath: '.prettierignore' })).ignored) continue;
    const source = readFileSync(file, 'utf8');
    const formatted = await prettier.format(source, {
      ...(await prettier.resolveConfig(file)),
      filepath: file,
    });
    if (formatted === source) continue;
    if (process.argv.includes('--write')) writeFileSync(file, formatted);
    else {
      console.error(`Needs formatting: ${file}`);
      failed = true;
    }
  }
  if (failed) process.exitCode = 1;
  console.log(`Checked formatting for ${files.length} changed files.`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
