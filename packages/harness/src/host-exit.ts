// @hima-seam agent wrapped
// App lifecycle is an admission fence in the existing RunControl journal, not a Run ending.
import type { Ledger, RunRecord } from './ledger.js';
import type { AgentRegistry } from '@deepseek-ai/dsh-agent';
export type HostExitMode = 'drain' | 'keep-jobs' | 'stop-jobs';
export interface HostExitRequest {
    readonly requestId: string;
    readonly mode: HostExitMode;
}
export interface HostExitStatus {
    readonly ready: boolean;
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
