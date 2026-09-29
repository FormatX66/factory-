import path from "node:path";
import { CommanderCore } from "./core.mjs";
import { createCommanderServer } from "./server.mjs";

const workspace = process.env.AURUM_COMMANDER_WORKSPACE;
const token = process.env.AURUM_COMMANDER_TOKEN;
const port = Number(process.env.AURUM_COMMANDER_PORT || 19470);
if (!workspace) throw new Error("AURUM_COMMANDER_WORKSPACE required");

const core = new CommanderCore({
  workspace,
  evidenceFile: path.join(workspace, ".aurum-commander", "receipts.jsonl"),
  commands: {
    node: { executable: process.execPath },
    git: { executable: "git" },
  },
});
const service = createCommanderServer({ core, token, port });
const address = await service.listen();
console.log(JSON.stringify({ event: "aurum-commander-listening", address }));
