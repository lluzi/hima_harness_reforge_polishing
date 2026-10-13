// Private C7 engine and member namespace lifecycle; no execution scheduler.
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { promisify, isDeepStrictEqual } from 'node:util';
import { request as httpRequest } from 'node:http';
import { isIP } from 'node:net';
import { createReadStream } from 'node:fs';
import { mkdir, realpath, writeFile, lstat, stat, readFile, readdir, symlink, rm } from 'node:fs/promises';
import { z } from 'zod';
import type { TeamServiceReceipt } from './team-service-runtime.js';
const relative=z.string().min(1).refine(v=>!path.isAbsolute(v)&&!v.split(/[\\/]/).some(p=>!p||p==='.'||p==='..'));
const hash=z.string().regex(/^[a-f0-9]{64}$/);
const blob=z.strictObject({file:relative,sha256:hash,bytes:z.number().int().positive()});
export const engineeringEngineManifest=z.strictObject({kind:z.literal('podman'),version:z.literal('6.1.3'),provider:z.enum(['applehv','rootless']),guestPlatform:z.enum(['linux-arm64','linux-x64']),executable:relative,helpers:z.array(relative).min(1),
  machineImage:blob.extend({compression:z.literal('zstd')}).optional(),
  image:blob.extend({manifestSha256:hash,configSha256:hash,layers:z.array(z.strictObject({sha256:hash,bytes:z.number().int().positive()})).min(1),qualification:z.literal('trusted-fixture-only')}),
  guestInventory:z.record(relative,z.strictObject({platform:z.enum(['linux-arm64','linux-x64']),sha256:hash})),
});
export type EngineeringEngineManifest=z.infer<typeof engineeringEngineManifest>;
const tuple=z.strictObject({family:z.union([z.literal(4),z.literal(6)]),address:z.string(),protocol:z.literal('tcp'),port:z.number().int().min(1).max(65535)});
const policySchema=z.strictObject({policyId:z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),approvedOrigins:z.array(z.string()).min(1).max(32),resolvedTuples:z.array(tuple).min(1).max(128),deniedPrivateTuples:z.array(tuple).max(128),resolvedAt:z.string().datetime(),validUntil:z.string().datetime(),sha256:hash,approvedModelTuples:z.array(tuple).min(1).max(128).optional(),nativeLoopbackPort:z.literal(4096).optional()});
export type EngineeringEgressPolicy=z.infer<typeof policySchema>;
export interface EngineeringNamespaceRequest {engineGeneration:string;taskIdentity:{taskId:string;fixture:'trusted-namespace-test'};policy:EngineeringEgressPolicy;}
export interface EngineeringNamespaceLease {readonly engineGeneration:string;readonly namespaceGeneration:string;readonly containerId:string;readonly guestPidIdentity:string;readonly imageDigest:string;readonly policySha256:string;readonly observedRulesSha256:string;readonly validUntil:string;readonly qualification:'trusted-fixture-only';readonly memberKey?:string;readonly memberHosts?:readonly string[];}
export interface EngineeringOwnedFacts {provider:'applehv'|'rootless';platform:string;canonicalStorage:string;shortHome:string;machineName?:string;machineCreatedAt?:string;configSha256?:string;connectionSha256?:string;imageDigest?:string;helpers:Array<{pid:number;startIdentity:string}>;namespaces:EngineeringNamespaceLease[];memberClosures?:Array<{lease:EngineeringNamespaceLease;proof:{containerId:string;namespaceGeneration:string;observedAbsent:true}}>;closure:{containers:boolean;machine:boolean;helpers:boolean};qualification:'trusted-fixture-only';}
function freezeSnapshot<T>(value:T):T {if(value!==null&&typeof value==='object'){for(const child of Object.values(value))freezeSnapshot(child);Object.freeze(value);}return value;}
const sha=(bytes:string)=>createHash('sha256').update(bytes).digest('hex');
const privateAddress=(raw:string)=> {const address=isIP(raw)===6?new URL(`http://[${raw}]`).hostname.slice(1,-1):raw;return isIP(address)===4?/^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address):/^(::|fc|fd|fe[89ab])/i.test(address);};
// IPv6 URL canonicalization also exposes IPv4-mapped and compatible addresses.
const canonicalAddress=(raw:string)=>isIP(raw)===6?new URL(`http://[${raw}]`).hostname.slice(1,-1):raw;
function forbiddenModelAddress(raw:string):boolean {
  const address=canonicalAddress(raw);
  if(isIP(address)===4){const parts=address.split('.').map(Number);return parts[0]===0||parts[0]===127||parts[0]!>=224||parts[0]===169&&parts[1]===254;}
  if(address==='::'||address==='::1'||/^fe[89ab][a-f0-9]:/i.test(address)||/^ff/i.test(address))return true;
  const mapped=address.match(/^::(?:ffff:)?([a-f0-9]{1,4}):([a-f0-9]{1,4})$/i);
  if(mapped){const high=parseInt(mapped[1]!,16),low=parseInt(mapped[2]!,16);return forbiddenModelAddress(`${high>>>8}.${high&255}.${low>>>8}.${low&255}`);}
  return false;
}
const exactTupleKey=(t:EngineeringEgressPolicy['resolvedTuples'][number])=>JSON.stringify([t.family,t.address,t.protocol,t.port]);
const destinationKey=(t:EngineeringEgressPolicy['resolvedTuples'][number])=>{const address=canonicalAddress(t.address),mapped=address.match(/^::(?:ffff:)?([a-f0-9]{1,4}):([a-f0-9]{1,4})$/i);if(mapped){const high=parseInt(mapped[1]!,16),low=parseInt(mapped[2]!,16);return JSON.stringify([4,`${high>>>8}.${high&255}.${low>>>8}.${low&255}`,t.protocol,t.port]);}return JSON.stringify([t.family,address,t.protocol,t.port]);};
interface CompiledEngineeringPolicy {approvedOrigins:string[];bytes:string;policySha256:string;tuples:EngineeringEgressPolicy['resolvedTuples'];validUntil:string;deadlineEpochSeconds:number;timeoutSeconds:number;nativeLoopbackPort?:4096;}
const installationGuardMs=1000;
function engineeringPolicyBytes(tuples:EngineeringEgressPolicy['resolvedTuples'],deadlineEpochSeconds:number,timeoutSeconds:number,nativeLoopbackPort?:4096):string {
  const native=nativeLoopbackPort?`  oifname "lo" ip daddr 127.0.0.1 tcp dport ${nativeLoopbackPort} meta time < ${deadlineEpochSeconds} accept\n  oifname "lo" ip daddr 127.0.0.1 tcp sport ${nativeLoopbackPort} meta time < ${deadlineEpochSeconds} accept\n`:"";
  const sets=([4,6] as const).map(family=>{const elements=tuples.filter(t=>t.family===family).map(t=>`${t.address} . ${t.port} timeout ${timeoutSeconds}s`);return ` set allow${family} { type ipv${family}_addr . inet_service; flags timeout;${elements.length?` elements = { ${elements.join(', ')} };`:''} }`;});
  return `table inet hima {\n${sets.join('\n')}\n chain output { type filter hook output priority 0; policy drop;\n${native}  meta l4proto tcp ip daddr . tcp dport @allow4 meta time < ${deadlineEpochSeconds} accept\n  meta l4proto tcp ip6 daddr . tcp dport @allow6 meta time < ${deadlineEpochSeconds} accept\n }\n}\n`;
}
export function compileEngineeringPolicy(input:EngineeringEgressPolicy,now=Date.now(),offsetLowerMs=0):CompiledEngineeringPolicy {
  if(!Number.isSafeInteger(now)||now<0||!Number.isFinite(offsetLowerMs)||Math.abs(offsetLowerMs)>1000)throw new Error('Egress policy clock is invalid or outside the bounded skew.');
  const p=policySchema.parse(input);const {sha256,...body}=p;
  if(sha(JSON.stringify(body))!==sha256)throw new Error('Egress policy digest differs.');
  if(Date.parse(p.resolvedAt)>now || Date.parse(p.validUntil)<=now || Date.parse(p.validUntil)-Date.parse(p.resolvedAt)>300000)throw new Error('Egress policy resolution is expired or outside the bounded validity.');
  const modelApprovals=p.approvedModelTuples,originPorts=new Set<number>();
  for(const origin of p.approvedOrigins){const url=new URL(origin);if((modelApprovals?url.protocol!=='https:'&&url.protocol!=='http:':url.protocol!=='https:'||url.port&&url.port!=='443')||url.username||url.password||url.origin!==origin)throw new Error(modelApprovals?'Approved model origin must be an exact HTTP/HTTPS origin without credentials.':'Approved origin must be an exact HTTPS origin.');const originHost=url.hostname.startsWith('[')?url.hostname.slice(1,-1):url.hostname;if(originHost.toLowerCase()==='localhost'||originHost.toLowerCase().endsWith('.localhost')||originHost.includes('*')||isIP(originHost)&&forbiddenModelAddress(originHost))throw new Error('Approved model origin cannot be localhost, wildcard or a forbidden model address.');originPorts.add(Number(url.port||(url.protocol==='https:'?443:80)));}
  for(const t of [...p.resolvedTuples,...p.deniedPrivateTuples,...(modelApprovals??[])])if(isIP(t.address)!==t.family)throw new Error('Egress policy address family differs.');
  const denied=new Set(p.deniedPrivateTuples.map(destinationKey));const tuples=p.resolvedTuples,resolved=new Set(tuples.map(exactTupleKey)),approved=new Set((modelApprovals??[]).map(exactTupleKey));
  if(modelApprovals&&(approved.size!==modelApprovals.length||modelApprovals.some(t=>!resolved.has(exactTupleKey(t)))))throw new Error('Approved model tuples must be distinct exact resolved destinations.');
  for(const t of tuples){
    if(denied.has(destinationKey(t)))throw new Error('Egress policy admits a denied private collision.');
    if(forbiddenModelAddress(t.address))throw new Error('Egress policy refuses loopback, unspecified, link-local, multicast or reserved model destinations.');
    if(modelApprovals&&!originPorts.has(t.port))throw new Error('Model destination port differs from declared origin effective port.');
    if((t.port!==443||privateAddress(t.address))&&!approved.has(exactTupleKey(t)))throw new Error('Egress policy admits a private collision or non-HTTPS port without an exact approved model tuple.');
  }
  if(new Set(tuples.map(destinationKey)).size!==tuples.length)throw new Error('Egress policy contains duplicate tuples.');
  const deadlineEpochSeconds=Math.floor((Date.parse(p.validUntil)+Math.min(0,offsetLowerMs)-100)/1000);
  const timeoutSeconds=Math.floor((deadlineEpochSeconds*1000-now-installationGuardMs)/1000);
  if(timeoutSeconds<=0)throw new Error('Egress policy has insufficient remaining validity for a bounded installation.');
  return {approvedOrigins:p.approvedOrigins,bytes:engineeringPolicyBytes(tuples,deadlineEpochSeconds,timeoutSeconds,p.nativeLoopbackPort),policySha256:sha256,tuples,validUntil:p.validUntil,deadlineEpochSeconds,timeoutSeconds,...(p.nativeLoopbackPort?{nativeLoopbackPort:p.nativeLoopbackPort}:{})};
}
interface HostClockTiming {hostBeforeMs:number;hostAfterMs:number;}
interface RootlessKeeper {file:string;pid:number;startIdentity:string;}
interface Generation {id:string;state:TeamServiceReceipt['state'];fenced:boolean;manifest?:EngineeringEngineManifest;files?:Record<string,string>;root?:string;env?:NodeJS.ProcessEnv;facts?:EngineeringOwnedFacts;rootlessPolicy?:{file:string;sha256:string};rootlessKeeper?:RootlessKeeper;rootlessInvoked?:boolean;rootlessRetired?:boolean;rootlessCommandUnknown?:boolean;diagnostic?:TeamServiceReceipt['diagnostic'];start?:Promise<TeamServiceReceipt>;pending:Set<Promise<unknown>>;policies:Map<string,CompiledEngineeringPolicy>;stop?:Promise<TeamServiceReceipt>;exporting:boolean;}
export interface EngineeringRuntimeOptions {home:string;runtimeDirectory?:string;recordReceipt:(receipt:TeamServiceReceipt)=>Promise<void>;readManifest:()=>Promise<{engineeringEngine?:EngineeringEngineManifest;files?:Record<string,string>}>;}
export class EngineeringEngineRuntime {
  private generation?:Generation;private closed=false;
  private readonly memberPreparations=new Map<string,Promise<EngineeringNamespaceLease>>();
  private readonly memberStaged=new Map<string,Set<string>>();
  private readonly memberStarted=new Set<string>();
  private readonly memberClosing=new Set<string>();
  private readonly memberDeadlines=new Map<string,number>();
  private readonly options:EngineeringRuntimeOptions;
  constructor(options:EngineeringRuntimeOptions){this.options=options;}
  private async receipt(g:Generation,operation:TeamServiceReceipt['operation'],extra:Partial<TeamServiceReceipt>={}):Promise<TeamServiceReceipt>{const closure=g.facts?.closure;const receipt:TeamServiceReceipt={schema:'hima-team-service-receipt/1',receiptId:randomUUID(),serviceId:'engineering-engine',generation:g.id,operation,state:g.state,recordedAt:new Date().toISOString(),owned:{quiescent:(!g.facts&&['unavailable','stopped'].includes(g.state)&&g.pending.size===0)||!!closure&&closure.containers&&closure.machine&&closure.helpers&&g.pending.size===0,...(g.facts?{engine:g.facts}:{})},...(g.diagnostic?{diagnostic:g.diagnostic}:{}),...extra};const snapshot=freezeSnapshot(structuredClone(receipt));if(g.facts)await writeFile(path.join(g.facts.canonicalStorage,'generation.json'),JSON.stringify({generation:g.id,shortHome:g.facts.shortHome,state:g.state,quiescent:snapshot.owned.quiescent}),{mode:0o600});await this.options.recordReceipt(snapshot);return snapshot;}
  private empty():Generation {return {id:randomUUID(),state:'unavailable',fenced:true,pending:new Set(),policies:new Map(),exporting:false,diagnostic:{code:'not-started',message:'No owned engineering engine generation is running.'}};}
  start():Promise<TeamServiceReceipt>{
    if(this.closed) return Promise.reject(new Error('Host shutdown rejects engine start.'));
    const prior=this.generation;if(prior?.state==='stopping'||prior?.exporting||prior?.pending.size)return Promise.reject(new Error('Wait for current owned engine operations and stop reconciliation.'));if(prior?.start&&!prior.fenced&&['starting','running'].includes(prior.state))return prior.start;
    if(prior&&prior.facts&&!Object.values(prior.facts.closure).every(Boolean))return Promise.reject(new Error('Previous engine generation requires exact resource reconciliation before restart.'));
    const g:Generation={id:randomUUID(),state:'starting',fenced:false,pending:new Set(),policies:new Map(),exporting:false};this.generation=g;g.start=this.launch(g);return g.start;
  }
  private async cli(g:Generation,args:string[],stdin?:string,timing?:HostClockTiming,intent:'control'|'initial-import'='control'):Promise<string>{
    if(!g.root||!g.env||!g.manifest)throw new Error('Engine assets are not initialized.');
    if(g.manifest.provider==='rootless'){if(g.rootlessRetired)throw new Error('Owned rootless generation is retired; no CLI control admitted.');await this.verifyRootlessConfiguration(g);const initialImport=intent==='initial-import'&&!g.rootlessInvoked;if(!initialImport)await this.rootlessKeeperIdentity(g);g.rootlessInvoked=true;}
    if(g.manifest.provider==='applehv'&&(args.includes('--connection')||args[0]==='machine'&&args[1]==='ssh'))await this.verifyPrivateConnection(g);
    return this.execute(g,path.join(g.root,g.manifest.executable),args,stdin,timing);
  }
  private execute(g:Generation,executable:string,args:string[],stdin?:string,timing?:HostClockTiming,environment:NodeJS.ProcessEnv=g.env!):Promise<string>{
    return new Promise((resolve,reject)=>{if(timing)timing.hostBeforeMs=Date.now();const ownedGroup=g.manifest?.provider==='rootless'&&process.platform!=='win32';const bornAtMs=Date.now();const child=spawn(executable,args,{cwd:g.root,env:environment,stdio:['pipe','pipe','pipe'],...(ownedGroup?{detached:true}:{})});let stdout='',stderr='';let exceeded=false,timedOut=false,terminationRequested=false;
      // POSIX detached spawn creates a new session/group whose identity is this child PID.
      // Rootless reexec children inherit it; Podman's private pause keeper starts its own session.
      const commandIdentity=ownedGroup&&child.pid?{pid:child.pid,processGroup:child.pid,session:child.pid,bornAtMs}:undefined;
      const terminate=()=>{if(!ownedGroup){child.kill('SIGKILL');return;}if(terminationRequested)return;terminationRequested=true;if(!commandIdentity){g.rootlessCommandUnknown=true;return;}try{process.kill(-commandIdentity.processGroup,'SIGKILL');}catch(error){if((error as NodeJS.ErrnoException).code!=='ESRCH')g.rootlessCommandUnknown=true;}};
      const timer=setTimeout(()=>{timedOut=true;terminate();},120000);
      child.stdout.on('data',b=>{stdout+=b;if(stdout.length>2*1024*1024){exceeded=true;terminate();}});child.stderr.on('data',b=>{if(stderr.length<4096)stderr+=b;});
      child.once('error',()=>{clearTimeout(timer);reject(new Error('Fixed engine CLI failed to start.'));});child.once('close',async code=>{if(timing)timing.hostAfterMs=Date.now();clearTimeout(timer);let groupAbsent=true;if(commandIdentity){for(let i=0;i<20;i++){try{process.kill(-commandIdentity.processGroup,0);groupAbsent=false;}catch(error){groupAbsent=(error as NodeJS.ErrnoException).code==='ESRCH';if(!groupAbsent)g.rootlessCommandUnknown=true;}if(groupAbsent)break;await new Promise(resolve=>setTimeout(resolve,25));}if(!groupAbsent)g.rootlessCommandUnknown=true;}try{await writeFile(path.join(g.facts!.canonicalStorage,`cli-${randomUUID()}.json`),JSON.stringify({generation:g.id,executable,args,code,stdout,stderr,outputExceeded:exceeded,timedOut,...(ownedGroup?{commandIdentity,terminationRequested,groupAbsent}: {})}),{mode:0o600,flag:'wx'});}catch{reject(new Error('Private CLI evidence could not be retained.'));return;}code===0&&!exceeded&&!timedOut&&groupAbsent?resolve(stdout.trim()):reject(new Error(!groupAbsent?'Owned rootless CLI process group closure is unobserved; retain generation for reconciliation.':timedOut?'Owned engine CLI timed out; retain generation for reconciliation.':`Owned engine CLI failed (${code}); diagnostic retained privately.`));});
      child.stdin.on('error',()=>{});child.stdin.end(stdin);
    });
  }
  private command(g:Generation,args:string[]):string[]{return g.manifest?.provider==='applehv'?['--connection',g.facts!.machineName!,...args]:['--root',path.join(g.facts!.canonicalStorage,'storage'),'--runroot',path.join(g.facts!.canonicalStorage,'runroot'),...(args[0]==='load'?['load','--signature-policy',g.rootlessPolicy!.file,...args.slice(1)]:args)];}
  private async initializeRootlessPolicy(g:Generation):Promise<void>{
    const image=g.manifest!.image,archive=path.join(g.root!,image.file),info=await lstat(archive).catch(()=>undefined);
    if(g.files?.[image.file]!==image.sha256||!info?.isFile()||info.size!==image.bytes||await realpath(archive)!==archive||!archive.startsWith(g.root!+path.sep))throw new Error('Fixed engine image archive path/manifest identity differs; no import admitted.');
    const digest=createHash('sha256');for await(const bytes of createReadStream(archive))digest.update(bytes);
    if(digest.digest('hex')!==image.sha256)throw new Error('Fixed engine image archive bytes differ; no import admitted.');
    const file=path.join(g.facts!.canonicalStorage,'config/containers/policy.json');await mkdir(path.dirname(file),{mode:0o700});
    // This admits only the hash-bound offline fixture. It is not signature authenticity.
    const bytes=JSON.stringify({default:[{type:'reject'}],transports:{'oci-archive':{[archive]:[{type:'insecureAcceptAnything'}]}}});
    await writeFile(file,bytes,{flag:'wx',mode:0o600});g.rootlessPolicy={file,sha256:sha(bytes)};
  }
  private async verifyRootlessConfiguration(g:Generation):Promise<void>{
    if(!g.rootlessPolicy||!g.facts?.configSha256)throw new Error('Owned rootless signature policy identity is missing; no control admitted.');
    for(const [file,expected] of [[path.join(g.facts.canonicalStorage,'containers.conf'),g.facts.configSha256],[g.rootlessPolicy.file,g.rootlessPolicy.sha256]]){
      const info=await lstat(file!).catch(()=>undefined);
      if(!info?.isFile()||info.uid!==process.getuid?.()||(info.mode&0o777)!==0o600||await realpath(file!)!==file||sha(await readFile(file!,'utf8'))!==expected)throw new Error('Owned rootless configuration/signature policy drift; no control admitted.');
    }
  }
  private async inspectMachine(g:Generation):Promise<any>{const rows=JSON.parse(await this.cli(g,['machine','inspect',g.facts!.machineName!]));if(!Array.isArray(rows)||rows.length!==1||rows[0].Name!==g.facts!.machineName)throw new Error('Private machine identity differs.');if(g.facts!.machineCreatedAt&&rows[0].Created!==g.facts!.machineCreatedAt)throw new Error('Private machine creation identity drift; no control admitted.');return rows[0];}
  private async verifyPrivateConnection(g:Generation,admit=false):Promise<void>{
    const facts=g.facts!;const machine=await this.inspectMachine(g);
    if(!facts.machineCreatedAt||machine.State!=='running')throw new Error('Owned machine identity/readiness missing before connection control.');
    if(sha(await readFile(g.env!.CONTAINERS_CONF!,'utf8'))!==facts.configSha256)throw new Error('Owned engine configuration drift; no connection control admitted.');
    const connections=JSON.parse(await this.cli(g,['system','connection','list','--format','json']));
    if(!Array.isArray(connections)||connections.filter((c:any)=>c.Name===facts.machineName).length!==1||connections.some((c:any)=>c.Name!==facts.machineName&&c.Name!==`${facts.machineName}-root`))throw new Error('Private connection inventory identity differs.');
    const connection=connections.find((c:any)=>c.Name===facts.machineName);
    const uri=new URL(connection.URI);const ssh=machine.SSHConfig;
    if(connection.IsMachine!==true||uri.protocol!=='ssh:'||uri.hostname!=='127.0.0.1'||uri.username!==ssh?.RemoteUsername||Number(uri.port)!==ssh?.Port||uri.pathname!==`/run/user/${process.getuid?.()}/podman/podman.sock`||uri.password||uri.search||uri.hash||connection.Identity!==ssh?.IdentityPath||!(await realpath(connection.Identity)).startsWith(facts.canonicalStorage+path.sep))throw new Error('Private connection endpoint/key is not bound to the owned machine.');
    const current=sha(JSON.stringify(connection));
    if(facts.connectionSha256&&facts.connectionSha256!==current)throw new Error('Admitted private connection identity drift; no control admitted.');
    if(!facts.connectionSha256&&!admit)throw new Error('Private connection has no admitted identity.');
    const helpers=await this.helperIdentities(g);if(helpers.length<g.manifest!.helpers.length)throw new Error('Owned native helper start identities are incomplete.');
    if(facts.helpers.length&&JSON.stringify(helpers)!==JSON.stringify(facts.helpers))throw new Error('Owned native helper start identity drift.');
    if(!facts.helpers.length)facts.helpers=helpers;
    if(!facts.connectionSha256)facts.connectionSha256=current;
  }
  private async helperIdentities(g:Generation):Promise<Array<{pid:number;startIdentity:string}>>{
    const visible=await this.visibleHelperIdentities(g);
    if(g.manifest!.provider==='rootless'){const keeper=await this.rootlessKeeperIdentity(g);if(keeper&&!visible.some(h=>h.pid===keeper.pid))visible.push({pid:keeper.pid,startIdentity:keeper.startIdentity});}
    return visible;
  }
  private async visibleHelperIdentities(g:Generation):Promise<Array<{pid:number;startIdentity:string}>>{
    const {stdout}=await promisify(execFile)('/bin/ps',['-axo','pid=,lstart=,command='],{maxBuffer:4*1024*1024});const helpers=g.manifest!.helpers.map(p=>path.join(g.root!,p));
    return stdout.split('\n').filter(line=>helpers.some(h=>line.includes(h))&& (line.includes(g.facts!.machineName??g.facts!.canonicalStorage)||line.includes(g.facts!.canonicalStorage))).map(line=>({pid:Number(line.trim().split(/\s+/)[0]),startIdentity:sha(line.trim())}));
  }
  private async rootlessKeeperIdentity(g:Generation):Promise<RootlessKeeper|undefined>{
    const file=path.join(g.facts!.canonicalStorage,'run/libpod/tmp/pause.pid'),info=await lstat(file).catch(error=>{if(error.code==='ENOENT')return undefined;throw error;});
    if(!info){if(g.rootlessKeeper||process.platform==='linux')throw new Error('Owned rootless pause PID identity is missing; no control admitted.');return undefined;}
    if(!info.isFile()||info.uid!==process.getuid?.()||(info.mode&0o022)!==0||info.size>32||await realpath(file)!==file)throw new Error('Owned rootless pause PID file identity differs; no control admitted.');
    const raw=(await readFile(file,'utf8')).trim();if(!/^[1-9]\d*$/.test(raw)||!Number.isSafeInteger(Number(raw)))throw new Error('Owned rootless pause PID is invalid; no control admitted.');
    const pid=Number(raw),proc=`/proc/${pid}`,executable=path.join(g.root!,g.manifest!.executable),expected=g.files?.[g.manifest!.executable];
    const [status,processStat,environment,actualExe,loaded,asset]=await Promise.all([readFile(path.join(proc,'status'),'utf8'),readFile(path.join(proc,'stat'),'utf8'),readFile(path.join(proc,'environ'),'utf8'),realpath(path.join(proc,'exe')),stat(path.join(proc,'exe')),lstat(executable)]);
    const uid=status.match(/^Uid:\s+(\d+)\s+(\d+)/m),fields=processStat.slice(processStat.lastIndexOf(')')+1).trim().split(/\s+/),birth=fields[19];
    if(Number(uid?.[1])!==process.getuid?.()||Number(uid?.[2])!==process.getuid?.()||!processStat.startsWith(`${pid} (podman pause) `)||['Z','X'].includes(fields[0]!)||!birth||!/^\d+$/.test(birth))throw new Error('Owned rootless pause UID/birth identity differs; no control admitted.');
    if(!expected||!asset.isFile()||await realpath(executable)!==executable||actualExe!==executable||loaded.dev!==asset.dev||loaded.ino!==asset.ino)throw new Error('Owned rootless pause loaded executable identity is unqualified; retain unknown helper.');
    const digest=createHash('sha256');for await(const bytes of createReadStream(executable))digest.update(bytes);if(digest.digest('hex')!==expected)throw new Error('Owned rootless pause executable bytes differ; no control admitted.');
    const values=environment.split('\0');const ownedEnvironment=['HOME','XDG_CONFIG_HOME','XDG_DATA_HOME','XDG_RUNTIME_DIR','TMPDIR','CONTAINERS_CONF'].map(key=>{const matches=values.filter(value=>value.startsWith(key+'='));if(matches.length!==1||matches[0]!==`${key}=${g.env![key]}`)throw new Error('Owned rootless pause environment identity differs; no control admitted.');return matches[0];});
    const keeper={file,pid,startIdentity:sha(JSON.stringify({pid,birth,uid:Number(uid![1]),executable,dev:loaded.dev,ino:loaded.ino,sha256:expected,environment:ownedEnvironment}))};
    if(g.rootlessKeeper&&(g.rootlessKeeper.pid!==pid||g.rootlessKeeper.startIdentity!==keeper.startIdentity))throw new Error('Owned rootless pause start identity drift; no control admitted.');
    g.rootlessKeeper??=keeper;return keeper;
  }
  private async launch(g:Generation):Promise<TeamServiceReceipt>{
    try{await this.receipt(g,'start');const installedManifest=await this.options.readManifest();const metadata=installedManifest.engineeringEngine;g.files=installedManifest.files?freezeSnapshot(structuredClone(installedManifest.files)):undefined;if(!metadata)throw new Error('Install the matching fixed private-engine closure; Guide remains available.');g.manifest=metadata;const generations=path.join(await realpath(this.options.home),'hima/team-services/engineering-engine');for(const name of await readdir(generations).catch(()=>[])){const marker=JSON.parse(await readFile(path.join(generations,name,'generation.json'),'utf8'));if(marker.quiescent!==true)throw new Error('Interrupted engine generation requires exact resource reconciliation; no automatic takeover.');}g.root=await realpath(this.options.runtimeDirectory!);
      const canonical=path.join(await realpath(this.options.home),'hima/team-services/engineering-engine',g.id);await mkdir(canonical,{recursive:true,mode:0o700});
      // Owned short HOME is a real directory, never an unchecked alias into a user home.
      const alias=await import('node:fs/promises').then(fs=>fs.mkdtemp(path.join(os.tmpdir(),'he-')));await import('node:fs/promises').then(fs=>fs.chmod(alias,0o700));const short=path.join(alias,'h');await symlink(canonical,short);if((await lstat(alias)).uid!==process.getuid?.()||await realpath(short)!==canonical)throw new Error('Owned short Home alias failed identity/containment.');
      const directories=['config','data','run','tmp','transfer'];for(const d of directories)await mkdir(path.join(short,d),{mode:0o700});
      g.facts={provider:metadata.provider,platform:`${process.platform}-${process.arch}`,canonicalStorage:canonical,shortHome:short,helpers:[],namespaces:[],closure:{containers:false,machine:false,helpers:false},qualification:'trusted-fixture-only',...(metadata.provider==='applehv'?{machineName:`he-${g.id.slice(0,12)}`}:{})};
      await writeFile(path.join(canonical,'generation.json'),JSON.stringify({generation:g.id,shortHome:short,state:'starting'}),{mode:0o600,flag:'wx'});
      const conf='[machine]\nprovider="applehv"\nrosetta=false\nvolumes=[]\n';await writeFile(path.join(short,'containers.conf'),conf,{mode:0o600});await writeFile(path.join(short,'connections.json'),'{}',{mode:0o600});
      g.facts.configSha256=sha(conf);g.env={HOME:short,XDG_CONFIG_HOME:path.join(short,'config'),XDG_DATA_HOME:path.join(short,'data'),XDG_RUNTIME_DIR:path.join(short,'run'),TMPDIR:path.join(short,'tmp'),PODMAN_CONNECTIONS_CONF:path.join(short,'connections.json'),CONTAINERS_CONF:path.join(short,'containers.conf'),PATH:[path.dirname(path.join(g.root,metadata.executable)),path.join(g.root,'bin'),'/usr/bin','/bin'].join(path.delimiter),CONTAINERS_HELPER_BINARY_DIR:path.dirname(path.join(g.root,metadata.helpers[0]!))};
      if(Buffer.byteLength(path.join(short,'.podman',`${g.facts.machineName??'rootless'}-api.sock`))>=103)throw new Error('Private engine socket path is too long.');
      if(g.fenced)throw new Error('Generation stopped before engine initialization.');
      if(metadata.provider==='applehv'){
        await this.cli(g,['machine','init','--provider','applehv','--image',path.join(g.root,metadata.machineImage!.file),'--cpus','2','--memory','2048','--disk-size','10','--volume',`${path.join(short,'transfer')}:/mnt/hima-transfer:ro`,g.facts.machineName!]);
        const initialized=await this.inspectMachine(g);if(typeof initialized.Created!=='string')throw new Error('Private machine creation identity missing.');g.facts.machineCreatedAt=initialized.Created;if(initialized.Rosetta!==false || initialized.Rootful!==false || initialized.Resources?.CPUs!==2 || initialized.Resources?.Memory!==2048 || initialized.Resources?.DiskSize!==10 || !(await realpath(initialized.ConfigDir?.Path)).startsWith(canonical+path.sep))throw new Error('Observed private machine provider/resource/config boundary differs.');if(initialized.State!=='stopped')throw new Error('Private machine did not initialize stopped.');
        if(g.fenced)throw new Error('Generation stopped before machine start.');await this.cli(g,['machine','start','--update-connection=false',g.facts.machineName!]);await this.verifyPrivateConnection(g,true);
      }else {if(process.getuid?.()===0)throw new Error('Engineering engine requires rootless Linux identity.');await this.initializeRootlessPolicy(g);}
      await this.cli(g,this.command(g,['load','--input',path.join(g.root,metadata.image.file)]),undefined,undefined,'initial-import');
      const image=JSON.parse(await this.cli(g,this.command(g,['image','inspect',`sha256:${metadata.image.configSha256}`])))[0];
      if(image?.Id?.replace(/^sha256:/,'')!==metadata.image.configSha256 || image.Architecture!==(metadata.guestPlatform==='linux-arm64'?'arm64':'amd64'))throw new Error('Observed guest image identity/architecture differs.');g.facts.imageDigest=`sha256:${metadata.image.configSha256}`;
      await this.observe(g);if(g.fenced)throw new Error('Generation stopped during readiness.');g.state='running';
    }catch(error){g.state='unavailable';g.diagnostic={code:'engine-start',message:(error as Error).message};}
    return this.receipt(g,'start');
  }
  private async observe(g:Generation):Promise<void>{
    const image=JSON.parse(await this.cli(g,this.command(g,['image','inspect',g.facts!.imageDigest!])))[0];if(image?.Id?.replace(/^sha256:/,'')!==g.manifest!.image.configSha256)throw new Error('Observed immutable image identity changed.');
    if(g.manifest!.provider==='applehv'){
      const machine=await this.inspectMachine(g);if(machine.State!=='running')throw new Error('Owned private machine is not observed running.');const socket=machine.ConnectionInfo?.PodmanSocket?.Path;
      if(typeof socket!=='string'||!socket.startsWith(path.dirname(g.env!.HOME!)+path.sep))throw new Error('Observed engine socket is outside private Home.');
      await new Promise<void>((resolve,reject)=>{const req=httpRequest({socketPath:socket,path:'/_ping',timeout:1000},res=>{let body='';res.on('data',b=>body+=b);res.on('end',()=>res.statusCode===200&&body==='OK'?resolve():reject(new Error('Engine ping not ready.')));});req.on('error',reject);req.on('timeout',()=>req.destroy(new Error('Engine ping timeout.')));req.end();});
      await this.verifyPrivateConnection(g);
      const helpers=await this.helperIdentities(g);if(helpers.length<g.manifest!.helpers.length)throw new Error('Owned native helper start identities are incomplete.');if(g.facts!.helpers.length && JSON.stringify(helpers)!==JSON.stringify(g.facts!.helpers))throw new Error('Owned native helper start identity drift.');g.facts!.helpers=helpers;
    }else{const info=JSON.parse(await this.cli(g,this.command(g,['info','--format','json'])));if(info.host?.security?.rootless!==true)throw new Error('Guest engine is not observed rootless.');g.facts!.helpers=await this.helperIdentities(g);}
    for(const lease of g.facts!.namespaces){if(Date.parse(lease.validUntil)<=Date.now())throw new Error('Namespace policy expired; readiness revoked.');const inspected=await this.container(g,lease.containerId);if(!lease.observedRulesSha256||!inspected.State.Running||`${inspected.State.Pid}:${inspected.State.StartedAt}`!==lease.guestPidIdentity)throw new Error('Owned namespace identity changed.');const pid=inspected.State.Pid,policy=g.policies.get(lease.containerId);if(!policy)throw new Error('Namespace timed admission is missing.');const timing:HostClockTiming={hostBeforeMs:0,hostAfterMs:0};const observed=await this.guest(g,['podman','unshare','nsenter',`--net=/proc/${pid}/ns/net`,'nft','-j','-T','list','ruleset'],undefined,timing);verifyObservedEngineeringRules(observed,policy.tuples,policy,timing.hostAfterMs);}
  }
  private async container(g:Generation,id:string):Promise<any>{const rows=JSON.parse(await this.cli(g,this.command(g,['container','inspect',id])));const c=rows[0];if(rows.length!==1||c?.Id!==id||c.Config?.Labels?.['hima.engine-generation']!==g.id)throw new Error('Owned container identity mismatch; resource retained.');return c;}
  async status():Promise<TeamServiceReceipt>{const g=this.generation??(this.generation=this.empty());if(g.state!=='running')return this.receipt(g,'status');
    // Snapshot before registering this observation so it never waits on itself.
    const prior=[...g.pending],pending=(async()=>{await Promise.allSettled(prior);if(g.state==='running'&&!g.fenced)try{await this.observe(g);}catch(error){g.state='failed';g.fenced=true;g.diagnostic={code:'engine-observation',message:(error as Error).message};}return this.receipt(g,'status');})();
    g.pending.add(pending);try{return await pending;}finally{g.pending.delete(pending);}
  }
  prepareNamespace(request:EngineeringNamespaceRequest):Promise<EngineeringNamespaceLease>{const g=this.generation;
    if(!g||g.fenced||g.exporting||g.state!=='running'||request.engineGeneration!==g.id)return Promise.reject(new Error('Current unfenced engine generation required.'));
    if(request.taskIdentity.fixture!=='trusted-namespace-test'||!/^[A-Za-z0-9_-]{1,128}$/.test(request.taskIdentity.taskId))return Promise.reject(new Error('Only the explicit trusted namespace fixture is admitted; member activation remains blocked.'));
    let compiled:ReturnType<typeof compileEngineeringPolicy>;try{compiled=compileEngineeringPolicy(request.policy);if(compiled.nativeLoopbackPort)throw new Error('Native loopback requires an owned member namespace.');}catch(error){return Promise.reject(error);}
    const frozenRequest=freezeSnapshot(structuredClone(request));
    const pending=this.prepare(g,frozenRequest,compiled).catch(async error=>{g.fenced=true;g.state='failed';g.diagnostic={code:'namespace-policy',message:(error as Error).message};await this.receipt(g,'status');throw error;});g.pending.add(pending);void pending.finally(()=>g.pending.delete(pending)).catch(()=>{});return pending;
  }
  prepareMemberNamespace(request:{engineGeneration:string;memberKey:string;policy:EngineeringEgressPolicy;deadlineAt:string}):Promise<EngineeringNamespaceLease> {
    const g=this.generation;
    if(!g||g.fenced||g.exporting||g.state!=='running'||request.engineGeneration!==g.id)return Promise.reject(new Error('Current unfenced engine generation required.'));
    if(!/^[A-Za-z0-9_-]{1,128}$/.test(request.memberKey))return Promise.reject(new Error('Member key must be stable safe ASCII.'));
    const deadline=Date.parse(request.deadlineAt);
    if(!Number.isFinite(deadline)||deadline<=Date.now())return Promise.reject(new Error('Member deadline must be live.'));
    let compiled:CompiledEngineeringPolicy;try{compiled=compileEngineeringPolicy(request.policy);this.memberHostBindings(request.policy);}catch(error){return Promise.reject(error);}
    const key=`${g.id}:${request.memberKey}`,inFlight=this.memberPreparations.get(key);if(inFlight)return inFlight;
    const existing=g.facts!.namespaces.find(n=>n.memberKey===request.memberKey);
    const operation=existing?(async()=>{if(existing.policySha256!==request.policy.sha256)throw new Error('Existing member policy differs.');await this.memberIdentity(existing);return Object.freeze({...existing});})():this.prepare(g,freezeSnapshot({engineGeneration:g.id,taskIdentity:{taskId:request.memberKey,fixture:'trusted-namespace-test' as const},policy:structuredClone(request.policy)}),compiled,request.memberKey,request.deadlineAt).then(lease=>{this.memberStaged.set(lease.namespaceGeneration,new Set());this.memberDeadlines.set(lease.namespaceGeneration,deadline);return lease;});
    this.memberPreparations.set(key,operation);g.pending.add(operation);void operation.finally(()=>{this.memberPreparations.delete(key);g.pending.delete(operation);}).catch(()=>{});return operation;
  }
  private memberHostBindings(policy:EngineeringEgressPolicy):string[] {
    if(policy.approvedOrigins.length!==1)throw new Error('Member namespace requires exactly one approved origin for an exact hostname mapping.');
    const hostname=new URL(policy.approvedOrigins[0]!).hostname;const address=hostname.startsWith('[')&&hostname.endsWith(']')?hostname.slice(1,-1):hostname;
    if(isIP(address)){if(policy.resolvedTuples.some(tuple=>tuple.address!==address))throw new Error('Literal member origin differs from admitted destination tuples.');return [];}
    if(hostname.length>253||!hostname.split('.').every(label=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)))throw new Error('Member origin requires an ordinary canonical hostname or literal IP.');
    return policy.resolvedTuples.map(tuple=>`${hostname}:${tuple.address}`);
  }
  private verifyMemberHosts(c:any,expected:readonly string[]):void {
    const observed=c.HostConfig?.ExtraHosts??c.Config?.ExtraHosts;
    if(observed!==undefined&&observed!==null&&(!Array.isArray(observed)||!isDeepStrictEqual([...observed].sort(),[...expected].sort())))throw new Error('Owned member hostname bindings differ from admitted policy.');
  }
  private async memberIdentity(lease:EngineeringNamespaceLease,cleanup=false):Promise<Generation> {
    const g=this.generation;
    if(!g||g.id!==lease.engineGeneration||!lease.memberKey||!g.facts?.namespaces.some(n=>isDeepStrictEqual(n,lease)))throw new Error('Current owned member lease required.');
    if(!cleanup&&(this.memberClosing.has(lease.namespaceGeneration)||this.closed||g.fenced||g.exporting||g.state!=='running'||Date.parse(lease.validUntil)<=Date.now()))throw new Error('Member lease fenced or expired.');
    const c=await this.container(g,lease.containerId);this.verifyMemberHosts(c,lease.memberHosts??[]);
    if(c.Config?.Labels?.['hima.namespace-generation']!==lease.namespaceGeneration||c.Config?.Labels?.['hima.member-key']!==lease.memberKey||(c.State.Running?`${c.State.Pid}:${c.State.StartedAt}`!==lease.guestPidIdentity:!cleanup||c.State.StartedAt!==lease.guestPidIdentity.slice(lease.guestPidIdentity.indexOf(':')+1))||c.Image!==undefined&&String(c.Image).replace(/^sha256:/,'')!==lease.imageDigest.replace(/^sha256:/,''))throw new Error('Owned member container birth identity differs.',{cause:{expected:{namespaceGeneration:lease.namespaceGeneration,memberKey:lease.memberKey,guestPidIdentity:lease.guestPidIdentity,image:lease.imageDigest},observed:{namespaceGeneration:c.Config?.Labels?.['hima.namespace-generation'],memberKey:c.Config?.Labels?.['hima.member-key'],pid:c.State.Pid,startedAt:c.State.StartedAt,running:c.State.Running,image:c.Image}}});
    if(!cleanup){const policy=g.policies.get(lease.containerId);if(!policy)throw new Error('Member policy admission is missing.');const timing={hostBeforeMs:0,hostAfterMs:0};const rules=await this.guest(g,['podman','unshare','nsenter',`--net=/proc/${c.State.Pid}/ns/net`,'nft','-j','-T','list','ruleset'],undefined,timing);verifyObservedEngineeringRules(rules,policy.tuples,policy,timing.hostAfterMs);if(g.fenced||Date.parse(lease.validUntil)<=Date.now())throw new Error('Member lease fenced or expired during observation.');}
    return g;
  }
  private memberOperation<T>(lease:EngineeringNamespaceLease,work:(g:Generation)=>Promise<T>):Promise<T> {
    const g=this.generation;if(!g||g.id!==lease.engineGeneration)return Promise.reject(new Error('Current owned member lease required.'));
    const pending=(async()=>work(await this.memberIdentity(lease)))();g.pending.add(pending);void pending.finally(()=>g.pending.delete(pending)).catch(()=>{});return pending;
  }
  stageMember(lease:EngineeringNamespaceLease,files:readonly {path:string;bytes:Uint8Array}[]):Promise<void> {
    const copy=files.map(file=>({path:file.path,bytes:Buffer.from(file.bytes)}));
    if(copy.length>64||new Set(copy.map(f=>f.path)).size!==copy.length||copy.some(f=>!/^\/hima-home\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+$/.test(f.path)||f.path.split('/').some(p=>p==='.'||p==='..')||f.bytes.length>1024*1024))return Promise.reject(new Error('Stage requires bounded plain /hima-home paths.'));
    return this.memberOperation(lease,async g=>{
      if(this.memberStarted.has(lease.namespaceGeneration)&&copy.some(file=>!file.path.startsWith('/hima-home/replies/')&&!file.path.startsWith('/hima-home/inbox/')))throw new Error('Running member accepts only scoped replies.');
      for(const file of copy){
        const name=`member-${randomUUID()}`,host=path.join(g.facts!.canonicalStorage,'transfer',name),guest=`/tmp/${name}`;
        await writeFile(host,file.bytes,{flag:'wx',mode:0o600});
        try{await this.memberIdentity(lease);await this.cli(g,this.command(g,['cp',host,`${lease.containerId}:${guest}`]));
          await this.memberIdentity(lease);
          const script="const fs=require('node:fs'),p=require('node:path');const [source,target]=process.argv.slice(1);const root='/hima-home',flags=fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW;let dir=fs.openSync(root,flags);try{for(const part of p.relative(root,p.dirname(target)).split('/').filter(Boolean)){const entry='/proc/self/fd/'+dir+'/'+part;try{fs.mkdirSync(entry,{mode:448});}catch(e){if(e.code!=='EEXIST')throw e;}const next=fs.openSync(entry,flags);fs.closeSync(dir);dir=next;}const input=fs.openSync(source,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);try{const info=fs.fstatSync(input);if(!info.isFile()||info.size>1048576)throw Error('Stage source not bounded plain file');const entry='/proc/self/fd/'+dir+'/'+p.basename(target);const out=fs.openSync(entry,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK,384);try{if(!fs.fstatSync(out).isFile())throw Error('Stage target not plain');fs.ftruncateSync(out,0);fs.writeFileSync(out,fs.readFileSync(input));}finally{fs.closeSync(out);}}finally{fs.closeSync(input);fs.unlinkSync(source);}}finally{fs.closeSync(dir);}";
          await this.cli(g,this.command(g,['exec',lease.containerId,'/usr/local/bin/node','-e',script,guest,file.path]));this.memberStaged.get(lease.namespaceGeneration)?.add(file.path);
        }finally{await rm(host,{force:true});}
      }
    });
  }
  startMember(lease:EngineeringNamespaceLease):Promise<void> {
    return this.memberOperation(lease,async g=>{const staged=this.memberStaged.get(lease.namespaceGeneration);if(!staged?.has('/hima-home/runner.mjs')||!staged.has('/hima-home/config.json')||!staged.has('/hima-home/confinement.py'))throw new Error('Member runner and config must be staged before start.');
      if(this.memberStarted.has(lease.namespaceGeneration))throw new Error('Member start already submitted; observe retained state.');
      await this.memberIdentity(lease);if(this.memberStarted.has(lease.namespaceGeneration))throw new Error('Member start already submitted; observe retained state.');this.memberStarted.add(lease.namespaceGeneration);
      await this.cli(g,this.command(g,['exec','--detach',lease.containerId,'/bin/sh','-c','exec /usr/local/bin/node /hima-home/runner.mjs /hima-home/config.json > /hima-home/supervisor.log 2>&1']));
      await this.receipt(g,'status');
    });
  }
  readMember(lease:EngineeringNamespaceLease):Promise<{journal:string;result:string|null;state:string|null;requests:readonly {id:string;body:string}[]}> {
    return this.memberOperation(lease,async g=>{
      const script="const fs=require('node:fs');const root='/hima-home',dirFlags=fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW;const rootFd=fs.openSync(root,dirFlags);function read(dir,name,limit){let fd;try{fd=fs.openSync('/proc/self/fd/'+dir+'/'+name,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);}catch(e){if(e.code==='ENOENT')return null;throw e;}try{const st=fs.fstatSync(fd);if(!st.isFile()||st.size>limit)throw Error('Member retained file exceeds bound or is not plain');const bytes=Buffer.alloc(limit+1);let count=0,n;while((n=fs.readSync(fd,bytes,count,bytes.length-count,null))>0){count+=n;if(count>limit)throw Error('Member retained file exceeds bound');}return bytes.subarray(0,count).toString('base64');}finally{fs.closeSync(fd);}}try{if(process.argv[1]==='files')console.log(JSON.stringify({journal:read(rootFd,'journal.jsonl',1048576),result:read(rootFd,'result.json',262144),state:read(rootFd,'state.json',65536)}));else{let dir;try{const native=fs.openSync('/proc/self/fd/'+rootFd+'/native',dirFlags);try{dir=fs.openSync('/proc/self/fd/'+native+'/requests',dirFlags);}finally{fs.closeSync(native);}}catch(e){if(e.code!=='ENOENT')throw e;}if(dir===undefined)console.log('[]');else try{const names=fs.readdirSync('/proc/self/fd/'+dir);if(names.length>64)throw Error('Request count exceeds bound');console.log(JSON.stringify(names.sort().map(name=>{if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\\.json$/.test(name))throw Error('Request id invalid');return {id:name.slice(0,-5),body:read(dir,name,16384)};})));}finally{fs.closeSync(dir);}}}finally{fs.closeSync(rootFd);} ";
      const command=(mode:string)=>this.cli(g,this.command(g,['exec',lease.containerId,'/usr/local/bin/node','-e',script,mode]));
      const files=JSON.parse(await command('files'));await this.memberIdentity(lease);const requests=JSON.parse(await command('requests')) as Array<{id:string;body:string|null}>;const decode=(value:string|null)=>value===null?null:Buffer.from(value,'base64').toString('utf8');
      await this.memberIdentity(lease);return {journal:decode(files.journal)??'',result:decode(files.result),state:decode(files.state),requests:requests.filter(r=>r.body!==null).map(r=>({id:r.id,body:decode(r.body)!}))};
    });
  }
  readMemberArtifact(lease:EngineeringNamespaceLease,relativePath:string,offset=0,limit=65536):Promise<{bytes:Uint8Array;total:number}> {
    if(!relative.safeParse(relativePath).success||relativePath.includes('\\')||!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>65536)return Promise.reject(new Error('Artifact read requires a plain relative path and bounded offset/chunk.'));
    return this.memberOperation(lease,async g=>{
      const script="const fs=require('node:fs');const [name,rawOffset,rawLimit]=process.argv.slice(1),offset=Number(rawOffset),limit=Number(rawLimit),parts=name.split('/'),flags=fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW;let dir=fs.openSync('/hima-work',flags);try{for(const part of parts.slice(0,-1)){const next=fs.openSync('/proc/self/fd/'+dir+'/'+part,flags);fs.closeSync(dir);dir=next;}const fd=fs.openSync('/proc/self/fd/'+dir+'/'+parts.at(-1),fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);try{const before=fs.fstatSync(fd);if(!before.isFile()||before.size>16777216||offset>before.size)throw Error('Member artifact is not a bounded regular file or offset exceeds size');const bytes=Buffer.alloc(Math.min(limit,before.size-offset));let count=0,n;while(count<bytes.length&&(n=fs.readSync(fd,bytes,count,bytes.length-count,offset+count))>0)count+=n;const after=fs.fstatSync(fd);if(count!==bytes.length||before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs)throw Error('Member artifact changed during chunk read');console.log(JSON.stringify({bytes:bytes.toString('base64'),total:before.size}));}finally{fs.closeSync(fd);}}finally{fs.closeSync(dir);}";
      const result=JSON.parse(await this.cli(g,this.command(g,['exec',lease.containerId,'/usr/local/bin/node','-e',script,relativePath,String(offset),String(limit)]))) as {bytes:string;total:number};
      if(!Number.isSafeInteger(result.total)||result.total<offset||result.total>16777216||typeof result.bytes!=='string')throw new Error('Member artifact chunk response is invalid.');const bytes=Buffer.from(result.bytes,'base64');await this.memberIdentity(lease);if(bytes.length!==Math.min(limit,result.total-offset))throw new Error('Member artifact chunk byte count differs.');return {bytes,total:result.total};
    });
  }
  replyMember(lease:EngineeringNamespaceLease,id:string,body:string):Promise<void> {
    if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)||Buffer.byteLength(body)>16384)return Promise.reject(new Error('Reply requires a safe UUID and bounded body.'));
    return this.stageMember(lease,[{path:`/hima-home/replies/${id}.json`,bytes:Buffer.from(body)}]);
  }
  sendMemberInput(lease:EngineeringNamespaceLease,id:string,input:string):Promise<void> {
    if(!/^(?:delivery-)?[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)||Buffer.byteLength(input)>16384)return Promise.reject(new Error('Input requires a safe UUID and bounded body.'));
    return this.stageMember(lease,[{path:`/hima-home/inbox/${id}.json`,bytes:Buffer.from(input)}]);
  }
  renewMemberPolicy(lease:EngineeringNamespaceLease,policy:EngineeringEgressPolicy):Promise<EngineeringNamespaceLease> {
    return this.memberOperation(lease,async g=>{const prior=g.policies.get(lease.containerId)!;const next=compileEngineeringPolicy(policy);if(!isDeepStrictEqual(prior.approvedOrigins,next.approvedOrigins)||!isDeepStrictEqual(prior.tuples,next.tuples)||prior.nativeLoopbackPort!==next.nativeLoopbackPort)throw new Error('Member renewal cannot widen resolved destinations.');let compiled=await this.clockPolicy(g,policy);compiled=await this.installPolicy(g,Number(lease.guestPidIdentity.split(':')[0]),compiled);const timing={hostBeforeMs:0,hostAfterMs:0};const rules=await this.guest(g,['podman','unshare','nsenter',`--net=/proc/${lease.guestPidIdentity.split(':')[0]}/ns/net`,'nft','-j','-T','list','ruleset'],undefined,timing);verifyObservedEngineeringRules(rules,compiled.tuples,compiled,timing.hostAfterMs);if(g.fenced)throw new Error('Member renewal fenced.');const renewed=Object.freeze({...lease,policySha256:policy.sha256,validUntil:new Date(Math.min(this.memberDeadlines.get(lease.namespaceGeneration)!,Date.parse(policy.validUntil))).toISOString(),observedRulesSha256:sha(rules)});g.policies.set(lease.containerId,compiled);g.facts!.namespaces=g.facts!.namespaces.map(value=>value.containerId===lease.containerId?renewed:value);await this.receipt(g,'status');if(this.generation!==g||g.fenced||this.closed||Date.parse(renewed.validUntil)<=Date.now())throw new Error('Member renewal readiness handoff fenced or expired.');return renewed;});
  }
  private retainMemberClosure(g:Generation,lease:EngineeringNamespaceLease):{closed:true;proof:{containerId:string;namespaceGeneration:string;observedAbsent:true}} {
    const proof={containerId:lease.containerId,namespaceGeneration:lease.namespaceGeneration,observedAbsent:true as const};
    const rows=g.facts!.memberClosures??(g.facts!.memberClosures=[]);if(!rows.some(row=>isDeepStrictEqual(row.lease,lease)))rows.push({lease:Object.freeze({...lease}),proof});
    return {closed:true,proof};
  }
  async closeMember(lease:EngineeringNamespaceLease):Promise<{closed:boolean;reason?:string;proof?:unknown}> {
    try{
      const g=this.generation;if(!g||g.id!==lease.engineGeneration||!lease.memberKey)throw new Error('Current owned member lease required.');
      const retained=g.facts?.memberClosures?.find(row=>isDeepStrictEqual(row.lease,lease));if(retained)return {closed:true,proof:structuredClone(retained.proof)};
      if(!g.facts?.namespaces.some(value=>isDeepStrictEqual(value,lease)))throw new Error('Current owned member lease required.');
      this.memberClosing.add(lease.namespaceGeneration);await Promise.allSettled([...g.pending]);const closedDuringWait=g.facts.memberClosures?.find(row=>isDeepStrictEqual(row.lease,lease));if(closedDuringWait)return {closed:true,proof:structuredClone(closedDuringWait.proof)};
      const inventory=JSON.parse(await this.cli(g,this.command(g,['ps','--all','--filter',`label=hima.namespace-generation=${lease.namespaceGeneration}`,'--format','json'])));
      if(!Array.isArray(inventory)||inventory.length>1||inventory.length===1&&(inventory[0].Id??inventory[0].ID)!==lease.containerId)throw new Error('Owned member closure inventory identity differs.');
      if(inventory.length){await this.memberIdentity(lease,true);await this.discardNamespace(g,lease);}else{g.facts.namespaces=g.facts.namespaces.filter(value=>value.containerId!==lease.containerId);g.policies.delete(lease.containerId);}
      this.memberStaged.delete(lease.namespaceGeneration);const result=this.retainMemberClosure(g,lease);await this.receipt(g,'status');return result;
    }catch(error){return {closed:false,reason:(error as Error).message};}
  }
  private async rootlessController(g:Generation):Promise<{python:string;nsenter:string;nft:string}> {
    const paths={python:'python/bin/python3.12',nsenter:'engine/bin/nsenter',nft:'engine/bin/nft'};
    for(const [role,file] of Object.entries(paths)){
      const expected=g.files?.[file];
      if(!expected||!hash.safeParse(expected).success||(role!=='python'&&!g.manifest!.helpers.includes(file)))throw new Error(`Linux namespace controller requires the manifest-bound ${file}; install the qualified Linux helper closure. No ambient helper is used.`);
      const target=path.join(g.root!,file),info=await lstat(target).catch(()=>undefined);
      if(!info?.isFile()||!(await realpath(target)).startsWith(g.root!+path.sep)||createHash('sha256').update(await readFile(target)).digest('hex')!==expected)throw new Error(`Linux namespace controller bytes/containment differ for ${file}; reinstall the qualified helper closure.`);
    }
    return {python:path.join(g.root!,paths.python),nsenter:path.join(g.root!,paths.nsenter),nft:path.join(g.root!,paths.nft)};
  }
  private async python(g:Generation,script:string,timing?:HostClockTiming):Promise<string> {
    const name=`controller-${randomUUID()}.py`,file=path.join(g.facts!.canonicalStorage,'transfer',name);
    await writeFile(file,script,{flag:'wx',mode:0o600});
    if(g.manifest!.provider==='applehv')return this.cli(g,['machine','ssh',g.facts!.machineName!,'python3',`/mnt/hima-transfer/${name}`],undefined,timing);
    const helpers=await this.rootlessController(g);
    return this.execute(g,helpers.python,[file],undefined,timing,{...g.env,PYTHONHOME:path.join(g.root!,'python'),PYTHONNOUSERSITE:'1',PYTHONDONTWRITEBYTECODE:'1'});
  }
  private async guestArguments(g:Generation,args:string[]):Promise<string[]> {
    if(g.manifest!.provider==='applehv')return args;
    if(g.rootlessRetired)throw new Error('Owned rootless generation is retired; no guest control admitted.');
    await this.verifyRootlessConfiguration(g);
    await this.rootlessKeeperIdentity(g);
    const helpers=await this.rootlessController(g);
    const mapped=args.map(value=>value==='nsenter'?helpers.nsenter:value==='nft'?helpers.nft:value==='python3'?helpers.python:value);
    return mapped[0]==='podman'?[path.join(g.root!,g.manifest!.executable),...this.command(g,mapped.slice(1))]:mapped;
  }
  private async guest(g:Generation,args:string[],stdin?:string,timing?:HostClockTiming):Promise<string> {
    // The generation-owned Python process preserves stdin/stdout/exit status. TZ applies
    // only to this observation/controller subprocess, never to the guest system clock.
    const command=await this.guestArguments(g,args),encoded=Buffer.from(stdin??'').toString('base64');
    const script=`import subprocess,sys,base64,os\nr=subprocess.run(${JSON.stringify(command)},input=base64.b64decode(${JSON.stringify(encoded)}),stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=15,env=dict(os.environ,TZ='UTC'))\nsys.stdout.buffer.write(r.stdout)\nsys.stderr.buffer.write(r.stderr)\nsys.exit(r.returncode)\n`;
    return this.python(g,script,timing);
  }
  private async clockPolicy(g:Generation,policy:EngineeringEgressPolicy):Promise<CompiledEngineeringPolicy> {
    const samples:Array<{before:number;after:number;guest:number}>=[];
    for(let i=0;i<3;i++){
      if(g.fenced)throw new Error('Namespace fenced before clock admission.');
      const timing:HostClockTiming={hostBeforeMs:0,hostAfterMs:0};
      const raw=await this.python(g,"# hima-engine-clock/1\nimport time,json\nprint(json.dumps({'operation':'hima-engine-clock/1','epochMs':time.time_ns()//1000000}))\n",timing);
      const value=JSON.parse(raw),before=timing.hostBeforeMs,after=timing.hostAfterMs,guest=value.epochMs;
      if(value.operation!=='hima-engine-clock/1'||Object.keys(value).some(key=>!['operation','epochMs'].includes(key))||![before,after,guest].every(v=>Number.isSafeInteger(v)&&v>=0)||before>after||after-before>1500||(samples.length>0&&(before<samples.at(-1)!.after||guest<samples.at(-1)!.guest)))throw new Error('Namespace clock sample is invalid, out of order or too slow.');
      samples.push({before,after,guest});
    }
    const lower=Math.max(...samples.map(s=>s.guest-s.after)),upper=Math.min(...samples.map(s=>s.guest-s.before));
    if(lower>upper||upper-lower>1000||Math.abs(lower)>1000||Math.abs(upper)>1000)throw new Error('Namespace clocks have incompatible bounds, excessive uncertainty or excessive skew.');
    return compileEngineeringPolicy(policy,samples.at(-1)!.after,lower);
  }
  private async installPolicy(g:Generation,pid:number,compiled:CompiledEngineeringPolicy):Promise<CompiledEngineeringPolicy> {
    const nft=await this.guestArguments(g,['podman','unshare','nsenter',`--net=/proc/${pid}/ns/net`,'nft']);
    const spec={operation:'hima-engine-install/1',policyBytes:compiled.bytes,cutoffEpochSeconds:compiled.deadlineEpochSeconds,maxTimeoutSeconds:compiled.timeoutSeconds,guardMs:installationGuardMs,nft};
    const script=`# hima-engine-install/1
import subprocess,time,json,sys,os
spec=json.loads(${JSON.stringify(JSON.stringify(spec))})
environment=dict(os.environ,TZ='UTC')
check=subprocess.run(spec['nft']+['-c','-f','-'],input=spec['policyBytes'].encode(),stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=10,env=environment)
if check.returncode:
 sys.stderr.buffer.write(check.stderr);sys.exit(check.returncode)
wallBefore=time.time_ns();monoBefore=time.monotonic_ns()
remainingMs=(spec['cutoffEpochSeconds']*1000000000-wallBefore)//1000000
timeoutSeconds=min((remainingMs-spec['guardMs'])//1000,spec['maxTimeoutSeconds'])
if timeoutSeconds<=0:
 sys.stderr.write('Namespace installation has insufficient remaining validity.');sys.exit(2)
policy=spec['policyBytes'].replace('timeout '+str(spec['maxTimeoutSeconds'])+'s','timeout '+str(timeoutSeconds)+'s')
result=subprocess.run(spec['nft']+['-f','-'],input=policy.encode(),stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=10,env=environment)
monoAfter=time.monotonic_ns();wallAfter=time.time_ns();elapsedMs=(monoAfter-monoBefore)/1000000
admitted=result.returncode==0 and elapsedMs<=spec['guardMs'] and wallAfter>=wallBefore and wallAfter<spec['cutoffEpochSeconds']*1000000000
report={'operation':spec['operation'],'admitted':admitted,'guardMs':spec['guardMs'],'cutoffEpochSeconds':spec['cutoffEpochSeconds'],'remainingMs':remainingMs,'timeoutSeconds':timeoutSeconds,'wallBeforeNs':str(wallBefore),'wallAfterNs':str(wallAfter),'monoBeforeNs':str(monoBefore),'monoAfterNs':str(monoAfter),'elapsedMs':elapsedMs,'nftCode':result.returncode}
if not admitted:
 revoke=subprocess.run(spec['nft']+['flush','chain','inet','hima','output'],stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=10,env=environment)
 report['revokeCode']=revoke.returncode
print(json.dumps(report))
sys.exit(0 if admitted else 3)
`;
    if(g.fenced)throw new Error('Namespace fenced before policy installation.');
    const timing:HostClockTiming={hostBeforeMs:0,hostAfterMs:0},raw=await this.python(g,script,timing),value=JSON.parse(raw);
    const allowed=['operation','admitted','guardMs','cutoffEpochSeconds','remainingMs','timeoutSeconds','wallBeforeNs','wallAfterNs','monoBeforeNs','monoAfterNs','elapsedMs','nftCode'];
    if(value.operation!=='hima-engine-install/1'||value.admitted!==true||value.nftCode!==0||value.guardMs!==installationGuardMs||value.cutoffEpochSeconds!==compiled.deadlineEpochSeconds||Object.keys(value).some(key=>!allowed.includes(key)))throw new Error('Namespace installation admission is invalid.');
    const ns=(key:string):bigint=>{if(typeof value[key]!=='string'||!/^\d+$/.test(value[key]))throw new Error('Namespace installation clock is invalid.');return BigInt(value[key]);};
    const before=ns('wallBeforeNs'),after=ns('wallAfterNs'),monoBefore=ns('monoBeforeNs'),monoAfter=ns('monoAfterNs'),remainingMs=Number((BigInt(compiled.deadlineEpochSeconds)*1000000000n-before)/1000000n);
    const timeoutSeconds=Math.min(Math.floor((remainingMs-installationGuardMs)/1000),compiled.timeoutSeconds),elapsedMs=Number(monoAfter-monoBefore)/1000000;
    if(after<before||after>=BigInt(compiled.deadlineEpochSeconds)*1000000000n||monoAfter<monoBefore||!Number.isFinite(value.elapsedMs)||value.elapsedMs!==elapsedMs||elapsedMs>installationGuardMs||!Number.isSafeInteger(remainingMs)||remainingMs<=0||remainingMs>300000||value.remainingMs!==remainingMs||!Number.isSafeInteger(value.timeoutSeconds)||value.timeoutSeconds!==timeoutSeconds||timeoutSeconds<=0||!Number.isSafeInteger(timing.hostAfterMs)||timing.hostAfterMs+timeoutSeconds*1000>Date.parse(compiled.validUntil))throw new Error('Namespace installation clock, guard or Host deadline admission failed.');
    return {...compiled,bytes:engineeringPolicyBytes(compiled.tuples,compiled.deadlineEpochSeconds,timeoutSeconds,compiled.nativeLoopbackPort),timeoutSeconds};
  }
  private async discardNamespace(g:Generation,lease:EngineeringNamespaceLease):Promise<void> {
    const c=await this.container(g,lease.containerId);
    if(c.Config?.Labels?.['hima.namespace-generation']!==lease.namespaceGeneration||c.State.Running&&`${c.State.Pid}:${c.State.StartedAt}`!==lease.guestPidIdentity)throw new Error('Failed namespace birth identity changed; retain it for reconciliation.');
    await this.cli(g,this.command(g,['stop','--time','3',lease.containerId]));await this.cli(g,this.command(g,['rm',lease.containerId]));
    const remaining=JSON.parse(await this.cli(g,this.command(g,['ps','--all','--filter',`label=hima.namespace-generation=${lease.namespaceGeneration}`,'--format','json'])));
    if(!Array.isArray(remaining)||remaining.length)throw new Error('Failed namespace removal is not observed; retain it for reconciliation.');
    g.facts!.namespaces=g.facts!.namespaces.filter(value=>value.containerId!==lease.containerId);g.policies.delete(lease.containerId);
  }
  private async prepare(g:Generation,request:EngineeringNamespaceRequest,compiled:ReturnType<typeof compileEngineeringPolicy>,memberKey?:string,deadlineAt?:string):Promise<EngineeringNamespaceLease>{
    if(g.manifest!.provider==='rootless')await this.rootlessController(g);
    const memberHosts=memberKey?this.memberHostBindings(request.policy):[];const ns=randomUUID();const id=await this.cli(g,this.command(g,['run','--pull=never','--http-proxy=false','--detach','--read-only','--tmpfs','/hima-home:rw,nosuid,nodev,size=128m,mode=0700','--tmpfs','/hima-work:rw,nosuid,nodev,size=128m,mode=0700','--tmpfs','/tmp:rw,nosuid,nodev,size=64m,mode=1777','--env','HOME=/hima-home','--env','XDG_CONFIG_HOME=/hima-home/.config','--env','XDG_DATA_HOME=/hima-home/.local/share','--env','XDG_CACHE_HOME=/hima-home/.cache','--env','XDG_STATE_HOME=/hima-home/.local/state','--env','TMPDIR=/tmp','--workdir','/hima-work','--cap-drop=ALL','--security-opt=no-new-privileges','--label',`hima.engine-generation=${g.id}`,'--label',`hima.namespace-generation=${ns}`,...(memberKey?['--hosts-file=none',...memberHosts.flatMap(value=>['--add-host',value]),'--memory=768m','--cpus=1','--pids-limit=96','--label',`hima.member-key=${memberKey}`]:[]),'--network','bridge',g.facts!.imageDigest!,'/bin/sleep','infinity']));
    if(!/^[a-f0-9]{64}$/.test(id))throw new Error('Bootstrap container ID is invalid; retain generation for reconciliation.');
    const c=await this.container(g,id);if(memberKey)this.verifyMemberHosts(c,memberHosts);if(memberKey&&(c.Config?.Labels?.['hima.namespace-generation']!==ns||c.Config?.Labels?.['hima.member-key']!==memberKey))throw new Error('Member bootstrap label identity differs; retain generation for reconciliation.');const pid=c.State.Pid;if(!Number.isSafeInteger(pid)||pid<=0||!c.State.Running)throw new Error('Owned guest PID was not observed.');
    // Register the owned container before policy I/O so stop reaps policy failures too.
    const mutable:{-readonly [K in keyof EngineeringNamespaceLease]:EngineeringNamespaceLease[K]}={engineGeneration:g.id,namespaceGeneration:ns,containerId:id,guestPidIdentity:`${pid}:${c.State.StartedAt}`,imageDigest:g.facts!.imageDigest!,policySha256:compiled.policySha256,observedRulesSha256:'',validUntil:new Date(Math.min(Date.parse(deadlineAt??request.policy.validUntil),Date.parse(request.policy.validUntil))).toISOString(),qualification:'trusted-fixture-only',...(memberKey?{memberKey,memberHosts}: {})};g.facts!.namespaces.push(mutable);
    try {
    if(memberKey)await this.receipt(g,'status');
    compiled=await this.clockPolicy(g,request.policy);
    compiled=await this.installPolicy(g,pid,compiled);g.policies.set(id,compiled);
    const timing:HostClockTiming={hostBeforeMs:0,hostAfterMs:0};
    const observed=await this.guest(g,['podman','unshare','nsenter',`--net=/proc/${pid}/ns/net`,'nft','-j','-T','list','ruleset'],undefined,timing);verifyObservedEngineeringRules(observed,compiled.tuples,compiled,timing.hostAfterMs);
    mutable.observedRulesSha256=sha(observed);if(g.fenced||Date.parse(mutable.validUntil)<=Date.now())throw new Error('Namespace fenced/expired before readiness lease.');
    await this.receipt(g,'status');
    if(this.generation!==g||this.closed||g.state!=='running'||g.fenced||g.exporting||Date.parse(mutable.validUntil)<=Date.now())throw new Error('Namespace readiness handoff is fenced, expired or no longer current.');
    return Object.freeze({...mutable});
    }catch(error){try{await this.discardNamespace(g,mutable);}catch(closure){throw new Error(`${(error as Error).message} Failed namespace closure unresolved: ${(closure as Error).message}`);}throw error;}
  }
  export(request:{cutId:string;destination:string}):Promise<TeamServiceReceipt>{const g=this.generation;if(!g||g.fenced||g.exporting||g.state!=='running')return Promise.reject(new Error('Live unfenced owned engine required for export.'));if(!/^[A-Za-z0-9_-]{1,128}$/.test(request.cutId)||!relative.safeParse(request.destination).success)return Promise.reject(new Error('Invalid engine export destination/cut.'));g.exporting=true;const pending=this.exportLive(g,request).finally(()=>{g.exporting=false;});g.pending.add(pending);void pending.finally(()=>g.pending.delete(pending)).catch(()=>{});return pending;}
  private async exportLive(g:Generation,request:{cutId:string;destination:string}):Promise<TeamServiceReceipt>{await Promise.allSettled([...g.pending]);await this.observe(g);const root=path.join(this.options.home,'hima/team-service-exports',g.id);await mkdir(root,{recursive:true,mode:0o700});const file=path.join(root,request.destination);await mkdir(path.dirname(file),{recursive:true,mode:0o700});if(!(await realpath(path.dirname(file))).startsWith(await realpath(root)+path.sep)&&await realpath(path.dirname(file))!==await realpath(root))throw new Error('Engine export path escapes private root.');const bytes=JSON.stringify({schema:'hima-engine-inventory-cut/1',generation:g.id,cutId:request.cutId,owned:g.facts,excludes:['sockets','keys','live-vm-disk']});await writeFile(file,bytes,{flag:'wx',mode:0o600});return this.receipt(g,'export',{export:{cutId:request.cutId,file,sha256:sha(bytes),bytes:Buffer.byteLength(bytes)}});}
  async stop():Promise<TeamServiceReceipt>{const g=this.generation;if(!g)return this.receipt(this.empty(),'stop');if(g.stop)return g.stop;g.fenced=true;g.state='stopping';g.stop=this.closeGeneration(g);return g.stop;}
  private async closeGeneration(g:Generation):Promise<TeamServiceReceipt>{await g.start?.catch(()=>{});await Promise.allSettled([...g.pending]);try{
      if(g.facts){
        if(g.manifest!.provider==='rootless'&&!g.rootlessInvoked){
          // No engine command was admitted: only this owned generation's files exist.
          g.facts.closure={containers:true,machine:true,helpers:true};g.rootlessRetired=true;
        }else{
        const machineBefore=g.manifest!.provider==='applehv'?(g.facts.machineCreatedAt?await this.inspectMachine(g):undefined):undefined;
        const stoppedBeforeGuestObservation=g.manifest!.provider==='applehv'&&(!machineBefore||machineBefore.State==='stopped');
        if(stoppedBeforeGuestObservation){
          const machines=JSON.parse(await this.cli(g,['machine','list','--format','json']));if(!machineBefore&&machines.some((m:any)=>m.Name===g.facts!.machineName))throw new Error('Partially initialized machine has no verified creation identity; retain it.');
          if(g.facts.namespaces.length)throw new Error('Stopped VM retains namespace records requiring reconciliation.');
          g.facts.closure.containers=true;
        }else {for(const lease of g.facts.namespaces){const c=await this.container(g,lease.containerId);if(c.Config?.Labels?.['hima.namespace-generation']!==lease.namespaceGeneration || c.State.Running&&`${c.State.Pid}:${c.State.StartedAt}`!==lease.guestPidIdentity)throw new Error('Namespace start identity drift; no stop admitted.');await this.cli(g,this.command(g,['stop','--time','3',lease.containerId]));await this.cli(g,this.command(g,['rm',lease.containerId]));}
        const remaining=JSON.parse(await this.cli(g,this.command(g,['ps','--all','--filter',`label=hima.engine-generation=${g.id}`,'--format','json'])));g.facts.closure.containers=Array.isArray(remaining)&&remaining.length===0;}
        if(g.manifest!.provider==='applehv'){const before=await this.helperIdentities(g);if(g.facts.helpers.length&&JSON.stringify(before)!==JSON.stringify(g.facts.helpers))throw new Error('Helper identities drifted; no stop signal admitted.');const machine=machineBefore;if(machine?.State==='running')await this.cli(g,['machine','stop',g.facts.machineName!]);g.facts.closure.machine=!machine||(await this.inspectMachine(g)).State==='stopped';g.facts.closure.helpers=(await this.helperIdentities(g)).length===0;
        }else {g.facts.closure.machine=true;const keeper=await this.rootlessKeeperIdentity(g);
          if(keeper){const all=JSON.parse(await this.cli(g,this.command(g,['ps','--all','--format','json'])));if(!Array.isArray(all)||all.length)throw new Error('Private engine container inventory is not empty; no rootless pause shutdown admitted.');await this.rootlessKeeperIdentity(g);try{await this.cli(g,this.command(g,['system','migrate']));}finally{g.rootlessRetired=true;}
            // Further Podman commands would create a new pause process. Observe OS facts only.
            let remains=true;for(let i=0;i<20;i++){remains=!!await lstat(`/proc/${keeper.pid}`).catch(error=>{if(error.code==='ENOENT')return undefined;throw error;});if(!remains)break;await new Promise(resolve=>setTimeout(resolve,25));}
            if(remains||await lstat(keeper.file).catch(error=>{if(error.code==='ENOENT')return undefined;throw error;}))throw new Error('Owned rootless pause PID/file remains after scoped migration; closure unresolved.');
          }
          g.facts.closure.helpers=!g.rootlessCommandUnknown&&(await this.visibleHelperIdentities(g)).length===0;
        }
        }
      }if(g.facts?.closure.containers)for(const lease of g.facts.namespaces)if(lease.memberKey)this.retainMemberClosure(g,lease);g.state=!g.facts||Object.values(g.facts.closure).every(Boolean)?'stopped':'failed';if(g.state==='stopped'&&g.facts){if(g.manifest!.provider==='applehv'&&g.facts.machineCreatedAt){await this.cli(g,['machine','rm','--force',g.facts.machineName!]);const machines=JSON.parse(await this.cli(g,['machine','list','--format','json']));if(!Array.isArray(machines)||machines.some((m:any)=>m.Name===g.facts!.machineName))throw new Error('Owned machine removal was not observed.');}await writeFile(path.join(g.facts.canonicalStorage,'final-owned-facts.json'),JSON.stringify(g.facts),{mode:0o600});if(await realpath(g.facts.shortHome)!==g.facts.canonicalStorage||(await lstat(path.dirname(g.facts.shortHome))).uid!==process.getuid?.())throw new Error('Short Home alias ownership changed; retain unknown path.');await rm(path.dirname(g.facts.shortHome),{recursive:true,force:true});}if(g.state==='failed')throw new Error('Closure observations are incomplete; retain private generation.');
    }catch(error){g.state='failed';g.diagnostic={code:'engine-closure',message:(error as Error).message};}return this.receipt(g,'stop');}
  async stopAll():Promise<TeamServiceReceipt[]>{this.closed=true;return this.generation?[await this.stop()]:[];}
}
export function verifyObservedEngineeringRules(raw:string,tuples:EngineeringEgressPolicy['resolvedTuples'],admission?:Pick<CompiledEngineeringPolicy,'deadlineEpochSeconds'|'timeoutSeconds'|'validUntil'|'nativeLoopbackPort'>,observedAtMs=Date.now()):void {
  const fail=(message:string):never=>{throw new Error(`Observed ${message}.`);};
  if(!admission||!Number.isSafeInteger(admission.deadlineEpochSeconds)||admission.deadlineEpochSeconds<=0||!Number.isSafeInteger(admission.timeoutSeconds)||admission.timeoutSeconds<=0||admission.timeoutSeconds>300||!Number.isSafeInteger(observedAtMs)||observedAtMs<0)fail('bounded deadline admission is missing or invalid');
  const expected=admission!;const validUntilMs=Date.parse(expected.validUntil);
  if(!Number.isFinite(validUntilMs)||observedAtMs>=validUntilMs||expected.deadlineEpochSeconds*1000>validUntilMs)fail('deadline is expired or overlong');
  const rules=JSON.parse(raw).nftables;
  if(!Array.isArray(rules))fail('kernel policy missing');
  const keys=(value:any,allowed:string[]):boolean=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>allowed.includes(key));
  for(const row of rules)if(!keys(row,['metainfo','table','chain','set','rule'])||Object.keys(row).length!==1)fail('unexpected kernel object');
  const metadata=rules.filter((r:any)=>r.metainfo).map((r:any)=>r.metainfo);
  if(metadata.length!==1||!keys(metadata[0],['version','release_name','json_schema_version'])||typeof metadata[0].version!=='string'||!metadata[0].version||metadata[0].json_schema_version!==1||metadata[0].release_name!==undefined&&typeof metadata[0].release_name!=='string')fail('kernel JSON metadata differs');
  const tables=rules.filter((r:any)=>r.table).map((r:any)=>r.table);
  if(tables.length!==1||!keys(tables[0],['family','name','handle'])||tables[0].family!=='inet'||tables[0].name!=='hima')fail('table boundary differs');
  const chains=rules.filter((r:any)=>r.chain).map((r:any)=>r.chain);
  if(chains.length!==1||!keys(chains[0],['family','table','name','handle','type','hook','policy','prio'])||chains[0].family!=='inet'||chains[0].table!=='hima'||chains[0].name!=='output'||chains[0].type!=='filter'||chains[0].hook!=='output'||chains[0].policy!=='drop'||chains[0].prio!==0)fail('default-deny kernel policy differs');
  const sets=rules.filter((r:any)=>r.set).map((r:any)=>r.set);
  if(sets.length!==2)fail('timed set count differs');
  const seenSets=new Set<string>();
  for(const set of sets){
    const family=set.name==='allow4'?4:set.name==='allow6'?6:undefined;
    if(!family||seenSets.has(set.name)||!keys(set,['family','table','name','type','handle','flags','elem','gc-interval'])||set.family!=='inet'||set.table!=='hima'||!isDeepStrictEqual(set.type,[`ipv${family}_addr`,'inet_service'])||!isDeepStrictEqual(set.flags,['timeout']))fail('typed timed set identity differs');
    seenSets.add(set.name);
    if(set['gc-interval']!==undefined&&(!Number.isSafeInteger(set['gc-interval'])||set['gc-interval']<0))fail('timed set collection interval invalid');
    const permitted=tuples.filter(t=>t.family===family);const elements=set.elem??[];
    if(!Array.isArray(elements)||elements.length!==permitted.length)fail('approved element count differs');
    const wanted=new Set(permitted.map(t=>JSON.stringify([t.address,t.port]))),seen=new Set<string>();
    for(const row of elements){
      const element=row?.elem;
      if(!keys(row,['elem'])||!keys(element,['val','timeout','expires'])||!keys(element?.val,['concat'])||!Array.isArray(element?.val?.concat)||element.val.concat.length!==2)fail('explicit timed element missing');
      const key=JSON.stringify(element.val.concat);
      if(!wanted.has(key)||seen.has(key))fail('approved tuple differs');
      seen.add(key);
      if(!Number.isSafeInteger(element.timeout)||element.timeout!==expected.timeoutSeconds||!Number.isSafeInteger(element.expires)||element.expires<=0||element.expires>element.timeout)fail('element timeout or expires is missing, permanent or overlong');
      // nft 1.1.6 JSON truncates duration to seconds. Use an upper bound, never milliseconds.
      if(observedAtMs+(element.expires+1)*1000>validUntilMs)fail('remaining element lifetime exceeds the Host deadline');
    }
  }
  const actual=rules.filter((r:any)=>r.rule).map((r:any)=>r.rule);
  if(actual.length!==(expected.nativeLoopbackPort?4:2))fail('lookup rule count differs');
  const seenRules=new Set<string>(),utcDeadline=new Date(expected.deadlineEpochSeconds*1000).toISOString().slice(0,19).replace('T',' ');
  for(const rule of actual){
    if(rule?.expr?.[0]?.match?.right==='lo'){
      const direction=rule?.expr?.[2]?.match?.left?.payload?.field;
      const label='native:'+direction;
      const expression=[{match:{op:'==',left:{meta:{key:'oifname'}},right:'lo'}},{match:{op:'==',left:{payload:{protocol:'ip',field:'daddr'}},right:'127.0.0.1'}},{match:{op:'==',left:{payload:{protocol:'tcp',field:direction}},right:expected.nativeLoopbackPort}},{match:{op:'<',left:{meta:{key:'time'}},right:utcDeadline}},{accept:null}];
      if(!expected.nativeLoopbackPort||!['dport','sport'].includes(direction)||seenRules.has(label)||!keys(rule,['family','table','chain','handle','expr'])||rule.family!=='inet'||rule.table!=='hima'||rule.chain!=='output'||!isDeepStrictEqual(rule.expr,expression))fail('native loopback boundary or absolute guard differs');
      seenRules.add(label);continue;
    }
    const target=rule?.expr?.[0]?.match?.right;const family=target==='@allow4'?4:target==='@allow6'?6:undefined;
    const expression=[{match:{op:'==',left:{concat:[{payload:{protocol:family===4?'ip':'ip6',field:'daddr'}},{payload:{protocol:'tcp',field:'dport'}}]},right:target}},{match:{op:'<',left:{meta:{key:'time'}},right:utcDeadline}},{accept:null}];
    if(!family||seenRules.has(target)||!keys(rule,['family','table','chain','handle','expr'])||rule.family!=='inet'||rule.table!=='hima'||rule.chain!=='output'||!isDeepStrictEqual(rule.expr,expression))fail('tuple lookup, absolute guard or accept differs');
    seenRules.add(target);
  }
}
// Read only explicitly named OCI tar members through the OS tar reader; no extraction.
export async function verifyEngineeringArchive(root:string,e:EngineeringEngineManifest):Promise<void>{
  const {stdout:list}=await promisify(execFile)('/usr/bin/tar',['-tf',path.join(root,e.image.file)],{maxBuffer:2*1024*1024});const names=list.trim().split('\n');
  const member=async(digest:string,expectedBytes?:number):Promise<Buffer>=>new Promise((resolve,reject)=>{const child=spawn('/usr/bin/tar',['-xOf',path.join(root,e.image.file),names.includes(`blobs/sha256/${digest}`)?`blobs/sha256/${digest}`:`./blobs/sha256/${digest}`],{stdio:['ignore','pipe','ignore']});const hash=createHash('sha256');const chunks:Buffer[]=[];let size=0;child.stdout.on('data',(b:Buffer)=>{hash.update(b);size+=b.length;if(size<2*1024*1024)chunks.push(b);if(expectedBytes!==undefined&&size>expectedBytes)child.kill('SIGKILL');});child.once('error',reject);child.once('close',code=>code===0&&hash.digest('hex')===digest&&(expectedBytes===undefined?size<2*1024*1024:size===expectedBytes)?resolve(Buffer.concat(chunks)):reject(new Error('Pinned OCI nested blob digest/byte count differs.')));});
  const manifest=JSON.parse((await member(e.image.manifestSha256)).toString());const config=await member(e.image.configSha256,manifest.config?.size);const expectedLayers=e.image.layers;
  if(manifest.config?.digest!==`sha256:${e.image.configSha256}` || !Array.isArray(manifest.layers)||manifest.layers.length!==expectedLayers.length)throw new Error('OCI manifest/config identity differs.');
  for(let i=0;i<expectedLayers.length;i++){const layer=expectedLayers[i]!;if(manifest.layers[i]?.digest!==`sha256:${layer.sha256}`||manifest.layers[i]?.size!==layer.bytes)throw new Error('OCI layer inventory differs.');await member(layer.sha256,layer.bytes);}
  const imageConfig=JSON.parse(config.toString());if(imageConfig.os!=='linux'||imageConfig.architecture!==(e.guestPlatform==='linux-arm64'?'arm64':'amd64'))throw new Error('OCI guest architecture differs.');
}
