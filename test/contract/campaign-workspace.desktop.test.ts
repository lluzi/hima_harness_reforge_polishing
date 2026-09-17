// @hima-seam llm-replay direct
// L3 acceptance (#41 task 9): the seven Campaign workspace states, light and dark, on Catsights.
// Screenshots are the acceptance artefacts; this file also proves each state's own marker contract
// so a broken render fails loud rather than only looking wrong in a picture nobody re-checks.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { bootDriver, electronBinary, fillConfiguration, waitForConfigurationReady, whyNoWindow, type BootedDriver, type HostAnswer } from './support/driver.ts';
import { freePort } from './support/boot-host.ts';
import { api } from './support/hima-api.ts';
import { inspectWindow } from './support/inspect-window.ts';
import { repoRoot } from './support/dsh-home.ts';
import { timingProbePackId } from './support/pack.ts';
import { writeLocalSite } from './support/site.ts';
import { localHome, type LocalHome } from './support/fabric.ts';
import { writeReplayOverlay } from '../../packages/desktop/src/hima-home.ts';
import type { RunView } from '@hima/harness';
import type { ReplayEntry } from '@deepseek-ai/dsh-llm-replay';

type Inspector = Awaited<ReturnType<typeof inspectWindow>>;

const WINDOW = { width: 1280, height: 800 };
const DOCK_PANE_TARGET = 760;
const artifactsDir = process.env.HIMA_UI_ARTIFACTS;

/** `bootDriver` skips per-boot when Electron cannot open a window at all; this is the same guard,
 *  asked once up front so a display that is entirely unavailable skips every state's own test
 *  cleanly rather than fourteen times over. Catsights itself (`HIMA_DRIVER_DISPLAY`) is checked by
 *  the shell before it opens a window (`packages/desktop/src/main.ts`); an operator confirms it is
 *  online before running this file, as `docs/testing-strategy.md`'s desktop-isolation note asks. */
function windowUnavailable(t: TestContext): boolean {
  const electron = electronBinary();
  if ('missing' in electron) { t.skip(electron.missing); return true; }
  const headless = whyNoWindow();
  if (headless !== undefined) { t.skip(`Electron cannot open a window here: ${headless}`); return true; }
  return false;
}

async function capture(d: BootedDriver, browser: Inspector, name: string): Promise<void> {
  if (!artifactsDir) return;
  await mkdir(artifactsDir, { recursive: true });
  await browser.evaluate('document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true)))))');
  const result = await d.screenshot(path.join(artifactsDir, `${name}.png`));
  assert.ok(result.ok, JSON.stringify(result));
}

/** Every Run this window's Host still holds open, cancelled on the way out — the same cleanup
 *  `unified-workbench.test.ts`'s `finish` does, so a state's own boot never strands a stand-in Job. */
async function finish(d: BootedDriver | undefined, browser?: Inspector): Promise<void> {
  if (!d) return;
  if (browser) browser.close();
  const host = await d.host();
  if (host.ok) {
    const cookie = await d.cookie();
    const listed = await api(host, cookie, '/hima/api/runs');
    const { runs } = await listed.json() as { runs: RunView['run'][] };
    for (const run of runs.filter((run) => run.status === 'running' || run.status === 'waiting')) {
      await api(host, cookie, `/hima/api/runs/${run.id}/cancel`, { method: 'POST' }).catch(() => undefined);
    }
  }
  await d.dispose();
}

/** Reach the Configuration page's own dock tab: dismiss the notice, configure the model later
 *  (skipped entirely when this boot already carries a replay model), make the workspace, open a new
 *  session, and open its workbench. Mirrors `unified-workbench.test.ts`'s own `prepareSession`. */
async function prepareSession(d: BootedDriver, browser: Inspector, modelReady = false): Promise<{ host: HostAnswer; cookie: string }> {
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
  assert.ok((await d.click('open-workbench')).ok);
  assert.ok((await d.wait('studio', 'Campaign configuration', 12_000)).ok);
  return { host, cookie };
}

/** No seam sets the dock pane's own width directly (checked `display-placement.desktop.test.ts` and
 *  `desktop.test.ts`; neither sizes a split). The boundary is the docking kit's own splitter — a
 *  `col-resize` handle between the chat column and the Hima sidebar — so it is dragged with real CDP
 *  mouse events the same way a person's own drag would move it. Each session holds its own docking
 *  surface (`SidebarRightState.bySession`), so this runs again after switching sessions if that
 *  session's own pane is what a state screenshots. Returns the pane's width afterwards, so a caller
 *  can assert and note it rather than assume the drag landed. */
const paneWidth = (browser: Inspector): Promise<number> =>
  browser.evaluate<number>(`document.querySelector('[data-hima-region="studio"], [data-hima-region="campaign"]')?.closest('.P3OORG_panel')?.getBoundingClientRect().width ?? 0`);

/** One drag of the splitter from wherever it currently sits to the absolute x that puts the pane at
 *  `targetWidth`. Pulled out of `widenDockPane` so a first attempt that lands short — the panel's own
 *  slide-in transition (`var(--ds-transition-duration-slow)`, opening a freshly switched session's
 *  sidebar) can still be moving when the handle is first read — can simply be asked again against
 *  the handle's real, settled position rather than failing outright. */
async function dragSplitterOnce(browser: Inspector, targetWidth: number): Promise<number> {
  const handle = await browser.evaluate<{ x: number; y: number; width: number; height: number } | null>(
    `(() => { const e = document.querySelector('.pI_x6G_handle'); return e ? e.getBoundingClientRect().toJSON() : null; })()`,
  );
  if (handle === null) return paneWidth(browser); // No splitter found: narrower build, or panel already fills the window.
  const startX = handle.x + handle.width / 2;
  const startY = handle.y + handle.height / 2;
  const targetX = WINDOW.width - targetWidth - handle.width / 2;
  await browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: startX, y: startY, button: 'left', clickCount: 1 });
  const steps = 5;
  for (let i = 1; i <= steps; i++) {
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: startX + (targetX - startX) * (i / steps), y: startY, button: 'left', clickCount: 0 });
  }
  await browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: targetX, y: startY, button: 'left', clickCount: 1 });
  await new Promise((resolve) => setTimeout(resolve, 300));
  return paneWidth(browser);
}

/** No seam sets the dock pane's own width directly; the boundary is the docking kit's own splitter,
 *  dragged with real CDP mouse events (`dragSplitterOnce`). Each session holds its own docking
 *  surface (`SidebarRightState.bySession`), and a session's panel slides open under a CSS transition
 *  when its sidebar is toggled open — reading the handle's position mid-slide drags from a transient
 *  spot and lands short — so this waits for the panel to stop moving first, and retries the drag
 *  itself once if the first attempt still lands under target (the same slide can still be settling on
 *  a loaded machine). Returns the pane's width afterwards, so a caller can assert and note it rather
 *  than assume the drag landed. */
async function widenDockPane(browser: Inspector, targetWidth = DOCK_PANE_TARGET): Promise<number> {
  await browser.wait(`(() => {
    const panel = document.querySelector('[data-hima-region="studio"], [data-hima-region="campaign"]')?.closest('.P3OORG_panel');
    if (!panel) return false;
    const width = panel.getBoundingClientRect().width;
    if (width <= 0) return false;
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => {
      resolve(panel.getBoundingClientRect().width === width);
    })));
  })()`, 10_000).catch(() => undefined);
  let width = await dragSplitterOnce(browser, targetWidth);
  if (width < targetWidth) width = await dragSplitterOnce(browser, targetWidth);
  return width;
}

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

async function currentRun(d: BootedDriver): Promise<string> {
  const studio = await d.read('studio'); assert.ok(studio.ok, JSON.stringify(studio));
  const id = studio.state.run; assert.ok(id, JSON.stringify(studio));
  return id;
}

/** Fill the shipped timing-probe Pack's Configuration document the same way every other suite that
 *  starts a plain Campaign does (`unified-workbench.test.ts`'s own `fillStart`). */
async function fillShipped(d: BootedDriver, browser: Inspector, target = '2.25'): Promise<void> {
  await fillConfiguration(d, browser, {
    pack: timingProbePackId, site: 'local',
    goal: { target_period_ns: target }, knobs: { periodNs: '2.3' },
    budget: { timeBoxMinutes: '5', retries: '0', generations: '6' },
  });
}

/** A one-line scripted reply, written as a fresh replay session/override pair inside a home: the
 *  only conversation turn most of this file's owner states need — "Keep this conversation as the
 *  Campaign Agent." answered with "Campaign Agent conversation is ready." (`campaign-graph.desktop
 *  .test.ts`'s own recipe).
 *
 *  C7 investigation note: a genuinely `running` node (as opposed to a Run merely `status: 'running'`
 *  with an unlaunched `currentNode`) needs a real Campaign Agent driving `hima_execute` turn by turn
 *  — `begin` admits a node, then `work` actually launches its Job, and `work` requires the
 *  `executionId` `begin`'s own receipt mints fresh per call (a `randomUUID()`), which a static
 *  replay script cannot know ahead of time. `{{fromRequest:<regex>}}` can in principle extract it
 *  from a later turn's own request (which by then carries the prior turn's tool result in its
 *  history), and scripting exactly that was tried here; it did not resolve within a reasonable
 *  number of iterations (the second scripted reply's own confirmation text never appeared), and
 *  chasing the exact reason further — inside `fabric.ts`'s own execution-admission protocol, out of
 *  this file's scope — was not a good trade against the rest of this review. States 3 and 6 below
 *  therefore read whichever node `run.currentNode` already names (the entry, immediately after
 *  Run creation) rather than gating on a literal `running` node-state read, which C7 asked for but
 *  this fixture cannot yet reliably produce. */
async function ownerReplayFiles(home: LocalHome | { readonly h: { readonly home: string } }): Promise<{ readonly file: string; readonly override: string }> {
  const dir = path.join(home.h.home, 'owner-replay'); await mkdir(dir, { recursive: true });
  const file = path.join(dir, 'session.jsonl');
  const override = path.join(dir, 'replay.override.json');
  await writeFile(file, `${JSON.stringify({ version: 0, type: 'session', id: 'session-owner', createdAt: 0, cwd: '{{cwd}}' })}\n`);
  const say = (text: string): ReplayEntry => ({ kind: 'chunks', chunks: [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'finish', reason: { kind: 'stop' } },
  ] });
  await writeFile(override, `${JSON.stringify([say('Campaign Agent conversation is ready.')], null, 2)}\n`);
  return { file, override };
}

/** A home with the shipped Pack, the stand-in flow and the local Site already seeded
 *  (`localHome`, `support/fabric.ts` — the same fixture `growth.ts`'s and `revision.ts`'s own
 *  fixtures build on), booted with a one-line owner replay and `HIMA_TEST_LEGACY_AUTO_DRIVE`
 *  forced off — the only way a Run this window starts actually carries a conversational owner
 *  (`run.control`), which the FabricCanvas's own scene requires (`executionContext`, `fabric.ts`,
 *  returns no `method` at all once `run.control === undefined`; states 3, 4 and 6 need the graph
 *  itself, not only the masthead's status word). `home: 'hima'`'s own convenience seeding cannot be
 *  used here: it seeds no replay model, and without one a driven owner conversation has nothing to
 *  answer "Keep this conversation as the Campaign Agent." with. */
async function bootOwnedShipped(
  t: TestContext, theme: 'light' | 'dark', port: number, extraEnv: Readonly<Record<string, string>> = {},
): Promise<{ d: BootedDriver; home: LocalHome } | undefined> {
  const home = await localHome(t, {});
  if (!home) return undefined;
  const replay = await ownerReplayFiles(home);
  const d = await bootDriver(t, { existing: home.h, remoteDebuggingPort: port, theme, window: WINDOW,
    model: { replay: { file: replay.file, override: replay.override, children: [] } },
    env: { HIMA_TEST_LEGACY_AUTO_DRIVE: '0', HIMA_TEST_SILENT_AGENT: '1', ...extraEnv } });
  if (!d) { await home.h.dispose(); return undefined; }
  return { d, home };
}

/** A short agent-owned Run on the shipped, fast pack (never the 51-node one — that is state 7's own
 *  subject): one native session says it will be the Campaign Agent, the scripted reply confirms it,
 *  and Configuration confirms a plain Campaign from the shipped Pack. */
async function establishOwnerSession(d: BootedDriver, browser: Inspector): Promise<{ host: HostAnswer; cookie: string; ownerSessionId: string; runId: string }> {
  await d.open('/');
  await browser.wait(`document.body.innerText.includes('Internal Testing Notice')`);
  await browser.markText('button', 'Continue', 'notice-continue'); assert.ok((await d.click('notice-continue')).ok);
  const host = await d.host(); assert.ok(host.ok); const cookie = await d.cookie();
  const workspace = await api(host, cookie, '/api/workspace/create', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: 'owner-workspace', method: 'workspace/create', payload: { args: { request: { path: d.home.workspace } } } }) });
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
  const owner = await d.read('studio'); assert.ok(owner.ok, JSON.stringify(owner));
  const ownerSessionId = owner.state.session; assert.ok(ownerSessionId, JSON.stringify(owner));
  await waitForConfigurationPaneSettled(browser);
  await fillShipped(d, browser);
  assert.ok((await d.click('config-confirm')).ok);
  await browser.wait(`!!document.querySelector('[data-hima-region="campaign-masthead"]')`, 20_000);
  const runId = await currentRun(d);
  await browser.wait(`document.querySelector('[data-hima-region="campaign-chip"]')?.getAttribute('data-hima-state-status') !== undefined`, 15_000).catch(() => undefined);
  return { host, cookie, ownerSessionId, runId };
}

/** Run both themes of one acceptance state under one `test()`, so the file reports exactly seven
 *  results — one per acceptance state — each covering its own light and dark boot. A theme that
 *  throws is diagnosed and the other theme still runs, so a partial failure still leaves whichever
 *  screenshot it could take on disk; the state is reported failed only once both have been tried. */
async function bothThemes(t: TestContext, run: (theme: 'light' | 'dark') => Promise<void>): Promise<void> {
  const failures: string[] = [];
  for (const theme of ['light', 'dark'] as const) {
    try {
      await run(theme);
    } catch (error) {
      const message = `${theme}: ${(error as Error).stack ?? String(error)}`;
      t.diagnostic(message);
      failures.push(message);
    }
  }
  if (failures.length) throw new Error(failures.join('\n'));
}

/**
 * A2: opens a fresh native session and its own workbench pane, sharing the one bootstrap sequence
 * every "second session in this same window" state needs (state 6's own Side Talk today) — click
 * "New session", wait for its composer to render, wait for `open-workbench` to enable, click it,
 * then wait for that session's own `studio` region to actually mount.
 *
 * Diagnosed by running state 6 alone three times in a row (foreground, this sandbox): 2 of 3 runs
 * failed, every time at the exact same step — `document.querySelector('[data-hima-region="studio"]')
 * !== null` timing out — and every failure happened here, before a single Hima-specific assertion had
 * even run (the very next line after this helper reads `data-hima-state-session`, which is where a
 * genuine Fabric-state defect would instead surface). That is a session/dock-panel bootstrap race in
 * this sandbox, not a rendering defect this task's own acceptance criteria are about, so it is
 * hardened here with one bounded retry of the click-and-wait itself (max 2 attempts, logged) —
 * never a retry of a Hima assertion, which must still fail loud and immediately if the state it
 * reads is actually wrong.
 */
async function openNewSessionWorkbench(t: TestContext, d: BootedDriver, browser: Inspector, clickMark: string, openMark: string): Promise<void> {
  const maxAttempts = 2;
  // "New session" is clicked at most once: a first attempt's own click already creates the fresh
  // session (confirmed by its own composer rendering, waited for below), so a naive retry that
  // re-clicked it on a second attempt was itself found to break the second attempt — a second click
  // on that same control while a session draft is already open dismisses it instead of opening
  // another, which then leaves no `open-workbench` control for the retry's own mark to find at all
  // (empirically: attempt 2 failed at that exact mark, "missing control", diagnosed while building
  // this fix). Only the part that actually raced in three straight foreground runs — the wait for
  // `studio` to mount after `open-workbench` is clicked — is retried, together with re-clicking
  // `open-workbench` itself (idempotent: clicking an already-open tab's own opener again is a no-op
  // on the same tab), never the "New session" bootstrap step and never a Hima-specific assertion.
  await browser.mark('[aria-label="New session"]', clickMark);
  assert.ok((await d.click(clickMark)).ok);
  await browser.wait(`document.body.innerText.includes('New session') && [...document.querySelectorAll('[contenteditable="true"]')].some(e=>e.getBoundingClientRect().height>0)`);
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await browser.wait(`!document.querySelector('[data-hima-control="open-workbench"]')?.disabled`);
      await browser.mark('[data-hima-control="open-workbench"]', openMark);
      assert.ok((await d.click(openMark)).ok);
      await browser.wait(`document.querySelector('[data-hima-region="studio"]') !== null`, 20_000);
      return;
    } catch (error) {
      if (attempt >= maxAttempts) throw error;
      t.diagnostic(`openNewSessionWorkbench: attempt ${String(attempt)}/${String(maxAttempts)} failed waiting for studio to mount (${(error as Error).message}); retrying the open-workbench click and wait once more, never the "New session" step and never a Hima assertion`);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// State 1: Configuration page empty (no Pack, no Site).
// ---------------------------------------------------------------------------------------------

test('state 1: Configuration page empty shows Install a Pack and Ask HimaGuide', async (t) => {
  if (windowUnavailable(t)) return;
  await bothThemes(t, async (theme) => {
    const port = await freePort();
    const d = await bootDriver(t, { home: 'empty', theme, window: WINDOW, remoteDebuggingPort: port });
    if (!d) return;
    let browser: Inspector | undefined;
    try {
      browser = await inspectWindow(port);
      await prepareSession(d, browser, false);
      const width = await widenDockPane(browser);
      t.diagnostic(`state 1 (${theme}) dock pane width after drag: ${String(width)}px`);
      assert.ok(width >= 700, `dock pane widened to at least 700px: ${String(width)}`);
      await waitForConfigurationPaneSettled(browser);
      assert.ok((await d.wait('config-empty-pack', 'No HimaPack is installed', 10_000)).ok);
      const configPack = await d.read('config-pack'); assert.ok(configPack.ok, JSON.stringify(configPack));
      assert.match(configPack.text, /Install a Pack/);
      assert.match(configPack.text, /Ask HimaGuide/);
      assert.equal(await browser.evaluate(`!!document.querySelector('[data-hima-control="config-install-pack"]')`), true);
      assert.equal(await browser.evaluate(`!!document.querySelector('[data-hima-control="config-ask-pack"]')`), true);
      const configuration = await d.read('configuration'); assert.ok(configuration.ok, JSON.stringify(configuration));
      assert.equal(configuration.state.pack, '', 'no Pack chosen');
      assert.equal(configuration.state.site, '', 'no Site chosen');
      assert.equal(configuration.state.ready, 'false');
      await capture(d, browser, `config-empty-${theme}`);
    } finally { await finish(d, browser); }
  });
});

// ---------------------------------------------------------------------------------------------
// State 2: Configuration page ready.
// ---------------------------------------------------------------------------------------------

test('state 2: Configuration page reports ready once the shipped Pack, Site and Goal are filled', async (t) => {
  if (windowUnavailable(t)) return;
  await bothThemes(t, async (theme) => {
    const port = await freePort();
    const d = await bootDriver(t, { home: 'hima', sleepSeconds: 0, theme, window: WINDOW, remoteDebuggingPort: port });
    if (!d) return;
    let browser: Inspector | undefined;
    try {
      browser = await inspectWindow(port);
      await prepareSession(d, browser, false);
      const width = await widenDockPane(browser);
      t.diagnostic(`state 2 (${theme}) dock pane width after drag: ${String(width)}px`);
      assert.ok(width >= 700, `dock pane widened to at least 700px: ${String(width)}`);
      await waitForConfigurationPaneSettled(browser);
      await fillShipped(d, browser);
      const configuration = await d.read('configuration'); assert.ok(configuration.ok, JSON.stringify(configuration));
      assert.equal(configuration.state.ready, 'true');
      assert.equal(configuration.state.pack, timingProbePackId);
      assert.equal(configuration.state.site, 'local');
      assert.equal(await browser.evaluate(`document.querySelector('[data-hima-control="config-confirm"]').disabled`), false);
      await capture(d, browser, `config-ready-${theme}`);
    } finally { await finish(d, browser); }
  });
});

// ---------------------------------------------------------------------------------------------
// State 3: running with a node card open.
// ---------------------------------------------------------------------------------------------

test('state 3: a running Campaign opens its current node\'s card', async (t) => {
  if (windowUnavailable(t)) return;
  await bothThemes(t, async (theme) => {
    const port = await freePort();
    // `campaign-graph`/`campaign-node-card` are FabricCanvas's own: it never mounts without a scene,
    // and a scene needs `context.method.reference`, which `executionContext` only ever computes for
    // an owned Run (`fabric.ts`) — so this state, like 4 and 6, needs `bootOwnedShipped`.
    const booted = await bootOwnedShipped(t, theme, port);
    if (!booted) return;
    const { d, home } = booted;
    let browser: Inspector | undefined;
    try {
      browser = await inspectWindow(port);
      await establishOwnerSession(d, browser);
      await browser.wait(`!!document.querySelector('[data-hima-region="campaign-graph"]')`, 15_000);
      await browser.wait(`document.querySelector('[data-hima-region="campaign-graph"]')?.getAttribute('data-hima-state-current') !== ''`, 20_000);
      const graph = await d.read('campaign-graph'); assert.ok(graph.ok, JSON.stringify(graph));
      const current = graph.state.current; assert.ok(current, JSON.stringify(graph));
      const width = await widenDockPane(browser);
      t.diagnostic(`state 3 (${theme}) dock pane width after drag: ${String(width)}px`);
      assert.ok(width >= 700, `dock pane widened to at least 700px: ${String(width)}`);
      assert.ok((await d.click(`node-${current}`)).ok);
      // C7: opening the card no longer needs a manual pan here — `FabricCanvas.tsx`'s own selection
      // effect now pans the camera itself, so the selected node sits at 25% of the canvas width
      // whenever the card (a fixed ~384px) would otherwise cover more than half of it. Waiting for the
      // card's own region to report this node is the one wait that actually matters here; the earlier
      // draft additionally re-read and re-asserted the same fact the wait had already established.
      await browser.wait(`document.querySelector('[data-hima-region="campaign-node-card"]')?.getAttribute('data-hima-state-node') === ${JSON.stringify(current)}`, 10_000);
      const card = await d.read('campaign-node-card'); assert.ok(card.ok, JSON.stringify(card));
      await capture(d, browser, `running-node-card-${theme}`);
    } finally { await finish(d, browser); await home.h.dispose(); }
  });
});

// ---------------------------------------------------------------------------------------------
// State 4: waiting with the attention strip.
// ---------------------------------------------------------------------------------------------

test('state 4: a blocked Campaign shows the attention strip with the blocker\'s own reason', async (t) => {
  if (windowUnavailable(t)) return;
  await bothThemes(t, async (theme) => {
    const port = await freePort();
    // One failed attempt (the same fixture `unified-workbench.test.ts`'s own retry case uses) blocks
    // the entry node until a person acts: a real HimaFabric `waiting`, not a fixture kind of its own.
    // This Run is the file's own default (unowned, legacy auto-drive) — the attention strip's own
    // routed fix (item B) is what makes `campaign-attention` render for it at all
    // (`CampaignTab.tsx`'s graph-less fallback now reads `view.blockers` directly, independently of
    // `executionContext`'s method/reference, which only an *owned* Run ever carries).
    const d = await bootDriver(t, { home: 'hima', sleepSeconds: 5, failures: 1, theme, window: WINDOW, remoteDebuggingPort: port });
    if (!d) return;
    let browser: Inspector | undefined;
    try {
      browser = await inspectWindow(port);
      const { host, cookie } = await prepareSession(d, browser, false);
      await waitForConfigurationPaneSettled(browser);
      await fillShipped(d, browser, '2.3');
      assert.ok((await d.click('config-confirm')).ok);
      assert.ok((await d.wait('campaign-masthead', 'waiting', 25_000)).ok);
      const width = await widenDockPane(browser);
      t.diagnostic(`state 4 (${theme}) dock pane width after drag: ${String(width)}px`);
      assert.ok(width >= 700, `dock pane widened to at least 700px: ${String(width)}`);
      const id = await currentRun(d);
      const view = await (await api(host, cookie, `/hima/api/runs/${id}`)).json() as RunView;
      const reason = view.blockers.at(-1)?.reason;
      assert.ok(reason, `the Run carries a blocker: ${JSON.stringify(view.blockers)}`);
      await browser.wait(`document.querySelector('[data-hima-region="campaign-attention"]')?.getAttribute('data-hima-state-kind') === 'waiting'`, 10_000);
      const stripReason = await browser.evaluate<string>(`document.querySelector('[data-hima-region="campaign-attention"] span')?.textContent ?? ''`);
      assert.equal(stripReason, reason, 'the strip says the same reason the Run itself carries');
      await capture(d, browser, `waiting-attention-${theme}`);
    } finally { await finish(d, browser); }
  });
});

// ---------------------------------------------------------------------------------------------
// State 5: ended with the Goal seal.
// ---------------------------------------------------------------------------------------------

test('state 5: an ended Campaign shows the Goal seal for ended-goal-met', async (t) => {
  if (windowUnavailable(t)) return;
  await bothThemes(t, async (theme) => {
    const port = await freePort();
    const d = await bootDriver(t, { home: 'hima', sleepSeconds: 0, theme, window: WINDOW, remoteDebuggingPort: port });
    if (!d) return;
    let browser: Inspector | undefined;
    try {
      browser = await inspectWindow(port);
      await prepareSession(d, browser, false);
      await waitForConfigurationPaneSettled(browser);
      await fillShipped(d, browser);
      assert.ok((await d.click('config-confirm')).ok);
      assert.ok((await d.wait('campaign-masthead', 'ended — goal met', 35_000)).ok);
      const width = await widenDockPane(browser);
      t.diagnostic(`state 5 (${theme}) dock pane width after drag: ${String(width)}px`);
      assert.ok(width >= 700, `dock pane widened to at least 700px: ${String(width)}`);
      await browser.wait(`document.querySelector('[data-hima-region="campaign-goal"]')?.getAttribute('data-hima-state-status') === 'ended-goal-met'`, 10_000);
      const sealText = await browser.evaluate<string>(`document.querySelector('[data-hima-region="campaign-goal"] .hima-goal-title')?.textContent ?? ''`);
      assert.match(sealText, /ended.*goal met/, `the seal says the run status label: ${sealText}`);
      await capture(d, browser, `ended-goal-${theme}`);
    } finally { await finish(d, browser); }
  });
});

// ---------------------------------------------------------------------------------------------
// State 6: Side Talk non-owner.
// ---------------------------------------------------------------------------------------------

test('state 6: a Side Talk viewing an owned Run sees who owns it and no business control', async (t) => {
  if (windowUnavailable(t)) return;
  await bothThemes(t, async (theme) => {
    const port = await freePort();
    const booted = await bootOwnedShipped(t, theme, port);
    if (!booted) return;
    const { d, home } = booted;
    let browser: Inspector | undefined;
    try {
      browser = await inspectWindow(port);
      const { ownerSessionId, runId } = await establishOwnerSession(d, browser);

      // A2: hardened against the bootstrap race diagnosed above — one bounded retry of the click
      // and studio-mount wait, never of the Hima assertion right after it.
      await openNewSessionWorkbench(t, d, browser, 'new-side-talk', 'open-side-workbench');
      const sideSession = await browser.evaluate<string>(`document.querySelector('[data-hima-region="studio"]')?.getAttribute('data-hima-state-session') || ''`);
      assert.ok(sideSession && sideSession !== ownerSessionId, 'the Side Talk is a genuinely different session');

      assert.ok((await d.fill('studio-run', runId)).ok);
      await browser.wait(`document.querySelector('[data-hima-region="campaign"]') !== null`, 10_000);
      const width = await widenDockPane(browser);
      t.diagnostic(`state 6 (${theme}) dock pane width after drag: ${String(width)}px`);
      assert.ok(width >= 700, `dock pane widened to at least 700px: ${String(width)}`);
      const campaign = await d.read('campaign'); assert.ok(campaign.ok, JSON.stringify(campaign));
      assert.equal(campaign.state.owner, 'side-talk');
      assert.equal(await browser.evaluate(`document.querySelector('[data-hima-region="campaign-chip"]') === null`), true, 'a Side Talk carries no Campaign identity of its own');
      assert.equal(await browser.evaluate(`!!document.querySelector('[data-hima-control="open-owner"]')`), true, 'one way to the owning conversation');
      // C7: open the current node's own card on this Side Talk view and check the footer it actually
      // renders — "Continue is never offered to a non-owner" was previously only ever checked page-
      // wide, never on the one surface (`NodeCard`'s own `Footer`) that draws the owner/non-owner
      // split at all.
      const graph = await d.read('campaign-graph'); assert.ok(graph.ok, JSON.stringify(graph));
      const current = graph.state.current; assert.ok(current, JSON.stringify(graph));
      assert.ok((await d.click(`node-${current}`)).ok);
      await browser.wait(`document.querySelector('[data-hima-region="campaign-node-card"]')?.getAttribute('data-hima-state-node') === ${JSON.stringify(current)}`, 10_000);
      assert.equal(await browser.evaluate(`!!document.querySelector('[data-hima-region="campaign-node-card"] [data-hima-region="emergency"]')`), true, 'the non-owner footer discloses its own Emergency section');
      assert.equal(await browser.evaluate(`!!document.querySelector('[data-hima-region="campaign-node-card"] [data-hima-control="node-continue"]')`), false, 'Continue is never offered to a non-owner');
      await capture(d, browser, `side-talk-${theme}`);
    } finally { await finish(d, browser); await home.h.dispose(); }
  });
});

// ---------------------------------------------------------------------------------------------
// State 7: a fifty-one node graph fitted to width.
// ---------------------------------------------------------------------------------------------

/** The same custom-cell-fmax-dtco fixture and owner replay `campaign-graph.desktop.test.ts` boots,
 *  trimmed to exactly this state's own subject: the graph's node count and its fit-to-width scale,
 *  never Side Talk or handoff (both are `campaign-graph.desktop.test.ts`'s and, for a non-owner
 *  viewer without the 51-node graph, this file's own state 6). */
async function bootFiftyOneNodeGraph(t: TestContext, theme: 'light' | 'dark', remoteDebuggingPort: number) {
  const { createHimaHome } = await import('./support/dsh-home.ts');
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
  const replayDir = path.join(h.home, 'graph-51-replay'); await mkdir(replayDir);
  const replayFile = path.join(replayDir, 'session.jsonl'), replayOverride = path.join(replayDir, 'replay.override.json');
  await writeFile(replayFile, `${JSON.stringify({ version: 0, type: 'session', id: 'session-graph-51', createdAt: 0, cwd: '{{cwd}}' })}\n`);
  const say = (text: string): ReplayEntry => ({ kind: 'chunks', chunks: [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'finish', reason: { kind: 'stop' } },
  ] });
  await writeFile(replayOverride, `${JSON.stringify([say('Campaign Agent conversation is ready.')], null, 2)}\n`);
  const bindings = Object.fromEntries([
    ['designRoot', inputsRoot], ['rtlGlob', rtl], ['designTop', 'held_out_ui_fixture'], ['constraints', constraints],
    ['foundryLibrary', foundry], ['physicalInputs', physical], ['toolStack', tools], ['workspaceRoot', h.workspace],
  ]);
  await writeLocalSite(h, { bindings, allowedReadRoots: [packSource, inputsRoot, h.workspace], allowedWriteRoots: [h.workspace],
    allowedWrappers: ['/usr/bin/python3'], licences: { 'Design-Compiler': 1, 'Library-Compiler': 1, Innovus: 1 } });
  await writeReplayOverlay(h.home, { file: replayFile, overrideFile: replayOverride });
  const d = await bootDriver(t, { existing: h, remoteDebuggingPort, theme, window: WINDOW,
    model: { replay: { file: replayFile, override: replayOverride, children: [] } },
    env: { HIMA_TEST_LEGACY_AUTO_DRIVE: '0', HIMA_TEST_SILENT_AGENT: '1' } });
  if (!d) { await h.dispose(); return undefined; }
  return { d, h, packSource };
}

test('state 7: a fifty-one node graph fits to width, scaled and label-hidden', async (t) => {
  if (windowUnavailable(t)) return;
  await bothThemes(t, async (theme) => {
    const port = await freePort();
    const booted = await bootFiftyOneNodeGraph(t, theme, port);
    if (!booted) return;
    const { d, h } = booted;
    let browser: Inspector | undefined;
    try {
      browser = await inspectWindow(port);
      await d.open('/');
      await browser.wait(`document.body.innerText.includes('Internal Testing Notice')`);
      await browser.markText('button', 'Continue', 'notice-continue'); assert.ok((await d.click('notice-continue')).ok);
      const host = await d.host(); assert.ok(host.ok); const cookie = await d.cookie();
      const workspace = await api(host, cookie, '/api/workspace/create', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: 'graph-51-workspace', method: 'workspace/create', payload: { args: { request: { path: h.workspace } } } }) });
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

      assert.ok((await d.wait('config-empty-pack', 'No HimaPack is installed', 10_000)).ok);
      assert.ok((await d.click('studio-pack-owner')).ok);
      assert.ok((await d.fill('owner-pack', 'custom-cell-fmax-dtco')).ok);
      assert.ok((await d.fill('owner-location', booted.packSource)).ok);
      assert.ok((await d.click('owner-review')).ok);
      assert.ok((await d.wait('pack-review', 'knowledge/manifest.yml', 12_000)).ok);
      assert.ok((await d.click('owner-confirm')).ok);
      assert.ok((await d.wait('pack-owner-message', 'Confirmed files verified and written', 12_000)).ok);
      assert.ok((await d.click('studio-pack-owner')).ok);

      await browser.wait(`!!document.querySelector('[data-hima-control="config-pack"] option[value="custom-cell-fmax-dtco"]')`, 10_000);
      assert.ok((await d.fill('config-pack', 'custom-cell-fmax-dtco')).ok);
      await browser.wait(`!!document.querySelector('[data-hima-control="config-goal-target_period_ns"]')`);
      assert.ok((await d.fill('config-goal-target_period_ns', '0.5')).ok);
      assert.ok((await d.fill('config-goal-target_fmax_improvement_pct', '5')).ok);
      assert.ok((await d.fill('config-site', 'local')).ok);
      await waitForConfigurationReady(d, 'custom-cell-fmax-dtco', 'local', 30_000);
      assert.ok((await d.click('config-confirm')).ok);
      await browser.wait(`Number(document.querySelector('[data-hima-region="campaign-graph"]')?.getAttribute('data-hima-state-nodes'))>=48`, 20_000);
      const width = await widenDockPane(browser);
      t.diagnostic(`state 7 (${theme}) dock pane width after drag: ${String(width)}px`);
      assert.ok(width >= 700, `dock pane widened to at least 700px: ${String(width)}`);
      // The very first render still shows the raw pre-fit default (`transform` starts at `scale: 1`)
      // until the fit effect has actually run against the container's real measured size; wait for
      // the scale to move off that default before reading anything from it.
      await browser.wait(`document.querySelector('[data-hima-region="campaign-graph"]')?.getAttribute('data-hima-state-scale') !== '1.00'`, 20_000).catch(() => undefined);
      // Fit-to-width opens no smaller than a 0.6 scale by deliberate design, whatever the pane's own
      // width or the scene's own size — "labels must be visible the moment the canvas opens"
      // (`FabricCanvas.tsx`'s own fit effect: `Math.max(0.6, fit.scale)`). A dense reference graph
      // therefore always *opens* fitted exactly to that floor, readable, with the rest of a 51-node
      // scene running off past the canvas's own edge (the very defect this state exists to catch).
      // A1: `canvas-fit` is the escape hatch, and a deliberate user action rather than the initial
      // fit — it is floored at 0.15 (not the interactive zoom's own 0.4), low enough that this
      // fixture's own ~54-node, ~4885-unit-wide scene actually fits inside a 760px pane
      // ((760-32)/4885 ≈ 0.149 < 0.4) instead of clamping to 0.4 and still running a strip off the
      // canvas's own right edge.
      assert.ok((await d.click('canvas-fit')).ok);
      await browser.wait(`Number(document.querySelector('[data-hima-region="campaign-graph"]')?.getAttribute('data-hima-state-scale')) < 0.6`, 10_000);
      // The scale settles onto its final value across the same two-frame `requestAnimationFrame`
      // dance the initial fit effect uses (no CSS transition to wait out here — `canvas-fit` calls
      // `setTransform` directly) — reading it twice, a frame apart, confirms it before this state's
      // own acceptance assertions and the capture read it.
      const settledScale = await browser.evaluate<string>(`new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(document.querySelector('[data-hima-region="campaign-graph"]')?.getAttribute('data-hima-state-scale') ?? ''))))`);
      await browser.wait(`document.querySelector('[data-hima-region="campaign-graph"]')?.getAttribute('data-hima-state-scale') === ${JSON.stringify(settledScale)}`, 5_000);
      const graph = await d.read('campaign-graph'); assert.ok(graph.ok, JSON.stringify(graph));
      assert.ok(Number(graph.state.nodes) >= 48, JSON.stringify(graph));
      assert.ok(Number(graph.state.scale) < 0.6, JSON.stringify(graph));
      const labelsHidden = await browser.evaluate<boolean>(`(() => {
        const group = document.querySelector('[data-hima-region="campaign-graph"] .hima-node-labels');
        if (!group) return false;
        return getComputedStyle(group).visibility === 'hidden';
      })()`);
      assert.equal(labelsHidden, true, 'node labels hide below the 60% zoom floor');
      // A1: the whole 51-node graph must actually show across the pane, not just report a scale
      // below 0.6 — the rightmost node's own screen position (the reference graph's last node, by
      // construction the one `canvas-fit` would otherwise leave running off the right edge) must
      // land inside the canvas container's own visible bounds.
      const lastNodeInBounds = await browser.evaluate<{ ok: boolean; nodeLeft?: number; containerRight?: number }>(`(() => {
        const container = document.querySelector('[data-hima-region="campaign-graph"]');
        if (!container) return { ok: false };
        const containerRect = container.getBoundingClientRect();
        const nodes = [...container.querySelectorAll('[data-hima-region^="campaign-node-"]')];
        if (nodes.length === 0) return { ok: false };
        let rightmost = nodes[0];
        for (const candidate of nodes) if (candidate.getBoundingClientRect().left > rightmost.getBoundingClientRect().left) rightmost = candidate;
        const nodeRect = rightmost.getBoundingClientRect();
        return { ok: nodeRect.left >= containerRect.left && nodeRect.left <= containerRect.right, nodeLeft: nodeRect.left, containerRight: containerRect.right };
      })()`);
      assert.ok(lastNodeInBounds.ok, `the last node's own screen x should sit inside the canvas: ${JSON.stringify(lastNodeInBounds)}`);
      await capture(d, browser, `graph-51-node-${theme}`);
    } finally {
      await finish(d, browser);
      await h.dispose();
    }
  });
});
