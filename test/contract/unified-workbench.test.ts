// @hima-seam llm-replay direct
// L3: native dsh conversation + Hima dock. Real Host and DBOS local tasks; no real model or SSH.
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { appendFile, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { bootDriver, fillConfiguration, waitForConfigurationReady, type BootedDriver } from './support/driver.ts';
import { freePort } from './support/boot-host.ts';
import { api } from './support/hima-api.ts';
import { bootInProcess, createRootAgent } from './support/boot-inprocess.ts';
import { inspectWindow } from './support/inspect-window.ts';
import { writeSampleReport } from './support/site.ts';
import { localHome } from './support/fabric.ts';
import { packsDirOf, timingProbePackId, writePackVariant } from './support/pack.ts';
import { repoRoot } from './support/dsh-home.ts';
import { QUIET_TITLE_ROW } from './support/pipeline.ts';
import { packDigestOf, retainRunMaterial, type RunView } from '@hima/harness';
import type { ReplayEntry } from '@deepseek-ai/dsh-llm-replay';

type Inspector = Awaited<ReturnType<typeof inspectWindow>>;
const draft = 'UI validation draft — compare strategies and preserve each experiment’s evidence. Not sent to a model.';

async function prepareSession(d: BootedDriver, browser: Inspector, modelReady = false) {
  await d.open('/');
  await browser.wait(`document.body.innerText.includes('Internal Testing Notice')`);
  await browser.markText('button', 'Continue', 'notice-continue');
  assert.ok((await d.click('notice-continue')).ok);
  if (!modelReady) {
    // The keyless isolated home may already have its silent test model configured.
    await browser.wait(`document.body.innerText.includes('Configure later') || document.body.innerText.includes('Choose a workspace to begin')`);
    if (await browser.evaluate(`document.body.innerText.includes('Configure later')`)) {
      await browser.markText('button', 'Configure later', 'models-later');
      assert.ok((await d.click('models-later')).ok);
    }
  }
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
  assert.ok((await d.wait('studio', 'Campaign configuration', 12_000)).ok);
  const studio = await d.read('studio'); assert.ok(studio.ok);
  const sessionId = studio.state.session; assert.ok(sessionId);
  return { host, cookie, sessionId };
}

/** Fill the Configuration page (#41 task 7) for the shipped timing-probe Pack: the same document
 *  every case in this file confirms a Campaign from, replacing the old start form's own advanced
 *  disclosure and knob fields. */
async function fillStart(d: BootedDriver, browser: Inspector, target = '2.25', retries = '0') {
  await fillConfiguration(d, browser, {
    pack: timingProbePackId, site: 'local',
    goal: { target_period_ns: target }, knobs: { periodNs: '2.3' },
    budget: { timeBoxMinutes: '5', retries, generations: '6' },
  });
}

/** The next paused request of a given HTTP method, passing any other one straight through — the
 *  Configuration page polls `GET /hima/api/campaign` every three seconds on the very same path a
 *  test pauses to fail one particular `PUT` on, so a plain `nextPaused()` could just as easily hand
 *  back an unrelated poll instead of the save under test. */
async function nextPausedMethod(browser: Inspector, method: string) {
  for (;;) {
    const candidate = await browser.nextPaused();
    if (candidate.request.method === method) return candidate;
    await browser.send('Fetch.continueRequest', { requestId: candidate.requestId });
  }
}

async function currentRun(d: BootedDriver): Promise<string> {
  const studio = await d.read('studio'); assert.ok(studio.ok, JSON.stringify(studio));
  const id = studio.state.run; assert.ok(id);
  return id;
}

/** Wait for the Configuration page's own pane to have settled into its final width (review MINOR):
 *  a screenshot taken mid-layout (the dock still animating open, or the pane not yet at its resting
 *  size) would capture a transient, narrower frame rather than the document a person actually sees. */
async function waitForConfigurationPaneSettled(browser: Inspector, minWidth = 500): Promise<void> {
  await browser.wait(`(() => {
    const el = document.querySelector('[data-hima-region="configuration"]');
    if (!el) return false;
    const width = el.getBoundingClientRect().width;
    if (width <= ${minWidth}) return false;
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => {
      resolve(el.getBoundingClientRect().width === width);
    })));
  })()`, 10_000);
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
    const studio = await d.read('studio');
    const sessionId = studio.ok ? studio.state.session : undefined;
    const listed = await api(host, cookie, `/hima/api/runs?sessionId=${encodeURIComponent(sessionId ?? '')}`);
    const { runs = [] } = await listed.json() as { runs?: RunView['run'][] };
    for (const run of runs.filter(run => run.status === 'running' || run.status === 'waiting')) {
      if (run.control) await api(host, cookie, `/hima/api/runs/${run.id}/control`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, action: 'cancel', expectedEpoch: run.control.epoch,
          expectedRevision: run.control.revision, requestId: `cleanup-${run.id}` }),
      });
      else await api(host, cookie, `/hima/api/runs/${run.id}/cancel?sessionId=${encodeURIComponent(sessionId ?? '')}`, { method: 'POST' });
    }
  }
  await d.dispose();
}

test('Guide keeps its conversation while Campaign and Data Insight remain peer modes', async t => {
  const home = await localHome(t, { sleepSeconds: 0 });
  if (!home) return;
  const port = await freePort();
  const d = await bootDriver(t, { existing: home.h, remoteDebuggingPort: port,
    window: { width: 1440, height: 960 }, env: { HIMA_TEST_SILENT_AGENT: '1' } });
  if (!d) { await home.h.dispose(); return; }
  let browser: Inspector | undefined;
  try {
    browser = await inspectWindow(port);
    const { host, cookie } = await prepareSession(d, browser);
    const initial = await d.read('studio'); assert.ok(initial.ok);
    const guide = initial.state.session;
    assert.ok((await d.click('studio-mode-insight')).ok);
    assert.ok((await d.wait('studio', 'Data Insight', 5000)).ok);
    const insight = await d.read('studio'); assert.ok(insight.ok);
    assert.equal(insight.state.mode, 'insight');
    const before = await (await api(host, cookie, `/hima/api/runs?sessionId=${guide}`)).json() as { runs: unknown[] };
    assert.equal(before.runs.length, 0, 'browsing Insight creates no empty Campaign');
    assert.equal(await browser.evaluate(`document.querySelector('[contenteditable="true"]').textContent`), draft);
    await capture(d, browser, 'next-stage-insight-preparation');
    assert.ok((await d.click('studio-mode-campaign')).ok);
    await fillStart(d, browser);
    assert.ok((await d.click('config-confirm')).ok);
    await browser.wait(`!!document.querySelector('[data-hima-region="studio"]').getAttribute('data-hima-state-run')`, 15_000);
    const runId = await currentRun(d);
    const view = await (await api(host, cookie, `/hima/api/runs/${runId}?sessionId=${guide}`)).json() as RunView;
    assert.equal(view.run.control?.guideSessionId, guide);
    assert.notEqual(view.run.control?.owner, guide);
    assert.equal(view.run.engine, 'dbos/5.2.11', 'the workflow executes independently of the silent conversational model');
    const running = await d.read('studio'); assert.ok(running.ok);
    assert.equal(running.state.session, guide, 'dispatch never switches or occupies Guide');
    assert.ok((await d.click('studio-mode-insight')).ok);
    assert.ok((await d.click('studio-mode-campaign')).ok);
    assert.equal(await currentRun(d), runId);
    assert.equal(await browser.evaluate(`document.querySelector('[contenteditable="true"]').textContent`), draft);
    assert.equal(await browser.evaluate(`(() => {
      const pane=document.querySelector('[data-hima-region="studio"]').getBoundingClientRect();
      return [...document.querySelectorAll('.hima-studio-header button')].every(button => {
        const r=button.getBoundingClientRect(); return r.left >= pane.left && r.right <= pane.right + 1;
      });
    })()`), true, 'both mode and asset controls remain reachable in the narrow dock');
    await capture(d, browser, 'next-stage-independent-guide');
  } finally { await finish(d, browser); await home.h.dispose(); }
});

test('Data Insight shows the LibInsight pages in place and keeps them across a mode switch (ADR-0019)', async t => {
  const home = await localHome(t, { sleepSeconds: 0 });
  if (!home) return;
  // A stand-in LibInsight checkout and data folder: the Host starts its server.py exactly as it starts
  // the real one, and the dock frames whatever page that server answers.
  const code = path.join(home.h.home, 'libinsight-test', 'code'), data = path.join(home.h.home, 'libinsight-test', 'checkout', 'data');
  await mkdir(path.join(code, 'app'), { recursive: true });
  await writeFile(path.join(code, 'app', 'server.py'), await readFile(path.join(repoRoot, 'test/fixtures/libinsight-viewer/app/server.py')));
  await mkdir(data, { recursive: true });
  await writeFile(path.join(data, 'app.json'), JSON.stringify({ data_root: 'data', kits: [{ id: 'fixture-kit', manifest: 'kits/fixture-kit.json' }] }));
  const port = await freePort();
  const d = await bootDriver(t, { existing: home.h, remoteDebuggingPort: port, window: { width: 1440, height: 960 },
    env: { HIMA_TEST_SILENT_AGENT: '1', HIMA_LIBINSIGHT_ROOT: code, HIMA_LIBINSIGHT_DATA: data } });
  if (!d) { await home.h.dispose(); return; }
  let browser: Inspector | undefined;
  try {
    browser = await inspectWindow(port);
    const { host, cookie } = await prepareSession(d, browser);
    const studio = await d.read('studio'); assert.ok(studio.ok);
    const guide = studio.state.session;
    assert.ok((await d.click('studio-mode-insight')).ok);
    await browser.wait(`document.querySelector('[data-hima-region="libinsight"]')?.getAttribute('data-hima-state-viewer') === 'ready'`, 30_000);
    const src = await browser.evaluate(`document.querySelector('[data-hima-control="libinsight-frame"]').src`) as string;
    assert.match(src, /^http:\/\/localhost:\d+\/$/);
    // The frame's own document, read through its own Chromium target: the page really rendered in
    // the dock (no frame block, no blank), and its requests carry no Host session cookie.
    let frame: Inspector | undefined;
    for (let i = 0; i < 40 && frame === undefined; i += 1) {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() as { type: string; url: string }[];
      if (targets.some(entry => entry.type === 'iframe' && entry.url.startsWith(src))) frame = await inspectWindow(port, entry => entry.type === 'iframe' && entry.url.startsWith(src));
      else await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.ok(frame, 'the LibInsight frame is its own rendered document');
    try {
      await frame.wait(`document.body.innerText.includes('LibInsight fixture')`, 10_000);
      const headers = await frame.evaluate(`fetch('/headers').then(r => r.json())`) as Record<string, string>;
      assert.equal(Object.keys(headers).find(name => name.toLowerCase() === 'cookie'), undefined, 'the Host cookie never reaches the viewer');
    } finally { frame.close(); }
    // The frame really loads inside the dock: its own document is cross-origin, so the load is
    // observed from outside and the element is marked, then must survive a trip to Campaign.
    await browser.evaluate(`(() => { const f=document.querySelector('[data-hima-control="libinsight-frame"]'); f.dataset.testMark='kept'; return true; })()`);
    await browser.wait(`(() => { const f=document.querySelector('[data-hima-control="libinsight-frame"]'); const r=f.getBoundingClientRect(); return r.width > 400 && r.height > 300; })()`, 10_000);
    await capture(d, browser, 'data-insight-libinsight');
    assert.ok((await d.click('studio-mode-campaign')).ok);
    assert.equal(await browser.evaluate(`document.querySelector('[data-hima-region="libinsight"]').hidden`), true);
    assert.ok((await d.click('studio-mode-insight')).ok);
    assert.equal(await browser.evaluate(`document.querySelector('[data-hima-control="libinsight-frame"]').dataset.testMark`), 'kept', 'switching modes does not reload LibInsight');
    // Retained reports stay one click away and lead back again.
    assert.ok((await d.click('insight-show-reports')).ok);
    assert.ok((await d.wait('studio', 'Choose retained data to inspect', 5000)).ok);
    assert.ok((await d.click('insight-show-libinsight')).ok);
    assert.equal(await browser.evaluate(`document.querySelector('[data-hima-control="libinsight-frame"]').dataset.testMark`), 'kept');
    const status = await (await api(host, cookie, `/hima/api/libinsight?sessionId=${encodeURIComponent(guide ?? '')}`)).json() as { state: string; dataFolder: string };
    assert.equal(status.state, 'ready'); assert.equal(status.dataFolder, data);
    // "Data folder…" always leads somewhere: when the shell's picker answers nothing (trial.38 found
    // this as a click with no effect), the typed path is offered, and a typed folder moves the viewer.
    const other = path.join(home.h.home, 'libinsight-test', 'other', 'data');
    await mkdir(other, { recursive: true });
    await writeFile(path.join(other, 'app.json'), JSON.stringify({ data_root: 'data', kits: [{ id: 'second-kit', manifest: 'kits/second-kit.json' }] }));
    assert.ok((await d.click('libinsight-choose-data')).ok);
    await browser.wait(`!!document.querySelector('[data-hima-control="libinsight-data-folder"]')`, 10_000);
    await browser.evaluate(`(() => { const input=document.querySelector('[data-hima-control="libinsight-data-folder"]'); const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; set.call(input, ${JSON.stringify(other)}); input.dispatchEvent(new Event('input',{bubbles:true})); return true; })()`);
    await browser.markText('button', 'Open', 'libinsight-open-folder');
    assert.ok((await d.click('libinsight-open-folder')).ok);
    await browser.wait(`(document.querySelector('[data-hima-region="libinsight"] header')?.textContent ?? '').includes('other/data') && document.querySelector('[data-hima-region="libinsight"]').getAttribute('data-hima-state-viewer') === 'ready'`, 30_000);
    const moved = await (await api(host, cookie, `/hima/api/libinsight?sessionId=${encodeURIComponent(guide ?? '')}`)).json() as { state: string; dataFolder: string; kits: string[] };
    assert.equal(moved.dataFolder, other); assert.deepEqual(moved.kits, ['second-kit']);
    const refused = await api(host, cookie, '/hima/api/libinsight?sessionId=not-a-session');
    assert.equal(refused.status, 403, 'only a live conversation may ask where the viewer is');
    const runs = await (await api(host, cookie, `/hima/api/runs?sessionId=${guide}`)).json() as { runs: unknown[] };
    assert.equal(runs.runs.length, 0, 'browsing LibInsight creates no Campaign');
  } finally { await finish(d, browser); await home.h.dispose(); }
});

test('ordinary conversation opens the chosen Pack authoring session with native chat, files and Live Run together', async (t) => {
  const home = await localHome(t, { sleepSeconds: 0 });
  if (!home) return;
  // Keep title generation from consuming a tool replay turn; this is a model stand-in only.
  await appendFile(path.join(home.h.profileDir, 'cordis.patch.yml'), QUIET_TITLE_ROW);
  const fixture = path.join(repoRoot, 'test/fixtures/pipeline/workshop');
  const port = await freePort();
  const d = await bootDriver(t, { existing: home.h, theme: 'light', window: { width: 1440, height: 960 }, remoteDebuggingPort: port,
    model: { replay: { file: path.join(fixture, 'session.jsonl'), override: path.join(fixture, 'open.override.json') } } });
  if (!d) { await home.h.dispose(); return; }
  let browser: Inspector | undefined;
  try {
    browser = await inspectWindow(port);
    await prepareSession(d, browser, true);
    const original = await d.read('studio'); assert.ok(original.ok);
    const url = await browser.evaluate<string>('location.href');
    await browser.evaluate(`(() => { const e=document.querySelector('[contenteditable="true"]'); e.focus(); const r=document.createRange(); r.selectNodeContents(e); const s=getSelection(); s.removeAllRanges(); s.addRange(r); })()`);
    await browser.send('Input.insertText', { text: 'Create a new Pack named window-author for me to author.' });
    await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await browser.wait(`!!document.querySelector('[data-hima-control="open-authoring"]')`, 20_000);
    await browser.wait(`document.body.innerText.includes('1 tool call')`, 12_000);
    await browser.markText('*', '1 tool call', 'expand-authoring-tool');
    assert.ok((await d.click('expand-authoring-tool')).ok);
    await browser.wait(`document.querySelector('[data-hima-control="open-authoring"]')?.getBoundingClientRect().height > 0`);
    await capture(d, browser, 'authoring-created');
    assert.ok((await d.click('open-authoring')).ok);
    await browser.wait(`!document.querySelector('[data-hima-control="open-authoring"]')`);
    assert.ok((await d.click('open-workbench')).ok);
    await browser.wait(`!!document.querySelector('[data-hima-region="studio"]') && document.querySelector('[data-hima-region="studio"]').getAttribute('data-hima-state-session') !== ${JSON.stringify(original.state.session)}`);
    const chosen = await d.read('studio'); assert.ok(chosen.ok);
    assert.notEqual(chosen.state.session, original.state.session);
    assert.equal(await browser.evaluate('location.href'), url);
    await browser.wait(`!!document.querySelector('[contenteditable="true"]')`).catch(async (error: unknown) => {
      t.diagnostic(await browser!.evaluate<string>('document.body.innerText'));
      await capture(d, browser!, 'authoring-failure'); throw error;
    });
    assert.equal(await realpath(path.join(packsDirOf(home.h), 'window-author')), path.join(await realpath(packsDirOf(home.h)), 'window-author'));
    await capture(d, browser, 'authoring-native-session');
    await browser.markText('button', 'Files & code', 'author-files');
    assert.ok((await d.click('author-files')).ok);
    await browser.wait(`document.body.innerText.includes('window-author')`);
  } finally { await finish(d, browser); await home.h.dispose(); }
});

test('conversation draft, native files and verified reports share one workspace with a real Run', async (t) => {
  const port = await freePort();
  const d = await bootDriver(t, { home: 'hima', sleepSeconds: 2, env: { HIMA_TEST_SILENT_AGENT: '1' }, theme: 'light', window: { width: 1440, height: 960 }, remoteDebuggingPort: port });
  if (!d) return;
  let browser: Inspector | undefined;
  try {
    browser = await inspectWindow(port);
    const { host, cookie, sessionId } = await prepareSession(d, browser);
    const url = await browser.evaluate<string>('location.href');
    await waitForConfigurationPaneSettled(browser);
    await capture(d, browser, 'configuration-empty');
    await fillStart(d, browser);
    await capture(d, browser, 'configuration-ready');
    await capture(d, browser, 'light-start');
    assert.ok((await d.click('config-confirm')).ok);
    // Start acknowledges the durable Run; completion is observed from its current projection.
    assert.ok((await d.wait('campaign-masthead', 'ended · Goal met', 35_000)).ok);
    const id = await currentRun(d);
    const started = await (await api(host, cookie, `/hima/api/runs/${id}?sessionId=${encodeURIComponent(sessionId)}`)).json() as RunView;
    assert.equal(started.run.status, 'ended-goal-met');
    assert.equal(started.run.engine, 'dbos/5.2.11');
    assert.ok(started.jobs.some(job => job.event === 'launched'), 'the Run executed an actual local tool');
    assert.ok(started.tasks?.some(task => task.current && task.result), 'the current Task results remain inspectable');
    assert.equal(started.run.control?.guideSessionId, sessionId);
    assert.notEqual(started.run.control?.owner, sessionId, 'the Guide remains separate from the execution owner');
    assert.equal(await browser.evaluate(`document.querySelector('[data-hima-region="campaign-chip"]') === null`), true);
    assert.equal(await browser.evaluate('document.body.innerText.includes(\'Hima Workspace\')'), true);
    await capture(d, browser, 'light-complete');
    assert.equal(await browser.evaluate('location.href'), url, 'opening and running did not navigate the document');
    assert.equal(await browser.evaluate(`document.querySelector('[contenteditable="true"]').textContent`), draft);
    assert.ok((await d.click('studio-evidence')).ok);
    assert.ok((await d.wait('studio', 'clock-period-at-most', 10_000)).ok);
    assert.ok((await d.wait('studio', 'sha256', 10_000)).ok, 'the judgment exposes original citations');
    assert.ok((await d.click('studio-report')).ok);
    await browser.mark('.hima-studio a[href*="/experience.md?"]', 'open-saved-report');
    assert.ok((await d.click('open-saved-report')).ok);
    assert.ok((await d.wait('studio', 'original bytes verified by the Host', 12_000)).ok);
    await capture(d, browser, 'light-report');
    const view = await (await api(host, cookie, `/hima/api/runs/${id}?sessionId=${encodeURIComponent(sessionId)}`)).json() as RunView;
    assert.ok(view.experience);
    const file = view.experience.markdown.path;
    const original = await readFile(file);
    try {
      await writeFile(file, 'changed after publication');
      await browser.markText('button', 'Current ledger preview', 'current-preview');
      assert.ok((await d.click('current-preview')).ok);
      await browser.mark('.hima-studio a[href*="/experience.md?"]', 'open-saved-report');
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
  } catch (error) {
    t.diagnostic(await browser!.evaluate<string>('document.body.innerText'));
    t.diagnostic(d.stderr());
    throw error;
  } finally { await finish(d, browser); }
});

test('preparation retries preserve drafts, pending starts cannot be replaced, and a continued DBOS Run remains cancellable', async (t) => {
  const port = await freePort();
  const d = await bootDriver(t, { home: 'hima', sleepSeconds: 20, env: { HIMA_TEST_SILENT_AGENT: '1' }, theme: 'dark', window: { width: 1280, height: 860 }, remoteDebuggingPort: port });
  if (!d) return;
  let browser: Inspector | undefined;
  try {
    const siteFile = path.join(d.home.home, 'hima/sites/local.yml');
    await writeFile(path.join(d.home.home, 'hima/sites/other.yml'), (await readFile(siteFile, 'utf8')).replace('name: local', 'name: other'));
    browser = await inspectWindow(port);
    const { host, cookie, sessionId } = await prepareSession(d, browser);
    const sample = await writeSampleReport(d.home);
    const probe = await (await api(host, cookie, '/hima/api/observe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId, site: 'local', path: path.join(d.home.workspace, sample.rel) }) })).json() as RunView;
    assert.ok(probe.run?.id);
    await fillStart(d, browser, '2.3');
    // A failed save keeps what the person typed, and never enables Confirm until the file is ready
    // again — the Configuration page's own equivalent of the old form's preparation-check retry.
    await browser.pause('*/hima/api/campaign*');
    assert.ok((await d.fill('config-site', 'other')).ok);
    const failedSave = await nextPausedMethod(browser, 'PUT');
    await browser.send('Fetch.fulfillRequest', { requestId: failedSave.requestId, responseCode: 503, body: Buffer.from(JSON.stringify({ error: { code: 'hima/internal', message: 'temporary preparation failure' } })).toString('base64') });
    assert.ok((await d.wait('configuration', 'temporary preparation failure', 12_000)).ok);
    assert.equal(await browser.evaluate(`document.querySelector('[data-hima-control="config-goal-target_period_ns"]').value`), '2.3');
    assert.equal(await browser.evaluate(`document.querySelector('[data-hima-control="config-confirm"]').disabled`), true);
    await browser.send('Fetch.disable');
    assert.ok((await d.fill('config-site', 'other')).ok);
    await waitForConfigurationReady(d, timingProbePackId, 'other');
    await browser.pause('*/hima/api/runs/start');
    assert.ok((await d.click('config-confirm')).ok);
    const starting = await browser.nextPaused();
    // Confirm is disabled the instant the first click's own state update lands, so an ordinary
    // second click cannot even reach the page — proven directly, then the guard behind it is proven
    // by dispatching a raw click event, which reaches React's delegated listener regardless of the
    // `disabled` attribute the way a fast double click racing that same re-render could.
    assert.equal(await browser.evaluate(`document.querySelector('[data-hima-control="config-confirm"]').disabled`), true);
    await browser.evaluate(`document.querySelector('[data-hima-control="config-confirm"]').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))`);
    const runs = await (await api(host, cookie, `/hima/api/runs?sessionId=${encodeURIComponent(sessionId)}`)).json() as { runs: RunView['run'][] };
    assert.equal(runs.runs.length, 2, 'one Probe and exactly one Campaign despite repeated confirm clicks while its HTTP response is paused');
    assert.equal(await browser.evaluate(`document.querySelector('[data-hima-control="studio-run"]').disabled`), true, 'selection cannot replace the pending start');
    await browser.send('Fetch.continueRequest', { requestId: starting.requestId }); await browser.send('Fetch.disable');
    await browser.wait(`document.querySelector('[data-hima-region="campaign-node-synthesize"]')?.getAttribute('data-hima-state-task-status') === 'running'`, 25_000);
    const id = await currentRun(d);
    const running = await (await api(host, cookie, `/hima/api/runs/${id}?sessionId=${encodeURIComponent(sessionId)}`)).json() as RunView;
    assert.equal(running.run.engine, 'dbos/5.2.11');
    const launched = running.jobs.filter(job => job.event === 'launched').map(job => job.recordId);
    assert.ok(launched.length > 0);
    assert.ok((await d.click('node-synthesize')).ok);
    await browser.evaluate(`document.querySelector('[data-hima-region="emergency"]').open = true`);
    assert.ok((await d.click('run-pause')).ok);
    assert.ok((await d.click('run-pause-confirm')).ok);
    await browser.wait(`!!document.querySelector('[data-hima-control="run-continue"]')`, 10_000);
    await capture(d, browser, 'dark-paused');
    assert.ok((await d.click('run-continue')).ok);
    assert.ok((await d.click('run-continue-confirm')).ok);
    await browser.wait(`document.querySelector('[data-hima-control="run-continue"]') === null`, 10_000);
    assert.equal(await browser.evaluate(`document.querySelector('[data-hima-control="run-stop"]').disabled`), false, 'Stop remains available after continuing the Run');
    await browser.wait(`[...document.querySelector('[data-hima-control="studio-run"]').options].some(o => o.value === ${JSON.stringify(probe.run.id)})`);
    assert.ok((await d.fill('studio-run', probe.run.id)).ok);
    assert.ok((await d.wait('campaign-masthead', 'No Fabric state recorded', 10_000)).ok);
    assert.ok((await d.fill('studio-run', id)).ok);
    await browser.wait(`!!document.querySelector('[data-hima-region="campaign-node-synthesize"]')`);
    assert.ok((await d.click('node-synthesize')).ok);
    await browser.evaluate(`document.querySelector('[data-hima-region="emergency"]').open = true`);
    assert.ok((await d.click('run-stop')).ok);
    assert.ok((await d.click('run-stop-confirm')).ok);
    assert.ok((await d.wait('campaign-masthead', 'cancelled', 15_000)).ok);
    assert.ok((await d.wait('campaign-masthead', 'stop closed', 15_000)).ok);
    const ended = await (await api(host, cookie, `/hima/api/runs/${id}?sessionId=${encodeURIComponent(sessionId)}`)).json() as RunView;
    assert.equal(ended.run.status, 'cancelled', 'the scoped read retains the authoritative stop decision');
    assert.equal(ended.run.stopState?.closed, true, 'the original task resources are physically closed');
    assert.equal(ended.run.stopState?.unclosedResources, 0);
    assert.equal(ended.run.stopState?.effectsWithoutStopProof, 0);
    assert.deepEqual(ended.jobs.filter(job => job.event === 'launched').map(job => job.recordId), launched, 'selection and continuation do not submit the running Task twice');
    assert.equal(await browser.evaluate(`document.querySelector('[contenteditable="true"]').textContent`), draft);
    await capture(d, browser, 'dark-cancelled');
  } catch (error) {
    t.diagnostic(await browser!.evaluate<string>('document.body.innerText'));
    t.diagnostic(d.stderr());
    throw error;
  } finally { await finish(d, browser); }
});

test('historical Code and Knowledge retain verified material reads in the dock and native context card', async (t) => {
  const home = await localHome(t, { sleepSeconds: 0 });
  if (!home) return;
  // Retained historical records are read-only compatibility fixtures, never Workshop execution.
  const seed = await bootInProcess(home.h);
  let id: string;
  let codeRecordId: string;
  let knowledgeRecordId: string;
  const codeText = '#!/bin/sh\n# Retained historical source; this fixture never executes it.\nset -eu\n';
  const knowledgeText = '# Historical method knowledge\nRead the retained source bytes before drawing a conclusion.\n';
  const hash = (text: string) => createHash('sha256').update(text).digest('hex');
  try {
    const owner = await createRootAgent(seed.ctx, home.h.workspace);
    const run = await seed.ctx.hima.ledger.createRun({ campaignId: 'historical-material-fixture', siteId: 'local',
      packId: timingProbePackId, packDigest: packDigestOf(path.join(packsDirOf(home.h), timingProbePackId)),
      status: 'cancelled', currentNode: 'synthesize',
      control: { mode: 'agent', owner: String(owner.id), epoch: 1, revision: 0, paused: [], executions: {}, requests: {} } });
    id = run.id;
    const deps = { ledger: seed.ctx.hima.ledger, packsDir: packsDirOf(home.h) };
    const source = path.join(home.h.workspace, 'historical-miner.sh');
    const knowledgeSource = path.join(home.h.workspace, 'historical-mining.md');
    await writeFile(source, codeText); await writeFile(knowledgeSource, knowledgeText);
    const codeRetained = await retainRunMaterial(deps, id, Buffer.from(codeText), hash(codeText));
    const knowledgeRetained = await retainRunMaterial(deps, id, Buffer.from(knowledgeText), hash(knowledgeText));
    assert.ok(codeRetained); assert.ok(knowledgeRetained);
    const common = { nodeId: 'synthesize', attempt: 1, sessionId: String(owner.id), workshop: 'historical-mining' };
    const code = await seed.ctx.hima.ledger.appendCode(id, { ...common, path: source, retainedPath: codeRetained,
      sha256: hash(codeText), bytes: Buffer.byteLength(codeText), language: 'shell' });
    const knowledge = await seed.ctx.hima.ledger.appendKnowledge(id, { ...common, origin: 'legacyPack',
      file: 'mining.md', purpose: 'retained historical method knowledge', path: knowledgeSource, retainedPath: knowledgeRetained,
      sha256: hash(knowledgeText), bytes: Buffer.byteLength(knowledgeText) });
    codeRecordId = code.id; knowledgeRecordId = knowledge.id;
    // Reads must use the retained originals, even when the live source paths have changed.
    await writeFile(source, 'changed live code\n'); await writeFile(knowledgeSource, 'changed live knowledge\n');
  } finally { await seed.dispose(); }
  const replayDir = path.join(home.h.home, 'historical-material-replay'); await mkdir(replayDir);
  const file = path.join(replayDir, 'session.jsonl'), override = path.join(replayDir, 'replay.override.json');
  await writeFile(file, `${JSON.stringify({ version: 0, type: 'session', id: 'session-historical-material', createdAt: 0, cwd: '{{cwd}}' })}\n`);
  const say = (text: string): ReplayEntry => ({ kind: 'chunks', chunks: [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'finish', reason: { kind: 'stop' } },
  ] });
  const replay: ReplayEntry[] = [
    { kind: 'chunks', chunks: [
      { type: 'block-start', index: 0, blockType: 'tool-call' },
      { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'call-native-material-context' as never,
        name: 'hima_context', arguments: JSON.stringify({ run: id }) } },
      { type: 'finish', reason: { kind: 'tool-calls' } },
    ] }, say('Replay: the requested Run context is visible in this conversation.')];
  await writeFile(override, `${JSON.stringify(replay, null, 2)}\n`);
  await appendFile(path.join(home.h.profileDir, 'cordis.patch.yml'), QUIET_TITLE_ROW);
  const port = await freePort();
  const d = await bootDriver(t, { existing: home.h, model: { replay: { file, override, children: [] } }, remoteDebuggingPort: port });
  if (!d) { await home.h.dispose(); return; }
  let browser: Inspector | undefined;
  try {
    browser = await inspectWindow(port);
    const { host, cookie, sessionId } = await prepareSession(d, browser, true);
    const url = await browser.evaluate<string>('location.href');
    await browser.wait(`[...document.querySelector('[data-hima-control="studio-run"]').options].some(o => o.value === ${JSON.stringify(id)})`);
    assert.ok((await d.fill('studio-run', id)).ok);
    assert.ok((await d.click('studio-evidence')).ok);
    const view = await (await api(host, cookie, `/hima/api/runs/${id}?sessionId=${encodeURIComponent(sessionId)}`)).json() as RunView;
    assert.equal(view.run.status, 'cancelled');
    assert.equal(view.code.length, 1); assert.equal(view.knowledge.length, 1);
    assert.equal(view.code[0]!.recordId, codeRecordId); assert.equal(view.knowledge[0]!.recordId, knowledgeRecordId);
    assert.ok((await d.wait('run-material', hash(codeText), 12_000)).ok);
    const material = await d.read('run-material'); assert.ok(material.ok);
    assert.ok(material.text.includes(hash(knowledgeText)), material.text);
    const sample = await writeSampleReport(home.h);
    const probe = await (await api(host, cookie, '/hima/api/observe', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, site: 'local', path: path.join(home.h.workspace, sample.rel) }),
    })).json() as RunView;
    assert.ok(probe.run?.id);
    await browser.pause(`*/hima/api/runs/${id}/material/*`);
    assert.ok((await d.click(`material-${codeRecordId}`)).ok);
    const held = await browser.nextPaused();
    await browser.wait(`[...document.querySelector('[data-hima-control="studio-run"]').options].some(o => o.value === ${JSON.stringify(probe.run.id)})`);
    assert.ok((await d.fill('studio-run', probe.run.id)).ok);
    assert.ok((await d.wait('campaign-masthead', 'No Fabric state recorded', 10_000)).ok);
    assert.ok((await d.fill('studio-run', id)).ok);
    assert.ok((await d.wait('run-material', hash(codeText), 10_000)).ok);
    await browser.send('Fetch.continueRequest', { requestId: held.requestId }).catch(() => undefined);
    await browser.send('Fetch.disable');
    await new Promise(resolve => setTimeout(resolve, 250));
    assert.equal(await browser.evaluate(`document.querySelector('[data-hima-region="material-content"]') === null`), true,
      'the old A response cannot populate A after A→B→A changed its material selection');
    assert.ok((await d.click(`material-${codeRecordId}`)).ok);
    assert.ok((await d.wait('material-content', 'set -eu', 12_000)).ok);
    assert.equal(await browser.evaluate(`document.querySelector('[data-hima-region="material-content"]').textContent`), codeText);
    assert.ok((await d.click(`material-${knowledgeRecordId}`)).ok);
    assert.ok((await d.wait('material-content', 'Historical method knowledge', 12_000)).ok);
    assert.equal(await browser.evaluate(`document.querySelector('[data-hima-region="material-content"]').textContent`), knowledgeText);
    assert.equal(await browser.evaluate('location.href'), url);
    assert.equal(await browser.evaluate(`document.querySelector('[contenteditable="true"]').textContent`), draft);
    await browser.evaluate(`(() => { const e=document.querySelector('[contenteditable="true"]'); e.focus(); const r=document.createRange(); r.selectNodeContents(e); const s=getSelection(); s.removeAllRanges(); s.addRange(r); })()`);
    await browser.send('Input.insertText', { text: `Inspect Hima Run ${id} with hima_context and show its recorded materials here.` });
    await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await browser.wait(`document.body.innerText.includes('Replay: the requested Run context is visible in this conversation.')`, 20_000);
    await browser.markText('*', '1 tool call', 'expand-material-tool');
    assert.ok((await d.click('expand-material-tool')).ok);
    const chatMaterial = `[...document.querySelectorAll('[data-hima-region="run-material"]')].find(e => !e.closest('.hima-studio') && e.getBoundingClientRect().height > 0)`;
    await browser.wait(`!!${chatMaterial} && ${chatMaterial}.textContent.includes(${JSON.stringify(hash(codeText))}) && ${chatMaterial}.textContent.includes(${JSON.stringify(hash(knowledgeText))})`);
    assert.ok(await browser.evaluate<boolean>(`!!${chatMaterial}.querySelector('[data-hima-control="material-${codeRecordId}"]')`));
    await browser.evaluate(`(() => { const button=${chatMaterial}.querySelector('[data-hima-control="material-${codeRecordId}"]'); button.setAttribute('data-hima-control', 'chat-material-record'); })()`);
    assert.ok((await d.click('chat-material-record')).ok);
    await browser.wait(`!!${chatMaterial}.querySelector('[data-hima-region="material-content"]') && ${chatMaterial}.querySelector('[data-hima-region="material-content"]').textContent.includes('set -eu')`, 12_000);
    assert.equal(await browser.evaluate(`${chatMaterial}.querySelector('[data-hima-region="material-content"]').textContent`), codeText);
    await capture(d, browser, 'light-historical-material');
  } catch (error) {
    t.diagnostic(await browser!.evaluate<string>('document.body.innerText'));
    t.diagnostic(d.stderr());
    throw error;
  } finally { await finish(d, browser); await home.h.dispose(); }
});

test('a native declared improvement Goal shows its units, refuses precision loss and starts with the exact value', async (t) => {
  const port = await freePort();
  const d = await bootDriver(t, { home: 'hima', sleepSeconds: 0, theme: 'light', window: { width: 1440, height: 960 }, remoteDebuggingPort: port });
  if (!d) return;
  let browser: Inspector | undefined;
  try {
    const pack = 'relative-goal';
    await writePackVariant(packsDirOf(d.home), pack, [
      ['  target_period_ns:', '  improvement_pct:'],
      ['clock period at most, unit: ns', 'relative improvement, unit: "%"'],
    ]);
    const contract = path.join(packsDirOf(d.home), pack, 'contract.yml');
    await writeFile(contract, (await readFile(contract, 'utf8')) + '\ngoal:\n  improvement_pct: { type: number, unit: "%", min: 0, max: 100, default: 5, precision: 2 }\n');
    const graph = path.join(packsDirOf(d.home), pack, 'graph.yml');
    await writeFile(graph, (await readFile(graph, 'utf8')).replaceAll('name: target_period_ns', 'name: improvement_pct'));
    browser = await inspectWindow(port);
    const { host, cookie, sessionId } = await prepareSession(d, browser);
    await browser.wait(`!!document.querySelector('[data-hima-control="config-pack"]')`);
    await browser.wait(`!!document.querySelector('[data-hima-control="config-pack"] option[value="relative-goal"]')`);
    assert.ok((await d.fill('config-pack', pack)).ok);
    await browser.wait(`!!document.querySelector('[data-hima-control="config-goal-improvement_pct"]')`);
    // The Goal is never prefilled from the Pack's own default (#41 task 3): the field starts empty.
    assert.equal(await browser.evaluate(`document.querySelector('[data-hima-control="config-goal-improvement_pct"]').value`), '');
    assert.equal(await browser.evaluate(`document.querySelector('[data-hima-control="config-goal-target_period_ns"]') === null`), true, 'the relative-goal Pack never declares the shipped Pack\'s own goal name');
    assert.ok((await d.fill('config-site', 'local')).ok);
    // Set early and given a whole wait cycle to land, so its own save can never race the one that
    // finally makes the page ready (Budget does not gate readiness, but a save still in flight when
    // Confirm reads the current proposal id would make that id stale the instant it lands).
    assert.ok((await d.fill('config-budget-generations', '1')).ok);
    // The declared unit shown beside the Goal's own label (review item 3), not just the label alone.
    await browser.wait(`document.querySelector('[data-hima-region="configuration"]')?.textContent.includes('relative improvement (%)')`);
    assert.ok((await d.fill('config-goal-improvement_pct', '1.001')).ok);
    await browser.wait(`document.querySelector('[data-hima-region="config-readiness"]')?.textContent.includes('at most 2 decimal places')`);
    await browser.wait(`document.querySelector('[role="alert"]')?.textContent.includes('invalid Goal parameter')`);
    assert.equal(await browser.evaluate(`document.querySelector('[data-hima-control="config-confirm"]').disabled`), true);
    assert.deepEqual(await (await api(host, cookie, `/hima/api/runs?sessionId=${encodeURIComponent(sessionId)}`)).json(), { runs: [] });
    await capture(d, browser, 'pls21-relative-goal-invalid');
    assert.ok((await d.fill('config-goal-improvement_pct', '5.25')).ok);
    await waitForConfigurationReady(d, pack, 'local');
    assert.ok((await d.click('config-confirm')).ok);
    await browser.wait(`!!document.querySelector('[data-hima-region="campaign-masthead"]')`);
    const id = await currentRun(d);
    const view = await (await api(host, cookie, `/hima/api/runs/${id}?sessionId=${encodeURIComponent(sessionId)}`)).json() as RunView;
    assert.deepEqual(view.run.goal, { improvement_pct: 5.25 });
    await capture(d, browser, 'pls21-relative-goal-started');
  } catch (error) {
    t.diagnostic(await browser!.evaluate<string>('document.body.innerText'));
    t.diagnostic(d.stderr());
    throw error;
  } finally { await finish(d, browser); }
});
