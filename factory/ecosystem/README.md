# Aurum ecosystem acceptance candidate

One bounded entry point over existing components, not a replacement operating system,
new model router, new perpetual agent, or new repository.

## Ownership

| Existing component | Retained responsibility |
| --- | --- |
| Future Branch | Policy admission, stable failure fingerprints, model-only exploration |
| Medic Hub / existing Medic-Factory bridge | Authenticated intake and worker handoff |
| Factory | Existing classification-aware proposal worker and durable receipts |
| Commander | Existing authorized execution substrate; not promoted from health alone |
| New additive entry point | Common contract, explicit scoped grant, operation correlation, receipt verification and status |

The resident explorer is not replaced, reconfigured or stopped. The pinned Future
Branch modules in `vendor` are reused for this candidate's own ingress journal;
they are not a second resident explorer or a second background coordinator.
`source-provenance.json` binds them to their original repository bytes.

## Current activation boundary

**LIVE DISPATCH IS HELD.** The platform rejected a live authenticated Medic dispatch
on September 30, 2026. This candidate does not replay it, recover its credentials,
try another executor, or provide a live-submit CLI switch. Only read-only status
and job validation are available from the CLI. No services, startup tasks, provider
accounts, billing, credentials, direct-connection holds or existing source files
are changed by this candidate.

The exercised integration is:

`explicit synthetic fixture grant -> actual Future Branch gate -> actual existing
Factory Medic adapter -> injected synthetic text worker -> original Factory
receipt writer -> separate receipt readback -> proposal_verified`

`proposal_verified` means matching delivery of a synthetic proposal. It is NOT
validation of model advice, completion of a production build, or permission to
execute that advice. No real model/provider call occurs in the qualification.
The actual HTTP Medic bridge, real worker availability, Commander writes,
provider failover, interrupted production-job recovery, physical reboot and
unattended system operation remain unqualified by this candidate.

## Commands (from the existing Factory repository)

```text
python factory/ecosystem/aurum.py status
python factory/ecosystem/aurum.py plan factory/ecosystem/synthetic-job.json
python -m unittest discover -s factory/ecosystem -p test_ecosystem.py -v
```

Python and Node must already be installed. There are no new package installs.
Status uses bounded GET requests to fixed loopback endpoints. A 401 is shown as
`authentication_required`, not a broken service. A successful health response is
never represented as working execution. Unknown health schemas stay unverified.
No automatic discovery scan, token access, HTTP redirects or POST is performed.
No live-submit action is exposed.

## Reliability boundaries

The operation ID binds to its semantic input. Changing the goal under an existing
ID is a conflict. Repeating a completed proposal requires a fresh receipt read and
an unchanged recorded proof. A missing, changed or mismatched receipt stays held.
A submission exception is `outcome_uncertain`, not proof nothing happened.
The existing Future Branch gate prevents a new operation ID from retrying unchanged
failed semantics. Unknown outcomes require review; automatic crash-resume is not
implemented. An unrelated synthetic job can still finish.

Jobs cannot provide commands, callbacks, arbitrary endpoints, authorization flags,
recovery flags or credentials. Grants originate outside the job and bind to its
full normalized contract. The exercised capability is synthetic, text-only.
The callable fixture adapter is trusted application code, not a security boundary
against someone who can arbitrarily modify/run local Python.

Coordination databases contain input and output digests rather than raw goals or
model output. The original Factory receipt writer retains its original behavior.
Receipt matching is consistency verification, not cryptographic authentication or
independent human review.

## Preservation and rollback

Base Factory commit: `eb144c7b9145f7b6e883c796ebec9272711461de`.
All candidate source additions live under `factory/ecosystem/`.
No changes are made to the original bridge or any worker implementation.
The live Medic checkout already contains unrelated changes and is not edited.
The held PR14 recovery/dashboard/provider-repair work is not imported or retried.

Stop invoking the candidate to roll back; the live installation never depends on
it. Keep qualification receipts with the operation record. Do not delete or stop
existing services or the resident explorer as cleanup.

## Remaining acceptance, after legitimate execution clearance

Read the existing denial/handoff record before attempting live work. Qualify the
existing authenticated Medic route, its exact worker, and independently read its
result. Restore Medic main only through its existing supported startup path and
a fresh explicit action scope, preserving dirty source. Any continuous integration
or new startup wiring is a separate promotion decision, not enabled by this PR.
