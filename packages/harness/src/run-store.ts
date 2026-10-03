import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import type { ClientBase } from 'pg';
import { NodePostgresDataSource } from '@dbos-inc/node-pg-datasource';
import type { LocalDatabaseConnection } from './local-database.js';
import { taskIdentity, taskJsonValue, taskResult } from './task-contract.js';
import type { JsonValue, TaskIdentity, TaskResult } from './task-contract.js';
import type { ResearchWriteAdmission, ResearchWriteRequest } from './budget.js';
import { migrateRunStore } from './run-store-migrations.js';

function canonical(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key]!)}`).join(',')}}`;
  return JSON.stringify(value);
}
export function jsonDigest(value: unknown): string { return createHash('sha256').update(canonical(taskJsonValue.parse(value))).digest('hex'); }
// Fact namespaces and arbitrary accepted IDs occupy distinct tuple fields, never delimiters.
function factIdentity(kind: string, ...ids: string[]): string { return `hima-fact:${jsonDigest([kind, ...ids])}`; }
export interface DurableRunOpening {
  readonly runId: string; readonly inputSha256: string; readonly applicationVersion: string;
  readonly owner: string; readonly deadlineAt: string; readonly data: JsonValue;
}
export interface DurableRun {
  engine: 'dbos/5.2.11'; schemaVersion: 1; runId: string; inputSha256: string; applicationVersion: string; opening: DurableRunOpening;
  owner: string; deadlineAt: string; epoch: number; revision: number; hold: string | null; cancelled: boolean;
}
export interface DurableFact { factId: string; runId: string; seq: number; kind: string; payload: JsonValue; at: string }
export interface DurableCommand {
  readonly runId: string; readonly commandId: string; readonly action: 'pause' | 'continue' | 'cancel' | 'handoff';
  readonly owner: string; readonly epoch: number; readonly revision: number; readonly nextOwner?: string;
}
export interface EffectAdmission {
  readonly runId: string; readonly effectId: string; readonly owner: string; readonly epoch: number; readonly revision: number;
}
export interface EffectResourceClaim {
  readonly siteId: string; readonly jobs: number; readonly licences: Readonly<Record<string, number>>;
}
export type ExternalResearchWriteRequest = ResearchWriteRequest & {readonly callId:string;readonly contentSha256:string};
function mismatch(kind: string): never { throw new Error(`${kind} identity was reused with different input; retain the original identity or start a new invocation`); }
function assertName(name: string): void { if (!name.trim()) throw new Error('A stable nonempty identity is required'); }
const declaredAmount=(amounts:Readonly<Record<string,number>>,name:string)=>Object.hasOwn(amounts,name)?amounts[name]!:0;
const runColumns = `engine, schema_version AS "schemaVersion", run_id AS "runId", input_sha256 AS "inputSha256", application_version AS "applicationVersion", opening,
 owner, deadline_at AS "deadlineAt", epoch, revision, hold, cancelled`;
function readRun(row: DurableRun): DurableRun { return { ...row, deadlineAt: new Date(row.deadlineAt).toISOString() }; }

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
  async #run(client: Pick<ClientBase, 'query'>, runId: string, lock = false): Promise<DurableRun> {
    const { rows } = await client.query<DurableRun>(`SELECT ${runColumns} FROM hima.runs WHERE run_id=$1 ${lock ? 'FOR UPDATE' : ''}`, [runId]);
    if (!rows[0]) throw new Error(`Unknown DBOS Run ${runId}`);
    return readRun(rows[0]);
  }
  async run(runId: string): Promise<DurableRun> { return this.#run(this.#pool, runId); }
  async runs(): Promise<DurableRun[]> { return (await this.#pool.query<DurableRun>(`SELECT ${runColumns} FROM hima.runs ORDER BY created_at,run_id`)).rows.map(readRun); }
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
    const digest = jsonDigest(command);
    return this.transaction(async client => {
      const run = await this.#run(client, command.runId, true);
      const previous = (await client.query<{digest:string;receipt:DurableRun}>('SELECT digest,receipt FROM hima.commands WHERE run_id=$1 AND command_id=$2',[command.runId,command.commandId])).rows[0];
      if (previous) { if (previous.digest !== digest) mismatch('Command'); return readRun(previous.receipt); }
      if (command.owner !== run.owner || command.epoch !== run.epoch || command.revision !== run.revision) throw new Error('Control owner/epoch/revision is stale; refresh this Run');
      if (run.cancelled) throw new Error('Cancelled Run cannot be resumed');
      if (command.action === 'handoff' && !command.nextOwner?.trim()) throw new Error('Handoff needs the next owner');
      await client.query(`UPDATE hima.runs SET epoch=epoch+1, hold=$2, cancelled=$3,owner=$4 WHERE run_id=$1`,[run.runId,command.action === 'continue' ? null : command.action,command.action === 'cancel',command.action === 'handoff' ? command.nextOwner : run.owner]);
      const receipt = await this.#run(client,run.runId);
      await client.query('INSERT INTO hima.commands VALUES($1,$2,$3,$4,$5)',[run.runId,command.commandId,digest,JSON.stringify(command),JSON.stringify(receipt)]);
      await this.#emit(client,run.runId,factIdentity('control',run.runId,command.commandId),'control',command as unknown as JsonValue);
      return receipt;
    },'hima.control');
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
  async externalEffectTransaction<T>(identity:TaskIdentity,options:{readonly admission?:EffectAdmission;readonly permit:()=>Promise<boolean>},
    body:(run:DurableRun,facts:Readonly<Record<string,JsonValue>>,record:(phase:string,fact:JsonValue)=>Promise<void>)=>Promise<T>):Promise<T> {
    taskIdentity.parse(identity);
    return this.#externalTransaction(async client=>{
      const run=await this.#run(client,identity.runId,true);
      const effect=(await client.query<{identity:TaskIdentity}>('SELECT identity FROM hima.effects WHERE effect_id=$1',[identity.effectId])).rows[0];
      if(run.applicationVersion!==this.applicationVersion||!effect||jsonDigest(effect.identity)!==jsonDigest(identity))mismatch('External callback effect');
      const admission=options.admission;
      if(admission) {
        if(admission.runId!==identity.runId||admission.effectId!==identity.effectId)throw new Error('Native callback admission belongs to another effect');
        if(run.cancelled||run.hold||run.owner!==admission.owner||run.epoch!==admission.epoch||run.revision!==admission.revision||Date.parse(run.deadlineAt)<=Date.now())throw new Error('Effect admission blocked by current owner, hold, deadline or version; refresh Run authority');
        await this.#assertBusinessEffectOpen(client,identity.runId,identity.effectId);
      }
      if(!await options.permit())throw new Error('Native callback is blocked by current Site Permit');
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
      const run = await this.#run(client,admission.runId,true);
      if (run.applicationVersion !== this.applicationVersion || run.cancelled || run.hold || run.owner !== admission.owner || run.epoch !== admission.epoch || run.revision !== admission.revision || Date.parse(run.deadlineAt) <= Date.now()) throw new Error('Effect admission blocked by current owner, hold, deadline or version; refresh Run authority');
      await this.#assertBusinessEffectOpen(client,admission.runId,admission.effectId);
      if (!await permit()) throw new Error('Effect admission blocked by current Site Permit');
      await client.query("UPDATE hima.effects SET phase='admitted' WHERE effect_id=$1 AND phase='intent'",[admission.effectId]);
      await client.query('COMMIT');
      return run;
    } catch(error) { await client.query('ROLLBACK').catch(() => undefined); throw error; }
    finally { client.release(); }
  }
  async #assertBusinessEffectOpen(client:ClientBase,runId:string,effectId:string):Promise<void> {
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
      const held=(await client.query<{identity:TaskIdentity;proof:JsonValue|null;released_at:string|null}>('SELECT e.identity,l.proof,l.released_at FROM hima.effect_leases l JOIN hima.effects e USING(effect_id) WHERE effect_id=$1 FOR UPDATE OF l',[identity.effectId])).rows[0];
      if(!held || jsonDigest(held.identity)!==jsonDigest(identity)) mismatch('Release effect');
      if(held.released_at) { if(jsonDigest(held.proof)!==jsonDigest(proof)) mismatch('Release proof'); return; }
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
      const run=await this.#run(client,admission.runId,true);
      if(run.applicationVersion!==this.applicationVersion || run.cancelled || run.hold || run.owner!==admission.owner || run.epoch!==admission.epoch || run.revision!==admission.revision || Date.parse(run.deadlineAt)<=Date.now()) throw new Error('Effect admission blocked by current owner, hold, deadline or version; refresh Run authority');
      await this.#assertBusinessEffectOpen(client,admission.runId,admission.effectId);
      const previous=(await client.query<{input_sha256:string}>('SELECT input_sha256 FROM hima.effect_dispatches WHERE effect_id=$1 AND dispatch_id=$2',[admission.effectId,dispatchId])).rows[0];
      if(previous) { if(previous.input_sha256!==inputSha256) mismatch('Dispatch'); await client.query('COMMIT'); return false; }
      if(!await permit()) throw new Error('Effect admission blocked by current Site Permit');
      await client.query('INSERT INTO hima.effect_dispatches(effect_id,dispatch_id,input_sha256) VALUES($1,$2,$3)',[admission.effectId,dispatchId,inputSha256]);
      await client.query("UPDATE hima.effects SET phase='admitted' WHERE effect_id=$1 AND phase='intent'",[admission.effectId]);
      await client.query('COMMIT'); return true;
    } catch(error) {await client.query('ROLLBACK').catch(()=>undefined);throw error;}
    finally {client.release();}
  }
  /** Cleanup targets the original owned resource and may proceed under pause/cancel/handoff.
   * This permission can never submit new business work or repeat a native prompt. */
  async claimEffectCleanup(identity:TaskIdentity,permit:()=>Promise<boolean>,dispatchId:string,inputSha256:string):Promise<boolean> {
    assertName(dispatchId);
    const client=await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const run=await this.#run(client,identity.runId,true);
      const effect=(await client.query<{identity:TaskIdentity}>('SELECT identity FROM hima.effects WHERE effect_id=$1',[identity.effectId])).rows[0];
      if(run.applicationVersion!==this.applicationVersion||!effect||jsonDigest(effect.identity)!==jsonDigest(identity)) mismatch('Cleanup effect');
      const previous=(await client.query<{input_sha256:string}>('SELECT input_sha256 FROM hima.effect_dispatches WHERE effect_id=$1 AND dispatch_id=$2',[identity.effectId,dispatchId])).rows[0];
      if(previous) {if(previous.input_sha256!==inputSha256)mismatch('Cleanup dispatch');await client.query('COMMIT');return false;}
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
