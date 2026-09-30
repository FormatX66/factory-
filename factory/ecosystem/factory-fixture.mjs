// Executes the EXISTING Factory bridge, injecting synthetic model adapters only.
// No provider, credential, shell command, service or network operation is invoked.
import fs from 'node:fs';
import path from 'node:path';
import { dispatchMedicJob, persistMedicResult } from '../medic-bridge.mjs';
const [root, mode='ok'] = process.argv.slice(2);
if (!root || !['ok','bad-id','worker-error'].includes(mode)) throw Error('invalid fixture arguments');
let raw=''; for await (const chunk of process.stdin) raw += chunk;
const job=JSON.parse(raw);
if(job.classification!=='synthetic'||job.needsTools)throw Error('synthetic text-only fixture required');
let calls=0;
const worker=async task=>{
  calls++;
  if(mode==='worker-error')throw Error('synthetic worker failure');
  return {task:{...task,status:'review',worker:'free/opencode/space-bunny-free'},output:'SYNTHETIC_AURUM_ECOSYSTEM_PROPOSAL'};
};
const denied=async()=>{throw Error('Unexpected private/local worker selection');};
const result=await dispatchMedicJob(job,{openCode:worker,codex:denied,local:denied});
if(calls!==1)throw Error('Expected exactly one synthetic worker invocation');
persistMedicResult(root,result);
fs.appendFileSync(path.join(root,'fixture-calls.jsonl'),JSON.stringify({id:job.id,calls})+'\n');
process.stdout.write(JSON.stringify({ok:true,id:mode==='bad-id'?'incorrect':result.id,
 route:result.route,status:result.status,output:result.output})+'\n');
