# Factory execution boundary

This candidate separates a model proposal from an executed and verified task.
It does not install a service, remove read-only sandboxing, or retry denied remote calls.

## Medic intake

`medic-bridge.mjs` accepts explicit `mode: "proposal"`, `"inspect"`, or `"build"`.
The existing adapters can return proposals and Codex can inspect in its unchanged
read-only sandbox. No build executor is registered in this bridge. Build requests
therefore return `held / build_executor_not_registered` before consuming model calls.
Legacy `needsTools: true` now requires an explicit mode; it does not imply write access.

`runMedicJob(job, {root, adapters})` persists acceptance before dispatch, then records
running, review, failure or hold. Exception text is not saved as failure evidence.
Job IDs are constrained, duplicate IDs cannot overwrite receipts or repeat a job,
and proposal responses always report `executionVerified: false`.

`checkinMinutes: [minimum, maximum]` records an estimated first check-in window.
The default is 5–10 minutes for proposals. This is not a completion promise and does
not create a notification, scheduled task, or background monitor.

The CLI `scripts/cli/medic-factory-job.mjs` uses this lifecycle and bounds stdin at
65,536 bytes. Evidence stays in the configured private local evidence directory.
The existing HTTP sidecar is unchanged; it still needs separate review and deployment.

## Execution-policy core

`workflow-controller.mjs` is a bounded foreground helper for the existing Factory
coordinator, not a second daemon. It invokes trusted host-provided execution and
verification functions for independent eligible jobs. It does not discover shell
commands, import code from jobs, install executors, dispatch network requests, or
change model permissions.

An exact operator grant binds job ID, normalized fingerprint, action kind, scope,
and expiry. A predicted preference is not a grant. A capable executor and a separate
verification function are required. Host adapters remain responsible for enforcing
the actual OS sandbox and checking real artifacts; different identity strings alone
are not proof of independence or cryptographic authentication.

Acceptance is persisted before execution. Failed jobs do not stop independent jobs;
dependants wait for verified success. Completed jobs are not rerun. Interrupted jobs
are held for reconciliation. Check-in windows start when the executor actually starts.
A timeout aborts the supplied signal but does not claim the underlying work stopped.
Its ownership lock stays in place until the operator reconciles the possibly active
attempt. Never delete a lock merely because its timestamp looks old.

State roots must be private directories owned by the trusted coordinator. These JSON
receipts are not a tamper-resistant signed ledger, and no automatic promotion occurs.
No automatic retry, recurring schedule or general laptop execution is introduced.

## Tests and limits

Run the focused candidate suites with Node:

    node --test tests/unit/factory-admission-regression.test.mjs tests/unit/factory-medic-bridge.test.mjs tests/unit/factory-medic-lifecycle.test.mjs tests/unit/factory-workflow-controller.test.mjs

Tests include real child-process artifact creation in temporary directories and a
separate file/hash readback, parallel overlap, lane failure isolation, dependency
holds, receipt correlation, permission refusal, timeout handling and durable intake.
Other adapter tests use explicit fixtures; no provider capacity is implied.

The candidate was checked in an isolated Linux environment with Node 22.16.0.
Full supported Node 24, Windows, live bridge, live cloud failover and Commander parity
remain separate gates. Existing Commander source is Chat-to-Git-Pipeline PR 62;
do not start a duplicate Commander repository or retire Desktop Commander yet.
