// PLS-19: actual Host tool context; no model call or Electron.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { HimaErrorBody, RecordsView } from '@hima/harness';
import { localHome } from './support/fabric.ts';
import { bootInProcess, createRootAgent } from './support/boot-inprocess.ts';
import { timingProbePackId } from './support/pack.ts';

process.env.HIMA_TEST_LEGACY_AUTO_DRIVE = '0';
process.env.HIMA_TEST_SILENT_AGENT = '1';

test('hima_run prepares for the actual calling Agent and returns the same conversation context', async (t) => {
  const local = await localHome(t, { sleepSeconds: 0 });
  assert.ok(local);
    const host = await bootInProcess(local.h);
  try {
    const agent = await createRootAgent(host.ctx, local.h.workspace);
    const prepared = await host.ctx.tools.execute({ callId: 'prepare-owned' as never, name: 'hima_prepare', arguments: { pack: timingProbePackId, site: 'local' }, agent, signal: AbortSignal.timeout(30000) });
    const proposal = JSON.parse(prepared.content.filter((item) => item.type === 'text').map((item) => item.text).join(''));
    const result = await host.ctx.tools.execute({ callId: 'start-owned' as never, name: 'hima_run', arguments: {
      proposalId: proposal.id, pack: timingProbePackId, site: 'local', goal: proposal.goal, strategy: proposal.strategy,
    }, agent, signal: AbortSignal.timeout(30000) });
    assert.equal(result.isError, false, JSON.stringify(result));
    const run = host.ctx.hima.ledger.runs()[0];
    assert.notEqual(run?.control?.owner, String(agent.id));
    assert.equal(run?.control?.guideSessionId, String(agent.id));
    assert.equal(host.ctx.hima.ledger.records({ runId: run!.id, type: 'job' }).length, 0);
    assert.equal(host.ctx.hima.ledger.records({ runId: run!.id, type: 'session' }).length, 0);
    const text = result.content.filter((item) => item.type === 'text').map((item) => item.text).join('');
    const value = JSON.parse(text);
    assert.equal(value.context.run.control.owner, run?.control?.owner);
    assert.equal(value.context.run.control.guideSessionId, String(agent.id));
    assert.ok(value.context.available.includes(run!.currentNode));
  } finally { await host.dispose(); await local.h.dispose(); }
});


test('controlled tools derive ownership, deduplicate admission, and refuse legacy mutation bypasses', async (t) => {
  const local = await localHome(t, { sleepSeconds: 0 });
  assert.ok(local);
  const host = await bootInProcess(local.h);
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
    assert.ok(!JSON.stringify(execute.parameters).includes('measure-value'), 'the Agent cannot write human-effort evidence');
    const proposal = value(await call('hima_prepare', { pack: timingProbePackId, site: 'local' }));
    const started = value(await call('hima_run', { proposalId: proposal.id, pack: timingProbePackId, site: 'local', goal: proposal.goal, strategy: proposal.strategy }));
    const run = started.runId;
    owner = host.ctx.get('agents')!.get(started.context.run.control.owner as never)!;
    assert.notEqual(String(owner.id), String(guide.id));
    assert.equal(started.context.run.control.guideSessionId, String(guide.id));
    const request = { run, action: 'begin', nodeId: started.context.run.currentNode, expectedEpoch: 1, expectedRevision: 0, requestId: 'first-admission' };
    const denied = value(await call('hima_execute', request, other));
    assert.equal(denied.kind, 'refused');
    assert.equal(denied.context.run.control.revision, 0);
    const forged = await call('hima_execute', { ...request, actor: String(owner.id), origin: 'human' }, other);
    if (!forged.isError) assert.equal(value(forged).kind, 'refused');
    const begun = value(await call('hima_execute', request));
    assert.equal(begun.kind, 'accepted');
    const repeated = value(await call('hima_execute', request));
    assert.equal(repeated.kind, 'duplicate');
    assert.equal(repeated.receipt.executionId, begun.receipt.executionId);
    const agentMeasurement = await host.ctx.hima.executionAction({ runId: run, actor: String(owner.id), origin: 'agent',
      action: 'measure-value', expectedEpoch: 1, expectedRevision: 1, requestId: 'agent-human-time',
      measurement: { category: 'business-decision', startedAt: new Date().toISOString(), endedAt: new Date().toISOString(), evidenceRef: 'forged' } });
    assert.equal(agentMeasurement.kind, 'refused');
    assert.match(agentMeasurement.reason ?? '', /authenticated human/);
    const context = value(await call('hima_context', { run }, other));
    assert.equal(context.run.control.owner, String(owner.id), 'reading in another conversation does not rebind the Run');
    assert.equal(context.run.control.revision, 1);
    assert.deepEqual(context.facts.jobs, []);
    assert.deepEqual(context.facts.observations, []);
    for (const [name, args] of [['hima_observe', { run, site: 'local', path: 'anything' }], ['hima_cancel', { run }]] as const) {
      assert.equal((await call(name, args)).isError, true, name);
    }
    const resume = value(await call('hima_resume', { run }));
    assert.equal(resume.kind, 'unresumable');
    assert.equal(host.ctx.hima.ledger.records({ runId: run, type: 'job' }).length, 0);
    assert.equal(host.ctx.hima.ledger.records({ runId: run, type: 'observation' }).length, 0);
    const coding = await call('write', { file_path: 'ordinary-coding.txt', content: 'ordinary coding remains available' });
    assert.equal(coding.isError, false, JSON.stringify(coding));
    assert.equal(host.ctx.hima.ledger.run(run)?.control?.revision, 1);
    const historical = await host.ctx.hima.ledger.createRun({ campaignId: 'legacy-without-method', siteId: 'local' });
    const adoption = await call('hima_execute', { run: historical.id, action: 'adopt', expectedEpoch: 0, expectedRevision: 0, requestId: 'inspect-adoption' });
    assert.equal(adoption.isError, true, 'unassigned history cannot be claimed by selecting an arbitrary project');
    assert.equal(host.ctx.hima.ledger.run(historical.id)?.control, undefined);
  } finally { await host.dispose(); await local.h.dispose(); }
});

test('native preparation validates a live selected session and exposes durable control without rebinding on read', async (t) => {
  const local = await localHome(t, { sleepSeconds: 0 });
  assert.ok(local);
  const { bootHimaHost } = await import('./support/boot-host.ts');
  const { api, openSession } = await import('./support/hima-api.ts');
  const host = await bootHimaHost(local.h);
  try {
    const cookie = await openSession(host);
    const sessionResponse = await api(host, cookie, '/api/session/create', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'hima-native-owner', method: 'session/create', payload: { args: { request: { cwd: local.h.workspace } } } }),
    });
    const native = await sessionResponse.json() as { result: { ok: boolean; value: { sessionId: string } } };
    assert.equal(native.result.ok, true, JSON.stringify(native));
    const owner = native.result.value.sessionId;
    const post = (route: string, body: object) => api(host, cookie, `/hima/api${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
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
    assert.notEqual(view.run.control.owner, owner);
    assert.equal(view.run.control.guideSessionId, owner);
    assert.equal(view.jobs.length, 0);
    const context = await api(host, cookie, `/hima/api/runs/${view.run.id}/context?sessionId=${owner}`);
    assert.equal(context.status, 200);
    const contextBody = await context.json() as { run: { control: { owner: string; guideSessionId?: string; revision: number } } };
    assert.equal(contextBody.run.control.owner, view.run.control.owner);
    assert.equal(contextBody.run.control.guideSessionId, owner);
    const moment = await post(`/runs/${view.run.id}/moment?sessionId=${owner}`, { instructions: 'inspect this Run' });
    const momentBody = await moment.json() as HimaErrorBody;
    assert.equal(moment.status, 409, JSON.stringify(momentBody));
    assert.equal(momentBody.error.code, 'hima/run-not-in-state');
    assert.match(momentBody.error.message, /controlled by its conversation Agent/);
    const sessions = await api(host, cookie, `/hima/api/runs/${view.run.id}/records?type=session&sessionId=${owner}`);
    assert.deepEqual((await sessions.json() as RecordsView).records, [], 'a policy refusal opens no separate model session');
    const pauseRequest = { action: 'pause', sessionId: owner, expectedEpoch: 1, expectedRevision: 0, requestId: 'human-pause' };
    const paused = await post(`/runs/${view.run.id}/control`, pauseRequest);
    const pausedBody = await paused.json() as { run: { run: { control: { owner: string; guideSessionId?: string; paused: string[] } } }; notification: { status: string; message: string } };
    assert.equal(paused.status, 200, JSON.stringify(pausedBody));
    assert.equal(pausedBody.run.run.control.owner, view.run.control.owner);
    assert.equal(pausedBody.run.run.control.guideSessionId, owner);
    assert.deepEqual(pausedBody.run.run.control.paused, ['*']);
    assert.equal(pausedBody.notification.status, 'inactive');
    assert.match(pausedBody.notification.message, /control fact is recorded/i);
    const repeatedPause = await post(`/runs/${view.run.id}/control`, pauseRequest);
    const repeatedBody = await repeatedPause.json() as { notification: { status: string; message: string } };
    assert.equal(repeatedPause.status, 200, JSON.stringify(repeatedBody));
    assert.equal(repeatedBody.notification.status, 'not-repeated');
    assert.match(repeatedBody.notification.message, /original delivery outcome is not durable/i);
    const malformedMeasurement = await post(`/runs/${view.run.id}/control`, { action: 'measure-value', sessionId: owner,
      expectedEpoch: 1, expectedRevision: 1, requestId: 'human-value-malformed', measurement: { category: 'business-decision' } });
    assert.equal(malformedMeasurement.status, 409, await malformedMeasurement.text());
    const startedAt = view.run.createdAt;
    const endedAt = new Date().toISOString();
    const measuredMs = Date.parse(endedAt) - Date.parse(startedAt);
    const measured = await post(`/runs/${view.run.id}/control`, { action: 'measure-value', sessionId: owner,
      expectedEpoch: 1, expectedRevision: 1, requestId: 'human-value-business',
      measurement: { category: 'business-decision', startedAt, endedAt, evidenceRef: 'stopwatch:host-test' } });
    const measuredBody = await measured.json() as { run: { valueMeasurement: { human: { businessDecisionTime: unknown } } } };
    assert.equal(measured.status, 200, JSON.stringify(measuredBody));
    assert.deepEqual(measuredBody.run.valueMeasurement.human.businessDecisionTime, {
      status: 'measured', value: measuredMs, unit: 'ms', sources: ['run.control.requests.human-value-business', 'stopwatch:host-test'],
      claimLimit: 'Explicit human stopwatch segments only; Campaign wall and wait time are excluded.',
    });
    assert.equal((await post(`/runs/${view.run.id}/cancel`, {})).status, 403, 'unscoped mutation is denied before Run details are inspected');
    assert.equal((await post(`/runs/${view.run.id}/control`, { action: 'work', sessionId: owner, expectedEpoch: 1, expectedRevision: 0, requestId: 'human-work' })).status, 400);
    assert.equal(contextBody.run.control.revision, 0);
  } finally { await host.stop(); await local.h.dispose(); }
});
