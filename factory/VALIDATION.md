# Bounded Factory source qualification

The draft now includes a concrete test executor for the existing workflow controller.
It copies only hash-pinned, reviewed source files into a per-job directory, runs the
current Node binary against registered test files without a shell, retains stdout,
stderr and process receipts, and verifies source integrity and exact TAP totals in
a separate readback. Failed, timed-out, modified, skipped and duplicate jobs cannot
be reported as passing. Environment credentials and NODE_OPTIONS are not inherited.

This is **not** a sandbox for malicious code, a coding-model write executor, a remote
shell, or a live deployment. Registered test code is trusted and reviewed. Host OS
isolation is still required for untrusted builds. Windows process-tree termination
and the complete supported Node24/Windows suite remain unqualified.

The supplied fixed entry point is an explicit foreground operator action:

    node scripts/cli/factory-qualify-candidate.mjs --run

Run it in an isolated copy with the exact source bytes described by the manifest.
Line-ending conversion or an edited source correctly causes a hash mismatch; do not
regenerate hashes merely to suppress a failure. It launches two test lanes through
`runAuthorizedBatch`, stores evidence under `evidence/qualification`, and never
calls a model, modifies a live service or creates a schedule. A repeated invocation
retains verified records instead of running them twice. Check-in estimates are
recorded at actual start, not dispatch acknowledgment.

Executed in this session: 49 existing Factory repair tests plus 19 new executor
tests passed on Linux / Node22.16.0, with 21 separate Python readback checks. The
two suite processes overlapped by 217 ms. These are source qualification results,
not Commander desktop parity or cloud-provider failover.

The separately requested Farmer validation objective was accepted, but GitHub run
36624137613 failed with runner_id 0 and no executed steps. It was not retried. No
runner/billing/schedule configuration was changed. Preserve that deployment hold.
