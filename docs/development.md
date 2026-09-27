# Development

This page is for work on Bughunters itself. To use Bughunters in your app, run `npx bughunters`. Refer to [Getting started](getting-started.md).

## Build and test

Node 22+ and pnpm 9+.

```bash
pnpm install
pnpm build
pnpm test
```

To run the CLI from your checkout:

```bash
node packages/cli/dist/bin.js --help
```

To build the npm package (one bundle in `packages/bughunters/dist/`):

```bash
pnpm --filter bughunters build
node packages/bughunters/dist/bin.js --version
```

To look at the dashboard with sample data:

```bash
node packages/dashboard/scripts/fixture.mjs /tmp/bughunters-fixture
cd /tmp/bughunters-fixture && node "$OLDPWD/packages/cli/dist/bin.js" dashboard
```

Refer to [CONTRIBUTING.md](../CONTRIBUTING.md) for the rules that the product depends on.

## Releases

A maintainer runs the **Release** workflow in GitHub Actions and selects `patch`, `minor`, or `major`. The workflow tests the repo, bumps `packages/bughunters/package.json`, publishes `bughunters` to npm with provenance, and pushes a tag and a GitHub release. The internal `@bughunters/*` packages are private. The bundle includes them.

## Examples

| Folder | What it shows |
| --- | --- |
| `examples/fixture-app` | A small web app for the deterministic gate, with defects you can switch on (`BREAK=...`) |
| `examples/electron-app` | An Electron app: a test user from the app's E2E harness, CDP, onboarding, the fixer, and GitHub |
| `examples/expo-app` | An Expo app on the iOS simulator: Metro, a deep-link sign-in, and Maestro |

## Packages

| Package | What it does |
| --- | --- |
| `bughunters` | The npm package: one bundle of the CLI and the dashboard UI |
| `@bughunters/cli` | The `bughunters` command |
| `@bughunters/core` | The data types, the config schema, file paths, fingerprints, and exit codes |
| `@bughunters/agents` | The explorer, judge, and fixer; the retest, publish, and memory steps; model and CLI runtimes; routines; the patrol; workspace files |
| `@bughunters/drivers` | One driver interface for web (Playwright), Electron (CDP), and iOS and Android (Maestro) |
| `@bughunters/decide` | The decider for the web gate: a general model, a local model, or the offline heuristic |
| `@bughunters/invariants` | The layout checks: contrast, overlap, clipped text, tap size, and more |
| `@bughunters/diff` | Pixel and perceptual comparison, masks, and tolerance rules |
| `@bughunters/capture` | The Playwright capture for the deterministic gate, with the determinism contract |
| `@bughunters/dashboard` | The local dashboard: its server and its UI |
| `@bughunters/triage` | Clustering and noise control for the gate's findings |
| `@bughunters/report` | Report formats for the gate: HTML, PR comment, JUnit, and SARIF |
| `@bughunters/recon` | App bring-up, crawl safety, and the change map for the gate (in progress) |
| `@bughunters/github-app` | A GitHub App for checks, issues, and slash commands (in progress) |

## Design documents

- [ADR 0005: agents, drivers, and the patrol](adr/0005-agents-drivers-and-the-patrol.md): the agent design
- [Architecture decisions](adr/): all ADRs
- [Technical specification](spec/bughunters-technical-spec.md): the deterministic gate
- [Competitive landscape](research/oss-visual-testing-landscape-2026.md): the research behind the design
