// @hima-seam cordis direct
// @hima-seam app-boot direct
// @hima-seam profile-boot direct
// @hima-seam agent wrapped
// Source-only L2 proposal: production profile launcher signal handlers, real Host/PG/DBOS,
// controlled ordinary Node IPC through the production Local runtime. No SDK/model claim.
import assert from 'node:assert/strict';
import { Service } from '@deepseek-ai/cordis';
import Hima from '@hima/harness';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { loadProfile, loadLayeredEnv, auditStartupEntries } from '@deepseek-ai/dsh-app-boot';
import { runProfile, INSTALL_ANCHOR } from '@deepseek-ai/dsh/profile-boot';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createPresetRootAgent } from './boot-inprocess.ts';
import { waitUntil } from './fabric.ts';
import { teamFixture } from './himateam.ts';

const [home, workspace, mode, scenario = 'leader'] = process.argv.slice(2);
assert.ok(scenario==='leader'||scenario==='peer');
assert.ok(home && workspace && (mode === 'seed' || mode === 'reopen'));
assert.ok(process.env.NODE_TEST_CONTEXT);
const evidence = path.join(home, 'signal-evidence');
await mkdir(evidence, { recursive: true });
const runner = path.join(evidence, 'runner.mjs');
const startIntents=path.join(evidence,'native-start-intents.jsonl');
if(mode==='seed')await writeFile(startIntents,'');
if (mode === 'seed') await writeFile(runner, `
import fs from 'node:fs';import path from 'node:path';import {spawn} from 'node:child_process';
const evidence=${JSON.stringify(evidence)};let config;
const log=row=>fs.appendFileSync(path.join(evidence,'events.jsonl'),JSON.stringify({...row,pid:process.pid})+'\\n');
process.send({type:'ready'});
process.on('message',m=>{
 if(m.type==='config'){
  config=m.config;const p=config.prepared;
  if(p.memberId==='peer'){
   const original=fs.readFileSync(path.join(evidence,'events.jsonl'),'utf8').trim().split('\\n').map(line=>JSON.parse(line)).find(row=>row.kind==='birth'&&row.memberId==='lead');
   for(const pid of [original.pid,original.descendant]){let alive=true;try{process.kill(pid,0);}catch(error){if(error.code==='ESRCH')alive=false;else throw error;}if(alive)throw Error('capacity-one peer born before original physical absence');}
  }
  fs.writeFileSync(path.join(config.controlDirectory,'native/data/conversation.txt'),'controlled-signal-conversation-context\\n');
  const descendant=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',detached:true});
  log({kind:'birth',effectId:p.identity.effectId,memberId:p.memberId,descendant:descendant.pid});
  process.send({type:'created',payload:{runtime:p.runtime,nativeSession:'controlled-'+p.identity.effectId}});
 }
 if(m.type==='input'){
  if(config.prepared.memberId==='lead')fs.appendFileSync(path.join(config.workDirectory,'engineering.txt'),m.input+'\\n');
  let text;try{text=JSON.parse(m.input);}catch{}
  log({kind:'input',effectId:config.prepared.identity.effectId,memberId:config.prepared.memberId,inputId:m.id,question:text?.peerText?.text});
  process.send({type:'received',payload:{inputId:m.id,evidence:'actual-controlled-node-ipc'}});
  if(config.prepared.memberId==='peer'&&m.initial){
   // Complete ONLY the genuine correlated initial turn, under its actual
   // observation-only contract. The public question was queued while busy.
   // Local's ordinary finished processing will flush the queued next input.
   const poll=setInterval(()=>{
    if(!fs.existsSync(path.join(evidence,'allow-peer-initial-completion')))return;
    clearInterval(poll);
    process.send({type:'terminal',payload:{inputId:m.id,outcome:{kind:'completed'}}});
    process.send({type:'finished',inputId:m.id,text:JSON.stringify({schemaVersion:config.outputSchemaVersion,value:{observation:'original delegated input received'},artifacts:[],diagnostics:[]})});
   },15);
  }
 }
 // Ignore cooperative stop: the genuine Local closer must observe and stop
 // both the actual Node leader and its actual detached descendant.
});setInterval(()=>{},1000);
`);
const lib = process.env.HIMA_DBOS_TEST_LIB ?? path.resolve('packages/harness/lib');
const localModule = await import(pathToFileURL(path.join(lib,'oar-local-member.js')).href) as typeof import('../../../packages/harness/lib/types/oar-local-member.js');
const portModule = await import(pathToFileURL(path.join(lib,'oar-member-process.js')).href) as typeof import('../../../packages/harness/lib/types/oar-member-process.js');
type Prepared = import('../../../packages/harness/lib/types/oar-task-adapter.js').OarPrepared;
type Lease = import('../../../packages/harness/lib/types/oar-local-member.js').LocalMemberLease;
const assets = {oarModule:'controlled-node-no-sdk',nodeExecutable:process.execPath,opencodeCommand:'controlled-node-no-cli',opencodeVersion:'fixture'};
const local = new localModule.OarLocalMemberRuntime({home,nodeExecutable:process.execPath,runnerModule:runner,assets});
let service!:InstanceType<typeof Hima>;
let executor!:ReturnType<typeof portModule.createOarMemberExecutor>;
let observeSignalClosure = false;
const closeObserved = new Set<string>();
const localPort:NonNullable<import('../../../packages/harness/lib/types/oar-member-process.js').OarMemberProcessOptions['localRuntime']> = {
 stage:(...args)=>local.stage(...args),
 start:async(...args)=>{
  // Owned fixture inventory, recorded before entering the ONLY actual spawn seam.
  // Empty inventory proves pre-Team failure entered no native start; it is not
  // a fabricated product birth or closure receipt. Cold reopening never resets it.
  await appendFile(startIntents,JSON.stringify({sessionKey:args[0].sessionKey,generation:args[0].generation})+'\n');
  return local.start(...args);
 },read:(...args)=>local.read(...args),
 authorize:(...args)=>local.authorize(...args),reply:(...args)=>local.reply(...args),sendInput:(...args)=>local.sendInput(...args),
 readArtifact:(...args)=>local.readArtifact(...args),recover:(...args)=>local.recover(...args),captureClosedContext:(...args)=>local.captureClosedContext(...args),
 stopAll:()=>local.stopAll(),
 close:async(...args)=>{
  // Observation only. The production closer and signal controller remain intact.
  if(observeSignalClosure && !closeObserved.has(args[0].sessionKey)){
   const store=service.durable.store, exit=await store.hostExit();assert.ok(exit,'exit retained BEFORE physical close');
   const boundary=JSON.parse(await readFile(path.join(evidence,'boundary.json'),'utf8'));
   if(args[0].sessionKey!==boundary.native.prepared.sessionKey)return local.close(...args);
   const run=await store.run(boundary.runId);
   assert.equal(run.holdSource,'human');assert.match(run.hold??'',/explicit controlled continuation required/);
   closeObserved.add(args[0].sessionKey);
   await writeFile(path.join(evidence,'fence-before-close.json'),JSON.stringify({exit,run,sessionKey:args[0].sessionKey}));
  }
  return local.close(...args);
 }
};
// Install before Host initialization releases durableAdaptersReady. These are the
// existing controlled native adapter seams, not a second execution kernel.
const originalInit=Hima.prototype[Service.init];
Hima.prototype[Service.init]=async function(){
 service=this;let installed:typeof this.teamExecutor;
 Object.defineProperty(this,'teamTransport',{configurable:true,get:()=>executor?.transport,set:()=>{}});
 Object.defineProperty(this,'teamExecutor',{configurable:true,get:()=>installed,set:()=>{
  executor=portModule.createOarMemberExecutor({home,retainedMaterialsDir:path.join(home,'retained-materials'),store:this.durable.store,
   services:{} as import('../../../packages/harness/lib/types/team-service-runtime.js').TeamServiceRuntime,
   localRuntime:localPort,runtimeAssets:async()=>assets,
   sharedDeepSeekModel:async()=>{throw Error('No product model fallback');},memberContext:async()=>{throw Error('No native MCP tools in L2');}});
  installed={readiness:async()=>({ready:true,missing:[]}),resolve:async context=>{
   const adapter=await executor.resolve(context);
   if(scenario!=='peer'||context.task.memberId!=='peer')return adapter;
   return {...adapter,collect:async(...args:Parameters<typeof adapter.collect>)=>{
    // Existing TaskCollectionPending seam: native state/received/completed,
    // actual TaskToolOutput validation and all real stop/resource guards stay
    // unchanged. Only this controlled fixture's collection readiness is held
    // until the external test signals the original Host.
    const actual=await adapter.collect(...args);
    assert.ok(!('pending' in actual),'real OAR collector must validate the actual initial native output');
    assert.equal(actual.schemaVersion,'discussion/1');
    assert.deepEqual(actual.value,{observation:'original delegated input received'});
    return {pending:true as const,state:'waiting' as const,reason:{code:'controlled-signal-collection-boundary',source:'signal-test-fixture',message:'Controlled discussion fixture deliberately awaits the external Host signal; this is not producer completion or production collection readiness.'}};
   }};
  }};
 }});
 // The controlled executor is an owned test adapter and must also be closed
 // by the same actual fiber disposal, after Hima's resource boundary is established.
 this.ctx.effect(()=>async()=>{
  // Narrow test seam: invoke the existing ordered runtime closer without
  // widening product visibility or replacing production lifecycle behavior.
  const lifecycle=this as unknown as {closeHostResources():Promise<void>};
  assert.equal(typeof lifecycle.closeHostResources,'function');
  await lifecycle.closeHostResources();await executor?.dispose();
 },'test: controlled native callback lifetime');
 return originalInit.call(this);
};
const profile=loadProfile('dsh','hima',INSTALL_ANCHOR,home,{userLayer:true});
assert.deepEqual(profile.skippedBundles,[]);
// Preserve the shipped Web/preset composition: runProfile provides real
// launcher profileContext. A stripped direct-boot composition does not prove
// that its global raw Agent factory is visible under this public launcher.
assert.ok(profile.layers.some(row=>row.packageName==='@deepseek-ai/dsh-web-app'));
const launched=await runProfile({environment:loadLayeredEnv('dsh'),profile:'hima',patchFiles:[],
 args:['--host','127.0.0.1','--port','0','--no-open'],
 resolvedProfile:{installAnchor:INSTALL_ANCHOR,profile}});
await auditStartupEntries(launched.ctx,'dsh',diagnostic=>{throw Error(diagnostic);});
assert.ok(service instanceof Hima);await service.reconciled;
const store=service.durable.store;
const send=(value:unknown)=>process.send!(value as Parameters<NonNullable<typeof process.send>>[0]);
const events=async()=>{try{return (await readFile(path.join(evidence,'events.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return [];throw error;}};
const preparedFor=async(runId:string,memberId:string)=>{
 for(const invocation of await store.flowInvocations(runId)){
  const prepared=await store.effectFact(invocation.identity.effectId,'prepared') as unknown as Prepared;
  if(prepared?.memberId===memberId)return prepared;
 }
 return undefined;
};
async function readyNative(runId:string,memberId='lead'){
 let prepared!:Prepared, lease!:Lease;
 await waitUntil('actual native engineering input received',async()=>{
  prepared=(await preparedFor(runId,memberId))!;if(!prepared)return false;
  lease=(await local.recover(prepared.sessionKey))!;
  return !!lease?.pid && (await local.read(lease)).journal.includes('"received"') && (await events()).some(row=>row.kind==='input'&&row.effectId===prepared.identity.effectId);
 },30000,25);
 return {prepared,lease};
}
function openingScope(value:unknown){
 assert.ok(value && typeof value==='object' && !Array.isArray(value),'actual opening.data object');
 const data=value as Record<string,unknown>;
 assert.ok(data.start && typeof data.start==='object' && !Array.isArray(data.start),'actual opening.start object');
 const start=data.start as Record<string,unknown>;
 assert.ok(Object.hasOwn(start,'runInput'),'actual opening.start.runInput retained');
 assert.equal(typeof data.requestDigest,'string');
 return {runInput:start.runInput,requestDigest:data.requestDigest};
}
if(mode==='seed'){
 const rootAgent=await createPresetRootAgent(launched.ctx,workspace,'standard');
 assert.equal(rootAgent.session.header.agentPreset,'standard');
 const guide=String(rootAgent.id);
 await service.teamOperation(guide,{action:'configure-model',request:{modelRef:'fixture-model',runtime:'opencode',provider:'openai-completions',model:'controlled-node',baseUrl:'https://fixture.invalid/v1',apiKey:'private-fixture-only'}},'human');
 const team=await service.teamOperation(guide,{action:'save',definition:scenario==='peer'?{...teamFixture,members:[...teamFixture.members,{...teamFixture.members[0]!,id:'peer',role:'Discussion peer',instructions:'Discuss observations without engineering writes.'}]}:teamFixture,expectedVersion:null}) as {teamId:string};
 const request={requestId:'signal-original',teamId:team.teamId,expectedVersion:1,goal:'Preserve this exact bounded goal',input:{sentinel:'original'},deadlineAt:new Date(Date.now()+180000).toISOString(),closure:'Close all owned Node resources.'};
 const task=await service.teamOperation(guide,{action:'startTask',teamId:team.teamId,request}) as {taskId:string;currentRunId:string;projectId:string};
 const leader=await readyNative(task.currentRunId);let native=leader;
 let discussion:unknown;
 if(scenario==='peer'){
  // Public human delegation plus wait admit a real peer only after the real
  // leader's checkpoint/yield/owned-resource closure frees shared capacity one.
  const delegated=await service.teamOperation(guide,{action:'delegate',teamId:team.teamId,taskId:task.taskId,request:{parentEffectId:leader.prepared.identity.effectId,request:{requestId:'signal-discussion-peer',memberId:'peer',goal:'Discuss this observation; do not perform engineering writes.',input:{observation:'original'},output:{version:'discussion/1',schema:{$schema:'https://json-schema.org/draft/2020-12/schema',type:'object',properties:{observation:{type:'string'}},required:['observation'],additionalProperties:false}},dependsOn:[],deadlineAt:request.deadlineAt}}},'human') as {delegationId:string};
  const wait=await service.teamOperation(guide,{action:'wait',teamId:team.teamId,taskId:task.taskId,request:{parentEffectId:leader.prepared.identity.effectId,request:{requestId:'signal-leader-wait',delegationIds:[delegated.delegationId]}}},'human') as {state:string};
  assert.equal(wait.state,'yield-accepted');native=await readyNative(task.currentRunId,'peer');
  const leaderClosed=await store.externalEffectFact(leader.prepared.identity,'oar:closed');assert.ok(leaderClosed);
  const leaderResources=await store.effectResources(leader.prepared.identity.effectId);assert.equal(leaderResources.length,1);assert.equal(leaderResources[0]!.released,true);assert.deepEqual(leaderResources[0]!.proof,leaderClosed);
  const question='Which original observation should the human inspect before continuing?';
  const sent=await service.teamOperation(guide,{action:'ask',teamId:team.teamId,taskId:task.taskId,request:{requestId:'signal-discussion-question',recipientMemberIds:['peer'],text:question}},'human') as {message:{messageId:string;kind:string};deliveries:Array<{deliveryId:string;state:string;received?:unknown}>};
  let delivery=sent.deliveries[0]!;assert.ok(delivery);
  assert.equal(delivery.state,'unknown','actual public ask is queued while the original peer turn is busy');
  assert.equal((await events()).some(row=>row.memberId==='peer'&&row.question===question),false,'queued is not received');
  await writeFile(path.join(evidence,'allow-peer-initial-completion'),'release genuine correlated initial turn');
  await waitUntil('actual admitted peer receives directed question',async()=>{
   if(delivery.state!=='accepted')delivery=await service.teamOperation(guide,{action:'reconcile-delivery',teamId:team.teamId,taskId:task.taskId,request:{deliveryId:delivery.deliveryId}},'human') as typeof delivery;
   return delivery.state==='accepted'&&(await events()).some(row=>row.memberId==='peer'&&row.question===question);
  },15000,25);
  assert.ok(delivery.received);assert.equal(sent.message.kind,'question');
  const snapshot=await store.effectSnapshot(native.prepared.identity);
  assert.equal(snapshot.result,null,'controlled collection pending prevents commit before external signal');
  assert.equal(snapshot.facts['validated-result'],undefined,'no validated TaskResult is invented');
  const peerResources=await store.effectResources(native.prepared.identity.effectId);
  assert.equal(peerResources.length,1);assert.equal(peerResources[0]!.released,false,'real peer lease remains owned before signal');
  discussion={delegationId:delegated.delegationId,leaderClosed,question,messageId:sent.message.messageId,delivery};
 }
 const rows=await events();assert.equal(rows.filter(row=>row.kind==='birth').length,scenario==='peer'?2:1);
 const birth=rows.find(row=>row.kind==='birth'&&row.effectId===native.prepared.identity.effectId);assert.ok(birth.descendant>1);
 const originalLeadBirth=rows.find(row=>row.kind==='birth'&&row.memberId==='lead');
 if(scenario==='peer'){
  for(const pid of [originalLeadBirth.pid,originalLeadBirth.descendant]){let alive=true;try{process.kill(pid,0);}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')alive=false;else throw error;}assert.equal(alive,false);}
  assert.equal((await import('node:fs')).existsSync(path.join(native.lease.workDirectory,'engineering.txt')),false,'discussion peer performs zero engineering writes');
 }
 // The retained boundary is observation data only; the cold worker never inserts facts from it.
 const boundary={guide,teamId:team.teamId,...task,runId:task.currentRunId,request,native,leader,scenario,discussion,livePids:[birth.pid,birth.descendant],ownedPids:rows.filter(row=>row.kind==='birth').flatMap(row=>[row.pid,row.descendant]),initialBirths:rows.filter(row=>row.kind==='birth').length,initialInputs:rows.filter(row=>row.kind==='input').length,run:await store.run(task.currentRunId)};
 await writeFile(path.join(evidence,'boundary.json'),JSON.stringify(boundary));
 observeSignalClosure=true;
 send({stage:'ready-for-signal',pid:process.pid,boundary,handlers:{SIGTERM:process.listenerCount('SIGTERM'),SIGINT:process.listenerCount('SIGINT'),SIGHUP:process.listenerCount('SIGHUP')}});
}else{
 observeSignalClosure=false;
 const boundary=JSON.parse(await readFile(path.join(evidence,'boundary.json'),'utf8'));
 // Public Session controller restores the exact persisted preset before
 // publishing the ordinary Guide. No direct Agents factory or model turn.
 const controller=launched.ctx.get('sessionController' as never) as {resolveAgent(sessionId:string):Promise<{agent:Agent}|{error:Error}>}|undefined;
 assert.ok(controller);
 const restored=await controller.resolveAgent(boundary.guide);
 if('error' in restored)throw restored.error;
 assert.equal(restored.agent.session.header.agentPreset,'standard');
 await restored.agent.whenIdle();
 const guide=String(restored.agent.id),old=await store.run(boundary.runId);
 const closed=await store.externalEffectFact(boundary.native.prepared.identity,'oar:closed');assert.ok(closed,'original physical closed receipt survives the real signal');
 const resources=await store.effectResources(boundary.native.prepared.identity.effectId);assert.equal(resources.length,1);assert.equal(resources[0]!.released,true);assert.deepEqual(resources[0]!.proof,closed);
 await new Promise(resolve=>setTimeout(resolve,250));
 const rowsBefore=await events();
 const engineeringFile=path.join(boundary.leader.lease.workDirectory,'engineering.txt');
 const bytesBefore=await readFile(engineeringFile,'utf8');
 if(boundary.discussion)assert.deepEqual(await store.externalEffectFact(boundary.leader.prepared.identity,'oar:closed'),boundary.discussion.leaderClosed);
 assert.equal(old.holdSource,'human');assert.match(old.hold??'',/explicit controlled continuation required/);
 assert.equal(old.deadlineAt,boundary.request.deadlineAt);
 const gate=await store.teamResumeGate({projectId:boundary.projectId,teamId:boundary.teamId,taskId:boundary.taskId});assert.equal(gate.allowed,true,gate.reason);
 await assert.rejects(store.command({runId:old.runId,commandId:'campaign-like-continue-cannot-authorize-team',owner:old.owner,epoch:old.epoch,revision:old.revision,action:'continue',origin:'human'}),/explicit human successor/);
 assert.deepEqual(await events(),rowsBefore,'cold reopen/continue emits zero native births or sends');
 assert.equal(await readFile(engineeringFile,'utf8'),bytesBefore,'cold reopen performs zero engineering writes');
 assert.deepEqual((await store.readTeamTask(boundary.projectId,boundary.teamId,boundary.taskId))!.runIds,[old.runId]);
 send({stage:'cold-held',pid:process.pid,boundary,run:old,events:rowsBefore});
 process.on('message',message=>{void (async()=>{
  if((message as {action?:string}).action==='resume'){
   const request={requestId:'signal-explicit-human-resume',action:'resume',expectedRunId:old.runId,expectedEpoch:old.epoch,expectedRevision:old.revision};
   const resumed=await service.teamOperation(guide,{action:'control',teamId:boundary.teamId,taskId:boundary.taskId,request},'human') as {currentRunId:string};
   const replay=await service.teamOperation(guide,{action:'control',teamId:boundary.teamId,taskId:boundary.taskId,request},'human') as {currentRunId:string};
   assert.equal(replay.currentRunId,resumed.currentRunId);
   const native=await readyNative(resumed.currentRunId),next=await store.run(resumed.currentRunId);
   assert.notEqual(next.runId,old.runId);assert.notEqual(native.lease.pid,boundary.native.lease.pid);
   assert.equal(next.deadlineAt,old.deadlineAt);assert.deepEqual(openingScope(next.opening.data),openingScope(old.opening.data));
   assert.deepEqual(await store.run(old.runId),old);
   const task=await store.readTeamTask(boundary.projectId,boundary.teamId,boundary.taskId);assert.deepEqual(task!.runIds,[old.runId,next.runId]);
   const rows=await events();assert.equal(rows.filter(row=>row.kind==='birth').length,boundary.initialBirths+1);assert.equal(rows.filter(row=>row.kind==='input').length,boundary.initialInputs+1);
   send({stage:'human-resumed',pid:process.pid,currentRunId:next.runId,taskId:task!.taskId,ownedPids:rows.filter(row=>row.kind==='birth').flatMap(row=>[row.pid,row.descendant]),events:rows});
  }
  if((message as {action?:string}).action==='close'){
   await launched.shutdown.shutdown(0);process.disconnect();
  }
 })().catch(error=>{console.error(error);process.exitCode=1;process.disconnect();});});
}
