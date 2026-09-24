// Bug 2 (UI trial 0.3.0-trial.3): Site discovery had no GUI save path. HimaGuide's own `hima_site
// rediscover` tool call is deliberately read-only — writing a Permit's allowed roots is the person's
// authority, never the model's — but until this fix nothing on the Configuration page let a person
// review a fresh rediscovery of an *existing* ssh Site and save it either; the only "Discover with
// HimaGuide" control on an existing Site only drafted a chat message. This is the one directed L3
// case for that fix: real Electron window, real Host, a stand-in ssh Channel (no real SSH spawned).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { localHome } from './support/fabric.ts';
import { bootDriver } from './support/driver.ts';
import { freePort } from './support/boot-host.ts';
import { inspectWindow } from './support/inspect-window.ts';
import { api } from './support/hima-api.ts';
import { discoverSshSite, saveDiscoveredSite, type Channel } from '@hima/harness';

test('a person reviews a rediscovered ssh Site on the Configuration page and only their own Save writes it', async (t) => {
  const home = await localHome(t, { sleepSeconds: 0.01 });
  if (!home) return;

  // An ssh Site this Host already has on file, with no discovery yet — `needs-discovery`, exactly
  // the readiness that shows the "Rediscover" control (`siteNeedsAttention`, ConfigurationPage.tsx).
  const fakeChannel: Channel = {
    siteName: 'lab-a',
    readFile: () => { throw new Error('not used by discovery'); },
    realpath: (p: string) => Promise.resolve(p),
    absent: () => Promise.resolve(true),
    exec: (argv: readonly string[]) => Promise.resolve({
      code: argv[0] === 'which' && argv[1] !== 'tmux' ? 1 : 0,
      stdout: Buffer.from(argv[0] === 'uname' ? 'Linux' : argv.join(' ')),
      stderr: '',
    }),
  };
  const sitesDir = path.join(home.h.home, 'hima/sites');
  const discovered = await discoverSshSite(
    { name: 'lab-a', ssh: { destination: 'engineer@lab.example.com', jumps: [] }, hints: {} },
    () => fakeChannel,
  );
  // Written with no `discovery:` at all: `saveDiscoveredSite` always attaches one, so this writes the
  // ordinary discovered file and then blanks it back out, the cheapest way to reach `needs-discovery`
  // without hand-rolling the whole Site/Permit YAML shape here.
  const saved = saveDiscoveredSite(sitesDir, discovered);
  const discoveryCache = path.join(sitesDir, 'lab-a.discovery.json');
  const withoutDiscovery = (await readFile(saved.file, 'utf8')).replace(/^discovery:[\s\S]*?(?=^capacity:)/m, '');
  await writeFile(saved.file, withoutDiscovery);
  // Current Sites persist observations in the versioned discovery cache rather than inline policy.
  // Removing this fixture cache makes the saved policy genuinely need rediscovery without changing
  // any Permit, binding, capacity or licence field.
  await rm(discoveryCache, { force: true });

  // The real rediscovery the driver triggers answers through the same stand-in table the L2 route
  // tests use — no real SSH is ever spawned (the suite's own sentinel fails the run if one is
  // attempted).
  const table = { 'uname -s': { code: 0, stdout: 'Linux' }, 'which tmux': { code: 0, stdout: '/usr/bin/tmux\n' } };
  const tableFile = path.join(os.tmpdir(), `hima-discovery-standin-${randomUUID()}.json`);
  await writeFile(tableFile, JSON.stringify(table));

  const port = await freePort();
  const d = await bootDriver(t, {
    existing: home.h, remoteDebuggingPort: port, theme: 'light', window: { width: 1440, height: 960 },
    env: { HIMA_TEST_SILENT_AGENT: '1', HIMA_TEST_DISCOVERY_STANDIN: tableFile },
  });
  if (!d) { await rm(tableFile, { force: true }); await home.h.dispose(); return; }
  const browser = await inspectWindow(port);
  try {
    await d.open('/');
    await browser.wait(`document.body.innerText.includes('Internal Testing Notice')`);
    await browser.markText('button', 'Continue', 'notice-continue'); assert.ok((await d.click('notice-continue')).ok);
    await browser.wait(`document.body.innerText.includes('Configure later') || document.body.innerText.includes('Choose a workspace to begin')`);
    if (await browser.evaluate(`document.body.innerText.includes('Configure later')`)) {
      await browser.markText('button', 'Configure later', 'site-rediscover-models-later');
      assert.ok((await d.click('site-rediscover-models-later')).ok);
    }
    const host = await d.host(); assert.ok(host.ok); const cookie = await d.cookie();
    const workspace = await api(host, cookie, '/api/workspace/create', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      type: 'client-request', rpcId: 'site-rediscover-workspace', method: 'workspace/create', payload: { args: { request: { path: home.h.workspace } } },
    }) });
    assert.equal((await workspace.json() as { result: { ok: boolean } }).result.ok, true);
    await browser.wait(`document.querySelector('[role="treegrid"], [role="tree"]')?.textContent.includes('workspace') || [...document.querySelectorAll('[role="row"]')].some(e=>e.textContent.trim()==='workspace')`);
    await browser.markText('button', 'New Session', 'site-rediscover-new-session'); assert.ok((await d.click('site-rediscover-new-session')).ok);
    await browser.wait(`!document.querySelector('[data-hima-control="open-workbench"]').disabled`);
    assert.ok((await d.click('open-workbench')).ok); assert.ok((await d.wait('studio', 'Campaign configuration')).ok);

    await browser.wait(`!!document.querySelector('[data-hima-control="config-site"]')`);
    const filledSite = await d.fill('config-site', 'lab-a');
    assert.ok(filledSite.ok, JSON.stringify(filledSite));
    await browser.wait(`document.querySelector('[data-hima-region="configuration"]')?.getAttribute('data-hima-state-site') === 'lab-a'`);

    // The rediscover control only writes nothing: it must show a review before any file changes.
    await browser.wait(`!!document.querySelector('[data-hima-control="config-site-rediscover"]')`);
    assert.ok((await d.click('config-site-rediscover')).ok);
    assert.ok((await d.wait('config-site-rediscovery', 'not saved yet')).ok);
    assert.doesNotMatch(await readFile(saved.file, 'utf8'), /discovery:/, 'a reviewed-but-unsaved rediscovery writes nothing to the Site file');
    await assert.rejects(readFile(discoveryCache), { code: 'ENOENT' }, 'a preview writes no discovery cache');

    // If an administrator changes the Site after preview, the stale review cannot overwrite it.
    // The conflict stays beside the reviewed draft and offers the exact recovery: rediscover and
    // review the newly current bytes, rather than a generic Campaign-page refresh.
    await writeFile(saved.file, `${withoutDiscovery}\n# administrator changed this Site after preview\n`);
    assert.ok((await d.click('config-site-rediscover-save')).ok);
    assert.ok((await d.wait('config-site-rediscovery', 'changed after this preview', 10_000)).ok);
    assert.doesNotMatch(await readFile(saved.file, 'utf8'), /discovery:/, 'a stale reviewed draft cannot overwrite the changed Site');
    await assert.rejects(readFile(discoveryCache), { code: 'ENOENT' }, 'a stale reviewed draft publishes no observation cache');
    assert.ok((await d.click('config-site-rediscover-retry')).ok);
    await browser.wait(`document.querySelector('[data-hima-region="config-site-rediscovery"]') && !document.querySelector('[data-hima-region="config-site-rediscovery"]')?.innerText.includes('changed after this preview')`);

    // Only the person's own Save of the new review writes it.
    assert.ok((await d.click('config-site-rediscover-save')).ok);
    await (async () => {
      const deadline = Date.now() + 15_000;
      for (;;) {
        const text = await readFile(discoveryCache, 'utf8').catch(() => '');
        if (text.includes('hima-site-discovery-cache/1')) return;
        if (Date.now() >= deadline) throw new Error('the reviewed rediscovery was never published to the discovery cache');
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    })();
    await browser.wait(`document.querySelector('[data-hima-control="config-site"]')?.selectedOptions[0]?.textContent.includes('lab-a') && !document.querySelector('[data-hima-control="config-site"]')?.selectedOptions[0]?.textContent.includes('needs-discovery')`, 20_000);
  } catch (error) {
    t.diagnostic(await browser.evaluate<string>('document.body.innerText'));
    throw error;
  } finally {
    browser.close();
    await d.dispose();
    await rm(tableFile, { force: true });
    await home.h.dispose();
  }
});
