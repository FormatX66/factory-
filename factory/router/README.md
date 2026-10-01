# Router-only durable credential enrollment

Operation: aurum-router-adapter-v1. Existing router work continues here.

Run `python factory/router/router_credentials.py enroll` on Bruce's laptop.
Enter the router administrator password locally, confirm it, and approve retention.
The program uses Windows Credential Manager, CRED_TYPE_GENERIC, Persist=2.
The credential is retained for the same Windows user on this computer, not roaming.
Generic credentials may be retrieved by other processes running as that user.
No credential is placed in this repository, a command argument, or application log.
Plaintext necessarily exists transiently in local process memory during use.

The UI never overwrites an existing primary credential. It performs no network call.
After saving, a separate process verifies retrieval via a one-use HMAC challenge.
Only match/persistence booleans return; neither the password nor challenge is logged.
Nonsecret enrollment status lives under the user's .aurum/router-access directory.

`status` prints metadata only. `self-test` creates a synthetic test entry,
checks write/read, persistence mode, separate-process retrieval, wrong-input rejection,
overwrite prevention and cleanup. It neither reads nor modifies the router password.
There is no command-line password-export action.

This is NOT verified router authentication, session renewal or off-site management.
The approved WAN HTTPS route from the user's photo remains part of the project.
Its identity, reachability and authenticated read still need separate acceptance.
A laptop-hosted connector still requires this laptop to be powered and reachable.
Rollback: close the setup window; the existing router and services are unchanged.
An enrolled credential can be removed through Windows Credential Manager at target
`Aurum:Router:TPLink-AXE75v1:administrator`; do not delete unrelated entries.
