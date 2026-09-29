import {spawn} from 'node:child_process';
import {checkpoint} from './agent-core.mjs';

export function runCodexPrompt(prompt,{cwd=process.cwd(),spawnImpl=spawn,timeoutMs=90000}={}){
 return new Promise((resolve,reject)=>{
  const args=['exec','--ephemeral','-c','model_reasoning_effort="low"','-s','read-only','-C',cwd,'-'];
  const child=spawnImpl('codex',args,{stdio:['pipe','pipe','pipe'],windowsHide:true});
  let out='',err='',settled=false;
  const timer=setTimeout(()=>{if(!settled){settled=true;child.kill();reject(new Error(`codex timeout after ${timeoutMs}ms`));}},timeoutMs);
  child.stdout.on('data',d=>out+=d); child.stderr.on('data',d=>err+=d); child.on('error',e=>{clearTimeout(timer);if(!settled){settled=true;reject(e);}});
  child.on('close',code=>{clearTimeout(timer);if(settled)return;settled=true;code===0?resolve({ok:true,output:out.trim(),stderr:err}):reject(new Error(`codex exit ${code}: ${err}`));});
  child.stdin.end(prompt+'\n');
 });
}

export async function runCodexTask(task,{prompt,cwd,run=runCodexPrompt}={}){
 const result=await run(prompt,{cwd});
 return {task:checkpoint({...task,worker:'subscription/codex',status:'review'},{event:'codex-worker-result',output:result.output}),output:result.output};
}
