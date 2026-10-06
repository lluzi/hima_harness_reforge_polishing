// Stopping a Run: what a person's cancel does. One reason to change: how a Run is put down.
//
// DBOS owns every current Run (ADR-0018), so a cancel is a durable control command and its physical
// closure is observed by the workflow. Historical Runs are terminal after the cutover gate, so a
// cancel of one answers with its ending and writes nothing.
import { existingRun } from './runs.js';
import { hasEnded, type RunRecord } from './ledger.js';
import type { FabricDeps } from './node-turns.js';
import { knownDurableRun, readDurableExecutionContext, controlDurableRun } from './durable-fabric.js';

export type CancelResult =
  /** The durable cancellation is accepted; physical closure is still independently observed. */
  | { readonly kind: 'stopping'; readonly run: RunRecord; readonly reason: string }
  /** The durable cancellation is accepted and its original resources were observed closed. */
  | { readonly kind: 'cancelled'; readonly run: RunRecord; readonly stopped: undefined }
  /** It had already reached a final state. Its status is the answer, and nothing was written. */
  | { readonly kind: 'ended'; readonly run: RunRecord }
  /** HimaFabric never started this Run, so there is nothing of it to stop. Nothing was written. */
  | { readonly kind: 'not-started'; readonly run: RunRecord };

/**
 * Stop a Run. A durable Run receives one service cancel command for its current epoch and revision;
 * the answer says whether its original resources are already observed closed.
 *
 * @param deps - the ledger, the durable runtime, and where sites and packs are installed.
 * @param runId - the Run to stop.
 * @returns what was stopped, or why nothing was.
 * @throws RunReferenceError when the ledger holds no such Run.
 */
export async function cancelRun(deps: FabricDeps, runId: string, requestedReason: 'cancel' | 'budget' = 'cancel'): Promise<CancelResult> {
  const durable = await knownDurableRun(deps, runId);
  if (durable) {
    const before = await readDurableExecutionContext(deps, runId);
    if (!durable.cancelled && hasEnded(before.run.status)) return { kind: 'ended', run: before.run };
    if (!durable.cancelled) await controlDurableRun(deps, {
      runId, commandId: `service-${requestedReason}:${durable.epoch}:${durable.revision}`,
      action: 'cancel', owner: durable.owner, epoch: durable.epoch, revision: durable.revision,
    });
    const context = await readDurableExecutionContext(deps, runId);
    return context.run.stopState?.closed
      ? { kind: 'cancelled', run: context.run, stopped: undefined }
      : { kind: 'stopping', run: context.run, reason: context.reason ?? 'Cancellation accepted; original resource closure is pending' };
  }
  // Historical Runs are terminal after the DBOS cutover: nothing of theirs is stopped again, and
  // neither answer writes anything.
  const run = existingRun(deps.ledger, runId);
  return run.status === undefined ? { kind: 'not-started', run } : { kind: 'ended', run };
}
