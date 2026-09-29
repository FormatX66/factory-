import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { normalizeJob, executionDecision, runAuthorizedBatch, EXECUTION_POLICY } from "../../factory/workflow-controller.mjs";
const digest = (s) => crypto.createHash("sha256").update(s).digest("hex");
const job = (id, changes = {}) => ({ id, goal: "Write and independently verify a fixture artifact", kind: "build",
  scope: "temporary-fixture", revision: "fixture-v1", classification: "synthetic", dependencies: [], checkinMinutes: [1, 2], ...changes });
const grant = (j, changes = {}) => ({ source: "operator", jobId: j.id, fingerprint: normalizeJob(j).fingerprint,
  kind: j.kind, scope: j.scope, expiresAt: new Date(Date.now() + 600000).toISOString(), ...changes });
function root(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "factory-controller-")); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; }
const execute = async (j) => ({ jobFingerprint: j.fingerprint, exitCode: 0, executorId: "fixture-executor", artifactDigest: digest(j.id) });
const verify = async (j, r) => ({ jobFingerprint: j.fingerprint, artifactDigest: r.artifactDigest, verifierId: "fixture-verifier", passed: true });
const options = (t, jobs, changes = {}) => ({ root: root(t), execute, verify, capabilities: ["build"], grants: jobs.map((j) => grant(j)), ...changes });

test("policy never treats prediction as authorization or promotes automatically", () => {
  assert.equal(EXECUTION_POLICY.requireExactGrant, true); assert.equal(EXECUTION_POLICY.automaticPromotion, false);
  assert.equal(EXECUTION_POLICY.automaticRetry, false); assert.equal(EXECUTION_POLICY.createsSchedules, false);
});
test("job IDs are strings rather than coerced values", () => assert.throws(() => normalizeJob(job(12))));
test("unknown kind, classification, baseline and invalid estimates are rejected", () => {
  for (const changes of [{ kind: "delete" }, { classification: "guessed" }, { revision: "" },
    { checkinMinutes: undefined }, { checkinMinutes: [2, 1] }, { checkinMinutes: [0, 2] }, { checkinMinutes: [1.5, 2] }])
    assert.throws(() => normalizeJob(job("invalid", changes)));
});
test("predicted approval is not an operator grant", () => {
  const j = job("predicted"); assert.equal(executionDecision(normalizeJob(j), [grant(j, { source: "prediction" })], ["build"]).action, "hold");
});
test("changed job content invalidates an existing grant", () => {
  const j = job("changed"); assert.equal(executionDecision(normalizeJob({ ...j, goal: "other" }), [grant(j)], ["build"]).action, "hold");
});
test("expired authorization cannot dispatch", () => {
  const j = job("expired"); assert.equal(executionDecision(normalizeJob(j), [grant(j, { expiresAt: "2000-01-01T00:00:00Z" })], ["build"]).action, "hold");
});
test("read-only capability cannot accept a build", () => {
  const j = job("readonly"); assert.equal(executionDecision(normalizeJob(j), [grant(j)], ["proposal"]).reason, "executor_not_available");
});
test("held job does not invoke execution or verification", async (t) => {
  let called = 0; const j = job("held"); const result = await runAuthorizedBatch([j], options(t, [j], { grants: [], execute: async () => called++ }));
  assert.equal(called, 0); assert.equal(result[0].status, "held");
});
test("executor and verifier must be separate functions", async (t) => {
  const j = job("same"); await assert.rejects(runAuthorizedBatch([j], options(t, [j], { verify: execute })), /invalid_controller_options/);
});
test("job record is on disk before execution", async (t) => {
  const j = job("durable"), opts = options(t, [j]);
  opts.execute = async (j) => { const r = JSON.parse(fs.readFileSync(path.join(opts.root, j.id + ".json"))); assert.equal(r.status, "running"); assert.equal(r.attempts, 1); return execute(j); };
  const [r] = await runAuthorizedBatch([j], opts); assert.equal(r.status, "succeeded"); assert.equal(r.checkinWindow.length, 2);
});
test("failed lane does not stop an independent lane; dependents hold", async (t) => {
  const jobs = [job("fails"), job("good"), job("dependent", { dependencies: ["fails"] })];
  const result = await runAuthorizedBatch(jobs, options(t, jobs, { execute: async (j) => { if (j.id === "fails") throw new Error("PRIVATE_SECRET"); return execute(j); } }));
  assert.deepEqual(result.map((r) => r.status), ["failed", "succeeded", "held"]);
  assert.equal(JSON.stringify(result).includes("PRIVATE_SECRET"), false);
});
test("verified dependency runs before its child", async (t) => {
  const jobs = [job("child", { dependencies: ["parent"] }), job("parent")], order = [];
  const result = await runAuthorizedBatch(jobs, options(t, jobs, { execute: async (j) => { order.push(j.id); return execute(j); } }));
  assert.deepEqual(order, ["parent", "child"]); assert.ok(result.every((r) => r.status === "succeeded"));
});
test("requesting a build is not accepted as its own success receipt", async (t) => {
  const j = job("false-success"); const [r] = await runAuthorizedBatch([j], options(t, [j], { execute: async () => ({ status: "succeeded", output: "done" }) }));
  assert.equal(r.status, "failed");
});
test("same worker cannot pose as the verifier", async (t) => {
  const j = job("self-review"); const [r] = await runAuthorizedBatch([j], options(t, [j], { verify: async (j, r) => ({ ...await verify(j, r), verifierId: r.executorId }) }));
  assert.equal(r.reason, "verification_rejected");
});
test("different artifact hash fails verification", async (t) => {
  const j = job("hash-mismatch"); const [r] = await runAuthorizedBatch([j], options(t, [j], { verify: async (j, r) => ({ ...await verify(j, r), artifactDigest: digest("wrong") }) }));
  assert.equal(r.reason, "verification_rejected");
});
test("nonzero exit and wrong-job receipt cannot pass", async (t) => {
  const jobs = [job("exit"), job("wrong-job")]; const results = await runAuthorizedBatch(jobs, options(t, jobs, { execute: async (j) => ({ ...await execute(j), ...(j.id === "exit" ? { exitCode: 7 } : { jobFingerprint: digest("wrong") }) }) }));
  assert.ok(results.every((r) => r.status === "failed"));
});
test("completed job is not executed twice on another invocation", async (t) => {
  const j = job("resume"), opts = options(t, [j]); let calls = 0;
  opts.execute = async (j) => { calls++; return execute(j); };
  await runAuthorizedBatch([j], opts); await runAuthorizedBatch([j], opts); assert.equal(calls, 1);
});
test("same ID with changed inputs cannot overwrite history", async (t) => {
  const j = job("conflict"), opts = options(t, [j]); await runAuthorizedBatch([j], opts);
  await assert.rejects(runAuthorizedBatch([{ ...j, goal: "new input" }], opts), /state_conflict_or_corruption/);
});
test("interrupted execution is held rather than blindly replayed", async (t) => {
  const j = job("interrupted"), opts = options(t, [j]); await runAuthorizedBatch([j], opts);
  const file = path.join(opts.root, j.id + ".json"), prior = JSON.parse(fs.readFileSync(file)); prior.status = "running"; fs.writeFileSync(file, JSON.stringify(prior));
  opts.execute = async () => assert.fail("unexpected replay");
  const [r] = await runAuthorizedBatch([j], opts); assert.equal(r.reason, "interrupted_attempt_requires_reconciliation");
});
test("dependency cycles and missing references reject before creating records", async (t) => {
  const cyclic = [job("a", { dependencies: ["b"] }), job("b", { dependencies: ["a"] })];
  await assert.rejects(runAuthorizedBatch(cyclic, options(t, cyclic)), /dependency_cycle/);
  const missing = [job("c", { dependencies: ["absent"] })];
  await assert.rejects(runAuthorizedBatch(missing, options(t, missing)), /missing_dependency/);
});
test("duplicate IDs and unbounded concurrency are rejected", async (t) => {
  const j = job("duplicate"); await assert.rejects(runAuthorizedBatch([j, j], options(t, [j])), /duplicate_job_id/);
  await assert.rejects(runAuthorizedBatch([j], options(t, [j], { concurrency: 50 })), /invalid_controller_options/);
});
test("concurrent controllers do not steal ownership", async (t) => {
  const j = job("owner"), opts = options(t, [j]); fs.writeFileSync(path.join(opts.root, ".controller.lock"), "other-controller");
  await assert.rejects(runAuthorizedBatch([j], opts), { code: "EEXIST" });
  assert.equal(fs.readFileSync(path.join(opts.root, ".controller.lock"), "utf8"), "other-controller");
});
test("deadline is not called completion and late output cannot promote", async (t) => {
  const j = job("slow"), opts = options(t, [j], { timeoutMs: 5, execute: async (j) => { await new Promise((r) => setTimeout(r, 25)); return execute(j); } });
  const [r] = await runAuthorizedBatch([j], opts); assert.equal(r.status, "held"); assert.match(r.reason, /cancellation_unverified/);
  assert.equal(fs.existsSync(path.join(opts.root, ".controller.lock")), true);
  await new Promise((r) => setTimeout(r, 30)); assert.equal(JSON.parse(fs.readFileSync(path.join(opts.root, "slow.json"))).status, "held");
});
test("real child-process artifacts run concurrently and are separately read and hashed", async (t) => {
  const jobs = [job("one"), job("two")], opts = options(t, jobs), intervals = [], receipts = [];
  const artifacts = path.join(opts.root, "artifacts"); fs.mkdirSync(artifacts);
  opts.execute = async (j, { signal }) => {
    const file = path.join(artifacts, j.id + ".txt"), start = Date.now();
    const program = 'const fs=require("node:fs");setTimeout(()=>{fs.writeFileSync(process.argv[1],process.argv[2],{flag:"wx"});},100);';
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ["-e", program, file, j.id], { stdio: "ignore", signal, shell: false });
      child.once("error", reject); child.once("close", (code) => code === 0 ? resolve() : reject(new Error("fixture_exit")));
    });
    intervals.push({ id: j.id, start, end: Date.now() });
    return { jobFingerprint: j.fingerprint, exitCode: 0, executorId: "node-child-fixture", artifactDigest: digest(j.id), artifact: file };
  };
  opts.verify = async (j, r) => {
    const bytes = fs.readFileSync(r.artifact), actual = digest(bytes);
    receipts.push({ id: j.id, expected: r.artifactDigest, actual, bytes: bytes.length });
    return { jobFingerprint: j.fingerprint, artifactDigest: actual, verifierId: "separate-file-readback", passed: bytes.toString() === j.id };
  };
  const result = await runAuthorizedBatch(jobs, opts);
  assert.ok(result.every((r) => r.status === "succeeded"));
  assert.ok(Math.max(...intervals.map((r) => r.start)) < Math.min(...intervals.map((r) => r.end)));
  assert.equal(receipts.length, 2);
  if (process.env.FACTORY_FIXTURE_RECEIPT) fs.writeFileSync(process.env.FACTORY_FIXTURE_RECEIPT, JSON.stringify({ scope: "isolated synthetic child-process fixture, not live Commander", intervals, receipts, result }, null, 2));
});
