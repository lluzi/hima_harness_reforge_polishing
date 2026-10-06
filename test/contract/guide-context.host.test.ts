import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { readGuideContext, readNativeSessionContext } from '@hima/harness';
import { localHome, waitUntil } from './support/fabric.ts';
import { bootInProcess, createRootAgent, type InProcessHost } from './support/boot-inprocess.ts';
import { timingProbePackId } from './support/pack.ts';

process.env.HIMA_TEST_LEGACY_AUTO_DRIVE = '0';
process.env.HIMA_TEST_SILENT_AGENT = '1';

async function preparedContext(host: InProcessHost, runId: string) {
  await waitUntil('the admitted Run has its public preparation fact', async () => {
    const context = await host.ctx.hima.readExecutionContext(runId);
    return ['prepared', 'reused'].includes(context.durable?.preparation?.kind ?? '');
  }, 30_000, 25);
  return host.ctx.hima.readExecutionContext(runId);
}

async function closeRun(host: InProcessHost, runId: string) {
  const sessions = new Set<string>();
  const collect = async () => {
    for (const effect of (await host.ctx.hima.durable.store.flowPhysicalFacts(runId)).effects) {
      const receipt = await host.ctx.hima.durable.store.effectFact(effect.identity.effectId, 'submitted') as { session?: string } | undefined;
      if (receipt?.session) sessions.add(receipt.session);
    }
  };
  try {
    await collect();
    await host.ctx.hima.cancelRun(runId);
    await waitUntil('the fixture Run has actual resource closure proof', async () => {
      const context = await host.ctx.hima.readExecutionContext(runId);
      return (context.run as typeof context.run & { stopState?: { closed: boolean } }).stopState?.closed === true;
    }, 30_000, 25);
    await collect();
    for (const session of sessions) assert.equal(spawnSync('tmux', ['has-session', '-t', `=${session}`], { timeout: 5000 }).status, 1,
      'the PG-recorded fixture Job is absent before Host/Home disposal');
  } finally {
    // Emergency cleanup is limited to this fixture's actual submitted Jobs. It cannot turn a
    // missing closure proof into a passing assertion.
    for (const session of sessions) spawnSync('tmux', ['kill-session', '-t', `=${session}`], { timeout: 5000 });
  }
}

test('Guide context resolves exact project targets without changing ownership or creating work', async t => {
  const home = await localHome(t, { sleepSeconds: 0.01 });
  assert.ok(home);
  const host = await bootInProcess(home.h);
  let runId: string | undefined;
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
    assert.equal(started.kind, 'preparing');
    if (started.kind !== 'preparing') throw new Error('durable admission unavailable');
    runId = started.run.id;
    const prepared = await preparedContext(host, runId);
    assert.equal(prepared.run.control?.owner, String(owner.id));
    const control = prepared.run.control!;
    // Hold physical dispatch while proving the reads do not introduce work. Ordinary DBOS
    // projection progress is independent of a read and is not compared as a whole snapshot.
    await host.ctx.hima.controlDurableRun({ runId, commandId: 'fixture-read-hold', action: 'pause',
      owner: control.owner, epoch: control.epoch, revision: control.revision });
    const held = await host.ctx.hima.readExecutionContext(runId);
    assert.deepEqual(held.run.control?.paused, ['*']);
    const deps = { ctx: host.ctx, ledger: host.ctx.hima.ledger,
      readRun: async (id: string) => (await host.ctx.hima.readExecutionContext(id)).run,
      executionContext: (id: string) => host.ctx.hima.readExecutionContext(id),
      readExperience: (id: string) => host.ctx.hima.readExperience(id) };
    const target = { kind: 'run', runId };
    const request = { sessionId: String(viewer.id), requestId: 'inspect-1', target };
    const originalSubmitted = (await host.ctx.hima.durable.store.flowPhysicalFacts(runId)).effects
      .filter(effect => effect.dispatches.some(dispatch => dispatch.dispatchId === 'submit'));
    const boundary = async () => {
      const context = await host.ctx.hima.readExecutionContext(runId!);
      const collecting = new Set<string>();
      for (const parent of originalSubmitted) for (const derived of await host.ctx.hima.durable.store.derivedEffects(parent.identity))
        if (derived.purpose === 'collect') collecting.add(derived.identity.effectId);
      assert.ok(context.durable);
      return { runs: (await host.ctx.hima.durable.store.runs()).map(run => run.runId),
        owner: context.run.control?.owner, epoch: context.run.control?.epoch, revision: context.run.control?.revision,
        commands: context.durable.controls,
        dispatches: context.durable.effects.filter(effect => !collecting.has(effect.identity.effectId))
          .flatMap(effect => effect.dispatches.map(dispatch => ({ effectId: effect.identity.effectId, ...dispatch }))) };
    };
    const before = await boundary();
    const view = await readGuideContext(deps, request);
    assert.deepEqual(view.target, target);
    assert.equal('ownedRun' in view ? view.ownedRun : undefined, undefined);
    assert.deepEqual(view.sources, [runId]);
    const nodeId = held.nodes[0]!.id;
    const generation = held.run.generation;
    assert.ok(typeof generation === 'number');
    const nodeTarget = { kind: 'node', runId, nodeId, generation };
    assert.deepEqual((await readGuideContext(deps, { ...request, target: nodeTarget })).target, nodeTarget);
    await assert.rejects(readGuideContext(deps, { ...request, sessionId: String(other.id) }), { code: 'hima/not-authorized' });
    await assert.rejects(readGuideContext(deps, { ...request, target: { kind: 'node', runId, nodeId } }), { code: 'hima/invalid-view-address' });
    await assert.rejects(readGuideContext(deps, { ...request, target: { ...nodeTarget, generation: generation + 99 } }), { code: 'hima/context-stale' });
    for (const name of ['hima_context', 'hima_status', 'hima_resume', 'hima_cancel']) {
      const denied = await host.ctx.tools.execute({ callId: `foreign-${name}` as never, name,
        arguments: { run: runId }, agent: other, signal: AbortSignal.timeout(5000) });
      assert.equal(denied.isError, true, name);
      assert.doesNotMatch(JSON.stringify(denied.content), new RegExp(String(owner.id)), 'foreign error does not expose owner');
    }
    const command = await host.ctx.commands.execute(other, `/hima status ${runId}`, [], AbortSignal.timeout(5000));
    assert.equal(command?.result.kind, 'error');
    assert.doesNotMatch(command?.result.text ?? '', new RegExp(String(owner.id)));
    assert.deepEqual(await boundary(), before, 'Guide reads and refused foreign calls create no Run, control command, or physical effect dispatch');
    assert.deepEqual(before.runs, [runId]);
  } finally {
    try { if (runId) await closeRun(host, runId); }
    finally { await host.dispose(); await home.h.dispose(); }
  }
});

test('public Run routes enforce the selected project before returning data or applying control', async t => {
  const home = await localHome(t, { sleepSeconds: 0 });
  assert.ok(home);
  const { bootHimaHost } = await import('./support/boot-host.ts');
  const { api, createLiveSession, openSession } = await import('./support/hima-api.ts');
  const host = await bootHimaHost(home.h);
  let runId: string | undefined;
  let viewer: string | undefined;
  let cookie: string | undefined;
  let database: { query(sql: string, values?: unknown[]): Promise<{ rows: any[] }>; end(): Promise<void> } | undefined;
  const scoped = (route: string, sessionId: string) => `${route}${route.includes('?') ? '&' : '?'}sessionId=${encodeURIComponent(sessionId)}`;
  const post = (route: string, body: object) => api(host, cookie!, `/hima/api${route}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const read = async (route: string) => {
    const response = await api(host, cookie!, scoped(`/hima/api${route}`, viewer!));
    assert.equal(response.status, 200, await response.clone().text());
    return response.json() as Promise<any>;
  };
  try {
    // This query-only connection observes the actual Host's application authority; it does
    // not boot or adopt a second database. Private credentials never enter output.
    const credentials = JSON.parse(await readFile(path.join(home.h.home, 'hima/database/credentials.json'), 'utf8'));
    const { Pool } = createRequire(new URL('../../packages/harness/package.json', import.meta.url))('pg');
    database = new Pool({ host: '127.0.0.1', port: credentials.port, user: credentials.user,
      password: credentials.password, database: 'hima_application', options: '-c default_transaction_read_only=on' });
    cookie = await openSession(host);
    viewer = await createLiveSession(host, cookie, home.h.workspace);
    const foreignRoot = path.join(home.h.workspace, 'foreign');
    await mkdir(foreignRoot);
    const foreign = await createLiveSession(host, cookie, foreignRoot);
    const choices = await (await api(host, cookie, `/hima/api/start-options?pack=${timingProbePackId}&site=local`)).json() as any;
    const started = await post('/runs/start', { sessionId: viewer, proposalId: choices.proposal.id,
      pack: timingProbePackId, site: 'local', goal: choices.proposal.goal, strategy: choices.proposal.strategy });
    assert.equal(started.status, 200, await started.clone().text());
    const admission = await started.json() as any;
    runId = admission.run.id;
    assert.ok(runId);
    let preparedRecord: any;
    await waitUntil('the HTTP Run retains its specific prepared workspace record', async () => {
      const records = await read(`/runs/${runId}/records`);
      preparedRecord = records.records.find((record: any) => record.type === 'workspace' && ['prepared', 'reused'].includes(record.event));
      return !!preparedRecord;
    }, 30_000, 25);
    const context = await read(`/runs/${runId}/context`);
    const owner = context.run.control.owner;
    assert.notEqual(owner, viewer, 'Guide and Campaign retain independent ownership');
    assert.equal(context.run.control.guideSessionId, viewer);
    const controlBody = { sessionId: viewer, expectedEpoch: context.run.control.epoch,
      expectedRevision: context.run.control.revision, requestId: 'human-guide-pause', action: 'pause' };
    assert.equal((await post(`/runs/${runId}/control`, controlBody)).status, 200, 'Guide forwards an explicit human pause to its independent owner');
    const held = await read(`/runs/${runId}/context`);
    assert.deepEqual(held.run.control.paused, ['*']);
    const submittedParents = (await database!.query("SELECT d.effect_id FROM hima.effect_dispatches d JOIN hima.effects e USING(effect_id) WHERE e.run_id=$1 AND d.dispatch_id='submit' ORDER BY d.effect_id", [runId])).rows.map(row => row.effect_id);
    const boundary = async () => {
      const current = await read(`/runs/${runId}/context`);
      const collecting = (await database!.query(`WITH RECURSIVE descendants AS (
        SELECT d.* FROM hima.flow_derived_effects d WHERE d.run_id=$1 AND d.parent_effect_id=ANY($2::text[])
        UNION ALL SELECT d.* FROM hima.flow_derived_effects d JOIN descendants p ON d.parent_effect_id=p.child_effect_id WHERE d.run_id=$1)
        SELECT child_effect_id FROM descendants WHERE purpose='collect'`, [runId, submittedParents])).rows.map(row => row.child_effect_id);
      const control = current.run.control;
      return { control: { owner: control.owner, guideSessionId: control.guideSessionId,
          epoch: control.epoch, revision: control.revision, paused: control.paused },
        commands: (await database!.query('SELECT command FROM hima.commands WHERE run_id=$1 ORDER BY command_id', [runId])).rows,
        dispatches: (await database!.query('SELECT d.effect_id,d.dispatch_id,d.input_sha256 FROM hima.effect_dispatches d JOIN hima.effects e USING(effect_id) WHERE e.run_id=$1 AND NOT(d.effect_id=ANY($2::text[])) ORDER BY d.effect_id,d.dispatch_id', [runId, collecting])).rows,
        runs: (await read('/runs')).runs.map((run: any) => run.id) };
    };
    const before = await boundary();
    const recordsRoute = `/hima/api/runs/${runId}/records`;
    for (const route of [`/hima/api/runs/${runId}`, recordsRoute, `/hima/api/runs/${runId}/context`,
      `/hima/api/runs/${runId}/assets`, `/hima/api/runs/${runId}/experience`,
      `/hima/api/runs/${runId}/experience.md`, `/hima/api/runs/${runId}/material/${encodeURIComponent(preparedRecord.id)}`,
      `/hima/api/runs/${runId}/log-tail?node=${encodeURIComponent(context.nodes[0].id)}`, `/hima/api/records/${encodeURIComponent(preparedRecord.id)}`]) {
      for (const address of [scoped(route, foreign), route]) {
        const denied = await api(host, cookie, address);
        const body = await denied.text();
        assert.equal(denied.status, 403, `${address}: ${body}`);
        assert.doesNotMatch(body, new RegExp(owner), 'refused route does not disclose Campaign owner');
      }
    }
    const hidden = await (await api(host, cookie, scoped('/hima/api/runs', foreign))).json();
    assert.deepEqual(hidden, { runs: [] });
    assert.deepEqual((await read('/runs')).runs.map((run: any) => run.id), [runId]);
    const denied = await post(`/runs/${runId}/control`, { ...controlBody, sessionId: foreign,
      requestId: 'foreign-pause', expectedRevision: held.run.control.revision });
    const deniedBody = await denied.text();
    assert.equal(denied.status, 403, deniedBody);
    assert.doesNotMatch(deniedBody, new RegExp(owner));
    const observation = await post('/observe', { sessionId: foreign, run: runId, site: 'local', path: 'any.rpt' });
    const observationBody = await observation.text();
    assert.equal(observation.status, 403, observationBody);
    assert.doesNotMatch(observationBody, new RegExp(owner));
    assert.deepEqual(await boundary(), before, 'foreign/no-session reads and denied control create no Run, accepted command, or Job launch');
    assert.equal((await post(`/runs/${runId}/control`, { ...controlBody, action: 'continue', requestId: 'stale-guide-continue' })).status, 409);
    assert.equal((await post(`/runs/${runId}/control`, { ...controlBody, action: 'continue', requestId: 'stale-revision-guide-continue', expectedEpoch: held.run.control.epoch, expectedRevision: held.run.control.revision + 1 })).status, 409, 'a current epoch cannot bypass a stale revision');
    const currentContinue = await post(`/runs/${runId}/control`, { ...controlBody, action: 'continue', requestId: 'current-guide-continue', expectedEpoch: held.run.control.epoch, expectedRevision: held.run.control.revision });
    assert.equal(currentContinue.status, 200, await currentContinue.clone().text());
    const continued = await read(`/runs/${runId}/context`);
    assert.deepEqual(continued.run.control.paused, []);
    assert.equal(continued.run.control.owner, owner);
    const continuedCommand = (await database!.query('SELECT command FROM hima.commands WHERE run_id=$1 AND command_id=$2', [runId, 'current-guide-continue'])).rows[0]?.command;
    assert.equal(continuedCommand?.origin, 'human', 'human origin is retained in the actual PG command, rather than historical Ledger requests');
    assert.equal(continuedCommand?.actor, viewer);
    assert.equal(continuedCommand?.owner, owner);
    assert.equal((await api(host, cookie, '/hima/api/audit')).status, 403);
    assert.equal((await post('/audit/drain', {})).status, 403, 'a project viewer cannot drain global diagnostic evidence');
    for (const headers of [{}, {'x-hima-desktop-control':'0'.repeat(64)}]) {
      const exit = await api(host,cookie,'/hima/api/lifecycle/exit',{method:'POST',
        headers:{'content-type':'application/json',...headers},
        body:JSON.stringify({requestId:'untrusted-app-exit',mode:'stop-jobs'})});
      assert.equal(exit.status,403,'a browser session cookie cannot stop every project Job');
    }
  } finally {
    const sessions = new Set<string>();
    const collect = async () => {
      const records = await read(`/runs/${runId}/records`);
      for (const record of records.records) if (record.type === 'job' && record.event === 'launched') sessions.add(record.job.session);
    };
    try {
      if (runId && viewer && cookie) {
        await collect();
        const current = await read(`/runs/${runId}/context`);
        const cancelled = await post(`/runs/${runId}/control`, { sessionId: viewer, action: 'cancel', requestId: 'fixture-close',
          expectedEpoch: current.run.control.epoch, expectedRevision: current.run.control.revision });
        assert.equal(cancelled.status, 200, await cancelled.clone().text());
        await waitUntil('the HTTP fixture Run has actual resource closure proof', async () =>
          (await read(`/runs/${runId}/context`)).run.stopState?.closed === true, 30_000, 25);
        await collect();
        for (const session of sessions) assert.equal(spawnSync('tmux', ['has-session', '-t', `=${session}`], { timeout: 5000 }).status, 1,
          'the recorded fixture Job is absent before Host/Home disposal');
      }
    } finally {
      for (const session of sessions) spawnSync('tmux', ['kill-session', '-t', `=${session}`], { timeout: 5000 });
      await database?.end();
      assert.equal(await host.stop(), 0, host.stderr());
      await home.h.dispose();
    }
  }
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
    assert.equal(host.ctx.hima.ledger.records({ runId: prepared.runId, type: 'job' }).length, 0,
      'standalone preparation completed its file writes without starting a Job');
    assert.equal(host.ctx.hima.ledger.run(prepared.runId)?.projectSessionId, String(viewer.id));
    const read = await himaCommand(host, home.h.workspace, `/hima status ${prepared.runId}`, 5000, viewer);
    assert.equal(read.kind, 'success', read.text);
  } finally { await host.dispose(); await home.h.dispose(); }
});
