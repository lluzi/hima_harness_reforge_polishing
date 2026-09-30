// @hima-seam agent wrapped
// Fabric's Run lock and Ledger own delegation admissions. Native child state is observed, not copied.
import type { Context } from '@deepseek-ai/cordis';
import { controlling, identityOf, executionContext, executionPack, settleStrandedExecution, type FabricDeps } from './fabric.js';
import { timeBoxRemainingMs, ownedWaitedMs } from './budget.js';
import { runExitFence } from './host-exit.js';
import type { DelegationRecord, RunRecord } from './ledger.js';
import { positionOf } from './packs.js';
import { createDelegation, followupDelegation, cancelDelegation, readDelegationResult, durableDelegationHandoff, parseDelegationResultObservedPayload, reviewedScopeProblem, type DelegationContract, type EffectiveDelegationContract, type DelegationAuthority, type DelegationReservation, type DelegationRuntimePolicy, type DurableDelegationState, type OperatorDelegationGrant } from './delegation.js';
const json = (value: unknown) => JSON.parse(JSON.stringify(value));
type Creation = {
    contract: DelegationContract;
    effective: EffectiveDelegationContract;
    reservation: DelegationReservation;
};
export interface RunDelegationView extends Creation {
    readonly delegationId: string;
    readonly parentSessionId: string;
    readonly childSessionId: string;
    readonly state: DurableDelegationState['state'];
    readonly requestDigest: string;
    readonly initialMessageId?: string;
    readonly reason?: string;
    readonly recordId: string;
    /** Immutable create-intent record containing the admitted task and inputRefs. */
    readonly contractRecordId: string;
    readonly followups: number;
    /** Most recent proven completed-turn receipt; later refinement never rewrites this record. */
    readonly resultRecordId?: string;
    /** Explicit current-owner adoption of that exact observed candidate result. */
    readonly adoptedRecordId?: string;
    /** Native stop/quiescence is separate from why the task ended. */
    readonly stopObserved?: true | 'unknown';
}
function records(deps: FabricDeps, runId: string): DelegationRecord[] { return deps.ledger.records({ runId, type: 'delegation' }).filter((r): r is DelegationRecord => r.type === 'delegation'); }
export function runDelegations(deps: FabricDeps, runId: string): RunDelegationView[] {
    const all = records(deps, runId);
    return all.filter(r => r.event === 'create-intent').map(first => {
        const creation = first.payload as unknown as Creation;
        if (!creation.effective?.childSessionId || !Number.isFinite(Date.parse(creation.reservation?.deadlineAt)))
            throw new Error('retained delegation admission is malformed');
        const history = all.filter(r => r.delegationId === first.delegationId);
        const latestLifecycle = history.filter(r => ['created', 'refused', 'uncertain', 'result-observed', 'result-adopted', 'followup-intent', 'followup-sent'].includes(r.event)).at(-1);
        // Cancellation/deadline are terminal task facts. A later result read may expose already
        // retained candidate output, but cannot rewrite why the task ended into `completed`.
        const terminal = history.filter(r => ['cancel-intent', 'cancel-requested', 'cancelled', 'deadline'].includes(r.event)).at(-1);
        const latest = terminal ?? latestLifecycle;
        const accepted = history.find(r => r.event === 'created');
        const result = history.filter(r => r.event === 'result-observed').at(-1);
        const adopted = result === undefined ? undefined : history.filter(r => r.event === 'result-adopted'
            && (r.payload as { resultRecordId?: unknown }).resultRecordId === result.id).at(-1);
        const state: RunDelegationView['state'] = !latest ? 'intent' : latest.event === 'created' ? 'accepted'
            : latest.event === 'cancelled' ? 'cancelled' : latest.event === 'deadline' ? 'expired'
            : latest.event === 'result-observed' || latest.event === 'result-adopted' ? 'completed'
            : latest.event === 'followup-intent' || latest.event === 'followup-sent' ? 'accepted'
            : latest.event === 'cancel-intent' ? 'cancel-requested'
            : latest.event as RunDelegationView['state'];
        const stopObserved = latest && ['cancel-intent', 'cancel-requested', 'cancelled', 'deadline'].includes(latest.event)
            ? ((latest.event === 'cancelled' || (latest.payload as { stopObserved?: boolean }).stopObserved === true) ? true as const : 'unknown' as const)
            : undefined;
        const data = latest?.payload as {
            reason?: string;
        } | undefined;
        return { ...creation, delegationId: first.delegationId, parentSessionId: first.parentSessionId, childSessionId: creation.effective.childSessionId,
            requestDigest: first.requestDigest, state, initialMessageId: (accepted?.payload as {
                initialMessageId?: string;
            } | undefined)?.initialMessageId,
            reason: data?.reason, recordId: latest?.id ?? first.id, contractRecordId:first.id, followups: history.filter(r => r.event === 'followup-intent').length,
            ...(result === undefined ? {} : { resultRecordId: result.id }),
            ...(adopted === undefined ? {} : { adoptedRecordId: adopted.id }),
            ...(stopObserved === undefined ? {} : { stopObserved }) };
    });
}
// Delegation admission counts what a Run's children can still use, never the sum of everything it ever
// admitted (#64 Task 2b). Two things are protected. Runaway creation: at most `liveDelegationLimit`
// children may be running at once, and at most `lifetimeDelegationLimit` are admitted over the Run's
// life, because a child that ends at once is charged almost no time and a create/cancel loop must still
// stop. Time: each child's share fits what is left of the Run's own time box, so no child outlives its
// Run; and together the children fit the box on each of the Site job lanes the Run was started with
// (`budget.jobCap`). A child holding its reservation (running, or completed with a follow-up still allowed
// before its deadline) is charged its whole share; one that has ended is charged the time it actually
// held. On a one-lane Site whose children have not ended, this is exactly the former sum of shares.
/** At most this many children of one Run may be running at once. */
export const liveDelegationLimit = 32;
/** At most this many children are admitted over one Run's whole life, ended ones included. */
export const lifetimeDelegationLimit = 128;
const deadlineOf = (entry: RunDelegationView) => Date.parse(entry.reservation.deadlineAt);
/** May this child be working now: admitted or reopened, its stop not proven, and inside its own deadline. */
function mayBeRunning(entry: RunDelegationView, now: number): boolean {
    if (now >= deadlineOf(entry)) return false;
    return entry.state === 'intent' || entry.state === 'accepted' || entry.state === 'uncertain'
        || (entry.state === 'cancel-requested' && entry.stopObserved !== true);
}
/** Can this child still spend time: running, or completed with a follow-up still allowed before its deadline. */
function holdsReservation(entry: RunDelegationView, now: number): boolean {
    return mayBeRunning(entry, now) || (entry.state === 'completed' && now < deadlineOf(entry)
        && entry.followups < entry.effective.budgetShare.maxFollowups);
}
/** What one child counts against its Run's delegation time: its whole share while it holds its
 *  reservation, else the time from its admission to the record that ended it (never more than the share). */
/**
 * A completed recipe Operator whose interactive execution is no longer `begun` can never work again:
 * a follow-up would reach a child with no session to operate. Its reservation ends with its result
 * (#66 H2a, ATCS-09 dry path): with a 40-minute member share, a finished Operator held as if still
 * running starved the next generation's Operators of the Run's delegation time.
 */
function settledOperator(run: RunRecord | undefined, entry: RunDelegationView): boolean {
    const executionId = entry.effective.recipe?.executionId;
    return entry.state === 'completed' && entry.effective.role === 'operator' && executionId !== undefined
        && run?.control?.executions[executionId]?.phase !== 'begun';
}
function chargedMs(deps: FabricDeps, entry: RunDelegationView, now: number, run?: RunRecord): number {
    const share = entry.effective.budgetShare.maxElapsedMs;
    if (holdsReservation(entry, now) && !settledOperator(run, entry)) return share;
    const endedBy = entry.state === 'completed' ? entry.resultRecordId
        : entry.state === 'cancelled' || entry.state === 'expired' || entry.state === 'refused'
            || (entry.state === 'cancel-requested' && entry.stopObserved === true) ? entry.recordId : undefined;
    const ended = endedBy === undefined ? undefined : deps.ledger.record(endedBy);
    // Still `accepted`/`uncertain` past its deadline: it may have worked until then.
    if (ended === undefined) return share;
    return Math.min(share, Math.max(0, Date.parse(ended.at) - (deadlineOf(entry) - share)));
}
/** The Site job lanes the Run was started with; a Run without a readable cap keeps the one-lane rule. */
const delegationLanes = (run: RunRecord): number => {
    const cap = run.budget?.jobCap;
    return typeof cap === 'number' && Number.isSafeInteger(cap) && cap > 0 ? cap : 1;
};
/** How many of these children may be running now. */
export function runningDelegations(entries: readonly RunDelegationView[], now = Date.now()): number {
    return entries.filter(entry => mayBeRunning(entry, now)).length;
}
/** The Run's delegation time not yet charged to a child: its time box on each of its job lanes, less every
 *  child's charge. Undefined for a Run with no Budget, which admits no child share. */
export function unreservedDelegationMs(deps: FabricDeps, run: RunRecord, entries: readonly RunDelegationView[] = runDelegations(deps, run.id), now = Date.now()): number | undefined {
    if (!run.budget) return undefined;
    return delegationLanes(run) * run.budget.timeBoxMs - entries.reduce((total, entry) => total + chargedMs(deps, entry, now, run), 0);
}
/** The node execution a delegation belongs to, when it belongs to one. */
interface DelegationTarget { readonly nodeId?: string; readonly executionId?: string }
const targetOf = (effective: { readonly nodeRef?: string; readonly recipe?: { readonly executionId: string };
    readonly operator?: { readonly nodeId: string; readonly executionId: string } }): DelegationTarget => ({
    ...(effective.recipe?.executionId ?? effective.operator?.executionId) === undefined ? {} : { executionId: (effective.recipe?.executionId ?? effective.operator?.executionId)! },
    ...(effective.nodeRef ?? effective.operator?.nodeId) === undefined ? {} : { nodeId: (effective.nodeRef ?? effective.operator?.nodeId)! },
});
/**
 * Whether the Run's holds reach this delegation (#64 review I4). A hold is keyed as the execution
 * authority is: `*` holds every delegation; a node pause holds that node's own execution and every
 * execution in the same fork branch, and never another branch's Team or the join above them. A
 * delegation bound to no node is held only by a Run-wide hold.
 */
function heldFor(run: RunRecord, target: DelegationTarget): boolean {
    const control = run.control;
    if (!control || control.paused.length === 0) return false;
    if (control.paused.includes('*')) return true;
    const execution = target.executionId === undefined ? undefined : control.executions[target.executionId];
    const nodeId = execution?.nodeId ?? target.nodeId;
    if (nodeId !== undefined && control.paused.includes(nodeId)) return true;
    const branchId = execution?.branchId;
    return branchId !== undefined && Object.values(control.executions).some(other => other.branchId === branchId
        && other.supersededBy === undefined && control.paused.includes(other.nodeId));
}
function policy(deps: FabricDeps, run: RunRecord, entry: RunDelegationView, admitCompletedFollowup = false): Pick<DelegationRuntimePolicy, 'toolsAllowed' | 'writesAllowed' | 'reason'> {
    if (run.control?.owner !== entry.parentSessionId || run.control.epoch !== entry.reservation.admittedEpoch)
        return { toolsAllowed: false, writesAllowed: false, reason: 'The parent owner epoch changed.' };
    if (run.status !== 'running' || run.control.stop)
        return { toolsAllowed: false, writesAllowed: false, reason: 'The parent Run is not admitting work.' };
    if (runExitFence(run))
        return { toolsAllowed: false, writesAllowed: false, reason: 'The App is reaching its exit boundary.' };
    if (Date.now() >= Date.parse(entry.reservation.deadlineAt) || (timeBoxRemainingMs(run, ownedWaitedMs(run)) ?? 0) <= 0)
        return { toolsAllowed: false, writesAllowed: false, reason: 'The original task or Run deadline has expired.' };
    if (!['intent', 'accepted'].includes(entry.state) && !(admitCompletedFollowup && entry.state === 'completed'))
        return { toolsAllowed: false, writesAllowed: false, reason: `The delegation is ${entry.state}.` };
    if (heldFor(run, targetOf(entry.effective)))
        return { toolsAllowed: true, writesAllowed: false, reason: 'The parent Run holds this delegation\'s node or branch; read-only observation remains available.' };
    return { toolsAllowed: true, writesAllowed: true };
}
export function delegationRuntimePolicy(deps: FabricDeps, childSessionId: string): DelegationRuntimePolicy | undefined {
    for (const run of deps.ledger.runs())
        for (const entry of runDelegations(deps, run.id))
            if (entry.childSessionId === childSessionId) {
                return { effective: entry.effective, state: entry.state, ...policy(deps, run, entry) };
            }
    return undefined;
}
export interface RunDelegationRequest {
    readonly runId: string;
    readonly actor: string;
    /** `autopilot`: the Host's own driver inside a Pack-declared autopilot region (ADR-0016). */
    readonly origin?: 'agent' | 'human' | 'autopilot';
    readonly action: 'create' | 'followup' | 'cancel' | 'result' | 'adopt';
    readonly expectedEpoch: number;
    readonly expectedRevision: number;
    readonly requestId: string;
    readonly delegationId?: string;
    readonly resultRecordId?: string;
    readonly contract?: unknown;
    readonly recipe?: { readonly teamId: string; readonly version: string; readonly memberId: string; readonly executionId: string };
    readonly text?: string;
}
function authority(deps: FabricDeps, request: RunDelegationRequest): DelegationAuthority {
    const rows = () => records(deps, request.runId);
    const current = () => { const run = deps.ledger.run(request.runId); if (!run?.control)
        throw new Error('This Run has no native owner.'); return run; };
    const authorized = (write = true, target: DelegationTarget = {}) => {
        const run = current();
        const control = run.control!;
        if (control.epoch !== request.expectedEpoch || control.owner !== request.actor && !(request.origin === 'human' && control.guideSessionId === request.actor))
            throw new Error('Delegation owner or epoch is stale.');
        if (write) {
            const why = request.origin !== 'autopilot' && control.revision !== request.expectedRevision ? `its control revision is ${control.revision}, not ${request.expectedRevision}`
                : run.status !== 'running' ? `it is ${run.status}` : control.stop ? 'it has a stop request' : heldFor(run, target) ? 'a hold covers this delegation\'s node or branch'
                : runExitFence(run) ? 'the App is reaching its exit boundary' : executionContext(deps, run.id).budget.phase !== 'active' ? `its budget is ${executionContext(deps, run.id).budget.phase}` : undefined;
            if (why !== undefined) throw new Error(`Re-read the Run: ${why}, which does not permit delegation.`);
        }
        return run;
    };
    const append = async (entry: RunDelegationView | {
        delegationId: string;
        parentSessionId: string;
        childSessionId: string;
    }, event: DelegationRecord['event'], id: string, digest: string, payload: unknown) => deps.ledger.appendDelegation(request.runId, { delegationId: entry.delegationId, parentSessionId: entry.parentSessionId, childSessionId: entry.childSessionId, requestId: id, requestDigest: digest, event, payload: json(payload) });
    const changed = async () => { const run = current(); await deps.ledger.advanceRun(run.id, { control: { ...run.control!, revision: run.control!.revision + 1 } }); };
    const safe = <T>(fn: () => Promise<T>) => controlling(deps, request.runId, fn);
    const lookup = (child: string) => { const found = runDelegations(deps, request.runId).find(r => r.childSessionId === child); if (!found)
        throw new Error('The child has no retained delegation in this Run.'); return found; };
    const failed = (error: unknown) => ({ kind: 'refused' as const, reason: String(error) });
    return {
        admitCreation: input => safe(async () => {
            try {
                const run = authorized(false);
                const prior = runDelegations(deps, run.id).find(r => r.delegationId === input.contract.delegationId);
                if (prior)
                    return { kind: 'duplicate', durable: { requestDigest: prior.requestDigest, state: prior.state, childSessionId: prior.state === 'intent' ? undefined : prior.childSessionId, effective: prior.effective, initialMessageId: prior.initialMessageId, reason: prior.reason } };
                authorized(true, targetOf({ ...input.proposed, ...(input.contract.nodeRef === undefined ? {} : { nodeRef: input.contract.nodeRef }) }));
                if (input.contract.parentSessionId !== run.control!.owner || input.contract.runRef?.runId !== run.id || input.contract.recipient.sessionId !== run.control!.owner)
                    throw new Error('Delegation contract is not bound to this actual owner and Run.');
                if (rows().some(r => r.requestId === request.requestId))
                    throw new Error('Request identity already belongs to a different delegation.');
                for (const ref of input.contract.inputRefs) {
                    const record = deps.ledger.record(ref);
                    if (!record || record.runId !== run.id)
                        throw new Error('Input references must name retained facts in this Run.');
                }
                const existing = runDelegations(deps, run.id);
                if (input.proposed.role === 'operator' && input.proposed.operator !== undefined) {
                    const collision = existing.find(entry => entry.effective.role === 'operator'
                        && entry.effective.operator?.runId === input.proposed.operator!.runId
                        && entry.effective.operator.nodeId === input.proposed.operator!.nodeId
                        && entry.effective.operator.executionId === input.proposed.operator!.executionId
                        && entry.delegationId !== input.contract.delegationId);
                    if (collision) throw new Error(`Operator execution already belongs to delegation ${collision.delegationId}; reuse that child.`);
                }
                const now = Date.now();
                if (existing.length >= lifetimeDelegationLimit)
                    throw new Error(`This Run has exhausted its ${lifetimeDelegationLimit}-delegation admission limit; reuse an authorized continuable child.`);
                if (runningDelegations(existing, now) >= liveDelegationLimit)
                    throw new Error(`This Run already has ${liveDelegationLimit} children that may be running; wait for one to end, cancel one, or reuse an authorized continuable child.`);
                for (const id of input.contract.dependencyIds) {
                    const dep = existing.find(e => e.delegationId === id);
                    if (!dep || !rows().some(r => r.delegationId === id && r.event === 'result-observed'))
                        throw new Error('A required child result has not been observed.');
                }
                const share = input.proposed.budgetShare.maxElapsedMs;
                const remaining = timeBoxRemainingMs(run, ownedWaitedMs(run)) ?? 0;
                const unreserved = unreservedDelegationMs(deps, run, existing, now) ?? 0;
                if (!run.budget || share > remaining || share > unreserved)
                    throw new Error(`Child shares exceed the original remaining/total Run time budget: this share is ${share} ms; ${remaining} ms of the Run's time box remain and ${Math.max(0, unreserved)} ms of its delegation time (the time box on each of ${delegationLanes(run)} Site job lanes) are unreserved.`);
                const reservation: DelegationReservation = { reservationId: `delegation:${run.id}:${input.contract.delegationId}`, deadlineAt: new Date(Date.now() + share).toISOString(), admittedEpoch: run.control!.epoch, admittedRevision: run.control!.revision };
                await append({ delegationId: input.contract.delegationId, parentSessionId: input.contract.parentSessionId, childSessionId: input.proposed.childSessionId }, 'create-intent', request.requestId, input.requestDigest, { contract: input.contract, effective: input.proposed, reservation });
                await changed();
                return { kind: 'reserved', reservation };
            }
            catch (error) {
                return failed(error);
            }
        }),
        recordCreation: input => safe(async () => { const entry = lookup(input.effective.childSessionId); await append(entry, input.outcome === 'accepted' ? 'created' : input.outcome, request.requestId, input.requestDigest, input); }),
        admitFollowup: input => safe(async () => {
            try {
                authorized(false);
                const entry = lookup(input.childSessionId);
                const prior = rows().find(r => r.requestId === input.requestId);
                if (prior) {
                    if (prior.requestDigest !== input.requestDigest)
                        throw new Error('Follow-up id changed contents.');
                    const sent = rows().find(r => r.requestId === input.requestId && r.event === 'followup-sent');
                    return { kind: 'duplicate', messageId: (sent?.payload as {
                            messageId?: string;
                        } | undefined)?.messageId, uncertain: !sent };
                }
                const run = authorized(true, targetOf(entry.effective));
                // A proven result closes tool authority, but the same continuable child may take
                // one explicitly admitted refinement. Only this locked admission ignores the
                // completed state; every other owner/epoch/deadline/hold/budget fence remains.
                const currentPolicy = policy(deps, run, entry, true);
                if (!currentPolicy.writesAllowed)
                    throw new Error(currentPolicy.reason);
                if (entry.followups >= entry.effective.budgetShare.maxFollowups)
                    throw new Error('The child follow-up allowance is exhausted.');
                // Reopening a completed child makes it run again, so it takes a running place like a new child.
                if (entry.state === 'completed' && runningDelegations(runDelegations(deps, run.id)) >= liveDelegationLimit)
                    throw new Error(`This Run already has ${liveDelegationLimit} children that may be running; wait for one to end or cancel one before reopening this child.`);
                const row = await append(entry, 'followup-intent', input.requestId, input.requestDigest, { actor: request.actor });
                await changed();
                return { kind: 'reserved', reservationId: row.id };
            }
            catch (error) {
                return failed(error);
            }
        }),
        recordFollowup: input => safe(async () => { await append(lookup(input.childSessionId), input.outcome === 'accepted' ? 'followup-sent' : 'uncertain', input.requestId, input.requestDigest, input); }),
        admitCancel: input => safe(async () => { try {
            authorized(false);
            const entry = lookup(input.childSessionId);
            const prior = rows().find(r => r.requestId === input.requestId);
            if (prior) {
                if (prior.requestDigest !== input.requestDigest)
                    throw new Error('Cancel id changed contents.');
                return { kind: 'duplicate', effect: rows().some(r => r.requestId === input.requestId && r.event === 'cancelled') ? 'confirmed' : 'unknown' };
            }
            if(!['intent','accepted','uncertain','cancel-requested'].includes(entry.state))throw new Error(`The task already ended as ${entry.state}; a fresh cancellation cannot rewrite that outcome.`);
            const row = await append(entry, 'cancel-intent', input.requestId, input.requestDigest, { actor: request.actor });
            return { kind: 'reserved', reservationId: row.id };
        }
        catch (error) {
            return failed(error);
        } }),
        recordCancel: input => safe(async () => { await append(lookup(input.childSessionId), input.effect === 'confirmed' ? 'cancelled' : 'cancel-requested', input.requestId, input.requestDigest, input); }),
    };
}
export async function operateRunDelegation(ctx: Context, deps: FabricDeps, request: RunDelegationRequest, signal: AbortSignal,
    options: { readonly operatorGrant?: OperatorDelegationGrant } = {}): Promise<object> {
    const run = deps.ledger.run(request.runId);
    if (!run?.control)
        throw new Error('An existing controlled Run is required.');
    if (run.control.owner !== request.actor && !(request.origin === 'human' && run.control.guideSessionId === request.actor))
        return { status: 'refused', reason: 'Only the recorded owner or its human Guide may control this delegation.' };
    if (request.expectedEpoch !== run.control.epoch)
        return { status: 'refused', reason: 'Delegation owner epoch is stale.' };
    const auth = authority(deps, request);
    if (request.action === 'create') {
        if (!request.contract || typeof request.contract !== 'object')
            throw new Error('A typed delegation contract is required.');
        const contract = { ...request.contract, parentSessionId: run.control.owner, runRef: { runId: run.id, expectedEpoch: request.expectedEpoch, expectedRevision: request.expectedRevision }, status: 'requested' } as DelegationContract;
        return createDelegation(ctx, contract, auth, signal, options.operatorGrant);
    }
    const found = runDelegations(deps, run.id).find(r => r.delegationId === request.delegationId);
    if (!found)
        throw new Error('Delegation not found.');
    if (request.action === 'adopt')
        return controlling(deps, run.id, async () => {
            const latest = deps.ledger.run(run.id);
            if (!latest?.control || latest.control.owner !== request.actor || latest.control.epoch !== request.expectedEpoch)
                return { status: 'refused', artifacts: [], unknowns: [], reason: 'Delegation owner or epoch is stale.' };
            const requestDigest = identityOf({ runId: run.id, action: 'adopt', delegationId: found.delegationId,
                actor: request.actor, expectedEpoch: request.expectedEpoch, resultRecordId: request.resultRecordId });
            const all = records(deps, run.id);
            const prior = all.find(row => row.requestId === request.requestId);
            if (prior) return prior.requestDigest === requestDigest && prior.event === 'result-adopted'
                ? { status: 'duplicate', artifacts: [], unknowns: [], adoptedRecordId: prior.id }
                : { status: 'refused', artifacts: [], unknowns: [], reason: 'Adoption request identity already names different intent.' };
            if ((request.origin !== 'autopilot' && latest.control.revision !== request.expectedRevision) || latest.status !== 'running' || latest.control.stop || heldFor(latest, targetOf(found.effective))
                || runExitFence(latest) || executionContext(deps, latest.id).budget.phase !== 'active')
                return { status: 'refused', artifacts: [], unknowns: [], reason: 'Re-read the active unheld Run before adopting a child result.' };
            const result = all.filter(row => row.delegationId === found.delegationId && row.event === 'result-observed').at(-1);
            if (!result) return { status: 'refused', artifacts: [], unknowns: [], reason: 'Only an exact observed child result can be adopted.' };
            if (found.effective.recipe?.memberId === 'operator'
                && latest.control.executions[found.effective.recipe.executionId]?.phase !== 'ready') {
                return { status: 'refused', artifacts: [], unknowns: [], reason: 'An Operator result cannot be adopted before its exact interactive execution is finalized and ready.' };
            }
            if (found.effective.recipe && request.resultRecordId === undefined)
                return { status: 'refused', artifacts: [], unknowns: [], reason: 'Pack Agent Team adoption must name the exact observed result record.' };
            if (request.resultRecordId !== undefined && request.resultRecordId !== result.id)
                return { status: 'refused', artifacts: [], unknowns: [], reason: 'The requested result record is not this delegation latest exact candidate.' };
            const adopted = await deps.ledger.appendDelegation(run.id, { delegationId: found.delegationId,
                parentSessionId: found.parentSessionId, childSessionId: found.childSessionId,
                requestId: request.requestId, requestDigest, event: 'result-adopted',
                payload: json({ resultRecordId: result.id, recipient: found.effective.recipient, candidateOnly: false,
                    ...(found.effective.recipe === undefined ? {} : { recipe: found.effective.recipe }) }) });
            await deps.ledger.advanceRun(run.id, { control: { ...latest.control, revision: latest.control.revision + 1 } });
            return { status: 'accepted', artifacts: [], unknowns: [], adoptedRecordId: adopted.id,
                resultRecordId: result.id, recipient: found.effective.recipient };
        });
    if (request.action === 'followup')
        return followupDelegation(ctx, { parentSessionId: found.parentSessionId, childSessionId: found.childSessionId, requestId: request.requestId, message: request.text ?? '' }, auth, signal);
    if (request.action === 'cancel')
        return cancelDelegation(ctx, { parentSessionId: found.parentSessionId, childSessionId: found.childSessionId, requestId: request.requestId }, auth);
    const priorResultRequest = records(deps, run.id).find(row => row.requestId === request.requestId);
    if (priorResultRequest) return priorResultRequest.delegationId === found.delegationId && priorResultRequest.event === 'result-observed'
        ? { status: 'duplicate', artifacts: [], unknowns: [], resultRecordId: priorResultRequest.id }
        : { status: 'refused', artifacts: [], unknowns: [], reason: 'Result request identity already names different intent.' };
    const result = await readDelegationResult(ctx, { effective: found.effective, requestDigest: found.requestDigest });
    if (result.status === 'candidate' && found.effective.recipe) {
        const text = result.output?.filter((block): block is Extract<(typeof result.output)[number],{type:'text'}> => block.type === 'text')
            .map(block => block.text).join('\n') ?? '';
        let payload: Record<string, unknown>;
        try { payload = JSON.parse(text) as Record<string, unknown>; }
        catch (error) {
            const left = found.effective.budgetShare.maxFollowups - found.followups;
            return { status: 'refused', artifacts: [], unknowns: [], reason: `Agent Team member ${found.effective.recipe.memberId} must return one JSON object: ${(error as Error).message}. `
                + (left > 0 ? `${left} follow-up(s) to the same child remain.` : 'No follow-up remains; cancelling this delegation ends it without a result.') };
        }
        if (!payload || Array.isArray(payload) || payload.schema !== found.effective.recipe.resultSchema.id
            || found.effective.recipe.resultSchema.required.some(field => !(field in payload))) {
            return { status: 'refused', artifacts: [], unknowns: [], reason: `Agent Team result does not satisfy ${found.effective.recipe.resultSchema.id}.` };
        }
        // A Reviewer feeding a scope Operator is gated here, before result-observed, so a bad scope
        // leaves the child accepted: it can be followed up, or cancelled so the execution settles.
        const reviewOutput = found.effective.recipe.reviewOutput;
        const scopeProblem = reviewOutput?.mode === 'scope'
            ? reviewedScopeProblem(payload[reviewOutput.scopeField], reviewOutput) : undefined;
        if (scopeProblem !== undefined) {
            const left = found.effective.budgetShare.maxFollowups - found.followups;
            return { status: 'refused', artifacts: [], unknowns: [], reason: `Agent Team member ${found.effective.recipe.memberId} result is refused: ${scopeProblem}. `
                + (left > 0 ? `${left} follow-up(s) to the same child remain.` : 'No follow-up remains; cancelling this delegation ends it without a result.') };
        }
    }
    let candidateHandoff: ReturnType<typeof durableDelegationHandoff> | undefined;
    if (result.status === 'candidate') {
        candidateHandoff = durableDelegationHandoff(result, { recordId:found.contractRecordId, requestDigest:found.requestDigest });
        const previous = records(deps, run.id).filter(row => row.delegationId === found.delegationId && row.event === 'result-observed').at(-1);
        if (previous) {
            let prior: ReturnType<typeof parseDelegationResultObservedPayload>;
            try { prior = parseDelegationResultObservedPayload(previous.payload); }
            catch { return { status: 'refused', artifacts: [], unknowns: [], reason: 'The prior delegated result handoff is malformed.' }; }
            if (prior.handoff.outputIdentity === candidateHandoff.outputIdentity
                && JSON.stringify(prior.handoff.completedTurn) === JSON.stringify(candidateHandoff.completedTurn)) {
                return { status: 'unavailable', childSessionId: found.childSessionId, artifacts: [], unknowns: ['The delegated child has no newer completed turn after its prior observed result.'] };
            }
        }
    }
    if (result.status === 'candidate' && found.state === 'accepted')
        await controlling(deps, run.id, async () => {
            const latest = deps.ledger.run(run.id);
            if (!latest?.control || latest.control.owner !== found.parentSessionId || latest.control.epoch !== request.expectedEpoch
                || (request.origin !== 'autopilot' && latest.control.revision !== request.expectedRevision)) throw new Error('Re-read the Run before recording this child result.');
            if (!records(deps, run.id).some(r => r.requestId === request.requestId)) {
                const handoff = candidateHandoff!;
                await deps.ledger.appendDelegation(run.id, { delegationId: found.delegationId, parentSessionId: found.parentSessionId,
                    childSessionId: found.childSessionId, event: 'result-observed', requestId: request.requestId,
                    requestDigest: identityOf({ child: found.childSessionId, outputIdentity:handoff.outputIdentity, completedTurn: handoff.completedTurn, evidence: handoff.evidence }),
                    payload: json({ candidate: true, source: result.source, handoff }) });
                const observed = deps.ledger.run(run.id)!;
                await deps.ledger.advanceRun(run.id, { control: { ...observed.control!, revision: observed.control!.revision + 1 } });
            }
        });
    return result;
}

/**
 * A Pack Agent Team execution finishes only through its Team Operator, which needs every role it
 * transitively depends on. Team identities are fixed per execution, so once each such Team has lost
 * one of those members without an observed result, nothing in this execution can produce it. Settle
 * the execution as a failed attempt; the next begin gets fresh Team identities. This holds whatever
 * the tool's mode: a hybrid tool's batch path may be a Pack's no-op for executions that run no Team,
 * never a way to finish one whose Team is stranded. An execution with no lost
 * Team delegation is never touched here. Caller holds the Run's admission queue. Returns whether any
 * execution settled.
 */
export async function settleStrandedTeamExecutions(deps: FabricDeps, runId: string): Promise<boolean> {
    const run = deps.ledger.run(runId);
    if (!run?.control || run.status !== 'running') return false;
    const lost = runDelegations(deps, runId).filter(row => row.effective.recipe !== undefined && row.resultRecordId === undefined
        && ['cancel-requested', 'cancelled', 'expired', 'refused', 'uncertain'].includes(row.state)
        && run.control!.executions[row.effective.recipe.executionId]?.phase === 'begun');
    if (lost.length === 0) return false;
    const pack = executionPack(deps, run);
    let settled = false;
    for (const executionId of new Set(lost.map(row => row.effective.recipe!.executionId))) {
        const nodeId = run.control.executions[executionId]!.nodeId;
        const node = positionOf(pack, nodeId)?.node;
        if (node?.kind !== 'act' || node.parameters.tool === undefined) continue;
        const teams = pack.contract.agentTeams.flatMap(team => {
            const operator = team.members.find(item => item.role === 'operator' && item.node === nodeId);
            if (team.triggerNode !== nodeId || operator === undefined) return [];
            const required = new Set<string>();
            const visit = (id: string): void => { if (required.has(id)) return; required.add(id);
                for (const dependency of team.members.find(item => item.id === id)?.dependencyRoles ?? []) visit(dependency); };
            visit(operator.id);
            return [lost.find(row => row.effective.recipe!.executionId === executionId && row.effective.recipe!.teamId === team.id
                && row.effective.recipe!.version === team.version && required.has(row.effective.recipe!.memberId))];
        });
        if (teams.length === 0 || teams.some(row => row === undefined)) continue;
        const stranding = teams[0]!; const recipe = stranding.effective.recipe!;
        settled = await settleStrandedExecution(deps, runId, executionId, `Agent Team ${recipe.teamId} member ${recipe.memberId} delegation ${stranding.delegationId}`
            + ` ended ${stranding.state} without an observed result${stranding.reason ? ` (${stranding.reason})` : ''};`
            + ' its fixed Team identity cannot finish this execution, so it settles as a failed attempt') || settled;
    }
    return settled;
}

/** Resolve the retained authority that lets exactly one Operator child use the qualified tool. */
export function operatorInteractiveAuthority(deps: FabricDeps, childSessionId: string, target: {
    readonly runId: string; readonly nodeId: string; readonly executionId: string;
}): { readonly authorityOwner: string; readonly expectedBindingDigest: string;
    readonly reviewedAction?: NonNullable<EffectiveDelegationContract['recipe']>['inlinePayload'] } | undefined {
    const run = deps.ledger.run(target.runId);
    const entry = runDelegations(deps, target.runId).find(row => row.childSessionId === childSessionId);
    const policy = delegationRuntimePolicy(deps, childSessionId);
    const grant = entry?.effective.operator;
    if (!run?.control || !entry || !policy?.toolsAllowed || !['intent', 'accepted'].includes(entry.state)
        || entry.effective.role !== 'operator' || !entry.effective.tools.includes('hima_interactive')
        || entry.effective.runRef?.runId !== target.runId || grant === undefined
        || grant.runId !== target.runId || grant.nodeId !== target.nodeId || grant.executionId !== target.executionId
        || grant.mutation !== 'qualified') return undefined;
    return { authorityOwner: run.control.owner, expectedBindingDigest: grant.bindingDigest,
        ...(entry.effective.recipe?.inlinePayload === undefined ? {} : { reviewedAction: entry.effective.recipe.inlinePayload }) };
}
