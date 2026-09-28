# Synthetic failover acceptance

1. Connect at least two **distinct** free providers using OmniRoute's normal dashboard/auth flow.
2. Confirm `auto/coding:free` lists eligible candidates. Do not enable unrestricted fallback.
3. Start a disposable coding task containing a nonce, two requirements, and one file edit.
4. Record the serving provider and output. Never use private project data for this test.
5. Make only that provider unavailable through its normal connection control; do not corrupt credentials.
6. Continue the same Claude Code session. A different provider must preserve the nonce, requirements, and prior edit.
7. Restore the first provider and confirm the project state is unchanged.
8. Save provider IDs, timestamps, request IDs, file hashes, and pass/fail to `factory/acceptance.json` before setting either live flag true.

Model fallback within one provider is not provider failover. A dashboard health result alone is not a pass.
