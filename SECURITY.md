# Security policy

Bughunters is a local automation tool that can read application data, invoke
models, execute configured commands and publish to GitHub. Run it with synthetic
data and least-privilege test accounts. Review project configuration before
executing it. See [execution and evidence boundaries](docs/configuration.md).

## Report a vulnerability privately

Use [GitHub private vulnerability reporting](https://github.com/agent-labs-dev/bughunters/security/advisories/new).
If GitHub says reporting is unavailable, open an issue asking the maintainers for
a private contact channel. Do not include exploit details, credentials or private
evidence in a public issue. Maintainers must enable **Settings → Code security →
Private vulnerability reporting** before the private form is available.

Include the affected commit/version, environment, impact, minimal reproduction,
and any proposed mitigation. Redact credentials and customer data. Please allow
maintainers to coordinate a fix before public disclosure. We do not promise a
response deadline or offer a bug bounty.

## Supported versions and boundaries

Security fixes target the latest published version and main. Older versions do
not have a separate backport guarantee. A clean CI run is evidence about tested
behavior, not a guarantee that no vulnerabilities exist.

- Worktrees isolate Git changes, not host access. Native CLI fixing requires
  explicit trusted-host execution; Docker workers share the host kernel.
- App setup and teardown are trusted operator commands. They are not sandboxed
  by the fixer setting. Use disposable hosts for untrusted repositories.
- Browser action/origin policy is defense in depth. Existing Electron/native
  processes require separate OS/network isolation.
- Masking is configured, not automatic PII detection. GitHub screenshot uploads
  are opt-in. Review evidence and repository visibility before enabling them.
- USD limits depend on provider-reported cost and can overshoot by one request.
  Use provider-side spending controls for a hard billing ceiling.

## Maintainer checks

Dependency audits (including development tools), full-history redacted secret
scans and CodeQL run in CI and weekly. Workflow actions are pinned to commits;
Dependabot proposes updates. Review findings rather than adding broad ignores.
Update Playwright packages, the matching digest-pinned runner image and browser
docs together; the version-consistency test enforces this. Rotate an exposed
credential immediately; deleting it from Git history does not revoke it.
