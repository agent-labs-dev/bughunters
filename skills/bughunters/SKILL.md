---
name: bughunters
description: Set up and run Bughunters, a QA team of AI agents that explores a web, Electron, iOS, or Android app, finds bugs, fixes them, and opens GitHub PRs and issues. Use this skill when the user wants to add Bughunters to a repo, write or fix .bughunters/bughunters.yml, run an explore, judge, fix, or patrol cycle, or look at the bugs that Bughunters found.
---

# Bughunters

Bughunters is a QA team made of AI agents. It runs the user's app the way a human tester does. The CLI is the npm package `bughunters`. Run it with `npx bughunters@latest <command>`. Do not build it from source.

Always add `@latest`, because `npx` can run an old copy from its cache. An old copy can have different commands and a different config layout. There is one exception: if the repo lists `bughunters` in `package.json`, run `npx bughunters <command>`, so that you use the version that the repo selected.

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

Bughunters keeps all of its files in one `.bughunters/` folder at the project root. The config and the app guide are committed. The local data goes in `.bughunters/runs/`, and git ignores it. The first session learns **routines** (for example `enter-app`), so later sessions start faster and replay these paths with no model.

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

Also check the backend. If `.env` or the config points to an API URL, check that it answers, for example `curl -s -o /dev/null -w '%{http_code}' <api url>`. A web app often starts, but it cannot sign in when its backend is down.

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
3. **A test account.** The user sets the email and the password as environment variables. List their names in `app.secrets`, and write the sign-in steps in `.bughunters/instructions.md` with `{{NAME}}` placeholders.

The explorer cannot get through a one-time code, a CAPTCHA, a hardware key, or a third-party SSO page. If the sign-in has one of these, the app needs a test bypass.

Many apps sign in with a one-time code, and their E2E tests use a test-only endpoint that returns a session token. Look for it in the E2E setup files (for example `e2e/setup/`, `auth.setup.ts`, or `global-setup`). Then find a URL that installs a session from a token: an OAuth or magic-link callback route often does this. Use both in `app.setup` and in the app guide:

```yaml
app:
  setup:
    # One command can capture more than one value.
    - run: >-
        curl -sf -X POST "$API_URL/auth/test-login"
        -H "X-Test-Secret: $TEST_LOGIN_SECRET" -d '{"email":"bughunters@example.test"}'
      capture:
        SESSION_TOKEN: '"token":\s*"([^"]+)"'
        USER_ID: '"userId":\s*"([^"]+)"'
```

```markdown
## Sign in
Open http://localhost:3000/auth/callback#token={{SESSION_TOKEN}}&user_id={{USER_ID}}. Do not use the sign-in form.
```

The model sees only the `{{NAME}}` placeholder. Bughunters puts in the real value only when the explorer acts on the app, for example when it opens the URL. Bughunters hides the value in all logs and files.

#### The state of the test account

The test account decides what the explorer can test:

- **Onboarding.** A new account usually goes to onboarding first. Onboarding can use most of the explorer's steps. If the account must be onboarded, write the onboarding answers in the app guide, or onboard the account one time before the patrol.
- **Onboarding bugs.** To retest a fix in onboarding, the retest needs an account that is not onboarded. Make a new test user in each session: put a unique email in the setup command, for example `bughunters-$(date +%s)@example.test`.
- **Data.** A new account has no data, so many pages show only an empty state. If the main flows need data, add a seed command to `app.setup`.

Use a separate account for Bughunters, not an account that the E2E tests share, because the explorer changes the account's data.

If you do not know a way to sign in, stop and ask the user. Give them options:

- "Can you give me a test account? Set `TEST_EMAIL` and `TEST_PASSWORD` in your shell. Do not paste them here."
- "Can you sign in one time, so that Bughunters can use that session?" (For example: a session token in an environment variable, or a simulator that stays signed in.)
- "I can add a way to make test users for Bughunters: a seed script, or a test-only login endpoint that works only in development. Do you want me to do that?"

Do not use a person's own account without their permission. Do not make test users on a production system.

### 2.2 Check the machine

1. Run `node --version`. Bughunters needs Node 22 or later.
2. Run `git remote -v` in the app repo. Bughunters needs `git`, and an `origin` remote: each patrol cycle pulls `origin/main`. If the default branch is not `main`, set `agents.patrol.pull` (for example `origin/master`).
3. If the user wants GitHub PRs and issues: run `gh auth status`. If `gh` is missing, tell the user to install it from https://cli.github.com. If `gh` is not logged in, tell the user to run `gh auth login`.
4. For web: run `PLAYWRIGHT_SKIP_BROWSER_GC=1 npx -y playwright@1.48.2 install chromium`. Use this exact version, because the bundle pins Playwright 1.48.2. Keep `PLAYWRIGHT_SKIP_BROWSER_GC=1`: without it, Playwright deletes the browsers of the repo's own Playwright version.
5. For iOS or Android: run `maestro --version`. If Maestro is missing, tell the user to install it from https://maestro.mobile.dev. Make sure that a simulator is booted (`xcrun simctl list devices booted`) or an emulator runs (`adb devices`).
6. For Electron: make sure that the app starts with `--remote-debugging-port=<port>`, and that the start command prints the port.
7. Run `npx bughunters@latest --version`. This confirms that the package runs.

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
   npx bughunters@latest init --yes --agent claude \
     --platform web --start "npm run dev" --url http://localhost:3000
   ```

   Other flags: `--app-id <id>` (mobile), `--explorer`, `--judge`, and `--fixer` (a different provider for one agent), and `--jev <typesafe|openrouter|vercel|auto>`.

`init` writes these files. It never overwrites a file:

```text
.bughunters/
  bughunters.yml     # the config: commit it
  instructions.md    # the app guide template: commit it
  runs/              # the local data: init adds .bughunters/runs/ to .gitignore
```

If `.bughunters/bughunters.yml` already exists, edit it instead. Do not write a `bughunters.yml` at the project root: Bughunters does not read it there. If you find an old one there, `npx bughunters@latest doctor` shows the commands that move it.

### 2.4 Correct `.bughunters/bughunters.yml`

Read the file that `init` wrote, and correct the values that it could not know. Paths in the file (`source`, `cwd`, `instructions`) are relative to the project root, the folder that holds `.bughunters/`. Commands work from any folder in the project.

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
  instructions: .bughunters/instructions.md
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
  instructions: .bughunters/instructions.md
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
  instructions: .bughunters/instructions.md
```

Setup command fields:

| Field | Use |
| --- | --- |
| `run` | The shell command |
| `cwd` | The folder, relative to the project root |
| `capture` | `{ NAME: 'regex' }`. The first group becomes `${NAME}` in later commands and `connect`, and `{{NAME}}` for the explorer. Bughunters treats it as a secret |
| `background` | `true` for a server that stays alive |
| `readyWhen` | For a background command: a regex on its output |
| `timeoutMs` | The time limit. The default is 600000 |

`teardown` has the same fields. Use it to stop what `setup` started, if the process does not stop by itself.

### 2.5 Write `.bughunters/instructions.md`

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

When the user asks which model to use, recommend a model from this table. Give the judge the strongest model, and give the explorer a fast, low-cost model. [Which model for each agent](https://github.com/agent-labs-dev/bughunters/blob/main/docs/models.md#which-model-for-each-agent) gives the `use:` config for each model.

| Agent | What it needs | Anthropic | OpenAI | Other labs (OpenRouter) |
| --- | --- | --- | --- | --- |
| Explorer | Vision, computer use, reliable tool calls, low cost | `claude-sonnet-5` | `gpt-6-luna` | `google/gemini-3.8-flash` |
| Judge | Precision, fine visual detail, clear writing | `claude-opus-5-5` | `gpt-6-sol` | `moonshotai/kimi-k3` |
| Fixer | Strong coding, in an agent CLI | `claude` with `--model claude-opus-5-5` | `codex` with `-m gpt-6-astra` | `kimi` with Kimi K3 |

A command gets the prompt on stdin and in `{prompt}` (a file), the role's tools over MCP in `{mcp}` (a config file) or `{mcpUrl}`, and the worktree in `{workdir}`.

Before each agent command starts the app, Bughunters checks each agent's LLM. If a key or a CLI is missing, the command stops and names the fix.

## 3. Run it

Run each command in the project. Bughunters finds `.bughunters/` in the current folder or in a folder above it.

1. Run a short session first. It proves that Bughunters can launch the app and sign in:

   ```bash
   npx bughunters@latest explore --steps 10 --goal "Sign in, then open the main screen"
   ```

   Read the output. If setup fails, or the explorer stays on the sign-in screen, correct `.bughunters/bughunters.yml` or `.bughunters/instructions.md`, and run it again. If you cannot make it work, stop and tell the user what failed.

   Continue only when the explorer reaches the main screen of the app. If it stops in onboarding, read [The state of the test account](#the-state-of-the-test-account).

2. Run a full explorer session:

   ```bash
   npx bughunters@latest explore
   npx bughunters@latest explore --goal "Test the checkout flow" --steps 40
   ```

   The command runs `setup`, explores, reports, and runs `teardown`. It can take several minutes. Read the output. If setup fails, correct `.bughunters/bughunters.yml` and run it again.

3. Judge the session:

   ```bash
   npx bughunters@latest judge
   ```

   The judge reads the recent explorer sessions that have candidates, and it skips the candidates that it already decided. Its first line names the sessions and the number of new candidates. To judge one session only, add `--session <id>`.

4. Show the issues:

   ```bash
   npx bughunters@latest issue list
   ```

5. Show the dashboard to the user. The dashboard gives the user the screenshots, the steps, and the screen graph:

   1. Check if the dashboard runs already:

      ```bash
      curl -fsS http://127.0.0.1:4311/api/overview > /dev/null && echo running
      ```

   2. If it does not run, start it in the background. It does not stop by itself:

      ```bash
      npx bughunters@latest dashboard
      ```

   3. Wait for the line `Bughunters dashboard on http://127.0.0.1:4311`.
   4. Open the URL in the user's browser: `open` on macOS, `xdg-open` on Linux, `start` on Windows.
   5. Tell the user which page to look at. Use the table in [The dashboard](#the-dashboard).
   6. Give a short text summary too: the number of issues at each severity, and the title of each `critical` or `major` issue.
   7. Tell the user the next step: turn on the fixer, turn on GitHub, or start the patrol. Ask before you turn on the fixer or GitHub.

   The dashboard updates live when a session finishes. You can start it before `explore`, so that the user can watch the explorer work.

### Optional: let it fix bugs

Turn on the fixer only when the user agrees, because the fixer writes code:

```yaml
agents:
  fixer:
    enabled: true
    minSeverity: minor
    commitMessage: 'fix(app): {title}'     # match the repo's commit style and hooks: read `git log --oneline`
    retest: { prepare: npm ci }            # installs the dependencies in each new worktree
    verify: npm run typecheck && npm test  # Bughunters runs this after each fix
    use: claude                            # or codex, kimi, pi
```

- Set `prepare` to the install command of the repo's package manager, for example `pnpm install --frozen-lockfile`. Bughunters runs it in each new worktree before the fixer starts and before each retest.
- Set `verify` to the checks that a fix must pass. The `claude` fixer preset can edit files, but it cannot run commands, so Bughunters runs `verify` itself. If `verify` fails, the fix fails, and the fixer gets a lesson with the error.

```bash
npx bughunters@latest fix                     # fix the worst open issues, then retest each fix
npx bughunters@latest fix --issue <id>
npx bughunters@latest retest --issue <id>
```

The command lists each fix with its status and its branch. The fixer works only in `.bughunters/runs/worktrees/`. It never changes the user's checkout.

After the retest, each fix has a verdict: ✅ fixed, ❌ not fixed (the fixer tries again), or ❔ unclear. Unclear means that the explorer could not reach the screen in the retest, often because of [the state of the test account](#the-state-of-the-test-account). Tell the user the verdict of each fix.

### Optional: publish to GitHub

Turn on GitHub only when the user agrees, because it writes to the team's repo. Tell the user what it does before you turn it on:

- It opens a PR for each fix, and a GitHub issue for each bug at `issueMinSeverity` or worse that has no fix.
- It makes the `bughunters` label, and it pushes the orphan branch `bughunters-assets` with the report screenshots.
- It pushes one branch for each fix: `bughunters/fix-<issue>`.

It needs a logged-in `gh` CLI with push access to the repo. Check with `gh auth status`, or with `npx bughunters@latest doctor`.

```yaml
agents:
  github:
    enabled: true
    pullRequests: draft          # draft | ready
    issueMinSeverity: major
```

Do these steps in order:

1. Write the reports locally. Nothing goes to GitHub:

   ```bash
   npx bughunters@latest publish --dry-run
   ```

2. Show the user the list of drafts, and give them the path of each draft file in `.bughunters/runs/publish/`.
3. Ask the user if you can publish. Publish only after a yes:

   ```bash
   npx bughunters@latest publish
   ```

4. Give the user the URL of each PR and issue. The command prints them.

To read the state of the PRs and issues back from GitHub, run `npx bughunters@latest github sync`. A PR that the team closes without a merge becomes a lesson, and an issue that the team closes as not planned becomes a dismissal. Full reference: https://github.com/agent-labs-dev/bughunters/blob/main/docs/github.md

### Optional: run all day

```bash
npx bughunters@latest patrol --once       # one full cycle: setup, explore, judge, teardown, fix, retest, publish
npx bughunters@latest patrol              # repeat every agents.patrol.intervalMinutes (default 30); a cycle runs only when origin/main has a new commit
```

`patrol` does not stop by itself. Run it in the background or in a separate terminal.

## 4. Look at the results

### The dashboard

```bash
npx bughunters@latest dashboard               # http://127.0.0.1:4311
npx bughunters@latest dashboard --port 5000
```

The dashboard does not stop by itself. Run it in the background, open the URL in the user's browser, and give the user the URL. It listens on 127.0.0.1 only, and it is read-only. If port 4311 is in use by a different program, add `--port`.

| Page | What it shows | Show it when the user asks |
| --- | --- | --- |
| **Overview** | What each agent does now and what it spent, the issues that need a human, the live screen, and the screens found so far | "What is Bughunters doing?" |
| **Issues** | Each issue with screenshots, steps, the judge's reason, the fix diff, the before and after retest, and the GitHub state | "What bugs did it find?", "Did the fix work?" |
| **Activity** | Each session as a timeline | "What did the explorer do?" |
| **Screens** | A graph of the screens and how they connect | "What parts of the app did it test?" |
| **Memory** | The lessons that the agents learned | "What does it know about my app?" |

### The terminal

| Command | Use |
| --- | --- |
| `npx bughunters@latest issue list` | The issues, worst first |
| `npx bughunters@latest issue dismiss <id> --reason "..."` | Close an issue as not a bug. It does not come back |
| `npx bughunters@latest issue reopen <id>` | Open a dismissed issue again |
| `npx bughunters@latest memory list` | The lessons that the agents learned |
| `npx bughunters@latest memory add --role explorer "text"` | Add a lesson, for example a hint about the app |
| `npx bughunters@latest replay <routine-id>` | Replay a learned routine with no model |
| `npx bughunters@latest worktrees clean` | Remove the worktrees of finished fixes |

### The files

To summarize the results for the user, read these files:

| Path | Content |
| --- | --- |
| `.bughunters/runs/issues/<id>.json` | One issue: `title`, `severity`, `status`, `body` (the judge's report), `judgement.reason`, and `evidence` (screenshots) |
| `.bughunters/runs/fixes/<id>.json` | One fix: `status`, `branch`, `diff`, `retests`, and `pr` |
| `.bughunters/runs/sessions/<id>/` | One explorer session and its screenshots |
| `.bughunters/runs/appmap.json` | The screens that the explorer found |
| `.bughunters/runs/memory.json` | The lessons |

Severity, worst first: `critical`, `major`, `minor`, `cosmetic`.

| Issue status | Meaning |
| --- | --- |
| `new` | The judge filed it. It is not on GitHub |
| `filed` | It is on GitHub |
| `fixing` | The fixer works on it now |
| `fix-proposed` | A fix waits for a review, or for its PR |
| `fixed` | The fix is verified, or the issue was closed on GitHub as completed |
| `dismissed` | A human or GitHub closed it as not a bug. It does not come back |

The `costUsd` in each `session.json` counts only the API calls that Bughunters makes: Jev and the `runtime: model` agents. A local agent CLI (`claude`, `codex`, `kimi`, `pi`) uses the user's own plan, and Bughunters does not see its cost.

Each `session.json` also has `tokens` and `tokensByModel`. The Overview page shows a **Token usage** table for the last 7 days, for each agent and model. When the user asks about cost, or wants to compare models, show this table, and give the tokens per session.

## Rules

- Run the CLI as `npx bughunters@latest`, unless the repo lists `bughunters` in `package.json`.
- Do not continue without a defined way to launch the app and to sign in. If you do not have one, ask the user.
- Never print, log, or commit a secret value. Put secrets in environment variables, and list their names in `app.secrets`.
- Never point Bughunters at production data, unless the user says that it is safe.
- Ask the user before you turn on `agents.fixer` or `agents.github`.
- Do not edit files in `.bughunters/runs/` by hand. Use the CLI commands.
- When a human dismissed an issue or closed a PR, do not undo that decision.

## Troubleshooting

| Problem | Action |
| --- | --- |
| `Web driver requires app.connect.url or run.url` | Set `app.connect.url` |
| Setup times out | Correct the `readyWhen` regex, or increase `timeoutMs` |
| Playwright cannot find Chromium | Run `PLAYWRIGHT_SKIP_BROWSER_GC=1 npx -y playwright@1.48.2 install chromium` |
| The explorer stays on the sign-in screen | Write clearer sign-in steps in `.bughunters/instructions.md`, and check that the secrets are set |
| Electron does not connect | Make sure that the app opens a CDP port, and that `capture` reads the port from the output |
| Mobile does not connect | Boot a simulator or start an emulator, check `maestro --version`, and check `connect.appId` |
| `No .bughunters/bughunters.yml found` | Run `npx bughunters@latest init` at the project root |
| `Bughunters now keeps its config in .bughunters/` | An old version wrote the config at the root. Run the commands in the message |
| `Judging 0 new candidate(s)` | The judge already decided these candidates. Run `explore` again for new ones |
| The explorer spends its steps in onboarding | Read [The state of the test account](#the-state-of-the-test-account) |
| A retest verdict is ❔ unclear | The explorer did not reach the screen in the retest. Check the state of the test account |
| `GitHub is off` or `The fixer is off` | Ask the user, then set `agents.github.enabled` or `agents.fixer.enabled` to `true` |
| No issues after `explore` | Run `npx bughunters@latest judge`. The judge files the issues |
| `... is not set` or `... is not on PATH` at the start | Set the key, install the CLI, or change `agents.<role>.use` |
| `Decider: none` in the output | No Jev key is set. Ask the user to set `TYPESAFE_API_KEY`, `OPENROUTER_API_KEY`, or `AI_GATEWAY_API_KEY` |

Full docs: https://github.com/agent-labs-dev/bughunters/tree/main/docs
