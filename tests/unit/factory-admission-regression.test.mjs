import assert from "node:assert/strict";
import test from "node:test";
const base = process.env.FACTORY_TEST_BASELINE === "1" ? "../../baseline/factory" : "../../factory";
const { normalizeMedicJob, dispatchMedicJob } = await import(`${base}/medic-bridge.mjs`);

test("build request is refused before a read-only proposal worker is called", async () => {
  let calls = 0;
  await assert.rejects(dispatchMedicJob({ id: "build-1", goal: "Build fixture", mode: "build", needsTools: true }, {
    codex: async (task) => { calls++; return { task: { ...task, status: "review" }, output: "proposal" }; },
  }));
  assert.equal(calls, 0);
});
test("path traversal job ID is refused", () => {
  assert.throws(() => normalizeMedicJob({ id: "..", goal: "fixture" }));
});
test("string tool permission is not silently downgraded", () => {
  assert.throws(() => normalizeMedicJob({ id: "bool-1", goal: "fixture", needsTools: "true" }));
});
