// Ticket #27: the Budget meters the whole Campaign, not one generation.
//
// The time box spans every generation; the generation limit is a meter; the Retry allowance is per
// node per generation; the job cap and the Site's declared licences bound launches. Every meter is
// shown against its bound, and a spent meter ends the Run `ended-budget-exhausted` naming what ran
// out — while a spent allowance and a full Site only make a Run wait.
//
// Driven through the desktop shell in driver mode (D42, ADR-0004), the one seam every step-3 test
// boots through: the Runs are started over the routes with the session the shell established, and
// what is asserted is what the routes answer and what the window's own page shows. The one
// exception is the last test, which is about the words a chat command says and boots in process,
// because no window renders a command's answer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootDriver } from './support/driver.ts';
import { api } from './support/hima-api.ts';

test('the served HimaGuide bundle carries the meters section, as the workbench page does', async (t) => {
  const d = await bootDriver(t, { home: 'hima' });
  if (!d) return;
  try {
    const host = await d.host();
    assert.ok(host.ok, JSON.stringify(host));
    const cookie = await d.cookie();

    const index = await api(host, cookie, '/');
    const html = await index.text();
    const boot = /globalThis\["__DSH_BOOT__"\] = ([\s\S]*?)<\/script>/.exec(html);
    assert.ok(boot, 'the index carries the client-module boot graph');
    const graph = JSON.parse(boot[1]!) as { entries: { id: string; url: string }[] };
    const hima = graph.entries.find((e) => e.id === '@hima/harness');
    assert.ok(hima, `the Hima module is in the boot graph; it holds ${graph.entries.map((e) => e.id).join(', ')}`);
    const source = await (await api(host, cookie, hima.url)).text();

    // The card has two mounts and one Budget. Only spellings a minified React bundle cannot satisfy
    // by accident are asked for: the region's name, the question the section answers, and two of
    // `meterLines`' own clauses.
    assert.ok(source.includes('run-meters'), 'the chat\'s card marks the meters section the way the page does');
    assert.ok(source.includes('what it has spent'), 'and heads it with the question the page\'s board asks');
    assert.ok(source.includes('of a time box of'), 'and says elapsed against the box in the same words');
    assert.ok(source.includes('launched, at most'), 'and the jobs against the cap in the same words');
    assert.deepEqual(d.unexpectedStdout(), []);
  } finally {
    await d.dispose();
  }
});

