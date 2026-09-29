import assert from 'node:assert/strict'; import test from 'node:test';
import {createTask} from './agent-core.mjs'; import {runCodexTask} from './codex-worker.mjs';
test('Codex result is checkpointed as subscription worker',async()=>{
 const t=createTask({id:'c',goal:'g',repo:'r',lkg:'l'}); const r=await runCodexTask(t,{prompt:'x',run:async()=>({ok:true,output:'proposal'})});
 assert.equal(r.task.worker,'subscription/codex'); assert.equal(r.task.status,'review'); assert.equal(r.output,'proposal');
});
