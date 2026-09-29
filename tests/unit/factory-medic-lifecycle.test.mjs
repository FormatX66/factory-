import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { normalizeMedicJob, dispatchMedicJob, runMedicJob, persistMedicResult } from "../../factory/medic-bridge.mjs";
function root(t) { const p = fs.mkdtempSync(path.join(os.tmpdir(), "factory-medic-")); t.after(() => fs.rmSync(p, { force: true, recursive: true })); return p; }
const fake = async (task) => ({ task: { ...task, status: "review" }, output: "proposal" });
const job = (changes = {}) => ({ id: "fixture", goal: "Analyze synthetic data", ...changes });
const read = (dir) => JSON.parse(fs.readFileSync(path.join(dir, "fixture", "attempt.json")));
test("input defaults private and proposal-only", () => { const j = normalizeMedicJob(job()); assert.equal(j.classification, "private"); assert.equal(j.mode, "proposal"); });
test("tool flag needs an explicit inspect or build mode", () => assert.throws(() => normalizeMedicJob(job({ needsTools: true })), /explicit_execution_mode_required/));
test("build request gets a durable hold before model call", async (t) => {
  const dir = root(t); let calls = 0; const r = await runMedicJob(job({ mode: "build", needsTools: true }), { root: dir, adapters: { codex: async () => calls++ } });
  assert.equal(r.status, "held"); assert.equal(r.error, "build_executor_not_registered"); assert.equal(calls, 0);
  assert.deepEqual(read(dir).events.map((e) => e.status), ["accepted", "held"]);
});
test("successful proposal remains review, never verified execution", async (t) => {
  const dir = root(t); const r = await runMedicJob(job(), { root: dir, adapters: { codex: async (task) => ({ ...await fake(task), task: { ...task, status: "succeeded" } }) } });
  assert.equal(r.ok, true); assert.equal(r.status, "review"); assert.equal(r.executionVerified, false); assert.equal(read(dir).status, "review");
});
test("accepted input is durable before the adapter starts", async (t) => {
  const dir = root(t); const r = await runMedicJob(job(), { root: dir, adapters: { codex: async (task) => { assert.equal(read(dir).status, "running"); assert.equal(read(dir).job.classification, "private"); return fake(task); } } });
  assert.equal(r.ok, true); assert.equal(read(dir).checkinWindow.length, 2);
});
test("failure saves a sanitized receipt rather than losing the job", async (t) => {
  const dir = root(t); const r = await runMedicJob(job({ mode: "inspect" }), { root: dir, adapters: { codex: async () => { throw new Error("PRIVATE_SECRET"); } } });
  assert.equal(r.status, "failed"); assert.equal(read(dir).status, "failed"); assert.equal(JSON.stringify(read(dir)).includes("PRIVATE_SECRET"), false);
});
test("private job cannot use public adapter", async () => {
  const r = await dispatchMedicJob(job(), { codex: fake, openCode: () => assert.fail("private leak") });
  assert.equal(r.route, "subscription/codex");
});
test("public proposal uses free adapter without private credentials", async () => {
  const r = await dispatchMedicJob(job({ classification: "public" }), { openCode: fake, codex: () => assert.fail("wrong route") });
  assert.equal(r.route, "free/opencode/space-bunny-free");
});
test("private no-tool proposal retains local fallback", async () => {
  const r = await dispatchMedicJob(job(), { codex: async () => { throw new Error("quota"); }, local: fake }); assert.equal(r.route, "local/qwen2.5-coder:7b");
});
test("inspect failures never degrade to tool-less local", async () => {
  await assert.rejects(dispatchMedicJob(job({ mode: "inspect" }), { codex: async () => { throw new Error("down"); }, local: () => assert.fail("degradation") }), /down/);
});
test("duplicate ID cannot cause a second invocation or overwrite old evidence", async (t) => {
  const dir = root(t); let calls = 0; const opts = { root: dir, adapters: { codex: async (task) => { calls++; return fake(task); } } };
  await runMedicJob(job(), opts); const before = fs.readFileSync(path.join(dir, "fixture", "attempt.json"), "utf8");
  await assert.rejects(runMedicJob(job(), opts), /job_id_already_exists/); assert.equal(calls, 1);
  assert.equal(fs.readFileSync(path.join(dir, "fixture", "attempt.json"), "utf8"), before);
});
test("empty output and wrong job ID fail closed", async (t) => {
  for (const bad of [{ output: "" }, { task: { id: "wrong" }, output: "ok" }]) {
    const r = await runMedicJob(job(), { root: root(t), adapters: { codex: async (task) => ({ ...await fake(task), ...bad }) } }); assert.equal(r.ok, false);
  }
});
test("malformed requirements, goal, baseline, classification and window are rejected", () => {
  for (const changes of [{ goal: {} }, { goal: " " }, { requirements: [4] }, { requirements: Array(33).fill("x") },
    { classification: "secret-ish" }, { repo: {} }, { lkg: "" }, { checkinMinutes: [2, 1] }, { id: 4 }]) assert.throws(() => normalizeMedicJob(job(changes)));
});
test("legacy persistence cannot escape its root with dot or slash IDs", (t) => {
  for (const id of ["..", ".", "x/y", "x\\y", ""]) assert.throws(() => persistMedicResult(root(t), { id, task: {} }), /invalid_evidence_path/);
});
test("real CLI returns durable held build without invoking a model", (t) => {
  const dir = root(t), cli = new URL("../../scripts/cli/medic-factory-job.mjs", import.meta.url);
  const r = spawnSync(process.execPath, [fileURLToPath(cli)], { input: JSON.stringify(job({ mode: "build", needsTools: true })), env: { ...process.env, FACTORY_MEDIC_EVIDENCE: dir }, encoding: "utf8", timeout: 3000 });
  assert.equal(r.status, 1); const body = JSON.parse(r.stdout); assert.equal(body.error, "build_executor_not_registered"); assert.equal(read(dir).status, "held");
});
test("CLI bounds malformed input without leaking it", (t) => {
  const dir = root(t), cli = new URL("../../scripts/cli/medic-factory-job.mjs", import.meta.url);
  for (const input of ["not-json PRIVATE_SECRET", "x".repeat(66000)]) {
    const r = spawnSync(process.execPath, [fileURLToPath(cli)], { input, env: { ...process.env, FACTORY_MEDIC_EVIDENCE: dir }, encoding: "utf8", timeout: 3000 });
    assert.equal(r.status, 1); assert.equal(r.stdout.includes("PRIVATE_SECRET"), false); assert.equal(JSON.parse(r.stdout).status, "held");
  }
});
