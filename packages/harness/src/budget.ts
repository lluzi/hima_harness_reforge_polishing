// The Budget: what one Run may spend, and the ending spending it all causes. One reason to change:
// what a Run is allowed — the time box, the time a person is not charged for, the Retry allowance —
// and how what it has spent is counted, in time and in the Site's licence seats. (The bound on those
// seats is the job cap's, beside the other scarcity of the Site; what a Run held of them is here,
// with every other meter.)
//
// Agent-owned Runs keep charging their total time box while paused. Historical human waits retain
// their old allowance only through a fixed adoption offset; subsequent pauses do not enlarge it. Every
// number here is computed from what the ledger already holds and never from a driving process's
// memory, which is what lets a second host pick a Run up and compute the same deadline, the same
// attempt number and the same allowance the first one would have.
import { nodeRecordsIn, givesUpLaunch } from './ledger.js';
import type { LedgerRecord, Ledger, MeterCount, NodeRecord, RunLoop, RunMeters, RunProgress, RunRecord, RunStatus } from './ledger.js';
import { existingRun } from './runs.js';

/** How long a Run may take when nobody says: an hour, well past the two and a half minutes one
 *  opene902 generation costs on the reference Site, and short enough that a stuck Job cannot hold a
 *  licence overnight. */
export const defaultTimeBoxMs = 60 * 60_000;

/** How many attempts a node may make before its failure is a Hard blocker (CONTEXT.md). */
export const defaultRetryAllowance = 3;

/**
 * How many Generations a Campaign may open when neither the person who started it nor the pack says:
 * six. Enough for a push chooser to walk in from a first guess and converge — the reference pack's
 * own Loop converges in three on the stand-in — and few enough that a pack with no convergence
 * declared cannot spend a night of licensed synthesis discovering that.
 *
 * The pack's own `converge.generationLimit` is what usually decides, and a person's `--generations`
 * before that; this is the floor under both, so a Loop is always bounded by something.
 */
export const defaultGenerationLimit = 6;

/**
 * When the original time box runs out. Owned Runs retain only the historical wait allowance
 * verified at adoption; new pauses keep counting. Unowned regression Runs use their old wait term.
 * `undefined` for a Run with no Budget, which spends nothing.
 *
 * **The deadline, stated once.** Everything that asks whether a Run may go on asks it here — the loop
 * at the top of every turn, the poll waiting on a Job, the wait for one of the Site's job slots, and
 * the resume deciding whether re-entering a Run could only end it — because a Run held to two
 * different deadlines by two of those is a Run whose Budget means nothing.
 */
const deadlineOf = (run: RunRecord, waitedMs: number): number | undefined =>
  run.budget === undefined ? undefined : Date.parse(run.createdAt) + run.budget.timeBoxMs
    + (run.control === undefined ? waitedMs : run.control.adoption?.legacyWaitedMs ?? 0);

/** Remaining wall time uses the same deadline as admission and Job polling. */
export const timeBoxRemainingMs = (run: RunRecord, waitedMs: number): number | undefined => {
  const deadline = deadlineOf(run, waitedMs);
  return deadline === undefined ? undefined : Math.max(0, deadline - Date.now());
};

/** Had this Run's time box been spent at that moment? What the resume asks about the moment the Run
 *  stopped, which is the last moment it was actually running. */
export function timeBoxSpentAt(run: RunRecord, waitedMs: number, at: number): boolean {
  const deadline = deadlineOf(run, waitedMs);
  return deadline !== undefined && at >= deadline;
}

/** Has this Run's time box been spent by now? What every turn of the loop asks. */
export const timeBoxSpent = (run: RunRecord, waitedMs: number): boolean => timeBoxSpentAt(run, waitedMs, Date.now());

/**
 * How long this Run has spent waiting on a person, in milliseconds, read from its records alone: for
 * each resume, the time from the Hard blocker it cleared.
 *
 * The Budget meters the design and the EDA environment, never the person (CONTEXT.md, Budget; a Hard
 * blocker is by definition a failure only a person can clear). A node that blocks at minute five of
 * an hour's box and is cleared the next morning has spent five minutes of that box, not a night —
 * nothing of the design was running in between, and nothing of the Site was held. So the deadline is
 * `createdAt + timeBoxMs + waitedMs`, and this is that second term.
 *
 * A blocker with no resume after it is a wait still open and counts nothing yet: nothing runs while
 * it stands, so nothing is being charged, and the resume that closes it is what makes it count. Each
 * resume is paired with the last blocker written since the previous resume, which is the same pair
 * `resumeRun` itself re-enters a Run on, so the two can never disagree about which wait was which.
 */
export function waitedMsOf(ledger: Ledger, runId: string): number {
  const records = ledger.records({ runId });
  let waited = 0;
  let since = 0;
  for (const resumed of records) {
    if (resumed.type !== 'resumed') continue;
    const blocker = records.findLast((r) => r.type === 'blocker' && r.seq > since && r.seq < resumed.seq);
    since = resumed.seq;
    if (blocker) waited += Math.max(0, Date.parse(resumed.at) - Date.parse(blocker.at));
  }
  return waited;
}

/**
 * What this Run has held of each licence, in licence-milliseconds, read from its records alone: for
 * every Job it launched that has since been settled, the seats that Job's `launched` record says it
 * held, times the time from that launch to the first record that settled it.
 *
 * **A Job holds its seats for exactly as long as its launch is open**, which is the same rule the
 * job cap counts by (`launchIsOpen`), read in time rather than in the present tense. What settles a
 * launch is the Job's own `finished` or `killed` record — both written from something observed on
 * the Site — or, for a Job that ended with no record of its own, the node record by which the Run
 * gave up on it: a `retrying`, `blocked` or `cancelled` naming its session. The earliest of those is
 * when the seat stopped being this Run's, because the Site cannot be asked afterwards what it
 * released and when.
 *
 * A launch nothing has settled yet counts nothing. A meter is a fact about what has happened, and a
 * Job still running has not yet held its seats for any final length of time — the meter advances
 * when the Job settles, exactly as `jobsLaunched` advances when one is launched.
 *
 * Computed here rather than accumulated anywhere, as every number a Run carries is, so that a second
 * host picking this Run up reaches the same total the first would have. Module-private: the meters
 * are how a Run's spending is read, and a face that computed its own would be a second answer.
 */
function licenceMsOf(ledger: Ledger, runId: string): Record<string, number> {
  const records = ledger.records({ runId });
  const held: Record<string, number> = {};
  for (const launch of records) {
    if (launch.type !== 'job' || launch.event !== 'launched' || launch.licences === undefined) continue;
    const session = launch.job.session;
    const settled = records.find(
      (r) =>
        r.seq > launch.seq &&
        ((r.type === 'job' && r.event !== 'launched' && r.job.session === session) ||
          (r.type === 'node' && r.jobSession === session && givesUpLaunch(r))),
    );
    if (!settled) continue;
    const ms = Math.max(0, Date.parse(settled.at) - Date.parse(launch.at));
    for (const [name, seats] of Object.entries(launch.licences)) held[name] = (held[name] ?? 0) + seats * ms;
  }
  return held;
}

/**
 * How long each Generation of this Run's Loop has taken, in milliseconds, oldest first, read from
 * its records alone: for each generation the row says it has opened, the span from that generation's
 * first record to its last — and to now for the generation a Run that is still moving is in, which
 * is the only generation whose last record is not its last word.
 *
 * Whether the Run is still moving is decided by the status the write being composed *leaves* it in,
 * not by the one the row still says: the write that ends a Run is the moment its last generation
 * stops, and taking the row's own status there would have that generation go on growing on every
 * later write.
 *
 * **These are the outer Loop's generations**, which is what the run row's own `generation` counts,
 * and one of them spans every record written while it was the outer generation — the records a
 * drill-down Loop wrote inside it included (#28). A record written inside a Loop carries *that
 * Loop's* generation in its header and not the Campaign's, so grouping by the header alone would
 * file a Loop's third generation under the Campaign's third: a pack that both revisits its outer
 * graph and drills down would have an outer generation start at a record written while a different
 * one was under way. The Loop's `opened` record is what says which outer generation the whole block
 * belongs to — it is written before the Run moves into the Loop, so its own header carries the outer
 * generation — and every record carrying that loop id is read against it.
 *
 * `wallMsOf` in `generations.ts` folds the run view's outer row from the other side, and the two are
 * kept to that one rule between them: the table's outer row spans the *outer graph's own* records,
 * because a Loop's turns are shown as their own nested rows and folding them into the row above
 * would say the same time twice. For every Loop that closed the two say one number all the same —
 * closing a Loop puts the Explore node's `done` record on the outer graph after it, so the Loop lies
 * inside that span too. They part on a Run stopped inside a Loop, where this meter reaches the stop
 * and the table's row stops at the last step the outer graph itself took, which is what each of them
 * is for: where the Campaign's time went, and where its own graph got to.
 *
 * This is wall time and counts a wait on a person, exactly as `elapsedMs` does; `waitedMs` beside it
 * is what says how much of the Campaign was one. The Budget does not meter the person — that is what
 * widens the *deadline* (`deadlineOf`) — and a meter that quietly subtracted the wait here would be
 * a generation's clock disagreeing with the Campaign's.
 *
 * Computed here rather than accumulated anywhere, as every number a Run carries is, so that a second
 * host picking this Run up reaches the same list the first would have.
 *
 * @param ledger - where the Run's row and its records are read from.
 * @param runId - the Run.
 * @param leftIn - the status this write leaves the Run in.
 * @param now - the instant this write is being composed at; one instant for the whole list.
 * @returns one entry per generation the row has opened, or an empty list for a Run in none.
 */
function generationMsOf(ledger: Ledger, runId: string, leftIn: RunStatus | undefined, now: number): number[] {
  const opened = existingRun(ledger, runId).generation;
  if (opened === undefined) return [];
  const records = ledger.records({ runId });
  // Which outer generation each drill-down Loop was opened in, so the records inside it are counted
  // against that one rather than against the Campaign's generation of the same number.
  const openedIn = new Map<string, number>();
  for (const record of records) {
    if (record.type === 'loop' && record.event === 'opened' && record.generation !== undefined) openedIn.set(record.loopId, record.generation);
  }
  const byGeneration = new Map<number, LedgerRecord[]>();
  for (const record of records) {
    const generation = record.loopId === undefined ? record.generation : openedIn.get(record.loopId);
    if (generation === undefined) continue;
    const held = byGeneration.get(generation);
    if (held === undefined) byGeneration.set(generation, [record]);
    else held.push(record);
  }
  const spans: number[] = [];
  for (let generation = 1; generation <= opened; generation += 1) {
    const own = byGeneration.get(generation) ?? [];
    const first = own[0];
    const last = own[own.length - 1];
    // A generation the Loop has just opened and nothing has written in yet has taken no time, which
    // is a fact and not a gap: it is a row of this list all the same, so no later generation's time
    // is read against the wrong index.
    if (first === undefined || last === undefined) { spans.push(0); continue; }
    const until = generation === opened && leftIn === 'running' ? now : Date.parse(last.at);
    spans.push(Math.max(0, Math.round(until - Date.parse(first.at))));
  }
  return spans;
}

export interface MeterDelta extends MeterCount { readonly endedBy?: RunMeters['endedBy'] }

/**
 * Move the Run on: the meters as they now stand, plus whatever else changed.
 *
 * The run row is re-read here rather than passed in, because everything above has been writing
 * records and meters of its own, and a stale copy would silently undo them. Every path that moves a
 * Run goes through this — a turn of the loop, the fault before a Run's first node, the cancel that
 * ends it, the reconciliation that hands it to a person — because the meters are the Budget's
 * account of the Run and there may be only one of those.
 *
 * What this composes and what it hands on are two different kinds of number (#29). The elapsed time,
 * the wait, the licence seconds and the per-generation times are *whole meters*, recomputed here from
 * what the ledger holds, so a second host reaches the same numbers and a write that lands second
 * cannot roll one back (`movedOn` takes the further answer). `jobs` and `attempts` are *counts of
 * things that happened once*, and they are deliberately **not** composed here: a fork's two branches
 * each launch a Job and each count it, and two callers that read `held` and wrote `held + 1` would
 * lose an increment however carefully the writes were serialised. They travel as `count` and are
 * added to the row inside `advanceRun`'s own update, where the row being added to is the row being
 * written.
 */
export async function advance(ledger: Ledger, runId: string, delta: MeterDelta, more: RunProgress = {}): Promise<RunRecord> {
  const run = existingRun(ledger, runId);
  const held = run.meters ?? { elapsedMs: 0, jobsLaunched: 0, attempts: 0 };
  // One instant for the whole write, so the elapsed time and the generation this Run is in are not
  // measured against two of them.
  const now = Date.now();
  const meters: RunMeters = {
    elapsedMs: Math.max(0, Math.round(now - Date.parse(run.createdAt))),
    // As read, never as added to: the delta below is what adds, inside the one write.
    jobsLaunched: held.jobsLaunched,
    attempts: held.attempts,
  };
  // An absent key, never an undefined one: a Run no meter ended, and one that has waited on nobody,
  // each say so by omission. `waitedMs` is how much of `elapsedMs` was a person being asked, and is
  // the term the time box is widened by — the one number that lets a person read a Run's elapsed
  // time and its deadline off the same record.
  //
  // Read back out of the records here rather than taken from a drive's fixed term, for the same
  // reason the run row is: the cancel and the reconciliation write meters too and hold no drive, and
  // taking it from a drive's term would have those two write the wait away. The two can never
  // disagree — only a resume closes a wait, and a resume is what starts a drive — so this is the
  // drive's own deadline term, computed where every other number a Run carries is.
  const waited = Math.max(waitedMsOf(ledger, runId), run.control?.adoption?.legacyWaitedMs ?? 0);
  const withWait = waited === 0 ? meters : { ...meters, waitedMs: waited };
  // Read out of the records for the same reason `waitedMs` is, and it matters more here: the cancel
  // and the reconciliation write meters too, and neither of them holds a drive that could have been
  // counting seats. A Run whose Jobs held nothing carries no key at all.
  const licences = licenceMsOf(ledger, runId);
  const withLicences = Object.keys(licences).length === 0 ? withWait : { ...withWait, licenceMs: licences };
  // Where the elapsed time actually went, read back out of the records for the reason the two above
  // are: the cancel and the reconciliation write meters too and hold no drive that could have been
  // timing a generation. The status this write leaves the Run in decides whether the generation it
  // is in is still running, which is why `more` is read here rather than the row alone.
  const generations = generationMsOf(ledger, runId, more.status ?? run.status, now);
  const withGenerations = generations.length === 0 ? withLicences : { ...withLicences, generationMs: generations };
  const withMeter = delta.endedBy === undefined ? withGenerations : { ...withGenerations, endedBy: delta.endedBy };
  // An absent key, never an undefined one: a write that counts nothing says so by omission.
  const counting = delta.jobs === undefined && delta.attempts === undefined
    ? {}
    : { count: { ...(delta.jobs === undefined ? {} : { jobs: delta.jobs }), ...(delta.attempts === undefined ? {} : { attempts: delta.attempts }) } };
  return ledger.advanceRun(runId, { meters: withMeter, ...counting, ...more });
}

/**
 * **The ending a spent Budget causes, stated once.** The Run ends `ended-budget-exhausted` and its
 * meters say what ended it, so a person reading a Run that stopped can tell a Budget from a graph
 * that ran out of edges without going back through the records.
 *
 * Called from the driver at the two moments the box can be found spent — a turn that opens on a box
 * already gone, and a turn that spent it while waiting — and from nowhere else, because a Run ended
 * by a Budget in two spellings is two endings.
 */
export const endBudgetExhausted = (ledger: Ledger, runId: string): Promise<RunRecord> =>
  advance(ledger, runId, { endedBy: 'time-box' }, { status: 'ended-budget-exhausted' });

/**
 * **The generation limit, stated once**: may this Run open the generation after the one it is in?
 *
 * A meter of the Budget and not a convergence (D43): convergence is what the exploration learned,
 * this is what the Campaign was allowed to spend learning it. A Run with no Budget — one no fabric
 * started — is bounded by nothing here, because nothing here is driving it either.
 *
 * @param run - the Run, as its row stands.
 * @returns whether the next generation is within the limit the Budget carries.
 */
export const nextGenerationAllowed = (run: RunRecord): boolean =>
  run.budget === undefined || (run.generation ?? 1) + 1 <= run.budget.generationLimit;

/**
 * **A drill-down Loop's own generation limit, stated once** (#28): may this Loop open the generation
 * after the one it is in?
 *
 * Beside the Budget's and not part of it, because the two bound different things. The Budget's
 * generation limit is what one Campaign was allowed to spend, and it bounds the outer Loop; a
 * drill-down Loop's `converge.generationLimit` is what the pack allows *that sub-question*, and it
 * bounds only the Loop it is declared in — which is why a Loop reaching it closes the Loop rather
 * than ending the Run, and the outer graph goes on along the edge that outcome labels.
 *
 * @param loop - the Loop the Run is inside, as the row carries it.
 * @param limit - what the deciding Explore node's `converge` allows this Loop.
 */
export const nextLoopGenerationAllowed = (loop: RunLoop, limit: number): boolean => loop.generation + 1 <= limit;

/**
 * **The ending a spent generation limit causes, stated once**, beside the time box's for the reason
 * that one is stated once: a Run ended by a Budget in two spellings is two endings. The status is
 * the same `ended-budget-exhausted` — a meter ran out — and `endedBy` is what tells a person which,
 * without going back through the records.
 *
 * The decision that chose the next Strategy stays exactly as it was written: the Campaign really did
 * work out what to try next, and what stopped it was the allowance, not the exploration.
 */
export const endGenerationLimit = (ledger: Ledger, runId: string): Promise<RunRecord> =>
  advance(ledger, runId, { endedBy: 'generation-limit' }, { status: 'ended-budget-exhausted' });

/**
 * The node records of the Generation this Run is in — the ones every count over a node is taken
 * over (CONTEXT.md, Generation).
 *
 * The Retry allowance is per node per generation: a synthesis that failed twice in generation two
 * and is retried in generation three starts that node's allowance afresh, because it is a different
 * attempt at a different Strategy and not a third go at the same one. So the attempt numbers, the
 * allowance and everything else counted over a node's history is counted here, over the records the
 * ledger stamped with the generation the row now carries.
 *
 * Inside a drill-down Loop that is the *Loop's* generation, and the Loop's own records (#28): a Loop
 * counts from one inside itself, and an outer graph that opened the same Loop twice would otherwise
 * count the first opening's first generation as part of the second's. Both narrowings are what the
 * ledger already stamped on each record, so nothing here recomputes where a record was written.
 *
 * A Run with no generation matches the records that carry none, which is the Probe-campaign Run no
 * fabric started: it has no Loop, so all of its records are its one and only turn.
 */
export const nodeRecordsOfGeneration = (ledger: Ledger, runId: string): NodeRecord[] => {
  const run = existingRun(ledger, runId);
  const generation = run.loop?.generation ?? run.generation;
  return nodeRecordsIn(ledger, runId).filter((r) => r.generation === generation && r.loopId === run.loop?.id);
};

/**
 * Which attempt at this node the Run is about to make, counted from its own records: one past the
 * highest attempt number any record of this node carries.
 *
 * Counted from the attempt numbers themselves rather than from the `running` records that usually
 * open an attempt, because not every attempt opens with one. A launch the Permit refused, an
 * argument the Run cannot bind, a Site at its job cap and a Wait node all write their attempt's
 * first record as something else, and counting openings numbered the attempt after any of those as
 * attempt 1 all over again. That is a Retry allowance that never runs out, which is the whole thing
 * this module enforces — so the count is over what an attempt is, not over how it happened to start.
 */
export function attemptOf(ledger: Ledger, runId: string, nodeId: string): number {
  return nodeRecordsOfGeneration(ledger, runId).reduce((highest, r) => (r.nodeId === nodeId && r.attempt > highest ? r.attempt : highest), 0) + 1;
}

/**
 * Which attempt at this node the Run is in the middle of: the one its latest record numbered, or the
 * first for a node that has written none. What a cancel and a reconciliation number their records
 * with — they join an attempt already under way rather than opening the next one.
 */
export function currentAttemptOf(ledger: Ledger, runId: string, nodeId: string): number {
  return nodeRecordsOfGeneration(ledger, runId).findLast((r) => r.nodeId === nodeId)?.attempt ?? 1;
}

/**
 * Which attempt at this node the Job in this session was: **what its own launch record says**, or
 * what the `running` record that opened it says, or the next one for a Job that has neither.
 *
 * What a process picking a Job up again numbers its records with — the reconciliation that finds an
 * interrupted attempt, and a branch of a fork whose Job was launched by a host that has gone (#29).
 * It is the same attempt at the same node, joined by a second process, and numbering it afresh would
 * say a Job was launched twice.
 *
 * The launch record first, since #62. A launch and the node record that names its session are two
 * writes, the launch first, and a host that died between them left an attempt that no node record
 * could name: the fall-back then read `attemptOf`, which is one past the highest number any record
 * carries, and settled an attempt-1 moment, its `code` record and its Job as attempt 2. The launch is
 * where the attempt is actually in hand, so the launch is where it is now written down, and this
 * reads it there.
 *
 * The node record stays as the second answer, and not as a nicety: every `launched` record written
 * before this change carries no `attempt` at all, and a ledger from before domain 18 is exactly the
 * one a restart is most likely to be picking a Job up out of. `attemptOf` stays as the third for a
 * Job that has neither — a Job launched from the `/hima job` face belongs to no node and numbers no
 * attempt.
 *
 * Beside `attemptOf` and `currentAttemptOf` because it is the third answer to their one question,
 * and the three must count over the same records: the Generation's own (`nodeRecordsOfGeneration`).
 */
export function attemptOfSession(ledger: Ledger, runId: string, nodeId: string, session: string): number {
  const launched = ledger.records({ runId, type: 'job' })
    .findLast((r) => r.type === 'job' && r.event === 'launched' && r.job.session === session);
  if (launched?.type === 'job' && launched.attempt !== undefined) return launched.attempt;
  const opened = nodeRecordsOfGeneration(ledger, runId).findLast((r) => r.nodeId === nodeId && r.state === 'running' && r.jobSession === session);
  return opened?.attempt ?? attemptOf(ledger, runId, nodeId);
}

/** Where a node stands against its Retry allowance once this attempt has failed: how many of the
 *  allowance are now spent, what the allowance is, and whether that was the last of it. */
export interface RetryStanding {
  /** Failed attempts at this node since the Run was last resumed, this one included. */
  readonly spent: number;
  readonly allowance: number;
  /** Whether the allowance is now used up, so the failure is a Hard blocker rather than a retry. */
  readonly exhausted: boolean;
}

/**
 * **The Retry allowance, stated once**: an attempt that has just failed is a retry while fewer than
 * the allowance have failed since the last resume, and a Hard blocker when that was the last of them.
 *
 * Counted over the attempts *since the Run was last resumed*, because a resume is a person saying the
 * cause is cleared and that is what makes the allowance fresh: counting from the start of the Run
 * instead would let one person's fix be refused by the failure they had just fixed. Read off the
 * records rather than held anywhere, so a reconciliation that finds a Job already failed after a
 * restart reaches the same verdict the loop that launched it would have.
 *
 * @param ledger - where the Run's row and its node records are read from.
 * @param runId - the Run.
 * @param nodeId - the node whose attempt has just failed.
 */
export function retryStanding(ledger: Ledger, runId: string, nodeId: string): RetryStanding {
  const allowance = existingRun(ledger, runId).budget?.retryAllowance ?? defaultRetryAllowance;
  const owned = existingRun(ledger, runId).control !== undefined;
  const resumedAt = ledger.records({ runId }).findLast((r) => r.type === 'resumed' && (!owned || r.nodeId === nodeId))?.seq ?? 0;
  const failedSinceResume = nodeRecordsOfGeneration(ledger, runId).filter((r) => r.nodeId === nodeId && r.state === 'retrying' && r.seq > resumedAt).length;
  const spent = failedSinceResume + 1;
  return { spent, allowance, exhausted: spent >= allowance };
}
