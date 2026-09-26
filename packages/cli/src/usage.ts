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
