// L2 Host (atcs-dry): the frozen ATCS Pack through the normal startRun → DBOS route with a known
// collateral regression. The narrow Timing Goal is judged on raw timing only; the regression measured
// from hashed XTop fail-reason tables is delivered beside it, neither hidden nor turned into Goal
// false; a bounded fail-reason sample still leaves the broader checks UNKNOWN. Actual
// Host/PG/wrapper/Reader; only the ACP engineer
// is a stand-in (test/fixtures/atcs-resident-dry/acp-known-collateral.py). No product model call.
// Replaces atcs-dry-path.host.test.ts "ATCS 0.3.3 Timing ending without benchmark:
// known-collateral-regression" (owner begin/work/complete over a prewritten 0.3 result).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {realpath} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {dbosHome,cleanDbosHome} from './support/dbos-process.ts';

test('ATCS durable route meets the Timing Goal and delivers a known collateral regression separately',{timeout:120000},async(t)=>{
 const home=await dbosHome();
 const child=spawn(process.execPath,[fileURLToPath(new URL('./support/atcs-known-collateral-durable-worker.ts',import.meta.url)),home],{env:process.env,stdio:['ignore','pipe','pipe','ipc']});
 const exited=new Promise<void>(resolve=>child.once('exit',()=>resolve()));
 let output='';child.stdout!.on('data',bytes=>output+=String(bytes));child.stderr!.on('data',bytes=>output+=String(bytes));
 const result=new Promise<any>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error(`ATCS worker exceeded 100s: ${output}`)),100000);child.once('message',proof=>{clearTimeout(timer);resolve(proof);});child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',()=>{clearTimeout(timer);reject(new Error(`ATCS child exited without result: ${output}`));});});
 try{
  const proof=await result;t.diagnostic(JSON.stringify(proof));
  assert.equal(proof.ok,true,JSON.stringify(proof,null,1)+'\n'+output.slice(-4000));
  assert.deepEqual(proof.timing.setup.violations,{value:0});assert.deepEqual(proof.timing.hold.violations,{value:0});
  assert.equal(proof.evaluationGoalMet,true,'raw timing is clear, so the narrow Timing Goal is met');
  assert.equal(proof.goalMet,true);assert.equal(proof.goalState,'met');assert.equal(proof.status,'ended-goal-met');
  assert.deepEqual(proof.collateral.regression,{value:1},`the known transition regression is measured and delivered: ${JSON.stringify(proof.collateral)}`);
  assert.deepEqual(proof.collateral.unknown,{value:4},'a bounded fail-reason sample cannot prove the broader checks; they stay UNKNOWN');
  assert.equal(proof.reportGoalLine,'Goal met: true');
  assert.match(proof.reportCollateral,/"regression":\s*\{\s*"value":\s*[1-9]/,'the delivered report states the regression beside the Goal');
  assert.equal(proof.experience,'read');assert.equal(proof.productModelCalls,0);
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
