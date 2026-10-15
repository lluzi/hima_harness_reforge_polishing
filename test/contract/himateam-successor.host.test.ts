// Real Host/PG/DBOS and owned sleeping command resources, zero product model calls.
// This proves successor admission/recovery mechanics, not real OAR reconstruction effectiveness.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { commandTaskAdapter, compileTeamFlow, loadSite, resumeTeamFlow } from '@hima/harness';
import { bootInProcess, createRootAgent, type InProcessHost } from './support/boot-inprocess.ts';
import { localHome, waitUntil } from './support/fabric.ts';
import { teamFixture } from './support/himateam.ts';
process.env.HIMA_TEST_SILENT_AGENT='1';
process.env.HIMA_TEST_LEGACY_AUTO_DRIVE='0';
for(const adopt of [false,true])test(`explicit post-exit successor retains original scope and ${adopt?'adopts selected':'retains exact'} version`,{timeout:90000},async t=>{
  const home=await localHome(t,{sleepSeconds:0});assert.ok(home);
  let host:InProcessHost|undefined;
  const closeHost=async()=>{if(!host)return;const retiring=host.ctx.hima as unknown as {resourcesClosing?:Promise<void>};
    await host.dispose();if(!retiring.resourcesClosing)throw Error('Original Host resource closer was not published');
    await retiring.resourcesClosing;host=undefined;};
  try {
    host=await bootInProcess(home.h);let service=host.ctx.hima as any;
    let guide=String((await createRootAgent(host.ctx,home.h.workspace)).id);
    const saved=await service.teamOperation(guide,{action:'save',definition:teamFixture,expectedVersion:null});
    const sitesDir=path.join(home.h.home,'hima/sites'),workspace=path.join(loadSite(sitesDir,'local').workspaceRoot,'successor-owned');
    await mkdir(workspace,{recursive:true});const script=path.join(workspace,'member.sh');
    await writeFile(script,'printf "submitted\\n" >> submissions.txt\nexec sleep 120\n');
    const command=commandTaskAdapter({sitesDir,siteId:'local',workspace,name:'Owned successor resource',argv:['/bin/sh',script],collect:async (_site,_job,request)=>({schemaVersion:request.contract.output.version,value:{answer:'never collected before stop'},artifacts:[],diagnostics:[]})});
    const inputs:any[]=[];const prompts:string[]=[];
    const bind=()=>{service.teamExecutor={readiness:async()=>({ready:true,missing:[]}),resolve:async(context:any)=>{
      inputs.push(structuredClone(context.request.input));
      const binding=await service.durable.store.readTeamExecutionBinding(context.request.identity);
      if(binding.initialHostPrompt){prompts.push(binding.initialHostPrompt);assert.match(binding.initialHostPrompt,/new native session and new Run/);assert.equal(binding.continuation,undefined);}
      return command;
    }};};bind();
    const request={requestId:'original',teamId:saved.teamId,expectedVersion:1,goal:'Keep original goal',input:{unchanged:'original'},deadlineAt:new Date(Date.now()+110000).toISOString(),closure:'Close owned resources.'};
    const task=await service.teamOperation(guide,{action:'startTask',teamId:saved.teamId,request});
    const count=async()=>{try{return (await readFile(path.join(workspace,'submissions.txt'),'utf8')).split('\n').filter(Boolean).length;}catch{return 0;}};
    await waitUntil('original owned member submits once',async()=>await count()===1,25000,25);
    // Keep a newer save ready before exit; omitted-version resume must ignore it.
    await service.teamOperation(guide,{action:'save',teamId:saved.teamId,definition:{...teamFixture,title:'Explicit saved version two'},expectedVersion:1});
    await service.prepareExit({requestId:'exit-one',mode:'keep-jobs'});
    await waitUntil('original resource closure',async()=>(await service.exitStatus()).ready,25000,25);
    await closeHost();
    host=await bootInProcess(home.h);service=host.ctx.hima as any;bind();
    await service.reconciled;
    guide=String((await createRootAgent(host.ctx,home.h.workspace)).id);
    const store=service.durable.store,old=await store.run(task.currentRunId);
    assert.equal(await count(),1,'reopen alone dispatches no new work');
    const gate=await store.teamResumeGate({projectId:task.projectId,teamId:saved.teamId,taskId:task.taskId});assert.equal(gate.allowed,true,gate.reason);
    const actor={kind:'human' as const,actorId:await store.operatorIdentity(),projectId:task.projectId};
    const resume={taskId:task.taskId,runId:old.runId,requestId:'resume-one',actor,expectedEpoch:old.epoch,expectedRevision:old.revision,...(adopt?{definitionVersion:2}:{})};
    await assert.rejects(store.command({runId:old.runId,commandId:'bypass',owner:old.owner,epoch:old.epoch,revision:old.revision,action:'continue',origin:'human'}),/explicit human successor/);
    await assert.rejects(store.acceptTeamContinuation({...resume,actor:{...actor,actorId:'forged'}}),/authenticated Host operator/);
    await assert.rejects(store.acceptTeamContinuation({...resume,actor:{...actor,kind:'guide'}}),/authenticated Host operator/);
    await assert.rejects(store.acceptTeamContinuation({...resume,expectedEpoch:old.epoch-1}),/stamps changed/);
    await assert.rejects(store.acceptTeamContinuation({...resume,definitionVersion:999}),/definition is unavailable/);
    const receipts=await Promise.all([store.acceptTeamContinuation(resume),store.acceptTeamContinuation(resume)]);
    assert.equal(receipts[0].currentRunId,receipts[1].currentRunId,'same request concurrent admission creates one successor');
    const successor=await store.run(receipts[0].currentRunId);assert.notEqual(successor.runId,old.runId);
    assert.deepEqual(await store.run(old.runId),old,'predecessor opening and controls stay unchanged');
    assert.equal(successor.deadlineAt,old.deadlineAt);assert.equal(successor.opening.data.requestDigest,old.opening.data.requestDigest);
    assert.deepEqual(successor.opening.data.start.runInput,old.opening.data.start.runInput);
    assert.equal(successor.opening.data.source.team.version,adopt?2:1);
    const current=await store.readTeamTask(task.projectId,saved.teamId,task.taskId);assert.deepEqual(current.runIds,[old.runId,successor.runId]);
    await assert.rejects(store.acceptTeamContinuation({...resume,requestId:'different-request'}),/stamps changed/);
    await assert.rejects(store.acceptTeamContinuation({...resume,definitionVersion:adopt?1:2}),/different content/);
    // Simulate accepted opening/ACK loss before start, then retry the exact request.
    await resumeTeamFlow(service.durable,resume,store);
    await waitUntil('one successor resource submits',async()=>await count()===2,25000,25);
    assert.deepEqual(inputs.at(-1),inputs[0],'original compiled task input is unchanged');assert.ok(prompts.length>=1);assert.ok(prompts.every(prompt=>prompt===prompts[0]),'replay reuses exact retained prompt bytes');
    const replay=await service.teamOperation(guide,{action:'startTask',teamId:saved.teamId,request});assert.equal(replay.currentRunId,successor.runId);
    await service.prepareExit({requestId:'exit-two',mode:'keep-jobs'});await waitUntil('successor closes',async()=>(await service.exitStatus()).ready,25000,25);
    await closeHost();host=await bootInProcess(home.h);service=host.ctx.hima as any;bind();
    await service.reconciled;
    await resumeTeamFlow(service.durable,resume,service.durable.store);
    assert.equal(await count(),2,'historical held request replay submits no work');
  } finally {await closeHost();await home.h.dispose();}
});

const { jsonDigest } = await import(new URL('../../packages/harness/lib/run-store.js', import.meta.url).href) as typeof import('../../packages/harness/lib/types/run-store.js');
const unknownStopReason = 'Original controlled command remains alive; adapter cannot prove physical closure.';
type OwnedReceipt = { session: string; pid: number };
function ownedGroupAlive(receipt: OwnedReceipt): boolean {
  const probe = spawnSync('ps', ['-A', '-o', 'pgid=,stat='], { encoding: 'utf8', timeout: 5000 });
  assert.equal(probe.status, 0, probe.stderr);
  return probe.stdout.split('\n').some(line => {
    const row = /^\s*(\d+)\s+(\S+)/.exec(line);
    return row && Number(row[1]) === receipt.pid && !row[2]!.startsWith('Z');
  });
}

/** Same real Host/PG/DBOS and command adapter as the positive case above. */
async function successorFixture(t: Parameters<typeof localHome>[0], options: { terminal?: boolean; deadlineMs?: number; unstarted?: boolean } = {}) {
  const home = await localHome(t, { sleepSeconds: 0 }); assert.ok(home);
  let host: InProcessHost | undefined, service: any, guide: string;
  let unproved = false;
  const receipts: OwnedReceipt[] = [];
  // Restore genuine adapter closure before disposal; emergency cleanup uses only
  // the original PG receipts owned by this private fixture.
  t.after(async () => {
    unproved = false;
    try {
      if (host) {
        for (const run of await service.durable.store.runs()) {
          for (const effect of (await service.durable.store.flowPhysicalFacts(run.runId)).effects) {
            const receipt = await service.durable.store.effectFact(effect.identity.effectId, 'submitted');
            if (receipt?.session && Number.isSafeInteger(receipt.pid) && receipt.pid > 1 && !receipts.some(row => row.session === receipt.session)) receipts.push(receipt);
          }
        }
        await service.closeHostResources();
      }
    }
    finally {
      for (const receipt of receipts) {
        if (ownedGroupAlive(receipt)) try { process.kill(-receipt.pid, 'SIGKILL'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
        spawnSync('tmux', ['kill-session', '-t', `=${receipt.session}`], { timeout: 5000 });
      }
      try { await host?.dispose(); } finally { await home.h.dispose(); }
    }
  });
  host = await bootInProcess(home.h); service = host.ctx.hima as any;
  guide = String((await createRootAgent(host.ctx, home.h.workspace)).id);
  const team = await service.teamOperation(guide, { action: 'save', definition: teamFixture, expectedVersion: null });
  const sitesDir = path.join(home.h.home, 'hima/sites');
  const workspace = path.join(loadSite(sitesDir, 'local').workspaceRoot, 'negative-successor-owned');
  await mkdir(workspace, { recursive: true });
  const script = path.join(workspace, 'member.sh');
  await writeFile(script, `printf "submitted\\n" >> submissions.txt\n${options.terminal ? 'printf "measured answer\\n" > answer.txt\n' : 'exec sleep 120\n'}`);
  const original = commandTaskAdapter({ sitesDir, siteId: 'local', workspace, name: 'Owned post-exit falsifier', argv: ['/bin/sh', script],
    collect: async (_site, _job, request) => ({ schemaVersion: request.contract.output.version,
      value: { answer: (await readFile(path.join(workspace, 'answer.txt'), 'utf8')).trim() }, artifacts: [], diagnostics: [] }) });
  const adapter = { ...original, stop: async (...args: Parameters<NonNullable<typeof original.stop>>) =>
    unproved ? { closed: false as const, reason: unknownStopReason } : original.stop!(...args) };
  const bind = () => { service.teamExecutor = { readiness: async () => ({ ready: true, missing: [] }), resolve: async () => adapter }; };
  bind();
  const count = async () => { try { return (await readFile(path.join(workspace, 'submissions.txt'), 'utf8')).split('\n').filter(Boolean).length; } catch { return 0; } };
  const request = { requestId: 'negative-original', teamId: team.teamId, expectedVersion: 1,
    goal: 'Keep the original task authority', input: { sentinel: 'original-input' },
    deadlineAt: new Date(Date.now() + (options.deadlineMs ?? 70000)).toISOString(), closure: 'Close every owned original resource before admission.' };
  let task: any;
  if (options.unstarted) {
    // Exact openDurableTeamRun frozen opening, accepted by the real Store before
    // scheduleFlowDeadline/startFlow. No kernel handle, invocation or proof is injected.
    const context = await service.teamOperation(guide, { action: 'context' }, 'human');
    const actor = context.actor, definition = await service.durable.store.readTeamDefinition(context.projectId, team.teamId, 1);
    const frozen = { teamId: team.teamId, version: definition.version, sha256: definition.sha256 };
    const taskId = `task-${jsonDigest([actor.projectId, request.teamId, request.requestId])}`, runId = `run-${taskId}`;
    const source = { kind: 'team' as const, projectId: actor.projectId, team: frozen, taskId };
    const start = { runId, flow: compileTeamFlow(source, definition.definition), runInput: { goal: request.goal, input: request.input, closure: request.closure }, goal: {}, strategy: {} };
    const data = { source, definition: definition.definition, start, actor, budget: { closingReserveMs: 0 }, requestDigest: jsonDigest(request) };
    task = await service.durable.store.openTeamTask({ projectId: actor.projectId, requestId: request.requestId, requestSha256: jsonDigest(request),
      task: { taskId, team: frozen, projectId: actor.projectId, goal: request.goal, input: request.input, deadlineAt: request.deadlineAt, closure: request.closure, runIds: [runId], currentRunId: runId },
      opening: { runId, inputSha256: jsonDigest(data), applicationVersion: service.durable.applicationVersion,
        owner: `member:${definition.definition.leaderMemberId}`, deadlineAt: request.deadlineAt, data } });
    assert.deepEqual(await service.durable.store.flowInvocations(task.currentRunId), []);
    assert.deepEqual((await service.durable.store.flowPhysicalFacts(task.currentRunId)).effects, []);
  } else {
    task = await service.teamOperation(guide, { action: 'startTask', teamId: team.teamId, request });
    await waitUntil('original controlled command submits exactly once', async () => await count() === 1, 20000, 25);
    await waitUntil('original submitted receipt is retained in PG', async () => {
      const facts = await service.durable.store.flowPhysicalFacts(task.currentRunId);
      for (const effect of facts.effects) {
        const receipt = await service.durable.store.effectFact(effect.identity.effectId, 'submitted');
        if (receipt?.session && !receipts.some(row => row.session === receipt.session)) {
          assert.ok(Number.isSafeInteger(receipt.pid) && receipt.pid > 1); receipts.push(receipt);
        }
      }
      return receipts.length === 1;
    }, 10000, 25);
  }
  const read = () => service.teamOperation(guide, { action: 'readTask', teamId: team.teamId, taskId: task.taskId }, 'human');
  const reopen = async () => {
    await host!.dispose(); host = undefined;
    host = await bootInProcess(home.h); service = host.ctx.hima as any; bind();
    await service.reconciled;
    guide = String((await createRootAgent(host.ctx, home.h.workspace)).id);
  };
  const control = (action: 'cancel' | 'continue', requestId: string, predecessor: any) => service.teamOperation(guide,
    { action: 'control', teamId: team.teamId, taskId: task.taskId,
      request: { requestId, action, expectedRunId: predecessor.runId, expectedEpoch: predecessor.epoch, expectedRevision: predecessor.revision } }, 'human');
  const resume = (requestId: string, predecessor: any) => service.teamOperation(guide,
    { action: 'control', teamId: team.teamId, taskId: task.taskId,
      request: { requestId, action: 'resume', expectedRunId: predecessor.runId, expectedEpoch: predecessor.epoch, expectedRevision: predecessor.revision } }, 'human');
  let exitSequence = 0;
  const exit = async (mode: 'drain' | 'keep-jobs' | 'stop-jobs' = 'keep-jobs') => {
    const previous = await service.durable.store.hostExit();
    await service.prepareExit({ requestId: `negative-exit-${mode}-${++exitSequence}`, mode, ...(previous ? { expectedRequestId: previous.requestId } : {}) });
    await waitUntil('real Host confirms original resource closure', async () => (await service.exitStatus()).ready, 20000, 25);
  };
  return { get service() { return service; }, get store() { return service.durable.store; }, task, team, request, count, read, reopen, control, resume, exit,
    unknown: (value: boolean) => { unproved = value; }, receipts };
}

async function rejectsWithoutSuccessor(f: Awaited<ReturnType<typeof successorFixture>>, pattern: RegExp) {
  const old = await f.store.run(f.task.currentRunId), taskBefore = await f.store.readTeamTask(f.task.projectId, f.team.teamId, f.task.taskId);
  const runIdsBefore = (await f.store.runs()).map((run: any) => run.runId).sort(), submissions = await f.count();
  const gate = await f.store.teamResumeGate({ projectId: f.task.projectId, teamId: f.team.teamId, taskId: f.task.taskId });
  assert.equal(gate.allowed, false); assert.match(gate.reason, pattern);
  await assert.rejects(f.resume('must-be-denied', old), pattern);
  assert.deepEqual(await f.store.readTeamTask(f.task.projectId, f.team.teamId, f.task.taskId), taskBefore);
  assert.deepEqual((await f.store.runs()).map((run: any) => run.runId).sort(), runIdsBefore, 'denial opens no successor Run');
  assert.deepEqual(await f.store.run(old.runId), old, 'denial preserves immutable predecessor');
  assert.equal(await f.count(), submissions, 'denial dispatches no controlled command');
}

test('unknown original physical closure denies explicit Host successor while the original process remains alive', { timeout: 90000 }, async t => {
  const f = await successorFixture(t); f.unknown(true);
  assert.equal((await f.service.prepareExit({ requestId: 'unproved-exit', mode: 'keep-jobs' })).ready, false);
  // Cancelling the App exit releases only its admission fence, not the Team hold
  // or the original lease. This exposes the physical predicate independently.
  await f.service.cancelExit('unproved-exit');
  assert.equal(ownedGroupAlive(f.receipts[0]!), true);
  assert.ok((await f.store.flowPhysicalFacts(f.task.currentRunId)).resources.some((resource: any) => !resource.released));
  await rejectsWithoutSuccessor(f, /physical.*closure|closure.*unproved/i);
  assert.equal(ownedGroupAlive(f.receipts[0]!), true, 'denial does not invent closure or kill the original group');
  f.unknown(false); await f.exit();
});


test('cancelled predecessor remains denied after actual exit and cold Host reopening', { timeout: 90000 }, async t => {
  const f = await successorFixture(t), old = await f.store.run(f.task.currentRunId);
  await f.control('cancel', 'actual-human-cancel', old);
  await f.exit(); await f.reopen();
  assert.equal((await f.store.run(old.runId)).cancelled, true);
  await rejectsWithoutSuccessor(f, /Cancelled Team/);
});

test('actual short command result commits before exit and terminal predecessor cannot become a successor', { timeout: 90000 }, async t => {
  const f = await successorFixture(t, { terminal: true });
  await waitUntil('real command completes and production TaskEffects commits its output', async () => (await f.read()).execution.state === 'succeeded', 20000, 25);
  const invocation = (await f.store.flowInvocations(f.task.currentRunId))[0]; assert.ok(invocation);
  const snapshot = await f.store.effectSnapshot(invocation.identity);
  assert.ok(snapshot.result); assert.deepEqual(snapshot.result.value, { answer: 'measured answer' });
  assert.equal(snapshot.resourcesReleased, true, 'real command closure precedes terminal delivery');
  const resultBefore = structuredClone(snapshot.result);
  await f.exit(); await f.reopen();
  await rejectsWithoutSuccessor(f, /terminal Team|no retained App exit/);
  assert.deepEqual((await f.store.effectSnapshot(invocation.identity)).result, resultBefore, 'terminal refusal retains the original committed result');
});

test('original trusted wall-clock deadline expires after exit and cannot be extended by explicit Host resume', { timeout: 90000 }, async t => {
  const f = await successorFixture(t, { deadlineMs: 15000 });
  await f.exit(); await f.reopen();
  await waitUntil('original absolute deadline actually expires', async () => Date.now() >= Date.parse(f.request.deadlineAt), 16000, 25);
  await rejectsWithoutSuccessor(f, /original absolute deadline has expired/);
  assert.equal((await f.store.run(f.task.currentRunId)).deadlineAt, f.request.deadlineAt);
});

for (const mode of ['drain', 'keep-jobs', 'stop-jobs'] as const) {
  test(`different concurrent human resume request IDs after ${mode} have exactly one currentRun CAS winner`, { timeout: 90000 }, async t => {
    const f = await successorFixture(t); await f.exit(mode); await f.reopen();
    assert.equal(await f.count(), 1, 'cold reopening alone submits no work');
    const old = await f.store.run(f.task.currentRunId), before = (await f.store.runs()).map((run: any) => run.runId);
    const contenders = await Promise.allSettled([f.resume('resume-alpha', old), f.resume('resume-beta', old)]);
    assert.equal(contenders.filter(result => result.status === 'fulfilled').length, 1);
    const loser = contenders.find(result => result.status === 'rejected'); assert.ok(loser && loser.status === 'rejected');
    assert.match(String(loser.reason), /current Run|stamps changed|compare-and-swap/i);
    const current = await f.store.readTeamTask(f.task.projectId, f.team.teamId, f.task.taskId);
    assert.deepEqual(current.runIds, [old.runId, current.currentRunId]); assert.notEqual(current.currentRunId, old.runId);
    const newRuns = (await f.store.runs()).filter((run: any) => !before.includes(run.runId));
    assert.equal(newRuns.length, 1); assert.equal(newRuns[0].runId, current.currentRunId);
    assert.deepEqual(await f.store.run(old.runId), old, 'CAS loser cannot mutate predecessor history');
    await waitUntil('CAS winner dispatches one successor command', async () => await f.count() === 2, 20000, 25);
    const successor = await f.store.run(current.currentRunId);
    assert.equal(successor.deadlineAt, old.deadlineAt);
    assert.deepEqual(successor.opening.data.start.runInput, old.opening.data.start.runInput);
    await f.exit(); await f.reopen();
    assert.equal(await f.count(), 2, 'second cold reopening cannot replay either resume into new work');
  });
}

test('durably accepted Team before DBOS dispatch has no physical work and can resume after exit', { timeout: 90000 }, async t => {
  const f = await successorFixture(t, { unstarted: true });
  assert.equal(await f.count(), 0);
  await f.exit(); await f.reopen();
  assert.equal(await f.count(), 0, 'cold reopen must not dispatch the accepted but unstarted predecessor');
  const old = await f.store.run(f.task.currentRunId);
  assert.deepEqual(await f.store.flowInvocations(old.runId), []);
  assert.deepEqual((await f.store.flowPhysicalFacts(old.runId)).effects, []);
  const gate = await f.store.teamResumeGate({ projectId: f.task.projectId, teamId: f.team.teamId, taskId: f.task.taskId });
  assert.equal(gate.allowed, true, `no physical work requires no invented closure proof: ${gate.reason}`);
  const resumed = await f.resume('resume-accepted-unstarted', old);
  assert.notEqual(resumed.currentRunId, old.runId);
  await waitUntil('only successor submits its first controlled command', async () => await f.count() === 1, 20000, 25);
  assert.deepEqual(await f.store.flowInvocations(old.runId), [], 'original accepted opening remains undispatched history');
  assert.deepEqual(await f.store.run(old.runId), old);
});
