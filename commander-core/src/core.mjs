import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import crypto from "node:crypto";

const SAFE_ENV = ["SYSTEMROOT", "WINDIR", "COMSPEC", "PATH", "PATHEXT", "TEMP", "TMP"];

export class CommanderCore {
  constructor({ workspace, evidenceFile, commands = {}, maxOutputBytes = 65536 }) {
    this.workspace = fs.realpathSync(workspace);
    this.evidenceFile = path.resolve(evidenceFile);
    this.commands = commands;
    this.maxOutputBytes = maxOutputBytes;
    fs.mkdirSync(path.dirname(this.evidenceFile), { recursive: true });
  }

  resolve(relative) {
    if (typeof relative !== "string" || !relative || path.isAbsolute(relative))
      throw new Error("path-not-relative");
    const target = path.resolve(this.workspace, relative);
    const rel = path.relative(this.workspace, target);
    if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("path-outside-workspace");
    return target;
  }
  receipt(operationId, action, fields) {
    const record = {
      schema: "aurum.commander.receipt.v1",
      operationId, action, at: new Date().toISOString(), ...fields,
    };
    const fd = fs.openSync(this.evidenceFile, "a");
    try {
      fs.writeSync(fd, JSON.stringify(record) + "\n", null, "utf8");
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    return record;
  }

  readFile(operationId, relative) {
    const target = this.resolve(relative);
    const stat = fs.lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("not-regular-file");
    const data = fs.readFileSync(target, "utf8");
    return { data, receipt: this.receipt(operationId, "read", { ok: true, path: relative }) };
  }

  writeFile(operationId, relative, data) {
    const target = this.resolve(relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, String(data), { encoding: "utf8", flag: "w" });
    return this.receipt(operationId, "write", { ok: true, path: relative, bytes: Buffer.byteLength(String(data)) });
  }
  async run(operationId, commandId, args = [], { timeoutMs = 5000 } = {}) {
    const spec = this.commands[commandId];
    if (!spec) throw new Error("command-not-allowed");
    if (!Array.isArray(args) || args.some((v) => typeof v !== "string")) throw new Error("invalid-args");
    const env = Object.fromEntries(SAFE_ENV.flatMap((k) => process.env[k] ? [[k, process.env[k]]] : []));
    const startedAt = new Date().toISOString();
    const child = spawn(spec.executable, [...(spec.fixedArgs ?? []), ...args], {
      cwd: this.workspace, env, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    let stdout = "", stderr = "", bytes = 0, timedOut = false, truncated = false;
    const capture = (kind, chunk) => {
      const text = String(chunk);
      const room = Math.max(0, this.maxOutputBytes - bytes);
      const piece = Buffer.from(text).subarray(0, room).toString();
      bytes += Buffer.byteLength(piece);
      if (kind === "stdout") stdout += piece; else stderr += piece;
      if (Buffer.byteLength(text) > room) truncated = true;
    };
    child.stdout.on("data", (c) => capture("stdout", c));
    child.stderr.on("data", (c) => capture("stderr", c));
    const timer = setTimeout(() => {
      timedOut = true;
      if (process.platform === "win32") {
        spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
          windowsHide: true, shell: false, stdio: "ignore",
        });
      } else {
        try { process.kill(-child.pid, "SIGKILL"); } catch {}
      }
    }, timeoutMs);
    const exitCode = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    }).finally(() => clearTimeout(timer));
    const ok = exitCode === 0 && !timedOut;
    const receipt = this.receipt(operationId, "run", {
      ok, commandId, exitCode, timedOut, truncated, bytes,
      startedAt, finishedAt: new Date().toISOString(),
    });
    return { ok, exitCode, timedOut, truncated, stdout, stderr, receipt };
  }

  static operationId() { return crypto.randomUUID(); }
}
