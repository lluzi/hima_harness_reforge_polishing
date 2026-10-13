import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dbosHome,cleanDbosHome} from './support/dbos-process.ts';

// Normal frozen mage-script-placement Pack, actual Host/PG/wrapper/Reader; only the MAGE native
// executable and the resident Engineer ACP are stand-ins
// (test/fixtures/mage-script-dry/{prepare.py,acp.py}). Proves the `repeat` of engineer-script ->
// decide-round runs its expected number of rounds on the real Host and durable runtime with zero
// model calls, for a converging, a stalled and a blocked-then-recovering round sequence.
for(const mode of ['converge','stall','blocked']) test(`mage-script-placement dry route ${mode}s through the real Host`,{timeout:240000},async(t)=>{
 const home=await dbosHome();
 const child=spawn(process.execPath,[fileURLToPath(new URL('./support/mage-script-durable-worker.ts',import.meta.url)),home,mode],{env:process.env,stdio:['ignore','pipe','pipe','ipc']});
 const exited=new Promise<void>(resolve=>child.once('exit',()=>resolve()));
 let output='';child.stdout!.on('data',bytes=>output+=String(bytes));child.stderr!.on('data',bytes=>output+=String(bytes));
 const result=new Promise<any>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error(`mage-script worker exceeded 220s: ${output}`)),220000);child.once('message',proof=>{clearTimeout(timer);resolve(proof);});child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',()=>{clearTimeout(timer);reject(new Error(`mage-script worker exited without result: ${output}`));});});
 try {
  const proof=await result;
  t.diagnostic(JSON.stringify(proof));
  assert.equal(proof.ok,true,JSON.stringify(proof)+'\n'+output);
  assert.equal(proof.productModelCalls,0);
  assert.equal(proof.readerJobs,proof.engineeringJobs,'one Reader job per resident task execution');
  assert.equal(proof.engineeringJobs,proof.rounds,'one Engineer resident task per round');
  assert.equal(proof.readerJobs,proof.rounds,'one Reader job per round');
  if(mode==='converge') {
   assert.equal(proof.rounds,2);
   assert.equal(proof.tasks,8);
   assert.equal(proof.goalMet,true,JSON.stringify(proof));
   assert.equal(proof.proofLevel,'completion',JSON.stringify(proof));
   assert.equal(proof.journalEntries,2,JSON.stringify(proof));
  } else if(mode==='stall') {
   assert.equal(proof.rounds,3);
   assert.equal(proof.tasks,10);
   assert.equal(proof.goalMet,false,JSON.stringify(proof));
   assert.equal(proof.proofLevel,'reproduction',JSON.stringify(proof));
  } else {
   assert.equal(proof.rounds,2);
   assert.equal(proof.tasks,8);
   assert.equal(proof.goalMet,true,JSON.stringify(proof));
   assert.equal(proof.journalEntries,2,JSON.stringify(proof));
  }
 } finally {
  if(child.exitCode===null){const term=setTimeout(()=>child.kill('SIGTERM'),10000),kill=setTimeout(()=>child.kill('SIGKILL'),15000);try{await exited;}finally{clearTimeout(term);clearTimeout(kill);}}
  await cleanDbosHome(home);
 }
});
