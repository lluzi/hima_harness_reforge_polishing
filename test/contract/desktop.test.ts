// Ticket #16's window, tested the way #23 says every window test is: through the shell's own driver
// mode. HimaGuide's only delivery form is a native window around the hima profile (D39, ADR-0003),
// and the driver is that same main process answering questions about what it did (D42, ADR-0004),
// so what has to be true is that the window really opens, really shows the product's own page, and
// really refuses what the fence refuses — not that some code path was reached.
//
// The home it starts from is **empty**, which is the point: a fresh machine has a `$DSH_HOME` with no
// hima profile in it, and until the shell learned to make one, `pnpm run desktop` there opened a
// window containing dsh's own "profile \"hima\" does not exist". Starting from nothing is what holds
// that shut — the page this test reads can only exist if the shell prepared the profile first. It
// is also started with `--site local`, so the seeding `pnpm run desktop --site local` does on a
// fresh checkout is what this test proves: the pack installed, the stand-in flow generated, the
// local site bound to it, and the workbench page listing no Runs yet.
//
// No Playwright and no renderer test: reads and refusals come from the shell's own main process, and
// a second way of driving the window would be a second thing to keep true.
//
// The test skips, with the reason, on a machine where Electron cannot open a window at all — a
// headless login, a launchd session with no window server, a Linux box with no display, or an
// install that never fetched the Electron binary. It is never silently passed over.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { bootDriver } from './support/driver.ts';

test('pnpm run desktop --site local on a machine that has never run it: the shell makes the hima home, seeds the local site, boots its own host, answers the driver, refuses the fence, and stops the host', async (t) => {
  const d = await bootDriver(t, { home: 'empty', seed: 'local' });
  if (!d) return;
  let port: string | undefined;
  try {
    // It said what it did, on stderr, and what it did was make the profile this empty home did not
    // have: in driver mode stdout carries answers and nothing else.
    const said = d.stderr();
    assert.match(said, /^hima-desktop: copied the hima profile template into /m, `the shell prepared the home: ${said}`);
    assert.match(said, /^hima-desktop: linked @hima\/harness → /m, `and linked this checkout's build into it: ${said}`);
    assert.equal(existsSync(path.join(d.home.profileDir, 'cordis.patch.yml')), true, 'the privacy overlay came with it');

    // `--site local` seeded the home before the host booted, and said what the stand-in will report.
    assert.match(said, /^hima-desktop: local site: installed the shipped pack opene902-timing-probe into /m, said);
    // The stand-in computes each generation's report from the period it was asked for (#25), so the
    // line says the period this flow closes at rather than which file it copies — a person reading a
    // generation's numbers should know they are the stand-in's arithmetic and not Design Compiler's.
    assert.match(
      said,
      /^hima-desktop: local site: the stand-in computes its own qor report per generation, closing at 2\.20 ns$/m,
      said,
    );
    assert.match(said, /^hima-desktop: local site: generated the stand-in flow at /m, said);
    assert.match(said, /^hima-desktop: local site: wrote .*local\.yml binding flowRoot to the stand-in/m, said);
    const flowRoot = path.join(d.home.home, 'hima/local/standin-flow');
    assert.equal(existsSync(path.join(flowRoot, 'Makefile')), true, 'the stand-in flow is in the home');
    assert.equal(existsSync(path.join(d.home.home, 'hima/packs/opene902-timing-probe/contract.yml')), true, 'and so is the pack');
    const siteFile = await readFile(path.join(d.home.home, 'hima/sites/local.yml'), 'utf8');
    assert.match(siteFile, new RegExp(`^  flowRoot: ${flowRoot}$`, 'm'), `the site binds its flow root to the stand-in: ${siteFile}`);
    assert.match(siteFile, /^  workspaceRoot: .*\/hima\/local\/workspace$/m, `and its workspace root to the home: ${siteFile}`);
    assert.equal(existsSync(path.join(d.home.home, 'hima/sites/local.permit.yml')), true, 'with the permit beside it');

    // The host is the window's, on loopback, and the session the shell established is a dsh cookie.
    const host = await d.host();
    assert.ok(host.ok, `host: ${JSON.stringify(host)}`);
    assert.match(host.url, /^http:\/\/127\.0\.0\.1:\d+\/\?token=/, host.url);
    assert.equal(host.origin, new URL(host.url).origin);
    assert.match(host.session.cookieName, /^dsh-auth-/, 'the session is the web app\'s own cookie');
    assert.ok(host.session.cookieValue.length > 0);
    port = new URL(host.url).port;

    // The workbench page is the product's, behind the same session, in a window that is ours.
    const opened = await d.open('/hima/');
    assert.ok(opened.ok, `open /hima/: ${JSON.stringify(opened)}`);
    assert.equal(opened.status, 200, `the workbench page answered ${String(opened.status)}`);
    assert.equal(opened.url, `${host.origin}/hima/`);
    assert.equal(opened.title, 'HimaHarness', 'the window keeps its own title over the page');
    const runs = await d.read('runs');
    assert.ok(runs.ok, `read runs: ${JSON.stringify(runs)}`);
    assert.equal(runs.state.count, '0', `a fresh home lists no Runs: ${JSON.stringify(runs)}`);
    assert.match(runs.text, /no runs/i, runs.text);

    // The fence stands in driver mode: anything outside the host's origin is refused in its words.
    for (const outside of ['http://example.com/', 'file:///etc/hosts', `http://127.0.0.1:${String(Number(port) + 1)}/hima/`]) {
      const refused = await d.open(outside);
      assert.equal(refused.ok, false, `${outside} was opened: ${JSON.stringify(refused)}`);
      assert.match(refused.error, /outside this window's fence/, refused.error);
      assert.ok(refused.error.includes(host.origin), `the refusal names the one origin it permits: ${refused.error}`);
    }
    // A path the host does not serve is opened and its status reported, not refused: the fence is
    // about origins, and what the host answers is the host's own business.
    const missing = await d.open('/no-such-page');
    assert.ok(missing.ok, JSON.stringify(missing));
    assert.equal(missing.status, 404);

    // Refusals are loud: an unknown control, an unknown op, a line that is not a request.
    const control = await d.click('no-such-control');
    assert.equal(control.ok, false);
    assert.match(control.error, /no element marked data-hima-control="no-such-control"/, control.error);
    const region = await d.read('no-such-region');
    assert.equal(region.ok, false);
    assert.match(region.error, /no element marked data-hima-region="no-such-region"/, region.error);
    const unknown = await d.request({ id: 'op-x', op: 'levitate' });
    assert.deepEqual([unknown.id, unknown.ok], ['op-x', false]);
    assert.match(unknown.error ?? '', /unknown op "levitate"/, JSON.stringify(unknown));
    const noOp = await d.raw(JSON.stringify({ id: 9 }));
    assert.deepEqual([noOp.id, noOp.ok], [null, false], JSON.stringify(noOp));
    const notJson = await d.raw('this is not a request');
    assert.deepEqual([notJson.id, notJson.ok], [null, false], JSON.stringify(notJson));
    assert.match(notJson.error ?? '', /not JSON/, JSON.stringify(notJson));

    // quit answers first, then stops the host and ends: nothing is left listening on that port.
    const bye = await d.quit();
    assert.ok(bye.ok, JSON.stringify(bye));
    assert.equal(await d.exit(), 0, `the shell exited non-zero\n${d.stderr()}`);
    const after = await fetch(`http://127.0.0.1:${port}/`, { redirect: 'manual', signal: AbortSignal.timeout(3_000) }).catch((e: Error) => e);
    assert.ok(after instanceof Error, `the host the window started is stopped when the window ends; ${port} still answers`);
    assert.deepEqual(d.unexpectedStdout(), [], 'in driver mode stdout carries answers and nothing else');
    for (const line of d.stderr().split('\n').filter((l) => l.startsWith('hima-desktop:'))) t.diagnostic(line);
  } finally {
    await d.dispose();
  }
});
