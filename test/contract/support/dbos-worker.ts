import assert from 'node:assert/strict';
import { appendFile, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root=fileURLToPath(new URL('../../../packages/harness/',import.meta.url));
const require=createRequire(path.join(root,'package.json'));
const {Pool}=require('pg');
const hostRequire=createRequire(require.resolve('@deepseek-ai/dsh/package.json'));
async function moduleAt(name:string){return import(pathToFileURL(hostRequire.resolve(name)).href);}
const {DBOS}=await import(pathToFileURL(require.resolve('@dbos-inc/dbos-sdk')).href);
const lib=process.env.HIMA_DBOS_TEST_LIB ?? path.join(root,'lib');
const {startDurableRuntime}=await import(pathToFileURL(path.join(lib,'durable-runtime.js')).href);
const {jsonDigest}=await import(pathToFileURL(path.join(lib,'run-store.js')).href);
const {startLocalDatabase}=await import(pathToFileURL(path.join(lib,'local-database.js')).href);
const [home,mode]=process.argv.slice(2);
if(!home) throw new Error('Private DBOS Home required');
const database=await startLocalDatabase({home,runtimeDirectory:process.env.HIMA_POSTGRES_RUNTIME});
const manifest={files:{'test-executable':'a'.repeat(64)},adapters:{'test-task':'1'}};
let systemLock:any;
const marker=path.join(home,'business-calls');
if(mode==='startup') {
  await assert.rejects(startDurableRuntime({database,manifest:{files:{},adapters:{}}}),/Freeze executable/);
  const saved=process.env.DBOS__CLOUD;process.env.DBOS__CLOUD='true';
  try {await assert.rejects(startDurableRuntime({database,manifest}),/private local DBOS/);}
  finally {if(saved===undefined)delete process.env.DBOS__CLOUD;else process.env.DBOS__CLOUD=saved;}
}
const runtime=await startDurableRuntime({database,manifest,workflows:[{name:'hima-test-commit',async execute(runtime:any,input:any){
  // Frozen input selects the same durable operation sequence on every outage recovery.
  if(input.outageGate) {
    await DBOS.setEvent('before-business',{effectId:'effect-u3'});
    assert.equal(await DBOS.recv('resume-business'), 'resume');
  }
  await DBOS.runStep(async()=>{await appendFile(marker,'called\n');return true;},{name:'test-business-call',retriesAllowed:false});
  if(mode==='checkpoint-crash') {
    systemLock=await new Pool(database.system).connect();
    await systemLock.query('BEGIN');await systemLock.query('LOCK TABLE dbos.operation_outputs IN SHARE MODE');
  }
  const result=await runtime.store.commitResult(resultFor(runtime.applicationVersion));
  return result.value;
}}]});
const store=runtime.store;
const runId='run-u3';const effectId='effect-u3';
function opening(version:string){return {runId,inputSha256:'b'.repeat(64),applicationVersion:version,owner:'owner',deadlineAt:'2099-01-01T00:00:00.000Z',data:{packSha256:'c'.repeat(64),irSha256:'d'.repeat(64),method:'frozen'}};}
function identity(version:string){return {runId,taskId:'task',effectId,inputSha256:'b'.repeat(64),packSha256:'c'.repeat(64),irSha256:'d'.repeat(64),applicationVersion:version,adapterVersion:'1'};}
function resultFor(version:string){return {schema:'hima-task-result/1',identity:identity(version),outputSchemaVersion:'1',value:{answer:42},artifacts:[],diagnostics:[]};}
if(mode==='idempotency' || mode==='startup') {
  await assert.rejects(startDurableRuntime({database,manifest}),/already owns/);
  const held=await store.createRun(opening(runtime.applicationVersion));
  assert.deepEqual(await store.createRun(opening(runtime.applicationVersion)),held);
  await assert.rejects(store.createRun({...opening(runtime.applicationVersion),data:{method:'different'}}),/different input/);
  const command={runId,commandId:'pause-once',action:'pause',owner:'owner',epoch:0,revision:0};
  const receipt=await store.command(command);assert.deepEqual(await store.command(command),receipt);
  await assert.rejects(store.command({...command,action:'cancel'}),/different input/);
  // Previously these legitimate command/result identities emitted the same outbox ID.
  const collisionRunId='run-11111111-1111-1111-1111-111111111111';
  const collisionIdentity={...identity(runtime.applicationVersion),runId:collisionRunId,effectId:`${collisionRunId}:command:c`};
  const collisionOpening={...opening(runtime.applicationVersion),runId:collisionRunId};
  const collisionCommand={runId:collisionRunId,commandId:'c:result',action:'pause',owner:'owner',epoch:0,revision:0};
  const collisionResult={...resultFor(runtime.applicationVersion),identity:collisionIdentity};
  await store.createRun(collisionOpening);await store.prepareEffect(collisionIdentity,{tool:'fixture'});
  const collisionReceipt=await store.command(collisionCommand);
  assert.deepEqual(await store.commitResult(collisionResult),collisionResult);
  const firstPhaseIdentity={...collisionIdentity,effectId:'phase:effect:a'};
  const secondPhaseIdentity={...collisionIdentity,effectId:'phase'};
  for(const retainedIdentity of [firstPhaseIdentity,secondPhaseIdentity]) await store.prepareEffect(retainedIdentity,{tool:'fixture'});
  await store.recordEffectFact(firstPhaseIdentity,'b',{stopped:true});
  await store.recordEffectFact(secondPhaseIdentity,'a:effect:b',{stopped:true});
  const retained=await store.pendingFacts(collisionRunId);
  assert.deepEqual(retained.map((fact:any)=>fact.kind),['run-opened','control','task-result','effect-fact','effect-fact']);
  assert.equal(new Set(retained.map((fact:any)=>fact.factId)).size,5);
  assert.deepEqual(await store.createRun(collisionOpening),collisionReceipt);
  assert.deepEqual(await store.command(collisionCommand),collisionReceipt);
  assert.deepEqual(await store.commitResult(collisionResult),collisionResult);
  await store.recordEffectFact(firstPhaseIdentity,'b',{stopped:true});
  await store.recordEffectFact(secondPhaseIdentity,'a:effect:b',{stopped:true});
  assert.deepEqual(await store.pendingFacts(collisionRunId),retained,'Replay retains original IDs, sequence, timestamps and payloads');
  process.send!({ok:true,identity:database.identity});
} else if(mode==='rollback') {
  await store.createRun(opening(runtime.applicationVersion));await store.prepareEffect(identity(runtime.applicationVersion),{tool:'fixture'});
  await assert.rejects(store.transaction(async(client:any)=>{await client.query("INSERT INTO hima.results VALUES($1,$2,$3,$4,$5)",[effectId,runId,'b'.repeat(64),jsonDigest(resultFor(runtime.applicationVersion)),JSON.stringify(resultFor(runtime.applicationVersion))]);throw new Error('rollback-proof');},'test-rollback'),/rollback-proof/);
  assert.equal(await store.result(effectId),undefined);assert.equal((await store.pendingFacts()).filter((fact:any)=>fact.kind==='task-result').length,0);
  await store.recordEffectFact(identity(runtime.applicationVersion),'released',{stopped:true});
  await store.recordEffectFact(identity(runtime.applicationVersion),'released',{stopped:true});
  await assert.rejects(store.recordEffectFact(identity(runtime.applicationVersion),'released',{stopped:false}),/different input/);
  await assert.rejects(store.prepareEffect({...identity(runtime.applicationVersion),inputSha256:'e'.repeat(64)},{tool:'fixture'}),/different input/);
  const invalidArtifact={runId:'wrong',taskId:'task',effectId,name:'evidence',path:'evidence/result.json',sha256:'e'.repeat(64)};
  await assert.rejects(store.commitResult({...resultFor(runtime.applicationVersion),artifacts:[invalidArtifact]}),/artifact identity/);
  process.send!({ok:true,identity:database.identity,port:database.application.port,credentialDigest:jsonDigest(database.application)});
} else if(mode==='admission') {
  await store.createRun(opening(runtime.applicationVersion));await store.prepareEffect(identity(runtime.applicationVersion),{tool:'fixture'});
  const admission={runId,effectId,owner:'owner',epoch:0,revision:0};
  await assert.rejects(store.assertEffectAdmission(admission,async()=>false),/Permit/);
  await store.assertEffectAdmission(admission,async()=>{await appendFile(path.join(home,'admission-calls'),'admitted\n');return true;});
  await store.command({runId,commandId:'hold',action:'pause',owner:'owner',epoch:0,revision:0});
  await assert.rejects(store.assertEffectAdmission(admission,async()=>true),/blocked/);
  await store.command({runId,commandId:'resume',action:'continue',owner:'owner',epoch:1,revision:0});
  await runtime.startWorkflow('hima-test-commit','workflow-u3',{runId,outageGate:true});
  assert.deepEqual(await DBOS.getEvent('workflow-u3','before-business'),{effectId});
  const workflow=await DBOS.getWorkflowStatus('workflow-u3');
  assert.equal(workflow?.status,'PENDING');assert.equal(workflow.applicationVersion,runtime.applicationVersion);
  assert.equal(await store.result(effectId),undefined,'Workflow is persisted before business invocation');
  const pool=new Pool(database.application);await pool.query("SELECT pg_postmaster_start_time() AS started");await pool.end();
  process.send!({ok:true,stage:'before-interrupt',admission:{...admission,epoch:2},workflow,version:runtime.applicationVersion});
} else if(mode==='outage-recover') {
  // Reopen the retained pending workflow; starting a new workflow would conceal a resume defect.
  let workflow=await DBOS.getWorkflowStatus('workflow-u3');
  // Launch re-enqueues recovered workflows before their original durable wait resumes.
  while(workflow?.status==='ENQUEUED') {
    await new Promise(resolve=>setTimeout(resolve,10));
    workflow=await DBOS.getWorkflowStatus('workflow-u3');
  }
  assert.equal(workflow?.status,'PENDING');assert.equal(workflow.applicationVersion,runtime.applicationVersion);
  assert.deepEqual(workflow.input,[{runId,outageGate:true}]);
  assert.equal((await store.run(runId)).applicationVersion,workflow.applicationVersion);
  assert.deepEqual(await DBOS.getEvent('workflow-u3','before-business'),{effectId});
  assert.equal((await store.effect(effectId)).phase,'admitted');
  assert.equal(await store.result(effectId),undefined);
  process.send!({ok:true,stage:'persisted-workflow-reopened',workflow});
  const handle=DBOS.retrieveWorkflow('workflow-u3');
  await DBOS.send('workflow-u3','resume','resume-business','outage-resume-u3');
  assert.deepEqual(await handle.getResult(),{answer:42});
  assert.equal(await readFile(marker,'utf8'),'called\n','Original invocation performs business work exactly once');
  assert.deepEqual((await store.result(effectId)).identity,identity(runtime.applicationVersion));
  assert.equal((await store.effect(effectId)).phase,'admitted');
  const facts=await store.pendingFacts(runId);
  assert.equal(facts.filter((fact:any)=>fact.kind==='task-result').length,1);
  assert.equal(new Set(facts.map((fact:any)=>fact.factId)).size,facts.length);
  process.send!({ok:true,facts,workflow:await handle.getStatus(),version:runtime.applicationVersion});
} else {
  await store.createRun(opening(runtime.applicationVersion));await store.prepareEffect(identity(runtime.applicationVersion),{tool:'fixture'});
  if(mode==='checkpoint-crash') {
    void runtime.startWorkflow('hima-test-commit','workflow-u3',{runId});
    while(!await store.result(effectId)) await new Promise(resolve=>setTimeout(resolve,10));
    const verify=new Pool(database.system);
    // SHARE permits checkpoint reads and blocks its insert. Establish that the write is waiting.
    let waiting=false;
    while(!waiting){const rows=(await verify.query("SELECT 1 FROM pg_locks WHERE NOT granted AND relation='dbos.operation_outputs'::regclass")).rows;waiting=rows.length>0;if(!waiting)await new Promise(resolve=>setTimeout(resolve,10));}
    await verify.end();process.send!({ok:true,stage:'application-committed-checkpoint-blocked'});
  } else {
    const handle=await runtime.startWorkflow('hima-test-commit','workflow-u3',{runId});assert.deepEqual(await handle.getResult(),{answer:42});
    assert.equal((await readFile(marker,'utf8')).trim().split('\n').length,1,'Committed business step does not execute again');
    assert.deepEqual((await store.result(effectId)).value,{answer:42});
    const pending=await store.pendingFacts();assert.equal(pending.filter((fact:any)=>fact.kind==='task-result').length,1);
    if(mode==='projection-crash' || mode==='projection-recover') {
      const {Context}=await moduleAt('@deepseek-ai/cordis');const {Storage}=await moduleAt('@deepseek-ai/dsh-storage');
      const {JsonStorageBackend}=await moduleAt('@deepseek-ai/dsh-storage-json');const {DomainFacility}=await moduleAt('@deepseek-ai/dsh-storage-domain');
      const {Ledger,ledgerSpec}=await import(pathToFileURL(path.join(lib,'ledger.js')).href);
      const ctx=new Context();const storage=new Storage(ctx);const backend=new JsonStorageBackend(path.join(home,'history'));
      storage.backend.register('json',backend);const facility=new DomainFacility(ctx,{backend:'json'});const domain=await facility.open(ledgerSpec);const ledger=new Ledger(domain);
      const project=async(fact:any)=>{await ledger.projectDurableFact(fact,{campaignId:'campaign-u3',siteId:'site-u3',purpose:'campaign',status:'running',currentNode:'legacy-node'});assert.equal(ledger.run(runId).status,undefined);assert.equal(ledger.run(runId).currentNode,undefined);};
      if(mode==='projection-crash') {
        await assert.rejects(store.projectFacts(async()=>{throw new Error('projection-down');}),/projection-down/);
        assert.equal((await store.pendingFacts()).length,2);
        for(const fact of pending) await project(fact);
        assert.equal(ledger.records({runId}).length,2);await domain.close();await backend.close();await ctx.fiber.dispose();
        process.send!({ok:true,stage:'projection-written-before-ack'});
      } else {
        await store.projectFacts(project);assert.equal(ledger.records({runId}).length,2);assert.equal((await store.pendingFacts()).length,0);
        assert.equal((await readFile(marker,'utf8')).trim().split('\n').length,1);
        await domain.close();await backend.close();await ctx.fiber.dispose();process.send!({ok:true,stage:'projection-recovered'});
      }
    } else process.send!({ok:true,facts:pending,version:runtime.applicationVersion});
  }
}
await new Promise<void>((resolve,reject)=>{process.on('message',async(message:any)=>{
  if(message.action==='close') {try{await runtime.stop();await database.stop();resolve();}catch(error){reject(error);}}
});});
process.disconnect();
