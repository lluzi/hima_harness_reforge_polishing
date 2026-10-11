// Private C7 engine lifecycle; this is not a member adapter or execution scheduler.
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { promisify, isDeepStrictEqual } from 'node:util';
import { request as httpRequest } from 'node:http';
import { isIP } from 'node:net';
import { mkdir, realpath, writeFile, lstat, readFile, readdir, symlink, rm } from 'node:fs/promises';
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
const policySchema=z.strictObject({policyId:z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),approvedOrigins:z.array(z.string()).min(1).max(32),resolvedTuples:z.array(tuple).min(1).max(128),deniedPrivateTuples:z.array(tuple).max(128),resolvedAt:z.string().datetime(),validUntil:z.string().datetime(),sha256:hash});
export type EngineeringEgressPolicy=z.infer<typeof policySchema>;
export interface EngineeringNamespaceRequest {engineGeneration:string;taskIdentity:{taskId:string;fixture:'trusted-namespace-test'};policy:EngineeringEgressPolicy;}
export interface EngineeringNamespaceLease {readonly engineGeneration:string;readonly namespaceGeneration:string;readonly containerId:string;readonly guestPidIdentity:string;readonly imageDigest:string;readonly policySha256:string;readonly observedRulesSha256:string;readonly validUntil:string;readonly qualification:'trusted-fixture-only';}
export interface EngineeringOwnedFacts {provider:'applehv'|'rootless';platform:string;canonicalStorage:string;shortHome:string;machineName?:string;machineCreatedAt?:string;configSha256?:string;connectionSha256?:string;imageDigest?:string;helpers:Array<{pid:number;startIdentity:string}>;namespaces:EngineeringNamespaceLease[];closure:{containers:boolean;machine:boolean;helpers:boolean};qualification:'trusted-fixture-only';}
function freezeSnapshot<T>(value:T):T {if(value!==null&&typeof value==='object'){for(const child of Object.values(value))freezeSnapshot(child);Object.freeze(value);}return value;}
const sha=(bytes:string)=>createHash('sha256').update(bytes).digest('hex');
const privateAddress=(raw:string)=> {const address=isIP(raw)===6?new URL(`http://[${raw}]`).hostname.slice(1,-1):raw;return isIP(address)===4?/^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address):/^(::|fc|fd|fe[89ab])/i.test(address);};
interface CompiledEngineeringPolicy {bytes:string;policySha256:string;tuples:EngineeringEgressPolicy['resolvedTuples'];validUntil:string;deadlineEpochSeconds:number;timeoutSeconds:number;}
const installationGuardMs=1000;
function engineeringPolicyBytes(tuples:EngineeringEgressPolicy['resolvedTuples'],deadlineEpochSeconds:number,timeoutSeconds:number):string {
  const sets=([4,6] as const).map(family=>{const elements=tuples.filter(t=>t.family===family).map(t=>`${t.address} . ${t.port} timeout ${timeoutSeconds}s`);return ` set allow${family} { type ipv${family}_addr . inet_service; flags timeout;${elements.length?` elements = { ${elements.join(', ')} };`:''} }`;});
  return `table inet hima {\n${sets.join('\n')}\n chain output { type filter hook output priority 0; policy drop;\n  meta l4proto tcp ip daddr . tcp dport @allow4 meta time < ${deadlineEpochSeconds} accept\n  meta l4proto tcp ip6 daddr . tcp dport @allow6 meta time < ${deadlineEpochSeconds} accept\n }\n}\n`;
}
export function compileEngineeringPolicy(input:EngineeringEgressPolicy,now=Date.now(),offsetLowerMs=0):CompiledEngineeringPolicy {
  if(!Number.isSafeInteger(now)||now<0||!Number.isFinite(offsetLowerMs)||Math.abs(offsetLowerMs)>1000)throw new Error('Egress policy clock is invalid or outside the bounded skew.');
  const p=policySchema.parse(input);const {sha256,...body}=p;
  if(sha(JSON.stringify(body))!==sha256)throw new Error('Egress policy digest differs.');
  if(Date.parse(p.resolvedAt)>now || Date.parse(p.validUntil)<=now || Date.parse(p.validUntil)-Date.parse(p.resolvedAt)>300000)throw new Error('Egress policy resolution is expired or outside the bounded validity.');
  for(const origin of p.approvedOrigins){const url=new URL(origin);if(url.protocol!=='https:'||url.port&&url.port!=='443'||url.username||url.password||url.origin!==origin)throw new Error('Approved origin must be an exact HTTPS origin.');}
  for(const t of [...p.resolvedTuples,...p.deniedPrivateTuples])if(isIP(t.address)!==t.family)throw new Error('Egress policy address family differs.');
  const denied=new Set(p.deniedPrivateTuples.map(t=>`${t.address}:${t.port}`));
  const tuples=p.resolvedTuples;
  for(const t of tuples)if(t.port!==443||privateAddress(t.address)||denied.has(`${t.address}:${t.port}`))throw new Error('Egress policy admits a private collision or non-HTTPS port.');
  if(new Set(tuples.map(t=>`${t.address}:${t.port}`)).size!==tuples.length)throw new Error('Egress policy contains duplicate tuples.');
  const deadlineEpochSeconds=Math.floor((Date.parse(p.validUntil)+Math.min(0,offsetLowerMs)-100)/1000);
  const timeoutSeconds=Math.floor((deadlineEpochSeconds*1000-now-installationGuardMs)/1000);
  if(timeoutSeconds<=0)throw new Error('Egress policy has insufficient remaining validity for a bounded installation.');
  return {bytes:engineeringPolicyBytes(tuples,deadlineEpochSeconds,timeoutSeconds),policySha256:sha256,tuples,validUntil:p.validUntil,deadlineEpochSeconds,timeoutSeconds};
}
interface HostClockTiming {hostBeforeMs:number;hostAfterMs:number;}
interface Generation {id:string;state:TeamServiceReceipt['state'];fenced:boolean;manifest?:EngineeringEngineManifest;files?:Record<string,string>;root?:string;env?:NodeJS.ProcessEnv;facts?:EngineeringOwnedFacts;diagnostic?:TeamServiceReceipt['diagnostic'];start?:Promise<TeamServiceReceipt>;pending:Set<Promise<unknown>>;policies:Map<string,CompiledEngineeringPolicy>;stop?:Promise<TeamServiceReceipt>;exporting:boolean;}
export interface EngineeringRuntimeOptions {home:string;runtimeDirectory?:string;recordReceipt:(receipt:TeamServiceReceipt)=>Promise<void>;readManifest:()=>Promise<{engineeringEngine?:EngineeringEngineManifest;files?:Record<string,string>}>;}
export class EngineeringEngineRuntime {
  private generation?:Generation;private closed=false;
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
  private async cli(g:Generation,args:string[],stdin?:string,timing?:HostClockTiming):Promise<string>{
    if(!g.root||!g.env||!g.manifest)throw new Error('Engine assets are not initialized.');
    if(g.manifest.provider==='applehv'&&(args.includes('--connection')||args[0]==='machine'&&args[1]==='ssh'))await this.verifyPrivateConnection(g);
    return this.execute(g,path.join(g.root,g.manifest.executable),args,stdin,timing);
  }
  private execute(g:Generation,executable:string,args:string[],stdin?:string,timing?:HostClockTiming,environment:NodeJS.ProcessEnv=g.env!):Promise<string>{
    return new Promise((resolve,reject)=>{if(timing)timing.hostBeforeMs=Date.now();const child=spawn(executable,args,{cwd:g.root,env:environment,stdio:['pipe','pipe','pipe']});let stdout='',stderr='';let exceeded=false,timedOut=false;
      const timer=setTimeout(()=>{timedOut=true;child.kill('SIGKILL');},120000);
      child.stdout.on('data',b=>{stdout+=b;if(stdout.length>2*1024*1024){exceeded=true;child.kill('SIGKILL');}});child.stderr.on('data',b=>{if(stderr.length<4096)stderr+=b;});
      child.once('error',()=>{clearTimeout(timer);reject(new Error('Fixed engine CLI failed to start.'));});child.once('close',async code=>{if(timing)timing.hostAfterMs=Date.now();clearTimeout(timer);try{await writeFile(path.join(g.facts!.canonicalStorage,`cli-${randomUUID()}.json`),JSON.stringify({generation:g.id,executable,args,code,stdout,stderr,outputExceeded:exceeded,timedOut}),{mode:0o600,flag:'wx'});}catch{reject(new Error('Private CLI evidence could not be retained.'));return;}code===0&&!exceeded&&!timedOut?resolve(stdout.trim()):reject(new Error(timedOut?'Owned engine CLI timed out; retain generation for reconciliation.':`Owned engine CLI failed (${code}); diagnostic retained privately.`));});
      child.stdin.on('error',()=>{});child.stdin.end(stdin);
    });
  }
  private command(g:Generation,args:string[]):string[]{return g.manifest?.provider==='applehv'?['--connection',g.facts!.machineName!,...args]:['--root',path.join(g.facts!.canonicalStorage,'storage'),'--runroot',path.join(g.facts!.canonicalStorage,'runroot'),...args];}
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
    const {stdout}=await promisify(execFile)('/bin/ps',['-axo','pid=,lstart=,command='],{maxBuffer:4*1024*1024});const helpers=g.manifest!.helpers.map(p=>path.join(g.root!,p));
    return stdout.split('\n').filter(line=>helpers.some(h=>line.includes(h))&& (line.includes(g.facts!.machineName??g.facts!.canonicalStorage)||line.includes(g.facts!.canonicalStorage))).map(line=>({pid:Number(line.trim().split(/\s+/)[0]),startIdentity:sha(line.trim())}));
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
      }else if(process.getuid?.()===0)throw new Error('Engineering engine requires rootless Linux identity.');
      await this.cli(g,this.command(g,['load','--input',path.join(g.root,metadata.image.file)]));
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
    }else{const info=JSON.parse(await this.cli(g,this.command(g,['info','--format','json'])));if(info.host?.security?.rootless!==true)throw new Error('Guest engine is not observed rootless.');}
    for(const lease of g.facts!.namespaces){if(Date.parse(lease.validUntil)<=Date.now())throw new Error('Namespace policy expired; readiness revoked.');const inspected=await this.container(g,lease.containerId);if(!lease.observedRulesSha256||!inspected.State.Running||`${inspected.State.Pid}:${inspected.State.StartedAt}`!==lease.guestPidIdentity)throw new Error('Owned namespace identity changed.');const pid=inspected.State.Pid,policy=g.policies.get(lease.containerId);if(!policy)throw new Error('Namespace timed admission is missing.');const timing:HostClockTiming={hostBeforeMs:0,hostAfterMs:0};const observed=await this.guest(g,['podman','unshare','nsenter',`--net=/proc/${pid}/ns/net`,'nft','-j','-T','list','ruleset'],undefined,timing);verifyObservedEngineeringRules(observed,policy.tuples,policy,timing.hostAfterMs);}
  }
  private async container(g:Generation,id:string):Promise<any>{const rows=JSON.parse(await this.cli(g,this.command(g,['container','inspect',id])));const c=rows[0];if(rows.length!==1||c?.Id!==id||c.Config?.Labels?.['hima.engine-generation']!==g.id)throw new Error('Owned container identity mismatch; resource retained.');return c;}
  async status():Promise<TeamServiceReceipt>{const g=this.generation??(this.generation=this.empty());if(g.state==='running'){await Promise.allSettled([...g.pending]);}if(g.state==='running')try{await this.observe(g);}catch(error){g.state='failed';g.fenced=true;g.diagnostic={code:'engine-observation',message:(error as Error).message};}return this.receipt(g,'status');}
  prepareNamespace(request:EngineeringNamespaceRequest):Promise<EngineeringNamespaceLease>{const g=this.generation;
    if(!g||g.fenced||g.exporting||g.state!=='running'||request.engineGeneration!==g.id)return Promise.reject(new Error('Current unfenced engine generation required.'));
    if(request.taskIdentity.fixture!=='trusted-namespace-test'||!/^[A-Za-z0-9_-]{1,128}$/.test(request.taskIdentity.taskId))return Promise.reject(new Error('Only the explicit trusted namespace fixture is admitted; member activation remains blocked.'));
    let compiled:ReturnType<typeof compileEngineeringPolicy>;try{compiled=compileEngineeringPolicy(request.policy);}catch(error){return Promise.reject(error);}
    const frozenRequest=freezeSnapshot(structuredClone(request));
    const pending=this.prepare(g,frozenRequest,compiled).catch(async error=>{g.fenced=true;g.state='failed';g.diagnostic={code:'namespace-policy',message:(error as Error).message};await this.receipt(g,'status');throw error;});g.pending.add(pending);void pending.finally(()=>g.pending.delete(pending)).catch(()=>{});return pending;
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
    return {...compiled,bytes:engineeringPolicyBytes(compiled.tuples,compiled.deadlineEpochSeconds,timeoutSeconds),timeoutSeconds};
  }
  private async discardNamespace(g:Generation,lease:EngineeringNamespaceLease):Promise<void> {
    const c=await this.container(g,lease.containerId);
    if(c.Config?.Labels?.['hima.namespace-generation']!==lease.namespaceGeneration||c.State.Running&&`${c.State.Pid}:${c.State.StartedAt}`!==lease.guestPidIdentity)throw new Error('Failed namespace birth identity changed; retain it for reconciliation.');
    await this.cli(g,this.command(g,['stop','--time','3',lease.containerId]));await this.cli(g,this.command(g,['rm',lease.containerId]));
    const remaining=JSON.parse(await this.cli(g,this.command(g,['ps','--all','--filter',`label=hima.namespace-generation=${lease.namespaceGeneration}`,'--format','json'])));
    if(!Array.isArray(remaining)||remaining.length)throw new Error('Failed namespace removal is not observed; retain it for reconciliation.');
    g.facts!.namespaces=g.facts!.namespaces.filter(value=>value.containerId!==lease.containerId);g.policies.delete(lease.containerId);
  }
  private async prepare(g:Generation,request:EngineeringNamespaceRequest,compiled:ReturnType<typeof compileEngineeringPolicy>):Promise<EngineeringNamespaceLease>{
    if(g.manifest!.provider==='rootless')await this.rootlessController(g);
    const ns=randomUUID();const id=await this.cli(g,this.command(g,['run','--pull=never','--http-proxy=false','--detach','--read-only','--tmpfs','/hima-home:rw,nosuid,nodev,size=128m,mode=0700','--tmpfs','/hima-work:rw,nosuid,nodev,size=128m,mode=0700','--tmpfs','/tmp:rw,nosuid,nodev,size=64m,mode=1777','--env','HOME=/hima-home','--env','XDG_CONFIG_HOME=/hima-home/.config','--env','XDG_DATA_HOME=/hima-home/.local/share','--env','XDG_CACHE_HOME=/hima-home/.cache','--env','XDG_STATE_HOME=/hima-home/.local/state','--env','TMPDIR=/tmp','--workdir','/hima-work','--cap-drop=ALL','--security-opt=no-new-privileges','--label',`hima.engine-generation=${g.id}`,'--label',`hima.namespace-generation=${ns}`,'--network','bridge',g.facts!.imageDigest!,'/bin/sleep','infinity']));
    if(!/^[a-f0-9]{64}$/.test(id))throw new Error('Bootstrap container ID is invalid; retain generation for reconciliation.');
    const c=await this.container(g,id);const pid=c.State.Pid;if(!Number.isSafeInteger(pid)||pid<=0||!c.State.Running)throw new Error('Owned guest PID was not observed.');
    // Register the owned container before policy I/O so stop reaps policy failures too.
    const mutable:{-readonly [K in keyof EngineeringNamespaceLease]:EngineeringNamespaceLease[K]}={engineGeneration:g.id,namespaceGeneration:ns,containerId:id,guestPidIdentity:`${pid}:${c.State.StartedAt}`,imageDigest:g.facts!.imageDigest!,policySha256:compiled.policySha256,observedRulesSha256:'',validUntil:request.policy.validUntil,qualification:'trusted-fixture-only'};g.facts!.namespaces.push(mutable);
    try {
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
        const machineBefore=g.manifest!.provider==='applehv'?(g.facts.machineCreatedAt?await this.inspectMachine(g):undefined):undefined;
        const stoppedBeforeGuestObservation=g.manifest!.provider==='applehv'&&(!machineBefore||machineBefore.State==='stopped');
        if(stoppedBeforeGuestObservation){
          const machines=JSON.parse(await this.cli(g,['machine','list','--format','json']));if(!machineBefore&&machines.some((m:any)=>m.Name===g.facts!.machineName))throw new Error('Partially initialized machine has no verified creation identity; retain it.');
          if(g.facts.namespaces.length)throw new Error('Stopped VM retains namespace records requiring reconciliation.');
          g.facts.closure.containers=true;
        }else {for(const lease of g.facts.namespaces){const c=await this.container(g,lease.containerId);if(c.Config?.Labels?.['hima.namespace-generation']!==lease.namespaceGeneration || c.State.Running&&`${c.State.Pid}:${c.State.StartedAt}`!==lease.guestPidIdentity)throw new Error('Namespace start identity drift; no stop admitted.');await this.cli(g,this.command(g,['stop','--time','3',lease.containerId]));await this.cli(g,this.command(g,['rm',lease.containerId]));}
        const remaining=JSON.parse(await this.cli(g,this.command(g,['ps','--all','--filter',`label=hima.engine-generation=${g.id}`,'--format','json'])));g.facts.closure.containers=Array.isArray(remaining)&&remaining.length===0;}
        if(g.manifest!.provider==='applehv'){const before=await this.helperIdentities(g);if(g.facts.helpers.length&&JSON.stringify(before)!==JSON.stringify(g.facts.helpers))throw new Error('Helper identities drifted; no stop signal admitted.');const machine=machineBefore;if(machine?.State==='running')await this.cli(g,['machine','stop',g.facts.machineName!]);g.facts.closure.machine=!machine||(await this.inspectMachine(g)).State==='stopped';g.facts.closure.helpers=(await this.helperIdentities(g)).length===0;
        }else {g.facts.closure.machine=true;g.facts.closure.helpers=(await this.helperIdentities(g)).length===0;}
      }g.state=!g.facts||Object.values(g.facts.closure).every(Boolean)?'stopped':'failed';if(g.state==='stopped'&&g.facts){if(g.manifest!.provider==='applehv'&&g.facts.machineCreatedAt){await this.cli(g,['machine','rm','--force',g.facts.machineName!]);const machines=JSON.parse(await this.cli(g,['machine','list','--format','json']));if(!Array.isArray(machines)||machines.some((m:any)=>m.Name===g.facts!.machineName))throw new Error('Owned machine removal was not observed.');}await writeFile(path.join(g.facts.canonicalStorage,'final-owned-facts.json'),JSON.stringify(g.facts),{mode:0o600});if(await realpath(g.facts.shortHome)!==g.facts.canonicalStorage||(await lstat(path.dirname(g.facts.shortHome))).uid!==process.getuid?.())throw new Error('Short Home alias ownership changed; retain unknown path.');await rm(path.dirname(g.facts.shortHome),{recursive:true,force:true});}if(g.state==='failed')throw new Error('Closure observations are incomplete; retain private generation.');
    }catch(error){g.state='failed';g.diagnostic={code:'engine-closure',message:(error as Error).message};}return this.receipt(g,'stop');}
  async stopAll():Promise<TeamServiceReceipt[]>{this.closed=true;return this.generation?[await this.stop()]:[];}
}
export function verifyObservedEngineeringRules(raw:string,tuples:EngineeringEgressPolicy['resolvedTuples'],admission?:Pick<CompiledEngineeringPolicy,'deadlineEpochSeconds'|'timeoutSeconds'|'validUntil'>,observedAtMs=Date.now()):void {
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
      if(!wanted.has(key)||seen.has(key)||element.val.concat[1]!==443)fail('approved tuple differs');
      seen.add(key);
      if(!Number.isSafeInteger(element.timeout)||element.timeout!==expected.timeoutSeconds||!Number.isSafeInteger(element.expires)||element.expires<=0||element.expires>element.timeout)fail('element timeout or expires is missing, permanent or overlong');
      // nft 1.1.6 JSON truncates duration to seconds. Use an upper bound, never milliseconds.
      if(observedAtMs+(element.expires+1)*1000>validUntilMs)fail('remaining element lifetime exceeds the Host deadline');
    }
  }
  const actual=rules.filter((r:any)=>r.rule).map((r:any)=>r.rule);
  if(actual.length!==2)fail('lookup rule count differs');
  const seenRules=new Set<string>(),utcDeadline=new Date(expected.deadlineEpochSeconds*1000).toISOString().slice(0,19).replace('T',' ');
  for(const rule of actual){
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
