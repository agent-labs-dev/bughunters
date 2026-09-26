# GitHub

Bughunters can publish its results to your GitHub repo:

- A **pull request** for each fix that the fixer wrote.
- A **GitHub issue** for each bug at `issueMinSeverity` or worse that has no fix.

It uses the [`gh`](https://cli.github.com) CLI, with your own login. GitHub is off until you turn it on.

## 1. Check gh

```bash
gh auth status
```

The account must be able to push branches, and open PRs and issues, in the repo. The default `gh auth login` scopes (`repo`) are enough.

`bughunters doctor` also checks gh when GitHub is on.

## 2. Turn it on

```yaml
agents:
  github:
    enabled: true
    pullRequests: draft          # draft | ready
    issueMinSeverity: major      # a bug with no fix becomes an issue at this severity or worse
```

All the settings:

| Setting | Default | What it does |
| --- | --- | --- |
| `enabled` | `false` | Turns publish and sync on |
| `repo` | the repo of `app.source` | The repo, as `owner/name` |
| `pullRequests` | `draft` | Open PRs as drafts, or as ready for review |
| `issueMinSeverity` | `major` | The lowest severity that becomes a GitHub issue |
| `labels` | `[bughunters]` | The labels on each PR and issue. The first label also finds them again for sync |
| `assetsBranch` | `bughunters-assets` | The branch that holds the report images |
| `prScope` | from `fixer.commitMessage` | The scope in PR titles, for example `app` in `fix(app): ...` |

For PRs, also turn on the fixer. Refer to [Getting started](getting-started.md#6-let-it-fix-bugs).

## 3. Look at the reports first

```bash
npx bughunters publish --dry-run
```

The judge writes each report to `.bughunters/runs/publish/<issue>.md`. Nothing goes to GitHub. The command lists each draft:

```text
  issue draft iss_a366e07f8376  .bughunters/runs/publish/iss_a366e07f8376.md
  PR draft    iss_c72d694ed42f  .bughunters/runs/publish/iss_c72d694ed42f.md
Wrote 1 PR(s) and 1 issue(s); skipped 0.
```

## 4. Publish

```bash
npx bughunters publish                 # all the items that are ready
npx bughunters publish --issue <id>    # one item
```

The command lists each URL:

```text
  issue       iss_a366e07f8376  https://github.com/acme/app/issues/2156
  PR          iss_c72d694ed42f  https://github.com/acme/app/pull/2157
Opened 1 PR(s) and 1 issue(s); skipped 0.
```

`patrol` runs the same step at the end of each cycle.

### What Bughunters publishes

| Item | When |
| --- | --- |
| A PR | The issue has a fix (verified or proposed) with no PR yet |
| A GitHub issue | The issue is at `issueMinSeverity` or worse, has no fix (or its fix failed), and has no GitHub issue yet |
| Nothing | A dismissed issue, a fixed issue, or an issue whose PR the team closed |

The judge reads each item before it publishes it. It can skip an item that is clearly not a product bug, and it gives the reason.

### What Bughunters changes in the repo

- It makes the labels in `labels`, if they do not exist.
- It pushes the orphan branch `bughunters-assets`, with the screenshots of each report. The images never enter a PR diff. Do not merge this branch.
- For each PR, it commits the fix on `bughunters/fix-<issue>`, and it pushes that branch. The commit runs your hooks. Bughunters never uses `--no-verify`, and it never force-pushes.

### What a report contains

- A short summary by the judge.
- What happened, what was expected, and the steps.
- The screenshots.
- For a PR: the cause, the change, the diff stat, and the retest: before and after screenshots, with the judge's verdict (✅ fixed, ❌ not fixed, or ❔ unclear).
- The severity, and how many times Bughunters saw the bug.

Review each PR as you review a PR from a person. A retest verdict of ❔ unclear means that the explorer could not reach the screen in the retest.

## 5. Sync the state back

```bash
npx bughunters github sync
```

Bughunters reads each PR and issue that has the first label, and it updates its own issues:

| On GitHub | In Bughunters |
| --- | --- |
| The PR is merged | The fix shows the PR as merged |
| The PR is closed with no merge | The fix is rejected. The judge and the fixer get a lesson, so they do not propose that change again |
| The issue is closed as completed | The issue is `fixed` |
| The issue is closed as not planned | The issue is `dismissed`, and the finding does not come back |
| The issue is opened again | The issue is `filed` again |

`publish` runs a sync after it publishes. While the dashboard runs, it syncs every 5 minutes. The Issues page shows the PR or issue number and its state. `bughunters issue list` shows the numbers too.

## Troubleshooting

| Message | Action |
| --- | --- |
| `GitHub is off` | Set `agents.github.enabled: true`, or use `publish --dry-run` |
| `the gh CLI is not installed` | Install it from https://cli.github.com |
| `gh is not logged in` | Run `gh auth login` |
| `Nothing to publish` | No item matches the table in [What Bughunters publishes](#what-bughunters-publishes). Run `bughunters issue list`, and check the severities and the fixes |
| The commit hook rejected a commit | The fixer gets a lesson with the hook error. Fix the hook error in the worktree, or run `bughunters fix --issue <id>` again |
| The images do not show | The repo is private, and the reader is not signed in to GitHub, or has no access |
