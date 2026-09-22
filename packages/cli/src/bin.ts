#!/usr/bin/env node
import { ExitCode, loadConfig, AutoQAError } from '@autoqa/core';
import { USAGE } from './usage.js';
import { runChecks, doctorExitCode } from './commands/doctor.js';
import { writeInitialConfig } from './commands/init.js';

const [command, ...args] = process.argv.slice(2);
const root = process.cwd();

try {
  switch (command) {
    case undefined:
    case '--help':
    case '-h':
    case 'help':
      process.stdout.write(USAGE);
      process.exit(ExitCode.Clean);
      break;

    case 'init': {
      const result = writeInitialConfig(root);
      process.stdout.write(`Wrote ${result.configPath}\nWrote ${result.workflowPath}\n`);
      if (result.stack.framework) process.stdout.write(`Detected ${result.stack.framework}\n`);
      for (const note of result.notes) process.stdout.write(`  note: ${note}\n`);
      process.stdout.write('\nNext: review the TODO markers, then run `autoqa doctor`.\n');
      process.exit(ExitCode.Clean);
      break;
    }

    case 'doctor': {
      const config = tryLoadConfig(root);
      const checks = runChecks(root, config);
      for (const check of checks) {
        process.stdout.write(`${check.ok ? 'ok  ' : check.fatal ? 'FAIL' : 'warn'}  ${check.name}: ${check.detail}\n`);
      }
      process.exit(doctorExitCode(checks));
      break;
    }

    // M1-M6. Each command exists in the surface now so the contract is fixed
    // and the exit codes are honest about what is not built yet.
    case 'recon':
    case 'model':
    case 'run':
    case 'baseline':
    case 'findings':
    case 'intent':
    case 'report':
    case 'export':
    case 'watch':
      process.stderr.write(`\`autoqa ${command}${args.length ? ` ${args.join(' ')}` : ''}\` is not implemented yet.\n`);
      process.stderr.write('See ROADMAP.md for which milestone covers it.\n');
      process.exit(ExitCode.Usage);
      break;

    default:
      process.stderr.write(`Unknown command: ${command}\n\n${USAGE}`);
      process.exit(ExitCode.Usage);
  }
} catch (error) {
  if (error instanceof AutoQAError) {
    process.stderr.write(`${error.message}\n`);
    process.exit(error.exitCode);
  }
  throw error;
}

function tryLoadConfig(cwd: string) {
  try {
    return loadConfig(cwd);
  } catch {
    return undefined;
  }
}
