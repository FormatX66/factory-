#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { dispatchMedicJob, persistMedicResult } from "../../factory/medic-bridge.mjs";
let raw=""; for await (const chunk of process.stdin) raw+=chunk;
try {
  const job=JSON.parse(raw); const result=await dispatchMedicJob(job);
  const root=process.env.FACTORY_MEDIC_EVIDENCE || path.join(process.cwd(),".factory-evidence","medic");
  persistMedicResult(root,result);
  process.stdout.write(JSON.stringify({ok:true,id:result.id,route:result.route,status:result.status,output:result.output})+"\n");
} catch(error) {
  process.stdout.write(JSON.stringify({ok:false,error:error?.message||"factory job failed"})+"\n");
  process.exitCode=1;
}
