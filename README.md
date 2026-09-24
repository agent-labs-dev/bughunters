# AutoQA

A continuously-running QA engineer for your repository.

AutoQA performs a one-time **Recon** pass that boots your product, works out how to log in, crawls every screen it can reach, and builds a model of the app. Every run after that either re-tests the blast radius of a change or sweeps everything, then surfaces results as a GitHub Check, an HTML report, a GitHub Issue, or a question for a human when it isn't sure.

Apache-2.0. Runs locally with no server, self-hosted, or managed.

---

## The one architectural decision everything follows from

**The LLM brain is split from the CI gate.**

An agent is non-deterministic and expensive. A merge gate needs to be bit-exact and near-free. These are incompatible requirements on the same component, so they are not the same component.

|                    | Brain (agentic)                | Gate (deterministic)     |
| ------------------ | ------------------------------ | ------------------------ |
| When it runs       | Recon, async judgment           | Every CI run             |
| Cost               | High, one-time, budget-capped  | ~$0 marginal             |
| Determinism        | Non-deterministic — acceptable | Bit-exact — required     |
| Can block a merge  | **Never**                      | Yes                      |

The agent navigates freely exactly once, during Recon. Its output is **frozen** into deterministic artifacts: replayable Playwright flows, pinned baselines, and a screen graph. Everything downstream executes those frozen artifacts.

This is what makes an ~80%-accurate agent safe to put in a merge gate.

## Why this exists

The [landscape research](docs/research/oss-visual-testing-landscape-2026.md) found that no open-source tool covers all of: runs in CI, fast and generic, screenshots *and* video, built-in comparison, good reports. Capture is a solved commodity (Playwright). Diffing is a solved commodity (odiff, pixelmatch). **The review-and-approve workflow is where every project either dies or starts charging.**

Two findings shaped the design:

1. **The most-cited open-source Percy alternative is dead.** Lost Pixel was archived on 2026-04-22. That leaves a genuine vacancy.
2. **The number-one real-world complaint is false positives from rendering drift** — fonts, anti-aliasing, sub-pixel differences, host environment. Not missing features. Noise.

So determinism is not a configuration surface here. It is a [contract](docs/determinism-contract.md).

## Running it today

The repo builds and tests from a clean clone. Requires Node 22+ and pnpm 9+.

```bash
pnpm install
pnpm build
pnpm test            # 114 tests
```

### Model providers

Set `decisions.decider` to `jev` (default), `model`, `local`, or `heuristic` in `autoqa.yml`. Available model routes are tried in the order shown:

| Decider | Environment variable | Route |
| --- | --- | --- |
| Jev | `TYPESAFE_API_KEY` | `api.typesafe.ai` |
| Jev | `OPENROUTER_API_KEY` | OpenRouter |
| Jev | `AI_GATEWAY_API_KEY` | Vercel AI Gateway |
| General model | `OPENROUTER_API_KEY` | OpenRouter |
| General model | `AI_GATEWAY_API_KEY` | Vercel AI Gateway |
| General model | `OPENAI_API_KEY` | OpenAI |
| General model | `ANTHROPIC_API_KEY` | Anthropic |
| General model | `AUTOQA_MODEL_ENDPOINT` + `AUTOQA_MODEL_API_KEY` | Custom endpoint |

Set `decisions.jev.via` or `decisions.model.via` to select a route, and `decisions.model.name` to override the default model ID. The run note says which decider ran and why; when no usable key is set, the run uses the heuristic decider. `--no-models` always selects that offline path.

Try the CLI against any repo:

```bash
cd /path/to/your/app
node /path/to/autoqa/packages/cli/dist/bin.js init      # detect stack, write autoqa.yml + workflow
node /path/to/autoqa/packages/cli/dist/bin.js doctor    # verify the determinism contract can hold here
```

Run the fixture app AutoQA tests itself against:

```bash
cd examples/fixture-app
node server.js                 # http://localhost:3000
BREAK=occlusion node server.js # inject one known defect
```

Run it against the fixture app, end to end:

```bash
pnpm --filter @autoqa/capture exec playwright install chromium

cd examples/fixture-app
node ../../packages/cli/dist/bin.js run --no-models   # captures baselines
node ../../packages/cli/dist/bin.js run --no-models   # compares: clean

BREAK=color node server.js &                          # inject one defect
node ../../packages/cli/dist/bin.js run --no-models   # exit 1, with a diff image
```

### The dashboard

```bash
cd examples/nebula-desktop                        # or any workspace
node ../../packages/cli/dist/bin.js dashboard     # http://127.0.0.1:4311
```

The dashboard is the bird's-eye view of the agents. It updates live from the
files under `.autoqa/`:

- **Overview** — the explorer, the judge and the fixer: what each one does now
  and what it spent today; the open issues that need a human; the live screen
  and the last actions of a running session; the screens found so far.
- **Issues** — each issue with its evidence, the routine and steps that
  reproduce it, the judge's reason, and the fixer's proposal with its diff.
- **Activity** — each session as a one-line-per-action timeline. The agent's
  reasoning is one click away, not in the way.
- **Screens** — every screen the explorer found, with its latest screenshot.
- **Checks** — the deterministic `autoqa run` gate: expected/actual/diff per
  screen, and only the checks that fired.

It binds to loopback only, on purpose: screenshots are of a real application and
routinely contain real data. It is also read-only — a browser tab cannot mutate
run state or race the CLI.

Verify the determinism guarantee yourself — three runs, same commit, zero diffs:

```bash
bash scripts/determinism-check.sh
```

**What does not run yet:** `recon`, `baseline`, `findings`, `intent` and
`watch`. See [ROADMAP.md](ROADMAP.md).

Note that capturing baselines outside the pinned runner image is only useful
for local exploration. `autoqa doctor` warns about this, and it is not a
formality — see [ADR 0002](docs/adr/0002-determinism-is-a-contract.md).

## The agents

AutoQA uses the app like a QA team does, on any platform (ADR 0005):

| Role | Job | Default |
| --- | --- | --- |
| Explorer | Operates the app, maps its screens, learns replayable routines, reports what looks wrong | model loop, `z-ai/glm-5.3-flash` via OpenRouter |
| Decider | Fast typed calls on each finding: is it anomalous, where it goes, how severe | Jev |
| Judge | Reviews what the decider cannot settle, and writes the issues | model loop, `z-ai/glm-5.3-flash` via OpenRouter |
| Fixer | Writes a fix for an issue in its own git worktree | `claude -p` (off until enabled) |

Each role runs on a model loop or on a CLI agent that you choose. A CLI agent
gets the prompt on stdin and in `{prompt}`, and the role's tools over MCP in
`{mcp}` or `{mcpUrl}`:

```yaml
agents:
  explorer:
    use: { runtime: model, via: openrouter, model: z-ai/glm-5.3-flash }   # or anthropic, openai, vercel, custom
  judge:
    use: { runtime: cli, command: 'claude -p --mcp-config {mcp}' }
  fixer:
    enabled: true
    use: { runtime: cli, command: 'codex exec --full-auto' }
```

The app itself is described once, in plain terms:

```yaml
app:
  platform: electron             # web | electron | ios | android
  source: ../my-desktop-app      # the repo the fixer edits
  setup:                         # your own commands: build, launch, mint a test session
    - run: ./scripts/launch-test-app.sh
      capture: { CDP_PORT: 'CDP :(\d+)' }   # values the next steps and the explorer can use
  teardown:
    - run: ./scripts/stop-test-app.sh
  connect: { cdp: 'http://127.0.0.1:${CDP_PORT}' }   # or url, or appId (+ device) for mobile
  instructions: instructions.md  # how to sign in, what the app is, what never to do
```

Login works with any auth system: the setup commands do the parts only your
team knows (a test-login route, a seeded user, a session file), and
`instructions.md` tells the explorer the rest in plain English. Secrets and
captured values reach the model only as `{{NAME}}` placeholders, and they are
redacted from every log.

```bash
autoqa explore [--goal "..."] [--steps N]   # one explorer session
autoqa judge [--session <id>]               # judge the newest explorer session
autoqa fix [--issue <id>]                   # propose fixes for open issues
autoqa replay <routine-id>                  # replay a learned routine, no model
autoqa patrol [--once]                      # explore, judge, fix, repeat
```

`examples/nebula-desktop` (Electron over CDP) and `examples/nebula-mobile` (iOS
through Maestro) are complete, real configurations.

## Install (once published)

```bash
pnpm add -D @autoqa/cli
npx autoqa init
npx autoqa doctor
```

## Commands

```
autoqa init | doctor
autoqa recon [--review] [--max-screens N] [--budget-usd X]
autoqa run [--all | --smoke | --screens /a,/b] [--no-models]
autoqa baseline capture | pull | push | accept
autoqa findings list | explain <id> | accept <id> --reason "..."
autoqa intent list | export | prune
autoqa explore | judge | fix | replay <id> | patrol [--once]
autoqa dashboard [--port N]
autoqa report --open
autoqa export --format junit|sarif|json
autoqa watch
```

`autoqa run --no-models` performs a full deterministic run with **no network egress whatsoever**. That is the answer for teams where "is this data sent to a model provider?" is a procurement blocker.

## Exit codes

| Code | Meaning |
| ---- | ------- |
| 0 | Clean, or non-blocking findings only |
| 1 | Tier-1 regression — **the only code that blocks a merge** |
| 2 | Configuration or usage error |
| 3 | Recon required, or the AppModel is unapproved |
| 4 | Infrastructure error — AutoQA could not test |

The separation between `1` and `4` is the most operationally important decision in the CLI. A build that goes red because AutoQA could not start the dev server is a build nobody will keep.

## The three execution tiers

| Tier | What it is | Model | Blocks merge |
| ---- | ---------- | ----- | ------------ |
| **T1 Deterministic** | Pixel diff, layout invariants, a11y, console, network, perf | None | **Yes** |
| **T2 Decided** | Anomalous? Bug or intended? Issue-worthy? Which bucket? | Typed decider | No — raises issues |
| **T3 Judged** | Visual semantics and flow reasoning | VLM + frontier, sampled | No — suggestions |

Only tier 1 may fail a check, so a red build always means the same thing: the same pixels changed, and nothing else.

## Packages

| Package | What it owns |
| ------- | ------------ |
| `@autoqa/core` | Data model, config schema, fingerprinting, exit codes |
| `@autoqa/capture` | Playwright session, the determinism contract, the stability gate |
| `@autoqa/diff` | odiff primary, pixelmatch cross-check, SSIM, mask accounting, tolerance policy |
| `@autoqa/invariants` | The layout invariant engine — **the moat** |
| `@autoqa/decide` | The `Decider` interface, state digest, confidence routing |
| `@autoqa/triage` | Clustering, the Intent Ledger, noise control |
| `@autoqa/report` | HTML report, sticky PR comment, JUnit, SARIF |
| `@autoqa/drivers` | One `Driver` interface for web, Electron (CDP), iOS and Android (Maestro) |
| `@autoqa/agents` | The explorer, judge and fixer; model and CLI runtimes; routines, patrol, workspace state |
| `@autoqa/recon` | Bring-up, crawl safety, change mapping |
| `@autoqa/github-app` | Checks, issues, slash commands, least-privilege permissions |
| `@autoqa/dashboard` | The local UI: the agents' overview, issues, activity, screens, and gate runs |
| `@autoqa/cli` | The `autoqa` command surface |

## Build vs adopt

| Adopt (do not build) | Build (this is the product) |
| -------------------- | --------------------------- |
| Browser and mobile capture | The reconciler: screen ↔ source file ↔ change |
| Pixel and perceptual diff | The layout invariant engine |
| Accessibility scanning | The state digest that makes cheap decisions possible |
| Video encode and trim | Triage: clustering, routing, the Intent Ledger |
| The decision model itself | The review workflow — what every competitor monetises |

Every column-one item is a solved commodity. Every column-two item is missing from the ecosystem or monetised by an incumbent.

## Documentation

- [Technical specification](docs/spec/autoqa-technical-spec.md) — the full design
- [Competitive landscape](docs/research/oss-visual-testing-landscape-2026.md) — the research it came from
- [The determinism contract](docs/determinism-contract.md) — what is guaranteed and how
- [The detection rubric](docs/detection-rubric.md) — every detector and what it catches
- [Roadmap](ROADMAP.md) — milestones with acceptance criteria
- [Architecture decisions](docs/adr/) — ADRs

## Development

```bash
pnpm install
pnpm build
pnpm test
```

## Licence

Apache-2.0 — permissive, with an explicit patent grant, consistent with Playwright. AGPL dependencies are deliberately avoided in the core.
