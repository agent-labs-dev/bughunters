# .bughunters/

These files are **committed** and reviewable in the pull request:

| File | What it is |
| ---- | ---------- |
| `bughunters.yml` | The config |
| `instructions.md` | The app guide for the explorer |
| `appmodel.json` | The AppModel — screens, flows, edges, and the inverse file→screen map |
| `baselines.manifest.json` | Baseline hashes plus the image digest they were captured in. **Not the pixels.** |
| `intents.json` | The Intent Ledger — every human decision about what is deliberate |

`runs/` is gitignored local output: sessions, issues, fixes, worktrees, memory, gate runs, and the local pixel store.

Screenshots and videos live in content-addressed object storage. The manifest is small, diffs cleanly, and makes a baseline change reviewable in the PR — which is the property teams actually want from committed images, without the clone cost. See [ADR 0004](../docs/adr/0004-baselines-in-git-pixels-in-object-storage.md).

A baseline is keyed by `hash(content) + imageDigest`, so an image change automatically invalidates baselines and forces a re-capture rather than producing a diff storm nobody can explain.
