// The Site's cap: how much of one Site may be in use at once, and the one step that counts it and
// launches into the count. One reason to change: what holds a slot on a Site and how a slot is
// taken.
//
// **A Site has more than one kind of slot and one cap over all of them**: its `capacity.parallelJobs`
// (D25, D33) and each licence its `capacity.licences` declares (#21). Both are counted across Runs
// and not within one, because a licence and a machine are the Site's and not a Campaign's, and both
// are counted in the same step: a second step over the same Site would be a count another Run can
// launch in between, which is what the chain below exists to prevent. Its data therefore lives with
// jobs and sites and not with the fabric: this module imports the Job operations, the Site and the
// ledger, and nothing of the driver — a Run's graph is nothing to do with how much of its Site is
// free, and both faces that launch reach this the same way.
import { jobSessionThere, jobStatus, launchJob, waitForNextPoll, type JobDeps, type LaunchResult, type LaunchRequest } from './jobs.js';
import { recordNode, type JobRecord, type LaunchedReading, type LaunchedWorkshop, type Ledger, type NodeKind, type RunRecord, givesUpLaunch } from './ledger.js';
import { driving, existingRun } from './runs.js';
import { advance, timeBoxSpent } from './budget.js';
import type { Site } from './sites.js';
import { counted } from './words.js';
import { SiteUnreadableError } from './errors.js';

/**
 * Every launch in flight on one Site of one home, as a promise chain: the check-and-launch of one
 * node runs to its end before the next one's check is taken.
 *
 * **One host process owns a home's ledger.** That is what a dsh storage domain is, and it is the
 * whole reason an in-process lock is enough here: there is no second process to race with, only the
 * Runs this one host is driving. What they race over is real. `awaitSlot` used to return, and then
 * the launch would resolve the workspace on the Site, ask the Permit, ask tmux for a free session
 * name and start it — several awaits — before the `launched` record the next Run's count reads
 * existed at all. Two Runs started in the same instant therefore both passed a check that neither
 * had yet moved, and a Site that declares one slot ran two Jobs: two licences, and the peak memory
 * the cap exists to bound. Chaining the whole step per Site closes that window, because the record
 * of one launch is written before the next count is taken.
 *
 * Keyed on the Ledger and not on the Site's name alone: two homes booted in one process — which the
 * contract suite does — each own a ledger and each have a Site called `local`, and one home's
 * launches are nothing to do with the other's.
 */
const launchesPerSite = new WeakMap<Ledger, Map<string, Promise<unknown>>>();

/**
 * Run one check-and-launch on a Site with no other launch on that Site interleaved.
 *
 * @param ledger - the home's ledger, which is what identifies the host that owns these Sites.
 * @param siteName - the Site the launch is on.
 * @param claim - the whole step: count what the Site holds, and launch if there is room.
 * @returns whatever the step answered; a step that throws leaves the chain usable for the next one.
 */
function claimingSlotOn<T>(ledger: Ledger, siteName: string, claim: () => Promise<T>): Promise<T> {
  const chains = launchesPerSite.get(ledger) ?? new Map<string, Promise<unknown>>();
  launchesPerSite.set(ledger, chains);
  const mine = (chains.get(siteName) ?? Promise.resolve()).then(claim);
  // What is chained on is a settled-either-way copy: one launch that threw must not take every later
  // launch on that Site down with it, and must not leave an unhandled rejection behind either.
  chains.set(siteName, mine.then(() => undefined, () => undefined));
  return mine;
}

/**
 * Which Jobs are really holding this Site's slots right now — asked of the Site, not only of the
 * ledger. These are what every one of the Site's caps is counted over: how many there are against
 * `capacity.parallelJobs` (D25, D33), and what their `launched` records say they hold against
 * `capacity.licences` (#21). Counted across Runs, not within one, because a licence and a machine
 * are the Site's and not a Campaign's.
 *
 * Every Job the ledger still holds open is refreshed through `jobStatus`, which writes the
 * `finished` record the first time it sees a Job end. That is what releases the slot of a Job nobody
 * asked about — one launched from the `/hima job` face and never followed up, or a fabric Job whose
 * Run stopped between the launch and the poll. Without the refresh, such a Job holds a slot until a
 * person thinks to ask about it, and every later Run on that Site sits in `waiting-for-slot` until
 * its own time box runs out.
 *
 * What the refresh leaves is a Job the Site says is running, and a Job the Site says is gone: no
 * session, and no exit status to read. A gone Job holds nothing, but nothing has recorded that it
 * ended either, so it is still counted — unless the Run that launched it has already settled a node
 * against it. Then that Run has given up on the Job and no one will ever write its end, and counting
 * it would queue that Run's own retry behind its own corpse: on a Site with one slot, the retry the
 * Retry allowance exists for would never be launched at all.
 *
 * @param deps - the ledger and where the Sites are installed.
 * @param siteName - the Site to count.
 * @returns the Jobs holding a slot, so a refusal can name what a caller is waiting for.
 */
export async function heldJobSlots(deps: JobDeps, siteName: string): Promise<JobRecord[]> {
  const holding: JobRecord[] = [];
  for (const open of deps.ledger.openJobsOn(siteName)) {
    // The refresh and this caller's half of the rule in one question: `jobStatus` writes the
    // `finished` record the first time it sees a Job end — which settles that launch outright, and is
    // what releases the slot of a Job nobody followed up on — and otherwise says whether the Site
    // still has the session.
    //
    // Ticket #18: and an open Job the Site will not answer about raises out of this loop and takes
    // that attempt at the claim with it. Fail closed, and deliberately — a cap that cannot be counted
    // is not a cap, and launching a second Job onto a Site that may already be running one is how a
    // licence gets double-spent. Nothing is written on the way out either: the only write here is
    // `jobStatus`'s, and a Site that could not be asked makes none. The claim asks again at its next
    // look (`claimSlotAndLaunch`), so this refuses the launch without ending anything.
    const asked = await jobStatus(deps, { run: open.runId, session: open.job.session });
    if (asked.state.state === 'finished') continue;
    if (await launchIsOpen(deps.ledger, open, () => Promise.resolve(asked.state.state === 'gone'))) holding.push(open);
  }
  return holding;
}

/**
 * **A launch is open until something has settled it, and only the Site can settle one for good.**
 * The one rule, stated here once and asked by everything that needs it: the job cap counting what a
 * Site is holding, the cancel working out what to stop, and the reconciliation working out what a
 * restarted host has to pick up.
 *
 * The Job's own `finished` or `killed` record settles it outright: both are written from something
 * that was observed on the Site, so a launch carrying either is over and nothing more will be heard
 * of it. Every caller has ruled those out before it gets here. Nothing else in the ledger is that: a
 * `retrying`, `blocked` or `cancelled` node record naming the `jobSession` is only the Run *saying*
 * it has accounted for that launch, and the Run can be wrong. Three paths write exactly that record
 * about a session that is still there — a kill that did not take, on a cancel (`cancelRun`,
 * `stoppedWithJob`) and on the time box — and that outcome exists precisely because nothing may say a
 * licence was released while the tool still holds it.
 *
 * So the rule is both halves together: **a launch with no `finished` or `killed` record is open
 * unless the Run has accounted for it on a node *and* the Site reports its session gone.** A Site
 * that cannot be asked settles nothing, and the two askers below refuse it differently: `openJob`
 * catches and answers `false`, so the launch stays open and the cancel or the reconciliation goes on
 * to ask the Site about it directly, while the slot count's `jobStatus` throws out of `heldJobSlots`
 * and is caught by `claimSlot`, which launches nothing and answers `unreadable` — and the node's
 * `claimSlotAndLaunch` asks the Site again at its next look until it answers or the Run's time box
 * runs out (#18). Both are fail-closed and neither reads an unanswered Site as a Job that ended;
 * neither writes anything either, because a cap that could not be counted is not evidence of
 * anything that a node record could carry.
 *
 * The Run's half is needed because a Job can end with no record of its own — a Job that vanished
 * wrote no exit status and none is invented for it, so nothing will ever be appended to that Job's
 * history again. Without it, a Job recorded gone would stay open for the life of the Run: a cancel
 * would go looking for it and write a second blocker on an already-blocked node, and the cap would
 * queue that Run's own retry behind its own corpse — on a Site with one slot, the retry the Retry
 * allowance exists for would never be launched at all. The Site's half is needed because the Run's is
 * an account and not an observation: with it alone, a person told "this run was NOT cancelled, its
 * session is still there" would ask a second time and be told the Run was cancelled and had nothing
 * to stop, while the Job ran on — and a Run final at `cancelled` is one `reconcileRuns` passes over
 * for ever.
 *
 * One rule, two askers, and which one asks is the caller's to say because the two questions cost
 * different things. The cancel and the reconciliation ask through `jobSessionThere`, a probe that
 * writes nothing: a face merely working out what is open must not move the Run's history to find out.
 * The job cap asks through `jobStatus`, whose write is the point there — it is what releases the slot
 * of a Job nobody followed up on.
 *
 * Both askers answer "gone" for a session the Run never launched, which is the one fail-open answer
 * in a fail-closed chain, and no caller can reach it: every launch handed to this helper comes from a
 * `launched` record of the very Run being asked about. `openJob` filters that Run's own job records,
 * and the cap walks `openJobsOn`, which is those same records across a Site.
 *
 * @param ledger - where the Run's node records are read from.
 * @param launch - a `launched` record with no `finished` or `killed` record of its own.
 * @param siteSaysGone - how this caller asks the Site whether that session is gone.
 * @returns whether the launch is still open.
 */
export async function launchIsOpen(ledger: Ledger, launch: JobRecord, siteSaysGone: () => Promise<boolean>): Promise<boolean> {
  if (!settledAgainst(ledger, launch)) return true;
  return !(await siteSaysGone());
}

/**
 * Has the Run that launched this Job already settled a node against it? A `retrying`, `blocked` or
 * `cancelled` node record naming the Job's session is that Run saying it has stopped waiting for
 * this Job — the attempt is over however the Job ended, and nothing will write the Job's own end.
 */
function settledAgainst(ledger: Ledger, job: JobRecord): boolean {
  return ledger
    .records({ runId: job.runId, type: 'node' })
    .some((r) => r.type === 'node' && r.jobSession === job.job.session && givesUpLaunch(r));
}

/**
 * The Jobs one Run still has open, newest first: the launches nothing has settled, by the one rule
 * `launchIsOpen` states.
 *
 * With a node named, only that node's; with none, every node's — and in neither case a Job somebody
 * launched into this Run through the `/hima job` face, which belongs to no node and is not the
 * fabric's to wait for or to stop.
 *
 * Every open one and not the first, because a Run can hold several at once now that a fork drives
 * several act nodes at the same moment (#29): a cancel stops all of them, and a Run told it had one
 * Job to stop would leave the other holding a licence on the customer's machine. The callers that
 * want one — a reconciliation picking up the node a Run stands at — take the first.
 *
 * Here rather than in the fabric because "what of this Run is still on the Site" is the same
 * question the cap asks of a whole Site, asked of one Run: the two must not come to different
 * answers about one launch, so they read it through the one rule above.
 *
 * The Site is asked through `jobSessionThere`, the probe that writes nothing — a face merely working
 * out what is open must not write a Job's `finished` record as a side effect of asking — and a Site
 * that cannot be asked answers "not gone", so a launch nobody could ask about stays open.
 *
 * @param deps - the ledger and where the Sites are installed.
 * @param run - the Run whose launches these are.
 * @param nodeId - one node's launches, or every node's when absent.
 * @returns the open launches, newest first.
 */
export async function openJobsOfRun(deps: JobDeps, run: RunRecord, nodeId?: string): Promise<JobRecord[]> {
  const jobs = deps.ledger.records({ runId: run.id, type: 'job' }).filter((r): r is JobRecord => r.type === 'job');
  const ended = new Set(jobs.filter((r) => r.event !== 'launched').map((r) => r.job.session));
  const unsettled = jobs.filter((r) => r.event === 'launched' && !ended.has(r.job.session) && (nodeId === undefined ? r.nodeId !== undefined : r.nodeId === nodeId));
  const open: JobRecord[] = [];
  // Newest first: the launch a node has open is its latest unsettled one, and the Site is asked only
  // about the launches the Run has already accounted for, which is at most a question per attempt.
  for (const launch of unsettled.toReversed()) {
    if (await launchIsOpen(deps.ledger, launch, () => siteSaysGone(deps, launch))) open.push(launch);
  }
  return open;
}

/**
 * Does the Site agree that this Job's session is gone? A Site that cannot be asked answers no: a
 * launch nobody could ask about is one this harness goes on treating as open, because the cost of
 * being wrong the other way is a person told their Job was stopped while it is still running.
 *
 * Answering `yes` on an unanswered Site would settle the launch on nobody's evidence — a cancel
 * would find nothing to stop and end the Run, and a reconciliation would decide the Run had been
 * left with no Job and block it — which is the same invention the raise exists to prevent (#18). The
 * caller that must not go on without an answer asks through `jobStatus` instead, and that one raises.
 */
async function siteSaysGone(deps: JobDeps, job: JobRecord): Promise<boolean> {
  try {
    return !(await jobSessionThere(deps, { run: job.runId, session: job.job.session }));
  } catch {
    return false;
  }
}

/** The scarcities of one Site that a launch is counted against: the Site as it names itself, the
 *  parallel Jobs it will hold, and how many seats of each licence it declares. */
export interface SiteSlots {
  readonly name: string;
  readonly jobs: number;
  readonly licences: Readonly<Record<string, number>>;
}

/** Which of a Site's slots a launch could not have, and by how much: the parallel Job count, or one
 *  named licence. What a caller words its own refusal or its own wait from. */
export type FullSlot =
  | { readonly slot: 'jobs'; readonly held: number; readonly cap: number }
  | { readonly slot: 'licence'; readonly licence: string; readonly held: number; readonly cap: number; readonly wanted: number };

/**
 * What is full on a Site, as a clause both faces build their own sentence around — the node's
 * `waiting-for-slot` reason and the `/hima job launch` refusal. The subject is left to the caller
 * ("site local …", "the site …"), which is the only part of it the two spell differently.
 *
 * One clause because there is one cap: what a person is told about a Site that will not take another
 * Job now must not depend on which of that Site's slots ran out.
 */
export function fullSaid(full: FullSlot): string {
  return full.slot === 'jobs'
    ? `is running ${counted(full.held, 'job')} against a cap of ${full.cap}`
    : `declares ${counted(full.cap, 'licence')} of "${full.licence}" and is holding ${full.held}, and this launch needs ${full.wanted}`;
}

/**
 * **The cap, stated once.** A Site's slots are its parallel Job count *and each licence it declares*
 * (CONTEXT.md, *Budget*: parallel Job count and licences are both allowances of the Site), and a
 * launch may be made only while every one of them has room for it. This answers which slot it could
 * not have, or nothing at all when it fits.
 *
 * Both scarcities are counted here, in the one step that already serializes against every other
 * launch on this Site, and never as a second chain: a licence check taken outside that step would be
 * a count another Run can launch in between, which is exactly the window the job cap's own chain
 * exists to close, and two chains over one Site can deadlock against each other.
 *
 * The Job count is asked first because it is the coarser of the two and the one a Site owner set
 * directly: a Site at its job cap is at it whatever the launch holds, and naming a licence there
 * would tell a person to go and free a seat when what they need is a slot.
 *
 * A licence the Site does not declare counts as none, so a launch holding one can never be made.
 * `checkPack` refuses a pack naming such a licence before a Campaign starts, which is where a person
 * is actually told; this is the fail-closed floor under that, because an unbounded reading of a
 * count the Site never stated is exactly what the licences of a Site are declared to prevent.
 */
function fullFor(site: SiteSlots, holds: Readonly<Record<string, number>>, holding: readonly JobRecord[]): FullSlot | undefined {
  if (holding.length >= site.jobs) return { slot: 'jobs', held: holding.length, cap: site.jobs };
  for (const [licence, wanted] of Object.entries(holds)) {
    const cap = site.licences[licence] ?? 0;
    const held = holding.reduce((sum, open) => sum + (open.licences?.[licence] ?? 0), 0);
    if (held + wanted > cap) return { slot: 'licence', licence, held, cap, wanted };
  }
  return undefined;
}

/** What one look at a Site's slots came to: the Job it launched into a free one, the Jobs that are
 *  holding them with the slot that had no room, or the count that could not be taken at all because
 *  the Site would not answer (#18) — which is neither a free slot nor a full Site, and so is neither
 *  of the other two. */
export type SlotClaim =
  | { readonly kind: 'claimed'; readonly launched: LaunchResult }
  | { readonly kind: 'at-cap'; readonly holding: JobRecord[]; readonly full: FullSlot }
  | { readonly kind: 'unreadable'; readonly error: SiteUnreadableError };

/**
 * **The claim-and-launch step, stated once**: count what the Site is really holding — of Jobs and of
 * every licence this launch would take — and launch into a free slot, with no other launch on that
 * Site interleaved between the count and the launch.
 *
 * The count and the launch are one step because a count another Run can launch in between is not a
 * cap. Both faces that put a Job on a Site come through here — a fabric node's act and a person's
 * `/hima job launch` — because a Job launched by hand runs on the same machine and takes the same
 * licence as one a Run launches, and a cap enforced on one and not on the other is not a cap. What
 * the two do with a full Site differs and is theirs to say: the face refuses and names what is
 * holding the slots, the node waits for one until its time box runs out.
 *
 * The Site is named by `site.name` and never by a name as typed. A Site's identity is the `name:` in
 * its own file: that is what every Job record is stamped with, and what `openJobsOn` finds Jobs by. A
 * name that resolved a different Site's file no longer reaches this step at all — `loadSite` refuses
 * a file whose own name is not the one asked for (#19), which is where a case variant on a
 * case-insensitive filesystem is now stopped — and this keys on the Site's own name so that stays
 * true of anything that ever resolves a Site another way: a count taken under a name no record
 * carries is a list empty by construction, serializing against nobody, and a Site declaring one slot
 * running two Jobs.
 *
 * A Site that will not say how many Jobs it is running is answered `unreadable`, and **the count is
 * the only thing that answer covers** (#18). `heldJobSlots` only asks questions, so a caller may ask
 * it again as often as it likes; `req.launch` sends `tmux new-session`, and a launch that was sent
 * and never answered raises the very same class. Retrying *that* would start a second Job under a
 * freshly drawn session name, over the cap and with nobody watching either — so it is left to raise,
 * out of this step, to whatever fault boundary the caller has. Nothing is written on either path:
 * the only write inside the count is `jobStatus`'s, and a Site that could not be asked makes none.
 *
 * @param deps - the ledger and where the Sites are installed.
 * @param req - the Site as it names itself with its slots, what the launch would hold of each
 *              licence, and the launch to make if there is room for all of it.
 */
export function claimSlot(
  deps: JobDeps,
  req: { readonly site: SiteSlots; readonly holds: Readonly<Record<string, number>>; readonly launch: () => Promise<LaunchResult> },
): Promise<SlotClaim> {
  return claimingSlotOn(deps.ledger, req.site.name, async (): Promise<SlotClaim> => {
    await deps.beforeSlotClaim?.(req.site.name);
    let holding: JobRecord[];
    try {
      holding = await heldJobSlots(deps, req.site.name);
    } catch (err) {
      if (!(err instanceof SiteUnreadableError)) throw err;
      return { kind: 'unreadable', error: err };
    }
    // Both of the Site's scarcities are read out of the one count, so an unreadable Site is one
    // answer and not two: a Site that cannot say how many Jobs it is running cannot say what those
    // Jobs hold of its licences either, and neither is guessed at.
    const full = fullFor(req.site, req.holds, holding);
    if (full) return { kind: 'at-cap', holding, full };
    return { kind: 'claimed', launched: await req.launch() };
  });
}

/** What one attempt at claiming a slot for a node came to: the Job it launched, or a time box that
 *  ran out while the Site was full. */
export type Claim =
  | { readonly kind: 'claimed'; readonly launched: LaunchResult }
  | { readonly kind: 'budget-exhausted' }
  | { readonly kind: 'at-cap'; readonly reason: string }
  | { readonly kind: 'stopped' };

/**
 * Take one of the Site's Job slots for a node and launch in it, waiting for one while the Site is
 * full, or say that the time box ran out first.
 *
 * Being at the cap is a node state of its own, written once rather than on every look, so a person
 * reading a Run that is taking a long time can tell a Site that is full from a Job that is slow. The
 * spent box is asked about before each wait, as the Job poll asks it, so a Run acts on it within one
 * interval however long that interval has grown.
 *
 * A Site that cannot be asked how many Jobs it is running is a third answer, and it is the Job poll's
 * answer exactly (#18): ask again at the next look, write nothing, and let the time box be the only
 * thing that bounds the wait. **The count is the only thing asked again**, for the reason `claimSlot`
 * states: a launch that raises has already sent `tmux new-session` and may simply not have been
 * answered, so it leaves this step for the drive's fault boundary as it always did, and a person is
 * told which Site stopped answering while a Job of theirs may have been starting on it.
 *
 * The count is where a resumed act node lands, and a resumed node's earlier launch is very often one
 * nothing ever settled — a Job that vanished writes no exit status, so no `finished` record is ever
 * written for it — which makes it an open Job on the Site and makes this count the first thing a
 * resume asks. Raising there would leave the row saying `running` with nothing driving it, and
 * `/hima resume` refuses a `running` Run. Nothing of this node is on the Site while a count is all
 * that has been asked, so nothing is left unattended by waiting.
 *
 * @param deps - the ledger and where the Sites are installed.
 * @param req - the Site, the Run and its node, this attempt's number, the command, what a Job of
 *              this node's tool holds of the Site's licences, how long the Run has already spent
 *              waiting on a person, which is what widens its time box, and where a line about a Site
 *              that went quiet goes — the host log and never the ledger.
 */
export async function claimSlotAndLaunch(
  deps: JobDeps,
  req: {
    readonly site: Site;
    readonly run: RunRecord;
    readonly workspace: string;
    readonly node: { readonly id: string; readonly kind: NodeKind };
    readonly attempt: number;
    readonly argv: readonly string[];
    readonly licences: Readonly<Record<string, number>>;
    readonly waitedMs: number;
    readonly nonblocking?: boolean;
    readonly beforeLaunch?: LaunchRequest['beforeLaunch'];
    readonly stopSignal?: AbortSignal;
    /**
     * What the Job is called, when it is not called after the node it belongs to (#61).
     *
     * A node launches one Job and the node's own id is the natural name for it — except at an observe
     * node, which may launch the pack's *reader* script, and a Job named after the node would then be
     * indistinguishable on the Site from the tool Job of a node of that name. `reader-<id>` says what
     * is running in that tmux session while it is running, which is the whole use of a Job's name.
     */
    readonly jobName?: string;
    readonly log?: (line: string) => void;
    /**
     * The branch of a fork this launch is made inside, when it is made inside one (#29). Carried onto
     * the Job's own records and onto the node records written here, and it is what moves this
     * branch's state to `waiting-for-slot` and back — a Site with one slot is exactly what makes a
     * fork's branches take turns, and a person watching one has to be able to see which of them is
     * queued and which is running.
     */
    readonly branchId?: string;
    /** What this launch was decided to read, when it is a pack reader's (#61): carried straight to
     *  the `launched` record, which is where a host that never launched it reads it back from. */
    readonly reading?: LaunchedReading;
    /** The entry a workshop's Job gives its wrapper as the first operand, and the hash it was verified to have (#62): carried straight
     *  to the `launched` record, which is what ties the Job on the audit to the bytes in the ledger. */
    readonly workshop?: LaunchedWorkshop;
  },
): Promise<Claim> {
  const { site, run, node, attempt } = req;
  // An absent key, never an undefined one, on every record this step writes: a launch outside every
  // fork says so by omission.
  const inBranch = req.branchId === undefined ? {} : { branchId: req.branchId };
  // The Site's own declarations as the Run copied them at start, both of them, so a Run is held to
  // the slots it was started under even if the site file has been edited since.
  const slots: SiteSlots = {
    name: site.name,
    jobs: run.budget?.jobCap ?? site.capacity.parallelJobs,
    licences: run.budget?.licences ?? site.capacity.licences,
  };
  const waitingSince = Date.now();
  let announced = false;
  /** When the current stretch of unreadable counts began, and undefined while the Site is answering
   *  (#18). One line for the stretch and one when it clears, as the Job poll logs it. */
  let unreadableSince: number | undefined;
  for (;;) {
    if (req.stopSignal?.aborted) return { kind: 'stopped' };
    const claimed = await claimSlot(deps, {
      site: slots,
      holds: req.licences,
      launch: () =>
        launchJob(deps, {
          site: site.name,
          workspace: req.workspace,
          argv: req.argv,
          name: req.jobName ?? node.id,
          run: run.id,
          nodeId: node.id,
          licences: req.licences,
          ...inBranch,
          ...(req.reading === undefined ? {} : { reading: req.reading }),
          ...(req.workshop === undefined ? {} : { workshop: req.workshop }),
          // Which attempt at the node this Job belongs to, written where the attempt is in hand
          // (#62): a host that picks the Job up after a restart numbers the records it writes for it
          // from here, rather than inferring it from a node record the launch may have outlived.
          attempt,
          beforeLaunch: async (intent) => {
            req.stopSignal?.throwIfAborted();
            await req.beforeLaunch?.(intent);
          },
        }),
    });
    if (req.nonblocking && claimed.kind !== 'claimed') {
      return { kind: 'at-cap', reason: claimed.kind === 'unreadable'
        ? `site ${site.name} cannot be counted: ${claimed.error.message}; nothing was launched`
        : `site ${site.name} ${fullSaid(claimed.full)}; nothing was launched` };
    }
    if (claimed.kind === 'unreadable') {
      // The cap could not be counted, so no launch is attempted. The count is fail-closed either way
      // — no launch onto a Site that may already be at its cap, or already holding every seat of a
      // licence — but "fail closed" is a decision about launching, never a licence to record an
      // outcome, so no node record is written here.
      if (unreadableSince === undefined) {
        unreadableSince = Date.now();
        req.log?.(`run ${run.id} at node ${node.id}: site ${site.name} cannot be asked how many jobs it is running; no launch is attempted while the count cannot be taken — ${claimed.error.message}`);
      }
    } else {
      if (unreadableSince !== undefined) {
        req.log?.(`run ${run.id} at node ${node.id}: site ${site.name} is answering again about its job slots after ${Date.now() - unreadableSince} ms`);
        unreadableSince = undefined;
      }
      if (claimed.kind === 'claimed') return { kind: 'claimed', launched: claimed.launched };
      if (!announced) {
        // Written once rather than on every look, and worded from whichever slot was full when the
        // wait began: what a person needs off this record is that the node is queued behind the Site
        // and not failing, and the Site's whole picture is the Site's own to answer for.
        await recordNode(deps.ledger, run.id, node, 'waiting-for-slot', attempt, {
          ...inBranch,
          reason: `site ${site.name} ${fullSaid(claimed.full)}; this node waits for a slot`,
        });
        // And, inside a fork, the branch itself says so on the row: a Site with one slot is what
        // makes a fork's branches take turns, and which of them is queued is what a person watching
        // one is looking at. Written once, beside the record, and moved back to `running` by the
        // launch that gets a slot.
        //
        // Behind the same question every other move of a fork is behind (#29): the count above is a
        // Site round trip, and a cancel landing inside it would otherwise leave a branch saying it
        // was queued for a slot on a Run somebody had already ended. The record is written either
        // way — a node really did wait for this Site, and the meters and the records say what
        // happened — while the row says only where a Run that is still going stands.
        if (req.branchId !== undefined && driving(existingRun(deps.ledger, run.id))) {
          // Asked again inside the write, where the row it lands on can be seen (as the fork's close
          // asks): the check above is a read a cancel can slip behind.
          await advance(deps.ledger, run.id, {}, { branch: { id: req.branchId, currentNode: node.id, state: 'waiting-for-slot' }, onlyWhileRunning: true });
        }
        announced = true;
      }
    }
    // Asked before the wait, as the Job poll asks it, so a spent box is acted on within one interval.
    // It bounds an unreadable Site exactly as it bounds a full one — the Budget meters the wait
    // whatever the wait is for — and the record says which of the two it was, because a node that
    // says it waited for a slot on a Site nobody could count would be claiming the Site was full.
    if (timeBoxSpent(existingRun(deps.ledger, run.id), req.waitedMs)) {
      await recordNode(deps.ledger, run.id, node, 'cancelled', attempt, {
        ...inBranch,
        reason:
          unreadableSince === undefined
            ? `the time box was spent waiting for a job slot on site ${site.name}; nothing was launched`
            : `the time box was spent while site ${site.name} could not be asked how many jobs it is running; no launch was attempted`,
      });
      return { kind: 'budget-exhausted' };
    }
    await waitForNextPoll(waitingSince, req.stopSignal);
  }
}
