// @hima-seam cordis direct
// @hima-seam agent wrapped
// #105 T20 proposed L2 worker: actual DSH/Hima Host in its own killable OS process.
// Controlled ordinary Node IO does not qualify Pi/OpenCode SDK or model L4.
// Must be admitted serially by Root against a fresh matching build. UNRUN proposal.
// #105 L2: real Host/private PG/DBOS, production Store/TaskEffects/native port,
// actual ordinary Node IPC process. Controlled IO is NOT Pi/OpenCode L4.
// Native delegate/wait tools and missing in-flight MCP promises are not qualified here.
import assert from 'node:assert/strict';
import { Service } from '@deepseek-ai/cordis';
import Hima from '@hima/harness';
import type { HimaHome } from './dsh-home.ts';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ActorGrant, FlowAdapterContext, TeamDefinition } from '@hima/harness';
import { bootInProcess, createRootAgent, resumeTestAgent } from './boot-inprocess.ts';
import { waitUntil } from './fabric.ts';
import { teamFixture } from './himateam.ts';

process.env.HIMA_TEST_SILENT_AGENT = '1';
process.env.HIMA_TEST_LEGACY_AUTO_DRIVE = '0';
const lib = process.env.HIMA_DBOS_TEST_LIB ?? path.resolve('packages/harness/lib');
const localModule = await import(pathToFileURL(path.join(lib, 'oar-local-member.js')).href) as typeof import('../../../packages/harness/lib/types/oar-local-member.js');
const portModule = await import(pathToFileURL(path.join(lib, 'oar-member-process.js')).href) as typeof import('../../../packages/harness/lib/types/oar-member-process.js');
const workflow = await import(pathToFileURL(path.join(lib, 'flow-workflow.js')).href) as typeof import('../../../packages/harness/lib/types/flow-workflow.js');
const { taskEffectStep } = await import(pathToFileURL(path.join(lib,'task-effects.js')).href) as typeof import('../../../packages/harness/lib/types/task-effects.js');
const { jsonDigest } = await import(pathToFileURL(path.join(lib, 'run-store.js')).href) as typeof import('../../../packages/harness/lib/types/run-store.js');
type Prepared = import('../../../packages/harness/lib/types/oar-task-adapter.js').OarPrepared;
type Lease = import('../../../packages/harness/lib/types/oar-local-member.js').LocalMemberLease;
type Continuation = import('../../../packages/harness/lib/types/flow-workflow.js').TeamEffectContinuation;
const sha = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false; throw error; } };
const childVersion = 'delegated-answer/7';
const childOutput = { ...teamFixture.delivery.output, version: childVersion };

async function fixture(h: HimaHome, mode: 'seed' | 'recover') {
  const home = { h };
  let service!: InstanceType<typeof Hima>;
  let executor!: ReturnType<typeof portModule.createOarMemberExecutor>;
  const evidence = path.join(home.h.home, 'handoff-test');
  await mkdir(evidence, { recursive: true });
  const runner = path.join(evidence, 'controlled-runner.mjs');
  // The fixture writes ordinary bytes to the real private native directory, sends
  // actual IPC receive/terminal events and counts inputs. No TaskResult is fabricated.
  // The real Local runtime records OS birth, stream, result binding and closure.
  if (mode === 'seed') await writeFile(runner, `
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
  let allowSuccessor = mode === 'recover';
  const local: NonNullable<import('../../../packages/harness/lib/types/oar-member-process.js').OarMemberProcessOptions['localRuntime']> = {
    stage: (...args) => runtime.stage(...args), start: (...args) => runtime.start(...args),
    read: (...args) => runtime.read(...args), authorize: (...args) => runtime.authorize(...args),
    reply: (...args) => runtime.reply(...args), sendInput: (...args) => runtime.sendInput(...args),
    readArtifact: (...args) => runtime.readArtifact(...args), recover: (...args) => runtime.recover(...args),
    captureClosedContext: (...args) => runtime.captureClosedContext(...args), stopAll: () => runtime.stopAll(),
    close: (...args) => runtime.close(...args),
  };
  // External worker injection; no product test flag or second runtime/kernel.
  // Hima opens real PG and registers/launches DBOS exactly as shipped. Its adapter
  // callbacks await durableAdaptersReady. Install this setter BEFORE original init
  // so recovered callbacks cannot race post-boot replacement of the adapter.
  const originalInit = Hima.prototype[Service.init];
  Hima.prototype[Service.init] = async function () {
    const owner = this;
    let installed: typeof owner.teamExecutor;
    Object.defineProperty(owner, 'teamExecutor', { configurable: true,
      get: () => installed,
      set: () => {
  executor = portModule.createOarMemberExecutor({ home: home.h.home,
    retainedMaterialsDir: path.join(home.h.home, 'handoff-materials'), store: owner.durable.store,
    services: {} as import('../../../packages/harness/lib/types/team-service-runtime.js').TeamServiceRuntime,
    localRuntime: local, runtimeAssets: async () => assets,
    sharedDeepSeekModel: async () => { throw Error('No product model credential fallback permitted'); },
    memberContext: async () => { throw Error('This fixture does not invoke native MCP tools'); },
  });
        installed = { readiness: async () => ({ ready: true, missing: [] }),
          resolve: async (context: FlowAdapterContext) => {
            if ((await owner.durable.store.readTeamExecutionBinding(context.request.identity)).continuation) {
              const availability=await taskEffectStep('test.himateam.successor-materialization',async()=>({allowed:allowSuccessor}));
              if(!availability.allowed)throw new workflow.TaskAdapterMaterializationError({ code: 'controlled-admission',
                message: 'T20 boundary: committed child, no successor submission.', source: 'test-fixture' });
            }
            return executor.resolve(context);
          } };
      } });
    return originalInit.call(this);
  };
  const host = await bootInProcess(h);
  service = host.ctx.hima;
  assert.ok(service instanceof Hima, 'pre-boot injection must affect the actual Host plugin');
  assert.ok(executor, 'Host init installed the controlled executor before adapter gate release');
  await service.reconciled;
  const close = async () => {
    allowSuccessor = true;
    await writeFile(path.join(evidence, 'allow-receive'), 'cleanup');
    await runtime.stopAll();
    await host.dispose();
    await executor.dispose();
    Hima.prototype[Service.init] = originalInit;
    assert.equal(existsSync(path.join(h.home, 'hima/database/data/postmaster.pid')), false,
      'Host closer proved the owned private PostgreSQL ended');
  };
  try {
  if (mode === 'recover') return { host, service, store: service.durable.store, runtime, executor, evidence, close };
  const guide = String((await createRootAgent(host.ctx, home.h.workspace)).id);
  await service.teamOperation(guide, { action: 'configure-model', request: {
    modelRef: 'fixture-model', runtime: 'opencode', provider: 'openai-completions',
    model: 'controlled-node', baseUrl: 'https://fixture.invalid/v1', apiKey: 'private-fixture-only',
  } }, 'human');
  const definition: TeamDefinition = { ...teamFixture, members: [teamFixture.members[0]!, {
    ...teamFixture.members[0]!, id: 'worker', role: 'Worker', instructions: 'Deliver the custom delegated contract.',
  }] };
  const team = await service.teamOperation(guide, { action: 'save', definition, expectedVersion: null }) as { teamId: string };
  const deadlineAt = new Date(Date.now() + 180000).toISOString();
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
    evidence, events, readTask, delegate, waitInput, guide, close,
    successors: (value: boolean) => { allowSuccessor = value; } };
  } catch (error) { await close(); throw error; }
}


interface Boundary {
  guide: string; teamId: string; taskId: string; runId: string; applicationVersion: string;
  parent: Prepared; original: { pid: number; descendant: number };
  continuation: Continuation; childResult: Continuation['inputs'][number]['result'];
  publicChildResult: Continuation['inputs'][number]['result'];
  originalNative: unknown; runnerSha256: string;
}
const [homePath, workspace, profileDir, mode] = process.argv.slice(2);
assert.ok(homePath && workspace && profileDir && (mode === 'seed' || mode === 'recover'));
assert.ok(process.env.NODE_TEST_CONTEXT, 'silent Host notification helper must be explicitly test-gated');
const h: HimaHome = { home: homePath, workspace, profileDir,
  env: { ...process.env, DSH_HOME: homePath, DSH_AGENTS_HOME: path.join(homePath, 'agents'), DSH_TELEMETRY_DISABLED: '1' },
  dispose: async () => { throw Error('Only the parent owns Home deletion after authoritative closure'); } };
const f: any = await fixture(h, mode);
const events = async () => (await readFile(path.join(f.evidence, 'events.jsonl'), 'utf8')).trim().split('\n').map((line: string) => JSON.parse(line));
const send = (message: unknown) => process.send!(message as Parameters<NonNullable<typeof process.send>>[0]);
process.on('message', message => {
  if ((message as { action?: string }).action === 'close') void f.close().then(() => {
    send({ stage: 'closed', pid: process.pid, pgClosed: true }); process.disconnect();
  }).catch((error:unknown) => { console.error(error); process.exitCode = 1; process.disconnect(); });
});
try {
if (mode === 'seed') {
  assert.ok('parent' in f);
  const original = JSON.parse(await readFile(path.join(f.evidence, 'original.json'), 'utf8'));
  const delegated = await f.delegate();
  const wait = await f.store.acceptTeamWait(await f.waitInput(delegated.delegationId));
  let continuation!: Continuation;
  await waitUntil('child committed behind successor adapter gate', async () => {
    const head = await f.store.readTeamEffectHead(f.parent.identity);
    if (head.state !== 'active' || !head.continuation) return false;
    continuation = head.continuation;
    const input = continuation.inputs[0];
    return !!input && !!(await f.store.effectSnapshot(input.result.identity)).result;
  }, 45000, 25);
  assert.equal(continuation.waitId, wait.waitId);
  assert.equal(continuation.inputs.length, 1);
  const child = continuation.inputs[0]!;
  const childResult = (await f.store.effectSnapshot(child.result.identity)).result;
  assert.ok(childResult); assert.deepEqual(childResult, child.result);
  assert.equal(jsonDigest(childResult), child.resultSha256);
  assert.equal(childResult.outputSchemaVersion, childVersion);
  assert.deepEqual(childResult.value, { answer: 'child-measured' });
  assert.equal(alive(original.pid), false); assert.equal(alive(original.descendant), false);
  const closed = await f.store.externalEffectFact(f.parent.identity, 'oar:closed'); assert.ok(closed);
  const resources = await f.store.effectResources(f.parent.identity.effectId);
  assert.equal(resources.length, 1); assert.equal(resources[0]!.released, true);
  assert.deepEqual(resources[0]!.proof, closed);
  assert.equal((await f.store.effectSnapshot(childResult.identity)).resourcesReleased, true);
  assert.equal(await f.store.effectFact(continuation.invocation.identity.effectId, 'prepared'), undefined);
  assert.equal((await events()).filter((row: any) => row.kind === 'input').length, 2);
  const publicView = await f.readTask() as import('../../../packages/harness/lib/types/team-contract.js').TeamTaskView;
  const publicChildResult = publicView.execution?.tasks.find((row: any) => row.effectId === child.childEffectId)?.result;
  assert.deepEqual(publicChildResult, childResult, 'public Task view must expose the immutable delegated result');
  const originalNative = await f.store.externalEffectFact(f.parent.identity, 'oar:native-session');
  const boundary: Boundary = { guide: f.guide, teamId: f.team.teamId, taskId: f.task.taskId,
    runId: f.runId, applicationVersion: f.service.durable.applicationVersion,
    parent: f.parent, original, continuation, childResult, publicChildResult: publicChildResult!, originalNative, runnerSha256: sha(await readFile(path.join(f.evidence, 'controlled-runner.mjs'))) };
  // Evidence only: recovery never inserts these facts. It reads Store/DBOS and compares.
  await writeFile(path.join(f.evidence, 'boundary.json'), JSON.stringify(boundary));
  send({ stage: 'child-committed-before-successor', pid: process.pid, boundary });
  // Parent must SIGKILL this actual Host process; no graceful-close message here.
} else {
  const boundary: Boundary = JSON.parse(await readFile(path.join(f.evidence, 'boundary.json'), 'utf8'));
  await resumeTestAgent(f.host.ctx, boundary.guide); // native read-only restoration, no model turn
  assert.equal(sha(await readFile(path.join(f.evidence, 'controlled-runner.mjs'))), boundary.runnerSha256, 'same controlled IO bytes on cold recovery');
  assert.equal(f.service.durable.applicationVersion, boundary.applicationVersion);
  assert.equal(alive(boundary.original.pid), false); assert.equal(alive(boundary.original.descendant), false);
  assert.deepEqual((await f.store.effectSnapshot(boundary.childResult.identity)).result, boundary.childResult);
  const continuation = (await f.store.readTeamExecutionBinding(boundary.continuation.invocation.identity)).continuation;
  assert.deepEqual(continuation, boundary.continuation, 'same retained head, result/hash/IDs/provenance');
  let successor!: Prepared, lease!: Lease;
  await waitUntil('cold Host submits only one result-consuming successor', async () => {
    successor = await f.store.effectFact(boundary.continuation.invocation.identity.effectId, 'prepared') as unknown as Prepared;
    if (!successor) return false;
    lease = await f.runtime.recover(successor.sessionKey) as Lease;
    return !!lease?.pid && (await events()).some((row: any) => row.kind === 'input' && row.effectId === successor.identity.effectId);
  }, 45000, 25);
  assert.notEqual(lease.pid, boundary.original.pid); assert.ok(lease.startIdentity);
  assert.equal(successor.prompt, boundary.continuation.hostPrompt);
  assert.equal(successor.inputId, boundary.continuation.hostInputId);
  assert.equal(sha(successor.prompt), boundary.continuation.hostInputSha256);
  await writeFile(path.join(f.evidence, 'allow-receive'), 'actual correlated native receive');
  await waitUntil('cold successor result committed and native closure proved', async () => {
    const snapshot = await f.store.effectSnapshot(successor.identity);
    return !!snapshot.result && snapshot.resourcesReleased;
  }, 45000, 25);
  assert.equal(alive(lease.pid!), false);
  assert.deepEqual((await f.store.effectSnapshot(boundary.childResult.identity)).result, boundary.childResult);
  const receipt = await f.store.effectFact(successor.identity.effectId, 'team-result-input-receipt:' + boundary.continuation.continuationId);
  assert.ok(receipt, 'actual receive, not queued input or fabricated proof');
  const newNative = await f.store.externalEffectFact(successor.identity, 'oar:native-session') as { streamGeneration: string };
  assert.notEqual(newNative.streamGeneration, (boundary.originalNative as { streamGeneration: string }).streamGeneration);
  const publicView = await f.service.teamOperation(boundary.guide, { action: 'readTask', teamId: boundary.teamId, taskId: boundary.taskId }) as import('../../../packages/harness/lib/types/team-contract.js').TeamTaskView;
  assert.equal(publicView.currentRunId, boundary.runId);
  assert.deepEqual(publicView.execution?.tasks.find((row: any) => row.effectId === boundary.childResult.identity.effectId)?.result, boundary.publicChildResult);
  assert.deepEqual(publicView.execution?.tasks.find((row: any) => row.effectId === successor.identity.effectId)?.result?.value, { answer: 'successor-measured' });
  const inputEvents = (await events()).filter((row: any) => row.kind === 'input');
  assert.equal(inputEvents.length, 3, 'original engineering + child engineering + one correlated result input');
  for (const effectId of [boundary.parent.identity.effectId, boundary.childResult.identity.effectId, successor.identity.effectId])
    assert.equal(inputEvents.filter((row: any) => row.effectId === effectId).length, 1, 'no duplicate external submission');
  assert.equal(inputEvents.filter((row: any) => !row.successor).length, 2, 'cold recovery resubmits no engineering input');
  send({ stage: 'recovered', pid: process.pid, boundary, successor: successor.identity,
    inputEvents, publicView, nativeSdkCalls: 0, productModelCalls: 0 });
}

} catch (error) { await f.close(); throw error; }
