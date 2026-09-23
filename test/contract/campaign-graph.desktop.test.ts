// @hima-seam llm-replay direct
// Product Upgrade v2 combined L3: Pack install, Campaign Preparation, one persistent owner Run,
// Side Talk and complete graph projection in real Electron. Driver placement is Catsights.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createHimaHome, repoRoot } from './support/dsh-home.ts';
import { writeLocalSite } from './support/site.ts';
import { bootDriver, waitForConfigurationReady } from './support/driver.ts';
import { freePort } from './support/boot-host.ts';
import { api } from './support/hima-api.ts';
import { inspectWindow } from './support/inspect-window.ts';
import type { RunView } from '@hima/harness';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { writeReplayOverlay } from '../../packages/desktop/src/hima-home.ts';
import { QUIET_TITLE_ROW } from './support/pipeline.ts';
import type { ReplayEntry } from '@deepseek-ai/dsh-llm-replay';
import { appendReplaySession } from './support/moments.ts';

process.env.HIMA_TEST_LEGACY_AUTO_DRIVE = '0';
process.env.HIMA_TEST_SILENT_AGENT = '1';

test('on Catsights a new user installs a Pack, confirms one proposal, sees the complete graph and opens a Side Talk without taking ownership', async (t) => {
  const h = await createHimaHome();
  const packSource = path.join(repoRoot, 'packs/custom-cell-fmax-dtco');
  const inputsRoot = path.join(h.home, 'l3-customer-inputs'); await mkdir(inputsRoot);
  const rtl = path.join(inputsRoot, 'held_out_ui_fixture.v'), constraints = path.join(inputsRoot, 'constraints.tcl');
  const foundry = path.join(inputsRoot, 'foundry.db'), physical = path.join(inputsRoot, 'physical.json'), tools = path.join(inputsRoot, 'tools.json');
  await writeFile(rtl, 'module held_out_ui_fixture(input clk); endmodule\n');
  await writeFile(constraints, 'create_clock -name clk -period 1 [get_ports clk]\n'); await writeFile(foundry, 'L3 fixture only\n');
  await writeFile(physical, JSON.stringify({ CLOCK_NAME: 'clk', FOUNDRY_LIB: '/site/foundry.lib', FOUNDRY_LEF: '/site/foundry.lef',
    FOUNDRY_QRC_TECH: '/site/qrc', FOUNDRY_GDS: '/site/foundry.gds', TECH_LEF: '/site/tech.lef', BOOL2CMOS_CMD: 'python3 -m bool2cmos.cli',
    BOOL2CMOS_CWD: '/site/bool2cmos', BOOL2CMOS_PDK_PROFILE: '/site/pdk.json', LIBERTY_SKELETON: '/site/skeleton.lib',
    LIBRECELL_TECH_PY: '/site/tech.py', GEOMETRY_RULE_DECK: '/site/rules.json', CHARMODEL_TIMING_MODEL: '/site/timing.json',
    CHARMODEL_POWER_MODEL: '/site/power.json', CHARMODEL_AREA_MODEL: '/site/area.json' }));
  await writeFile(tools, JSON.stringify({ EDA_WRAPPER: '/usr/bin/true', SYNTH_TIMEOUT_SEC: 30, PNR_TIMEOUT_SEC: 30 }));
  const replayDir = path.join(h.home, 'side-talk-replay'); await mkdir(replayDir);
  const replayFile = path.join(replayDir, 'session.jsonl'), replayOverride = path.join(replayDir, 'replay.override.json');
  await writeFile(replayFile, `${JSON.stringify({ version: 0, type: 'session', id: 'session-upgrade-v2-side-talk', createdAt: 0, cwd: '{{cwd}}' })}\n`);
  const say = (text: string): ReplayEntry => ({ kind: 'chunks', chunks: [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'finish', reason: { kind: 'stop' } },
  ] });
  let serial = 0;
  const tool = (name: string, args: object): ReplayEntry => ({ kind: 'chunks', chunks: [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id: `call-campaign-graph-${++serial}` as never, name, arguments: JSON.stringify(args) } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ] });
  const ownerReplay = [
    say('Campaign Agent conversation is ready.'),
    tool('hima_execute', { run: '{{fromRequest:(run-[0-9a-f-]+)}}', action: 'handoff', expectedEpoch: 1, expectedRevision: 0,
      requestId: 'desktop-side-talk-handoff', targetOwner: '{{fromRequest:target (session-[0-9a-f-]+)}}' }),
    say('Campaign ownership was handed to the requested Side Talk at the safe boundary.'),
    tool('hima_execute', { run: '{{fromRequest:(run-[0-9a-f-]+)}}', action: 'begin', nodeId: 'bind-inputs', expectedEpoch: 2,
      expectedRevision: 1, requestId: 'desktop-old-owner-fenced' }),
    say('The former Campaign Agent was fenced after handoff and did not begin the node.'),
  ];
  // The visible Guide, ordinary Side Talk and independent Campaign Agent are three native roots.
  // Replay binds entries on first model use, so each receives only its own turns.
  await writeFile(replayOverride, `${JSON.stringify([ownerReplay[0]!], null, 2)}\n`);
  const executionReplay = await appendReplaySession({ file: replayFile, override: replayOverride,
    readyFile: path.join(replayDir, 'unused-ready'), children: [] }, 'campaign-execution', ownerReplay);
  const replay = await appendReplaySession(executionReplay, 'side-talk', [
    tool('write', { file_path: 'side-talk-note.txt', content: 'Side Talk ordinary coding completed.\n' }),
    say('Side Talk completed ordinary conversation and coding without taking Campaign ownership.'),
  ]);
  await writeReplayOverlay(h.home, { file: replay.file, overrideFile: replay.override });
  await appendFile(path.join(h.profileDir, 'cordis.patch.yml'), QUIET_TITLE_ROW);
  const bindings = Object.fromEntries([
    ['designRoot', inputsRoot], ['rtlGlob', rtl], ['designTop', 'held_out_ui_fixture'], ['constraints', constraints],
    ['foundryLibrary', foundry], ['physicalInputs', physical], ['toolStack', tools], ['workspaceRoot', h.workspace],
  ]);
  await writeLocalSite(h, { bindings, allowedReadRoots: [packSource, inputsRoot, h.workspace], allowedWriteRoots: [h.workspace],
    allowedWrappers: ['/usr/bin/python3'], licences: { 'Design-Compiler': 1, 'Library-Compiler': 1, Innovus: 1 } });
  const port = await freePort();
  const d = await bootDriver(t, { existing: h, remoteDebuggingPort: port, theme: 'light', window: { width: 1440, height: 960 }, model: { replay: { file: replay.file, override: replay.override, children: replay.children } },
    env: { HIMA_TEST_LEGACY_AUTO_DRIVE: '0', HIMA_TEST_SILENT_AGENT: '1', HIMA_DRIVER_DISPLAY: 'Catsights' } });
  if (!d) { await h.dispose(); return; }
  const browser = await inspectWindow(port);
  let runId: string | undefined;
  let viewerSession = '';
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
    assert.ok((await d.wait('studio', 'Campaign configuration', 12_000)).ok);
    const owner = (await d.read('studio')); assert.ok(owner.ok); const ownerSession = owner.state.session; assert.ok(ownerSession);
    viewerSession = ownerSession;

    assert.ok((await d.wait('config-empty-pack', 'No HimaPack is installed', 10_000)).ok);
    assert.ok((await d.click('studio-pack-owner')).ok);
    assert.ok((await d.fill('owner-pack', 'custom-cell-fmax-dtco')).ok);
    assert.ok((await d.fill('owner-location', packSource)).ok);
    assert.ok((await d.click('owner-review')).ok);
    assert.ok((await d.wait('pack-review', 'knowledge/manifest.yml', 12_000)).ok);
    assert.ok((await d.click('owner-confirm')).ok);
    assert.ok((await d.wait('pack-owner-message', 'Confirmed files verified and written', 12_000)).ok);
    assert.ok((await d.click('studio-pack-owner')).ok);

    // Pre-existing race, unrelated to the canvas: the freshly-installed pack reaches the select's
    // own option list asynchronously, after `fetchStartChoices`'s own read settles.
    await browser.wait(`!!document.querySelector('[data-hima-control="config-pack"] option[value="custom-cell-fmax-dtco"]')`, 10_000);
    assert.ok((await d.fill('config-pack', 'custom-cell-fmax-dtco')).ok);
    await browser.wait(`!!document.querySelector('[data-hima-control="config-goal-target_period_ns"]')`);
    // The real title, never the stale one an earlier draft of this test carried (#41 task 7): the
    // Pack section states this Pack's own words, read fresh off its contract.
    assert.ok((await d.wait('config-pack', 'V5 Active Frontier custom Cell Fmax reference Campaign', 10_000)).ok);
    assert.ok((await d.fill('config-goal-target_period_ns', '0.5')).ok);
    assert.ok((await d.fill('config-goal-target_fmax_improvement_pct', '5')).ok);
    assert.ok((await d.fill('config-site', 'local')).ok);
    await waitForConfigurationReady(d, 'custom-cell-fmax-dtco', 'local', 30_000);
    assert.ok((await d.click('config-confirm')).ok);
    await browser.wait(`Number(document.querySelector('[data-hima-region="campaign-graph"]')?.getAttribute('data-hima-state-nodes'))>=48`, 20_000);
    const graph = await d.read('campaign-graph'); assert.ok(graph.ok); assert.ok(Number(graph.state.nodes) >= 48, graph.text);
    assert.ok(graph.text.includes('pnr-foundry') && graph.text.includes('compare'), graph.text);
    const runningStudio = await d.read('studio'); assert.ok(runningStudio.ok); runId = runningStudio.state.run; assert.ok(runId);
    const guideSessionId = runningStudio.state.session;
    if (typeof guideSessionId !== 'string' || guideSessionId === '') throw new Error(`Guide studio has no native session identity: ${JSON.stringify(runningStudio)}`);
    const guideView = await (await api(host, cookie, `/hima/api/runs/${runId}?sessionId=${encodeURIComponent(guideSessionId)}`)).json() as RunView;
    assert.equal(guideView.run.control?.guideSessionId, guideSessionId);
    const executionOwner = guideView.run.control?.owner;
    if (typeof executionOwner !== 'string' || executionOwner === '') throw new Error(`Run has no native execution owner: ${JSON.stringify(guideView.run.control)}`);
    await browser.wait(`document.querySelector('[data-hima-control="open-owner"]') !== null`);
    assert.ok((await d.click('open-owner')).ok);
    await browser.wait(`!!document.querySelector('[contenteditable="true"]')`);
    await browser.evaluate(`document.querySelector('[contenteditable="true"]').focus()`);
    await browser.send('Input.insertText', { text: 'Initialize this Campaign execution session without starting node work.' });
    await browser.evaluate(`(() => { const e=[...document.querySelectorAll('button')].find(e=>e.getBoundingClientRect().height>0 && /send/i.test([e.textContent,e.getAttribute('aria-label')].join(' '))); if(!e) throw new Error('no execution session send control'); e.setAttribute('data-hima-control','initialize-execution-owner'); })()`);
    assert.ok((await d.click('initialize-execution-owner')).ok);
    await browser.wait(`document.body.innerText.includes('Campaign Agent conversation is ready.')`, 15_000);
    await browser.wait(`document.querySelector('[data-hima-region="campaign-chip"]') !== null`);
    await browser.mark('[data-hima-region="campaign-chip"]', 'execution-owner-chip');
    assert.ok((await d.click('execution-owner-chip')).ok);
    await browser.wait(`document.querySelector('[data-hima-region="studio"]')?.getAttribute('data-hima-state-session')===${JSON.stringify(executionOwner)}`);
    await browser.wait(`document.querySelector('[data-hima-region="campaign-chip"]')?.getAttribute('data-hima-state-status') === 'running'`, 10_000);
    // The Campaign tab's own dock chip title carries the same identity, short: the running glyph and
    // the current node rather than "configure".
    await browser.wait(`document.body.innerText.includes('Campaign · bind-inputs')`, 10_000);
    // The anchored node card (Facts/Job/Code/Knowledge/Evidence tabs) is a later task's file
    // (`NodeCard.tsx`); this task's own node is clickable and marks itself selected in its own
    // region — asserted as a state change the click itself caused, not a fact already true of the
    // page before it (the node's id was already in `graph.text` at the read above).
    // The follow rule keeps whichever node is *current* inside the window; a fixed downstream id
    // (`pnr-foundry`) drifts off-screen once the run has moved past it at this zoom (x≈3393), so the
    // probe selects the current node instead — wherever the follow camera actually put it.
    const probeGraph = await d.read('campaign-graph'); assert.ok(probeGraph.ok, JSON.stringify(probeGraph));
    const probeNode = probeGraph.state.current; assert.ok(probeNode, `campaign-graph names a current node: ${probeGraph.text}`);
    assert.equal(await browser.evaluate(`document.querySelector('[data-hima-region="campaign-node-${probeNode}"]')?.getAttribute('data-hima-state-selected')`), 'false');
    assert.ok((await d.click(`node-${probeNode}`)).ok);
    await browser.wait(`document.querySelector('[data-hima-region="campaign-node-${probeNode}"]')?.getAttribute('data-hima-state-selected') === 'true'`, 10_000);
    const probeCard = await d.read('campaign-node-card'); assert.ok(probeCard.ok, JSON.stringify(probeCard));
    assert.equal(probeCard.state.node, probeNode);

    await browser.mark('[aria-label="New session"]', 'new-side-talk'); assert.ok((await d.click('new-side-talk')).ok);
    await browser.wait(`document.body.innerText.includes('New session') && [...document.querySelectorAll('[contenteditable="true"]')].some(e=>e.getBoundingClientRect().height>0)`);
    await browser.evaluate(`(() => { const e=[...document.querySelectorAll('[contenteditable="true"]')].find(e=>e.getBoundingClientRect().height>0); if(!e) throw new Error('no visible Side Talk composer'); e.setAttribute('data-hima-control','side-composer'); })()`);
    assert.ok((await d.click('side-composer')).ok);
    await browser.send('Input.insertText', { text: 'Use ordinary coding to write a short Side Talk note, then tell me what you did.' });
    await browser.evaluate(`(() => { const e=[...document.querySelectorAll('button')].find(e=>e.getBoundingClientRect().height>0 && /start|send/i.test([e.textContent,e.getAttribute('aria-label')].join(' '))); if(!e) throw new Error('no visible Side Talk send control'); e.setAttribute('data-hima-control','send-side-talk'); })()`);
    assert.ok((await d.click('send-side-talk')).ok);
    await browser.wait(`document.body.innerText.includes('Side Talk completed ordinary conversation and coding')`, 15_000);
    // Task 8: the Side Talk conversation owns no Run of its own — no session-header chip for it,
    // even though the owner's own Run is still running elsewhere on this same Host.
    assert.equal(await browser.evaluate(`document.querySelector('[data-hima-region="campaign-chip"]') === null`), true);
    assert.equal(await readFile(path.join(h.workspace, 'side-talk-note.txt'), 'utf8'), 'Side Talk ordinary coding completed.\n');
    await browser.wait(`!document.querySelector('[data-hima-control="open-workbench"]')?.disabled`);
    await browser.mark('[data-hima-control="open-workbench"]', 'open-workbench');
    assert.ok((await d.click('open-workbench')).ok);
    await browser.wait(`document.querySelector('[data-hima-region="studio"]') !== null`);
    const sideSession = await browser.evaluate<string>(`document.querySelector('[data-hima-region="studio"]')?.getAttribute('data-hima-state-session') || ''`);
    assert.ok(sideSession && sideSession !== ownerSession);
    viewerSession = sideSession;
    const view = await (await api(host, cookie, `/hima/api/runs/${runId}?sessionId=${encodeURIComponent(ownerSession)}`)).json() as RunView;
    assert.equal(view.run.control?.guideSessionId, ownerSession);
    assert.notEqual(view.run.control?.owner, ownerSession, 'the visible Guide does not own Campaign execution');
    assert.equal(view.run.control?.owner, executionOwner);
    assert.equal(view.run.status, 'running', 'opening the Side Talk surface is navigation, not Campaign control');
    assert.equal((await (await api(host, cookie, `/hima/api/runs?sessionId=${encodeURIComponent(ownerSession)}`)).json() as { runs: unknown[] }).runs.length, 1);
    assert.ok((await d.fill('studio-run', runId)).ok);
    await browser.wait(`document.querySelector('[data-hima-control="open-owner"]') !== null`);
    assert.ok((await d.click('open-owner')).ok);
    await browser.wait(`document.querySelector('[data-hima-region="campaign-chip"]') !== null`);
    await browser.mark('[data-hima-region="campaign-chip"]', 'execution-owner-chip-after-side-talk');
    assert.ok((await d.click('execution-owner-chip-after-side-talk')).ok);
    await browser.wait(`document.querySelector('[data-hima-region="studio"]')?.getAttribute('data-hima-state-session')===${JSON.stringify(executionOwner)}`);
    // Task 8: back on the owner conversation, the chip is there again — scoped to the session that
    // owns the Run, not to whichever conversation happened to be open last.
    await browser.wait(`document.querySelector('[data-hima-region="campaign-chip"]') !== null`, 10_000);
    assert.ok((await d.click('open-workbench')).ok);
    await browser.evaluate(`(() => { const e=[...document.querySelectorAll('[contenteditable="true"]')].find(e=>e.getBoundingClientRect().height>0); if(!e) throw new Error('no visible owner composer'); e.setAttribute('data-hima-control','owner-composer'); })()`);
    assert.ok((await d.click('owner-composer')).ok);
    await browser.send('Input.insertText', { text: `For Run ${runId}, hand off Campaign ownership to target ${sideSession} now.` });
    await browser.evaluate(`(() => { const e=[...document.querySelectorAll('button')].find(e=>e.getBoundingClientRect().height>0 && /send/i.test([e.textContent,e.getAttribute('aria-label')].join(' '))); if(!e) throw new Error('no visible owner send control'); e.setAttribute('data-hima-control','send-owner-handoff'); })()`);
    assert.ok((await d.click('send-owner-handoff')).ok);
    await browser.wait(`document.body.innerText.includes('Campaign ownership was handed')`, 15_000);
    const handed = await (await api(host, cookie, `/hima/api/runs/${runId}?sessionId=${encodeURIComponent(sideSession)}`)).json() as RunView;
    assert.equal(handed.run.control?.owner, sideSession); assert.equal(handed.run.control?.epoch, 2);
    await browser.mark('[contenteditable="true"]', 'old-owner-composer'); assert.ok((await d.click('old-owner-composer')).ok);
    await browser.send('Input.insertText', { text: `For Run ${runId}, try to begin bind-inputs from this former owner conversation.` });
    await browser.wait(`!document.querySelector('[aria-label="Send message"]')?.disabled`); await browser.mark('[aria-label="Send message"]', 'send-old-owner');
    assert.ok((await d.click('send-old-owner')).ok);
    await browser.wait(`document.body.innerText.includes('former Campaign Agent was fenced')`, 15_000);
    const fenced = await (await api(host, cookie, `/hima/api/runs/${runId}?sessionId=${encodeURIComponent(sideSession)}`)).json() as RunView;
    assert.equal(fenced.run.control?.owner, sideSession);
    assert.equal(Object.values(fenced.run.control?.executions ?? {}).some((execution) => execution.nodeId === 'bind-inputs'), false,
      'the former owner did not admit node work after handoff');
  } catch (error) {
    t.diagnostic(await browser.evaluate<string>('document.body.innerText'));
    t.diagnostic(d.stderr());
    throw error;
  } finally {
    if (runId) {
      const host = await d.host(); if (host.ok && viewerSession) { const cookie = await d.cookie(); await api(host, cookie, `/hima/api/runs/${runId}/cancel?sessionId=${encodeURIComponent(viewerSession)}`, { method: 'POST' }).catch(() => undefined); }
    }
    browser.close(); await d.dispose(); await h.dispose();
  }
});
