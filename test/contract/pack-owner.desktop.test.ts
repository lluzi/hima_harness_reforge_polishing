// L3 owner review: real Electron, Host and file publication; no model or EDA request.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { localHome } from './support/fabric.ts';
import { packsDirOf } from './support/pack.ts';
import { bootDriver } from './support/driver.ts';
import { freePort } from './support/boot-host.ts';
import { api } from './support/hima-api.ts';
import { inspectWindow } from './support/inspect-window.ts';
import { writeExecutionReplay } from './support/agent-execution-replay.ts';

test('owner reviews selected knowledge files and confirms the exact local sharing manifest in the native workspace', async (t) => {
  const home = await localHome(t, { sleepSeconds: 0.01 }); assert.ok(home);
  const replay = await writeExecutionReplay(home.h);
  const port = await freePort();
  const d = await bootDriver(t, { existing: home.h, remoteDebuggingPort: port, theme: 'light', window: { width: 1440, height: 960 },
    model: { replay }, env: { HIMA_TEST_SILENT_AGENT: '1', HIMA_TEST_LEGACY_AUTO_DRIVE: '0' } });
  if (!d) { await home.h.dispose(); return; }
  const browser = await inspectWindow(port);
  const pack = 'opene902-timing-probe', relative = 'run-assets/owner-example/negative-result.md';
  const source = path.join(packsDirOf(home.h), pack, relative);
  const destination = path.join(home.h.home, 'shared', pack);
  try {
    await mkdir(path.dirname(source), { recursive: true });
    await writeFile(source, 'An observed negative result; this local fixture makes no EDA claim.\n');
    await d.open('/');
    await browser.wait(`document.body.innerText.includes('Internal Testing Notice')`);
    await browser.markText('button', 'Continue', 'notice-continue'); assert.ok((await d.click('notice-continue')).ok);
    const host = await d.host(); assert.ok(host.ok); const cookie = await d.cookie();
    const workspace = await api(host, cookie, '/api/workspace/create', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      type: 'client-request', rpcId: 'owner-workspace', method: 'workspace/create', payload: { args: { request: { path: home.h.workspace } } },
    }) });
    assert.equal((await workspace.json() as { result: { ok: boolean } }).result.ok, true);
    await browser.wait(`document.querySelector('[role="treegrid"], [role="tree"]')?.textContent.includes('workspace') || [...document.querySelectorAll('[role="row"]')].some(e=>e.textContent.trim()==='workspace')`);
    await browser.markText('button', 'New Session', 'owner-new-session'); assert.ok((await d.click('owner-new-session')).ok);
    await browser.wait(`!document.querySelector('[data-hima-control="open-workbench"]').disabled`);
    assert.ok((await d.click('open-workbench')).ok); assert.ok((await d.wait('studio', 'Campaign workspace')).ok);
    assert.ok((await d.click('studio-pack-owner')).ok);
    for (const [control, value] of Object.entries({ 'owner-pack': pack, 'owner-location': destination, 'owner-assets': relative })) assert.ok((await d.fill(control, value)).ok);
    assert.ok((await d.click('owner-review')).ok);
    assert.ok((await d.wait('pack-review', relative)).ok);
    await assert.rejects(readFile(path.join(destination, relative)), /ENOENT/, 'preview writes no exported asset');
    await browser.wait(`document.querySelector('[data-hima-control="owner-confirm"]') !== null`);
    if (process.env.HIMA_UI_ARTIFACTS) {
      await mkdir(process.env.HIMA_UI_ARTIFACTS, { recursive: true });
      assert.ok((await d.screenshot(path.join(process.env.HIMA_UI_ARTIFACTS, 'owner-file-review.png'))).ok);
    }
    await browser.evaluate(`document.querySelector('[data-hima-control="owner-confirm"]').scrollIntoView({block:'center'})`);
    assert.ok((await d.click('owner-confirm')).ok);
    assert.ok((await d.wait('pack-owner-message', 'Confirmed files verified and written')).ok);
    assert.deepEqual(await readFile(path.join(destination, relative)), await readFile(source));
  } catch (error) { t.diagnostic(await browser.evaluate<string>('document.body.innerText')); throw error; }
  finally { browser.close(); await d.dispose(); await home.h.dispose(); }
});
