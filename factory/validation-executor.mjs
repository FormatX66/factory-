import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const HASH = /^[a-f0-9]{64}$/;
const digest = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const stringify = (value) => JSON.stringify(value, null, 2) + "\n";
function check(condition, code) { if (!condition) throw new Error(code); }
function within(root, relative) {
  check(typeof relative === "string" && relative.length > 0 && relative.length < 240 &&
    !relative.includes("\\") && !relative.includes(":"), "invalid_manifest_path");
  const pieces = relative.split("/");
  check(pieces.every(p => p && p !== "." && p !== ".."), "invalid_manifest_path");
  let current = root;
  for (const p of pieces) {
    current = path.join(current, p);
    check(!fs.lstatSync(current).isSymbolicLink(), "symlink_not_allowed");
  }
  check(fs.lstatSync(current).isFile(), "manifest_entry_not_file");
  return current;
}
function snapshot(root, manifest) {
  return manifest.map(({ file, sha256 }) => {
    check(HASH.test(sha256), "invalid_source_hash");
    const resolved = within(root, file), st = fs.statSync(resolved);
    check(st.size <= 1048576, "source_size_limit");
    const bytes = fs.readFileSync(resolved);
    check(digest(bytes) === sha256, "source_hash_mismatch");
    return { file, sha256, bytes };
  });
}
function sourceSummary(items) { return items.map(({ file, sha256 }) => ({ file, sha256 })); }
function cleanEnv(directory) {
  const env = { HOME: directory, USERPROFILE: directory, TMPDIR: directory, TMP: directory,
    TEMP: directory, LANG: "C.UTF-8", TZ: "UTC", PATH: path.dirname(process.execPath) };
  for (const key of ["SystemRoot", "WINDIR", "COMSPEC", "PATHEXT"])
    if (process.env[key]) env[key] = process.env[key];
  return env;
}
export function readTapSummary(text) {
  const fields = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/.exec(line);
    if (m) fields[m[1]] = Number(m[2]);
  }
  check(["tests", "pass", "fail", "cancelled", "skipped", "todo"].every(k => Number.isInteger(fields[k])),
    "missing_test_summary");
  return fields;
}

// Trusted, reviewed source recipes only. Not a sandbox for hostile code or a remote shell.
// This adds no live model permissions; the only launched program is this exact Node binary.
export function createValidationExecutor({ sourceRoot, outputRoot, recipes, timeoutMs = 15000,
  maxOutputBytes = 2097152 } = {}) {
  check(typeof sourceRoot === "string" && path.isAbsolute(sourceRoot) &&
    typeof outputRoot === "string" && path.isAbsolute(outputRoot), "absolute_roots_required");
  check(Number.isInteger(timeoutMs) && timeoutMs >= 10 && timeoutMs <= 120000 &&
    Number.isInteger(maxOutputBytes) && maxOutputBytes >= 128 && maxOutputBytes <= 4194304, "invalid_budgets");
  check(!fs.lstatSync(sourceRoot).isSymbolicLink(), "symlink_source_root");
  const source = fs.realpathSync(sourceRoot);
  fs.mkdirSync(outputRoot, { recursive: true, mode: 0o700 });
  check(!fs.lstatSync(outputRoot).isSymbolicLink(), "symlink_output_root");
  const output = fs.realpathSync(outputRoot);
  check(Array.isArray(recipes) && recipes.length > 0 && recipes.length <= 8, "invalid_recipes");
  const registered = new Map();
  for (const candidate of recipes) {
    const r = JSON.parse(JSON.stringify(candidate));
    check(ID.test(r.id) && !registered.has(r.id) && typeof r.revision === "string" && r.revision.length > 0,
      "invalid_recipe_identity");
    check(Array.isArray(r.manifest) && r.manifest.length > 0 && r.manifest.length <= 256 &&
      new Set(r.manifest.map(x => x.file)).size === r.manifest.length, "invalid_manifest");
    check(Array.isArray(r.tests) && r.tests.length > 0 && r.tests.length <= 32 &&
      r.tests.every(file => typeof file === "string" && file.endsWith(".test.mjs") &&
        r.manifest.some(x => x.file === file)), "unlisted_test_file");
    check(Number.isInteger(r.expectedTests) && r.expectedTests > 0, "expected_test_count_required");
    snapshot(source, r.manifest); registered.set(r.id, r);
  }
  function recipeFor(job) {
    check(job?.kind === "test", "validation_only_executor");
    check(typeof job.id === "string" && ID.test(job.id) && HASH.test(job.fingerprint), "invalid_job_identity");
    const r = registered.get(job.scope);
    check(r && job.revision === r.revision, "recipe_not_registered");
    return r;
  }
  async function execute(job, { signal } = {}) {
    const r = recipeFor(job);
    check(!signal?.aborted, "aborted_before_start");
    const sources = snapshot(source, r.manifest);
    const dir = path.join(output, job.id);
    fs.mkdirSync(dir, { mode: 0o700 }); // Exclusive: duplicate IDs never overwrite an attempt.
    const work = path.join(dir, "source"), temporary = path.join(dir, "tmp");
    fs.mkdirSync(work); fs.mkdirSync(temporary);
    for (const item of sources) {
      const target = path.join(work, item.file); fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, item.bytes, { flag: "wx", mode: 0o600 });
    }
    const stdoutPath = path.join(dir, "stdout.tap"), stderrPath = path.join(dir, "stderr.txt");
    const out = fs.openSync(stdoutPath, "wx", 0o600), err = fs.openSync(stderrPath, "wx", 0o600);
    const receipt = { schema: "factory.validation-execution.v1", jobFingerprint: job.fingerprint,
      recipe: r.id, revision: r.revision, expectedTests: r.expectedTests,
      sourceManifest: sourceSummary(sources), runtime: process.version, platform: process.platform,
      nodeBinarySha256: digest(fs.readFileSync(process.execPath)),
      executorId: "factory-reviewed-test-executor", startedAt: new Date().toISOString(),
      pid: null, exitCode: null, stopReason: null, nodeArguments: ["--test", "--test-reporter=tap", "--", ...r.tests] };
    const receiptFile = path.join(dir, "execution.json");
    fs.writeFileSync(receiptFile, stringify(receipt), { flag: "wx", mode: 0o600 });
    let size = 0, closed = false, timer, child, spawnError;
    const stop = (why) => {
      receipt.stopReason ??= why;
      if (closed || !child?.pid) return;
      try {
        if (process.platform !== "win32") process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch (e) { if (e.code !== "ESRCH") receipt.stopReason = "cancellation_unconfirmed"; }
    };
    const onAbort = () => stop("aborted");
    try {
      await new Promise(resolve => {
        child = spawn(process.execPath, receipt.nodeArguments, { cwd: work, env: cleanEnv(temporary),
          stdio: ["ignore", "pipe", "pipe"], shell: false, windowsHide: true,
          detached: process.platform !== "win32" });
        receipt.pid = child.pid ?? null;
        fs.writeFileSync(receiptFile, stringify(receipt));
        const consume = fd => bytes => {
          size += bytes.length;
          if (size > maxOutputBytes) { stop("output_limit"); return; }
          if (!closed) fs.writeSync(fd, bytes);
        };
        child.stdout.on("data", consume(out)); child.stderr.on("data", consume(err));
        child.once("error", () => { spawnError = true; receipt.stopReason = "spawn_failed"; });
        child.once("close", (code, terminationSignal) => {
          closed = true; receipt.exitCode = code; receipt.signal = terminationSignal ?? null; resolve();
        });
        timer = setTimeout(() => stop("deadline"), timeoutMs);
        signal?.addEventListener("abort", onAbort, { once: true });
        if (signal?.aborted) onAbort();
      });
    } finally {
      clearTimeout(timer); signal?.removeEventListener("abort", onAbort);
      fs.closeSync(out); fs.closeSync(err);
      receipt.completedAt = new Date().toISOString(); receipt.stdoutSha256 = digest(fs.readFileSync(stdoutPath));
      receipt.stderrSha256 = digest(fs.readFileSync(stderrPath));
      receipt.executionClosed = closed;
      fs.writeFileSync(receiptFile, stringify(receipt));
    }
    check(!spawnError && !receipt.stopReason && receipt.exitCode === 0, receipt.stopReason || "test_process_failed");
    snapshot(work, r.manifest); snapshot(source, r.manifest);
    return { jobFingerprint: job.fingerprint, executorId: receipt.executorId, exitCode: 0,
      artifactDigest: digest(fs.readFileSync(stdoutPath)), artifact: stdoutPath, receipt: receiptFile };
  }
  async function verify(job, result, { signal } = {}) {
    const r = recipeFor(job); check(!signal?.aborted, "verification_aborted");
    const dir = path.join(output, job.id);
    check(!fs.lstatSync(dir).isSymbolicLink(), "symlink_attempt_root");
    const expectedArtifact = path.join(dir, "stdout.tap"), expectedReceipt = path.join(dir, "execution.json");
    check(result.artifact === expectedArtifact && result.receipt === expectedReceipt, "unexpected_result_path");
    within(dir, "stdout.tap"); within(dir, "execution.json"); within(dir, "stderr.txt");
    const receipt = JSON.parse(fs.readFileSync(expectedReceipt, "utf8"));
    check(receipt.jobFingerprint === job.fingerprint && receipt.recipe === r.id &&
      receipt.exitCode === 0 && !receipt.stopReason && receipt.executionClosed === true,
      "invalid_execution_receipt");
    check(JSON.stringify(receipt.sourceManifest) === JSON.stringify(sourceSummary(snapshot(source, r.manifest))),
      "source_manifest_mismatch");
    snapshot(path.join(dir, "source"), r.manifest);
    const bytes = fs.readFileSync(expectedArtifact), actual = digest(bytes), summary = readTapSummary(bytes.toString("utf8"));
    check(actual === result.artifactDigest && actual === receipt.stdoutSha256 &&
      digest(fs.readFileSync(path.join(dir, "stderr.txt"))) === receipt.stderrSha256, "artifact_integrity_mismatch");
    check(summary.tests === r.expectedTests && summary.pass === r.expectedTests &&
      summary.fail === 0 && summary.cancelled === 0 && summary.skipped === 0 && summary.todo === 0,
      "test_acceptance_failed");
    const verified = { schema: "factory.validation-verification.v1", verifierId: "factory-test-artifact-readback",
      jobFingerprint: job.fingerprint, artifactDigest: actual, passed: true, summary,
      checkedAt: new Date().toISOString(), runtime: receipt.runtime,
      scope: "Pinned reviewed source tests; not live desktop or untrusted-code isolation" };
    fs.writeFileSync(path.join(dir, "verification.json"), stringify(verified), { flag: "wx", mode: 0o600 });
    return verified;
  }
  return Object.freeze({ execute, verify, capabilities: Object.freeze(["test"]) });
}
