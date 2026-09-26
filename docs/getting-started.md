# Getting started

This guide adds Bughunters to your repo, step by step. For a faster setup, install the [Bughunters skill](../skills/bughunters/SKILL.md) with `npx skills add agent-labs-dev/bughunters`, and ask your coding agent to set up Bughunters. The skill does these steps for you.

## Requirements

- Node 22 or later.
- `git`, and your app in a git repo with an `origin` remote. Each patrol cycle pulls `origin/main`, and the fixer works in git worktrees.
- An LLM for the agents: an agent CLI (Claude Code, Codex, Kimi CLI, or pi), or an API key.
- For web apps: Chromium for Playwright. Install it one time:

  ```bash
  PLAYWRIGHT_SKIP_BROWSER_GC=1 npx -y playwright@1.48.2 install chromium
  ```

- For iOS: Xcode and a booted simulator. For Android: the Android SDK and a running emulator. For both: [Maestro](https://maestro.mobile.dev).
- For Electron: an app build that opens a CDP port (`--remote-debugging-port`).
- For GitHub: a logged-in [`gh`](https://cli.github.com) CLI.

You do not need to install Bughunters. Run each command with `npx bughunters`. You can also add it to your project:

```bash
npm install --save-dev bughunters     # then: npx bughunters ...
```

## Before you start: launch and sign in

Bughunters needs two things from you:

1. **A way to launch the app on this machine.** This is usually the command that you use for local work, for example `npm run dev`. The app must start with no manual steps. For mobile, the app must be installed on the simulator or the emulator.
2. **A way to sign in**, if the app has a sign-in. Use one of these, best first:
   - The app starts signed in: a dev auth bypass, a seeded session, or a deep link that installs a session.
   - A setup command makes a test user: a seed script, or a test-only login endpoint.
   - A test account: put the email and the password in environment variables, and list them in `app.secrets`.

The explorer cannot get through a one-time code, a CAPTCHA, or a third-party SSO page. If your sign-in has one of these, add a test bypass for development. Never use a production system or a real user's account.

## 1. Run init

Run this command in your repo:

```bash
npx bughunters init
```

`init` finds your app and the LLMs on your machine, and it asks you some questions. It puts each detected value on the input line. Push Enter to keep the value, or edit it:

1. The kind of app (web, Electron, iOS, or Android), the command that starts it, and its URL or app ID. `init` reads these from `package.json`, the Vite config, `.env`, `app.json`, `app.config.ts`, the Xcode project, and the Gradle files.
2. The LLM for each agent: the explorer, the judge, and the fixer. An installed agent CLI (Claude Code, Codex, Kimi CLI, or pi) comes first, because it needs no API key. If you have no CLI, `init` recommends an OpenRouter or a Vercel AI Gateway key, and shows where to get one.
3. The route to Jev, the low-cost model that screens each finding. Refer to [LLMs and Jev](models.md).

`init` puts all the Bughunters files in one `.bughunters/` folder, and it never overwrites a file:

```text
.bughunters/
  bughunters.yml     # the config: commit it
  instructions.md    # the app guide for the explorer: commit it
  runs/              # the local data and screenshots: init adds it to .gitignore
```

To use the detected values with no questions, add `--yes`. To select the LLM, add `--agent`:

```bash
npx bughunters init --yes --agent claude     # claude | codex | kimi | pi | openrouter | vercel | openai | anthropic
npx bughunters init --yes --explorer claude --judge claude --fixer codex --jev openrouter
```

## 2. Check how Bughunters starts your app

Open `.bughunters/bughunters.yml`, and correct the values that `init` could not know. All paths in the file are relative to the project root, the folder that holds `.bughunters/`. You can run Bughunters from any folder in the project.

This example is a web app with a dev server:

```yaml
version: 1

app:
  platform: web                      # web | electron | ios | android
  source: .                          # the repo that the fixer edits
  setup:
    - run: npm run dev
      background: true               # keep it alive for the session
      readyWhen: 'Local:|ready'      # wait until the output matches this regex
  connect:
    url: http://localhost:3000
  instructions: .bughunters/instructions.md
```

This example is an Electron app:

```yaml
version: 1

app:
  platform: electron
  source: .
  setup:                             # your commands: build, start, sign in a test user
    - run: ./scripts/start-test-app.sh
      capture: { CDP_PORT: 'CDP :(\d+)' }   # a value from the output, for later steps
  teardown:
    - run: ./scripts/stop-test-app.sh
  connect:
    cdp: http://127.0.0.1:${CDP_PORT}
  instructions: .bughunters/instructions.md
```

For iOS and Android, set `platform: ios` or `platform: android`, and set `connect.appId` to the bundle ID or the package name. Bughunters uses the booted simulator or the running emulator. To select a different device, set `connect.device`. The [examples](development.md#examples) show a full Electron setup and a full iOS setup.

## 3. Write the app guide

`.bughunters/instructions.md` is plain English for the explorer. `init` writes a template. Write it like a note to a new tester:

```markdown
# My App
My App is a chat workspace. The sidebar lists the channels.

## Sign in
Sign in with the email {{TEST_EMAIL}} and the password {{TEST_PASSWORD}}.

## Onboarding
Type `Bughunters` as the first name. For the username, type `bughunters-{{RUN_TAG}}`.

## Never do these things
- Do not delete the workspace. Do not invite a person by email.
```

To give the explorer a secret, list its environment variable in `app.secrets`:

```yaml
app:
  secrets: [TEST_EMAIL, TEST_PASSWORD]
```

Secrets and captured values reach the model only as `{{NAME}}` placeholders. Bughunters puts in the real value only when it acts on the app. It hides the value in all logs.

## 4. Check the model keys

If an agent uses an API key, set the key in your shell. Also set a Jev key, because Jev cuts the cost:

```bash
export OPENROUTER_API_KEY=...        # one key for the agents and for Jev
```

Before an agent command starts the app, Bughunters checks each agent's LLM. If a key or a CLI is missing, it stops and tells you what to do. Refer to [LLMs and Jev](models.md) for all the providers.

## 5. Explore, and look at the results

```bash
npx bughunters explore        # one explorer session: it signs in, maps screens, reports problems
npx bughunters judge          # the judge decides which reports are real and files the issues
npx bughunters dashboard      # http://127.0.0.1:4311
npx bughunters issue list     # the same issues, in the terminal
```

The first session maps the app and learns **routines**. A routine is a path that Bughunters can replay later with no model, for example `enter-app`. Each later session starts from what it already knows.

## 6. Let it fix bugs

```yaml
agents:
  fixer:
    enabled: true
    commitMessage: 'fix(app): {title}'     # match your commit hook
    retest: { prepare: npm ci }            # installs the dependencies in each new worktree
    verify: npm run typecheck && npm test  # Bughunters runs this after each fix
    use: claude                            # or codex, kimi, pi, or an API key
```

Set `verify` to the checks that a fix must pass. Bughunters runs the command itself, because the `claude` fixer preset can edit files but cannot run commands. If `verify` fails, the fix fails, and the fixer gets a lesson with the error.

```bash
npx bughunters fix            # fix the worst open issues, then retest each fix in the app
```

Each fix gets a branch `bughunters/fix-<issue>` and a git worktree under `.bughunters/runs/worktrees/`. Bughunters links your ignored `.env` files into each worktree. Then it starts the app from the worktree, and the explorer repeats the flow. The judge compares the before and after screenshots. If the bug is still there, the fixer tries again with the judge's feedback.

## 7. Publish to GitHub

```yaml
agents:
  github: { enabled: true }
```

```bash
npx bughunters publish --dry-run   # write the reports to .bughunters/runs/publish/ and look at them
npx bughunters publish             # open the PRs and issues
```

[GitHub](github.md) tells what Bughunters publishes, what it changes in the repo, and how it syncs the state back.

## 8. Run it all day

```bash
npx bughunters patrol              # setup → explore → judge → teardown → fix → retest → publish, then repeat
npx bughunters patrol --once       # one cycle
```

## Next steps

- [LLMs and Jev](models.md): what each model does, and the providers for each agent.
- [Configuration](configuration.md): all the settings.
- [Commands](commands.md): all the commands.
- [The dashboard](dashboard.md): what each page shows.
- [How it works](how-it-works.md): the cycle, noise control, memory, and safety.
