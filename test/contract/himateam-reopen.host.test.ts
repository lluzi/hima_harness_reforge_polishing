// #98: a normal Host close must retain its admission fence until the next lifetime
// recovers it; the reopened public start route must wait for that recovery itself.
// Real Host/PG/DBOS, local fixture only; no Team runtime or model is invoked.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bootInProcess, createRootAgent, type InProcessHost } from './support/boot-inprocess.ts';
import { localHome } from './support/fabric.ts';
import { timingProbePackId } from './support/pack.ts';

test('normal Host reopening admits an immediate Pack start after recovering the previous exit fence', { timeout: 60000 }, async t => {
  const home = await localHome(t, { sleepSeconds: 0 });
  assert.ok(home);
  let host: InProcessHost | undefined;
  try {
    host = await bootInProcess(home.h);
    await host.ctx.hima.reconciled;
    assert.equal((await host.ctx.hima.durable.store.runs()).length, 0, 'first close has no Team or Pack Run');
    await host.dispose(); host = undefined;
    host = await bootInProcess(home.h);
    const service = host.ctx.hima;
    let recovered = false;
    void service.reconciled.then(() => { recovered = true; });
    const owner = await createRootAgent(host.ctx, home.h.workspace);
    // Do not have the caller await reconciled: the user only sees a booted Host.
    const request = { pack: timingProbePackId, site: 'local', goal: { target_period_ns: 2 },
      generationLimit: 1, timeBoxMs: 30000, ownerSessionId: String(owner.id) };
    const before = service.durable.store.hostExit();
    const immediate = await service.startRun(request).then(value => ({ value }), error => ({ error }));
    const fenceBefore = await before;
    const recoveredAtAdmission = recovered;
    await service.reconciled;
    assert.equal(await service.durable.store.hostExit(), undefined, 'previous lifetime fence is eventually released');
    const settled = 'error' in immediate ? await service.startRun(request) : immediate.value;
    assert.ok(settled.kind === 'preparing' || settled.kind === 'ran', JSON.stringify(settled));
    t.diagnostic(JSON.stringify({ fenceBefore, recoveredAtAdmission,
      immediateError: 'error' in immediate ? String(immediate.error) : null,
      recoveredAdmission: settled.kind, runId: settled.run.id }));
    assert.equal('error' in immediate ? String(immediate.error) : null, null,
      'reopened startRun must await recovery internally, without a caller retry');
  } finally { if (host) await host.dispose(); await home.h.dispose(); }
});

test('a reopened Host still fences new Pack starts under its current accepted exit', { timeout: 60000 }, async t => {
  const home = await localHome(t, { sleepSeconds: 0 });
  assert.ok(home);
  let host: InProcessHost | undefined;
  try {
    host = await bootInProcess(home.h);
    await host.dispose(); host = undefined;
    host = await bootInProcess(home.h);
    await host.ctx.hima.reconciled;
    const owner = await createRootAgent(host.ctx, home.h.workspace);
    await host.ctx.hima.prepareExit({ requestId: 'current-reopened-close', mode: 'keep-jobs' });
    await assert.rejects(host.ctx.hima.startRun({ pack: timingProbePackId, site: 'local',
      goal: { target_period_ns: 2 }, generationLimit: 1, ownerSessionId: String(owner.id) }), /closing|fenced/);
    assert.equal((await host.ctx.hima.durable.store.runs()).length, 0);
  } finally { if (host) await host.dispose(); await home.h.dispose(); }
});
