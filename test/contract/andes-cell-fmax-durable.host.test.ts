import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dbosHome,cleanDbosHome} from './support/dbos-process.ts';

// Normal frozen andes-cell-fmax Pack + eda_cluster_ctu_01 Site, actual Host/PG/wrapper/Readers and
// the Site's own mock-EDA CLIs run locally (CTU_MOCK_TIME_SCALE=0) against a SYNTHETIC
// CTU_OPENC910_DATA bundle; only the five resident engineering roles are stand-ins
// (test/fixtures/andes-resident-dry/{prepare.py,acp.py}), each drafting its delivery from the Site
// tools' own `andes_cli.py draft` output. Proves the legacy-compiled graph (two parallel
// propose/verify forks, a revisit repeat, the deterministic next-round explore) runs end to end on
// the real durable runtime with zero product model calls and meets the +1 % timing Goal in one round.
test('andes-cell-fmax dry route runs through the real Host to the +1 % Goal in one round',{timeout:240000},async(t)=>{
 const home=await dbosHome();
 const child=spawn(process.execPath,[fileURLToPath(new URL('./support/andes-resident-durable-worker.ts',import.meta.url)),home],{env:process.env,stdio:['ignore','pipe','pipe','ipc']});
 const exited=new Promise<void>(resolve=>child.once('exit',()=>resolve()));
 let output='';child.stdout!.on('data',bytes=>output+=String(bytes));child.stderr!.on('data',bytes=>output+=String(bytes));
 const result=new Promise<any>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error(`andes worker exceeded 220s: ${output}`)),220000);child.once('message',proof=>{clearTimeout(timer);resolve(proof);});child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',()=>{clearTimeout(timer);reject(new Error(`andes worker exited without result: ${output}`));});});
 try {
  const proof=await result;
  t.diagnostic(JSON.stringify(proof));
  assert.equal(proof.ok,true,JSON.stringify(proof)+'\n'+output);
  // One round meets the default +1 % Goal, and the explore stops at goal-met.
  assert.equal(proof.rounds,1,JSON.stringify(proof));
  assert.equal(proof.goalMet,true,JSON.stringify(proof));
  assert.equal(proof.goalState,'met',JSON.stringify(proof));
  assert.ok(proof.timingGain>=1,JSON.stringify(proof));
  // No product model call anywhere in the durable run (the forks' residents are ACP stand-ins and
  // the next-round chooser is a deterministic converge decision).
  assert.equal(proof.productModelCalls,0,JSON.stringify(proof));
  // One resident-delivery Reader job per resident task execution (five per round).
  assert.equal(proof.engineeringJobs,5,JSON.stringify(proof));
  assert.equal(proof.readerJobs,proof.engineeringJobs,JSON.stringify(proof));
  // Both parallel forks genuinely overlapped: each fork's two branches started before either finished.
  assert.equal(proof.proposeForkOverlap,true,JSON.stringify(proof));
  assert.equal(proof.verifyForkOverlap,true,JSON.stringify(proof));
  // The workspace-reconstructing Readers (read-requirements.py / read-plan.py / read-verify.py) all
  // admitted their deliveries: their report-path asserts hold under hima-task-effect/2.
  assert.equal(proof.requirementsValid,true,JSON.stringify(proof));
  assert.equal(proof.planValid,true,JSON.stringify(proof));
  assert.equal(proof.verifyValid,true,JSON.stringify(proof));
 } finally {
  if(child.exitCode===null){const term=setTimeout(()=>child.kill('SIGTERM'),10000),kill=setTimeout(()=>child.kill('SIGKILL'),15000);try{await exited;}finally{clearTimeout(term);clearTimeout(kill);}}
  await cleanDbosHome(home);
 }
});
