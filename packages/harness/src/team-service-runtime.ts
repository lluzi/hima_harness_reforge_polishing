// Host-owned optional service processes. Fabric/DBOS remains the execution authority.
// Installed immutable assets and private writable Home never share a directory.
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { readFile, mkdir, realpath, lstat, rm, open } from 'node:fs/promises';
import { createServer } from 'node:net';
import { z } from 'zod';
import { EngineeringEngineRuntime, engineeringEngineManifest, verifyEngineeringArchive, type EngineeringOwnedFacts, type EngineeringNamespaceRequest, type EngineeringNamespaceLease } from './team-engine-runtime.js';

const relative = z.string().min(1).refine(v => !path.isAbsolute(v) && !v.split(/[\\/]/).some(p => !p || p === '.' || p === '..'));
const component = z.strictObject({id:z.string().regex(/^[a-z][a-z0-9-]*$/),version:z.string().min(1),source:z.string().url(),license:z.string().min(1),notices:z.array(relative).min(1),requiredFiles:z.array(relative).min(1)});
export const teamRuntimeManifest = z.strictObject({format:z.literal('hima-team-runtime/1'),platform:z.string(),qualification:z.enum(['asset-assembly-only','mechanism-test-only']),
  files:z.record(relative,z.string().regex(/^[a-f0-9]{64}$/)),components:z.array(component),
  engineeringEngine:engineeringEngineManifest.optional(),
  services:z.array(z.strictObject({id:z.literal('hindsight'),executable:relative,argv:z.array(z.string()).max(64),timeoutMs:z.number().int().positive().max(120000),stopGraceMs:z.number().int().positive().max(10000),backupExecutable:relative.optional(),backupArgv:z.array(z.string()).max(64).optional()}))});
export type TeamRuntimeManifest = z.infer<typeof teamRuntimeManifest>;
export interface TeamServiceReceipt {
  schema:'hima-team-service-receipt/1'; receiptId:string; serviceId:string; generation:string;
  operation:'start'|'status'|'export'|'stop'; state:'starting'|'running'|'stopping'|'stopped'|'failed'|'unavailable'; recordedAt:string;
  owned:{pid?:number;quiescent:boolean;engine?:EngineeringOwnedFacts}; diagnostic?:{code:string;message:string};
  export?:{cutId:string;file:string;sha256:string;bytes:number};
}
class CapabilityError extends Error {readonly code:string; constructor(code:string,message:string){super(message);this.code=code;}}
export async function readTeamRuntimeManifest(directory:string):Promise<TeamRuntimeManifest> {
  const root=await realpath(directory).catch(()=>{throw new CapabilityError('missing-assets','Install the fixed Team runtime asset closure; no online installation is attempted.');});
  const raw=await readFile(path.join(root,'team-runtime.json'),'utf8').catch(()=>{throw new CapabilityError('missing-assets','The installed Team runtime manifest is missing. Reinstall the fixed asset closure.');});
  const parsed=teamRuntimeManifest.safeParse(JSON.parse(raw));
  if(!parsed.success) throw new CapabilityError('manifest','The Team runtime manifest is invalid. Reinstall the fixed asset closure.');
  const manifest=parsed.data;
  if(manifest.platform!==`${process.platform}-${process.arch}`) throw new CapabilityError('platform','The Team runtime platform/architecture differs from this Host. Install the matching assets.');
  if(new Set(manifest.components.map(c=>c.id)).size!==manifest.components.length || new Set(manifest.services.map(c=>c.id)).size!==manifest.services.length) throw new CapabilityError('manifest','Duplicate component/service identity.');
  for(const c of manifest.components) for(const file of [...c.notices,...c.requiredFiles]) if(!manifest.files[file]) throw new CapabilityError('missing-helper',`Component ${c.id} has no pinned helper/notice ${file}.`);
  for(const s of manifest.services) if(s.backupExecutable && !manifest.files[s.backupExecutable] || !manifest.files[s.executable] || !manifest.components.some(c=>c.id===s.id)) throw new CapabilityError('missing-helper',`Service ${s.id} executable/component is not pinned.`);
  if(manifest.engineeringEngine) {
    const e=manifest.engineeringEngine;if(!manifest.components.some(c=>c.id==='engineering-engine'&&c.version===e.version))throw new CapabilityError('missing-helper','Engineering component/notice identity is missing.');
    if(e.provider!==(process.platform==='darwin'?'applehv':'rootless') || e.guestPlatform!==(process.platform==='darwin'?'linux-arm64':'linux-x64') || !['darwin-arm64','linux-x64'].includes(manifest.platform)) throw new CapabilityError('platform','Engineering Host/guest target or provider differs.');
    if(e.provider==='applehv' && !e.machineImage || e.provider==='rootless' && e.machineImage) throw new CapabilityError('manifest','Engineering machine image/provider differs.');
    for(const file of [e.executable,...e.helpers,e.image.file,...(e.machineImage?[e.machineImage.file]:[])]) if(!manifest.files[file]) throw new CapabilityError('missing-helper',`Engineering closure does not pin ${file}.`);
    for(const blob of [e.image,...(e.machineImage?[e.machineImage]:[])]) if(manifest.files[blob.file]!==blob.sha256 || (await lstat(path.join(root,blob.file))).size!==blob.bytes) throw new CapabilityError('asset-integrity','Engineering image digest/byte count differs.');
    for(const file of [e.executable,...e.helpers]) if(e.guestInventory[file]) throw new CapabilityError('platform','Host engine helpers cannot be reclassified as guest executables.');
    for(const [file,guest] of Object.entries(e.guestInventory)) if(guest.platform!==e.guestPlatform || manifest.files[file]!==guest.sha256) throw new CapabilityError('platform','Guest inventory target/digest differs.');
  }
  for(const [file,hash] of Object.entries(manifest.files)) {
    const target=path.join(root,file); const info=await lstat(target).catch(()=>{throw new CapabilityError('missing-helper',`The pinned Team runtime file ${file} is missing.`);});
    if(!info.isFile() || !(await realpath(target)).startsWith(root+path.sep) || await digestTeamRuntimeFile(target)!==hash) throw new CapabilityError('asset-integrity',`Team runtime bytes differ for ${file}; reinstall the fixed closure.`);
    const handle=await open(target,'r');const bytes=Buffer.alloc(32);await handle.read(bytes,0,32,0);await handle.close();let arch:string|undefined;
    if(bytes.length>=20 && bytes.subarray(0,4).equals(Buffer.from([0x7f,0x45,0x4c,0x46]))) arch=bytes[5]===1 && bytes.readUInt16LE(18)===62?'linux-x64':bytes[5]===1 && bytes.readUInt16LE(18)===183?'linux-arm64':'unsupported-native';
    if(bytes.length>=8 && bytes.readUInt32LE(0)===0xfeedfacf) arch=bytes.readUInt32LE(4)===0x100000c?'darwin-arm64':'unsupported-native';
    if(arch && arch!==(manifest.engineeringEngine?.guestInventory[file]?.platform ?? manifest.platform)) throw new CapabilityError('platform',`The native helper ${file} is built for another architecture.`);
  }
  if(manifest.engineeringEngine) await verifyEngineeringArchive(root,manifest.engineeringEngine);
  return manifest;
}
async function digestTeamRuntimeFile(file:string):Promise<string>{const digest=createHash('sha256');for await(const chunk of createReadStream(file))digest.update(chunk);return digest.digest('hex');}

interface OwnedService {
  generation:string; state:TeamServiceReceipt['state']; stopped:boolean; child?:ChildProcessWithoutNullStreams;
  start?:Promise<TeamServiceReceipt>; export?:Promise<TeamServiceReceipt>; diagnostic?:TeamServiceReceipt['diagnostic'];
  stopGraceMs:number; origin?:string; apiKey?:string; environment?:NodeJS.ProcessEnv; root?:string; spec?:TeamRuntimeManifest['services'][number];
}
export interface TeamServiceConfiguration {databaseUrl:string; environment?:Record<string,string>;}
export interface TeamServiceRuntimeOptions {home:string;runtimeDirectory?:string;recordReceipt:(receipt:TeamServiceReceipt)=>Promise<void>;configuration?:()=>Promise<TeamServiceConfiguration>;}
export class TeamServiceRuntime {
  private readonly services=new Map<string,OwnedService>();
  private shuttingDown=false;
  private readonly engine:EngineeringEngineRuntime;
  private readonly options:TeamServiceRuntimeOptions;
  constructor(options:TeamServiceRuntimeOptions){this.options=options;this.engine=new EngineeringEngineRuntime({...options,readManifest:async()=>{if(!options.runtimeDirectory)throw new Error('Fixed engineering engine assets are missing.');return readTeamRuntimeManifest(options.runtimeDirectory);}});}
  prepareNamespace(request:EngineeringNamespaceRequest):Promise<EngineeringNamespaceLease>{if(this.shuttingDown)return Promise.reject(new Error('Host shutdown rejects namespace readiness.'));return this.engine.prepareNamespace(request);}
  private groupPresent(owned:OwnedService):boolean {
    if(!owned.child?.pid)return false;
    try{process.kill(-owned.child.pid,0);return true;}catch(error){return (error as NodeJS.ErrnoException).code!=='ESRCH';}
  }
  private async receipt(id:string,owned:OwnedService,operation:TeamServiceReceipt['operation'],extra:Partial<TeamServiceReceipt>={}):Promise<TeamServiceReceipt> {
    const live=owned.child && owned.child.exitCode===null && owned.child.signalCode===null;
    const groupPresent=this.groupPresent(owned);
    const receipt:TeamServiceReceipt={schema:'hima-team-service-receipt/1',receiptId:randomUUID(),serviceId:id,generation:owned.generation,operation,state:owned.state,recordedAt:new Date().toISOString(),owned:{...(live?{pid:owned.child!.pid}:{}),quiescent:!['starting','stopping'].includes(owned.state) && !owned.export && !live && !groupPresent},...(owned.diagnostic?{diagnostic:owned.diagnostic}:{}),...extra};
    await this.options.recordReceipt(receipt); return receipt;
  }
  async status(id:string):Promise<TeamServiceReceipt> {
    if(id==='engineering-engine')return this.engine.status();
    const owned:OwnedService=this.services.get(id) ?? {generation:randomUUID(),state:'unavailable' as const,stopped:true,stopGraceMs:1000,diagnostic:{code:'not-started',message:'No owned service generation has been started by this Host.'}};
    this.services.set(id,owned);
    if(owned.child && (owned.child.exitCode!==null || owned.child.signalCode!==null) && owned.state==='running') {owned.state='failed';owned.diagnostic={code:'process-exit',message:'The owned service exited. Inspect its fixed runtime configuration before restarting.'};}
    if(owned.state==='running' && owned.origin && owned.apiKey) {
      try {const response=await fetch(`${owned.origin}/v1/default/banks`,{headers:{Authorization:`Bearer ${owned.apiKey}`},signal:AbortSignal.timeout(1000)});if(!response.ok)throw new Error('Readiness unavailable.');}
      catch{owned.state='failed';owned.diagnostic={code:'service-health',message:'The owned generation no longer answers its private authenticated readiness probe. Stop it before restarting.'};}
    }
    return this.receipt(id,owned,'status');
  }
  start(id:string):Promise<TeamServiceReceipt> {
    if(this.shuttingDown)return Promise.reject(new Error('Host shutdown rejects new service starts.'));
    if(id==='engineering-engine')return this.engine.start();
    if(this.shuttingDown) return Promise.reject(new Error('Host shutdown rejects new service starts.'));
    const previous=this.services.get(id);
    if(previous?.start && !previous.stopped && ['starting','running'].includes(previous.state)) return previous.start;
    if(previous?.export)return Promise.reject(new Error('Wait for the owned backup/export to finish before restarting this generation.'));
    // Keep the previous generation until both its leader and owned process group are quiescent.
    if(previous?.state==='stopping') return Promise.reject(new Error('Wait for the owned generation to become quiescent before restarting.'));
    if(previous?.child?.pid && this.groupPresent(previous)) return Promise.reject(new Error('The previous owned process group is not quiescent; retain unresolved descendants for reconciliation.'));
    if(previous?.child && previous.child.exitCode===null && previous.child.signalCode===null) return Promise.reject(new Error('Stop the live owned generation before restarting.'));
    const owned:OwnedService={generation:randomUUID(),state:'starting',stopped:false,stopGraceMs:1000}; this.services.set(id,owned);
    owned.start=this.launch(id,owned); return owned.start;
  }
  private async launch(id:string,owned:OwnedService):Promise<TeamServiceReceipt> {
    try {
      await this.receipt(id,owned,'start');
      if(!this.options.runtimeDirectory) throw new CapabilityError('missing-assets','Team runtime is not installed. Guide remains available; install the fixed asset closure to enable this optional service.');
      const manifest=await readTeamRuntimeManifest(this.options.runtimeDirectory); const spec=manifest.services.find(s=>s.id===id);
      if(!spec) throw new CapabilityError('missing-capability',`No installed service capability for ${id}.`);
      if(owned.stopped) {owned.state='stopped';return this.receipt(id,owned,'start');}
      const root=await realpath(this.options.runtimeDirectory); const home=path.join(this.options.home,'hima/team-services',id,owned.generation);
      await mkdir(home,{recursive:true,mode:0o700});
      if(owned.stopped) {owned.state='stopped';return this.receipt(id,owned,'start');}
      const configuration=await this.options.configuration?.();
      if(!configuration) throw new CapabilityError('missing-configuration','Configure a private Hindsight database and model providers in Host settings. No embedded database or download is started.');
      const database=new URL(configuration.databaseUrl);
      if(!['postgres:','postgresql:'].includes(database.protocol) || !['127.0.0.1','localhost'].includes(database.hostname) || !database.pathname || database.pathname==='/') throw new CapabilityError('configuration','The service requires its explicit private local PostgreSQL database.');
      const environment:NodeJS.ProcessEnv={};
      for(const [key,value] of Object.entries(configuration.environment ?? {})) {
        if(!/^HINDSIGHT_API_[A-Z0-9_]+$/.test(key)) throw new CapabilityError('configuration','Only explicit Hindsight provider configuration may enter the service environment.');
        environment[key]=value;
      }
      const port=await new Promise<number>((resolve,reject)=>{const server=createServer();server.once('error',reject);server.listen(0,'127.0.0.1',()=>{const address=server.address();if(!address || typeof address==='string')return reject(new Error('No private port.'));server.close(error=>error?reject(error):resolve(address.port));});});
      owned.apiKey=randomUUID()+randomUUID();owned.origin=`http://127.0.0.1:${port}`;owned.root=root;owned.spec=spec;
      owned.environment={...environment,PATH:path.join(root,'bin'),HOME:home,TMPDIR:home,HINDSIGHT_API_DATABASE_URL:configuration.databaseUrl,
        HINDSIGHT_API_HOST:'127.0.0.1',HINDSIGHT_API_PORT:String(port),HINDSIGHT_API_TENANT_EXTENSION:'hindsight_api.extensions.builtin.tenant:ApiKeyTenantExtension',HINDSIGHT_API_TENANT_API_KEY:owned.apiKey,
        HINDSIGHT_API_WORKER_ID:`hima-${createHash('sha256').update(await realpath(this.options.home)).digest('hex').slice(0,32)}`,HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1',PYTHON_DOTENV_DISABLED:'1',PYTHONNOUSERSITE:'1',PYTHONDONTWRITEBYTECODE:'1'};
      if(owned.stopped) {owned.state='stopped';return this.receipt(id,owned,'start');}
      owned.stopGraceMs=spec.stopGraceMs;
      const child=spawn(path.join(root,spec.executable),[...spec.argv,'--host','127.0.0.1','--port',String(port)],{cwd:root,detached:true,env:owned.environment,stdio:['pipe','pipe','pipe']});
      owned.child=child;child.stdout.resume();child.stderr.resume();let spawnError=false;child.once('error',()=>{spawnError=true;});
      const deadline=Date.now()+spec.timeoutMs;
      while(!owned.stopped) {
        if(spawnError || child.exitCode!==null || child.signalCode!==null)throw new Error('The owned service exited during startup.');
        try {const ready=await fetch(`${owned.origin}/health/ready`,{signal:AbortSignal.timeout(500)});
          const auth=await fetch(`${owned.origin}/v1/default/banks`,{headers:{Authorization:`Bearer ${owned.apiKey}`},signal:AbortSignal.timeout(500)});
          if(ready.ok && auth.ok)break;
        }catch{/* bounded readiness retry while this exact owned child is alive */}
        if(Date.now()>deadline)throw new Error('The authenticated service did not become ready.');
        await new Promise(resolve=>setTimeout(resolve,25));
      }
      if(owned.stopped) {await this.reap(owned);owned.state='stopped';} else owned.state='running';
    }catch(error){await this.reap(owned);owned.state=owned.stopped?'stopped':error instanceof CapabilityError?'unavailable':'failed';
      owned.diagnostic={code:error instanceof CapabilityError?error.code:'service-start',message:error instanceof CapabilityError?error.message:'The owned service did not become ready. Check its installed capability, port and permissions.'};}
    return this.receipt(id,owned,'start');
  }
  export(id:string,request:{cutId:string;destination:string}):Promise<TeamServiceReceipt>{
    if(this.shuttingDown)return Promise.reject(new Error('Host shutdown rejects new service exports.'));
    if(id==='engineering-engine')return this.engine.export(request);
    if(this.shuttingDown) return Promise.reject(new Error('Host shutdown rejects new service exports.'));
    const owned=this.services.get(id);
    if(!owned || owned.stopped || owned.state!=='running' || !owned.child || owned.child.exitCode!==null || owned.child.signalCode!==null) return Promise.reject(new Error('Export requires a live owned service generation.'));
    if(owned.export) return Promise.reject(new Error('An export cut is already in progress.'));
    if(!/^[A-Za-z0-9_-]{1,128}$/.test(request.cutId) || !relative.safeParse(request.destination).success) return Promise.reject(new Error('Invalid export cut or destination.'));
    owned.export=this.exportLive(id,owned,request).finally(()=>{owned.export=undefined;});return owned.export;
  }
  private async exportLive(id:string,owned:OwnedService,request:{cutId:string;destination:string}):Promise<TeamServiceReceipt>{
    const directory=path.join(this.options.home,'hima/team-service-exports',owned.generation);await mkdir(directory,{recursive:true,mode:0o700});
    const file=path.join(directory,request.destination);await mkdir(path.dirname(file),{recursive:true,mode:0o700});
    if(!(await realpath(path.dirname(file))).startsWith(await realpath(directory)+path.sep) && await realpath(path.dirname(file))!==await realpath(directory)) throw new Error('Export destination escapes its private generation.');
    if(await lstat(file).catch(()=>undefined)) throw new Error('Export destination already exists.');
    const spec=owned.spec;
    if(!spec?.backupExecutable || !owned.root || !owned.environment) throw new CapabilityError('missing-export','The fixed Hindsight admin backup capability is not installed. Bank template export is not a full service backup.');
    if(!file.endsWith('.zip'))throw new Error('Hindsight admin backup requires a .zip destination.');
    try {
      await new Promise<void>((resolve,reject)=>{const child=spawn(path.join(owned.root!,spec.backupExecutable!),[...(spec.backupArgv ?? []),'backup',file,'--schema','public'],{cwd:owned.root,env:owned.environment,stdio:'ignore',timeout:30000,killSignal:'SIGKILL'});
        child.once('error',()=>reject(new Error('The fixed Hindsight admin executable failed to start.')));child.once('close',code=>code===0?resolve():reject(new Error('Hindsight online backup failed; the service remains owned and running.')));});
      if(owned.child!.exitCode!==null || owned.child!.signalCode!==null) throw new Error('Service exited before export cut was verified.');
      const info=await lstat(file);if(!info.isFile() || !(await realpath(file)).startsWith(await realpath(directory)+path.sep)) throw new Error('Invalid owned export output.');
      const digest=createHash('sha256');for await(const chunk of createReadStream(file))digest.update(chunk);
      return await this.receipt(id,owned,'export',{export:{cutId:request.cutId,file,sha256:digest.digest('hex'),bytes:info.size}});
    }catch(error){await rm(file,{force:true});throw error;}
  }
  async stop(id:string):Promise<TeamServiceReceipt>{
    if(id==='engineering-engine')return this.engine.stop();
    const owned=this.services.get(id);if(!owned) return this.status(id);
    owned.stopped=true;owned.state='stopping';
    // Fence new writes first; the active online export is verified before shutdown.
    await owned.export?.catch(()=>{});
    if(owned.child) {await this.reap(owned);}
    await owned.start?.catch(()=>{});await this.reap(owned);owned.state='stopped';
    if(this.groupPresent(owned)){owned.state='failed';owned.diagnostic={code:'unresolved-descendants',message:'The owned leader exited but its process group is still present. Do not signal an unverified PID; retain this generation for operator reconciliation.'};}
    return this.receipt(id,owned,'stop');
  }
  private async reap(owned:OwnedService):Promise<void>{
    const child=owned.child;if(!child || child.exitCode!==null || child.signalCode!==null)return;
    // This is the current ChildProcess handle and generation, never a persisted arbitrary PID.
    const closed=new Promise<void>(resolve=>child.once('close',()=>resolve()));
    try {process.kill(-child.pid!,'SIGTERM');}catch{/* child already exited */}
    const timer=setTimeout(()=>{if(child.exitCode===null && child.signalCode===null)try{process.kill(-child.pid!,'SIGKILL');}catch{/* already exited */}},owned.stopGraceMs);
    await closed;clearTimeout(timer);
  }
  connection(id:string):{origin:string;apiKey:string;generation:string}|undefined {
    const owned=this.services.get(id);return !this.shuttingDown && owned?.state==='running' && !owned.stopped && owned.origin && owned.apiKey && owned.child?.exitCode===null && owned.child.signalCode===null?{origin:owned.origin,apiKey:owned.apiKey,generation:owned.generation}:undefined;
  }
  async stopAll():Promise<TeamServiceReceipt[]>{this.shuttingDown=true;const engine=this.engine.stopAll();return [...await Promise.all([...this.services.keys()].map(id=>this.stop(id))),...await engine];}
}
