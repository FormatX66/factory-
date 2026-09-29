import fs from "node:fs";
import { runOpenCodeTask } from "./opencode-worker.mjs";
const prompt = "For a dependency-free Node.js local command service, give 6 concise security invariants for workspace-confined files, allowlisted commands, timeouts, bounded output, and append-only receipts. Under 250 words.";
const result = await runOpenCodeTask(
  { id: "commander-v01-plan", title: "Commander security plan", history: [] },
  { prompt, classification: "synthetic", timeoutMs: 60000 }
);
fs.mkdirSync(".factory-evidence/commander-v01", { recursive: true });
fs.writeFileSync(".factory-evidence/commander-v01/worker-plan.json", JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({worker:result.task.worker,status:result.task.status,outputLength:result.output.length}));
