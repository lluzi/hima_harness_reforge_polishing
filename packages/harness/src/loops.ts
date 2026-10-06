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
import { type PackNode } from './packs.js';

/** An Explore node that opens a Loop rather than applying a chooser. `validatePack` holds that an
 *  Explore node is exactly one of the two, so this type is what the other kind is not. */
export type OpeningExplore = Extract<PackNode, { kind: 'explore' }> & { readonly parameters: { readonly opens: string } };

/** Is this the one kind of turn that drills down? Narrowed here so the driver asks in one place. */
export const opensALoop = (node: PackNode): node is OpeningExplore =>
  node.kind === 'explore' && node.parameters.opens !== undefined;

