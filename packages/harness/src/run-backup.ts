/** Offline cold copies only. DBOS recovery is never launched to inspect a held import. */
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, cp, lstat, mkdir, open, readFile, readdir, readlink, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { canonicalHome, claimDatabaseLineage, readDatabaseLineage, writeDatabaseLineage, localLineageDirectory as localAuthorityDirectory, POSTGRES_VERSION } from './local-database.js';
import { executableApplicationVersion, installedExecutableManifest } from './durable-runtime.js';
export { assertHomeExecutionAllowed, resolveRetainedMaterialsDirectory } from './local-database.js';

type Entry = { kind:'directory'|'file'|'symlink'; mode:number; sha256?:string; target?:string };
type Root = { original:string; kind:'home'|'distribution'|'runtime'|'material'; entries:Record<string,Entry> };
interface Authority { format:'hima-cold-authority/1'; identity:string; controlSha256:string; closedAt:string; host:{pid:number;processIdentity:string}; postmaster:{pid:number}; application:Record<string,unknown[]>; system:Record<string,unknown[]> }
export interface ColdBackupManifest { format:'hima-cold-backup/1'; sourceHome:string; identity:string; platform:string; postgresVersion:string; runtimeDigest:string; applicationVersion:string; retainedMaterialsDir:string; roots:Root[]; authority:Authority; distributionDigest:string }
export interface CompleteBackup { backup:string; manifestSha256:string; manifest:ColdBackupManifest }
export interface ColdBackupOptions { home:string; destination:string; runtimeDirectory:string; distribution:{root:string;manifestFile:string;harnessRoot:string} }
const digest = (value:Uint8Array|string) => createHash('sha256').update(value).digest('hex');
async function fileDigest(file:string):Promise<string> {
  const hash=createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
const fail = (message:string):never => { throw new Error(`Cold backup: ${message}. Preserve the original/partial files; execution remains held.`); };
const inside = (root:string,file:string) => file===root || file.startsWith(root+path.sep);
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
function retainedPath(key:string,value:unknown):value is string { return typeof value==='string' && path.isAbsolute(value) && /^(workspace|cwd|dir|retainedPackDir|path|file|.*Path|.*Dir|.*Root)$/.test(key); }
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
  if(manifest.format!=='hima-cold-backup/1'||!Array.isArray(manifest.roots)||manifest.roots.filter(root=>root.kind==='home').length!==1||manifest.identity!==manifest.authority?.identity)fail('unrecognized complete manifest');
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
    const manifest:ColdBackupManifest={format:'hima-cold-backup/1',sourceHome:home,identity:credentials.identity,platform:`${process.platform}-${process.arch}`,postgresVersion:POSTGRES_VERSION,runtimeDigest:digest(runtimeBytes),applicationVersion,retainedMaterialsDir:lineage.retainedMaterialsDir,roots:frozen,authority,distributionDigest:digest(distributionBytes)};
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
async function restoreOriginalMaterials(archive:CompleteBackup):Promise<string> {
  const {manifest}=archive;const roots:Array<{root:Root;from:string}>=[];
  for(let index=0;index<manifest.roots.length;index++) {
    const root=manifest.roots[index]!;const from=path.join(archive.backup,'payload',String(index));
    if(root.kind==='material')roots.push({root,from});
    if(root.kind==='home') {
      // Only material subtrees; never recreate the runnable old profile/database/session Home.
      for(const relative of ['hima/run-assets']) {
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
    if(executableApplicationVersion(await installedExecutableManifest(options.harnessRoot))!==archive.manifest.applicationVersion)fail('the original frozen executable is required');
    await verifyPhysicalJobs(archive.manifest.authority,archive);
    const pathDigest=await restoreOriginalMaterials(archive);
    const effectDigest=await verifyEffects(archive.manifest.authority);
    let previousHome:string|undefined;
    {
      // Qualification always imports the entire verified final cut, even for the same digest.
      // A held Home may have damaged bytes; its marker is never a completeness assertion.
      const replacement=`${home}.replacement-${randomUUID()}`;
      await restoreColdBackup({backup:archive.backup,newHome:replacement});
      previousHome=`${home}.previous-${randomUUID()}`;await rename(home,previousHome);await rename(replacement,home);await syncFile(path.dirname(home));
    }
    const receipt={format:'hima-restore-lineage/1',identity:prior.identity,manifest:archive.manifestSha256,epoch:lineage.epoch,qualified:true,pathDigest,effectDigest};
    const stage=path.join(home,'hima',`qualification-${randomUUID()}.partial`);await writeFile(stage,JSON.stringify(receipt),{mode:0o600,flag:'wx'});await syncFile(stage);await rename(stage,path.join(home,'hima/restore-lineage.json'));
    await verifyPhysicalJobs(archive.manifest.authority);
    await rm(path.join(home,'hima/restore-hold.json'));await syncFile(path.join(home,'hima'));
    return {home,state:'qualified',manifestSha256:archive.manifestSha256,epoch:lineage.epoch,...(previousHome?{previousHome}:{})};
  } finally {await release();}
}
