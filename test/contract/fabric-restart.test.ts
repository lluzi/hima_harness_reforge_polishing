// @hima-seam tools direct
// Ticket #14: a Run outlives the host, and it obeys a cancel.
//
// Two properties, both asserted at the booted-Host seam over the local site. **Restart**: a host is
// disposed while the stand-in synthesis Job sleeps on the Site, and a new host is booted on the same
// home. The new host reconciles from the ledger alone — the Job is found again through its own
// `launched` record, never through a handle the dead host held — and carries the Run on: still
// running, keep waiting; finished while the host was down, pick the exit file up and continue; gone
// with no exit file, a failed attempt the Retry allowance decides — another turn while the allowance
// stands, the node blocked and the Run waiting once it is spent. Nothing is ever *re*launched, so a
// restarted generation costs no second licence-minute for the attempt that was interrupted, and a
// retry is a new attempt with its own Job and not a second launch of that one. **Cancel**: `/hima
// cancel`, the `hima_cancel` tool and `POST /hima/api/runs/<id>/cancel` stop the Job on the Site,
// wait for the session to be observed gone, and end the Run cancelled — the request and the observed
// stop being two records.
//
// Disposing an in-process host is how a host is taken away mid-Job here: the ledger domain closes
// with it, so the drive it was running stops at its next ledger touch and writes nothing more, which
// is exactly what a host that went away does. The stand-in flow's `synth` target sleeps, which is
// what makes the Job demonstrably still running while its host is taken from it. Local site only;
// the reference site is #17.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, readFile, rm, writeFile } from 'node:fs/promises';
import { type HimaHome } from './support/dsh-home.ts';
// The pieces every fabric suite composes: the home a Run is driven in, the ledger as a test reads
// it, and the waits that let a test act while a Job is still on the Site.
import {
  attemptWaitingOn,
  jobRecords,
  launchedJobOf,
  localHome,
  nodeRecords,
  ONE_GENERATION,
  recordsOf,
  resumedRecords,
  runOf,
  sessionsOf,
  startRunInBackground,
  waitUntil,
  type OpenJob,
} from './support/fabric.ts';
import { bootInProcess, createRootAgent, type InProcessHost } from './support/boot-inprocess.ts';
import { bootHimaHost, type BootedHost } from './support/boot-host.ts';
import { api, openSession } from './support/hima-api.ts';
import { himaCommand, siteCommandTimeoutMs, type CommandOutcome } from './support/command.ts';
import { writeLocalSite } from './support/site.ts';
import {
  candidateCountType,
  candidateSlackType,
  installPackReader,
  MINED_SLACK_MODE,
  MINED_SLACK_NS,
  MINED_SLACK_SCOPE,
  MINED_TOP_N,
  packReaderFile,
  packReaderId,
  packReaderScript,
  packsDirOf,
  timingProbePackId,
} from './support/pack.ts';
import { killSession, startSession, tmuxHasSession } from './support/tmux.ts';
import type {} from '@deepseek-ai/dsh-tools';
import { clearRemoteCommands, jobPollFastForMs, jobPollFastMs, jobPollSlowMs, remoteCommands } from '@hima/harness';
import type { CancelRecord, NodeRecord, RunView } from '@hima/harness';

/** How long a test waits for something on the Site to become true before it fails. */
const waitTimeoutMs = 60_000;

const cancelRecords = (host: InProcessHost, runId: string): CancelRecord[] =>
  recordsOf(host, runId).filter((r): r is CancelRecord => r.type === 'cancel');

/**
 * Everything one of these tests must put back however it ends: the hosts it booted, which hold the
 * process open until their fibers unload, the stand-in Jobs it launched, which go on sleeping on the
 * Site, and the isolated home. A failed assertion must leave this machine as it found it.
 */
function cleanup(h: HimaHome) {
  const hosts = new Set<InProcessHost>();
  const web = new Set<BootedHost>();
  const sessions = new Set<string>();
  return {
    /** Boot an in-process host, remembered so it is disposed however the test ends. */
    async boot(): Promise<InProcessHost> {
      const host = await bootInProcess(h);
      hosts.add(host);
      return host;
    },
    /** Boot the profile as a real subprocess with its web app, for the tests that drive the routes. */
    async bootWeb(): Promise<BootedHost> {
      const host = await bootHimaHost(h);
      web.add(host);
      return host;
    },
    /** Take a host away mid-Job, as this suite's restarts do; it is no longer this cleanup's to dispose. */
    async drop(host: InProcessHost): Promise<void> {
      hosts.delete(host);
      await host.dispose();
    },
    remember(session: string): void { sessions.add(session); },
    /** Every host down, every Job stopped, the home removed. */
    async done(): Promise<void> {
      for (const session of sessions) killSession(session);
      for (const host of hosts) await host.dispose().catch(() => undefined);
      for (const host of web) await host.stop().catch(() => undefined);
      await h.dispose();
    },
  };
}

/**
 * Poll as fast as the event loop allows until something is there, and answer with it.
 *
 * `waitUntil` below polls on a timer, which is right for waiting on a Site. This is for the
 * milliseconds *inside* one launch: a test racing that window has to look in the same event-loop
 * turns the drive is using, and a hundred-millisecond timer would arrive long after the launch it
 * meant to race.
 */
async function raceUntil<T>(what: string, probe: () => T | undefined, timeoutMs = waitTimeoutMs): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = probe();
    if (found !== undefined) return found;
    if (Date.now() >= deadline) throw new Error(`${what} did not happen within ${timeoutMs} ms`);
    await new Promise((r) => setImmediate(r));
  }
}

/**
 * Was this session asked after on the wire since the audit was last cleared?
 *
 * The channel audit is the evidence that a decision was the Site's and not the ledger's: a `tmux
 * has-session` naming this exact session is the harness asking whether a Job it has records about is
 * really still there. `=<session>` is how tmux is told to match a name exactly, which is what the
 * job plumbing sends, so the assertion holds the argv the Site was actually given.
 */
const askedAboutSession = (session: string): boolean =>
  remoteCommands().some((c) => c.argv[0] === 'tmux' && c.argv[1] === 'has-session' && c.argv.includes(`=${session}`));

/**
 * Wait for the wall clock to enter its next second.
 *
 * A Campaign id is the pack's id and a timestamp to the second, so two Runs started inside one second
 * would share a Campaign and its workspace. #15 gives the id the resolution to tell them apart; until
 * then a test that needs two Runs at once keeps them a second apart itself, rather than asserting on
 * whichever of the two shapes the machine happened to produce.
 */
async function nextWallClockSecond(): Promise<void> {
  const inSecond = Math.floor(Date.now() / 1000);
  while (Math.floor(Date.now() / 1000) === inSecond) await new Promise((r) => setTimeout(r, 20));
}

// One generation, because a restart is what this suite is about: the shipped pack's own loop would
// go round again with the period the chooser chose, and these tests would then be asserting over
// three generations' records instead of the one the host was taken away in the middle of.
const runLine = (goalNs = 2.0, retries?: number): string =>
  `/hima run ${timingProbePackId} --site local --goal target_period_ns=${goalNs} --set periodNs=${goalNs}${retries === undefined ? '' : ` --retries ${retries}`} ${ONE_GENERATION}`;

/** The node records of one whole generation, as they stand after a reconciliation carried it on. */
const wholeGeneration = (): [string, string][] => [
  ['synthesize', 'running'],
  ['synthesize', 'reconciled'],
  ['synthesize', 'done'],
  ['read-qor', 'running'], ['read-qor', 'done'],
  ['judge', 'running'], ['judge', 'done'],
  ['next-period', 'running'], ['next-period', 'done'],
];

test('a host disposed while the job sleeps is replaced by one that finds the same job still running and carries the run to its end, launching nothing twice', async (t) => {
  // Twenty seconds of stand-in synthesis: long enough that the Job is demonstrably still sleeping
  // when the first host is taken away and the second one has booted.
  const local = await localHome(t, { sleepSeconds: 20 });
  if (!local) return;
  const { h } = local;
  const after = cleanup(h);
  try {
    const first = await after.boot();
    const pending = startRunInBackground(first, h, runLine());
    const job = await launchedJobOf(first);
    after.remember(job.session);
    assert.ok(tmuxHasSession(job.session), 'the stand-in job is running on the site');
    await after.drop(first);
    // The dead host's drive stops at its next ledger touch; waiting for it here is what keeps the two
    // hosts from ever writing to the same ledger at once.
    await pending;
    assert.ok(tmuxHasSession(job.session), 'and it is still running: a host going away does not stop a Job');

    const second = await after.boot();
    const reconciled = await second.ctx.hima.reconciled;
    assert.deepEqual(
      reconciled.map((r) => [r.runId, r.found]),
      [[job.runId, 'running']],
      `one run picked up, and its job found still running: ${JSON.stringify(reconciled)}`,
    );

    const { runId } = job;
    assert.deepEqual(
      nodeRecords(second, runId).map((r) => [r.nodeId, r.state]),
      wholeGeneration(),
      'the new host wrote what it found and then finished the generation the old one started',
    );
    const found = nodeRecords(second, runId).find((r) => r.state === 'reconciled')!;
    assert.equal(found.jobSession, job.session, 'the reconciled record names the session it found');
    assert.equal(found.attempt, 1, 'and belongs to the attempt that was interrupted, not to a new one');
    assert.match(found.reason ?? '', /still running/, `and says what it found: ${found.reason}`);

    assert.deepEqual(
      jobRecords(second, runId).map((r) => r.event),
      ['launched', 'finished'],
      'exactly one launch: a restart costs no second licence-minute',
    );
    const run = runOf(second, runId);
    assert.equal(run.status, 'ended-budget-exhausted', 'the run reached the end of the generation it was allowed');
    assert.equal(run.meters?.endedBy, 'generation-limit');
    assert.deepEqual(
      recordsOf(second, runId).findLast((r) => r.type === 'decision')?.chosen,
      { strategy: { periodNs: 2.15 } },
      'and chose the next strategy, as an unbroken run does',
    );
    assert.equal(run.meters?.jobsLaunched, 1);
    assert.equal(run.meters?.attempts, 4, 'one attempt at each of the four nodes, across the two hosts');

    const status = await himaCommand(second, h.workspace, `/hima status ${runId}`);
    for (const line of status.text.split('\n')) t.diagnostic(line);
    assert.match(status.text, /ended-budget-exhausted/, status.text);
  } finally {
    await after.done();
  }
});

test('a job that finished while the host was down is picked up from its exit file, and the run continues from there', async (t) => {
  // Six seconds: long enough to take the host away while the Job sleeps, short enough that the Job
  // then finishes with nothing at all watching it.
  const local = await localHome(t, { sleepSeconds: 6 });
  if (!local) return;
  const { h } = local;
  const after = cleanup(h);
  try {
    const first = await after.boot();
    const pending = startRunInBackground(first, h, runLine());
    const job = await launchedJobOf(first);
    after.remember(job.session);
    await after.drop(first);
    await pending;
    const { runId, session } = job;
    await waitUntil('the stand-in job finished with no host watching', () => !tmuxHasSession(session));

    const second = await after.boot();
    const reconciled = await second.ctx.hima.reconciled;
    assert.deepEqual(reconciled.map((r) => [r.runId, r.found]), [[runId, 'finished']], JSON.stringify(reconciled));

    const found = nodeRecords(second, runId).find((r) => r.state === 'reconciled')!;
    assert.match(found.reason ?? '', /finished/, `the record says what the exit file held: ${found.reason}`);
    assert.match(found.reason ?? '', /exit 0/, `${found.reason}`);
    assert.deepEqual(
      nodeRecords(second, runId).map((r) => [r.nodeId, r.state]),
      wholeGeneration(),
      'the node settled from the exit the launch itself wrote, and the graph ran on',
    );
    const jobs = jobRecords(second, runId);
    assert.deepEqual(jobs.map((r) => r.event), ['launched', 'finished'], 'still one launch');
    assert.equal(jobs[1]!.exitCode, 0, 'with the exit code read from the file, never inferred');
    assert.equal(runOf(second, runId).status, 'ended-budget-exhausted');
  } finally {
    await after.done();
  }
});

test('a job gone without an exit file is a failed attempt: the node is recorded as gone and the run waits, naming it', async (t) => {
  const local = await localHome(t, { sleepSeconds: 20 });
  if (!local) return;
  const { h } = local;
  const after = cleanup(h);
  try {
    // An allowance of one, so the first failed attempt is the last: what becomes of a Job that
    // vanished is the Retry allowance's to say, and this test is about the failure, not the retry.
    const first = await after.boot();
    const pending = startRunInBackground(first, h, runLine(2.0, 1));
    const job = await launchedJobOf(first);
    after.remember(job.session);
    await after.drop(first);
    await pending;

    // The Job vanishes: its session is killed by hand and its exit file removed, which is what a Job
    // reaped by a cluster or an operator looks like from the ledger's side.
    const { runId, session } = job;
    killSession(session);
    await rm(path.join(job.workspace, `${session}.exit`), { force: true });
    await waitUntil('the job vanished', () => !tmuxHasSession(session));

    const second = await after.boot();
    const reconciled = await second.ctx.hima.reconciled;
    assert.deepEqual(reconciled.map((r) => [r.runId, r.found]), [[runId, 'gone']], JSON.stringify(reconciled));

    assert.deepEqual(
      nodeRecords(second, runId).map((r) => [r.nodeId, r.state]),
      [['synthesize', 'running'], ['synthesize', 'reconciled'], ['synthesize', 'blocked'], ['blocked', 'blocked']],
      'what it found, then the failed attempt, then the wait node a spent allowance routes to: nothing was invented and nothing was relaunched',
    );
    const blocked = nodeRecords(second, runId).find((r) => r.nodeId === 'synthesize' && r.state === 'blocked')!;
    assert.equal(blocked.jobSession, session, 'the blocker names the session it accounted for');
    assert.match(blocked.reason ?? '', /synthesize/, `the blocker names the node: ${blocked.reason}`);
    assert.match(blocked.reason ?? '', /no exit status/, `and says why it is one: ${blocked.reason}`);
    assert.deepEqual(jobRecords(second, runId).map((r) => r.event), ['launched'], 'no finished record: no exit code was invented');
    assert.equal(runOf(second, runId).status, 'waiting', 'a failed attempt the harness cannot clear waits for a person');

    const status = await himaCommand(second, h.workspace, `/hima status ${runId}`);
    for (const line of status.text.split('\n')) t.diagnostic(line);
    assert.match(status.text, /synthesize \(act\): blocked/, status.text);
  } finally {
    await after.done();
  }
});

test('a host booting onto a job that vanished retries it under the default allowance: a second attempt, and never two jobs on the site at once', async (t) => {
  // The path neither ticket could produce on its own. #14 reconciles a Job that is gone; #15 makes a
  // gone Job a failed attempt the Retry allowance decides. Composed, a host that starts on a ledger
  // whose Job vanished writes `reconciled`, then `retrying`, and then launches a *new* Job with
  // nobody watching — on the reference Site, two and a half minutes of licensed Design Compiler. The
  // test above pins the far end of that allowance by spending it (`--retries 1`); this one is the
  // near end, with the allowance a person who typed nothing about retries gets.
  //
  // What it costs is the point: one relaunch, numbered as the attempt after the one that vanished,
  // and one Job on the Site at a time. The corpse's launch is still open in the ledger while the
  // retry runs — nothing ever writes an ending for a Job that wrote none — so a job cap that counted
  // it would queue this Run's own retry behind its own corpse, and on a Site declaring one slot the
  // retry would never launch at all. Hence the three-minute box: that failure would otherwise sit
  // here for the default hour instead of failing.
  const local = await localHome(t, { sleepSeconds: 20 });
  if (!local) return;
  const { h } = local;
  const after = cleanup(h);
  try {
    const first = await after.boot();
    const pending = startRunInBackground(first, h, `${runLine()} --time-box 3`);
    const job = await launchedJobOf(first);
    after.remember(job.session);
    await after.drop(first);
    await pending;

    // The Job vanishes as it does in the test above: the session ended and no exit status written,
    // which is what a Job reaped while no host was watching looks like from the ledger's side.
    const { runId, session } = job;
    killSession(session);
    await rm(path.join(job.workspace, `${session}.exit`), { force: true });
    await waitUntil('the job vanished', () => !tmuxHasSession(session));

    const second = await after.boot();
    // Caught while the retry is still sleeping, because the two halves of "one Job at a time" are
    // only both true in this window: the Site has the retry and not the corpse, and the ledger still
    // holds the corpse's launch open beside the retry's.
    let retry: string | undefined;
    await waitUntil('the new host relaunched the attempt whose job had vanished', () => {
      retry = sessionsOf(second, runId).find((s) => s !== session);
      return retry !== undefined;
    });
    after.remember(retry!);
    assert.ok(tmuxHasSession(retry!), 'the retry is running on the site');
    assert.ok(!tmuxHasSession(session), 'and the job it replaced is not: one job on the site, never two');
    assert.deepEqual(
      [...second.ctx.hima.ledger.openJobsOn('local')].map((r) => r.job.session).sort(),
      [session, retry!].sort(),
      'while the ledger holds both launches open: no ending was invented for the job that wrote none, and the site of one slot launched the retry anyway',
    );

    const reconciled = await second.ctx.hima.reconciled;
    assert.deepEqual(reconciled.map((r) => [r.runId, r.found]), [[runId, 'gone']], JSON.stringify(reconciled));

    assert.deepEqual(
      nodeRecords(second, runId).map((r) => [r.nodeId, r.state]),
      [
        ['synthesize', 'running'], ['synthesize', 'reconciled'], ['synthesize', 'retrying'],
        ['synthesize', 'running'], ['synthesize', 'done'],
        ['read-qor', 'running'], ['read-qor', 'done'],
        ['judge', 'running'], ['judge', 'done'],
        ['next-period', 'running'], ['next-period', 'done'],
      ],
      'what the new host found, then the failed attempt, then the retry that carried the generation through',
    );
    assert.deepEqual(
      nodeRecords(second, runId).filter((r) => r.nodeId === 'synthesize').map((r) => [r.state, r.attempt]),
      [['running', 1], ['reconciled', 1], ['retrying', 1], ['running', 2], ['done', 2]],
      'the reconciliation belongs to the interrupted attempt, and the retry is the attempt after it',
    );
    const found = nodeRecords(second, runId).find((r) => r.state === 'reconciled')!;
    assert.equal(found.jobSession, session, 'the reconciled record names the session it found gone');
    assert.match(found.reason ?? '', /is gone/, `and says what it found: ${found.reason}`);
    const retried = nodeRecords(second, runId).find((r) => r.state === 'retrying')!;
    assert.equal(retried.jobSession, session, 'and the retry accounts for that same session, which is what frees its slot');

    assert.deepEqual(
      sessionsOf(second, runId),
      [session, retry!],
      'two launches and no more: nothing was relaunched, and the retry is a fresh session with its own log and exit file',
    );
    // A `launched` record carries no attempt of its own — the node record waiting on its session does
    // — so each launch is numbered through the `running` record that named it.
    assert.deepEqual(
      sessionsOf(second, runId).map((s) => attemptWaitingOn(second, runId, s)),
      [1, 2],
      'attempt one, then attempt two: a retry numbered one again would be an allowance that never runs out',
    );
    assert.deepEqual(
      nodeRecords(second, runId).filter((r) => r.state === 'waiting-for-slot'),
      [],
      'and nothing queued for a slot: the corpse was never counted against its own retry',
    );
    assert.deepEqual(jobRecords(second, runId).map((r) => r.event), ['launched', 'launched', 'finished'], 'the vanished job wrote no finished record, because it never finished');

    const run = runOf(second, runId);
    assert.match(run.status ?? '', /^ended-/, `the second attempt carried the run to an end: ${JSON.stringify(run)}`);
    assert.equal(run.status, 'ended-budget-exhausted', 'the same end an unbroken run reaches');
    assert.equal(run.meters?.jobsLaunched, 2, 'two jobs: the interrupted attempt and its retry, and no third');
    assert.equal(run.meters?.endedBy, 'generation-limit', 'the generation it was allowed ended it, and no other meter');

    const status = await himaCommand(second, h.workspace, `/hima status ${runId}`);
    for (const line of status.text.split('\n')) t.diagnostic(line);
    assert.match(status.text, /ended-budget-exhausted/, status.text);
  } finally {
    await after.done();
  }
});

test('a run cancelled while the reconciliation is carrying an earlier one on keeps the ending a person gave it', async (t) => {
  // Two slots, because this is a test about two Runs mid-Job at once, and a Site that declares one
  // would queue the second behind the first rather than let it launch (D25, D33).
  const local = await localHome(t, { sleepSeconds: 20, parallelJobs: 2 });
  if (!local) return;
  const { h } = local;
  const after = cleanup(h);
  try {
    // Two Runs mid-Job when their host goes away. A reconciliation picks Runs up one after another
    // and waits for each — one Run at a time, whatever the Site's job cap allows to run at once — so
    // the second Run's turn comes however long the first one's Job takes, which for a synthesis is
    // minutes, and the routes have been answering the whole time. What a person does inside that
    // window is the state the second Run must be reconciled from; the run rows the reconciliation
    // read when it started are, by then, a record of what used to be true.
    const first = await after.boot();
    const one = startRunInBackground(first, h, runLine());
    await launchedJobOf(first);
    // A Campaign id names its second, so the two Runs are started a second apart to keep them out of
    // one another's workspace (#15 gives the id the resolution to do that on its own).
    await nextWallClockSecond();
    const two = startRunInBackground(first, h, runLine(2.1));

    const open: OpenJob[] = [];
    await waitUntil('both runs launched a job and said which session they wait on', () => {
      open.length = 0;
      for (const run of first.ctx.hima.ledger.runs()) {
        const launched = jobRecords(first, run.id).find((r) => r.event === 'launched');
        if (!launched) continue;
        const session = launched.job.session;
        if (!nodeRecords(first, run.id).some((r) => r.state === 'running' && r.jobSession === session)) continue;
        open.push({ runId: run.id, session, workspace: launched.job.workspace });
      }
      return open.length === 2;
    });
    // `runs()` is oldest first, which is the order the reconciliation will take them in: the first is
    // the one it carries on, the second the one a person cancels while it is busy doing so.
    const [carried, ended] = open as [OpenJob, OpenJob];
    for (const job of open) after.remember(job.session);
    await after.drop(first);
    await Promise.all([one, two]);
    assert.ok(tmuxHasSession(carried.session) && tmuxHasSession(ended.session), 'both jobs outlived the host that launched them');

    const second = await after.boot();
    // The reconciliation is not awaited by the boot, and this is how the test knows it has reached
    // the first Run and not yet the second: the record it writes of what it found.
    await waitUntil('the reconciliation is carrying the first run on', () =>
      nodeRecords(second, carried.runId).some((r) => r.state === 'reconciled'));

    const cancelled = await himaCommand(second, h.workspace, `/hima cancel ${ended.runId}`, siteCommandTimeoutMs);
    for (const line of cancelled.text.split('\n')) t.diagnostic(line);
    assert.equal(cancelled.kind, 'success', cancelled.text);
    assert.ok(!tmuxHasSession(ended.session), 'the job the person stopped is gone from the site');
    const askedAt = cancelRecords(second, ended.runId).at(-1)!.seq;

    const reconciled = await second.ctx.hima.reconciled;
    for (const outcome of reconciled) t.diagnostic(`${outcome.runId}: ${outcome.found} — ${outcome.detail}`);
    assert.equal(runOf(second, carried.runId).status, 'ended-budget-exhausted', 'the run the reconciliation carried on reached the end of its graph');

    const run = runOf(second, ended.runId);
    assert.equal(run.status, 'cancelled', `the run a person ended still says a person ended it: ${JSON.stringify(run)}`);
    assert.equal(run.meters?.endedBy, 'cancel');
    const nodes = nodeRecords(second, ended.runId);
    assert.equal(nodes.at(-1)!.state, 'cancelled', `and its node still stands where the cancel left it: ${JSON.stringify(nodes.map((r) => r.state))}`);
    assert.deepEqual(
      nodes.filter((r) => r.seq > askedAt && (r.state === 'blocked' || r.state === 'reconciled')).map((r) => [r.state, r.reason]),
      [],
      'the reconciliation wrote nothing on top of an ending it started before it could see',
    );
    const outcome = reconciled.find((r) => r.runId === ended.runId);
    assert.equal(outcome?.found, 'stopped-elsewhere', `and reported the run as one it left alone: ${JSON.stringify(reconciled)}`);
  } finally {
    await after.done();
  }
});

test('/hima cancel stops the sleeping job on the site, records the request and the observed stop, and ends the run cancelled', async (t) => {
  const local = await localHome(t, { sleepSeconds: 20 });
  if (!local) return;
  const { h } = local;
  const after = cleanup(h);
  try {
    const host = await after.boot();
    const pending = startRunInBackground(host, h, runLine());
    const job = await launchedJobOf(host);
    after.remember(job.session);
    const { runId, session } = job;

    const cancelled = await himaCommand(host, h.workspace, `/hima cancel ${runId}`, siteCommandTimeoutMs);
    for (const line of cancelled.text.split('\n')) t.diagnostic(line);
    assert.equal(cancelled.kind, 'success', cancelled.text);
    assert.equal(cancelled.runId, runId, `the answer names the run it stopped: ${cancelled.text}`);
    assert.match(cancelled.text, new RegExp(session), `and the session it stopped: ${cancelled.text}`);
    await pending;

    assert.ok(!tmuxHasSession(session), 'tmux itself says nothing is left running');
    assert.deepEqual(jobRecords(host, runId).map((r) => r.event), ['launched', 'killed'], 'the stop was observed, then recorded');
    assert.deepEqual(
      nodeRecords(host, runId).map((r) => [r.nodeId, r.state]),
      [['synthesize', 'running'], ['synthesize', 'cancelled']],
      'the node the run stood at is cancelled, and nothing beyond it ran',
    );
    assert.equal(nodeRecords(host, runId).at(-1)!.jobSession, session, 'naming the session that was stopped');

    // The request and the observed stop are two records, and the request comes first: a Run is not
    // cancelled until something saw it stop.
    const asked = cancelRecords(host, runId);
    assert.equal(asked.length, 1, 'one cancel request');
    assert.equal(asked[0]!.jobSession, session);
    assert.equal(asked[0]!.nodeId, 'synthesize');
    const killed = jobRecords(host, runId).find((r) => r.event === 'killed')!;
    assert.ok(asked[0]!.seq < killed.seq, 'the request was recorded before the stop it asked for');

    const run = runOf(host, runId);
    assert.equal(run.status, 'cancelled');
    assert.equal(run.meters?.endedBy, 'cancel', 'the run says what ended it');

    const status = await himaCommand(host, h.workspace, `/hima status ${runId}`);
    for (const line of status.text.split('\n')) t.diagnostic(line);
    assert.match(status.text, /cancelled/, status.text);
    // What the ledger holds, the face shows: the request a person made, beside the stop that was
    // observed for it. Without this line the two-record property is readable only through `/records`.
    assert.match(status.text, new RegExp(`cancel: asked .*session ${session}`), `the request is on the face too: ${status.text}`);
    assert.ok(status.text.includes(`stopped, recorded as ${killed.id}`), `beside the stop it asked for: ${status.text}`);
  } finally {
    await after.done();
  }
});

test('a run cancelled while /hima resume is still waiting on the job it launched is that command\'s success, not its error', async (t) => {
  // A shape only both tickets together can make: `cancelled` was unreachable from a drive before the
  // cancel existed, and a resume that drives a Job at all is the Retry allowance's. A person clears a
  // blocked Run and then, while `/hima resume` is still waiting on the fresh Job, stops it from
  // another face. That cancel did exactly what it was asked, so the command carrying the Run answers
  // the way `/hima run` answers the same event — one harness telling one event one way.
  const local = await localHome(t, { sleepSeconds: 20 });
  if (!local) return;
  const { h } = local;
  const after = cleanup(h);
  try {
    // The cheapest waiting Run this suite can make, and the shape of the gone-job test above: an
    // allowance of one, and a Job that vanishes while no host is watching.
    const first = await after.boot();
    const pending = startRunInBackground(first, h, runLine(2.0, 1));
    const job = await launchedJobOf(first);
    after.remember(job.session);
    await after.drop(first);
    await pending;
    const { runId, session } = job;
    killSession(session);
    await rm(path.join(job.workspace, `${session}.exit`), { force: true });
    await waitUntil('the job vanished', () => !tmuxHasSession(session));

    const second = await after.boot();
    await second.ctx.hima.reconciled;
    assert.equal(runOf(second, runId).status, 'waiting', 'the run waits for a person, which is what makes it resumable');

    // The resume re-enters the blocked node with a fresh allowance and launches a Job that sleeps for
    // twenty seconds; the cancel below lands inside that sleep, with this command still waiting.
    const resuming = himaCommand(second, h.workspace, `/hima resume ${runId}`, siteCommandTimeoutMs);
    let resumed: string | undefined;
    await waitUntil('the resume launched a fresh job and said which session it waits on', () => {
      resumed = nodeRecords(second, runId).find((r) => r.state === 'running' && r.jobSession !== undefined && r.jobSession !== session)?.jobSession;
      return resumed !== undefined;
    });
    after.remember(resumed!);

    const cancelled = await himaCommand(second, h.workspace, `/hima cancel ${runId}`, siteCommandTimeoutMs);
    for (const line of cancelled.text.split('\n')) t.diagnostic(line);
    assert.equal(cancelled.kind, 'success', cancelled.text);
    assert.ok(!tmuxHasSession(resumed!), 'the job the resume launched is gone from the site');

    const answer = await resuming;
    for (const line of answer.text.split('\n')) t.diagnostic(line);
    assert.equal(runOf(second, runId).status, 'cancelled', 'the run ended the way the person asked');
    assert.equal(answer.kind, 'success', `and the resume that was waiting on it says so too, rather than calling a cancel an error: ${answer.text}`);
    assert.match(answer.text, /cancelled/, `answering with the run as /hima status shows it: ${answer.text}`);
    assert.equal(resumedRecords(second, runId).length, 1, 'and one person\'s action is on record, written before the run moved');
  } finally {
    await after.done();
  }
});

test('the hima_cancel tool stops the same job the command face does, and answers with what it stopped', async (t) => {
  const local = await localHome(t, { sleepSeconds: 20 });
  if (!local) return;
  const { h } = local;
  const after = cleanup(h);
  try {
    const host = await after.boot();
    assert.ok(host.ctx.tools.schemas().some((s) => s.name === 'hima_cancel'), 'the tool is registered');
    const pending = startRunInBackground(host, h, runLine());
    const job = await launchedJobOf(host);
    after.remember(job.session);
    const { runId, session } = job;

    const agent = await createRootAgent(host.ctx, h.workspace);
    const result = await host.ctx.tools.execute({
      callId: 'call-hima-cancel' as never,
      name: 'hima_cancel',
      arguments: { run: runId },
      agent,
      signal: AbortSignal.timeout(siteCommandTimeoutMs),
    });
    assert.equal(result.isError, false, JSON.stringify(result));
    const value = (result as unknown as { value?: { kind: string; runId?: string; status?: string; stoppedSession?: string } }).value!;
    assert.deepEqual(
      { kind: value.kind, runId: value.runId, status: value.status, stoppedSession: value.stoppedSession },
      { kind: 'cancelled', runId, status: 'cancelled', stoppedSession: session },
      `the tool answers with what it stopped: ${JSON.stringify(value)}`,
    );
    await pending;

    assert.ok(!tmuxHasSession(session), 'nothing is left running');
    assert.deepEqual(jobRecords(host, runId).map((r) => r.event), ['launched', 'killed']);
    assert.equal(nodeRecords(host, runId).at(-1)!.state, 'cancelled');
    assert.equal(runOf(host, runId).status, 'cancelled');
  } finally {
    await after.done();
  }
});

test('a cancel that arrives while the job is still being launched leaves nothing of the run running on the site', async (t) => {
  const local = await localHome(t, { sleepSeconds: 20 });
  if (!local) return;
  const { h } = local;
  const after = cleanup(h);
  try {
    const host = await after.boot();
    // The agent is made before the run starts. Creating one costs milliseconds, which is nothing next
    // to a Site — and everything to this test, whose whole subject is the millisecond in which a
    // cancel and a launch cross.
    const agent = await createRootAgent(host.ctx, h.workspace);
    const pending = startRunInBackground(host, h, runLine());

    // The run row appears the moment HimaFabric opens the Run — before the campaign workspace is
    // prepared, and long before anything is launched on the Site. From that instant the test asks to
    // cancel, again and again, as fast as the event loop turns: a Run with no fabric state answers
    // "never started", so the first answer that is not that one is a cancel issued in the same
    // milliseconds as the launch of the Run's first Job. That is the window this test is about —
    // the cancel reads the ledger, finds no job open because no `launched` record exists yet, and
    // the launch it did not see completes a moment later.
    const runId = await raceUntil('himafabric opened a run', () => host.ctx.hima.ledger.runs().find((r) => r.packId !== undefined)?.id);
    let answer: CommandOutcome | undefined;
    let asked = 0;
    const deadline = Date.now() + waitTimeoutMs;
    while (Date.now() < deadline) {
      asked += 1;
      const tried = await himaCommand(host, h.workspace, `/hima cancel ${runId}`, siteCommandTimeoutMs, agent);
      if (!/never started it/.test(tried.text)) { answer = tried; break; }
      await new Promise((r) => setImmediate(r));
    }
    assert.ok(answer, `the run gained a fabric state to cancel (asked ${asked} times; run ${JSON.stringify(runOf(host, runId))})`);
    t.diagnostic(`the cancel was asked ${asked} time(s) before the run had a fabric state to cancel`);
    for (const line of answer.text.split('\n')) t.diagnostic(line);
    await pending;
    for (const r of jobRecords(host, runId)) after.remember(r.job.session);

    const run = runOf(host, runId);
    assert.equal(run.status, 'cancelled', `the run a person cancelled ends cancelled: ${answer.text}`);
    assert.equal(run.meters?.endedBy, 'cancel');

    // The property this ticket exists to hold, and the one the race breaks: a Run that says it was
    // cancelled has nothing of its own left on the Site. Every Job it launched — including one
    // launched in the window the cancel could not see — has a record saying what became of it, and
    // tmux itself is asked whether any of them is still there.
    const jobs = jobRecords(host, runId);
    const launched = jobs.filter((r) => r.event === 'launched');
    assert.ok(launched.length <= 1, `at most one launch, whatever the race did: ${JSON.stringify(jobs.map((r) => r.event))}`);
    for (const one of launched) {
      const session = one.job.session;
      const settled = jobs.filter((r) => r.job.session === session && (r.event === 'killed' || r.event === 'finished'));
      assert.equal(settled.length, 1, `job ${session} was launched and exactly one record says what became of it: ${JSON.stringify(jobs.map((r) => r.event))}`);
      assert.ok(!tmuxHasSession(session), `tmux itself says session ${session} of a cancelled run is gone`);
    }
    const nodes = nodeRecords(host, runId);
    assert.equal(nodes.at(-1)!.state, 'cancelled', `the node the run stood at ends cancelled: ${JSON.stringify(nodes.map((r) => [r.nodeId, r.state]))}`);

    // Three outcomes reach the assertions above and only one of them is the window this test exists
    // for: the race won, the race lost (the ordinary cancel path, which other tests already hold),
    // and a cancel that landed before anything was launched at all. They are told apart by the two
    // facts the crossed launch leaves — the face answered that no job of the Run was open, and a
    // `launched` record exists all the same — and the shape is asserted only when it was produced.
    // A guard that goes red because a race nobody controls went the other way is a guard someone
    // deletes; a run that proved less says so instead, in a line a person reads in the output.
    const wonTheRace = /no job of this run was open when the request was read/.test(answer.text) && launched.length === 1;
    if (wonTheRace) {
      const crossed = launched[0]!.job.session;
      const shape = JSON.stringify(nodes.map((r) => [r.state, r.jobSession ?? null, r.seq]));
      const byTheFace = nodes.find((r) => r.state === 'cancelled' && r.jobSession === undefined);
      assert.ok(byTheFace, `the cancel face ended the run at a node it had no session to name: ${shape}`);
      const byTheLoop = nodes.find((r) => r.state === 'cancelled' && r.jobSession === crossed);
      assert.ok(byTheLoop, `and the loop that made the launch the face could not see cancelled ${crossed} itself: ${shape}`);
      assert.ok(byTheLoop.seq > byTheFace.seq, `the loop's record comes after the face's, because it is the one cleaning up after it: ${shape}`);
    } else {
      t.diagnostic(`the window was not hit on this run: ${launched.length} launch(es), answered "${answer.text.split('\n')[0]}" — this run proved the ordinary cancel path, not the crossed one`);
    }

    const status = await himaCommand(host, h.workspace, `/hima status ${runId}`, siteCommandTimeoutMs, agent);
    for (const line of status.text.split('\n')) t.diagnostic(line);
    assert.match(status.text, /cancelled/, status.text);
  } finally {
    await after.done();
  }
});

test('cancelling a run whose job the ledger has already settled writes one blocker, not a second, and the node ends cancelled', async (t) => {
  const local = await localHome(t, { sleepSeconds: 20 });
  if (!local) return;
  const { h } = local;
  const after = cleanup(h);
  try {
    // The state the gone-job test leaves behind: a launch nothing will ever hear from again, a node
    // blocked because of it, and a Run waiting for a person. The launch has no `killed` or `finished`
    // record and never will — a Job that vanished wrote no exit status, and none is invented for it.
    // An allowance of one is what makes that first failed attempt the last one.
    const first = await after.boot();
    const pending = startRunInBackground(first, h, runLine(2.0, 1));
    const job = await launchedJobOf(first);
    after.remember(job.session);
    await after.drop(first);
    await pending;
    const { runId, session } = job;
    killSession(session);
    await rm(path.join(job.workspace, `${session}.exit`), { force: true });
    await waitUntil('the job vanished', () => !tmuxHasSession(session));

    const second = await after.boot();
    await second.ctx.hima.reconciled;
    assert.equal(runOf(second, runId).status, 'waiting', 'the gone job left the run waiting for a person');
    const blockersOn = (): NodeRecord[] => nodeRecords(second, runId).filter((r) => r.state === 'blocked' && r.jobSession === session);
    assert.equal(blockersOn().length, 1, 'and one blocked record naming that job says why');

    // A person looks at that blocker and decides against resuming it. The Run has nothing open — the
    // node it stands at accounted for that launch when it blocked on it, *and* the Site agrees the
    // session is gone. Both halves are required, and the audit is where the second one is visible:
    // a node record is the Run's own account of a Job, and a Run can be wrong about a Job it asked to
    // stop and could not, so the Site is asked before the cancel answers.
    clearRemoteCommands();
    const cancelled = await himaCommand(second, h.workspace, `/hima cancel ${runId}`, siteCommandTimeoutMs);
    for (const line of cancelled.text.split('\n')) t.diagnostic(line);
    assert.equal(cancelled.kind, 'success', cancelled.text);
    assert.ok(
      askedAboutSession(session),
      `the cancel asked the site whether ${session} was still there before it answered: ${JSON.stringify(remoteCommands().map((c) => c.argv))}`,
    );
    assert.match(cancelled.text, /no job of this run was open when the request was read/, `the run had nothing left to stop: ${cancelled.text}`);

    const nodes = nodeRecords(second, runId);
    assert.equal(blockersOn().length, 1, `still one blocker, not a second on top of it: ${JSON.stringify(nodes.map((r) => [r.nodeId, r.state]))}`);
    assert.equal(nodes.at(-1)!.state, 'cancelled', `the node the run stood at ends cancelled: ${JSON.stringify(nodes.map((r) => r.state))}`);
    const asked = cancelRecords(second, runId);
    assert.equal(asked.length, 1, 'one cancel request');
    assert.equal(asked[0]!.jobSession, undefined, 'naming no job, because the run had none open to name');
    assert.deepEqual(jobRecords(second, runId).map((r) => r.event), ['launched'], 'and nothing new was recorded of a job the run had already accounted for');
    assert.equal(runOf(second, runId).status, 'cancelled');
  } finally {
    await after.done();
  }
});

test('a launch the run has accounted for but the site still has is stopped by the cancel, not written off', async (t) => {
  const local = await localHome(t, { sleepSeconds: 20 });
  if (!local) return;
  const { h } = local;
  const after = cleanup(h);
  try {
    // The same shape as the test above — a node blocked naming a session, a Run waiting — with the
    // one difference that decides everything: the Site still has that session. This is what a kill
    // that did not take leaves behind, and there are three ways into it (a cancel's kill, a time
    // box's kill, and this one). A Run that reads its own blocked node as the end of the story would
    // answer a person's second `/hima cancel` with "nothing to stop" while dc_shell still holds the
    // licence, and, final at `cancelled`, would never be looked at again by any reconciliation.
    const first = await after.boot();
    const pending = startRunInBackground(first, h, runLine(2.0, 1));
    const job = await launchedJobOf(first);
    after.remember(job.session);
    await after.drop(first);
    await pending;
    const { runId, session } = job;
    killSession(session);
    await rm(path.join(job.workspace, `${session}.exit`), { force: true });
    await waitUntil('the job vanished', () => !tmuxHasSession(session));

    const second = await after.boot();
    await second.ctx.hima.reconciled;
    // The Run wrote that launch off on the node whose attempt it was, and then — its allowance spent
    // — was routed to the pack's wait node, which is where it now stands. The launch it wrote off is
    // behind it, and is still the fabric's to stop.
    const accounted = nodeRecords(second, runId).findLast((r) => r.jobSession === session)!;
    assert.equal(accounted.state, 'blocked', 'the run has accounted for that launch on its node');
    assert.equal(accounted.nodeId, 'synthesize', 'the node whose attempt it was');
    assert.equal(runOf(second, runId).status, 'waiting', 'and the run waits for a person');

    // And the Site has that session after all. The seam cannot make tmux ignore a kill, so the test
    // puts the session back rather than asserting on a state it cannot produce; what the code under
    // test reads is the Site's answer, which is the same either way.
    startSession(session, 120);
    assert.ok(tmuxHasSession(session), 'the session the run wrote off is on the site');

    clearRemoteCommands();
    const cancelled = await himaCommand(second, h.workspace, `/hima cancel ${runId}`, siteCommandTimeoutMs);
    for (const line of cancelled.text.split('\n')) t.diagnostic(line);
    assert.equal(cancelled.kind, 'success', cancelled.text);
    assert.ok(askedAboutSession(session), `the cancel asked the site about ${session}: ${JSON.stringify(remoteCommands().map((c) => c.argv))}`);
    assert.match(cancelled.text, new RegExp(session), `and stopped it rather than writing it off: ${cancelled.text}`);

    assert.ok(!tmuxHasSession(session), 'tmux itself says the job a person asked to stop is stopped');
    assert.deepEqual(jobRecords(second, runId).map((r) => r.event), ['launched', 'killed'], 'the stop was observed, then recorded');
    const asked = cancelRecords(second, runId);
    assert.equal(asked.length, 1, 'one cancel request');
    assert.equal(asked[0]!.jobSession, session, 'naming the job it found open, because the site said it was');
    const nodes = nodeRecords(second, runId);
    assert.equal(nodes.at(-1)!.state, 'cancelled', `the node ends cancelled: ${JSON.stringify(nodes.map((r) => [r.nodeId, r.state]))}`);
    assert.equal(nodes.at(-1)!.nodeId, 'synthesize', 'the node whose job was stopped, not the wait node the run was standing at');
    assert.equal(nodes.at(-1)!.jobSession, session);
    const run = runOf(second, runId);
    assert.equal(run.status, 'cancelled');
    assert.equal(run.meters?.endedBy, 'cancel');
  } finally {
    await after.done();
  }
});

test('cancelling a run that already ended answers with its status and writes nothing', async (t) => {
  const local = await localHome(t, { sleepSeconds: 3 });
  if (!local) return;
  const { h } = local;
  const after = cleanup(h);
  try {
    const host = await after.boot();
    const started = await himaCommand(host, h.workspace, runLine(), siteCommandTimeoutMs);
    assert.equal(started.kind, 'success', started.text);
    const runId = started.runId!;
    for (const r of jobRecords(host, runId)) after.remember(r.job.session);
    assert.equal(runOf(host, runId).status, 'ended-budget-exhausted');
    const before = recordsOf(host, runId);

    const cancelled = await himaCommand(host, h.workspace, `/hima cancel ${runId}`, siteCommandTimeoutMs);
    for (const line of cancelled.text.split('\n')) t.diagnostic(line);
    assert.equal(cancelled.kind, 'success', `cancelling an ended run is a clear answer, not an error: ${cancelled.text}`);
    assert.match(cancelled.text, /already ended/, cancelled.text);
    assert.match(cancelled.text, /ended-budget-exhausted/, `and says how it ended: ${cancelled.text}`);

    assert.deepEqual(recordsOf(host, runId), before, 'nothing was written: there was nothing to stop');
    assert.equal(runOf(host, runId).status, 'ended-budget-exhausted', 'and the run still says how it ended');

    const unknown = await himaCommand(host, h.workspace, '/hima cancel run-no-such-run');
    assert.equal(unknown.kind, 'error', unknown.text);
    assert.match(unknown.text, /unknown run/, unknown.text);
  } finally {
    await after.done();
  }
});

test('POST /hima/api/runs/<id>/cancel stops a job a new host picked up, behind the session fence, and answers with the cancelled run', async (t) => {
  // Forty seconds of stand-in synthesis: the Job outlives the host that launched it, the web host
  // that boots next, and the reconciliation that picks it up — so what stops it is the route.
  const local = await localHome(t, { sleepSeconds: 40 });
  if (!local) return;
  const { h } = local;
  const after = cleanup(h);
  try {
    const first = await after.boot();
    const pending = startRunInBackground(first, h, runLine());
    const job = await launchedJobOf(first);
    after.remember(job.session);
    await after.drop(first);
    await pending;

    const { runId, session } = job;
    const web = await after.bootWeb();
    const cookie = await openSession(web);

    // The fence first: without the session cookie the route answers a coded refusal, not a cancel.
    const fenced = await fetch(new URL(`/hima/api/runs/${runId}/cancel`, web.url), { method: 'POST' });
    assert.equal(fenced.status, 401, await fenced.text());
    assert.ok(tmuxHasSession(session), 'and nothing was stopped by the refused request');

    const answered = await api(web, cookie, `/hima/api/runs/${runId}/cancel`, { method: 'POST' });
    const text = await answered.text();
    assert.equal(answered.status, 200, text);
    const view = JSON.parse(text) as RunView;
    assert.equal(view.run.id, runId);
    assert.equal(view.run.status, 'cancelled');
    assert.equal(view.run.meters?.endedBy, 'cancel');
    assert.ok(view.jobs.some((j) => j.event === 'killed' && j.job.session === session), JSON.stringify(view.jobs));
    assert.ok(view.nodes.some((n) => n.nodeId === 'synthesize' && n.state === 'cancelled'), JSON.stringify(view.nodes));
    // Everything the browser can know about this Run comes through this view, so what the row and the
    // records hold it carries: which pack the Run runs, and the request beside the stop it asked for.
    assert.equal(view.run.packId, timingProbePackId, `the view says which pack the run runs: ${JSON.stringify(view.run)}`);
    assert.deepEqual(
      view.cancels.map((c) => [c.nodeId, c.jobSession]),
      [['synthesize', session]],
      `and carries the request a person made: ${JSON.stringify(view.cancels)}`,
    );
    assert.ok(!tmuxHasSession(session), 'and the site itself says the job is gone');

    // Cancelling it again is the clear answer, not a second stop.
    const again = await api(web, cookie, `/hima/api/runs/${runId}/cancel`, { method: 'POST' });
    const againText = await again.text();
    assert.equal(again.status, 200, againText);
    assert.deepEqual(JSON.parse(againText), view, 'the second cancel wrote nothing at all');
  } finally {
    await after.done();
  }
});

test('a fault while the campaign workspace is being prepared is recorded against the run, not lost with the run left saying nothing happened', async (t) => {
  const local = await localHome(t, { sleepSeconds: 3 });
  if (!local) return;
  const { h, flow } = local;
  const after = cleanup(h);
  // One piece of the flow the run contract copies is made unreadable, so the copy itself fails on
  // the Site. Nothing refuses it — the Permit resolves the path and allows it, and the destination is
  // inside the write root — and `cp` then exits non-zero from inside the preparation. That is the
  // shape of the fault this boundary is for (the ssh channel dropping in the middle of 56 MB), and it
  // is the one such fault the local site can be made to produce on demand.
  const unreadable = path.join(flow.root, 'build', flow.design);
  await chmod(unreadable, 0o000);
  try {
    const host = await after.boot();
    const started = await himaCommand(host, h.workspace, runLine(), siteCommandTimeoutMs);
    for (const line of started.text.split('\n')) t.diagnostic(line);
    assert.equal(started.kind, 'error', started.text);
    const runId = started.runId!;
    assert.ok(runId, `the answer names the run the fault stopped: ${started.text}`);
    assert.match(started.text, /stopped before its first node/, `and says where it stopped: ${started.text}`);

    const run = runOf(host, runId);
    assert.equal(run.status, 'waiting', 'a run nothing is advancing does not sit there with no fabric state at all');
    assert.equal(run.currentNode, 'synthesize', 'it stands at the node it never got to attempt');
    assert.equal(run.packId, timingProbePackId, 'and the row says which pack it was for');
    assert.deepEqual(
      nodeRecords(host, runId).map((r) => [r.nodeId, r.state]),
      [['synthesize', 'blocked']],
      'one record, and it says the run is blocked at its entry node',
    );
    const blocked = nodeRecords(host, runId)[0]!;
    assert.match(blocked.reason ?? '', /workspace could not be prepared/, `carrying why: ${blocked.reason}`);
    assert.match(blocked.reason ?? '', /cp exited/, `and the fault's own message: ${blocked.reason}`);
    assert.deepEqual(jobRecords(host, runId), [], 'nothing was launched');

    const status = await himaCommand(host, h.workspace, `/hima status ${runId}`);
    for (const line of status.text.split('\n')) t.diagnostic(line);
    assert.match(status.text, /synthesize \(act\): blocked, attempt 1, .*could not be prepared/, status.text);
  } finally {
    // Put the permissions back before the home is removed, or the removal cannot read the directory.
    await chmod(unreadable, 0o755).catch(() => undefined);
    await after.done();
  }
});

test('a campaign the site gives no workspace is blocked at once, in the words the refusal recorded, and the next host leaves it alone', async (t) => {
  const local = await localHome(t, { sleepSeconds: 3 });
  if (!local) return;
  const { h, flow } = local;
  const after = cleanup(h);
  try {
    // A site whose Permit allows no writes at all: the workspace is refused before anything is sent.
    // The Run is opened with its Goal, its Budget and its pack, and it will never run — which is a
    // thing to say on the record now, in the words the refusal itself used, not a thing to leave for
    // some later host to re-stamp with a reason it has to invent.
    await writeLocalSite(h, {
      allowedReadRoots: [h.workspace, flow.root],
      allowedWriteRoots: [],
      bindings: { flowRoot: flow.root, design: flow.design, workspaceRoot: h.workspace },
    });
    const first = await after.boot();
    const started = await himaCommand(first, h.workspace, runLine(), siteCommandTimeoutMs);
    for (const line of started.text.split('\n')) t.diagnostic(line);
    assert.equal(started.kind, 'error', started.text);
    const runId = started.runId!;

    const run = runOf(first, runId);
    assert.equal(run.status, 'waiting', 'the run says where it stands from the moment its caller was told');
    assert.equal(run.currentNode, 'synthesize', 'it stands at the node it never got to attempt');
    assert.equal(run.packId, timingProbePackId, 'and the row says which pack it was for');
    assert.deepEqual(
      nodeRecords(first, runId).map((r) => [r.nodeId, r.state]),
      [['synthesize', 'blocked']],
      'one record, and it says the run is blocked at its entry node',
    );
    const blocked = nodeRecords(first, runId)[0]!;
    assert.match(blocked.reason ?? '', /workspace could not be prepared/, `carrying why: ${blocked.reason}`);
    assert.match(blocked.reason ?? '', /permit refused/, `and which path the permit stopped: ${blocked.reason}`);
    assert.match(blocked.reason ?? '', /outside the permitted write roots/, `in the refusal's own words: ${blocked.reason}`);
    assert.deepEqual(jobRecords(first, runId), [], 'nothing was launched');

    const status = await himaCommand(first, h.workspace, `/hima status ${runId}`);
    for (const line of status.text.split('\n')) t.diagnostic(line);
    assert.match(status.text, /synthesize \(act\): blocked, attempt 1, .*permit refused/, status.text);

    // Nor is it a Run a person can resume. It is waiting, which is the one status `/hima resume`
    // takes, and it has no workspace to be re-entered in — the Campaign never got one, which is the
    // whole reason it is blocked. Resuming it would drive a Run with no workspace, so it is refused
    // in words, and refused before anything is written: a `resumed` record here would say a person
    // cleared a blocker that is still exactly as it was.
    const beforeResume = recordsOf(first, runId);
    const refused = await himaCommand(first, h.workspace, `/hima resume ${runId}`, siteCommandTimeoutMs);
    for (const line of refused.text.split('\n')) t.diagnostic(line);
    assert.equal(refused.kind, 'error', refused.text);
    assert.match(refused.text, /has no workspace record/, `naming what it has not got: ${refused.text}`);
    assert.match(refused.text, /nothing was written/, `and saying nothing was written: ${refused.text}`);
    assert.deepEqual(recordsOf(first, runId), beforeResume, 'and nothing was');
    assert.equal(runOf(first, runId).status, 'waiting', 'the run is where the refusal left it');

    // And the next host has nothing to do with it: a Run already blocked and waiting is a person's,
    // not a reconciliation's, so nothing is written over what the refusal already said.
    const before = recordsOf(first, runId);
    await after.drop(first);
    const second = await after.boot();
    assert.deepEqual(await second.ctx.hima.reconciled, [], 'the next host finds nothing left in flight');
    assert.deepEqual(recordsOf(second, runId), before, 'and wrote nothing on top of the refusal');
    assert.equal(runOf(second, runId).status, 'waiting');
  } finally {
    await after.done();
  }
});

test('a run left with no fabric state at all is still picked up by the next host, not left looking like a run no fabric ever touched', async (t) => {
  const local = await localHome(t, { sleepSeconds: 3 });
  if (!local) return;
  const { h } = local;
  const after = cleanup(h);
  try {
    const first = await after.boot();
    // The shape a host killed inside `prepareWorkspace` leaves behind: the run row is there with its
    // Goal, its Budget and its pack, and it never got a fabric state, because the process that would
    // have written one went away. It is staged on the ledger through the booted host rather than
    // driven into being, because nothing the local Site can be made to do leaves that shape any more
    // — a preparation that answers is now blocked at entry there and then, and one that throws is
    // recorded by `startRun` itself. What is asserted is still all the host's own: what the next boot
    // makes of the row, and what `/hima status` says about it afterwards.
    const opened = await first.ctx.hima.ledger.createRun({
      campaignId: 'opene902-timing-probe-interrupted',
      siteId: 'local',
      packId: timingProbePackId,
      goal: { target_period_ns: 2 },
      // Both of the Site's declared scarcities, as `startRun` copies them: the local site declares
      // one job slot and one Design Compiler seat, which is what the shipped pack's synth tool holds.
      // The generation limit is the shipped pack's own, which `startRun` copies beside them.
      budget: { timeBoxMs: 60 * 60_000, retryAllowance: 3, jobCap: 1, licences: { 'Design-Compiler': 1 }, generationLimit: 6 },
    });
    assert.equal(runOf(first, opened.id).status, undefined, 'HimaFabric never started it, and the ledger says so by omission');
    await after.drop(first);

    const second = await after.boot();
    const reconciled = await second.ctx.hima.reconciled;
    assert.deepEqual(reconciled.map((r) => [r.runId, r.found]), [[opened.id, 'never-started']], JSON.stringify(reconciled));

    assert.deepEqual(
      nodeRecords(second, opened.id).map((r) => [r.nodeId, r.state]),
      [['synthesize', 'blocked']],
      'the run is reported as blocked where it would have started',
    );
    assert.match(nodeRecords(second, opened.id)[0]!.reason ?? '', /never started it/, nodeRecords(second, opened.id)[0]!.reason);
    assert.equal(runOf(second, opened.id).status, 'waiting', 'and it waits for a person rather than staying unexplained');
    assert.deepEqual(jobRecords(second, opened.id), [], 'nothing was launched, then or now');

    const status = await himaCommand(second, h.workspace, `/hima status ${opened.id}`);
    for (const line of status.text.split('\n')) t.diagnostic(line);
    assert.match(status.text, /synthesize \(act\): blocked/, status.text);
  } finally {
    await after.done();
  }
});

// ---------------------------------------------------------------------------------------------
// Ticket #61: a reader's Job outlives its host too, and what reads it back is what its launch said
// ---------------------------------------------------------------------------------------------

/** The reader Job of a Run, once its launch and the node record that waits on it are both written.
 *  Not `launchedJobOf`, which answers with the first Job a Run launched: here that is the mining
 *  stage, and the Job this suite takes a host away from is the one after it. */
async function readerJobOf(host: InProcessHost, timeoutMs = waitTimeoutMs): Promise<OpenJob> {
  let found: OpenJob | undefined;
  await waitUntil('the reader job was launched and its node record written', () => {
    for (const run of host.ctx.hima.ledger.runs()) {
      const launched = jobRecords(host, run.id).find((r) => r.event === 'launched' && r.job.name === `reader-${packReaderId}`);
      if (!launched) continue;
      if (!nodeRecords(host, run.id).some((r) => r.state === 'running' && r.jobSession === launched.job.session)) continue;
      found = { runId: run.id, session: launched.job.session, workspace: launched.job.workspace };
      return true;
    }
    return false;
  }, timeoutMs);
  return found!;
}

test('a reader job picked up after a restart is read back from what its own launch recorded, and neither the script nor the declaration is resolved again from a pack folder that has changed since', async (t) => {
  const local = await localHome(t, { sleepSeconds: 0 });
  if (!local) return;
  const { h } = local;
  const after = cleanup(h);
  const packsDir = packsDirOf(h);
  try {
    // A reader that takes its time, so the host can be taken away while its Job is demonstrably
    // still on the Site — the stand-in of a reader that has a real report to walk.
    const slow = packReaderScript.replace('set -eu\n', 'set -eu\nsleep 20\n');
    const pack = await installPackReader(packsDir, 'restarted-reader', { script: slow });
    const first = await after.boot();
    const pending = startRunInBackground(first, h, `/hima run ${pack} --site local --goal target_period_ns=2.0 --set periodNs=2.0 ${ONE_GENERATION}`);
    const job = await readerJobOf(first);
    after.remember(job.session);
    assert.ok(tmuxHasSession(job.session), 'the reader job is running on the site');

    // What the launch wrote down, whole: not only the reader, but the file the script was told to
    // write and the report as it stood when it was read. Both are read here, off the record, and
    // held against the workspace — the record is what the next host will settle from, so a record
    // that named the wrong file or hashed the wrong bytes would be a reading about nothing.
    const launched = jobRecords(first, job.runId).findLast((r) => r.event === 'launched' && r.job.session === job.session);
    assert.ok(launched?.reading, `the launch recorded what its reader was launched to read: ${JSON.stringify(launched)}`);
    const { out, report } = launched.reading;
    assert.equal(
      out,
      path.join(job.workspace, 'hima-readers', packReaderId, 'read-candidates-g1-a1.json'),
      'the record says where this attempt of this node was told to write, and names all three',
    );
    const asItStood = await readFile(report.path);
    assert.equal(createHash('sha256').update(asItStood).digest('hex'), report.contentSha256, 'and the report as it stood, by the hash of its bytes');
    assert.equal(report.bytes, asItStood.byteLength, 'and by how many there were');

    await after.drop(first);
    await pending;
    assert.ok(tmuxHasSession(job.session), 'and it is still running: a host going away does not stop a reader either');

    // The pack folder changes while the Run is between hosts, which is the whole point: a pack is
    // plain files a person edits, and the person who edits them is not told which Runs are in
    // flight. The script gets new bytes; the declaration promises a second value type.
    await writeFile(path.join(packsDir, pack, packReaderFile), `${slow}# edited while the run was between hosts\n`);
    await writeFile(
      path.join(packsDir, pack, 'readers', `${packReaderId}.yml`),
      `id: ${packReaderId}\nversion: '2'\nfile: ${packReaderFile}\nargv: [sh, '\${READER}', '\${REPORT}', '\${OUT}']\nreportKind: standin-candidates\nemits: [${candidateCountType}, cell_area]\n`,
    );
    // And the report itself, which the flow could as easily have rewritten: more bytes, and the same
    // count, so that what the reader emits is unchanged and the only thing that can differ is the
    // provenance the observation carries.
    await writeFile(report.path, `${asItStood.toString('utf8')}\n{ "note": "rewritten while the run was between hosts" }\n`);
    const asItIsNow = await readFile(report.path);
    assert.notEqual(createHash('sha256').update(asItIsNow).digest('hex'), report.contentSha256, 'the report on disk is not the report that was read');

    const second = await after.boot();
    const reconciled = await second.ctx.hima.reconciled;
    assert.deepEqual(reconciled.map((r) => [r.runId, r.found]), [[job.runId, 'running']], JSON.stringify(reconciled));
    const { runId } = job;
    await waitUntil('the run reached an ending', () => runOf(second, runId).status?.startsWith('ended') === true, 120_000);

    // One observation, and it is the launch's: the hash of the bytes that were actually shipped and
    // run, the version and the emitted set the declaration held when the Job was launched. A read
    // back off the pack folder as it stands would have hashed bytes no Job ever ran, and would have
    // refused the reading for missing a value type the script it launched never promised.
    const observations = recordsOf(second, runId).filter((r) => r.type === 'observation');
    assert.equal(observations.length, 1, `the reading was taken once: ${JSON.stringify(observations)}`);
    const reading = observations[0]!;
    assert.equal(reading.type === 'observation' ? reading.reader.sha256 : '', createHash('sha256').update(slow).digest('hex'), 'the hash is of the bytes the job ran');
    assert.equal(reading.type === 'observation' ? reading.reader.version : '', '1', 'at the version the declaration held when it was launched');
    assert.deepEqual(reading.type === 'observation' ? reading.reader.emits : [], [candidateCountType, candidateSlackType], 'promising what it promised then');
    assert.deepEqual(
      reading.type === 'observation' ? reading.values : [],
      [
        { type: candidateCountType, unit: 'count', value: MINED_TOP_N },
        { type: candidateSlackType, unit: 'ns', value: MINED_SLACK_NS, mode: MINED_SLACK_MODE, scope: MINED_SLACK_SCOPE },
      ],
      'and carrying what the script wrote',
    );
    // The provenance is the launch's too, and this is where that matters most: the report on disk is
    // no longer the report this reading is of, and an observation that hashed it now would say this
    // number came out of bytes nobody read it from.
    assert.deepEqual(
      reading.type === 'observation' ? { path: reading.path, contentSha256: reading.contentSha256, bytes: reading.bytes } : {},
      report,
      'the observation carries the report as it stood when the reader was launched, by path, hash and byte count',
    );
    assert.notEqual(
      reading.type === 'observation' ? reading.bytes : 0,
      asItIsNow.byteLength,
      'and not as it stands now, which is what says it was not re-read',
    );
    assert.ok(existsSync(out), `and the script wrote where the record says it was told to: ${out}`);
    assert.equal(
      nodeRecords(second, runId).findLast((r) => r.nodeId === 'read-candidates')?.state,
      'done',
      'the observing node settled on its reading, not on an exit code',
    );
    assert.deepEqual(jobRecords(second, runId).filter((r) => r.event === 'launched').map((r) => r.job.name), ['mine', `reader-${packReaderId}`], 'nothing was launched twice');
  } finally {
    await after.done();
  }
});

test('an observe node whose job was launched by something that recorded no reading is blocked naming that launch record, and only after the job it is watching has ended', async (t) => {
  // The one case `resumeNode` has left once a `launched` record decides the branch: an observe
  // node\'s Job whose launch record says nothing about a reader. Such a node launches a Job for one
  // reason — to run a reader script — so a record that does not say what was launched to be read is
  // a fault and never a tool\'s Job: settling it from an exit code would advance the Run with no
  // observation in it and have the judge that follows rule on the generation before it.
  //
  // The shape is staged on the ledger through the booted host rather than driven into being, because
  // nothing this harness does produces it any more — the launch and the record are one step. What is
  // asserted is all the next host\'s own: which record it names, that it never settles the node
  // `done`, and that it watched the Job it found to its end before saying anything at all.
  const local = await localHome(t, { sleepSeconds: 0 });
  if (!local) return;
  const { h } = local;
  const after = cleanup(h);
  try {
    const slow = packReaderScript.replace('set -eu\n', 'set -eu\nsleep 10\n');
    const pack = await installPackReader(packsDirOf(h), 'reader-without-a-record', { script: slow });
    const first = await after.boot();
    const pending = startRunInBackground(first, h, `/hima run ${pack} --site local --goal target_period_ns=2.0 --set periodNs=2.0 ${ONE_GENERATION}`);
    const job = await readerJobOf(first);
    after.remember(job.session);
    const real = jobRecords(first, job.runId).findLast((r) => r.event === 'launched' && r.job.session === job.session);
    assert.ok(real?.reading, `the real launch recorded a reading: ${JSON.stringify(real)}`);
    // A second launch record for the same session, shaped as a tool\'s: this is what the next host
    // will find, `resumeNode` reading the last launch of the session it was handed.
    const toolShaped = await first.ctx.hima.ledger.appendJob(job.runId, { event: 'launched', job: real.job, nodeId: 'read-candidates' });
    await after.drop(first);
    await pending;
    assert.ok(tmuxHasSession(job.session), 'the reader job is still running on the site');

    const second = await after.boot();
    const { runId } = job;
    await waitUntil('the observing node was settled by the next host', () => nodeRecords(second, runId).some((r) => r.state === 'blocked'), 120_000);
    // The node record and the Run's transition are separate durable writes. Observing the first
    // does not mean the continuation has finished the second yet.
    await waitUntil('the blocked Run is waiting for a person', () => runOf(second, runId).status === 'waiting');

    const blocked = nodeRecords(second, runId).findLast((r) => r.nodeId === 'read-candidates');
    assert.equal(blocked?.state, 'blocked', `the node is blocked and never done: ${JSON.stringify(nodeRecords(second, runId))}`);
    assert.ok(
      (blocked!.reason ?? '').includes(toolShaped.id),
      `and the blocker names the launch record a person can go and look at: ${blocked!.reason}`,
    );
    assert.match(blocked!.reason ?? '', /says nothing about a reader/, blocked!.reason ?? '');
    assert.deepEqual(recordsOf(second, runId).filter((r) => r.type === 'observation'), [], 'nothing was read back, and nothing was invented');

    // And it was blocked only once the Job it found had ended: a Job whose launch cannot be read
    // back is still watched to its end, because a blocker is where a Run stops for a person and not
    // a reason to walk away from something running on their Site.
    const finished = recordsOf(second, runId).find((r) => r.type === 'job' && r.event === 'finished' && r.job.session === job.session);
    assert.ok(finished, `the job's own ending is on the ledger: ${JSON.stringify(recordsOf(second, runId).map((r) => r.type))}`);
    assert.ok(blocked!.seq > finished.seq, `and the node was settled after it: blocked at ${blocked!.seq}, finished at ${finished.seq}`);
    assert.equal(runOf(second, runId).status, 'waiting', 'the run waits for a person');
  } finally {
    await after.done();
  }
});

test('a cancel that never saw a reader\'s job, appended in the gap between two polls after that job had finished, is what reads the job back: the site is asked about that job one last time, the reading is written after the cancel record, and only then is the node done', async (t) => {
  // **The branch this test binds**, and what it takes to reach it on purpose.
  //
  // `waitForJob` settles a reader Job two ways. The ordinary one: a poll sees the Job finished and
  // reads it back. And `stoppedWithJob`: the Run has stopped being this loop\'s to advance, the kill
  // this loop then sends finds the Job already over, and the reading is read back on *that* path —
  // which is what keeps a node from being called `done` with nothing observed when a cancel and a
  // Job\'s own ending cross. The two produce the same one observation and the same `done`, so a test
  // that merely waits for the Job to end and then appends a cancel cannot say which one it drove.
  //
  // Two things make it say so. **The gap**: the poll\'s cadence is asked of the audit rather than
  // guessed at — the test waits until the waiter has left its fast phase and until a look has just
  // gone out on the wire, which leaves `jobPollSlowMs` before the next one — and the Job\'s ending is
  // the test\'s to choose, because this variant\'s script waits for a file beside its own output
  // before it writes anything. So the Job finishes and the cancel is appended inside one gap, and
  // the next look finds both already true. **The kill\'s own question**: once a Job has written its
  // exit status, nothing on the poll path ever asks the Site about its session again — `jobState`
  // reads the exit file first and answers `finished` without probing tmux at all (#18). The one
  // thing that still asks is the kill this loop sends when the Run has been stopped from elsewhere.
  // So the audit is cleared the moment the Job is over, and a `tmux has-session` for it after that
  // is an effect only `stoppedWithJob` can have produced. The ledger says the same thing again in
  // its order: the Job\'s own `finished` record and the observation are both *after* the cancel.
  //
  // The cancel is the record a cancel that **crossed the launch** leaves — a request naming every
  // Job it found open, which was none, because it read this Run\'s records in the moment before the
  // launch was on them. It is written rather than raced for: the millisecond a face and a launch
  // cross is not one a test can be made to land in on demand, and the suite already has a test of
  // the losing side of that race (`a cancel that arrives while the job is still being launched`).
  const local = await localHome(t, { sleepSeconds: 0 });
  if (!local) return;
  const { h } = local;
  const after = cleanup(h);
  try {
    // A reader that reads when it is told to: it waits for a `go` file beside the output it was told
    // to write, so that the moment this Job ends is one the test chooses rather than one it watches
    // for. Nothing else about it changes — it is the fixture\'s own script, and what it writes is
    // what the fixture\'s reader always writes.
    const waits = packReaderScript.replace(
      'set -eu\n',
      'set -eu\nwhile [ ! -f "$(dirname "$2")/go" ]; do sleep 0.1; done\n',
    );
    const pack = await installPackReader(packsDirOf(h), 'cancelled-reader', { script: waits });
    const host = await after.boot();
    const pending = startRunInBackground(host, h, `/hima run ${pack} --site local --goal target_period_ns=2.0 --set periodNs=2.0 ${ONE_GENERATION}`);
    const job = await readerJobOf(host);
    after.remember(job.session);

    // The launch record says what this Job was launched to read, and where it was told to write it:
    // the `go` file goes beside that, which is also how this test never has to re-derive a path the
    // harness chose.
    const launched = jobRecords(host, job.runId).findLast((r) => r.event === 'launched' && r.job.session === job.session);
    assert.ok(launched?.reading, `the launch recorded what its reader was launched to read: ${JSON.stringify(launched)}`);
    const exitFile = path.join(job.workspace, `${job.session}.exit`);
    const go = path.join(path.dirname(launched.reading.out), 'go');

    // Wait until the waiter has left its fast phase, so the gap below is the slow interval.
    const launchedAt = Date.parse(launched.job.startedAt);
    await waitUntil(
      'the job poll left its fast phase',
      () => Date.now() - launchedAt >= jobPollFastForMs + jobPollFastMs,
      waitTimeoutMs,
      50,
    );
    // A look has just gone out, so the next one is a slow interval away. Everything until the cancel
    // is written happens inside that gap.
    clearRemoteCommands();
    await waitUntil('the poll asked the site about this job', () => askedAboutSession(job.session), waitTimeoutMs, 10);
    const gapOpened = Date.now();
    await writeFile(go, '');
    await waitUntil(
      'the reader job wrote its exit status and its session ended',
      async () => !tmuxHasSession(job.session) && (await readFile(exitFile).catch(() => Buffer.alloc(0))).byteLength > 0,
      waitTimeoutMs,
      20,
    );
    assert.deepEqual(
      jobRecords(host, job.runId).filter((r) => r.job.session === job.session).map((r) => r.event),
      ['launched'],
      'and nothing has been written about its ending: the next look has not happened yet',
    );
    // From here the Job has an exit status on the Site, so nothing that merely polls will ever ask
    // about its session again.
    clearRemoteCommands();
    await host.ctx.hima.ledger.appendCancel(job.runId, { nodeId: 'read-candidates', jobSessions: [] });
    const spent = Date.now() - gapOpened;
    assert.ok(spent < jobPollSlowMs, `the job finished and the cancel was written inside one poll interval: ${spent} ms of ${jobPollSlowMs}`);

    await pending;
    const cancelled = cancelRecords(host, job.runId);
    assert.equal(cancelled.length, 1, `the one cancel this test wrote: ${JSON.stringify(cancelled)}`);
    const cancelSeq = cancelled[0]!.seq;

    // The wire: the Site was asked whether this session was still there *after* the job had written
    // its exit status — the question a kill asks before it stops something, and one no poll can ask
    // any more, because the exit file decides before the session is ever probed.
    assert.ok(
      askedAboutSession(job.session),
      `the loop asked the site about the job it was holding before settling it, which only the cancel path does: ${JSON.stringify(remoteCommands().map((c) => c.argv.join(' ')))}`,
    );

    const records = recordsOf(host, job.runId);
    const finished = records.find((r) => r.type === 'job' && r.event === 'finished' && r.job.session === job.session);
    assert.ok(finished, `the job's ending was written: ${JSON.stringify(records.map((r) => r.type))}`);
    assert.ok(
      finished.seq > cancelSeq,
      `after the cancel, which is what says no poll ever saw this job end: finished at ${finished.seq}, cancel at ${cancelSeq}`,
    );

    const observations = records.filter((r) => r.type === 'observation');
    assert.equal(observations.length, 1, `the reading the finished job wrote was read back: ${JSON.stringify(records.map((r) => r.type))}`);
    assert.ok(
      observations[0]!.seq > cancelSeq,
      `on the cancel path and nowhere else: the observation is at ${observations[0]!.seq} and the cancel at ${cancelSeq}`,
    );
    assert.deepEqual(
      observations[0]!.type === 'observation' ? observations[0]!.values : [],
      [
        { type: candidateCountType, unit: 'count', value: MINED_TOP_N },
        { type: candidateSlackType, unit: 'ns', value: MINED_SLACK_NS, mode: MINED_SLACK_MODE, scope: MINED_SLACK_SCOPE },
      ],
      'and written down whole',
    );
    const settled = nodeRecords(host, job.runId).findLast((r) => r.nodeId === 'read-candidates');
    assert.equal(settled?.state, 'done', `and only then is the node done: ${JSON.stringify(settled)}`);
    assert.ok(settled!.seq > cancelSeq, `after the cancel too: the node settled at ${settled!.seq}`);
    assert.ok(!tmuxHasSession(job.session), 'nothing of the run is left on the site');
  } finally {
    await after.done();
  }
});
