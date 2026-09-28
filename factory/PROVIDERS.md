# Factory provider connection hold

Provider authentication is deliberately not automated into source control.

Connect providers in the local OmniRoute dashboard. Factory will accept them only when:
- at least two distinct providers expose an eligible free coding model;
- `auto/coding:free` returns candidates with unrestricted fallback disabled;
- no paid billing path is required for the acceptance run.

After provider connection, use `FAILOVER-TEST.md`. Only after that test passes should live flags in `acceptance.json` be true.

RTK can then be applied with `FACTORY_GATEWAY_TOKEN` set **locally** and `factory/apply-rtk.ps1`. The token must never enter Git, chat, logs, or documentation.
