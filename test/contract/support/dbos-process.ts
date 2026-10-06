import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const postgresRuntime=process.env.HIMA_POSTGRES_RUNTIME;
if(!postgresRuntime) throw new Error('Set HIMA_POSTGRES_RUNTIME to the pinned private native PostgreSQL runtime');
export async function dbosHome():Promise<string> { return mkdtemp(path.join(tmpdir(),'hima-dbos-u3-')); }
export function dbosProcess(home:string,mode:string) {
  const child=spawn(process.execPath,[fileURLToPath(new URL('./dbos-worker.ts',import.meta.url)),home,mode],{
    env:{...process.env,HIMA_POSTGRES_RUNTIME:postgresRuntime},stdio:['ignore','pipe','pipe','ipc'],
  });
  let stderr=''; child.stderr!.on('data',value=>{stderr+=String(value);});
  const messages:unknown[]=[];
  const waiters:Array<{resolve:(value:any)=>void;reject:(error:Error)=>void}>=[];
  child.on('message',message=>{ const pending=waiters.shift(); if(pending) pending.resolve(message); else messages.push(message); });
  const ended=new Promise<void>(resolve=>child.once('close',()=>{
    for(const waiter of waiters.splice(0)) waiter.reject(new Error(`DBOS child exited: ${stderr}`)); resolve();
  }));
  return {child,ended,stderr:()=>stderr,
    async next():Promise<any> {
      if(messages.length) return messages.shift();
      if(child.exitCode !== null || child.signalCode !== null) throw new Error(`DBOS child already exited: ${stderr}`);
      return new Promise((resolve,reject)=>{
        const pending={resolve,reject};waiters.push(pending);
        const timer=setTimeout(()=>{const index=waiters.indexOf(pending);if(index>=0)waiters.splice(index,1);reject(new Error(`DBOS child timed out: ${stderr}`));},30000);
        pending.resolve=value=>{clearTimeout(timer);resolve(value);};pending.reject=error=>{clearTimeout(timer);reject(error);};
      });
    },
    async kill(){child.kill('SIGKILL');await ended;},
    async close(){
      if(child.exitCode !== null || child.signalCode !== null) { await ended;return; }
      child.send({action:'close'});
      const timer=setTimeout(()=>child.kill('SIGKILL'),5000);try{await ended;}finally{clearTimeout(timer);}
    },
  };
}
export async function cleanDbosHome(home:string):Promise<void>{
  // This fixture exclusively created the Home and child. Stop only its own private cluster before deletion.
  spawnSync(path.join(postgresRuntime!,'bin/pg_ctl'),['-D',path.join(home,'hima/database/data'),'-m','fast','-w','stop'],{stdio:'ignore',timeout:10000});
  await rm(home,{recursive:true,force:true});
}
