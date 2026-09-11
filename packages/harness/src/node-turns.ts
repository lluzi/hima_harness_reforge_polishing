// One node's turn: what an act, judge or explore node does on the Site, and what it writes. One
// reason to change: what a node kind does when the Run stands at it.
//
// A turn is given everything it needs and holds nothing — the `Driving` below is derived, piece by
// piece, from the ledger and the files this machine has — and it answers a `Step`, which is all the
// driver reads of it. That is the whole seam between this module and `fabric.ts`: the driver decides
// where the Run goes next and this decides what happened, and neither reaches into the other.
//
// Everything here touches a Site, and a Site can stop answering at any moment. A turn that throws is
// the driver's fault boundary to record; what a turn returns is already recorded by the time it
// returns, which is why the outcomes below are so few — a `Step` says what the Run should do next,
// never what to write.
import { choose, loadChooser, measuredRead, type Chooser } from './choosers.js';
import { forkJoinedAt, forkOutcome, outputPath, positionOf, toolArgv, type Pack, type PackNode, type RunReference } from './packs.js';
import { jobKill, jobStatus, jobTail, pollAfter, type JobKillResult, type JobStatusResult } from './jobs.js';
import { observe } from './observe.js';
import { pathsOf, type Site } from './sites.js';
import { driving, existingRun } from './runs.js';
import { claimSlotAndLaunch } from './job-cap.js';
import { cancelStopped, nodeRecordsIn, recordNode } from './ledger.js';
import type {
  DecisionRecord,
  Ledger,
  NodeRecord,
  NodeState,
  ObservationRecord,
  RunProgress,
  RunRecord,
  VerdictOutcome,
  VerdictRecord,
} from './ledger.js';
import { advance, retryStanding, timeBoxSpent, type MeterDelta } from './budget.js';
import { counted } from './words.js';
import type { JudgedBranch, Judge } from './judge.js';
import { SiteUnreadableError } from './errors.js';

/** What every fabric operation is given: the ledger a Run lives in, HimaJudge, and where the Sites
 *  and packs this machine holds are installed. Declared here, with the turn that is handed it, and
 *  re-exported from `fabric.ts` so a caller finds it beside `startRun`. */
export interface FabricDeps {
  readonly ledger: Ledger;
  readonly judge: Judge;
  readonly sitesDir: string;
  readonly packsDir: string;
  /**
   * Where a line goes that belongs to the operator and not to the ledger (#18): a stretch of polls
   * during which a Site could not be asked, which is a fact about a machine rather than about a Run
   * and must not become a record. Absent, nothing is logged — a caller driving a Run outside a host
   * (the acceptance script, a test) has no host log to write to, and the Run is unaffected either way.
   */
  readonly log?: (line: string) => void;
}

/**
 * How much of the failed Job's log a blocker record carries: the last forty lines, and at most the
 * last sixteen kilobytes of them. Enough to hold a tool's own error and the lines that led to it,
 * small enough that a ledger is still a ledger — a bound in lines alone is not a bound at all, since
 * a tool that prints one megabyte-long line would put that megabyte on every blocker it caused. The
 * *last* sixteen kilobytes, because the end of a log is where the failure is.
 */
const blockerTailLines = 40;
const blockerTailChars = 16 * 1024;

/**
 * Everything the loop needs that is not on the run row, and every piece of it derived from something
 * durable: the pack and the Site from their files, the workspace from the workspace record the Run
 * already holds, the campaign from the run row. Nothing here is a handle a restart would lose, which
 * is what lets #14 rebuild this from the ledger and carry a Run on.
 */
export interface Driving {
  readonly deps: FabricDeps;
  readonly runId: string;
  readonly site: Site;
  readonly pack: Pack;
  readonly bindings: Readonly<Record<string, string>>;
  readonly workspace: string;
  readonly campaignId: string;
  /**
   * How long this Run had already spent waiting on a person when this drive began — the term the
   * time box is widened by. Fixed for the whole of one drive, because only a resume closes a wait
   * and a resume is what starts a drive; read from the records, so a later process driving the same
   * Run computes the same deadline.
   */
  readonly waitedMs: number;
  /**
   * The branch of a fork these turns belong to, while a drive is inside one (#29): the id of that
   * branch, which is the id of its first node.
   *
   * The one thing a branch's drive holds that the Run's own does not, and it is why it is here
   * rather than read off the run row: branches run at the same moment, so the row says where all of
   * them stand at once and never which of them *this* turn is. A branch's drive makes itself a
   * `Driving` of its own with this set, every record its turns write carries it, and a turn outside
   * every fork carries none.
   */
  readonly branchId?: string;
}

/**
 * What one node's turn came to. `blocked` needs a person; `budget-exhausted` is a meter's answer;
 * `retrying` is a failed attempt with allowance left, and the same node takes another turn;
 * `hard-blocker` is a failed attempt with none left, already recorded as a blocker, which routes the
 * Run to the pack's Wait node. `stopped` is the turn finding that the Run is no longer this loop's to
 * advance — a `/hima cancel` from another face, which is writing the Run's own ending as this turn
 * looks — and it is the one outcome that writes nothing at all, precisely so that it does not write
 * over that ending.
 */
export type Step =
  | { readonly kind: 'settled'; readonly outcome?: VerdictOutcome }
  | { readonly kind: 'blocked' }
  | { readonly kind: 'retrying' }
  | { readonly kind: 'hard-blocker' }
  | { readonly kind: 'budget-exhausted' }
  /**
   * The turn moved the Run itself, and the driver's only job is to take another turn where the row
   * now says. One turn does this: an Explore node that opens a drill-down Loop (#28), which is a
   * move into another graph and so cannot be said as an outcome an edge is labelled with.
   */
  | { readonly kind: 'moved' }
  | { readonly kind: 'stopped' };

// ---------------------------------------------------------------------------------------------
// Act: run the pack's tool on the Site as a Job, and wait for it.
// ---------------------------------------------------------------------------------------------

/**
 * Launch one of the pack's tools in the Campaign workspace and wait for the Job.
 *
 * The tool's environment is the Site's bindings and the Run's own facts — the workspace it acts in,
 * the flow root it was copied from, the design, the Campaign whose container the flow's wrapper
 * creates — plus whatever the node takes from the Run, which for the first pack is the one strategy
 * knob. `argv[0]` is what the Permit decides on, and `launchJob` asks it before anything is sent.
 *
 * The `running` node record is written once the Job exists, because it carries the session it is
 * waiting on. What says the node was entered before that is the run row's own `currentNode`, written
 * when the edge into it was followed, and the Job's record, which names the node it belongs to.
 */
export async function toolNode(ctx: Driving, run: RunRecord, node: Extract<PackNode, { kind: 'act' }>, attempt: number): Promise<Step> {
  const blocked = (reason: string, jobSession?: string): Promise<Step> => blockNode(ctx, node, attempt, reason, jobSession);
  const tool = ctx.pack.contract.tools.find((t) => t.id === node.parameters.tool);
  if (!tool) return blocked(`node ${node.id} runs tool "${node.parameters.tool}", which this pack's contract does not declare`);

  // What the node takes from the Run, resolved before anything is sent anywhere. An argument the Run
  // cannot bind is the pack's fault and is named as such: never a substituted empty string, and
  // never a bare `blocked` a person has to read the code to explain.
  const taken = nodeArguments(node, run);
  if (!taken.ok) return blocked(taken.reason);
  let argv: string[];
  try {
    argv = toolArgv(tool, {
      WORKSPACE: ctx.workspace,
      FLOW_ROOT: ctx.bindings.flowRoot!,
      DESIGN: ctx.bindings.design!,
      CAMPAIGN: ctx.campaignId,
      ...taken.values,
    });
  } catch (err) {
    // A tool whose argv references something this Run cannot supply. The pack is the thing to fix,
    // and nothing was sent to the Site.
    return blocked(`node ${node.id} cannot make the command line of tool "${tool.id}": ${(err as Error).message}`);
  }

  // Every argument is resolved and nothing has been sent anywhere: the last moment at which not
  // launching is free, and therefore where the Site's cap is asked about — its parallel Job count
  // and every licence this tool's Job would hold, in one step, for the reason `job-cap.ts` states.
  const claimed = await claimSlotAndLaunch(ctx.deps, {
    site: ctx.site,
    run,
    workspace: ctx.workspace,
    node,
    attempt,
    argv,
    licences: tool.licences,
    waitedMs: ctx.waitedMs,
    // The branch this launch is inside, onto the Job's own records and onto the `waiting-for-slot`
    // record a full Site writes here (#29).
    ...(ctx.branchId === undefined ? {} : { branchId: ctx.branchId }),
    // A stretch of counts the Site would not answer is the operator's to see and the ledger's to
    // stay out of (#18); the framing is `toHostLog`'s, so both waits say it the one way.
    log: (line) => toHostLog(ctx, line),
  });
  if (claimed.kind === 'budget-exhausted') return { kind: 'budget-exhausted' };

  const launched = claimed.launched;
  if (launched.kind !== 'launched') {
    // The Permit refused; the refusal is a record of its own, and the node says the same thing in
    // words so a person reading the Run's nodes does not have to go and find it.
    return blocked(`the site's permit refused to launch ${launched.record.path}: ${launched.record.reason}`);
  }
  const session = launched.record.job.session;
  await appendNode(ctx, node, 'running', attempt, { jobSession: session });
  // The meters, and — inside a fork — this branch back to `running`: it may have been queued behind
  // the Site's cap while it waited for the slot it has just been given (#29).
  //
  // The two halves are asked about differently on purpose. The meters count what happened, and a Job
  // was launched however the Run ends: they are written whatever the row now says. Where the branch
  // stands is a statement about a Run that is still going, so it is written only while this drive is
  // still the one moving it — a cancel can land in the launch's own round trip, and a branch saying
  // `running` on a Run somebody stopped would be saying the fork went on past the ending.
  const running = ctx.branchId === undefined || !stillDriving(ctx)
    ? {}
    : { branch: { id: ctx.branchId, currentNode: node.id, state: 'running' as const } };
  await progress(ctx, { jobs: 1, attempts: 1 }, running);
  return waitForJob(ctx, node, attempt, session);
}

/**
 * Wait for one act node's Job and settle the node from what became of it.
 *
 * Reached two ways, and that is the whole of what lets a Run survive its host: the launch above walks
 * into it holding the session it just created, and a reconciliation after a restart (`reconcileRuns`)
 * re-enters it for a Job some earlier process launched, from the session name that Job's own record
 * holds. Nothing in here launches anything, so a Run picked up again never pays for a second
 * generation — the Job it is waiting for is the one already running on the Site.
 */
export async function waitForJob(ctx: Driving, node: PackNode, attempt: number, session: string): Promise<Step> {
  const waitingSince = Date.now();
  /** When the current stretch of unreadable looks began, and undefined while the Site is answering
   *  (#18). One line for the stretch and one when it clears — a Loop polling for hours must not fill
   *  the host log with a line per look. */
  let unreadableSince: number | undefined;
  for (;;) {
    // Asked before each look and again after it, because the answer can change while the look is in
    // flight: a Run being stopped from another face is that face's to finish writing, and a Job that
    // disappears because someone killed it deliberately must not be recorded here as one that vanished.
    //
    // This is also the first thing `toolNode` reaches once its `launched` record exists, which is what
    // makes a launch that crossed a cancel this loop's to clean up rather than nobody's.
    if (stoppedElsewhere(ctx, session)) return stoppedWithJob(ctx, node, attempt, session);
    // `jobStatus` writes the finished record itself, the first time it sees the Job end.
    let status: JobStatusResult;
    try {
      status = await jobStatus(ctx.deps, { run: ctx.runId, session });
    } catch (err) {
      // Ticket #18: a Site that could not be asked is "ask again at the next look", never an ending.
      // The Site may be back in a moment — a socket a cleaner removed, a network that dropped — and
      // the Job goes on either way, so nothing is written and the wait continues. The time box still
      // bounds it: the deadline is checked on every look, unreadable or not, and a box that runs out
      // while the Site is silent goes to `timeBoxReached` exactly as one that runs out while it is
      // answering, because the Budget ending is a write a person must be given.
      if (!(err instanceof SiteUnreadableError)) throw err;
      if (unreadableSince === undefined) {
        unreadableSince = Date.now();
        toHostLog(ctx, `run ${ctx.runId} at node ${node.id}: site ${ctx.site.name} cannot be asked about tmux session ${session}; nothing is written and the poll keeps asking — ${err.message}`);
      }
      if (stoppedElsewhere(ctx, session)) return stoppedWithJob(ctx, node, attempt, session);
      if (timeBoxSpent(existingRun(ctx.deps.ledger, ctx.runId), ctx.waitedMs)) return timeBoxReached(ctx, node, attempt, session);
      await new Promise((r) => setTimeout(r, pollAfter(waitingSince)));
      continue;
    }
    if (unreadableSince !== undefined) {
      toHostLog(ctx, `run ${ctx.runId} at node ${node.id}: site ${ctx.site.name} is answering again about tmux session ${session} after ${Date.now() - unreadableSince} ms`);
      unreadableSince = undefined;
    }
    if (stoppedElsewhere(ctx, session)) return stoppedWithJob(ctx, node, attempt, session);
    if (status.state.state === 'finished') {
      const { exitCode } = status.state;
      // Exit 0 settles the node. Anything else is a failed attempt, and what becomes of a failed
      // attempt is the Retry allowance's to say, in one place, never here.
      return exitCode === 0
        ? settleFinished(ctx, node, attempt, session, exitCode)
        : settleFailedAttempt(ctx, node, attempt, {
            jobSession: session,
            exitCode,
            reason: `job "${node.id}" in tmux session ${session} exited ${exitCode}`,
          });
    }
    if (status.state.state === 'gone') {
      // No session and no exit file: the Job vanished. No exit code is invented for it, and it is a
      // failed attempt exactly as a non-zero exit is — the node made an attempt and got no result.
      return settleFailedAttempt(ctx, node, attempt, {
        jobSession: session,
        reason: `job "${node.id}" is gone: tmux session ${session} has ended and it wrote no exit status`,
      });
    }
    // Asked on every look, before the wait rather than after it, so a spent box is acted on within
    // one interval however long that interval has grown.
    if (timeBoxSpent(existingRun(ctx.deps.ledger, ctx.runId), ctx.waitedMs)) return timeBoxReached(ctx, node, attempt, session);
    await new Promise((r) => setTimeout(r, pollAfter(waitingSince)));
  }
}

/**
 * Has this Run stopped being this loop's to advance? Two ways it can have, and both are read off the
 * ledger rather than held anywhere: its row no longer says `running`, or a person's cancel request
 * has been recorded since this attempt's Job was launched.
 *
 * The request is checked as well as the status because the request is written *before* the kill is
 * sent, so it is already in the ledger by the time the Job it stops disappears. Checking the status
 * alone would leave a window — the kill lands, this loop sees a Job gone, and it writes the node
 * blocked over a Run someone is deliberately ending — and the ordering of those two writes would
 * decide what a person is told. `since the launch` keeps the check to this attempt: a cancel that did
 * not take (the Run waits, the request stands) must not stop a later attempt at the same node from
 * ever waiting again.
 */
function stoppedElsewhere(ctx: Driving, session: string): boolean {
  if (existingRun(ctx.deps.ledger, ctx.runId).status !== 'running') return true;
  const records = ctx.deps.ledger.records({ runId: ctx.runId });
  const launched = records.findLast((r) => r.type === 'job' && r.event === 'launched' && r.job.session === session);
  return launched !== undefined && records.some((r) => r.type === 'cancel' && r.seq > launched.seq);
}

/**
 * This Run was stopped from another face while this loop held a Job. Whose stop is that Job's?
 *
 * A cancel that saw the Job is stopping it itself: the `cancel` record names **every** session it
 * found open (`jobSessions`), so a Job named there is one that face is already killing, and this loop
 * writes nothing over the ending it is composing. A cancel that did not name this session never saw
 * it — it read the Run's records in the moment between the permit's decision and this attempt's
 * `launched` record, found this Job nowhere, and ended the Run. The Job this loop is holding is then
 * the only thing of that Run still on the Site, and nothing will ever come looking for it:
 * `reconcileRuns` passes over a Run in a final state. So this loop stops it here, records the stop
 * that was actually observed, and only then returns — because nothing may say a licence was released
 * while dc_shell still holds it, which is the promise both the cancel and the time box are written
 * around.
 *
 * **By name and never by sequence** (#29). A cancel reads what a Run has open and only then appends
 * its record, so a launch can be on record ahead of a `cancel` the cancel never saw — which inside a
 * fork is a whole branch: branch two's Job would read "a cancel landed after my launch, so it is
 * stopping me too", and no one would ever stop it. What was actually seen is a fact, and the record
 * carries it, so it is asked rather than inferred from the order two writes happened to land in.
 *
 * "Nothing will ever come looking for it" is also why the Site refusing to answer is handled here
 * rather than raised (#18): a raise would leave that Job unattended for good, and this is the one
 * cannot-tell in the harness that no later poll, boot or person would come back to. It takes the
 * kill-not-taken path instead — the node blocked, the Run waiting — so a person is told and can ask
 * again.
 */
async function stoppedWithJob(ctx: Driving, node: PackNode, attempt: number, session: string): Promise<Step> {
  const records = ctx.deps.ledger.records({ runId: ctx.runId });
  // Did a cancel see this Job? Asked of what the record says it stopped and of nothing else: a
  // cancel stops **every** Job the Run had open when it read the records (#29) and names all of them,
  // so this session being one of them is the whole question. A cancel that named other sessions and
  // not this one never saw this launch, and the Job is this loop's to stop, below.
  const cancelled = records.some((r) => r.type === 'cancel' && cancelStopped(r, session));
  if (cancelled) return { kind: 'stopped' };
  let killed: JobKillResult;
  try {
    killed = await jobKill(ctx.deps, { run: ctx.runId, session });
  } catch (err) {
    // Ticket #18, and the one path where raising would be the damage rather than the safety. This
    // loop is the only thing that knows about this Job — the face that ended the Run never saw it,
    // and `reconcileRuns` passes over a Run in a final state — so a raise here leaves a Job of ours
    // holding a licence on a customer's Site with nothing that will ever ask about it again. Nothing
    // was observed, so nothing is claimed about the Job; but the Run is not left silent either. It
    // takes the same path a kill that did not take takes, for the same reason: the node blocked
    // naming the session and saying the Site could not be asked, and the Run moved to `waiting`,
    // which is what puts it back in reach of `/hima cancel` and of a resume.
    if (!(err instanceof SiteUnreadableError)) throw err;
    await appendNode(ctx, node, 'blocked', attempt, {
      jobSession: session,
      reason: killCouldNotBeAsked('asked to stop by a cancel', session, err.message),
    });
    return { kind: 'blocked' };
  }
  if (killed.outcome.wasRunning && killed.outcome.gone) {
    await appendNode(ctx, node, 'cancelled', attempt, { jobSession: session });
    return { kind: 'stopped' };
  }
  if (killed.outcome.wasRunning) {
    // The kill did not take. Recorded exactly as the cancel face records one that did not take — the
    // node blocked naming the session a person must go and look at, and the Run waiting — whatever
    // the run row was moved to while this launch was in flight.
    await appendNode(ctx, node, 'blocked', attempt, {
      jobSession: session,
      reason: killDidNotTake('asked to stop by a cancel', session),
    });
    return { kind: 'blocked' };
  }
  // The session was already gone: the Job ended by itself in the same moments. Nothing was killed and
  // nothing may claim otherwise, so the node settles from the exit the launch wrote, as a cancel that
  // loses the same race does. The Run keeps the ending the other face gave it.
  const after = await jobStatus(ctx.deps, { run: ctx.runId, session });
  if (after.state.state === 'finished') await settleFinished(ctx, node, attempt, session, after.state.exitCode);
  else await appendNode(ctx, node, 'blocked', attempt, { jobSession: session, reason: `job "${node.id}" is gone: tmux session ${session} has ended and it wrote no exit status` });
  return { kind: 'stopped' };
}

/**
 * What a node says when a kill did not take, wherever the kill came from — a cancel face, a launch
 * that crossed one, or a spent time box. The three write the same words because they leave the same
 * state behind, and it is a state with a consequence a person has to act on: the Job is still on the
 * Site, holding whatever licence it holds.
 *
 * `the kill did not take` is the phrase, and it is deliberately one nothing else here writes. A
 * `blocked` node is where a Run stops needing a person, and every other blocker on a Run means the
 * Job is over; this one means the opposite. So a person reading `/hima status`, and a person grepping
 * a day of them, can find exactly the Jobs this harness asked a Site to stop and could not.
 *
 * @param asked - what asked for the stop, as the sentence's subject: `asked to stop by a cancel`.
 * @param session - the tmux session that is still there, which is what a person goes and looks at.
 */
export const killDidNotTake = (asked: string, session: string): string =>
  `${asked} but its tmux session ${session} is still there: the kill did not take, and the job is still running on the site`;

/**
 * What a node says when the stop could not even be asked for, because the Site stopped answering
 * (#18). The same consequence as a kill that did not take — a Job that may still be on the Site,
 * holding whatever licence it holds — so it carries `the kill did not take` in the same words, and a
 * person grepping a day of blockers for the Jobs this harness could not stop finds this one too.
 *
 * What it does not say is that the session is still there. That is the one thing nobody could
 * observe, and a blocker claiming it would be the same invention this ticket exists to remove.
 *
 * @param asked - what asked for the stop, as the sentence's subject.
 * @param session - the tmux session a person goes and looks at.
 * @param why - what the Site said, in its own words.
 */
const killCouldNotBeAsked = (asked: string, session: string, why: string): string =>
  `${asked} but the site could not be asked about its tmux session ${session}: the kill did not take, and the job may still be running on the site — ${why}`;

/**
 * One line to the host log, where a host gave one (#18). Not a record: a Site that stopped answering
 * for a minute is a fact about a machine, and the ledger holds what happened to a Run.
 *
 * The one framing for both stretches a turn can sit in — a Job that will not answer, and a job slot
 * that cannot be counted. The second of those is waited for in `job-cap.ts`, which is below this
 * module in the layering and cannot import it, so the turn that starts that wait hands this down as
 * `claimSlotAndLaunch`'s `log` rather than a second `hima:` prefix being written there.
 */
function toHostLog(ctx: Driving, line: string): void {
  ctx.deps.log?.(`hima: ${line}`);
}

/** One node blocked, carrying why in words and the Job it was waiting on where there was one. */
async function blockNode(ctx: Driving, node: PackNode, attempt: number, reason: string, jobSession?: string): Promise<Step> {
  await appendNode(ctx, node, 'blocked', attempt, jobSession === undefined ? { reason } : { reason, jobSession });
  return { kind: 'blocked' };
}

/**
 * A node whose Job ended: `done` on exit 0, and otherwise blocked carrying the code it exited with.
 *
 * The non-zero half is never a retry: it is reached from the time box, where the Run is ending anyway
 * and a retry would be a Job launched into a spent Budget, and from a launch that crossed a cancel and
 * found its Job already over (`stoppedWithJob`), where the Run's ending is another face's to write. A
 * Job that failed while the Budget still stood and nobody was ending the Run goes to
 * `settleFailedAttempt` instead, which is where the Retry allowance is spent.
 */
async function settleFinished(ctx: Driving, node: PackNode, attempt: number, session: string, exitCode: number): Promise<Step> {
  const state: NodeState = exitCode === 0 ? 'done' : 'blocked';
  const reason = exitCode === 0 ? {} : { reason: `job "${node.id}" in tmux session ${session} exited ${exitCode}` };
  await appendNode(ctx, node, state, attempt, { jobSession: session, ...reason });
  return exitCode === 0 ? { kind: 'settled' } : { kind: 'blocked' };
}

// ---------------------------------------------------------------------------------------------
// Attempts: the Retry allowance and Hard blockers. The Site's job cap is `job-cap.ts`.
// ---------------------------------------------------------------------------------------------

/** What went wrong with one attempt: the Job it was, what it exited with if it wrote anything, and
 *  the failure in words. */
interface FailedAttempt {
  readonly jobSession?: string;
  /** What the Job exited with. Absent for a Job that vanished: no exit code is invented for one. */
  readonly exitCode?: number;
  readonly reason: string;
}

/**
 * What happens to a failed attempt at a node — the one function that decides it.
 *
 * One function rather than one per failure shape, because the Retry allowance is a single rule and
 * two copies of it would be two products: a Job that exits non-zero and a Job that vanishes are the
 * same event to a Budget, and a reconciliation that finds a Job already failed after a restart (#14)
 * must reach the same verdict this loop would have reached had it been watching.
 *
 * Within the allowance the attempt is recorded `retrying` and the caller takes the node's next turn;
 * the fresh Job, its fresh session and its fresh log all come from that next turn, not from here.
 * With the allowance spent, the whole failure is written as a `blocker` record — the attempts, the
 * last exit, the tail of the Job's own log — the node is `blocked` carrying the same sentence, and
 * the Run is routed to the pack's Wait node for a person.
 *
 * The allowance is counted from the records, over the attempts since the Run was last resumed, so a
 * resume really does grant a fresh allowance and a second process would count the same way.
 */
async function settleFailedAttempt(ctx: Driving, node: PackNode, attempt: number, failure: FailedAttempt): Promise<Step> {
  const { spent, allowance, exhausted } = retryStanding(ctx.deps.ledger, ctx.runId, node.id);
  const session = failure.jobSession === undefined ? {} : { jobSession: failure.jobSession };
  if (!exhausted) {
    await appendNode(ctx, node, 'retrying', attempt, {
      ...session,
      reason: `${failure.reason}; that is ${counted(spent, 'failed attempt')} of an allowance of ${allowance}, so the node tries again`,
    });
    return { kind: 'retrying' };
  }
  const reason = `${failure.reason}; node ${node.id} has now failed ${counted(spent, 'time')} and spent its retry allowance of ${allowance}`;
  const logTail = failure.jobSession === undefined ? undefined : await tailOfJob(ctx, failure.jobSession);
  // An absent key, never an undefined one: a failure with no exit status and no log says so by omission.
  const exit = failure.exitCode === undefined ? {} : { lastExitCode: failure.exitCode };
  const tail = logTail === undefined ? {} : { logTail };
  const inBranch = ctx.branchId === undefined ? {} : { branchId: ctx.branchId };
  await ctx.deps.ledger.appendBlocker(ctx.runId, { nodeId: node.id, attempts: attempt, ...inBranch, ...exit, ...tail, reason });
  await appendNode(ctx, node, 'blocked', attempt, { ...session, reason });
  return { kind: 'hard-blocker' };
}

/** The tail of a Job's log, for the blocker record to carry. A log that cannot be read leaves the
 *  tail absent: the blocker still says everything else it knows, and a failure to tail a log is not
 *  a second failure worth losing the first one over. */
async function tailOfJob(ctx: Driving, session: string): Promise<string | undefined> {
  try {
    return (await jobTail(ctx.deps, { run: ctx.runId, session, lines: blockerTailLines })).text.slice(-blockerTailChars);
  } catch {
    return undefined;
  }
}

/**
 * The Budget's answer to a Job still running when the time box is spent: stop it, and then record
 * what actually happened rather than what was asked for. A Run is not stopped until the stop is
 * observed (#9), so the kill's own outcome decides all three of these, not the intent behind it:
 *
 * - the session was there and is now gone — the `killed` record exists, the node is `cancelled`, and
 *   the turn answers `budget-exhausted`, which is what has the driver end the Run the way a spent
 *   Budget ends it (`budget.ts`). The ordinary case, and the one the suite drives;
 * - the session was already gone — the Job won the race between the last poll and the kill. Nothing
 *   was killed and nothing may claim otherwise: `jobStatus` is asked again so the `finished` record
 *   is written with the exit code the launch left, the node settles from it, and the turn still
 *   answers `budget-exhausted` because the time box really is spent. What is not written is a
 *   `cancelled` for a Job that completed, with its report sitting in the workspace unattributed;
 * - the session is still there after the kill's bounded wait — nothing was stopped. Writing
 *   `cancelled` and ending the Run here would tell a person their licence was released while
 *   dc_shell still holds it, which is exactly the promise the time box exists to keep. The node is
 *   blocked naming the session, the Run waits, and a person is told which session to look at.
 */
async function timeBoxReached(ctx: Driving, node: PackNode, attempt: number, session: string): Promise<Step> {
  let killed: JobKillResult;
  try {
    killed = await jobKill(ctx.deps, { run: ctx.runId, session });
  } catch (err) {
    // Ticket #18: the fourth case, and the one write this ticket does add. The box is spent and the
    // Site cannot be asked to stop the Job, so nothing was stopped and nothing may claim it was —
    // but the Budget has ended, and that ending is a person's to see. It takes the kill-not-taken
    // path: the node blocked naming the session, the Run waiting. The words are not the same as a
    // kill that was refused, because nobody saw the session at all and saying it is still there
    // would be inventing the one thing that could not be observed.
    if (!(err instanceof SiteUnreadableError)) throw err;
    await appendNode(ctx, node, 'blocked', attempt, {
      jobSession: session,
      reason: killCouldNotBeAsked('asked to stop at the time box', session, err.message),
    });
    return { kind: 'blocked' };
  }
  if (killed.outcome.wasRunning && killed.outcome.gone) {
    await appendNode(ctx, node, 'cancelled', attempt, { jobSession: session });
    return { kind: 'budget-exhausted' };
  }
  if (killed.outcome.wasRunning) {
    await appendNode(ctx, node, 'blocked', attempt, {
      jobSession: session,
      reason: killDidNotTake('asked to stop at the time box', session),
    });
    return { kind: 'blocked' };
  }
  const after = await jobStatus(ctx.deps, { run: ctx.runId, session });
  if (after.state.state === 'finished') {
    await settleFinished(ctx, node, attempt, session, after.state.exitCode);
    return { kind: 'budget-exhausted' };
  }
  await appendNode(ctx, node, 'blocked', attempt, {
    jobSession: session,
    reason: `the time box was spent and tmux session ${session} was already gone, and it wrote no exit status`,
  });
  return { kind: 'budget-exhausted' };
}

/** Read one of the contract's outputs, inside the Campaign workspace, through the reader it names. */
export async function observeNode(ctx: Driving, node: Extract<PackNode, { kind: 'act' }>, attempt: number): Promise<Step> {
  await appendNode(ctx, node, 'running', attempt);
  await progress(ctx, { attempts: 1 });
  const output = ctx.pack.contract.outputs.find((o) => o.name === node.parameters.observes);
  if (!output) {
    await appendNode(ctx, node, 'blocked', attempt, { reason: `node ${node.id} observes output "${node.parameters.observes}", which this pack's contract does not declare` });
    return { kind: 'blocked' };
  }
  const at = pathsOf(ctx.site).join(ctx.workspace, outputPath(output, ctx.bindings));
  const result = await observe(ctx.deps, {
    site: ctx.site.name,
    path: at,
    reader: output.reader,
    run: ctx.runId,
    // Whose reading this is, inside a fork: what the join judges each branch on (#29).
    ...(ctx.branchId === undefined ? {} : { branchId: ctx.branchId }),
  });
  if (result.kind === 'observed') {
    await appendNode(ctx, node, 'done', attempt);
    return { kind: 'settled' };
  }
  // A refusal is a record of its own; the node says the same thing in words.
  await appendNode(ctx, node, 'blocked', attempt, { reason: `${result.record.path} was not read: ${result.record.reason}` });
  return { kind: 'blocked' };
}

/**
 * What this node takes from the Run for this generation, as the tool's own variables — or which
 * argument the Run cannot bind. Nothing is dropped silently: an argument with no value is what makes
 * a command line the pack meant something else, and a Job launched with it would run at a period
 * nobody chose.
 */
function nodeArguments(
  node: Extract<PackNode, { kind: 'act' }>,
  run: RunRecord,
): { readonly ok: true; readonly values: Record<string, string> } | { readonly ok: false; readonly reason: string } {
  const values: Record<string, string> = {};
  for (const [name, argument] of Object.entries(node.parameters.arguments)) {
    if (typeof argument === 'string') { values[name] = argument; continue; }
    if (typeof argument === 'number') { values[name] = String(argument); continue; }
    const resolved = runValue(run, argument);
    if (resolved === undefined) {
      return { ok: false, reason: `node ${node.id} names argument ${name} that neither the Run's strategy nor its Goal binds: ${argument.from} "${argument.name}"` };
    }
    values[name] = String(resolved);
  }
  return { ok: true, values };
}
// ---------------------------------------------------------------------------------------------
// Judge: the pack's rules over what the Run observed, with the Run's own goal bound.
// ---------------------------------------------------------------------------------------------

/**
 * Ask HimaJudge for a verdict per rule, in the order the node lists them, and take the edge the
 * FIRST rule's outcome labels — the constraint the pack chose to branch on. The goal rule decides
 * whether the Campaign is done, not which way the graph goes.
 *
 * A parameter the Run cannot bind is deliberately left unbound rather than substituted: the rule
 * then goes UNDETERMINED naming the parameter, which is the honest answer and already the judge's.
 */
export async function judgeNode(ctx: Driving, run: RunRecord, node: Extract<PackNode, { kind: 'judge' }>, attempt: number): Promise<Step> {
  const params: Record<string, number> = {};
  for (const [name, reference] of Object.entries(node.parameters.bind)) {
    const resolved = runValue(run, reference);
    if (typeof resolved === 'number') params[name] = resolved;
  }
  const blocked = async (reason: string): Promise<Step> => {
    await appendNode(ctx, node, 'blocked', attempt, { reason });
    return { kind: 'blocked' };
  };
  // Is this node a join — the node a fork's branches converge into (#29)? Asked of the graph and
  // never of the run row, so it is the same answer whether the fork closed a moment ago or a host
  // ago, and one judge node is therefore judged one way whatever process reached it.
  const joined = branchesAt(ctx, run, node.id);
  const firsts: VerdictOutcome[] = [];
  try {
    if (joined === undefined) {
      firsts.push((await ctx.deps.judge.evaluate({ runId: ctx.runId, ruleIds: node.parameters.rules, params }))[0]!.outcome);
    } else {
      // One branch at a time, in the order the graph draws them, so a join's verdicts read as a
      // person reads a fork: this branch's rules, then the next branch's. Nothing here waits on a
      // Site — judging reads the ledger and appends — so there is nothing to gain by asking for them
      // all at once, and a great deal to lose: two branches' verdicts interleaved rule by rule.
      for (const branch of joined) {
        firsts.push((await ctx.deps.judge.evaluate({ runId: ctx.runId, ruleIds: node.parameters.rules, params, over: branch }))[0]!.outcome);
      }
    }
  } catch (err) {
    // A rule the pack references and this harness cannot produce. `/hima pack check` says so before
    // a Campaign starts; reaching it here means the rules changed under an installed pack. A branch
    // that read nothing is not this: it is handed to the judge with no reading and comes back
    // UNDETERMINED naming what the rule needed, which is the judge's own honest answer.
    return blocked(`node ${node.id} could not be judged: ${(err as Error).message}`);
  }
  // A judge node concludes one thing, whether it judged one reading or one per branch: the outcome
  // its own edge is labelled with. Over a fork that is `forkOutcome`'s rule, stated once in
  // `packs.ts` beside what a fork is, and read here and by `edgeFrom`.
  const outcome = joined === undefined ? firsts[0]! : forkOutcome(firsts);
  await appendNode(ctx, node, 'done', attempt, { outcome });
  return { kind: 'settled', outcome };
}

/**
 * Each branch of the fork that converges into this node, with the reading the join judges it on: the
 * latest observation that branch wrote in the Generation the Run is in.
 *
 * Undefined for every judge node nothing forks into, which is what keeps an ordinary judge node
 * judging the Run's own latest reading exactly as it always did.
 *
 * The Generation and the Loop narrow it for the reason every other read of a Run's evidence is
 * narrowed (`exploreNode` above): a graph that forks inside a Loop it revisits would otherwise judge
 * this generation's branch against the last one's reading. A branch that wrote no reading at all is
 * handed to the judge with none, and the judge answers UNDETERMINED naming what it needed — which is
 * its own honest answer and better than one the executor invented.
 */
function branchesAt(ctx: Driving, run: RunRecord, joinId: string): readonly JudgedBranch[] | undefined {
  const graph = positionOf(ctx.pack, joinId)?.graph;
  const fork = graph === undefined ? undefined : forkJoinedAt(graph, joinId);
  if (fork === undefined) return undefined;
  const generation = run.loop?.generation ?? run.generation;
  const observations = ctx.deps.ledger.records({ runId: run.id, type: 'observation' });
  return fork.branches.map((branch) => {
    const read = observations.findLast(
      (r): r is ObservationRecord => r.type === 'observation' && r.branchId === branch.id && r.generation === generation && r.loopId === run.loop?.id,
    );
    return read === undefined ? { branchId: branch.id } : { branchId: branch.id, observation: read };
  });
}

/**
 * The value a node takes from the Run: one of its Strategy's knobs, by the name the pack declared it
 * under (#58), or one of the Goal's numbers.
 *
 * `undefined` when the Run binds neither — and both callers act on that rather than passing it on.
 * An act node blocks naming the argument, because a command line missing a value is a command line
 * that means something else. A judge node deliberately leaves the rule's parameter unbound, because
 * the verdict then comes back UNDETERMINED naming the parameter, which is the judge's own honest
 * answer and better than one the executor invented.
 *
 * A knob may be a word rather than a number, which is why this answers either: an act node writes
 * whichever it is onto the tool's command line, and a judge node's `bind` takes only the numbers,
 * because a rule's parameter is a number and a rule handed a word would be a rule nobody could
 * evaluate.
 */
function runValue(run: RunRecord, reference: RunReference): number | string | undefined {
  if (reference.from === 'goal') return run.goal?.[reference.name];
  return run.strategy?.[reference.name];
}

// ---------------------------------------------------------------------------------------------
// Explore: choose the next strategy from what was judged, and record why.
// ---------------------------------------------------------------------------------------------

/**
 * Run the pack's chooser and write the decision.
 *
 * Everything it is given comes out of the ledger: the judge node the Run last completed says which
 * rules were applied, in the order the pack lists them — the first the constraint, the second the
 * goal rule — and the Run's latest verdict for each is what the chooser weighs, against the latest
 * observation. So a second process choosing again from the same ledger would choose the same thing.
 *
 * "The Run's latest" means the latest *of the graph this node is in* (#28): an Explore node inside a
 * drill-down Loop weighs that Loop's own judgements and readings, and one in the pack's own graph
 * weighs the graph's. Nested records carry the Loop they were written in, so this is one narrowing
 * and not a second lookup.
 */
export async function exploreNode(ctx: Driving, node: Extract<PackNode, { kind: 'explore' }>, attempt: number): Promise<Step> {
  const blocked = async (reason: string): Promise<Step> => {
    await appendNode(ctx, node, 'blocked', attempt, { reason });
    return { kind: 'blocked' };
  };
  const named = node.parameters.chooser;
  if (named === undefined) {
    // The pack is validated at load: an Explore node names a chooser or opens a Loop, exactly one,
    // and the driver takes an opening one somewhere else. Reaching this is a pack that changed under
    // a Run, and it is the pack's fault said as such rather than a chooser id invented for it.
    return blocked(`node ${node.id} names no chooser, so there is nothing for it to decide with`);
  }
  let chooser: Chooser;
  try {
    chooser = loadChooser(named);
  } catch (err) {
    // `/hima pack check` resolves every chooser id before a Campaign starts, so reaching this means
    // the shipped choosers changed under an installed pack.
    return blocked((err as Error).message);
  }

  const run = existingRun(ctx.deps.ledger, ctx.runId);
  const loopId = run.loop?.id;
  const here = <R extends { readonly loopId?: string }>(r: R): boolean => r.loopId === loopId;
  const lastJudge = nodeRecordsOf(ctx).findLast((r) => r.kind === 'judge' && r.state === 'done' && here(r));
  const judgeNodeOfRun = positionOf(ctx.pack, lastJudge?.nodeId)?.node;
  if (!judgeNodeOfRun || judgeNodeOfRun.kind !== 'judge') {
    return blocked(`node ${node.id} runs chooser ${chooser.id}, but this run has completed no judge node for it to weigh`);
  }
  const [constraintRule, goalRule] = judgeNodeOfRun.parameters.rules;
  if (constraintRule === undefined || goalRule === undefined) {
    return blocked(`judge node ${judgeNodeOfRun.id} lists fewer than two rules, so ${chooser.id} has no constraint and goal to weigh`);
  }

  const verdicts = ctx.deps.ledger.records({ runId: ctx.runId, type: 'verdict' }).filter((r): r is VerdictRecord => r.type === 'verdict' && here(r));
  const constraint = verdicts.findLast((v) => matchesRule(v, constraintRule));
  const goal = verdicts.findLast((v) => matchesRule(v, goalRule));
  const observation = ctx.deps.ledger
    .records({ runId: ctx.runId, type: 'observation' })
    .findLast((r): r is ObservationRecord => r.type === 'observation' && here(r));
  if (!constraint || !goal || !observation) {
    const missing = [!constraint && `a verdict of ${constraintRule}`, !goal && `a verdict of ${goalRule}`, !observation && 'an observation'].filter(Boolean);
    return blocked(`run ${ctx.runId} holds no ${missing.join(' and no ')}, which ${chooser.id} needs to choose`);
  }

  const converge = node.parameters.converge;
  const chosen = choose(chooser, {
    bound: node.parameters.bind,
    // What a Strategy is made of, and what this Run is set to now (#58): the chooser states what it
    // changes, and the knobs its matching clause does not name are carried over from here.
    knobs: ctx.pack.contract.strategy,
    strategy: run.strategy ?? {},
    constraint,
    goal,
    observation,
    ...(converge === undefined ? {} : { converge, earlier: earlierGenerations(ctx, chooser, converge.read) }),
  });
  if (!chosen.ok) return blocked(chosen.reason);
  await ctx.deps.ledger.appendDecision(ctx.runId, {
    nodeId: node.id,
    chooser: chooser.id,
    chosen: chosen.chosen,
    rationale: chosen.rationale,
    cites: [constraint.id, goal.id, observation.id],
  });
  await appendNode(ctx, node, 'done', attempt);
  return { kind: 'settled' };
}

/**
 * What the chooser's read measured in each of this Run's *earlier* Generations, oldest first — the
 * values convergence is decided over (D43).
 *
 * One value per generation and not one per observation: a generation that had to retry its synthesis
 * read the report twice, and both readings are of that one generation's work. The latest observation
 * of each is the one that settled it, exactly as the Explore node takes this generation's own
 * reading from the latest observation of all.
 *
 * A generation whose observation does not state the read at all — a report the reader could not make
 * sense of, in a Run that carried on — contributes nothing rather than a substituted zero, and the
 * Loop simply has fewer values to converge on. Nothing here invents a measurement.
 *
 * One Loop's generations, and never another's (#28): a drill-down Loop counts from one inside itself,
 * so a Run whose outer graph also loops would otherwise weigh its own outer generation one against a
 * nested generation one. Records carry the Loop they were written in, so the narrowing is the same
 * one every other read of this Explore node's evidence makes.
 */
function earlierGenerations(ctx: Driving, chooser: Chooser, read: string): number[] {
  const run = existingRun(ctx.deps.ledger, ctx.runId);
  const generation = run.loop?.generation ?? run.generation ?? 1;
  const observations = ctx.deps.ledger
    .records({ runId: ctx.runId, type: 'observation' })
    .filter((r): r is ObservationRecord => r.type === 'observation' && r.loopId === run.loop?.id);
  const latest = new Map<number, ObservationRecord>();
  for (const record of observations) {
    if (record.generation === undefined || record.generation >= generation) continue;
    latest.set(record.generation, record);
  }
  return [...latest.keys()]
    .sort((a, b) => a - b)
    .flatMap((g) => {
      const value = measuredRead(chooser, read, latest.get(g)!);
      return value === undefined ? [] : [value];
    });
}

/** Does this verdict come from the rule a pack referenced as `<id>` or `<id>@<version>`? */
function matchesRule(verdict: VerdictRecord, reference: string): boolean {
  const [id, version] = reference.split('@');
  return verdict.ruleId === id && (version === undefined || verdict.ruleVersion === version);
}

// ---------------------------------------------------------------------------------------------
// The records a turn writes, and the meters it moves.
// ---------------------------------------------------------------------------------------------

/**
 * Move the Run on: the meters as they now stand, plus whatever else changed. The run row is re-read
 * here rather than passed in, because everything above it has been writing records and meters of its
 * own, and a stale copy would silently undo them.
 */
export async function progress(ctx: Driving, delta: MeterDelta, more: RunProgress = {}): Promise<RunRecord> {
  return advance(ctx.deps.ledger, ctx.runId, delta, more);
}

/**
 * Is this Run still this drive's to move? The same one question `drive` opens every turn with, asked
 * again where a move is about to be written rather than where the turn began.
 *
 * A turn is not instantaneous, and another face — a person's cancel, a reconciliation — can end a
 * Run inside one. Between the top of a turn and the write that ends it there is a window, and a
 * move written in that window lands on a Run somebody else has already given an ending: the row
 * keeps that ending, because `advanceRun` states no status of its own, but it loses the place the
 * Run stopped at and gains a record of something that happened after it was over. So the sites that
 * write a move a person could read as "and then it went on" — a drill-down Loop closing, a revisit
 * opening the next Generation — ask this immediately before writing, and write nothing when the
 * answer is no.
 *
 * One test and not two: a Run that has ended does not say `running` (`hasEnded` is exactly the
 * statuses this excludes), and neither does one another face moved to `waiting`. Every path that
 * stops writing here answers `stopped`, which is what `drive` already does nothing after.
 */
export const stillDriving = (ctx: Driving): boolean => driving(existingRun(ctx.deps.ledger, ctx.runId));
// The same question of a row the caller is already holding — a caller that read the row for
// something else, the generation a revisit is about to carry — is `driving` itself, in `runs.ts`
// beside the row. It is imported from there by whoever asks it: this module passed it through for a
// while, which is one module standing between two that already know each other (the final review of
// step 3b, J10).

export const nodeRecordsOf = (ctx: Driving): NodeRecord[] => nodeRecordsIn(ctx.deps.ledger, ctx.runId);

/** One node transition of the Run this drive is carrying, in the ledger's own shape. */
export async function appendNode(
  ctx: Driving,
  node: PackNode,
  state: NodeState,
  attempt: number,
  extra: { outcome?: VerdictOutcome; jobSession?: string; reason?: string; branchId?: string } = {},
): Promise<NodeRecord> {
  // The branch this drive is inside, on every transition it writes, without a caller passing one:
  // a turn does not know it is in a fork, and a fork's drive should not have to say so at each turn.
  const inBranch = ctx.branchId === undefined ? {} : { branchId: ctx.branchId };
  return recordNode(ctx.deps.ledger, ctx.runId, node, state, attempt, { ...inBranch, ...extra });
}
