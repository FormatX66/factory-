const stripAnsi=s=>s.replace(/\x1b\[[0-9;]*m/g,'');
export function parseCliJson(text){
 const clean=stripAnsi(text); const starts=['{','['].map(c=>clean.indexOf(c)).filter(i=>i>=0); if(!starts.length) throw new Error('no JSON payload');
 return JSON.parse(clean.slice(Math.min(...starts)));
}

export function buildWorkers({connections=[],models=[],probes={},tiers={}}){
 const active=new Map(connections.filter(c=>c.isActive).map(c=>[c.provider,c]));
 return models.map(m=>{
  const provider=m.provider ?? m.owned_by; const probe=probes[m.id];
  const observed=probe?.ok===true; const connected=active.has(provider);
  return {id:`${provider}/${m.id}`,provider,model:m.id,healthy:connected&&observed,held:!observed,
   tools:m.capabilities?.tool_calling===true,reasoning:m.capabilities?.reasoning===true,
   context:m.contextWindow??m.context_length??0,tier:tiers[provider]??1,
   evidence:probe??{ok:false,reason:connected?'unprobed':'provider-not-connected'}};
 });
}

export function probeResult({status,body}){
 const ok=status>=200&&status<300; return {ok,status,reason:ok?'live-response':body?.error?.message??`http-${status}`};
}
