// Operator-only diagnostics for one owned test Home. No credentials, SQL text,
// argument/payload bodies, prompts, or ordinary member output are retained.
import { readFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { syncBuiltinESMExports } from 'node:module';
import fs from 'node:fs';
import childProcess from 'node:child_process';
import { performance } from 'node:perf_hooks';

export async function nativePgObserver(home, evidence, repoRoot) {
  const pg = createRequire(path.join(repoRoot, 'packages/harness/package.json'))('pg');
  const credential = JSON.parse(await readFile(path.join(home.home, 'hima/database/credentials.json'), 'utf8'));
  const observer = new pg.Client({ host:'127.0.0.1', port:credential.port, user:credential.user,
    password:credential.password, database:'hima_application', connectionTimeoutMillis:2000,
    options:'-c default_transaction_read_only=on -c statement_timeout=1000', application_name:'issue105-native-readonly-observer' });
  // Authenticate before native work; this connection is independent of all pools.
  await observer.connect();
  const output = path.join(evidence, 'native-pg-diagnostics.jsonl');
  let writes = Promise.resolve(), sequence = 0, stopped = false, polling = false, ioFault = false, observerHealthy = true;
  const emit = (value) => {
    const line = JSON.stringify({ at:new Date().toISOString(), monotonicMs:performance.now(), ...value })+'\n';
    writes = writes.then(()=>appendFile(output,line)).catch(()=>{ ioFault=true; });
  };
  const errorCategory = error => !error ? null : error.message === 'Connection terminated due to connection timeout' ? 'new-connection-timeout'
    : error.message === 'timeout exceeded when trying to connect' ? 'pool-checkout-timeout' : 'other-error';
  // An unexpected server/socket close must be evidence, never an unhandled
  // EventEmitter error that changes the product test result. Retain no raw text.
  observer.on('error', error => {
    observerHealthy=false;
    if(!stopped) emit({kind:'observer-connection-error',error:errorCategory(error),
      code:/^[A-Z0-9]{5}$/.test(error.code??'')?error.code:null});
  });
  const pools = new Map(), clients = new WeakMap(), restore = [];
  const wrap = (prototype, name, replacement) => {
    const original = prototype[name];
    if(typeof original !== 'function') throw Error('Pinned pg diagnostic method missing: '+name);
    prototype[name] = replacement(original); restore.push(()=>{ prototype[name]=original; });
  };
  // Measure existing synchronous ownership/journal work without recording its inputs.
  for(const [object,name] of [[fs,'fsyncSync'],[fs,'readFileSync'],[childProcess,'execFileSync']]) {
    wrap(object,name,original=>function(...args){const begin=performance.now();try{return original.apply(this,args);}
      finally {const elapsedMs=performance.now()-begin;if(elapsedMs>50)emit({kind:'host-sync-operation',operation:name,elapsedMs});}});
  }
  syncBuiltinESMExports();
  const poolCounts = pool => ({ total:pool.totalCount, idle:pool.idleCount, waiting:pool.waitingCount });
  wrap(pg.Pool.prototype, 'connect', original => function(callback) {
    if(!pools.has(this)) pools.set(this,++sequence);
    const id=pools.get(this), begin=performance.now();
    // Snapshot counters at acquisition boundaries without changing pool configuration.
    const end = error => emit({kind:'pool-acquire', pool:id, elapsedMs:performance.now()-begin, error:errorCategory(error), ...poolCounts(this)});
    if(typeof callback === 'function') return original.call(this,(error,...args)=>{end(error);callback(error,...args);});
    return original.call(this).then(client=>{end(null);return client;},error=>{end(error);throw error;});
  });
  wrap(pg.Client.prototype, '_connect', original => function(...args) {
    const id=++sequence, begin=performance.now(); clients.set(this,{id,begin});
    emit({kind:'connection-stage',client:id,stage:'begin'});
    // Protocol event names only. Do not inspect authentication arguments/bytes.
    for(const stage of ['connect','authenticationSASL','authenticationSASLContinue','authenticationSASLFinal','backendKeyData']) {
      this.connection.once(stage,()=>emit({kind:'connection-stage',client:id,stage,elapsedMs:performance.now()-begin}));
    }
    this.once('connect',()=>emit({kind:'connection-stage',client:id,stage:'ready',backendPid:this.processID,elapsedMs:performance.now()-begin}));
    this.connection.once('end',()=>emit({kind:'connection-stage',client:id,stage:'socket-end',elapsedMs:performance.now()-begin}));
    return original.apply(this,args);
  });
  wrap(pg.Client.prototype, '_handleAuthSASLContinue', original => function(...args) {
    const begin=performance.now(), id=clients.get(this)?.id;
    return original.apply(this,args).finally(()=>emit({kind:'scram-client',client:id,elapsedMs:performance.now()-begin}));
  });
  const snapshot = async () => {
    if(!observerHealthy)return;
    const begin=performance.now();
    try {
      const rows=(await observer.query(`SELECT a.pid,a.datname,a.state,a.wait_event_type,a.wait_event,
        EXTRACT(EPOCH FROM (clock_timestamp()-a.query_start))*1000 AS query_age_ms,
        pg_blocking_pids(a.pid) AS blockers,
        CASE WHEN a.query LIKE '%task_actor_grants%' THEN 'grant-table'
          WHEN a.query LIKE '%hima.runs%' THEN 'run-table'
          WHEN a.query LIKE '%effect_facts%' THEN 'effect-facts'
          WHEN a.query LIKE '%transaction_completion%' THEN 'dbos-receipt'
          ELSE 'other' END AS query_category
        FROM pg_stat_activity a WHERE a.datname IN ('hima_application','hima_dbos_system')
          AND a.pid<>pg_backend_pid() ORDER BY a.pid`)).rows;
      emit({kind:'pg-activity',elapsedMs:performance.now()-begin,rows});
      const locks=(await observer.query(`SELECT l.pid,l.locktype,l.mode,l.granted,
        a.datname AS database,
        CASE WHEN l.relation IS NULL THEN 'none'
          WHEN l.database=(SELECT oid FROM pg_database WHERE datname=current_database())
            THEN 'current-database-name' ELSE 'database-local-oid' END AS relation_kind,
        CASE WHEN l.database=(SELECT oid FROM pg_database WHERE datname=current_database())
          THEN l.relation::regclass::text ELSE l.relation::text END AS relation,
        l.transactionid::text AS transaction_id,
        l.virtualxid,pg_blocking_pids(l.pid) AS blockers FROM pg_locks l
        JOIN pg_stat_activity a ON a.pid=l.pid
        WHERE a.datname IN ('hima_application','hima_dbos_system') AND a.pid<>pg_backend_pid()
          AND (NOT l.granted OR l.pid=ANY(SELECT unnest(pg_blocking_pids(w.pid))
            FROM pg_stat_activity w WHERE w.datname IN ('hima_application','hima_dbos_system')))
        ORDER BY l.pid,l.granted,l.locktype,l.mode`)).rows;
      emit({kind:'pg-locks',rows:locks});
    } catch(error) {emit({kind:'observer-error',error:errorCategory(error),code:/^[A-Z0-9]{5}$/.test(error.code??'')?error.code:null});}
  };
  let expected=performance.now()+250;
  const lagTimer=setInterval(()=>{
    const now=performance.now(); emit({kind:'event-loop',delayMs:Math.max(0,now-expected)}); expected=now+250;
    for(const [pool,id] of pools) emit({kind:'pool-state',pool:id,...poolCounts(pool)});
  },250); lagTimer.unref();
  const activityTimer=setInterval(()=>{if(!polling&&!stopped){polling=true;void snapshot().finally(()=>{polling=false;});}},500); activityTimer.unref();
  await snapshot();
  return {
    async capture(runIds) {
      // Call at the original failure boundary, before scoped cancel/Host shutdown.
      await snapshot();
      if(!observerHealthy){emit({kind:'capture-skipped',reason:'observer-connection-unavailable'});return;}
      try {
        const rows=(await observer.query(`SELECT i.run_id,i.effect_id,f.phase,
          f.fact->>'kind' AS kind,f.fact->>'time' AS observed_time,f.fact->>'seq' AS native_seq,
          f.fact->'payload'->>'inputId' AS input_id,f.fact->'payload'->>'action' AS action,
          f.fact->'payload'->'outcome'->>'kind' AS outcome
          FROM hima.flow_invocations i JOIN hima.effect_facts f USING(effect_id)
          WHERE i.run_id=ANY($1::text[]) AND (f.phase LIKE 'native:oar:observation:%'
            OR f.phase LIKE 'native:oar:local-birth:%') ORDER BY i.effect_id,f.phase`,[runIds])).rows;
        emit({kind:'native-timeline',rows});
      } catch(error) {emit({kind:'capture-error',error:errorCategory(error)});}
    },
    async dispose() {
      if(stopped)return; stopped=true; clearInterval(lagTimer);clearInterval(activityTimer);
      for(const undo of restore.reverse())undo();
      syncBuiltinESMExports();
      // Any in-flight read is bounded by this observer's 1s statement timeout.
      try {await observer.end();} finally {await writes;}
      if(ioFault)throw Error('Native PG diagnostics could not be retained.');
    },
  };
}
