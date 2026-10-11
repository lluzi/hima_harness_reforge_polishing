// Private C7 engine lifecycle; this is not a member adapter or execution scheduler.
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
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
export function compileEngineeringPolicy(input:EngineeringEgressPolicy,now=Date.now()):{bytes:string;policySha256:string;tuples:EngineeringEgressPolicy['resolvedTuples']} {
  const p=policySchema.parse(input);const {sha256,...body}=p;
  if(sha(JSON.stringify(body))!==sha256)throw new Error('Egress policy digest differs.');
  if(Date.parse(p.resolvedAt)>now || Date.parse(p.validUntil)<=now || Date.parse(p.validUntil)-Date.parse(p.resolvedAt)>300000)throw new Error('Egress policy resolution is expired or outside the bounded validity.');
  for(const origin of p.approvedOrigins){const url=new URL(origin);if(url.protocol!=='https:'||url.port&&url.port!=='443'||url.username||url.password||url.origin!==origin)throw new Error('Approved origin must be an exact HTTPS origin.');}
  for(const t of [...p.resolvedTuples,...p.deniedPrivateTuples])if(isIP(t.address)!==t.family)throw new Error('Egress policy address family differs.');
  const denied=new Set(p.deniedPrivateTuples.map(t=>`${t.address}:${t.port}`));
  const tuples=p.resolvedTuples;
  for(const t of tuples)if(t.port!==443||privateAddress(t.address)||denied.has(`${t.address}:${t.port}`))throw new Error('Egress policy admits a private collision or non-HTTPS port.');
  if(new Set(tuples.map(t=>`${t.address}:${t.port}`)).size!==tuples.length)throw new Error('Egress policy contains duplicate tuples.');
  const bytes=`table inet hima {\n chain output { type filter hook output priority 0; policy drop;\n${tuples.map(t=>`  ${t.family===4?'ip':'ip6'} daddr ${t.address} tcp dport ${t.port} accept`).join('\n')}\n }\n}\n`;
  return {bytes,policySha256:sha256,tuples};
}
interface Generation {id:string;state:TeamServiceReceipt['state'];fenced:boolean;manifest?:EngineeringEngineManifest;root?:string;env?:NodeJS.ProcessEnv;facts?:EngineeringOwnedFacts;diagnostic?:TeamServiceReceipt['diagnostic'];start?:Promise<TeamServiceReceipt>;pending:Set<Promise<unknown>>;policies:Map<string,EngineeringEgressPolicy['resolvedTuples']>;stop?:Promise<TeamServiceReceipt>;exporting:boolean;}
export interface EngineeringRuntimeOptions {home:string;runtimeDirectory?:string;recordReceipt:(receipt:TeamServiceReceipt)=>Promise<void>;readManifest:()=>Promise<{engineeringEngine?:EngineeringEngineManifest}>;}
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
  private async cli(g:Generation,args:string[],stdin?:string):Promise<string>{
    if(!g.root||!g.env||!g.manifest)throw new Error('Engine assets are not initialized.');
    if(g.manifest.provider==='applehv'&&(args.includes('--connection')||args[0]==='machine'&&args[1]==='ssh'))await this.verifyPrivateConnection(g);
    return new Promise((resolve,reject)=>{const child=spawn(path.join(g.root!,g.manifest!.executable),args,{cwd:g.root,env:g.env,stdio:['pipe','pipe','pipe']});let stdout='',stderr='';let exceeded=false;
      const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('Owned engine CLI timed out; retain generation for reconciliation.'));},120000);
      child.stdout.on('data',b=>{stdout+=b;if(stdout.length>2*1024*1024){exceeded=true;child.kill('SIGKILL');}});child.stderr.on('data',b=>{if(stderr.length<4096)stderr+=b;});
      child.once('error',()=>{clearTimeout(timer);reject(new Error('Fixed engine CLI failed to start.'));});child.once('close',async code=>{clearTimeout(timer);try{await writeFile(path.join(g.facts!.canonicalStorage,`cli-${randomUUID()}.json`),JSON.stringify({generation:g.id,args,code,stdout,stderr,outputExceeded:exceeded}),{mode:0o600,flag:'wx'});}catch{reject(new Error('Private CLI evidence could not be retained.'));return;}code===0&&!exceeded?resolve(stdout.trim()):reject(new Error(`Owned engine CLI failed (${code}); diagnostic retained privately.`));});
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
    try{await this.receipt(g,'start');const metadata=(await this.options.readManifest()).engineeringEngine;if(!metadata)throw new Error('Install the matching fixed private-engine closure; Guide remains available.');g.manifest=metadata;const generations=path.join(await realpath(this.options.home),'hima/team-services/engineering-engine');for(const name of await readdir(generations).catch(()=>[])){const marker=JSON.parse(await readFile(path.join(generations,name,'generation.json'),'utf8'));if(marker.quiescent!==true)throw new Error('Interrupted engine generation requires exact resource reconciliation; no automatic takeover.');}g.root=await realpath(this.options.runtimeDirectory!);
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
    for(const lease of g.facts!.namespaces){if(Date.parse(lease.validUntil)<=Date.now())throw new Error('Namespace policy expired; readiness revoked.');const inspected=await this.container(g,lease.containerId);if(!lease.observedRulesSha256||!inspected.State.Running||`${inspected.State.Pid}:${inspected.State.StartedAt}`!==lease.guestPidIdentity)throw new Error('Owned namespace identity changed.');const pid=inspected.State.Pid;const observed=await this.guest(g,['podman','unshare','nsenter',`--net=/proc/${pid}/ns/net`,'nft','-j','list','ruleset']);verifyObservedEngineeringRules(observed,g.policies.get(lease.containerId)!);}
  }
  private async container(g:Generation,id:string):Promise<any>{const rows=JSON.parse(await this.cli(g,this.command(g,['container','inspect',id])));const c=rows[0];if(rows.length!==1||c?.Id!==id||c.Config?.Labels?.['hima.engine-generation']!==g.id)throw new Error('Owned container identity mismatch; resource retained.');return c;}
  async status():Promise<TeamServiceReceipt>{const g=this.generation??(this.generation=this.empty());if(g.state==='running'){await Promise.allSettled([...g.pending]);}if(g.state==='running')try{await this.observe(g);}catch(error){g.state='failed';g.fenced=true;g.diagnostic={code:'engine-observation',message:(error as Error).message};}return this.receipt(g,'status');}
  prepareNamespace(request:EngineeringNamespaceRequest):Promise<EngineeringNamespaceLease>{const g=this.generation;
    if(!g||g.fenced||g.exporting||g.state!=='running'||request.engineGeneration!==g.id)return Promise.reject(new Error('Current unfenced engine generation required.'));
    if(request.taskIdentity.fixture!=='trusted-namespace-test'||!/^[A-Za-z0-9_-]{1,128}$/.test(request.taskIdentity.taskId))return Promise.reject(new Error('Only the explicit trusted namespace fixture is admitted; member activation remains blocked.'));
    let compiled:ReturnType<typeof compileEngineeringPolicy>;try{compiled=compileEngineeringPolicy(request.policy);}catch(error){return Promise.reject(error);}
    const pending=this.prepare(g,request,compiled).catch(async error=>{g.fenced=true;g.state='failed';g.diagnostic={code:'namespace-policy',message:(error as Error).message};await this.receipt(g,'status');throw error;});g.pending.add(pending);void pending.finally(()=>g.pending.delete(pending)).catch(()=>{});return pending;
  }
  private async guest(g:Generation,args:string[],stdin?:string):Promise<string>{
    if(g.manifest!.provider!=='applehv')return this.cli(g,args[0]==='podman'?args.slice(1):args,stdin);
    // Direct SSH forwarding returned exit0/empty output without installing nft. The fixed
    // guest-local subprocess contract preserves stdin, stdout and exit status independently.
    const name=`controller-${randomUUID()}.py`;const encoded=Buffer.from(stdin??'').toString('base64');
    const script=`import subprocess,sys,base64\nr=subprocess.run(${JSON.stringify(args)},input=base64.b64decode(${JSON.stringify(encoded)}),stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=15)\nsys.stdout.buffer.write(r.stdout)\nsys.stderr.buffer.write(r.stderr)\nsys.exit(r.returncode)\n`;
    await writeFile(path.join(g.facts!.canonicalStorage,'transfer',name),script,{flag:'wx',mode:0o600});
    return this.cli(g,['machine','ssh',g.facts!.machineName!,'python3',`/mnt/hima-transfer/${name}`]);
  }
  private async prepare(g:Generation,request:EngineeringNamespaceRequest,compiled:ReturnType<typeof compileEngineeringPolicy>):Promise<EngineeringNamespaceLease>{
    const ns=randomUUID();const id=await this.cli(g,this.command(g,['run','--pull=never','--http-proxy=false','--detach','--read-only','--tmpfs','/hima-home:rw,nosuid,nodev,size=128m,mode=0700','--tmpfs','/hima-work:rw,nosuid,nodev,size=128m,mode=0700','--tmpfs','/tmp:rw,nosuid,nodev,size=64m,mode=1777','--env','HOME=/hima-home','--env','XDG_CONFIG_HOME=/hima-home/.config','--env','XDG_DATA_HOME=/hima-home/.local/share','--env','XDG_CACHE_HOME=/hima-home/.cache','--env','XDG_STATE_HOME=/hima-home/.local/state','--env','TMPDIR=/tmp','--workdir','/hima-work','--cap-drop=ALL','--security-opt=no-new-privileges','--label',`hima.engine-generation=${g.id}`,'--label',`hima.namespace-generation=${ns}`,'--network','bridge',g.facts!.imageDigest!,'/bin/sleep','infinity']));
    if(!/^[a-f0-9]{64}$/.test(id))throw new Error('Bootstrap container ID is invalid; retain generation for reconciliation.');
    const c=await this.container(g,id);const pid=c.State.Pid;if(!Number.isSafeInteger(pid)||pid<=0||!c.State.Running)throw new Error('Owned guest PID was not observed.');
    // Register the owned container before policy I/O so stop reaps policy failures too.
    const mutable:{-readonly [K in keyof EngineeringNamespaceLease]:EngineeringNamespaceLease[K]}={engineGeneration:g.id,namespaceGeneration:ns,containerId:id,guestPidIdentity:`${pid}:${c.State.StartedAt}`,imageDigest:g.facts!.imageDigest!,policySha256:compiled.policySha256,observedRulesSha256:'',validUntil:request.policy.validUntil,qualification:'trusted-fixture-only'};g.facts!.namespaces.push(mutable);g.policies.set(id,compiled.tuples);
    await this.guest(g,['podman','unshare','nsenter',`--net=/proc/${pid}/ns/net`,'nft','-f','-'],compiled.bytes);
    const observed=await this.guest(g,['podman','unshare','nsenter',`--net=/proc/${pid}/ns/net`,'nft','-j','list','ruleset']);verifyObservedEngineeringRules(observed,compiled.tuples);
    mutable.observedRulesSha256=sha(observed);if(g.fenced||Date.parse(mutable.validUntil)<=Date.now())throw new Error('Namespace fenced/expired before readiness lease.');
    await this.receipt(g,'status');return Object.freeze({...mutable});
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
export function verifyObservedEngineeringRules(raw:string,tuples:EngineeringEgressPolicy['resolvedTuples']):void{
  const rules=JSON.parse(raw).nftables;if(!Array.isArray(rules))throw new Error('Observed kernel policy missing.');
  const chains=rules.filter((r:any)=>r.chain).map((r:any)=>r.chain);if(chains.length!==1||chains[0].family!=='inet'||chains[0].table!=='hima'||chains[0].name!=='output'||chains[0].hook!=='output'||chains[0].policy!=='drop'||chains[0].prio!==0)throw new Error('Observed default-deny kernel policy differs.');
  const actual=rules.filter((r:any)=>r.rule).map((r:any)=>r.rule);if(actual.length!==tuples.length)throw new Error('Observed policy tuple count differs.');
  for(let i=0;i<actual.length;i++){const rule=actual[i],t=tuples[i]!;const expected=[{match:{op:'==',left:{payload:{protocol:t.family===4?'ip':'ip6',field:'daddr'}},right:t.address}},{match:{op:'==',left:{payload:{protocol:'tcp',field:'dport'}},right:t.port}},{accept:null}];if(rule.family!=='inet'||rule.table!=='hima'||rule.chain!=='output'||JSON.stringify(rule.expr)!==JSON.stringify(expected))throw new Error('Observed policy tuples/expressions differ.');}
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
