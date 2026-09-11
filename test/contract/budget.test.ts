// Ticket #27: the Budget meters the whole Campaign, not one generation.
//
// The time box spans every generation; the generation limit is a meter; the Retry allowance is per
// node per generation; the job cap and the Site's declared licences bound launches. Every meter is
// shown against its bound, and a spent meter ends the Run `ended-budget-exhausted` naming what ran
// out — while a spent allowance and a full Site only make a Run wait.
//
// Driven through the desktop shell in driver mode (D42, ADR-0004), the one seam every step-3 test
// boots through: the Runs are started over the routes with the session the shell established, and
// what is asserted is what the routes answer and what the window's own page shows. The one
// exception is the last test, which is about the words a chat command says and boots in process,
// because no window renders a command's answer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { bootDriver, runIdOnTheList, type BootedDriver } from './support/driver.ts';
import { api } from './support/hima-api.ts';
import { inBackground, killSessions, launchedJobOf, localFabric, ONE_GENERATION, runOf, sessionsOf, waitUntil } from './support/fabric.ts';
import { himaCommand } from './support/command.ts';
import { installOverConstraining, packsDirOf, timingProbePackId } from './support/pack.ts';
import { tmuxHasSession } from './support/tmux.ts';
import { metersState } from '@hima/harness';
import type { JobRecord, LedgerRecord, NodeRecord, RunView } from '@hima/harness';

/** Every record of one Run, exactly as the ledger holds it, over the route the window reads. */
async function recordsOf(host: { readonly url: string }, cookie: string, runId: string): Promise<LedgerRecord[]> {
  const answer = await api(host, cookie, `/hima/api/runs/${encodeURIComponent(runId)}/records`);
  const text = await answer.text();
  assert.equal(answer.status, 200, text);
  return (JSON.parse(text) as { readonly records: LedgerRecord[] }).records;
}

/** Every tmux session this Run launched, so a test that fails part way stops what it started. */
const sessionsIn = (records: readonly LedgerRecord[]): string[] =>
  records.filter((r) => r.type === 'job' && r.event === 'launched').map((r) => (r as JobRecord).job.session);

/** One Run as the routes answer it, with the session the shell established: the very view the card
 *  the window is showing was rendered from, so a region's numbers can be held against the row's. */
async function runOverTheRoute(host: { readonly url: string }, cookie: string, runId: string): Promise<RunView> {
  const answer = await api(host, cookie, `/hima/api/runs/${encodeURIComponent(runId)}`);
  const text = await answer.text();
  assert.equal(answer.status, 200, text);
  return JSON.parse(text) as RunView;
}

/**
 * One region of the workbench page as the route serves it, from its own opening tag to its own
 * closing one.
 *
 * A driver reads a region's *text*, which is what a person reads; a bar has no text at all, so the
 * only way to hold the card to drawing one is to look at the markup the browser was handed and to
 * look at it inside the region, not anywhere on the page. The div depth is counted rather than
 * matched with a pattern, because the region holds divs of its own.
 */
function regionMarkup(html: string, region: string): string {
  const marked = html.indexOf(`data-hima-region="${region}"`);
  assert.ok(marked >= 0, `the page carries the ${region} region`);
  const opened = html.lastIndexOf('<div', marked);
  assert.ok(opened >= 0, `the ${region} region opens a div`);
  let depth = 0;
  for (let i = opened; i < html.length; i += 1) {
    if (html.startsWith('<div', i)) depth += 1;
    else if (html.startsWith('</div>', i)) {
      depth -= 1;
      if (depth === 0) return html.slice(opened, i + '</div>'.length);
    }
  }
  return assert.fail(`the ${region} region is never closed`);
}

/** The whole of one start request, awaited: this route answers when the Run has stopped. */
async function startRun(d: BootedDriver, body: Readonly<Record<string, unknown>>): Promise<RunView> {
  const host = await d.host();
  assert.ok(host.ok, JSON.stringify(host));
  const answered = await api(host, await d.cookie(), '/hima/api/runs', {
    method: 'POST',
    body: JSON.stringify({ pack: timingProbePackId, site: 'local', ...body }),
    headers: { 'content-type': 'application/json' },
  });
  const text = await answered.text();
  assert.equal(answered.status, 200, text);
  return JSON.parse(text) as RunView;
}

// ---------------------------------------------------------------------------------------------
// The time box is the Campaign's, and it runs out where the Campaign happens to be.
// ---------------------------------------------------------------------------------------------

/** How long each stand-in synthesis sleeps in the time-box test, and the box that is spent inside
 *  the second one of them: generation one is over well before the box, and generation two's Job is
 *  still sleeping when it runs out. In minutes because that is the unit the route's field is in;
 *  three eighths of a minute is 22 500 ms exactly, so nothing is rounded on the way to the row. */
const BOXED_SYNTH_SECONDS = 15;
const TIME_BOX_MINUTES = 0.375;

test('a time box spent inside generation two kills that generation\'s job and ends the Campaign naming the box', async (t) => {
  const d = await bootDriver(t, { home: 'hima', sleepSeconds: BOXED_SYNTH_SECONDS });
  if (!d) return;
  let sessions: string[] = [];
  try {
    const host = await d.host();
    assert.ok(host.ok, JSON.stringify(host));
    const cookie = await d.cookie();

    // A goal this flow can never meet, so the Campaign keeps exploring generation after generation,
    // and the box runs out in the second one.
    const view = await startRun(d, { goal: { target_period_ns: 2.0 }, strategy: { periodNs: 2.0 }, timeBox: TIME_BOX_MINUTES });
    const runId = view.run.id;
    const records = await recordsOf(host, cookie, runId);
    sessions = sessionsIn(records);

    assert.equal(view.run.status, 'ended-budget-exhausted', `the box, and not the exploration, ended it: ${JSON.stringify(view.run)}`);
    assert.equal(view.run.meters?.endedBy, 'time-box', 'and the meters say which meter did');
    assert.equal(view.run.generation, 2, 'the generation it was in when the box ran out');
    assert.equal(view.run.budget?.timeBoxMs, TIME_BOX_MINUTES * 60_000, 'the box the request asked for, in milliseconds');

    // The Job that was running when the box ran out was stopped, and the stop was observed.
    const killed = records.find((r): r is JobRecord => r.type === 'job' && r.event === 'killed');
    assert.ok(killed, `generation two's job was killed: ${JSON.stringify(records.map((r) => r.type))}`);
    assert.equal(killed.generation, 2, 'the job the box stopped is generation two\'s');
    assert.equal(tmuxHasSession(killed.job.session), false, 'and its tmux session is gone from this machine');

    // The meters carry the time each generation took, which is what makes a Campaign's box legible:
    // one entry per generation the Run opened, generation one first.
    const generationMs = view.run.meters?.generationMs;
    assert.ok(Array.isArray(generationMs), `the meters carry the time spent per generation: ${JSON.stringify(view.run.meters)}`);
    assert.equal(generationMs.length, 2, `one entry per generation opened: ${JSON.stringify(generationMs)}`);
    assert.ok(
      generationMs[0]! >= BOXED_SYNTH_SECONDS * 1000,
      `generation one took at least its own synthesis: ${JSON.stringify(generationMs)}`,
    );
    assert.ok(
      generationMs[0]! + generationMs[1]! <= (view.run.meters?.elapsedMs ?? 0),
      `and no generation is counted twice: ${JSON.stringify(view.run.meters)}`,
    );

    // Every meter against its bound, as the card's own region and `/hima status` read them off this
    // very view: the box in the unit the ledger keeps it in, the generation the Run reached, and the
    // seat its Jobs are no longer holding.
    const meters = metersState(view);
    assert.equal(meters['ended-by'], 'time-box', `the meters state names what ended it: ${JSON.stringify(meters)}`);
    assert.equal(meters['time-box-ms'], String(TIME_BOX_MINUTES * 60_000), JSON.stringify(meters));
    assert.equal(meters.generation, '2', JSON.stringify(meters));
    assert.equal(meters['generation-limit'], '6', `the pack's own allowance, which is not what ended it: ${JSON.stringify(meters)}`);
    assert.equal(meters['licence-design-compiler'], '0/1', `the site's one seat, held by nothing now: ${JSON.stringify(meters)}`);

    // What a person reads on the card the window shows: the meter that ended the Run, in words.
    const opened = await d.open(`/hima/?run=${encodeURIComponent(runId)}`);
    assert.ok(opened.ok, JSON.stringify(opened));
    const status = await d.wait('run-status', 'ended — budget exhausted');
    assert.ok(status.ok, `wait run-status: ${JSON.stringify(status)}`);
    // The name of a meter is its own column in the section, so what a person reads as one sentence is
    // two lines of the page's text: `ended by` beside `the time box`.
    assert.match(status.text, /ended by\s+the time box/, `the card names the meter that ended it: ${status.text}`);

    // And the card's own meters section says the same thing twice over: as the key a machine reads,
    // and as the sentence a person reads. It is the section this Run's whole Budget is shown in, so
    // the bound the box was set to is on it as well as the meter that ran out.
    const region = await d.read('run-meters');
    assert.ok(region.ok, `read run-meters: ${JSON.stringify(region)}`);
    assert.equal(region.state['ended-by'], 'time-box', `the region names the meter that ended it: ${JSON.stringify(region)}`);
    assert.equal(region.state['time-box-ms'], String(TIME_BOX_MINUTES * 60_000), JSON.stringify(region.state));
    assert.equal(region.state.generation, '2', JSON.stringify(region.state));
    assert.match(region.text, /ended by\s+the time box/, `and says it in words: ${region.text}`);
    assert.deepEqual(d.unexpectedStdout(), []);
  } finally {
    killSessions(sessions);
    await d.dispose();
  }
});

// ---------------------------------------------------------------------------------------------
// The Retry allowance is per node per generation, and a resume grants a fresh one.
// ---------------------------------------------------------------------------------------------

/** How long each stand-in synthesis sleeps while the second generation is being made to fail: long
 *  enough that the failure counter can be written into the Campaign's own copy of the flow after the
 *  Job has launched and before that Job reads it, and short enough that four of them are not a wait. */
const RETRIED_SYNTH_SECONDS = 5;

test('a retry allowance spent on generation two blocks that generation, and a resume gives it a fresh one', async (t) => {
  const d = await bootDriver(t, { home: 'hima', sleepSeconds: RETRIED_SYNTH_SECONDS });
  if (!d) return;
  let sessions: string[] = [];
  try {
    const host = await d.host();
    assert.ok(host.ok, JSON.stringify(host));
    const cookie = await d.cookie();

    // The pack varied onto `over-constraining-push` (#54): what this test needs of the Campaign is
    // that it reaches an ending of its own after the resume, and on a stand-in that reports no margin
    // for a met period the reference pack's own chooser reaches none. It converges at the third
    // generation here exactly as the reference pack used to.
    const honest = await installOverConstraining(packsDirOf(d.home), 'over-constraining-probe');

    // Started and not awaited: this route answers when the Run stops, and the whole subject here is
    // what happens to generation two while generation one is still going.
    const starting = api(host, cookie, '/hima/api/runs', {
      method: 'POST',
      body: JSON.stringify({ pack: honest, site: 'local', goal: { target_period_ns: 2.0 }, strategy: { periodNs: 2.0 }, retries: 2 }),
      headers: { 'content-type': 'application/json' },
    });
    starting.catch(() => undefined);
    const runId = await runIdOnTheList(d, honest);

    // The moment generation two has a Job of its own, make that generation fail twice — the way a
    // flaky flow does, in the copy of it the Campaign actually runs. `synth` reads the counter after
    // it sleeps, so the Job already launched is the first of the two failures.
    let workspace = '';
    await waitUntil('generation two launched its synthesis', async () => {
      const records = await recordsOf(host, cookie, runId);
      sessions = sessionsIn(records);
      const second = records.find((r): r is JobRecord => r.type === 'job' && r.event === 'launched' && r.generation === 2);
      if (second === undefined) return false;
      workspace = second.job.workspace;
      return true;
    }, 180_000, 250);
    await writeFile(path.join(workspace, 'flow/build', d.flow!.design, 'fail-remaining'), '2\n');

    const waiting = JSON.parse(await (await starting).text()) as RunView;
    sessions = sessionsIn(await recordsOf(host, cookie, runId));
    assert.equal(waiting.run.status, 'waiting', `the spent allowance made the Run wait, it did not end it: ${JSON.stringify(waiting.run)}`);
    assert.equal(waiting.run.generation, 2, 'in the generation whose node gave up');
    assert.equal(waiting.run.meters?.endedBy, undefined, 'and no meter ended it: an allowance is a wait, not an ending');
    const blocker = waiting.blockers[waiting.blockers.length - 1];
    assert.ok(blocker, `the node that gave up wrote a blocker: ${JSON.stringify(waiting.blockers)}`);
    assert.equal(blocker.nodeId, 'synthesize', JSON.stringify(blocker));
    assert.equal(blocker.attempts, 2, `it made both attempts the allowance gave it: ${JSON.stringify(blocker)}`);

    // The meters say the allowance is spent at the node that spent it, and not at the Wait node the
    // Run is parked on — which is where a person clicking resume is looking.
    const spent = metersState(waiting);
    assert.equal(spent.attempts, '2', `the attempts the allowance has taken: ${JSON.stringify(spent)}`);
    assert.equal(spent['retry-allowance'], '2', `against the allowance the Run was started under: ${JSON.stringify(spent)}`);
    assert.equal(spent.generation, '2', JSON.stringify(spent));

    // A person clears the cause and carries the Run on. The allowance is fresh, because a resume is
    // a person saying the cause is cleared, and the Campaign explores to its own ending.
    const resumed = await api(host, cookie, `/hima/api/runs/${encodeURIComponent(runId)}/resume`, { method: 'POST' });
    const resumedText = await resumed.text();
    assert.equal(resumed.status, 200, resumedText);
    const ended = JSON.parse(resumedText) as RunView;
    sessions = sessionsIn(await recordsOf(host, cookie, runId));
    assert.equal(ended.run.status, 'ended-converged', `generation two finished and the Campaign converged: ${JSON.stringify(ended.run)}`);
    assert.equal(ended.run.generation, 3, 'at the third generation, as it does with nothing failing');
    assert.equal(ended.blockers.length, 1, 'the cleared blocker stays on the record: it happened');
    const after = metersState(ended);
    assert.equal(after.attempts, '1', `the node the Run ended at is on its first attempt of the fresh allowance: ${JSON.stringify(after)}`);
    assert.deepEqual(d.unexpectedStdout(), []);
  } finally {
    killSessions(sessions);
    await d.dispose();
  }
});

// ---------------------------------------------------------------------------------------------
// A licence is one of the Site's slots, and a launch beyond what it declares waits for one.
// ---------------------------------------------------------------------------------------------

/** The licence the shipped pack's synthesis holds a seat of, and which the local Site declares. */
const STANDIN_LICENCE = 'Design-Compiler';

/** How long the seat is held for in the licence test: long enough that the second Run is certainly
 *  still waiting for it while the first has it. */
const LICENCE_SYNTH_SECONDS = 6;

test('a licence bounds a launch the way the job cap does: the second Campaign waits for the one seat the site declares', async (t) => {
  // Two job slots and one seat, so what holds the second Run back is unambiguously the licence: on a
  // Site with one of each — which is what the local site declares by default — the job cap runs out
  // first and no test could tell the two apart.
  const d = await bootDriver(t, { home: 'hima', sleepSeconds: LICENCE_SYNTH_SECONDS, parallelJobs: 2, licences: { [STANDIN_LICENCE]: 1 } });
  if (!d) return;
  let sessions: string[] = [];
  try {
    const host = await d.host();
    assert.ok(host.ok, JSON.stringify(host));
    const cookie = await d.cookie();

    // One generation each, because the subject is the seat and not the exploration; both started
    // before either is awaited, which is what puts two Campaigns on one Site at one moment.
    const both = [
      startRun(d, { goal: { target_period_ns: 2.0 }, strategy: { periodNs: 2.0 }, generations: 1 }),
      startRun(d, { goal: { target_period_ns: 2.0 }, strategy: { periodNs: 2.0 }, generations: 1 }),
    ];
    const views = await Promise.all(both);
    for (const view of views) sessions = [...sessions, ...sessionsIn(await recordsOf(host, cookie, view.run.id))];

    for (const view of views) {
      assert.equal(view.run.status, 'ended-budget-exhausted', `both ran the one generation they were allowed: ${JSON.stringify(view.run)}`);
      assert.deepEqual(view.run.budget?.licences, { [STANDIN_LICENCE]: 1 }, 'each under the seats the site declares');
      assert.equal(view.run.budget?.jobCap, 2, 'and under a job cap that was never what held either of them');
      const launched = view.jobs.filter((j) => j.event === 'launched');
      assert.equal(launched.length, 1, `one job per run: ${JSON.stringify(launched.map((j) => j.job.session))}`);
      assert.deepEqual(launched[0]!.licences, { [STANDIN_LICENCE]: 1 }, 'whose launched record carries the seat it holds');
      // The seat is the Run's own meter afterwards, in licence-milliseconds, and the meters region
      // says it is back: the Job that held it has ended.
      assert.ok((view.run.meters?.licenceMs?.[STANDIN_LICENCE] ?? 0) > 0, `and what it spent of it is on the meters: ${JSON.stringify(view.run.meters)}`);
      assert.equal(metersState(view)[`licence-${STANDIN_LICENCE.toLowerCase()}`], '0/1', `with the seat released: ${JSON.stringify(metersState(view))}`);
    }

    // Which of the two waited, and for what. Read off the node records — the whole path, one record
    // per transition — because the run view carries the state each node is in now, and by the time a
    // Run has ended the node that queued says `done`.
    const paths = await Promise.all(views.map(async (view) => (await recordsOf(host, cookie, view.run.id)).filter((r): r is NodeRecord => r.type === 'node')));
    const queued = paths.filter((records) => records.some((r) => r.state === 'waiting-for-slot'));
    assert.equal(queued.length, 1, 'exactly one of the two waited for the seat; the other had it');
    const waited = queued[0]!.find((r) => r.state === 'waiting-for-slot')!;
    t.diagnostic(`the queued campaign waited: ${waited.reason ?? ''}`);
    assert.equal(waited.nodeId, 'synthesize', JSON.stringify(waited));
    assert.match(waited.reason ?? '', new RegExp(`licence of "${STANDIN_LICENCE}"`), `the wait names the licence: ${JSON.stringify(waited)}`);
    assert.doesNotMatch(waited.reason ?? '', /against a cap of/, `and not the job cap, which had room: ${waited.reason ?? ''}`);
    assert.deepEqual(
      queued[0]!.filter((r) => r.nodeId === 'synthesize').map((r) => r.state),
      ['waiting-for-slot', 'running', 'done'],
      'it waited, then launched, then finished: waiting for a seat is not a failed attempt',
    );

    // The card of one of them, which is the other ending a meter can write: these two Runs were
    // ended by the generation limit and not by the box, and the section says which in words.
    const opened = await d.open(`/hima/?run=${encodeURIComponent(views[0]!.run.id)}`);
    assert.ok(opened.ok, JSON.stringify(opened));
    const region = await d.wait('run-meters', 'ended by');
    assert.ok(region.ok, `wait run-meters: ${JSON.stringify(region)}`);
    assert.equal(region.state['ended-by'], 'generation-limit', `the region names the meter that ended it: ${JSON.stringify(region)}`);
    assert.match(region.text, /ended by\s+the generation limit/, `and says it in words: ${region.text}`);
    assert.equal(region.state[`licence-${STANDIN_LICENCE.toLowerCase()}`], '0/1', `with the seat released: ${JSON.stringify(region.state)}`);
    assert.deepEqual(d.unexpectedStdout(), []);
  } finally {
    killSessions(sessions);
    await d.dispose();
  }
});

// ---------------------------------------------------------------------------------------------
// The card's own meters section (#27b): every meter of a running Campaign against its bound, on the
// page the window shows and in the numbers the run row actually holds.
// ---------------------------------------------------------------------------------------------

/** How long the stand-in sleeps while the card is read: long enough that the Campaign is certainly
 *  still running — its Job still holding the Site's one seat — while the page is opened and read. */
const WATCHED_PAGE_SYNTH_SECONDS = 10;

test('the card\'s meters region shows a running Campaign every meter against its bound, in the numbers the run row holds', async (t) => {
  const d = await bootDriver(t, { home: 'hima', sleepSeconds: WATCHED_PAGE_SYNTH_SECONDS });
  if (!d) return;
  let sessions: string[] = [];
  try {
    const host = await d.host();
    assert.ok(host.ok, JSON.stringify(host));
    const cookie = await d.cookie();

    // Started and not awaited, because every meter but the ending reads differently on a Campaign
    // that has stopped: the seat is released, no node is part way through an attempt, and the two
    // numbers a bar is drawn from stop moving.
    const starting = api(host, cookie, '/hima/api/runs', {
      method: 'POST',
      body: JSON.stringify({ pack: timingProbePackId, site: 'local', goal: { target_period_ns: 2.0 }, strategy: { periodNs: 2.0 }, timeBox: 5, retries: 2, generations: 1 }),
      headers: { 'content-type': 'application/json' },
    });
    starting.catch(() => undefined);
    const runId = await runIdOnTheList(d);
    await waitUntil('the campaign launched its synthesis', async () => {
      const records = await recordsOf(host, cookie, runId);
      sessions = sessionsIn(records);
      return records.some((r) => r.type === 'job' && r.event === 'launched');
    }, 180_000, 250);

    const opened = await d.open(`/hima/?run=${encodeURIComponent(runId)}`);
    assert.ok(opened.ok, JSON.stringify(opened));
    const region = await d.wait('run-meters', 'of a time box of');
    assert.ok(region.ok, `wait run-meters: ${JSON.stringify(region)}`);

    // What the run row holds, read over the very route the card was rendered from, once the page has
    // been read: the meters of a running Run are written by the fabric and not by the reading, so
    // this is the same row the render came off.
    const view = await runOverTheRoute(host, cookie, runId);
    assert.equal(view.run.status, 'running', `the Campaign is still going while its card is read: ${JSON.stringify(view.run)}`);

    // The region's state is the run row's meters against the run row's Budget, key for key. Elapsed
    // is the one that moves on its own, so it is held to what the row says now rather than to a
    // number: a page cannot be showing more time than the Run has spent.
    const held = metersState(view);
    for (const [key, value] of Object.entries(held)) {
      if (key === 'elapsed-ms') continue;
      assert.equal(region.state[key], value, `the region's ${key} is the run row's: ${JSON.stringify(region.state)} against ${JSON.stringify(held)}`);
    }
    assert.deepEqual(
      Object.keys(region.state).sort(),
      Object.keys(held).sort(),
      `the page's keys and the view's are one set: ${JSON.stringify(region.state)} against ${JSON.stringify(held)}`,
    );

    // Numbers, not prose: a state attribute is read by a machine and the sentences below are what a
    // person reads. `22.9 s` in either of these would be a duration nobody can compare.
    assert.match(region.state['elapsed-ms'] ?? '', /^\d+$/, JSON.stringify(region.state));
    assert.match(region.state['time-box-ms'] ?? '', /^\d+$/, JSON.stringify(region.state));
    assert.ok(Number(region.state['elapsed-ms']) > 0, `and the clock has moved: ${JSON.stringify(region.state)}`);
    assert.ok(
      Number(region.state['elapsed-ms']) <= (view.run.meters?.elapsedMs ?? 0),
      `the page cannot show more time than the row holds: ${JSON.stringify(region.state)} against ${JSON.stringify(view.run.meters)}`,
    );
    assert.equal(region.state['time-box-ms'], String(5 * 60_000), `the box the request asked for: ${JSON.stringify(region.state)}`);
    assert.equal(region.state['licence-design-compiler'], '1/1', `the seat this Run's job is holding right now: ${JSON.stringify(region.state)}`);

    // And the words, which are `meterLines`' and nobody else's: one sentence per meter, each against
    // the bound above it in the row.
    // A meter whose sentence opens with its own name has that name in the first column and the rest of
    // the sentence in the third, so the page's text carries the two on their own lines: the words are
    // `meterLines`', and the whitespace between them is where the column boundary falls (#27b).
    assert.ok(region.text.includes('of a time box of 5.0 min'), `elapsed against the box: ${region.text}`);
    assert.match(region.text, /generation\s+1 of at most 1/, `the generation against its limit: ${region.text}`);
    assert.ok(region.text.includes('1 job launched, at most 1 job at a time'), `the jobs against the cap: ${region.text}`);
    assert.ok(region.text.includes('synthesize: attempt 1 of a retry allowance of 2'), `the allowance at the node spending it: ${region.text}`);
    assert.match(region.text, /Design-Compiler\s+1 seat of 1 declared/, `the seat against the declaration: ${region.text}`);
    assert.doesNotMatch(region.text, /ended by/, `nothing has ended this Run: ${region.text}`);

    // And the bars, which have no words at all and so cannot be read the way every assertion above
    // reads: the page a browser is handed is fetched over the same route with the same session, and
    // what is counted is counted inside the region. Three bars, because exactly three of this Run's
    // meters accumulate against a bound of their own kind — elapsed against the box, the generation
    // against the limit, this node's attempts against the allowance — and the other two rows, the Job
    // line and the licence line, leave the bar column empty because a bar would misdraw the pair of
    // numbers they carry. Five rows, five names: the section's first column is what each meter is
    // called. A bar dropped from `meterRows` fails here and nowhere else.
    const served = await api(host, cookie, `/hima/?run=${encodeURIComponent(runId)}`);
    const html = await served.text();
    assert.equal(served.status, 200, html);
    const markup = regionMarkup(html, 'run-meters');
    assert.equal((markup.match(/class="meter"/g) ?? []).length, 3, `three of the meters are drawn as bars: ${markup}`);
    assert.equal((markup.match(/class="meter-fill"/g) ?? []).length, 3, `each of them filled to where its meter stands: ${markup}`);
    assert.equal((markup.match(/class="meter-none"/g) ?? []).length, 2, `and the two no bar can draw leave that column empty: ${markup}`);
    assert.equal((markup.match(/class="k"/g) ?? []).length, 5, `every one of the five meters is named in the first column: ${markup}`);

    // The banner's own compact clauses are gone from the page: one Budget said one way. The section
    // sits inside the verdict band, so this is read off the band that now carries it.
    const status = await d.read('run-status');
    assert.ok(status.ok, `read run-status: ${JSON.stringify(status)}`);
    assert.ok(status.text.includes('of a time box of'), `the band carries the section: ${status.text}`);
    assert.doesNotMatch(status.text, /budget: time box/, `and not the banner's own budget clause as well: ${status.text}`);
    assert.doesNotMatch(status.text, /meters: \d/, `nor its own meters clause: ${status.text}`);

    const ended = JSON.parse(await (await starting).text()) as RunView;
    assert.equal(ended.run.status, 'ended-budget-exhausted', `and the Campaign ran out its one generation: ${JSON.stringify(ended.run)}`);
    sessions = sessionsIn(await recordsOf(host, cookie, runId));
    assert.deepEqual(d.unexpectedStdout(), []);
  } finally {
    killSessions(sessions);
    await d.dispose();
  }
});

test('the served HimaGuide bundle carries the meters section, as the workbench page does', async (t) => {
  const d = await bootDriver(t, { home: 'hima' });
  if (!d) return;
  try {
    const host = await d.host();
    assert.ok(host.ok, JSON.stringify(host));
    const cookie = await d.cookie();

    const index = await api(host, cookie, '/');
    const html = await index.text();
    const boot = /globalThis\["__DSH_BOOT__"\] = ([\s\S]*?)<\/script>/.exec(html);
    assert.ok(boot, 'the index carries the client-module boot graph');
    const graph = JSON.parse(boot[1]!) as { entries: { id: string; url: string }[] };
    const hima = graph.entries.find((e) => e.id === '@hima/harness');
    assert.ok(hima, `the Hima module is in the boot graph; it holds ${graph.entries.map((e) => e.id).join(', ')}`);
    const source = await (await api(host, cookie, hima.url)).text();

    // The card has two mounts and one Budget. Only spellings a minified React bundle cannot satisfy
    // by accident are asked for: the region's name, the question the section answers, and two of
    // `meterLines`' own clauses.
    assert.ok(source.includes('run-meters'), 'the chat\'s card marks the meters section the way the page does');
    assert.ok(source.includes('what it has spent'), 'and heads it with the question the page\'s board asks');
    assert.ok(source.includes('of a time box of'), 'and says elapsed against the box in the same words');
    assert.ok(source.includes('launched, at most'), 'and the jobs against the cap in the same words');
    assert.deepEqual(d.unexpectedStdout(), []);
  } finally {
    await d.dispose();
  }
});

// ---------------------------------------------------------------------------------------------
// The words a chat command says. The one thing the in-process host is still the seam for (D42): a
// command's answer is text a person reads, and no window renders it.
// ---------------------------------------------------------------------------------------------

/** How long the stand-in sleeps while `/hima status` is asked about the Run: long enough that the
 *  Job is certainly still holding its seat when the command answers. */
const WATCHED_SYNTH_SECONDS = 6;

test('/hima status prints every meter of a running Campaign against its bound, in the numbers the run row holds', async (t) => {
  const local = await localFabric(t, { sleepSeconds: WATCHED_SYNTH_SECONDS });
  if (!local) return;
  const { h, host, dispose } = local;
  let sessions: string[] = [];
  try {
    // Left running while the Run is asked about, because every meter but one reads differently on a
    // Campaign that has stopped: the seat is released, the generation's clock has stopped, and no
    // node is part way through an attempt.
    const running = inBackground(host, h, `/hima run ${timingProbePackId} --site local --goal target_period_ns=2.0 --set periodNs=2.0 --time-box 5 --retries 2 ${ONE_GENERATION}`);
    const open = await launchedJobOf(host);
    sessions = sessionsOf(host, open.runId);
    // The `launched` record lands before the meters that count it: the turn writes the Job, then the
    // node's `running` record, then moves the row. Asked in that window, the row still says no Job
    // was launched — which the pre-push suite saw once under load — so the meters are waited for.
    await waitUntil('the row counts the launch', () => runOf(host, open.runId).meters?.jobsLaunched === 1, 10_000);

    const status = await himaCommand(host, h.workspace, `/hima status ${open.runId}`);
    for (const line of status.text.split('\n')) t.diagnostic(line);
    assert.equal(status.kind, 'success', status.text);

    // What the row holds, which is exactly what `GET /hima/api/runs/<id>` answers with as `budget`
    // and `meters` — the run view copies both from the row — so these are the numbers the lines
    // below have to be saying.
    const run = runOf(host, open.runId);
    assert.equal(run.status, 'running', `the Run is still going while it is asked about: ${JSON.stringify(run)}`);
    assert.equal(run.budget?.timeBoxMs, 5 * 60_000, JSON.stringify(run.budget));
    assert.equal(run.budget?.generationLimit, 1, JSON.stringify(run.budget));
    assert.equal(run.budget?.jobCap, 1, JSON.stringify(run.budget));
    assert.equal(run.budget?.retryAllowance, 2, JSON.stringify(run.budget));
    assert.deepEqual(run.budget?.licences, { [STANDIN_LICENCE]: 1 }, JSON.stringify(run.budget));
    assert.equal(run.meters?.jobsLaunched, 1, JSON.stringify(run.meters));
    assert.equal(run.generation, 1, JSON.stringify(run));

    // One line per meter, each against the bound above it in the row.
    assert.match(status.text, /^ {4}elapsed \d[\d.]* (?:ms|s|min) of a time box of 5\.0 min$/m, status.text);
    assert.match(status.text, /^ {4}generation 1 of at most 1, \d[\d.]* (?:ms|s|min)$/m, status.text);
    assert.match(status.text, /^ {4}1 job launched, at most 1 job at a time$/m, status.text);
    assert.match(status.text, /^ {4}synthesize: attempt 1 of a retry allowance of 2, and 1 attempt in the campaign so far$/m, status.text);
    assert.match(status.text, /^ {4}Design-Compiler 1 seat of 1 declared$/m, `the seat is held while the job runs: ${status.text}`);
    assert.doesNotMatch(status.text, /^ {4}ended by /m, `nothing has ended this Run: ${status.text}`);

    // And the same command once it has stopped: the seat is back, and the meter that ended it is
    // named in words rather than in the ledger's own key.
    const ran = await running.done;
    assert.equal(ran.kind, 'success', ran.text);
    assert.match(ran.text, /^ {4}Design-Compiler 0 seats of 1 declared, held for \d[\d.]* (?:ms|s|min)$/m, ran.text);
    assert.match(ran.text, /^ {4}ended by the generation limit$/m, ran.text);
  } finally {
    killSessions(sessions);
    await dispose();
  }
});
