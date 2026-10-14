// #98: real Host/PG/DBOS with one sleeping script replacing the member/model dependency.
// This qualifies exit mechanics only; it makes no Pi/OpenCode/OAR/model effectiveness claim.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { commandTaskAdapter, loadSite } from '@hima/harness';
import { bootInProcess, createRootAgent, type InProcessHost } from './support/boot-inprocess.ts';
import { localHome, waitUntil } from './support/fabric.ts';
import { teamFixture } from './support/himateam.ts';

process.env.HIMA_TEST_SILENT_AGENT = '1';
process.env.HIMA_TEST_LEGACY_AUTO_DRIVE = '0';
const unknownReason = 'Fixture original adapter has no physical stop proof; original sleeping process remains active.';
type Receipt = { session: string; pid: number; workspace: string };
function sessionAlive(receipt: Receipt): boolean {
  const result = spawnSync('tmux', ['has-session', '-t', `=${receipt.session}`], { timeout: 5000 });
  assert.ok(result.status === 0 || result.status === 1, `tmux probe failed: ${result.stderr}`);
  return result.status === 0;
}
function groupAlive(receipt: Receipt): boolean {
  const result = spawnSync('ps', ['-A', '-o', 'pgid=,stat='], { encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.split('\n').some(line => {
    const row = /^\s*(\d+)\s+(\S+)/.exec(line);
    return row && Number(row[1]) === receipt.pid && !row[2]!.startsWith('Z');
  });
}
async function originalJobs(host: InProcessHost, runId: string): Promise<Receipt[]> {
  const service = host.ctx.hima as any;
  const facts = await service.durable.store.flowPhysicalFacts(runId);
  const receipts: Receipt[] = [];
  for (const effect of facts.effects) {
    const receipt = await service.durable.store.effectFact(effect.identity.effectId, 'submitted');
    if (receipt?.session) {
      assert.ok(Number.isSafeInteger(receipt.pid) && receipt.pid > 1, 'original submitted receipt has its process group');
      receipts.push(receipt);
    }
  }
  return receipts;
}
async function assertClosed(host: InProcessHost, runId: string, receipts: Receipt[]): Promise<void> {
  const facts = await (host.ctx.hima as any).durable.store.flowPhysicalFacts(runId);
  assert.ok(facts.resources.length > 0, 'real PG resource leases exist');
  assert.ok(facts.resources.every((resource: any) => resource.released), 'every original lease is released before Host/Home teardown');
  for (const receipt of receipts) {
    assert.equal(sessionAlive(receipt), false, 'original tmux session is physically absent');
    assert.equal(groupAlive(receipt), false, 'original process group has no live member');
  }
}

for (const mode of ['drain', 'keep-jobs', 'stop-jobs'] as const) {
  test(`Team ${mode} closes original member resources and cold reopening retains the exit hold`, { timeout: 90000 }, async t => {
    await exercise(t, mode, false);
  });
}
test('Team keep-jobs exit remains unready and exposes actual unknown stop reason while original process lives', { timeout: 90000 }, async t => {
  await exercise(t, 'keep-jobs', true);
});

test('Team cancellation intent stays waiting until original process closure is proved', { timeout: 90000 }, async t => { await exercise(t, 'keep-jobs', true, true); });

test('normal Host closer retains PG and actual resources on unknown stop proof, then retries original closure', { timeout: 90000 }, async t => { await exercise(t, 'dispose', true); });

test('normal Host disposal closes a live Team before stopping PG and preserves its hold', { timeout: 90000 }, async t => { await exercise(t, 'dispose', false); });

async function exercise(t: Parameters<typeof localHome>[0], mode: 'drain' | 'keep-jobs' | 'stop-jobs' | 'dispose', unknown: boolean, cancel = false): Promise<void> {
  const home = await localHome(t, { sleepSeconds: 0 });
  assert.ok(home);
  let host: InProcessHost | undefined;
  let runId: string | undefined;
  let receipts: Receipt[] = [];
  let unproved = unknown;
  try {
    host = await bootInProcess(home.h);
    let service = host.ctx.hima as any;
    let guide = String((await createRootAgent(host.ctx, home.h.workspace)).id);
    const team = await service.teamOperation(guide, { action: 'save', definition: teamFixture, expectedVersion: null });
    const sitesDir = path.join(home.h.home, 'hima/sites');
    const workspace = path.join(loadSite(sitesDir, 'local').workspaceRoot, 'team-exit-script');
    await mkdir(workspace, { recursive: true });
    const script = path.join(workspace, 'member.sh');
    await writeFile(script, 'printf "submitted\\n" >> submissions.txt\nprintf "%s\\n" "$$" > member.pid\nexec sleep 120\n');
    const original = commandTaskAdapter({ sitesDir, siteId: 'local', workspace, name: 'Sleeping Team dependency fixture', argv: ['/bin/sh', script],
      collect: async (_site, _job, request) => ({ schemaVersion: request.contract.output.version, value: { answer: 'fixture should be stopped before collecting' }, artifacts: [], diagnostics: [] }) });
    const adapter = { ...original, stop: async (...args: Parameters<NonNullable<typeof original.stop>>) => unproved ? { closed: false as const, reason: unknownReason } : original.stop!(...args) };
    const bind = () => { service.teamExecutor = { readiness: async () => ({ ready: true, missing: [] }), resolve: async () => adapter }; };
    bind();
    const request = { requestId: `sleep-${mode}`, teamId: team.teamId, expectedVersion: 1, goal: 'Wait until controlled exit', input: {},
      deadlineAt: new Date(Date.now() + 75000).toISOString(), closure: 'Close the original member process and retain its task.' };
    const task = await service.teamOperation(guide, { action: 'startTask', teamId: team.teamId, request });
    runId = task.currentRunId; assert.ok(runId);
    await waitUntil('PG-recorded original sleeping Team process is active', async () => {
      receipts = await originalJobs(host!, runId!);
      return receipts.length === 1 && sessionAlive(receipts[0]!) && groupAlive(receipts[0]!);
    }, 30000, 25);
    await waitUntil('actual script starts once', async () => {
      try { return (await readFile(path.join(workspace, 'submissions.txt'), 'utf8')) === 'submitted\n'; } catch { return false; }
    }, 10000, 25);
    const memberPid = Number(await readFile(path.join(workspace, 'member.pid'), 'utf8'));
    assert.ok(Number.isSafeInteger(memberPid) && memberPid > 1);
    assert.doesNotThrow(() => process.kill(memberPid, 0), 'script PID actually exists before exit');
    const before = await service.durable.store.flowPhysicalFacts(runId);
    assert.ok(before.resources.some((resource: any) => !resource.released));
    const read = () => service.teamOperation(guide, { action: 'readTask', teamId: team.teamId, taskId: task.taskId });
    if (mode === 'dispose') {
      if (unknown) {
        await assert.rejects(service.closeHostResources(), /Team resource closure is unproved/);
        assert.equal(sessionAlive(receipts[0]!), true); assert.equal(groupAlive(receipts[0]!), true);
        assert.equal((await read()).execution.resourceState, 'active');
        await assert.rejects(service.prepareExit({requestId:'public-after-close',mode:'keep-jobs'}), /finalizing/);
        unproved = false;
        await service.closeHostResources();
      }
      await host.dispose(); host = undefined;
      assert.equal(sessionAlive(receipts[0]!), false); assert.equal(groupAlive(receipts[0]!), false);
      host = await bootInProcess(home.h); service = host.ctx.hima as any; bind();
      guide = String((await createRootAgent(host.ctx, home.h.workspace)).id);
      await assertClosed(host, runId, receipts);
      assert.match((await service.durable.store.run(runId)).hold, /^Team stopped on App exit/);
      const reopenedState = await read(); assert.deepEqual(reopenedState.allowedActions, []);
      assert.equal(reopenedState.execution.resourceState, 'closed');
      assert.equal(await readFile(path.join(workspace, 'submissions.txt'), 'utf8'), 'submitted\n');
      return;
    }
    const exitRequestId = `exit-${mode}`;
    if (cancel) {
      const current = await read();
      await service.teamOperation(guide, { action: 'control', teamId: team.teamId, taskId: task.taskId,
        request: { requestId: 'unknown-cancel', action: 'cancel', expectedEpoch: current.execution.epoch, expectedRevision: current.execution.revision } });
    }
    const exit = cancel ? { ready: false } : await service.prepareExit({ requestId: exitRequestId, mode });
    if (unknown) {
      assert.equal(exit.ready, false, 'keep-jobs cannot hide a Team member with unproved closure');
      const state = await read();
      assert.equal(state.execution.state, 'waiting');
      assert.equal(state.execution.cancellationRequested, cancel);
      assert.notEqual(state.execution.resourceState, 'closed');
      assert.ok([state.execution.reason, ...state.execution.tasks.map((row: any) => row.reason)].some(reason => reason?.includes(unknownReason)),
        `actual stop reason must reach the public Team view: ${JSON.stringify(state.execution)}`);
      assert.equal(sessionAlive(receipts[0]!), true);
      assert.equal(groupAlive(receipts[0]!), true);
      assert.doesNotThrow(() => process.kill(memberPid, 0), 'unknown proof never kills the genuine process');
      const physical = await service.durable.store.flowPhysicalFacts(runId);
      assert.ok(physical.resources.some((resource: any) => !resource.released), 'unknown stop must retain the actual lease');
      console.info('team-exit-unknown', JSON.stringify({ mode, runId, ready: exit.ready, execution: state.execution, originalSession: receipts[0]!.session, originalGroup: receipts[0]!.pid, originalAlive: true }));
      unproved = false;
      if (cancel) {
        const current = await read();
        await service.teamOperation(guide, { action: 'control', teamId: team.teamId, taskId: task.taskId,
          request: { requestId: 'retry-original-stop', action: 'cancel', expectedEpoch: current.execution.epoch, expectedRevision: current.execution.revision } });
      }
      await service.prepareExit({ requestId: 'exit-restored', mode: 'keep-jobs', ...(cancel ? {} : { expectedRequestId: exitRequestId }) });
    }
    await waitUntil('all Team resources reach exit boundary', async () => (await service.exitStatus()).ready, 30000, 25);
    await assertClosed(host, runId, receipts);
    const held = await service.durable.store.run(runId);
    if (cancel) assert.equal(held.hold, 'cancel'); else assert.match(held.hold ?? '', /^Team stopped on App exit/);
    const state = await read();
    assert.equal(state.execution.resourceState, 'closed');
    assert.deepEqual(state.allowedActions, []);
    assert.equal(state.execution.tasks.some((row: any) => row.result), false, 'stopping a sleeping member does not invent delivery');
    const submissionsBefore = await originalJobs(host, runId);
    await host.dispose(); host = undefined;
    host = await bootInProcess(home.h);
    service = host.ctx.hima as any;
    guide = String((await createRootAgent(host.ctx, home.h.workspace)).id);
    bind();
    const reopened = await service.durable.store.run(runId);
    assert.equal(reopened.hold, held.hold, 'exit hold persists across actual Host/PG reopening');
    const replay = await service.teamOperation(guide, { action: 'startTask', teamId: team.teamId, request });
    assert.equal(replay.taskId, task.taskId);
    assert.equal(replay.currentRunId, runId);
    const reopenedState = await read();
    assert.deepEqual(reopenedState.allowedActions, []);
    assert.equal(reopenedState.execution.resourceState, 'closed');
    await assert.rejects(service.teamOperation(guide, { action: 'control', teamId: team.teamId, taskId: task.taskId,
      request: { requestId: 'reject-reactivation', action: 'continue', expectedEpoch: reopened.epoch, expectedRevision: reopened.revision } }), cancel ? /Cancelled Run/ : /not qualified yet/);
    assert.deepEqual(await originalJobs(host, runId), submissionsBefore, 'replay retains exactly the original submitted identity');
    assert.equal(await readFile(path.join(workspace, 'submissions.txt'), 'utf8'), 'submitted\n', 'cold reopening and replay never execute the member again');
    await assertClosed(host, runId, receipts);
    console.info('team-exit-closure', JSON.stringify({ mode, unknownFixture: unknown, runId, originalSession: receipts[0]!.session, originalGroup: receipts[0]!.pid, closedBeforeDisposal: true, reopenedHold: reopened.hold, submittedCount: submissionsBefore.length }));
  } finally {
    // Restore genuine closure first. Emergency cleanup is strictly limited to this test's receipts.
    unproved = false;
    if (host && runId) {
      try {
        const service = host.ctx.hima as any;
        const active = await service.durable.store.hostExit();
        await service.prepareExit({ requestId: 'owned-teardown', mode: 'keep-jobs', ...(active ? { expectedRequestId: active.requestId } : {}) });
      } catch (error) { console.warn('Team fixture teardown required owned physical cleanup', String(error)); }
    }
    try {
      for (const receipt of receipts) {
        if (groupAlive(receipt)) { try { process.kill(-receipt.pid, 'SIGKILL'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; } }
        if (sessionAlive(receipt)) spawnSync('tmux', ['kill-session', '-t', `=${receipt.session}`], { timeout: 5000 });
      }
    } finally { try { await host?.dispose(); } finally { await home.h.dispose(); } }
  }
}

test('normal close fences a racing first Team opening before inventory can be consumed', {timeout:60000}, async t => {
  const home=await localHome(t,{sleepSeconds:0});assert.ok(home);
  const host=await bootInProcess(home.h);const service=host.ctx.hima as any;
  const guide=String((await createRootAgent(host.ctx,home.h.workspace)).id);
  const team=await service.teamOperation(guide,{action:'save',definition:teamFixture,expectedVersion:null});
  await service.reconciled;
  const store=service.durable.store,originalRuns=store.runs.bind(store);
  let release!:()=>void,entered!:()=>void,first=true;
  const gate=new Promise<void>(resolve=>release=resolve),inside=new Promise<void>(resolve=>entered=resolve);
  store.runs=async()=>{const rows=await originalRuns();if(first){first=false;entered();await gate;}return rows;};
  const closing=service.closeHostResources();
  try {
    await inside;
    await assert.rejects(service.teamOperation(guide,{action:'startTask',teamId:team.teamId,request:{requestId:'racing-first-task',teamId:team.teamId,expectedVersion:1,goal:'Must be fenced',input:{},deadlineAt:new Date(Date.now()+30000).toISOString(),closure:'No business admission during Host close.'}}),/App is closing|business admission.*fenced/);
  } finally {
    release();store.runs=originalRuns;
    try {await closing;} finally {await host.dispose();await home.h.dispose();}
  }
});

test('normal closer cannot confirm shutdown after an already admitted cancellation releases its reused fence', {timeout:60000}, async t => {
  const home=await localHome(t,{sleepSeconds:0});assert.ok(home);
  const host=await bootInProcess(home.h),service=host.ctx.hima as any;
  const guide=String((await createRootAgent(host.ctx,home.h.workspace)).id);
  const team=await service.teamOperation(guide,{action:'save',definition:teamFixture,expectedVersion:null});
  await service.reconciled;await service.prepareExit({requestId:'reused-exit',mode:'keep-jobs'});
  const store=service.durable.store,originalRuns=store.runs.bind(store),originalRelease=store.releaseHostExit.bind(store);
  let enterCancel!:()=>void,releaseCancel!:()=>void,enterInventory!:()=>void,releaseInventory!:()=>void,count=0;
  const cancellationInside=new Promise<void>(resolve=>enterCancel=resolve),cancelGate=new Promise<void>(resolve=>releaseCancel=resolve);
  const inventoryInside=new Promise<void>(resolve=>enterInventory=resolve),inventoryGate=new Promise<void>(resolve=>releaseInventory=resolve);
  store.releaseHostExit=async(...args:any[])=>{enterCancel();await cancelGate;return originalRelease(...args);};
  store.runs=async()=>{const rows=await originalRuns();if(++count===2){enterInventory();await inventoryGate;}return rows;};
  const cancelling=service.cancelExit('reused-exit');await cancellationInside;
  const closing=service.closeHostResources();let consumed=false;
  try {
    await inventoryInside;releaseCancel();await cancelling;
    await assert.rejects(service.teamOperation(guide,{action:'startTask',teamId:team.teamId,request:{requestId:'after-cancel-before-close',teamId:team.teamId,expectedVersion:1,goal:'Must remain fenced during resource close',input:{},deadlineAt:new Date(Date.now()+30000).toISOString(),closure:'No business admission during resource close.'}}),/App is closing/);
    releaseInventory();
    await assert.rejects(closing,/exit.*stale|fence.*disappeared/i);consumed=true;
    assert.equal((await store.readTeamDefinition(team.projectId,team.teamId)).teamId,team.teamId,'unconfirmed shutdown preserves live PG evidence');
  } finally {
    releaseCancel();releaseInventory();store.runs=originalRuns;store.releaseHostExit=originalRelease;
    if(!consumed)await closing.catch(()=>{});
    await service.closeHostResources();await host.dispose();await home.h.dispose();
  }
});

// Read-only metadata falsifiers for the public readiness projection. These doubles
// do not prove native closure; the actual Pack/Team Host cases qualify that seam.
const exitLib = process.env.HIMA_DBOS_TEST_LIB ?? path.resolve('packages/harness/lib');
const { readDurableHostExitStatus } = await import(pathToFileURL(path.join(exitLib, 'host-exit.js')).href) as typeof import('../../packages/harness/lib/types/host-exit.js');
const { jsonDigest: exitDigest } = await import(pathToFileURL(path.join(exitLib, 'run-store.js')).href) as typeof import('../../packages/harness/lib/types/run-store.js');

function exitProjectionFixture(effectId = 'original-call') {
  const identity = { runId: 'parent', taskId: 'call', effectId, inputSha256: 'a'.repeat(64), packSha256: 'b'.repeat(64), irSha256: 'c'.repeat(64), applicationVersion: 'fixture', adapterVersion: 'fixture' };
  const delegation = { nodeId: 'call', team: { teamId: 'saved', version: 1, sha256: 'd'.repeat(64) } };
  const invocation: any = { identity, version: 1, branches: [], consumedEffects: [], consumedVersions: [], context: { taskId: 'call', flow: { source: 'pack', tasks: { call: { tool: 'resident/team-delegate', teamDelegation: delegation } } } } };
  const plan: any = { schema: 'hima-pack-team-delegation/1', parentIdentity: identity, parentInvocationSha256: exitDigest(invocation), delegation, childTaskId: 'child-' + effectId, childRunId: 'run-child-' + effectId };
  const resource: any = { effectId, identity, claim: { siteId: 'local', jobs: 0, licences: {} }, released: false, proof: null };
  const effect: any = { identity, phase: 'pack-team-binding', admittedAt: 'retained', dispatches: [{ dispatchId: 'submit', inputSha256: identity.inputSha256, at: 'retained' }] };
  const snapshot: any = { resourcesReleased: false, facts: { prepared: plan, submitted: structuredClone(plan), 'pack-team-binding': { plan: structuredClone(plan), bindingSha256: exitDigest(plan) } } };
  const closure: any = { closed: true, proof: { packTeam: true, parentIdentity: identity, childTaskId: plan.childTaskId, bindingSha256: exitDigest(plan) } };
  const state: any = { request: { requestId: 'exit', mode: 'keep-jobs' }, resources: [resource], effects: [effect], invocations: [invocation], snapshots: { [effectId]: snapshot }, closures: { [effectId]: closure }, delivery: [] };
  let closureReads = 0;
  const methods: any = {
    readHostExitBoundary: async (read: () => Promise<unknown>) => read(), hostExit: async () => state.request,
    lastHostExitRequestId: async () => 'exit', runs: async () => [{ runId: 'parent' }],
    run: async () => ({ opening: { data: { start: { flow: { source: 'pack', tasks: { call: { teamDelegation: delegation } } } } } } }),
    flowInvocations: async () => state.invocations,
    flowPhysicalFacts: async () => ({ resources: state.resources, effects: state.effects, stopped: {} }),
    flowProjection: async () => ({ tasks: state.effects.map((item: any) => ({ identity: item.identity })) }),
    effectSnapshot: async (id: any) => state.snapshots[id.effectId],
    orderedFlowFacts: async () => state.delivery, flowFact: async () => undefined,
    readExternalPackTeamClosure: async (id: any) => { closureReads++; if (state.failure) throw state.failure; return state.closures[id.effectId]; },
  };
  const store = new Proxy(methods, { get(target, property) { if (!(property in target)) throw new Error('Unexpected Store method: ' + String(property)); return target[property]; } });
  return { state, identity, plan, resource, effect, snapshot, closure, invocation, store, reads: () => closureReads };
}

test('HostExit keep-jobs projects accepted closed Pack bookkeeping without releasing or stopping its parent', async () => {
  const f = exitProjectionFixture(), retained = structuredClone(f.state);
  const status = await readDurableHostExitStatus(f.store, undefined);
  assert.equal(status.ready, true);
  assert.deepEqual(status.runs, [{ runId: 'parent', state: 'ready', jobs: [] }]);
  assert.equal(f.reads(), 1, 'the existing raw child closure observation is required');
  assert.deepEqual(f.state, retained, 'readiness changes no lease, proof, result, dispatch or binding');
});

const exitProjectionRefusals: Array<[string, (f: ReturnType<typeof exitProjectionFixture>) => void]> = [
  ['unknown child closure', f => { f.closure.closed = false; delete f.closure.proof; }],
  ['unadmitted fallback', f => { f.closure.proof = { packTeamUnadmitted: true, parentIdentity: f.identity }; }],
  ['missing proof parent identity', f => { delete f.closure.proof.parentIdentity; }],
  ['missing proof', f => { delete f.closure.proof; }],
  ['false Pack proof', f => { f.closure.proof.packTeam = false; }],
  ['different proof parent identity', f => { f.closure.proof.parentIdentity = { ...f.identity, inputSha256: 'e'.repeat(64) }; }],
  ['different child task', f => { f.closure.proof.childTaskId = 'other-child'; }],
  ['different binding proof digest', f => { f.closure.proof.bindingSha256 = 'e'.repeat(64); }],
  ['missing accepted binding', f => { delete f.snapshot.facts['pack-team-binding']; }],
  ['changed binding bytes', f => { f.snapshot.facts['pack-team-binding'].plan.childTaskId = 'changed'; }],
  ['changed binding digest', f => { f.snapshot.facts['pack-team-binding'].bindingSha256 = 'e'.repeat(64); }],
  ['wrong preparation schema', f => { f.plan.schema = 'other'; }],
  ['changed preparation identity', f => { f.plan.parentIdentity = { ...f.identity, inputSha256: 'e'.repeat(64) }; }],
  ['missing child task identity', f => { delete f.plan.childTaskId; }],
  ['missing child run identity', f => { delete f.plan.childRunId; }],
  ['missing preparation', f => { delete f.snapshot.facts.prepared; }],
  ['missing submitted receipt', f => { delete f.snapshot.facts.submitted; }],
  ['changed submitted receipt', f => { f.snapshot.facts.submitted.childTaskId = 'changed'; }],
  ['unsubmitted original', f => { f.effect.dispatches = []; }],
  ['unrelated business dispatch', f => { f.effect.dispatches.push({ dispatchId: 'other', inputSha256: f.identity.inputSha256 }); }],
  ['different dispatch identity', f => { f.effect.dispatches[0].inputSha256 = 'e'.repeat(64); }],
  ['different lease identity', f => { f.resource.identity = { ...f.identity, taskId: 'other' }; }],
  ['positive Job claim', f => { f.resource.claim.jobs = 1; }],
  ['licence claim with zero Jobs', f => { f.resource.claim.licences = { native: 1 }; }],
  ['even a named zero licence claim', f => { f.resource.claim.licences = { native: 0 }; }],
  ['arbitrary zero-Job program', f => { f.invocation.context.flow.tasks.call.tool = 'program/script'; }],
  ['independent Team invocation', f => { f.invocation.context.flow.source = 'team'; }],
  ['missing frozen declaration', f => { delete f.invocation.context.flow.tasks.call.teamDelegation; }],
  ['different retained invocation', f => { f.invocation.identity = { ...f.identity, irSha256: 'e'.repeat(64) }; }],
  ['different frozen task context', f => { f.invocation.context.taskId = 'other'; }],
  ['wrong effect phase', f => { f.effect.phase = 'submitted'; }],
  ['no retained invocation', f => { f.state.invocations = []; }],
  ['unadmitted preparation', f => { f.effect.admittedAt = null; }],
  ['incomplete original preparation write', f => { f.snapshot.facts['native:preparation-write-intent'] = {}; }],
  ['pending delivery writer', f => { f.state.delivery = [{ name: 'delivery-io:intent:report', value: {} }]; }],
  ['unrelated held resource', f => { f.state.resources.push({ ...f.resource, effectId: 'other', identity: { ...f.identity, effectId: 'other' } }); }],
  ['another accepted branch is unknown', f => {
    const other = exitProjectionFixture('other-call');
    f.state.effects.push(other.effect); f.state.resources.push(other.resource); f.state.invocations.push(other.invocation);
    f.state.snapshots['other-call'] = other.snapshot; f.state.closures['other-call'] = { closed: false, reason: 'Original family still lives' };
  }],
];
for (const [label, mutate] of exitProjectionRefusals) test('HostExit keep-jobs retains readiness blocker: ' + label, async () => {
  const f = exitProjectionFixture(); mutate(f);
  const retained = structuredClone(f.state);
  const status = await readDurableHostExitStatus(f.store, undefined);
  assert.equal(status.ready, false);
  assert.notEqual(status.runs[0]!.state, 'ready');
  assert.deepEqual(f.state, retained, 'refusal retains the original facts');
});
for (const mode of [undefined, 'drain', 'stop-jobs']) test('HostExit Pack bookkeeping rule is limited to keep-jobs: ' + String(mode), async () => {
  const f = exitProjectionFixture(); f.state.request = mode ? { requestId: 'exit', mode } : null;
  assert.equal((await readDurableHostExitStatus(f.store, undefined)).ready, false);
  assert.equal(f.reads(), 0);
});
test('HostExit propagates raw closure storage failure without inventing proof', async () => {
  const f = exitProjectionFixture(), failure = new Error('Original database failure'); f.state.failure = failure;
  await assert.rejects(readDurableHostExitStatus(f.store, undefined), error => error === failure);
  assert.equal(f.resource.released, false); assert.equal(f.resource.proof, null);
  assert.equal(f.snapshot.result, undefined);
});
