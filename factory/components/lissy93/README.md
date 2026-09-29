# Selected Lissy93 components

A small, pinned reuse kit for Factory and diagnostic work. It does not replace
Aurum, Medic, GameGPT, the existing monitor, or the provider coordinator.

## Available now

The IPv4 adapter reuses Alicia Sykes' Networking Toolbox calculation and format
modules. Upstream files are byte-identical and retain the MIT license. Only the
adapter is ours. It validates canonical IPv4 and prefixes with the existing Zod
dependency before calling upstream functions. Calculations are offline: no scans,
DNS requests, sockets, provider calls, services, or scheduled jobs are created.

From the repository root, with Node 24 and the existing repository dependencies:

```console
node scripts/ops/lissy93-network.mjs subnet 192.168.1.42/24
node scripts/ops/lissy93-network.mjs contains 192.168.1.50 192.168.1.0/24
node scripts/ops/lissy93-network.mjs formats 192.168.1.42
node scripts/ops/lissy93-network.mjs from-decimal 3232235818
node --test tests/unit/lissy93-toolkit.test.mjs
python tests/integration/lissy93-oracle.py
```

This is a diagnostic utility, not a network authorization or firewall policy
engine. Subnet bounds alone never establish that a host is safe to contact.
IPv6 is deliberately not included. No address range is enumerated into memory.

## Important compatibility guard

The pinned upstream calculation module shifts a JavaScript 32-bit mask by 32 for
prefix /0. The resulting network and membership answers can be wrong. A direct
reproduction returned 192.168.1.42 as the network of 192.168.1.42/0 and rejected
membership in another /0 subnet. The adapter normalizes the /0 calculation and
handles membership explicitly. Regression tests cover this boundary, /31, /32,
invalid prefixes, invalid addresses, integer bounds, and the CLI error contract.
The upstream files are not silently patched or represented as our own work.

## Staged, not running

`dashy/conf.yml` is a JSON-form YAML configuration for Dashy, validated against
its pinned upstream schema. It links the existing local monitor, source gateway,
original gateway, and Medic. Links are not health assertions. Status polling,
configuration editing, external favicon providers, and error reporting are
turned off in the supplied configuration. These settings are not a substitute
for server-side authentication or a host firewall.

Dashy itself is NOT installed, built, or started by this kit. The Docker Linux
engine was unavailable during intake and the laptop reported memory pressure.
No Docker engine, image pull, public listener, restart policy, or new scheduler
was enabled. A future deployment must use a reviewed image digest, bind only to
127.0.0.1, mount config read-only, and verify runtime behavior before acceptance.
The loopback links work on the host, not directly from a phone or another device.

`portainer.reference.json` preserves just the upstream Dashy container recipe
with source provenance. It is reference material, NOT an import-ready safe
policy: the original recipe uses a floating image tag and a non-loopback port
mapping. It has not been imported into Portainer or deployed.

Web-Check's DNS, response-header, and certificate handlers are preserved as
`.js.txt` reference snapshots with their license. They depend on upstream
middleware, target parsing, and HTTP helpers; these snapshots are not standalone
runnable modules. They are not loaded into Medic. Any later integration needs
bounded requests, explicit authorized targets, redirect/SSRF review, and tests.
Certificate inspection's `rejectUnauthorized: false` is an inspection technique,
not a transport policy to copy into credential-bearing HTTP clients.

## Provenance and rollback

`provenance.json` records exact upstream commits, original paths, Git blob IDs,
and SHA-256 digests. Every vendored file includes its original repository license.
The original Portainer catalogue digest is recorded separately because the
reference JSON is a curated derivative, not a byte-identical full catalogue.

This kit is additive on an isolated feature branch. The shared Factory checkout,
release branch, current gateway processes, authentication, schedules, and resident
Future Branch explorer are left untouched. There is no runtime rollback to run:
stop using this branch to undo adoption. Do not delete another agent's worktree,
stop existing services, or reset a shared checkout to remove this kit.
