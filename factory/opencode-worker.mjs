import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkpoint } from "./agent-core.mjs";
export const FREE_MODELS = ["opencode/space-bunny-free", "opencode/longcat-2.5-preview-free"];
const KEEP_ENV = new Set([
  "SYSTEMROOT",
  "WINDIR",
  "SYSTEMDRIVE",
  "COMSPEC",
  "PATHEXT",
  "PATH",
  "TEMP",
  "TMP",
  "PROGRAMFILES",
  "PROGRAMFILES(X86)",
  "PROGRAMDATA",
  "OS",
  "NUMBER_OF_PROCESSORS",
  "PROCESSOR_ARCHITECTURE",
]);
export function defaultOpenCodeOptions() {
  const root = path.join(os.homedir(), "FactoryTools", "opencode");
  return {
    executable: path.join(root, "node_modules", "opencode-ai", "bin", "opencode.exe"),
    stateRoot: path.join(root, "sandbox"),
  };
}
export function openCodeEnvironment(stateRoot, model, inherited = process.env) {
  if (!path.isAbsolute(stateRoot) || !FREE_MODELS.includes(model))
    throw new Error("Invalid isolated worker configuration");
  const env = Object.fromEntries(
    Object.entries(inherited).filter(([key]) => KEEP_ENV.has(key.toUpperCase()))
  );
  const home = path.join(stateRoot, "home");
  Object.assign(env, {
    HOME: home,
    USERPROFILE: home,
    APPDATA: path.join(home, "AppData", "Roaming"),
    LOCALAPPDATA: path.join(home, "AppData", "Local"),
    XDG_CONFIG_HOME: path.join(stateRoot, "config"),
    XDG_DATA_HOME: path.join(stateRoot, "data"),
    XDG_STATE_HOME: path.join(stateRoot, "state"),
    XDG_CACHE_HOME: path.join(stateRoot, "cache"),
    OPENCODE_CONFIG_DIR: path.join(stateRoot, "config", "opencode"),
    OPENCODE_DISABLE_AUTOUPDATE: "true",
    OPENCODE_DISABLE_CLAUDE_CODE: "true",
    OPENCODE_DISABLE_DEFAULT_PLUGINS: "true",
    OPENCODE_DISABLE_LSP_DOWNLOAD: "true",
    OPENCODE_PERMISSION: JSON.stringify({ "*": "deny" }),
  });
  env.OPENCODE_CONFIG_CONTENT = JSON.stringify({
    enabled_providers: ["opencode"],
    model,
    small_model: model,
    share: "disabled",
    autoupdate: false,
    snapshot: false,
    permission: { "*": "deny" },
    mcp: {},
    plugin: [],
    default_agent: "factory",
    provider: { opencode: { whitelist: FREE_MODELS.map((id) => id.slice(9)) } },
    agent: {
      factory: {
        mode: "primary",
        description: "Bounded Factory analysis worker",
        steps: 2,
        permission: { "*": "deny" },
        prompt:
          "Answer only the supplied task. Do not read or change files, run commands, use tools, or claim to have done so.",
      },
    },
  });
  return env;
}
export function parseOpenCodeEvents(stdout) {
  if (stdout.length > 1048576) throw new Error("Worker output exceeded budget");
  const events = stdout
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
  if (events.some((e) => e.type === "error"))
    throw new Error("OpenCode reported an upstream error");
  if (events.some((e) => e.type === "tool_use" || e.part?.type === "tool"))
    throw new Error("Unexpected worker tool invocation");
  const finished = events.filter((e) => e.type === "step_finish");
  if (!finished.length || finished.some((e) => e.part?.reason !== "stop" || e.part?.cost !== 0)) {
    throw new Error("Missing completion or nonzero/unknown reported cost");
  }
  const output = events
    .filter((e) => e.type === "text")
    .map((e) => e.part?.text ?? "")
    .join("")
    .trim();
  if (!output) throw new Error("Worker returned no text");
  return { output, reportedCost: 0, sessionId: finished[0].sessionID ?? null, tools: false };
}
export async function runOpenCodePrompt(prompt, options = {}) {
  const {
    executable,
    stateRoot,
    model = FREE_MODELS[0],
    classification,
    timeoutMs = 90000,
    spawnImpl = spawn,
  } = { ...defaultOpenCodeOptions(), ...options };
  if (!["public", "synthetic"].includes(classification))
    throw new Error("Free worker requires explicitly non-sensitive input");
  if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 16000)
    throw new Error("Prompt budget exceeded or empty");
  if (!path.isAbsolute(executable) || !fs.existsSync(executable))
    throw new Error("Pinned OpenCode client is not installed");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000)
    throw new Error("Invalid worker timeout");
  const env = openCodeEnvironment(stateRoot, model);
  const cwd = path.join(stateRoot, "work");
  for (const dir of [
    cwd,
    env.HOME,
    env.XDG_CONFIG_HOME,
    env.XDG_DATA_HOME,
    env.XDG_STATE_HOME,
    env.XDG_CACHE_HOME,
    env.OPENCODE_CONFIG_DIR,
  ])
    fs.mkdirSync(dir, { recursive: true });
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const args = [
      "--pure",
      "run",
      "--format",
      "json",
      "--model",
      model,
      "--agent",
      "factory",
      "--title",
      "Factory bounded worker",
      "--",
      prompt,
    ];
    const child = spawnImpl(executable, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: false,
    });
    let output = "",
      bytes = 0,
      settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      error ? reject(error) : resolve(result);
    };
    const timer = setTimeout(() => {
      finish(new Error("OpenCode worker timed out"));
      child.kill();
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    const budget = (chunk) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > 1048576) {
        finish(new Error("Worker output exceeded budget"));
        child.kill();
        return false;
      }
      return true;
    };
    child.stdout.on("data", (chunk) => {
      if (budget(chunk)) output += chunk;
    });
    child.stderr.on("data", budget);
    child.once("error", () => finish(new Error("Could not start official OpenCode client")));
    child.once("close", (code) => {
      if (settled) return;
      if (code !== 0) return finish(new Error(`OpenCode client exited ${code}`));
      try {
        finish(null, {
          ...parseOpenCodeEvents(output),
          model,
          provider: "opencode",
          transport: "official-opencode-cli",
          checkedAt: new Date().toISOString(),
          latencyMs: Date.now() - started,
        });
      } catch (error) {
        finish(error);
      }
    });
  });
}
export async function probeOpenCode(options = {}) {
  const nonce = "FACTORY_OPEN_" + crypto.randomBytes(6).toString("hex").toUpperCase();
  try {
    const result = await runOpenCodePrompt(`Reply exactly ${nonce}. No tools.`, {
      ...options,
      classification: "synthetic",
    });
    return { ...result, ok: result.output === nonce, status: 200, expected: nonce };
  } catch (error) {
    return {
      ok: false,
      status: 503,
      model: options.model ?? FREE_MODELS[0],
      provider: "opencode",
      tools: false,
      checkedAt: new Date().toISOString(),
      reason: error.message,
    };
  }
}
export async function runOpenCodeTask(task, options = {}) {
  const result = await runOpenCodePrompt(options.prompt, options);
  return {
    output: result.output,
    task: checkpoint(
      { ...task, worker: `free/${result.model}`, status: "review" },
      {
        event: "opencode-worker-proposal",
        model: result.model,
        reportedCost: result.reportedCost,
        output: result.output,
      }
    ),
  };
}
