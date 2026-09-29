import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CommanderCore } from "../src/core.mjs";

function fixture(maxOutputBytes = 65536) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aurum-cmd-"));
  const workspace = path.join(root, "work");
  fs.mkdirSync(workspace);
  const evidenceFile = path.join(root, "evidence", "receipts.jsonl");
  const core = new CommanderCore({
    workspace, evidenceFile, maxOutputBytes,
    commands: {
      node: { executable: process.execPath, fixedArgs: [] },
    },
  });
  return { root, workspace, evidenceFile, core };
}

test("write/read stays inside workspace and emits receipts", () => {
  const f = fixture();
  f.core.writeFile("op-write", "a/b.txt", "hello");
  assert.equal(f.core.readFile("op-read", "a/b.txt").data, "hello");
  assert.equal(fs.readFileSync(f.evidenceFile, "utf8").trim().split(/\r?\n/).length, 2);
});
test("absolute and traversal paths fail closed", () => {
  const f = fixture();
  assert.throws(() => f.core.writeFile("x", "../escape.txt", "bad"), /outside/);
  assert.throws(() => f.core.readFile("x", path.resolve(f.root, "escape.txt")), /relative/);
  assert.equal(fs.existsSync(path.join(f.root, "escape.txt")), false);
});

test("unapproved command is rejected before execution", async () => {
  const f = fixture();
  await assert.rejects(() => f.core.run("x", "powershell", []), /not-allowed/);
});

test("approved command uses argv without shell interpolation", async () => {
  const f = fixture();
  const marker = path.join(f.root, "pwned.txt");
  const payload = `console.log(process.argv[1])`;
  const result = await f.core.run("run-argv", "node", ["-e", payload, `& echo bad > ${marker}`]);
  assert.equal(result.ok, true);
  assert.match(result.stdout, /& echo bad/);
  assert.equal(fs.existsSync(marker), false);
});
test("timeout terminates a long-running child and records timeout", async () => {
  const f = fixture();
  const result = await f.core.run("run-timeout", "node", ["-e", "setTimeout(()=>{},5000)"], { timeoutMs: 100 });
  assert.equal(result.ok, false);
  assert.equal(result.timedOut, true);
  assert.match(fs.readFileSync(f.evidenceFile, "utf8"), /"timedOut":true/);
});

test("output is bounded and reports truncation", async () => {
  const f = fixture(128);
  const result = await f.core.run("run-output", "node", ["-e", "process.stdout.write('x'.repeat(4096))"]);
  assert.equal(result.ok, true);
  assert.equal(result.truncated, true);
  assert.ok(Buffer.byteLength(result.stdout) <= 128);
});

test("append-only evidence survives core restart", () => {
  const f = fixture();
  f.core.writeFile("before", "one.txt", "1");
  const restarted = new CommanderCore({ workspace: f.workspace, evidenceFile: f.evidenceFile, commands: {} });
  restarted.writeFile("after", "two.txt", "2");
  const lines = fs.readFileSync(f.evidenceFile, "utf8").trim().split(/\r?\n/).map(JSON.parse);
  assert.deepEqual(lines.map(x => x.operationId), ["before", "after"]);
});
test("symlink escape is rejected when platform permits symlink creation", () => {
  const f = fixture();
  const outside = path.join(f.root, "outside.txt");
  fs.writeFileSync(outside, "secret");
  const link = path.join(f.workspace, "link.txt");
  try {
    fs.symlinkSync(outside, link, "file");
  } catch {
    return;
  }
  assert.throws(() => f.core.readFile("symlink", "link.txt"), /regular-file/);
});
