const ALIASES = { opencode: "oc", "ollama-local": "ollama", ovhcloud: "ovh" };
const DEFAULT_MAX_AGE_MS = 15 * 60 * 1000;
export function parseCliJson(text) {
  if (typeof text !== "string" || text.length > 1048576) throw new Error("Invalid CLI output");
  const clean = text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
  const starts = [...clean.matchAll(/^[ \t]*(?=[{\[])/gm)].slice(0, 64);
  for (const match of starts) {
    try {
      return JSON.parse(clean.slice(match.index));
    } catch {
      /* A diagnostic, not the payload. */
    }
  }
  throw new Error("No complete JSON payload");
}
export function connectionsFromResponse(data) {
  if (!Array.isArray(data?.connections)) throw new Error("Expected /api/providers connections");
  return data.connections;
}
export function canonicalModel(model) {
  const provider = model.provider ?? model.owned_by;
  if (typeof provider !== "string" || typeof model.id !== "string")
    throw new Error("Missing model identity");
  const alias = ALIASES[provider] ?? provider;
  const prefixes = [alias + "/", provider + "/"];
  const prefix = prefixes.find((value) => model.id.startsWith(value));
  const raw = model.root || (prefix ? model.id.slice(prefix.length) : model.id);
  if (!raw || prefixes.some((value) => raw.startsWith(value)))
    throw new Error("Ambiguous model prefix");
  return { provider, id: `${provider}/${raw}`, model: prefix ? model.id : `${alias}/${raw}` };
}
export function buildWorkers({
  connections = [],
  models = [],
  probes = {},
  tiers = {},
  now = Date.now(),
  maxAgeMs = DEFAULT_MAX_AGE_MS,
}) {
  const active = new Set(connections.filter((c) => c.isActive === true).map((c) => c.provider));
  return models.map((model) => {
    const identity = canonicalModel(model);
    const evidence = probes[identity.model] ?? probes[model.id];
    const age = now - Date.parse(evidence?.checkedAt ?? "");
    const fresh = Number.isFinite(age) && age >= 0 && age <= maxAgeMs;
    const tier = tiers[identity.provider];
    const authorized = [0, 1, 2].includes(tier);
    const healthy =
      active.has(identity.provider) &&
      authorized &&
      fresh &&
      evidence?.ok === true &&
      evidence.status >= 200 &&
      evidence.status < 300;
    const reason = !active.has(identity.provider)
      ? "provider-not-connected"
      : !authorized
        ? "cost-policy-unset"
        : !fresh
          ? "probe-missing-or-expired"
          : "probe-failed";
    return {
      ...identity,
      healthy,
      held: !healthy,
      tier: authorized ? tier : 3,
      tools: healthy && evidence.tools === true && model.capabilities?.tool_calling === true,
      reasoning: model.capabilities?.reasoning === true,
      context: model.contextWindow ?? model.context_length ?? 0,
      evidence: evidence ?? { ok: false, reason },
      holdReason: healthy ? null : reason,
    };
  });
}
export function probeResult({ status, body, expected, checkedAt = new Date().toISOString() }) {
  const answer = body?.choices?.[0]?.message?.content;
  const ok =
    status >= 200 &&
    status < 300 &&
    !body?.error &&
    typeof expected === "string" &&
    expected.length > 0 &&
    typeof answer === "string" &&
    answer.trim() === expected;
  return {
    ok,
    status,
    checkedAt,
    tools: false,
    reason: ok ? "exact-live-response" : (body?.error?.message ?? `probe-failed-http-${status}`),
  };
}
