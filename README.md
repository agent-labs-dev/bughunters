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
cd examples/fixture-app
node ../../packages/cli/dist/bin.js dashboard     # http://127.0.0.1:4311
```

Two views, both fed by the same local watcher:

- **Runs** — every run, with expected/actual/diff for each screen, every check
  that ran (including the ones that found nothing), and a *How AutoQA reached
  this* panel per screen: how the capture settled, what the diff measured, how
  much was masked, what the decision layer was asked and answered, and the
  sentence that decided where each finding surfaced.
- **App map** — the application as a graph, screenshots as nodes. Solid borders
  are screens AutoQA captured; dashed are linked from a tested screen but
  **never captured**; dotted are external links, recorded and never followed.
  It updates live as a run walks the app.

It binds to loopback only, on purpose: screenshots are of a real application and
routinely contain real data. It is also read-only — a browser tab cannot mutate
run state or race the CLI.

Verify the determinism guarantee yourself — three runs, same commit, zero diffs:

```bash
./scripts/determinism-check.sh
```

**What does not run yet:** `recon`, `baseline`, `findings`, `intent`, `watch`
and the fix pipeline. Without Recon there is no AppModel, so `run` tests the
configured entry URL (or whatever `--screens` names) rather than a crawled app.
See [ROADMAP.md](ROADMAP.md).

Note that capturing baselines outside the pinned runner image is only useful
for local exploration. `autoqa doctor` warns about this, and it is not a
formality — see [ADR 0002](docs/adr/0002-determinism-is-a-contract.md).

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
| `@autoqa/recon` | Bring-up, crawl safety, change mapping |
| `@autoqa/github-app` | Checks, issues, slash commands, least-privilege permissions |
| `@autoqa/dashboard` | The local UI: run history, the app map, live watching |
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
