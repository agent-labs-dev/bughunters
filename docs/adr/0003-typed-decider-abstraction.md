# ADR 0003 — The decision layer is a typed interface, not a provider

**Status:** Accepted
**Date:** 2026-09-19

## Context

Continuous testing makes the model layer the dominant cost centre. Sending every screen to a frontier model does not survive contact with a real bill: ~$9 for a 500-screen sweep, versus ~$0.08 with a cheap typed decider — roughly 107×.

The preferred always-on decider (Jev) is early access, waitlisted and rate-limited. A production tool cannot hard-depend on that. Its vendor benchmark also puts it at 67.8%, which is not good enough to be the final word on whether something is a bug.

## Decision

The decision layer is the `Decider` interface: a state string plus typed questions in, typed answers with calibrated confidence out.

Four implementations ship: `JevDecider` (default), `ModelDecider` (a general model prompted into the same contract), `LocalDecider` (air-gapped), `HeuristicDecider` (rule-only, zero network).

**Amendment (2026-09).** Bughunters is agentic, so a rule-only decider has no place in it. `LocalDecider` and `HeuristicDecider` are removed. Two implementations remain: `JevDecider` (the default, and the recommended one for cost and speed) and `ModelDecider` (the fallback when no Jev key is set). With no key at all, there is no decider: every finding goes to the LLM judge, which costs more. `run --no-models` does not need a decider: it skips tier 2.

Confidence is used as a **threshold, not read as a fact**. The routing asymmetry is enforced in code: auto-suppression and auto-fix require high confidence; raising a question has no confidence floor.

## Consequences

**Good.** Swapping deciders is a config change; the caller never knows which ran. `--no-models` performs a full deterministic run with no egress, which is real rather than aspirational. A ~68%-accurate decider is safe as a filter and router because its errors are recoverable — the expensive path is still available.

**Good, structurally.** The default decider is text-only, so the default reasoning path carries **no image tokens at all**. The constraint pushes the architecture toward the cheap design rather than away from it.

**Good, for security.** A component that returns typed answers to predefined questions cannot emit a tool call, a command, or a plan. The always-on brain reads untrusted page content on every run, and having no agency removes most of the prompt-injection surface by construction.

**Costly.** Every question must be declared up front; the decider cannot be asked something the schema does not describe. The state must be engineered and pruned rather than dumped.
