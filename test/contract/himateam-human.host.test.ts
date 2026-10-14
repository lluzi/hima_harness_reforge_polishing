// #105 formal human L2: real Host/private PG/DBOS and actual Node parent/successor.
// Copied bounded controlled native fixture: no fabricated result or successful close proof.
// Registered real Host contract; controlled native IO is not Pi/OpenCode L4.
// Production Store/TaskEffects/native port,
// actual ordinary Node IPC process. Controlled IO is NOT Pi/OpenCode L4.
// Native delegate/wait tools and missing in-flight MCP promises are not qualified here.
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ActorGrant, FlowAdapterContext, TeamDefinition } from '@hima/harness';
import { bootInProcess, createRootAgent } from './support/boot-inprocess.ts';
import { localHome, waitUntil } from './support/fabric.ts';
import { teamFixture } from './support/himateam.ts';

process.env.HIMA_TEST_SILENT_AGENT = '1';
process.env.HIMA_TEST_LEGACY_AUTO_DRIVE = '0';
const lib = process.env.HIMA_DBOS_TEST_LIB ?? path.resolve('packages/harness/lib');
const localModule = await import(pathToFileURL(path.join(lib, 'oar-local-member.js')).href) as typeof import('../../packages/harness/lib/types/oar-local-member.js');
const portModule = await import(pathToFileURL(path.join(lib, 'oar-member-process.js')).href) as typeof import('../../packages/harness/lib/types/oar-member-process.js');
const workflow = await import(pathToFileURL(path.join(lib, 'flow-workflow.js')).href) as typeof import('../../packages/harness/lib/types/flow-workflow.js');
const { jsonDigest } = await import(pathToFileURL(path.join(lib, 'run-store.js')).href) as typeof import('../../packages/harness/lib/types/run-store.js');
type Prepared = import('../../packages/harness/lib/types/oar-task-adapter.js').OarPrepared;
type Lease = import('../../packages/harness/lib/types/oar-local-member.js').LocalMemberLease;
type Continuation = import('../../packages/harness/lib/types/flow-workflow.js').TeamEffectContinuation;
const sha = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false; throw error; } };
const childVersion = 'delegated-answer/7';
const childOutput = { ...teamFixture.delivery.output, version: childVersion };

async function fixture(t: TestContext, deadlineMs = 60000) {
  const home = await localHome(t, { sleepSeconds: 0 }); assert.ok(home);
  const host = await bootInProcess(home.h);
  const service = host.ctx.hima;
  await service.reconciled;
  const evidence = path.join(home.h.home, 'handoff-test');
  await mkdir(evidence, { recursive: true });
  const runner = path.join(evidence, 'controlled-runner.mjs');
  // The fixture writes ordinary bytes to the real private native directory, sends
  // actual IPC receive/terminal events and counts inputs. No TaskResult is fabricated.
  // The real Local runtime records OS birth, stream, result binding and closure.
  await writeFile(runner, `
import fs from 'node:fs'; import path from 'node:path'; import {spawn} from 'node:child_process';
const evidence=${JSON.stringify(evidence)}; let c, input, descendant;
const log=value=>fs.appendFileSync(path.join(evidence,'events.jsonl'),JSON.stringify({...value,pid:process.pid,at:new Date().toISOString()})+'\\n');
const isAlive=pid=>{try{process.kill(pid,0);return true;}catch(e){if(e.code==='ESRCH')return false;throw e;}};
process.send({type:'ready'});
process.on('message',m=>{
 if(m.type==='config'){
  c=m.config; const p=c.prepared; const successor=!!c.continuity;
  if(p.memberId==='worker'){
   const old=JSON.parse(fs.readFileSync(path.join(evidence,'original.json'),'utf8'));
   if(isAlive(old.pid)||isAlive(old.descendant))throw Error('capacity-one child started before original physical absence');
   log({kind:'child-absence',old});
  }
  const data=path.join(c.controlDirectory,'native/data');fs.mkdirSync(data,{recursive:true});
  if(successor){
   if(c.workDirectory!==c.continuity.checkpoint.origin.cwd)throw Error('continuation cwd changed');
   if(fs.readFileSync(path.join(data,'conversation.txt'),'utf8')!=='ordinary-node-context-sentinel\\n')throw Error('checked context absent');
   if(fs.existsSync(path.join(data,'auth.json')))throw Error('old credential sidefile copied');
   log({kind:'restored-file',effectId:p.identity.effectId,cwd:c.workDirectory,control:c.controlDirectory});
  } else if(p.memberId==='lead'){
   fs.writeFileSync(path.join(data,'conversation.txt'),'ordinary-node-context-sentinel\\n');
   fs.writeFileSync(path.join(data,'auth.json'),'old-credential-sidefile-sentinel');
   descendant=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',detached:true});
   fs.writeFileSync(path.join(evidence,'original.json'),JSON.stringify({pid:process.pid,descendant:descendant.pid}));
  }
  const native=successor?c.continuity.checkpoint.origin.nativeSession:'controlled-'+p.identity.effectId;
  log({kind:'created',effectId:p.identity.effectId,memberId:p.memberId,control:c.controlDirectory,cwd:c.workDirectory,native,version:c.outputSchemaVersion});
  process.send({type:'created',payload:{runtime:p.runtime,nativeSession:native}});
 }
 if(m.type==='input'){
  input=m;const p=c.prepared;
  log({kind:'input',effectId:p.identity.effectId,memberId:p.memberId,inputId:m.id,text:m.input,successor:!!c.continuity});
  // Successor native reception is gated, letting the test distinguish a queued
  // prompt from the actual correlated receive observation without fake receipts.
  const finish=()=>{
   process.send({type:'received',payload:{inputId:m.id,evidence:'actual-controlled-node-ipc'}});
   if(p.memberId==='lead'&&!c.continuity)return;
   process.send({type:'terminal',payload:{inputId:m.id,outcome:{kind:'completed'}}});
   process.send({type:'finished',inputId:m.id,text:JSON.stringify({schemaVersion:c.outputSchemaVersion,value:{answer:p.memberId==='worker'?'child-measured':'successor-measured'},artifacts:[],diagnostics:[]})});
  };
  if(c.continuity){const poll=setInterval(()=>{if(fs.existsSync(path.join(evidence,'allow-receive'))){clearInterval(poll);finish();}},15);}else finish();
 }
 // Deliberately ignore yield/stop: real Local escalation must stop the entire
 // observed owned family, including the detached actual descendant.
});setInterval(()=>{},1000);
`);
  const assets = { oarModule: 'controlled-node-no-sdk', nodeExecutable: process.execPath,
    opencodeCommand: 'controlled-node-no-cli', opencodeVersion: 'fixture' };
  const runtime = new localModule.OarLocalMemberRuntime({ home: home.h.home, nodeExecutable: process.execPath, runnerModule: runner, assets });
  let unknownClose = false, allowSuccessor = false;
  const local: NonNullable<import('../../packages/harness/lib/types/oar-member-process.js').OarMemberProcessOptions['localRuntime']> = {
    stage: (...args) => runtime.stage(...args), start: (...args) => runtime.start(...args),
    read: (...args) => runtime.read(...args), authorize: (...args) => runtime.authorize(...args),
    reply: (...args) => runtime.reply(...args), sendInput: (...args) => runtime.sendInput(...args),
    readArtifact: (...args) => runtime.readArtifact(...args), recover: (...args) => runtime.recover(...args),
    captureClosedContext: (...args) => runtime.captureClosedContext(...args), stopAll: () => runtime.stopAll(),
    close: async (lease, options) => {
      if (!unknownClose) return runtime.close(lease, options);
      // Obtain the production Local close's real PID/birth mismatch refusal. The
      // live original process is untouched; this is not a synthetic closed proof.
      const file = path.join(home.h.home, 'hima/oar-members', lease.sessionKey, 'lease.json');
      const bytes = await readFile(file, 'utf8');
      try {
        await writeFile(file, JSON.stringify({ ...JSON.parse(bytes), startIdentity: 'intentional-test-birth-mismatch' }));
        const verifier = new localModule.OarLocalMemberRuntime({ home: home.h.home, nodeExecutable: process.execPath, runnerModule: runner, assets });
        const invalid = await verifier.recover(lease.sessionKey); assert.ok(invalid);
        const refusal = await verifier.close(invalid);
        assert.equal(refusal.closed, false); assert.match(refusal.reason ?? '', /identity mismatch/i);
        return refusal;
      } finally { await writeFile(file, bytes); }
    },
  };
  const executor = portModule.createOarMemberExecutor({ home: home.h.home,
    retainedMaterialsDir: path.join(home.h.home, 'handoff-materials'), store: service.durable.store,
    services: {} as import('../../packages/harness/lib/types/team-service-runtime.js').TeamServiceRuntime,
    localRuntime: local, runtimeAssets: async () => assets,
    sharedDeepSeekModel: async () => { throw Error('No product model credential fallback permitted'); },
    memberContext: async () => { throw Error('This fixture does not invoke native MCP tools'); },
  });
  t.after(async () => {
    unknownClose = false; allowSuccessor = true;
    await writeFile(path.join(evidence, 'allow-receive'), 'cleanup');
    // Stop only this fixture's Local processes before asking the real Host closer
    // to reconcile its retained PG leases; never abandon unknown resources.
    await runtime.stopAll(); await host.dispose(); await executor.dispose(); await home.h.dispose();
  });
  const guide = String((await createRootAgent(host.ctx, home.h.workspace)).id);
  await service.teamOperation(guide, { action: 'configure-model', request: {
    modelRef: 'fixture-model', runtime: 'opencode', provider: 'openai-completions',
    model: 'controlled-node', baseUrl: 'https://fixture.invalid/v1', apiKey: 'private-fixture-only',
  } }, 'human');
  const definition: TeamDefinition = { ...teamFixture, members: [teamFixture.members[0]!, {
    ...teamFixture.members[0]!, id: 'worker', role: 'Worker', instructions: 'Deliver the custom delegated contract.',
  }] };
  const team = await service.teamOperation(guide, { action: 'save', definition, expectedVersion: null }) as { teamId: string };
  service.teamExecutor = { readiness: async () => ({ ready: true, missing: [] }), resolve: async (context: FlowAdapterContext) => {
    if ((await service.durable.store.readTeamExecutionBinding(context.request.identity)).continuation && !allowSuccessor)
      throw new workflow.TaskAdapterMaterializationError({ code: 'controlled-admission', message: 'Hold only successor materialization at child committed boundary.', source: 'test-fixture' });
    return executor.resolve(context);
  } };
  const deadlineAt = new Date(Date.now() + deadlineMs).toISOString();
  const task = await service.teamOperation(guide, { action: 'startTask', teamId: team.teamId,
    request: { requestId: 'handoff-start', teamId: team.teamId, expectedVersion: 1,
      goal: 'Deliver an actual checked child result into one fresh same-Run successor.', input: {}, deadlineAt, closure: 'Deliver answer/1.' } }) as { taskId: string; currentRunId: string };
  const store = service.durable.store, runId = task.currentRunId;
  let parent!: Prepared, parentLease!: Lease;
  await waitUntil('actual parent received original engineering prompt', async () => {
    const invocations = await store.flowInvocations(runId);
    if (invocations.length !== 1) return false;
    parent = await store.effectFact(invocations[0]!.identity.effectId, 'prepared') as unknown as Prepared;
    if (!parent) return false;
    parentLease = await runtime.recover(parent.sessionKey) as Lease;
    return !!parentLease?.pid && (await runtime.read(parentLease)).journal.includes('"received"');
  }, 30000, 25);
  const grantId = 'grant-' + jsonDigest([parent.sessionKey, parent.generation]);
  const grant = await store.readTeamGrant(grantId); assert.ok(grant);
  const events = async () => (await readFile(path.join(evidence, 'events.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line) as Record<string, any>);
  const readTask = async () => await service.teamOperation(guide, { action: 'readTask', teamId: team.teamId, taskId: task.taskId },'human') as import('@hima/harness').TeamTaskView;
  const delegate = async (childDeadline=deadlineAt, actor: { kind: 'member'; grant: ActorGrant } = { kind: 'member', grant }) => {
    const run = await store.run(runId);
    return workflow.delegateFlowTask(service.durable, { runId, parentEffectId: parent.identity.effectId,
      actor, owner: run.owner, epoch: run.epoch, revision: run.revision,
      request: { requestId: 'actual-child', target: 'human', goal: 'Approve the measured human answer under delegated-answer/7.',
        input: {}, output: childOutput, dependsOn: [], deadlineAt:childDeadline } }, store.teamFlow());
  };
  const waitInput = async (delegationId: string) => {
    const run = await store.run(runId);
    return { parentEffectId: parent.identity.effectId, requestId: 'actual-wait', actor: { kind: 'member' as const, grant },
      owner: run.owner, epoch: run.epoch, revision: run.revision, delegationIds: [delegationId] };
  };
  return { home, host, service, store, runId, team, task, parent, parentLease, grant, grantId, runtime, executor,
    evidence, events, readTask, delegate, waitInput, guide,
    unknown: (value: boolean) => { unknownClose = value; },
    successors: (value: boolean) => { allowSuccessor = value; } };
}


type HumanRequest=import('../../packages/harness/lib/types/flow-workflow.js').TeamHumanRequest;
type HumanResponse=import('../../packages/harness/lib/types/flow-workflow.js').TeamHumanResponse;
type Command=import('../../packages/harness/lib/types/run-store.js').DurableCommand;

async function pending(f:Awaited<ReturnType<typeof fixture>>,childDeadline?:string) {
  const child=await f.delegate(childDeadline);
  const wait=await f.store.acceptTeamWait(await f.waitInput(child.delegationId));
  let request!:HumanRequest;
  await waitUntil('actual human workflow creates original request after physical parent handoff',async()=>{
    const view=await f.readTask();
    request=view.humanRequests?.[0]!;
    return !!request;
  },30000,25);
  const invocations=await f.store.flowInvocations(f.runId);
  const invocation=invocations.find(row=>row.identity.effectId===request.binding.effectId);assert.ok(invocation);
  assert.ok('source' in invocation.identity&&invocation.identity.source.kind==='team');
  assert.equal(request.binding.taskId,f.task.taskId);
  assert.notEqual(request.binding.taskId,invocation.identity.taskId,'binding uses stable Team task, not compiled human child ID');
  assert.equal(request.binding.requestId,'actual-child');
  assert.equal(request.binding.principalId,await f.store.operatorIdentity());
  assert.equal(request.text,'Approve the measured human answer under delegated-answer/7.');
  assert.deepEqual(request.output,childOutput);
  assert.equal((await f.store.effectResources(f.parent.identity.effectId))[0]!.released,true,'real parent capacity released before request');
  assert.deepEqual(await f.store.prepareTeamHumanRequest(invocation.identity),request,'same original preparation does not renew binding');
  assert.deepEqual((await f.readTask()).humanRequests,[request]);
  return {child,wait,request,identity:invocation.identity};
}
function responseFor(request:HumanRequest,answer='human-measured'):HumanResponse {
  return {requestId:request.binding.requestId,binding:request.binding,
    output:{schemaVersion:request.output.version,value:{answer},artifacts:[],diagnostics:[]}};
}
async function commandFor(f:Awaited<ReturnType<typeof fixture>>,response:HumanResponse,commandId='direct-human-response'):Promise<Command> {
  const run=await f.store.run(f.runId);
  return {runId:f.runId,commandId,action:'respond',owner:run.owner,epoch:response.binding.generation,
    revision:response.binding.revision,origin:'human',actor:await f.store.operatorIdentity(),
    response:{effectId:response.binding.effectId,output:response.output,teamRequest:{requestId:response.requestId,binding:response.binding}}};
}
const hostRespond=async(f:Awaited<ReturnType<typeof fixture>>,response:HumanResponse,origin:'human'|'guide'='human')=>
  f.service.teamOperation(f.guide,{action:'respond',teamId:f.team.teamId,taskId:f.task.taskId,request:response},origin);
async function retained(f:Awaited<ReturnType<typeof fixture>>,effectId:string) {
  return f.store.transaction(async client=>({
    request:(await client.query<{request:HumanRequest;digest:string;response:HumanResponse|null;response_digest:string|null}>('SELECT request,digest,response,response_digest FROM hima.team_human_requests WHERE effect_id=$1',[effectId])).rows[0],
    commands:(await client.query('SELECT command_id,digest FROM hima.commands WHERE run_id=$1 ORDER BY command_id',[f.runId])).rows,
    outbox:(await client.query('SELECT fact_id FROM hima.outbox WHERE run_id=$1 AND kind IN ($2,$3) ORDER BY fact_id',[f.runId,'control','team-human-request'])).rows,
  }),'test.humanRetained');
}

test('actual human request enforces every binding and operator before replay, commits zero-resource delivery and one successor', {timeout:90000},async t=>{
  const f=await fixture(t),p=await pending(f),response=responseFor(p.request),command=await commandFor(f,response);
  const initial=await retained(f,p.identity.effectId);
  assert.equal(initial.request!.response,null);
  assert.equal(initial.outbox.length,1,'one request-created outbox on replay');
  await assert.rejects(f.store.prepareTeamHumanRequest(f.parent.identity),/human|accepted|original/i);
  await assert.rejects(f.store.prepareTeamHumanRequest({...p.identity,inputSha256:'f'.repeat(64)}),/original|identity|conflict|invocation/i);
  for(const [key,value] of Object.entries({requestId:'wrong-request',taskId:'wrong-task',runId:'wrong-run',effectId:'wrong-effect',
    generation:p.request.binding.generation+1,revision:p.request.binding.revision+1,principalId:'impostor',
    contentDigest:'f'.repeat(64),schemaDigest:'f'.repeat(64),expiresAt:new Date(Date.parse(p.request.binding.expiresAt)+1).toISOString()})) {
    const forged={...response,binding:{...response.binding,[key]:value}} as HumanResponse;
    await assert.rejects(f.store.command({...command,response:{...command.response!,teamRequest:{requestId:forged.requestId,binding:forged.binding}}}),
      /human|request|binding|control|generation|revision|original|operator|identity/i,`changed ${key} cannot settle original request`);
    assert.deepEqual(await retained(f,p.identity.effectId),initial,`forged ${key} creates no settlement or receipt`);
  }
  await assert.rejects(f.store.command({...command,response:{effectId:p.identity.effectId,output:response.output}}),/formal|binding|operator/i);
  await assert.rejects(f.store.command({...command,origin:'agent'}),/operator|authenticated/i);
  await assert.rejects(f.store.command({...command,actor:'impostor'}),/operator/i);
  await assert.rejects(f.store.command({...command,response:{...command.response!,teamRequest:{...command.response!.teamRequest!,requestId:'wrong-outer-id'}}}),/request|binding/i);
  await assert.rejects(hostRespond(f,response,'guide'),/human|authenticated/i,'Guide cannot approve formal human request');
  await assert.rejects(hostRespond(f,{...response,output:{...response.output,value:{wrong:'schema'}}}),/schema|answer|output/i);
  assert.deepEqual(await retained(f,p.identity.effectId),initial);
  assert.equal(await f.store.flowFact(f.runId,`response:${p.identity.effectId}`),null);
  assert.equal((await f.store.effectSnapshot(p.identity)).result,null);
  await hostRespond(f,response);
  let continuation!:Continuation;
  await waitUntil('DBOS human output is committed and consumed by actual retained successor',async()=>{
    const head=await f.store.readTeamEffectHead(f.parent.identity);
    if(head.state!=='active'||!head.continuation)return false;continuation=head.continuation;
    return !!(await f.store.effectSnapshot(p.identity)).result;
  },30000,25);
  const settled=await retained(f,p.identity.effectId);
  assert.deepEqual(settled.request!.response,response);
  assert.equal(settled.request!.response_digest,jsonDigest(response));
  assert.equal(settled.request!.digest,jsonDigest(p.request));
  assert.deepEqual(await f.store.flowFact(f.runId,`response:${p.identity.effectId}`),response.output);
  const delivery=await f.store.readTeamCommittedDelivery(p.identity);assert.ok(delivery);
  assert.deepEqual(delivery.value,{answer:'human-measured'});
  assert.equal(delivery.outputSchemaVersion,childVersion);
  const resources=await f.store.effectResources(p.identity.effectId);
  assert.equal(resources.length,1);assert.equal(resources[0]!.siteId,'@human');
  assert.deepEqual(resources[0]!.claim,{siteId:'@human',jobs:0,licences:{}});
  assert.equal(resources[0]!.released,true);assert.deepEqual(resources[0]!.proof,{humanResponse:true,closed:true});
  assert.equal(await f.store.effectFact(p.identity.effectId,'native:oar:closed'),undefined,'human does not invent a native process proof');
  assert.deepEqual(continuation.inputs.map(input=>input.result),[delivery]);
  assert.ok(continuation.hostPrompt.includes('human-measured'));
  assert.deepEqual((await f.readTask()).humanRequests,[]);
  const routeId='team-human-response-'+jsonDigest([f.task.taskId,response.requestId]);
  const replay={...command,commandId:routeId};
  await f.store.command(replay);
  await hostRespond(f,response);
  await Promise.all([f.store.command({...replay,commandId:'same-response-race-a'}),f.store.command({...replay,commandId:'same-response-race-b'})]);
  assert.deepEqual(await retained(f,p.identity.effectId),settled,'same response produces one retained receipt and settlement');
  await assert.rejects(f.store.command({...replay,actor:'impostor'}),/operator/i,'old command ID cannot bypass current operator');
  await assert.rejects(f.store.command({...replay,origin:'agent'}),/operator|authenticated/i);
  await assert.rejects(f.store.command({...replay,response:{effectId:p.identity.effectId,output:response.output}}),/formal|binding|operator/i);
  const conflict=responseFor(p.request,'conflicting-answer');
  await assert.rejects(f.store.command(await commandFor(f,conflict,'different-command-id')),/different|conflict/i);
  await assert.rejects(hostRespond(f,conflict),/different|conflict|reused/i);
  await assert.rejects(hostRespond(f,{...response,binding:{...response.binding,principalId:'forged-original-principal'}}),/binding|operator|request/i,'same route request ID must reject forged retained principal');
  assert.deepEqual(await retained(f,p.identity.effectId),settled);
  f.successors(true);
  await writeFile(path.join(f.evidence,'allow-receive'),'actual successor input');
  await waitUntil('actual successor receives human result and commits original contract',async()=>{
    if(!await f.store.effectFact(continuation.invocation.identity.effectId,'prepared'))return false;
    const snapshot=await f.store.effectSnapshot(continuation.invocation.identity);
    return !!snapshot.result&&snapshot.resourcesReleased;
  },25000,25);
  assert.deepEqual((await f.store.effectSnapshot(continuation.invocation.identity)).result!.value,{answer:'successor-measured'});
  const inputs=(await f.events()).filter(row=>row.kind==='input');
  assert.equal(inputs.length,2,'actual parent and successor only; human starts no native child process');
  assert.equal(inputs.filter(row=>row.effectId===p.identity.effectId).length,0);
  assert.equal(inputs.filter(row=>row.effectId===continuation.invocation.identity.effectId).length,1);
  t.diagnostic(JSON.stringify({level:'L2-real-Host-PG-DBOS-controlled-Node',productModelCalls:0,nativeSdkCalls:0,submissions:2,runId:f.runId}));
});

test('timely human result remains readable after child expiry but all late POST retries reject without renewing expiry', {timeout:90000},async t=>{
  const f=await fixture(t),expiresAt=new Date(Date.now()+15000).toISOString(),p=await pending(f,expiresAt),response=responseFor(p.request);
  assert.equal(p.request.binding.expiresAt,expiresAt);
  await hostRespond(f,response);
  await waitUntil('real timely human committed result',async()=>!!(await f.store.effectSnapshot(p.identity)).result,15000,25);
  const before=await retained(f,p.identity.effectId),command=await commandFor(f,response,'team-human-response-'+jsonDigest([f.task.taskId,response.requestId]));
  await waitUntil('absolute original child expiry',async()=>Date.now()>=Date.parse(expiresAt),20000,25);
  await assert.rejects(f.store.command(command),/expired|deadline/i,'same accepted command receipt requires current expiry admission');
  await assert.rejects(hostRespond(f,response),/expired|deadline/i,'cached DBOS control outcome cannot authorize a late POST');
  assert.deepEqual(await retained(f,p.identity.effectId),before);
  assert.ok(await f.store.readTeamCommittedDelivery(p.identity),'committed timely delivery uses retained proof without fresh dispatch');
  assert.deepEqual((await f.readTask()).humanRequests,[]);
});

for(const control of ['pause','cancel','revoke'] as const)test(`actual ${control} fences original human binding and preserves unsettled response facts`,{timeout:90000},async t=>{
  const f=await fixture(t),p=await pending(f),response=responseFor(p.request),command=await commandFor(f,response);
  if(control==='revoke')await f.store.revokeTeamGrant(f.grantId,'operator');
  else {const run=await f.store.run(f.runId);await f.store.command({runId:f.runId,commandId:'human-control-'+control,action:control,
    owner:run.owner,epoch:run.epoch,revision:run.revision,origin:'human',actor:await f.store.operatorIdentity()});}
  const before=await retained(f,p.identity.effectId);
  await assert.rejects(f.store.command(command),/current|control|generation|revision|revok|cancel|stale|admit|operator|fence/i);
  await assert.rejects(hostRespond(f,response),/current|control|generation|revision|revok|cancel|stale|admit|operator|fence/i);
  assert.deepEqual(await retained(f,p.identity.effectId),before);
  assert.equal(await f.store.flowFact(f.runId,`response:${p.identity.effectId}`),null);
  assert.equal((await f.store.effectSnapshot(p.identity)).result,null);
  assert.deepEqual((await f.readTask()).humanRequests,[]);
});

test('concurrent different human responses retain one PG winner and exact replay only', {timeout:90000},async t=>{
  const f=await fixture(t),p=await pending(f),a=responseFor(p.request,'race-alpha'),b=responseFor(p.request,'race-beta');
  const outcomes=await Promise.allSettled([f.store.command(await commandFor(f,a,'race-a')),f.store.command(await commandFor(f,b,'race-b'))]);
  assert.equal(outcomes.filter(outcome=>outcome.status==='fulfilled').length,1);
  assert.equal(outcomes.filter(outcome=>outcome.status==='rejected').length,1);
  const state=await retained(f,p.identity.effectId),winner=state.request!.response;assert.ok(winner);
  assert.ok(['race-alpha','race-beta'].includes((winner.output.value as {answer:string}).answer));
  assert.equal(state.request!.response_digest,jsonDigest(winner));assert.equal(state.commands.length,1);
  assert.deepEqual(await f.store.flowFact(f.runId,`response:${p.identity.effectId}`),winner.output);
  await hostRespond(f,winner);
  await waitUntil('actual concurrent response winner becomes one human TaskResult',async()=>!!(await f.store.effectSnapshot(p.identity)).result,20000,25);
  assert.deepEqual((await f.store.effectSnapshot(p.identity)).result!.value,winner.output.value);
  const replay=await retained(f,p.identity.effectId);
  await Promise.all([hostRespond(f,winner),f.store.command(await commandFor(f,winner,'replay-new-id'))]);
  assert.deepEqual(await retained(f,p.identity.effectId),replay);
  await assert.rejects(f.store.command(await commandFor(f,winner.requestId===a.requestId&&jsonDigest(winner.output)===jsonDigest(a.output)?b:a,'new-conflicting-id')),/different|conflict/i);
});

test('first response after original child expiry leaves no human response fact or TaskResult', {timeout:90000},async t=>{
  const f=await fixture(t),expiresAt=new Date(Date.now()+10000).toISOString(),p=await pending(f,expiresAt),response=responseFor(p.request);
  const before=await retained(f,p.identity.effectId);
  await waitUntil('unanswered human request absolute expiry',async()=>Date.now()>=Date.parse(expiresAt),15000,25);
  await assert.rejects(hostRespond(f,response),/expired|deadline|control|admit/i);
  await assert.rejects(f.store.command(await commandFor(f,response)),/expired|deadline|control|admit/i);
  assert.deepEqual(await retained(f,p.identity.effectId),before);
  assert.equal(await f.store.flowFact(f.runId,`response:${p.identity.effectId}`),null);
  assert.equal((await f.store.effectSnapshot(p.identity)).result,null);
  assert.deepEqual((await f.readTask()).humanRequests,[]);
});
