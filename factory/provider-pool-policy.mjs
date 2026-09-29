export const FAILURE = Object.freeze({
  RATE_LIMITED: "rate-limited",
  DAILY_EXHAUSTED: "daily-exhausted",
  AUTH_FAILED: "auth-failed",
  MODEL_UNAVAILABLE: "model-unavailable",
  PROVIDER_DOWN: "provider-down",
  CAPACITY_BUSY: "capacity-busy",
  RETIRED: "retired",
});
export function classifyProviderFailure({ status, code, retryAfter, message = "" } = {}) {
  const text = String(message).toLowerCase();
  if (code === 3036 || /daily.+(limit|allocation|quota)|quota.+daily/.test(text))
    return { type: FAILURE.DAILY_EXHAUSTED, scope: "quota", retryAfter };
  if (code === 3040 || /capacity|busy|overloaded/.test(text))
    return { type: FAILURE.CAPACITY_BUSY, scope: "model", retryAfter };
  if (status === 401 || status === 403) return { type: FAILURE.AUTH_FAILED, scope: "connection" };
  if (status === 404 || /model.+(not found|unavailable|retired)/.test(text))
    return { type: FAILURE.MODEL_UNAVAILABLE, scope: "model" };
  if (status === 429) return { type: FAILURE.RATE_LIMITED, scope: "connection", retryAfter };
  if ([408, 500, 502, 503, 504].includes(status))
    return { type: FAILURE.PROVIDER_DOWN, scope: "provider", retryAfter };
  return { type: "unknown", scope: "request" };
}
export function quotaIdentity(worker) {
  if (!worker || typeof worker.provider !== "string") throw new Error("Missing provider identity");
  return worker.quotaGroup || worker.provider;
}
export function eligiblePool(workers, needs = {}) {
  const required = new Set(needs.capabilities || []);
  return workers.filter((worker) => {
    if (!worker || worker.healthy !== true || worker.held === true) return false;
    if (worker.state === "retired") return false;
    if (worker.dataClasses && !worker.dataClasses.includes(needs.classification)) return false;
    if (needs.maxTier != null && worker.tier > needs.maxTier) return false;
    return [...required].every((cap) => worker[cap] === true || worker.capabilities?.includes?.(cap));
  });
}
export function rankPool(workers, needs = {}) {
  return eligiblePool(workers, needs).toSorted((a, b) => {
    const ah = Number.isFinite(a.headroom) ? a.headroom : 0;
    const bh = Number.isFinite(b.headroom) ? b.headroom : 0;
    const al = Number.isFinite(a.latencyMs) ? a.latencyMs : Number.MAX_SAFE_INTEGER;
    const bl = Number.isFinite(b.latencyMs) ? b.latencyMs : Number.MAX_SAFE_INTEGER;
    return (a.tier ?? 99) - (b.tier ?? 99) || bh - ah || al - bl || String(a.id).localeCompare(String(b.id));
  });
}
