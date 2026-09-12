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
import { literalArgument } from './run-arguments.js';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { choose, measuredRead, type Chooser } from './choosers.js';
import {
  flowDirName,
  forkJoinedAt,
  forkOutcome,
  outputPath,
  packKnowledgeDir,
  packReaderScript,
  packSemanticsFile,
  positionOf,
  readersDirName,
  resolveChooser,
  resolvePackReader,
  semanticsOf,
  substitute,
  toolArgv,
  workshopArgv,
  type ContractOutput,
  type Pack,
  type PackNode,
  type PackReaderDeclaration,
  type PackWorkshop,
  type RunReference,
} from './packs.js';
import { jobKill, jobStatus, jobTail, waitForNextPoll, type LaunchRequest, type JobDeps, type JobKillResult, type JobStatusResult } from './jobs.js';
import { appendReading, observeForPack } from './observe.js';
import { pathsOf, type Site } from './sites.js';
import { channelFor, mustRun } from './channel.js';
import { decideRead, decideWrite } from './shell.js';
import { readingDocument, type Semantics, type SemanticDeclaration } from './semantics.js';
import { driving, existingRun } from './runs.js';
import { claimSlotAndLaunch } from './job-cap.js';
import { cancelStopped, nodeRecordsIn, recordNode } from './ledger.js';
import type {
  CodeRecord,
  DecisionRecord,
  JobRecord,
  LaunchedReading,
  LaunchedWorkshop,
  Ledger,
  NodeRecord,
  ReportSeen,
  NodeState,
  ObservationRecord,
  PackDataOrigin,
  RunProgress,
  RunRecord,
  VerdictOutcome,
  VerdictRecord,
} from './ledger.js';
import { advance, nodeRecordsOfGeneration, retryStanding, timeBoxSpent, type MeterDelta } from './budget.js';
import { HIMA_MOMENT_PRESET, openMoment, type MomentDeps } from './moments.js';
import { readerNamed } from './readers.js';
import {
  readBack,
  within,
  workshopAsk,
  workshopInstructions,
  workshopTools,
  type WorkshopAttemptBefore,
  type WorkshopFault,
  type WorkshopKnowledge,
  type WorkshopProduces,
  type WorkshopReadable,
  type WorkshopSession,
  type WorkshopScope,
} from './workshop.js';
import path from 'node:path';
import { counted } from './words.js';
import type { JudgedBranch, Judge } from './judge.js';
import type { ReaderRef } from './ledger.js';
import { SiteUnreadableError } from './errors.js';

/** What every fabric operation is given: the ledger a Run lives in, HimaJudge, and where the Sites
 *  and packs this machine holds are installed. Declared here, with the turn that is handed it, and
 *  re-exported from `fabric.ts` so a caller finds it beside `startRun`. */
export interface FabricDeps {
  readonly beforeSlotClaim?: JobDeps['beforeSlotClaim'];
  readonly ledger: Ledger;
  readonly judge: Judge;
  readonly sitesDir: string;
  readonly packsDir: string;
  /**
   * The host a Model moment is composed on (#62): the one thing a turn needs that is not a file or a
   * record.
   *
   * Optional, and every caller that has one hands it in: the bundle's own plugin does, and the
   * acceptance scripts and the suites that drive a Run with no workshop in it do not. A workshop node
   * on a Run driven without one is a node blocked saying so, because a workshop is a Model moment and
   * a moment needs a host to be composed on — never a node silently settled as though it had run.
   *
   * Typed through `MomentDeps` rather than as cordis's `Context` directly, so this module — which is
   * the fabric's own and faces no dsh package — takes the agent seam's type from the one file that
   * does (`moments.ts`, ADR-0001).
   */
  readonly host?: MomentDeps['ctx'];
  /** Stop Host observers without terminating detached Site Jobs. */
  readonly stopSignal?: AbortSignal;
  /**
   * Where a line goes that belongs to the operator and not to the ledger (#18): a stretch of polls
   * during which a Site could not be asked, which is a fact about a machine rather than about a Run
   * and must not become a record. Absent, nothing is logged — a caller driving a Run outside a host
   * (the acceptance script, a test) has no host log to write to, and the Run is unaffected either way.
   */
  readonly log?: (line: string) => void;
  readonly notify?: (owner: string, runId: string, executionId: string) => void;
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
  /** Agent-controlled launches return identity immediately; capacity never queues business work. */
  readonly nonblocking?: boolean;
  readonly beforeLaunch?: LaunchRequest['beforeLaunch'];
  /** Private script directory beneath the Pack's declared Workshop root. */
  readonly executionId?: string;
  readonly stopSignal?: AbortSignal;
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
  | { readonly kind: 'pending'; readonly session: string }
  | { readonly kind: 'at-cap'; readonly reason: string }
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
    // The node's values first and the harness's last, so a name the harness is the author of holds
    // its own value whatever a declaration asked for. **The boundary is `validatePack`** — a graph
    // binding `WORKSPACE` at an act node is refused when the pack loads, naming the node and the
    // name — and this order is the second line: one that a pack author never reads, and that silently
    // ignores what they wrote, so it is not where the rule can live.
    argv = toolArgv(tool, {
      ...taken.values,
      WORKSPACE: ctx.workspace,
      FLOW_ROOT: ctx.bindings.flowRoot!,
      DESIGN: ctx.bindings.design!,
      CAMPAIGN: ctx.campaignId,
    });
  } catch (err) {
    // A tool whose argv references something this Run cannot supply. The pack is the thing to fix,
    // and nothing was sent to the Site.
    return blocked(`node ${node.id} cannot make the command line of tool "${tool.id}": ${(err as Error).message}`);
  }

  // Every argument is resolved and nothing has been sent anywhere: the last moment at which not
  // launching is free, and therefore where the Site's cap is asked about.
  return launchAndWait(ctx, run, node, attempt, { argv, licences: tool.licences, meters: ctx.nonblocking ? { jobs: 1 } : { jobs: 1, attempts: 1 } });
}

/** What one node's Job is, beyond the command line: what it holds of the Site, what it is called, what
 *  the meters count for it, and what settling its exit 0 means. */
interface Launch {
  readonly argv: readonly string[];
  readonly licences: Readonly<Record<string, number>>;
  /** What this launch is called on the Site; the node's own id where a caller says nothing (#61). */
  readonly jobName?: string;
  /** What one launch adds to the Run's meters. An observe node counted its attempt before it got
   *  here, so its reader Job adds the Job alone (#61). */
  readonly meters: MeterDelta;
  /**
   * What makes this launch a **reader's**, when it is one (#61): what its read-back will need,
   * written onto the `launched` record for whichever host settles the Job, and what settles the node
   * once exit 0 is in — a read of its own rather than the exit code.
   *
   * One member holding both, and not two optional ones. The durable record and the live wait are two
   * answers to the same question — is this Job a reader's? — and a type that let a caller give one
   * without the other would allow a Job recorded as a reader's whose live wait settles it from an
   * exit code, and a reader's callback over a Job no later host could recognise as one. A launch
   * supplies both or neither, and the compiler is what says so.
   */
  readonly reads?: { readonly reading: LaunchedReading; readonly finish: FinishJob };
  /**
   * What makes this launch a **workshop's**, when it is one (#62): the entry the wrapper is given as
   * its first operand, and the hash that entry had when the launch verified it against the `code`
   * record.
   *
   * Written onto the `launched` record whole, as `reading` is, and for a kin reason: the audit tie
   * between a Job and the bytes at its entry path has to survive the process that made it. Nothing
   * reads it back to settle the node — a workshop's Job settles from its exit code like a tool's —
   * so unlike `reads` it carries no callback; what it is for is a person, later, asking which bytes
   * the wrapper was handed.
   */
  readonly workshop?: LaunchedWorkshop;
}

/**
 * **Claim a slot on the Site, launch one Job, and wait for it.** The half of a node's turn that is
 * the same whichever kind of Job it is.
 *
 * Two things a node launches since #61 — the pack's tool at an act node, and the pack's reader script
 * at an observe node — and every step between the argv being ready and the Job being over is the same
 * for both: the Site's cap and every licence asked about in one step, the Permit deciding the
 * wrapper and the workspace, the `running` record carrying the session, the meters, the branch moved
 * back off `waiting-for-slot`, and the poll. Two copies of that would be two products, and the second
 * would be the one that forgot a fork.
 */
async function launchAndWait(
  ctx: Driving,
  run: RunRecord,
  node: Extract<PackNode, { kind: 'act' }>,
  attempt: number,
  launch: Launch,
): Promise<Step> {
  const claimed = await claimSlotAndLaunch(ctx.deps, {
    site: ctx.site,
    run,
    workspace: ctx.workspace,
    node,
    attempt,
    argv: launch.argv,
    licences: launch.licences,
    waitedMs: ctx.waitedMs,
    ...(ctx.nonblocking === undefined ? {} : { nonblocking: ctx.nonblocking }),
    ...(ctx.beforeLaunch === undefined ? {} : { beforeLaunch: ctx.beforeLaunch }),
    ...((ctx.stopSignal ?? ctx.deps.stopSignal) === undefined ? {} : { stopSignal: ctx.stopSignal ?? ctx.deps.stopSignal }),
    ...(launch.jobName === undefined ? {} : { jobName: launch.jobName }),
    ...(launch.reads === undefined ? {} : { reading: launch.reads.reading }),
    ...(launch.workshop === undefined ? {} : { workshop: launch.workshop }),
    // The branch this launch is inside, onto the Job's own records and onto the `waiting-for-slot`
    // record a full Site writes here (#29).
    ...(ctx.branchId === undefined ? {} : { branchId: ctx.branchId }),
    // A stretch of counts the Site would not answer is the operator's to see and the ledger's to
    // stay out of (#18); the framing is `toHostLog`'s, so both waits say it the one way.
    log: (line) => toHostLog(ctx, line),
  });
  if (claimed.kind !== 'claimed') return claimed;

  const launched = claimed.launched;
  if (launched.kind !== 'launched') {
    // The Permit refused; the refusal is a record of its own, and the node says the same thing in
    // words so a person reading the Run's nodes does not have to go and find it.
    return blockNode(ctx, node, attempt, `the site's permit refused to launch ${launched.record.path}: ${launched.record.reason}`);
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
  await progress(ctx, launch.meters, running);
  if (ctx.nonblocking) return { kind: 'pending', session };
  return waitForJob(ctx, node, attempt, session, launch.reads?.finish);
}

/**
 * What settles a node whose Job has ended: `settleFinished` for a Job whose exit code is the whole
 * answer, and something with a read of its own for a Job that wrote a file the node is about (#61).
 *
 * A parameter rather than a branch inside `waitForJob`, because the poll is the same poll whatever
 * the Job was: a caller that has something to read before the node may be called `done` says so where
 * it launches, and the turn that picks that Job up again after a restart says the same thing.
 */
type FinishJob = (ctx: Driving, node: PackNode, attempt: number, session: string, exitCode: number) => Promise<Step>;

/**
 * Wait for one act node's Job and settle the node from what became of it.
 *
 * Reached two ways, and that is the whole of what lets a Run survive its host: the launch above walks
 * into it holding the session it just created, and a reconciliation after a restart (`reconcileRuns`)
 * re-enters it for a Job some earlier process launched, from the session name that Job's own record
 * holds. Nothing in here launches anything, so a Run picked up again never pays for a second
 * generation — the Job it is waiting for is the one already running on the Site.
 */
export async function waitForJob(ctx: Driving, node: PackNode, attempt: number, session: string, finish: FinishJob = settleFinished): Promise<Step> {
  const waitingSince = Date.now();
  const stopSignal = ctx.stopSignal ?? ctx.deps.stopSignal;
  /** When the current stretch of unreadable looks began, and undefined while the Site is answering
   *  (#18). One line for the stretch and one when it clears — a Loop polling for hours must not fill
   *  the host log with a line per look. */
  let unreadableSince: number | undefined;
  for (;;) {
    if (stopSignal?.aborted) return { kind: 'stopped' };
    // Asked before each look and again after it, because the answer can change while the look is in
    // flight: a Run being stopped from another face is that face's to finish writing, and a Job that
    // disappears because someone killed it deliberately must not be recorded here as one that vanished.
    //
    // This is also the first thing `toolNode` reaches once its `launched` record exists, which is what
    // makes a launch that crossed a cancel this loop's to clean up rather than nobody's.
    if (stoppedElsewhere(ctx, session)) return stoppedWithJob(ctx, node, attempt, session, finish);
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
      if (stopSignal?.aborted) return { kind: 'stopped' };
      if (stoppedElsewhere(ctx, session)) return stoppedWithJob(ctx, node, attempt, session, finish);
      if (timeBoxSpent(existingRun(ctx.deps.ledger, ctx.runId), ctx.waitedMs)) return timeBoxReached(ctx, node, attempt, session, finish);
      await waitForNextPoll(waitingSince, stopSignal);
      continue;
    }
    if (stopSignal?.aborted) return { kind: 'stopped' };
    if (unreadableSince !== undefined) {
      toHostLog(ctx, `run ${ctx.runId} at node ${node.id}: site ${ctx.site.name} is answering again about tmux session ${session} after ${Date.now() - unreadableSince} ms`);
      unreadableSince = undefined;
    }
    if (stoppedElsewhere(ctx, session)) return stoppedWithJob(ctx, node, attempt, session, finish);
    if (status.state.state === 'finished') {
      const { exitCode } = status.state;
      // Exit 0 settles the node. Anything else is a failed attempt, and what becomes of a failed
      // attempt is the Retry allowance's to say, in one place, never here.
      return exitCode === 0
        ? finish(ctx, node, attempt, session, exitCode)
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
    if (timeBoxSpent(existingRun(ctx.deps.ledger, ctx.runId), ctx.waitedMs)) return timeBoxReached(ctx, node, attempt, session, finish);
    await waitForNextPoll(waitingSince, stopSignal);
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
 * while the tool still holds it, which is the promise both the cancel and the time box are written
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
 *
 * @param finish - what settles a Job of this node that turns out to have ended by itself, which for
 *                 an observe node is its reading being read back (#61) and not an exit code.
 */
async function stoppedWithJob(ctx: Driving, node: PackNode, attempt: number, session: string, finish: FinishJob = settleFinished): Promise<Step> {
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
  //
  // Through this node's own `finish` and not through `settleFinished` (#61): a Job that finished
  // before the kill has written whatever it was launched to write, and at an observe node that is
  // the Run's reading. Settling such a node from the exit code would call it `done` with nothing
  // read, validated or recorded, and a Run whose ending another face is composing would carry a
  // generation it never observed. What the reader wrote is read back — or refused — exactly as it
  // would have been had no cancel crossed it, and only then does the node settle.
  const after = await jobStatus(ctx.deps, { run: ctx.runId, session });
  if (after.state.state === 'finished') await finish(ctx, node, attempt, session, after.state.exitCode);
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
  const tailed = failure.jobSession === undefined ? undefined : await tailOfJob(ctx, failure.jobSession);
  const logTail = tailed?.ok === true ? tailed.text : undefined;
  // An absent key, never an undefined one: a failure with no exit status and no log says so by omission.
  const exit = failure.exitCode === undefined ? {} : { lastExitCode: failure.exitCode };
  const tail = logTail === undefined ? {} : { logTail };
  const inBranch = ctx.branchId === undefined ? {} : { branchId: ctx.branchId };
  await ctx.deps.ledger.appendBlocker(ctx.runId, { nodeId: node.id, attempts: attempt, ...inBranch, ...exit, ...tail, reason });
  await appendNode(ctx, node, 'blocked', attempt, { ...session, reason });
  return { kind: 'hard-blocker' };
}

/**
 * The tail of a Job's log, bounded, or why it could not be had.
 *
 * Both answers and not one, because the two callers want different things of a log that will not
 * read. A blocker record leaves the tail absent and says everything else it knows — a failure to tail
 * a log is not a second failure worth losing the first one over — while the instructions of a retry
 * put the reason in front of the model, because "the log could not be read" is itself evidence about
 * the attempt before. Either way the reason is answered rather than swallowed.
 */
async function tailOfJob(ctx: Driving, session: string): Promise<{ readonly ok: true; readonly text: string } | { readonly ok: false; readonly why: string }> {
  try {
    return { ok: true, text: (await jobTail(ctx.deps, { run: ctx.runId, session, lines: blockerTailLines })).text.slice(-blockerTailChars) };
  } catch (err) {
    return { ok: false, why: (err as Error).message };
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
 *   the tool still holds it, which is exactly the promise the time box exists to keep. The node is
 *   blocked naming the session, the Run waits, and a person is told which session to look at.
 */
async function timeBoxReached(ctx: Driving, node: PackNode, attempt: number, session: string, finish: FinishJob = settleFinished): Promise<Step> {
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
    await finish(ctx, node, attempt, session, after.state.exitCode);
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
  if (!ctx.nonblocking) await progress(ctx, { attempts: 1 });
  const blocked = (reason: string): Promise<Step> => blockNode(ctx, node, attempt, reason);
  const output = ctx.pack.contract.outputs.find((o) => o.name === node.parameters.observes);
  if (!output) {
    return blocked(`node ${node.id} observes output "${node.parameters.observes}", which this pack's contract does not declare`);
  }
  // What this pack's value types mean, read here and once, for whichever reader turns out to read
  // this output (#61). The pack's own `semantics.yml` first, the bundle's second, and a file that is
  // there and will not open blocks the node naming it — never a reading quietly held to the bundle's
  // vocabulary because the pack's could not be read. Read at the node and as the folder stands, as a
  // rule and a chooser are, so a pack edited between generations is read as it now is — where
  // `checkPack` reads every one of these out of the one reading the pack was parsed from, because a
  // check is one statement about one instant (#64, `packDataAt`).
  let semantics: Semantics;
  try {
    semantics = semanticsOf(ctx.pack, 'as it stands');
  } catch (err) {
    return blocked(`node ${node.id} cannot read what this pack's value types mean: ${(err as Error).message}`);
  }
  // Whose reader reads it (#61). A pack that declares one of its own runs that script on the Site;
  // one that declares none runs the bundled reader its contract names, exactly as before. The
  // resolution fails closed: a `readers/` that is there and will not open is the node blocked naming
  // the path, never a quiet fall to the bundle's library under the pack's own reader id. Read as the
  // folder stands, for the reason the semantics above are (#64): the check is snapshot-bound, a node
  // is live.
  let reading: PackReading;
  try {
    const found = packReading(ctx, node, output, attempt);
    if (found === undefined) return observeWithBundledReader(ctx, node, attempt, output, semantics);
    if (!found.ok) return blocked(found.reason);
    reading = found.reading;
  } catch (err) {
    return blocked(`node ${node.id} cannot resolve the reader of output "${output.name}": ${(err as Error).message}`);
  }
  return runPackReader(ctx, existingRun(ctx.deps.ledger, ctx.runId), node, attempt, reading);
}

/**
 * The bundled path: the report is read with a reader this bundle ships, and what it read is held
 * against **the pack's** resolved semantics (#61).
 *
 * The pack's, and not the bundle's, though the reader is the bundle's: a pack's own `semantics.yml`
 * resolves ahead of this bundle's, so a pack may declare that a name the bundle also declares means
 * something else in its method (D46) — and a reading taken at one of that pack's nodes is a reading
 * of that method whichever code did the reading. Validating it against the bundle's declaration
 * instead would let a pack's rules and choosers, which pack check holds against the *resolved*
 * vocabulary, compare against values nobody held to the same one.
 */
async function observeWithBundledReader(
  ctx: Driving,
  node: Extract<PackNode, { kind: 'act' }>,
  attempt: number,
  output: ContractOutput,
  semantics: Semantics,
): Promise<Step> {
  const at = pathsOf(ctx.site).join(ctx.workspace, outputPath(output, ctx.bindings));
  const result = await observeForPack(ctx.deps, {
    site: ctx.site.name,
    path: at,
    reader: output.reader,
    run: ctx.runId,
    // Whose reading this is, inside a fork: what the join judges each branch on (#29).
    ...(ctx.branchId === undefined ? {} : { branchId: ctx.branchId }),
  }, semantics);
  if (result.kind === 'observed') {
    await appendNode(ctx, node, 'done', attempt);
    return { kind: 'settled' };
  }
  // A refusal is a record of its own; the node says the same thing in words.
  return blockNode(ctx, node, attempt, `${result.record.path} was not read: ${result.record.reason}`);
}

// ---------------------------------------------------------------------------------------------
// The workshop: the AI writes a script inside its declared directory, and the fabric runs it (#62)
// ---------------------------------------------------------------------------------------------

/**
 * **Open a Model moment at this node, record what it writes, and run the entry it wrote as a Job.**
 *
 * The one place a model takes part in a Campaign's execution. Everything about what gets written is
 * the pack's — the purpose, the directory, the entry, the command line, what may be read, what must
 * be produced — and everything about *how* is this harness's: one isolated session with three tools
 * that reach a Site only through HimaShell under the Permit, one `code` record per file that actually
 * landed, and then a Job like any other tool's.
 *
 * In order, and every step fails closed:
 *
 *  1. the attempt is opened and counted, as an observe node's is, so the Job below adds the Job alone;
 *  2. everything the moment will be composed from is resolved — a half-resolved declaration is a
 *     blocked node naming the thing, never a moment opened over it;
 *  3. the directory is made on the Site, under its own write decision;
 *  4. the moment is opened with the three tools and the instructions;
 *  5. the moment is asked one thing and closed;
 *  6. the entry must be a `code` record of *that session*, or the attempt failed;
 *  7. what was written is launched and waited for, and settles from its exit code as a tool's does.
 *
 * A failure at 5 or 6 goes through the same accounting a non-zero exit does (`settleFailedAttempt`):
 * `retrying` while the allowance stands, and otherwise the `blocker` record and a Run routed to the
 * pack's Wait node. A restart mid-moment is nothing new — the next boot writes the one
 * `closed: interrupted` and the reconciliation blocks the node for a person, because nothing here
 * re-asks a model on its own.
 */
export async function workshopNode(ctx: Driving, node: Extract<PackNode, { kind: 'act' }>, attempt: number): Promise<Step> {
  const blocked = (reason: string): Promise<Step> => blockNode(ctx, node, attempt, reason);
  // Counted here, where the moment is about to open, exactly as an observe node counts its attempt
  // before its reader's Job: a moment that fails is an attempt this node made, and the Job below
  // therefore adds `{ jobs: 1 }` alone.
  await appendNode(ctx, node, 'running', attempt);
  await progress(ctx, { attempts: 1 });

  if (ctx.deps.host === undefined) return blocked(`node ${node.id} opens a workshop, which is a model moment, and this drive was given no host to compose one on`);
  const resolved = await resolveWorkshop(ctx, node);
  if (!resolved.ok) return blocked(resolved.reason);
  const { declaration, workshopAbs, entryAbs, reads, knowledge, produces, values, argv } = resolved;

  const session: WorkshopSession = { id: undefined };
  // Where a write that landed, verified, and that the ledger would not record says so. Read after the
  // moment has closed, below: a tool cannot stop a turn — dsh hands the model a failed result and the
  // turn goes on — so this is how the one failure a Campaign must not carry on past reaches the
  // drive. The same failure writes the path to the host log where it happens, which is what covers a
  // host that never gets as far as reading this box.
  const fault: WorkshopFault = { why: undefined };
  const tools = workshopTools({
    ledger: ctx.deps.ledger,
    runId: ctx.runId,
    site: ctx.site,
    nodeId: node.id,
    attempt,
    session,
    fault,
    // The host log, with this module's one `hima:` prefix on it, exactly as the Job poll's is.
    log: (line) => toHostLog(ctx, line),
    declaration,
    workshopAbs,
    reads,
    knowledge,
    ...(ctx.branchId === undefined ? {} : { branchId: ctx.branchId }),
  });
  const instructions = workshopInstructions({
    declaration,
    nodeId: node.id,
    attempt,
    allowance: retryStanding(ctx.deps.ledger, ctx.runId, node.id).allowance,
    // What the attempt before this one did, for every attempt but the first (#62). Evidence and not
    // a gate: a model asked to write the same script a second time with nothing about why the first
    // one failed is a model that will write the same script.
    ...(await previousAttemptOf(ctx, node.id, attempt)),
    siteName: ctx.site.name,
    workshopAbs,
    entryAbs,
    argv,
    reads,
    knowledge,
    produces,
    values,
  });

  // The node's own attempt and not `nextMomentAttempt`: one moment per node attempt, so the session
  // records and the node records number the same thing and a person reading either reads one story.
  let moment;
  try {
    moment = await openMoment({ ledger: ctx.deps.ledger, ctx: ctx.deps.host }, {
      runId: ctx.runId,
      nodeId: node.id,
      attempt,
      preset: HIMA_MOMENT_PRESET,
      instructions,
      tools,
      cwd: ctx.workspace,
      // What makes this node readable as a workshop off the ledger alone (#62): which workshop, the
      // file that runs, and where that file is. None of the three is in any other record a Run
      // writes, and a card that looked them up in the pack folder would go blank for a pack a person
      // had since edited. The path is the one this turn will launch on, so the fold that asks whether
      // the entry was written asks it of the same string this turn does.
      workshop: { id: declaration.id, entry: declaration.entry, entryPath: entryAbs },
    });
  } catch (err) {
    // Nothing was composed and nothing was recorded (`openMoment` says so of every way it throws), so
    // this is a node that could not take its turn rather than an attempt that failed at one: the pack
    // or the host is what a person has to fix, and a Retry allowance spent on three identical
    // refusals would turn one clear sentence into a Hard blocker.
    return blocked(`node ${node.id} could not open the model moment its workshop "${declaration.id}" needs: ${(err as Error).message}`);
  }
  session.id = moment.sessionId;

  let said: string | undefined;
  let failure: string | undefined;
  try {
    said = (await moment.ask(workshopAsk(declaration.entry))).text;
  } catch (err) {
    failure = `the model moment of workshop "${declaration.id}" failed: ${(err as Error).message}`;
  }
  // Closed either way, and before anything else is decided: an open session belongs to this process
  // and to nothing else, and a turn that walked away from one would leave the next boot to record it
  // `interrupted` — a moment that really ran, remembered as one that was cut off.
  await moment.close(failure === undefined ? 'completed' : 'failed');

  // A byte on the Site this Run has no record of, if the moment left one: a write that landed and
  // verified and that the ledger would not record. The node blocks rather than retrying — a retry
  // would write another one — and it is a Hard blocker because what a person has to do about it is
  // on the Site, not in this Campaign. Nothing was removed and nothing will be: the bytes are there
  // and the blocker says where.
  //
  // **Best effort, and one of three tellings.** This is read only if this turn gets here: a host that
  // goes away inside the same moment leaves the box in memory with the process, which is precisely
  // the state a failing ledger makes likely. The other two — the model's own answer and the host log
  // line written where the append failed — do not depend on it.
  if (fault.why !== undefined) return blocked(`node ${node.id} cannot account for what its workshop "${declaration.id}" left on site ${ctx.site.name}: ${fault.why}`);
  if (failure !== undefined) return settleFailedAttempt(ctx, node, attempt, { reason: failure });

  // The one thing a completed moment has to have done. `said` is the model's words and is deliberately
  // not read for meaning: what says the entry was written is a `code` record of *this session* at
  // *this path*, which is a fact about bytes on the Site rather than a claim in a sentence.
  const entryRecord = ctx.deps.ledger
    .records({ runId: ctx.runId, type: 'code' })
    .findLast((r): r is CodeRecord => r.type === 'code' && r.sessionId === moment.sessionId && r.path === entryAbs);
  if (entryRecord === undefined) {
    return settleFailedAttempt(ctx, node, attempt, {
      reason: `the model wrote no ${declaration.entry} in workshop "${declaration.id}"${said === undefined || said.trim() === '' ? '' : `; it said: ${said.trim()}`}`,
    });
  }

  return launchWrittenWorkshop(ctx, node, attempt, moment.sessionId);
}

/** Resolve the existing controlled Workshop tools for the owning conversational Agent. */
export async function buildWorkshopScope(ctx: Driving, node: Extract<PackNode, { kind: 'act' }>, attempt: number, sessionId: string): Promise<
  { readonly ok: true; readonly scope: WorkshopScope; readonly resolved: ResolvedWorkshop } | { readonly ok: false; readonly reason: string }
> {
  const resolved = await resolveWorkshop(ctx, node);
  if (!resolved.ok) return resolved;
  return { ok: true, resolved, scope: {
    ledger: ctx.deps.ledger, runId: ctx.runId, site: ctx.site, nodeId: node.id, attempt,
    session: { id: sessionId }, fault: { why: undefined }, log: (line) => toHostLog(ctx, line),
    declaration: resolved.declaration, workshopAbs: resolved.workshopAbs,
    reads: resolved.reads, knowledge: resolved.knowledge,
    ...(ctx.branchId === undefined ? {} : { branchId: ctx.branchId }),
  } };
}

/** Launch recorded Workshop bytes through the common Job path, without opening a model session. */
export async function launchWrittenWorkshop(ctx: Driving, node: Extract<PackNode, { kind: 'act' }>, attempt: number, sessionId: string): Promise<Step> {
  const resolved = await resolveWorkshop(ctx, node);
  if (!resolved.ok) return blockNode(ctx, node, attempt, resolved.reason);
  const { declaration, workshopAbs, entryAbs, argv } = resolved;
  const latest = new Map<string, CodeRecord>();
  for (const record of ctx.deps.ledger.records({ runId: ctx.runId, type: 'code' })) {
    if (record.type === 'code' && record.sessionId === sessionId && record.nodeId === node.id &&
        record.attempt === attempt && record.branchId === ctx.branchId && within(record.path, workshopAbs, ctx.site)) latest.set(record.path, record);
  }
  const entry = latest.get(entryAbs);
  if (!entry) return settleFailedAttempt(ctx, node, attempt, { reason: `no recorded ${declaration.entry} in workshop "${declaration.id}" for this execution` });
  for (const record of latest.values()) {
    const stale = await readBack(ctx.site, channelFor(ctx.site), record.path, record.sha256, 'recorded');
    if (stale !== undefined) return settleFailedAttempt(ctx, node, attempt, { reason: stale });
  }
  return launchAndWait(ctx, existingRun(ctx.deps.ledger, ctx.runId), node, attempt, {
    argv, licences: declaration.licences, jobName: `workshop-${declaration.id}`, meters: { jobs: 1 },
    workshop: { id: declaration.id, entry: { path: entry.path, sha256: entry.sha256 } },
  });
}

/** Everything a workshop's moment is composed from, once every piece of it has been resolved. */
export interface ResolvedWorkshop {
  readonly ok: true;
  readonly declaration: PackWorkshop;
  readonly workshopAbs: string;
  readonly entryAbs: string;
  readonly reads: readonly WorkshopReadable[];
  readonly knowledge: readonly WorkshopKnowledge[];
  readonly produces: WorkshopProduces;
  readonly values: Readonly<Record<string, string>>;
  readonly argv: readonly string[];
}

/**
 * Resolve everything a workshop node needs, and make its directory on the Site — or say what stopped
 * it.
 *
 * Every lookup here fails closed and every one of them happens *before* a moment is opened, because a
 * moment opened over a half-resolved declaration is a model told to produce something against a
 * reader nobody could find. The directory is last, because it is the only step that asks the Site for
 * anything, and a refusal there is a `refusal` record like every other thing the Permit stopped.
 */
export async function resolveWorkshop(
  ctx: Driving,
  node: Extract<PackNode, { kind: 'act' }>,
): Promise<ResolvedWorkshop | { readonly ok: false; readonly reason: string }> {
  const no = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });
  const named = node.parameters.workshop!;
  const declaration = ctx.pack.contract.workshops.find((w) => w.id === named);
  if (!declaration) return no(`node ${node.id} opens workshop "${named}", which this pack's contract does not declare`);

  const output = ctx.pack.contract.outputs.find((o) => o.name === declaration.produces);
  if (!output) return no(`workshop "${declaration.id}" produces "${declaration.produces}", which this pack's contract does not declare`);
  if (output.reader === undefined) return no(`workshop "${declaration.id}" produces "${output.name}", which declares no reader, so nothing it writes could become an observation`);

  // What the reader of the produced output emits, and what each of those types means. Both are what
  // the model is told it must produce, so a failure to resolve either blocks the node naming the
  // thing rather than opening a moment that would be told nothing about its own output. Read as the
  // folder now stands, as the observe node's two reads are and for the same reason (#64,
  // `packDataAt`): a moment opens at a node, and a pack edited between generations is the correction.
  let emits: readonly string[];
  try {
    const own = resolvePackReader(ctx.pack, output.reader, 'as it stands');
    if (own.kind === 'broken') return no(`workshop "${declaration.id}" produces "${output.name}", whose reader is declared at ${own.at} and is not one: ${own.reason}`);
    if (own.kind === 'declared') emits = own.declaration.emits;
    else {
      const bundled = readerNamed(output.reader);
      if (!bundled) return no(`workshop "${declaration.id}" produces "${output.name}", whose reader "${output.reader}" is neither this pack's nor one this harness ships`);
      emits = bundled.emits;
    }
  } catch (err) {
    return no(`workshop "${declaration.id}" cannot resolve the reader of "${output.name}": ${(err as Error).message}`);
  }
  let semantics: Semantics;
  try {
    semantics = semanticsOf(ctx.pack, 'as it stands');
  } catch (err) {
    return no(`workshop "${declaration.id}" cannot read what this pack's value types mean: ${(err as Error).message}`);
  }

  const p = pathsOf(ctx.site);
  const reads: WorkshopReadable[] = [];
  for (const name of declaration.reads) {
    const readable = ctx.pack.contract.outputs.find((o) => o.name === name);
    if (!readable) return no(`workshop "${declaration.id}" reads "${name}", which this pack's contract does not declare`);
    reads.push({ name, path: p.join(ctx.workspace, outputPath(readable, ctx.bindings)) });
  }

  // The knowledge files on *this* machine, and what is really at each path: a moment composed to read
  // a file that is not there is a moment that would be told to read it and then told it cannot, which
  // is a pack fault said one turn too late. `/hima pack check` says the same thing before a Campaign
  // starts, and holds each to the same `lstat`.
  //
  // `lstat` and not `exists`: a directory, and a link to anywhere at all, are both things that are
  // "there" and neither is a knowledge file — and a lookup that fails for any other reason (a
  // permission, an I/O error) is a thing this could not find out rather than a file that is missing,
  // so it blocks the node naming the path instead of reading as absence.
  const knowledge: WorkshopKnowledge[] = [];
  for (const file of declaration.knowledge) {
    const entry = ctx.pack.contract.knowledge.find((k) => k.file === file);
    if (!entry) return no(`workshop "${declaration.id}" names the knowledge file "${file}", which this pack's contract does not declare`);
    const at = path.join(packKnowledgeDir(ctx.pack), file);
    let there;
    try {
      there = lstatSync(at, { throwIfNoEntry: false });
    } catch (err) {
      return no(`workshop "${declaration.id}" cannot look at the knowledge file "${file}" at ${at}: ${(err as Error).message}`);
    }
    if (there === undefined) return no(`workshop "${declaration.id}" may read the knowledge file "${file}", which is not at ${at}`);
    if (!there.isFile()) return no(`workshop "${declaration.id}" may read the knowledge file "${file}" at ${at}, which is not a plain file`);
    knowledge.push({ file, purpose: entry.purpose, at });
  }

  const taken = nodeArguments(node, existingRun(ctx.deps.ledger, ctx.runId));
  if (!taken.ok) return no(taken.reason);

  // The directory, decided and then made — and then held to being **the declared path and nothing
  // else**.
  //
  // The rule, in one sentence: the workshop's root is `<workspace>/<directory>` as the Site really
  // has it, and a root that resolves anywhere but to itself is a node blocked rather than a workshop
  // opened somewhere else. Without that, a link an earlier Job or a Site user left — `alias -> flow`,
  // or a case alias on a case-insensitive Site — would be a directory the Permit happily allows
  // (every one of these paths is inside the Campaign workspace) and every later containment check
  // would then be authorising writes into whatever it points at. The declaration's first segment is
  // held against `flow` and `hima-readers` at load, which is the early word; this is the one that
  // cannot be spelled around, because it is made after resolution.
  //
  // Both sides of the comparison are resolved: the workspace itself may perfectly well lie under a
  // link (a `/tmp` that is really `/private/tmp` is exactly this Mac), so comparing a resolved root
  // against an unresolved join would refuse every workshop on such a Site.
  const channel = channelFor(ctx.site);
  const wanted = p.join(ctx.workspace, declaration.directory);
  const decided = await decideWrite(ctx.site, wanted, channel);
  if (!decided.ok) {
    await ctx.deps.ledger.appendRefusal(ctx.runId, { path: decided.refused, reason: decided.reason }, 'executor');
    return no(decided.reason);
  }
  await mustRun(channel, ['mkdir', '-p', '--', decided.absPath], `create the workshop directory ${decided.absPath} on site ${ctx.site.name}`);
  let workshopAbs: string;
  let realWorkspace: string;
  try {
    workshopAbs = await channel.realpath(decided.absPath);
    realWorkspace = await channel.realpath(ctx.workspace);
  } catch (err) {
    return no(`workshop "${declaration.id}" cannot resolve its own directory ${decided.absPath} on site ${ctx.site.name}: ${(err as Error).message}`);
  }
  const itself = p.join(realWorkspace, declaration.directory);
  if (workshopAbs !== itself) {
    const why = `the workshop directory ${itself} resolves to ${workshopAbs}, which is not itself`;
    await ctx.deps.ledger.appendRefusal(ctx.runId, { path: wanted, reason: why }, 'executor');
    return no(`workshop "${declaration.id}" will not open: ${why}`);
  }
  // And the same question asked of the two directories the workspace anatomy owns, from the other
  // side: a `flow` that is itself a link to the workspace would make every path in the workspace
  // "inside the golden flow's copy", which the first segment's name could never have said. Asked of
  // what is really there, and only of what is there at all — a workspace whose reader directory has
  // not been made yet contains nothing to collide with, and `absent` answers that without following
  // a link and rejects when it cannot tell.
  for (const own of [flowDirName, READERS_DIR]) {
    const at = p.join(realWorkspace, own);
    let real: string | undefined;
    try {
      real = (await channel.absent(at)) ? undefined : await channel.realpath(at);
    } catch (err) {
      return no(`workshop "${declaration.id}" cannot tell what ${at} is on site ${ctx.site.name}: ${(err as Error).message}`);
    }
    if (real === undefined || !within(workshopAbs, real, ctx.site)) continue;
    const why = `the workshop directory ${itself} resolves to ${workshopAbs}, which is inside ${at}${real === at ? '' : ` (really ${real})`}: ${flowDirName} holds the copy of the golden flow and ${READERS_DIR} holds the pack's readers, and a workshop writes into neither`;
    await ctx.deps.ledger.appendRefusal(ctx.runId, { path: wanted, reason: why }, 'executor');
    return no(`workshop "${declaration.id}" will not open: ${why}`);
  }

  if (ctx.executionId !== undefined) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(ctx.executionId)) return no('a Workshop execution id must be a plain identifier');
    const privateRoot = p.join(workshopAbs, '.executions', ctx.executionId);
    const privateDecision = await decideWrite(ctx.site, privateRoot, channel);
    if (!privateDecision.ok || privateDecision.absPath !== privateRoot) {
      return no(`private Workshop directory ${privateRoot} is not writable as itself`);
    }
    await mustRun(channel, ['mkdir', '-p', '--', privateRoot], `create Workshop execution ${ctx.executionId}`);
    if (await channel.realpath(privateRoot) !== privateRoot) return no(`private Workshop directory ${privateRoot} does not resolve to itself`);
    workshopAbs = privateRoot;
  }

  const entryAbs = p.join(workshopAbs, declaration.entry);
  let argv: string[];
  try {
    // The node's values first and the harness's six last, exactly as a tool's are and for the sharper
    // case: `ENTRY` is the file this turn verified against the `code` record and is about to record
    // as the wrapper's first operand, so a value bound under that name would make `sh ${ENTRY} …`
    // launch as `sh -c …` beside a `launched` block naming the entry. **The boundary is
    // `validatePack`**, which refuses such a binding when the pack loads, naming the node and the
    // name; this order is the second line.
    argv = workshopArgv(declaration, {
      ...taken.values,
      ENTRY: entryAbs,
      WORKSHOP: workshopAbs,
      WORKSPACE: ctx.workspace,
      FLOW_ROOT: ctx.bindings.flowRoot!,
      DESIGN: ctx.bindings.design!,
      CAMPAIGN: ctx.campaignId,
    });
  } catch (err) {
    return no(`node ${node.id} cannot make the command line of workshop "${declaration.id}": ${(err as Error).message}`);
  }

  // What the reader emits, held against what the resolved semantics declares — before a moment is
  // opened and not inside the instructions it composes. A type nothing declares is a half-resolved
  // declaration: the model would be told to produce a value in no unit and with no meaning, the
  // reading of it would be refused by `appendReading` after the Job had already run, and the sentence
  // a person needs would arrive a whole generation late. So the node blocks naming the type and the
  // file the declaration is owed in.
  const declaredEmits: { type: string; declared: SemanticDeclaration }[] = [];
  for (const type of emits) {
    const declared = semantics[type];
    if (declared === undefined) {
      return no(`workshop "${declaration.id}" produces "${output.name}", whose reader "${output.reader}" emits "${type}", which no semantics file declares: add it under values: in ${packSemanticsFile(ctx.pack)}`);
    }
    declaredEmits.push({ type, declared });
  }

  return {
    ok: true,
    declaration,
    workshopAbs,
    entryAbs,
    reads,
    knowledge,
    produces: {
      name: output.name,
      path: p.join(ctx.workspace, outputPath(output, ctx.bindings)),
      reader: output.reader,
      emits: declaredEmits,
    },
    values: taken.values,
    argv,
  };
}

/**
 * **What the attempt before this one did**, as a spread onto the briefing: absent for attempt 1, and
 * for an attempt whose predecessor left no record that says anything.
 *
 * The live check found the hole this fills. A real model wrote an honest three-hundred-line miner,
 * the script exited 1 because nothing on the stand-in said what to count, and the retry opened with
 * the same instructions as the first attempt — so the second attempt could only guess at the same
 * thing again. The reason and the log tail are what a person would look at, and they are what the
 * model is now given.
 *
 * Read off the node's own record of attempt N−1 — `retrying` inside the allowance, `blocked` when the
 * allowance ran out and a person resumed — because both carry the reason the attempt failed and the
 * session of the Job that failed, where there was one. That is also what makes the block survive a
 * resume: attempt 4 after three failures reads attempt 3's Hard blocker, which is the record that
 * says what happened.
 *
 * Evidence and never a gate. A log that will not read says so in the line where it would have been
 * and the moment opens anyway: the model is better off knowing what failed and not why than not
 * opening at all.
 *
 * @param ctx - the drive, for the ledger and the Site the Job's log is on.
 * @param nodeId - the node whose previous attempt is wanted.
 * @param attempt - the attempt about to be made; the one before it is the subject.
 * @returns `{ previous }` when there is something to say, and `{}` when there is not.
 */
export async function previousAttemptOf(ctx: Driving, nodeId: string, attempt: number): Promise<{ readonly previous?: WorkshopAttemptBefore }> {
  if (attempt <= 1) return {};
  const before = nodeRecordsOfGeneration(ctx.deps.ledger, ctx.runId)
    .findLast((r) => r.nodeId === nodeId && r.attempt === attempt - 1 && (r.state === 'retrying' || r.state === 'blocked'));
  if (before === undefined || before.reason === undefined) return {};
  if (before.jobSession === undefined) return { previous: { attempt: before.attempt, reason: before.reason, tail: '(no job ran)' } };
  const tailed = await tailOfJob(ctx, before.jobSession);
  return { previous: { attempt: before.attempt, reason: before.reason, tail: tailed.ok ? tailed.text : `(the log could not be read: ${tailed.why})` } };
}

// ---------------------------------------------------------------------------------------------
// A pack's own reader: a script of the pack's, shipped to the Site and run there as a Job (#61)
// ---------------------------------------------------------------------------------------------

/** Where a pack reader's script and its output live inside the Campaign workspace. One directory per
 *  reader, so a person looking at a workspace sees which reader wrote which file. Declared with the
 *  rest of the workspace anatomy (`packs.ts`), because a pack's own workshop directory is held
 *  against it at load (#62) and the module that validates a pack cannot import this one. */
const READERS_DIR = readersDirName;

/**
 * Everything **the launch** of one pack-reader turn needs that this machine can answer on its own:
 * who the reader is (with the script's bytes already hashed), which report it reads, where its
 * script is shipped to, and where it must write.
 *
 * Computed once, by the turn that launches, and never again: what the *read-back* needs is written
 * onto that Job's own `launched` record (`LaunchedReading`), because the turn that reads a reader's
 * answer is very often in another process and the pack folder is plain files a person edits. The
 * name of `out` still carries the node, the generation and the attempt, so a stale file from an
 * earlier attempt can never be read as this one's answer.
 */
interface PackReading {
  readonly reader: ReaderRef;
  readonly declaration: PackReaderDeclaration;
  /** The script's own bytes, read from the pack folder on this machine: what is shipped, and what
   *  `reader.sha256` is the hash of. */
  readonly scriptBytes: Uint8Array;
  /** The report, joined under the workspace; the Permit resolves it. */
  readonly report: string;
  /** Where the script is shipped to, joined under the workspace. */
  readonly shipTo: string;
  /** Where the script must write its JSON, joined under the workspace. */
  readonly out: string;
}

type FoundPackReading =
  | { readonly ok: true; readonly reading: PackReading }
  | { readonly ok: false; readonly reason: string };

/**
 * The pack's own reader for this output, if it declares one, with everything a turn needs derived.
 *
 * @returns undefined when the pack declares no reader of that id — the bundled library answers —
 *          the reading when it does, or why the declaration is not one this harness will run.
 * @throws when the pack's `readers/` is there and cannot be read at all.
 */
function packReading(
  ctx: Driving,
  node: Extract<PackNode, { kind: 'act' }>,
  output: ContractOutput,
  attempt: number,
): FoundPackReading | undefined {
  if (output.reader === undefined) return undefined;
  const found = resolvePackReader(ctx.pack, output.reader, 'as it stands');
  if (found.kind === 'absent') return undefined;
  if (found.kind === 'broken') return { ok: false, reason: `the reader declared at ${found.at} is not one: ${found.reason}` };
  const declaration = found.declaration;
  const script = packReaderScript(ctx.pack, declaration.file, 'as it stands');
  if (!script.ok) return { ok: false, reason: `reader "${declaration.id}" names the script "${declaration.file}", and ${script.reason}` };
  // The bytes that will be shipped, and the hash *of those bytes*: the record says what ran, not what
  // a declaration claimed. A pack folder is plain files a person edits, so the two are not the same
  // statement and only one of them is evidence.
  let scriptBytes: Uint8Array;
  try {
    scriptBytes = readFileSync(script.at);
  } catch (err) {
    return { ok: false, reason: `reader "${declaration.id}" cannot read its own script at ${script.at}: ${(err as Error).message}` };
  }
  const p = pathsOf(ctx.site);
  const dir = p.join(ctx.workspace, READERS_DIR, declaration.id);
  const generation = existingRun(ctx.deps.ledger, ctx.runId).generation ?? 1;
  return {
    ok: true,
    reading: {
      reader: {
        id: declaration.id,
        version: declaration.version,
        reportKind: declaration.reportKind,
        emits: [...declaration.emits],
        file: declaration.file,
        sha256: createHash('sha256').update(scriptBytes).digest('hex'),
      },
      declaration,
      scriptBytes,
      report: p.join(ctx.workspace, outputPath(output, ctx.bindings)),
      shipTo: p.join(dir, p.basename(declaration.file)),
      out: p.join(dir, `${node.id}-g${String(generation)}-a${String(attempt)}.json`),
    },
  };
}

/**
 * Run one pack reader: ship its script, launch it as a Job, and read back what it wrote.
 *
 * Every step is a mechanism this harness already has, and every path it touches is decided by the
 * Permit before anything is sent: the report is a read decision, the script's destination and the
 * output file are write decisions, and the launch is a launch decision on the wrapper the declaration
 * names. The script is shipped on every observation — it is a small file, and an audit that showed
 * the launch and not the bytes it launched would be an audit of half of it.
 *
 * Nothing a pack wrote is substituted into the command line beyond the literal words its own
 * declaration holds: the four placeholders are computed here, from paths this harness decided.
 */
async function runPackReader(
  ctx: Driving,
  run: RunRecord,
  node: Extract<PackNode, { kind: 'act' }>,
  attempt: number,
  reading: PackReading,
): Promise<Step> {
  const blocked = (reason: string): Promise<Step> => blockNode(ctx, node, attempt, reason);
  const refuse = async (path: string, reason: string): Promise<Step> => {
    await ctx.deps.ledger.appendRefusal(ctx.runId, { path, reason }, 'executor');
    return blocked(reason);
  };
  const channel = channelFor(ctx.site);
  const site = ctx.site;

  // The report first: a reader whose report the Permit will not let this Run read has nothing to run
  // for, and nothing has been shipped or launched when it says so. Its bytes are taken here, before
  // the Job, exactly as `observe()` takes them — so the record's hash is of the report as it stood
  // when the reader was launched, and a report that is gone by the time the Job ends does not lose
  // the reading with it.
  const report = await decideRead(site, reading.report, channel);
  if (!report.ok) return refuse(reading.report, report.reason);
  let seen: ReportSeen;
  try {
    const bytes = await channel.readFile(report.absPath);
    seen = { path: report.absPath, contentSha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.byteLength };
  } catch (err) {
    return refuse(report.absPath, `the report of reader "${reading.reader.id}" cannot be read: ${(err as Error).message}`);
  }

  const dir = pathsOf(site).dirname(reading.shipTo);
  const dirDecision = await decideWrite(site, dir, channel);
  if (!dirDecision.ok) return refuse(dirDecision.refused, dirDecision.reason);
  await mustRun(channel, ['mkdir', '-p', '--', dirDecision.absPath], `create ${dirDecision.absPath} on site ${site.name}`);

  const shipped = await decideWrite(site, reading.shipTo, channel);
  if (!shipped.ok) return refuse(shipped.refused, shipped.reason);
  // `tee` writes what it is given on standard input to the file it names, exactly as a prepared
  // workspace's `workspace.json` is written: the bytes travel the connection, not the command line.
  await mustRun(channel, ['tee', '--', shipped.absPath], `ship reader "${reading.reader.id}" into ${dirDecision.absPath}`, {
    stdin: Buffer.from(reading.scriptBytes),
  });

  const out = await decideWrite(site, reading.out, channel);
  if (!out.ok) return refuse(out.refused, out.reason);

  let argv: string[];
  try {
    argv = reading.declaration.argv.map((word) => literalArgument(substitute(word, {
      READER: shipped.absPath,
      REPORT: report.absPath,
      OUT: out.absPath,
      WORKSPACE: ctx.workspace,
    }, `reader "${reading.reader.id}"`), `reader "${reading.reader.id}" argument`));
  } catch (err) {
    return blocked(`node ${node.id} cannot make the command line of reader "${reading.reader.id}": ${(err as Error).message}`);
  }

  // Everything the read-back will need, settled here and carried on the Job's own `launched` record
  // (#61): the reader as the observation will carry it, the file the script was told to write, and
  // the report as it stood. The turn that reads this Job's answer may be in another process, on
  // another day, over a pack folder a person has edited since — and it may not resolve any of these
  // again, because a hash of bytes no Job ran and an `emits` no script promised are not evidence.
  const launched: LaunchedReading = { reader: reading.reader, out: out.absPath, report: seen };

  // A reader holds no licence: it is a few milliseconds of `sed` over a file the flow already wrote,
  // and a Job that reserved a synthesis seat to count a number would make a Campaign wait for one.
  // The attempt was counted when this node's turn opened, so the meters take the Job alone.
  return launchAndWait(ctx, run, node, attempt, {
    argv,
    licences: {},
    jobName: `reader-${reading.reader.id}`,
    meters: { jobs: 1 },
    reads: { reading: launched, finish: readBackPackReader(launched) },
  });
}

/**
 * What settles the observe node once its reader's Job has ended: read what the script wrote, hold it
 * to the output contract and then to the one validator, and append the observation.
 *
 * **Out of the Job's own `launched` record and out of nothing else** (#61). Everything here that
 * identifies the reading was settled at the launch and written down: which reader, at which version,
 * emitting which types, from which script and the hash of the bytes that actually ran; which file
 * the script was told to write; and the report as it stood when it was read. This turn may be a
 * different process on a different day — a Job outlives its host (#14) — and the pack folder is
 * plain files a person edits, so resolving any of it again would produce a record about bytes no Job
 * ran and hold the answer to a promise no script made.
 *
 * The one thing that *is* read again is what the pack's value types mean, and for the reason a rule
 * and a chooser are read again at every node (#57): the semantics are not evidence about this
 * reading, they are the vocabulary a Campaign of this pack currently speaks, and a pack whose author
 * corrected a unit between generations means the correction.
 *
 * A failure here is a **refusal record** and the node blocked with the same sentence — a pack fault,
 * said the way an observe refusal has always been said — and not a failed attempt: the Job exited 0,
 * so running it again would produce the same JSON, and spending the Retry allowance on it would turn
 * one clear sentence about a pack's script into three of them and a Hard blocker. A reader Job that
 * *failed* is the other case, and `waitForJob` never reaches here for one.
 */
function readBackPackReader(launched: LaunchedReading): FinishJob {
  return async (ctx, node, attempt, session, exitCode) => {
    const { reader, report } = launched;
    const blocked = (reason: string): Promise<Step> => blockNode(ctx, node, attempt, reason, session);
    const refuse = async (reason: string): Promise<Step> => {
      await ctx.deps.ledger.appendRefusal(ctx.runId, { path: report.path, reason }, 'executor');
      return blocked(reason);
    };
    if (exitCode !== 0) return blocked(`reader "${reader.id}" in tmux session ${session} exited ${exitCode}`);
    const channel = channelFor(ctx.site);
    const named = `reader "${reader.id}"`;
    const wrote = await decideRead(ctx.site, launched.out, channel);
    if (!wrote.ok) return refuse(`${named} exited 0 and what it wrote cannot be read: ${wrote.reason}`);
    let bytes: Uint8Array;
    try {
      bytes = await channel.readFile(wrote.absPath);
    } catch (err) {
      return refuse(`${named} exited 0 and ${wrote.absPath} cannot be read: ${(err as Error).message}`);
    }
    let document: unknown;
    try {
      document = JSON.parse(Buffer.from(bytes).toString('utf8'));
    } catch (err) {
      return refuse(`${named} wrote ${wrote.absPath}, which is not JSON: ${(err as Error).message}`);
    }
    const shaped = readingDocument.safeParse(document);
    if (!shaped.success) {
      const wrong = shaped.error.issues.map((i) => `${i.path.join('.') || '<the document itself>'}: ${i.message}`).join('; ');
      return refuse(`${named} wrote ${wrote.absPath}, which is not a reader's output document: ${wrong}`);
    }
    let semantics: Semantics;
    try {
      semantics = semanticsOf(ctx.pack, 'as it stands');
    } catch (err) {
      return refuse(`${named} exited 0 and what this pack's value types mean cannot be read: ${(err as Error).message}`);
    }
    const appended = await appendReading(
      ctx.deps.ledger,
      ctx.runId,
      {
        path: report.path,
        contentSha256: report.contentSha256,
        bytes: report.bytes,
        reader,
        values: shaped.data.values,
        ...(ctx.branchId === undefined ? {} : { branchId: ctx.branchId }),
      },
      semantics,
    );
    if (appended.kind === 'refused') return blocked(appended.record.reason);
    await appendNode(ctx, node, 'done', attempt, { jobSession: session });
    return { kind: 'settled' };
  };
}

/**
 * What settles an observe node whose Job says it was a reader's and whose launch cannot be read back
 * (#61): nothing, ever, into `done`.
 *
 * An observe node launches a Job for one reason — to run a reader script — so a Job of one whose
 * `launched` record this process cannot find, or which does not carry what that launch decided, is a
 * Run whose reading nobody can take. Settling the node from the exit code would advance the Run with
 * no observation in it at all and have the judge that follows rule on the generation before it. So
 * the node is blocked naming the record a person can go and look at, and the Job is still watched
 * until it ends: a blocker is where a Run stops for a person, and this one says exactly what is
 * missing.
 */
function cannotReadBack(session: string, launchedId: string | undefined): FinishJob {
  // Which of the two it is, in its own sentence, because they are two different things to go and
  // look at: a record that is there and says the wrong thing, named so a person can read it, and no
  // record at all, which is a Run whose ledger is missing the launch it was driving.
  const said = launchedId === undefined
    ? 'This run holds no launch record for that session at all.'
    : `Its launch record ${launchedId} says nothing about a reader: it is a tool's launch record, and an observe node launches a job only to run a reader.`;
  return async (ctx, node, attempt) => blockNode(
    ctx,
    node,
    attempt,
    `node ${node.id} was waiting on tmux session ${session}, which is an observe node's job and so a reader's. `
    + `${said} Nothing can be read back, and a node is never done without its observation`,
    session,
  );
}

/**
 * Pick one node's Job up again after a restart: the turn a reconciliation hands the driver in place
 * of a first turn (#14).
 *
 * One function rather than a bare `waitForJob` because of what an observe node's Job now is (#61): a
 * reader Job that ended while no host was watching has written its JSON, and settling that node
 * `done` from the exit code alone would advance the Run with no observation in it at all — the judge
 * that follows would then rule on the generation before it.
 *
 * **The Job's own `launched` record decides which kind it is**, and nothing else does. A record
 * carrying what the launch settled (`LaunchedReading`) is a reader's Job and is read back from that
 * record; a record carrying none is a tool's Job and settles from its exit code, exactly as it
 * always did. The pack folder is not consulted at all — not for the declaration, not for the script
 * — because a pack is plain files a person edits and this turn may be days and one restart away from
 * the launch: a declaration that has changed would hold the answer to a promise no script made, a
 * script that has changed would put a hash of bytes nobody ran on the record, and a declaration that
 * has been *deleted* would make this look like a tool's Job and settle an observe node `done` with
 * no reading in it, which is the fail-open this rule exists to close.
 *
 * An observe node's Job whose launch says nothing is the one case left, and it is a fault rather
 * than a tool: such a node launches a Job only to run a reader. It is watched to its end and the
 * node is blocked naming **that record by its id**, or saying there is none, because nothing settles
 * `done` without an observation and a person told which record to go and look at can see for
 * themselves which of the two happened.
 */
export async function resumeNode(ctx: Driving, node: PackNode, attempt: number, session: string): Promise<Step> {
  const launched = ctx.deps.ledger
    .records({ runId: ctx.runId })
    .findLast((r): r is JobRecord => r.type === 'job' && r.event === 'launched' && r.job.session === session);
  // One question over one stored block, which is why the block is nested and strict: `reading` is
  // there whole or is not there at all, and nothing about the branch can be half true.
  if (launched?.reading !== undefined) {
    return waitForJob(ctx, node, attempt, session, readBackPackReader(launched.reading));
  }
  if (node.kind === 'act' && node.parameters.observes !== undefined) {
    return waitForJob(ctx, node, attempt, session, cannotReadBack(session, launched?.id));
  }
  return waitForJob(ctx, node, attempt, session);
}

/**
 * What this node takes from the Run for this generation, as the tool's own variables — or which
 * argument the Run cannot bind. Nothing is dropped silently: an argument with no value is what makes
 * a command line the pack meant something else, and a Job launched with it would run at a period
 * nobody chose.
 */
export function nodeArguments(
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
export interface ExploreRecommendation {
  readonly ok: true;
  readonly chooser: string;
  readonly chooserOrigin: PackDataOrigin;
  readonly chosen: DecisionRecord['chosen'];
  readonly rationale: DecisionRecord['rationale'];
  readonly cites: string[];
}

export interface ExploreEvidence {
  readonly ok: true;
  readonly chooser: Chooser;
  readonly chooserOrigin: PackDataOrigin;
  readonly constraint: VerdictRecord;
  readonly goal: VerdictRecord;
  readonly observation: ObservationRecord;
  readonly verdicts: readonly VerdictRecord[];
  readonly cites: string[];
}

/** Current evidence is independent of whether the Pack's recommended arithmetic is valid. */
export function exploreEvidence(ctx: Driving, node: Extract<PackNode, { kind: 'explore' }>): ExploreEvidence | { readonly ok: false; readonly reason: string } {
  const no = (reason: string): { readonly ok: false; readonly reason: string } => ({ ok: false, reason });
  const named = node.parameters.chooser;
  if (named === undefined) {
    // The pack is validated at load: an Explore node names a chooser or opens a Loop, exactly one,
    // and the driver takes an opening one somewhere else. Reaching this is a pack that changed under
    // a Run, and it is the pack's fault said as such rather than a chooser id invented for it.
    return no(`node ${node.id} names no chooser, so there is nothing for it to decide with`);
  }
  let chooser: Chooser;
  let chooserOrigin: PackDataOrigin;
  try {
    // Through the pack (#57): its own `choosers/` first, the bundle's second, which is the very list
    // `/hima pack check` resolved this id through before the Campaign started. The resolution says
    // which of the two answered, so the decision record below cannot name a different file than the
    // one this chooser was read from.
    //
    // **As the folder stands, not out of the reading the pack was parsed from** (#64): the check is
    // one statement about one instant and reads the folder's own bytes as they were then; a node is
    // the Campaign running now, and a pack edited between two generations means the correction
    // (D46). `packDataAt` in `packs.ts` sets the two beside each other.
    ({ chooser, origin: chooserOrigin } = resolveChooser(ctx.pack, named, 'as it stands'));
  } catch (err) {
    // `/hima pack check` resolves every chooser id before a Campaign starts, so reaching this means
    // the pack's own folder or the bundle's choosers changed under an installed pack.
    return no((err as Error).message);
  }

  const run = existingRun(ctx.deps.ledger, ctx.runId);
  const loopId = run.loop?.id;
  const generation = run.loop?.generation ?? run.generation ?? 1;
  const here = <R extends { readonly loopId?: string; readonly generation?: number }>(r: R): boolean => r.loopId === loopId && r.generation === generation;
  const lastJudge = nodeRecordsOf(ctx).findLast((r) => r.kind === 'judge' && r.state === 'done' && here(r));
  const judgeNodeOfRun = positionOf(ctx.pack, lastJudge?.nodeId)?.node;
  if (!judgeNodeOfRun || judgeNodeOfRun.kind !== 'judge') {
    return no(`node ${node.id} runs chooser ${chooser.id}, but this run has completed no judge node for it to weigh`);
  }
  const [constraintRule, goalRule] = judgeNodeOfRun.parameters.rules;
  if (constraintRule === undefined || goalRule === undefined) {
    return no(`judge node ${judgeNodeOfRun.id} lists fewer than two rules, so ${chooser.id} has no constraint and goal to weigh`);
  }

  const records = ctx.deps.ledger.records({ runId: ctx.runId });
  const verdicts = records.filter((r): r is VerdictRecord => r.type === 'verdict' && here(r) && r.seq < lastJudge!.seq);
  const observations = records.filter((r): r is ObservationRecord => r.type === 'observation' && here(r) && r.seq < lastJudge!.seq);
  const graph = positionOf(ctx.pack, judgeNodeOfRun.id)!.graph;
  const branches = forkJoinedAt(graph, judgeNodeOfRun.id)?.branches.map((branch) => branch.id) ?? [undefined];
  const required: VerdictRecord[] = [];
  const citedObservations: ObservationRecord[] = [];
  for (const branchId of branches) {
    const observation = observations.findLast((r) => r.branchId === branchId);
    if (observation === undefined) return no(`node ${node.id} has no current observation for ${branchId ?? 'this generation'}`);
    citedObservations.push(observation);
    for (const rule of judgeNodeOfRun.parameters.rules) {
      const verdict = verdicts.findLast((r) => r.branchId === branchId && matchesRule(r, rule));
      if (verdict === undefined || !verdict.cites.includes(observation.id) || verdict.cites.some((id) => !observations.some((r) => r.id === id && r.branchId === branchId))) return no(`node ${node.id} needs a current verdict of ${rule} citing observation ${observation.id}`);
      required.push(verdict);
    }
  }
  const constraint = required.findLast((r) => matchesRule(r, constraintRule))!;
  const goal = required.findLast((r) => matchesRule(r, goalRule))!;
  const observation = citedObservations.at(-1)!;
  return { ok: true, chooser, chooserOrigin, constraint, goal, observation, verdicts: required, cites: [...new Set([...required.map((r) => r.id), ...citedObservations.map((r) => r.id)])] };
}

/** Read the Pack chooser's advice without accepting a decision or changing any Run fact. */
export function exploreRecommendation(ctx: Driving, node: Extract<PackNode, { kind: 'explore' }>): ExploreRecommendation | { readonly ok: false; readonly reason: string } {
  const evidence = exploreEvidence(ctx, node);
  if (!evidence.ok) return evidence;
  const { chooser, chooserOrigin, constraint, goal, observation, cites } = evidence;
  const run = existingRun(ctx.deps.ledger, ctx.runId);
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
  if (!chosen.ok) return { ok: false, reason: chosen.reason };
  return { ok: true, chooser: chooser.id, chooserOrigin, chosen: chosen.chosen, rationale: chosen.rationale, cites };
}

/** Legacy driver adapter; Agent execution reads the recommendation and explicitly chooses. */
export async function exploreNode(ctx: Driving, node: Extract<PackNode, { kind: 'explore' }>, attempt: number): Promise<Step> {
  const advice = exploreRecommendation(ctx, node);
  if (!advice.ok) {
    await appendNode(ctx, node, 'blocked', attempt, { reason: advice.reason });
    return { kind: 'blocked' };
  }
  const { ok: _ok, ...decision } = advice;
  await ctx.deps.ledger.appendDecision(ctx.runId, { nodeId: node.id, ...decision });
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
