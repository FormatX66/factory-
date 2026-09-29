import http from "node:http";
import crypto from "node:crypto";
import { CommanderCore } from "./core.mjs";

export function createCommanderServer({ core, token, host = "127.0.0.1", port = 19470 }) {
  if (!token || token.length < 24) throw new Error("strong-token-required");
  const server = http.createServer(async (req, res) => {
    const send = (status, body) => {
      const data = JSON.stringify(body);
      res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(data) });
      res.end(data);
    };
    if (req.url === "/health" && req.method === "GET")
      return send(200, { ok: true, service: "aurum-commander", version: "0.2.0" });
    const supplied = req.headers.authorization?.replace(/^Bearer /, "") ?? "";
    const a = Buffer.from(supplied), b = Buffer.from(token);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return send(401, { ok: false, error: "unauthorized" });
    if (req.method !== "POST" || req.url !== "/v1/command") return send(404, { ok: false, error: "not-found" });
    let raw = "";
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > 1_000_000) return send(413, { ok: false, error: "body-too-large" });
    }
    try {
      const body = JSON.parse(raw || "{}");
      const operationId = body.operationId || CommanderCore.operationId();
      if (body.action === "read") return send(200, core.readFile(operationId, body.path));
      if (body.action === "write") return send(200, { receipt: core.writeFile(operationId, body.path, body.data ?? "") });
      if (body.action === "run") return send(200, await core.run(operationId, body.commandId, body.args ?? [], { timeoutMs: body.timeoutMs }));
      return send(400, { ok: false, error: "unsupported-action" });
    } catch (error) {
      return send(400, { ok: false, error: error.message });
    }
  });
  return {
    server,
    listen: () => new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, () => resolve(server.address()));
    }),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
