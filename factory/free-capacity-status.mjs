import fs from "node:fs";
import path from "node:path";
import {
  admitAfterCanary,
  buildIntakeState,
  loadFreeCatalog,
  summarizeIntake,
} from "./free-capacity-intake.mjs";

const catalog = loadFreeCatalog();
const states = buildIntakeState(catalog, {
  connectedProviders: ["opencode-free"],
});
const evidencePath = path.resolve(
  ".factory-evidence",
  "free-capacity",
  "opencode-space-bunny.json"
);
const opencodeEvidence = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
const opencodeIndex = states.findIndex((state) => state.id === "opencode-free");
states[opencodeIndex] = admitAfterCanary(states[opencodeIndex], opencodeEvidence);
const report = {
  schema: "factory.free-capacity.state.v1",
  generatedAt: new Date().toISOString(),
  zeroSpendPolicy: catalog.policy,
  summary: summarizeIntake(states),
  providers: states,
};
const outDir = path.resolve(".factory-evidence", "free-capacity");
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, "latest.json");
fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({
  outPath,
  summary: report.summary,
  opencode: states[opencodeIndex],
}));
