import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import type { ClientBase } from 'pg';
import { NodePostgresDataSource } from '@dbos-inc/node-pg-datasource';
import type { LocalDatabaseConnection } from './local-database.js';
import { taskIdentity, taskJsonValue, taskResult, taskToolOutput, validateTaskInput, createTaskResult } from './task-contract.js';
import type { JsonValue, TaskIdentity, TaskResult } from './task-contract.js';
import { flowTaskBranches, flowRevisionConsumers, flowTaskCountsExperiment, flowInvocationKey, flowInvocationRevision, flowRevisionApplies, flowExtensionKey, type CompiledFlow, type FlowBranch, type FrozenFlowFragment, type FlowRevisionRule, type FlowInvocationPath, type FlowExtensionScope } from './flow-definition.js';
import type { ResearchWriteAdmission, ResearchWriteRequest } from './budget.js';
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
  readonly response?: { readonly effectId: string; readonly output: import('./task-contract.js').TaskToolOutput };
}
export interface FlowInvocationRecord {
  readonly identity: TaskIdentity; readonly version: number; readonly branches: readonly FlowBranch[];
  /** Frozen interpreter context needed to reconnect original resources, never scheduling state. */
  readonly context: JsonValue; readonly consumedEffects: readonly string[]; readonly consumedVersions: readonly number[];
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
const countedInvocation = `(CASE WHEN i.invocation->'context'->'flow'->'tasks'->i.task_id->>'tool'='builtin/human-wait' THEN false
  WHEN i.invocation->'context'->'flow'->>'source'='legacy' THEN COALESCE(i.invocation->'context'->'flow'->'tasks'->i.task_id->'legacy'->>'kind'='act',false)
  ELSE COALESCE(i.invocation->'context'->'flow'->'tasks'->i.task_id->>'budget'<>'closing',true) END)`;
const runColumns = `engine, schema_version AS "schemaVersion", run_id AS "runId", input_sha256 AS "inputSha256", application_version AS "applicationVersion", opening,
 owner, deadline_at AS "deadlineAt", epoch, revision, hold, cancelled,hold_source AS "holdSource"`;
function readRun(row: DurableRun): DurableRun { return { ...row, deadlineAt: new Date(row.deadlineAt).toISOString(),holdSource:row.holdSource??(row.hold?'unknown':null) }; }

export function branchContains(parent:readonly FlowBranch[],child:readonly FlowBranch[]):boolean { return parent.length<=child.length && parent.every((branch,index)=>branch.parallelId===child[index]?.parallelId&&branch.branch===child[index]?.branch); }

function invocationPath(record:FlowInvocationRecord):FlowInvocationPath { const context=record.context as unknown as {flow:CompiledFlow;taskId:string;iterations:FlowInvocationPath['iterations'];branches:FlowBranch[];extensions:FlowExtensionScope[]};return {flowSha256:context.flow.irSha256,taskId:context.taskId,iterations:context.iterations,branches:context.branches,extensions:context.extensions??[]}; }

export class RunStore {
  readonly #pool: Pool;
  readonly #source: NodePostgresDataSource;
  constructor(connection: LocalDatabaseConnection, source: NodePostgresDataSource, readonly applicationVersion: string) {
    this.#pool = new Pool({ ...connection, connectionTimeoutMillis: 2000, statement_timeout: 5000 });
    this.#pool.on('error', () => { /* Idle socket failures are surfaced by the next authoritative query. */ });
    this.#source = source;
  }
  async initialize(): Promise<void> { await migrateRunStore(this.#pool); }
  async close(): Promise<void> { await this.#pool.end(); }
  async transaction<T>(body: (client: ClientBase) => Promise<T>, name: string): Promise<T> {
    return this.#source.runTransaction(() => body(this.#source.client), { name, isolationLevel: 'SERIALIZABLE' });
  }
  /** Host lock always precedes Run locks. App-exit stop admission uses the same boundary. */
  async #assertHostAdmission(client:ClientBase,admission?:EffectAdmission):Promise<boolean> {
    const row=(await client.query<{active_request:string|null;mode:string|null;accepted_at:string|null;finalizing:boolean}>(`SELECT h.active_request,h.finalizing,r.mode,r.accepted_at FROM hima.host_exit h LEFT JOIN hima.host_exit_requests r ON r.request_id=h.active_request WHERE h.singleton=true FOR SHARE OF h`)).rows[0];
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
  async #hostExitStopActive(client:ClientBase,requestId:string):Promise<boolean> {
    const row=(await client.query<{active_request:string|null;mode:string|null;finalizing:boolean}>(`SELECT h.active_request,h.finalizing,r.mode FROM hima.host_exit h LEFT JOIN hima.host_exit_requests r ON r.request_id=h.active_request WHERE h.singleton=true FOR SHARE OF h`)).rows[0];
    return row?.active_request===requestId&&row.mode==='stop-jobs'&&!row.finalizing;
  }
  async hostExit():Promise<import('./host-exit.js').HostExitRequest|undefined> {
    const row=(await this.#pool.query<{requestId:string;mode:import('./host-exit.js').HostExitMode}>(`SELECT r.request_id AS "requestId",r.mode FROM hima.host_exit h JOIN hima.host_exit_requests r ON r.request_id=h.active_request WHERE h.singleton=true`)).rows[0];
    return row;
  }
  async lastHostExitRequestId():Promise<string|undefined> {
    return (await this.#pool.query<{request_id:string}>('SELECT request_id FROM hima.host_exit_requests ORDER BY accepted_at DESC LIMIT 1')).rows[0]?.request_id;
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
  async command(command: DurableCommand): Promise<DurableRun> {
    assertName(command.commandId);
    if(command.origin!==undefined&&!['human','agent'].includes(command.origin))throw new Error('Control origin must be supplied by the Host as human or agent');
    const origin=command.origin??'agent';
    const digest = jsonDigest(command);
    return this.transaction(async client => {
      const run = await this.#run(client, command.runId, true);
      const previous = (await client.query<{digest:string;receipt:DurableRun}>('SELECT digest,receipt FROM hima.commands WHERE run_id=$1 AND command_id=$2',[command.runId,command.commandId])).rows[0];
      if (previous) { if (previous.digest !== digest) mismatch('Command'); return readRun(previous.receipt); }
      if (command.owner !== run.owner || command.epoch !== run.epoch || command.revision !== run.revision) throw new Error('Control owner/epoch/revision is stale; refresh this Run');
      if (run.cancelled) throw new Error('Cancelled Run cannot be resumed');
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
      if(resources.some(resource=>resource.leaseExists&&!resource.releasedAt||resource.dispatched&&(!resource.leaseExists||!resource.releasedAt||resource.proof===null)))throw new Error('Original resource closure is unproved; retain the original effect and physical proof');
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
      await this.#run(client,invocation.identity.runId,true);
      await client.query('INSERT INTO hima.flow_invocations VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',[
        invocation.identity.effectId,invocation.identity.runId,invocation.identity.taskId,invocation.version,JSON.stringify(invocation.branches),JSON.stringify(invocation)]);
      const held=(await client.query<{invocation:FlowInvocationRecord}>('SELECT invocation FROM hima.flow_invocations WHERE effect_id=$1',[invocation.identity.effectId])).rows[0]!.invocation;
      if(jsonDigest([held.identity,held.version,held.branches,held.consumedEffects,held.consumedVersions])!==jsonDigest([invocation.identity,invocation.version,invocation.branches,invocation.consumedEffects,invocation.consumedVersions]))mismatch('Flow invocation');
      return held;
    },'hima.flowInvocation');
  }
  async flowInvocations(runId:string):Promise<FlowInvocationRecord[]> {
    return this.transaction(async client=>(await client.query<{invocation:FlowInvocationRecord}>('SELECT invocation FROM hima.flow_invocations WHERE run_id=$1 ORDER BY effect_id',[runId])).rows.map(row=>row.invocation),'hima.flowInvocations');
  }
  /** Raw native authority inheritance, usable inside external callbacks. No name-prefix trust,
   * fresh budget, workflow scheduling or independent child control authority is created. */
  async bindDerivedEffect(parent:TaskIdentity,child:TaskIdentity,options:{readonly purpose:'business'|'collect'}={purpose:'business'}):Promise<void> {
    taskIdentity.parse(parent);taskIdentity.parse(child);
    if(!['business','collect'].includes(options.purpose))throw new Error('Derived effect needs its immutable business or collection purpose');
    if(parent.runId!==child.runId||parent.applicationVersion!==child.applicationVersion||parent.packSha256!==child.packSha256||parent.irSha256!==child.irSha256||parent.effectId===child.effectId)throw new Error('Derived effect must retain its original parent Run/method/version');
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
      FROM hima.flow_invocations i JOIN ancestry a USING(effect_id) WHERE i.run_id=$2`,[effectId,runId])).rows[0];
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
  async #assertFlowEffectCurrent(client:ClientBase,run:DurableRun,effectId:string):Promise<void> {
    const invocation=await this.#flowMembership(client,run.runId,effectId);
    if(!invocation)return;
    const rules=await this.#revisionRules(client,run.runId);
    const revision=flowInvocationRevision(rules,invocation.scope,invocation.consumedVersions).version;
    if(revision!==invocation.version)throw new Error('Task invocation was superseded by revision; retain its original effects and results');
    for(const rule of rules)if(invocation.version>=rule.revision&&flowRevisionApplies(rule,invocation.scope,invocation.consumedVersions)) {
      const held=(await client.query(`WITH RECURSIVE original(effect_id) AS (
        SELECT unnest($1::text[]) UNION SELECT d.child_effect_id FROM hima.flow_derived_effects d JOIN original o ON d.parent_effect_id=o.effect_id WHERE d.run_id=$2)
        SELECT o.effect_id FROM original o JOIN hima.effect_leases l USING(effect_id) WHERE l.released_at IS NULL LIMIT 1`,[[...rule.invalidatedEffects],run.runId])).rows[0];
      if(held)throw new Error('Revision replacement is waiting for confirmed closure of its original affected task tree');
    }
    for(const scope of invocation.scope.extensions??[])if((await client.query('SELECT 1 FROM hima.flow_facts WHERE run_id=$1 AND name=$2',[run.runId,`extension-disposition:${flowExtensionKey(scope)}`])).rowCount)throw new Error('Original optional extension is stopped; no new business effects');
    const controls=(await client.query<{branches:FlowBranch[];hold:string|null;cancelled:boolean}>('SELECT branches,hold,cancelled,hold_source AS "holdSource" FROM hima.flow_branch_controls WHERE run_id=$1',[run.runId])).rows;
    if(controls.some(control=>(control.cancelled||(control.hold&&invocation.purpose!=='collect'))&&branchContains(control.branches,invocation.branches)))throw new Error('Effect admission blocked by current branch control');
    const data=run.opening.data as {budget?:{closingReserveMs?:number;attemptLimit?:number}};
    if(invocation.experiment&&invocation.purpose!=='collect'&&Date.now()>=Date.parse(run.deadlineAt)-(data.budget?.closingReserveMs??0))throw new Error('Original Run is closing; no new business effects');
    if(invocation.purpose==='collect'&&!(await client.query("SELECT 1 FROM hima.flow_derived_effects d JOIN hima.effect_dispatches p ON p.effect_id=d.parent_effect_id WHERE d.child_effect_id=$1 AND p.dispatch_id='submit'",[effectId])).rowCount)throw new Error('Collection must consume an already admitted original parent');
    if(invocation.experiment&&data.budget?.attemptLimit!==undefined) {
      const allocated=(await client.query("SELECT 1 FROM hima.effect_dispatches WHERE effect_id=$1 AND dispatch_id='submit'",[invocation.effect_id])).rowCount;
      const count=Number((await client.query<{count:string}>(`SELECT count(*) FROM hima.effect_dispatches d JOIN hima.flow_invocations i USING(effect_id) WHERE i.run_id=$1 AND d.dispatch_id='submit' AND ${countedInvocation}`,[run.runId])).rows[0]!.count);
      if(!allocated&&count>=data.budget.attemptLimit)throw new Error('Original Run attempt budget reached; no fresh child allocation');
    }
  }
  async #readFlowAuthority(client:Pick<ClientBase,'query'>,runId:string,lock:boolean) {
      const run=await this.#run(client,runId,lock);
      const revisionRules=await this.#revisionRules(client,runId);
      const branches=(await client.query<{branches:FlowBranch[];hold:string|null;cancelled:boolean}>('SELECT branches,hold,cancelled,hold_source AS "holdSource" FROM hima.flow_branch_controls WHERE run_id=$1 ORDER BY scope_digest',[runId])).rows;
      const submitted=(await client.query<{effect_id:string;experiment:boolean}>(`SELECT d.effect_id,${countedInvocation} AS experiment FROM hima.effect_dispatches d JOIN hima.flow_invocations i USING(effect_id) WHERE i.run_id=$1 AND d.dispatch_id='submit' ORDER BY d.effect_id`,[runId])).rows;
      const dispatchedEffects=submitted.filter(row=>row.experiment).map(row=>row.effect_id),submittedEffects=submitted.map(row=>row.effect_id);
      const hostExit=(await client.query<import('./host-exit.js').HostExitRequest>(`SELECT r.request_id AS "requestId",r.mode FROM hima.host_exit h JOIN hima.host_exit_requests r ON r.request_id=h.active_request WHERE h.singleton=true`)).rows[0]??null;
      const extensions=(await client.query<{name:string;value:JsonValue}>("SELECT name,value FROM hima.flow_facts WHERE run_id=$1 AND name LIKE 'extension-disposition:%' ORDER BY name",[runId])).rows;
      return {run,at:Date.now(),dispatchedEffects,submittedEffects,hostExit,revisionRules,branches,extensionDispositions:Object.fromEntries(extensions.map(row=>[row.name.slice('extension-disposition:'.length),row.value]))};
  }
  async flowAuthority(runId:string):Promise<{run:DurableRun;at:number;dispatchedEffects:string[];submittedEffects:string[];hostExit:import('./host-exit.js').HostExitRequest|null;revisionRules:FlowRevisionRule[];extensionDispositions:Record<string,JsonValue>;branches:Array<{branches:FlowBranch[];hold:string|null;cancelled:boolean}>}> {
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
      const rows=(await this.#orderedExternalEffectFacts(client,identity,'')).map(row=>[row.phase,row.fact] as const);
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
  async #assertBusinessEffectOpen(client:ClientBase,runId:string,effectId:string):Promise<void> {
    await this.#assertFlowEffectCurrent(client,await this.#run(client,runId),effectId);
    const closedParent=(await client.query(`WITH RECURSIVE ancestry(effect_id) AS (
      SELECT parent_effect_id FROM hima.flow_derived_effects WHERE child_effect_id=$1 AND run_id=$2
      UNION SELECT d.parent_effect_id FROM hima.flow_derived_effects d JOIN ancestry a ON d.child_effect_id=a.effect_id WHERE d.run_id=$2)
      SELECT 1 FROM ancestry a WHERE EXISTS(SELECT 1 FROM hima.results r WHERE r.effect_id=a.effect_id)
      OR EXISTS(SELECT 1 FROM hima.effect_facts f WHERE f.effect_id=a.effect_id AND f.phase='terminal-failure')
      OR (EXISTS(SELECT 1 FROM hima.host_exit WHERE singleton=true AND active_request IS NOT NULL)
        AND EXISTS(SELECT 1 FROM hima.effect_facts f WHERE f.effect_id=a.effect_id AND f.phase='validated-result'))
      OR (COALESCE((SELECT purpose FROM hima.flow_derived_effects WHERE child_effect_id=$1),'business')<>'collect'
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
      const data=run.opening.data;
      const budget=data!==null&&!Array.isArray(data)&&typeof data==='object'&&data.budget!==null&&!Array.isArray(data.budget)&&typeof data.budget==='object'?data.budget:{};
      const limitWriteAttempts=budget.researchWriteAttempts??256,limitBytes=budget.researchWriteBytes??4*1024*1024;
      if(typeof limitWriteAttempts!=='number'||typeof limitBytes!=='number'||!Number.isSafeInteger(limitWriteAttempts)||limitWriteAttempts<1||!Number.isSafeInteger(limitBytes)||limitBytes<1)throw new Error('Frozen Campaign research-write limits are invalid; restore its original validated budget');
      const held=(await client.query<{fact:{request:{requestedBytes:number}}}>(`SELECT f.fact FROM hima.effect_facts f JOIN hima.effects e USING(effect_id)
        WHERE e.run_id=$1 AND left(f.phase,length('native:research-write:'))='native:research-write:'`,[identity.runId])).rows;
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
  /** Native Code/Knowledge reconstruction uses the application outbox's actual fact order.
   * call IDs name immutable writes; neither a session-local counter nor phase lexical order is
   * an ordering authority. Acknowledged projection rows remain authoritative and readable. */
  async orderedExternalEffectFacts(identity:TaskIdentity,prefix=''):Promise<readonly {phase:string;fact:JsonValue;seq:number}[]> {
    taskIdentity.parse(identity);
    const effect=await this.effect(identity.effectId);
    if(!effect||jsonDigest(effect.identity)!==jsonDigest(identity))mismatch('Native receipt effect');
    return this.#orderedExternalEffectFacts(this.#pool,identity,prefix);
  }
  async #orderedExternalEffectFacts(client:Pick<ClientBase,'query'>,identity:TaskIdentity,prefix:string):Promise<readonly {phase:string;fact:JsonValue;seq:number}[]> {
    const namespace=`native:${prefix}`;
    const rows=(await client.query<{phase:string;fact:JsonValue;seq:number}>(`SELECT f.phase,f.fact,o.seq
      FROM hima.effect_facts f JOIN hima.outbox o ON o.kind='effect-fact'
        AND o.payload->'identity'->>'effectId'=f.effect_id AND o.payload->>'phase'=f.phase
      WHERE f.effect_id=$1 AND left(f.phase,length($2))=$2 AND o.run_id=$3 ORDER BY o.seq`,[identity.effectId,namespace,identity.runId])).rows;
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
  /** A workflow branches only from this datasource-receipted snapshot. Uncached reads are for
   * effect admission/UI, never for skipping operations in a replayed workflow invocation. */
  async effectSnapshot(identity:TaskIdentity):Promise<{facts:Record<string,JsonValue>;result:TaskResult|null;resourcesReleased:boolean}> {
    return this.transaction(async client=>{
      const effect=(await client.query<{identity:TaskIdentity}>('SELECT identity FROM hima.effects WHERE effect_id=$1',[identity.effectId])).rows[0];
      if(!effect||jsonDigest(effect.identity)!==jsonDigest(identity))mismatch('Snapshot effect');
      const facts=(await client.query<{phase:string;fact:JsonValue}>('SELECT phase,fact FROM hima.effect_facts WHERE effect_id=$1',[identity.effectId])).rows;
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
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`hima-site:${claim.siteId}`]);
      const run=await this.#run(client,identity.runId,true);
      if(run.applicationVersion!==this.applicationVersion||identity.applicationVersion!==run.applicationVersion)throw new Error('Resource effect version differs from frozen Run');
      const effect=(await client.query<{identity:TaskIdentity}>('SELECT identity FROM hima.effects WHERE effect_id=$1',[identity.effectId])).rows[0];
      if(!effect || jsonDigest(effect.identity)!==jsonDigest(identity)) mismatch('Resource effect');
      const existing=(await client.query<{claim:EffectResourceClaim;released_at:string|null}>('SELECT claim,released_at FROM hima.effect_leases WHERE effect_id=$1',[identity.effectId])).rows[0];
      if(existing) { if(jsonDigest(existing.claim as unknown as JsonValue)!==jsonDigest(claim as unknown as JsonValue)) mismatch('Resource claim'); return existing.released_at===null; }
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
  async claimEffectCleanup(identity:TaskIdentity,permit:()=>Promise<boolean>,dispatchId:string,inputSha256:string,exitRequestId?:string):Promise<boolean> {
    assertName(dispatchId);
    const client=await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const stopActive=exitRequestId===undefined||await this.#hostExitStopActive(client,exitRequestId);
      const run=await this.#run(client,identity.runId,true);
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
      const held = (await client.query<{result_sha256:string;result:TaskResult}>('SELECT result_sha256,result FROM hima.results WHERE effect_id=$1',[result.identity.effectId])).rows[0];
      if (held) { if (held.result_sha256 !== digest) mismatch('Result'); return held.result; }
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
