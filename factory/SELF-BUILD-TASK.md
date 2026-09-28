# Factory self-build task 001

Goal: improve Factory's provider bootstrap without changing upstream release history.

Work only on `factory/continuous-coding`. Preserve `release/v3.8.51` as LKG. Do not touch credentials, billing, schedules, or the port-20128 gateway.

## Task
Review `factory/`, the OVHcloud optional-auth consistency fix, and current provider-selection logic. Propose the smallest change that makes Factory discover and rank safe free coding providers from OmniRoute's own catalog rather than hard-coding a provider list.

## Required output
1. A short design note in `factory/SELF-BUILD-RESULT.md`.
2. If code is warranted, one bounded implementation plus focused tests.
3. Record observed evidence; do not mark live failover verified unless two distinct providers actually complete the continuity test.

## Acceptance
- No secrets in Git diff.
- `git diff --check` passes.
- Existing Factory verifier still passes.
- New focused tests pass.
- Upstream LKG commit remains unchanged.
- On failure, retain evidence and change the hypothesis/input before retrying.

This task is intentionally safe to hand to an external/free model because it contains no private project data or credentials.
