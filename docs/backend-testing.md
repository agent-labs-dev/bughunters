# Testing backend behavior through a web app

Bugpatrol's web driver can test backend behavior exposed by a frontend: sending
a message, saving settings, switching tenants, or reopening persisted content.
There is currently no API-only platform or HTTP request tool. Keep direct API
contract, authorization, and background-worker tests alongside the patrol.

## Run a disposable stack

Put Bugpatrol's config in the repository whose code you intend to investigate.
Use `app.setup` to prepare an isolated database and cache, migrate them, start
the backend and frontend, and create a disposable account. Point the frontend
at that backend explicitly; a local frontend using a production API is not an
isolated test.

Setup commands can capture dynamic URLs and a short-lived login session:

```yaml
app:
  platform: web
  source: .
  setup:
    - run: ./scripts/prepare-patrol-stack
      capture:
        WEB_URL: 'WEB_URL=(http://[^\s]+)'
    - run: ./scripts/start-patrol-api
      background: true
      readyWhen: 'API ready'
    - run: ./scripts/start-patrol-web
      background: true
      readyWhen: 'Web ready'
    - run: ./scripts/seed-patrol-user
      capture:
        SESSION_TOKEN: 'SESSION_TOKEN=([^\s]+)'
  connect:
    url: '${WEB_URL}'
  instructions: .bugpatrol/instructions.md
```

These commands are application-owned examples, not built-in commands. Supply
the rest of the configuration from `bugpatrol init`; see [configuration](configuration.md).
Describe your development-only session handoff in `instructions.md`, using
`{{SESSION_TOKEN}}` where needed. Never give the explorer backend service keys.
Captured variables are redacted from setup reporting, but browser state and
screenshots remain sensitive. Keep run artifacts private and ignored.

Start with the fixer and GitHub agent disabled and `agents.patrol.pull: false`
while investigating a feature checkout. Run a short `explore`, inspect its
coverage, then a longer `explore` and `judge`. A successful greeting is evidence
for that flow; it does not establish tenant isolation or worker reliability.

## Give the explorer observable consequences

Seed two tenants with distinguishable content. Ask the explorer to switch
between them, create content, reopen it, reload, cancel a running operation,
and verify settings persist. Define prohibited actions such as payments,
external messages, real integrations, and production device provisioning.

The web driver reports failed fetch/XHR/document requests and console errors.
Use those to investigate, then confirm the user-visible consequence and trace
the failure in backend logs. A cancelled stream during navigation alone is not
proof of broken persistence. Supply a separate backend trace or direct API
reproduction when the UI cannot distinguish the suspected failure.

Background setup processes stop when the session ends. Explicitly tear down
datastores and remove development identity-provider users using your own
lifecycle tooling; process shutdown does not delete those resources.

## Visible native sessions

The supported drivers are web, Electron, iOS, and Android. Native desktop Cua
and a view-only isolated display are not currently built-in drivers. If adding
one, separate display streaming from input delivery: let the user observe,
and require explicit takeover before allowing their input to affect the run.
Record takeover in the trace so replay does not attribute user actions to the
agent. A visible window by itself does not establish input isolation.
