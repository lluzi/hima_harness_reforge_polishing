import { assertMemberMemoryAdoption, memoryBankId, memoryPayloadDigest, memoryTextSha256, publicRetentionView, parseFeedbackRequest, parseProposalRequest, parseAdoptionRequest, parseCorrectionRequest, type MemoryScope, type MemoryTarget, type MemorySource, type MemoryRecord, type MemoryEvent, type RetentionOperation, type MemoryView, type MemorySourceReader, type TeamMemoryStore, type FeedbackRequest, type AdoptionRequest, type CorrectionRequest } from './team-memory.js';
import { teamMessageDigest, type TaskRef, type TeamMessageActor, type TeamMessageStore, type TeamMessageEnvelope, type TeamMessageDelivery, type TeamReadPage } from './team-messages.js';
import type { TeamAttachmentStore, PersistedAttachmentOriginal, StagedAttachment } from './team-attachments.js';
import type { TeamServiceReceipt } from './team-service-runtime.js';
import { TeamError, teamDefinition, actorGrant, type TeamDefinition, type TeamView, type ActorGrant, type TeamTaskView, type TeamActor, type TeamDefinitionActor, type TeamDefinitionHandoffRequest, type TeamDefinitionHandoffGate, type TeamDefinitionHandoffView } from './team-contract.js';
import { parseTeamGitHubTask } from './team-worktree.js';
import { compileTeamFlow, freezeTeamDelegation } from './flow-compiler.js';
import { bindTeamHumanRequest, validateTeamHumanResponse, type TeamHumanRequest, type TeamHumanResponse, type TeamDelegationAdmission, type TeamDelegationGate, type TeamFlowStore, type TeamWaitAcceptance, type TeamSavedContext, type TeamEffectContinuation, type TeamEffectHead, type TeamResultInput, type TeamFlowContinuationRequest, type FlowStart } from './flow-workflow.js';
import type { TeamDefinitionStore } from './team.js';
import { taskEffectAdapterVersion } from './task-effects.js';
import { teamDelegationInput } from './flow-definition.js';
import { taskMethodDigest } from './task-contract.js';
import { createHash, randomUUID, randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { z } from 'zod';
import type { ClientBase } from 'pg';
import { NodePostgresDataSource } from '@dbos-inc/node-pg-datasource';
import type { LocalDatabaseConnection } from './local-database.js';
import { taskIdentity, taskJsonValue, taskResult, taskToolOutput, validateTaskInput, createTaskResult } from './task-contract.js';
import type { JsonValue, TaskIdentity, TaskResult } from './task-contract.js';
import { flowTaskBranches, flowRevisionConsumers, flowTaskCountsExperiment, flowInvocationKey, flowInvocationRevision, flowRevisionApplies, flowExtensionKey, type CompiledFlow, type FlowBranch, type FrozenFlowFragment, type FlowRevisionRule, type FlowInvocationPath, type FlowExtensionScope } from './flow-definition.js';
import type { ResearchWriteAdmission, ResearchWriteRequest } from './budget.js';
import { humanEffortMeasurement } from './value-measurement.js';
import type { RunRecord } from './ledger.js';
import { migrateRunStore } from './run-store-migrations.js';

function canonical(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key]!)}`).join(',')}}`;
  return JSON.stringify(value);
}
export function jsonDigest(value: unknown): string { return createHash('sha256').update(canonical(taskJsonValue.parse(value))).digest('hex'); }
// Fact namespaces and arbitrary accepted IDs occupy distinct tuple fields, never delimiters.
export function factIdentity(kind: string, ...ids: string[]): string { return `hima-fact:${jsonDigest([kind, ...ids])}`; }
export interface DurableRunOpening {
  readonly runId: string; readonly inputSha256: string; readonly applicationVersion: string;
  readonly owner: string; readonly deadlineAt: string; readonly data: JsonValue;
}
export interface DurableRun {
  engine: 'dbos/5.2.11'; schemaVersion: 1; runId: string; inputSha256: string; applicationVersion: string; opening: DurableRunOpening;
  owner: string; deadlineAt: string; epoch: number; revision: number; hold: string | null; cancelled: boolean;
  holdSource:'human'|'agent'|'unknown'|null;
}
export interface DurableFact { factId: string; runId: string; seq: number; kind: string; payload: JsonValue; at: string }
export interface DurableCommand {
  readonly runId: string; readonly commandId: string; readonly action: 'pause' | 'continue' | 'cancel' | 'handoff' | 'revise' | 'respond';
  readonly owner: string; readonly epoch: number; readonly revision: number; readonly nextOwner?: string;
  readonly origin?:'human'|'agent';
  /** Immutable requester provenance; owner remains the actual current authority stamp. */
  readonly actor?:string;
  readonly scope?: {readonly taskId:string}|{readonly extension:FlowExtensionScope};
  readonly disposition?:'cancelled'|'abandoned';readonly rationale?:string;
  readonly change?: { readonly taskId: string; readonly effectId?: string; readonly input: JsonValue; readonly evidence: JsonValue;readonly additionalEffects?:readonly {readonly taskId:string;readonly effectId:string}[];readonly inputPatches?:readonly {readonly taskId:string;readonly fields:Readonly<Record<string,JsonValue>>}[] };
  readonly response?: { readonly effectId: string; readonly output: import('./task-contract.js').TaskToolOutput; readonly teamRequest?: Pick<TeamHumanResponse,'requestId'|'binding'> };
}
export interface FlowInvocationRecord {
  readonly identity: TaskIdentity; readonly version: number; readonly branches: readonly FlowBranch[];
  /** Frozen interpreter context needed to reconnect original resources, never scheduling state. */
  readonly context: JsonValue; readonly consumedEffects: readonly string[]; readonly consumedVersions: readonly number[];
}
/** Frozen Pack delegation intent. This is retained preparation, never mutable scheduler state. */
export interface PackTeamPlan {
  readonly schema:'hima-pack-team-delegation/1';
  readonly parentIdentity:TaskIdentity;readonly parentInvocationSha256:string;readonly parentOwner:string;
  readonly projectId:string;readonly delegation:NonNullable<CompiledFlow['tasks'][string]['teamDelegation']>;
  readonly requestSha256:string;readonly childTaskId:string;readonly childRunId:string;
  readonly source:Extract<import('./task-contract.js').TaskSource,{kind:'team'}>;
  readonly definition:TeamDefinition;readonly start:FlowStart;readonly deadlineAt:string;
}
export interface PackTeamArtifactAlias {
  readonly name:string;readonly path:string;readonly sha256:string;
  readonly childIdentity:TaskIdentity;readonly childName:string;readonly childPath:string;
  readonly retainedFactId:string;readonly retained:JsonValue;
}
export interface PackTeamSnapshot {
  readonly plan:PackTeamPlan;readonly bindingSha256:string;readonly task:Omit<TeamTaskView,'readiness'>;
  readonly state:'schedulable'|'waiting'|'cancelled';readonly reason?:string;
  readonly result?:TaskResult;readonly childResultSha256?:string;readonly sourceFactId?:string;
  readonly closed:boolean;
}
export interface EffectAdmission {
  readonly runId: string; readonly effectId: string; readonly owner: string; readonly epoch: number; readonly revision: number;
}
export interface EffectResourceClaim {
  readonly siteId: string; readonly jobs: number; readonly licences: Readonly<Record<string, number>>;
}
export interface FlowPhysicalResource {
  readonly effectId:string; readonly identity:TaskIdentity; readonly siteId:string;
  readonly claim:EffectResourceClaim; readonly released:boolean; readonly proof:JsonValue|null;
}
export interface FlowPhysicalEffect {
  readonly identity:TaskIdentity; readonly phase:string; readonly admittedAt:string|null;
  readonly dispatches:readonly {readonly dispatchId:string;readonly inputSha256:string;readonly at:string}[];
}
export type ExternalResearchWriteRequest = ResearchWriteRequest & {readonly callId:string;readonly contentSha256:string};
function mismatch(kind: string): never { throw new Error(`${kind} identity was reused with different input; retain the original identity or start a new invocation`); }
function assertName(name: string): void { if (!name.trim()) throw new Error('A stable nonempty identity is required'); }
const declaredAmount=(amounts:Readonly<Record<string,number>>,name:string)=>Object.hasOwn(amounts,name)?amounts[name]!:0;
const countedInvocation = `(CASE WHEN EXISTS(SELECT 1 FROM hima.team_effect_continuations c WHERE c.successor_effect_id=i.effect_id AND c.run_id=i.run_id) THEN false
  WHEN i.invocation->'context'->'flow'->'tasks'->i.task_id->>'tool'='builtin/human-wait' THEN false
  WHEN i.invocation->'context'->'flow'->>'source'='legacy' THEN COALESCE(i.invocation->'context'->'flow'->'tasks'->i.task_id->'legacy'->>'kind'='act',false)
  ELSE COALESCE(i.invocation->'context'->'flow'->'tasks'->i.task_id->>'budget'<>'closing',true) END)`;
// Same-Run effect ancestry and accepted prior Runs retain operator revocation.
// The business admission transaction holds these actual grant rows through dispatch.
const teamOperatorRevocationSQL = `WITH RECURSIVE ancestry(effect_id) AS (
  SELECT $1::text UNION SELECT d.parent_effect_id FROM hima.flow_derived_effects d
  JOIN ancestry a ON d.child_effect_id=a.effect_id WHERE d.run_id=$2),
  predecessors(run_id) AS (SELECT $2::text UNION SELECT c.previous_run_id
  FROM hima.team_continuation_requests c JOIN predecessors p ON c.current_run_id=p.run_id)
  SELECT g.grant_data FROM hima.task_actor_grants g WHERE
  ((g.grant_data->>'runId'=$2 AND g.grant_data->>'effectId' IN (SELECT effect_id FROM ancestry))
    OR g.grant_data->>'runId' IN (SELECT run_id FROM predecessors WHERE run_id<>$2))
  FOR SHARE OF g`;
const runColumns = `engine, schema_version AS "schemaVersion", run_id AS "runId", input_sha256 AS "inputSha256", application_version AS "applicationVersion", opening,
 owner, deadline_at AS "deadlineAt", epoch, revision, hold, cancelled,hold_source AS "holdSource"`;
function readRun(row: DurableRun): DurableRun { return { ...row, deadlineAt: new Date(row.deadlineAt).toISOString(),holdSource:row.holdSource??(row.hold?'unknown':null) }; }

export function branchContains(parent:readonly FlowBranch[],child:readonly FlowBranch[]):boolean { return parent.length<=child.length && parent.every((branch,index)=>branch.parallelId===child[index]?.parallelId&&branch.branch===child[index]?.branch); }

function invocationPath(record:FlowInvocationRecord):FlowInvocationPath { const context=record.context as unknown as {flow:CompiledFlow;taskId:string;iterations:FlowInvocationPath['iterations'];branches:FlowBranch[];extensions:FlowExtensionScope[]};return {flowSha256:context.flow.irSha256,taskId:context.taskId,iterations:context.iterations,branches:context.branches,extensions:context.extensions??[]}; }

/** Internal physical-proof refusal. DBOS retains name/message across its Error codec;
 * this classification changes no lease, dispatch or stopped-fact truth predicate. */
export class OriginalFlowClosureUnproved extends Error {
  static readonly closureMessage = 'Original resource closure is unproved; retain the original effect and physical proof';
  constructor() { super(OriginalFlowClosureUnproved.closureMessage); this.name = 'OriginalFlowClosureUnproved'; }
}

class FlowEffectNotCurrent extends Error {}
function memberInputProjection(input:JsonValue,label='Retained controlled task input'):{text:string;redacted:boolean;truncated:boolean} {
  let redacted=false;
  const hide=(value:JsonValue,key=''):JsonValue=>{
    if(/secret|password|credential|authorization|token|api[-_]?key|private[-_]?key|socket|environment|connection/i.test(key)) {redacted=true;return '[credential redacted]';}
    if(typeof value==='string') {
      if(/^(?:\/|[A-Za-z]:[\\/])/.test(value)) {redacted=true;return '[local path redacted]';}
      const safe=value.replace(/(Bearer\s+)[^\s]+/gi,'$1[redacted]').replace(/([?&](?:token|api_key|password)=)[^&\s]+/gi,'$1[redacted]')
        .replace(/(^|[\s"'`(=:\[])(\/(?!\/)[^\s"'`<>(){}\[\],;]+|[A-Za-z]:[\\/][^\s"'`<>(){}\[\],;]+|\\\\[^\s"'`<>(){}\[\],;]+)/gu,'$1[local path redacted]');
      if(safe!==value)redacted=true;return safe;
    }
    if(Array.isArray(value))return value.map(item=>hide(item));
    if(value!==null&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([name,item])=>[name,hide(item,name)]));
    return value;
  };
  const body=JSON.stringify(hide(input));const truncated=body.length>2400;
  return {text:`${label}: ${body.slice(0,2400)}${truncated?' [input excerpt truncated]':''}.`,redacted,truncated};
}

/** Exact private Host continuation input; adapters consume the frozen hostPrompt unchanged. */
export function teamContinuationPrompt(input:{readonly identity:TaskIdentity;readonly instructions:string;readonly skills:readonly string[];readonly contract:JsonValue;readonly context:TeamSavedContext;readonly inputs:readonly TeamResultInput[];readonly requestedDelegationIds?:readonly string[];readonly deadlineAt:string}):string {
  const output=input.contract as unknown as {output:{version:string;schema:JsonValue}};
  const context=input.context.kind==='reconstruction'?{kind:'reconstruction',sha256:input.context.sha256,reason:input.context.reason,context:input.context.context}
    :{kind:'native-checkpoint',sha256:input.context.checkpoint.sha256,nativeSession:input.context.checkpoint.origin.nativeSession};
  const body={schema:'hima-team-continuation-input/1',identity:input.identity,deadlineAt:input.deadlineAt,context,childResults:input.inputs,...(input.requestedDelegationIds?{requestedDelegationIds:input.requestedDelegationIds}:{}),
    deliveryContract:output.output,envelopeSchema:z.toJSONSchema(taskToolOutput,{unrepresentable:'any'}),
    artifactIdentity:{runId:input.identity.runId,taskId:input.identity.taskId,effectId:input.identity.effectId}};
  return `${input.instructions}\nNative Skills selected: ${input.skills.join(', ')}\n\nHost result continuation (JSON):\n${JSON.stringify(body)}\nContinue the same logical task from the retained context and committed child results. Previously submitted engineering work is retained; do not resubmit it to recover a receipt. Reconstruction is explicitly identified above when native context is unavailable. Return only the TaskToolOutput JSON envelope. Set schemaVersion to ${JSON.stringify(output.output.version)}. Every artifact must use the new artifactIdentity above, a relative work-directory path, and the SHA256 of its actual bytes. Empty artifacts and diagnostics are [].`;
}

export class RunStore {
  readonly #pool: Pool;
  readonly #source: NodePostgresDataSource;
  constructor(connection: LocalDatabaseConnection, source: NodePostgresDataSource, readonly applicationVersion: string) {
    this.#pool = new Pool({ ...connection, connectionTimeoutMillis: 2000, statement_timeout: 5000 });
    this.#pool.on('error', () => { /* Idle socket failures are surfaced by the next authoritative query. */ });
    this.#source = source;
  }
  /** Messaging/materials share the existing application transaction and control authority. */
  private async workspaceAccess(client:ClientBase,actor:TeamMessageActor,ref:TaskRef,capability:'read-task'|'send-message'|'read-material'|'query-memory'|'adopt-memory'|'delegate'|'github-push'|'github-pr',writing=false) {
    if(writing)await this.#assertHostAdmission(client);
    else await client.query('SELECT singleton FROM hima.host_exit WHERE singleton=true FOR SHARE');
    const task=(await client.query<{task:Omit<TeamTaskView,'readiness'>}>('SELECT task FROM hima.team_tasks WHERE project_id=$1 AND team_id=$2 AND task_id=$3',[ref.projectId,ref.teamId,ref.taskId])).rows[0]?.task;
    if(!task)throw new TeamError('hima/not-authorized','Task is unavailable in the authenticated project.');
    const run=await this.#run(client,task.currentRunId,true);
    const stable=(await client.query<{task:TeamTaskView}>('SELECT task FROM hima.team_tasks WHERE task_id=$1 FOR SHARE',[task.taskId])).rows[0]?.task;
    if(!stable||jsonDigest(stable)!==jsonDigest(task))throw new TeamError('hima/team-conflict','Team task current Run changed during access.');
    const definition=(run.opening.data as unknown as {definition:TeamDefinition}).definition;
    if(actor.kind==='member') {
      const persisted=(await client.query<{grant_data:ActorGrant}>('SELECT grant_data FROM hima.task_actor_grants WHERE grant_id=$1 FOR SHARE',[actor.grant.grantId])).rows[0]?.grant_data;
      const grant=persisted&&actorGrant.parse(persisted);
      const invocation=(await client.query<{invocation:FlowInvocationRecord}>('SELECT invocation FROM hima.flow_invocations WHERE run_id=$1 AND effect_id=$2',[run.runId,actor.grant.effectId])).rows[0]?.invocation;
      const host=(await client.query<{active_request:string|null}>('SELECT active_request FROM hima.host_exit WHERE singleton=true')).rows[0];
      if(!grant||jsonDigest(grant)!==jsonDigest(actor.grant)||grant.projectId!==ref.projectId||grant.teamId!==ref.teamId||grant.taskId!==ref.taskId||grant.runId!==run.runId||grant.actorId!==grant.memberId||!definition.members.some(member=>member.id===grant.memberId)||!invocation||(invocation.context as unknown as {flow:CompiledFlow}).flow.tasks[invocation.identity.taskId]?.memberId!==grant.memberId||grant.revokedAt||Date.now()>=Date.parse(grant.expiresAt)||Date.now()>=Date.parse(run.deadlineAt)||grant.generation!==run.epoch||run.cancelled||run.hold||host?.active_request||!grant.capabilities.includes(capability))throw new TeamError('hima/not-authorized','A current capability for this task, effect, member and generation is required.');
      if(!await this.workspaceEffectCurrent(client,run,grant.effectId))throw new TeamError('hima/not-authorized','The granted member effect is held, stopped or superseded.');
    } else {
      if(actor.projectId!==ref.projectId||!actor.actorId)throw new TeamError('hima/not-authorized','The Host actor belongs to another project.');
      if(actor.kind==='human') {
        const operator=(await client.query<{actor_id:string}>('SELECT actor_id FROM hima.host_operator WHERE singleton=true')).rows[0];
        if(operator?.actor_id!==actor.actorId)throw new TeamError('hima/not-authorized','The Host operator identity is required.');
      }
    }
    return {task,run,definition,sender:actor.kind==='member'?{kind:'member' as const,actorId:actor.grant.actorId,memberId:actor.grant.memberId,runId:actor.grant.runId,effectId:actor.grant.effectId,generation:actor.grant.generation}:{kind:actor.kind,actorId:actor.actorId}};
  }
  private async workspaceEffectCurrent(client:ClientBase,run:DurableRun,effectId:string):Promise<boolean> {
    try {await this.#assertFlowEffectCurrent(client,run,effectId);return true;}
    catch(error) {if(error instanceof FlowEffectNotCurrent)return false;throw error;}
  }
  /** Memory remains application facts; Hindsight receives immutable projections only. */
  private memoryVisible(actor:TeamMessageActor,scope:MemoryScope,ref:TaskRef):boolean {
    return scope.projectId===ref.projectId&&scope.teamId===ref.teamId
      &&(actor.kind!=='member'||scope.kind!=='member'||scope.memberId===actor.grant.memberId);
  }
  private async memoryView(client:ClientBase,memoryId:string,event?:MemoryEvent,version?:number):Promise<MemoryView> {
    const tip=event??(await client.query<{event:MemoryEvent}>('SELECT event FROM hima.team_memory_events WHERE memory_id=$1 ORDER BY revision DESC LIMIT 1',[memoryId])).rows[0]?.event;
    if(!tip)throw new TeamError('hima/not-found','Memory is unavailable.');
    const record=(await client.query<{record:MemoryRecord}>('SELECT record FROM hima.team_memory_records WHERE memory_id=$1 AND version=$2',[memoryId,version??tip.version])).rows[0]?.record;
    const operation=(await client.query<{operation:RetentionOperation}>('SELECT operation FROM hima.team_memory_index_operations WHERE memory_id=$1 AND version=$2',[memoryId,version??tip.version])).rows[0]?.operation;
    if(!record||!operation)throw new TeamError('hima/not-found','Retained memory version is unavailable.');
    return {record,tip,index:publicRetentionView(operation)};
  }
  private async verifyMemorySources(client:ClientBase,actor:TeamMessageActor,ref:TaskRef,sources:readonly MemorySource[]):Promise<void> {
    for(const source of sources) {
      if(source.kind==='feedback') {
        const view=(await client.query<{record:MemoryRecord;event:MemoryEvent}>(`SELECT r.record,e.event FROM hima.team_memory_events e JOIN hima.team_memory_records r ON r.memory_id=e.memory_id AND r.version=e.version WHERE e.event_id=$1`,[source.eventId])).rows[0];
        if(!view||!['feedback','corrected'].includes(view.event.event)||view.event.actor.kind!=='human'||!this.memoryVisible(actor,view.record.scope,ref)||view.record.sha256!==source.sha256||memoryTextSha256(view.record.text)!==source.sha256)throw new TeamError('hima/not-authorized','Feedback source is unavailable or changed.');
        const current=(await client.query<{event:MemoryEvent}>('SELECT event FROM hima.team_memory_events WHERE memory_id=$1 ORDER BY revision DESC LIMIT 1',[view.record.memoryId])).rows[0]?.event;
        if(!current||current.version!==view.record.version||current.state==='disabled')throw new TeamError('hima/not-authorized','Feedback source was corrected or withdrawn.');
      } else if(source.kind==='material') {
        const row=(await client.query<{original:PersistedAttachmentOriginal;staged:StagedAttachment}>(`SELECT a.original,a.staged FROM hima.team_attachments a JOIN hima.team_tasks t ON t.task_id=a.task_id WHERE a.stage_id=$1 AND a.task_id=$2 AND a.project_id=$3 AND t.team_id=$4
          AND EXISTS(SELECT 1 FROM hima.team_material_links l WHERE l.task_id=a.task_id AND l.stage_id=a.stage_id AND ($5::text IS NULL OR l.member_ids ? $5))`,[source.stageId,source.taskId,ref.projectId,ref.teamId,actor.kind==='member'?actor.grant.memberId:null])).rows[0];
        if(!row||row.staged.material.materialId!==source.materialId||row.original.sha256!==source.sha256||row.original.bytes!==source.bytes)throw new TeamError('hima/not-authorized','Linked material source is unavailable or changed.');
      } else if(source.kind==='artifact') {
        const row=(await client.query<{result:TaskResult;invocation:FlowInvocationRecord}>(`SELECT r.result,i.invocation FROM hima.results r JOIN hima.flow_invocations i ON i.effect_id=r.effect_id JOIN hima.team_tasks t ON t.task_id=$1 AND t.project_id=$2 AND t.team_id=$3 WHERE r.effect_id=$4 AND r.run_id=$5 AND t.task->'runIds' ? r.run_id`,[source.taskId,ref.projectId,ref.teamId,source.effectId,source.runId])).rows[0];
        if(!row||(actor.kind==='member'&&(row.invocation.context as unknown as {flow:CompiledFlow}).flow.tasks[row.invocation.identity.taskId]?.memberId!==actor.grant.memberId))throw new TeamError('hima/not-authorized','Committed artifact source is unavailable to this member.');
        const artifact=row.result.artifacts?.find(asset=>asset.name===source.name);
        if(!artifact||artifact.sha256!==source.sha256)throw new TeamError('hima/not-authorized','Committed artifact identity changed.');
      } else {
        // Exact archive bytes and project authority are checked by the existing archive reader in Host.
        // Members may use only archives from their retained Team lineage, never arbitrary project Runs.
        if(actor.kind==='member') {
          const available=await client.query(`SELECT 1 FROM hima.team_tasks WHERE project_id=$1 AND team_id=$2 AND task->'runIds' ? $3`,[ref.projectId,ref.teamId,source.runId]);
          if(!available.rowCount)throw new TeamError('hima/not-authorized','Archive is outside this member Team lineage.');
        }
      }
    }
  }
  private async memoryAdoptionSources(client:ClientBase,view:MemoryView,reAdopt:boolean):Promise<readonly MemorySource[]> {
    if(!reAdopt||view.record.kind!=='feedback')return view.record.sources;
    if(memoryTextSha256(view.record.text)!==view.record.sha256)throw new TeamError('hima/not-authorized','Immutable feedback content changed.');
    const own=(await client.query<{event_id:string}>("SELECT event_id FROM hima.team_memory_events WHERE memory_id=$1 AND version=$2 AND event->>'event' IN ('feedback','corrected') AND event->'actor'->>'kind'='human'",[view.record.memoryId,view.record.version])).rows.map(row=>row.event_id);
    // Its own withdrawn human fact is the target of explicit re-adoption, not an external
    // dependency. New evidence is still mandatory; all other source dependencies stay checked.
    return view.record.sources.filter(source=>!(source.kind==='feedback'&&source.sha256===view.record.sha256&&own.includes(source.eventId)));
  }
  /** Authenticated source descriptors for Host byte checking, including prior tasks without forging old grants. */
  async memorySources(actor:TeamMessageActor,ref:TaskRef,sources:readonly MemorySource[]):Promise<readonly {source:MemorySource;original?:PersistedAttachmentOriginal}[]> {
    return this.transaction(async client=>{
      await this.workspaceAccess(client,actor,ref,'query-memory');await this.verifyMemorySources(client,actor,ref,sources);
      const result: {source:MemorySource;original?:PersistedAttachmentOriginal}[]=[];
      for(const source of sources) {
        const original=source.kind==='material'?(await client.query<{original:PersistedAttachmentOriginal}>('SELECT original FROM hima.team_attachments WHERE stage_id=$1',[source.stageId])).rows[0]?.original:undefined;
        result.push({source,...(original?{original}:{})});
      }
      return result;
    },'hima.memorySources');
  }
  teamMemory(sourceReader:MemorySourceReader):TeamMemoryStore {
    const resolveScope=(actor:TeamMessageActor,ref:TaskRef,target:MemoryTarget,definition:TeamDefinition):MemoryScope=>{
      if(target.kind==='member'&&(!target.memberId||!definition.members.some(member=>member.id===target.memberId)))throw new TeamError('hima/not-authorized','Memory member is absent from this frozen Team.');
      const scope:MemoryScope={projectId:ref.projectId,teamId:ref.teamId,...target};
      if(!this.memoryVisible(actor,scope,ref))throw new TeamError('hima/not-authorized','Memory is private to another member.');return scope;
    };
    const mutate=async(actor:TeamMessageActor,ref:TaskRef,action:'feedback'|'proposed'|'adopted'|'disabled'|'re-adopted'|'corrected',request:FeedbackRequest|AdoptionRequest|CorrectionRequest):Promise<MemoryView>=>{
      if(action!=='proposed'&&actor.kind!=='human'&&!(action==='adopted'&&actor.kind==='member'))throw new TeamError('hima/not-authorized','This memory change requires the authenticated human.');
      const capability=action==='adopted'&&actor.kind==='member'?'adopt-memory':'query-memory';
      const sources='sources' in request?request.sources:[];
      const evidence='evidenceRefs' in request?request.evidenceRefs:[];
      // Replays are retained facts, not new adoption. Resolve auth/replay/CAS before reading
      // potentially unavailable historical bytes; the committing transaction rechecks them.
      const replay=await this.transaction(async client=>{
        const access=await this.workspaceAccess(client,actor,ref,capability,true);
        const prior='memoryId' in request?await this.memoryView(client,request.memoryId):undefined;
        const scope=prior?.record.scope??resolveScope(actor,ref,(request as FeedbackRequest).target,access.definition);
        if(!this.memoryVisible(actor,scope,ref))throw new TeamError('hima/not-authorized','Memory is outside this task scope.');
        const digest=memoryPayloadDigest(action,request,access.sender,scope,ref);
        const retained=(await client.query<{event:MemoryEvent;digest:string}>('SELECT event,digest FROM hima.team_memory_events WHERE project_id=$1 AND team_id=$2 AND request_id=$3',[ref.projectId,ref.teamId,request.requestId])).rows[0];
        if(retained) {
          if(retained.digest!==digest)throw new TeamError('hima/team-conflict','Memory request already names different content or authority.');
          return this.memoryView(client,retained.event.memoryId,retained.event);
        }
        if(action==='adopted')assertMemberMemoryAdoption(actor,prior,access.definition);
        if(prior&&'expectedVersion' in request&&(prior.record.version!==request.expectedVersion||prior.tip.revision!==request.expectedRevision||prior.tip.eventId!==request.supersedesEventId))throw new TeamError('hima/team-conflict','Memory changed; read its current version before changing adoption.');
        return undefined;
      },'hima.preflightTeamMemory');
      if(replay)return replay;
      await sourceReader.verify(actor,ref,[...sources,...evidence]);
      if('memoryId' in request&&['adopted','re-adopted'].includes(action)) {
        const current=await read(actor,ref,request.memoryId);
        const dependencies=await this.transaction(client=>this.memoryAdoptionSources(client,current,action==='re-adopted'),'hima.readMemoryAdoptionSources');
        await sourceReader.verify(actor,ref,dependencies);
      }
      return this.transaction(async client=>{
        const access=await this.workspaceAccess(client,actor,ref,capability,true);
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`memory-request:${ref.projectId}:${ref.teamId}:${request.requestId}`]);
        const priorRequest=(await client.query<{event:MemoryEvent;digest:string}>('SELECT event,digest FROM hima.team_memory_events WHERE project_id=$1 AND team_id=$2 AND request_id=$3',[ref.projectId,ref.teamId,request.requestId])).rows[0];
        let prior:MemoryView|undefined;
        if('memoryId' in request) {
          await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`memory:${request.memoryId}`]);
          prior=await this.memoryView(client,request.memoryId);
          if(!this.memoryVisible(actor,prior.record.scope,ref))throw new TeamError('hima/not-authorized','Memory is outside this task scope.');
        }
        const scope=prior?.record.scope??resolveScope(actor,ref,(request as FeedbackRequest).target,access.definition);
        const digest=memoryPayloadDigest(action,request,access.sender,scope,ref);
        if(priorRequest) {
          if(priorRequest.digest!==digest)throw new TeamError('hima/team-conflict','Memory request already names different content or authority.');
          return this.memoryView(client,priorRequest.event.memoryId,priorRequest.event);
        }
        if(action==='adopted')assertMemberMemoryAdoption(actor,prior,access.definition);
        if(prior&&'expectedVersion' in request&&(prior.record.version!==request.expectedVersion||prior.tip.revision!==request.expectedRevision||prior.tip.eventId!==request.supersedesEventId))throw new TeamError('hima/team-conflict','Memory changed; read its current version before changing adoption.');
        await this.verifyMemorySources(client,actor,ref,[...sources,...evidence]);
        if(prior&&['adopted','re-adopted'].includes(action))await this.verifyMemorySources(client,actor,ref,await this.memoryAdoptionSources(client,prior,action==='re-adopted'));
        if(action==='adopted'&&prior?.tip.state!=='candidate')throw new TeamError('hima/team-conflict','First adoption requires the current candidate; disabled records require new evidence and re-adoption.');
        if(action==='re-adopted') {
          if(prior?.tip.state!=='disabled')throw new TeamError('hima/team-conflict','Re-adoption requires a disabled record.');
          let fresh=false;
          for(const source of evidence)if(source.kind==='feedback') {
            const row=(await client.query<{seq:string}>('SELECT seq::text FROM hima.team_memory_events WHERE event_id=$1',[source.eventId])).rows[0];
            const old=(await client.query<{seq:string}>('SELECT seq::text FROM hima.team_memory_events WHERE event_id=$1',[prior.tip.eventId])).rows[0];
            if(row&&old&&BigInt(row.seq)>BigInt(old.seq))fresh=true;
          }
          if(!fresh)throw new TeamError('hima/team-conflict','Re-adoption needs newly verified feedback after the disable.');
        }
        const memoryId=prior?.record.memoryId??`memory-${randomUUID()}`,eventId=`memory-event-${randomUUID()}`,createdAt=new Date().toISOString();
        const newContent=!prior||action==='corrected',version=(prior?.record.version??0)+(newContent?1:0),revision=(prior?.tip.revision??0)+1;
        const state:MemoryEvent['state']=action==='feedback'||action==='proposed'||action==='corrected'?'candidate':action;
        const text=newContent?(request as FeedbackRequest|CorrectionRequest).text:prior!.record.text,sha256=memoryTextSha256(text);
        const ownSource:MemorySource={kind:'feedback',eventId,sha256};
        const record:MemoryRecord=newContent?{schemaVersion:1,memoryId,version,scope,sourceTaskId:ref.taskId,sourceRunId:access.run.runId,team:access.task.team,
          kind:action==='proposed'?'experience':'feedback',text,sha256,conditions:request.conditions,sources:action==='proposed'?sources:action==='corrected'?[ownSource]:[...sources,ownSource],createdAt,createdBy:access.sender,
          ...(prior?{supersedesVersion:prior.record.version}:{})}:prior!.record;
        const event:MemoryEvent={schemaVersion:1,eventId,requestId:request.requestId,payloadSha256:digest,memoryId,version,revision,event:action,state,
          actor:access.sender,taskId:ref.taskId,runId:access.run.runId,createdAt,reason:request.reason,evidenceRefs:action==='corrected'?[...evidence,...sources]:evidence,conditions:request.conditions,
          ...(prior?{supersedesEventId:prior.tip.eventId,...(newContent?{supersedesVersion:prior.record.version}:{})}:{})};
        if(newContent) {
          await client.query('INSERT INTO hima.team_memory_records(memory_id,version,project_id,team_id,scope_kind,member_id,record) VALUES($1,$2,$3,$4,$5,$6,$7)',[memoryId,version,ref.projectId,ref.teamId,scope.kind,scope.memberId??null,JSON.stringify(record)]);
          const operationId=randomUUID(),documentId=`hima-memory-${memoryId}-v${version}`,bankId=memoryBankId(scope);
          const operation:RetentionOperation={schemaVersion:1,operationId,memoryId,version,adoptionRevision:revision,documentId,contentSha256:sha256,
            payloadSha256:jsonDigest({operationId,bankId,documentId,text,sha256,version,memoryId}),bankId,state:'pending',revision:0,createdAt,updatedAt:createdAt};
          await client.query('INSERT INTO hima.team_memory_index_operations(operation_id,memory_id,version,bank_id,document_id,payload_sha256,revision,operation) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[operationId,memoryId,version,bankId,documentId,operation.payloadSha256,operation.revision,JSON.stringify(operation)]);
        }
        await client.query('INSERT INTO hima.team_memory_events(event_id,project_id,team_id,memory_id,version,revision,request_id,digest,event) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[eventId,ref.projectId,ref.teamId,memoryId,version,revision,request.requestId,digest,JSON.stringify(event)]);
        return this.memoryView(client,memoryId,event);
      },'hima.changeTeamMemory');
    };
    const read=async(actor:TeamMessageActor,ref:TaskRef,memoryId:string,version?:number):Promise<MemoryView>=>this.transaction(async client=>{
      await this.workspaceAccess(client,actor,ref,'query-memory');const view=await this.memoryView(client,memoryId,undefined,version);
      if(!this.memoryVisible(actor,view.record.scope,ref))throw new TeamError('hima/not-authorized','Memory is outside this task scope.');return view;
    },'hima.readTeamMemoryRecord');
    return {
      resolve:(actor,ref,target)=>this.transaction(async client=>{
        const access=await this.workspaceAccess(client,actor,ref,'query-memory');
        const targets:MemoryTarget[]=target?(target.kind==='member'?[{kind:'project'},{kind:'team'},target]:[target]):[{kind:'project'},{kind:'team'},...(actor.kind==='member'?[{kind:'member' as const,memberId:actor.grant.memberId}]:access.definition.members.map(member=>({kind:'member' as const,memberId:member.id})))];
        return {scopes:targets.map(target=>{const scope=resolveScope(actor,ref,target,access.definition);return {scope,bankId:memoryBankId(scope)};})};
      },'hima.resolveTeamMemoryScopes'),
      commitFeedback:(actor,ref,raw)=>mutate(actor,ref,'feedback',parseFeedbackRequest(raw)),
      commitProposal:(actor,ref,raw)=>mutate(actor,ref,'proposed',parseProposalRequest(raw)),
      changeAdoption:(actor,ref,raw)=>{const request=parseAdoptionRequest(raw);return mutate(actor,ref,request.action,request);},
      correct:(actor,ref,raw)=>mutate(actor,ref,'corrected',parseCorrectionRequest(raw)),
      record:read,
      read:(actor,ref,page)=>this.transaction(async client=>{
        await this.workspaceAccess(client,actor,ref,'query-memory');
        const rows=(await client.query<{seq:string;event:MemoryEvent}>(`SELECT e.seq::text,e.event FROM hima.team_memory_events e JOIN hima.team_memory_records r ON r.memory_id=e.memory_id AND r.version=e.version
          WHERE e.project_id=$1 AND e.team_id=$2 AND e.seq>$3 AND NOT EXISTS(SELECT 1 FROM hima.team_memory_events newer WHERE newer.memory_id=e.memory_id AND newer.revision>e.revision)
          AND ($4::text IS NULL OR r.scope_kind<>'member' OR r.member_id=$4) ORDER BY e.seq LIMIT $5`,[ref.projectId,ref.teamId,page.cursor??0,actor.kind==='member'?actor.grant.memberId:null,page.limit+1])).rows;
        const records=[];for(const row of rows.slice(0,page.limit))records.push(await this.memoryView(client,row.event.memoryId,row.event));
        return {records,...(rows.length>page.limit?{nextCursor:Number(rows[page.limit-1]!.seq)}:{})};
      },'hima.listTeamMemory'),
      candidates:(actor,ref,documents)=>this.transaction(async client=>{
        await this.workspaceAccess(client,actor,ref,'query-memory');
        const rows=(await client.query<{memory_id:string;version:number}>(`SELECT o.memory_id,o.version FROM hima.team_memory_index_operations o JOIN hima.team_memory_records r ON r.memory_id=o.memory_id AND r.version=o.version WHERE o.document_id=ANY($1) AND r.project_id=$2 AND r.team_id=$3 AND ($4::text IS NULL OR r.scope_kind<>'member' OR r.member_id=$4)`,[documents,ref.projectId,ref.teamId,actor.kind==='member'?actor.grant.memberId:null])).rows;
        const records=[];
        for(const row of rows) {
          const view=await this.memoryView(client,row.memory_id,undefined,row.version);
          try {await this.verifyMemorySources(client,actor,ref,view.record.sources);records.push(view);}
          catch(error) {if(!(error instanceof TeamError)||error.code!=='hima/not-authorized')throw error;}
        }
        return records;
      },'hima.teamMemoryCandidates'),
      claimRetention:(actor,ref,operationId,expectedRevision)=>this.transaction(async client=>{
        await this.workspaceAccess(client,actor,ref,'query-memory',true);
        const operation=(await client.query<{operation:RetentionOperation}>('SELECT operation FROM hima.team_memory_index_operations WHERE operation_id=$1 FOR UPDATE',[operationId])).rows[0]?.operation;
        if(!operation||operation.revision!==expectedRevision||['confirmed','failed'].includes(operation.state))return undefined;
        const view=await this.memoryView(client,operation.memoryId,undefined,operation.version);
        if(!this.memoryVisible(actor,view.record.scope,ref))throw new TeamError('hima/not-authorized','Index intent belongs to another memory scope.');
        if(view.tip.version!==operation.version||view.tip.state==='disabled')return undefined;
        await this.verifyMemorySources(client,actor,ref,view.record.sources);
        if(operation.contentSha256!==view.record.sha256||operation.bankId!==memoryBankId(view.record.scope)||operation.documentId!==`hima-memory-${operation.memoryId}-v${operation.version}`||operation.payloadSha256!==jsonDigest({operationId:operation.operationId,bankId:operation.bankId,documentId:operation.documentId,text:view.record.text,sha256:operation.contentSha256,version:operation.version,memoryId:operation.memoryId}))throw new TeamError('hima/team-conflict','Immutable index identity changed.');
        const next:RetentionOperation={...operation,state:'unknown',revision:operation.revision+1,updatedAt:new Date().toISOString()};
        await client.query('UPDATE hima.team_memory_index_operations SET revision=$2,operation=$3 WHERE operation_id=$1',[operationId,next.revision,JSON.stringify(next)]);return next;
      },'hima.claimMemoryRetention'),
      recordRetention:(operationId,expectedRevision,result)=>this.transaction(async client=>{
        const operation=(await client.query<{operation:RetentionOperation}>('SELECT operation FROM hima.team_memory_index_operations WHERE operation_id=$1 FOR UPDATE',[operationId])).rows[0]?.operation;
        if(!operation)throw new TeamError('hima/not-found','Original retention intent is unavailable.');
        if(operation.revision!==expectedRevision)return operation;
        const next:RetentionOperation={...operation,...result,revision:operation.revision+1,updatedAt:new Date().toISOString()};
        await client.query('UPDATE hima.team_memory_index_operations SET revision=$2,operation=$3 WHERE operation_id=$1',[operationId,next.revision,JSON.stringify(next)]);return next;
      },'hima.recordMemoryRetention'),
      readOperation:async operationId=>(await this.#pool.query<{operation:RetentionOperation}>('SELECT operation FROM hima.team_memory_index_operations WHERE operation_id=$1',[operationId])).rows[0]?.operation,
      readRetention:async(actor,ref,memoryId)=>(await read(actor,ref,memoryId)).index,
      pendingRetentions:(actor,ref,limit)=>this.transaction(async client=>{
        await this.workspaceAccess(client,actor,ref,'query-memory');
        return (await client.query<{operation:RetentionOperation}>(`SELECT o.operation FROM hima.team_memory_index_operations o JOIN hima.team_memory_records r ON r.memory_id=o.memory_id AND r.version=o.version
          WHERE o.operation->>'state' IN ('pending','unknown','submitted') AND r.project_id=$1 AND r.team_id=$2 AND ($3::text IS NULL OR r.scope_kind<>'member' OR r.member_id=$3)
          AND EXISTS(SELECT 1 FROM hima.team_memory_events e WHERE e.memory_id=r.memory_id AND e.version=r.version AND e.event->>'state'<>'disabled' AND NOT EXISTS(SELECT 1 FROM hima.team_memory_events later WHERE later.memory_id=e.memory_id AND later.revision>e.revision))
          ORDER BY o.operation->>'createdAt' LIMIT $4`,[ref.projectId,ref.teamId,actor.kind==='member'?actor.grant.memberId:null,limit])).rows.map(row=>row.operation);
      },'hima.pendingTeamMemory'),
      correctionsAfter:(actor,ref,cursor,limit)=>this.transaction(async client=>{
        await this.workspaceAccess(client,actor,ref,'query-memory');
        const rows=(await client.query<{seq:string;event:MemoryEvent}>(`SELECT e.seq::text,e.event FROM hima.team_memory_events e JOIN hima.team_memory_records r ON r.memory_id=e.memory_id AND r.version=e.version WHERE e.project_id=$1 AND e.team_id=$2 AND e.seq>$3 AND e.event->>'event' IN ('corrected','disabled','adopted','re-adopted') AND ($4::text IS NULL OR r.scope_kind<>'member' OR r.member_id=$4) ORDER BY e.seq LIMIT $5`,[ref.projectId,ref.teamId,cursor,actor.kind==='member'?actor.grant.memberId:null,limit+1])).rows;
        return {events:rows.slice(0,limit).map(row=>row.event),...(rows.length>limit?{nextCursor:Number(rows[limit-1]!.seq)}:{})};
      },'hima.teamMemoryCorrections'),
    };
  }
  teamAttachments():TeamAttachmentStore {
    const load=async(client:ClientBase,actor:TeamMessageActor,ref:TaskRef,stageId:string,linked:boolean)=>{
      const scope=await this.workspaceAccess(client,actor,ref,linked?'read-material':'send-message');
      const row=(await client.query<{original:PersistedAttachmentOriginal;staged:StagedAttachment;actor_id:string;removed:boolean}>('SELECT original,staged,actor_id,removed FROM hima.team_attachments WHERE stage_id=$1 AND project_id=$2 AND task_id=$3',[stageId,ref.projectId,ref.taskId])).rows[0];
      if(!row)throw new TeamError('hima/not-authorized','Material is unavailable in this task.');
      if(linked) {
        const member=scope.sender.memberId??null;
        const allowed=await client.query('SELECT 1 FROM hima.team_material_links WHERE task_id=$1 AND stage_id=$2 AND ($3::text IS NULL OR member_ids ? $3)',[ref.taskId,stageId,member]);
        if(!allowed.rowCount)throw new TeamError('hima/not-authorized','This original has not been sent to an authorized task member.');
      } else if(row.actor_id!==scope.sender.actorId)throw new TeamError('hima/not-authorized','The draft belongs to another actor.');
      return row;
    };
    return {
      listStages:(actor,ref)=>this.transaction(async client=>{
        const scope=await this.workspaceAccess(client,actor,ref,'read-task');
        const rows=(await client.query<{staged:StagedAttachment;draft:boolean}>(`SELECT a.staged,NOT EXISTS(SELECT 1 FROM hima.team_material_links l WHERE l.task_id=a.task_id AND l.stage_id=a.stage_id) AS draft FROM hima.team_attachments a
          WHERE a.task_id=$1 AND ((a.actor_id=$2 AND NOT a.removed) OR EXISTS(SELECT 1 FROM hima.team_material_links l WHERE l.task_id=a.task_id AND l.stage_id=a.stage_id AND ($3::text IS NULL OR l.member_ids ? $3))) ORDER BY a.stage_id LIMIT 100`,[ref.taskId,scope.sender.actorId,scope.sender.memberId??null])).rows;
        return {materials:rows.map(row=>row.staged),draftStageIds:rows.filter(row=>row.draft).map(row=>row.staged.stageId)};
      },'hima.listTaskMaterials'),
      saveOriginal:(actor,request,original)=>this.transaction(async client=>{
        const scope=await this.workspaceAccess(client,actor,request,'send-message',true);
        const digest=jsonDigest({original,sender:scope.sender});
        const stageId=`material-${randomUUID()}`;
        const staged:StagedAttachment={stageId,material:{materialId:stageId,sha256:original.sha256,bytes:original.bytes,mediaType:original.mediaType,origin:'verbatim',state:'saved',source:original.fileRef.name},parser:{status:'failed',revision:'hima-task-document/1',warnings:['Parsing has not completed; the original is retained.'],chunks:[]}};
        await client.query('INSERT INTO hima.team_attachments(stage_id,task_id,project_id,actor_id,request_id,digest,original,staged) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING',[stageId,request.taskId,request.projectId,scope.sender.actorId,request.requestId,digest,JSON.stringify(original),JSON.stringify(staged)]);
        const held=(await client.query<{digest:string;original:PersistedAttachmentOriginal}>('SELECT digest,original FROM hima.team_attachments WHERE task_id=$1 AND actor_id=$2 AND request_id=$3 FOR UPDATE',[request.taskId,scope.sender.actorId,request.requestId])).rows[0];
        if(held?.digest!==digest)throw new TeamError('hima/team-conflict','This stage request already names different original bytes.');
        return held.original;
      },'hima.saveTaskOriginal'),
      stage:(actor,request,value)=>this.transaction(async client=>{
        const scope=await this.workspaceAccess(client,actor,request,'send-message',true);
        const held=(await client.query<{original:PersistedAttachmentOriginal;staged:StagedAttachment;parser_completed:boolean}>('SELECT original,staged,parser_completed FROM hima.team_attachments WHERE task_id=$1 AND actor_id=$2 AND request_id=$3 FOR UPDATE',[request.taskId,scope.sender.actorId,request.requestId])).rows[0];
        if(!held||jsonDigest(held.original)!==jsonDigest(value.original))throw new TeamError('hima/team-conflict','The saved original does not match this parser result.');
        // A completed parser revision is immutable. Retrying a failed/incomplete parse can publish once.
        if(held.parser_completed)return held.staged;
        const state=value.parser.status==='parsed'?'parsed':value.parser.status==='partial'?'partial':value.parser.status==='unsupported'?'unsupported':'saved';
        const staged:StagedAttachment={...held.staged,material:{...held.staged.material,state},parser:value.parser};
        await client.query('UPDATE hima.team_attachments SET staged=$2,parser_completed=true WHERE stage_id=$1',[staged.stageId,JSON.stringify(staged)]);return staged;
      },'hima.stageTaskMaterial'),
      readStage:(actor,ref,stageId)=>this.transaction(async client=>(await load(client,actor,ref,stageId,false)).staged,'hima.readTaskDraft'),
      removeDraft:(actor,ref,stageId)=>this.transaction(async client=>{await load(client,actor,ref,stageId,false);await client.query('UPDATE hima.team_attachments SET removed=true WHERE stage_id=$1',[stageId]);},'hima.removeTaskDraft'),
      readAuthorized:(actor,ref,stageId)=>this.transaction(async client=>{const row=await load(client,actor,ref,stageId,true);return {...row.staged,original:row.original};},'hima.readTaskMaterial'),
    };
  }
  teamMessages():TeamMessageStore {
    const readDelivery=async(client:ClientBase,ref:TaskRef,id:string,lock=false)=>{
      const row=(await client.query<{delivery:TeamMessageDelivery}>('SELECT d.delivery FROM hima.team_message_deliveries d JOIN hima.team_messages m ON m.message_id=d.message_id WHERE m.task_id=$1 AND d.delivery_id=$2'+(lock?' FOR UPDATE OF d':''),[ref.taskId,id])).rows[0];
      if(!row)throw new TeamError('hima/not-found','Delivery is unavailable in this task.');return row.delivery;
    };
    const messages=async(client:ClientBase,ref:TaskRef,page:TeamReadPage)=>{
      const rows=(await client.query<{seq:string;envelope:TeamMessageEnvelope}>('SELECT seq::text,envelope FROM hima.team_messages WHERE task_id=$1 AND seq>$2 ORDER BY seq LIMIT $3',[ref.taskId,page.cursor??0,page.limit+1])).rows;
      return {rows:rows.slice(0,page.limit),more:rows.length>page.limit};
    };
    return {
      commitSend:(actor,request)=>this.transaction(async client=>{
        const scope=await this.workspaceAccess(client,actor,request,'send-message',true);
        if(request.recipientMemberIds.some(id=>!scope.definition.members.some(member=>member.id===id)))throw new TeamError('hima/not-authorized','Choose recipients from the frozen task definition.');
        const digest=teamMessageDigest(request,scope.sender);
        const held=(await client.query<{envelope:TeamMessageEnvelope;digest:string}>('SELECT envelope,digest FROM hima.team_messages WHERE task_id=$1 AND request_id=$2',[request.taskId,request.requestId])).rows[0];
        if(held) {
          if(held.digest!==digest)throw new TeamError('hima/team-conflict','This request already names different message content.');
          const deliveries=(await client.query<{delivery:TeamMessageDelivery}>('SELECT delivery FROM hima.team_message_deliveries WHERE message_id=$1 ORDER BY recipient_member_id',[held.envelope.messageId])).rows.map(row=>row.delivery);
          return {message:held.envelope,deliveries};
        }
        if(request.replyToMessageId) {
          const replied=(await client.query<{envelope:TeamMessageEnvelope}>('SELECT envelope FROM hima.team_messages WHERE task_id=$1 AND message_id=$2',[request.taskId,request.replyToMessageId])).rows[0]?.envelope;
          if(!replied||!replied.sender.memberId||!request.recipientMemberIds.includes(replied.sender.memberId))throw new TeamError('hima/team-invalid','A reply must address the original task member.');
        }
        const stages=[];
        for(const id of request.stagedAttachmentIds) {
          const stage=(await client.query<{staged:StagedAttachment;actor_id:string;removed:boolean}>('SELECT staged,actor_id,removed FROM hima.team_attachments WHERE stage_id=$1 AND task_id=$2 FOR SHARE',[id,request.taskId])).rows[0];
          if(!stage||stage.actor_id!==scope.sender.actorId||stage.removed)throw new TeamError('hima/not-authorized','Only this actor\'s retained task drafts may be sent.');stages.push(stage.staged);
        }
        const message:TeamMessageEnvelope={projectId:request.projectId,teamId:request.teamId,taskId:request.taskId,messageId:`message-${randomUUID()}`,requestId:request.requestId,contentDigest:digest,sender:scope.sender,createdAt:new Date().toISOString(),materialRefs:stages.map(stage=>stage.material),recipientMemberIds:request.recipientMemberIds,text:request.text,kind:request.kind??'requirement',...(request.replyToMessageId?{replyToMessageId:request.replyToMessageId}:{})};
        await client.query('INSERT INTO hima.team_messages(message_id,task_id,request_id,digest,envelope) VALUES($1,$2,$3,$4,$5)',[message.messageId,request.taskId,request.requestId,digest,JSON.stringify(message)]);
        for(const stage of stages)await client.query('INSERT INTO hima.team_material_links(task_id,stage_id,message_id,member_ids) VALUES($1,$2,$3,$4)',[request.taskId,stage.stageId,message.messageId,JSON.stringify([...new Set([...request.recipientMemberIds,scope.definition.leaderMemberId,...(scope.sender.memberId?[scope.sender.memberId]:[])])])]);
        const deliveries:TeamMessageDelivery[]=[];
        for(const recipient of request.recipientMemberIds) {
          const delivery:TeamMessageDelivery={deliveryId:`delivery-${randomUUID()}`,messageId:message.messageId,recipientMemberId:recipient,state:'pending',revision:0,reason:'Native transport is not yet qualified; message is saved, not received.'};deliveries.push(delivery);
          await client.query('INSERT INTO hima.team_message_deliveries(delivery_id,message_id,recipient_member_id,delivery) VALUES($1,$2,$3,$4)',[delivery.deliveryId,message.messageId,recipient,JSON.stringify(delivery)]);
        }
        return {message,deliveries};
      },'hima.commitTeamSend'),
      readMessages:(actor,ref,page)=>this.transaction(async client=>{
        await this.workspaceAccess(client,actor,ref,'read-task');const {rows,more}=await messages(client,ref,page);
        const deliveries=(await client.query<{delivery:TeamMessageDelivery}>('SELECT d.delivery FROM hima.team_message_deliveries d WHERE message_id=ANY($1::text[]) ORDER BY recipient_member_id',[rows.map(row=>row.envelope.messageId)])).rows.map(row=>row.delivery);
        return {messages:rows.map(row=>row.envelope),deliveries,...(more?{nextCursor:Number(rows.at(-1)!.seq)}:{})};
      },'hima.readTeamMessages'),
      readDelivery:(actor,ref,id)=>this.transaction(async client=>{await this.workspaceAccess(client,actor,ref,'read-task');return readDelivery(client,ref,id);},'hima.readTeamDelivery'),
      claimDelivery:(actor,ref,id,revision)=>this.transaction(async client=>{
        const scope=await this.workspaceAccess(client,actor,ref,'send-message',true),delivery=await readDelivery(client,ref,id,true);
        if(delivery.revision!==revision||delivery.state!=='pending'||delivery.target||scope.run.hold||scope.run.cancelled||Date.now()>=Date.parse(scope.run.deadlineAt))return undefined;
        const invocations=(await client.query<{invocation:FlowInvocationRecord}>('SELECT invocation FROM hima.flow_invocations WHERE run_id=$1 AND admitted_generation=$2 ORDER BY version DESC',[scope.run.runId,scope.run.epoch])).rows.map(row=>row.invocation);
        const invocation=invocations.find(row=>(row.context as unknown as {flow:CompiledFlow}).flow.tasks[row.identity.taskId]?.memberId===delivery.recipientMemberId);
        if(!invocation||!await this.workspaceEffectCurrent(client,scope.run,invocation.identity.effectId))return undefined;
        const target={runId:scope.run.runId,effectId:invocation.identity.effectId,memberId:delivery.recipientMemberId,generation:scope.run.epoch,attemptId:`attempt-${randomUUID()}`};
        const claimed:TeamMessageDelivery={...delivery,state:'unknown',revision:revision+1,target,reason:'Dispatch intent retained; native receipt not yet observed.'};
        await client.query('UPDATE hima.team_message_deliveries SET delivery=$2 WHERE delivery_id=$1',[id,JSON.stringify(claimed)]);
        await client.query('INSERT INTO hima.team_delivery_attempts(delivery_id,attempt_id,attempt) VALUES($1,$2,$3)',[id,target.attemptId,JSON.stringify(claimed)]);return claimed;
      },'hima.claimTeamDelivery'),
      recordDelivery:(actor,ref,id,revision,attemptId,result)=>this.transaction(async client=>{
        const scope=await this.workspaceAccess(client,actor,ref,'send-message'),delivery=await readDelivery(client,ref,id,true);
        if(delivery.revision!==revision||delivery.target?.attemptId!==attemptId||delivery.target.generation!==scope.run.epoch||delivery.target.runId!==scope.run.runId||scope.run.cancelled||scope.run.hold)return delivery;
        const binding=(await client.query('SELECT 1 FROM hima.flow_invocations WHERE run_id=$1 AND effect_id=$2 AND admitted_generation=$3',[scope.run.runId,delivery.target.effectId,delivery.target.generation])).rowCount;
        if(!binding||!await this.workspaceEffectCurrent(client,scope.run,delivery.target.effectId))return delivery;
        if(result.state==='accepted'&&(!result.received.nativeReceiptId||jsonDigest(result.received.target)!==jsonDigest(delivery.target)||!Number.isFinite(Date.parse(result.received.receivedAt))))throw new TeamError('hima/team-invalid','Native receive proof does not match this attempt.');
        const next:TeamMessageDelivery={...delivery,state:result.state,revision:revision+1,...(result.state==='accepted'?{received:result.received,reason:'Native received this message; business completion is separate.'}:{reason:result.reason})};
        await client.query('UPDATE hima.team_message_deliveries SET delivery=$2 WHERE delivery_id=$1',[id,JSON.stringify(next)]);
        await client.query('UPDATE hima.team_delivery_attempts SET attempt=$3 WHERE delivery_id=$1 AND attempt_id=$2',[id,attemptId,JSON.stringify(next)]);return next;
      },'hima.recordTeamDelivery'),
      readActivity:(actor,ref,page)=>this.transaction(async client=>{
        const scope=await this.workspaceAccess(client,actor,ref,'read-task');
        const rows=(await client.query<{record:import('./team-messages.js').TeamActivityRecord}>(`SELECT record FROM (
          SELECT envelope->>'createdAt' AS at,message_id AS id,jsonb_build_object('activityId',message_id,'createdAt',envelope->>'createdAt','kind','message','summary',envelope->>'text','messageId',message_id,'memberId',envelope->'sender'->>'memberId','materialRefs',envelope->'materialRefs') AS record FROM hima.team_messages WHERE task_id=$1
          UNION ALL
          SELECT at::text,fact_id,jsonb_build_object('activityId',fact_id,'createdAt',at,'kind',CASE WHEN kind='task-result' THEN 'result' WHEN kind='flow-state' THEN 'work' ELSE 'control' END,'summary',CASE WHEN kind='task-result' THEN left((payload->'value')::text,2400) ELSE COALESCE(payload->>'reason',payload->>'state',kind) END,'effectId',COALESCE(payload->'identity'->>'effectId',payload->>'effectId')) FROM hima.outbox WHERE run_id=$2 AND kind IN ('task-result','flow-state','command','team-exit')
        ) activity ORDER BY at,id LIMIT $3 OFFSET $4`,[ref.taskId,scope.run.runId,page.limit+1,page.cursor??0])).rows;
        return {...ref,records:rows.slice(0,page.limit).map(row=>row.record),...(rows.length>page.limit?{nextCursor:(page.cursor??0)+page.limit}:{})};
      },'hima.readTeamActivity'),
      readPendingRequests:(actor,ref,page)=>this.transaction(async client=>{
        const scope=await this.workspaceAccess(client,actor,ref,'read-task');
        const rows=(await client.query<{seq:string;envelope:TeamMessageEnvelope}>(`SELECT seq::text,envelope FROM hima.team_messages m WHERE task_id=$1 AND seq>$2
          AND envelope->'sender'->>'kind'='member' AND envelope->>'kind' IN ('question','handoff','review')
          AND NOT EXISTS(SELECT 1 FROM hima.team_messages reply WHERE reply.task_id=m.task_id AND reply.envelope->>'replyToMessageId'=m.message_id AND reply.envelope->'sender'->>'kind' IN ('human','guide')) ORDER BY seq LIMIT $3`,[ref.taskId,page.cursor??0,page.limit+1])).rows;
        return {...ref,requests:rows.slice(0,page.limit).map(row=>({requestId:row.envelope.requestId,messageId:row.envelope.messageId,memberId:row.envelope.sender.memberId!,effectId:row.envelope.sender.effectId!,generation:row.envelope.sender.generation!,createdAt:row.envelope.createdAt,kind:row.envelope.kind as 'question'|'handoff'|'review',text:row.envelope.text})),...(rows.length>page.limit?{nextCursor:Number(rows[page.limit-1]!.seq)}:{})};
      },'hima.readPendingTeamRequests'),
      readMemberWork:(actor,ref,memberId,page)=>this.transaction(async client=>{
        const scope=await this.workspaceAccess(client,actor,ref,'read-task');
        if(actor.kind==='member'&&actor.grant.memberId!==memberId)throw new TeamError('hima/not-authorized','Member work is limited to the granted member context.');
        if(!scope.definition.members.some(member=>member.id===memberId))throw new TeamError('hima/not-authorized','Member is absent from this frozen task.');
        const rows=(await client.query<{invocation:FlowInvocationRecord;created_at:Date|null;admitted_generation:number|null;result:TaskResult|null;result_sha256:string|null}>(`SELECT i.invocation,i.created_at,i.admitted_generation,r.result,r.result_sha256 FROM hima.flow_invocations i LEFT JOIN hima.results r USING(effect_id)
          WHERE i.run_id=$1 AND i.invocation->'context'->'flow'->'tasks'->i.task_id->>'memberId'=$2 ORDER BY i.effect_id LIMIT $3 OFFSET $4`,[scope.run.runId,memberId,page.limit+1,page.cursor??0])).rows;
        const records=rows.slice(0,page.limit).map(row=>({recordId:row.invocation.identity.effectId,runId:scope.run.runId,effectId:row.invocation.identity.effectId,generation:row.admitted_generation,createdAt:row.created_at?.toISOString()??null,kind:'work' as const,...memberInputProjection((row.invocation.context as unknown as {input:JsonValue}).input),...(row.result&&row.result_sha256?{result:{sha256:row.result_sha256,effectId:row.invocation.identity.effectId,...memberInputProjection(row.result.value,'Retained committed task result')}}:{}),source:'retained' as const}));
        const transcripts:import('./team-messages.js').TeamMemberWorkRecord[]=[];let allClosed=rows.length>0;
        for(const row of rows.slice(0,page.limit)) {
          const observed=(await client.query<{phase:string;fact:JsonValue}>(`SELECT phase,fact FROM hima.effect_facts WHERE effect_id=$1 AND phase LIKE 'native:oar:observation:%' ORDER BY (fact->>'seq')::bigint DESC LIMIT 40`,[row.invocation.identity.effectId])).rows.reverse();
          const closed=(await client.query('SELECT 1 FROM hima.effect_facts WHERE effect_id=$1 AND phase=$2',[row.invocation.identity.effectId,'native:oar:closed'])).rowCount;
          if(!closed)allClosed=false;
          if(observed.length) {
            const native=observed.map(value=>value.fact).find(value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&typeof value.nativeSession==='string') as {nativeSession:string}|undefined;
            transcripts.push({recordId:factIdentity('oar-transcript',row.invocation.identity.effectId,observed.at(-1)!.phase),runId:scope.run.runId,effectId:row.invocation.identity.effectId,generation:row.admitted_generation,createdAt:row.created_at?.toISOString()??null,kind:'transcript',source:'retained',...(native?{sessionId:native.nativeSession}:{}),...memberInputProjection(observed.map(value=>value.fact),'Retained native OAR observation excerpt')});
          }
        }
        return {...ref,memberId,records:[...records,...transcripts],connection:allClosed?'disconnected' as const:'unavailable' as const,trace:transcripts.length?{state:'retained' as const,reason:'Retained native observations; this view does not assert a current live connection. Each excerpt contains at most 40 recent observations per invocation. Native subagent internals omitted by the runtime are not reconstructed; OpenCode ACP exposes root activity.'}:{state:'missing' as const,reason:'No native member observation is retained for this page.'},...(rows.length>page.limit?{nextCursor:(page.cursor??0)+page.limit}:{})};
      },'hima.readTeamMemberWork'),
    };
  }

  async recordTeamServiceReceipt(receipt:TeamServiceReceipt):Promise<void> {
    const digest=jsonDigest(receipt);
    const {rows}=await this.#pool.query<{digest:string}>(`INSERT INTO hima.team_service_receipts(receipt_id,service_id,generation,digest,receipt)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT(receipt_id) DO UPDATE SET receipt_id=EXCLUDED.receipt_id RETURNING digest`,
      [receipt.receiptId,receipt.serviceId,receipt.generation,digest,JSON.stringify(receipt)]);
    if(rows[0]?.digest!==digest)throw new Error('A service receipt identity already names different observed facts.');
  }
  async teamServiceReceipts(serviceId:string):Promise<readonly TeamServiceReceipt[]> {
    return (await this.#pool.query<{receipt:TeamServiceReceipt}>(`SELECT receipt FROM hima.team_service_receipts WHERE service_id=$1 ORDER BY seq DESC LIMIT 100`,[serviceId])).rows.map(row=>row.receipt);
  }
  async unclosedTeamServiceGenerations():Promise<readonly TeamServiceReceipt[]> {
    return (await this.#pool.query<{receipt:TeamServiceReceipt}>(`SELECT receipt FROM
      (SELECT DISTINCT ON(service_id,generation) receipt FROM hima.team_service_receipts ORDER BY service_id,generation,seq DESC) latest
      WHERE NOT (receipt->'owned'->>'quiescent')::boolean`)).rows.map(row=>row.receipt);
  }
  teamDefinitions(): TeamDefinitionStore {
    return { list: projectId => this.listTeamDefinitions(projectId), versions:(projectId,teamId,page)=>this.listTeamDefinitionVersions(projectId,teamId,page), read: (projectId, teamId, version) => this.readTeamDefinition(projectId, teamId, version), save: request => this.saveTeamVersion(request) };
  }
  async operatorIdentity(): Promise<string> {
    const { rows } = await this.#pool.query<{actor_id:string}>(`INSERT INTO hima.host_operator(singleton,actor_id) VALUES(true,$1)
      ON CONFLICT(singleton) DO UPDATE SET singleton=true RETURNING actor_id`, [`human-${randomUUID()}`]);
    return rows[0]!.actor_id;
  }
  async listTeamDefinitions(projectId:string): Promise<readonly TeamView[]> {
    const {rows}=await this.#pool.query<TeamView>(`SELECT t.team_id AS "teamId",t.project_id AS "projectId",v.version,v.sha256,v.definition
      FROM hima.teams t JOIN hima.team_versions v ON v.team_id=t.team_id AND v.version=t.version WHERE t.project_id=$1 ORDER BY t.team_id`,[projectId]);
    return rows;
  }
  async listTeamDefinitionVersions(projectId:string,teamId:string,page:{limit:number;cursor?:number}) {
    const {rows}=await this.#pool.query<{teamId:string;version:number;sha256:string;title:string}>(`SELECT t.team_id AS "teamId",v.version,v.sha256,v.definition->>'title' AS title
      FROM hima.teams t JOIN hima.team_versions v USING(team_id) WHERE t.project_id=$1 AND t.team_id=$2
      AND ($3::integer IS NULL OR v.version<$3) ORDER BY v.version DESC LIMIT $4`,[projectId,teamId,page.cursor??null,page.limit+1]);
    const versions=rows.slice(0,page.limit);
    return {projectId,teamId,versions,...(rows.length>page.limit?{nextCursor:versions.at(-1)!.version}:{})};
  }
  async readTeamDefinition(projectId:string,teamId:string,version?:number): Promise<TeamView|undefined> {
    const {rows}=await this.#pool.query<TeamView>(`SELECT t.team_id AS "teamId",t.project_id AS "projectId",v.version,v.sha256,v.definition
      FROM hima.teams t JOIN hima.team_versions v ON v.team_id=t.team_id AND v.version=COALESCE($3,t.version) WHERE t.project_id=$1 AND t.team_id=$2`,[projectId,teamId,version??null]);
    return rows[0];
  }
  async saveTeamVersion(request:{projectId:string;teamId:string;definition:TeamDefinition;expectedVersion:number|null}):Promise<TeamView> {
    const definition=teamDefinition.parse(request.definition),sha256=jsonDigest(definition);
    return this.transaction(async client=>{
      await this.#assertHostAdmission(client);
      if(request.expectedVersion===null) {
        const inserted=await client.query('INSERT INTO hima.teams(team_id,project_id,version) VALUES($1,$2,1) ON CONFLICT DO NOTHING',[request.teamId,request.projectId]);
        if(!inserted.rowCount)throw new TeamError('hima/team-conflict','This team already exists; read its current version before saving.');
      } else {
        const changed=await client.query('UPDATE hima.teams SET version=version+1 WHERE team_id=$1 AND project_id=$2 AND version=$3',[request.teamId,request.projectId,request.expectedVersion]);
        if(!changed.rowCount)throw new TeamError('hima/team-conflict','This definition changed or belongs to another project; read its current version.');
      }
      const version=(request.expectedVersion??0)+1;
      await client.query('INSERT INTO hima.team_versions(team_id,version,sha256,definition) VALUES($1,$2,$3,$4)',[request.teamId,version,sha256,JSON.stringify(definition)]);
      for(const member of definition.members)await client.query('INSERT INTO hima.team_members(team_id,member_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[request.teamId,member.id]);
      return {teamId:request.teamId,projectId:request.projectId,version,sha256,definition};
    },'hima.saveTeamVersion');
  }
  async listTeamTasks(projectId:string,teamId:string):Promise<readonly Omit<TeamTaskView,'readiness'>[]> {
    return (await this.#pool.query<{task:Omit<TeamTaskView,'readiness'>}>('SELECT task FROM hima.team_tasks WHERE project_id=$1 AND team_id=$2 ORDER BY task_id',[projectId,teamId])).rows.map(row=>row.task);
  }
  async readTeamTask(projectId:string,teamId:string,taskId:string):Promise<Omit<TeamTaskView,'readiness'>|undefined> {
    const {rows}=await this.#pool.query<{task:Omit<TeamTaskView,'readiness'>}>('SELECT task FROM hima.team_tasks WHERE project_id=$1 AND team_id=$2 AND task_id=$3',[projectId,teamId,taskId]);
    return rows[0]?.task;
  }
  async openTeamTask(request:{projectId:string;requestId:string;requestSha256:string;task:Omit<TeamTaskView,'readiness'>;opening:DurableRunOpening}):Promise<Omit<TeamTaskView,'readiness'>> {
    const {opening,task}=request;
    if(opening.applicationVersion!==this.applicationVersion||opening.inputSha256!==jsonDigest(opening.data)||!Number.isFinite(Date.parse(opening.deadlineAt)))throw new TeamError('hima/team-invalid','Independent opening requires frozen input, deadline and executable identity.');
    return this.transaction(async client=>{
      await this.#assertHostAdmission(client);
      return this.insertTeamTask(client,request);
    },'hima.openTeamTask');
  }
  private async insertTeamTask(client:ClientBase,request:{projectId:string;requestId:string;requestSha256:string;task:Omit<TeamTaskView,'readiness'>;opening:DurableRunOpening}):Promise<Omit<TeamTaskView,'readiness'>> {
      const {opening,task}=request;
      const version=(await client.query<{sha256:string}>('SELECT v.sha256 FROM hima.teams t JOIN hima.team_versions v ON v.team_id=t.team_id WHERE t.project_id=$1 AND t.team_id=$2 AND v.version=$3 FOR SHARE OF t',[request.projectId,task.team.teamId,task.team.version])).rows[0];
      if(!version||version.sha256!==task.team.sha256)throw new TeamError('hima/not-authorized','The frozen Team definition is unavailable in this project.');
      const inserted=await client.query(`INSERT INTO hima.team_tasks(task_id,team_id,definition_version,project_id,request_id,request_sha256,task)
        VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,[task.taskId,task.team.teamId,task.team.version,request.projectId,request.requestId,request.requestSha256,JSON.stringify(task)]);
      const held=(await client.query<{request_sha256:string;task:Omit<TeamTaskView,'readiness'>}>('SELECT request_sha256,task FROM hima.team_tasks WHERE project_id=$1 AND team_id=$2 AND request_id=$3 FOR UPDATE',[request.projectId,task.team.teamId,request.requestId])).rows[0];
      if(!held||held.request_sha256!==request.requestSha256)throw new TeamError('hima/team-conflict','This opening request already names different frozen content.');
      if(!inserted.rowCount)return held.task;
      await client.query(`INSERT INTO hima.runs(run_id,input_sha256,application_version,opening,owner,deadline_at) VALUES($1,$2,$3,$4,$5,$6)`,[opening.runId,opening.inputSha256,opening.applicationVersion,JSON.stringify(opening),opening.owner,opening.deadlineAt]);
      await this.#emit(client,opening.runId,factIdentity('run-opened',opening.runId),'run-opened',opening as unknown as JsonValue);
      return task;
  }
  private async packBinding(client:Pick<ClientBase,'query'>,runId:string):Promise<PackTeamPlan|undefined> {
    const rows=(await client.query<{binding:PackTeamPlan}>(`SELECT d.binding FROM hima.runs r
      JOIN hima.team_pack_delegations d ON d.child_task_id=r.opening->'data'->'source'->>'taskId'
      WHERE r.run_id=$1 AND r.opening->'data'->'source'->>'kind'='team'`,[runId])).rows;
    if(rows.length>1)throw new TeamError('hima/team-conflict','Team Run has ambiguous Pack parent authority.');
    return rows[0]?.binding;
  }
  private async packOriginal(client:Pick<ClientBase,'query'>,plan:PackTeamPlan):Promise<FlowInvocationRecord> {
    const invocation=(await client.query<{invocation:FlowInvocationRecord}>('SELECT invocation FROM hima.flow_invocations WHERE effect_id=$1 AND run_id=$2',[plan.parentIdentity.effectId,plan.parentIdentity.runId])).rows[0]?.invocation;
    if(!invocation||jsonDigest(invocation)!==plan.parentInvocationSha256||jsonDigest(invocation.identity)!==jsonDigest(plan.parentIdentity))throw new TeamError('hima/team-conflict','Original Pack invocation identity changed.');
    const execution=invocation.context as unknown as {flow:CompiledFlow;taskId:string;input:JsonValue};
    if(execution.flow.source==='team'||execution.flow.tasks[execution.taskId]?.tool!=='resident/team-delegate'||jsonDigest(execution.flow.tasks[execution.taskId]?.teamDelegation??null)!==jsonDigest(plan.delegation))throw new TeamError('hima/not-authorized','No original Pack declaration authorizes this Team.');
    const parent=await this.#run(client,plan.parentIdentity.runId);
    const body=execution.input as {goal?:string;input?:JsonValue;closure?:string};
    const source={kind:'team' as const,projectId:plan.projectId,team:plan.delegation.team,taskId:plan.childTaskId};
    const start:FlowStart={runId:plan.childRunId,flow:compileTeamFlow(source,plan.definition),runInput:execution.input,goal:{},strategy:{}};
    const ids=jsonDigest([plan.parentIdentity,plan.delegation]);
    if(plan.schema!=='hima-pack-team-delegation/1'||!plan.projectId||plan.childTaskId!==`pack-team-${ids}`||plan.childRunId!==`run-pack-team-${ids}`||plan.deadlineAt!==parent.deadlineAt||jsonDigest(source)!==jsonDigest(plan.source)||jsonDigest(start)!==jsonDigest(plan.start)||jsonDigest(plan.definition)!==plan.delegation.team.sha256||plan.requestSha256!==jsonDigest([plan.parentIdentity,plan.delegation,execution.input,parent.deadlineAt,plan.projectId])||!body||typeof body.goal!=='string'||!body.goal.trim()||typeof body.closure!=='string'||!body.closure.trim()||Object.keys(body).sort().join(',')!=='closure,goal,input')throw new TeamError('hima/team-conflict','Frozen Team plan differs from the original input, declaration or deadline.');
    validateTaskInput(execution.flow.tasks[execution.taskId]!.contract.input,execution.input,execution.flow.localSchemas);
    validateTaskInput(start.flow.tasks.leader!.contract.input,start.runInput,start.flow.localSchemas);
    return invocation;
  }
  private async assertPackParent(client:ClientBase,plan:PackTeamPlan,childRun?:DurableRun,ignoreReversibleParentHold=false):Promise<void> {
    await this.packOriginal(client,plan);
    const parent=await this.#run(client,plan.parentIdentity.runId);
    if(parent.applicationVersion!==this.applicationVersion||parent.owner!==plan.parentOwner||parent.cancelled||(!ignoreReversibleParentHold&&parent.hold)||Date.now()>=Date.parse(parent.deadlineAt))throw new FlowEffectNotCurrent('Original Pack parent owner, hold, stop or deadline blocks Team business work.');
    await this.#assertBusinessEffectOpen(client,parent.runId,plan.parentIdentity.effectId,ignoreReversibleParentHold);
    if(!(await client.query("SELECT 1 FROM hima.effect_dispatches WHERE effect_id=$1 AND dispatch_id='submit'",[plan.parentIdentity.effectId])).rowCount)throw new FlowEffectNotCurrent('Original Pack parent has no admitted delegation intent.');
    if(childRun) {
      const task=(await client.query<{task:TeamTaskView}>('SELECT task FROM hima.team_tasks WHERE task_id=$1',[plan.childTaskId])).rows[0]?.task;
      if(!task||task.currentRunId!==childRun.runId||task.projectId!==plan.projectId||childRun.deadlineAt!==plan.deadlineAt)throw new FlowEffectNotCurrent('Bound Team is not the accepted current task and original deadline.');
      const data=childRun.opening.data as unknown as {source:PackTeamPlan['source'];definition:TeamDefinition;start:FlowStart;packParent?:PackTeamPlan};
      if(jsonDigest(data.packParent??null)!==jsonDigest(plan)||jsonDigest(data.start.runInput)!==jsonDigest(plan.start.runInput)||jsonDigest(data.source.team)!==jsonDigest(task.team)||jsonDigest(data.definition)!==task.team.sha256||jsonDigest(compileTeamFlow(data.source,data.definition))!==jsonDigest(data.start.flow))throw new FlowEffectNotCurrent('Bound Team opening differs from retained source, scope or compilation.');
      if(childRun.runId===plan.childRunId) {
        if(jsonDigest(task.team)!==jsonDigest(plan.delegation.team)||jsonDigest(data.source)!==jsonDigest(plan.source)||jsonDigest(data.definition)!==jsonDigest(plan.definition)||jsonDigest(data.start.flow)!==jsonDigest(plan.start.flow))throw new FlowEffectNotCurrent('Original Team opening differs from its immutable Pack acceptance.');
      } else {
        const edges=(await client.query<{previous_run_id:string;current_run_id:string;acceptance:{cause?:string;gateRequestId?:string;gateSha256?:string;selected?:TeamTaskView['team']}}>(`WITH RECURSIVE lineage(run_id) AS (SELECT $1::text UNION SELECT c.current_run_id FROM hima.team_continuation_requests c JOIN lineage l ON c.previous_run_id=l.run_id WHERE c.task_id=$2)
          SELECT c.previous_run_id,c.current_run_id,c.acceptance FROM hima.team_continuation_requests c JOIN lineage l ON c.previous_run_id=l.run_id WHERE c.task_id=$2`,[plan.childRunId,plan.childTaskId])).rows;
        let cursor=childRun.runId;const seen=new Set<string>();
        while(cursor!==plan.childRunId) {
          if(seen.has(cursor))throw new FlowEffectNotCurrent('Pack Team successor lineage cycles.');seen.add(cursor);
          const edge=edges.find(edge=>edge.current_run_id===cursor);if(!edge)throw new FlowEffectNotCurrent('Current Team Run lacks accepted original Pack lineage.');
          const successor=await this.#run(client,edge.current_run_id),previous=await this.#run(client,edge.previous_run_id);
          const next=successor.opening.data as unknown as {source:PackTeamPlan['source'];definition:TeamDefinition;start:FlowStart;packParent?:PackTeamPlan;initialHostContext?:{source:string;gateRequestId?:string;gateSha256?:string}};
          const old=previous.opening.data as unknown as {source:PackTeamPlan['source']};
          if(jsonDigest(next.packParent??null)!==jsonDigest(plan)||successor.deadlineAt!==plan.deadlineAt||jsonDigest(next.start.runInput)!==jsonDigest(plan.start.runInput)||jsonDigest(compileTeamFlow(next.source,next.definition))!==jsonDigest(next.start.flow)||jsonDigest(next.definition)!==next.source.team.sha256)throw new FlowEffectNotCurrent('Pack Team successor scope or compilation differs.');
          if((edge.acceptance.cause??'post-exit')==='definition-change') {
            const gate=(await client.query<{gate:TeamDefinitionHandoffGate}>('SELECT gate FROM hima.team_definition_handoffs WHERE task_id=$1 AND request_id=$2 AND previous_run_id=$3',[plan.childTaskId,edge.acceptance.gateRequestId,previous.runId])).rows[0]?.gate;
            if(!gate||edge.acceptance.gateSha256!==jsonDigest(gate)||gate.request.runId!==previous.runId||jsonDigest(gate.selected)!==jsonDigest(next.source.team)||jsonDigest(edge.acceptance.selected)!==jsonDigest(gate.selected)||next.initialHostContext?.source!=='definition-change'||next.initialHostContext.gateRequestId!==gate.request.requestId||next.initialHostContext.gateSha256!==jsonDigest(gate))throw new FlowEffectNotCurrent('Pack Team changed-definition edge has no exact human gate.');
            await this.assertTeamHandoffOutput(client,task,previous,{sha256:next.source.team.sha256,definition:next.definition},next.source.team.version);
          } else if(edge.acceptance.cause==='post-pause')throw new FlowEffectNotCurrent('Pack-bound Team pause successor requires separate outer admission.');
          else if(jsonDigest(next.source.team)!==jsonDigest(old.source.team)||!(await client.query("SELECT 1 FROM hima.outbox WHERE run_id=$1 AND kind='team-exit'",[previous.runId])).rowCount)throw new FlowEffectNotCurrent('Pack Team post-exit edge differs from original saved definition or exit.');
          cursor=previous.runId;
        }
      }
    }
  }
  async acceptPackTeamDelegation(input:{parentIdentity:TaskIdentity;admission:EffectAdmission;plan:PackTeamPlan;projectId:string}):Promise<PackTeamSnapshot> {
    taskIdentity.parse(input.parentIdentity);taskJsonValue.parse(input.plan);
    return this.transaction(async client=>{
      await this.#assertHostAdmission(client);
      const parent=await this.#run(client,input.parentIdentity.runId,true),plan=input.plan;
      if(input.projectId!==plan.projectId||jsonDigest(plan.parentIdentity)!==jsonDigest(input.parentIdentity)||input.admission.runId!==parent.runId||input.admission.effectId!==input.parentIdentity.effectId||input.admission.owner!==parent.owner||input.admission.epoch!==parent.epoch||!await this.#effectRevisionMatches(client,parent,input.admission))throw new TeamError('hima/not-authorized','Host project or original Pack admission stamp changed.');
      await this.assertPackParent(client,plan);
      const prepared=(await client.query<{fact:JsonValue}>("SELECT fact FROM hima.effect_facts WHERE effect_id=$1 AND phase='prepared'",[input.parentIdentity.effectId])).rows[0]?.fact;
      if(jsonDigest(prepared??null)!==jsonDigest(plan))throw new TeamError('hima/team-conflict','Delegation differs from its retained preparation.');
      const existing=(await client.query<{binding:PackTeamPlan}>('SELECT binding FROM hima.team_pack_delegations WHERE parent_effect_id=$1',[input.parentIdentity.effectId])).rows[0];
      if(existing) {if(jsonDigest(existing.binding)!==jsonDigest(plan))throw new TeamError('hima/team-conflict','Original Pack node already names a different Team plan.');return this.packSnapshot(client,plan);}
      const version=(await client.query<{definition:TeamDefinition;sha256:string}>('SELECT v.definition,v.sha256 FROM hima.team_versions v JOIN hima.teams t USING(team_id) WHERE t.project_id=$1 AND t.team_id=$2 AND v.version=$3 FOR SHARE OF t',[plan.projectId,plan.delegation.team.teamId,plan.delegation.team.version])).rows[0];
      if(!version||version.sha256!==plan.delegation.team.sha256||jsonDigest(version.definition)!==jsonDigest(plan.definition))throw new TeamError('hima/not-authorized','Exact saved Team bytes are unavailable in the Host Campaign project.');
      const body=plan.start.runInput as {goal:string;input:JsonValue;closure:string};
      const data=taskJsonValue.parse({source:plan.source,definition:plan.definition,start:plan.start,packParent:plan,requestDigest:plan.requestSha256,budget:{closingReserveMs:0}});
      await this.insertTeamTask(client,{projectId:plan.projectId,requestId:`pack:${plan.parentIdentity.effectId}`,requestSha256:plan.requestSha256,
        task:{taskId:plan.childTaskId,team:plan.delegation.team,projectId:plan.projectId,goal:body.goal,input:body.input,closure:body.closure,deadlineAt:plan.deadlineAt,runIds:[plan.childRunId],currentRunId:plan.childRunId},
        opening:{runId:plan.childRunId,inputSha256:jsonDigest(data),applicationVersion:parent.applicationVersion,owner:`member:${plan.definition.leaderMemberId}`,deadlineAt:parent.deadlineAt,data}});
      await client.query('INSERT INTO hima.team_pack_delegations(parent_effect_id,parent_run_id,child_task_id,child_run_id,binding) VALUES($1,$2,$3,$4,$5)',[plan.parentIdentity.effectId,parent.runId,plan.childTaskId,plan.childRunId,JSON.stringify(plan)]);
      await this.#recordEffectFact(client,plan.parentIdentity,'pack-team-binding',taskJsonValue.parse({plan,bindingSha256:jsonDigest(plan)}));
      return this.packSnapshot(client,plan);
    },'hima.acceptPackTeamDelegation');
  }
  private async packClosed(client:Pick<ClientBase,'query'>,plan:PackTeamPlan):Promise<boolean> {
    const task=(await client.query<{task:TeamTaskView}>('SELECT task FROM hima.team_tasks WHERE task_id=$1',[plan.childTaskId])).rows[0]?.task;
    if(!task||!task.runIds.includes(plan.childRunId))throw new TeamError('hima/team-conflict','Original Team task lineage is unavailable.');
    // A queued invocation can still acquire a resource later unless terminal/stopped or fenced.
    const open=(await client.query(`SELECT 1 FROM hima.flow_invocations i JOIN hima.runs r USING(run_id) WHERE i.run_id=ANY($1::text[])
      AND NOT EXISTS(SELECT 1 FROM hima.results t WHERE t.effect_id=i.effect_id)
      AND NOT EXISTS(SELECT 1 FROM hima.flow_facts f WHERE f.run_id=i.run_id AND f.name='stopped:'||i.effect_id AND f.value->>'closed'='true')
      AND NOT r.cancelled LIMIT 1`,[task.runIds])).rowCount;
    const physical=(await client.query(`SELECT 1 FROM hima.effects e LEFT JOIN hima.effect_leases l USING(effect_id) WHERE e.run_id=ANY($1::text[])
      AND ((l.effect_id IS NOT NULL AND (l.released_at IS NULL OR l.proof IS NULL)) OR
      (EXISTS(SELECT 1 FROM hima.effect_dispatches d WHERE d.effect_id=e.effect_id AND d.dispatch_id NOT LIKE 'stop:%' AND d.dispatch_id NOT LIKE 'cleanup:%')
       AND NOT (l.released_at IS NOT NULL AND l.proof IS NOT NULL) AND NOT EXISTS(SELECT 1 FROM hima.flow_facts f WHERE f.run_id=e.run_id AND f.name='stopped:'||e.effect_id AND f.value->>'closed'='true'))) LIMIT 1`,[task.runIds])).rowCount;
    // No root invocation on an active Run is queued work, not physical closure.
    const queued=(await client.query(`SELECT 1 FROM hima.runs r WHERE r.run_id=ANY($1::text[]) AND NOT r.cancelled AND NOT EXISTS(SELECT 1 FROM hima.flow_invocations i WHERE i.run_id=r.run_id) AND NOT EXISTS(SELECT 1 FROM hima.outbox o WHERE o.run_id=r.run_id AND o.kind='team-exit') AND NOT EXISTS(SELECT 1 FROM hima.team_definition_handoffs h WHERE h.previous_run_id=r.run_id AND r.epoch >= (h.gate->>'postFenceEpoch')::integer AND (r.hold='Team saved-definition handoff:'||h.request_id OR EXISTS(SELECT 1 FROM hima.team_continuation_requests c WHERE c.task_id=h.task_id AND c.request_id=h.request_id))) LIMIT 1`,[task.runIds])).rowCount;
    return !open&&!physical&&!queued;
  }
  private async packSnapshot(client:ClientBase,plan:PackTeamPlan):Promise<PackTeamSnapshot> {
    const task=(await client.query<{task:TeamTaskView}>('SELECT task FROM hima.team_tasks WHERE task_id=$1',[plan.childTaskId])).rows[0]?.task;
    if(!task)throw new TeamError('hima/team-conflict','Accepted Team task is unavailable.');
    const child=await this.#run(client,task.currentRunId,true);
    let state:PackTeamSnapshot['state']='schedulable',reason:string|undefined;
    try {await this.assertPackParent(client,plan,child);}catch(error){if(!(error instanceof FlowEffectNotCurrent))throw error;state='waiting';reason=error.message;}
    if(child.cancelled){state='cancelled';reason='Bound Team is stopped; no replacement child is admitted.';}
    else if(child.hold){state='waiting';reason=child.hold;}
    const roots=(await client.query<{invocation:FlowInvocationRecord}>('SELECT i.invocation FROM hima.flow_invocations i WHERE i.run_id=$1 AND i.task_id=$2 AND NOT EXISTS(SELECT 1 FROM hima.team_effect_continuations c WHERE c.successor_effect_id=i.effect_id) ORDER BY i.effect_id',[child.runId,'leader'])).rows.filter(row=>!(row.invocation.context as unknown as {iterations?:unknown[]}).iterations?.length);
    // Successor leader rows are resolved through the existing accepted head relation.
    if(roots.length>1)throw new TeamError('hima/team-conflict','Bound Team has ambiguous original leader invocations.');
    const root=roots[0];
    let result:TaskResult|undefined;
    if(root) {
      const head=await this.teamHead(client,root.invocation.identity);
      if(state==='schedulable')await this.assertTeamLineageCurrent(client,child,head.invocation.identity.effectId);
      result=await this.teamCommittedDelivery(client,head.invocation.identity);
    }
    const closed=await this.packClosed(client,plan);
    if(!result&&!reason)reason='Current child head has no checked committed TaskResult.';
    if(!closed&&!reason)reason='Whole bound Team physical tree closure is unproved.';
    const sourceFactId=result?factIdentity('task-result',result.identity.effectId):undefined;
    if(sourceFactId) {
      const fact=(await client.query<{payload:JsonValue}>('SELECT payload FROM hima.outbox WHERE fact_id=$1 AND kind=$2 AND run_id=$3',[sourceFactId,'task-result',result!.identity.runId])).rows[0];
      if(!fact||jsonDigest(fact.payload)!==jsonDigest(result))throw new TeamError('hima/team-conflict','Child result has no exact original committed source fact.');
    }
    return {plan,bindingSha256:jsonDigest(plan),task,state,...(reason?{reason}:{}),closed,...(result?{result,childResultSha256:jsonDigest(result),sourceFactId}: {})};
  }
  async readPackTeamDelegation(parentIdentity:TaskIdentity):Promise<PackTeamSnapshot|undefined> {
    return this.transaction(async client=>{
      await this.#run(client,parentIdentity.runId,true);
      const plan=(await client.query<{binding:PackTeamPlan}>('SELECT binding FROM hima.team_pack_delegations WHERE parent_effect_id=$1 AND parent_run_id=$2',[parentIdentity.effectId,parentIdentity.runId])).rows[0]?.binding;
      if(!plan)return undefined;if(jsonDigest(plan.parentIdentity)!==jsonDigest(parentIdentity))mismatch('Pack parent');
      return this.packSnapshot(client,plan);
    },'hima.readPackTeamDelegation');
  }
  /** Raw closure observation inside adapter release/stop Steps; grants no business authority. */
  async readExternalPackTeamClosure(parentIdentity:TaskIdentity):Promise<import('./task-effects.js').EffectClosure> {
    return this.#externalTransaction(async client=>{
      await this.#run(client,parentIdentity.runId,true);
      const plan=(await client.query<{binding:PackTeamPlan}>('SELECT binding FROM hima.team_pack_delegations WHERE parent_effect_id=$1 AND parent_run_id=$2',[parentIdentity.effectId,parentIdentity.runId])).rows[0]?.binding;
      if(!plan)return {closed:true,proof:{packTeamUnadmitted:true,parentIdentity:taskJsonValue.parse(parentIdentity)}};
      if(jsonDigest(plan.parentIdentity)!==jsonDigest(parentIdentity))mismatch('Pack closure parent');
      await this.packOriginal(client,plan);
      if(await this.packClosed(client,plan))return {closed:true,proof:taskJsonValue.parse({packTeam:true,bindingSha256:jsonDigest(plan),parentIdentity,childTaskId:plan.childTaskId})};
      return {closed:false,reason:'Bound original Team physical tree closure is unproved.'};
    });
  }
  async acceptPackTeamResult(input:{parentIdentity:TaskIdentity;bindingSha256:string;childIdentity:TaskIdentity;childResultSha256:string}):Promise<TaskResult> {
    return this.transaction(async client=>{
      await this.#assertHostAdmission(client);await this.#run(client,input.parentIdentity.runId,true);
      const plan=(await client.query<{binding:PackTeamPlan}>('SELECT binding FROM hima.team_pack_delegations WHERE parent_effect_id=$1 AND parent_run_id=$2',[input.parentIdentity.effectId,input.parentIdentity.runId])).rows[0]?.binding;
      if(!plan||jsonDigest(plan)!==input.bindingSha256||jsonDigest(plan.parentIdentity)!==jsonDigest(input.parentIdentity))mismatch('Pack adoption binding');
      const snapshot=await this.packSnapshot(client,plan);
      if(snapshot.state!=='schedulable'||!snapshot.closed||!snapshot.result||jsonDigest(snapshot.result.identity)!==jsonDigest(input.childIdentity)||snapshot.childResultSha256!==input.childResultSha256)throw new TeamError('hima/team-conflict',snapshot.reason??'Current Team delivery and physical closure are not proved.');
      // Independently validate the unchanged child business value against the saved
      // Team output, then against the original Pack node output below.
      createTaskResult(snapshot.result.identity,plan.start.flow.tasks.leader!.contract,{schemaVersion:snapshot.result.outputSchemaVersion,value:snapshot.result.value,artifacts:snapshot.result.artifacts,diagnostics:snapshot.result.diagnostics},plan.start.flow.localSchemas);
      const original=await this.packOriginal(client,plan),execution=original.context as unknown as {flow:CompiledFlow;taskId:string};
      const aliases:PackTeamArtifactAlias[]=[];
      for(const artifact of snapshot.result.artifacts) {
        const retained=(await client.query<{fact:JsonValue}>("SELECT fact FROM hima.effect_facts WHERE effect_id=$1 AND phase=$2",[input.childIdentity.effectId,'native:oar:artifact:'+artifact.name])).rows[0]?.fact as unknown as {runId:string;effectId:string;taskId:string;path:string;sha256:string;bytes:number;retainedPath:string}|undefined;
        if(!retained||retained.runId!==artifact.runId||retained.effectId!==artifact.effectId||retained.taskId!==artifact.taskId||retained.path!==artifact.path||retained.sha256!==artifact.sha256||!retained.retainedPath||!Number.isSafeInteger(retained.bytes)||retained.bytes<0)throw new TeamError('hima/team-conflict','Child artifact has no exact retained native bytes provenance.');
        aliases.push({name:artifact.name,path:`team-artifacts/${jsonDigest([input.childIdentity,artifact.name])}`,sha256:artifact.sha256,childIdentity:input.childIdentity,childName:artifact.name,childPath:artifact.path,retainedFactId:factIdentity('effect-fact',input.childIdentity.effectId,'native:oar:artifact:'+artifact.name),retained:taskJsonValue.parse(retained)});
      }
      const result=createTaskResult(input.parentIdentity,execution.flow.tasks[execution.taskId]!.contract,{schemaVersion:execution.flow.tasks[execution.taskId]!.contract.output.version,value:snapshot.result.value,artifacts:aliases.map(alias=>({runId:input.parentIdentity.runId,taskId:input.parentIdentity.taskId,effectId:input.parentIdentity.effectId,name:alias.name,path:alias.path,sha256:alias.sha256})),diagnostics:snapshot.result.diagnostics},execution.flow.localSchemas);
      const adoption=taskJsonValue.parse({bindingSha256:input.bindingSha256,childResult:snapshot.result,childResultSha256:snapshot.childResultSha256,sourceFactId:snapshot.sourceFactId,artifactAliases:aliases,result,resultSha256:jsonDigest(result)});
      await this.#recordEffectFact(client,input.parentIdentity,'pack-team-result',adoption);
      return result;
    },'hima.acceptPackTeamResult');
  }
  /** Host-internal causal stop. It never impersonates a Team owner or authenticated human. */
  async fencePackTeamChild(input:{parentIdentity:TaskIdentity;requestId:string;cause:string;exitRequestId?:string}):Promise<readonly FlowInvocationRecord[]> {
    return this.transaction(async client=>{
      await client.query('SELECT singleton FROM hima.host_exit WHERE singleton=true FOR SHARE');
      await this.#run(client,input.parentIdentity.runId,true);
      const plan=(await client.query<{binding:PackTeamPlan}>('SELECT binding FROM hima.team_pack_delegations WHERE parent_effect_id=$1 AND parent_run_id=$2',[input.parentIdentity.effectId,input.parentIdentity.runId])).rows[0]?.binding;
      if(!plan)return [];if(jsonDigest(plan.parentIdentity)!==jsonDigest(input.parentIdentity))mismatch('Pack causal parent');await this.packOriginal(client,plan);
      if(input.cause==='app-exit'||input.cause==='team-exit') {
        if(!input.exitRequestId||!await this.#hostExitStopActive(client,input.exitRequestId))throw new Error('Pack Team causal exit request is stale.');
      }
      const task=(await client.query<{task:TeamTaskView}>('SELECT task FROM hima.team_tasks WHERE task_id=$1',[plan.childTaskId])).rows[0]?.task;
      if(!task)throw new TeamError('hima/team-conflict','Bound child task is unavailable.');
      for(const runId of [...task.runIds].sort()) {
        const run=await this.#run(client,runId,true);
        // Exit already uses Team resume-required fences. Preserve them; never cancel the
        // stable Team merely because its Pack parent is receiving an App-exit cleanup.
        if(input.cause!=='app-exit'&&input.cause!=='team-exit'&&!run.cancelled)await client.query('UPDATE hima.runs SET cancelled=true,epoch=epoch+1 WHERE run_id=$1',[runId]);
        await this.#putFlowFact(client,runId,`pack-parent-stop:${input.requestId}`,taskJsonValue.parse({parentIdentity:input.parentIdentity,cause:input.cause,...(input.exitRequestId?{exitRequestId:input.exitRequestId}:{})}));
      }
      return (await client.query<{invocation:FlowInvocationRecord}>('SELECT invocation FROM hima.flow_invocations WHERE run_id=ANY($1::text[]) ORDER BY run_id,effect_id',[task.runIds])).rows.map(row=>row.invocation);
    },'hima.fencePackTeamChild');
  }
  private teamHandoffHold(requestId:string):string {return `Team saved-definition handoff:${requestId}`;}
  private teamScopeDigest(task:TeamTaskView,run:DurableRun):string {
    return jsonDigest({projectId:task.projectId,taskId:task.taskId,team:task.team,goal:task.goal,input:task.input,closure:task.closure,deadlineAt:task.deadlineAt,opening:run.opening});
  }
  /** Lock the original Pack parent before its child; every mutation shares this order. */
  private async lockTeamHandoffRun(client:ClientBase,runId:string):Promise<DurableRun> {
    const binding=await this.packBinding(client,runId);
    if(binding)await this.#run(client,binding.parentIdentity.runId,true);
    return this.#run(client,runId,true);
  }
  private async teamTerminalDelivery(client:ClientBase,run:DurableRun):Promise<boolean> {
    const opening=run.opening.data as unknown as {definition:TeamDefinition;start:FlowStart};
    const leader=Object.values(opening.start.flow.tasks).find(task=>task.memberId===opening.definition.leaderMemberId)?.id;
    // All committed heads of the frozen leader are terminal delivery, including continuations.
    return !!(await client.query("SELECT 1 FROM hima.results WHERE run_id=$1 AND result->'identity'->>'taskId'=$2 LIMIT 1",[run.runId,leader])).rowCount
      ||!!(await client.query("SELECT 1 FROM hima.flow_facts WHERE run_id=$1 AND name LIKE 'outcome:%' AND value->>'state' IN ('succeeded','failed','cancelled') LIMIT 1",[run.runId])).rowCount;
  }
  private async teamDefinitionHandoffDenied(client:ClientBase,task:TeamTaskView,run:DurableRun,gate?:TeamDefinitionHandoffGate,checkPackChild=true,ignoreReversibleParentHold=false):Promise<string|undefined> {
    if((await client.query('SELECT 1 FROM hima.host_exit WHERE singleton=true AND active_request IS NOT NULL')).rowCount)return 'App exit boundary is active.';
    if(run.cancelled)return 'Cancelled Team tasks cannot adopt a saved definition.';
    if(Date.now()>=Date.parse(task.deadlineAt))return 'The original absolute deadline has expired.';
    if(run.applicationVersion!==this.applicationVersion)return 'The original executable version is unavailable.';
    if((await client.query("SELECT 1 FROM hima.task_actor_grants WHERE grant_data->>'runId'=$1 AND grant_data->>'revocationCause'='operator' LIMIT 1",[run.runId])).rowCount)return 'Operator-revoked Team authority cannot adopt a saved definition.';
    if((await client.query("SELECT 1 FROM hima.outbox WHERE run_id=$1 AND kind='team-exit' LIMIT 1",[run.runId])).rowCount)return 'Use explicit post-exit continuation for this task.';
    if(await this.teamTerminalDelivery(client,run))return 'A committed terminal Team delivery cannot adopt a saved definition.';
    const old=run.opening.data as unknown as {source:Extract<NonNullable<CompiledFlow['taskSource']>,{kind:'team'}>;definition:TeamDefinition;start:FlowStart;requestDigest:string};
    if(old.source?.kind!=='team'||old.source.projectId!==task.projectId||old.source.taskId!==task.taskId||jsonDigest(old.source.team)!==jsonDigest(task.team)||!old.requestDigest||jsonDigest(old.start.runInput)!==jsonDigest({goal:task.goal,input:task.input,closure:task.closure})||Date.parse(run.deadlineAt)!==Date.parse(task.deadlineAt)||jsonDigest(compileTeamFlow(old.source,old.definition))!==jsonDigest(old.start.flow))return 'Original frozen definition, scope or compilation is unavailable.';
    const binding=await this.packBinding(client,run.runId);
    if(binding) {try {await this.assertPackParent(client,binding,checkPackChild?run:undefined,ignoreReversibleParentHold);}catch(error){return error instanceof Error?error.message:String(error);}}
    if(gate&&(run.epoch!==gate.postFenceEpoch||run.revision!==gate.request.expectedRevision||run.hold!==this.teamHandoffHold(gate.request.requestId)||run.holdSource!=='human'||this.teamScopeDigest(task,run)!==gate.originalScopeSha256))return 'The saved-definition gate was superseded by later control.';
    return undefined;
  }
  private async selectedTeamVersion(client:ClientBase,task:TeamTaskView,version:number):Promise<{sha256:string;definition:TeamDefinition}> {
    const selected=(await client.query<{sha256:string;definition:TeamDefinition}>('SELECT v.sha256,v.definition FROM hima.team_versions v JOIN hima.teams t USING(team_id) WHERE t.project_id=$1 AND t.team_id=$2 AND v.version=$3 FOR SHARE OF t',[task.projectId,task.team.teamId,version])).rows[0];
    if(!selected||jsonDigest(teamDefinition.parse(selected.definition))!==selected.sha256)throw new TeamError('hima/team-conflict','The exact immutable saved Team definition is unavailable.');
    return selected;
  }
  private async assertTeamHandoffOutput(client:ClientBase,task:TeamTaskView,previous:DurableRun,selected:{sha256:string;definition:TeamDefinition},version:number):Promise<void> {
    const source={kind:'team' as const,projectId:task.projectId,team:{teamId:task.team.teamId,version,sha256:selected.sha256},taskId:task.taskId};
    const compiled=compileTeamFlow(source,selected.definition);
    validateTaskInput(compiled.tasks.leader!.contract.input,{goal:task.goal,input:task.input,closure:task.closure},compiled.localSchemas);
    const binding=await this.packBinding(client,previous.runId);
    if(!binding)return;
    const original=await this.packOriginal(client,binding),outer=original.context as unknown as {flow:CompiledFlow;taskId:string};
    const signature=(flow:CompiledFlow,id:string)=>{
      const output=flow.tasks[id]!.contract.output,locals:Record<string,JsonValue>={};
      const visit=(value:JsonValue):void=>{
        if(Array.isArray(value)){value.forEach(visit);return;}if(!value||typeof value!=='object')return;
        if(typeof value.$ref==='string'&&!value.$ref.startsWith('#')) {
          const file=value.$ref.split('#')[0]!;
          if(!(file in locals)){const document=flow.localSchemas?.[file];if(!document)throw new TeamError('hima/team-invalid','Original output references an unavailable local schema.');locals[file]=document;visit(document);}
        }
        Object.values(value).forEach(visit);
      };visit(output.schema);return jsonDigest({output,localSchemas:locals});
    };
    // Conservative exact output + resolved local registry admission; never infer subtyping.
    if(signature(compiled,'leader')!==signature(binding.start.flow,'leader')||signature(compiled,'leader')!==signature(outer.flow,outer.taskId))throw new TeamError('hima/not-authorized','Saved Team output differs from the original Pack delivery contract.');
  }
  async beginTeamDefinitionHandoff(input:TeamDefinitionHandoffRequest):Promise<{gate:TeamDefinitionHandoffGate;replayed:boolean}> {
    assertName(input.requestId);assertName(input.taskId);assertName(input.runId);
    if(input.action!=='applyDefinition'||input.origin!=='human'||input.actor.kind!=='human'||!Number.isSafeInteger(input.definitionVersion)||input.definitionVersion<1)throw new TeamError('hima/not-authorized','Explicit authenticated human saved-version selection is required.');
    const digest=jsonDigest(input);
    return this.transaction(async client=>{
      await client.query('SELECT singleton FROM hima.host_exit WHERE singleton=true FOR SHARE');
      const operator=(await client.query<{actor_id:string}>('SELECT actor_id FROM hima.host_operator WHERE singleton=true FOR SHARE')).rows[0]?.actor_id;
      if(input.actor.actorId!==operator)throw new TeamError('hima/not-authorized','Only the authenticated Host operator can change this active task.');
      const previous=await this.lockTeamHandoffRun(client,input.runId);
      const task=(await client.query<{task:TeamTaskView}>('SELECT task FROM hima.team_tasks WHERE task_id=$1 AND project_id=$2 FOR UPDATE',[input.taskId,input.actor.projectId])).rows[0]?.task;
      if(!task)throw new TeamError('hima/not-authorized','Team task is unavailable in this project.');
      const prior=(await client.query<{digest:string;gate:TeamDefinitionHandoffGate}>('SELECT digest,gate FROM hima.team_definition_handoffs WHERE task_id=$1 AND request_id=$2',[input.taskId,input.requestId])).rows[0];
      if(prior){if(prior.digest!==digest)throw new TeamError('hima/team-conflict','This handoff request names different content.');return {gate:prior.gate,replayed:true};}
      await this.#assertHostAdmission(client);
      if(task.currentRunId!==input.runId||previous.epoch!==input.expectedEpoch||previous.revision!==input.expectedRevision)throw new TeamError('hima/team-conflict','Current Run or control stamps changed; refresh this task.');
      if((await client.query('SELECT 1 FROM hima.team_definition_handoffs WHERE previous_run_id=$1',[previous.runId])).rowCount)throw new TeamError('hima/team-conflict','This predecessor already has a saved-definition handoff.');
      const reason=await this.teamDefinitionHandoffDenied(client,task,previous);if(reason)throw new TeamError('hima/not-authorized',reason);
      const selected=await this.selectedTeamVersion(client,task,input.definitionVersion);
      if(input.definitionVersion===task.team.version)throw new TeamError('hima/team-conflict','Choose a different saved Team version.');
      await this.assertTeamHandoffOutput(client,task,previous,selected,input.definitionVersion);
      const gate:TeamDefinitionHandoffGate={cause:'definition-change',request:input,digest,selected:{teamId:task.team.teamId,version:input.definitionVersion,sha256:selected.sha256},definitionSha256:jsonDigest(selected.definition),originalScopeSha256:this.teamScopeDigest(task,previous),postFenceEpoch:previous.epoch+1,acceptedAt:new Date().toISOString(),expiresAt:task.deadlineAt};
      await client.query('INSERT INTO hima.team_definition_handoffs(task_id,request_id,digest,previous_run_id,gate) VALUES($1,$2,$3,$4,$5)',[task.taskId,input.requestId,digest,previous.runId,JSON.stringify(gate)]);
      await client.query("UPDATE hima.runs SET epoch=epoch+1,hold=$2,hold_source='human' WHERE run_id=$1",[previous.runId,this.teamHandoffHold(input.requestId)]);
      await this.#emit(client,previous.runId,factIdentity('team-definition-handoff',task.taskId,input.requestId),'team-definition-handoff',taskJsonValue.parse(gate));
      return {gate,replayed:false};
    },'hima.beginTeamDefinitionHandoff');
  }
  async readTeamDefinitionHandoff(taskId:string,requestId:string):Promise<{gate:TeamDefinitionHandoffGate;projection:TeamDefinitionHandoffView}> {
    return this.transaction(async client=>{
      const gate=(await client.query<{gate:TeamDefinitionHandoffGate}>('SELECT gate FROM hima.team_definition_handoffs WHERE task_id=$1 AND request_id=$2',[taskId,requestId])).rows[0]?.gate;
      if(!gate)throw new TeamError('hima/not-found','Saved-definition handoff is unavailable.');
      const task=(await client.query<{task:TeamTaskView}>('SELECT task FROM hima.team_tasks WHERE task_id=$1',[taskId])).rows[0]!.task;
      const accepted=(await client.query<{current_run_id:string}>('SELECT current_run_id FROM hima.team_continuation_requests WHERE task_id=$1 AND request_id=$2',[taskId,requestId])).rows[0];
      if(accepted)return {gate,projection:{requestId,predecessorRunId:gate.request.runId,selected:gate.selected,state:'adopted',successorRunId:accepted.current_run_id}};
      const previous=await this.#run(client,gate.request.runId);
      const reason=task.currentRunId!==previous.runId?'Task current Run changed.':await this.teamDefinitionHandoffDenied(client,task,previous,gate);
      const onlyParentPause=!!reason&&task.currentRunId===previous.runId
        &&await this.teamDefinitionHandoffDenied(client,task,previous,gate,true,true)===undefined;
      const physical=reason?undefined:await this.teamOriginalClosureDenied(client,previous);
      return {gate,projection:{requestId,predecessorRunId:previous.runId,selected:gate.selected,state:reason&&!onlyParentPause?'blocked':'closing',...(reason||physical?{reason:reason??physical}:{})}};
    },'hima.readTeamDefinitionHandoff');
  }
  /** Host readTask uses this only after normal authenticated task authorization. */
  async teamDefinitionHandoffForTask(ref:TaskRef):Promise<TeamDefinitionHandoffView|undefined> {
    const row=(await this.#pool.query<{request_id:string}>(`SELECT h.request_id FROM hima.team_definition_handoffs h JOIN hima.team_tasks t USING(task_id)
      WHERE t.task_id=$1 AND t.project_id=$2 AND t.team_id=$3 ORDER BY h.gate->>'acceptedAt' DESC,h.request_id DESC LIMIT 1`,[ref.taskId,ref.projectId,ref.teamId])).rows[0];
    return row?(await this.readTeamDefinitionHandoff(ref.taskId,row.request_id)).projection:undefined;
  }
  /** Acceptance/start crash gap revalidation reads only original retained receipts. */
  async acceptedTeamSuccessorStartAllowed(previousRunId:string,currentRunId:string):Promise<boolean> {
    return this.transaction(async client=>{
      await client.query('SELECT singleton FROM hima.host_exit WHERE singleton=true FOR SHARE');
      const previous=await this.lockTeamHandoffRun(client,previousRunId);
      const successor=await this.#run(client,currentRunId,true);
      const source=(successor.opening.data as unknown as {source:{taskId:string;projectId:string}}).source;
      const task=(await client.query<{task:TeamTaskView}>('SELECT task FROM hima.team_tasks WHERE task_id=$1 AND project_id=$2 FOR SHARE',[source.taskId,source.projectId])).rows[0]?.task;
      if(!task||task.currentRunId!==currentRunId||successor.cancelled||successor.hold||Date.now()>=Date.parse(task.deadlineAt)||(await client.query('SELECT 1 FROM hima.host_exit WHERE singleton=true AND active_request IS NOT NULL')).rowCount)return false;
      const acceptance=(await client.query<{acceptance:{cause?:string;gateRequestId?:string;gateSha256?:string}}>('SELECT acceptance FROM hima.team_continuation_requests WHERE task_id=$1 AND previous_run_id=$2 AND current_run_id=$3',[task.taskId,previousRunId,currentRunId])).rows[0]?.acceptance;
      if(!acceptance)return false;
      if(acceptance.cause==='post-pause')return !previous.cancelled&&previous.hold==='pause'&&['human','agent'].includes(previous.holdSource??'')
        &&!await this.teamOriginalClosureDenied(client,previous);
      if((acceptance.cause??'post-exit')!=='definition-change')return true;
      const gate=(await client.query<{gate:TeamDefinitionHandoffGate}>('SELECT gate FROM hima.team_definition_handoffs WHERE task_id=$1 AND request_id=$2',[task.taskId,acceptance.gateRequestId])).rows[0]?.gate;
      const original=(previous.opening.data as unknown as {source:{team:TeamTaskView['team']}}).source;
      return !!gate&&acceptance.gateSha256===jsonDigest(gate)&&!await this.teamDefinitionHandoffDenied(client,{...task,team:original.team},previous,gate,false);
    },'hima.acceptedTeamSuccessorStartAllowed');
  }
  async listPendingTeamDefinitionHandoffs():Promise<readonly {taskId:string;requestId:string}[]> {
    return (await this.#pool.query<{taskId:string;requestId:string}>(`SELECT h.task_id AS "taskId",h.request_id AS "requestId" FROM hima.team_definition_handoffs h
      LEFT JOIN hima.team_continuation_requests c USING(task_id,request_id) WHERE c.current_run_id IS NULL ORDER BY h.task_id,h.request_id`)).rows;
  }
  async teamApplyDefinitionGate(ref:TaskRef):Promise<{allowed:boolean;reason?:string}> {
    return this.transaction(async client=>{
      const task=(await client.query<{task:TeamTaskView}>('SELECT task FROM hima.team_tasks WHERE task_id=$1 AND project_id=$2 AND team_id=$3',[ref.taskId,ref.projectId,ref.teamId])).rows[0]?.task;
      if(!task)throw new TeamError('hima/not-authorized','Team task is unavailable in this project.');
      const run=await this.#run(client,task.currentRunId);
      const reason=(await client.query('SELECT 1 FROM hima.team_definition_handoffs WHERE previous_run_id=$1',[run.runId])).rowCount?'A saved-definition handoff is already retained.':await this.teamDefinitionHandoffDenied(client,task,run);
      return {allowed:!reason,...(reason?{reason}:{})};
    },'hima.teamApplyDefinitionGate');
  }
  async acceptTeamDefinitionHandoff(taskId:string,requestId:string):Promise<{previousRunId:string;currentRunId:string;replayed:boolean}> {
    return this.transaction(async client=>{
      await client.query('SELECT singleton FROM hima.host_exit WHERE singleton=true FOR SHARE');
      const operator=(await client.query<{actor_id:string}>('SELECT actor_id FROM hima.host_operator WHERE singleton=true FOR SHARE')).rows[0]?.actor_id;
      const gate=(await client.query<{gate:TeamDefinitionHandoffGate}>('SELECT gate FROM hima.team_definition_handoffs WHERE task_id=$1 AND request_id=$2',[taskId,requestId])).rows[0]?.gate;
      if(!gate||gate.request.actor.actorId!==operator)throw new TeamError('hima/not-authorized','The retained authenticated handoff gate is unavailable.');
      const previous=await this.lockTeamHandoffRun(client,gate.request.runId);
      const task=(await client.query<{task:TeamTaskView}>('SELECT task FROM hima.team_tasks WHERE task_id=$1 AND project_id=$2 FOR UPDATE',[taskId,gate.request.actor.projectId])).rows[0]?.task;
      if(!task)throw new TeamError('hima/not-authorized','Original scoped task is unavailable.');
      const prior=(await client.query<{digest:string;acceptance:{previousRunId:string;currentRunId:string}}>('SELECT digest,acceptance FROM hima.team_continuation_requests WHERE task_id=$1 AND request_id=$2',[taskId,requestId])).rows[0];
      if(prior){if(prior.digest!==gate.digest)throw new TeamError('hima/team-conflict','Retained handoff acceptance differs.');return {...prior.acceptance,replayed:true};}
      if(task.currentRunId!==previous.runId)throw new TeamError('hima/team-conflict','Task currentRun changed before handoff acceptance.');
      const reason=await this.teamDefinitionHandoffDenied(client,task,previous,gate)??await this.teamOriginalClosureDenied(client,previous);if(reason)throw new TeamError('hima/not-authorized',reason);
      const selected=await this.selectedTeamVersion(client,task,gate.selected.version);
      if(selected.sha256!==gate.selected.sha256||jsonDigest(selected.definition)!==gate.definitionSha256)throw new TeamError('hima/team-conflict','Chosen saved bytes changed.');
      await this.assertTeamHandoffOutput(client,task,previous,selected,gate.selected.version);
      return this.insertTeamSuccessorWithin(client,{task,previous,selected,version:gate.selected.version,requestId,digest:gate.digest,cause:'definition-change',gate});
    },'hima.acceptTeamDefinitionHandoff');
  }
  /** Public read gate uses exactly the acceptance predicate, with no dispatch side effect. */
  async teamResumeGate(ref:TaskRef):Promise<{allowed:boolean;reason?:string;runId:string;epoch:number;revision:number}> {
    return this.transaction(async client=>{
      const task=(await client.query<{task:TeamTaskView}>('SELECT task FROM hima.team_tasks WHERE project_id=$1 AND team_id=$2 AND task_id=$3 FOR SHARE',[ref.projectId,ref.teamId,ref.taskId])).rows[0]?.task;
      if(!task)throw new TeamError('hima/not-authorized','Team task is unavailable in this project.');
      const run=await this.#run(client,task.currentRunId);
      const reason=await this.teamResumeDenied(client,task,run,run.hold!=='pause');
      return {allowed:!reason,...(reason?{reason}:{}),runId:run.runId,epoch:run.epoch,revision:run.revision};
    },'hima.teamResumeGate');
  }
  /** Authorize cleanup before an explicit post-pause successor. No new business is admitted here. */
  async admittedTeamPauseCleanup(input:TeamFlowContinuationRequest):Promise<readonly FlowInvocationRecord[]> {
    return this.transaction(async client=>{
      await this.#assertHostAdmission(client);
      const operator=(await client.query<{actor_id:string}>('SELECT actor_id FROM hima.host_operator WHERE singleton=true FOR SHARE')).rows[0]?.actor_id;
      if(input.actor.kind!=='human'||input.actor.actorId!==operator)throw new TeamError('hima/not-authorized','Only the authenticated Host operator may close paused Team work for resume.');
      const prior=(await client.query<{digest:string}>('SELECT digest FROM hima.team_continuation_requests WHERE task_id=$1 AND request_id=$2',[input.taskId,input.requestId])).rows[0];
      if(prior){if(prior.digest!==jsonDigest(input))throw new TeamError('hima/team-conflict','Human resume request identity changed.');return [];}
      const run=await this.#run(client,input.runId,true);
      const task=(await client.query<{task:TeamTaskView}>('SELECT task FROM hima.team_tasks WHERE task_id=$1 AND project_id=$2 FOR SHARE',[input.taskId,input.actor.projectId])).rows[0]?.task;
      if(!task||task.currentRunId!==input.runId)throw new TeamError('hima/not-authorized','Original paused Team task is unavailable.');
      if(run.epoch!==input.expectedEpoch||run.revision!==input.expectedRevision||run.hold!=='pause'||!['human','agent'].includes(run.holdSource??''))
        throw new TeamError('hima/team-conflict','Resume must name the current paused Run and control stamps.');
      const reason=await this.teamResumeDenied(client,task,run,false);
      if(reason)throw new TeamError('hima/not-authorized',reason);
      return (await client.query<{invocation:FlowInvocationRecord}>('SELECT invocation FROM hima.flow_invocations WHERE run_id=$1 ORDER BY effect_id',[run.runId])).rows.map(row=>row.invocation);
    },'hima.admittedTeamPauseCleanup');
  }
  private async teamResumeDenied(client:ClientBase,task:TeamTaskView,run:DurableRun,requireClosed=true):Promise<string|undefined> {
    if((await client.query('SELECT 1 FROM hima.host_exit WHERE singleton=true AND active_request IS NOT NULL')).rowCount)return 'App exit boundary is still active.';
    const binding=await this.packBinding(client,run.runId);
    if(binding) {try {await this.assertPackParent(client,binding,run);}catch(error){return error instanceof Error?error.message:String(error);}}
    if(run.cancelled)return 'Cancelled Team tasks cannot resume.';
    if(await this.teamTerminalDelivery(client,run))return 'A committed terminal Team delivery cannot resume.';
    if(Date.now()>=Date.parse(task.deadlineAt))return 'The original absolute deadline has expired.';
    if(run.applicationVersion!==this.applicationVersion)return 'The original executable version is unavailable.';
    const original=run.opening.data as unknown as {source?:{kind:string;taskId:string;projectId:string;team:TeamTaskView['team']}};
    if(original.source?.kind!=='team'||original.source.taskId!==task.taskId||original.source.projectId!==task.projectId||jsonDigest(original.source.team)!==jsonDigest(task.team))return 'Original frozen task source is unavailable.';
    const exited=!!(await client.query("SELECT 1 FROM hima.outbox WHERE run_id=$1 AND kind='team-exit' LIMIT 1",[run.runId])).rowCount;
    const paused=run.hold==='pause'&&['human','agent'].includes(run.holdSource??'');
    if(!exited&&!paused)return 'Resume requires a retained App exit or an active Team pause.';
    if(binding&&paused)return 'Pack-bound Team pause recovery needs its outer Pack admission; do not resume this child independently.';
    if((await client.query("SELECT 1 FROM hima.flow_facts WHERE run_id=$1 AND name LIKE 'outcome:%' AND value->>'state' IN ('succeeded','failed','cancelled') LIMIT 1",[run.runId])).rowCount)return 'A terminal Team task cannot resume.';
    if((await client.query("SELECT 1 FROM hima.task_actor_grants WHERE grant_data->>'runId'=$1 AND grant_data->>'revocationCause'='operator' LIMIT 1",[run.runId])).rowCount)return 'Operator-revoked Team authority cannot resume.';
    return requireClosed?this.teamOriginalClosureDenied(client,run):undefined;
  }
  private async teamOriginalClosureDenied(client:ClientBase,run:DurableRun):Promise<string|undefined> {
    if((await client.query(`SELECT 1 FROM hima.effects e LEFT JOIN hima.effect_leases l USING(effect_id) WHERE e.run_id=$1 AND ((l.effect_id IS NOT NULL AND (l.released_at IS NULL OR l.proof IS NULL)) OR (EXISTS(SELECT 1 FROM hima.effect_dispatches d WHERE d.effect_id=e.effect_id AND d.dispatch_id='submit') AND (l.effect_id IS NULL OR l.released_at IS NULL OR l.proof IS NULL))) LIMIT 1`,[run.runId])).rowCount)return 'Original full effect tree physical closure remains unproved.';
    if((await client.query(`SELECT 1 FROM hima.effects e WHERE e.run_id=$1
      AND NOT EXISTS(SELECT 1 FROM hima.flow_invocations i WHERE i.effect_id=e.effect_id)
      AND NOT EXISTS(SELECT 1 FROM hima.effect_leases l WHERE l.effect_id=e.effect_id AND l.released_at IS NOT NULL AND l.proof IS NOT NULL)
      AND NOT EXISTS(SELECT 1 FROM hima.flow_facts f WHERE f.run_id=e.run_id AND f.name='stopped:'||e.effect_id AND f.value->>'closed'='true')
      AND NOT EXISTS(SELECT 1 FROM hima.results r WHERE r.effect_id=e.effect_id) LIMIT 1`,[run.runId])).rowCount)return 'Original preparation or derived write intent closure remains unproved.';
    const effects=(await client.query<{effect_id:string;closed:boolean}>(`SELECT i.effect_id,
      (EXISTS(SELECT 1 FROM hima.flow_facts f WHERE f.run_id=i.run_id AND f.name='stopped:'||i.effect_id AND f.value->>'closed'='true') OR EXISTS(SELECT 1 FROM hima.results r WHERE r.effect_id=i.effect_id))
      AND NOT EXISTS(SELECT 1 FROM hima.effect_leases l WHERE l.effect_id=i.effect_id AND (l.released_at IS NULL OR l.proof IS NULL))
      AND NOT EXISTS(SELECT 1 FROM hima.effect_dispatches d WHERE d.effect_id=i.effect_id AND d.dispatch_id='submit' AND NOT EXISTS(SELECT 1 FROM hima.effect_leases l WHERE l.effect_id=i.effect_id AND l.released_at IS NOT NULL AND l.proof IS NOT NULL)) AS closed
      FROM hima.flow_invocations i WHERE i.run_id=$1`,[run.runId])).rows;
    if(!effects.length) {
      // A retained exit fences admission before DBOS dispatch. Absence of invocations
      // is safe only when no effect/preparation identity was ever materialized.
      if((await client.query('SELECT 1 FROM hima.effects WHERE run_id=$1 LIMIT 1',[run.runId])).rowCount)
        return 'Original preparation without an invocation remains unproved.';
    } else if(effects.some(row=>!row.closed))return 'Original invocation and full physical resource closure remain unproved.';
    return undefined;
  }
  async acceptTeamContinuation(input:TeamFlowContinuationRequest):Promise<{previousRunId:string;currentRunId:string;replayed:boolean}> {
    assertName(input.requestId);assertName(input.taskId);assertName(input.runId);
    const digest=jsonDigest(input);
    return this.transaction(async client=>{
      // Preserve Host-first lock order, but identical receipt reads remain legal during a later exit.
      await client.query('SELECT active_request FROM hima.host_exit WHERE singleton=true FOR SHARE');
      const operator=(await client.query<{actor_id:string}>('SELECT actor_id FROM hima.host_operator WHERE singleton=true FOR SHARE')).rows[0]?.actor_id;
      if(input.actor.kind!=='human'||input.actor.actorId!==operator)throw new TeamError('hima/not-authorized','Only the authenticated Host operator can resume a Team after exit.');
      await this.#run(client,input.runId,true);
      const row=(await client.query<{task:TeamTaskView}>('SELECT task FROM hima.team_tasks WHERE task_id=$1 AND project_id=$2 FOR UPDATE',[input.taskId,input.actor.projectId])).rows[0];
      if(!row)throw new TeamError('hima/not-authorized','Team task is unavailable in this project.');
      const prior=(await client.query<{digest:string;acceptance:{previousRunId:string;currentRunId:string}}>('SELECT digest,acceptance FROM hima.team_continuation_requests WHERE task_id=$1 AND request_id=$2',[input.taskId,input.requestId])).rows[0];
      if(prior) {if(prior.digest!==digest)throw new TeamError('hima/team-conflict','This resume request already names different content.');return {...prior.acceptance,replayed:true};}
      await this.#assertHostAdmission(client);
      const task=row.task,previous=await this.#run(client,input.runId,true);
      if(task.currentRunId!==input.runId||previous.epoch!==input.expectedEpoch||previous.revision!==input.expectedRevision)throw new TeamError('hima/team-conflict','Team current Run or control stamps changed; refresh this task.');
      const reason=await this.teamResumeDenied(client,task,previous);if(reason)throw new TeamError('hima/not-authorized',reason);
      const version=input.definitionVersion??task.team.version;
      if(version!==task.team.version&&(await client.query('SELECT 1 FROM hima.team_pack_delegations WHERE child_task_id=$1 LIMIT 1',[task.taskId])).rowCount)throw new TeamError('hima/not-authorized','Pack-bound Team version adoption requires its frozen outer delivery compatibility admission.');
      const selected=(await client.query<{sha256:string;definition:TeamDefinition}>('SELECT v.sha256,v.definition FROM hima.team_versions v JOIN hima.teams t USING(team_id) WHERE t.project_id=$1 AND t.team_id=$2 AND v.version=$3 FOR SHARE OF t',[task.projectId,task.team.teamId,version])).rows[0];
      if(!selected||input.definitionVersion===undefined&&selected.sha256!==task.team.sha256)throw new TeamError('hima/team-conflict','The exact saved Team definition is unavailable.');
      const cause=previous.hold==='pause'&&['human','agent'].includes(previous.holdSource??'')?'post-pause':'post-exit';
      return this.insertTeamSuccessorWithin(client,{task,previous,selected,version,requestId:input.requestId,digest,cause});
    },'hima.acceptTeamContinuation');
  }
  private async insertTeamSuccessorWithin(client:ClientBase,input:{task:TeamTaskView;previous:DurableRun;selected:{sha256:string;definition:TeamDefinition};version:number;requestId:string;digest:string;cause:'post-exit'|'post-pause'|'definition-change';gate?:TeamDefinitionHandoffGate}):Promise<{previousRunId:string;currentRunId:string;replayed:boolean}> {
    const {task,previous,selected,version,requestId,digest,cause,gate}=input;
      const old=previous.opening.data as unknown as {source:Extract<NonNullable<CompiledFlow['taskSource']>,{kind:'team'}>;definition:TeamDefinition;start:FlowStart;requestDigest:string};
      if(!old.requestDigest||jsonDigest(old.start.runInput)!==jsonDigest({goal:task.goal,input:task.input,closure:task.closure})||Date.parse(previous.deadlineAt)!==Date.parse(task.deadlineAt))throw new TeamError('hima/team-conflict','Original input, scope or deadline differs from the frozen opening.');
      if(jsonDigest(compileTeamFlow(old.source,old.definition))!==jsonDigest(old.start.flow))throw new TeamError('hima/team-conflict','Original frozen Team compilation differs from its definition.');
      const team={teamId:task.team.teamId,version,sha256:selected.sha256},runId=randomUUID();
      const source={kind:'team' as const,projectId:task.projectId,team,taskId:task.taskId};
      const start:FlowStart={...old.start,runId,flow:compileTeamFlow(source,selected.definition)};
      const invocations=(await client.query<{invocation:FlowInvocationRecord}>('SELECT invocation FROM hima.flow_invocations WHERE run_id=$1 ORDER BY effect_id',[previous.runId])).rows.map(row=>row.invocation);
      const results=(await client.query<{result:TaskResult}>('SELECT result FROM hima.results WHERE run_id=$1 ORDER BY effect_id',[previous.runId])).rows.map(row=>row.result);
      const observations=(await client.query<{effect_id:string;phase:string;fact:JsonValue}>("SELECT effect_id,phase,fact FROM hima.effect_facts WHERE effect_id=ANY($1::text[]) AND phase LIKE 'native:oar:observation:%' ORDER BY effect_id,phase DESC LIMIT 64",[invocations.map(row=>row.identity.effectId)])).rows;
      const messages=(await client.query<{envelope:TeamMessageEnvelope}>("SELECT envelope FROM hima.team_messages WHERE task_id=$1 AND envelope->>'projectId'=$2 AND (envelope->'recipientMemberIds' ? $3 OR envelope->'sender'->>'memberId'=$3) ORDER BY seq DESC LIMIT 64",[task.taskId,task.projectId,selected.definition.leaderMemberId])).rows.map(row=>row.envelope).reverse();
      const stopped=(await client.query<{name:string;value:JsonValue}>("SELECT name,value FROM hima.flow_facts WHERE run_id=$1 AND name LIKE 'stopped:%' ORDER BY name",[previous.runId])).rows;
      const closureProofs=(await client.query<{effect_id:string;proof:JsonValue}>("SELECT l.effect_id,l.proof FROM hima.effect_leases l JOIN hima.effects e USING(effect_id) WHERE e.run_id=$1 ORDER BY l.effect_id",[previous.runId])).rows;
      const context=taskJsonValue.parse({schema:'hima-team-reconstruction/1',cause,selected:team,...(gate?{gate}: {}),predecessorRunId:previous.runId,source:old.source,definition:old.definition,goal:task.goal,input:task.input,closure:task.closure,deadlineAt:task.deadlineAt,invocations,results,observations,messages,stopped,closureProofs,unknownWork:[],cancelledWork:[]});
      const contextText=canonical(context);
      if(Buffer.byteLength(contextText)>256*1024)throw new TeamError('hima/team-invalid','Retained Team reconstruction exceeds the bounded context size.');
      const hostPrompt=`Host-retained ${cause} reconstruction.`+' This is a new native session and new Run, with the original task scope and deadline. Historical results retain their original identities and are context references only. Native observations are unverified excerpts. Previous external changes may already exist: reconcile actual state; never automatically retry or duplicate an old external write. No same-session native resume or accepted wait is asserted.\n'+contextText;
      const initialHostContext={source:cause,...(gate?{gateRequestId:gate.request.requestId,gateSha256:jsonDigest(gate)}:{}),predecessorRunId:previous.runId,runId,context,sha256:jsonDigest(context),hostPrompt,hostPromptSha256:memoryTextSha256(hostPrompt)};
      const data=taskJsonValue.parse({...previous.opening.data as object,source,definition:selected.definition,start,initialHostContext});
      const opening:DurableRunOpening={...previous.opening,runId,owner:`member:${selected.definition.leaderMemberId}`,data,inputSha256:jsonDigest(data),deadlineAt:task.deadlineAt};
      await client.query('INSERT INTO hima.runs(run_id,input_sha256,application_version,opening,owner,deadline_at) VALUES($1,$2,$3,$4,$5,$6)',[runId,opening.inputSha256,opening.applicationVersion,JSON.stringify(opening),opening.owner,opening.deadlineAt]);
      const changed=await client.query("UPDATE hima.team_tasks SET definition_version=$3,task=$4 WHERE task_id=$1 AND task->>'currentRunId'=$2",[task.taskId,previous.runId,version,JSON.stringify({...task,team,currentRunId:runId,runIds:[...task.runIds,runId]})]);
      if(changed.rowCount!==1)throw new TeamError('hima/team-conflict','Team currentRun compare-and-swap lost.');
      const acceptance={previousRunId:previous.runId,currentRunId:runId,cause,...(gate?{gateRequestId:gate.request.requestId,gateSha256:jsonDigest(gate),selected:team}: {})};
      await client.query('INSERT INTO hima.team_continuation_requests(task_id,request_id,digest,previous_run_id,current_run_id,acceptance) VALUES($1,$2,$3,$4,$5,$6)',[task.taskId,requestId,digest,previous.runId,runId,JSON.stringify(acceptance)]);
      await this.#emit(client,runId,factIdentity('run-opened',runId),'run-opened',opening as unknown as JsonValue);
      return {...acceptance,replayed:false};
  }
  private async teamParentAccess(client:ClientBase,input:{runId:string;parentEffectId:string;actor:TeamActor;owner:string;epoch:number;revision:number}) {
    if(input.actor.kind!=='member'&&input.actor.kind!=='human')throw new TeamError('hima/not-authorized','Only the actual member or authenticated operator may delegate.');
    await this.#assertHostAdmission(client);
    const parent=(await client.query<{invocation:FlowInvocationRecord}>('SELECT invocation FROM hima.flow_invocations WHERE run_id=$1 AND effect_id=$2',[input.runId,input.parentEffectId])).rows[0]?.invocation;
    if(!parent||!('source' in parent.identity)||parent.identity.source.kind!=='team')throw new TeamError('hima/not-authorized','Use the original controlled Team member invocation.');
    const source=parent.identity.source;
    const scope=await this.workspaceAccess(client,input.actor,{projectId:source.projectId,teamId:source.team.teamId,taskId:source.taskId},'delegate',true);
    if(scope.run.runId!==input.runId||scope.run.applicationVersion!==this.applicationVersion||scope.run.owner!==input.owner||scope.run.epoch!==input.epoch||scope.run.revision!==input.revision)throw new TeamError('hima/team-conflict','Task control changed; read its current Run, owner, epoch and revision.');
    if(scope.run.cancelled||scope.run.hold||Date.now()>=Date.parse(scope.run.deadlineAt))throw new TeamError('hima/not-authorized','Stopped, held or expired tasks cannot accept new delegated work.');
    if(input.actor.kind==='member'&&input.actor.grant.effectId!==input.parentEffectId)throw new TeamError('hima/not-authorized','Delegate only from the exact granted parent effect.');
    const context=parent.context as unknown as {flow:CompiledFlow;taskId:string};
    if(context.flow.tasks[context.taskId]?.memberId!==scope.definition.leaderMemberId)throw new TeamError('hima/not-authorized','Only the frozen leader invocation can delegate members.');
    await this.#assertBusinessEffectOpen(client,input.runId,input.parentEffectId);
    const root=(await client.query<{root_effect_id:string}>('SELECT root_effect_id FROM hima.team_effect_continuations WHERE successor_effect_id=$1 AND run_id=$2',[input.parentEffectId,input.runId])).rows[0]?.root_effect_id??input.parentEffectId;
    return {...scope,parent,root,flow:context.flow};
  }
  teamFlow():TeamFlowStore {
    return {acceptDelegation:input=>this.acceptTeamDelegation(input),readDelegations:runId=>this.readTeamDelegations(runId),
      delegationGate:(runId,id)=>this.teamDelegationGate(runId,id),bindDelegationEffect:(input,identity)=>this.bindTeamDelegationEffect(input,identity)};
  }
  async acceptTeamDelegation(input:TeamDelegationAdmission):Promise<TeamDelegationAdmission> {
    return this.transaction(async client=>{
      const scope=await this.teamParentAccess(client,input);
      const frozen=freezeTeamDelegation(scope.flow,scope.definition,input.parentEffectId,input.delegation.request);
      if(jsonDigest(frozen)!==jsonDigest(input.delegation))throw new TeamError('hima/team-conflict','Delegation differs from its frozen original source, method, definition or contract.');
      if('memberId' in frozen.request&&frozen.request.memberId===scope.definition.leaderMemberId)throw new TeamError('hima/team-invalid','A leader cannot delegate waiting work to itself.');
      const deadline=Date.parse(frozen.request.deadlineAt);
      if(deadline>Date.parse(scope.run.deadlineAt)||deadline<=Date.now())throw new TeamError('hima/team-invalid','Delegation must use a future deadline within the original Run deadline.');
      const digest=jsonDigest({root:scope.root,source:scope.flow.taskSource,method:scope.flow.method,request:frozen.request});
      const previous=(await client.query<{digest:string;acceptance:TeamDelegationAdmission}>('SELECT digest,acceptance FROM hima.team_delegations WHERE run_id=$1 AND root_effect_id=$2 AND request_id=$3',[input.runId,scope.root,frozen.request.requestId])).rows[0];
      if(previous){if(previous.digest!==digest)throw new TeamError('hima/team-conflict','This delegation request already names different frozen content.');return previous.acceptance;}
      for(const dependency of frozen.request.dependsOn) {
        const held=(await client.query<{root_effect_id:string}>('SELECT root_effect_id FROM hima.team_delegations WHERE run_id=$1 AND delegation_id=$2',[input.runId,dependency])).rows[0];
        if(!held||held.root_effect_id!==scope.root||dependency===frozen.delegationId)throw new TeamError('hima/team-invalid','Dependencies must name earlier accepted work in the same original task; self, ancestor and mutual waits are refused.');
      }
      const acceptance=structuredClone({...input,delegation:frozen});
      await client.query('INSERT INTO hima.team_delegations(run_id,delegation_id,root_effect_id,parent_effect_id,request_id,digest,acceptance) VALUES($1,$2,$3,$4,$5,$6,$7)',[input.runId,frozen.delegationId,scope.root,input.parentEffectId,frozen.request.requestId,digest,JSON.stringify(acceptance)]);
      await this.#emit(client,input.runId,factIdentity('team-delegation',frozen.delegationId),'team-delegation',acceptance as unknown as JsonValue);
      return acceptance;
    },'hima.acceptTeamDelegation');
  }
  async readTeamDelegations(runId:string):Promise<readonly TeamDelegationAdmission[]> {
    return (await this.#pool.query<{acceptance:TeamDelegationAdmission}>('SELECT acceptance FROM hima.team_delegations WHERE run_id=$1 ORDER BY delegation_id',[runId])).rows.map(row=>row.acceptance);
  }
  /** Immediate result reads do not create a wait or fence the live parent. Recheck
   * this exact authority before and after reading committed child deliveries. */
  async authorizeTeamWait(input:{runId:string;parentEffectId:string;actor:TeamActor;owner:string;epoch:number;revision:number;delegationIds:readonly string[]}):Promise<void> {
    if(!input.delegationIds.length||new Set(input.delegationIds).size!==input.delegationIds.length)throw new TeamError('hima/team-invalid','Wait requires distinct accepted delegation identities.');
    await this.transaction(async client=>{
      const scope=await this.teamParentAccess(client,input);
      const original=(await client.query<{invocation:FlowInvocationRecord}>('SELECT invocation FROM hima.flow_invocations WHERE run_id=$1 AND effect_id=$2',[input.runId,scope.root])).rows[0]!.invocation;
      const head=await this.teamHead(client,original.identity);
      if(head.invocation.identity.effectId!==input.parentEffectId)throw new TeamError('hima/not-authorized','Read child results through the actual current logical parent.');
      await this.teamWaitClosure(client,original.identity,input.parentEffectId,input.delegationIds);
    },'hima.authorizeTeamWait');
  }
  private async delegationGate(client:ClientBase,runId:string,delegationId:string,purpose:'dispatch'|'result'='dispatch'):Promise<TeamDelegationGate> {
    const at=Date.now(),exit=(await client.query<{active_request:string|null}>('SELECT active_request FROM hima.host_exit WHERE singleton=true FOR SHARE')).rows[0];
    const run=await this.#run(client,runId,true);
    const row=(await client.query<{acceptance:TeamDelegationAdmission;child_identity:TaskIdentity|null}>('SELECT acceptance,child_identity FROM hima.team_delegations WHERE run_id=$1 AND delegation_id=$2',[runId,delegationId])).rows[0];
    if(!row)throw new TeamError('hima/not-found','Delegation is unavailable in this original Run.');
    const accepted=row.acceptance;
    const originalParent=(await client.query<{invocation:FlowInvocationRecord}>('SELECT invocation FROM hima.flow_invocations WHERE run_id=$1 AND effect_id=$2',[runId,accepted.parentEffectId])).rows[0]?.invocation;
    if(!originalParent)throw new TeamError('hima/team-conflict','Original delegation parent is unavailable.');
    const deadline=Math.min(Date.parse(run.deadlineAt),Date.parse(accepted.delegation.request.deadlineAt),Date.parse((await this.teamExecutionBinding(client,originalParent.identity)).deadlineAt));
    const cancelled=(reason:string):TeamDelegationGate=>({at,state:'cancelled',reason});
    const waiting=(reason:string):TeamDelegationGate=>({at,state:'waiting',reason});
    const committed=purpose==='result'&&row.child_identity&&await this.teamCommittedDelivery(client,row.child_identity);
    if(run.cancelled||at>=Date.parse(run.deadlineAt)||at>=deadline&&!committed||run.owner!==accepted.owner||run.epoch!==accepted.epoch||run.applicationVersion!==this.applicationVersion)return cancelled('Original task control, executable identity or bound delegation deadline no longer admits work.');
    if(run.hold||exit?.active_request)return waiting('Original task or App exit requires explicit continuation.');
    try {await this.#assertFlowEffectCurrent(client,run,accepted.parentEffectId);}
    catch(error){if(error instanceof FlowEffectNotCurrent)return cancelled(error.message);throw error;}
    if(accepted.actor.kind==='member') {
      const grant=(await client.query<{grant_data:ActorGrant}>('SELECT grant_data FROM hima.task_actor_grants WHERE grant_id=$1 FOR SHARE',[accepted.actor.grant.grantId])).rows[0]?.grant_data;
      const original=accepted.actor.grant;
      const unchanged=(value:ActorGrant)=>{const {revokedAt,revocationCause,...binding}=value;return binding;};
      // A proved admitted yield may close its old grant; an operator revocation cannot.
      if(!grant||jsonDigest(unchanged(grant))!==jsonDigest(unchanged(original))||at>=Date.parse(grant.expiresAt)||grant.generation!==run.epoch||grant.revokedAt&&grant.revocationCause!=='yield')return cancelled('Original member permission was revoked, changed or expired.');
    } else {
      const operator=(await client.query<{actor_id:string}>('SELECT actor_id FROM hima.host_operator WHERE singleton=true')).rows[0];
      if(operator?.actor_id!==accepted.actor.actorId)return cancelled('Original authenticated operator changed.');
    }
    for(const dependency of accepted.delegation.request.dependsOn) {
      const producer=(await client.query<{child_identity:TaskIdentity|null}>('SELECT child_identity FROM hima.team_delegations WHERE run_id=$1 AND delegation_id=$2',[runId,dependency])).rows[0];
      if(!producer?.child_identity)return waiting('An accepted dependency has no original committed result.');
      try {await this.#assertFlowEffectCurrent(client,run,producer.child_identity.effectId);}
      catch(error){if(error instanceof FlowEffectNotCurrent)return cancelled('A dependency was superseded; retain its original result.');throw error;}
      const result=await this.teamCommittedDelivery(client,producer.child_identity);
      if(!result)return waiting('Dependency result or physical closure is still unproved.');
    }
    const handoff=await this.teamDelegationWait(client,runId,delegationId);
    if(!handoff)return waiting('No causal wait covers this accepted delegated work.');
    try {await this.teamWaitCurrent(client,handoff.acceptance);}
    catch(error){if(error instanceof TeamError||error instanceof FlowEffectNotCurrent)return cancelled(error.message);throw error;}
    if(!handoff.saved_context||!handoff.closure_proof)return waiting('Causal parent context and actual capacity yield are not yet proved.');
    const released=(await client.query<{proof:JsonValue;released_at:string|null}>('SELECT proof,released_at FROM hima.effect_leases WHERE effect_id=$1',[handoff.acceptance.parentIdentity.effectId])).rows[0];
    if(!released?.released_at||jsonDigest(released.proof)!==jsonDigest(handoff.closure_proof))return waiting('Causal parent still owns physical capacity or its release proof differs.');
    return {at,state:'ready'};
  }
  async teamDelegationGate(runId:string,delegationId:string):Promise<TeamDelegationGate> {
    return this.transaction(client=>this.delegationGate(client,runId,delegationId),'hima.teamDelegationGate');
  }
  async bindTeamDelegationEffect(input:TeamDelegationAdmission,identity:TaskIdentity):Promise<void> {
    taskIdentity.parse(identity);
    await this.transaction(async client=>{
      const gate=await this.delegationGate(client,input.runId,input.delegation.delegationId);
      if(gate.state!=='ready')throw new TeamError('hima/not-authorized',gate.reason??'Original parent yield is unproved.');
      const held=(await client.query<{acceptance:TeamDelegationAdmission;child_identity:TaskIdentity|null}>('SELECT acceptance,child_identity FROM hima.team_delegations WHERE run_id=$1 AND delegation_id=$2 FOR UPDATE',[input.runId,input.delegation.delegationId])).rows[0]!;
      const flow=held.acceptance.delegation.flow,task=Object.values(flow.tasks)[0]!;
      if(jsonDigest(held.acceptance)!==jsonDigest(input)||identity.runId!==input.runId||identity.taskId!==task.id||identity.irSha256!==flow.irSha256||identity.applicationVersion!==this.applicationVersion||!('source' in identity)||jsonDigest(identity.source)!==jsonDigest(flow.taskSource)||jsonDigest(identity.method)!==jsonDigest(flow.method))throw new TeamError('hima/team-conflict','Child effect differs from its accepted original delegation identity.');
      if(held.child_identity){if(jsonDigest(held.child_identity)!==jsonDigest(identity))throw new TeamError('hima/team-conflict','Delegation already binds another original child effect.');return;}
      const parent=(await client.query<{invocation:FlowInvocationRecord}>('SELECT invocation FROM hima.flow_invocations WHERE effect_id=$1 AND run_id=$2',[input.parentEffectId,input.runId])).rows[0]!.invocation;
      await client.query('UPDATE hima.team_delegations SET child_identity=$3 WHERE run_id=$1 AND delegation_id=$2',[input.runId,input.delegation.delegationId,JSON.stringify(identity)]);
      await client.query('INSERT INTO hima.flow_derived_effects(child_effect_id,parent_effect_id,run_id,parent_identity,child_identity,purpose) VALUES($1,$2,$3,$4,$5,$6)',[identity.effectId,parent.identity.effectId,input.runId,JSON.stringify(parent.identity),JSON.stringify(identity),'delegation']);
    },'hima.bindTeamDelegationEffect');
  }
  private async teamWaitRow(client:Pick<ClientBase,'query'>,waitId:string) {
    const row=(await client.query<{acceptance:TeamWaitAcceptance;saved_context:TeamSavedContext|null;closure_proof:JsonValue|null}>(
      'SELECT acceptance,saved_context,closure_proof FROM hima.team_waits WHERE wait_id=$1',[waitId])).rows[0];
    if(!row)throw new TeamError('hima/not-found','The retained Team wait is unavailable.');
    return row;
  }
  /** Yield authority is limited to the retained wait, never a reactivated member grant. */
  private async teamWaitCurrent(client:ClientBase,wait:TeamWaitAcceptance):Promise<DurableRun> {
    const host=(await client.query<{active_request:string|null;finalizing:boolean}>('SELECT active_request,finalizing FROM hima.host_exit WHERE singleton=true FOR SHARE')).rows[0];
    if(host?.active_request||host?.finalizing)throw new TeamError('hima/not-authorized','App exit fences accepted Team continuation.');
    const run=await this.#run(client,wait.parentIdentity.runId,true);
    const source='source' in wait.rootIdentity?wait.rootIdentity.source:undefined;
    if(source?.kind!=='team')throw new TeamError('hima/not-authorized','Wait has no original Team source.');
    const task=(await client.query<{task:TeamTaskView}>('SELECT task FROM hima.team_tasks WHERE project_id=$1 AND team_id=$2 AND task_id=$3 FOR SHARE',[source.projectId,source.team.teamId,source.taskId])).rows[0]?.task;
    if(!task||task.currentRunId!==run.runId||run.cancelled||run.hold||run.owner!==wait.admission.owner||run.epoch!==wait.admission.epoch||run.revision!==wait.admission.revision||run.applicationVersion!==this.applicationVersion||Date.now()>=Date.parse(run.deadlineAt))throw new TeamError('hima/not-authorized','Original wait control, current Run or deadline no longer admits continuation.');
    if(wait.actor.kind==='member') {
      const original=wait.actor.grant;
      const grant=(await client.query<{grant_data:ActorGrant}>('SELECT grant_data FROM hima.task_actor_grants WHERE grant_id=$1 FOR SHARE',[original.grantId])).rows[0]?.grant_data;
      const binding=(g:ActorGrant)=>{const {revokedAt,revocationCause,...rest}=g;return rest;};
      if(!grant||jsonDigest(binding(grant))!==jsonDigest(binding(original))||grant.effectId!==wait.parentIdentity.effectId||grant.runId!==run.runId||grant.generation!==run.epoch||Date.now()>=Date.parse(grant.expiresAt)||grant.revokedAt&&!['yield','closed'].includes(grant.revocationCause??''))throw new TeamError('hima/not-authorized','Original wait member authority was revoked, changed or expired.');
    } else if(wait.actor.kind==='human') {
      const operator=(await client.query<{actor_id:string}>('SELECT actor_id FROM hima.host_operator WHERE singleton=true')).rows[0];
      if(operator?.actor_id!==wait.actor.actorId||wait.actor.projectId!==source.projectId)throw new TeamError('hima/not-authorized','Original authenticated operator changed.');
    } else throw new TeamError('hima/not-authorized','Wait requires retained member or operator provenance.');
    await this.#assertFlowEffectCurrent(client,run,wait.parentIdentity.effectId);
    return run;
  }
  private async teamHead(client:Pick<ClientBase,'query'>,root:TaskIdentity):Promise<{invocation:FlowInvocationRecord;lineage:readonly FlowInvocationRecord[];continuation?:TeamEffectContinuation;wait?:TeamWaitAcceptance}> {
    const original=(await client.query<{invocation:FlowInvocationRecord}>('SELECT invocation FROM hima.flow_invocations WHERE run_id=$1 AND effect_id=$2',[root.runId,root.effectId])).rows[0]?.invocation;
    if(!original||jsonDigest(original.identity)!==jsonDigest(root))mismatch('Team logical root');
    if((await client.query('SELECT 1 FROM hima.team_effect_continuations WHERE successor_effect_id=$1',[root.effectId])).rowCount)throw new TeamError('hima/team-invalid','Resolve a Team head from its original logical invocation.');
    const rows=(await client.query<{continuation:TeamEffectContinuation}>('SELECT continuation FROM hima.team_effect_continuations WHERE run_id=$1 AND root_effect_id=$2',[root.runId,root.effectId])).rows.map(row=>row.continuation);
    let invocation=original,continuation:TeamEffectContinuation|undefined;
    const lineage:FlowInvocationRecord[]=[original];
    const visited=new Set<string>();
    for(;;) {
      if(visited.has(invocation.identity.effectId))throw new TeamError('hima/team-conflict','Retained continuation lineage is cyclic.');
      visited.add(invocation.identity.effectId);
      const next=rows.filter(row=>row.predecessorIdentity.effectId===invocation.identity.effectId);
      if(next.length>1)throw new TeamError('hima/team-conflict','Retained logical task has multiple successor heads.');
      if(!next.length)break;
      continuation=next[0]!;
      if(jsonDigest(continuation.rootIdentity)!==jsonDigest(root)||jsonDigest(continuation.predecessorIdentity)!==jsonDigest(invocation.identity))mismatch('Team continuation lineage');
      const held=(await client.query<{invocation:FlowInvocationRecord}>('SELECT invocation FROM hima.flow_invocations WHERE effect_id=$1 AND run_id=$2',[continuation.invocation.identity.effectId,root.runId])).rows[0]?.invocation;
      if(!held||jsonDigest(held)!==jsonDigest(continuation.invocation))mismatch('Retained successor invocation');
      const stable=(identity:TaskIdentity)=>{const {effectId,...binding}=identity;return binding;};
      if(jsonDigest(stable(held.identity))!==jsonDigest(stable(root)))mismatch('Team successor source/method/task');
      invocation=held;lineage.push(held);
    }
    if(visited.size!==rows.length+1)throw new TeamError('hima/team-conflict','Retained continuation lineage is disconnected.');
    const wait=(await client.query<{acceptance:TeamWaitAcceptance}>('SELECT acceptance FROM hima.team_waits WHERE run_id=$1 AND parent_effect_id=$2',[root.runId,invocation.identity.effectId])).rows[0]?.acceptance;
    return {invocation,lineage,...(continuation?{continuation}:{}),...(wait?{wait}:{})};
  }
  /** Structural only: no currentness/result gates, so historical prerequisites cannot
   * recurse through a later successor's result continuation. */
  private async teamWaitClosure(client:ClientBase,root:TaskIdentity,parentEffectId:string,requested:readonly string[]):Promise<readonly {acceptance:TeamDelegationAdmission;child_identity:TaskIdentity|null}[]> {
    const {lineage}=await this.teamHead(client,root);
    const parentIndex=lineage.findIndex(row=>row.identity.effectId===parentEffectId);
    if(parentIndex<0)throw new TeamError('hima/not-authorized','Wait parent is outside the validated logical invocation prefix.');
    const records=(await client.query<{root_effect_id:string;parent_effect_id:string;acceptance:TeamDelegationAdmission;child_identity:TaskIdentity|null}>('SELECT root_effect_id,parent_effect_id,acceptance,child_identity FROM hima.team_delegations WHERE run_id=$1',[root.runId])).rows;
    const byId=new Map(records.map(row=>[row.acceptance.delegation.delegationId,row]));
    const visited=new Set<string>(),visiting=new Set<string>();
    const ordered:typeof records=[];
    const visit=(id:string,latestParent:number)=>{
      const row=byId.get(id),index=row?lineage.findIndex(parent=>parent.identity.effectId===row.parent_effect_id):-1;
      if(!row||row.root_effect_id!==root.effectId||row.acceptance.runId!==root.runId||row.acceptance.parentEffectId!==row.parent_effect_id||row.acceptance.delegation.parentEffectId!==row.parent_effect_id||!('source' in root)||jsonDigest(row.acceptance.delegation.flow.taskSource)!==jsonDigest(root.source)||jsonDigest(row.acceptance.delegation.flow.method)!==jsonDigest(root.method)||index<0||index>latestParent)throw new TeamError('hima/team-invalid','Wait names unknown or unrelated accepted delegated work.');
      if(row.child_identity&&lineage.slice(0,parentIndex+1).some(parent=>parent.identity.effectId===row.child_identity!.effectId))throw new TeamError('hima/team-invalid','A wait cannot consume itself or an ancestor.');
      if(visiting.has(id))throw new TeamError('hima/team-invalid','Wait dependencies are cyclic.');
      if(visited.has(id))return;
      visiting.add(id);
      for(const dependency of [...row.acceptance.delegation.request.dependsOn].sort())visit(dependency,index);
      visiting.delete(id);visited.add(id);ordered.push(row);
    };
    for(const id of requested)visit(id,parentIndex);
    return ordered;
  }
  /** Earliest causal covering wait, ordered by validated logical lineage rather
   * than wall time. Never move historical A's gate onto the later B waiter. */
  private async teamDelegationWait(client:ClientBase,runId:string,delegationId:string) {
    const row=(await client.query<{root_effect_id:string}>('SELECT root_effect_id FROM hima.team_delegations WHERE run_id=$1 AND delegation_id=$2',[runId,delegationId])).rows[0];
    if(!row)throw new TeamError('hima/not-found','Delegation is unavailable in this original Run.');
    const root=(await client.query<{invocation:FlowInvocationRecord}>('SELECT invocation FROM hima.flow_invocations WHERE run_id=$1 AND effect_id=$2',[runId,row.root_effect_id])).rows[0]?.invocation.identity;
    if(!root)throw new TeamError('hima/team-conflict','Original logical root is unavailable.');
    const {lineage}=await this.teamHead(client,root);
    const waits=(await client.query<{acceptance:TeamWaitAcceptance;saved_context:TeamSavedContext|null;closure_proof:JsonValue|null}>('SELECT acceptance,saved_context,closure_proof FROM hima.team_waits WHERE run_id=$1 AND root_effect_id=$2',[runId,root.effectId])).rows;
    for(const parent of lineage) {
      const wait=waits.find(row=>row.acceptance.parentIdentity.effectId===parent.identity.effectId);
      if(!wait)continue;
      if(jsonDigest(wait.acceptance.rootIdentity)!==jsonDigest(root)||jsonDigest(wait.acceptance.parentIdentity)!==jsonDigest(parent.identity))mismatch('Team causal wait lineage');
      if((await this.teamWaitClosure(client,root,parent.identity.effectId,wait.acceptance.delegationIds)).some(row=>row.acceptance.delegation.delegationId===delegationId))return wait;
    }
    return undefined;
  }
  async acceptTeamWait(input:{readonly parentEffectId:string;readonly requestId:string;readonly actor:TeamActor;readonly owner:string;readonly epoch:number;readonly revision:number;readonly delegationIds:readonly string[]}):Promise<TeamWaitAcceptance> {
    assertName(input.requestId);
    if(!input.delegationIds.length||input.delegationIds.length>64||new Set(input.delegationIds).size!==input.delegationIds.length)throw new TeamError('hima/team-invalid','Wait requires a bounded nonempty set of distinct accepted delegations.');
    return this.transaction(async client=>{
      await this.#assertHostAdmission(client);
      const parent=(await client.query<{invocation:FlowInvocationRecord}>('SELECT invocation FROM hima.flow_invocations WHERE effect_id=$1',[input.parentEffectId])).rows[0]?.invocation;
      if(!parent)throw new TeamError('hima/not-found','Original parent invocation is unavailable.');
      const runId=parent.identity.runId;await this.#run(client,runId,true);
      const digest=jsonDigest(input);
      const previous=(await client.query<{digest:string;acceptance:TeamWaitAcceptance}>('SELECT digest,acceptance FROM hima.team_waits WHERE parent_effect_id=$1',[input.parentEffectId])).rows[0];
      if(previous) {
        if(previous.digest!==digest)throw new TeamError('hima/team-conflict','This original parent already accepted a different wait request or set.');
        await this.teamWaitCurrent(client,previous.acceptance);return previous.acceptance;
      }
      const scope=await this.teamParentAccess(client,{...input,runId});
      const root=(await client.query<{invocation:FlowInvocationRecord}>('SELECT invocation FROM hima.flow_invocations WHERE effect_id=$1 AND run_id=$2',[scope.root,runId])).rows[0]!.invocation.identity;
      const head=await this.teamHead(client,root);
      if(head.invocation.identity.effectId!==input.parentEffectId)throw new TeamError('hima/team-conflict','Wait must originate from the single current logical task head.');
      for(const child of await this.teamWaitClosure(client,root,input.parentEffectId,input.delegationIds)) {
        const originalParent=head.lineage.find(row=>row.identity.effectId===child.acceptance.parentEffectId)!;
        const deadline=Math.min(Date.parse(child.acceptance.delegation.request.deadlineAt),Date.parse((await this.teamExecutionBinding(client,originalParent.identity)).deadlineAt));
        if(Date.now()>=deadline&&!(child.child_identity&&await this.teamCommittedDelivery(client,child.child_identity)))throw new TeamError('hima/team-invalid','Wait names expired uncommitted delegated work.');
      }
      const acceptance:TeamWaitAcceptance={waitId:factIdentity('team-wait',runId,input.parentEffectId,input.requestId),requestId:input.requestId,rootIdentity:root,parentIdentity:parent.identity,admission:{runId,effectId:input.parentEffectId,owner:input.owner,epoch:input.epoch,revision:input.revision},actor:structuredClone(input.actor),delegationIds:[...input.delegationIds],acceptedAt:new Date().toISOString()};
      await client.query('INSERT INTO hima.team_waits(wait_id,run_id,root_effect_id,parent_effect_id,request_id,digest,acceptance) VALUES($1,$2,$3,$4,$5,$6,$7)',[acceptance.waitId,runId,root.effectId,input.parentEffectId,input.requestId,digest,JSON.stringify(acceptance)]);
      // Public fact carries lineage only. Private context/paths stay in the application tables.
      await this.#emit(client,runId,acceptance.waitId,'team-wait',acceptance as unknown as JsonValue);
      return acceptance;
    },'hima.acceptTeamWait');
  }
  async readTeamEffectHead(root:TaskIdentity):Promise<TeamEffectHead> {
    taskIdentity.parse(root);
    return this.transaction(async (client):Promise<TeamEffectHead>=>{
      const host=(await client.query<{active_request:string|null;finalizing:boolean}>('SELECT active_request,finalizing FROM hima.host_exit WHERE singleton=true FOR SHARE')).rows[0];
      await this.#run(client,root.runId,true);const head=await this.teamHead(client,root);
      if(host?.active_request||host?.finalizing)return {state:'blocked',invocation:head.invocation,reason:'App exit requires explicit continuation.'};
      try {
        if(head.wait)await this.teamWaitCurrent(client,head.wait);
        else {const run=await this.#run(client,root.runId);if(run.cancelled||run.hold||Date.now()>=Date.parse(run.deadlineAt))return {state:'blocked',invocation:head.invocation,reason:'Original Run control or deadline blocks this logical task.'};await this.#assertFlowEffectCurrent(client,run,head.invocation.identity.effectId);}
      } catch(error) {if(error instanceof TeamError||error instanceof FlowEffectNotCurrent)return {state:'blocked',invocation:head.invocation,reason:error.message};throw error;}
      return head.wait?{state:'waiting',wait:head.wait,reason:'Waiting for original context handoff and accepted child results.'}:{state:'active',invocation:head.invocation,...(head.continuation?{continuation:head.continuation}:{})};
    },'hima.readTeamEffectHead');
  }
  private async teamReconstruction(client:Pick<ClientBase,'query'>,wait:TeamWaitAcceptance):Promise<TeamSavedContext&{kind:'reconstruction'}> {
    const parent=(await client.query<{invocation:FlowInvocationRecord}>('SELECT invocation FROM hima.flow_invocations WHERE effect_id=$1',[wait.parentIdentity.effectId])).rows[0]!.invocation;
    const execution=parent.context as unknown as {flow:CompiledFlow;taskId:string;input:JsonValue};
    const run=await this.#run(client,wait.parentIdentity.runId);
    const definition=(run.opening.data as unknown as {definition:TeamDefinition}).definition;
    const task=execution.flow.tasks[execution.taskId]!,member=definition.members.find(row=>row.id===task.memberId);
    if(!member)throw new TeamError('hima/team-invalid','Frozen original member instructions are unavailable.');
    const source='source' in wait.rootIdentity?wait.rootIdentity.source:undefined;if(source?.kind!=='team')mismatch('Reconstruction source');
    const prior=(await client.query<{saved_context:TeamSavedContext|null}>('SELECT saved_context FROM hima.team_waits WHERE wait_id=$1',[wait.waitId])).rows[0]?.saved_context;
    if(prior?.kind==='reconstruction')return prior;
    const messages=(await client.query<{envelope:TeamMessageEnvelope}>(`SELECT envelope FROM hima.team_messages WHERE task_id=$1 AND envelope->>'projectId'=$2 AND (envelope->'recipientMemberIds' ? $3 OR envelope->'sender'->>'memberId'=$3) ORDER BY seq DESC LIMIT 64`,[source.taskId,source.projectId,member.id])).rows.map(row=>row.envelope).reverse();
    const context=taskJsonValue.parse({schema:'hima-team-reconstruction/1',identity:parent.identity,input:execution.input,instructions:member.instructions,skills:member.skills,contract:task.contract,localSchemas:execution.flow.localSchemas,messages});
    if(Buffer.byteLength(canonical(context))>256*1024)throw new TeamError('hima/team-invalid','Retained reconstruction exceeds the bounded context size; explicit continuation is required.');
    return {kind:'reconstruction',context,sha256:jsonDigest(context),reason:'Native restoration unavailable; reconstructed from frozen Host input/instructions and scoped retained messages.'};
  }
  /** Host-only private accessor. The returned bytes/hash must be used unchanged at handoff. */
  async readTeamReconstructionContext(waitId:string):Promise<TeamSavedContext&{kind:'reconstruction'}> {
    return this.transaction(async client=>{const row=await this.teamWaitRow(client,waitId);await this.teamWaitCurrent(client,row.acceptance);if(row.saved_context?.kind==='reconstruction')return row.saved_context;const context=await this.teamReconstruction(client,row.acceptance);await client.query('UPDATE hima.team_waits SET saved_context=$2 WHERE wait_id=$1 AND saved_context IS NULL',[waitId,JSON.stringify(context)]);return context;},'hima.readTeamReconstructionContext');
  }
  async recordTeamHandoff(input:{readonly waitId:string;readonly parentIdentity:TaskIdentity;readonly context:TeamSavedContext;readonly closureProof:JsonValue}):Promise<void> {
    taskIdentity.parse(input.parentIdentity);taskJsonValue.parse(input.context);taskJsonValue.parse(input.closureProof);
    await this.transaction(async client=>{
      await client.query('SELECT singleton FROM hima.host_exit WHERE singleton=true FOR SHARE');
      const row=await this.teamWaitRow(client,input.waitId);await this.#run(client,row.acceptance.parentIdentity.runId,true);
      if(jsonDigest(row.acceptance.parentIdentity)!==jsonDigest(input.parentIdentity))mismatch('Team handoff parent');
      // Physical cleanup/capture remain recordable after stop; this does not authorize child work.
      if(row.closure_proof) {if(jsonDigest([row.saved_context,row.closure_proof])!==jsonDigest([input.context,input.closureProof]))mismatch('Team handoff');return;}
      const facts=Object.fromEntries((await client.query<{phase:string;fact:JsonValue}>(`SELECT phase,fact FROM hima.effect_facts
        WHERE effect_id=$1 AND left(phase,length('native:oar:observation:'))<>'native:oar:observation:'`,[input.parentIdentity.effectId])).rows.map(f=>[f.phase,f.fact]));
      const proof=facts['native:oar:closed'] as {absent?:boolean;group?:number;observedAt?:string}|undefined;
      const lease=(await client.query<{released_at:string|null;proof:JsonValue|null}>('SELECT released_at,proof FROM hima.effect_leases WHERE effect_id=$1',[input.parentIdentity.effectId])).rows[0];
      if(!proof||proof.absent!==true||!Number.isSafeInteger(proof.group)||proof.group!<=0||!Number.isFinite(Date.parse(proof.observedAt??''))||!lease||jsonDigest(proof)!==jsonDigest(input.closureProof)||lease.released_at&&jsonDigest(lease.proof)!==jsonDigest(proof))throw new TeamError('hima/team-invalid','Handoff must match actual native closure and original physical lease.');
      const prepared=facts.prepared as unknown as {identity:TaskIdentity;sessionKey:string;generation:number;memberId:string;runtime:string};
      const local=facts['native:oar:local-lease'] as unknown as {sessionKey:string;generation:number;memberId:string;workDirectory:string;processGroup?:number};
      if(!prepared||jsonDigest(prepared.identity)!==jsonDigest(input.parentIdentity)||!local||local.sessionKey!==prepared.sessionKey||local.generation!==prepared.generation||local.memberId!==prepared.memberId||!Object.entries(facts).some(([phase,fact])=>phase.startsWith('native:oar:local-birth:')&&fact!==null&&typeof fact==='object'&&!Array.isArray(fact)&&fact.sessionKey===local.sessionKey&&fact.generation===local.generation&&fact.processGroup===proof.group))throw new TeamError('hima/team-invalid','Handoff native closure differs from its original prepared session and physical process group.');
      if(input.context.kind==='native-checkpoint') {
        const checkpoint=input.context.checkpoint,{sha256,...body}=checkpoint,origin=checkpoint.origin;
        const native=facts['native:oar:native-session'] as unknown as {nativeSession:string;streamGeneration:string;sessionKey:string;generation:number;workDirectory:string}|undefined;
        if(checkpoint.schema!=='hima-oar-native-checkpoint/1'||checkpoint.boundary!=='after-physical-close'||checkpoint.requestId!==row.acceptance.requestId||sha256!==jsonDigest(body)||checkpoint.checkpointId!==jsonDigest({origin,requestId:checkpoint.requestId})||jsonDigest(origin.identity)!==jsonDigest(input.parentIdentity)||origin.sessionKey!==prepared.sessionKey||origin.generation!==prepared.generation||origin.memberId!==prepared.memberId||origin.runtime!==prepared.runtime||origin.cwd!==local.workDirectory||!native||origin.nativeSession!==native.nativeSession||native.sessionKey!==origin.sessionKey||native.generation!==origin.generation||native.workDirectory!==origin.cwd||checkpoint.format!==(origin.runtime==='pi'?'pi-session-jsonl':'opencode-opaque-data')||!Number.isFinite(Date.parse(checkpoint.capturedAt))||Date.parse(checkpoint.capturedAt)<Date.parse(proof.observedAt!)||new Set(checkpoint.files.map(f=>f.path.toLowerCase())).size!==checkpoint.files.length||!checkpoint.files.length||checkpoint.files.length>4096||checkpoint.files.some(file=>!file.path||file.path.startsWith('/')||file.path.includes('\\')||file.path.split('/').some(p=>!p||p==='.'||p==='..')||!Number.isSafeInteger(file.bytes)||file.bytes<0||!/^[a-f0-9]{64}$/.test(file.sha256))||checkpoint.files.reduce((n,f)=>n+f.bytes,0)>64*1024*1024)throw new TeamError('hima/team-invalid','Native checkpoint differs from its exact original retained session or canonical manifest.');
      } else {
        const expected=await this.teamReconstruction(client,row.acceptance);
        if(jsonDigest(expected)!==jsonDigest(input.context))throw new TeamError('hima/team-invalid','Reconstruction must use exact Host-retained context, never a caller summary.');
      }
      await client.query('UPDATE hima.team_waits SET saved_context=$2,closure_proof=$3 WHERE wait_id=$1 AND closure_proof IS NULL',[input.waitId,JSON.stringify(input.context),JSON.stringify(input.closureProof)]);
    },'hima.recordTeamHandoff');
  }
  /** Verify retained original tool and accepted child identity, without recursively
   * entering current-lineage/delegation gates. Callers own current authority checks. */
  private async teamHumanOriginal(client:ClientBase,identity:TaskIdentity) {
    if(!('source' in identity)||identity.source.kind!=='team')throw new TeamError('hima/not-authorized','Formal human requests require the original Team child source.');
    const source=identity.source;
    const invocation=(await client.query<{invocation:FlowInvocationRecord}>('SELECT invocation FROM hima.flow_invocations WHERE run_id=$1 AND effect_id=$2',[identity.runId,identity.effectId])).rows[0]?.invocation;
    const context=invocation?.context as unknown as {flow:CompiledFlow;taskId:string;input:JsonValue}|undefined;
    const task=context?.flow.tasks[identity.taskId];
    const accepted=(await client.query<{acceptance:TeamDelegationAdmission;child_identity:TaskIdentity|null}>(`SELECT acceptance,child_identity FROM hima.team_delegations
      WHERE run_id=$1 AND child_identity->>'effectId'=$2`,[identity.runId,identity.effectId])).rows[0];
    const link=(await client.query<{parent_effect_id:string;child_identity:TaskIdentity;parent_identity:TaskIdentity}>(`SELECT parent_effect_id,child_identity,parent_identity FROM hima.flow_derived_effects
      WHERE run_id=$1 AND child_effect_id=$2 AND purpose='delegation'`,[identity.runId,identity.effectId])).rows[0];
    if(!invocation||!context||!task||task.tool!=='builtin/human-wait'||context.taskId!==identity.taskId||
      jsonDigest(invocation.identity)!==jsonDigest(identity)||identity.irSha256!==context.flow.irSha256||
      jsonDigest(identity.source)!==jsonDigest(context.flow.taskSource)||jsonDigest(identity.method)!==jsonDigest(context.flow.method)||
      !accepted||!accepted.child_identity||jsonDigest(accepted.child_identity)!==jsonDigest(identity)||
      !('target' in accepted.acceptance.delegation.request)||accepted.acceptance.delegation.request.target!=='human'||
      jsonDigest(accepted.acceptance.delegation.flow)!==jsonDigest(context.flow)||
      !link||link.parent_effect_id!==accepted.acceptance.parentEffectId||jsonDigest(link.child_identity)!==jsonDigest(identity))
      throw new TeamError('hima/not-authorized','Use the actual invocation of the original accepted human child.');
    const acceptance=accepted.acceptance,request=acceptance.delegation.request;
    const expectedInput=teamDelegationInput(request);
    if(request.dependsOn.length) {
      const dependencyResults:Record<string,TaskResult>={};
      for(const dependencyId of request.dependsOn) {
        const dependency=(await client.query<{child_identity:TaskIdentity|null}>('SELECT child_identity FROM hima.team_delegations WHERE run_id=$1 AND delegation_id=$2',[identity.runId,dependencyId])).rows[0];
        const result=dependency?.child_identity&&await this.teamCommittedDelivery(client,dependency.child_identity);
        if(!result)throw new TeamError('hima/team-conflict','Human invocation dependency has no original proved delivery.');
        dependencyResults[dependencyId]=result;
      }
      expectedInput.input={delegationInput:expectedInput.input,dependencyResults:dependencyResults as unknown as JsonValue};
    }
    const parent=(await client.query<{invocation:FlowInvocationRecord}>('SELECT invocation FROM hima.flow_invocations WHERE run_id=$1 AND effect_id=$2',[identity.runId,link.parent_effect_id])).rows[0]?.invocation;
    if(!parent||jsonDigest(parent.identity)!==jsonDigest(link.parent_identity))throw new TeamError('hima/team-conflict','Human child parent lineage differs from its original acceptance.');
    if(jsonDigest(context.input)!==jsonDigest(expectedInput))throw new TeamError('hima/team-conflict','Human child retained input differs from its accepted goal/input/closure.');
    if(identity.inputSha256!==jsonDigest(context.input))throw new TeamError('hima/team-conflict','Human child input digest differs from its retained invocation.');
    if(jsonDigest(task.contract.output)!==jsonDigest(request.output))throw new TeamError('hima/team-conflict','Human child output contract differs from its original acceptance.');
    if(invocation.version!==acceptance.revision)throw new TeamError('hima/team-conflict','Human child invocation revision differs from its original acceptance.');
    return {source,invocation,context,task,acceptance,request};
  }
  private teamHumanBinding(original:Awaited<ReturnType<RunStore['teamHumanOriginal']>>,run:DurableRun,principalId:string):TeamHumanRequest {
    return bindTeamHumanRequest({requestId:original.request.requestId,taskId:original.source.taskId,
      runId:run.runId,effectId:original.invocation.identity.effectId,generation:original.acceptance.epoch,
      revision:original.acceptance.revision,principalId,text:original.request.goal,output:original.task.contract.output,
      expiresAt:new Date(Math.min(Date.parse(original.request.deadlineAt),Date.parse(run.opening.deadlineAt))).toISOString()});
  }
  private async teamHumanCurrent(client:ClientBase,run:DurableRun,original:Awaited<ReturnType<RunStore['teamHumanOriginal']>>):Promise<void> {
    const accepted=original.acceptance;
    if(run.cancelled||run.hold||run.owner!==accepted.owner||run.epoch!==accepted.epoch||run.revision!==accepted.revision||
      run.applicationVersion!==this.applicationVersion||original.invocation.identity.applicationVersion!==run.applicationVersion)
      throw new TeamError('hima/not-authorized','Original human request control, owner, generation or revision is no longer current.');
    await this.#assertFlowEffectCurrent(client,run,original.invocation.identity.effectId);
  }
  async prepareTeamHumanRequest(identity:TaskIdentity):Promise<TeamHumanRequest> {
    taskIdentity.parse(identity);
    return this.transaction(async client=>{
      await this.#assertHostAdmission(client);
      const run=await this.#run(client,identity.runId,true),original=await this.teamHumanOriginal(client,identity);
      await this.teamHumanCurrent(client,run,original);
      const operator=(await client.query<{actor_id:string}>('SELECT actor_id FROM hima.host_operator WHERE singleton=true FOR SHARE')).rows[0];
      if(!operator?.actor_id)throw new TeamError('hima/not-authorized','The Host operator identity must already be initialized.');
      const request=this.teamHumanBinding(original,run,operator.actor_id),digest=jsonDigest(request);
      if(Date.now()>=Math.min(Date.parse(request.binding.expiresAt),Date.parse(run.deadlineAt)))throw new TeamError('hima/not-authorized','Original human request deadline has expired.');
      await this.#prepareEffect(client,identity,{kind:'human-wait',version:taskEffectAdapterVersion,input:original.context.input});
      const inserted=await client.query(`INSERT INTO hima.team_human_requests(task_id,request_id,run_id,effect_id,digest,request)
        VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,[request.binding.taskId,request.binding.requestId,run.runId,identity.effectId,digest,JSON.stringify(request)]);
      const held=(await client.query<{digest:string;request:TeamHumanRequest;effect_id:string;run_id:string}>('SELECT digest,request,effect_id,run_id FROM hima.team_human_requests WHERE task_id=$1 AND request_id=$2 FOR UPDATE',[request.binding.taskId,request.binding.requestId])).rows[0];
      if(!held||held.digest!==digest||jsonDigest(held.request)!==digest||held.effect_id!==identity.effectId||held.run_id!==run.runId)
        throw new TeamError('hima/team-conflict','This request identity already retains different original human content or binding.');
      if(inserted.rowCount)await this.#emit(client,run.runId,factIdentity('team-human-request',request.binding.taskId,request.binding.requestId),'team-human-request',request as unknown as JsonValue);
      return held.request;
    },'hima.prepareTeamHumanRequest');
  }
  /** Bounded projection only. This read never prepares or renews a request. */
  async readTeamHumanRequests(actor:TeamDefinitionActor,ref:TaskRef):Promise<readonly TeamHumanRequest[]> {
    return this.transaction(async client=>{
      const {run}=await this.workspaceAccess(client,actor,ref,'read-task');
      const exit=(await client.query<{active_request:string|null;finalizing:boolean}>('SELECT active_request,finalizing FROM hima.host_exit WHERE singleton=true')).rows[0];
      if(run.cancelled||run.hold||exit?.active_request||exit?.finalizing||Date.now()>=Date.parse(run.deadlineAt)||run.applicationVersion!==this.applicationVersion)return [];
      const rows=(await client.query<{digest:string;request:TeamHumanRequest;invocation:FlowInvocationRecord}>(`SELECT h.digest,h.request,i.invocation FROM hima.team_human_requests h JOIN hima.flow_invocations i USING(effect_id)
        WHERE h.task_id=$1 AND h.run_id=$2 AND h.response IS NULL ORDER BY h.request_id LIMIT 100`,[ref.taskId,run.runId])).rows;
      const requests:TeamHumanRequest[]=[];
      for(const row of rows) {
        if(jsonDigest(row.request)!==row.digest)throw new TeamError('hima/team-conflict','Retained human request digest differs.');
        const original=await this.teamHumanOriginal(client,row.invocation.identity);
        const operator=(await client.query<{actor_id:string}>('SELECT actor_id FROM hima.host_operator WHERE singleton=true FOR SHARE')).rows[0];
        if(!operator||jsonDigest(this.teamHumanBinding(original,run,operator.actor_id))!==row.digest)throw new TeamError('hima/team-conflict','Retained human request does not match its original authority.');
        if(Date.now()>=Date.parse(row.request.binding.expiresAt)||run.owner!==original.acceptance.owner||run.epoch!==original.acceptance.epoch||run.revision!==original.acceptance.revision)continue;
        if(await this.workspaceEffectCurrent(client,run,row.invocation.identity.effectId))requests.push(row.request);
      }
      return requests;
    },'hima.readTeamHumanRequests');
  }
  /** Runs before command replay: a valid old receipt cannot authorize a forged,
   * stale, held, late or differently sourced response. */
  private async teamHumanResponseAdmission(client:ClientBase,run:DurableRun,command:DurableCommand) {
    if(command.scope||!command.response)throw new TeamError('hima/team-invalid','Human response needs the original effect and output.');
    const invocation=(await client.query<{invocation:FlowInvocationRecord}>('SELECT invocation FROM hima.flow_invocations WHERE run_id=$1 AND effect_id=$2',[run.runId,command.response.effectId])).rows[0]?.invocation;
    const context=invocation?.context as unknown as {flow:CompiledFlow}|undefined;
    if(!invocation||context?.flow.tasks[invocation.identity.taskId]?.tool!=='builtin/human-wait')throw new TeamError('hima/not-authorized','Respond only to an original human intervention.');
    const isTeam='source' in invocation.identity&&invocation.identity.source.kind==='team';
    if(!isTeam) {
      if(command.response.teamRequest)throw new TeamError('hima/team-invalid','A formal Team envelope cannot target a non-Team effect.');
      return undefined;
    }
    if(command.origin!=='human'||!command.actor?.trim()||!command.response.teamRequest)throw new TeamError('hima/not-authorized','Team human response requires the authenticated operator and formal original binding.');
    const original=await this.teamHumanOriginal(client,invocation.identity);
    await this.teamHumanCurrent(client,run,original);
    const effect=(await client.query<{identity:TaskIdentity;intent:JsonValue}>('SELECT identity,intent FROM hima.effects WHERE run_id=$1 AND effect_id=$2',[run.runId,invocation.identity.effectId])).rows[0];
    if(!effect||jsonDigest(effect.identity)!==jsonDigest(invocation.identity)||jsonDigest(effect.intent)!==jsonDigest({kind:'human-wait',version:taskEffectAdapterVersion,input:original.context.input}))
      throw new TeamError('hima/team-conflict','Human response requires the exact original prepared human effect intent.');
    if(command.owner!==run.owner||command.epoch!==run.epoch||command.revision!==run.revision)throw new TeamError('hima/team-conflict','Human response command control is stale.');
    const operator=(await client.query<{actor_id:string}>('SELECT actor_id FROM hima.host_operator WHERE singleton=true FOR SHARE')).rows[0];
    if(operator?.actor_id!==command.actor)throw new TeamError('hima/not-authorized','Only the initialized Host operator may settle this human request.');
    const row=(await client.query<{digest:string;request:TeamHumanRequest;response:TeamHumanResponse|null;response_digest:string|null}>('SELECT digest,request,response,response_digest FROM hima.team_human_requests WHERE effect_id=$1 AND task_id=$2 AND run_id=$3 FOR UPDATE',[invocation.identity.effectId,original.source.taskId,run.runId])).rows[0];
    if(!row||jsonDigest(row.request)!==row.digest||jsonDigest(this.teamHumanBinding(original,run,operator.actor_id))!==row.digest)
      throw new TeamError('hima/team-conflict','Human response has no exact retained original request.');
    const at=Date.now();
    if(at>=Math.min(Date.parse(row.request.binding.expiresAt),Date.parse(run.deadlineAt)))throw new TeamError('hima/not-authorized','Original human request or Run deadline has expired.');
    const response:TeamHumanResponse={...command.response.teamRequest,output:command.response.output};
    const output=validateTeamHumanResponse(row.request,response,command.actor,at,original.context.flow.localSchemas);
    createTaskResult(invocation.identity,original.task.contract,output,original.context.flow.localSchemas);
    const responseDigest=jsonDigest(response);
    if(row.response!==null) {
      if(row.response_digest!==jsonDigest(row.response)||row.response_digest!==responseDigest)throw new TeamError('hima/team-conflict','Human request already retains a different response.');
      const fact=(await client.query<{digest:string;value:JsonValue}>('SELECT digest,value FROM hima.flow_facts WHERE run_id=$1 AND name=$2',[run.runId,`response:${invocation.identity.effectId}`])).rows[0];
      if(!fact||fact.digest!==jsonDigest(output)||jsonDigest(fact.value)!==fact.digest)throw new TeamError('hima/team-conflict','Settled human response differs from its immutable response fact.');
    } else if(row.response_digest!==null)throw new TeamError('hima/team-conflict','Unsettled human request has an unexpected response digest.');
    return {response,responseDigest,settled:row.response!==null};
  }
  /** Retained tool-specific proof only: never call current-lineage or delegationGate
   * here, because those consumers use this helper for their deadline exception. */
  private async teamCommittedDelivery(client:ClientBase,identity:TaskIdentity):Promise<TaskResult|undefined> {
    const row=(await client.query<{result:TaskResult;result_sha256:string;identity:TaskIdentity;intent:JsonValue;invocation:FlowInvocationRecord;fact:JsonValue;proof:JsonValue;site_id:string;claim:EffectResourceClaim}>(`SELECT r.result,r.result_sha256,e.identity,e.intent,i.invocation,f.fact,l.proof,l.site_id,l.claim
      FROM hima.results r JOIN hima.effects e USING(effect_id) JOIN hima.flow_invocations i USING(effect_id)
      JOIN hima.effect_leases l USING(effect_id) JOIN hima.effect_facts f ON f.effect_id=r.effect_id AND f.phase='validated-result'
      WHERE r.run_id=$1 AND r.effect_id=$2 AND l.released_at IS NOT NULL`,[identity.runId,identity.effectId])).rows[0];
    if(!row)return undefined;
    if(jsonDigest(row.identity)!==jsonDigest(identity)||jsonDigest(row.invocation.identity)!==jsonDigest(identity)||jsonDigest(row.result.identity)!==jsonDigest(identity)||
      jsonDigest(row.result)!==row.result_sha256||jsonDigest(row.fact)!==row.result_sha256)return undefined;
    const context=row.invocation.context as unknown as {flow:CompiledFlow;taskId:string;input:JsonValue};
    const task=context.flow.tasks[identity.taskId];
    if(!task||context.taskId!==identity.taskId)return undefined;
    const output={schemaVersion:row.result.outputSchemaVersion,value:row.result.value,artifacts:row.result.artifacts,diagnostics:row.result.diagnostics};
    if(jsonDigest(createTaskResult(identity,task.contract,output,context.flow.localSchemas))!==row.result_sha256)return undefined;
    if(task.tool==='resident/team-member') {
      const native=(await client.query<{fact:JsonValue}>("SELECT fact FROM hima.effect_facts WHERE effect_id=$1 AND phase='native:oar:closed'",[identity.effectId])).rows[0]?.fact;
      return native&&jsonDigest(row.proof)===jsonDigest(native)?row.result:undefined;
    }
    if(task.tool!=='builtin/human-wait')return undefined;
    const original=await this.teamHumanOriginal(client,identity),run=await this.#run(client,identity.runId);
    const human=(await client.query<{digest:string;request:TeamHumanRequest;response:TeamHumanResponse|null;response_digest:string|null}>('SELECT digest,request,response,response_digest FROM hima.team_human_requests WHERE effect_id=$1 AND run_id=$2 AND task_id=$3',[identity.effectId,identity.runId,original.source.taskId])).rows[0];
    const fact=(await client.query<{digest:string;value:JsonValue}>('SELECT digest,value FROM hima.flow_facts WHERE run_id=$1 AND name=$2',[identity.runId,`response:${identity.effectId}`])).rows[0];
    if(!human?.response||!human.response_digest||jsonDigest(human.request)!==human.digest||jsonDigest(human.response)!==human.response_digest||
      jsonDigest(this.teamHumanBinding(original,run,human.request.binding.principalId))!==human.digest||
      human.response.requestId!==human.request.binding.requestId||jsonDigest(human.response.binding)!==jsonDigest(human.request.binding)||
      !fact||jsonDigest(fact.value)!==fact.digest||jsonDigest(human.response.output)!==fact.digest||jsonDigest(output)!==fact.digest||
      jsonDigest(row.intent)!==jsonDigest({kind:'human-wait',version:taskEffectAdapterVersion,input:context.input})||
      row.site_id!=='@human'||jsonDigest(row.claim)!==jsonDigest({siteId:'@human',jobs:0,licences:{}})||
      jsonDigest(row.proof)!==jsonDigest({humanResponse:true,closed:true}))return undefined;
    // Timely settlement remains readable after the child expiry; current permission
    // is checked by the caller, never by synthesizing a new response admission.
    if(jsonDigest(createTaskResult(identity,original.task.contract,human.response.output,context.flow.localSchemas))!==row.result_sha256)return undefined;
    return row.result;
  }
  async readTeamCommittedDelivery(identity:TaskIdentity):Promise<TaskResult|undefined> {
    taskIdentity.parse(identity);
    if(!('source' in identity)||identity.source.kind!=='team')throw new TeamError('hima/not-authorized','Read a committed delivery of the original Team invocation.');
    return this.transaction(async client=>{
      await client.query('SELECT singleton FROM hima.host_exit WHERE singleton=true FOR SHARE');
      const run=await this.#run(client,identity.runId,true);
      if(run.cancelled||run.hold||Date.now()>=Date.parse(run.deadlineAt)||run.applicationVersion!==this.applicationVersion)throw new TeamError('hima/not-authorized','Current Team task control does not admit this result read.');
      await this.#assertFlowEffectCurrent(client,run,identity.effectId);
      return this.teamCommittedDelivery(client,identity);
    },'hima.readTeamCommittedDelivery');
  }

  private async teamWaitInputs(client:ClientBase,wait:TeamWaitAcceptance):Promise<readonly TeamResultInput[]> {
    const run=await this.teamWaitCurrent(client,wait),inputs:TeamResultInput[]=[];
    const closure=await this.teamWaitClosure(client,wait.rootIdentity,wait.parentIdentity.effectId,wait.delegationIds);
    const previous=(await client.query<{continuation:TeamEffectContinuation}>('SELECT continuation FROM hima.team_effect_continuations WHERE wait_id=$1',[wait.waitId])).rows[0]?.continuation;
    const delegationIds=previous?previous.inputs.map(input=>input.delegationId):closure.map(child=>child.acceptance.delegation.delegationId);
    for(const delegationId of delegationIds) {
      const row=(await client.query<{acceptance:TeamDelegationAdmission;child_identity:TaskIdentity|null}>('SELECT acceptance,child_identity FROM hima.team_delegations WHERE run_id=$1 AND delegation_id=$2',[run.runId,delegationId])).rows[0];
      if(!row?.child_identity)throw new TeamError('hima/team-conflict','An accepted child has no committed result.');
      const gate=await this.delegationGate(client,run.runId,delegationId,'result');
      if(gate.state!=='ready')throw new TeamError('hima/not-authorized',gate.reason??'Child lineage no longer admits continuation.');
      await this.#assertFlowEffectCurrent(client,run,row.child_identity.effectId);
      const result=await this.teamCommittedDelivery(client,row.child_identity);
      if(!result)throw new TeamError('hima/team-conflict','Child committed delivery or exact physical closure is unproved.');
      inputs.push({delegationId,childEffectId:row.child_identity.effectId,resultSha256:jsonDigest(result),result});
    }
    return inputs;
  }
  async acceptTeamEffectContinuation(waitId:string):Promise<TeamEffectContinuation> {
    return this.transaction(async client=>{
      const row=await this.teamWaitRow(client,waitId),run=await this.teamWaitCurrent(client,row.acceptance);
      const previous=(await client.query<{continuation:TeamEffectContinuation}>('SELECT continuation FROM hima.team_effect_continuations WHERE wait_id=$1',[waitId])).rows[0]?.continuation;
      const inputs=await this.teamWaitInputs(client,row.acceptance);
      if(previous){if(jsonDigest(previous.inputs)!==jsonDigest(inputs))mismatch('Team continuation inputs');return previous;}
      if(!row.saved_context||!row.closure_proof)throw new TeamError('hima/team-conflict','Original context and physical handoff remain unproved.');
      const release=(await client.query<{proof:JsonValue;released_at:string|null}>('SELECT proof,released_at FROM hima.effect_leases WHERE effect_id=$1',[row.acceptance.parentIdentity.effectId])).rows[0];
      if(!release?.released_at||jsonDigest(release.proof)!==jsonDigest(row.closure_proof))throw new TeamError('hima/team-conflict','Original parent still owns physical capacity.');
      const head=await this.teamHead(client,row.acceptance.rootIdentity);
      if(head.invocation.identity.effectId!==row.acceptance.parentIdentity.effectId||head.wait?.waitId!==waitId)throw new TeamError('hima/team-conflict','Another continuation already replaced the logical task head.');
      const continuationId=factIdentity('team-effect-continuation',waitId,jsonDigest(inputs));
      const identity=taskIdentity.parse({...head.invocation.identity,effectId:factIdentity('team-successor-effect',continuationId)});
      const invocation:FlowInvocationRecord={...head.invocation,identity};
      const partial={continuationId,waitId,rootIdentity:row.acceptance.rootIdentity,predecessorIdentity:row.acceptance.parentIdentity,invocation,context:row.saved_context,deadlineAt:new Date(Math.min(Date.parse(run.deadlineAt),Date.parse(run.opening.deadlineAt))).toISOString(),inputs,hostInputId:`hima-input-${jsonDigest(identity).slice(0,32)}`};
      const execution=invocation.context as unknown as {flow:CompiledFlow;taskId:string};
      const definition=(run.opening.data as unknown as {definition:TeamDefinition}).definition;
      const task=execution.flow.tasks[execution.taskId]!,member=definition.members.find(m=>m.id===task.memberId);
      if(!member)throw new TeamError('hima/team-invalid','Frozen continuation member is unavailable.');
      const hostPrompt=teamContinuationPrompt({identity,instructions:member.instructions,skills:member.skills,contract:taskJsonValue.parse(task.contract),context:row.saved_context,inputs,requestedDelegationIds:row.acceptance.delegationIds,deadlineAt:partial.deadlineAt});
      if(Buffer.byteLength(hostPrompt)>512*1024)throw new TeamError('hima/team-invalid','Host result-continuation input exceeds the retained size bound.');
      const continuation:TeamEffectContinuation={...partial,hostPrompt,hostInputSha256:memoryTextSha256(hostPrompt)};
      await client.query('INSERT INTO hima.flow_invocations(effect_id,run_id,task_id,version,branches,invocation,admitted_generation) VALUES($1,$2,$3,$4,$5,$6,$7)',[identity.effectId,identity.runId,identity.taskId,invocation.version,JSON.stringify(invocation.branches),JSON.stringify(invocation),run.epoch]);
      await client.query('INSERT INTO hima.team_effect_continuations(continuation_id,wait_id,run_id,root_effect_id,predecessor_effect_id,successor_effect_id,continuation) VALUES($1,$2,$3,$4,$5,$6,$7)',[continuationId,waitId,run.runId,row.acceptance.rootIdentity.effectId,row.acceptance.parentIdentity.effectId,identity.effectId,JSON.stringify(continuation)]);
      await client.query('INSERT INTO hima.flow_derived_effects(child_effect_id,parent_effect_id,run_id,parent_identity,child_identity,purpose) VALUES($1,$2,$3,$4,$5,$6)',[identity.effectId,row.acceptance.parentIdentity.effectId,run.runId,JSON.stringify(row.acceptance.parentIdentity),JSON.stringify(identity),'continuation']);
      await this.#emit(client,run.runId,continuationId,'team-effect-continuation',{continuationId,waitId,rootIdentity:partial.rootIdentity,predecessorIdentity:partial.predecessorIdentity,identity,hostInputId:partial.hostInputId,hostInputSha256:continuation.hostInputSha256} as unknown as JsonValue);
      return continuation;
    },'hima.acceptTeamEffectContinuation');
  }
  private async teamExecutionBinding(client:ClientBase,identity:TaskIdentity):Promise<{deadlineAt:string;continuation?:TeamEffectContinuation;initialHostPrompt?:string}> {
    const run=await this.#run(client,identity.runId);
    const held=(await client.query<{invocation:FlowInvocationRecord}>('SELECT invocation FROM hima.flow_invocations WHERE effect_id=$1 AND run_id=$2',[identity.effectId,identity.runId])).rows[0]?.invocation;
    if(!held||jsonDigest(held.identity)!==jsonDigest(identity))mismatch('Team execution binding');
    const deadlines=(await client.query<{acceptance:TeamDelegationAdmission}>(`WITH RECURSIVE ancestry(effect_id) AS (SELECT $1::text UNION SELECT d.parent_effect_id FROM hima.flow_derived_effects d JOIN ancestry a ON d.child_effect_id=a.effect_id WHERE d.run_id=$2) SELECT t.acceptance FROM hima.team_delegations t JOIN ancestry a ON t.child_identity->>'effectId'=a.effect_id WHERE t.run_id=$2`,[identity.effectId,identity.runId])).rows;
    const continuation=(await client.query<{continuation:TeamEffectContinuation}>('SELECT continuation FROM hima.team_effect_continuations WHERE successor_effect_id=$1 AND run_id=$2',[identity.effectId,identity.runId])).rows[0]?.continuation;
    const opening=run.opening.data as unknown as {initialHostContext?:{source:string;predecessorRunId:string;runId:string;context:JsonValue;sha256:string;hostPrompt:string;hostPromptSha256:string};definition:TeamDefinition;start:FlowStart};
    const initial=opening.initialHostContext;
    let initialHostPrompt:string|undefined;
    if(initial&&!continuation&&identity.taskId===Object.values(opening.start.flow.tasks).find(task=>task.memberId===opening.definition.leaderMemberId)?.id) {
      const edge=(await client.query<{acceptance:{cause?:string}}>('SELECT acceptance FROM hima.team_continuation_requests WHERE previous_run_id=$1 AND current_run_id=$2',[initial.predecessorRunId,run.runId])).rows[0]?.acceptance;
      if(!['post-exit','post-pause','definition-change'].includes(initial.source)||initial.runId!==run.runId||jsonDigest(initial.context)!==initial.sha256||memoryTextSha256(initial.hostPrompt)!==initial.hostPromptSha256||(edge?.cause??'post-exit')!==initial.source)throw new Error('Team reconstruction source or digest differs from its retained acceptance');
      if(initial.source==='definition-change') {
        const accepted=(await client.query<{acceptance:{cause?:string;gateRequestId?:string;gateSha256?:string;selected?:TeamTaskView['team']}}>('SELECT acceptance FROM hima.team_continuation_requests WHERE previous_run_id=$1 AND current_run_id=$2',[initial.predecessorRunId,run.runId])).rows[0]?.acceptance;
        const data=run.opening.data as unknown as {source:{taskId:string;team:TeamTaskView['team']}};
        const gate=(await client.query<{gate:TeamDefinitionHandoffGate}>('SELECT gate FROM hima.team_definition_handoffs WHERE task_id=$1 AND request_id=$2',[data.source.taskId,accepted?.gateRequestId])).rows[0]?.gate;
        const context=initial as typeof initial & {gateRequestId?:string;gateSha256?:string};
        if(!gate||accepted?.cause!=='definition-change'||accepted.gateSha256!==jsonDigest(gate)||context.gateRequestId!==gate.request.requestId||context.gateSha256!==jsonDigest(gate)||jsonDigest(accepted.selected)!==jsonDigest(data.source.team))throw new Error('Saved-definition reconstruction has no exact retained gate acceptance');
      }
      initialHostPrompt=initial.hostPrompt;
    }
    const pack=await this.packBinding(client,run.runId);
    const parent=pack?await this.#run(client,pack.parentIdentity.runId):undefined;
    const reserve=(parent?.opening.data as {budget?:{closingReserveMs?:number}}|undefined)?.budget?.closingReserveMs??0;
    return {deadlineAt:new Date(Math.min(...(parent?[Date.parse(parent.deadlineAt)-reserve]:[]),Date.parse(run.deadlineAt),Date.parse(run.opening.deadlineAt),...deadlines.map(row=>Date.parse(row.acceptance.delegation.request.deadlineAt)),...(continuation?[Date.parse(continuation.deadlineAt)]:[]))).toISOString(),...(continuation?{continuation}:{}),...(initialHostPrompt?{initialHostPrompt}:{})};
  }
  async readTeamExecutionBinding(identity:TaskIdentity):Promise<{readonly deadlineAt:string;readonly continuation?:TeamEffectContinuation;readonly initialHostPrompt?:string}> {
    taskIdentity.parse(identity);return this.transaction(client=>this.teamExecutionBinding(client,identity),'hima.readTeamExecutionBinding');
  }
  async recordTeamResultInputReceipt(input:{readonly continuationId:string;readonly successorIdentity:TaskIdentity;readonly hostInputId:string;readonly hostInputSha256:string;readonly nativeReceipt:JsonValue}):Promise<void> {
    await this.#externalTransaction(async client=>{
      await this.#assertHostAdmission(client);
      const run=await this.#run(client,input.successorIdentity.runId,true);
      const continuation=(await client.query<{continuation:TeamEffectContinuation}>('SELECT continuation FROM hima.team_effect_continuations WHERE continuation_id=$1 AND successor_effect_id=$2',[input.continuationId,input.successorIdentity.effectId])).rows[0]?.continuation;
      if(!continuation||jsonDigest(continuation.invocation.identity)!==jsonDigest(input.successorIdentity)||input.hostInputId!==continuation.hostInputId||input.hostInputSha256!==continuation.hostInputSha256)mismatch('Team result input');
      const inputs=await this.teamWaitInputs(client,(await this.teamWaitRow(client,continuation.waitId)).acceptance);
      if(jsonDigest(inputs)!==jsonDigest(continuation.inputs))mismatch('Team result-continuation inputs');
      const receiptPhase='team-result-input-receipt:'+input.continuationId;
      const prior=(await client.query<{fact:JsonValue}>('SELECT fact FROM hima.effect_facts WHERE effect_id=$1 AND phase=$2',
        [input.successorIdentity.effectId,receiptPhase])).rows[0]?.fact;
      if(prior){if(jsonDigest(prior)!==jsonDigest(input))mismatch('Team result input receipt');return;}
      await this.#assertFlowEffectCurrent(client,run,input.successorIdentity.effectId);
      const prepared=(await client.query<{fact:{identity:TaskIdentity;inputId:string;prompt:string;sessionKey:string;generation:number}}>("SELECT fact FROM hima.effect_facts WHERE effect_id=$1 AND phase='prepared'",[input.successorIdentity.effectId])).rows[0]?.fact;
      if(!prepared||jsonDigest(prepared.identity)!==jsonDigest(input.successorIdentity)||prepared.inputId!==input.hostInputId||memoryTextSha256(prepared.prompt)!==input.hostInputSha256)throw new TeamError('hima/team-conflict','Actual retained successor plan differs from the Host result-continuation input.');
      const observations=(await client.query<{fact:{kind:string;nativeSession:string;streamGeneration:string;seq:number;time:string;payload?:{inputId?:string}}}>(`SELECT fact FROM hima.effect_facts
        WHERE effect_id=$1 AND left(phase,length('native:oar:observation:'))='native:oar:observation:'
          AND (fact->>'kind'='created' OR (fact->>'kind'='received' AND fact->'payload'->>'inputId'=$2))
        ORDER BY (fact->>'seq')::bigint LIMIT 17`,[input.successorIdentity.effectId,input.hostInputId])).rows.map(row=>row.fact);
      if(observations.length>16)throw new TeamError('hima/team-invalid','Native result input has ambiguous retained observations.');
      const native=(await client.query<{fact:{nativeSession:string;streamGeneration:string;sessionKey:string;generation:number}}>("SELECT fact FROM hima.effect_facts WHERE effect_id=$1 AND phase='native:oar:native-session'",[input.successorIdentity.effectId])).rows[0]?.fact;
      const born=observations.find(row=>row.kind==='created'&&row.nativeSession===native?.nativeSession&&row.streamGeneration===native?.streamGeneration);
      const received=observations.find(row=>row.kind==='received'&&row.payload?.inputId===input.hostInputId&&row.nativeSession===born?.nativeSession&&row.streamGeneration===born?.streamGeneration);
      const expected=received?{nativeReceiptId:received.nativeSession+':'+received.streamGeneration+':'+received.seq,receivedAt:received.time,sessionKey:prepared.sessionKey,generation:prepared.generation,inputId:input.hostInputId}:null;
      if(!expected||!native||native.sessionKey!==prepared.sessionKey||native.generation!==prepared.generation||jsonDigest(expected)!==jsonDigest(input.nativeReceipt))throw new TeamError('hima/team-invalid','No exact retained current native receive observation; queue ACK cannot receive child results.');
      await this.#recordEffectFact(client,input.successorIdentity,receiptPhase,taskJsonValue.parse(input));
    });
  }
  async issueTeamGrant(value:ActorGrant):Promise<{grant:ActorGrant;token:string}> {
    const grant=actorGrant.parse(value);
    return this.transaction(async client=>{
      const token=randomBytes(32).toString('base64url');
      await this.#assertHostAdmission(client);
      const run=await this.#run(client,grant.runId,true),data=run.opening.data as unknown as {source?:import('./task-contract.js').TaskSource;definition?:TeamDefinition;actor?:TeamDefinitionActor;start?:{runInput?:{input?:unknown}}};
      const invocation=(await client.query<{invocation:FlowInvocationRecord}>('SELECT invocation FROM hima.flow_invocations WHERE effect_id=$1 AND run_id=$2',[grant.effectId,grant.runId])).rows[0]?.invocation;
      if(!invocation||(invocation.context as unknown as {flow:CompiledFlow}).flow.tasks[invocation.identity.taskId]?.memberId!==grant.memberId||grant.actorId!==grant.memberId||('source' in invocation.identity && jsonDigest(invocation.identity.source)!==jsonDigest(data.source))||(grant.capabilities.includes('delegate')&&data.definition?.leaderMemberId!==grant.memberId))throw new TeamError('hima/not-authorized','Grant must bind the exact Host member and invocation source.');
      const member=data.definition?.members.find(row=>row.id===grant.memberId);
      if(grant.capabilities.includes('adopt-memory')&&data.actor?.kind!=='human')
        throw new TeamError('hima/not-authorized','Memory adoption requires an authenticated human-opened Team task.');
      if(grant.capabilities.includes('adopt-memory')&&!member?.toolRefs.includes('hima-memory-adopt'))
        throw new TeamError('hima/not-authorized','Memory adoption capability must be declared by the frozen member role.');
      if((grant.capabilities.includes('github-push')&&!member?.toolRefs.includes('hima-github-push'))
        ||(grant.capabilities.includes('github-pr')&&(!member?.toolRefs.includes('hima-github-pr')||data.definition?.leaderMemberId!==grant.memberId)))
        throw new TeamError('hima/not-authorized','GitHub capability must be declared by the frozen member role.');
      if(grant.capabilities.includes('github-push')||grant.capabilities.includes('github-pr')) {
        if(data.actor?.kind!=='human')throw new TeamError('hima/not-authorized','GitHub writes require the authenticated human to open the exact Team task.');
        try {parseTeamGitHubTask(data.start?.runInput?.input);}catch {throw new TeamError('hima/not-authorized','GitHub writes require an exact repository, Issue, base commit and task branch in the original opening.');}
      }
      await this.#assertFlowEffectCurrent(client,run,grant.effectId);
      if(run.cancelled||run.hold||run.epoch!==grant.generation||Date.now()>=Date.parse(run.deadlineAt)||Date.parse(grant.expiresAt)>Date.parse(run.deadlineAt)||Date.now()>=Date.parse(grant.expiresAt)
        ||data.source?.kind!=='team'||data.source.projectId!==grant.projectId||data.source.taskId!==grant.taskId||data.source.team.teamId!==grant.teamId||!data.definition?.members.some(member=>member.id===grant.memberId))throw new TeamError('hima/not-authorized','Grant does not match current task, member, generation or deadline.');
      await client.query('INSERT INTO hima.task_actor_grants(grant_id,task_id,token_sha256,grant_data) VALUES($1,$2,$3,$4)',[grant.grantId,grant.taskId,jsonDigest(token),JSON.stringify(grant)]);
      return {grant,token};
    },'hima.issueTeamGrant');
  }
  /** Cleanup reads retained operator revocation through the original effect ancestry;
   * ordinary yield/close acknowledgements do not grant a new stop cause. */
  async teamEffectOperatorRevoked(identity:TaskIdentity):Promise<boolean> {
    return this.#externalTransaction(async client=>{
      const rows=await client.query<{grant_data:ActorGrant}>(teamOperatorRevocationSQL,[identity.effectId,identity.runId]);
      if(rows.rows.some(row=>Boolean(row.grant_data.revokedAt)&&row.grant_data.revocationCause==='operator'))return true;
      // An immutable child link still points to its admission parent; its later
      // actual causal waiter also owns effective authority for dispatch/cleanup.
      const delegations=(await client.query<{delegation_id:string}>(`WITH RECURSIVE ancestry(effect_id) AS (SELECT $1::text UNION SELECT d.parent_effect_id FROM hima.flow_derived_effects d JOIN ancestry a ON d.child_effect_id=a.effect_id WHERE d.run_id=$2) SELECT t.delegation_id FROM hima.team_delegations t JOIN ancestry a ON t.child_identity->>'effectId'=a.effect_id WHERE t.run_id=$2`,[identity.effectId,identity.runId])).rows;
      for(const delegation of delegations) {
        const wait=await this.teamDelegationWait(client,identity.runId,delegation.delegation_id);
        if(wait?.acceptance.actor.kind!=='member')continue;
        const grant=(await client.query<{grant_data:ActorGrant}>('SELECT grant_data FROM hima.task_actor_grants WHERE grant_id=$1 FOR SHARE',[wait.acceptance.actor.grant.grantId])).rows[0]?.grant_data;
        if(grant?.revokedAt&&grant.revocationCause==='operator')return true;
      }
      return false;
    });
  }
  async readTeamGrant(grantId:string):Promise<ActorGrant|undefined> {
    const row=(await this.#pool.query<{grant_data:ActorGrant}>('SELECT grant_data FROM hima.task_actor_grants WHERE grant_id=$1',[grantId])).rows[0];
    return row?actorGrant.parse(row.grant_data):undefined;
  }
  async authorizeTeamGrant(grant:ActorGrant,capability:'read-task'|'send-message'|'read-material'|'query-memory'|'adopt-memory'|'delegate'|'github-push'|'github-pr'):Promise<void> {
    await this.transaction(async client=>{await this.workspaceAccess(client,{kind:'member',grant},{projectId:grant.projectId,teamId:grant.teamId,taskId:grant.taskId},capability);},'hima.authorizeTeamGrant');
  }
  async resolveTeamGrant(token:string):Promise<ActorGrant> {
    const row=(await this.#pool.query<{grant_data:ActorGrant}>('SELECT grant_data FROM hima.task_actor_grants WHERE token_sha256=$1',[jsonDigest(token)])).rows[0];
    if(!row)throw new TeamError('hima/not-authorized','Unknown member capability.');
    const grant=actorGrant.parse(row.grant_data),run=await this.run(grant.runId);
    if(grant.revokedAt||Date.now()>=Date.parse(grant.expiresAt)||Date.now()>=Date.parse(run.deadlineAt)||grant.generation!==run.epoch||run.cancelled||run.hold||await this.hostExit())throw new TeamError('hima/not-authorized','Member capability expired, was revoked, or execution is held/stopped.');
    await this.#externalTransaction(async client=>{await this.#assertHostAdmission(client);const current=await this.#run(client,grant.runId,true);const pack=await this.packBinding(client,current.runId);if(pack)await this.assertPackParent(client,pack,current);});
    return grant;
  }
  async revokeTeamGrant(grantId:string,cause:'yield'|'closed'|'operator'='operator'):Promise<void> {
    // An explicit revocation wins even if a native closer subsequently acknowledges yield.
    await this.#pool.query("UPDATE hima.task_actor_grants SET grant_data=jsonb_set(jsonb_set(grant_data,'{revokedAt}',$2::jsonb),'{revocationCause}',$3::jsonb) WHERE grant_id=$1 AND (grant_data->>'revokedAt' IS NULL OR $4='operator')",[grantId,JSON.stringify(new Date().toISOString()),JSON.stringify(cause),cause]);
  }
  async initialize(): Promise<void> { await migrateRunStore(this.#pool); }
  async close(): Promise<void> { await this.#pool.end(); }
  async transaction<T>(body: (client: ClientBase) => Promise<T>, name: string): Promise<T> {
    return this.#source.runTransaction(() => body(this.#source.client), { name, isolationLevel: 'SERIALIZABLE' });
  }
  /** Host lock always precedes Run locks. App-exit stop admission uses the same boundary. */
  async #assertHostAdmission(client:ClientBase,admission?:EffectAdmission):Promise<boolean> {
    const row=(await client.query<{active_request:string|null;mode:string|null;accepted_at:string|null;finalizing:boolean}>(`SELECT h.active_request,h.finalizing,r.mode,r.accepted_at::text AS accepted_at FROM hima.host_exit h LEFT JOIN hima.host_exit_requests r ON r.request_id=h.active_request WHERE h.singleton=true FOR SHARE OF h`)).rows[0];
    const collecting=admission?Boolean((await client.query(`SELECT 1 FROM hima.flow_derived_effects d JOIN hima.effect_dispatches p ON p.effect_id=d.parent_effect_id
      WHERE d.child_effect_id=$1 AND d.run_id=$2 AND d.purpose='collect' AND p.dispatch_id='submit'
      AND ($3::timestamptz IS NULL OR (p.started_at<=$3::timestamptz
        AND NOT EXISTS(SELECT 1 FROM hima.effect_facts f WHERE f.effect_id=d.parent_effect_id AND f.phase IN ('validated-result','terminal-failure'))
        AND NOT EXISTS(SELECT 1 FROM hima.results r WHERE r.effect_id=d.parent_effect_id)))`,[admission.effectId,admission.runId,row?.accepted_at??null])).rowCount):false;
    const originalPreparation=admission&&row?.active_request&&row.mode==='drain'?Boolean((await client.query(`SELECT 1 FROM hima.effects WHERE effect_id=$1 AND run_id=$2
      AND ((identity->>'taskId'='hima.prepare' AND effect_id='hima-prepare-effect:'||run_id)
        OR (identity->>'taskId'='hima.prepare-revision' AND left(effect_id,length('hima-revision-effect:'))='hima-revision-effect:')
        OR (identity->>'taskId'='hima.apply-revision-input' AND left(effect_id,length('hima-workspace-revision:'))='hima-workspace-revision:'))
      AND admitted_at<=$3::timestamptz`,[admission.effectId,admission.runId,row.accepted_at])).rowCount):false;
    if(row?.finalizing||(row?.active_request&&!(row.mode==='drain'&&(collecting||originalPreparation))))throw new Error('The App is closing; new business admission is fenced');
    return collecting;
  }
  /** Read-only Host status assembly. Taking the admission row exclusively prevents a
   * permitted drain Reader callback crossing readiness while its original facts are read.
   * The reader must not admit, cancel or acquire another Host lifecycle boundary. */
  async readHostExitBoundary<T>(read:()=>Promise<T>):Promise<T> {
    return this.#externalTransaction(async client=>{
      await client.query('SELECT active_request FROM hima.host_exit WHERE singleton=true FOR UPDATE');
      return read();
    });
  }
  /** Stop only under the currently accepted request. The callback is synchronous so
   * Agent cancellation cannot cross a committed replacement/cancellation. */
  async withHostExitStopBoundary(requestId:string,stop:()=>void):Promise<boolean> {
    return this.#externalTransaction(async client=>{
      if(!await this.#hostExitStopActive(client,requestId))return false;
      stop();return true;
    });
  }
  async #hostExitStopActive(client:ClientBase,requestId:string,teamOnly=false):Promise<boolean> {
    const row=(await client.query<{active_request:string|null;mode:string|null;finalizing:boolean}>(`SELECT h.active_request,h.finalizing,r.mode FROM hima.host_exit h LEFT JOIN hima.host_exit_requests r ON r.request_id=h.active_request WHERE h.singleton=true FOR SHARE OF h`)).rows[0];
    return row?.active_request===requestId&&(row.mode==='stop-jobs'||teamOnly)&&!row.finalizing;
  }
  async hostExit():Promise<import('./host-exit.js').HostExitRequest|undefined> {
    const row=(await this.#pool.query<{requestId:string;mode:import('./host-exit.js').HostExitMode}>(`SELECT r.request_id AS "requestId",r.mode FROM hima.host_exit h JOIN hima.host_exit_requests r ON r.request_id=h.active_request WHERE h.singleton=true`)).rows[0];
    return row;
  }
  async lastHostExitRequestId():Promise<string|undefined> {
    return (await this.#pool.query<{request_id:string}>('SELECT request_id FROM hima.host_exit_requests ORDER BY accepted_at DESC LIMIT 1')).rows[0]?.request_id;
  }
  private async fenceTeamRunsForExitWithin(client:ClientBase,requestId:string):Promise<void> {
    const runs=(await client.query<{run_id:string;cancelled:boolean}>("SELECT r.run_id,r.cancelled FROM hima.runs r JOIN hima.team_tasks t ON t.task->>'currentRunId'=r.run_id WHERE r.opening->'data'->'source'->>'kind'='team' AND NOT EXISTS(SELECT 1 FROM hima.flow_facts f WHERE f.run_id=r.run_id AND f.name LIKE 'outcome:%' AND f.value->>'state' IN ('succeeded','failed','cancelled')) FOR UPDATE OF r")).rows;
    for(const run of runs) {
      const factId=factIdentity('team-exit',run.run_id,requestId);
      if((await client.query('SELECT 1 FROM hima.outbox WHERE fact_id=$1',[factId])).rowCount)continue;
      if(!run.cancelled)await client.query("UPDATE hima.runs SET epoch=epoch+1,hold='Team stopped on App exit; explicit controlled continuation required',hold_source='human' WHERE run_id=$1",[run.run_id]);
      await this.#emit(client,run.run_id,factId,'team-exit',{requestId});
    }
  }
  async fenceTeamRunsForExit(requestId:string):Promise<void> {
    await this.#externalTransaction(async client=>{
      const active=(await client.query<{active_request:string|null}>('SELECT active_request FROM hima.host_exit WHERE singleton=true FOR UPDATE')).rows[0];
      if(active?.active_request!==requestId)throw new Error('Team exit fence requires the current Host exit request');
      await this.fenceTeamRunsForExitWithin(client,requestId);
    });
  }
  async acceptHostExit(request:import('./host-exit.js').HostExitRequest):Promise<void> {
    await this.#externalTransaction(async client=>{
      const state=(await client.query<{active_request:string|null;finalizing:boolean}>('SELECT active_request,finalizing FROM hima.host_exit WHERE singleton=true FOR UPDATE')).rows[0]!;
      if(state.finalizing)throw new Error('Host resources are finalizing; exit cannot be replaced or cancelled');
      const active=state.active_request;
      const prior=(await client.query<{mode:string;released_at:unknown;replaces_request:string|null}>('SELECT mode,released_at,replaces_request FROM hima.host_exit_requests WHERE request_id=$1',[request.requestId])).rows[0];
      if(prior&&(prior.mode!==request.mode||prior.released_at||prior.replaces_request!==(request.expectedRequestId??null)))throw new Error('App exit request identity was reused with different contents or after release');
      if(active!==request.requestId) {
        if(request.expectedRequestId!==undefined&&active!==request.expectedRequestId)throw new Error('App exit replacement request is stale');
        if(active&&request.expectedRequestId!==active)throw new Error('Another App exit request is already active');
        if(active)await client.query('UPDATE hima.host_exit_requests SET released_at=clock_timestamp() WHERE request_id=$1',[active]);
      }
      await client.query('INSERT INTO hima.host_exit_requests(request_id,mode,replaces_request) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[request.requestId,request.mode,request.expectedRequestId??null]);
      await client.query('UPDATE hima.host_exit SET active_request=$1 WHERE singleton=true',[request.requestId]);
      await this.fenceTeamRunsForExitWithin(client,request.requestId);
    });
  }
  async beginHostExitFinalization(requestId:string):Promise<void> {
    await this.#externalTransaction(async client=>{
      const state=(await client.query<{active_request:string|null}>('SELECT active_request FROM hima.host_exit WHERE singleton=true FOR UPDATE')).rows[0]!;
      if(state.active_request!==requestId)throw new Error('App exit request is stale');
      await client.query('UPDATE hima.host_exit SET finalizing=true WHERE singleton=true');
    });
  }
  async releaseHostExit(requestId:string,previousLifetime=false):Promise<void> {
    await this.#externalTransaction(async client=>{
      const state=(await client.query<{active_request:string|null;finalizing:boolean}>('SELECT active_request,finalizing FROM hima.host_exit WHERE singleton=true FOR UPDATE')).rows[0]!;
      if(state.active_request!==requestId)throw new Error('App exit request is stale');
      if(state.finalizing&&!previousLifetime)throw new Error('Host resources are finalizing; exit cannot be cancelled');
      await client.query('UPDATE hima.host_exit_requests SET released_at=clock_timestamp() WHERE request_id=$1',[requestId]);
      await client.query('UPDATE hima.host_exit SET active_request=NULL,finalizing=false WHERE singleton=true');
    });
  }
  async #run(client: Pick<ClientBase, 'query'>, runId: string, lock = false): Promise<DurableRun> {
    if(lock) {
      const binding=await this.packBinding(client,runId);
      if(binding) {
        if(binding.parentIdentity.runId===runId)throw new Error('Pack Team parent lock cycle');
        await client.query('SELECT run_id FROM hima.runs WHERE run_id=$1 FOR UPDATE',[binding.parentIdentity.runId]);
        if(jsonDigest(await this.packBinding(client,runId))!==jsonDigest(binding))throw new Error('Pack Team parent binding changed while acquiring Run locks');
      }
    }
    const { rows } = await client.query<DurableRun>(`SELECT ${runColumns} FROM hima.runs WHERE run_id=$1 ${lock ? 'FOR UPDATE' : ''}`, [runId]);
    if (!rows[0]) throw new Error(`Unknown DBOS Run ${runId}`);
    return readRun(rows[0]);
  }
  async run(runId: string): Promise<DurableRun> { return this.#run(this.#pool, runId); }
  /** Keep one Run's authority stable while a reader publishes its verified filesystem result. */
  async withRunReadBoundary<T>(runId:string, read:()=>Promise<T>):Promise<T> {
    return this.transaction(async client=>{await this.#run(client,runId,true);return read();},'hima.readRunBoundary');
  }
  async runs(): Promise<DurableRun[]> { return (await this.#pool.query<DurableRun>(`SELECT ${runColumns} FROM hima.runs ORDER BY created_at,run_id`)).rows.map(readRun); }
  /** Actual and former owner authority for Host routing; Guide-only relations grant no role. */
  async runsForOwner(sessionId:string):Promise<DurableRun[]> {
    return (await this.#pool.query<DurableRun>(`SELECT ${runColumns} FROM hima.runs r WHERE owner=$1 OR opening->>'owner'=$1
      OR EXISTS(SELECT 1 FROM hima.commands c WHERE c.run_id=r.run_id AND (c.command->>'owner'=$1 OR c.command->>'nextOwner'=$1))
      ORDER BY created_at,run_id`,[sessionId])).rows.map(readRun);
  }
  async #emit(client: ClientBase, runId: string, factId: string, kind: string, payload: JsonValue): Promise<void> {
    const { rows } = await client.query<{fact_seq:number}>('UPDATE hima.runs SET fact_seq=fact_seq+1 WHERE run_id=$1 RETURNING fact_seq', [runId]);
    await client.query('INSERT INTO hima.outbox(fact_id,run_id,seq,kind,payload) VALUES($1,$2,$3,$4,$5)', [factId,runId,rows[0]!.fact_seq,kind,JSON.stringify(payload)]);
  }
  async createRun(opening: DurableRunOpening): Promise<DurableRun> {
    assertName(opening.runId); assertName(opening.owner);
    if (!/^[0-9a-f]{64}$/.test(opening.inputSha256) || !Number.isFinite(Date.parse(opening.deadlineAt))) throw new Error('Run needs a SHA256 input digest and valid absolute deadline');
    if (opening.applicationVersion !== this.applicationVersion) throw new Error('Run executable version differs from this Host');
    taskJsonValue.parse(opening.data);
    return this.transaction(async client => {
      await this.#assertHostAdmission(client);
      await client.query(`INSERT INTO hima.runs(run_id,input_sha256,application_version,opening,owner,deadline_at)
        VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`, [opening.runId,opening.inputSha256,opening.applicationVersion,JSON.stringify(opening),opening.owner,opening.deadlineAt]);
      const run = await this.#run(client, opening.runId, true);
      if (jsonDigest(run.opening) !== jsonDigest(opening)) mismatch('Run');
      // Opening fact is immutable; a duplicate create never emits it twice.
      const factId = factIdentity('run-opened', opening.runId);
      if (!(await client.query('SELECT 1 FROM hima.outbox WHERE fact_id=$1', [factId])).rowCount) await this.#emit(client, opening.runId, factId, 'run-opened', opening as unknown as JsonValue);
      return run;
    }, 'hima.createRun');
  }
  /** A human stopwatch is an immutable business fact, never a scheduler command. */
  async measureHumanEffort(request: {runId:string;requestId:string;actor:string;origin?:string;epoch:number;revision:number;measurement:unknown}):Promise<{duplicate:boolean;request:NonNullable<RunRecord['control']>['requests'][string]}> {
    if(request.origin!=='human')throw new Error('value-study human effort can be recorded only by an authenticated human control request');
    if(!/^[A-Za-z0-9][A-Za-z0-9:._-]{0,159}$/.test(request.requestId))throw new Error('request identity must be a bounded plain identifier');
    const parsed=humanEffortMeasurement.safeParse(request.measurement);
    if(!parsed.success)throw new Error(`value-study measurement needs category, startedAt, endedAt and evidenceRef: ${parsed.error.message}`);
    const digest=jsonDigest(request),name=`human-measurement:${request.requestId}`;
    return this.transaction(async client=>{
      await this.#assertHostAdmission(client);
      const run=await this.#run(client,request.runId,true);
      const opening=run.opening.data as unknown as {run:RunRecord};
      if((request.actor!==run.owner&&request.actor!==opening.run.control?.guideSessionId)||request.epoch!==run.epoch||request.revision!==run.revision)throw new Error('Control owner/epoch/revision is stale; refresh this Run');
      if((await client.query('SELECT 1 FROM hima.commands WHERE run_id=$1 AND command_id=$2',[run.runId,request.requestId])).rowCount)mismatch('Command');
      const previous=(await client.query<{value:NonNullable<RunRecord['control']>['requests'][string]}>('SELECT value FROM hima.flow_facts WHERE run_id=$1 AND name=$2',[run.runId,name])).rows[0]?.value;
      if(previous){if(previous.digest!==digest)mismatch('Human measurement');return {duplicate:true,request:previous};}
      if(Date.parse(parsed.data.startedAt)<Date.parse(opening.run.createdAt))throw new Error('value-study human effort cannot start before this Run');
      if(Date.parse(parsed.data.endedAt)>Date.now())throw new Error('value-study human effort cannot end in the future');
      const held:NonNullable<RunRecord['control']>['requests'][string]={digest,actor:request.actor,epoch:run.epoch,revision:run.revision,origin:'human',at:new Date().toISOString(),state:'done',receipt:{requestId:request.requestId,action:'measure-value',data:parsed.data}};
      await this.#putFlowFact(client,run.runId,name,held as unknown as JsonValue);
      return {duplicate:false,request:held};
    },'hima.humanMeasurement');
  }
  /** Original human control admissions and stopwatch receipts share the existing reader book.
   * A done control receipt proves command admission, never physical effect/resource closure. */
  async humanRequests(runId:string):Promise<NonNullable<RunRecord['control']>['requests']> {
    const rows=(await this.#pool.query<{name:string;value:NonNullable<RunRecord['control']>['requests'][string]}>("SELECT name,value FROM hima.flow_facts WHERE run_id=$1 AND left(name,18)='human-measurement:' ORDER BY name",[runId])).rows;
    const commands=(await this.#pool.query<{commandId:string;digest:string;command:DurableCommand;receipt:DurableRun;factId:string;at:Date}>(`SELECT c.command_id AS "commandId",c.digest,c.command,c.receipt,o.fact_id AS "factId",o.at
      FROM hima.commands c JOIN hima.outbox o ON o.run_id=c.run_id AND o.kind='control' AND o.payload->>'commandId'=c.command_id
      WHERE c.run_id=$1 AND c.command->>'origin'='human' ORDER BY c.command_id`,[runId])).rows;
    const requests:NonNullable<RunRecord['control']>['requests']={};
    for(const row of commands) {
      if(row.factId!==factIdentity('control',runId,row.commandId)||row.digest!==jsonDigest(row.command))throw new Error('Human control provenance differs from its original persisted command');
      requests[row.commandId]={digest:row.digest,actor:row.command.actor??row.command.owner,epoch:row.command.epoch,revision:row.command.revision,origin:'human',at:new Date(row.at).toISOString(),state:'done',receipt:{requestId:row.commandId,action:row.command.action,data:row.receipt as unknown as JsonValue}};
    }
    for(const row of rows)requests[row.name.slice(18)]=row.value;
    return requests;
  }
  async command(command: DurableCommand): Promise<DurableRun> {
    assertName(command.commandId);
    if(command.origin!==undefined&&!['human','agent'].includes(command.origin))throw new Error('Control origin must be supplied by the Host as human or agent');
    const origin=command.origin??'agent';
    const digest = jsonDigest(command);
    return this.transaction(async client => {
      if(command.action==='respond') {
        const source=(await client.query<{source_kind:string|null}>(`SELECT invocation->'identity'->'source'->>'kind' AS source_kind
          FROM hima.flow_invocations WHERE run_id=$1 AND effect_id=$2`,[command.runId,command.response?.effectId??''])).rows[0]?.source_kind;
        if(source==='team'||command.response?.teamRequest)await this.#assertHostAdmission(client);
      }
      const run = await this.#run(client, command.runId, true);
      const pack=await this.packBinding(client,run.runId);
      if(pack&&command.action==='continue')await this.assertPackParent(client,pack,run);
      const humanSettlement=command.action==='respond'?await this.teamHumanResponseAdmission(client,run,command):undefined;
      if((await client.query('SELECT 1 FROM hima.flow_facts WHERE run_id=$1 AND name=$2',[run.runId,`human-measurement:${command.commandId}`])).rowCount)mismatch('Command');
      if(command.action==='continue'&&(await client.query("SELECT 1 FROM hima.outbox WHERE run_id=$1 AND kind='team-exit' LIMIT 1",[run.runId])).rowCount)throw new Error('App-exit Team requires explicit human successor admission; generic continue cannot clear its gate');
      const previous = (await client.query<{digest:string;receipt:DurableRun}>('SELECT digest,receipt FROM hima.commands WHERE run_id=$1 AND command_id=$2',[command.runId,command.commandId])).rows[0];
      if (previous) { if (previous.digest !== digest) mismatch('Command'); return readRun(previous.receipt); }
      if(humanSettlement?.settled) {
        const original=(await client.query<{receipt:DurableRun}>(`SELECT receipt FROM hima.commands WHERE run_id=$1
          AND command->>'action'='respond' AND command->'response'->>'effectId'=$2 ORDER BY command_id LIMIT 1`,
          [run.runId,command.response!.effectId])).rows[0];
        if(!original)throw new TeamError('hima/team-conflict','Settled human request has no original command receipt.');
        return readRun(original.receipt);
      }
      if(command.action!=='cancel'&&(await client.query('SELECT 1 FROM hima.team_definition_handoffs WHERE previous_run_id=$1',[run.runId])).rowCount)throw new TeamError('hima/not-authorized','Saved-definition handoff owns this predecessor fence; only Stop remains available.');
      if (command.owner !== run.owner || command.epoch !== run.epoch || command.revision !== run.revision) throw new Error('Control owner/epoch/revision is stale; refresh this Run');
      if(command.action==='continue'&&run.hold==='pause'
        &&(run.opening.data as {source?:{kind?:string}}).source?.kind==='team')
        throw new TeamError('hima/team-not-ready','Paused Team work cannot reuse its prior generation; use explicit resume after original closure.');
      // Team stop retries reconcile the same cancelled effects; they never admit new work.
      if (run.cancelled && !(command.action==='cancel'&&!command.scope&&(run.opening.data as {source?:{kind?:string}}).source?.kind==='team')) throw new Error('Cancelled Run cannot be resumed');
      if (command.action === 'handoff' && !command.nextOwner?.trim()) throw new Error('Handoff needs the next owner');
      if (command.scope || command.action === 'revise' || command.action === 'respond') {
        const start = (await client.query<{value:{flow:CompiledFlow}}>('SELECT value FROM hima.flow_facts WHERE run_id=$1 AND name=$2',[run.runId,'definition'])).rows[0]?.value;
        if (!start) throw new Error('Control requires the frozen flow definition');
        if (command.action === 'revise') {
          if (command.scope || !command.change) throw new Error('Revision needs a changed task, concrete input and evidence');
          const rules=await this.#revisionRules(client,run.runId);
          const records=(await client.query<{invocation:FlowInvocationRecord}>('SELECT invocation FROM hima.flow_invocations WHERE run_id=$1 ORDER BY effect_id',[run.runId])).rows.map(row=>row.invocation);
          const current=records.filter(record=>flowInvocationRevision(rules,invocationPath(record),record.consumedVersions).version===record.version);
          const candidates=current.filter(record=>record.identity.taskId===command.change!.taskId && (!command.change!.effectId||record.identity.effectId===command.change!.effectId));
          if(candidates.length!==1)throw new Error('Revision needs the selected current effectId; task identity is missing, stale or ambiguous across invocations');
          const selected=candidates[0]!,context=selected.context as unknown as {flow:CompiledFlow;taskId:string};
          const task=context.flow.tasks[context.taskId]!;
          validateTaskInput(task.contract.input,command.change.input,context.flow.localSchemas);taskJsonValue.parse(command.change.evidence);
          const fragments=(await client.query<{value:FrozenFlowFragment}>("SELECT value FROM hima.flow_facts WHERE run_id=$1 AND name LIKE 'fragment:%'",[run.runId])).rows.map(row=>row.value);
          const roots=[selected];
          for(const extra of command.change.additionalEffects??[]){const member=current.find(record=>record.identity.effectId===extra.effectId&&record.identity.taskId===extra.taskId);if(!member)throw new Error('Additional revision root is missing or stale');const path=invocationPath(member),primary=invocationPath(selected);if(path.flowSha256!==primary.flowSha256||jsonDigest([path.iterations,path.extensions??[]])!==jsonDigest([primary.iterations,primary.extensions??[]]))throw new Error('Additional revision roots must share the selected method/iteration/extension frontier');roots.push(member);}
          const patched=command.change.inputPatches??[];for(const patch of patched)if(!context.flow.tasks[patch.taskId])throw new Error('Input patch must name a task declared in the selected frozen method');
          const affected=[...new Set([...roots.flatMap(root=>flowRevisionConsumers(start.flow,root.identity.taskId,fragments)),...patched.flatMap(patch=>flowRevisionConsumers(start.flow,patch.taskId,fragments))])].sort();
          const invalidated=new Set(roots.map(root=>root.identity.effectId));
          const frontier=invocationPath(selected);for(const record of current)if(patched.some(patch=>patch.taskId===record.identity.taskId)&&jsonDigest([invocationPath(record).iterations,invocationPath(record).extensions??[]])===jsonDigest([frontier.iterations,frontier.extensions??[]]))invalidated.add(record.identity.effectId);
          let grew=true;
          while(grew){grew=false;for(const record of current)if(!invalidated.has(record.identity.effectId)&&record.consumedEffects.some(effect=>invalidated.has(effect))){invalidated.add(record.identity.effectId);grew=true;}}
          const preserved:Record<string,{version:number;input:JsonValue|null}>={};
          const invalidatedKeys:string[]=[];
          for(const record of current){const scope=invocationPath(record),key=flowInvocationKey(scope);if(invalidated.has(record.identity.effectId))invalidatedKeys.push(key);else preserved[key]=flowInvocationRevision(rules,scope,record.consumedVersions);}
          const rule:FlowRevisionRule={revision:run.revision+1,changedTask:task.id,changedEffectId:selected.identity.effectId,selected:invocationPath(selected),selectedKey:flowInvocationKey(invocationPath(selected)),
            input:command.change.input,evidence:command.change.evidence,affected,invalidatedKeys:[...new Set(invalidatedKeys)],invalidatedEffects:[...invalidated].sort(),preserved,...(patched.length?{inputPatches:patched}:{})};
          await client.query('UPDATE hima.runs SET revision=revision+1 WHERE run_id=$1',[run.runId]);
          await this.#putFlowFact(client,run.runId,`revision:${rule.revision}`,rule as unknown as JsonValue);
        } else if(command.scope && 'extension' in command.scope) {
          if(command.action!=='cancel')throw new Error('Optional extension disposition uses the existing cancel action');
          const scope=command.scope.extension;
          const slot=start.flow.extensions.find(slot=>slot.id===scope.slotId);if(!slot)throw new Error('Extension slot is not declared by this method');
          const producer=(await client.query<{result:TaskResult}>('SELECT result FROM hima.results WHERE run_id=$1 AND effect_id=$2',[run.runId,scope.producerEffectId])).rows[0]?.result;
          if(!producer||producer.identity.taskId!==slot.afterTask)throw new Error('Extension control must cite its actual committed producer');
          const fragment=(await client.query<{value:FrozenFlowFragment&{optional?:boolean}}>('SELECT value FROM hima.flow_facts WHERE run_id=$1 AND name=$2',[run.runId,`fragment:${scope.producerEffectId}:${scope.slotId}`])).rows[0]?.value;
          if(!fragment?.optional)throw new Error('Disposition requires an accepted optional fragment');
          await this.#putFlowFact(client,run.runId,`extension-disposition:${flowExtensionKey(scope)}`,{...scope,disposition:command.disposition??'cancelled',rationale:command.rationale??'Optional fragment stopped by its current controller'});
        } else if(command.action === 'respond') {
          if(command.scope || !command.response)throw new Error('Human response needs its original effect and schema output');
          const invocation=(await client.query<{invocation:FlowInvocationRecord}>('SELECT invocation FROM hima.flow_invocations WHERE run_id=$1 AND effect_id=$2',[run.runId,command.response.effectId])).rows[0]?.invocation;
          const context=invocation?.context as unknown as {flow:CompiledFlow}|undefined;
          const task=invocation&&context?.flow.tasks[invocation.identity.taskId];
          if(!invocation||task?.tool!=='builtin/human-wait')throw new Error('Respond only to an original declared human intervention');
          if(Date.now()>=Date.parse(run.deadlineAt))throw new Error('Original Run deadline has passed; no new business response');
          await this.#assertFlowEffectCurrent(client,run,invocation.identity.effectId);
          const output=taskToolOutput.parse(command.response.output);createTaskResult(invocation.identity,task.contract,output,context!.flow.localSchemas);
          if(humanSettlement) {
            const {response,responseDigest}=humanSettlement;
            await client.query('UPDATE hima.team_human_requests SET response=$2,response_digest=$3 WHERE effect_id=$1 AND response IS NULL',
              [invocation.identity.effectId,JSON.stringify(response),responseDigest]);
          }
          await this.#putFlowFact(client,run.runId,`response:${invocation.identity.effectId}`,output as unknown as JsonValue);
        } else {
          if(command.action==='handoff')throw new Error('Ownership handoff applies to the whole Run');
          const branches=await this.#flowScope(client,start.flow,run.runId,(command.scope as {taskId:string}).taskId);
          if(!branches.length)throw new Error('Branch control must name a task inside a frozen parallel branch');
          const digest=jsonDigest(branches), previous=(await client.query<{cancelled:boolean;hold:string|null;hold_source:string|null}>('SELECT cancelled,hold,hold_source FROM hima.flow_branch_controls WHERE run_id=$1 AND scope_digest=$2',[run.runId,digest])).rows[0];
          if(previous?.cancelled)throw new Error('Cancelled branch cannot be resumed');
          const source=previous?.hold?(previous.hold_source??'unknown'):null;
          if(command.action==='continue'&&origin!=='human'&&source&&source!=='agent')throw new Error('This branch pause requires an explicit human continuation');
          const nextSource=command.action==='continue'?null:command.action==='pause'&&source&&source!=='agent'?source:origin;
          await client.query(`INSERT INTO hima.flow_branch_controls(run_id,scope_digest,branches,hold,cancelled,hold_source) VALUES($1,$2,$3,$4,$5,$6)
            ON CONFLICT(run_id,scope_digest) DO UPDATE SET hold=EXCLUDED.hold,cancelled=EXCLUDED.cancelled,hold_source=EXCLUDED.hold_source`,[run.runId,digest,JSON.stringify(branches),command.action==='continue'?null:command.action,command.action==='cancel',nextSource]);
        }
      } else {
        if(command.action==='continue'&&origin!=='human'&&run.holdSource&&run.holdSource!=='agent')throw new Error('This Run pause requires an explicit human continuation');
        const source=command.action==='continue'?null:command.action==='handoff'?run.holdSource:command.action==='pause'&&run.holdSource&&run.holdSource!=='agent'?run.holdSource:origin;
        await client.query(`UPDATE hima.runs SET epoch=epoch+1, hold=$2, cancelled=$3,owner=$4,hold_source=$5 WHERE run_id=$1`,[run.runId,command.action === 'continue' ? null : command.action === 'handoff' ? run.hold : command.action,command.action === 'cancel',command.action === 'handoff' ? command.nextOwner : run.owner,source]);
      }
      const receipt = await this.#run(client,run.runId);
      await client.query('INSERT INTO hima.commands VALUES($1,$2,$3,$4,$5)',[run.runId,command.commandId,digest,JSON.stringify(command),JSON.stringify(receipt)]);
      await this.#emit(client,run.runId,factIdentity('control',run.runId,command.commandId),'control',command as unknown as JsonValue);
      return receipt;
    },'hima.control');
  }
  async #flowScope(client:ClientBase,flow:CompiledFlow,runId:string,taskId:string):Promise<readonly FlowBranch[]> {
    if(flow.tasks[taskId])return flowTaskBranches(flow,taskId);
    const scopes=(await client.query<{branches:FlowBranch[]}>('SELECT branches FROM hima.flow_invocations WHERE run_id=$1 AND task_id=$2',[runId,taskId])).rows.map(row=>row.branches);
    if(!scopes.length)throw new Error('Branch target is not in the frozen method or a retained fragment invocation');
    if(scopes.some(scope=>jsonDigest(scope)!==jsonDigest(scopes[0])))throw new Error('Branch target has ambiguous original invocation membership');
    return scopes[0]!;
  }
  async flowBranchScope(runId:string,taskId:string):Promise<readonly FlowBranch[]> {
    return this.transaction(async client=>{
      const definition=(await client.query<{value:{flow:CompiledFlow}}>('SELECT value FROM hima.flow_facts WHERE run_id=$1 AND name=$2',[runId,'definition'])).rows[0]?.value;
      if(!definition)throw new Error('Branch scope needs its frozen method');
      return this.#flowScope(client,definition.flow,runId,taskId);
    },'hima.flowScope');
  }
  async #putFlowFact(client:ClientBase,runId:string,name:string,value:JsonValue):Promise<JsonValue> {
    const digest=jsonDigest(value);
    await client.query('INSERT INTO hima.flow_facts VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[runId,name,digest,JSON.stringify(value)]);
    const held=(await client.query<{digest:string;value:JsonValue}>('SELECT digest,value FROM hima.flow_facts WHERE run_id=$1 AND name=$2',[runId,name])).rows[0]!;
    if(held.digest!==digest)mismatch('Flow fact');
    const factId=factIdentity('flow-fact',runId,name);
    if(!(await client.query('SELECT 1 FROM hima.outbox WHERE fact_id=$1',[factId])).rowCount)await this.#emit(client,runId,factId,'flow-fact',{name,value});
    return held.value;
  }
  async putFlowFact(runId:string,name:string,value:JsonValue):Promise<JsonValue> {
    return this.transaction(async client=>{await this.#run(client,runId,true);return this.#putFlowFact(client,runId,name,value);},'hima.flowFact');
  }
  /** Freeze readonly materialization once in the existing immutable fact/outbox. Poll receipts
   * contain only its identity/digest; a cold cache hydrates the original value by factId.
   * Only the producer's materialization failure becomes unavailable. Database failures escape. */
  async ensureFlowFact(runId:string,name:string,read:()=>Promise<JsonValue>):Promise<
    {state:'available';factId:string;digest:string}|{state:'unavailable';reason:string}> {
    assertName(name);
    return this.transaction(async client=>{
      await this.#run(client,runId,true);
      const existing=(await client.query<{digest:string}>('SELECT digest FROM hima.flow_facts WHERE run_id=$1 AND name=$2',[runId,name])).rows[0];
      const factId=factIdentity('flow-fact',runId,name);
      if(existing)return {state:'available' as const,factId,digest:existing.digest};
      let value:JsonValue;
      try {value=await read();}
      catch(error){return {state:'unavailable' as const,reason:error instanceof Error?error.message:String(error)};}
      await this.#putFlowFact(client,runId,name,value);
      return {state:'available' as const,factId,digest:jsonDigest(value)};
    },'hima.ensureFlowFact');
  }
  /** Independent cleanup workflows may corroborate closure with different observations.
   * Freeze one stop receipt from retained physical release facts under the original Run lock;
   * never accept a caller's stop claim or weaken generic immutable fact equality. */
  async confirmFlowStopped(identity:TaskIdentity):Promise<JsonValue> {
    taskIdentity.parse(identity);
    return this.transaction(async client=>{
      await this.#run(client,identity.runId,true);
      const invocation=(await client.query<{invocation:FlowInvocationRecord}>('SELECT invocation FROM hima.flow_invocations WHERE effect_id=$1 AND run_id=$2',[identity.effectId,identity.runId])).rows[0]?.invocation;
      if(!invocation||jsonDigest(invocation.identity)!==jsonDigest(identity))mismatch('Original stop invocation');
      const resources=(await client.query<{effectId:string;identity:TaskIdentity;leaseExists:boolean;releasedAt:string|null;proof:JsonValue|null;dispatched:boolean}>(`WITH RECURSIVE original(effect_id) AS (
        SELECT $1::text UNION SELECT d.child_effect_id FROM hima.flow_derived_effects d JOIN original o ON d.parent_effect_id=o.effect_id WHERE d.run_id=$2)
        SELECT e.effect_id AS "effectId",e.identity,(l.effect_id IS NOT NULL) AS "leaseExists",l.released_at AS "releasedAt",l.proof,
          EXISTS(SELECT 1 FROM hima.effect_dispatches d WHERE d.effect_id=e.effect_id AND d.dispatch_id='submit') AS dispatched
        FROM original o JOIN hima.effects e USING(effect_id) LEFT JOIN hima.effect_leases l USING(effect_id) ORDER BY e.effect_id`,[identity.effectId,identity.runId])).rows;
      const parent=resources.find(resource=>resource.effectId===identity.effectId);
      if(parent&&jsonDigest(parent.identity)!==jsonDigest(identity))mismatch('Original stop effect');
      if(resources.some(resource=>resource.identity.runId!==identity.runId))mismatch('Original stop derived effect');
      if(resources.some(resource=>resource.leaseExists&&!resource.releasedAt||resource.dispatched&&(!resource.leaseExists||!resource.releasedAt||resource.proof===null)))throw new OriginalFlowClosureUnproved();
      const name=`stopped:${identity.effectId}`;
      const existing=(await client.query<{value:JsonValue}>('SELECT value FROM hima.flow_facts WHERE run_id=$1 AND name=$2',[identity.runId,name])).rows[0];
      if(existing)return existing.value;
      const proof=parent?.proof??{closed:true,unstarted:!parent?.dispatched,derived:resources.filter(resource=>resource.proof!==null).map(resource=>({effectId:resource.effectId,proof:resource.proof}))};
      return this.#putFlowFact(client,identity.runId,name,{closed:true,proof});
    },'hima.confirmFlowStopped');
  }
  /** Archive IO joins the existing Host admission lock; its immutable intent precedes file writes. */
  async admitDeliveryWrite(runId:string,revision:number,attempt:number):Promise<boolean> {
    return this.transaction(async client=>{
      const host=(await client.query<{active_request:string|null;finalizing:boolean}>('SELECT active_request,finalizing FROM hima.host_exit WHERE singleton=true FOR SHARE')).rows[0]!;
      if(host.finalizing||host.active_request)return false;
      const run=await this.#run(client,runId,true);if(run.revision!==revision||run.applicationVersion!==this.applicationVersion)return false;
      await this.#putFlowFact(client,runId,`delivery-io:intent:${revision}:${attempt}`,{revision,attempt});return true;
    },'hima.deliveryWriteAdmission');
  }
  /** Uncached callback check: a replayed receipt cannot start new IO after exit finalization. */
  async assertDeliveryWrite(runId:string,revision:number,attempt:number):Promise<void> {
    await this.#externalTransaction(async client=>{
      const host=(await client.query<{active_request:string|null;finalizing:boolean;accepted_at:string|null}>(`SELECT h.active_request,h.finalizing,r.accepted_at FROM hima.host_exit h LEFT JOIN hima.host_exit_requests r ON r.request_id=h.active_request WHERE h.singleton=true FOR SHARE OF h`)).rows[0]!;
      const run=await this.#run(client,runId,true);
      const intent=(await client.query<{at:string}>('SELECT at FROM hima.outbox WHERE fact_id=$1',[factIdentity('flow-fact',runId,`delivery-io:intent:${revision}:${attempt}`)])).rows[0];
      if(!intent||host.finalizing||run.revision!==revision||run.applicationVersion!==this.applicationVersion||host.accepted_at&&Date.parse(intent.at)>Date.parse(host.accepted_at))throw new Error('Original archive file write is not admitted under the current Host lifetime');
    });
  }
  /** Delivery readers need completed and failed immutable facts even after history acknowledgement. */
  async orderedFlowFacts(runId:string,prefix:string):Promise<readonly {name:string;value:JsonValue;source:DurableFact}[]> {
    const rows=(await this.#pool.query<{name:string;value:JsonValue;factId:string;runId:string;seq:number;kind:string;payload:JsonValue;at:string}>(`
      SELECT f.name,f.value,o.fact_id AS "factId",o.run_id AS "runId",o.seq,o.kind,o.payload,o.at
      FROM hima.flow_facts f JOIN hima.outbox o ON o.run_id=f.run_id AND o.kind='flow-fact' AND o.payload->>'name'=f.name
      WHERE f.run_id=$1 AND left(f.name,length($2))=$2 ORDER BY o.seq`,[runId,prefix])).rows;
    return rows.map(({name,value,...source})=>({name,value,source:{...source,at:new Date(source.at).toISOString()}}));
  }
  async flowFact(runId:string,name:string):Promise<JsonValue|null> {
    return this.transaction(async client=>(await client.query<{value:JsonValue}>('SELECT value FROM hima.flow_facts WHERE run_id=$1 AND name=$2',[runId,name])).rows[0]?.value??null,'hima.flowFactRead');
  }
  async recordFlowInvocation(invocation:FlowInvocationRecord):Promise<FlowInvocationRecord> {
    taskIdentity.parse(invocation.identity);taskJsonValue.parse(invocation.context);
    return this.transaction(async client=>{
      const run=await this.#run(client,invocation.identity.runId,true);
      await client.query('INSERT INTO hima.flow_invocations(effect_id,run_id,task_id,version,branches,invocation,admitted_generation) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING',[
        invocation.identity.effectId,invocation.identity.runId,invocation.identity.taskId,invocation.version,JSON.stringify(invocation.branches),JSON.stringify(invocation),run.epoch]);
      const held=(await client.query<{invocation:FlowInvocationRecord}>('SELECT invocation FROM hima.flow_invocations WHERE effect_id=$1',[invocation.identity.effectId])).rows[0]!.invocation;
      if(jsonDigest([held.identity,held.version,held.branches,held.consumedEffects,held.consumedVersions])!==jsonDigest([invocation.identity,invocation.version,invocation.branches,invocation.consumedEffects,invocation.consumedVersions]))mismatch('Flow invocation');
      return held;
    },'hima.flowInvocation');
  }
  async flowInvocations(runId:string):Promise<FlowInvocationRecord[]> {
    return this.transaction(async client=>(await client.query<{invocation:FlowInvocationRecord}>('SELECT invocation FROM hima.flow_invocations WHERE run_id=$1 ORDER BY effect_id',[runId])).rows.map(row=>row.invocation),'hima.flowInvocations');
  }
  /** Read-only original invocation lookup for adapter.prepare inside a Step. */
  async readExternalFlowInvocation(identity:TaskIdentity):Promise<FlowInvocationRecord|undefined> {
    taskIdentity.parse(identity);
    const row=(await this.#pool.query<{invocation:FlowInvocationRecord}>('SELECT invocation FROM hima.flow_invocations WHERE run_id=$1 AND effect_id=$2',[identity.runId,identity.effectId])).rows[0]?.invocation;
    if(row&&jsonDigest(row.identity)!==jsonDigest(identity))mismatch('Original invocation');
    return row;
  }
  /** Raw native authority inheritance, usable inside external callbacks. No name-prefix trust,
   * fresh budget, workflow scheduling or independent child control authority is created. */
  async bindDerivedEffect(parent:TaskIdentity,child:TaskIdentity,options:{readonly purpose:'business'|'collect'}={purpose:'business'}):Promise<void> {
    taskIdentity.parse(parent);taskIdentity.parse(child);
    if(!['business','collect'].includes(options.purpose))throw new Error('Derived effect needs its immutable business or collection purpose');
    if(parent.runId!==child.runId||parent.applicationVersion!==child.applicationVersion||taskMethodDigest(parent)!==taskMethodDigest(child)||('source' in parent)!==('source' in child)||('source' in parent&&'source' in child&&(jsonDigest(parent.source)!==jsonDigest(child.source)||jsonDigest(parent.method)!==jsonDigest(child.method)))||parent.irSha256!==child.irSha256||parent.effectId===child.effectId)throw new Error('Derived effect must retain its original parent Run/method/version');
    await this.#externalTransaction(async client=>{
      await this.#run(client,parent.runId,true);
      const held=(await client.query<{identity:TaskIdentity}>('SELECT identity FROM hima.effects WHERE effect_id=$1 AND run_id=$2',[parent.effectId,parent.runId])).rows[0];
      const invocation=!held?(await client.query<{invocation:FlowInvocationRecord}>('SELECT invocation FROM hima.flow_invocations WHERE effect_id=$1 AND run_id=$2',[parent.effectId,parent.runId])).rows[0]?.invocation:undefined;
      if(jsonDigest(held?.identity??invocation?.identity??null)!==jsonDigest(parent))mismatch('Derived parent');
      const existingChild=(await client.query<{identity:TaskIdentity}>('SELECT identity FROM hima.effects WHERE effect_id=$1',[child.effectId])).rows[0];
      if(existingChild&&jsonDigest(existingChild.identity)!==jsonDigest(child))mismatch('Derived child');
      const cycle=(await client.query(`WITH RECURSIVE ancestry AS (
        SELECT child_effect_id,parent_effect_id FROM hima.flow_derived_effects WHERE child_effect_id=$1
        UNION SELECT d.child_effect_id,d.parent_effect_id FROM hima.flow_derived_effects d JOIN ancestry a ON d.child_effect_id=a.parent_effect_id)
        SELECT 1 FROM ancestry WHERE parent_effect_id=$2 OR child_effect_id=$2`,[parent.effectId,child.effectId])).rowCount;
      if(cycle)throw new Error('Derived effect ancestry cannot contain a cycle');
      await client.query('INSERT INTO hima.flow_derived_effects VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',[child.effectId,parent.effectId,parent.runId,JSON.stringify(parent),JSON.stringify(child),options.purpose]);
      const original=(await client.query<{parent_identity:TaskIdentity;child_identity:TaskIdentity;purpose:string}>('SELECT parent_identity,child_identity,purpose FROM hima.flow_derived_effects WHERE child_effect_id=$1',[child.effectId])).rows[0]!;
      if(jsonDigest([original.parent_identity,original.child_identity,original.purpose])!==jsonDigest([parent,child,options.purpose]))mismatch('Derived effect');
    });
  }
  async derivedEffects(parent:TaskIdentity):Promise<Array<{identity:TaskIdentity;parentIdentity:TaskIdentity;intent:JsonValue|null;phase:string|null;purpose:'business'|'collect'}>> {
    taskIdentity.parse(parent);
    const effect=await this.effect(parent.effectId),registered=!effect?(await this.#pool.query<{invocation:FlowInvocationRecord}>('SELECT invocation FROM hima.flow_invocations WHERE effect_id=$1 AND run_id=$2',[parent.effectId,parent.runId])).rows[0]?.invocation:undefined;if(jsonDigest(effect?.identity??registered?.identity??null)!==jsonDigest(parent))mismatch('Derived cleanup parent');
    const rows=(await this.#pool.query<{child_identity:TaskIdentity;parent_identity:TaskIdentity;intent:JsonValue|null;phase:string|null;purpose:'business'|'collect'}>(`WITH RECURSIVE owned AS (
      SELECT d.*,1 AS depth FROM hima.flow_derived_effects d WHERE d.parent_effect_id=$1 AND d.run_id=$2
      UNION ALL SELECT d.*,o.depth+1 FROM hima.flow_derived_effects d JOIN owned o ON d.parent_effect_id=o.child_effect_id WHERE d.run_id=$2)
      SELECT o.child_identity,o.parent_identity,o.purpose,e.intent,e.phase FROM owned o LEFT JOIN hima.effects e ON e.effect_id=o.child_effect_id ORDER BY o.depth DESC,o.child_effect_id`,[parent.effectId,parent.runId])).rows;
    return rows.map(row=>({identity:row.child_identity,parentIdentity:row.parent_identity,intent:row.intent,phase:row.phase,purpose:row.purpose}));
  }
  async #revisionRules(client:Pick<ClientBase,'query'>,runId:string):Promise<FlowRevisionRule[]> {
    return (await client.query<{value:FlowRevisionRule}>("SELECT value FROM hima.flow_facts WHERE run_id=$1 AND name LIKE 'revision:%' ORDER BY length(name),name",[runId])).rows.map(row=>row.value);
  }
  async #flowMembership(client:ClientBase,runId:string,effectId:string):Promise<{effect_id:string;branches:FlowBranch[];task_id:string;version:number;experiment:boolean;purpose:string;scope:FlowInvocationPath;consumedVersions:readonly number[]}|undefined> {
    const row=(await client.query<{effect_id:string;branches:FlowBranch[];task_id:string;version:number;invocation:FlowInvocationRecord;purpose:string}>(`WITH RECURSIVE ancestry(effect_id) AS (
      SELECT $1::text UNION SELECT d.parent_effect_id FROM hima.flow_derived_effects d JOIN ancestry a ON d.child_effect_id=a.effect_id WHERE d.run_id=$2)
      SELECT i.effect_id,i.branches,i.task_id,i.version,i.invocation,
        COALESCE((SELECT purpose FROM hima.flow_derived_effects WHERE child_effect_id=$1),'business') AS purpose
      FROM hima.flow_invocations i JOIN ancestry a USING(effect_id) WHERE i.run_id=$2 ORDER BY CASE WHEN i.effect_id=$1 THEN 0 ELSE 1 END,i.effect_id LIMIT 1`,[effectId,runId])).rows[0];
    if(!row)return undefined;
    const context=row.invocation.context as unknown as {flow:CompiledFlow;taskId:string};
    return {...row,experiment:flowTaskCountsExperiment(context.flow,context.taskId),scope:invocationPath(row.invocation),consumedVersions:row.invocation.consumedVersions};
  }
  async #effectRevisionMatches(client:ClientBase,run:DurableRun,admission:EffectAdmission):Promise<boolean> {
    const invocation=await this.#flowMembership(client,run.runId,admission.effectId);
    if(!invocation)return run.revision===admission.revision;
    const current=flowInvocationRevision(await this.#revisionRules(client,run.runId),invocation.scope,invocation.consumedVersions).version;
    return invocation.version===current;
  }
  private async assertTeamLineageCurrent(client:ClientBase,run:DurableRun,effectId:string):Promise<void> {
    const current=(await client.query<{invocation:FlowInvocationRecord}>(`WITH RECURSIVE ancestry(effect_id) AS (SELECT $1::text UNION SELECT d.parent_effect_id FROM hima.flow_derived_effects d JOIN ancestry a ON d.child_effect_id=a.effect_id WHERE d.run_id=$2) SELECT i.invocation FROM hima.flow_invocations i JOIN ancestry a USING(effect_id) WHERE i.run_id=$2 ORDER BY CASE WHEN i.effect_id=$1 THEN 0 ELSE 1 END LIMIT 1`,[effectId,run.runId])).rows[0]?.invocation;
    const source=current&&'source' in current.identity?current.identity.source:undefined;
    if(source?.kind==='team') {
      const binding=await this.packBinding(client,run.runId);
      if(binding) {
        await this.assertPackParent(client,binding,run);
        if(current?.identity.taskId==='leader'&&jsonDigest((current.context as unknown as {input:JsonValue}).input)!==jsonDigest(binding.start.runInput))throw new FlowEffectNotCurrent('Pack-bound leader must retain its exact original Team input; revise the original Pack node instead.');
      }
      const task=(await client.query<{task:TeamTaskView}>('SELECT task FROM hima.team_tasks WHERE project_id=$1 AND team_id=$2 AND task_id=$3 FOR SHARE',[source.projectId,source.team.teamId,source.taskId])).rows[0]?.task;
      if(!task||task.currentRunId!==run.runId)throw new FlowEffectNotCurrent('Team effect no longer belongs to the current original task Run');
      const retainedGrants=await client.query<{grant_data:ActorGrant}>(teamOperatorRevocationSQL,[effectId,run.runId]);
      if(retainedGrants.rows.some(row=>row.grant_data.revokedAt&&row.grant_data.revocationCause==='operator'))
        throw new FlowEffectNotCurrent('Explicit operator revocation fences the accepted Team Run lineage');
    }

    const grants=(await client.query<{grant_data:ActorGrant}>(`WITH RECURSIVE ancestry(effect_id) AS (SELECT $1::text UNION SELECT d.parent_effect_id FROM hima.flow_derived_effects d JOIN ancestry a ON d.child_effect_id=a.effect_id WHERE d.run_id=$2) SELECT g.grant_data FROM hima.task_actor_grants g JOIN ancestry a ON g.grant_data->>'effectId'=a.effect_id FOR SHARE OF g`,[effectId,run.runId])).rows;
    if(grants.some(row=>row.grant_data.generation!==run.epoch||row.grant_data.revokedAt&&row.grant_data.revocationCause==='operator'))throw new FlowEffectNotCurrent('Explicit operator revocation fences the actual Team effect lineage');
    const links=(await client.query<{child_effect_id:string;parent_effect_id:string;purpose:string}>(`WITH RECURSIVE ancestry(effect_id) AS (
      SELECT $1::text UNION SELECT d.parent_effect_id FROM hima.flow_derived_effects d JOIN ancestry a ON d.child_effect_id=a.effect_id WHERE d.run_id=$2)
      SELECT d.child_effect_id,d.parent_effect_id,d.purpose FROM hima.flow_derived_effects d JOIN ancestry a ON d.child_effect_id=a.effect_id WHERE d.run_id=$2 AND d.purpose IN ('delegation','continuation')`,[effectId,run.runId])).rows;
    for(const link of links) {
      if(link.purpose==='delegation') {
        const delegation=(await client.query<{delegation_id:string}>(`SELECT delegation_id FROM hima.team_delegations WHERE run_id=$1 AND parent_effect_id=$2 AND child_identity->>'effectId'=$3`,[run.runId,link.parent_effect_id,link.child_effect_id])).rows[0];
        if(!delegation)throw new FlowEffectNotCurrent('Delegation lineage is not backed by accepted application facts');
        const gate=await this.delegationGate(client,run.runId,delegation.delegation_id,'result');
        if(gate.state!=='ready')throw new FlowEffectNotCurrent(gate.reason??'Delegation lineage is blocked');
      } else {
        const retained=(await client.query<{continuation:TeamEffectContinuation}>('SELECT continuation FROM hima.team_effect_continuations WHERE run_id=$1 AND predecessor_effect_id=$2 AND successor_effect_id=$3',[run.runId,link.parent_effect_id,link.child_effect_id])).rows[0]?.continuation;
        if(!retained)throw new FlowEffectNotCurrent('Successor lineage is not backed by an accepted continuation');
        const wait=await this.teamWaitRow(client,retained.waitId);
        try {await this.teamWaitInputs(client,wait.acceptance);}catch(error){if(error instanceof TeamError)throw new FlowEffectNotCurrent(error.message);throw error;}
        const release=(await client.query<{proof:JsonValue;released_at:string|null}>('SELECT proof,released_at FROM hima.effect_leases WHERE effect_id=$1',[link.parent_effect_id])).rows[0];
        if(!wait.saved_context||!wait.closure_proof||!release?.released_at||jsonDigest(wait.closure_proof)!==jsonDigest(release.proof))throw new FlowEffectNotCurrent('Original successor handoff or lease release is unproved');
      }
    }

  }
  async #assertFlowEffectCurrent(client:ClientBase,run:DurableRun,effectId:string,ignoreReversibleBranchHold=false):Promise<void> {
    const invocation=await this.#flowMembership(client,run.runId,effectId);
    if(!invocation)return;
    await this.assertTeamLineageCurrent(client,run,effectId);
    const rules=await this.#revisionRules(client,run.runId);
    const revision=flowInvocationRevision(rules,invocation.scope,invocation.consumedVersions).version;
    if(revision!==invocation.version)throw new FlowEffectNotCurrent('Task invocation was superseded by revision; retain its original effects and results');
    for(const rule of rules)if(invocation.version>=rule.revision&&flowRevisionApplies(rule,invocation.scope,invocation.consumedVersions)) {
      const held=(await client.query(`WITH RECURSIVE original(effect_id) AS (
        SELECT unnest($1::text[]) UNION SELECT d.child_effect_id FROM hima.flow_derived_effects d JOIN original o ON d.parent_effect_id=o.effect_id WHERE d.run_id=$2)
        SELECT o.effect_id FROM original o JOIN hima.effect_leases l USING(effect_id) WHERE l.released_at IS NULL LIMIT 1`,[[...rule.invalidatedEffects],run.runId])).rows[0];
      if(held)throw new FlowEffectNotCurrent('Revision replacement is waiting for confirmed closure of its original affected task tree');
    }
    for(const scope of invocation.scope.extensions??[])if((await client.query('SELECT 1 FROM hima.flow_facts WHERE run_id=$1 AND name=$2',[run.runId,`extension-disposition:${flowExtensionKey(scope)}`])).rowCount)throw new FlowEffectNotCurrent('Original optional extension is stopped; no new business effects');
    const controls=(await client.query<{branches:FlowBranch[];hold:string|null;cancelled:boolean}>('SELECT branches,hold,cancelled,hold_source AS "holdSource" FROM hima.flow_branch_controls WHERE run_id=$1',[run.runId])).rows;
    if(controls.some(control=>(control.cancelled||(!ignoreReversibleBranchHold&&control.hold&&invocation.purpose!=='collect'))&&branchContains(control.branches,invocation.branches)))throw new FlowEffectNotCurrent('Effect admission blocked by current branch control');
    const data=run.opening.data as {budget?:{closingReserveMs?:number;attemptLimit?:number}};
    if(invocation.experiment&&invocation.purpose!=='collect'&&Date.now()>=Date.parse(run.deadlineAt)-(data.budget?.closingReserveMs??0))throw new FlowEffectNotCurrent('Original Run is closing; no new business effects');
    if(invocation.purpose==='collect'&&!(await client.query("SELECT 1 FROM hima.flow_derived_effects d JOIN hima.effect_dispatches p ON p.effect_id=d.parent_effect_id WHERE d.child_effect_id=$1 AND p.dispatch_id='submit'",[effectId])).rowCount)throw new FlowEffectNotCurrent('Collection must consume an already admitted original parent');
    if(invocation.experiment&&data.budget?.attemptLimit!==undefined) {
      const allocated=(await client.query("SELECT 1 FROM hima.effect_dispatches WHERE dispatch_id='submit' AND (effect_id=$1 OR effect_id=(SELECT root_effect_id FROM hima.team_effect_continuations WHERE successor_effect_id=$1 AND run_id=$2))",[invocation.effect_id,run.runId])).rowCount;
      const count=Number((await client.query<{count:string}>(`SELECT count(*) FROM hima.effect_dispatches d JOIN hima.flow_invocations i USING(effect_id) WHERE i.run_id=$1 AND d.dispatch_id='submit' AND ${countedInvocation}`,[run.runId])).rows[0]!.count);
      if(!allocated&&count>=data.budget.attemptLimit)throw new FlowEffectNotCurrent('Original Run attempt budget reached; no fresh child allocation');
    }
  }
  async #readFlowAuthority(client:Pick<ClientBase,'query'>,runId:string,lock:boolean) {
      const run=await this.#run(client,runId,lock);
      // A reversible parent hold is a derived control fact, never a child stop or second state machine.
      let inheritedHold:string|undefined;
      const binding=await this.packBinding(client,runId);
      if(binding) {
        const parent=await this.#run(client,binding.parentIdentity.runId);
        if(!parent.cancelled&&parent.owner===binding.parentOwner&&Date.now()<Date.parse(parent.deadlineAt)) {
          const original=(await client.query<{invocation:FlowInvocationRecord}>('SELECT invocation FROM hima.flow_invocations WHERE effect_id=$1 AND run_id=$2',[binding.parentIdentity.effectId,parent.runId])).rows[0]?.invocation;
          const controls=(await client.query<{branches:FlowBranch[];hold:string|null;cancelled:boolean}>('SELECT branches,hold,cancelled FROM hima.flow_branch_controls WHERE run_id=$1',[parent.runId])).rows;
          const affected=original?controls.filter(control=>branchContains(control.branches,original.branches)):[];
          if(!affected.some(control=>control.cancelled))inheritedHold=parent.hold??affected.find(control=>control.hold)?.hold??undefined;
        }
      }
      const revisionRules=await this.#revisionRules(client,runId);
      const branches=(await client.query<{branches:FlowBranch[];hold:string|null;cancelled:boolean}>('SELECT branches,hold,cancelled,hold_source AS "holdSource" FROM hima.flow_branch_controls WHERE run_id=$1 ORDER BY scope_digest',[runId])).rows;
      const submitted=(await client.query<{effect_id:string;experiment:boolean}>(`SELECT d.effect_id,${countedInvocation} AS experiment FROM hima.effect_dispatches d JOIN hima.flow_invocations i USING(effect_id) WHERE i.run_id=$1 AND d.dispatch_id='submit' ORDER BY d.effect_id`,[runId])).rows;
      const dispatchedEffects=submitted.filter(row=>row.experiment).map(row=>row.effect_id),submittedEffects=submitted.map(row=>row.effect_id);
      const hostExit=(await client.query<import('./host-exit.js').HostExitRequest>(`SELECT r.request_id AS "requestId",r.mode FROM hima.host_exit h JOIN hima.host_exit_requests r ON r.request_id=h.active_request WHERE h.singleton=true`)).rows[0]??null;
      const extensions=(await client.query<{name:string;value:JsonValue}>("SELECT name,value FROM hima.flow_facts WHERE run_id=$1 AND name LIKE 'extension-disposition:%' ORDER BY name",[runId])).rows;
      return {run,...(inheritedHold?{inheritedHold}:{}),at:Date.now(),dispatchedEffects,submittedEffects,hostExit,revisionRules,branches,extensionDispositions:Object.fromEntries(extensions.map(row=>[row.name.slice('extension-disposition:'.length),row.value]))};
  }
  async flowAuthority(runId:string):Promise<{run:DurableRun;inheritedHold?:string;at:number;dispatchedEffects:string[];submittedEffects:string[];hostExit:import('./host-exit.js').HostExitRequest|null;revisionRules:FlowRevisionRule[];extensionDispositions:Record<string,JsonValue>;branches:Array<{branches:FlowBranch[];hold:string|null;cancelled:boolean}>}> {
    return this.transaction(client=>this.#readFlowAuthority(client,runId,true),'hima.flowAuthority');
  }
  /** Compact receipted watchdog observation; immutable Run opening and full resource history
   * are not needed to decide whether original hard-deadline cleanup must start. */
  async flowDeadlineSnapshot(runId:string):Promise<{at:number;deadlineAt:string;revision:number;hasUnreleasedResources:boolean}> {
    return this.transaction(async client=>{
      const {rows}=await client.query<{deadlineAt:string;revision:number;hasUnreleasedResources:boolean}>(`SELECT deadline_at AS "deadlineAt",revision,
        EXISTS(SELECT 1 FROM hima.effect_leases l JOIN hima.effects e USING(effect_id) WHERE e.run_id=r.run_id AND l.released_at IS NULL) AS "hasUnreleasedResources"
        FROM hima.runs r WHERE run_id=$1`,[runId]);
      if(!rows[0])throw new Error(`Unknown DBOS Run ${runId}`);
      return {...rows[0],deadlineAt:new Date(rows[0].deadlineAt).toISOString(),at:Date.now()};
    },'hima.flowDeadlineSnapshot');
  }
  /** Uncached actual-callback authority. Never nest datasource transactions inside a Step. */
  async currentFlowAuthority(runId:string):Promise<Awaited<ReturnType<RunStore['flowAuthority']>>> {
    return this.#externalTransaction(client=>this.#readFlowAuthority(client,runId,true));
  }
  async flowState(runId:string,effectId:string,attempt:number,state:JsonValue):Promise<void> {
    await this.transaction(async client=>{
      await this.#run(client,runId,true);
      const factId=factIdentity('flow-state',effectId,String(attempt));
      const existing=(await client.query<{payload:JsonValue}>('SELECT payload FROM hima.outbox WHERE fact_id=$1',[factId])).rows[0];
      const payload={effectId,attempt,state};
      const latest=(await client.query<{state:JsonValue}>("SELECT payload->'state' AS state FROM hima.outbox WHERE run_id=$1 AND kind='flow-state' AND payload->>'effectId'=$2 ORDER BY seq DESC LIMIT 1",[runId,effectId])).rows[0];
      if(latest&&jsonDigest(latest.state)===jsonDigest(state))return;
      if(existing){if(jsonDigest(existing.payload)!==jsonDigest(payload))mismatch('Flow projection fact');return;}
      await this.#emit(client,runId,factId,'flow-state',payload);
    },'hima.flowState');
  }
  /** Read-only UI/Agent projection. It cannot choose or schedule work. */
  async flowProjection(runId:string):Promise<{run:DurableRun;tasks:JsonValue[];controls:JsonValue[]}> {
    const run=await this.run(runId);
    const tasks=(await this.#pool.query<{invocation:FlowInvocationRecord;result:TaskResult|null;state:JsonValue|null}>(`SELECT i.invocation,r.result,
      (SELECT o.payload->'state' FROM hima.outbox o WHERE o.run_id=i.run_id AND o.kind='flow-state' AND o.payload->>'effectId'=i.effect_id ORDER BY o.seq DESC LIMIT 1) AS state
      FROM hima.flow_invocations i LEFT JOIN hima.results r USING(effect_id) WHERE i.run_id=$1 ORDER BY i.effect_id`,[runId])).rows;
    const controls=(await this.#pool.query<{command:JsonValue}>('SELECT command FROM hima.commands WHERE run_id=$1 ORDER BY command_id',[runId])).rows;
    const rules=await this.#revisionRules(this.#pool,runId);
    return {run,tasks:tasks.map(row=>({identity:row.invocation.identity,version:row.invocation.version,branches:[...row.invocation.branches],iterations:[...invocationPath(row.invocation).iterations],
      valid:flowInvocationRevision(rules,invocationPath(row.invocation),row.invocation.consumedVersions).version===row.invocation.version,
      state:row.state??{state:'pending'},result:row.result} as unknown as JsonValue)),controls:controls.map(row=>row.command)};
  }
  /** Original resource/proof facts, including preparation and derived effects outside the
   * interpreter task table. A cancellation request is never substituted for these facts. */
  async flowPhysicalFacts(runId:string):Promise<{resources:FlowPhysicalResource[];effects:FlowPhysicalEffect[];stopped:Record<string,JsonValue>}> {
    const resources=(await this.#pool.query<FlowPhysicalResource>(`SELECT l.effect_id AS "effectId",e.identity,l.site_id AS "siteId",l.claim,
      (l.released_at IS NOT NULL) AS released,l.proof FROM hima.effect_leases l JOIN hima.effects e USING(effect_id)
      WHERE e.run_id=$1 ORDER BY l.effect_id`,[runId])).rows;
    const effects=(await this.#pool.query<FlowPhysicalEffect>(`SELECT identity,phase,admitted_at AS "admittedAt",
      COALESCE((SELECT jsonb_agg(jsonb_build_object('dispatchId',d.dispatch_id,'inputSha256',d.input_sha256,'at',d.started_at) ORDER BY d.dispatch_id)
        FROM hima.effect_dispatches d WHERE d.effect_id=e.effect_id),'[]'::jsonb) AS dispatches
      FROM hima.effects e WHERE run_id=$1 ORDER BY effect_id`,[runId])).rows;
    const stopped=(await this.#pool.query<{name:string;value:JsonValue}>("SELECT name,value FROM hima.flow_facts WHERE run_id=$1 AND name LIKE 'stopped:%' ORDER BY name",[runId])).rows;
    return {resources,effects:effects.map(effect=>({...effect,admittedAt:effect.admittedAt?new Date(effect.admittedAt).toISOString():null})),stopped:Object.fromEntries(stopped.map(row=>[row.name.slice('stopped:'.length),row.value]))};
  }
  async prepareEffect(identity: TaskIdentity, intent: JsonValue): Promise<void> {
    taskIdentity.parse(identity); taskJsonValue.parse(intent);
    await this.transaction(client=>this.#prepareEffect(client,identity,intent),'hima.prepareEffect');
  }
  async #prepareEffect(client:ClientBase,identity:TaskIdentity,intent:JsonValue):Promise<void> {
      const run = await this.#run(client,identity.runId,true);
      if (run.applicationVersion !== this.applicationVersion || identity.applicationVersion !== run.applicationVersion) throw new Error('Effect executable version differs from frozen Run');
      const existing=(await client.query<{identity:TaskIdentity;intent:JsonValue}>('SELECT identity,intent FROM hima.effects WHERE effect_id=$1',[identity.effectId])).rows[0];
      if(existing){
        if(jsonDigest(existing.identity)!==jsonDigest(identity)||jsonDigest(existing.intent)!==jsonDigest(intent))mismatch('Effect');
        return;
      }
      const source=(run.opening.data as {source?:{kind?:string;projectId?:string;team?:{teamId?:string};taskId?:string}}).source;
      if(source?.kind==='team'){
        if(run.hold||run.cancelled)throw new FlowEffectNotCurrent('Held or cancelled Team Run cannot prepare new effects');
        const task=(await client.query<{task:TeamTaskView}>('SELECT task FROM hima.team_tasks WHERE project_id=$1 AND team_id=$2 AND task_id=$3 FOR SHARE',[source.projectId,source.team?.teamId,source.taskId])).rows[0]?.task;
        if(!task||task.currentRunId!==run.runId)throw new FlowEffectNotCurrent('Team effect no longer belongs to the current task Run');
        const admitted=(await client.query<{admitted_generation:number}>(`WITH RECURSIVE ancestry(effect_id) AS (
          SELECT $1::text UNION SELECT d.parent_effect_id FROM hima.flow_derived_effects d JOIN ancestry a ON d.child_effect_id=a.effect_id WHERE d.run_id=$2)
          SELECT i.admitted_generation FROM hima.flow_invocations i JOIN ancestry a USING(effect_id) WHERE i.run_id=$2
          ORDER BY CASE WHEN i.effect_id=$1 THEN 0 ELSE 1 END LIMIT 1`,[identity.effectId,run.runId])).rows[0];
        if(!admitted||admitted.admitted_generation!==run.epoch)throw new FlowEffectNotCurrent('Team effect lost its admitted Run generation');
      }
      await client.query('INSERT INTO hima.effects(effect_id,run_id,input_sha256,identity,intent) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING', [identity.effectId,identity.runId,identity.inputSha256,JSON.stringify(identity),JSON.stringify(intent)]);
      const effect = (await client.query<{identity:TaskIdentity;intent:JsonValue}>('SELECT identity,intent FROM hima.effects WHERE effect_id=$1',[identity.effectId])).rows[0]!;
      if (jsonDigest(effect.identity) !== jsonDigest(identity) || jsonDigest(effect.intent) !== jsonDigest(intent)) mismatch('Effect');
  }
  async #externalTransaction<T>(body:(client:ClientBase)=>Promise<T>):Promise<T> {
    const client=await this.#pool.connect();
    try {await client.query('BEGIN');const result=await body(client);await client.query('COMMIT');return result;}
    catch(error){await client.query('ROLLBACK').catch(()=>undefined);throw error;}finally{client.release();}
  }
  async prepareExternalEffect(identity:TaskIdentity,intent:JsonValue):Promise<void> {
    taskIdentity.parse(identity);taskJsonValue.parse(intent);
    await this.#externalTransaction(client=>this.#prepareEffect(client,identity,intent));
  }
  /** Only a short native callback's fact reservation. No arbitrary SQL, long I/O, nested Store
   * transaction or lease call is exposed/allowed: those could deadlock the held Run lock.
   * Acquire Site leases separately (Site advisory -> Run), then recheck at actual dispatch. */
  async externalEffectTransaction<T>(identity:TaskIdentity,options:{readonly admission?:EffectAdmission;readonly permit:()=>Promise<boolean>;readonly soleCurrentInvocation?:true},
    body:(run:DurableRun,facts:Readonly<Record<string,JsonValue>>,record:(phase:string,fact:JsonValue)=>Promise<void>)=>Promise<T>):Promise<T> {
    taskIdentity.parse(identity);
    return this.#externalTransaction(async client=>{
      const collecting=options.admission?await this.#assertHostAdmission(client,options.admission):false;
      const run=await this.#run(client,identity.runId,true);
      const effect=(await client.query<{identity:TaskIdentity}>('SELECT identity FROM hima.effects WHERE effect_id=$1',[identity.effectId])).rows[0];
      if(run.applicationVersion!==this.applicationVersion||!effect||jsonDigest(effect.identity)!==jsonDigest(identity))mismatch('External callback effect');
      const admission=options.admission;
      if(admission) {
        if(admission.runId!==identity.runId||admission.effectId!==identity.effectId)throw new Error('Native callback admission belongs to another effect');
        if(run.cancelled||(run.hold&&!collecting)||run.owner!==admission.owner||run.epoch!==admission.epoch||!await this.#effectRevisionMatches(client,run,admission)||Date.parse(run.deadlineAt)<=Date.now())throw new Error('Effect admission blocked by current owner, hold, deadline or version; refresh Run authority');
        await this.#assertBusinessEffectOpen(client,identity.runId,identity.effectId);
      }
      if(options.soleCurrentInvocation) {
        const rules = await this.#revisionRules(client, run.runId);
        const candidates = (await client.query<{invocation:FlowInvocationRecord}>(`SELECT i.invocation FROM hima.flow_invocations i
          WHERE i.run_id=$1 AND NOT EXISTS(SELECT 1 FROM hima.results r WHERE r.effect_id=i.effect_id)
          AND (SELECT o.payload->'state'->>'state' FROM hima.outbox o WHERE o.run_id=i.run_id AND o.kind='flow-state'
            AND o.payload->>'effectId'=i.effect_id ORDER BY o.seq DESC LIMIT 1) IN ('running','waiting')`,[run.runId])).rows
          .map(row=>row.invocation).filter(invocation=>flowInvocationRevision(rules,invocationPath(invocation),invocation.consumedVersions).version===invocation.version);
        if(candidates.length!==1 || jsonDigest(candidates[0]!.identity)!==jsonDigest(identity)) throw new Error('Campaign knowledge evidence requires exactly one currently admitted node execution');
        if(run.revision!==admission?.revision) throw new Error('Campaign knowledge control revision changed during source I/O');
        const budget=run.opening.data as {budget?:{closingReserveMs?:number;attemptLimit?:number}};
        if(budget.budget?.attemptLimit!==undefined) {
          const used=Number((await client.query<{count:string}>(`SELECT count(*) FROM hima.effect_dispatches d JOIN hima.flow_invocations i USING(effect_id) WHERE i.run_id=$1 AND d.dispatch_id='submit' AND ${countedInvocation}`,[run.runId])).rows[0]!.count);
          if(used>=budget.budget.attemptLimit) throw new Error('Campaign knowledge evidence requires an active writable Campaign');
        }
        if(Date.now()>=Date.parse(run.deadlineAt)-(budget.budget?.closingReserveMs??0)) throw new Error('Campaign knowledge evidence requires an active writable Campaign');
      }
      if(!await options.permit())throw new Error('Native callback is blocked by current Site Permit');
      if(admission)await client.query('UPDATE hima.effects SET admitted_at=COALESCE(admitted_at,clock_timestamp()) WHERE effect_id=$1',[identity.effectId]);
      const rows=(await this.#orderedExternalEffectFacts(client,identity,'',true)).map(row=>[row.phase,row.fact] as const);
      const facts:Record<string,JsonValue>=Object.fromEntries(rows);
      return body(run,facts,async(phase,fact)=>{
        assertName(phase);taskJsonValue.parse(fact);
        await this.#recordEffectFact(client,identity,`native:${phase}`,fact);
        facts[phase]=structuredClone(fact);
      });
    });
  }
  /** Uncached and outside DBOS operations. Call immediately inside the actual adapter callback;
   * replay of an earlier transaction/step must never grant permission to submit again. */
  async assertEffectAdmission(admission: EffectAdmission, permit: () => Promise<boolean>): Promise<DurableRun> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const collecting=await this.#assertHostAdmission(client,admission);
      const run = await this.#run(client,admission.runId,true);
      if (run.applicationVersion !== this.applicationVersion || run.cancelled || (run.hold&&!collecting) || run.owner !== admission.owner || run.epoch !== admission.epoch || !await this.#effectRevisionMatches(client,run,admission) || Date.parse(run.deadlineAt) <= Date.now()) throw new Error('Effect admission blocked by current owner, hold, deadline or version; refresh Run authority');
      await this.#assertBusinessEffectOpen(client,admission.runId,admission.effectId);
      if (!await permit()) throw new Error('Effect admission blocked by current Site Permit');
      await client.query("UPDATE hima.effects SET admitted_at=COALESCE(admitted_at,clock_timestamp()),phase=CASE WHEN phase='intent' THEN 'admitted' ELSE phase END WHERE effect_id=$1",[admission.effectId]);
      await client.query('COMMIT');
      return run;
    } catch(error) { await client.query('ROLLBACK').catch(() => undefined); throw error; }
    finally { client.release(); }
  }
  async #assertBusinessEffectOpen(client:ClientBase,runId:string,effectId:string,ignoreReversibleBranchHold=false):Promise<void> {
    await this.#assertFlowEffectCurrent(client,await this.#run(client,runId),effectId,ignoreReversibleBranchHold);
    const grants=(await client.query<{grant_data:ActorGrant}>("SELECT grant_data FROM hima.task_actor_grants WHERE grant_data->>'effectId'=$1 FOR SHARE",[effectId])).rows;
    if(grants.some(row=>row.grant_data.revokedAt||Date.now()>=Date.parse(row.grant_data.expiresAt)))throw new FlowEffectNotCurrent('Current member grant was revoked or expired before actual business callback');
    const controlled=(await client.query<{invocation:FlowInvocationRecord;purpose:string}>(`WITH RECURSIVE ancestry(effect_id) AS (SELECT $1::text UNION SELECT d.parent_effect_id FROM hima.flow_derived_effects d JOIN ancestry a ON d.child_effect_id=a.effect_id WHERE d.run_id=$2) SELECT i.invocation,COALESCE((SELECT purpose FROM hima.flow_derived_effects WHERE child_effect_id=$1),'business') AS purpose FROM hima.flow_invocations i JOIN ancestry a USING(effect_id) WHERE i.run_id=$2 ORDER BY CASE WHEN i.effect_id=$1 THEN 0 ELSE 1 END LIMIT 1`,[effectId,runId])).rows[0];
    if(controlled&&controlled.purpose!=='collect'&&Date.now()>=Date.parse((await this.teamExecutionBinding(client,controlled.invocation.identity)).deadlineAt))throw new FlowEffectNotCurrent('Bound execution deadline reached before actual native callback');
    if((await client.query('SELECT 1 FROM hima.team_waits WHERE parent_effect_id=$1 AND run_id=$2',[effectId,runId])).rowCount)throw new Error('Parent accepted a wait; new business sends are fenced while original physical cleanup remains available');
    const closedParent=(await client.query(`WITH RECURSIVE ancestry(effect_id,edge_purpose) AS (
      SELECT parent_effect_id,purpose FROM hima.flow_derived_effects WHERE child_effect_id=$1 AND run_id=$2
      UNION SELECT d.parent_effect_id,d.purpose FROM hima.flow_derived_effects d JOIN ancestry a ON d.child_effect_id=a.effect_id WHERE d.run_id=$2)
      SELECT 1 FROM ancestry a WHERE EXISTS(SELECT 1 FROM hima.results r WHERE r.effect_id=a.effect_id)
      OR EXISTS(SELECT 1 FROM hima.effect_facts f WHERE f.effect_id=a.effect_id AND f.phase='terminal-failure')
      OR (EXISTS(SELECT 1 FROM hima.host_exit WHERE singleton=true AND active_request IS NOT NULL)
        AND EXISTS(SELECT 1 FROM hima.effect_facts f WHERE f.effect_id=a.effect_id AND f.phase='validated-result'))
      OR (COALESCE((SELECT purpose FROM hima.flow_derived_effects WHERE child_effect_id=$1),'business')<>'collect'
        AND a.edge_purpose NOT IN ('delegation','continuation')
        AND EXISTS(SELECT 1 FROM hima.effect_leases l WHERE l.effect_id=a.effect_id AND l.released_at IS NOT NULL)) LIMIT 1`,[effectId,runId])).rowCount;
    if(closedParent)throw new Error('Derived task parent is terminal or released; no new business work');
    const effect=(await client.query<{closed:boolean}>(`SELECT
      EXISTS(SELECT 1 FROM hima.results WHERE effect_id=e.effect_id) OR
      EXISTS(SELECT 1 FROM hima.effect_facts WHERE effect_id=e.effect_id AND phase='terminal-failure') OR
      EXISTS(SELECT 1 FROM hima.effect_leases WHERE effect_id=e.effect_id AND released_at IS NOT NULL) AS closed
      FROM hima.effects e WHERE e.effect_id=$1 AND e.run_id=$2`,[effectId,runId])).rows[0];
    if(!effect)throw new Error('Effect intent must be retained before admission');
    if(effect.closed)throw new Error('Effect invocation is terminal or released; read its retained result/resources instead of sending new business work');
  }
  async recordEffectFact(identity: TaskIdentity, phase: string, fact: JsonValue): Promise<void> {
    taskIdentity.parse(identity); taskJsonValue.parse(fact); assertName(phase);
    await this.transaction(client=>this.#recordEffectFact(client,identity,phase,fact),'hima.recordEffectFact');
  }
  async #recordEffectFact(client:ClientBase,identity:TaskIdentity,phase:string,fact:JsonValue):Promise<void> {
      await this.#run(client,identity.runId,true);
      const effect = (await client.query<{identity:TaskIdentity}>('SELECT identity FROM hima.effects WHERE effect_id=$1 FOR UPDATE',[identity.effectId])).rows[0];
      if (!effect || jsonDigest(effect.identity) !== jsonDigest(identity)) mismatch('Effect');
      if(phase.startsWith('native:knowledge:document:') && (await client.query(`SELECT 1 FROM hima.effect_facts f JOIN hima.effects e USING(effect_id)
        WHERE e.run_id=$1 AND f.phase=$2 AND f.effect_id<>$3 LIMIT 1`,[identity.runId,phase,identity.effectId])).rowCount) mismatch('Campaign knowledge call invocation');
      const held=(await client.query<{fact:JsonValue}>('SELECT fact FROM hima.effect_facts WHERE effect_id=$1 AND phase=$2',[identity.effectId,phase])).rows[0];
      if(held) { if(jsonDigest(held.fact)!==jsonDigest(fact)) mismatch('Effect fact'); return; }
      await client.query('INSERT INTO hima.effect_facts VALUES($1,$2,$3)',[identity.effectId,phase,JSON.stringify(fact)]);
      await client.query('UPDATE hima.effects SET phase=$2,fact=$3 WHERE effect_id=$1',[identity.effectId,phase,JSON.stringify(fact)]);
      await this.#emit(client,identity.runId,factIdentity('effect-fact',identity.effectId,phase),'effect-fact',{identity,phase,fact} as unknown as JsonValue);
  }
  /** External native callback journal only. This raw transaction may run inside a DBOS Step;
   * main workflows must use effectSnapshot rather than skip operations from this uncached read.
   * Truthful receipts can be retained under hold; business writes still need current admission. */
  async recordExternalEffectFact(identity:TaskIdentity,phase:string,fact:JsonValue):Promise<void> {
    taskIdentity.parse(identity);taskJsonValue.parse(fact);assertName(phase);
    const client=await this.#pool.connect();
    try {
      await client.query('BEGIN');
      await this.#recordEffectFact(client,identity,`native:${phase}`,fact);
      await client.query('COMMIT');
    }catch(error){await client.query('ROLLBACK').catch(()=>undefined);throw error;}finally{client.release();}
  }
  /** Preserve the existing Campaign research-write budget at the actual writer-call boundary,
   * before grammar/path checks. Refused attempts count too. This is not an AI-round quota.
   * A native callback can use this raw transaction inside a Step without datasource nesting. */
  async reserveExternalResearchWrite(identity:TaskIdentity,request:ExternalResearchWriteRequest):Promise<ResearchWriteAdmission> {
    taskIdentity.parse(identity);assertName(request.callId);assertName(request.sessionId);
    if(!Number.isSafeInteger(request.requestedBytes)||request.requestedBytes<0||!Number.isSafeInteger(request.attempt)||request.attempt<1
      || !['workshop','workspace'].includes(request.scope)||!/^[0-9a-f]{64}$/.test(request.contentSha256))throw new Error('Research writer needs original scope, nonnegative actual bytes and their SHA256 digest');
    const fixed={callId:request.callId,nodeId:request.nodeId,attempt:request.attempt,sessionId:request.sessionId,
      scope:request.scope,...(request.workshop===undefined?{}:{workshop:request.workshop}),path:request.path,
      requestedBytes:request.requestedBytes,contentSha256:request.contentSha256,...(request.branchId===undefined?{}:{branchId:request.branchId})};
    taskJsonValue.parse(fixed);
    const phase=`native:research-write:${jsonDigest([request.sessionId,request.callId])}`;
    return this.#externalTransaction(async client=>{
      const run=await this.#run(client,identity.runId,true);
      const effect=(await client.query<{identity:TaskIdentity}>('SELECT identity FROM hima.effects WHERE effect_id=$1',[identity.effectId])).rows[0];
      if(run.applicationVersion!==this.applicationVersion||!effect||jsonDigest(effect.identity)!==jsonDigest(identity))mismatch('Research writer effect');
      const previous=(await client.query<{identity:TaskIdentity;fact:{request:ExternalResearchWriteRequest;receipt:ResearchWriteAdmission}}>(`SELECT e.identity,f.fact FROM hima.effect_facts f JOIN hima.effects e USING(effect_id)
        WHERE e.run_id=$1 AND f.phase=$2`,[identity.runId,phase])).rows;
      if(previous.length>1)throw new Error('Research writer call has ambiguous original reservations; inspect its native session/tool call');
      if(previous[0]) {
        if(jsonDigest(previous[0].identity)!==jsonDigest(identity)||jsonDigest(previous[0].fact.request as unknown as JsonValue)!==jsonDigest(fixed))throw new Error('Research writer session/tool-call identity was reused with different scope, content digest or bytes');
        return previous[0].fact.receipt;
      }
      const pack=await this.packBinding(client,run.runId);
      if(pack) {await this.#assertHostAdmission(client);await this.assertPackParent(client,pack,run);await this.#assertBusinessEffectOpen(client,run.runId,identity.effectId);}
      const budgetRun=pack?await this.#run(client,pack.parentIdentity.runId):run;
      const data=budgetRun.opening.data;
      const budget=data!==null&&!Array.isArray(data)&&typeof data==='object'&&data.budget!==null&&!Array.isArray(data.budget)&&typeof data.budget==='object'?data.budget:{};
      const limitWriteAttempts=budget.researchWriteAttempts??256,limitBytes=budget.researchWriteBytes??4*1024*1024;
      if(typeof limitWriteAttempts!=='number'||typeof limitBytes!=='number'||!Number.isSafeInteger(limitWriteAttempts)||limitWriteAttempts<1||!Number.isSafeInteger(limitBytes)||limitBytes<1)throw new Error('Frozen Campaign research-write limits are invalid; restore its original validated budget');
      const held=(await client.query<{fact:{request:{requestedBytes:number}}}>(`SELECT f.fact FROM hima.effect_facts f JOIN hima.effects e USING(effect_id)
        WHERE (e.run_id=$1 OR EXISTS(SELECT 1 FROM hima.runs r JOIN hima.team_pack_delegations d ON d.child_task_id=r.opening->'data'->'source'->>'taskId' WHERE r.run_id=e.run_id AND d.parent_run_id=$1)) AND left(f.phase,length('native:research-write:'))='native:research-write:'`,[budgetRun.runId])).rows;
      if(held.some(row=>!Number.isSafeInteger(row.fact.request.requestedBytes)||row.fact.request.requestedBytes<0))throw new Error('Retained Campaign research-write bytes are invalid; inspect original writer facts');
      const usedWriteAttempts=held.length+1,usedBytes=held.reduce((total,row)=>total+row.fact.request.requestedBytes,request.requestedBytes);
      const allowed=usedWriteAttempts<=limitWriteAttempts&&usedBytes<=limitBytes;
      const reason=allowed?undefined:`the Campaign research-write budget is exhausted: attempted ${usedWriteAttempts}/${limitWriteAttempts} calls and ${usedBytes}/${limitBytes} bytes; nothing was written`;
      const receipt:ResearchWriteAdmission={allowed,callId:request.callId,recordId:factIdentity('effect-fact',identity.effectId,phase),usedWriteAttempts,usedBytes,...(reason===undefined?{}:{reason})};
      await this.#recordEffectFact(client,identity,phase,{request:fixed,receipt,limitWriteAttempts,limitBytes} as unknown as JsonValue);
      return receipt;
    });
  }
  async externalEffectFact(identity:TaskIdentity,phase:string):Promise<JsonValue|undefined> {
    taskIdentity.parse(identity);assertName(phase);
    const effect=await this.effect(identity.effectId);
    if(!effect||jsonDigest(effect.identity)!==jsonDigest(identity))mismatch('Native receipt effect');
    return this.effectFact(identity.effectId,`native:${phase}`);
  }
  /** Callback recovery can enumerate original immutable native receipts without maintaining a
   * second mutable index. A workflow must Step-retain this snapshot before branching from it. */
  async listExternalEffectFacts(identity:TaskIdentity,prefix=''):Promise<Record<string,JsonValue>> {
    taskIdentity.parse(identity);
    const effect=await this.effect(identity.effectId);
    if(!effect||jsonDigest(effect.identity)!==jsonDigest(identity))mismatch('Native receipt effect');
    const namespace=`native:${prefix}`;
    const rows=(await this.#pool.query<{phase:string;fact:JsonValue}>('SELECT phase,fact FROM hima.effect_facts WHERE effect_id=$1 AND left(phase,length($2))=$2 ORDER BY phase',[identity.effectId,namespace])).rows;
    return Object.fromEntries(rows.map(row=>[row.phase.slice('native:'.length),row.fact]));
  }
  /** Look up one retained native receive without transferring its raw observation
   * history into the Host. The original fact remains the receipt authority. */
  async externalEffectReceivedObservation(identity:TaskIdentity,inputId:string):Promise<JsonValue|undefined> {
    taskIdentity.parse(identity);assertName(inputId);
    const effect=await this.effect(identity.effectId);
    if(!effect||jsonDigest(effect.identity)!==jsonDigest(identity))mismatch('Native receipt effect');
    const prefix='native:oar:observation:';
    const rows=(await this.#pool.query<{fact:JsonValue}>(`SELECT fact FROM hima.effect_facts
      WHERE effect_id=$1 AND left(phase,length($2))=$2
        AND fact->>'kind'='received' AND fact->'payload'->>'inputId'=$3 LIMIT 2`,
      [identity.effectId,prefix,inputId])).rows;
    if(rows.length>1)throw new Error('Native input has ambiguous original receive observations.');
    return rows[0]?.fact;
  }
  /** Native Code/Knowledge reconstruction uses the application outbox's actual fact order.
   * call IDs name immutable writes; neither a session-local counter nor phase lexical order is
   * an ordering authority. Acknowledged projection rows remain authoritative and readable. */
  async orderedExternalEffectFacts(identity:TaskIdentity,prefix=''):Promise<readonly {phase:string;fact:JsonValue;seq:number}[]> {
    taskIdentity.parse(identity);
    const effect=await this.effect(identity.effectId);
    if(!effect||jsonDigest(effect.identity)!==jsonDigest(identity))mismatch('Native receipt effect');
    return this.#orderedExternalEffectFacts(this.#pool,identity,prefix);
  }
  async #orderedExternalEffectFacts(client:Pick<ClientBase,'query'>,identity:TaskIdentity,prefix:string,omitOarObservations=false):Promise<readonly {phase:string;fact:JsonValue;seq:number}[]> {
    const namespace=`native:${prefix}`;
    const rows=(await client.query<{phase:string;fact:JsonValue;seq:number}>(`SELECT f.phase,f.fact,o.seq
      FROM hima.effect_facts f JOIN hima.outbox o ON o.kind='effect-fact'
        AND o.payload->'identity'->>'effectId'=f.effect_id AND o.payload->>'phase'=f.phase
      WHERE f.effect_id=$1 AND left(f.phase,length($2))=$2 AND o.run_id=$3
        AND ($4::boolean=false OR left(f.phase,length('native:oar:observation:'))<>'native:oar:observation:')
      ORDER BY o.seq`,[identity.effectId,namespace,identity.runId,omitOarObservations])).rows;
    return rows.map(row=>({...row,phase:row.phase.slice('native:'.length)}));
  }
  /** Reopened native child tool guards recover their original PG grant without a process-local
   * callback registry. Ambiguous grants fail closed instead of selecting an arbitrary owner. */
  async nativeSessionEffect(sessionId:string):Promise<{identity:TaskIdentity;fact:JsonValue}|undefined> {
    assertName(sessionId);
    const rows=(await this.#pool.query<{identity:TaskIdentity;fact:JsonValue}>(`SELECT e.identity,f.fact FROM hima.effect_facts f JOIN hima.effects e USING(effect_id)
      WHERE left(f.phase,length('native:child:'))='native:child:' AND right(f.phase,length(':intent'))=':intent' AND f.fact->'effective'->>'childSessionId'=$1 LIMIT 2`,[sessionId])).rows;
    if(rows.length>1)throw new Error('Native child session has ambiguous retained effect ownership; reconcile its original session before new tool writes');
    return rows[0];
  }
  async fact(factId:string):Promise<DurableFact|undefined> {
    const row=(await this.#pool.query<DurableFact>('SELECT fact_id AS "factId",run_id AS "runId",seq,kind,payload,at FROM hima.outbox WHERE fact_id=$1',[factId])).rows[0];
    return row?{...row,at:new Date(row.at).toISOString()}:undefined;
  }
  async effect(effectId: string): Promise<{identity:TaskIdentity;intent:JsonValue;phase:string;fact:JsonValue|null}|undefined> {
    return (await this.#pool.query('SELECT identity,intent,phase,fact FROM hima.effects WHERE effect_id=$1',[effectId])).rows[0];
  }
  async effectFact(effectId: string, phase: string): Promise<JsonValue | undefined> {
    return (await this.#pool.query<{fact:JsonValue}>('SELECT fact FROM hima.effect_facts WHERE effect_id=$1 AND phase=$2',[effectId,phase])).rows[0]?.fact;
  }
  /** A workflow branches only from this datasource-receipted snapshot. Large OAR
   * observation rows are audit evidence, not effect control phases; read them
   * explicitly through listExternalEffectFacts when needed. */
  async effectSnapshot(identity:TaskIdentity):Promise<{facts:Record<string,JsonValue>;result:TaskResult|null;resourcesReleased:boolean}> {
    return this.transaction(async client=>{
      const effect=(await client.query<{identity:TaskIdentity}>('SELECT identity FROM hima.effects WHERE effect_id=$1',[identity.effectId])).rows[0];
      if(!effect||jsonDigest(effect.identity)!==jsonDigest(identity))mismatch('Snapshot effect');
      const facts=(await client.query<{phase:string;fact:JsonValue}>(`SELECT phase,fact FROM hima.effect_facts
        WHERE effect_id=$1 AND left(phase,length('native:oar:observation:'))<>'native:oar:observation:'`,[identity.effectId])).rows;
      const result=(await client.query<{result:TaskResult}>('SELECT result FROM hima.results WHERE effect_id=$1',[identity.effectId])).rows[0]?.result??null;
      const released=(await client.query<{released:boolean}>('SELECT released_at IS NOT NULL AS released FROM hima.effect_leases WHERE effect_id=$1',[identity.effectId])).rows[0]?.released??false;
      return {facts:Object.fromEntries(facts.map(row=>[row.phase,row.fact])),result,resourcesReleased:released};
    },'hima.effectSnapshot');
  }
  /** Retained reservations count actual owned resources, including uncertain launches. They are
   * facts, not workflow scheduling: only confirmed physical closure releases a reservation. */
  async reserveEffectResources(identity: TaskIdentity, claim: EffectResourceClaim,
    capacity: {readonly jobs:number;readonly licences:Readonly<Record<string,number>>}): Promise<boolean> {
    return this.transaction(client=>this.#reserveEffectResources(client,identity,claim,capacity),'hima.reserveEffectResources');
  }
  async reserveExternalEffectResources(identity:TaskIdentity,claim:EffectResourceClaim,
    capacity:{readonly jobs:number;readonly licences:Readonly<Record<string,number>>}):Promise<boolean> {
    return this.#externalTransaction(client=>this.#reserveEffectResources(client,identity,claim,capacity));
  }
  async #reserveEffectResources(client:ClientBase,identity:TaskIdentity,claim:EffectResourceClaim,
    capacity:{readonly jobs:number;readonly licences:Readonly<Record<string,number>>}):Promise<boolean> {
    taskIdentity.parse(identity);
    for (const amount of [claim.jobs,capacity.jobs,...Object.values(claim.licences),...Object.values(capacity.licences)])
      if (!Number.isSafeInteger(amount) || amount < 0) throw new Error('Site resource counts must be nonnegative integers');
    assertName(claim.siteId);
      await client.query('SELECT singleton FROM hima.host_exit WHERE singleton=true FOR SHARE');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`hima-site:${claim.siteId}`]);
      const run=await this.#run(client,identity.runId,true);
      if(run.applicationVersion!==this.applicationVersion||identity.applicationVersion!==run.applicationVersion)throw new Error('Resource effect version differs from frozen Run');
      const effect=(await client.query<{identity:TaskIdentity}>('SELECT identity FROM hima.effects WHERE effect_id=$1',[identity.effectId])).rows[0];
      if(!effect || jsonDigest(effect.identity)!==jsonDigest(identity)) mismatch('Resource effect');
      const pack=await this.packBinding(client,run.runId);if(pack)await this.assertPackParent(client,pack,run);
      const existing=(await client.query<{claim:EffectResourceClaim;released_at:string|null}>('SELECT claim,released_at FROM hima.effect_leases WHERE effect_id=$1',[identity.effectId])).rows[0];
      if(existing) { if(jsonDigest(existing.claim as unknown as JsonValue)!==jsonDigest(claim as unknown as JsonValue)) mismatch('Resource claim'); return existing.released_at===null; }
      // A retained stop proof is monotone. Preparation may finish after cleanup, but
      // that original identity cannot acquire its first lease after physical closure.
      if((await client.query('SELECT 1 FROM hima.flow_facts WHERE run_id=$1 AND name=$2',[identity.runId,`stopped:${identity.effectId}`])).rowCount)return false;
      await this.assertTeamLineageCurrent(client,run,identity.effectId);
      const held=(await client.query<{claim:EffectResourceClaim}>('SELECT claim FROM hima.effect_leases WHERE site_id=$1 AND released_at IS NULL',[claim.siteId])).rows;
      if(held.reduce((count,row)=>count+row.claim.jobs,claim.jobs)>capacity.jobs) return false;
      for(const [licence,amount] of Object.entries(claim.licences))
        if(held.reduce((count,row)=>count+declaredAmount(row.claim.licences,licence),amount)>declaredAmount(capacity.licences,licence)) return false;
      await client.query('INSERT INTO hima.effect_leases(effect_id,site_id,claim) VALUES($1,$2,$3)',[identity.effectId,claim.siteId,JSON.stringify(claim)]);
      await this.#emit(client,identity.runId,factIdentity('resources-held',identity.effectId),'resources-held',{identity,claim} as unknown as JsonValue);
      return true;
  }
  async effectResources(effectId?:string):Promise<Array<{effectId:string;siteId:string;claim:EffectResourceClaim;released:boolean;proof:JsonValue|null}>> {
    return (await this.#pool.query('SELECT effect_id AS "effectId",site_id AS "siteId",claim,released_at IS NOT NULL AS released,proof FROM hima.effect_leases WHERE ($1::text IS NULL OR effect_id=$1)',[effectId??null])).rows;
  }
  /** Callback recovery distinguishes a retained intent from a send that crossed admission.
   * This uncached fact never replaces the actual current-admission check or permits a resend. */
  async effectDispatchExists(identity:TaskIdentity,dispatchId:string):Promise<boolean> {
    taskIdentity.parse(identity);assertName(dispatchId);
    const effect=await this.effect(identity.effectId);
    if(!effect||jsonDigest(effect.identity)!==jsonDigest(identity))mismatch('Dispatch receipt effect');
    return (await this.#pool.query('SELECT 1 FROM hima.effect_dispatches WHERE effect_id=$1 AND dispatch_id=$2',[identity.effectId,dispatchId])).rowCount!==0;
  }
  async releaseEffectResources(identity:TaskIdentity,proof:JsonValue):Promise<void> {
    taskJsonValue.parse(proof);
    await this.transaction(client=>this.#releaseEffectResources(client,identity,proof),'hima.releaseEffectResources');
  }
  async releaseExternalEffectResources(identity:TaskIdentity,proof:JsonValue):Promise<void> {
    taskJsonValue.parse(proof);
    await this.#externalTransaction(client=>this.#releaseEffectResources(client,identity,proof));
  }
  async #releaseEffectResources(client:ClientBase,identity:TaskIdentity,proof:JsonValue):Promise<void> {
      taskIdentity.parse(identity);
      await this.#run(client,identity.runId,true);
      const held=(await client.query<{identity:TaskIdentity;proof:JsonValue|null;released_at:string|null}>('SELECT e.identity,l.proof,l.released_at FROM hima.effect_leases l JOIN hima.effects e USING(effect_id) WHERE effect_id=$1 FOR UPDATE OF l',[identity.effectId])).rows[0];
      if(!held || jsonDigest(held.identity)!==jsonDigest(identity)) mismatch('Release effect');
      // Concurrent successful delivery and independent stop may observe different signed closure
      // states. Keep the first confirmed proof and one release; neither can rewrite its identity.
      if(held.released_at) return;
      await client.query('UPDATE hima.effect_leases SET released_at=clock_timestamp(),proof=$2 WHERE effect_id=$1',[identity.effectId,JSON.stringify(proof)]);
      await this.#emit(client,identity.runId,factIdentity('resources-released',identity.effectId),'resources-released',{identity,proof} as unknown as JsonValue);
  }
  /** A crash after this uncached claim is deliberately ambiguous. The next caller queries the
   * same external identity; neither a failed DBOS Step nor retriesAllowed:false permits resend. */
  async claimEffectDispatch(admission:EffectAdmission,permit:()=>Promise<boolean>,dispatchId:string,inputSha256:string):Promise<boolean> {
    assertName(dispatchId);
    if(!/^[0-9a-f]{64}$/.test(inputSha256)) throw new Error('Dispatch needs a SHA256 input identity');
    const client=await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const collecting=await this.#assertHostAdmission(client,admission);
      const run=await this.#run(client,admission.runId,true);
      if(run.applicationVersion!==this.applicationVersion || run.cancelled || (run.hold&&!collecting) || run.owner!==admission.owner || run.epoch!==admission.epoch || !await this.#effectRevisionMatches(client,run,admission) || Date.parse(run.deadlineAt)<=Date.now()) throw new Error('Effect admission blocked by current owner, hold, deadline or version; refresh Run authority');
      await this.#assertBusinessEffectOpen(client,admission.runId,admission.effectId);
      const previous=(await client.query<{input_sha256:string}>('SELECT input_sha256 FROM hima.effect_dispatches WHERE effect_id=$1 AND dispatch_id=$2',[admission.effectId,dispatchId])).rows[0];
      if(previous) { if(previous.input_sha256!==inputSha256) mismatch('Dispatch'); await client.query('COMMIT'); return false; }
      if(!await permit()) throw new Error('Effect admission blocked by current Site Permit');
      await client.query('INSERT INTO hima.effect_dispatches(effect_id,dispatch_id,input_sha256) VALUES($1,$2,$3)',[admission.effectId,dispatchId,inputSha256]);
      await client.query("UPDATE hima.effects SET admitted_at=COALESCE(admitted_at,clock_timestamp()),phase=CASE WHEN phase='intent' THEN 'admitted' ELSE phase END WHERE effect_id=$1",[admission.effectId]);
      await client.query('COMMIT'); return true;
    } catch(error) {await client.query('ROLLBACK').catch(()=>undefined);throw error;}
    finally {client.release();}
  }
  /** Cleanup targets the original owned resource and may proceed under pause/cancel/handoff.
   * This permission can never submit new business work or repeat a native prompt. */
  async claimEffectCleanup(identity:TaskIdentity,permit:()=>Promise<boolean>,dispatchId:string,inputSha256:string,exitRequestId?:string,handoff?:{cause:'definition-change';taskId:string;requestId:string}):Promise<boolean> {
    assertName(dispatchId);
    const client=await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const stopActive=exitRequestId===undefined||await this.#hostExitStopActive(client,exitRequestId,'source' in identity&&identity.source.kind==='team');
      const run=await this.#run(client,identity.runId,true);
      if(handoff) {
        const gate=(await client.query<{gate:TeamDefinitionHandoffGate}>('SELECT gate FROM hima.team_definition_handoffs WHERE task_id=$1 AND request_id=$2 AND previous_run_id=$3',[handoff.taskId,handoff.requestId,run.runId])).rows[0]?.gate;
        if(!gate||gate.cause!==handoff.cause||gate.request.runId!==run.runId||gate.postFenceEpoch>run.epoch)throw new TeamError('hima/not-authorized','Original task-local cleanup gate is unavailable.');
      }
      const effect=(await client.query<{identity:TaskIdentity}>('SELECT identity FROM hima.effects WHERE effect_id=$1',[identity.effectId])).rows[0];
      if(run.applicationVersion!==this.applicationVersion||!effect||jsonDigest(effect.identity)!==jsonDigest(identity)) mismatch('Cleanup effect');
      const previous=(await client.query<{input_sha256:string}>('SELECT input_sha256 FROM hima.effect_dispatches WHERE effect_id=$1 AND dispatch_id=$2',[identity.effectId,dispatchId])).rows[0];
      if(previous) {if(previous.input_sha256!==inputSha256)mismatch('Cleanup dispatch');await client.query('COMMIT');return false;}
      if(!stopActive)throw new Error('App exit stop request is stale or no longer active');
      if(!await permit())throw new Error('Original resource cleanup is blocked by current Site Permit');
      await client.query('INSERT INTO hima.effect_dispatches(effect_id,dispatch_id,input_sha256) VALUES($1,$2,$3)',[identity.effectId,dispatchId,inputSha256]);
      await client.query('COMMIT');return true;
    }catch(error){await client.query('ROLLBACK').catch(()=>undefined);throw error;}finally{client.release();}
  }
  /** A direct datasource transaction: result + outbox + datasource receipt commit together. */
  async commitResult(result: TaskResult): Promise<TaskResult> {
    taskResult.parse(result);
    for(const artifact of result.artifacts) if(artifact.runId!==result.identity.runId || artifact.taskId!==result.identity.taskId || artifact.effectId!==result.identity.effectId) throw new Error('Result artifact identity differs from its task invocation');
    const digest = jsonDigest(result);
    return this.transaction(async client => {
      await client.query('SELECT singleton FROM hima.host_exit WHERE singleton=true FOR SHARE');
      const run = await this.#run(client,result.identity.runId,true);
      if (run.applicationVersion !== result.identity.applicationVersion) throw new Error('Result version differs from frozen Run');
      const effect = (await client.query<{identity:TaskIdentity}>('SELECT identity FROM hima.effects WHERE effect_id=$1',[result.identity.effectId])).rows[0];
      if (!effect || jsonDigest(effect.identity) !== jsonDigest(result.identity)) mismatch('Result effect');
      const lease=(await client.query<{released_at:string|null}>('SELECT released_at FROM hima.effect_leases WHERE effect_id=$1',[result.identity.effectId])).rows[0];
      if(lease) {
        if(lease.released_at===null)throw new Error('Task result is retained but its actual owned resources are not confirmed released');
        const validated=(await client.query<{fact:JsonValue}>("SELECT fact FROM hima.effect_facts WHERE effect_id=$1 AND phase='validated-result'",[result.identity.effectId])).rows[0];
        if(!validated||jsonDigest(validated.fact)!==digest)throw new Error('Task result differs from its retained verified delivery; recollect the original task');
      }
      const pack=(await client.query<{binding:PackTeamPlan}>('SELECT binding FROM hima.team_pack_delegations WHERE parent_effect_id=$1',[result.identity.effectId])).rows[0]?.binding;
      if(pack) {
        const adoption=(await client.query<{fact:{resultSha256:string}}>("SELECT fact FROM hima.effect_facts WHERE effect_id=$1 AND phase='pack-team-result'",[result.identity.effectId])).rows[0]?.fact;
        if(adoption?.resultSha256!==digest||!await this.packClosed(client,pack))throw new Error('Pack Team result needs retained exact adoption and whole original child closure');
      }
      const held = (await client.query<{result_sha256:string;result:TaskResult}>('SELECT result_sha256,result FROM hima.results WHERE effect_id=$1',[result.identity.effectId])).rows[0];
      if (held) { if (held.result_sha256 !== digest) mismatch('Result'); return held.result; }
      if((run.opening.data as {source?:{kind?:string;taskId?:string}}).source?.kind==='team') {
        const taskId=(run.opening.data as {source:{taskId:string}}).source.taskId;
        const handoff=(await client.query('SELECT 1 FROM hima.team_definition_handoffs WHERE previous_run_id=$1',[run.runId])).rowCount;
        if(handoff&&(await client.query<{task:TeamTaskView}>('SELECT task FROM hima.team_tasks WHERE task_id=$1 FOR SHARE',[taskId])).rows[0]?.task.currentRunId!==run.runId)throw new FlowEffectNotCurrent('Original Team delivery lost its stable-task currentRun handoff race.');
      }
      const continuation=(await client.query<{root_effect_id:string;continuation:TeamEffectContinuation}>('SELECT root_effect_id,continuation FROM hima.team_effect_continuations WHERE successor_effect_id=$1',[result.identity.effectId])).rows[0];
      const root=continuation?.root_effect_id??result.identity.effectId;
      const delegated=(await client.query<{delegation_id:string;child_identity:TaskIdentity|null}>('SELECT delegation_id,child_identity FROM hima.team_delegations WHERE run_id=$1 AND root_effect_id=$2',[run.runId,root])).rows;
      if(delegated.length) {
        await this.#assertFlowEffectCurrent(client,run,result.identity.effectId);
        const logical=(await client.query<{invocation:FlowInvocationRecord}>('SELECT invocation FROM hima.flow_invocations WHERE effect_id=$1',[root])).rows[0]!.invocation.identity;
        if((await this.teamHead(client,logical)).invocation.identity.effectId!==result.identity.effectId)throw new Error('A superseded parent cannot hide accepted delegated work');
        for(const child of delegated) {
          if(!child.child_identity||(await this.delegationGate(client,run.runId,child.delegation_id,'result')).state!=='ready')throw new Error('Required accepted child is unfinished or its current authority is unproved');
          await this.#assertFlowEffectCurrent(client,run,child.child_identity.effectId);
          const closed=await this.teamCommittedDelivery(client,child.child_identity);
          if(!closed)throw new Error('Required accepted child has no committed result and exact physical closure');
          const receipt=(await client.query(`SELECT 1 FROM hima.team_effect_continuations c JOIN hima.effect_facts f ON f.effect_id=c.successor_effect_id AND f.phase='team-result-input-receipt:'||c.continuation_id WHERE c.run_id=$1 AND c.root_effect_id=$2 AND c.continuation->'inputs' @> $3::jsonb`,[run.runId,root,JSON.stringify([{delegationId:child.delegation_id,childEffectId:child.child_identity.effectId}])])).rowCount;
          if(!receipt)throw new Error('Required accepted child has no actual received Host result input in the parent continuation');
        }
      }
      await client.query('INSERT INTO hima.results VALUES($1,$2,$3,$4,$5)',[result.identity.effectId,result.identity.runId,result.identity.inputSha256,digest,JSON.stringify(result)]);
      await this.#emit(client,run.runId,factIdentity('task-result',result.identity.effectId),'task-result',result as unknown as JsonValue);
      return result;
    },'hima.commitResult');
  }
  async result(effectId:string): Promise<TaskResult|undefined> { return (await this.#pool.query<{result:TaskResult}>('SELECT result FROM hima.results WHERE effect_id=$1',[effectId])).rows[0]?.result; }
  /** Read freshness includes retained facts whose history projection was already acknowledged. */
  async sourceRevision(runId:string):Promise<number> {
    const {rows}=await this.#pool.query<{revision:string}>('SELECT COALESCE(MAX(seq),0) AS revision FROM hima.outbox WHERE run_id=$1',[runId]);
    return Number(rows[0]!.revision);
  }
  async latestControlFact(runId:string):Promise<{command:DurableCommand;factId:string}|undefined> {
    return (await this.#pool.query<{command:DurableCommand;factId:string}>(`SELECT payload AS command,fact_id AS "factId" FROM hima.outbox WHERE run_id=$1 AND kind='control' ORDER BY seq DESC LIMIT 1`,[runId])).rows[0];
  }
  async branchControls(runId:string):Promise<Array<{branches:FlowBranch[];hold:string|null;cancelled:boolean;holdSource:'human'|'agent'|'unknown'|null}>> {
    return (await this.#pool.query<{branches:FlowBranch[];hold:string|null;cancelled:boolean;holdSource:'human'|'agent'|'unknown'|null}>('SELECT branches,hold,cancelled,hold_source AS "holdSource" FROM hima.flow_branch_controls WHERE run_id=$1 ORDER BY scope_digest',[runId])).rows;
  }
  async pendingFactCount(runId:string):Promise<number> {return Number((await this.#pool.query<{count:string}>('SELECT count(*) AS count FROM hima.outbox WHERE run_id=$1 AND acknowledged_at IS NULL',[runId])).rows[0]!.count);}
  async pendingFacts(runId?:string): Promise<DurableFact[]> {
    return (await this.#pool.query<DurableFact>(`SELECT fact_id AS "factId",run_id AS "runId",seq,kind,payload,at FROM hima.outbox WHERE acknowledged_at IS NULL ${runId ? 'AND run_id=$1' : ''} ORDER BY run_id,seq`,runId ? [runId] : [])).rows.map(row=>({...row,at:new Date(row.at).toISOString()}));
  }
  async acknowledgeFact(factId:string): Promise<void> { await this.#pool.query('UPDATE hima.outbox SET acknowledged_at=clock_timestamp() WHERE fact_id=$1 AND acknowledged_at IS NULL',[factId]); }
  async projectFacts(project: (fact:DurableFact) => Promise<void>, runId?:string): Promise<number> {
    let count=0;
    for(const fact of await this.pendingFacts(runId)) { await project(fact); await this.acknowledgeFact(fact.factId); count++; }
    return count;
  }
}
