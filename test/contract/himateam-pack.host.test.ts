// #105 L2: actual Host, private application PG and DBOS; ordinary Node IPC native
// delivery through production Local/OAR retention and physical process closure.
// No committed TaskResult, native-close proof or kernel transition is fabricated.
// Registered local contract; no product model effectiveness claim.
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, appendFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { stringify } from 'yaml';
import type { FlowAdapterContext, TeamDefinition } from '@hima/harness';
import { bootInProcess, createRootAgent } from './support/boot-inprocess.ts';
import { localHome, waitUntil } from './support/fabric.ts';
import { preparedFixtureRun, assertFixturePublication } from './support/u9-fixture-product-run.ts';
import { teamFixture } from './support/himateam.ts';

process.env.HIMA_TEST_SILENT_AGENT='1';process.env.HIMA_TEST_LEGACY_AUTO_DRIVE='0';
const lib=process.env.HIMA_DBOS_TEST_LIB??path.resolve('packages/harness/lib');
const localModule=await import(pathToFileURL(path.join(lib,'oar-local-member.js')).href) as typeof import('../../packages/harness/lib/types/oar-local-member.js');
const memberModule=await import(pathToFileURL(path.join(lib,'oar-member-process.js')).href) as typeof import('../../packages/harness/lib/types/oar-member-process.js');
const workflow=await import(pathToFileURL(path.join(lib,'flow-workflow.js')).href) as typeof import('../../packages/harness/lib/types/flow-workflow.js');
const {jsonDigest}=await import(pathToFileURL(path.join(lib,'run-store.js')).href) as typeof import('../../packages/harness/lib/types/run-store.js');
const {createDurableViewReaders}=await import(pathToFileURL(path.join(lib,'durable-views.js')).href) as typeof import('../../packages/harness/lib/types/durable-views.js');
const {resolveRetainedMaterialsDirectory}=await import(pathToFileURL(path.join(lib,'local-database.js')).href) as typeof import('../../packages/harness/lib/types/local-database.js');
type Plan=import('../../packages/harness/lib/types/run-store.js').PackTeamPlan;
type Prepared=import('../../packages/harness/lib/types/oar-task-adapter.js').OarPrepared;
const draft='https://json-schema.org/draft/2020-12/schema';
const sha=(bytes:string|Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const resultBytes='Actual retained Team artifact\n';
const alive=(pid:number)=>{try{process.kill(pid,0);return true;}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')return false;throw error;}};

async function fixture(t:TestContext,options:{wrongParentOutput?:boolean;gateChild?:boolean;observeNativeFamily?:boolean;compatibleHandoff?:boolean;branchParent?:boolean;diagnostic?:string}={}) {
  const home=await localHome(t,{sleepSeconds:0});assert.ok(home);
  const diagnosticRoot=options.diagnostic&&process.env.HIMA_PACK_DIAGNOSTIC_DIR
    ?path.resolve(process.env.HIMA_PACK_DIAGNOSTIC_DIR,options.diagnostic):undefined;
  if(diagnosticRoot)await mkdir(diagnosticRoot,{recursive:true});
  let diagnosticFamily:{pid:number;descendant:number}|undefined;
  let diagnostic:(stage:string)=>Promise<void>=async()=>{};
  const diagnosticError=(error:unknown)=>({name:error instanceof Error?error.name:'non-Error',message:error instanceof Error?error.message.slice(0,240):'unavailable'});
  const diagnosticEmit=async(value:unknown)=>{if(diagnosticRoot)await appendFile(path.join(diagnosticRoot,'stages.jsonl'),JSON.stringify(value)+'\n');};
  let host=await bootInProcess(home.h),service=host.ctx.hima;await service.reconciled;
  let store=service.durable.store;const evidence=path.join(home.h.home,'pack-team-evidence');await mkdir(evidence,{recursive:true});
  const runner=path.join(evidence,'controlled-runner.mjs');
  await writeFile(runner,`
import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';import {spawn} from 'node:child_process';
const evidence=${JSON.stringify(evidence)};let c;
const log=value=>fs.appendFileSync(path.join(evidence,'events.jsonl'),JSON.stringify({...value,pid:process.pid})+'\\n');
process.send({type:'ready'});
process.on('message',m=>{
 if(m.type==='config'){c=m.config;if(${JSON.stringify(options.observeNativeFamily??false)}){const descendant=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',detached:true});const originalFile=path.join(evidence,'original.json');if(!fs.existsSync(originalFile))fs.writeFileSync(originalFile,JSON.stringify({pid:process.pid,descendant:descendant.pid}));}log({kind:'created',identity:c.prepared.identity});process.send({type:'created',payload:{runtime:c.prepared.runtime,nativeSession:'pack-node-'+c.prepared.identity.effectId}});}
 if(m.type==='input'){
  const p=c.prepared;log({kind:'input',identity:p.identity,text:m.input});
  process.send({type:'received',payload:{inputId:m.id,evidence:'actual-controlled-node-receive'}});
  const finish=()=>{
   const content=${JSON.stringify(resultBytes)},name='tiny.txt';fs.writeFileSync(path.join(c.workDirectory,name),content);
   const output={schemaVersion:c.outputSchemaVersion,value:{answer:'measured-negative'},artifacts:[{runId:p.identity.runId,taskId:p.identity.taskId,effectId:p.identity.effectId,name:'tiny',path:name,sha256:createHash('sha256').update(content).digest('hex')}],diagnostics:[]};
   process.send({type:'terminal',payload:{inputId:m.id,outcome:{kind:'completed'}}});
   process.send({type:'finished',inputId:m.id,text:JSON.stringify(output)});
  };
  const timer=setInterval(()=>{if(fs.existsSync(path.join(evidence,'deliver'))){clearInterval(timer);finish();}},10);
 }
});setInterval(()=>{},1000);
`);
  const assets={oarModule:'controlled-node-no-sdk',nodeExecutable:process.execPath,opencodeCommand:'controlled-node-no-cli',opencodeVersion:'fixture'};
  let runtime=new localModule.OarLocalMemberRuntime({home:home.h.home,nodeExecutable:process.execPath,runnerModule:runner,assets});
  let unknownClose=false,childGate=options.gateChild??false;
  const local:NonNullable<import('../../packages/harness/lib/types/oar-member-process.js').OarMemberProcessOptions['localRuntime']>={
    stage:(...args)=>runtime.stage(...args),start:(...args)=>runtime.start(...args),read:(...args)=>runtime.read(...args),authorize:(...args)=>runtime.authorize(...args),reply:(...args)=>runtime.reply(...args),sendInput:(...args)=>runtime.sendInput(...args),readArtifact:(...args)=>runtime.readArtifact(...args),recover:(...args)=>runtime.recover(...args),captureClosedContext:(...args)=>runtime.captureClosedContext(...args),stopAll:()=>runtime.stopAll(),
    close:async(lease,closeOptions)=>{
      if(!unknownClose)return runtime.close(lease,closeOptions);
      // Exercise the real PID/birth mismatch refusal without supplying any closed fact.
      const file=path.join(home.h.home,'hima/oar-members',lease.sessionKey,'lease.json'),bytes=await readFile(file,'utf8');
      try {
        await writeFile(file,JSON.stringify({...JSON.parse(bytes),startIdentity:'intentional-pack-test-birth-mismatch'}));
        const verifier=new localModule.OarLocalMemberRuntime({home:home.h.home,nodeExecutable:process.execPath,runnerModule:runner,assets});
        const original=await verifier.recover(lease.sessionKey);assert.ok(original);
        const refused=await verifier.close(original);assert.equal(refused.closed,false);return refused;
      }finally{await writeFile(file,bytes);}
    },
  };
  const materials=await resolveRetainedMaterialsDirectory({home:home.h.home});
  const makeExecutor=()=>memberModule.createOarMemberExecutor({home:home.h.home,retainedMaterialsDir:materials,store,services:{} as import('../../packages/harness/lib/types/team-service-runtime.js').TeamServiceRuntime,localRuntime:local,runtimeAssets:async()=>assets,
    sharedDeepSeekModel:async()=>{throw new Error('No product model fallback permitted');},memberContext:async()=>{throw new Error('No native MCP invocation in this fixture');}});
  let executor=makeExecutor();
  t.after(async()=>{
    if(diagnosticRoot)await diagnostic('before-fixture-cleanup');
    unknownClose=false;childGate=false;await writeFile(path.join(evidence,'deliver'),'cleanup');
    await runtime.stopAll();await host.dispose();await executor.dispose();
    if(diagnosticRoot){const retainedHome=path.join(diagnosticRoot,'actual-stopped-home');await rename(home.h.home,retainedHome);
      await diagnosticEmit({stage:'actual-home-retained-after-normal-disposal',at:new Date().toISOString(),actualHome:home.h.home,retainedHome});}
    else await home.h.dispose();
  });
  const guide=String((await createRootAgent(host.ctx,home.h.workspace)).id);
  await service.teamOperation(guide,{action:'configure-model',request:{modelRef:'fixture-model',runtime:'opencode',provider:'openai-completions',model:'controlled-node',baseUrl:'https://fixture.invalid/v1',apiKey:'private-fixture-only'}},'human');
  const saved=await service.teamOperation(guide,{action:'save',definition:teamFixture,expectedVersion:null}) as {teamId:string;projectId:string;version:number;sha256:string};
  // Saved Team is configured once. Pack opening still uses its authentic Guide/project
  // through the product's Host resolver; tests never inject a project resolver grant.
  const frozen=await store.readTeamDefinition(saved.projectId,saved.teamId,1);assert.ok(frozen);
  const bindExecutor=()=>{service.teamExecutor={readiness:async()=>({ready:true,missing:[]}),resolve:async(context:FlowAdapterContext)=>{
    if(childGate)throw new workflow.TaskAdapterMaterializationError({code:'controlled-child-materialization',message:'Child materialization gated by L2 fixture.',source:'test-fixture'});
    return executor.resolve(context);
  }};};bindExecutor();
  const dir=path.join(home.h.home,'hima/packs/pack-team-test');await mkdir(path.join(dir,'flow/tools'),{recursive:true});
  const inputSchema={version:'pack-team-input/1',schema:{$schema:draft,type:'object',properties:{goal:{type:'string'},input:{},closure:{type:'string'}},required:['goal','input','closure'],additionalProperties:false}};
  const parentOutput={version:options.compatibleHandoff?teamFixture.delivery.output.version:'pack-original-output/9',schema:options.wrongParentOutput?{$schema:draft,type:'object',properties:{answer:{type:'number'}},required:['answer'],additionalProperties:false}:teamFixture.delivery.output.schema};
  const downstreamOutput={version:'pack-downstream/1',schema:{$schema:draft,type:'object',properties:{done:{const:true}},required:['done'],additionalProperties:false}};
  const contract={id:'pack-team-test',version:'1',title:'Pack Team actual delegation',inputs:[{name:'workspaceRoot'}],environment:{wrappers:['/bin/sh']},workspace:{source:'pack',copy:['tools/consume.sh']},teamDelegations:[{id:'team-call',nodeId:'call',team:{teamId:saved.teamId,version:1,sha256:frozen.sha256}}],tools:[{id:'consume',file:'tools/consume.sh',inputs:['WORKSPACE','FLOW','TASK_OUTPUT','TASK_INPUT'],argv:['/bin/sh','${FLOW}/tools/consume.sh','${WORKSPACE}','${TASK_OUTPUT}','${TASK_INPUT}'],licences:{}}]};
  const graph={schema:'hima-flow/1',id:'pack-team-test',version:'1',flow:{kind:'sequence',id:'delivery',steps:[
    {kind:'task',id:'call',tool:'resident/team-delegate',contract:{input:inputSchema,output:parentOutput},inputs:{goal:{source:'literal',value:'Return the measured negative answer and retained tiny artifact.'},input:{source:'literal',value:{experiment:'original'}},closure:{source:'literal',value:'Return answer with one actual tiny artifact.'}}},
    {kind:'task',id:'consume',tool:'consume',contract:{input:{version:'consume-input/1',schema:{$schema:draft,type:'object',properties:{answer:{type:'string'},artifact:{type:'object'}},required:['answer','artifact'],additionalProperties:false}},output:downstreamOutput},inputs:{answer:{source:'committedOutput',taskId:'call',path:['answer']},artifact:{source:'artifactRef',taskId:'call',name:'tiny'}}},
  ]}};
  if(options.branchParent){const call=graph.flow.steps[0]!;graph.flow.steps[0]={kind:'parallel',id:'team-branch',branches:{delivery:{flow:call,required:true}},results:{}} as unknown as typeof call;}
  await writeFile(path.join(dir,'contract.yml'),stringify(contract));await writeFile(path.join(dir,'graph.yml'),stringify(graph));
  const consumeScript='cat "$3" >> "$1/consumed.jsonl"\nprintf \'\\n\' >> "$1/consumed.jsonl"\nprintf \'{"schemaVersion":"pack-downstream/1","value":{"done":true},"artifacts":[],"diagnostics":[]}\\n\' > "$2"\n';
  await mkdir(path.join(dir,'tools'),{recursive:true});
  await writeFile(path.join(dir,'tools/consume.sh'),consumeScript);
  await writeFile(path.join(dir,'flow/tools/consume.sh'),consumeScript);
  const started=await preparedFixtureRun(host,{pack:'pack-team-test',site:'local',ownerSessionId:guide,goal:{target_period_ns:10},strategy:{},timeBoxMs:90000,retryAllowance:3,generationLimit:1});
  const parentRun=started.run;
  let parent!:import('../../packages/harness/lib/types/run-store.js').FlowInvocationRecord;
  let plan!:Plan;
  await waitUntil('actual Pack original node retained plan',async()=>{
    parent=(await store.flowInvocations(parentRun.runId)).find(row=>row.identity.taskId==='call')!;
    if(!parent)return false;plan=await store.effectFact(parent.identity.effectId,'prepared') as unknown as Plan;return !!plan?.childRunId;
  },30000,25);
  const snapshot=()=>store.readPackTeamDelegation(parent.identity);
  const readEvents=async()=>{try{return(await readFile(path.join(evidence,'events.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line) as {kind:string;pid:number;identity:Prepared['identity'];text?:string});}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return [];throw error;}};
  const children=()=>store.listTeamTasks(plan.projectId,plan.delegation.team.teamId);
  const downstream=async()=>(await store.flowInvocations(parentRun.runId)).filter(row=>row.identity.taskId==='consume');
  const control=async(action:'pause'|'continue'|'cancel',branch=false)=>{const run=await store.run(parentRun.runId);return(await workflow.controlFlow(service.durable,{runId:run.runId,commandId:`pack-test-${action}-${branch?'branch':'whole'}-${run.epoch}`,action,...(branch?{scope:{taskId:'call'}}:{}),origin:'human',owner:run.owner,epoch:run.epoch,revision:run.revision})).getResult();};
  const readers=createDurableViewReaders({ledger:service.ledger,judge:service.judge,durable:service.durable,host:host.ctx,sitesDir:path.join(home.h.home,'hima/sites'),packsDir:path.join(home.h.home,'hima/packs')},{retainedMaterialsDir:materials});
  const diagnosticAttempt=async(stage:string)=>{
    if(!diagnosticRoot)return;
    const began=Date.now();let probeReads=0;
    const read=async<T,>(operation:()=>Promise<T>)=>{probeReads++;try{return await operation();}catch(error){return {probeError:diagnosticError(error)};}};
    const rows=[];
    for(const runId of [parentRun.runId,plan.childRunId]){
      const run=await store.run(runId),authority=await store.flowAuthority(runId),projection=await store.flowProjection(runId),physical=await store.flowPhysicalFacts(runId);
      probeReads+=4;
      const effects=[];
      for(const effect of physical.effects){
        const snap=await store.effectSnapshot(effect.identity);probeReads++;
        const p=snap.facts.prepared as unknown as Partial<Prepared>|undefined;
        let native:unknown;
        if(p?.schema==='hima-oar-task/1'&&p.sessionKey&&p.generation!==undefined){
          const grant=await store.readTeamGrant('grant-'+jsonDigest([p.sessionKey,p.generation]));probeReads++;
          const lease=await runtime.recover(p.sessionKey);
          let localState:unknown;
          if(lease)try{const state=JSON.parse(await readFile(path.join(lease.controlDirectory,'state.json'),'utf8'));
            localState={phase:state.phase,failureReason:state.failureReason,reason:state.reason,proof:state.proof};}catch(error){localState={probeError:diagnosticError(error)};}
          native={sessionKey:p.sessionKey,generation:p.generation,deadlineAt:p.deadlineAt,
            grant:grant?{grantId:grant.grantId,generation:grant.generation,expiresAt:grant.expiresAt,revokedAt:grant.revokedAt,revocationCause:grant.revocationCause}:null,
            lease:lease?{pid:lease.pid,processGroup:lease.processGroup,startIdentity:lease.startIdentity,generation:lease.generation,controlDirectory:lease.controlDirectory}:null,localState};
        }
        effects.push({effectId:effect.identity.effectId,phase:effect.phase,admittedAt:effect.admittedAt,dispatchIds:effect.dispatches.map(row=>row.dispatchId),
          factKeys:Object.keys(snap.facts),hasResult:Boolean(snap.result),resourcesReleased:snap.resourcesReleased,native});
      }
      const flow=await workflow.readFlow(service.durable,runId);probeReads++;
      rows.push({runId,owner:run.owner,epoch:run.epoch,revision:run.revision,hold:run.hold,holdSource:run.holdSource,cancelled:run.cancelled,
        deadlineAt:run.deadlineAt,remainingMs:Date.parse(run.deadlineAt)-Date.now(),inheritedHold:authority.inheritedHold,
        workflow:flow.workflow?{workflowID:flow.workflow.workflowID,status:flow.workflow.status,completedAt:flow.workflow.completedAt}:null,
        tasks:projection.tasks.map(row=>{const value=row as unknown as {identity:Prepared['identity'];state:unknown;result?:unknown};return {effectId:value.identity.effectId,state:value.state,hasResult:Boolean(value.result)};}),
        resources:physical.resources.map(row=>({effectId:row.effectId,jobs:row.claim.jobs,licences:row.claim.licences,released:row.released,proof:row.proof})),
        stopped:physical.stopped,effects});
    }
    const task=await read(()=>service.teamOperation(guide,{action:'readTask',teamId:saved.teamId,taskId:plan.childTaskId},'human'));
    const face=task as {allowedActions?:unknown;execution?:{epoch?:number;revision?:number;state?:string;resourceState?:string;reason?:string};resumeGate?:unknown;probeError?:unknown};
    const status=await read(()=>service.exitStatus()),events=await readEvents();
    await diagnosticEmit({stage,at:new Date().toISOString(),elapsedMs:Date.now()-began,probeReads,actualHome:home.h.home,applicationVersion:service.durable.applicationVersion,
      originalHandleWorkflowID:started.handle.workflowID,rows,task:{allowedActions:face.allowedActions,execution:face.execution?{epoch:face.execution.epoch,revision:face.execution.revision,state:face.execution.state,resourceState:face.execution.resourceState,reason:face.execution.reason}:null,resumeGate:face.resumeGate,probeError:face.probeError},exitStatus:status,
      nativeFamily:diagnosticFamily?{...diagnosticFamily,supervisorAlive:alive(diagnosticFamily.pid),descendantAlive:alive(diagnosticFamily.descendant)}:null,
      eventCounts:{created:events.filter(row=>row.kind==='created').length,input:events.filter(row=>row.kind==='input').length},
      parentResult:Boolean(await store.result(parent.identity.effectId)),downstreamCount:(await downstream()).length});
  };
  diagnostic=async(stage:string)=>{try{await diagnosticAttempt(stage);}catch(error){await diagnosticEmit({stage,at:new Date().toISOString(),probeError:diagnosticError(error)});}};
  const reopen=async()=>{
    // Stop the actual Host/DBOS/private PG and native executor, then reopen the
    // same persistent home. No effect, grant or result is inserted by this helper.
    await host.dispose();await executor.dispose();
    host=await bootInProcess(home.h);service=host.ctx.hima;store=service.durable.store;
    runtime=new localModule.OarLocalMemberRuntime({home:home.h.home,nodeExecutable:process.execPath,runnerModule:runner,assets});
    executor=makeExecutor();bindExecutor();await service.reconciled;
    return String((await createRootAgent(host.ctx,home.h.workspace)).id);
  };
  return {home,get host(){return host;},get service(){return service;},get store(){return store;},evidence,parentRun,parent,plan,started,snapshot,readEvents,children,downstream,control,readers,reopen,
    childGate:(value:boolean)=>{childGate=value;},unknown:(value:boolean)=>{unknownClose=value;},deliver:()=>writeFile(path.join(evidence,'deliver'),'actual delivery'),get runtime(){return runtime;},saved,guide,diagnostic,diagnosticFamily:(family:{pid:number;descendant:number})=>{diagnosticFamily=family;}};
}

test('real Pack → saved Team → original result → automatic downstream retains exact bytes and one child',{timeout:120000},async t=>{
  const f=await fixture(t);
  await waitUntil('one Team accepted',async()=>!!await f.snapshot(),30000,25);
  const accepted=(await f.snapshot())!;
  assert.equal(accepted.plan.deadlineAt,f.parentRun.deadlineAt);
  assert.equal(accepted.task.currentRunId,f.plan.childRunId);
  assert.equal(accepted.plan.start.flow.source,'team');assert.equal(accepted.plan.source.kind,'team');
  assert.equal((await f.store.run(f.parentRun.runId)).owner,f.parentRun.owner);
  await waitUntil('actual correlated Team native input',async()=>(await f.readEvents()).some(row=>row.kind==='input'),30000,25);
  const originalChild=(await f.store.flowInvocations(f.plan.childRunId))[0]!;
  const prepared=await f.store.effectFact(originalChild.identity.effectId,'prepared') as unknown as Prepared;
  const grant=await f.store.readTeamGrant('grant-'+jsonDigest([prepared.sessionKey,prepared.generation]));assert.ok(grant);
  assert.equal(grant.projectId,f.plan.projectId);assert.equal(grant.taskId,f.plan.childTaskId);assert.equal(grant.teamId,f.plan.delegation.team.teamId);
  await assert.rejects(f.store.authorizeTeamGrant({...grant,projectId:'foreign-project'},'read-task'),/current capability|project|Task/);
  const before=(await f.children()).length;
  for(let n=0;n<3;n++)await f.snapshot();assert.equal((await f.children()).length,before,'read refresh does not create child');
  await f.deliver();
  const outcome=await f.started.handle.getResult() as unknown as {state:string;committed:Record<string,import('../../packages/harness/lib/types/task-contract.js').TaskResult>};
  assert.equal(outcome.state,'succeeded');const parent=outcome.committed.call!;
  assert.equal(parent.identity.effectId,f.parent.identity.effectId);assert.deepEqual(parent.value,{answer:'measured-negative'});
  assert.equal(parent.outputSchemaVersion,'pack-original-output/9');assert.equal((outcome.committed.consume!.value as {done:boolean}).done,true);
  const input=JSON.parse((await readFile(path.join(f.started.workspace,'consumed.jsonl'),'utf8')).trim());assert.equal(input.answer,'measured-negative');assert.equal(input.artifact.effectId,f.parent.identity.effectId);
  const adoption=await f.store.effectFact(parent.identity.effectId,'pack-team-result') as unknown as {childResult:{outputSchemaVersion:string};childResultSha256:string;sourceFactId:string};
  assert.equal(adoption.childResult.outputSchemaVersion,'answer/1');assert.equal(jsonDigest(adoption.childResult),adoption.childResultSha256);assert.ok(await f.store.fact(adoption.sourceFactId));
  const artifact=await f.readers.readTaskArtifact(f.parentRun.runId,parent.identity.effectId,'tiny');assert.ok(artifact.kind==='file');assert.equal(Buffer.from(artifact.bytes).toString(),resultBytes);assert.equal(artifact.ref.sha256,sha(resultBytes));
  await assertFixturePublication(f.host,f.parentRun.runId,f.home.h.home);
  const archived=await f.readers.readRunAssets(f.parentRun.runId);assert.equal(archived.kind,'read');if(archived.kind==='read')assert.ok(archived.manifest.materials.some(row=>row.source===`task-artifact:${parent.identity.effectId}:tiny`&&row.sha256===sha(resultBytes)));
  assert.equal((await f.children()).filter(task=>task.taskId===f.plan.childTaskId).length,1);assert.equal((await f.readEvents()).filter(row=>row.kind==='input').length,1);assert.equal((await f.downstream()).length,1);
});

test('retained original plan rejects changed/project-forged admission; saved v2 does not replace v1',{timeout:120000},async t=>{
  const f=await fixture(t,{gateChild:true});await waitUntil('accepted frozen child',async()=>!!await f.snapshot(),30000,25);
  const run=await f.store.run(f.parentRun.runId),input={parentIdentity:f.parent.identity,admission:{runId:run.runId,effectId:f.parent.identity.effectId,owner:run.owner,epoch:run.epoch,revision:run.revision},plan:f.plan,projectId:f.plan.projectId};
  const [a,b]=await Promise.all([f.store.acceptPackTeamDelegation(input),f.store.acceptPackTeamDelegation(input)]);assert.equal(a.task.taskId,b.task.taskId);
  await assert.rejects(f.store.acceptPackTeamDelegation({...input,plan:{...f.plan,requestSha256:'b'.repeat(64)}}),/different|differs|changed|plan/);
  await assert.rejects(f.store.acceptPackTeamDelegation({...input,projectId:'foreign-project'}),/project|admission/);
  await f.service.teamOperation(f.guide,{action:'save',teamId:f.saved.teamId,definition:{...teamFixture,title:'Changed only for new work'},expectedVersion:1});
  assert.equal((await f.snapshot())!.task.team.version,1);f.childGate(false);await f.deliver();
  const outcome=await f.started.handle.getResult() as {state:string};assert.equal(outcome.state,'succeeded');assert.equal((await f.children()).length,1);
  const events=await f.readEvents();assert.equal(events.filter(row=>row.kind==='input').length,1);assert.equal(('source' in events[0]!.identity?events[0]!.identity.source:undefined)?.kind,'team');
});

test('original parent pause fences actual child native callbacks; explicit continue uses same child',{timeout:120000},async t=>{
  const f=await fixture(t,{gateChild:true,diagnostic:'original-parent-pause'});await waitUntil('child acceptance before native',async()=>!!await f.snapshot(),30000,25);
  await f.diagnostic('accepted-before-pause');await f.control('pause');f.childGate(false);
  await waitUntil('actual child workflow reaches blocked original parent authority',async()=>{
    const projection=await f.store.flowProjection(f.plan.childRunId);return JSON.stringify(projection.tasks).includes('Original Pack parent');
  },30000,25);
  await f.diagnostic('child-observed-parent-hold');assert.equal((await f.snapshot())!.state,'waiting');assert.equal((await f.readEvents()).length,0);
  const child=await f.store.run(f.plan.childRunId);
  await assert.rejects((await workflow.controlFlow(f.service.durable,{runId:child.runId,commandId:'child-bypass',action:'continue',origin:'human',owner:child.owner,epoch:child.epoch,revision:child.revision})).getResult(),/parent|hold|blocks/);
  await f.control('continue');await f.diagnostic('immediately-after-parent-Continue');
  const originalChild=(await f.store.flowInvocations(f.plan.childRunId))[0]!;
  const stopped=await f.store.flowFact(f.plan.childRunId,'stopped:'+originalChild.identity.effectId);
  assert.equal(stopped,null,'A reversible parent pause must not permanently stop the original child invocation: '+JSON.stringify(stopped));
  await f.deliver();const result=await f.started.handle.getResult() as {state:string};await f.diagnostic('original-handle-returned');assert.equal(result.state,'succeeded');
  assert.equal((await f.readEvents()).filter(row=>row.kind==='input').length,1);assert.equal((await f.children()).length,1);
});

test('validated child with real unknown closure never commits parent or downstream; cancel stays truthful',{timeout:120000},async t=>{
  const f=await fixture(t);f.unknown(true);await f.deliver();
  await waitUntil('contract-valid original child delivery retained',async()=>{
    const invocation=(await f.store.flowInvocations(f.plan.childRunId))[0];return !!invocation&&!!await f.store.effectFact(invocation.identity.effectId,'validated-result');
  },30000,25);
  assert.equal(await f.store.result(f.parent.identity.effectId),undefined);assert.equal((await f.downstream()).length,0);assert.equal((await f.snapshot())!.closed,false);
  const closure=await f.store.readExternalPackTeamClosure(f.parent.identity);assert.equal(closure.closed,false);
  // Cancel is dispatched, but physical unknown must stay visible until real Local close succeeds.
  const current=await f.store.run(f.parentRun.runId),cancel=await workflow.controlFlow(f.service.durable,{runId:current.runId,commandId:'unknown-cancel',action:'cancel',origin:'human',owner:current.owner,epoch:current.epoch,revision:current.revision});
  await waitUntil('parent cancellation is persisted',async()=>(await f.store.run(f.parentRun.runId)).cancelled,10000,25);
  assert.equal((await f.snapshot())!.closed,false);assert.equal((await f.downstream()).length,0);
  f.unknown(false);await cancel.getResult();assert.equal((await f.store.readExternalPackTeamClosure(f.parent.identity)).closed,true);assert.equal((await f.readEvents()).filter(row=>row.kind==='input').length,1);
});

test('same child value passes saved Team schema but fails original Pack schema without replacement',{timeout:120000},async t=>{
  const f=await fixture(t,{wrongParentOutput:true});await f.deliver();
  await waitUntil('actual child checked result and closure',async()=>{const snapshot=await f.snapshot();return !!snapshot?.result&&snapshot.closed;},30000,25);
  const child=(await f.snapshot())!;assert.deepEqual(child.result!.value,{answer:'measured-negative'});
  await assert.rejects(f.store.acceptPackTeamResult({parentIdentity:f.parent.identity,bindingSha256:child.bindingSha256,childIdentity:child.result!.identity,childResultSha256:child.childResultSha256!}),/schema|number|output/);
  assert.equal(await f.store.result(f.parent.identity.effectId),undefined);assert.equal((await f.downstream()).length,0);assert.equal((await f.children()).length,1);assert.equal((await f.readEvents()).filter(row=>row.kind==='input').length,1);
  await f.control('cancel');
});


test('operator revoke closes live Pack child native family under original parent human pause without resume', {timeout:120000}, async t => {
  const f=await fixture(t,{observeNativeFamily:true});
  await waitUntil('actual Pack child received native input before parent pause', async()=>
    (await f.readEvents()).some(row=>row.kind==='input'),30000,25);
  const child=(await f.store.flowInvocations(f.plan.childRunId))[0]!;
  const prepared=await f.store.effectFact(child.identity.effectId,'prepared') as unknown as Prepared;
  assert.ok(prepared);assert.ok('source' in prepared.identity && prepared.identity.source.kind==='team');
  const lease=await f.runtime.recover(prepared.sessionKey);assert.ok(lease);
  await waitUntil('actual child native receive retained by production Local runtime',async()=>
    (await f.runtime.read(lease)).journal.includes('"received"'),30000,25);
  const grantId='grant-'+jsonDigest([prepared.sessionKey,prepared.generation]);
  const grant=await f.store.readTeamGrant(grantId);assert.ok(grant);
  assert.equal(grant.effectId,child.identity.effectId);assert.equal(grant.taskId,f.plan.childTaskId);
  const original=JSON.parse(await readFile(path.join(f.evidence,'original.json'),'utf8')) as {pid:number;descendant:number};
  assert.equal(lease.pid,original.pid);assert.ok(alive(original.pid));assert.ok(alive(original.descendant));
  const parentBefore=await f.store.run(f.parentRun.runId),childBefore=await f.store.run(f.plan.childRunId);
  const taskCount=(await f.children()).length;
  await f.control('pause');
  assert.ok((await f.store.run(f.parentRun.runId)).hold);
  assert.ok(alive(original.pid));assert.ok(alive(original.descendant));
  await f.store.revokeTeamGrant(grantId,'operator');
  await assert.rejects(f.store.authorizeTeamGrant(grant,'read-task'),/current capability|authorized|revok/i);
  await waitUntil('revoked live child physically closes while Pack parent remains paused',async()=>{
    const snapshot=await f.store.effectSnapshot(child.identity);
    return !alive(original.pid)&&!alive(original.descendant)&&snapshot.resourcesReleased&&
      !!await f.store.externalEffectFact(child.identity,'oar:closed')&&
      !!await f.store.flowFact(f.plan.childRunId,'stopped:'+child.identity.effectId);
  },30000,25);
  const parentAfter=await f.store.run(f.parentRun.runId),childAfter=await f.store.run(f.plan.childRunId);
  assert.ok(parentAfter.hold);assert.equal(parentAfter.cancelled,false);
  assert.equal(parentAfter.deadlineAt,parentBefore.deadlineAt);assert.equal(childAfter.deadlineAt,childBefore.deadlineAt);
  assert.ok(Date.now()<Date.parse(childAfter.deadlineAt),'cleanup completes before original child deadline');
  const resources=await f.store.effectResources(child.identity.effectId),closed=await f.store.externalEffectFact(child.identity,'oar:closed');
  assert.ok(closed);assert.equal(resources.length,1);assert.equal(resources[0]!.released,true);assert.deepEqual(resources[0]!.proof,closed);
  assert.equal((await f.store.effectSnapshot(child.identity)).result,null);
  assert.equal(await f.store.result(f.parent.identity.effectId),undefined);assert.equal((await f.downstream()).length,0);
  assert.equal((await f.children()).length,taskCount);assert.equal((await f.store.flowInvocations(f.plan.childRunId)).length,1);
  assert.equal((await f.readEvents()).filter(row=>row.kind==='input').length,1,'no fresh child/downstream native input');
});

// #105 active-definition L2 proposals reuse this actual Pack fixture. Compatible
// cases preserve the exact original output declaration/version; differing outer
// versions remain negative even if JSON values would satisfy both schemas.
type PackFixture=Awaited<ReturnType<typeof fixture>>;
async function activePackHandoff(f:PackFixture,requestId:string) {
  await waitUntil('actual original Pack child native receive',async()=>
    (await f.readEvents()).some(row=>row.kind==='input'&&row.identity.runId===f.plan.childRunId),30000,25);
  const invocation=(await f.store.flowInvocations(f.plan.childRunId))[0]!;
  const prepared=await f.store.effectFact(invocation.identity.effectId,'prepared') as unknown as Prepared;
  const lease=await f.runtime.recover(prepared.sessionKey);assert.ok(lease);
  assert.ok(lease.pid&&lease.startIdentity);
  await waitUntil('actual original Local birth retained in application PG',async()=>
    !!await f.store.externalEffectFact(invocation.identity,`oar:local-birth:${lease.pid}:${lease.startIdentity}`),10000,25);
  const birth=await f.store.externalEffectFact(invocation.identity,`oar:local-birth:${lease.pid}:${lease.startIdentity}`);
  const original=JSON.parse(await readFile(path.join(f.evidence,'original.json'),'utf8')) as {pid:number;descendant:number};
  assert.equal(lease.pid,original.pid);assert.ok(alive(original.pid)&&alive(original.descendant));
  const selected=await f.service.teamOperation(f.guide,{action:'save',teamId:f.saved.teamId,
    definition:{...teamFixture,title:'Explicitly selected v2',collaboration:'Use retained evidence and return the same outer delivery.'},expectedVersion:1}) as {version:number;sha256:string};
  assert.equal(selected.version,2);
  const old=await f.store.run(f.plan.childRunId);
  const request={action:'applyDefinition' as const,origin:'human' as const,
    actor:{kind:'human' as const,actorId:await f.store.operatorIdentity(),projectId:f.saved.projectId},
    taskId:f.plan.childTaskId,runId:old.runId,requestId,expectedEpoch:old.epoch,expectedRevision:old.revision,definitionVersion:2};
  const ref={projectId:f.plan.projectId,teamId:f.plan.delegation.team.teamId,taskId:f.plan.childTaskId};
  return {invocation,prepared,lease,birth,original,selected,old,request,ref};
}
async function assertOldPackTreeClosed(f:PackFixture,h:Awaited<ReturnType<typeof activePackHandoff>>) {
  await waitUntil('original Pack child actual supervisor and detached descendant close',async()=>{
    const snapshot=await f.store.effectSnapshot(h.invocation.identity);
    return !alive(h.original.pid)&&!alive(h.original.descendant)&&snapshot.resourcesReleased&&
      !!await f.store.externalEffectFact(h.invocation.identity,'oar:closed')&&
      !!await f.store.flowFact(h.old.runId,'stopped:'+h.invocation.identity.effectId);
  },30000,25);
  assert.deepEqual(await f.store.externalEffectFact(h.invocation.identity,`oar:local-birth:${h.lease.pid}:${h.lease.startIdentity}`),h.birth);
  const proof=await f.store.externalEffectFact(h.invocation.identity,'oar:closed');assert.ok(proof);
  const resources=await f.store.effectResources(h.invocation.identity.effectId);assert.equal(resources.length,1);
  assert.equal(resources[0]!.released,true);assert.deepEqual(resources[0]!.proof,proof);
}
async function assertActivePackDelivery(f:PackFixture,h:Awaited<ReturnType<typeof activePackHandoff>>,workflowId:string) {
  try {
    await waitUntil('same gated selection adopts exactly one actual v2 native receiver',async()=>{
      const task=await f.store.readTeamTask(h.ref.projectId,h.ref.teamId,h.ref.taskId);
      return !!task&&task.currentRunId!==h.old.runId&&(await f.readEvents()).some(row=>row.kind==='input'&&row.identity.runId===task.currentRunId);
    },30000,25);
  } catch (error) { await f.diagnostic('v2-native-receiver-unavailable'); throw error; }
  const task=(await f.store.readTeamTask(h.ref.projectId,h.ref.teamId,h.ref.taskId))!;
  assert.deepEqual(task.runIds,[h.old.runId,task.currentRunId]);assert.equal(task.team.version,2);assert.equal(task.team.sha256,h.selected.sha256);
  const next=await f.store.run(task.currentRunId);assert.equal(next.deadlineAt,h.old.deadlineAt);
  assert.equal(task.taskId,h.ref.taskId);assert.equal((await f.snapshot())!.bindingSha256,jsonDigest(f.plan));
  assert.deepEqual((next.opening.data as unknown as {start:{runInput:unknown}}).start.runInput,f.plan.start.runInput);
  const replay=await workflow.applyTeamDefinition(f.service.durable,h.request);
  assert.equal(replay.workflowId,workflowId);assert.equal(replay.replayed,true);
  assert.deepEqual((await f.store.readTeamTask(h.ref.projectId,h.ref.teamId,h.ref.taskId))!.runIds,[h.old.runId,next.runId]);
  assert.equal((await f.readEvents()).filter(row=>row.kind==='created'&&row.identity.runId===next.runId).length,1);
  assert.equal((await f.readEvents()).filter(row=>row.kind==='input'&&row.identity.runId===next.runId).length,1);
  await f.deliver();
  const outcome=await f.started.handle.getResult() as unknown as {state:string;committed:Record<string,import('../../packages/harness/lib/types/task-contract.js').TaskResult>};
  assert.equal(outcome.state,'succeeded');const returned=outcome.committed.call!;
  assert.equal(returned.identity.effectId,f.parent.identity.effectId);assert.deepEqual(returned.value,{answer:'measured-negative'});
  assert.equal(returned.outputSchemaVersion,teamFixture.delivery.output.version);
  assert.equal((await f.store.run(f.parentRun.runId)).owner,f.parentRun.owner);
  assert.equal((await f.store.run(f.parentRun.runId)).deadlineAt,f.parentRun.deadlineAt);
  assert.equal((outcome.committed.consume!.value as {done:boolean}).done,true);
  const consumed=JSON.parse((await readFile(path.join(f.started.workspace,'consumed.jsonl'),'utf8')).trim());
  assert.equal(consumed.answer,'measured-negative');assert.equal(consumed.artifact.effectId,f.parent.identity.effectId);
  const artifact=await f.readers.readTaskArtifact(f.parentRun.runId,returned.identity.effectId,'tiny');assert.equal(artifact.kind,'file');
  if(artifact.kind==='file'){assert.equal(Buffer.from(artifact.bytes).toString(),resultBytes);assert.equal(artifact.ref.sha256,sha(resultBytes));}
  assert.equal((await f.children()).length,1);assert.equal((await f.downstream()).length,1);
  const retained=await f.store.readTeamDefinitionHandoff(h.ref.taskId,h.request.requestId);
  assert.equal(retained.projection.state,'adopted');assert.equal(retained.projection.successorRunId,next.runId);
}
for(const branch of [false,true])test(`active compatible Pack v2 handoff closes old tree under parent ${branch?'branch':'whole'} pause; same control adopts after Continue`,{timeout:120000},async t=>{
  const f=await fixture(t,{observeNativeFamily:true,compatibleHandoff:true,branchParent:branch});
  const h=await activePackHandoff(f,`active-parent-${branch?'branch':'whole'}-pause`);
  const originalBinding=(await f.snapshot())!.bindingSha256;
  // Admission/dispatch gap is real: retain the human gate, then pause the actual
  // parent through its existing production control before any handoff control read.
  const begun=await f.store.beginTeamDefinitionHandoff(h.request);assert.equal(begun.replayed,false);
  await f.control('pause',branch);
  if(branch)assert.ok((await f.store.branchControls(f.parentRun.runId)).some(row=>row.hold==='pause'));
  else assert.equal((await f.store.run(f.parentRun.runId)).hold,'pause');
  const applied=await workflow.applyTeamDefinition(f.service.durable,h.request);assert.equal(applied.replayed,true);
  await assertOldPackTreeClosed(f,h);
  const paused=await f.store.readTeamDefinitionHandoff(h.ref.taskId,h.request.requestId);
  assert.equal(paused.projection.state,'closing');assert.match(paused.projection.reason??'',/parent|branch|pause|hold/i);
  assert.equal((await f.store.readTeamTask(h.ref.projectId,h.ref.teamId,h.ref.taskId))!.currentRunId,h.old.runId);
  assert.equal((await f.snapshot())!.bindingSha256,originalBinding);
  assert.equal((await f.readEvents()).filter(row=>row.kind==='created').length,1,'actual closed old tree plus paused parent admits no successor birth');
  assert.equal(await f.store.result(f.parent.identity.effectId),undefined);assert.equal((await f.downstream()).length,0);
  await assert.rejects(f.store.acceptTeamDefinitionHandoff(h.ref.taskId,h.request.requestId),/parent|branch|pause|hold/i);
  await f.control('continue',branch);
  await assertActivePackDelivery(f,h,applied.workflowId);
});

test('Pack parent pause after accepted successor CAS and start check fences actual root native submit until Continue',{timeout:120000},async t=>{
  const f=await fixture(t,{observeNativeFamily:true,compatibleHandoff:true,diagnostic:'root-pause-v2'});
  const h=await activePackHandoff(f,'active-parent-pause-at-root-start'),runtime=f.service.durable;
  const originalStart=runtime.startWorkflow;
  let release!:()=>void,reached!:()=>void,successorRunId:string|undefined,intercepted=0;
  const barrier=new Promise<void>(resolve=>{release=resolve;});
  const atRoot=new Promise<void>(resolve=>{reached=resolve;});
  runtime.startWorkflow=async function(name,workflowId,value){
    const start=value as unknown as {runId?:string;flow?:{taskSource?:{taskId?:string}}};
    if(name==='hima.flow'&&start.runId!==h.old.runId&&start.flow?.taskSource?.taskId===h.ref.taskId){
      successorRunId=start.runId;intercepted++;reached();await barrier;
    }
    return originalStart.call(this,name,workflowId,value);
  };
  t.after(()=>{release();runtime.startWorkflow=originalStart;});
  try {
    const applied=await workflow.applyTeamDefinition(runtime,h.request);
    await Promise.race([atRoot,waitUntil('actual successor root public dispatch reaches barrier',async()=>intercepted===1,30000,25)]);
    assert.equal(intercepted,1);assert.ok(successorRunId);
    assert.equal((await f.store.readTeamTask(h.ref.projectId,h.ref.teamId,h.ref.taskId))!.currentRunId,successorRunId,'actual successor CAS precedes pause');
    await assertOldPackTreeClosed(f,h);
    await f.control('pause');release();
    // Do not pass via elapsed sleep. The real released root must either expose an
    // authority-blocked task projection or reveal the forbidden native birth.
    await waitUntil('released actual root observes original Pack parent hold or exposes forbidden birth',async()=>
      JSON.stringify((await f.store.flowProjection(successorRunId!)).tasks).includes('Original Pack parent')||
      (await f.readEvents()).some(row=>row.kind==='created'&&row.identity.runId===successorRunId),30000,25);
    assert.equal((await f.readEvents()).filter(row=>row.kind==='created'&&row.identity.runId===successorRunId).length,0,'parent pause after successful start read must fence actual successor native birth');
    assert.equal((await f.readEvents()).filter(row=>row.kind==='input'&&row.identity.runId===successorRunId).length,0);
    for(const invocation of await f.store.flowInvocations(successorRunId))
      assert.equal(await f.store.effectFact(invocation.identity.effectId,'submitted'),undefined);
    assert.equal(await f.store.result(f.parent.identity.effectId),undefined);assert.equal((await f.downstream()).length,0);
    await f.control('continue');runtime.startWorkflow=originalStart;
    await assertActivePackDelivery(f,h,applied.workflowId);
    assert.equal(intercepted,1);
  }finally{release();runtime.startWorkflow=originalStart;}
});

test('active Pack handoff rejects schema-compatible JSON with differing original outer version before fencing or cleanup',{timeout:120000},async t=>{
  const f=await fixture(t,{observeNativeFamily:true}); // Original outer version is pack-original-output/9.
  const h=await activePackHandoff(f,'incompatible-outer-version'),before=await f.store.run(h.old.runId);
  await assert.rejects(workflow.applyTeamDefinition(f.service.durable,h.request),/output.*differs|original Pack delivery contract/i);
  assert.deepEqual(await f.store.run(h.old.runId),before,'incompatible outer declaration rejected before epoch/hold writes');
  assert.equal((await f.store.readTeamTask(h.ref.projectId,h.ref.teamId,h.ref.taskId))!.currentRunId,h.old.runId);
  assert.equal(await f.store.teamDefinitionHandoffForTask(h.ref),undefined);
  assert.ok(alive(h.original.pid)&&alive(h.original.descendant));
  assert.equal(await f.store.externalEffectFact(h.invocation.identity,'oar:closed'),undefined);
  assert.equal((await f.readEvents()).filter(row=>row.kind==='created').length,1);
  assert.equal(await f.store.result(f.parent.identity.effectId),undefined);assert.equal((await f.downstream()).length,0);
  await f.deliver();assert.equal((await f.started.handle.getResult() as {state:string}).state,'succeeded');
});

// Liveness regression: CAS is real, but parent Pause wins BEFORE the shared
// successor-start permission read. A completed deterministic control must still
// arrange bounded progress so Continue can release the accepted successor.
test('Pack parent pause before accepted successor start read preserves one v2 delivery after Continue and identical replay',{timeout:120000},async t=>{
  const f=await fixture(t,{observeNativeFamily:true,compatibleHandoff:true,diagnostic:'read-pause-v2'});
  const h=await activePackHandoff(f,'active-parent-pause-before-start-read'),runtime=f.service.durable;
  const originalAllowed=f.store.acceptedTeamSuccessorStartAllowed,originalStart=runtime.startWorkflow;
  let release!:()=>void,reached!:()=>void,successorRunId:string|undefined,intercepted=0,rootDispatches=0;
  let controlHandle:Awaited<ReturnType<typeof runtime.startWorkflow>>|undefined;
  let allowedRead:boolean|undefined;
  const rootWorkflowIds=new Set<string>();
  const barrier=new Promise<void>(resolve=>{release=resolve;});
  const atRead=new Promise<void>(resolve=>{reached=resolve;});
  f.store.acceptedTeamSuccessorStartAllowed=async function(...args){
    const [previousRunId,currentRunId]=args;
    if(previousRunId===h.old.runId&&intercepted===0){
      successorRunId=currentRunId;intercepted++;reached();await barrier;
      allowedRead=await originalAllowed.call(this,...args);return allowedRead;
    }
    return originalAllowed.call(this,...args);
  };
  runtime.startWorkflow=async function(name,workflowId,value){
    const input=value as unknown as {runId?:string;flow?:{taskSource?:{taskId?:string}};kind?:string;requestId?:string};
    if(name==='hima.flow'&&input.runId===successorRunId&&input.flow?.taskSource?.taskId===h.ref.taskId){rootDispatches++;rootWorkflowIds.add(workflowId);}
    const handle=await originalStart.call(this,name,workflowId,value);
    if(name==='hima.flow.control'&&input.kind==='team-definition-handoff'&&input.requestId===h.request.requestId)controlHandle=handle;
    return handle;
  };
  t.after(()=>{release();f.store.acceptedTeamSuccessorStartAllowed=originalAllowed;runtime.startWorkflow=originalStart;});
  try {
    const applied=await workflow.applyTeamDefinition(runtime,h.request);
    await Promise.race([atRead,waitUntil('accepted successor reaches public permission-read barrier',async()=>intercepted===1,30000,25)]);
    assert.equal(intercepted,1);assert.ok(successorRunId);
    const accepted=(await f.store.readTeamTask(h.ref.projectId,h.ref.teamId,h.ref.taskId))!;
    assert.equal(accepted.currentRunId,successorRunId,'actual successor CAS committed before original permission read');
    assert.deepEqual(accepted.runIds,[h.old.runId,successorRunId]);
    await assertOldPackTreeClosed(f,h);
    await f.control('pause');assert.equal((await f.store.run(f.parentRun.runId)).hold,'pause');
    release();
    await waitUntil('production handoff control handle retained',async()=>!!controlHandle,10000,25);
    await controlHandle!.getResult();
    assert.notEqual(allowedRead,undefined,'the original start permission read actually ran under parent pause');
    // A fixed product may schedule its existing DBOS root while paused; actual
    // business/native authority must still wait. Old product records false and
    // completes control with zero root dispatch, losing this accepted opening.
    if(rootDispatches>0)await waitUntil('scheduled successor root observes parent hold or forbidden actual birth',async()=>
      JSON.stringify((await f.store.flowProjection(successorRunId!)).tasks).includes('Original Pack parent')||
      (await f.readEvents()).some(row=>row.kind==='created'&&row.identity.runId===successorRunId),30000,25);
    assert.equal((await f.readEvents()).filter(row=>row.kind==='created'&&row.identity.runId===successorRunId).length,0);
    assert.equal((await f.readEvents()).filter(row=>row.kind==='input'&&row.identity.runId===successorRunId).length,0);
    for(const invocation of await f.store.flowInvocations(successorRunId))
      assert.equal(await f.store.effectFact(invocation.identity.effectId,'submitted'),undefined);
    assert.equal(await f.store.result(f.parent.identity.effectId),undefined);assert.equal((await f.downstream()).length,0);
    t.diagnostic(`paused permission read=${allowedRead}; DBOS successor root dispatches=${rootDispatches}; actual native births=0`);
    await f.control('continue');
    await waitUntil('Parent Continue automatically advances the already accepted successor without another Apply',async()=>
      (await f.readEvents()).some(row=>row.kind==='input'&&row.identity.runId===successorRunId),8000,25);
    // Replay the exact gate/request/control ID. On the old implementation this
    // completed deterministic control is reused and no root starts: must RED.
    const replay=await workflow.applyTeamDefinition(runtime,h.request);
    assert.equal(replay.workflowId,applied.workflowId);assert.equal(replay.replayed,true);
    await assertActivePackDelivery(f,h,applied.workflowId);
    assert.equal(rootWorkflowIds.size,1,'all retained root dispatch handles name the same DBOS workflow');
  }finally{release();f.store.acceptedTeamSuccessorStartAllowed=originalAllowed;runtime.startWorkflow=originalStart;}
});


// #105 T19 actual composition: the outer Campaign command targets the actual
// original Pack Run through HimaService, not RunStore.command on its Team child.
// The controlled Node is the existing fixture's sole costly dependency substitute.
// This L2 case makes no product-model effectiveness claim.
test('actual Pack Campaign continue after Host exit leaves Team resume-required; explicit human Team resume returns one successor to the original node', {timeout:120000}, async t=>{
  const f=await fixture(t,{observeNativeFamily:true,diagnostic:'campaign-continue-after-exit'});
  await waitUntil('actual original native input before App exit',async()=>
    (await f.readEvents()).filter(row=>row.kind==='input').length===1,30000,25);
  const original=(await f.snapshot())!,old=await f.store.run(original.task.currentRunId);
  const native=(await f.store.flowInvocations(old.runId))[0]!;
  const originalBytes=await readFile(path.join(f.evidence,'original.json'),'utf8');
  const originalFamily=JSON.parse(originalBytes) as {pid:number;descendant:number};
  f.diagnosticFamily(originalFamily);assert.equal(alive(originalFamily.pid),true);assert.equal(alive(originalFamily.descendant),true);
  const parentBefore=await f.store.run(f.parentRun.runId);
  const outerControl=async(action:'pause'|'continue',requestId:string)=>{
    const current=await f.store.run(f.parentRun.runId);
    const answer=await f.service.executionAction({runId:current.runId,actor:current.owner,origin:'human',action,
      requestId,expectedEpoch:current.epoch,expectedRevision:current.revision});
    assert.equal(answer.kind,'accepted',JSON.stringify(answer));
    return answer;
  };
  await outerControl('pause','outer-pause-before-exit');
  await f.diagnostic('before-actual-prepareExit');await f.service.prepareExit({requestId:'pack-child-host-exit',mode:'keep-jobs'});await f.diagnostic('returned-prepareExit');
  await waitUntil('actual old supervisor and descendant close before Host disposal',async()=>
    (await f.service.exitStatus()).ready&&!alive(originalFamily.pid)&&!alive(originalFamily.descendant),45000,25);
  const held=await f.store.run(old.runId);
  assert.match(held.hold??'',/^Team stopped on App exit/);assert.equal(held.holdSource,'human');
  const closed=await f.store.externalEffectFact(native.identity,'oar:closed');assert.ok(closed);
  const resources=await f.store.effectResources(native.identity.effectId);
  assert.ok(resources.length>0);assert.ok(resources.every(resource=>resource.released));
  assert.equal(await f.store.result(f.parent.identity.effectId),undefined);assert.equal((await f.downstream()).length,0);
  const eventsBefore=await f.readEvents();
  const guide=await f.reopen();
  const assertStillHeld=async()=>{
    const snapshot=(await f.snapshot())!,child=await f.store.run(old.runId);
    assert.equal(child.hold,held.hold);assert.equal(child.holdSource,'human');
    assert.equal(snapshot.task.taskId,original.task.taskId);assert.equal(snapshot.task.currentRunId,old.runId);
    assert.deepEqual(snapshot.task.runIds,[old.runId]);assert.equal(snapshot.bindingSha256,original.bindingSha256);
    assert.equal(snapshot.state,'waiting');assert.equal(snapshot.result,undefined);
    assert.deepEqual(await f.readEvents(),eventsBefore,'cold reopen/outer continue must create no native birth or input');
    assert.equal((await f.store.flowInvocations(old.runId)).length,1,'no new original engineering invocation');
    assert.equal(await f.store.result(f.parent.identity.effectId),undefined);assert.equal((await f.downstream()).length,0);
    assert.equal((await f.children()).filter(task=>task.taskId===original.task.taskId).length,1);
  };
  await assertStillHeld();
  // Use the existing read-only public resume face as well as the real owner control.
  // Durable Campaigns expose Continue; /resume explicitly describes that fact.
  const facade=await import(pathToFileURL(path.join(lib,'fabric.js')).href) as typeof import('../../packages/harness/lib/types/fabric.js');
  const resumeFace=await facade.resumeRun({ledger:f.service.ledger,judge:f.service.judge,durable:f.service.durable,
    host:f.host.ctx,sitesDir:path.join(f.home.h.home,'hima/sites'),packsDir:path.join(f.home.h.home,'hima/packs')}, {runId:f.parentRun.runId,who:guide});
  assert.equal(resumeFace.kind,'unresumable');await assertStillHeld();
  await outerControl('continue','outer-campaign-continue-after-reopen');
  const continued=await f.store.run(f.parentRun.runId);
  assert.equal(continued.hold,null);assert.equal(continued.owner,parentBefore.owner);
  assert.equal(continued.deadlineAt,parentBefore.deadlineAt);
  // Wait for an observable parent interpreter read of the child gate, or catch
  // the prohibited birth immediately. No fixed sleep is used as the oracle.
  await waitUntil('original Pack interpreter observes Team exit gate after outer Continue',async()=>
    JSON.stringify((await f.store.flowProjection(f.parentRun.runId)).tasks).includes(held.hold!)||
    (await f.readEvents()).length!==eventsBefore.length,30000,25);
  await assertStillHeld();
  const ref={projectId:f.plan.projectId,teamId:f.saved.teamId,taskId:original.task.taskId};
  const gate=await f.store.teamResumeGate(ref);assert.equal(gate.allowed,true,gate.reason);
  // The Team's human operation is separate from Campaign Continue. Stable task
  // and immutable outer contract are retained while a new child Run is admitted.
  const request={requestId:'explicit-human-pack-child-resume',action:'resume' as const,
    expectedRunId:old.runId,expectedEpoch:held.epoch,expectedRevision:held.revision};
  const resume=()=>f.service.teamOperation(guide,{action:'control',teamId:ref.teamId,taskId:ref.taskId,request},'human');
  await resume();await resume();
  await waitUntil('exactly one successor receives actual native input',async()=>
    (await f.readEvents()).filter(row=>row.kind==='input').length===2,30000,25);
  const successorTask=(await f.store.readTeamTask(ref.projectId,ref.teamId,ref.taskId))!;
  assert.notEqual(successorTask.currentRunId,old.runId);assert.deepEqual(successorTask.runIds,[old.runId,successorTask.currentRunId]);
  assert.equal(successorTask.taskId,original.task.taskId);assert.deepEqual(successorTask.team,original.task.team);
  const successor=await f.store.run(successorTask.currentRunId);
  assert.equal(successor.deadlineAt,old.deadlineAt);
  const successorOpening=successor.opening.data as unknown as {start:import('../../packages/harness/lib/types/flow-workflow.js').FlowStart};
  const originalOpening=old.opening.data as unknown as {start:import('../../packages/harness/lib/types/flow-workflow.js').FlowStart};
  assert.deepEqual(successorOpening.start.runInput,originalOpening.start.runInput);
  assert.deepEqual(await f.store.run(old.runId),held,'outer control and explicit successor never clear predecessor hold');
  assert.equal((await f.snapshot())!.bindingSha256,original.bindingSha256);
  await f.deliver();
  await waitUntil('original outer node and one downstream command commit',async()=>
    !!await f.store.result(f.parent.identity.effectId)&&(await f.downstream()).length===1&&
    !!await f.store.result((await f.downstream())[0]!.identity.effectId),30000,25);
  const delivered=(await f.store.result(f.parent.identity.effectId))!;
  assert.deepEqual(delivered.identity,f.parent.identity);assert.deepEqual(delivered.value,{answer:'measured-negative'});
  assert.equal(delivered.outputSchemaVersion,'pack-original-output/9');
  const adoption=await f.store.effectFact(f.parent.identity.effectId,'pack-team-result') as unknown as {childResult:import('../../packages/harness/lib/types/task-contract.js').TaskResult;childResultSha256:string};
  assert.equal(adoption.childResult.identity.runId,successor.runId);assert.equal(jsonDigest(adoption.childResult),adoption.childResultSha256);
  assert.equal(await f.store.result(native.identity.effectId),undefined,'closed predecessor never invents a delivered result');
  const consumed=(await readFile(path.join(f.started.workspace,'consumed.jsonl'),'utf8')).trim().split('\n');
  assert.equal(consumed.length,1,'one actual downstream engineering submission');
  const input=JSON.parse(consumed[0]!);assert.equal(input.answer,'measured-negative');assert.equal(input.artifact.effectId,f.parent.identity.effectId);
  assert.equal((await f.readEvents()).filter(row=>row.kind==='created').length,2);
  assert.equal((await f.readEvents()).filter(row=>row.kind==='input').length,2);
  assert.equal((await f.store.flowInvocations(old.runId)).length,1);assert.equal((await f.store.flowInvocations(successor.runId)).length,1);
  assert.equal((await f.children()).filter(task=>task.taskId===original.task.taskId).length,1);
  const readers=createDurableViewReaders({ledger:f.service.ledger,judge:f.service.judge,durable:f.service.durable,
    host:f.host.ctx,sitesDir:path.join(f.home.h.home,'hima/sites'),packsDir:path.join(f.home.h.home,'hima/packs')},
    {retainedMaterialsDir:await resolveRetainedMaterialsDirectory({home:f.home.h.home})});
  const artifact=await readers.readTaskArtifact(f.parentRun.runId,f.parent.identity.effectId,'tiny');assert.ok(artifact.kind==='file');
  assert.equal(Buffer.from(artifact.bytes).toString(),resultBytes);assert.equal(artifact.ref.sha256,sha(resultBytes));
});
