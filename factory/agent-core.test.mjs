import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {createTask,selectWorker,assign,recover,saveTask,loadTask} from './agent-core.mjs';

const base=()=>createTask({id:'T1',goal:'keep building',requirements:['tests pass'],constraints:['preserve LKG'],repo:'factory-',lkg:'abc123'});
const workers=[
 {id:'subscription-a',healthy:true,held:false,tools:true,reasoning:true,tier:0,context:200000},
 {id:'free-b',healthy:true,held:false,tools:true,reasoning:true,tier:1,context:1000000},
 {id:'local-c',healthy:true,held:false,tools:true,reasoning:false,tier:2,context:32000}
];

test('prefers already-paid healthy capacity before free/local',()=>{
 assert.equal(selectWorker(workers,{tools:true,reasoning:true}).id,'subscription-a');
});

test('recovers to a different worker with durable requirements',()=>{
 const first=assign(base(),workers[0]);
 const next=recover(first,[{...workers[0],healthy:false},workers[1]],{tools:true,reasoning:true});
 assert.equal(next.worker,'free-b'); assert.deepEqual(next.requirements,first.requirements); assert.equal(next.attempt,2);
});

test('holds instead of silently using an ineligible worker',()=>{
 const first=assign(base(),workers[0]);
 const held=recover(first,[{...workers[0],healthy:false},{...workers[2],tools:false}],{tools:true,reasoning:true});
 assert.equal(held.status,'held');
});

test('checkpoint survives process boundary on disk',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'factory-agent-')); const file=path.join(dir,'task.json');
 const assigned=assign(base(),workers[0]); saveTask(file,assigned); const loaded=loadTask(file);
 assert.equal(loaded.worker,'subscription-a'); assert.equal(loaded.lkg,'abc123'); assert.deepEqual(loaded.requirements,['tests pass']);
});
