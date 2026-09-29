#!/usr/bin/env node
import path from "node:path";
import { runMedicJob, FactoryAdmissionError } from "../../factory/medic-bridge.mjs";
try {
  const chunks = []; let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += Buffer.byteLength(chunk);
    if (bytes > 65536) throw new FactoryAdmissionError("job_too_large");
    chunks.push(chunk);
  }
  const job = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  const root = process.env.FACTORY_MEDIC_EVIDENCE || path.join(process.cwd(), ".factory-evidence", "medic");
  const result = await runMedicJob(job, { root });
  const { task, ...response } = result;
  process.stdout.write(JSON.stringify(response) + "\n");
  process.exitCode = result.ok ? 0 : 1;
} catch (error) {
  const code = error instanceof FactoryAdmissionError ? error.code : "invalid_job_or_evidence_unavailable";
  process.stdout.write(JSON.stringify({ ok: false, status: "held", error: code, executionVerified: false }) + "\n");
  process.exitCode = 1;
}
