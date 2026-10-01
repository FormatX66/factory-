# Aurum Connectivity Candidate

Goal: make an Aurum node reachable without repeated SSID/password entry while preserving a recovery path when normal networking fails.

## Contract
1. Normal path uses a persistent saved network profile.
2. Credentials are device-local configuration, never a universal secret baked into a public image.
3. Normal healthy connectivity wins.
4. If a saved profile exists, it gets one bounded attempt before fallback.
5. Recovery mode is private and requires a previously paired controller.
6. If the radio/driver is unavailable, software Wi-Fi fallback cannot claim recovery; hold for an independent transport/controller.
7. Recovery access does not imply internet access or execution authority.
8. This candidate performs no network mutation; it is a portable decision core for later hardware adapters.

## Adapter boundary
Hardware/platform adapters may implement observation plus: try_saved_profile_once, start_private_recovery, stop_private_recovery. Each adapter requires separate qualification.
