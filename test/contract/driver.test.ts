// Ticket #23: the step-3 seam. Every step-3 test drives the product through the desktop shell in
// driver mode (D42, ADR-0004), and this is the first: a Run on the local Site, started with the
// session the shell established, then read off the workbench page the window renders — region by
// region, as a person sees it — and read again over the route, with the two held against each other.
//
// One test, one Run. The Run is started over `POST /hima/api/runs` because the page has no start
// control yet (#26 adds it); what is under test here is that the card the window shows says what the
// ledger says, that a `wait` is satisfied by the page refreshing itself while a Run runs and not
// only by what the document already said when it was opened, that the driver's reads and
// screenshots are exact, and that a wait that cannot be satisfied says what it last saw rather than
// timing out silently.
//
// The second test is the audit routes (#31): HimaChannel's audit is per process, and the process
// that drives a Campaign is the host inside this shell — so `GET /hima/api/audit` and
// `POST /hima/api/audit/drain` are how anything outside it can say what the harness asked the Site
// to run. Asserted at this seam and not at a booted host's, because that is where a Campaign is
// driven from and where the acceptance script drains it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { bootDriver } from './support/driver.ts';
import { api } from './support/hima-api.ts';
import { timingProbePackId } from './support/pack.ts';
import type { AuditView, HimaErrorBody, RunView } from '@hima/harness';

/** The eight bytes every PNG file starts with. */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test('through the shell in driver mode: a Run started with the shell\'s session, its card read region by region off the workbench page, and the same Run read over the route agree', async (t) => {
  const d = await bootDriver(t, { home: 'hima' });
  if (!d) return;
  try {
    const host = await d.host();
    assert.ok(host.ok, JSON.stringify(host));
    const cookie = await d.cookie();

    // The list page first, while the HimaLedger holds nothing, so the wait below is proven across a
    // change rather than at first look: this document is rendered before the Run exists.
    const empty = await d.open('/hima/');
    assert.ok(empty.ok, JSON.stringify(empty));
    const before = await d.read('runs');
    assert.ok(before.ok, JSON.stringify(before));
    assert.equal(before.state.count, '0', `nothing in the HimaLedger yet: ${JSON.stringify(before)}`);

    // A click is acknowledged with what the page took it *on* (#43). The window sometimes drops the
    // first mouse events sent to it, which is why the op waits for the page to have counted one at
    // all; what the count cannot say by itself is whether the one it counted landed where the driver
    // aimed it, and a click that landed elsewhere used to surface minutes later as a region that
    // never came. Asked here of a field on the start form, because a click on a field does nothing
    // but focus it: the subject is the acknowledgement and not what the control does.
    const onAField = await d.click('start-time-box');
    assert.ok(onAField.ok, JSON.stringify(onAField));
    assert.equal(onAField.note, 'the click landed on "start-time-box"', `the acknowledgement names the control the page took the click on: ${JSON.stringify(onAField)}`);

    // One generation on the stand-in, started the way the workbench starts one. The route answers
    // only when the Run stops, so the request is left in flight and the page is watched while the
    // Run runs: what the wait has to catch is the document refreshing itself under it.
    const starting = api(host, cookie, '/hima/api/runs', {
      method: 'POST',
      // One generation: this test is about the card the window shows and the route beside it, not
      // about the Loop (that is `loop.test.ts`), so the Campaign is allowed the one it is about.
      body: JSON.stringify({ pack: timingProbePackId, site: 'local', goal: { target_period_ns: 2.0 }, strategy: { periodNs: 2.0 }, generations: 1 }),
      headers: { 'content-type': 'application/json' },
    });
    // Awaited below; this only keeps a failure in flight from being an unhandled rejection.
    starting.catch(() => undefined);

    const listed = await d.wait('runs', timingProbePackId);
    assert.ok(listed.ok, `wait runs: ${JSON.stringify(listed)}`);
    assert.equal(listed.state.count, '1', `the page the window still holds lists the new Run: ${JSON.stringify(listed)}`);
    assert.notEqual(listed.text, before.text, 'the region changed under the wait, which is the only way this wait could be satisfied');

    const started = await starting;
    const startedText = await started.text();
    assert.equal(started.status, 200, startedText);
    const view = JSON.parse(startedText) as RunView;
    assert.equal(view.run.status, 'ended-budget-exhausted', 'the one generation it was allowed ran to its end');
    const runId = view.run.id;

    // The page, and the card on it, read the way a person reads it.
    const opened = await d.open(`/hima/?run=${encodeURIComponent(runId)}`);
    assert.ok(opened.ok, JSON.stringify(opened));
    assert.equal(opened.status, 200);

    const status = await d.wait('run-status', 'ended');
    assert.ok(status.ok, `wait run-status: ${JSON.stringify(status)}`);
    assert.equal(status.state.status, view.run.status, `the banner's state is the ledger's status: ${JSON.stringify(status)}`);
    assert.ok(status.text.includes('ended — budget exhausted'), `the banner says it in the card's words: ${status.text}`);
    assert.ok(status.text.includes(timingProbePackId), `and names the pack: ${status.text}`);
    // The goal in the words the shipped pack declares for it (#42), never its parameter's own name.
    assert.ok(status.text.includes('goal: clock period at most 2 ns'), `and the goal: ${status.text}`);

    const nodes = await d.read('run-nodes');
    assert.ok(nodes.ok, JSON.stringify(nodes));
    assert.deepEqual(
      nodes.state,
      Object.fromEntries(view.nodes.map((n) => [n.nodeId, n.state])),
      `one state attribute per node the Run touched, as the route reports them: ${JSON.stringify(nodes)}`,
    );
    assert.deepEqual(Object.values(nodes.state), ['done', 'done', 'done', 'done'], 'every node settled');
    for (const node of view.nodes) assert.ok(nodes.text.includes(node.nodeId), `the path names ${node.nodeId}: ${nodes.text}`);
    assert.ok(nodes.text.includes(view.nodes[0]!.jobSession!), `and the session the act node waited on: ${nodes.text}`);

    const decision = await d.read('run-decision');
    assert.ok(decision.ok, JSON.stringify(decision));
    assert.ok(view.decision && 'strategy' in view.decision.chosen, `this generation missed its goal, so the chooser chose a next strategy: ${JSON.stringify(view.decision)}`);
    const chosenPeriod = view.decision.chosen.strategy.periodNs;
    assert.equal(decision.state.chosen, 'next-strategy', JSON.stringify(decision));
    // The whole Strategy the decision chose, by the pack's own knob names, as the card's state
    // carries it (#58): JSON, because an attribute name is case-folded and a knob's name is not.
    assert.deepEqual(JSON.parse(decision.state.strategy!), view.decision.chosen.strategy, `the card's strategy is the decision's: ${JSON.stringify(decision)}`);
    assert.ok(decision.text.includes(`next strategy: clock period ${String(chosenPeriod)} ns`), decision.text);
    assert.ok(decision.text.includes(view.decision.chooser), `and it says which chooser: ${decision.text}`);

    const observation = await d.read('run-observation');
    assert.ok(observation.ok, JSON.stringify(observation));
    assert.equal(observation.state.count, '1', 'one observation: the generation\'s qor report');
    assert.ok(observation.text.includes('clock_period'), observation.text);
    // And which of the report's path groups the period was read out of, in the words the chat's card
    // uses: a period from the design's clock group and one from a synthesis tool's built-in group are
    // not the same reading, so both mounts of the card say the group beside the value.
    const clockGroup = view.observations[0]!.values.find((v) => v.type === 'clock_period')!.group;
    assert.equal(clockGroup, 'core_clk', `the stand-in writes its report under the clock group the real opene902 report names: ${JSON.stringify(view.observations[0]!.values)}`);
    assert.ok(observation.text.includes(`· in ${clockGroup}`), `the page names the group the value came from: ${observation.text}`);

    // The same Run over the route, with the same session, says the same thing.
    const again = await api(host, cookie, `/hima/api/runs/${encodeURIComponent(runId)}`);
    assert.equal(again.status, 200);
    const routeView = JSON.parse(await again.text()) as RunView;
    assert.equal(routeView.run.status, status.state.status, 'the route and the card agree on the status');
    assert.ok(routeView.decision && 'strategy' in routeView.decision.chosen);
    assert.deepEqual(routeView.decision.chosen.strategy, JSON.parse(decision.state.strategy!), 'and on the chosen strategy');
    assert.deepEqual(routeView, view, 'and the ended Run reads back exactly as it was answered');

    // A wait that cannot be satisfied is loud: it names what it last saw, or that nothing was there.
    const never = await d.wait('run-status', 'a status no run has', 500);
    assert.equal(never.ok, false, JSON.stringify(never));
    assert.match(never.error, /waited 500 ms .* it last showed "ended — budget exhausted/, never.error);

    // The screenshot is a real PNG of a window that painted something.
    const shot = await d.screenshot(path.join(d.home.home, 'workbench.png'));
    assert.ok(shot.ok, JSON.stringify(shot));
    const png = await readFile(shot.path);
    assert.ok(png.subarray(0, 8).equals(PNG_SIGNATURE), 'the file starts with the PNG signature');
    assert.equal(png.byteLength, shot.bytes);
    assert.ok(shot.width >= 480 && shot.height >= 360, `the image is the window's: ${String(shot.width)}×${String(shot.height)}`);
    assert.ok(png.byteLength > 16_384, `a page with a card on it is not a blank image: ${String(png.byteLength)} bytes`);

    // Back on the list, the Run is there, and a region this page does not have is said to be absent.
    const list = await d.open('/hima/');
    assert.ok(list.ok, JSON.stringify(list));
    const runs = await d.read('runs');
    assert.ok(runs.ok, JSON.stringify(runs));
    assert.equal(runs.state.count, '1');
    assert.ok(runs.text.includes(runId), runs.text);
    assert.ok(runs.text.includes('ended — budget exhausted'), `the list says where each Run stands: ${runs.text}`);
    const absent = await d.wait('run-status', 'ended', 300);
    assert.equal(absent.ok, false);
    assert.match(absent.error, /the region was absent/, absent.error);
    assert.deepEqual(d.unexpectedStdout(), []);
  } finally {
    await d.dispose();
  }
});

test('the audit routes say what the host asked the Site to run: the campaign\'s own command lines, a drain that empties what it read, and the fence over both', async (t) => {
  const d = await bootDriver(t, { home: 'hima' });
  if (!d) return;
  try {
    const host = await d.host();
    assert.ok(host.ok, JSON.stringify(host));
    const cookie = await d.cookie();

    /** The audit as the two routes answer it, with the session the shell established. */
    const audit = async (drain: boolean): Promise<AuditView> => {
      const res = await api(host, cookie, drain ? '/hima/api/audit/drain' : '/hima/api/audit', drain ? { method: 'POST' } : {});
      const text = await res.text();
      assert.equal(res.status, 200, text);
      return JSON.parse(text) as AuditView;
    };

    // Whatever came up with the shell is taken off first, so what is read below is the Campaign's
    // own: this home holds no Run, so a host booting on it reconciles nothing and asks the Site
    // nothing — which is a claim, and this is where it is checked.
    const beforeAnything = await audit(true);
    assert.deepEqual(beforeAnything.commands, [], 'a host booted on a home with no Run asks the Site nothing at all');

    // One generation on the stand-in, driven by the host inside this shell — the process whose audit
    // the routes answer with.
    const started = await api(host, cookie, '/hima/api/runs', {
      method: 'POST',
      body: JSON.stringify({ pack: timingProbePackId, site: 'local', goal: { target_period_ns: 2.0 }, strategy: { periodNs: 2.0 }, generations: 1 }),
      headers: { 'content-type': 'application/json' },
    });
    const startedText = await started.text();
    assert.equal(started.status, 200, startedText);
    const view = JSON.parse(startedText) as RunView;
    assert.equal(view.run.status, 'ended-budget-exhausted', 'the one generation it was allowed ran to its end');

    // The read does not empty what it reads: two of them in a row hold the same commands.
    const read = await audit(false);
    assert.deepEqual(await audit(false), read, 'a read leaves the audit where it found it');
    assert.equal(read.windowFilled, false, `one generation does not fill the window: ${String(read.commands.length)} commands`);

    // The workspace preparation, the launch, and the report — the three things a Campaign asks a
    // Site to do, each read off the wire the Site received rather than off the argv it was decided
    // on: an assertion on argv alone would still pass if the quoting step were deleted.
    assert.ok(read.commands.some((c) => c.argv[0] === 'mkdir'), `the workspace preparation is in the audit: ${JSON.stringify(read.commands.map((c) => c.argv[0]))}`);
    const launch = read.commands.find((c) => c.argv[0] === 'tmux' && c.argv[1] === 'new-session');
    assert.ok(launch, 'the Job\'s launch line is in the audit');
    const launched = view.jobs.find((j) => j.event === 'launched')!;
    assert.ok(launch.wire.includes(launched.job.session), `the launch names the session the ledger recorded, as the Site received it: ${launch.wire}`);
    assert.equal(launch.argv[launch.argv.indexOf('-c') + 1], launched.job.workspace, `and runs in the Campaign workspace: ${JSON.stringify(launch.argv)}`);
    assert.ok(launch.wire.includes(`${launched.job.workspace}/flow`), `on the Campaign's own copy of the flow, and not the Site's: ${launch.wire}`);
    const experience = view.experience;
    assert.ok(experience, 'the ended Campaign wrote its technical report');
    const written = read.commands.filter((c) => c.argv[0] === 'tee').map((c) => c.argv[c.argv.length - 1]);
    assert.deepEqual(
      written.filter((p) => p === experience.markdown.path || p === experience.json.path).sort(),
      [experience.json.path, experience.markdown.path].sort(),
      `both files of the report were written by a \`tee\` in this audit: ${JSON.stringify(written)}`,
    );

    // The drain answers what the read did, and takes it: the next drain has nothing left to give.
    const drained = await audit(true);
    assert.deepEqual(drained, read, 'the drain answered exactly what the read before it did');
    const emptied = await audit(true);
    assert.deepEqual(emptied, { commands: [], windowFilled: false }, 'and it took what it answered with');

    // Both routes are behind the web app's own session cookie, like every other route here.
    for (const [target, init] of [['/hima/api/audit', {}], ['/hima/api/audit/drain', { method: 'POST' }]] as const) {
      const res = await fetch(new URL(target, host.url), init);
      const text = await res.text();
      assert.equal(res.status, 401, text);
      assert.equal((JSON.parse(text) as HimaErrorBody).error.code, 'hima/not-authorized', `${target} is refused without the session cookie`);
    }

    // Each route answers its own method, and says which: a read that emptied what it read would take
    // the evidence from whoever was only looking, so the two verbs are not interchangeable.
    const wrongWay = await api(host, cookie, '/hima/api/audit', { method: 'POST' });
    assert.equal(wrongWay.status, 405, await wrongWay.text());
    const otherWay = await api(host, cookie, '/hima/api/audit/drain');
    assert.equal(otherWay.status, 405, await otherWay.text());

    assert.deepEqual(d.unexpectedStdout(), []);
  } finally {
    await d.dispose();
  }
});
