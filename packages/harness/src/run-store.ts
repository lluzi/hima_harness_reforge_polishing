import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import type { ClientBase } from 'pg';
import { NodePostgresDataSource } from '@dbos-inc/node-pg-datasource';
import type { LocalDatabaseConnection } from './local-database.js';
import { taskIdentity, taskJsonValue, taskResult } from './task-contract.js';
import type { JsonValue, TaskIdentity, TaskResult } from './task-contract.js';
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
function mismatch(kind: string): never { throw new Error(`${kind} identity was reused with different input; retain the original identity or start a new invocation`); }
function assertName(name: string): void { if (!name.trim()) throw new Error('A stable nonempty identity is required'); }
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
    await this.transaction(async client => {
      const run = await this.#run(client,identity.runId,true);
      if (identity.applicationVersion !== run.applicationVersion) throw new Error('Effect executable version differs from frozen Run');
      await client.query('INSERT INTO hima.effects(effect_id,run_id,input_sha256,identity,intent) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING', [identity.effectId,identity.runId,identity.inputSha256,JSON.stringify(identity),JSON.stringify(intent)]);
      const effect = (await client.query<{identity:TaskIdentity;intent:JsonValue}>('SELECT identity,intent FROM hima.effects WHERE effect_id=$1',[identity.effectId])).rows[0]!;
      if (jsonDigest(effect.identity) !== jsonDigest(identity) || jsonDigest(effect.intent) !== jsonDigest(intent)) mismatch('Effect');
    },'hima.prepareEffect');
  }
  /** Uncached and outside DBOS operations. Call immediately inside the actual adapter callback;
   * replay of an earlier transaction/step must never grant permission to submit again. */
  async assertEffectAdmission(admission: EffectAdmission, permit: () => Promise<boolean>): Promise<DurableRun> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const run = await this.#run(client,admission.runId,true);
      if (run.applicationVersion !== this.applicationVersion || run.cancelled || run.hold || run.owner !== admission.owner || run.epoch !== admission.epoch || run.revision !== admission.revision || Date.parse(run.deadlineAt) <= Date.now()) throw new Error('Effect admission blocked by current owner, hold, deadline or version; refresh Run authority');
      const effect = (await client.query('SELECT 1 FROM hima.effects WHERE effect_id=$1 AND run_id=$2',[admission.effectId,admission.runId])).rowCount;
      if (!effect) throw new Error('Effect intent must be retained before admission');
      if (!await permit()) throw new Error('Effect admission blocked by current Site Permit');
      await client.query("UPDATE hima.effects SET phase='admitted' WHERE effect_id=$1 AND phase='intent'",[admission.effectId]);
      await client.query('COMMIT');
      return run;
    } catch(error) { await client.query('ROLLBACK').catch(() => undefined); throw error; }
    finally { client.release(); }
  }
  async recordEffectFact(identity: TaskIdentity, phase: string, fact: JsonValue): Promise<void> {
    taskIdentity.parse(identity); taskJsonValue.parse(fact); assertName(phase);
    await this.transaction(async client => {
      const effect = (await client.query<{identity:TaskIdentity}>('SELECT identity FROM hima.effects WHERE effect_id=$1 FOR UPDATE',[identity.effectId])).rows[0];
      if (!effect || jsonDigest(effect.identity) !== jsonDigest(identity)) mismatch('Effect');
      const held=(await client.query<{fact:JsonValue}>('SELECT fact FROM hima.effect_facts WHERE effect_id=$1 AND phase=$2',[identity.effectId,phase])).rows[0];
      if(held) { if(jsonDigest(held.fact)!==jsonDigest(fact)) mismatch('Effect fact'); return; }
      await client.query('INSERT INTO hima.effect_facts VALUES($1,$2,$3)',[identity.effectId,phase,JSON.stringify(fact)]);
      await client.query('UPDATE hima.effects SET phase=$2,fact=$3 WHERE effect_id=$1',[identity.effectId,phase,JSON.stringify(fact)]);
      await this.#emit(client,identity.runId,factIdentity('effect-fact',identity.effectId,phase),'effect-fact',{identity,phase,fact} as unknown as JsonValue);
    },'hima.recordEffectFact');
  }
  async effect(effectId: string): Promise<{identity:TaskIdentity;intent:JsonValue;phase:string;fact:JsonValue|null}|undefined> {
    return (await this.#pool.query('SELECT identity,intent,phase,fact FROM hima.effects WHERE effect_id=$1',[effectId])).rows[0];
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
