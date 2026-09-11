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
import type { DecisionChoice, JobIdentity, JobRecord, NodeKind, NodeRecord, NodeState, ObservationRecord, ReaderRef, RunStrategy, VerdictRecord } from './ledger.js';
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
