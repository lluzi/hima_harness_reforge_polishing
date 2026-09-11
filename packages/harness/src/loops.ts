// Drill-down: how a nested Loop is entered and left (#28). One reason to change.
//
// CONTEXT.md says an Explore node "opens a Loop with its own convergence condition, drillable into
// its own small graph". This is that opening and that closing, and nothing else: what a Run does
// once it is inside a Loop is the same driver running the same node kinds over a different graph,
// because a Loop *is* a graph — the whole point of declaring it as data beside the pack's own.
//
// A Loop's position is two fields of the run row and nothing in any process: `loop` says which Loop
// is open, which Explore node opened it, and which Generation of it the Run is in, and `currentNode`
// says which of that Loop's nodes it stands at. A host that picks the Run up rebuilds both by
// reading the row, exactly as it rebuilds everything else, so a restart in the middle of a nested
// Loop carries on inside it.
//
// Both moves are written the way every other move a person or the fabric makes is written here: the
// record first, then the row. The `loop` record is the authority for what happened — a Loop that
// opened, a Loop that closed with an outcome and a count of Generations — and the row follows it. A
// host that died between the two leaves a Run standing where it was with the bracket already on
// record; the reconciliation that finds such a Run has no Job of its current node open, so it hands
// it to a person rather than opening or closing anything a second time.
import { randomUUID } from 'node:crypto';
import { positionOf, type PackLoop, type PackNode } from './packs.js';
import type { LoopOutcome, RunLoop, RunStrategy } from './ledger.js';
import { currentAttemptOf, defaultGenerationLimit } from './budget.js';
import { appendNode, progress, stillDriving, type Driving, type Step } from './node-turns.js';

/** An Explore node that opens a Loop rather than applying a chooser. `validatePack` holds that an
 *  Explore node is exactly one of the two, so this type is what the other kind is not. */
export type OpeningExplore = Extract<PackNode, { kind: 'explore' }> & { readonly parameters: { readonly opens: string } };

/** Is this the one kind of turn that drills down? Narrowed here so the driver asks in one place. */
export const opensALoop = (node: PackNode): node is OpeningExplore =>
  node.kind === 'explore' && node.parameters.opens !== undefined;

/**
 * Open the Loop this Explore node names: record that it opened, and move the Run into it.
 *
 * The Explore node's own `running` record has already been written by the turn that got here, and it
 * stays running for as long as the Loop does — which is the truth of it: the node's turn is not over
 * until the Loop it opened has closed, and `done` is written then.
 *
 * The Loop's id is minted here, once, and both the row and every record written inside the Loop
 * carry it. Minted rather than derived so that an outer graph which opens the same Loop again in a
 * later Generation opens a *different* Loop, with its own generations and its own records, rather
 * than adding to the one before it.
 *
 * @param ctx - the drive carrying this Run.
 * @param node - the Explore node whose `opens:` this is.
 * @param attempt - the attempt this node's turn is on.
 * @returns `moved` once the Run is inside the Loop; `blocked` for a pack that no longer declares it.
 */
export async function openLoop(ctx: Driving, node: OpeningExplore, attempt: number): Promise<Step> {
  const name = node.parameters.opens;
  const loop: PackLoop | undefined = ctx.pack.graph.loops[name];
  if (loop === undefined) {
    // Held when the pack is loaded, so reaching this is a pack that changed under a Run: said as
    // the pack's fault rather than run as an empty graph.
    await appendNode(ctx, node, 'blocked', attempt, { reason: `node ${node.id} opens loop "${name}", which pack ${ctx.pack.id}@${ctx.pack.contract.version} no longer declares` });
    return { kind: 'blocked' };
  }
  const opened: RunLoop = { id: `loop-${randomUUID()}`, nodeId: node.id, name, generation: 1 };
  await ctx.deps.ledger.appendLoop(ctx.runId, { loopId: opened.id, nodeId: node.id, name, event: 'opened' });
  await progress(ctx, {}, { loop: opened, currentNode: loop.entry });
  return { kind: 'moved' };
}

/**
 * Open the next Generation of the Loop the Run is in: one write of the run row carrying the Loop's
 * new generation, the act node the revisit edge leads to, and the Strategy the decision chose,
 * together — for the reason the outer Loop's revisit is one write (D43), so that no host can die
 * between two of the three and leave a Run running the last generation's Strategy under this one's
 * number.
 *
 * Held against the row first, as the close below is and for the same reason: a Run another face
 * ended while this Explore node was deciding must not be moved into a Generation it will never run.
 */
export async function revisitInLoop(ctx: Driving, loop: RunLoop, to: string, strategy: { readonly strategy?: RunStrategy }): Promise<Step> {
  if (!stillDriving(ctx)) return { kind: 'stopped' };
  await progress(ctx, {}, { currentNode: to, loop: { ...loop, generation: loop.generation + 1 }, ...strategy });
  return { kind: 'moved' };
}

/**
 * Close the Loop the Run is in, with the outcome it came to: record that it closed and how many
 * Generations it took, and put the Run back on the Explore node that opened it, outside every Loop.
 *
 * The `closed` record is written while the row still says the Loop is open, so the ledger reads as
 * the Run ran: it carries that Loop's id and its last Generation, and it is the Loop's own last
 * word, the closing bracket of the block of records the `opened` one began.
 *
 * Where the Run goes next is the driver's — the outer edge that outcome labels, or an ending — and
 * this leaves it standing on the Explore node in the meantime, which is where a person reading a Run
 * that ended here should find it.
 *
 * **Nothing is written on a Run that is no longer running**, and that is the invariant this whole
 * ticket rests on: a cancel inside a Loop ends the Run and leaves that Loop open on record. The
 * Explore node's turn has no Job to wait on, so it is the one turn a cancel can land inside — after
 * `drive` read the row and before this writes — and a `closed` record landing there would say a
 * Loop reached an ending on a Run that had already been stopped. So the row is read again here,
 * immediately before the two writes, and a Run somebody else has ended is left exactly as they left
 * it: the Loop open, the Run standing where it stopped, and this drive answering `stopped`.
 *
 * @returns `moved` once the Run is standing back on its Explore node outside the Loop; `stopped`
 *          when another face ended the Run inside the window and nothing was written.
 */
export async function closeLoop(ctx: Driving, loop: RunLoop, outcome: LoopOutcome): Promise<Step> {
  if (!stillDriving(ctx)) return { kind: 'stopped' };
  await ctx.deps.ledger.appendLoop(ctx.runId, {
    loopId: loop.id,
    nodeId: loop.nodeId,
    name: loop.name,
    event: 'closed',
    outcome,
    generations: loop.generation,
  });
  await progress(ctx, {}, { loop: null, currentNode: loop.nodeId });
  // The Explore node's turn is over now, and only now: it was `running` for as long as its Loop was.
  // Written after the row has left the Loop, so the record is the outer graph's, under the attempt
  // the turn opened with.
  const node = positionOf(ctx.pack, loop.nodeId)?.node;
  if (node) await appendNode(ctx, node, 'done', currentAttemptOf(ctx.deps.ledger, ctx.runId, node.id));
  return { kind: 'moved' };
}

/**
 * How many Generations this Loop may open, as the Explore node about to decide declares it.
 *
 * Read off the deciding node rather than off the pack, because a Loop's limit bounds that Loop and
 * that decision: a Loop is a sub-question, and what the pack allows one sub-question is not what a
 * Campaign's Budget allows the whole Run. A node that declares no `converge` at all falls to the
 * harness default, so a nested Loop is bounded by something whatever the pack forgot.
 */
export const loopGenerationLimit = (node: Extract<PackNode, { kind: 'explore' }>): number =>
  node.parameters.converge?.generationLimit ?? defaultGenerationLimit;
