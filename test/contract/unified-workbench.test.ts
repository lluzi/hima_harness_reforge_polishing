// L3: native dsh conversation + Hima dock. Real Host and local Jobs; no model turn or SSH.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { bootDriver, type BootedDriver } from './support/driver.ts';
import { freePort } from './support/boot-host.ts';
import { api } from './support/hima-api.ts';
import { inspectWindow } from './support/inspect-window.ts';
import { writeSampleReport } from './support/site.ts';
import type { RunView } from '@hima/harness';

type Inspector = Awaited<ReturnType<typeof inspectWindow>>;
const draft = 'UI validation draft — compare strategies and preserve each experiment’s evidence. Not sent to a model.';

async function prepareSession(d: BootedDriver, browser: Inspector) {
  await d.open('/');
  await browser.wait(`document.body.innerText.includes('Internal Testing Notice')`);
  await browser.markText('button', 'Continue', 'notice-continue');
  assert.ok((await d.click('notice-continue')).ok);
  await browser.wait(`document.body.innerText.includes('Configure later')`);
  await browser.markText('button', 'Configure later', 'models-later');
  assert.ok((await d.click('models-later')).ok);
  const host = await d.host(); assert.ok(host.ok);
  const cookie = await d.cookie();
  // Fixture setup through the actual public Host RPC. Native folder-picker automation is not
  // required to verify this dock; selecting the resulting session still uses the native UI.
  const response = await api(host, cookie, '/api/workspace/create', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: 'hima-ui-workspace', method: 'workspace/create', payload: { args: { request: { path: d.home.workspace } } } }),
  });
  const created = await response.json() as { result: { ok: boolean } };
  assert.equal(created.result.ok, true, JSON.stringify(created));
  await browser.wait(`document.querySelector('[role="treegrid"], [role="tree"]')?.textContent.includes('workspace') || [...document.querySelectorAll('[role="row"]')].some(e=>e.textContent.trim()==='workspace')`);
  await browser.markText('button', 'New Session', 'native-new-session');
  assert.ok((await d.click('native-new-session')).ok);
  await browser.wait(`!document.querySelector('[data-hima-control="open-workbench"]').disabled`);
  await browser.evaluate(`document.querySelector('[contenteditable="true"]').focus()`);
  await browser.send('Input.insertText', { text: draft });
  assert.equal(await browser.evaluate(`document.querySelector('[contenteditable="true"]').textContent`), draft);
  assert.ok((await d.click('open-workbench')).ok);
  assert.ok((await d.wait('studio', 'Research workspace', 12_000)).ok);
  return { host, cookie };
}

async function fillStart(d: BootedDriver, browser: Inspector, target = '2.25', retries = '0') {
  assert.ok((await d.click('studio-new')).ok);
  await browser.wait(`document.querySelector('[data-hima-region="studio-preflight"]')?.getAttribute('data-hima-state-status')==='fit'`);
  for (const [key, value] of Object.entries({ 'studio-target': target, 'studio-knob-periodNs': '2.3', 'studio-timeBox': '5', 'studio-retries': retries, 'studio-generations': '6' })) {
    assert.ok((await d.fill(key, value)).ok);
  }
}

async function currentRun(d: BootedDriver): Promise<string> {
  const studio = await d.read('studio'); assert.ok(studio.ok, JSON.stringify(studio));
  const id = studio.state.run; assert.ok(id);
  return id;
}

async function capture(d: BootedDriver, browser: Inspector, name: string) {
  const out = process.env.HIMA_UI_ARTIFACTS;
  if (!out) return;
  await mkdir(out, { recursive: true });
  await browser.evaluate('document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true)))))');
  const result = await d.screenshot(path.join(out, `${name}.png`)); assert.ok(result.ok);
}

async function finish(d: BootedDriver, browser?: Inspector) {
  if (browser) { await browser.send('Fetch.disable').catch(() => undefined); browser.close(); }
  const host = await d.host();
  if (host.ok) {
    const cookie = await d.cookie();
    const listed = await api(host, cookie, '/hima/api/runs');
    const { runs } = await listed.json() as { runs: RunView['run'][] };
    for (const run of runs.filter((run) => run.status === 'running' || run.status === 'waiting')) await api(host, cookie, `/hima/api/runs/${run.id}/cancel`, { method: 'POST' });
  }
  await d.dispose();
}

test('conversation draft, native files and verified reports share one workspace with a real Run', async (t) => {
  const port = await freePort();
  const d = await bootDriver(t, { home: 'hima', sleepSeconds: 2, theme: 'light', window: { width: 1440, height: 960 }, remoteDebuggingPort: port });
  if (!d) return;
  let browser: Inspector | undefined;
  try {
    browser = await inspectWindow(port);
    const { host, cookie } = await prepareSession(d, browser);
    const url = await browser.evaluate<string>('location.href');
    await fillStart(d, browser);
    await capture(d, browser, 'light-start');
    assert.ok((await d.click('studio-start')).ok);
    assert.ok((await d.wait('studio-status', 'running', 20_000)).ok);
    await capture(d, browser, 'light-running');
    assert.ok((await d.wait('studio-status', 'ended — goal met', 35_000)).ok);
    const id = await currentRun(d);
    await capture(d, browser, 'light-complete');
    assert.equal(await browser.evaluate('location.href'), url, 'opening and running did not navigate the document');
    assert.equal(await browser.evaluate(`document.querySelector('[contenteditable="true"]').textContent`), draft);
    assert.ok((await d.click('studio-evidence')).ok);
    assert.ok((await d.wait('studio', 'clock-period-at-most@1', 10_000)).ok);
    assert.ok((await d.wait('studio', 'sha256', 10_000)).ok, 'failed judgment exposes original citations');
    assert.ok((await d.click('studio-report')).ok);
    await browser.mark('.hima-studio a[href$="/experience.md"]', 'open-saved-report');
    assert.ok((await d.click('open-saved-report')).ok);
    assert.ok((await d.wait('studio', 'original bytes verified by the Host', 12_000)).ok);
    await capture(d, browser, 'light-report');
    const view = await (await api(host, cookie, `/hima/api/runs/${id}`)).json() as RunView;
    assert.ok(view.experience);
    const file = view.experience.markdown.path;
    const original = await readFile(file);
    try {
      await writeFile(file, 'changed after publication');
      await browser.markText('button', '← Current ledger preview', 'current-preview');
      assert.ok((await d.click('current-preview')).ok);
      await browser.mark('.hima-studio a[href$="/experience.md"]', 'open-saved-report');
      assert.ok((await d.click('open-saved-report')).ok);
      assert.ok((await d.wait('studio', 'Saved file could not be verified', 12_000)).ok);
      const text = await d.read('studio'); assert.ok(text.ok);
      assert.ok(!text.text.includes('original bytes verified by the Host'));
    } finally { await writeFile(file, original); }
    await browser.markText('button', 'Files & code', 'native-files');
    assert.ok((await d.click('native-files')).ok);
    await browser.wait(`document.body.innerText.includes(${JSON.stringify(view.run.campaignId)})`);
    await browser.markText('button', view.run.campaignId, 'campaign-files');
    assert.ok((await d.click('campaign-files')).ok);
    await browser.wait(`document.body.innerText.includes('workspace.json')`);
    await browser.markText('button', 'workspace.json', 'workspace-record');
    assert.ok((await d.click('workspace-record')).ok);
    await browser.wait(`document.body.innerText.includes('flowRoot')`);
    assert.equal(await browser.evaluate('location.href'), url);
    assert.equal(await browser.evaluate(`document.querySelector('[contenteditable="true"]').textContent`), draft);
    await capture(d, browser, 'light-code');
  } finally { await finish(d, browser); }
});

test('preparation retries preserve drafts, pending starts cannot be replaced, and a resumed Run remains cancellable', async (t) => {
  const port = await freePort();
  const d = await bootDriver(t, { home: 'hima', sleepSeconds: 5, failures: 1, theme: 'dark', window: { width: 1280, height: 860 }, remoteDebuggingPort: port });
  if (!d) return;
  let browser: Inspector | undefined;
  try {
    const siteFile = path.join(d.home.home, 'hima/sites/local.yml');
    await writeFile(path.join(d.home.home, 'hima/sites/other.yml'), (await readFile(siteFile, 'utf8')).replace('name: local', 'name: other'));
    browser = await inspectWindow(port);
    const { host, cookie } = await prepareSession(d, browser);
    const sample = await writeSampleReport(d.home);
    const probe = await (await api(host, cookie, '/hima/api/observe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ site: 'local', path: path.join(d.home.workspace, sample.rel) }) })).json() as RunView;
    assert.ok(probe.run?.id);
    await fillStart(d, browser, '2.3');
    await browser.pause('*/hima/api/start-options*');
    assert.ok((await d.fill('studio-site', 'other')).ok);
    const failedCheck = await browser.nextPaused();
    await browser.send('Fetch.fulfillRequest', { requestId: failedCheck.requestId, responseCode: 503, body: Buffer.from(JSON.stringify({ error: { code: 'hima/internal', message: 'temporary preparation failure' } })).toString('base64') });
    assert.ok((await d.wait('studio-start', 'temporary preparation failure', 12_000)).ok);
    assert.equal(await browser.evaluate(`document.querySelector('[data-hima-control="studio-target"]').value`), '2.3');
    assert.equal(await browser.evaluate(`document.querySelector('[data-hima-control="studio-start"]').disabled`), true);
    await browser.send('Fetch.disable');
    assert.ok((await d.click('studio-recheck')).ok);
    await browser.wait(`document.querySelector('[data-hima-region="studio-preflight"]').getAttribute('data-hima-state-status')==='fit'`);
    await browser.pause('*/hima/api/runs/start');
    assert.ok((await d.click('studio-start')).ok);
    const starting = await browser.nextPaused();
    assert.equal(await browser.evaluate(`document.querySelector('[data-hima-control="studio-run"]').disabled`), true);
    await browser.evaluate(`document.querySelector('[data-hima-region="studio-start"]').requestSubmit()`);
    const runs = await (await api(host, cookie, '/hima/api/runs')).json() as { runs: RunView['run'][] };
    assert.equal(runs.runs.length, 2, 'one Probe and exactly one Campaign despite repeated submit');
    await browser.send('Fetch.continueRequest', { requestId: starting.requestId }); await browser.send('Fetch.disable');
    assert.ok((await d.wait('studio-status', 'waiting', 25_000)).ok);
    const id = await currentRun(d);
    await capture(d, browser, 'dark-blocked');
    assert.ok((await d.click('resume')).ok);
    assert.ok((await d.wait('studio-status', 'running', 10_000)).ok);
    assert.equal(await browser.evaluate(`document.querySelector('[data-hima-control="cancel"]').disabled`), false, 'Cancel does not wait for the resumed continuation to finish');
    assert.ok((await d.fill('studio-run', probe.run.id)).ok);
    assert.ok((await d.wait('studio-status', 'No Fabric state recorded', 10_000)).ok);
    assert.ok((await d.fill('studio-run', id)).ok);
    assert.ok((await d.wait('studio-status', 'running', 10_000)).ok);
    assert.equal(await browser.evaluate(`document.querySelector('[data-hima-control="cancel"]').disabled`), false);
    assert.ok((await d.click('cancel')).ok);
    assert.ok((await d.wait('studio-status', 'cancelled', 15_000)).ok);
    const ended = await (await api(host, cookie, `/hima/api/runs/${id}`)).json() as RunView;
    assert.equal(ended.cancels.length, 1);
    assert.equal(ended.jobs.filter((job) => job.event === 'launched').length, 2, 'Run selection never launches another continuation');
    assert.equal(await browser.evaluate(`document.querySelector('[contenteditable="true"]').textContent`), draft);
    await capture(d, browser, 'dark-cancelled');
  } finally { await finish(d, browser); }
});
