// HimaFabric v1: the runner that owns a Campaign's graph and a Run's state. It executes the four
// node kinds and nothing more (D29): an act node runs one of the pack's tools on the Site as a Job
// and waits for it, or reads one of the contract's outputs into HimaLedger; a judge node asks
// HimaJudge for a verdict per rule and takes the edge the first rule's outcome labels; an explore
// node runs the pack's chooser and records the decision; a wait node stops the Run for a person. A
// node with no outgoing edge ends the Run.
//
// The Loop is what an Explore node's decision opens (D43): a decision that chose a next Strategy is
// followed along that node's `revisit` edge, which is one write of the run row moving the Run back to
// an act node in the next Generation with the Strategy it chose. A decision of goal met or converged
// has no edge to take, and the Run ends where it stands. The Budget's generation limit is what stops
// a Loop that neither meets its Goal nor converges.
//
// Drill-down is that same Loop one level down (#28). An Explore node may open a Loop the pack
// declares beside its graph, and the Run is then driven through *that* graph — the same four node
// kinds, the same revisit edge, its own convergence and its own generation counter — until it
// reaches one of the three endings a Loop can reach. Closing it puts the Run back on the Explore
// node that opened it and the outer graph goes on along the edge that outcome labels. Which graph a
// turn is routed in is not this loop's memory either: it is read off the node the run row stands at,
// because node ids are unique across a pack.
//
// The one property everything here is arranged around: **the engine holds nothing the ledger does
// not**. The Run's status, its current node, its strategy and its meters live on the run row; every
// node transition, every Job, every observation, verdict and decision is a record. The loop below
// re-reads the run row on every turn rather than carrying it, and every number it writes is computed
// from what the ledger already holds, so a second process that picked this Run up would compute the
// same things. That property is what `recovery.ts` rests on: a host picking a Run up after a restart
// rebuilds everything it needs from the ledger and the Site, holding no handle the process that
// started the Run held.
//
// One reason to change: how a Run is driven through its graph — which node takes the next turn, what
// an outcome's edge leads to, and where a Run stops. What a turn itself does is `node-turns.ts`, what
// a Run may spend `budget.ts`, what a Site will hold `job-cap.ts`, and picking a Run up again or
// stopping one `recovery.ts`.
import { boundInputs, checkPack, loadInstalledPack, loadPack, packStageFrom, positionOf, type Pack, type PackCheck, type PackConverge, type PackNode, type RunGraph } from './packs.js';
import { packDigestExcludes, type PackFolderSnapshot } from './pack-folder.js';
import { campaignIdFor, prepareWorkspace, type PrepareResult } from './workspace.js';
import { writeExperience } from './experience.js';
import { loadSite } from './sites.js';
import { driving, existingRun } from './runs.js';
import { recordNode } from './ledger.js';
import type {
  BlockerRecord,
  DecisionRecord,
  JobRecord,
  Ledger,
  LoopOutcome,
  ResumedRecord,
  RunLoop,
  RunProgress,
  RunPurpose,
  RunRecord,
  RunStatus,
  RunStrategy,
  VerdictOutcome,
  WorkspaceRecord,
} from './ledger.js';
import { chosenAs, chosenKind, type ChosenKind } from './record-views.js';
import { allowsRunArgument, allowsTimeBoxMs, runArguments, strategyFrom, timeBoxMsBounds, type StrategyValue } from './run-arguments.js';
import { PackNotFoundError, RunFaultError, RunStartError, SiteUnreadableError } from './errors.js';
import {
  advance,
  attemptOf,
  currentAttemptOf,
  defaultGenerationLimit,
  defaultRetryAllowance,
  defaultTimeBoxMs,
  endBudgetExhausted,
  endGenerationLimit,
  nextGenerationAllowed,
  nextLoopGenerationAllowed,
  timeBoxSpent,
  timeBoxSpentAt,
  waitedMsOf,
} from './budget.js';
import { closeLoop, loopGenerationLimit, openLoop, opensALoop, revisitInLoop } from './loops.js';
import { openForkAt, runFork } from './forks.js';
import {
  appendNode,
  exploreNode,
  judgeNode,
  observeNode,
  progress,
  resumeNode,
  stillDriving,
  toolNode,
  workshopNode,
  type Driving,
  type FabricDeps,
  type Step,
} from './node-turns.js';

/** The dependencies every fabric operation takes, declared with the turn that is handed them and
 *  named again here so a caller finds them beside `startRun`. */
export type { FabricDeps };

/**
 * What a Run of this pack is for when nobody said (#64): the pack folder's own stage decides.
 *
 * A folder the authoring pipeline has started and not finished — anywhere from `intent` to `tested` —
 * is a pack under construction, and a Campaign of it is the author exercising their own work. A
 * folder at `released` is a pack somebody has sealed and installed, and a folder at `none` is a
 * hand-written pack that never went through the pipeline at all, as the one this repository ships is;
 * a Campaign of either is an ordinary Campaign, and marking it a test would put a word on every card
 * of every pack written before the pipeline existed.
 *
 * Read here rather than asked of the caller, so that the mark is a fact about the pack folder as it
 * stands and not a flag three faces each have to remember to pass.
 *
 * @param folder - the one reading of the pack's folder this start is acting on.
 * @returns what the Run is for.
 */
function packPurpose(folder: PackFolderSnapshot): RunPurpose {
  const stage = packStageFrom(folder).stage;
  return stage === 'none' || stage === 'released' ? 'campaign' : 'test';
}

export interface StartRunRequest {
  readonly pack: string;
  readonly site: string;
  /** The Goal as bound parameters, typed and checkable, immutable for the Campaign (D3). */
  readonly goal: Readonly<Record<string, number>>;
  /**
   * What to set the pack's own Strategy knobs to for the first generation, by name (#58). A knob left
   * out takes the default that pack's contract declares, which is where a starting value comes from
   * now: what a Strategy is made of is the pack's, and so is what a Run of it starts at.
   */
  readonly strategy?: Readonly<Record<string, StrategyValue>>;
  /**
   * Start this Run as the **test run** of its pack (#64), whatever stage that pack's folder stands at.
   *
   * The pipeline's test stage says so of its own Run, and a person may say so of a released pack they
   * want to exercise without it counting as a Campaign. Left out, the pack's own folder decides:
   * `packPurpose` below says how, and why a folder still in the pipeline is a test by default.
   */
  readonly test?: boolean;
  readonly timeBoxMs?: number;
  readonly retryAllowance?: number;
  /** How many Generations this Campaign's Loop may open. Absent, the pack's own, then the default. */
  readonly generationLimit?: number;
  /**
   * Called with the run row this start opens, the moment it is opened and before anything is
   * prepared or driven.
   *
   * Which Run a start opened is HimaFabric's to say. A caller that does not wait for the whole
   * Campaign — the workbench's start route, which answers as soon as the Run exists — would
   * otherwise have to work it out by watching the ledger for a row that was not there a moment ago,
   * and two identical starts in flight at the same instant could each answer with the other's Run.
   *
   * The row exactly as it is then: an identity, a Campaign, a Site, a Goal, a Budget and the
   * Strategy it starts with, and no status at all, because whether this Campaign gets a workspace is
   * not yet known. The identity is what a caller needs, and it is enough to watch this Run and no
   * other.
   *
   * A callback that throws does not fault the start: the Run exists by then, and a listener's fault
   * is a fact about the caller. It is logged through `FabricDeps.log` and the Campaign carries on.
   */
  readonly onOpened?: (run: RunRecord) => void;
}

export type StartRunResult =
  /**
   * This Site cannot host this pack. No Campaign, no Run, no record: nothing happened on any Site,
   * and the caller is handed the whole check — the same answer `/hima pack check` gives.
   */
  | { readonly kind: 'unfit'; readonly check: PackCheck }
  /**
   * The Campaign has no workspace to run in: the Permit refused a path, or something is already at
   * the workspace path that is not this Campaign's. The Run exists and carries whatever preparation
   * recorded, and it never got a fabric state — HimaFabric did not start it, and the ledger says so
   * by the absence of a status rather than by a word invented for the case.
   */
  | { readonly kind: 'unprepared'; readonly run: RunRecord; readonly prepared: PrepareResult }
  /** The graph was executed. The Run carries where it got to; `ended-*` and `waiting` are all here. */
  | { readonly kind: 'ran'; readonly run: RunRecord; readonly workspace: string };

/**
 * Start a Campaign of `pack` on `site` toward `goal`, and execute its graph.
 *
 * @param deps - the ledger, HimaJudge, and where sites and packs are installed.
 * @param req - the pack, the Site, the Goal, the first strategy, and the Budget.
 * @returns what the Run did, or why it could not start.
 * @throws RunStartError when the request itself cannot be acted on; PackNotFoundError and
 *         SiteNotFoundError for a pack or Site that is not installed; RunFaultError when a node's
 *         turn threw, after the fault has been recorded against the Run.
 */
export async function startRun(deps: FabricDeps, req: StartRunRequest): Promise<StartRunResult> {
  const site = loadSite(deps.sitesDir, req.site);
  // **One reading of the pack folder, and everything this start says about it is derived from it**
  // (#64) — the contract and graph this Campaign is driven by, the rung the folder stands on, the
  // seal the check verifies, and the digest the row records. Two readings would be two folders
  // whenever anything happened between them: a Run could be driven by one contract and recorded
  // against another folder's digest, and "the seal verified" would be a statement about files this
  // Run did not record. A folder that cannot be read — something in it that is not a plain file, a
  // name no pack file can have, a file this process cannot read — stops the start before a Run
  // exists, naming the path.
  let folder: PackFolderSnapshot;
  let pack: Pack;
  try {
    ({ folder, pack } = loadInstalledPack(deps.packsDir, req.pack));
  } catch (err) {
    if (err instanceof PackNotFoundError) throw err;
    throw new RunStartError(`pack ${req.pack} cannot be run: ${(err as Error).message}`);
  }
  // A pack the Site cannot host is answered before a Campaign exists, exactly as preparation does:
  // nothing was attempted anywhere, so nothing is recorded anywhere.
  const check = checkPack(pack, site);
  if (!check.fit) return { kind: 'unfit', check };

  const goal = { ...req.goal };
  if (Object.keys(goal).length === 0) throw new RunStartError('a run needs a goal, e.g. --goal target_period_ns=2.3');
  // The Strategy this Campaign starts at: the pack's declared defaults, overlaid with whatever the
  // caller set, every value held against the pack's own declaration (#58). Here and not in each
  // face, for the reason the Budget's numbers are re-checked below: `startRun` is an operation of
  // its own — the acceptance script and the contract suite call it directly — and a value no face
  // would pass must not become a Strategy just because it did not arrive through one. A value
  // outside a knob's bounds or outside its list stops the Campaign before a Run exists, in the
  // validator's words, which is what every face shows.
  const first = strategyFrom(pack.contract.strategy, req.strategy);
  if ('error' in first) throw new RunStartError(first.error);
  const strategy = first.strategy;

  const campaignId = campaignIdFor(pack, new Date());
  const budget = {
    timeBoxMs: req.timeBoxMs ?? defaultTimeBoxMs,
    retryAllowance: req.retryAllowance ?? defaultRetryAllowance,
    // The Site's own declaration, copied at start so a Run says what cap it was started under even
    // if the site file is edited afterwards, and what `claimSlotAndLaunch` counts a launch
    // against. Not re-checked below: `loadSite` above already parsed it against the identical bound
    // (`z.number().int().positive()`), so a value the ledger's schema would refuse never reaches
    // this line at all.
    jobCap: site.capacity.parallelJobs,
    // The Site's other declared scarcity, copied for the same reason and checked no further for the
    // same one: `loadSite` parsed it against the identical bound the ledger's schema declares
    // (`z.number().int().nonnegative()` per licence).
    licences: site.capacity.licences,
    // What the person asked for, else what the pack declares its Loop should take at most, else the
    // harness default. Copied onto the Budget at start exactly as the Site's caps are, and for the
    // same reason: a Run is held to what it was started under, whatever the pack says afterwards.
    generationLimit: req.generationLimit ?? convergeOf(pack)?.generationLimit ?? defaultGenerationLimit,
  };
  // Checked again here, against the bounds HimaLedger's own schema declares for a stored Budget,
  // because every face computes `timeBoxMs` itself from the `--time-box` minutes it validated — no
  // face's own check ever sees the millisecond value that is actually stored. Unchecked, a value
  // like `6e19` (from `--time-box 1e15`) or `0` (from `--time-box 0.000005`) would still write, and
  // would not fail until the next time this ledger is opened, by which point every Run in it is
  // unreachable.
  if (!allowsTimeBoxMs(budget.timeBoxMs)) {
    throw new RunStartError(`this run's time box is ${budget.timeBoxMs} ms; expected ${timeBoxMsBounds.what}`);
  }
  // And the allowance against the same table the faces check against, for the same reason the first
  // strategy's period is re-checked above: `startRun` is an operation of its own — the acceptance
  // script and the contract suite call it directly — and a value no face would pass must not become
  // a stored Budget just because it did not arrive through one. Unchecked, a fractional or negative
  // allowance would write and only fail on the next open of the ledger, taking every Run in it down.
  if (!allowsRunArgument('retries', budget.retryAllowance)) {
    throw new RunStartError(`this run's retry allowance is ${budget.retryAllowance}; expected ${runArguments.retries.what}`);
  }
  // And the generation limit against the same table, for the same reason again: it may come from the
  // pack rather than from a face, and no face validates a pack's own number. Unchecked, a
  // `converge.generationLimit` the ledger's schema refuses would be written onto the Budget and only
  // fail on the next open of the ledger, taking every Run in it down.
  if (!allowsRunArgument('generations', budget.generationLimit)) {
    throw new RunStartError(`this run's generation limit is ${budget.generationLimit}; expected ${runArguments.generations.what}`);
  }
  // Generation one, from the moment HimaFabric opens the row: everything this Run writes from here
  // belongs to a generation, and the ledger stamps each record from this field. The Strategy this
  // Campaign starts with goes on the row in the same write and is never written again: `strategy`
  // below moves with the Loop, so this is the only place what generation one asked the flow for
  // stays readable once a decision has been acted on.
  // What this Run is for, and which bytes of the pack folder it is about to run (#64). Both are
  // written once, with the row, and never again: a Run runs one pack, and which files that pack was
  // made of when it started is exactly the fact a test record later rests on. The digest is taken
  // here rather than at the first node, because a folder edited mid-Campaign has already been run
  // from — a Run says what it started on, and every later check compares the folder against that.
  const purpose = req.test === true ? 'test' : packPurpose(folder);
  // Derived from the one reading above, not taken again: these are the bytes the pack was parsed
  // from and the seal was verified against, so what the row records, what the check accepted and
  // what this Campaign is driven by are all the same folder.
  const packDigest = folder.digest(packDigestExcludes);
  const opened = await deps.ledger.createRun({ campaignId, siteId: site.name, packId: pack.id, purpose, packDigest, goal, budget, firstStrategy: strategy, generation: 1 });
  // Said as soon as it is true, and before the preparation below can take seconds over a 56 MB copy:
  // a caller that answers on the Run's existence must have the Run before anything else can happen
  // to it.
  try {
    req.onOpened?.(opened);
  } catch (err) {
    // A listener is not this Run's to be faulted by. The row exists, nothing on the ledger is the
    // worse for a callback that threw, and faulting the start here would leave exactly the shape the
    // lines below work to prevent: an opened row with no fabric state and no record saying why. It
    // is a fact about a caller and not about a Run, so it goes to the host log (#18) and the start
    // carries on.
    deps.log?.(`the run-opened callback for ${opened.id} threw and was not acted on: ${(err as Error).message}`);
  }

  // The Campaign's workspace, through #12's own operation and recorded against this Run. Idempotent
  // for this Campaign: a Run re-entered after a restart reuses the workspace rather than paying the
  // 56 MB again, and a workspace belonging to something else is refused rather than run in.
  //
  // Preparation reaches a Site, and a Site can stop answering in the middle of a 56 MB copy. A fault
  // here is recorded before it is raised, exactly as a node's turn records one: unrecorded, it left
  // the Run row opened with no fabric state and nothing at all saying why, and `/hima status` could
  // report only that HimaFabric never started this Run.
  let prepared: PrepareResult;
  try {
    prepared = await prepareWorkspace(deps, { pack: pack.id, site: site.name, campaign: campaignId, run: opened.id, folder });
  } catch (err) {
    const message = (err as Error).message;
    await blockAtEntry(deps, opened, pack, `the campaign workspace could not be prepared: ${message}`, strategy);
    throw new RunFaultError(opened.id, `run ${opened.id} stopped before its first node: ${message}`);
  }
  if (prepared.kind !== 'prepared' && prepared.kind !== 'reused') {
    // A Campaign that got no workspace is as final for this Run as a fault is, so it is recorded the
    // same way and in the same breath: the entry node blocked in the words the preparation itself
    // used, and the Run waiting for a person. Written now rather than left to the next host, which
    // could only re-stamp the row with a reason it had to invent — three lines from a fault branch
    // that records one immediately. What the caller is told does not change: this is still
    // `unprepared`, and every face still answers it the way it always has.
    await blockAtEntry(deps, opened, pack, `the campaign workspace could not be prepared: ${whyUnprepared(prepared)}`, strategy);
    return { kind: 'unprepared', run: deps.ledger.run(opened.id) ?? opened, prepared };
  }
  const workspace = prepared.file.workspace;

  await deps.ledger.advanceRun(opened.id, {
    status: 'running',
    currentNode: pack.graph.entry,
    strategy,
    meters: { elapsedMs: 0, jobsLaunched: 0, attempts: 0 },
  });

  const driving: Driving = {
    deps,
    runId: opened.id,
    site,
    pack,
    bindings: boundInputs(pack, site),
    workspace,
    campaignId,
    // A Run opened a moment ago has waited on nobody: there is no blocker to have waited at.
    waitedMs: 0,
  };
  await drive(driving);
  return { kind: 'ran', run: existingRun(deps.ledger, opened.id), workspace };
}

export type ResumeResult =
  /** The Run was re-entered at `nodeId` and driven again; `run` is where it got to this time. */
  | { readonly kind: 'resumed'; readonly run: RunRecord; readonly record: ResumedRecord; readonly nodeId: string }
  /**
   * The Run is not waiting, so there is nothing to clear: a Run still `running` is being advanced by
   * something, and an ended Run is over. Nothing is written — a resume that changed nothing must
   * leave no record saying a person did something.
   */
  | { readonly kind: 'not-waiting'; readonly run: RunRecord }
  /**
   * The Run is waiting and cannot be re-entered anyway: HimaFabric never prepared it a workspace, it
   * stands at no node, or the installed pack no longer has the node it stands at. Also written to
   * nothing, and told in words a person can act on.
   */
  | { readonly kind: 'unresumable'; readonly run: RunRecord; readonly reason: string };

/**
 * Clear a waiting Run and carry it on: `/hima resume`, the `hima_resume` tool, and the workbench's
 * resume route all land here.
 *
 * This is the second way into `drive`, and everything it needs it reads back out of the ledger — the
 * Site from the run row, the pack and the workspace from the Run's own workspace record, the node to
 * re-enter from its blocker. Nothing is carried over from the process that blocked it, which is what
 * makes resuming a Run a later host booted on the same home never saw work exactly as this one does.
 *
 * The person's action is recorded *before* the Run moves, because the record is the authority for
 * the fresh allowance the node is about to be given: were it written after, a failure in between
 * would be counted against an allowance nobody had granted yet.
 *
 * **One resume clears one blocker, and inside a fork that is one branch** (#29). The blocker this
 * resume answers is the Run's latest, it names the branch it was written in, and only that branch is
 * put back to `running`; a second blocked branch stays blocked, is not re-entered by the drive below
 * (`driveBranch`), and leaves the Run waiting again once the resumed branch settles. That is the
 * same rule outside a fork — a Run is re-entered where a person cleared it and nowhere else — and it
 * is what keeps a fresh Retry allowance something a person granted rather than something another
 * branch's resume handed out.
 *
 * @param deps - the ledger, HimaJudge, and where sites and packs are installed.
 * @param req - the Run to resume and who is resuming it (a session's agent id, or `workbench`).
 * @returns what the resume did, or why it did nothing.
 * @throws RunReferenceError when the ledger holds no such Run; PackNotFoundError when the pack the
 *         Run was started with is no longer installed; RunFaultError when a node's turn threw.
 */
export async function resumeRun(deps: FabricDeps, req: { readonly runId: string; readonly who: string }): Promise<ResumeResult> {
  // Serialize only admission, never the potentially long-running Job. The next caller then reads
  // the ledger state the admitted caller wrote and receives the existing not-waiting answer.
  const chains = resumesPerRun.get(deps.ledger) ?? new Map<string, Promise<unknown>>();
  resumesPerRun.set(deps.ledger, chains);
  const pending = (chains.get(req.runId) ?? Promise.resolve()).then(() => admitResume(deps, req));
  const settled = pending.then(() => undefined, () => undefined);
  chains.set(req.runId, settled);
  void settled.then(() => { if (chains.get(req.runId) === settled) chains.delete(req.runId); });
  const admission = await pending;
  if (admission.kind !== 'admitted') return admission;
  await drive(admission.driving);
  return { kind: 'resumed', run: existingRun(deps.ledger, req.runId), record: admission.record, nodeId: admission.nodeId };
}

// Like the existing per-Ledger Job/record-write chains: only pending callers live here. Run state,
// the person's action and the cleared blocker remain in the ledger and survive a Host restart.
const resumesPerRun = new WeakMap<Ledger, Map<string, Promise<unknown>>>();
type ResumeAdmission = Exclude<ResumeResult, { kind: 'resumed' }> | {
  readonly kind: 'admitted'; readonly driving: Driving; readonly record: ResumedRecord; readonly nodeId: string;
};

async function admitResume(deps: FabricDeps, req: { readonly runId: string; readonly who: string }): Promise<ResumeAdmission> {
  const run = existingRun(deps.ledger, req.runId);
  if (run.status !== 'waiting') return { kind: 'not-waiting', run };

  const records = deps.ledger.records({ runId: run.id });
  const prepared = records.findLast((r): r is WorkspaceRecord => r.type === 'workspace');
  if (!prepared) {
    return { kind: 'unresumable', run, reason: `run ${run.id} has no workspace record: HimaFabric never prepared it, so there is no campaign workspace to re-enter` };
  }
  // The node a person is clearing is the one that failed, never the Wait node the Run was routed to:
  // re-entering that would only wait again. A Run waiting for another reason — a Wait node the graph
  // led to, a fault mid-drive — has no blocker, and is re-entered where it stands.
  //
  // The latest blocker **no resume has cleared**, read off the `clears` those resumes name, and not
  // merely the latest one written since the last resume. The two are the same answer for a Run that
  // blocks in one place at a time, and they differ for exactly the Run this rule exists for: a fork
  // whose two branches blocked at the same moment writes two blockers, one resume clears one of
  // them, and the other is older than that resume — so "since the last resume" would leave the
  // second branch with a blocker nobody could ever clear and a Run that waited for ever (#29).
  const cleared = new Set(records.flatMap((r) => (r.type === 'resumed' && r.clears !== undefined ? [r.clears] : [])));
  const blocker = records.findLast((r): r is BlockerRecord => r.type === 'blocker' && !cleared.has(r.id));
  const nodeId = blocker?.nodeId ?? run.currentNode;
  if (nodeId === undefined) {
    return { kind: 'unresumable', run, reason: `run ${run.id} stands at no node, so there is nothing to re-enter` };
  }
  const pack = loadPack(deps.packsDir, prepared.packId);
  // Across the whole pack, its drill-down loops included: a Run blocked inside a Loop is re-entered
  // at the node inside that Loop that failed, and the row's own `loop` is what says it is still
  // open, so the drive below carries on inside it (#28).
  if (positionOf(pack, nodeId) === undefined) {
    return { kind: 'unresumable', run, reason: `run ${run.id} stands at node "${nodeId}", which pack ${pack.id}@${pack.contract.version} no longer has` };
  }
  // The time box does not run while a person is asked, so whether it is spent is answered at the
  // last moment the Run was actually running: when it stopped. A Run whose box really had run out by
  // then can only be driven straight to `ended-budget-exhausted` on its first turn — and it would
  // reach that with a `person` record already in the ledger claiming they cleared the blocker, no
  // attempt made, and no way back, because the Run is no longer `waiting`. Say so instead, and write
  // nothing.
  const waitedMs = waitedMsOf(deps.ledger, run.id);
  const stoppedAt = blocker ? Date.parse(blocker.at) : Date.now();
  if (run.budget && timeBoxSpentAt(run, waitedMs, stoppedAt)) {
    const stopped = blocker ? `stopped at ${blocker.at}` : 'stopped';
    return {
      kind: 'unresumable',
      run,
      reason: `run ${run.id} had already spent its time box of ${run.budget.timeBoxMs} ms when it ${stopped}, so resuming it could only end it as ended-budget-exhausted; start a fresh run instead`,
    };
  }
  const site = loadSite(deps.sitesDir, run.siteId);

  const clears = blocker === undefined ? {} : { clears: blocker.id };
  const record = await deps.ledger.appendResumed(run.id, { nodeId, who: req.who, ...clears });
  // Where the Run is re-entered. Inside a fork it is **one branch** that is re-entered and not the
  // Run's own position: the Run stands at the join for as long as the fork is open, the branches
  // that reached it are still there, and moving `currentNode` to the node that blocked would say the
  // Run had left the join and lose the others' work (#29). The blocker says which branch it was.
  const branch = run.fork !== undefined && blocker?.branchId !== undefined && Object.hasOwn(run.fork.branches, blocker.branchId)
    ? { branch: { id: blocker.branchId, currentNode: nodeId, state: 'running' as const } }
    : { currentNode: nodeId };
  await deps.ledger.advanceRun(run.id, { status: 'running', ...branch });
  return { kind: 'admitted', record, nodeId, driving: {
    deps,
    runId: run.id,
    site,
    pack,
    bindings: boundInputs(pack, site),
    workspace: prepared.workspace,
    campaignId: run.campaignId,
    // Read after the resume is on record, so the wait this resume just closed is part of it: that is
    // the whole of what the box is widened by, and it is what the drive below is bounded against.
    waitedMs: waitedMsOf(deps.ledger, run.id),
  } };
}

/**
 * A Job an earlier process launched and this one is picking up again: which attempt of the Run's
 * current node it belongs to, and the tmux session it runs in. What `reconcileRuns` hands `drive` in
 * place of a first turn, so the Run's next move is to wait for a Job that is already there rather
 * than to launch a second one.
 */
export interface Resumption {
  readonly attempt: number;
  readonly session: string;
}

/**
 * Advance the Run until it stops, and — where it stopped by ending — write the Campaign's technical
 * report (#30).
 *
 * The report is written here rather than in each of the three callers below it, because "the drive
 * came back and the Run had ended" is one moment however the drive was entered: a Campaign started
 * from the window, one a person resumed, and one a later host picked up all reach their ending
 * through this return, and a caller that asked the question for itself would be a second answer to
 * it. `writeExperience` decides whether there is anything to do — a Run that did not end, or one
 * that already has its report, is left alone and the Site is not touched.
 *
 * A drive that *threw* writes nothing: a fault leaves the Run waiting for a person, which is not an
 * ending, and the throw carries on to the caller exactly as it did.
 */
export async function drive(ctx: Driving, resume?: Resumption): Promise<void> {
  await driveOn(ctx, resume);
  await writeExperience(ctx.deps, ctx.runId);
}

/**
 * The loop itself. Every turn re-reads the run row: what node to run, and whether the Run is still
 * the engine's to advance, are the ledger's answers and never this loop's memory.
 *
 * `resume` makes the first turn a wait on a Job that is already running instead of a node's turn —
 * the whole of what a restart costs, because everything else the loop needs it reads back anyway.
 */
async function driveOn(ctx: Driving, resume?: Resumption): Promise<void> {
  let resuming = resume;
  for (;;) {
    const run = existingRun(ctx.deps.ledger, ctx.runId);
    if (run.status !== 'running') return;
    // Which node, and which graph it is routed in: a Run inside a drill-down Loop stands at one of
    // that Loop's nodes and is routed by that Loop's edges (#28). Node ids are unique across a pack,
    // so the row's one `currentNode` answers both questions, and `run.loop` says whether a Loop is
    // open rather than where the Run stands — the two can differ for exactly one turn, when a Hard
    // blocker inside a Loop routes the Run to the graph's own Wait node.
    const at = positionOf(ctx.pack, run.currentNode);
    if (!at) {
      // The graph is validated at load, so this is a run row naming a node the installed pack no
      // longer has — a person changed the pack under a Run. Nothing to execute; say so and wait.
      await progress(ctx, {}, { status: 'waiting' });
      return;
    }
    const { node, graph } = at;
    // A resumed turn is exempt: its Job is still running on the Site, and a box that was spent while
    // no host was watching must stop that Job before the Run may say a budget ended it. `waitForJob`
    // asks on its own first look and kills there, which is the one path that records the stop.
    if (resuming === undefined && timeBoxSpent(run, ctx.waitedMs)) {
      await endBudgetExhausted(ctx.deps.ledger, ctx.runId);
      return;
    }

    // Everything a node's turn does that can throw happens on a Site, and a Site can stop answering
    // at any moment. A fault that escaped here would leave the run row saying `running` while nothing
    // is advancing it, and put a stack trace where the reason should be. So the fault is recorded
    // first — the node blocked carrying the message, the Run waiting — and only then raised, with the
    // Run's id on it so every face can point a person at the records the generation did leave.
    const attempt = resuming?.attempt ?? attemptOf(ctx.deps.ledger, ctx.runId, node.id);
    let step: Step;
    try {
      // A Run inside a fork is not standing at one node's turn: it is waiting at the join for
      // several branches, and driving them is what its turn is (#29). The row is what says so, as it
      // is for everything else here, so a host that picked this Run up re-enters every branch.
      step = run.fork !== undefined && resuming === undefined
        ? await runFork(ctx, run.fork)
        : resuming === undefined ? await runNode(ctx, run, node, attempt) : await resumeNode(ctx, node, attempt, resuming.session);
    } catch (err) {
      // Ticket #18: one fault is not recorded here, and it is the one where recording it would be the
      // damage. A Site that could not be asked, while this node has a Job open on it, is not a node
      // that failed: a `blocked` node says the attempt is over and hands the Run to a person, while a
      // Job of ours goes on holding a licence on the customer's machine with nothing watching it —
      // exactly the outcome this rule exists to prevent. Nothing is known, so nothing is claimed: the
      // error propagates with the run row exactly as the ledger has it, and the next poll, the next
      // boot or a person asks the Site again. With no Job open — the probe failed at the launch, or
      // before there was one — nothing is unattended, and the fault path below stays as it was: the
      // node's `blocked` reason is what tells the person that the Site could not be asked.
      //
      // Inside a fork the node this turn stood at is the join, and the Jobs are in the branches, so
      // "this node" is the wrong thing to ask about: `wouldLeaveJobUnattended` states which nodes
      // the question covers (#29).
      if (err instanceof SiteUnreadableError && wouldLeaveJobUnattended(ctx, node.id)) throw err;
      const message = (err as Error).message;
      await appendNode(ctx, node, 'blocked', attempt, { reason: message });
      await progress(ctx, {}, { status: 'waiting' });
      throw new RunFaultError(ctx.runId, `run ${ctx.runId} stopped at node ${node.id}: ${message}`);
    }
    // One resumption per drive: the Job it names belongs to the node the Run stood at, and every
    // node after it is this process's own to run from the start.
    resuming = undefined;
    // Someone else is writing this Run's ending. Nothing here, including the meters, may move — and
    // that is asked before every other outcome, so no retry, no routing and no meter is written over
    // the ending the other face is composing.
    if (step.kind === 'stopped') return;
    if (step.kind === 'retrying') {
      // The same node again, and nothing on the run row moves: the next attempt's number is read
      // back out of the records at the top of this loop, so a process that picked this Run up
      // between the two attempts would count the same way this one does.
      continue;
    }
    if (step.kind === 'moved') {
      // The turn moved the Run itself — an Explore node that drilled down into its own Loop — so
      // there is no edge to follow and nothing to end: the next turn is wherever the row now says.
      continue;
    }
    if (step.kind === 'hard-blocker') {
      // The allowance is spent and the blocker is written. Where the Run goes now is the pack's to
      // say: a Wait node is what a graph declares for exactly this, and routing there is what makes
      // `currentNode` point at a place a person can act on rather than at the node that failed.
      const wait = waitNodeOf(ctx, graph);
      if (wait === undefined || wait === node.id) {
        await progress(ctx, {}, { status: 'waiting' });
        return;
      }
      await progress(ctx, {}, { currentNode: wait });
      continue;
    }
    if (step.kind === 'blocked') {
      await progress(ctx, {}, { status: 'waiting' });
      return;
    }
    if (step.kind === 'budget-exhausted') {
      await endBudgetExhausted(ctx.deps.ledger, ctx.runId);
      return;
    }

    // An Explore node that settled has written a decision, and that decision — not the graph — says
    // whether the Campaign goes on. Asked here rather than inside the turn because where a Run goes
    // next is this loop's one job. Inside a drill-down Loop the same decision says whether that Loop
    // goes on, and the Loop closing is what the outer graph then routes on (#28).
    if (node.kind === 'explore') {
      const inside = at.loop === undefined ? undefined : run.loop;
      const went = inside === undefined ? await followDecision(ctx, node, graph) : await followLoopDecision(ctx, node, graph, inside);
      if (went) continue;
      return;
    }

    // Several unlabelled edges out of an act node are a fork, and following one of them would be
    // taking whichever line was written first (#29). Asked here, where an edge is about to be
    // followed, because that is exactly what a fork replaces.
    const forked = await openForkAt(ctx, graph, node);
    if (forked !== undefined) {
      if (forked.kind === 'moved') continue;
      if (forked.kind === 'blocked') await progress(ctx, {}, { status: 'waiting' });
      return;
    }

    const to = edgeFrom(ctx, graph, node, step.outcome);
    if (to === undefined) {
      // An UNDETERMINED with nowhere to go is not a Run that ended, whatever the graph forgot to
      // draw: a rule that could not be applied is a person's to look at, so the Run waits here.
      if (step.outcome === 'UNDETERMINED') await progress(ctx, {}, { status: 'waiting' });
      else await endRun(ctx);
      return;
    }
    await progress(ctx, {}, { currentNode: to });
  }
}

/**
 * **The ending each kind of decision writes**, keyed by every kind there is: goal met and converged
 * are endings of their own, and a next Strategy ends nothing — it is the Run going round again.
 *
 * One table rather than a chain of `in` tests in each of the four places this engine acts on a
 * decision (the final review of step 3b, J4). Keyed by `ChosenKind`, so a fourth thing an Explore
 * node could decide is a compile error here — where the endings are — rather than an arm that
 * quietly falls through to "the Run goes on".
 */
const ENDED_BY: Readonly<Record<ChosenKind, RunStatus | undefined>> = {
  'goal-met': 'ended-goal-met',
  converged: 'ended-converged',
  'next-strategy': undefined,
};

/** The same three, one level down: which outcome a decision closes a drill-down Loop with, and which
 *  closes none because the Loop has somewhere to go round to. */
const CLOSED_BY: Readonly<Record<ChosenKind, LoopOutcome | undefined>> = {
  'goal-met': 'goal-met',
  converged: 'converged',
  'next-strategy': undefined,
};

/** The Strategy a decision chose, as the row's own patch: nothing at all for a decision that chose
 *  none, which is a decision that ended something rather than opening the next generation. */
function chosenStrategy(decision: DecisionRecord | undefined): { readonly strategy?: RunStrategy } {
  const chosen = decision === undefined ? undefined : chosenAs(decision);
  return chosen?.kind === 'next-strategy' ? { strategy: chosen.strategy } : {};
}

/**
 * What the Run does with the decision an Explore node just wrote (D43) — the whole of the Loop's
 * turning point.
 *
 * The decision is the authority and the graph is only the route: goal met and converged are both
 * answers, and a Run with an answer ends where it stands whatever edge leaves the node. Only a next
 * Strategy has anywhere to go, and where it goes is the Explore node's one outgoing edge:
 *
 * - a `revisit` edge opens the next Generation, in **one write** of the run row — the target node,
 *   the generation, and the Strategy the decision chose, together — so a host that died between two
 *   of those three could never leave a Run running the old Strategy under the new generation's
 *   number. Unless the Budget's generation limit says this Campaign has had its allowance, in which
 *   case the Run ends there with the decision still on record: it worked out what to try next and
 *   was not allowed to try it, which is a different thing from having nothing to try;
 * - an ordinary edge is followed as any other edge is, for a graph that explores and then goes on;
 * - no edge at all ends the Run the way step 2 ended every Run: `ended-goal-not-met`, carrying the
 *   Strategy it would have tried next. A pack whose Explore node leads nowhere is still one
 *   generation, and still means what it meant.
 *
 * All four of those write the run row, and three of them write a *status* onto it, so the whole
 * function is held against the row first (`node-turns.ts` says why, and `stillDriving` is the same
 * question): an Explore node's turn waits on no Job, so it is the one turn a cancel from another
 * face can land inside, and an ending written after that ending would say a Run somebody stopped had
 * met its Goal instead. The row is read here rather than asked for through `stillDriving`, because
 * the generation a revisit carries is read off the same row and one read cannot disagree with
 * itself; nothing between here and that write awaits anything, so the row cannot have moved under
 * it either.
 *
 * @returns whether the loop should take another turn; false when this decision ended the Run, and
 *          false without writing anything when another face had already ended it.
 */
async function followDecision(ctx: Driving, node: PackNode, graph: RunGraph): Promise<boolean> {
  const run = existingRun(ctx.deps.ledger, ctx.runId);
  if (!driving(run)) return false;
  const decision = latestDecision(ctx);
  const ending = decision === undefined ? undefined : ENDED_BY[chosenKind(decision)];
  if (ending !== undefined) {
    await progress(ctx, {}, { status: ending });
    return false;
  }
  const to = graph.edges.find((e) => e.from === node.id);
  if (to === undefined) {
    await endRun(ctx);
    return false;
  }
  if (to.revisit !== true) {
    await progress(ctx, {}, { currentNode: to.to });
    return true;
  }
  if (!nextGenerationAllowed(run)) {
    await endGenerationLimit(ctx.deps.ledger, ctx.runId);
    return false;
  }
  await progress(ctx, {}, { currentNode: to.to, generation: (run.generation ?? 1) + 1, ...chosenStrategy(decision) });
  return true;
}

/**
 * The same turning point, one level down: what the Run does with the decision an Explore node
 * *inside a drill-down Loop* just wrote (#28).
 *
 * A Loop's endings are the Run's endings read as a sub-question's: goal met and converged are its
 * Explore node's decision, and its own `converge.generationLimit` spent is the third. Each of them
 * closes the Loop rather than ending the Run — that is the whole of what drilling down buys, a
 * question answered where it arises — and the outer graph then goes on along the edge that outcome
 * labels. A next Strategy with a revisit edge to take opens the Loop's next Generation instead, and
 * nothing outside the Loop moves at all.
 *
 * The one shape a validated pack cannot produce, and which is answered rather than assumed away: a
 * Loop's Explore node with a next Strategy and no edge to take it along. Its Loop has nowhere to go
 * and no outcome to close with, so the node blocks naming what a person must add to the file — the
 * same answer an UNDETERMINED the pack labelled no edge for gets.
 *
 * Held against the row first for the reason the outer turning point is: an Explore node's turn waits
 * on no Job, so a cancel from another face can land inside it, and this one has a `waiting` of its
 * own to write as well as the Loop's endings — a Run somebody stopped, left saying it is waiting for
 * a person, would be the plainest way of all to lose a cancel.
 *
 * @returns whether the driver should take another turn; false when the Run stopped here, and false
 *          without writing anything when another face had already stopped it.
 */
async function followLoopDecision(ctx: Driving, node: Extract<PackNode, { kind: 'explore' }>, graph: RunGraph, loop: RunLoop): Promise<boolean> {
  if (!stillDriving(ctx)) return false;
  const decision = latestDecision(ctx);
  const closes = decision === undefined ? undefined : CLOSED_BY[chosenKind(decision)];
  if (closes !== undefined) return closeAndGoOn(ctx, loop, closes);
  const to = graph.edges.find((e) => e.from === node.id);
  if (to === undefined) {
    await appendNode(ctx, node, 'blocked', currentAttemptOf(ctx.deps.ledger, ctx.runId, node.id), {
      reason: `node ${node.id} chose a next strategy and loop "${loop.name}" draws no edge out of it, so there is nowhere to try it and no outcome to close the loop with`,
    });
    // The record above is a fact about the node either way; the row's `waiting` is not written over
    // an ending another face wrote while it was being appended.
    if (!stillDriving(ctx)) return false;
    await progress(ctx, {}, { status: 'waiting' });
    return false;
  }
  if (to.revisit !== true) {
    await progress(ctx, {}, { currentNode: to.to });
    return true;
  }
  if (!nextLoopGenerationAllowed(loop, loopGenerationLimit(node))) return closeAndGoOn(ctx, loop, 'generation-limit');
  return (await revisitInLoop(ctx, loop, to.to, chosenStrategy(decision))).kind !== 'stopped';
}

/**
 * Close a drill-down Loop and take the outer graph on along the edge its outcome labels.
 *
 * With no such edge the Run ends, as if the outer graph itself had reached that ending: a Loop is
 * how a pack asks a sub-question, and a pack that asked one and drew nowhere for the answer to go
 * has said the answer is the Campaign's. Which ending is the outcome's own — goal met is
 * `endRun`'s, converged is `ended-converged`, and a spent generation limit is the Budget's
 * `ended-budget-exhausted` naming that meter — so the three read exactly as they would have from an
 * Explore node in the outer graph itself.
 *
 * A close another face's ending got in front of writes nothing and goes nowhere: the Loop stays open
 * on the record of a Run that was stopped inside it, which is what a cancel inside a Loop means. An
 * ending that lands after the close but before the routing leaves the Loop closed and the Run the
 * other face's: the row is asked again between the two.
 *
 * @returns whether the driver should take another turn; false when the Run ended here.
 */
async function closeAndGoOn(ctx: Driving, loop: RunLoop, outcome: LoopOutcome): Promise<boolean> {
  if ((await closeLoop(ctx, loop, outcome)).kind === 'stopped') return false;
  // Asked again after the close's own writes, for the same reason the close asked: those writes
  // took time, and an ending another face wrote inside it must not be written over by the routing
  // or the ending composed here. The Loop is then closed on record and the Run is the other face's.
  if (!stillDriving(ctx)) return false;
  const to = ctx.pack.graph.edges.find((e) => e.from === loop.nodeId && e.outcome === outcome);
  if (to !== undefined) {
    await progress(ctx, {}, { currentNode: to.to });
    return true;
  }
  // The same three endings as an Explore node in the outer graph writes, from the same table: a
  // Loop's outcome *is* its own Explore node's decision, read one level up.
  if (outcome === 'goal-met') await endRun(ctx);
  else if (outcome === 'converged') await progress(ctx, {}, { status: ENDED_BY.converged });
  else await endGenerationLimit(ctx.deps.ledger, ctx.runId);
  return false;
}

/** The decision this Run last wrote: what an Explore node that has just settled left behind. */
const latestDecision = (ctx: Driving): DecisionRecord | undefined =>
  ctx.deps.ledger.records({ runId: ctx.runId, type: 'decision' }).findLast((r): r is DecisionRecord => r.type === 'decision');

/**
 * What this pack calls convergence: read off the Explore node whose edge revisits — the node whose
 * Loop is the one a Campaign's generation limit bounds — and what that limit defaults to when the
 * person who started the Campaign named none.
 *
 * A graph may hold several Explore nodes, and one Campaign has one Budget between them, so a pack
 * whose declarations disagree about `generationLimit` is refused when it is loaded
 * (`validateGenerationLimit` in `packs.ts`). Which node is read here therefore cannot change the
 * number — but reading the one
 * that revisits says out loud which Loop it is about, rather than leaving it to the order the nodes
 * happen to be written in. A graph where no Explore node revisits declares no Loop for the limit to
 * bound, and any node's number is as good as another's.
 */
const convergeOf = (pack: Pack): PackConverge | undefined => {
  const revisits = new Set(pack.graph.edges.filter((e) => e.revisit === true).map((e) => e.from));
  const declared = pack.graph.nodes.flatMap((n) =>
    (n.kind === 'explore' && n.parameters.converge ? [{ id: n.id, converge: n.parameters.converge }] : []));
  return (declared.find((n) => revisits.has(n.id)) ?? declared[0])?.converge;
};

/**
 * Has this node a Job on the Site that nothing has settled (#18)? Read from the ledger alone, because
 * the Site is precisely what cannot be asked when this is being asked: a `launched` record of this
 * node with neither a `finished` nor a `killed` record of its own is a Job nobody has seen end.
 *
 * Deliberately only the Job's own two records, and not `launchIsOpen`'s second half — a Run's own
 * account of a launch on a node record is not an observation, and the Site that would have to confirm
 * it is the one that is silent. Which makes this the fail-closed half of that same rule, asked in the
 * one moment the other half cannot be.
 */
/**
 * Would recording this fault leave a Job of this Run running on the Site with nothing watching it?
 * The question #18's rule turns on, asked of the ledger alone — this is reached from inside a catch,
 * so it may not ask the Site and may not throw.
 *
 * **Which nodes it is asked over is the whole of the rule, and a fork moves it** (#29). Outside a
 * fork the Run stands at the node whose turn threw, and that node's own launches are the Jobs at
 * stake. Inside one, `run.currentNode` is the join — a judge node that launches nothing, so asking
 * about it would answer "nothing open" every time — while the Jobs are in the branches. So the
 * question is asked over **every branch's current node**, read back off the row rather than off the
 * one the drive read before the fork ran, and one branch with an open Job is enough: a `blocked`
 * join would say the attempt was over and hand the Run to a person while both branches' Jobs went
 * on holding licences with nobody watching either.
 *
 * A launch is open here when nothing has settled it — no `finished`, no `killed` — which is the
 * ledger's own reading and deliberately not `openJobsOfRun`'s: that one asks the Site, and the Site
 * is exactly what has just stopped answering.
 */
function wouldLeaveJobUnattended(ctx: Driving, nodeId: string): boolean {
  const fork = existingRun(ctx.deps.ledger, ctx.runId).fork;
  const nodes = fork === undefined ? [nodeId] : Object.values(fork.branches).map((b) => b.currentNode);
  const jobs = ctx.deps.ledger.records({ runId: ctx.runId, type: 'job' }).filter((r): r is JobRecord => r.type === 'job');
  const ended = new Set(jobs.filter((r) => r.event !== 'launched').map((r) => r.job.session));
  return jobs.some((r) => r.event === 'launched' && r.nodeId !== undefined && nodes.includes(r.nodeId) && !ended.has(r.job.session));
}

/**
 * The node this outcome leads to, or undefined when nothing does — which is how a graph says the Run
 * ends (D29: end is the absence of outgoing edges).
 *
 * A judge node's edges carry the outcome they are taken on; every other kind has one unlabelled edge
 * out. An UNDETERMINED the pack labelled no edge for leads to its wait node instead of ending the
 * Run: a rule that could not be applied is not a result to end on, it is a person's to look at.
 *
 * An act node's unlabelled edge out may be **several** (D29, #29), and then it is not an edge to
 * follow at all: it is a fork, opened above this rather than routed by it. A join's own outcome —
 * the one this then takes the edge of — is `forkOutcome` in `packs.ts`, stated once beside what a
 * fork is: PASS only when every branch's first rule passed, UNDETERMINED when any is, else FAIL.
 */
function edgeFrom(ctx: Driving, graph: RunGraph, node: PackNode, outcome: VerdictOutcome | undefined): string | undefined {
  const labelled = graph.edges.find((e) => e.from === node.id && e.outcome === outcome);
  if (labelled) return labelled.to;
  if (outcome === 'UNDETERMINED') return waitNodeOf(ctx, graph);
  return undefined;
}

/**
 * The node this pack declares its Runs wait at, when it declares one. Nothing draws an edge to it: a
 * Hard blocker and an unlabelled UNDETERMINED are both routed here by the engine, because a pack says
 * where its Runs wait and cannot be asked to draw an edge from every node that might fail.
 *
 * A drill-down Loop may declare its own, and one that does is where its own failures wait — a Loop
 * is a graph and this is a fact about a graph. One that does not falls back to the pack's own Wait
 * node, because a pack states where its Runs wait once and a Loop that borrows it is not thereby
 * outside it: the Run stands at an outer node with its Loop still open, and the resume that clears
 * the blocker re-enters the node inside the Loop that failed.
 */
const waitNodeOf = (ctx: Driving, graph: RunGraph): string | undefined =>
  graph.nodes.find((n) => n.kind === 'wait')?.id ?? ctx.pack.graph.nodes.find((n) => n.kind === 'wait')?.id;

/**
 * Run one node's turn. Every branch writes the node records that say what it did.
 *
 * `attempt` is computed by the caller and handed in, because the caller's fault boundary must write
 * the same attempt number this turn opened with — counting again after a `running` record has been
 * written would number the fault as the next attempt.
 */
async function runNode(ctx: Driving, run: RunRecord, node: PackNode, attempt: number): Promise<Step> {
  if (node.kind === 'wait') {
    // A Wait node is not attempted; it is arrived at. One record, and the Run waits for a person.
    await appendNode(ctx, node, 'blocked', attempt, { reason: `this pack routes a ${node.parameters.blocker} here; the Run waits for a person to clear it` });
    await progress(ctx, { attempts: 1 });
    return { kind: 'blocked' };
  }
  if (node.kind === 'act') {
    // Three forms, and the graph declares exactly one of them per node (`validatePack`): run one of
    // the pack's tools, read one of its outputs, or open the workshop where the AI writes the script
    // this node runs (#62).
    if (node.parameters.workshop !== undefined) return workshopNode(ctx, node, attempt);
    return node.parameters.tool === undefined
      ? observeNode(ctx, node, attempt)
      : toolNode(ctx, run, node, attempt);
  }
  if (node.kind === 'judge') {
    await appendNode(ctx, node, 'running', attempt);
    await progress(ctx, { attempts: 1 });
    return judgeNode(ctx, run, node, attempt);
  }
  await appendNode(ctx, node, 'running', attempt);
  await progress(ctx, { attempts: 1 });
  // An Explore node is one of two things (#28): the one that applies a chooser and decides, and the
  // one that opens a Loop of its own. `validatePack` holds that it is exactly one of them.
  return opensALoop(node) ? openLoop(ctx, node, attempt) : exploreNode(ctx, node, attempt);
}

// ---------------------------------------------------------------------------------------------
// Ending: the Run stops where the graph does. The meters and the node records a turn writes are
// `budget.ts` and `node-turns.ts`.
// ---------------------------------------------------------------------------------------------

/**
 * End the Run at a node with nothing leading out of it. What it ends as is the decision's, not the
 * engine's: the Goal is met when the chooser said so, and otherwise the Run ends not met carrying
 * the strategy it would try next.
 *
 * Reached from an Explore node whose graph draws no edge out of it — a pack of one generation, which
 * is what every pack was before the Loop — and from any other node with nothing leading out. A
 * converged decision never reaches here: it is an ending of its own, written where the decision is
 * read.
 *
 * The decision it reads is the Run's latest and is deliberately not narrowed to the outer graph, so
 * a Run that ends just after a drill-down Loop closed ends on that Loop's last decision (#28). That
 * is the right one: a Loop is how a pack asks a sub-question, and a pack that let the Run reach a
 * dead end straight after one has said the answer is the Campaign's — the same claim `closeAndGoOn`
 * makes when it ends a Run on a Loop's outcome with no outer edge to take.
 */
async function endRun(ctx: Driving): Promise<void> {
  const decision = latestDecision(ctx);
  const chosen = decision === undefined ? undefined : chosenAs(decision);
  if (chosen?.kind === 'goal-met') {
    await progress(ctx, {}, { status: ENDED_BY['goal-met'] });
    return;
  }
  // Deliberately not the whole table: a `converged` decision that reached here is a Run that ran out
  // of graph *after* a drill-down Loop converged, and what ended it is the graph, not the
  // convergence — `closeAndGoOn` writes `ended-converged` where a convergence is the ending.
  const next = chosen?.kind === 'next-strategy' ? { strategy: chosen.strategy } : {};
  await progress(ctx, {}, { status: 'ended-goal-not-met', ...next });
}

/**
 * Why a preparation gave the Campaign no workspace, in words the ledger already holds: a Permit
 * refusal's own record names the path it refused and why, and an occupied workspace names itself and
 * what is the matter with it.
 *
 * Said again on the blocked node because that is where a person will read it. `/hima status` renders
 * a Run's nodes and its decision, not its refusals, so a node saying only that there is no workspace
 * would send whoever is looking off to find a record the face does not show them.
 */
function whyUnprepared(prepared: PrepareResult): string {
  if (prepared.kind === 'refused') return `the site's permit refused ${prepared.record.path}: ${prepared.record.reason}`;
  if (prepared.kind === 'occupied') return `${prepared.workspace} is not this campaign's to run in: ${prepared.reason}`;
  // `unfit` is answered before a Run is opened at all, so it cannot arrive here; a kind added later
  // says its own name rather than being described as something it is not.
  return `the preparation answered ${prepared.kind}`;
}

/** A Run that never got past its own opening: the entry node blocked carrying why, and a Run that
 *  waits for a person rather than one with no fabric state and no explanation. */
async function blockAtEntry(deps: FabricDeps, run: RunRecord, pack: Pack, reason: string, strategy: RunProgress['strategy']): Promise<void> {
  const entry = pack.graph.nodes.find((n) => n.id === pack.graph.entry);
  if (entry) await recordNode(deps.ledger, run.id, entry, 'blocked', attemptOf(deps.ledger, run.id, entry.id), { reason });
  await advance(deps.ledger, run.id, {}, { status: 'waiting', currentNode: pack.graph.entry, strategy });
}
