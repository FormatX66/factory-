import { probeOpenCode } from "./opencode-worker.mjs";

const result = await probeOpenCode();
console.log(JSON.stringify({
  ok: result.ok,
  status: result.status,
  model: result.model,
  provider: result.provider,
  reportedCost: result.reportedCost,
  tools: result.tools,
  checkedAt: result.checkedAt,
  latencyMs: result.latencyMs,
  reason: result.reason ?? null
}));
process.exitCode = result.ok ? 0 : 2;
