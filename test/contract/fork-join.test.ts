// Ticket #29: fork and join. Several unlabelled edges out of one node run those act nodes at once,
// each branch with its own Jobs and its own records, and a judge node with several incoming edges
// waits for every branch and judges all their observations (D29).
//
// The Site's parallel job cap decides how many really run at once (D33): a cap of two on the local
// stand-in proves the branches concurrent, and a cap of one proves the same graph runs them one
// after the other with a `waiting-for-slot` record on the second — which is what the reference site,
// whose cap is one, will do.
//
// Driven through the desktop shell in driver mode (D42, ADR-0004), which is the one seam every
// step-3 test boots through: the Run is started over the routes with the session the shell
// established, and what is asserted is what the ledger holds and what the routes answer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { chmod, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { bootDriver } from './support/driver.ts';
import { api } from './support/hima-api.ts';
import { killSessions, localFabric, sessionsOf } from './support/fabric.ts';
import { himaCommand, siteCommandTimeoutMs } from './support/command.ts';
import { forkGraph, installFork, packsDirOf, writePackVariant } from './support/pack.ts';
import { findOnPath, killSession } from './support/tmux.ts';
import type { BootedDriver } from './support/driver.ts';
import { branchJobsSaid, branchStateLabel, FORK_RULE, joinSaid } from '@hima/harness';
import type { BranchView, CancelRecord, JobRecord, LedgerRecord, NodeRecord, RunView, VerdictRecord } from '@hima/harness';

/** Every record of one Run, exactly as the ledger holds it, over the route the window reads. */
async function recordsOf(host: { readonly url: string }, cookie: string, runId: string): Promise<LedgerRecord[]> {
  const answer = await api(host, cookie, `/hima/api/runs/${encodeURIComponent(runId)}/records`);
  const text = await answer.text();
  assert.equal(answer.status, 200, text);
  return (JSON.parse(text) as { readonly records: LedgerRecord[] }).records;
}

const jobsIn = (records: readonly LedgerRecord[]): JobRecord[] => records.filter((r): r is JobRecord => r.type === 'job');
const nodesIn = (records: readonly LedgerRecord[]): NodeRecord[] => records.filter((r): r is NodeRecord => r.type === 'node');
const verdictsIn = (records: readonly LedgerRecord[]): VerdictRecord[] => records.filter((r): r is VerdictRecord => r.type === 'verdict');
const sessionsIn = (records: readonly LedgerRecord[]): string[] =>
  jobsIn(records).filter((r) => r.event === 'launched').map((r) => r.job.session);

/** One row of the generation ledger as the page wrote it: which kind of row it is, and the branch of
 *  a fork it says it belongs to. */
interface LedgerRowOnPage { readonly kind: 'generation' | 'branch' | 'join'; readonly branch?: string }

/**
 * Every row of the generation ledger, in the order the page's own HTML has them, with the text of
 * each.
 *
 * Read out of the markup and not off the text the region flattens to, because "the branches are rows
 * of their own under the row that forked" is a fact about the page's structure: a card that rendered
 * one forked generation and left its branches out — or flattened their numbers into the row above —
 * would flatten to text a `includes` check could still be satisfied by.
 *
 * The `<tbody>` of the ledger inside the branches region, so the head of the table is not a row and
 * the path table below it is not read at all.
 */
function ledgerRowsOn(html: string): (LedgerRowOnPage & { readonly text: string })[] {
  const body = /<div data-hima-region="run-branches"[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/.exec(html);
  assert.ok(body, 'the page marks the branches region and the ledger inside it');
  return [...(body[1] ?? '').matchAll(/<tr\b([^>]*)>([\s\S]*?)<\/tr>/g)].map((row) => {
    const attributes = row[1] ?? '';
    const branch = /data-hima-branch="([^"]+)"/.exec(attributes)?.[1];
    const classes = (/class="([^"]*)"/.exec(attributes)?.[1] ?? '').split(/\s+/);
    const kind = classes.includes('in-fork') ? 'branch' : (classes.includes('fork-join') ? 'join' : 'generation');
    // The rendered text of the row, as a person reads it: the tags out, the entities a card writes
    // back, and the runs of space the markup's own newlines leave collapsed.
    const text = (row[2] ?? '').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
    return { kind, ...(branch === undefined ? {} : { branch }), text };
  });
}

/** What one branch of a fork read, as the route answers it: the value of that type in the branch's
 *  own latest observation, which is the number its row on the card must show and no other's. */
const readOf = (branch: BranchView | undefined, type: string): number | undefined =>
  branch?.observation?.values.findLast((v) => v.type === type && v.value !== null)?.value ?? undefined;

test('a fork under a job cap of two runs both branches at once, and the join judges each branch\'s own reading', async (t) => {
  const d = await bootDriver(t, { home: 'hima', parallelJobs: 2, sleepSeconds: 4 });
  if (!d) return;
  let sessions: string[] = [];
  try {
    const host = await d.host();
    assert.ok(host.ok, JSON.stringify(host));
    const cookie = await d.cookie();
    // 2.00 ns is tighter than this stand-in closes at (2.20), so branch one misses setup by 0.20;
    // branch two asks for 2.20 and makes it exactly. One branch's constraint failed, so the join's
    // is FAIL — the rule being that a fork passes only when every branch does.
    const pack = await installFork(packsDirOf(d.home), 'fork-join', 2.2);

    const started = await api(host, cookie, '/hima/api/runs', {
      method: 'POST',
      body: JSON.stringify({ pack, site: 'local', goal: { target_period_ns: 2.0 }, strategy: { periodNs: 2.0 } }),
      headers: { 'content-type': 'application/json' },
    });
    const startedText = await started.text();
    assert.equal(started.status, 200, startedText);
    const view = JSON.parse(startedText) as RunView;
    const runId = view.run.id;
    assert.equal(view.run.status, 'ended-goal-not-met', `the graph ran out of edges at the join: ${startedText}`);
    assert.equal(view.run.fork, undefined, 'the fork closed before the join judged');

    const records = await recordsOf(host, cookie, runId);
    sessions = sessionsIn(records);
    const launched = jobsIn(records).filter((r) => r.event === 'launched');
    assert.equal(launched.length, 2, `one job per branch and no more: ${JSON.stringify(jobsIn(records).map((r) => `${r.event} ${r.nodeId ?? '?'}`))}`);
    const settled = jobsIn(records).find((r) => r.event !== 'launched');
    assert.ok(settled, 'a job settled');
    assert.ok(
      launched.every((r) => r.seq < settled.seq),
      `both branches had a job on the site at once: launched at ${JSON.stringify(launched.map((r) => r.seq))}, the first one settled at ${settled.seq}`,
    );
    assert.deepEqual(launched.map((r) => r.branchId), ['synthesize', 'synth-b'], 'each launch says which branch it belongs to');

    // Every record a branch wrote carries that branch, and the branch id is the branch's first node.
    const branchOf = new Map<string, string>([['synthesize', 'synthesize'], ['read-qor', 'synthesize'], ['synth-b', 'synth-b'], ['read-qor-b', 'synth-b']]);
    for (const node of nodesIn(records)) {
      assert.equal(node.branchId, branchOf.get(node.nodeId), `node record of ${node.nodeId} names its branch`);
    }

    // The join judged each branch's latest observation: one verdict per rule per branch, each citing
    // its own branch's reading and no other's.
    const verdicts = verdictsIn(records);
    assert.equal(verdicts.length, 4, `two rules over two branches: ${JSON.stringify(verdicts.map((v) => `${v.ruleId} ${v.outcome} ${v.branchId ?? '?'}`))}`);
    const observationOf = new Map(
      records.filter((r) => r.type === 'observation' && r.branchId !== undefined).map((r) => [(r as { branchId?: string }).branchId, r.id]),
    );
    for (const verdict of verdicts) {
      assert.ok(verdict.branchId, `verdict of ${verdict.ruleId} names its branch`);
      assert.deepEqual(verdict.cites, [observationOf.get(verdict.branchId)], `verdict of ${verdict.ruleId} cites its own branch's observation`);
    }
    assert.deepEqual(
      verdicts.map((v) => [v.branchId, v.ruleId, v.outcome]),
      [
        ['synthesize', 'setup-wns-all-nonnegative', 'FAIL'],
        ['synthesize', 'clock-period-at-most', 'PASS'],
        ['synth-b', 'setup-wns-all-nonnegative', 'PASS'],
        ['synth-b', 'clock-period-at-most', 'FAIL'],
      ],
      'each branch was judged on its own reading',
    );
    const join = nodesIn(records).findLast((r) => r.nodeId === 'judge');
    assert.equal(join?.state, 'done');
    assert.equal(join?.outcome, 'FAIL', 'a fork passes only when every branch passes; one branch failed the constraint');

    // The run view carries the branches under the generation they ran in, each with its own reading.
    const branches = view.generations[0]?.branches;
    // And the join beside them, on the generation whose branches converged into it: the judge node
    // it is and the outcome that judge settled on. On the generation and not on the Run's path,
    // which holds one entry per node — a pack that forked twice would have one answer there for two
    // forks, and a face saying "the join concluded" would say the later one over the earlier.
    assert.deepEqual(
      view.generations[0]?.join,
      { nodeId: 'judge', outcome: 'FAIL' },
      `the forked generation names its own join and what that join concluded: ${JSON.stringify(view.generations[0]?.join)}`,
    );
    assert.equal(branches?.length, 2, `the generation carries its two branches: ${JSON.stringify(view.generations[0])}`);
    assert.deepEqual(branches?.map((b) => b.id), ['synthesize', 'synth-b']);
    assert.deepEqual(branches?.map((b) => b.state), ['done', 'done']);
    assert.deepEqual(
      branches?.map((b) => [b.observedPeriodNs, b.observation?.values.findLast((v) => v.type === 'clock_period')?.value]),
      [[2, 2], [2.2, 2.2]],
      'each branch row carries the period its own report stated, folded from that branch\'s own reading',
    );
    // The meters count what happened, and both branches happened: two launches, and one attempt per
    // node turn that opened. Two branches counting against one row at the same moment is exactly
    // what a meter composed outside the ledger's own write would lose.
    const running = nodesIn(records).filter((r) => r.state === 'running');
    assert.equal(view.run.meters?.jobsLaunched, 2, `one job counted per branch: ${JSON.stringify(view.run.meters)}`);
    assert.equal(
      view.run.meters?.attempts,
      running.length,
      `one attempt counted per node turn: ${JSON.stringify(running.map((r) => `${r.nodeId}/${String(r.attempt)}`))} against ${JSON.stringify(view.run.meters)}`,
    );

    // And the generation's own row carries neither: two branches read two reports at two periods, so
    // there is no one reading the generation took, and the row does not pick whichever branch read
    // last (#29).
    assert.equal(view.generations[0]?.observedPeriodNs, undefined, 'a forked generation states no measured period of its own');
    assert.equal(view.generations[0]?.slackNs, undefined, 'nor a slack of its own');

    // And the card shows them: the branches as rows of the generation ledger under the row that
    // forked, each with its own reading, and the join's line under them all (#29b).
    const opened = await d.open(`/hima/?run=${encodeURIComponent(runId)}`);
    assert.ok(opened.ok, JSON.stringify(opened));
    const region = await d.read('run-branches');
    assert.ok(region.ok, `read run-branches: ${JSON.stringify(region)}`);
    assert.deepEqual(region.state, { count: '2', open: '' }, 'two branches, and no fork left open');
    for (const branch of branches ?? []) {
      // The three parts a command line joins into one line (`branchSaid`), which the card sets one
      // under another in its narrow first column: the branch, what it is doing, and its jobs.
      for (const part of [branch.id, branchStateLabel[branch.state].said, branchJobsSaid(branch)]) {
        assert.ok(region.text.includes(part), `the ledger says "${part}" of branch ${branch.id}: ${region.text}`);
      }
    }
    assert.ok(region.text.includes(joinSaid(view.generations[0]?.join, branches ?? [])), `and what the join concluded over both: ${region.text}`);

    // The nesting itself, in the page's own markup: the same page over the route with the session
    // the shell established. The branches are rows the page says belong to *this* branch and no
    // other, in the order the graph draws them, under a row that belongs to none and over the join's
    // line. A regression that flattened the fork away would read much the same and would fail here.
    const rendered = await api(host, cookie, `/hima/?run=${encodeURIComponent(runId)}`);
    const html = await rendered.text();
    assert.equal(rendered.status, 200, html.slice(0, 400));
    const onPage = ledgerRowsOn(html);
    assert.deepEqual(
      onPage.map(({ kind, branch }) => ({ kind, ...(branch === undefined ? {} : { branch }) })),
      [{ kind: 'generation' }, { kind: 'branch', branch: 'synthesize' }, { kind: 'branch', branch: 'synth-b' }, { kind: 'join' }],
      'the forked row, its two branches\' rows in the order the graph draws them, and the join under them',
    );
    // Each branch row carries that branch's own numbers, which are the ones the route answers with:
    // 2 ns and 2.2 ns are two readings of two reports, and a row showing the other branch's would be
    // this card saying one branch measured what the other did.
    for (const branch of branches ?? []) {
      const row = onPage.find((r) => r.branch === branch.id);
      assert.ok(row, `branch ${branch.id} has a row of its own`);
      assert.ok(row.text.includes(String(readOf(branch, 'clock_period'))), `and it shows the period that branch read: ${row.text}`);
      assert.ok(row.text.includes(String(readOf(branch, 'setup_wns'))), `and the slack it closed with: ${row.text}`);
      for (const verdict of branch.verdicts) {
        assert.ok(row.text.includes(verdict.ruleId), `and what the join concluded of it, rule by rule: ${row.text}`);
      }
    }
    assert.deepEqual(d.unexpectedStdout(), []);
  } finally {
    killSessions(sessions);
    await d.dispose();
  }
});

test('the same fork under a job cap of one runs its branches one after the other, and says which one was waiting for a slot', async (t) => {
  const d = await bootDriver(t, { home: 'hima', parallelJobs: 1, sleepSeconds: 3 });
  if (!d) return;
  let sessions: string[] = [];
  try {
    const host = await d.host();
    assert.ok(host.ok, JSON.stringify(host));
    const cookie = await d.cookie();
    const pack = await installFork(packsDirOf(d.home), 'fork-join-one-slot', 2.2);

    const started = await api(host, cookie, '/hima/api/runs', {
      method: 'POST',
      body: JSON.stringify({ pack, site: 'local', goal: { target_period_ns: 2.0 }, strategy: { periodNs: 2.0 } }),
      headers: { 'content-type': 'application/json' },
    });
    const startedText = await started.text();
    assert.equal(started.status, 200, startedText);
    const view = JSON.parse(startedText) as RunView;
    assert.equal(view.run.status, 'ended-goal-not-met', `the same graph reaches the same ending on one slot: ${startedText}`);
    assert.equal(view.run.fork, undefined);

    const records = await recordsOf(host, cookie, view.run.id);
    sessions = sessionsIn(records);
    const launched = jobsIn(records).filter((r) => r.event === 'launched');
    assert.equal(launched.length, 2, 'both branches still ran');
    // One at a time: the second branch's launch is after the first branch's job settled.
    const first = launched[0];
    const second = launched[1];
    assert.ok(first && second);
    const settledFirst = jobsIn(records).find((r) => r.event !== 'launched' && r.job.session === first.job.session);
    assert.ok(settledFirst, 'the first branch\'s job settled');
    assert.ok(settledFirst.seq < second.seq, `the second branch launched only once the first was over: ${settledFirst.seq} then ${second.seq}`);

    const queued = nodesIn(records).filter((r) => r.state === 'waiting-for-slot');
    assert.equal(queued.length, 1, `one branch queued behind the site: ${JSON.stringify(nodesIn(records).map((r) => `${r.nodeId} ${r.state}`))}`);
    assert.equal(queued[0]?.branchId, second.branchId, 'and it is the branch that launched second');
    assert.match(queued[0]?.reason ?? '', /site local is running 1 job against a cap of 1; this node waits for a slot/);

    // The join still judged both branches, and the run view still carries both.
    assert.equal(verdictsIn(records).length, 4);
    assert.equal(view.generations[0]?.branches?.length, 2);
    assert.deepEqual(view.generations[0]?.branches?.map((b) => b.state), ['done', 'done']);

    // And the card says which branch queued behind the Site, in the words the engine wrote at the
    // time rather than in a sentence of the card's own (#29b). A person watching a fork that is
    // taking a long time is looking for exactly this, and once the Run has ended it is nowhere else
    // on the page: the node it happened at reads `done` by then.
    const rendered = await api(host, cookie, `/hima/?run=${encodeURIComponent(view.run.id)}`);
    const html = await rendered.text();
    assert.equal(rendered.status, 200, html.slice(0, 400));
    const waited = ledgerRowsOn(html).find((r) => r.branch === queued[0]?.branchId);
    assert.ok(waited, `the branch that queued has a row of its own: ${JSON.stringify(ledgerRowsOn(html).map((r) => r.branch ?? r.kind))}`);
    assert.ok(waited.text.includes('this node waits for a slot'), `and it says it waited behind the site: ${waited.text}`);
    assert.deepEqual(d.unexpectedStdout(), []);
  } finally {
    killSessions(sessions);
    await d.dispose();
  }
});

test('a branch that spends its allowance blocks only itself, and a resume re-enters that branch alone', async (t) => {
  // The second branch's tool fails once, and one attempt is all this Run allows: that branch is a
  // Hard blocker at once while the first branch runs to the join.
  const d = await bootDriver(t, { home: 'hima', parallelJobs: 2, sleepSeconds: 2, failuresByTag: { b: 1 } });
  if (!d) return;
  let sessions: string[] = [];
  try {
    const host = await d.host();
    assert.ok(host.ok, JSON.stringify(host));
    const cookie = await d.cookie();
    const pack = await installFork(packsDirOf(d.home), 'fork-join-blocked', 2.2);

    const started = await api(host, cookie, '/hima/api/runs', {
      method: 'POST',
      body: JSON.stringify({ pack, site: 'local', goal: { target_period_ns: 2.0 }, strategy: { periodNs: 2.0 }, retries: 1 }),
      headers: { 'content-type': 'application/json' },
    });
    const startedText = await started.text();
    assert.equal(started.status, 200, startedText);
    const waiting = JSON.parse(startedText) as RunView;
    const runId = waiting.run.id;
    assert.equal(waiting.run.status, 'waiting', `one branch blocked, so the run waits for a person: ${startedText}`);
    assert.equal(waiting.run.currentNode, 'judge', 'the run stands at the join, not at the pack\'s wait node');
    assert.deepEqual(
      waiting.run.fork?.branches,
      { synthesize: { currentNode: 'judge', state: 'done' }, 'synth-b': { currentNode: 'synth-b', state: 'blocked' } },
      `the fork is left exactly as a resume re-enters it: ${JSON.stringify(waiting.run.fork)}`,
    );
    const blocker = waiting.blockers.at(-1);
    assert.equal(blocker?.nodeId, 'synth-b');
    const blocking = await recordsOf(host, cookie, runId);
    sessions = sessionsIn(blocking);
    const blockerRecord = blocking.findLast((r) => r.type === 'blocker');
    assert.equal((blockerRecord as { branchId?: string } | undefined)?.branchId, 'synth-b', 'the blocker names the branch a person is being asked about');
    assert.equal(verdictsIn(blocking).length, 0, 'the join has judged nothing: it waits for every branch');
    assert.deepEqual(waiting.generations[0]?.branches?.map((b) => [b.id, b.state]), [['synthesize', 'done'], ['synth-b', 'blocked']]);

    // A person clears it. The branch is re-entered with a fresh allowance; the branch that finished
    // is not run again, and the join then judges both.
    const resumed = await api(host, cookie, `/hima/api/runs/${encodeURIComponent(runId)}/resume`, { method: 'POST' });
    const resumedText = await resumed.text();
    assert.equal(resumed.status, 200, resumedText);
    const view = JSON.parse(resumedText) as RunView;
    assert.equal(view.run.status, 'ended-goal-not-met', `the fork went on and the run reached its ending: ${resumedText}`);
    assert.equal(view.run.fork, undefined, 'and the fork closed');

    const records = await recordsOf(host, cookie, runId);
    sessions = sessionsIn(records);
    const perBranch = jobsIn(records).filter((r) => r.event === 'launched').map((r) => r.branchId);
    assert.deepEqual(perBranch, ['synthesize', 'synth-b', 'synth-b'], 'the first branch synthesized once; the second twice, its failure and its retry');
    assert.equal(verdictsIn(records).length, 4, 'the join judged both branches once the second cleared');
    assert.deepEqual(view.generations[0]?.branches?.map((b) => b.state), ['done', 'done']);
    assert.deepEqual(d.unexpectedStdout(), []);
  } finally {
    killSessions(sessions);
    await d.dispose();
  }
});

// ---------------------------------------------------------------------------------------------
// A Campaign a person stops while both its branches are on the Site, and one whose host goes away
// there. Both act while two Jobs are running, which is what makes them about the fork rather than
// about one act node: two stops have to be observed, and two Jobs have to be picked up again.
// ---------------------------------------------------------------------------------------------

/** How long each stand-in synthesis takes in the two tests that act while both are running: long
 *  enough to catch the fork in flight, short enough that the whole Campaign is not a wait. */
const SLOW_SYNTH_SECONDS = 8;

/** Poll until something the routes say is true, or fail saying what never happened. */
async function until(what: string, probe: () => Promise<boolean>, timeoutMs = 180_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await probe()) return;
    if (Date.now() >= deadline) throw new Error(`${what} did not happen within ${String(timeoutMs)} ms`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

/** One Run as the window and the routes both read it. */
async function runViewOf(host: { readonly url: string }, cookie: string, runId: string): Promise<RunView> {
  const answer = await api(host, cookie, `/hima/api/runs/${encodeURIComponent(runId)}`);
  const text = await answer.text();
  assert.equal(answer.status, 200, text);
  return JSON.parse(text) as RunView;
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

test('a cancel while both branches hold a job stops both of them, and records each stop', async (t) => {
  const d = await bootDriver(t, { home: 'hima', parallelJobs: 2, sleepSeconds: SLOW_SYNTH_SECONDS });
  if (!d) return;
  let sessions: string[] = [];
  try {
    const host = await d.host();
    assert.ok(host.ok, JSON.stringify(host));
    const cookie = await d.cookie();
    const pack = await installFork(packsDirOf(d.home), 'fork-join-cancel', 2.2);

    // Started and not awaited: this route answers only when the Run stops, and the whole subject
    // here is what happens while both branches are still on the Site.
    const starting = api(host, cookie, '/hima/api/runs', {
      method: 'POST',
      body: JSON.stringify({ pack, site: 'local', goal: { target_period_ns: 2.0 }, strategy: { periodNs: 2.0 } }),
      headers: { 'content-type': 'application/json' },
    });
    starting.catch(() => undefined);
    const runId = await runIdOnTheList(d, pack);

    await until('both branches had a job launched', async () => {
      const records = await recordsOf(host, cookie, runId);
      sessions = sessionsIn(records);
      return sessions.length === 2;
    });

    // The card while the fork is open, which is what a person watching one is looking at: the region
    // counts the branches and names the join the Run is standing at until every one of them reaches
    // it (#29b).
    const opened = await d.open(`/hima/?run=${encodeURIComponent(runId)}`);
    assert.ok(opened.ok, JSON.stringify(opened));
    const inFlight = await d.wait('run-branches', 'running', 60_000);
    assert.ok(inFlight.ok, `wait run-branches: ${JSON.stringify(inFlight)}`);
    assert.deepEqual(inFlight.state, { count: '2', open: 'judge' }, 'both branches, and the join they have not reached');

    const cancelled = await api(host, cookie, `/hima/api/runs/${encodeURIComponent(runId)}/cancel`, { method: 'POST' });
    const cancelledText = await cancelled.text();
    assert.equal(cancelled.status, 200, cancelledText);
    const view = JSON.parse(cancelledText) as RunView;
    assert.equal(view.run.status, 'cancelled', cancelledText);
    assert.equal(view.run.meters?.endedBy, 'cancel');

    const records = await recordsOf(host, cookie, runId);
    sessions = sessionsIn(records);
    const killed = jobsIn(records).filter((r) => r.event === 'killed');
    assert.equal(killed.length, 2, `one stop observed per branch: ${JSON.stringify(jobsIn(records).map((r) => `${r.event} ${r.branchId ?? '?'}`))}`);
    assert.deepEqual([...killed.map((r) => r.branchId)].sort(), ['synth-b', 'synthesize'], 'and each stop says which branch it was');
    assert.deepEqual(
      [...new Set(killed.map((r) => r.job.session))].sort(),
      [...sessions].sort(),
      'the two stops are the two jobs the two branches launched',
    );
    // And the one `cancel` record names every session it stopped, not one of them. That is what each
    // branch's own waiting loop asks — "is my job one this cancel is stopping?" — and a record that
    // named one of two would have the other branch conclude somebody else was stopping a job nobody
    // had seen, and leave it running on the site (#29).
    const request = records.findLast((r): r is CancelRecord => r.type === 'cancel');
    assert.ok(request, 'the person\'s request is on record');
    assert.deepEqual([...(request.jobSessions ?? [])].sort(), [...sessions].sort(), `the cancel names both jobs it stopped: ${JSON.stringify(request)}`);
    assert.equal(request.jobSession, request.jobSessions?.[0], 'and the single session every face names is the head of that list');
    // The fork is left open on record, exactly as a Loop a cancel interrupted is: the Run really was
    // stopped inside it, and its own `cancelled` is the last word.
    assert.equal(view.run.fork?.join, 'judge', `the run was cancelled inside the fork: ${JSON.stringify(view.run.fork)}`);
    assert.equal(verdictsIn(records).length, 0, 'the join judged nothing');

    // And the card's cancel section names every session the request stopped, not one of two: a
    // person reading a cancelled fork is reading whether the Site is clear, and a face that named
    // one Job of two would say a licence was free while the other branch still held it (#29b).
    const stops = await d.wait('run-cancel', 'a person asked this run to stop', 30_000);
    assert.ok(stops.ok, `wait run-cancel: ${JSON.stringify(stops)}`);
    for (const session of sessions) {
      assert.ok(stops.text.includes(session), `the cancel section names session ${session}: ${stops.text}`);
    }
    assert.equal(stops.state.observed, 'killed', `and says both stops were observed: ${JSON.stringify(stops.state)}`);
    assert.deepEqual(d.unexpectedStdout(), []);
  } finally {
    killSessions(sessions);
    await d.dispose();
  }
});

test('a host taken away while both branches hold a job is replaced by one that picks both up, launching nothing twice', async (t) => {
  const first = await bootDriver(t, { home: 'hima', parallelJobs: 2, sleepSeconds: SLOW_SYNTH_SECONDS });
  if (!first) return;
  let second: BootedDriver | undefined;
  let sessions: string[] = [];
  try {
    const host = await first.host();
    assert.ok(host.ok, JSON.stringify(host));
    const cookie = await first.cookie();
    const pack = await installFork(packsDirOf(first.home), 'fork-join-restart', 2.2);

    const starting = api(host, cookie, '/hima/api/runs', {
      method: 'POST',
      body: JSON.stringify({ pack, site: 'local', goal: { target_period_ns: 2.0 }, strategy: { periodNs: 2.0 } }),
      headers: { 'content-type': 'application/json' },
    });
    starting.catch(() => undefined);
    const runId = await runIdOnTheList(first, pack);

    await until('both branches had a job launched', async () => {
      const records = await recordsOf(host, cookie, runId);
      sessions = sessionsIn(records);
      return sessions.length === 2;
    });

    // The window goes away. The dsh host goes with it; the two tmux Jobs it launched do not.
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
    assert.equal(view.run.fork, undefined, 'and it left the fork on the way');

    const records = await recordsOf(later, laterCookie, runId);
    sessions = sessionsIn(records);
    assert.equal(sessions.length, 2, `one synthesis per branch and no more: ${JSON.stringify(sessions)}`);
    assert.equal(new Set(sessions).size, 2, 'each in its own tmux session');
    const reconciled = nodesIn(records).filter((r) => r.state === 'reconciled');
    assert.deepEqual(
      [...reconciled.map((r) => r.branchId)].sort(),
      ['synth-b', 'synthesize'],
      `a second host took both branches over: ${JSON.stringify(nodesIn(records).map((r) => `${r.nodeId} ${r.state}`))}`,
    );
    assert.equal(verdictsIn(records).length, 4, 'and the join judged both branches under the second host');
    assert.deepEqual(second.unexpectedStdout(), []);
  } finally {
    killSessions(sessions);
    if (second) await second.dispose();
    await first.dispose();
  }
});

// ---------------------------------------------------------------------------------------------
// A Site that stops answering while a fork has a Job open. Ticket #18's rule — a fault that cannot
// be recorded without leaving a Job of ours unattended is raised and nothing is written — read over
// a fork, where the Run stands at the join and the Jobs are in the branches.
// ---------------------------------------------------------------------------------------------

/** How long a test holds still after the fault, asserting nothing was written. The swallowed fault
 *  would be recorded in the same instant it was swallowed, so a stretch this long with the row
 *  untouched is the assertion; three seconds is an order of magnitude more than that write costs. */
const faultSettleMs = 3_000;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * A `tmux` in front of this machine's own that answers everything except the fork's second branch's
 * launch, which dies unheard.
 *
 * `kill -9 $$` is how a command comes back with no exit status at all, which is exactly what the
 * channel's own timeout produces for a launch that hangs — it `SIGKILL`s the child and reads the
 * same `code === null` — reached in milliseconds instead of holding this suite for the sixty seconds
 * a real hang would (#18's tests shadow tmux the same way, and `findOnPath` is shared with them).
 * A launch that was sent and never answered is the one Site fault the harness deliberately lets out
 * of a node's turn: retrying it would start a second Job under a fresh session name, over the cap
 * and with nobody watching either, so it is left to the drive's fault boundary — which is what this
 * test is about.
 *
 * Narrowed to `RESULT_TAG=b`, which is branch `synth-b`'s own tool and nothing else on this Site, so
 * one branch's launch fails and the other's really runs. In *front* of the machine's PATH rather
 * than replacing it: everything this shim does not care about goes through to the real tmux, and the
 * tmux server the other branch's launch starts inherits this PATH and needs the machine's `make`.
 *
 * `process.env.PATH` is what the shell's own environment is taken from when `bootDriver` makes the
 * home, so this is installed before the boot and put back however the test ends.
 */
async function tmuxThatCannotLaunchBranchB(): Promise<{ restore(): Promise<void> }> {
  const dir = path.join('/tmp', `hima-${randomBytes(4).toString('hex')}-bin`);
  await mkdir(dir, { recursive: true });
  const saved = process.env.PATH ?? '';
  const real = findOnPath('tmux', saved);
  if (!real) {
    await rm(dir, { recursive: true, force: true });
    throw new Error('this machine has no "tmux" on its PATH, and this shadow passes every other command through to it');
  }
  const tmux = path.join(dir, 'tmux');
  // Written and only then made executable: a mode given to `writeFile` applies only when it creates
  // the file.
  await writeFile(tmux, `#!/bin/sh\nif [ "$1" = "new-session" ]; then\n  case " $* " in *RESULT_TAG=b*) kill -9 $$ ;; esac\nfi\nexec '${real}' "$@"\n`);
  await chmod(tmux, 0o755);
  process.env.PATH = `${dir}:${saved}`;
  return {
    async restore(): Promise<void> {
      process.env.PATH = saved;
      await rm(dir, { recursive: true, force: true });
    },
  };
}

test('a site that could not be asked inside a fork leaves the run exactly as it was, rather than blocking the join over a live job', async (t) => {
  const shadow = await tmuxThatCannotLaunchBranchB();
  let d: BootedDriver | undefined;
  let sessions: string[] = [];
  try {
    // One attempt per node, so the branch whose job vanishes gives its allowance up at once and this
    // test is about the fault and not about a retry.
    d = await bootDriver(t, { home: 'hima', parallelJobs: 2, sleepSeconds: SLOW_SYNTH_SECONDS });
    if (!d) return;
    const host = await d.host();
    assert.ok(host.ok, JSON.stringify(host));
    const cookie = await d.cookie();
    const pack = await installFork(packsDirOf(d.home), 'fork-join-unreadable', 2.2);

    const starting = api(host, cookie, '/hima/api/runs', {
      method: 'POST',
      body: JSON.stringify({ pack, site: 'local', goal: { target_period_ns: 2.0 }, strategy: { periodNs: 2.0 }, retries: 1 }),
      headers: { 'content-type': 'application/json' },
    });
    starting.catch(() => undefined);
    const runId = await runIdOnTheList(d, pack);

    // Branch one's job is really on the site. Branch two's launch was sent and never answered, so
    // there is no record of it at all and its own branch is over.
    let first = '';
    await until('the first branch had a job launched', async () => {
      const records = await recordsOf(host, cookie, runId);
      sessions = sessionsIn(records);
      const launched = jobsIn(records).find((r) => r.event === 'launched' && r.branchId === 'synthesize');
      if (launched) first = launched.job.session;
      return launched !== undefined;
    });

    // That job then vanishes — its session is taken away without an exit status, as a person or an
    // OOM killer takes one away. The branch gives up its one attempt on it and settles, which is
    // what leaves it settled with a launch nothing has settled: no `finished` record, no `killed`
    // one, and a job that may still be on the site as far as any later reader can tell.
    killSession(first);
    await until('the first branch gave its allowance up on the job that vanished', async () => {
      const records = await recordsOf(host, cookie, runId);
      return records.some((r) => r.type === 'blocker' && r.nodeId === 'synthesize');
    });
    // Both branches have now settled, so the fault the second one raised is at the drive's boundary.
    await sleep(faultSettleMs);

    const view = await runViewOf(host, cookie, runId);
    assert.equal(view.run.status, 'running', `nothing was concluded and nothing was written: the row stands as it did (${JSON.stringify(view.run)})`);
    assert.equal(view.run.fork?.join, 'judge', 'the run is still inside its fork, waiting at the join');
    const records = await recordsOf(host, cookie, runId);
    assert.deepEqual(
      nodesIn(records).filter((r) => r.nodeId === 'judge').map((r) => r.state),
      [],
      `the join was never blocked: a judge node launches nothing, and blocking it would hand the run to a person over a job nobody is watching (${JSON.stringify(nodesIn(records).map((r) => `${r.nodeId}/${r.state}`))})`,
    );
    const settled = jobsIn(records).filter((r) => r.event !== 'launched').map((r) => r.job.session);
    assert.deepEqual(settled, [], `and the first branch's job is still on record as open: ${JSON.stringify(jobsIn(records).map((r) => `${r.event} ${r.branchId ?? '?'}`))}`);
    assert.deepEqual(jobsIn(records).map((r) => r.branchId), ['synthesize'], 'the second branch never got a launch on record');

    // A person is what comes next, exactly as ticket #18 says: they stop it, and the cancel finds
    // nothing left on the site to stop.
    const cancelled = await api(host, cookie, `/hima/api/runs/${encodeURIComponent(runId)}/cancel`, { method: 'POST' });
    const cancelledText = await cancelled.text();
    assert.equal(cancelled.status, 200, cancelledText);
    assert.equal((JSON.parse(cancelledText) as RunView).run.status, 'cancelled', cancelledText);
    assert.deepEqual(d.unexpectedStdout(), []);
  } finally {
    killSessions(sessions);
    if (d) await d.dispose();
    await shadow.restore();
  }
});

test('two blocked branches take two resumes: one person\'s action clears one branch, and the other waits for its own', async (t) => {
  // Both tools fail their one attempt: the untagged counter is branch one's `synth`, the `b` counter
  // branch two's `synth-b`.
  const d = await bootDriver(t, { home: 'hima', parallelJobs: 2, sleepSeconds: 2, failures: 1, failuresByTag: { b: 1 } });
  if (!d) return;
  let sessions: string[] = [];
  try {
    const host = await d.host();
    assert.ok(host.ok, JSON.stringify(host));
    const cookie = await d.cookie();
    const pack = await installFork(packsDirOf(d.home), 'fork-join-both-blocked', 2.2);

    const started = await api(host, cookie, '/hima/api/runs', {
      method: 'POST',
      body: JSON.stringify({ pack, site: 'local', goal: { target_period_ns: 2.0 }, strategy: { periodNs: 2.0 }, retries: 1 }),
      headers: { 'content-type': 'application/json' },
    });
    const startedText = await started.text();
    assert.equal(started.status, 200, startedText);
    const waiting = JSON.parse(startedText) as RunView;
    const runId = waiting.run.id;
    assert.equal(waiting.run.status, 'waiting', `both branches blocked, so the run waits: ${startedText}`);
    assert.deepEqual(
      Object.values(waiting.run.fork?.branches ?? {}).map((b) => b.state),
      ['blocked', 'blocked'],
      `each branch blocked itself: ${JSON.stringify(waiting.run.fork)}`,
    );

    // One resume, one blocker cleared, one branch re-entered. The other branch's blocker is still
    // standing, so it is not run again: a fresh Retry allowance is something a person grants.
    const resumed = await api(host, cookie, `/hima/api/runs/${encodeURIComponent(runId)}/resume`, { method: 'POST' });
    const resumedText = await resumed.text();
    assert.equal(resumed.status, 200, resumedText);
    const once = JSON.parse(resumedText) as RunView;
    assert.equal(once.run.status, 'waiting', `the run waits again, for the branch nobody has cleared: ${resumedText}`);
    const states = Object.values(once.run.fork?.branches ?? {}).map((b) => b.state);
    assert.deepEqual([...states].sort(), ['blocked', 'done'], `one branch went on to the join and one is still blocked: ${JSON.stringify(once.run.fork)}`);
    const midway = await recordsOf(host, cookie, runId);
    sessions = sessionsIn(midway);
    assert.equal(
      jobsIn(midway).filter((r) => r.event === 'launched').length,
      3,
      `three launches: one failure per branch, and one retry in the branch that was cleared (${JSON.stringify(jobsIn(midway).filter((r) => r.event === 'launched').map((r) => r.branchId))})`,
    );
    assert.equal(verdictsIn(midway).length, 0, 'the join has judged nothing: it waits for every branch');

    // The second person's action clears the other one, and the fork closes.
    const again = await api(host, cookie, `/hima/api/runs/${encodeURIComponent(runId)}/resume`, { method: 'POST' });
    const againText = await again.text();
    assert.equal(again.status, 200, againText);
    const view = JSON.parse(againText) as RunView;
    assert.equal(view.run.status, 'ended-goal-not-met', `the fork went on and the run reached its ending: ${againText}`);
    assert.equal(view.run.fork, undefined, 'and the fork closed');
    const records = await recordsOf(host, cookie, runId);
    sessions = sessionsIn(records);
    assert.equal(jobsIn(records).filter((r) => r.event === 'launched').length, 4, 'four launches: a failure and a retry in each branch');
    assert.equal(verdictsIn(records).length, 4, 'the join judged both branches once both had cleared');
    assert.deepEqual(view.generations[0]?.branches?.map((b) => b.state), ['done', 'done']);
    assert.deepEqual(d.unexpectedStdout(), []);
  } finally {
    killSessions(sessions);
    await d.dispose();
  }
});

test('the served HimaGuide bundle carries the fork\'s branch rows, as the workbench page does', async (t) => {
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

    // The card has two mounts and one fork. Only spellings a minified React bundle cannot satisfy by
    // accident are asked for: the region's own name, the per-branch marker, and two words no other
    // section of the card says. ASCII only, because esbuild escapes every non-ASCII character in a
    // literal.
    assert.ok(source.includes('run-branches'), 'the chat\'s card marks the branches region the way the page does');
    assert.ok(source.includes('data-hima-branch'), 'and marks each branch\'s row with the branch it is');
    assert.ok(source.includes('waiting for a job slot'), 'and says what a branch queued behind the site is doing');
    assert.ok(source.includes(FORK_RULE), 'and says, at the join, the rule a fork\'s outcome is settled by');
    assert.deepEqual(d.unexpectedStdout(), []);
  } finally {
    await d.dispose();
  }
});

// ---------------------------------------------------------------------------------------------
// What a fork may be, refused where a person can still read the file: the words a chat command says,
// which is the one thing the in-process host is still the seam for (D42).
// ---------------------------------------------------------------------------------------------

/** A pack whose loop's own graph forks: drill-down and fork each go one level in step 3, and neither
 *  is nested in the other. Written whole, because a graph with a loop in it is a different shape. */
const forkInsideALoop = (id: string): string => `# A pack that drills down into a loop that forks: refused when it is loaded.
id: ${id}
version: '1'
entry: probe

nodes:
  - id: probe
    kind: explore
    parameters:
      opens: push

  - id: final-read
    kind: act
    parameters:
      observes: qorReport

  - id: blocked
    kind: wait
    parameters:
      blocker: hard-blocker

edges:
  - { from: probe, to: final-read, outcome: converged }
  - { from: probe, to: final-read, outcome: goal-met }
  - { from: probe, to: blocked, outcome: generation-limit }

loops:
  push:
    entry: start
    nodes:
      - id: start
        kind: act
        parameters:
          observes: flowSummary

      - id: synthesize
        kind: act
        parameters:
          tool: synth
          arguments:
            PERIOD_NS: { from: strategy, name: periodNs }

      - id: read-qor
        kind: act
        parameters:
          observes: qorReport

      - id: synth-b
        kind: act
        parameters:
          tool: synth-b
          arguments:
            PERIOD_NS: 2.20

      - id: read-qor-b
        kind: act
        parameters:
          observes: qorReportB

      - id: judge
        kind: judge
        parameters:
          rules:
            - setup-wns-all-nonnegative
            - clock-period-at-most
          bind:
            target_period_ns: { from: goal, name: target_period_ns }

      - id: next-period
        kind: explore
        parameters:
          chooser: timing-push
          bind:
            guardBandNs: 0.05
          converge:
            read: period
            band: 0.01
            generations: 1
            generationLimit: 6

    edges:
      - { from: start, to: synthesize }
      - { from: start, to: synth-b }
      - { from: synthesize, to: read-qor }
      - { from: read-qor, to: judge }
      - { from: synth-b, to: read-qor-b }
      - { from: read-qor-b, to: judge }
      - { from: judge, to: next-period, outcome: PASS }
      - { from: judge, to: next-period, outcome: FAIL }
      - { from: next-period, to: start, revisit: true }
`;

test('/hima status says which fork a Run is inside and lists its branches with what each one is doing', async (t) => {
  // No retry allowance and a second branch whose flow fails once: that branch is a Hard blocker at
  // its first attempt while the first branch runs to the join, so the Run waits with the fork open —
  // which is the shape a person asks `/hima status` about.
  const local = await localFabric(t, { sleepSeconds: 1, failuresByTag: { b: 1 }, parallelJobs: 2, licences: { 'Design-Compiler': 2 } });
  if (!local) return;
  const { h, host, dispose } = local;
  let sessions: string[] = [];
  try {
    const pack = await installFork(packsDirOf(h), 'fork-join-status', 2.2);
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
    assert.match(
      status.text,
      /: waiting, generation 1 of at most 6, in the fork at start waiting at judge for 2 branches$/m,
      `the run line says which fork it is inside and what it is waiting for: ${status.text}`,
    );
    assert.match(status.text, /^ {2}current node: judge$/m, `and that it stands at the join: ${status.text}`);
    assert.match(status.text, /^ {2}branches:\n {4}synthesize: done, 1 job\n {4}synth-b: blocked, 1 job$/m, `and lists each branch and what it is doing: ${status.text}`);
  } finally {
    killSessions(sessions);
    await dispose();
  }
});

test('/hima pack check refuses a fork the engine could never drive: a judge node inside a branch, two joins, an explore node after the join, and a fork inside a loop', async (t) => {
  const local = await localFabric(t, {});
  if (!local) return;
  const { h, host, dispose } = local;
  try {
    const packsDir = packsDirOf(h);
    /** The forking graph with one thing about it changed, installed under its own id. */
    const variant = async (id: string, change: (graph: string) => string): Promise<void> => {
      await installFork(packsDir, id, 2.2);
      await writeFile(path.join(packsDir, id, 'graph.yml'), change(forkGraph(id, 2.2)));
    };

    // A branch holding a judge node. A fork is judged where its branches converge and nowhere else,
    // so a judge inside one would be judging half a fork on its own.
    await variant('branch-judges', (g) => g.replace(`  - id: read-qor-b
    kind: act
    parameters:
      observes: qorReportB`, `  - id: read-qor-b
    kind: judge
    parameters:
      rules:
        - setup-wns-all-nonnegative
        - clock-period-at-most`));
    await assert.rejects(
      himaCommand(host, h.workspace, '/hima pack check branch-judges --site local'),
      /has a judge node, "read-qor-b", inside the branch it forks to "synth-b": a branch is act nodes only, because a fork is judged where its branches converge and nowhere else/,
      'the refusal names the node, the branch it is in, and what a branch may hold',
    );

    // Branches converging into two different nodes. The run waits for every branch at one join, so a
    // fork whose branches end in two places is a run that could never be waited for. Both judge nodes
    // keep two incoming edges — a node with one is a node inside a branch, which is the refusal above
    // — so what this pack gets wrong is the one thing it is about.
    await variant('two-joins', (g) => g
      .replace(`  - id: blocked
    kind: wait`, `  - id: judge-b
    kind: judge
    parameters:
      rules:
        - setup-wns-all-nonnegative
        - clock-period-at-most
      bind:
        target_period_ns: { from: goal, name: target_period_ns }

  - id: read-qor-c
    kind: act
    parameters:
      observes: qorReport

  - id: read-qor-d
    kind: act
    parameters:
      observes: qorReportB

  - id: blocked
    kind: wait`)
      .replace('  - { from: read-qor-b, to: judge }', '  - { from: read-qor-b, to: judge-b }\n  - { from: read-qor-c, to: judge }\n  - { from: read-qor-d, to: judge-b }'));
    await assert.rejects(
      himaCommand(host, h.workspace, '/hima pack check two-joins --site local'),
      /has the branches of the fork at "start" converge into two different nodes, "judge" and "judge-b": every branch of one fork reaches one join/,
      'the refusal names the fork and both nodes its branches ended at',
    );

    // An explore node the join leads to. A chooser weighs one reading; a fork leaves one per branch,
    // so a chooser after a join would choose from whichever branch appended last. Two act nodes
    // stand between the join and the explore node, because the rule is about everything the join
    // leads to and not about the node it draws an edge straight to.
    await variant('explores-after-the-join', (g) => g
      .replace(`  - id: blocked
    kind: wait`, `  - id: settle
    kind: act
    parameters:
      observes: qorReport

  - id: next-period
    kind: explore
    parameters:
      chooser: timing-push
      bind:
        guardBandNs: 0.05
      converge:
        read: period
        band: 0.05
        generations: 1
        generationLimit: 6

  - id: blocked
    kind: wait`)
      .replace(`  - { from: read-qor-b, to: judge }`, `  - { from: read-qor-b, to: judge }
  - { from: judge, to: settle, outcome: PASS }
  - { from: settle, to: next-period }
  - { from: next-period, to: start, revisit: true }`));
    await assert.rejects(
      himaCommand(host, h.workspace, '/hima pack check explores-after-the-join --site local'),
      /has explore node "next-period" downstream of "judge", the join of the fork at "start": an explore node weighs one reading of its loop's latest generation, and a fork writes one reading per branch, so a chooser standing after a join would choose from whichever branch happened to append last/,
      'the refusal names the explore node, the join it stands after, and what it would have been deciding on',
    );

    // A fork inside a drill-down loop's graph. Fork and drill-down each go one level in step 3.
    await installFork(packsDir, 'fork-in-loop', 2.2);
    await writeFile(path.join(packsDir, 'fork-in-loop', 'graph.yml'), forkInsideALoop('fork-in-loop'));
    await assert.rejects(
      himaCommand(host, h.workspace, '/hima pack check fork-in-loop --site local'),
      /forks at "start" in loop "push": a loop's graph holds no fork, because drill-down and fork each go one level in step 3 and neither is nested in the other/,
      'the refusal names the node, its loop, and why neither nests in the other',
    );
  } finally {
    await dispose();
  }
});
