import fs from "node:fs";
import path from "node:path";
import { createTask, saveTask } from "./agent-core.mjs";
import { runCodexTask } from "./codex-worker.mjs";
import { runLocalTask } from "./local-worker.mjs";
import { runOpenCodeTask } from "./opencode-worker.mjs";

const CLASSIFICATIONS = new Set(["public", "synthetic", "private"]);
export function normalizeMedicJob(input) {
  if (!input || typeof input !== "object") throw new Error("job object required");
  const goal = String(input.goal ?? "").trim();
  if (!goal || goal.length > 16000) throw new Error("invalid goal");
  const classification = String(input.classification ?? "private");
  if (!CLASSIFICATIONS.has(classification)) throw new Error("invalid classification");
  return { id: String(input.id || `medic-${Date.now()}`), goal, classification,
    requirements: Array.isArray(input.requirements) ? input.requirements.map(String).slice(0,32) : [],
    constraints: Array.isArray(input.constraints) ? input.constraints.map(String).slice(0,32) : [],
    repo: String(input.repo || "medic-hub"), lkg: String(input.lkg || "medic-intake"),
    needsTools: input.needsTools === true };
}
export async function dispatchMedicJob(raw, adapters = {}) {
  const job = normalizeMedicJob(raw);
  let task = createTask(job);
  const prompt = `Goal: ${job.goal}\nRequirements: ${job.requirements.join("; ")}\nConstraints: ${job.constraints.join("; ")}\nReturn a bounded analysis/proposal; do not claim unverified execution.`;
  let result, route;
  if (!job.needsTools && ["public","synthetic"].includes(job.classification)) {
    route = "free/opencode/space-bunny-free";
    result = await (adapters.openCode ?? runOpenCodeTask)(task,{prompt,classification:job.classification});
  } else {
    try { route = "subscription/codex"; result = await (adapters.codex ?? runCodexTask)(task,{prompt,cwd:process.cwd()}); }
    catch (error) {
      if (job.needsTools) throw error;
      route = "local/qwen2.5-coder:7b";
      result = await (adapters.local ?? runLocalTask)(task,{prompt});
    }
  }
  task = result.task;
  return {schema:"medic.factory.result.v1",id:job.id,route,status:task.status,output:result.output,task};
}

export function persistMedicResult(root, result) {
  const safe=result.id.replace(/[^a-zA-Z0-9._-]/g,"_");
  const dir=path.join(root,safe); fs.mkdirSync(dir,{recursive:true});
  saveTask(path.join(dir,"task.json"),result.task);
  fs.writeFileSync(path.join(dir,"result.json"),JSON.stringify(result,null,2)+"\n");
  return dir;
}
