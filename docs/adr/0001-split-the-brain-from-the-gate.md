# ADR 0001 — Split the LLM brain from the CI gate

**Status:** Accepted
**Date:** 2026-09-19

## Context

Agentic UI testing tools are appearing, and the obvious design is to put an agent in CI: let it navigate, let it judge, let it decide whether the build passes.

Published agent task success sits at 74–86%, and per-run cost ranges from $0.40 to $45 depending on approach. A merge gate needs to be bit-exact and near-free.

## Decision

The agent and the gate are separate components with separate rights.

The agent navigates freely exactly **once**, during Recon. Its output is frozen into deterministic artifacts: replayable Playwright flows, pinned baselines, and a screen graph. Every subsequent run executes those frozen artifacts.

Only a tier-1 deterministic check may fail a GitHub Check. Everything the decision layer produces becomes an issue, a question, or a suggestion.

## Consequences

**Good.** An ~80%-accurate agent becomes safe to put behind a merge gate, because it is not in the gate. If the agent mis-navigates during Recon, a human corrects the model once and every subsequent run inherits the correction. A red check always means the same thing.

**Costly.** Recon is a real, one-time expense (~$5–30) and needs a human review step. Re-running it when the app changes shape is unavoidable.

**Rejected alternative:** an agent that judges every run. This is a flaky test generator, and the competitive research is unambiguous about what happens next — teams stop trusting the signal and the tool gets disabled.
