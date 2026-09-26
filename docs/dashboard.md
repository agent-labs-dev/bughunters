# The dashboard

```bash
npx bughunters dashboard            # http://127.0.0.1:4311
npx bughunters dashboard --port 5000
```

The dashboard is the bird's-eye view of the agents. It reads the files under `.bughunters/runs/` and updates live. You can keep it open while a patrol runs.

## Pages

- **Overview**: what each agent does now and what it spent, the issues that need a human, the live screen, and the screens found so far.
- **Issues**: each issue with its screenshots and steps, the judge's reason, the fix with its diff, the retest with before and after screenshots, and the PR or issue on GitHub with its state.
- **Activity**: each session as a timeline, one line for each action.
- **Screens**: a graph shows how screens connect. Switch to the grid to see each latest screenshot.
- **Memory**: the lessons that the agents learned.
- **Checks**: the results of `bughunters run` (shown only when there are runs).

The dashboard listens on 127.0.0.1 only, because the screenshots can show real data. It is read-only.

## The files behind it

The dashboard shows the files that the agents write. You can also read them directly:

| Path | What it holds |
| --- | --- |
| `.bughunters/runs/issues/<id>.json` | One issue: title, severity, status, the judge's report and reason, and the evidence |
| `.bughunters/runs/fixes/<id>.json` | One fix: branch, diff, retests, and PR |
| `.bughunters/runs/sessions/<id>/` | One explorer session: its actions and screenshots |
| `.bughunters/runs/appmap.json` | The screens and how they connect |
| `.bughunters/runs/routines/` | The learned routines |
| `.bughunters/runs/memory.json` | The lessons |
| `.bughunters/runs/agents.json` | What each agent does now |
| `.bughunters/runs/publish/` | The reports from `publish --dry-run` |
