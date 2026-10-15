/** Offline cold copies only. DBOS recovery is never launched to inspect a held import. */
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, cp, lstat, mkdir, open, readFile, readdir, readlink, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { assertHomeExecutionAllowed, canonicalHome, claimDatabaseLineage, readDatabaseLineage, writeDatabaseLineage, localLineageDirectory as localAuthorityDirectory, POSTGRES_VERSION } from './local-database.js';
import type { HostExitStatus } from './host-exit.js';
import type { TeamServiceReceipt, TeamServiceRuntime } from './team-service-runtime.js';
import type { LocalDatabaseConnection } from './local-database.js';
import type { PoolClient } from 'pg';
export { assertHomeExecutionAllowed, resolveRetainedMaterialsDirectory } from './local-database.js';

type Entry = { kind:'directory'|'file'|'symlink'; mode:number; sha256?:string; target?:string };
type Root = { original:string; kind:'home'|'distribution'|'runtime'|'material'; entries:Record<string,Entry> };
interface Authority { format:'hima-cold-authority/1'; identity:string; controlSha256:string; closedAt:string; host:{pid:number;processIdentity:string}; postmaster:{pid:number}; application:Record<string,unknown[]>; system:Record<string,unknown[]> }
export interface ColdMaintenanceCut {
  format:'hima-cold-cut/1'; identity:string; cutId:string; host:Authority['host'];
  boundary:HostExitStatus; startedAt:string; completedAt:string;
  serviceReadFence?:{database:'hima_hindsight';tables:string[];kind:'share-locks-through-stop'};
  services:TeamServiceReceipt[];
}
export interface ColdBackupManifest { format:'hima-cold-backup/1'|'hima-cold-backup/2'; sourceHome:string; identity:string; platform:string; postgresVersion:string; runtimeDigest:string; applicationVersion:string; retainedMaterialsDir:string; roots:Root[]; authority:Authority; distributionDigest:string; maintenanceCut?:ColdMaintenanceCut }
export interface CompleteBackup { backup:string; manifestSha256:string; manifest:ColdBackupManifest }
export interface ColdBackupOptions { home:string; destination:string; runtimeDirectory:string; distribution:{root:string;manifestFile:string;harnessRoot:string} }
export interface RetainedMemberRoot { root:string; leaseSha256:string; configurationSha256:string }
/** Offline admin never provisions a replacement database or consults model configuration. */
export async function readColdHindsightConnection(options:{home:string;application:Pick<LocalDatabaseConnection,'host'|'port'>}):Promise<LocalDatabaseConnection> {
  const home=await canonicalHome(options.home),file=path.join(home,'hima/database/hindsight-credentials.json');
  if(!await exists(file))fail('original Hindsight credentials are missing; maintenance will not initialize a service database');
  await plain(file);const info=await lstat(file),service=JSON.parse(await readFile(file,'utf8')) as {password?:string};
  const password=service.password;
  if((info.mode&0o077)!==0||typeof password!=='string'||!/^[a-f0-9]{64}$/.test(password)||options.application.host!=='127.0.0.1'
    ||!Number.isSafeInteger(options.application.port)||options.application.port<1024||options.application.port>65535)return fail('original private Hindsight connection is invalid');
  return {host:'127.0.0.1',port:options.application.port,user:'hima_hindsight',database:'hima_hindsight',password};
}
const digest = (value:Uint8Array|string) => createHash('sha256').update(value).digest('hex');
async function fileDigest(file:string):Promise<string> {
  const hash=createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
const fail = (message:string):never => { throw new Error(`Cold backup: ${message}. Preserve the original/partial files; execution remains held.`); };
const inside = (root:string,file:string) => file===root || file.startsWith(root+path.sep);
const cutFile = (home:string) => path.join(home,'hima/database/maintenance-cut.json');
function canonical(value:unknown):string {
  if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;
  if(value && typeof value==='object')return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical((value as Record<string,unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'undefined';
}
function closedBoundary(status:HostExitStatus):void {
  if(!status?.ready || !status.requestId || !['drain','stop-jobs','keep-jobs'].includes(status.mode??'') ||
    !Array.isArray(status.agents) || status.agents.length || !Array.isArray(status.runs) ||
    status.runs.some(run=>run.state!=='ready'||!Array.isArray(run.jobs)||run.jobs.length))fail('maintenance requires the actual fenced Host boundary with all members and Jobs closed');
}
async function verifiedExport(receipt:TeamServiceReceipt,cutId:string,home:string,file=receipt.export?.file):Promise<void> {
  const exported=receipt.export;
  if(receipt.operation!=='export'||!['running','stopped'].includes(receipt.state)||!exported||exported.cutId!==cutId||
    !/^[a-f0-9]{64}$/.test(exported.sha256)||!Number.isSafeInteger(exported.bytes)||exported.bytes<=0||
    !path.isAbsolute(exported.file)||!inside(path.join(home,'hima/team-service-exports',receipt.generation),exported.file)||!file)fail('service export is missing, interrupted, empty or belongs to another cut');
  await plain(file!);const info=await lstat(file!);
  if(info.size!==exported!.bytes||await fileDigest(file!)!==exported!.sha256)fail('service export byte count/hash differs');
}

/** Called by the ordered Host closer after admission/memory writes are fenced and joined.
 * SHARE locks let the existing online admin exporter read while blocking async service DML.
 * The same transaction holds those locks until the owned service really stops. No new service,
 * database, exporter or execution kernel is introduced. Cold consumers only read this receipt. */
export async function prepareColdMaintenanceCut(options:{home:string;status:()=>Promise<HostExitStatus>;
  services:Pick<TeamServiceRuntime,'status'|'export'|'stop'>;serviceDatabase:()=>Promise<LocalDatabaseConnection>}):Promise<ColdMaintenanceCut> {
  const home=await canonicalHome(options.home);
  // A new attempt invalidates an older cut even if this export or shutdown later fails.
  await rm(cutFile(home),{force:true});
  const boundary=await options.status();closedBoundary(boundary);
  const credentials=JSON.parse(await readFile(path.join(home,'hima/database/credentials.json'),'utf8')) as {identity:string};
  const host=JSON.parse(await readFile(path.join(home,'hima/database/host-owner/owner.json'),'utf8')) as Authority['host'];
  if(host.pid!==process.pid||!host.processIdentity)fail('maintenance is not owned by this Host');
  const cut:ColdMaintenanceCut={format:'hima-cold-cut/1',identity:credentials.identity,cutId:randomUUID(),host:{pid:host.pid,processIdentity:host.processIdentity},
    boundary,startedAt:new Date().toISOString(),completedAt:'',services:[]};
  const service=await options.services.status('hindsight');
  if(service.state==='running'||await exists(path.join(home,'hima/database/hindsight-credentials.json'))) {
    const connection=await options.serviceDatabase();
    if(connection.host!=='127.0.0.1'||connection.database!=='hima_hindsight')fail('service read cut requires the owned private Hindsight database');
    const {Pool}=await import('pg');const pool=new Pool({...connection,max:1,connectionTimeoutMillis:2000});
    let client:PoolClient|undefined;
    try {
      client=await pool.connect();
      await client.query('BEGIN');await client.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='10s'");
      const tables=(await client.query<{tablename:string}>("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(row=>row.tablename);
      if(service.state==='running'&&!tables.length||tables.some(table=>!/^[a-z_][a-z0-9_]*$/.test(table)))fail('service read cut has no recognized public table inventory');
      if(tables.length)await client.query(`LOCK TABLE ${tables.map(table=>`public."${table}"`).join(',')} IN SHARE MODE`);
      // An already stopped service must export through its same fixed admin CLI without
      // starting its worker (which could revive queued memory/model operations).
      const request={cutId:cut.cutId,destination:`${cut.cutId}.zip`,maintenance:true};
      const exported=await options.services.export('hindsight',request);
      if(exported.generation!==service.generation)fail('service generation changed during export');
      await verifiedExport(exported,cut.cutId,home);
      const stopped=await options.services.stop('hindsight');
      if(stopped.generation!==service.generation||stopped.state!=='stopped'||!stopped.owned.quiescent)fail('service export generation has no actual stop proof');
      const after=(await client.query<{tablename:string}>("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(row=>row.tablename);
      if(canonical(tables)!==canonical(after))fail('service schema changed during maintenance');
      cut.serviceReadFence={database:'hima_hindsight',tables,kind:'share-locks-through-stop'};
      cut.services=[exported,stopped];await client.query('COMMIT');
    }catch(error){await client?.query('ROLLBACK').catch(()=>{});throw error;}
    finally{client?.release();await pool.end();}
  }else {
    if(service.state!=='unavailable'||service.diagnostic?.code!=='not-started'||!service.owned.quiescent)fail('the used service needs a fresh online export before shutdown; reconcile its generation first');
    cut.services=[service];
  }
  const after=await options.status();closedBoundary(after);
  if(canonical(after)!==canonical(boundary))fail('Host exit boundary changed during maintenance');
  cut.completedAt=new Date().toISOString();
  const stage=`${cutFile(home)}.partial-${randomUUID()}`;
  await writeFile(stage,JSON.stringify(cut),{mode:0o600,flag:'wx'});await syncFile(stage);
  await rename(stage,cutFile(home));await syncFile(path.dirname(stage));return cut;
}

async function verifyMaintenanceCut(cut:ColdMaintenanceCut,authority:Authority,home:string,resolve:(file:string)=>string):Promise<void> {
  if(cut?.format!=='hima-cold-cut/1'||!cut.cutId||cut.identity!==authority.identity||canonical(cut.host)!==canonical(authority.host)||!Array.isArray(cut.services)||!cut.services.length)fail('maintenance cut does not match the stopped Host authority');
  closedBoundary(cut.boundary);
  for(const table of ['teams','team_versions','team_members','team_tasks','task_actor_grants','team_attachments','team_messages','team_message_deliveries',
    'team_delivery_attempts','team_material_links','team_memory_records','team_memory_events','team_memory_index_operations','team_delegations','team_waits',
    'team_effect_continuations','team_human_requests','team_continuation_requests','team_pack_delegations','team_definition_handoffs',
    'effects','effect_leases','results','commands','flow_facts','flow_invocations','flow_branch_controls'])if(!Array.isArray(authority.application[table]))fail(`complete Team authority is missing table ${table}`);
  const start=Date.parse(cut.startedAt),end=Date.parse(cut.completedAt),closed=Date.parse(authority.closedAt);
  if(!Number.isFinite(start)||!Number.isFinite(end)||!Number.isFinite(closed)||start>end||end>closed)fail('maintenance cut is stale or incomplete');
  const gate=authority.application.host_exit as {singleton:boolean;active_request:string;finalizing:boolean}[]|undefined;
  const requests=authority.application.host_exit_requests as {request_id:string;mode:string;released_at:unknown;accepted_at:string}[]|undefined;
  const request=requests?.find(row=>row.request_id===cut.boundary.requestId);
  if(gate?.length!==1||gate[0]!.active_request!==cut.boundary.requestId||gate[0]!.finalizing!==true||!request||request.released_at!==null||
    request.mode!==cut.boundary.mode||!Number.isFinite(Date.parse(request.accepted_at))||Date.parse(request.accepted_at)>start)fail('maintenance cut has no surviving finalizing admission fence');
  const rows=authority.application.team_service_receipts as {seq:string|number;receipt:TeamServiceReceipt;digest:string}[]|undefined;
  if(!rows)fail('service receipt authority is missing');
  const ordered=[...rows!].sort((a,b)=>Number(a.seq)-Number(b.seq));
  const latest=new Map<string,TeamServiceReceipt>();
  for(const row of ordered){
    if(!row.receipt||digest(canonical(row.receipt))!==row.digest)fail('service receipt authority hash differs');
    latest.set(`${row.receipt.serviceId}:${row.receipt.generation}`,row.receipt);
  }
  for(const receipt of latest.values())if(!receipt.owned.quiescent)fail('a service generation has no physical closure proof');
  for(const receipt of cut.services) {
    if(receipt.schema!=='hima-team-service-receipt/1'||receipt.serviceId!=='hindsight')fail('unrecognized service cut identity');
    const position=ordered.findIndex(row=>row.receipt.receiptId===receipt.receiptId&&canonical(row.receipt)===canonical(receipt));
    const at=Date.parse(receipt.recordedAt);
    if(position<0||!Number.isFinite(at)||at<start||at>end)fail('service cut receipt is missing or stale in database authority');
    if(receipt.operation==='export') {
      if(receipt.serviceId!=='hindsight'||cut.serviceReadFence?.database!=='hima_hindsight'||cut.serviceReadFence.kind!=='share-locks-through-stop'||!Array.isArray(cut.serviceReadFence.tables)||receipt.state==='running'&&!cut.serviceReadFence.tables.length)fail('service export has no read fence through shutdown');
      await verifiedExport(receipt,cut.cutId,home,resolve(receipt.export?.file??''));
      const stop=cut.services.find(candidate=>candidate.serviceId===receipt.serviceId&&candidate.generation===receipt.generation&&candidate.operation==='stop'&&candidate.state==='stopped'&&candidate.owned.quiescent);
      if(!stop||ordered.findIndex(row=>row.receipt.receiptId===stop.receiptId)<=position||Date.parse(stop.recordedAt)<at)fail('service export has no same-generation stop after its cut');
    }else if(receipt.operation!=='stop'&&(receipt.operation!=='status'||receipt.state!=='unavailable'||receipt.diagnostic?.code!=='not-started'||!receipt.owned.quiescent))fail('unrecognized service cut receipt');
  }
  const hindsight=[...latest.values()].filter(receipt=>receipt.serviceId==='hindsight'&&receipt.diagnostic?.code!=='not-started');
  if(hindsight.length && cut.services.filter(receipt=>receipt.operation==='export'&&receipt.serviceId==='hindsight').length!==1)fail('used Hindsight data has no complete fresh export');
  const newest=ordered.findLast(row=>row.receipt.serviceId==='hindsight')?.receipt;
  if(newest&&hindsight.length&&!cut.services.some(receipt=>receipt.operation==='export'&&receipt.generation===newest.generation))fail('service export generation is stale');
}
async function exists(file:string):Promise<boolean> { try{await lstat(file);return true;}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error;} }
async function plain(file:string,directory=false):Promise<void> {
  const info=await lstat(file);
  if(info.isSymbolicLink() || (directory?!info.isDirectory():!info.isFile()) || process.getuid && info.uid!==process.getuid()) fail(`unsafe owned path ${file}`);
}
async function ancestors(file:string):Promise<void> {
  for(let at=path.dirname(file);at!==path.dirname(at);at=path.dirname(at)) {
    if(!await exists(at))continue;
    const info=await lstat(at);
    if(!info.isDirectory() || info.isSymbolicLink() || process.getuid && info.uid!==process.getuid() && info.uid!==0) fail(`unsafe original-path ancestor ${at}`);
  }
}
/** Resolve original native material after whole-Home import. Lease/config/DB/checkpoint paths
 * stay unchanged; only this reader lookup follows the existing qualified lineage receipt. */
export async function resolveRetainedMemberRoot(options:{home:string;sessionKey:string}):Promise<string> {
  const key=options.sessionKey;if(!/^[a-zA-Z0-9_-]{1,200}$/.test(key))fail('invalid native member session key');
  const home=await canonicalHome(options.home),local=path.join(home,'hima/oar-members',key);
  if(await exists(path.join(home,'hima/restore-hold.json')))fail('native member material remains held until final retirement qualification');
  const file=path.join(home,'hima/restore-lineage.json');
  if(!await exists(file))return local;
  await assertHomeExecutionAllowed({home});await plain(file);
  const receipt=JSON.parse(await readFile(file,'utf8')) as {identity:string;memberRoots?:Record<string,RetainedMemberRoot>};
  const binding=receipt.memberRoots&&Object.hasOwn(receipt.memberRoots,key)?receipt.memberRoots[key]:undefined;
  if(!binding) {
    const lease=path.join(local,'lease.json');
    if(await exists(lease)) {
      await plain(lease);const value=JSON.parse(await readFile(lease,'utf8')) as {controlDirectory:string};
      if(value.controlDirectory!==path.join(local,'control'))fail(`native member ${key} has no qualified original-root binding`);
    }
    return local;
  }
  if(typeof binding.root!=='string')fail(`native member ${key} has an invalid qualified original-root binding`);
  const originalHome=path.dirname(path.dirname(path.dirname(binding.root))),lineage=await readDatabaseLineage(receipt.identity);
  if(!path.isAbsolute(binding.root)||binding.root!==path.join(originalHome,'hima/oar-members',key)||!lineage.retiredHomes.includes(originalHome)
    ||!/^[a-f0-9]{64}$/.test(binding.leaseSha256)||!/^[a-f0-9]{64}$/.test(binding.configurationSha256))fail(`native member ${key} root is not a retired lineage material`);
  await ancestors(binding.root);await plain(binding.root,true);await plain(path.join(binding.root,'control'),true);
  const lease=path.join(binding.root,'lease.json'),config=path.join(binding.root,'control/config.json');await plain(lease);await plain(config);
  if(await fileDigest(lease)!==binding.leaseSha256||await fileDigest(config)!==binding.configurationSha256)fail(`native member ${key} original lease/config bytes differ`);
  return binding.root;
}

/** Immutable archive plan. No target/native file is rewritten to make a path guard pass. */
async function archivedMemberRoots(archive:CompleteBackup):Promise<Record<string,RetainedMemberRoot>> {
  const bindings:Record<string,RetainedMemberRoot>=Object.create(null);
  const archived=(original:string):{file:string;entry:Entry}=>{
    for(let index=0;index<archive.manifest.roots.length;index++) {
      const root=archive.manifest.roots[index]!;if(!inside(root.original,original))continue;
      const relative=path.relative(root.original,original),entry=root.entries[relative];
      if(entry?.kind==='file')return {file:path.join(archive.backup,'payload',String(index),relative),entry};
    }
    return fail(`native member original material is missing from archive ${original}`);
  };
  for(let index=0;index<archive.manifest.roots.length;index++) {
    const root=archive.manifest.roots[index]!;
    for(const [relative,entry]of Object.entries(root.entries)) {
      const original=path.join(root.original,relative),match=/\/hima\/oar-members\/([a-zA-Z0-9_-]{1,200})\/lease\.json$/.exec(original);
      if(!match||entry.kind!=='file')continue;
      const key=match[1]!,lease=JSON.parse(await readFile(path.join(archive.backup,'payload',String(index),relative),'utf8'));
      if(lease.sessionKey!==key||typeof lease.controlDirectory!=='string'||!path.isAbsolute(lease.controlDirectory)||path.basename(lease.controlDirectory)!=='control')fail(`native member ${key} has unsupported original path bindings`);
      const memberRoot=path.dirname(lease.controlDirectory),originalHome=path.dirname(path.dirname(path.dirname(memberRoot)));
      if(memberRoot!==path.join(originalHome,'hima/oar-members',key))fail(`native member ${key} root escapes its original Home`);
      const heldLease=archived(path.join(memberRoot,'lease.json')),configuration=archived(path.join(memberRoot,'control/config.json'));
      if(heldLease.entry.sha256!==entry.sha256)fail(`native member ${key} has conflicting retained lease copies`);
      const config=JSON.parse(await readFile(configuration.file,'utf8')),prepared=config.prepared;
      if(prepared?.sessionKey!==key||prepared.generation!==lease.generation||prepared.memberId!==lease.memberId||!prepared.identity?.effectId
        ||config.controlDirectory!==lease.controlDirectory||config.workDirectory!==lease.workDirectory
        ||!config.continuity&&lease.workDirectory!==path.join(memberRoot,'work'))fail(`native member ${key} config/lease identity or cwd differs`);
      // Keep the same original effect and closure authority; no checkpoint/fact remapping.
      const facts=archive.manifest.authority.application.effect_facts as {effect_id:string;phase:string;fact:Record<string,unknown>}[]|undefined;
      const originalLease=facts?.find(row=>row.effect_id===prepared.identity.effectId&&row.phase==='native:oar:local-lease')?.fact;
      const closed=facts?.find(row=>row.effect_id===prepared.identity.effectId&&row.phase==='native:oar:closed')?.fact;
      if(!originalLease||!closed||!['sessionKey','generation','memberId','controlDirectory','workDirectory'].every(name=>originalLease[name]===lease[name])
        ||(lease.pid?closed.absent!==true||closed.group!==lease.processGroup:closed.neverStarted!==true))fail(`native member ${key} lacks matching original effect/closure authority`);
      if(lease.pid) {
        if(!Number.isSafeInteger(lease.pid)||lease.pid<2||!Number.isSafeInteger(lease.processGroup)||lease.processGroup<2||alive(lease.pid))fail(`native member ${key} original PID closure is unproved`);
        const group=spawnSync('/bin/kill',['-0',`-${lease.processGroup}`],{encoding:'utf8'});
        if(group.error||group.status!==1)fail(`native member ${key} original process-group closure is unproved`);
      }
      const binding={root:memberRoot,leaseSha256:heldLease.entry.sha256!,configurationSha256:configuration.entry.sha256!};
      if(bindings[key]&&canonical(bindings[key])!==canonical(binding))fail(`native member ${key} has ambiguous original roots`);
      bindings[key]=binding;
    }
  }
  return bindings;
}
async function inventory(root:string,allowed:readonly string[],logicalRoot=root):Promise<Record<string,Entry>> {
  await plain(root,true); const entries:Record<string,Entry>={};
  async function visit(relative:string):Promise<void> {
    const at=path.join(root,relative);const info=await lstat(at);const mode=info.mode&0o777;
    if(info.isSymbolicLink()) {
      const target=await readlink(at);const resolved=path.resolve(path.dirname(path.join(logicalRoot,relative)),target);
      if(logicalRoot===root)await realpath(at).catch(()=>fail(`missing symlink target ${at}`));
      if(!allowed.some(base=>inside(base,resolved)))fail(`symlink escapes retained closure ${at}`);
      entries[relative]={kind:'symlink',mode,target};
    } else if(info.isDirectory()) {
      entries[relative]={kind:'directory',mode};
      for(const name of (await readdir(at)).sort())await visit(relative?path.posix.join(relative,name):name);
    } else if(info.isFile())entries[relative]={kind:'file',mode,sha256:await fileDigest(at)};
    else fail(`special file is not a cold material ${at}`);
  }
  await visit('');return entries;
}
function alive(pid:number):boolean { if(!Number.isSafeInteger(pid)||pid<2)return false;try{process.kill(pid,0);return true;}catch(error){return (error as NodeJS.ErrnoException).code!=='ESRCH';} }
function walk(value:unknown,visit:(object:Record<string,unknown>)=>void):void {
  if(typeof value==='string' && /^[\[{]/.test(value)) { let parsed:unknown;try{parsed=JSON.parse(value);}catch{return;}walk(parsed,visit);return; }
  if(value && typeof value==='object') { if(!Array.isArray(value))visit(value as Record<string,unknown>);for(const child of Object.values(value))walk(child,visit); }
}
function retainedPath(key:string,value:unknown):value is string { return typeof value==='string' && path.isAbsolute(value) && /^(workspace|cwd|dir|retainedPackDir|path|file|.*Path|.*Dir|.*Directory|.*Root)$/.test(key); }
async function closure(home:string,authority:Authority):Promise<string[]> {
  const paths=new Set<string>(); const missing:string[]=[];
  // Frozen methods, bindings, retained observations, native cwd/revisions, Job wrappers and receipts.
  walk(authority,(object)=>{
    if(object.bindings && typeof object.bindings==='object')for(const value of Object.values(object.bindings))if(typeof value==='string'&&path.isAbsolute(value))paths.add(value);
    for(const [key,value]of Object.entries(object)) {
      if(retainedPath(key,value))paths.add(value);
      if((key==='channel'||key==='transport'||key==='kind') && value==='ssh')missing.push('remote Site reference requires retained original bytes');
    }
  });
  // Native session exports/history are Home material. Discover their original path bindings too.
  async function jsonFiles(directory:string):Promise<void> {
    if(!await exists(directory))return;
    for(const entry of await readdir(directory,{withFileTypes:true})) {
      const file=path.join(directory,entry.name);
      if(entry.isDirectory())await jsonFiles(file);
      else if(entry.isFile() && entry.name.endsWith('.json')) {
        let value:unknown;try{value=JSON.parse(await readFile(file,'utf8'));}catch{fail(`unrecognized retained JSON ${file}`);}
        walk(value,object=>{for(const [key,child]of Object.entries(object))if(retainedPath(key,child))paths.add(child);});
      }
    }
  }
  for(const directory of ['history','sessions','hima/run-assets'])await jsonFiles(path.join(home,directory));
  const members=path.join(home,'hima/oar-members');
  if(await exists(members)) {
    await plain(members,true);
    for(const entry of await readdir(members,{withFileTypes:true}))if(entry.isDirectory()&&await exists(path.join(members,entry.name,'lease.json'))) {
      const root=await resolveRetainedMemberRoot({home,sessionKey:entry.name});if(!inside(home,root))paths.add(root);
    }
  }
  if(missing.length)fail(missing.join('; '));
  const roots:string[]=[];
  for(const file of paths) {
    if(inside(home,file)) { if(!await exists(file))fail(`missing referenced material ${file}`);continue; }
    if(!await exists(file))fail(`missing referenced material ${file}`);
    await ancestors(file);const info=await lstat(file);await plain(file,info.isDirectory());
    roots.push(info.isDirectory()?file:path.dirname(file));
  }
  // Do not copy broad machine roots merely because an authority names one leaf.
  for(const root of roots)if(root==='/'||root==='/tmp'||root==='/Users'||root==='/home')fail(`unbounded material root ${root}`);
  return [...new Set(roots)].sort().filter((root,_i,all)=>!all.some(other=>other!==root&&inside(other,root)));
}
function effectJobs(authority:Authority):Map<string,Record<string,unknown>> {
  const leases=authority.application.effect_leases??[];
  for(const item of leases)if(!(item as {released_at?:string}).released_at)fail('external effect lease is not closed');
  const jobs=new Map<string,Record<string,unknown>>();
  walk(authority,object=>{if(typeof object.session==='string'&&typeof object.workspace==='string'&&typeof object.wire==='string')jobs.set(`${object.workspace}/${object.session}`,object);});
  for(const job of jobs.values())if(!/^hima-[A-Za-z0-9_-]+$/.test(String(job.session))||!path.isAbsolute(String(job.workspace)))fail('unrecognized original Job identity');
  // Native effects must have persisted closure in application authority; a session ID is not proof.
  for(const row of authority.application.effects??[]) {
    const effect=row as {effect_id:string;intent:unknown};let native=false;
    walk(effect.intent,object=>{if(typeof object.sessionId==='string'||typeof object.childSessionId==='string')native=true;});
    if(native && !leases.some(item=>(item as {effect_id:string;released_at?:string}).effect_id===effect.effect_id && (item as {released_at?:string}).released_at))fail(`native effect ${effect.effect_id} has no closed resource authority`);
  }
  return jobs;
}
/** Read physical liveness without requiring lost original receipt paths to exist. The archive
 * has already been fully inventoried; its PID identifies the same original process/group. */
async function verifyPhysicalJobs(authority:Authority,archive?:CompleteBackup):Promise<void> {
  for(const job of effectJobs(authority).values()) {
    const workspace=String(job.workspace),session=String(job.session),original=path.join(workspace,`${session}.pid`);
    let receipt=original;
    if(!await exists(original)&&archive) {
      const index=archive.manifest.roots.findIndex(root=>inside(root.original,original)&&root.entries[path.relative(root.original,original)]?.kind==='file');
      if(index<0)fail(`original Job ${session} has no retained PID receipt`);
      receipt=path.join(archive.backup,'payload',String(index),path.relative(archive.manifest.roots[index]!.original,original));
    }
    await plain(receipt);const pid=Number((await readFile(receipt,'utf8')).trim());
    if(!Number.isSafeInteger(pid)||pid<2||alive(pid))fail(`original Job ${session} is live or its closure is unknown`);
    const probe=spawnSync('tmux',['has-session','-t',`=${session}`],{encoding:'utf8'});
    if(probe.error||probe.status===0||probe.status!==1)fail(`original Job ${session} session closure is unknown`);
    const group=spawnSync('/bin/kill',['-0',`-${pid}`],{encoding:'utf8'});
    if(group.status===0)fail(`original Job ${session} process group is live`);
  }
}
async function verifyEffects(authority:Authority):Promise<string> {
  await verifyPhysicalJobs(authority);
  const proofs:unknown[]=[];
  for(const job of effectJobs(authority).values()) {
    const workspace=String(job.workspace),session=String(job.session);
    const at=(suffix:string)=>path.join(workspace,`${session}.${suffix}`);
    for(const suffix of ['log','exit','pid'])await plain(at(suffix));
    const exit=(await readFile(at('exit'),'utf8')).trim(),pid=Number((await readFile(at('pid'),'utf8')).trim());
    if(!/^-?\d+$/.test(exit))fail(`original Job ${session} is live or its closure is unknown`);
    proofs.push({session,workspace,wire:digest(String(job.wire)),exit:digest(await readFile(at('exit'))),log:digest(await readFile(at('log'))),pid});
  }
  return digest(JSON.stringify(proofs));
}
async function syncFile(file:string):Promise<void>{const handle=await open(file,'r');try{await handle.sync();}finally{await handle.close();}}
async function syncDirectories(root:string):Promise<void>{for(const entry of await readdir(root,{withFileTypes:true}))if(entry.isDirectory())await syncDirectories(path.join(root,entry.name));else if(entry.isFile())await syncFile(path.join(root,entry.name));await syncFile(root);}
async function publish(stage:string,destination:string):Promise<void>{if(await exists(destination))fail(`destination already exists ${destination}`);await syncDirectories(stage);await rename(stage,destination);await syncFile(path.dirname(destination));}
async function verifyRoot(root:Root,at:string,allowed:string[]):Promise<void>{if(JSON.stringify(await inventory(at,allowed,root.original))!==JSON.stringify(root.entries))fail(`copied inventory differs ${root.original}`);}
export async function inspectColdBackup(backup:string):Promise<CompleteBackup> {
  backup=await canonicalHome(backup);
  if(path.basename(backup).includes('.partial-'))fail('partial archive is not published');
  await plain(backup,true);const file=path.join(backup,'manifest.json');await plain(file);const bytes=await readFile(file);
  const manifest=JSON.parse(bytes.toString()) as ColdBackupManifest;
  if(!['hima-cold-backup/1','hima-cold-backup/2'].includes(manifest.format)||!Array.isArray(manifest.roots)||manifest.roots.filter(root=>root.kind==='home').length!==1||manifest.identity!==manifest.authority?.identity)fail('unrecognized complete manifest');
  for(const root of manifest.roots)if(!path.isAbsolute(root.original)||!root.entries||Object.keys(root.entries).some(file=>path.isAbsolute(file)||file.split('/').includes('..')))fail('invalid closure path');
  const homeRoot=manifest.roots.find(root=>root.kind==='home')!;
  if(homeRoot.original!==manifest.sourceHome || !path.isAbsolute(manifest.retainedMaterialsDir) || manifest.postgresVersion!==POSTGRES_VERSION
    || !/^hima-[a-f0-9]{64}$/.test(manifest.applicationVersion) || !/^[a-f0-9]{64}$/.test(manifest.runtimeDigest)
    || !manifest.roots.some(root=>root.kind==='distribution'))fail('manifest does not identify a complete original Home/cluster/distribution');
  for(const file of ['hima/database/data/PG_VERSION','hima/database/data/global/pg_control','hima/database/credentials.json','hima/database/backup-authority.json'])if(homeRoot.entries[file]?.kind!=='file')fail(`required whole-cluster authority is missing ${file}`);
  if(homeRoot.entries['hima/database/data/global/pg_control']?.sha256!==manifest.authority.controlSha256)fail('cluster control does not match stopped authority');
  const homePayload=path.join(backup,'payload',String(manifest.roots.indexOf(homeRoot)));
  const credentials=JSON.parse(await readFile(path.join(homePayload,'hima/database/credentials.json'),'utf8')) as {identity:string};
  const captured=JSON.parse(await readFile(path.join(homePayload,'hima/database/backup-authority.json'),'utf8'));
  if(credentials.identity!==manifest.identity||JSON.stringify(captured)!==JSON.stringify(manifest.authority))fail('private cluster identity/authority differs from manifest');
  const originals=manifest.roots.map(root=>root.original);
  for(let index=0;index<manifest.roots.length;index++)await verifyRoot(manifest.roots[index]!,path.join(backup,'payload',String(index)),originals);
  if(manifest.format==='hima-cold-backup/2') {
    const file=path.join(homePayload,'hima/database/maintenance-cut.json');await plain(file);
    const cut=JSON.parse(await readFile(file,'utf8')) as ColdMaintenanceCut;
    if(canonical(cut)!==canonical(manifest.maintenanceCut))fail('manifest service cut differs from retained Home');
    await verifyMaintenanceCut(cut,manifest.authority,manifest.sourceHome,original=>{
      if(!path.isAbsolute(original)||!inside(manifest.sourceHome,original))fail('service export is outside the retained Home');
      const relative=path.relative(manifest.sourceHome,original);
      if(homeRoot.entries[relative]?.kind!=='file')fail('service export is missing from the complete byte inventory');
      return path.join(homePayload,relative);
    });
  }
  return {backup,manifest,manifestSha256:digest(bytes)};
}
async function coldBackup(options:ColdBackupOptions,retireTarget?:string):Promise<CompleteBackup> {
  const destination=await canonicalHome(options.destination);
  const home=await canonicalHome(options.home);
  if(inside(home,destination)||inside(localAuthorityDirectory(),destination))fail('archive destination is inside the retained closure');
  const credentials=JSON.parse(await readFile(path.join(home,'hima/database/credentials.json'),'utf8')) as {identity:string};
  const release=await claimDatabaseLineage(credentials.identity);
  const stage=`${destination}.partial-${randomUUID()}`;
  try {
    const lineage=await readDatabaseLineage(credentials.identity);if(lineage.currentHome!==home)fail('source is not the current lineage owner');
    if(await exists(path.join(home,'hima/restore-hold.json')))fail('held import is not an authoritative source');
    const authority=JSON.parse(await readFile(path.join(home,'hima/database/backup-authority.json'),'utf8')) as Authority;
    if(authority.format!=='hima-cold-authority/1'||authority.identity!==credentials.identity||alive(authority.host.pid)||alive(authority.postmaster.pid))fail('source Host/postmaster has not exited');
    const data=path.join(home,'hima/database/data');if(await exists(path.join(data,'postmaster.pid')))fail('postmaster PID still exists');
    if(digest(await readFile(path.join(data,'global/pg_control')))!==authority.controlSha256)fail('stopped cluster differs from its authority cut');
    let maintenanceCut:ColdMaintenanceCut|undefined;
    if(await exists(cutFile(home))) {
      await plain(cutFile(home));maintenanceCut=JSON.parse(await readFile(cutFile(home),'utf8')) as ColdMaintenanceCut;
      await verifyMaintenanceCut(maintenanceCut,authority,home,file=>file);
    } else if(Object.entries(authority.application).some(([name,rows])=>(name.startsWith('team_')||name==='teams'||name==='task_actor_grants')&&rows.length))fail('Team data requires a fresh complete maintenance cut; reopen the matching App and finish its maintenance shutdown');
    const runtime=await realpath(options.runtimeDirectory);const runtimeBytes=await readFile(path.join(runtime,'postgres-runtime.json'));const native=JSON.parse(runtimeBytes.toString());
    if(native.version!==POSTGRES_VERSION||native.platform!==`${process.platform}-${process.arch}`)fail('incompatible PG/runtime platform');
    const control=spawnSync(path.join(runtime,'bin/pg_controldata'),[data],{encoding:'utf8',env:{...process.env,LC_ALL:'C'}});
    if(control.status!==0||!/^Database cluster state:\s+shut down\s*$/m.test(control.stdout))fail('PG cluster is not cleanly shut down');
    for(const [file,hash]of Object.entries(native.files as Record<string,string>)) {
      const at=path.join(runtime,file);const info=await lstat(at);const actual=info.isSymbolicLink()?`symlink:${await readlink(at)}`:digest(await readFile(at));
      if(actual!==hash)fail('pinned native runtime bytes changed');
    }
    const distribution=await realpath(options.distribution.root);const distributionBytes=await readFile(options.distribution.manifestFile);const distributed=JSON.parse(distributionBytes.toString());
    if(distributed.format!==2||distributed.status==='building'||!distributed.files||distributed.platform!==`${process.platform}-${process.arch}`||distributed.runtimeInputs?.dbosVersion!=='5.2.11'||distributed.runtimeInputs?.postgres?.version!==POSTGRES_VERSION||!distributed.runtimeInputs?.node||!distributed.runtimeInputs?.electron)fail('full frozen distribution inventory is missing');
    if(maintenanceCut&&!inside(distribution,await realpath(options.distribution.harnessRoot)))fail('the original executable must be retained inside the complete frozen distribution for a Team backup');
    const {installedExecutableManifest,executableApplicationVersion}=await import('./durable-runtime.js');
    const executable=await installedExecutableManifest(options.distribution.harnessRoot);const applicationVersion=executableApplicationVersion(executable);
    // Terminal history retains its original version. Only work that can still execute needs
    // this executable, using the same SDK compatibility states as normal Host startup.
    const resumable=(authority.system.workflow_status??[]).some(item=>{
      const row=item as {application_version:string;status:string};
      return ['PENDING','ENQUEUED','DELAYED'].includes(row.status)&&row.application_version!==applicationVersion;
    });
    const unfinished=(authority.application.runs??[]).some(item=>{
      const run=item as {run_id:string;application_version:string;revision:number};
      if(run.application_version===applicationVersion)return false;
      return !(authority.application.flow_facts??[]).some(item=>{
        const fact=item as {run_id:string;name:string;value:{state?:string}};
        return fact.run_id===run.run_id&&fact.name===`outcome:${run.revision}`&&
          ['succeeded','failed','cancelled'].includes(fact.value?.state??'');
      });
    });
    if(resumable||unfinished)fail('original executable applicationVersion differs');
    const materials=await closure(home,authority);if(!await exists(lineage.retainedMaterialsDir))fail('original retained material root is missing');
    if(!inside(home,lineage.retainedMaterialsDir))materials.push(lineage.retainedMaterialsDir);
    const roots:Array<{original:string;kind:Root['kind']}>= [{original:home,kind:'home'},{original:distribution,kind:'distribution'},...(!inside(distribution,runtime)?[{original:runtime,kind:'runtime' as const}]:[]),...materials.filter(file=>!inside(distribution,file)&&!inside(runtime,file)).map(original=>({original,kind:'material' as const}))];
    const allowed=roots.map(root=>root.original);
    if(allowed.some(root=>inside(root,destination))||inside(localAuthorityDirectory(),destination))fail('archive destination is inside the retained closure');
    const distributionEntries=await inventory(distribution,allowed);
    for(const [file,hash]of Object.entries(distributed.files as Record<string,string>)) {
      const entry=distributionEntries[file];if(!entry||(entry.kind==='symlink'?`symlink:${entry.target}`:entry.sha256)!==hash)fail(`distribution byte inventory differs ${file}`);
    }
    for(const [file,entry]of Object.entries(distributionEntries))if(entry.kind!=='directory'&&path.basename(file)!=='.DS_Store'&&!Object.hasOwn(distributed.files,file))fail(`distribution inventory omits actual bytes ${file}`);
    await verifyEffects(authority);
    await mkdir(stage,{mode:0o700});await mkdir(path.join(stage,'payload'),{mode:0o700});
    const frozen:Root[]=[];
    for(let index=0;index<roots.length;index++) {
      const root=roots[index]!;const entries=await inventory(root.original,allowed);const to=path.join(stage,'payload',String(index));
      await cp(root.original,to,{recursive:true,dereference:false,verbatimSymlinks:true,preserveTimestamps:true});
      await verifyRoot({...root,entries},root.original,allowed);await verifyRoot({...root,entries},to,allowed);frozen.push({...root,entries});
    }
    const manifest:ColdBackupManifest={format:maintenanceCut?'hima-cold-backup/2':'hima-cold-backup/1',sourceHome:home,identity:credentials.identity,platform:`${process.platform}-${process.arch}`,postgresVersion:POSTGRES_VERSION,runtimeDigest:digest(runtimeBytes),applicationVersion,retainedMaterialsDir:lineage.retainedMaterialsDir,roots:frozen,authority,distributionDigest:digest(distributionBytes),...(maintenanceCut?{maintenanceCut}:{})};
    const manifestFile=path.join(stage,'manifest.json');await writeFile(manifestFile,JSON.stringify(manifest),{mode:0o600,flag:'wx'});await syncFile(manifestFile);
    await publish(stage,destination);
    const complete=await inspectColdBackup(destination);
    if(retireTarget) {
      const target=await canonicalHome(retireTarget);
      if(target===home||inside(home,target)||inside(target,home)||inside(target,localAuthorityDirectory())||inside(localAuthorityDirectory(),target))fail('retirement target is not an independent Home');
      await writeDatabaseLineage({...lineage,epoch:lineage.epoch+1,currentHome:target,retiredHomes:[...new Set([...lineage.retiredHomes,home])],retiredManifest:complete.manifestSha256,activated:undefined});
    }
    return complete;
  } finally {await release();}
}

export const createColdBackup = (options:ColdBackupOptions):Promise<CompleteBackup> => coldBackup(options);
export const retireSource = (options:ColdBackupOptions & {targetHome:string}):Promise<CompleteBackup> => coldBackup(options,options.targetHome);

export interface HeldRestore { home:string; manifestSha256:string; state:'held'; previousHome?:string }
async function compatible(manifest:ColdBackupManifest):Promise<void> {
  if(manifest.platform!==`${process.platform}-${process.arch}`||manifest.postgresVersion!==POSTGRES_VERSION)fail('archive platform/PostgreSQL is incompatible');
}
export async function restoreColdBackup(options:{backup:string;newHome:string}):Promise<HeldRestore> {
  const archive=await inspectColdBackup(path.resolve(options.backup));await compatible(archive.manifest);
  const home=await canonicalHome(options.newHome);
  if(home===archive.manifest.sourceHome||archive.manifest.roots.some(root=>inside(root.original,home)||inside(home,root.original))||inside(archive.backup,home)||inside(home,archive.backup))fail('restore target is not an independent new Home');
  if(await exists(home))fail('restore target already exists');
  const stage=`${home}.partial-${randomUUID()}`;await mkdir(stage,{mode:0o700});await mkdir(path.join(stage,'hima'),{mode:0o700});
  const hold={format:'hima-restore-hold/1',manifest:archive.manifestSha256,backup:archive.backup,reason:'complete final source retirement and current original effect/path closure required'};
  await writeFile(path.join(stage,'hima/restore-hold.json'),JSON.stringify(hold),{mode:0o600,flag:'wx'});
  const index=archive.manifest.roots.findIndex(root=>root.kind==='home'),root=archive.manifest.roots[index]!;
  // Copy leaves so the gate exists before any imported session/profile is accessible.
  for(const [relative,entry]of Object.entries(root.entries)) {
    if(!relative)continue;const to=path.join(stage,relative),from=path.join(archive.backup,'payload',String(index),relative);
    if(relative==='hima/restore-hold.json'||relative==='hima/restore-lineage.json')continue;
    if(entry.kind==='directory')await mkdir(to,{recursive:true,mode:entry.mode});
    else if(entry.kind==='symlink')await symlink(entry.target!,to);
    else await cp(from,to,{preserveTimestamps:true});
    if(entry.kind!=='symlink')await chmod(to,entry.mode);
  }
  await writeFile(path.join(stage,'hima/restore-lineage.json'),JSON.stringify({format:'hima-restore-lineage/1',identity:archive.manifest.identity,manifest:archive.manifestSha256,qualified:false}),{mode:0o600});
  await publish(stage,home);return {home,manifestSha256:archive.manifestSha256,state:'held'};
}
async function restoreOriginalMaterials(archive:CompleteBackup,memberRoots:Record<string,RetainedMemberRoot>):Promise<string> {
  const {manifest}=archive;const roots:Array<{root:Root;from:string}>=[];
  for(let index=0;index<manifest.roots.length;index++) {
    const root=manifest.roots[index]!;const from=path.join(archive.backup,'payload',String(index));
    if(root.kind==='material')roots.push({root,from});
    if(root.kind==='home') {
      // Only material subtrees; never recreate the runnable old profile/database/session Home.
      for(const relative of ['hima/run-assets',...(manifest.format==='hima-cold-backup/2'?['hima/team-service-exports']:[]),...(Object.keys(memberRoots).length?['hima/oar-members']:[])]) {
        if(!root.entries[relative])continue;const selected:Record<string,Entry>={};
        for(const [file,entry]of Object.entries(root.entries))if(file===relative||file.startsWith(relative+'/'))selected[file===relative?'':file.slice(relative.length+1)]=entry;
        roots.push({root:{kind:'material',original:path.join(root.original,relative),entries:selected},from:path.join(from,relative)});
      }
    }
  }
  const allowed=manifest.roots.map(root=>root.original);
  for(const {root,from}of roots) {
    await ancestors(root.original);
    if(await exists(root.original))await verifyRoot(root,root.original,allowed);
    else {
      // Create missing owned plain ancestors; conflicts remain untouched.
      await mkdir(path.dirname(root.original),{recursive:true,mode:0o700});await ancestors(root.original);
      const stage=`${root.original}.partial-${randomUUID()}`;
      await cp(from,stage,{recursive:true,dereference:false,verbatimSymlinks:true,preserveTimestamps:true});
      await verifyRoot(root,stage,allowed);await publish(stage,root.original);
    }
  }
  const retained=roots.find(item=>inside(item.root.original,manifest.retainedMaterialsDir));
  if(!retained)fail('original retained root has no declared material inventory');
  await plain(manifest.retainedMaterialsDir,true);
  return digest(JSON.stringify(roots.map(item=>({original:item.root.original,entries:item.root.entries}))));
}
/** A newer archive replaces the entire held Home. No selected-table or checkpoint merging. */
export async function qualifyHeldRestore(options:{newHome:string;retiredBackup:string;harnessRoot:string}):Promise<{home:string;state:'qualified';manifestSha256:string;epoch:number;previousHome?:string}> {
  const home=await canonicalHome(options.newHome);await plain(path.join(home,'hima/restore-hold.json'));
  const prior=JSON.parse(await readFile(path.join(home,'hima/restore-lineage.json'),'utf8')) as {identity:string;manifest:string};
  const archive=await inspectColdBackup(path.resolve(options.retiredBackup));await compatible(archive.manifest);
  if(prior.identity!==archive.manifest.identity)fail('newer archive has a different lineage');
  const release=await claimDatabaseLineage(prior.identity);
  try {
    const lineage=await readDatabaseLineage(prior.identity);
    if(lineage.activated)fail('the target already activated this archive and may have newer database records; supply its new final source-retired archive');
    if(archive.manifest.retainedMaterialsDir!==lineage.retainedMaterialsDir||lineage.currentHome!==home||lineage.retiredManifest!==archive.manifestSha256||!lineage.retiredHomes.includes(archive.manifest.sourceHome))fail('no surviving final retirement authority for this exact full archive and target Home');
    const memberRoots=await archivedMemberRoots(archive);
    for(const [key,binding]of Object.entries(memberRoots))if(!lineage.retiredHomes.includes(path.dirname(path.dirname(path.dirname(binding.root)))))fail(`native member ${key} original Home has no surviving retirement authority`);
    const {installedExecutableManifest,executableApplicationVersion}=await import('./durable-runtime.js');
    if(executableApplicationVersion(await installedExecutableManifest(options.harnessRoot))!==archive.manifest.applicationVersion)fail('the original frozen executable is required');
    let nativeReader:{retainedMemberRootProtocol?:string;
      validateLocalMemberContinuity:typeof import('./oar-local-member.js')['validateLocalMemberContinuity'];
      verifyLocalNativeCheckpoint:typeof import('./oar-local-member.js')['verifyLocalNativeCheckpoint']}|undefined;
    if(Object.keys(memberRoots).length) {
      // Inspect the exact frozen reader, not whichever maintenance package invoked us.
      // Older readers cannot consume this binding: do not qualify an unusable native import.
      nativeReader=await import(pathToFileURL(path.join(options.harnessRoot,'lib/oar-local-member.js')).href);
      if(nativeReader?.retainedMemberRootProtocol!=='hima-native-original-roots/1')fail('the frozen native reader does not support original-root restoration');
    }
    await verifyPhysicalJobs(archive.manifest.authority,archive);
    const pathDigest=await restoreOriginalMaterials(archive,memberRoots);
    if(nativeReader) {
      const {validateLocalMemberContinuity,verifyLocalNativeCheckpoint}=nativeReader;
      for(const [key,binding]of Object.entries(memberRoots)) {
        const lease=JSON.parse(await readFile(path.join(binding.root,'lease.json'),'utf8'));
        const config=JSON.parse(await readFile(path.join(binding.root,'control/config.json'),'utf8'));
        if(!archive.manifest.roots.some(root=>inside(root.original,lease.workDirectory)&&root.entries[path.relative(root.original,lease.workDirectory)]?.kind==='directory'))fail(`native member ${key} original cwd is not retained in the archive`);
        await plain(lease.workDirectory,true);
        validateLocalMemberContinuity(config,lease.controlDirectory,lease.workDirectory);
        if(config.continuity?.kind==='native-resume') {
          const previous=memberRoots[config.continuity.checkpoint.origin.sessionKey];
          if(!previous)return fail(`native member ${key} predecessor checkpoint root is not retained`);
          verifyLocalNativeCheckpoint(path.join(previous.root,'control'),config.continuity.checkpoint);
        }
      }
    }
    const effectDigest=await verifyEffects(archive.manifest.authority);
    let previousHome:string|undefined;
    {
      // Qualification always imports the entire verified final cut, even for the same digest.
      // A held Home may have damaged bytes; its marker is never a completeness assertion.
      const replacement=`${home}.replacement-${randomUUID()}`;
      await restoreColdBackup({backup:archive.backup,newHome:replacement});
      previousHome=`${home}.previous-${randomUUID()}`;await rename(home,previousHome);await rename(replacement,home);await syncFile(path.dirname(home));
    }
    const receipt={format:'hima-restore-lineage/1',identity:prior.identity,manifest:archive.manifestSha256,epoch:lineage.epoch,qualified:true,pathDigest,effectDigest,memberRoots};
    const stage=path.join(home,'hima',`qualification-${randomUUID()}.partial`);await writeFile(stage,JSON.stringify(receipt),{mode:0o600,flag:'wx'});await syncFile(stage);await rename(stage,path.join(home,'hima/restore-lineage.json'));
    await verifyPhysicalJobs(archive.manifest.authority);
    if(canonical(await archivedMemberRoots(archive))!==canonical(memberRoots))fail('native original-root plan changed before qualification');
    for(const [key,binding]of Object.entries(memberRoots))if(await fileDigest(path.join(binding.root,'lease.json'))!==binding.leaseSha256
      ||await fileDigest(path.join(binding.root,'control/config.json'))!==binding.configurationSha256)fail(`native member ${key} original bytes changed before qualification`);
    await rm(path.join(home,'hima/restore-hold.json'));await syncFile(path.join(home,'hima'));
    return {home,state:'qualified',manifestSha256:archive.manifestSha256,epoch:lineage.epoch,...(previousHome?{previousHome}:{})};
  } finally {await release();}
}
