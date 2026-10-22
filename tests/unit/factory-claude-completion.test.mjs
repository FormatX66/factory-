import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  PILOT_EXPECTED_TESTS,
  PILOT_SOURCES,
  assessTap,
  checkPilotReceipt,
  matchesLoadedImplementation,
  observeContext,
  runPilotChecks,
  snapshotPilot,
  stopDecision,
} from "../../scripts/check/factory-claude-completion.mjs";

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "factory-pilot-gate-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const file of PILOT_SOURCES) {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, "reviewed fixture source\n");
  }
  const commonDir = path.join(root, "git-common-metadata");
  const gitDir = path.join(commonDir, "worktrees", "owned");
  fs.mkdirSync(gitDir, { recursive: true });
  return {
    root,
    gitDir,
    commonDir,
    revision: "a".repeat(40),
    runtime: process.version,
    nodeBinarySha256: "b".repeat(64),
  };
}

function passed() {
  return {
    status: 0,
    stdout:
      `TAP version 13\n# tests ${PILOT_EXPECTED_TESTS}\n` +
      `# pass ${PILOT_EXPECTED_TESTS}\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n`,
    stderr: "",
  };
}

test("missing receipts hold without starting tests", (t) => {
  assert.equal(checkPilotReceipt(fixture(t)).status, "held");
});

test("complete passing TAP is recorded and independently read back", (t) => {
  const context = fixture(t);
  const result = runPilotChecks(context, passed);
  assert.equal(result.status, "passed");
  assert.equal(checkPilotReceipt(context).status, "passed");
});

test("a zero exit with missing TAP never passes", () => {
  assert.equal(assessTap({ status: 0, stdout: "" }), "missing_test_summary");
});

test("a process error overrides even zero exit and passing-looking TAP", () => {
  assert.equal(assessTap({ ...passed(), error: { code: "EPERM" } }), "test_process_failed");
});

test("timeout or termination cannot pass on buffered output", () => {
  assert.equal(assessTap({ ...passed(), signal: "SIGKILL" }), "test_process_failed");
});

test("wrong test totals and skipped tests fail acceptance", () => {
  assert.equal(
    assessTap({ ...passed(), stdout: passed().stdout.replace("# skipped 0", "# skipped 1") }),
    "test_acceptance_failed"
  );
  assert.equal(
    assessTap({
      ...passed(),
      stdout: passed().stdout.replace(`# tests ${PILOT_EXPECTED_TESTS}`, "# tests 9999"),
    }),
    "test_acceptance_failed"
  );
});

test("source changes make an old passing receipt unavailable", (t) => {
  const context = fixture(t);
  runPilotChecks(context, passed);
  fs.appendFileSync(path.join(context.root, PILOT_SOURCES.at(-1)), "changed\n");
  assert.equal(checkPilotReceipt(context).status, "held");
});

test("source changes during execution hold even with passing TAP", (t) => {
  const context = fixture(t);
  const result = runPilotChecks(context, () => {
    fs.appendFileSync(path.join(context.root, PILOT_SOURCES.at(-1)), "changed\n");
    return passed();
  });
  assert.equal(result.status, "held");
  assert.equal(result.reason, "source_changed_during_tests");
});

test("tampered TAP cannot reuse a passing receipt", (t) => {
  const context = fixture(t);
  const result = runPilotChecks(context, passed);
  fs.appendFileSync(path.join(path.dirname(result.receipt), "stdout.tap"), "tampered\n");
  assert.equal(checkPilotReceipt(context).status, "held");
});

test("passing attempts reuse readback without executing again", (t) => {
  const context = fixture(t);
  let executions = 0;
  const runner = () => {
    executions++;
    return passed();
  };
  runPilotChecks(context, runner);
  const again = runPilotChecks(context, runner);
  assert.equal(again.status, "passed");
  assert.equal(again.reused, true);
  assert.equal(executions, 1);
});

test("failed attempts cannot replay unchanged", (t) => {
  const context = fixture(t);
  let executions = 0;
  const runner = () => {
    executions++;
    return { status: 1, stdout: "", stderr: "private error" };
  };
  runPilotChecks(context, runner);
  assert.equal(runPilotChecks(context, runner).status, "held");
  assert.equal(executions, 1);
});

test("incomplete attempts cannot replay unchanged", (t) => {
  const context = fixture(t);
  const result = runPilotChecks(context, passed);
  fs.unlinkSync(result.receipt);
  let executions = 0;
  assert.equal(
    runPilotChecks(context, () => {
      executions++;
      return passed();
    }).status,
    "held"
  );
  assert.equal(executions, 0);
});

test("runtime and revision changes invalidate old receipts", (t) => {
  const context = fixture(t);
  runPilotChecks(context, passed);
  assert.equal(checkPilotReceipt({ ...context, revision: "c".repeat(40) }).status, "held");
  assert.equal(checkPilotReceipt({ ...context, nodeBinarySha256: "d".repeat(64) }).status, "held");
});

test("public results never echo private process error or stderr", (t) => {
  const context = fixture(t);
  const result = runPilotChecks(context, () => ({
    status: 0,
    stdout: "",
    stderr: "private-credential-value",
    error: { message: "private-account-value" },
  }));
  const publicOutput = JSON.stringify({
    result,
    check: checkPilotReceipt(context),
    receipt: JSON.parse(fs.readFileSync(result.receipt, "utf8")),
  });
  assert.doesNotMatch(publicOutput, /private-credential-value|private-account-value/);
});

test("symlinked evidence or sources are rejected", (t) => {
  const context = fixture(t);
  const result = runPilotChecks(context, passed);
  const receiptDir = path.dirname(result.receipt);
  fs.renameSync(receiptDir, receiptDir + "-moved");
  fs.symlinkSync(receiptDir + "-moved", receiptDir, "dir");
  assert.equal(checkPilotReceipt(context).status, "held");
  const source = path.join(context.root, PILOT_SOURCES.at(-1));
  fs.renameSync(source, source + "-moved");
  fs.symlinkSync(source + "-moved", source);
  assert.throws(() => snapshotPilot(context.root), /symlink_source/);
});

test("Stop blocks once then permits an explicit unresolved hold report", () => {
  const input = {
    hook_event_name: "SubagentStop",
    cwd: path.resolve("."),
    stop_hook_active: false,
  };
  assert.equal(stopDecision(input, { status: "held" }).decision, "block");
  const repeated = stopDecision({ ...input, stop_hook_active: true }, { status: "held" });
  assert.equal(repeated.decision, undefined);
  assert.match(repeated.systemMessage, /HELD/);
  assert.deepEqual(stopDecision(input, { status: "passed" }), {});
  assert.throws(() => stopDecision({ ...input, cwd: "relative" }, { status: "passed" }));
});

test("evidence survives removal of per-worktree Git metadata", (t) => {
  const context = fixture(t);
  const result = runPilotChecks(context, passed);
  fs.rmSync(context.gitDir, { recursive: true });
  assert.equal(fs.existsSync(result.receipt), true);
  assert.equal(checkPilotReceipt(context).status, "passed");
});

test("independent worktrees cannot borrow each other's passing receipts", (t) => {
  const worker = fixture(t),
    verifier = { ...fixture(t), commonDir: worker.commonDir };
  runPilotChecks(worker, passed);
  assert.equal(checkPilotReceipt(verifier).status, "held");
});

test("a parent hook cannot accept a different candidate gate or TAP parser", (t) => {
  const context = fixture(t);
  assert.equal(matchesLoadedImplementation(context.root), false);
  for (const [file, relative] of [
    [
      "scripts/check/factory-claude-completion.mjs",
      "../../scripts/check/factory-claude-completion.mjs",
    ],
    ["factory/validation-executor.mjs", "../../factory/validation-executor.mjs"],
  ])
    fs.copyFileSync(
      fileURLToPath(new URL(relative, import.meta.url)),
      path.join(context.root, file)
    );
  assert.equal(matchesLoadedImplementation(context.root), true);
  fs.appendFileSync(
    path.join(context.root, "factory/validation-executor.mjs"),
    "\n// changed parser\n"
  );
  assert.equal(matchesLoadedImplementation(context.root), false);
});

test("malformed and oversized hook inputs end with an explicit hold, without a continuation loop", () => {
  const script = fileURLToPath(
    new URL("../../scripts/check/factory-claude-completion.mjs", import.meta.url)
  );
  for (const input of [
    "{",
    JSON.stringify({ hook_event_name: "Stop", cwd: "relative", stop_hook_active: true }),
    "x".repeat(65537),
  ]) {
    const result = spawnSync(process.execPath, [script], {
      input,
      encoding: "utf8",
      timeout: 5000,
      maxBuffer: 65536,
      shell: false,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0);
    const decision = JSON.parse(result.stdout);
    assert.equal(decision.continue, false);
    assert.equal(decision.decision, undefined);
    assert.match(decision.stopReason, /HELD/);
  }
});

test("Git overrides cannot redirect completion evidence to a different checkout", (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "factory-pilot-git-"));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const repo = path.join(temp, "repo"),
    root = path.join(repo, ".claude", "worktrees", "owned");
  const invoke = (args) => {
    const result = spawnSync("git", args, { encoding: "utf8", timeout: 5000, shell: false });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
  };
  invoke(["init", "--quiet", "-b", "main", repo]);
  invoke([
    "-C",
    repo,
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "--quiet",
    "--allow-empty",
    "-m",
    "fixture",
  ]);
  invoke(["-C", repo, "worktree", "add", "--quiet", "-b", "test/pilot", root]);
  const oldDir = process.env.GIT_DIR,
    oldTree = process.env.GIT_WORK_TREE;
  try {
    process.env.GIT_DIR = path.join(repo, ".git");
    process.env.GIT_WORK_TREE = repo;
    assert.equal(observeContext(root).root, fs.realpathSync(root));
  } finally {
    if (oldDir === undefined) delete process.env.GIT_DIR;
    else process.env.GIT_DIR = oldDir;
    if (oldTree === undefined) delete process.env.GIT_WORK_TREE;
    else process.env.GIT_WORK_TREE = oldTree;
  }
});
