// Registered L2 contract; TERM/INT use the shipped profile launcher.
// TERM/INT are the actual shipped profile launcher handlers. SIGHUP is unsupported;
// do not add a fixture handler and describe it as a product signal qualification.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { createHimaHome, type HimaHome } from './support/dsh-home.ts';
import { startLocalDatabase } from '@hima/harness';

const alive=(pid:number)=>{try{process.kill(pid,0);return true;}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')return false;throw error;}};
function forkHost(h:HimaHome, mode:'seed'|'reopen',scenario:'leader'|'peer'){
 const child=spawn(process.execPath,[fileURLToPath(new URL('./support/himateam-signals-worker.ts',import.meta.url)),h.home,h.workspace,mode,scenario],{
  cwd:process.cwd(),env:{...h.env,NODE_TEST_CONTEXT:process.env.NODE_TEST_CONTEXT??'child-v8',HIMA_TEST_SILENT_AGENT:'1',HIMA_TEST_LEGACY_AUTO_DRIVE:'0'},stdio:['ignore','pipe','pipe','ipc']});
 let stderr='';child.stdout!.resume();child.stderr!.on('data',bytes=>{stderr+=String(bytes);});
 const queued:any[]=[],waiters:Array<{resolve:(message:any)=>void;reject:(error:Error)=>void}>=[];
 const closed=new Promise<void>(resolve=>child.once('close',()=>{for(const waiter of waiters.splice(0))waiter.reject(Error(`Host ${mode} exited: ${stderr}`));resolve();}));
 const ended=()=>new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(`Host ${mode} failed to end: ${stderr}`)),15000);void closed.then(()=>{clearTimeout(timer);resolve();});});
 child.on('message',message=>{const waiter=waiters.shift();if(waiter)waiter.resolve(message);else queued.push(message);});
 child.on('error',error=>{for(const waiter of waiters.splice(0))waiter.reject(error);});
 const next=async():Promise<any>=>{
  if(queued.length)return queued.shift();
  if(child.exitCode!==null||child.signalCode!==null)throw Error(`Host ${mode} exited: ${stderr}`);
  return new Promise((resolve,reject)=>{
   const waiter={resolve,reject};waiters.push(waiter);
   const timer=setTimeout(()=>{const i=waiters.indexOf(waiter);if(i>=0)waiters.splice(i,1);reject(Error(`Host IPC timed out: ${stderr}`));},60000);
   waiter.resolve=value=>{clearTimeout(timer);resolve(value);};waiter.reject=error=>{clearTimeout(timer);reject(error);};
  });
 };
 return {child,next,ended,stderr:()=>stderr,close:async()=>{
  if(child.exitCode===null&&child.signalCode===null)child.send({action:'close'});
  await ended();assert.equal(child.exitCode,0,stderr);
 }};
}
for(const scenario of ['leader','peer'] as const)for(const signal of ['SIGTERM','SIGINT'] as const)test(`actual ${signal} ${scenario==='peer'?'admitted capacity-one discussion peer':'original leader'} profile shutdown retains Team human gate before native close and cold reopen`,{timeout:180000},async t=>{
 const h=await createHimaHome({desktopShaped:true});
 let original:ReturnType<typeof forkHost>|undefined,reopened:ReturnType<typeof forkHost>|undefined;
 let ownedPids:number[]=[],proved=false;let failure:unknown;
 let signalAt:number|undefined,signalCloseMs:number|undefined,reopenCloseAt:number|undefined,reopenCloseMs:number|undefined;
 try{
  original=forkHost(h,'seed',scenario);const ready=await original.next();
  assert.equal(ready.stage,'ready-for-signal');assert.equal(ready.pid,original.child.pid);
  assert.ok(ready.handlers[signal]>0);assert.equal(ready.handlers.SIGHUP,0,'no product SIGHUP handler; unsupported is explicit');
  ownedPids=ready.boundary.ownedPids;assert.ok(ready.boundary.livePids.every(alive),'real current native member and detached descendant are alive before signal');
  if(scenario==='peer'){assert.ok(ready.boundary.discussion.delivery.received);assert.equal(ready.boundary.discussion.delivery.state,'accepted');assert.equal(ready.boundary.initialBirths,2);assert.equal(ready.boundary.initialInputs,3);}
  const clusterBefore=JSON.parse(await readFile(path.join(h.home,'hima/database/credentials.json'),'utf8'));
  signalAt=Date.now();
  assert.equal(original.child.kill(signal),true,'send the actual OS signal to the process holding the actual Host');
  await original.ended();
  signalCloseMs=Date.now()-signalAt;
  assert.equal(original.child.exitCode,signal==='SIGINT'?130:0,original.stderr());assert.equal(original.child.signalCode,null);
  assert.ok(original.stderr().split('\n').includes(`hima: resource shutdown confirmed; pid=${original.child.pid}`),'forced zero exit alone cannot prove closure');
  const fence=JSON.parse(await readFile(path.join(h.home,'signal-evidence/fence-before-close.json'),'utf8'));
  assert.equal(fence.sessionKey,ready.boundary.native.prepared.sessionKey);assert.ok(fence.exit.requestId);assert.equal(fence.run.runId,ready.boundary.runId);assert.equal(fence.run.holdSource,'human');
  assert.match(fence.run.hold,/explicit controlled continuation required/);
  assert.ok(ownedPids.every(pid=>!alive(pid)),'all actual owned PIDs are physically absent before reopen');
  assert.equal(existsSync(path.join(h.home,'hima/database/data/postmaster.pid')),false);
  assert.equal(existsSync(path.join(h.home,'hima/database/host-owner')),false);
  reopened=forkHost(h,'reopen',scenario);const held=await reopened.next();assert.equal(held.stage,'cold-held');
  assert.notEqual(held.pid,ready.pid);assert.deepEqual(held.boundary,ready.boundary);
  assert.equal(held.events.filter((row:any)=>row.kind==='birth').length,ready.boundary.initialBirths);assert.equal(held.events.filter((row:any)=>row.kind==='input').length,ready.boundary.initialInputs);
  const clusterAfter=JSON.parse(await readFile(path.join(h.home,'hima/database/credentials.json'),'utf8'));
  assert.equal(clusterAfter.identity,clusterBefore.identity);assert.equal(clusterAfter.port,clusterBefore.port);
  reopened.child.send({action:'resume'});const resumed=await reopened.next();assert.equal(resumed.stage,'human-resumed');
  assert.equal(resumed.taskId,ready.boundary.taskId);assert.notEqual(resumed.currentRunId,ready.boundary.runId);
  assert.equal(resumed.events.filter((row:any)=>row.kind==='birth').length,ready.boundary.initialBirths+1);assert.equal(resumed.events.filter((row:any)=>row.kind==='input').length,ready.boundary.initialInputs+1);
  ownedPids=resumed.ownedPids;reopenCloseAt=Date.now();await reopened.close();reopenCloseMs=Date.now()-reopenCloseAt;
  assert.ok(ownedPids.every(pid=>!alive(pid)));assert.equal(existsSync(path.join(h.home,'hima/database/data/postmaster.pid')),false);
  proved=true;t.diagnostic(JSON.stringify({level:'L2-controlled-ordinary-Node',signal,scenario,hostBoots:2,productModelCalls:0,nativeSdkCalls:0,qualification:'no Pi/OpenCode L4; SIGHUP unsupported; no Campaign-continuation composition claim'}));
 }catch(error){
  failure=error;
  const report=JSON.stringify({signalCloseMs:signalCloseMs??(signalAt===undefined?null:Date.now()-signalAt),
   reopenCloseMs:reopenCloseMs??(reopenCloseAt===undefined?null:Date.now()-reopenCloseAt),
   originalExitCode:original?.child.exitCode,originalSignalCode:original?.child.signalCode,
   reopenedExitCode:reopened?.child.exitCode,reopenedSignalCode:reopened?.child.signalCode})+'\n'+
   String(error)+'\n'+[original?.stderr(),reopened?.stderr()].filter(Boolean).join('\n');
  await writeFile(path.join(h.home,'signal-failure.txt'),report,{mode:0o600});
  if(process.env.HIMA_SIGNAL_DIAGNOSTIC_DIR){
   const retained=path.join(process.env.HIMA_SIGNAL_DIAGNOSTIC_DIR,`${scenario}-${signal}-${Date.now()}`);
   await mkdir(retained,{recursive:true,mode:0o700});
   await writeFile(path.join(retained,'failure.txt'),report.slice(-32*1024),{mode:0o600});
   if(existsSync(path.join(h.home,'signal-evidence')))await cp(path.join(h.home,'signal-evidence'),path.join(retained,'signal-evidence'),{recursive:true});
   t.diagnostic('Retained failed signal fixture: '+retained);
  }
  throw error;
 }finally{
  // The original worker has no IPC closer: cleanup must use a genuine supported
  // production signal. Never broad-kill or delete a Home with unproved resources.
  if(original && original.child.exitCode===null && original.child.signalCode===null){original.child.kill('SIGTERM');await original.ended();}
  if(reopened && reopened.child.exitCode===null && reopened.child.signalCode===null)await reopened.close();
  if(!proved){
   try{const rows=(await readFile(path.join(h.home,'signal-evidence/events.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));ownedPids=rows.filter(row=>row.kind==='birth').flatMap(row=>[row.pid,row.descendant]);}catch{/* retain the Home when the actual owned inventory is unavailable */}
   const db=await startLocalDatabase({home:h.home});await db.stop();
   let noNativeStart=false;
   try{
    const intents=(await readFile(path.join(h.home,'signal-evidence/native-start-intents.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
    noNativeStart=intents.length===0&&ownedPids.length===0;
   }catch{/* no known start inventory cannot imply no native resources */}
   assert.equal(existsSync(path.join(h.home,'hima/database/data/postmaster.pid')),false,'failure cleanup must prove owned PostgreSQL ended');
   assert.equal(existsSync(path.join(h.home,'hima/database/host-owner')),false,'failure cleanup must release original owned PG writer');
   if(!noNativeStart&&(!ownedPids.length||ownedPids.some(alive)))throw new AggregateError([failure],`Retained ${h.home}: native resource closure unproved`);
   // A pre-Team error with confirmed empty start inventory remains the original
   // test failure. Cleanup proves no native start and PG closure; never PASS.
   if(noNativeStart)t.diagnostic('Original failure preserved; native start intents=0, retained native births=0, actual owned PostgreSQL closed.');
  }
  await h.dispose();
 }
});
