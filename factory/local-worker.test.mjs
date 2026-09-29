import assert from 'node:assert/strict'; import test from 'node:test';
import {createTask} from './agent-core.mjs'; import {probeOllama,runLocalTask} from './local-worker.mjs';
const response=(content,status=200)=>Promise.resolve({ok:status===200,status,json:async()=>({message:{content}})});
test('probe requires exact observed response',async()=>{const p=await probeOllama({model:'m',fetchImpl:()=>response('FACTORY_LOCAL_PROBE_OK')});assert.equal(p.ok,true);});
test('wrong response is not promoted',async()=>{const p=await probeOllama({model:'m',fetchImpl:()=>response('almost')});assert.equal(p.ok,false);});
test('local result checkpoints without claiming execution',async()=>{const t=createTask({id:'x',goal:'g',repo:'r',lkg:'l'});const r=await runLocalTask(t,{prompt:'review',fetchImpl:()=>response('proposal')});assert.equal(r.task.status,'review');assert.equal(r.task.worker,'local/qwen2.5-coder:7b');assert.equal(r.output,'proposal');});
