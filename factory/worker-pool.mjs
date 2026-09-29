import fs from "node:fs";
import { selectWorker } from "./agent-core.mjs";
import { probeOllama } from "./local-worker.mjs";
import { runCodexPrompt } from "./codex-worker.mjs";
import { defaultOpenCodeOptions, FREE_MODELS, probeOpenCode } from "./opencode-worker.mjs";
export async function probeCodex({ cwd = process.cwd(), run = runCodexPrompt } = {}) {
  try {
    const r = await run("Reply exactly FACTORY_CODEX_PROBE_OK. Do not inspect or modify files.", {
      cwd,
    });
    return {
      ok: r.output.trim() === "FACTORY_CODEX_PROBE_OK",
      output: r.output,
      checkedAt: new Date().toISOString(),
    };
  } catch (error) {
    return { ok: false, reason: error.message };
  }
}
export async function collectOpenCodeWorkers(models, options = {}, probe = probeOpenCode) {
  const workers = [];
  for (const model of new Set(models)) {
    if (!FREE_MODELS.includes(model)) throw new Error("Unapproved free model");
    const evidence = await probe({ ...options, model });
    const healthy = evidence.ok === true && evidence.reportedCost === 0;
    workers.push({
      id: `free/${model}`,
      provider: "opencode",
      model,
      transport: "official-opencode-cli",
      quotaGroup: "opencode-free",
      healthy,
      held: !healthy,
      tools: false,
      reasoning: true,
      tier: 1,
      context: 4096,
      dataClasses: ["public", "synthetic"],
      evidence,
    });
  }
  return workers;
}
export async function observePool({
  cwd = process.cwd(),
  localModel = "qwen2.5-coder:7b",
  includeOpenCode = true,
  openCodeModels = [FREE_MODELS[0]],
  openCodeOptions = {},
} = {}) {
  const [codex, local] = await Promise.all([
    probeCodex({ cwd }),
    probeOllama({ model: localModel }).catch((error) => ({
      ok: false,
      reason: error.message,
      model: localModel,
    })),
  ]);
  const workers = [
    {
      id: "subscription/codex",
      provider: "openai",
      healthy: codex.ok,
      held: !codex.ok,
      tools: true,
      reasoning: true,
      tier: 0,
      context: 400000,
      evidence: codex,
    },
    {
      id: `local/${localModel}`,
      provider: "ollama-local",
      healthy: local.ok,
      held: !local.ok,
      tools: false,
      reasoning: true,
      tier: 2,
      context: 32768,
      evidence: local,
    },
  ];
  const options = { ...defaultOpenCodeOptions(), ...openCodeOptions };
  if (includeOpenCode && fs.existsSync(options.executable)) {
    workers.push(...(await collectOpenCodeWorkers(openCodeModels, options)));
  }
  return workers;
}
export function chooseWorker(workers, needs = { reasoning: true }) {
  const scoped = workers.filter(
    (worker) => !worker.dataClasses || worker.dataClasses.includes(needs.classification)
  );
  return selectWorker(scoped, needs);
}
