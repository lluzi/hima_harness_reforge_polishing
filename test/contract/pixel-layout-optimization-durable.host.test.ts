import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dbosHome,cleanDbosHome} from './support/dbos-process.ts';

// Normal frozen pixel-layout-optimization Pack, actual Host/PG/resident wrapper/Reader; only the EDA
// tools and the resident engineer ACP are stand-ins (test/fixtures/pixel-dry/{prepare.py,acp.py}).
// Proves the whole hima-flow/1 graph, including the repeat of plan-round -> solve-and-judge ->
// decide-round, runs its expected number of rounds on the real Host and durable runtime with zero
// model calls, one resident engineering job and one pixel-plan Reader job per round, ending goal-met.
test('pixel-layout-optimization dry route runs the whole graph through the real Host',{timeout:1620000},async(t)=>{
 const home=await dbosHome();
 const child=spawn(process.execPath,[fileURLToPath(new URL('./support/pixel-dry-durable-worker.ts',import.meta.url)),home],{env:process.env,stdio:['ignore','pipe','pipe','ipc']});
 const exited=new Promise<void>(resolve=>child.once('exit',()=>resolve()));
 let output='';child.stdout!.on('data',bytes=>output+=String(bytes));child.stderr!.on('data',bytes=>output+=String(bytes));
 const result=new Promise<any>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error(`pixel worker exceeded 1560s: ${output}`)),1560000);child.once('message',proof=>{clearTimeout(timer);resolve(proof);});child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',()=>{clearTimeout(timer);reject(new Error(`pixel worker exited without result: ${output}`));});});
 try {
  const proof=await result;
  t.diagnostic(JSON.stringify(proof));
  assert.equal(proof.ok,true,JSON.stringify(proof,null,1)+'\n'+output.slice(-6000));
  assert.equal(proof.productModelCalls,0);
  assert.ok(proof.rounds>=1,JSON.stringify(proof));
  assert.equal(proof.readerJobs,proof.engineeringJobs,'one Reader job per resident task execution');
  assert.equal(proof.engineeringJobs,proof.rounds,'one resident engineering job per round');
  assert.equal(proof.readerJobs,proof.rounds,'one pixel-plan Reader job per round');
  assert.equal(proof.tasks,6+proof.rounds*3,JSON.stringify(proof));
  assert.equal(proof.goalState,'met',JSON.stringify(proof));
  assert.equal(proof.ending,'goal-met',JSON.stringify(proof));
  assert.equal(proof.goalMet,true,JSON.stringify(proof));
 } finally {
  if(child.exitCode===null){const term=setTimeout(()=>child.kill('SIGTERM'),10000),kill=setTimeout(()=>child.kill('SIGKILL'),15000);try{await exited;}finally{clearTimeout(term);clearTimeout(kill);}}
  await cleanDbosHome(home);
 }
});
