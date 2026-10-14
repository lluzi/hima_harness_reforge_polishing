// #105 L4: actual native SDK/model/MCP then actual Electron paints SAME retained Tasks.
// Run serially under the approved 2048 MiB TOTAL-tree watcher.
// All native children + first Host/PG close BEFORE Electron/second Host/PG start.
// This proves retained result/UI composition, not concurrent live-native GUI operation.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { TeamDefinition } from '@hima/harness';
import { bootInProcess, createRootAgent } from './support/boot-inprocess.ts';
import { bootTeamPlaywright, finishTeamOnboarding } from './support/team-playwright-electron.ts';
import { createHimaHome, repoRoot, type HimaHome } from './support/dsh-home.ts';
import { teamFixture } from './support/himateam.ts';
import { nativePgObserver } from './support/native-pg-observer.mjs';
import { calculatorBarrier, proveBusy, releaseAfterHuman, assertBarrierOrder } from './support/native-busy-barrier.ts';
process.env.HIMA_TEST_SILENT_AGENT = '1';
process.env.HIMA_TEST_LEGACY_AUTO_DRIVE = '0';

// Read-only receipt inventory. No second Host/RunStore/kernel, no migrations/writes,
// and no output of test-private cluster credentials. Scope is this owned Home only.
async function retainedInventory(home: HimaHome, runIds: string[]) {
  const credential = JSON.parse(await readFile(path.join(home.home,'hima/database/credentials.json'),'utf8'));
  const {Client}=createRequire(path.join(repoRoot,'packages/harness/package.json'))('pg');
  const client=new Client({host:'127.0.0.1',port:credential.port,user:credential.user,password:credential.password,database:'hima_application',
    options:'-c default_transaction_read_only=on -c statement_timeout=5000',application_name:'issue105-own-home-readonly'});
  await client.connect();
  try {
    assert.equal((await client.query('SHOW default_transaction_read_only')).rows[0].default_transaction_read_only,'on');
    const facts=(await client.query(`SELECT i.run_id,i.effect_id,f.phase,f.fact FROM hima.flow_invocations i JOIN hima.effect_facts f USING(effect_id)
      WHERE i.run_id=ANY($1::text[]) AND (f.phase LIKE 'native:oar:local-birth:%' OR f.phase='native:oar:local-birth' OR f.phase LIKE 'native:oar:observation:%') ORDER BY i.run_id,i.effect_id,f.phase`,[runIds])).rows;
    const results=(await client.query('SELECT run_id,effect_id,result_sha256,result FROM hima.results WHERE run_id=ANY($1::text[]) ORDER BY run_id,effect_id',[runIds])).rows;
    return {clusterIdentity:credential.identity,facts,results};
  } finally {await client.end();}
}

const sha = (bytes: string) => createHash('sha256').update(bytes).digest('hex');
async function waitUntil(what: string, probe: () => boolean | Promise<boolean>, timeoutMs = 60_000, everyMs = 100): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await probe()) return;
    if (Date.now() >= deadline) throw new Error(`${what} did not happen within ${timeoutMs} ms`);
    await new Promise(resolve => setTimeout(resolve, everyMs));
  }
}
const absent = (pid: number) => {
  try { process.kill(pid, 0); return false; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return true; throw error; }
};
const childOutput = { version: 'native-product/1', schema: {
  $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object',
  properties: { answer: { type: 'integer', const: 703 } }, required: ['answer'], additionalProperties: false,
} };
const leaderOutput = { version: 'native-sourced-product/1', schema: {
  $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', properties: {
    answer: { type: 'integer', const: 703 }, childEffectId: { type: 'string', minLength: 1 },
    childSource: { type: 'object' },
  }, required: ['answer', 'childEffectId', 'childSource'], additionalProperties: false,
} };
const envelope = 'Return ONLY TaskToolOutput JSON {"schemaVersion":YOUR_OUTPUT_VERSION,"value":YOUR_VALUE,"artifacts":[],"diagnostics":[]}. No markdown, no prose outside JSON. Do not invent Host identities or completion facts.';

test('real Pi and OpenCode each lead same-Task capacity-one delegation and sourced successor delivery', {
  timeout: 540000, skip: !process.env.DEEPSEEK_API_KEY ? 'Requires authorized shared DeepSeek credential' : false,
}, async () => {
  const startedAt = Date.now();
  const home = { h: await createHimaHome({ desktopShaped: true }) };
  // Explicit native defaults override any profile onboarding placeholder.
  Object.assign(home.h.env,{DEEPSEEK_API_KEY:process.env.DEEPSEEK_API_KEY,
    DEEPSEEK_BASE_URL:process.env.DEEPSEEK_BASE_URL??'https://api.deepseek.com/anthropic',
    DEEPSEEK_MODEL:process.env.DEEPSEEK_MODEL??'deepseek-flash',
    DEEPSEEK_API:process.env.DEEPSEEK_API??'anthropic-messages'});
  const host = await bootInProcess(home.h), service = host.ctx.hima, store = service.durable.store;
  await service.reconciled;
  const evidence = path.join(process.env.HIMA_TEAM_EVIDENCE ?? path.resolve('.scratch/himateam-issue97/issue105-live'), new Date().toISOString().replace(/[:.]/g, '-'));
  await mkdir(evidence, { recursive: true });
  const reports: any[] = [], owned: any[] = [];
  let pgDiagnostics: Awaited<ReturnType<typeof nativePgObserver>> | undefined;
  if (process.env.HIMA_TEAM_PG_DIAGNOSTICS === 'off') reports.push({ diagnostics: 'observer-disabled-for-resource' });
  else try { pgDiagnostics = await nativePgObserver(home.h, evidence, repoRoot); }
  catch { reports.push({ diagnostics: 'observer-start-failed' }); }
  // In-memory, allowlisted diagnostics only; persisted once on the original error.
  let failureBoundary: Record<string, unknown> = { pollingStage: 'root-session' };
  const diagnosticSecrets = new Set<string>();
  let originalFailure: unknown, hasOriginalFailure = false;
  const busyStage = (value: Record<string, string | number | boolean | null>) => Object.assign(failureBoundary, value);
  const rememberPrompt = (prepared: any) => { if (typeof prepared?.prompt === 'string') diagnosticSecrets.add(prepared.prompt); };
  const safeError = (error: unknown) => {
    const redact = (value: string) => {
      for (const secret of [...diagnosticSecrets].sort((a,b)=>b.length-a.length)) {
        value=value.split(secret).join('[test input redacted]').split(JSON.stringify(secret).slice(1,-1)).join('[test input redacted]');
      }
      // Assertion differences can quote partial prompt/raw values. Retain the
      // original summary and stack frames, excluding assertion value rendering.
      return value.split('\n').filter((line,index)=>index===0 || /^\s+at /.test(line)).join('\n');
    };
    const name=error instanceof Error ? error.name : 'NonErrorThrow';
    const message=redact(error instanceof Error ? error.message : String(error));
    const stack=redact(error instanceof Error ? error.stack ?? '' : '');
    // Bound the combined original error payload to 8 KiB of UTF-8.
    const bound=(value:string,bytes:number)=>Buffer.from(value).subarray(0,bytes).toString('utf8').replace(/\uFFFD$/,'');
    const boundedName=bound(name,256), boundedMessage=bound(message,2048);
    const result = { name: boundedName, message: boundedMessage, stack: bound(stack,8192-Buffer.byteLength(boundedName)-Buffer.byteLength(boundedMessage)),
      assertionValuesOmitted: true };
    while (Buffer.byteLength(JSON.stringify(result)) > 8192) {
      if (result.stack) result.stack=bound(result.stack,Math.max(0,Buffer.byteLength(result.stack)-256));
      else result.message=bound(result.message,Math.max(0,Buffer.byteLength(result.message)-256));
    }
    return result;
  };
  let testPassed = false;
  let sessionId = '', cleanupProved = true, hostClosed = false;
  let browser: Awaited<ReturnType<typeof bootTeamPlaywright>> | undefined;
  const read = (task: any) => service.teamOperation(sessionId, { action: 'readTask', teamId: task.teamId, taskId: task.taskId }) as Promise<any>;
  const facts = async (identity: any, prefix: string) => Object.values(await store.listExternalEffectFacts(identity, prefix)) as any[];
  try {
    sessionId = String((await createRootAgent(host.ctx, home.h.workspace)).id);
    // Both cases run serially. Each original Task has a single absolute deadline;
    // child/successor consume the same deadline, never a new 230-second allowance.
    for (const leaderRuntime of ['pi', 'opencode'] as const) {
      const workerRuntime = leaderRuntime === 'pi' ? 'opencode' : 'pi';
      failureBoundary = { currentLeaderRuntime: leaderRuntime, workerRuntime, pollingStage: 'save-team' };
      const instructions = `You are the frozen leader. On ORIGINAL input, invoke native member_context action delegate exactly once, then action wait exactly once using its returned delegationId. The MCP response is {ok,value}; unwrap value. Wait may return yield-accepted: do not finalize, delegate again, or send another engineering task; Host will physically close you and provide the checked child result to a successor. On SUCCESSOR input, do not repeat delegation or wait: select child = Host childResults[0] and inspect its checked result and return value {answer:child.result.value.answer,childEffectId:child.result.identity.effectId,childSource:child.result.identity.source}. Preserve source exactly. ${envelope}`;
      const definition: TeamDefinition = { ...teamFixture, title: `${leaderRuntime} leads native collaboration`,
        members: [
          { ...teamFixture.members[0]!, id: 'lead', runtime: leaderRuntime, modelRef: 'default', toolRefs: ['hima-member-context'], instructions },
          { ...teamFixture.members[0]!, id: 'worker', runtime: workerRuntime, modelRef: 'default', toolRefs: ['hima-member-context'],
            role: 'Independent calculator', instructions: `Execute native bash with the requested Node command; use actual stdout for answer and the measured digest. Obtain Host artifactIdentity via member_context readTask. Return the requested product artifact in a strict TaskToolOutput JSON envelope. Do not delegate or invent identities. On a later hima-team-message/1 question, give only a brief plain-text observation. Do not execute tools, change files, delegate, or return a TaskToolOutput for that ordinary question.` },
        ], leaderMemberId: 'lead', collaboration: 'Single capacity: leader yields, independent worker computes, leader consumes checked sourced result.',
        delivery: { description: 'Checked product and the exact committed child source', output: leaderOutput } };
      const saved = await service.teamOperation(sessionId, { action: 'save', definition, expectedVersion: null }) as any;
      const deadlineAt = new Date(Date.now() + 230000).toISOString();
      const barrier = calculatorBarrier(deadlineAt);
      Object.assign(failureBoundary,{deadlineAt, commandSha256:barrier.commandSha256});
      diagnosticSecrets.add(barrier.command); diagnosticSecrets.add(barrier.script); diagnosticSecrets.add(instructions);
      const assignment = { requestId: `native-${leaderRuntime}-child`, memberId: 'worker',
        goal: `Call native member_context action readTask request {} to obtain artifactIdentity. Use native bash to execute this exact command in the original worker CWD, without changing it: ${barrier.command}. The entered/release markers are test-owned; wait within the original absolute deadline, then produce the same requested calculator artifact and stdout. Return actual stdout answer as value.answer under native-product/1. Return ONLY TaskToolOutput JSON with schemaVersion "native-product/1", value {answer: measured numeric answer}, artifacts [{name:"product",path:"product.txt",sha256:measured digest,runId:artifactIdentity.runId,taskId:artifactIdentity.taskId,effectId:artifactIdentity.effectId}], diagnostics []. No markdown.`,
        input: { multiplicand: 37, multiplier: 19 }, output: childOutput, dependsOn: [], deadlineAt };
      const opening = await service.teamOperation(sessionId, { action: 'startTask', teamId: saved.teamId, request: {
        requestId: `native-${leaderRuntime}-start`, teamId: saved.teamId, expectedVersion: saved.version,
        goal: `Delegate this exact assignment via native member_context {action:"delegate",request:${JSON.stringify(assignment)}}. Then invoke native member_context {action:"wait",request:{requestId:"native-${leaderRuntime}-wait",delegationIds:[returned delegationId]}}. Follow frozen leader instructions.`,
        input: { purpose: 'Independent actual native computation and checked source handoff' }, deadlineAt,
        closure: 'Deliver the sourced product only after real worker result verification and actual closure. Stop at original deadline.',
      } }) as any;
      const task = { ...opening, teamId: saved.teamId }; owned.push(task);
      Object.assign(failureBoundary,{taskId:task.taskId,teamId:task.teamId,runId:task.currentRunId,pollingStage:'leader-received'});
      let parent: any;
      const remaining = () => Math.max(1, Date.parse(deadlineAt) - Date.now());
      await waitUntil('original real native leader processes frozen engineering input', async () => {
        const rows = await store.flowInvocations(task.currentRunId);
        for (const row of rows) {
          const p = await store.effectFact(row.identity.effectId, 'prepared') as any; rememberPrompt(p);
          if (p?.memberId !== 'lead' || p.continuation) continue;
          const observations = await facts(p.identity, 'oar:observation:');
          const received = observations.some(r => r.kind === 'received' && r.payload?.inputId === p.inputId);
          // ACP can keep the original prompt pending while the native wait yields.
          // In that case the exact acknowledged input plus the actual accepted
          // native delegate callback proves processing without inventing a receive.
          const delegated = p.runtime === 'opencode'
            && observations.some(r => r.kind === 'created')
            && observations.some(r => r.kind === 'control' && r.payload?.action === 'prompt_ack' && r.payload.inputId === p.inputId)
            && (await facts(p.identity, 'oar:tool-reply:')).some(r => r.ok === true && r.value?.state === 'accepted' && r.value?.delegationId);
          if (received || delegated) { parent = p; return true; }
        }
        return false;
      }, remaining(), 250);
      // Root conversation identity submits one ordinary human observation while
      // the admitted worker is actually busy. Queue acceptance is NOT receive proof.
      let busyWorker: any, busyBirth: any, busyProof: NonNullable<Awaited<ReturnType<typeof proveBusy>>> | undefined;
      await waitUntil('fresh original native calculator command entered and remains in flight', async () => {
        busyStage({pollingStage:'worker-flow-invocations'});
        const invocations = await store.flowInvocations(task.currentRunId);
        busyStage({invocationCount:invocations.length});
        for (const row of invocations) {
          busyStage({pollingStage:'worker-prepared'});
          const prepared = await store.effectFact(row.identity.effectId, 'prepared') as any;
          rememberPrompt(prepared);
          if (prepared?.memberId !== 'worker') continue;
          busyStage({workerEffectId:prepared.identity.effectId,workerSessionKey:prepared.sessionKey,workerGeneration:prepared.generation,pollingStage:'worker-observations',
            pendingReason:null,proofStage:null,candidateCount:null,distinctCallCount:null,sdkSeq:null,nativeRowSeq:null,callId:null,nativeSession:null,markerPresent:null});
          const rows = await facts(prepared.identity, 'oar:observation:');
          busyStage({observationCount:rows.length,rawCount:rows.filter(r=>r.kind==='raw').length,eventCount:rows.filter(r=>r.kind==='event').length,
            lastObservationSeq:rows.reduce((last,r)=>Math.max(last,Number.isSafeInteger(r.seq)?r.seq:-1),-1)});
          // Wait only for required records to arrive; contradictory proof throws.
          if (!rows.some(r=>r.kind==='created') || !rows.some(r=>r.kind==='control' && r.payload?.action==='prompt_ack')) { busyStage({pendingReason:'no-created-or-prompt-ack'}); continue; }
          busyStage({pollingStage:'worker-local-birth'});
          const births = await facts(prepared.identity, 'oar:local-birth:');
          busyStage({birthCount:births.length});
          if (!births.length) { busyStage({pendingReason:'no-local-birth'}); continue; }
          busyStage({pollingStage:'worker-single-birth'});
          assert.equal(births.length,1);
          busyStage({pollingStage:'worker-prove-busy'});
          const proof = await proveBusy(prepared,births[0],rows,barrier,busyStage);
          if (proof) { busyWorker=prepared; busyBirth=births[0]; busyProof=proof; return true; }
        }
        return false;
      }, remaining(), 25);
      busyStage({pollingStage:'busy-proof-ready'});
      assert.ok(busyProof);
      const busyRequest = { requestId: `native-${leaderRuntime}-busy-observation`, recipientMemberIds: ['worker'],
        kind: 'question', stagedAttachmentIds: [],
        text: 'Observation only: identify this as a human question from the Host source envelope. Continue the original calculator assignment unchanged. For this question, reply briefly in plain text; do not use tools, change files, delegate, or return TaskToolOutput.' };
      const busySend = await service.teamOperation(sessionId, { action: 'send-message', teamId: task.teamId,
        taskId: task.taskId, request: busyRequest }, 'human') as any;
      assert.equal(busySend.message.sender.kind, 'human');
      assert.equal(busySend.message.text, busyRequest.text);
      assert.deepEqual(busySend.message.recipientMemberIds, ['worker']);
      assert.equal(busySend.deliveries.length, 1);
      const deliveryId = busySend.deliveries[0].deliveryId;
      assert.equal(busySend.deliveries[0].target.effectId,busyWorker.identity.effectId);
      assert.equal(busySend.deliveries[0].target.generation,busyWorker.generation);
      assert.equal(busySend.deliveries[0].target.runId,task.currentRunId);
      assert.equal(busySend.deliveries[0].target.memberId,'worker');
      assert.ok(busySend.deliveries[0].target.attemptId);
      const frozenBusyTarget=busySend.deliveries[0].target;
      busyStage({pollingStage:'busy-proof-after-human-persistence'});
      const stillBusy = await proveBusy(busyWorker,busyBirth,await facts(busyWorker.identity,'oar:observation:'),barrier,busyStage);
      assert.ok(stillBusy,'original calculator still in flight after public human persistence');
      assert.equal(stillBusy.callId,busyProof.callId); assert.equal(stillBusy.nodeBirth,busyProof.nodeBirth);
      // Release immediately after persisted send. Waiting for ordinary accepted
      // before release deadlocks the real Local single-current-input queue.
      busyStage({pollingStage:'release-after-human'});
      const barrierRelease = await releaseAfterHuman(stillBusy,barrier,busySend.message.createdAt);
      busyStage({pollingStage:'ordinary-delivery-after-release'});
      let busyDelivery: any;
      await waitUntil('busy ordinary question actually reaches exact frozen native worker', async () => {
        busyDelivery = await service.teamOperation(sessionId, { action: 'reconcile-delivery', teamId: task.teamId,
          taskId: task.taskId, request: { deliveryId } }, 'human');
        return busyDelivery.state === 'accepted';
      }, remaining(), 100);
      assert.equal(busyDelivery.target.effectId, busyWorker.identity.effectId);
      assert.equal(busyDelivery.target.runId, task.currentRunId);
      assert.equal(busyDelivery.target.memberId, 'worker');
      assert.equal(busyDelivery.target.generation, busyWorker.generation);
      assert.deepEqual(busyDelivery.target,frozenBusyTarget);
      assert.deepEqual(busyDelivery.received.target, busyDelivery.target);
      const busyRows = await facts(busyWorker.identity, 'oar:observation:');
      const busyReceived = busyRows.filter(r => r.kind === 'received' && r.payload?.inputId === deliveryId);
      assert.equal(busyReceived.length, 1, 'queued receipt alone cannot pass');
      const busyNative = busyReceived[0];
      assert.equal(busyDelivery.received.nativeReceiptId, `${busyNative.nativeSession}:${busyNative.streamGeneration}:${busyNative.seq}`);
      const sentInput = busyRows.find(r => r.kind === 'control' && r.payload?.action === 'send_intent' && r.payload?.inputId === deliveryId);
      assert.ok(sentInput, 'exact Host-authored bytes sent into correlated native input');
      const sourceInput = JSON.parse(sentInput.payload.input);
      assert.equal(sourceInput.schema, 'hima-team-message/1');
      assert.equal(sourceInput.authority, 'host-resolved-provenance');
      assert.deepEqual(sourceInput.source, { projectId: busySend.message.projectId, teamId: task.teamId, taskId: task.taskId,
        messageId: busySend.message.messageId, sender: busySend.message.sender,
        contentDigest: busySend.message.contentDigest, createdAt: busySend.message.createdAt });
      assert.deepEqual(sourceInput.peerText, { trust: 'untrusted', text: busyRequest.text });
      assert.equal(sourceInput.receiptMeaning, 'received-only');
      let continuation: any;
      await waitUntil('native MCP delegate/wait creates actual closed child and successor input', async () => {
        const view = await read(task);
        if (view.execution?.state === 'failed') throw Error(view.execution.reason ?? 'Native task failed');
        const head = await store.readTeamEffectHead(parent.identity);
        if (head.state !== 'active' || !head.continuation) return false;
        continuation = head.continuation;
        const admitted = await store.effect(continuation.invocation.identity.effectId);
        if (!admitted) return false; // The retained plan can precede physical effect admission.
        assert.deepEqual(admitted.identity, continuation.invocation.identity);
        return !!(await store.effectSnapshot(continuation.invocation.identity)).result;
      }, remaining(), 250);
      const successor = await store.effectFact(continuation.invocation.identity.effectId, 'prepared') as any;
      const inputs = continuation.inputs; assert.equal(inputs.length, 1);
      const child = inputs[0], childPrepared = await store.effectFact(child.childEffectId, 'prepared') as any;
      const childSnapshot = await store.effectSnapshot(child.result.identity);
      assert.ok(childSnapshot.resourcesReleased); assert.deepEqual(childSnapshot.result, child.result);
      assert.deepEqual(child.result.value, { answer: 703 }); assert.equal(child.result.outputSchemaVersion, childOutput.version);
      assert.equal(childPrepared.runtime, workerRuntime); assert.equal(child.result.identity.runId, task.currentRunId);
      assert.ok(child.result.identity.source, 'Host-authored frozen source required');
      const artifact = await service.teamOperation(sessionId, { action: 'read-task-artifact', teamId: task.teamId, taskId: task.taskId,
        request: { effectId: child.result.identity.effectId, name: 'product' } }, 'human') as any;
      const artifactBytes = Buffer.from(artifact.contentBase64, 'base64');
      assert.equal(artifactBytes.toString(), '703');
      assert.equal(sha(artifactBytes.toString()), child.result.artifacts.find((a: any) => a.name === 'product')?.sha256);
      const parentReplies = await facts(parent.identity, 'oar:tool-reply:');
      assert.ok(parentReplies.some(r => r.ok === true && r.value?.state === 'accepted' && r.value?.delegationId === child.delegationId), 'actual native MCP delegate callback acceptance');
      assert.ok(parentReplies.some(r => r.ok === true && r.value?.state === 'yield-accepted'), 'actual native MCP wait yields occupied slot');
      assert.equal(successor.prompt, continuation.hostPrompt); assert.equal(successor.inputId, continuation.hostInputId);
      assert.equal(sha(successor.prompt), continuation.hostInputSha256);
      assert.ok(successor.prompt.includes(child.childEffectId)); assert.ok(successor.prompt.includes('703'));
      const receipt = await store.effectFact(successor.identity.effectId, 'team-result-input-receipt:' + continuation.continuationId) as any;
      assert.ok(receipt, 'actual native correlated receive, not queued Host input');
      const received = (await facts(successor.identity, 'oar:observation:')).filter(r => r.kind === 'received' && r.payload?.inputId === continuation.hostInputId);
      assert.equal(received.length, 1);
      const finalSnapshot = await store.effectSnapshot(successor.identity); assert.ok(finalSnapshot.result);
      assert.equal(finalSnapshot.result.outputSchemaVersion, leaderOutput.version);
      assert.deepEqual(finalSnapshot.result.value, { answer: 703, childEffectId: child.result.identity.effectId, childSource: child.result.identity.source });
      assert.deepEqual(finalSnapshot.result.identity, successor.identity); assert.ok(finalSnapshot.resourcesReleased);
      const oldNative = (await facts(parent.identity, 'oar:native-session'))[0];
      const newNative = (await facts(successor.identity, 'oar:native-session'))[0];
      assert.ok(oldNative?.nativeSession); assert.ok(newNative?.nativeSession);
      const exactOriginalNativeIdRestored = oldNative.nativeSession === newNative.nativeSession;
      if (continuation.context.kind === 'native-checkpoint') {
        assert.equal(exactOriginalNativeIdRestored, true, 'actual SDK resume must preserve conversation ID');
        assert.equal(continuation.context.checkpoint.boundary, 'after-physical-close');
        assert.equal(continuation.context.checkpoint.origin.nativeSession, oldNative.nativeSession);
      } else { assert.equal(continuation.context.kind, 'reconstruction'); assert.equal(exactOriginalNativeIdRestored, false, 'honest reconstruction must create distinct known ID'); }
      const instances: any[] = []; let createdNativeInstances = 0, receivedNativeInputs = 0, acknowledgedYieldInputs = 0;
      for (const prepared of [parent, childPrepared, successor]) {
        const births = await facts(prepared.identity, 'oar:local-birth:'); assert.equal(births.length, 1);
        const closed = (await facts(prepared.identity, 'oar:closed'))[0]; assert.ok(closed);
        const resources = await store.effectResources(prepared.identity.effectId); assert.equal(resources.length, 1);
        assert.equal(resources[0]!.released, true); assert.deepEqual(resources[0]!.proof, closed);
        assert.ok(absent(births[0].pid), 'original owned supervisor PID absent');
        if (closed.pids) for (const pid of closed.pids) assert.ok(absent(pid), 'owned descendant PID absent');
        const rows = await facts(prepared.identity, 'oar:observation:');
        const created = rows.filter(r => r.kind === 'created'); assert.equal(created.length, 1); createdNativeInstances += created.length;
        receivedNativeInputs += rows.filter(r => r.kind === 'received').length;
        if (prepared === childPrepared) assert.ok(rows.some(r => r.kind === 'event' && r.payload?.kind === 'tool_call_started'), 'actual child native tool invocation required');
        if (prepared === childPrepared) {
          const originalTerminal = rows.find(r => r.kind === 'terminal' && r.payload?.inputId === prepared.inputId);
          const questionTerminals = rows.filter(r => r.kind === 'terminal' && r.payload?.inputId === deliveryId);
          assert.ok(originalTerminal);
          assertBarrierOrder(busyProof,barrierRelease,busySend.message.createdAt,rows,originalTerminal);
          assert.ok(Date.parse(busySend.message.createdAt) < Date.parse(originalTerminal.time), 'human message persisted while original worker input was still busy; a raced post-terminal send fails');
          assert.equal(questionTerminals.length, 1);
          assert.equal(questionTerminals[0].payload.outcome.kind, 'completed', 'ordinary question must finish before physical closure');
          assert.ok(originalTerminal.seq < busyNative.seq, 'ordinary busy input waits for original native work boundary');
          assert.ok(busyNative.seq < questionTerminals[0].seq);
          assert.equal(rows.filter(r => r.seq > originalTerminal.seq && r.seq < questionTerminals[0].seq
            && r.kind === 'event' && r.payload?.kind === 'tool_call_started').length, 0, 'entire ordinary question interval cannot launch extra engineering tools, including before late OpenCode receive');
          assert.equal(rows.filter(r => r.seq > busyNative.seq && r.seq < questionTerminals[0].seq
            && r.kind === 'event' && r.payload?.kind === 'tool_call_started').length, 0, 'ordinary question cannot launch extra engineering tools');
        }

        const initialReceives = rows.filter(r => r.kind === 'received' && r.payload?.inputId === prepared.inputId);
        if (initialReceives.length === 0) {
          assert.equal(prepared, parent, 'only the original yielded leader may lack a completed ACP prompt response');
          assert.equal(prepared.runtime, 'opencode');
          assert.ok(rows.some(r => r.kind === 'control' && r.payload?.action === 'prompt_ack' && r.payload.inputId === prepared.inputId));
          assert.ok(parentReplies.some(r => r.ok === true && r.value?.state === 'accepted' && r.value?.delegationId === child.delegationId));
          assert.ok(parentReplies.some(r => r.ok === true && r.value?.state === 'yield-accepted'));
          acknowledgedYieldInputs++;
        } else assert.equal(initialReceives.length, 1);
        instances.push({ identity: prepared.identity, runtime: prepared.runtime, native: (await facts(prepared.identity, 'oar:native-session'))[0], birth: births[0], closed, createdAt: created[0].time });
      }
      assert.equal(receivedNativeInputs + acknowledgedYieldInputs, 4,
        'three proven engineering inputs plus one correlated ordinary question; no repeated engineering input');
      assert.ok(Date.parse(instances[0].closed.observedAt) <= Date.parse(instances[1].createdAt), 'parent physically closed before sole-capacity child creation');
      assert.ok(Date.parse(instances[1].closed.observedAt) <= Date.parse(instances[2].createdAt), 'child physically closed before successor creation');
      const view = await read(task); assert.equal(view.execution.resourceState, 'closed');
      assert.equal(view.execution.state,'succeeded','Only terminal Tasks may be cold-painted without new work');
      assert.ok(view.execution.tasks.some((row: any) => row.result?.identity.effectId === successor.identity.effectId), 'public authoritative result includes sourced successor');
      const originalWorkerReceived=(await facts(busyWorker.identity,'oar:observation:')).filter(r=>r.kind==='received'&&r.payload?.inputId===busyWorker.inputId);
      assert.equal(originalWorkerReceived.length,1);
      reports.push({ leaderRuntime, taskId: task.taskId, runId: task.currentRunId, deadlineAt, result: finalSnapshot.result,
        checkedChild: child.result, receipt, hostInputId: continuation.hostInputId, hostInputSha256: continuation.hostInputSha256,
        hostPrompt: continuation.hostPrompt, checkpointKind: continuation.context.kind, exactOriginalNativeIdRestored,
        instances, createdNativeInstances, receivedNativeInputs, acknowledgedYieldInputs,
        originalEngineeringInputs: receivedNativeInputs + acknowledgedYieldInputs - received.length - busyReceived.length, checkedResultInputs: received.length,
        busyInput: { message: busySend.message, delivery: busyDelivery, received: busyNative, nativeInput: sourceInput,
          barrier: { proof: busyProof, release: barrierRelease, deadlineAt, targetSha256: sha(JSON.stringify(frozenBusyTarget)), originalReceived: originalWorkerReceived[0], receiptClass: originalWorkerReceived[0].payload.evidence } },
        productModelRequests: 'unmeasured', productTokens: 'unmeasured' });
    }

    // Admission boundary: all three SDK instances per direction have already
    // produced physical closure evidence and absent owned PIDs above.
    const runIds=owned.map(task=>task.currentRunId);
    const beforePaint=await retainedInventory(home.h,runIds);
    const oldPgPid=Number((await readFile(path.join(home.h.home,'hima/database/data/postmaster.pid'),'utf8')).split('\n')[0]);
    // Close the independent observer while its original PostgreSQL is still up.
    // Native failures retain the original finally capture before scoped cancellation.
    try { await pgDiagnostics?.capture(runIds); }
    catch { reports.push({ diagnostics: 'observer-capture-failed' }); }
    try { await pgDiagnostics?.dispose(); }
    catch { reports.push({ diagnostics: 'observer-dispose-failed' }); }
    pgDiagnostics = undefined;
    await host.dispose(); hostClosed=true;
    assert.ok(absent(oldPgPid),'first owned PostgreSQL stopped before Electron launch');
    assert.equal(await readFile(path.join(home.h.home,'hima/database/data/postmaster.pid'),'utf8').then(()=>false,()=>true),true);
    // No Home copy, restore, fabricated response, new Task or repeated model request.
    // nativeLive is the proposed narrow helper option in helper-context.patch.
    browser=await bootTeamPlaywright(home.h,path.join(evidence,'cold-painted'),{nativeLive:true});
    const page=browser.page;let uiSessionId='';
    page.on('request',request=>{if(request.url().endsWith('/hima/api/teams')&&request.postData()){const value=JSON.parse(request.postData()!);if(value.sessionId)uiSessionId=value.sessionId;}});
    const click=async(control:string)=>page.locator(`[data-hima-control="${control}"]`).click();
    const remaining=()=>Math.max(1,540000-(Date.now()-startedAt));
    const post=async(request:unknown):Promise<any>=>{
      assert.ok(uiSessionId);
      return page.evaluate(`fetch('/hima/api/teams',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(${JSON.stringify({sessionId:uiSessionId,request})})}).then(async r=>{const v=await r.json();if(!r.ok)throw Error(JSON.stringify(v));return v})`);
    };
    await finishTeamOnboarding(browser,{providerConfigured:true});
    const registered=await page.evaluate<{result:{ok:boolean}}>(`fetch('/api/workspace/create',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId:'native-retained-workspace',method:'workspace/create',payload:{args:{request:{path:${JSON.stringify(home.h.workspace)}}}}})}).then(r=>r.json())`);
    assert.equal(registered.result.ok,true);
    await browser.wait(`!!document.querySelector('[role="treegrid"], [role="tree"]')`,remaining());
    const workspaceName=path.basename(home.h.workspace);
    await page.locator(`[data-row-key^="workspace:"]:has(span:text-is(${JSON.stringify(workspaceName)}))`).hover();
    await page.getByRole('button',{name:`New session in ${workspaceName}`,exact:true}).click();
    await browser.wait(`document.querySelector('[data-hima-control="open-workbench"]')?.disabled === false`,remaining());
    await click('open-workbench');await click('studio-mode-team');
    await browser.wait(`document.querySelector('[data-hima-control="team-title"]')?.disabled === false`,remaining());
    await waitUntil('cold Electron current conversation identity',()=>!!uiSessionId,Math.min(5000,remaining()));
    for(const report of reports.filter(row=>row.leaderRuntime)) {
      const task=owned.find(row=>row.taskId===report.taskId)!;
      const view=await post({action:'readTask',teamId:task.teamId,taskId:task.taskId});
      assert.equal(view.taskId,task.taskId);assert.equal(view.currentRunId,task.currentRunId);
      assert.deepEqual(view.runIds,[task.currentRunId]);assert.equal(view.projectId,report.result.identity.source.projectId);
      assert.equal(view.team.sha256,report.result.identity.source.team.sha256);
      assert.equal(view.execution.resourceState,'closed');assert.equal(view.execution.state,'succeeded');
      assert.deepEqual(view.execution.tasks.find((row:any)=>row.result?.identity.effectId===report.result.identity.effectId)?.result,report.result);
      await page.getByRole('button',{name:'Refresh teams',exact:true}).click();
      await browser.wait(`!!document.querySelector('select[aria-label="Saved team"]') && !document.querySelector('select[aria-label="Saved team"]').disabled`,remaining());
      await page.locator('select[aria-label="Saved team"]').selectOption(task.teamId);
      await browser.wait(`!!document.querySelector('[data-hima-control="team-task-${task.taskId}"]')`,remaining());await click(`team-task-${task.taskId}`);
      await browser.wait(`document.querySelector('[data-hima-region="himateam"]').dataset.himaStateTask === ${JSON.stringify(task.taskId)}`,remaining());
      const publicWork=[];
      for(const [memberId,role,runtime,result] of [
        ['lead','Research lead',report.leaderRuntime,report.result],
        ['worker','Independent calculator',report.leaderRuntime==='pi'?'opencode':'pi',report.checkedChild],
      ] as const) {
        const work=await post({action:'read-member-work',teamId:task.teamId,taskId:task.taskId,request:{memberId,page:{limit:100}}});
        assert.equal(work.taskId,task.taskId);assert.equal(work.memberId,memberId);
        assert.equal(work.connection,'disconnected');assert.equal(work.trace.state,'retained');
        const record=work.records.find((row:any)=>row.effectId===result.identity.effectId && row.result);
        const retained=beforePaint.results.find((row:any)=>row.effect_id===result.identity.effectId)!;
        assert.ok(record);assert.equal(record.runId,task.currentRunId);assert.equal(record.result.sha256,retained.result_sha256);
        assert.ok(record.result.text.includes('703'));publicWork.push(work);
        await page.getByRole('button',{name:role,exact:true}).click();
        await browser.wait(`document.querySelector('[data-hima-region="himateam"]').dataset.himaStateMember === ${JSON.stringify(memberId)}`,remaining());
        await page.getByRole('button',{name:'Refresh member work',exact:true}).click();
        await browser.wait(`document.querySelector('[data-hima-region="team-member-work"]')?.innerText.includes(${JSON.stringify(result.identity.effectId)}) && document.querySelector('[data-hima-region="team-member-work"]').innerText.includes(${JSON.stringify(retained.result_sha256)})`,remaining());
        const text=await page.evaluate<string>(`document.querySelector('[data-hima-region="team-member-work"]').innerText`);
        assert.ok(text.includes('703'));assert.ok(text.includes(task.currentRunId));assert.match(text,/retained/);
        if(memberId==='lead'){assert.ok(text.includes(report.checkedChild.identity.effectId));assert.ok(text.includes(view.team.sha256),'painted checked child source');}
        await writeFile(path.join(evidence,`${report.leaderRuntime}-${runtime}-${memberId}-painted.txt`),text);
        await page.evaluate(`document.querySelector('[data-hima-region="team-member-work"]').scrollIntoView({block:'start'})`);
        // Direct owned-page capture preserves the painted window between the four frames.
        await page.screenshot({path:path.join(evidence,`${report.leaderRuntime}-${runtime}-${memberId}-same-task.png`),fullPage:true,timeout:10000});
      }
      const activity=await post({action:'read-activity',teamId:task.teamId,taskId:task.taskId,request:{page:{limit:100}}});assert.equal(activity.taskId,task.taskId);
      await writeFile(path.join(evidence,`${report.leaderRuntime}-public-facts.json`),JSON.stringify({view,publicWork,activity},null,2));
      await page.getByRole('button',{name:'Back to team definition',exact:true}).click();
    }
    const afterPaint=await retainedInventory(home.h,runIds);
    assert.equal(afterPaint.clusterIdentity,beforePaint.clusterIdentity,'exact retained private cluster');
    assert.deepEqual(afterPaint.results,beforePaint.results,'cold UI did not change checked results or digests');
    assert.deepEqual(afterPaint.facts,beforePaint.facts,'zero new native births/receives during terminal Task cold paint');
    await writeFile(path.join(evidence,'cold-paint-identity.json'),JSON.stringify({beforePaint,afterPaint,productNewNativeInstances:0,
      composition:'same frozen source, Home, cluster, project, Task, Run, checked result digest; sequential Hosts to honor 2048MiB'},null,2));

    assert.ok(Date.now() - startedAt < 540000);
    testPassed = true;
  } catch (error) {
    originalFailure=error; hasOriginalFailure=true;
    // No Store/SDK/process probes here: these are the last actually observed
    // facts. A diagnostic write failure must never replace the original throw.
    try { await writeFile(path.join(evidence,'original-failure-boundary.json'),JSON.stringify({
      capturedAt:new Date().toISOString(),originalError:safeError(error),...failureBoundary,
      scope:'last observed test-owned readiness checks; no receipt or historical live-PID proof',
    },null,2),{flag:'wx',mode:0o600}); }
    catch { reports.push({diagnostics:'original-failure-boundary-write-failed'}); }
    throw error;
  } finally {
    try {
    // Retain the pre-cleanup error boundary before cancel changes authority.
    try { if (!hostClosed) await pgDiagnostics?.capture(owned.map(task => task.currentRunId)); }
    catch { reports.push({ diagnostics: 'observer-capture-failed' }); }
    try { await pgDiagnostics?.dispose(); }
    catch { reports.push({ diagnostics: 'observer-dispose-failed' }); }
    // Never convert unknown physical closure into successful teardown or discard
    // its home. Human control operates only Tasks created by this test.
    for (const task of hostClosed ? [] : owned) {
      try {
        let view = await read(task);
        if (view.execution.resourceState !== 'closed') {
          await service.teamOperation(sessionId, { action: 'control', teamId: task.teamId, taskId: task.taskId, request: {
            requestId: 'cleanup-' + task.taskId.slice(-40), action: 'cancel', expectedEpoch: view.execution.epoch, expectedRevision: view.execution.revision,
          } }, 'human');
          await waitUntil('scoped native cancellation physically closes owned resources', async () => (await read(task)).execution.resourceState === 'closed', 15000, 250);
          view = await read(task);
        }
        reports.push({ teardown: task.taskId, resourceState: view.execution.resourceState });
      } catch (error) { cleanupProved = false; reports.push({ teardown: task.taskId, closure: 'unknown', reason: error instanceof Error ? error.message : String(error) }); }
    }
    if(!hostClosed) await host.dispose();
    if(browser) await browser.dispose();
    await writeFile(path.join(evidence, 'collaboration-results.json'), JSON.stringify({ reports, elapsedMs: Date.now() - startedAt,
      cleanupProved, scope: 'Actual native MCP/model collaboration then exact retained sameTask Electron UI; one root-session human busy-worker input; no root Guide model question, simultaneous live-native GUI, T20, Linux or human UI qualification' }, null, 2));
    if (cleanupProved && testPassed) await home.h.dispose();
    assert.ok(cleanupProved, 'Unknown owned-resource closure requires preserved Home and operator reconciliation');
    } catch (cleanupError) {
      // Cleanup errors still fail a successful case; after an original failure
      // they cannot replace its exception. Fatal process OOM is not catchable.
      if (hasOriginalFailure) throw originalFailure;
      throw cleanupError;
    }
  }
});
