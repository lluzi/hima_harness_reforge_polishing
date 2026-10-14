// The application-database transaction handler DBOS calls for RunStore. It keeps the pinned
// NodePostgres checkpoint table and replay contract (dbos.transaction_completion, SuperJSON), and
// outlasts a transient loss of the private PostgreSQL connection at the same step instead of
// recording that loss as the step's durable outcome.
import { AsyncLocalStorage } from 'node:async_hooks';
import { DBOS } from '@dbos-inc/dbos-sdk';
import { DBOSError, DBOSStepAlreadyRecordedError, DBOSWorkflowConflictError, assertStillOwnsWorkflow, isPGRetriableTransactionError,
  migrateDataSourcePG, registerDataSource, replayRecordedStep, runTransaction,
  type DataSourceTransactionHandler, type PGIsolationLevel } from '@dbos-inc/dbos-sdk/datasource';
import { Pool, type ClientBase, type PoolClient, type PoolConfig } from 'pg';
import { SuperJSON } from 'superjson';

export interface ApplicationTransactionConfig {
  readonly name?: string;
  readonly isolationLevel?: PGIsolationLevel;
  readonly readOnly?: boolean;
}
/** Workflow work pauses through an outage; a Host request answers within its shorter window. */
export interface ConnectionRetryPolicy {
  readonly workflowWindowMs: number;
  readonly requestWindowMs: number;
  readonly initialBackoffMs: number;
  readonly maxBackoffMs: number;
}
export const defaultConnectionRetry: ConnectionRetryPolicy = Object.freeze({ workflowWindowMs: 10 * 60_000, requestWindowMs: 10_000, initialBackoffMs: 100, maxBackoffMs: 5_000 });

const connectionErrnos = new Set(['ECONNRESET', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'ETIMEDOUT', 'ECONNABORTED', 'EPIPE']);
// SQLSTATE class 08 is connection exception; 57P01-03 are shutdown/cannot-connect-now; 53300 is too_many_connections.
const connectionStates = new Set(['57P01', '57P02', '57P03', '53300']);
const connectionMessages = [/connection terminated/i, /connection timeout/i, /timeout exceeded when trying to connect/i,
  /server closed the connection/i, /client has encountered a connection error/i, /could not connect to server/i, /the database system is (starting up|shutting down)/i];
/** The connection to PostgreSQL was lost or refused; the statement's own outcome says nothing about the business step. */
export function isTransientConnectionError(error: unknown): boolean {
  const queue: unknown[] = [error];
  for (let seen = 0; queue.length && seen < 20; seen++) {
    const current = queue.shift();
    if (!current || typeof current !== 'object') continue;
    const { code, message, cause, errors } = current as { code?: unknown; message?: unknown; cause?: unknown; errors?: unknown };
    if (typeof code === 'string' && (code.startsWith('08') || connectionStates.has(code) || connectionErrnos.has(code))) return true;
    if (typeof message === 'string' && connectionMessages.some(pattern => pattern.test(message))) return true;
    if (cause) queue.push(cause);
    if (Array.isArray(errors)) queue.push(...errors);
  }
  return false;
}
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Retry an operation that is safe to repeat while its failures are transient connection losses. */
export async function withConnectionRetry<T>(operation: () => Promise<T>, policy: ConnectionRetryPolicy = defaultConnectionRetry, stopped: () => boolean = () => false): Promise<T> {
  const window = DBOS.isWithinWorkflow() ? policy.workflowWindowMs : policy.requestWindowMs;
  const started = Date.now();
  for (let wait = policy.initialBackoffMs; ; wait = Math.min(wait * 2, policy.maxBackoffMs)) {
    try { return await operation(); }
    catch (error) {
      if (!isTransientConnectionError(error) || stopped() || Date.now() - started + wait > window) throw error;
      await sleep(wait);
    }
  }
}

const transactionContext = new AsyncLocalStorage<{ client: PoolClient; owner: ApplicationTransactionHandler }>();
interface RecordedStep { readonly output: string | null; readonly error: string | null }

class ApplicationTransactionHandler implements DataSourceTransactionHandler {
  #pool: Pool | undefined;
  #stopped = false;
  constructor(readonly name: string, readonly config: PoolConfig, readonly retry: ConnectionRetryPolicy, readonly schemaName = 'dbos') {}
  async initialize(): Promise<void> {
    const previous = this.#pool;
    this.#pool = new Pool(this.config);
    // Idle socket failures are surfaced by the next authoritative query.
    this.#pool.on('error', () => undefined);
    this.#stopped = false;
    await previous?.end();
    await this.#transaction(client => migrateDataSourcePG(async sql => (await client.query(sql)).rows, this.schemaName), {}, () => undefined);
  }
  async destroy(): Promise<void> {
    this.#stopped = true;
    const pool = this.#pool;
    this.#pool = undefined;
    await pool?.end();
  }
  get #connection(): Pool {
    if (!this.#pool) throw new Error(`DataSource ${this.name} is not initialized.`);
    return this.#pool;
  }
  async deleteCheckpoints(workflowID: string, startStep: number, beforeCommit?: () => Promise<void>): Promise<void> {
    await this.#transaction(async client => {
      await client.query(`DELETE FROM "${this.schemaName}".transaction_completion WHERE workflow_id = $1 AND function_num >= $2`, [workflowID, startStep]);
      await beforeCommit?.();
    }, {}, () => undefined);
  }
  async #recorded(workflowID: string, stepID: number): Promise<RecordedStep | undefined> {
    const { rows } = await this.#connection.query<RecordedStep>(`SELECT output, error FROM "${this.schemaName}".transaction_completion WHERE workflow_id = $1 AND function_num = $2`, [workflowID, stepID]);
    return rows[0];
  }
  async #record(client: ClientBase | Pool, workflowID: string, stepID: number, column: 'output' | 'error', value: string): Promise<void> {
    const { rows } = await client.query(`INSERT INTO "${this.schemaName}".transaction_completion (workflow_id, function_num, ${column})
      VALUES ($1, $2, $3) ON CONFLICT (workflow_id, function_num) DO NOTHING RETURNING workflow_id`, [workflowID, stepID, value]);
    if (!rows.length) throw new DBOSStepAlreadyRecordedError(workflowID, stepID);
  }
  async #transaction<T>(body: (client: PoolClient) => Promise<T>, config: ApplicationTransactionConfig, beforeCommit: () => void): Promise<T> {
    const isolation = config.isolationLevel ? `ISOLATION LEVEL ${config.isolationLevel}` : '';
    const access = config.readOnly === undefined ? '' : config.readOnly ? 'READ ONLY' : 'READ WRITE';
    const client = await this.#connection.connect();
    let broken: Error | undefined;
    try {
      await client.query(`BEGIN ${isolation} ${access}`);
      const result = await body(client);
      beforeCommit();
      await client.query('COMMIT');
      return result;
    } catch (error) {
      // A lost connection has already ended its transaction on the server; drop the socket.
      if (isTransientConnectionError(error)) broken = error as Error;
      else await client.query('ROLLBACK').catch((rollback: unknown) => { broken = rollback as Error; });
      throw error;
    } finally { client.release(broken); }
  }
  async invokeTransactionFunction<This, Args extends unknown[], Return>(rawConfig: unknown, target: This, func: (this: This, ...args: Args) => Promise<Return>, ...args: Args): Promise<Return> {
    const config = (rawConfig ?? {}) as ApplicationTransactionConfig;
    const workflowID = DBOS.workflowID, stepID = DBOS.stepID;
    if (workflowID !== undefined && stepID === undefined) throw new Error('DBOS.stepID is undefined inside a workflow.');
    const saveResults = !config.readOnly && workflowID !== undefined;
    const window = workflowID !== undefined ? this.retry.workflowWindowMs : this.retry.requestWindowMs;
    const started = Date.now();
    let serializationWait = 1, connectionWait = this.retry.initialBackoffMs, conflicted = false;
    for (;;) {
      let committing = false;
      try {
        // The same step identity is checked on every attempt: a COMMIT whose acknowledgement was
        // lost is found here, so the business transaction is never applied twice.
        if (saveResults) {
          const recorded = await this.#recorded(workflowID!, stepID!);
          if (recorded) return replayRecordedStep(recorded) as Return;
          if (conflicted) throw new DBOSError(`Step ${stepID} of workflow ${workflowID} conflicted with a concurrent execution, but no recorded outcome was found`);
        }
        return await this.#transaction(async client => {
          const result = await transactionContext.run({ client, owner: this }, () => func.call(target, ...args));
          if (saveResults) {
            await this.#record(client, workflowID!, stepID!, 'output', SuperJSON.stringify(result));
            // Holding this step's row, so a later owner's insert waits on our commit.
            await assertStillOwnsWorkflow(workflowID!);
          }
          return result;
        }, config, () => { committing = true; });
      } catch (error) {
        if (error instanceof DBOSWorkflowConflictError) throw error;
        if (saveResults && error instanceof DBOSStepAlreadyRecordedError) { conflicted = true; continue; }
        if (isPGRetriableTransactionError(error)) {
          await sleep(serializationWait); serializationWait = Math.min(serializationWait * 1.5, 2000); continue;
        }
        if (isTransientConnectionError(error)) {
          // Outside a checkpointed step an unacknowledged COMMIT is ambiguous; report it instead of repeating it.
          const repeatable = saveResults || config.readOnly === true || !committing;
          if (repeatable && !this.#stopped && Date.now() - started + connectionWait <= window) {
            await sleep(connectionWait); connectionWait = Math.min(connectionWait * 2, this.retry.maxBackoffMs); continue;
          }
          // A lost connection is never this step's recorded business outcome; recovery may retry it.
          throw error;
        }
        if (saveResults) {
          try { await this.#record(this.#connection, workflowID!, stepID!, 'error', SuperJSON.stringify(error)); }
          catch (recordError) {
            if (recordError instanceof DBOSStepAlreadyRecordedError) { conflicted = true; continue; }
            if (!isTransientConnectionError(recordError)) throw recordError;
          }
        }
        throw error;
      }
    }
  }
}

/** RunStore's DBOS transactional datasource. One per Home/Host; registered before DBOS launch. */
export class ApplicationDataSource {
  readonly #handler: ApplicationTransactionHandler;
  constructor(readonly name: string, config: PoolConfig, retry: Partial<ConnectionRetryPolicy> = {}) {
    this.#handler = new ApplicationTransactionHandler(name, config, { ...defaultConnectionRetry, ...retry });
    registerDataSource(this.#handler);
  }
  get retry(): ConnectionRetryPolicy { return this.#handler.retry; }
  runTransaction<T>(callback: () => Promise<T>, config: ApplicationTransactionConfig = {}): Promise<T> {
    return runTransaction(callback, config.name ?? callback.name, { dsName: this.name, config });
  }
  /** The current transaction's client; valid only inside runTransaction on this datasource. */
  get client(): ClientBase {
    const held = transactionContext.getStore();
    if (!held || held.owner !== this.#handler) throw new Error(`Invalid use of ${this.name}.client outside its DBOS transaction.`);
    return held.client;
  }
}
