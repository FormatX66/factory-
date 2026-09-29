import assert from 'node:assert/strict'; import test from 'node:test';
import {parseCliJson,buildWorkers,probeResult} from './omniroute-adapter.mjs';

test('parses CLI JSON after ANSI/log prefix',()=>{const x=parseCliJson('\u001b[2mloaded\u001b[0m\n{"providers":[]}');assert.deepEqual(x,{providers:[]});});
test('catalog-only model is held until a real probe succeeds',()=>{
 const connections=[{provider:'opencode',isActive:true}]; const models=[{id:'oc/code-free',provider:'opencode',contextWindow:200000,capabilities:{tool_calling:true,reasoning:true}}];
 const [w]=buildWorkers({connections,models,probes:{}}); assert.equal(w.healthy,false); assert.equal(w.held,true);
});
test('successful probe promotes observed worker with capabilities',()=>{
 const connections=[{provider:'opencode',isActive:true}]; const models=[{id:'oc/code-free',provider:'opencode',contextWindow:200000,capabilities:{tool_calling:true,reasoning:true}}];
 const [w]=buildWorkers({connections,models,probes:{'oc/code-free':{ok:true,status:200}},tiers:{opencode:1}}); assert.equal(w.healthy,true); assert.equal(w.tools,true); assert.equal(w.reasoning,true);
});
test('failed upstream response stays held and preserves reason',()=>{
 const p=probeResult({status:401,body:{error:{message:'model unsupported'}}}); assert.equal(p.ok,false);
 const [w]=buildWorkers({connections:[{provider:'opencode',isActive:true}],models:[{id:'m',provider:'opencode'}],probes:{m:p}});
 assert.equal(w.held,true); assert.equal(w.evidence.reason,'model unsupported');
});
