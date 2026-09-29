import {spawn} from 'node:child_process';
import {checkpoint} from './agent-core.mjs';

export function runCodexPrompt(prompt,{cwd=process.cwd(),spawnImpl=spawn}={}){
 return new Promise((resolve,reject)=>{
  const child=spawnImpl('codex',['exec','--ephemeral','-s','read-only','-C',cwd,'-'],{stdio:['pipe','pipe','pipe'],windowsHide:true});
  let out='',err=''; child.stdout.on('data',d=>out+=d); child.stderr.on('data',d=>err+=d);
  child.on('error',reject); child.on('close',code=>code===0?resolve({ok:true,output:out.trim(),stderr:err}):reject(new Error(`codex exit ${code}: ${err}`)));
  child.stdin.end(prompt+'\n');
 });
}

export async function runCodexTask(task,{prompt,cwd,run=runCodexPrompt}={}){
 const result=await run(prompt,{cwd});
 return {task:checkpoint({...task,worker:'subscription/codex',status:'review'},{event:'codex-worker-result',output:result.output}),output:result.output};
}
