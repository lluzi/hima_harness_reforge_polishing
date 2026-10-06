// Ticket #26: starting, cancelling and resuming a Campaign from the window.
//
// Every test here drives the product the way an engineer does (D42, ADR-0004): the desktop shell in
// driver mode, the workbench page it shows, and the form and controls on that page. A Run is started
// by filling the form and clicking start — never by posting a route the window does not use — and
// what is asserted afterwards is what the page shows and what the routes answer with the session the
// shell established.
//
// Seven subjects, one boot each: the form starts a Run with the Goal and Budget it was given; a value
// the shared validator refuses is refused in the window, in the validator's own words, with no Run
// started; cancel stops a sleeping Job and the card shows the observed stop; a hard-blocked Run shows
// its blocker and its log tail and resumes from the card; a refusal that writes nothing leaves its
// words on the card and the control still clickable; the new route is behind the session fence like
// every other; and the served bundle carries the same controls the page does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { bootDriver } from './support/driver.ts';
import { api } from './support/hima-api.ts';
import { harnessPackageDir } from './support/dsh-home.ts';
import { timingProbePackId } from './support/pack.ts';

test('the start route answers 401 without the session cookie, like every route behind the fence', async (t) => {
  const d = await bootDriver(t, { home: 'hima' });
  if (!d) return;
  try {
    const host = await d.host();
    assert.ok(host.ok, JSON.stringify(host));
    const fenced = await fetch(new URL('/hima/api/runs/start', host.url), {
      method: 'POST',
      body: JSON.stringify({ pack: timingProbePackId, site: 'local', goal: { target_period_ns: 2.0 }, strategy: { periodNs: 2.0 } }),
      headers: { 'content-type': 'application/json' },
    });
    const text = await fenced.text();
    assert.equal(fenced.status, 401, text);
    assert.equal((JSON.parse(text) as { error: { code: string } }).error.code, 'hima/not-authorized', text);

    // The fence claims the whole namespace, so a path no route answers is refused unread too: what
    // says this route is really there is the same request behind the cookie, which reaches the
    // route's own reading of the body rather than "no Hima route at".
    const empty = await api(host, await d.cookie(), '/hima/api/runs/start', {
      method: 'POST',
      body: '{}',
      headers: { 'content-type': 'application/json' },
    });
    const emptyText = await empty.text();
    assert.equal(empty.status, 400, emptyText);
    const refusal = JSON.parse(emptyText) as { error: { code: string; message: string } };
    assert.equal(refusal.error.code, 'hima/bad-request', emptyText);
    assert.match(refusal.error.message, /"pack" is required/, emptyText);

    assert.deepEqual(d.unexpectedStdout(), []);
  } finally {
    await d.dispose();
  }
});

test('the served HimaGuide bundle carries the card\'s cancel and resume controls, as the page does', async (t) => {
  const d = await bootDriver(t, { home: 'hima' });
  if (!d) return;
  try {
    const host = await d.host();
    assert.ok(host.ok, JSON.stringify(host));
    const cookie = await d.cookie();
    const index = await (await api(host, cookie, '/')).text();
    const boot = /globalThis\["__DSH_BOOT__"\] = ([\s\S]*?)<\/script>/.exec(index);
    assert.ok(boot, 'the index carries the client-module boot graph');
    const graph = JSON.parse(boot[1]!) as { entries: { id: string; url: string }[] };
    const hima = graph.entries.find((e) => e.id === '@hima/harness');
    assert.ok(hima, `the Hima module is in the boot graph; it holds ${graph.entries.map((e) => e.id).join(', ')}`);
    const source = await (await api(host, cookie, hima.url)).text();

    // The bundle is the second mount of the card, so what a driver reads and clicks on the page is in
    // it too. Only distinctive spellings are asked for, the way `view-run.test.ts` asks: a React
    // bundle is full of ordinary English, so `source.includes('cancel')` would be satisfied by a word
    // this card never rendered, and an assertion that cannot fail reads as coverage without being it.
    // The control markers are the marker attribute plus the two sentences the shared label table
    // spells them with, which is where both mounts take them from.
    assert.ok(source.includes('data-hima-control'), 'the module marks the controls a driver clicks');
    for (const said of ['cancel this run', 'resume this run']) {
      assert.ok(source.includes(said), `and calls one of them "${said}", as the page does`);
    }
    for (const region of ['run-cancel', 'run-blocker-tail', 'run-error']) {
      assert.ok(source.includes(region), `and carries the ${region} region the page carries`);
    }
    for (const observed of ['the kill was observed', 'the kill was not taken', 'could not be asked']) {
      assert.ok(source.includes(observed), `and says the observed stop the same way: "${observed}"`);
    }

    // What the page does not put in the browser: its own server-side scripts. `remote.ts` imports the
    // workbench page for the run view it renders, and the client imports `remote.ts` for the wire
    // contract, so a page script built with a call at module scope rides into this bundle and is
    // shipped to every browser for nothing.
    assert.ok(!source.includes('data-hima-region="start"'), 'the page\'s own start-form script stays on the host');

    // Run the served bundle the way the shell runs it: what it claims is what it claimed before.
    const loaded: { id: string; factory: (req: (spec: string) => unknown) => Record<string, unknown> }[] = [];
    new Function('window', source)({ __ModuleLoader__: { load: (r: unknown) => loaded.push(r as never) } });
    const baseline = createRequire(path.join(harnessPackageDir, 'package.json'));
    const moduleExports = loaded[0]!.factory((spec) => baseline(spec)) as {
      apply(ctx: {
        effect(callback: () => (() => void)): unknown;
        sidebarRight: { openTab(kind: string): void };
        sidebarRightTabs: { register(definition: unknown): () => void };
        layout: { toggleSidebar(): void };
        slots: { inject(name: string, callback: () => unknown): unknown; register(declaration: { name: string; key?: string; id?: string }, component: unknown): unknown };
      }): void;
    };
    const registered: { name: string; key?: string; id?: string }[] = [];
    moduleExports.apply({
      effect: (callback) => callback(),
      sidebarRight: { openTab: () => undefined },
      sidebarRightTabs: { register: () => () => undefined },
      layout: { toggleSidebar: () => undefined },
      slots: {
        inject: (_name, cb) => cb(),
        register: (declaration) => { registered.push({ name: declaration.name, ...('key' in declaration ? { key: declaration.key } : {}), ...('id' in declaration ? { id: declaration.id } : {}) }); return () => undefined; },
      },
    });
    assert.deepEqual(registered.filter((r) => r.name === 'tool.call.toolview').map((r) => r.key).sort(), ['hima_author', 'hima_context', 'hima_execute', 'hima_observe', 'hima_run'], 'and claims no key it did not claim before');
    assert.deepEqual(d.unexpectedStdout(), []);
  } finally {
    await d.dispose();
  }
});

