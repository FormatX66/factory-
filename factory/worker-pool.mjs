import {selectWorker} from './agent-core.mjs';
import {probeOllama} from './local-worker.mjs'; import {runCodexPrompt} from './codex-worker.mjs';

export async function probeCodex({cwd=process.cwd(),run=runCodexPrompt}={}){
 try{const r=await run('Reply exactly FACTORY_CODEX_PROBE_OK. Do not inspect or modify files.',{cwd}); return {ok:r.output.trim().endsWith('FACTORY_CODEX_PROBE_OK'),output:r.output};}
 catch(error){return {ok:false,reason:error.message};}
}

export async function observePool({cwd=process.cwd(),localModel='qwen2.5-coder:7b'}={}){
 const [codex,local]=await Promise.all([probeCodex({cwd}),probeOllama({model:localModel}).catch(e=>({ok:false,reason:e.message,model:localModel}))]);
 return [
  {id:'subscription/codex',healthy:codex.ok,held:!codex.ok,tools:true,reasoning:true,tier:0,context:400000,evidence:codex},
  {id:`local/${localModel}`,healthy:local.ok,held:!local.ok,tools:false,reasoning:true,tier:2,context:32768,evidence:local}
 ];
}

export function chooseWorker(workers,needs={reasoning:true}){return selectWorker(workers,needs);}
