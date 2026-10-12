import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dbosHome,cleanDbosHome} from './support/dbos-process.ts';

// Normal frozen mage-scribe-placement Pack, actual Host/PG/wrapper/Reader; only the MAGE native
// executable and the resident Engineer/consumer ACP residents are stand-ins
// (test/fixtures/mage-resident-dry/{prepare.py,acp.py}). Proves the `repeat` of engineer-place ->
// four review-* -> decide-round runs its expected number of rounds on the real Host and durable
// runtime with zero model calls, for both a converging and a stalled/conflicting round sequence.
for(const mode of ['converge','conflict']) test(`mage-scribe-placement dry route ${mode}s through the real Host`,{timeout:240000},async(t)=>{
 const home=await dbosHome();
 const child=spawn(process.execPath,[fileURLToPath(new URL('./support/mage-resident-durable-worker.ts',import.meta.url)),home,mode],{env:process.env,stdio:['ignore','pipe','pipe','ipc']});
 const exited=new Promise<void>(resolve=>child.once('exit',()=>resolve()));
 let output='';child.stdout!.on('data',bytes=>output+=String(bytes));child.stderr!.on('data',bytes=>output+=String(bytes));
 const result=new Promise<any>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error(`mage worker exceeded 220s: ${output}`)),220000);child.once('message',proof=>{clearTimeout(timer);resolve(proof);});child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',()=>{clearTimeout(timer);reject(new Error(`mage worker exited without result: ${output}`));});});
 try {
  const proof=await result;
  t.diagnostic(JSON.stringify(proof));
  assert.equal(proof.ok,true,JSON.stringify(proof)+'\n'+output);
  assert.equal(proof.goalState,mode==='converge'?'met':'not-met',JSON.stringify(proof));
  assert.equal(proof.productModelCalls,0);
  assert.equal(proof.readerJobs,proof.engineeringJobs,'one Reader job per resident task execution');
  assert.equal(proof.engineeringJobs,proof.rounds*5,'five resident tasks (one Engineer, four consumers) per round');
  if(mode==='converge') {
   assert.equal(proof.rounds,2);
   assert.equal(proof.tasks,16);
   assert.equal(proof.goalMet,true,JSON.stringify(proof));
   assert.equal(proof.openRequests,0);
  } else {
   assert.equal(proof.rounds,4);
   assert.equal(proof.tasks,28);
   assert.equal(proof.goalMet,false,JSON.stringify(proof));
   assert.ok(proof.decisionRequests>=1,JSON.stringify(proof));
  }
 } finally {
  if(child.exitCode===null){const term=setTimeout(()=>child.kill('SIGTERM'),10000),kill=setTimeout(()=>child.kill('SIGKILL'),15000);try{await exited;}finally{clearTimeout(term);clearTimeout(kill);}}
  await cleanDbosHome(home);
 }
});
