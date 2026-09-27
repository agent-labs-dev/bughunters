# Configuration

All settings live in `.bughunters/bughunters.yml`. Every field has a default, so a small file is enough.

## The `.bughunters/` folder

Bughunters keeps all of its files in one folder at the root of your project:

| Path | What it is | Git |
| --- | --- | --- |
| `.bughunters/bughunters.yml` | The config | Commit it |
| `.bughunters/instructions.md` | The app guide for the explorer | Commit it |
| `.bughunters/runs/` | The local data: sessions, issues, fixes, worktrees, memory, and screenshots | `init` adds it to `.gitignore` |

The project root is the folder that holds `.bughunters/`. All paths in the config (`source`, `cwd`, `instructions`) are relative to the project root. You can run a command from any folder in the project: Bughunters finds `.bughunters/` in the current folder or in a folder above it.

Older versions kept `bughunters.yml` and `instructions.md` at the project root. If Bughunters finds a file there, it stops and shows the commands that move the files.

## The full file

```yaml
version: 1

app:
  platform: web                 # web | electron | ios | android
  source: .                     # the repo that the fixer edits, relative to the project root
  setup: []                     # commands: { run, cwd, capture, background, readyWhen, timeoutMs }
  teardown: []
  connect: { url: http://localhost:3000 }   # or cdp, or appId + device
  instructions: .bughunters/instructions.md
  secrets: [TEST_PASSWORD]      # environment variables the explorer may use as {{NAME}}

agents:
  explorer:
    maxSteps: 150               # one step is one tool call; full coverage needs many
    budgetUsd: 5                # optional: a cost limit for one session in USD; no limit by default
    use: claude                 # a local agent CLI: claude | codex | kimi | pi
  judge:
    use: { runtime: model, via: openrouter, model: z-ai/glm-5.3-flash }   # or an API key
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
    use: claude
  github:
    enabled: false
    repo: owner/name            # optional: default is the repo of app.source
    pullRequests: draft         # draft | ready
    issueMinSeverity: major     # a bug with no fix becomes an issue at this severity or worse
    labels: [bughunters]
    assetsBranch: bughunters-assets # the orphan branch that holds report images
    prScope: app                # optional: the scope in PR titles
  memory:
    enabled: true
  checks: []                    # optional automatic checks, for example [usability/contrast, usability/tap-target]
  patrol:
    intervalMinutes: 30         # wait between cycles; a cycle runs only on a new commit
    cycles: 0                   # 0 = run until stopped
    pull: origin/main           # remote/branch to pull before each cycle; false = no pull
```

## Setup and teardown commands

Each item in `app.setup` and `app.teardown` is one shell command:

| Field | What it does |
| --- | --- |
| `run` | The shell command |
| `cwd` | The folder for the command, relative to the project root |
| `capture` | A map from a name to a regex. The first group of the match becomes a value, for example `{ CDP_PORT: 'CDP :(\d+)' }` |
| `background` | `true` keeps the process alive for the session. Use it for a dev server |
| `readyWhen` | For a background command: Bughunters waits until the output matches this regex |
| `timeoutMs` | The time limit. The default is 10 minutes |

Later commands and `connect` can use a captured value as `${NAME}`. The explorer can use it as `{{NAME}}`. Bughunters treats each captured value as a secret.

## Connect

| Platform | Field | Example |
| --- | --- | --- |
| `web` | `url` | `http://localhost:3000` |
| `electron` | `cdp` | `http://127.0.0.1:${CDP_PORT}` |
| `ios`, `android` | `appId`, and optional `device` | `com.example.app` |

For mobile, the default device is the booted simulator or the running emulator.

## Runtimes

Each agent (explorer, judge, fixer) runs on an LLM. Each agent can use a different provider:

- A local agent CLI: `use: claude`, `use: codex`, `use: kimi`, or `use: pi`. It uses your existing login.
- An API key: `use: { runtime: model, via: openrouter, model: <id> }`. `via` is `openrouter`, `vercel`, `openai`, `anthropic`, or `custom`.
- A full command: `use: { runtime: cli, command: '...' }`, for extra flags.

[LLMs](models.md#llm-providers-for-each-agent) has the presets, the keys, and the placeholders for a command.

## Automatic checks

The automatic checks are off by default. The explorer finds most real bugs, and it also reads the console errors and the failed requests of the app. Each check finding costs the judge a step with screenshots, and most check findings are not real bugs.

To run an accessibility audit, turn on some checks:

```yaml
agents:
  checks: [usability/contrast, usability/tap-target]
```

When a check is on, it runs on each screen that the explorer records. Each finding goes to the judge.

| Check | What it finds |
| --- | --- |
| `usability/contrast` | Text with a contrast below 4.5:1 |
| `usability/tap-target` | Controls smaller than 24 px |
| `layout/overlap` | Controls on top of each other |
| `layout/overflow` | Text that is cut off |
| `layout/occlusion` | Controls that something covers |
| `layout/zero-size-interactive` | Controls with no size |
| `layout/off-viewport` | Controls outside the screen |
| `layout/horizontal-scroll` | A page wider than the screen |
| `layout/shift-versus-baseline` | Elements that moved since the first visit |
| `rendering/broken-imagery` | Images that did not load |
| `rendering/unstyled-content` | A page with no styles |
| `pixel-diff` | A screen that changed since the first visit |

The layout checks can report controls that are correct, for example text hidden for screen readers. Try them on your app before you keep them on.

## The deterministic gate

The web gate (`bughunters run`) has more settings: `run`, `auth`, `viewports`, `scope`, `crawl`, `mask`, `tolerance`, `determinism`, and `decisions` (an optional general model that reviews the gate findings). `bughunters init --gate` writes a starter file with all of them. Refer to [The deterministic gate](deterministic-gate.md) and to [bughunters.example.yml](../bughunters.example.yml).
