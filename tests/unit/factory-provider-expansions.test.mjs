import assert from "node:assert/strict";
import test from "node:test";
import { buildWorkers, parseCliJson, probeResult } from "../../factory/omniroute-adapter.mjs";
const now = Date.now();
const model = {
  id: "oc/mimo-v2.5-free",
  root: "mimo-v2.5-free",
  provider: "opencode",
  capabilities: { tool_calling: true, reasoning: true },
};
const proof = { ok: true, status: 200, checkedAt: new Date(now).toISOString() };
const inventory = (active = true, evidence = proof) =>
  buildWorkers({
    connections: [{ id: "c1", provider: "opencode", isActive: active }],
    models: [model],
    probes: { [model.id]: evidence },
    tiers: { opencode: 1 },
    now,
  })[0];
test("gateway model IDs are not prefixed twice", () => {
  assert.equal(inventory().id, "opencode/mimo-v2.5-free");
  assert.equal(inventory().model, "oc/mimo-v2.5-free");
});
test("inactive connection remains held despite a successful probe", () => {
  assert.equal(inventory(false).healthy, false);
  assert.equal(inventory(false).held, true);
});
test("expired evidence cannot promote a worker", () => {
  const old = { ...proof, checkedAt: new Date(now - 3600000).toISOString() };
  assert.equal(inventory(true, old).healthy, false);
});
test("catalog tool support alone is not a tested tool capability", () => {
  assert.equal(inventory().tools, false);
});
test("HTTP 200 with an error body is not inference success", () => {
  assert.equal(probeResult({ status: 200, body: { error: { message: "blocked" } } }).ok, false);
});
test("empty output is not inference success", () => {
  assert.equal(probeResult({ status: 200, body: { choices: [] } }).ok, false);
});
test("exact nonce is required for a successful canary", () => {
  const body = { choices: [{ message: { content: "CANARY" } }] };
  assert.equal(probeResult({ status: 200, body, expected: "CANARY" }).ok, true);
  assert.equal(probeResult({ status: 200, body, expected: "OTHER" }).ok, false);
});
test("CLI bracketed diagnostic is not mistaken for JSON", () => {
  assert.deepEqual(parseCliJson('[info] startup complete\n{"connections":[]}'), {
    connections: [],
  });
});
test("missing observation time fails closed", () => {
  assert.equal(inventory(true, { ok: true, status: 200 }).healthy, false);
});
test("unknown cost tier is not silently free", () => {
  const [worker] = buildWorkers({
    connections: [{ provider: "opencode", isActive: true }],
    models: [model],
    probes: { [model.id]: proof },
    now,
  });
  assert.equal(worker.healthy, false);
});
