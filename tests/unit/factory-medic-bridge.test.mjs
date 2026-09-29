import assert from "node:assert/strict";
import test from "node:test";
import { dispatchMedicJob, normalizeMedicJob } from "../../factory/medic-bridge.mjs";
const fake=(worker)=>(task)=>Promise.resolve({task:{...task,worker,status:"review",checkpoint:{at:"x"},history:[]},output:"ok"});
test("defaults Medic input to private",()=>assert.equal(normalizeMedicJob({goal:"x"}).classification,"private"));
test("public no-tool work uses bounded free worker",async()=>{
 const r=await dispatchMedicJob({id:"p",goal:"review",classification:"public"},{openCode:fake("free")});
 assert.equal(r.route,"free/opencode/space-bunny-free"); assert.equal(r.output,"ok");
});
test("private work never selects public free worker",async()=>{
 let free=false; const r=await dispatchMedicJob({id:"x",goal:"private"},{codex:fake("codex"),openCode:()=>{free=true;}});
 assert.equal(r.route,"subscription/codex"); assert.equal(free,false);
});
test("non-tool Codex failure falls back local",async()=>{
 const r=await dispatchMedicJob({id:"f",goal:"fallback"},{codex:async()=>{throw new Error("down")},local:fake("local")});
 assert.equal(r.route,"local/qwen2.5-coder:7b");
});
test("read-only inspection holds instead of degrading to tool-less local",async()=>{
 await assert.rejects(()=>dispatchMedicJob({id:"t",goal:"inspect",mode:"inspect",needsTools:true},{codex:async()=>{throw new Error("down")},local:fake("local")}),/down/);
});
test("unknown classification fails closed",()=>assert.throws(()=>normalizeMedicJob({goal:"x",classification:"unknown"}),/classification/));
