#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { ExitCode, loadConfig, BughuntersError, findProjectRoot } from '@bughunters/core';
import { USAGE, commandHelp } from './usage.js';
import { runChecks, doctorExitCode } from './commands/doctor.js';
import { runInit } from './commands/init.js';
import { runCommand, exitCodeForError } from './commands/run.js';
import { parseRunFlags, formatRunSummary } from './commands/run-cli.js';
import { startDashboard } from '@bughunters/dashboard';
import { runAgentCommand } from './commands/agents.js';
import { runIssueCommand } from './commands/issue.js';
import { runMemoryCommand } from './commands/memory.js';
import { cleanWorktrees, syncGitHub, withWorkspaceLock } from '@bughunters/agents';

const [command, ...args] = process.argv.slice(2);
// The folder that holds .bughunters/, found from any subfolder the way git does.
const root = findProjectRoot(process.cwd());

declare const __BUGHUNTERS_VERSION__: string | undefined;

function version(): string {
  if (typeof __BUGHUNTERS_VERSION__ !== 'undefined') return __BUGHUNTERS_VERSION__;
  try {
    return (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;
  } catch {
    return '0.0.0-dev';
  }
}

try {
  if (command && (args.includes('--help') || args.includes('-h'))) {
    process.stdout.write(commandHelp(command) ?? USAGE);
    process.exit(ExitCode.Clean);
  }
  switch (command) {
    case '--version':
    case '-v':
      process.stdout.write(`${version()}\n`);
      process.exit(ExitCode.Clean);
      break;

    case undefined:
    case '--help':
    case '-h':
    case 'help':
      process.stdout.write(USAGE);
      process.exit(ExitCode.Clean);
      break;

    case 'init': {
      await runInit(root, args, (line) => process.stdout.write(`${line}\n`));
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
    case 'publish':
    case 'ci':
    case 'patrol':
    case 'replay': {
      const config = loadConfig(root);
      await runAgentCommand(command, args, root, config,
        (message) => process.stdout.write(`${message}\n`));
      break;
    }

    case 'issue': {
      await withWorkspaceLock(root, () => runIssueCommand(args, root, (line) => process.stdout.write(`${line}\n`), tryLoadConfig(root)));
      break;
    }

    case 'memory': {
      await withWorkspaceLock(root, () => runMemoryCommand(args, root, (line) => process.stdout.write(`${line}\n`)));
      break;
    }

    case 'github': {
      if (args.length !== 1 || args[0] !== 'sync') throw new Error('Use bughunters github sync');
      const config = loadConfig(root);
      const result = await syncGitHub(root, config, { onLog: console.error });
      await withWorkspaceLock(root, () => cleanWorktrees(root, config, { onLog: console.error }));
      process.stdout.write(`Synced: ${result.changed.length} change(s)\n`);
      for (const id of result.changed) process.stdout.write(`${id}\n`);
      break;
    }

    case 'worktrees': {
      if (args.length !== 1 || args[0] !== 'clean') throw new Error('Use bughunters worktrees clean');
      const result = await withWorkspaceLock(root, () => cleanWorktrees(root, loadConfig(root), { onLog: console.error }));
      process.stdout.write(`Removed: ${result.removed.length} worktree(s)\n`);
      for (const id of result.removed) process.stdout.write(`${id}\n`);
      for (const item of result.kept) process.stdout.write(`Kept ${item.id}: ${item.reason}\n`);
      break;
    }

    case 'dashboard': {
      const portFlag = args.indexOf('--port');
      const port = portFlag >= 0 ? Number(args[portFlag + 1]) : undefined;
      if (portFlag >= 0 && !Number.isInteger(port)) {
        process.stderr.write('--port needs an integer\n');
        process.exit(ExitCode.Usage);
      }
      const config = tryLoadConfig(root);
      let timer: ReturnType<typeof setInterval> | undefined;
      if (config?.agents.github.enabled) {
        const sync = () => void syncGitHub(root, config, { onLog: console.error })
          .catch((error) => console.error(`GitHub sync failed: ${String(error)}`));
        await syncGitHub(root, config, { onLog: console.error }).catch((error) =>
          console.error(`GitHub sync failed: ${String(error)}`));
        timer = setInterval(sync, 5 * 60_000);
        timer.unref();
      }
      const dashboard = await startDashboard({
        root,
        port,
        onReady: (url) => {
          process.stdout.write(`Bughunters dashboard on ${url}\n`);
          process.stdout.write('Watching .bughunters/runs/ — runs appear as they finish. Ctrl-C to stop.\n');
        },
      });
      // Deliberately does not exit: this is a server, and the watcher is the
      // whole point.
      const stop = () => {
        if (timer) clearInterval(timer);
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
      process.stderr.write(`\`bughunters ${command}${args.length ? ` ${args.join(' ')}` : ''}\` is not implemented yet.\n`);
      process.stderr.write('See https://github.com/agent-labs-dev/bughunters/blob/main/docs/commands.md for the commands that work now.\n');
      process.exit(ExitCode.Usage);
      break;

    default:
      process.stderr.write(`Unknown command: ${command}\n\n${USAGE}`);
      process.exit(ExitCode.Usage);
  }
} catch (error) {
  if (error instanceof BughuntersError) {
    process.stderr.write(`${error.message}\n`);
    process.exit(error.exitCode);
  }
  // Anything unrecognised is treated as "Bughunters could not test", never as a
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
