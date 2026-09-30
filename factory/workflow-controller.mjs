import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const HASH = /^[a-f0-9]{64}$/;
const terminal = new Set(["succeeded", "failed", "held"]);
const sha = (value) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const clone = (value) => JSON.parse(JSON.stringify(value));

// These are workflow preferences, never substitutes for exact operator grants.
export const EXECUTION_POLICY = Object.freeze({
  schema: "factory.execution-policy.v1",
  independentLanesContinue: true,
  requireExactGrant: true,
  requireSeparateVerifier: true,
  requireCheckinWindow: true,
  automaticPromotion: false,
  automaticRetry: false,
  createsSchedules: false,
});

export function normalizeJob(input) {
  if (!input || Array.isArray(input) || typeof input !== "object") throw new Error("invalid_job");
  const { id, goal, kind, scope, revision, classification, dependencies = [], checkinMinutes } = input;
  if (typeof id !== "string" || !ID.test(id) || typeof goal !== "string" || !goal.trim() || goal.length > 16000)
    throw new Error("invalid_job_identity");
  if (!["proposal", "build", "test"].includes(kind) || typeof scope !== "string" || !scope ||
      typeof revision !== "string" || !revision || !["private", "public", "synthetic"].includes(classification))
    throw new Error("invalid_job_scope");
  if (!Array.isArray(dependencies) || dependencies.length > 32 ||
      dependencies.some((id) => typeof id !== "string" || !ID.test(id))) throw new Error("invalid_dependencies");
  if (!Array.isArray(checkinMinutes) || checkinMinutes.length !== 2 ||
      !checkinMinutes.every((n) => Number.isInteger(n) && n >= 1 && n <= 120) ||
      checkinMinutes[0] > checkinMinutes[1]) throw new Error("checkin_window_required");
  const job = { id, goal, kind, scope, revision, classification,
    dependencies: [...new Set(dependencies)].sort(), checkinMinutes: [...checkinMinutes] };
  return { ...job, fingerprint: sha(job) };
}

export function executionDecision(job, grants, capabilities, now = Date.now()) {
  const grant = grants.find((g) => g.source === "operator" && g.jobId === job.id &&
    g.fingerprint === job.fingerprint && g.kind === job.kind && g.scope === job.scope &&
    Number.isFinite(Date.parse(g.expiresAt)) && Date.parse(g.expiresAt) > now);
  if (!grant) return { action: "hold", reason: "missing_exact_authorization" };
  if (!capabilities.includes(job.kind)) return { action: "hold", reason: "executor_not_available" };
  return { action: "execute", reason: "authorized_and_capable" };
}

function validateGraph(jobs) {
  const byId = new Map(jobs.map((j) => [j.id, j]));
  if (byId.size !== jobs.length) throw new Error("duplicate_job_id");
  const done = new Set(), visiting = new Set();
  function visit(id) {
    if (done.has(id)) return;
    if (visiting.has(id)) throw new Error("dependency_cycle");
    const job = byId.get(id);
    if (!job) throw new Error("missing_dependency");
    visiting.add(id); job.dependencies.forEach(visit); visiting.delete(id); done.add(id);
  }
  jobs.forEach((j) => visit(j.id));
}

function safeRecordFile(root, id) {
  const file = path.join(root, `${id}.json`);
  if (fs.existsSync(file) && (!fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink()))
    throw new Error("unsafe_state_file");
  return file;
}

function atomicRecord(file, record) {
  const temp = file + "." + crypto.randomUUID() + ".tmp";
  try {
    const fd = fs.openSync(temp, "wx", 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(record, null, 2) + "\n"); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    fs.renameSync(temp, file);
  } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}

// One bounded foreground pass inside Factory. No daemon, shell, model, or network is created here.
// execute/verify are trusted host adapters, not supplied in job JSON or by a model.
export async function runAuthorizedBatch(rawJobs, options) {
  const { root, execute, verify, grants = [], capabilities = [], concurrency = 2,
    timeoutMs = 30000, now = Date.now } = options;
  if (!Array.isArray(rawJobs) || rawJobs.length < 1 || rawJobs.length > 32 ||
      !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4 ||
      !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300000 ||
      typeof execute !== "function" || typeof verify !== "function" || execute === verify ||
      typeof now !== "function" || !Array.isArray(grants) || !Array.isArray(capabilities) ||
      typeof root !== "string" || !path.isAbsolute(root)) throw new Error("invalid_controller_options");
  const jobs = rawJobs.map(normalizeJob); validateGraph(jobs);
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  if (fs.lstatSync(root).isSymbolicLink()) throw new Error("unsafe_state_root");
  const realRoot = fs.realpathSync(root);
  const lockPath = path.join(realRoot, ".controller.lock");
  const lock = fs.openSync(lockPath, "wx", 0o600); // Concurrent or crash-held ownership is never stolen.
  const records = new Map();
  let cancellationUnconfirmed = false;
  const save = (record) => atomicRecord(safeRecordFile(realRoot, record.job.id), record);
  const update = (record, status, reason) => {
    record.status = status; record.reason = reason;
    record.events.push({ status, reason, at: new Date(now()).toISOString() }); save(record);
  };
  try {
    // Validate all existing records before changing any of them.
    for (const job of jobs) {
      const file = safeRecordFile(realRoot, job.id);
      if (!fs.existsSync(file)) continue;
      const record = JSON.parse(fs.readFileSync(file, "utf8"));
      if (record.schema !== "factory.execution-record.v1" ||
          record.job?.fingerprint !== job.fingerprint || normalizeJob(record.job).fingerprint !== job.fingerprint ||
          !["queued", "running", "verifying", ...terminal].includes(record.status) ||
          !Array.isArray(record.events)) throw new Error("state_conflict_or_corruption");
      records.set(job.id, record);
    }
    for (const job of jobs) {
      if (!records.has(job.id)) {
        const record = { schema: "factory.execution-record.v1", job, status: "queued", reason: "accepted",
          acceptedAt: new Date(now()).toISOString(), events: [], attempts: 0 };
        records.set(job.id, record); save(record); // Persist before any adapter call.
      } else if (["running", "verifying"].includes(records.get(job.id).status)) {
        update(records.get(job.id), "held", "interrupted_attempt_requires_reconciliation");
      }
    }
    const running = new Map();
    async function run(record) {
      const job = record.job;
      const decision = executionDecision(job, grants, capabilities, now());
      if (decision.action !== "execute") { update(record, "held", decision.reason); return; }
      record.attempts++;
      record.startedAt = new Date(now()).toISOString();
      record.checkinWindow = job.checkinMinutes.map((minutes) => new Date(now() + minutes * 60000).toISOString());
      update(record, "running", "adapter_started");
      const ac = new AbortController(); let timer;
      try {
        const timeout = new Promise((_, reject) => { timer = setTimeout(() => {
          cancellationUnconfirmed = true; ac.abort(); reject(new Error("deadline"));
        }, timeoutMs); });
        const work = (async () => {
          const result = await execute(clone(job), { signal: ac.signal });
          if (ac.signal.aborted) return;
          if (!result || result.jobFingerprint !== job.fingerprint || result.exitCode !== 0 ||
              typeof result.executorId !== "string" || !result.executorId || !HASH.test(result.artifactDigest ?? ""))
            throw new Error("invalid_execution_receipt");
          record.result = clone(result); update(record, "verifying", "execution_returned");
          const checked = await verify(clone(job), clone(result), { signal: ac.signal });
          if (ac.signal.aborted) return;
          if (checked?.passed !== true || checked.jobFingerprint !== job.fingerprint ||
              checked.artifactDigest !== result.artifactDigest || typeof checked.verifierId !== "string" ||
              !checked.verifierId || checked.verifierId === result.executorId) throw new Error("verification_rejected");
          record.verification = clone(checked); update(record, "succeeded", "separate_verification_passed");
        })();
        await Promise.race([work, timeout]);
      } catch (error) {
        if (ac.signal.aborted) update(record, "held", "deadline_reached_cancellation_unverified");
        else update(record, "failed", error?.message === "verification_rejected" ? "verification_rejected" : "execution_failed");
      } finally { clearTimeout(timer); }
    }
    while (true) {
      let changed = false;
      for (const record of records.values()) {
        if (record.status !== "queued") continue;
        const dependencies = record.job.dependencies.map((id) => records.get(id));
        if (dependencies.some((r) => ["failed", "held"].includes(r.status))) {
          update(record, "held", "dependency_not_verified"); changed = true; continue;
        }
        if (dependencies.some((r) => r.status !== "succeeded") || running.size >= concurrency) continue;
        const id = record.job.id;
        running.set(id, run(record).finally(() => running.delete(id))); changed = true;
      }
      if (running.size) await Promise.race(running.values());
      else if (!changed || [...records.values()].every((r) => terminal.has(r.status))) break;
    }
    return [...records.values()].map(clone);
  } finally { fs.closeSync(lock); if (!cancellationUnconfirmed) fs.unlinkSync(lockPath); }
}
