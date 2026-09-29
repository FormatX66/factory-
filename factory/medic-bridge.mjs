import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createTask } from "./agent-core.mjs";

const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const CLASSIFICATIONS = new Set(["public", "synthetic", "private"]);
export class FactoryAdmissionError extends Error {
  constructor(code) { super(code); this.name = "FactoryAdmissionError"; this.code = code; }
}
const reject = (code) => { throw new FactoryAdmissionError(code); };
const fingerprint = (job) => crypto.createHash("sha256").update(JSON.stringify(job)).digest("hex");
function strings(value = []) {
  if (!Array.isArray(value) || value.length > 32 ||
      value.some((v) => typeof v !== "string" || v.length > 2048)) reject("invalid_requirements");
  return [...value];
}
export function normalizeMedicJob(input) {
  if (!input || Array.isArray(input) || typeof input !== "object") reject("invalid_job");
  const id = input.id ?? `medic-${crypto.randomUUID()}`;
  if (typeof id !== "string" || !ID.test(id)) reject("invalid_job_id");
  if (typeof input.goal !== "string" || !input.goal.trim() || input.goal.length > 16000)
    reject("invalid_goal");
  const classification = input.classification ?? "private";
  if (!CLASSIFICATIONS.has(classification)) reject("invalid_classification");
  if (input.needsTools !== undefined && typeof input.needsTools !== "boolean") reject("invalid_tool_flag");
  if (input.needsTools === true && input.mode === undefined) reject("explicit_execution_mode_required");
  const mode = input.mode ?? "proposal";
  if (!["proposal", "inspect", "build"].includes(mode)) reject("invalid_execution_mode");
  const checkinMinutes = input.checkinMinutes ?? [5, 10];
  if (!Array.isArray(checkinMinutes) || checkinMinutes.length !== 2 ||
      !checkinMinutes.every((n) => Number.isInteger(n) && n >= 1 && n <= 120) ||
      checkinMinutes[0] > checkinMinutes[1]) reject("invalid_checkin_window");
  const repo = input.repo ?? "medic-hub", lkg = input.lkg ?? "medic-intake";
  if (typeof repo !== "string" || !repo || repo.length > 256 ||
      typeof lkg !== "string" || !lkg || lkg.length > 256) reject("invalid_baseline");
  return { id, goal: input.goal.trim(), classification, mode,
    requirements: strings(input.requirements), constraints: strings(input.constraints),
    repo, lkg, needsTools: input.needsTools === true || mode === "inspect", checkinMinutes: [...checkinMinutes] };
}
export function checkMedicAdmission(job) {
  // Existing Codex is READ-ONLY; the free/local adapters also only return proposals.
  // Do not widen their permissions or send build requests to them as if they could edit.
  if (job.mode === "build") reject("build_executor_not_registered");
}
export async function dispatchMedicJob(raw, adapters = {}) {
  const job = normalizeMedicJob(raw); checkMedicAdmission(job);
  const task = createTask(job);
  const prompt = `Goal: ${job.goal}\nRequirements: ${job.requirements.join("; ")}\nConstraints: ${job.constraints.join("; ")}\nMode: ${job.mode}. Return a bounded analysis/proposal; no file edits or unverified execution claims.`;
  let result, route;
  if (!job.needsTools && ["public", "synthetic"].includes(job.classification)) {
    route = "free/opencode/space-bunny-free";
    const run = adapters.openCode ?? (await import("./opencode-worker.mjs")).runOpenCodeTask;
    result = await run(task, { prompt, classification: job.classification });
  } else {
    try {
      route = "subscription/codex";
      const run = adapters.codex ?? (await import("./codex-worker.mjs")).runCodexTask;
      result = await run(task, { prompt, cwd: process.cwd() });
    } catch (error) {
      if (job.needsTools) throw error;
      route = "local/qwen2.5-coder:7b";
      const run = adapters.local ?? (await import("./local-worker.mjs")).runLocalTask;
      result = await run(task, { prompt });
    }
  }
  if (!result?.task || result.task.id !== job.id || typeof result.output !== "string" ||
      !result.output.trim() || result.output.length > 1048576) reject("invalid_worker_response");
  return { schema: "medic.factory.result.v1", id: job.id, route, mode: job.mode,
    status: "review", executionVerified: false, output: result.output,
    task: { ...result.task, status: "review" } };
}
function safeDirectory(root, id, create = true) {
  if (typeof root !== "string" || !path.isAbsolute(root) || !ID.test(id)) reject("invalid_evidence_path");
  if (create) fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  if (fs.lstatSync(root).isSymbolicLink()) reject("unsafe_evidence_root");
  const dir = path.join(fs.realpathSync(root), id);
  if (fs.existsSync(dir) && (!fs.lstatSync(dir).isDirectory() || fs.lstatSync(dir).isSymbolicLink()))
    reject("unsafe_job_directory");
  return dir;
}
function atomicJson(file, value) {
  const tmp = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    const fd = fs.openSync(tmp, "wx", 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(value, null, 2) + "\n"); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    fs.renameSync(tmp, file);
  } finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
}
export function persistMedicResult(root, result) {
  const dir = safeDirectory(root, result.id); fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  atomicJson(path.join(dir, "task.json"), result.task);
  atomicJson(path.join(dir, "result.json"), result);
  return dir;
}
export async function runMedicJob(raw, { root, adapters = {}, now = Date.now } = {}) {
  const job = normalizeMedicJob(raw), dir = safeDirectory(root, job.id);
  // A reused ID is not a retry. Preserve its earlier evidence rather than overwrite it.
  try { fs.mkdirSync(dir, { mode: 0o700 }); }
  catch (error) { if (error.code === "EEXIST") reject("job_id_already_exists"); throw error; }
  const record = { schema: "factory.medic-attempt.v1", job, fingerprint: fingerprint(job),
    status: "accepted", acceptedAt: new Date(now()).toISOString(), events: [], executionVerified: false };
  const recordPath = path.join(dir, "attempt.json");
  const save = (status, reason) => {
    record.status = status; record.events.push({ status, reason, at: new Date(now()).toISOString() });
    atomicJson(recordPath, record);
  };
  save("accepted", "persisted_before_dispatch");
  try {
    checkMedicAdmission(job);
    record.checkinWindow = job.checkinMinutes.map((m) => new Date(now() + m * 60000).toISOString());
    save("running", "proposal_worker_started");
    const result = await dispatchMedicJob(job, adapters);
    persistMedicResult(root, result); save("review", "proposal_returned_not_build_completion");
    return { ...result, ok: true };
  } catch (error) {
    const reason = error instanceof FactoryAdmissionError ? error.code : "worker_failed";
    const status = error instanceof FactoryAdmissionError ? "held" : "failed";
    save(status, reason); // Never persist exception text that may contain provider credentials.
    return { ok: false, id: job.id, status, error: reason, executionVerified: false };
  }
}
