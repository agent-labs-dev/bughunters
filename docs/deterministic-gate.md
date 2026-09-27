# The deterministic gate (web)

For web apps, `bughunters run` is a merge gate that uses no agent. The agents explore freely. The gate replays frozen artifacts and compares them with pinned baselines, so it gives the same result on the same commit. Only this gate can fail a CI check. The agents never block a merge ([ADR 0001](adr/0001-split-the-brain-from-the-gate.md)).

## Try it

```bash
PLAYWRIGHT_SKIP_BROWSER_GC=1 npx -y playwright@1.48.2 install chromium
npx bughunters init --gate           # write a starter .bughunters/bughunters.yml; correct each TODO value
npx bughunters baseline update --no-models # explicitly approve baselines
npx bughunters run --no-models       # compare: clean
```

`--no-models` disables model calls. The app and browser may still use the network.

To see the gate find a defect, use the fixture app in this repo:

```bash
git clone https://github.com/agent-labs-dev/bughunters && cd bughunters/examples/fixture-app
npx bughunters baseline update --no-models # explicitly approve baselines
npx bughunters run --no-models       # compare: clean
BREAK=color node server.js &         # add one known defect
npx bughunters run --no-models       # exit 1, with a diff image
```

## Exit codes

| Exit code | Meaning |
| --- | --- |
| 0 | Clean, or findings that do not block |
| 1 | A tier-1 regression: **the only code that blocks a merge** |
| 2 | A configuration or usage error |
| 3 | Recon is required, or the app model is not approved |
| 4 | Testing was incomplete: infrastructure, missing evidence, zero coverage, or exhausted decision budget |

## Tiers

The gate has three tiers. Only tier 1 can fail a check:

| Tier | What it is | Model | Blocks a merge |
| --- | --- | --- | --- |
| T1 Deterministic | Pixel diff, layout invariants, accessibility, console, network | None | Yes |
| T2 Decided | Is it an anomaly, a bug or intended, worth an issue? | Decider | No |
| T3 Judged | Visual meaning and flow reasoning | Judge | No |

To check the determinism guarantee (three runs, one commit, zero diffs), run `bash scripts/determinism-check.sh` in a clone of this repo.

## More

- [Technical specification](spec/bughunters-technical-spec.md): the gate in full
- [The determinism contract](determinism-contract.md): what the gate guarantees, and how
- [The detection rubric](detection-rubric.md): each automatic check and what it finds

## Approved baseline objects in CI

`run` only verifies. It never creates missing baselines or accepts a changed runner
image. Restore both the reviewed manifest and `.bughunters/runs/baselines/` (pixels
and structural snapshots) from trusted storage before CI verification. Missing or
corrupted objects return exit 4. This repository does not yet ship remote baseline
storage commands. Run `baseline update` explicitly in a trusted environment,
review the manifest changes and images, then distribute those approved objects.

Approved baselines include content hashes for both pixels and structural snapshots.
Verification fails if either object is missing or changed. Older pixel-only
manifests require an explicit `baseline update`; missing geometry is never silently
treated as an opportunity to skip change-aware checks. Restore both object types
along with the reviewed manifest when moving baselines between machines.
