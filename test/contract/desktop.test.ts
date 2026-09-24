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

test('closing and reopening the window preserves the same Host; explicit Quit still stops it', async t => {
  const d = await bootDriver(t, { home: 'hima' });
  if (!d) return;
  try {
    const before = await d.host(); assert.ok(before.ok);
    const hidden = await d.request({ op: 'window-close' });
    assert.equal(hidden.ok, true, JSON.stringify(hidden));
    assert.equal(hidden.visible, false);
    const during = await d.host(); assert.ok(during.ok);
    assert.equal(during.origin, before.origin);
    const reopened = await d.request({ op: 'window-reopen' });
    assert.equal(reopened.ok, true, JSON.stringify(reopened));
    assert.equal(reopened.visible, true);
    const after = await d.host(); assert.ok(after.ok);
    assert.equal(after.origin, before.origin);
    assert.ok((await d.quit()).ok);
    assert.equal(await d.exit(), 0);
    await assert.rejects(fetch(before.origin));
  } finally { await d.dispose(); }
});

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
      /^hima-desktop: local site: the stand-in computes its own qor report per generation, closing at 2\.20 ns; these are simulated values, not measured EDA results$/m,
      said,
    );
    assert.match(said, /^hima-desktop: local site: generated the stand-in flow at /m, said);
    assert.match(said, /^hima-desktop: local site: wrote .*local\.yml binding flowRoot to the stand-in/m, said);
    const flowRoot = path.join(d.home.home, 'hima/local/standin-flow');
    assert.equal(existsSync(path.join(flowRoot, 'Makefile')), true, 'the stand-in flow is in the home');
    assert.equal(existsSync(path.join(d.home.home, 'hima/packs/opene902-timing-probe/contract.yml')), true, 'and so is the pack');
    // And the converging variant beside it (#57), carrying its own push rule in its own folder: the
    // reference pack reaches no ending of its own on this flow (D45), so the pack a developer picks
    // to *watch* a Loop converge has to be there before the window opens.
    assert.match(said, /^hima-desktop: local site: installed the converging variant over-constraining-probe into .* which carries over-constraining-push in its own choosers\/$/m, said);
    assert.match(said, /^hima-desktop: local site: pick over-constraining-probe on the start form to watch a campaign converge;/m, said);
    const variant = path.join(d.home.home, 'hima/packs/over-constraining-probe');
    assert.equal(existsSync(path.join(variant, 'choosers/over-constraining-push.yml')), true, 'the chooser is the variant\'s own file, not the bundle\'s');
    const variantGraph = await readFile(path.join(variant, 'graph.yml'), 'utf8');
    assert.match(variantGraph, /^ {6}chooser: over-constraining-push$/m, `and its explore node names it: ${variantGraph}`);
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

for (const mode of ['keep-jobs','stop-jobs'] as const) test(`explicit Desktop Quit ${mode} preserves the recorded Campaign and reports original Job disposition`,async t=>{
  const {localHome,sessionsOf,killSessions}=await import('./support/fabric.ts');
  const {bootInProcess,createRootAgent}=await import('./support/boot-inprocess.ts');
  const {timingProbePackId}=await import('./support/pack.ts');
  const {spawnSync}=await import('node:child_process');
  const home=await localHome(t,{sleepSeconds:60});assert.ok(home);
  const previous=process.env.HIMA_TEST_LEGACY_AUTO_DRIVE;process.env.HIMA_TEST_LEGACY_AUTO_DRIVE='0';
  const silent=process.env.HIMA_TEST_SILENT_AGENT;process.env.HIMA_TEST_SILENT_AGENT='1';
  let setup=await bootInProcess(home.h);let sessions:string[]=[];
  try {
    const owner=await createRootAgent(setup.ctx,home.h.workspace);const actor=String(owner.id);
    const started=await setup.ctx.hima.startRun({pack:timingProbePackId,site:'local',goal:{target_period_ns:2},ownerSessionId:actor});assert.equal(started.kind,'ran');if(started.kind!=='ran')return;
    const runId=started.run.id;
    const action=async(kind:'begin'|'work',executionId?:string)=>{const c=setup.ctx.hima.executionContext(runId).run.control!;return setup.ctx.hima.executionAction({runId,actor,action:kind,nodeId:started.run.currentNode,executionId,requestId:`quit-${kind}`,expectedEpoch:c.epoch,expectedRevision:c.revision});};
    const begun=await action('begin');assert.equal(begun.kind,'accepted');assert.equal((await action('work',begun.receipt!.executionId)).kind,'accepted');
    sessions=[...sessionsOf(setup,runId)];assert.equal(sessions.length,1);
    await setup.dispose();
    const d=await bootDriver(t,{existing:home.h,env:{HIMA_TEST_LEGACY_AUTO_DRIVE:'0',HIMA_TEST_SILENT_AGENT:'1'}});if(!d)return;
    try {assert.ok((await d.quit(mode)).ok);assert.equal(await d.exit(),0,d.stderr());}finally{await d.dispose();}
    const alive=spawnSync('tmux',['has-session','-t',`=${sessions[0]}`]).status===0;
    assert.equal(alive,mode==='keep-jobs');
    const persisted=JSON.parse(await readFile(path.join(home.h.home,'storages/hima_ledger.json'),'utf8'));
    const row=persisted.tables.runs[runId];assert.notEqual(row.status,'cancelled');
    assert.ok(Object.values(row.control.requests).some((r:any)=>r.receipt.action==='host-exit'&&r.receipt.data.mode===mode));
  }finally{killSessions(sessions);await setup.dispose();await home.h.dispose();if(previous===undefined)delete process.env.HIMA_TEST_LEGACY_AUTO_DRIVE;else process.env.HIMA_TEST_LEGACY_AUTO_DRIVE=previous;if(silent===undefined)delete process.env.HIMA_TEST_SILENT_AGENT;else process.env.HIMA_TEST_SILENT_AGENT=silent;}
});
