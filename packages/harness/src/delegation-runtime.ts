// @hima-seam agent wrapped
// Fabric's Run lock and Ledger own delegation admissions. Native child state is observed, not copied.
import type { Context } from '@deepseek-ai/cordis';
import { controlling, identityOf, executionContext, type FabricDeps } from './fabric.js';
import { timeBoxRemainingMs, ownedWaitedMs } from './budget.js';
import { runExitFence } from './host-exit.js';
import type { DelegationRecord, RunRecord } from './ledger.js';
import { createDelegation, followupDelegation, cancelDelegation, readDelegationResult, durableDelegationHandoff, type DelegationContract, type EffectiveDelegationContract, type DelegationAuthority, type DelegationReservation, type DelegationRuntimePolicy, type DurableDelegationState, type OperatorDelegationGrant } from './delegation.js';
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
        const adopted = history.filter(r => r.event === 'result-adopted').at(-1);
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
    if (run.control.paused.length)
        return { toolsAllowed: true, writesAllowed: false, reason: 'The parent Run is paused; read-only observation remains available.' };
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
    readonly origin?: 'agent' | 'human';
    readonly action: 'create' | 'followup' | 'cancel' | 'result' | 'adopt';
    readonly expectedEpoch: number;
    readonly expectedRevision: number;
    readonly requestId: string;
    readonly delegationId?: string;
    readonly contract?: unknown;
    readonly text?: string;
}
function authority(deps: FabricDeps, request: RunDelegationRequest): DelegationAuthority {
    const rows = () => records(deps, request.runId);
    const current = () => { const run = deps.ledger.run(request.runId); if (!run?.control)
        throw new Error('This Run has no native owner.'); return run; };
    const authorized = (write = true) => {
        const run = current();
        const control = run.control!;
        if (control.epoch !== request.expectedEpoch || control.owner !== request.actor && !(request.origin === 'human' && control.guideSessionId === request.actor))
            throw new Error('Delegation owner or epoch is stale.');
        if (write && (control.revision !== request.expectedRevision || run.status !== 'running' || control.stop || control.paused.length || runExitFence(run) || executionContext(deps, run.id).budget.phase !== 'active'))
            throw new Error('Re-read the Run: its revision, hold, exit fence or budget does not permit delegation.');
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
                authorized();
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
                if (existing.length >= 32)
                    throw new Error('This Run has exhausted its 32-delegation admission limit; reuse an authorized continuable child.');
                for (const id of input.contract.dependencyIds) {
                    const dep = existing.find(e => e.delegationId === id);
                    if (!dep || !rows().some(r => r.delegationId === id && r.event === 'result-observed'))
                        throw new Error('A required child result has not been observed.');
                }
                const allocated = existing.reduce((n, e) => n + e.effective.budgetShare.maxElapsedMs, 0);
                const share = input.proposed.budgetShare.maxElapsedMs;
                if (!run.budget || share > (timeBoxRemainingMs(run, ownedWaitedMs(run)) ?? 0) || allocated + share > run.budget.timeBoxMs)
                    throw new Error('Child shares exceed the original remaining/total Run time budget.');
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
                const run = authorized();
                // A proven result closes tool authority, but the same continuable child may take
                // one explicitly admitted refinement. Only this locked admission ignores the
                // completed state; every other owner/epoch/deadline/hold/budget fence remains.
                const currentPolicy = policy(deps, run, entry, true);
                if (!currentPolicy.writesAllowed)
                    throw new Error(currentPolicy.reason);
                if (entry.followups >= entry.effective.budgetShare.maxFollowups)
                    throw new Error('The child follow-up allowance is exhausted.');
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
                actor: request.actor, expectedEpoch: request.expectedEpoch });
            const all = records(deps, run.id);
            const prior = all.find(row => row.requestId === request.requestId);
            if (prior) return prior.requestDigest === requestDigest && prior.event === 'result-adopted'
                ? { status: 'duplicate', artifacts: [], unknowns: [], adoptedRecordId: prior.id }
                : { status: 'refused', artifacts: [], unknowns: [], reason: 'Adoption request identity already names different intent.' };
            if (latest.control.revision !== request.expectedRevision || latest.status !== 'running' || latest.control.stop || latest.control.paused.length
                || runExitFence(latest) || executionContext(deps, latest.id).budget.phase !== 'active')
                return { status: 'refused', artifacts: [], unknowns: [], reason: 'Re-read the active unheld Run before adopting a child result.' };
            const result = all.filter(row => row.delegationId === found.delegationId && row.event === 'result-observed').at(-1);
            if (!result) return { status: 'refused', artifacts: [], unknowns: [], reason: 'Only an exact observed child result can be adopted.' };
            const adopted = await deps.ledger.appendDelegation(run.id, { delegationId: found.delegationId,
                parentSessionId: found.parentSessionId, childSessionId: found.childSessionId,
                requestId: request.requestId, requestDigest, event: 'result-adopted',
                payload: { resultRecordId: result.id, recipient: found.effective.recipient, candidateOnly: false } });
            await deps.ledger.advanceRun(run.id, { control: { ...latest.control, revision: latest.control.revision + 1 } });
            return { status: 'accepted', artifacts: [], unknowns: [], adoptedRecordId: adopted.id,
                resultRecordId: result.id, recipient: found.effective.recipient };
        });
    if (request.action === 'followup')
        return followupDelegation(ctx, { parentSessionId: found.parentSessionId, childSessionId: found.childSessionId, requestId: request.requestId, message: request.text ?? '' }, auth, signal);
    if (request.action === 'cancel')
        return cancelDelegation(ctx, { parentSessionId: found.parentSessionId, childSessionId: found.childSessionId, requestId: request.requestId }, auth);
    const result = await readDelegationResult(ctx, { effective: found.effective, requestDigest: found.requestDigest });
    if (result.status === 'candidate' && found.state === 'accepted')
        await controlling(deps, run.id, async () => {
            const latest = deps.ledger.run(run.id);
            if (!latest?.control || latest.control.owner !== found.parentSessionId || latest.control.epoch !== request.expectedEpoch
                || latest.control.revision !== request.expectedRevision) throw new Error('Re-read the Run before recording this child result.');
            if (!records(deps, run.id).some(r => r.requestId === request.requestId)) {
                const handoff = durableDelegationHandoff(result, { recordId:found.contractRecordId, requestDigest:found.requestDigest });
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

/** Resolve the retained authority that lets exactly one Operator child use the qualified tool. */
export function operatorInteractiveAuthority(deps: FabricDeps, childSessionId: string, target: {
    readonly runId: string; readonly nodeId: string; readonly executionId: string;
}): { readonly authorityOwner: string; readonly expectedBindingDigest: string } | undefined {
    const run = deps.ledger.run(target.runId);
    const entry = runDelegations(deps, target.runId).find(row => row.childSessionId === childSessionId);
    const policy = delegationRuntimePolicy(deps, childSessionId);
    const grant = entry?.effective.operator;
    if (!run?.control || !entry || !policy?.toolsAllowed || !['intent', 'accepted'].includes(entry.state)
        || entry.effective.role !== 'operator' || !entry.effective.tools.includes('hima_interactive')
        || entry.effective.runRef?.runId !== target.runId || grant === undefined
        || grant.runId !== target.runId || grant.nodeId !== target.nodeId || grant.executionId !== target.executionId
        || grant.mutation !== 'qualified') return undefined;
    return { authorityOwner: run.control.owner, expectedBindingDigest: grant.bindingDigest };
}
