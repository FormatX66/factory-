# Factory provider-pool research — 2026-09-29

This lane is intentionally cloud/source-only while the laptop is reserved for NMS/Medic/GameGPT.

## Adopted patterns

The strongest independent gateways converge on the same ideas already present in OmniRoute: capability-first filtering, quota/headroom tracking, narrow cooldown scopes, health-aware fallback, and one OpenAI-compatible entry point. Factory should reuse OmniRoute instead of embedding another gateway.

Useful independent references reviewed: TheGP/ai-gateway (proactive RPM/RPD/TPM/TPD checks and no silent capability downgrade), sass-maker/free-ai (health/headroom/capability routing and Cloudflare-hosted control plane), kaiser-data/free-llm-proxy-router (non-blocking 429 cooldown), and community reports around pooled free tiers. These are architectural references, not trusted quota authorities.

## Corrections

GitHub Models is retired as of 2026-07-30 and is removed from the target pool. Cerebras is not counted as recurring free capacity because OmniRoute's 2026-09-03 re-audit classifies the prior no-card allowance as a one-time credit requiring a payment method. SambaNova is likewise treated as signup credit rather than steady free capacity.

Official sources remain authoritative for mutable limits. Cloudflare documents 10,000 free Workers AI neurons/day resetting 00:00 UTC. OpenRouter's current free plan lists 25+ free models and 50 requests/day. Gemini documents project-level rather than key-level rate limits; key rotation is therefore not a legitimate way to multiply one project's quota.

## Promotion gate

This branch contains pure policy/configuration only. GitHub Actions are disabled for the repository and laptop compute is reserved, so promotion requires a later independent test run. Until then factory/continuous-coding remains LKG.
