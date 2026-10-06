// Host contract regressions about the Run's declared budget at creation. Real Host, local Jobs, a
// timing-probe variant Pack; no model and no Electron.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localHome } from './support/fabric.ts';
import { bootInProcess, createRootAgent } from './support/boot-inprocess.ts';
import { packsDirOf, writePackVariant } from './support/pack.ts';

process.env.HIMA_TEST_LEGACY_AUTO_DRIVE = '0';
process.env.HIMA_TEST_SILENT_AGENT = '1';

// C28 (Host contract regression): a Campaign whose generationLimit is below the generations the graph
// needs to reach its first result ended at the generation limit with nothing produced (a live Run
// ended at generation-limit in gen 2 with 0 workers and 0 refreshes). A Pack may now declare
// `budget.minimumGenerations`, and Run creation refuses a smaller generationLimit naming both numbers.
test('a Run started below the Pack minimumGenerations is refused naming both numbers', async (t) => {
  const home = await localHome(t, { sleepSeconds: 0 });
  assert.ok(home);
  const packsDir = packsDirOf(home.h);
  const packId = 'min-generations';
  await writePackVariant(packsDir, packId, [['words:', 'budget:\n  minimumGenerations: 3\nwords:']]);
  const host = await bootInProcess(home.h);
  try {
    const owner = await createRootAgent(host.ctx, home.h.workspace);
    const start = (generationLimit: number) => host.ctx.hima.startRun({
      pack: packId, site: 'local', goal: { target_period_ns: 2 }, ownerSessionId: String(owner.id),
      generationLimit });
    await assert.rejects(start(2), (error: Error) => {
      assert.match(error.message, /generation limit is 2/);
      assert.match(error.message, /at least 3 generations/);
      assert.match(error.message, /minimumGenerations/);
      return true;
    }, 'a generation limit below the declared minimum is refused naming 2 and 3');
    // At and above the declared minimum the Run is created.
    const atMinimum = await start(3);
    assert.ok(atMinimum.kind === 'preparing' || atMinimum.kind === 'ran', JSON.stringify(atMinimum));
    assert.equal('engine' in atMinimum.run && atMinimum.run.engine, 'dbos/5.2.11');
    const retained = await host.ctx.hima.durable.store.run(atMinimum.run.id);
    assert.equal((retained.opening.data as { budget: { generationLimit: number } }).budget.generationLimit, 3);
    await host.ctx.hima.cancelRun(atMinimum.run.id);
  } finally {
    await host.dispose(); await home.h.dispose();
  }
});

// A Pack that declares no minimum imposes no floor: any valid generation limit is accepted.
test('a Pack that declares no minimumGenerations imposes no generation floor', async (t) => {
  const home = await localHome(t, { sleepSeconds: 0 });
  assert.ok(home);
  const packsDir = packsDirOf(home.h);
  const packId = 'no-min-generations';
  await writePackVariant(packsDir, packId, []);
  const host = await bootInProcess(home.h);
  try {
    const owner = await createRootAgent(host.ctx, home.h.workspace);
    const started = await host.ctx.hima.startRun({ pack: packId, site: 'local', goal: { target_period_ns: 2 },
      ownerSessionId: String(owner.id), generationLimit: 1 });
    assert.ok(started.kind === 'preparing' || started.kind === 'ran', JSON.stringify(started));
    assert.equal('engine' in started.run && started.run.engine, 'dbos/5.2.11');
    await host.ctx.hima.cancelRun(started.run.id);
  } finally {
    await host.dispose(); await home.h.dispose();
  }
});
