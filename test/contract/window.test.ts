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
import { readFile, rename, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { bootDriver, fillForm as fillTheForm, theOneRunId, type BootedDriver } from './support/driver.ts';
import { api } from './support/hima-api.ts';
import { harnessPackageDir } from './support/dsh-home.ts';
import { installOverConstraining, packsDirOf, timingProbePackId } from './support/pack.ts';
import { tmuxHasSession, killSession } from './support/tmux.ts';
import { badRunArgument, badStrategyValue, type RunView } from '@hima/harness';

/** What the form is filled with everywhere but the field a test is varying. The strategy field is
 *  the shipped pack's own knob, under the name its contract declares (#58). */
const FORM = {
  'start-pack': timingProbePackId,
  'start-site': 'local',
  'start-target': '2.0',
  'start-knob-periodNs': '2.0',
  'start-time-box': '5',
  'start-retries': '2',
} as const;

/** This file's own form, filled by the shared `fillForm`, which waits on the pack selection the way
 *  the page needs it waited on (`support/driver.ts`). The pack is first for that reason. */
const fillForm = (d: BootedDriver, changes: Readonly<Record<string, string>> = {}): Promise<void> => fillTheForm(d, FORM, changes);

/**
 * That Run over the route, with every tmux session it has launched a Job in pushed into `into`.
 *
 * Called *before* the step that can fail, never after it: a test ends the tmux sessions it started,
 * and an assertion that does not hold — a `wait` timing out while the stand-in is still sleeping —
 * must not be what decides whether one is left on this machine. `waitMs` is how long to wait for the
 * first Job, because a Run is `running` from the moment HimaFabric starts driving it and its Job is
 * launched a moment after that; zero for a Run already known to hold one.
 */
async function collectSessions(d: BootedDriver, runId: string, into: string[], waitMs = 0): Promise<RunView> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const view = await runOverTheRoute(d, runId);
    for (const job of view.jobs) if (job.event === 'launched' && !into.includes(job.job.session)) into.push(job.job.session);
    if (into.length > 0 || Date.now() >= deadline) return view;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

/**
 * That Run's card as HTML, exactly as the host served it.
 *
 * For the handful of properties a driver cannot see: the page marks up a sentence — an identifier in
 * one face, a number in another — and `innerText` hands back the same words whichever way the markup
 * fell. What a person's eye would catch there is in the HTML and nowhere else.
 */
async function pageOverTheRoute(d: BootedDriver, runId: string): Promise<string> {
  const host = await d.host();
  assert.ok(host.ok, JSON.stringify(host));
  const answered = await api(host, await d.cookie(), `/hima/?run=${encodeURIComponent(runId)}`);
  const html = await answered.text();
  assert.equal(answered.status, 200, html);
  return html;
}

/**
 * What the window had to say for itself when a Campaign started from the form never reached its
 * card: what the start route answered, as the form put it on the page, whether a Run was opened at
 * all, and the last few lines the shell said of itself.
 *
 * Here because the absence of a region is the least informative thing a driver can report — the
 * card was never opened and the empty card look exactly alike — and this failure has been read four
 * times off a suite that said only that it had waited (#43). The driver's own refusal names the
 * page the window was on; this names what the page had on it. Called only after a wait has already
 * failed, never in `finally`, and never where it could decide whether a test passes.
 */
async function whatTheWindowSaw(d: BootedDriver): Promise<string> {
  const said = await d.read('start-error');
  const runs = await d.read('runs');
  const shell = d.stderr().trimEnd().split('\n').filter((line) => line.startsWith('hima-desktop:')).slice(-5);
  return `the start route's answer, where the form shows it: ${!said.ok ? `unreadable — ${said.error}`
    : said.text === '' ? 'nothing at all, so the route either has not answered yet or was never asked'
    : JSON.stringify(said.text)}`
    + `\nthe run list: ${runs.ok ? `${runs.state.count} runs` : `unreadable — ${runs.error}`}`
    + `\nthe shell last said:\n${shell.join('\n')}`;
}

/** That Run over the route, with the session the shell established. */
async function runOverTheRoute(d: BootedDriver, runId: string): Promise<RunView> {
  const host = await d.host();
  assert.ok(host.ok, JSON.stringify(host));
  const answered = await api(host, await d.cookie(), `/hima/api/runs/${encodeURIComponent(runId)}`);
  const text = await answered.text();
  assert.equal(answered.status, 200, text);
  return JSON.parse(text) as RunView;
}

test('filling the start form and clicking start creates a Run whose Goal and Budget are the form\'s, and the window opens its card', async (t) => {
  const d = await bootDriver(t, { home: 'hima' });
  if (!d) return;
  try {
    // The pack varied onto `over-constraining-push` (#54), installed before the page is opened so the
    // start form offers it: the stand-in reports no margin for a period it meets, as Design Compiler
    // does, and the reference pack's own chooser reaches no ending of its own on that (D45). What
    // this test is about is the window, so the Campaign it watches has to reach one.
    const honest = await installOverConstraining(packsDirOf(d.home), 'over-constraining-probe');
    const opened = await d.open('/hima/');
    assert.ok(opened.ok, JSON.stringify(opened));

    // The form offers what this home has installed, counted so a driver can see it is not empty.
    const form = await d.read('start');
    assert.ok(form.ok, `the workbench page carries the start form: ${JSON.stringify(form)}`);
    assert.equal(form.state.packs, '2', `both packs installed here are on offer: ${JSON.stringify(form)}`);
    assert.equal(form.state.sites, '1', `and one site: ${JSON.stringify(form)}`);

    // Three generations is what this exploration takes to converge, so the field's own number is
    // what bounds this Campaign rather than the pack's six (#27) — and the Run still reaches its own
    // ending inside it, which is what says the field bounded and did not truncate.
    await fillForm(d, { 'start-pack': honest, 'start-generations': '3' });
    const clicked = await d.click('start');
    assert.ok(clicked.ok, JSON.stringify(clicked));

    // The page opened the Run's own card — the list page has no such region at all — and the Run ran
    // to its end on the stand-in while the card was open. Its end is the Loop's (#25): this Campaign
    // revisits the synthesis node until the periods stop moving, which at a 2.0 ns goal a flow that
    // closes at 2.20 ns does before the goal is met, at the third generation. That is a whole Loop
    // and not one generation, so the wait is the one the rest of this file uses.
    const status = await d.wait('run-status', 'ended', 120_000);
    if (!status.ok) assert.fail(`wait run-status: ${status.error}\n${await whatTheWindowSaw(d)}`);
    assert.equal(status.state.status, 'ended-converged', `the exploration stopped moving short of a 2.0 ns goal: ${JSON.stringify(status)}`);

    const runId = await theOneRunId(d);
    const view = await runOverTheRoute(d, runId);
    assert.equal(view.run.packId, honest, 'the pack the form named');
    assert.equal(view.run.siteId, 'local', 'on the site the form named');
    assert.deepEqual(view.run.goal, { target_period_ns: 2 }, 'the Goal the form gave');
    assert.equal(view.run.budget?.timeBoxMs, 5 * 60_000, 'the time box the form gave, in minutes');
    assert.equal(view.run.budget?.retryAllowance, 2, 'and the retry allowance');
    assert.equal(view.run.budget?.generationLimit, 3, 'and the generation limit the form gave, in place of the pack\'s own six');
    // The first period the form gave, where it actually landed: on the command line the Site was
    // given. The run row's `strategy` has moved on to the period the chooser picked for the next
    // generation by the time this Run has ended, so it is not what says the form's number was used.
    const launched = view.jobs.find((j) => j.event === 'launched');
    assert.ok(launched, `the Run launched a job: ${JSON.stringify(view.jobs)}`);
    assert.match(launched.job.wire, /CLOCK_PERIOD_NS=2\b/, `synthesized at the period the form gave: ${launched.job.wire}`);
    assert.deepEqual(d.unexpectedStdout(), []);
  } finally {
    await d.dispose();
  }
});

test('a strategy knob or a time box the shared validator refuses is refused in the window, in the validator\'s own words, and no Run is started', async (t) => {
  const d = await bootDriver(t, { home: 'hima' });
  if (!d) return;
  try {
    const opened = await d.open('/hima/');
    assert.ok(opened.ok, JSON.stringify(opened));
    const before = await d.read('start-error');
    assert.ok(before.ok, `the region is there before anything was refused: ${JSON.stringify(before)}`);
    assert.equal(before.text, '', 'and says nothing');

    // Filled once with a period a Run could be started at, then again with the one under test: a
    // fill that appended rather than replacing would leave "2.00", which is a period that starts.
    // Zero is outside the bounds the shipped pack declares its knob within (#58), so what refuses it
    // is that pack's own declaration, said in the one sentence every face says it in.
    await fillForm(d);
    await fillForm(d, { 'start-knob-periodNs': '0' });
    const clicked = await d.click('start');
    assert.ok(clicked.ok, JSON.stringify(clicked));

    const said = badStrategyValue('periodNs', { type: 'number', unit: 'ns', min: 0.5, max: 10, default: 2.3 }, 0);
    const refused = await d.wait('start-error', said, 30_000);
    assert.ok(refused.ok, `wait start-error: ${JSON.stringify(refused)}`);
    assert.ok(refused.text.includes(said), `the window says what the shared validator says: ${JSON.stringify(refused)}`);

    const runs = await d.read('runs');
    assert.ok(runs.ok, JSON.stringify(runs));
    assert.equal(runs.state.count, '0', `nothing was started: ${JSON.stringify(runs)}`);
    const stillThere = await d.read('run-status');
    assert.equal(stillThere.ok, false, 'and the window is still on the list page, not on a card');

    // The other number of the form the shared table refuses, through the same field-and-click: the
    // time box. One argument proven in the window would say the form reaches the validator; two say
    // the form reaches it for the Budget's numbers as well as the Strategy's, which is what #26
    // asked for. The period goes back to one that starts, so what is refused is the box alone.
    await fillForm(d, { 'start-time-box': '0' });
    const clickedAgain = await d.click('start');
    assert.ok(clickedAgain.ok, JSON.stringify(clickedAgain));
    const box = badRunArgument('timeBox', 'timeBox', 0);
    const boxRefused = await d.wait('start-error', box, 30_000);
    assert.ok(boxRefused.ok, `wait start-error: ${JSON.stringify(boxRefused)}`);
    assert.equal(boxRefused.text, box, `the window says exactly what the shared validator says: ${JSON.stringify(boxRefused)}`);
    const afterBox = await d.read('runs');
    assert.ok(afterBox.ok, JSON.stringify(afterBox));
    assert.equal(afterBox.state.count, '0', `nothing was started by that one either: ${JSON.stringify(afterBox)}`);
    assert.deepEqual(d.unexpectedStdout(), []);
  } finally {
    await d.dispose();
  }
});

test('clicking cancel while the Job sleeps ends the Run cancelled, the card shows the observed stop, and the tmux session is gone', async (t) => {
  const d = await bootDriver(t, { home: 'hima', sleepSeconds: 30 });
  if (!d) return;
  const sessions: string[] = [];
  try {
    const opened = await d.open('/hima/');
    assert.ok(opened.ok, JSON.stringify(opened));
    await fillForm(d);
    const clicked = await d.click('start');
    assert.ok(clicked.ok, JSON.stringify(clicked));

    // The card is open while the Job is still sleeping: the start route answers as soon as the Run
    // exists, and this is what that buys a person — a Run they can watch, and stop.
    const running = await d.wait('run-status', 'running', 90_000);
    assert.ok(running.ok, `wait run-status running: ${JSON.stringify(running)}`);
    assert.equal(running.state.status, 'running', JSON.stringify(running));

    // The sleeping Job's session, before the click and the waits that can fail: whatever this test
    // asserts below, the session it started is one it ends.
    const runId = await theOneRunId(d);
    await collectSessions(d, runId, sessions, 60_000);
    assert.equal(sessions.length, 1, `the Run launched the Job it is about to be asked to stop: ${JSON.stringify(sessions)}`);
    const back = await d.open(`/hima/?run=${encodeURIComponent(runId)}`);
    assert.ok(back.ok, JSON.stringify(back));

    const cancelled = await d.click('cancel');
    assert.ok(cancelled.ok, `the card carries the cancel control while the Run is running: ${JSON.stringify(cancelled)}`);
    const ended = await d.wait('run-status', 'cancelled by a person', 90_000);
    assert.ok(ended.ok, `wait run-status cancelled: ${JSON.stringify(ended)}`);
    assert.equal(ended.state.status, 'cancelled', JSON.stringify(ended));

    // The observed stop, which is the half of a cancel a person actually needs: the Job was killed
    // and something saw it go.
    const cancel = await d.read('run-cancel');
    assert.ok(cancel.ok, `the card shows the cancel: ${JSON.stringify(cancel)}`);
    assert.equal(cancel.state.observed, 'killed', `the kill was observed: ${JSON.stringify(cancel)}`);

    // The tmux session is one identifier, and the page sets it as one. This is the half of the card
    // no `read` can see: the page sets a sentence's numbers in the mono face with inline spans, so
    // `hima-2b9eabb1-…` torn into eight alternating fragments still reads back as the same words.
    // The served HTML is where it shows, so the served HTML is where it is asserted.
    const session = sessions[0]!;
    const html = await pageOverTheRoute(d, runId);
    const said = `tmux session ${session}`;
    assert.ok(html.includes(said), `the observed stop names the session whole: ${html.slice(Math.max(0, html.indexOf('tmux session') - 60), html.indexOf('tmux session') + 240)}`);
    // And the numbers of a sentence are still set in that face, so this holds a boundary and not a
    // page that gave up on figures: the Goal and the Strategy on the same card carry theirs.
    assert.match(html, /<span class="fig">\d/, 'a number in a sentence is still set in the mono face');

    const view = await collectSessions(d, runId, sessions);
    assert.equal(view.run.status, 'cancelled', 'the route agrees with the card');
    const killed = view.jobs.filter((j) => j.event === 'killed');
    assert.equal(killed.length, 1, `one job of this Run was killed: ${JSON.stringify(view.jobs)}`);
    assert.equal(tmuxHasSession(killed[0]!.job.session), false, 'and the tmux session it held is gone from this machine');
    assert.deepEqual(d.unexpectedStdout(), []);
  } finally {
    for (const session of sessions) killSession(session);
    await d.dispose();
  }
});

test('a hard-blocked Run shows its blocker and the failed job\'s log tail, and clicking resume carries it on to its end', async (t) => {
  // More failures than the Retry allowance, so the first attempt blocks and the cause is still there
  // afterwards: clearing it is what a person does before they click resume.
  const d = await bootDriver(t, { home: 'hima', failures: 3 });
  if (!d) return;
  const sessions: string[] = [];
  try {
    // The pack varied onto `over-constraining-push` (#54), installed before the page is opened so the
    // start form offers it: the stand-in reports no margin for a period it meets, as Design Compiler
    // does, and the reference pack's own chooser reaches no ending of its own on that (D45). What
    // this test is about is the window, so the Campaign it watches has to reach one.
    const honest = await installOverConstraining(packsDirOf(d.home), 'over-constraining-probe');
    const opened = await d.open('/hima/');
    assert.ok(opened.ok, JSON.stringify(opened));
    await fillForm(d, { 'start-pack': honest, 'start-retries': '1' });
    const clicked = await d.click('start');
    assert.ok(clicked.ok, JSON.stringify(clicked));

    const waiting = await d.wait('run-status', 'waiting for a person', 120_000);
    assert.ok(waiting.ok, `wait run-status waiting: ${JSON.stringify(waiting)}`);
    assert.equal(waiting.state.status, 'waiting', JSON.stringify(waiting));

    // The blocked Run's Job and its workspace, before the reads and the waits that can fail: the
    // session it started is one this test ends however far down it gets.
    const runId = await theOneRunId(d);
    const blocked = await collectSessions(d, runId, sessions);
    const workspace = blocked.jobs.find((j) => j.event === 'launched')?.job.workspace;
    assert.ok(workspace, `the blocked Run launched a job in the campaign workspace: ${JSON.stringify(blocked.jobs)}`);
    const card = await d.open(`/hima/?run=${encodeURIComponent(runId)}`);
    assert.ok(card.ok, JSON.stringify(card));

    const blocker = await d.read('run-blocker');
    assert.ok(blocker.ok, `the card shows the blocker: ${JSON.stringify(blocker)}`);
    assert.equal(blocker.state.node, 'synthesize', JSON.stringify(blocker));
    assert.match(blocker.text, /spent its retry allowance of 1/, `and why the node gave up: ${blocker.text}`);
    // The tail is its own region, and what is in it is the failed Job's own log and not the reason:
    // make's own line about the recipe that failed, which is what a person reads before deciding.
    const tail = await d.read('run-blocker-tail');
    assert.ok(tail.ok, `and the tail of the failed job's own log: ${JSON.stringify(tail)}`);
    assert.match(tail.text, /make: \*\*\* \[synth\] Error 3/, `which is what the job itself said: ${tail.text}`);

    // Clear the cause the way a person would: the stand-in's failure counter, in the Campaign's own
    // copy of the flow — the copy the Job runs in, not the flow it was copied from.
    const failFile = path.join(workspace, 'flow/build', d.flow!.design, 'fail-remaining');
    assert.notEqual((await readFile(failFile, 'utf8')).trim(), '0', 'the stand-in still has failures left to give');
    await writeFile(failFile, '0\n');

    const resumed = await d.click('resume');
    assert.ok(resumed.ok, `the card carries the resume control while the Run waits: ${JSON.stringify(resumed)}`);
    const ended = await d.wait('run-status', 'ended', 120_000);
    assert.ok(ended.ok, `wait run-status ended: ${JSON.stringify(ended)}`);
    assert.equal(ended.state.status, 'ended-converged', `the Run carried on with a fresh allowance to the end of its Loop: ${JSON.stringify(ended)}`);

    const view = await collectSessions(d, runId, sessions);
    assert.equal(view.blockers.length, 1, 'a cleared blocker stays on the record: it happened');
    assert.deepEqual(
      view.nodes.filter((n) => n.nodeId === 'synthesize').map((n) => n.state),
      ['done'],
      'and the node that blocked is done',
    );
    assert.deepEqual(d.unexpectedStdout(), []);
  } finally {
    for (const session of sessions) killSession(session);
    await d.dispose();
  }
});

test('a refusal that changes nothing leaves its words on the card and the control still clickable', async (t) => {
  // The one state where the card stands still: a Run waiting for a person moves for nobody, so a
  // refusal that writes nothing leaves the run view identical, `<main>` is never swapped, and the
  // button on screen after the refusal is the very button that was clicked. Nothing else can hand
  // the control back — which is what makes this the case the script has to survive on its own.
  const d = await bootDriver(t, { home: 'hima', failures: 3 });
  if (!d) return;
  const sessions: string[] = [];
  try {
    // The pack varied onto `over-constraining-push` (#54), installed before the page is opened so the
    // start form offers it: the stand-in reports no margin for a period it meets, as Design Compiler
    // does, and the reference pack's own chooser reaches no ending of its own on that (D45). What
    // this test is about is the window, so the Campaign it watches has to reach one.
    const honest = await installOverConstraining(packsDirOf(d.home), 'over-constraining-probe');
    const opened = await d.open('/hima/');
    assert.ok(opened.ok, JSON.stringify(opened));
    await fillForm(d, { 'start-pack': honest, 'start-retries': '1' });
    const clicked = await d.click('start');
    assert.ok(clicked.ok, JSON.stringify(clicked));

    const waiting = await d.wait('run-status', 'waiting for a person', 120_000);
    assert.ok(waiting.ok, `wait run-status waiting: ${JSON.stringify(waiting)}`);

    const runId = await theOneRunId(d);
    const blocked = await collectSessions(d, runId, sessions);
    const workspace = blocked.jobs.find((j) => j.event === 'launched')?.job.workspace;
    assert.ok(workspace, `the blocked Run launched a job in the campaign workspace: ${JSON.stringify(blocked.jobs)}`);
    const card = await d.open(`/hima/?run=${encodeURIComponent(runId)}`);
    assert.ok(card.ok, JSON.stringify(card));
    const quiet = await d.read('run-error');
    assert.ok(quiet.ok, `the card carries the region a refused control is answered in: ${JSON.stringify(quiet)}`);
    assert.equal(quiet.text, '', 'and says nothing before anything was refused');

    // A Site this harness can no longer read. HimaFabric loads the Site before it writes anything at
    // all, so the resume is refused with nothing written: the Run is where it was, and so is its card.
    const sitesDir = path.join(d.home.home, 'hima/sites');
    const siteFile = path.join(sitesDir, 'local.yml');
    await rename(siteFile, `${siteFile}.away`);
    const refusedClick = await d.click('resume');
    assert.ok(refusedClick.ok, `the card carries the resume control while the Run waits: ${JSON.stringify(refusedClick)}`);
    const refused = await d.wait('run-error', 'unknown site "local"', 60_000);
    assert.ok(refused.ok, `wait run-error: ${JSON.stringify(refused)}`);
    assert.ok(
      refused.text.startsWith(`cannot resume run ${runId}: unknown site "local": no site file at `),
      `the card says the whole of what the route refused with: ${JSON.stringify(refused.text)}`,
    );
    const untouched = await runOverTheRoute(d, runId);
    assert.equal(untouched.run.status, 'waiting', 'and nothing was written: the Run is where it was');
    assert.equal(untouched.blockers.length, 1, `no second blocker was recorded: ${JSON.stringify(untouched.blockers)}`);

    // Put the Site back, clear what blocked the node, and click that same button again. It is the
    // same element — the card never changed, so nothing replaced it — and a control left disabled by
    // the refusal takes no click at all: the Run would stay waiting and this wait would time out.
    await rename(`${siteFile}.away`, siteFile);
    await writeFile(path.join(workspace, 'flow/build', d.flow!.design, 'fail-remaining'), '0\n');
    const again = await d.click('resume');
    assert.ok(again.ok, JSON.stringify(again));
    const ended = await d.wait('run-status', 'ended', 120_000);
    assert.ok(ended.ok, `the second click reached the route through the same control: ${JSON.stringify(ended)}`);
    assert.equal(ended.state.status, 'ended-converged', JSON.stringify(ended));

    const view = await collectSessions(d, runId, sessions);
    assert.equal(view.blockers.length, 1, 'the blocker the refusal did not clear is still the only one');
    assert.deepEqual(d.unexpectedStdout(), []);
  } finally {
    for (const session of sessions) killSession(session);
    await d.dispose();
  }
});

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

    // And nothing was started by either request.
    const opened = await d.open('/hima/');
    assert.ok(opened.ok, JSON.stringify(opened));
    const runs = await d.read('runs');
    assert.ok(runs.ok, JSON.stringify(runs));
    assert.equal(runs.state.count, '0', JSON.stringify(runs));
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
      apply(ctx: { slots: { inject(name: string, cb: () => unknown): unknown; register(d: { name: string; key: string }, c: unknown): unknown } }): void;
    };
    const registered: { name: string; key: string }[] = [];
    moduleExports.apply({
      slots: {
        inject: (_name, cb) => cb(),
        register: (declaration) => { registered.push(declaration); return () => undefined; },
      },
    });
    assert.deepEqual(registered.map((r) => r.key).sort(), ['hima_observe', 'hima_run'], 'and claims no key it did not claim before');
    assert.deepEqual(d.unexpectedStdout(), []);
  } finally {
    await d.dispose();
  }
});

// ---------------------------------------------------------------------------------------------
// Ticket #41: the page is designed. The stylesheet is the design — one token sheet at the top of
// one file, a light palette and a dark one selected by the window's own scheme, and the
// `--dsw-alias-*` names the shared words are coloured through defined from those tokens. Asserted
// on the stylesheet the host actually served, because a palette a build dropped is a page that
// prints dark text on a dark ground, which is what the first screenshot of this page showed.
// ---------------------------------------------------------------------------------------------

/** Where the token sheet begins and ends inside the page's one stylesheet. */
const TOKENS_BEGIN = '/* HIMA WORKBENCH TOKENS BEGIN */';
const TOKENS_END = '/* HIMA WORKBENCH TOKENS END */';

/** Anything that paints a colour by value rather than by token: a hex, an `rgb()`, an `hsl()`. */
const COLOUR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\brgba?\s*\(|\bhsla?\s*\(|\bcolor-mix\s*\(/;

test('the workbench page carries one token sheet with a dark palette and the alias names the card\'s words are coloured through, paints no colour outside it, and lists each Run with the state it stands in', async (t) => {
  const d = await bootDriver(t, { home: 'hima' });
  if (!d) return;
  try {
    const host = await d.host();
    assert.ok(host.ok, JSON.stringify(host));
    const cookie = await d.cookie();
    // The pack varied onto `over-constraining-push` (#54), installed before the page is opened so the
    // start form offers it: the run list this test reads needs a Run that reached an ending, and on a
    // stand-in that reports no margin for a period it meets the reference pack's chooser reaches
    // none (D45).
    const honest = await installOverConstraining(packsDirOf(d.home), 'over-constraining-probe');
    const opened = await d.open('/hima/');
    assert.ok(opened.ok, JSON.stringify(opened));

    // The stylesheet as the host served it, not as a module exports it: what a person's window
    // painted is what the route answered with.
    const served = await (await api(host, cookie, '/hima/')).text();
    const style = /<style>([\s\S]*?)<\/style>/.exec(served);
    assert.ok(style, 'the page carries its stylesheet inline: no external asset, because the fence permits none');
    const sheet = style[1]!;

    const begins = sheet.indexOf(TOKENS_BEGIN);
    const ends = sheet.indexOf(TOKENS_END);
    assert.ok(begins >= 0 && ends > begins, `the stylesheet opens with a delimited token sheet: ${sheet.slice(0, 200)}`);
    const tokens = sheet.slice(begins, ends);
    const rules = sheet.slice(0, begins) + sheet.slice(ends);

    // Every colour this page paints is a token edit away. A palette re-cut that had to hunt through
    // the rules for a hex is the one property the original's design system was proudest of, lost.
    assert.match(tokens, COLOUR_LITERAL, 'the token sheet is where the colours are');
    assert.doesNotMatch(rules, COLOUR_LITERAL, `a colour is painted outside the token sheet: ${(COLOUR_LITERAL.exec(rules) ?? [''])[0]}`);

    // Light and dark, selected by the scheme the window follows. Electron routes a forced theme
    // through `nativeTheme.themeSource`, so the media query is authoritative and a class is not.
    const dark = /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{([\s\S]*?--hima-ink:[\s\S]*?)\}\s*\}/.exec(tokens);
    assert.ok(dark, `the token sheet re-cuts the palette under prefers-color-scheme: dark: ${tokens}`);
    for (const token of ['--hima-page', '--hima-panel', '--hima-ink', '--hima-line']) {
      assert.ok(tokens.includes(`${token}:`), `the light palette names ${token}`);
      assert.ok(dark[1]!.includes(`${token}:`), `and the dark palette re-cuts it: ${dark[1]!}`);
    }

    // The type scale a person reads this page at: 16 px body, and a display size for the verdict.
    assert.match(tokens, /--hima-fs-body:\s*16px/, `the body size is 16 px: ${tokens}`);
    assert.match(tokens, /--hima-fs-display:\s*(2[89]|3[0-2])px/, `and one display size for the campaign's verdict: ${tokens}`);

    // The floor (#41): 14 px, held over every size this sheet states and not only over the scale.
    // A step is easy to read off the token block; a step shrunk by a factor inside some rule is the
    // way a floor is lost in practice — `.mono` was set to .94 em of its parent, which off the 14 px
    // step is 13.2 px of type on the screen. So the rules must state their sizes as steps, and the
    // steps must all clear the floor.
    const steps = [...tokens.matchAll(/--hima-fs-[a-z]+:\s*(\d+)px/g)].map((m) => Number(m[1]));
    assert.ok(steps.length >= 5, `the type scale is a set of steps: ${tokens}`);
    for (const step of steps) assert.ok(step >= 14, `every step of the scale clears the 14 px floor: ${JSON.stringify(steps)}`);
    for (const [declaration, size] of sheet.matchAll(/font-size:\s*([^;}]+)/g)) {
      assert.match(size!.trim(), /^var\(--hima-fs-[a-z]+\)$/, `every size the page sets is a step of the scale, so the floor holds everywhere: ${declaration}`);
    }
    assert.doesNotMatch(sheet, /font:[^;}]*\d+px/, 'and no font shorthand states a size of its own');

    // The card's words carry dsh's own token names with a fallback (`card-labels.ts`), and this page
    // is not dsh: it defines those names from its own palette, so one set of words is coloured by
    // one palette wherever the card is mounted.
    for (const alias of [
      '--dsw-alias-state-success-primary',
      '--dsw-alias-state-error-primary',
      '--dsw-alias-state-warn-primary',
      '--dsw-alias-label-secondary',
      '--dsw-alias-label-tertiary',
      '--ds-font-family-code',
    ]) {
      assert.match(tokens, new RegExp(`${alias}:\\s*var\\(--hima-`), `the page defines ${alias} from its own tokens: ${tokens}`);
    }

    // And the run list says where each Run stands, per row, so a driver can read one Run's state off
    // the list without opening it.
    await fillForm(d, { 'start-pack': honest });
    const clicked = await d.click('start');
    assert.ok(clicked.ok, JSON.stringify(clicked));
    const ended = await d.wait('run-status', 'ended', 120_000);
    assert.ok(ended.ok, `wait run-status: ${JSON.stringify(ended)}`);
    assert.equal(ended.state.status, 'ended-converged', JSON.stringify(ended));

    const runId = await theOneRunId(d);
    const runs = await d.read('runs');
    assert.ok(runs.ok, JSON.stringify(runs));
    assert.equal(runs.state[runId], 'ended-converged', `the row carries the Run's own status under its id: ${JSON.stringify(runs.state)}`);
    assert.ok(runs.text.includes('ended — converged'), `and says it in the card's words: ${runs.text}`);

    // Two more properties of the card only its HTML carries. The ledger's period head is one thought
    // with a parenthetical, and a head broken as "period (asked →" / "observed)" reads as two halves
    // of two; and the convergence plot writes the pair of numbers it is a picture of — the target it
    // was drawn against, and what the last generation measured — in the drawing's own margins.
    const card = await pageOverTheRoute(d, runId);
    assert.ok(card.includes('<span class="nobr">(asked → observed)</span>'), `the period head keeps its parenthetical whole: ${card.slice(card.indexOf('<thead>'), card.indexOf('</thead>'))}`);
    const values = [...card.matchAll(/<span class="plot-value[^"]*"[^>]*>([^<]+)</g)].map((m) => m[1]);
    const view = await runOverTheRoute(d, runId);
    const measured = [...view.generations].reverse().find((g) => g.observedPeriodNs !== undefined);
    assert.ok(measured !== undefined, `the Run measured a period to draw: ${JSON.stringify(view.generations)}`);
    assert.deepEqual(
      values,
      [`${String(view.run.goal?.['target_period_ns'])} ns`, `${String(measured.observedPeriodNs)} ns`],
      `the plot writes the two numbers it is a picture of, each with its unit: ${JSON.stringify(values)}`,
    );
    assert.deepEqual(d.unexpectedStdout(), []);
  } finally {
    await d.dispose();
  }
});

/**
 * What the shell's `zoom` op answers about the page it is showing: the window's own width in page
 * pixels, and the width the document laid itself out at.
 *
 * Read at a factor of 1 — the zoom the page is already at — because what this asks for is the
 * layout and not a zoom: the op is what waits two frames for the page to have laid itself out and
 * then reads both numbers in one instant, which is the only way they are comparable.
 */
async function widthsOf(d: BootedDriver): Promise<{ readonly innerWidth: number; readonly scrollWidth: number }> {
  const shown = await d.request({ op: 'zoom', factor: 1 });
  assert.ok(shown.ok, `zoom: ${JSON.stringify(shown)}`);
  const innerWidth = shown.innerWidth;
  const scrollWidth = shown.scrollWidth;
  assert.ok(typeof innerWidth === 'number' && typeof scrollWidth === 'number', `the shell says what the page shows: ${JSON.stringify(shown)}`);
  return { innerWidth, scrollWidth };
}

test('at a 900 px window nothing on the page is wider than the window, on the run list and on a whole card', async (t) => {
  // #41's own criterion, held by a driver rather than by eye: the layout is bounded by the window a
  // person opens it at, so nothing on it is read by scrolling sideways. 900 px is the width the
  // ticket named — narrower than the 1040 px content column, so the page is doing its narrowing —
  // and the card asserted on is a whole one: three generations of a converged Campaign, with the
  // ledger table, the convergence plot, the path, the evidence drawer and the technical report all
  // laid out. The two tables inside it are wider than the window on purpose (the generation ledger
  // asks for 942 px), and each scrolls inside its own scroller: that is exactly the difference this
  // asks about — a table a person scrolls, or a page they do.
  const d = await bootDriver(t, { home: 'hima', window: { width: 900, height: 900 } });
  if (!d) return;
  try {
    // The pack varied onto `over-constraining-push` (#54), installed before the page is opened so the
    // start form offers it: the stand-in reports no margin for a period it meets, as Design Compiler
    // does, and the reference pack's own chooser reaches no ending of its own on that (D45). What
    // this test is about is the window, so the Campaign it watches has to reach one.
    const honest = await installOverConstraining(packsDirOf(d.home), 'over-constraining-probe');
    const opened = await d.open('/hima/');
    assert.ok(opened.ok, JSON.stringify(opened));
    const list = await widthsOf(d);
    assert.ok(list.innerWidth <= 900, `the window opened at the size the test asked for: ${JSON.stringify(list)}`);
    assert.ok(list.scrollWidth <= list.innerWidth, `the run list and the start form lay out inside the window: ${JSON.stringify(list)}`);

    await fillForm(d, { 'start-pack': honest });
    const clicked = await d.click('start');
    assert.ok(clicked.ok, JSON.stringify(clicked));
    const ended = await d.wait('run-status', 'ended', 120_000);
    assert.ok(ended.ok, `wait run-status: ${JSON.stringify(ended)}`);
    assert.equal(ended.state.status, 'ended-converged', JSON.stringify(ended));
    // The report is the last section of the drawer and the widest thing the card holds; it is on the
    // page only once it has been written, which is once the Run has ended.
    const report = await d.read('run-experience');
    assert.ok(report.ok, `the ended Run's card carries its technical report: ${JSON.stringify(report)}`);

    const card = await widthsOf(d);
    assert.ok(card.innerWidth <= 900, `still the same window: ${JSON.stringify(card)}`);
    assert.ok(
      card.scrollWidth <= card.innerWidth,
      `the whole card lays out inside the window: it needs ${String(card.scrollWidth)} px of the ${String(card.innerWidth)} px the window shows`,
    );
    assert.deepEqual(d.unexpectedStdout(), []);
  } finally {
    await d.dispose();
  }
});
