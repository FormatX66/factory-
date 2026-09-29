import fs from "node:fs";
import { runOpenCodeTask } from "../factory/opencode-worker.mjs";
const prompt = "Design a JSON summary for evidence records with statuses healthy, held, failed. Give fields plus 3 malformed/missing-input edge cases and 3 tests. Under 180 words.";
const result = await runOpenCodeTask(
  { id:"factory-health-dashboard-v01", title:"Factory Health Dashboard v0.1", history:[] },
  { prompt, classification:"synthetic", timeoutMs:45000 }
);
fs.writeFileSync(new URL("./worker-plan.json", import.meta.url), JSON.stringify(result,null,2)+"\n");
console.log(JSON.stringify({worker:result.task.worker,status:result.task.status,bytes:result.output.length}));
