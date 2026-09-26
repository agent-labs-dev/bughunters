# Bughunters

Bughunters is a QA team made of agents. It uses your app the way a tester does, finds bugs, fixes them, checks each fix in the running app, and opens the pull requests and issues for your team.

- An **explorer** agent runs the app, maps its screens, and reports what looks wrong.
- A **decider** (Jev) makes the fast calls: is this finding real, and how bad is it.
- A **judge** agent decides what the decider cannot, and writes the issues.
- A **fixer** agent writes a fix in its own git worktree.
- The explorer and the judge then **retest** the fix in the running app, with before and after screenshots.
- The judge **publishes** to GitHub: a PR for each fix, and an issue for each major bug with no fix.

It works on web apps, desktop apps (Electron), and mobile apps (iOS and Android, native or React Native). It runs on your machine, and it can run all day as a patrol.

Apache-2.0.

---

## Contents

- [What is supported](#what-is-supported)
- [Use it in your repo](#use-it-in-your-repo)
- [Configuration](#configuration)
- [Commands](#commands)
- [The dashboard](#the-dashboard)
- [How it works](#how-it-works)
- [The deterministic gate (web)](#the-deterministic-gate-web)
- [Examples](#examples)
- [Development](#development)
- [Documentation](#documentation)
- [Packages](#packages)

## What is supported

| Area | Supported |
| --- | --- |
| Platforms | Web (Playwright), Electron (CDP), iOS simulator and Android emulator (Maestro) |
| App types | Any web app; Electron or native desktop apps with a CDP port; native or React Native mobile apps |
| Login | Any auth system: your own setup commands plus plain-English instructions |
| Agent runtimes | A built-in model loop, or any CLI agent (`claude -p`, `codex exec`, …) for each role |
| Model providers | OpenRouter, Vercel AI Gateway, OpenAI, Anthropic, or a custom endpoint |
| Decider | Jev (default), a general model, or an offline heuristic |
| GitHub | PRs, issues, and state sync through the `gh` CLI |
| Output | A local dashboard, GitHub PRs and issues, and JSON files under `.bughunters/` |

Requirements: Node 22+ and pnpm 9+. For mobile: Xcode (iOS simulator) or the Android SDK, and [Maestro](https://maestro.mobile.dev). For GitHub: a logged-in [`gh`](https://cli.github.com) CLI.

## Use it in your repo

Bughunters is not on npm yet. Build it from this repo, and add a shell alias:

```bash
git clone <this repo> ~/bughunters && cd ~/bughunters
pnpm install && pnpm build
alias bughunters="node ~/bughunters/packages/cli/dist/bin.js"
```

Then follow these steps in your own repo.

### 1. Tell Bughunters how to start your app

Make a folder for Bughunters. It can be your repo's root or a folder next to it. Add `.bughunters/` to `.gitignore`: it holds screenshots of the real app.

Write `bughunters.yml`. This example is an Electron app:

```yaml
version: 1

app:
  platform: electron                 # web | electron | ios | android
  source: .                          # the repo that the fixer edits
  setup:                             # your commands: build, start, sign in a test user
    - run: ./scripts/start-test-app.sh
      capture: { CDP_PORT: 'CDP :(\d+)' }   # a value from the output, for later steps
  teardown:
    - run: ./scripts/stop-test-app.sh
  connect:
    cdp: http://127.0.0.1:${CDP_PORT}      # web: url · mobile: appId (+ device)
  instructions: instructions.md
```

### 2. Write the app guide

`instructions.md` is plain English for the explorer. Write it like a note to a new tester:

```markdown
# My App
My App is a chat workspace. The sidebar lists the channels.

## Sign in
You start signed in. If you see the sign-in screen, report it as a critical bug.

## Onboarding
Type `Bughunters` as the first name. For the username, type `bughunters-{{RUN_TAG}}`.

## Never do these things
- Do not delete the workspace. Do not invite a person by email.
```

Values that the setup captures, and secrets that you list in `app.secrets`, reach the model only as `{{NAME}}` placeholders. Bughunters puts in the real value only when it acts on the app, and it hides the value in all logs.

### 3. Set a model key

```bash
export OPENROUTER_API_KEY=...        # the explorer and the judge use z-ai/glm-5.3-flash by default
```

### 4. Explore, and look at the results

```bash
bughunters explore        # one explorer session: it signs in, maps screens, reports problems
bughunters judge          # the judge decides which reports are real and files the issues
bughunters dashboard      # http://127.0.0.1:4311
```

The first session maps the app and learns **routines**: paths that Bughunters can replay later with no model, for example `enter-app`. Each later session starts from what it already knows.

### 5. Let it fix bugs

```yaml
agents:
  fixer:
    enabled: true
    commitMessage: 'fix(app): {title}'     # match your commit hook
    retest: { prepare: pnpm install --frozen-lockfile }
    use:
      runtime: cli
      command: claude -p --permission-mode acceptEdits
```

```bash
bughunters fix            # fix the worst open issues, then retest each fix in the app
```

Each fix gets a branch `bughunters/fix-<issue>` and a git worktree under `.bughunters/worktrees/`. Bughunters links your ignored `.env` files into each worktree. Then it starts the app from the worktree, and the explorer repeats the flow. The judge compares the before and after screenshots. If the bug is still there, the fixer tries again with the judge's feedback.

### 6. Publish to GitHub

```yaml
agents:
  github: { enabled: true }
```

```bash
bughunters publish --dry-run   # write the reports to .bughunters/publish/ and look at them
bughunters publish             # open the PRs and issues
```

### 7. Run it all day

```bash
bughunters patrol              # setup → explore → judge → teardown → fix → retest → publish, then repeat
bughunters patrol --once       # one cycle
```

## Configuration

All settings live in `bughunters.yml`. Every field has a default, so a small file is enough.

```yaml
version: 1

app:
  platform: web                 # web | electron | ios | android
  source: .                     # the repo that the fixer edits
  setup: []                     # commands: { run, cwd, capture, background, readyWhen, timeoutMs }
  teardown: []
  connect: { url: http://localhost:3000 }   # or cdp, or appId + device
  instructions: instructions.md
  secrets: [TEST_PASSWORD]      # environment variables the explorer may use as {{NAME}}

agents:
  explorer:
    maxSteps: 60
    budgetUsd: 0.5
    use: { runtime: model, via: openrouter, model: z-ai/glm-5.3-flash }
  judge:
    use: { runtime: model, via: openrouter, model: z-ai/glm-5.3-flash }
  fixer:
    enabled: false              # off until you turn it on: the fixer writes code
    minSeverity: minor          # fix issues at this severity or worse
    maxPerCycle: 2              # at most this many new fixes in one cycle
    verify: pnpm test           # optional: a failed command marks the fix failed
    commitMessage: 'fix: {title}'
    retest:
      enabled: true
      prepare: pnpm install     # runs in the worktree before the app starts
      attempts: 2               # fix attempts in total
    use: { runtime: cli, command: 'claude -p --permission-mode acceptEdits' }
  github:
    enabled: false
    pullRequests: draft         # draft | ready
    issueMinSeverity: major     # a bug with no fix becomes an issue at this severity or worse
    labels: [bughunters]
    assetsBranch: bughunters-assets # the orphan branch that holds report images
    prScope: app                # optional: the scope in PR titles
  memory:
    enabled: true
  patrol:
    intervalMinutes: 30
    cycles: 0                   # 0 = run until stopped

decisions:
  decider: jev                  # jev | model | local | heuristic
```

**Runtimes.** Each role (explorer, judge, fixer) runs on the built-in model loop or on a CLI agent. A CLI agent gets the prompt on stdin and in `{prompt}`. It gets the role's tools over MCP in `{mcp}` (a config file) or `{mcpUrl}`, and the worktree in `{workdir}`:

```yaml
judge:
  use: { runtime: cli, command: 'claude -p --mcp-config {mcp}' }
```

**Model providers.** A model runtime uses `via: openrouter | vercel | openai | anthropic | custom`. The decider tries these keys in this order:

| Decider | Environment variable | Route |
| --- | --- | --- |
| Jev | `TYPESAFE_API_KEY` | `api.typesafe.ai` |
| Jev | `OPENROUTER_API_KEY` | OpenRouter |
| Jev | `AI_GATEWAY_API_KEY` | Vercel AI Gateway |
| General model | `OPENROUTER_API_KEY`, `AI_GATEWAY_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` | as named |
| General model | `BUGHUNTERS_MODEL_ENDPOINT` + `BUGHUNTERS_MODEL_API_KEY` | Custom endpoint |

With no usable key, the decider falls back to the offline heuristic.

## Commands

Run `bughunters help` for the full list.

**Agents**

| Command | What it does |
| --- | --- |
| `bughunters explore [--goal "..."] [--steps N]` | One explorer session: start the app, explore, report, stop the app |
| `bughunters judge [--session <id>]` | Judge the newest explorer session (or the ones you name) |
| `bughunters fix [--issue <id>]` | Fix the worst open issues, then retest each fix |
| `bughunters retest --issue <id>` | Retest one fix in the app, from its worktree |
| `bughunters publish [--issue <id>] [--dry-run]` | Open PRs and issues on GitHub, or write them to local files |
| `bughunters patrol [--once]` | The full cycle, again and again |
| `bughunters replay <routine-id>` | Replay a learned routine, with no model |

**Issues, memory, and GitHub**

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

**Dashboard and setup**

| Command | What it does |
| --- | --- |
| `bughunters dashboard [--port N]` | The local dashboard, on 127.0.0.1 |
| `bughunters init` | Detect the stack and write a starter `bughunters.yml` (web) |
| `bughunters doctor` | Check that this machine can run the deterministic gate |

**Deterministic gate (web)**

| Command | What it does |
| --- | --- |
| `bughunters run [--all \| --smoke \| --screens /a,/b] [--no-models]` | Capture, compare with the baselines, and run the checks |

These commands are planned and not built yet: `recon`, `model`, `baseline`, `findings`, `intent`, `report`, `export`, and `watch`. See [ROADMAP.md](ROADMAP.md).

## The dashboard

```bash
bughunters dashboard            # http://127.0.0.1:4311
```

The dashboard is the bird's-eye view of the agents. It reads the files under `.bughunters/` and updates live.

- **Overview**: what each agent does now and what it spent, the issues that need a human, the live screen, and the screens found so far.
- **Issues**: each issue with its screenshots and steps, the judge's reason, the fix with its diff, the retest with before and after screenshots, and the PR or issue on GitHub with its state.
- **Activity**: each session as a timeline, one line for each action.
- **Screens**: a graph shows how screens connect. Switch to the grid to see each latest screenshot.
- **Memory**: the lessons that the agents learned.
- **Checks**: the results of `bughunters run` (shown only when there are runs).

The dashboard listens on 127.0.0.1 only, because the screenshots can show real data. It is read-only.

## How it works

**The cycle.** A patrol cycle has these steps:

1. **Setup** runs your commands and connects the driver to the app.
2. The **explorer** enters the app (with the `enter-app` routine when it can), records screens, and reports problems. Automatic checks (contrast, overlap, tap size, visual change) run on each screen that it records.
3. The **decider** routes each finding: drop it, or send it to the judge.
4. The **judge** looks at each finding with its screenshot. It files an issue, adds the finding to an issue that is already open, or dismisses it with a reason.
5. **Teardown** stops the app.
6. The **fixer** fixes the worst issues. Each fix gets a **retest**: Bughunters starts the app from the fix worktree, the explorer repeats the flow on each affected screen, and the judge compares before and after.
7. The judge **publishes**. A fix becomes a PR. A major bug with no fix becomes an issue.

**Noise control.** Bughunters keeps the list of issues short:

- One rule on one screen gives one finding, not one finding for each element.
- Each finding has a fingerprint. A finding that the judge filed or dismissed before does not go to the judge again. A filed finding adds one more occurrence to its issue.
- The judge looks for one shared cause first, so ten screens that fail in the same way become one issue.
- A dismissed issue does not come back. A fixed issue that comes back reopens as a regression.
- An issue from the automatic checks closes by itself after 3 visits with no finding. A merged fix gets a recheck on the main branch.

**Memory.** After each explorer session, Bughunters reads what went wrong: failed taps, retyped fields, broken routines. Then it writes short lessons to `.bughunters/memory.json`. Human dismissals, fixer declines, rejected PRs, and commit hook errors also become lessons. Each role gets its lessons in its prompt, so the next run does not repeat the same mistakes.

**GitHub.** The judge writes a short summary. Bughunters adds the full report: the steps, the screenshots, the fix, and the before and after table. It uploads the images to the orphan `bughunters-assets` branch, so the images never enter the PR diff. PR titles use the Conventional Commits form, for example `fix(app): expand the sidebar in a narrow window`. When the team closes a PR without a merge, Bughunters does not propose that change again. Bughunters never force-pushes and never uses `--no-verify`.

**Safety.**

- The fixer works only in its own worktree.
- A human decision (a dismissal, a closed PR) is never overwritten.
- Secrets never reach a model or a log.
- `app.instructions` can list what the explorer must never do.

The full design is in [ADR 0005](docs/adr/0005-agents-drivers-and-the-patrol.md).

## The deterministic gate (web)

For web apps, `bughunters run` is a merge gate that uses no agent. The agents explore freely. The gate replays frozen artifacts and compares them with pinned baselines, so it gives the same result on the same commit. Only this gate can fail a CI check. The agents never block a merge ([ADR 0001](docs/adr/0001-split-the-brain-from-the-gate.md)).

```bash
pnpm --filter @bughunters/capture exec playwright install chromium
cd examples/fixture-app
node ../../packages/cli/dist/bin.js run --no-models   # capture the baselines
node ../../packages/cli/dist/bin.js run --no-models   # compare: clean
BREAK=color node server.js &                          # add one known defect
node ../../packages/cli/dist/bin.js run --no-models   # exit 1, with a diff image
```

`--no-models` makes a full run with no network traffic.

| Exit code | Meaning |
| --- | --- |
| 0 | Clean, or findings that do not block |
| 1 | A tier-1 regression: **the only code that blocks a merge** |
| 2 | A configuration or usage error |
| 3 | Recon is required, or the app model is not approved |
| 4 | An infrastructure error: Bughunters could not test |

The gate has three tiers. Only tier 1 can fail a check:

| Tier | What it is | Model | Blocks a merge |
| --- | --- | --- | --- |
| T1 Deterministic | Pixel diff, layout invariants, accessibility, console, network | None | Yes |
| T2 Decided | Is it an anomaly, a bug or intended, worth an issue? | Decider | No |
| T3 Judged | Visual meaning and flow reasoning | Judge | No |

To check the determinism guarantee (three runs, one commit, zero diffs), run `bash scripts/determinism-check.sh`.

## Examples

| Folder | What it shows |
| --- | --- |
| `examples/fixture-app` | A small web app for the deterministic gate, with defects you can switch on (`BREAK=...`) |
| `examples/nebula-desktop` | A real Electron app: a test session from the E2E harness, CDP, onboarding, the fixer, and GitHub |
| `examples/nebula-mobile` | A real React Native app on the iOS simulator: Metro, a deep-link sign-in, and Maestro |

## Development

```bash
pnpm install
pnpm build
pnpm test
```

To look at the dashboard with sample data:

```bash
node packages/dashboard/scripts/fixture.mjs /tmp/bughunters-fixture
cd /tmp/bughunters-fixture && node ~/bughunters/packages/cli/dist/bin.js dashboard
```

## Documentation

- [ADR 0005: agents, drivers, and the patrol](docs/adr/0005-agents-drivers-and-the-patrol.md): the agent design
- [Architecture decisions](docs/adr/): all ADRs
- [Technical specification](docs/spec/bughunters-technical-spec.md): the deterministic gate
- [The determinism contract](docs/determinism-contract.md): what the gate guarantees, and how
- [The detection rubric](docs/detection-rubric.md): each automatic check and what it finds
- [Competitive landscape](docs/research/oss-visual-testing-landscape-2026.md): the research behind the design
- [Roadmap](ROADMAP.md): the milestones

## Packages

| Package | What it does |
| --- | --- |
| `@bughunters/cli` | The `bughunters` command |
| `@bughunters/core` | The data types, the config schema, file paths, fingerprints, and exit codes |
| `@bughunters/agents` | The explorer, judge, and fixer; the retest, publish, and memory steps; model and CLI runtimes; routines; the patrol; workspace files |
| `@bughunters/drivers` | One driver interface for web (Playwright), Electron (CDP), and iOS and Android (Maestro) |
| `@bughunters/decide` | The decider interface and its routes: Jev, a general model, a local model, or the offline heuristic |
| `@bughunters/invariants` | The layout checks: contrast, overlap, clipped text, tap size, and more |
| `@bughunters/diff` | Pixel and perceptual comparison, masks, and tolerance rules |
| `@bughunters/capture` | The Playwright capture for the deterministic gate, with the determinism contract |
| `@bughunters/dashboard` | The local dashboard: its server and its UI |
| `@bughunters/triage` | Clustering and noise control for the gate's findings |
| `@bughunters/report` | Report formats for the gate: HTML, PR comment, JUnit, and SARIF |
| `@bughunters/recon` | App bring-up, crawl safety, and the change map for the gate (in progress) |
| `@bughunters/github-app` | A GitHub App for checks, issues, and slash commands (in progress) |
