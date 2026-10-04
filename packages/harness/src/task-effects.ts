// The existing executor boundary, shared by fixed DBOS task workflows. This module owns no
// scheduler or routing: it retains identity, checks the real dispatch boundary and hands off data.
import { DBOS } from '@dbos-inc/dbos-sdk';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { channelFor, mustRun } from './channel.js';
import { decideLaunch, decideRead, decideWrite } from './shell.js';
import { loadSite, pathsOf, type Site } from './sites.js';
import { toolArgv, type PackTool } from './packs.js';
import { launchRetainedJob, prepareRetainedJob, reconnectRetainedJob, retainedJobResourcesClosed, retainedJobState, stopRetainedJob } from './jobs.js';
import type { JobIdentity } from './ledger.js';
import { createTaskResult, validateTaskInput, taskJsonValue, taskDiagnostic, type JsonValue, type TaskContract, type TaskIdentity, type TaskLocalSchemas, type TaskResult, type TaskToolOutput, type TaskDiagnostic } from './task-contract.js';
import { jsonDigest, type EffectAdmission, type EffectResourceClaim, type RunStore } from './run-store.js';
import { canonicalEngineeringJson, planEngineeringTask, stageEngineeringTask, writeEngineeringRequest, waitEngineeringReceipt, readEngineeringState, readEngineeringOwned, readEngineeringDelivery, materializeEngineeringResult, type EngineeringTaskIdentity, type EngineeringTaskPlan, type EngineeringRequest, type EngineeringDelivery } from './engineering-executor.js';

export const taskEffectAdapterVersion='hima-task-effect/1';
export interface TaskEffectRequest {
  readonly identity:TaskIdentity; readonly admission:EffectAdmission;
  readonly input:JsonValue; readonly contract:TaskContract; readonly localSchemas?:TaskLocalSchemas;
}
export type EffectObservation = {readonly state:'ready';readonly receipt:JsonValue}
  | {readonly state:'running'|'unknown';readonly reason:string}
  | {readonly state:'failed';readonly reason:string;readonly receipt?:JsonValue};
export type EffectClosure={readonly closed:true;readonly proof:JsonValue}|{readonly closed:false;readonly reason:string};
/** Host composition is still collecting the original effect; this is never producer output. */
export interface TaskCollectionPending { readonly pending:true; readonly state:'running'|'waiting'; readonly reason:TaskDiagnostic }
export interface TaskEffectAdapter {
  readonly kind:'command'|'program'|'workshop'|'team'|'resident-engineering'; readonly version:string;
  readonly resources:EffectResourceClaim;
  readonly capacity:{readonly jobs:number;readonly licences:Readonly<Record<string,number>>};
  /** Read-only preparation. Its JSON must contain the exact recoverable Job/native session ID. */
  prepare(request:TaskEffectRequest):Promise<JsonValue>;
  /** Must reread the current Site/Permit, not a cached admission or projected Ledger. */
  permit(prepared:JsonValue,operation:'submit'|'message'|'release'):Promise<boolean>;
  /** Private protocol/input staging is fenced too; it cannot run merely constructing an adapter. */
  stage?(prepared:JsonValue,beforeStage:()=>Promise<void>):Promise<void>;
  /** beforeSubmit is mandatory immediately before the actual launch/API call/prompt. */
  submit(prepared:JsonValue,beforeSubmit:()=>Promise<void>):Promise<JsonValue>;
  reconcile(prepared:JsonValue,receipt:JsonValue|undefined):Promise<EffectObservation>;
  /** Workflow composition, including the existing domain Reader/child operations. This callback
   * must use taskEffectStep for raw I/O; never put its datasource/child work inside one Step. */
  collect(prepared:JsonValue,receipt:JsonValue,request:TaskEffectRequest):Promise<TaskToolOutput|TaskCollectionPending>;
  release(prepared:JsonValue,receipt:JsonValue,beforeCleanup?:(id:string,input:JsonValue)=>Promise<boolean>):Promise<EffectClosure>;
  /** Read-only original batch group closure, independent of Reader/business acceptance.
   * Native/resident scopes omit this until all of their live resources actually close. */
  settledResources?(prepared:JsonValue,receipt:JsonValue):Promise<EffectClosure>;
  /** Independent control cleanup of this original task, never a success result or new work. */
  stop?(prepared:JsonValue,receipt:JsonValue|undefined,beforeCleanup:(id:string,input:JsonValue)=>Promise<boolean>):Promise<EffectClosure>;
  message?(prepared:JsonValue,id:string,input:JsonValue,beforeSubmit:()=>Promise<void>):Promise<JsonValue>;
  reconcileMessage?(prepared:JsonValue,id:string,input:JsonValue):Promise<JsonValue|undefined>;
}
export type TaskEffectOutcome={readonly state:'succeeded';readonly result:TaskResult}
  | {readonly state:'running'|'waiting'|'failed';readonly reason:TaskDiagnostic;readonly retainedResult?:TaskResult;readonly collecting?:boolean};
function reason(state:'waiting'|'failed',code:string,message:string,retainedResult?:TaskResult):TaskEffectOutcome {
  return {state,reason:{code,message,source:'task-effect'},...(retainedResult?{retainedResult}:{})};
}
const errorText=(error:unknown)=>error instanceof Error?error.message:String(error);
const effectJobSession=(effectId:string,siteId:string,workspace:string)=>`hima-effect-${jsonDigest({effectId,siteId,workspace}).slice(0,32)}`;
/** External callbacks are DBOS Steps; application facts/results use direct datasource operations
 * outside those Steps. Never wrap executeTaskEffect itself in runStep. */
export async function taskEffectStep<T>(name:string,callback:()=>Promise<T>):Promise<T> {
  return DBOS.isInWorkflow()?DBOS.runStep(callback,{name,retriesAllowed:false}):callback();
}
const external=taskEffectStep;
function assertRequest(request:TaskEffectRequest,adapter:TaskEffectAdapter):void {
  if(request.identity.inputSha256!==jsonDigest(request.input)) throw new Error('Task input differs from its frozen SHA256 identity');
  if(request.identity.adapterVersion!==adapter.version) throw new Error('Task adapter differs from its frozen version');
  if(request.admission.runId!==request.identity.runId || request.admission.effectId!==request.identity.effectId) throw new Error('Effect admission belongs to another task identity');
  validateTaskInput(request.contract.input,request.input,request.localSchemas);
}
/** One task attempt: callers wait/reinvoke through the DBOS flow, never through a Fabric loop.
 * A submitted model result and verified delivery are retained before independently closing Jobs. */
export async function executeTaskEffect(store:RunStore,request:TaskEffectRequest,adapter:TaskEffectAdapter):Promise<TaskEffectOutcome> {
  assertRequest(request,adapter);
  const {identity}=request;
  await store.prepareEffect(identity,{kind:adapter.kind,version:adapter.version,input:request.input});
  const snapshot=await store.effectSnapshot(identity);
  const committed=snapshot.result;
  if(committed) return {state:'succeeded',result:committed};
  if(snapshot.facts['terminal-failure'])return reason('failed','executor-failed',String((snapshot.facts['terminal-failure'] as {reason:string}).reason));
  let prepared=snapshot.facts.prepared;
  if(prepared===undefined) {
    prepared=await external('hima.effect.prepare',()=>adapter.prepare(request));
    await store.recordEffectFact(identity,'prepared',prepared);
  }
  let retained=snapshot.facts['validated-result'] as TaskResult|undefined;
  let receipt=snapshot.facts.submitted;
  if(!snapshot.resourcesReleased&&!await store.reserveEffectResources(identity,adapter.resources,adapter.capacity)) return reason('waiting','site-capacity','The original Site Job/licence capacity is held; wait for confirmed resource closure');
  let resourcesReleased=snapshot.resourcesReleased;
  if(receipt===undefined && retained===undefined && !resourcesReleased) {
    try {
      const fixed=prepared;
      const submitted=await external('hima.effect.submit',async()=>{
        let checked=false;
        await adapter.stage?.(fixed,async()=>{await store.assertEffectAdmission(request.admission,()=>adapter.permit(fixed,'submit'));});
        const answer=await adapter.submit(fixed,async()=>{
          if(!await store.claimEffectDispatch(request.admission,()=>adapter.permit(fixed,'submit'),'submit',identity.inputSha256)) throw new Error('Original dispatch is already retained; reconcile the same external session');
          checked=true;
        });
        if(!checked) throw new Error('Adapter omitted its actual dispatch admission callback');
        return answer;
      });
      await store.recordEffectFact(identity,'submitted',submitted);
      receipt=submitted;
    } catch(error) {
      // Includes a lost acknowledgement and a replayed failed Step. Both query the original ID.
      // Reconciliation/collection/cleanup remain available under the original ownership even
      // after a hold/handoff. Only the actual business-send callback enforces current admission.
    }
  }
  if(retained===undefined) {
    let observed:EffectObservation;
    const failure=snapshot.facts['executor-failure'] as {reason:string;receipt?:JsonValue}|undefined;
    const ready=adapter.settledResources?snapshot.facts['executor-ready']:undefined;
    try {observed=failure?{state:'failed',...failure}:ready?{state:'ready',receipt:ready}:await external('hima.effect.reconcile',()=>adapter.reconcile(prepared!,receipt));}
    catch(error) {return reason('waiting','effect-unknown',`Query the original task session: ${errorText(error)}`);}
    if(observed.state==='failed') {
      if(!failure)await store.recordEffectFact(identity,'executor-failure',{reason:observed.reason,...(observed.receipt===undefined?{}:{receipt:observed.receipt})});
      const closure=await external('hima.effect.failed.release',async()=>{
        if(!await adapter.permit(prepared!,'release'))throw new Error('Current Site Permit cannot close the original failed task resources');
        return adapter.release(prepared!,observed.receipt??prepared!,(id,input)=>store.claimEffectCleanup(identity,()=>adapter.permit(prepared!,'release'),`cleanup:${id}`,jsonDigest(input)));
      }).catch(error=>({closed:false as const,reason:errorText(error)}));
      if(!closure.closed)return reason('waiting','resource-closure',`${observed.reason}; ${closure.reason}`);
      await store.releaseEffectResources(identity,closure.proof);
      await store.recordEffectFact(identity,'terminal-failure',{reason:observed.reason});
      return reason('failed','executor-failed',observed.reason);
    }
    if(observed.state==='running')return {state:'running',reason:{code:'effect-running',message:observed.reason,source:'task-effect'}};
    if(observed.state!=='ready') return reason('waiting','effect-unknown',observed.reason);
    if(adapter.settledResources) {
      if(!ready)await store.recordEffectFact(identity,'executor-ready',observed.receipt);
      if(!resourcesReleased) {
        const closure=await external('hima.effect.settled-resources',async()=>{
          if(!await adapter.permit(prepared!,'release'))throw new Error('Current Site Permit cannot confirm original batch closure');
          return adapter.settledResources!(prepared!,observed.receipt);
        }).catch(error=>({closed:false as const,reason:errorText(error)}));
        if(!closure.closed)return reason('waiting','resource-closure',closure.reason);
        await store.releaseEffectResources(identity,closure.proof);resourcesReleased=true;
      }
    }
    try {
      const output=await adapter.collect(prepared!,observed.receipt,request);
      if('pending' in output && output.pending===true) {
        if(output.state!=='running'&&output.state!=='waiting')throw new Error('Pending collection must describe running or waiting original work');
        return {state:output.state,reason:taskDiagnostic.parse(output.reason),collecting:true};
      }
      retained=createTaskResult(identity,request.contract,output,request.localSchemas);
      await store.recordEffectFact(identity,'validated-result',retained as unknown as JsonValue);
      await store.recordEffectFact(identity,'completion-receipt',observed.receipt);
    } catch(error) {return reason('waiting','reader-rejected',`Repair/recollect this same task delivery; producer work is retained: ${errorText(error)}`);}
    receipt=observed.receipt;
  }
  receipt=snapshot.facts['completion-receipt']??receipt??prepared;
  const released=resourcesReleased;
  if(!released) {
    let closure:EffectClosure;
    try {
      const fixed=prepared;
      closure=await external('hima.effect.release',async()=>{
        const run=await store.run(identity.runId);
        if(run.applicationVersion!==identity.applicationVersion || !await adapter.permit(fixed,'release')) throw new Error('Original resource release identity or Site Permit changed');
        return adapter.release(fixed,receipt!,(id,input)=>store.claimEffectCleanup(identity,()=>adapter.permit(fixed,'release'),`cleanup:${id}`,jsonDigest(input)));
      });
    } catch(error) {return reason('waiting','resource-closure',errorText(error),retained);}
    if(!closure.closed) return reason('waiting','resource-closure',closure.reason,retained);
    await store.releaseEffectResources(identity,closure.proof);
  }
  return {state:'succeeded',result:await store.commitResult(retained)};
}

/** Stable business message IDs share the same actual callback fence as initial dispatch. A lost
 * native response is reconnected, never resent. There is no platform quota on native task rounds. */
export async function sendTaskEffectMessage(store:RunStore,request:TaskEffectRequest,adapter:TaskEffectAdapter,id:string,input:JsonValue):Promise<{state:'completed';value:JsonValue}|{state:'waiting';reason:TaskDiagnostic}> {
  assertRequest(request,adapter);
  if(!adapter.message || !adapter.reconcileMessage) throw new Error('This adapter does not expose native task messages');
  const snapshot=await store.effectSnapshot(request.identity);
  const prepared=snapshot.facts.prepared;
  if(prepared===undefined) throw new Error('Start the original task before sending a native message');
  const phase=`message:${id}`;
  await store.recordEffectFact(request.identity,`${phase}:intent`,input);
  const previous=snapshot.facts[`${phase}:result`];
  if(previous!==undefined) return {state:'completed',value:previous};
  let answer:JsonValue|undefined;
  try {
    answer=await external('hima.effect.message',()=>adapter.message!(prepared,id,input,async()=>{
      if(!await store.claimEffectDispatch(request.admission,()=>adapter.permit(prepared,'message'),phase,jsonDigest(input))) throw new Error('Native message already dispatched; reconnect its original ID');
    }));
  } catch(error) {
    answer=await external('hima.effect.message.reconcile',()=>adapter.reconcileMessage!(prepared,id,input));
  }
  if(answer===undefined) return {state:'waiting',reason:{code:'message-unknown',message:'Query the original native session/message; no resend is permitted',source:'task-effect'}};
  await store.recordEffectFact(request.identity,`${phase}:result`,answer);
  return {state:'completed',value:answer};
}

/** Exact-name ABI for declared tool operands. Platform bindings are already frozen by Run setup;
 * authors explicitly declare business keys matching operands rather than relying on translation. */
export function bindTaskToolInputs(tool:PackTool,input:JsonValue,platform:Readonly<Record<string,string>>):Readonly<Record<string,string>> {
  if(input===null || Array.isArray(input) || typeof input!=='object') throw new Error('Command task input must be an object with exact declared operand names');
  const bound={...platform};
  for(const name of tool.inputs) {
    if(Object.hasOwn(platform,name)) {
      if(Object.hasOwn(input,name) && String(input[name])!==platform[name]) throw new Error(`Task cannot override frozen platform operand ${name}`);
      continue;
    }
    const value=input[name];
    if(typeof value!=='string' && typeof value!=='number' && typeof value!=='boolean') throw new Error(`Declare scalar business input ${name} with that exact name; structured inputs need an explicit native/program adapter`);
    bound[name]=String(value);
  }
  toolArgv(tool,bound); return bound;
}

export interface CommandTaskAdapterOptions {
  readonly sitesDir:string;readonly siteId:string;readonly workspace:string;readonly argv:readonly string[];
  readonly name:string;readonly licences?:Readonly<Record<string,number>>;
  readonly collect:(site:Site,job:JobIdentity,request:TaskEffectRequest)=>Promise<TaskToolOutput|TaskCollectionPending>;
  readonly kind?:'command'|'program';
  readonly stage?:(site:Site)=>Promise<void>;
}
/** A program may call a model internally: its final delivered business value uses this protocol,
 * and replay queries the original process instead of rerunning the program or its model calls. */
export function commandTaskAdapter(options:CommandTaskAdapterOptions):TaskEffectAdapter {
  const current=()=>loadSite(options.sitesDir,options.siteId);
  const site=current();
  const originalSiteDigest=jsonDigest(site);
  const job=(prepared:JsonValue)=>prepared as unknown as JobIdentity;
  const closedResources=async(_prepared:JsonValue,receipt:JsonValue):Promise<EffectClosure>=>{
    const original=await reconnectRetainedJob(current(),job(receipt));
    return await retainedJobResourcesClosed(current(),original)?{closed:true,proof:{session:original.session,processGroup:original.pid??null,closed:true}}:{closed:false,reason:'Original Job process group/session closure is not yet confirmed'};
  };
  return {kind:options.kind??'command',version:taskEffectAdapterVersion,
    resources:{siteId:site.name,jobs:1,licences:{...options.licences}},
    capacity:{jobs:site.capacity.parallelJobs,licences:site.capacity.licences},
    async prepare(request) {
      const on=channelFor(current()),decision=await decideLaunch(current(),options.workspace,options.argv,on);
      if(!decision.ok) throw new Error(decision.reason);
      const session=effectJobSession(request.identity.effectId,site.name,decision.workspace);
      return prepareRetainedJob(request.identity.runId,decision.workspace,options.argv,options.name,session,new Date().toISOString()) as unknown as JsonValue;
    },
    async permit(prepared,operation) {
      const fresh=current(),on=channelFor(fresh);
      if(jsonDigest(fresh)!==originalSiteDigest)return false;
      if(operation==='release') return (await decideRead(fresh,job(prepared).workspace,on)).ok;
      return (await decideLaunch(fresh,job(prepared).workspace,options.argv,on)).ok;
    },
    ...(options.stage?{async stage(_prepared:JsonValue,beforeStage:()=>Promise<void>){await beforeStage();await options.stage!(current());}}:{}),
    async submit(prepared,beforeSubmit) {return await launchRetainedJob(current(),'effect',options.argv,job(prepared),beforeSubmit) as unknown as JsonValue;},
    async reconcile(prepared,receipt) {
      const original=await reconnectRetainedJob(current(),job(receipt??prepared));
      const state=await retainedJobState(current(),original);
      if(state.state==='finished') return state.exitCode===0?{state:'ready',receipt:original as unknown as JsonValue}:{state:'failed',receipt:original as unknown as JsonValue,reason:`Original Job ${original.session} exited ${state.exitCode}; inspect its retained log`};
      return {state:state.state==='running'?'running':'unknown',reason:`Original Job ${original.session} is ${state.state}; reconnect it without launching another Job`};
    },
    collect:(_prepared,receipt,request)=>options.collect(current(),job(receipt),request),
    release:closedResources,settledResources:closedResources,
    async stop(prepared,receipt,beforeCleanup) {
      const original=await reconnectRetainedJob(current(),job(receipt??prepared));
      if(original.pid===undefined)return {closed:false,reason:'Original Job launch/PID acknowledgement is unknown; query its original identity before stop'};
      if(await retainedJobResourcesClosed(current(),original))return {closed:true,proof:{session:original.session,processGroup:original.pid??null,closed:true}};
      if(await beforeCleanup('stop-job',prepared))await stopRetainedJob(current(),original);
      return await retainedJobResourcesClosed(current(),original)?{closed:true,proof:{session:original.session,processGroup:original.pid??null,closed:true}}:{closed:false,reason:'Original Job stop request has no confirmed process-group closure'};
    },
  };
}
const relativePath=z.string().min(1).refine(value=>!value.startsWith('/')&&!value.includes('\\')&&!value.includes(':')&&value.split('/').every(part=>part!==''&&part!=='.'&&part!=='..'),'use a normalized task-workspace-relative path');
/** Raw producers never write platform identity or claimed hashes. The Host verifies bytes and
 * fills TaskArtifact ownership before admitting the normalized TaskToolOutput. */
export const taskProducerOutput=z.strictObject({schemaVersion:z.string().min(1),value:taskJsonValue,
  artifacts:z.array(z.strictObject({name:z.string().min(1),path:relativePath,mediaType:z.string().min(1).optional()})),
  diagnostics:z.array(taskDiagnostic)});
async function immutableFile(site:Site,at:string,bytes:Uint8Array):Promise<string> {
  const on=channelFor(site),p=pathsOf(site);
  const decision=await decideWrite(site,at,on);if(!decision.ok)throw new Error(decision.reason);
  const parent=await decideWrite(site,p.dirname(at),on);if(!parent.ok)throw new Error(parent.reason);
  await mustRun(on,['mkdir','-p','--',parent.absPath],'prepare private task artifact directory');
  if(!await on.absent(decision.absPath)) {
    if(createHash('sha256').update(await on.readFile(decision.absPath)).digest('hex')!==createHash('sha256').update(bytes).digest('hex')) throw new Error('Retained task file already has different bytes; use a fresh task/artifact identity');
  } else await mustRun(on,['tee','--',decision.absPath],'retain immutable task bytes',{stdin:bytes});
  if(createHash('sha256').update(await on.readFile(decision.absPath)).digest('hex')!==createHash('sha256').update(bytes).digest('hex')) throw new Error('Retained task file failed byte verification');
  return decision.absPath;
}
export async function materializeTaskInput(site:Site,workspace:string,identity:TaskIdentity,input:JsonValue):Promise<string> {
  return immutableFile(site,taskInputPath(site,workspace,identity),Buffer.from(`${canonicalTaskInput(taskJsonValue.parse(input))}\n`));
}
const taskInputPath=(site:Site,workspace:string,identity:TaskIdentity)=>pathsOf(site).join(workspace,'.hima-task-inputs',createHash('sha256').update(identity.effectId).digest('hex'),'input.json');
function canonicalTaskInput(value:JsonValue):string {
  if(Array.isArray(value))return `[${value.map(canonicalTaskInput).join(',')}]`;
  if(value!==null&&typeof value==='object')return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonicalTaskInput(value[key]!)}`).join(',')}}`;
  return JSON.stringify(value);
}
/** Actual Pack declaration -> invocation -> JSON collector. TASK_OUTPUT explicitly opts a new
 * command into the common producer format. Legacy Reader adapters remain explicitly registered. */
export async function declaredCommandTaskAdapter(options:{readonly request:TaskEffectRequest;readonly tool:PackTool;
  readonly sitesDir:string;readonly siteId:string;readonly workspace:string;readonly platform:Readonly<Record<string,string>>;
  readonly kind?:'command'|'program'}):Promise<TaskEffectAdapter> {
  if(!options.tool.inputs.includes('TASK_OUTPUT')) throw new Error(`Tool ${options.tool.id} must explicitly declare TASK_OUTPUT, or register its existing Reader/native collection adapter before dispatch`);
  const site=loadSite(options.sitesDir,options.siteId),p=pathsOf(site);
  const output=p.join(options.workspace,'.hima-task-io',createHash('sha256').update(options.request.identity.effectId).digest('hex'),'output.json');
  const platform={...options.platform,TASK_OUTPUT:output,...(options.tool.inputs.includes('TASK_INPUT')?{TASK_INPUT:taskInputPath(site,options.workspace,options.request.identity)}:{})};
  const bindings=bindTaskToolInputs(options.tool,options.request.input,platform);
  return commandTaskAdapter({sitesDir:options.sitesDir,siteId:options.siteId,workspace:options.workspace,
    name:options.tool.id,argv:toolArgv(options.tool,bindings),licences:options.tool.licences,kind:options.kind,
    async stage(site) {
      const parent=await decideWrite(site,p.dirname(output),channelFor(site));if(!parent.ok)throw new Error(parent.reason);
      await mustRun(channelFor(site),['mkdir','-p','--',parent.absPath],'prepare declared task output directory');
      if(options.tool.inputs.includes('TASK_INPUT'))await materializeTaskInput(site,options.workspace,options.request.identity,options.request.input);
    },
    collect:(site,_job,request)=>collectTaskProducerOutput(site,options.workspace,output,request)});
}
export async function collectTaskProducerOutput(site:Site,workspace:string,outputFile:string,request:TaskEffectRequest):Promise<TaskToolOutput> {
  return taskEffectStep('hima.effect.collect-json',()=>collectTaskProducerOutputFile(site,workspace,outputFile,request));
}
async function collectTaskProducerOutputFile(site:Site,workspace:string,outputFile:string,request:TaskEffectRequest):Promise<TaskToolOutput> {
  const on=channelFor(site),p=pathsOf(site);
  if(!outputFile.startsWith(`${workspace}/`)) throw new Error('TASK_OUTPUT must be inside this task workspace');
  const decision=await decideRead(site,outputFile,on);if(!decision.ok)throw new Error(decision.reason);
  const raw=taskProducerOutput.parse(JSON.parse(Buffer.from(await on.readFile(decision.absPath)).toString('utf8')));
  if(new Set(raw.artifacts.map(artifact=>artifact.name)).size!==raw.artifacts.length) throw new Error('TASK_OUTPUT artifact names must be unique');
  const artifacts=[];
  for(const artifact of raw.artifacts) {
    const at=p.join(workspace,artifact.path),read=await decideRead(site,at,on);
    if(!read.ok)throw new Error(read.reason);
    if(!read.absPath.startsWith(`${workspace}/`) || (await on.exec(['test','-L',at])).code===0 || (await on.exec(['test','-f',read.absPath])).code!==0) throw new Error('Task artifact must be a plain file inside the original task workspace');
    const bytes=await on.readFile(read.absPath),sha256=createHash('sha256').update(bytes).digest('hex');
    const relative=p.join('.hima-task-results',createHash('sha256').update(request.identity.effectId).digest('hex'),sha256,artifact.path);
    await immutableFile(site,p.join(workspace,relative),bytes);
    artifacts.push({runId:request.identity.runId,taskId:request.identity.taskId,effectId:request.identity.effectId,name:artifact.name,path:relative,sha256,...(artifact.mediaType?{mediaType:artifact.mediaType}:{})});
  }
  return {...raw,artifacts};
}

export interface ResidentTaskAdapterOptions {
  readonly sitesDir:string;readonly siteId:string;readonly identity:EngineeringTaskIdentity;
  readonly start:Extract<EngineeringRequest,{operation:'start'}>;
  /** Existing domain Reader, supplied by Host. Runtime metadata comes from request.identity. */
  readonly collect:(identity:EngineeringTaskIdentity,delivery:EngineeringDelivery,materialized:{path:string;sha256:string},request:TaskEffectRequest)=>Promise<TaskToolOutput|TaskCollectionPending>;
}
interface ResidentPrepared {
  plan:Omit<EngineeringTaskPlan,'knowledge'|'methodFiles'> & {knowledge:{path:string;sha256:string;bytes:string}[];methodFiles:{path:string;sha256:string;bytes:string}[]};
  job:JobIdentity;startId:string;
}
function decodeResident(value:JsonValue):{plan:EngineeringTaskPlan;job:JobIdentity;startId:string} {
  const held=value as unknown as ResidentPrepared;
  const decode=(files:ResidentPrepared['plan']['knowledge'])=>files.map(file=>({...file,bytes:Buffer.from(file.bytes,'base64')}));
  return {plan:{...held.plan,knowledge:decode(held.plan.knowledge),methodFiles:decode(held.plan.methodFiles)},job:held.job,startId:held.startId};
}
/** Existing task-local native protocol with automatic collection/release. No owner completion
 * request is needed; Reader repair stays on this original native task and never restarts its ECO. */
export function residentEngineeringTaskAdapter(options:ResidentTaskAdapterOptions):TaskEffectAdapter {
  const fresh=():EngineeringTaskIdentity=>({...options.identity,site:loadSite(options.sitesDir,options.siteId)});
  const originalSiteDigest=jsonDigest(options.identity.site);
  const site=options.identity.site;
  async function checkSite():Promise<boolean> {return options.identity.siteIdentityMatches && jsonDigest(fresh().site)===originalSiteDigest;}
  async function request(prepared:JsonValue,id:string,operation:Exclude<EngineeringRequest,{operation:'start'}>,payload?:Readonly<Record<string,unknown>>) {
    const held=decodeResident(prepared),identity=fresh();
    if(!await checkSite())throw new Error('Original engineering Site identity changed; reconcile under original Site before new requests');
    const sent=await writeEngineeringRequest(identity,held.plan.taskId,id,operation,payload);
    return waitEngineeringReceipt(identity.site,sent.taskDir,held.plan.taskId,id,sent.frame.sha256,operation.operation==='release'?12000:1000);
  }
  const adapter:TaskEffectAdapter={kind:'resident-engineering',version:taskEffectAdapterVersion,
    resources:{siteId:site.name,jobs:1,licences:{...options.identity.licences}},
    capacity:{jobs:site.capacity.parallelJobs,licences:site.capacity.licences},
    async prepare(task) {
      const identity=fresh(),plan=await planEngineeringTask(identity,options.start);
      const argv=[...plan.capability.wrapper.argv,'--task-dir',plan.taskDir];
      const decision=await decideLaunch(identity.site,identity.workspace,argv,channelFor(identity.site));
      if(!decision.ok)throw new Error(decision.reason);
      const session=effectJobSession(task.identity.effectId,identity.site.name,decision.workspace);
      const encode=(files:EngineeringTaskPlan['knowledge'])=>files.map(file=>({...file,bytes:Buffer.from(file.bytes).toString('base64')}));
      return {plan:{...plan,knowledge:encode(plan.knowledge),methodFiles:encode(plan.methodFiles)},
        job:prepareRetainedJob(task.identity.runId,decision.workspace,argv,`engineering-${task.identity.taskId}`,session,new Date().toISOString()),startId:'auto-start'} as unknown as JsonValue;
    },
    async permit(prepared,operation) {
      if(!await checkSite())return false;
      const identity=fresh(),held=decodeResident(prepared);
      const loaded=await import('./engineering-executor.js').then(module=>module.loadEngineeringCapability(identity.site));
      if(loaded.sha256!==held.plan.capabilitySha256)return false;
      if(operation==='submit')return (await decideLaunch(identity.site,held.job.workspace,[...held.plan.capability.wrapper.argv,'--task-dir',held.plan.taskDir],channelFor(identity.site))).ok;
      return (await decideWrite(identity.site,pathsOf(identity.site).join(held.plan.taskDir,'requests'),channelFor(identity.site))).ok;
    },
    async stage(prepared,beforeStage) {
      const identity=fresh(),held=decodeResident(prepared);
      await beforeStage();
      await stageEngineeringTask(identity,held.plan,held.startId,options.start);
    },
    async submit(prepared,beforeSubmit) {
      const identity=fresh(),held=decodeResident(prepared);
      return await launchRetainedJob(identity.site,identity.run.id,[...held.plan.capability.wrapper.argv,'--task-dir',held.plan.taskDir],held.job,beforeSubmit) as unknown as JsonValue;
    },
    async reconcile(prepared,receipt) {
      const identity=fresh(),held=decodeResident(prepared);
      const job=await reconnectRetainedJob(identity.site,(receipt??held.job) as unknown as JobIdentity);
      const state=await readEngineeringState(identity.site,held.plan.taskDir,held.plan.taskId);
      if(state?.phase==='waiting') {
        // Snapshot is an idempotent same-task filesystem operation, not another native prompt.
        const candidate=pathsOf(identity.site).join(String(held.plan.envelope.workspace),held.plan.capability.delivery.candidate);
        const read=await decideRead(identity.site,candidate,channelFor(identity.site));if(!read.ok)throw new Error(read.reason);
        const bytes=await channelFor(identity.site).readFile(read.absPath);
        const digest=createHash('sha256').update(bytes).digest('hex');
        const ack=await request(prepared,`auto-delivery-${digest.slice(0,32)}`,{operation:'delivery'});
        if(ack?.status!=='completed')return {state:'unknown',reason:ack?.error??'Original native task delivery has no confirmed snapshot; repair/recollect the same task'};
      }
      if(state?.phase==='waiting'||state?.phase==='delivered'||state?.phase==='released'||state?.phase==='stopped') {
        const delivery=await readEngineeringDelivery(identity.site,held.plan.taskDir,held.plan.taskId,identity.execution.id);
        if(delivery.runId!==identity.run.id || delivery.nodeId!==identity.execution.nodeId || state.sessionId && delivery.sessionId!==state.sessionId)throw new Error('Engineering delivery differs from original native session/Run');
        return {state:'ready',receipt:{job,delivery} as unknown as JsonValue};
      }
      if(state?.phase==='failed')return {state:'failed',receipt:{job,nativeSession:state.sessionId??null,stateSha256:state.sha256} as unknown as JsonValue,reason:'Original native task failed; inspect its retained state and owned resource facts'};
      const actual=await retainedJobState(identity.site,job);
      return {state:actual.state==='running'?'running':'unknown',reason:'Original native task has no completed delivery; reconnect that task/session without repeating its prompt'};
    },
    async collect(prepared,receipt,task) {
      const held=decodeResident(prepared),identity=fresh(),delivery=(receipt as unknown as {delivery:EngineeringDelivery}).delivery;
      const materialized=await taskEffectStep('hima.effect.materialize-engineering',()=>materializeEngineeringResult(identity,held.plan.taskDir,delivery));
      return options.collect(identity,delivery,materialized,task);
    },
    async release(prepared,receipt,beforeCleanup) {
      const identity=fresh(),held=decodeResident(prepared),completion=receipt as unknown as {job?:JobIdentity;delivery?:EngineeringDelivery;nativeSession?:string|null};
      const originalJob=await reconnectRetainedJob(identity.site,completion.job??held.job);
      let state=await readEngineeringState(identity.site,held.plan.taskDir,held.plan.taskId);
      let owned=await readEngineeringOwned(identity.site,held.plan.taskDir,held.plan.taskId);
      if(!['released','stopped'].includes(state?.phase??'')||owned?.quiescent!==true) {
        const actual=await retainedJobState(identity.site,originalJob);
        if(actual.state!=='running') {
          // The fixed wrapper cleanup mode reconnects only original retained ownership facts.
          // Its stable recovery session is retained in the original prepared fact and dispatch
          // claim; a missing acknowledgement queries it rather than launching another cleaner.
          if(!beforeCleanup)return {closed:false,reason:'Original native cleanup needs its durable dispatch boundary'};
          const cleanupArgv=[...held.plan.capability.wrapper.argv,'--task-dir',held.plan.taskDir,'--reconcile'];
          const cleanupJob=prepareRetainedJob(identity.run.id,held.job.workspace,cleanupArgv,'engineering-reconcile',`${held.job.session}-cleanup`,held.job.startedAt);
          let recovered=await reconnectRetainedJob(identity.site,cleanupJob);
          if(recovered.pid===undefined) {
            try {recovered=await launchRetainedJob(identity.site,identity.run.id,cleanupArgv,cleanupJob,async()=>{
              if(!await beforeCleanup('engineering-reconcile',cleanupJob as unknown as JsonValue))throw new Error('Original cleanup dispatch is already retained; reconnect its original Job');
            });} catch {recovered=await reconnectRetainedJob(identity.site,cleanupJob);}
          }
          const deadline=Date.now()+Math.ceil((held.plan.capability.stopGraceSeconds+5)*1000);
          let recoveryState=await retainedJobState(identity.site,recovered);
          while(recoveryState.state==='running'&&Date.now()<deadline){await new Promise(resolve=>setTimeout(resolve,50));recoveryState=await retainedJobState(identity.site,recovered);}
          state=await readEngineeringState(identity.site,held.plan.taskDir,held.plan.taskId);
          owned=await readEngineeringOwned(identity.site,held.plan.taskDir,held.plan.taskId);
          if(recoveryState.state!=='finished'||recoveryState.exitCode!==0||owned?.quiescent!==true||state?.phase!=='stopped'||!await retainedJobResourcesClosed(identity.site,recovered))return {closed:false,reason:'Same-task cleanup has not confirmed the original native/wrapper resources quiescent'};
        } else {
        const delivery=completion.delivery;
        // A prior terminal refusal is immutable. A new signed native state permits a
        // fresh same-resource cleanup request; unchanged state always reuses its identity.
        const requestId=delivery?`auto-release-${jsonDigest([delivery.sha256,state?.sha256??null]).slice(0,32)}`:`auto-release-failed-${held.plan.envelope.sha256.slice(0,32)}`;
        const ack=await request(prepared,requestId,{operation:'release'},delivery?{deliverySha256:delivery.sha256}:{});
        state=await readEngineeringState(identity.site,held.plan.taskDir,held.plan.taskId);
        owned=await readEngineeringOwned(identity.site,held.plan.taskDir,held.plan.taskId);
        if(ack?.status!=='completed'||state?.phase!=='released'||owned?.quiescent!==true)return {closed:false,reason:ack?.error??'Original engineering native resources are not confirmed quiescent; verified delivery is retained'};
        }
      }
      if(!await retainedJobResourcesClosed(identity.site,originalJob))return {closed:false,reason:'Native closure is signed but the original wrapper process group remains open'};
      if(!state||!owned||owned.quiescent!==true)return {closed:false,reason:'Original signed native closure facts are missing'};
      return {closed:true,proof:{session:originalJob.session,nativeSession:completion.delivery?.sessionId??completion.nativeSession??state.sessionId??null,ownedSha256:owned.sha256,stateSha256:state.sha256,closed:true}};
    },
    async stop(prepared,receipt,beforeCleanup) {
      const held=decodeResident(prepared),identity=fresh();
      const input={taskId:held.plan.taskId,envelopeSha256:held.plan.envelope.sha256};
      const state=await readEngineeringState(identity.site,held.plan.taskDir,held.plan.taskId);
      if(!['released','stopped'].includes(state?.phase??'') && await beforeCleanup('cancel-native',input)) {
        await request(prepared,`auto-cancel-${held.plan.envelope.sha256.slice(0,32)}`,{operation:'cancel'});
      }
      // release reconnects fixed ownership and, when required, the one original cleanup Job.
      return adapter.release(prepared,receipt??({job:held.job} as unknown as JsonValue),beforeCleanup);
    },
    async message(prepared,id,input,beforeSubmit) {
      if(typeof input!=='string'||!input.trim())throw new Error('Resident native message must be nonempty text');
      await beforeSubmit();
      const ack=await request(prepared,id,{operation:'message',message:input});
      if(ack?.status!=='accepted'&&ack?.status!=='completed')throw new Error(ack?.error??'Native message acknowledgement is unknown');
      return ack as unknown as JsonValue;
    },
    async reconcileMessage(prepared,id,input) {
      const identity=fresh(),held=decodeResident(prepared);
      // Recompute the request digest without writing another request file or resending a prompt.
      const body={schema:'hima-resident-engineering/1',taskId:held.plan.taskId,requestId:id,operation:'message',payload:{text:input}};
      const digest=createHash('sha256').update(canonicalEngineeringJson(body)).digest('hex');
      const {readEngineeringReceipt}=await import('./engineering-executor.js');
      return await readEngineeringReceipt(identity.site,held.plan.taskDir,held.plan.taskId,id,digest) as unknown as JsonValue|undefined;
    },
  };
  return adapter;
}
