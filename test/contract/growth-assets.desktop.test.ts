// L3: one actual added branch and its Pack archive in the native unified workspace.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { prepared } from './support/growth.ts';
import { killSessions, sessionsOf } from './support/fabric.ts';
import { bootDriver } from './support/driver.ts';
import { freePort } from './support/boot-host.ts';
import { api } from './support/hima-api.ts';
import { inspectWindow } from './support/inspect-window.ts';
import { writeExecutionReplay } from './support/agent-execution-replay.ts';
process.env.HIMA_TEST_SILENT_AGENT = '1';

test('added research is distinguishable from the reference and can be expanded after returning', async (t) => {
  const f = await prepared(t, 300_000);
  await f.reachGrowth();
  assert.equal((await f.call({ action: 'grow', proposal: f.proposal() })).kind, 'accepted');
  for (const node of ['growth-synthesize', 'growth-read', 'growth-judge']) await f.node(node);
  assert.deepEqual(f.context().available, ['next-period']);
  const sessions = sessionsOf(f.host, f.runId);
  await f.host.dispose();
  const replay = await writeExecutionReplay(f.home.h);
  const port = await freePort();
  const driver = await bootDriver(t, { existing: f.home.h, remoteDebuggingPort: port, model: { replay }, theme: 'light',
    window: { width: 1440, height: 960 }, env: { HIMA_TEST_SILENT_AGENT: '1', HIMA_TEST_LEGACY_AUTO_DRIVE: '0' } });
  if (!driver) { killSessions(sessions); await f.home.h.dispose(); return; }
  const browser = await inspectWindow(port);
  try {
    await driver.open('/');
    await browser.wait(`document.body.innerText.includes('Internal Testing Notice')`);
    await browser.markText('button', 'Continue', 'notice-continue'); assert.ok((await driver.click('notice-continue')).ok);
    const host = await driver.host(); assert.ok(host.ok); const cookie = await driver.cookie();
    const created = await api(host, cookie, '/api/workspace/create', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      type: 'client-request', rpcId: 'growth-workspace', method: 'workspace/create', payload: { args: { request: { path: f.home.h.workspace } } },
    }) });
    assert.equal((await created.json() as { result: { ok: boolean } }).result.ok, true);
    await browser.wait(`document.querySelector('[role="treegrid"], [role="tree"]')?.textContent.includes('workspace') || [...document.querySelectorAll('[role="row"]')].some(e=>e.textContent.trim()==='workspace')`);
    await browser.markText('button', 'New Session', 'growth-new-session'); assert.ok((await driver.click('growth-new-session')).ok);
    await browser.wait(`!document.querySelector('[data-hima-control="open-workbench"]').disabled`);
    assert.ok((await driver.click('open-workbench')).ok); assert.ok((await driver.wait('studio', 'Campaign workspace')).ok);
    assert.ok((await driver.fill('studio-run', f.runId)).ok);
    assert.ok((await driver.wait('run-growth', 'critical-cell-probe')).ok);
    assert.ok((await driver.click('growth-expand-critical-cell-probe')).ok);
    const branch = await driver.read('growth-critical-cell-probe'); assert.ok(branch.ok);
    assert.equal(branch.state.event, 'returned');
    assert.match(branch.text, /Return to next-period/); assert.match(branch.text, /growth-judge/);
    if (process.env.HIMA_UI_ARTIFACTS) {
      await mkdir(process.env.HIMA_UI_ARTIFACTS, { recursive: true });
      assert.ok((await driver.screenshot(path.join(process.env.HIMA_UI_ARTIFACTS, 'added-research-returned.png'))).ok);
    }
  } catch (error) { t.diagnostic(await browser.evaluate<string>('document.body.innerText')); throw error; }
  finally { browser.close(); await driver.dispose(); killSessions(sessions); await f.home.h.dispose(); }
});
