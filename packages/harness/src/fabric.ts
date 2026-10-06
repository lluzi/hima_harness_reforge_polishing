import { durableRuntimeOf, knownDurableRun, openDurableProductRun, durableProposalRun, durableStartRequestDigest, durableStartResult, durableRunView, startDurablePreparation, readDurableExecutionContext, controlDurableRun, prepareDurableResearchCommand, submitDurableResearchCommand } from './durable-fabric.js';
export { preparationWorkflowDefinitions, recoverDurablePreparations, controlDurableRun } from './durable-fabric.js';
// New Run admission/control uses PG and DBOS; the legacy runner below remains a historical reader.
// Historical HimaFabric v1: the runner that owns a Campaign's graph and a Run's state. It executes the four
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
import { goalDeclarationOf, boundInputs, recordedInputs, checkPack, loadInstalledPack, loadPackFrom, packStageFrom, positionOf, runGraphsOf, validateGrowthGraph, withGrowthGraphs, type GrowthGraph, type Pack, type PackCheck, type PackConverge, type PackNode } from './packs.js';
import { packDigestExcludes, snapshotPackFolder, type PackFolderSnapshot } from './pack-folder.js';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { loadRunPack, preservePackMethod } from './release.js';
import { campaignIdFor, type PrepareResult } from './workspace.js';
import type { PreparationOverrides } from './campaign-file.js';
import { loadSite, type Site } from './sites.js';
import { existingRun } from './runs.js';
import { currentRecordsIn, revisionRecordsIn } from './ledger.js';
import type { Ledger, RunPurpose, RunRecord, RunStrategy, WorkspaceRecord, NodeExecution, ExecutionReceipt, GrowthRecord, RevisionRecord, RunControl } from './ledger.js';
import { allowsRunArgument, allowsTimeBoxMs, runArguments, goalFrom, strategyFrom, timeBoxMsBounds, type StrategyValue } from './run-arguments.js';
import { PackNotFoundError, RunStartError } from './errors.js';
import { budgetStanding, defaultGenerationLimit, defaultRetryAllowance, defaultTimeBoxMs, ownedWaitedMs } from './budget.js';
import { opensALoop } from './loops.js';
import { nodeArguments, exploreCitation, type ExploreCitation, type FabricDeps } from './node-turns.js';
import { engineeringRequest, engineeringDeliveriesOf, readRetainedEngineeringAsset, type EngineeringTaskIdentity } from './engineering-executor.js';

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
  /** Internal Host admission: the actual calling conversation, never a model-chosen identity. */
  readonly ownerSessionId?: string;
  /** Host-authenticated independent Guide that arranged this execution. */
  readonly guideSessionId?: string;
  /** Confirmed read-only preparation identity. One identity may open at most one persistent Run. */
  readonly proposalId?: string;
  /** Web intake asks the Host to notify the recorded owner after durable preparation. */
  readonly notifyOwnerOnOpen?: boolean;
  readonly pack: string;
  readonly site: string;
  /** The Goal as bound parameters, typed and checkable, immutable for the Campaign (D3). */
  readonly goal: Readonly<Record<string, number | string>>;
  /**
   * Campaign-file input overrides (#41 task 3), merged over the Site's own bindings in memory
   * (`{...site, bindings: {...site.bindings, ...inputs}}`) before `checkPack` and `boundInputs` see
   * them, and before the workspace is prepared. The Permit is untouched: every overridden path still
   * resolves through this same Site's own `permitFile`/`permitRules`, so it still passes
   * `decideRead`/`decideWrite` exactly as a bound path from the site file would. Absent, a start
   * reads and binds exactly as it always has.
   */
  readonly inputs?: Readonly<Record<string, string>>;
  /**
   * The very overrides object the caller's own preparation used to mint `proposalId` (#41 task 3):
   * a Campaign-file-aware caller (the `fromCampaignFile` route, `hima_run` applying a workspace
   * file) already holds this from the same read that built `goal`/`strategy`/`inputs` above, and
   * handing it straight through is what lets `startRunOnce`'s own defence-in-depth staleness recheck
   * recompute the *exact* facts identity the proposal was minted with — including a Strategy knob
   * away from its default, or a Budget override — rather than re-deriving an approximation from this
   * request's own fields, which cannot always reconstruct it (a confirmed Campaign's Strategy may be
   * omitted here because it already equals the reviewed proposal's; its Budget is refused here
   * outright). Absent for every caller that predates that task, whose recheck is unchanged.
   */
  readonly overrides?: PreparationOverrides;
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
  /** The declared Site/inputs cannot host this method. No Run or Site write exists. */
  | { readonly kind: 'unfit'; readonly check: PackCheck }
  /** Original Run persists; preparation explains why its workspace could not be accepted. */
  | { readonly kind: 'unprepared'; readonly run: import('./durable-fabric.js').DurableRunView; readonly prepared: PrepareResult | import('./workspace.js').WorkspaceFilesResult }
  /** Workspace accepted; current PG/DBOS facts say whether execution is running or finished. */
  | { readonly kind: 'ran'; readonly run: import('./durable-fabric.js').DurableRunView; readonly workspace: string }
  /** Original PG opening exists; DBOS prepares and executes asynchronously. */
  | { readonly kind: 'preparing'; readonly run: import('./durable-fabric.js').DurableRunView; readonly workspace: string };

/** The Site a preparation actually checks facts against: the Site's own bindings, with a Campaign
 *  file's input overrides (#41 task 3) merged over them in memory. The Permit is untouched — every
 *  overridden path still resolves through this same Site's own `permitFile`/`permitRules`. */
function siteWithInputOverrides(site: Site, overrides: PreparationOverrides | undefined): Site {
  return overrides?.inputs === undefined ? site : { ...site, bindings: { ...site.bindings, ...overrides.inputs } };
}

/**
 * Facts a preparation promises, computed again from the final Pack/Site snapshots at admission.
 *
 * `overrides` is absent for every caller that predates #41 task 3 — the legacy workbench page,
 * `/hima/api/start-options`, every existing tool and command path — and this function's answer for
 * them is unchanged: a Goal and Strategy filled from the Pack's own declared defaults, and Site
 * inputs bound exactly as the Site file states them. Given `overrides`, the Campaign file's own
 * declared Goal stands with **no default filled in** (a Goal is never filled from a default), its
 * Strategy knobs overlay the Pack's defaults, its Budget overrides join the identity, and its input
 * overrides are merged over the Site's own bindings before `checkPack` binds them.
 */
export function campaignProposalFactsIdentity(pack: Pack, site?: Site, overrides?: PreparationOverrides): string {
  const effectiveSite = site === undefined ? undefined : siteWithInputOverrides(site, overrides);
  const check = effectiveSite === undefined ? undefined : checkPack(pack, effectiveSite);
  const goal = overrides === undefined
    ? Object.fromEntries(Object.entries(goalDeclarationOf(pack)).map(([name, declaration]) => [name, declaration.default]))
    : { ...(overrides.goal ?? {}) };
  const strategy = overrides === undefined
    ? Object.fromEntries(Object.entries(pack.contract.strategy).map(([name, declaration]) => [name, declaration.default]))
    : Object.fromEntries(Object.entries(pack.contract.strategy).map(([name, declaration]) => [name, overrides.strategy?.[name] ?? declaration.default]));
  const referenceGraph = { entry: pack.graph.entry, nodes: pack.graph.nodes.map((node) => ({ id: node.id, kind: node.kind })),
    edges: pack.graph.edges.map((edge) => ({ from: edge.from, to: edge.to, ...(edge.outcome === undefined ? {} : { outcome: edge.outcome }), ...(edge.revisit === undefined ? {} : { revisit: edge.revisit }) })) };
  return identityOf({ pack: { id: pack.id, version: pack.contract.version, digest: pack.folder.digest(packDigestExcludes) },
    site: site === undefined ? undefined : identityOf(site), goal, strategy, referenceGraph,
    inputs: check?.inputs.map((input) => ({ name: input.name, bound: input.bound })),
    ...(overrides === undefined ? {} : { budget: overrides.budget ?? {} }) });
}

/** Each preparation is confirmable once while retaining a recomputable facts prefix. */
export function newCampaignProposalId(pack: Pack, site?: Site, overrides?: PreparationOverrides): string {
  const facts = campaignProposalFactsIdentity(pack, site, overrides);
  const pending = pendingProposalIds.get(facts);
  if (pending !== undefined && authenticCampaignProposalId(pending)) return pending;
  const nonce = randomBytes(16).toString('hex');
  const message = `${facts}.${nonce}`;
  const issued = `${message}.${createHmac('sha256', proposalSigningKey).update(message).digest('hex')}`;
  rememberPendingProposal(facts, issued);
  return issued;
}

/** Pending proposals are process-local; exact confirmed tokens remain idempotent in the Ledger. */
const proposalSigningKey = randomBytes(32);
const pendingProposalIds = new Map<string, string>();

// H12: the most pending facts this process keeps a re-servable proposal token for. `facts` (#41 task
// 3) now varies with every Goal, Strategy, input and Budget field a Campaign file lets a caller
// override, not only with Pack and Site — a HimaGuide session or a person sweeping many distinct draft
// combinations while confirming none of them would otherwise grow this map for the life of the
// process. 64 is generous for one Host's worth of concurrently-open, unconfirmed drafts and small
// enough that the worst case (every entry evicted and re-minted) costs one HMAC per preparation, which
// this function already pays on a cache miss.
const PENDING_PROPOSAL_CAP = 64;

/** Record `issued` as the pending token for `facts`, evicting the oldest entry once the cap is
 *  exceeded. `Map` keeps insertion order, so "oldest" is simply its first key — and re-preparing
 *  facts already pending deletes and re-inserts first, moving that entry to "newest" rather than
 *  letting a proposal still in active use be the one evicted merely for having been minted earliest. */
function rememberPendingProposal(facts: string, issued: string): void {
  pendingProposalIds.delete(facts);
  pendingProposalIds.set(facts, issued);
  for (const oldest of pendingProposalIds.keys()) {
    if (pendingProposalIds.size <= PENDING_PROPOSAL_CAP) break;
    pendingProposalIds.delete(oldest);
  }
}

function proposalFactsPart(proposalId: string): string | undefined {
  const [facts, nonce, signature, ...extra] = proposalId.split('.');
  if (extra.length || !/^[a-f0-9]{64}$/.test(facts ?? '')) return undefined;
  if (nonce === undefined && signature === undefined) return facts;
  if (!/^[a-f0-9]{32}$/.test(nonce ?? '') || !/^[a-f0-9]{64}$/.test(signature ?? '')) return undefined;
  return facts;
}

/** Compare proposal facts while allowing a fresh preparation to issue a new one-shot nonce. */
export function sameCampaignProposalFacts(left: string, right: string): boolean {
  const a = proposalFactsPart(left), b = proposalFactsPart(right);
  return a !== undefined && a === b;
}

function proposalMatchesCurrentFacts(proposalId: string, pack: Pack, site: Site, overrides?: PreparationOverrides): boolean {
  const [facts, nonce, signature] = proposalId.split('.');
  if (proposalFactsPart(proposalId) !== campaignProposalFactsIdentity(pack, site, overrides) || nonce === undefined || signature === undefined) return false;
  const expected = createHmac('sha256', proposalSigningKey).update(`${facts}.${nonce}`).digest();
  return timingSafeEqual(expected, Buffer.from(signature!, 'hex'));
}

/** A proposal token is a Host-issued capability, not merely a hash-shaped scope supplied by a
 * caller.  Product faces may validate the token before a Campaign exists; Fabric still compares
 * its facts with the Pack and Site at final admission. */
export function authenticCampaignProposalId(proposalId: string): boolean {
  const [facts, nonce, signature, ...extra] = proposalId.split('.');
  if (extra.length !== 0 || !/^[a-f0-9]{64}$/.test(facts ?? '') || !/^[a-f0-9]{32}$/.test(nonce ?? '') || !/^[a-f0-9]{64}$/.test(signature ?? '')) return false;
  const expected = createHmac('sha256', proposalSigningKey).update(`${facts}.${nonce}`).digest();
  return timingSafeEqual(expected, Buffer.from(signature!, 'hex'));
}

/**
 * Admit a Campaign and persist its original method/input; DBOS prepares and executes asynchronously.
 *
 * @param deps - the ledger, HimaJudge, and where sites and packs are installed.
 * @param req - the pack, the Site, the Goal, the first strategy, and the Budget.
 * @returns the original Run/preparation identity, or the preflight refusal.
 * @throws RunStartError when the request itself cannot be acted on; PackNotFoundError and
 *         SiteNotFoundError for a pack or Site that is not installed. Local runtime/database
 *         failure is unavailable, with no legacy execution fallback.
 */
const proposalStarts = new WeakMap<Ledger, Map<string, Promise<StartRunResult>>>();

/** Serialize confirmations of the same proposal inside one Host; the durable Run row below keeps
 * the identity idempotent after restart. */
export function startRun(deps: FabricDeps, req: StartRunRequest): Promise<StartRunResult> {
  if (req.proposalId === undefined) return startRunOnce(deps, req);
  const starts = proposalStarts.get(deps.ledger) ?? new Map<string, Promise<StartRunResult>>();
  proposalStarts.set(deps.ledger, starts);
  const held = starts.get(req.proposalId);
  if (held !== undefined) return held;
  const started = startRunOnce(deps, req);
  starts.set(req.proposalId, started);
  void started.then(() => starts.delete(req.proposalId!), () => starts.delete(req.proposalId!));
  return started;
}

async function startRunOnce(deps: FabricDeps, req: StartRunRequest): Promise<StartRunResult> {
  if (req.ownerSessionId === undefined) throw new RunStartError('preparing a Run requires a live conversational owner');
  if (req.ownerSessionId !== undefined && !deps.host?.get('agents')?.list().some((agent) => String(agent.id) === req.ownerSessionId)) {
    throw new RunStartError('the execution owner must be a live conversation on this Host');
  }
  const runtime = durableRuntimeOf(deps);
  if (!req.ownerSessionId) throw new RunStartError('Every new durable Run requires its conversational owner');
  const requestDigest = durableStartRequestDigest(req);
  if (req.proposalId) {
    const original = await durableProposalRun(deps,req.proposalId,requestDigest);
    if (original) {
      try { req.onOpened?.(durableRunView(original)); } catch(error) { deps.log?.(`run-opened callback: ${(error as Error).message}`); }
      await startDurablePreparation(runtime,original.runId);
      return durableStartResult(runtime,original);
    }
  }
  const site = loadSite(deps.sitesDir, req.site);
  // H4: the one source of truth for which input overrides this start actually applies is
  // `req.overrides?.inputs` when the caller handed one through — the very object its own preparation
  // minted `proposalId` from (#41 task 3) — falling back to the flatter `req.inputs` only for a caller
  // that predates `overrides` and never sets it. Reading `req.inputs` alone here, while
  // `campaignProposalFactsIdentity` above already prefers `req.overrides`, was two different readings
  // of "what this start overrides" that happened to agree only when both were supplied or both left
  // out.
  const inputOverrides = req.overrides?.inputs ?? req.inputs;
  // Campaign-file input overrides (#41 task 3), merged over the Site's own bindings in memory: the
  // Permit is untouched, since `effectiveSite` keeps this same Site's own `permitFile`/`permitRules`
  // and only its `bindings` differ, so every overridden path still passes `decideRead`/`decideWrite`
  // exactly as a bound path from the site file would. `site` itself (unmerged) is what a later
  // resumption reloads and compares its own control identity against (`recovery.ts`), so it is kept
  // and never replaced by the merged copy; only what depends on bindings uses `effectiveSite`.
  const effectiveSite = siteWithInputOverrides(site, inputOverrides === undefined ? undefined : { inputs: inputOverrides });
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
  const check = checkPack(pack, effectiveSite);
  // Preferably the caller's own overrides object (#41 task 3): a Campaign-file-aware caller already
  // holds the very `PreparationOverrides` its preparation minted `proposalId` from, and handing it
  // straight through recomputes the *exact* facts identity — a Strategy knob away from its default
  // that this request may leave out because it already equals the reviewed proposal's, a Budget
  // override this request is refused from carrying outright, both included correctly.
  //
  // Falling back to `req.inputs` as the one signal that this confirmation followed an overrides-aware
  // preparation without handing `overrides` through: a legacy caller — the workbench page,
  // `/hima/api/start-options`, every tool call with no Campaign file — never sets either, and this
  // recompute is then byte-identical to the one before this task, matching whatever
  // `newCampaignProposalId(pack, site)` minted with no overrides. This fallback path cannot always
  // reconstruct a Strategy or Budget override correctly (see above), which is why every caller that
  // actually has one now hands `req.overrides` through instead of relying on it.
  const identityOverrides: PreparationOverrides | undefined = req.overrides ?? (req.inputs === undefined ? undefined : {
    goal: Object.fromEntries(Object.entries(req.goal).map(([name, value]) => [name, typeof value === 'number' ? value : Number(value)])),
    strategy: req.strategy,
    inputs: req.inputs,
  });
  if (req.proposalId !== undefined && !proposalMatchesCurrentFacts(req.proposalId, pack, site, identityOverrides)) {
    throw new RunStartError('Campaign preparation changed after confirmation; inspect a fresh proposal before starting');
  }
  if (req.proposalId !== undefined && req.test === true && packStageFrom(folder).stage === 'released') {
    throw new RunStartError('a confirmed released product Campaign cannot be changed into a Pack test');
  }
  if (!check.fit) return { kind: 'unfit', check };

  const admittedGoal = goalFrom(goalDeclarationOf(pack), req.goal);
  if ('error' in admittedGoal) throw new RunStartError(admittedGoal.error);
  const goal = admittedGoal.goal;
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
    timeBoxMs: req.timeBoxMs ?? pack.contract.budget.timeBoxMs ?? defaultTimeBoxMs,
    closingReserveMs: pack.contract.budget.closingReserveMs,
    attemptLimit: pack.contract.budget.attemptLimit,
    researchWriteAttempts: pack.contract.budget.researchWrites.writeAttempts,
    researchWriteBytes: pack.contract.budget.researchWrites.bytes,
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
  if (budget.closingReserveMs >= budget.timeBoxMs) {
    throw new RunStartError(`this Pack reserves ${String(budget.closingReserveMs)} ms for closing inside a ${String(budget.timeBoxMs)} ms time box; the reserve must be smaller than the original box`);
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
  // A method may declare the fewest generations its graph needs to reach a first useful result
  // (`budget.minimumGenerations`). A Run started under a smaller limit would end at the generation
  // limit before it can produce anything, so it is refused at creation naming both numbers.
  const minimumGenerations = pack.contract.budget.minimumGenerations;
  if (minimumGenerations !== undefined && budget.generationLimit < minimumGenerations) {
    throw new RunStartError(`this run's generation limit is ${budget.generationLimit}, but Pack ${pack.id} declares it needs at least ${minimumGenerations} generations (budget.minimumGenerations) to reach its first result; start it with a generation limit of at least ${minimumGenerations}`);
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
  // Runtime file resolvers use the same retained method even during an installation update.
  try {
    folder = snapshotPackFolder(preservePackMethod(folder));
    pack = loadPackFrom(folder);
  } catch (err) {
    throw new RunStartError(`pack ${req.pack} cannot preserve its method for this Run: ${(err as Error).message}`);
  }
  const control = req.ownerSessionId === undefined ? {} : { control: { mode: 'agent' as const, owner: req.ownerSessionId,
    ...(req.guideSessionId === undefined ? {} : { guideSessionId: req.guideSessionId }),
    epoch: 0, revision: 0, paused: [], executions: {}, requests: {}, siteDigest: identityOf(site) } };
  const durable = await openDurableProductRun(deps,{pack,site,effectiveSite,retainedPackDir:folder.dir,
    owner:req.ownerSessionId,requestDigest,inputs:inputOverrides,
    opening:{campaignId,siteId:site.name,...(req.proposalId?{proposalId:req.proposalId}:{}),packId:pack.id,purpose,packDigest,goal,budget,firstStrategy:strategy,strategy,generation:1,...control}});
  const opened = durableRunView(durable);
  if (req.proposalId !== undefined) {
    const facts = campaignProposalFactsIdentity(pack,site,identityOverrides);
    if (pendingProposalIds.get(facts) === req.proposalId) pendingProposalIds.delete(facts);
  }
  try { req.onOpened?.(opened); } catch(error) { deps.log?.(`run-opened callback for ${opened.id}: ${(error as Error).message}`); }
  await startDurablePreparation(runtime,opened.id);
  if(req.notifyOwnerOnOpen) deps.notify?.(durable.owner,opened.id,`start:${req.proposalId??opened.id}`,
    'This Campaign is accepted. DBOS prepares its original workspace and executes the frozen Pack method automatically. Read hima_context for current facts; business intervention remains explicit.');
  return durableStartResult(runtime,durable);
}

/**
 * What `/hima resume`, the `hima_resume` tool and the resume route answer. DBOS continues current
 * Runs after verified results and explicit business control, and historical Runs are terminal, so
 * there is never a Run for this face to re-enter: it says why, in words a person can act on, and
 * writes nothing.
 */
export type ResumeResult = { readonly kind: 'unresumable'; readonly run: RunRecord; readonly reason: string };

/**
 * Clear a waiting Run and carry it on: the pre-DBOS face. A durable Run is continued through its
 * owner/epoch/revision control, and a historical Run is never driven again, so every answer is the
 * reason it cannot be resumed here.
 *
 * @throws RunReferenceError when the ledger holds no such Run.
 */
export async function resumeRun(deps: FabricDeps, req: { readonly runId: string; readonly who: string }): Promise<ResumeResult> {
  if(await knownDurableRun(deps,req.runId)) return {kind:'unresumable',run:(await readDurableExecutionContext(deps,req.runId)).run,reason:'This durable Run uses current owner/epoch/revision control; inspect its context and submit an explicit continue or business response'};
  const owned = existingRun(deps.ledger, req.runId);
  if (owned.control !== undefined) return { kind: 'unresumable', run: owned, reason: 'this Run belongs to its conversational Agent; inspect its execution context and use its control protocol' };
  return { kind: 'unresumable', run: owned, reason: 'historical Runs require explicit safe adoption by a live conversational owner; automatic continuation is disabled' };
}

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
export const convergeOf = (pack: Pack): PackConverge | undefined => {
  const revisits = new Set(pack.graph.edges.filter((e) => e.revisit === true).map((e) => e.from));
  const declared = pack.graph.nodes.flatMap((n) =>
    (n.kind === 'explore' && n.parameters.converge ? [{ id: n.id, converge: n.parameters.converge }] : []));
  return (declared.find((n) => revisits.has(n.id)) ?? declared[0])?.converge;
};

/** The Host supplies actor from the actual tool/session context. */
export interface ExecutionActionRequest {
  readonly runId: string; readonly actor: string;
  readonly expectedEpoch: number; readonly expectedRevision: number; readonly requestId: string;
  readonly action: 'begin' | 'work' | 'complete' | 'pause' | 'continue' | 'cancel' | 'handoff' | 'adopt' | 'revise' | 'grow' | 'read' | 'write' | 'knowledge' | 'recommend' | 'analyze' | 'measure-value' | 'engineering' | 'respond';
  readonly response?: { readonly effectId: string; readonly output: import('./task-contract.js').TaskToolOutput };
  readonly analysis?: unknown;
  readonly nodeId?: string; readonly executionId?: string; readonly targetOwner?: string;
  readonly path?: string; readonly content?: string; readonly output?: string; readonly file?: string;
  readonly assetRun?: string; readonly assetPath?: string;
  readonly decision?: 'goal-met' | 'converged' | 'next-strategy' | 'stop';
  readonly strategy?: Readonly<Record<string, StrategyValue>>; readonly rationale?: string;
  /**
   * `autopilot` is the Harness itself taking a node turn inside a Pack-declared autopilot region
   * (ADR-0016), under the owner's identity and epoch. No tool sets it; only the Host's driver does.
   */
  readonly cites?: readonly string[]; readonly origin?: 'agent' | 'human' | 'autopilot';
  /** For an autopilot Workshop write: the branch child Agent that authored the bytes (ADR-0016). */
  readonly onBehalfOf?: string;
  /** Structured PLS-10 proposal for grow, parsed again by Fabric before any acceptance. */
  readonly proposal?: unknown;
  /** Structured PLS-11 change request for revise. */
  readonly revision?: unknown;
  /** Settle the currently active optional branch without claiming its required result. */
  readonly growthDisposition?: 'failed' | 'cancelled' | 'abandoned';
  readonly proposalId?: string;
  /** Explicit human stopwatch evidence for a value study; accepted only through the human route. */
  readonly measurement?: unknown;
  /** Typed resident engineering lifecycle request, accepted only on an outsourcing act tool. */
  readonly engineering?: unknown;
}
export interface GrowthView {
  readonly proposalId: string; readonly event: GrowthRecord['event']; readonly recordId: string;
  readonly entry?: string; readonly parentNode?: string; readonly returnNode?: string;
  readonly optional?: boolean; readonly reason?: string; readonly evidence?: readonly string[];
}
export interface ExecutionContext {
  /** Bounded current task facts shared by Guide, model tools and the existing execution view. */
  readonly tasks?: readonly import('./record-views.js').DurableTaskView[];
  readonly sources?: readonly string[];
  /** Derived from durable control receipts, never an independent pause store. */
  readonly holds?: readonly { readonly scope: string; readonly source: 'human' | 'agent' | 'unknown'; readonly actor?: string; readonly requestId?: string }[];
  /** Canonical record identities for structured grow/revise proposals; file SHA is a different identity. */
  readonly evidence?: readonly { readonly recordId: string; readonly contentIdentity: string; readonly type: string; readonly generation?: number; readonly nodeId?: string }[];
  readonly run: RunRecord; readonly nodes: readonly PackNode[];
  readonly budget: ReturnType<typeof budgetStanding>;
  readonly method?: { readonly id: string; readonly version: string; readonly digest: string; readonly dir: string; readonly contract: Pack['contract']; readonly reference: Pack['graph'] };
  readonly available: readonly string[]; readonly executions: readonly NodeExecution[]; readonly growths: readonly GrowthView[];
  readonly revisions: readonly RevisionRecord[]; readonly reason?: string;
  /** For each current Explore decision point: exactly the evidence ids its completion requires. */
  readonly cite?: readonly ExploreCitation[];
}
export interface ExecutionActionResult {
  readonly kind: 'accepted' | 'duplicate' | 'refused' | 'unsupported'; readonly context: ExecutionContext;
  readonly receipt?: ExecutionReceipt; readonly reason?: string; readonly data?: unknown;
  readonly notification?: import('./node-turns.js').NotificationDelivery;
}

const revisionProposal = z.strictObject({
  revisionId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
  method: z.strictObject({ id: z.string().min(1), version: z.string().min(1), digest: z.string().regex(/^[0-9a-f]{64}$/) }),
  inputThroughSeq: z.number().int().nonnegative(),
  inputs: z.array(z.strictObject({ recordId: z.string().min(1), contentIdentity: z.string().regex(/^[0-9a-f]{64}$/) })).min(1).max(64),
  reason: z.string().trim().min(1).max(4000),
  changedNodes: z.array(z.string().min(1)).min(1).max(256),
  strategy: z.record(z.string(), z.union([z.number(), z.string().min(1)])).optional(),
  changes: z.array(z.strictObject({
    nodeId: z.string().min(1), scope: z.enum(['workshop', 'workspace']),
    path: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/).refine((value) => !value.split('/').includes('..') && !value.startsWith('/')),
    fromSha256: z.string().regex(/^[0-9a-f]{64}$/), content: z.string().max(1024 * 1024),
    sourceRecordId: z.string().min(1).optional(),
  })).max(16),
  affectedNodes: z.array(z.string().min(1)).min(1).max(256),
}).refine((proposal) => proposal.changes.length > 0 || proposal.strategy !== undefined,
  { message: 'revision changes code/input bytes, strategy, or both' });
export type RevisionProposal = z.infer<typeof revisionProposal>;

/** Exact non-revisit downstream closure in the existing Run graphs. */
export function revisionImpactOf(pack: Pack, changedNodes: readonly string[]): string[] {
  const graphs = runGraphsOf(pack).map(({ graph }) => graph);
  const known = new Set(graphs.flatMap((graph) => graph.nodes.map((node) => node.id)));
  for (const id of changedNodes) if (!known.has(id)) throw new Error(`changed node "${id}" is not in this Run method`);
  const affected = new Set(changedNodes);
  const edges = graphs.flatMap((graph) => graph.edges.filter((edge) => edge.revisit !== true).map((edge) => [edge.from, edge.to] as const));
  for (const opener of pack.graph.nodes.filter(opensALoop)) {
    const loop = pack.graph.loops[opener.parameters.opens]; if (loop === undefined) continue;
    edges.push([opener.id, loop.entry]);
    for (const decision of loop.nodes.filter((node) => node.kind === 'explore')) {
      for (const continuation of pack.graph.edges.filter((edge) => edge.from === opener.id).map((edge) => edge.to)) edges.push([decision.id, continuation]);
    }
  }
  for (const growth of pack.growthGraphs ?? []) edges.push([growth.parentNode, growth.graph.entry]);
  let grew = true;
  while (grew) { grew = false; for (const [from, to] of edges) if (affected.has(from) && !affected.has(to)) { affected.add(to); grew = true; } }
  return [...affected];
}

/** The tool-facing preview uses the same effective graph as revision admission. */
export function revisionImpactForRun(deps: FabricDeps, runId: string, changedNodes: readonly string[]): string[] {
  return revisionImpactOf(executionPack(deps, existingRun(deps.ledger, runId)), changedNodes);
}

/** Shared dependency ownership from frozen method declarations and actual retained input captures. */
export function revisionDependencyRoots(pack:Pack,currentStrategy:RunStrategy|undefined,declaredNodes:readonly string[],changes:readonly RevisionProposal['changes'][number][],nextStrategy:RunStrategy|undefined,workspacePaths:ReadonlyMap<string,string>,inputCaptures:readonly {readonly nodeId:string;readonly path:string}[]):{readonly roots?:string[];readonly reason?:string} {
  const roots = new Set(declaredNodes);
  const graphs = runGraphsOf(pack).map(({ graph }) => graph);
  if (nextStrategy !== undefined) {
    const changedKnobs = Object.keys(nextStrategy).filter((name) => currentStrategy?.[name] !== nextStrategy[name]);
    if (changedKnobs.length === 0 && changes.length === 0) return { reason: 'revision strategy does not change any current value' };
    for (const graph of graphs) for (const node of graph.nodes) {
      if (node.kind !== 'act') continue;
      if (Object.values(node.parameters.arguments).some((argument) => typeof argument === 'object'
          && argument.from === 'strategy' && changedKnobs.includes(argument.name))) roots.add(node.id);
    }
  }
  for (const change of changes.filter((item) => item.scope === 'workspace')) {
    const target = workspacePaths.get(`${change.nodeId}:${change.path}`);
    if (target === undefined) return { reason: `workspace input ${change.path} has no verified target path` };
    const outputNames = new Set(pack.contract.outputs.filter((output) => output.path === change.path).map((output) => output.name));
    const consumers = new Set<string>();
    for (const graph of graphs) for (const node of graph.nodes) {
      if (node.kind !== 'act') continue;
      if (node.parameters.observes !== undefined && outputNames.has(node.parameters.observes)) consumers.add(node.id);
      if (node.parameters.workshop !== undefined) {
        const workshop = pack.contract.workshops.find((item) => item.id === node.parameters.workshop);
        if (workshop?.reads.some((name) => outputNames.has(name))) consumers.add(node.id);
      }
    }
    for (const capture of inputCaptures) if (capture.path === target) consumers.add(capture.nodeId);
    if (consumers.size === 0) {
      return { reason: `workspace input ${change.path} has no declared or recorded consumer; its dependency scope cannot be established` };
    }
    if (!consumers.has(change.nodeId)) {
      return { reason: `workspace input ${change.path} is not owned by claimed node ${change.nodeId}; actual consumers are ${[...consumers].join(', ')}` };
    }
    for (const consumer of consumers) roots.add(consumer);
  }
  return { roots: [...roots] };
}

export function identityOf(value: unknown): string {
  const stable = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(stable);
    if (item !== null && typeof item === 'object') return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([key, field]) => [key, stable(field)]));
    return item;
  };
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}
const growthRecords = (deps: FabricDeps, runId: string): GrowthRecord[] =>
  deps.ledger.records({ runId, type: 'growth' }).filter((record): record is GrowthRecord => record.type === 'growth');

function acceptedGrowthGraphs(deps: FabricDeps, pack: Pack, runId: string): GrowthGraph[] {
  const accepted = growthRecords(deps, runId).filter((record) => record.event === 'accepted' && record.proposal !== undefined);
  const seen = new Set<string>();
  const graphs: GrowthGraph[] = [];
  for (const record of accepted) {
    if (seen.has(record.proposalId)) continue;
    const validation = validateGrowthGraph(pack, record.proposal);
    if (!validation.ok) throw new RunStartError(`accepted growth ${record.proposalId} is no longer readable: ${validation.reason}`);
    seen.add(record.proposalId);
    graphs.push({ ...validation.graph, acceptedSeq: record.seq });
  }
  return graphs;
}

/** The durable growth records' answer when a crash split a lifecycle append from its Run-row move. */
function growthPlacement(deps: FabricDeps, pack: Pack, run: RunRecord): { readonly growth: GrowthGraph; readonly target: string } | undefined {
  const records = growthRecords(deps, run.id);
  const graphs = acceptedGrowthGraphs(deps, pack, run.id);
  for (let index = graphs.length - 1; index >= 0; index -= 1) {
    const graph = graphs[index]!;
    const accepted = records.findLast((record) => record.proposalId === graph.proposalId && record.event === 'accepted');
    if (accepted === undefined) continue;
    const terminal = records.findLast((record) => record.proposalId === graph.proposalId && ['completed', 'failed', 'cancelled', 'abandoned', 'returned'].includes(record.event) && record.seq > accepted.seq);
    if (terminal !== undefined && graph.graph.nodes.some((node) => node.id === run.currentNode)) return { growth: graph, target: graph.returnNode };
    if (terminal === undefined && run.currentNode === graph.parentNode) return { growth: graph, target: graph.graph.entry };
  }
  return undefined;
}

function growthViews(deps: FabricDeps, pack: Pack, runId: string): GrowthView[] {
  const graphs = new Map(acceptedGrowthGraphs(deps, pack, runId).map((graph) => [graph.proposalId, graph]));
  return growthRecords(deps, runId).map((record) => {
    const graph = graphs.get(record.proposalId);
    return {
      proposalId: record.proposalId, event: record.event, recordId: record.id,
      ...(graph === undefined ? {} : { entry: graph.graph.entry, parentNode: graph.parentNode, returnNode: graph.returnNode, optional: graph.optional }),
      ...(record.reason === undefined ? {} : { reason: record.reason }),
      ...(record.evidence === undefined ? {} : { evidence: record.evidence }),
    };
  });
}

export function executionPack(deps: FabricDeps, run: RunRecord): Pack {
  if (run.packId === undefined || run.packDigest === undefined) throw new RunStartError('the original Pack method identity is unavailable');
  const reference = loadRunPack(deps.packsDir, run.packId, run.packDigest);
  return withGrowthGraphs(reference, acceptedGrowthGraphs(deps, reference, run.id));
}
/** Pause follows dependency edges, including Loop entry/return, but never a future revisit. */
function executionPauseReason(pack: Pack, run: RunRecord, nodeId: string): string | undefined {
  const paused = run.control?.paused ?? [];
  if (paused.includes('*')) return 'business admission is paused for this Run';
  const graphs = runGraphsOf(pack).map(({ graph }) => graph);
  const dependent = new Set(paused);
  const edges = graphs.flatMap((graph) => graph.edges.filter((edge) => edge.revisit !== true).map((edge) => [edge.from, edge.to] as const));
  for (const opener of pack.graph.nodes.filter(opensALoop)) {
    const loop = pack.graph.loops[opener.parameters.opens];
    if (loop === undefined) continue;
    edges.push([opener.id, loop.entry]);
    const continuations = pack.graph.edges.filter((edge) => edge.from === opener.id).map((edge) => edge.to);
    for (const decision of loop.nodes.filter((node) => node.kind === 'explore')) {
      for (const to of continuations) edges.push([decision.id, to]);
    }
  }
  for (const growth of pack.growthGraphs ?? []) edges.push([growth.parentNode, growth.graph.entry]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [from, to] of edges) if (dependent.has(from) && !dependent.has(to)) { dependent.add(to); changed = true; }
  }
  return dependent.has(nodeId) ? 'business admission is paused for this node or an upstream dependency' : undefined;
}

/** A pause without scoped provenance is conservatively human-clearable. */
function executionHolds(control: RunControl): NonNullable<ExecutionContext['holds']> {
  const requests = Object.values(control.requests).sort((a, b) => a.revision - b.revision);
  return control.paused.map(scope => {
    let held: NonNullable<ExecutionContext['holds']>[number] = { scope, source: 'unknown' };
    for (const request of requests) {
      const data = request.receipt.data;
      if (data === null || typeof data !== 'object' || Array.isArray(data)) continue;
      if (request.state === 'done' && request.receipt.action === 'continue'
        && Array.isArray(data.clearedScopes) && data.clearedScopes.includes(scope)) held = { scope, source: 'unknown' };
      if (!['pause', 'handoff', 'adopt'].includes(request.receipt.action) || data.scope !== scope) continue;
      // Repeating a pause cannot downgrade an earlier human or unknown hold.
      if (held.source === 'human' || (held.source === 'unknown' && data.newHold !== true && request.origin === 'agent')) continue;
      held = { scope, source: request.origin === 'autopilot' ? 'agent' : request.origin ?? 'unknown', actor: request.actor, requestId: request.receipt.requestId };
    }
    return held;
  });
}

function unclearedFailure(run: RunRecord, scope: string): NodeExecution | undefined {
  return Object.values(run.control?.executions ?? {}).findLast((execution) =>
    execution.supersededBy === undefined && execution.phase === 'failed' && execution.humanClearance === undefined
    && (execution.result?.kind === 'hard-blocker' || execution.result?.kind === 'blocked')
    && execution.generation === (run.generation ?? 1) && execution.loopId === run.loop?.id
    && execution.loopGeneration === run.loop?.generation && (scope === '*' || execution.nodeId === scope));
}

export function executionContext(deps: FabricDeps, runId: string): ExecutionContext {
  const run = existingRun(deps.ledger, runId);
  const standing = budgetStanding(run, ownedWaitedMs(run));
  const executions = Object.values(run.control?.executions ?? {});
  const revisions = revisionRecordsIn(deps.ledger, runId);
  const evidence = currentRecordsIn(deps.ledger.records({ runId })).filter(record => ['workspace', 'observation', 'verdict', 'code', 'knowledge'].includes(record.type)).slice(-128)
    .map(record => ({ recordId: record.id, contentIdentity: identityOf(record), type: record.type,
      ...(record.generation === undefined ? {} : { generation: record.generation }), ...('nodeId' in record ? { nodeId: record.nodeId } : {}) }));
  if (run.control === undefined) return { run, budget: standing, nodes: [], available: [], executions, growths: [], revisions, reason: 'historical automatic Run; explicit safe ownership migration is required' };
  try {
    const pack = executionPack(deps, run);
    const nodes = runGraphsOf(pack).flatMap(({ graph }) => graph.nodes);
    const placement = growthPlacement(deps, pack, run);
    const candidates = run.fork === undefined
      ? run.currentNode === undefined ? [] : [placement?.target ?? run.currentNode]
      : Object.values(run.fork.branches).every((branch) => branch.state === 'done')
        ? [run.fork.join]
        : Object.values(run.fork.branches).filter((branch) => branch.state !== 'done').map((branch) => branch.currentNode);
    const incomplete = Object.values(run.control.requests).some((request) => (request.receipt.action === 'complete' || request.receipt.action === 'continue' || request.receipt.action === 'revise') && request.state !== 'done');
    const available = standing.phase === 'exhausted' || run.status !== 'running' || run.control.stop !== undefined || incomplete ? [] : candidates.filter((nodeId) =>
      !((standing.attemptLimitSpent || standing.phase === 'closing') && nodes.find((node) => node.id === nodeId)?.kind === 'act')
      && executionPauseReason(pack, run, nodeId) === undefined && unclearedFailure(run, nodeId) === undefined && !executions.some((execution) =>
        execution.nodeId === nodeId && execution.generation === (run.generation ?? 1)
        && execution.loopId === run.loop?.id && execution.loopGeneration === run.loop?.generation
        && execution.supersededBy === undefined && execution.phase !== 'failed'));
    const cite = candidates.flatMap((nodeId) => {
      const node = positionOf(pack, nodeId)?.node;
      return node?.kind === 'explore' && !opensALoop(node) ? [exploreCitation({ deps, runId, pack }, node)] : [];
    });
    return { run, budget: standing, nodes, available, executions, evidence, ...(cite.length === 0 ? {} : { cite }), holds: executionHolds(run.control), growths: growthViews(deps, pack, run.id), revisions, ...(incomplete ? { reason: 'an admitted completion, revision or human clearance has not finished recording its effect; inspect its receipt before new business work' } : standing.phase === 'closing' ? { reason: 'the Campaign is in its closing reserve; analysis, fact reading and deterministic settlement remain, but no new experiment, revision, growth or Workshop write may start' } : standing.phase === 'exhausted' ? { reason: 'the Campaign hard time box is exhausted; only deterministic facts and missing-delivery reporting remain' } : standing.attemptLimitSpent && candidates.some((nodeId) => nodes.find((node) => node.id === nodeId)?.kind === 'act') ? { reason: 'the Campaign attempt limit is exhausted; the current act node cannot be admitted, while analysis and deterministic closing remain available' } : {}), method: { id: pack.id, version: pack.contract.version, digest: run.packDigest!, dir: pack.dir, contract: pack.contract, reference: pack.graph } };
  } catch (error) {
    return { run, budget: standing, nodes: [], available: [], executions, growths: [], revisions, reason: (error as Error).message };
  }
}

/** Current PG facts for new Runs; the synchronous executionContext is only the historical reader. */
export async function readExecutionContext(deps:FabricDeps,runId:string):Promise<ExecutionContext & {readonly engine?: 'dbos/5.2.11';readonly durable?: import('./durable-fabric.js').DurableExecutionContext['durable']}> {
  return await knownDurableRun(deps,runId) ? readDurableExecutionContext(deps,runId) : executionContext(deps,runId);
}

/** Claiming runs no tool; repeated claims return the same durable execution. */
export async function executionAction(deps: FabricDeps, req: ExecutionActionRequest): Promise<ExecutionActionResult> {
  if(await knownDurableRun(deps,req.runId)) {
    const context = await readDurableExecutionContext(deps,req.runId);
    if (!['pause','continue','cancel','handoff','revise','grow','respond','engineering','measure-value'].includes(req.action)) return {kind:'unsupported',context,reason:'DBOS executes the frozen Pack method automatically; only explicit business intervention and control are accepted'};
    try {
      if(req.origin!=='human' && !deps.host?.get('agents')?.list().some(agent=>String(agent.id)===req.actor)) return {kind:'refused',context,reason:'Control actor must be a live conversation on this Host'};
      if(req.action==='measure-value') {
        const data=await durableRuntimeOf(deps).store.measureHumanEffort({runId:req.runId,requestId:req.requestId,actor:req.actor,origin:req.origin,epoch:req.expectedEpoch,revision:req.expectedRevision,measurement:req.measurement});
        return {kind:data.duplicate?'duplicate':'accepted',context:await readDurableExecutionContext(deps,req.runId),data:data.request.receipt.data,receipt:data.request.receipt};
      }
      if(req.action==='engineering') {
        const operation=engineeringRequest.parse(req.engineering);
        if(operation.operation!=='message'||!req.executionId)throw new Error('Tasks start, collect and close automatically; send a message to an existing execution, or inspect/control its current facts');
        const {messageFlowTask}=await import('./flow-workflow.js');
        const handle=await messageFlowTask(durableRuntimeOf(deps),{runId:req.runId,effectId:req.executionId,requestId:req.requestId,
          owner:req.actor,epoch:req.expectedEpoch,revision:req.expectedRevision,message:operation.message});
        const retained=await durableRuntimeOf(deps).store.flowFact(req.runId,`task-message-result:${req.requestId}`);
        const data={state:retained?'recorded':'accepted',workflowId:handle.workflowID,...(retained?{result:retained}:{})};
        return {kind:'accepted',context:await readDurableExecutionContext(deps,req.runId),data,receipt:{requestId:req.requestId,action:req.action,data}};
      }
      const humanControl=req.origin==='human'&&(req.action==='pause'||req.action==='cancel'||(req.action==='continue'||req.action==='respond')&&context.run.control?.guideSessionId===req.actor);
      const command: import('./run-store.js').DurableCommand = {runId:req.runId,commandId:req.requestId,action:req.action as import('./run-store.js').DurableCommand['action'],
        owner:humanControl?context.run.control!.owner:req.actor,actor:req.actor,epoch:req.expectedEpoch,revision:req.expectedRevision,origin:req.origin==='human'?'human':'agent',...(req.targetOwner?{nextOwner:req.targetOwner}:{}),
        ...(req.nodeId&&['pause','continue','cancel'].includes(req.action)?{scope:{taskId:req.nodeId}}:{}),
        ...(req.action==='revise'?{change:req.revision as import('./run-store.js').DurableCommand['change']}:{}) ,...(req.response?{response:req.response}:{})};
      const legacyResearch=req.action==='grow'||req.action==='revise'&&req.revision!==null&&typeof req.revision==='object'&&'changedNodes' in req.revision;
      const data = legacyResearch ? await submitDurableResearchCommand(deps,await prepareDurableResearchCommand(deps,req)) : await controlDurableRun(deps,command);
      return {kind:('duplicate' in data&&data.duplicate===true)||context.durable.controls.some(control=>(control as {commandId?:string}).commandId===req.requestId)?'duplicate':'accepted',context:await readDurableExecutionContext(deps,req.runId),data,receipt:{requestId:req.requestId,action:req.action,data}};
    } catch(error) { return {kind:'refused',context:await readDurableExecutionContext(deps,req.runId),reason:(error as Error).message}; }
  }
  // Historical Runs are terminal and read-only: DBOS executes every current Run (ADR-0018).
  return { kind: 'refused', context: executionContext(deps, req.runId),
    reason: existingRun(deps.ledger, req.runId).control === undefined ? 'this historical Run has no conversational owner'
      : 'this historical Run is read-only; the pre-DBOS execution protocol is retired' };
}

/** The original resident-engineering identity of a historical execution, for reading its retained delivery. */
export function residentEngineeringIdentityFor(deps: FabricDeps, run: RunRecord, execution: NodeExecution): EngineeringTaskIdentity {
  const pack = executionPack(deps, run);
  const position = positionOf(pack, execution.nodeId);
  if (position?.node.kind !== 'act' || position.node.parameters.tool === undefined) {
    throw new RunStartError('resident engineering is available only on an act node naming one tool');
  }
  const toolName = position.node.parameters.tool;
  const tool = pack.contract.tools.find((item) => item.id === toolName);
  if (tool?.outsourcing === undefined) throw new RunStartError(`tool "${toolName}" does not declare resident engineering outsourcing`);
  const site = loadSite(deps.sitesDir, run.siteId);
  const prepared = deps.ledger.records({ runId: run.id, type: 'workspace' })
    .findLast((record): record is WorkspaceRecord => record.type === 'workspace' && record.seq <= (execution.inputThroughSeq ?? -1));
  if (prepared === undefined) throw new RunStartError('the engineering execution has no verified original workspace');
  const bindings = recordedInputs(pack, site, prepared.bindings);
  const taken = nodeArguments(position.node, run, bindings);
  if (!taken.ok) throw new RunStartError(taken.reason);
  const availableInputs: Record<string, string | undefined> = {
    ...bindings, ...taken.values, WORKSPACE: prepared.workspace, FLOW_ROOT: bindings.flowRoot,
    DESIGN: bindings.design, CAMPAIGN: run.campaignId,
  };
  const boundInputs = Object.fromEntries(tool.inputs.flatMap((name) => availableInputs[name] === undefined ? [] : [[name, availableInputs[name]!]]));
  const expectedStartIdentity = Object.values(run.control?.requests ?? {}).map((request) => request.receipt)
    .findLast((receipt) => receipt.action === 'engineering' && receipt.executionId === execution.id
      && (receipt.data as { operation?: unknown } | undefined)?.operation === 'start'
      && typeof (receipt.data as { capabilitySha256?: unknown }).capabilitySha256 === 'string')?.data;
  return { run, execution, site, pack, workspace: prepared.workspace, bindings,
    outsourcing: tool.outsourcing, licences: tool.licences, tool, boundInputs,
    siteIdentityMatches: run.control?.siteDigest === identityOf(site),
    ...((expectedStartIdentity as { capabilitySha256?: unknown } | undefined)?.capabilitySha256 === undefined ? {}
      : { expectedCapabilitySha256: String((expectedStartIdentity as { capabilitySha256: unknown }).capabilitySha256) }),
    ...((expectedStartIdentity as { taskEnvelopeSha256?: unknown } | undefined)?.taskEnvelopeSha256 === undefined ? {}
      : { expectedTaskEnvelopeSha256: String((expectedStartIdentity as { taskEnvelopeSha256: unknown }).taskEnvelopeSha256) }) };
}

/** Project-authorized read surface for retained delivery, including after release/Run end. */
export async function readEngineeringAsset(deps: FabricDeps, runId: string, executionId: string, requestId: string, artifactId: string, treeId?: string, download = false) {
  const run = existingRun(deps.ledger, runId);
  const execution = run.control?.executions[executionId];
  const delivery = engineeringDeliveriesOf(run).find(item => item.executionId === executionId && item.requestId === requestId);
  if (!execution || !delivery) throw new RunStartError('Run has no verified engineering delivery for that execution/request');
  return readRetainedEngineeringAsset(residentEngineeringIdentityFor(deps, run, execution), delivery, artifactId, treeId, download);
}
