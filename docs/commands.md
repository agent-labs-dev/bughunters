# Commands

Run each command from the folder that holds `bughunters.yml`. Run `npx bughunters --help` for the full list.

## Agents

| Command | What it does |
| --- | --- |
| `bughunters explore [--goal "..."] [--steps N]` | One explorer session: start the app, explore, report, stop the app |
| `bughunters judge [--session <id>]` | Judge the newest explorer session (or the ones you name) |
| `bughunters fix [--issue <id>]` | Fix the worst open issues, then retest each fix |
| `bughunters retest --issue <id>` | Retest one fix in the app, from its worktree |
| `bughunters publish [--issue <id>] [--dry-run]` | Open PRs and issues on GitHub, or write them to local files |
| `bughunters patrol [--once]` | The full cycle, again and again |
| `bughunters replay <routine-id>` | Replay a learned routine, with no model |

## Issues, memory, and GitHub

| Command | What it does |
| --- | --- |
| `bughunters issue list` | List the issues, worst first |
| `bughunters issue dismiss <id> --reason "..." [--by name]` | Close an issue as not a bug; it does not come back |
| `bughunters issue reopen <id>` | Open a dismissed issue again |
| `bughunters memory list [--role r]` | Show the lessons that the agents learned |
| `bughunters memory add --role r "text" [--scope s]` | Add a lesson yourself |
| `bughunters memory remove <id>` · `retire <id> --reason "..."` | Delete or retire a lesson |
| `bughunters github sync` | Read the state of each PR and issue from GitHub |
| `bughunters worktrees clean` | Remove the worktrees of merged, closed, or finished fixes |

## Dashboard and setup

| Command | What it does |
| --- | --- |
| `bughunters dashboard [--port N]` | The local dashboard, on 127.0.0.1 |
| `bughunters doctor` | Check that this machine can run the deterministic gate |
| `bughunters init [--yes] [--agent a]` | Detect the app and the LLMs, ask for each agent's provider, and write `bughunters.yml` |
| `bughunters init --gate` | Write a starter `bughunters.yml` for the deterministic web gate |
| `bughunters --version` | Show the version |

## Deterministic gate (web)

| Command | What it does |
| --- | --- |
| `bughunters run [--all \| --smoke \| --screens /a,/b] [--no-models]` | Capture, compare with the baselines, and run the checks |

These commands are planned and not built yet: `recon`, `model`, `baseline`, `findings`, `intent`, `report`, `export`, and `watch`.
