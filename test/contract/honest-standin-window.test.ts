// PLS-03: one real form-to-result path; method matrices are in honest-standin.test.ts (L2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootDriver, fillForm, theOneRunId } from './support/driver.ts';
import { timingProbePackId } from './support/pack.ts';

test('the start form opens a converged Run and the window shows its recorded decision', async (t) => {
  const d = await bootDriver(t, { home: 'empty', seed: 'local' });
  if (!d) return;
  try {
    const host = await d.host();
    assert.ok(host.ok, JSON.stringify(host));
    const honest = timingProbePackId;
    assert.match(d.stderr(), /stand-in computes its own qor report/, 'the local seed labels simulated results');
    const opened = await d.open('/hima/');
    assert.ok(opened.ok, JSON.stringify(opened));
    await fillForm(d, {
      'start-pack': honest, 'start-site': 'local', 'start-target': '2.0',
      'start-knob-periodNs': '2.3', 'start-time-box': '5',
      'start-retries': '2', 'start-generations': '6',
    });
    const clicked = await d.click('start');
    assert.ok(clicked.ok, JSON.stringify(clicked));
    const status = await d.wait('run-status', 'ended — converged');
    assert.ok(status.ok, `wait run-status: ${JSON.stringify(status)}`);
    const decision = await d.read('run-decision');
    assert.ok(decision.ok, JSON.stringify(decision));
    assert.ok(
      decision.text.includes('converged: period moved by less than 0.05 over 1 generation, at 2.15 then 2.15'),
      `the card says the rule in words, at the period it settled on: ${decision.text}`,
    );
    assert.ok((await theOneRunId(d)).startsWith('run-'), 'the form opens the Run it created');
    assert.deepEqual(d.unexpectedStdout(), []);
  } finally { await d.dispose(); }
});
