// @hima-seam tools direct
// Ticket #15: what a Run does when a generation fails, and what it does when the Site is full.
//
// A Job that exits non-zero is a failed attempt: within the Run's Retry allowance the node launches
// a fresh Job as the next attempt, and when the allowance is spent the whole failure becomes a
// blocker record — the attempts, the last exit, the tail of the Job's own log — the node is blocked,
// and the Run waits at the pack's Wait node for a person. `/hima resume`, the `hima_resume` tool and
// the resume route are that person: each records who acted, re-enters the blocked node with a fresh
// allowance, and carries the Run on. Separately, the Site's parallel job cap is counted across every
// Run of that Site, so a second Run started while the first Job holds the only slot waits for it.
//
// Everything is driven through the booted host — the `/hima run`, `/hima resume` and `/hima status`
// command faces, the `hima_resume` tool, and the `/hima/api` routes — and asserted on what comes back
// out: the ledger's node, job, blocker and resumed records, the run row, and the run view. Local site
// only; the reference site is #17.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { type HimaHome } from './support/dsh-home.ts';
// The pieces every fabric suite composes; this file's own sleep and poll are wrapped around them.
import {
  jobRecords,
  killSessions,
  localFabric as bootedLocalFabric,
  localHome as sharedLocalHome,
  nodeRecords,
  ONE_GENERATION,
  recordsOf,
  resumedRecords,
  runOf,
  sessionsOf,
  waitUntil,
  type LocalFabric,
  type StandinHomeOptions,
} from './support/fabric.ts';
import { bootInProcess, createRootAgent, type InProcessHost } from './support/boot-inprocess.ts';
import { bootHimaHost, type BootedHost } from './support/boot-host.ts';
import { api, openSession } from './support/hima-api.ts';
import { himaCommand, siteCommandTimeoutMs, type CommandOutcome } from './support/command.ts';
import { packsDirOf, timingProbePackId, writePackVariant } from './support/pack.ts';
import type {} from '@deepseek-ai/dsh-tools';
import type {
  BlockerRecord,
  JobRecord,
  LedgerRecord,
  NodeRecord,
  RunView,
  WorkspaceRecord,
} from '@hima/harness';

/** A stand-in generation is a sleep and a file copy; one second is enough to be a real Job and short
 *  enough that five attempts still fit inside one command's timeout. */
const standinSleepSeconds = 1;

const blockerRecords = (host: InProcessHost, runId: string): BlockerRecord[] =>
  recordsOf(host, runId).filter((r): r is BlockerRecord => r.type === 'blocker');
const workspaceRecords = (host: InProcessHost, runId: string): WorkspaceRecord[] =>
  recordsOf(host, runId).filter((r): r is WorkspaceRecord => r.type === 'workspace');

/** The Jobs the ledger holds open on the local Site, across every Run of it: what the Site's job cap
 *  is counted against, and — for a test that has not been told a run id yet — the only way to find
 *  the Run that a Job belongs to while its `/hima run` is still driving. */
const openJobsHere = (host: InProcessHost): JobRecord[] => host.ctx.hima.ledger.openJobsOn('local');

/** Every session this home's own Runs still have open, so a test that ended early still cleans up
 *  after itself. Every name comes out of this home's ledger: never a session this test did not start. */
const openSessionsHere = (host: InProcessHost): string[] => openJobsHere(host).map((r) => r.job.session);

/** One node's transitions as `[state, attempt]` pairs, in order: the whole attempt history. */
const attemptsAt = (host: InProcessHost, runId: string, nodeId: string): [string, number][] =>
  nodeRecords(host, runId).filter((r) => r.nodeId === nodeId).map((r) => [r.state, r.attempt]);

/**
 * Poll until something this file is waiting for is true. It looks often and gives up sooner than the
 * shared default: everything this suite waits for is a stand-in that sleeps a second or a record the
 * ledger has already been given, never a real generation on a Site.
 */
const until = (what: string, ready: () => boolean, timeoutMs = 30_000): Promise<void> =>
  waitUntil(what, ready, timeoutMs, 50);

/**
 * A local home with the shipped pack, a stand-in flow told how often to fail, and a booted host.
 * `failures` is what makes this file's tests real: the stand-in's `synth` target counts down a file
 * inside the Campaign workspace and exits 3 while the count is above zero, so a retry is a fresh Job
 * that really does fail again. The sleep is this file's own, and is why the shared helper is wrapped
 * rather than called directly.
 */
const localFabric = (t: TestContext, opts: StandinHomeOptions = {}): Promise<LocalFabric | undefined> =>
  bootedLocalFabric(t, { sleepSeconds: standinSleepSeconds, ...opts });

/** The same home, without booting anything: for the tests that boot twice, or that boot the host as
 *  a real subprocess. Only the home is wanted here — the flow is the stand-in's own business. */
const localHome = async (t: TestContext, opts: StandinHomeOptions = {}): Promise<HimaHome | undefined> =>
  (await sharedLocalHome(t, { sleepSeconds: standinSleepSeconds, ...opts }))?.h;

test('a job told to fail twice is retried as two fresh attempts and the third succeeds, and the run completes with no blocker', async (t) => {
  const local = await localFabric(t, { failures: 2 });
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
    for (const line of started.text.split('\n')) t.diagnostic(line);
    assert.equal(started.kind, 'success', started.text);
    const runId = started.runId!;
    sessions = sessionsOf(host, runId);

    // Three Jobs, each launched and each finished, and the exits the stand-in was told to give.
    const jobs = jobRecords(host, runId);
    assert.deepEqual(
      jobs.map((r) => r.event),
      ['launched', 'finished', 'launched', 'finished', 'launched', 'finished'],
      'a failed attempt is a whole Job of its own, launched and finished',
    );
    // `make` exits 2 when a recipe fails, whatever the recipe itself exited with — the stand-in's own
    // 3 is in the log, and 2 is what the Job wrote to its exit file. What is recorded is what the Job
    // exited with, never what something inside it meant to.
    assert.deepEqual(jobs.filter((r) => r.event === 'finished').map((r) => r.exitCode), [2, 2, 0], 'fail, fail, succeed');
    assert.equal(new Set(jobs.map((r) => r.job.session)).size, 3, 'a session of its own per attempt, so no attempt reads another\'s exit or writes over its log');
    for (const r of jobs) assert.equal(r.nodeId, 'synthesize', 'every one of them belongs to the node that made the attempt');

    // The attempts on the node, counted from one, one `retrying` between each pair.
    assert.deepEqual(
      attemptsAt(host, runId, 'synthesize'),
      [['running', 1], ['retrying', 1], ['running', 2], ['retrying', 2], ['running', 3], ['done', 3]],
      'attempts 1..3, the first two retried and the third done',
    );
    const retried = nodeRecords(host, runId).filter((r) => r.state === 'retrying');
    assert.equal(retried.length, 2);
    assert.match(retried[0]!.reason ?? '', /exited 2/, `the retry says what failed: ${retried[0]!.reason}`);
    assert.match(retried[0]!.reason ?? '', /allowance of 3/, `and what the allowance is: ${retried[0]!.reason}`);
    assert.deepEqual(
      retried.map((r) => r.jobSession),
      sessions.slice(0, 2),
      'each retry names the session of the attempt that failed',
    );

    const run = runOf(host, runId);
    assert.equal(run.status, 'ended-budget-exhausted', 'the generation that succeeded is the one that counts');
    assert.equal(run.currentNode, 'next-period', 'the run got all the way to the end of the graph');
    assert.equal(run.meters?.jobsLaunched, 3, 'the meter counts every attempt, not every node');
    assert.deepEqual(blockerRecords(host, runId), [], 'nothing was blocked: the allowance covered it');
    assert.deepEqual(resumedRecords(host, runId), [], 'and nobody had to clear anything');
  } finally {
    killSessions(sessions);
    await dispose();
  }
});

test('a job told to fail four times against an allowance of three blocks with a blocker record carrying the last exit and the log tail, and resume re-enters the node with a fresh allowance and completes the run', async (t) => {
  const local = await localFabric(t, { failures: 4 });
  if (!local) return;
  const { h, host, dispose } = local;
  let sessions: string[] = [];
  try {
    const started = await himaCommand(
      host,
      h.workspace,
      `/hima run ${timingProbePackId} --site local --goal target_period_ns=2.0 --set periodNs=2.0 --retries 3 ${ONE_GENERATION}`,
      siteCommandTimeoutMs,
    );
    for (const line of started.text.split('\n')) t.diagnostic(line);
    assert.equal(started.kind, 'error', `a run that stopped needing a person is not a success: ${started.text}`);
    const runId = started.runId!;
    sessions = sessionsOf(host, runId);

    const waiting = runOf(host, runId);
    assert.equal(waiting.status, 'waiting', 'the run waits for a person; it did not end');
    assert.equal(waiting.currentNode, 'blocked', 'and it stands at the pack\'s wait node, which is where a person acts');
    assert.equal(waiting.meters?.jobsLaunched, 3, 'three attempts, three Jobs, and no fourth');

    assert.deepEqual(
      attemptsAt(host, runId, 'synthesize'),
      [['running', 1], ['retrying', 1], ['running', 2], ['retrying', 2], ['running', 3], ['blocked', 3]],
      'three attempts and then the allowance is spent',
    );
    assert.deepEqual(attemptsAt(host, runId, 'blocked'), [['blocked', 1]], 'the wait node is arrived at, once');

    const blockers = blockerRecords(host, runId);
    assert.equal(blockers.length, 1, 'one blocker: the whole failure in one record');
    const blocker = blockers[0]!;
    t.diagnostic(`blocker: ${blocker.reason}`);
    t.diagnostic(`log tail: ${JSON.stringify(blocker.logTail)}`);
    assert.equal(blocker.nodeId, 'synthesize', 'it names the node that gave up, not the wait node the run was routed to');
    assert.equal(blocker.attempts, 3, 'and how many attempts it made');
    assert.equal(blocker.lastExitCode, 2, 'and what the last one exited with — make\'s own status for a failed recipe');
    assert.equal(blocker.writer, 'executor', 'the executor recorded the failure; the person records the clearing');
    assert.match(blocker.reason, /spent its retry allowance of 3/, blocker.reason);
    assert.ok(blocker.logTail && blocker.logTail.length > 0, `the tail of the failed job's own log is on the record: ${JSON.stringify(blocker.logTail)}`);
    assert.match(blocker.logTail, /synth/, `and it is that job's log: ${blocker.logTail}`);
    assert.match(blocker.logTail, /Error 3/, `carrying what the recipe itself failed with, which the exit code alone cannot say: ${blocker.logTail}`);
    assert.equal(
      nodeRecords(host, runId).find((r) => r.nodeId === 'synthesize' && r.state === 'blocked')?.reason,
      blocker.reason,
      'the blocked node says the same thing in the same words, so a person reading either reads one story',
    );

    // What a person sees before deciding to clear it.
    const status = await himaCommand(host, h.workspace, `/hima status ${runId}`);
    for (const line of status.text.split('\n')) t.diagnostic(line);
    assert.match(status.text, /^ {2}blocker: synthesize after 3 attempts, last exit 2, /m, status.text);
    assert.match(status.text, /^ {4}synthesize \(act\): blocked, attempt 3, session hima-/m, status.text);

    // The person clears it. The fourth attempt fails too — the stand-in was told to fail four times —
    // and the fresh allowance is what lets the node try a fifth rather than block again at once.
    const resumed = await himaCommand(host, h.workspace, `/hima resume ${runId}`, siteCommandTimeoutMs);
    for (const line of resumed.text.split('\n')) t.diagnostic(line);
    assert.equal(resumed.kind, 'success', resumed.text);
    sessions = sessionsOf(host, runId);

    const records = resumedRecords(host, runId);
    assert.equal(records.length, 1, 'one resume, one record');
    assert.equal(records[0]!.writer, 'person', 'a hard blocker is cleared by a person, and the ledger says so');
    assert.match(records[0]!.who, /^session-/, `by the session that typed it: ${records[0]!.who}`);
    assert.equal(records[0]!.nodeId, 'synthesize', 'the run re-enters the node that failed, not the wait node it stood at');
    assert.equal(records[0]!.clears, blocker.id, 'and the record names the blocker it clears');

    assert.deepEqual(
      attemptsAt(host, runId, 'synthesize'),
      [
        ['running', 1], ['retrying', 1], ['running', 2], ['retrying', 2], ['running', 3], ['blocked', 3],
        ['running', 4], ['retrying', 4], ['running', 5], ['done', 5],
      ],
      'attempts go on from four: the count is read from the records, and the allowance is what starts again',
    );
    assert.equal(blockerRecords(host, runId).length, 1, 'the fourth failure did not block: the allowance was fresh');

    const ended = runOf(host, runId);
    assert.equal(ended.status, 'ended-budget-exhausted', 'the run finished the graph it was resumed into');
    assert.equal(ended.currentNode, 'next-period');
    assert.equal(ended.meters?.jobsLaunched, 5, 'five attempts in all');
  } finally {
    killSessions(sessions);
    await dispose();
  }
});

test('resume answers clearly and writes nothing on a run that has ended and on one that is still running', async (t) => {
  const local = await localFabric(t, { sleepSeconds: 6, failures: 1 });
  if (!local) return;
  const { h, host, dispose } = local;
  let sessions: string[] = [];
  try {
    // An ended run: there is nothing to clear, and saying so must leave no record claiming a person
    // did something.
    const ended = await himaCommand(
      host,
      h.workspace,
      `/hima run ${timingProbePackId} --site local --goal target_period_ns=2.0 --set periodNs=2.0 --retries 2 ${ONE_GENERATION}`,
      siteCommandTimeoutMs,
    );
    assert.equal(ended.kind, 'success', ended.text);
    const endedRun = ended.runId!;
    sessions = sessionsOf(host, endedRun);
    const before = recordsOf(host, endedRun).length;

    const refused = await himaCommand(host, h.workspace, `/hima resume ${endedRun}`, siteCommandTimeoutMs);
    t.diagnostic(refused.text);
    assert.equal(refused.kind, 'error', refused.text);
    assert.match(refused.text, /this run is ended-budget-exhausted, and only a waiting run can be resumed/, refused.text);
    assert.match(refused.text, /nothing was written/, refused.text);
    assert.equal(recordsOf(host, endedRun).length, before, 'and nothing was written');
    assert.deepEqual(resumedRecords(host, endedRun), []);

    // A run that is running: one that is being advanced by something is not a person's to clear.
    // The one way to hold a Run in `running` at a moment a test can act is to be the thing advancing
    // it — so this resumes a blocked run and, while that resume is driving, asks to resume it again.
    const blocked = await himaCommand(
      host,
      h.workspace,
      `/hima run ${timingProbePackId} --site local --goal target_period_ns=2.0 --set periodNs=2.0 --retries 1 ${ONE_GENERATION}`,
      siteCommandTimeoutMs,
    );
    const blockedRun = blocked.runId!;
    sessions = [...sessions, ...sessionsOf(host, blockedRun)];
    assert.equal(blocked.kind, 'error', blocked.text);
    assert.equal(runOf(host, blockedRun).status, 'waiting', blocked.text);

    const driving = himaCommand(host, h.workspace, `/hima resume ${blockedRun}`, siteCommandTimeoutMs);
    let finished: CommandOutcome;
    try {
      await until('the resumed run reached running', () => runOf(host, blockedRun).status === 'running');
      const second = await himaCommand(host, h.workspace, `/hima resume ${blockedRun}`, siteCommandTimeoutMs);
      t.diagnostic(second.text);
      assert.equal(second.kind, 'error', second.text);
      assert.match(second.text, /this run is running, and only a waiting run can be resumed/, second.text);
      assert.match(second.text, /nothing was written/, second.text);
    } finally {
      // Cleanup only: the drive this test raced must be let finish however the block above ended, but
      // what it answered is a claim, and a claim made in `finally` masks every failure above it.
      finished = await driving;
    }
    assert.equal(finished.kind, 'success', finished.text);
    assert.equal(resumedRecords(host, blockedRun).length, 1, 'one resume took; the one that arrived on a running run wrote nothing');
    sessions = [...sessions, ...sessionsOf(host, blockedRun)];
    assert.equal(runOf(host, blockedRun).status, 'ended-budget-exhausted', 'and the resume that did take carried the run to its end');
  } finally {
    killSessions(sessions);
    await dispose();
  }
});

test('the hima_resume tool clears the same blocker the command does, and answers with the run it carried on', async (t) => {
  const local = await localFabric(t, { failures: 1 });
  if (!local) return;
  const { h, host, dispose } = local;
  let sessions: string[] = [];
  try {
    assert.ok(host.ctx.tools.schemas().some((s) => s.name === 'hima_resume'), 'the tool is registered');
    const blocked = await himaCommand(
      host,
      h.workspace,
      `/hima run ${timingProbePackId} --site local --goal target_period_ns=2.0 --set periodNs=2.0 --retries 1 ${ONE_GENERATION}`,
      siteCommandTimeoutMs,
    );
    const runId = blocked.runId!;
    assert.equal(runOf(host, runId).status, 'waiting', blocked.text);

    const agent = await createRootAgent(host.ctx, h.workspace);
    const result = await host.ctx.tools.execute({
      callId: 'call-hima-resume' as never,
      name: 'hima_resume',
      arguments: { run: runId },
      agent,
      signal: AbortSignal.timeout(siteCommandTimeoutMs),
    });
    assert.equal(result.isError, false, JSON.stringify(result));
    const value = (result as unknown as { value?: { kind: string; runId?: string; status?: string; nodeId?: string; recordId?: string } }).value!;
    t.diagnostic(JSON.stringify(value));
    assert.equal(value.kind, 'resumed');
    assert.equal(value.runId, runId);
    assert.equal(value.nodeId, 'synthesize');
    assert.equal(value.status, 'ended-budget-exhausted');
    sessions = sessionsOf(host, runId);

    const records = resumedRecords(host, runId);
    assert.equal(records.length, 1);
    assert.equal(records[0]!.id, value.recordId, 'the tool names the record it wrote');
    assert.equal(records[0]!.writer, 'person');
    assert.match(records[0]!.who, /^session-/, `the calling agent's session is who acted: ${records[0]!.who}`);

    // And the same tool on the now-ended run answers rather than doing anything.
    const again = await host.ctx.tools.execute({
      callId: 'call-hima-resume-again' as never,
      name: 'hima_resume',
      arguments: { run: runId },
      agent,
      signal: AbortSignal.timeout(siteCommandTimeoutMs),
    });
    const said = JSON.stringify(again);
    assert.equal((again as unknown as { value?: { kind: string } }).value?.kind, 'not-waiting', said);
    assert.match(said, /only a waiting run can be resumed/, said);
    assert.equal(resumedRecords(host, runId).length, 1, 'and wrote no second record');
  } finally {
    killSessions(sessions);
    await dispose();
  }
});

test('POST /hima/api/runs/<id>/resume clears a blocker behind the session fence, the run view carries the blocker, and a run that is not waiting is a coded refusal', async (t) => {
  const h = await localHome(t, { failures: 1 });
  if (!h) return;
  let host: BootedHost | undefined;
  let sessions: string[] = [];
  try {
    host = await bootHimaHost(h);
    const cookie = await openSession(host);
    const created = await api(host, cookie, '/hima/api/runs', {
      method: 'POST',
      body: JSON.stringify({ pack: timingProbePackId, site: 'local', goal: { target_period_ns: 2.0 }, strategy: { periodNs: 2.0 }, retries: 1, generations: 1 }),
      headers: { 'content-type': 'application/json' },
    });
    const blockedText = await created.text();
    assert.equal(created.status, 200, blockedText);
    const blockedView = JSON.parse(blockedText) as RunView;
    const runId = blockedView.run.id;
    sessions = blockedView.jobs.filter((j) => j.event === 'launched').map((j) => j.job.session);

    assert.equal(blockedView.run.status, 'waiting');
    assert.equal(blockedView.run.currentNode, 'blocked');
    assert.equal(blockedView.blockers.length, 1, 'the run view carries the blocker a person has to clear');
    assert.equal(blockedView.blockers[0]!.nodeId, 'synthesize');
    assert.equal(blockedView.blockers[0]!.attempts, 1, 'an allowance of one is one attempt');
    assert.equal(blockedView.blockers[0]!.lastExitCode, 2);
    assert.ok(blockedView.blockers[0]!.logTail, 'with the tail of the failed job\'s log, so nobody has to log in to the site to read it');

    // The fence first: without the session cookie the route answers a coded refusal, not a resume.
    const fenced = await fetch(new URL(`/hima/api/runs/${runId}/resume`, host.url), { method: 'POST' });
    assert.equal(fenced.status, 401, await fenced.text());

    const resumed = await api(host, cookie, `/hima/api/runs/${runId}/resume`, { method: 'POST' });
    const resumedText = await resumed.text();
    assert.equal(resumed.status, 200, resumedText);
    const view = JSON.parse(resumedText) as RunView;
    assert.equal(view.run.status, 'ended-budget-exhausted', 'the route carried the run on to its end');
    assert.deepEqual(view.nodes.map((n) => [n.nodeId, n.state]), [
      ['synthesize', 'done'], ['blocked', 'blocked'], ['read-qor', 'done'], ['judge', 'done'], ['next-period', 'done'],
    ], 'the wait node keeps its place in the order the run reached it, and the retried node now says done');
    assert.equal(view.blockers.length, 1, 'a cleared blocker stays on the record: it happened');
    sessions = view.jobs.filter((j) => j.event === 'launched').map((j) => j.job.session);

    // The person's action is a record like any other, narrowable through the records route.
    const records = await api(host, cookie, `/hima/api/runs/${runId}/records?type=resumed`);
    const listed = JSON.parse(await records.text()) as { records: { type: string; writer: string; who: string; nodeId: string }[] };
    assert.equal(listed.records.length, 1, JSON.stringify(listed));
    assert.equal(listed.records[0]!.writer, 'person');
    assert.equal(listed.records[0]!.who, 'workbench', 'a request through the web app\'s own fence is the workbench, and never a name a caller chose');
    assert.equal(listed.records[0]!.nodeId, 'synthesize');

    // And the same route on the ended run is refused with its reason: not a malformed request but a
    // Run whose status cannot take one, which is its own code and its own status (#16).
    const refused = await api(host, cookie, `/hima/api/runs/${runId}/resume`, { method: 'POST' });
    const refusedText = await refused.text();
    assert.equal(refused.status, 409, refusedText);
    const body = JSON.parse(refusedText) as { error: { code: string; message: string } };
    assert.equal(body.error.code, 'hima/run-not-in-state', refusedText);
    assert.match(body.error.message, /this run is ended-budget-exhausted, and only a waiting run can be resumed/, refusedText);
  } finally {
    killSessions(sessions);
    if (host) {
      const code = await host.stop();
      assert.equal(code, 0, `host exited ${code}\n${host.stderr()}`);
    }
    await h.dispose();
  }
});

test('the site\'s job cap holds across runs: a second run records waiting-for-slot, launches only once the first job has finished, and both complete', async (t) => {
  // Ten seconds of stand-in synthesis, and the local site declares one parallel job. The second run
  // is started once the first is certainly launched, so what it does about a full site is what is
  // under test. Both are driven through the route, which is also where the waiting is read back.
  const h = await localHome(t, { sleepSeconds: 10 });
  if (!h) return;
  let host: BootedHost | undefined;
  let sessions: string[] = [];
  try {
    host = await bootHimaHost(h);
    const cookie = await openSession(host);
    const start = (): Promise<Response> => api(host!, cookie, '/hima/api/runs', {
      method: 'POST',
      body: JSON.stringify({ pack: timingProbePackId, site: 'local', goal: { target_period_ns: 2.0 }, strategy: { periodNs: 2.0 }, generations: 1 }),
      headers: { 'content-type': 'application/json' },
    });

    const first = start();
    // Long enough that the first run has certainly prepared its workspace and launched its Job — a
    // whole stand-in generation but the sleep is under a second — and far short of the ten seconds
    // that Job then holds the only slot for.
    await new Promise((r) => setTimeout(r, 2_500));
    const second = start();
    const views = await Promise.all([first, second].map(async (p) => {
      const answered = await p;
      const text = await answered.text();
      assert.equal(answered.status, 200, text);
      return JSON.parse(text) as RunView;
    }));
    sessions = views.flatMap((v) => v.jobs.filter((j) => j.event === 'launched').map((j) => j.job.session));

    for (const view of views) {
      assert.equal(view.run.status, 'ended-budget-exhausted', 'both runs completed');
      assert.equal(view.run.budget?.jobCap, 1, 'under the cap the site declares');
    }
    assert.equal(new Set(views.map((v) => v.run.campaignId)).size, 2, 'two runs of one pack started seconds apart are two campaigns, in two workspaces');

    // Which one waited is read from the node records — the whole path, one record per transition —
    // rather than from the run view's one-entry-per-node, which carries the state each node is in now.
    const paths = await Promise.all(views.map(async (view) => {
      const answered = await api(host!, cookie, `/hima/api/runs/${view.run.id}/records?type=node`);
      const text = await answered.text();
      assert.equal(answered.status, 200, text);
      return (JSON.parse(text) as { records: NodeRecord[] }).records;
    }));
    const queuedAt = paths.findIndex((records) => records.some((r) => r.state === 'waiting-for-slot'));
    assert.equal(
      paths.filter((records) => records.some((r) => r.state === 'waiting-for-slot')).length,
      1,
      'exactly one of the two waited for a slot; the other had it',
    );
    const queued = paths[queuedAt]!;
    const waitedRecord = queued.find((r) => r.state === 'waiting-for-slot')!;
    t.diagnostic(`the queued run waited: ${waitedRecord.reason ?? ''}`);
    assert.deepEqual(
      queued.filter((r) => r.nodeId === 'synthesize').map((r) => r.state),
      ['waiting-for-slot', 'running', 'done'],
      'it waited, then launched, then finished: waiting for a slot is not a failed attempt',
    );
    assert.equal(waitedRecord.attempt, 1, 'and it is still the node\'s first attempt');
    assert.equal(waitedRecord.kind, 'act');
    assert.match(waitedRecord.reason ?? '', /site local is running 1 job against a cap of 1/, JSON.stringify(waitedRecord));

    // And it really did wait for the other's Job rather than merely recording that it might: its own
    // launch is not before the finish of the Job that held the slot.
    const queuedView = views[queuedAt]!;
    const held = views[1 - queuedAt]!;

    // The run view says the node waited, after the fact. Its `nodes` carry the state each node is in
    // *now* — by the time both Runs have finished, the node that waited says `done` — so the fact
    // that it once waited has to be carried as a flag of its own, exactly as `blockers` carries a
    // Hard blocker that has since been cleared.
    const queuedNode = queuedView.nodes.find((n) => n.nodeId === 'synthesize')!;
    assert.equal(queuedNode.state, 'done', 'the node that waited finished');
    assert.equal(queuedNode.waitedForSlot, true, 'and the run view still says it waited for a slot');
    const heldNode = held.nodes.find((n) => n.nodeId === 'synthesize')!;
    assert.equal(heldNode.waitedForSlot, undefined, 'the run that had the slot never waited, and says so by omission');
    const releasedAt = held.jobs.find((j) => j.event === 'finished')!.at;
    const launchedAt = queuedView.jobs.find((j) => j.event === 'launched')!.at;
    t.diagnostic(`the slot was released at ${releasedAt} and the queued run launched at ${launchedAt}`);
    assert.ok(
      Date.parse(launchedAt) >= Date.parse(releasedAt),
      `the queued run launched at ${launchedAt}, before the slot was released at ${releasedAt}`,
    );
  } finally {
    killSessions(sessions);
    if (host) {
      const code = await host.stop();
      assert.equal(code, 0, `host exited ${code}\n${host.stderr()}`);
    }
    await h.dispose();
  }
});

test('attempts survive a host restart: a run blocked after two attempts is resumed on a freshly booted host and its next attempt is the third', async (t) => {
  const h = await localHome(t, { failures: 2 });
  if (!h) return;
  let runId = '';
  let before: LedgerRecord[] = [];
  let sessions: string[] = [];
  const first = await bootInProcess(h);
  try {
    const blocked = await himaCommand(
      first,
      h.workspace,
      `/hima run ${timingProbePackId} --site local --goal target_period_ns=2.0 --set periodNs=2.0 --retries 2 ${ONE_GENERATION}`,
      siteCommandTimeoutMs,
    );
    for (const line of blocked.text.split('\n')) t.diagnostic(line);
    assert.equal(blocked.kind, 'error', blocked.text);
    runId = blocked.runId!;
    sessions = sessionsOf(first, runId);
    assert.equal(runOf(first, runId).status, 'waiting');
    assert.deepEqual(
      attemptsAt(first, runId, 'synthesize'),
      [['running', 1], ['retrying', 1], ['running', 2], ['blocked', 2]],
      'two attempts against an allowance of two',
    );
    before = recordsOf(first, runId);
  } finally {
    killSessions(sessions);
    await first.dispose();
  }

  // A new process, on the same durable home. It holds no counter, no handle and no memory of the two
  // attempts: everything it needs is what the last one wrote down.
  const second = await bootInProcess(h);
  try {
    assert.deepEqual(recordsOf(second, runId), before, 'the durable ledger accepts and returns blocker records');
    const resumed = await himaCommand(second, h.workspace, `/hima resume ${runId}`, siteCommandTimeoutMs);
    for (const line of resumed.text.split('\n')) t.diagnostic(line);
    assert.equal(resumed.kind, 'success', resumed.text);
    sessions = sessionsOf(second, runId);

    assert.deepEqual(
      attemptsAt(second, runId, 'synthesize'),
      [['running', 1], ['retrying', 1], ['running', 2], ['blocked', 2], ['running', 3], ['done', 3]],
      'the next attempt is the third: the count came out of the records, not out of the process that made them',
    );
    assert.equal(runOf(second, runId).status, 'ended-budget-exhausted');
    assert.equal(runOf(second, runId).meters?.jobsLaunched, 3);
    assert.equal(resumedRecords(second, runId).length, 1, 'and one person\'s action cleared it');
  } finally {
    killSessions(sessions);
    await second.dispose();
    await h.dispose();
  }
});

test('a job whose tmux session vanishes is retried at once: the slot its own corpse holds is not counted against it', async (t) => {
  // The failure mode the Retry allowance exists for second: a Job that neither exits nor writes an
  // exit status, because the session it ran in went away — site maintenance, an OOM killer, a stray
  // hand. The Run settles the attempt `retrying` and takes another turn, and the Site's job cap must
  // not then hold that turn behind the very Job the Run has already given up on.
  //
  // Six seconds of stand-in synthesis, so the session is certainly there to be ended; a half-minute
  // time box, so a Run that does queue behind its own corpse says so within this test rather than
  // sitting there for the default hour.
  const local = await localFabric(t, { sleepSeconds: 6 });
  if (!local) return;
  const { h, host, dispose } = local;
  let sessions: string[] = [];
  try {
    const driving = himaCommand(
      host,
      h.workspace,
      `/hima run ${timingProbePackId} --site local --goal target_period_ns=2.0 --set periodNs=2.0 --retries 3 --time-box 0.5 ${ONE_GENERATION}`,
      siteCommandTimeoutMs,
    );
    // The one session this test ends is one the Run itself wrote down: the ledger names it, and
    // nothing outside this home is touched.
    await until('the run launched its first job', () => openJobsHere(host).length > 0);
    const vanishing = openJobsHere(host)[0]!;
    const runId = vanishing.runId;
    t.diagnostic(`ending the session of ${runId}'s first job: ${vanishing.job.session}`);
    killSessions([vanishing.job.session]);

    const ran = await driving;
    for (const line of ran.text.split('\n')) t.diagnostic(line);
    sessions = sessionsOf(host, runId);

    assert.deepEqual(
      attemptsAt(host, runId, 'synthesize'),
      [['running', 1], ['retrying', 1], ['running', 2], ['done', 2]],
      'the vanished attempt was retried at once, and the second attempt is what the run completed on',
    );
    const retried = nodeRecords(host, runId).find((r) => r.state === 'retrying')!;
    assert.equal(retried.jobSession, vanishing.job.session, 'the retry names the job that vanished');
    assert.match(retried.reason ?? '', /is gone/, `and says what happened to it: ${retried.reason}`);
    assert.deepEqual(
      nodeRecords(host, runId).filter((r) => r.state === 'waiting-for-slot'),
      [],
      'nothing waited for a slot: the only job on the site was one this run had already settled a node against',
    );
    assert.deepEqual(
      jobRecords(host, runId).map((r) => r.event),
      ['launched', 'launched', 'finished'],
      'two launches; the vanished one never wrote a finished record, because it never finished',
    );

    const run = runOf(host, runId);
    assert.equal(run.status, 'ended-budget-exhausted', 'the run completed on its retry and ended at the generation it was allowed');
    assert.equal(run.meters?.endedBy, 'generation-limit', 'the generation it was allowed, not the time box');
    assert.equal(ran.kind, 'success', ran.text);
  } finally {
    killSessions([...sessions, ...openSessionsHere(host)]);
    await dispose();
  }
});

test('two runs started in the same instant do not both launch past a cap of one: the check and the launch are one step per site', async (t) => {
  // The case the campaign-id fix was justified by, and the one a staggered start cannot reach: two
  // Runs whose slot checks interleave with each other's launches. Eight seconds of stand-in
  // synthesis, so whichever one waits is unambiguous, and a 42-second box so a run that is queued
  // behind a cap nothing enforces ends on its own rather than on this command's timeout.
  const local = await localFabric(t, { sleepSeconds: 8 });
  if (!local) return;
  const { h, host, dispose } = local;
  let sessions: string[] = [];
  try {
    const line = `/hima run ${timingProbePackId} --site local --goal target_period_ns=2.0 --set periodNs=2.0 --time-box 0.7 ${ONE_GENERATION}`;
    const both = await Promise.all([
      himaCommand(host, h.workspace, line, siteCommandTimeoutMs),
      himaCommand(host, h.workspace, line, siteCommandTimeoutMs),
    ]);
    for (const outcome of both) for (const line of outcome.text.split('\n')) t.diagnostic(line);
    const runIds = both.map((o) => o.runId!);
    assert.equal(new Set(runIds).size, 2, `two runs, not one: ${runIds.join(', ')}`);
    sessions = runIds.flatMap((id) => sessionsOf(host, id));

    // Two Campaigns started in the same instant, each with its own workspace and its own container:
    // the one-second campaign id would have given them all three in common.
    const prepared = runIds.map((id) => workspaceRecords(host, id)[0]!);
    assert.equal(new Set(prepared.map((w) => w.campaignId)).size, 2, `two campaign ids: ${prepared.map((w) => w.campaignId).join(', ')}`);
    assert.equal(new Set(prepared.map((w) => w.workspace)).size, 2, `two workspaces: ${prepared.map((w) => w.workspace).join(', ')}`);
    assert.equal(new Set(prepared.map((w) => w.containerName)).size, 2, `two container names: ${prepared.map((w) => w.containerName).join(', ')}`);

    const queuedAt = runIds.findIndex((id) => nodeRecords(host, id).some((r) => r.state === 'waiting-for-slot'));
    assert.equal(
      runIds.filter((id) => nodeRecords(host, id).some((r) => r.state === 'waiting-for-slot')).length,
      1,
      'exactly one of the two waited for a slot; the other claimed it',
    );

    // And the cap really held: the queued Run's Job did not start until the other's had finished, so
    // the Site never ran two Jobs against a declared capacity of one.
    const queued = jobRecords(host, runIds[queuedAt]!);
    const held = jobRecords(host, runIds[1 - queuedAt]!);
    const launchedAt = queued.find((r) => r.event === 'launched')!.at;
    const releasedAt = held.find((r) => r.event === 'finished')!.at;
    t.diagnostic(`the slot was released at ${releasedAt} and the queued run launched at ${launchedAt}`);
    assert.ok(
      Date.parse(launchedAt) >= Date.parse(releasedAt),
      `the two jobs' lifetimes overlap: the queued run launched at ${launchedAt}, before the slot was released at ${releasedAt}`,
    );

    for (const id of runIds) {
      const run = runOf(host, id);
      assert.equal(run.status, 'ended-budget-exhausted', `run ${id} completed`);
      // Which meter, and not merely that one of them: a Run held behind an unenforced cap would run
      // past the 42-second box and end `ended-budget-exhausted` too, by `time-box`. Since the pack
      // began to loop both endings say the same status word, so only `endedBy` tells the ending this
      // test is about — the one generation it was allowed, spent — from the failure it is watching for.
      assert.equal(run.meters?.endedBy, 'generation-limit', `run ${id} ended at the generation it was allowed, not on the box`);
      assert.equal(run.budget?.jobCap, 1, 'under the cap the site declares');
    }
  } finally {
    killSessions([...sessions, ...openSessionsHere(host)]);
    await dispose();
  }
});

test('a run resumed after its time box would have run out still gets its generation: the box meters the design, not the person', async (t) => {
  // A Hard blocker is by definition something only a person can clear, so almost every real resume
  // arrives after the box would have run out — the engineer sees it the next morning. The Budget
  // meters the design and the EDA environment (CONTEXT.md), and nothing was running while the Run
  // waited, so that wait must not be charged to it.
  //
  // A six-second box, a stand-in that does not sleep at all so three attempts fail well inside it,
  // and a wait past the six seconds before the resume.
  const local = await localFabric(t, { sleepSeconds: 0, failures: 4 });
  if (!local) return;
  const { h, host, dispose } = local;
  let sessions: string[] = [];
  try {
    const blocked = await himaCommand(
      host,
      h.workspace,
      `/hima run ${timingProbePackId} --site local --goal target_period_ns=2.0 --set periodNs=2.0 --retries 3 --time-box 0.1 ${ONE_GENERATION}`,
      siteCommandTimeoutMs,
    );
    for (const line of blocked.text.split('\n')) t.diagnostic(line);
    assert.equal(blocked.kind, 'error', blocked.text);
    const runId = blocked.runId!;
    sessions = sessionsOf(host, runId);
    const waiting = runOf(host, runId);
    assert.equal(waiting.status, 'waiting', 'the allowance was spent inside the box, and the run waits for a person');
    assert.equal(blockerRecords(host, runId).length, 1, 'on a hard blocker');
    const createdAt = Date.parse(waiting.createdAt);
    t.diagnostic(`the run blocked ${Date.now() - createdAt} ms into a 6000 ms box`);

    // The person comes back after the box would have run out.
    await until('the time box would have run out', () => Date.now() - createdAt > 8_000, 20_000);
    const resumed = await himaCommand(host, h.workspace, `/hima resume ${runId}`, siteCommandTimeoutMs);
    for (const line of resumed.text.split('\n')) t.diagnostic(line);
    sessions = sessionsOf(host, runId);

    const run = runOf(host, runId);
    assert.equal(run.status, 'ended-budget-exhausted', `the resume got its generation and ran it out: ${resumed.text}`);
    assert.equal(run.meters?.endedBy, 'generation-limit', 'the generation it was allowed ended it, and never the time box');
    assert.ok(
      (run.meters?.waitedMs ?? 0) >= 2_000,
      `the meters say how long the run was waiting on a person: ${JSON.stringify(run.meters)}`,
    );
    assert.ok(
      (run.meters?.waitedMs ?? 0) <= (run.meters?.elapsedMs ?? 0),
      `and no more than the run has been open: ${JSON.stringify(run.meters)}`,
    );
    assert.deepEqual(
      attemptsAt(host, runId, 'synthesize'),
      [
        ['running', 1], ['retrying', 1], ['running', 2], ['retrying', 2], ['running', 3], ['blocked', 3],
        ['running', 4], ['retrying', 4], ['running', 5], ['done', 5],
      ],
      'the run really did carry on: two more attempts after the resume, on a box that had six seconds left in it',
    );
    assert.equal(resumed.kind, 'success', resumed.text);
  } finally {
    killSessions([...sessions, ...openSessionsHere(host)]);
    await dispose();
  }
});

test('a job launched by hand holds the site\'s only slot, is refused a second one, and releases it without anyone asking its status', async (t) => {
  // The `/hima job` face launches onto the same Site the fabric does, so it is under the same cap —
  // and a Job launched there is only ever asked about if someone chooses to. If nothing else looked,
  // a hand-launched Job that ended would hold a slot forever and every later Run on that Site would
  // queue behind it until its box ran out. Nothing in this test ever calls `/hima job status`.
  const local = await localFabric(t, { sleepSeconds: 0 });
  if (!local) return;
  const { h, host, dispose } = local;
  let sessions: string[] = [];
  try {
    const script = path.join(h.workspace, 'hold-slot.sh');
    await writeFile(script, 'sleep 6\n');
    const held = await himaCommand(host, h.workspace, `/hima job launch local ${h.workspace} --name hold-slot -- sh ${script}`);
    t.diagnostic(held.text);
    assert.equal(held.kind, 'success', held.text);
    const handRunId = held.runId!;
    const handSession = jobRecords(host, handRunId)[0]!.job.session;
    sessions = [handSession];

    // The gate: the same cap, on the same face, answered in words a person can act on.
    const refused = await himaCommand(host, h.workspace, `/hima job launch local ${h.workspace} --name second -- sh ${script}`);
    t.diagnostic(refused.text);
    assert.equal(refused.kind, 'error', refused.text);
    assert.match(refused.text, /cap of 1/, `the refusal names the site's slot count: ${refused.text}`);
    assert.match(refused.text, new RegExp(handSession), `and what holds it: ${refused.text}`);
    assert.equal(jobRecords(host, handRunId).filter((r) => r.event === 'launched').length, 1, 'and nothing was launched');

    // And a Run started now waits for that Job, then launches once it has ended — with nobody having
    // asked what became of it.
    const ran = await himaCommand(
      host,
      h.workspace,
      `/hima run ${timingProbePackId} --site local --goal target_period_ns=2.0 --set periodNs=2.0 --time-box 0.7 ${ONE_GENERATION}`,
      siteCommandTimeoutMs,
    );
    for (const line of ran.text.split('\n')) t.diagnostic(line);
    const runId = ran.runId!;
    sessions = [handSession, ...sessionsOf(host, runId)];
    assert.equal(ran.kind, 'success', ran.text);

    assert.deepEqual(
      nodeRecords(host, runId).filter((r) => r.nodeId === 'synthesize').map((r) => r.state),
      ['waiting-for-slot', 'running', 'done'],
      'it waited for the hand-launched job, then launched, then finished',
    );
    assert.deepEqual(
      jobRecords(host, handRunId).map((r) => r.event),
      ['launched', 'finished'],
      'the hand-launched job\'s end is on the record, written by the count that needed its slot and not by a person asking',
    );
    const releasedAt = jobRecords(host, handRunId).find((r) => r.event === 'finished')!.at;
    const launchedAt = jobRecords(host, runId).find((r) => r.event === 'launched')!.at;
    t.diagnostic(`the hand-launched job released the slot at ${releasedAt} and the run launched at ${launchedAt}`);
    assert.ok(Date.parse(launchedAt) >= Date.parse(releasedAt), `the run launched at ${launchedAt}, before the slot was released at ${releasedAt}`);
  } finally {
    killSessions([...sessions, ...openSessionsHere(host)]);
    await dispose();
  }
});

test('a case variant of the site name is refused as an unknown site before the cap it would have collided with is ever asked: `/hima job launch LOCAL` is not a second slot on `local`', async (t) => {
  // A Site's identity is the `name:` in its own file — `runFor` stamps it on every Job record, and
  // `openJobsOn` finds Jobs by it. Before #19, `loadSite` on this filesystem happily read `local.yml`
  // when asked for `LOCAL`, so a face that keyed its count and its per-Site lock on the string a
  // person typed counted a list that was empty by construction and serialized against nobody — #15's
  // fix was keying the cap on `site.name` instead. `loadSite` now refuses the mismatch itself, before
  // the cap or anything else on the Site is asked, so a case variant never reaches the cap at all: it
  // is refused as an unknown site regardless of whether the slot it would have collided with is free
  // or held (#19). What this test now guards is that the held slot is exactly as untouched by the
  // refused launch as the cap itself is — the job list still holds only the one job that was really launched.
  const local = await localFabric(t, { sleepSeconds: 0 });
  if (!local) return;
  const { h, host, dispose } = local;
  let sessions: string[] = [];
  try {
    const script = path.join(h.workspace, 'hold-slot.sh');
    await writeFile(script, 'sleep 6\n');
    const first = await himaCommand(host, h.workspace, `/hima job launch local ${h.workspace} --name one -- sh ${script}`);
    t.diagnostic(first.text);
    assert.equal(first.kind, 'success', first.text);
    const firstSession = jobRecords(host, first.runId!)[0]!.job.session;
    sessions = [firstSession];

    await assert.rejects(
      () => himaCommand(host, h.workspace, `/hima job launch LOCAL ${h.workspace} --name two -- sh ${script}`),
      (err) => {
        assert.ok(err instanceof Error, `expected an Error, got ${String(err)}`);
        assert.match(err.message, /unknown site "LOCAL"/, err.message);
        assert.match(err.message, /is the site file of "local"/, `the refusal names the Site as the Site names itself: ${err.message}`);
        return true;
      },
      'a case variant of the site name is refused as unknown, never as a second slot',
    );
    // Read after the rejection, so a launch that should not have happened is still cleaned up.
    sessions = openSessionsHere(host);

    assert.deepEqual(
      openJobsHere(host).map((r) => r.job.name),
      ['one'],
      'one job on the site: the refused launch never reached the channel, let alone the cap',
    );
  } finally {
    killSessions([...sessions, ...openSessionsHere(host)]);
    await dispose();
  }
});

test('a waiting run whose box was spent when it stopped is refused a resume in the same words by the command and the route, and nothing is written', async (t) => {
  // A Run can be left `waiting` with no blocker at all: a fault mid-drive stops it where it stands,
  // and so does a time box whose kill did not take. Nobody is being asked anything, so nothing
  // widens the box, and a Run whose box was already spent when it stopped could only be driven
  // straight to `ended-budget-exhausted` — with a `person` record in the ledger claiming someone
  // cleared a blocker that was never re-attempted, and no way back. It is refused instead, and every
  // face must refuse it in the same words: the half of the sentence that says nothing was written is
  // the half that tells the caller whether they have anything to undo.
  //
  // The fault is the EISDIR pattern the fabric suite uses: the observe node's output path is the
  // report *directory*, which the permit resolves and allows and which throws from inside the node's
  // turn. A six-second box, and the resume comes after it.
  const h = await localHome(t, { sleepSeconds: 0 });
  if (!h) return;
  let host: BootedHost | undefined;
  let runId = '';
  let said = '';
  let sessions: string[] = [];
  const first = await bootInProcess(h);
  try {
    await writePackVariant(packsDirOf(h), 'reads-a-directory', [
      ['    path: flow/results/${design}/syn/report/qor.rpt', '    path: flow/results/${design}/syn/report'],
    ]);
    const started = await himaCommand(
      first,
      h.workspace,
      '/hima run reads-a-directory --site local --goal target_period_ns=2.0 --set periodNs=2.0 --time-box 0.1',
      siteCommandTimeoutMs,
    );
    for (const line of started.text.split('\n')) t.diagnostic(line);
    assert.equal(started.kind, 'error', started.text);
    runId = started.runId!;
    sessions = sessionsOf(first, runId);

    const stopped = runOf(first, runId);
    assert.equal(stopped.status, 'waiting', `the fault left the run waiting, not running: ${started.text}`);
    assert.equal(stopped.currentNode, 'read-qor', 'at the node the fault happened at');
    assert.deepEqual(blockerRecords(first, runId), [], 'and with no blocker on it: nobody was asked anything');
    const boxMs = stopped.budget!.timeBoxMs;
    said = [
      `run ${runId} had already spent its time box of ${boxMs} ms when it stopped,`,
      'so resuming it could only end it as ended-budget-exhausted;',
      'start a fresh run instead; nothing was written',
    ].join(' ');

    // The person comes back after the box would have run out. Nothing widened it: no blocker was
    // ever written, so no wait was ever charged back.
    const createdAt = Date.parse(stopped.createdAt);
    await until('the time box would have run out', () => Date.now() - createdAt > boxMs + 2_000, 20_000);

    const refused = await himaCommand(first, h.workspace, `/hima resume ${runId}`, siteCommandTimeoutMs);
    for (const line of refused.text.split('\n')) t.diagnostic(line);
    assert.equal(refused.kind, 'error', refused.text);
    assert.equal(refused.text, `cannot resume ${runId}: ${said}`, 'the command says why, and says that nothing was written');
    assert.deepEqual(resumedRecords(first, runId), [], 'and no person\'s action was recorded');
    assert.equal(runOf(first, runId).status, 'waiting', 'the run stands exactly where it stood');
    assert.equal(runOf(first, runId).currentNode, 'read-qor');

    // The tool is the second face, and it is asked here rather than in a test of its own because the
    // Run is already standing where this refusal happens and asking costs it nothing.
    const agent = await createRootAgent(first.ctx, h.workspace);
    const asked = await first.ctx.tools.execute({
      callId: 'call-hima-resume-unresumable' as never,
      name: 'hima_resume',
      arguments: { run: runId },
      agent,
      signal: AbortSignal.timeout(siteCommandTimeoutMs),
    });
    const value = (asked as unknown as { value?: { kind: string; reason?: string } }).value!;
    t.diagnostic(JSON.stringify(value));
    assert.equal(value.kind, 'unresumable', JSON.stringify(asked));
    assert.equal(value.reason, said, 'the tool says it in the same words the command does');
    assert.deepEqual(resumedRecords(first, runId), [], 'and it wrote nothing either');
  } finally {
    killSessions(sessions);
    await first.dispose();
  }

  // The same refusal through the workbench's own route, on a host that never saw the run happen.
  try {
    host = await bootHimaHost(h);
    const cookie = await openSession(host);
    const refused = await api(host, cookie, `/hima/api/runs/${runId}/resume`, { method: 'POST' });
    const refusedText = await refused.text();
    assert.equal(refused.status, 400, refusedText);
    const body = JSON.parse(refusedText) as { error: { code: string; message: string } };
    assert.equal(body.error.code, 'hima/bad-request', refusedText);
    assert.equal(body.error.message, `cannot resume run ${runId}: ${said}`, 'the route says it in the same words the command does');

    const records = await api(host, cookie, `/hima/api/runs/${runId}/records?type=resumed`);
    const listed = JSON.parse(await records.text()) as { records: unknown[] };
    assert.deepEqual(listed.records, [], 'and it wrote nothing either');
    const view = JSON.parse(await (await api(host, cookie, `/hima/api/runs/${runId}`)).text()) as RunView;
    assert.equal(view.run.status, 'waiting', 'the run is still there to be read, still waiting');
    assert.equal(view.run.currentNode, 'read-qor');
  } finally {
    if (host) {
      const code = await host.stop();
      assert.equal(code, 0, `host exited ${code}\n${host.stderr()}`);
    }
    await h.dispose();
  }
});
