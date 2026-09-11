// Fork and join: how several act nodes of one Run run at the same moment, and how the Run waits for
// all of them (#29, D29). One reason to change: how a fork is opened, driven and closed.
//
// CONTEXT.md says fork and join are "edge patterns, not node kinds: edges branch out so nodes run in
// parallel, and converge back into a Judge node. The Site's parallel job cap decides how many
// actually run at once." This is that opening, that driving and that closing, and nothing else: a
// branch's node turns are exactly the turns every other node takes (`node-turns.ts`), the Site's cap
// is exactly the cap every other launch is held to (`job-cap.ts`), and the join is exactly a judge
// node — one that judges each branch's own reading rather than the Run's latest.
//
// **A fork's position is one field of the run row and nothing in any process.** `fork` says which
// node branched, which judge node the branches converge into, and where each branch stands;
// `currentNode` says the join, because that is where the Run is going and the one place it can be
// said to be while several of its nodes are running. A host that picks the Run up rebuilds every
// branch from that field and the records, which is why a restart in the middle of a fork carries on
// in both branches rather than launching either a second time.
//
// The one thing this module does that nothing else in the harness does: it awaits several things at
// once. Everything it awaits writes through the ledger's per-Run chain (`advanceRun`), and a branch
// states only its own entry under `fork.branches`, so two branches moving in the same instant can
// neither lose one another's state nor read one another's half-written row. Nothing here holds run
// state between awaits: every turn re-reads the row, exactly as `drive` does.
import { forkFrom, positionOf, type Fork, type PackNode, type RunGraph } from './packs.js';
import type { RunBranch, RunFork } from './ledger.js';
import { existingRun } from './runs.js';
import { attemptOf, attemptOfSession } from './budget.js';
import { openJobsOfRun } from './job-cap.js';
import {
  appendNode,
  observeNode,
  progress,
  stillDriving,
  toolNode,
  waitForJob,
  type Driving,
  type Step,
} from './node-turns.js';

/**
 * Open the fork this node draws, when it draws one: record where every branch starts, and move the
 * Run to the join.
 *
 * **One write**, carrying the whole fork and the join together, for the reason a revisit edge is one
 * write (D43): a host that died between "the Run stands at the join" and "these are the branches it
 * is waiting for" would leave a Run standing at a judge node with nothing on the way to it, which
 * reads exactly like a Run whose branches all finished and is the one thing a later host must not
 * conclude.
 *
 * The fork's shape is the graph's (`forkFrom` in `packs.ts`), which is the same reading the pack was
 * refused against when it was loaded — so what a person is told about their file is what the engine
 * would have run. A pack that has changed under a Run since is said to be the pack's fault, as every
 * other such change is.
 *
 * @param ctx - the drive carrying this Run.
 * @param graph - the graph this node belongs to.
 * @param node - the node that has just settled, which may draw a fork.
 * @returns undefined when this node draws no fork; `moved` once the Run is inside one; `blocked` for
 *          a pack whose fork can no longer be made sense of; `stopped` when another face ended the
 *          Run while the fork was being opened.
 */
export async function openForkAt(ctx: Driving, graph: RunGraph, node: PackNode): Promise<Step | undefined> {
  const fork: Fork | undefined = forkFrom(graph, node);
  if (fork === undefined) return undefined;
  if (!fork.ok) {
    // Held when the pack is loaded, so reaching this is a pack that changed under a Run.
    await appendNode(ctx, node, 'blocked', attemptOf(ctx.deps.ledger, ctx.runId, node.id), {
      reason: `node ${node.id} forks, and pack ${ctx.pack.id}@${ctx.pack.contract.version} now ${fork.why}`,
    });
    return { kind: 'blocked' };
  }
  if (!stillDriving(ctx)) return { kind: 'stopped' };
  const branches: Record<string, RunBranch> = {};
  for (const branch of fork.branches) branches[branch.id] = { currentNode: branch.id, state: 'running' };
  await progress(ctx, {}, { fork: { from: fork.from, join: fork.join, branches }, currentNode: fork.join });
  return { kind: 'moved' };
}

/**
 * Drive every branch of the open fork, all at once, and say what the Run does next.
 *
 * The branches are driven concurrently and every one of them is waited for, whatever the others come
 * to: a branch that failed must not leave another branch's Job running on the Site with nothing
 * watching it, which is what a `Promise.all` that rejected on the first failure would do. So every
 * branch settles first, and only then is the fault raised — into `drive`'s own fault boundary, which
 * is where a Run stopping in the middle of a turn is recorded.
 *
 * How many of them are really running at once is the Site's answer and not this function's: each
 * branch's launch goes through the same claim step every launch goes through, so a Site declaring
 * one job slot runs them one after the other with a `waiting-for-slot` record on whichever is
 * queued, and a Site declaring two runs both (D25, D33).
 *
 * What the fork comes to:
 * - every branch `done` — the fork closes in one write and the Run stands at the join with nothing
 *   on the way to it. The join itself is judged by the next turn, as an ordinary judge node that
 *   happens to be a join, which is what keeps a host that died in between from judging it as
 *   anything else;
 * - a branch `blocked` and the rest settled — the Run waits for a person. The fork stays open on the
 *   row exactly as it stands, because that is what a resume re-enters: the blocked branch's node,
 *   with a fresh allowance, and the branches that finished still finished;
 * - a spent Budget in any branch — the Run ends, as it would have at any other node;
 * - another face's ending — nothing is written at all.
 *
 * @param ctx - the drive carrying this Run.
 * @param fork - the fork as the row has it.
 * @returns what the driver does next.
 */
export async function runFork(ctx: Driving, fork: RunFork): Promise<Step> {
  const settled = await Promise.allSettled(
    Object.entries(fork.branches).map(([id, branch]) => driveBranch(ctx, id, branch)),
  );
  const failed = settled.find((s): s is PromiseRejectedResult => s.status === 'rejected');
  if (failed) throw failed.reason as Error;
  const ends = settled.flatMap((s) => (s.status === 'fulfilled' ? [s.value] : []));
  if (ends.includes('stopped')) return { kind: 'stopped' };
  if (ends.includes('budget-exhausted')) return { kind: 'budget-exhausted' };
  if (ends.includes('blocked')) {
    // Settled, and one of them needs a person. The fork is left open on the row: it is the whole of
    // what a resume re-enters, and a Run that forgot which branches had finished would run them all
    // again.
    return { kind: 'blocked' };
  }
  return closeFork(ctx);
}

/** What one branch of a fork came to. `stopped` is another face's ending, and writes nothing. */
type BranchEnd = 'done' | 'blocked' | 'budget-exhausted' | 'stopped';

/**
 * Drive one branch from where it stands to the join: its chain of act nodes, one turn each, exactly
 * the turns any other act node takes.
 *
 * Everything a turn writes carries this branch's id (`Driving.branchId`), because two branches
 * append in the same instant and the order they land in says nothing about which of them wrote what.
 * The branch's own state is one write per move, stating only this branch's entry, so a branch that
 * moves while another is launching cannot put that other one back where it was.
 *
 * A Job of the node this branch stands at that nothing has settled is **picked up and waited for**
 * rather than launched again — the same rule the reconciliation follows (`launchIsOpen`), asked here
 * so that a host that took a fork over re-enters every branch by simply driving it, and so that a
 * Run picked up in the middle of two syntheses pays for neither of them twice.
 *
 * @param ctx - the drive carrying this Run.
 * @param branchId - this branch, which is the id of its first node.
 * @param from - where the row says this branch stands.
 * @returns what this branch came to.
 */
async function driveBranch(ctx: Driving, branchId: string, from: RunBranch): Promise<BranchEnd> {
  // Where a branch stands is what says whether it is this drive's to run, and two of the four words
  // say it is not. A branch that has already reached the join is `done` and never run again — this is
  // what a resume re-entering one blocked branch leaves the others as. A branch that is still
  // `blocked` is a person's to clear and nobody else's: **one resume clears one blocker**, so a Run
  // with two blocked branches goes on in the branch whose blocker was cleared and waits again for the
  // other, rather than re-entering it with an allowance nobody granted (#29, `resumeRun`).
  if (from.state === 'done') return 'done';
  if (from.state === 'blocked') return 'blocked';
  const branch: Driving = { ...ctx, branchId };
  const fork = (): RunFork | undefined => existingRun(ctx.deps.ledger, ctx.runId).fork;
  let nodeId = from.currentNode;
  for (;;) {
    if (!stillDriving(ctx)) return 'stopped';
    const at = positionOf(ctx.pack, nodeId);
    if (at === undefined || at.node.kind !== 'act') {
      // Held when the pack is loaded — a branch is act nodes only — so reaching this is a pack that
      // changed under a Run, said as the pack's fault rather than run as something it is not.
      if (at !== undefined) {
        await appendNode(branch, at.node, 'blocked', attemptOf(ctx.deps.ledger, ctx.runId, nodeId), {
          reason: `branch ${branchId} stands at node ${nodeId}, which is a ${at.node.kind} node: a branch of a fork is act nodes only`,
        });
      }
      if (stillDriving(ctx)) await progress(branch, {}, { branch: { id: branchId, currentNode: nodeId, state: 'blocked' } });
      return 'blocked';
    }
    const node = at.node;
    // A Job of this node that nothing has settled: asking the Site takes a round trip, so the row is
    // read again after it and before this branch's own move is written — every write of a fork is
    // behind that one question, because a cancel can land in any window a Site round trip opens.
    const open = (await openJobsOfRun(ctx.deps, existingRun(ctx.deps.ledger, ctx.runId), nodeId))[0];
    if (!stillDriving(ctx)) return 'stopped';
    await progress(branch, {}, { branch: { id: branchId, currentNode: nodeId, state: 'running' } });
    // A Job picked up belongs to the attempt the interrupted turn opened, never a new one; a turn
    // this branch is taking itself opens the next.
    const attempt = open === undefined
      ? attemptOf(ctx.deps.ledger, ctx.runId, nodeId)
      : attemptOfSession(ctx.deps.ledger, ctx.runId, nodeId, open.job.session);
    const step = open === undefined
      ? node.parameters.tool === undefined
        ? await observeNode(branch, node, attempt)
        : await toolNode(branch, existingRun(ctx.deps.ledger, ctx.runId), node, attempt)
      : await waitForJob(branch, node, attempt, open.job.session);
    if (step.kind === 'stopped') return 'stopped';
    if (step.kind === 'budget-exhausted') return 'budget-exhausted';
    if (step.kind === 'retrying') continue;
    if (step.kind === 'blocked' || step.kind === 'hard-blocker') {
      // A branch that spends its allowance blocks itself and nothing else: the other branches go on,
      // and the Run waits only once every one of them has settled. Which is why this writes the
      // branch's own state and never the Run's status, and why nothing is routed to the pack's wait
      // node — the Run stands at the join, with a fork still open on it.
      if (stillDriving(ctx)) await progress(branch, {}, { branch: { id: branchId, currentNode: nodeId, state: 'blocked' } });
      return 'blocked';
    }
    const on = at.graph.edges.find((e) => e.from === nodeId)?.to;
    const join = fork()?.join;
    if (on === undefined || join === undefined) {
      // A branch with nowhere to go is refused when the pack is loaded, and a fork that closed under
      // this branch is another face's doing; either way this branch has nothing further to do.
      if (stillDriving(ctx) && join !== undefined) await progress(branch, {}, { branch: { id: branchId, currentNode: nodeId, state: 'blocked' } });
      return join === undefined ? 'stopped' : 'blocked';
    }
    if (on === join) {
      if (!stillDriving(ctx)) return 'stopped';
      await progress(branch, {}, { branch: { id: branchId, currentNode: join, state: 'done' } });
      return 'done';
    }
    nodeId = on;
  }
}

/**
 * Close the fork the Run is inside: **one write**, and the Run stands at the join with nothing on
 * the way to it.
 *
 * Nothing is written on a Run another face has ended, for the reason nothing is when a drill-down
 * Loop closes: a fork's branches are all settled by the time this is reached, so this is a moment
 * with no Job to wait on and therefore one a cancel can land inside, and a fork cleared off a Run
 * somebody stopped would say the Run had got past something it never did.
 *
 * The join is deliberately **not** judged here. It is judged by the next turn of the driver, as the
 * judge node it is — one that judges each branch's own reading because the graph says branches
 * converge into it (`forkJoinedAt`), and not because anything about the run row still says a fork
 * was open. So a host that died in this one-write window judges the join exactly as this one would
 * have.
 *
 * The question is asked twice, and the second asking is the one that counts: `stillDriving` reads
 * the row as it now stands, but the write itself is queued on the Run's chain, and a cancel queued
 * ahead of it would be written first — so the write states `onlyWhileRunning` and the ledger asks
 * again against the very row it is about to store (`RunProgress.onlyWhileRunning`). The first ask
 * stays because it is what lets this answer `stopped` rather than `moved`: the driver must not take
 * another turn on a Run somebody has ended, whatever the row ends up holding.
 *
 * @returns `moved` once the fork is closed; `stopped` when another face had already ended the Run.
 */
async function closeFork(ctx: Driving): Promise<Step> {
  if (!stillDriving(ctx)) return { kind: 'stopped' };
  await progress(ctx, {}, { fork: null, onlyWhileRunning: true });
  return stillDriving(ctx) ? { kind: 'moved' } : { kind: 'stopped' };
}
