import fs from "node:fs";

const CREDENTIAL_HINTS = {
  groq: ["GROQ_API_KEY"],
  "google-gemini": ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
  zai: ["ZAI_API_KEY", "ZHIPU_API_KEY"],
  "cloudflare-workers-ai": ["CLOUDFLARE_API_TOKEN", "CF_API_TOKEN"],
  "openrouter-free": ["OPENROUTER_API_KEY"],
  aion: ["AION_API_KEY"],
  morph: ["MORPH_API_KEY"],
};

export function loadFreeCatalog(path = new URL("./free-capacity.catalog.json", import.meta.url)) {
  const raw = fs.readFileSync(path, "utf8").replace(/^\uFEFF/, "");
  return JSON.parse(raw);
}

export function validateFreeCatalog(catalog) {
  if (catalog?.policy?.max_usd_per_request !== 0) throw new Error("zero-spend policy missing");
  if (catalog?.policy?.paid_fallback !== false) throw new Error("paid fallback must be false");
  if (catalog?.policy?.auto_topup !== false) throw new Error("auto topup must be false");
  if (!Array.isArray(catalog?.providers) || !catalog.providers.length) throw new Error("provider catalog empty");
  const ids = new Set();
  for (const provider of catalog.providers) {
    if (!provider.id || ids.has(provider.id)) throw new Error("duplicate or missing provider id");
    ids.add(provider.id);
    if (provider.enabled !== false) throw new Error("candidates must start disabled");
    if (provider.recurring_free !== true) throw new Error("non-recurring offer in recurring pool");
  }
  return true;
}
export function credentialState(provider, env = process.env, connected = new Set()) {
  if (connected.has(provider.id)) return { state: "connected", readyForCanary: true };
  const hints = CREDENTIAL_HINTS[provider.id] ?? [];
  if (hints.some((name) => typeof env[name] === "string" && env[name].length > 0)) {
    return { state: "credential-present", readyForCanary: true };
  }
  if (provider.auth === "github" && env.GITHUB_TOKEN) {
    return { state: "credential-present", readyForCanary: true };
  }
  if (provider.auth === "unknown") return { state: "auth-unverified", readyForCanary: false };
  return { state: "auth-required", readyForCanary: false };
}

export function buildIntakeState(catalog, { env = process.env, connectedProviders = [] } = {}) {
  validateFreeCatalog(catalog);
  const connected = new Set(connectedProviders);
  return catalog.providers.map((provider) => {
    const auth = credentialState(provider, env, connected);
    return {
      id: provider.id,
      kind: provider.kind,
      enabled: false,
      admitted: false,
      hold: auth.readyForCanary ? "awaiting-live-canary" : auth.state,
      readyForCanary: auth.readyForCanary,
      data: provider.data,
    };
  });
}
export function admitAfterCanary(candidate, evidence) {
  const zeroCost = evidence?.reportedCost === 0 || evidence?.maxUsdObserved === 0;
  const healthy = evidence?.ok === true && zeroCost && evidence?.paidFallbackUsed !== true;
  return {
    ...candidate,
    enabled: healthy,
    admitted: healthy,
    hold: healthy ? null : (evidence?.reason ?? "canary-failed-or-cost-unproven"),
    evidence,
  };
}

export function summarizeIntake(states) {
  return states.reduce(
    (acc, state) => {
      acc.total += 1;
      if (state.admitted) acc.healthy += 1;
      else if (state.readyForCanary) acc.awaitingCanary += 1;
      else acc.awaitingAuth += 1;
      return acc;
    },
    { total: 0, healthy: 0, awaitingCanary: 0, awaitingAuth: 0 }
  );
}

export function canaryPlan(states) {
  return states
    .filter((state) => state.readyForCanary && state.kind === "inference")
    .map((state) => ({
      provider: state.id,
      prompt: "Reply exactly FACTORY_FREE_CANARY_OK.",
      maxOutputTokens: 12,
      classification: "synthetic",
      maxUsd: 0,
      paidFallback: false,
    }));
}
