import {checkpoint} from './agent-core.mjs';

export async function probeOllama({base='http://127.0.0.1:11434',model,fetchImpl=fetch}) {
 const started=Date.now();
 const res=await fetchImpl(`${base}/api/chat`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model,messages:[{role:'user',content:'Reply exactly FACTORY_LOCAL_PROBE_OK'}],stream:false,options:{temperature:0,num_predict:16}})});
 const body=await res.json(); const answer=body?.message?.content?.trim();
 return {ok:res.ok&&answer==='FACTORY_LOCAL_PROBE_OK',status:res.status,answer,latencyMs:Date.now()-started,model};
}

export async function runLocalTask(task,{prompt,model='qwen2.5-coder:7b',base='http://127.0.0.1:11434',fetchImpl=fetch}) {
 const res=await fetchImpl(`${base}/api/chat`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model,messages:[{role:'system',content:'You are a bounded Factory worker. Return analysis only; do not claim files were changed.'},{role:'user',content:prompt}],stream:false,options:{temperature:0,num_predict:384}})});
 const body=await res.json(); if(!res.ok) throw new Error(`local worker HTTP ${res.status}`);
 const output=body?.message?.content??'';
 return {task:checkpoint({...task,worker:`local/${model}`,status:'review'},{event:'local-worker-result',model,output}),output};
}
