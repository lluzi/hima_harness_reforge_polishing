/** Proposal only. No product import or IO until explicit admission + run flag.
 * I owns the 600s / 3072MiB external watcher. Source and restored Hosts are separate
 * OS processes: a live source PID must never be blessed as a cold source.
 */
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { lstat, mkdir, readFile, readdir, realpath, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

type Json = any; // Dynamic real Host/test-support boundary; full I typecheck is still required.
export interface NativeRestoreConfig {
  schema:'issue108-native-restore-admission/1';
  integrationRoot:string; frozenHarness:string; distributionRoot:string; distributionManifest:string;
  expectedApplicationVersion:string; expectedDistributionManifestSha256:string;
  postgresRuntime:string; teamRuntime:string; profileTemplate:string;
  proofRoot:string; sourceHome:string; restoredHome:string; sourceUnavailable:string;
  workspace:string; workspaceUnavailable:string; lineageDirectory:string; backupDirectory:string;
  /** Absolute outer admission deadline, not a fresh allowance for each process/phase. */
  expiresAt:string;
}
const ADMIT='HIMA_108_NATIVE_RESTORE_ADMIT';
const sameBusiness=(a:Json,b:Json)=>['runs','effects','dispatches','messages','accepted_deliveries'].every(k=>a[k]===b[k]);
const hash=(v:string|Uint8Array)=>createHash('sha256').update(v).digest('hex');
const inside=(root:string,p:string)=>p===root||p.startsWith(root+path.sep);
function check(v:unknown,message:string):asserts v {if(!v)throw new Error('Issue108 native restore blocker: '+message);}
const load=(c:NativeRestoreConfig,name:string)=>import(pathToFileURL(path.join(c.frozenHarness,'lib',name+'.js')).href);
const support=(c:NativeRestoreConfig,name:string)=>import(pathToFileURL(path.join(c.integrationRoot,'test/contract/support',name+'.ts')).href);
const secretValues=new Set<string>();
function safe(error:unknown):string {
  let s=error instanceof Error?`${error.name}: ${error.message}\n${error.stack??''}`:String(error);
  for(const value of secretValues)if(value)s=s.split(value).join('[redacted]');
  s=s.replace(/postgres(?:ql)?:\/\/\S+/g,'[database URL redacted]').replace(/Bearer\s+\S+/gi,'Bearer [redacted]')
    .replace(/sk-[A-Za-z0-9_-]+/g,'[key redacted]');
  s=s.split('\n').filter((line,i)=>i===0||/^\s+at /.test(line)).join('\n');
  return Buffer.from(s).subarray(0,6000).toString('utf8');
}
async function json(file:string,value:unknown) {await writeFile(file,JSON.stringify(value,null,2)+'\n',{mode:0o600});}
async function exists(file:string) {return lstat(file).then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e;});}
async function poll(c:NativeRestoreConfig,label:string,fn:()=>Promise<unknown>):Promise<Json> {
  for(;;){const v=await fn();if(v)return v;check(Date.now()<Date.parse(c.expiresAt)-35_000,'deadline before '+label);await new Promise(r=>setTimeout(r,150));}
}
function admission() {
  check(process.argv.includes('--run-issue108-native-restore')&&process.env[ADMIT]==='1','explicit I admission flag and CLI run flag required');
  check(Number(process.versions.node.split('.')[0])>=24,'Node24 required');
  check(!!process.env.NODE_TEST_CONTEXT,'canonical test runner context required; do not use real user lineage');
  check(process.env.DBOS__CLOUD!=='true','no cloud DBOS');
}
async function config(file:string):Promise<NativeRestoreConfig> {
  admission();const info=await lstat(file);check(info.isFile()&&!info.isSymbolicLink()&&info.size<32_768,'small plain path-only config required');
  const c=JSON.parse(await readFile(file,'utf8')) as NativeRestoreConfig;
  check(c.schema==='issue108-native-restore-admission/1','config schema');
  const required=['schema','integrationRoot','frozenHarness','distributionRoot','distributionManifest','expectedApplicationVersion','expectedDistributionManifestSha256','postgresRuntime','teamRuntime','profileTemplate','proofRoot','sourceHome','restoredHome','sourceUnavailable','workspace','workspaceUnavailable','lineageDirectory','backupDirectory','expiresAt'];
  check(required.every(k=>typeof (c as Json)[k]==='string')&&Object.keys(c).every(k=>required.includes(k)),'path-only config fields missing or unknown');

  for(const [key,value]of Object.entries(c))if(!['schema','expectedApplicationVersion','expectedDistributionManifestSha256','expiresAt'].includes(key))check(typeof value==='string'&&path.isAbsolute(value),'absolute path: '+key);
  check(/^hima-[a-f0-9]{64}$/.test(c.expectedApplicationVersion)&&/^[a-f0-9]{64}$/.test(c.expectedDistributionManifestSha256),'exact frozen identities required');
  check(Number.isFinite(Date.parse(c.expiresAt))&&Date.parse(c.expiresAt)>Date.now()+45_000&&Date.parse(c.expiresAt)<=Date.now()+600_000,'single existing admission deadline <=600s');
  c.frozenHarness=await realpath(c.frozenHarness);c.distributionRoot=await realpath(c.distributionRoot);
  check(inside(c.distributionRoot,c.frozenHarness)&&inside(c.distributionRoot,await realpath(c.profileTemplate)),'Harness/profile must belong to same frozen cohort');
  const roots=[c.sourceHome,c.restoredHome,c.sourceUnavailable,c.workspace,c.workspaceUnavailable,c.lineageDirectory,c.backupDirectory].map(p=>path.resolve(p));
  check(roots.every(p=>inside(path.resolve(c.proofRoot),p)&&p!==path.resolve(c.proofRoot)),'only task-private descendants may be mutated');
  for(let i=0;i<roots.length;i++)for(let j=i+1;j<roots.length;j++)check(!inside(roots[i]!,roots[j]!)&&!inside(roots[j]!,roots[i]!),'fixture roots must be independent siblings');
  check(!inside(c.distributionRoot,path.resolve(c.proofRoot))&&!inside(path.resolve(c.proofRoot),c.distributionRoot),'evidence and frozen program must be separate');
  const paths=await load(c,'local-database');
  for(const key of ['proofRoot','sourceHome','restoredHome','sourceUnavailable','workspace','workspaceUnavailable','lineageDirectory','backupDirectory'] as const)c[key]=await paths.canonicalHome(c[key]);
  const normalized=[c.sourceHome,c.restoredHome,c.sourceUnavailable,c.workspace,c.workspaceUnavailable,c.lineageDirectory,c.backupDirectory];
  for(const p of normalized)check(inside(c.proofRoot,p)&&p!==c.proofRoot,'canonical fixture path escapes proofRoot');
  for(let i=0;i<normalized.length;i++)for(let j=i+1;j<normalized.length;j++)check(!inside(normalized[i]!,normalized[j]!)&&!inside(normalized[j]!,normalized[i]!),'canonical fixture roots overlap');
  check(!inside(c.distributionRoot,c.proofRoot)&&!inside(c.proofRoot,c.distributionRoot),'canonical evidence overlaps frozen program');
  check(hash(await readFile(c.distributionManifest))===c.expectedDistributionManifestSha256,'frozen distribution manifest changed');
  return c;
}
function environment(c:NativeRestoreConfig) {
  check(!!process.env.DEEPSEEK_API_KEY,'existing inherited DeepSeek credential required; do not put credentials in config');
  check((process.env.DEEPSEEK_MODEL??'deepseek-flash')==='deepseek-flash','product model stays DeepSeek Flash');
  secretValues.add(process.env.DEEPSEEK_API_KEY!);
  // Runtime mutation is confined to this admitted disposable worker process.
  Object.assign(process.env,{DEEPSEEK_MODEL:'deepseek-flash',DEEPSEEK_BASE_URL:process.env.DEEPSEEK_BASE_URL??'https://api.deepseek.com/anthropic',DEEPSEEK_API:process.env.DEEPSEEK_API??'anthropic-messages',HIMA_TEST_LINEAGE_DIR:c.lineageDirectory,HIMA_TEST_SILENT_AGENT:'1',HIMA_TEST_LEGACY_AUTO_DRIVE:'0',
    HIMA_POSTGRES_RUNTIME:c.postgresRuntime,HIMA_TEAM_RUNTIME:c.teamRuntime,
    HIMA_HINDSIGHT_EMBEDDINGS_LOCAL_MODEL:path.join(c.teamRuntime,'models/BAAI-bge-small-en-v1.5'),
    HIMA_HINDSIGHT_RERANKER_LOCAL_MODEL:path.join(c.teamRuntime,'models/cross-encoder-ms-marco-MiniLM-L-6-v2')});
}
async function frozen(c:NativeRestoreConfig) {
  const gate=await load(c,'local-database');check(path.resolve(gate.localLineageDirectory())===path.resolve(c.lineageDirectory),'test lineage ignored by frozen program; use a plain cohort, never native/user authority');
  const runtime=await load(c,'durable-runtime');check(runtime.executableApplicationVersion(await runtime.installedExecutableManifest(c.frozenHarness))===c.expectedApplicationVersion,'actual executable version changed; never relabel applicationVersion');
  const reader=await load(c,'oar-local-member');check(reader.retainedMemberRootProtocol==='hima-native-original-roots/1','frozen reader lacks qualified original-root support');
}
function home(c:NativeRestoreConfig,at:string) {
  return {home:at,profileDir:path.join(at,'profiles/hima'),workspace:c.workspace,
    env:{...process.env,DSH_HOME:at,DSH_AGENTS_HOME:path.join(at,'agents')},dispose:async()=>{throw new Error('Evidence Homes are retained; outer fixture owner cleans only after review');}};
}
async function profileLinks(c:NativeRestoreConfig,dir:string) {
  for(const e of await readdir(dir,{withFileTypes:true})) {
    const p=path.join(dir,e.name),st=await lstat(p);
    if(st.isSymbolicLink())check(inside(c.distributionRoot,await realpath(p)),'profile dependency link escapes frozen cohort: '+e.name);
    else if(st.isDirectory())await profileLinks(c,p);
  }
}
async function db(c:NativeRestoreConfig,at:string,fn:(p:Json)=>Promise<Json>,service=false) {
  const cred=JSON.parse(await readFile(path.join(at,'hima/database/credentials.json'),'utf8'));secretValues.add(cred.password);
  const {Pool}=createRequire(path.join(c.frozenHarness,'package.json'))('pg');
  let connection:Json={host:'127.0.0.1',port:cred.port,user:cred.user,password:cred.password,database:'hima_application'};
  if(service){const api=await load(c,'run-backup');connection=await api.readColdHindsightConnection({home:at,application:connection});secretValues.add(connection.password);}
  const pool=new Pool({...connection,max:1,connectionTimeoutMillis:2000,application_name:'issue108-native-restore-owned'});
  try{return await fn(pool);}finally{await pool.end();}
}
async function counts(c:NativeRestoreConfig,at:string) {
  return db(c,at,async p=>(await p.query(`SELECT
    (SELECT count(*) FROM hima.runs)::int AS runs,
    (SELECT count(*) FROM hima.effects)::int AS effects,
    (SELECT count(*) FROM hima.effect_dispatches WHERE dispatch_id NOT LIKE 'stop:%' AND dispatch_id NOT LIKE 'cleanup:%')::int AS dispatches,
    (SELECT count(*) FROM hima.team_messages)::int AS messages,
    (SELECT count(*) FROM hima.team_message_deliveries WHERE delivery->>'state'='accepted')::int AS accepted_deliveries,
    (SELECT count(*) FROM hima.team_delivery_attempts)::int AS delivery_attempts`)).rows[0]);
}
async function closeHost(c:NativeRestoreConfig,host:Json,service:Json,beforeFinish?:()=>Promise<void>) {
  // Exactly the ordinary ordered closer. No cancel, fake authority or second cut exporter.
  const requestId='issue108-close-'+randomUUID();let status=await service.prepareExit({requestId,mode:'drain'});
  while(!status.ready){check(Date.now()<Date.parse(c.expiresAt)-5_000,'exit did not reach resource boundary within admission');await new Promise(r=>setTimeout(r,100));status=await service.exitStatus();}
  if(beforeFinish)await beforeFinish();
  const ended=await service.finishExit(requestId);check(ended.finalized===true,'Host did not confirm actual resource finalization');
  await host.dispose();if(service.resourcesClosing)await service.resourcesClosing;
}
const cas=(v:Json)=>({memoryId:v.record.memoryId,expectedVersion:v.record.version,expectedRevision:v.tip.revision,supersedesEventId:v.tip.eventId});
const feedbackSource=(v:Json)=>({kind:'feedback',eventId:v.tip.eventId,sha256:v.record.sha256});
async function owned(c:NativeRestoreConfig) {
  const file=path.join(c.proofRoot,'issue108-native-owner.json');const info=await lstat(file);
  check(info.isFile()&&!info.isSymbolicLink()&&info.size<2048,'missing private fixture ownership marker');
  const marker=JSON.parse(await readFile(file,'utf8'));check(marker.schema===c.schema&&marker.expectedApplicationVersion===c.expectedApplicationVersion&&marker.configSha256===hash(JSON.stringify(c)),'fixture ownership mismatch');
}
async function source(c:NativeRestoreConfig) {
  await owned(c);check(!await exists(c.sourceHome)&&!await exists(c.workspace),'source phase must create fresh paths, never reuse a Home');
  const {prepareHimaHome}=await import(pathToFileURL(path.join(c.integrationRoot,'packages/desktop/src/hima-home.ts')).href);
  const h=home(c,c.sourceHome);await mkdir(c.sourceHome,{recursive:true,mode:0o700});await mkdir(c.workspace,{recursive:true,mode:0o700});
  await prepareHimaHome({home:h.home,sources:{profileTemplate:c.profileTemplate,harnessPackage:c.frozenHarness,presets:path.join(c.frozenHarness,'presets')}});
  await profileLinks(c,h.profileDir);
  const {bootInProcess,createRootAgent}=await support(c,'boot-inprocess');let host:Json,svc:Json,primary:unknown;
  try {
    host=await bootInProcess(h,{withWebApp:true});svc=host.ctx.hima;await svc.reconciled;
    check(svc.durable.applicationVersion===c.expectedApplicationVersion,'source Host did not execute frozen cohort');
    const agent=await createRootAgent(host.ctx,c.workspace),sessionId=String(agent.id),store=svc.durable.store;
    const op=(request:Json)=>svc.teamOperation(sessionId,request,'human');
    const output={version:'restore-ack/1',schema:{$schema:'https://json-schema.org/draft/2020-12/schema',type:'object',
      properties:{predecessorRunId:{type:'string'},revision1:{type:'string'},revision2:{type:'string'}},required:['predecessorRunId','revision1','revision2'],additionalProperties:false}};
    const humanRequest={requestId:'restore-human-gate',target:'human',goal:'Hold this original task until explicit post-exit human continuation.',input:{purpose:'restore gate'},
      output:{version:'restore-decision/1',schema:{$schema:'https://json-schema.org/draft/2020-12/schema',type:'object',properties:{approved:{type:'boolean'}},required:['approved'],additionalProperties:false}},dependsOn:[],deadlineAt:c.expiresAt};
    const instructions=`There are two phases. POST-EXIT requires an actual Host-retained payload with schema hima-team-reconstruction/1, cause post-exit and predecessorRunId; these instructions alone are not such a payload. ORIGINAL input has no such actual Host payload: invoke native member_context ask-human with request ${JSON.stringify(humanRequest)}, then wait with requestId restore-original-wait and delegationIds containing exactly its returned delegationId (MCP replies are {ok,value}; unwrap value). Do not finalize, repeat work or invent a checkpoint. Host will close you after yield. POST-EXIT reconstruction explicitly names predecessorRunId: do not repeat ask-human/wait or any external write. Read retained messages, query-memory for the withdrawn restore advice (do not use disabled advice), then read-material for BOTH linked revision.md versions (read-excerpt if needed); return their actual full text and the Host predecessorRunId only as valid JSON with quoted keys: {"schemaVersion":"restore-ack/1","value":{"predecessorRunId":"ACTUAL_HOST_PREDECESSOR_ID","revision1":"ACTUAL_FIRST_TEXT","revision2":"ACTUAL_SECOND_TEXT"},"artifacts":[],"diagnostics":[]}. Replace every placeholder with actual source values. No research, shell, GitHub, EDA or subagents.`;
    const definition={schema:'hima-team-definition/1',title:'Minimal native restore',members:[{id:'lead',role:'Restore probe',runtime:'pi',modelRef:'default',skills:[],instructions,
      toolRefs:['hima-member-context'],knowledgeRefs:[]}],leaderMemberId:'lead',collaboration:'One Pi member, no native child worker; human wait then explicit post-exit reconstruction.',delivery:{description:'Actual retained predecessor and two original revisions',output}};
    const team=await op({action:'save',definition,expectedVersion:null});
    const task=await op({action:'startTask',teamId:team.teamId,request:{requestId:'restore-native-task',teamId:team.teamId,expectedVersion:team.version,
      goal:'Follow the frozen original/yield or post-exit instructions. Deliver only after explicit post-exit continuation.',input:{workspaceRoot:c.workspace,purpose:'single native backup/restore proof'},deadlineAt:c.expiresAt,closure:'No automatic restart, re-adoption or duplicate business effects.'}});
    check(task.readiness.ready===true,'native task is not actually admitted');
    await json(path.join(c.proofRoot,'source-opening.json'),{teamId:team.teamId,taskId:task.taskId,runId:task.currentRunId,deadlineAt:task.deadlineAt});
    const ref={teamId:team.teamId,taskId:task.taskId},texts=['revision ONE '+randomUUID()+'\n','revision TWO '+randomUUID()+'\n'],stages:Json[]=[];
    for(let i=0;i<texts.length;i++) {
      const receipt=await host.ctx.get('fileUploads').uploadStream({sessionId:agent.id,name:'revision.md',data:(async function*(){yield Buffer.from(texts[i]!);})()});
      const staged=await op({action:'stage-attachment',...ref,request:{requestId:'revision-'+i,receiptId:receipt.receiptId}});
      check(staged.parser.status==='parsed'&&staged.material.sha256===hash(texts[i]!), 'original revision parse/hash');stages.push(staged);
    }
    check(stages[0].stageId!==stages[1].stageId,'same filename must not collapse revisions');
    const sent=await op({action:'send-message',...ref,request:{requestId:'original-material-references',recipientMemberIds:['lead'],kind:'requirement',
      text:'After explicit post-exit continuation read both original revisions, in this order: '+JSON.stringify(stages.map(s=>({stageId:s.stageId,sha256:s.material.sha256,location:s.parser.chunks[0]?.location}))),stagedAttachmentIds:stages.map(s=>s.stageId)}});
    const memory=(action:string,request:Json)=>svc.workMemory(sessionId,{...ref,action,request},'person');
    const feedback=await memory('feedback',{requestId:'restore-feedback',target:{kind:'team'},text:'Withdrawn restore advice '+randomUUID(),reason:'Real operator fixture feedback',conditions:['this restore task']});
    const adopted=await memory('adopt',{requestId:'restore-adopt',...cas(feedback),action:'adopted',reason:'Explicit operator adoption before withdrawal',evidenceRefs:[feedbackSource(feedback)],conditions:['this restore task']});
    const disabled=await memory('adopt',{requestId:'restore-disable',...cas(adopted),action:'disabled',reason:'Explicit operator withdrawal must survive restore',evidenceRefs:[],conditions:[]});
    check(disabled.tip.state==='disabled','actual memory API did not disable tip');
    const native=await poll(c,'real native wait/capture/closure',async()=>{
      const outcome=await store.flowFact(task.currentRunId,'outcome:0');check(!outcome||!['succeeded','failed','cancelled'].includes(outcome.state),'original task terminated before native wait; preserve original failure');
      const waits=await db(c,h.home,async p=>(await p.query('SELECT wait_id,saved_context,closure_proof FROM hima.team_waits WHERE run_id=$1 ORDER BY wait_id',[task.currentRunId])).rows);
      const wait=waits.find((w:Json)=>w.saved_context&&w.closure_proof);if(!wait)return false;
      check(wait.saved_context.kind==='native-checkpoint','actual native checkpoint unavailable; do not synthesize or substitute reconstruction success');
      const checkpoint=wait.saved_context.checkpoint,identity=checkpoint.origin.identity;
      const lease=await store.externalEffectFact(identity,'oar:local-lease'),created=await store.externalEffectFact(identity,'oar:native-session'),closed=await store.externalEffectFact(identity,'oar:closed');
      if(!lease||!created||!closed)return false;
      check(created.nativeSession===checkpoint.origin.nativeSession&&lease.workDirectory===checkpoint.origin.cwd&&closed.absent===true,'original native identity/cwd/closure differs');
      const reader=await load(c,'oar-local-member');reader.verifyLocalNativeCheckpoint(lease.controlDirectory,checkpoint);
      const resources=await store.effectResources(identity.effectId);check(resources.length>0&&resources.every((r:Json)=>r.released),'native leases not physically released');
      const prepared=await store.effectFact(identity.effectId,'prepared');
      const received=prepared?.inputId?await store.externalEffectReceivedObservation(identity,prepared.inputId):undefined;
      const replies=Object.values(await store.listExternalEffectFacts(identity,'oar:tool-reply:')) as Json[];
      check(received?.nativeSession===created.nativeSession,'no actual correlated original Pi input receipt; queued input is insufficient');
      check(replies.some(reply=>reply.ok===true&&reply.value?.delegationId),'no actual native ask-human Host reply');
      for(const pid of closed.pids??[]) {
        check(Number.isSafeInteger(pid)&&pid>=2,'invalid owned PID closure');let absent=false;
        try{process.kill(pid,0);}catch(error){absent=(error as NodeJS.ErrnoException).code==='ESRCH';}
        check(absent,'original owned native descendant remains or closure is unknown');
      }

      return {waitId:wait.wait_id,identity,lease,created,closed,checkpoint,received:{nativeSession:received.nativeSession,streamGeneration:received.streamGeneration,seq:received.seq,inputId:prepared.inputId},
        leaseSha256:hash(await readFile(path.join(path.dirname(lease.controlDirectory),'lease.json'))),configurationSha256:hash(await readFile(path.join(lease.controlDirectory,'config.json')))};
    });
    check(!(await store.flowFact(task.currentRunId,'outcome:0')),'original task became terminal; do not force resume');
    // Real Hindsight data, no new recall/extraction test: same actual schema as whole2.
    const running=await svc.teamRuntimeOperation({action:'start',serviceId:'hindsight'});check(running.receipt.state==='running','normal Hindsight startup failed');
    await db(c,h.home,async p=>p.query("INSERT INTO public.banks(bank_id,name,disposition,mission,created_at,updated_at,internal_id) VALUES('issue108-native-bank','restore fixture','{\"skepticism\":3,\"literalism\":3,\"empathy\":3}'::jsonb,'retained native restore bank',now(),now(),'bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb')"),true);
    const before=await counts(c,h.home);
    const receipt={task:{...ref,runId:task.currentRunId,deadlineAt:task.deadlineAt},messageId:sent.message.messageId,stages:stages.map(s=>({stageId:s.stageId,material:s.material,location:s.parser.chunks[0]?.location})),texts,
      memory:{memoryId:disabled.record.memoryId,version:disabled.record.version,eventId:disabled.tip.eventId,revision:disabled.tip.revision,state:disabled.tip.state,text:disabled.record.text},native,before,productModelRequests:'not independently measured'};
    await json(path.join(c.proofRoot,'source-receipt.json'),receipt);
    await closeHost(c,host,svc,async()=>{(receipt as Json).finalCounts=await counts(c,h.home);await json(path.join(c.proofRoot,'source-receipt.json'),receipt);});host=undefined;
    check(!await exists(path.join(h.home,'hima/database/data/postmaster.pid')),'source PG PID receipt remains');
    await json(path.join(c.proofRoot,'source-closed.json'),{hostPid:process.pid,resourcesClosingConfirmed:true,postmasterPidFileRemoved:true});
  }catch(error){primary=error;throw error;}finally{if(host)try{await host.dispose();if(svc?.resourcesClosing)await svc.resourcesClosing;}catch(error){await json(path.join(c.proofRoot,'source-cleanup-error.json'),{error:safe(error)});if(primary===undefined)throw error;}}
}
async function restored(c:NativeRestoreConfig) {
  await owned(c);check(await exists(path.join(c.proofRoot,'qualification-receipt.json')),'parent actual qualification receipt missing');
  const receipt=JSON.parse(await readFile(path.join(c.proofRoot,'source-receipt.json'),'utf8'));
  const local=await load(c,'oar-local-member');
  const originalConfiguration=JSON.parse(await readFile(path.join(receipt.native.lease.controlDirectory,'config.json'),'utf8'));
  secretValues.add(originalConfiguration.model?.apiKey??'');check(originalConfiguration.assets?.oarModule&&originalConfiguration.assets?.nodeExecutable,'original native asset identity is absent');
  const recovered=await new local.OarLocalMemberRuntime({home:c.restoredHome,nodeExecutable:originalConfiguration.assets.nodeExecutable,runnerModule:path.join(c.frozenHarness,'lib/oar-member-runner.js'),assets:originalConfiguration.assets}).recover(receipt.native.lease.sessionKey);
  check(recovered&&recovered.controlDirectory===receipt.native.lease.controlDirectory&&recovered.workDirectory===receipt.native.lease.workDirectory,'qualified native predecessor paths were rewritten');
  check(hash(await readFile(path.join(path.dirname(recovered.controlDirectory),'lease.json')))===receipt.native.leaseSha256&&hash(await readFile(path.join(recovered.controlDirectory,'config.json')))===receipt.native.configurationSha256,'original lease/config bytes changed');
  const checkpoint=local.verifyLocalNativeCheckpoint(recovered.controlDirectory,receipt.native.checkpoint);
  check(checkpoint.sha256===receipt.native.checkpoint.sha256&&checkpoint.origin.nativeSession===receipt.native.created.nativeSession,'real retained checkpoint/origin changed');
  const beforeOpen=await sourceFinalCounts(c); // Receipts, not a PG start disguised as inspection.
  const {bootInProcess,createRootAgent}=await support(c,'boot-inprocess');let host:Json,svc:Json,primary:unknown;
  try {
    host=await bootInProcess(home(c,c.restoredHome),{withWebApp:true});svc=host.ctx.hima;await svc.reconciled;
    check(svc.durable.applicationVersion===c.expectedApplicationVersion,'restored Host used another executable');
    const owner=await createRootAgent(host.ctx,c.workspace),sessionId=String(owner.id),store=svc.durable.store;
    const op=(request:Json)=>svc.teamOperation(sessionId,request,'human');
    const ref={teamId:receipt.task.teamId,taskId:receipt.task.taskId};
    const view=await op({action:'readTask',...ref});
    check(view.currentRunId===receipt.task.runId,'opening restored Home auto-created a successor Run');
    const stable=await counts(c,c.restoredHome);check(sameBusiness(stable,beforeOpen),'default restored open created business work/delivery');
    // Use condition-based reconciliation/readiness, then a short bounded quiet observation;
    // this supplements exact counter equality and never claims arbitrary future non-execution.
    await new Promise(r=>setTimeout(r,250));check(sameBusiness(await counts(c,c.restoredHome),stable),'late automatic dispatch after default open');
    const memory=(action:string,request:Json)=>svc.workMemory(sessionId,{...ref,action,request},'person');
    const status=await memory('status',{page:{limit:50},reconcile:false});
    const disabled=status.records?.find((v:Json)=>v.record.memoryId===receipt.memory.memoryId);
    check(disabled?.tip.state==='disabled'&&disabled.tip.eventId===receipt.memory.eventId&&disabled.tip.revision===receipt.memory.revision,'disabled tip changed during restore');
    const recalled=await memory('query',{query:receipt.memory.text});
    check(Array.isArray(recalled.records)&&!recalled.records.some((v:Json)=>v.record.memoryId===receipt.memory.memoryId),'disabled memory was reactivated');
    for(let i=0;i<receipt.stages.length;i++) {
      const stage=receipt.stages[i];const current=await op({action:'read-material',...ref,request:{stageId:stage.stageId}});
      check(current.material.sha256===stage.material.sha256,'restored material link/hash differs');
      const excerpt=await op({action:'read-excerpt',...ref,request:{stageId:stage.stageId,location:stage.location}});
      check(excerpt.text.trim()===receipt.texts[i].trim(),'restored revision original text differs');
    }
    check(sameBusiness(await counts(c,c.restoredHome),stable),'inspection itself admitted new work');
    const run=await store.run(view.currentRunId);
    const resume={requestId:'explicit-native-restore-resume',action:'resume',expectedRunId:view.currentRunId,expectedEpoch:run.epoch,expectedRevision:run.revision};
    const next=await op({action:'control',...ref,request:resume});
    check(next.currentRunId!==receipt.task.runId&&next.taskId===receipt.task.taskId&&next.deadlineAt===receipt.task.deadlineAt,'explicit resume changed task/scope/deadline or reused old Run');
    const replay=await op({action:'control',...ref,request:resume});check(replay.currentRunId===next.currentRunId,'lost-ACK replay created a duplicate successor');
    const successor=await store.run(next.currentRunId),context=successor.opening.data.initialHostContext;
    check(context?.source==='post-exit'&&context.predecessorRunId===receipt.task.runId&&context.context?.predecessorRunId===receipt.task.runId,'post-exit reconstruction points to wrong predecessor');
    check(context.hostPromptSha256===hash(context.hostPrompt),'Host reconstruction prompt digest mismatch');
    const result=await poll(c,'actual new native consumption and result closure',async()=>{
      const v=await op({action:'readTask',...ref});
      const row=v.execution?.tasks?.find((x:Json)=>x.result?.identity?.runId===next.currentRunId);
      check(!['failed','cancelled'].includes(v.execution?.state),'resumed task terminated without the required source proof');
      if(v.execution?.resourceState!=='closed'||!row?.result)return false;
      const r=row.result;check(r.value.predecessorRunId===receipt.task.runId,'member did not consume actual predecessor');
      check(r.value.revision1.trim()===receipt.texts[0].trim()&&r.value.revision2.trim()===receipt.texts[1].trim(),'member did not consume both original versions');
      return r;
    });
    const prepared=await store.effectFact(result.identity.effectId,'prepared');
    check(prepared?.runtime==='pi'&&prepared.identity.runId===next.currentRunId,'result lacks exact new Pi effect');
    const created=await store.externalEffectFact(prepared.identity,'oar:native-session');
    check(created?.nativeSession&&created.nativeSession!==receipt.native.created.nativeSession,'post-exit must honestly use new native session, not assert same-session resume');
    // Use the real runner request UUID/durable reply join (#107 receipt helper).
    // Native tool_call_started IDs are different and must not be used as this join key.
    const replies=Object.entries(await store.listExternalEffectFacts(prepared.identity,'oar:tool-reply:'))
      .map(([phase,value])=>({...value as object,callId:phase.slice('oar:tool-reply:'.length)})) as Json[];
    const calls:Json[]=[];
    check(inside(c.restoredHome,await realpath(created.controlDirectory)),'new native request directory is outside restored Home');
    for(const reply of replies) {
      check(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(reply.callId),'invalid native request UUID');
      const file=path.join(created.controlDirectory,'native/requests',reply.callId+'.json'),info=await lstat(file);
      check(info.isFile()&&!info.isSymbolicLink()&&info.size<=16_384,'invalid native request receipt file');
      const body=JSON.parse(await readFile(file,'utf8'));check(body.id===reply.callId,'native request UUID/body mismatch');calls.push({...body,callId:reply.callId});
      check(calls.length<=64,'source receipt bound exceeded');
    }
    for(const stage of receipt.stages)check(calls.some(call=>call.action==='read-material'&&call.request?.stageId===stage.stageId&&replies.some(reply=>reply.callId===call.callId&&reply.ok===true&&reply.value?.material?.sha256===stage.material.sha256)),'no actual native Host material receipt for restored revision');
    check(calls.some(call=>call.action==='query-memory'&&replies.some(reply=>reply.callId===call.callId&&reply.ok===true&&Array.isArray(reply.value?.records)&&!reply.value.records.some((v:Json)=>v.record.memoryId===receipt.memory.memoryId))),'native did not observe disabled-memory exclusion');
    const afterStatus=await memory('status',{page:{limit:50},reconcile:false});check(afterStatus.records?.find((v:Json)=>v.record.memoryId===receipt.memory.memoryId)?.tip.state==='disabled','completion re-adopted disabled memory');
    const nativeClosed=await store.externalEffectFact(prepared.identity,'oar:closed');
    const resources=await store.effectResources(prepared.identity.effectId);
    check(nativeClosed?.absent===true&&resources.length>0&&resources.every((r:Json)=>r.released),'restored native resource closure unproved');
    await json(path.join(c.proofRoot,'resource-proof.json'),{source:receipt.native.closed,restored:nativeClosed,
      restoredResources:resources.map((r:Json)=>({effectId:r.effectId,released:r.released,proof:r.proof})),note:'Outer watcher must additionally reconcile actual owned PID/birth tree.'});
    await json(path.join(c.proofRoot,'restore-result.json'),{scope:'one actual Pi source wait/cold restore/post-exit reconstruction',originalRunId:receipt.task.runId,currentRunId:next.currentRunId,
      oldNativeSession:receipt.native.created.nativeSession,newNativeSession:created.nativeSession,continuityKind:'post-exit-new-run-reconstruction',checkpointSha256:checkpoint.sha256,
      originalCwd:checkpoint.origin.cwd,defaultCounts:stable,predecessorContextSha256:context.sha256,result,materialReceipts:calls.filter(call=>['read-material','read-excerpt','query-memory'].includes(call.action)).map(call=>({callId:call.callId,action:call.action,stageId:call.request?.stageId})),
      disabledMemoryId:receipt.memory.memoryId,productModelRequests:'not independently measured; real pre/post DeepSeek Flash phases ran',userPersonallyClicked:false});
    await closeHost(c,host,svc);host=undefined;
    check(!await exists(path.join(c.restoredHome,'hima/database/data/postmaster.pid')),'restored PG PID receipt remains');
  }catch(error){primary=error;throw error;}finally{if(host)try{await host.dispose();if(svc?.resourcesClosing)await svc.resourcesClosing;}catch(error){await json(path.join(c.proofRoot,'restore-cleanup-error.json'),{error:safe(error)});if(primary===undefined)throw error;}}
}
async function sourceFinalCounts(c:NativeRestoreConfig) {
  // Exact source counter snapshot is taken after the real exit fence/readiness,
  // immediately before finishExit closes pools. No fake qualified state or PG writes.
  return JSON.parse(await readFile(path.join(c.proofRoot,'source-receipt.json'),'utf8')).finalCounts;
}
async function child(c:NativeRestoreConfig,configFile:string,phase:'source'|'restored') {
  const script=fileURLToPath(import.meta.url),p=spawn(process.execPath,[script,'--run-issue108-native-restore','--config',configFile,'--phase',phase],{env:process.env,stdio:['ignore','pipe','pipe','ipc']});
  let tail='';p.stdout!.resume();p.stderr!.on('data',data=>{tail=(tail+String(data)).slice(-8000);});
  const code=await new Promise<number|null>((resolve,reject)=>{p.once('error',reject);p.once('close',resolve);});
  if(code!==0){await json(path.join(c.proofRoot,phase+'-child-error.json'),{exitCode:code,error:safe(tail)});throw new Error('Issue108 native restore blocker: '+phase+' child failed; original Home and bounded error retained');}
  check(p.pid!==undefined,'missing actual Host PID');
  // No signal to persisted/arbitrary PIDs. A completed child process handle is the boundary.
  await json(path.join(c.proofRoot,phase+'-process-closed.json'),{pid:p.pid,exitCode:code});
}
async function parent(c:NativeRestoreConfig,configFile:string) {
  await mkdir(c.proofRoot,{recursive:true,mode:0o700});
  const info=await lstat(c.proofRoot);check(info.isDirectory()&&!info.isSymbolicLink()&&(info.mode&0o077)===0,'proofRoot must be private and plain');
  await writeFile(path.join(c.proofRoot,'issue108-native-owner.json'),JSON.stringify({schema:c.schema,expectedApplicationVersion:c.expectedApplicationVersion,configSha256:hash(JSON.stringify(c))}),{mode:0o600,flag:'wx'});
  for(const p of [c.sourceHome,c.restoredHome,c.sourceUnavailable,c.workspace,c.workspaceUnavailable,c.lineageDirectory,c.backupDirectory])check(!await exists(p),'fresh fixture path already exists; preserve it');
  await mkdir(c.lineageDirectory,{mode:0o700});
  await child(c,configFile,'source');
  const receipt=JSON.parse(await readFile(path.join(c.proofRoot,'source-receipt.json'),'utf8'));check(receipt.finalCounts,'missing actual final source counts');
  const api=await load(c,'run-backup'),options={home:c.sourceHome,targetHome:c.restoredHome,destination:c.backupDirectory,runtimeDirectory:c.postgresRuntime,
    distribution:{root:c.distributionRoot,manifestFile:c.distributionManifest,harnessRoot:c.frozenHarness}};
  const archive=await api.retireSource(options);check(archive.manifest.format==='hima-cold-backup/2','not a complete service cut /2');
  await json(path.join(c.proofRoot,'archive-receipt.json'),{backup:archive.backup,manifestSha256:archive.manifestSha256,identity:archive.manifest.identity,applicationVersion:archive.manifest.applicationVersion,
    cut:archive.manifest.maintenanceCut,warning:'Complete backup/private source may include credentials and engineering data; not a public artifact'});
  await rename(c.sourceHome,c.sourceUnavailable);await rename(c.workspace,c.workspaceUnavailable);
  check(!await exists(c.sourceHome)&&!await exists(c.workspace),'fresh source loss did not occur');
  await api.restoreColdBackup({backup:c.backupDirectory,newHome:c.restoredHome});
  check(await exists(path.join(c.restoredHome,'hima/restore-hold.json')),'held marker missing');
  const gate=await load(c,'local-database');let refused=false;try{await gate.assertHomeExecutionAllowed({home:c.restoredHome});}catch{refused=true;}check(refused,'held Home allowed execution');
  const qualified=await api.qualifyHeldRestore({newHome:c.restoredHome,retiredBackup:c.backupDirectory,harnessRoot:c.frozenHarness});
  check(qualified.state==='qualified','actual qualifier did not succeed');
  const lineage=JSON.parse(await readFile(path.join(c.restoredHome,'hima/restore-lineage.json'),'utf8'));
  const binding=lineage.memberRoots?.[receipt.native.lease.sessionKey];check(binding?.root===path.dirname(receipt.native.lease.controlDirectory),'actual qualifier did not generate original-root binding');
  check(!await exists(path.join(c.sourceHome,'hima/database/data')),'qualification recreated runnable old source');
  await json(path.join(c.proofRoot,'qualification-receipt.json'),{qualified,generatedLineage:lineage,sourceUnavailable:c.sourceUnavailable,workspaceUnavailable:c.workspaceUnavailable});
  await child(c,configFile,'restored');
  check((await api.inspectColdBackup(c.backupDirectory)).manifestSha256===archive.manifestSha256,'original backup was altered');
  check(!await exists(path.join(c.restoredHome,'hima/database/data/postmaster.pid')),'restored database is still live');
  await json(path.join(c.proofRoot,'result.json'),{result:'PASS',scope:'actual one-Pi /2 source loss, real qualification mapping, default zero business and explicit post-exit reconstruction',
    backup:c.backupDirectory,manifestSha256:archive.manifestSha256,applicationVersion:c.expectedApplicationVersion,productModelCalls:'real Flash pre/post; count not independently measured',
    retainedSensitiveEvidence:true,resourceScope:'external I watcher owns total-tree memory, deadline and final PID reconciliation'});
}
export async function runIssue108NativeRestore(configFile:string,phase?:string) {
  admission();const c=await config(configFile);environment(c);await frozen(c);
  try {
    if(phase==='source')await source(c);
    else if(phase==='restored')await restored(c);
    else {check(phase===undefined,'unknown phase');await parent(c,configFile);}
  }catch(error){
    if(await exists(c.proofRoot))await json(path.join(c.proofRoot,'failure-'+(phase??'parent')+'.json'),{error:safe(error),scope:'failed or blocked; no business success substituted',productModelRequests:'unknown',evidenceRetained:true});
    throw error;
  }
}
if(process.argv.includes('--run-issue108-native-restore')) {
  const at=process.argv.indexOf('--config'),phaseAt=process.argv.indexOf('--phase');
  try {
    admission();check(at>=0&&!!process.argv[at+1],'--config path required');
    await runIssue108NativeRestore(path.resolve(process.argv[at+1]!),phaseAt<0?undefined:process.argv[phaseAt+1]);
    if(process.connected)process.disconnect();process.exit(0); // only after ordered closers + PID-file assertions
  }catch(error){process.stderr.write(safe(error)+'\n');if(process.connected)process.disconnect();process.exit(1);}
}
