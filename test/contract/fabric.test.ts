// @hima-seam tools direct
// Ticket #13: one generation on the local site. `/hima run` starts a Campaign and a Run, and
// HimaFabric executes the pack's graph end to end: the act node launches the synthesis Job in the
// Campaign workspace and waits for it, the next act node reads the qor report the generation
// produced, the judge node applies the setup rule and the goal rule with the Run's goal bound, the
// explore node writes the decision, and the Run ends with its status.
//
// Everything is driven through the booted host — the `/hima run` and `/hima status` command faces,
// the `hima_run` tool, and `POST /hima/api/runs` — and asserted on what comes back out: the ledger's
// node, job, observation, verdict and decision records, the run record's fabric state, and the run
// view. Local site only; the reference site is #17.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readdir, realpath } from 'node:fs/promises';
import { createHimaHome, type HimaHome } from './support/dsh-home.ts';
import { bootInProcess, createRootAgent, type InProcessHost } from './support/boot-inprocess.ts';
// The pieces every fabric suite composes: the home a Run is driven in, and the ledger as a test
// reads it. One copy, so three suites cannot come to describe one harness three ways.
import { jobRecords, killSessions, localFabric, nodeRecords, ONE_GENERATION, recordsOf, runOf, sessionsOf } from './support/fabric.ts';
import { bootHimaHost, type BootedHost } from './support/boot-host.ts';
import { api, openSession } from './support/hima-api.ts';
import { himaCommand, siteCommandTimeoutMs } from './support/command.ts';
import { writeLocalSite } from './support/site.ts';
import { installPack, packsDirOf, timingProbePackId, writePackVariant } from './support/pack.ts';
import { writeStandinFlow } from './support/standin-flow.ts';
// tmux itself, asked by the one module that owns that question for this suite.
import { tmuxHasSession } from './support/tmux.ts';
import { badStrategyValue, clearRemoteCommands, remoteCommands } from '@hima/harness';
import type {} from '@deepseek-ai/dsh-tools';
import type {
  DecisionRecord,
  LedgerRecord,
  ObservationRecord,
  RunRecord,
  RunView,
  VerdictRecord,
} from '@hima/harness';

/** What the stand-in flow closes at (#25): every generation's setup slack is the shortfall against
 *  this, and nothing at all when there is none (#54), so what a generation measures follows from what
 *  it was told to try. */
const achievableNs = 2.2;
/** The guard band `graph.yml` declares for the `timing-push` chooser. */
const guardBandNs = 0.05;
/** What the stand-in's report states for a generation asked for this period: the period back, and
 *  the setup slack it computed, both to the two decimals Design Compiler prints. */
const reportedAt = (periodNs: number): { readonly periodNs: number; readonly slackNs: number } => ({
  periodNs: Number(periodNs.toFixed(2)),
  // `min(0, …)`, as Design Compiler reports one (#54): a met period is reported with no margin at
  // all, and only a violated one states a number.
  slackNs: Math.min(0, Number((periodNs - achievableNs).toFixed(2))),
});

const observations = (host: InProcessHost, runId: string): ObservationRecord[] =>
  recordsOf(host, runId).filter((r): r is ObservationRecord => r.type === 'observation');
const verdicts = (host: InProcessHost, runId: string): VerdictRecord[] =>
  recordsOf(host, runId).filter((r): r is VerdictRecord => r.type === 'verdict');
const decisions = (host: InProcessHost, runId: string): DecisionRecord[] =>
  recordsOf(host, runId).filter((r): r is DecisionRecord => r.type === 'decision');

/** One typed value of an observation, by type. */
function valueOf(record: ObservationRecord, type: string): number | null | undefined {
  return record.values.find((v) => v.type === type)?.value;
}

/**
 * Everything one generation of the timing probe must have left in the ledger, whichever face started
 * it. Held in one place so the command face, the tool face and the route are asserted against the
 * same generation rather than three descriptions of it that could drift apart.
 */
async function assertOneGeneration(host: InProcessHost, h: HimaHome, runId: string, goalNs: number): Promise<void> {
  const run = runOf(host, runId);
  // Every one of these runs asks for the goal's own period, so what the stand-in reported back is
  // what that period produces.
  const measured = reportedAt(goalNs);
  const workspace = path.join(await realpath(h.workspace), run.campaignId);

  // The four nodes of the graph, each entered and each settled, in the order the edges lead.
  assert.deepEqual(
    nodeRecords(host, runId).map((r) => [r.nodeId, r.kind, r.state]),
    [
      ['synthesize', 'act', 'running'], ['synthesize', 'act', 'done'],
      ['read-qor', 'act', 'running'], ['read-qor', 'act', 'done'],
      ['judge', 'judge', 'running'], ['judge', 'judge', 'done'],
      ['next-period', 'explore', 'running'], ['next-period', 'explore', 'done'],
    ],
    'launch, read, judge, decide — every transition a record',
  );
  for (const record of nodeRecords(host, runId)) {
    assert.equal(record.writer, 'executor', 'the executor records what the fabric did');
    assert.equal(record.attempt, 1, 'one attempt each: nothing failed');
  }

  // The Job: launched and finished with exit 0, in the Campaign's own workspace, named by its node.
  const jobs = jobRecords(host, runId);
  assert.deepEqual(jobs.map((r) => r.event), ['launched', 'finished'], 'launched then finished, once each');
  assert.equal(jobs[0]!.job.workspace, workspace, 'the job ran in the campaign workspace, never in the flow root');
  assert.equal(jobs[0]!.job.name, 'synthesize', 'the job is named after the act node that launched it');
  assert.equal(jobs[0]!.nodeId, 'synthesize', 'and the record says which node it belongs to');
  assert.ok(jobs[0]!.job.wire.includes('CLOCK_PERIOD_NS='), `the tool's command line carries the strategy: ${jobs[0]!.job.wire}`);
  // The container the flow's wrapper creates is the one thing the copy's own location cannot make
  // safe (PACK.md, "Where a generation runs"): under the Site's container name this generation would
  // write the Site's own results. So the name is asserted on the wire, for this Run's own campaign.
  assert.ok(
    jobs[0]!.job.wire.includes(`EDA_CONTAINER_NAME=hima-${run.campaignId}`),
    `the command line binds the campaign's own container: ${jobs[0]!.job.wire}`,
  );
  assert.equal(jobs[1]!.exitCode, 0, 'the exit code came back from the exit file the launch wrote');
  assert.deepEqual(
    nodeRecords(host, runId).find((r) => r.nodeId === 'synthesize' && r.state === 'running')?.jobSession,
    jobs[0]!.job.session,
    'the node record names the session it waited on',
  );

  // The observation: the qor report the generation itself produced, read by the contract's reader.
  const observed = observations(host, runId);
  assert.equal(observed.length, 1, 'one report read');
  assert.equal(observed[0]!.path, path.join(workspace, 'flow/results/opene902/syn/report/qor.rpt'));
  assert.equal(observed[0]!.reader.id, 'dc-qor-report');
  assert.equal(valueOf(observed[0]!, 'clock_period'), measured.periodNs, 'the period is read back from the report, never assumed');
  assert.equal(valueOf(observed[0]!, 'setup_wns'), measured.slackNs, 'and the slack the stand-in computed for it');

  // The verdicts: the setup rule, then the goal rule with the Run's goal bound.
  const ruled = verdicts(host, runId);
  assert.deepEqual(ruled.map((v) => v.ruleId), ['setup-wns-all-nonnegative', 'clock-period-at-most']);
  assert.equal(ruled[0]!.outcome, measured.slackNs >= 0 ? 'PASS' : 'FAIL', `setup WNS is ${measured.slackNs} ns`);
  assert.equal(ruled[1]!.outcome, measured.periodNs <= goalNs ? 'PASS' : 'FAIL');
  assert.deepEqual(ruled[1]!.boundParameters, { target_period_ns: goalNs }, 'the goal rule was judged against the Run\'s own goal');
  for (const v of ruled) assert.deepEqual(v.cites, [observed[0]!.id], 'both verdicts cite the generation\'s own observation');

  // The decision: deterministic pack data, citing the two verdicts and the observation.
  const decided = decisions(host, runId);
  assert.equal(decided.length, 1, 'one decision');
  assert.equal(decided[0]!.nodeId, 'next-period');
  assert.equal(decided[0]!.chooser, 'timing-push');
  assert.equal(decided[0]!.writer, 'executor');
  assert.deepEqual(decided[0]!.cites, [ruled[0]!.id, ruled[1]!.id, observed[0]!.id], 'the verdicts it weighed and the observation it read');
  assert.deepEqual(
    decided[0]!.rationale,
    { period: measured.periodNs, slack: measured.slackNs, guardBandNs },
    'the numbers it used, named as the chooser file names them, so the choice can be re-derived from the ledger alone',
  );
}

test('a run on the local site executes launch, read, judge, decide in one generation, and ends at the generation it was allowed with the next strategy recorded', async (t) => {
  const local = await localFabric(t);
  if (!local) return;
  const { h, host, dispose } = local;
  let sessions: string[] = [];
  try {
    // One generation, because this test is about one: the pack's own loop would go round again with
    // the period the chooser chose (that is `loop.test.ts`), and a Campaign allowed one generation
    // stops after the decision with the strategy it was not allowed to try on record.
    const started = await himaCommand(
      host,
      h.workspace,
      `/hima run ${timingProbePackId} --site local --goal target_period_ns=2.0 --set periodNs=2.0 ${ONE_GENERATION}`,
      siteCommandTimeoutMs,
    );
    // What a person sees, in the suite's own output: this is the demo of the ticket.
    for (const line of started.text.split('\n')) t.diagnostic(line);
    assert.equal(started.kind, 'success', started.text);
    const runId = started.runId!;
    assert.ok(runId, `the run command names its run: ${started.text}`);
    sessions = sessionsOf(host, runId);

    await assertOneGeneration(host, h, runId, 2.0);

    const run = runOf(host, runId);
    assert.equal(run.status, 'ended-budget-exhausted', 'the generation it was allowed is the one it ran');
    assert.equal(run.meters?.endedBy, 'generation-limit', 'and that is the meter that ended it');
    assert.equal(run.generation, 1, 'it never opened a second generation');
    assert.equal(run.currentNode, 'next-period', 'the run ended where the decision was made');
    assert.deepEqual(run.goal, { target_period_ns: 2.0 }, 'the goal is what the run was started with');
    assert.deepEqual(run.strategy, { periodNs: 2.0 }, 'the strategy is still the one that ran: the next was never opened');
    // FAIL: the next period is the period plus what it missed by, plus the guard band.
    assert.deepEqual(decisions(host, runId)[0]!.chosen, { strategy: { periodNs: 2.25 } }, '2.00 + 0.20 + 0.05');
    assert.equal(run.meters?.jobsLaunched, 1);
    assert.equal(run.meters?.attempts, 4, 'one attempt at each of the four nodes');
    assert.ok((run.meters?.elapsedMs ?? 0) > 0, 'the time meter moved');
    assert.equal(run.budget?.retryAllowance, 3, 'the default retry allowance');
    assert.equal(run.budget?.timeBoxMs, 60 * 60_000, 'the default time box is sixty minutes');
    assert.equal(run.budget?.generationLimit, 1, 'the generation limit is the one this run asked for');
    assert.equal(run.budget?.jobCap, 1, 'the job cap is the site\'s declared parallel job count');
  } finally {
    killSessions(sessions);
    await dispose();
  }
});

test('a run whose generation already meets the goal ends goal-met, with no next strategy chosen', async (t) => {
  const local = await localFabric(t);
  if (!local) return;
  const { h, host, dispose } = local;
  let sessions: string[] = [];
  try {
    const started = await himaCommand(
      host,
      h.workspace,
      `/hima run ${timingProbePackId} --site local --goal target_period_ns=2.3 --set periodNs=2.3`,
      siteCommandTimeoutMs,
    );
    assert.equal(started.kind, 'success', started.text);
    const runId = started.runId!;
    sessions = sessionsOf(host, runId);

    await assertOneGeneration(host, h, runId, 2.3);

    const run = runOf(host, runId);
    assert.equal(run.status, 'ended-goal-met', '2.30 ns is met — reported at a slack of 0.00 — and is at most 2.3 ns');
    assert.equal(run.generation, 1, 'the first generation answered the question');
    assert.deepEqual(decisions(host, runId)[0]!.chosen, { goalMet: true }, 'both rules passed: there is nothing to try next');
    assert.deepEqual(run.strategy, { periodNs: 2.3 }, 'the strategy is still the one that ran: no next strategy was chosen');
  } finally {
    killSessions(sessions);
    await dispose();
  }
});

test('a spent time box kills the running job, leaves no tmux session, and ends the run budget-exhausted naming the meter', async (t) => {
  // Twenty seconds of stand-in synthesis against a time box of five (0.0833 min): the box is spent
  // long before the job could finish, so what the run does about it is what is under test.
  const local = await localFabric(t, { sleepSeconds: 20 });
  if (!local) return;
  const { h, host, dispose } = local;
  let sessions: string[] = [];
  try {
    const started = await himaCommand(
      host,
      h.workspace,
      `/hima run ${timingProbePackId} --site local --goal target_period_ns=2.0 --set periodNs=2.0 --time-box 0.0833`,
      siteCommandTimeoutMs,
    );
    for (const line of started.text.split('\n')) t.diagnostic(line);
    const runId = started.runId!;
    assert.ok(runId, `the run command names its run even when the budget ends it: ${started.text}`);
    sessions = sessionsOf(host, runId);
    assert.equal(sessions.length, 1, 'one job was launched');

    const run = runOf(host, runId);
    assert.equal(run.status, 'ended-budget-exhausted');
    assert.equal(run.meters?.endedBy, 'time-box', 'the record says which meter ended it');
    assert.equal(run.currentNode, 'synthesize', 'the run ended at the node that was running');

    assert.deepEqual(jobRecords(host, runId).map((r) => r.event), ['launched', 'killed'], 'the job was stopped, and the stop was observed');
    const nodes = nodeRecords(host, runId);
    assert.deepEqual(nodes.map((r) => [r.nodeId, r.state]), [['synthesize', 'running'], ['synthesize', 'cancelled']]);
    assert.equal(nodes.at(-1)!.jobSession, sessions[0], 'the cancelled node names the session that was killed');
    assert.ok(!tmuxHasSession(sessions[0]!), 'tmux itself says nothing is left running');
    assert.deepEqual(observations(host, runId), [], 'nothing was read: the generation never produced a report');
    assert.deepEqual(decisions(host, runId), [], 'and nothing was decided');
  } finally {
    killSessions(sessions);
    await dispose();
  }
});

test('a run of a pack naming a chooser this harness does not ship is refused before a campaign exists', async (t) => {
  const local = await localFabric(t);
  if (!local) return;
  const { h, host, dispose } = local;
  try {
    // The pack the repository ships, varied in one place: its explore node names a chooser id no
    // `choosers/` file declares. `/hima pack check` catches it, and so does the run that would
    // otherwise copy the flow, burn a licence-minute, judge the report, and only then find out.
    await writePackVariant(packsDirOf(h), 'unknown-chooser-run', [], [['      chooser: timing-push', '      chooser: no-such-chooser']]);
    const started = await himaCommand(host, h.workspace, '/hima run unknown-chooser-run --site local --goal target_period_ns=2.0 --set periodNs=2.0', siteCommandTimeoutMs);
    assert.equal(started.kind, 'error', started.text);
    assert.match(started.text, /unfit/, started.text);
    assert.match(started.text, /unknown chooser "no-such-chooser"/, started.text);
    assert.equal(started.runId, undefined, `no Campaign, no Run, no record: the answer names none: ${started.text}`);
  } finally {
    await dispose();
  }
});

test('an act node naming an argument the Run cannot bind blocks with a reason naming it, and launches nothing', async (t) => {
  const local = await localFabric(t);
  if (!local) return;
  const { h, host, dispose } = local;
  try {
    // The shipped pack, varied in one place: its act node asks the Run's Goal for a knob no Goal
    // binds. Nothing in the knob set can be checked statically for a Goal — its names come from the
    // Run, not the pack — so this is the path where the fabric itself must say what went wrong.
    await writePackVariant(packsDirOf(h), 'unbindable-argument', [], [
      ['PERIOD_NS: { from: strategy, name: periodNs }', 'PERIOD_NS: { from: goal, name: no_such_knob }'],
    ]);
    clearRemoteCommands();
    const started = await himaCommand(host, h.workspace, '/hima run unbindable-argument --site local --goal target_period_ns=2.0 --set periodNs=2.0', siteCommandTimeoutMs);
    for (const line of started.text.split('\n')) t.diagnostic(line);
    assert.equal(started.kind, 'error', started.text);
    const runId = started.runId!;
    assert.ok(runId, `the run is named even when it stops at its first node: ${started.text}`);

    const run = runOf(host, runId);
    assert.equal(run.status, 'waiting', 'a run that needs a person waits; it did not end');
    const nodes = nodeRecords(host, runId);
    assert.deepEqual(nodes.map((r) => [r.nodeId, r.state]), [['synthesize', 'blocked']], 'one record, and it says the node is blocked');
    assert.match(nodes[0]!.reason ?? '', /PERIOD_NS/, `the reason names the argument: ${nodes[0]!.reason}`);
    assert.match(nodes[0]!.reason ?? '', /no_such_knob/, `and what it asked the Run for: ${nodes[0]!.reason}`);
    assert.match(started.text, /synthesize \(act\): blocked, attempt 1, node synthesize names argument PERIOD_NS/, `and a person reads it in the answer: ${started.text}`);

    assert.deepEqual(jobRecords(host, runId), [], 'nothing was launched');
    assert.deepEqual(
      remoteCommands().filter((c) => c.argv[0] === 'tmux'),
      [],
      'and the site was never asked to start a session',
    );
  } finally {
    await dispose();
  }
});

test('a fault thrown mid-drive is a blocked node with the message on it, not a stack trace and a run still claiming to be running', async (t) => {
  const local = await localFabric(t);
  if (!local) return;
  const { h, host, dispose } = local;
  let sessions: string[] = [];
  try {
    // The shipped pack, varied in one place: the output the observe node reads is the report
    // *directory*. Nothing refuses it — the permit resolves it and allows it, the reader exists —
    // and the read itself throws EISDIR from inside the node's turn. That is the shape of every
    // fault this boundary is for (a Site that went away, a status that could not be asked), and it
    // is the one such fault the local site can be made to produce on demand.
    await writePackVariant(packsDirOf(h), 'reads-a-directory', [
      ['    path: flow/results/${design}/syn/report/qor.rpt', '    path: flow/results/${design}/syn/report'],
    ]);
    const started = await himaCommand(host, h.workspace, '/hima run reads-a-directory --site local --goal target_period_ns=2.0 --set periodNs=2.0', siteCommandTimeoutMs);
    for (const line of started.text.split('\n')) t.diagnostic(line);
    assert.equal(started.kind, 'error', started.text);
    const runId = started.runId!;
    assert.ok(runId, `the answer names the run the fault stopped: ${started.text}`);
    assert.match(started.text, /EISDIR/, `and carries the message: ${started.text}`);
    sessions = sessionsOf(host, runId);

    const run = runOf(host, runId);
    assert.equal(run.status, 'waiting', 'a run nothing is advancing does not claim to be running');
    const nodes = nodeRecords(host, runId);
    assert.deepEqual(
      nodes.map((r) => [r.nodeId, r.state]),
      [['synthesize', 'running'], ['synthesize', 'done'], ['read-qor', 'running'], ['read-qor', 'blocked']],
      'the node the fault happened at is blocked; everything before it stands',
    );
    assert.match(nodes.at(-1)!.reason ?? '', /EISDIR/, `the record carries the message: ${nodes.at(-1)!.reason}`);
    // The Job the run launched is still findable through its own records, which is what a person
    // needs and what #14 will reconcile from.
    assert.deepEqual(jobRecords(host, runId).map((r) => r.event), ['launched', 'finished'], 'the job it launched is on the ledger, with what became of it');

    const status = await himaCommand(host, h.workspace, `/hima status ${runId}`);
    assert.match(status.text, /read-qor \(act\): blocked, attempt 1, .*EISDIR/, status.text);
  } finally {
    killSessions(sessions);
    await dispose();
  }
});

test('POST /hima/api/runs answers a mid-drive fault as hima/internal carrying the run id and the message', async (t) => {
  const h = await createHimaHome();
  const flow = await writeStandinFlow(t, h);
  if (!flow) { await h.dispose(); return; }
  await installPack(h);
  await writeLocalSite(h, {
    allowedReadRoots: [h.workspace, flow.root],
    allowedWriteRoots: [h.workspace],
    bindings: { flowRoot: flow.root, design: flow.design, workspaceRoot: h.workspace },
  });
  await writePackVariant(packsDirOf(h), 'reads-a-directory', [
    ['    path: flow/results/${design}/syn/report/qor.rpt', '    path: flow/results/${design}/syn/report'],
  ]);
  let host: BootedHost | undefined;
  try {
    host = await bootHimaHost(h);
    const cookie = await openSession(host);
    const answered = await api(host, cookie, '/hima/api/runs', {
      method: 'POST',
      body: JSON.stringify({ pack: 'reads-a-directory', site: 'local', goal: { target_period_ns: 2.0 }, strategy: { periodNs: 2.0 } }),
      headers: { 'content-type': 'application/json' },
    });
    const text = await answered.text();
    assert.equal(answered.status, 500, text);
    const body = JSON.parse(text) as { error: { code: string; message: string } };
    assert.equal(body.error.code, 'hima/internal', text);
    // The run id and the message, so the caller can read the Run back through this same namespace
    // and see the blocked node the fault was recorded on.
    assert.match(body.error.message, /^run run-[0-9a-f-]+ stopped at node read-qor: EISDIR/, body.error.message);
    const runId = /run-[0-9a-f-]+/.exec(body.error.message)![0];
    const fetched = await api(host, cookie, `/hima/api/runs/${runId}`);
    const view = JSON.parse(await fetched.text()) as RunView;
    assert.equal(view.run.status, 'waiting');
    assert.match(view.nodes.at(-1)!.reason ?? '', /EISDIR/, JSON.stringify(view.nodes));
  } finally {
    if (host) {
      const code = await host.stop();
      assert.equal(code, 0, `host exited ${code}\n${host.stderr()}`);
    }
    await h.dispose();
  }
});

test('waiting for a long job backs off, so the launch is still in the channel\'s audit when the run ends', async (t) => {
  // Twelve seconds of stand-in synthesis. At a flat half-second look that is some twenty-four looks
  // and forty-eight remote commands; a real generation is 150 seconds, which at that rate overruns
  // the channel's 500-entry audit and evicts the very launch the audit exists to show.
  const local = await localFabric(t, { sleepSeconds: 12 });
  if (!local) return;
  const { h, host, dispose } = local;
  let sessions: string[] = [];
  try {
    clearRemoteCommands();
    const started = await himaCommand(host, h.workspace, `/hima run ${timingProbePackId} --site local --goal target_period_ns=2.0 --set periodNs=2.0 ${ONE_GENERATION}`, siteCommandTimeoutMs);
    assert.equal(started.kind, 'success', started.text);
    sessions = sessionsOf(host, started.runId!);

    const looks = remoteCommands().filter((c) => c.argv[0] === 'tmux' && c.argv[1] === 'has-session').length;
    t.diagnostic(`${looks} looks at the job over twelve seconds of synthesis`);
    assert.ok(looks <= 18, `half a second for the first five, three seconds after that: ${looks} looks is not a back-off`);
    assert.ok(
      remoteCommands().some((c) => c.argv[0] === 'tmux' && c.argv[1] === 'new-session'),
      'and the launch itself is still in the audit when the run ends',
    );
  } finally {
    killSessions(sessions);
    await dispose();
  }
});

test('the hima_run tool starts the same run as the command, and answers with the run it started', async (t) => {
  const local = await localFabric(t);
  if (!local) return;
  const { h, host, dispose } = local;
  let sessions: string[] = [];
  try {
    assert.ok(host.ctx.tools.schemas().some((s) => s.name === 'hima_run'), 'the tool is registered');
    const agent = await createRootAgent(host.ctx, h.workspace);
    const result = await host.ctx.tools.execute({
      callId: 'call-hima-run' as never,
      name: 'hima_run',
      arguments: { pack: timingProbePackId, site: 'local', goal: { target_period_ns: 2.0 }, strategy: { periodNs: 2.0 }, generations: 1 },
      agent,
      signal: AbortSignal.timeout(siteCommandTimeoutMs),
    });
    assert.equal(result.isError, false, JSON.stringify(result));
    const value = (result as unknown as { value?: { kind: string; runId?: string; status?: string } }).value!;
    assert.equal(value.kind, 'ran');
    const runId = value.runId!;
    assert.ok(runId, `the tool answers with the run it started: ${JSON.stringify(value)}`);
    assert.equal(value.status, 'ended-budget-exhausted', 'one generation, as the tool asked for');
    sessions = sessionsOf(host, runId);
    // The same generation the command face produces, asserted the same way.
    await assertOneGeneration(host, h, runId, 2.0);
  } finally {
    killSessions(sessions);
    await dispose();
  }
});

test('the command face and the tool face refuse a number the same way, in the same words, and start nothing', async (t) => {
  const local = await localFabric(t);
  if (!local) return;
  const { h, host, dispose } = local;
  try {
    // A negative clock period is not a value any face may take. Before, the tool checked only that
    // it was a number and synthesized at it; a negative time box reached the run row's own schema
    // and came back as a raw validation error nobody wrote. What a period may be is the *pack's* to
    // say now (#58) — the shipped contract declares `periodNs` from 0.5 through 10 ns — and every
    // face refuses a value outside it in the one sentence that declaration composes.
    const knob = { type: 'number', unit: 'ns', min: 0.5, max: 10, default: 2.3 } as const;
    const outsideTheKnob = badStrategyValue('periodNs', knob, -5);
    const agent = await createRootAgent(host.ctx, h.workspace);
    const result = await host.ctx.tools.execute({
      callId: 'call-hima-run-bad-period' as never,
      name: 'hima_run',
      arguments: { pack: timingProbePackId, site: 'local', goal: { target_period_ns: 2.0 }, strategy: { periodNs: -5 } },
      agent,
      signal: AbortSignal.timeout(siteCommandTimeoutMs),
    });
    assert.equal(result.isError, true, JSON.stringify(result));
    const said = JSON.stringify(result);
    // The tool's answer is JSON, so the sentence is in it with its quotes escaped: compared as the
    // JSON holds it rather than by a looser match that a half-sentence would satisfy.
    assert.ok(said.includes(JSON.stringify(outsideTheKnob).slice(1, -1)), `the tool says what the shared validator says: ${said}`);
    assert.deepEqual(await readdir(h.workspace), [], 'no Campaign and no Run: the value was refused before anything was created');

    // The same value, the same words, on the command face.
    // `--set` carries what a person typed, so the command face quotes it as the text it was given —
    // the one part of the sentence the three faces differ in, exactly as `badRunArgument`'s spelling
    // is.
    const typed = await himaCommand(host, h.workspace, `/hima run ${timingProbePackId} --site local --goal target_period_ns=2.0 --set periodNs=-5`);
    assert.equal(typed.kind, 'error', typed.text);
    assert.ok(typed.text.includes(badStrategyValue('periodNs', knob, '-5')), `and so does the command face: ${typed.text}`);
    assert.deepEqual(await readdir(h.workspace), [], 'and still nothing was created');

    // And the same for the other two numbers the three faces take.
    const box = await himaCommand(host, h.workspace, `/hima run ${timingProbePackId} --site local --goal target_period_ns=2.0 --set periodNs=2.0 --time-box -1`);
    assert.match(box.text, /invalid --time-box "-1"; expected a number of minutes greater than zero/, box.text);
    const retries = await host.ctx.tools.execute({
      callId: 'call-hima-run-bad-retries' as never,
      name: 'hima_run',
      arguments: { pack: timingProbePackId, site: 'local', goal: { target_period_ns: 2.0 }, strategy: { periodNs: 2.0 }, retries: -1 },
      agent,
      signal: AbortSignal.timeout(siteCommandTimeoutMs),
    });
    assert.match(JSON.stringify(retries), /invalid retries -1; expected a whole number of attempts, zero or more/, JSON.stringify(retries));
  } finally {
    await dispose();
  }
});

test('a --time-box the shared validator accepts but that converts to a millisecond value the ledger schema would refuse is caught before it ever reaches the ledger, on every face, and the ledger reopens cleanly after', async (t) => {
  const local = await localFabric(t);
  if (!local) return;
  const { h, host } = local;
  /** The body disposes the host itself, to re-boot on the same home; `finally` must not do it twice. */
  let disposed = false;
  try {
    // `--time-box` is minutes, `n > 0`; what the ledger actually stores and bounds is the converted
    // milliseconds, which no face's own check ever looks at. `1e15` minutes rounds past
    // `Number.MAX_SAFE_INTEGER`; `0.000005` minutes rounds to zero, not positive. Both pass the
    // minutes check and must still be refused, before a Campaign or a Run exists.
    const tooBig = await himaCommand(host, h.workspace, `/hima run ${timingProbePackId} --site local --goal target_period_ns=2.0 --set periodNs=2.0 --time-box 1e15`);
    assert.equal(tooBig.kind, 'error', tooBig.text);
    assert.match(tooBig.text, /this run's time box is 60000000000000000000 ms; expected a whole number of milliseconds/, tooBig.text);
    assert.deepEqual(await readdir(h.workspace), [], 'no Campaign and no Run: the converted value was refused before anything was created');

    const tooSmall = await himaCommand(host, h.workspace, `/hima run ${timingProbePackId} --site local --goal target_period_ns=2.0 --set periodNs=2.0 --time-box 0.000005`);
    assert.equal(tooSmall.kind, 'error', tooSmall.text);
    assert.match(tooSmall.text, /this run's time box is 0 ms; expected a whole number of milliseconds/, tooSmall.text);
    assert.deepEqual(await readdir(h.workspace), [], 'still nothing was created');

    // The tool face, the case Minor 7 was written for: a period no person could type must not be a
    // period a model can, and the same now holds for a time box.
    const agent = await createRootAgent(host.ctx, h.workspace);
    const toolResult = await host.ctx.tools.execute({
      callId: 'call-hima-run-bad-timebox' as never,
      name: 'hima_run',
      arguments: { pack: timingProbePackId, site: 'local', goal: { target_period_ns: 2.0 }, strategy: { periodNs: 2.0 }, timeBox: 1e15 },
      agent,
      signal: AbortSignal.timeout(siteCommandTimeoutMs),
    });
    assert.equal(toolResult.isError, true, JSON.stringify(toolResult));
    assert.match(JSON.stringify(toolResult), /this run's time box is 60000000000000000000 ms/, JSON.stringify(toolResult));
    assert.deepEqual(await readdir(h.workspace), [], 'and still nothing, from the third face');

    // Prove the ledger was never poisoned by a path that only refuses after the row is written:
    // dispose this host and re-boot on the same home, exactly as a restarted host would, and read the
    // ledger the re-booted host opened. This is the test's last claim, not its cleanup — in `finally`
    // it made no claim at all, and would have masked every failure above it if it had.
    await host.dispose();
    disposed = true;
    const rebooted = await bootInProcess(h);
    try {
      assert.deepEqual(
        rebooted.ctx.hima.ledger.runs(),
        [],
        'the re-booted host opened the ledger, and it holds no Run: not one of the three refusals stored a row',
      );
    } finally {
      await rebooted.dispose();
    }
  } finally {
    if (!disposed) await host.dispose();
    await h.dispose();
  }
});

test('POST /hima/api/runs starts a run behind the session fence, and the run view carries its status, goal, strategy, budget, meters, nodes, jobs and decision', async (t) => {
  const h = await createHimaHome();
  const flow = await writeStandinFlow(t, h);
  if (!flow) { await h.dispose(); return; }
  await installPack(h);
  await writeLocalSite(h, {
    allowedReadRoots: [h.workspace, flow.root],
    allowedWriteRoots: [h.workspace],
    bindings: { flowRoot: flow.root, design: flow.design, workspaceRoot: h.workspace },
  });
  let host: BootedHost | undefined;
  try {
    host = await bootHimaHost(h);
    const cookie = await openSession(host);

    // The fence first: without the session cookie the route answers a coded refusal, not a run.
    const fenced = await fetch(new URL('/hima/api/runs', host.url), {
      method: 'POST',
      body: JSON.stringify({ pack: timingProbePackId, site: 'local', goal: { target_period_ns: 2.0 }, strategy: { periodNs: 2.0 } }),
      headers: { 'content-type': 'application/json' },
    });
    assert.equal(fenced.status, 401, await fenced.text());

    const created = await api(host, cookie, '/hima/api/runs', {
      method: 'POST',
      body: JSON.stringify({ pack: timingProbePackId, site: 'local', goal: { target_period_ns: 2.0 }, strategy: { periodNs: 2.0 }, generations: 1 }),
      headers: { 'content-type': 'application/json' },
    });
    const text = await created.text();
    assert.equal(created.status, 200, text);
    const view = JSON.parse(text) as RunView;

    assert.match(view.run.id, /^run-[0-9a-f-]+$/, 'the route started a run');
    assert.equal(view.run.status, 'ended-budget-exhausted', 'one generation, as the body asked for');
    assert.equal(view.run.generation, 1);
    assert.deepEqual(view.run.goal, { target_period_ns: 2.0 });
    assert.deepEqual(view.run.strategy, { periodNs: 2.0 });
    assert.equal(view.run.budget?.retryAllowance, 3);
    assert.equal(view.run.budget?.generationLimit, 1);
    assert.equal(view.run.meters?.jobsLaunched, 1);

    assert.deepEqual(
      view.nodes.map((n) => [n.nodeId, n.kind, n.state]),
      [['synthesize', 'act', 'done'], ['read-qor', 'act', 'done'], ['judge', 'judge', 'done'], ['next-period', 'explore', 'done']],
      'one entry per node the run touched, in the order it touched them, carrying the state it is in now',
    );
    assert.deepEqual(view.jobs.map((j) => j.event), ['launched', 'finished']);
    assert.equal(view.jobs[1]!.exitCode, 0);
    assert.equal(view.observations.length, 1, 'the step-1 fields are still there');
    assert.equal(view.verdicts.length, 2);
    assert.deepEqual(view.refusals, []);
    assert.ok(view.decision, 'the run view carries the decision');
    assert.deepEqual(view.decision.chosen, { strategy: { periodNs: 2.25 } });
    assert.deepEqual(view.decision.cites, view.verdicts.map((v) => v.recordId).concat(view.observations[0]!.recordId));

    // The third face refuses the same numbers in the same words as the other two.
    const refused = await api(host, cookie, '/hima/api/runs', {
      method: 'POST',
      body: JSON.stringify({ pack: timingProbePackId, site: 'local', goal: { target_period_ns: 2.0 }, strategy: { periodNs: -5 } }),
      headers: { 'content-type': 'application/json' },
    });
    const refusedText = await refused.text();
    assert.equal(refused.status, 400, refusedText);
    assert.ok(
      refusedText.includes(JSON.stringify(badStrategyValue('periodNs', { type: 'number', unit: 'ns', min: 0.5, max: 10, default: 2.3 }, -5)).slice(1, -1)),
      refusedText,
    );

    // The same run, read back through the read route, is the same view.
    const fetched = await api(host, cookie, `/hima/api/runs/${view.run.id}`);
    assert.deepEqual(JSON.parse(await fetched.text()), view, 'the run reads back exactly as the create route reported it');

    // And the two new record types are narrowable like every other kind.
    const nodeRecordsView = await api(host, cookie, `/hima/api/runs/${view.run.id}/records?type=node`);
    const narrowed = JSON.parse(await nodeRecordsView.text()) as { records: { type: string }[] };
    assert.equal(narrowed.records.length, 8, 'every node transition');
    assert.ok(narrowed.records.every((r) => r.type === 'node'));
  } finally {
    if (host) {
      const code = await host.stop();
      assert.equal(code, 0, `host exited ${code}\n${host.stderr()}`);
    }
    await h.dispose();
  }
});

test('/hima status reports the run\'s status, its current node, every node state, the meters and the decision', async (t) => {
  const local = await localFabric(t);
  if (!local) return;
  const { h, host, dispose } = local;
  let sessions: string[] = [];
  try {
    const started = await himaCommand(
      host,
      h.workspace,
      `/hima run ${timingProbePackId} --site local --goal target_period_ns=2.0 --set periodNs=2.0 ${ONE_GENERATION}`,
      siteCommandTimeoutMs,
    );
    assert.equal(started.kind, 'success', started.text);
    const runId = started.runId!;
    sessions = sessionsOf(host, runId);

    const status = await himaCommand(host, h.workspace, `/hima status ${runId}`);
    for (const line of status.text.split('\n')) t.diagnostic(line);
    assert.equal(status.kind, 'success', status.text);
    assert.match(status.text, new RegExp(`^run ${runId} `), status.text);
    assert.match(status.text, /ended-budget-exhausted, generation 1 of at most 1/, status.text);
    // What the Campaign is for and what it is set to, in the words the shipped pack declares for its
    // own numbers (#42) — the very sentences the card's banner says, from the one words table.
    assert.match(status.text, /^ {2}goal: clock period at most 2 ns$/m, status.text);
    assert.match(status.text, /^ {2}strategy: clock period 2 ns$/m, status.text);
    assert.match(status.text, /^ {2}current node: next-period$/m, status.text);
    assert.match(status.text, /^ {4}synthesize \(act\): done, attempt 1, session hima-/m, status.text);
    assert.match(status.text, /^ {4}read-qor \(act\): done, attempt 1$/m, status.text);
    assert.match(status.text, /^ {4}judge \(judge\): done, attempt 1, FAIL$/m, status.text);
    assert.match(status.text, /^ {4}next-period \(explore\): done, attempt 1$/m, status.text);
    // Every meter against the bound it was held to, in the words the card says them in (#27).
    assert.match(status.text, /^ {4}elapsed \d[\d.]* (?:ms|s|min) of a time box of 60\.0 min$/m, status.text);
    assert.match(status.text, /^ {4}generation 1 of at most 1, \d[\d.]* (?:ms|s|min)$/m, status.text);
    assert.match(status.text, /^ {4}1 job launched, at most 1 job at a time$/m, status.text);
    assert.match(status.text, /^ {4}next-period: attempt 1 of a retry allowance of 3, and 4 attempts in the campaign so far$/m, status.text);
    assert.match(status.text, /^ {4}ended by the generation limit$/m, status.text);
    assert.match(status.text, /^ {2}decision: next-period chose clock period 2\.25 ns by timing-push/m, status.text);

    const unknown = await himaCommand(host, h.workspace, '/hima status run-no-such-run');
    assert.equal(unknown.kind, 'error', unknown.text);
    assert.match(unknown.text, /unknown run/, unknown.text);
  } finally {
    killSessions(sessions);
    await dispose();
  }
});

test('a fabric run\'s records and its run state read back unchanged after a host restart', async (t) => {
  const h = await createHimaHome();
  const flow = await writeStandinFlow(t, h);
  if (!flow) { await h.dispose(); return; }
  await installPack(h);
  await writeLocalSite(h, {
    allowedReadRoots: [h.workspace, flow.root],
    allowedWriteRoots: [h.workspace],
    bindings: { flowRoot: flow.root, design: flow.design, workspaceRoot: h.workspace },
  });
  let runId = '';
  let before: LedgerRecord[] = [];
  let runBefore: RunRecord | undefined;
  let sessions: string[] = [];
  const first = await bootInProcess(h);
  try {
    const started = await himaCommand(
      first,
      h.workspace,
      `/hima run ${timingProbePackId} --site local --goal target_period_ns=2.0 --set periodNs=2.0 ${ONE_GENERATION}`,
      siteCommandTimeoutMs,
    );
    assert.equal(started.kind, 'success', started.text);
    runId = started.runId!;
    sessions = sessionsOf(first, runId);
    before = recordsOf(first, runId);
    runBefore = runOf(first, runId);
    assert.ok(before.some((r) => r.type === 'node') && before.some((r) => r.type === 'decision'), 'the new record types are in it');
  } finally {
    killSessions(sessions);
    await first.dispose();
  }
  const second = await bootInProcess(h);
  try {
    assert.deepEqual(recordsOf(second, runId), before, 'the durable ledger accepts and returns node and decision records');
    assert.deepEqual(runOf(second, runId), runBefore, 'and the run\'s whole fabric state: a restart reads what the last process wrote');
    // No reconciliation yet (#14): a re-read run simply shows its last recorded state.
    const status = await himaCommand(second, h.workspace, `/hima status ${runId}`);
    assert.equal(status.kind, 'success', status.text);
    assert.match(status.text, /ended-budget-exhausted/, status.text);
  } finally {
    await second.dispose();
    await h.dispose();
  }
});
