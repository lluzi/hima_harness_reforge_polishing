// L3: one real native Electron route. Model responses are scripted replay; Host/tools/Jobs/UI are real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { RunView } from '@hima/harness';
import { localHome, killSessions } from './support/fabric.ts';
import { bootDriver, fillConfiguration } from './support/driver.ts';
import { freePort } from './support/boot-host.ts';
import { api } from './support/hima-api.ts';
import { inspectWindow } from './support/inspect-window.ts';
import { writeExecutionReplay, replayJobStarted, replayPaused, replayCompleted } from './support/agent-execution-replay.ts';
import { timingProbePackId } from './support/pack.ts';

process.env.HIMA_TEST_LEGACY_AUTO_DRIVE = '0';
process.env.HIMA_TEST_SILENT_AGENT = '1';
const initialDraft = 'Keep the existing research question and evidence in view. Unsent desktop test draft.';
const continuedDraft = 'After this verified result, compare the next experiment before launching it. Unsent draft.';

test('native selected conversation runs one explicit Job, accepts typed steering and human Continue without losing draft or Files', async (t) => {
  const home = await localHome(t, { sleepSeconds: 25 });
  assert.ok(home);
  const replay = await writeExecutionReplay(home.h);
  const port = await freePort();
  const d = await bootDriver(t, { existing: home.h, theme: 'light', window: { width: 1440, height: 960 }, remoteDebuggingPort: port,
    model: { replay }, env: { HIMA_TEST_LEGACY_AUTO_DRIVE: '0', HIMA_TEST_SILENT_AGENT: '1' } });
  if (!d) { await home.h.dispose(); return; }
  const browser = await inspectWindow(port);
  const jobSessions = new Set<string>();
  const capture = async (name: string) => {
    if (!process.env.HIMA_UI_ARTIFACTS) return;
    await mkdir(process.env.HIMA_UI_ARTIFACTS, { recursive: true });
    assert.ok((await d.screenshot(path.join(process.env.HIMA_UI_ARTIFACTS, `${name}.png`))).ok);
  };
  try {
    await d.open('/');
    await browser.wait(`document.body.innerText.includes('Internal Testing Notice')`);
    await browser.markText('button', 'Continue', 'notice-continue');
    assert.ok((await d.click('notice-continue')).ok);
    const host = await d.host(); assert.ok(host.ok);
    const cookie = await d.cookie();
    const workspace = await api(host, cookie, '/api/workspace/create', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'hima-owned-workspace', method: 'workspace/create', payload: { args: { request: { path: home.h.workspace } } } }),
    });
    const created = await workspace.json() as { result: { ok: boolean } };
    assert.equal(created.result.ok, true, JSON.stringify(created));
    await browser.wait(`document.querySelector('[role="treegrid"], [role="tree"]')?.textContent.includes('workspace') || [...document.querySelectorAll('[role="row"]')].some(e=>e.textContent.trim()==='workspace')`);
    await browser.markText('button', 'New Session', 'native-new-session');
    assert.ok((await d.click('native-new-session')).ok);
    await browser.wait(`!document.querySelector('[data-hima-control="open-workbench"]').disabled`);
    await browser.evaluate(`document.querySelector('[contenteditable="true"]').focus()`);
    await browser.send('Input.insertText', { text: initialDraft });
    assert.ok((await d.click('open-workbench')).ok);
    assert.ok((await d.wait('studio', 'Campaign workspace', 12_000)).ok);
    const studio = await d.read('studio'); assert.ok(studio.ok);
    const selectedSession = studio.state.session;
    const url = await browser.evaluate<string>('location.href');
    await fillConfiguration(d, browser, {
      pack: timingProbePackId, site: 'local',
      goal: { target_period_ns: '2.0' }, knobs: { periodNs: '2.3' },
      budget: { timeBoxMinutes: '2', generations: '2' },
    });
    await browser.evaluate(`(() => {
      window.__himaDelivery = [];
      addEventListener('error', event => window.__himaDelivery.push({ error: event.message, stack: event.error?.stack }));
      addEventListener('unhandledrejection', event => window.__himaDelivery.push({ rejection: String(event.reason), stack: event.reason?.stack }));
      const original = window.fetch;
      window.fetch = async (...args) => {
        const response = await original(...args);
        const url = String(args[0]);
        if (url.includes('/runs/start') || url.includes('/session/prompt')) window.__himaDelivery.push({ url, body: await response.clone().text() });
        return response;
      };
    })()`);
    assert.ok((await d.click('config-confirm')).ok);
    await browser.wait(`document.body.innerText.includes(${JSON.stringify(replayJobStarted)})`, 30_000);
    const running = await d.read('studio'); assert.ok(running.ok);
    const runId = running.state.run; assert.ok(runId);
    const readRun = async () => {
      const view = await (await api(host, cookie, `/hima/api/runs/${runId}`)).json() as RunView;
      for (const job of view.jobs) jobSessions.add(job.job.session);
      return view;
    };
    const first = await readRun();
    assert.equal(first.run.control?.owner, selectedSession);
    const execution = Object.values(first.run.control!.executions)[0]; assert.ok(execution);
    assert.equal(execution.phase, 'working');
    assert.equal(first.jobs.filter((job) => job.event === 'launched').length, 1);
    assert.equal(await browser.evaluate(`document.querySelector('[contenteditable="true"]').textContent`), initialDraft);
    await browser.wait(`document.querySelector('.hima-studio [data-hima-state-execution="${execution.id}"]')?.getAttribute('data-hima-state-phase')==='working'`);
    await capture('owned-running');

    // A normal user message, not a control-button-generated prompt, steers the same Agent.
    await browser.evaluate(`(() => { const e=document.querySelector('[contenteditable="true"]'); e.focus(); const r=document.createRange(); r.selectNodeContents(e); const s=getSelection(); s.removeAllRanges(); s.addRange(r); })()`);
    await browser.send('Input.insertText', { text: 'Pause synthesize now and inspect the current facts. Keep this conversation responsive.' });
    await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await browser.wait(`document.body.innerText.includes(${JSON.stringify(replayPaused)})`, 20_000);
    const paused = await readRun();
    assert.deepEqual(paused.run.control?.paused, ['synthesize']);
    assert.equal(paused.run.control?.executions[execution.id]?.phase, 'working', 'typed steering completed before the actual long Job ended');
    assert.equal(paused.jobs.filter((job) => job.event === 'launched').length, 1);
    await browser.evaluate(`document.querySelector('[contenteditable="true"]').focus()`);
    await browser.send('Input.insertText', { text: continuedDraft });
    await browser.wait(`document.querySelector('.hima-studio [data-hima-region="execution-control"]')?.textContent.includes('New work paused')`);
    await capture('owned-paused');
    await browser.wait(`document.querySelector('.hima-studio [data-hima-state-execution="${execution.id}"]')?.getAttribute('data-hima-state-phase')==='ready'`, 40_000);
    assert.deepEqual((await readRun()).run.control?.paused, ['synthesize']);
    await browser.mark('.hima-studio [data-hima-control="continue-node-synthesize"]', 'owned-native-continue');
    assert.ok((await d.click('owned-native-continue')).ok);
    await browser.wait(`document.body.innerText.includes(${JSON.stringify(replayCompleted)})`, 20_000);
    const complete = await readRun();
    assert.equal(complete.run.control?.executions[execution.id]?.phase, 'completed');
    assert.equal(complete.run.currentNode, 'read-qor');
    assert.equal(Object.values(complete.run.control!.executions).length, 1);
    assert.equal(complete.jobs.filter((job) => job.event === 'launched').length, 1);
    assert.equal(await browser.evaluate('location.href'), url);
    assert.equal(await browser.evaluate(`document.querySelector('[contenteditable="true"]').textContent`), continuedDraft);
    await capture('owned-after-continue');

    await browser.markText('button', 'Files & code', 'native-files');
    assert.ok((await d.click('native-files')).ok);
    await browser.wait(`document.body.innerText.includes(${JSON.stringify(complete.run.campaignId)})`);
    await browser.markText('button', complete.run.campaignId, 'campaign-files');
    assert.ok((await d.click('campaign-files')).ok);
    await browser.wait(`document.body.innerText.includes('workspace.json')`);
    await browser.markText('button', 'workspace.json', 'workspace-record');
    assert.ok((await d.click('workspace-record')).ok);
    await browser.wait(`document.body.innerText.includes('flowRoot')`);
    assert.equal(await browser.evaluate('location.href'), url);
    assert.equal(await browser.evaluate(`document.querySelector('[contenteditable="true"]').textContent`), continuedDraft);
    await capture('owned-native-files');
  } catch (error) {
    t.diagnostic(await browser.evaluate<string>('document.body.innerText'));
    t.diagnostic(d.stderr());
    t.diagnostic(JSON.stringify(await browser.evaluate('window.__himaDelivery'), null, 2));
    await capture('owned-failure');
    throw error;
  } finally { killSessions([...jobSessions]); browser.close(); await d.dispose(); await home.h.dispose(); }
});
