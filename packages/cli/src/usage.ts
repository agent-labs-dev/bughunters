export const USAGE = `autoqa - a continuously-running QA engineer for your repo

Setup
  autoqa init                          install the App, auth, detect the stack, write config
  autoqa doctor                        verify env: pinned image, fonts, browser, network, disk

Recon
  autoqa recon [--review] [--max-screens N] [--budget-usd X]
  autoqa recon resume                  continue an interrupted crawl
  autoqa model show|diff|approve       inspect and approve the AppModel

Running
  autoqa run                           changed-only (default)
  autoqa run --all                     full sweep
  autoqa run --smoke                   entry points only
  autoqa run --screens /a,/b           explicit selection
  autoqa run --no-models               deterministic tier only, fully offline

Agents
  autoqa explore [--goal "..."] [--steps N]
  autoqa judge [--session <id>...]
  autoqa fix [--issue <id>...]
  autoqa retest --issue <id>
  autoqa publish [--issue <id>] [--dry-run]
  autoqa patrol [--once]
  autoqa replay <routine-id>
  autoqa issue list | dismiss <id> --reason "..." [--by name] | reopen <id>
  autoqa memory list [--role r] | add --role r "text" [--scope s]
  autoqa memory remove <id> | retire <id> --reason "..."

Baselines
  autoqa baseline capture              (re)capture baselines in the pinned image
  autoqa baseline pull|push            sync with object storage
  autoqa baseline accept <finding-id...>
  autoqa baseline accept --clean       bulk-accept everything non-blocking

Triage
  autoqa findings list [--route issue|question]
  autoqa findings explain <id>
  autoqa findings accept <id> --reason "intentional"
  autoqa intent list|export|prune

Dashboard
  autoqa dashboard [--port N]          local UI: run history, app map, live watch

Output
  autoqa report --open
  autoqa export --format junit|sarif|json

Local loop
  autoqa watch                         re-run affected screens on file change

Exit codes
  0  clean, or non-blocking findings only
  1  tier-1 regression detected
  2  configuration or usage error
  3  recon required, or the AppModel is unapproved
  4  infrastructure error - AutoQA could not test
`;
