import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {realpath,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {dbosHome,cleanDbosHome} from './support/dbos-process.ts';
for(const mode of ['clear','residual'])test(`normal ATCS durable route delivers honest ${mode} timing and broader UNKNOWN`,{timeout:120000},async(t)=>{
 const home=await dbosHome();
 const child=spawn(process.execPath,[fileURLToPath(new URL('./support/atcs-resident-durable-worker.ts',import.meta.url)),home,mode],{env:process.env,stdio:['ignore','pipe','pipe','ipc']});
 const exited=new Promise<void>(resolve=>child.once('exit',()=>resolve()));
 let output='';const safeOutput=()=>output.replace(/([?&]token=)[^\s&]+/g,'$1[redacted]');child.stdout!.on('data',bytes=>output+=String(bytes));child.stderr!.on('data',bytes=>output+=String(bytes));
 const result=new Promise<any>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error(`ATCS worker exceeded 90s: ${safeOutput()}`)),90000);child.once('message',proof=>{clearTimeout(timer);resolve(proof);});child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',()=>{clearTimeout(timer);reject(new Error(`ATCS child exited without result: ${safeOutput()}`));});});
 try{const proof=await result;t.diagnostic(JSON.stringify(proof));assert.equal(proof.ok,true,JSON.stringify(proof)+'\n'+safeOutput());assert.equal(proof.tasks,5);assert.equal(proof.readerJobs,1);assert.equal(proof.engineeringJobs,1);assert.equal(proof.productModelCalls,0);assert.equal(proof.goalState,mode==='clear'?'met':'not-met');assert.equal(proof.broaderUnknown,4);}
 finally{if(child.exitCode===null){const term=setTimeout(()=>child.kill('SIGTERM'),10000),kill=setTimeout(()=>child.kill('SIGKILL'),15000);try{await exited;}finally{clearTimeout(term);clearTimeout(kill);}}await closeOwnedNative(home,mode);await cleanDbosHome(home);}
});

async function closeOwnedNative(home:string,mode:string){
 const ownedHome=await realpath(home),root=fileURLToPath(new URL('../../',import.meta.url));
 const wrapper=path.join(root,'sites/linglong-atcs28/templates/resident-engineering-wrapper.py');
 const table=()=>spawnSync('ps',['-axo','pid=,ppid=,command='],{encoding:'utf8'}).stdout.trim().split('\n').flatMap(line=>{
  const found=/^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line);return found?[{pid:Number(found[1]),ppid:Number(found[2]),command:found[3]!}]:[];
 });
 const before=table(),wrappers=before.filter(item=>item.command.includes(wrapper+' --capability '+path.join(ownedHome,'workspace/admin/capability.json'))&&item.command.includes('--task-dir '+ownedHome+'/workspace/'));
 const owned=new Map(wrappers.map(item=>[item.pid,item]));let changed=true;
 while(changed){changed=false;for(const item of before)if(owned.has(item.ppid)&&!owned.has(item.pid)){owned.set(item.pid,item);changed=true;}}
 const signals:any[]=[];
 const signal=(pid:number,name:NodeJS.Signals)=>{const original=owned.get(pid),current=table().find(item=>item.pid===pid);if(!original||current?.command!==original.command)return;try{process.kill(pid,name);signals.push({pid,signal:name,command:original.command});}catch(error){if((error as NodeJS.ErrnoException).code!=='ESRCH')throw error;}};
 // Prefer the production wrapper handler, then close only captured descendants of that exact Home.
 for(const item of wrappers)signal(item.pid,'SIGTERM');await new Promise(resolve=>setTimeout(resolve,200));
 for(const pid of owned.keys())signal(pid,'SIGTERM');await new Promise(resolve=>setTimeout(resolve,200));
 for(const pid of owned.keys())signal(pid,'SIGKILL');await new Promise(resolve=>setTimeout(resolve,100));
 const survivors=table().filter(item=>owned.get(item.pid)?.command===item.command);
 await writeFile(path.join(root,'.hima-tmp/dbos-migration/u8/dry',mode+'-cleanup.json'),JSON.stringify({ownedHome,captured:[...owned.values()],signals,survivors},null,2));
 assert.equal(survivors.length,0,'Only this fixture Home native descendants must close before deletion');
}
