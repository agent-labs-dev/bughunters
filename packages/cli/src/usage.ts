export const USAGE = `bughunters - a continuously-running QA engineer for your repo

Setup
  bughunters init [--yes] [--agent a]      detect the app and the LLMs, write .bughunters/
  bughunters init --gate                   write a starter config for the deterministic web gate
  bughunters doctor                        verify env: pinned image, fonts, browser, network, disk

Recon
  bughunters recon [--review] [--max-screens N] [--budget-usd X]
  bughunters recon resume                  continue an interrupted crawl
  bughunters model show|diff|approve       inspect and approve the AppModel

Running
  bughunters run                           changed-only (default)
  bughunters run --all                     full sweep
  bughunters run --smoke                   entry points only
  bughunters run --screens /a,/b           explicit selection
  bughunters run --no-models               deterministic tier only, fully offline

Agents
  bughunters explore [--goal "..."] [--steps N]
  bughunters judge [--session <id>...]
  bughunters fix [--issue <id>...]
  bughunters retest --issue <id>
  bughunters publish [--issue <id>] [--dry-run]
  bughunters github sync
  bughunters worktrees clean
  bughunters patrol [--once]
  bughunters replay <routine-id>
  bughunters issue list | dismiss <id> --reason "..." [--by name] | reopen <id>
  bughunters memory list [--role r] | add --role r "text" [--scope s]
  bughunters memory remove <id> | retire <id> --reason "..."

Baselines
  bughunters baseline capture              (re)capture baselines in the pinned image
  bughunters baseline pull|push            sync with object storage
  bughunters baseline accept <finding-id...>
  bughunters baseline accept --clean       bulk-accept everything non-blocking

Triage
  bughunters findings list [--route issue|question]
  bughunters findings explain <id>
  bughunters findings accept <id> --reason "intentional"
  bughunters intent list|export|prune

Dashboard
  bughunters dashboard [--port N]          local UI: run history, app map, live watch

Output
  bughunters report --open
  bughunters export --format junit|sarif|json

Local loop
  bughunters watch                         re-run affected screens on file change

Exit codes
  0  clean, or non-blocking findings only
  1  tier-1 regression detected
  2  configuration or usage error
  3  recon required, or the AppModel is unapproved
  4  infrastructure error - Bughunters could not test
`;

const DOCS = 'https://github.com/agent-labs-dev/bughunters/blob/main/docs/commands.md';

/** `bughunters <command> --help`. One entry for each command that a user runs by hand. */
export const COMMAND_HELP: Record<string, string> = {
  init: `bughunters init [flags]
  Find the app and the LLMs, and write .bughunters/bughunters.yml and .bughunters/instructions.md.
  --yes, -y              use the detected values, with no questions
  --platform <p>         web | electron | ios | android
  --start "<command>"    the command that starts the app
  --url <url>            web: the app URL
  --app-id <id>          ios, android: the bundle ID or the package name
  --agent <a>            the LLM for all agents: claude | codex | kimi | pi | openrouter | vercel | openai | anthropic
  --explorer, --judge, --fixer <a>   the LLM for one agent
  --jev <route>          auto | typesafe | openrouter | vercel
  --gate                 write a starter config for the deterministic web gate
`,
  explore: `bughunters explore [--goal "..."] [--steps N]
  Run setup, let the explorer use the app and report problems, then run teardown.
  The reports are candidates. Run \`bughunters judge\` to file the real bugs as issues.
  --goal "..."    what to test, for example "Test the checkout flow"
  --steps N       the step limit (default: agents.explorer.maxSteps)
`,
  judge: `bughunters judge [--session <id>]...
  File the real bugs from the explorer's candidates as issues, and dismiss the rest.
  With no --session, the judge reads the recent explorer sessions that have candidates.
  It skips the candidates that it already decided.
  --session <id>  judge this session only. You can give the flag more than one time.
`,
  fix: `bughunters fix [--issue <id>]...
  Write a fix for the worst open issues, each in its own git worktree, then retest each fix in the app.
  Needs agents.fixer.enabled: true.
  --issue <id>    fix this issue only. You can give the flag more than one time.
`,
  retest: `bughunters retest --issue <id>
  Start the app from the fix worktree, repeat the flow, and let the judge compare before and after.
`,
  publish: `bughunters publish [--issue <id>]... [--dry-run]
  Open a draft PR for each fix, and a GitHub issue for each bug at agents.github.issueMinSeverity or worse with no fix.
  Needs agents.github.enabled: true and a logged-in gh CLI.
  --dry-run       write the reports to .bughunters/runs/publish/, and open nothing
  --issue <id>    publish this issue only
`,
  patrol: `bughunters patrol [--once]
  Run the full cycle again and again: setup, explore, judge, teardown, fix, retest, publish.
  The fixer and GitHub steps run only when you turn them on.
  --once          run one cycle, then stop
`,
  github: `bughunters github sync
  Read the state of each PR and issue from GitHub. A closed PR becomes a lesson. An issue closed as not planned becomes a dismissal.
`,
  issue: `bughunters issue list | dismiss <id> --reason "..." [--by name] | reopen <id>
  List the issues, worst first, or change the state of one issue.
`,
  memory: `bughunters memory list [--role r] | add --role r "text" [--scope s] | remove <id> | retire <id> --reason "..."
  Look at and change the lessons that the agents learned.
`,
  dashboard: `bughunters dashboard [--port N]
  Serve the dashboard on http://127.0.0.1:4311. It updates live, and it does not stop by itself.
`,
  doctor: `bughunters doctor
  Check the config, Node, the browser, and the environment.
`,
};

export function commandHelp(command: string): string | undefined {
  const help = COMMAND_HELP[command];
  return help && `${help}\nDocs: ${DOCS}\n`;
}
