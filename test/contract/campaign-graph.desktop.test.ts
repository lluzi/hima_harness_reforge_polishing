// @hima-seam llm-replay direct
// Product Upgrade v2 combined L3: Pack install, Campaign Preparation, one persistent owner Run,
// Side Talk and complete graph projection in real Electron. Driver placement is Catsights.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createHimaHome, repoRoot } from './support/dsh-home.ts';
import { writeLocalSite } from './support/site.ts';
import { bootDriver } from './support/driver.ts';
import { freePort } from './support/boot-host.ts';
import { api } from './support/hima-api.ts';
import { inspectWindow } from './support/inspect-window.ts';
import type { RunView } from '@hima/harness';
import { appendFile, cp, mkdir, writeFile } from 'node:fs/promises';
import { writeReplayOverlay } from '../../packages/desktop/src/hima-home.ts';
import { QUIET_TITLE_ROW } from './support/pipeline.ts';
import type { ReplayEntry } from '@deepseek-ai/dsh-llm-replay';

process.env.HIMA_TEST_LEGACY_AUTO_DRIVE = '0';
process.env.HIMA_TEST_SILENT_AGENT = '1';

test('on Catsights a new user installs a Pack, confirms one proposal, sees the complete graph and opens a Side Talk without taking ownership', async (t) => {
  const h = await createHimaHome();
  const packSource = path.join(repoRoot, 'packs/custom-cell-fmax-dtco');
  const flowRoot = path.join(h.home, 'l3-customer-flow');
  await cp(path.join(packSource, 'flow'), flowRoot, { recursive: true });
  await writeFile(path.join(flowRoot, 'inputs.json'), `${JSON.stringify({ designTop: 'held_out_ui_fixture', source: 'L3 only; no EDA execution' }, null, 2)}\n`);
  const replayDir = path.join(h.home, 'side-talk-replay'); await mkdir(replayDir);
  const replayFile = path.join(replayDir, 'session.jsonl'), replayOverride = path.join(replayDir, 'replay.override.json');
  await writeFile(replayFile, `${JSON.stringify({ version: 0, type: 'session', id: 'session-upgrade-v2-side-talk', createdAt: 0, cwd: '{{cwd}}' })}\n`);
  const say = (text: string): ReplayEntry => ({ kind: 'chunks', chunks: [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'finish', reason: { kind: 'stop' } },
  ] });
  await writeFile(replayOverride, `${JSON.stringify([say('Campaign Agent conversation is ready.')], null, 2)}\n`);
  await writeReplayOverlay(h.home, { file: replayFile, overrideFile: replayOverride });
  await appendFile(path.join(h.profileDir, 'cordis.patch.yml'), QUIET_TITLE_ROW);
  const bindings = Object.fromEntries([
    ['flowRoot', flowRoot], ['designRoot', flowRoot], ['rtlGlob', path.join(flowRoot, '*.py')],
    ['designTop', 'held_out_ui_fixture'], ['constraints', path.join(flowRoot, 'synth.tcl')],
    ['foundryLibrary', path.join(flowRoot, 'README.md')], ['physicalInputs', path.join(flowRoot, 'domain')],
    ['toolStack', '/usr/bin/python3'], ['workspaceRoot', h.workspace],
  ]);
  await writeLocalSite(h, { bindings, allowedReadRoots: [packSource, flowRoot, h.workspace], allowedWriteRoots: [h.workspace],
    allowedWrappers: ['/usr/bin/python3'], licences: { 'Design-Compiler': 1, 'Library-Compiler': 1, Innovus: 1 } });
  const port = await freePort();
  const d = await bootDriver(t, { existing: h, remoteDebuggingPort: port, theme: 'light', window: { width: 1440, height: 960 }, model: { replay: { file: replayFile, override: replayOverride } },
    env: { HIMA_TEST_LEGACY_AUTO_DRIVE: '0', HIMA_TEST_SILENT_AGENT: '1', HIMA_DRIVER_DISPLAY: 'Catsights' } });
  if (!d) { await h.dispose(); return; }
  const browser = await inspectWindow(port);
  let runId: string | undefined;
  try {
    await d.open('/');
    await browser.wait(`document.body.innerText.includes('Internal Testing Notice')`);
    await browser.markText('button', 'Continue', 'notice-continue'); assert.ok((await d.click('notice-continue')).ok);
    const host = await d.host(); assert.ok(host.ok); const cookie = await d.cookie();
    const workspace = await api(host, cookie, '/api/workspace/create', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'upgrade-v2-workspace', method: 'workspace/create', payload: { args: { request: { path: h.workspace } } } }),
    });
    assert.equal((await workspace.json() as { result: { ok: boolean } }).result.ok, true);
    await browser.wait(`document.querySelector('[role="treegrid"], [role="tree"]')?.textContent.includes('workspace') || [...document.querySelectorAll('[role="row"]')].some(e=>e.textContent.trim()==='workspace')`);
    await browser.markText('button', 'New Session', 'new-owner-session'); assert.ok((await d.click('new-owner-session')).ok);
    await browser.wait(`!document.querySelector('[data-hima-control="open-workbench"]').disabled`);
    await browser.evaluate(`document.querySelector('[contenteditable="true"]').focus()`);
    await browser.send('Input.insertText', { text: 'Keep this conversation as the Campaign Agent.' });
    await browser.evaluate(`(() => { const e=[...document.querySelectorAll('button')].find(e=>e.getBoundingClientRect().height>0 && /start|send/i.test([e.textContent,e.getAttribute('aria-label')].join(' '))); if(!e) throw new Error('no visible new-session start control'); e.setAttribute('data-hima-control','start-owner-session'); })()`);
    assert.ok((await d.click('start-owner-session')).ok);
    await browser.wait(`document.body.innerText.includes('Campaign Agent conversation is ready')`, 15_000);
    assert.ok((await d.click('open-workbench')).ok);
    assert.ok((await d.wait('studio', 'Campaign workspace', 12_000)).ok);
    const owner = (await d.read('studio')); assert.ok(owner.ok); const ownerSession = owner.state.session; assert.ok(ownerSession);

    assert.ok((await d.click('studio-new')).ok);
    assert.ok((await d.wait('studio-empty-pack', 'No HimaPack is installed', 10_000)).ok);
    await browser.mark('[aria-label="Close Campaign preparation"]', 'close-preparation'); assert.ok((await d.click('close-preparation')).ok);
    assert.ok((await d.click('studio-pack-owner')).ok);
    assert.ok((await d.fill('owner-pack', 'custom-cell-fmax-dtco')).ok);
    assert.ok((await d.fill('owner-location', packSource)).ok);
    assert.ok((await d.click('owner-review')).ok);
    assert.ok((await d.wait('pack-review', 'knowledge/manifest.yml', 12_000)).ok);
    assert.ok((await d.click('owner-confirm')).ok);
    assert.ok((await d.wait('pack-owner-message', 'Confirmed files verified and written', 12_000)).ok);
    assert.ok((await d.click('studio-pack-owner')).ok);

    assert.ok((await d.click('studio-new')).ok);
    assert.ok((await d.fill('studio-pack', 'custom-cell-fmax-dtco')).ok);
    assert.ok((await d.fill('studio-site', 'local')).ok);
    await browser.wait(`document.querySelector('[data-hima-region="studio-preflight"]')?.getAttribute('data-hima-state-status')==='ready'`, 15_000);
    assert.ok((await d.wait('studio-proposal', 'Portable custom Cell Fmax research', 10_000)).ok);
    assert.equal(await browser.evaluate(`document.querySelector('.hima-advanced')?.open`), false, 'internal knobs are folded by default');
    assert.ok((await d.click('studio-start')).ok);
    await browser.wait(`Number(document.querySelector('[data-hima-region="campaign-graph"]')?.getAttribute('data-hima-state-nodes'))>=48`, 20_000);
    const graph = await d.read('campaign-graph'); assert.ok(graph.ok); assert.ok(Number(graph.state.nodes) >= 48, graph.text);
    assert.ok(graph.text.includes('pnr-foundry') && graph.text.includes('compare'), graph.text);
    const runningStudio = await d.read('studio'); assert.ok(runningStudio.ok); runId = runningStudio.state.run; assert.ok(runId);
    await browser.mark('[data-hima-node="pnr-foundry"]', 'graph-probe-node'); assert.ok((await d.click('graph-probe-node')).ok);
    assert.ok((await d.wait('campaign-node-inspector', 'pnr-foundry', 10_000)).ok);

    await browser.mark('[aria-label="New session"]', 'new-side-talk'); assert.ok((await d.click('new-side-talk')).ok);
    await browser.wait(`document.body.innerText.includes('New session') && [...document.querySelectorAll('[contenteditable="true"]')].some(e=>e.getBoundingClientRect().height>0)`);
    const view = await (await api(host, cookie, `/hima/api/runs/${runId}`)).json() as RunView;
    assert.equal(view.run.control?.owner, ownerSession);
    assert.equal(view.run.status, 'running', 'opening the Side Talk surface is navigation, not Campaign control');
    assert.equal((await (await api(host, cookie, '/hima/api/runs')).json() as { runs: unknown[] }).runs.length, 1);
  } catch (error) {
    t.diagnostic(await browser.evaluate<string>('document.body.innerText'));
    t.diagnostic(d.stderr());
    throw error;
  } finally {
    if (runId) {
      const host = await d.host(); if (host.ok) { const cookie = await d.cookie(); await api(host, cookie, `/hima/api/runs/${runId}/cancel`, { method: 'POST' }).catch(() => undefined); }
    }
    browser.close(); await d.dispose(); await h.dispose();
  }
});
