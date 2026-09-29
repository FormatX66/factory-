import assert from "node:assert/strict";
import test from "node:test";
import {
  admitAfterCanary,
  buildIntakeState,
  canaryPlan,
  loadFreeCatalog,
  summarizeIntake,
  validateFreeCatalog,
} from "./free-capacity-intake.mjs";

test("catalog is zero-spend and disabled by default", () => {
  const catalog = loadFreeCatalog();
  assert.equal(validateFreeCatalog(catalog), true);
  assert.equal(catalog.policy.max_usd_per_request, 0);
  assert.equal(catalog.policy.paid_fallback, false);
  assert.equal(catalog.providers.every((p) => p.enabled === false), true);
});

test("credential presence only advances to canary, never auto-admits", () => {
  const catalog = loadFreeCatalog();
  const states = buildIntakeState(catalog, { env: { GROQ_API_KEY: "present" } });
  const groq = states.find((x) => x.id === "groq");
  assert.equal(groq.readyForCanary, true);
  assert.equal(groq.admitted, false);
  assert.equal(groq.hold, "awaiting-live-canary");
});
test("canary admission requires success and proven zero cost", () => {
  const candidate = { id: "groq", admitted: false, enabled: false };
  assert.equal(admitAfterCanary(candidate, { ok: true, reportedCost: 0 }).admitted, true);
  assert.equal(admitAfterCanary(candidate, { ok: true }).admitted, false);
  assert.equal(admitAfterCanary(candidate, { ok: true, reportedCost: 1 }).admitted, false);
  assert.equal(
    admitAfterCanary(candidate, { ok: true, reportedCost: 0, paidFallbackUsed: true }).admitted,
    false
  );
});

test("canary plan uses only synthetic zero-dollar inference calls", () => {
  const catalog = loadFreeCatalog();
  const states = buildIntakeState(catalog, {
    env: { GROQ_API_KEY: "present", GITHUB_TOKEN: "present" },
  });
  const plan = canaryPlan(states);
  assert.deepEqual(plan.map((x) => x.provider), ["groq"]);
  assert.equal(plan[0].maxUsd, 0);
  assert.equal(plan[0].classification, "synthetic");
  assert.equal(plan[0].paidFallback, false);
});

test("summary separates auth holds from canary holds", () => {
  const catalog = loadFreeCatalog();
  const states = buildIntakeState(catalog, { env: { GROQ_API_KEY: "present" } });
  const summary = summarizeIntake(states);
  assert.equal(summary.total, catalog.providers.length);
  assert.equal(summary.healthy, 0);
  assert.equal(summary.awaitingCanary, 1);
  assert.equal(summary.awaitingAuth, catalog.providers.length - 1);
});
