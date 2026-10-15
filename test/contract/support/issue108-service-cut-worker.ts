/** I-scheduled only: real private PG/DBOS + installed Hindsight admin export, zero model work. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
const [home,harnessRoot] = process.argv.slice(2) as [string,string];
const load=(name:string)=>import(pathToFileURL(path.join(harnessRoot,'lib',`${name}.js`)).href);
const require=createRequire(path.join(harnessRoot,'package.json'));
const {Pool}=require('pg');
const {startLocalDatabase,resolveRetainedMaterialsDirectory,localLineageDirectory}=await load('local-database');
const {startDurableRuntime,installedExecutableManifest}=await load('durable-runtime');
const {TeamServiceRuntime}=await load('team-service-runtime');
const {readDurableHostExitStatus}=await load('host-exit');
const {prepareColdMaintenanceCut,readColdHindsightConnection}=await load('run-backup');
const {resolveHindsightMaintenanceConfiguration,resolveHindsightEnvironment}=await load('hindsight-configuration');
assert.ok(process.env.HIMA_TEST_LINEAGE_DIR,'Use only the canonical runner private lineage authority');
assert.equal(path.resolve(localLineageDirectory()),path.resolve(process.env.HIMA_TEST_LINEAGE_DIR!));
const database=await startLocalDatabase({home,runtimeDirectory:process.env.HIMA_POSTGRES_RUNTIME});
let runtime:any,services:any;
const app=new Pool({...database.application,max:1});let servicePool:any;
try {
  runtime=await startDurableRuntime({database,manifest:await installedExecutableManifest(harnessRoot)});
  const retained=await resolveRetainedMaterialsDirectory({home});await mkdir(retained,{recursive:true,mode:0o700});
  await mkdir(path.join(home,'sessions'),{mode:0o700});await writeFile(path.join(home,'sessions/native.json'),JSON.stringify({sessionId:'retained-native-108',context:'original retained native context'}),{mode:0o600});
  await writeFile(path.join(retained,'revision.txt'),'actual revision 108',{mode:0o600});
  // Direct schema fixtures test whole-cut preservation, not Team API business acceptance.
  await app.query("INSERT INTO hima.teams VALUES('team-108','project-108',2); INSERT INTO hima.team_versions VALUES('team-108',1,repeat('a',64),'{\"version\":1}'),('team-108',2,repeat('b',64),'{\"version\":2}');");
  await app.query("INSERT INTO hima.team_memory_records VALUES('disabled-108',1,'project-108','team-108','team',NULL,'{\"text\":\"original claim\"}'); INSERT INTO hima.team_memory_events(event_id,project_id,team_id,memory_id,version,revision,request_id,digest,event) VALUES('disabled-event-108','project-108','team-108','disabled-108',1,1,'disable-108',repeat('c',64),'{\"event\":\"disabled\",\"reason\":\"human correction\"}');");
  const connection=await database.prepareHindsight();
  const serviceOptions={home,runtimeDirectory:process.env.HIMA_TEAM_RUNTIME,recordReceipt:(receipt:any)=>runtime.store.recordTeamServiceReceipt(receipt),
    maintenanceConfiguration:()=>resolveHindsightMaintenanceConfiguration(()=>readColdHindsightConnection({home,application:database.application})),configuration:async()=>{
    const databaseUrl=new URL(`postgresql://127.0.0.1:${connection.port}/${connection.database}`);databaseUrl.username=connection.user;databaseUrl.password=connection.password;
    assert.ok(process.env.DEEPSEEK_API_KEY,'Reuse the existing shared DeepSeek credential for normal service startup; maintenance remains keyless');
    assert.equal(process.env.DEEPSEEK_MODEL??'deepseek-flash','deepseek-flash');
    const environment=resolveHindsightEnvironment({
      ...process.env,
      HIMA_HINDSIGHT_EMBEDDINGS_LOCAL_MODEL:path.join(process.env.HIMA_TEAM_RUNTIME!,'models/BAAI-bge-small-en-v1.5'),
      HIMA_HINDSIGHT_RERANKER_LOCAL_MODEL:path.join(process.env.HIMA_TEAM_RUNTIME!,'models/cross-encoder-ms-marco-MiniLM-L-6-v2'),
    },{provider:'anthropic-messages',model:'deepseek-flash',apiKey:process.env.DEEPSEEK_API_KEY,
      baseUrl:process.env.DEEPSEEK_BASE_URL??'https://api.deepseek.com/anthropic'});
    return {databaseUrl:databaseUrl.href,environment};
  }};
  services=new TeamServiceRuntime(serviceOptions);
  const started=await services.start('hindsight');assert.equal(started.state,'running');
  servicePool=new Pool({...connection,max:1});
  // The retained 0.10.3 native manifest describes banks.bin as PostgreSQL binary COPY.
  // Seed a real exported public table, without invoking retain/embedding/model work.
  const bankColumns=new Set((await servicePool.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='banks'")).rows.map((row:any)=>row.column_name));
  assert.ok(['bank_id','name','disposition','mission','internal_id'].every(column=>bankColumns.has(column)),'The fixed native bank schema must match the read-cut fixture');
  await servicePool.query("INSERT INTO public.banks(bank_id,name,disposition,mission,created_at,updated_at,internal_id) VALUES('issue108-cut-probe','original service bytes','{\"skepticism\":3,\"literalism\":3,\"empathy\":3}'::jsonb,'original service bytes',now(),now(),'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa')");
  assert.equal((await services.status('hindsight')).state,'running','The seeded bank must remain readable through authenticated native status');
  await runtime.store.acceptHostExit({requestId:'maintenance-108-real',mode:'drain'});
  await runtime.store.beginHostExitFinalization('maintenance-108-real');
  let blockedWriter=false;
  let cut=await prepareColdMaintenanceCut({home,status:()=>readDurableHostExitStatus(runtime.store,undefined),serviceDatabase:()=>readColdHindsightConnection({home,application:database.application}),
    services:{status:(id:string)=>services.status(id),stop:(id:string)=>services.stop(id),export:async(id:string,request:any)=>{
      // This real concurrent DML must time out while the maintenance transaction holds SHARE.
      await servicePool.query("SET statement_timeout='250ms'");
      await assert.rejects(servicePool.query("UPDATE public.banks SET mission='late mutation' WHERE bank_id='issue108-cut-probe'"),(error:any)=>error.code==='57014');blockedWriter=true;
      return services.export(id,request);
    }}});
  assert.equal(blockedWriter,true);assert.equal((await servicePool.query("SELECT mission FROM public.banks WHERE bank_id='issue108-cut-probe'")).rows[0].mission,'original service bytes');
  assert.ok(cut.services.some((receipt:any)=>receipt.operation==='export'&&receipt.export.bytes>0));
  await services.stopAll();
  // A later Host need not start Hindsight merely to re-export previously used data. The
  // maintenance-only option must reuse the fixed admin CLI while the worker stays stopped.
  let startupAttempts=0;
  services=new TeamServiceRuntime({...serviceOptions,configuration:async()=>{startupAttempts++;throw new Error('No model/provider/key is configured in this stopped maintenance instance.');}});
  cut=await prepareColdMaintenanceCut({home,status:()=>readDurableHostExitStatus(runtime.store,undefined),serviceDatabase:()=>readColdHindsightConnection({home,application:database.application}),services});
  assert.equal(startupAttempts,0,'Stopped admin must not consult the model startup configuration');
  const exported=cut.services.find((receipt:any)=>receipt.operation==='export');assert.equal(exported.state,'stopped');
  assert.equal((await services.status('hindsight')).owned.pid,undefined);
  const native=JSON.parse(await readFile(path.join(process.env.HIMA_TEAM_RUNTIME!,'team-runtime.json'),'utf8'));
  const python=path.join(process.env.HIMA_TEAM_RUNTIME!,native.services.find((service:any)=>service.id==='hindsight').backupExecutable);
  const check=spawnSync(python,['-I','-B','-c',"import sys,zipfile,json; z=zipfile.ZipFile(sys.argv[1]); m=json.loads(z.read('manifest.json')); b=z.read('banks.bin'); assert m['schema']=='public' and m['tables']['banks']['rows']>=1; assert b.startswith(b'PGCOPY') and b'original service bytes' in b and b'late mutation' not in b; print(json.dumps({'schema':m['schema'],'banksRows':m['tables']['banks']['rows'],'tables':len(m['tables'])}))",exported.export.file],{encoding:'utf8',timeout:10_000});
  assert.equal(check.status,0,check.stderr);const zip=JSON.parse(check.stdout);
  await services.stopAll();services=undefined;await servicePool.end();servicePool=undefined;await app.end();
  await runtime.stop();runtime=undefined;await database.stop();
  const authority=JSON.parse(await readFile(path.join(home,'hima/database/backup-authority.json'),'utf8'));
  assert.equal(authority.application.team_versions.length,2);assert.equal(authority.application.team_memory_events[0].event.event,'disabled');
  process.send?.({state:'stopped',identity:database.identity,cutId:cut.cutId,blockedWriter,serviceBytes:exported.export.bytes,zip,offlineWorkerNotStarted:true});
} finally {
  await services?.stopAll();await servicePool?.end();await app.end().catch(()=>{});await runtime?.stop();await database.stop();
  process.disconnect?.();
}
