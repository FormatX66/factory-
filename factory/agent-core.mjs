import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const SCHEMA = 'factory.task.v1';
const sha = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function createTask({id, goal, requirements=[], constraints=[], repo, lkg}) {
  if (!id || !goal || !repo || !lkg) throw new Error('id, goal, repo, and lkg are required');
  const task = {schema:SCHEMA,id,goal,requirements,constraints,repo,lkg,status:'queued',attempt:0,worker:null,checkpoint:null,history:[]};
  return {...task, fingerprint:sha(task)};
}

export function selectWorker(workers, needs={}) {
  const eligible = workers.filter(w => w.healthy && !w.held && (!needs.tools || w.tools) && (!needs.reasoning || w.reasoning));
  eligible.sort((a,b) => (a.tier-b.tier) || (b.context-a.context) || a.id.localeCompare(b.id));
  return eligible[0] ?? null;
}

export function checkpoint(task, evidence={}) {
  const cp={at:new Date().toISOString(),attempt:task.attempt,worker:task.worker,evidence};
  return {...task,checkpoint:cp,history:[...task.history,cp],fingerprint:sha({...task,checkpoint:cp})};
}

export function assign(task, worker) {
  if (!worker) throw new Error('no eligible worker');
  return checkpoint({...task,status:'running',attempt:task.attempt+1,worker:worker.id},{event:'assigned'});
}

export function recover(task, workers, needs={}) {
  const candidates=workers.filter(w => w.id !== task.worker);
  const worker=selectWorker(candidates,needs);
  if (!worker) return {...task,status:'held'};
  return assign({...task,status:'recovering'},worker);
}

export function saveTask(file, task) {
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const temp=file+'.tmp';
  fs.writeFileSync(temp,JSON.stringify(task,null,2)+'\n',{encoding:'utf8',flag:'w'});
  fs.renameSync(temp,file);
}

export function loadTask(file) {
  const task=JSON.parse(fs.readFileSync(file,'utf8'));
  if (task.schema !== SCHEMA) throw new Error('unsupported task schema');
  return task;
}
