// Ticket #28: drill-down. An Explore node opens its own small Loop — a graph of its own declared
// beside the pack's, with its own convergence and its own generation counter — the fabric runs it to
// its own ending, records it as a pair of `loop` records with every record inside it nested under the
// loop id, and the outer graph continues on the edge that outcome labels.
//
// Driven through the desktop shell in driver mode (D42, ADR-0004), which is the one seam every
// step-3 test boots through: the Run is started over the routes with the session the shell
// established, and the ending is read off the workbench page the window renders. What is asserted is
// what a person sees and what the ledger holds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { bootDriver } from './support/driver.ts';
import { himaCommand, siteCommandTimeoutMs } from './support/command.ts';
import { killSessions, localFabric, sessionsOf } from './support/fabric.ts';
import { api } from './support/hima-api.ts';
import { drillDownGraph, installDrillDown, packsDirOf, writePackVariant } from './support/pack.ts';
import { LEDGER_ORDER, loopsState } from '@hima/harness';
import type { BootedDriver } from './support/driver.ts';
import type { JobRecord, LedgerRecord, LoopRecord, RunView } from '@hima/harness';

/** Every record of one Run, exactly as the ledger holds it, over the route the window reads. */
async function recordsOf(host: { readonly url: string }, cookie: string, runId: string): Promise<LedgerRecord[]> {
  const answer = await api(host, cookie, `/hima/api/runs/${encodeURIComponent(runId)}/records`);
  const text = await answer.text();
  assert.equal(answer.status, 200, text);
  return (JSON.parse(text) as { readonly records: LedgerRecord[] }).records;
}

/** One Run as the window and the routes both read it. */
async function runViewOf(host: { readonly url: string }, cookie: string, runId: string): Promise<RunView> {
  const answer = await api(host, cookie, `/hima/api/runs/${encodeURIComponent(runId)}`);
  const text = await answer.text();
  assert.equal(answer.status, 200, text);
  return JSON.parse(text) as RunView;
}

/** The two records that bracket one loop, in the order the ledger holds them. */
const loopRecordsIn = (records: readonly LedgerRecord[]): LoopRecord[] =>
  records.filter((r): r is LoopRecord => r.type === 'loop');

/** One row of the generation ledger as the page wrote it: which kind of row it is, and the id of the
 *  drill-down loop it says it belongs to. */
interface LedgerRowOnPage { readonly kind: 'generation' | 'loop-head' | 'loop-foot'; readonly loop?: string }

/**
 * Every row of the generation ledger, in the order the page's own HTML has them.
 *
 * Read out of the markup and not off the text the region flattens to, because "the loop's rows are
 * nested under the row that opened them" is a fact about the page's structure: a card that rendered
 * a loop's three generations as three more rows of the outer graph — no `data-hima-loop`, no step
 * in from the margin — would flatten to the same words.
 *
 * The `<tbody>` of the ledger inside the loops region, so the head of the table is not a row and the
 * path table below it is not read at all.
 */
function ledgerRowsOn(html: string): LedgerRowOnPage[] {
  const body = /<div data-hima-region="run-loops"[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/.exec(html);
  assert.ok(body, 'the page marks the loops region and the ledger inside it');
  return [...(body[1] ?? '').matchAll(/<tr\b([^>]*)>/g)].map((row) => {
    const attributes = row[1] ?? '';
    const loop = /data-hima-loop="([^"]+)"/.exec(attributes)?.[1];
    const classes = /class="([^"]*)"/.exec(attributes)?.[1] ?? '';
    const kind = classes.split(/\s+/).includes('loop-head')
      ? 'loop-head'
      : (classes.split(/\s+/).includes('loop-foot') ? 'loop-foot' : 'generation');
    return { kind, ...(loop === undefined ? {} : { loop }) };
  });
}

test('an explore node opens its own loop, which converges on its own condition, and the outer graph continues on the edge that outcome labels', async (t) => {
  const d = await bootDriver(t, { home: 'hima' });
  if (!d) return;
  try {
    const host = await d.host();
    assert.ok(host.ok, JSON.stringify(host));
    const cookie = await d.cookie();
    const pack = await installDrillDown(packsDirOf(d.home), 'drill-down', 6);

    // 2.00 ns is tighter than this stand-in flow closes at and always will be: inside the loop the
    // first generation misses by 0.20, which states that the design closes at 2.20, so the chooser
    // asks for one step less — 2.15 — and the third generation asks for the same 2.15 the second
    // did, because it read the same violation. A move of nothing, which is what the loop calls
    // converged.
    const started = await api(host, cookie, '/hima/api/runs', {
      method: 'POST',
      body: JSON.stringify({ pack, site: 'local', goal: { target_period_ns: 2.0 }, strategy: { periodNs: 2.0 } }),
      headers: { 'content-type': 'application/json' },
    });
    const startedText = await started.text();
    assert.equal(started.status, 200, startedText);
    const view = JSON.parse(startedText) as RunView;
    const runId = view.run.id;
    assert.equal(view.run.status, 'ended-goal-not-met', `the outer graph ran out of edges after the loop: ${startedText}`);
    assert.equal(view.run.generation, 1, 'the outer graph took one generation; the three were the loop\'s');
    assert.equal(view.jobs.filter((j) => j.event === 'launched').length, 3, 'one synthesis per inner generation');

    const records = await recordsOf(host, cookie, runId);
    const loops = loopRecordsIn(records);
    assert.deepEqual(loops.map((r) => r.event), ['opened', 'closed'], `the loop is a pair of records: ${JSON.stringify(records.map((r) => r.type))}`);
    const [opened, closed] = loops as [LoopRecord, LoopRecord];
    assert.equal(opened.name, 'push');
    assert.equal(opened.nodeId, 'probe', 'the record names the explore node that opened it');
    assert.equal(opened.generation, 1, 'it was opened in the outer graph\'s first generation');
    assert.equal(closed.loopId, opened.loopId, 'the pair names one loop');
    assert.equal(closed.outcome, 'converged', 'the loop closed on its own convergence condition');
    assert.equal(closed.generations, 3, 'and it took three generations to say so');

    // Every record written inside the loop is nested under it and carries the loop's own generation;
    // the outer graph's own records carry no loop at all.
    const inner = records.filter((r) => r.loopId !== undefined && r.type !== 'loop');
    assert.ok(inner.length > 0, 'the loop wrote records');
    for (const r of inner) {
      assert.equal(r.loopId, opened.loopId, `record ${r.id} (${r.type}) names another loop`);
      assert.ok(r.generation !== undefined && r.generation >= 1 && r.generation <= 3, `record ${r.id} carries an inner generation: ${String(r.generation)}`);
    }
    const outerNodes = records.filter((r) => r.type === 'node' && r.loopId === undefined);
    assert.deepEqual(
      [...new Set(outerNodes.map((r) => (r as { nodeId: string }).nodeId))],
      ['probe', 'final-read'],
      'the outer graph\'s nodes are the only ones whose records carry no loop',
    );

    // The run view nests: the loop hangs off the outer generation that opened it, with its own
    // generations inside it.
    const outerRows = view.generations;
    assert.equal(outerRows.length, 1, JSON.stringify(outerRows));
    const nested = outerRows[0]?.loops;
    assert.equal(nested?.length, 1, `the outer generation carries the loop it opened: ${JSON.stringify(outerRows[0])}`);
    assert.equal(nested?.[0]?.name, 'push');
    assert.equal(nested?.[0]?.outcome, 'converged');
    assert.equal(nested?.[0]?.generations.length, 3, 'three rows, one per inner generation');
    assert.deepEqual(nested?.[0]?.generations.map((g) => g.strategy), [{ periodNs: 2 }, { periodNs: 2.15 }, { periodNs: 2.15 }], 'each row says what its strategy asked for, knob by knob');
    assert.deepEqual(loopsState(view), { count: '1', open: '' }, 'one loop, none of them open');

    // The Budget's per-generation meter counts the *outer* generations, and one of them covers the
    // whole drill-down: the loop opened, ran its three generations and closed inside outer
    // generation one, so that one entry spans all of it.
    const generationMs = view.run.meters?.generationMs;
    assert.equal(generationMs?.length, 1, `one outer generation, one entry: ${JSON.stringify(view.run.meters)}`);
    const outerMs = generationMs?.[0] ?? 0;
    const insideMs = (nested?.[0]?.generations ?? []).reduce((sum, g) => sum + g.wallMs, 0);
    assert.ok(insideMs > 0, `the loop's generations took time: ${JSON.stringify(nested?.[0]?.generations.map((g) => g.wallMs))}`);
    assert.ok(outerMs >= insideMs, `the outer generation's ${String(outerMs)} ms covers its loop's three, ${String(insideMs)} ms together`);
    const firstRecord = records[0];
    assert.ok(firstRecord, 'the Run wrote records');
    assert.ok(
      Date.parse(closed.at) - Date.parse(firstRecord.at) <= outerMs,
      `the moment the loop closed lies inside the outer generation that opened it: ${String(Date.parse(closed.at) - Date.parse(firstRecord.at))} ms into a generation of ${String(outerMs)} ms`,
    );

    const opened2 = await d.open(`/hima/?run=${encodeURIComponent(runId)}`);
    assert.ok(opened2.ok, JSON.stringify(opened2));
    const status = await d.wait('run-status', 'ended — goal not met');
    assert.ok(status.ok, `wait run-status: ${JSON.stringify(status)}`);

    // The ledger nests it (#28b): under the outer generation's row, the loop's own three rows as a
    // group headed by what the loop is and what it came to, and bracketed by where it opened and
    // what closed it. The region says how many loops this Campaign opened and that none is open now.
    const innerRows = nested?.[0]?.generations ?? [];
    const ledger = await d.wait('run-loops', 'push: converged, 3 generations');
    assert.ok(ledger.ok, `wait run-loops: ${JSON.stringify(ledger)}`);
    assert.deepEqual(ledger.state, { count: '1', open: '' }, `the region says what loopsState says: ${JSON.stringify(ledger)}`);
    assert.ok(ledger.text.includes('opened at probe'), `the group says which explore node opened the loop: ${ledger.text}`);
    assert.ok(ledger.text.includes('closed — converged'), `and what closed it: ${ledger.text}`);
    // The inner rows' own numbers, none of which is anywhere else on this page: the outer graph
    // decided nothing itself, and its one row asked for 2 and measured 2.15 at a slack of −0.05 —
    // the period the loop settled one step below what the flow violated at (#54).
    for (const row of innerRows) {
      assert.ok(
        row.decision !== undefined && ledger.text.includes(row.decision),
        `the loop's generation ${String(row.generation)} says what it decided: ${ledger.text}`,
      );
    }
    assert.ok(ledger.text.includes('clock period 2.15 ns → 2.15'), `a generation of the loop asked for what it then measured: ${ledger.text}`);
    assert.ok(
      ledger.text.includes(String(innerRows[0]?.slackNs)),
      `the loop's first generation closed at ${String(innerRows[0]?.slackNs)} ns: ${ledger.text}`,
    );

    // And the nesting itself, in the page's own markup: the same page, fetched over the route with
    // the session the shell established. The loop's three generations are rows the page says belong
    // to *this* loop, bracketed by a head and a foot that say so too, under an outer row that says
    // it belongs to none — and in that order. A regression that flattened the loop's passes into
    // three more rows of the outer graph would read the same and would fail here.
    const rendered = await api(host, cookie, `/hima/?run=${encodeURIComponent(runId)}`);
    const html = await rendered.text();
    assert.equal(rendered.status, 200, html.slice(0, 400));
    const loop = opened.loopId;
    assert.deepEqual(ledgerRowsOn(html), [
      { kind: 'generation' },
      { kind: 'loop-head', loop },
      ...innerRows.map(() => ({ kind: 'generation', loop })),
      { kind: 'loop-foot', loop },
    ], 'outer row, then the loop\'s bracket around its own three rows');

    // What the picture's left-to-right is, said under it: this Campaign's outer measurement was
    // taken after the loop it opened had closed, and the ledger lists it first regardless.
    assert.ok(html.includes(LEDGER_ORDER), `the plot says what its order is: ${html.slice(0, 200)}`);
    assert.deepEqual(d.unexpectedStdout(), []);
  } finally {
    await d.dispose();
  }
});

test('a loop that runs out of its own generation limit closes on that outcome, and the outer graph takes the edge that one labels', async (t) => {
  const d = await bootDriver(t, { home: 'hima' });
  if (!d) return;
  try {
    const host = await d.host();
    assert.ok(host.ok, JSON.stringify(host));
    const cookie = await d.cookie();
    // The same loop at the same unreachable goal, allowed two generations of its own instead of six:
    // the second decides a next period it is not allowed to try, and the loop closes on the meter.
    const pack = await installDrillDown(packsDirOf(d.home), 'drill-down-limited', 2);

    const started = await api(host, cookie, '/hima/api/runs', {
      method: 'POST',
      body: JSON.stringify({ pack, site: 'local', goal: { target_period_ns: 2.0 }, strategy: { periodNs: 2.0 } }),
      headers: { 'content-type': 'application/json' },
    });
    const startedText = await started.text();
    assert.equal(started.status, 200, startedText);
    const view = JSON.parse(startedText) as RunView;
    const runId = view.run.id;
    assert.equal(view.run.status, 'waiting', `the outer graph routed the outcome to its wait node: ${startedText}`);
    assert.equal(view.run.currentNode, 'blocked', 'and the run stands at the node that edge leads to');
    assert.equal(view.run.loop, undefined, 'the loop is closed, so the row is inside none');
    assert.equal(view.jobs.filter((j) => j.event === 'launched').length, 2, 'two inner generations and no third');

    const records = await recordsOf(host, cookie, runId);
    const [, closed] = loopRecordsIn(records) as [LoopRecord, LoopRecord];
    assert.equal(closed.event, 'closed');
    assert.equal(closed.outcome, 'generation-limit', 'the loop was stopped by what it was allowed, not by what it learned');
    assert.equal(closed.generations, 2);
    // The decision the loop was not allowed to act on is still on record, exactly as the Run's own
    // generation limit leaves it.
    const decisions = records.filter((r) => r.type === 'decision');
    assert.equal(decisions.length, 2, `each inner generation decided: ${JSON.stringify(decisions.map((r) => r.generation))}`);

    const nested = view.generations[0]?.loops?.[0];
    assert.equal(nested?.outcome, 'generation-limit', JSON.stringify(view.generations[0]));
    assert.equal(nested?.generations.length, 2);
    assert.deepEqual(loopsState(view), { count: '1', open: '' });

    const page = await d.open(`/hima/?run=${encodeURIComponent(runId)}`);
    assert.ok(page.ok, JSON.stringify(page));
    const status = await d.wait('run-status', 'waiting for a person');
    assert.ok(status.ok, `wait run-status: ${JSON.stringify(status)}`);
    assert.deepEqual(d.unexpectedStdout(), []);
  } finally {
    await d.dispose();
  }
});

// ---------------------------------------------------------------------------------------------
// A Campaign a person stops in the middle of its inner Loop, and one whose host goes away there.
// Both act during the loop's second generation, which is what makes them about the drill-down
// rather than about one generation: the loop must still be on record as opened, and the generation
// before the interruption must still be there and still say which loop and which generation it was.
// ---------------------------------------------------------------------------------------------

/** How long each stand-in synthesis takes in the two tests that act while one is running: long
 *  enough to catch the loop's second generation in flight, short enough that three are not a wait. */
const SLOW_SYNTH_SECONDS = 6;

/** Poll until something the routes say is true, or fail saying what never happened. */
async function until(what: string, probe: () => Promise<boolean>, timeoutMs = 180_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await probe()) return;
    if (Date.now() >= deadline) throw new Error(`${what} did not happen within ${String(timeoutMs)} ms`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

/**
 * The Run the window is showing on its list, once there is one. A test that starts a Campaign and
 * does not wait for it has no run id yet — the route answers with one only when the Run stops — so it
 * reads the id off the page, which is where a person reads it too.
 */
async function runIdOnTheList(d: BootedDriver, pack: string): Promise<string> {
  const opened = await d.open('/hima/');
  assert.ok(opened.ok, JSON.stringify(opened));
  const listed = await d.wait('runs', pack, 60_000);
  assert.ok(listed.ok, `wait runs: ${JSON.stringify(listed)}`);
  const id = /run-[0-9a-f-]+/.exec(listed.text)?.[0];
  assert.ok(id, `the list names the Run it is showing: ${listed.text}`);
  return id;
}

/** Every tmux session this Run launched, so a test that fails part way stops what it started. */
const sessionsIn = (records: readonly LedgerRecord[]): string[] =>
  records.filter((r) => r.type === 'job' && r.event === 'launched').map((r) => (r as JobRecord).job.session);

/** Is this record the launch of the loop's `generation`th synthesis? */
const launchedInLoop = (r: LedgerRecord, generation: number): r is JobRecord =>
  r.type === 'job' && r.event === 'launched' && r.loopId !== undefined && r.generation === generation;

test('a cancel inside the inner loop ends the whole Run, leaving that loop opened on record with what it had done intact', async (t) => {
  const d = await bootDriver(t, { home: 'hima', sleepSeconds: SLOW_SYNTH_SECONDS });
  if (!d) return;
  let sessions: string[] = [];
  try {
    const host = await d.host();
    assert.ok(host.ok, JSON.stringify(host));
    const cookie = await d.cookie();
    const pack = await installDrillDown(packsDirOf(d.home), 'drill-down', 6);

    // Started and not awaited: this route answers only when the Run stops, and the whole subject
    // here is what happens while it is still inside the loop.
    const starting = api(host, cookie, '/hima/api/runs', {
      method: 'POST',
      body: JSON.stringify({ pack, site: 'local', goal: { target_period_ns: 2.0 }, strategy: { periodNs: 2.0 } }),
      headers: { 'content-type': 'application/json' },
    });
    starting.catch(() => undefined);
    const runId = await runIdOnTheList(d, pack);

    // While the Run is inside the loop, the card says which loop that is (#28b): the region's `open`,
    // and the group's own head, which counts the generations it has got through so far and has no
    // ending to say. The page refreshes itself every second, so this is what a person is looking at.
    const card = await d.open(`/hima/?run=${encodeURIComponent(runId)}`);
    assert.ok(card.ok, JSON.stringify(card));
    const inside = await d.wait('run-loops', 'push: open', 60_000);
    assert.ok(inside.ok, `wait run-loops: ${JSON.stringify(inside)}`);
    assert.equal(inside.state.open, 'push', `the region names the loop the Run is inside: ${JSON.stringify(inside)}`);
    assert.equal(inside.state.count, '1', JSON.stringify(inside));
    assert.ok(inside.text.includes('still open'), `and the group has no ending to say yet: ${inside.text}`);

    let secondSession: string | undefined;
    await until('the loop reached its second generation with a job launched', async () => {
      const records = await recordsOf(host, cookie, runId);
      sessions = sessionsIn(records);
      secondSession = records.find((r) => launchedInLoop(r, 2))?.job.session;
      return secondSession !== undefined;
    });

    const cancelled = await api(host, cookie, `/hima/api/runs/${encodeURIComponent(runId)}/cancel`, { method: 'POST' });
    const cancelledText = await cancelled.text();
    assert.equal(cancelled.status, 200, cancelledText);
    const view = JSON.parse(cancelledText) as RunView;
    assert.equal(view.run.status, 'cancelled', cancelledText);
    assert.equal(view.run.meters?.endedBy, 'cancel');

    const records = await recordsOf(host, cookie, runId);
    sessions = sessionsIn(records);
    const loops = loopRecordsIn(records);
    assert.deepEqual(loops.map((r) => r.event), ['opened'], 'the loop is still open on record: nothing closed it');
    const killed = records.find((r) => r.type === 'job' && r.event === 'killed');
    assert.ok(killed, `the stop was observed and recorded: ${JSON.stringify(records.map((r) => r.type))}`);
    assert.equal((killed as JobRecord).job.session, secondSession, 'the job that was stopped is the loop\'s second generation\'s');
    assert.equal(killed.loopId, loops[0]?.loopId, 'and the record of the stop is nested under the loop');
    assert.deepEqual(
      [1, 2].map((g) => records.some((r) => r.loopId !== undefined && r.generation === g && r.type === 'node')),
      [true, true],
      'both of the loop\'s generations are still on record',
    );
    assert.equal(records.filter((r) => r.type === 'decision').length, 1, 'the one generation that finished decided');

    // The Campaign's generation one ran for the whole of this, the loop's second generation and the
    // stop that ended it included: an outer generation spans every record written while it was the
    // outer one, whatever loop the record was written inside. Counted by the header's generation
    // alone it would stop at the loop's first generation, because the records after that carry the
    // loop's own generation two and this Run never opened an outer one.
    const generationMs = view.run.meters?.generationMs;
    assert.equal(generationMs?.length, 1, `one outer generation, one entry: ${JSON.stringify(view.run.meters)}`);
    const firstRecord = records[0];
    assert.ok(firstRecord, 'the Run wrote records');
    const untilTheStop = Date.parse(killed.at) - Date.parse(firstRecord.at);
    assert.ok(
      (generationMs?.[0] ?? 0) >= untilTheStop,
      `the outer generation's ${String(generationMs?.[0])} ms reaches the stop recorded inside the loop's second generation, ${String(untilTheStop)} ms in`,
    );

    // The view says the loop is the one that is open, which is what the card's region will show.
    assert.deepEqual(loopsState(view), { count: '1', open: 'push' });
    assert.equal(view.generations[0]?.loops?.[0]?.outcome, undefined, 'a loop nothing closed came to nothing');

    const page = await d.open(`/hima/?run=${encodeURIComponent(runId)}`);
    assert.ok(page.ok, JSON.stringify(page));
    const status = await d.wait('run-status', 'cancelled by a person');
    assert.ok(status.ok, `wait run-status: ${JSON.stringify(status)}`);
    assert.deepEqual(d.unexpectedStdout(), []);
  } finally {
    killSessions(sessions);
    await d.dispose();
  }
});

test('a host taken away inside the inner loop is replaced by one that carries that loop on, launching nothing twice', async (t) => {
  const first = await bootDriver(t, { home: 'hima', sleepSeconds: SLOW_SYNTH_SECONDS });
  if (!first) return;
  let second: BootedDriver | undefined;
  let sessions: string[] = [];
  try {
    const host = await first.host();
    assert.ok(host.ok, JSON.stringify(host));
    const cookie = await first.cookie();
    const pack = await installDrillDown(packsDirOf(first.home), 'drill-down', 6);

    const starting = api(host, cookie, '/hima/api/runs', {
      method: 'POST',
      body: JSON.stringify({ pack, site: 'local', goal: { target_period_ns: 2.0 }, strategy: { periodNs: 2.0 } }),
      headers: { 'content-type': 'application/json' },
    });
    starting.catch(() => undefined);
    const runId = await runIdOnTheList(first, pack);

    await until('the loop reached its second generation with a job launched', async () => {
      const records = await recordsOf(host, cookie, runId);
      sessions = sessionsIn(records);
      return records.some((r) => launchedInLoop(r, 2));
    });

    // The window goes away. The dsh host goes with it; the tmux Job it launched does not.
    const quit = await first.quit();
    assert.ok(quit.ok, JSON.stringify(quit));
    await first.exit();
    await starting.catch(() => undefined);

    second = await bootDriver(t, { existing: first.home });
    assert.ok(second, 'the second boot answered');
    const later = await second.host();
    assert.ok(later.ok, JSON.stringify(later));
    const laterCookie = await second.cookie();

    await until('the run reached a final state under the second host', async () => {
      const view = await runViewOf(later, laterCookie, runId);
      return view.run.status !== undefined && view.run.status !== 'running';
    });
    const view = await runViewOf(later, laterCookie, runId);
    assert.equal(view.run.status, 'ended-goal-not-met', `the campaign reached the same ending as an uninterrupted one: ${JSON.stringify(view.run)}`);
    assert.equal(view.run.loop, undefined, 'and it left the loop on the way');

    const records = await recordsOf(later, laterCookie, runId);
    sessions = sessionsIn(records);
    const loops = loopRecordsIn(records);
    assert.deepEqual(loops.map((r) => r.event), ['opened', 'closed'], 'one loop, opened once and closed once');
    assert.equal(loops[1]?.outcome, 'converged');
    assert.equal(loops[1]?.generations, 3);
    assert.equal(sessions.length, 3, `one synthesis per inner generation and no more: ${JSON.stringify(sessions)}`);
    assert.equal(new Set(sessions).size, 3, 'each in its own tmux session');
    const secondGeneration = records.filter((r) => r.loopId !== undefined && r.generation === 2);
    assert.ok(
      secondGeneration.some((r) => r.type === 'node' && r.state === 'reconciled'),
      `a second host took the loop's second generation over: ${JSON.stringify(secondGeneration.map((r) => r.type))}`,
    );
    assert.deepEqual(second.unexpectedStdout(), []);
  } finally {
    killSessions(sessions);
    if (second) await second.dispose();
    await first.dispose();
  }
});

test('the served HimaGuide bundle carries the nested loop\'s rows, as the workbench page does', async (t) => {
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

    // The card has two mounts and one drill-down. Only spellings a minified React bundle cannot
    // satisfy by accident are asked for: the region's own name, and two words no other section of
    // the card says. ASCII only, because esbuild escapes every non-ASCII character in a literal —
    // the em dash of "closed \u2014 converged" is not in the served bundle as itself.
    assert.ok(source.includes('run-loops'), 'the chat\'s card marks the loops region the way the page does');
    assert.ok(source.includes('opened at '), 'and says where a nested loop was opened');
    assert.ok(source.includes('still open'), 'and what it says of one nothing has closed');
    assert.ok(source.includes(LEDGER_ORDER), 'and says what the order of its rows is, as the page does under its plot');
    assert.deepEqual(d.unexpectedStdout(), []);
  } finally {
    await d.dispose();
  }
});

// ---------------------------------------------------------------------------------------------
// The words a chat command says, which is the one thing the in-process host is still the seam for
// (D42): a command's answer is text a person reads, and no window renders it.
// ---------------------------------------------------------------------------------------------

test('/hima status says which loop a Run is inside and how far into it, and /hima pack check refuses a drill-down that cannot be executed', async (t) => {
  const local = await localFabric(t, { sleepSeconds: 1, failures: 1 });
  if (!local) return;
  const { h, host, dispose } = local;
  let sessions: string[] = [];
  try {
    const packsDir = packsDirOf(h);
    const pack = await installDrillDown(packsDir, 'drill-down', 6);

    // No retry allowance and a flow that fails once: the loop's first synthesis is a Hard blocker at
    // once, and the Run is routed to the wait node the *graph* declares, because this loop declares
    // none. The loop stays open on the row while a person is asked, which is what the run line says.
    const started = await himaCommand(
      host,
      h.workspace,
      `/hima run ${pack} --site local --goal target_period_ns=2.0 --set periodNs=2.0 --retries 0`,
      siteCommandTimeoutMs,
    );
    const runId = started.runId;
    assert.ok(runId, started.text);
    sessions = sessionsOf(host, runId);
    const status = await himaCommand(host, h.workspace, `/hima status ${runId}`);
    assert.equal(status.kind, 'success', status.text);
    assert.match(status.text, /: waiting, generation 1 of at most 6, in loop push at generation 1$/m, `the run line says which loop it is inside: ${status.text}`);
    assert.match(status.text, /^ {2}current node: blocked$/m, `and that it waits at the graph's own wait node: ${status.text}`);

    // An explore node that names a chooser and opens a loop: two different things for one node to be,
    // refused when the pack is loaded — which is how every other way a pack can contradict itself is
    // refused, and which a person meets as the load's own message.
    await writePackVariant(packsDir, 'chooses-and-opens', []);
    await writeFile(
      path.join(packsDir, 'chooses-and-opens', 'graph.yml'),
      drillDownGraph('chooses-and-opens', 6).replace('      opens: push\n', '      opens: push\n      chooser: timing-push\n'),
    );
    await assert.rejects(
      himaCommand(host, h.workspace, '/hima pack check chooses-and-opens --site local'),
      /gives explore node "probe" both chooser "timing-push" and `opens: push`: an explore node either applies a chooser and decides, or opens a loop and drills down, and states exactly one of the two/,
      'the refusal names the node and what an explore node may be',
    );

    // A loop whose own explore node opens a loop: drill-down goes one level in step 3, and a pack
    // that asks for two is refused where the file can still be read.
    await writePackVariant(packsDir, 'opens-twice', []);
    await writeFile(
      path.join(packsDir, 'opens-twice', 'graph.yml'),
      drillDownGraph('opens-twice', 6).replace('          chooser: over-constraining-push\n', '          opens: push\n'),
    );
    await assert.rejects(
      himaCommand(host, h.workspace, '/hima pack check opens-twice --site local'),
      /has explore node "next-period" of loop "push" open loop "push": a loop's explore node applies a chooser, because drill-down goes one level and no further/,
      'the refusal names the node, its loop, and why there is no second level',
    );
  } finally {
    killSessions(sessions);
    await dispose();
  }
});

test('/hima pack check refuses a drill-down whose edges the engine could never take, and a graph that says twice where its runs wait', async (t) => {
  const local = await localFabric(t, {});
  if (!local) return;
  const { h, host, dispose } = local;
  try {
    const packsDir = packsDirOf(h);
    /** The drill-down graph with one thing about it changed, installed under its own id. */
    const variant = async (id: string, change: (graph: string) => string): Promise<void> => {
      await writePackVariant(packsDir, id, []);
      await writeFile(path.join(packsDir, id, 'graph.yml'), change(drillDownGraph(id, 6)));
    };

    // An edge out of the opening explore node with no outcome on it. It loads as a route a person
    // would read in the file — probe leads to final-read — and the engine, which leaves that node
    // only on the edge its loop's outcome labels, would never take it: the loop would close and the
    // Run would end as though the node drew no edge at all.
    await variant('unlabelled-outcome', (g) => g.replace('  - { from: probe, to: final-read, outcome: converged }\n', '  - { from: probe, to: final-read }\n'));
    await assert.rejects(
      himaCommand(host, h.workspace, '/hima pack check unlabelled-outcome --site local'),
      /draws an edge in its graph from explore node "probe" to "final-read" with no outcome on it: that node opens a loop and is left on the edge its loop closed with, so every edge out of it carries one of "goal-met", "converged", "generation-limit"/,
      'the refusal names the node, the edge, and the three outcomes an opening node\'s edges carry',
    );

    // A revisit edge out of the opening explore node. That node revisits nothing itself — the loop
    // it opens carries its own revisit edge — so a `revisit: true` here is a way back the file shows
    // and the engine never takes.
    await variant('probe-revisits', (g) => g.replace('  - { from: probe, to: final-read, outcome: converged }', '  - { from: probe, to: final-read, outcome: converged, revisit: true }'));
    await assert.rejects(
      himaCommand(host, h.workspace, '/hima pack check probe-revisits --site local'),
      /gives explore node "probe" in its graph a revisit edge to "final-read": an explore node that opens a loop revisits nothing itself/,
      'the refusal names the node, where its revisit edge leads, and why an opening node revisits nothing',
    );

    // Two edges out of one node labelled the same. The engine takes the first that matches, so which
    // of them a converged loop leads along would be the order the lines happen to be written in.
    await variant('two-converged', (g) => g.replace('  - { from: probe, to: blocked, outcome: generation-limit }', '  - { from: probe, to: blocked, outcome: converged }'));
    await assert.rejects(
      himaCommand(host, h.workspace, '/hima pack check two-converged --site local'),
      /draws two edges in its graph out of "probe" labelled "converged", to "final-read" and to "blocked": one outcome leads one way/,
      'the refusal names the node, the label, and both places it leads',
    );

    // Two wait nodes in one graph. Nothing draws an edge to a wait node — the engine routes a Hard
    // blocker there — so a graph declaring two says nothing about which one a person is sent to.
    await variant('two-wait-nodes', (g) => g.replace('\nedges:\n  - { from: probe', '\n  - id: also-blocked\n    kind: wait\n    parameters:\n      blocker: hard-blocker\n\nedges:\n  - { from: probe'));
    await assert.rejects(
      himaCommand(host, h.workspace, '/hima pack check two-wait-nodes --site local'),
      /declares 2 wait nodes in its graph, "blocked" and "also-blocked": a graph declares at most one/,
      'the refusal names both wait nodes',
    );
  } finally {
    await dispose();
  }
});
