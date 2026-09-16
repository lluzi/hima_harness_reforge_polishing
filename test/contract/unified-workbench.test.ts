// @hima-seam llm direct
// L3: native dsh conversation + Hima dock. Real Host and local Jobs; no real model or SSH.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFile, mkdir, readFile, realpath, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { bootDriver, type BootedDriver } from './support/driver.ts';
import { freePort } from './support/boot-host.ts';
import { api } from './support/hima-api.ts';
import { inspectWindow } from './support/inspect-window.ts';
import { writeSampleReport } from './support/site.ts';
import { localHome } from './support/fabric.ts';
import { installWorkshopPack, packsDirOf, timingProbePackId, writePackVariant } from './support/pack.ts';
import { appendReplaySession, writeMomentScenario } from './support/moments.ts';
import { HIMA_INTENT_SECTIONS } from '@hima/harness';
import { repoRoot } from './support/dsh-home.ts';
import { QUIET_TITLE_ROW } from './support/pipeline.ts';
import type { RunView } from '@hima/harness';
import type { ReplayEntry } from '@deepseek-ai/dsh-llm-replay';

type Inspector = Awaited<ReturnType<typeof inspectWindow>>;
const draft = 'UI validation draft — compare strategies and preserve each experiment’s evidence. Not sent to a model.';

async function prepareSession(d: BootedDriver, browser: Inspector, modelReady = false) {
  await d.open('/');
  await browser.wait(`document.body.innerText.includes('Internal Testing Notice')`);
  await browser.markText('button', 'Continue', 'notice-continue');
  assert.ok((await d.click('notice-continue')).ok);
  if (!modelReady) {
    await browser.wait(`document.body.innerText.includes('Configure later')`);
    await browser.markText('button', 'Configure later', 'models-later');
    assert.ok((await d.click('models-later')).ok);
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
  assert.ok((await d.wait('studio', 'Campaign workspace', 12_000)).ok);
  return { host, cookie };
}

async function fillStart(d: BootedDriver, browser: Inspector, target = '2.25', retries = '0') {
  assert.ok((await d.click('studio-new')).ok);
  assert.ok((await d.fill('studio-pack', timingProbePackId)).ok);
  assert.ok((await d.fill('studio-site', 'local')).ok);
  await browser.wait(`document.querySelector('[data-hima-region="studio-preflight"]')?.getAttribute('data-hima-state-status')==='ready'`);
  await browser.mark('.hima-advanced>summary', 'studio-advanced'); assert.ok((await d.click('studio-advanced')).ok);
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
    // This start route returns after legacy automatic drive settles. Running interaction itself is
    // held by the controlled Job/replay path below; this case needs a real created Run to inspect.
    assert.ok((await d.wait('campaign-masthead', 'ended — goal met', 35_000)).ok);
    const id = await currentRun(d);
    const started = await (await api(host, cookie, `/hima/api/runs/${id}`)).json() as RunView;
    assert.equal(started.run.status, 'ended-goal-met');
    assert.equal(started.jobs.filter((job) => job.event === 'launched').length, 2, 'the completed Run still proves two actual local Jobs');
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
    await browser.wait(`document.querySelector('[data-hima-region="studio-preflight"]').getAttribute('data-hima-state-status')==='ready'`);
    await browser.pause('*/hima/api/runs/start');
    assert.ok((await d.click('studio-start')).ok);
    const starting = await browser.nextPaused();
    assert.equal(await browser.evaluate(`document.querySelector('[data-hima-control="studio-run"]').disabled`), true);
    await browser.evaluate(`document.querySelector('[data-hima-region="studio-start"]').requestSubmit()`);
    const runs = await (await api(host, cookie, '/hima/api/runs')).json() as { runs: RunView['run'][] };
    assert.equal(runs.runs.length, 2, 'one Probe and exactly one Campaign despite repeated submit');
    await browser.send('Fetch.continueRequest', { requestId: starting.requestId }); await browser.send('Fetch.disable');
    assert.ok((await d.wait('campaign-masthead', 'waiting', 25_000)).ok);
    const id = await currentRun(d);
    await capture(d, browser, 'dark-blocked');
    assert.ok((await d.click('resume')).ok);
    assert.ok((await d.wait('campaign-masthead', 'running', 10_000)).ok);
    assert.equal(await browser.evaluate(`document.querySelector('[data-hima-control="cancel"]').disabled`), false, 'Cancel does not wait for the resumed continuation to finish');
    assert.ok((await d.fill('studio-run', probe.run.id)).ok);
    assert.ok((await d.wait('campaign-masthead', 'No Fabric state recorded', 10_000)).ok);
    assert.ok((await d.fill('studio-run', id)).ok);
    assert.ok((await d.wait('campaign-masthead', 'running', 10_000)).ok);
    assert.equal(await browser.evaluate(`document.querySelector('[data-hima-control="cancel"]').disabled`), false);
    assert.ok((await d.click('cancel')).ok);
    assert.ok((await d.wait('campaign-masthead', 'cancelled', 15_000)).ok);
    const ended = await (await api(host, cookie, `/hima/api/runs/${id}`)).json() as RunView;
    assert.equal(ended.cancels.length, 1);
    assert.equal(ended.jobs.filter((job) => job.event === 'launched').length, 2, 'Run selection never launches another continuation');
    assert.equal(await browser.evaluate(`document.querySelector('[contenteditable="true"]').textContent`), draft);
    await capture(d, browser, 'dark-cancelled');
  } finally { await finish(d, browser); }
});

test('a Pack under authoring and its Workshop code records remain visible beside the native conversation', async (t) => {
  const home = await localHome(t, { sleepSeconds: 0 });
  if (!home) return;
  const pack = await installWorkshopPack(packsDirOf(home.h));
  await writeFile(path.join(packsDirOf(home.h), pack, 'INTENT.md'), HIMA_INTENT_SECTIONS.map((heading) => `## ${heading}\n\nLocal UI fixture for this declared method.\n`).join('\n'));
  const broken = path.join(packsDirOf(home.h), 'broken-pack');
  await writePackVariant(packsDirOf(home.h), 'broken-pack', []);
  await symlink(home.h.workspace, path.join(broken, '.state'));
  let scenario = await writeMomentScenario(home.h, 'writes');
  const contextReplay: ReplayEntry[] = [
    { kind: 'chunks', chunks: [
      { type: 'block-start', index: 0, blockType: 'tool-call' },
      { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'call-native-material-context' as never,
        name: 'hima_context', arguments: '{"run":"{{fromRequest:(run-[0-9a-f-]+)}}"}' } },
      { type: 'finish', reason: { kind: 'tool-calls' } },
    ] },
    { kind: 'chunks', chunks: [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'block-end', index: 0, block: { type: 'text', text: 'Replay: the requested Run context is visible in this conversation.' } },
      { type: 'finish', reason: { kind: 'stop' } },
    ] },
  ];
  scenario = await appendReplaySession(scenario, 'native-material-context', contextReplay);
  await appendFile(path.join(home.h.profileDir, 'cordis.patch.yml'), QUIET_TITLE_ROW);
  const port = await freePort();
  const d = await bootDriver(t, { existing: home.h, model: { replay: { file: scenario.file, override: scenario.override, children: scenario.children } }, remoteDebuggingPort: port });
  if (!d) { await home.h.dispose(); return; }
  let browser: Inspector | undefined;
  try {
    browser = await inspectWindow(port);
    // Replay already supplies a configured model; dsh correctly omits the missing-model dialog.
    const { host, cookie } = await prepareSession(d, browser, true);
    const url = await browser.evaluate<string>('location.href');
    await fillStart(d, browser, '2.0');
    const options = await browser.evaluate<{ value: string; text: string; disabled: boolean }[]>(`[...document.querySelector('[data-hima-control="studio-pack"]').options].map(o=>({value:o.value,text:o.textContent,disabled:o.disabled}))`);
    assert.ok(options.find((o) => o.value === pack)?.text.includes('test pack (intent)'));
    assert.equal(options.find((o) => o.value === 'broken-pack')?.disabled, true);
    assert.ok(options.find((o) => o.value === 'broken-pack')?.text.includes('unreadable'));
    assert.ok((await d.fill('studio-pack', pack)).ok);
    await browser.wait(`document.querySelector('[data-hima-region="studio-preflight"]').getAttribute('data-hima-state-status')==='ready'`);
    assert.ok((await d.click('studio-start')).ok);
    // Task 5: the Live view is the HimaFabric canvas alone; the workshop section moved to Evidence.
    assert.ok((await d.click('studio-evidence')).ok);
    assert.ok((await d.wait('run-workshop', 'miner.sh', 40_000)).ok);
    assert.ok((await d.wait('campaign-masthead', 'ended', 40_000)).ok);
    const id = await currentRun(d);
    const view = await (await api(host, cookie, `/hima/api/runs/${id}`)).json() as RunView;
    assert.equal(view.run.purpose, 'test');
    const status = await d.read('campaign-masthead'); assert.ok(status.ok);
    assert.equal(status.state.purpose, 'test');
    assert.ok(status.text.includes('test run'));
    const workshop = await d.read('run-workshop'); assert.ok(workshop.ok);
    assert.ok(view.code.length > 0);
    assert.ok(view.knowledge.length > 0);
    for (const code of view.code) assert.ok(workshop.text.includes(code.sha256.slice(0, 12)), workshop.text);
    const material = await d.read('run-material'); assert.ok(material.ok);
    assert.ok(material.text.includes(view.code[0]!.sha256), material.text);
    assert.ok(material.text.includes(view.knowledge[0]!.sha256), material.text);
    const sample = await writeSampleReport(home.h);
    const probe = await (await api(host, cookie, '/hima/api/observe', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ site: 'local', path: path.join(home.h.workspace, sample.rel) }),
    })).json() as RunView;
    await browser.pause(`*/hima/api/runs/${id}/material/*`);
    assert.ok((await d.click(`material-${view.code[0]!.recordId}`)).ok);
    const held = await browser.nextPaused();
    await browser.wait(`[...document.querySelectorAll('[data-hima-control="studio-run"] option')].some((option) => option.value === ${JSON.stringify(probe.run.id)})`);
    assert.ok((await d.fill('studio-run', probe.run.id)).ok);
    assert.ok((await d.wait('campaign-masthead', 'No Fabric state recorded', 10_000)).ok);
    assert.ok((await d.fill('studio-run', id)).ok);
    assert.ok((await d.wait('run-material', view.code[0]!.sha256, 10_000)).ok);
    await browser.send('Fetch.continueRequest', { requestId: held.requestId }).catch(() => undefined);
    await browser.send('Fetch.disable');
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.equal(await browser.evaluate(`document.querySelector('[data-hima-region="material-content"]') === null`), true, 'the old A response cannot populate A after A→B→A changed its material selection');
    assert.ok((await d.click(`material-${view.code[0]!.recordId}`)).ok);
    assert.ok((await d.wait('material-content', 'set -eu', 12_000)).ok);
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
    await browser.wait(`!!${chatMaterial} && ${chatMaterial}.textContent.includes(${JSON.stringify(view.code[0]!.sha256)}) && ${chatMaterial}.textContent.includes(${JSON.stringify(view.knowledge[0]!.sha256)})`);
    assert.ok(await browser.evaluate<boolean>(`!!${chatMaterial}.querySelector('[data-hima-control="material-${view.code[0]!.recordId}"]')`));
    await browser.evaluate(`(() => { const section=${chatMaterial}; const button=section.querySelector('[data-hima-control="material-${view.code[0]!.recordId}"]'); button.setAttribute('data-hima-control', 'chat-material-record'); })()`);
    assert.ok((await d.click('chat-material-record')).ok);
    await browser.wait(`!!${chatMaterial}.querySelector('[data-hima-region="material-content"]') && ${chatMaterial}.querySelector('[data-hima-region="material-content"]').textContent.includes('set -eu')`, 12_000);
    await capture(d, browser, 'light-workshop');
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
    const { host, cookie } = await prepareSession(d, browser);
    assert.ok((await d.click('studio-new')).ok);
    await browser.wait(`!!document.querySelector('[data-hima-control="studio-pack"] option[value="relative-goal"]')`);
    assert.ok((await d.fill('studio-pack', pack)).ok);
    await browser.wait(`document.querySelector('[data-hima-control="studio-goal-improvement_pct"]') && document.querySelector('[data-hima-region="studio-preflight"]')?.getAttribute('data-hima-state-status') === 'ready'`);
    assert.equal(await browser.evaluate(`document.querySelector('[data-hima-control="studio-target"]') === null`), true);
    assert.ok((await d.wait('studio-start', 'relative improvement (%)', 10_000)).ok);
    assert.ok((await d.fill('studio-goal-improvement_pct', '1.001')).ok);
    assert.ok((await d.click('studio-start')).ok);
    assert.ok((await d.wait('studio-start', 'at most 2 decimal places', 10_000)).ok);
    await browser.wait(`document.querySelector('[role="alert"]')?.textContent.includes('invalid Goal parameter')`);
    assert.deepEqual(await (await api(host, cookie, '/hima/api/runs')).json(), { runs: [] });
    await capture(d, browser, 'pls21-relative-goal-invalid');
    assert.ok((await d.fill('studio-goal-improvement_pct', '5.25')).ok);
    assert.ok((await d.fill('studio-generations', '1')).ok);
    assert.ok((await d.click('studio-start')).ok);
    await browser.wait(`!document.querySelector('[data-hima-control="studio-goal-improvement_pct"]') && !!document.querySelector('[data-hima-region="campaign-masthead"]')`);
    const id = await currentRun(d);
    const view = await (await api(host, cookie, `/hima/api/runs/${id}`)).json() as RunView;
    assert.deepEqual(view.run.goal, { improvement_pct: 5.25 });
    await capture(d, browser, 'pls21-relative-goal-started');
  } finally { await finish(d, browser); }
});
