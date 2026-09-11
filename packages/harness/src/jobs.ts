// Jobs on a Site: launch a command detached in its own tmux session inside a workspace, and be able
// to say afterwards what became of it. tmux is on the builder's Mac and on the reference site, so one
// mechanism serves both channels and a Job has one identity shape wherever it runs.
//
// The Permit governs the Job's own command — where it may run and which wrapper it may be — and
// refuses before anything is launched. The verbs this file runs to put the Job there and to ask after
// it (`tmux`, `test`, `cat`, `tail`) are HimaChannel's own, audited at the wire like every other
// command and deliberately not the Permit's wrapper set.
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { channelFor, mustRun, quote, type Channel } from './channel.js';
import { loadSite } from './sites.js';
import { decideLaunch } from './shell.js';
import { existingRun, runFor } from './runs.js';
import type { JobIdentity, JobRecord, Ledger, RefusalRecord, RunRecord } from './ledger.js';
import { RunReferenceError, SiteUnreadableError } from './errors.js';

/** What a Job's name defaults to when the caller does not give one. */
const defaultJobName = 'job';

/** How long `kill` waits for the session to actually be gone before saying it is not. */
const killWaitMs = 10_000;
const killPollMs = 100;

/**
 * How often something waiting on a Job asks the Site what became of it, and for how long it asks that
 * often.
 *
 * Each look costs two remote commands (`test -f`, then `tmux has-session`). Asked twice a second,
 * one 150-second opene902 generation is about 600 of them against a channel audit that holds 500 —
 * enough to evict the `tmux new-session` line that is the whole point of the audit. So: half a
 * second for the first five, while a stand-in or a tool that fails at once is likely to end, and
 * three seconds after that, which is a rounding error against two and a half minutes of Design
 * Compiler and cuts that generation to some fifty looks.
 *
 * Stated here, beside the `jobStatus` each look is, because two things wait on this Site by it: a
 * node waiting for its own Job, and a node waiting for one of the Site's job slots to come free.
 *
 * The two intervals are on the bundle's surface because a test that holds a Site unreadable and then
 * asserts the waiter kept asking has to hold it for longer than one of them, and an interval written
 * out again in the test is a number that goes stale the day this one is tuned — the test would then
 * pass while asserting nothing, which is the one failure a test cannot report (#18). How long the
 * fast phase lasts is nobody else's business: a test that holds a Site for two of the *slow*
 * interval has waited long enough whichever phase the waiter is in.
 */
export const jobPollFastMs = 500;
export const jobPollSlowMs = 3_000;
const jobPollFastForMs = 5_000;

/** How long to wait before the next look, given when the waiting began. */
export const pollAfter = (waitingSince: number): number =>
  (Date.now() - waitingSince < jobPollFastForMs ? jobPollFastMs : jobPollSlowMs);

/** How many lines of a Job's log a tail shows when the caller does not say. */
const defaultTailLines = 40;

/** What became of a Job, as the Site answers it right now. `finished` carries the exit code the
 *  launch itself wrote; `gone` is a Job with no session and no exit file — it vanished, and no exit
 *  code is invented for it. A Site that could not be asked is none of the three: there is no state to
 *  report, so `SiteUnreadableError` is raised and nothing is written (#18). */
export type JobState =
  | { readonly state: 'running' }
  | { readonly state: 'finished'; readonly exitCode: number }
  | { readonly state: 'gone' };

/** What a kill did: whether there was a session to stop, and whether it was observed gone afterwards. */
export interface KillOutcome {
  readonly wasRunning: boolean;
  readonly gone: boolean;
}

// ---------------------------------------------------------------------------------------------
// The Site-facing half: tmux, the log, and the exit file.
// ---------------------------------------------------------------------------------------------

// Both Sites this harness reaches are POSIX, and a workspace has already been resolved on the Site it
// belongs to by the time it gets here, so the Job's own paths are joined the POSIX way.
const p = path.posix;

/** Where a launch's output and exit status live: named after its tmux session, never after the Job's
 *  name. A name is the caller's word for a piece of work and may be attempted as often as they like;
 *  the session is one attempt at it. Keying these two files on the name would let a relaunch read the
 *  previous attempt's exit code as its own — `status` asks the exit file what became of *this* launch
 *  — and overwrite the log the previous attempt left to be read. */
const logPath = (job: Pick<JobIdentity, 'workspace' | 'session'>): string => p.join(job.workspace, `${job.session}.log`);
const exitPath = (job: Pick<JobIdentity, 'workspace' | 'session'>): string => p.join(job.workspace, `${job.session}.exit`);

/** tmux matches a `-t` target by prefix unless it is told not to; `=` is how it is told. The Job's
 *  own name is part of the session name and may itself hold dashes, so one session name can still be
 *  a prefix of another: `hima-1234abcd-fit-9f2a10` is a prefix of `hima-1234abcd-fit-9f2a10-b-4c7e33`,
 *  the session of a Job someone named `fit-9f2a10-b`. */
const exactly = (session: string): string => `=${session}`;

/**
 * The one shell line the Site is given to run: the Job's own command with both its streams in the
 * log, and then its exit status in the exit file. The status is written before the shell leaves, so
 * a Job whose session is gone and whose exit file is absent really did vanish — `status` never has to
 * infer an exit code from a session's absence.
 */
function wrapperScript(argv: readonly string[], log: string, exit: string): string {
  return `${argv.map(quote).join(' ')} > ${quote(log)} 2>&1; printf '%s\\n' "$?" > ${quote(exit)}`;
}

/** A tmux session name for this launch: the Run it belongs to, the Job's name, and a suffix drawn at
 *  random, with nothing in it tmux cannot hold (a name may not carry `.` or `:`).
 *
 *  The suffix is random rather than counted because a Job's identity outlives this process. A counter
 *  starts again at one on the next boot, so a restarted harness would offer the Run a session name —
 *  and the log and exit files that carry it — the Run's own history already holds, and `status` finds
 *  a Job in that history by session name. Three bytes are enough for that: the candidate is offered
 *  only against the sessions of one Run on one Site, and each candidate is checked against the Site
 *  before it is used — uniqueness is verified, never assumed. */
function candidateSession(runId: string, name: string): string {
  const run = runId.replace(/^run-/, '').replace(/[^A-Za-z0-9]/g, '').slice(0, 8);
  return `hima-${run}-${tmuxSafe(name)}-${randomBytes(3).toString('hex')}`;
}

/** A Job name as tmux and a file name can both hold it. */
function tmuxSafe(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 32) || defaultJobName;
}

/**
 * A yes-or-no question asked of the Site, where "no" is exit 1 and anything else is nobody's answer.
 * Keeps the job operations fail-closed: an ssh that could not connect exits 255, and that must never
 * read as "no" (#18 — it used to become a `blocked` node with a live Job behind it, the same wrong
 * outcome a misread `has-session` gives).
 *
 * `test -f` is the one probe left on this shape, and it earns it: it is answered by the Site's shell
 * about a file, so its exit 1 says one thing and nothing else. `tmux has-session` does not — four
 * different facts share its exit 1 — which is why it has a probe of its own below.
 */
async function answersYes(on: Channel, argv: readonly string[], what: string): Promise<boolean> {
  const r = await on.exec(argv);
  if (r.code === 0) return true;
  if (r.code === 1) return false;
  throw new SiteUnreadableError(on.siteName, cannotTell(on, what, argv[0] ?? '', r));
}

/**
 * What a Site says about one tmux session, in the three answers tmux actually gives — and it gives
 * all of them as exit 1, which is the whole of ticket #18.
 *
 * - `there`: exit 0. The session is on the Site.
 * - `absent`: the session is over. Two texts mean it. `can't find session: <name>` (tmux 2.x and
 *   later; older tmux prints `session not found: <name>`) is a running server that has no such
 *   session. `no server running on <socket>` is the server having exited — which it does when its
 *   last session ends, **leaving its socket file behind** — so it is the ordinary state of a quiet
 *   Site whose Jobs are all over, and it means every session that Site had is over with them.
 * - `no-socket`: `error connecting to <socket> (No such file or directory)`. The socket path is not
 *   there at all: a Site where tmux has never run since the socket directory was made, or one whose
 *   socket a `/tmp` cleaner removed from under a living server. This is not an answer about a
 *   session, and the two callers read it in the two opposite ways their own question demands.
 *
 * Everything else raises `SiteUnreadableError` and nothing is written: a socket that cannot be
 * entered (`(Permission denied)`), a path over the ~100-character unix socket limit (`(File name too
 * long)`), an exit 1 with no text at all, and every exit code that is not 0 or 1 — an ssh that could
 * not connect exits 255. A Job may be running under a server nobody can reach, and no outcome is
 * invented for one.
 */
type SessionProbe =
  | { readonly answer: 'there' }
  | { readonly answer: 'absent' }
  /** tmux's own words, carried so the caller that treats this as cannot-tell can say them. */
  | { readonly answer: 'no-socket'; readonly said: string };

/** The two texts tmux gives for a session that is over: no such session, and no server at all. */
const saysNoSession = (said: string): boolean =>
  said.includes("can't find session") || said.includes('session not found') || said.includes('no server running on');

/** The one text tmux gives for a socket path that is not there. Deliberately narrower than every
 *  `error connecting to`: a socket that exists and cannot be entered is a Site that cannot be asked,
 *  not a Site with no socket. */
const saysNoSocket = (said: string): boolean =>
  said.includes('error connecting to') && said.includes('(No such file or directory)');

/** What could not be told, with the Site's name and the far end's own words on it. */
function cannotTell(on: Channel, what: string, verb: string, r: { code: number; stderr: string }): string {
  const said = r.stderr.trim();
  return `cannot tell ${what} on site ${on.siteName}: ${verb} exited ${r.code}${said ? `: ${said}` : ''}`;
}

async function sessionProbe(on: Channel, session: string): Promise<SessionProbe> {
  const r = await on.exec(['tmux', 'has-session', '-t', exactly(session)]);
  if (r.code === 0) return { answer: 'there' };
  const said = r.stderr.trim();
  if (r.code === 1 && saysNoSession(said)) return { answer: 'absent' };
  if (r.code === 1 && saysNoSocket(said)) return { answer: 'no-socket', said };
  throw new SiteUnreadableError(on.siteName, cannotTell(on, `whether tmux session ${session} is there`, 'tmux', r));
}

/**
 * Is this session on the Site — asked about a Job that has already been launched, where a socket that
 * is not there is *not* an answer (#18). The Job may be alive under a server nobody can reach, so a
 * `no-socket` raises here exactly as an unreadable socket does, and nothing is written.
 *
 * The launch's own uniqueness check is the one caller that reads `no-socket` the other way, and says
 * so where it asks.
 */
async function sessionThere(on: Channel, session: string): Promise<boolean> {
  const probe = await sessionProbe(on, session);
  if (probe.answer === 'no-socket') {
    throw new SiteUnreadableError(
      on.siteName,
      `cannot tell whether tmux session ${session} is there on site ${on.siteName}: ${probe.said}. The job may still be running under a tmux server nothing can reach, so nothing is claimed about it`,
    );
  }
  return probe.answer === 'there';
}

const exitFileExists = (on: Channel, job: JobIdentity): Promise<boolean> =>
  answersYes(on, ['test', '-f', exitPath(job)], `whether job "${job.name}" wrote its exit file`);

/**
 * Launch one command detached on a Site and return who it is.
 *
 * @param on - the channel to the Site.
 * @param req - the Run the Job belongs to, the workspace the Permit resolved, the command, and the name.
 * @returns the Job's identity, including the pane pid tmux reported for it.
 */
async function launchInSession(
  on: Channel,
  req: { readonly runId: string; readonly workspace: string; readonly argv: readonly string[]; readonly name: string },
): Promise<JobIdentity> {
  const { workspace, name } = req;
  // The session is chosen first because the log and the exit file are named after it: this launch's
  // output and this launch's exit status, belonging to no other attempt at the same Job.
  let session = '';
  for (let attempt = 0; attempt < 20 && session === ''; attempt += 1) {
    const candidate = candidateSession(req.runId, name);
    // Ticket #18: the one caller for which a socket that is not there is an answer, and the answer is
    // "this name is free". `tmux new-session` below starts the very server it will then talk to, so a
    // Site where tmux has never run holds no session of any name — while every question asked *after*
    // a launch reads the same missing socket as "cannot tell", because by then a server that cannot
    // be reached may be holding the Job.
    if ((await sessionProbe(on, candidate)).answer !== 'there') session = candidate;
  }
  if (session === '') throw new Error(`no free tmux session name for job "${name}" of ${req.runId} on this site`);
  const wire = wrapperScript(req.argv, logPath({ workspace, session }), exitPath({ workspace, session }));
  const startedAt = new Date().toISOString();
  // `-P -F` prints the new session's pane pid as the launch itself answers, rather than asking for it
  // in a second command: a Job that finishes in milliseconds would already be gone by then, and a Job
  // with no identity could never be found again.
  const printed = await mustRun(
    on,
    ['tmux', 'new-session', '-d', '-P', '-F', '#{pane_pid}', '-s', session, '-c', workspace, '/bin/sh', '-c', wire],
    `launch job "${name}" in ${workspace}`,
  );
  const pid = Number(printed.trim());
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error(`tmux launched job "${name}" as session ${session} but reported "${printed.trim()}" as its pane pid, not a process id`);
  }
  return { session, pid, workspace, name, startedAt, wire };
}

/**
 * What became of a Job right now. The exit file is asked about first and, when the session turns out
 * to be gone, asked about once more: the launch writes the status just before its shell leaves, so a
 * status that was not there at the first look and a session that ended between the two questions is
 * a Job that finished, not one that vanished. Only after both looks is a Job gone.
 *
 * The exit file being *first* is also what settles a Job on a Site whose socket is gone for good
 * (#18): a present exit file is this Job's own ending, written by the launch itself, and it decides
 * whatever the session probe would have said — the probe is never even asked. Absent, the probe
 * decides: there is running, absent is gone, and a Site that cannot be asked raises rather than
 * answering either.
 */
async function jobState(on: Channel, job: JobIdentity): Promise<JobState> {
  const finished = await finishedState(on, job);
  if (finished) return finished;
  if (await sessionThere(on, job.session)) return { state: 'running' };
  return (await finishedState(on, job)) ?? { state: 'gone' };
}

/**
 * `finished` with the status the launch wrote, or undefined when it has not written one. The
 * redirect creates the exit file an instant before the status lands in it, so a file that is there
 * but still empty is a Job that has not finished — never an exit code of zero.
 */
async function finishedState(on: Channel, job: JobIdentity): Promise<JobState | undefined> {
  if (!(await exitFileExists(on, job))) return undefined;
  const text = (await mustRun(on, ['cat', '--', exitPath(job)], `read the exit status of job "${job.name}"`)).trim();
  if (text === '') return undefined;
  const exitCode = Number(text);
  if (!Number.isInteger(exitCode)) {
    throw new Error(`the exit file of job "${job.name}" holds ${JSON.stringify(text)}, which is not an exit status`);
  }
  return { state: 'finished', exitCode };
}

/** The last `lines` lines of a Job's log, as the Site holds it. */
async function tailLog(on: Channel, job: JobIdentity, lines: number): Promise<string> {
  return mustRun(on, ['tail', '-n', String(lines), '--', logPath(job)], `tail the log of job "${job.name}" (${logPath(job)})`);
}

/**
 * Stop a Job and wait until its session is observed gone. Never throws for a Job that is already
 * gone: that is an answer, not a fault. A kill that does not take within the bounded wait says so
 * rather than claiming a stop nobody saw.
 */
async function killSession(on: Channel, job: JobIdentity): Promise<KillOutcome> {
  // Ticket #18: a Site that cannot be asked raises out of here rather than answering. There is no
  // outcome to report — nothing was seen to stop and nothing was seen to be already over — and a
  // `killed` record written on a guess would say a licence was released while dc_shell still holds it.
  if (!(await sessionThere(on, job.session))) return { wasRunning: false, gone: true };
  // Exit 1 is tmux saying the session went away between the question and the kill — the outcome the
  // caller wanted, reached without us. Anything else is a fault.
  const killed = await on.exec(['tmux', 'kill-session', '-t', exactly(job.session)]);
  if (killed.code !== 0 && killed.code !== 1) {
    const said = killed.stderr.trim();
    throw new Error(`cannot kill job "${job.name}" (session ${job.session}): tmux exited ${killed.code}${said ? `: ${said}` : ''}`);
  }
  const deadline = Date.now() + killWaitMs;
  for (;;) {
    if (!(await sessionThere(on, job.session))) return { wasRunning: true, gone: true };
    if (Date.now() >= deadline) return { wasRunning: true, gone: false };
    await new Promise((r) => setTimeout(r, killPollMs));
  }
}

// ---------------------------------------------------------------------------------------------
// The operations: site → run → permit → channel → tmux → ledger. One path, every layer, as observe.
// ---------------------------------------------------------------------------------------------

export interface JobDeps { readonly ledger: Ledger; readonly sitesDir: string }

export interface LaunchRequest {
  readonly site: string;
  readonly workspace: string;
  readonly argv: readonly string[];
  readonly name?: string;
  /** An existing Run to launch inside. Absent, the launch opens a Run of its own, as observe does. */
  readonly run?: string;
  /**
   * The fabric node this Job belongs to, when a fabric launched it. Carried onto every record of
   * this Job — launched, finished, killed — so the Job's whole history says which node it was an
   * attempt at, and a later process can pair the two without holding either. A Job launched from the
   * `/hima job` face carries none: it belongs to no node.
   */
  readonly nodeId?: string;
  /**
   * How many seats of each licence this Job holds while it runs, from the declaration the pack's
   * contract makes of the tool being run. Recorded on the `launched` record, which is what the
   * Site's licence counts are counted over and what the Run's licence meters are computed from.
   *
   * Absent, or empty, for a Job that holds none: a `/hima job launch` runs a command line a person
   * typed, which no contract describes and which therefore reserves nothing.
   */
  readonly licences?: Readonly<Record<string, number>>;
  /**
   * The branch of a fork this Job was launched inside, when a fork launched it (#29). Carried onto
   * every record of this Job — launched, finished, killed — exactly as `nodeId` is, so a Job's whole
   * history says which branch it belonged to and a face reading a fork can group a Run's Jobs by
   * branch without pairing them with node records first. A Job launched outside every fork carries
   * none.
   */
  readonly branchId?: string;
}

export type LaunchResult =
  | { readonly kind: 'launched'; readonly run: RunRecord; readonly record: JobRecord }
  | { readonly kind: 'refused'; readonly run: RunRecord; readonly record: RefusalRecord };

/** Launch a Job under the Site's Permit and record it. A refusal is a record, never a silent no. */
export async function launchJob(deps: JobDeps, req: LaunchRequest): Promise<LaunchResult> {
  const site = loadSite(deps.sitesDir, req.site);
  const run = await runFor(deps.ledger, site, req.run);
  const name = tmuxSafe(req.name ?? defaultJobName);
  // One channel for the whole operation: the permit decision resolves the workspace where it lives,
  // then the same warm channel launches into it.
  const channel = channelFor(site);
  const decision = await decideLaunch(site, req.workspace, req.argv, channel);
  if (!decision.ok) {
    return { kind: 'refused', run, record: await deps.ledger.appendRefusal(run.id, { path: decision.refused, reason: decision.reason }) };
  }
  const job = await launchInSession(channel, { runId: run.id, workspace: decision.workspace, argv: req.argv, name });
  // An absent key, never an undefined one: a Job belonging to no node, or holding no licence of the
  // Site, says so by omission.
  const belongs = req.nodeId === undefined ? {} : { nodeId: req.nodeId };
  const inBranch = req.branchId === undefined ? {} : { branchId: req.branchId };
  const holds = req.licences === undefined || Object.keys(req.licences).length === 0 ? {} : { licences: { ...req.licences } };
  return { kind: 'launched', run, record: await deps.ledger.appendJob(run.id, { event: 'launched', job, ...belongs, ...inBranch, ...holds }) };
}

export interface JobStatusResult {
  readonly run: RunRecord;
  /** The Job the Run launched under this session name, or undefined when it launched none. */
  readonly job: JobIdentity | undefined;
  readonly state: JobState;
  /** The finished record this observation wrote, when it was the first to see the Job end. */
  readonly record: JobRecord | undefined;
}

/**
 * What became of a Job the Run launched. The first observation of a finished Job writes its finished
 * record, with the exit code from the exit file; later ones only report. A session the Run never
 * launched is `gone`: the ledger knows of no such Job, and nothing about it can be asked of the Site
 * without the workspace its identity would have named.
 */
export async function jobStatus(deps: JobDeps, req: { readonly run: string; readonly session: string }): Promise<JobStatusResult> {
  const run = existingRun(deps.ledger, req.run);
  const job = launchedJob(deps, run, req.session);
  if (!job) return { run, job: undefined, state: { state: 'gone' }, record: undefined };
  const site = loadSite(deps.sitesDir, run.siteId);
  const state = await jobState(channelFor(site), job);
  if (state.state !== 'finished' || recorded(deps, run, req.session, 'finished')) {
    return { run, job, state, record: undefined };
  }
  return { run, job, state, record: await deps.ledger.appendJob(run.id, { event: 'finished', job, exitCode: state.exitCode, ...belongsTo(deps, run, req.session) }) };
}

/**
 * Is the tmux session a Job was launched into still on the Site?
 *
 * The narrowest question there is about a Job, and the only one worth asking about a launch that will
 * never write another record of its own: no exit file is read and nothing is appended, so a caller
 * that only wants to know whether something of this Run is still on the Site does not have to move
 * the Run's history to find out. `jobStatus` is the question to ask about a Job whose ending is still
 * to be settled — it reads the exit file the launch wrote and records what it finds.
 *
 * A Job this Run never launched is not this Run's to ask about, and is answered `false`: the ledger
 * knows of no such session, and the workspace its identity would have named is what a Site question
 * would need. A Site that cannot be asked throws, exactly as every other job operation does — nothing
 * here turns "the site did not answer" into "the job is gone".
 *
 * @param deps - the ledger and where sites are installed.
 * @param req - the Run the Job belongs to and the tmux session it was launched into.
 * @returns whether the Site still has that session.
 * @throws RunReferenceError when the ledger holds no such Run.
 * @throws SiteUnreadableError when the Site could not be asked (#18).
 */
export async function jobSessionThere(deps: JobDeps, req: { readonly run: string; readonly session: string }): Promise<boolean> {
  const run = existingRun(deps.ledger, req.run);
  const job = launchedJob(deps, run, req.session);
  if (!job) return false;
  return sessionThere(channelFor(loadSite(deps.sitesDir, run.siteId)), job.session);
}

export interface JobTailResult { readonly run: RunRecord; readonly job: JobIdentity; readonly text: string }

/** The last lines of a Job's log, read from the Site. */
export async function jobTail(deps: JobDeps, req: { readonly run: string; readonly session: string; readonly lines?: number }): Promise<JobTailResult> {
  const run = existingRun(deps.ledger, req.run);
  const job = mustBeLaunched(deps, run, req.session);
  const site = loadSite(deps.sitesDir, run.siteId);
  return { run, job, text: await tailLog(channelFor(site), job, req.lines ?? defaultTailLines) };
}

export interface JobKillResult {
  readonly run: RunRecord;
  readonly job: JobIdentity;
  readonly outcome: KillOutcome;
  /** The killed record this kill wrote, when it was the one that stopped a running Job. */
  readonly record: JobRecord | undefined;
}

/**
 * Stop a Job and record the stop that was observed. The record is written only when this kill both
 * found a session and saw it go: a Job that was already gone is answered, not recorded again, and a
 * kill that did not take within the bounded wait records nothing at all.
 */
export async function jobKill(deps: JobDeps, req: { readonly run: string; readonly session: string }): Promise<JobKillResult> {
  const run = existingRun(deps.ledger, req.run);
  const job = mustBeLaunched(deps, run, req.session);
  const site = loadSite(deps.sitesDir, run.siteId);
  const outcome = await killSession(channelFor(site), job);
  if (!outcome.wasRunning || !outcome.gone) return { run, job, outcome, record: undefined };
  return { run, job, outcome, record: await deps.ledger.appendJob(run.id, { event: 'killed', job, ...belongsTo(deps, run, req.session) }) };
}

/** What the Run recorded when it launched this session, if it launched it at all. */
function launchedRecord(deps: JobDeps, run: RunRecord, session: string): JobRecord | undefined {
  return jobsOf(deps, run).findLast((r) => r.event === 'launched' && r.job.session === session);
}

/** The identity the Run recorded when it launched this session, if it launched it at all. */
function launchedJob(deps: JobDeps, run: RunRecord, session: string): JobIdentity | undefined {
  return launchedRecord(deps, run, session)?.job;
}

function mustBeLaunched(deps: JobDeps, run: RunRecord, session: string): JobIdentity {
  const job = launchedJob(deps, run, session);
  if (!job) throw new RunReferenceError(`run ${run.id} launched no job in tmux session "${session}"`);
  return job;
}

/**
 * Where this Job's launch said it belongs — the fabric node, and the branch of a fork (#29) — as an
 * object to spread onto a later record of the same Job. An absent key, never an undefined one, so a
 * Job that belongs to no node, or to no branch, says so by omission on every one of its records and
 * not only on the launch.
 *
 * Read back off the launch rather than passed in, because the two callers that write a Job's later
 * records — the poll that sees it finish, the kill that stops it — know a session and nothing else.
 * A Job belongs where it was launched, and that is on record.
 */
function belongsTo(deps: JobDeps, run: RunRecord, session: string): { nodeId?: string; branchId?: string } {
  const launch = launchedRecord(deps, run, session);
  const nodeId = launch?.nodeId === undefined ? {} : { nodeId: launch.nodeId };
  return launch?.branchId === undefined ? nodeId : { ...nodeId, branchId: launch.branchId };
}

/** Has this Run already recorded that event for this session? Keeps a repeated look from writing a
 *  second record of something that happened once. */
function recorded(deps: JobDeps, run: RunRecord, session: string, event: JobRecord['event']): boolean {
  return jobsOf(deps, run).some((r) => r.event === event && r.job.session === session);
}

function jobsOf(deps: JobDeps, run: RunRecord): JobRecord[] {
  return deps.ledger.records({ runId: run.id, type: 'job' }).filter((r): r is JobRecord => r.type === 'job');
}
