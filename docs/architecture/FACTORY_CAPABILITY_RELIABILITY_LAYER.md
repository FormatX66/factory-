# Factory Capability & Reliability Layer

Status: BUILD-READY PLAN  
Operation: `factory-capability-reliability-integration-20261002`  
Base / Last Known Good: `release/v3.8.51`  
Promotion: manual only; this plan does not authorize release-branch writes or production deployment.

## Goal

Make Factory more reliable at finishing work, discovering useful capabilities, recovering from interruption, using low-cost compute safely, and improving prompts/routing from evidence without rebuilding capabilities OmniRoute already has.

The design extends existing Factory assets rather than replacing them. Existing Promptfoo homologation, Langfuse, OpenTelemetry routing instrumentation, shadow routing, quota scheduling, session affinity, model/provider Radar, MCP server/tool registry, GitHub Models, and free-tier catalog remain the foundations.

## Core invariants

1. Preserve Last Known Good. New integrations begin on isolated branches and stay behind adapters/feature flags until independently verified.
2. No direct dependency on a free tier, notebook, UI scraper, or temporary signup credit for a critical path.
3. No credential, browser cookie, private key, recovery code, or token enters source control, logs, prompts, or handoff files.
4. Capability discovery is not capability trust. New providers/tools enter quarantine first.
5. A retry must change a real input, implementation, state, or hypothesis after failure.
6. A successful dispatch is not completion. Completion requires task-specific verification plus a durable receipt.
7. Provider terms and usage rules are admission inputs. Do not bypass rate limits, access controls, UI-only restrictions, or provider prohibitions.
8. Keep scheduled/recurring automation disabled unless separately authorized.
9. Prefer provider-supplied quota telemetry over static estimates whenever available.
10. External services must have a local/alternate recovery path before promotion where practical.

## Architecture

### 1. Execution Shield

Purpose: give build agents enough execution authority to finish bounded tasks without exposing the host or unrelated projects.

Primary candidate:
- NVIDIA OpenShell: evaluate as the primary policy/sandbox backend.

Secondary adapters:
- Daytona: disposable isolated workspaces.
- E2B: disposable overflow/test workspaces.

Interface requirements:
- workspace allowlist
- network allowlist
- read/write policy
- temporary credential injection without model visibility
- wall-clock and resource budget
- process/output capture
- immutable execution receipt
- cleanup result
- LKG pointer
- rollback/recovery action

Admission path:
`request -> policy compile -> sandbox -> task -> verification -> receipt -> promote/hold`

Failure path:
- sandbox failure: hold task, preserve workspace snapshot/receipt, fall back to another approved backend only when semantics are equivalent.
- policy mismatch: fail closed; do not widen permissions automatically.
- verification failure: quarantine candidate; LKG remains unchanged.

### 2. Durable Run Ledger

Purpose: make long-running Factory/Farmer/Future-Branch work resumable and idempotent.

Evaluate DBOS semantics first. Do not require DBOS as an architectural dependency unless the trial beats the existing persistence stack.

Required record:
- stable `operation_id`
- step id and version
- canonical input hash
- implementation/config hash
- started/completed timestamps
- action result hash
- verification result
- attempt count
- changed-input explanation for retry
- LKG reference
- recovery state
- external receipt references

Required behavior:
- completed idempotent steps are never silently replayed
- interrupted work resumes at the next safe step
- uncertain side effects move to HOLD rather than automatic replay
- retries require a materially changed input/state/hypothesis
- terminal success requires independent verification where practical

### 3. Capability Radar + Admission

Purpose: continuously discover useful tools without turning discovery into automatic trust.

Sources:
- Official MCP Registry
- GitHub repositories/releases/issues
- existing OmniRoute Radar/provider catalog
- model benchmark/discovery sites such as Arena/LMArena
- vendor documentation and changelogs

Arena/LMArena rule:
- use as a model/discovery/benchmark sensor only
- never treat the public chat UI as a production API or scrape it to manufacture free capacity
- a model discovered there must be located through an authorized provider/API before Factory can route to it

Admission pipeline:
`discover -> provenance -> terms review -> static scan -> MCP/tool poisoning scan -> sandbox smoke test -> permission diff -> Promptfoo regression -> approval manifest`

MCP security checks should cover:
- prompt/tool poisoning
- tool shadowing
- manifest/description drift
- dependency changes
- unexpected network/file permissions
- secret exfiltration paths

No capability reaches the approved catalog solely because it appears in a registry.

### 4. Independent Recovery Plane

Purpose: keep enough signed state outside the primary Factory runtime to recover Factory when Factory itself is unhealthy.

Preferred first trial:
- Cloudflare R2 for small signed state/receipts/manifests.
- Cloudflare Worker/AI Gateway only as an optional independent control/observation plane; do not insert another mandatory routing hop unless testing proves value.

Store only:
- active Factory revision
- approved capability manifest digest
- current LKG manifest
- outstanding operation ids/states
- verification receipts
- provider health snapshot
- recovery instructions
- artifact digests/locations

Never store secrets in recovery manifests.

Recovery must work when:
- local Factory process is down
- the primary database is unavailable
- one model/provider is exhausted
- a build candidate is corrupt
- a workflow died after an external side effect

### 5. Evidence Learning Loop

Use the tools Factory already has before adding new ones:
- Promptfoo = acceptance/regression authority
- shadow routing = compare candidates without promotion
- Langfuse + OpenTelemetry = trace/evidence source
- quota scheduler = live capacity constraint

Add DSPy/GEPA only as a candidate-generator layer:
`production trace/failure -> curated eval case -> candidate prompt/policy -> Promptfoo -> shadow run -> compare -> promote or discard`

Rules:
- optimization never edits LKG prompts directly
- prompts/routing policies are versioned artifacts
- candidate generation and candidate acceptance are separate authorities
- no LLM judge is the sole acceptance gate for deterministic behavior
- failures become reusable regression cases

Phoenix/OpenInference:
- optional comparison/benchmark only
- do not duplicate Langfuse/OTel unless a measured gap is demonstrated

### 6. Compute Lane Broker

Purpose: use inexpensive/free compute without making availability claims the system cannot guarantee.

Preferred lanes:
- GitHub Actions for repository CI/build/test jobs that fit GitHub's permitted use.
- Modal for burst compute, model tests, embeddings, GPU jobs, and benchmark sweeps when its current allowance/cost makes sense.
- Daytona/E2B for disposable execution sandboxes.

Opportunistic/non-critical lanes:
- Hugging Face ZeroGPU
- Kaggle notebooks
- Colab

Rules:
- opportunistic lanes never hold unique state
- every job is checkpointable or reproducible
- timeout/eviction is a normal failure mode
- provider-specific quotas are re-checked before scheduling
- billable spillover requires an explicit configured budget/hard stop

### 7. Model/Provider Capacity Improvements

Extend existing provider routing rather than creating another provider stack.

Priority behaviors:
- consume provider response-header quota/reset telemetry when exposed
- maintain hard-stop/terms provenance in provider metadata
- prefer zero-cost pools only when eligibility and hard-stop behavior are established
- use OpenRouter/Groq/Workers AI and similar providers through existing adapters and authorized APIs
- treat signup credits as temporary capacity, not recurring architecture
- keep Arena and other chat sites out of the production request path

Puter is explicitly excluded from reintegration because OmniRoute previously removed it at the provider owner's request.

### 8. Low-Cost State/Backup Options

Candidate stores for non-secret manifests, metrics, or redundant state:
- Cloudflare R2
- Turso
- Supabase
- Backblaze B2

Selection criteria:
- current free/low-cost allowance
- hard spend control
- API reliability
- export/restore simplicity
- no lock-in of the canonical state format
- terms compatible with the stored data

The canonical format must remain portable so a provider can be removed without redesign.

## Phased build

### Phase 0 — Contract and baseline
- capture current LKG digests and relevant test baselines
- define SandboxAdapter, DurableRunLedger, CapabilityCandidate, AdmissionReceipt and RecoveryManifest contracts
- map existing Factory components to those contracts
- add no new external dependency yet

Exit: contracts/tests exist and current behavior is unchanged.

### Phase 1 — Durable run ledger
- implement ledger adapter on existing persistence first
- add crash/resume/idempotency tests
- trial DBOS behind the same interface
- select by measured recovery behavior and maintenance cost

Exit: a killed multi-step synthetic task resumes without replaying completed side effects.

### Phase 2 — Execution Shield
- implement sandbox adapter
- trial OpenShell
- add Daytona/E2B adapters only if they add distinct recovery/capacity value
- add deny-by-default policy tests

Exit: sandboxed task can write only its workspace, cannot read injected secrets, and cannot reach blocked network targets.

### Phase 3 — Capability Radar admission
- connect Official MCP Registry discovery read-only
- reuse existing GitHub/Radar discovery
- add security/provenance/admission receipts
- require Promptfoo acceptance before approved-catalog promotion

Exit: a safe fixture promotes; poisoned/permission-expanding fixtures are quarantined.

### Phase 4 — Recovery plane
- create signed portable recovery manifest
- trial R2 copy
- verify restore with primary runtime/database intentionally unavailable in a test environment

Exit: a clean instance can reconstruct the approved/LKG state from the recovery manifest without secrets.

### Phase 5 — Learning loop
- build trace -> eval-case pipeline
- add DSPy/GEPA candidate generation behind an opt-in flag
- shadow candidates and require regression improvement with no protected-test regressions

Exit: one prompt/routing improvement is promoted from evidence, with rollback to exact prior artifact.

### Phase 6 — Compute broker
- expose GitHub Actions/Modal/sandbox workers through a capability interface
- schedule only reproducible/checkpointable jobs
- add budget/quota admission and hard-stop tests

Exit: synthetic work can fail over between approved lanes without losing canonical state.

## Acceptance gates

A lane is not considered integrated until:
- tests cover success, failure, recovery and hold paths
- permissions are no broader than the approved manifest
- a rollback path is exercised
- LKG is independently readable after the test
- no credentials are committed/logged
- a durable receipt identifies inputs, outputs, verification and selected candidate
- terms/usage notes are dated and linked to primary sources
- docs distinguish measured behavior from provider claims

## Hold / reject conditions

Hold:
- current terms unclear
- billing cannot be hard-stopped
- side effects are uncertain
- provider quota telemetry conflicts with catalog metadata
- sandbox cannot prove isolation
- failure cannot be resumed safely
- an integration duplicates existing functionality without measurable benefit

Reject:
- requires scraping a consumer chat UI as an unofficial API
- requires credential sharing/cookie replay contrary to provider terms
- weakens host protections to gain capacity
- bypasses provider limits/access controls
- silently enables recurring cost
- requires replacing working LKG before a candidate is validated

## Research snapshot carried into this build

Research date: 2026-10-02. Re-verify before activation.

High-priority candidates:
- OpenShell
- DBOS semantics
- Official MCP Registry + security scanning
- Cloudflare R2 recovery state
- DSPy/GEPA candidate generation
- Modal compute lane

Useful secondary candidates:
- Daytona
- E2B
- Cloudflare AI Gateway
- Turso / Supabase / Backblaze B2

Sensors/opportunistic resources:
- Arena/LMArena
- Hugging Face ZeroGPU
- Kaggle
- Colab

Already present in Factory and to be reused:
- Promptfoo
- Langfuse
- OpenTelemetry
- shadow routing
- session affinity
- quota scheduling
- GitHub Models
- MCP/tool registry
- provider/model Radar
- free-tier catalog

## Definition of done

Factory can accept a bounded objective, choose an approved execution lane, checkpoint every external side effect, resume after interruption, independently verify the result, retain LKG/rollback, and learn from the resulting evidence without depending on one model/provider/compute service or trusting a newly discovered capability by default.
