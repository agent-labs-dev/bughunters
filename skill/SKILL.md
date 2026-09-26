---
name: bughunters
description: Set up and run Bughunters, a QA team of AI agents that explores a web, Electron, iOS, or Android app, finds bugs, fixes them, and opens GitHub PRs and issues. Use this skill when the user wants to add Bughunters to a repo, write or fix bughunters.yml, run an explore, judge, fix, or patrol cycle, or look at the bugs that Bughunters found.
---

# Bughunters

Bughunters is a QA team made of AI agents. It runs the user's app the way a human tester does. The CLI is the npm package `bughunters`. Run it with `npx bughunters <command>`. Do not build it from source.

Source and full docs: https://github.com/agent-labs-dev/bughunters

## 1. What Bughunters does

Bughunters has these roles:

- The **explorer** starts the app, maps its screens, and reports what looks wrong. Automatic checks (contrast, overlap, clipped text, tap size, visual change) run on each screen.
- The **decider** is [Jev](https://typesafe.ai), a fast, low-cost model. It screens each finding from the automatic checks in one call: drop it, or send it to the judge.
- The **judge** looks at each finding and its screenshot. It files an issue, adds the finding to an open issue, or dismisses it with a reason.
- The **fixer** (off by default) writes a fix in its own git worktree, on the branch `bughunters/fix-<issue>`.
- The **retest** starts the app from the fix worktree. The explorer repeats the flow, and the judge compares the before and after screenshots.
- The **publish** step (off by default) opens a GitHub PR for each verified fix, and an issue for each major bug with no fix.

Platforms: `web` (Playwright), `electron` (CDP), `ios` and `android` (Maestro).

The explorer, the judge, and the fixer are LLM agents. Each one runs on a local agent CLI (`claude`, `codex`, `kimi`, or `pi`) or on an API key (OpenRouter, Vercel AI Gateway, OpenAI, Anthropic). Jev does the repeated triage, so the LLM agents see only the findings that need them. This split keeps an all-day loop fast and low in cost.

Bughunters keeps all its state in the `.bughunters/` folder next to `bughunters.yml`. The first session learns **routines** (for example `enter-app`), so later sessions start faster and replay these paths with no model.

## 2. Configure it for the repo

Do these steps in order. Ask the user only for facts that you cannot find in the repo.

### 2.1 Two facts that you must have

Bughunters can do nothing without these two facts:

1. **How to launch the app on this machine.**
2. **How to sign in to the app**, if the app has a sign-in.

Do not guess them. Do not continue to step 2.3 until you have both. If you cannot get one, stop and tell the user. Tell them what you tried, what is missing, and what you need from them.

First, read the repo. Look at `package.json` scripts, `README`, `CONTRIBUTING`, `.env.example`, `docker-compose.yml`, E2E tests (Playwright, Cypress, Detox, Maestro), `app.json`, `Info.plist`, and `AndroidManifest.xml`. Find:

- The platform: web, Electron, iOS, or Android.
- The command that starts the app for local use, for example `npm run dev`.
- The URL and port (web), the CDP port (Electron), or the bundle ID or package name (mobile).
- The actions that the explorer must never do, for example: delete data, send email to real people, or make payments.

#### Fact 1: launch the app

Launch the app yourself, and prove that it runs:

- **Web:** run the start command, then run `curl -sf <url> >/dev/null && echo up`. Stop the server after the check.
- **Electron:** run the start command with `--remote-debugging-port=<port>`, then run `curl -sf http://127.0.0.1:<port>/json/version`.
- **iOS:** check that the app is on the booted simulator: `xcrun simctl listapps booted | grep <bundle id>`. Also start the dev server (for example Metro), if the app needs it.
- **Android:** check that the app is on the emulator: `adb shell pm list packages | grep <package>`.

If the app does not start, find the cause: a missing dependency, a missing `.env` value, a database or a backend that is not running, or an app build that is not installed. Fix only what is safe and local, for example `npm install`. For all other problems, stop and ask the user. Examples:

- "The app needs `DATABASE_URL`. Which database can Bughunters use for tests?"
- "The iOS app is not installed on the simulator. Please build it one time with `npx expo run:ios`."
- "The app calls a backend at `API_URL`. Is there a dev or staging backend that I can use?"

Never point Bughunters at a production system, unless the user says that it is safe.

#### Fact 2: sign in

Find out if the app has a sign-in: open the app, or look for sign-in routes, auth middleware, and auth providers in the code. If the app has no sign-in, go to step 2.2.

If the app has a sign-in, find one of these ways, best first:

1. **The app starts signed in.** For example: a dev auth bypass, a seeded session, a session token in an environment variable, or a deep link that installs a session. Put the command in `app.setup`.
2. **A setup command makes a test user.** For example: a seed script, or a test-only login endpoint that the E2E tests use. Put it in `app.setup`, and use `capture` to read a value from its output.
3. **A test account.** The user sets the email and the password as environment variables. List their names in `app.secrets`, and write the sign-in steps in `instructions.md` with `{{NAME}}` placeholders.

The explorer cannot get through a one-time code, a CAPTCHA, a hardware key, or a third-party SSO page. If the sign-in has one of these, the app needs a test bypass.

If you do not know a way to sign in, stop and ask the user. Give them options:

- "Can you give me a test account? Set `TEST_EMAIL` and `TEST_PASSWORD` in your shell. Do not paste them here."
- "Can you sign in one time, so that Bughunters can use that session?" (For example: a session token in an environment variable, or a simulator that stays signed in.)
- "I can add a way to make test users for Bughunters: a seed script, or a test-only login endpoint that works only in development. Do you want me to do that?"

Do not use a person's own account without their permission. Do not make test users on a production system.

### 2.2 Check the machine

1. Run `node --version`. Bughunters needs Node 22 or later.
2. For web: run `npx -y playwright@1.48.2 install chromium`. Use this exact version, because the bundle pins Playwright 1.48.2.
3. For iOS or Android: run `maestro --version`. If Maestro is missing, tell the user to install it from https://maestro.mobile.dev. Make sure that a simulator is booted (`xcrun simctl list devices booted`) or an emulator runs (`adb devices`).
4. For Electron: make sure that the app starts with `--remote-debugging-port=<port>`, and that the start command prints the port.
5. Run `npx bughunters --version`. This confirms that the package runs.

### 2.3 Run `init` with yourself as the LLM

You are an LLM agent, so use yourself as the provider for all the agents. Then the user needs no API key for the agents.

1. Find your own CLI name:

   | You are | `--agent` |
   | --- | --- |
   | Claude Code | `claude` |
   | Codex | `codex` |
   | Kimi CLI | `kimi` |
   | pi | `pi` (it needs `pi install npm:pi-mcp-adapter`) |

2. Check that the CLI is on `PATH`, for example `command -v claude`.
3. If you are a different agent (for example Cursor or Gemini), use one of these CLIs if it is installed. If none is installed, ask the user for an API key provider, and use `--agent openrouter` or `--agent vercel`.
4. Run `init` in the repo root, with the start command and the URL or app ID from step 2.1:

   ```bash
   npx bughunters init --yes --agent claude \
     --platform web --start "npm run dev" --url http://localhost:3000
   ```

   Other flags: `--app-id <id>` (mobile), `--explorer`, `--judge`, and `--fixer` (a different provider for one agent), and `--jev <typesafe|openrouter|vercel|auto>`.

`init` writes `bughunters.yml` and an `instructions.md` template, and it adds `.bughunters/` to `.gitignore`. It never overwrites a file. If `bughunters.yml` already exists, edit it instead.

### 2.4 Correct `bughunters.yml`

Read the file that `init` wrote, and correct the values that it could not know. Run all commands from the folder that holds this file. Paths in the file (`source`, `cwd`, `instructions`) are relative to this file.

Web app with a dev server:

```yaml
version: 1

app:
  platform: web
  source: .                          # the repo that the fixer edits
  setup:
    - run: npm run dev
      background: true               # keep the server alive for the session
      readyWhen: 'Local:|ready|listening'   # regex on the output; start when it matches
      timeoutMs: 120000
  connect:
    url: http://localhost:3000
  instructions: instructions.md
  secrets: [TEST_EMAIL, TEST_PASSWORD]   # env vars; the explorer sees {{TEST_EMAIL}}
```

If the user already runs the app, or the app is deployed, leave out `setup` and set only `connect.url`.

Electron app:

```yaml
version: 1

app:
  platform: electron
  source: .
  setup:
    - run: ./scripts/start-test-app.sh
      capture: { CDP_PORT: 'CDP :(\d+)' }    # first regex group becomes ${CDP_PORT}
  teardown:
    - run: ./scripts/stop-test-app.sh
  connect:
    cdp: http://127.0.0.1:${CDP_PORT}
  instructions: instructions.md
```

iOS or Android app:

```yaml
version: 1

app:
  platform: ios                      # or android
  source: .
  setup:
    - run: npx expo start --port 8083
      background: true
      readyWhen: 'Waiting on http'
      timeoutMs: 180000
  connect:
    appId: com.example.app           # bundle ID (iOS) or package name (Android)
    # device: <simulator UDID or emulator serial>   # default: the booted one
  instructions: instructions.md
```

Setup command fields:

| Field | Use |
| --- | --- |
| `run` | The shell command |
| `cwd` | The folder, relative to `bughunters.yml` |
| `capture` | `{ NAME: 'regex' }`. The first group becomes `${NAME}` in later commands and `connect`, and `{{NAME}}` for the explorer. Bughunters treats it as a secret |
| `background` | `true` for a server that stays alive |
| `readyWhen` | For a background command: a regex on its output |
| `timeoutMs` | The time limit. The default is 600000 |

`teardown` has the same fields. Use it to stop what `setup` started, if the process does not stop by itself.

### 2.5 Write `instructions.md`

This file is plain English for the explorer. `init` writes a template. Replace it with a note to a new human tester. Include:

- One or two sentences on what the app is and its main areas.
- How to sign in. Use `{{NAME}}` placeholders for secrets. Never write a real password in this file.
- How to get through onboarding, if the app has it.
- The flows that matter most.
- A **Never do these things** list.

```markdown
# Acme
Acme is a project tracker. The sidebar lists the projects. Each project has a board and a settings page.

## Sign in
Sign in with the email {{TEST_EMAIL}} and the password {{TEST_PASSWORD}}.

## Important flows
- Make a project, add three tasks, and move a task across the board.

## Never do these things
- Do not delete a project that you did not make.
- Do not invite a person by email.
- Do not open the billing page.
```

### 2.6 Check the keys

Check which keys are present. Do not print their values:

```bash
for k in TYPESAFE_API_KEY OPENROUTER_API_KEY AI_GATEWAY_API_KEY OPENAI_API_KEY ANTHROPIC_API_KEY; do
  test -n "$(printenv $k)" && echo "$k set" || echo "$k missing"
done
```

- **Jev.** Jev needs `TYPESAFE_API_KEY` (https://typesafe.ai), `OPENROUTER_API_KEY`, or `AI_GATEWAY_API_KEY`. If none is set, tell the user that a Jev key cuts the cost, and give them the link. Without it, a general model or the judge does the triage, at a higher cost.
- **API key agents.** If an agent uses `runtime: model`, its key must be set. OpenRouter keys: https://openrouter.ai/keys. Vercel AI Gateway keys: https://vercel.com/ai-gateway.

If a key is missing, ask the user to set it in their shell. Do not ask the user to paste a key into the chat.

Each agent's provider is in `agents.<role>.use`:

| `use:` | Provider | Needs |
| --- | --- | --- |
| `claude`, `codex`, `kimi`, `pi` | A local agent CLI (a preset with the correct flags for the role) | The CLI on `PATH`, logged in |
| `{ runtime: model, via: openrouter, model: z-ai/glm-5.3-flash }` | OpenRouter | `OPENROUTER_API_KEY` |
| `{ runtime: model, via: vercel, model: <id> }` | Vercel AI Gateway | `AI_GATEWAY_API_KEY` |
| `{ runtime: model, via: openai, model: <id> }` | OpenAI | `OPENAI_API_KEY` |
| `{ runtime: model, via: anthropic, model: <id> }` | Anthropic | `ANTHROPIC_API_KEY` |
| `{ runtime: model, via: custom, model: <id>, endpoint: <url> }` | An OpenAI-compatible endpoint | `BUGHUNTERS_MODEL_API_KEY` |
| `{ runtime: cli, command: '...' }` | A full command, for extra flags | The CLI on `PATH` |

A command gets the prompt on stdin and in `{prompt}` (a file), the role's tools over MCP in `{mcp}` (a config file) or `{mcpUrl}`, and the worktree in `{workdir}`.

Before each agent command starts the app, Bughunters checks each agent's LLM. If a key or a CLI is missing, the command stops and names the fix.

## 3. Run it

Run each command from the folder that holds `bughunters.yml`.

1. Run a short session first. It proves that Bughunters can launch the app and sign in:

   ```bash
   npx bughunters explore --steps 10 --goal "Sign in, then open the main screen"
   ```

   Read the output. If setup fails, or the explorer stays on the sign-in screen, correct `bughunters.yml` or `instructions.md`, and run it again. If you cannot make it work, stop and tell the user what failed.

2. Run a full explorer session:

   ```bash
   npx bughunters explore
   npx bughunters explore --goal "Test the checkout flow" --steps 40
   ```

   The command runs `setup`, explores, reports, and runs `teardown`. It can take several minutes. Read the output. If setup fails, correct `bughunters.yml` and run it again.

3. Judge the session:

   ```bash
   npx bughunters judge
   ```

4. Show the issues:

   ```bash
   npx bughunters issue list
   ```

### Optional: let it fix bugs

Turn on the fixer only when the user agrees, because the fixer writes code:

```yaml
agents:
  fixer:
    enabled: true
    minSeverity: minor
    commitMessage: 'fix: {title}'          # match the repo's commit hook
    verify: npm test                       # optional: a failure marks the fix failed
    retest: { prepare: npm ci }            # runs in the worktree before the app starts
    use: claude                            # or codex, kimi, pi
```

```bash
npx bughunters fix                     # fix the worst open issues, then retest each fix
npx bughunters fix --issue <id>
npx bughunters retest --issue <id>
```

The fixer works only in `.bughunters/worktrees/`. It never changes the user's checkout.

### Optional: publish to GitHub

Turn on GitHub only when the user agrees, because it opens PRs and issues. It needs a logged-in `gh` CLI (`gh auth status`).

```yaml
agents:
  github:
    enabled: true
    pullRequests: draft          # draft | ready
    issueMinSeverity: major
```

```bash
npx bughunters publish --dry-run   # write the reports to .bughunters/publish/ for review
npx bughunters publish             # open the PRs and issues
npx bughunters github sync         # read the PR and issue states back
```

Always run `--dry-run` first, and show the user the result.

### Optional: run all day

```bash
npx bughunters patrol --once       # one full cycle: setup, explore, judge, teardown, fix, retest, publish
npx bughunters patrol              # repeat every agents.patrol.intervalMinutes (default 30)
```

`patrol` does not stop by itself. Run it in the background or in a separate terminal.

## 4. Look at the results

### The dashboard

```bash
npx bughunters dashboard               # http://127.0.0.1:4311
npx bughunters dashboard --port 5000
```

The dashboard does not stop by itself. Run it in the background, and give the user the URL. It listens on 127.0.0.1 only, and it is read-only. Its pages:

- **Overview**: what each agent does now and what it spent, the issues that need a human, the live screen, and the screens found so far.
- **Issues**: each issue with screenshots, steps, the judge's reason, the fix diff, the before and after retest, and the GitHub state.
- **Activity**: each session as a timeline.
- **Screens**: a graph of the screens and how they connect.
- **Memory**: the lessons that the agents learned.

### The terminal

| Command | Use |
| --- | --- |
| `npx bughunters issue list` | The issues, worst first |
| `npx bughunters issue dismiss <id> --reason "..."` | Close an issue as not a bug. It does not come back |
| `npx bughunters issue reopen <id>` | Open a dismissed issue again |
| `npx bughunters memory list` | The lessons that the agents learned |
| `npx bughunters memory add --role explorer "text"` | Add a lesson, for example a hint about the app |
| `npx bughunters replay <routine-id>` | Replay a learned routine with no model |
| `npx bughunters worktrees clean` | Remove the worktrees of finished fixes |

### The files

To summarize the results for the user, read these files:

| Path | Content |
| --- | --- |
| `.bughunters/issues/<id>.json` | One issue: `title`, `severity`, `status`, `body` (the judge's report), `judgement.reason`, and `evidence` (screenshots) |
| `.bughunters/fixes/<id>.json` | One fix: `status`, `branch`, `diff`, `retests`, and `pr` |
| `.bughunters/sessions/<id>/` | One explorer session and its screenshots |
| `.bughunters/appmap.json` | The screens that the explorer found |
| `.bughunters/memory.json` | The lessons |

Severity, worst first: `critical`, `major`, `minor`, `cosmetic`. Issue status: `new`, `filed`, `fixing`, `fix-proposed`, `fixed`, `dismissed`.

## Rules

- Do not continue without a defined way to launch the app and to sign in. If you do not have one, ask the user.
- Never print, log, or commit a secret value. Put secrets in environment variables, and list their names in `app.secrets`.
- Never point Bughunters at production data, unless the user says that it is safe.
- Ask the user before you turn on `agents.fixer` or `agents.github`.
- Do not edit files in `.bughunters/` by hand. Use the CLI commands.
- When a human dismissed an issue or closed a PR, do not undo that decision.

## Troubleshooting

| Problem | Action |
| --- | --- |
| `Web driver requires app.connect.url or run.url` | Set `app.connect.url` |
| Setup times out | Correct the `readyWhen` regex, or increase `timeoutMs` |
| Playwright cannot find Chromium | Run `npx -y playwright@1.48.2 install chromium` |
| The explorer stays on the sign-in screen | Write clearer sign-in steps in `instructions.md`, and check that the secrets are set |
| Electron does not connect | Make sure that the app opens a CDP port, and that `capture` reads the port from the output |
| Mobile does not connect | Boot a simulator or start an emulator, check `maestro --version`, and check `connect.appId` |
| No issues after `explore` | Run `npx bughunters judge`. The judge files the issues |
| `... is not set` or `... is not on PATH` at the start | Set the key, install the CLI, or change `agents.<role>.use` |
| `Decider: none` in the output | No Jev key is set. Ask the user to set `TYPESAFE_API_KEY`, `OPENROUTER_API_KEY`, or `AI_GATEWAY_API_KEY` |

Full docs: https://github.com/agent-labs-dev/bughunters/tree/main/docs
