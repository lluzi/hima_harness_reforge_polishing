import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {realpath} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {dbosHome,cleanDbosHome} from './support/dbos-process.ts';

// L2: the libinsight-analysis Pack end to end through the public startRun with the per-Run
// analysisRequest override, the real resident wrapper (sandbox none), the real Pack Reader and
// tools, and an ACP stand-in that runs the Pack's verified example script. `repair` first delivers a
// rejected result and repairs it after the same-task Reader-rejection message.
for(const mode of ['clean','repair'])test(`libinsight-analysis durable route admits a Reader-accepted analysis (${mode})`,{timeout:150000},async(t)=>{
 const home=await dbosHome();
 const child=spawn(process.execPath,[fileURLToPath(new URL('./support/libinsight-resident-durable-worker.ts',import.meta.url)),home,mode],{env:process.env,stdio:['ignore','pipe','pipe','ipc']});
 const exited=new Promise<void>(resolve=>child.once('exit',()=>resolve()));
 let output='';child.stdout!.on('data',bytes=>output+=String(bytes));child.stderr!.on('data',bytes=>output+=String(bytes));
 const result=new Promise<any>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error(`libinsight worker exceeded 120s: ${output}`)),120000);child.once('message',proof=>{clearTimeout(timer);resolve(proof);});child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',()=>{clearTimeout(timer);reject(new Error(`libinsight child exited without result: ${output}`));});});
 try{
  const proof=await result;t.diagnostic(JSON.stringify(proof));
  assert.equal(proof.ok,true,JSON.stringify(proof,null,1)+'\n'+output.slice(-4000));
  assert.equal(proof.tasks,4);assert.equal(proof.engineeringJobs,1);assert.equal(proof.productModelCalls,0);assert.equal(proof.goalState,'met');
  assert.equal(proof.readerJobs,mode==='repair'?2:1);assert.equal(proof.prompts,mode==='repair'?2:1);
 }
 finally{if(child.exitCode===null){const term=setTimeout(()=>child.kill('SIGTERM'),10000),kill=setTimeout(()=>child.kill('SIGKILL'),15000);try{await exited;}finally{clearTimeout(term);clearTimeout(kill);}}await closeOwnedNative(home);await cleanDbosHome(home);}
});

/** Close only native wrapper descendants that belong to this fixture Home (as the ATCS dry test does). */
async function closeOwnedNative(home:string){
 const ownedHome=await realpath(home),root=fileURLToPath(new URL('../../',import.meta.url));
 const wrapper=path.join(root,'sites/linglong-atcs28/templates/resident-engineering-wrapper.py');
 const table=()=>spawnSync('ps',['-axo','pid=,ppid=,command='],{encoding:'utf8'}).stdout.trim().split('\n').flatMap(line=>{
  const found=/^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line);return found?[{pid:Number(found[1]),ppid:Number(found[2]),command:found[3]!}]:[];
 });
 const before=table(),wrappers=before.filter(item=>item.command.includes(wrapper+' --capability '+path.join(ownedHome,'workspace/admin/capability.json')));
 const owned=new Map(wrappers.map(item=>[item.pid,item]));let changed=true;
 while(changed){changed=false;for(const item of before)if(owned.has(item.ppid)&&!owned.has(item.pid)){owned.set(item.pid,item);changed=true;}}
 const signal=(pid:number,name:NodeJS.Signals)=>{const original=owned.get(pid),current=table().find(item=>item.pid===pid);if(!original||current?.command!==original.command)return;try{process.kill(pid,name);}catch(error){if((error as NodeJS.ErrnoException).code!=='ESRCH')throw error;}};
 for(const item of wrappers)signal(item.pid,'SIGTERM');await new Promise(resolve=>setTimeout(resolve,200));
 for(const pid of owned.keys())signal(pid,'SIGKILL');await new Promise(resolve=>setTimeout(resolve,100));
 assert.equal(table().filter(item=>owned.get(item.pid)?.command===item.command).length,0,'Only this fixture Home native descendants must close before deletion');
}
