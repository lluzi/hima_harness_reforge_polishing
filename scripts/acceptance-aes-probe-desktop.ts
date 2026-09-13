// One opt-in desktop observation of a copied, completed real probe; no model/EDA execution.
import test from 'node:test';
import type { RunView } from '@hima/harness';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createEmptyHome } from '../test/contract/support/dsh-home.ts';
import { bootDriver } from '../test/contract/support/driver.ts';
import { freePort } from '../test/contract/support/boot-host.ts';
import { inspectWindow } from '../test/contract/support/inspect-window.ts';
import { api } from '../test/contract/support/hima-api.ts';
import { sha256 } from './live-check-workshop.ts';

test('a completed real AES probe remains observable beside native chat without rerunning it', async (t) => {
  const evidenceFile = process.env.HIMA_AES_EVIDENCE;
  const output = process.env.HIMA_AES_DESKTOP_OUT;
  assert.ok(evidenceFile && output, 'explicit evidence and fresh output paths required');
  const evidence = JSON.parse(readFileSync(evidenceFile, 'utf8'));
  assert.equal(evidence.status, 'passed');
  const run = evidence.runs[0].run;
  const original = path.resolve(evidence.observed.packFolder, '../../..');
  const originalLedger = path.join(original, 'storages/hima_ledger.json');
  const before = sha256(readFileSync(originalLedger));
  const home = await createEmptyHome();
  cpSync(original, home.home, { recursive: true, dereference: false });
  mkdirSync(output, { recursive: false });
  delete process.env.DEEPSEEK_API_KEY;
  delete home.env.DEEPSEEK_API_KEY;
  const port = await freePort();
  const d = await bootDriver(t, { existing: home, remoteDebuggingPort: port, theme: 'light', window: { width: 1440, height: 960 } });
  assert.ok(d, 'desktop must actually start for this acceptance');
  const browser = await inspectWindow(port);
  try {
    await d.open('/');
    await browser.wait(`document.body.innerText.includes('Internal Testing Notice')`);
    await browser.markText('button', 'Continue', 'notice-continue');
    assert.ok((await d.click('notice-continue')).ok);
    const host = await d.host(); assert.ok(host.ok); const cookie = await d.cookie();
    const response = await api(host, cookie, '/api/workspace/create', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'aes-desktop', method: 'workspace/create', payload: { args: { request: { path: home.workspace } } } }) });
    assert.equal((await response.json() as { result: { ok: boolean } }).result.ok, true);
    await browser.markText('button', 'New Session', 'native-new-session'); await d.click('native-new-session');
    await browser.wait(`document.body.innerText.includes('Configure later')`);
    await browser.markText('button', 'Configure later', 'models-later');
    assert.ok((await d.click('models-later')).ok);
    await browser.wait(`!document.body.innerText.includes('Configure later')`);
    await browser.wait(`!document.querySelector('[data-hima-control="open-workbench"]').disabled`);
    await browser.evaluate(`document.querySelector('[contenteditable="true"]').focus()`);
    const draft = 'Inspect the real AES measurements and preserve the failed trial. Unsent validation draft.';
    await browser.send('Input.insertText', { text: draft });
    assert.ok((await d.click('open-workbench')).ok);
    const listed = await api(host, cookie, '/hima/api/runs');
    writeFileSync(path.join(output, 'run-list.json'), JSON.stringify({status: listed.status, body: await listed.json(), copiedHome: home.home}, null, 2));
    await browser.wait(`[...document.querySelectorAll('[data-hima-control="studio-run"] option')].some(o=>o.value===${JSON.stringify(run.id)})`);
    await d.fill('studio-run', run.id);
    await browser.wait(`document.querySelector('[data-hima-region="studio-status"]')?.getAttribute('data-hima-state-status')===${JSON.stringify(run.status)}`);
    const view = await (await api(host, cookie, `/hima/api/runs/${run.id}`)).json() as RunView;
    assert.equal(view.run.id, run.id); assert.equal(view.run.status, run.status);
    assert.equal(view.run.generation, 2);
    assert.deepEqual(view.run.meters, run.meters, "desktop inspection launches no additional jobs");
    assert.equal(await browser.evaluate(`document.querySelector('[contenteditable="true"]').textContent`), draft);
    assert.ok((await d.screenshot(path.join(output, 'aes-probe-light.png'))).ok);
    assert.equal(sha256(readFileSync(originalLedger)), before, 'original evidence home remains byte-identical');
    writeFileSync(path.join(output, 'evidence.json'), JSON.stringify({ passed: true, runId: run.id, status: run.status, generations: 2,
      originalLedgerSha256: before, copiedHome: home.home, electron: 1, modelTurnsSubmitted: 0, providerRequests: 'not instrumented; key absent and title generation disabled', newEdaJobs: 0, view }, null, 2) + '\n');
  } catch (error) {
    writeFileSync(path.join(output, 'failure.json'), JSON.stringify({ error: String(error), copiedHome: home.home, body: await browser.evaluate('document.body.innerText').catch(() => 'unavailable') }, null, 2));
    await d.screenshot(path.join(output, 'failure.png'));
    throw error;
  } finally { browser.close(); await d.dispose(); }
});
