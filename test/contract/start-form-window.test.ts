// L3: real Electron form, with only response delivery controlled through Chromium's test port.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootDriver, fillForm, type BootedDriver } from './support/driver.ts';
import { freePort } from './support/boot-host.ts';
import { packsDirOf, timingProbePackId, writePackVariant } from './support/pack.ts';
import { api } from './support/hima-api.ts';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

interface Paused { requestId: string; request: { url: string } }

// This small client is only fault injection at the real browser's HTTP boundary. Product controls
// still go through the existing desktop driver; no production eval or interception API is added.
async function delayedResponses(port: number) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() as { type: string; webSocketDebuggerUrl: string }[];
  const page = targets.find((target) => target.type === 'page');
  assert.ok(page);
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise<void>((resolve, reject) => { socket.addEventListener('open', () => resolve(), { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let nextId = 0;
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  const paused: Paused[] = [];
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data)) as { id?: number; error?: { message: string }; result?: unknown; method?: string; params?: Paused };
    if (message.id !== undefined) {
      const request = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) request?.reject(new Error(message.error.message)); else request?.resolve(message.result);
    } else if (message.method === 'Fetch.requestPaused') paused.push(message.params!);
  });
  const send = (method: string, params: Record<string, unknown> = {}) => new Promise<unknown>((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP ${method} timed out`)); }, 10_000);
    pending.set(id, { resolve: (value) => { clearTimeout(timer); resolve(value); }, reject: (err) => { clearTimeout(timer); reject(err); } });
    socket.send(JSON.stringify({ id, method, params }));
  });
  await send('Fetch.enable', { patterns: [{ urlPattern: '*/hima/?pack=*', requestStage: 'Response' }] });
  return {
    send,
    take: async (pack: string, site?: string) => {
      const deadline = Date.now() + 10_000;
      for (;;) {
        const found = paused.findIndex((response) => new URL(response.request.url).searchParams.get('pack') === pack && (site === undefined || new URL(response.request.url).searchParams.get('site') === site));
        if (found >= 0) return paused.splice(found, 1)[0]!;
        if (Date.now() >= deadline) throw new Error(`no paused real response for ${pack}`);
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    },
    release: (response: Paused) => send('Fetch.continueRequest', { requestId: response.requestId }),
    close: async () => { await send('Fetch.disable'); socket.close(); },
  };
}

async function formState(d: BootedDriver, region: string, key: string, value: string) {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const shown = await d.read(region);
    if (shown.ok && shown.state[key] === value) return shown;
    if (Date.now() >= deadline) assert.fail(`expected ${region} ${key}=${value}: ${JSON.stringify(shown)}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

test('rapid Pack selections keep the current strategy and latest typed inputs when real responses arrive out of order', async (t) => {
  const port = await freePort();
  const d = await bootDriver(t, { home: 'hima', remoteDebuggingPort: port });
  if (!d) return;
  let delayed: Awaited<ReturnType<typeof delayedResponses>> | undefined;
  try {
    await writePackVariant(packsDirOf(d.home), 'second-probe', [], []);
    const siteFile = path.join(d.home.home, 'hima/sites/local.yml');
    await writeFile(path.join(d.home.home, 'hima/sites/other.yml'), (await readFile(siteFile, 'utf8')).replace('name: local', 'name: other'));
    await d.open('/hima/');
    await fillForm(d, { 'start-pack': timingProbePackId, 'start-site': 'local', 'start-target': '2.3', 'start-knob-periodNs': '2.4' });
    delayed = await delayedResponses(port);
    await d.fill('start-pack', 'second-probe');
    const old = await delayed.take('second-probe');
    await d.fill('start-pack', timingProbePackId);
    const intermediate = await delayed.take(timingProbePackId, 'local');
    await d.fill('start-site', 'other');
    const current = await delayed.take(timingProbePackId, 'other');
    // A person continues typing after these actual Host responses were generated but before they
    // arrive. The current form values, not request-time defaults, must survive the response.
    await d.fill('start-target', '2.5');
    await d.fill('start-knob-periodNs', '2.6');
    await delayed.release(current);
    await formState(d, 'start-check', 'status', 'fit');
    await delayed.release(intermediate);
    await delayed.release(old);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const knobs = await d.read('start-knobs');
    assert.ok(knobs.ok, JSON.stringify(knobs));
    assert.equal(knobs.state.pack, timingProbePackId);
    const checked = await d.read('start-check');
    assert.ok(checked.ok, JSON.stringify(checked));
    assert.equal(checked.state.site, 'other');
    const values = await delayed.send('Runtime.evaluate', {
      expression: `['start-knob-periodNs', 'start-target'].map(name => document.querySelector('[data-hima-control="' + name + '"]').value)`, returnByValue: true,
    }) as { result: { value: string[] } };
    assert.deepEqual(values.result.value, ['2.6', '2.5']);
    const focused = await delayed.send('Runtime.evaluate', { expression: `document.activeElement.getAttribute('data-hima-control')`, returnByValue: true }) as { result: { value: string } };
    assert.equal(focused.result.value, 'start-knob-periodNs');
    // A failed read is actionable and blocks submit until a subsequent selection check succeeds.
    await d.fill('start-pack', 'second-probe');
    const unavailable = await delayed.take('second-probe', 'other');
    await delayed.send('Fetch.fulfillRequest', { requestId: unavailable.requestId, responseCode: 503, body: Buffer.from('temporarily unavailable').toString('base64') });
    await formState(d, 'start-check', 'status', 'failed');
    assert.ok((await d.wait('start-error', 'HTTP 503', 10_000)).ok);
    const disabled = await delayed.send('Runtime.evaluate', { expression: `document.querySelector('[data-hima-control="start"]').disabled`, returnByValue: true }) as { result: { value: boolean } };
    assert.equal(disabled.result.value, true);
    await d.fill('start-pack', timingProbePackId);
    await delayed.release(await delayed.take(timingProbePackId, 'other'));
    await formState(d, 'start-check', 'status', 'fit');

  } finally {
    if (delayed) await delayed.close();
    await d.dispose();
  }
});


test('a rejected form retains the input, permits correction, and starts one Campaign despite repeated submission', async (t) => {
  const port = await freePort();
  const d = await bootDriver(t, { home: 'hima', remoteDebuggingPort: port });
  if (!d) return;
  let delayed: Awaited<ReturnType<typeof delayedResponses>> | undefined;
  try {
    await d.open('/hima/');
    await fillForm(d, { 'start-pack': timingProbePackId, 'start-site': 'local', 'start-target': '2.3', 'start-knob-periodNs': '0', 'start-generations': '1' });
    await formState(d, 'start-check', 'status', 'fit');
    assert.ok((await d.click('start')).ok);
    assert.ok((await d.wait('start-error', 'cannot start', 10_000)).ok);
    delayed = await delayedResponses(port);
    const held = await delayed.send('Runtime.evaluate', {
      expression: `document.querySelector('[data-hima-control="start-knob-periodNs"]').value`, returnByValue: true,
    }) as { result: { value: string } };
    assert.equal(held.result.value, '0');
    const runs = await d.read('runs');
    assert.ok(runs.ok, JSON.stringify(runs));
    assert.equal(runs.state.count, '0');
    await d.fill('start-knob-periodNs', '2.3');
    // Hold the actual start response, while repeated submit events exercise the in-flight guard.
    await delayed.send('Fetch.enable', { patterns: [{ urlPattern: '*/hima/api/runs/start', requestStage: 'Response' }] });
    assert.ok((await d.click('start')).ok);
    await delayed.send('Runtime.evaluate', { expression: `document.querySelector('[data-hima-region="start"]').requestSubmit(); document.querySelector('[data-hima-region="start"]').requestSubmit();` });
    await delayed.close();
    delayed = undefined;
    const status = await d.wait('run-status', 'ended', 30_000);
    assert.ok(status.ok, JSON.stringify(status));
    const host = await d.host();
    assert.ok(host.ok, JSON.stringify(host));
    const html = await (await api(host, await d.cookie(), '/hima/')).text();
    assert.match(html, /data-hima-state-count="1"/);
  } finally {
    if (delayed) await delayed.close();
    await d.dispose();
  }
});
