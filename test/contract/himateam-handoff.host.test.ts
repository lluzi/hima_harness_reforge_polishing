// #105 L2: real Host/private PG/DBOS, production Store/TaskEffects/native port,
// actual ordinary Node IPC process. Controlled IO is NOT Pi/OpenCode L4.
// Native delegate/wait tools and missing in-flight MCP promises are not qualified here.
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { createHash } from 'node:crypto';
import { appendFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
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
const effects = await import(pathToFileURL(path.join(lib, 'task-effects.js')).href) as typeof import('../../packages/harness/lib/types/task-effects.js');
const { jsonDigest } = await import(pathToFileURL(path.join(lib, 'run-store.js')).href) as typeof import('../../packages/harness/lib/types/run-store.js');
type Prepared = import('../../packages/harness/lib/types/oar-task-adapter.js').OarPrepared;
type Lease = import('../../packages/harness/lib/types/oar-local-member.js').LocalMemberLease;
type Continuation = import('../../packages/harness/lib/types/flow-workflow.js').TeamEffectContinuation;
const sha = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false; throw error; } };
const childVersion = 'delegated-answer/7';
const childOutput = { ...teamFixture.delivery.output, version: childVersion };

async function fixture(t: TestContext, deadlineMs = 60000, heldPeer = false, scenario?: 'dependency' | 'subsets' | 'linked-revoke' | 'early-prose' | 'early-output' | 'early-fault') {
  const home = await localHome(t, { sleepSeconds: 0, ...(heldPeer ? { desktopShaped: true } : {}) }); assert.ok(home);
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
import fs from 'node:fs'; import path from 'node:path'; import {spawn} from 'node:child_process'; import {randomUUID} from 'node:crypto';
const scenario=${JSON.stringify(scenario)}; const evidence=${JSON.stringify(evidence)}; const heldPeer=${JSON.stringify(heldPeer)}; let c, input, descendant;
const log=value=>fs.appendFileSync(path.join(evidence,'events.jsonl'),JSON.stringify({...value,pid:process.pid,at:new Date().toISOString()})+'\\n');
const isAlive=pid=>{try{process.kill(pid,0);return true;}catch(e){if(e.code==='ESRCH')return false;throw e;}};
const pauseUntil=file=>new Promise(resolve=>{const poll=setInterval(()=>{if(fs.existsSync(path.join(evidence,file))){clearInterval(poll);resolve();}},15);});
const request=(action,value)=>{const id=randomUUID();log({kind:'request-sent',id,action,requestId:value.requestId??null});fs.writeFileSync(path.join(c.controlDirectory,'native/requests',id+'.json'),JSON.stringify({id,action,request:value}),{flag:'wx',mode:0o600});return new Promise((resolve,reject)=>{const poll=setInterval(()=>{const file=path.join(c.controlDirectory,'replies',id+'.json');if(!fs.existsSync(file))return;clearInterval(poll);const reply=JSON.parse(fs.readFileSync(file,'utf8'));log({kind:'request-reply',id,action,ok:reply.ok,...(reply.ok?{}:{error:reply.error})});if(reply.ok)resolve(reply.value);else reject(Error(reply.error));},15);});};
const scenarioInput=async m=>{
 const p=c.prepared; process.send({type:'received',payload:{inputId:m.id,evidence:'actual-scenario-node-ipc'}});
 const data=path.join(c.controlDirectory,'native/data');
 if(p.memberId==='lead'&&!c.continuity){
  await pauseUntil('start-scenario');
  if(scenario==='early-prose'||scenario==='early-output'||scenario==='early-fault'){
   const child=await request('delegate',{requestId:'early-child',memberId:'worker',goal:'Measured child',input:{label:'child'},output:${JSON.stringify(childOutput)},dependsOn:[],deadlineAt:p.deadlineAt});
   const wait=await request('wait',{requestId:'early-wait',delegationIds:[child.delegationId]});
   if(wait.state!=='yield-accepted'||typeof wait.waitId!=='string')throw Error('No actual accepted native wait reply');
   log({kind:'early-wait-consumed',wait});
   if(scenario==='early-fault'){process.send({type:'failure',reason:'Actual accepted-wait native fault before cleanup'});log({kind:'early-failure-sent'});return;}
   process.send({type:'terminal',payload:{inputId:m.id,outcome:{kind:'completed'}}});
   process.send({type:'finished',inputId:m.id,text:scenario==='early-output'?JSON.stringify({schemaVersion:c.outputSchemaVersion,value:{answer:'forbidden-old-parent'},artifacts:[],diagnostics:[]}):'Yield accepted; waiting for the child.'});
   log({kind:'early-finish-sent',inputId:m.id});return;
  }
  const output=${JSON.stringify(childOutput)};
  const a=await request('delegate',{requestId:'scenario-A',memberId:'worker',goal:'A measured',input:{label:'A'},output,dependsOn:[],deadlineAt:p.deadlineAt});
  const b=await request('delegate',{requestId:'scenario-B',memberId:'worker',goal:'B measured',input:{label:'B'},output,dependsOn:scenario==='dependency'?[a.delegationId]:[],deadlineAt:p.deadlineAt});
  fs.writeFileSync(path.join(data,'delegations.json'),JSON.stringify({a,b}));
  fs.writeFileSync(path.join(evidence,'accepted.json'),JSON.stringify({a,b}));
  await pauseUntil('allow-first-wait');
  await request('wait',{requestId:'scenario-wait-1',delegationIds:[scenario==='dependency'?b.delegationId:a.delegationId]});return;
 }
 if(p.memberId==='lead'&&(scenario==='subsets'||scenario==='linked-revoke')&&!fs.existsSync(path.join(evidence,'first-successor.json'))){
  fs.writeFileSync(path.join(evidence,'first-successor.json'),JSON.stringify({pid:process.pid,effectId:p.identity.effectId}));
  await pauseUntil('allow-second-wait');
  const {b}=JSON.parse(fs.readFileSync(path.join(data,'delegations.json'),'utf8'));
  await request('wait',{requestId:'scenario-wait-2',delegationIds:[b.delegationId]});return;
 }
 let answer='successor-measured';
 if(p.memberId==='worker'){
  const own=await request('readTask',{});log({kind:'actual-readTask',effectId:p.identity.effectId,receipt:own});
  const label=own.input.input.delegationInput?.label??own.input.input.label;answer=label+'-measured';
  const first=path.join(evidence,'first-successor.json');if(label==='B'&&fs.existsSync(first)&&isAlive(JSON.parse(fs.readFileSync(first,'utf8')).pid))throw Error('B input before first successor physical close');
  if(label==='B'&&scenario==='dependency'){
   const work=await request('read-member-work',{memberId:'worker',page:{limit:100}});
   const a=work.records.find(row=>row.result&&row.result.text.includes('A-measured'));if(!a)throw Error('B did not read actual retained committed A source');
   log({kind:'dependency-source-receipt',effectId:p.identity.effectId,receipt:a,dependencyResults:own.input.input.dependencyResults});
  }
 }
 if(scenario==='linked-revoke'&&answer==='B-measured'){log({kind:'linked-B-held',effectId:p.identity.effectId});await pauseUntil('allow-B-finish');}
 process.send({type:'terminal',payload:{inputId:m.id,outcome:{kind:'completed'}}});
 process.send({type:'finished',inputId:m.id,text:JSON.stringify({schemaVersion:c.outputSchemaVersion,value:{answer},artifacts:[],diagnostics:[]})});
};
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
  if(heldPeer&&p.memberId==='worker'){
   descendant=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',detached:true});
   fs.writeFileSync(path.join(evidence,'peer.json'),JSON.stringify({pid:process.pid,descendant:descendant.pid}));
  }
  const native=successor?c.continuity.checkpoint.origin.nativeSession:'controlled-'+p.identity.effectId;
  log({kind:'created',effectId:p.identity.effectId,memberId:p.memberId,control:c.controlDirectory,cwd:c.workDirectory,native,version:c.outputSchemaVersion});
  process.send({type:'created',payload:{runtime:p.runtime,nativeSession:native}});
 }
 if(m.type==='input'){
  input=m;const p=c.prepared;
  log({kind:'input',effectId:p.identity.effectId,memberId:p.memberId,inputId:m.id,text:m.input,successor:!!c.continuity});
  if(scenario){void scenarioInput(m).catch(error=>{log({kind:'scenario-failure',effectId:p.identity.effectId,error:String(error)});process.send({type:'failure',reason:String(error)});});return;}
  // Successor native reception is gated, letting the test distinguish a queued
  // prompt from the actual correlated receive observation without fake receipts.
  const finish=()=>{
   process.send({type:'received',payload:{inputId:m.id,evidence:'actual-controlled-node-ipc'}});
   if((p.memberId==='lead'&&!c.continuity)||(heldPeer&&p.memberId==='worker'))return;
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
  let releaseHandoff!:()=>void, handoffEntered=false;
  const handoffGate=new Promise<void>(resolve=>{releaseHandoff=resolve;});
  const peerCloseObservations: string[] = [];
  const cleanupOwned: Array<() => Promise<void>> = [];
  const local: NonNullable<import('../../packages/harness/lib/types/oar-member-process.js').OarMemberProcessOptions['localRuntime']> = {
    stage: (...args) => runtime.stage(...args), start: (...args) => runtime.start(...args),
    read: (...args) => runtime.read(...args), authorize: (...args) => runtime.authorize(...args),
    ...(typeof (runtime as any).admitAcceptedWait==='function' ? { admitAcceptedWait: (...args:any[]) => (runtime as any).admitAcceptedWait(...args) } : {}),
    reply: (...args) => runtime.reply(...args), sendInput: (...args) => runtime.sendInput(...args),
    readArtifact: (...args) => runtime.readArtifact(...args), recover: (...args) => runtime.recover(...args),
    captureClosedContext: (...args) => runtime.captureClosedContext(...args), stopAll: () => runtime.stopAll(),
    close: async (lease, options) => {
      if(options&&(scenario==='early-prose'||scenario==='early-output'||scenario==='early-fault')){
        handoffEntered=true; await handoffGate;
      }
      if (heldPeer && lease.sessionKey !== parent.sessionKey) {
        const exit = await service.durable.store.hostExit(); assert.ok(exit, 'accepted exit precedes peer physical close');
        const run = await service.durable.store.run(runId);
        assert.equal(run.holdSource, 'human'); assert.match(run.hold ?? '', /explicit controlled continuation required/);
        peerCloseObservations.push(lease.sessionKey);
        if (unknownClose) return { closed: false, reason: 'Controlled peer physical closer is unavailable' };
      }
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
    memberContext: async (grant, request) => {
      if (!scenario) throw Error('This fixture does not invoke native MCP tools');
      return (service as unknown as { memberActorContext(grant: ActorGrant, request: unknown): Promise<object> }).memberActorContext(grant, request);
    },
  });
  t.after(async () => {
    // Retain bounded native wire/errors before the owned Home is deleted. This
    // observation is evidence only; it supplies no Host success or closure proof.
    if (scenario) {
      const outputRoot = process.env.HIMA_ISSUE105_WAIT_EVIDENCE ?? path.resolve('.scratch/himateam-issue97/issue105-wait-fixture-evidence');
      await mkdir(outputRoot, { recursive: true });
      const retained = await mkdtemp(path.join(outputRoot, scenario + '-'));
      try {
        const text = await readFile(path.join(evidence, 'events.jsonl'), 'utf8');
        await writeFile(path.join(retained, 'events.jsonl'), text.slice(-128 * 1024));
        const created = text.trim().split('\n').map(line => JSON.parse(line) as Record<string, any>).filter(row => row.kind === 'created');
        for (const row of created) {
          try { await writeFile(path.join(retained, row.effectId + '-journal.jsonl'), (await readFile(path.join(row.control, 'journal.jsonl'), 'utf8')).slice(-128 * 1024)); }
          catch (error) { await writeFile(path.join(retained, row.effectId + '-journal-error.txt'), String(error)); }
        }
        const invocations = await service.durable.store.flowInvocations(runId);
        const facts = [];
        for (const invocation of invocations) {
          const value = await service.durable.store.effectSnapshot(invocation.identity);
          facts.push({ identity: invocation.identity, result: value.result, resourcesReleased: value.resourcesReleased });
        }
        await writeFile(path.join(retained, 'retained-store.json'), JSON.stringify({ delegations: (await service.durable.store.readTeamDelegations(runId)).map(row => ({ delegationId: row.delegation.delegationId, parentEffectId: row.parentEffectId, sha256: jsonDigest(row) })), effects: facts }, null, 2));
      } catch (error) { await writeFile(path.join(retained, 'capture-error.txt'), String(error)); }
      t.diagnostic('Bounded native fixture evidence: ' + retained);
    }
    releaseHandoff(); unknownClose = false; allowSuccessor = true;
    await writeFile(path.join(evidence, 'allow-receive'), 'cleanup');
    // Stop only this fixture's Local processes before asking the real Host closer
    // to reconcile its retained PG leases; never abandon unknown resources.
    if (!heldPeer) {
      let hostClosed = false;
      try { await runtime.stopAll(); await host.dispose(); hostClosed = true; }
      finally {
        await executor.dispose();
        if (hostClosed) await home.h.dispose();
        else t.diagnostic('Retained unproved Host Home: ' + home.h.home);
      }
      return;
    }
    let firstFailure: unknown, retryFailure: unknown;
    try { await host.dispose(); }
    catch (error) {
      firstFailure = error;
      // Retain failure before any test-owned fallback, never upgrade it to product PASS.
      await writeFile(path.join(evidence, 'initial-host-disposal-failure.json'), JSON.stringify({
        message: error instanceof Error ? error.message : String(error), productClosed: false }));
    } finally {
      // Genuine Local close and its birth checks own only this fixture's OS families.
      // This fallback is after primary assertions/Host disposal, never their proof.
      try {
        // Successful Host disposal has already proved closure and ended Store/PG.
        // These owning callbacks reconcile only a failed primary boundary; calling
        // them after success would query an ended pool and mask a passing body.
        const outcomes = firstFailure ? await Promise.allSettled(cleanupOwned.map(close => close())) : [];
        const failed = outcomes.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
        if (failed.length) {
          firstFailure ??= new AggregateError(failed.map(result => result.reason), 'Owned descendant physical close remains unproved');
          await writeFile(path.join(evidence, 'owned-descendant-close-failure.json'), JSON.stringify({ productClosed: false, errors: failed.map(result => ({ name: result.reason instanceof Error ? result.reason.name : 'UnknownError', message: result.reason instanceof Error ? result.reason.message : String(result.reason) })) }));
        }
      } finally { try { await runtime.stopAll(); } finally { await executor.dispose(); } }
    }
    if (firstFailure) {
      try {
        // The failed product attempt may retain unreleased PG leases after genuine
        // fallback closure. Reconcile each original invocation leaf first, under a
        // new accepted exit, before retrying the same ordered Host/PG closer.
        const active = await service.durable.store.hostExit();
        const requestId = 'fixture-retained-close';
        await service.durable.store.acceptHostExit({ requestId, mode: 'keep-jobs',
          ...(active ? { expectedRequestId: active.requestId } : {}) });
        const invocations = await service.durable.store.flowInvocations(runId);
        const descendants = await service.durable.store.derivedEffects(parent.identity);
        const ordered = [...descendants.map(child => invocations.find(row => row.identity.effectId === child.identity.effectId)),
          ...invocations].filter((row): row is NonNullable<typeof row> => !!row);
        const seen = new Set<string>();
        for (const invocation of ordered) {
          if (seen.has(invocation.identity.effectId)) continue;
          seen.add(invocation.identity.effectId);
          await (await service.durable.startWorkflow('hima.flow.cleanup', 'fixture-retained-close:' + invocation.identity.effectId,
            { runId, invocation: invocation as unknown as import('@hima/harness').JsonValue,
              reason: 'team-exit', exitRequestId: requestId })).getResult();
        }
        // Access only the existing closer; no permission/ownership guard is overridden.
        await (service as unknown as { closeHostResources(): Promise<void> }).closeHostResources();
      } catch (error) { retryFailure = error; }
      finally {
        // Avoid contaminating another in-process test with DBOS's singleton even
        // if the genuine Host closer remains unproved. Preserve this private Home.
        if (retryFailure) await service.durable.stop();
      }
      t.diagnostic('Retained failed Host Home: ' + home.h.home);
      t.diagnostic('Primary Host/owned close error: ' + (firstFailure instanceof Error ? firstFailure.message : String(firstFailure)));
      if (retryFailure) t.diagnostic('Host reconciliation error: ' + (retryFailure instanceof Error ? retryFailure.message : String(retryFailure)));
      throw retryFailure ? new AggregateError([firstFailure, retryFailure], 'Initial Host disposal failed; reconciliation remains unproved') : firstFailure;
    }
    await home.h.dispose();
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
  const readTask = () => service.teamOperation(guide, { action: 'readTask', teamId: team.teamId, taskId: task.taskId });
  const delegate = async (actor: { kind: 'member'; grant: ActorGrant } = { kind: 'member', grant }) => {
    const run = await store.run(runId);
    return workflow.delegateFlowTask(service.durable, { runId, parentEffectId: parent.identity.effectId,
      actor, owner: run.owner, epoch: run.epoch, revision: run.revision,
      request: { requestId: 'actual-child', memberId: 'worker', goal: 'Return child-measured under delegated-answer/7.',
        input: {}, output: childOutput, dependsOn: [], deadlineAt } }, store.teamFlow());
  };
  const waitInput = async (delegationId: string) => {
    const run = await store.run(runId);
    return { parentEffectId: parent.identity.effectId, requestId: 'actual-wait', actor: { kind: 'member' as const, grant },
      owner: run.owner, epoch: run.epoch, revision: run.revision, delegationIds: [delegationId] };
  };
  return { home, host, service, store, runId, team, task, parent, parentLease, grant, grantId, runtime, executor,
    evidence, events, readTask, delegate, waitInput, peerCloseObservations, cleanupOwned,
    unknown: (value: boolean) => { unknownClose = value; },
    successors: (value: boolean) => { allowSuccessor = value; },
    releaseHandoff, handoffEntered:()=>handoffEntered };
}

test('capacity one actually closes/captures/releases parent, commits custom child, replays head, receives and commits successor', { timeout: 90000 }, async t => {
  const f = await fixture(t);
  const original = JSON.parse(await readFile(path.join(f.evidence, 'original.json'), 'utf8')) as { pid: number; descendant: number };
  assert.ok(alive(original.pid)); assert.ok(alive(original.descendant));
  const delegated = await f.delegate();
  assert.deepEqual(await f.delegate(), delegated, 'same engineering delegation is replayed, not submitted twice');
  const before = await f.store.teamFlow().delegationGate(f.runId, delegated.delegationId);
  assert.equal(before.state, 'waiting', 'child cannot take the sole occupied resource');
  const input = await f.waitInput(delegated.delegationId);
  const accepted = await f.store.acceptTeamWait(input);
  assert.deepEqual(await f.store.acceptTeamWait(input), accepted);
  await assert.rejects(f.store.acceptTeamWait({ ...input, requestId: 'different-wait' }), /different|conflict/i);
  let continuation!: Continuation;
  await waitUntil('real workflow child committed and retained one successor head', async () => {
    const head = await f.store.readTeamEffectHead(f.parent.identity);
    if (head.state !== 'active' || !head.continuation) return false;
    continuation = head.continuation;
    return continuation.inputs.length === 1 && !!(await f.store.effectSnapshot(continuation.inputs[0]!.result.identity)).result;
  }, 30000, 25);
  assert.equal(alive(original.pid), false); assert.equal(alive(original.descendant), false);
  const closed = await f.store.externalEffectFact(f.parent.identity, 'oar:closed'); assert.ok(closed);
  const resources = await f.store.effectResources(f.parent.identity.effectId);
  assert.equal(resources.length, 1); assert.equal(resources[0]!.released, true); assert.deepEqual(resources[0]!.proof, closed);
  assert.equal(continuation.context.kind, 'native-checkpoint');
  if (continuation.context.kind !== 'native-checkpoint') throw Error('Actual ordinary file capture was required');
  const checkpoint = continuation.context.checkpoint;
  assert.equal(checkpoint.requestId, accepted.requestId, 'Store and IO must bind the original accepted business request identity');
  assert.notEqual(accepted.waitId,accepted.requestId,'the derived wait fact must not replace the business request identity');
  assert.equal(checkpoint.boundary, 'after-physical-close');
  assert.deepEqual(checkpoint.origin.identity, f.parent.identity); assert.equal(checkpoint.origin.cwd, f.parentLease.workDirectory);
  assert.ok(checkpoint.excluded.includes('data/auth.json'));
  assert.equal(checkpoint.files.length, 1);
  const bytes = await readFile(path.join(f.parentLease.controlDirectory, 'checkpoints', checkpoint.checkpointId, checkpoint.files[0]!.path));
  assert.equal(bytes.toString(), 'ordinary-node-context-sentinel\n'); assert.equal(sha(bytes), checkpoint.files[0]!.sha256);
  assert.ok(Date.parse(checkpoint.capturedAt) >= Date.parse((closed as { observedAt: string }).observedAt));
  const child = continuation.inputs[0]!;
  assert.equal(child.result.outputSchemaVersion, childVersion); assert.deepEqual(child.result.value, { answer: 'child-measured' });
  assert.notEqual(child.childEffectId, f.parent.identity.effectId);
  assert.equal(child.result.identity.runId, f.runId); assert.ok('source' in child.result.identity);
  assert.deepEqual(await f.store.acceptTeamEffectContinuation(accepted.waitId), continuation, 'child-commit boundary read/replay returns the same retained continuation');
  const replay = await f.store.readTeamExecutionBinding(continuation.invocation.identity);
  assert.deepEqual(replay.continuation, continuation);
  assert.equal((await f.events()).filter(row => row.kind === 'input').length, 2, 'original and child only before successor admission');
  assert.notEqual(continuation.invocation.identity.effectId, f.parent.identity.effectId);
  const { effectId: _old, ...oldIdentity } = f.parent.identity, { effectId: _new, ...newIdentity } = continuation.invocation.identity;
  assert.deepEqual(newIdentity, oldIdentity, 'same logical source/method/version/input provenance');
  assert.equal(sha(continuation.hostPrompt), continuation.hostInputSha256);
  assert.ok(continuation.hostPrompt.includes('child-measured'));
  f.successors(true);
  let successor!: Prepared, lease!: Lease;
  await waitUntil('actual successor input queued once without fabricated receive', async () => {
    successor = await f.store.effectFact(continuation.invocation.identity.effectId, 'prepared') as unknown as Prepared;
    if (!successor) return false;
    lease = await f.runtime.recover(successor.sessionKey) as Lease;
    return !!lease?.pid && (await f.events()).some(row => row.kind === 'input' && row.effectId === successor.identity.effectId);
  }, 20000, 25);
  assert.notEqual(successor.sessionKey, f.parent.sessionKey); assert.notEqual(lease.pid, original.pid);
  assert.notEqual(lease.controlDirectory, f.parentLease.controlDirectory); assert.equal(lease.workDirectory, f.parentLease.workDirectory);
  assert.equal(successor.prompt, continuation.hostPrompt); assert.equal(successor.inputId, continuation.hostInputId);
  const successorGrant = await f.store.readTeamGrant('grant-' + jsonDigest([successor.sessionKey, successor.generation])); assert.ok(successorGrant);
  assert.equal(successorGrant.effectId, successor.identity.effectId); assert.equal(successorGrant.memberId, 'lead');
  assert.equal((await f.store.readTeamGrant(f.grantId))!.revokedAt === null, false);
  assert.equal((await f.store.effectSnapshot(successor.identity)).result, null, 'queued successor prompt cannot commit a result');
  await assert.rejects(f.store.recordTeamResultInputReceipt({ continuationId: continuation.continuationId,
    successorIdentity: successor.identity, hostInputId: continuation.hostInputId,
    hostInputSha256: continuation.hostInputSha256, nativeReceipt: { queued: true } }), /receive|receipt/i);
  await assert.rejects(f.store.recordTeamResultInputReceipt({ continuationId: continuation.continuationId,
    successorIdentity: { ...successor.identity, effectId: f.parent.identity.effectId }, hostInputId: continuation.hostInputId,
    hostInputSha256: continuation.hostInputSha256, nativeReceipt: { queued: true } }), /mismatch|different|input/i);
  await writeFile(path.join(f.evidence, 'allow-receive'), 'receive actual successor input');
  await waitUntil('production TaskEffects commits actual successor output and closes its resources', async () => {
    const snapshot = await f.store.effectSnapshot(successor.identity);
    return !!snapshot.result && snapshot.resourcesReleased;
  }, 25000, 25);
  const snapshot = await f.store.effectSnapshot(successor.identity); assert.ok(snapshot.result);
  assert.deepEqual(snapshot.result.value, { answer: 'successor-measured' }); assert.deepEqual(snapshot.result.identity, successor.identity);
  const receipt = await f.store.effectFact(successor.identity.effectId, 'team-result-input-receipt:' + continuation.continuationId); assert.ok(receipt);
  const oldNative = await f.store.externalEffectFact(f.parent.identity, 'oar:native-session') as { streamGeneration: string };
  const newNative = await f.store.externalEffectFact(successor.identity, 'oar:native-session') as { streamGeneration: string };
  assert.notEqual(newNative.streamGeneration, oldNative.streamGeneration);
  const counts = (await f.events()).filter(row => row.kind === 'input');
  assert.equal(counts.length, 3); assert.equal(counts.filter(row => row.effectId === child.childEffectId).length, 1);
  assert.equal(counts.filter(row => row.effectId === successor.identity.effectId).length, 1, 'no replayed engineering/result input');
  assert.equal(alive(lease.pid!), false);
  t.diagnostic(JSON.stringify({ level: 'L2-controlled-ordinary-Node', hostBoots: 1, submissions: counts.length, nativeSdkCalls: 0, productModelCalls: 0, runId: f.runId }));
});

test('unknown actual Local birth identity blocks handoff, child, successor and result until original close is reconciled', { timeout: 90000 }, async t => {
  const f = await fixture(t); f.unknown(true);
  const child = await f.delegate(); const wait = await f.store.acceptTeamWait(await f.waitInput(child.delegationId));
  await waitUntil('real Local birth refusal reaches durable task observation', async () => {
    const view = JSON.stringify(await f.readTask()); return /identity mismatch|physical closure|unproved/i.test(view);
  }, 20000, 25);
  assert.ok(alive(f.parentLease.pid!));
  assert.equal((await f.store.effectResources(f.parent.identity.effectId))[0]!.released, false);
  assert.equal((await f.store.effectSnapshot(f.parent.identity)).result, null);
  assert.equal((await f.store.teamFlow().delegationGate(f.runId, child.delegationId)).state, 'waiting');
  await assert.rejects(f.store.acceptTeamEffectContinuation(wait.waitId), /unproved|waiting|committed|handoff/i);
  assert.equal((await f.events()).filter(row => row.kind === 'input').length, 1, 'unknown close never authorizes child/downstream');
  f.unknown(false);
});

for (const control of ['cancel', 'revoke', 'expiry'] as const) test(`accepted wait followed by ${control} cannot start fresh child/successor business`, { timeout: 90000 }, async t => {
  const f = await fixture(t, control === 'expiry' ? 12000 : 60000); f.unknown(true);
  const child = await f.delegate(); const wait = await f.store.acceptTeamWait(await f.waitInput(child.delegationId));
  if (control === 'revoke') await f.store.revokeTeamGrant(f.grantId, 'operator');
  let cancelHandle: Awaited<ReturnType<typeof workflow.controlFlow>> | undefined;
  if (control === 'cancel') {
    const run = await f.store.run(f.runId), operator = await f.store.operatorIdentity();
    cancelHandle = await workflow.controlFlow(f.service.durable, {runId:f.runId,commandId:'cancel-after-wait',action:'cancel',
      owner:run.owner,epoch:run.epoch,revision:run.revision,actor:operator,origin:'human'});
  }
  await waitUntil('retained current head is blocked by real control/deadline', async () => (await f.store.readTeamEffectHead(f.parent.identity)).state === 'blocked', 20000, 25);
  await assert.rejects(f.store.acceptTeamEffectContinuation(wait.waitId), /authorized|expired|stopped|control|revok|cancel|current/i);
  await assert.rejects(f.delegate(), /authorized|expired|stopped|control|revok|cancel|current/i);
  assert.equal((await f.events()).filter(row => row.kind === 'input').length, 1);
  assert.equal((await f.store.effectSnapshot(f.parent.identity)).result, null);
  f.unknown(false);
  if(cancelHandle)await cancelHandle.getResult();
});

test('real PG rejects wrong source/effect/grant and unknown wait sets without inventing handoff authority', { timeout: 90000 }, async t => {
  const f = await fixture(t);
  const child = await f.delegate(); const input = await f.waitInput(child.delegationId);
  for (const grant of [{ ...f.grant, effectId: 'wrong-effect' }, { ...f.grant, grantId: 'unknown-grant' },
    { ...f.grant, memberId: 'worker', actorId: 'worker' }, { ...f.grant, projectId: 'wrong-source-project' }])
    await assert.rejects(f.store.acceptTeamWait({ ...input, actor: { kind: 'member', grant } }), /authorized|grant|member|source|scope|different|invocation/i);
  await assert.rejects(f.store.acceptTeamWait({ ...input, delegationIds: ['unrelated-delegation'] }), /unknown|unrelated/i);
  await assert.rejects(f.store.readTeamEffectHead({ ...f.parent.identity, inputSha256: 'f'.repeat(64) }), /mismatch|different|identity/i);
  await assert.rejects(f.store.readTeamExecutionBinding({ ...f.parent.identity, effectId: 'wrong-effect' }), /mismatch|different|binding/i);
  const wait = await f.store.acceptTeamWait(input);
  const context = await f.store.readTeamReconstructionContext(wait.waitId);
  assert.equal(typeof f.parentLease.processGroup,'number');
  await assert.rejects(f.store.recordTeamHandoff({ waitId: wait.waitId, parentIdentity: f.parent.identity,
    context, closureProof: { absent: true, processGroup: f.parentLease.processGroup!, time: new Date().toISOString() } }), /unproved|closed|proof|native|closure/i);
  assert.equal((await f.store.effectSnapshot(f.parent.identity)).result, null);
});

// Regression for #105 SPEC P1: revocation must close already received native
// input even when no cancellation occurs or a reversible human hold remains.
for (const ownRunPause of [false, true]) test(`operator revoke closes active native family${ownRunPause ? ' under own Run human pause' : ''} before original deadline`, { timeout: 90000 }, async t => {
  const f = await fixture(t, 90000);
  const original = JSON.parse(await readFile(path.join(f.evidence, 'original.json'), 'utf8')) as { pid: number; descendant: number };
  assert.ok(alive(original.pid)); assert.ok(alive(original.descendant));
  const before = await f.store.run(f.runId);
  assert.equal(before.cancelled, false); assert.equal(before.hold, null);
  assert.equal((await f.events()).filter(row => row.kind === 'input').length, 1);
  if (ownRunPause) {
    const operator = await f.store.operatorIdentity();
    await (await workflow.controlFlow(f.service.durable, { runId: f.runId, commandId: 'active-revoke-own-pause', action: 'pause',
      owner: before.owner, epoch: before.epoch, revision: before.revision, actor: operator, origin: 'human' })).getResult();
    assert.ok((await f.store.run(f.runId)).hold);
    assert.ok(alive(original.pid)); assert.ok(alive(original.descendant));
  }
  await f.store.revokeTeamGrant(f.grantId, 'operator');
  // The actual Host-issued capability is rejected while physical cleanup proceeds.
  await assert.rejects(f.store.authorizeTeamGrant(f.grant, 'read-task'), /current capability|authorized|revok/i);
  await waitUntil('operator revoke physically closes original native family and releases owned resources', async () => {
    const snapshot = await f.store.effectSnapshot(f.parent.identity);
    return !alive(original.pid) && !alive(original.descendant) && snapshot.resourcesReleased &&
      !!await f.store.externalEffectFact(f.parent.identity, 'oar:closed') &&
      !!await f.store.flowFact(f.runId, 'stopped:' + f.parent.identity.effectId);
  }, 30000, 25);
  const after = await f.store.run(f.runId);
  assert.equal(after.deadlineAt, before.deadlineAt); assert.ok(Date.now() < Date.parse(after.deadlineAt));
  assert.equal(after.cancelled, false, 'revocation does not depend on human cancellation');
  assert.equal(!!after.hold, ownRunPause, 'physical cleanup does not resume a human-paused Run');
  const snapshot = await f.store.effectSnapshot(f.parent.identity);
  assert.equal(snapshot.result, null);
  const closed = await f.store.externalEffectFact(f.parent.identity, 'oar:closed'); assert.ok(closed);
  const resources = await f.store.effectResources(f.parent.identity.effectId);
  assert.equal(resources.length, 1); assert.equal(resources[0]!.released, true); assert.deepEqual(resources[0]!.proof, closed);
  assert.equal((await f.store.flowInvocations(f.runId)).length, 1, 'no fresh child or successor invocation');
  assert.equal((await f.events()).filter(row => row.kind === 'input').length, 1, 'no fresh native engineering input');
  await assert.rejects(f.delegate(), /authorized|expired|stopped|control|revok|current/i);
});


// #105: invoke original leader cleanup first regardless of randomized lexical effect IDs.
// Production wait/yield and capacity admission run before the accepted human exit.
for (const unknownPeer of [false, true]) test(`leader-first cleanup composes actual yielded native peer${unknownPeer ? ' and retains unknown closure for same-resource retry' : ''}`, { timeout: 90000 }, async t => {
  const f = await fixture(t, 90000, true);
  const original = JSON.parse(await readFile(path.join(f.evidence, 'original.json'), 'utf8')) as { pid: number; descendant: number };
  const delegated = await f.delegate();
  assert.equal((await f.store.teamFlow().delegationGate(f.runId, delegated.delegationId)).state, 'waiting');
  await f.store.acceptTeamWait(await f.waitInput(delegated.delegationId));
  let peer!: Prepared;
  await waitUntil('genuine wait closes original family before actual peer input', async () => {
    for (const invocation of await f.store.flowInvocations(f.runId)) {
      const prepared = await f.store.effectFact(invocation.identity.effectId, 'prepared') as unknown as Prepared | undefined;
      if (prepared?.memberId === 'worker') peer = prepared;
    }
    return !!peer && (await f.events()).some(row => row.kind === 'input' && row.effectId === peer.identity.effectId);
  }, 30000, 25);
  assert.equal(alive(original.pid), false); assert.equal(alive(original.descendant), false);
  const parentProof = await f.store.externalEffectFact(f.parent.identity, 'oar:closed'); assert.ok(parentProof);
  assert.deepEqual((await f.store.effectResources(f.parent.identity.effectId))[0]!.proof, parentProof);
  const native = JSON.parse(await readFile(path.join(f.evidence, 'peer.json'), 'utf8')) as { pid: number; descendant: number };
  assert.ok(alive(native.pid)); assert.ok(alive(native.descendant));
  const invocations = await f.store.flowInvocations(f.runId);
  const leader = invocations.find(row => row.identity.effectId === f.parent.identity.effectId)!;
  assert.ok(leader); assert.equal(invocations.length, 2);
  f.unknown(unknownPeer);
  const exit = { requestId: 'derived-leader-first', mode: 'keep-jobs' as const };
  await f.store.acceptHostExit(exit);
  // Only this explicit leader workflow is invoked by the test; no child-first sort.
  const closeLeader = async (requestId: string) => (await f.service.durable.startWorkflow('hima.flow.cleanup',
    'test-derived-leader:' + requestId, { runId: f.runId, invocation: leader as unknown as import('@hima/harness').JsonValue,
      reason: 'team-exit', exitRequestId: requestId })).getResult() as Promise<{ closed: boolean; reason?: string }>;
  const result = await closeLeader(exit.requestId);
  if (unknownPeer) {
    assert.equal(result.closed, false);
    assert.equal((await f.store.effectResources(peer.identity.effectId))[0]!.released, false);
    assert.equal(await f.store.externalEffectFact(peer.identity, 'oar:closed'), undefined);
    assert.equal(await f.store.flowFact(f.runId, 'stopped:' + peer.identity.effectId), null);
    assert.equal(await f.store.flowFact(f.runId, 'stopped:' + f.parent.identity.effectId), null);
    assert.ok(alive(native.pid)); assert.ok(alive(native.descendant));
    assert.equal((await f.service.exitStatus()).ready, false);
    assert.equal((await f.events()).filter(row => row.kind === 'created').length, 2);
    assert.equal((await f.events()).filter(row => row.kind === 'input').length, 2);
    f.unknown(false);
    // App-exit cleanup outcomes are immutable. A genuine new accepted exit request
    // retries the same physical resources, without fresh business admission.
    const retry = { ...exit, requestId: 'derived-leader-retry', expectedRequestId: exit.requestId };
    await f.store.acceptHostExit(retry);
    assert.equal((await closeLeader(retry.requestId)).closed, true);
  } else assert.equal(result.closed, true);
  assert.equal(alive(native.pid), false); assert.equal(alive(native.descendant), false);
  for (const identity of [f.parent.identity, peer.identity]) {
    const proof = await f.store.externalEffectFact(identity, 'oar:closed'); assert.ok(proof);
    const resources = await f.store.effectResources(identity.effectId);
    assert.equal(resources.length, 1); assert.equal(resources[0]!.released, true); assert.deepEqual(resources[0]!.proof, proof);
    assert.ok(await f.store.flowFact(f.runId, 'stopped:' + identity.effectId));
  }
  assert.ok(f.peerCloseObservations.length);
  assert.equal((await f.service.exitStatus()).ready, true);
  assert.equal((await f.events()).filter(row => row.kind === 'created').length, 2);
  assert.equal((await f.events()).filter(row => row.kind === 'input').length, 2);
});


// A real adapter-internal command Job has no independently registered invocation.
// Its retained lease/proof remains strict even after the owning native peer closes.
test('typed unregistered-grandchild proof refusal still closes known native identities', { timeout: 90000 }, async t => {
  const f = await fixture(t, 90000, true);
  const primaryEvidenceRoot = path.resolve(process.env.HIMA_TEST_EVIDENCE_DIR ?? '.hima-tmp/issue105-case-evidence');
  await mkdir(primaryEvidenceRoot, { recursive: true });
  const primaryEvidenceFile = path.join(primaryEvidenceRoot, f.parent.identity.effectId + '-grandchild-primary.json');
  let phase = 'genuine-wait-admission';
  // This record is outside the isolated Home and is written before t.after runs,
  // so a teardown failure cannot replace or delete the actual primary body result.
  try {
  const delegated = await f.delegate();
  await f.store.acceptTeamWait(await f.waitInput(delegated.delegationId));
  let peer!: Prepared;
  await waitUntil('actual peer starts after original wait/yield', async () => {
    for (const invocation of await f.store.flowInvocations(f.runId)) {
      const prepared = await f.store.effectFact(invocation.identity.effectId, 'prepared') as unknown as Prepared | undefined;
      if (prepared?.memberId === 'worker') peer = prepared;
    }
    return !!peer && (await f.events()).some(row => row.kind === 'input' && row.effectId === peer.identity.effectId);
  }, 30000, 25);
  const invocations = await f.store.flowInvocations(f.runId);
  const leader = invocations.find(row => row.identity.effectId === f.parent.identity.effectId)!;
  const peerInvocation = invocations.find(row => row.identity.effectId === peer.identity.effectId)!;
  const context = peerInvocation.context as unknown as { input: import('@hima/harness').JsonValue;
    taskId: string; flow: import('@hima/harness').CompiledFlow };
  const identity = { ...peer.identity, effectId: peer.identity.effectId + ':held-unregistered' };
  await f.store.bindDerivedEffect(peer.identity, identity);
  const run = await f.store.run(f.runId);
  const request: import('../../packages/harness/lib/types/task-effects.js').TaskEffectRequest = {
    identity, input: context.input, contract: context.flow.tasks[context.taskId]!.contract,
    localSchemas: context.flow.localSchemas,
    admission: { runId: f.runId, effectId: identity.effectId, owner: run.owner, epoch: run.epoch, revision: run.revision },
  };
  phase = 'actual-grandchild-before-exit-dispatch';
  const marker = path.join(f.home.h.workspace, 'actual-grandchild.json');
  // The existing local Site permits sh. Quoted positional arguments exec the
  // ordinary Node fixture without changing wrappers, capacity or permission.
  const script = path.join(f.home.h.workspace, 'actual-grandchild.mjs');
  await writeFile(script, `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(marker)}, JSON.stringify({pid:process.pid})); setInterval(()=>{},1000);`);
  const adapter = effects.commandTaskAdapter({ sitesDir: path.join(f.home.h.home, 'hima/sites'), siteId: 'local',
    workspace: f.home.h.workspace, name: 'held-unregistered-grandchild',
    argv: ['/bin/sh', '-c', 'exec "$1" "$2"', 'hima-grandchild', process.execPath, script],
    collect: async () => { throw Error('Running grandchild has no business output'); } });
  let grandchildPhysicalClosureRecorded = false;
  const closeGrandchild = async () => {
    if (grandchildPhysicalClosureRecorded) return;
    const snapshot = await f.store.effectSnapshot(identity);
    if (snapshot.resourcesReleased) return;
    assert.ok(snapshot.facts.prepared);
    const exit = await f.store.hostExit(); assert.ok(exit);
    const result = await adapter.stop!(snapshot.facts.prepared, snapshot.facts.submitted,
      (id, value) => f.store.claimEffectCleanup(identity, () => adapter.permit(snapshot.facts.prepared!, 'release'),
        'stop:' + id, jsonDigest(value), exit.requestId));
    assert.equal(result.closed, true, 'Only actual command Job physical stop releases its original lease');
    if (result.closed) {
      await f.store.releaseEffectResources(identity, result.proof);
      grandchildPhysicalClosureRecorded = true;
    }
  };
  f.cleanupOwned.push(closeGrandchild);
  assert.equal((await effects.executeTaskEffect(f.store, request, adapter)).state, 'running');
  let grandchildPid = 0;
  await waitUntil('actual unregistered Node Job birth', async () => {
    try { grandchildPid = (JSON.parse(await readFile(marker, 'utf8')) as { pid: number }).pid; return alive(grandchildPid); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
  }, 10000, 25);
  assert.equal((await f.store.flowInvocations(f.runId)).some(row => row.identity.effectId === identity.effectId), false);
  assert.equal(await f.store.effectDispatchExists(identity, 'submit'), true);
  assert.equal((await f.store.effectResources(identity.effectId))[0]!.released, false);
  const peerNative = JSON.parse(await readFile(path.join(f.evidence, 'peer.json'), 'utf8')) as { pid: number; descendant: number };
  assert.ok(alive(peerNative.pid)); assert.ok(alive(peerNative.descendant));
  const closeLeader = async (requestId: string) => (await f.service.durable.startWorkflow('hima.flow.cleanup',
    'test-grandchild-leader:' + requestId, { runId: f.runId, invocation: leader as unknown as import('@hima/harness').JsonValue,
      reason: 'team-exit', exitRequestId: requestId })).getResult() as Promise<{ closed: boolean; reason?: string }>;
  phase = 'leader-first-typed-refusal';
  await f.store.acceptHostExit({ requestId: 'grandchild-exit', mode: 'keep-jobs' });
  const result = await closeLeader('grandchild-exit');
  assert.equal(result.closed, false); assert.match(result.reason ?? '', /Original resource closure is unproved/);
  phase = 'known-native-physical-absence-and-retained-grandchild';
  assert.equal(alive(peerNative.pid), false); assert.equal(alive(peerNative.descendant), false);
  assert.ok(alive(grandchildPid), 'Unknown adapter-internal original Job remains held');
  const peerProof = await f.store.externalEffectFact(peer.identity, 'oar:closed'); assert.ok(peerProof);
  assert.deepEqual((await f.store.effectResources(peer.identity.effectId))[0]!.proof, peerProof);
  assert.equal((await f.store.effectResources(peer.identity.effectId))[0]!.released, true);
  const unknown = (await f.store.effectResources(identity.effectId))[0]!;
  assert.equal(unknown.released, false); assert.equal(unknown.proof, null);
  for (const id of [f.parent.identity.effectId, peer.identity.effectId, identity.effectId])
    assert.equal(await f.store.flowFact(f.runId, 'stopped:' + id), null);
  assert.equal((await f.service.exitStatus()).ready, false);
  // Restore only the genuinely owning command closer and retry the original tree.
  phase = 'genuine-grandchild-owned-close';
  await closeGrandchild(); assert.equal(alive(grandchildPid), false);
  phase = 'same-tree-fresh-exit-retry';
  await f.store.acceptHostExit({ requestId: 'grandchild-exit-retry', mode: 'keep-jobs', expectedRequestId: 'grandchild-exit' });
  assert.equal((await closeLeader('grandchild-exit-retry')).closed, true);
  assert.ok(await f.store.flowFact(f.runId, 'stopped:' + peer.identity.effectId));
  assert.ok(await f.store.flowFact(f.runId, 'stopped:' + f.parent.identity.effectId));
  assert.equal((await f.service.exitStatus()).ready, true);
  assert.equal((await f.events()).filter(row => row.kind === 'created').length, 2);
  assert.equal((await f.events()).filter(row => row.kind === 'input').length, 2);
  await writeFile(primaryEvidenceFile, JSON.stringify({ state: 'passed', phase: 'primary-assertions-complete',
    runId: f.runId, parentEffectId: f.parent.identity.effectId, peerEffectId: peer.identity.effectId,
    grandchildEffectId: identity.effectId, peerNative, grandchildPid, grandchildPhysicalClosureRecorded, primaryBodyPassed: true }));
  } catch (error) {
    await writeFile(primaryEvidenceFile, JSON.stringify({ state: 'failed', phase, runId: f.runId,
      parentEffectId: f.parent.identity.effectId, primaryBodyPassed: false,
      error: { name: error instanceof Error ? error.name : 'UnknownError',
        message: error instanceof Error ? error.message : String(error),
        ...(error instanceof Error ? { stack: error.stack } : {}) } }));
    throw error;
  } finally { t.diagnostic('Primary grandchild evidence: ' + primaryEvidenceFile); }
});

for (const scenario of ['dependency', 'subsets'] as const) {
  test('native partial wait preserves accepted work: ' + scenario, { timeout: 120000 }, async t => {
    const f = await fixture(t, 100000, false, scenario);
    await writeFile(path.join(f.evidence, 'start-scenario'), 'native requests permitted');
    let admissions!: Awaited<ReturnType<typeof f.store.readTeamDelegations>>;
    await waitUntil('actual native A/B accepted before first wait', async () => {
      admissions = await f.store.readTeamDelegations(f.runId); return admissions.length === 2;
    }, 15000, 25);
    const original = admissions.map(row => jsonDigest(row));
    const a = admissions.find(row => row.delegation.request.requestId === 'scenario-A')!;
    const b = admissions.find(row => row.delegation.request.requestId === 'scenario-B')!;
    assert.ok(a); assert.ok(b); assert.equal(b.parentEffectId, f.parent.identity.effectId);
    f.successors(true);
    await writeFile(path.join(f.evidence, 'allow-first-wait'), 'actual first yield permitted');
    let first!: Continuation;
    await waitUntil('A progressed and actual successor created after partial wait', async () => {
      const head = await f.store.readTeamEffectHead(f.parent.identity);
      if (head.state !== 'active' || !head.continuation) return false;
      first = head.continuation;
      return !!await f.store.effectFact(first.invocation.identity.effectId, 'team-result-input-receipt:' + first.continuationId);
    }, 30000, 25);
    assert.deepEqual(first.inputs.map(row => row.delegationId), scenario === 'dependency' ? [a.delegation.delegationId, b.delegation.delegationId] : [a.delegation.delegationId]);
    const firstWait = await f.store.transaction(async client => (await client.query('SELECT acceptance FROM hima.team_waits WHERE wait_id=$1', [first.waitId])).rows[0].acceptance, 'test.readOriginalWait');
    assert.deepEqual(firstWait.delegationIds, [scenario === 'dependency' ? b.delegation.delegationId : a.delegation.delegationId]);
    let last = first;
    if (scenario === 'subsets') {
      assert.equal((await f.events()).filter(row => row.kind === 'input' && row.memberId === 'worker').length, 1);
      const prepared = await f.store.effectFact(first.invocation.identity.effectId, 'prepared') as unknown as Prepared;
      const current = await f.store.readTeamGrant('grant-' + jsonDigest([prepared.sessionKey, prepared.generation])); assert.ok(current);
      await assert.rejects(f.store.authorizeTeamWait({ ...await f.waitInput(b.delegation.delegationId), runId: f.runId }), /current|revok|open|permission|author/i);
      await assert.rejects(f.store.acceptTeamWait({ ...await f.waitInput(a.delegation.delegationId), requestId: 'different-old-wait' }), /different|conflict/i, 'original persisted wait keeps its immutable request/digest');
      await writeFile(path.join(f.evidence, 'allow-second-wait'), 'actual successor native request permitted');
      await waitUntil('second actual successor has received B', async () => {
        const head = await f.store.readTeamEffectHead(f.parent.identity);
        if (head.state !== 'active' || !head.continuation || head.continuation.continuationId === first.continuationId) return false;
        last = head.continuation;
        return !!await f.store.effectFact(last.invocation.identity.effectId, 'team-result-input-receipt:' + last.continuationId);
      }, 45000, 25);
      assert.deepEqual(last.inputs.map(row => row.delegationId), [b.delegation.delegationId]);
      assert.equal(alive(JSON.parse(await readFile(path.join(f.evidence, 'first-successor.json'), 'utf8')).pid), false);
    }
    // Keep prompt provenance as a final check after the actual inherited wait
    // and native receipt, so old-source RED reaches its original authority gate.
    assert.ok(first.hostPrompt.includes('"requestedDelegationIds":[' + JSON.stringify(scenario === 'dependency' ? b.delegation.delegationId : a.delegation.delegationId) + ']'));
    await waitUntil('actual final commit and physical close', async () => { const value = await f.store.effectSnapshot(last.invocation.identity); return !!value.result && value.resourcesReleased; }, 20000, 25);
    assert.deepEqual((await f.store.readTeamDelegations(f.runId)).map(row => jsonDigest(row)), original);
    assert.equal(last.invocation.identity.runId, f.runId); assert.equal(last.invocation.identity.taskId, f.parent.identity.taskId);
    assert.equal(last.deadlineAt, f.parent.deadlineAt);
    const inputs = (await f.events()).filter(row => row.kind === 'input');
    assert.equal(inputs.length, scenario === 'dependency' ? 4 : 5);
    assert.equal(new Set(inputs.map(row => row.effectId)).size, inputs.length);
    for (const continuation of scenario === 'dependency' ? [first] : [first, last])
      assert.ok(await f.store.effectFact(continuation.invocation.identity.effectId, 'team-result-input-receipt:' + continuation.continuationId));
    if (scenario === 'dependency') {
      const receipt = (await f.events()).find(row => row.kind === 'dependency-source-receipt'); assert.ok(receipt);
      assert.equal(receipt.receipt.result.sha256, first.inputs[0]!.resultSha256);
      assert.equal(receipt.receipt.result.effectId, first.inputs[0]!.childEffectId);
      assert.deepEqual(receipt.dependencyResults[a.delegation.delegationId], first.inputs[0]!.result);
      assert.equal(jsonDigest(receipt.dependencyResults[a.delegation.delegationId]), first.inputs[0]!.resultSha256);
    }
  });
}

test('inherited native wait requires actual successor closure and revocation authority', { timeout: 100000 }, async t => {
  const f = await fixture(t, 80000, false, 'subsets');
  f.successors(true);
  await writeFile(path.join(f.evidence, 'start-scenario'), 'start');
  await waitUntil('native accepted original independent children', async () => (await f.store.readTeamDelegations(f.runId)).length === 2, 15000, 25);
  const admissions = await f.store.readTeamDelegations(f.runId), frozen = admissions.map(row => jsonDigest(row));
  const b = admissions.find(row => row.delegation.request.requestId === 'scenario-B')!;
  await writeFile(path.join(f.evidence, 'allow-first-wait'), 'first wait');
  let first!: Continuation, prepared!: Prepared;
  await waitUntil('actual first successor received A and remains live', async () => {
    const head = await f.store.readTeamEffectHead(f.parent.identity);
    if (head.state !== 'active' || !head.continuation) return false;
    first = head.continuation;
    prepared = await f.store.effectFact(first.invocation.identity.effectId, 'prepared') as unknown as Prepared;
    return !!prepared && !!await f.store.effectFact(first.invocation.identity.effectId, 'team-result-input-receipt:' + first.continuationId);
  }, 25000, 25);
  const current = await f.store.readTeamGrant('grant-' + jsonDigest([prepared.sessionKey, prepared.generation])); assert.ok(current);
  const run = await f.store.run(f.runId);
  const input = { parentEffectId: prepared.identity.effectId, requestId: 'foreign-probe', actor: { kind: 'member' as const, grant: current }, owner: run.owner, epoch: run.epoch, revision: run.revision, delegationIds: [b.delegation.delegationId] };
  for (const grant of [{ ...current, generation: current.generation + 1 }, { ...current, memberId: 'foreign-member' }, { ...current, taskId: 'foreign-task' }, { ...current, runId: 'foreign-run' }])
    await assert.rejects(f.store.acceptTeamWait({ ...input, actor: { kind: 'member', grant } }), /grant|author|permission|task|run|context|current|generat/i);
  await assert.rejects(f.store.acceptTeamWait({ ...input, delegationIds: ['unknown-delegation'] }), /unknown|unrelated/i);
  assert.equal((await f.events()).filter(row => row.kind === 'input' && row.memberId === 'worker').length, 1);
  f.unknown(true);
  await writeFile(path.join(f.evidence, 'allow-second-wait'), 'actual native second wait');
  await waitUntil('retained actual successor wait before unknown physical close', async () => {
    const head = await f.store.readTeamEffectHead(f.parent.identity); return head.state === 'waiting' && head.wait.parentIdentity.effectId === prepared.identity.effectId;
  }, 15000, 25);
  assert.equal((await f.store.teamFlow().delegationGate(f.runId, b.delegation.delegationId)).state, 'waiting');
  assert.equal((await f.events()).filter(row => row.kind === 'input' && row.memberId === 'worker').length, 1);
  await f.store.revokeTeamGrant(current.grantId, 'operator');
  assert.equal((await f.store.teamFlow().delegationGate(f.runId, b.delegation.delegationId)).state, 'cancelled');
  assert.equal(await f.store.teamEffectOperatorRevoked(prepared.identity), true);
  assert.equal((await f.store.effectSnapshot(prepared.identity)).result, null);
  assert.deepEqual((await f.store.readTeamDelegations(f.runId)).map(row => jsonDigest(row)), frozen);
});

test('operator revoke of actual inherited waiter closes already-linked B under effective authority', { timeout: 100000 }, async t => {
  const f = await fixture(t, 80000, false, 'linked-revoke'); f.successors(true);
  await writeFile(path.join(f.evidence, 'start-scenario'), 'start');
  await waitUntil('actual native accepted independent A/B', async () => (await f.store.readTeamDelegations(f.runId)).length === 2, 15000, 25);
  const admissions = await f.store.readTeamDelegations(f.runId), frozen = admissions.map(row => jsonDigest(row));
  const b = admissions.find(row => row.delegation.request.requestId === 'scenario-B')!;
  await writeFile(path.join(f.evidence, 'allow-first-wait'), 'first wait');
  let first!: Continuation, waiter!: Prepared;
  await waitUntil('actual first successor received A', async () => {
    const head = await f.store.readTeamEffectHead(f.parent.identity);
    if (head.state !== 'active' || !head.continuation) return false;
    first = head.continuation; waiter = await f.store.effectFact(first.invocation.identity.effectId, 'prepared') as unknown as Prepared;
    return !!waiter && !!await f.store.effectFact(first.invocation.identity.effectId, 'team-result-input-receipt:' + first.continuationId);
  }, 25000, 25);
  const current = await f.store.readTeamGrant('grant-' + jsonDigest([waiter.sessionKey, waiter.generation])); assert.ok(current);
  await writeFile(path.join(f.evidence, 'allow-second-wait'), 'second actual native wait');
  let child!: Prepared;
  await waitUntil('B actual input and source read occurred but terminal is held', async () => {
    const held = (await f.events()).find(row => row.kind === 'linked-B-held');
    if (!held) return false;
    child = await f.store.effectFact(String(held.effectId), 'prepared') as unknown as Prepared;
    return !!child;
  }, 30000, 25);
  const before = await f.store.effectSnapshot(child.identity); assert.equal(before.result, null); assert.equal(before.resourcesReleased, false);
  const originalLink = (await f.store.derivedEffects(f.parent.identity)).find(row => row.identity.effectId === child.identity.effectId); assert.ok(originalLink);
  // B retains the old accepted parent/link although successor waiter owns the real yield.
  assert.equal(b.parentEffectId, f.parent.identity.effectId);
  assert.ok(await f.store.externalEffectFact(waiter.identity, 'oar:closed'));
  const lease = await f.runtime.recover(child.sessionKey); assert.ok(lease?.pid); assert.equal(alive(lease.pid), true);
  await f.store.revokeTeamGrant(current.grantId, 'operator');
  assert.equal(await f.store.teamEffectOperatorRevoked(child.identity), true, 'cleanup must see later waiter authority through unchanged old B link');
  assert.equal((await f.store.teamFlow().delegationGate(f.runId, b.delegation.delegationId)).state, 'cancelled');
  await waitUntil('production polling closes B after inherited waiter revoke', async () => {
    const value = await f.store.effectSnapshot(child.identity);
    return !alive(lease.pid!) && value.resourcesReleased && !!await f.store.externalEffectFact(child.identity, 'oar:closed') && !!await f.store.flowFact(f.runId, 'stopped:' + child.identity.effectId);
  }, 30000, 25);
  assert.equal((await f.store.effectSnapshot(child.identity)).result, null);
  assert.deepEqual((await f.store.readTeamDelegations(f.runId)).map(row => jsonDigest(row)), frozen);
  const finalLink = (await f.store.derivedEffects(f.parent.identity)).find(row => row.identity.effectId === child.identity.effectId); assert.ok(finalLink);
  // Observed phase advances with closure; the original lineage/intent remains exact.
  assert.deepEqual({ identity: finalLink.identity, parentIdentity: finalLink.parentIdentity, intent: finalLink.intent, purpose: finalLink.purpose },
    { identity: originalLink.identity, parentIdentity: originalLink.parentIdentity, intent: originalLink.intent, purpose: originalLink.purpose });
  assert.equal((await f.events()).filter(row => row.kind === 'input').length, 4);
});


for (const scenario of ['early-prose','early-output'] as const) test('genuine native wait reply fences immediate completion before physical handoff: '+scenario, {timeout:90000}, async t=>{
  const f=await fixture(t,60000,false,scenario); f.successors(true);
  const original=JSON.parse(await readFile(path.join(f.evidence,'original.json'),'utf8'));
  await writeFile(path.join(f.evidence,'start-scenario'),'native delegate and wait');
  await waitUntil('actual successful wait consumed and original completion ingressed',async()=>{
    if(!(await f.events()).some(row=>row.kind==='early-finish-sent'))return false;
    const view=await f.runtime.read(f.parentLease);
    return view.journal.includes('"kind":"finished"')||view.journal.includes('Invalid initial delivery JSON');
  },15000,25);
  const view=await f.runtime.read(f.parentLease);
  // Old-source RED must report the original Invalid initial delivery JSON/stop,
  // or valid old-parent result, rather than hiding behind a later Flow timeout.
  assert.doesNotMatch(view.journal,/Invalid initial delivery JSON|Invalid TaskToolOutput delivery/);
  assert.equal(view.result,null,'yielding original never creates TaskToolOutput result');
  assert.equal(JSON.parse(view.state!).fatal,undefined);
  assert.ok(alive(original.pid));assert.ok(alive(original.descendant));
  assert.equal((await f.store.effectSnapshot(f.parent.identity)).result,null);
  const resources=await f.store.effectResources(f.parent.identity.effectId);
  assert.equal(resources.length,1);assert.equal(resources[0]!.released,false);
  assert.equal((await f.store.flowInvocations(f.runId)).length,1,'no child before genuine physical proof');
  const rows=view.journal.trim().split('\n').map(line=>JSON.parse(line));
  assert.equal(rows.filter(row=>row.kind==='control'&&row.payload.action==='yield_intent').length,1);
  assert.equal(rows.filter(row=>row.kind==='finished'&&row.payload.inputId===f.parent.inputId).length,1);
  assert.equal(rows.some(row=>row.kind==='control'&&row.payload.action==='stop'),false);
  f.releaseHandoff();
  let continuation!:Continuation, recordedMissingSuccessor=false;
  await waitUntil('checked child delivery and successor committed through ordinary handoff',async()=>{
    const head=await f.store.readTeamEffectHead(f.parent.identity);
    if(head.state!=='active'||!head.continuation)return false;
    continuation=head.continuation;
    const successorEffect=await f.store.effect(continuation.invocation.identity.effectId);
    if(!successorEffect){
      if(!recordedMissingSuccessor){
        recordedMissingSuccessor=true;
        await appendFile(path.join(f.evidence,'events.jsonl'),JSON.stringify({kind:'successor-not-materialized',
          identity:continuation.invocation.identity,at:new Date().toISOString()})+'\n');
      }
      return false;
    }
    assert.deepEqual(successorEffect.identity,continuation.invocation.identity,'actual successor effect retains the full frozen continuation identity');
    const result=await f.store.effectSnapshot(continuation.invocation.identity);
    return !!result.result&&result.resourcesReleased;
  },30000,25);
  assert.equal(alive(original.pid),false);assert.equal(alive(original.descendant),false);
  assert.equal(continuation.context.kind,'native-checkpoint');
  assert.equal(continuation.inputs.length,1);assert.deepEqual(continuation.inputs[0]!.result.value,{answer:'child-measured'});
  assert.ok(await f.store.effectFact(continuation.invocation.identity.effectId,'team-result-input-receipt:'+continuation.continuationId));
  const inputs=(await f.events()).filter(row=>row.kind==='input');
  assert.equal(inputs.length,3);assert.equal(new Set(inputs.map(row=>row.effectId)).size,3);
  assert.equal(continuation.deadlineAt,f.parent.deadlineAt);
});


test('genuine accepted wait cannot continue a true pre-cleanup native fault',{timeout:90000},async t=>{
 const f=await fixture(t,60000,false,'early-fault');f.successors(true);
 await writeFile(path.join(f.evidence,'start-scenario'),'native delegate and wait');
 await waitUntil('actual accepted-wait native fault retained',async()=>{
   if(!(await f.events()).some(row=>row.kind==='early-failure-sent'))return false;
   return JSON.parse((await f.runtime.read(f.parentLease)).state!).fatal===true;
 },15000,25);
 assert.equal((await f.store.effectSnapshot(f.parent.identity)).result,null);
 f.releaseHandoff();
 await waitUntil('actual original physical closure retained by normal handoff',async()=>!!await f.store.externalEffectFact(f.parent.identity,'oar:closed'),15000,25);
 assert.equal(alive(f.parentLease.pid!),false);
 const view=await f.runtime.read(f.parentLease);assert.match(JSON.parse(view.state!).failureReason,/Actual accepted-wait native fault/);
 const head=await f.store.readTeamEffectHead(f.parent.identity);assert.equal(head.state,'waiting');
 assert.equal((await f.store.flowInvocations(f.runId)).length,1,'failed parent never admits child or reconstructed successor');
 assert.equal((await f.store.effectResources(f.parent.identity.effectId))[0]!.released,false,'physical absence alone is not successful handoff');
});
