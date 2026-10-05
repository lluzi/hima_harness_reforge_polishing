// PLS-19: actual Host tool context; no model call or Electron.
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { HimaErrorBody, RecordsView } from '@hima/harness';
import { localHome, waitUntil } from './support/fabric.ts';
import { bootInProcess, createRootAgent } from './support/boot-inprocess.ts';
import { timingProbePackId } from './support/pack.ts';

process.env.HIMA_TEST_LEGACY_AUTO_DRIVE = '0';
process.env.HIMA_TEST_SILENT_AGENT = '1';

async function closeInProcessRun(host: Awaited<ReturnType<typeof bootInProcess>>, runId: string): Promise<void> {
  await host.ctx.hima.cancelRun(runId);
  await waitUntil('public cancellation proves actual resource closure', async () => {
    const context = await host.ctx.hima.readExecutionContext(runId);
    return (context.run as typeof context.run & { stopState?: { closed: boolean } }).stopState?.closed === true;
  }, 30_000, 25);
  const facts = await host.ctx.hima.durable.store.flowPhysicalFacts(runId);
  for (const effect of facts.effects) {
    const receipt = await host.ctx.hima.durable.store.effectFact(effect.identity.effectId, 'submitted') as { session?: string } | undefined;
    if (receipt?.session) assert.equal(spawnSync('tmux', ['has-session', '-t', `=${receipt.session}`], { timeout: 5000 }).status, 1,
      'every PG-recorded submitted Job session is physically absent before disposal');
  }
  console.info('fixture-resource-closure', JSON.stringify({ runId, surface: 'in-process', publicClosed: true, pgEffects: facts.effects.length, pgResources: facts.resources.length, unreleasedResources: facts.resources.filter(resource => !resource.released).length, submittedSessionsAbsent: true }));
}

async function closeNativeRun(host: import('./support/boot-host.ts').BootedHost, cookie: string, guide: string, runId: string): Promise<void> {
  const { api } = await import('./support/hima-api.ts');
  const read = async () => {
    const response = await api(host, cookie, `/hima/api/runs/${runId}/context?sessionId=${guide}`);
    assert.equal(response.status, 200);
    return response.json() as Promise<{ run: { control: { epoch: number; revision: number }; stopState?: { closed: boolean } } }>;
  };
  const context = await read();
  const response = await api(host, cookie, `/hima/api/runs/${runId}/control`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'cancel', sessionId: guide, expectedEpoch: context.run.control.epoch,
      expectedRevision: context.run.control.revision, requestId: 'fixture-close' }) });
  assert.equal(response.status, 200, await response.text());
  await waitUntil('native public cancellation proves actual resource closure', async () => (await read()).run.stopState?.closed === true, 30_000, 25);
  const records = await api(host, cookie, `/hima/api/runs/${runId}/records?type=job&sessionId=${guide}`);
  assert.equal(records.status, 200);
  const jobs = (await records.json() as RecordsView).records;
  for (const record of jobs) if (record.type === 'job' && record.event === 'launched') {
    assert.equal(spawnSync('tmux', ['has-session', '-t', `=${record.job.session}`], { timeout: 5000 }).status, 1,
      'PG-projected submitted Job session is physically absent before native Host disposal');
  }
  console.info('fixture-resource-closure', JSON.stringify({ runId, surface: 'native', publicClosed: true, submittedSessions: [...new Set(jobs.filter(record => record.type === 'job' && record.event === 'launched').map(record => record.type === 'job' ? record.job.session : ''))], submittedSessionsAbsent: true }));
}

test('hima_run prepares for the actual calling Agent and returns the same conversation context', async (t) => {
  const local = await localHome(t, { sleepSeconds: 0 });
  assert.ok(local);
  const host = await bootInProcess(local.h);
  let runId: string | undefined;
  try {
    const agent = await createRootAgent(host.ctx, local.h.workspace);
    const prepared = await host.ctx.tools.execute({ callId: 'prepare-owned' as never, name: 'hima_prepare', arguments: { pack: timingProbePackId, site: 'local' }, agent, signal: AbortSignal.timeout(30000) });
    const proposal = JSON.parse(prepared.content.filter((item) => item.type === 'text').map((item) => item.text).join(''));
    const result = await host.ctx.tools.execute({ callId: 'start-owned' as never, name: 'hima_run', arguments: {
      proposalId: proposal.id, pack: timingProbePackId, site: 'local', goal: proposal.goal, strategy: proposal.strategy,
    }, agent, signal: AbortSignal.timeout(30000) });
    assert.equal(result.isError, false, JSON.stringify(result));
    const value = JSON.parse(result.content.filter((item) => item.type === 'text').map((item) => item.text).join(''));
    assert.equal(value.kind, 'preparing');
    runId = value.runId;
    assert.equal(value.context.run.id, runId);
    assert.notEqual(value.context.run.control.owner, String(agent.id));
    assert.equal(value.context.run.control.guideSessionId, String(agent.id));
    await waitUntil('public context proves original workspace preparation', async () => {
      const context = await host.ctx.hima.readExecutionContext(runId!);
      return context.durable?.preparation?.kind === 'prepared' || context.durable?.preparation?.kind === 'reused';
    });
    const context = await host.ctx.hima.readExecutionContext(runId!);
    assert.equal(context.run.control?.owner, value.context.run.control.owner);
    assert.equal(context.run.control?.guideSessionId, String(agent.id));
    assert.equal(context.engine, 'dbos/5.2.11');
    assert.ok(context.method, 'prepared public context retains its frozen method');
  } finally {
    try { if (runId) await closeInProcessRun(host, runId); }
    finally { await host.dispose(); await local.h.dispose(); }
  }
});


test('controlled tools derive ownership, deduplicate admission, and refuse legacy mutation bypasses', async (t) => {
  const local = await localHome(t, { sleepSeconds: 0 });
  assert.ok(local);
  const host = await bootInProcess(local.h);
  let runId: string | undefined;
  try {
    const guide = await createRootAgent(host.ctx, local.h.workspace);
    const other = await createRootAgent(host.ctx, local.h.workspace);
    let serial = 0;
    let owner = guide;
    const call = (name: string, args: object, agent = owner) => host.ctx.tools.execute({ callId: `tool-${++serial}` as never, name, arguments: args, agent, signal: AbortSignal.timeout(30000) });
    const value = (result: Awaited<ReturnType<typeof call>>) => {
      assert.equal(result.isError, false, JSON.stringify(result));
      return JSON.parse(result.content.filter((item) => item.type === 'text').map((item) => item.text).join(''));
    };
    const schemas = host.ctx.tools.schemas();
    const execute = schemas.find((schema) => schema.name === 'hima_execute');
    assert.ok(execute);
    assert.ok(!JSON.stringify(execute.parameters).includes('"actor"'), 'the model cannot fill in actor');
    assert.ok(!JSON.stringify(execute.parameters).includes('"origin"'), 'the model cannot claim authenticated human origin');
    assert.ok(!JSON.stringify(execute.parameters).includes('measure-value'), 'the Agent cannot write human-effort evidence');
    assert.ok(!JSON.stringify(execute.parameters).includes('"begin"'), 'DBOS owns automatic mechanical admission');
    const proposal = value(await call('hima_prepare', { pack: timingProbePackId, site: 'local' }));
    const started = value(await call('hima_run', { proposalId: proposal.id, pack: timingProbePackId, site: 'local', goal: proposal.goal, strategy: proposal.strategy }));
    runId = started.runId;
    assert.equal(started.kind, 'preparing');
    const run = started.runId;
    await waitUntil('actual public preparation before controlled actions', async () => {
      const context = value(await call('hima_context', { run }, guide));
      return context.facts.workspace !== undefined;
    });
    const prepared = value(await call('hima_context', { run }, guide));
    owner = host.ctx.get('agents')!.get(prepared.run.control.owner as never)!;
    assert.ok(owner);
    assert.notEqual(String(owner.id), String(guide.id));
    assert.equal(prepared.run.control.guideSessionId, String(guide.id));
    const request = { run, action: 'pause', expectedEpoch: prepared.run.control.epoch,
      expectedRevision: prepared.run.control.revision, requestId: 'first-control' };
    const controlsBefore = (await host.ctx.hima.durable.store.flowProjection(run)).controls;
    const denied = value(await call('hima_execute', request, other));
    assert.equal(denied.kind, 'refused');
    assert.equal(denied.context.run.control.revision, request.expectedRevision);
    assert.deepEqual((await host.ctx.hima.durable.store.flowProjection(run)).controls, controlsBefore);
    const forged = await call('hima_execute', { ...request, actor: String(owner.id), origin: 'human' }, other);
    if (!forged.isError) assert.equal(value(forged).kind, 'refused');
    const afterForged = value(await call('hima_context', { run }, guide));
    assert.equal(afterForged.run.control.revision, request.expectedRevision);
    assert.deepEqual((await host.ctx.hima.durable.store.flowProjection(run)).controls, controlsBefore);
    const paused = value(await call('hima_execute', request));
    assert.equal(paused.kind, 'accepted');
    assert.deepEqual(paused.context.run.control.paused, ['*']);
    const controls = (await host.ctx.hima.durable.store.flowProjection(run)).controls;
    const physicalBefore = await host.ctx.hima.durable.store.flowPhysicalFacts(run);
    const submittedParents = physicalBefore.effects.filter(effect => effect.dispatches.some(dispatch => dispatch.dispatchId === 'submit'));
    const dispatchIdentities = async (facts: typeof physicalBefore) => {
      const collecting = new Set<string>();
      for (const parent of submittedParents) for (const derived of await host.ctx.hima.durable.store.derivedEffects(parent.identity)) {
        if (derived.purpose === 'collect') collecting.add(derived.identity.effectId);
      }
      return facts.effects.filter(effect => !collecting.has(effect.identity.effectId)).flatMap(effect => effect.dispatches.map(dispatch => ({
        effectId: effect.identity.effectId, dispatchId: dispatch.dispatchId, inputSha256: dispatch.inputSha256,
      }))).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
    };
    const dispatchedBefore = await dispatchIdentities(physicalBefore);
    const repeated = value(await call('hima_execute', request));
    assert.equal(repeated.kind, 'duplicate');
    assert.deepEqual(repeated.receipt, paused.receipt, 'identical content returns the original receipt');
    assert.deepEqual((await host.ctx.hima.durable.store.flowProjection(run)).controls, controls, 'retry adds no control command');
    const changed = value(await call('hima_execute', { ...request, action: 'continue' }));
    assert.equal(changed.kind, 'refused');
    assert.match(changed.reason, /different|reused|identity/i);
    assert.deepEqual((await host.ctx.hima.durable.store.flowProjection(run)).controls, controls);
    const agentMeasurement = await host.ctx.hima.executionAction({ runId: run, actor: String(owner.id), origin: 'agent',
      action: 'measure-value', expectedEpoch: paused.context.run.control.epoch, expectedRevision: paused.context.run.control.revision,
      requestId: 'agent-human-time', measurement: { category: 'business-decision', startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(), evidenceRef: 'forged' } });
    assert.equal(agentMeasurement.kind, 'refused', 'human measurement rejects an Agent-origin request');
    assert.match(agentMeasurement.reason!, /authenticated human/);
    const context = value(await call('hima_context', { run }, other));
    assert.equal(context.run.control.owner, String(owner.id), 'same-project read does not rebind ownership');
    assert.equal(context.run.control.guideSessionId, String(guide.id));
    assert.deepEqual((await host.ctx.hima.durable.store.flowProjection(run)).controls, controls);
    assert.equal((await call('hima_cancel', { run })).isError, true, 'legacy direct cancellation is refused');
    const observedBefore = context.facts.observations;
    assert.equal((await call('hima_observe', { run, site: 'local', path: 'anything' })).isError, true, 'legacy direct observation is refused');
    const forgedMeasurement = await call('hima_execute', { ...request, action: 'measure-value', actor: String(owner.id), origin: 'human',
      measurement: { category: 'business-decision', startedAt: new Date().toISOString(), endedAt: new Date().toISOString(), evidenceRef: 'forged' } });
    assert.equal(forgedMeasurement.isError, true, 'model schema cannot claim human measurement or origin');
    const resume = value(await call('hima_resume', { run }));
    assert.equal(resume.kind, 'unresumable');
    const coding = await call('write', { file_path: 'ordinary-coding.txt', content: 'ordinary coding remains available' }, guide);
    assert.equal(coding.isError, false, JSON.stringify(coding));
    const after = value(await call('hima_context', { run }, guide));
    assert.equal(after.run.control.owner, String(owner.id));
    assert.equal(after.run.control.revision, paused.context.run.control.revision);
    assert.deepEqual((await host.ctx.hima.durable.store.flowProjection(run)).controls, controls);
    assert.deepEqual(after.facts.observations, observedBefore, 'refused observation creates no evidence');
    assert.deepEqual(await dispatchIdentities(await host.ctx.hima.durable.store.flowPhysicalFacts(run)), dispatchedBefore,
      'refused and repeated calls add no admitted business dispatch; undispatched intents and collection of original submissions may progress');
    const historical = await host.ctx.hima.ledger.createRun({ campaignId: 'legacy-without-method', siteId: 'local' });
    const historicalBefore = host.ctx.hima.ledger.records({ runId: historical.id });
    const adoption = await call('hima_execute', { run: historical.id, action: 'adopt', expectedEpoch: 0, expectedRevision: 0, requestId: 'inspect-adoption' });
    assert.equal(adoption.isError, true, 'unassigned history cannot be claimed by selecting an arbitrary project');
    assert.equal(host.ctx.hima.ledger.run(historical.id)?.control, undefined);
    assert.deepEqual(host.ctx.hima.ledger.records({ runId: historical.id }), historicalBefore);
  } finally {
    try { if (runId) await closeInProcessRun(host, runId); }
    finally { await host.dispose(); await local.h.dispose(); }
  }
});

test('native preparation validates a live selected session and exposes durable control without rebinding on read', async (t) => {
  const local = await localHome(t, { sleepSeconds: 0 });
  assert.ok(local);
  const { bootHimaHost } = await import('./support/boot-host.ts');
  const { api, openSession } = await import('./support/hima-api.ts');
  const host = await bootHimaHost(local.h);
  let runId: string | undefined;
  let guide: string | undefined;
  let cookie: string | undefined;
  try {
    cookie = await openSession(host);
    const sessionResponse = await api(host, cookie, '/api/session/create', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'hima-native-owner', method: 'session/create', payload: { args: { request: { cwd: local.h.workspace } } } }),
    });
    const native = await sessionResponse.json() as { result: { ok: boolean; value: { sessionId: string } } };
    assert.equal(native.result.ok, true, JSON.stringify(native));
    const owner = native.result.value.sessionId;
    guide = owner;
    const post = (route: string, body: object) => api(host, cookie!, `/hima/api${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const input = { pack: timingProbePackId, site: 'local', goal: { target_period_ns: 2 } };
    assert.equal((await post('/runs/start', input)).status, 400);
    assert.equal((await post('/runs/start', { ...input, sessionId: 'session-forged' })).status, 400);
    const empty = await api(host, cookie, `/hima/api/runs?sessionId=${owner}`);
    assert.deepEqual(await empty.json(), { runs: [] });
    const choicesResponse = await api(host, cookie, `/hima/api/start-options?pack=${timingProbePackId}&site=local`);
    const choices = await choicesResponse.json() as { proposal: { id: string; goal: Record<string, number>; strategy: Record<string, number | string> } };
    const prepared = await post('/runs/start', { ...input, proposalId: choices.proposal.id, goal: choices.proposal.goal,
      strategy: choices.proposal.strategy, sessionId: owner });
    const preparedText = await prepared.text();
    assert.equal(prepared.status, 200, preparedText);
    const view = JSON.parse(preparedText);
    runId = view.run.id;
    assert.notEqual(view.run.control.owner, owner);
    assert.equal(view.run.control.guideSessionId, owner);
    assert.equal(view.jobs.length, 0);
    await waitUntil('native original workspace is prepared before control', async () => {
      const response = await api(host, cookie!, `/hima/api/runs/${view.run.id}/context?sessionId=${owner}`);
      assert.equal(response.status, 200);
      const context = await response.json();
      const records = await api(host, cookie!, `/hima/api/runs/${view.run.id}/records?type=workspace&sessionId=${owner}`);
      return (await records.json() as RecordsView).records.some(record => record.type === 'workspace' && (record.event === 'prepared' || record.event === 'reused'));
    });
    const context = await api(host, cookie, `/hima/api/runs/${view.run.id}/context?sessionId=${owner}`);
    assert.equal(context.status, 200);
    const contextBody = await context.json() as { run: { control: { owner: string; guideSessionId?: string; epoch: number; revision: number } } };
    assert.equal(contextBody.run.control.owner, view.run.control.owner);
    assert.equal(contextBody.run.control.guideSessionId, owner);
    const moment = await post(`/runs/${view.run.id}/moment?sessionId=${owner}`, { instructions: 'inspect this Run' });
    const momentBody = await moment.json() as HimaErrorBody;
    assert.equal(moment.status, 409, JSON.stringify(momentBody));
    assert.equal(momentBody.error.code, 'hima/run-not-in-state');
    assert.match(momentBody.error.message, /controlled by its conversation Agent/);
    const sessions = await api(host, cookie, `/hima/api/runs/${view.run.id}/records?type=session&sessionId=${owner}`);
    assert.deepEqual((await sessions.json() as RecordsView).records, [], 'a policy refusal opens no separate model session');
    const pauseRequest = { action: 'pause', sessionId: owner, expectedEpoch: contextBody.run.control.epoch, expectedRevision: contextBody.run.control.revision, requestId: 'human-pause' };
    const paused = await post(`/runs/${view.run.id}/control`, pauseRequest);
    const pausedBody = await paused.json() as { run: { run: { control: { owner: string; guideSessionId?: string; paused: string[]; epoch: number; revision: number } }; valueMeasurement: { human: unknown } }; notification: { status: string; message: string } };
    assert.equal(paused.status, 200, JSON.stringify(pausedBody));
    assert.equal(pausedBody.run.run.control.owner, view.run.control.owner);
    assert.equal(pausedBody.run.run.control.guideSessionId, owner);
    assert.deepEqual(pausedBody.run.run.control.paused, ['*']);
    assert.equal(pausedBody.notification.status, 'not-requested');
    assert.match(pausedBody.notification.message, /did not request/i);
    const repeatedPause = await post(`/runs/${view.run.id}/control`, pauseRequest);
    const repeatedBody = await repeatedPause.json() as { notification: { status: string; message: string } };
    assert.equal(repeatedPause.status, 200, JSON.stringify(repeatedBody));
    assert.equal(repeatedBody.notification.status, 'not-requested');
    assert.equal((await post(`/runs/${view.run.id}/cancel`, {})).status, 403, 'unscoped mutation is denied before Run details are inspected');
    assert.equal((await post(`/runs/${view.run.id}/control`, { action: 'work', sessionId: owner, expectedEpoch: 1, expectedRevision: 0, requestId: 'human-work' })).status, 400);
    const measurementContextResponse = await api(host, cookie, `/hima/api/runs/${view.run.id}/context?sessionId=${owner}`);
    assert.equal(measurementContextResponse.status, 200);
    const measurementContext = await measurementContextResponse.json() as typeof contextBody;
    const malformedMeasurement = await post(`/runs/${view.run.id}/control`, { action: 'measure-value', sessionId: owner,
      expectedEpoch: measurementContext.run.control.epoch, expectedRevision: measurementContext.run.control.revision,
      requestId: 'human-value-malformed', measurement: { category: 'business-decision' } });
    assert.equal(malformedMeasurement.status, 409, await malformedMeasurement.text());
    const currentResponse = await api(host, cookie, `/hima/api/runs/${view.run.id}/context?sessionId=${owner}`);
    assert.equal(currentResponse.status, 200);
    const current = await currentResponse.json() as typeof contextBody;
    const startedAt = view.run.createdAt;
    const endedAt = new Date().toISOString();
    const measuredMs = Date.parse(endedAt) - Date.parse(startedAt);
    const measurementRequest = { action: 'measure-value', sessionId: owner,
      expectedEpoch: current.run.control.epoch, expectedRevision: current.run.control.revision, requestId: 'human-value-business',
      measurement: { category: 'business-decision', startedAt, endedAt, evidenceRef: 'stopwatch:host-test' } };
    const measured = await post(`/runs/${view.run.id}/control`, measurementRequest);
    const measuredBody = await measured.json() as { run: { valueMeasurement: { human: { businessDecisionTime: unknown; controlRequests: unknown } } } };
    console.info('authenticated-human-measurement', JSON.stringify({ runId: view.run.id, guideSessionId: owner,
      campaignOwner: current.run.control.owner, request: measurementRequest, status: measured.status, body: measuredBody,
      expectedMeasuredValue: { status: 'measured', value: measuredMs, unit: 'ms',
        sources: ['run.control.requests.human-value-business', 'stopwatch:host-test'],
        claimLimit: 'Explicit human stopwatch segments only; Campaign wall and wait time are excluded.' } }));
    assert.equal(measured.status, 200, JSON.stringify(measuredBody));
    assert.deepEqual(measuredBody.run.valueMeasurement.human.businessDecisionTime, {
      status: 'measured', value: measuredMs, unit: 'ms', sources: ['run.control.requests.human-value-business', 'stopwatch:host-test'],
      claimLimit: 'Explicit human stopwatch segments only; Campaign wall and wait time are excluded.',
    });
    assert.equal((await post(`/runs/${view.run.id}/control`,{...measurementRequest,requestId:'measurement-before-run',measurement:{...measurementRequest.measurement,startedAt:new Date(Date.parse(startedAt)-1).toISOString()}})).status,409);
    assert.equal((await post(`/runs/${view.run.id}/control`,{...measurementRequest,requestId:'measurement-future',measurement:{...measurementRequest.measurement,endedAt:new Date(Date.now()+60000).toISOString()}})).status,409);
    assert.equal((await post(`/runs/${view.run.id}/control`,{...measurementRequest,action:'pause'})).status,409,'a control cannot reuse a human measurement identity');
    const expectedHumanControls={status:'measured',value:2,unit:'count',sources:['run.control.requests.human-pause','run.control.requests.human-value-business']};
    assert.deepEqual(measuredBody.run.valueMeasurement.human.controlRequests,expectedHumanControls);
    const afterMeasurementResponse=await api(host,cookie,`/hima/api/runs/${view.run.id}/context?sessionId=${owner}`);
    const afterMeasurement=await afterMeasurementResponse.json() as typeof current;
    assert.equal(afterMeasurement.run.control.epoch,current.run.control.epoch);
    assert.equal(afterMeasurement.run.control.revision,current.run.control.revision);
    const recorded=afterMeasurement.run.control as typeof current.run.control & {requests:Record<string,unknown>};
    const originalReceipt=recorded.requests['human-value-business'];
    const duplicate=await post(`/runs/${view.run.id}/control`,measurementRequest);
    assert.equal(duplicate.status,200);
    const duplicateBody=await duplicate.json() as typeof measuredBody;
    assert.deepEqual(duplicateBody.run.valueMeasurement.human.businessDecisionTime,measuredBody.run.valueMeasurement.human.businessDecisionTime);
    assert.equal((await post(`/runs/${view.run.id}/control`,{...measurementRequest,measurement:{...measurementRequest.measurement,evidenceRef:'stopwatch:changed'}})).status,409);
    assert.equal((await post(`/runs/${view.run.id}/control`,{...measurementRequest,requestId:'measurement-stale-epoch',expectedEpoch:current.run.control.epoch+1})).status,409);
    assert.equal((await post(`/runs/${view.run.id}/control`,{...measurementRequest,requestId:'measurement-stale-revision',expectedRevision:current.run.control.revision+1})).status,409);
    const {createLiveSession}=await import('./support/hima-api.ts');
    const foreign=await createLiveSession(host,cookie,local.h.workspace);
    assert.equal((await post(`/runs/${view.run.id}/control`,{...measurementRequest,sessionId:foreign,requestId:'measurement-foreign'})).status,409);
    const finalContext=await (await api(host,cookie,`/hima/api/runs/${view.run.id}/context?sessionId=${owner}`)).json() as typeof afterMeasurement;
    assert.deepEqual((finalContext.run.control as typeof recorded).requests,recorded.requests,'duplicates and rejected requests cannot replace raw human provenance');
    console.info('human-measurement-retained-provenance',JSON.stringify({runId:runId,request:originalReceipt}));
    await host.stop();
    runId=undefined;
    const restarted=await bootHimaHost(local.h);
    const restartedCookie=await openSession(restarted);
    const restartedViewer=await createLiveSession(restarted,restartedCookie,local.h.workspace);
    try {
      const restored=await api(restarted,restartedCookie,`/hima/api/runs/${view.run.id}?sessionId=${restartedViewer}`);
      assert.equal(restored.status,200,await restored.clone().text());
      const restoredBody=await restored.json() as typeof measuredBody['run'];
      assert.deepEqual(restoredBody.valueMeasurement.human.businessDecisionTime,measuredBody.run.valueMeasurement.human.businessDecisionTime);
      assert.deepEqual(restoredBody.valueMeasurement.human.controlRequests,expectedHumanControls);
      const restoredContext=await (await api(restarted,restartedCookie,`/hima/api/runs/${view.run.id}/context?sessionId=${restartedViewer}`)).json() as typeof finalContext;
      assert.deepEqual((restoredContext.run.control as typeof recorded).requests['human-value-business'],originalReceipt);
      assert.deepEqual((restoredContext.run.control as typeof recorded).requests,recorded.requests,'both command and stopwatch provenance survive restart unchanged');
      console.info('human-measurement-restart-proof',JSON.stringify({runId:view.run.id,measurement:restoredBody.valueMeasurement.human.businessDecisionTime,controlRequests:restoredBody.valueMeasurement.human.controlRequests,request:(restoredContext.run.control as typeof recorded).requests['human-value-business']}));
    } finally {
      try {await closeNativeRun(restarted,restartedCookie,restartedViewer,view.run.id);}
      finally {await restarted.stop();}
    }
    assert.equal(contextBody.run.control.revision, 0);
  } finally {
    try { if (runId && cookie && guide) await closeNativeRun(host, cookie, guide, runId); }
    finally { await host.stop(); await local.h.dispose(); }
  }
});

test('a prepared DBOS product Run refuses standalone moments through its authorized public route', async (t) => {
  const local = await localHome(t, { sleepSeconds: 0 });
  assert.ok(local);
  const { bootHimaHost } = await import('./support/boot-host.ts');
  const { api, openSession } = await import('./support/hima-api.ts');
  const host = await bootHimaHost(local.h);
  let runId: string | undefined;
  let guide: string | undefined;
  let cookie: string | undefined;
  try {
    cookie = await openSession(host);
    const sessionResponse = await api(host, cookie, '/api/session/create', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'hima-native-owner', method: 'session/create', payload: { args: { request: { cwd: local.h.workspace } } } }),
    });
    const native = await sessionResponse.json() as { result: { ok: boolean; value: { sessionId: string } } };
    assert.equal(native.result.ok, true, JSON.stringify(native));
    const owner = native.result.value.sessionId;
    guide = owner;
    const post = (route: string, body: object) => api(host, cookie!, `/hima/api${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const input = { pack: timingProbePackId, site: 'local', goal: { target_period_ns: 2 } };
    assert.equal((await post('/runs/start', input)).status, 400);
    assert.equal((await post('/runs/start', { ...input, sessionId: 'session-forged' })).status, 400);
    const empty = await api(host, cookie, `/hima/api/runs?sessionId=${owner}`);
    assert.deepEqual(await empty.json(), { runs: [] });
    const choicesResponse = await api(host, cookie, `/hima/api/start-options?pack=${timingProbePackId}&site=local`);
    const choices = await choicesResponse.json() as { proposal: { id: string; goal: Record<string, number>; strategy: Record<string, number | string> } };
    const prepared = await post('/runs/start', { ...input, proposalId: choices.proposal.id, goal: choices.proposal.goal,
      strategy: choices.proposal.strategy, sessionId: owner });
    const preparedText = await prepared.text();
    assert.equal(prepared.status, 200, preparedText);
    const view = JSON.parse(preparedText);
    runId = view.run.id;
    assert.notEqual(view.run.control.owner, owner);
    assert.equal(view.run.control.guideSessionId, owner);
    assert.equal(view.jobs.length, 0);
    await waitUntil('the accepted Run has durably prepared its original workspace', async () => {
      const response = await api(host, cookie!, `/hima/api/runs/${view.run.id}/records?type=workspace&sessionId=${owner}`);
      assert.equal(response.status, 200);
      const value = await response.json() as RecordsView;
      return value.records.some(record => record.type === 'workspace' && (record.event === 'prepared' || record.event === 'reused'));
    });
    const context = await api(host, cookie, `/hima/api/runs/${view.run.id}/context?sessionId=${owner}`);
    assert.equal(context.status, 200);
    const contextBody = await context.json() as { run: { control: { owner: string; guideSessionId?: string; epoch: number; revision: number } } };
    assert.equal(contextBody.run.control.owner, view.run.control.owner);
    assert.equal(contextBody.run.control.guideSessionId, owner);
    const moment = await post(`/runs/${view.run.id}/moment?sessionId=${owner}`, { instructions: 'inspect this Run' });
    const momentBody = await moment.json() as HimaErrorBody;
    assert.equal(moment.status, 409, JSON.stringify(momentBody));
    assert.equal(momentBody.error.code, 'hima/run-not-in-state');
    assert.match(momentBody.error.message, /controlled by its conversation Agent/);
    const sessions = await api(host, cookie, `/hima/api/runs/${view.run.id}/records?type=session&sessionId=${owner}`);
    assert.deepEqual((await sessions.json() as RecordsView).records, [], 'a policy refusal opens no separate model session');
  } finally {
    try { if (runId && cookie && guide) await closeNativeRun(host, cookie, guide, runId); }
    finally { await host.stop(); await local.h.dispose(); }
  }
});
