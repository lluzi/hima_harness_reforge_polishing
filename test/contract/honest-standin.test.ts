// Ticket #54: the stand-in flow reports setup slack the way Design Compiler does, and what that
// costs the push rule the reference pack names.
//
// The step-3 acceptance on the reference site (D45) ran six generations and converged on nothing:
// Design Compiler reports a setup slack of exactly `0.00` whenever the period it was given is met,
// so `timing-push`'s met-constraint clause — `period − slack + guardBandNs` — read the margin as
// nothing and loosened the period by the whole guard band, generation after generation, from 2.28 ns
// out to 2.53 ns. The stand-in flow hid it, because its slack used to be `period − achievable`:
// continuous and positive above the achievable period, so the same clause walked *in* and stopped.
//
// This is the falsifier for the honest slack. One stand-in flow, one starting period at 2.30 ns —
// above the 2.20 ns the flow closes at, so the very case the site ran into — and two choosers:
// `timing-push` reproduces the D45 trace exactly, and `over-constraining-push`, which never asks a
// met period what margin it had, reaches an ending on the same flow. Run against the old continuous
// slack the first half of this test converges, which is the bug it exists to catch.
//
// Three Campaigns, because `over-constraining-push` has two endings and both are the pack's promise:
// against a goal this design cannot reach it walks in and converges one step below what the tool
// violated at, and against one it can reach its goal-met clause ends the Campaign happily. The third
// is the other half of #54's worked example, and the only test in the suite that reaches that clause.
//
// PLS-03: the same three Campaigns run through the real HTTP Host and local Jobs.
// Window assertions remain in honest-standin-window.test.ts; no engine or reader is replaced.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootHimaHost, type BootedHost } from './support/boot-host.ts';
import { localHome } from './support/fabric.ts';
import { api, openSession } from './support/hima-api.ts';
import { installLegacyTimingPush, packsDirOf, timingProbePackId } from './support/pack.ts';
import type { RunView } from '@hima/harness';

/** One second of synthesis per generation: this test runs fourteen of them and none of its subjects is
 *  what a Job does while it sleeps. */
const SYNTH_SECONDS = 1;

/** The period every Campaign here starts at, in ns: above the 2.20 ns the stand-in closes at, which
 *  is where a real tool reports no margin at all and where D45's Campaign began. */
const START_NS = 2.3;

/** A goal tighter than this flow will ever close at, so what ends a Campaign asked for it is what
 *  its chooser learned and never the goal rule. The default of the two first Campaigns below. */
const UNREACHABLE_NS = 2.0;

/** A goal the flow can reach, one step in from where the Campaign starts: 2.30 meets its constraint
 *  but misses this, and the step the chooser takes lands exactly on it. */
const REACHABLE_NS = 2.25;

/** Start one Campaign and wait for it, as the window's own start does: the route answers with the
 *  whole run view once the Run has ended. */
async function campaign(cookie: string, pack: string, host: { readonly url: string }, targetNs = UNREACHABLE_NS, generationLimit?: number, startNs = START_NS): Promise<RunView> {
  const started = await api(host, cookie, '/hima/api/runs', {
    method: 'POST',
    body: JSON.stringify({ pack, site: 'local', goal: { target_period_ns: targetNs }, strategy: { periodNs: startNs }, ...(generationLimit === undefined ? {} : { generations: generationLimit }) }),
    headers: { 'content-type': 'application/json' },
  });
  const text = await started.text();
  assert.equal(started.status, 200, text);
  return JSON.parse(text) as RunView;
}

test('on a stand-in that reports no margin for a met period, timing-push loosens by its guard band every generation and ends at the limit, while over-constraining-push converges below the achievable period and ends goal-met when the goal is reachable', async (t) => {
  const local = await localHome(t, { sleepSeconds: SYNTH_SECONDS });
  if (!local) return;
  const { h } = local;
  let host: BootedHost | undefined;
  try {
    host = await bootHimaHost(h);
    const cookie = await openSession(host);

    // The explicit legacy method: the D45 trace. Every generation meets the period it was asked
    // for, so every generation reads a slack of exactly 0.00 and the push clause computes
    // `period − 0 + 0.05` — one guard band looser than the period that just passed. Nothing ever
    // violates, nothing ever stops moving, and the Campaign runs out the six generations the pack
    // allows it.
    const legacy = await installLegacyTimingPush(packsDirOf(h));
    const pushed = await campaign(cookie, legacy, host);
    assert.deepEqual(
      pushed.generations.map((r) => r.observedPeriodNs),
      [2.3, 2.35, 2.4, 2.45, 2.5, 2.55],
      `the asked period walks away from the achievable one by exactly the guard band: ${JSON.stringify(pushed.generations.map((r) => r.observedPeriodNs))}`,
    );
    assert.deepEqual(
      pushed.generations.map((r) => r.slackNs),
      [0, 0, 0, 0, 0, 0],
      'because a met period reports no margin at all, which is the whole of D45',
    );
    assert.equal(pushed.run.status, 'ended-budget-exhausted', `and never ended-converged: ${JSON.stringify(pushed.run)}`);
    assert.equal(pushed.run.meters?.endedBy, 'generation-limit', 'the meter that ended it is what it was allowed, not what it learned');
    assert.equal(pushed.run.generation, 6, 'all six generations of the pack were spent');

    // The same flow, the same starting period, the second shipped chooser. It never asks a met
    // period what it had to spare: it takes one step tighter each time and lets the tool state the
    // achievable period by violating. 2.15 misses by 0.05, which says the design closes at 2.20, so
    // it asks for 2.15 again — and two generations asking and measuring the same period is what the
    // pack calls having stopped learning.
    const honest = timingProbePackId;
    const converged = await campaign(cookie, honest, host);
    assert.deepEqual(
      converged.generations.map((r) => r.observedPeriodNs),
      [2.3, 2.25, 2.2, 2.15, 2.15],
      `the asked period walks in one step at a time and settles one step below what the tool violated at: ${JSON.stringify(converged.generations.map((r) => r.observedPeriodNs))}`,
    );
    assert.deepEqual(
      converged.generations.map((r) => r.slackNs),
      [0, 0, 0, -0.05, -0.05],
      'three met periods reporting nothing, then the violation that states where the design closes',
    );
    assert.equal(converged.run.status, 'ended-converged', `the exploration reached an ending of its own: ${JSON.stringify(converged.run)}`);
    assert.equal(converged.run.generation, 5, 'at the fifth generation, inside the six the pack allows');
    assert.ok(converged.decision, 'the ending is a decision, on record');
    assert.deepEqual(
      converged.decision.chosen,
      { converged: { read: 'period', band: 0.05, generations: 1, values: [2.15, 2.15] } },
      `the values compared are the two that did not move: ${JSON.stringify(converged.decision.chosen)}`,
    );

    // And the violation is on the record the Campaign was run to produce: what this design actually
    // closes at is stated by the tool, not inferred from a margin it never reported.
    const last = converged.generations.at(-1)!;
    assert.deepEqual(
      last.verdicts.map((v) => `${v.ruleId}=${v.outcome}`),
      ['setup-wns-all-nonnegative=FAIL', 'clock-period-at-most=FAIL'],
      `the generation it converged on is the one that violated: ${JSON.stringify(last.verdicts)}`,
    );

    // The real window checks for this decision live in honest-standin-window.test.ts.
    const valid = converged.generations.filter((row) => row.verdicts.some((v) => v.ruleId === 'setup-wns-all-nonnegative' && v.outcome === 'PASS'));
    assert.deepEqual(valid.map((row) => row.observedPeriodNs), [2.3, 2.25, 2.2], 'only measured setup-PASS generations are closed results; 2.15 remains a violation');

    // The third Campaign, on the same flow and the same chooser, with the one thing changed that the
    // chooser's remaining clause turns on: a Goal this design can actually reach. Generation one asks
    // for 2.30, which the flow meets — constraint PASS — and which misses a 2.25 goal, so the first
    // clause does not match and the PASS clause takes one step in: 2.30 − 0.05 = 2.25. Generation two
    // meets 2.25 and *is* 2.25, so both verdicts pass, and `{ constraint: PASS, goal: PASS }` is the
    // clause that has nothing left to ask for: the decision is that the Goal is met, and the Campaign
    // ends there rather than exploring on.
    const met = await campaign(cookie, honest, host, REACHABLE_NS);
    assert.equal(met.run.status, 'ended-goal-met', `the goal-met clause ended it: ${JSON.stringify(met.run)}`);
    assert.equal(met.run.generation, 2, 'at the second generation, one step in from where it started');
    assert.deepEqual(
      met.generations.map((r) => r.observedPeriodNs),
      [START_NS, REACHABLE_NS],
      `one step in and no further: ${JSON.stringify(met.generations.map((r) => r.observedPeriodNs))}`,
    );
    assert.deepEqual(
      met.generations.at(-1)!.verdicts.map((v) => `${v.ruleId}=${v.outcome}`),
      ['setup-wns-all-nonnegative=PASS', 'clock-period-at-most=PASS'],
      `both rules passed, which is the pair that clause is about: ${JSON.stringify(met.generations.at(-1)!.verdicts)}`,
    );
    assert.ok(met.decision, 'and the ending is a decision, on record');
    assert.deepEqual(met.decision.chosen, { goalMet: true }, `the clause's own word, and no next Strategy: ${JSON.stringify(met.decision.chosen)}`);

    const limited = await campaign(cookie, timingProbePackId, host, UNREACHABLE_NS, 1, 2.0);
    assert.equal(limited.run.status, 'ended-budget-exhausted');
    assert.equal(limited.run.meters?.endedBy, 'generation-limit');
    assert.deepEqual(limited.generations.map((row) => row.observedPeriodNs), [2.0], 'the proposed next period is not a measured result');
    assert.deepEqual(limited.decision?.chosen, { strategy: { periodNs: 2.15 } });
    assert.deepEqual(limited.generations.filter((row) => row.verdicts.some((v) => v.ruleId === 'setup-wns-all-nonnegative' && v.outcome === 'PASS')), [], 'there is no measured closed result in this budget-limited run');

  } finally {
    try { if (host) await host.stop(); } finally { await h.dispose(); }
  }
});
