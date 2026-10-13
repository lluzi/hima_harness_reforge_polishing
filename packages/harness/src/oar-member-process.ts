// Host-owned member transport. DBOS alone drives the task; native runtime work stays
// inside an owned trusted local SDK process. Credentials never enter public facts.
import path from 'node:path';
import { readFile, mkdir, writeFile, rename, lstat, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AsyncResource } from 'node:async_hooks';
import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import { oarTaskAdapter, type OarPrepared, type OarMemberPort, type OarObservation } from './oar-task-adapter.js';
import { TeamError, type ActorGrant, type TeamDefinition, type TeamReadiness } from './team-contract.js';
import { jsonDigest, type RunStore } from './run-store.js';
import { taskToolOutput, type JsonValue } from './task-contract.js';
import { TaskAdapterMaterializationError, type FlowAdapterContext } from './flow-workflow.js';
import type { TeamServiceRuntime } from './team-service-runtime.js';
import { OarLocalMemberRuntime, type LocalMemberLease, type LocalMemberAssets } from './oar-local-member.js';
import { sendTaskEffectMessage, type EffectClosure } from './task-effects.js';
import { retainNativeMaterial } from './native-task-adapters.js';
import { teamMessageNativeInput, type TeamTransport } from './team-messages.js';

import { resolveSharedDeepSeek, sharedDeepSeekNativeBaseUrl, type SharedDeepSeekFallback, type SharedDeepSeekEnvironment } from './oar-model-configuration.js';

const json=(value:unknown):JsonValue=>JSON.parse(JSON.stringify(value));
const reference=z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/);
export const teamModelConfiguration=z.strictObject({modelRef:reference,runtime:z.enum(['pi','opencode']),
  provider:z.enum(['openai-completions','anthropic-messages']),model:z.string().min(1).max(256),baseUrl:z.string().url().refine(value=>{
    const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password&&!url.search&&!url.hash
      &&url.hostname.toLowerCase()!=='localhost'&&!url.hostname.toLowerCase().endsWith('.localhost')&&!['127.0.0.1','[::1]','0.0.0.0','[::]'].includes(url.hostname);
  },'Use an explicit HTTP(S) model endpoint; member localhost cannot address the Host.'),apiKey:z.string().min(1).max(4096)});
export type TeamModelConfiguration=z.infer<typeof teamModelConfiguration>;
export type TeamModelView=Omit<TeamModelConfiguration,'apiKey'> & {configured:true};
const profileFile=(home:string,projectId:string)=>path.join(home,'hima','team-models',jsonDigest(projectId)+'.json');
export async function readTeamModels(home:string,projectId:string):Promise<readonly TeamModelConfiguration[]> {
  const file=profileFile(home,projectId),info=await lstat(file).catch(error=>{if((error as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw error;});
  if(!info)return [];if(!info.isFile()||info.isSymbolicLink()||info.size>1024*1024)throw new TeamError('hima/team-invalid','Private member model configuration is not a bounded plain file.');
  return z.array(teamModelConfiguration).parse(JSON.parse(await readFile(file,'utf8')));
}
export async function saveTeamModel(home:string,projectId:string,raw:unknown):Promise<TeamModelView> {
  const profile=teamModelConfiguration.parse(raw),profiles=await readTeamModels(home,projectId);
  const file=profileFile(home,projectId);await mkdir(path.dirname(file),{recursive:true,mode:0o700});
  const pending=file+'.'+randomUUID();await writeFile(pending,JSON.stringify([...profiles.filter(row=>row.modelRef!==profile.modelRef),profile]),{flag:'wx',mode:0o600});await rename(pending,file);
  const {apiKey,...view}=profile;return {...view,configured:true};
}
export async function listTeamModels(home:string,projectId:string):Promise<readonly TeamModelView[]> {
  return (await readTeamModels(home,projectId)).map(({apiKey,...view})=>({...view,configured:true}));
}
interface ObservedRow {schema:string;sessionKey:string;generation:number;memberId:string;nativeSession?:string;streamGeneration:string;kind:string;seq:number;time:string;payload:unknown}
export interface OarMemberProcessOptions {home:string;retainedMaterialsDir:string;services:TeamServiceRuntime;store:RunStore;
  memberContext:(grant:ActorGrant,request:unknown)=>Promise<object>;privatePorts?:()=>readonly number[];
  localRuntime?:Pick<OarLocalMemberRuntime,'stage'|'start'|'read'|'authorize'|'reply'|'sendInput'|'readArtifact'|'close'|'stopAll'|'recover'>;
  runtimeAssets?:(runtime:'pi'|'opencode')=>Promise<LocalMemberAssets>;
  sharedDeepSeekModel:(readCredential:boolean)=>Promise<SharedDeepSeekFallback>;modelEnvironment?:()=>SharedDeepSeekEnvironment}
async function memberSkillFiles(member:TeamDefinition['members'][number]):Promise<readonly {path:string;bytes:Uint8Array}[]> {
  const root=new URL('../skills/',import.meta.url),files:{path:string;bytes:Uint8Array}[]=[];
  async function walk(relative:string) {
    const entries=await readdir(new URL(relative+'/',root),{withFileTypes:true});
    for(const entry of entries) {
      const name=relative+'/'+entry.name;if(entry.isSymbolicLink())throw new Error('Member Skills cannot stage symbolic links.');
      if(entry.isDirectory())await walk(name);
      else if(entry.isFile()) {const bytes=await readFile(new URL(name,root));if(bytes.length>1024*1024||files.length>=64)throw new Error('Selected native Skills exceed the bounded staging contract.');files.push({path:'/hima-home/skills/'+name,bytes});}
    }
  }
  for(const skill of member.skills) {
    if(!reference.safeParse(skill).success)throw new Error('Choose an installed Skill reference.');
    const info=await lstat(new URL(skill+'/SKILL.md',root));if(!info.isFile()||info.isSymbolicLink())throw new Error('Installed Skill definition is unavailable.');await walk(skill);
  }
  if(member.skills.length)await walk('knowledge');
  return files;
}

const nativeAssetCache=new Map<string,Promise<LocalMemberAssets>>();
export async function resolveLocalOarAssets(runtime:'pi'|'opencode'):Promise<LocalMemberAssets> {
  const key=JSON.stringify([runtime,process.env.HIMA_OAR_MODULE,process.env.HIMA_OPENCODE_COMMAND,process.execPath,process.env.PATH]);
  const prior=nativeAssetCache.get(key);if(prior)return prior;
  const operation=(async()=>{
    let oarModule:string;
    try {oarModule=await realpath(process.env.HIMA_OAR_MODULE??createRequire(import.meta.url).resolve('@botiverse/oar'));}
    catch {throw new Error('Installed OAR SDK is unavailable; select the existing local SDK with HIMA_OAR_MODULE.');}
    const metadata=JSON.parse(await readFile(path.join(path.dirname(path.dirname(oarModule)),'package.json'),'utf8')) as {name?:string;version?:string};
    if(metadata.name!=='@botiverse/oar'||metadata.version!=='0.46.0')throw new Error('This adapter requires the qualified OAR 0.46.0 SDK.');
    let opencodeCommand=process.env.HIMA_OPENCODE_COMMAND;
    if(!opencodeCommand)for(const directory of (process.env.PATH??'').split(path.delimiter)) {
      const candidate=path.join(directory,'opencode');try{await access(candidate,constants.X_OK);opencodeCommand=candidate;break;}catch{}
    }
    if(!opencodeCommand&&runtime==='opencode')throw new Error('Installed native OpenCode CLI is unavailable.');
    opencodeCommand=opencodeCommand?await realpath(opencodeCommand):path.join(path.dirname(process.execPath),'opencode-not-used');
    let opencodeVersion='not-used';
    if(runtime==='opencode') {
      const output=await promisify(execFile)(opencodeCommand,['--version'],{timeout:10000,maxBuffer:4096,env:{PATH:process.env.PATH,HOME:process.env.HOME,LANG:process.env.LANG}});
      opencodeVersion=output.stdout.trim();if(!/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(opencodeVersion))throw new Error('Native OpenCode version is unrecognized.');
    }
    return {oarModule,nodeExecutable:process.execPath,opencodeCommand,opencodeVersion};
  })();nativeAssetCache.set(key,operation);try{return await operation;}catch(error){nativeAssetCache.delete(key);throw error;}
}

export function createOarMemberExecutor(options:OarMemberProcessOptions) {
  const {store}=options;
  // Capture the Host callback context when the service is registered. Member tool
  // requests are Host operations, not nested DBOS transactions inside an I/O Step.
  const memberCallbacks=new AsyncResource('hima-oar-member-callbacks',{requireManualDestroy:true});
  const fact=(p:OarPrepared,key:string)=>store.externalEffectFact(p.identity,'oar:'+key);
  const record=(p:OarPrepared,key:string,value:unknown)=>store.recordExternalEffectFact(p.identity,'oar:'+key,json(value));
  let ownedRuntime:OarMemberProcessOptions['localRuntime'];
  let ownedRuntimeCreation:Promise<NonNullable<OarMemberProcessOptions['localRuntime']>>|undefined;
  const assetsFor=options.runtimeAssets??resolveLocalOarAssets;
  async function local(p:Pick<OarPrepared,'runtime'>) {
    if(options.localRuntime)return options.localRuntime;
    if(ownedRuntime)return ownedRuntime;
    ownedRuntimeCreation??=(async()=>{
      const assets=await assetsFor(p.runtime);
      return ownedRuntime=new OarLocalMemberRuntime({home:options.home,nodeExecutable:assets.nodeExecutable,
        runnerModule:fileURLToPath(new URL('./oar-member-runner.js',import.meta.url)),assets});
    })();
    try{return await ownedRuntimeCreation;}catch(error){ownedRuntimeCreation=undefined;throw error;}
  }
  const lease=async(p:OarPrepared):Promise<LocalMemberLease|undefined>=>{
    const original=await fact(p,'local-lease') as unknown as LocalMemberLease|undefined;
    const recovered=await (await local(p)).recover(p.sessionKey);
    if(recovered) {
      if(recovered.sessionKey!==p.sessionKey||recovered.generation!==p.generation||recovered.memberId!==p.memberId
        ||original&&(recovered.controlDirectory!==original.controlDirectory||recovered.workDirectory!==original.workDirectory))throw new Error('Original local member identity differs.');
      if(recovered.pid)await record(p,'local-birth:'+recovered.pid+':'+recovered.startIdentity,recovered);
      return recovered;
    }
    return original;
  };
  const grantId=(p:OarPrepared)=>'grant-'+jsonDigest([p.sessionKey,p.generation]);
  const boundedReply=(value:unknown)=>{
    const body=JSON.stringify(value);
    return Buffer.byteLength(body)<=16384?body:JSON.stringify({ok:false,error:'Member context response exceeds 16 KiB; request a smaller page or narrower context.'});
  };
  async function permit(p:OarPrepared,operation:'submit'|'message'|'release'):Promise<boolean> {
    const effect=await store.effect(p.identity.effectId);
    if(!effect||jsonDigest(effect.identity)!==jsonDigest(p.identity))return false;
    if(operation==='release')return true;
    const run=await store.run(p.identity.runId);
    return run.epoch===p.generation&&!run.cancelled&&!run.hold&&Date.now()<Date.parse(p.deadlineAt)&&!await store.hostExit();
  }
  async function model(p:Pick<OarPrepared,'projectId'|'modelRef'|'runtime'>) {
    const current=(await readTeamModels(options.home,p.projectId)).find(row=>row.modelRef===p.modelRef&&row.runtime===p.runtime);
    if(current)return current;
    if(p.modelRef==='default') {
      const environment=options.modelEnvironment?.()??process.env;
      const shared=resolveSharedDeepSeek(environment,await options.sharedDeepSeekModel(environment.DEEPSEEK_API_KEY===undefined));
      const config=teamModelConfiguration.parse({modelRef:'default',runtime:p.runtime,...shared.configuration});
      return {...config,nativeBaseUrl:sharedDeepSeekNativeBaseUrl(p.runtime,config.baseUrl,config.provider)};
    }
    throw new TeamError('hima/team-not-ready','Configure the exact member runtime/model reference.');
  }
  async function original(p:OarPrepared):Promise<LocalMemberLease> {
    const held=await lease(p);if(!held)throw new Error('Original local OAR member identity is unavailable; do not create another native session.');return held;
  }
  async function observe(p:OarPrepared):Promise<OarObservation> {
    const held=await lease(p);if(!held)return {state:'unknown',reason:'Original local member creation acknowledgement is unavailable; do not restart.'};
    try {
      const captured=await (await local(p)).read(held);
      const state=captured.state?JSON.parse(captured.state) as {phase?:string;reason?:string;failureReason?:string;fatal?:boolean}:undefined;
      const rows=captured.journal.trim()?captured.journal.trim().split('\n').map(line=>JSON.parse(line) as ObservedRow):[];
      for(const row of rows) {
        if(row.schema!=='hima-oar-observation/1'||row.sessionKey!==p.sessionKey||row.generation!==p.generation||row.memberId!==p.memberId
          ||!Number.isSafeInteger(row.seq)||row.seq<0||!row.streamGeneration)throw new Error('Native observation belongs to another member/session/generation.');
        await record(p,'observation:'+row.streamGeneration+':'+row.seq,row);
      }
      const created=rows.find(row=>row.kind==='created');
      if(created) {
        const native=created.payload as {runtime?:string;nativeSession?:string};
        if(native.runtime!==p.runtime||!native.nativeSession||created.nativeSession!==native.nativeSession)throw new Error('Native creation receipt differs from the frozen runtime.');
        const identity={runtime:p.runtime,nativeSession:native.nativeSession,streamGeneration:created.streamGeneration,controlDirectory:held.controlDirectory,workDirectory:held.workDirectory,sessionKey:p.sessionKey,generation:p.generation};
        await record(p,'native-session',identity);
        if(!await fact(p,'prompt-granted')&&await permit(p,'submit')) {
          const run=await store.run(p.identity.runId),authorization={...identity,inputId:p.inputId};
          if(await store.claimEffectDispatch({runId:run.runId,effectId:p.identity.effectId,owner:run.owner,epoch:p.generation,revision:run.revision},()=>permit(p,'submit'),'oar-prompt',jsonDigest(authorization)))await record(p,'prompt-granted',authorization);
          else {
            // The original claim is not permission to create/send again; an ACK file
            // only unlocks this already prepared, exclusive-start native supervisor.
            await record(p,'prompt-granted',authorization);
          }
        }
        const authorization=await fact(p,'prompt-granted');
        if(authorization&&!state?.fatal&&!['failed','closed'].includes(state?.phase??'')&&await permit(p,'submit'))await (await local(p)).authorize(held,authorization as unknown as {sessionKey:string;generation:number;nativeSession:string;inputId:string});
      }
      for(const request of captured.requests) {
        const prior=await fact(p,'tool-reply:'+request.id);
        if(prior) {await (await local(p)).reply(held,request.id,boundedReply(prior));continue;}
        let answer:unknown;
        try {
          const grant=await store.readTeamGrant(grantId(p));if(!grant)throw new Error('Original member grant is unavailable.');
          answer={ok:true,value:await memberCallbacks.runInAsyncScope(()=>options.memberContext(grant,(({id,...body})=>body)(JSON.parse(request.body))))};
        }catch(error){answer={ok:false,error:error instanceof Error?error.message:String(error)};}
        const reply=boundedReply(answer);
        await record(p,'tool-reply:'+request.id,JSON.parse(reply));await (await local(p)).reply(held,request.id,reply);
      }
      const received=rows.find(row=>row.kind==='received'&&(row.payload as {inputId?:string})?.inputId===p.inputId);
      if(captured.result) {
        const result=JSON.parse(captured.result) as {sessionKey:string;generation:number;memberId:string;nativeSession:string;streamGeneration:string;inputId:string;deliveryInputId?:string;output:unknown};
        const native=await fact(p,'native-session') as {nativeSession?:string}|undefined;
        if(result.sessionKey!==p.sessionKey||result.generation!==p.generation||result.memberId!==p.memberId||result.inputId!==p.inputId||!result.nativeSession||native?.nativeSession!==result.nativeSession
          ||!received||received.nativeSession!==result.nativeSession||received.streamGeneration!==result.streamGeneration)throw new Error('Native result has no matching original runtime receive evidence.');
        const deliveredInput=result.deliveryInputId??p.inputId;
        const deliveryReceived=rows.find(row=>row.kind==='received'&&row.nativeSession===result.nativeSession
          &&row.streamGeneration===result.streamGeneration&&(row.payload as {inputId?:string}).inputId===deliveredInput);
        const terminal=rows.find(row=>row.kind==='terminal'&&row.nativeSession===result.nativeSession
          &&row.streamGeneration===result.streamGeneration&&(row.payload as {inputId?:string}).inputId===deliveredInput);
        const completion=terminal?.payload as {received?:boolean;outcome?:{kind?:string}}|undefined;
        if(!deliveryReceived||!completion?.received||completion.outcome?.kind!=='completed')throw new Error('Native result has no matching completed turn evidence.');
        const output=taskToolOutput.parse(result.output);
        for(const artifact of output.artifacts) {
          if(artifact.runId!==p.identity.runId||artifact.taskId!==p.identity.taskId||artifact.effectId!==p.identity.effectId)throw new Error('Member artifact belongs to another task effect.');
          const chunks:Buffer[]=[],digest=createHash('sha256');let offset=0,total:number|undefined;
          do {
            const chunk=await (await local(p)).readArtifact(held,artifact.path,offset);
            if(total!==undefined&&chunk.total!==total)throw new Error('Member artifact size changed during collection.');total=chunk.total;
            const bytes=Buffer.from(chunk.bytes);chunks.push(bytes);digest.update(bytes);offset+=bytes.length;
            if(!bytes.length&&offset<total)throw new Error('Member artifact stream ended before its declared size.');
          }while(offset<total!);
          if(digest.digest('hex')!==artifact.sha256)throw new Error('Member artifact bytes differ from the delivered SHA256.');
          const retainedPath=await retainNativeMaterial(options.retainedMaterialsDir,Buffer.concat(chunks),artifact.sha256);
          await record(p,'artifact:'+artifact.name,{...artifact,bytes:total,retainedPath});
        }
        return {state:'ready',receipt:json({nativeSession:result.nativeSession,streamGeneration:result.streamGeneration,inputId:p.inputId,receivedAt:received.time}),output};
      }
      if(state?.fatal||state?.phase==='failed')return {state:'failed',reason:state.failureReason??state.reason??'Original native runtime failed.',receipt:json(held)};
      return received?{state:'running',reason:'Original runtime received its input; retained native work is in progress.'}:{state:'unknown',reason:'No original runtime receive evidence yet; local OAR ACK is insufficient.'};
    }catch(error){return {state:'unknown',reason:error instanceof Error?error.message:String(error)};}
  }
  const port:OarMemberPort={permit,
    async stage(p,beforeStage) {
      await beforeStage();
      const source='source' in p.identity?p.identity.source:undefined;if(source?.kind!=='team')throw new Error('OAR member requires its exact independent Team source.');
      if(!await store.readTeamGrant(grantId(p)))await memberCallbacks.runInAsyncScope(()=>store.issueTeamGrant({grantId:grantId(p),actorId:p.memberId,projectId:p.projectId,teamId:source.team.teamId,
        taskId:source.taskId,memberId:p.memberId,runId:p.identity.runId,effectId:p.identity.effectId,generation:p.generation,
        capabilities:['read-task','send-message','read-material','query-memory'],expiresAt:p.deadlineAt,revokedAt:null}));
      const config=await model(p),bound=await fact(p,'model-binding'),digest=jsonDigest(config);
      if(bound&&bound!==digest)throw new Error('Member model configuration changed after original preparation; restore it before recovery.');
      await record(p,'model-binding',digest);
      const assets=await assetsFor(p.runtime),runner=await readFile(new URL('./oar-member-runner.js',import.meta.url));
      const controllerBinding={runnerSha256:createHash('sha256').update(runner).digest('hex'),assets};
      const prior=await fact(p,'controller-binding');if(prior&&jsonDigest(prior)!==jsonDigest(controllerBinding))throw new Error('Original member runtime/controller changed; restore it before recovery.');
      await record(p,'controller-binding',controllerBinding);
      const snapshot=await store.run(p.identity.runId),definition=(snapshot.opening.data as unknown as {definition:TeamDefinition}).definition;
      const member=definition.members.find(row=>row.id===p.memberId)!;
      const skillFiles=await memberSkillFiles(member);await record(p,'skill-binding',skillFiles.map(file=>({path:file.path,sha256:createHash('sha256').update(file.bytes).digest('hex')})));
      await record(p,'local-intent',{sessionKey:p.sessionKey,generation:p.generation,memberId:p.memberId});
      const held=await (await local(p)).stage({prepared:p,model:config,outputSchemaVersion:definition.delivery.output.version,assets},skillFiles);
      await record(p,'local-lease',held);
    },
    async submit(p,beforeSubmit) {
      const held=await original(p);await beforeSubmit();await (await local(p)).start(held);
      const born=await (await local(p)).recover(p.sessionKey);if(born?.pid)await record(p,'local-birth:'+born.pid+':'+born.startIdentity,born);
      return json({sessionKey:p.sessionKey,generation:p.generation});
    },
    observe:async p=>observe(p),
    async close(p,_receipt,beforeCleanup):Promise<EffectClosure> {
      const alreadyClosed=await fact(p,'closed');if(alreadyClosed)return {closed:true,proof:alreadyClosed};
      let held=await lease(p);
      if(!held) {
        if(await fact(p,'local-intent')||await fact(p,'namespace-intent')||await store.effectDispatchExists(p.identity,'submit'))return {closed:false,reason:'Original member creation intent is unresolved; reconcile its retained resource identity.'};
        return {closed:true,proof:{neverSubmitted:true,sessionKey:p.sessionKey}};
      }
      // Retain available native transcript before closing its original process; failure is explicit.
      await observe(p);held=await lease(p)??held;
      const run=await store.run(p.identity.runId);
      if(!run.cancelled&&!run.hold&&!await store.hostExit()&&Date.now()<Date.parse(p.deadlineAt)) {
        const intents=Object.values(await store.listExternalEffectFacts(p.identity,'oar:input-intent:')) as unknown as {id:string}[];
        let captured:Awaited<ReturnType<OarLocalMemberRuntime['read']>>|undefined;
        try {captured=await (await local(p)).read(held);}catch {if(intents.length)return {closed:false,reason:'Directed native work is unobservable; explicit stop or original closure reconciliation is required.'};}
        if(captured) {
          const state=captured.state?JSON.parse(captured.state) as {phase:string}:undefined;
          const rows=captured.journal.trim()?captured.journal.trim().split('\n').map(line=>JSON.parse(line) as ObservedRow):[];
          if(state?.phase==='running'||intents.some(intent=>!rows.some(row=>row.kind==='terminal'&&(row.payload as {inputId?:string}).inputId===intent.id)))return {closed:false,reason:'Original native member still owns an active or unconfirmed directed input.'};
        }
      }
      if(beforeCleanup&&!await beforeCleanup('oar-member-close',json(held))) {
        const proof=await fact(p,'closed');if(proof)return {closed:true,proof};
        const observed=await (await local(p)).close(held);if(!observed.closed)return {closed:false,reason:observed.reason??'Original local process cleanup acknowledgement is unavailable.'};
        const recovered=json(observed.proof);await record(p,'closed',recovered);await store.revokeTeamGrant(grantId(p));return {closed:true,proof:recovered};
      }
      const closed=await (await local(p)).close(held);if(!closed.closed)return {closed:false,reason:closed.reason??'Original member closure is unproved.'};
      await store.revokeTeamGrant(grantId(p));const proof=json(closed.proof??{sessionKey:p.sessionKey,controlDirectory:held.controlDirectory,workDirectory:held.workDirectory,closed:true});
      await record(p,'closed',proof);return {closed:true,proof};
    },
    async send(p,id,input,beforeSubmit) {
      await beforeSubmit();await record(p,'input-intent:'+id,{id,inputSha256:jsonDigest(input)});await (await local(p)).sendInput(await original(p),id,typeof input==='string'?input:JSON.stringify(input));
      const observed=await port.observeMessage(p,id,input);if(!observed)throw new Error('Native input is staged; no runtime receive proof yet.');return observed;
    },
    async observeMessage(p,id,_input) {
      await observe(p);
      const rows=await store.listExternalEffectFacts(p.identity,'oar:observation:');
      const received=Object.values(rows).map(row=>row as unknown as ObservedRow).find(row=>row.kind==='received'&&(row.payload as {inputId?:string})?.inputId===id);
      return received?json({nativeReceiptId:received.nativeSession+':'+received.streamGeneration+':'+received.seq,receivedAt:received.time,sessionKey:p.sessionKey,generation:p.generation,inputId:id}):undefined;
    },
  };
  async function deliveryBinding(effectId:string,runId:string) {
    const run=await store.run(runId),invocation=(await store.flowInvocations(runId)).find(row=>row.identity.effectId===effectId);
    if(!invocation)throw new Error('Original member invocation is unavailable.');
    const context=invocation.context as unknown as {flow:FlowAdapterContext['flow'];input:JsonValue;taskId:string};
    const definition=(run.opening.data as unknown as {definition:TeamDefinition}).definition,task=context.flow.tasks[context.taskId]!;
    const member=definition.members.find(row=>row.id===task.memberId);if(!member)throw new Error('Original member definition is unavailable.');
    const request={identity:invocation.identity,admission:{runId,effectId,owner:run.owner,epoch:run.epoch,revision:run.revision},input:context.input,contract:task.contract};
    const adapter=oarTaskAdapter({member,deadlineAt:run.deadlineAt,port,resources:{siteId:'oar:'+context.flow.method!.sha256,jobs:1,licences:{}},capacity:{jobs:1,licences:{}}});
    return {run,request,adapter};
  }
  const transport:TeamTransport={
    async canDeliver(message,delivery) {
      const task=await store.readTeamTask(message.projectId,message.teamId,message.taskId);if(!task)return false;
      const invocations=await store.flowInvocations(task.currentRunId);
      for(const invocation of invocations) {
        const context=invocation.context as unknown as {flow:FlowAdapterContext['flow'];taskId:string};
        if(context.flow.tasks[context.taskId]?.memberId!==delivery.recipientMemberId)continue;
        const prepared=await store.effectFact(invocation.identity.effectId,'prepared') as unknown as OarPrepared|undefined;
        if(!prepared||prepared.schema!=='hima-oar-task/1'||!await permit(prepared,'message')||await fact(prepared,'closed')||!await lease(prepared))continue;
        const rows=Object.values(await store.listExternalEffectFacts(prepared.identity,'oar:observation:'));
        if(rows.some(row=>(row as unknown as ObservedRow).kind==='created'))return true;
      }
      return false;
    },
    async deliver(message,delivery) {
      if(!delivery.target)return {state:'unknown',reason:'No frozen target invocation is bound.'};
      const target=delivery.target,binding=await deliveryBinding(target.effectId,target.runId);
      const answer=await sendTaskEffectMessage(store,binding.request,binding.adapter,delivery.deliveryId,teamMessageNativeInput(message));
      if(answer.state!=='completed')return {state:'unknown',reason:answer.reason.message};
      const received=answer.value as {nativeReceiptId?:string;receivedAt?:string;generation?:number};
      return received.nativeReceiptId&&received.receivedAt&&received.generation===target.generation?{state:'accepted',received:{nativeReceiptId:received.nativeReceiptId,receivedAt:received.receivedAt,target}}:{state:'unknown',reason:'Original runtime receipt did not match the current generation.'};
    },
    async observeDelivery(delivery) {
      if(!delivery.target)return {state:'unavailable',reason:'No original target invocation.'};
      const target=delivery.target,binding=await deliveryBinding(target.effectId,target.runId);
      const prepared=await store.effectFact(target.effectId,'prepared');if(!prepared)return {state:'unavailable',reason:'No original prepared native session.'};
      const value=await binding.adapter.reconcileMessage!(prepared,delivery.deliveryId,null) as {nativeReceiptId?:string;receivedAt?:string;generation?:number}|undefined;
      return value?.nativeReceiptId&&value.receivedAt&&value.generation===target.generation?{state:'accepted',received:{nativeReceiptId:value.nativeReceiptId,receivedAt:value.receivedAt,target}}:{state:'unknown',reason:'No original runtime receive proof yet.'};
    },
  };
  return {
    port,transport,dispose:async()=>{await (ownedRuntime??options.localRuntime)?.stopAll();memberCallbacks.emitDestroy();},
    async readiness(definition:TeamDefinition,projectId:string):Promise<TeamReadiness> {
      const profiles=await readTeamModels(options.home,projectId),missing:string[]=[];
      for(const member of definition.members) {
        if(!profiles.some(profile=>profile.modelRef===member.modelRef&&profile.runtime===member.runtime)) {
          try {await model({projectId,modelRef:member.modelRef,runtime:member.runtime});}
          catch(error) {missing.push(`${member.id}: ${error instanceof Error?error.message:'Member model configuration is unavailable.'}`);}
        }
        try {await memberSkillFiles(member);}catch {missing.push(`${member.id}: select installed, bounded native Skills.`);}
        if(member.toolRefs.some(ref=>ref!=='hima-member-context')||member.knowledgeRefs.length)missing.push(`${member.id}: referenced tools/knowledge must be resolved before execution.`);
      }
      for(const runtime of new Set(definition.members.map(member=>member.runtime)))try{await assetsFor(runtime);}catch(error){missing.push(error instanceof Error?error.message:'Local native runtime dependencies are unavailable.');}
      return {ready:missing.length===0,missing};
    },
    async resolve(context:FlowAdapterContext) {
      const run=await store.run(context.request.identity.runId),definition=(run.opening.data as unknown as {definition:TeamDefinition}).definition;
      const member=definition.members.find(row=>row.id===context.task.memberId);if(!member)throw new Error('Frozen Team member invocation is unavailable.');
      const projectId='source' in context.request.identity?context.request.identity.source.projectId:undefined;
      if(!projectId)throw new TaskAdapterMaterializationError({code:'team-executor-unavailable',message:'Original Team project is unavailable.',source:'oar-member'});
      try {await model({projectId,modelRef:member.modelRef,runtime:member.runtime});await assetsFor(member.runtime);}
      catch(error) {throw new TaskAdapterMaterializationError({code:'team-executor-unavailable',message:error instanceof Error?error.message:'Member model configuration is unavailable.',source:'oar-member'});}
      try {await memberSkillFiles(member);}catch {throw new TaskAdapterMaterializationError({code:'team-member-reference-unavailable',message:'Select installed, bounded native Skills before execution.',source:'oar-member'});}
      if(member.toolRefs.some(ref=>ref!=='hima-member-context')||member.knowledgeRefs.length)throw new TaskAdapterMaterializationError({code:'team-member-reference-unavailable',message:'Resolve this member\'s declared tools/knowledge before execution.',source:'oar-member'});
      return oarTaskAdapter({member,deadlineAt:run.deadlineAt,port,resources:{siteId:'oar:'+context.flow.method!.sha256,jobs:1,licences:{}},capacity:{jobs:1,licences:{}}});
    },
  };
}
