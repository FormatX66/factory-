import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { createValidationExecutor, readTapSummary } from "../../factory/validation-executor.mjs";
import { normalizeJob, runAuthorizedBatch } from "../../factory/workflow-controller.mjs";
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const passing = 'import test from "node:test"; import assert from "node:assert/strict"; test("actual",()=>assert.equal(2+3,5));\n';
function setup(t, source = passing, extra = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "factory-executor-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sourceRoot = path.join(root, "input"), outputRoot = path.join(root, "output"); fs.mkdirSync(sourceRoot);
  fs.writeFileSync(path.join(sourceRoot, "reviewed.test.mjs"), source);
  const recipe = { id: "qualification", revision: "pinned-source-1", expectedTests: 1,
    tests: ["reviewed.test.mjs"], manifest: [{ file: "reviewed.test.mjs", sha256: hash(source) }] };
  const options = { sourceRoot, outputRoot, recipes: [recipe], ...extra };
  const job = normalizeJob({ id: "validation-job", goal: "Run reviewed tests", kind: "test",
    scope: recipe.id, revision: recipe.revision, classification: "synthetic", dependencies: [], checkinMinutes: [1, 2] });
  return { root, options, recipe, job, adapter: createValidationExecutor(options) };
}
test("real tests execute, produce receipts, and separately pass file readback", async t => {
  const { adapter, job, options } = setup(t); const result = await adapter.execute(job);
  assert.equal(fs.existsSync(result.artifact), true);
  const receipt = JSON.parse(fs.readFileSync(result.receipt)); assert.ok(receipt.pid > 0); assert.equal(receipt.exitCode, 0);
  assert.equal(receipt.runtime, process.version); assert.equal(receipt.executionClosed, true);
  const verified = await adapter.verify(job, result); assert.equal(verified.passed, true); assert.equal(verified.summary.tests, 1);
  assert.equal(fs.existsSync(path.join(options.outputRoot, job.id, "verification.json")), true);
});
test("build requests never launch through validation executor", async t => {
  const { adapter, job, options } = setup(t); await assert.rejects(adapter.execute({ ...job, kind: "build" }), /validation_only/);
  assert.deepEqual(fs.readdirSync(options.outputRoot), []);
});
test("unknown recipe is refused", async t => {
  const { adapter, job } = setup(t); await assert.rejects(adapter.execute({ ...job, scope: "arbitrary-command" }), /recipe_not_registered/);
});
test("changed revision is refused", async t => {
  const { adapter, job } = setup(t); await assert.rejects(adapter.execute({ ...job, revision: "unreviewed" }), /recipe_not_registered/);
});
test("changed source is rejected before child launch", async t => {
  const { adapter, job, options } = setup(t); fs.appendFileSync(path.join(options.sourceRoot, "reviewed.test.mjs"), "\n");
  await assert.rejects(adapter.execute(job), /source_hash_mismatch/); assert.deepEqual(fs.readdirSync(options.outputRoot), []);
});
test("duplicate execution cannot overwrite prior receipts", async t => {
  const { adapter, job } = setup(t); const result = await adapter.execute(job); const prior = fs.readFileSync(result.receipt, "utf8");
  await assert.rejects(adapter.execute(job), { code: "EEXIST" }); assert.equal(fs.readFileSync(result.receipt, "utf8"), prior);
});
test("receipt supplied for another path cannot be verified", async t => {
  const { adapter, job } = setup(t); const result = await adapter.execute(job);
  await assert.rejects(adapter.verify(job, { ...result, artifact: "/tmp/not-the-artifact" }), /unexpected_result_path/);
});
test("modified output fails independent verification", async t => {
  const { adapter, job } = setup(t); const result = await adapter.execute(job); fs.appendFileSync(result.artifact, "# changed\n");
  await assert.rejects(adapter.verify(job, result), /artifact_integrity_mismatch/);
});
test("false passing test count is rejected", async t => {
  const s = setup(t); s.recipe.expectedTests = 2; const adapter = createValidationExecutor(s.options);
  const result = await adapter.execute(s.job); await assert.rejects(adapter.verify(s.job, result), /test_acceptance_failed/);
});
test("a skipped test cannot be called passing", async t => {
  const { adapter, job } = setup(t, 'import test from "node:test"; test.skip("not run",()=>{});\n');
  const result = await adapter.execute(job); await assert.rejects(adapter.verify(job, result), /test_acceptance_failed/);
});
test("actual assertion failure retains nonzero execution receipt", async t => {
  const { adapter, job, options } = setup(t, 'import test from "node:test"; import assert from "node:assert/strict";test("fail",()=>assert.fail("fixture"));\n');
  await assert.rejects(adapter.execute(job), /test_process_failed/);
  const receipt = JSON.parse(fs.readFileSync(path.join(options.outputRoot, job.id, "execution.json")));
  assert.notEqual(receipt.exitCode, 0); assert.equal(receipt.executionClosed, true);
});
test("ambient secret and Node option variables are not inherited", async t => {
  const before = process.env.FACTORY_FAKE_SECRET; process.env.FACTORY_FAKE_SECRET = "fixture-do-not-inherit";
  t.after(() => before === undefined ? delete process.env.FACTORY_FAKE_SECRET : process.env.FACTORY_FAKE_SECRET = before);
  const { adapter, job } = setup(t, 'import test from "node:test";import assert from "node:assert/strict";test("environment",()=>{assert.equal(process.env.FACTORY_FAKE_SECRET,undefined);assert.equal(process.env.NODE_OPTIONS,undefined);});\n');
  const result = await adapter.execute(job); assert.equal((await adapter.verify(job, result)).passed, true);
});
test("deadline records actual child closure rather than fabricated completion", async t => {
  const { adapter, job, options } = setup(t, 'import test from "node:test";test("slow",async()=>{await new Promise(r=>setTimeout(r,5000));});\n', { timeoutMs: 100 });
  await assert.rejects(adapter.execute(job), /deadline/);
  const receipt = JSON.parse(fs.readFileSync(path.join(options.outputRoot, job.id, "execution.json")));
  assert.equal(receipt.stopReason, "deadline"); assert.equal(receipt.executionClosed, true); assert.notEqual(receipt.exitCode, 0);
});
test("output budget stops verbose process", async t => {
  const { adapter, job, options } = setup(t, 'import test from "node:test";test("verbose",()=>console.log("x".repeat(10000)));\n', { maxOutputBytes: 512 });
  await assert.rejects(adapter.execute(job), /output_limit/);
  assert.ok(fs.statSync(path.join(options.outputRoot, job.id, "stdout.tap")).size <= 512);
});
test("already aborted job is not launched", async t => {
  const { adapter, job, options } = setup(t); const ac = new AbortController(); ac.abort();
  await assert.rejects(adapter.execute(job, { signal: ac.signal }), /aborted_before_start/); assert.deepEqual(fs.readdirSync(options.outputRoot), []);
});
test("path traversal and nonmanifest test are rejected", t => {
  const { options, recipe } = setup(t);
  assert.throws(() => createValidationExecutor({ ...options, recipes: [{ ...recipe, tests: ["../../evil.test.mjs"] }] }), /unlisted_test/);
  assert.throws(() => createValidationExecutor({ ...options, recipes: [{ ...recipe, manifest: [{ file: "../reviewed.test.mjs", sha256: hash(passing) }], tests: ["../reviewed.test.mjs"] }] }), /invalid_manifest_path/);
});
test("linked source file is refused", t => {
  const { options, recipe } = setup(t); fs.renameSync(path.join(options.sourceRoot, "reviewed.test.mjs"), path.join(options.sourceRoot, "real.mjs"));
  fs.symlinkSync(path.join(options.sourceRoot, "real.mjs"), path.join(options.sourceRoot, "reviewed.test.mjs"));
  assert.throws(() => createValidationExecutor({ ...options, recipes: [recipe] }), /symlink_not_allowed/);
});
test("Node TAP text lacking totals is not evidence", () => assert.throws(() => readTapSummary("all passed"), /missing_test_summary/));
test("the real Factory controller can call the adapter and verifier", async t => {
  const { adapter, job, root } = setup(t);
  const grants = [{ source: "operator", jobId: job.id, fingerprint: job.fingerprint, kind: job.kind, scope: job.scope, expiresAt: new Date(Date.now() + 60000).toISOString() }];
  const [record] = await runAuthorizedBatch([job], { root: path.join(root, "ledger"), ...adapter, grants, timeoutMs: 10000 });
  assert.equal(record.status, "succeeded"); assert.equal(record.attempts, 1);
  assert.equal(record.verification.summary.pass, 1); assert.equal(record.checkinWindow.length, 2);
});
