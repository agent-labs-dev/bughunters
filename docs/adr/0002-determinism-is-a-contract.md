# ADR 0002 — Determinism is a contract, not a configuration surface

**Status:** Accepted
**Date:** 2026-09-19

## Context

Across every research lane, the pain-point evidence converges on one root cause: font rendering, anti-aliasing, sub-pixel differences and host-environment drift produce false positives that destroy developer trust. Reports of "50–95% of tests fail randomly" are common.

The second-order damage is worse than the first: once engineers believe the red is noise, they ignore real failures too.

Existing tools respond with documentation ("generate baselines on a machine that matches CI") and a tolerance knob.

## Decision

Baselines are captured in exactly the same pinned container image that later runs the comparison. A digest change invalidates baselines and forces a re-capture rather than producing diffs.

Rendering, clock, locale, randomness, motion and network are all pinned in code (see `docs/determinism-contract.md`). A font falling back to an unbundled family fails the run loudly.

Capture uses a **stability gate** — two consecutive byte-identical frames — never a sleep. A timeout is an infrastructure error, not a diff.

Tier-1 tolerance is exact. There is no global threshold field in the config schema, only per-region overrides.

## Consequences

**Good.** The largest category of false positive becomes structurally impossible rather than something a user is told to work around. This is the headline feature, not a footnote.

**Costly.** Ongoing maintenance: fonts, image pinning, browser revisions. The three-run flake test is AutoQA's own must-pass CI job (`.github/workflows/determinism.yml`) precisely because this decision only holds if it is continuously verified.

**Rejected alternative:** a global tolerance threshold. Every tool that ships one has a user who turned it up until the build went green and it stopped catching anything. The research documents a zero-threshold config reporting a completely missing button as PASSING.
