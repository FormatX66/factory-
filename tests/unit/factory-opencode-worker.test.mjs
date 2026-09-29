import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  FREE_MODELS,
  openCodeEnvironment,
  parseOpenCodeEvents,
  runOpenCodePrompt,
} from "../../factory/opencode-worker.mjs";
import { chooseWorker, collectOpenCodeWorkers } from "../../factory/worker-pool.mjs";
const root = path.join(os.tmpdir(), "factory-opencode-test");
const stream = (text = "OK", cost = 0) =>
  [
    { type: "text", part: { text } },
    { type: "step_finish", sessionID: "test", part: { reason: "stop", cost } },
  ]
    .map((value) => JSON.stringify(value))
    .join("\n");
test("official-client config denies all tools and disables sharing", () => {
  const env = openCodeEnvironment(root, FREE_MODELS[0], {
    PATH: "safe",
    OPENCODE_API_KEY: "not-a-real-key",
    OPENAI_API_KEY: "not-a-real-key",
    HOME: "old",
  });
  const cfg = JSON.parse(env.OPENCODE_CONFIG_CONTENT);
  assert.equal(env.OPENCODE_API_KEY, undefined);
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.notEqual(env.HOME, "old");
  assert.equal(cfg.permission["*"], "deny");
  assert.equal(cfg.agent.factory.permission["*"], "deny");
  assert.equal(cfg.share, "disabled");
  assert.equal(cfg.small_model, FREE_MODELS[0]);
  assert.deepEqual(cfg.enabled_providers, ["opencode"]);
});
test("paid model cannot enter the isolated free worker", () => {
  assert.throws(() => openCodeEnvironment(root, "opencode/paid-model"));
});
test("complete zero-cost response is parsed without reasoning blocks", () => {
  assert.equal(parseOpenCodeEvents(stream()).output, "OK");
  assert.equal(parseOpenCodeEvents(stream()).reportedCost, 0);
});
test("nonzero, missing, or incomplete cost evidence is rejected", () => {
  assert.throws(() => parseOpenCodeEvents(stream("OK", 0.1)));
  assert.throws(() => parseOpenCodeEvents('{"type":"text","part":{"text":"OK"}}'));
});
test("upstream error is not accepted because the CLI exits zero", () => {
  assert.throws(() => parseOpenCodeEvents(stream() + '\n{"type":"error"}'));
});
test("tool invocation invalidates an analysis-only completion", () => {
  assert.throws(() => parseOpenCodeEvents(stream() + '\n{"type":"tool_use"}'));
});
test("sensitive or unclassified prompts are rejected before process start", async () => {
  await assert.rejects(runOpenCodePrompt("example", { classification: "private" }));
  await assert.rejects(runOpenCodePrompt("example"));
});
test("two OpenCode models retain the same quota-group identity", async () => {
  const workers = await collectOpenCodeWorkers(FREE_MODELS, {}, async () => ({
    ok: true,
    reportedCost: 0,
  }));
  assert.equal(new Set(workers.map((w) => w.provider)).size, 1);
  assert.equal(new Set(workers.map((w) => w.quotaGroup)).size, 1);
  assert.equal(
    workers.every((w) => w.tools === false),
    true
  );
});
test("private task never selects a free trial worker", async () => {
  const workers = await collectOpenCodeWorkers([FREE_MODELS[0]], {}, async () => ({
    ok: true,
    reportedCost: 0,
  }));
  assert.equal(chooseWorker(workers, { classification: "private" }), null);
  assert.ok(chooseWorker(workers, { classification: "public" }));
});
test("worker prompt cannot become a CLI flag", async () => {
  const { EventEmitter } = await import("node:events");
  const { PassThrough } = await import("node:stream");
  const fs = await import("node:fs");
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "factory-opencode-"));
  try {
    const spawnImpl = (_exe, args, options) => {
      assert.equal(args.at(-2), "--");
      assert.equal(args.at(-1), "--file=private.txt");
      assert.equal(options.shell, false);
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.kill = () => {};
      queueMicrotask(() => {
        child.stdout.end(stream());
        child.emit("close", 0);
      });
      return child;
    };
    const result = await runOpenCodePrompt("--file=private.txt", {
      classification: "synthetic",
      executable: process.execPath,
      stateRoot,
      spawnImpl,
    });
    assert.equal(result.output, "OK");
  } finally {
    fs.rmSync(stateRoot, { recursive: true, force: true });
  }
});
test("timeout stops only the newly spawned worker", async () => {
  const { EventEmitter } = await import("node:events");
  const { PassThrough } = await import("node:stream");
  const fs = await import("node:fs");
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "factory-opencode-"));
  let killed = false;
  const spawnImpl = () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {
      killed = true;
      child.emit("close", 1);
    };
    return child;
  };
  try {
    await assert.rejects(
      runOpenCodePrompt("canary", {
        classification: "synthetic",
        executable: process.execPath,
        stateRoot,
        spawnImpl,
        timeoutMs: 10,
      }),
      /timed out/
    );
    assert.equal(killed, true);
  } finally {
    fs.rmSync(stateRoot, { recursive: true, force: true });
  }
});
test("public tasks select proven free compute before local fallback", async () => {
  const free = await collectOpenCodeWorkers([FREE_MODELS[0]], {}, async () => ({
    ok: true,
    reportedCost: 0,
  }));
  const local = {
    id: "local",
    healthy: true,
    held: false,
    tools: false,
    reasoning: true,
    tier: 2,
    context: 32000,
  };
  const offline = {
    id: "subscription",
    healthy: false,
    held: true,
    tools: true,
    reasoning: true,
    tier: 0,
    context: 400000,
  };
  const workers = [offline, ...free, local];
  assert.equal(
    chooseWorker(workers, { reasoning: true, classification: "public" }).provider,
    "opencode"
  );
  assert.equal(chooseWorker(workers, { reasoning: true, classification: "private" }).id, "local");
  assert.equal(chooseWorker(workers, { tools: true, classification: "public" }), null);
});
test("duplicate model entries do not cause duplicate probes", async () => {
  let calls = 0;
  const workers = await collectOpenCodeWorkers([FREE_MODELS[0], FREE_MODELS[0]], {}, async () => {
    calls += 1;
    return { ok: true, reportedCost: 0 };
  });
  assert.equal(calls, 1);
  assert.equal(workers.length, 1);
});
