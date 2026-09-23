// @hima-seam agent wrapped
// A read-only projection of existing authorities, shared by Guide tools and the Workbench.
import { realpath } from 'node:fs/promises';
import type { Context } from '@deepseek-ai/cordis';
import { z } from 'zod';
import type { Ledger } from './ledger.js';
import type { ExecutionContext, FabricDeps } from './fabric.js';
import type { ReadExperienceResult } from './experience.js';
import { readChildSessionView } from './guide-sessions.js';

const id = z.string().min(1).max(1024);
export const targetAddress = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('run'), runId: id }),
  z.strictObject({ kind: z.literal('node'), runId: id, nodeId: id, executionId: id.optional(), generation: z.number().int().positive().optional() })
    .refine(value => value.executionId !== undefined || value.generation !== undefined, 'a node address needs executionId or generation'),
  z.strictObject({ kind: z.literal('report'), reportRef: id, version: id, sha256: z.string().regex(/^[a-f0-9]{64}$/) }),
  z.strictObject({ kind: z.literal('child'), parentSessionId: id, childSessionId: id }),
]);
export type TargetAddress = z.infer<typeof targetAddress>;
export class GuideContextError extends Error {
  constructor(readonly code: 'hima/invalid-view-address' | 'hima/not-authorized' | 'hima/not-found' | 'hima/context-stale', message: string) { super(message); }
}
export interface GuideContextDeps {
  readonly ctx: Context;
  readonly ledger: Ledger;
  executionContext(runId: string): ExecutionContext;
  readExperience(runId: string): Promise<ReadExperienceResult>;
}

/** A project's identity is its actual workspace; a shared Site never grants project membership. */
export async function sessionProject(ctx: Context, sessionId: string, liveRequired = false): Promise<string> {
  const live = ctx.get('agents')?.get(sessionId as never);
  const persistence = ctx.get('sessionPersistence') as { stat(id: string): Promise<{ header: { cwd?: string } } | undefined> } | undefined;
  const cwd = live?.session.header.cwd ?? (!liveRequired ? (await persistence?.stat(sessionId))?.header.cwd : undefined);
  if (!cwd) throw new GuideContextError('hima/not-authorized', 'This conversation has no available project workspace.');
  return realpath(cwd);
}

/** Tool and slash-command consumers use the same existing Run/project relation. */
export async function assertRunProject(deps: Pick<FabricDeps, 'ledger' | 'projectOfRun'>, sessionId: string, cwd: string | undefined, runId: string): Promise<void> {
  const control = deps.ledger.run(runId)?.control;
  if (control?.owner === sessionId || control?.guideSessionId === sessionId) return;
  const project = await deps.projectOfRun?.(runId);
  if (!cwd || !project || await realpath(cwd) !== project) throw new GuideContextError('hima/not-authorized', 'This Run is not linked to the current project.');
}

export async function authorizeProjectRun(deps: GuideContextDeps, sessionId: string, runId: string): Promise<string> {
  const workspace = await sessionProject(deps.ctx, sessionId, true);
  const run = deps.ledger.run(runId);
  if (!run) throw new GuideContextError('hima/not-found', 'The requested Campaign does not exist.');
  if (run.control?.owner === sessionId || run.control?.guideSessionId === sessionId) return workspace;
  const source = run.projectSessionId ?? run.control?.guideSessionId ?? run.control?.owner;
  if (!source || await sessionProject(deps.ctx, source) !== workspace) {
    throw new GuideContextError('hima/not-authorized', 'This Campaign is not linked to the current project. Open its project to inspect it.');
  }
  return workspace;
}

/** Resolve a retained report's immutable address before clients request that version. */
export async function resolveReportAddress(deps: GuideContextDeps, sessionId: string, reportRef: string): Promise<Extract<TargetAddress, { kind: 'report' }>> {
  const record = deps.ledger.record(reportRef);
  if (!record || record.type !== 'experience') throw new GuideContextError('hima/not-found', 'This reference is not a retained Campaign report.');
  await authorizeProjectRun(deps, sessionId, record.runId);
  return { kind: 'report', reportRef: record.id, version: String(record.seq), sha256: record.json.sha256 };
}

export async function readGuideContext(deps: GuideContextDeps, request: { sessionId: string; requestId: string; target: unknown }) {
  const parsed = targetAddress.safeParse(request.target);
  if (!parsed.success) throw new GuideContextError('hima/invalid-view-address', parsed.error.message);
  const target = parsed.data;
  const workspaceRef = await sessionProject(deps.ctx, request.sessionId, true);
  const head = { requestId: request.requestId, target, scope: { workspaceRef, sessionId: request.sessionId }, asOf: new Date().toISOString() };
  if (target.kind === 'child') {
    return { ...head, facts: await readChildSessionView(deps.ctx, { viewerSessionId: request.sessionId, ...target }), sources: [target.childSessionId], missing: [] };
  }
  if (target.kind === 'report') {
    const address = await resolveReportAddress(deps, request.sessionId, target.reportRef);
    if (address.sha256 !== target.sha256 || address.version !== target.version) throw new GuideContextError('hima/context-stale', 'The report address no longer matches the recorded version.');
    const record = deps.ledger.record(target.reportRef)!;
    const report = await deps.readExperience(record.runId);
    if (report.kind !== 'read' || report.record.id !== record.id) {
      return { ...head, facts: null, sources: [record.id], missing: [report.kind === 'read' ? 'The retained report identity changed.' : `Report bytes are ${report.kind}.`] };
    }
    return { ...head, sourceRevision: record.seq, facts: report, sources: [record.id], missing: [] };
  }
  await authorizeProjectRun(deps, request.sessionId, target.runId);
  const facts = deps.executionContext(target.runId);
  if (target.kind === 'node') {
    if (!facts.nodes.some(node => node.id === target.nodeId)) throw new GuideContextError('hima/not-found', 'The requested node is not part of this Campaign.');
    const execution = target.executionId === undefined ? undefined : facts.executions.find(item => item.id === target.executionId && item.nodeId === target.nodeId);
    if (target.executionId !== undefined && !execution) throw new GuideContextError('hima/context-stale', 'The execution identity does not belong to this node.');
    if (target.generation !== undefined && (execution ? execution.generation !== target.generation : facts.run.generation !== target.generation)) {
      throw new GuideContextError('hima/context-stale', 'The requested generation differs from the available node context.');
    }
  }
  return { ...head, sourceRevision: facts.run.control?.revision ?? facts.run.nextSeq,
    ownedRun: facts.run.control?.owner === request.sessionId ? facts.run.id : undefined,
    facts, sources: [facts.run.id], missing: facts.reason ? [facts.reason] : [] };
}
export type GuideContextView = Awaited<ReturnType<typeof readGuideContext>>;
