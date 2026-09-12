// How one ledger record is read: the folds more than one reader makes of one. One reason to change:
// what a reader sees of a record.
//
// Mostly a face — the card's two mounts and the run view they are composed from — but not only: the
// three arms of a decision are told apart here too, because HimaFabric acts on the same three and a
// second reading of them would be the engine and the card disagreeing about what was decided.
//
// These were `remote.ts`'s until a Run's generations grew branches (#29). A branch row carries its
// own nodes, its own Jobs and its own reading, and that fold lives in `generations.ts` — which
// `remote.ts` imports, so it cannot import `remote.ts` back for the three functions that turn a
// record into what a face shows of it. Two copies of "an absent key, never an undefined one" is the
// one thing this harness does not do, so the three moved here, where both read them.
//
// Nothing here reaches a filesystem, a Site or a storage domain, and nothing it imports does: the
// browser bundle carries it through `generations.ts`, so a runtime import of the ledger's own module
// here would pull `node:crypto` and `node:fs` into the client build. The ledger's *types* are
// imported, and types are erased.
import type { CodeRecord, DecisionChoice, JobIdentity, JobRecord, LedgerRecord, NodeKind, NodeRecord, NodeState, ObservationRecord, ReaderRef, RunStrategy, SessionRecord, VerdictRecord } from './ledger.js';
import type { SemanticValue } from './semantics.js';

/** One observation as HimaGuide shows it: what was read, from where, by which reader, when. */
export interface ObservationView {
  readonly recordId: string;
  readonly at: string;
  readonly path: string;
  readonly contentSha256: string;
  readonly bytes: number;
  readonly reader: ReaderRef;
  readonly values: readonly SemanticValue[];
  /** The branch of a fork this reading was taken inside (#29); absent on a Run's own readings. */
  readonly branchId?: string;
}

/**
 * One fabric node as HimaGuide shows it: the state it is in now, and how it got there. One entry per
 * node the Run touched, never one per transition — the transitions are the `node` records, read
 * through the records route by anyone who wants the whole path.
 */
export interface NodeView {
  readonly recordId: string;
  readonly at: string;
  readonly nodeId: string;
  readonly kind: NodeKind;
  readonly state: NodeState;
  readonly attempt: number;
  readonly outcome?: VerdictRecord['outcome'];
  readonly jobSession?: string;
  /** Why the node is in the state it is in, in words. Every `blocked` the fabric writes carries one. */
  readonly reason?: string;
  /** The branch of a fork this transition was written inside (#29); absent outside every fork. */
  readonly branchId?: string;
  /**
   * True when this node ever waited for a Job slot on the Site. A fact about the node's whole path
   * rather than about its latest transition, and carried here for the same reason `blockers` carries
   * a blocker that has since been cleared: `state` is where the node stands *now*, so by the time a
   * Run has finished, the node that queued behind a full Site says `done` and the wait is visible
   * only through the records route. Absent on a node that never waited.
   */
  readonly waitedForSlot?: true;
}

/** One Job event as HimaGuide shows it: what happened to which Job, at which node, and — on the
 *  launch, which is where a Job takes them — what it holds of the Site's licences. */
export interface JobView {
  readonly recordId: string;
  readonly at: string;
  readonly event: JobRecord['event'];
  readonly job: JobIdentity;
  readonly exitCode?: number;
  readonly nodeId?: string;
  /** The branch of a fork this Job was launched inside (#29); absent outside every fork. */
  readonly branchId?: string;
  /** The seats of each licence this Job holds while it runs. Absent on a Job that holds none, and on
   *  every event but the launch. */
  readonly licences?: Readonly<Record<string, number>>;
}

/** An absent key, never an undefined one: a reading taken outside every fork says so by omission. */
export function observationView(record: ObservationRecord): ObservationView {
  const head = {
    recordId: record.id,
    at: record.at,
    path: record.path,
    contentSha256: record.contentSha256,
    bytes: record.bytes,
    reader: record.reader,
    values: record.values,
  };
  return record.branchId === undefined ? head : { ...head, branchId: record.branchId };
}

/** An absent key, never an undefined one: a node with no outcome, no Job, no reason or no branch
 *  says so by omission. */
export function nodeView(record: NodeRecord): NodeView {
  const head = { recordId: record.id, at: record.at, nodeId: record.nodeId, kind: record.kind, state: record.state, attempt: record.attempt };
  const withOutcome = record.outcome === undefined ? head : { ...head, outcome: record.outcome };
  const withSession = record.jobSession === undefined ? withOutcome : { ...withOutcome, jobSession: record.jobSession };
  const withBranch = record.branchId === undefined ? withSession : { ...withSession, branchId: record.branchId };
  return record.reason === undefined ? withBranch : { ...withBranch, reason: record.reason };
}

/** An absent key, never an undefined one: a Job with no exit, no node, no branch or no licence says
 *  so by omission. */
export function jobView(record: JobRecord): JobView {
  const head = { recordId: record.id, at: record.at, event: record.event, job: record.job };
  const withExit = record.exitCode === undefined ? head : { ...head, exitCode: record.exitCode };
  const withNode = record.nodeId === undefined ? withExit : { ...withExit, nodeId: record.nodeId };
  const withBranch = record.branchId === undefined ? withNode : { ...withNode, branchId: record.branchId };
  return record.licences === undefined ? withBranch : { ...withBranch, licences: record.licences };
}

/**
 * One file a Model moment wrote, as HimaGuide shows it (#62): where it is on the Site, what it hashes
 * to, how big it is, what language the pack says it is in, and which node, attempt and session wrote
 * it.
 *
 * The record's own fields and nothing folded: what a person reads of a generated file is exactly what
 * the ledger holds about it, and the file itself is on the Site where a person and the Job both read
 * it.
 */
export interface CodeView {
  readonly recordId: string;
  readonly at: string;
  readonly nodeId: string;
  readonly attempt: number;
  readonly sessionId: string;
  readonly workshop: string;
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly language: string;
  /** The branch of a fork it was written inside (#29); absent outside every fork. */
  readonly branchId?: string;
}

/** An absent key, never an undefined one: a file written outside every fork says so by omission. */
export function codeView(record: CodeRecord): CodeView {
  const head = {
    recordId: record.id,
    at: record.at,
    nodeId: record.nodeId,
    attempt: record.attempt,
    sessionId: record.sessionId,
    workshop: record.workshop,
    path: record.path,
    sha256: record.sha256,
    bytes: record.bytes,
    language: record.language,
  };
  return record.branchId === undefined ? head : { ...head, branchId: record.branchId };
}

/**
 * Where a workshop node stands, in one word (#62).
 *
 * Eight, and every one of them a different thing for a person to do about it: `writing` is a model
 * session that is still open, `written` is a moment that closed with the entry on record and no Job
 * yet, `no-entry` is a moment that closed having written something other than the entry — so there is
 * nothing for the fabric to run and the attempt is about to be settled as failed — `running` is the
 * Job, `done` is the node settled, `failed` is an attempt that failed with the allowance still
 * standing, `blocked` is one that failed without it — the one a person has to clear — and
 * `interrupted` is a host that went away mid-moment, which is the one state nothing is currently
 * doing anything about.
 */
export type WorkshopState = 'writing' | 'written' | 'no-entry' | 'running' | 'done' | 'failed' | 'blocked' | 'interrupted';

/** One workshop node as HimaGuide shows it: which workshop, where it stands, and what it wrote. */
export interface WorkshopView {
  readonly nodeId: string;
  readonly workshop: string;
  readonly attempt: number;
  readonly state: WorkshopState;
  /** The session of this attempt's moment, once there is one. */
  readonly sessionId?: string;
  /**
   * How many **files** this attempt wrote: distinct paths, never records.
   *
   * A `code` record is one version of one file, and a moment that writes its entry, thinks again and
   * writes it over leaves two records and one file (#62). Counting records would tell a person their
   * workshop wrote two scripts when it wrote one twice — and the second number is also the one the
   * card's own list is of, one row per file at the version that is there.
   */
  readonly files: number;
  /** The one file of them the fabric runs, as the declaration names it. */
  readonly entry: string;
}

/** The records one workshop view is derived from: everything this Run holds of that node, already
 *  narrowed to the Generation and the drill-down Loop the Run is in. */
export interface WorkshopRecords {
  readonly sessions: readonly SessionRecord[];
  readonly code: readonly CodeRecord[];
  readonly nodes: readonly NodeRecord[];
  readonly jobs: readonly JobRecord[];
}

/**
 * **Where one workshop node stands**, derived in one place from the records of its current attempt.
 *
 * One function and not a chain of tests in each face, for the reason `chosenAs` is one: the card, the
 * run view route and `/hima status` all say where a workshop stands, and three readings of the same
 * four record kinds would be three answers to one question. The order below is the order the states
 * actually happen in, read backwards — the latest node transition first, because it is the only thing
 * that knows whether the *node* failed or blocked, and then the Job, then the moment.
 *
 * @param nodeId - the node this view is about.
 * @param workshop - the workshop it opens, as the `opened` record of its moment names it.
 * @param entry - the file of that workshop the fabric runs, from that same record.
 * @param entryPath - that file's own absolute path on the Site, from that same record: what a `code`
 *                    record's path is held against to say whether the entry itself was written.
 * @param attempt - the attempt this view is about: the node's current one.
 * @param records - that Run's records, already narrowed to this node and to this Generation.
 */
export function workshopView(
  nodeId: string,
  workshop: string,
  entry: string,
  entryPath: string,
  attempt: number,
  records: WorkshopRecords,
): WorkshopView {
  const ofAttempt = <R extends { readonly attempt: number }>(list: readonly R[]): R[] => list.filter((r) => r.attempt === attempt);
  const sessions = ofAttempt(records.sessions);
  const code = ofAttempt(records.code);
  const nodes = ofAttempt(records.nodes);
  const opened = sessions.find((r) => r.event === 'opened');
  const closed = sessions.findLast((r) => r.event === 'closed');
  const latest = nodes.at(-1);
  // This attempt's own launch, found **by where it falls in the Run's sequence** and not through the
  // node record that names its session. The two are written one after the other — the `launched` job
  // record first, the `running` node record carrying the session second — so matching on the session
  // would read `written` for as long as the gap between them lasts, which is a card saying the model
  // is done and the job has not started while the job is running. Anything this node launched after
  // this attempt opened is this attempt's, and a retry's own first node record is what separates it
  // from the attempt before. The records are the Generation's own, so a revisited node's attempt 1
  // in the generation after cannot pick up the launch of attempt 1 in the generation before.
  const openedAt = nodes[0]?.seq ?? 0;
  const launched = records.jobs.findLast((j) => j.event === 'launched' && j.nodeId === nodeId && j.seq > openedAt);
  const ended = launched === undefined ? undefined : records.jobs.find((j) => j.event !== 'launched' && j.job.session === launched.job.session);
  // The entry on record, for *this* moment: **the same fact the turn itself launches on**, which is a
  // `code` record of this session at exactly the path the entry is at. A moment that closed having
  // written only a helper has nothing to run, and saying `written` of it would name a state whose
  // whole meaning is "the model is done and the job is a moment away".
  //
  // The whole path, because that is the question: the turn asks for a `code` record whose `path`
  // equals `<the resolved workshop root>/<entry>`, and anything weaker answers differently from the
  // turn. A last-segment test says `written` of a moment that wrote only `sub/miner.sh`, which the
  // turn then settles as a failed attempt — a card claiming the model is done about an attempt that
  // is already over. The path comes off the `opened` record, put there by the turn that computed it.
  const wroteEntry = opened !== undefined && code.some((c) => c.sessionId === opened.sessionId && c.path === entryPath);
  const state = ((): WorkshopState => {
    // The node's own latest transition first: `blocked` and `retrying` are the two things only it
    // knows, and both are true whatever the moment and the Job did.
    if (latest?.state === 'blocked') return 'blocked';
    if (latest?.state === 'retrying') return 'failed';
    if (latest?.state === 'done') return 'done';
    if (closed?.outcome === 'interrupted') return 'interrupted';
    if (closed?.outcome === 'failed') return 'failed';
    if (opened === undefined) return 'writing';
    if (closed === undefined) return 'writing';
    if (launched === undefined) return wroteEntry ? 'written' : 'no-entry';
    if (ended === undefined) return 'running';
    // The Job is over and the node has not said what that came to yet — another gap of two writes.
    // What the exit code says is what this reads, so a failed Job is never shown as a node that is
    // done for as long as that gap lasts; the node's own record refines it to `failed` or `blocked`
    // the moment it lands.
    return ended.exitCode === 0 ? 'done' : 'failed';
  })();
  const head = { nodeId, workshop, attempt, state, files: new Set(code.map((c) => c.path)).size, entry };
  const sessionId = opened?.sessionId ?? closed?.sessionId;
  return sessionId === undefined ? head : { ...head, sessionId };
}

/** The one thing this fold needs of a Run's row: where it stands, and which Generation and Loop its
 *  records belong to. Named rather than taken as `RunRecord` because that type lives in the module
 *  this one may not import at runtime, and these three fields are the whole of what is read. */
export interface WorkshopRun {
  readonly currentNode?: string;
  readonly generation?: number;
  readonly loop?: { readonly id: string; readonly generation: number };
}

/**
 * **This Run's workshop, composed from the ledger alone** (#62) — or undefined for a Run that has
 * reached none.
 *
 * Which node opens a workshop, which workshop it is and which file of it runs are read off the
 * `opened` session records, which carry all three since #62. That is what makes this fold
 * synchronous and total: the pack folder is not opened, so a Campaign whose pack has since been
 * uninstalled, renamed or edited into something that will not load still says on its card what its
 * workshop wrote and how it went — and a pack that will not load no longer silently erases the
 * workshop from the card altogether.
 *
 * **The workshop node the Run last stood at**, which is the current node while it is standing there
 * and the one before it as soon as it is not. That is not a convenience: a workshop node leaves a Run
 * standing somewhere else in every ending it has — at the node after it when the Job exits 0, at the
 * pack's own Wait node when the Retry allowance runs out — and what a person came to the card for is
 * what was written and how it went.
 *
 * **Narrowed to the Generation and the drill-down Loop the Run is in**, exactly as every other count
 * over a node in this harness is (`nodeRecordsOfGeneration`, `nextMomentAttempt`): attempts restart
 * at one each Generation, so a Loop that revisits its workshop would otherwise fold the previous
 * Generation's sessions, files and Jobs into this one's attempt 1.
 *
 * @param run - the Run's row: where it stands, and which Generation and Loop it is in.
 * @param records - every record of that Run, in sequence.
 * @returns the view, or undefined for a Run no moment of a workshop has opened on.
 */
export function standingWorkshop(run: WorkshopRun, records: readonly LedgerRecord[]): WorkshopView | undefined {
  const generation = run.loop?.generation ?? run.generation;
  const here = records.filter((r) => r.generation === generation && r.loopId === run.loop?.id);
  // Which node is a workshop node, and what it opens: the `opened` records of this Generation say so,
  // and the latest of them per node wins — a pack edited between two Generations is a pack whose
  // later moment carries the later declaration.
  const declared = new Map<string, { readonly workshop: string; readonly entry: string; readonly entryPath: string }>();
  for (const record of here) {
    if (record.type !== 'session' || record.event !== 'opened' || record.workshop === undefined) continue;
    declared.set(record.nodeId, { workshop: record.workshop.id, entry: record.workshop.entry, entryPath: record.workshop.entryPath });
  }
  if (declared.size === 0) return undefined;
  const standing = run.currentNode !== undefined && declared.has(run.currentNode)
    ? run.currentNode
    : here.findLast((r): r is NodeRecord => r.type === 'node' && declared.has(r.nodeId))?.nodeId;
  if (standing === undefined) return undefined;
  const open = declared.get(standing)!;
  const nodes = here.filter((r): r is NodeRecord => r.type === 'node' && r.nodeId === standing);
  return workshopView(standing, open.workshop, open.entry, open.entryPath, nodes.at(-1)?.attempt ?? 1, {
    sessions: here.filter((r): r is SessionRecord => r.type === 'session' && r.nodeId === standing),
    code: here.filter((r): r is CodeRecord => r.type === 'code' && r.nodeId === standing),
    nodes,
    jobs: here.filter((r): r is JobRecord => r.type === 'job'),
  });
}

/**
 * What a `cancel` carries of the Jobs one request stopped, whether it is the ledger's record or a
 * face's view of it: the two are the same two fields, and this is what makes one fold serve both.
 */
export interface CancelSessions {
  readonly jobSession?: string;
  readonly jobSessions?: readonly string[];
}

/**
 * **Every Job one cancel stopped**, in the order it stopped them: the one reading of a cancel's
 * sessions, so the loop that asks whether *its* Job was stopped (`cancelStopped`, `ledger.ts`), the
 * command that says what a person's request came to, and the card's two mounts cannot come to two
 * answers about one request.
 *
 * `jobSessions` where the record carries it, and otherwise `jobSession` alone — a record written
 * before the list existed named one Job because that is all a cancel could stop then, so reading it
 * as a list of one is reading it exactly as it was written. Empty for a request that found nothing
 * open, which is a real answer and not a missing one.
 *
 * Here rather than beside the record it reads, because `card-labels.ts` needs it and is in the
 * browser bundle: a runtime import of the ledger's own module there would pull `node:crypto` and
 * `node:fs` into the client build. This module is the one both sides already import.
 */
export const cancelSessions = (cancel: CancelSessions): readonly string[] =>
  cancel.jobSessions ?? (cancel.jobSession === undefined ? [] : [cancel.jobSession]);

/**
 * **Which of the three things an Explore node can decide this decision was**, as the one word every
 * reader keys on: the card's colour and its state attribute, the words both mounts say it in, and
 * the ending HimaFabric writes when it acts on it.
 */
export type ChosenKind = 'goal-met' | 'converged' | 'next-strategy';

/** What an Explore node decided when it decided the exploration had stopped learning. */
export type ConvergedChoice = Extract<DecisionChoice, { converged: unknown }>['converged'];

/**
 * That decision as a kind and its payload: the one place the three arms of `DecisionChoice` are told
 * apart.
 *
 * The ledger writes the choice as three differently-shaped objects, which is the right shape on
 * disk — a next Strategy carries the knobs, a convergence carries the whole rule, and goal met
 * carries nothing — and the wrong shape to branch on, because every reader then writes the same
 * chain of `in` tests. Seven of them had grown by the end of step 3b, in the engine and in both
 * mounts of the card (the final review, J4), so a fourth arm would have been four files to find.
 * Here it is read once, and every reader switches on `kind` — exhaustively, because a kind the union
 * gains is a switch that stops compiling rather than an arm that silently falls to the last `else`.
 */
export type Chosen =
  | { readonly kind: 'goal-met' }
  | { readonly kind: 'converged'; readonly converged: ConvergedChoice }
  | { readonly kind: 'next-strategy'; readonly strategy: RunStrategy };

/**
 * Read one decision's choice.
 *
 * @param decision - the decision record, or any face's view of one: both carry `chosen` and nothing
 *                   else is read here.
 */
export function chosenAs(decision: { readonly chosen: DecisionChoice }): Chosen {
  if ('goalMet' in decision.chosen) return { kind: 'goal-met' };
  if ('converged' in decision.chosen) return { kind: 'converged', converged: decision.chosen.converged };
  return { kind: 'next-strategy', strategy: decision.chosen.strategy };
}

/** Which kind of choice this was, for a reader that wants the word and not the payload. */
export const chosenKind = (decision: { readonly chosen: DecisionChoice }): ChosenKind => chosenAs(decision).kind;
