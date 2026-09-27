# Supported capabilities

This describes the current implementation, not the future architecture in the
research/specification documents.

| Area | Available now | Validation and limits |
| --- | --- | --- |
| Web | Agent exploration/replay; deterministic screenshots, layout checks and explicit baseline approval | Real Chromium tests and repeated-run determinism CI |
| Electron | CDP driver, windows, observation and actions | Adapter tests; no complete packaged-app E2E matrix. Existing app networking needs separate isolation |
| iOS / Android | Maestro-backed exploration/replay and screenshots | Transport tests use fixtures. Bring your own supported simulator/emulator, installed app and Maestro; physical device coverage is not guaranteed |
| Other desktop apps | No native Windows/Linux/macOS accessibility driver | Planned |
| APIs | No OpenAPI import, contract runner or dedicated API adapter | Planned; browser-observed requests are not API coverage |
| Fixing | Worktree proposals; model commands in Docker; explicit trusted-host CLI execution | Docker isolation tested in Linux CI. Native app retesting requires trusted-host; isolated proposals remain drafts |
| Evidence | Local reports, masking, hashes, preview-first retention | Selectors on web/Electron, rectangles on mobile. No automatic PII detection or managed artifact service |
| GitHub | Opt-in issue/PR publishing, state sync and CI repair | CLI-based integration with mocked GitHub tests; no production GitHub App service is shipped |
| Baselines | Local pixels and structural objects with reviewed manifest hashes | Remote baseline upload/download and approval UI are not implemented |

`recon`, `model`, `findings`, `intent`, `report`, `export` and `watch` are reserved
CLI commands and return a usage error. The corresponding library pieces and design
documents do not make those command flows available. `baseline update` and
`artifacts prune` are implemented.

Host support is Linux and macOS with Node 22.13+ (CI covers maintained Node 22 and
24). Windows host process execution is not supported. Browser installation and
application prerequisites are separate from installing the npm package.
`doctor` checks executable/configuration prerequisites; it does not certify font
rendering, app reachability, device coverage or production safety. Font/layout
validation happens during capture. See [configuration](configuration.md) for
trust boundaries and migration details.
