// Ticket #18: a `tmux has-session` exit 1 means "no session" only when tmux says so; anything else
// is "cannot tell", and a cannot-tell writes nothing.
//
// tmux exits 1 for four different facts, and only two of them are an answer about a session. It says
// `can't find session: <name>` when the server is up and the session is not (older tmux says
// `session not found: <name>`), and `no server running on <socket>` when the server has exited —
// which it does when its last session ends, leaving its socket file behind, so that is the ordinary
// state of a quiet Site. Both mean the session is over. But it also says `error connecting to
// <socket> (No such file or directory)` when the socket path is not there at all, and `error
// connecting to <socket> (Permission denied)` when the directory holding it cannot be entered — and
// neither of those is about a session. A Job may be running under a server nobody can reach, and
// reading that as "the job is gone" blocks a node, spends the Retry allowance, and leaves a
// licence-holding Job running unattended on a customer's Site. And none of the four is a channel
// that could not run the probe at all — a command that never started, or one that never came back
// with a status, which is how an ssh Site ordinarily stops answering.
//
// So the harness answers "cannot tell" and writes nothing: no `finished`, no `killed`, no `gone`, no
// `blocked` node, no move of the run row. Every place that waits asks again at its next interval —
// the act node's poll while its Job is open, and the claim step counting a Site's slots before there
// is a Job at all — bounded by the Run's time box and by nothing else. A restarted host reports the
// Run `site-unreadable` and leaves it exactly as it was, and the faces say which Site could not be
// asked. What is *not* a cannot-tell is a Job that already wrote its exit file: that is read first,
// so a finished Job whose socket a cleaner later removed still settles. The one write this rule adds
// is the time box running out while the Site is silent: the Budget has ended and a person must see
// that, so the node is blocked saying the kill did not take.
//
// Driven at the booted-Host seam over the local site, with `TMUX_TMPDIR` pointing at a short
// directory each test makes for itself (a unix socket path is limited to about 100 characters on
// macOS, which an `os.tmpdir()` path would spend on its own). That is what lets a test break and put
// back the socket of its own Job's tmux server without touching any other tmux on this machine —
// including the four other agents' — and it is the same fault a `/tmp` cleaner produces on a Site.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { chmod, mkdir, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHimaHome, type HimaHome } from './support/dsh-home.ts';
import { bootInProcess, type InProcessHost } from './support/boot-inprocess.ts';
import { himaCommand, localCommandTimeoutMs, siteCommandTimeoutMs } from './support/command.ts';
import { writeLocalSite } from './support/site.ts';
import { timingProbePackId } from './support/pack.ts';
// The pieces every fabric suite composes: the home a Run is driven in, the ledger as a test reads
// it, the waits that let a test act while a Job is still on the Site, and the command left running
// while it does. What stays below is what is genuinely this suite's own — the Site it breaks and
// puts back, the PATH it shadows, and the record kinds only this subject is about.
import {
  inBackground,
  jobRecords,
  launchedJobOf,
  localHome,
  nodeRecords,
  ONE_GENERATION,
  recordsOf,
  runOf,
  waitUntil,
  type OpenJob,
  type Pending,
} from './support/fabric.ts';
import { findOnPath, killSession, tmuxHasSession, tmuxSocketUnder } from './support/tmux.ts';
import { clearRemoteCommands, jobPlumbing, jobPollFastMs, jobPollSlowMs, readOnlyProbes, remoteCommands, workspacePlumbing } from '@hima/harness';

/** How many looks at an unreadable Site a test asserts it saw: two, which is one more than "it
 *  asked once and gave up" and is what tells retrying apart from raising. */
const unreadableLooks = 2;

/**
 * How long a test holds a Site unreadable while asserting that nothing is written.
 *
 * Taken from the poll's own intervals rather than written out again, so tuning them cannot leave
 * this asserting nothing: two of the *slow* interval, because a waiter that has already left its
 * fast phase — which four other agents' suites on this machine can easily arrange — is the slowest
 * this can honestly be, plus one fast interval so the look that begins the stretch is not counted
 * against the two.
 */
const unreadableHoldMs = unreadableLooks * jobPollSlowMs + jobPollFastMs;

/**
 * How long the shadowed `tmux new-session` holds a launch open before it really makes it.
 *
 * The window a cancel has to land in to cross a launch is otherwise the milliseconds between the
 * permit's decision and the `launched` record, which is a race a test can only hope to win. Five
 * seconds against a cancel that reaches no Site at all — it finds no open Job, so it writes its
 * records and returns — is three orders of magnitude of room, and the cancel's own answer says
 * whether it really crossed, so a run that did not is a failure and never a quiet pass.
 */
const crossingWindowSeconds = 5;

/** Every record of a Run as `<type>/<what it says>`, which is what "nothing was written" is held
 *  against: a count alone would pass if one record were replaced by another. */
const ledgerShape = (host: InProcessHost, runId: string): string[] =>
  recordsOf(host, runId).map((r) => (r.type === 'job' ? `job/${r.event}` : r.type === 'node' ? `node/${r.nodeId}/${r.state}` : r.type));

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * A `TMUX_TMPDIR` of this test's own, short enough for a unix socket path, together with the two
 * ways a test breaks the Site under it and the way it puts the Site back.
 *
 * Every tmux this test starts — the harness's Jobs and the suite's own probes alike, both of which
 * inherit this process's environment — talks to a server whose socket lives under it and nobody
 * else's. `heal` is what the suite's own tmux needs before it can end the session this test started:
 * while the Site is broken, the test can no more ask than the harness can, which is the whole point.
 */
interface OwnTmux {
  readonly dir: string;
  readonly socketDir: string;
  readonly socket: string;
  /** What a `/tmp` cleaner does to a living server: the socket is gone, the sessions are not. */
  moveSocketAway(): Promise<void>;
  /** The socket is there and the server is listening; what changes is that nothing may enter the
   *  directory holding it. tmux exits 1 for this exactly as for a session that is not there. */
  closeSocketDir(): Promise<void>;
  /** Whatever this test broke, put back — so the Site answers again, and so the suite's own tmux can
   *  be asked to end the session the test started. Says nothing and asserts nothing. */
  heal(): Promise<void>;
  /** `TMUX_TMPDIR` back as it was and the directory gone, however the test ended. */
  restore(): Promise<void>;
}

async function ownTmuxTmpdir(): Promise<OwnTmux> {
  const dir = path.join('/tmp', `hima-${randomBytes(4).toString('hex')}`);
  await mkdir(dir, { recursive: true });
  const { dir: socketDir, socket } = tmuxSocketUnder(dir);
  const saved = process.env.TMUX_TMPDIR;
  process.env.TMUX_TMPDIR = dir;
  const away = `${socket}-moved-away`;
  let socketIsAway = false;
  let dirIsClosed = false;
  return {
    dir,
    socketDir,
    socket,
    async moveSocketAway(): Promise<void> {
      await rename(socket, away);
      socketIsAway = true;
    },
    async closeSocketDir(): Promise<void> {
      await chmod(socketDir, 0o000);
      dirIsClosed = true;
    },
    async heal(): Promise<void> {
      if (dirIsClosed) {
        await chmod(socketDir, 0o700).catch(() => undefined);
        dirIsClosed = false;
      }
      if (socketIsAway) {
        await rename(away, socket).catch(() => undefined);
        socketIsAway = false;
      }
    },
    async restore(): Promise<void> {
      if (saved === undefined) delete process.env.TMUX_TMPDIR;
      else process.env.TMUX_TMPDIR = saved;
      // A directory closed by a test is opened again before it is removed, whatever the test did.
      await chmod(socketDir, 0o700).catch(() => undefined);
      await rm(dir, { recursive: true, force: true });
    },
  };
}

/**
 * A PATH holding one directory of this test's making, where the two ways a probe comes back with no
 * exit status at all can be arranged — the fault the socket cases cannot produce, because there the
 * probe runs and tmux answers.
 *
 * `noTmuxAtAll` is a Site with no tmux on it: the command cannot be started, which is what a missing
 * binary and a missing ssh client both give the channel. `neverAnswers` is a `tmux` that comes back
 * with no status at all — it is killed by a signal, which is exactly what the channel's own timeout
 * does to a command that hangs (it `SIGKILL`s the child and reads the same `code === null`), reached
 * in milliseconds instead of holding this suite for the sixty seconds a real hang would.
 * `launchNeverAnswers` is the same signal narrowed to one command: everything is passed through to
 * the machine's real tmux except `new-session`, which dies without answering — the launch that may
 * have reached the Site and started something, with the answer lost. `slowLaunchNoKill` narrows it
 * to the other command that changes something, `kill-session`, and holds the launch open for a
 * stated number of seconds first, which is what turns the cancel-crossing-launch window from a
 * millisecond to race into a stretch a test can act in.
 *
 * For the three that kill, the directory is the *whole* PATH rather than its front, with the
 * channel's other verbs linked into it: a non-executable entry earlier on a PATH is skipped by
 * `execvp`, which searches on and finds the machine's real tmux, so a shadow that only prepends
 * proves nothing where the shadow is the file's *absence*. Every verb the channel may run is linked
 * through — taken from the channel's own lists, so a verb added there cannot leave a shadow failing
 * for a reason no test means — plus the `sh` a launched Job's wrapper needs: a Run prepares its
 * workspace and reads its exit file exactly as always, while tmux is the one thing this directory
 * decides.
 *
 * `slowLaunchNoKill` is the one that goes in *front* of the machine's PATH instead of replacing it,
 * and it is the only one whose launch really starts a Job: the tmux server that launch starts
 * inherits this PATH, and the Job's own flow needs the machine's `make` and everything under it.
 * A shim that is there and executable is found by `execvp` at the front, so the front is enough
 * here — what a replaced PATH is for is the shadow that removes the file.
 */
const linkedVerbs: readonly string[] = [...new Set([...readOnlyProbes, ...jobPlumbing, ...workspacePlumbing, 'sh'])].filter((v) => v !== 'tmux');

interface ShadowedTmux {
  noTmuxAtAll(): Promise<void>;
  neverAnswers(): Promise<void>;
  /** A tmux that answers every question and dies on the one command that changes something: the
   *  launch. Everything a Run does before `tmux new-session` goes through to the real tmux. */
  launchNeverAnswers(): Promise<void>;
  /** A tmux that takes `seconds` over every launch and then really makes it, answers every question,
   *  and dies unheard on `kill-session` alone: a Site that is slow to start a Job and cannot be
   *  asked to stop one. */
  slowLaunchNoKill(seconds: number): Promise<void>;
  restore(): Promise<void>;
}

async function shadowedTmux(): Promise<ShadowedTmux> {
  const dir = path.join('/tmp', `hima-${randomBytes(4).toString('hex')}-bin`);
  await mkdir(dir, { recursive: true });
  const tmux = path.join(dir, 'tmux');
  const saved = process.env.PATH ?? '';
  /** The shadow in place and the PATH pointing at it. Written and only then made executable: a mode
   *  given to `writeFile` applies only when it creates the file. */
  const shim = async (script: string, searchPath = dir): Promise<void> => {
    await writeFile(tmux, script);
    await chmod(tmux, 0o755);
    process.env.PATH = searchPath;
  };
  try {
    for (const verb of linkedVerbs) {
      const real = findOnPath(verb, saved);
      if (!real) throw new Error(`this machine has no "${verb}" on its PATH, and the channel's own verbs need it`);
      await symlink(real, path.join(dir, verb));
    }
  } catch (err) {
    // Nothing has been returned yet, so no `finally` of the test's is holding this directory: a setup
    // that throws halfway removes it here rather than leaving it under `/tmp` for good.
    await rm(dir, { recursive: true, force: true });
    throw err;
  }
  return {
    async noTmuxAtAll(): Promise<void> {
      await rm(tmux, { force: true });
      process.env.PATH = dir;
    },
    async neverAnswers(): Promise<void> {
      await shim('#!/bin/sh\nkill -9 $$\n');
    },
    async launchNeverAnswers(): Promise<void> {
      const real = findOnPath('tmux', saved);
      if (!real) throw new Error('this machine has no "tmux" on its PATH, and this shadow passes every other command through to it');
      await shim(`#!/bin/sh\nif [ "$1" = "new-session" ]; then kill -9 $$; fi\nexec '${real}' "$@"\n`);
    },
    async slowLaunchNoKill(seconds: number): Promise<void> {
      const real = findOnPath('tmux', saved);
      if (!real) throw new Error('this machine has no "tmux" on its PATH, and this shadow passes every other command through to it');
      const sleepAt = findOnPath('sleep', saved);
      if (!sleepAt) throw new Error('this machine has no "sleep" on its PATH, and this shadow waits with it');
      await shim(
        `#!/bin/sh\nif [ "$1" = "kill-session" ]; then kill -9 $$; fi\nif [ "$1" = "new-session" ]; then '${sleepAt}' ${String(seconds)}; fi\nexec '${real}' "$@"\n`,
        `${dir}:${saved}`,
      );
    },
    async restore(): Promise<void> {
      process.env.PATH = saved;
      await rm(dir, { recursive: true, force: true });
    },
  };
}

/** A local home with no pack and no flow, for the tests that launch a Job through the `/hima job`
 *  face rather than through a Run, plus the script such a Job runs. */
async function localJobHome(script: string): Promise<{ h: HimaHome; scriptPath: string }> {
  const h = await createHimaHome();
  await writeLocalSite(h);
  const scriptPath = path.join(h.workspace, 'job.sh');
  await writeFile(scriptPath, script);
  return { h, scriptPath };
}

/** A script in an existing home's workspace, for a test that needs a Job beside a Run's own. */
async function writeJobScript(h: HimaHome, name: string, script: string): Promise<string> {
  const scriptPath = path.join(h.workspace, name);
  await writeFile(scriptPath, script);
  return scriptPath;
}

// One generation, because a Site that will not answer is what this suite is about: the shipped
// pack's own loop would go round again with the period the chooser chose, and these tests would then
// be counting the looks and the launches of three generations instead of the one under test.
const runLine = (goalNs = 2.0): string => `/hima run ${timingProbePackId} --site local --goal target_period_ns=${goalNs} --set periodNs=${goalNs} ${ONE_GENERATION}`;

/** How many times the harness asked the Site about this exact session on the wire. `=<session>` is
 *  how tmux is told to match a name exactly, which is what the job plumbing sends. */
const asksAbout = (session: string): number =>
  remoteCommands().filter((c) => c.argv[0] === 'tmux' && c.argv[1] === 'has-session' && c.argv.includes(`=${session}`)).length;

/** How many launches went out on the wire. `tmux new-session` is the one command of the job plumbing
 *  that starts something on a Site, and it is the one that may never be sent a second time for a
 *  single attempt — the audit, not the ledger, because a launch whose answer was lost writes no
 *  record and the ledger would show nothing at all of a second one either. */
const launchesSent = (): number => remoteCommands().filter((c) => c.argv[0] === 'tmux' && c.argv[1] === 'new-session').length;

/** The one launched session of a Run, read from the ledger rather than scraped from a command's text. */
function launchedSession(host: InProcessHost, runId: string): string {
  const launched = jobRecords(host, runId).filter((r) => r.event === 'launched');
  assert.equal(launched.length, 1, `exactly one launched job record in ${runId}: ${JSON.stringify(launched)}`);
  return launched[0]!.job.session;
}

/** Every tmux session every Run of this home ever launched, oldest first. What a test whose Run may
 *  launch twice ends by, so it stops the sessions it started however it ended — and only those. */
const sessionsHere = (host: InProcessHost): string[] =>
  host.ctx.hima.ledger.runs().flatMap((r) => jobRecords(host, r.id).filter((j) => j.event === 'launched').map((j) => j.job.session));

test('a poll that cannot ask the site writes nothing and keeps asking, and the run finishes when the socket comes back', async (t) => {
  // Twenty seconds of stand-in synthesis: long enough that the Job is demonstrably still sleeping
  // while the socket is away and after it is put back, whatever else this machine is running.
  let tmuxTmp: OwnTmux | undefined;
  let h: HimaHome | undefined;
  let host: InProcessHost | undefined;
  let session = '';
  let pending: Pending | undefined;
  try {
    tmuxTmp = await ownTmuxTmpdir();
    const local = await localHome(t, { sleepSeconds: 20 });
    if (!local) return;
    h = local.h;
    host = await bootInProcess(h);
    pending = inBackground(host, h, runLine());
    const job = await launchedJobOf(host);
    session = job.session;
    assert.ok(tmuxHasSession(session), 'the stand-in job is running on the site');

    await tmuxTmp.moveSocketAway();
    const before = ledgerShape(host, job.runId);

    const status = await himaCommand(host, h.workspace, `/hima job status ${job.runId} ${session}`);
    t.diagnostic(status.text);
    assert.equal(status.kind, 'error', `the site cannot be asked, so the answer is not one: ${status.text}`);
    assert.match(status.text, /site local/, `the answer names the Site that could not be asked: ${status.text}`);
    assert.match(status.text, /error connecting to .*\(No such file or directory\)/, `and carries tmux's own words: ${status.text}`);
    assert.doesNotMatch(status.text, /\bgone\b|\bfinished\b/, `and claims nothing about the job: ${status.text}`);

    // The poll goes on asking while the Site is unreadable, and writes nothing while it does.
    clearRemoteCommands();
    await sleep(unreadableHoldMs);
    assert.ok(asksAbout(session) >= unreadableLooks, `the poll asked the site again rather than giving up: ${asksAbout(session)} looks in ${unreadableHoldMs} ms`);
    assert.deepEqual(ledgerShape(host, job.runId), before, 'and nothing at all was written while it could not be told');
    assert.equal(runOf(host, job.runId).status, 'running', 'the run is still running');
    assert.deepEqual(nodeRecords(host, job.runId).filter((r) => r.state === 'blocked'), [], 'and no node is blocked behind a job that is still on the site');

    // The Site comes back, and the generation ends as it would have. Whether the Job was there all
    // along can only be asked once it can be asked at all — which is the whole point: while the
    // socket was away, this test could no more tell than the harness could.
    await tmuxTmp.heal();
    assert.ok(tmuxHasSession(session), 'and the job had been running on the site the whole time');
    const ended = await pending.done;
    for (const line of ended.text.split('\n')) t.diagnostic(line);
    assert.equal(ended.kind, 'success', ended.text);
    assert.equal(runOf(host, job.runId).status, 'ended-budget-exhausted', 'the run reached the end of the generation it was allowed');
    assert.deepEqual(jobRecords(host, job.runId).map((r) => r.event), ['launched', 'finished'], 'one launch, one ending: a Site that could not be asked cost no second job');
    assert.deepEqual(nodeRecords(host, job.runId).filter((r) => r.state === 'blocked' || r.state === 'retrying'), [], 'and no attempt was spent on it');
  } finally {
    await pending?.done.catch(() => undefined);
    await tmuxTmp?.heal();
    if (session) killSession(session);
    if (host) await host.dispose().catch(() => undefined);
    if (h) await h.dispose();
    await tmuxTmp?.restore();
  }
});

test('a socket directory that cannot be entered is a cannot-tell too, and the job is found again when it opens', async () => {
  let tmuxTmp: OwnTmux | undefined;
  let h: HimaHome | undefined;
  let host: InProcessHost | undefined;
  let session = '';
  try {
    tmuxTmp = await ownTmuxTmpdir();
    const home = await localJobHome('sleep 30\n');
    h = home.h;
    host = await bootInProcess(h);
    const launched = await himaCommand(host, h.workspace, `/hima job launch local ${h.workspace} --name slow -- sh ${home.scriptPath}`);
    assert.equal(launched.kind, 'success', launched.text);
    const runId = launched.runId!;
    session = launchedSession(host, runId);
    assert.ok(tmuxHasSession(session), 'the job is running on the site');
    const before = ledgerShape(host, runId);

    await tmuxTmp.closeSocketDir();
    const status = await himaCommand(host, h.workspace, `/hima job status ${runId} ${session}`);
    assert.equal(status.kind, 'error', `the site cannot be asked, so the answer is not one: ${status.text}`);
    assert.match(status.text, /site local/, `the answer names the Site that could not be asked: ${status.text}`);
    assert.match(status.text, /error connecting to .*\(Permission denied\)/, `and carries tmux's own words: ${status.text}`);
    assert.doesNotMatch(status.text, /\bgone\b|\bfinished\b/, `and claims nothing about the job: ${status.text}`);
    assert.deepEqual(ledgerShape(host, runId), before, 'and nothing was written');

    await tmuxTmp.heal();
    const again = await himaCommand(host, h.workspace, `/hima job status ${runId} ${session}`);
    assert.equal(again.kind, 'success', again.text);
    assert.match(again.text, /^running /, `the job was there all along: ${again.text}`);
    assert.deepEqual(ledgerShape(host, runId), before, 'and a job that is merely running still writes nothing');
  } finally {
    await tmuxTmp?.heal();
    if (session) killSession(session);
    if (host) await host.dispose().catch(() => undefined);
    if (h) await h.dispose();
    await tmuxTmp?.restore();
  }
});

test('a probe the site could never run — the command would not start, the command never answered — is a cannot-tell too', async () => {
  // The socket cases are tmux answering; this is the channel itself, which is how an ssh Site
  // ordinarily stops answering. Read as a fault of ours rather than of the Site, it becomes a
  // `blocked` node with a live Job behind it — the outcome this whole rule exists to remove.
  let tmuxTmp: OwnTmux | undefined;
  let shadow: ShadowedTmux | undefined;
  let h: HimaHome | undefined;
  let host: InProcessHost | undefined;
  let session = '';
  try {
    tmuxTmp = await ownTmuxTmpdir();
    const home = await localJobHome('sleep 30\n');
    h = home.h;
    host = await bootInProcess(h);
    const launched = await himaCommand(host, h.workspace, `/hima job launch local ${h.workspace} --name slow -- sh ${home.scriptPath}`);
    assert.equal(launched.kind, 'success', launched.text);
    const runId = launched.runId!;
    session = launchedSession(host, runId);
    const before = ledgerShape(host, runId);
    shadow = await shadowedTmux();

    await shadow.noTmuxAtAll();
    const unstartable = await himaCommand(host, h.workspace, `/hima job status ${runId} ${session}`);
    assert.equal(unstartable.kind, 'error', `a probe that could not be started answers nothing about the job: ${unstartable.text}`);
    assert.match(unstartable.text, /^\/hima job status: /, `and it is answered as a cannot-tell by that face: ${unstartable.text}`);
    assert.match(unstartable.text, /site local/, `naming the Site that could not be asked: ${unstartable.text}`);
    assert.doesNotMatch(unstartable.text, /\bgone\b|\bfinished\b/, `and claiming nothing about the job: ${unstartable.text}`);
    assert.deepEqual(ledgerShape(host, runId), before, 'and nothing was written');

    await shadow.neverAnswers();
    const unanswered = await himaCommand(host, h.workspace, `/hima job status ${runId} ${session}`);
    assert.equal(unanswered.kind, 'error', `a probe that never came back with a status answers nothing either: ${unanswered.text}`);
    assert.match(unanswered.text, /^\/hima job status: /, `and it is the same cannot-tell: ${unanswered.text}`);
    assert.match(unanswered.text, /site local/, `naming the Site: ${unanswered.text}`);
    assert.doesNotMatch(unanswered.text, /\bgone\b|\bfinished\b/, `and claiming nothing: ${unanswered.text}`);
    assert.deepEqual(ledgerShape(host, runId), before, 'and nothing was written for that one either');

    await shadow.restore();
    shadow = undefined;
    const again = await himaCommand(host, h.workspace, `/hima job status ${runId} ${session}`);
    assert.equal(again.kind, 'success', again.text);
    assert.match(again.text, /^running /, `the job was there through both of them: ${again.text}`);
    assert.deepEqual(ledgerShape(host, runId), before, 'and finding it running still writes nothing');
  } finally {
    // The PATH goes back before anything else: the suite's own tmux is on it too, and a test that
    // cannot ask cannot end the session it started.
    await shadow?.restore();
    await tmuxTmp?.heal();
    if (session) killSession(session);
    if (host) await host.dispose().catch(() => undefined);
    if (h) await h.dispose();
    await tmuxTmp?.restore();
  }
});

test('a run whose site cannot be asked is reported site-unreadable at a restart and left exactly as it was', async (t) => {
  // Twenty-five seconds: the host is taken away, the socket removed, a second host booted, and the
  // Job must still be sleeping through all of it.
  let tmuxTmp: OwnTmux | undefined;
  let h: HimaHome | undefined;
  let first: InProcessHost | undefined;
  let second: InProcessHost | undefined;
  let session = '';
  let pending: Pending | undefined;
  try {
    tmuxTmp = await ownTmuxTmpdir();
    const local = await localHome(t, { sleepSeconds: 25 });
    if (!local) return;
    h = local.h;
    first = await bootInProcess(h);
    pending = inBackground(first, h, runLine());
    const job = await launchedJobOf(first);
    session = job.session;
    const before = ledgerShape(first, job.runId);

    // The host goes away mid-Job, as #14's restarts take one away; its drive stops at its next ledger
    // touch, which is what keeps two hosts from ever writing to one ledger at once.
    await first.dispose();
    first = undefined;
    await pending.done;
    assert.ok(tmuxHasSession(session), 'the job outlived its host');
    await tmuxTmp.moveSocketAway();

    second = await bootInProcess(h);
    const reconciled = await second.ctx.hima.reconciled;
    assert.deepEqual(
      reconciled.map((r) => [r.runId, r.found]),
      [[job.runId, 'site-unreadable']],
      `the run was picked up, and its Site could not be asked: ${JSON.stringify(reconciled)}`,
    );
    assert.match(reconciled[0]!.detail, /site local/, `and the reason names the Site: ${reconciled[0]!.detail}`);
    assert.deepEqual(ledgerShape(second, job.runId), before, 'and nothing was written for it');
    assert.equal(runOf(second, job.runId).status, 'running', 'the run keeps the row the ledger had');

    // Put the socket back, and the Job the reconciliation could not ask about is there to be found.
    await tmuxTmp.heal();
    const status = await himaCommand(second, h.workspace, `/hima job status ${job.runId} ${session}`);
    t.diagnostic(status.text);
    assert.equal(status.kind, 'success', status.text);
    assert.match(status.text, /^running /, `the job was running the whole time: ${status.text}`);
  } finally {
    await pending?.done.catch(() => undefined);
    await tmuxTmp?.heal();
    if (session) killSession(session);
    if (first) await first.dispose().catch(() => undefined);
    if (second) await second.dispose().catch(() => undefined);
    if (h) await h.dispose();
    await tmuxTmp?.restore();
  }
});

test('a time box that runs out while the site cannot be asked writes the one blocker this rule adds: the kill did not take, and the run waits', async (t) => {
  // The Budget ending is a write a person must be given, and it is the one write a cannot-tell does
  // not withhold. A nine-second box against twenty-five seconds of stand-in synthesis, with the
  // socket taken away while the Job sleeps: the box runs out with the Site silent, so the stop
  // cannot even be asked for and nothing observed it.
  let tmuxTmp: OwnTmux | undefined;
  let h: HimaHome | undefined;
  let host: InProcessHost | undefined;
  let session = '';
  let pending: Pending | undefined;
  try {
    tmuxTmp = await ownTmuxTmpdir();
    const local = await localHome(t, { sleepSeconds: 25 });
    if (!local) return;
    h = local.h;
    host = await bootInProcess(h);
    pending = inBackground(host, h, `${runLine()} --time-box 0.15`);
    const job = await launchedJobOf(host);
    session = job.session;
    await tmuxTmp.moveSocketAway();

    const ended = await pending.done;
    for (const line of ended.text.split('\n')) t.diagnostic(line);
    assert.equal(ended.kind, 'error', `a run that stopped needing a person is an error: ${ended.text}`);

    const blocked = nodeRecords(host, job.runId).filter((r) => r.state === 'blocked');
    assert.equal(blocked.length, 1, `one blocker, on the node whose job could not be stopped: ${JSON.stringify(blocked)}`);
    assert.equal(blocked[0]!.jobSession, session, 'naming the session a person has to go and look at');
    assert.match(blocked[0]!.reason ?? '', /the kill did not take/, `in the words every unstopped job is written in: ${blocked[0]!.reason}`);
    assert.match(blocked[0]!.reason ?? '', /could not be asked/, `saying the Site could not be asked: ${blocked[0]!.reason}`);
    assert.match(blocked[0]!.reason ?? '', /site local/, `and which Site that is: ${blocked[0]!.reason}`);
    assert.doesNotMatch(blocked[0]!.reason ?? '', /is still there/, `and never that the session was seen, which nobody could observe: ${blocked[0]!.reason}`);
    assert.equal(runOf(host, job.runId).status, 'waiting', 'the run waits for a person rather than claiming a budget ended cleanly');
    assert.deepEqual(jobRecords(host, job.runId).map((r) => r.event), ['launched'], 'and no kill was recorded, because none was seen');

    // And the Job really was still on the Site all along: nothing stopped it, which is what the
    // blocker says and what the person is being sent to deal with.
    await tmuxTmp.heal();
    assert.ok(tmuxHasSession(session), 'the job is still running on the site, exactly as the blocker says');
  } finally {
    await pending?.done.catch(() => undefined);
    await tmuxTmp?.heal();
    if (session) killSession(session);
    if (host) await host.dispose().catch(() => undefined);
    if (h) await h.dispose();
    await tmuxTmp?.restore();
  }
});

test('a run resumed while the site cannot be asked keeps asking instead of being stranded, and carries on when the site answers', async (t) => {
  // Where a resumed act node lands is the claim step, and its slot count asks the Site about every
  // open Job on it — including the resumed node's own earlier launch, which a Job that vanished
  // leaves open for ever because no exit status was ever written for it. So a Run resumed while its
  // Site is silent is the ordinary case, not a corner: raising there would leave the row saying
  // `running` with nothing driving it, and `/hima resume` refuses a `running` Run.
  let tmuxTmp: OwnTmux | undefined;
  let h: HimaHome | undefined;
  let host: InProcessHost | undefined;
  let session = '';
  let pending: Pending | undefined;
  let resuming: Pending | undefined;
  try {
    tmuxTmp = await ownTmuxTmpdir();
    const local = await localHome(t, { sleepSeconds: 10 });
    if (!local) return;
    h = local.h;
    host = await bootInProcess(h);
    pending = inBackground(host, h, `${runLine()} --retries 1 --time-box 5`);
    const job = await launchedJobOf(host);
    session = job.session;

    // The Job vanishes: killed outright, so it writes no exit status and nothing will ever record
    // its end. One attempt, one allowance — the node blocks and the Run waits for a person.
    killSession(session);
    const blocked = await pending.done;
    for (const line of blocked.text.split('\n')) t.diagnostic(line);
    assert.equal(runOf(host, job.runId).status, 'waiting', `the run waits for a person: ${blocked.text}`);
    assert.deepEqual(jobRecords(host, job.runId).map((r) => r.event), ['launched'], 'with a launch nothing ever settled');

    await tmuxTmp.moveSocketAway();
    resuming = inBackground(host, h, `/hima resume ${job.runId}`);
    await waitUntil('the resume put the run back to running', () => runOf(host!, job.runId).status === 'running');
    const before = ledgerShape(host, job.runId);
    clearRemoteCommands();
    await sleep(unreadableHoldMs);

    assert.equal(resuming.answer(), undefined, `the resume is still asking rather than having given the run up: ${resuming.answer()?.text}`);
    assert.ok(asksAbout(session) >= unreadableLooks, `and it asked the site again rather than once: ${asksAbout(session)} looks in ${unreadableHoldMs} ms`);
    assert.deepEqual(ledgerShape(host, job.runId), before, 'nothing at all was written while the site could not be asked');
    assert.equal(runOf(host, job.runId).status, 'running', 'and the run is still the resume\'s to drive');

    // The Site answers again: the vanished Job is finally seen to be gone, its slot is free, and the
    // node gets the attempt the person came back to give it.
    await tmuxTmp.heal();
    const resumed = await resuming.done;
    for (const line of resumed.text.split('\n')) t.diagnostic(line);
    assert.equal(resumed.kind, 'success', resumed.text);
    assert.equal(runOf(host, job.runId).status, 'ended-budget-exhausted', 'the run reached the end of the generation it was allowed');
    assert.deepEqual(jobRecords(host, job.runId).map((r) => r.event), ['launched', 'launched', 'finished'], 'the resume launched exactly one more job');
  } finally {
    await pending?.done.catch(() => undefined);
    await resuming?.done.catch(() => undefined);
    await tmuxTmp?.heal();
    if (host) for (const s of sessionsHere(host)) killSession(s);
    if (host) await host.dispose().catch(() => undefined);
    if (h) await h.dispose();
    await tmuxTmp?.restore();
  }
});

test('a first launch onto a site whose slots cannot be counted is asked again, not blocked: nothing of that run is written until it launches', async (t) => {
  // The other half of the same claim step, and the one with no Job of its own behind it: another
  // Run's Job holds the Site's single slot, and the count that would refuse or allow the launch is
  // what cannot be taken. Nothing of this Run is on the Site, so there is nothing to be blocked
  // behind — and a `blocked` node here would spend an attempt on nobody's evidence.
  let tmuxTmp: OwnTmux | undefined;
  let h: HimaHome | undefined;
  let host: InProcessHost | undefined;
  let holderSession = '';
  let pending: Pending | undefined;
  try {
    tmuxTmp = await ownTmuxTmpdir();
    const local = await localHome(t, { sleepSeconds: 3 });
    if (!local) return;
    h = local.h;
    host = await bootInProcess(h);
    const scriptPath = await writeJobScript(h, 'holder.sh', 'sleep 15\n');
    const holder = await himaCommand(host, h.workspace, `/hima job launch local ${h.workspace} --name holder -- sh ${scriptPath}`);
    assert.equal(holder.kind, 'success', holder.text);
    const holderRunId = holder.runId!;
    holderSession = launchedSession(host, holderRunId);
    assert.ok(tmuxHasSession(holderSession), 'the site\'s one slot is taken by a job that is really running');
    // The holder's own launch asked about this very name to find out that it was free, so the audit
    // is emptied here: what the next wait is for is the *claim step* asking, which is the moment the
    // new Run has got as far as counting the Site and the baseline below is worth taking.
    clearRemoteCommands();

    await tmuxTmp.moveSocketAway();
    pending = inBackground(host, h, runLine());
    await waitUntil('the new run was created', () => host!.ctx.hima.ledger.runs().some((r) => r.id !== holderRunId));
    const runId = host.ctx.hima.ledger.runs().find((r) => r.id !== holderRunId)!.id;
    await waitUntil('its claim step asked the site how many jobs it is running', () => asksAbout(holderSession) >= 1);
    const before = ledgerShape(host, runId);
    clearRemoteCommands();
    await sleep(unreadableHoldMs);

    assert.equal(pending.answer(), undefined, `the run is still asking rather than having been given up: ${pending.answer()?.text}`);
    assert.ok(asksAbout(holderSession) >= unreadableLooks, `and it asked the site again rather than once: ${asksAbout(holderSession)} looks in ${unreadableHoldMs} ms`);
    assert.deepEqual(ledgerShape(host, runId), before, 'nothing at all was written while the cap could not be counted');
    assert.equal(runOf(host, runId).status, 'running', 'and the run is still the command\'s to drive');
    assert.deepEqual(jobRecords(host, runId), [], 'nothing of this run was launched onto a site nobody could count');

    // The Site answers again: the slot is counted, waited for, and then taken.
    await tmuxTmp.heal();
    const ended = await pending.done;
    for (const line of ended.text.split('\n')) t.diagnostic(line);
    assert.equal(ended.kind, 'success', ended.text);
    assert.equal(runOf(host, runId).status, 'ended-budget-exhausted', 'the run reached the end of the generation it was allowed');
    assert.deepEqual(jobRecords(host, runId).map((r) => r.event), ['launched', 'finished'], 'on one job, launched once the site could be counted');
  } finally {
    await pending?.done.catch(() => undefined);
    await tmuxTmp?.heal();
    if (host) for (const s of sessionsHere(host)) killSession(s);
    if (host) await host.dispose().catch(() => undefined);
    if (h) await h.dispose();
    await tmuxTmp?.restore();
  }
});

test('a launch that was sent and never answered is not sent again: the node blocks and the run waits for a person', async (t) => {
  // The other side of the claim step's retry, and the reason that retry is around the count alone.
  // `tmux new-session` may have reached the Site and started the Job before its answer was lost —
  // the ordinary ssh hang — and nothing here can tell that from a launch that never left. Asking
  // again would draw a fresh session name and put a second licence-holding Job on a customer's Site,
  // over the cap and with nothing watching either of them. So the launch is not asked again: the
  // fault is recorded on the node, the Run waits, and a person is told which Site went quiet.
  let tmuxTmp: OwnTmux | undefined;
  let shadow: ShadowedTmux | undefined;
  let h: HimaHome | undefined;
  let host: InProcessHost | undefined;
  let pending: Pending | undefined;
  try {
    tmuxTmp = await ownTmuxTmpdir();
    const local = await localHome(t, { sleepSeconds: 3 });
    if (!local) return;
    h = local.h;
    host = await bootInProcess(h);
    shadow = await shadowedTmux();
    // Every question this Run asks is answered by the real tmux; only the launch dies unheard, so
    // the Run gets all the way to the one command that starts something on the Site.
    await shadow.launchNeverAnswers();
    clearRemoteCommands();

    pending = inBackground(host, h, runLine());
    await waitUntil('the run sent its launch to the site', () => launchesSent() >= 1);
    // Long enough for the claim step to have looked again more than once, had it read a launch whose
    // end it never heard as a count it may take twice.
    await sleep(unreadableHoldMs);
    assert.equal(launchesSent(), 1, `the launch was sent once and never again: ${launchesSent()} launches on the wire in ${unreadableHoldMs} ms`);

    const ended = await pending.done;
    for (const line of ended.text.split('\n')) t.diagnostic(line);
    assert.equal(ended.kind, 'error', `the run stopped where it stood and said so: ${ended.text}`);
    const runs = host.ctx.hima.ledger.runs();
    assert.equal(runs.length, 1, `one run in this home: ${runs.map((r) => r.id).join(', ')}`);
    const runId = runs[0]!.id;
    const nodes = nodeRecords(host, runId);
    assert.equal(nodes.length, 1, `one node record and no more: ${JSON.stringify(nodes.map((r) => `${r.nodeId}/${r.state}`))}`);
    const blocked = nodes[0]!;
    assert.equal(blocked.state, 'blocked', 'and it is the blocker a person is meant to look at');
    assert.equal(blocked.attempt, 1, 'written against the one attempt this node made');
    assert.match(blocked.reason ?? '', /site local/, `naming the site that stopped answering: ${blocked.reason}`);
    assert.match(blocked.reason ?? '', /cannot run tmux/, `and saying the command could not be run: ${blocked.reason}`);
    assert.equal(runOf(host, runId).status, 'waiting', 'the run waits rather than being left running with nothing driving it');
    assert.equal(runOf(host, runId).currentNode, blocked.nodeId, 'and it stands at the node whose launch went unanswered');
    assert.deepEqual(jobRecords(host, runId), [], 'and no job record: nothing came back for one to be written from');
  } finally {
    // The PATH goes back first, as in the other shadow test: the suite's own tmux is on it too. The
    // shadow dies before it reaches the real tmux, so a passing run starts no session at all — and
    // `sessionsHere` stays as the one cleanup shape this file uses, because it is exactly what ends
    // the sessions a regression would launch once the PATH is back and the run is still going.
    await shadow?.restore();
    await pending?.done.catch(() => undefined);
    await tmuxTmp?.heal();
    if (host) for (const s of sessionsHere(host)) killSession(s);
    if (host) await host.dispose().catch(() => undefined);
    if (h) await h.dispose();
    await tmuxTmp?.restore();
  }
});

test('a launch that crossed a cancel and cannot be asked to stop blocks its node and leaves the run waiting, so the next cancel asks again', async (t) => {
  // The last place a Job of this harness could be left on a Site with nothing that would ever ask
  // about it again. A cancel that lands between the permit's decision and the `launched` record ends
  // the Run without seeing the Job, so the loop that made that launch is the only thing that will
  // clean it up — `reconcileRuns` passes over a Run in a final state. When the kill cannot even be
  // asked for, nothing may be written about the Job, because nothing was observed; and nothing may
  // be left silent either. So the node is blocked in the words every unstopped Job is written in,
  // and the Run is moved to `waiting`, which is exactly what the kill-not-taken rule beside it does
  // — and what puts the Run back in reach of `/hima cancel` and of a resume.
  //
  // Driven rather than raced: the shadowed `new-session` holds the launch open for five seconds
  // before it reaches the machine's real tmux, and `kill-session` is the one command that dies
  // unheard. The cancel's own answer says whether it crossed the launch or merely followed it.
  let tmuxTmp: OwnTmux | undefined;
  let shadow: ShadowedTmux | undefined;
  let h: HimaHome | undefined;
  let host: InProcessHost | undefined;
  let pending: Pending | undefined;
  try {
    tmuxTmp = await ownTmuxTmpdir();
    // Twenty seconds of stand-in synthesis: the Job has to be demonstrably still on the Site while
    // the blocker says a person must go and look at it, and while the second cancel stops it.
    const local = await localHome(t, { sleepSeconds: 20 });
    if (!local) return;
    h = local.h;
    host = await bootInProcess(h);
    shadow = await shadowedTmux();
    await shadow.slowLaunchNoKill(crossingWindowSeconds);
    clearRemoteCommands();

    pending = inBackground(host, h, runLine());
    await waitUntil('the run sent its launch to the site', () => launchesSent() >= 1);
    const runs = host.ctx.hima.ledger.runs();
    assert.equal(runs.length, 1, `one run in this home: ${runs.map((r) => r.id).join(', ')}`);
    const runId = runs[0]!.id;
    assert.deepEqual(jobRecords(host, runId), [], 'the launch is on the wire and nothing has recorded it yet: the window this test is about');

    const cancelled = await himaCommand(host, h.workspace, `/hima cancel ${runId}`, siteCommandTimeoutMs);
    for (const line of cancelled.text.split('\n')) t.diagnostic(line);
    assert.equal(cancelled.kind, 'success', cancelled.text);
    assert.match(cancelled.text, /no job of this run was open when the request was read/, `the cancel really crossed the launch rather than following it: ${cancelled.text}`);
    assert.equal(runOf(host, runId).status, 'cancelled', 'and it ended the run, as a cancel that found nothing to stop does');

    // The launch lands. The loop is the only thing that knows about that Job, and the Site will not
    // be asked to stop it.
    const ended = await pending.done;
    for (const line of ended.text.split('\n')) t.diagnostic(line);
    assert.equal(ended.kind, 'error', `a run that stopped needing a person is an error: ${ended.text}`);
    const session = launchedSession(host, runId);

    const nodes = nodeRecords(host, runId);
    const shape = JSON.stringify(nodes.map((r) => [r.state, r.jobSession ?? null]));
    const blocked = nodes.filter((r) => r.state === 'blocked');
    assert.equal(blocked.length, 1, `one blocker, on the node whose crossed launch could not be stopped: ${shape}`);
    assert.equal(blocked[0]!.jobSession, session, `naming the session a person has to go and look at: ${shape}`);
    assert.match(blocked[0]!.reason ?? '', /the kill did not take/, `in the words every unstopped job is written in: ${blocked[0]!.reason}`);
    assert.match(blocked[0]!.reason ?? '', /could not be asked/, `saying the Site could not be asked: ${blocked[0]!.reason}`);
    assert.match(blocked[0]!.reason ?? '', /site local/, `and which Site that is: ${blocked[0]!.reason}`);
    assert.doesNotMatch(blocked[0]!.reason ?? '', /is still there/, `and never that the session was seen, which nobody could observe: ${blocked[0]!.reason}`);
    assert.equal(runOf(host, runId).status, 'waiting', 'the run waits for a person rather than staying ended with a job of its own still on the site');
    assert.equal(recordsOf(host, runId).filter((r) => r.type === 'cancel').length, 1, 'the one cancel a person asked for, and no second request invented here');
    assert.deepEqual(jobRecords(host, runId).map((r) => r.event), ['launched'], 'and no kill was recorded, because none was seen');

    // The Site can be asked again, and the Run is in a state that lets a person ask: `/hima cancel`
    // finds the launch still open, stops it, and sees it stop.
    await shadow.restore();
    shadow = undefined;
    assert.ok(tmuxHasSession(session), 'the job really was still on the site the whole time, exactly as the blocker says');
    const again = await himaCommand(host, h.workspace, `/hima cancel ${runId}`, siteCommandTimeoutMs);
    for (const line of again.text.split('\n')) t.diagnostic(line);
    assert.equal(again.kind, 'success', again.text);
    assert.match(again.text, new RegExp(`stopped its job .* in tmux session ${session}`), `and it stopped the job the first cancel never saw: ${again.text}`);
    assert.equal(runOf(host, runId).status, 'cancelled', 'the run ends the way the person asked');
    assert.deepEqual(jobRecords(host, runId).map((r) => r.event), ['launched', 'killed'], 'with the stop that was finally observed');
    assert.ok(!tmuxHasSession(session), 'and tmux itself says nothing of this run is left on the site');
  } finally {
    // The PATH goes back first, as in the other shadow tests: the suite's own tmux is on it too, and
    // this shadow is the one that will not kill a session.
    await shadow?.restore();
    await pending?.done.catch(() => undefined);
    await tmuxTmp?.heal();
    if (host) for (const s of sessionsHere(host)) killSession(s);
    if (host) await host.dispose().catch(() => undefined);
    if (h) await h.dispose();
    await tmuxTmp?.restore();
  }
});

test('a job that wrote its exit file settles from it even when the socket is gone for good', async () => {
  let tmuxTmp: OwnTmux | undefined;
  let h: HimaHome | undefined;
  let host: InProcessHost | undefined;
  let session = '';
  try {
    tmuxTmp = await ownTmuxTmpdir();
    const home = await localJobHome('exit 7\n');
    h = home.h;
    host = await bootInProcess(h);
    const launched = await himaCommand(host, h.workspace, `/hima job launch local ${h.workspace} --name quick -- sh ${home.scriptPath}`);
    assert.equal(launched.kind, 'success', launched.text);
    const runId = launched.runId!;
    session = launchedSession(host, runId);
    const exitFile = path.join(jobRecords(host, runId)[0]!.job.workspace, `${session}.exit`);
    await waitUntil('the job wrote its exit status', async () => {
      const written = await stat(exitFile).catch(() => undefined);
      return written !== undefined && written.size > 0;
    });

    // The whole socket directory removed, which is what a /tmp cleaner leaves behind on a Site where
    // nothing has run for a while: the session probe could only answer "cannot tell" now.
    await rm(tmuxTmp.socketDir, { recursive: true, force: true });
    const status = await himaCommand(host, h.workspace, `/hima job status ${runId} ${session}`);
    assert.equal(status.kind, 'success', status.text);
    assert.match(status.text, /^finished .*: exit 7/, `the exit file is read before the session is asked about: ${status.text}`);
    assert.deepEqual(jobRecords(host, runId).map((r) => r.event), ['launched', 'finished'], 'and the finished record was written');
    assert.equal(jobRecords(host, runId).find((r) => r.event === 'finished')?.exitCode, 7, 'with the code the launch itself wrote');
  } finally {
    await tmuxTmp?.heal();
    if (session) killSession(session);
    if (host) await host.dispose().catch(() => undefined);
    if (h) await h.dispose();
    await tmuxTmp?.restore();
  }
});

test('a socket directory where tmux has never run is a free session name, and the launch starts the server it will talk to', async () => {
  let tmuxTmp: OwnTmux | undefined;
  let h: HimaHome | undefined;
  let host: InProcessHost | undefined;
  let session = '';
  try {
    tmuxTmp = await ownTmuxTmpdir();
    const home = await localJobHome('sleep 20\n');
    h = home.h;
    // Nothing has ever run under this TMUX_TMPDIR, so the uniqueness probe every launch makes finds
    // no socket at all. That is the one place a missing socket is an answer: the name is free,
    // because `tmux new-session` starts the very server it will then talk to.
    assert.equal(await stat(tmuxTmp.socketDir).catch(() => undefined), undefined, 'tmux has never run here');
    host = await bootInProcess(h);
    const launched = await himaCommand(host, h.workspace, `/hima job launch local ${h.workspace} --name fresh -- sh ${home.scriptPath}`, localCommandTimeoutMs);
    assert.equal(launched.kind, 'success', launched.text);
    session = launchedSession(host, launched.runId!);
    assert.ok(tmuxHasSession(session), 'tmux itself says the job is running under the socket the launch made');
  } finally {
    await tmuxTmp?.heal();
    if (session) killSession(session);
    if (host) await host.dispose().catch(() => undefined);
    if (h) await h.dispose();
    await tmuxTmp?.restore();
  }
});
