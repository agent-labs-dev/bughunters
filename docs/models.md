# LLMs and Jev

Bughunters uses two kinds of model:

- **LLM agents** do the work that needs reasoning: they use the app, decide which reports are real bugs, and write the fixes.
- **Jev** does the fast, repeated triage: it screens each finding from the automatic checks in one low-cost call.

This split lets Bughunters run all day on your app at a low cost. The automatic checks can find many small problems on each screen. Jev screens all of them, and the LLM judge gets only the findings that need a decision.

## What each model does

| Part | Model | What it does | When it runs |
| --- | --- | --- | --- |
| Explorer | LLM | Uses the app, maps its screens, and reports what looks wrong. Learns lessons after each session | Each `explore`, each retest |
| Judge | LLM | Looks at each finding and its screenshot. Files an issue, or dismisses the finding with a reason. Compares the before and after screenshots of a fix. Writes the PR and issue summaries | Each `judge`, each retest, each `publish` |
| Fixer | LLM | Reads the issue and the code, and writes a fix in its own git worktree | Each `fix` |
| Decider | Jev | Answers typed questions about each finding from the automatic checks: is it a problem, what kind, how bad, and does it need the judge | Each screen that has a finding |

## Jev

Jev is a "System One" model from [TypeSafe](https://typesafe.ai). It does not write text. It takes the state of a screen and a set of typed questions, and it gives an answer with a confidence for each question, in one call.

For each finding from the automatic checks (contrast, overlap, clipped text, tap size, visual change, console errors), Jev answers these questions:

- Is this behavior different from the expected product behavior?
- Is it a regression, a functional bug, an accessibility problem, a content problem, a flow problem, or visual noise?
- How bad is it: cosmetic, minor, major, or critical?
- Is it too unclear for an automatic decision?

When Jev is confident that a finding is not a problem, Bughunters drops it. Bughunters sends all other findings to the judge. A low confidence never hides a finding.

Jev is a good fit for this work for these reasons:

- **Cost.** Jev costs $0.042 for each million input tokens, and output is free. A general model costs much more for each call.
- **Speed.** One call answers all the questions for a screen.
- **Safety.** Jev reads text only, and it cannot call a tool or write a command. The page content that it reads cannot tell it to do something.

### How to reach Jev

Set one of these keys. Bughunters tries them in this order:

| Route | Environment variable | Get a key |
| --- | --- | --- |
| TypeSafe | `TYPESAFE_API_KEY` | https://typesafe.ai |
| OpenRouter | `OPENROUTER_API_KEY` | https://openrouter.ai/keys |
| Vercel AI Gateway | `AI_GATEWAY_API_KEY` | https://vercel.com/ai-gateway |

To use one route only, set it in `bughunters.yml`:

```yaml
decisions:
  decider: jev
  jev: { via: openrouter }        # auto | typesafe | openrouter | vercel
```

### With no Jev key

We recommend Jev, but Bughunters also works without it:

1. If a general model key is set, a general model answers the same questions (`OPENROUTER_API_KEY`, `AI_GATEWAY_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or a custom endpoint). This costs more, and it is slower.
2. If no key is set, there is no decider. The judge gets every finding. This costs the most.

At the start of each `explore` and `patrol`, Bughunters shows which decider it uses.

## LLM providers for each agent

Each agent (explorer, judge, fixer) needs an LLM. Each agent can use a different provider. Set it in `agents.<role>.use`.

### A local agent CLI

A local agent CLI uses your existing login, so you do not need an API key. Bughunters has presets for these CLIs:

| `use:` | CLI | Notes |
| --- | --- | --- |
| `claude` | [Claude Code](https://claude.com/claude-code) | |
| `codex` | [Codex CLI](https://github.com/openai/codex) | |
| `kimi` | [Kimi CLI](https://github.com/MoonshotAI/kimi-cli) | |
| `pi` | [pi](https://github.com/badlogic/pi-mono) | Needs MCP: `pi install npm:pi-mcp-adapter`. With `pi-permission-modes`, add `--perm yolo` |

```yaml
agents:
  explorer: { use: claude }
  judge: { use: claude }
  fixer: { use: codex }
```

The preset gives each role the correct flags. The explorer and the judge act only through the Bughunters tools, which Bughunters gives to the CLI over MCP. The fixer can edit files, but only in its own worktree.

To add flags, write the full command. A command gets the prompt on stdin and in `{prompt}` (a file). It gets the tools in `{mcp}` (an MCP config file) or `{mcpUrl}`, and the worktree in `{workdir}`:

```yaml
agents:
  judge:
    use:
      runtime: cli
      command: claude -p --model sonnet --mcp-config {mcp} --strict-mcp-config --allowedTools mcp__bughunters
```

### An API key

The built-in model loop calls a provider directly:

| `via` | Environment variable | Get a key | Default model |
| --- | --- | --- | --- |
| `openrouter` | `OPENROUTER_API_KEY` | https://openrouter.ai/keys | `z-ai/glm-5.3-flash` |
| `vercel` | `AI_GATEWAY_API_KEY` | https://vercel.com/ai-gateway | set `model` |
| `openai` | `OPENAI_API_KEY` | https://platform.openai.com/api-keys | set `model` |
| `anthropic` | `ANTHROPIC_API_KEY` | https://console.anthropic.com/settings/keys | set `model` |
| `custom` | `BUGHUNTERS_MODEL_API_KEY` | your provider | set `model` and `endpoint` |

```yaml
agents:
  explorer:
    use: { runtime: model, via: openrouter, model: z-ai/glm-5.3-flash }
  judge:
    use: { runtime: model, via: anthropic, model: claude-haiku-4-5 }
```

`bughunters init` writes a default model for each provider. We recommend OpenRouter or Vercel AI Gateway: one key gives you many models, and the same key can also reach Jev.

## Check the setup

Before an agent command starts the app, Bughunters checks each agent that the command uses. If a key is not set, or a CLI is not on `PATH`, the command stops and tells you what to do.
