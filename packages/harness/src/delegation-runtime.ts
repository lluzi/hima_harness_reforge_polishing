// @hima-seam agent wrapped
// The Ledger's delegation records of historical Runs, read back. Current Runs delegate through
// declared Pack tasks whose native children DBOS records (ADR-0018); nothing here admits a child.
import type { FabricDeps } from './node-turns.js';
import type { DelegationRecord, RunRecord } from './ledger.js';
import type { DelegationContract, EffectiveDelegationContract, DelegationReservation, DelegationRuntimePolicy, DurableDelegationState } from './delegation.js';
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
/**
 * The tool policy of a historical delegated child. Every ledger Run with a delegation is terminal after
 * the DBOS cutover (`legacyCutoverReceipt`), so its children keep no tool or write grant.
 */
function policy(run: RunRecord, entry: RunDelegationView): Pick<DelegationRuntimePolicy, 'toolsAllowed' | 'writesAllowed' | 'reason'> {
    if (run.control?.owner !== entry.parentSessionId || run.control.epoch !== entry.reservation.admittedEpoch)
        return { toolsAllowed: false, writesAllowed: false, reason: 'The parent owner epoch changed.' };
    return { toolsAllowed: false, writesAllowed: false, reason: 'The parent Run is not admitting work.' };
}
export function delegationRuntimePolicy(deps: FabricDeps, childSessionId: string): DelegationRuntimePolicy | undefined {
    for (const run of deps.ledger.runs())
        for (const entry of runDelegations(deps, run.id))
            if (entry.childSessionId === childSessionId) {
                return { effective: entry.effective, state: entry.state, ...policy(run, entry) };
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
