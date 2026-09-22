# Roadmap

Each milestone has a concrete "done when". Feature lists without acceptance criteria are how projects in this category drift for a year and ship nothing — and this category has a lot of graves in it.

Status legend: **scaffolded** = types, contracts and tests exist; the seam is fixed but the behaviour is not wired end to end.

---

## M0 — Walking skeleton · *scaffolded*

`init`, config parsing, single-URL capture in the pinned image, baseline, pixel diff, GitHub Check, report artifact.

**Done when:** on a trivial app, changing one CSS colour produces a failing Check with before/after/diff images attached and an actionable summary. No models, no recon, no crawl.

This milestone proves the determinism contract before anything is built on top of it.

- [x] Config schema and loader with conservative defaults (`@autoqa/core`)
- [x] Exit-code semantics, with infrastructure failures separated from product failures
- [x] Determinism contract: launch flags, clock freeze, seeded RNG, font audit (`@autoqa/capture`)
- [x] Stability gate — two consecutive byte-identical frames, never a sleep
- [x] Diff engine: odiff primary, pixelmatch cross-check, mask accounting (`@autoqa/diff`)
- [x] Tolerance policy: exact by default, per-region only, hollow-test flagging
- [x] Report surfaces: HTML, sticky PR comment, JUnit, SARIF (`@autoqa/report`)
- [x] `autoqa init` / `autoqa doctor`
- [ ] Wire capture → diff → check end to end against the fixture app
- [ ] Publish and pin the runner image by digest

## M1 — Recon

Bring-up resolution, auth resolution, the crawl, screen and flow modelling, baseline capture across viewports, and the human review gate.

**Done when:** an unaided `autoqa recon` against a real authenticated app produces an AppModel containing the app's actual screens, and a human can correct it in a review surface in under ten minutes.

Auth is the gate. If this does not work on a real app with real login, nothing downstream matters.

- [x] Stack and bring-up detection ladder, rungs 1–3 (`@autoqa/recon`)
- [x] Crawl frontier, URL normalisation, dedup key, enforced budgets
- [x] Destructive-action classification, ambiguous-means-destructive default
- [x] Production detection
- [ ] Auth strategies: form, storageState, seededUser, ssoBypass, manual
- [ ] Screen and flow modelling; the AppModel artifact
- [ ] The human review gate

## M2 — Source mapping and change-aware runs

**Done when:** editing one shared component selects every screen that renders it, and the report explains why each screen was chosen.

- [x] Test-plan builder with a reason on every item (`@autoqa/recon`)
- [x] Shared-component blast radius
- [x] Smoke fallback on low mapping confidence, reported rather than silent
- [ ] The mapping cascade: route tables, component attribution, string-literal index, embeddings
- [ ] tree-sitter code index

## M3 — The deterministic detector suite · *the moat*

**Done when:** three consecutive runs against an unchanged commit produce zero diffs across every screen and viewport.

**This is the single most important acceptance criterion in the roadmap.** It is the property every competitor fails, and until it holds, nothing above this layer can be trusted. It runs as a CI test of AutoQA itself on every commit — see `.github/workflows/determinism.yml`.

- [x] Layout invariants: overlap, overflow, occlusion, off-viewport, zero-size, shift
- [x] Usability invariants: contrast, tap target, broken imagery, unstyled content
- [x] New-versus-baseline console errors (no first-run avalanche)
- [ ] axe-core integration, new violations only
- [ ] Network HAR record and replay
- [ ] Performance deltas: LCP, CLS, TBT
- [ ] The three-run flake test wired to the fixture app

## M4 — The decision layer

**Done when:** on a real repo, a measured majority of raised findings are accepted by a human as real, and the accepted rate is tracked per detector. Below that bar, tune detectors rather than adding new ones.

- [x] `Decider` interface with Jev, model, local and heuristic implementations
- [x] State digest with pruning and repeated-assertion collapsing
- [x] Confidence routing, with the never-auto-silence asymmetry enforced in code
- [x] Clustering: deterministic pass, then model pass on residual pairs
- [x] The Intent Ledger, committed and auditable
- [x] Noise control: per-run issue cap, first-run quarantine, flake quarantine
- [ ] `ModelDecider` real implementation
- [ ] Decision cache persistence keyed on state hash
- [ ] Per-repo threshold tuning against reversed decisions

## M5 — Reporting and the local loop

**Done when:** a developer fixes a regression using only the PR comment, without opening the full report.

- [x] Static HTML report with the test plan first
- [x] Sticky PR comment, edited in place
- [x] Slash-command parsing
- [x] JUnit and SARIF export
- [ ] Onion-skin slider and video scrubbing
- [ ] `autoqa watch`
- [ ] Compact ffmpeg highlight clips

## M6 — Autonomous fix PRs

**Done when:** a real bug is found, filed, fixed by an AutoQA PR, and merged by a human who read the evidence and agreed. One end-to-end example is worth more than ten features here.

- [x] Fix eligibility gate in the decision layer
- [ ] The narrow fix-class allowlist and denylist
- [ ] Deterministic reproduction, locate, minimal diff
- [ ] Self-verification against the full tier-1 suite before the PR opens

## Deliberately deferred

| Item | Why it waits |
| ---- | ------------ |
| Mobile (Maestro, Roborazzi, swift-snapshot-testing) | A separate toolchain and a separate appetite. Ship web first. |
| Canvas and WebGL apps | Needs the VLM grounding path on the critical route, not as a fallback. |
| Hosted control plane | CLI-only is the honest v1. The control plane monetises convenience, not correctness. |
| Cross-repo shared components | Hard to do well; worse to half-do. |
