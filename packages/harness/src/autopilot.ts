// Branch autopilot (user decision 2026-09-29, ADR-0016): inside a Pack-declared autopilot region the
// Harness takes the node turns the owner would otherwise take, so six expert branches really run at
// once and nobody waits for an owner turn between two mechanical steps.
//
// What it is, and what it is not. It is a **driver of the owner's own operations**: every turn below
// is an `executionAction` (begin, recommend, read, knowledge, write, work, complete) or a delegation
// (create, result, follow-up, adopt, cancel) the owner could have issued, under the owner's identity
// and epoch, recorded with `origin: 'autopilot'`. So the Ledger holds exactly the facts owner-driven
// execution writes, and every fence those operations carry — pause, cancel, Run stop, the time box,
// the attempt limit, the closing reserve, the Site's job cap — holds here unchanged. It is not a
// second graph engine: where the Run goes is still `completeAdmittedNode`'s, fork opening and closing
// are still `forks.ts`'s, and a judge still routes on its first rule.
//
// Who the model is. In a fork branch the only model is the branch's own child Agent: it authors the
// branch Workshop's entry when there is no retained code, and revises it from the Pack Reader's
// itemized problems when the Reader refuses; a Team node's members are materialized in dependency
// order and a result that satisfies the member's declared schema is adopted as it arrives. A schema
// failure gets one repair follow-up; then the branch settles refused. **Never a person**: a node that
// spends its allowance in a branch settles that branch refused and the join judges it as such.
//
// When the owner hears. Once, when the Run leaves the self-driving region (a Workshop the owner
// authors, an Explore decision, the honest end), with one summary of what the region did — for a
// fork, one line per branch.
import { createHash, randomUUID } from 'node:crypto';
import { executionContext, executionPack, identityOf, nodeDisplayName, noticeValue, NOTICE_PREFIX, restartBranchAt, settleBranchRefused, type ExecutionActionRequest, type ExecutionActionResult } from './fabric.js';
import { autopilotDrives, autopilotOf, autopilotSegmentOf, forkFrom, positionOf, type ForkAutopilot, type ForkBranch, type Pack, type PackAgentTeam, type PackAgentTeamMember, type PackNode, type PackWorkshop, type SegmentAutopilot } from './packs.js';
import { currentRecordsIn, hasEnded, type DelegationRecord, type LedgerRecord, type NodeExecution, type ObservationRecord, type RunRecord } from './ledger.js';
import { runDelegations, type RunDelegationRequest, type RunDelegationView } from './delegation-runtime.js';
import { parseDelegationResultObservedPayload } from './delegation.js';
import type { FabricDeps } from './node-turns.js';
import { jobTail } from './jobs.js';
import { listInteractiveSessions } from './interactive-runtime.js';

/** What the driver needs of its Host: the owner's own operations, and nothing that decides. */
export interface AutopilotHost {
  readonly deps: () => FabricDeps;
  /** The owner's execution operation, taken as the autopilot. */
  readonly execute: (request: ExecutionActionRequest) => Promise<ExecutionActionResult>;
  /** The owner's delegation operation, taken as the autopilot. */
  readonly delegate: (request: RunDelegationRequest) => Promise<Record<string, unknown>>;
  /** Whether a child Agent has no turn running (idle, or no longer resident). */
  readonly childIdle: (childSessionId: string) => boolean;
  /** `native` reads a child's completed turn itself; `ledger` waits for its recorded result (tests). */
  readonly childResults: 'native' | 'ledger';
  /** Tell the Run's owner once, with detail; the Host decides whether its Agent is live. */
  readonly notifyOwner: (runId: string, key: string, detail: string, headline?: string) => void;
  /** The recorded Workshop or code material a child needs, read the way the owner would read it. */
  readonly readMaterial: (runId: string, recordId: string) => Promise<string | undefined>;
  /** A reading's retained bytes, for the join summary's record ids. */
  readonly readReading: (runId: string, recordId: string) => Promise<string | undefined>;
  readonly log: (line: string) => void;
  readonly stopped: () => boolean;
  /** How often a wait re-reads the Ledger. */
  readonly pollMs: number;
  /**
   * The Host's own close of this Run's interactive sessions that no Operator may drive any more (the
   * close a Host start or a delegation deadline takes). Absent, such a session waits for its deadline.
   */
  readonly closeUndrivable?: (runId: string) => Promise<void>;
}

/**
 * The plain line the owner's chat shows when the Run leaves a self-driving region, in the Pack's
 * own words: the segment's `label` (else its last node's), a result value when one is at hand,
 * and where the Run stands now. E.g. "HimaHarness: Reference build finished (Fmax 957.67 MHz).
 * Next: HimaTime analysis."
 */
function autopilotHeadline(deps: FabricDeps, pack: Pack, run: RunRecord, records: readonly LedgerRecord[], generation: number, available: readonly string[]): string {
  const segments = autopilotOf(pack).segments;
  const declared = pack.graph.autopilot.filter((entry): entry is SegmentAutopilot => !('fork' in entry));
  const visits = records.filter((record): record is Extract<LedgerRecord, { type: 'node' }> => record.type === 'node'
    && record.generation === generation && record.branchId === undefined && segments.some((segment) => segment.nodes.has(record.nodeId)));
  const last = visits.at(-1);
  const index = last === undefined ? -1 : segments.findIndex((segment) => segment.nodes.has(last.nodeId));
  const name = (index < 0 ? undefined : declared[index]?.label) ?? (last === undefined ? 'The automatic steps' : nodeDisplayName(pack, last.nodeId));
  const start = visits.find((record) => index >= 0 && segments[index]!.nodes.has(record.nodeId));
  const value = noticeValue(deps, run.id, pack, start === undefined ? 0 : start.seq - 1);
  const next = nextStepPhrase(pack, available);
  const where = hasEnded(run.status) ? ' The Campaign ended.' : next !== undefined ? ` ${next}`
    : run.status === 'running' && run.currentNode !== undefined
      ? ` Next: ${nodeDisplayName(pack, run.currentNode)}.` : run.status === 'waiting' ? ' Waiting for a decision.' : '';
  return `${NOTICE_PREFIX} ${name} finished${value === undefined ? '' : ` (${value})`}.${where}`;
}

const spoken = (names: readonly string[]): string =>
  names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)!}`;

/**
 * What the owner should do next, in the Pack's words, from the nodes it may begin now. An outsourced
 * act node (its contract tool declares `outsourcing`) does not start itself: the owner begins it and
 * starts its resident engineering task, so the line says so — for several at once, that they run in
 * parallel. A fork node whose branch heads are outsourced says the same after the fork node.
 * Undefined when nothing is available.
 */
export function nextStepPhrase(pack: Pick<Pack, 'graph' | 'contract'>, available: readonly string[]): string | undefined {
  if (available.length === 0) return undefined;
  const outsourced = (nodeId: string): boolean => outsourcedNode(pack, nodeId);
  const begin = (ids: readonly string[]): string => `begin ${spoken(ids.map((id) => nodeDisplayName(pack, id)))} and start ${ids.length === 1
    ? 'its engineering task' : 'their engineering tasks'}`;
  const agents = available.filter(outsourced);
  if (agents.length > 0) return `Next: ${begin(agents)} now${agents.length > 1 ? ' (they run in parallel)' : ''}.`;
  if (available.length === 1) {
    const node = pack.graph.nodes.find((candidate) => candidate.id === available[0]);
    const fork = node === undefined ? undefined : forkFrom(pack.graph, node);
    const heads = fork?.ok === true ? fork.branches.map((branch) => branch.nodes[0]!).filter(outsourced) : [];
    if (heads.length > 0) return `Next: run ${nodeDisplayName(pack, available[0]!)}, then ${begin(heads)}${heads.length > 1 ? ' (they run in parallel)' : ''}.`;
  }
  return `Next: ${spoken(available.map((id) => nodeDisplayName(pack, id)))}.`;
}

/** An act node whose contract tool declares resident engineering `outsourcing`: it does not start
 *  itself; the owner begins it and starts its engineering task. */
function outsourcedNode(pack: Pick<Pack, 'graph' | 'contract'>, nodeId: string): boolean {
  const node = pack.graph.nodes.find((candidate) => candidate.id === nodeId);
  if (node?.kind !== 'act') return false;
  return pack.contract.tools.find((tool) => tool.id === node.parameters.tool)?.outsourcing !== undefined;
}

/**
 * The owner's instruction in a hand-back, by node id: every outsourced node it may begin now (the
 * admission's `available`, which already leaves out any node begun in this generation) is to be
 * begun and its engineering task started in this same turn — one node after a segment, or every
 * branch head of a fork at once. Undefined when no available node is outsourced.
 */
export function nextStepInstruction(pack: Pick<Pack, 'graph' | 'contract'>, available: readonly string[]): string | undefined {
  const agents = available.filter((nodeId) => outsourcedNode(pack, nodeId));
  if (agents.length === 0) return undefined;
  return agents.length === 1
    ? `Begin ${agents[0]!} now and start its resident engineering task (hima_execute begin, then engineering start) in this same turn; do not wait for another notice.`
    : `Begin ${spoken(agents)} now and start each one's resident engineering task (hima_execute begin, then engineering start) in this same turn; they run in parallel, so do not wait for one before starting the other.`;
}

/** A self-driving fork as the plan resolved it: its declaration, its branches and its join. */
type ForkPlan = ForkAutopilot & { readonly branches: readonly ForkBranch[]; readonly join: string };

/** What waiting for one child's result came to. */
type ChildResult = { readonly kind: 'ok'; readonly recordId: string; readonly text: string } | { readonly kind: 'invalid' | 'ended'; readonly why: string }
  | { readonly kind: 'stopped' } | { readonly kind: 'execution-failed' };

/** What one node turn of the driver came to. */
type Turn = 'moved' | 'held' | 'stopped' | { readonly refused: string };

/** The schema a branch child Agent answers a Workshop authoring request in. */
export const WORKSHOP_ENTRY_SCHEMA = 'hima-workshop-entry/1';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms).unref?.(); });
const refused = (why: string): Turn => ({ refused: why });
const sha256Of = (text: string): string => createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
/**
 * A schema-repair follow-up's id, named by what it repairs: the result record (`r<seq>`), or the idle turn
 * after the child's latest follow-up (`idle<seq>`). One child can be repaired several times (a Workshop author
 * across its failed programs): #64 Q1 #362/#459 reused one id with other text and the Host refused it
 * ("Follow-up id changed contents"). A restart that re-drives the same repair asks with the same id and text.
 */
const repairId = (delegationId: string, of: string): string => `${`ap-repair-${delegationId}`.slice(0, 140)}-${of}`;

/** A Run the driver may take a turn on: running, owned, and not stopping. */
function active(run: RunRecord | undefined): run is RunRecord {
  return run !== undefined && run.status === 'running' && run.control !== undefined && run.control.stop === undefined
    && !run.control.paused.includes('*');
}

/** The current execution of one node here: this generation and Loop, not superseded, latest first. */
function currentExecution(run: RunRecord, nodeId: string, branchId: string | undefined): NodeExecution | undefined {
  return Object.values(run.control?.executions ?? {}).filter((execution) => execution.nodeId === nodeId
    && execution.supersededBy === undefined && execution.generation === (run.generation ?? 1)
    && execution.loopId === run.loop?.id && execution.loopGeneration === run.loop?.generation
    && (branchId === undefined || execution.branchId === branchId))
    .sort((a, b) => a.attempt - b.attempt).at(-1);
}

/** The text a delegation result carries, from its durable handoff. */
function resultText(record: DelegationRecord): string | undefined {
  try { return parseDelegationResultObservedPayload(record.payload).handoff.output.text; } catch { return undefined; }
}

/** One JSON object, or why not. */
function jsonObject(text: string | undefined): { readonly ok: true; readonly value: Record<string, unknown> } | { readonly ok: false; readonly why: string } {
  if (text === undefined) return { ok: false, why: 'the result carries no text' };
  try {
    const value: unknown = JSON.parse(text.trim());
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return { ok: false, why: 'the result is not one JSON object' };
    return { ok: true, value: value as Record<string, unknown> };
  } catch (error) { return { ok: false, why: `the result is not one JSON object: ${(error as Error).message}` }; }
}

/**
 * The self-driving part of a Host. One drive per Run at a time; a kick while one runs asks it to look
 * again when it finishes. Every wait re-reads the Ledger, so a drive picked up after a restart
 * carries on from the facts and never repeats a turn the Ledger already holds.
 */
export class Autopilot {
  readonly #host: AutopilotHost;
  readonly #running = new Map<string, Promise<void>>();
  readonly #again = new Set<string>();
  readonly #notices = new Map<string, string[]>();
  /** The Ledger seq at each Run's latest hand-back, so a summary never repeats an earlier fork's
   *  branches: a round may hold more than one fork (propose, then verify). */
  readonly #handedBackAt = new Map<string, number>();

  constructor(host: AutopilotHost) { this.#host = host; }

  /** Look at this Run: drive it while it stands in a self-driving region. Idempotent and cheap. */
  kick(runId: string): void {
    if (this.#host.stopped()) return;
    if (this.#running.has(runId)) { this.#again.add(runId); return; }
    const drive = this.#drive(runId)
      .catch((error: unknown) => this.#host.log(`hima autopilot: Run ${runId} stopped driving: ${(error as Error).stack ?? String(error)}`))
      .finally(() => {
        this.#running.delete(runId);
        if (this.#again.delete(runId)) this.kick(runId);
      });
    this.#running.set(runId, drive);
  }

  /**
   * The same kick, on the Host's timer (#64 D-T04-1). A Run can come to stand on a self-driving node
   * by a path that kicks nothing — the owner's own `hima_execution` tool calls the fabric operation
   * directly — and then nothing began it until a person pressed Continue. So the Host looks every
   * few seconds: a running Run with no drive in flight whose admissible nodes include one this Pack's
   * autopilot drives is kicked. "Admissible" is the admission's own `available`, so a pause, a hold, an
   * uncleared failure or an execution already under way never counts. It takes no turn and decides
   * nothing; the drive it starts is the one any kick starts.
   */
  sweep(): void {
    if (this.#host.stopped()) return;
    for (const run of this.#deps().ledger.runs()) {
      if (!active(run) || this.#running.has(run.id)) continue;
      try {
        const pack = executionPack(this.#deps(), run);
        if (executionContext(this.#deps(), run.id).available.some((nodeId) => autopilotDrives(pack, nodeId))) this.kick(run.id);
      } catch { /* a Run whose method cannot be read has nothing the autopilot could drive */ }
    }
  }

  /** Every drive of this Host settled; for disposal. */
  async drain(): Promise<void> {
    while (this.#running.size > 0) await Promise.allSettled([...this.#running.values()]);
  }

  /** The owner notices this Host sent for a Run, oldest first: the plain line, a blank line, the detail. */
  notices(runId: string): readonly string[] { return this.#notices.get(runId) ?? []; }

  #deps(): FabricDeps { return this.#host.deps(); }
  #run(runId: string): RunRecord | undefined { return this.#deps().ledger.run(runId); }

  async #drive(runId: string): Promise<void> {
    let turns = 0;
    for (;;) {
      if (this.#host.stopped()) return;
      const run = this.#run(runId);
      if (!active(run)) break;
      const pack = executionPack(this.#deps(), run);
      if (run.fork !== undefined) {
        const fork = autopilotOf(pack).forks.get(run.fork.from);
        if (fork === undefined) break;
        const open = Object.entries(run.fork.branches).filter(([, branch]) => branch.state !== 'done').map(([id]) => id);
        if (open.length === 0) break;
        const ends = await Promise.all(open.map((branchId) => this.#branch(runId, branchId, fork)));
        turns += ends.reduce((sum, end) => sum + end.turns, 0);
        if (ends.some((end) => end.end !== 'done')) break;
        continue;
      }
      if (autopilotSegmentOf(pack, run.currentNode) === undefined) break;
      const turn = await this.#node(runId, run.currentNode!, undefined, undefined);
      if (turn !== 'moved') break;
      turns += 1;
    }
    if (turns > 0) await this.#handBack(runId, turns);
  }

  /**
   * Tell the owner once that the Run left the self-driving region, when it has: where it stands, and
   * for this generation's fork one line per branch with its last node, its adopted Team result record
   * ids and its final reading (record id, and the artifact id that reading carries) — the ids an
   * owner needs for the record without reading the Ledger itself (#64 D-T03-3).
   */
  async #handBack(runId: string, turns: number): Promise<void> {
    const run = this.#run(runId);
    if (run === undefined) return;
    let pack: Pack;
    try { pack = executionPack(this.#deps(), run); } catch { return; }
    const inRegion = run.status === 'running' && (run.fork !== undefined
      ? autopilotOf(pack).forks.has(run.fork.from) : autopilotSegmentOf(pack, run.currentNode) !== undefined);
    if (inRegion) return;
    const generation = run.generation ?? 1;
    const records = this.#deps().ledger.records({ runId });
    const since = this.#handedBackAt.get(runId) ?? 0;
    this.#handedBackAt.set(runId, records.at(-1)?.seq ?? since);
    const current = new Set(currentRecordsIn(records).map((record) => record.id));
    const lastByBranch = new Map<string, LedgerRecord>();
    for (const record of records) {
      if (record.type === 'node' && record.generation === generation && record.branchId !== undefined && record.seq > since) lastByBranch.set(record.branchId, record);
    }
    const adopted = new Map<string, string[]>();
    for (const record of records) {
      if (record.type !== 'delegation' || record.event !== 'result-adopted') continue;
      const recipe = (record.payload as { recipe?: { executionId?: string } } | undefined)?.recipe;
      const execution = recipe?.executionId === undefined ? undefined : run.control?.executions[recipe.executionId];
      if (execution?.branchId === undefined || execution.generation !== generation) continue;
      const resultId = (record.payload as { resultRecordId?: string }).resultRecordId;
      if (resultId !== undefined) adopted.set(execution.branchId, [...(adopted.get(execution.branchId) ?? []), resultId]);
    }
    const branches: string[] = [];
    for (const [branchId, record] of lastByBranch) {
      if (record.type !== 'node') continue;
      const reading = records.findLast((candidate): candidate is ObservationRecord => candidate.type === 'observation'
        && candidate.branchId === branchId && candidate.generation === generation && current.has(candidate.id));
      let artifact = '';
      if (reading !== undefined && record.state !== 'cancelled') {
        const text = await this.#host.readReading(runId, reading.id).catch(() => undefined);
        const parsed = jsonObject(text);
        if (parsed.ok && typeof parsed.value.id === 'string') artifact = `, artifact id ${parsed.value.id}`;
      }
      branches.push(`${branchId}: ${record.state === 'cancelled' ? `refused (${record.reason ?? 'no reason recorded'})` : `${record.nodeId} ${record.state}`}`
        + (adopted.has(branchId) ? `; adopted Team result ${adopted.get(branchId)!.join(', ')}` : '')
        + (reading !== undefined && record.state !== 'cancelled' ? `; final reading ${reading.id} (${reading.reader.id}${artifact})` : ''));
    }
    let available: readonly string[] = [];
    if (run.status === 'running') {
      try { available = executionContext(this.#deps(), runId).available; } catch { available = []; }
    }
    // Inside an open fork `currentNode` is the join, which is not where the owner acts: the branch
    // nodes it may begin are.
    const where = hasEnded(run.status) ? `the Run ended ${run.status}` : run.status !== 'running' ? `the Run is ${run.status}`
      : run.fork !== undefined ? `the Run's fork into ${run.fork.join} is open; ${available.length === 0 ? 'no branch node is yours to begin yet' : `${spoken(available)} ${available.length === 1 ? 'is' : 'are'} yours to begin`}`
        : `the Run now stands at ${run.currentNode ?? 'no node'}, which is yours`;
    const detail = [`Hima autopilot took ${String(turns)} node turn(s) of generation ${String(generation)}; ${where}.`,
      branches.length === 0 ? '' : `Fork branches this generation: ${branches.join(' | ')}.`,
      nextStepInstruction(pack, available) ?? '',
      'Read hima_context once for the facts; the autopilot takes no decision of yours.'].filter(Boolean).join(' ');
    const headline = autopilotHeadline(this.#deps(), pack, run, records, generation, available);
    const list = this.#notices.get(runId) ?? [];
    list.push(`${headline}\n\n${detail}`);
    this.#notices.set(runId, list);
    this.#host.notifyOwner(runId, `autopilot:${runId}:${String(generation)}:${String(run.currentNode)}:${String(list.length)}`, detail, headline);
  }

  /** Drive one branch of a self-driving fork until it reaches the join, is held, or the Run stops. */
  async #branch(runId: string, branchId: string, fork: ForkPlan): Promise<{ readonly end: 'done' | 'held' | 'stopped'; readonly turns: number }> {
    let turns = 0;
    for (;;) {
      if (this.#host.stopped()) return { end: 'stopped', turns };
      const run = this.#run(runId);
      if (!active(run)) return { end: 'stopped', turns };
      const branch = run.fork?.branches[branchId];
      if (branch === undefined || branch.state === 'done') return { end: 'done', turns };
      const turn = await this.#node(runId, branch.currentNode, branchId, fork);
      if (turn === 'moved') { turns += 1; continue; }
      if (typeof turn === 'object') {
        // A refusal the Run's own state explains (a pause, a stop, a hold) is a wait, never a refusal.
        const now = this.#run(runId);
        if (!active(now)) return { end: 'stopped', turns };
        if (/Re-read the Run|paused|hold covers/.test(turn.refused)) return { end: 'held', turns };
        this.#host.log(`hima autopilot: Run ${runId} branch ${branchId} settles refused: ${turn.refused}`);
        if (await settleBranchRefused(this.#deps(), runId, branchId, turn.refused)) { turns += 1; return { end: 'done', turns }; }
        return { end: 'held', turns };
      }
      return { end: turn, turns };
    }
  }

  /** The owner's operation, taken as the autopilot on the row as it stands. */
  async #act(runId: string, fields: Partial<ExecutionActionRequest> & Pick<ExecutionActionRequest, 'action'>): Promise<ExecutionActionResult> {
    const control = this.#run(runId)!.control!;
    return this.#host.execute({ runId, actor: control.owner, origin: 'autopilot', expectedEpoch: control.epoch,
      expectedRevision: control.revision, requestId: `ap-${fields.action}-${randomUUID()}`, ...fields });
  }

  /** The owner's delegation operation, taken as the autopilot. */
  async #delegate(runId: string, fields: Omit<RunDelegationRequest, 'runId' | 'actor' | 'origin' | 'expectedEpoch' | 'expectedRevision' | 'requestId'> & { readonly requestId?: string }): Promise<Record<string, unknown>> {
    const control = this.#run(runId)!.control!;
    try {
      return await this.#host.delegate({ runId, actor: control.owner, origin: 'autopilot', expectedEpoch: control.epoch,
        expectedRevision: control.revision, requestId: fields.requestId ?? `ap-delegate-${randomUUID()}`, ...fields });
    } catch (error) { return { status: 'refused', reason: (error as Error).message }; }
  }

  /** Wait until an execution's phase is one of these, the Run stops, or the Host does. */
  async #phase(runId: string, executionId: string, phases: readonly NodeExecution['phase'][]): Promise<NodeExecution['phase'] | undefined> {
    for (;;) {
      if (this.#host.stopped()) return undefined;
      const run = this.#run(runId);
      if (!active(run)) return undefined;
      const phase = run.control!.executions[executionId]?.phase;
      if (phase === undefined || phases.includes(phase)) return phase;
      await sleep(this.#host.pollMs);
    }
  }

  /**
   * Take the next turn of the node the Run (or this branch) stands at, and wait for what it launched.
   * Answers `moved` once the node completed and the position moved on.
   */
  async #node(runId: string, nodeId: string, branchId: string | undefined, fork: (ForkPlan) | undefined): Promise<Turn> {
    let refusals = 0;
    for (;;) {
      if (this.#host.stopped()) return 'stopped';
      const run = this.#run(runId);
      if (!active(run)) return 'stopped';
      const stillHere = branchId === undefined
        ? run.fork === undefined && run.currentNode === nodeId
        : run.fork?.branches[branchId]?.currentNode === nodeId && run.fork.branches[branchId]!.state !== 'done';
      if (!stillHere) return 'moved';
      const pack = executionPack(this.#deps(), run);
      const node = positionOf(pack, nodeId)?.node;
      if (node === undefined) return 'held';
      const execution = currentExecution(run, nodeId, branchId);
      if (execution === undefined || execution.phase === 'failed') {
        const kind = execution?.result?.kind;
        if (execution !== undefined && kind !== 'retrying') {
          // A spent allowance in a branch ends the branch, never a person; elsewhere it stays the
          // Hard blocker it is, for the owner and a person to see.
          return branchId !== undefined && (kind === 'hard-blocker' || kind === 'blocked')
            ? refused(`${nodeId} attempt ${String(execution.attempt)} failed and its allowance is spent: ${execution.result?.reason ?? execution.reason ?? kind}`)
            : 'held';
        }
        const begun = await this.#act(runId, { action: 'begin', nodeId });
        if (begun.kind === 'accepted' || begun.kind === 'duplicate') { refusals = 0; continue; }
        if (++refusals > 20) { this.#host.log(`hima autopilot: Run ${runId} holds at ${nodeId}: ${begun.reason ?? begun.kind}`); return 'held'; }
        await sleep(this.#host.pollMs * 2);
        continue;
      }
      if (execution.phase === 'begun') {
        const turn = node.kind === 'act' && node.parameters.workshop !== undefined
          ? await this.#workshop(runId, pack, node, execution, branchId, fork)
          : await this.#work(runId, pack, node, execution, branchId);
        if (turn !== 'moved') return turn;
        continue;
      }
      if (execution.phase === 'working' || execution.phase === 'uncertain') {
        // A Job in flight, or one whose effect is being established (a surviving process group):
        // the Job's own observer settles it; the branch waits and never asks a person here.
        const was = execution.phase;
        for (;;) {
          const now = await this.#phase(runId, execution.id, ['begun', 'ready', 'completed', 'failed', ...(was === 'working' ? ['uncertain' as const] : ['working' as const])]);
          if (now === undefined) return 'stopped';
          if (now === 'uncertain' && was === 'working') {
            // Uncertain after working: give the observer its time before looking again.
            await sleep(this.#host.pollMs * 4);
          }
          break;
        }
        continue;
      }
      if (execution.phase === 'ready') {
        if (branchId !== undefined && fork !== undefined && node.kind === 'act' && node.parameters.observes !== undefined) {
          const revised = await this.#reviseIfRefused(runId, pack, node, execution, branchId, fork);
          if (revised === 'restarted') return 'moved';
          if (revised === 'stopped') return 'stopped';
        }
        const done = await this.#act(runId, { action: 'complete', executionId: execution.id });
        if (done.kind === 'accepted' || done.kind === 'duplicate') { refusals = 0; continue; }
        if (++refusals > 20) { this.#host.log(`hima autopilot: Run ${runId} holds at ${nodeId}: ${done.reason ?? done.kind}`); return 'held'; }
        await sleep(this.#host.pollMs * 2);
        continue;
      }
      // `completed` with the position not yet moved: another writer is mid-way; look again.
      await sleep(this.#host.pollMs);
    }
  }

  /** A tool or reader node, or a Team node: launch its work and return once it is no longer `begun`. */
  async #work(runId: string, pack: Pack, node: PackNode, execution: NodeExecution, branchId: string | undefined): Promise<Turn> {
    const team = node.kind === 'act' ? pack.contract.agentTeams.find((candidate) => candidate.triggerNode === node.id) : undefined;
    if (team !== undefined && !this.#batchApplies(runId, pack, team, branchId)) return this.#team(runId, team, execution);
    const worked = await this.#act(runId, { action: 'work', executionId: execution.id });
    if (worked.kind === 'refused') {
      this.#host.log(`hima autopilot: Run ${runId} work of ${node.id} refused: ${worked.reason ?? ''}`);
      await sleep(this.#host.pollMs * 2);
      const again = this.#run(runId)?.control?.executions[execution.id]?.phase;
      return again === 'begun' ? 'held' : 'moved';
    }
    return 'moved';
  }

  /** The latest current reading of one declared output here (this generation, Loop and branch). */
  #reading(runId: string, pack: Pack, output: string, branchId: string | undefined): ObservationRecord | undefined {
    const run = this.#run(runId)!;
    const reader = pack.contract.outputs.find((candidate) => candidate.name === output)?.reader;
    if (reader === undefined) return undefined;
    return currentRecordsIn(this.#deps().ledger.records({ runId })).findLast((record): record is ObservationRecord =>
      record.type === 'observation' && record.reader.id === reader && record.generation === (run.generation ?? 1)
      && record.loopId === run.loop?.id && (branchId === undefined || record.branchId === branchId));
  }

  /** Whether the Pack says this Team node runs its tool's batch path now (`batchWhen`). */
  #batchApplies(runId: string, pack: Pack, team: PackAgentTeam, branchId: string | undefined): boolean {
    return team.batchWhen.some((condition) => {
      const value = this.#reading(runId, pack, condition.input, branchId)?.values.find((item) => item.type === condition.value)?.value;
      if (typeof value !== 'number') return false;
      return condition.equals !== undefined ? value === condition.equals : value > condition.above!;
    });
  }

  /**
   * Materialize a Team's required members in dependency order, adopt each schema-valid result, and
   * return once the Team's execution is ready (its Operator's session closed) for completion.
   */
  async #team(runId: string, team: PackAgentTeam, execution: NodeExecution): Promise<Turn> {
    const required = team.members.filter((member) => member.optional !== true);
    const ordered: PackAgentTeamMember[] = [];
    const place = (member: PackAgentTeamMember): void => {
      if (ordered.includes(member)) return;
      for (const dependency of member.dependencyRoles) {
        const found = required.find((candidate) => candidate.id === dependency);
        if (found !== undefined) place(found);
      }
      ordered.push(member);
    };
    for (const member of required) place(member);
    for (const member of ordered) {
      const rowOf = (): RunDelegationView | undefined => runDelegations(this.#deps(), runId).find((row) => row.effective.recipe?.teamId === team.id
        && row.effective.recipe.version === team.version && row.effective.recipe.memberId === member.id && row.effective.recipe.executionId === execution.id);
      let row = rowOf();
      if (row?.adoptedRecordId !== undefined) continue;
      if (row === undefined) {
        const created = await this.#delegate(runId, { action: 'create', recipe: { teamId: team.id, version: team.version, memberId: member.id, executionId: execution.id },
          requestId: `ap-create-${team.id}-${member.id}-${execution.id}`.slice(0, 160) });
        row = rowOf();
        if (row === undefined) {
          const phase = this.#run(runId)?.control?.executions[execution.id]?.phase;
          if (phase !== 'begun') return 'moved';
          return refused(`Team ${team.id} member ${member.id} could not be materialized: ${String(created.reason ?? created.status)}`);
        }
      }
      const validate = (text: string | undefined): string | undefined => {
        const parsed = jsonObject(text);
        if (!parsed.ok) return parsed.why;
        if (parsed.value.schema !== member.resultSchema.id) return `the result's schema is ${JSON.stringify(parsed.value.schema)}, not ${member.resultSchema.id}`;
        const missing = member.resultSchema.required.filter((field) => !(field in parsed.value));
        return missing.length === 0 ? undefined : `the result lacks ${missing.join(', ')}`;
      };
      const followable = member.budgetShare.maxFollowups > 0 && member.followup !== 'forbidden';
      const repair = followable
        ? `Your reply does not satisfy ${member.resultSchema.id}. Answer with the corrected single JSON object only: schema ${JSON.stringify(member.resultSchema.id)} and the fields ${member.resultSchema.required.join(', ')}.`
        : undefined;
      let got = await this.#result(runId, row, validate, repair, member.role === 'operator' ? execution.id : undefined);
      if (got.kind === 'ok' && member.role === 'operator') got = await this.#closeLeftOpen(runId, team, row, execution, got, followable, validate, repair);
      if (got.kind === 'stopped') return 'stopped';
      if (got.kind === 'execution-failed') {
        // The attempt this member worked for failed (its session did): it can finish nothing now, so it
        // is stopped, and the node's next attempt materializes a fresh Team.
        await this.#delegate(runId, { action: 'cancel', delegationId: row.delegationId, requestId: `ap-cancel-${row.delegationId}`.slice(0, 160) });
        return 'moved';
      }
      if (got.kind !== 'ok') {
        await this.#delegate(runId, { action: 'cancel', delegationId: row.delegationId, requestId: `ap-cancel-${row.delegationId}`.slice(0, 160) });
        // A lost member of a begun execution settles it as a failed attempt (the stranded-Team rule);
        // the branch itself settles refused below either way, as the Pack declared.
        await this.#phase(runId, execution.id, ['failed', 'ready', 'completed', 'uncertain']).catch(() => undefined);
        return refused(`Team ${team.id} member ${member.id}: ${got.why}`);
      }
      if (member.role === 'operator') {
        const phase = await this.#phase(runId, execution.id, ['ready', 'failed', 'completed']);
        if (phase === undefined) return 'stopped';
        if (phase !== 'ready') return 'moved';
      }
      const adopted = await this.#delegate(runId, { action: 'adopt', delegationId: row.delegationId, resultRecordId: got.recordId,
        requestId: `ap-adopt-${row.delegationId}`.slice(0, 160) });
      if (adopted.status !== 'accepted' && adopted.status !== 'duplicate') {
        return refused(`Team ${team.id} member ${member.id}'s schema-valid result could not be adopted: ${String(adopted.reason ?? adopted.status)}`);
      }
    }
    // Every required member adopted; a Team that ran no interactive session is completed by its tool.
    const phase = this.#run(runId)?.control?.executions[execution.id]?.phase;
    if (phase === 'begun') {
      const worked = await this.#act(runId, { action: 'work', executionId: execution.id });
      if (worked.kind === 'refused') return refused(`Team ${team.id}'s execution could not be worked: ${worked.reason ?? ''}`);
    }
    return 'moved';
  }

  /**
   * #64 D-Q1-1: an Operator's schema-valid result arrived while its interactive session is still open (never
   * closed, and no close asked of it). Its result ends its authority over the session, so nobody may close it
   * cleanly, and the session stood until its idle deadline killed it (Q1: 9.9 min, the kept edit lost, the node
   * retried). The Operator is asked once, as a follow-up of its own allowance, to close the session through its
   * tool's declared close command and answer again; the Pack's close command finishes what its session needs.
   * A session still open after that (no follow-up allowed, or the answer came without the close) is closed by
   * the Host at once instead of at its deadline. Answers the result to adopt.
   */
  async #closeLeftOpen(runId: string, team: PackAgentTeam, row: RunDelegationView, execution: NodeExecution,
    got: Extract<ChildResult, { readonly kind: 'ok' }>, followable: boolean,
    validate: (text: string | undefined) => string | undefined, repair: string | undefined): Promise<ChildResult> {
    const open = this.#openSession(runId, execution.id);
    if (open === undefined) return got;
    let latest: ChildResult = got;
    if (followable) {
      const close = this.#closeCommand(runId, team);
      const seq = this.#deps().ledger.record(got.recordId)?.seq ?? 0;
      const sent = await this.#delegate(runId, { action: 'followup', delegationId: row.delegationId,
        text: `Your result arrived while your interactive session ${open} is still open. A session left open is stopped at its idle deadline and its work is lost. `
          + `Close it now: hima_interactive input ${close === undefined ? 'its tool\'s close command' : `${close} (no arguments)`} on session ${open}; that close finishes what the session needs. `
          + 'Then answer with your result again, as one JSON object.',
        requestId: `${`ap-close-${row.delegationId}`.slice(0, 140)}-r${String(seq)}` });
      if (sent.status === 'accepted' || sent.status === 'duplicate') latest = await this.#result(runId, row, validate, repair, execution.id);
      else this.#host.log(`hima autopilot: Run ${runId} could not ask ${row.delegationId} to close session ${open}: ${String(sent.reason ?? sent.status)}`);
    }
    if (this.#openSession(runId, execution.id) !== undefined && this.#host.closeUndrivable !== undefined) {
      this.#host.log(`hima autopilot: Run ${runId}: ${row.delegationId} answered with session ${open} open; the Host closes it now`);
      await this.#host.closeUndrivable(runId).catch((error: unknown) => this.#host.log(`hima autopilot: closing ${open} failed: ${String(error)}`));
    }
    return latest;
  }

  /** The execution's interactive session that is open and was never asked to close (by its tool's close command or a close). */
  #openSession(runId: string, executionId: string): string | undefined {
    const closing = new Set(this.#deps().ledger.records({ runId, type: 'interactive' }).flatMap((record) => {
      const payload = (record.type === 'interactive' ? record.payload : undefined) as { event?: unknown; effect?: unknown; toolSessionId?: unknown } | undefined;
      return payload !== undefined && typeof payload.toolSessionId === 'string'
        && (payload.event === 'close-intent' || payload.event === 'input-intent' && payload.effect === 'close') ? [payload.toolSessionId] : [];
    }));
    return listInteractiveSessions(this.#deps().ledger, runId, executionId)
      .find((session) => (session.status === 'ready' || session.status === 'starting') && !closing.has(session.toolSessionId))?.toolSessionId;
  }

  /** The declared close command of the Team's trigger node tool, when it takes no arguments. */
  #closeCommand(runId: string, team: PackAgentTeam): string | undefined {
    const pack = executionPack(this.#deps(), this.#run(runId)!);
    const node = positionOf(pack, team.triggerNode)?.node;
    const toolId = node?.kind === 'act' ? node.parameters.tool : undefined;
    const interactive = pack.contract.tools.find((tool) => tool.id === toolId)?.interactive;
    return interactive?.commands.close.find((name) => (interactive.arguments[name] ?? []).length === 0);
  }

  /**
   * Wait for one child's next result (after anything already recorded for it), validate it, and give
   * it one repair follow-up when it fails, or when its turn ended without output, and the member
   * allows one. In `native` mode the driver reads the child's completed turn itself; in `ledger` mode
   * it waits for the recorded result.
   */
  async #result(runId: string, row: RunDelegationView, validate: (text: string | undefined) => string | undefined, repair: string | undefined,
    executionId?: string): Promise<ChildResult> {
    const delegationId = row.delegationId;
    const records = (): DelegationRecord[] => this.#deps().ledger.records({ runId, type: 'delegation' })
      .filter((record): record is DelegationRecord => record.type === 'delegation' && record.delegationId === delegationId);
    // A result recorded before this wait began is judged too, unless the driver already followed it up.
    let after = records().filter((record) => record.event === 'followup-intent').at(-1)?.seq ?? 0;
    let repaired = false;
    let asked = 0;
    for (;;) {
      if (this.#host.stopped()) return { kind: 'stopped' };
      const run = this.#run(runId);
      if (!active(run)) return { kind: 'stopped' };
      if (executionId !== undefined && run.control!.executions[executionId]?.phase === 'failed') return { kind: 'execution-failed' };
      const result = records().filter((record) => record.event === 'result-observed' && record.seq > after).at(-1);
      if (result !== undefined) {
        const text = resultText(result);
        const why = validate(text);
        if (why === undefined) return { kind: 'ok', recordId: result.id, text: text! };
        if (repaired || repair === undefined) return { kind: 'invalid', why };
        repaired = true;
        const sent = await this.#delegate(runId, { action: 'followup', delegationId, text: `${repair} (${why})`.slice(0, 7_900),
          requestId: repairId(delegationId, `r${String(result.seq)}`) });
        if (sent.status !== 'accepted' && sent.status !== 'duplicate') return { kind: 'invalid', why: `${why}; its repair follow-up was refused: ${String(sent.reason ?? sent.status)}` };
        after = records().filter((record) => record.event === 'followup-intent').at(-1)?.seq ?? after;
        continue;
      }
      const view = runDelegations(this.#deps(), runId).find((candidate) => candidate.delegationId === delegationId);
      if (view === undefined || ['cancelled', 'expired', 'refused', 'uncertain', 'cancel-requested'].includes(view.state)) {
        return { kind: 'ended', why: `the child ended ${view?.state ?? 'unrecorded'}${view?.reason ? `: ${view.reason}` : ''}` };
      }
      if (this.#host.childResults === 'native' && this.#host.childIdle(view.childSessionId) && Date.now() - asked > this.#host.pollMs * 8) {
        asked = Date.now();
        const read = await this.#delegate(runId, { action: 'result', delegationId, requestId: `ap-result-${delegationId}-${randomUUID().slice(0, 8)}`.slice(0, 160) });
        // The Host's own recipe-schema gate refused a completed turn before recording it; or (#66 H2b)
        // the idle child's turn ended without output, e.g. at max-tokens inside its reasoning, which
        // no amount of waiting turns into a result.
        const why = read.status === 'refused' && typeof read.reason === 'string' && /satisfy|JSON object|refused/.test(read.reason) ? read.reason
          : read.status === 'unavailable' && Array.isArray(read.unknowns) && read.unknowns.some((unknown) => typeof unknown === 'string'
            && /turn ended [\w-]+, not completed|completed native turn has no complete assistant output/.test(unknown))
            ? 'your turn ended without output; reply with the JSON object only' : undefined;
        if (why !== undefined) {
          if (repaired || repair === undefined) return { kind: 'invalid', why };
          repaired = true;
          const sent = await this.#delegate(runId, { action: 'followup', delegationId, text: `${repair} (${why})`.slice(0, 7_900),
            requestId: repairId(delegationId, `idle${String(after)}`) });
          if (sent.status !== 'accepted' && sent.status !== 'duplicate') return { kind: 'invalid', why: `${why}; its repair follow-up was refused: ${String(sent.reason ?? sent.status)}` };
          after = records().filter((record) => record.event === 'followup-intent').at(-1)?.seq ?? after;
          asked = Date.now();
        }
      }
      await sleep(this.#host.pollMs);
    }
  }

  /**
   * A branch Workshop: its retained code when there is some and no revision is due, otherwise the
   * branch child Agent's entry; then the Workshop's work.
   */
  async #workshop(runId: string, pack: Pack, node: Extract<PackNode, { kind: 'act' }>, execution: NodeExecution, branchId: string | undefined,
    fork: (ForkPlan) | undefined): Promise<Turn> {
    const workshop = pack.contract.workshops.find((candidate) => candidate.id === node.parameters.workshop);
    if (workshop === undefined || branchId === undefined || fork === undefined) return 'held';
    const recommended = await this.#act(runId, { action: 'recommend', executionId: execution.id });
    if (recommended.kind === 'refused') return refused(`Workshop ${workshop.id} could not be opened: ${recommended.reason ?? ''}`);
    const revising = this.#revisions(runId, node.id, branchId) > 0 && !this.#entryWrittenSinceRestart(runId, node.id, branchId);
    let entry: string | undefined;
    let author: string | undefined;
    if (!revising) {
      const retained = this.#retainedEntry(runId, node.id, workshop);
      if (retained !== undefined) entry = await this.#host.readMaterial(runId, retained);
    }
    // #64 D-T06-2: a program that failed by its own exit is never run again as it stands. Rewriting the
    // same bytes after the same failure is no revision; its author is asked to repair it instead, with
    // the failure, within the author's follow-up allowance, and an unchanged answer settles the branch.
    const failed = this.#failedProgram(runId, node.id, branchId);
    if (entry !== undefined && failed !== undefined && sha256Of(entry) === failed.sha256) entry = undefined;
    if (entry === undefined) {
      const failure = failed === undefined ? undefined : { attempt: failed.attempt, text: await this.#failureText(runId, failed) };
      const authored = await this.#author(runId, pack, node, workshop, execution, branchId, fork, recommended.data, revising, failure);
      if ('turn' in authored) return authored.turn;
      const again = failed?.failures.get(sha256Of(authored.entry));
      if (again !== undefined) {
        return refused(`Workshop ${workshop.id}'s author answered with the program (sha256 ${sha256Of(authored.entry).slice(0, 12)}) that already failed: ${again}; `
          + 'an identical rewrite after an identical failure is not run again');
      }
      entry = authored.entry; author = authored.childSessionId;
    }
    const wrote = await this.#act(runId, { action: 'write', executionId: execution.id, path: workshop.entry, content: entry,
      ...(author === undefined ? {} : { onBehalfOf: author }) });
    if (wrote.kind === 'refused') return refused(`Workshop ${workshop.id}'s entry could not be written: ${wrote.reason ?? ''}`);
    const worked = await this.#act(runId, { action: 'work', executionId: execution.id });
    if (worked.kind === 'refused') return refused(`Workshop ${workshop.id}'s entry could not be run: ${worked.reason ?? ''}`);
    return 'moved';
  }

  /**
   * The program this node's latest attempt in this branch and generation ran, when that attempt failed
   * by the program's own non-zero exit (the Agent-owned Workshop's `retrying`), with every program of
   * this generation that failed so, by content hash.
   */
  #failedProgram(runId: string, nodeId: string, branchId: string): { readonly sha256: string; readonly attempt: number; readonly session: string;
    readonly reason: string; readonly failures: ReadonlyMap<string, string> } | undefined {
    const generation = this.#run(runId)!.generation ?? 1;
    const records = this.#deps().ledger.records({ runId }).filter((record) => record.generation === generation
      && 'branchId' in record && record.branchId === branchId);
    const failures = new Map<string, string>();
    let last: { sha256: string; attempt: number; session: string; reason: string } | undefined;
    for (const record of records) {
      if (record.type !== 'node' || record.nodeId !== nodeId || !['done', 'retrying', 'blocked', 'cancelled'].includes(record.state)) continue;
      last = undefined;
      if (record.state !== 'retrying' || record.jobSession === undefined) continue;
      const session = record.jobSession;
      const exit = records.findLast((item) => item.type === 'job' && item.event === 'finished' && item.job.session === session);
      const code = records.findLast((item) => item.type === 'code' && item.nodeId === nodeId && item.attempt === record.attempt && item.seq < record.seq);
      // A Workshop's declared output is part of its result. `retrying` after an exit 0 therefore
      // still means the program failed (normally: the output is missing or stale). Treat that exact
      // byte sequence like every other deterministic program failure so it is repaired once rather
      // than re-written until the Run-wide research budget is gone (#64 D-T07-1).
      if (exit?.type !== 'job' || exit.exitCode === undefined || code?.type !== 'code') continue;
      const reason = record.reason ?? `the program exited ${String(exit.exitCode)}`;
      failures.set(code.sha256, reason);
      last = { sha256: code.sha256, attempt: record.attempt, session, reason };
    }
    return last === undefined ? undefined : { ...last, failures };
  }

  /** The failure an author repairs from: the attempt's reason and the tail of the program's own log. */
  async #failureText(runId: string, failed: { readonly session: string; readonly reason: string }): Promise<string> {
    const tail = await jobTail(this.#deps(), { run: runId, session: failed.session, lines: 40 }).then((read) => read.text.trim().slice(-2_400), () => '');
    return `Your previous entry ran and failed: ${failed.reason}.${tail === '' ? '' : `\nThe tail of its log:\n${tail}`}`;
  }

  /** Whether the author was already asked to revise after the branch's latest restart (a drive picked
   *  up after a pause or a restart must not ask twice). */
  #followedUpSinceRestart(runId: string, nodeId: string, branchId: string, delegationId: string): boolean {
    const records = this.#deps().ledger.records({ runId });
    const restart = records.findLast((record) => record.type === 'resumed' && record.kind === 'restart' && record.nodeId === nodeId
      && (record.requestId ?? '').startsWith(`ap-revise-${branchId}-`));
    return restart !== undefined && records.some((record) => record.type === 'delegation' && record.delegationId === delegationId
      && record.event === 'followup-intent' && record.seq > restart.seq);
  }

  /** How many times the driver restarted this branch at this Workshop in this generation. */
  #revisions(runId: string, nodeId: string, branchId: string): number {
    const run = this.#run(runId)!;
    return this.#deps().ledger.records({ runId, type: 'resumed' }).filter((record) => record.type === 'resumed' && record.kind === 'restart'
      && record.writer === 'executor' && record.nodeId === nodeId && record.generation === (run.generation ?? 1)
      && (record.requestId ?? '').startsWith(`ap-revise-${branchId}-`)).length;
  }

  /** Whether this Workshop wrote an entry after the branch's latest autopilot restart. */
  #entryWrittenSinceRestart(runId: string, nodeId: string, branchId: string): boolean {
    const records = this.#deps().ledger.records({ runId });
    const restart = records.findLast((record) => record.type === 'resumed' && record.kind === 'restart' && record.nodeId === nodeId
      && (record.requestId ?? '').startsWith(`ap-revise-${branchId}-`));
    return restart !== undefined && records.some((record) => record.type === 'code' && record.nodeId === nodeId && record.seq > restart.seq);
  }

  /** The latest valid entry this node ran, in any generation: the Workshop's retained code. */
  #retainedEntry(runId: string, nodeId: string, workshop: PackWorkshop): string | undefined {
    return currentRecordsIn(this.#deps().ledger.records({ runId })).findLast((record) => record.type === 'code' && record.nodeId === nodeId
      && record.workshop === workshop.id && record.path.endsWith(`/${workshop.entry}`))?.id;
  }

  /**
   * The branch's own child Agent authors (or revises) the Workshop entry. Its inputs are the
   * Workshop's declared knowledge and reads, taken as Ledger records the way the owner reads them; on
   * a revision its message carries the Reader's itemized problems. It answers one JSON object.
   */
  async #author(runId: string, pack: Pack, node: PackNode, workshop: PackWorkshop, execution: NodeExecution, branchId: string,
    fork: ForkAutopilot, recommended: unknown, revising: boolean, failure?: { readonly attempt: number; readonly text: string }): Promise<{ readonly entry: string; readonly childSessionId: string } | { readonly turn: Turn }> {
    const run = this.#run(runId)!;
    const refs: string[] = [];
    const described: string[] = [];
    // Each read is recorded as a `knowledge` record of this execution; that record is the child's input.
    const recorded = (file: string): string | undefined => this.#deps().ledger.records({ runId, type: 'knowledge' }).findLast((record) =>
      record.type === 'knowledge' && record.nodeId === node.id && record.attempt === execution.attempt && record.file === file)?.id;
    for (const file of workshop.knowledge) {
      await this.#act(runId, { action: 'knowledge', executionId: execution.id, file });
      const id = recorded(file);
      if (id !== undefined && refs.length < 60) { refs.push(id); described.push(`knowledge ${file}: ${id}`); }
    }
    let problems: string | undefined;
    for (const output of workshop.reads) {
      const read = await this.#act(runId, { action: 'read', executionId: execution.id, output });
      const id = recorded(output);
      if (id !== undefined && refs.length < 60) { refs.push(id); described.push(`input ${output}: ${id}`); }
      if (output === workshop.revision?.problems) problems = (read.data as { text?: string } | undefined)?.text;
    }
    // The child's recorded-input reader needs one exact input at least: with none of the Workshop's
    // own recorded, it reads the Run's latest current reading, which is what opened this branch.
    if (refs.length === 0) {
      const latest = currentRecordsIn(this.#deps().ledger.records({ runId })).findLast((record) => record.type === 'observation');
      if (latest !== undefined) { refs.push(latest.id); described.push(`the Run's latest reading: ${latest.id}`); }
    }
    const data = (recommended ?? {}) as { purpose?: string; language?: string; entry?: string; argv?: readonly string[]; directory?: string;
      produces?: { name?: string; path?: string } };
    const delegationId = `autopilot-author-${node.id}-${identityOf({ runId, generation: run.generation, loop: run.loop?.id, branchId }).slice(0, 12)}`;
    const control = run.control!;
    const views = (): RunDelegationView | undefined => runDelegations(this.#deps(), runId).find((row) => row.delegationId === delegationId);
    let row = views();
    const format = `Reply with exactly one JSON object and nothing else: {"schema": "${WORKSHOP_ENTRY_SCHEMA}", "entry": "<the complete ${data.language ?? workshop.language} source of ${workshop.entry}>"}.`;
    const problemsText = problems === undefined ? '' : `\nThe Pack's Reader refused what the previous entry wrote. Its itemized problems:\n${problems.slice(0, 2_400)}`;
    if (row === undefined) {
      const task = [
        `You author the entry program of Workshop ${workshop.id} for fork branch ${branchId} of Run ${runId}, generation ${String(run.generation ?? 1)}. You are the only model in this self-driving branch; nobody reviews your program before it runs.`,
        `Purpose: ${(data.purpose ?? workshop.purpose).slice(0, 3_200)}`,
        `Program: ${data.language ?? workshop.language} file ${workshop.entry}, run once as ${(data.argv ?? workshop.argv).join(' ')} in ${data.directory ?? workshop.directory}. It must write ${data.produces?.name ?? workshop.produces} at ${data.produces?.path ?? '(its declared path)'} before it exits 0, reading its inputs from their files at run time.`,
        described.length === 0 ? 'Recorded inputs: none.' : `Recorded inputs (read with hima_delegation_input): ${described.join('; ')}.`,
        problemsText, failure === undefined ? '' : `${failure.text.slice(0, 2_800)}\nWrite an entry that repairs this failure.`, format,
      ].filter(Boolean).join('\n').slice(0, 7_900);
      const created = await this.#delegate(runId, { action: 'create', requestId: `ap-author-${delegationId}`.slice(0, 160), contract: {
        delegationId, role: 'researcher', task, inputRefs: refs, nodeRef: node.id, allowedTools: ['hima_delegation_input'],
        budgetShare: { maxElapsedMs: fork.author.maxElapsedMs, maxFollowups: fork.author.maxFollowups,
          ...(fork.author.maxTokensPerTurn === undefined ? {} : { maxTokensPerTurn: fork.author.maxTokensPerTurn }) },
        dependencyIds: [], recipient: { kind: 'run-owner', sessionId: control.owner },
      } });
      row = views();
      if (row === undefined) return { turn: refused(`the branch child could not be created for Workshop ${workshop.id}: ${String(created.reason ?? created.status)}`) };
    } else if (failure !== undefined) {
      // One repair follow-up per failed attempt, charged to the author's allowance; a refused one (the
      // allowance is spent) settles the branch below, as a refused revision does.
      const text = `${failure.text}\nRepair ${workshop.entry} so that it exits 0 having written what it must. ${format}`;
      const sent = await this.#delegate(runId, { action: 'followup', delegationId, text: text.slice(0, 7_900),
        requestId: `ap-repair-${delegationId}-${String(failure.attempt)}`.slice(0, 160) });
      if (sent.status !== 'accepted' && sent.status !== 'duplicate') return { turn: refused(`the branch child could not be asked to repair Workshop ${workshop.id} after its program failed (${failure.text.split('\n')[0]!.slice(0, 400)}): ${String(sent.reason ?? sent.status)}`) };
      row = views()!;
    } else if (revising && !this.#followedUpSinceRestart(runId, node.id, branchId, delegationId)) {
      const text = `${problemsText.trim()}\nRevise ${workshop.entry} so that every counted problem is gone. ${format}`;
      const sent = await this.#delegate(runId, { action: 'followup', delegationId, text: text.slice(0, 7_900),
        requestId: `ap-author-${delegationId}-${String(this.#revisions(runId, node.id, branchId))}-${String(execution.attempt)}`.slice(0, 160) });
      if (sent.status !== 'accepted' && sent.status !== 'duplicate') return { turn: refused(`the branch child could not be asked to revise Workshop ${workshop.id}: ${String(sent.reason ?? sent.status)}`) };
      row = views()!;
    }
    const got = await this.#result(runId, row, (text) => {
      const parsed = jsonObject(text);
      if (!parsed.ok) return parsed.why;
      if (parsed.value.schema !== WORKSHOP_ENTRY_SCHEMA) return `the schema is ${JSON.stringify(parsed.value.schema)}, not ${WORKSHOP_ENTRY_SCHEMA}`;
      return typeof parsed.value.entry === 'string' && parsed.value.entry.trim() !== '' ? undefined : 'the entry is not a non-empty string';
    }, `Your reply is not the entry object. ${format}`);
    if (got.kind === 'stopped') return { turn: 'stopped' };
    if (got.kind !== 'ok') {
      await this.#delegate(runId, { action: 'cancel', delegationId, requestId: `ap-cancel-${delegationId}-${String(execution.attempt)}`.slice(0, 160) });
      return { turn: refused(`the branch child did not author Workshop ${workshop.id}: ${got.kind === 'execution-failed' ? 'its execution failed' : got.why}`) };
    }
    const entry = (JSON.parse(got.text.trim()) as { entry: string }).entry;
    return { entry, childSessionId: row.childSessionId };
  }

  /**
   * A branch Reader whose reading refuses what the branch Workshop wrote: restart the branch at that
   * Workshop, up to the fork's declared revisions. Past them the reading stands and the branch goes
   * on with it — its Team node's `batchWhen` decides what a refused request runs.
   */
  async #reviseIfRefused(runId: string, pack: Pack, node: Extract<PackNode, { kind: 'act' }>, execution: NodeExecution, branchId: string,
    fork: ForkPlan): Promise<'restarted' | 'stands' | 'stopped'> {
    const producer = fork.branches.find((branch) => branch.id === branchId)?.nodes
      .map((id) => positionOf(pack, id)?.node).find((candidate): candidate is Extract<PackNode, { kind: 'act' }> => candidate?.kind === 'act'
        && candidate.parameters.workshop !== undefined
        && pack.contract.workshops.find((workshop) => workshop.id === candidate.parameters.workshop)?.produces === node.parameters.observes);
    const workshop = producer === undefined ? undefined : pack.contract.workshops.find((candidate) => candidate.id === producer.parameters.workshop);
    if (producer === undefined || workshop?.revision === undefined) return 'stands';
    const reading = this.#reading(runId, pack, node.parameters.observes!, branchId);
    const count = reading?.values.find((value) => value.type === workshop.revision!.refusedWhen)?.value;
    if (typeof count !== 'number' || count <= 0) return 'stands';
    const done = this.#revisions(runId, producer.id, branchId);
    if (done >= fork.revisions) return 'stands';
    const restarted = await restartBranchAt(this.#deps(), runId, branchId, producer.id, `ap-revise-${branchId}-${String(done + 1)}-${execution.id.slice(-8)}`.slice(0, 160));
    if (!restarted) return this.#host.stopped() ? 'stopped' : 'stands';
    this.#host.log(`hima autopilot: Run ${runId} branch ${branchId}: ${node.id} counted ${String(count)} refusal(s); revising ${producer.id} (${String(done + 1)} of ${String(fork.revisions)})`);
    return 'restarted';
  }
}
