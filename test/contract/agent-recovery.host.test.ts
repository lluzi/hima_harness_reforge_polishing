// PLS-19: real Host restarts and local Jobs; deterministic protocol calls, no model or Electron.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localHome } from './support/fabric.ts';
import { bootInProcess } from './support/boot-inprocess.ts';
import { timingProbePackId } from './support/pack.ts';

process.env.HIMA_TEST_LEGACY_AUTO_DRIVE = '0';
process.env.HIMA_TEST_SILENT_AGENT = '1';

test('production preparation refuses an unowned Run before any Job or Run is created', async (t) => {
  const home = await localHome(t, { sleepSeconds: 0.01 });
  assert.ok(home);
  const host = await bootInProcess(home.h);
  try {
    await assert.rejects(host.ctx.hima.startRun({ pack: timingProbePackId, site: 'local', goal: { target_period_ns: 2 }, generationLimit: 1 }), /live conversation|owner/);
    assert.equal(host.ctx.hima.ledger.runs().length, 0);
  } finally { await host.dispose(); await home.h.dispose(); }
});

