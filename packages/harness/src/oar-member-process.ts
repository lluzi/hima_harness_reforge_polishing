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
import { OarLocalMemberRuntime, type LocalMemberLease, type LocalMemberAssets, type LocalMemberContinuity, type LocalContextCapture, type LocalMemberClosure } from './oar-local-member.js';
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
  localRuntime?:Pick<OarLocalMemberRuntime,'stage'|'start'|'read'|'authorize'|'reply'|'sendInput'|'readArtifact'|'close'|'captureClosedContext'|'stopAll'|'recover'> & Partial<Pick<OarLocalMemberRuntime,'admitAcceptedWait'|'fatalState'>>;
  runtimeAssets?:(runtime:'pi'|'opencode')=>Promise<LocalMemberAssets>;
  sharedDeepSeekModel:(readCredential:boolean)=>Promise<SharedDeepSeekFallback>;modelEnvironment?:()=>SharedDeepSeekEnvironment}
const supportedMemberTools=new Set(['hima-member-context','hima-memory-adopt','hima-github-push','hima-github-pr']);
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
  const host=<T>(body:()=>Promise<T>):Promise<T>=>memberCallbacks.runInAsyncScope(body);
  const fact=(p:OarPrepared,key:string)=>host(()=>store.externalEffectFact(p.identity,'oar:'+key));
  const record=(p:OarPrepared,key:string,value:unknown)=>host(()=>store.recordExternalEffectFact(p.identity,'oar:'+key,json(value)));
  // This cursor advances only after every row in a batch has a durable Host fact.
  // A new Host starts at the original journal and replays those facts idempotently.
  const observedSequences=new Map<string,{streamGeneration:string;seq:number}>();
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
  // The retained successor plan is authoritative, including its exact prompt bytes.
  async function executionBinding(p:OarPrepared) {
    const binding=await store.readTeamExecutionBinding(p.identity),continuation=binding.continuation;
    if(Date.parse(p.deadlineAt)>Date.parse(binding.deadlineAt))throw new Error('Prepared member exceeds its retained execution deadline.');
    if(!continuation) {if(p.continuation)throw new Error('Unretained native continuation.');return binding;}
    const context=continuation.context,kind=context.kind==='native-checkpoint'?'native-resume':'reconstruction';
    const sha=context.kind==='native-checkpoint'?context.checkpoint.sha256:context.sha256;
    const expected={continuationId:continuation.continuationId,predecessorEffectId:continuation.predecessorIdentity.effectId,contextSha256:sha,kind};
    if(jsonDigest(p.identity)!==jsonDigest(continuation.invocation.identity)||jsonDigest(p.continuation??null)!==jsonDigest(expected)
      ||p.inputId!==continuation.hostInputId||p.prompt!==continuation.hostPrompt
      ||createHash('sha256').update(p.prompt).digest('hex')!==continuation.hostInputSha256)
      throw new Error('Native successor differs from its immutable Host continuation plan.');
    return binding;
  }
  async function privateLocalMemberContinuity(p:OarPrepared):Promise<LocalMemberContinuity|undefined> {
    const {continuation}=await executionBinding(p);if(!continuation)return undefined;
    const old=await store.effectFact(continuation.predecessorIdentity.effectId,'prepared') as unknown as OarPrepared|undefined;
    if(!old||jsonDigest(old.identity)!==jsonDigest(continuation.predecessorIdentity)||old.memberId!==p.memberId||old.runtime!==p.runtime
      ||old.sessionKey===p.sessionKey||old.identity.effectId===p.identity.effectId||old.identity.runId!==p.identity.runId
      ||old.identity.taskId!==p.identity.taskId||Date.parse(p.deadlineAt)>Date.parse(old.deadlineAt))throw new Error('Native continuation predecessor plan is unavailable or mismatched.');
    const stable=(identity:OarPrepared['identity'])=>{const {effectId,...rest}=identity;return rest;};
    if(jsonDigest(stable(old.identity))!==jsonDigest(stable(p.identity)))throw new Error('Native continuation changed its frozen role/source/method contract.');
    const held=await lease(old),native=await fact(old,'native-session') as {nativeSession?:string;runtime?:string;sessionKey?:string;generation?:number;workDirectory?:string;controlDirectory?:string}|undefined;
    if(!held||!await fact(old,'closed')||!native?.nativeSession||native.runtime!==old.runtime||native.sessionKey!==old.sessionKey
      ||native.generation!==old.generation||native.workDirectory!==held.workDirectory||native.controlDirectory!==held.controlDirectory)
      throw new Error('Native predecessor origin or actual closure is unavailable; cannot invent reconstruction identity.');
    const origin={identity:old.identity,sessionKey:old.sessionKey,generation:old.generation,memberId:old.memberId,runtime:old.runtime,nativeSession:native.nativeSession,cwd:held.workDirectory};
    if(continuation.context.kind==='native-checkpoint') {
      if(jsonDigest(continuation.context.checkpoint.origin)!==jsonDigest(origin))throw new Error('Native checkpoint origin differs from the physically closed predecessor.');
      return {kind:'native-resume',checkpoint:continuation.context.checkpoint};
    }
    if(jsonDigest(continuation.context.context)!==continuation.context.sha256)throw new Error('Host reconstruction context digest differs.');
    return {kind:'reconstruction',origin,contextSha256:continuation.context.sha256};
  }
  async function waiting(p:OarPrepared) {
    const binding=await executionBinding(p);
    const head=await store.readTeamEffectHead(binding.continuation?.rootIdentity??p.identity);
    return head.state==='waiting'&&jsonDigest(head.wait.parentIdentity)===jsonDigest(p.identity)?head.wait:undefined;
  }
  async function publishReply(p:OarPrepared,held:LocalMemberLease,request:{id:string;body:string},reply:string,inputId:string|undefined) {
    const body=JSON.parse(request.body) as {action?:string;request?:{requestId?:string}};
    const answer=JSON.parse(reply) as {ok?:boolean;value?:{state?:string;waitId?:string}};
    if(answer.ok===true&&answer.value?.state==='yield-accepted') {
      const accepted=await waiting(p),originalLease=await lease(p);
      const native=await fact(p,'native-session') as {nativeSession?:string;streamGeneration?:string;runtime?:string;sessionKey?:string;generation?:number;controlDirectory?:string;workDirectory?:string}|undefined;
      if(body.action!=='wait'||!accepted||accepted.requestId!==body.request?.requestId||accepted.waitId!==answer.value.waitId
        ||jsonDigest(accepted.parentIdentity)!==jsonDigest(p.identity)||!originalLease||jsonDigest(originalLease)!==jsonDigest(held)
        ||!native?.nativeSession||!native.streamGeneration||native.runtime!==p.runtime||native.sessionKey!==p.sessionKey||native.generation!==p.generation
        ||native.controlDirectory!==held.controlDirectory||native.workDirectory!==held.workDirectory||!inputId)
        throw new Error('Native wait reply requires the exact persisted parent wait and original lease.');
      const runtime=await local(p);
      if(!runtime.admitAcceptedWait)throw new Error('Native local runtime has no accepted-wait admission seam.');
      await runtime.admitAcceptedWait(held,{requestId:accepted.requestId,inputId:inputId!,streamGeneration:native.streamGeneration,
        origin:{identity:p.identity,sessionKey:p.sessionKey,generation:p.generation,memberId:p.memberId,runtime:p.runtime,nativeSession:native.nativeSession,cwd:held.workDirectory}});
    }
    await (await local(p)).reply(held,request.id,reply);
  }
  async function observeHost(p:OarPrepared):Promise<OarObservation> {
    const held=await lease(p);if(!held)return {state:'unknown',reason:'Original local member creation acknowledgement is unavailable; do not restart.'};
    try {
      const pendingWait=await waiting(p);
      const binding=await executionBinding(p);
      let captured:Awaited<ReturnType<OarLocalMemberRuntime['read']>>;
      let freshRows:ObservedRow[]=[];
      let batches=0;
      do {
        const cursor=observedSequences.get(p.identity.effectId);
        captured=await (await local(p)).read(held,{afterSeq:cursor?.seq??-1,streamGeneration:cursor?.streamGeneration,maxRows:256});
        freshRows=captured.journal.trim()?captured.journal.trim().split('\n').map(line=>JSON.parse(line) as ObservedRow):[];
        for(const row of freshRows) {
          if(row.schema!=='hima-oar-observation/1'||row.sessionKey!==p.sessionKey||row.generation!==p.generation||row.memberId!==p.memberId
            ||!Number.isSafeInteger(row.seq)||row.seq<0||!row.streamGeneration)throw new Error('Native observation belongs to another member/session/generation.');
          await record(p,'observation:'+row.streamGeneration+':'+row.seq,row);
        }
        if(freshRows.length) {
          const last=freshRows.at(-1)!;
          observedSequences.set(p.identity.effectId,{streamGeneration:last.streamGeneration,seq:last.seq});
        }
        if(captured.more) {
          // Journal catch-up is not a business wait. Yield the event loop, then keep
          // draining before the native MCP request's own response deadline expires.
          if(++batches>=64)return {state:'running',reason:'Retaining a large original native observation backlog.'};
          await new Promise<void>(resolve=>setImmediate(resolve));
        }
      } while(captured.more);
      const state=captured.state?JSON.parse(captured.state) as {phase?:string;reason?:string;failureReason?:string;fatal?:boolean}:undefined;
      const rows=[...(captured.evidence??[]) as ObservedRow[],...freshRows];
      if(state?.fatal||state?.phase==='failed')return {state:'failed',reason:state.failureReason??state.reason??'Original native runtime failed.',receipt:json(held)};
      const created=rows.find(row=>row.kind==='created');
      if(created) {
        const native=created.payload as {runtime?:string;nativeSession?:string};
        if(native.runtime!==p.runtime||!native.nativeSession||created.nativeSession!==native.nativeSession)throw new Error('Native creation receipt differs from the frozen runtime.');
        if(binding.continuation) {
          const grant=await store.readTeamGrant(grantId(p));
          if(!grant||grant.runId!==p.identity.runId||grant.effectId!==p.identity.effectId||grant.memberId!==p.memberId||grant.actorId!==p.memberId||grant.generation!==p.generation)
            throw new Error('Native successor creation differs from its current effect grant.');
          const saved=binding.continuation.context;
          if(saved.kind==='native-checkpoint'&&native.nativeSession!==saved.checkpoint.origin.nativeSession)
            throw new Error('Native resume returned a different conversation identity.');
          if(saved.kind==='reconstruction') {
            const old=await store.externalEffectFact(binding.continuation.predecessorIdentity,'oar:native-session') as {nativeSession?:string}|undefined;
            if(!old?.nativeSession||native.nativeSession===old.nativeSession)throw new Error('Native reconstruction must use a distinct known conversation identity.');
          }
        }
        const identity={runtime:p.runtime,nativeSession:native.nativeSession,streamGeneration:created.streamGeneration,controlDirectory:held.controlDirectory,workDirectory:held.workDirectory,sessionKey:p.sessionKey,generation:p.generation};
        await record(p,'native-session',identity);
        if(!pendingWait&&!await fact(p,'prompt-granted')&&await permit(p,'submit')) {
          const run=await store.run(p.identity.runId),authorization={...identity,inputId:p.inputId};
          if(await store.claimEffectDispatch({runId:run.runId,effectId:p.identity.effectId,owner:run.owner,epoch:p.generation,revision:run.revision},()=>permit(p,'submit'),'oar-prompt',jsonDigest(authorization)))await record(p,'prompt-granted',authorization);
          else {
            // The original claim is not permission to create/send again; an ACK file
            // only unlocks this already prepared, exclusive-start native supervisor.
            await record(p,'prompt-granted',authorization);
          }
        }
        const authorization=await fact(p,'prompt-granted');
        if(!pendingWait&&authorization&&!state?.fatal&&!['failed','closed'].includes(state?.phase??'')&&await permit(p,'submit'))await (await local(p)).authorize(held,authorization as unknown as {sessionKey:string;generation:number;nativeSession:string;inputId:string});
      }
      const received=rows.find(row=>row.kind==='received'&&(row.payload as {inputId?:string})?.inputId===p.inputId);
      const native=await fact(p,'native-session') as {nativeSession?:string;streamGeneration?:string}|undefined;
      if(received&&binding.continuation) {
        const grant=await store.readTeamGrant(grantId(p));
        if(!grant||grant.effectId!==p.identity.effectId||grant.runId!==p.identity.runId||grant.memberId!==p.memberId||grant.generation!==p.generation
          ||!native?.nativeSession||received.nativeSession!==native.nativeSession||received.streamGeneration!==native.streamGeneration)
          throw new Error('Successor receive observation differs from its current grant/native identity.');
        await store.recordTeamResultInputReceipt({continuationId:binding.continuation.continuationId,successorIdentity:p.identity,
          hostInputId:p.inputId,hostInputSha256:binding.continuation.hostInputSha256,nativeReceipt:json({nativeReceiptId:received.nativeSession+':'+received.streamGeneration+':'+received.seq,receivedAt:received.time,sessionKey:p.sessionKey,generation:p.generation,inputId:p.inputId})});
      }
      // A successor cannot delegate, wait, or publish any other tool reply until
      // its actual Host result input is durably acknowledged. The prior ordering
      // let a fast delegate/wait supersede the effect before this receipt existed.
      if(binding.continuation&&!received)return {state:'running',reason:'Awaiting actual successor result input receipt.'};
      const currentInput=rows.findLast(row=>row.kind==='control'&&(row.payload as {action?:string})?.action==='send_intent');
      const currentInputId=(currentInput?.payload as {inputId?:string}|undefined)?.inputId;
      for(const request of captured.requests) {
        const prior=await fact(p,'tool-reply:'+request.id);
        if(prior) {await publishReply(p,held,request,boundedReply(prior),currentInputId);continue;}
        let answer:unknown;
        try {
          const grant=await store.readTeamGrant(grantId(p));if(!grant)throw new Error('Original member grant is unavailable.');
          answer={ok:true,value:await memberCallbacks.runInAsyncScope(()=>options.memberContext(grant,(({id,...body})=>body)(JSON.parse(request.body))))};
        }catch(error){answer={ok:false,error:error instanceof Error?error.message:String(error)};}
        const reply=boundedReply(answer);
        await record(p,'tool-reply:'+request.id,JSON.parse(reply));await publishReply(p,held,request,reply,currentInputId);
      }
      if(pendingWait||await fact(p,'yield-intent')||await waiting(p))return {state:'running',reason:'Accepted native wait retains the old parent transcript; its result is pending successor continuation.'};
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
      return received?{state:'running',reason:'Original runtime received its input; retained native work is in progress.'}:{state:'unknown',reason:'No original runtime receive evidence yet; local OAR ACK is insufficient.'};
    }catch(error){
      // A failed journal correctly refuses to serve a partial observation
      // cursor. Its separate lease-bound fatal control fact still terminates
      // business waiting; it does not claim durable rows or normal closure.
      try {const fatal=await (await local(p)).fatalState?.(held);
        if(fatal)return {state:'failed',reason:fatal.reason,receipt:json(held)};}
      catch { /* An unavailable or mismatched control fact stays unknown. */ }
      return {state:'unknown',reason:error instanceof Error?error.message:String(error)};
    }
  }
  const observe=(p:OarPrepared):Promise<OarObservation>=>host(()=>observeHost(p));
  const physicalProof=(closed:LocalMemberClosure,held:LocalMemberLease):JsonValue|undefined=>closed.proof?json(closed.proof)
    :closed.closed&&closed.reason==='Never started'&&!held.pid?json({neverStarted:true,sessionKey:held.sessionKey,generation:held.generation,
      memberId:held.memberId,controlDirectory:held.controlDirectory,workDirectory:held.workDirectory}):undefined;
  const port:OarMemberPort={permit,
    async stage(p,beforeStage) {
      await beforeStage();
      await host(async()=>{
        const continuity=await privateLocalMemberContinuity(p);
        const snapshot=await store.run(p.identity.runId),opening=snapshot.opening.data as unknown as {definition:TeamDefinition;actor?:{kind:string}},definition=opening.definition;
        const member=definition.members.find(row=>row.id===p.memberId);
        if(!member)throw new Error('Frozen Team member is unavailable.');
        const source='source' in p.identity?p.identity.source:undefined;if(source?.kind!=='team')throw new Error('OAR member requires its exact independent Team source.');
        if(!await store.readTeamGrant(grantId(p)))await memberCallbacks.runInAsyncScope(()=>store.issueTeamGrant({grantId:grantId(p),actorId:p.memberId,projectId:p.projectId,teamId:source.team.teamId,
          taskId:source.taskId,memberId:p.memberId,runId:p.identity.runId,effectId:p.identity.effectId,generation:p.generation,
          capabilities:['read-task','send-message','read-material','query-memory',...(opening.actor?.kind==='human'&&member.toolRefs.includes('hima-memory-adopt')?['adopt-memory' as const]:[]),...(definition.leaderMemberId===p.memberId?['delegate' as const]:[]),
            ...(member.toolRefs.includes('hima-github-push')?['github-push' as const]:[]),
            ...(member.toolRefs.includes('hima-github-pr')?['github-pr' as const]:[])],expiresAt:p.deadlineAt,revokedAt:null}));
        const config=await model(p),bound=await fact(p,'model-binding'),digest=jsonDigest(config);
        if(bound&&bound!==digest)throw new Error('Member model configuration changed after original preparation; restore it before recovery.');
        await record(p,'model-binding',digest);
        const assets=await assetsFor(p.runtime),runner=await readFile(new URL('./oar-member-runner.js',import.meta.url));
        const controllerBinding={runnerSha256:createHash('sha256').update(runner).digest('hex'),assets};
        const prior=await fact(p,'controller-binding');if(prior&&jsonDigest(prior)!==jsonDigest(controllerBinding))throw new Error('Original member runtime/controller changed; restore it before recovery.');
        await record(p,'controller-binding',controllerBinding);
        const skillFiles=await memberSkillFiles(member);await record(p,'skill-binding',skillFiles.map(file=>({path:file.path,sha256:createHash('sha256').update(file.bytes).digest('hex')})));
        await record(p,'local-intent',{sessionKey:p.sessionKey,generation:p.generation,memberId:p.memberId});
        const invocation=(await store.flowInvocations(p.identity.runId)).find(row=>row.identity.effectId===p.identity.effectId);
        if(!invocation||jsonDigest(invocation.identity)!==jsonDigest(p.identity))throw new Error('Exact persisted native invocation is unavailable.');
        const context=invocation.context as unknown as {flow:FlowAdapterContext['flow'];taskId:string};
        const task=context.flow.tasks[context.taskId];if(!task||task.memberId!==p.memberId)throw new Error('Persisted native role contract differs.');
        const workDirectory=continuity?(continuity.kind==='native-resume'?continuity.checkpoint.origin.cwd:continuity.origin.cwd):undefined;
        const held=await (await local(p)).stage({prepared:p,model:config,outputSchemaVersion:task.contract.output.version,assets,
          ...(definition.members.some(row=>row.skills.includes('hima-team-software')||
            row.toolRefs.includes('hima-github-push')||row.toolRefs.includes('hima-github-pr'))
            ?{softwareGithubIsolation:true as const}:{}),
          ...(continuity?{continuity,workDirectory}: {})},skillFiles);
        await record(p,'local-lease',held);
      });
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
      // An already authorized stop cannot wait for transcript durability before
      // latching the original local cleanup fence. Parent hold is not an own stop.
      const run=await store.run(p.identity.runId);
      const forcedCleanup=run.cancelled||run.hold||await store.hostExit()||await store.teamEffectOperatorRevoked(p.identity)
        ||Date.now()>=Date.parse(p.deadlineAt);
      if(!forcedCleanup) {
        // Ordinary completion must still retain evidence and refuse active input.
        await observe(p);held=await lease(p)??held;
        const intents=Object.values(await store.listExternalEffectFacts(p.identity,'oar:input-intent:')) as unknown as {id:string}[];
        let captured:Awaited<ReturnType<OarLocalMemberRuntime['read']>>|undefined;
        try {captured=await (await local(p)).read(held,{summaryOnly:true});}catch {if(intents.length)return {closed:false,reason:'Directed native work is unobservable; explicit stop or original closure reconciliation is required.'};}
        if(captured) {
          const state=captured.state?JSON.parse(captured.state) as {phase:string}:undefined;
          const rows=(captured.evidence??(captured.journal.trim()?captured.journal.trim().split('\n').map(line=>JSON.parse(line) as ObservedRow):[])) as ObservedRow[];
          if(state?.phase==='running'||intents.some(intent=>!rows.some(row=>row.kind==='terminal'&&(row.payload as {inputId?:string}).inputId===intent.id)))return {closed:false,reason:'Original native member still owns an active or unconfirmed directed input.'};
        }
      }
      if(beforeCleanup&&!await beforeCleanup('oar-member-close',json(held))) {
        const proof=await fact(p,'closed');if(proof)return {closed:true,proof};
        const observed=await (await local(p)).close(held);if(!observed.closed)return {closed:false,reason:observed.reason??'Original local process cleanup acknowledgement is unavailable.'};
        const recovered=physicalProof(observed,held);if(!recovered)return {closed:false,reason:'Original local cleanup returned no physical closure proof.'};await record(p,'closed',recovered);await host(()=>store.revokeTeamGrant(grantId(p),'closed'));return {closed:true,proof:recovered};
      }
      const closed=await (await local(p)).close(held);if(!closed.closed)return {closed:false,reason:closed.reason??'Original member closure is unproved.'};
      const proof=physicalProof(closed,held);if(!proof)return {closed:false,reason:'Original local cleanup returned no physical closure proof.'};
      await host(()=>store.revokeTeamGrant(grantId(p),'closed'));
      await record(p,'closed',proof);return {closed:true,proof};
    },
    async handoff(p,request,beforeCleanup):Promise<{closure:EffectClosure;capture:LocalContextCapture}> {
      const accepted=await host(async()=>{const wait=await waiting(p);
        if(!wait||wait.waitId!==request.waitId)throw new Error('Native handoff requires the exact persisted accepted parent wait.');
        return wait;
      });
      const held=await host(()=>original(p));
      await record(p,'yield-intent',{waitId:accepted.waitId,requestId:accepted.requestId,parentIdentity:p.identity,lease:held,
        native:await fact(p,'native-session')??null});
      // This callback is the existing atomic cleanup admission; no datasource lock is nested inside it.
      await beforeCleanup('oar-member-yield:'+accepted.waitId,json({waitId:accepted.waitId,requestId:accepted.requestId,lease:held}));
      return host<{closure:EffectClosure;capture:LocalContextCapture}>(async()=>{
        const current=await waiting(p);if(!current||current.waitId!==accepted.waitId||current.requestId!==accepted.requestId)
          throw new Error('Accepted native wait changed before original process cleanup.');
        // A replayed cleanup claim still reconciles the same original lease; it never starts another process.
        let proof=await fact(p,'closed');
        if(!proof) {
          const closed=await (await local(p)).close(held,{yieldRequestId:accepted.requestId});
          if(!closed.closed||!closed.proof)return {closure:{closed:false,reason:closed.reason??'Native yield physical closure is unproved.'},capture:{state:'unavailable',reason:'Original physical closure is unconfirmed.'}};
          proof=json(closed.proof);await record(p,'closed',proof);
        }
        const retained=await (await local(p)).read(held,{summaryOnly:true});
        const localState=retained.state?JSON.parse(retained.state) as {fatal?:boolean;phase?:string;failureReason?:string}:undefined;
        if(localState?.fatal||localState?.phase==='failed')
          throw new Error('Failed native parent cannot continue after yield: '+(localState.failureReason??'retained native failure'));
        await store.revokeTeamGrant(grantId(p),'yield');
        let capture:LocalContextCapture;
        try {capture=await (await local(p)).captureClosedContext(held,accepted.requestId,{maxFiles:256,maxBytes:32*1024*1024,maxFileBytes:16*1024*1024});}
        catch(error) {capture={state:'unavailable',reason:error instanceof Error?error.message:String(error)};}
        await record(p,'yield-capture',capture);
        return {closure:{closed:true,proof},capture};
      });
    },
    async send(p,id,input,beforeSubmit) {
      await beforeSubmit();await record(p,'input-intent:'+id,{id,inputSha256:jsonDigest(input)});await (await local(p)).sendInput(await original(p),id,typeof input==='string'?input:JSON.stringify(input));
      const observed=await port.observeMessage(p,id,input);if(!observed)throw new Error('Native input is staged; no runtime receive proof yet.');return observed;
    },
    async observeMessage(p,id,_input) {
      await observe(p);
      const received=await host(()=>store.externalEffectReceivedObservation(p.identity,id)) as ObservedRow|undefined;
      const native=await fact(p,'native-session') as {nativeSession?:string;streamGeneration?:string}|undefined;
      return received&&received.nativeSession===native?.nativeSession&&received.streamGeneration===native?.streamGeneration
        ?json({nativeReceiptId:received.nativeSession+':'+received.streamGeneration+':'+received.seq,receivedAt:received.time,sessionKey:p.sessionKey,generation:p.generation,inputId:id}):undefined;
    },
  };
  function continuationOptions(continuation:Awaited<ReturnType<RunStore['readTeamExecutionBinding']>>['continuation']) {
    if(!continuation)return {};
    return {continuation:{continuationId:continuation.continuationId,predecessorEffectId:continuation.predecessorIdentity.effectId,
      contextSha256:continuation.context.kind==='native-checkpoint'?continuation.context.checkpoint.sha256:continuation.context.sha256,
      kind:continuation.context.kind==='native-checkpoint'?'native-resume' as const:'reconstruction' as const,
      hostInputId:continuation.hostInputId,hostPrompt:continuation.hostPrompt}};
  }
  async function deliveryBinding(effectId:string,runId:string) {
    const run=await store.run(runId),invocation=(await store.flowInvocations(runId)).find(row=>row.identity.effectId===effectId);
    if(!invocation)throw new Error('Original member invocation is unavailable.');
    const context=invocation.context as unknown as {flow:FlowAdapterContext['flow'];input:JsonValue;taskId:string};
    const definition=(run.opening.data as unknown as {definition:TeamDefinition}).definition,task=context.flow.tasks[context.taskId]!;
    const member=definition.members.find(row=>row.id===task.memberId);if(!member)throw new Error('Original member definition is unavailable.');
    const request={identity:invocation.identity,admission:{runId,effectId,owner:run.owner,epoch:run.epoch,revision:run.revision},input:context.input,contract:task.contract};
    const binding=await host(()=>store.readTeamExecutionBinding(invocation.identity));
    const adapter=oarTaskAdapter({member,deadlineAt:binding.deadlineAt,...continuationOptions(binding.continuation),...(binding.initialHostPrompt?{initialHostPrompt:binding.initialHostPrompt}:{}),port,resources:{siteId:'oar:'+context.flow.method!.sha256,jobs:1,licences:{}},capacity:{jobs:1,licences:{}}});
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
        if(await fact(prepared,'native-session'))return true;
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
        if(member.toolRefs.some(ref=>!supportedMemberTools.has(ref))||member.knowledgeRefs.length)missing.push(`${member.id}: referenced tools/knowledge must be resolved before execution.`);
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
      if(member.toolRefs.some(ref=>!supportedMemberTools.has(ref))||member.knowledgeRefs.length)throw new TaskAdapterMaterializationError({code:'team-member-reference-unavailable',message:'Resolve this member\'s declared tools/knowledge before execution.',source:'oar-member'});
      const binding=await host(()=>store.readTeamExecutionBinding(context.request.identity));
      return oarTaskAdapter({member,deadlineAt:binding.deadlineAt,...continuationOptions(binding.continuation),...(binding.initialHostPrompt?{initialHostPrompt:binding.initialHostPrompt}:{}),port,resources:{siteId:'oar:'+context.flow.method!.sha256,jobs:1,licences:{}},capacity:{jobs:1,licences:{}}});
    },
  };
}
