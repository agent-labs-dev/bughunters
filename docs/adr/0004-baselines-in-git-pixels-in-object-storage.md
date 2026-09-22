# ADR 0004 — Commit the manifest, not the pixels

**Status:** Accepted
**Date:** 2026-09-19

## Context

Baseline storage is the choice that generates the most long-term operational pain, and the one teams most often get wrong.

A repo with 500 screens at 6 viewports and ~200KB per PNG is roughly 600MB of baselines. Substantial but manageable in object storage; prohibitive in git, where every CI clone pays for it forever.

GitHub Actions artifacts are not a baseline store: short default retention and a hard quota.

## Decision

Three small files are **committed** and reviewable in the PR:

```
.autoqa/appmodel.json             # the AppModel
.autoqa/baselines.manifest.json   # hashes + image digest, NOT the pixels
.autoqa/intents.json              # the Intent Ledger
.autoqa/runs/                     # gitignored, local run output
```

Screenshots and videos live in content-addressed object storage. A baseline is addressed by `hash(content) + imageDigest`.

## Consequences

**Good.** The repo stays lean, the manifest diffs cleanly, and a baseline change is reviewable in the pull request — the property teams actually want from git-committed images without the bloat. Binding the key to the image digest means an image change automatically invalidates baselines and forces a re-capture rather than producing a diff storm.

**Good.** The committed Intent Ledger is auditable in code review. A ledger nobody can audit is just a mute button.

**Costly.** An extra CI step to pull and push objects, and the loss of native image review in the PR diff — recovered via the report and the sticky comment.
