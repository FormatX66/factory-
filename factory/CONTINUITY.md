# Factory continuity integration checkpoint

This candidate extends the existing Commander acceptance branch, not a new coordinator.
The protected installed Commander runtime remains pinned to `6cdfee8a3a`.

## Implemented and exercised on Windows / Node 24.21.0
The shared `scripts/ops/Invoke-AurumCommand.ps1` reads the existing current-user
Commander installation configuration. It never copies or regenerates the token,
follows redirects, contacts a non-loopback host, or retries a command automatically.
The four `scripts/ops/dogfood-*.ps1` launchers use this client. Existing root-level
launchers on the laptop are compatibility wrappers; their original bytes are backed up.
Six client regression tests passed. The installed test and summary launchers also ran.

`factory/workflow-controller.mjs` and `factory/validation-executor.mjs` are reused
unchanged from Factory PR10 commit `9142cfd060ada159ef897801ca2b433dffe78941`.
`node scripts/ops/factory-continuity-check.mjs --run` runs two bounded reviewed-source
test lanes, not a coding agent: dashboard data (10 tests) and the existing health CLI
(4 tests). Both passed through Commander with overlapping execution intervals.
Replaying the same completed jobs did not relaunch them. Recipe hashes are retained;
source drift holds the job rather than regenerating hashes to suppress a failure.
A separate Python process passed 29 artifact, receipt, source and preservation checks.

## Dashboard integration: staged, NOT deployed
`factory/dashboard-feed.mjs` supplies a read-only, loopback-only evidence projection.
The feed distinguishes stale evidence, held jobs, unverified success and matched
execution/verifier receipts. Matching records are not cryptographic authentication.
Goals, paths, arbitrary error messages and credential fields are not exported.
HTTP tests checked loopback binding, read-only methods, Host/Origin restrictions,
fixed routes and evidence parsing. They did NOT render the UI in a browser.

The existing Lissy93 Dashy configuration, schema and license come from Factory
commit `f067dec9954b214fb1104ed605559bd459151d26`. The derived configuration is
`factory/components/lissy93/dashy/factory-continuity.yml`. It preserves existing
links and security settings and passed pinned-schema validation including formats.
It reserves loopback port 19471 for a future iframe feed. No listener was installed.
`web/factory-feed/index.html` is only a staged shell: its browser script installation
was rejected by the execution tool, so this is NOT a working visual dashboard.
The Docker Linux engine is unavailable; full Dashy deployment remains held.

## Explicit remaining holds
The requested interrupted-job resume module was blocked by tool safety review and
was not installed or routed through another execution tool. Existing interrupted
attempts therefore remain held for reconciliation. No crash/resume, reboot, browser,
full-application or continuous autonomous-coding acceptance is claimed here.
The unchanged PR10 baseline produced 67/68 passing tests on Windows: its file-symlink
fixture failed to create a symlink with EPERM before the rejection assertion ran.
That missing coverage remains visible; no assertion was removed or called passing.

Local evidence and original launcher backups are in `C:\Users\bruce\FactoryContinuityEvidence`.
