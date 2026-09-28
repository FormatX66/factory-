# Factory continuous-coding overlay

This branch keeps OmniRoute upstream history intact and adds a small operating layer for our coding factory.

## Invariants
- `release/v3.8.51` is upstream/LKG; development happens on `factory/continuous-coding`.
- Gateway is loopback-only at `http://127.0.0.1:20128`; Claude base URL has no `/v1` suffix.
- Coding route is `auto/coding:free` and `OMNIROUTE_AUTO_FREE_FALLBACK_TO_FULL_POOL=false`.
- No paid provider key, billing change, scheduler, or background sync is created by bootstrap.
- RTK is staged for a 20,000-token trigger only after live routing passes; Ultra stays off.
- A green dashboard is not acceptance. Two distinct providers must continue one synthetic coding task across a forced provider outage.

## Commands
Run `powershell -ExecutionPolicy Bypass -File factory/bootstrap.ps1` to create/update the isolated Claude profile and validate the local gateway. It does not log in to providers.
Run `powershell -ExecutionPolicy Bypass -File factory/verify.ps1` for offline/static acceptance plus gateway health when available.

Live failover remains intentionally held until two usable free providers are connected through OmniRoute's normal authenticated dashboard flow.
