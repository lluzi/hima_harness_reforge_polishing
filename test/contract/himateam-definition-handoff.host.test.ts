// #105 L2: real Host/private PG/production DBOS/Store/native port, ordinary Node IO.
// PID/birth and detached-descendant closure are actual Local observations; zero product model.
// This does not qualify Pi/OpenCode SDK reconstruction or model engineering effectiveness.
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { bootInProcess, createRootAgent } from './support/boot-inprocess.ts';
import { localHome, waitUntil } from './support/fabric.ts';
import { teamFixture } from './support/himateam.ts';

process.env.HIMA_TEST_SILENT_AGENT = '1';
process.env.HIMA_TEST_LEGACY_AUTO_DRIVE = '0';
const lib = process.env.HIMA_DBOS_TEST_LIB ?? path.resolve('packages/harness/lib');
const localModule = await import(pathToFileURL(path.join(lib, 'oar-local-member.js')).href) as typeof import('../../packages/harness/lib/types/oar-local-member.js');
const portModule = await import(pathToFileURL(path.join(lib, 'oar-member-process.js')).href) as typeof import('../../packages/harness/lib/types/oar-member-process.js');
const { jsonDigest } = await import(pathToFileURL(path.join(lib, 'run-store.js')).href) as typeof import('../../packages/harness/lib/types/run-store.js');
type Prepared = import('../../packages/harness/lib/types/oar-task-adapter.js').OarPrepared;
type Lease = import('../../packages/harness/lib/types/oar-local-member.js').LocalMemberLease;
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false; throw error; } };

async function fixture(t: TestContext, deadlineMs = 65000) {
  const home = await localHome(t, { sleepSeconds: 0 }); assert.ok(home);
  const host = await bootInProcess(home.h), service = host.ctx.hima as any;
  await service.reconciled;
  const evidence = path.join(home.h.home, 'definition-handoff-node'); await mkdir(evidence, { recursive: true });
  const runner = path.join(evidence, 'runner.mjs');
  await writeFile(runner, `
import fs from 'node:fs'; import path from 'node:path';
import { createRequire } from 'node:module'; import {spawn} from 'node:child_process';
const evidence=${JSON.stringify(evidence)};let c,first,input,finished=false;
const alive=pid=>{try{process.kill(pid,0);return true;}catch(e){if(e.code==='ESRCH')return false;throw e;}};
const log=v=>fs.appendFileSync(path.join(evidence,'events.jsonl'),JSON.stringify({...v,pid:process.pid,at:new Date().toISOString()})+'\\n');
process.send({type:'ready'});
process.on('message',m=>{
 if(m.type==='config'){
  c=m.config;const p=c.prepared;const original=path.join(evidence,p.identity.source.taskId+'.json');first=!fs.existsSync(original);
  if(!first){const old=JSON.parse(fs.readFileSync(original,'utf8'));if(alive(old.pid)||alive(old.descendant))throw Error('new native born before entire old physical tree absent');log({kind:'old-absent-before-new',runId:p.identity.runId,old});}
  const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',detached:true});
  if(first)fs.writeFileSync(original,JSON.stringify({pid:process.pid,descendant:child.pid,runId:p.identity.runId}));
  log({kind:'created',taskId:p.identity.source.taskId,runId:p.identity.runId,effectId:p.identity.effectId,descendant:child.pid});
  process.send({type:'created',payload:{runtime:p.runtime,nativeSession:'definition-node-'+p.identity.effectId}});
 }
 if(m.type==='input'){input=m;log({kind:'receive',runId:c.prepared.identity.runId,effectId:c.prepared.identity.effectId,text:m.input,inputId:m.id});process.send({type:'received',payload:{inputId:m.id,evidence:'actual-node-ipc'}});}
 // Ignore stop: production Local must escalate and close observed detached family.
});
setInterval(()=>{if(c&&input&&!finished&&fs.existsSync(path.join(evidence,'finish-'+c.prepared.identity.runId))){finished=true;process.send({type:'terminal',payload:{inputId:input.id,outcome:{kind:'completed'}}});process.send({type:'finished',inputId:input.id,text:JSON.stringify({schemaVersion:c.outputSchemaVersion,value:{answer:'actual-node-terminal-answer'},artifacts:[],diagnostics:[]})});}},20);
`);
  const assets = { oarModule: 'controlled-node-no-sdk', nodeExecutable: process.execPath, opencodeCommand: 'controlled-node-no-cli', opencodeVersion: 'fixture' };
  const runtime = new localModule.OarLocalMemberRuntime({ home: home.h.home, nodeExecutable: process.execPath, runnerModule: runner, assets });
  let unknownClose = false, refused = 0;
  const local: NonNullable<import('../../packages/harness/lib/types/oar-member-process.js').OarMemberProcessOptions['localRuntime']> = {
    stage: (...args) => runtime.stage(...args), start: (...args) => runtime.start(...args), read: (...args) => runtime.read(...args),
    authorize: (...args) => runtime.authorize(...args), reply: (...args) => runtime.reply(...args), sendInput: (...args) => runtime.sendInput(...args),
    readArtifact: (...args) => runtime.readArtifact(...args), recover: (...args) => runtime.recover(...args),
    captureClosedContext: (...args) => runtime.captureClosedContext(...args), stopAll: () => runtime.stopAll(),
    close: async (lease, options) => {
      if (!unknownClose) return runtime.close(lease, options);
      const file = path.join(home.h.home, 'hima/oar-members', lease.sessionKey, 'lease.json'), bytes = await readFile(file, 'utf8');
      try {
        await writeFile(file, JSON.stringify({ ...JSON.parse(bytes), startIdentity: 'intentional-definition-test-birth-mismatch' }));
        const verifier = new localModule.OarLocalMemberRuntime({ home: home.h.home, nodeExecutable: process.execPath, runnerModule: runner, assets });
        const invalid = await verifier.recover(lease.sessionKey); assert.ok(invalid);
        const refusal = await verifier.close(invalid); assert.equal(refusal.closed, false); assert.match(refusal.reason ?? '', /identity mismatch/i);
        refused++; return refusal;
      } finally { await writeFile(file, bytes); }
    },
  };
  const executor = portModule.createOarMemberExecutor({ home: home.h.home, retainedMaterialsDir: path.join(home.h.home, 'definition-materials'),
    store: service.durable.store, services: {} as import('../../packages/harness/lib/types/team-service-runtime.js').TeamServiceRuntime,
    localRuntime: local, runtimeAssets: async () => assets,
    sharedDeepSeekModel: async () => { throw Error('No model fallback'); }, memberContext: async () => { throw Error('No native MCP tool in this fixture'); } });
  t.after(async () => {
    unknownClose = false;
    const failures: unknown[] = [];
    try {
      await runtime.stopAll();
      // A physically stopped fixture process is not yet a durable Team release.
      // The original Host exit fence must prove that boundary before teardown.
      const exit = await service.prepareExit({ requestId: 'definition-fixture-close', mode: 'keep-jobs' });
      if (!exit.ready) await waitUntil('definition fixture Team resources reach Host exit boundary',
        async () => (await service.exitStatus()).ready, 30000, 25);
    } catch (error) { failures.push(error); }
    try { await host.dispose(); } catch (error) { failures.push(error); }
    const lifecycle = service as { resourcesClosing?: Promise<void>; closeHostResources(): Promise<void> };
    let confirmed = false;
    try {
      assert.ok(lifecycle.resourcesClosing, 'Host disposal must invoke its ordered resource closer');
      await lifecycle.resourcesClosing;
      confirmed = true;
    } catch (error) { failures.push(error); }
    if (!confirmed) {
      // Retry only this Host's original closer. Keep the initial failure even
      // when the retry safely releases resources for the next in-process test.
      try { await lifecycle.closeHostResources(); confirmed = true; }
      catch (error) {
        failures.push(error);
        try { await service.durable.stop(); } catch (stopError) { failures.push(stopError); }
      }
    }
    try { await executor.dispose(); } catch (error) { failures.push(error); }
    if (failures.length) {
      await writeFile(path.join(evidence, 'host-close-unconfirmed.json'), JSON.stringify({
        reasons: failures.map(error => error instanceof Error ? error.message : String(error)), confirmedOnRetry: confirmed,
      }, null, 2));
      t.diagnostic('Retained failed definition Host Home: ' + home.h.home);
      throw new AggregateError(failures, 'Definition fixture Host cleanup failed');
    }
    await home.h.dispose();
  });
  const guide = String((await createRootAgent(host.ctx, home.h.workspace)).id);
  await service.teamOperation(guide, { action: 'configure-model', request: { modelRef: 'fixture-model', runtime: 'opencode',
    provider: 'openai-completions', model: 'controlled-node', baseUrl: 'https://fixture.invalid/v1', apiKey: 'private-fixture-only' } }, 'human');
  service.teamExecutor = { readiness: async () => ({ ready: true, missing: [] }), resolve: executor.resolve.bind(executor) };
  const team = await service.teamOperation(guide, { action: 'save', definition: teamFixture, expectedVersion: null }, 'human');
  const deadlineAt = new Date(Date.now() + deadlineMs).toISOString();
  const start = (requestId: string) => service.teamOperation(guide, { action: 'startTask', teamId: team.teamId, request: {
    requestId, teamId: team.teamId, expectedVersion: 1, goal: 'Retain this original task goal', input: { sentinel: 'original-input' }, deadlineAt, closure: 'Deliver answer/1 and close owned tree.' } }, 'human');
  const startUnrelated = async () => {
    const independent = await service.teamOperation(guide, { action: 'save', definition: { ...teamFixture, title: 'Unrelated independent resource', collaboration: 'Keep this unrelated task running.' }, expectedVersion: null }, 'human');
    return service.teamOperation(guide, { action: 'startTask', teamId: independent.teamId, request: { requestId: 'unrelated-native', teamId: independent.teamId, expectedVersion: 1, goal: 'Continue unrelated work', input: {}, deadlineAt, closure: 'Close own resources.' } }, 'human');
  };
  const task = await start('definition-original'), store = service.durable.store;
  const events = async (): Promise<any[]> => { try { return (await readFile(path.join(evidence, 'events.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; } };
  const receives = async (runId: string) => (await events()).filter(row => row.kind === 'receive' && row.runId === runId);
  await waitUntil('actual original native correlated receive', async () => (await receives(task.currentRunId)).length === 1, 25000, 25);
  const invocation = (await store.flowInvocations(task.currentRunId))[0]; assert.ok(invocation);
  const prepared = await store.effectFact(invocation.identity.effectId, 'prepared') as Prepared;
  const lease = await runtime.recover(prepared.sessionKey) as Lease; assert.ok(lease.pid && lease.startIdentity && lease.processGroup);
  await waitUntil('production OS birth persisted in PG', async () => !!await store.externalEffectFact(invocation.identity, `oar:local-birth:${lease.pid}:${lease.startIdentity}`), 10000, 25);
  const birth = await store.externalEffectFact(invocation.identity, `oar:local-birth:${lease.pid}:${lease.startIdentity}`);
  assert.ok(birth, 'real production OS birth retained in PG');
  const original = (await events()).find(row => row.kind === 'created' && row.runId === task.currentRunId); assert.ok(original);
  assert.ok(alive(original.pid) && alive(original.descendant));
  const save = (version: number) => service.teamOperation(guide, { action: 'save', teamId: team.teamId,
    definition: { ...teamFixture, title: `Saved version ${version}`, collaboration: `Selected version ${version}: preserve original authority.` }, expectedVersion: version - 1 }, 'human');
  await save(2);
  const request = async (requestId = 'apply-two') => { const run = await store.run(task.currentRunId); return { action: 'applyDefinition', origin: 'human',
    actor: { kind: 'human', actorId: await store.operatorIdentity(), projectId: task.projectId }, taskId: task.taskId, runId: run.runId, requestId,
    expectedEpoch: run.epoch, expectedRevision: run.revision, definitionVersion: 2 }; };
  const apply = (input: any, origin = 'human') => service.teamOperation(guide, { action: 'control', teamId: team.teamId, taskId: task.taskId,
    request: { action: input.action, requestId: input.requestId, expectedRunId: input.runId, expectedEpoch: input.expectedEpoch,
      expectedRevision: input.expectedRevision, definitionVersion: input.definitionVersion } }, origin);
  const read = () => service.teamOperation(guide, { action: 'readTask', teamId: team.teamId, taskId: task.taskId }, 'human');
  return { home, service, store, task, team, runtime, evidence, original, invocation, prepared, lease, birth, events, receives, save, startUnrelated, request, apply, read,
    unknown: (value: boolean) => { unknownClose = value; }, refusals: () => refused };
}

test('active saved-definition adoption closes original whole physical tree before new native, pins chosen v2, and replays one successor', { timeout: 90000 }, async t => {
  const f = await fixture(t), old = await f.store.run(f.task.currentRunId), input = await f.request();
  const unrelated = await f.startUnrelated();
  await waitUntil('unrelated native actually receives', async () => (await f.receives(unrelated.currentRunId)).length === 1, 25000, 25);
  const unrelatedBirth = (await f.events()).find(row => row.kind === 'created' && row.runId === unrelated.currentRunId);
  // Durable admission followed by lost ACK before composition dispatch. The exact
  // human route replay must dispatch the retained chosen gate, never choose latest.
  assert.equal(typeof f.store.beginTeamDefinitionHandoff, 'function', 'initial RED: active task handoff admission API must exist');
  const admitted = await f.store.beginTeamDefinitionHandoff(input); assert.equal(admitted.replayed, false);
  const fenced = await f.store.run(old.runId); assert.equal(fenced.epoch, old.epoch + 1); assert.equal(fenced.revision, old.revision); assert.equal(fenced.cancelled, false);
  await f.save(3); const beforeDispatch = await f.read(); assert.equal(beforeDispatch.currentRunId, old.runId); assert.equal(beforeDispatch.definitionHandoff.selected.version, 2);
  await f.apply(input);
  await waitUntil('retained chosen successor actually receives one native input', async () => { const current = await f.read(); return current.currentRunId !== old.runId && (await f.receives(current.currentRunId)).length === 1; }, 30000, 25);
  const current = await f.read(), next = await f.store.run(current.currentRunId);
  assert.deepEqual(current.runIds, [old.runId, next.runId]); assert.equal(current.taskId, f.task.taskId); assert.equal(current.team.version, 2);
  assert.equal(current.definitionHandoff.state, 'adopted'); assert.equal(next.deadlineAt, old.deadlineAt);
  assert.deepEqual(next.opening.data.start.runInput, old.opening.data.start.runInput); assert.equal(next.opening.data.requestDigest, old.opening.data.requestDigest);
  assert.equal(current.goal, f.task.goal); assert.deepEqual(current.input, f.task.input); assert.equal(current.closure, f.task.closure);
  assert.equal(alive(f.original.pid), false); assert.equal(alive(f.original.descendant), false);
  const closed = await f.store.externalEffectFact(f.invocation.identity, 'oar:closed'); assert.ok(closed);
  assert.ok((await f.store.effectResources(f.invocation.identity.effectId)).every((row: any) => row.released));
  assert.deepEqual(await f.store.externalEffectFact(f.invocation.identity, `oar:local-birth:${f.lease.pid}:${f.lease.startIdentity}`), f.birth);
  assert.ok((await f.events()).some(row => row.kind === 'old-absent-before-new' && row.runId === next.runId), 'actual new process checked old supervisor and detached descendant absence before created');
  assert.ok(alive(unrelatedBirth.pid) && alive(unrelatedBirth.descendant), 'task-local handoff does not stop unrelated task');
  await f.apply(input); await f.apply(input);
  assert.deepEqual((await f.read()).runIds, [old.runId, next.runId]); assert.equal((await f.receives(next.runId)).length, 1);
  assert.equal((await f.events()).filter(row => row.kind === 'created' && row.runId === next.runId).length, 1);
  await assert.rejects(f.store.beginTeamDefinitionHandoff({ ...input, definitionVersion: 3 }), /different content/i);
});

test('Guide, fake origin/operator, stale Run/stamps and conflicting replay cannot authorize selected definition', { timeout: 90000 }, async t => {
  const f = await fixture(t), input = await f.request(), before = await f.store.run(f.task.currentRunId);
  await assert.rejects(f.apply(input, 'guide'), /human|authoriz/i);
  for (const change of [{ origin: 'guide' }, { actor: { ...input.actor, kind: 'guide' } }, { actor: { ...input.actor, actorId: 'forged' } },
    { runId: 'run-unavailable' }, { expectedEpoch: input.expectedEpoch + 1 }, { expectedRevision: input.expectedRevision + 1 }])
    await assert.rejects(f.store.beginTeamDefinitionHandoff({ ...input, ...change }), /human|operator|stamps|unavailable|not found|missing|Run/i);
  assert.deepEqual(await f.store.run(before.runId), before); assert.deepEqual((await f.read()).runIds, [before.runId]);
  assert.equal((await f.receives(before.runId)).length, 1); assert.ok(alive(f.original.pid) && alive(f.original.descendant));
  await f.store.beginTeamDefinitionHandoff(input);
  await assert.rejects(f.store.beginTeamDefinitionHandoff({ ...input, definitionVersion: 3 }), /different content/i);
  await assert.rejects(f.store.beginTeamDefinitionHandoff({ ...input, requestId: 'competing' }), /stamps|already|conflict/i);
});

test('actual Local PID/birth refusal preserves unknown original physical closure and admits no successor', { timeout: 90000 }, async t => {
  const f = await fixture(t), input = await f.request(); f.unknown(true); await f.apply(input);
  await waitUntil('production Local actually refuses mismatched birth closure', async () => f.refusals() > 0, 20000, 25);
  await assert.rejects(f.store.acceptTeamDefinitionHandoff(f.task.taskId, input.requestId), /physical.*closure|closure.*unproved/i);
  assert.equal((await f.read()).currentRunId, input.runId); assert.deepEqual((await f.read()).runIds, [input.runId]);
  assert.ok(alive(f.original.pid) && alive(f.original.descendant)); assert.equal((await f.receives(input.runId)).length, 1);
  assert.equal(await f.store.externalEffectFact(f.invocation.identity, 'oar:closed'), undefined);
  assert.ok((await f.store.effectResources(f.invocation.identity.effectId)).some((row: any) => !row.released));
  const gate = await f.store.readTeamDefinitionHandoff(f.task.taskId, input.requestId); assert.notEqual(gate.projection.state, 'adopted');
  const held = await f.store.run(input.runId);
  await assert.rejects(f.store.command({ runId: held.runId, commandId: 'bypass-handoff', owner: held.owner, epoch: held.epoch,
    revision: held.revision, action: 'continue', origin: 'human', actor: input.actor.actorId }), /handoff|saved.definition|explicit/i);
});

test('cancel and explicit operator revoke under ordinary pause beat a pending saved-definition adoption', { timeout: 180000 }, async t => {
  for (const control of ['cancel', 'revoke'] as const) await t.test(control, async child => {
    const f = await fixture(child), run = await f.store.run(f.task.currentRunId);
    await f.store.command({ runId: run.runId, commandId: 'ordinary-pause', owner: run.owner, epoch: run.epoch, revision: run.revision, action: 'pause', origin: 'human', actor: await f.store.operatorIdentity() });
    const input = await f.request(); f.unknown(true); await f.apply(input);
    await waitUntil('retained gate cleanup reaches actual physical refusal', async () => f.refusals() > 0, 20000, 25);
    if (control === 'revoke') await f.store.revokeTeamGrant('grant-' + jsonDigest([f.prepared.sessionKey, f.prepared.generation]), 'operator');
    else { const held = await f.store.run(run.runId); await f.store.command({ runId: held.runId, commandId: 'cancel-gated-task', action: 'cancel', owner: held.owner, epoch: held.epoch, revision: held.revision, origin: 'human', actor: input.actor.actorId }); }
    await assert.rejects(f.store.acceptTeamDefinitionHandoff(f.task.taskId, input.requestId), /cancel|operator.revoked/i);
    const retained = await f.store.readTeamDefinitionHandoff(f.task.taskId, input.requestId); assert.equal(retained.projection.state, 'blocked');
    assert.deepEqual((await f.read()).runIds, [run.runId]); assert.equal((await f.events()).filter(row => row.kind === 'created').length, 1);
  });
});

test('real committed terminal leader delivery before handoff blocks adoption and keeps its original result identity', { timeout: 90000 }, async t => {
  const f = await fixture(t); await writeFile(path.join(f.evidence, 'finish-' + f.task.currentRunId), 'finish');
  await waitUntil('actual native terminal result is committed by production TaskEffects', async () => !!(await f.store.effectSnapshot(f.invocation.identity)).result, 20000, 25);
  const result = (await f.store.effectSnapshot(f.invocation.identity)).result; assert.deepEqual(result.value, { answer: 'actual-node-terminal-answer' });
  await assert.rejects(f.apply(await f.request()), /terminal|committed.*delivery/i);
  assert.deepEqual((await f.read()).runIds, [f.task.currentRunId]); assert.deepEqual((await f.store.effectSnapshot(f.invocation.identity)).result, result);
});

test('original absolute deadline expires before human application and no saved version extends it', { timeout: 90000 }, async t => {
  const f = await fixture(t, 12000), input = await f.request(), deadline = (await f.store.run(input.runId)).deadlineAt;
  await waitUntil('actual original wall clock expires', async () => Date.now() >= Date.parse(deadline), 16000, 25);
  await assert.rejects(f.apply(await f.request()), /deadline|expired/i);
  assert.equal((await f.store.run(input.runId)).deadlineAt, deadline); assert.deepEqual((await f.read()).runIds, [input.runId]);
  assert.equal((await f.events()).filter(row => row.kind === 'created').length, 1);
});


// Regression P1: accepted successor must carry original operator revocation to
// the actual native submit seam, even when the pre-start read already allowed it.
test('operator revoke after successor CAS and successful start check prevents actual successor native birth and receive', { timeout: 90000 }, async t => {
  const f = await fixture(t), input = await f.request('revoke-at-start-gap'), runtime = f.service.durable;
  const originalStart = runtime.startWorkflow;
  let release!: () => void, reached!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const atRootStart = new Promise<void>(resolve => { reached = resolve; });
  let successorRunId: string | undefined, successorHandle: any, intercepted = 0;
  runtime.startWorkflow = async function(name: string, workflowId: string, value: any) {
    // This public dispatch call occurs AFTER startAcceptedTeamSuccessor's actual
    // acceptedTeamSuccessorStartAllowed read. All other production workflows run.
    if (name === 'hima.flow' && value?.runId !== input.runId && value?.flow?.taskSource?.taskId === f.task.taskId) {
      successorRunId = value.runId; intercepted++; reached(); await barrier;
      successorHandle = await originalStart.call(this, name, workflowId, value);
      return successorHandle;
    }
    return originalStart.call(this, name, workflowId, value);
  };
  t.after(() => { release(); runtime.startWorkflow = originalStart; });
  try {
    const workflow = await import(pathToFileURL(path.join(lib, 'flow-workflow.js')).href);
    await workflow.applyTeamDefinition(runtime, input);
    await Promise.race([atRootStart, waitUntil('successor root dispatch reaches public runtime barrier', async () => intercepted === 1, 25000, 25)]);
    assert.equal(intercepted, 1); assert.ok(successorRunId);
    const accepted = await f.store.readTeamTask(f.task.projectId, f.team.teamId, f.task.taskId);
    assert.equal(accepted.currentRunId, successorRunId, 'successor CAS has actually committed before operator revoke');
    assert.deepEqual(accepted.runIds, [input.runId, successorRunId]);
    assert.equal(alive(f.original.pid), false); assert.equal(alive(f.original.descendant), false);
    const originalGrantId = 'grant-' + jsonDigest([f.prepared.sessionKey, f.prepared.generation]);
    const grantBefore = await f.store.readTeamGrant(originalGrantId); assert.ok(grantBefore);
    await f.store.revokeTeamGrant(originalGrantId, 'operator');
    assert.equal((await f.store.readTeamGrant(originalGrantId)).revocationCause, 'operator');
    release();
    await waitUntil('barrier releases into actual production successor root dispatch', async () => !!successorHandle, 10000, 25);
    let settled = false, rootOutcome: unknown, rootError: unknown;
    const completion = successorHandle.getResult().then((value: unknown) => { rootOutcome = value; settled = true; }, (error: unknown) => { rootError = error; settled = true; });
    await waitUntil('root finishes denial or exposes actual forbidden native birth', async () => settled || (await f.events()).some(row => row.kind === 'created' && row.runId === successorRunId), 25000, 25);
    const nativeBirths = (await f.events()).filter(row => row.kind === 'created' && row.runId === successorRunId);
    assert.equal(nativeBirths.length, 0, 'operator revocation of original genuine grant must fence actual successor native birth after CAS/start check');
    assert.equal((await f.receives(successorRunId)).length, 0, 'revoked accepted successor receives no engineering input');
    assert.equal(settled, true, 'absence is observed after production root completion, not an arbitrary sleep');
    await completion;
    assert.match(rootError ? String(rootError) : JSON.stringify(rootOutcome), /operator|revok|authority|lineage|fenc|not.current/i, 'completed production denial must identify the authority fence, not an unrelated adapter failure');
    for (const invocation of await f.store.flowInvocations(successorRunId))
      assert.equal(await f.store.effectFact(invocation.identity.effectId, 'submitted'), undefined, 'no actual successor native submit receipt');
    assert.equal((await f.store.run(successorRunId)).deadlineAt, (await f.store.run(input.runId)).deadlineAt);
  } finally { release(); runtime.startWorkflow = originalStart; }
});


// The allowed path must lock actual unrevoked predecessor grant rows through the
// final permit and dispatch commit; locking only already-revoked rows locks none.
test('final permit holds genuine predecessor grant row until dispatch commit and serializes operator revoke', { timeout: 90000 }, async t => {
  const f = await fixture(t), input = await f.request('permit-lock-adoption');
  await f.apply(input);
  await waitUntil('actual accepted v2 native receives original scope', async () => { const task = await f.read(); return task.currentRunId !== input.runId && (await f.receives(task.currentRunId)).length === 1; }, 30000, 25);
  const current = await f.read(), run = await f.store.run(current.currentRunId);
  const invocation = (await f.store.flowInvocations(run.runId))[0]; assert.ok(invocation);
  const admission = { runId: run.runId, effectId: invocation.identity.effectId, owner: run.owner, epoch: run.epoch, revision: run.revision };
  const grantId = 'grant-' + jsonDigest([f.prepared.sessionKey, f.prepared.generation]);
  const originalGrant = await f.store.readTeamGrant(grantId); assert.ok(originalGrant);
  assert.equal(originalGrant.revocationCause, 'closed', 'ordinary predecessor physical closure alone permits accepted successor business');
  assert.equal(alive(f.original.pid), false); assert.equal(alive(f.original.descendant), false);
  // Only this fixture's own private PG credentials are read; neither connection
  // values nor backend queries/bindings are printed or retained in evidence.
  const credential = JSON.parse(await readFile(path.join(f.home.h.home, 'hima/database/credentials.json'), 'utf8'));
  const { Client } = createRequire(new URL('../../packages/harness/package.json', import.meta.url))('pg');
  const observer = new Client({ host: '127.0.0.1', port: credential.port, user: credential.user, password: credential.password, database: 'hima_application',
    options: '-c default_transaction_read_only=on -c statement_timeout=5000', application_name: 'issue105-final-permit-lock-readonly' });
  let release!: () => void, atPermit!: () => void;
  const heldPermit = new Promise<boolean>(resolve => { release = () => resolve(true); });
  const reachedPermit = new Promise<void>(resolve => { atPermit = resolve; });
  let claim: Promise<boolean> | undefined, revoke: Promise<void> | undefined, permitReached = false, revokeDone = false, revokeError: unknown;
  try {
    await observer.connect();
    assert.equal((await observer.query('SHOW default_transaction_read_only')).rows[0].default_transaction_read_only, 'on');
    claim = f.store.claimEffectDispatch(admission, async () => { permitReached = true; atPermit(); return heldPermit; }, 'issue105-held-final-permit', jsonDigest({ taskId: f.task.taskId, probe: 'final-permit-lock' }));
    void claim!.catch(() => undefined);
    await Promise.race([reachedPermit, waitUntil('actual claim reaches final permit after business admission', async () => permitReached, 10000, 25)]);
    const revocation:Promise<void> = f.store.revokeTeamGrant(grantId, 'operator');
    revoke=revocation;
    void revocation.then(() => { revokeDone = true; }, (error: unknown) => { revokeError = error; revokeDone = true; });
    let lockObserved = false;
    await waitUntil('PostgreSQL observes actual grant UPDATE waiting on held claim or exposes early revoke commit', async () => {
      const locked = await observer.query(`SELECT a.pid, pg_blocking_pids(a.pid) AS blockers FROM pg_stat_activity a
        WHERE a.datname=current_database() AND a.pid<>pg_backend_pid() AND a.wait_event_type='Lock'
          AND a.query LIKE 'UPDATE hima.task_actor_grants %'
          AND EXISTS (SELECT 1 FROM pg_stat_activity holder WHERE holder.pid=ANY(pg_blocking_pids(a.pid))
            AND holder.datname=current_database() AND holder.state='idle in transaction' AND holder.query LIKE '%hima.effect_dispatches%')`);
      lockObserved = locked.rows.some((row: { blockers: number[] }) => row.blockers.length > 0);
      return lockObserved || revokeDone;
    }, 10000, 25);
    assert.equal(revokeError, undefined, 'operator revoke did not fail for an unrelated reason');
    assert.equal(lockObserved, true, 'actual PostgreSQL UPDATE must wait on the grant row held by final-permit dispatch transaction');
    assert.equal(revokeDone, false, 'revoke cannot commit during an admitted held final permit');
    assert.equal((await f.store.readTeamGrant(grantId)).revocationCause, 'closed', 'concurrent read observes original committed authority while UPDATE waits');
    release(); assert.equal(await claim, true, 'first dispatch commit serializes before later revoke'); await revoke;
    assert.equal((await f.store.readTeamGrant(grantId)).revocationCause, 'operator');
    let latePermitCalled = false;
    await assert.rejects(f.store.claimEffectDispatch(admission, async () => { latePermitCalled = true; return true; }, 'issue105-after-operator-revoke',
      jsonDigest({ taskId: f.task.taskId, probe: 'after-operator-revoke' })), /operator|revok|lineage|fenc/i);
    assert.equal(latePermitCalled, false, 'same genuine successor authority is denied before another final permit');
    assert.equal((await f.receives(run.runId)).length, 1, 'sideband dispatch claim sends no additional native input');
  } finally {
    release();
    await Promise.allSettled([...(claim ? [claim] : []), ...(revoke ? [revoke] : [])]);
    await observer.end();
  }
});
