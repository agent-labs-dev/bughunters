<p align="center">
  <img src="assets/banner.png" alt="Bughunters: AI agents that explore your app, find bugs, and fix them." width="100%">
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/bughunters"><img src="https://img.shields.io/npm/v/bughunters?color=a3e635&label=npm" alt="npm version"></a>
  <a href="https://github.com/agent-labs-dev/bughunters/actions/workflows/ci.yml"><img src="https://github.com/agent-labs-dev/bughunters/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue" alt="License: Apache-2.0"></a>
</p>

Bughunters is a QA team made of agents. It uses your app the way a tester does, finds bugs, fixes them, checks each fix in the running app, and opens the pull requests and issues for your team.

- An **explorer** agent runs the app, maps its screens, and reports what looks wrong.
- A **judge** agent decides which reports are real bugs, and writes the issues.
- A **fixer** agent writes a fix in its own git worktree. Then the explorer and the judge **retest** the fix in the running app.
- Bughunters **publishes** to GitHub: a PR for each fix, and an issue for each major bug with no fix.

It works on web apps, desktop apps (Electron), and mobile apps (iOS and Android, native or React Native). It runs on your machine, and it can run all day as a patrol.

```bash
npx bughunters explore
```

## Set up with your agent

Give this prompt to your coding agent (Claude Code, Codex, Cursor, or a different agent):

```text
Read https://raw.githubusercontent.com/agent-labs-dev/bughunters/main/skill/SKILL.md and set up Bughunters for this repo.
```

The [skill](skill/SKILL.md) tells the agent what Bughunters does, how to configure it for your app, how to run it, and how to show you the results.

To keep the skill in Claude Code, save it in your repo:

```bash
mkdir -p .claude/skills/bughunters
curl -fsSL https://raw.githubusercontent.com/agent-labs-dev/bughunters/main/skill/SKILL.md -o .claude/skills/bughunters/SKILL.md
```

## Set up by hand

Bughunters needs two things from you: a command that launches your app on this machine, and a way to sign in (a test account, a seed script, or a dev auth bypass). [Getting started](docs/getting-started.md#before-you-start-launch-and-sign-in) tells more.

You need Node 22 or later. For a web app, install Chromium for Playwright one time:

```bash
npx -y playwright@1.48.2 install chromium
```

1. Run `init` in your repo. It finds your app and the LLMs on your machine, and asks which LLM each agent uses:

   ```bash
   npx bughunters init
   ```

2. Check `bughunters.yml`. It tells Bughunters how to start your app.

3. Write `instructions.md`. It is a plain-English note for the explorer: what the app is, how to sign in, and what never to do.
   Refer to secrets as `{{NAME}}`, and list their names in `app.secrets`. Bughunters never sends the real values to a model.

4. Explore, judge, and look at the results:

   ```bash
   npx bughunters explore       # the explorer maps the app and reports problems
   npx bughunters judge         # the judge files the real bugs as issues
   npx bughunters dashboard     # http://127.0.0.1:4311
   ```

When the first results look good, let Bughunters fix bugs, publish to GitHub, and run all day:

```bash
npx bughunters fix           # fix the worst issues, then retest each fix in the app
npx bughunters publish       # open the PRs and issues
npx bughunters patrol        # the full cycle, again and again
```

The fixer and GitHub are off until you turn them on. [Getting started](docs/getting-started.md) shows each step in full, with Electron and mobile examples.

## LLMs and Jev

Bughunters uses LLM agents for the work that needs reasoning, and Jev for the fast, repeated triage. This split lets it run all day on your app at a low cost.

| Part | Model | What it does |
| --- | --- | --- |
| Explorer | LLM | Uses the app, maps its screens, and reports what looks wrong |
| Judge | LLM | Decides which findings are real bugs, writes the issues, and checks each fix |
| Fixer | LLM | Writes a fix in its own git worktree |
| Decider | [Jev](https://typesafe.ai) | Screens each finding from the automatic checks in one fast, low-cost call, so the judge gets only the findings that need it |

Each agent can use a different LLM:

- A local agent CLI, with your existing login: [Claude Code](https://claude.com/claude-code), [Codex](https://github.com/openai/codex), [Kimi CLI](https://github.com/MoonshotAI/kimi-cli), or [pi](https://github.com/badlogic/pi-mono).
- An API key: OpenRouter, Vercel AI Gateway, OpenAI, Anthropic, or a custom endpoint.

Jev needs a TypeSafe, OpenRouter, or Vercel AI Gateway key. We recommend a Jev key: without it, a general model or the judge does the triage, at a higher cost. [LLMs and Jev](docs/models.md) tells more, and shows how to configure each agent.

## What is supported

| Area | Supported |
| --- | --- |
| Platforms | Web (Playwright), Electron (CDP), iOS simulator and Android emulator (Maestro) |
| Login | Any auth system: your own setup commands plus plain-English instructions |
| Agent LLMs | Claude Code, Codex, Kimi CLI, pi, or any CLI agent; or an API key for OpenRouter, Vercel AI Gateway, OpenAI, Anthropic, or a custom endpoint |
| Triage | Jev, through TypeSafe, OpenRouter, or Vercel AI Gateway |
| GitHub | PRs, issues, and state sync through the `gh` CLI |
| Output | A local dashboard, GitHub PRs and issues, and JSON files under `.bughunters/` |

## Documentation

| Page | What it covers |
| --- | --- |
| [Getting started](docs/getting-started.md) | Add Bughunters to your repo, step by step |
| [LLMs and Jev](docs/models.md) | What each model does, and the providers for each agent |
| [Configuration](docs/configuration.md) | All the settings in `bughunters.yml` |
| [Commands](docs/commands.md) | All the CLI commands |
| [The dashboard](docs/dashboard.md) | What each page shows, and the files behind it |
| [How it works](docs/how-it-works.md) | The cycle, noise control, memory, GitHub, and safety |
| [The deterministic gate](docs/deterministic-gate.md) | `bughunters run`: a merge gate for web apps that uses no agent |
| [Development](docs/development.md) | Build Bughunters from source, the packages, and the examples |

## License

[Apache-2.0](LICENSE)
