# Rivet Handoff — Factory Capability & Reliability Integration

Date: 2026-10-02  
Operation ID: `factory-capability-reliability-integration-20261002`  
Repository: `FormatX66/factory-`  
Base LKG: `release/v3.8.51`  
Working branch: `feat/factory-capability-reliability-layer-20261002`

## Objective

Take the Oct. 2 capability/free-compute/reliability research and turn it into a staged Factory build without duplicating features already present and without disturbing Last Known Good.

Canonical plan:
- `docs/architecture/FACTORY_CAPABILITY_RELIABILITY_LAYER.md`
- `docs/ops/factory-capability-reliability.build.json`

## Start here

Do not rebuild:
- Promptfoo
- Langfuse
- OpenTelemetry
- shadow routing
- quota scheduling
- session affinity
- GitHub Models
- MCP/tool registry
- provider/model Radar
- free-tier catalog

Build in this order:
1. Durable Run Ledger contract + existing-persistence implementation.
2. Execution Shield contract + OpenShell bounded trial.
3. MCP Capability Radar admission/security pipeline.
4. Signed portable recovery manifest + R2 trial.
5. Evidence learning loop using existing Promptfoo/shadow traces, with DSPy/GEPA only generating candidates.
6. Compute lane broker for approved reproducible jobs; GitHub Actions/Modal first.

## Decisions already made

- New work stays isolated from `release/v3.8.51` until verified.
- OpenShell is the first sandbox candidate, not a permanent dependency yet.
- DBOS is a semantics/implementation candidate behind an interface, not an unconditional rewrite.
- Arena/LMArena is a discovery sensor only; do not scrape its public UI as a free production API.
- Phoenix/OpenInference is optional; only add it if testing demonstrates a real gap beyond Langfuse + OTel.
- Puter remains excluded because OmniRoute previously removed it at the provider owner's request.
- Notebook/shared-GPU/free tiers are opportunistic lanes only.
- No provider activation, billing change, recurring schedule, or production deployment is authorized by this handoff.

## Required evidence

For every phase, return:
- selected candidate and alternatives rejected
- actual changed files/commit
- tests run
- success/failure/recovery/hold-path results
- permission diff
- external side-effect receipts
- LKG and rollback verification
- remaining blockers
- next bounded action

A successful build/test job alone is not enough to claim completion.

## Recovery

If a candidate fails:
- preserve its logs/receipt
- keep it quarantined
- do not retry unchanged
- record the changed hypothesis/input/implementation before another attempt
- leave the release branch and previous approved artifact untouched

## Delivery note

This file is the durable Rivet handoff because no direct Rivet connector/end-point is exposed in the current ChatGPT tool set. GitHub receipt proves the handoff was written, not that Rivet has consumed or completed it.
