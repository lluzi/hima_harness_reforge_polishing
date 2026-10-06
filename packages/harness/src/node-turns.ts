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
import { type Chooser } from './choosers.js';
import { forkJoinedAt, outputPath, positionOf, resolveChooser, type Pack, type PackNode, type RunReference } from './packs.js';
import { type LaunchRequest, type JobDeps } from './jobs.js';
import { pathsOf, type Site } from './sites.js';
import { channelFor } from './channel.js';
import { existingRun } from './runs.js';
import { currentRecordsIn, nodeRecordsIn } from './ledger.js';
import type { Ledger, NodeRecord, ObservationRecord, PackDataOrigin, RunRecord, VerdictOutcome, VerdictRecord } from './ledger.js';
import { type MomentDeps } from './moments.js';
import type { Judge } from './judge.js';

/** What every fabric operation is given: the ledger a Run lives in, HimaJudge, and where the Sites
 *  and packs this machine holds are installed. Declared here, with the turn that is handed it, and
 *  re-exported from `fabric.ts` so a caller finds it beside `startRun`. */
export interface FabricDeps {
  /** Single Host-owned local execution authority for every new Run. */
  readonly durable?: import('./durable-runtime.js').DurableRuntime;
  readonly durableModelSelection?: { readonly provider: string; readonly model: string };
  /** Original native project identity; a Site name does not establish a project. */
  readonly projectOfRun?: (runId: string) => Promise<string | undefined>;
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
  readonly notify?: (owner: string, runId: string, executionId: string, detail?: string) => NotificationDelivery;
}

/** Immediate Host delivery result. Control facts are already durable whatever this says. */
export interface NotificationDelivery {
  readonly status: 'queued' | 'inactive' | 'owner-unavailable' | 'failed' | 'not-repeated' | 'not-requested';
  readonly message: string;
}

/**
 * Everything the loop needs that is not on the run row, and every piece of it derived from something
 * durable: the pack and the Site from their files, the workspace from the workspace record the Run
 * already holds, the campaign from the run row. Nothing here is a handle a restart would lose, which
 * is what lets #14 rebuild this from the ledger and carry a Run on.
 */
export interface Driving {
  /** Historical recovery observes already launched Jobs while preserving a human waiting state. */
  readonly passiveObservation?: true;
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
 * Why this Workshop node's Job, which exited 0, did not produce its declared output — undefined when
 * it did. Produced means the file is on the Site and is not older than the entry this execution ran
 * (`test OUT -ot ENTRY`; equal timestamps pass): the entry is written for each execution, so an output
 * older than it was left by earlier work. Fails closed: a declaration that no longer resolves, a path
 * that cannot be formed, or a Site that will not answer is a reason, never a pass.
 */
export async function workshopOutputProblem(at: {
  readonly site: Site; readonly pack: Pack; readonly bindings: Readonly<Record<string, string>>; readonly workspace: string;
  readonly node: Extract<PackNode, { kind: 'act' }>; readonly session: string; readonly entryPath: string | undefined;
}): Promise<string | undefined> {
  const { site, pack, node, session } = at;
  const declaration = pack.contract.workshops.find((workshop) => workshop.id === node.parameters.workshop);
  const output = declaration === undefined ? undefined : pack.contract.outputs.find((candidate) => candidate.name === declaration.produces);
  if (declaration === undefined || output === undefined) {
    return `Workshop output of node ${node.id} cannot be verified: workshop "${node.parameters.workshop}" or the output it produces is no longer declared by this Pack`;
  }
  let relative: string;
  let file: string;
  try {
    relative = outputPath(output, at.bindings);
    file = pathsOf(site).join(at.workspace, relative);
  } catch (err) {
    return `Workshop output "${output.name}" of node ${node.id} cannot be verified: ${(err as Error).message}`;
  }
  const why = `the ${declaration.entry} Job of workshop "${declaration.id}" in tmux session ${session} exited 0`;
  const channel = channelFor(site);
  try {
    if (await channel.absent(file)) {
      return `Workshop output ${relative} was not written: ${why} but ${file} is not on site ${site.name}; the entry execution is the Workshop's result and must write its declared output "${output.name}"`;
    }
    if (at.entryPath === undefined) return `Workshop output ${relative} cannot be verified as written by this execution: the launch of tmux session ${session} records no entry`;
    // `test A -ot B` is false when B is missing, which would pass a stale output: ask first.
    if (await channel.absent(at.entryPath)) return `Workshop output ${relative} cannot be verified as written by this execution: its entry ${at.entryPath} is no longer on site ${site.name}`;
    const older = await channel.exec(['test', file, '-ot', at.entryPath]);
    if (older.code === 0) {
      return `Workshop output ${relative} was not written by this execution: ${why} but ${file} is older than its entry ${at.entryPath}, so it was left by earlier work; the entry execution must write its declared output "${output.name}" itself`;
    }
    if (older.code !== 1) return `Workshop output ${relative} cannot be verified as written by this execution: test exited ${older.code} on site ${site.name}${older.stderr.trim() === '' ? '' : `: ${older.stderr.trim()}`}`;
  } catch (err) {
    return `Workshop output ${relative} cannot be verified as written by this execution: ${why}, and site ${site.name} could not be asked about ${file}: ${(err as Error).message}`;
  }
  return undefined;
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
  bindings: Readonly<Record<string, string>> = {},
): { readonly ok: true; readonly values: Record<string, string> } | { readonly ok: false; readonly reason: string } {
  const values: Record<string, string> = {};
  for (const [name, argument] of Object.entries(node.parameters.arguments)) {
    if (typeof argument === 'string') { values[name] = argument; continue; }
    if (typeof argument === 'number') { values[name] = String(argument); continue; }
    const resolved = argument.from === 'input' ? bindings[argument.name] : runValue(run, argument);
    if (resolved === undefined) {
      return { ok: false, reason: `node ${node.id} names argument ${name} that the ${argument.from} binding does not supply: "${argument.name}"` };
    }
    values[name] = String(resolved);
  }
  return { ok: true, values };
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
export function exploreEvidence(ctx: Pick<Driving, 'deps' | 'runId' | 'pack'>, node: Extract<PackNode, { kind: 'explore' }>): ExploreEvidence | { readonly ok: false; readonly reason: string } {
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

  const records = currentRecordsIn(ctx.deps.ledger.records({ runId: ctx.runId }));
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

/**
 * What an Explore completion must cite, said to its owner before it completes (#64 D4): the ids
 * {@link exploreEvidence} requires — the very selection the completion checks — each with the reader
 * and node that took the reading, or the rule and outcome of the verdict. Bounded by the Judge's
 * rules and the fork's branches, so it is a few lines and never the Ledger.
 */
export interface ExploreCitation {
  readonly nodeId: string;
  /** Every id here must be cited; other current-generation observation or verdict ids may be added. */
  readonly cites?: readonly string[];
  readonly records?: readonly (
    | { readonly id: string; readonly type: 'observation'; readonly reader: string; readonly nodeId?: string; readonly branchId?: string }
    | { readonly id: string; readonly type: 'verdict'; readonly ruleId: string; readonly outcome: VerdictOutcome; readonly branchId?: string })[];
  /** Why no citation can be named yet, in the words the completion would refuse with. */
  readonly unavailable?: string;
}

export function exploreCitation(ctx: Pick<Driving, 'deps' | 'runId' | 'pack'>, node: Extract<PackNode, { kind: 'explore' }>): ExploreCitation {
  const evidence = exploreEvidence(ctx, node);
  if (!evidence.ok) return { nodeId: node.id, unavailable: evidence.reason };
  const records = ctx.deps.ledger.records({ runId: ctx.runId });
  const nodes = nodeRecordsOf(ctx);
  const branch = (branchId: string | undefined) => (branchId === undefined ? {} : { branchId });
  return { nodeId: node.id, cites: evidence.cites, records: evidence.cites.flatMap((id): NonNullable<ExploreCitation['records']>[number][] => {
    const record = records.find((candidate) => candidate.id === id);
    if (record?.type === 'verdict') return [{ id, type: 'verdict', ruleId: record.ruleId, outcome: record.outcome, ...branch(record.branchId) }];
    if (record?.type !== 'observation') return [];
    // The node that took the reading is the one whose completion follows it in its branch.
    const reading = nodes.find((candidate) => candidate.seq > record.seq && candidate.state === 'done' && candidate.branchId === record.branchId);
    return [{ id, type: 'observation', reader: record.reader.id, ...(reading === undefined ? {} : { nodeId: reading.nodeId }), ...branch(record.branchId) }];
  }) };
}

/** Does this verdict come from the rule a pack referenced as `<id>` or `<id>@<version>`? */
function matchesRule(verdict: VerdictRecord, reference: string): boolean {
  const [id, version] = reference.split('@');
  return verdict.ruleId === id && (version === undefined || verdict.ruleVersion === version);
}

// The same question of a row the caller is already holding — a caller that read the row for
// something else, the generation a revisit is about to carry — is `driving` itself, in `runs.ts`
// beside the row. It is imported from there by whoever asks it: this module passed it through for a
// while, which is one module standing between two that already know each other (the final review of
// step 3b, J10).

export const nodeRecordsOf = (ctx: Pick<Driving, 'deps' | 'runId'>): NodeRecord[] => nodeRecordsIn(ctx.deps.ledger, ctx.runId);

