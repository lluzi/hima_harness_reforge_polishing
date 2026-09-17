// Bug 3 (UI trial 0.3.0-trial.3): the Configuration page's top-level "Refresh Run data" button (the
// icon beside the CAMPAIGN picker, `HimaWorkbench.tsx`) previously only bumped `snapshot`/`list` —
// both of which read a *selected Run*, and are no-ops while `selected === undefined`, exactly the
// state that renders `ConfigurationPage`. That page's own readiness poll lived entirely inside its
// own effect (`tick.current`, 3 s interval) with no way to hear about the header click, so an
// external edit to `hima/campaign.yml` (e.g. a person removing a stray key by hand, as the trial did)
// only ever showed up on the next natural 3 s tick — never immediately on refresh — and the only
// control that *did* force an immediate re-read was a readiness row's own "Retry" button. This test
// proves the header button now forces the same immediate re-read `retry` already gave one row, well
// inside the 3 s natural poll interval so a passing run cannot be explained by just waiting it out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { localHome } from './support/fabric.ts';
import { bootDriver } from './support/driver.ts';
import { freePort } from './support/boot-host.ts';
import { inspectWindow } from './support/inspect-window.ts';
import { api } from './support/hima-api.ts';

test('the top-level Refresh Run data button re-reads the Campaign file immediately, not only on the next 3s poll', async (t) => {
  const home = await localHome(t, { sleepSeconds: 0.01 });
  if (!home) return;
  const port = await freePort();
  const d = await bootDriver(t, { existing: home.h, remoteDebuggingPort: port, theme: 'light', window: { width: 1440, height: 960 }, env: { HIMA_TEST_SILENT_AGENT: '1' } });
  if (!d) { await home.h.dispose(); return; }
  const browser = await inspectWindow(port);
  try {
    await d.open('/');
    await browser.wait(`document.body.innerText.includes('Internal Testing Notice')`);
    await browser.markText('button', 'Continue', 'notice-continue'); assert.ok((await d.click('notice-continue')).ok);
    await browser.wait(`document.body.innerText.includes('Configure later')`);
    await browser.markText('button', 'Configure later', 'campaign-refresh-models-later');
    assert.ok((await d.click('campaign-refresh-models-later')).ok);
    const host = await d.host(); assert.ok(host.ok); const cookie = await d.cookie();
    const workspace = await api(host, cookie, '/api/workspace/create', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      type: 'client-request', rpcId: 'campaign-refresh-workspace', method: 'workspace/create', payload: { args: { request: { path: home.h.workspace } } },
    }) });
    assert.equal((await workspace.json() as { result: { ok: boolean } }).result.ok, true);
    await browser.wait(`document.querySelector('[role="treegrid"], [role="tree"]')?.textContent.includes('workspace') || [...document.querySelectorAll('[role="row"]')].some(e=>e.textContent.trim()==='workspace')`);
    await browser.markText('button', 'New Session', 'campaign-refresh-new-session'); assert.ok((await d.click('campaign-refresh-new-session')).ok);
    await browser.wait(`!document.querySelector('[data-hima-control="open-workbench"]').disabled`);
    assert.ok((await d.click('open-workbench')).ok); assert.ok((await d.wait('studio', 'Campaign configuration')).ok);

    // The header refresh icon carries no `data-hima-control` of its own (it never needed one before
    // this fix had anything worth asserting on) — tag it once, the same way `markText` already tags
    // plain-text buttons for this suite.
    await browser.mark('[aria-label="Refresh Run data"]', 'campaign-refresh-header');

    const campaignFile = path.join(home.h.workspace, 'hima/campaign.yml');
    // Let the page's own mount-time poll settle before the timed part of this test starts, so the
    // assertion below races the *next* 3 s tick, not the first one still in flight.
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // An edit this page's own poll did not make — a person hand-editing the file on disk, exactly
    // the trial's own repro (removing a stray key by hand) — must reach the page through the header
    // refresh, not only through the row-level Retry beside one readiness item. No Campaign file
    // exists yet at this point (the Host only writes one on a first save through the page), so this
    // is also that file's very first write — same as a person creating it by hand before ever
    // touching this page.
    await mkdir(path.dirname(campaignFile), { recursive: true });
    await writeFile(campaignFile, 'schema: hima-campaign/1\nname: refreshed-by-header\n');
    assert.ok((await d.click('campaign-refresh-header')).ok);
    await browser.wait(`document.querySelector('[data-hima-control="config-name"]')?.value === 'refreshed-by-header'`, 1500);
  } catch (error) {
    t.diagnostic(await browser.evaluate<string>('document.body.innerText'));
    throw error;
  } finally {
    browser.close();
    await d.dispose();
    await home.h.dispose();
  }
});
