// Ticket #25: the Loop. HimaFabric revisits the synthesis node with the Strategy the Explore node
// chose, generation after generation, until the Goal is met, the exploration has converged, or the
// Budget's generation limit is reached.
//
// Driven through the desktop shell in driver mode (D42, ADR-0004), which is the one seam every
// step-3 test boots through: the Run is started over the routes with the session the shell
// established, and the ending is read off the `run-status` region of the workbench page the window
// renders. What is asserted is what a person sees and what the ledger holds — the run row's
// generation, the records each generation left, and the decision that ended the Campaign.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootDriver, runIdOnTheList } from './support/driver.ts';
import { himaCommand, siteCommandTimeoutMs } from './support/command.ts';
import { killSessions, localFabric, sessionsOf } from './support/fabric.ts';
import { api } from './support/hima-api.ts';
import { installOverConstraining, packsDirOf, shippedWordsBlock, timingProbePackId, writePackVariant } from './support/pack.ts';
import type { BootedDriver } from './support/driver.ts';
import { metersState } from '@hima/harness';
import type { JobRecord, LedgerRecord, RunView } from '@hima/harness';

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

test('a Campaign at a reachable goal revisits the synthesis node and ends goal met at the second generation, every record carrying its generation', async (t) => {
  const d = await bootDriver(t, { home: 'hima' });
  if (!d) return;
  try {
    const host = await d.host();
    assert.ok(host.ok, JSON.stringify(host));
    const cookie = await d.cookie();

    // 2.35 ns meets setup but misses the 2.30 ns goal; method 2 steps to 2.30,
    // where the second generation passes both rules.
    const started = await api(host, cookie, '/hima/api/runs', {
      method: 'POST',
      body: JSON.stringify({ pack: timingProbePackId, site: 'local', goal: { target_period_ns: 2.30 }, strategy: { periodNs: 2.35 } }),
      headers: { 'content-type': 'application/json' },
    });
    const startedText = await started.text();
    assert.equal(started.status, 200, startedText);
    const view = JSON.parse(startedText) as RunView;
    const runId = view.run.id;
    assert.equal(view.run.status, 'ended-goal-met', `the second generation met the goal: ${startedText}`);
    assert.equal(view.run.generation, 2, 'the run row carries the generation it ended in');
    assert.equal(view.jobs.filter((j) => j.event === 'launched').length, 2, 'one synthesis job per generation');

    // Every record carries its generation, stamped by the ledger from the run row.
    const records = await recordsOf(host, cookie, runId);
    for (const r of records) {
      assert.ok(r.generation !== undefined, `record ${r.id} (${r.type}) carries no generation`);
    }
    const second = records.filter((r) => r.generation === 2);
    assert.deepEqual(
      [...new Set(second.map((r) => r.type))].sort(),
      // `experience` is the Campaign's own technical report (#30), written when the Run ended, which
      // was in this generation — the ledger stamps it from the row like every other record. It is a
      // record *about the Run* rather than about this pass of the Loop, which is why the generations
      // table does not fold it in; here, where what is asserted is what the ledger stamped, it is.
      ['decision', 'experience', 'job', 'node', 'observation', 'verdict'],
      `the second generation left a node, a job, an observation, verdicts, a decision and the campaign's experience: ${JSON.stringify(second.map((r) => `${r.type}@${String(r.generation)}`))}`,
    );

    const opened = await d.open(`/hima/?run=${encodeURIComponent(runId)}`);
    assert.ok(opened.ok, JSON.stringify(opened));
    const status = await d.wait('run-status', 'ended — goal met');
    assert.ok(status.ok, `wait run-status: ${JSON.stringify(status)}`);
    assert.equal(status.state.status, 'ended-goal-met', JSON.stringify(status));
    assert.deepEqual(d.unexpectedStdout(), []);
  } finally {
    await d.dispose();
  }
});

test('a Campaign at an unreachable goal ends converged when the periods stop moving, naming the rule that ended it', async (t) => {
  const d = await bootDriver(t, { home: 'hima' });
  if (!d) return;
  try {
    const host = await d.host();
    assert.ok(host.ok, JSON.stringify(host));
    const cookie = await d.cookie();

    // A named copy of the shipped version 2 method. The legacy failure remains a separate
    // case in honest-standin.test.ts. On this stand-in, 2.00 ns is
    // tighter than this flow closes at and always will be: the first generation misses by 0.20 ns,
    // which states that the design closes at 2.20, so the chooser asks for one step less — 2.15 —
    // and the third generation asks for and measures the same 2.15 the second did, because it read
    // the same violation. A move of nothing, which is what the pack calls converged.
    const honest = await installOverConstraining(packsDirOf(d.home), 'over-constraining-probe');
    const started = await api(host, cookie, '/hima/api/runs', {
      method: 'POST',
      body: JSON.stringify({ pack: honest, site: 'local', goal: { target_period_ns: 2.0 }, strategy: { periodNs: 2.0 } }),
      headers: { 'content-type': 'application/json' },
    });
    const startedText = await started.text();
    assert.equal(started.status, 200, startedText);
    const view = JSON.parse(startedText) as RunView;
    assert.equal(view.run.status, 'ended-converged', `the exploration stopped learning: ${startedText}`);
    assert.equal(view.run.generation, 3, 'it took three generations to say so');
    assert.ok(view.decision, 'the ending is a decision, on record');
    assert.deepEqual(
      view.decision.chosen,
      { converged: { read: 'period', band: 0.05, generations: 1, values: [2.15, 2.15] } },
      `the decision carries the whole rule: ${JSON.stringify(view.decision.chosen)}`,
    );
    assert.equal(view.decision.rationale.convergeBand, 0.05, JSON.stringify(view.decision.rationale));
    assert.equal(view.decision.rationale.convergeGenerations, 1, JSON.stringify(view.decision.rationale));
    assert.equal(view.decision.rationale.convergeMovedBy, 0, 'the period moved by nothing at all');

    const opened = await d.open(`/hima/?run=${encodeURIComponent(view.run.id)}`);
    assert.ok(opened.ok, JSON.stringify(opened));
    const status = await d.wait('run-status', 'ended — converged');
    assert.ok(status.ok, `wait run-status: ${JSON.stringify(status)}`);
    assert.equal(status.state.status, 'ended-converged', JSON.stringify(status));
    const decision = await d.read('run-decision');
    assert.ok(decision.ok, JSON.stringify(decision));
    assert.equal(decision.state.chosen, 'converged', JSON.stringify(decision));
    assert.equal(decision.state.read, 'period', JSON.stringify(decision));
    assert.ok(
      decision.text.includes('converged: period moved by less than 0.05 over 1 generation, at 2.15 then 2.15'),
      `the card says the rule in words: ${decision.text}`,
    );
    assert.deepEqual(d.unexpectedStdout(), []);
  } finally {
    await d.dispose();
  }
});

test('a generation that moved the period by exactly the band goes on exploring, so no converged record contradicts the move it states', async (t) => {
  const d = await bootDriver(t, { home: 'hima' });
  if (!d) return;
  try {
    const host = await d.host();
    assert.ok(host.ok, JSON.stringify(host));
    const cookie = await d.cookie();

    // Started at 2.30 ns on the pack varied onto `over-constraining-push` (#54), which walks in one
    // step of 0.05 ns a generation while nothing is violated: every generation until the flow misses
    // moves the *measured* period by exactly the band the pack declares — and what the pack declares
    // is movement of *less than* the band. The two numbers are the reason this campaign is started
    // here rather than left to the converging one above: in IEEE doubles 2.30 − 2.25 is
    // 0.04999999999999982, so a rule applied to the raw values would call the second generation
    // converged while the rationale written beside it rounds the same move to 0.05 — a record whose
    // own numbers say it should have gone on. It goes on to 2.20, then to 2.15, which misses by 0.05
    // and so states 2.20 as the achievable period; asking for one step less than that is 2.15 again,
    // and *that* is a move of nothing.
    const honest = await installOverConstraining(packsDirOf(d.home), 'over-constraining-probe');
    const started = await api(host, cookie, '/hima/api/runs', {
      method: 'POST',
      body: JSON.stringify({ pack: honest, site: 'local', goal: { target_period_ns: 2.0 }, strategy: { periodNs: 2.30 } }),
      headers: { 'content-type': 'application/json' },
    });
    const startedText = await started.text();
    assert.equal(started.status, 200, startedText);
    const view = JSON.parse(startedText) as RunView;
    assert.deepEqual(
      view.generations.map((r) => r.observedPeriodNs),
      [2.3, 2.25, 2.2, 2.15, 2.15],
      `the periods the reports stated, one per generation: ${startedText}`,
    );
    assert.equal(view.generations[1]!.decision, 'next strategy: clock period 2.2 ns', 'a move of exactly the band is a move the pack asked to keep exploring on');
    assert.equal(view.run.status, 'ended-converged', `the fifth generation is where this one stops learning: ${startedText}`);
    assert.equal(view.run.generation, 5, 'every generation before it moved by the band itself, which is not less than it');
    assert.ok(view.decision, 'the ending is a decision, on record');
    assert.deepEqual(
      view.decision.chosen,
      { converged: { read: 'period', band: 0.05, generations: 1, values: [2.15, 2.15] } },
      `the values compared are the two that did not move: ${JSON.stringify(view.decision.chosen)}`,
    );

    // The whole of C1: the decision and the rationale beside it are one arithmetic. Whatever the
    // record says the read moved by is what the rule was applied to, so a person re-derives the
    // ending from this record alone.
    const rationale = view.decision.rationale;
    assert.ok(
      typeof rationale.convergeMovedBy === 'number' && typeof rationale.convergeBand === 'number'
        && rationale.convergeMovedBy < rationale.convergeBand,
      `a converged record states a move below its own band: ${JSON.stringify(rationale)}`,
    );
    assert.equal(rationale.convergeMovedBy, 0, 'the two generations compared measured the same period');
    assert.deepEqual(d.unexpectedStdout(), []);
  } finally {
    await d.dispose();
  }
});

test('a Campaign whose generation limit runs out ends budget exhausted naming that meter, with the strategy it was not allowed to try still on record', async (t) => {
  const d = await bootDriver(t, { home: 'hima' });
  if (!d) return;
  try {
    const host = await d.host();
    assert.ok(host.ok, JSON.stringify(host));
    const cookie = await d.cookie();

    // The same unreachable goal on the same varied pack, allowed two generations instead of the
    // pack's six: the Campaign would have converged at the third, and is stopped one revisit short
    // of it.
    const honest = await installOverConstraining(packsDirOf(d.home), 'over-constraining-probe');
    const started = await api(host, cookie, '/hima/api/runs', {
      method: 'POST',
      body: JSON.stringify({ pack: honest, site: 'local', goal: { target_period_ns: 2.0 }, strategy: { periodNs: 2.0 }, generations: 2 }),
      headers: { 'content-type': 'application/json' },
    });
    const startedText = await started.text();
    assert.equal(started.status, 200, startedText);
    const view = JSON.parse(startedText) as RunView;
    assert.equal(view.run.status, 'ended-budget-exhausted', startedText);
    assert.equal(view.run.meters?.endedBy, 'generation-limit', 'which meter ended it, on the row');
    assert.equal(view.run.generation, 2, 'it never opened a third generation');
    assert.equal(view.run.budget?.generationLimit, 2, 'the limit the request asked for is what it was held to');
    assert.ok(view.decision && 'strategy' in view.decision.chosen, `the decision it was not allowed to act on: ${JSON.stringify(view.decision)}`);
    assert.equal(view.decision.chosen.strategy.periodNs, 2.15);

    // The generation limit as a Budget meter, read off the same view the card's meters are (#27):
    // where the Campaign got to, what it was allowed, and which of the two ended it.
    const meters = metersState(view);
    assert.equal(meters.generation, '2', JSON.stringify(meters));
    assert.equal(meters['generation-limit'], '2', JSON.stringify(meters));
    assert.equal(meters['ended-by'], 'generation-limit', JSON.stringify(meters));

    const opened = await d.open(`/hima/?run=${encodeURIComponent(view.run.id)}`);
    assert.ok(opened.ok, JSON.stringify(opened));
    const status = await d.wait('run-status', 'ended — budget exhausted');
    assert.ok(status.ok, `wait run-status: ${JSON.stringify(status)}`);
    // Read off the verdict band: where the Campaign got to, against what it was allowed, on the
    // banner's own line, and what ended it — which is the meters section the band carries under its
    // third question (#27b), where the name of the meter is its own column and so its own line of
    // text, rather than the banner's separate budget clause of before.
    assert.ok(status.text.includes('generation 2 of at most 2'), `the band says where it got to against what it was allowed: ${status.text}`);
    assert.match(status.text, /ended by\s+the generation limit/, `and what ended it: ${status.text}`);
    assert.deepEqual(d.unexpectedStdout(), []);
  } finally {
    await d.dispose();
  }
});

test('a pack whose explore node leads nowhere is still one generation, ending goal not met with the strategy it would have tried next', async (t) => {
  // The ending the Loop must not have taken away. `ended-goal-not-met` is what every Run of every
  // pack ended as before the revisit edge existed, and the shipped pack can no longer reach it — so
  // the pack this test drives is that one with its revisit edge taken out, which is the graph every
  // pack was. Without a test at this seam, the branch that ends such a Run could be deleted and
  // nothing in the suite would go red.
  const d = await bootDriver(t, { home: 'hima' });
  if (!d) return;
  try {
    const host = await d.host();
    assert.ok(host.ok, JSON.stringify(host));
    const cookie = await d.cookie();

    await writePackVariant(packsDirOf(d.home), 'explores-nowhere', [], [[
      '  # The loop: taken only when the decision chose a next strategy. A decision of goal met or converged\n'
      + '  # has no edge to take, and the Run ends where it stands.\n'
      + '  - { from: next-period, to: synthesize, revisit: true }\n',
      '  # No loop: nothing leads out of the explore node, so the Run ends where it stands.\n',
    ]]);

    // 2.07 ns against a flow that closes at 2.20: the generation misses by 0.13, so the goal of
    // 2.00 is not met and the chooser has a next period to try — 2.07 + 0.13 - 0.05 — which this
    // graph gives it nowhere to try.
    const started = await api(host, cookie, '/hima/api/runs', {
      method: 'POST',
      body: JSON.stringify({ pack: 'explores-nowhere', site: 'local', goal: { target_period_ns: 2.0 }, strategy: { periodNs: 2.07 } }),
      headers: { 'content-type': 'application/json' },
    });
    const startedText = await started.text();
    assert.equal(started.status, 200, startedText);
    const view = JSON.parse(startedText) as RunView;
    assert.equal(view.run.status, 'ended-goal-not-met', `nothing led out of the explore node: ${startedText}`);
    assert.equal(view.run.generation, 1, 'one generation, because nothing opened a second');
    assert.deepEqual(view.run.strategy, { periodNs: 2.15 }, 'the row carries the strategy it would have tried next');
    assert.equal(view.jobs.filter((j) => j.event === 'launched').length, 1, 'one synthesis and no revisit to ask for another');
    assert.ok(view.decision && 'strategy' in view.decision.chosen, `and the decision that chose it is on record: ${JSON.stringify(view.decision)}`);
    assert.equal(view.decision.chosen.strategy.periodNs, 2.15);

    const opened = await d.open(`/hima/?run=${encodeURIComponent(view.run.id)}`);
    assert.ok(opened.ok, JSON.stringify(opened));
    const status = await d.wait('run-status', 'ended — goal not met');
    assert.ok(status.ok, `wait run-status: ${JSON.stringify(status)}`);
    assert.equal(status.state.status, 'ended-goal-not-met', JSON.stringify(status));
    assert.deepEqual(d.unexpectedStdout(), []);
  } finally {
    await d.dispose();
  }
});

// ---------------------------------------------------------------------------------------------
// A Campaign that outlives its host, and one a person stops. Both act in the middle of generation
// three, which is what makes them about the Loop rather than about one generation: the records of
// the two generations before it must still be there and still say which generation they were.
// ---------------------------------------------------------------------------------------------

/** How long each stand-in synthesis takes in the two tests that act while one is running: long
 *  enough to catch generation three in flight, short enough that three of them are not a wait. */
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

/** Every tmux session this Run launched, so a test that fails part way stops what it started. */
const sessionsIn = (records: readonly LedgerRecord[]): string[] =>
  records.filter((r) => r.type === 'job' && r.event === 'launched').map((r) => (r as JobRecord).job.session);

test('a host taken away in the middle of generation three is replaced by one that carries that generation on, launching nothing twice', async (t) => {
  const first = await bootDriver(t, { home: 'hima', sleepSeconds: SLOW_SYNTH_SECONDS });
  if (!first) return;
  let second: BootedDriver | undefined;
  let sessions: string[] = [];
  try {
    const host = await first.host();
    assert.ok(host.ok, JSON.stringify(host));
    const cookie = await first.cookie();

    // The pack varied onto `over-constraining-push` (#54), so this Campaign converges at its third
    // generation as the reference pack's did before the stand-in reported slack honestly: what is
    // under test is that a second host carries generation three to the Campaign's own ending.
    const honest = await installOverConstraining(packsDirOf(first.home), 'over-constraining-probe');

    // Started and not awaited: this route answers only when the Run stops, and the whole subject
    // here is what happens while it is still going.
    const starting = api(host, cookie, '/hima/api/runs', {
      method: 'POST',
      body: JSON.stringify({ pack: honest, site: 'local', goal: { target_period_ns: 2.0 }, strategy: { periodNs: 2.0 } }),
      headers: { 'content-type': 'application/json' },
    });
    starting.catch(() => undefined);
    const runId = await runIdOnTheList(first, honest);

    // Generation three, with its synthesis launched and still sleeping on the Site.
    await until('the run reached generation three with its job launched', async () => {
      const records = await recordsOf(host, cookie, runId);
      sessions = sessionsIn(records);
      return records.some((r) => r.type === 'job' && r.event === 'launched' && r.generation === 3);
    });

    // The window goes away. The dsh host goes with it; the tmux Job it launched does not.
    const quit = await first.quit();
    assert.ok(quit.ok, JSON.stringify(quit));
    await first.exit();
    await starting.catch(() => undefined);

    // A second shell on the same home: the same seam, one host later.
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
    assert.equal(view.run.status, 'ended-converged', `the campaign reached its own ending: ${JSON.stringify(view.run)}`);
    assert.equal(view.run.generation, 3, 'the generation the first host was in is the one it ended in');

    const records = await recordsOf(later, laterCookie, runId);
    sessions = sessionsIn(records);
    assert.equal(sessions.length, 3, `one synthesis per generation and no more: ${JSON.stringify(sessions)}`);
    assert.equal(new Set(sessions).size, 3, 'each in its own tmux session');
    const third = records.filter((r) => r.generation === 3);
    assert.ok(third.some((r) => r.type === 'node' && r.state === 'reconciled'), `a second host took generation three over: ${JSON.stringify(third.map((r) => r.type))}`);
    for (const record of records) {
      assert.ok(record.generation !== undefined, `record ${record.id} (${record.type}) carries no generation`);
    }
    assert.deepEqual(second.unexpectedStdout(), []);
  } finally {
    killSessions(sessions);
    if (second) await second.dispose();
    await first.dispose();
  }
});

test('a cancel in the middle of generation three stops that generation\'s job and ends the Run with all three generations on record', async (t) => {
  const d = await bootDriver(t, { home: 'hima', sleepSeconds: SLOW_SYNTH_SECONDS });
  if (!d) return;
  let sessions: string[] = [];
  try {
    const host = await d.host();
    assert.ok(host.ok, JSON.stringify(host));
    const cookie = await d.cookie();

    const starting = api(host, cookie, '/hima/api/runs', {
      method: 'POST',
      body: JSON.stringify({ pack: timingProbePackId, site: 'local', goal: { target_period_ns: 2.0 }, strategy: { periodNs: 2.0 } }),
      headers: { 'content-type': 'application/json' },
    });
    starting.catch(() => undefined);
    const runId = await runIdOnTheList(d);

    let thirdSession: string | undefined;
    await until('the run reached generation three with its job launched', async () => {
      const records = await recordsOf(host, cookie, runId);
      sessions = sessionsIn(records);
      thirdSession = records.find((r): r is JobRecord => r.type === 'job' && r.event === 'launched' && r.generation === 3)?.job.session;
      return thirdSession !== undefined;
    });

    // The route #26 puts a control on. What is under test here is the ledger it leaves behind.
    const cancelled = await api(host, cookie, `/hima/api/runs/${encodeURIComponent(runId)}/cancel`, { method: 'POST' });
    const cancelledText = await cancelled.text();
    assert.equal(cancelled.status, 200, cancelledText);
    const view = JSON.parse(cancelledText) as RunView;
    assert.equal(view.run.status, 'cancelled', cancelledText);
    assert.equal(view.run.generation, 3, 'the generation it was stopped in is the one it carries');
    assert.equal(view.run.meters?.endedBy, 'cancel');

    const records = await recordsOf(host, cookie, runId);
    sessions = sessionsIn(records);
    const killed = records.find((r) => r.type === 'job' && r.event === 'killed');
    assert.ok(killed, `the stop was observed and recorded: ${JSON.stringify(records.map((r) => r.type))}`);
    assert.equal((killed as JobRecord).job.session, thirdSession, 'the job that was stopped is generation three\'s');
    assert.equal(killed.generation, 3);
    assert.deepEqual(
      [1, 2, 3].map((g) => records.some((r) => r.generation === g && r.type === 'node')),
      [true, true, true],
      'the three generations are all still on record',
    );
    assert.equal(records.filter((r) => r.type === 'decision').length, 2, 'the two generations that finished each decided');

    const opened = await d.open(`/hima/?run=${encodeURIComponent(runId)}`);
    assert.ok(opened.ok, JSON.stringify(opened));
    const status = await d.wait('run-status', 'cancelled');
    assert.ok(status.ok, `wait run-status: ${JSON.stringify(status)}`);
    assert.deepEqual(d.unexpectedStdout(), []);
  } finally {
    killSessions(sessions);
    await d.dispose();
  }
});

// ---------------------------------------------------------------------------------------------
// The words a chat command says, which is the one thing the in-process host is still the seam for
// (D42): a command's answer is text a person reads, and no window renders it.
// ---------------------------------------------------------------------------------------------

test('/hima status says which generation of how many a Campaign reached, and /hima pack check refuses a Loop that cannot be executed', async (t) => {
  const local = await localFabric(t);
  if (!local) return;
  const { h, host, dispose } = local;
  let sessions: string[] = [];
  try {
    const started = await himaCommand(
      host,
      h.workspace,
      `/hima run ${timingProbePackId} --site local --goal target_period_ns=2.3 --set periodNs=2.35`,
      siteCommandTimeoutMs,
    );
    assert.equal(started.kind, 'success', started.text);
    const runId = started.runId!;
    sessions = sessionsOf(host, runId);
    const status = await himaCommand(host, h.workspace, `/hima status ${runId}`);
    assert.equal(status.kind, 'success', status.text);
    assert.match(status.text, /generation 2 of at most 6$/m, `the run line says how far in and how far it may go: ${status.text}`);
    assert.match(status.text, /at most 6 generations/, `and the budget line says the allowance: ${status.text}`);

    // A pack that converges on a value its chooser never reads: a Loop that could only ever end at
    // the generation limit, said before a Campaign exists rather than after one.
    await writePackVariant(packsDirOf(h), 'converges-on-nothing', [], [['        read: period', '        read: cell_area']]);
    const checked = await himaCommand(host, h.workspace, '/hima pack check converges-on-nothing --site local');
    assert.equal(checked.kind, 'error', checked.text);
    assert.match(checked.text, /converges on "cell_area", which chooser "over-constraining-push" does not read/, checked.text);
    assert.match(checked.text, /"period", "slack"/, `and says what it does read: ${checked.text}`);

    // A graph that goes back to an act node without saying so: a loop the engine would run and the
    // file would not show. Refused when the pack is *loaded* — before any question about a Site is
    // asked — which is how every other way a pack can contradict itself is refused, and which a
    // person meets as the load's own message rather than as a check that came back unfit.
    await writePackVariant(packsDirOf(h), 'cycles-without-a-revisit', [], [[
      '  - { from: next-period, to: synthesize, revisit: true }',
      '  - { from: next-period, to: synthesize }',
    ]]);
    const refusedCyclesWithoutARevisit = await himaCommand(host, h.workspace, '/hima pack check cycles-without-a-revisit --site local');
    assert.equal(refusedCyclesWithoutARevisit.kind, 'error', refusedCyclesWithoutARevisit.text);
    assert.match(refusedCyclesWithoutARevisit.text, /graph\.yml cycles through "synthesize" → "read-qor" → "judge" → "next-period" → "synthesize" without a revisit edge/,
      `the refusal names the cycle it walked and what declares a loop: ${refusedCyclesWithoutARevisit.text}`);

    // Two explore nodes, each declaring how many generations a Campaign of this pack may take, and
    // disagreeing: a Run has one Budget, so one of the two numbers would be quietly ignored. Refused
    // where the file can still be read, and for the same reason and in the same way as the cycle.
    await writePackVariant(packsDirOf(h), 'two-generation-limits', [], [[
      '  - id: blocked\n',
      '  - id: second-thoughts\n'
      + '    kind: explore\n'
      + '    parameters:\n'
      + '      chooser: timing-push\n'
      + '      bind:\n'
      + '        guardBandNs: 0.05\n'
      + '      converge:\n'
      + '        read: period\n'
      + '        band: 0.05\n'
      + '        generations: 1\n'
      + '        generationLimit: 3\n'
      + '\n'
      + '  - id: blocked\n',
    ]]);
    const refusedTwoGenerationLimits = await himaCommand(host, h.workspace, '/hima pack check two-generation-limits --site local');
    assert.equal(refusedTwoGenerationLimits.kind, 'error', refusedTwoGenerationLimits.text);
    assert.match(refusedTwoGenerationLimits.text, /graph\.yml declares 2 different generation limits — 6 on explore node "next-period", 3 on explore node "second-thoughts" — where a campaign has one budget/,
      `the refusal names both numbers and the node each came from: ${refusedTwoGenerationLimits.text}`);
  } finally {
    killSessions(sessions);
    await dispose();
  }
});

// ---------------------------------------------------------------------------------------------
// The generations table (#25b): one row per generation, on the card and in the run view. What a
// person watching a Campaign reads is not the path — that is one row per node, the latest transition
// of it — but what each generation asked for, measured, concluded and decided.
//
// Read off the page after the Run has ended, so nothing here races the Campaign. A row cannot be
// read half-written even while a Run is moving: the page re-renders itself from the host once a
// second and swaps `<main>` whole, so a driver either sees the render before a generation's records
// or the render after them, and never a table with one row's numbers from two renders.
// ---------------------------------------------------------------------------------------------

/** Every wall time the table printed, in `duration()`'s own spellings: one per row. */
const wallTimesIn = (text: string): string[] => text.match(/\d+(?:\.\d+)? (?:ms|s|min)\b/g) ?? [];

test('the generations table gives a converged Campaign one row per generation, with the numbers the ledger holds', async (t) => {
  const d = await bootDriver(t, { home: 'hima' });
  if (!d) return;
  try {
    const host = await d.host();
    assert.ok(host.ok, JSON.stringify(host));
    const cookie = await d.cookie();

    // The converged Campaign of the test above, on the same varied pack: three generations at 2.00,
    // 2.15 and 2.15 against a flow that closes at 2.20, the last two measuring the same period.
    const honest = await installOverConstraining(packsDirOf(d.home), 'over-constraining-probe');
    const started = await api(host, cookie, '/hima/api/runs', {
      method: 'POST',
      body: JSON.stringify({ pack: honest, site: 'local', goal: { target_period_ns: 2.0 }, strategy: { periodNs: 2.0 } }),
      headers: { 'content-type': 'application/json' },
    });
    const startedText = await started.text();
    assert.equal(started.status, 200, startedText);
    const view = JSON.parse(startedText) as RunView;
    assert.equal(view.run.status, 'ended-converged', startedText);

    const rows = view.generations;
    assert.deepEqual(rows.map((r) => r.generation), [1, 2, 3], `one row per generation the Run opened: ${JSON.stringify(rows)}`);
    assert.deepEqual(rows.map((r) => r.state), ['done', 'done', 'done'], 'every generation of an ended Run is done');
    // What each generation asked the flow for. Generation one's is the Strategy the Campaign was
    // started with — here the 2.0 ns this start set the knob to — off the run row's `firstStrategy`,
    // which is written once and which the Loop cannot move; the two after it are the periods the
    // decisions before them chose. The falsifiable form of this on the page is the goal-met test
    // below, whose first generation asked for 2.35.
    assert.deepEqual(rows.map((r) => r.strategy), [{ periodNs: 2 }, { periodNs: 2.15 }, { periodNs: 2.15 }], `the strategy each generation was opened with: ${JSON.stringify(rows)}`);
    assert.deepEqual(rows.map((r) => r.observedPeriodNs), [2, 2.15, 2.15], 'and the clock period each generation\'s report stated');
    assert.deepEqual(rows.map((r) => r.slackNs), [-0.2, -0.05, -0.05], 'with the setup slack it closed with: how far short of the 2.20 ns this flow reaches, and nothing at all when it does not fall short');
    assert.deepEqual(
      rows.map((r) => r.verdicts.map((v) => `${v.ruleId}=${v.outcome}`)),
      [
        ['setup-wns-all-nonnegative=FAIL', 'clock-period-at-most=PASS'],
        ['setup-wns-all-nonnegative=FAIL', 'clock-period-at-most=FAIL'],
        ['setup-wns-all-nonnegative=FAIL', 'clock-period-at-most=FAIL'],
      ],
      `each generation's verdicts, in the order the judge node lists its rules: ${JSON.stringify(rows.map((r) => r.verdicts))}`,
    );
    assert.equal(rows[0]!.decision, 'next strategy: clock period 2.15 ns');
    assert.equal(rows[1]!.decision, 'next strategy: clock period 2.15 ns');
    assert.equal(rows[2]!.decision, 'converged: period moved by less than 0.05 over 1 generation, at 2.15 then 2.15');
    assert.ok(rows.every((r) => r.wallMs > 0), `every generation took some time: ${JSON.stringify(rows.map((r) => r.wallMs))}`);

    const opened = await d.open(`/hima/?run=${encodeURIComponent(view.run.id)}`);
    assert.ok(opened.ok, JSON.stringify(opened));
    const table = await d.wait('run-generations', String(rows[2]!.decision));
    assert.ok(table.ok, `wait run-generations: ${JSON.stringify(table)}`);
    assert.equal(table.state.count, '3', `three rows: ${JSON.stringify(table)}`);
    assert.equal(table.state.current, '3', 'the row a person is looking at is the last one');
    assert.deepEqual([table.state.g1, table.state.g2, table.state.g3], ['done', 'done', 'done'], JSON.stringify(table));

    // The card says what the route says. Numbers, not prose: the row's own values as the ledger
    // holds them have to be on the page, whatever the table's wording around them is.
    for (const row of rows) {
      assert.ok(table.text.includes(String(row.slackNs)), `generation ${row.generation}'s slack is on the card: ${table.text}`);
      for (const verdict of row.verdicts) {
        assert.ok(table.text.includes(`${verdict.outcome} ${verdict.ruleId}`), `generation ${row.generation} says ${verdict.outcome} of ${verdict.ruleId}: ${table.text}`);
      }
      assert.ok(table.text.includes(String(row.decision)), `generation ${row.generation}'s decision is on the card: ${table.text}`);
    }
    // The periods the chooser worked out, asked and observed. Generation one's own `2` is
    // deliberately not asked for here: a table of numbers holds the character "2" whatever it
    // prints, so that would be an assertion that cannot fail, which reads as coverage and is not.
    // Its numbers are held by the route above and by its slack of −0.2 on the line above this one.
    assert.ok(table.text.includes(String(rows[1]!.strategy.periodNs)), `the period generation one decided to try next is on the card: ${table.text}`);
    assert.ok(table.text.includes(String(rows[2]!.observedPeriodNs)), `and the period the last generation's report stated: ${table.text}`);
    assert.equal(wallTimesIn(table.text).length, rows.length, `one wall time per row: ${table.text}`);

    // And the banner says which generation of how many, beside the strategy, as `/hima status` does.
    const status = await d.read('run-status');
    assert.ok(status.ok, JSON.stringify(status));
    assert.ok(status.text.includes('generation 3 of at most 6'), `the banner says how far the Campaign got: ${status.text}`);
    assert.deepEqual(d.unexpectedStdout(), []);
  } finally {
    await d.dispose();
  }
});

test('a Campaign that meets its goal shows a row for each generation and says so on the last one', async (t) => {
  const d = await bootDriver(t, { home: 'hima' });
  if (!d) return;
  try {
    const host = await d.host();
    assert.ok(host.ok, JSON.stringify(host));
    const cookie = await d.cookie();

    const started = await api(host, cookie, '/hima/api/runs', {
      method: 'POST',
      body: JSON.stringify({ pack: timingProbePackId, site: 'local', goal: { target_period_ns: 2.30 }, strategy: { periodNs: 2.35 } }),
      headers: { 'content-type': 'application/json' },
    });
    const startedText = await started.text();
    assert.equal(started.status, 200, startedText);
    const view = JSON.parse(startedText) as RunView;
    assert.equal(view.run.status, 'ended-goal-met', startedText);

    const rows = view.generations;
    assert.equal(rows.length, 2, `two generations, two rows: ${JSON.stringify(rows)}`);
    assert.deepEqual(rows.map((r) => r.observedPeriodNs), [2.35, 2.30], 'the clock period each generation\'s report stated');
    assert.deepEqual(rows[0]!.strategy, { periodNs: 2.35 }, 'the first generation asked the flow for the period this campaign was started with');
    assert.deepEqual(rows[1]!.strategy, { periodNs: 2.30 }, 'the second generation was opened with the period the first decided on');
    assert.equal(rows[0]!.decision, 'next strategy: clock period 2.3 ns', 'the first generation missed the goal and chose what to try next, in the pack\'s own words');
    assert.equal(rows[1]!.decision, 'goal met', 'and the second met the goal');

    const opened = await d.open(`/hima/?run=${encodeURIComponent(view.run.id)}`);
    assert.ok(opened.ok, JSON.stringify(opened));
    const table = await d.wait('run-generations', 'goal met');
    assert.ok(table.ok, `wait run-generations: ${JSON.stringify(table)}`);
    assert.equal(table.state.count, '2', JSON.stringify(table));
    assert.equal(table.state.current, '2', JSON.stringify(table));
    assert.deepEqual([table.state.g1, table.state.g2], ['done', 'done'], JSON.stringify(table));
    // Generation one's asked Strategy, on the card, after the Run has ended — the row that showed an
    // em dash while the start's period lived only in the run row's `strategy`, which the Loop had
    // moved on by then. The whole cell and not the number alone: a dash on either side of the arrow
    // fails, and 2.35 is a spelling nothing else on this page holds. The asked side is the whole
    // Strategy in the pack's own words now (#58), which is what this pack calls its one knob.
    assert.ok(table.text.includes('clock period 2.35 ns → 2.35'), `generation one asked for 2.35 and its report stated 2.35: ${table.text}`);
    assert.equal(wallTimesIn(table.text).length, 2, `one wall time per row: ${table.text}`);
    assert.deepEqual(d.unexpectedStdout(), []);
  } finally {
    await d.dispose();
  }
});

test('the served HimaGuide bundle carries the generations table, as the workbench page does', async (t) => {
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

    // The card has two mounts and one table. Only spellings a minified React bundle cannot satisfy
    // by accident are asked for: the region's name and two of the column heads. The heads are
    // matched by their ASCII prefix, because esbuild escapes every non-ASCII character in a string
    // literal — the arrow this column head holds is `→` in the served bundle.
    assert.ok(source.includes('run-generations'), 'the chat\'s card marks the generations table the way the page does');
    assert.ok(source.includes('period (asked'), 'and heads its first quantity column in the same words');
    assert.ok(source.includes('wall time'), 'and says what each generation cost in wall clock');
    assert.deepEqual(d.unexpectedStdout(), []);
  } finally {
    await d.dispose();
  }
});

// ---------------------------------------------------------------------------------------------
// The card's words (#42): the four questions say the Goal and the Strategy in a person's words
//
// The pack declares what its numbers are called and what they are measured in; the one words table
// both mounts and `/hima status` read renders them, and falls back to the names for a pack that
// declares none. The wire is unchanged either way — `run.goal` and `run.strategy` keep the names —
// so what these assert is what a person reads, beside what the route still answers with.
// ---------------------------------------------------------------------------------------------

/** The shortest Campaign this pack runs: 2.25 ns is looser than the 2.20 ns the stand-in closes at,
 *  so one generation meets its constraint — reported, as Design Compiler reports one, at a slack of
 *  0.00 — and meets a 2.30 ns goal. What the banner says of a Goal and a Strategy does not depend on
 *  how many generations were needed to reach them. */
const ONE_GENERATION_BODY = { site: 'local', goal: { target_period_ns: 2.30 }, strategy: { periodNs: 2.25 } } as const;

test('the banner says the goal and the strategy in the pack\'s own words with their units, and a pack declaring none says the names', async (t) => {
  const d = await bootDriver(t, { home: 'hima' });
  if (!d) return;
  try {
    const host = await d.host();
    assert.ok(host.ok, JSON.stringify(host));
    const cookie = await d.cookie();

    const started = await api(host, cookie, '/hima/api/runs', {
      method: 'POST',
      body: JSON.stringify({ pack: timingProbePackId, ...ONE_GENERATION_BODY }),
      headers: { 'content-type': 'application/json' },
    });
    const startedText = await started.text();
    assert.equal(started.status, 200, startedText);
    const view = JSON.parse(startedText) as RunView;
    assert.equal(view.run.status, 'ended-goal-met', startedText);
    // The wire keeps the names: the words arrive beside the numbers, never instead of them.
    assert.deepEqual(view.run.goal, { target_period_ns: 2.3 }, startedText);
    assert.deepEqual(view.run.strategy, { periodNs: 2.25 }, startedText);
    assert.deepEqual(
      view.run.words,
      {
        goal: { target_period_ns: { label: 'clock period at most', unit: 'ns' } },
        strategy: { periodNs: { label: 'clock period', unit: 'ns' } },
      },
      `the run view carries the words the pack declares, resolved for this Run's pack: ${startedText}`,
    );

    const opened = await d.open(`/hima/?run=${encodeURIComponent(view.run.id)}`);
    assert.ok(opened.ok, JSON.stringify(opened));
    const said = await d.wait('run-status', 'goal: clock period at most 2.3 ns');
    assert.ok(said.ok, `wait run-status: ${JSON.stringify(said)}`);
    assert.ok(said.text.includes('strategy: clock period 2.25 ns'), `and the strategy in the same words: ${said.text}`);
    assert.ok(!said.text.includes('target_period_ns'), `the pack's parameter name is nowhere on the card: ${said.text}`);
    assert.ok(!said.text.includes('periodNs'), `nor the run row's own field name: ${said.text}`);

    // The same page for a pack that says nothing about its Goal's own parameter: that number under
    // the name the wire carries, exactly as every pack read before this block existed. Varied from
    // the shipped pack, so it differs only where it says it differs.
    //
    // Its *knob* keeps its words, because a knob is the pack's own invention and a pack that
    // declares one and says nothing about it is one `/hima pack check` refuses (#58) — there is
    // nothing else a person could read it as. A Goal parameter is not that: the harness carries it
    // under a name the pack chose, which is a name a person can read.
    const silent = 'says-no-words';
    await writePackVariant(packsDirOf(d.home), silent, [[shippedWordsBlock, `words:
  periodNs: { label: clock period, unit: ns }`]]);
    const plain = await api(host, cookie, '/hima/api/runs', {
      method: 'POST',
      body: JSON.stringify({ pack: silent, ...ONE_GENERATION_BODY }),
      headers: { 'content-type': 'application/json' },
    });
    const plainText = await plain.text();
    assert.equal(plain.status, 200, plainText);
    const plainView = JSON.parse(plainText) as RunView;
    assert.equal(plainView.run.status, 'ended-goal-met', plainText);
    assert.deepEqual(plainView.run.words?.goal, {}, `a pack saying nothing about its goal's parameter files no word for it: ${plainText}`);

    const openedPlain = await d.open(`/hima/?run=${encodeURIComponent(plainView.run.id)}`);
    assert.ok(openedPlain.ok, JSON.stringify(openedPlain));
    const names = await d.wait('run-status', 'goal: target_period_ns=2.3');
    assert.ok(names.ok, `wait run-status: ${JSON.stringify(names)}`);
    assert.ok(names.text.includes('strategy: clock period 2.25 ns'), `while the knob keeps the words its pack declares: ${names.text}`);
    assert.deepEqual(d.unexpectedStdout(), []);
  } finally {
    await d.dispose();
  }
});

test('/hima status says the goal and the strategy in the pack\'s words, and /hima pack check refuses a word for a name the pack does not use', async (t) => {
  const local = await localFabric(t);
  if (!local) return;
  const { h, host, dispose } = local;
  let sessions: string[] = [];
  try {
    const started = await himaCommand(
      host,
      h.workspace,
      `/hima run ${timingProbePackId} --site local --goal target_period_ns=2.3 --set periodNs=2.25`,
      siteCommandTimeoutMs,
    );
    assert.equal(started.kind, 'success', started.text);
    const runId = started.runId!;
    sessions = sessionsOf(host, runId);

    // The words table is one function, so what a command prints and what the window renders are one
    // sentence. Anchored to the whole line, because "the goal" said two ways in one answer is what
    // this ticket exists to end.
    const status = await himaCommand(host, h.workspace, `/hima status ${runId}`);
    assert.equal(status.kind, 'success', status.text);
    assert.match(status.text, /^ {2}goal: clock period at most 2\.3 ns$/m, `the goal in the pack's words: ${status.text}`);
    assert.match(status.text, /^ {2}strategy: clock period 2\.25 ns$/m, `and the strategy in the pack's words: ${status.text}`);

    // A word for a name the pack neither takes from its goal nor sets as a strategy knob: a label
    // that could never reach a person, said before a Campaign exists rather than never.
    await writePackVariant(packsDirOf(h), 'words-for-nothing', [[
      '  periodNs: { label: clock period, unit: ns }',
      '  cellAreaUm2: { label: cell area, unit: um2 }',
    ]]);
    const checked = await himaCommand(host, h.workspace, '/hima pack check words-for-nothing --site local');
    assert.equal(checked.kind, 'error', checked.text);
    assert.match(checked.text, /words: declares "cellAreaUm2", which this pack neither takes from its goal nor sets as a strategy knob/, checked.text);
    assert.match(checked.text, /"target_period_ns", "periodNs"/, `and says which names it does use: ${checked.text}`);
  } finally {
    killSessions(sessions);
    await dispose();
  }
});
