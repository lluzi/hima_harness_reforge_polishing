import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { readGuideContext, readNativeSessionContext } from '@hima/harness';
import { localHome } from './support/fabric.ts';
import { bootInProcess, createRootAgent } from './support/boot-inprocess.ts';
import { timingProbePackId } from './support/pack.ts';

process.env.HIMA_TEST_LEGACY_AUTO_DRIVE = '0';
process.env.HIMA_TEST_SILENT_AGENT = '1';

test('Guide context resolves exact project targets without changing ownership or creating work', async t => {
  const home = await localHome(t, { sleepSeconds: 0.01 });
  assert.ok(home);
  const host = await bootInProcess(home.h);
  try {
    const owner = await createRootAgent(host.ctx, home.h.workspace);
    const viewer = await createRootAgent(host.ctx, home.h.workspace);
    await assert.rejects(readNativeSessionContext(host.ctx,{sessionId:String(viewer.id),targetSessionId:String(owner.id)},host.ctx.hima.ledger),{code:'hima/not-authorized'},'same workspace does not grant unrelated root transcript access');
    const ownHistory=await readNativeSessionContext(host.ctx,{sessionId:String(owner.id),targetSessionId:String(owner.id)},host.ctx.hima.ledger);
    assert.equal(ownHistory.sessionId,String(owner.id));
    const otherPath = path.join(home.h.workspace, 'other-project');
    await mkdir(otherPath);
    const other = await createRootAgent(host.ctx, otherPath);
    const started = await host.ctx.hima.startRun({ pack: timingProbePackId, site: 'local', goal: { target_period_ns: 2 }, ownerSessionId: String(owner.id) });
    assert.equal(started.kind, 'ran');
    if (started.kind !== 'ran') return;
    const deps = { ctx: host.ctx, ledger: host.ctx.hima.ledger,
      executionContext: (runId: string) => host.ctx.hima.executionContext(runId),
      readExperience: (runId: string) => host.ctx.hima.readExperience(runId) };
    const target = { kind: 'run', runId: started.run.id };
    const request = { sessionId: String(viewer.id), requestId: 'inspect-1', target };
    const before = host.ctx.hima.ledger.records({ runId: started.run.id }).length;
    const view = await readGuideContext(deps, request);
    assert.deepEqual(view.target, target);
    assert.equal('ownedRun' in view ? view.ownedRun : undefined, undefined);
    assert.deepEqual(view.sources, [started.run.id]);
    assert.equal(host.ctx.hima.ledger.run(started.run.id)?.control?.owner, String(owner.id));
    await assert.rejects(readGuideContext(deps, { ...request, sessionId: String(other.id) }), { code: 'hima/not-authorized' });
    await assert.rejects(readGuideContext(deps, { ...request, target: { kind: 'node', runId: started.run.id, nodeId: started.run.currentNode } }), { code: 'hima/invalid-view-address' });
    await assert.rejects(readGuideContext(deps, { ...request, target: { kind: 'node', runId: started.run.id, nodeId: started.run.currentNode, generation: 99 } }), { code: 'hima/context-stale' });
    assert.equal(host.ctx.hima.ledger.records({ runId: started.run.id }).length, before);
    for (const name of ['hima_context', 'hima_status', 'hima_resume', 'hima_cancel']) {
      const denied = await host.ctx.tools.execute({ callId: `foreign-${name}` as never, name,
        arguments: { run: started.run.id }, agent: other, signal: AbortSignal.timeout(5000) });
      assert.equal(denied.isError, true, name);
      assert.doesNotMatch(JSON.stringify(denied.content), new RegExp(String(owner.id)), 'foreign error does not expose owner');
    }
    const command = await host.ctx.commands.execute(other, `/hima status ${started.run.id}`, [], AbortSignal.timeout(5000));
    assert.equal(command?.result.kind, 'error');
    assert.doesNotMatch(command?.result.text ?? '', new RegExp(String(owner.id)));
    assert.equal(host.ctx.hima.ledger.runs().length, 1);
  } finally { await host.dispose(); await home.h.dispose(); }
});

test('public Run routes enforce the selected project before returning data or applying control', async t => {
  const home = await localHome(t, { sleepSeconds: 0 });
  assert.ok(home);
  const { bootHimaHost } = await import('./support/boot-host.ts');
  const { api, createLiveSession, openSession } = await import('./support/hima-api.ts');
  const host = await bootHimaHost(home.h);
  try {
    const cookie = await openSession(host);
    const viewer = await createLiveSession(host, cookie, home.h.workspace);
    const foreignRoot = path.join(home.h.workspace, 'foreign');
    await mkdir(foreignRoot);
    const foreign = await createLiveSession(host, cookie, foreignRoot);
    const post = (route: string, body: object) => api(host, cookie, `/hima/api${route}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    const choices = await (await api(host, cookie, `/hima/api/start-options?pack=${timingProbePackId}&site=local`)).json() as any;
    const started = await post('/runs/start', { sessionId: viewer, proposalId: choices.proposal.id,
      pack: timingProbePackId, site: 'local', goal: choices.proposal.goal, strategy: choices.proposal.strategy });
    assert.equal(started.status, 200, await started.clone().text());
    const view = await started.json() as any;
    const runId = view.run.id;
    const scoped = (route: string, sessionId: string) => `${route}${route.includes('?') ? '&' : '?'}sessionId=${encodeURIComponent(sessionId)}`;
    const recordsRoute = `/hima/api/runs/${runId}/records`;
    const before = await (await api(host, cookie, scoped(recordsRoute, viewer))).json() as any;
    assert.ok(before.records.length > 0);
    for (const route of [`/hima/api/runs/${runId}`, recordsRoute, `/hima/api/runs/${runId}/context`,
      `/hima/api/runs/${runId}/assets`, `/hima/api/runs/${runId}/experience`,
      `/hima/api/runs/${runId}/experience.md`, `/hima/api/runs/${runId}/material/${encodeURIComponent(before.records[0].id)}`,
      `/hima/api/runs/${runId}/log-tail?node=${view.run.currentNode}`, `/hima/api/records/${encodeURIComponent(before.records[0].id)}`]) {
      const denied = await api(host, cookie, scoped(route, foreign));
      assert.equal(denied.status, 403, `${route}: ${await denied.text()}`);
    }
    assert.equal((await api(host, cookie, `/hima/api/runs/${runId}`)).status, 403, 'no implicit global viewer');
    const hidden = await (await api(host, cookie, scoped('/hima/api/runs', foreign))).json();
    assert.deepEqual(hidden, { runs: [] });
    const visible = await (await api(host, cookie, scoped('/hima/api/runs', viewer))).json() as any;
    assert.deepEqual(visible.runs.map((r: any) => r.id), [runId]);
    const denied = await post(`/runs/${runId}/control`, { sessionId: foreign, action: 'pause',
      requestId: 'foreign-pause', expectedEpoch: 1, expectedRevision: 0 });
    assert.equal(denied.status, 403, await denied.text());
    assert.equal((await post('/observe', { sessionId: foreign, run: runId, site: 'local', path: 'any.rpt' })).status, 403);
    const after = await (await api(host, cookie, scoped(recordsRoute, viewer))).json();
    assert.deepEqual(after, before, 'refused foreign requests leave no Run mutations or new evidence');
    const ownerView = await (await api(host, cookie, scoped(`/hima/api/runs/${runId}`, viewer))).json() as any;
    assert.equal(ownerView.run.control.owner, view.run.control.owner);
    assert.equal(ownerView.run.control.revision, 0);
    const controlBody = {sessionId:viewer,expectedEpoch:1,expectedRevision:0,requestId:'human-guide-pause',action:'pause'};
    assert.equal((await post(`/runs/${runId}/control`,controlBody)).status,200,'Guide forwards an explicit human pause to its independent owner');
    const held = await (await api(host,cookie,scoped(`/hima/api/runs/${runId}`,viewer))).json() as any;
    assert.deepEqual(held.run.control.paused,['*']);
    assert.equal((await post(`/runs/${runId}/control`,{...controlBody,action:'continue',requestId:'stale-guide-continue'})).status,409);
    assert.equal((await post(`/runs/${runId}/control`,{...controlBody,action:'continue',requestId:'current-guide-continue',expectedRevision:held.run.control.revision})).status,200);
    const continued = await (await api(host,cookie,scoped(`/hima/api/runs/${runId}`,viewer))).json() as any;
    assert.deepEqual(continued.run.control.paused,[]);assert.equal(continued.run.control.owner,view.run.control.owner);
    assert.equal(continued.run.control.requests['current-guide-continue'].origin,'human');

    assert.equal((await api(host, cookie, '/hima/api/audit')).status, 403);
    assert.equal((await post('/audit/drain', {})).status, 403, 'a project viewer cannot drain global diagnostic evidence');
    for (const headers of [{}, {'x-hima-desktop-control':'0'.repeat(64)}]) {
      const exit = await api(host,cookie,'/hima/api/lifecycle/exit',{method:'POST',
        headers:{'content-type':'application/json',...headers},
        body:JSON.stringify({requestId:'untrusted-app-exit',mode:'stop-jobs'})});
      assert.equal(exit.status,403,'a browser session cookie cannot stop every project Job');
    }
  } finally { assert.equal(await host.stop(), 0, host.stderr()); await home.h.dispose(); }
});


test('standalone preparation retains its originating project for later reads', async t => {
  const home = await localHome(t, { sleepSeconds: 0 }); assert.ok(home);
  const host = await bootInProcess(home.h);
  try {
    const { himaCommand } = await import('./support/command.ts');
    const viewer = await createRootAgent(host.ctx, home.h.workspace);
    const prepared = await himaCommand(host, home.h.workspace, `/hima pack prepare ${timingProbePackId} --site local`, 20000, viewer);
    assert.equal(prepared.kind, 'success', prepared.text);
    assert.ok(prepared.runId);
    assert.equal(host.ctx.hima.ledger.run(prepared.runId)?.projectSessionId, String(viewer.id));
    const read = await himaCommand(host, home.h.workspace, `/hima status ${prepared.runId}`, 5000, viewer);
    assert.equal(read.kind, 'success', read.text);
  } finally { await host.dispose(); await home.h.dispose(); }
});
