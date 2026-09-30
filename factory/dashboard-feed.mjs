import fs from 'node:fs';import path from 'node:path';import http from 'node:http';import {fileURLToPath} from 'node:url';
import {normalizeJob} from './workflow-controller.mjs';
const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const STATES=new Set(['queued','running','verifying','succeeded','failed','held']);
const REASONS=new Set(['accepted','adapter_started','execution_returned','separate_verification_passed','execution_failed','verification_rejected','missing_exact_authorization','executor_not_available','dependency_not_verified','interrupted_attempt_requires_reconciliation','deadline_reached_cancellation_unverified','stopped_attempt_checkpoint_verified']);
function json(file){const s=fs.lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||s.size>1048576)throw Error('unsafe evidence');return JSON.parse(fs.readFileSync(file,'utf8'));}
function age(at,now){const t=Date.parse(at);return Number.isFinite(t)&&t<=now+1000?Math.max(0,now-t):null;}
export function projectRecords(records,{now=Date.now(),freshForMs=900000}={}){
 const byId=new Map(),errors=[];
 for(const r of records){
  try{
   if(r.schema!=='factory.execution-record.v1'||!ID.test(r.job?.id)||!STATES.has(r.status)||normalizeJob(r.job).fingerprint!==r.job.fingerprint||!Array.isArray(r.events))throw Error();
   if(byId.has(r.job.id)){byId.set(r.job.id,null);errors.push('duplicate-job');continue;}
   const observedAt=r.events.at(-1)?.at??r.acceptedAt,a=age(observedAt,now);
   const verified=r.status==='succeeded'&&r.result?.exitCode===0&&r.result.jobFingerprint===r.job.fingerprint&&r.verification?.passed===true&&r.verification.jobFingerprint===r.job.fingerprint&&r.verification.artifactDigest===r.result.artifactDigest&&/^[a-f0-9]{64}$/.test(r.result.artifactDigest)&&typeof r.result.executorId==='string'&&r.result.executorId.length>0&&typeof r.verification.verifierId==='string'&&r.verification.verifierId.length>0&&r.verification.verifierId!==r.result.executorId;
   const stale=a===null||a>freshForMs;
   const state=stale?'stale':r.status==='succeeded'&&!verified?'unverified':r.status;
   byId.set(r.job.id,{id:r.job.id,state,lastKnownState:r.status,verified,stale,observedAt:a===null?null:observedAt,attempts:Number.isSafeInteger(r.attempts)?r.attempts:null,recoveries:Array.isArray(r.recoveries)?r.recoveries.length:0,reason:REASONS.has(r.reason)?r.reason:'not-published'});
  }catch{errors.push('invalid-record');}
 }
 const jobs=[...byId.values()].filter(Boolean),totals={queued:0,running:0,verifying:0,succeeded:0,failed:0,held:0,stale:0,unverified:0};
 jobs.forEach(j=>totals[j.state]++);return {jobs,totals,errors};
}
export function readSnapshot({recordsRoot,providerFile,scope='synthetic-acceptance',now=Date.now()}){
 const records=[],errors=[];
 try{if(fs.lstatSync(recordsRoot).isSymbolicLink())throw Error();const names=fs.readdirSync(recordsRoot).filter(n=>!n.startsWith('.')&&n.endsWith('.json'));if(names.length>256)throw Error();for(const n of names){try{records.push(json(path.join(recordsRoot,n)));}catch{errors.push('unreadable-job');}}}catch{errors.push('job-evidence-unavailable');}
 let providers={freshVerified:0,stale:0,held:0,unknown:0,observedAt:null};
 try{const p=json(providerFile);if(p.schema!=='factory.free-capacity.state.v1'||!Array.isArray(p.providers)||p.providers.length>256)throw Error();providers.observedAt=age(p.generatedAt,now)===null?null:p.generatedAt;
  for(const entry of p.providers){const e=entry.evidence,a=age(e?.checkedAt,now);if(entry.admitted&&e?.ok===true&&e.reportedCost===0&&e.paidFallbackUsed===false){if(a!==null&&a<=900000)providers.freshVerified++;else providers.stale++;}else if(entry.hold)providers.held++;else providers.unknown++;}
 }catch{errors.push('provider-evidence-unavailable');}
 const projected=projectRecords(records,{now});
 return {schema:'factory.dashboard.snapshot.v1',generatedAt:new Date(now).toISOString(),scope:scope==='synthetic-acceptance'?'synthetic-acceptance':'registered-factory-jobs',readOnly:true,jobEvidence:projected,providers,errors:[...errors,...projected.errors],services:[]};
}
const TARGETS=[['Commander','http://127.0.0.1:19470/health'],['Future Branch','http://127.0.0.1:19466/health'],['OmniRoute source','http://127.0.0.1:20130/health'],['OmniRoute original','http://127.0.0.1:20128/health']];
async function probe(label,url){
 try{const r=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(1500)});if(!r.ok||!r.headers.get('content-type')?.includes('json'))throw Error();const reader=r.body.getReader();let text='',bytes=0;try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>131072)throw Error();text+=Buffer.from(value).toString('utf8');}}finally{await reader.cancel().catch(()=>{});}const h=JSON.parse(text);
 const valid=label==='Commander'?h.ok===true&&h.service==='aurum-commander':label==='Future Branch'?h.status==='healthy'&&h.event_chain_valid===true:false;
 return {label,state:valid?'healthy':'unverified',observedAt:new Date().toISOString(),explorer:label==='Future Branch'?{healthy:h.continuous_exploration?.healthy===true,modelOnly:h.continuous_exploration?.model_only===true}:null};
 }catch{return {label,state:'unavailable',observedAt:new Date().toISOString()};}
}
export function createDashboardServer({recordsRoot,providerFile,port=19471,probeServices=true}){
 if(!path.isAbsolute(recordsRoot)||!path.isAbsolute(providerFile)||!Number.isInteger(port)||port<0||port>65535)throw Error('invalid server config');
 const assets=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../web/factory-feed');
 let snapshotFlight=null;
 const server=http.createServer(async(req,res)=>{
  const p=server.address().port;
  const send=(code,type,body)=>{res.writeHead(code,{'content-type':type,'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','content-security-policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'self' http://127.0.0.1:8080"});res.end(req.method==='HEAD'?'':body);};
  if(![`127.0.0.1:${p}`,`localhost:${p}`].includes(req.headers.host))return send(403,'text/plain','Local host required');
  if(req.headers.origin&&!['http://127.0.0.1:'+p,'http://localhost:'+p].includes(req.headers.origin))return send(403,'text/plain','Origin rejected');
  if(!['GET','HEAD'].includes(req.method)){req.resume();return send(405,'text/plain','Read only');}
  try{
   if(req.url==='/health')return send(200,'application/json',JSON.stringify({ok:true,service:'factory-readonly-feed',executionAuthority:false}));
   if(req.url==='/v1/snapshot'){
    if(!snapshotFlight)snapshotFlight=(async()=>{const snapshot=readSnapshot({recordsRoot,providerFile});if(probeServices)snapshot.services=await Promise.all(TARGETS.map(([l,u])=>probe(l,u)));return snapshot;})().finally(()=>{snapshotFlight=null;});
    return send(200,'application/json',JSON.stringify(await snapshotFlight));
   }
   const allowed={'/':['index.html','text/html; charset=utf-8'],'/app.js':['app.js','text/javascript; charset=utf-8'],'/style.css':['style.css','text/css; charset=utf-8']};
   const item=allowed[req.url];if(!item)return send(404,'text/plain','Not found');
   return send(200,item[1],fs.readFileSync(path.join(assets,item[0])));
  }catch{return send(503,'application/json','{"error":"evidence-unavailable"}');}
 });
 server.requestTimeout=5000;server.headersTimeout=5000;
 return {server,listen:()=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>resolve(server.address()));}),close:()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();})};
}
