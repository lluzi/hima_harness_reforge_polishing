// Local detached Jobs, permissions and channel plumbing. Real Site cases are in jobs.live.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHimaHome, type HimaHome } from './support/dsh-home.ts';
import { bootInProcess, type InProcessHost } from './support/boot-inprocess.ts';
import { himaCommand, localCommandTimeoutMs } from './support/command.ts';
import { writeLocalSite } from './support/site.ts';
// tmux itself, asked by the one module that owns that question for this suite.
import { tmuxHasSession } from './support/tmux.ts';
import { channelFor, clearRemoteCommands, jobPlumbing, loadSite, remoteCommands } from '@hima/harness';
import type { JobRecord, LedgerRecord } from '@hima/harness';

/** The test's own judgement of what a job-plumbing verb is, kept apart from the channel's list on
 *  purpose: the audit test holds what was actually sent against this, not against the implementation's
 *  own idea of itself. */
const jobPlumbingVerbs = new Set(['tmux', 'test', 'tail', 'cat', 'realpath']);
/** The test's own POSIX single-quoting, reimplemented independently of `channel.ts`'s `quote`. */
const posixQuote = (word: string): string => `'${word.replaceAll("'", `'\\''`)}'`;

/** The job records of a run, in sequence order. */
const jobRecords = (host: InProcessHost, runId: string): JobRecord[] =>
  host.ctx.hima.ledger.records({ runId, type: 'job' }).filter((r): r is JobRecord => r.type === 'job');

const recordsOf = (host: InProcessHost, runId: string): LedgerRecord[] => host.ctx.hima.ledger.records({ runId });

/** The session name of the one job a run launched, read from the ledger rather than scraped from
 *  the command's text: the record is what the next command is given. */
function launchedSession(host: InProcessHost, runId: string): string {
  const launched = jobRecords(host, runId).filter((r) => r.event === 'launched');
  assert.equal(launched.length, 1, `exactly one launched job record in ${runId}: ${JSON.stringify(launched)}`);
  return launched[0]!.job.session;
}

/** Ask for status until the job is no longer running, or give up. Returns the last answer. */
async function statusUntilSettled(host: InProcessHost, h: HimaHome, runId: string, session: string, timeoutMs = 60_000, commandTimeoutMs = localCommandTimeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const answer = await himaCommand(host, h.workspace, `/hima job status ${runId} ${session}`, commandTimeoutMs);
    if (!/^running\b/.test(answer.text) || Date.now() >= deadline) return answer;
    await new Promise((r) => setTimeout(r, 250));
  }
}

/** A local site whose permit allows the workspace as a write root and `sh` as a wrapper, a booted
 *  host on it, and a shell script in the workspace for a job to run. */
async function localJobHome(script: string): Promise<{ h: HimaHome; host: InProcessHost; scriptPath: string; dispose(): Promise<void> }> {
  const h = await createHimaHome();
  await writeLocalSite(h);
  const scriptPath = path.join(h.workspace, 'job.sh');
  await writeFile(scriptPath, script);
  const host = await bootInProcess(h);
  return { h, host, scriptPath, dispose: async () => { await host.dispose(); await h.dispose(); } };
}

test('a local job is launched detached, runs, and its exit code comes back from the exit file it wrote', async () => {
  // `sleep 4` so the job is demonstrably still running when the first status is asked, and `echo` so
  // the tail has something of the job's own to show.
  const { h, host, scriptPath, dispose } = await localJobHome('sleep 4\necho done\n');
  let session = '';
  try {
    const launched = await himaCommand(host, h.workspace, `/hima job launch local ${h.workspace} --name slow -- sh ${scriptPath}`);
    assert.equal(launched.kind, 'success', launched.text);
    const runId = launched.runId!;
    assert.ok(runId, `the launch belongs to a run: ${launched.text}`);
    session = launchedSession(host, runId);
    assert.match(session, /^hima-[0-9a-f]{8}-slow-[0-9a-f]{6}$/, 'the session name carries the run and the job name, and nothing tmux cannot hold');
    assert.ok(tmuxHasSession(session), 'tmux itself says the session is there');

    const identity = jobRecords(host, runId)[0]!.job;
    assert.equal(identity.name, 'slow');
    assert.equal(identity.workspace, await realpath(h.workspace));
    assert.ok(identity.pid !== undefined && identity.pid > 0, `the launch read the pane pid: ${JSON.stringify(identity)}`);
    assert.match(identity.startedAt, /^\d{4}-\d{2}-\d{2}T/, 'the identity carries when it started');
    assert.ok(identity.wire.includes(posixQuote(scriptPath)), `the identity carries the command as sent: ${identity.wire}`);

    const running = await himaCommand(host, h.workspace, `/hima job status ${runId} ${session}`);
    assert.equal(running.kind, 'success', running.text);
    assert.match(running.text, /^running\b/, running.text);
    assert.equal(jobRecords(host, runId).length, 1, 'a running job is not recorded again on every look');

    const settled = await statusUntilSettled(host, h, runId, session);
    assert.equal(settled.kind, 'success', settled.text);
    assert.match(settled.text, /^finished\b/, settled.text);
    assert.match(settled.text, /exit 0\b/, settled.text);
    assert.ok(!tmuxHasSession(session), 'the session is gone once the job finished');

    const tailed = await himaCommand(host, h.workspace, `/hima job tail ${runId} ${session} --lines 5`);
    assert.equal(tailed.kind, 'success', tailed.text);
    assert.match(tailed.text, /done/, `the tail shows the job's own output: ${tailed.text}`);

    const records = jobRecords(host, runId);
    assert.deepEqual(records.map((r) => r.event), ['launched', 'finished'], 'launched then finished, once each');
    assert.deepEqual(records.map((r) => r.writer), ['executor', 'executor'], 'the executor writes job records');
    assert.equal(records[1]!.exitCode, 0, 'the exit code was read from the exit file');
    assert.deepEqual(records[1]!.job, identity, 'the finished record carries the same identity as the launch');

    const again = await himaCommand(host, h.workspace, `/hima job status ${runId} ${session}`);
    assert.match(again.text, /^finished\b/, again.text);
    assert.equal(jobRecords(host, runId).length, 2, 'the finish is recorded the first time it is observed, not every time');
  } finally {
    if (session) spawnSync('tmux', ['kill-session', '-t', `=${session}`], { timeout: 15_000 });
    await dispose();
  }
});

test('a job that exits three records exit code three, not a failure of its own', async () => {
  const { h, host, scriptPath, dispose } = await localJobHome('exit 3\n');
  let session = '';
  try {
    const launched = await himaCommand(host, h.workspace, `/hima job launch local ${h.workspace} --name failing -- sh ${scriptPath}`);
    assert.equal(launched.kind, 'success', launched.text);
    const runId = launched.runId!;
    session = launchedSession(host, runId);
    const settled = await statusUntilSettled(host, h, runId, session);
    assert.match(settled.text, /^finished\b/, settled.text);
    assert.match(settled.text, /exit 3\b/, settled.text);
    const finished = jobRecords(host, runId).filter((r) => r.event === 'finished');
    assert.equal(finished.length, 1);
    assert.equal(finished[0]!.exitCode, 3, 'the exit file said 3 and the record says 3');
  } finally {
    if (session) spawnSync('tmux', ['kill-session', '-t', `=${session}`], { timeout: 15_000 });
    await dispose();
  }
});

test('two launches of one job name in one workspace keep their own log and their own exit code', async () => {
  // A Job is one launch, and what that launch wrote belongs to it alone. Keying the log and the exit
  // file on the Job's *name* breaks that: a relaunch under the same name reads the previous attempt's
  // exit code the moment it is asked, long before it has written one of its own, and truncates the
  // log the earlier attempt left behind. Both files are named after the session instead, which is
  // unique per launch, so a name may be reused as often as the caller likes.
  const { h, host, scriptPath, dispose } = await localJobHome('echo first\nexit 3\n');
  const slowPath = path.join(h.workspace, 'slow.sh');
  await writeFile(slowPath, 'sleep 4\necho second\n');
  const sessions: string[] = [];
  try {
    const first = await himaCommand(host, h.workspace, `/hima job launch local ${h.workspace} --name same -- sh ${scriptPath}`);
    assert.equal(first.kind, 'success', first.text);
    const runId = first.runId!;
    const firstSession = jobRecords(host, runId).at(-1)!.job.session;
    sessions.push(firstSession);
    const firstSettled = await statusUntilSettled(host, h, runId, firstSession);
    assert.match(firstSettled.text, /^finished\b/, firstSettled.text);
    assert.match(firstSettled.text, /exit 3\b/, firstSettled.text);

    // The same name, the same workspace, the same Run: everything a second attempt at one job is.
    const second = await himaCommand(host, h.workspace, `/hima job launch local ${h.workspace} --run ${runId} --name same -- sh ${slowPath}`);
    assert.equal(second.kind, 'success', second.text);
    const secondSession = jobRecords(host, runId).at(-1)!.job.session;
    sessions.push(secondSession);
    assert.notEqual(secondSession, firstSession, 'each launch is its own session');
    assert.match(secondSession, /^hima-[0-9a-f]{8}-same-[0-9a-f]{6}$/, 'the suffix is drawn fresh, not counted from where this process happened to start');
    const identities = jobRecords(host, runId).filter((r) => r.event === 'launched').map((r) => r.job);
    for (const job of identities) {
      assert.ok(job.wire.includes(posixQuote(`${job.workspace}/${job.session}.log`)), `the log is named after the launch, not the job name: ${job.wire}`);
      assert.ok(job.wire.includes(posixQuote(`${job.workspace}/${job.session}.exit`)), `and so is the exit file: ${job.wire}`);
    }

    // Still running, and the earlier attempt's exit file must not answer for it.
    const running = await himaCommand(host, h.workspace, `/hima job status ${runId} ${secondSession}`);
    assert.match(running.text, /^running\b/, `the second launch is running, not finished with the first one's exit code: ${running.text}`);
    assert.deepEqual(
      jobRecords(host, runId).filter((r) => r.event === 'finished' && r.job.session === secondSession),
      [],
      'a job that is still running writes no finished record',
    );

    const secondSettled = await statusUntilSettled(host, h, runId, secondSession);
    assert.match(secondSettled.text, /^finished\b/, secondSettled.text);
    assert.match(secondSettled.text, /exit 0\b/, secondSettled.text);
    assert.deepEqual(
      jobRecords(host, runId).filter((r) => r.event === 'finished').map((r) => [r.job.session, r.exitCode]),
      [[firstSession, 3], [secondSession, 0]],
      'each launch kept the exit code it wrote itself',
    );

    const firstTail = await himaCommand(host, h.workspace, `/hima job tail ${runId} ${firstSession}`);
    assert.match(firstTail.text, /first/, `the first launch's log is still its own: ${firstTail.text}`);
    assert.doesNotMatch(firstTail.text, /second/, `and holds nothing the second launch wrote: ${firstTail.text}`);
    const secondTail = await himaCommand(host, h.workspace, `/hima job tail ${runId} ${secondSession}`);
    assert.match(secondTail.text, /second/, secondTail.text);
    assert.doesNotMatch(secondTail.text, /first/, `the second launch's log is its own too: ${secondTail.text}`);
  } finally {
    for (const session of sessions) spawnSync('tmux', ['kill-session', '-t', `=${session}`], { timeout: 15_000 });
    await dispose();
  }
});

test('killing a running job leaves no session behind and records the stop that was observed', async () => {
  const { h, host, scriptPath, dispose } = await localJobHome('sleep 120\n');
  let session = '';
  try {
    const launched = await himaCommand(host, h.workspace, `/hima job launch local ${h.workspace} --name long -- sh ${scriptPath}`);
    assert.equal(launched.kind, 'success', launched.text);
    const runId = launched.runId!;
    session = launchedSession(host, runId);
    assert.ok(tmuxHasSession(session), 'the job is running before the kill');

    const killed = await himaCommand(host, h.workspace, `/hima job kill ${runId} ${session}`);
    assert.equal(killed.kind, 'success', killed.text);
    assert.match(killed.text, /stopped/, killed.text);
    assert.ok(!tmuxHasSession(session), 'tmux itself says nothing is left of the session');

    const records = jobRecords(host, runId);
    assert.deepEqual(records.map((r) => r.event), ['launched', 'killed'], 'the stop that was observed is recorded');
    assert.equal(records[1]!.exitCode, undefined, 'a killed job has no exit code: it never wrote one');

    // A killed job wrote no exit file, so what became of it is `gone` — never a fabricated exit code.
    const after = await himaCommand(host, h.workspace, `/hima job status ${runId} ${session}`);
    assert.match(after.text, /^gone\b/, after.text);
    assert.equal(jobRecords(host, runId).length, 2, 'a gone job is not recorded as finished');

    const twice = await himaCommand(host, h.workspace, `/hima job kill ${runId} ${session}`);
    assert.equal(twice.kind, 'success', twice.text);
    assert.match(twice.text, /already gone/, `a second kill answers clearly rather than throwing: ${twice.text}`);
    assert.equal(jobRecords(host, runId).length, 2, 'a second kill writes no second killed record');
  } finally {
    if (session) spawnSync('tmux', ['kill-session', '-t', `=${session}`], { timeout: 15_000 });
    await dispose();
  }
});

test('a launch into a workspace outside the permit\'s write roots is refused before any command is run', async () => {
  const { h, host, scriptPath, dispose } = await localJobHome('echo never\n');
  try {
    // `h.home` exists and resolves; it is simply not under the one write root the permit allows.
    clearRemoteCommands();
    const refused = await himaCommand(host, h.workspace, `/hima job launch local ${h.home} -- sh ${scriptPath}`);
    assert.equal(refused.kind, 'error', refused.text);
    assert.match(refused.text, /outside the permitted write roots/, refused.text);
    const runId = refused.runId!;
    const records = recordsOf(host, runId);
    assert.equal(records.length, 1);
    assert.equal(records[0]!.type, 'refusal');
    assert.equal(records[0]!.writer, 'shell', 'the shell refuses on the permit');
    assert.equal(jobRecords(host, runId).length, 0, 'nothing was launched');
    assert.deepEqual(
      remoteCommands().filter((c) => c.argv[0] === 'tmux'),
      [],
      'no tmux command was run: the refusal came before the launch',
    );
  } finally {
    await dispose();
  }
});

test('a launch whose first word is not an allowed wrapper is refused, and nothing is run at all', async () => {
  const { h, host, dispose } = await localJobHome('echo never\n');
  try {
    clearRemoteCommands();
    const refused = await himaCommand(host, h.workspace, `/hima job launch local ${h.workspace} -- curl https://example.com`);
    assert.equal(refused.kind, 'error', refused.text);
    assert.match(refused.text, /not an allowed wrapper/, refused.text);
    assert.match(refused.text, /curl/, refused.text);
    const runId = refused.runId!;
    assert.equal(recordsOf(host, runId).length, 1);
    assert.equal(recordsOf(host, runId)[0]!.type, 'refusal');
    assert.equal(jobRecords(host, runId).length, 0, 'nothing was launched');
    assert.deepEqual(remoteCommands(), [], 'the wrapper decision needs nothing from the site: nothing was run');
  } finally {
    await dispose();
  }
});

test('a job name that would climb out of the workspace is made safe before it names anything', async () => {
  // The name becomes part of the tmux session name, and the session name is the stem of two files in
  // the workspace, so a name carrying path separators would put a job's log and exit file wherever it
  // liked, inside a workspace the permit had just approved. It is made safe once, before either is
  // named.
  const { h, host, scriptPath, dispose } = await localJobHome('echo climbed\n');
  let session = '';
  try {
    const launched = await himaCommand(host, h.workspace, `/hima job launch local ${h.workspace} --name ../../escaped -- sh ${scriptPath}`);
    assert.equal(launched.kind, 'success', launched.text);
    const runId = launched.runId!;
    session = launchedSession(host, runId);
    const identity = jobRecords(host, runId)[0]!.job;
    assert.equal(identity.name, '------escaped', 'every path separator is gone from the name');
    assert.doesNotMatch(session, /[/.:]/, 'and from the tmux session name, which may hold neither');
    const workspace = await realpath(h.workspace);
    assert.ok(identity.wire.includes(posixQuote(`${workspace}/${session}.log`)), `the log is named inside the workspace: ${identity.wire}`);
    assert.ok(identity.wire.includes(posixQuote(`${workspace}/${session}.exit`)), `and so is the exit file: ${identity.wire}`);
    const settled = await statusUntilSettled(host, h, runId, session);
    assert.match(settled.text, /^finished\b/, settled.text);
  } finally {
    if (session) spawnSync('tmux', ['kill-session', '-t', `=${session}`], { timeout: 15_000 });
    await dispose();
  }
});

test('status on a session the run never launched answers gone rather than inventing a job', async () => {
  const { h, host, scriptPath, dispose } = await localJobHome('sleep 120\n');
  let session = '';
  try {
    const launched = await himaCommand(host, h.workspace, `/hima job launch local ${h.workspace} -- sh ${scriptPath}`);
    assert.equal(launched.kind, 'success', launched.text);
    const runId = launched.runId!;
    session = launchedSession(host, runId);
    const answer = await himaCommand(host, h.workspace, `/hima job status ${runId} hima-nosuch-session-1`);
    assert.equal(answer.kind, 'success', answer.text);
    assert.match(answer.text, /^gone\b/, answer.text);
    assert.equal(jobRecords(host, runId).length, 1, 'the unknown session left no record of its own');
  } finally {
    if (session) spawnSync('tmux', ['kill-session', '-t', `=${session}`], { timeout: 15_000 });
    await dispose();
  }
});

test('the job plumbing the channel admits is exactly the plumbing the job operations run', () => {
  // The same rule step 1 set for the read-only probes: an allowlist wider than the channel's own use
  // is permission granted on a customer's Site ahead of any caller needing it. The list below is the
  // whole vocabulary the reference-site audit test observes being sent, and no more.
  assert.deepEqual([...jobPlumbing].sort(), ['cat', 'tail', 'test', 'tmux'], "the channel's job list is exactly the verbs the job operations run");
  for (const verb of jobPlumbing) {
    assert.ok(jobPlumbingVerbs.has(verb), `the channel admits ${verb}, which this test does not judge to be job plumbing`);
  }
});

test('the channel runs its own verbs and refuses everything else, on a local site as on a remote one', async () => {
  const h = await createHimaHome();
  try {
    const { sitesDir } = await writeLocalSite(h);
    const channel = channelFor(loadSite(sitesDir, 'local'));
    clearRemoteCommands();
    // Harmless, which is the point: they are refused for not being the channel's own verbs, not for
    // being dangerous. The permit governs the user's command; this governs the channel itself.
    await assert.rejects(() => channel.exec(['echo', 'hima']), /refusing to run "echo"/);
    await assert.rejects(() => channel.exec(['curl', 'https://example.com']), /refusing to run "curl"/);
    assert.deepEqual(remoteCommands(), [], 'a refused command is never run');
  } finally {
    await h.dispose();
  }
});
