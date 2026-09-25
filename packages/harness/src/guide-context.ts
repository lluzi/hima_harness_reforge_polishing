// @hima-seam agent wrapped
// A read-only projection of existing authorities, shared by Guide tools and the Workbench.
import { realpath } from 'node:fs/promises';
import type { Context } from '@deepseek-ai/cordis';
import { z } from 'zod';
import type { Ledger } from './ledger.js';
import type { ExecutionContext, FabricDeps } from './fabric.js';
import { libraryInsightDocument, type LibraryInsightReportView } from './library-insight-report.js';
import { readGenerationFeedback, type GenerationFeedbackReport } from './generation-feedback-report.js';
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
  readReportMaterial?(runId:string,recordId:string):Promise<{kind:'read';text:string}|{kind:'unavailable';why:string}>;
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
  if (!record || !['experience','code','knowledge','observation'].includes(record.type)) throw new GuideContextError('hima/not-found', 'This reference is not a retained Campaign report.');
  await authorizeProjectRun(deps, sessionId, record.runId);
  if(record.type==='experience')return { kind: 'report', reportRef: record.id, version: String(record.seq), sha256: record.json.sha256 };
  if(record.type==='code'||record.type==='knowledge'||record.type==='observation'){await readTypedReport(deps,record);return {kind:'report',reportRef:record.id,version:String(record.seq),sha256:record.type==='observation'?record.contentSha256:record.sha256};}
  throw new GuideContextError('hima/not-found','This record has no supported report schema.');
}

export interface GenerationFeedbackView { readonly kind:'generation-feedback'; readonly report:GenerationFeedbackReport; readonly reportRef:string; readonly version:string; readonly source:{readonly recordId:string;readonly sha256:string;readonly createdAt:string} }
async function readTypedReport(deps:GuideContextDeps,record:import('./ledger.js').CodeRecord|import('./ledger.js').KnowledgeRecord|import('./ledger.js').ObservationRecord):Promise<LibraryInsightReportView|GenerationFeedbackView> {
  if(record.bytes>2*1024*1024||!deps.readReportMaterial)throw new GuideContextError('hima/not-found','This bounded report view is unavailable.');
  const material=await deps.readReportMaterial(record.runId,record.id);
  if(material.kind!=='read')throw new GuideContextError('hima/context-stale','The recorded report bytes are unavailable or changed.');
  const source={recordId:record.id,sha256:record.type==='observation'?record.contentSha256:record.sha256,createdAt:record.at};
  let raw:unknown;try{raw=JSON.parse(material.text);}catch{throw new GuideContextError('hima/invalid-view-address','This artifact is not a supported structured report.');}
  const library=libraryInsightDocument.safeParse(raw);
  if(library.success)return {...library.data,reportRef:record.id,version:String(record.seq),source};
  try{return {kind:'generation-feedback',report:readGenerationFeedback(raw),reportRef:record.id,version:String(record.seq),source};}
  catch{throw new GuideContextError('hima/invalid-view-address','This report does not match a supported complete schema; unknown data is not replaced by zero. Native Library analysis is unavailable.');}
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
    if(record.type==='code'||record.type==='knowledge'||record.type==='observation'){
      const facts=await readTypedReport(deps,record);
      return {...head,sourceRevision:record.seq,facts,sources:[record.id],
        missing:'evidenceClass' in facts&&facts.evidenceClass==='synthetic'
          ?['Synthetic fixture only. Native Library qualification has not passed.']:[]};
    }
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

/** Read retained native events without waking an Agent or manufacturing historical provider context. */
export async function readNativeSessionContext(ctx:Context,request:{sessionId:string;targetSessionId:string;parentSessionId?:string;fromSeq?:number},ledger?:Ledger) {
  const workspace=await sessionProject(ctx,request.sessionId,true);
  if(await sessionProject(ctx,request.targetSessionId)!==workspace)throw new GuideContextError('hima/not-authorized','This conversation belongs to another project.');
  const query=ctx.get('sessionQuery') as {readSession(id:string):Promise<{session:{id:string;parentSession?:string};events:readonly {seq:number;data?:unknown;type?:string}[]}>;readSurface(id:string):Promise<{session:{id:string};capturedThroughSeq:number|null;events:readonly unknown[]}>}|undefined;
  if(!query)throw new GuideContextError('hima/not-found','Native session history is unavailable.');
  const persistence=ctx.get('sessionPersistence') as {stat(id:string):Promise<{header:{parentSession?:string}}|undefined>}|undefined;
  const target=await persistence?.stat(request.targetSessionId);
  if(!target)throw new GuideContextError('hima/not-found','The requested retained conversation is unavailable.');
  const parent=target.header.parentSession===undefined?undefined:String(target.header.parentSession);
  if(request.parentSessionId!==undefined&&request.parentSessionId!==parent)throw new GuideContextError('hima/context-stale','The requested parent does not own this conversation.');
  const targetOwner=parent??request.targetSessionId;
  // A Guide may inspect the root execution session it actually arranged. For
  // a child, the parent Run relationship alone is too broad: that same owner
  // may have unrelated native children in the same workspace. Require this
  // exact child to be in that Run's retained delegation journal.
  const assignedGuide=ledger?.runs().some(run=>run.control?.owner===targetOwner
    &&run.control.guideSessionId===request.sessionId
    &&(parent===undefined||ledger.records({runId:run.id,type:'delegation'}).some(record=>record.type==='delegation'
      &&record.childSessionId===request.targetSessionId&&record.parentSessionId===parent
      &&['create-intent','created','result-observed'].includes(record.event))))??false;
  if(request.sessionId!==request.targetSessionId&&request.sessionId!==parent&&!assignedGuide)throw new GuideContextError('hima/not-authorized','Only this conversation, its parent, or its recorded Guide may inspect this retained context.');
  const log=await query.readSession(request.targetSessionId);
  if(String(log.session.id)!==request.targetSessionId||request.parentSessionId!==undefined&&String(log.session.parentSession)!==request.parentSessionId)throw new GuideContextError('hima/context-stale','The retained conversation lineage differs from the requested identity.');
  if(log.session.parentSession&&request.sessionId!==request.targetSessionId)await readChildSessionView(ctx,{viewerSessionId:request.sessionId,parentSessionId:String(log.session.parentSession),childSessionId:request.targetSessionId});
  const from=request.fromSeq??0;if(!Number.isSafeInteger(from)||from<0)throw new GuideContextError('hima/invalid-view-address','Event cursor must be nonnegative.');
  const eventView=(event:unknown,index:number)=>{
    const row=event as {seq?:number;type?:string;data?:{type?:string}};
    let remaining=7000;
    const bounded=(value:unknown,depth=0):unknown=>{
      if(remaining<=0||depth>7)return '[truncated]';
      if(typeof value==='string'){const out=value.slice(0,Math.min(remaining,2000));remaining-=out.length;return out.length<value.length?`${out}… [truncated]`:out;}
      if(Array.isArray(value))return [...value.slice(0,24).map(v=>bounded(v,depth+1)),...(value.length>24?['[truncated]']:[])];
      if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).slice(0,24).map(([k,v])=>{remaining-=k.length+4;return [k,bounded(v,depth+1)];}));
      remaining-=16;return value;
    };
    const text=JSON.stringify(bounded(row.data??event));
    return {seq:row.seq??index,kind:row.data?.type??row.type??'native-event',text:text.length>8192?`${text.slice(0,8192)}… [truncated]`:text};
  };
  const events=log.events.filter(e=>e.seq>=from).slice(0,64).map(eventView);
  const nextSeq=events.at(-1)?.seq===undefined?from:events.at(-1)!.seq+1;
  let context:object={availability:'unavailable',reason:'Native current model surface is not retained/available.'};
  try {const surface=await query.readSurface(request.targetSessionId);if(String(surface.session.id)!==request.targetSessionId)throw new Error('surface identity mismatch');context={availability:'available',kind:'current-native-surface',capturedThroughSeq:surface.capturedThroughSeq,events:surface.events.slice(-64).map(eventView),truncated:surface.events.length>64,missing:['The current native model history is available; historical provider system-prompt and tool-schema snapshots are not supplied by this view.']};}catch(error){context={availability:'unavailable',reason:String(error)};}
  return {sessionId:request.targetSessionId,parentSessionId:log.session.parentSession,events,nextSeq,truncated:log.events.some(e=>e.seq>=nextSeq),context,asOf:new Date().toISOString(),sources:[request.targetSessionId]};
}
