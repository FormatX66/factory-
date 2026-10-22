import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";
import { readTapSummary } from "../../factory/validation-executor.mjs";

// A focused companion test gate, not an executor admission or promotion decision.
export const PILOT_TESTS = [
  "tests/unit/factory-claude-preflight.test.mjs",
  "tests/unit/factory-claude-completion.test.mjs",
];
export const PILOT_EXPECTED_TESTS = 42;
export const PILOT_SOURCES = [
  ".gitignore",
  ".claude/agents/factory-pilot-worker.md",
  ".claude/agents/factory-pilot-verifier.md",
  "AGENTS.md",
  "CLAUDE.md",
  "package.json",
  "package-lock.json",
  "factory/validation-executor.mjs",
  "scripts/ops/factory-claude-preflight.mjs",
  "scripts/check/factory-claude-completion.mjs",
  ...PILOT_TESTS,
];
const hash = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const json = (value) => JSON.stringify(value, null, 2) + "\n";
const loadedImplementations = [
  ["scripts/check/factory-claude-completion.mjs", fileURLToPath(import.meta.url)],
  [
    "factory/validation-executor.mjs",
    fileURLToPath(new URL("../../factory/validation-executor.mjs", import.meta.url)),
  ],
].map(([file, loaded]) => ({ file, sha256: hash(fs.readFileSync(loaded)) }));
const HASH = z.string().regex(/^[a-f0-9]{64}$/);
const HookInput = z.object({
  hook_event_name: z.enum(["Stop", "SubagentStop"]),
  cwd: z.string().min(1).max(4096).refine(path.isAbsolute),
  stop_hook_active: z.boolean().default(false),
});
const Receipt = z.object({
  schema: z.literal("factory.claude-pilot-tests.v1"),
  fingerprint: HASH,
  status: z.enum(["passed", "held"]),
  reason: z.string(),
  exitCode: z.number().int().nullable(),
  processError: z.string().nullable(),
  stdoutSha256: HASH,
  stderrSha256: HASH,
});

function requireCondition(condition, code) {
  if (!condition) throw new Error(code);
}

function readRegular(file, limit = 4194304) {
  const stat = fs.lstatSync(file);
  requireCondition(stat.isFile() && stat.size <= limit, "invalid_evidence_file");
  return fs.readFileSync(file);
}

export function snapshotPilot(root) {
  return PILOT_SOURCES.map((file) => {
    let current = root;
    for (const piece of file.split("/")) {
      current = path.join(current, piece);
      requireCondition(!fs.lstatSync(current).isSymbolicLink(), "symlink_source");
    }
    return { file, sha256: hash(readRegular(current)) };
  });
}

function git(root, args) {
  const env = { GIT_OPTIONAL_LOCKS: "0" };
  for (const key of [
    "PATH",
    "HOME",
    "USERPROFILE",
    "SystemRoot",
    "WINDIR",
    "TMPDIR",
    "TMP",
    "TEMP",
  ])
    if (process.env[key]) env[key] = process.env[key];
  const result = spawnSync(
    "git",
    ["--no-optional-locks", "-c", "core.fsmonitor=false", "-C", root, ...args],
    {
      env,
      encoding: "utf8",
      timeout: 5000,
      maxBuffer: 65536,
      shell: false,
      windowsHide: true,
    }
  );
  requireCondition(!result.error && result.status === 0, "git_observation_failed");
  return result.stdout.trim();
}

export function observeContext(cwd) {
  const root = fs.realpathSync(cwd);
  requireCondition(
    root === fs.realpathSync(git(root, ["rev-parse", "--show-toplevel"])),
    "worktree_root_required"
  );
  const gitDir = fs.realpathSync(git(root, ["rev-parse", "--absolute-git-dir"]));
  const common = fs.realpathSync(path.resolve(root, git(root, ["rev-parse", "--git-common-dir"])));
  const canonical = path.join(path.dirname(common), ".claude", "worktrees");
  const relative = path.relative(canonical, root);
  requireCondition(
    gitDir !== common &&
      relative &&
      !relative.startsWith("..") &&
      !path.isAbsolute(relative) &&
      !relative.includes(path.sep),
    "isolated_worktree_required"
  );
  const revision = git(root, ["rev-parse", "HEAD"]);
  requireCondition(/^[a-f0-9]{40,64}$/.test(revision), "invalid_revision");
  return {
    root,
    gitDir,
    commonDir: common,
    revision,
    runtime: process.version,
    nodeBinarySha256: hash(readRegular(process.execPath, 268435456)),
  };
}

function identity(context) {
  const sources = snapshotPilot(context.root);
  const fingerprint = hash(
    json({
      revision: context.revision,
      runtime: context.runtime,
      nodeBinarySha256: context.nodeBinarySha256,
      sources,
      tests: PILOT_TESTS,
      expectedTests: PILOT_EXPECTED_TESTS,
    })
  );
  return { fingerprint, sources };
}

export function assessTap(result) {
  if (result.error || result.status !== 0 || result.signal) return "test_process_failed";
  try {
    const summary = readTapSummary(result.stdout ?? "");
    if (
      PILOT_EXPECTED_TESTS < 1 ||
      summary.tests !== PILOT_EXPECTED_TESTS ||
      summary.pass !== PILOT_EXPECTED_TESTS ||
      summary.fail ||
      summary.cancelled ||
      summary.skipped ||
      summary.todo
    )
      return "test_acceptance_failed";
    return null;
  } catch {
    return "missing_test_summary";
  }
}

function evidenceParent(context) {
  return path.join(context.commonDir, "factory-claude-pilot", hash(context.root));
}

function evidenceDir(context, fingerprint) {
  return path.join(evidenceParent(context), fingerprint);
}

export function matchesLoadedImplementation(root) {
  return loadedImplementations.every(
    ({ file, sha256 }) => hash(readRegular(path.join(root, file))) === sha256
  );
}

export function checkPilotReceipt(context) {
  try {
    const current = identity(context);
    const dir = evidenceDir(context, current.fingerprint);
    requireCondition(
      !fs.lstatSync(path.dirname(path.dirname(dir))).isSymbolicLink(),
      "symlink_evidence"
    );
    requireCondition(!fs.lstatSync(path.dirname(dir)).isSymbolicLink(), "symlink_evidence");
    requireCondition(!fs.lstatSync(dir).isSymbolicLink(), "symlink_evidence");
    const receipt = Receipt.parse(JSON.parse(readRegular(path.join(dir, "receipt.json"), 65536)));
    const stdout = readRegular(path.join(dir, "stdout.tap"));
    const stderr = readRegular(path.join(dir, "stderr.txt"));
    requireCondition(
      receipt.fingerprint === current.fingerprint &&
        receipt.stdoutSha256 === hash(stdout) &&
        receipt.stderrSha256 === hash(stderr),
      "receipt_integrity_failed"
    );
    const reason = assessTap({
      status: receipt.exitCode,
      error: receipt.processError,
      stdout: stdout.toString("utf8"),
    });
    if (receipt.status !== "passed" || reason) return { status: "held", reason: receipt.reason };
    return {
      status: "passed",
      reason: "focused_tests_verified",
      fingerprint: current.fingerprint,
      expectedTests: PILOT_EXPECTED_TESTS,
      receipt: path.join(dir, "receipt.json"),
    };
  } catch {
    return { status: "held", reason: "current_receipt_missing_or_invalid" };
  }
}

function runFocusedTests(root) {
  const env = { LANG: "C.UTF-8", TZ: "UTC" };
  for (const key of ["PATH", "SystemRoot", "WINDIR", "TMPDIR", "TMP", "TEMP"])
    if (process.env[key]) env[key] = process.env[key];
  return spawnSync(process.execPath, ["--test", "--test-reporter=tap", "--", ...PILOT_TESTS], {
    cwd: root,
    env,
    shell: false,
    encoding: "utf8",
    timeout: 45000,
    killSignal: "SIGKILL",
    maxBuffer: 2097152,
    windowsHide: true,
  });
}

export function runPilotChecks(context, runner = runFocusedTests) {
  const current = identity(context);
  const store = path.join(context.commonDir, "factory-claude-pilot");
  fs.mkdirSync(store, { recursive: true, mode: 0o700 });
  requireCondition(!fs.lstatSync(store).isSymbolicLink(), "symlink_evidence");
  const parent = evidenceParent(context);
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  requireCondition(!fs.lstatSync(parent).isSymbolicLink(), "symlink_evidence");
  const dir = evidenceDir(context, current.fingerprint);
  try {
    fs.mkdirSync(dir, { mode: 0o700 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    return { ...checkPilotReceipt(context), reused: true, executionRepeated: false };
  }
  fs.writeFileSync(
    path.join(dir, "attempt.json"),
    json({
      schema: "factory.claude-pilot-attempt.v1",
      ...current,
      revision: context.revision,
      runtime: context.runtime,
      worktreeOwnerKey: hash(context.root),
      startedAt: new Date().toISOString(),
      command: [process.execPath, "--test", "--test-reporter=tap", "--", ...PILOT_TESTS],
      scope: "Reviewed companion tests only; no live host, provider or promotion qualification",
    }),
    { flag: "wx", mode: 0o600 }
  );
  let result;
  try {
    result = runner(context.root);
  } catch {
    result = { status: null, error: { code: "RUNNER_ERROR" } };
  }
  let reason = assessTap(result);
  try {
    if (identity(context).fingerprint !== current.fingerprint)
      reason = "source_changed_during_tests";
  } catch {
    reason = "source_changed_during_tests";
  }
  const stdout = String(result.stdout ?? ""),
    stderr = String(result.stderr ?? "");
  fs.writeFileSync(path.join(dir, "stdout.tap"), stdout, { flag: "wx", mode: 0o600 });
  fs.writeFileSync(path.join(dir, "stderr.txt"), stderr, { flag: "wx", mode: 0o600 });
  const receipt = {
    schema: "factory.claude-pilot-tests.v1",
    fingerprint: current.fingerprint,
    status: reason ? "held" : "passed",
    reason: reason ?? "focused_tests_verified",
    exitCode: Number.isInteger(result.status) ? result.status : null,
    processError: result.error
      ? "test_process_error"
      : result.signal
        ? "test_process_signal"
        : null,
    stdoutSha256: hash(stdout),
    stderrSha256: hash(stderr),
    completedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(dir, "receipt.json"), json(receipt), { flag: "wx", mode: 0o600 });
  return {
    status: receipt.status,
    reason: receipt.reason,
    fingerprint: current.fingerprint,
    expectedTests: PILOT_EXPECTED_TESTS,
    receipt: path.join(dir, "receipt.json"),
    executionRepeated: false,
  };
}

export function stopDecision(input, result) {
  const event = HookInput.parse(input);
  if (result.status === "passed") return {};
  const message =
    "Factory companion checks are HELD. Run node scripts/check/factory-claude-completion.mjs --run " +
    "once if no current attempt exists. Preserve failed or uncertain evidence; report the hold instead of " +
    "replaying an unchanged attempt or claiming completion. This gate covers only the companion tests.";
  // Give one corrective turn, then let the agent report the unresolved hold without an endless loop.
  return event.stop_hook_active
    ? { systemMessage: message }
    : { decision: "block", reason: message };
}

function readHookInput() {
  const buffer = Buffer.alloc(65537);
  let size = 0;
  while (size < buffer.length) {
    const read = fs.readSync(0, buffer, size, buffer.length - size, null);
    if (!read) break;
    size += read;
  }
  requireCondition(size <= 65536, "hook_input_too_large");
  return HookInput.parse(JSON.parse(buffer.subarray(0, size).toString("utf8")));
}

function main() {
  let hook = null;
  const hookInvocation = process.argv.length === 2;
  try {
    const args = z
      .array(z.enum(["--run", "--check"]))
      .max(1)
      .parse(process.argv.slice(2));
    if (!args.length) hook = readHookInput();
    const context = observeContext(hook?.cwd ?? process.cwd());
    requireCondition(matchesLoadedImplementation(context.root), "gate_version_mismatch");
    const result = args[0] === "--run" ? runPilotChecks(context) : checkPilotReceipt(context);
    process.stdout.write(json(hook ? stopDecision(hook, result) : result));
    process.exitCode = hook ? 0 : result.status === "passed" ? 0 : 1;
  } catch {
    process.stdout.write(
      json(
        hook
          ? stopDecision(hook, { status: "held" })
          : hookInvocation
            ? {
                continue: false,
                stopReason:
                  "Factory companion checks HELD: invalid hook input. Repair the hook configuration before continuing.",
              }
            : {
                status: "held",
                reason: "invalid_input_or_unavailable_worktree",
              }
      )
    );
    process.exitCode = hookInvocation ? 0 : 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  main();
