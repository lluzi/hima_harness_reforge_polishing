// Ticket #10: Jobs on a Site. A command is launched detached in its own tmux session inside a
// workspace, its identity is recorded, its exit code comes back from the exit file the launch wrote,
// its log can be tailed, and it can be killed with the observed stop recorded. The Permit now decides
// where a Job may run and which wrapper it may be. Everything here is driven through the booted host:
// the `/hima job` command face in, the HimaLedger and the channel's audit out.
//
// The local half runs real detached tmux sessions on this machine. The reference-site half talks to
// the real `linglong` over SSH and writes nothing outside a workspace it creates for itself under
// the campaign root the permit allows.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { realpath, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHimaHome, type HimaHome } from './support/dsh-home.ts';
import { bootInProcess, type InProcessHost } from './support/boot-inprocess.ts';
import { himaCommand, localCommandTimeoutMs, siteCommandTimeoutMs } from './support/command.ts';
import { installReferenceSite, writeLocalSite } from './support/site.ts';
// tmux itself, asked by the one module that owns that question for this suite.
import { tmuxHasSession } from './support/tmux.ts';
import { channelFor, clearRemoteCommands, controlPathFor, jobPlumbing, loadSite, quote, remoteCommands } from '@hima/harness';
import type { JobRecord, LedgerRecord, RemoteCommand } from '@hima/harness';

const destination = 'luzi@192.168.50.41';
/** The campaign workspace root the reference permit allows writes under. Nothing else is touched. */
const campaignRoot = '/data/eda/project/hima_harness';
/** The site's own Design Zoo: readable, and squarely outside every write root. The refusal case. */
const designZoo = '/data/eda/project/design_zoo';

/** The test's own judgement of what a job-plumbing verb is, kept apart from the channel's list on
 *  purpose: the audit test holds what was actually sent against this, not against the implementation's
 *  own idea of itself. */
const jobPlumbingVerbs = new Set(['tmux', 'test', 'tail', 'cat', 'realpath']);
/** The test's own POSIX single-quoting, reimplemented independently of `channel.ts`'s `quote`. */
const posixQuote = (word: string): string => `'${word.replaceAll("'", `'\\''`)}'`;

/** Is the LAN site reachable from here at all? BatchMode so a prompt can never hang the suite. */
function probeSite(): string | false {
  const probe = spawnSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', destination, 'true'], { encoding: 'utf8', timeout: 20_000 });
  if (probe.status === 0) return false;
  return `the reference site ${destination} is not reachable from here (it is LAN-only): ssh exited ${probe.status ?? 'on a signal'}`;
}

/**
 * Run one command on the reference site with the test's own ssh, outside the harness entirely.
 *
 * The scaffolding a test needs is the test's own business: HimaChannel admits neither `mkdir` nor
 * `rm`, and it must not start admitting them because a test wanted a directory. BatchMode so a
 * prompt can never hang the suite, and the caller quotes what it passes.
 */
function onTheSite(command: string): void {
  const ran = spawnSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', destination, command], { encoding: 'utf8', timeout: 30_000 });
  assert.equal(ran.status, 0, `the test's own ssh could not run "${command}" on ${destination}: ${ran.stderr ?? ''}`);
}

/**
 * Put at the channel's control path what a SIGKILLed ssh master leaves behind: the path exists and
 * nothing is listening on it. ssh then says "ControlSocket ... already exists, disabling
 * multiplexing", runs the command unmultiplexed, and leaves the path exactly as it found it — so
 * every later command pays for its own connection until something removes the file.
 */
async function plantStaleControlSocket(controlPath: string): Promise<void> {
  await rm(controlPath, { force: true });
  await writeFile(controlPath, 'not a socket: what a killed master leaves behind');
  assert.ok(!(await stat(controlPath)).isSocket(), 'the stale path is in place and is not a socket');
}

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
    assert.ok(identity.pid > 0, `the launch read the pane pid: ${JSON.stringify(identity)}`);
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

// Every command the channel asked the reference site to run in the tests below, oldest first.
const sentToTheSite: RemoteCommand[] = [];
function collectRemoteCommands(): readonly RemoteCommand[] {
  const seen = remoteCommands();
  sentToTheSite.push(...seen);
  return seen;
}

describe('jobs on the reference site', { skip: probeSite() }, () => {
  test('a job runs in a workspace the test creates under the campaign root, and its exit code comes back', async () => {
    const h = await createHimaHome();
    await installReferenceSite(h);
    const workspace = `${campaignRoot}/hima-test-${randomUUID()}`;
    // Everything this test writes lives under this one directory, which it creates and removes with
    // its own ssh: the harness's channel does not make or unmake paths on a Site, and a test is not
    // a reason to let it.
    assert.ok(workspace.startsWith(`${campaignRoot}/hima-test-`), 'the workspace is the test\'s own, under the campaign root');
    onTheSite(`mkdir -p -- ${posixQuote(workspace)}`);
    // Two nested guards: the inner one always disposes the host, and the outer one always takes the
    // test's own workspace back down on the site, even if the host's disposal itself fails.
    try {
      const host = await bootInProcess(h);
      clearRemoteCommands();
      try {
        // `make` is one of the permit's allowed wrappers; `-v` only prints its version, so the job is
        // real, cheap, and writes nothing of its own.
        const launched = await himaCommand(host, h.workspace, `/hima job launch linglong ${workspace} --name makever -- make -v`, siteCommandTimeoutMs);
        assert.equal(launched.kind, 'success', launched.text);
        const runId = launched.runId!;
        const session = launchedSession(host, runId);
        const identity = jobRecords(host, runId)[0]!.job;
        assert.equal(identity.workspace, workspace, 'the job runs in the workspace the permit resolved');
        assert.ok(identity.pid > 0, `the launch read the pane pid on the site: ${JSON.stringify(identity)}`);

        const settled = await statusUntilSettled(host, h, runId, session, 60_000, siteCommandTimeoutMs);
        assert.equal(settled.kind, 'success', settled.text);
        assert.match(settled.text, /^finished\b/, settled.text);
        assert.match(settled.text, /exit 0\b/, settled.text);

        const tailed = await himaCommand(host, h.workspace, `/hima job tail ${runId} ${session} --lines 20`, siteCommandTimeoutMs);
        assert.equal(tailed.kind, 'success', tailed.text);
        assert.match(tailed.text, /GNU Make/, `the tail carries the job's own output from the site: ${tailed.text}`);

        const records = jobRecords(host, runId);
        assert.deepEqual(records.map((r) => r.event), ['launched', 'finished']);
        assert.equal(records[1]!.exitCode, 0);
        assert.equal(records[0]!.siteId, 'linglong');

        // Killing a job that has already ended is an answer over SSH too, not an exception, and it
        // writes nothing: only a kill that actually stopped something records a killed event.
        const killed = await himaCommand(host, h.workspace, `/hima job kill ${runId} ${session}`, siteCommandTimeoutMs);
        assert.equal(killed.kind, 'success', killed.text);
        assert.match(killed.text, /already gone/, killed.text);
        assert.equal(jobRecords(host, runId).length, 2, 'nothing was stopped, so nothing was recorded');
      } finally {
        collectRemoteCommands();
        await host.dispose();
      }
    } finally {
      // Remove only what this test created, inside the one write root the permit allows.
      assert.ok(workspace.startsWith(`${campaignRoot}/hima-test-`), 'nothing but the test\'s own workspace is ever removed');
      onTheSite(`rm -rf -- ${posixQuote(workspace)}`);
      await h.dispose();
    }
  });

  test('a stale control socket is cleared without the job plumbing being sent a second time', async () => {
    const h = await createHimaHome();
    const { sitesDir } = await installReferenceSite(h);
    const controlPath = controlPathFor(loadSite(sitesDir, 'linglong'));
    const workspace = `${campaignRoot}/hima-test-${randomUUID()}`;
    assert.ok(workspace.startsWith(`${campaignRoot}/hima-test-`), 'the workspace is the test\'s own, under the campaign root');
    onTheSite(`mkdir -p -- ${posixQuote(workspace)}`);
    try {
      const host = await bootInProcess(h);
      clearRemoteCommands();
      try {
        await plantStaleControlSocket(controlPath);
        const launched = await himaCommand(host, h.workspace, `/hima job launch linglong ${workspace} --name stale -- make -v`, siteCommandTimeoutMs);
        assert.equal(launched.kind, 'success', launched.text);
        const runId = launched.runId!;
        const session = launchedSession(host, runId);
        assert.equal(
          remoteCommands().filter((c) => c.argv[0] === 'tmux' && c.argv[1] === 'new-session').length,
          1,
          'the job was started once and once only, whatever the connection did',
        );
        const settled = await statusUntilSettled(host, h, runId, session, 60_000, siteCommandTimeoutMs);
        assert.match(settled.text, /^finished\b/, settled.text);

        // Now the stale socket is put where the *job plumbing* meets it first: `status` asks
        // `test -f` about the exit file before anything else, and `test` is the channel's own
        // plumbing, not a read-only probe. ssh has already run that command by the time it says the
        // socket is stale, so sending it again is a second run of it on the site — harmless for a
        // `test`, a second launch for a `tmux new-session`. Only a read-only probe is worth resending.
        await plantStaleControlSocket(controlPath);
        const before = remoteCommands().length;
        const again = await himaCommand(host, h.workspace, `/hima job status ${runId} ${session}`, siteCommandTimeoutMs);
        assert.equal(again.kind, 'success', again.text);
        const during = remoteCommands().slice(before);
        assert.equal(
          during.filter((c) => c.argv[0] === 'test').length,
          1,
          `the plumbing that met the stale socket was sent once: ${JSON.stringify(during.map((c) => c.argv))}`,
        );
        assert.ok((await stat(controlPath)).isSocket(), 'the stale file was removed all the same, so the warm connection came back');
      } finally {
        collectRemoteCommands();
        await host.dispose();
      }
    } finally {
      assert.ok(workspace.startsWith(`${campaignRoot}/hima-test-`), 'nothing but the test\'s own workspace is ever removed');
      onTheSite(`rm -rf -- ${posixQuote(workspace)}`);
      await h.dispose();
    }
  });

  test('a launch into the site\'s Design Zoo is refused on the real permit before any job command is sent', async () => {
    const h = await createHimaHome();
    await installReferenceSite(h);
    const host = await bootInProcess(h);
    clearRemoteCommands();
    try {
      const refused = await himaCommand(host, h.workspace, `/hima job launch linglong ${designZoo} -- make -v`, siteCommandTimeoutMs);
      assert.equal(refused.kind, 'error', refused.text);
      assert.match(refused.text, /outside the permitted write roots/, refused.text);
      const runId = refused.runId!;
      assert.equal(recordsOf(host, runId).length, 1);
      assert.equal(recordsOf(host, runId)[0]!.type, 'refusal');
      assert.equal(jobRecords(host, runId).length, 0);
      const ran = collectRemoteCommands();
      assert.ok(ran.length > 0, 'the permit decision resolved the workspace on the site');
      assert.deepEqual(
        ran.filter((c) => c.argv[0] === 'tmux'),
        [],
        `no job command was sent: ${JSON.stringify(ran)}`,
      );
    } finally {
      await host.dispose();
      await h.dispose();
    }
  });

  test('every command the site was asked to run was job plumbing, sent on the wire it decided on, and inside the campaign root', (t) => {
    assert.ok(sentToTheSite.length > 0, 'the tests above ran commands on the site');
    for (const { argv } of sentToTheSite) t.diagnostic(`asked the site to run: ${argv.join(' ')}`);
    for (const { argv, wire } of sentToTheSite) {
      const verb = argv[0] ?? '';
      assert.ok(jobPlumbingVerbs.has(verb), `not a job-plumbing verb: ${JSON.stringify(argv)}`);
      assert.equal(wire, argv.map(quote).join(' '), `the wire is not every argv word independently quoted: ${JSON.stringify({ argv, wire })}`);
      // Nothing this suite asks the site to run names a path outside the campaign root, and nothing
      // it can run would create or remove one: the channel admits no verb that makes or unmakes a path.
      for (const word of argv.slice(1)) {
        if (!word.startsWith('/data/')) continue;
        const allowed = word === campaignRoot || word.startsWith(`${campaignRoot}/`) || word === designZoo;
        assert.ok(allowed, `a path neither under the campaign root nor the one refusal case reached the wire: ${JSON.stringify(argv)}`);
      }
    }
    // The user command never reaches the wire on its own: it is the shell line tmux is given to run.
    const launches = sentToTheSite.filter((c) => c.argv[0] === 'tmux' && c.argv[1] === 'new-session');
    assert.ok(launches.length > 0, 'jobs were launched on the site');
    for (const launch of launches) {
      const script = launch.argv.at(-1)!;
      assert.match(script, /^'make' '-v' > '/, `the only user command launched is the permitted one: ${script}`);
    }
    const verbs = [...new Set(sentToTheSite.map((c) => c.argv[0]))].sort();
    assert.deepEqual(verbs, ['cat', 'realpath', 'tail', 'test', 'tmux'], 'the whole command set this ticket runs on a Site');
  });
});
