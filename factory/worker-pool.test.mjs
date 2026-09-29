import assert from 'node:assert/strict'; import test from 'node:test';
import {chooseWorker} from './worker-pool.mjs';
test('pool prefers subscription compute when both are healthy',()=>{
 const w=chooseWorker([{id:'local',healthy:true,held:false,tools:false,reasoning:true,tier:2,context:32000},{id:'codex',healthy:true,held:false,tools:true,reasoning:true,tier:0,context:400000}]); assert.equal(w.id,'codex');
});
test('pool falls back to local reasoning when subscription is held',()=>{
 const w=chooseWorker([{id:'codex',healthy:false,held:true,tools:true,reasoning:true,tier:0,context:400000},{id:'local',healthy:true,held:false,tools:false,reasoning:true,tier:2,context:32000}],{reasoning:true}); assert.equal(w.id,'local');
});
