// @hima-seam agent wrapped
// App exit fences business admission without ending a Run. Legacy journal readers remain for historical Runs.
import type { Ledger, RunRecord } from './ledger.js';
import type { AgentRegistry } from '@deepseek-ai/dsh-agent';
export type HostExitMode = 'drain' | 'keep-jobs' | 'stop-jobs';
export interface HostExitRequest {
    readonly requestId: string;
    readonly mode: HostExitMode;
    /** Atomic modal change; the previous fence remains until this replacement commits. */
    readonly expectedRequestId?: string;
}
export interface HostExitStatus {
    /** Work reached its exit boundary. The Host must still close DBOS/pools and then PostgreSQL. */
    readonly ready: boolean;
    readonly finalized?: boolean;
    readonly mode?: HostExitMode;
    readonly requestId?: string;
    readonly agents: readonly string[];
    readonly runs: readonly {
        runId: string;
        state: 'ready' | 'working' | 'uncertain';
        reason?: string;
        jobs: readonly string[];
    }[];
}
/** The latest lifecycle receipt is the sole durable fence; it never clears paused scopes. */
export function runExitFence(run: RunRecord): HostExitRequest | undefined {
    const entry = Object.values(run.control?.requests ?? {}).filter(r => r.receipt.action === 'host-exit')
        .sort((a, b) => b.revision - a.revision)[0];
    if (!entry)
        return undefined;
    const data = entry.receipt.data as {
        mode?: HostExitMode;
        releasedAt?: string;
    } | undefined;
    if (data?.releasedAt)
        return undefined;
    return { requestId: entry.receipt.requestId, mode: data?.mode ?? 'drain' };
}
/** Caller holds the existing Fabric Run lock. Recording quit does not cancel the Campaign. */
export async function recordExitFence(ledger: Ledger, runId: string, request: HostExitRequest, digest: string): Promise<void> {
    const run = ledger.run(runId)!;
    const control = run.control;
    if (!control)
        return;
    const key = `exit:${request.requestId}`;
    const previous = control.requests[key];
    if (previous) {
        if (previous.digest !== digest)
            throw new Error('exit request identity was reused with different contents');
        return;
    }
    await ledger.advanceRun(runId, { control: { ...control, revision: control.revision + 1, requests: { ...control.requests, [key]: {
                    actor: 'desktop-user', origin: 'human', epoch: control.epoch, revision: control.revision, at: new Date().toISOString(), digest, state: 'done',
                    receipt: { requestId: request.requestId, action: 'host-exit', data: { mode: request.mode } },
                } } } });
}
/** Recovery releases only the App lifetime fence after reconciling facts; human holds remain. */
export async function releaseExitFence(ledger: Ledger, runId: string): Promise<void> {
    const run = ledger.run(runId)!;
    const control = run.control;
    if (!control || !runExitFence(run))
        return;
    const requests = { ...control.requests };
    for (const [key, entry] of Object.entries(requests))
        if (entry.receipt.action === 'host-exit')
            requests[key] = { ...entry,
                receipt: { ...entry.receipt, data: { ...(entry.receipt.data as object ?? {}), releasedAt: new Date().toISOString() } } };
    await ledger.advanceRun(runId, { control: { ...control, revision: control.revision + 1, requests } });
}
export function readHostExitStatus(ledger: Ledger, agents: AgentRegistry | undefined, request?: HostExitRequest): HostExitStatus {
    const activeAgents = agents?.list().filter(a => a.status === 'running').map(a => String(a.id)) ?? [];
    const runs = ledger.runs().filter(r => r.status === 'running' || r.status === 'waiting').map(run => {
        const executions = Object.values(run.control?.executions ?? {}).filter(e => !e.supersededBy);
        const jobs = new Map<string, string>();
        for (const r of ledger.records({ runId: run.id, type: 'job' }))
            if (r.type === 'job')
                jobs.set(r.job.session, r.event);
        const open = [...jobs].filter(([, event]) => event === 'launched').map(([id]) => id);
        const uncertain = executions.some(e => e.phase === 'uncertain') || Object.values(run.control?.requests ?? {}).some(r => r.state === 'uncertain');
        const pending = executions.some(e => e.phase === 'working') || open.length > 0 || Object.values(run.control?.requests ?? {}).some(r => r.state === 'admitted');
        return { runId: run.id, state: uncertain ? 'uncertain' as const : pending ? 'working' as const : 'ready' as const,
            ...(uncertain ? { reason: 'An earlier effect is uncertain; explicit exit disposition is required.' } : {}), jobs: open };
    });
    return { ...request, agents: activeAgents, runs, ready: request?.mode === 'keep-jobs' || (activeAgents.length === 0 && runs.every(r => r.state === 'ready')) };
}

/** Current application facts, independent of delayed Ledger projection. */
export async function readDurableHostExitStatus(store:import('./run-store.js').RunStore,agents:AgentRegistry|undefined):Promise<HostExitStatus> {
    return store.readHostExitBoundary(async()=>{
    const request=await store.hostExit();
    const activeAgents=agents?.list().filter(a=>a.status==='running').map(a=>String(a.id))??[];
    const lastRequest=request?.requestId??await store.lastHostExitRequestId();
    const runs:HostExitStatus['runs'][number][]=[];let deliveryWriting=false;
    for(const run of await store.runs()) {
        const facts=await store.flowPhysicalFacts(run.runId);
        const resources=facts.resources.filter(resource=>!resource.released);
        const unclosed=facts.effects.filter(effect=>effect.dispatches.some(dispatch=>!dispatch.dispatchId.startsWith('stop:')&&!dispatch.dispatchId.startsWith('cleanup:'))&&!facts.stopped[effect.identity.effectId]&&
            !facts.resources.some(resource=>resource.effectId===effect.identity.effectId&&resource.released));
        const tasks=(await store.flowProjection(run.runId)).tasks as unknown as {identity:{effectId:string}}[];
        let collecting=false,preparationUnknown=false;
        for(const effect of facts.effects) {
            const snapshot=await store.effectSnapshot(effect.identity);
            if(tasks.some(task=>task.identity.effectId===effect.identity.effectId)&&effect.dispatches.some(dispatch=>dispatch.dispatchId==='submit')&&
                snapshot.resourcesReleased&&!snapshot.result&&!snapshot.facts['validated-result']&&!snapshot.facts['terminal-failure']&&!facts.stopped[effect.identity.effectId])collecting=true;
            const writePending=Boolean(snapshot.facts['native:preparation-write-intent']&&!snapshot.facts['native:preparation-copy-completed'])||
                Boolean(snapshot.facts['native:revision-retain-intent']&&!snapshot.facts['native:revision-retain-completed'])||
                Boolean(snapshot.facts['native:revision-workspace-intent']&&!snapshot.facts['native:revision-workspace-completed']);
            if(writePending)preparationUnknown=true;
            if(effect.admittedAt&&!facts.resources.some(resource=>resource.effectId===effect.identity.effectId)&&!effect.dispatches.length) {
                let complete=snapshot.facts['native:preparation-copy-completed']||snapshot.facts['native:revision-workspace-completed']||
                    (snapshot.facts['native:revision-retain-completed']&&!snapshot.facts['native:revision-workspace-intent']);
                // Shared-input admission belongs to a derived writer; its original parent
                // retains the exact workspace-copy receipt rather than duplicating that fact.
                if(!complete&&effect.identity.taskId==='hima.apply-revision-input')for(const parent of facts.effects) {
                    if((await store.derivedEffects(parent.identity)).some(child=>child.identity.effectId===effect.identity.effectId))complete=await store.effectFact(parent.identity.effectId,'native:revision-workspace-completed');
                }
                if(!complete)preparationUnknown=true;
            }
        }
        const delivery=await store.orderedFlowFacts(run.runId,'delivery-io:');
        const pendingDelivery=delivery.some(fact=>fact.name.startsWith('delivery-io:intent:')&&!delivery.some(closed=>closed.name===fact.name.replace('delivery-io:intent:','delivery-io:closed:')&&(closed.value as {closed?:boolean}).closed===true));
        deliveryWriting ||= pendingDelivery;
        const jobs:string[]=[];
        for(const resource of resources.filter(resource=>resource.claim.jobs>0)){const snapshot=await store.effectSnapshot(resource.identity);const prepared=snapshot.facts.prepared as {session?:string}|undefined;jobs.push(prepared?.session??resource.effectId);}
        const unknown=preparationUnknown||unclosed.some(effect=>effect.phase==='intent'||!resources.some(resource=>resource.effectId===effect.identity.effectId));
        const failed=await store.flowFact(run.runId,`app-exit-failed:${lastRequest??''}`);
        const state=(failed&&(resources.length||unclosed.length))||unknown?'uncertain':resources.length||unclosed.length||collecting||pendingDelivery?'working':'ready';
        runs.push({runId:run.runId,state,jobs,...(failed?{reason:'Original stop failed; its physical facts and human holds are retained.'}:unknown?{reason:preparationUnknown?'Admitted preparation has no confirmed write closure.':'Original dispatch closure is unproved.'}:pendingDelivery?{reason:'Original report/archive file publication awaits write closure.'}:collecting?{reason:'Original submitted output awaits its necessary collection.'}:resources.length?{reason:'Original physical resources await closure.'}:{})});
    }
    return {...request,agents:activeAgents,runs,ready:request?.mode==='keep-jobs'?!deliveryWriting:(activeAgents.length===0&&runs.every(run=>run.state==='ready'))};
    });
}
