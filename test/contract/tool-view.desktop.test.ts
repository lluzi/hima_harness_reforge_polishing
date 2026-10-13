// @hima-seam llm-replay direct
// L3 (live-tool-view task 3): the Campaign pane's Tool tab, through the real Electron shell. Two
// local Sites are seeded — one declaring a `toolView` that points at a fixture page this test serves,
// one declaring none — and a Campaign is started on each. The declaring Site's pane grows a Tool tab
// labelled with the Site's label; the plain Site's pane does not. Opening the tab frames the fixture
// page on a `localhost` URL, the view-only shield swallows a click, Take control lets the click
// reach the page, and a trip to Live and back keeps the very same frame element (no reload).
//
// No SSH and no real model: both Sites are `kind: local`, so the Host publishes the fixture port
// directly with no `ssh -N`, and the Configuration page starts the Campaign under the stand-in flow's
// own auto-drive. The fixture frame is cross-origin to the workbench page, so the click that lands
// inside it is observed on the fixture server's own tally rather than read out of the frame's DOM.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { bootDriver, electronBinary, fillConfiguration, whyNoWindow, type BootedDriver, type HostAnswer } from './support/driver.ts';
import { freePort } from './support/boot-host.ts';
import { api } from './support/hima-api.ts';
import { inspectWindow } from './support/inspect-window.ts';
import { repoRoot } from './support/dsh-home.ts';
import { timingProbePackId } from './support/pack.ts';
import type { RunView } from '@hima/harness';

type Inspector = Awaited<ReturnType<typeof inspectWindow>>;

const WINDOW = { width: 1280, height: 800 };

/** The fixture page, served with a server that also records every click the page reports. */
const fixturePage = path.join(repoRoot, 'test/fixtures/tool-view/page/index.html');

function windowUnavailable(t: TestContext): boolean {
  const electron = electronBinary();
  if ('missing' in electron) { t.skip(electron.missing); return true; }
  const headless = whyNoWindow();
  if (headless !== undefined) { t.skip(`Electron cannot open a window here: ${headless}`); return true; }
  return false;
}

/** A tiny HTTP server standing in for the Site's xpra HTML5 client: it serves the fixture page for
 *  any GET (the Host appends xpra query parameters the dumb page ignores), counts page loads, and
 *  tallies the clicks the page POSTs back — the one thing a cross-origin frame lets a test observe. */
async function serveFixture(port: number): Promise<{ loads(): number; clicks(): number; close(): Promise<void> }> {
  const html = await readFile(fixturePage, 'utf8');
  let loads = 0;
  let clicks = 0;
  const server = http.createServer((req, res) => {
    const url = req.url ?? '/';
    if (req.method === 'POST' && url === '/click') { clicks += 1; res.statusCode = 204; res.end(); return; }
    if (req.method === 'GET' && (url === '/count' || url.startsWith('/count?'))) {
      res.statusCode = 200; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ clicks })); return;
    }
    loads += 1;
    res.statusCode = 200; res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(html);
  });
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  return { loads: () => loads, clicks: () => clicks, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

/** Clone the local Site the `hima` boot already wrote into a second Site `mage`, declaring a tool
 *  view at the fixture port. It reuses `local`'s own Permit and bindings, so the stand-in Campaign is
 *  as ready on it as on `local`; the only difference is the `toolView` block the plain Site lacks. */
async function writeMageSite(home: BootedDriver['home'], port: number): Promise<void> {
  const sitesDir = path.join(home.home, 'hima/sites');
  const local = await readFile(path.join(sitesDir, 'local.yml'), 'utf8');
  const mage = `${local.replace('name: local', 'name: mage').trimEnd()}\ntoolView:\n  kind: xpra-html5\n  port: ${String(port)}\n  label: MAGE\n`;
  await writeFile(path.join(sitesDir, 'mage.yml'), mage);
}

/** Reach the Configuration page's dock tab: dismiss the notice, make the workspace, open a session.
 *  Mirrors `campaign-workspace.desktop.test.ts`'s own `prepareSession`. */
async function prepareSession(d: BootedDriver, browser: Inspector): Promise<{ host: HostAnswer; cookie: string }> {
  await d.open('/');
  await browser.wait(`document.body.innerText.includes('Internal Testing Notice')`);
  await browser.markText('button', 'Continue', 'notice-continue');
  assert.ok((await d.click('notice-continue')).ok);
  if (await browser.evaluate(`document.body.innerText.includes('Configure later')`)) {
    await browser.wait(`document.body.innerText.includes('Configure later')`);
    await browser.markText('button', 'Configure later', 'models-later');
    assert.ok((await d.click('models-later')).ok);
  }
  const host = await d.host(); assert.ok(host.ok);
  const cookie = await d.cookie();
  const response = await api(host, cookie, '/api/workspace/create', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: 'tool-view-workspace', method: 'workspace/create', payload: { args: { request: { path: d.home.workspace } } } }),
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

/** Fill the shipped timing-probe Pack's Configuration document for a named Site, as every suite that
 *  starts a plain Campaign does (`campaign-workspace.desktop.test.ts`'s own `fillShipped`). */
async function fillForSite(d: BootedDriver, browser: Inspector, site: string): Promise<void> {
  await fillConfiguration(d, browser, {
    pack: timingProbePackId, site,
    goal: { target_period_ns: '2.25' }, knobs: { periodNs: '2.3' },
    budget: { timeBoxMinutes: '5', retries: '0', generations: '6' },
  });
}

/** Start the Campaign the Configuration page is filled for and wait for the Campaign pane to mount. */
async function confirmCampaign(d: BootedDriver, browser: Inspector): Promise<void> {
  assert.ok((await d.click('config-confirm')).ok);
  await browser.wait(`!!document.querySelector('[data-hima-region="campaign-masthead"]')`, 20_000);
}

/** The dock pane's own splitter, dragged with real CDP mouse events to give the frame real size —
 *  the same boundary `campaign-workspace.desktop.test.ts` widens through. */
async function widenDockPane(browser: Inspector, targetWidth = 760): Promise<void> {
  const handle = await browser.evaluate<{ x: number; y: number; width: number; height: number } | null>(
    `(() => { const e = document.querySelector('.pI_x6G_handle'); return e ? e.getBoundingClientRect().toJSON() : null; })()`,
  );
  if (handle === null) return;
  const startX = handle.x + handle.width / 2;
  const startY = handle.y + handle.height / 2;
  const targetX = WINDOW.width - targetWidth - handle.width / 2;
  await browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: startX, y: startY, button: 'left', clickCount: 1 });
  for (let i = 1; i <= 5; i++) {
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: startX + (targetX - startX) * (i / 5), y: startY, button: 'left', clickCount: 0 });
  }
  await browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: targetX, y: startY, button: 'left', clickCount: 1 });
  await new Promise((resolve) => setTimeout(resolve, 300));
}

/** Resolve once `predicate` holds, polled, or throw with `why` after `timeoutMs`. */
async function waitUntil(predicate: () => boolean | Promise<boolean>, why: string, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error(why);
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
}

/** Cancel whatever this window still holds open, then dispose — the same cleanup the sibling suites do. */
async function finish(d: BootedDriver | undefined, browser: Inspector | undefined): Promise<void> {
  if (!d) return;
  try {
    if (browser) browser.close();
    const host = await d.host();
    if (host.ok) {
      const cookie = await d.cookie();
      const studio = await d.read('studio');
      const viewerSessionId = studio.ok ? studio.state.session : undefined;
      if (typeof viewerSessionId === 'string' && viewerSessionId !== '') {
        const listed = await api(host, cookie, `/hima/api/runs?sessionId=${encodeURIComponent(viewerSessionId)}`);
        const { runs } = await listed.json() as { runs: RunView['run'][] };
        for (const run of runs.filter((run) => run.status === 'running' || run.status === 'waiting')) {
          await api(host, cookie, `/hima/api/runs/${run.id}/cancel?sessionId=${encodeURIComponent(viewerSessionId)}`, { method: 'POST' }).catch(() => undefined);
        }
      }
    }
  } finally {
    await d.dispose();
  }
}

test('the Tool tab frames a declaring Site\'s tool display, view-only until Take control', async (t) => {
  if (windowUnavailable(t)) return;
  const port = await freePort();
  const fixture = await serveFixture(port);
  const remotePort = await freePort();
  let d: BootedDriver | undefined;
  let browser: Inspector | undefined;
  try {
    d = await bootDriver(t, { home: 'hima', sleepSeconds: 0, theme: 'light', window: WINDOW, remoteDebuggingPort: remotePort });
    if (!d) return;
    await writeMageSite(d.home, port);
    browser = await inspectWindow(remotePort);
    await prepareSession(d, browser);
    await widenDockPane(browser);

    // --- The plain Site: a Campaign on `local` has no Tool tab at all. ---
    await fillForSite(d, browser, 'local');
    await confirmCampaign(d, browser);
    await browser.wait(`!!document.querySelector('[data-hima-region="campaign"]')`, 10_000);
    // The one-shot tool-view status read has to have answered `unavailable`; wait it out, then assert
    // the tab never appears.
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.equal(await browser.evaluate(`!!document.querySelector('[data-hima-control="studio-tool"]')`), false,
      'a Site declaring no tool view grows no Tool tab');

    // --- The declaring Site: a Campaign on `mage` grows a Tool tab labelled MAGE. ---
    assert.ok((await d.click('studio-configure')).ok);
    await browser.wait(`!!document.querySelector('[data-hima-control="config-pack"]')`, 10_000);
    await fillForSite(d, browser, 'mage');
    await confirmCampaign(d, browser);
    await browser.wait(`!!document.querySelector('[data-hima-control="studio-tool"]')`, 10_000);
    const tabText = await browser.evaluate<string>(`document.querySelector('[data-hima-control="studio-tool"]')?.textContent ?? ''`);
    assert.equal(tabText, 'MAGE', `the Tool tab reads the Site's own label: ${tabText}`);

    // Open the tab: the forward reaches ready and the frame points at the localhost URL.
    assert.ok((await d.click('studio-tool')).ok);
    await browser.wait(`document.querySelector('[data-hima-region="toolview"]')?.getAttribute('data-hima-state-viewer') === 'ready'`, 20_000);
    const src = await browser.evaluate<string>(`document.querySelector('[data-hima-control="tool-frame"]')?.getAttribute('src') ?? ''`);
    assert.ok(src.startsWith(`http://localhost:${port}/`), `the frame dials the published localhost URL: ${src}`);
    // The frame must have actually fetched the fixture page before a click can land inside it.
    await waitUntil(() => fixture.loads() >= 1, 'the fixture page was never fetched by the frame', 15_000);

    // The frame's centre, in the workbench page's own viewport pixels. The frame is cross-origin, so
    // only its box is readable from the parent — but `elementFromPoint` there still answers *which*
    // element is topmost at that point, which is the whole of the shield's contract: the shield while
    // view-only, the frame itself once control is taken.
    const rect = await browser.evaluate<{ x: number; y: number; width: number; height: number } | null>(
      `(() => { const e = document.querySelector('[data-hima-control="tool-frame"]'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`,
    );
    assert.ok(rect && rect.width > 40 && rect.height > 40, `the frame has a clickable box: ${JSON.stringify(rect)}`);
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    // What is topmost at the frame's centre, by the control id the parent paints there.
    const topAtCentre = () => browser!.evaluate<string>(`(() => { const e = document.elementFromPoint(${String(cx)}, ${String(cy)}); return e ? (e.getAttribute('data-hima-control') ?? e.tagName) : 'none'; })()`);

    // The fixture frame has its own CDP target; connect to it to read its DOM and to drive a real
    // click into it (the brief's sanctioned "inspect helpers" path — this Electron does not route a
    // parent-page synthetic click into an out-of-process frame, so the parent click below is used only
    // to confirm the shield absorbs it, and the click that reaches the tool is dispatched here).
    let frame: Inspector | undefined;
    for (let attempt = 0; attempt < 20 && frame === undefined; attempt++) {
      frame = await inspectWindow(remotePort, (e) => e.url.includes(`localhost:${String(port)}`)).catch(() => undefined);
      if (frame === undefined) await new Promise((resolve) => setTimeout(resolve, 150));
    }
    assert.ok(frame, 'the fixture frame is a reachable CDP target');
    const frameCount = () => frame!.evaluate<string>(`document.getElementById('hit')?.getAttribute('data-count') ?? 'null'`);
    const clickInFrame = async () => {
      await frame!.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 15, y: 15, button: 'none', buttons: 0, clickCount: 0 });
      await frame!.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 15, y: 15, button: 'left', buttons: 1, clickCount: 1 });
      await frame!.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 15, y: 15, button: 'left', buttons: 0, clickCount: 1 });
    };

    try {
      // View-only by default: the transparent shield is topmost over the frame, so a click at the
      // frame's centre lands on it and the tool is untouched — its counter stays 0.
      assert.equal(await browser.evaluate(`document.querySelector('[data-hima-region="toolview"]')?.getAttribute('data-hima-state-control')`), 'viewing');
      assert.equal(await topAtCentre(), 'tool-shield', 'the view-only shield covers the frame centre');
      await browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'left', buttons: 1, clickCount: 1 });
      await browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx, y: cy, button: 'left', buttons: 0, clickCount: 1 });
      await new Promise((resolve) => setTimeout(resolve, 300));
      assert.equal(await frameCount(), '0', 'a click aimed at the view-only frame leaves its counter at 0');
      assert.equal(fixture.clicks(), 0, 'the view-only shield lets nothing reach the tool');

      // Take control: the shield lifts, the frame itself is now topmost, and a real click reaches the
      // tool — its counter becomes 1 and the tool reports the click back to its server.
      assert.ok((await d.click('tool-take-control')).ok);
      await browser.wait(`document.querySelector('[data-hima-region="toolview"]')?.getAttribute('data-hima-state-control') === 'controlling'`, 5_000);
      assert.equal(await topAtCentre(), 'tool-frame', 'Take control lifts the shield off the frame');
      await clickInFrame();
      await waitUntil(async () => await frameCount() === '1', `the click reached the tool once control was taken (count=${await frameCount()})`);
      assert.equal(fixture.clicks(), 1, 'the tool reported the click to its server');

      // A trip to Live and back keeps the very same frame element — no reload, no remount.
      await browser.evaluate(`document.querySelector('[data-hima-control="tool-frame"]').setAttribute('data-test-identity','frame-1')`);
      assert.ok((await d.click('studio-live')).ok);
      await browser.wait(`document.querySelector('[data-hima-region="toolview"]')?.hasAttribute('hidden') === true`, 5_000);
      assert.ok((await d.click('studio-tool')).ok);
      await browser.wait(`document.querySelector('[data-hima-region="toolview"]')?.hasAttribute('hidden') === false`, 5_000);
      assert.equal(await browser.evaluate(`document.querySelector('[data-hima-control="tool-frame"]')?.getAttribute('data-test-identity')`), 'frame-1',
        'the frame element survived the tab switch (no reload, no remount)');
      assert.equal(await frameCount(), '1', 'the tab switch did not reload the frame; its counter is still 1');

      // Hand back returns to view-only: the shield is topmost over the frame again.
      assert.ok((await d.click('tool-take-control')).ok);
      await browser.wait(`document.querySelector('[data-hima-region="toolview"]')?.getAttribute('data-hima-state-control') === 'viewing'`, 5_000);
      assert.equal(await topAtCentre(), 'tool-shield', 'Hand back restores the view-only shield');
    } finally {
      frame?.close();
    }
  } finally {
    await finish(d, browser);
    await fixture.close();
  }
});
