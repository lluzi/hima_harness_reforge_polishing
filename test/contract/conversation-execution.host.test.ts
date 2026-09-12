// PLS-19: actual Host tool context; no model call or Electron.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localHome } from './support/fabric.ts';
import { bootInProcess, createRootAgent } from './support/boot-inprocess.ts';
import { timingProbePackId } from './support/pack.ts';

test('hima_run prepares for the actual calling Agent and returns the same conversation context', async (t) => {
  const local = await localHome(t, { sleepSeconds: 0 });
  assert.ok(local);
  const host = await bootInProcess(local.h);
  try {
    const agent = await createRootAgent(host.ctx, local.h.workspace);
    const result = await host.ctx.tools.execute({ callId: 'prepare-owned' as never, name: 'hima_run', arguments: { pack: timingProbePackId, site: 'local', goal: { target_period_ns: 2 }, generations: 1 }, agent, signal: AbortSignal.timeout(30000) });
    assert.equal(result.isError, false, JSON.stringify(result));
    const run = host.ctx.hima.ledger.runs()[0];
    assert.equal(run?.control?.owner, String(agent.id));
    assert.equal(host.ctx.hima.ledger.records({ runId: run!.id, type: 'job' }).length, 0);
    assert.equal(host.ctx.hima.ledger.records({ runId: run!.id, type: 'session' }).length, 0);
    const text = result.content.filter((item) => item.type === 'text').map((item) => item.text).join('');
    const value = JSON.parse(text);
    assert.equal(value.context.run.control.owner, String(agent.id));
    assert.ok(value.context.available.includes(run!.currentNode));
  } finally { await host.dispose(); await local.h.dispose(); }
});


test('controlled tools derive ownership, deduplicate admission, and refuse legacy mutation bypasses', async (t) => {
  const local = await localHome(t, { sleepSeconds: 0 });
  assert.ok(local);
  const host = await bootInProcess(local.h);
  try {
    const owner = await createRootAgent(host.ctx, local.h.workspace);
    const other = await createRootAgent(host.ctx, local.h.workspace);
    let serial = 0;
    const call = (name: string, args: object, agent = owner) => host.ctx.tools.execute({ callId: `tool-${++serial}` as never, name, arguments: args, agent, signal: AbortSignal.timeout(30000) });
    const value = (result: Awaited<ReturnType<typeof call>>) => {
      assert.equal(result.isError, false, JSON.stringify(result));
      return JSON.parse(result.content.filter((item) => item.type === 'text').map((item) => item.text).join(''));
    };
    const schemas = host.ctx.tools.schemas();
    const execute = schemas.find((schema) => schema.name === 'hima_execute');
    assert.ok(execute);
    assert.ok(!JSON.stringify(execute.parameters).includes('"actor"'), 'the model cannot fill in actor');
    const started = value(await call('hima_run', { pack: timingProbePackId, site: 'local', goal: { target_period_ns: 2 }, generations: 1 }));
    const run = started.runId;
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
    const input = { pack: timingProbePackId, site: 'local', goal: { target_period_ns: 2 }, generations: 1 };
    assert.equal((await post('/runs/start', input)).status, 400);
    assert.equal((await post('/runs/start', { ...input, sessionId: 'session-forged' })).status, 400);
    const empty = await api(host, cookie, '/hima/api/runs');
    assert.deepEqual(await empty.json(), { runs: [] });
    const prepared = await post('/runs/start', { ...input, sessionId: owner });
    const preparedText = await prepared.text();
    assert.equal(prepared.status, 200, preparedText);
    const view = JSON.parse(preparedText);
    assert.equal(view.run.control.owner, owner);
    assert.equal(view.jobs.length, 0);
    const context = await api(host, cookie, `/hima/api/runs/${view.run.id}/context`);
    assert.equal(context.status, 200);
    const contextBody = await context.json() as { run: { control: { owner: string; revision: number } } };
    assert.equal(contextBody.run.control.owner, owner);
    assert.equal((await post(`/runs/${view.run.id}/cancel`, {})).status, 400);
    assert.equal((await post(`/runs/${view.run.id}/control`, { action: 'work', sessionId: owner, expectedEpoch: 1, expectedRevision: 0, requestId: 'human-work' })).status, 400);
    assert.equal(contextBody.run.control.revision, 0);
  } finally { await host.stop(); await local.h.dispose(); }
});
