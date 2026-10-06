// @hima-seam agent wrapped
// Product/domain materialization for the one durable interpreter. No Ledger or successor selection.
import { createHash } from 'node:crypto';
import { mkdir, writeFile, readFile, access, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Context } from '@deepseek-ai/cordis';
import {TaskAdapterMaterializationError,type FlowAdapterContext} from './flow-workflow.js';
import { loadPackFrom, batchToolRefusal, outputPath, resolvePackReader, resolveRule, resolveChooser, semanticsOf, substitute, toolArgv, workshopArgv, forkJoinedAt, forkOutcome, autopilotForkOfNode, type Pack, type PackNode, type PackAgentTeam, type PackAgentTeamMember, type ContractOutput } from './packs.js';
import { snapshotPackFolder, packDigestExcludes, packFilePath, type PackFolderSnapshot, pipelineFiles } from './pack-folder.js';
import { channelFor, mustRun } from './channel.js';
import { loadSite, pathsOf, type Site } from './sites.js';
import { decideRead, decideWrite, decideLaunch } from './shell.js';
import { readerNamed, declarationOf } from './readers.js';
import { validateDomainReading, type Reading } from './observe.js';
import { judgeReading } from './judge.js';
import {retainedJobTail} from './jobs.js';
import { workshopOutputProblem } from './node-turns.js';
import { defaultRetryAllowance } from './budget.js';
import { choose, measuredRead } from './choosers.js';
import {strategyFrom,type StrategyValue} from './run-arguments.js';
import { workshopInstructions, workshopAsk } from './workshop.js';
import { workshopTaskAdapter, teamTaskAdapter, readNativeTaskTurn, type NativeTaskTurn, type NativeTeamMember } from './native-task-adapters.js';
import { reviewedScopeProblem, delegationChildSessionId, type DelegationContract, type TeamRecipeBinding } from './delegation.js';
import { taskInteractiveDelegationGrant, closeTaskInteractiveSessions, type TaskInteractiveDeps } from './task-interactive.js';
import type { InteractiveBindingBridge } from './interactive-binding.js';
import { executeTaskEffect, sendTaskEffectMessage, declaredCommandTaskAdapter, commandTaskAdapter, residentEngineeringTaskAdapter, taskEffectStep, taskEffectAdapterVersion, type TaskEffectRequest, type TaskEffectAdapter, type TaskCollectionPending, type TaskEffectOutcome, type EffectClosure } from './task-effects.js';
import { factIdentity, jsonDigest, type RunStore } from './run-store.js';
import { taskSchemaDraft, createTaskResult, type JsonValue, type TaskToolOutput, type TaskResult } from './task-contract.js';
import type { RunRecord, NodeExecution, ObservationRecord, VerdictRecord, JobIdentity } from './ledger.js';
/** Host fills this once from the accepted prepared workspace and method snapshot. Goal, strategy,
 * runInput and carry belong to the interpreter bindings, never a second product copy. */
export interface DurableProductOpening {
  readonly campaignId: string; readonly siteId: string; readonly siteDigest: string;
  readonly workspace: string; readonly bindings: Readonly<Record<string, string>>;
  readonly method: { readonly packId: string; readonly packDigest: string; readonly retainedPackDir: string };
  readonly parentSessionId: string; readonly guideSessionId?: string;
  readonly modelSelection: { readonly provider: string; readonly model: string };
}
export interface DurableTaskAdapterDeps {
  readonly ctx: Context; readonly sitesDir: string; readonly retainedMaterialsDir: string;
  readonly interactive?: Omit<TaskInteractiveDeps, 'store' | 'sitesDir' | 'resolveOperation'> & { readonly bridge: InteractiveBindingBridge };
}
const json = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue;
const sha = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
const object = (value: JsonValue): Record<string, JsonValue> => { if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('Business input must be one JSON object'); return value; };
const remap = (output: TaskToolOutput, request: TaskEffectRequest): TaskToolOutput => ({ ...output, schemaVersion: request.contract.output.version, artifacts: output.artifacts.map(artifact => ({ ...artifact, ...Object.fromEntries(['runId','taskId','effectId'].map(key => [key, request.identity[key as 'runId' | 'taskId' | 'effectId']])) })) });
const openSchema = { version: 'legacy-projection/1', schema: { $schema: taskSchemaDraft, type: 'object', additionalProperties: true } } as const;
interface Materialization { context: FlowAdapterContext; deps: DurableTaskAdapterDeps; product: DurableProductOpening; pack: Pack; site: Site; store: RunStore; node?: PackNode; run: RunRecord; execution: NodeExecution; platform: Readonly<Record<string,string>>; assets?:readonly import('./workspace.js').WorkspaceRevisionAsset[]; deadlineAt:string; assetBinding?:{readonly readyFact:string;readonly readyDigest:string} }
interface FrozenProductMethod {readonly dir:string;readonly packSha256:string;readonly files:readonly (readonly [string,string,number])[];readonly directories:readonly string[];readonly entries:readonly string[]}
// The interpreter retains this same immutable identity for the task loop; a WeakMap keeps
// pending/unprepared cancellation from retaining a Pack after that workflow returns.
const parsedMethods=new WeakMap<TaskEffectRequest['identity'],{readonly key:string;readonly pack:Pack}>();
function methodKey(context:FlowAdapterContext,product:DurableProductOpening):string{return jsonDigest([context.request.identity.effectId,product.method.retainedPackDir,context.flow.packSha256]);}
function folderFromFrozen(value:FrozenProductMethod):PackFolderSnapshot {
  const files=new Map(value.files.map(([name,encoded])=>[packFilePath.parse(name),Buffer.from(encoded,'base64')])),modes=new Map(value.files.map(([name,,mode])=>[name,mode]));
  const pairs=[...files].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([name,bytes])=>[name,sha(bytes)] as const);
  return {dir:value.dir,files,modes,directories:new Set(value.directories),entries:new Set(value.entries),text:name=>files.get(name)?.toString('utf8'),has:name=>files.has(name),digest:(except=[])=>sha(pairs.filter(([name])=>!except.includes(name)).map(([name,digest])=>`${name} ${digest}\n`).join('')),sealFiles:()=>pairs.filter(([name])=>name!==pipelineFiles.version)};
}
async function originalMethod(context:FlowAdapterContext,product:DurableProductOpening):Promise<Pack> {
  const meta=await context.runtime.store.ensureFlowFact(context.request.identity.runId,`product-method:${context.flow.packSha256}`,async()=>{
    const folder=snapshotPackFolder(product.method.retainedPackDir);
    if(folder.digest(packDigestExcludes)!==context.flow.packSha256||product.method.packDigest!==context.flow.packSha256)throw new Error('Original retained method bytes differ from this Run Pack identity');
    return json({dir:folder.dir,packSha256:context.flow.packSha256,files:[...folder.files].map(([name,bytes])=>[name,Buffer.from(bytes).toString('base64'),folder.modes.get(name)??0o644]),directories:[...folder.directories],entries:[...folder.entries]});
  });
  if(meta.state==='unavailable')throw new TaskAdapterMaterializationError({code:'adapter-materialization',message:meta.reason,source:'domain-adapter'});
  const key=methodKey(context,product),cached=parsedMethods.get(context.request.identity);if(cached?.key===key)return cached.pack;
  const fact=await context.runtime.store.fact(meta.factId);if(!fact)throw new Error('Original frozen method fact is unavailable');const value=object(fact.payload).value;
  if(jsonDigest(value!)!==meta.digest)throw new Error('Original frozen method fact differs from its retained digest');
  const frozen=value as unknown as FrozenProductMethod;if(frozen.dir!==product.method.retainedPackDir||frozen.packSha256!==context.flow.packSha256)throw new Error('Original frozen method has another source identity');
  const folder=folderFromFrozen(frozen);if(folder.digest(packDigestExcludes)!==context.flow.packSha256)throw new Error('Original frozen method bytes differ from this Run Pack identity');
  const pack=loadPackFrom(folder);parsedMethods.set(context.request.identity,{key,pack});return pack;
}
function forgetMethod(m:Materialization):void{parsedMethods.delete(m.context.request.identity);}
function assertMethodCurrent(m:Materialization):void{if(snapshotPackFolder(m.product.method.retainedPackDir).digest(packDigestExcludes)!==m.context.flow.packSha256)throw new Error('Original retained method bytes differ from this Run Pack identity');}
function methodFence(m:Materialization,base:TaskEffectAdapter):TaskEffectAdapter {
  return {...base,async permit(prepared,operation){if(operation!=='release'){assertMethodCurrent(m);if(jsonDigest(json(loadSite(m.deps.sitesDir,m.product.siteId)))!==m.product.siteDigest)throw new Error('Original Site identity changed; restore its frozen binding before this task can run');}return base.permit(prepared,operation);},async collect(prepared,receipt,request){const result=await base.collect(prepared,receipt,request);if(!('pending' in result)){createTaskResult(request.identity,request.contract,result,request.localSchemas);forgetMethod(m);}return result;},async release(prepared,receipt,before){const closed=await base.release(prepared,receipt,before);if(closed.closed)forgetMethod(m);return closed;},...(base.stop?{async stop(prepared:JsonValue,receipt:JsonValue|undefined,before:(id:string,input:JsonValue)=>Promise<boolean>){const closed=await base.stop!(prepared,receipt,before);if(closed.closed)forgetMethod(m);return closed;}}:{})};
}
/** Exact planning values only; neither object is stored/folded as a mutable legacy Run. */
async function materialization(context: FlowAdapterContext, deps: DurableTaskAdapterDeps): Promise<Materialization> {
  const current = await context.runtime.store.run(context.request.identity.runId);
  const data = object(current.opening.data), product = data.product as unknown as DurableProductOpening;
  if (!product?.method?.retainedPackDir || !product.siteId || !product.siteDigest || !product.workspace || !product.parentSessionId || !product.campaignId || !product.modelSelection?.provider || !product.modelSelection.model) throw new Error('Durable Run opening has no complete frozen product preparation');
  const originalPack=await originalMethod(context,product),compatibility=context.flow.compatibility;
  const frozenGraph=compatibility&&typeof compatibility==='object'&&!Array.isArray(compatibility)?compatibility.graph:undefined;
  const pack=frozenGraph?{...originalPack,graph:frozenGraph as unknown as Pack['graph']}:originalPack;
  const ready=await taskEffectStep('hima.domain.materialization-availability',async()=>{
    try {
      const site=loadSite(deps.sitesDir,product.siteId);
      if(pack.id!==product.method.packId||pack.id!==context.flow.packId)throw new Error('Original retained method has another Pack identity');
      if(jsonDigest(json(site))!==product.siteDigest)throw new Error('Original Site identity changed; restore its frozen binding before this task can run');
      if(!(await context.runtime.store.effect(context.request.identity.effectId))||!await context.runtime.store.effectDispatchExists(context.request.identity,'submit')){if(!(await stat(product.method.retainedPackDir)).isDirectory())throw new Error('Original retained method directory is unavailable');await access(product.method.retainedPackDir);}
      return {state:'available' as const,site:json(site)};
    }catch(error){return {state:'unavailable' as const,reason:error instanceof Error?error.message:String(error)};}
  });
  if(ready.state==='unavailable')throw new TaskAdapterMaterializationError({code:'adapter-materialization',message:ready.reason,source:'domain-adapter'});
  const site=ready.site as unknown as Site;
  const iteration = context.invocation.iterations.at(-1), generation = iteration ? iteration.iteration + 1 : 1;
  const node = context.task.legacy as unknown as PackNode | undefined;
  const executionId = `execution-${sha(context.request.identity.effectId).slice(0,32)}`;
  const supplied=object(context.request.input).__strategy;
  let strategy=context.bindings.carry.strategy??context.bindings.strategy;
  if(supplied!==undefined){const values=object(supplied);if(Object.keys(values).length!==Object.keys(pack.contract.strategy).length||Object.keys(pack.contract.strategy).some(name=>!Object.hasOwn(values,name))||Object.values(values).some(value=>typeof value!=='string'&&typeof value!=='number'))throw new Error('Revised Strategy must provide exactly every declared knob without defaults');const checked=strategyFrom(pack.contract.strategy,values as Record<string,StrategyValue>);if('error' in checked)throw new Error(checked.error);strategy=json(checked.strategy);}
  const run = { id: current.runId, siteId: site.name, packId: pack.id, packDigest: context.flow.packSha256, campaignId: product.campaignId,
    status: current.cancelled ? 'cancelled' : 'running', generation, goal: context.bindings.goal, strategy,
    budget: data.budget, control: { owner: current.owner, epoch: current.epoch, revision: current.revision },
    ...(iteration ? { loop: { id: iteration.repeatId, generation } } : {}) } as unknown as RunRecord;
  const execution = { id: executionId, nodeId: context.task.id,kind:node?.kind??'act',methodDigest:context.flow.packSha256, phase: 'begun', attempt: context.invocation.revision + 1, generation,
    ...(context.invocation.branches.length ? { branchId: context.invocation.branches.at(-1)!.branch } : {}) } as unknown as NodeExecution;
  const input = object(context.request.input), values = Object.fromEntries(Object.entries(input).filter(([,value]) => ['string','number','boolean'].includes(typeof value)).map(([key,value]) => [key,String(value)]));
  return { deadlineAt:current.deadlineAt,context, deps, product, pack, site, store: context.runtime.store, node, run, execution,
    platform: { ...product.bindings, ...values, ...(product.bindings.flowRoot?{FLOW_ROOT:product.bindings.flowRoot}:{}), ...(product.bindings.design?{DESIGN:product.bindings.design}:{}), WORKSPACE: product.workspace, FLOW: pathsOf(site).join(product.workspace,'flow'), GENERATION: String(generation), RUN: current.runId, CAMPAIGN: product.campaignId } };
}
export async function resolveDurableTaskAdapter(context: FlowAdapterContext, deps: DurableTaskAdapterDeps): Promise<TaskEffectAdapter|TaskCollectionPending> {
  const original=await materialization(context,deps),plan=await approvedRevisionAssets(original);
  if('pending' in plan)return plan;
  const m={...original,assets:plan.assets,assetBinding:plan.binding},adapter=await taskAdapter(m);
  return methodFence(m,collectorTreeStop(m,await workspaceRevisionStage(m,adapter)));
}
async function taskAdapter(m:Materialization):Promise<TaskEffectAdapter> {
  const {context,deps}=m;
  if (context.task.tool === 'builtin/observe') return readerAdapter(m, requiredOutput(m, (m.node as Extract<PackNode,{kind:'act'}>).parameters.observes!));
  if (context.task.tool === 'builtin/judge') return domainAdapter(m, async request => judgeOutput(m,request));
  if (context.task.tool === 'builtin/legacy-growth-resume') return domainAdapter(m,async request=>growthResumeOutput(m,request));
  if (context.task.tool === 'builtin/explore') return domainAdapter(m,async request=>{
    const decision=await exploreOutput(m,request),extension=object(request.input).extension;
    if(extension===undefined)return decision;
    const declared=m.node?.kind==='explore'&&m.node.parameters.growth===true&&context.flow.extensions.some(slot=>slot.afterTask===context.task.id);
    if(!declared)throw new Error('This frozen Explore task declares no diagnostic extension position');
    // The existing product grow action freezes this explicit business input through occurrence
    // revision. The interpreter alone revalidates the fragment and runs its declared composition.
    return {...decision,value:json({...object(decision.value),extension})};
  });
  if (context.task.tool === 'builtin/workshop') return workshopAdapter(m);
  if (context.task.tool === 'builtin/legacy-growth-result') return domainAdapter(m,async request=>growthDiagnosticOutput(m,request));
  const tool = m.pack.contract.tools.find(tool => tool.id === context.task.tool);
  if (!tool) throw new Error(`Frozen Pack does not declare task producer ${context.task.tool}`);
  const team = m.pack.contract.agentTeams.find(team => team.triggerNode === context.task.id);
  if (team && !(await Promise.all(team.batchWhen.map(async condition => { const reading = await observationForOutput(m,condition.input); const value = reading?.values.find(value => value.type === condition.value)?.value; return typeof value === 'number' && (condition.equals === undefined ? value > condition.above! : value === condition.equals); }))).some(Boolean)) {const ready=await taskEffectStep('hima.team.parent-materialization',async()=>!!m.deps.ctx.get('agents')?.get(m.product.parentSessionId as never)||!!(await m.store.effect(context.request.identity.effectId))&&await m.store.effectDispatchExists(context.request.identity,'submit'));if(!ready)throw new TaskAdapterMaterializationError({code:'native-parent-unavailable',message:'The original Team parent session is not yet restored; no native child was claimed',source:'native-domain'});return aggregateTeamAdapter(m,team);}
  if (tool.outsourcing) {
    const identity = { run: m.run, execution: m.execution, site: m.site, pack: m.pack, workspace: m.product.workspace, bindings: m.product.bindings,
      outsourcing: tool.outsourcing, licences: tool.licences, tool, boundInputs: Object.fromEntries(tool.inputs.map(key => {const value=m.platform[key];if(value===undefined)throw new Error(`Resident task lacks declared input ${key}`);return [key,value];})), siteIdentityMatches: true };
    const requestInput = object(context.request.input);
    let resident:TaskEffectAdapter;resident=residentEngineeringTaskAdapter({ sitesDir:deps.sitesDir,siteId:m.site.name,identity,
      start:{operation:'start',goal:typeof requestInput.goal==='string'?requestInput.goal:tool.description || m.node?.id || context.task.id, context:JSON.stringify({input:context.request.input,goal:m.run.goal,strategy:m.run.strategy})},
      collect:async(_identity,delivery,_materialized,request)=>{
        const source=json({taskId:delivery.taskId,deliverySha256:delivery.sha256,candidate:delivery.candidate});
        const observed=await collectReader(m,requiredOutput(m,tool.outsourcing!.produces),request,source);
        if('pending' in observed)return observed.reason.code==='reader-rejected'?residentFeedback(delivery.sha256,observed.reason.message):observed;
        return {...observed,value:json({...object(observed.value),engineering:{outcome:delivery.outcome,summary:delivery.summary,stopReason:delivery.stopReason}})};
      } });
    return resident;
    async function residentFeedback(deliveryDigest:string,reason:string):Promise<TaskCollectionPending> {
      const id=`auto-delivery-${jsonDigest([context.request.identity.effectId,deliveryDigest]).slice(0,40)}`;
      const prior=await taskEffectStep('hima.resident.repair-delivery-plan',async()=>await m.store.externalEffectFact(context.request.identity,`delivery-repair:${deliveryDigest}`)??null);
      const text=prior?String(object(prior).text):`The Reader rejected this exact signed delivery (${deliveryDigest}): ${reason}. Correct the rejected delivery/document only in this same engineering task. Preserve the retained baseline, common context, completed engineering work and native session; do not restart or rerun completed ECO. Do not claim a goal or success without actual evidence. Return a corrected signed delivery and explain any honest remaining failure.`.slice(0,7900);
      if(!prior)await m.store.recordExternalEffectFact(context.request.identity,`delivery-repair:${deliveryDigest}`,json({id,text,deliveryDigest,reason}));
      const reply=await sendTaskEffectMessage(m.store,context.request,resident,id,text);
      return {pending:true,state:'waiting',reason:{code:'delivery-repair',message:reply.state==='waiting'?reply.reason.message:'The same native engineering task is correcting its rejected signed delivery; no new engineering launch was made',source:'resident-domain'}};
    }
  }
  const batchRefusal=batchToolRefusal(tool);if(batchRefusal)throw new Error(batchRefusal);
  if (tool.inputs.includes('TASK_OUTPUT')) return declaredCommandTaskAdapter({ request: context.request, tool, sitesDir:deps.sitesDir,siteId:m.site.name,workspace:m.product.workspace,platform:m.platform });
  return commandTaskAdapter({sitesDir:deps.sitesDir,siteId:m.site.name,workspace:m.product.workspace,name:tool.id,argv:toolArgv(tool,m.platform),licences:tool.licences,
    collect:async(_site,job,request)=>output(request,{tool:tool.id,completed:true,job})});
}
const output = (request: TaskEffectRequest,value: unknown): TaskToolOutput => ({schemaVersion:request.contract.output.version,value:json(value),artifacts:[],diagnostics:[]});
function requiredOutput(m: Materialization,name: string): ContractOutput {const result=m.pack.contract.outputs.find(output=>output.name===name);if(!result)throw new Error(`Frozen Pack has no declared output ${name}`);return result;}
/** Source reads and deterministic domain tasks still pass the same admission boundary. */
function domainAdapter(m:Materialization,collect:(request:TaskEffectRequest)=>Promise<TaskToolOutput|TaskCollectionPending>):TaskEffectAdapter {
  const identity=json({taskId:m.context.task.id,method:m.context.flow.packSha256,input:m.context.request.input});
  return {kind:'program',version:taskEffectAdapterVersion,resources:{siteId:m.site.name,jobs:0,licences:{}},capacity:{jobs:m.site.capacity.parallelJobs,licences:m.site.capacity.licences},
    prepare:async()=>identity,permit:async()=>true,submit:async(prepared,before)=>{await before();return prepared;},reconcile:async prepared=>({state:'ready',receipt:prepared}),collect:async(_prepared,_receipt,request)=>collect(request),release:async()=>({closed:true,proof:{domain:true}}),stop:async()=>({closed:true,proof:{domain:true}})};
}
function childRequest(parent:TaskEffectRequest,suffix:string,input:JsonValue=parent.input):TaskEffectRequest {
  const effectId=`${parent.identity.effectId}:${suffix}`;
  return {...parent,input,contract:{input:openSchema,output:openSchema},identity:{...parent.identity,effectId,taskId:`${parent.identity.taskId}:${suffix}`,inputSha256:jsonDigest(input)},admission:{...parent.admission,effectId}};
}
function pendingCollection(outcome:Exclude<TaskEffectOutcome,{state:'succeeded'}>):TaskCollectionPending {
  if(outcome.state==='failed')throw new Error(outcome.reason.message);
  return {pending:true,state:outcome.state,reason:outcome.reason};
}
const sourceFactId=(effectId:string)=>factIdentity('task-result',effectId);
async function retainBytes(m:Materialization,bytes:Uint8Array):Promise<string> {
  const directory=path.join(m.deps.retainedMaterialsDir,m.context.request.identity.runId),at=path.join(directory,sha(bytes));
  await mkdir(directory,{recursive:true});
  try {await writeFile(at,bytes,{flag:'wx',mode:0o600});} catch(error) {if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;if(sha(await readFile(at))!==sha(bytes))throw new Error('Original retained source bytes changed');}
  return at;
}
function observationOutput(m:Materialization,request:TaskEffectRequest,reading:Reading,retainedPath:string,outputName:string,artifactPath?:string):TaskToolOutput {
  const checked=validateDomainReading(reading,semanticsOf(m.pack,'the reading'));if(!checked.ok)throw new Error(checked.reason);
  const observation={id:sourceFactId(request.identity.effectId),runId:request.identity.runId,siteId:m.site.name,type:'observation',writer:'executor',generation:m.execution.generation,...(m.run.loop?{loopId:m.run.loop.id}:{}),
    ...reading,retainedPath,values:checked.values,outputName};
  return {schemaVersion:request.contract.output.version,value:json({observations:[observation]}),artifacts:artifactPath?[{runId:request.identity.runId,taskId:request.identity.taskId,effectId:request.identity.effectId,name:'domain-report',path:artifactPath,sha256:reading.contentSha256}]:[],diagnostics:[]};
}
async function collectReader(m:Materialization,declared:ContractOutput,request:TaskEffectRequest,source?:JsonValue):Promise<TaskToolOutput|TaskCollectionPending> {
  const child=childRequest(request,`reader-${declared.name}${source?':'+jsonDigest(source).slice(0,24):''}`,json({output:declared.name,...(source?{source}:{})}));
  await m.store.bindDerivedEffect(request.identity,child.identity,{purpose:'collect'});
  const result=await executeTaskEffect(m.store,child,methodFence(m,await readerAdapter(m,declared,child)));
  if(result.state==='failed')return {pending:true,state:'waiting',reason:{code:'reader-rejected',message:result.reason.message,source:'domain-reader'}};
  if(result.state!=='succeeded')return pendingCollection(result);
  return remap({schemaVersion:request.contract.output.version,value:result.result.value,artifacts:result.result.artifacts,diagnostics:result.result.diagnostics},request);
}
async function readerAdapter(m:Materialization,declared:ContractOutput,request=m.context.request):Promise<TaskEffectAdapter> {
  const report=pathsOf(m.site).join(m.product.workspace,outputPath(declared,m.product.bindings)),name=declared.reader??'raw';
  const own=resolvePackReader(m.pack,name,'the reading');if(own.kind==='broken')throw new Error(own.reason);
  const branch=m.context.invocation.branches.at(-1)?.branch;
  if(own.kind==='absent') {
    const reader=readerNamed(name);if(!reader)throw new Error(`Unknown frozen domain Reader ${name}`);
    return domainAdapter(m,async req=>taskEffectStep('hima.domain.bundled-reader',async()=>{
      const fresh=loadSite(m.deps.sitesDir,m.site.name),on=channelFor(fresh),decision=await decideRead(fresh,report,on);if(!decision.ok)throw new Error(decision.reason);
      const bytes=await on.readFile(decision.absPath);if(!reader.accepts(bytes))throw new Error(`reader "${name}" does not accept ${report}: not a recognised report for this reader`);
      const retained=await retainBytes(m,bytes);
      return observationOutput(m,req,{path:decision.absPath,contentSha256:sha(bytes),bytes:bytes.byteLength,reader:declarationOf(reader),values:reader.read(bytes).values,...(branch?{branchId:branch}:{})},retained,declared.name);
    }));
  }
  const declaration=own.declaration,script=m.pack.folder.files.get(declaration.file);if(!script)throw new Error(`Frozen Reader script ${declaration.file} is unavailable`);
  const p=pathsOf(m.site),directory=p.join(m.product.workspace,'hima-readers',sha(request.identity.effectId).slice(0,32)),ship=p.join(directory,p.basename(declaration.file)),out=p.join(directory,'values.json'),source=p.join(directory,'report.json'),retainedReport=p.join(directory,'input-report');
  // ${REPORT} is the output the contract pointed at, where it lies, so a Reader may read the evidence
  // beside it (pack-anatomy). The retained copy stays the identity record; collection refuses a report
  // whose bytes changed while the Reader ran.
  const argv=declaration.argv.map(word=>substitute(word,{READER:ship,REPORT:report,OUT:out,WORKSPACE:m.product.workspace},`reader ${name}`));
  return commandTaskAdapter({sitesDir:m.deps.sitesDir,siteId:m.site.name,workspace:m.product.workspace,name:`reader-${name}`,argv,licences:{},
    async stage(site) {
      const on=channelFor(site),read=await decideRead(site,report,on);if(!read.ok)throw new Error(read.reason);
      const bytes=await on.readFile(read.absPath),directoryDecision=await decideWrite(site,directory,on);if(!directoryDecision.ok)throw new Error(directoryDecision.reason);
      await mustRun(on,['mkdir','-p','--',directoryDecision.absPath],'prepare original Reader files');
      for(const [at,content] of [[ship,script],[retainedReport,bytes],[source,Buffer.from(JSON.stringify({path:read.absPath,contentSha256:sha(bytes),bytes:bytes.byteLength,retainedPath:await retainBytes(m,bytes)}))]] as const) {
        const write=await decideWrite(site,at,on);if(!write.ok)throw new Error(write.reason);await mustRun(on,['tee','--',write.absPath],'stage original Reader source',{stdin:Buffer.from(content)});
      }
    },
    collect:async(site,_job,req)=>taskEffectStep('hima.domain.pack-reader',async()=>{
      const on=channelFor(site),read=await decideRead(site,out,on);if(!read.ok)throw new Error(read.reason);const bytes=await on.readFile(read.absPath);
      const parsed=JSON.parse(Buffer.from(bytes).toString('utf8'));if(!parsed||!Array.isArray(parsed.values))throw new Error(`Reader ${name} must produce one JSON object containing values`);
      const seen=JSON.parse(Buffer.from(await on.readFile(source)).toString('utf8')) as {path:string;contentSha256:string;bytes:number;retainedPath:string};
      if(sha(await readFile(seen.retainedPath))!==seen.contentSha256)throw new Error('Original Reader report source changed');
      const now=await decideRead(site,report,on);if(!now.ok||now.absPath!==seen.path||sha(await on.readFile(now.absPath))!==seen.contentSha256)throw new Error(`Reader ${name} report ${report} changed while it was read`);
      return observationOutput(m,req,{...seen,reader:{id:declaration.id,version:declaration.version,reportKind:declaration.reportKind,emits:declaration.emits,file:declaration.file,sha256:sha(script)},values:parsed.values,...(branch?{branchId:branch}:{})},seen.retainedPath,declared.name,p.relative(m.product.workspace,retainedReport));
    })});
}
function observations(m:Materialization):ObservationRecord[] {
  return Object.values(m.context.committed).flatMap(result=>{const value=object(result.value);return Array.isArray(value.observations)?value.observations as unknown as ObservationRecord[]:[];});
}
async function observationForOutput(m:Materialization,name:string):Promise<ObservationRecord|undefined> {
  const scoped=observations(m).filter(row=>(row as ObservationRecord&{outputName?:string}).outputName===name&&(row.generation??1)===m.execution.generation&&row.loopId===m.run.loop?.id&&(m.execution.branchId===undefined||row.branchId===undefined||row.branchId===m.execution.branchId));
  const unique=new Map<string,ObservationRecord>();
  for(const row of scoped){const prior=unique.get(row.id);if(prior&&jsonDigest(prior)!==jsonDigest(row))throw new Error(`Reader source ${row.id} was forwarded with conflicting observations`);unique.set(row.id,row);}
  const timed=await Promise.all([...unique.values()].map(async row=>{const fact=await m.store.fact(row.id);if(!fact||fact.kind!=='task-result'||fact.runId!==m.run.id)throw new Error(`Declared input ${name} has no committed Reader source fact`);const actual=object((fact.payload as unknown as TaskResult).value).observations;if(!Array.isArray(actual)||!actual.some(value=>jsonDigest(value)===jsonDigest(row)))throw new Error(`Declared input ${name} differs from its committed Reader source`);return {row,seq:fact.seq};}));
  // Explicit observe commits after its producer's collection. Its source therefore wins while
  // repeated forwarding of that same immutable Reader fact remains one input, not ambiguity.
  return timed.sort((a,b)=>a.seq-b.seq).at(-1)?.row;
}
async function sourcedRows(m:Materialization):Promise<ObservationRecord[]> {
  const rows=observations(m);
  const mapped=await Promise.all(rows.map(async row=>{const fact=await m.store.fact(row.id);return {...row,...(fact?{seq:fact.seq,at:fact.at}:{})};}));
  return mapped.sort((a,b)=>a.seq-b.seq);
}
async function judgeOutput(m:Materialization,request:TaskEffectRequest):Promise<TaskToolOutput> {
  const node=m.node;if(!node||node.kind!=='judge')throw new Error('Judge adapter needs its complete frozen declaration');
  const params=Object.fromEntries(Object.entries(object(request.input)).filter((pair):pair is [string,number]=>typeof pair[1]==='number'));
  const rows=await sourcedRows(m),part=[m.pack.graph,...Object.values(m.pack.graph.loops)].find(graph=>graph.nodes.some(candidate=>candidate.id===node.id))!;
  const joined=forkJoinedAt(part,node.id),branches=joined?joined.branches.map(branch=>branch.id):[m.context.invocation.branches.at(-1)?.branch];
  const verdicts:VerdictRecord[]=[],firsts:('PASS'|'FAIL'|'UNDETERMINED')[]=[];
  for(const branch of branches) {
    const branchRows=joined?rows.filter(row=>row.branchId===branch).slice(-1):rows.filter(row=>branch===undefined||row.branchId===branch);
    const evaluated=node.parameters.rules.map((ref,index)=>{const value=judgeReading(request.identity.runId,resolveRule(m.pack,ref,'the reading').rule,branchRows,params,branch);return {...value,id:`${sourceFactId(request.identity.effectId)}:${branch??'run'}:${index}`,runId:request.identity.runId,siteId:m.site.name,type:'verdict',writer:'judge',generation:m.execution.generation,...(m.run.loop?{loopId:m.run.loop.id}:{})} as VerdictRecord;});
    verdicts.push(...evaluated);firsts.push(evaluated[0]!.outcome);
  }
  return output(request,{outcome:joined?forkOutcome(firsts):firsts[0],verdicts});
}
async function exploreOutput(m:Materialization,request:TaskEffectRequest,diagnosticRows?:readonly ObservationRecord[]):Promise<TaskToolOutput> {
  const node=m.node;if(!node||node.kind!=='explore')throw new Error('Explore adapter needs its complete frozen declaration');
  if(node.parameters.opens) {
    const loop=m.pack.graph.loops[node.parameters.opens];
    if(!loop)throw new Error('Opened loop is absent from frozen method');
    const result=Object.values(m.context.committed).findLast(result=>{const legacy=m.context.flow.tasks[result.identity.taskId]?.legacy as unknown as PackNode|undefined;return legacy?.kind==='explore'&&loop.nodes.some(item=>item.id===legacy.id)&&object(result.value).route==='stop';});
    const decision=result?object(result.value):undefined;
    if(!decision||!['goal-met','converged','generation-limit'].includes(String(decision.outcome)))throw new Error('Opened Loop has no committed explicit ending outcome');
    return output(request,{outcome:decision.outcome,goalMet:decision.goalMet===true,cites:[sourceFactId(result!.identity.effectId)]});
  }
  const part=[m.pack.graph,...Object.values(m.pack.graph.loops)].find(graph=>graph.nodes.some(candidate=>candidate.id===node.id));
  const ancestors=new Set<string>();const visit=(id:string):void=>{for(const edge of part?.edges??[])if(!edge.revisit&&edge.to===id&&!ancestors.has(edge.from)){ancestors.add(edge.from);visit(edge.from);}};visit(node.id);
  const candidates=Object.entries(m.context.committed).filter(([taskId,result])=>{const legacy=m.context.flow.tasks[taskId]?.legacy as unknown as PackNode|undefined;return ancestors.has(taskId)&&legacy?.kind==='judge'&&Array.isArray(object(result.value).verdicts);});
  const timed=await Promise.all(candidates.map(async candidate=>({candidate,seq:(await m.store.fact(sourceFactId(candidate[1].identity.effectId)))?.seq??0})));
  const chosenJudge=timed.sort((a,b)=>a.seq-b.seq).at(-1)?.candidate;
  if(!chosenJudge)throw new Error('Explore has no current committed Judge output');
  const judgeNode=m.context.flow.tasks[chosenJudge[0]]!.legacy as unknown as Extract<PackNode,{kind:'judge'}>;
  let verdicts=object(chosenJudge[1].value).verdicts as unknown as VerdictRecord[];
  const currentRows=(await sourcedRows(m)).filter(row=>row.generation===m.execution.generation&&row.loopId===m.run.loop?.id);
  const replaced=new Set(diagnosticRows?.map(row=>(row as ObservationRecord&{outputName?:string}).outputName)??[]);
  const allRows=[...currentRows.filter(row=>!replaced.has((row as ObservationRecord&{outputName?:string}).outputName)),...diagnosticRows??[]];
  if(diagnosticRows) {
    const params=Object.fromEntries(Object.entries(judgeNode.parameters.bind).flatMap(([name,reference])=>{const values=reference.from==='goal'?m.run.goal:m.run.strategy;const value=values?.[reference.name];return typeof value==='number'?[[name,value]]:[];}));
    const graph=[m.pack.graph,...Object.values(m.pack.graph.loops)].find(graph=>graph.nodes.some(candidate=>candidate.id===judgeNode.id))!;
    const joined=forkJoinedAt(graph,judgeNode.id),branches=joined?joined.branches.map(branch=>branch.id):[m.context.invocation.branches.at(-1)?.branch];
    verdicts=branches.flatMap(branch=>judgeNode.parameters.rules.map((ref,index)=>({...judgeReading(m.run.id,resolveRule(m.pack,ref,'the reading').rule,joined?allRows.filter(row=>row.branchId===branch).slice(-1):allRows,params,branch),id:`${sourceFactId(request.identity.effectId)}:diagnostic:${branch??'run'}:${index}`,runId:m.run.id,siteId:m.site.name,type:'verdict',writer:'judge',generation:m.execution.generation,...(m.run.loop?{loopId:m.run.loop.id}:{})} as VerdictRecord)));
  }
  const match=(verdict:VerdictRecord,ref:string)=>ref===verdict.ruleId||ref===`${verdict.ruleId}@${verdict.ruleVersion}`;
  const constraint=verdicts.findLast(row=>match(row,judgeNode.parameters.rules[0]!)),goal=verdicts.findLast(row=>match(row,judgeNode.parameters.rules[1]!));
  if(!constraint||!goal)throw new Error('Explore needs current constraint and Goal verdicts');
  const rows=allRows,observation=rows.findLast(row=>constraint.cites.includes(row.id)&&goal.cites.includes(row.id));
  if(!observation)throw new Error('Explore verdicts have no common current Reader source');
  if(verdicts.some(verdict=>verdict.cites.some(id=>!rows.some(row=>row.id===id&&row.branchId===verdict.branchId))))throw new Error('Explore verdict cites another branch or an unavailable Reader source');
  const {chooser,origin}=resolveChooser(m.pack,node.parameters.chooser!,'the reading');
  const earlierByGeneration=new Map<number,number>();
  if(node.parameters.converge) {
    const historical=await m.store.flowProjection(m.run.id);
    const results=historical.tasks.flatMap(task=>{const result=object(task).result;return result?[result as unknown as TaskResult]:[];});
    const seen=results.flatMap(result=>{const values=object(result.value).observations;return Array.isArray(values)?values as unknown as ObservationRecord[]:[];});
    const timed=await Promise.all(seen.map(async row=>({row,seq:(await m.store.fact(row.id))?.seq??0})));
    for(const {row} of timed.sort((a,b)=>a.seq-b.seq))if(row.loopId===m.run.loop?.id&&row.branchId===observation.branchId&&(row.generation??1)<(observation.generation??1)) {const value=measuredRead(chooser,node.parameters.converge.read,row);if(value!==undefined)earlierByGeneration.set(row.generation??1,value);}
  }
  const earlier=[...earlierByGeneration.entries()].sort((a,b)=>a[0]-b[0]).map(([,value])=>value);
  const selected=choose(chooser,{bound:node.parameters.bind,knobs:m.pack.contract.strategy,strategy:m.run.strategy??{},constraint,goal,observation,verdicts,...(node.parameters.converge?{converge:node.parameters.converge,earlier}:{})});
  if(!selected.ok)throw new Error(selected.reason);
  const generationLimit=(m.run.budget as {generationLimit?:number}|undefined)?.generationLimit;
  const decision=selected.chosen;
  const stopped='goalMet' in decision || 'converged' in decision || 'stopped' in decision;
  const limit=!stopped&&generationLimit!==undefined&&(m.execution.generation??1)>=generationLimit;
  const ending='goalMet' in decision?'goal-met':'converged' in decision?'converged':'stopped' in decision?'stopped':limit?'generation-limit':undefined;
  return output(request,{route:stopped||limit?'stop':'repeat',strategy:'strategy' in decision?decision.strategy:m.run.strategy??{},goalMet:'goalMet' in decision,
    ...(ending?{outcome:ending}:{}),chosen:decision,chooser:chooser.id,chooserOrigin:origin,rationale:selected.rationale,...(diagnosticRows?{verdicts}:{}),cites:[sourceFactId(chosenJudge[1].identity.effectId),...new Set(verdicts.flatMap(row=>row.cites))]});
}
/** Original collector children are explicit owned effects, never inferred from names. */
function collectorTreeStop(m:Materialization,base:TaskEffectAdapter):TaskEffectAdapter {
  if(!base.stop)return base;
  return {...base,async stop(prepared,receipt,beforeCleanup) {
    const unknown:string[]=[];
    for(const child of await m.store.derivedEffects(m.context.request.identity)) {
      if(child.purpose!=='collect'||!child.intent)continue;
      try {
        const intent=object(child.intent),input=object(intent.input!),name=input.output;
        if(typeof name!=='string'){unknown.push('Original collector has no retained declared output identity');continue;}
        const childRequest:TaskEffectRequest={identity:child.identity,admission:{...m.context.request.admission,effectId:child.identity.effectId},input,
          contract:{input:openSchema,output:openSchema},localSchemas:{}};
        const original=await m.store.effectFact(child.identity.effectId,'prepared');
        if(original===undefined) {
          if(await m.store.effectDispatchExists(child.identity,'submit')){unknown.push('Original Reader dispatch has no recoverable preparation');continue;}
          await m.store.releaseExternalEffectResources(child.identity,{unstarted:true});continue;
        }
        const reader=await readerAdapter(m,requiredOutput(m,name),childRequest);
        if(!reader.stop){unknown.push('Original domain Reader has no physical stop proof');continue;}
        const closed=await reader.stop(original,await m.store.effectFact(child.identity.effectId,'submitted'),(id,value)=>beforeCleanup(`reader:${child.identity.effectId}:${id}`,value));
        if(!closed.closed){unknown.push(closed.reason);continue;}
        await m.store.releaseExternalEffectResources(child.identity,closed.proof);
      } catch(error){unknown.push(error instanceof Error?error.message:String(error));}
    }
    let own:EffectClosure;
    try{own=await base.stop!(prepared,receipt,beforeCleanup);}catch(error){own={closed:false,reason:error instanceof Error?error.message:String(error)};}
    if(!own.closed)unknown.push(own.reason);
    return unknown.length?{closed:false,reason:unknown.join('; ')}:own;
  }};
}
async function approvedRevisionAssets(m:Materialization):Promise<{assets:readonly import('./workspace.js').WorkspaceRevisionAsset[];binding?:{readyFact:string;readyDigest:string}}|TaskCollectionPending> {
  if(!m.context.invocation.revision)return {assets:[]};
  const revision=await m.store.flowFact(m.run.id,`revision:${m.context.invocation.revision}`);
  const rule=revision?object(revision):undefined,evidence=rule?.evidence;
  if(!evidence||typeof evidence!=='object'||Array.isArray(evidence)||!Array.isArray(evidence.assets)||!evidence.assets.length)return {assets:[]};
  if(evidence.kind!=='legacy-revision'||typeof evidence.commandId!=='string'||typeof evidence.assetReadyFact!=='string'||evidence.assetReadyFact!==`prepared-revision:${evidence.commandId}`)throw new Error('Code assets require their original Host-prepared revision authority');
  const memoValue=await m.store.flowFact(m.run.id,`facade-command:${evidence.commandId}`),memo=memoValue?object(memoValue):undefined;
  const command=memo?.command?object(memo.command):undefined,change=command?.change?object(command.change):undefined,plan=memo?.revision?object(memo.revision):undefined;
  if(!command||!change||!plan||command.action!=='revise'||typeof memo!.requestDigest!=='string'||!/^[0-9a-f]{64}$/.test(memo!.requestDigest as string)||jsonDigest(change.input)!==jsonDigest(rule!.input)||command.commandId!==evidence.commandId||command.runId!==m.run.id||change.taskId!==rule!.changedTask||change.effectId!==rule!.changedEffectId||jsonDigest(change.evidence)!==jsonDigest(evidence)||jsonDigest(plan.assets)!==jsonDigest(evidence.assets))throw new Error('Revision assets differ from the canonical Host-prepared command and selected original task');
  const assets=evidence.assets as unknown as import('./workspace.js').WorkspaceRevisionAsset[],p=pathsOf(m.site);
  if(typeof plan.revisionId!=='string'||!/^[a-z0-9][a-z0-9-]{0,79}$/.test(plan.revisionId)||jsonDigest(plan.selected)!==jsonDigest(rule!.selected))throw new Error('Prepared revision has another selected invocation or invalid retained source namespace');
  const versions=p.join(m.product.workspace,'.hima','revisions',plan.revisionId);
  for(const asset of assets) {
    if(!asset||!['workspace','workshop'].includes(asset.scope)||typeof asset.nodeId!=='string'||typeof asset.logicalPath!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(asset.logicalPath)||asset.logicalPath.split('/').some(part=>part==='.'||part==='..'||part==='')||!['path','beforeVersionPath','afterVersionPath'].every(key=>typeof asset[key as 'path']==='string'&&p.isAbsolute(asset[key as 'path']))||!/^[0-9a-f]{64}$/.test(asset.beforeSha256)||!/^[0-9a-f]{64}$/.test(asset.afterSha256)||!Number.isSafeInteger(asset.bytes)||asset.bytes<0||asset.beforeVersionPath!==p.join(versions,'before',asset.logicalPath)||asset.afterVersionPath!==p.join(versions,'after',asset.logicalPath))throw new Error('Host-prepared revision asset has an invalid scope, relative path, SHA256 or byte count');
  }
  const ready=await m.store.flowFact(m.run.id,evidence.assetReadyFact);
  if(!ready)return {pending:true,state:'waiting',reason:{code:'revision-preparing',message:'Original accepted revision source bytes are still being verified and retained',source:'revision-preparation'}};
  const proof=object(ready);
  if(proof.commandDigest!==jsonDigest(command)||proof.requestDigest!==memo!.requestDigest||proof.taskId!==change.taskId||proof.effectId!==change.effectId||proof.revision!==m.context.invocation.revision||jsonDigest(proof.selected)!==jsonDigest(plan.selected)||proof.assetsDigest!==jsonDigest(evidence.assets)||jsonDigest(proof.assets)!==jsonDigest(evidence.assets))throw new Error('Prepared revision handoff does not prove this exact command, selected task and byte assets');
  return {assets,binding:{readyFact:evidence.assetReadyFact,readyDigest:jsonDigest(ready)}};
}
const revisionAssets=(m:Materialization):readonly import('./workspace.js').WorkspaceRevisionAsset[]=>m.assets??[];
async function revisionReadyNow(m:Materialization):Promise<void> {
  if(!m.assetBinding)return;
  const fact=await m.store.fact(factIdentity('flow-fact',m.run.id,m.assetBinding.readyFact));
  if(!fact||jsonDigest(object(fact.payload).value)!==m.assetBinding.readyDigest)throw new Error('Original prepared revision handoff is unavailable at the actual mutation boundary');
}
async function workspaceRevisionStage(m:Materialization,base:TaskEffectAdapter):Promise<TaskEffectAdapter> {
  const nodeId=m.node?.id??m.context.task.id,assets=revisionAssets(m).filter(asset=>asset.nodeId===nodeId&&asset.scope==='workspace');
  if(!assets.length)return base;
  const unchanged=async()=>{
    await revisionReadyNow(m);const site=loadSite(m.deps.sitesDir,m.site.name),on=channelFor(site);
    for(const asset of assets){const decision=await decideRead(site,asset.path,on);if(!decision.ok)throw new Error(decision.reason);if(sha(await on.readFile(decision.absPath))!==asset.afterSha256)throw new Error('Approved shared workspace source changed after its one prepared application');}
  };
  return {...base,async stage(prepared,beforeWrite) {
    await unchanged();if(base.stage)await base.stage(prepared,beforeWrite);else await beforeWrite();
  },submit:(prepared,beforeSend)=>base.submit(prepared,async()=>{await unchanged();await beforeSend();})};
}
async function workshopAdapter(m:Materialization):Promise<TaskEffectAdapter> {
  const node=m.node;if(!node||node.kind!=='act'||!node.parameters.workshop)throw new Error('Workshop adapter needs its frozen declaration');
  const declaration=m.pack.contract.workshops.find(item=>item.id===node.parameters.workshop)!;
  const produced=requiredOutput(m,declaration.produces),own=resolvePackReader(m.pack,produced.reader!,'the reading');if(own.kind==='broken')throw new Error(own.reason);
  const emits=own.kind==='declared'?own.declaration.emits:readerNamed(produced.reader!)?.emits;if(!emits)throw new Error('Workshop output has no domain Reader');
  const semantics=semanticsOf(m.pack,'the reading'),p=pathsOf(m.site),workshopAbs=p.join(m.product.workspace,declaration.directory,'.executions',sha(m.context.request.identity.effectId).slice(0,32)),entryAbs=p.join(workshopAbs,declaration.entry);
  const reads=declaration.reads.map(name=>({name,path:p.join(m.product.workspace,outputPath(requiredOutput(m,name),m.product.bindings))}));
  const knowledge=declaration.knowledge.map(file=>{const item=m.pack.contract.knowledge.find(item=>item.file===file)!;if(!m.pack.folder.has(`knowledge/${file}`))throw new Error(`Frozen Workshop Knowledge ${file} is unavailable`);return {file,purpose:item.purpose,at:path.join(m.pack.dir,'knowledge',file)};});
  const values={...m.platform,ENTRY:entryAbs,WORKSHOP:workshopAbs,FLOW_ROOT:m.product.bindings.flowRoot!,DESIGN:m.product.bindings.design!};
  const argv=workshopArgv(declaration,values);
  const produces={name:produced.name,path:p.join(m.product.workspace,outputPath(produced,m.product.bindings)),reader:produced.reader!,emits:emits.map(type=>{const declared=semantics[type];if(!declared)throw new Error(`Workshop Reader emits undeclared semantic ${type}`);return {type,declared};})};
  const author=autopilotForkOfNode(m.pack,node.id)?.author,totalAttempts=author?author.maxFollowups+1:((m.run.budget as {retryAllowance?:number}|undefined)?.retryAllowance??defaultRetryAllowance);
  const brief={declaration,nodeId:node.id,attempt:m.execution.attempt,allowance:totalAttempts,siteName:m.site.name,workshopAbs,entryAbs,argv,reads,knowledge,produces,values};
  const assets=revisionAssets(m);
  const revision=m.context.invocation.revision?await m.store.flowFact(m.run.id,`revision:${m.context.invocation.revision}`):null;
  const changedEffectId=revision&&typeof object(revision).changedEffectId==='string'?object(revision).changedEffectId as string:undefined;
  const seed=assets.filter(asset=>asset.nodeId===node.id&&asset.scope==='workshop');
  const collectProgram=async(_site:Site,job:JobIdentity,request:TaskEffectRequest):Promise<TaskToolOutput|TaskCollectionPending>=>{
    const problem=await taskEffectStep('hima.workshop.output-freshness',()=>workshopOutputProblem({site:loadSite(m.deps.sitesDir,m.site.name),pack:m.pack,bindings:m.product.bindings,workspace:m.product.workspace,node,session:job.session,entryPath:entryAbs}));
    if(problem)throw new Error(problem);
    return collectReader(m,produced,request);
  };
  const priorSources=seed.length&&changedEffectId?await priorWorkshopSources(m,node,changedEffectId):[];
  const priorEntry=priorSources.find(item=>item.relative===declaration.entry);
  const retainedEntry=priorEntry?await taskEffectStep('hima.workshop.approved-entry-source',async()=>sha(await readFile(priorEntry.value.retainedPath))===priorEntry.value.sha256):false;
  if(seed.some(asset=>asset.logicalPath===declaration.entry)||seed.length&&retainedEntry) {
    const program=commandTaskAdapter({sitesDir:m.deps.sitesDir,siteId:m.site.name,workspace:m.product.workspace,name:`approved-workshop-${declaration.id}`,argv,licences:declaration.licences,kind:'program',
      collect:async(site,job,request)=>{
        const result=await collectProgram(site,job,request);
        if('pending' in result)return result;
        const sources=await m.store.listExternalEffectFacts(request.identity,'revision-source:');
        return {...result,value:json({...object(result.value),approvedProgram:{entry:entryAbs,sources}})};
      }});
    return {...program,async stage(prepared,beforeWrite) {
      await beforeWrite();
      await stageApprovedWorkshopSources(m,node,workshopAbs,seed,changedEffectId,async()=>{await revisionReadyNow(m);await beforeWrite();});
    },submit:async(prepared,beforeSend)=>program.submit(prepared,async()=>{await revisionReadyNow(m);await approvedWorkshopSourcesReady(m);await beforeSend();})};
  }
  const base=workshopTaskAdapter({ctx:m.deps.ctx,store:m.store,request:m.context.request,sitesDir:m.deps.sitesDir,siteId:m.site.name,workspace:m.product.workspace,
    scope:{runId:m.run.id,nodeId:node.id,attempt:m.execution.attempt,declaration,workshopAbs,reads,knowledge,...(m.execution.branchId?{branchId:m.execution.branchId}:{})},
    modelSelection:m.product.modelSelection, instructions:workshopInstructions(brief)+`\nCampaign Goal: ${JSON.stringify(m.run.goal)}\nStrategy: ${JSON.stringify(m.run.strategy)}`,
    prompt:workshopAsk(declaration.entry),retainedMaterialsDir:m.deps.retainedMaterialsDir,argv,collectProgram});
  const staged:TaskEffectAdapter={...base,async stage(prepared,before) {
    await base.stage!(prepared,before);
    const fresh=loadSite(m.deps.sitesDir,m.site.name),on=channelFor(fresh),realWorkspace=await on.realpath(m.product.workspace),wanted=p.join(realWorkspace,declaration.directory,'.executions',sha(m.context.request.identity.effectId).slice(0,32));
    if(await on.realpath(workshopAbs)!==wanted)throw new Error('Original Workshop directory resolves outside its declared private execution');
    for(const owned of ['flow','hima-readers']) {const at=p.join(realWorkspace,owned);if(!await on.absent(at)){const real=await on.realpath(at);if(wanted===real||wanted.startsWith(real+p.sep))throw new Error(`Workshop directory aliases protected ${owned}`);}}
    if(assets.length) {
      const {materializeWorkshopRevision}=await import('./workspace.js');const copied=await materializeWorkshopRevision(fresh,assets.filter(asset=>asset.nodeId===node.id),workshopAbs,async()=>{await revisionReadyNow(m);await before();});
      for(const item of copied)await m.store.recordExternalEffectFact(m.context.request.identity,`revision-source:${item.asset.logicalPath}`,json({asset:item.asset,path:p.join(workshopAbs,item.asset.logicalPath),retainedPath:await retainBytes(m,item.bytes)}));
    }
  }};
  return automaticNativeRepair(m,staged,{kind:'workshop',maxFollowups:author?.maxFollowups??Math.max(0,totalAttempts-1),maxElapsedMs:author?.maxElapsedMs,entryPath:entryAbs});
}
interface MemberResult { readonly result:TaskResult; readonly payload:Record<string,JsonValue>; readonly delegationId:string }
function orderedMemberLayers(team:PackAgentTeam):PackAgentTeamMember[][] {
  const needed=new Set(team.members.filter(member=>!member.optional).map(member=>member.id));
  const include=(id:string)=>{needed.add(id);for(const dependency of team.members.find(member=>member.id===id)!.dependencyRoles)if(!needed.has(dependency))include(dependency);};
  for(const id of [...needed])include(id);
  const done=new Set<string>(),layers:PackAgentTeamMember[][]=[];
  while(done.size<needed.size) {const layer=team.members.filter(member=>needed.has(member.id)&&!done.has(member.id)&&member.dependencyRoles.every(id=>done.has(id)));if(!layer.length)throw new Error('Frozen Team dependencies contain a cycle');layers.push(layer);for(const member of layer)done.add(member.id);}
  return layers;
}
async function retainedObservationText(row:ObservationRecord):Promise<string> {
  if(!row.retainedPath)throw new Error('Declared Team input has no retained Reader bytes');
  const bytes=await readFile(row.retainedPath);if(sha(bytes)!==row.contentSha256)throw new Error('Retained Team input differs from its Reader SHA256');return bytes.toString('utf8');
}
async function memberMaterialization(m:Materialization,team:PackAgentTeam,member:PackAgentTeamMember,request:TaskEffectRequest,results:Readonly<Record<string,MemberResult>>):Promise<NativeTeamMember> {
  if(member.node!==m.node?.id)throw new Error('Recipe member requires its exact freshly begun target task invocation');
  const parent=m.deps.ctx.get('agents')?.get(m.product.parentSessionId as never);
  if(!parent)throw new TaskAdapterMaterializationError({code:'native-parent-unavailable',message:'The original Team parent session is not available for a new child',source:'native-domain'});
  if(parent&&(parent.options.provider!==m.product.modelSelection.provider||parent.options.model!==m.product.modelSelection.model))throw new Error('Original Team parent model route differs from frozen Run preparation');
  const rows=new Map(await Promise.all(member.inputs.map(async name=>{const reading=await observationForOutput(m,name);if(!reading)throw new Error(`Recipe input ${name} needs one current committed Reader observation`);return [name,reading] as const;})));
  const inputRefs=[...rows.values()].map(row=>row.id),dependencyIds:string[]=[];
  for(const id of member.dependencyRoles) {const result=results[id];if(!result)throw new Error(`Recipe dependency ${id} has no committed schema-valid result`);dependencyIds.push(result.delegationId);inputRefs.push(sourceFactId(result.result.identity.effectId));}
  const tool=m.pack.contract.tools.find(tool=>tool.id===(m.node as Extract<PackNode,{kind:'act'}>).parameters.tool);
  let inlinePayload:TeamRecipeBinding['inlinePayload'];
  if(member.reviewedAction) {
    const review=member.reviewedAction,plan=rows.get(review.planInput);if(!plan)throw new Error('Reviewed action has no current Reader-backed plan');
    const text=await taskEffectStep('hima.team.read-reviewed-plan',()=>retainedObservationText(plan)),planValue=JSON.parse(text) as Record<string,unknown>;
    if(review.mode==='request-scope') {
      let scope:unknown=planValue;for(const key of review.scopePath)scope=scope&&typeof scope==='object'&&!Array.isArray(scope)?(scope as Record<string,unknown>)[key]:undefined;
      const problem=reviewedScopeProblem(scope,review);if(problem)throw new Error(problem);
      inlinePayload={mode:'scope',sourceResultRecordId:plan.id,adoptionRecordId:plan.id,planSha256:plan.contentSha256,planHashArgument:review.hostPlanHashArgument,scope:scope as {commands:string[];maxMutations:number}};
    } else {
      const dependency=results[review.fromRole];if(!dependency)throw new Error('Reviewed action source has no committed dependency result');const payload=dependency.payload;
      const planHash=payload[review.planHashField];if(planHash!==plan.contentSha256)throw new Error('Reviewed plan SHA256 differs from current Reader-backed plan');
      if(review.mode==='scope') {
        const scope=payload[review.scopeField],problem=reviewedScopeProblem(scope,review);if(problem)throw new Error(problem);
        const qualified=scope as unknown as {commands:string[];maxMutations:number};if(qualified.commands.some(command=>!tool?.interactive?.commands.mutate.includes(command)||!tool.interactive.arguments[command]?.some(item=>item.name===review.hostPlanHashArgument&&item.type==='string')))throw new Error('Reviewed scope contains a mutation outside the typed hash-bearing tool contract');
        inlinePayload={mode:'scope',sourceResultRecordId:sourceFactId(dependency.result.identity.effectId),adoptionRecordId:sourceFactId(dependency.result.identity.effectId),planSha256:plan.contentSha256,planHashArgument:review.hostPlanHashArgument,scope:qualified};
      } else {
        const command=payload[review.commandField],args=object(payload[review.argumentsField]!);if(command!==review.command)throw new Error('Reviewed action command differs from frozen Pack recipe');
        const declarations=tool?.interactive?.arguments[review.command]?.filter(item=>item.name!==review.hostPlanHashArgument);if(!declarations)throw new Error('Reviewed action has no typed Operator tool');
        if(Object.keys(args).length!==declarations.length||declarations.some(item=>!Object.hasOwn(args,item.name)||typeof args[item.name]!==item.type||item.choices&&!item.choices.includes(args[item.name] as never)||typeof args[item.name]==='number'&&(item.minimum!==undefined&&(args[item.name] as number)<item.minimum||item.maximum!==undefined&&(args[item.name] as number)>item.maximum)))throw new Error('Reviewed action arguments differ from typed Pack command');
        const list=planValue[review.actionListField];if(!Array.isArray(list)||!list.some(candidate=>candidate&&typeof candidate==='object'&&declarations.every(item=>(candidate as Record<string,unknown>)[item.name]===args[item.name])))throw new Error('Reviewed action is not one action in the exact Reader-backed plan');
        inlinePayload={sourceResultRecordId:sourceFactId(dependency.result.identity.effectId),adoptionRecordId:sourceFactId(dependency.result.identity.effectId),planSha256:plan.contentSha256,command:review.command,arguments:{...args,[review.hostPlanHashArgument]:plan.contentSha256} as Record<string,string|number|boolean>};
      }
    }
  }
  const embedded=await Promise.all(member.taskInputs.map(async wanted=>{
    const row=rows.get(wanted.input);
    if(!row)throw new Error(`Task input ${wanted.input} has no Reader source`);
    const source=await taskEffectStep('hima.team.embed-input',()=>retainedObservationText(row));
    let selected=source;
    if(wanted.fields) {
      const parsed=wanted.fields.length?JSON.parse(source):undefined;
      selected=JSON.stringify(Object.fromEntries(wanted.fields.filter(field=>Object.hasOwn(parsed,field)).map(field=>[field,parsed[field]])));
    }
    return `Exact input ${wanted.input} (Reader ${row.id}, SHA256 ${row.contentSha256}):\n${selected}`;
  }));
  let reviewOutput:TeamRecipeBinding['reviewOutput'];
  const consumer=team.members.find(candidate=>candidate.reviewedAction&&candidate.reviewedAction.mode!=='request-scope'&&candidate.reviewedAction.fromRole===member.id);
  if(consumer?.reviewedAction&&consumer.reviewedAction.mode!=='request-scope') {
    const reviewed=consumer.reviewedAction;
    if(reviewed.mode==='scope')reviewOutput={mode:'scope',scopeField:reviewed.scopeField,commands:reviewed.commands,maxMutations:reviewed.maxMutations};
    else {const args=tool?.interactive?.arguments[reviewed.command];if(!args)throw new Error('Frozen Reviewer output has no corresponding typed Operator command');reviewOutput={command:reviewed.command,arguments:args.filter(argument=>argument.name!==reviewed.hostPlanHashArgument).map(argument=>argument.name)};}
  }
  const delegationId=`team-${sha(`${m.context.request.identity.effectId}:${team.id}:${member.id}`).slice(0,32)}`;
  const current=await m.store.run(m.run.id);
  const contract:DelegationContract={delegationId,parentSessionId:m.product.parentSessionId,role:member.role,task:[member.taskTemplate,`Runtime inputs: ${inputRefs.join(', ')}.`,inlinePayload?`Immutable reviewed payload: ${JSON.stringify(inlinePayload)}`:'',...embedded].filter(Boolean).join('\n'),
    inputRefs,workspaceRef:parent?.session.header.cwd,runRef:{runId:current.runId,expectedEpoch:request.admission.epoch,expectedRevision:request.admission.revision},nodeRef:member.node,allowedTools:member.allowedTools,
    budgetShare:member.budgetShare,dependencyIds,recipient:{kind:'run-owner',sessionId:m.product.parentSessionId},status:'requested',
    recipe:{teamId:team.id,version:team.version,memberId:member.id,executionId:m.execution.id,recipeDigest:jsonDigest(json({packDigest:m.context.flow.packSha256,team,member})),resultSchema:member.resultSchema,...(reviewOutput?{reviewOutput}:{}),...(inlinePayload?{inlinePayload}:{})}};
  let operatorGrant;
  if(member.role==='operator') {
    if(!m.deps.interactive)throw new Error('Original Operator requires the Host qualified interactive bridge');
    const interactive={...m.deps.interactive,store:m.store,sitesDir:m.deps.sitesDir,resolveOperation:()=>m.deps.interactive!.bridge.resolve({pack:m.pack,run:m.run,execution:m.execution,site:m.site,workspace:m.product.workspace,bindings:m.product.bindings,node:m.node as Extract<PackNode,{kind:'act'}>})};
    operatorGrant=await taskInteractiveDelegationGrant(interactive,request.identity,request.admission,{executionId:m.execution.id,nodeId:member.node});
  }
  return {contract,...(operatorGrant?{operatorGrant}:{})};
}
function aggregateTeamAdapter(m:Materialization,team:PackAgentTeam):TaskEffectAdapter {
  const layers=orderedMemberLayers(team);
  const permit=async()=>{assertMethodCurrent(m);return jsonDigest(json(loadSite(m.deps.sitesDir,m.site.name)))===m.product.siteDigest;};
  const build=(request:TaskEffectRequest,native:NativeTeamMember,member:PackAgentTeamMember):TaskEffectAdapter=>methodFence(m,automaticNativeRepair({...m,context:{...m.context,request}},teamTaskAdapter({ctx:m.deps.ctx,store:m.store,request,sitesDir:m.deps.sitesDir,siteId:m.site.name,workspace:m.product.workspace,members:[native],permit,
    closeOperator:m.deps.interactive?id=>closeTaskInteractiveSessions({...m.deps.interactive!,store:m.store,sitesDir:m.deps.sitesDir},id):undefined,
    collectMembers:async(members,req)=>{
      const found=members[0]!,text=found.result.output!.filter(block=>block.type==='text').map(block=>block.text).join('');
      const payload=object(JSON.parse(text));if(payload.schema!==member.resultSchema.id||member.resultSchema.required.some(field=>!Object.hasOwn(payload,field)))throw new Error(`Team ${team.id} member ${member.id} must return ${member.resultSchema.id} with fields ${member.resultSchema.required.join(', ')}`);
      const evidence={childSessionId:found.effective.childSessionId,completedTurn:found.result.completedTurn,output:found.result.output};
      const domain=member.role==='operator'&&(m.node as Extract<PackNode,{kind:'act'}>).parameters.observes?await collectReader(m,requiredOutput(m,(m.node as Extract<PackNode,{kind:'act'}>).parameters.observes!),req,json({sessionId:found.effective.childSessionId,completedTurn:found.result.completedTurn})):undefined;
      if(domain&&'pending' in domain)return domain;
      return {...output(req,{payload,evidence,...(domain?object(domain.value):{})}),artifacts:domain?.artifacts??[]};
    }}),{kind:'team',sessionId:delegationChildSessionId(native.contract.parentSessionId,native.contract.delegationId),memberId:native.contract.delegationId,maxFollowups:member.followup==='forbidden'?0:member.budgetShare.maxFollowups,maxElapsedMs:member.budgetShare.maxElapsedMs,format:`Return exactly one JSON object with schema ${member.resultSchema.id} and fields ${member.resultSchema.required.join(', ')}.`}));
  const base=domainAdapter(m,async request=>{
    const results:Record<string,MemberResult>={};
    for(const layer of layers) {
      let waiting:TaskCollectionPending|undefined;
      // Each native creation returns its real asynchronous acceptance. Start every member in this
      // fixed eligible layer before waiting, then let the outer task retry the same original effects.
      for(const member of layer) {
        const child=childRequest(request,`member-${member.id}`,json({teamId:team.id,memberId:member.id,parentInput:request.input}));
        const phase=`member-options:${member.id}`,held=await taskEffectStep('hima.team.member-options-snapshot',async()=>await m.store.externalEffectFact(request.identity,phase)??null);
        const ready=await taskEffectStep('hima.team.new-member-parent',()=>Promise.resolve(!!held||!!m.deps.ctx.get('agents')?.get(m.product.parentSessionId as never)));
        if(!ready)return {pending:true,state:'waiting',reason:{code:'native-parent-unavailable',message:'The original Team parent must be restored before creating this new member',source:'native-domain'}};
        await m.store.bindDerivedEffect(request.identity,child.identity);
        await m.store.prepareExternalEffect(child.identity,json({kind:'team',version:taskEffectAdapterVersion,input:child.input}));
        const native=held?held as unknown as NativeTeamMember:await memberMaterialization(m,team,member,child,results);
        if(!held)await m.store.recordExternalEffectFact(request.identity,phase,json(native));
        const answer=await executeTaskEffect(m.store,child,build(child,native,member));
        if(answer.state==='failed'){await m.store.recordExternalEffectFact(request.identity,'aggregate-terminal',{reason:answer.reason.message,memberId:member.id});return {pending:true,state:'waiting',reason:answer.reason};}
        if(answer.state!=='succeeded') {waiting=pendingCollection(answer);continue;}
        const payload=object(object(answer.result.value).payload!);
        results[member.id]={result:answer.result,payload,delegationId:native.contract.delegationId};
      }
      if(waiting)return waiting;
    }
    const operator=layers.flat().find(member=>member.role==='operator');
    let domain:TaskToolOutput|undefined;
    if(operator) {
      const result=results[operator.id]!.result;
      domain=remap({schemaVersion:request.contract.output.version,value:result.value,artifacts:result.artifacts,diagnostics:result.diagnostics},request);
    } else {
      const node=m.node as Extract<PackNode,{kind:'act'}>,tool=m.pack.contract.tools.find(item=>item.id===node.parameters.tool)!;
      const batchRefusal=batchToolRefusal(tool);if(batchRefusal)throw new Error(batchRefusal);
      const child=childRequest(request,'team-program');await m.store.bindDerivedEffect(request.identity,child.identity);
      const adapter=commandTaskAdapter({sitesDir:m.deps.sitesDir,siteId:m.site.name,workspace:m.product.workspace,name:tool.id,argv:toolArgv(tool,m.platform),licences:tool.licences,
        collect:async(_site,_job,req)=>node.parameters.observes?collectReader(m,requiredOutput(m,node.parameters.observes),req):output(req,{completed:true})});
      const answer=await executeTaskEffect(m.store,child,adapter);if(answer.state!=='succeeded')return pendingCollection(answer);
      domain=remap({schemaVersion:request.contract.output.version,value:answer.result.value,artifacts:answer.result.artifacts,diagnostics:answer.result.diagnostics},request);
    }
    return {...domain,value:json({...object(domain.value),members:Object.fromEntries(Object.entries(results).map(([id,row])=>[id,{value:row.payload,factId:sourceFactId(row.result.identity.effectId)}]))})};
  });
  const aggregate:TaskEffectAdapter={...base,kind:'team',async reconcile(prepared,receipt){const terminal=await m.store.externalEffectFact(m.context.request.identity,'aggregate-terminal');return terminal?{state:'failed',reason:String(object(terminal).reason),receipt:receipt??prepared}:base.reconcile(prepared,receipt);},async release(prepared,receipt,beforeCleanup){return await m.store.externalEffectFact(m.context.request.identity,'aggregate-terminal')?aggregate.stop!(prepared,receipt,beforeCleanup??(async()=>false)):base.release(prepared,receipt,beforeCleanup);},async stop(_prepared,_receipt,beforeCleanup) {
    for(const member of layers.flat()) {
      const held=await m.store.externalEffectFact(m.context.request.identity,`member-options:${member.id}`);if(!held)continue;
      const child=childRequest(m.context.request,`member-${member.id}`,json({teamId:team.id,memberId:member.id,parentInput:m.context.request.input}));
      const effect=await m.store.effect(child.identity.effectId);if(!effect)continue;
      const prepared=await m.store.effectFact(child.identity.effectId,'prepared');if(!prepared)return {closed:false,reason:'Original native child has no prepared stop identity'};
      const adapter=build(child,held as unknown as NativeTeamMember,member);
      const closure=await adapter.stop!(prepared,await m.store.effectFact(child.identity.effectId,'submitted'),(id,input)=>beforeCleanup(`${member.id}:${id}`,input));
      if(!closure.closed)return closure;await m.store.releaseExternalEffectResources(child.identity,closure.proof);
    }
    const program=await m.store.effect(`${m.context.request.identity.effectId}:team-program`);
    if(program) {const prepared=await m.store.effectFact(program.identity.effectId,'prepared');if(!prepared)return {closed:false,reason:'Original Team program has no recoverable Job identity'};const tool=m.pack.contract.tools.find(item=>item.id===(m.node as Extract<PackNode,{kind:'act'}>).parameters.tool)!;
      const adapter=commandTaskAdapter({sitesDir:m.deps.sitesDir,siteId:m.site.name,workspace:m.product.workspace,name:tool.id,argv:toolArgv(tool,m.platform),licences:tool.licences,collect:async()=>{throw new Error('Stop never collects business data');}});
      const closed=await adapter.stop!(prepared,await m.store.effectFact(program.identity.effectId,'submitted'),(id,input)=>beforeCleanup(`team-program:${id}`,input));if(!closed.closed)return closed;await m.store.releaseExternalEffectResources(program.identity,closed.proof);}
    return {closed:true,proof:{team:team.id,originalChildrenClosed:true}};
  }};
  return aggregate;
}
async function growthDiagnosticOutput(m:Materialization,request:TaskEffectRequest):Promise<TaskToolOutput> {
  const declaration=object(m.context.task.legacy!),names=declaration.requiredOutputs;
  if(!Array.isArray(names)||names.some(name=>typeof name!=='string'))throw new Error('Frozen diagnostic fragment has no declared required outputs');
  const results:Record<string,JsonValue>={};
  for(const name of names as string[]) {const rows=Object.entries(m.context.committed).filter(([id])=>Object.hasOwn(m.context.flow.tasks,id)).flatMap(([,result])=>{const value=object(result.value);return Array.isArray(value.observations)?value.observations as unknown as ObservationRecord[]:[];});const row=rows.findLast(row=>(row as ObservationRecord&{outputName?:string}).outputName===name);if(!row)throw new Error(`Diagnostic fragment did not deliver required Reader output ${name}`);results[name]=json({observations:[row]});}
  return output(request,{proposalId:object(declaration.proposal!).proposalId,requiredOutputs:results});
}
async function growthResumeOutput(m:Materialization,request:TaskEffectRequest):Promise<TaskToolOutput> {
  const inputs=object(request.input),prior=inputs.priorDecision;
  if(prior===undefined)throw new Error('Legacy diagnostic continuation has no committed prior decision');
  if(inputs.diagnostic===undefined)return output(request,prior);
  const diagnostic=object(inputs.diagnostic);
  if(['failed','cancelled','abandoned'].includes(String(diagnostic.status)))return output(request,{...object(prior),optionalDiagnostic:diagnostic});
  const returned=object(diagnostic.requiredOutputs!),rows:ObservationRecord[]=[];
  for(const [name,value] of Object.entries(returned)) {
    requiredOutput(m,name);const sources=object(value).observations;if(!Array.isArray(sources)||!sources.length)throw new Error(`Diagnostic output ${name} has no domain Reader source`);
    for(const raw of sources) {
      const row=raw as unknown as ObservationRecord&{outputName:string};
      if(row.outputName!==name||row.runId!==request.identity.runId||row.generation!==m.execution.generation||row.loopId!==m.run.loop?.id)throw new Error('Diagnostic Reader source belongs to another output, Run or generation');
      const fact=await m.store.fact(row.id);if(!fact||fact.kind!=='task-result')throw new Error('Diagnostic Reader source has no committed task-result fact');
      const producer=fact.payload as unknown as TaskResult;
      const observed=object(producer.value).observations;
      if(producer.identity.runId!==request.identity.runId||producer.identity.packSha256!==request.identity.packSha256||!Array.isArray(observed)||!observed.some(candidate=>jsonDigest(candidate)===jsonDigest(raw)))throw new Error('Diagnostic Reader values differ from their committed producer source');
      await taskEffectStep('hima.domain.diagnostic-source',()=>retainedObservationText(row));
      rows.push({...row,seq:fact.seq,at:fact.at});
    }
  }
  if(!rows.length)throw new Error('Diagnostic continuation has no declared returned Reader outputs');
  return exploreOutput(m,request,rows);
}
interface PriorWorkshopSource { readonly relative:string;readonly phase:string;readonly value:{readonly nodeId:string;readonly path:string;readonly sha256:string;readonly retainedPath:string} }
async function priorWorkshopSources(m:Materialization,node:Extract<PackNode,{kind:'act'}>,changed:string):Promise<PriorWorkshopSource[]> {
  const original=await m.store.effect(changed);if(!original)return [];
  if(original.identity.taskId!==node.id)throw new Error('Approved Workshop helper sources require the selected original invocation of this node');
  const p=pathsOf(m.site),priorRoot=p.join(m.product.workspace,m.pack.contract.workshops.find(item=>item.id===node.parameters.workshop)!.directory,'.executions',sha(changed).slice(0,32));
  const records=[...await m.store.orderedExternalEffectFacts(original.identity,'code:'),...await m.store.orderedExternalEffectFacts(original.identity,'revision-source:')].sort((a,b)=>a.seq-b.seq),latest=new Map<string,PriorWorkshopSource>();
  for(const record of records) {
    const raw=object(record.fact),asset=raw.asset===undefined?undefined:object(raw.asset),value={nodeId:String(raw.nodeId??asset?.nodeId??original.identity.taskId),path:String(raw.path),sha256:String(raw.sha256??asset?.afterSha256),retainedPath:String(raw.retainedPath)};
    const relative=p.relative(priorRoot,value.path);
    if(value.nodeId!==node.id||!relative||relative.startsWith('..')||p.isAbsolute(relative)||!/^[0-9a-f]{64}$/.test(value.sha256)||!p.isAbsolute(value.retainedPath))throw new Error('Selected Workshop source has invalid node, path, retained bytes or SHA256 provenance');
    latest.set(relative,{relative,phase:record.phase,value});
  }
  return [...latest.values()];
}
/** Copy verified unchanged helper receipts plus accepted replacements into this new private
 * execution. These are revision/source facts, never invented DSH authoring receipts. */
async function stageApprovedWorkshopSources(m:Materialization,node:Extract<PackNode,{kind:'act'}>,root:string,assets:readonly import('./workspace.js').WorkspaceRevisionAsset[],changed:string|undefined,beforeWrite:()=>Promise<void>):Promise<void> {
  const site=loadSite(m.deps.sitesDir,m.site.name),on=channelFor(site),p=pathsOf(site),directory=await decideWrite(site,root,on);
  if(!directory.ok)throw new Error(directory.reason);await beforeWrite();await mustRun(on,['mkdir','-p','--',directory.absPath],'prepare approved Workshop source directory');
  const realWorkspace=await on.realpath(m.product.workspace),wanted=p.join(realWorkspace,m.pack.contract.workshops.find(item=>item.id===node.parameters.workshop)!.directory,'.executions',sha(m.context.request.identity.effectId).slice(0,32));
  if(await on.realpath(root)!==wanted)throw new Error('Approved Workshop source directory aliases another execution');
  if(typeof changed==='string') {
    for(const {relative,value,phase} of await priorWorkshopSources(m,node,changed)) {
      if(assets.some(asset=>asset.logicalPath===relative))continue;
      const bytes=await readFile(value.retainedPath);if(sha(bytes)!==value.sha256)throw new Error(`Original retained Workshop helper ${relative} changed`);
      const target=p.join(root,relative),parent=await decideWrite(site,p.dirname(target),on);if(!parent.ok)throw new Error(parent.reason);
      await beforeWrite();await mustRun(on,['mkdir','-p','--',parent.absPath],'stage approved original Workshop helper');
      const output=await decideWrite(site,target,on);if(!output.ok)throw new Error(output.reason);await beforeWrite();await mustRun(on,['tee','--',output.absPath],'copy verified Workshop helper',{stdin:bytes});
      if(sha(await on.readFile(output.absPath))!==value.sha256)throw new Error('Staged original Workshop helper differs from its source receipt');
      await m.store.recordExternalEffectFact(m.context.request.identity,`revision-source:${relative}`,json({nodeId:node.id,path:output.absPath,sha256:value.sha256,retainedPath:value.retainedPath,source:{effectId:changed,phase}}));
    }
  }
  const {materializeWorkshopRevision}=await import('./workspace.js');
  const copied=await materializeWorkshopRevision(site,assets,root,async()=>beforeWrite());
  for(const item of copied)await m.store.recordExternalEffectFact(m.context.request.identity,`revision-source:${item.asset.logicalPath}`,json({nodeId:node.id,path:p.join(root,item.asset.logicalPath),sha256:item.asset.afterSha256,asset:item.asset,retainedPath:await retainBytes(m,item.bytes)}));
}
async function approvedWorkshopSourcesReady(m:Materialization):Promise<void> {
  const site=loadSite(m.deps.sitesDir,m.site.name),on=channelFor(site);
  const sources=await m.store.listExternalEffectFacts(m.context.request.identity,'revision-source:');
  if(!Object.keys(sources).length)throw new Error('Approved Workshop has no staged source provenance');
  for(const raw of Object.values(sources)) {const source=raw as unknown as {path:string;sha256:string};const read=await decideRead(site,source.path,on);if(!read.ok)throw new Error(read.reason);if(sha(await on.readFile(read.absPath))!==source.sha256)throw new Error('Approved Workshop source changed before original program dispatch');}
}
interface NativeRepairPolicy {
  readonly kind:'workshop'|'team'; readonly sessionId?:string; readonly memberId?:string;
  readonly maxFollowups:number; readonly maxElapsedMs?:number; readonly entryPath?:string; readonly format?:string;
}
/** Existing producer feedback, not a scheduler: every message uses U4's same original admission,
 * receipt and native session. PG plans freeze cause/text/identity before any actual followup. */
function automaticNativeRepair(m:Materialization,base:TaskEffectAdapter,policy:NativeRepairPolicy):TaskEffectAdapter {
  const request=m.context.request,terminal='auto-repair:terminal';
  const wait=(message:string,state:'running'|'waiting'='waiting'):TaskCollectionPending=>({pending:true,state,reason:{code:'native-repair',message,source:'native-domain'}});
  const session=(prepared:JsonValue)=>policy.sessionId??String(object(prepared).sessionId);
  const failure=async(reason:string):Promise<TaskCollectionPending>=>{
    await m.store.recordExternalEffectFact(request.identity,terminal,{reason});
    return wait(reason);
  };
  const repair=async(prepared:JsonValue,turn:NativeTaskTurn,category:'schema'|'program',episode:string,message:string):Promise<TaskCollectionPending>=>{
    const plans=await taskEffectStep('hima.native.repair-plan-snapshot',()=>m.store.listExternalEffectFacts(request.identity,'auto-repair:plan:'));
    const existing=Object.values(plans).map(value=>object(value));
    const same=existing.find(plan=>plan.sessionId===turn.sessionId&&plan.endSeq===turn.endSeq);
    if(same) {
      const answer=await sendTaskEffectMessage(m.store,request,base,String(same.id),same.input!);
      return wait(answer.state==='waiting'?answer.reason.message:'The original native repair feedback is awaiting its next completed turn','running');
    }
    if(category==='schema'&&existing.some(plan=>plan.category==='schema'&&plan.episode===episode))return failure(`Native output still fails its declared contract after its one schema repair: ${message}`);
    const messages=await taskEffectStep('hima.native.repair-message-snapshot',()=>m.store.listExternalEffectFacts(request.identity,'message:'));
    const used=new Set([...existing.map(plan=>String(plan.id)),...Object.keys(messages).filter(key=>key.endsWith(':intent')).map(key=>key.slice('message:'.length,-':intent'.length))]);
    if(used.size>=policy.maxFollowups)return failure(`The original native follow-up allowance is exhausted (${policy.maxFollowups}); ${message}`);
    const id=`auto-${category}-${jsonDigest([request.identity.effectId,turn.sessionId,turn.endSeq,episode]).slice(0,36)}`;
    const text=`${message}\n${policy.kind==='workshop'?`Use the granted Workshop tools to repair ${policy.entryPath}. Write the complete changed source, run no tools outside this scope, and say when it is written.`:policy.format}`.slice(0,7900);
    const input=policy.kind==='team'?json({memberId:policy.memberId,text}):text;
    await m.store.recordExternalEffectFact(request.identity,`auto-repair:plan:${id}`,json({id,category,episode,sessionId:turn.sessionId,endSeq:turn.endSeq,input}));
    const answer=await sendTaskEffectMessage(m.store,request,base,id,input);
    return wait(answer.state==='waiting'?answer.reason.message:'Feedback was delivered to the same native task; its corrected output is pending','running');
  };
  const currentProgram=async()=>{
    const code=await taskEffectStep('hima.native.repair-code-snapshot',()=>m.store.orderedExternalEffectFacts(request.identity,'code:'));
    const latest=new Map(code.map(item=>{const value=item.fact as unknown as {path:string;sha256:string;toolCallId:string};return [value.path,value];}));
    const fingerprint=jsonDigest({input:request.input,code:[...latest.values()].map(({path,sha256})=>({path,sha256}))});
    return {latest,fingerprint};
  };
  return {...base,
    async prepare(req) {const prepared=object(await base.prepare(req));return {...prepared,repairDeadlineAt:new Date(Math.min(Date.parse(m.deadlineAt),Date.now()+(policy.maxElapsedMs??Number.MAX_SAFE_INTEGER))).toISOString()};},
    async reconcile(prepared,receipt) {
      const ended=await m.store.externalEffectFact(request.identity,terminal);
      if(ended)return {state:'failed',reason:String(object(ended).reason),receipt:receipt??prepared};
      if(Date.now()>=Date.parse(String(object(prepared).repairDeadlineAt))) {
        await m.store.recordExternalEffectFact(request.identity,terminal,{reason:'Original native task allocation deadline is exhausted'});
        return {state:'failed',reason:'Original native task allocation deadline is exhausted',receipt:receipt??prepared};
      }
      const original=await base.reconcile(prepared,receipt);
      if(original.state==='ready'||original.state==='failed')return original;
      const turn=await readNativeTaskTurn(m.deps.ctx,session(prepared));
      if(turn.state==='ended'&&(turn.reason!=='completed'||!turn.text||policy.kind==='workshop'&&turn.successfulWriteCalls?.length)) {
        // New accepted inbox work must still be consumed; do not turn an older boundary into feedback.
        if(/accepted native message|consuming turn|message.*receipt/i.test(original.reason))return original;
        return {state:'ready',receipt:receipt??prepared};
      }
      return original;
    },
    async collect(prepared,receipt,req) {
      const turn=await taskEffectStep('hima.native.current-repair-turn',()=>readNativeTaskTurn(m.deps.ctx,session(prepared)));
      if(turn.state!=='ended')return wait('The original native turn has not reached a current terminal boundary','running');
      const plans=await taskEffectStep('hima.native.current-repair-plans',()=>m.store.orderedExternalEffectFacts(req.identity,'auto-repair:plan:'));
      const latestPlan=plans.map(item=>object(item.fact)).at(-1);
      if(latestPlan&&latestPlan.endSeq===turn.endSeq)return repair(prepared,turn,String(latestPlan.category) as 'schema'|'program',String(latestPlan.episode),'Original repair feedback is pending');
      let program:Awaited<ReturnType<typeof currentProgram>>|undefined;
      if(policy.kind==='workshop') {
        program=await currentProgram();
        const hasEntry=program.latest.has(policy.entryPath!);
        const authored=program.latest.size>0&&[...program.latest.values()].some(code=>turn.successfulWriteCalls?.includes(code.toolCallId));
        if(!hasEntry||latestPlan&&!authored||turn.reason!=='completed')return repair(prepared,turn,'schema',String(latestPlan?.category==='program'?latestPlan.episode:latestPlan?.episode??'initial-author'),`Your current native turn ${turn.reason} did not author the required sourced program. ${!hasEntry?'The declared entry Code receipt is missing.':''}`);
        const failed=await taskEffectStep('hima.native.failed-program-snapshot',async()=>await m.store.externalEffectFact(req.identity,`auto-repair:failed:${program!.fingerprint}`)??null);
        if(failed)return failure(`An identical program/source fingerprint already failed and is not run again: ${object(failed).reason}`);
        if(!await m.store.externalEffectFact(req.identity,`program:${program.fingerprint}`))assertMethodCurrent(m);
      } else if(turn.reason!=='completed'||!turn.text)return repair(prepared,turn,'schema','member-result',`Your current native turn ended ${turn.reason} without a complete output; reply with the declared JSON object only.`);
      try {
        const result=await base.collect(prepared,receipt,req);
        if(!('pending' in result)||result.reason.code!=='reader-rejected')return result;
        return await rejected(result.reason.message);
      } catch(error) {return rejected(error instanceof Error?error.message:String(error));}
      async function rejected(message:string):Promise<TaskCollectionPending> {
        if(policy.kind!=='workshop')return repair(prepared,turn,'schema','member-result',`Your result does not satisfy the original declared contract: ${message}`);
        const fingerprint=program!.fingerprint;
        const intent=await taskEffectStep('hima.native.failed-program-intent',async()=>await m.store.externalEffectFact(req.identity,`program:${fingerprint}`)??null);
        if(!intent)return repair(prepared,turn,'schema',String(latestPlan?.episode??'initial-author'),message);
        const identity=object(intent).identity as unknown as TaskEffectRequest['identity'];
        const job=await taskEffectStep('hima.native.failed-program-job',async()=>await m.store.effectFact(identity.effectId,'submitted')??await m.store.effectFact(identity.effectId,'prepared')??null);
        const tail=job?await taskEffectStep('hima.native.failed-program-log',()=>retainedJobTail(loadSite(m.deps.sitesDir,m.site.name),job as unknown as JobIdentity,40)).catch(()=>undefined):undefined;
        const detail=`Your previous sourced entry ran and failed: ${message}${tail?`\nTail of its original Job log:\n${tail.trim().slice(-2400)}`:''}`;
        await m.store.recordExternalEffectFact(req.identity,`auto-repair:failed:${fingerprint}`,json({reason:message,identity,job,turnEndSeq:turn.endSeq}));
        return repair(prepared,turn,'program',fingerprint,detail);
      }
    },
    async release(prepared,receipt,beforeCleanup) {
      if(await m.store.externalEffectFact(request.identity,terminal))return base.stop?base.stop(prepared,receipt,beforeCleanup??(async()=>false)):{closed:false,reason:'Original failed native task has no stop capability'};
      return base.release(prepared,receipt,beforeCleanup);
    },
  };
}
