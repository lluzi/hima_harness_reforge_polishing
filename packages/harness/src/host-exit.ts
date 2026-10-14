// @hima-seam agent wrapped
// App exit fences business admission without ending a Run. Legacy journal readers remain for historical Runs.
import type { AgentRegistry } from '@deepseek-ai/dsh-agent';
import type { CompiledFlow } from './flow-definition.js';
import { jsonDigest } from './run-store.js';
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

/** Pack-delegated and independent Team work share the same exit rule. Host fencing
 * and the readiness projection must classify the same actual frozen work. */
export async function durableRunHasTeamWork(store: import('./run-store.js').RunStore, runId: string): Promise<boolean> {
    const run = await store.run(runId);
    const opening = run.opening.data as unknown as { source?: { kind?: string }; start?: { flow?: CompiledFlow } };
    const teamFlow = (flow: CompiledFlow | undefined): boolean => flow?.source === 'team' ||
        Object.values(flow?.tasks ?? {}).some(task => task.teamDelegation !== undefined);
    if (opening.source?.kind === 'team' || teamFlow(opening.start?.flow)) return true;
    return (await store.flowInvocations(runId)).some(invocation => teamFlow((invocation.context as unknown as { flow?: CompiledFlow }).flow));
}

/** Only an accepted, physically closed child makes its held zero-resource parent
 * delegation bookkeeping safe to omit from keep-jobs readiness. No facts change. */
async function closedPackDelegationBookkeeping(
    store: import('./run-store.js').RunStore,
    facts: Awaited<ReturnType<import('./run-store.js').RunStore['flowPhysicalFacts']>>,
    runId: string,
): Promise<Set<string>> {
    const closed = new Set<string>();
    const invocations = await store.flowInvocations(runId);
    for (const effect of facts.effects) {
        if (effect.identity.runId !== runId || effect.phase !== 'pack-team-binding' || !effect.admittedAt) continue;
        const lease = facts.resources.find(resource => resource.effectId === effect.identity.effectId);
        if (!lease || lease.released || lease.claim.jobs !== 0 || Object.keys(lease.claim.licences).length !== 0 ||
            jsonDigest(lease.identity) !== jsonDigest(effect.identity)) continue;
        const business = effect.dispatches.filter(dispatch => !dispatch.dispatchId.startsWith('stop:') && !dispatch.dispatchId.startsWith('cleanup:'));
        if (business.length !== 1 || business[0]!.dispatchId !== 'submit' || business[0]!.inputSha256 !== effect.identity.inputSha256) continue;
        const invocation = invocations.find(candidate => jsonDigest(candidate.identity) === jsonDigest(effect.identity));
        if (!invocation) continue;
        const context = invocation.context as unknown as { flow?: CompiledFlow; taskId?: string };
        const task = context.flow?.tasks[effect.identity.taskId];
        if (context.taskId !== effect.identity.taskId || !context.flow || context.flow.source === 'team' ||
            task?.tool !== 'resident/team-delegate' || !task.teamDelegation) continue;
        const snapshot = await store.effectSnapshot(effect.identity);
        const plan = snapshot.facts.prepared as unknown as import('./run-store.js').PackTeamPlan | undefined;
        const binding = snapshot.facts['pack-team-binding'] as unknown as { plan?: import('./run-store.js').PackTeamPlan; bindingSha256?: string } | undefined;
        if (!plan || plan.schema !== 'hima-pack-team-delegation/1' || !binding || snapshot.resourcesReleased ||
            typeof plan.childTaskId !== 'string' || !plan.childTaskId || typeof plan.childRunId !== 'string' || !plan.childRunId ||
            jsonDigest(plan.parentIdentity ?? null) !== jsonDigest(effect.identity) ||
            plan.parentInvocationSha256 !== jsonDigest(invocation) ||
            jsonDigest(plan.delegation ?? null) !== jsonDigest(task.teamDelegation) ||
            jsonDigest(snapshot.facts.submitted ?? null) !== jsonDigest(plan) ||
            jsonDigest(binding.plan ?? null) !== jsonDigest(plan) || binding.bindingSha256 !== jsonDigest(plan)) continue;
        const closure = await store.readExternalPackTeamClosure(effect.identity);
        const proof = (closure.closed ? closure.proof : undefined) as { packTeam?: boolean; packTeamUnadmitted?: boolean; parentIdentity?: unknown; childTaskId?: string; bindingSha256?: string } | undefined;
        if (closure.closed === true && proof?.packTeam === true && proof.packTeamUnadmitted !== true &&
            jsonDigest(proof.parentIdentity ?? null) === jsonDigest(effect.identity) &&
            proof.childTaskId === plan.childTaskId && proof.bindingSha256 === binding.bindingSha256) closed.add(effect.identity.effectId);
    }
    return closed;
}

/** Current application facts, independent of delayed Ledger projection. */
export async function readDurableHostExitStatus(store:import('./run-store.js').RunStore,agents:AgentRegistry|undefined):Promise<HostExitStatus> {
    return store.readHostExitBoundary(async()=>{
    const request=await store.hostExit();
    const activeAgents=agents?.list().filter(a=>a.status==='running').map(a=>String(a.id))??[];
    const lastRequest=request?.requestId??await store.lastHostExitRequestId();
    const runs:HostExitStatus['runs'][number][]=[];let deliveryWriting=false;const teamRuns=new Set<string>();
    for(const run of await store.runs()) {
        if(await durableRunHasTeamWork(store,run.runId))teamRuns.add(run.runId);
        const facts=await store.flowPhysicalFacts(run.runId);
        const bookkeeping=request?.mode==='keep-jobs'?await closedPackDelegationBookkeeping(store,facts,run.runId):new Set<string>();
        const resources=facts.resources.filter(resource=>!resource.released&&!bookkeeping.has(resource.effectId));
        const unclosed=facts.effects.filter(effect=>!bookkeeping.has(effect.identity.effectId)&&effect.dispatches.some(dispatch=>!dispatch.dispatchId.startsWith('stop:')&&!dispatch.dispatchId.startsWith('cleanup:'))&&!facts.stopped[effect.identity.effectId]&&
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
    return {...request,agents:activeAgents,runs,ready:request?.mode==='keep-jobs'?(!deliveryWriting&&runs.filter(run=>teamRuns.has(run.runId)).every(run=>run.state==='ready')):(activeAgents.length===0&&runs.every(run=>run.state==='ready'))};
    });
}
