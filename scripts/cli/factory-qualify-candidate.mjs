#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createValidationExecutor } from "../../factory/validation-executor.mjs";
import { normalizeJob, runAuthorizedBatch } from "../../factory/workflow-controller.mjs";

// One explicitly invoked, bounded qualification pass; never called by model output or a network route.
if (process.argv.length !== 3 || process.argv[2] !== "--run") {
  console.error("Explicit foreground invocation required: node scripts/cli/factory-qualify-candidate.mjs --run");
  process.exitCode = 2;
} else {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "factory/qualification-manifest.json"), "utf8"));
  const output = path.join(root, "evidence", "qualification");
  const adapter = createValidationExecutor({ sourceRoot: root, outputRoot: path.join(output, "artifacts"),
    recipes: manifest.recipes, timeoutMs: 30000 });
  const jobs = manifest.recipes.map(r => normalizeJob({ id: r.id, goal: `Qualify reviewed source: ${r.id}`,
    kind: "test", scope: r.id, revision: r.revision, classification: "private", dependencies: [], checkinMinutes: [1, 2] }));
  const grants = jobs.map(job => ({ source: "operator", jobId: job.id, fingerprint: job.fingerprint,
    kind: "test", scope: job.scope, expiresAt: new Date(Date.now() + 300000).toISOString() }));
  const records = await runAuthorizedBatch(jobs, { root: path.join(output, "ledger"), ...adapter,
    grants, concurrency: 2, timeoutMs: 45000 });
  const summary = { schema: "factory.source-qualification.v1", runtime: process.version,
    platform: process.platform, checkedAt: new Date().toISOString(), sourceCandidate: manifest.sourceCandidate,
    lanes: records.map(r => ({ id: r.job.id, status: r.status, reason: r.reason,
      attempts: r.attempts, checkinWindow: r.checkinWindow, result: r.result, verification: r.verification })),
    allVerified: records.every(r => r.status === "succeeded"),
    scope: "Reviewed-source qualification in this isolated environment; no live service dispatch, model call, or deployment",
    productionDeployed: false, windowsAcceptance: false, supportedNode24Run: Number(process.versions.node.split(".")[0]) >= 24 };
  fs.writeFileSync(path.join(output, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
  console.log(JSON.stringify(summary, null, 2));
  process.exitCode = summary.allVerified ? 0 : 1;
}
