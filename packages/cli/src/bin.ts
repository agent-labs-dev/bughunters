#!/usr/bin/env node
import { ExitCode, loadConfig, AutoQAError } from '@autoqa/core';
import { USAGE } from './usage.js';
import { runChecks, doctorExitCode } from './commands/doctor.js';
import { writeInitialConfig } from './commands/init.js';
import { runCommand, exitCodeForError } from './commands/run.js';
import { parseRunFlags, formatRunSummary } from './commands/run-cli.js';
import { startDashboard } from '@autoqa/dashboard';
import { runAgentCommand } from './commands/agents.js';
import { runIssueCommand } from './commands/issue.js';

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

    case 'run': {
      const config = loadConfig(root);
      const flags = parseRunFlags(args);
      const result = await runCommand({
        root,
        config,
        mode: flags.mode,
        commit: flags.commit,
        noModels: flags.noModels,
        only: flags.only,
        onProgress: (m) => process.stdout.write(`  ${m}\n`),
      });
      process.stdout.write(formatRunSummary(result));
      process.exit(result.exitCode);
      break;
    }

    case 'explore':
    case 'judge':
    case 'fix':
    case 'retest':
    case 'patrol':
    case 'replay': {
      const config = loadConfig(root);
      await runAgentCommand(command, args, root, config,
        (message) => process.stdout.write(`${message}\n`));
      break;
    }

    case 'issue': {
      await runIssueCommand(args, root, (line) => process.stdout.write(`${line}\n`));
      break;
    }

    case 'dashboard': {
      const portFlag = args.indexOf('--port');
      const port = portFlag >= 0 ? Number(args[portFlag + 1]) : undefined;
      if (portFlag >= 0 && !Number.isInteger(port)) {
        process.stderr.write('--port needs an integer\n');
        process.exit(ExitCode.Usage);
      }
      const dashboard = await startDashboard({
        root,
        port,
        onReady: (url) => {
          process.stdout.write(`AutoQA dashboard on ${url}\n`);
          process.stdout.write('Watching .autoqa/ — runs appear as they finish. Ctrl-C to stop.\n');
        },
      });
      // Deliberately does not exit: this is a server, and the watcher is the
      // whole point.
      const stop = () => {
        void dashboard.close().then(() => process.exit(ExitCode.Clean));
      };
      process.on('SIGINT', stop);
      process.on('SIGTERM', stop);
      break;
    }

    // M1-M6. Each command exists in the surface now so the contract is fixed
    // and the exit codes are honest about what is not built yet.
    case 'recon':
    case 'model':
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
  // Anything unrecognised is treated as "AutoQA could not test", never as a
  // product regression.
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(exitCodeForError(error));
}

function tryLoadConfig(cwd: string) {
  try {
    return loadConfig(cwd);
  } catch {
    return undefined;
  }
}
