import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CommanderCore } from "../src/core.mjs";
import { createCommanderServer } from "../src/server.mjs";

async function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aurum-http-"));
  const workspace = path.join(root, "work"); fs.mkdirSync(workspace);
  const token = "test-token-0123456789-abcdef";
  const core = new CommanderCore({
    workspace, evidenceFile: path.join(root, "receipts.jsonl"),
    commands: { node: { executable: process.execPath } },
  });
  const svc = createCommanderServer({ core, token, port: 0 });
  const address = await svc.listen();
  return { root, workspace, token, svc, url: `http://127.0.0.1:${address.port}` };
}

test("health is loopback service metadata", async () => {
  const f = await fixture();
  try { assert.equal((await fetch(f.url + "/health")).status, 200); }
  finally { await f.svc.close(); }
});
test("command endpoint requires bearer token", async () => {
  const f = await fixture();
  try {
    const res = await fetch(f.url + "/v1/command", { method: "POST", body: "{}" });
    assert.equal(res.status, 401);
  } finally { await f.svc.close(); }
});

test("authenticated write then read works", async () => {
  const f = await fixture();
  const call = (body) => fetch(f.url + "/v1/command", {
    method: "POST",
    headers: { authorization: `Bearer ${f.token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  try {
    assert.equal((await call({ action:"write", path:"dogfood.txt", data:"factory" })).status, 200);
    const read = await (await call({ action:"read", path:"dogfood.txt" })).json();
    assert.equal(read.data, "factory");
  } finally { await f.svc.close(); }
});
