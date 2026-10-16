import { createHash } from 'node:crypto';
import { z } from 'zod';
import { TeamError, type TeamDefinition, type TeamDefinitionRef } from './team-contract.js';
import type { TaskRef, TeamMessageActor, TeamMessageSender } from './team-messages.js';
import { retainExperience, reconcileRetention, recallExperience, type HindsightConnection } from './hindsight.js';

export interface MemoryScope { projectId:string; teamId:string; kind:'member'|'project'|'team'; memberId?:string }
export type MemorySource =
  | {kind:'feedback';eventId:string;sha256:string}
  | {kind:'material';taskId:string;stageId:string;materialId:string;sha256:string;bytes:number}
  | {kind:'artifact';taskId:string;runId:string;effectId:string;name:string;sha256:string;bytes:number}
  | {kind:'archive';runId:string;manifestSha256:string;materialPath:'experience.json';sha256:string;bytes:number};
export interface MemoryRecord {
  schemaVersion:1; memoryId:string; version:number; scope:MemoryScope; sourceTaskId:string; sourceRunId:string;
  team:TeamDefinitionRef; kind:'feedback'|'experience'; text:string; sha256:string; conditions:readonly string[];
  sources:readonly MemorySource[]; createdAt:string; createdBy:TeamMessageSender; supersedesVersion?:number;
}
export interface MemoryEvent {
  schemaVersion:1; eventId:string; requestId:string; payloadSha256:string; memoryId:string; version:number; revision:number;
  event:'feedback'|'proposed'|'adopted'|'disabled'|'re-adopted'|'corrected'; state:'candidate'|'adopted'|'disabled'|'re-adopted';
  actor:TeamMessageSender; taskId:string; runId:string; createdAt:string; reason:string; evidenceRefs:readonly MemorySource[];
  conditions:readonly string[]; supersedesEventId?:string; supersedesVersion?:number;
}
export interface RetentionOperation {
  schemaVersion:1; operationId:string; memoryId:string; version:number; adoptionRevision:number; documentId:string;
  contentSha256:string; payloadSha256:string; bankId:string; state:'pending'|'unknown'|'submitted'|'confirmed'|'failed';
  revision:number; createdAt:string; updatedAt:string; serviceGeneration?:string;
  nativeStatus?:'pending'|'processing'|'completed'|'failed'|'cancelled'|'not_found'; nativeDocumentHash?:string;
  confirmedAt?:string; reason?:string;
}
export type PublicRetentionView = Omit<RetentionOperation,'bankId'|'payloadSha256'|'contentSha256'|'nativeDocumentHash'|'serviceGeneration'>;
export interface MemoryView {record:MemoryRecord;tip:MemoryEvent;index:PublicRetentionView}
export interface MemoryTarget {kind:MemoryScope['kind'];memberId?:string}
export interface ResolvedMemoryScopes {scopes:readonly {scope:MemoryScope;bankId:string}[]}
export interface FeedbackRequest {requestId:string;target:MemoryTarget;text:string;reason:string;conditions:readonly string[];sources:readonly MemorySource[]}
export interface ProposalRequest extends FeedbackRequest {}
export interface AdoptionRequest {
  requestId:string;memoryId:string;expectedVersion:number;expectedRevision:number;supersedesEventId:string;
  action:'adopted'|'disabled'|'re-adopted';reason:string;evidenceRefs:readonly MemorySource[];conditions:readonly string[];
}
export interface CorrectionRequest extends Omit<AdoptionRequest,'action'> {text:string;sources:readonly MemorySource[]}
export interface MemoryPage {records:readonly MemoryView[];nextCursor?:number}
export interface MemoryEventPage {events:readonly MemoryEvent[];nextCursor?:number}
export interface RetentionObservation {
  state:RetentionOperation['state']; nativeStatus?:RetentionOperation['nativeStatus'];reason?:string;
  serviceGeneration?:string;confirmedAt?:string;
}
/** Root owns authenticated resolution, replay/CAS and atomic mutations. Native I/O is always outside transactions. */
export interface TeamMemoryStore {
  resolve(actor:TeamMessageActor,ref:TaskRef,target?:MemoryTarget):Promise<ResolvedMemoryScopes>;
  commitFeedback(actor:TeamMessageActor,ref:TaskRef,request:FeedbackRequest):Promise<MemoryView>;
  commitProposal(actor:TeamMessageActor,ref:TaskRef,request:ProposalRequest):Promise<MemoryView>;
  changeAdoption(actor:TeamMessageActor,ref:TaskRef,request:AdoptionRequest):Promise<MemoryView>;
  correct(actor:TeamMessageActor,ref:TaskRef,request:CorrectionRequest):Promise<MemoryView>;
  read(actor:TeamMessageActor,ref:TaskRef,page:{limit:number;cursor?:number}):Promise<MemoryPage>;
  record(actor:TeamMessageActor,ref:TaskRef,memoryId:string,version?:number):Promise<MemoryView>;
  candidates(actor:TeamMessageActor,ref:TaskRef,documents:readonly string[]):Promise<readonly MemoryView[]>;
  claimRetention(actor:TeamMessageActor,ref:TaskRef,operationId:string,expectedRevision:number):Promise<RetentionOperation|undefined>;
  recordRetention(operationId:string,expectedRevision:number,result:RetentionObservation):Promise<RetentionOperation>;
  readOperation(operationId:string):Promise<RetentionOperation|undefined>;
  readRetention(actor:TeamMessageActor,ref:TaskRef,memoryId:string):Promise<PublicRetentionView>;
  pendingRetentions(actor:TeamMessageActor,ref:TaskRef,limit:number):Promise<readonly RetentionOperation[]>;
  correctionsAfter(actor:TeamMessageActor,ref:TaskRef,cursor:number,limit:number):Promise<MemoryEventPage>;
}
export interface MemorySourceReader {verify(actor:TeamMessageActor,ref:TaskRef,sources:readonly MemorySource[]):Promise<readonly MemorySource[]>}
export interface HindsightPorts {connection():HindsightConnection|undefined;fetch?:typeof fetch;signal?:AbortSignal}
export interface TeamMemoryPorts {store:TeamMemoryStore;sourceReader:MemorySourceReader;hindsight:HindsightPorts;track?:(dispatch:Promise<unknown>) => void}
export interface TeamMemoryContext {
  records:readonly (MemoryView & {appliedConditions:readonly string[];retrieval:{documentId:string;excerpt:string;label:'retrieval-evidence'}})[];
  diagnostics:readonly string[];
}
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const integer = z.number().int().safe().positive();
const cleanText = (max:number) => z.string().min(1).max(max).refine(text => !/[\u0000]/u.test(text) && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(text),'Text must contain valid UTF-8 scalars.');
const conditions = z.array(cleanText(4000)).max(29).default([]);
const bytes = z.number().int().safe().nonnegative();
export const memorySourceSchema = z.discriminatedUnion('kind',[
  z.strictObject({kind:z.literal('feedback'),eventId:id,sha256:hash}),
  z.strictObject({kind:z.literal('material'),taskId:id,stageId:id,materialId:id,sha256:hash,bytes}),
  z.strictObject({kind:z.literal('artifact'),taskId:id,runId:id,effectId:id,name:cleanText(4000),sha256:hash,bytes}),
  z.strictObject({kind:z.literal('archive'),runId:id,manifestSha256:hash,materialPath:z.literal('experience.json'),sha256:hash,bytes}),
]);
const sources = z.array(memorySourceSchema).max(32);
const target = z.strictObject({kind:z.enum(['member','project','team']),memberId:id.optional()})
  .refine(value => (value.kind === 'member') === (value.memberId !== undefined),'Only member scope requires memberId.');
export const memoryScopeSchema = z.strictObject({projectId:cleanText(4096),teamId:id,kind:z.enum(['member','project','team']),memberId:id.optional()})
  .refine(value => (value.kind === 'member') === (value.memberId !== undefined),'Only member scope requires memberId.');
const feedback = z.strictObject({requestId:id,target,text:cleanText(16000),reason:cleanText(4000),conditions,sources:sources.default([])});
const proposal = feedback.refine(value => value.sources.length > 0,'Proposals require actual source references.');
const change = {requestId:id,memoryId:id,expectedVersion:integer,expectedRevision:integer,supersedesEventId:id,reason:cleanText(4000),evidenceRefs:sources.default([]),conditions};
const adoption = z.strictObject({...change,action:z.enum(['adopted','disabled','re-adopted'])})
  .refine(value => value.action !== 're-adopted' || value.evidenceRefs.length > 0,'Re-adoption requires newly verified evidence.');
const correction = z.strictObject({...change,text:cleanText(16000),sources:sources.default([])});
const querySchema = z.strictObject({query:cleanText(4000),limit:z.number().int().min(1).max(8).default(8),memberId:id.optional()});
const pageSchema = z.strictObject({limit:z.number().int().min(1).max(100),cursor:z.number().int().safe().nonnegative().optional()});
function parse<T>(schema:z.ZodType<T>,input:unknown):T {
  const result = schema.safeParse(input); if (!result.success) throw new TeamError('hima/team-invalid',result.error.message); return result.data;
}
export const parseFeedbackRequest = (input:unknown):FeedbackRequest => parse(feedback,input);
export const parseProposalRequest = (input:unknown):ProposalRequest => parse(proposal,input);
export const parseAdoptionRequest = (input:unknown):AdoptionRequest => parse(adoption,input);
export const parseCorrectionRequest = (input:unknown):CorrectionRequest => parse(correction,input);
export function memoryTextSha256(text:string):string {return createHash('sha256').update(text,'utf8').digest('hex');}
function canonical(value:unknown):unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([,v]) => v !== undefined).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => [k,canonical(v)]));
  return value;
}
/** Caller supplies its transaction-authenticated sender and resolved scope, never request authority. */
export function memoryPayloadDigest(action:string,request:FeedbackRequest|ProposalRequest|AdoptionRequest|CorrectionRequest,actor:TeamMessageSender,scope:MemoryScope,ref:TaskRef):string {
  const body = {...request};
  if ('sources' in body) body.sources = [...body.sources].sort((a,b) => JSON.stringify(canonical(a)).localeCompare(JSON.stringify(canonical(b))));
  if ('evidenceRefs' in body) body.evidenceRefs = [...body.evidenceRefs].sort((a,b) => JSON.stringify(canonical(a)).localeCompare(JSON.stringify(canonical(b))));
  return memoryTextSha256(JSON.stringify(canonical({action,request:body,actor,scope,ref})));
}
export function memoryBankId(scope:MemoryScope):string {return `hima-${memoryTextSha256(JSON.stringify(canonical(parse(memoryScopeSchema,scope))))}`;}
export function publicRetentionView(operation:RetentionOperation):PublicRetentionView {
  // Explicit allowlist: a future Host-only field must not accidentally become public.
  return {schemaVersion:1,operationId:operation.operationId,memoryId:operation.memoryId,version:operation.version,
    adoptionRevision:operation.adoptionRevision,documentId:operation.documentId,state:operation.state,revision:operation.revision,
    createdAt:operation.createdAt,updatedAt:operation.updatedAt,
    ...(operation.nativeStatus === undefined ? {} : {nativeStatus:operation.nativeStatus}),
    ...(operation.confirmedAt === undefined ? {} : {confirmedAt:operation.confirmedAt}),
    ...(operation.reason === undefined ? {} : {reason:operation.reason})};
}
export function resolveMemoryScopes(store:TeamMemoryStore,actor:TeamMessageActor,ref:TaskRef,selection?:MemoryTarget):Promise<ResolvedMemoryScopes> {
  return store.resolve(actor,ref,selection === undefined ? undefined : parse(target,selection));
}
/** Persist before bounded dispatch; callers own reconciliation triggers, never a leaf interval. */
export async function saveFeedback(ports:TeamMemoryPorts,actor:TeamMessageActor,ref:TaskRef,input:unknown):Promise<MemoryView> {
  if (actor.kind !== 'human') throw new TeamError('hima/not-authorized','Human feedback requires an authenticated human.');
  const view = await ports.store.commitFeedback(actor,ref,parseFeedbackRequest(input));
  const dispatch = dispatchRetention(ports,actor,ref,view.index.operationId).catch(() => undefined);
  ports.track?.(dispatch);
  return view;
}
export async function proposeExperience(ports:TeamMemoryPorts,actor:TeamMessageActor,ref:TaskRef,input:unknown):Promise<MemoryView> {
  const view = await ports.store.commitProposal(actor,ref,parseProposalRequest(input));
  const dispatch = dispatchRetention(ports,actor,ref,view.index.operationId).catch(() => undefined);
  ports.track?.(dispatch);
  return view;
}
/** Scope/role policy for member adoption; authenticated grants and CAS remain Store-owned. */
export function assertMemberMemoryAdoption(actor:TeamMessageActor,view:MemoryView|undefined,definition:TeamDefinition):void {
  if(actor.kind!=='member')return;
  // Adopted advice cannot alter definitions, permissions, human gates or acceptance.
  if(!view||view.record.kind!=='experience'||view.record.createdBy.kind!=='member')
    throw new TeamError('hima/not-authorized','Members may adopt only source-backed Agent candidate experience; human feedback requires the human.');
  if(view.record.scope.kind==='member') {
    if(view.record.scope.memberId!==actor.grant.memberId||view.record.createdBy.memberId!==actor.grant.memberId)
      throw new TeamError('hima/not-authorized','A personal technique must belong to and be proposed by this member.');
  } else if(definition.leaderMemberId!==actor.grant.memberId)
    throw new TeamError('hima/not-authorized','Only the frozen Team leader may confirm shared methods within this Team scope.');
}
export async function changeExperienceAdoption(ports:TeamMemoryPorts,actor:TeamMessageActor,ref:TaskRef,input:unknown):Promise<MemoryView> {
  if (actor.kind !== 'human' && actor.kind !== 'member') throw new TeamError('hima/not-authorized','Adoption requires the authenticated human or a granted member.');
  return ports.store.changeAdoption(actor,ref,parseAdoptionRequest(input));
}
export async function correctExperience(ports:TeamMemoryPorts,actor:TeamMessageActor,ref:TaskRef,input:unknown):Promise<MemoryView> {
  if (actor.kind !== 'human') throw new TeamError('hima/not-authorized','Correction requires an authenticated human.');
  const view = await ports.store.correct(actor,ref,parseCorrectionRequest(input));
  const dispatch = dispatchRetention(ports,actor,ref,view.index.operationId).catch(() => undefined);
  ports.track?.(dispatch);
  return view;
}
export function readTeamMemory(ports:TeamMemoryPorts,actor:TeamMessageActor,ref:TaskRef,input:unknown):Promise<MemoryPage> {
  return ports.store.read(actor,ref,parse(pageSchema,input));
}
export function readTeamMemoryCorrections(ports:TeamMemoryPorts,actor:TeamMessageActor,ref:TaskRef,input:unknown):Promise<MemoryEventPage> {
  const page = parse(pageSchema,input); return ports.store.correctionsAfter(actor,ref,page.cursor ?? 0,page.limit);
}
/** One immutable UUID/body per operation, with unknown persisted before external I/O. */
export async function dispatchRetention(ports:TeamMemoryPorts,actor:TeamMessageActor,ref:TaskRef,operationId:string):Promise<RetentionOperation|undefined> {
  const connection = ports.hindsight.connection(); if (!connection) return ports.store.readOperation(operationId);
  const operation = await ports.store.readOperation(operationId);
  if (!operation || operation.state === 'confirmed' || operation.state === 'failed') return operation;
  const view = await ports.store.record(actor,ref,operation.memoryId,operation.version);
  if (view.tip.version !== operation.version || view.tip.state === 'disabled' || memoryTextSha256(view.record.text) !== operation.contentSha256) return operation;
  const verifiedSources = await ports.sourceReader.verify(actor,ref,view.record.sources);
  if (view.record.sources.length === 0 || !sameSources(view.record.sources,verifiedSources)) return operation;
  let claimed = await ports.store.claimRetention(actor,ref,operationId,operation.revision); if (!claimed) return ports.store.readOperation(operationId);
  const input = {bankId:claimed.bankId,operationId:claimed.operationId,documentId:claimed.documentId,text:view.record.text,
    contentSha256:claimed.contentSha256,version:claimed.version,memoryId:claimed.memoryId};
  const options = {fetch:ports.hindsight.fetch,signal:ports.hindsight.signal};
  let result:RetentionObservation;
  try {
    if (operation.state === 'pending') {
      await retainExperience(connection,input,options);
      result = {state:'submitted',serviceGeneration:connection.generation};
    } else {
      const observed = await reconcileRetention(connection,input,options);
      if (observed.resubmitAllowed && observed.nativeStatus === 'not_found') {
        const current = await ports.store.record(actor,ref,operation.memoryId,operation.version);
        if (current.tip.version !== operation.version || current.tip.state === 'disabled'
          || memoryTextSha256(current.record.text) !== operation.contentSha256) return ports.store.readOperation(operationId);
        const checked = await ports.sourceReader.verify(actor,ref,current.record.sources);
        if (current.record.sources.length === 0 || !sameSources(current.record.sources,checked)) return ports.store.readOperation(operationId);
        const retryClaim = await ports.store.claimRetention(actor,ref,operationId,claimed.revision);
        if (!retryClaim) return ports.store.readOperation(operationId);
        claimed = retryClaim;
        await retainExperience(connection,input,options);
        result = {state:'submitted',serviceGeneration:connection.generation};
      } else result = {state:observed.state,nativeStatus:observed.nativeStatus,serviceGeneration:connection.generation,
        ...(observed.state === 'confirmed' ? {confirmedAt:new Date().toISOString()} : {})};
    }
  } catch {
    result = {state:'unknown',reason:'Native retention status is unavailable.',serviceGeneration:connection.generation};
  }
  return ports.store.recordRetention(operationId,claimed.revision,result);
}
export async function flushPendingTeamMemory(ports:TeamMemoryPorts,actor:TeamMessageActor,ref:TaskRef,limit=8):Promise<readonly (RetentionOperation|undefined)[]> {
  const count = parse(z.number().int().min(1).max(32),limit);
  const pending = await ports.store.pendingRetentions(actor,ref,count); const results:(RetentionOperation|undefined)[] = [];
  for (const operation of pending) {
    try {results.push(await dispatchRetention(ports,actor,ref,operation.operationId));}
    catch {results.push(undefined);}
  }
  return results;
}
function eligible(view:MemoryView,resolved:ResolvedMemoryScopes,documentId:string):boolean {
  return view.index.documentId === documentId && view.index.version === view.record.version && view.tip.version === view.record.version
    && view.tip.memoryId === view.record.memoryId && (view.tip.state === 'adopted' || view.tip.state === 're-adopted')
    && view.record.sha256 === memoryTextSha256(view.record.text)
    && resolved.scopes.some(entry => JSON.stringify(canonical(entry.scope)) === JSON.stringify(canonical(view.record.scope)));
}
function sameSources(a:readonly MemorySource[],b:readonly MemorySource[]):boolean {
  return a.length === b.length && a.every(source => b.some(other => JSON.stringify(canonical(source)) === JSON.stringify(canonical(other))));
}
/** Native prose selects candidates. Only re-read, source-checked Host text can become context. */
export async function readTeamMemoryContext(ports:TeamMemoryPorts,actor:TeamMessageActor,ref:TaskRef,input:unknown):Promise<TeamMemoryContext> {
  const request = parse(querySchema,input);
  const selection:MemoryTarget|undefined = request.memberId === undefined ? undefined : {kind:'member',memberId:request.memberId};
  const resolved = await resolveMemoryScopes(ports.store,actor,ref,selection);
  const connection = ports.hindsight.connection(); if (!connection) return {records:[],diagnostics:['Memory retrieval is unavailable.']};
  const hits: {documentId:string;text:string;memoryType:string}[] = [];
  const diagnostics:string[] = [];
  for (const entry of resolved.scopes) {
    try {hits.push(...await recallExperience(connection,{bankId:entry.bankId,query:request.query,maxTokens:4096},{fetch:ports.hindsight.fetch,signal:ports.hindsight.signal}));}
    catch {diagnostics.push('Memory retrieval is unavailable.');}
  }
  // Untrusted recall can contain duplicates or unknown documents. Bound source reads separately.
  const documents = [...new Set(hits.map(hit => hit.documentId))].slice(0,32);
  const candidates = await ports.store.candidates(actor,ref,documents);
  const verified:MemoryView[] = [];
  for (const view of candidates.slice(0,32)) {
    if (!documents.includes(view.index.documentId) || !eligible(view,resolved,view.index.documentId)) {diagnostics.push('Memory candidate is not currently applicable.');continue;}
    if (view.record.sources.length === 0) {diagnostics.push('Memory source is unavailable.');continue;}
    try {
      const checked = await ports.sourceReader.verify(actor,ref,view.record.sources);
      if (!sameSources(view.record.sources,checked)) {diagnostics.push('Memory source is unavailable.');continue;}
      verified.push(view);
    } catch {diagnostics.push('Memory source is unavailable.');}
  }
  // Re-authorize and recheck revision after both delayed recall and source byte I/O.
  const currentScopes = await resolveMemoryScopes(ports.store,actor,ref,selection);
  const current = await ports.store.candidates(actor,ref,verified.map(view => view.index.documentId));
  const records:TeamMemoryContext['records'][number][] = [];
  for (const prior of verified) {
    const view = current.find(value => value.record.memoryId === prior.record.memoryId && value.record.version === prior.record.version);
    if (!view || !eligible(view,currentScopes,prior.index.documentId) || view.tip.revision !== prior.tip.revision
      || view.tip.eventId !== prior.tip.eventId || view.record.sha256 !== prior.record.sha256 || !sameSources(prior.record.sources,view.record.sources)) continue;
    const hit = hits.find(value => value.documentId === view.index.documentId);
    if (hit) records.push({...view,appliedConditions:view.tip.conditions,retrieval:{documentId:hit.documentId,excerpt:hit.text.slice(0,4000),label:'retrieval-evidence'}});
    if (records.length === request.limit) break;
  }
  return {records,diagnostics:[...new Set(diagnostics)]};
}
