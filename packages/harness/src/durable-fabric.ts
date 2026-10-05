// Product preparation and PG-backed Fabric views; the finite DBOS interpreter alone schedules tasks.
import { DBOS } from '@dbos-inc/dbos-sdk';
import { createHash, randomUUID } from 'node:crypto';
import type { DurableRuntime, DurableWorkflowDefinition } from './durable-runtime.js';
import { durableEngine } from './durable-runtime.js';
import { branchContains, factIdentity, jsonDigest, type DurableRun, type DurableCommand } from './run-store.js';
import { taskEffectAdapterVersion, taskEffectStep } from './task-effects.js';
import type { JsonValue, TaskIdentity } from './task-contract.js';
import { startFlow, scheduleFlowDeadline, controlFlow, readFlow, type FlowStart } from './flow-workflow.js';
import type { DurableProductOpening } from './durable-task-adapters.js';
import { prepareWorkspaceFiles, type WorkspaceFilesResult } from './workspace.js';
import { snapshotPackFolder, packDigestExcludes, viewsOf as packFolderViews } from './pack-folder.js';
import { loadPackFrom, boundInputs, type Pack } from './packs.js';
import { loadSite, pathsOf, type Site } from './sites.js';
import { channelFor } from './channel.js';
import { decideWrite } from './shell.js';
import { budgetStanding } from './budget.js';
import type { RunRecord, NodeExecution } from './ledger.js';
import type { FabricDeps } from './node-turns.js';
import {flowTaskBranches,type FlowBranch} from './flow-definition.js';
import type { ExecutionContext } from './fabric.js';

const json = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue;
export const preparationWorkflowName = 'hima.prepare';
interface ProductRunData {
  readonly run: RunRecord;
  readonly budget: NonNullable<RunRecord['budget']>;
  readonly product: DurableProductOpening;
  readonly inputs?: Readonly<Record<string, string>>;
  readonly start: FlowStart;
  readonly requestDigest: string;
}
const dataOf = (run: DurableRun): ProductRunData => run.opening.data as unknown as ProductRunData;
export type DurableRunView = RunRecord & { readonly engine: typeof durableEngine; readonly goalState: 'met' | 'not-met' | 'unknown'; readonly stopState?: {readonly state:'closing'|'unknown'|'closed';readonly closed:boolean;readonly unclosedResources:number;readonly effectsWithoutStopProof:number} };
export function durableRuntimeOf(deps: FabricDeps): DurableRuntime {
  if (!deps.durable) throw new Error('The local durable runtime is unavailable; reopen the App after PostgreSQL is ready');
  return deps.durable;
}
export async function knownDurableRun(deps: FabricDeps, runId: string): Promise<DurableRun | undefined> {
  if (!deps.durable) {
    if (!deps.ledger.run(runId)) durableRuntimeOf(deps);
    return undefined;
  }
  try { return await deps.durable.store.run(runId); }
  catch (error) { if ((error as Error).message === `Unknown DBOS Run ${runId}`) return undefined; throw error; }
}
/** A DTO from immutable opening and current PG authority. It is never inserted into mutable Ledger. */
export function durableRunView(run: DurableRun, prepared?: WorkspaceFilesResult | null, outcome?: JsonValue | null): DurableRunView {
  const data = dataOf(run);
  const value = outcome as unknown as import('./flow-workflow.js').FlowOutcome | null | undefined;
  const terminal = value?.state === 'succeeded' ? value.terminal : null;
  const result = terminal ? value?.committed[terminal.taskId] : undefined;
  const business = result?.identity.effectId === terminal?.effectId && result?.value !== null && !Array.isArray(result?.value) && typeof result?.value === 'object'
    ? result.value as Record<string,JsonValue> : undefined;
  const goalState = business?.goalMet === true ? 'met' : business?.goalMet === false ? 'not-met' : 'unknown';
  const status: RunRecord['status'] = run.cancelled ? 'waiting' : run.hold || (prepared && !['prepared','reused'].includes(prepared.kind)) || value?.state === 'failed' || value?.state === 'waiting' ? 'waiting'
    : value?.state === 'succeeded' ? goalState === 'met' ? 'ended-goal-met' : business?.outcome === 'converged' ? 'ended-converged' : 'ended-goal-not-met'
    : prepared && ['prepared','reused'].includes(prepared.kind) ? 'running' : undefined;
  return { ...data.run, engine: durableEngine, goalState, ...(status ? { status } : {}), control: { ...data.run.control!, owner: run.owner, epoch: run.epoch, revision: run.revision,
    paused: run.hold ? ['*'] : [] } };
}
/** Project durable human provenance into the existing measurement reader contract. */
export async function readDurableRunView(runtime:DurableRuntime,run:DurableRun,prepared?:WorkspaceFilesResult|null,outcome?:JsonValue|null):Promise<DurableRunView> {
  const view=durableRunView(run,prepared,outcome);
  return {...view,control:{...view.control!,requests:{...view.control!.requests,...await runtime.store.humanRequests(run.runId)}}};
}
export async function durableStartResult(runtime: DurableRuntime, run: DurableRun) {
  const prepared = await runtime.store.flowFact(run.runId,'preparation') as unknown as WorkspaceFilesResult | null;
  const outcome = await runtime.store.flowFact(run.runId,`outcome:${run.revision}`);
  const view = await readDurableRunView(runtime,run,prepared,outcome), workspace = dataOf(run).product.workspace;
  if (!prepared) return { kind: 'preparing' as const, run: view, workspace };
  if (prepared.kind !== 'prepared' && prepared.kind !== 'reused') return { kind: 'unprepared' as const, run: view, prepared };
  return { kind: 'ran' as const, run: view, workspace: prepared.file.workspace };
}
/** Freeze original Run, accepted method, bindings, deadline and model before any Site write. */
export async function openDurableProductRun(deps: FabricDeps, options: {
  readonly pack: Pack; readonly site: Site; readonly effectiveSite: Site; readonly retainedPackDir: string;
  readonly opening: Omit<RunRecord,'id'|'createdAt'|'nextSeq'>; readonly owner: string;
  readonly inputs?: Readonly<Record<string,string>>; readonly requestDigest: string;
}): Promise<DurableRun> {
  const runtime = durableRuntimeOf(deps), modelSelection = deps.durableModelSelection;
  if (!modelSelection?.provider || !modelSelection.model) throw new Error('The Host must freeze its declared model selection before opening a Run');
  if (!options.pack.flow) throw new Error('The accepted Pack has no compiled durable flow');
  const runId = `run-${randomUUID()}`, createdAt = new Date().toISOString();
  const run: RunRecord = { ...options.opening, id: runId, createdAt, nextSeq: 1 };
  const bindings = boundInputs(options.pack,options.effectiveSite);
  const requestedWorkspace=pathsOf(options.site).join(bindings.workspaceRoot!,run.campaignId);
  const workspaceDecision=await decideWrite(options.site,requestedWorkspace,channelFor(options.site));
  const product: DurableProductOpening = { campaignId:run.campaignId, siteId:options.site.name, siteDigest:jsonDigest(json(options.site)),
    workspace:workspaceDecision.ok?workspaceDecision.absPath:requestedWorkspace, bindings,
    method:{packId:options.pack.id,packDigest:options.pack.flow.packSha256,retainedPackDir:options.retainedPackDir},
    parentSessionId:options.owner,...(run.control?.guideSessionId?{guideSessionId:run.control.guideSessionId}:{}),modelSelection };
  const start: FlowStart = {runId,flow:options.pack.flow,runInput:json(bindings),goal:json(run.goal??{}),strategy:json(run.firstStrategy??{})};
  const data: ProductRunData = {run,budget:run.budget!,product,start,requestDigest:options.requestDigest,...(options.inputs?{inputs:options.inputs}:{})};
  const opened=await runtime.store.createRun({runId,inputSha256:jsonDigest(json(data)),applicationVersion:runtime.applicationVersion,owner:options.owner,
    deadlineAt:new Date(Date.parse(createdAt)+run.budget!.timeBoxMs).toISOString(),data:json(data)});
  await scheduleFlowDeadline(runtime,opened.runId);return opened;
}
/** Query proposal before reading today's installed Pack: a confirmation always refers to its original method. */
export async function durableProposalRun(deps: FabricDeps, proposalId: string, requestDigest: string): Promise<DurableRun | undefined> {
  const runtime = durableRuntimeOf(deps);
  const existing = (await runtime.store.runs()).find(run => dataOf(run).run?.proposalId === proposalId);
  if (existing && dataOf(existing).requestDigest !== requestDigest) throw new Error('This Campaign proposal already belongs to different accepted request facts');
  return existing;
}
export function durableStartRequestDigest(req: import('./fabric.js').StartRunRequest): string {
  return jsonDigest(json({pack:req.pack,site:req.site,goal:req.goal,strategy:req.strategy,
    inputs:req.overrides?.inputs??req.inputs,overrides:req.overrides,test:req.test,timeBoxMs:req.timeBoxMs,retryAllowance:req.retryAllowance,generationLimit:req.generationLimit}));
}
export async function startDurablePreparation(runtime: DurableRuntime, runId: string): Promise<void> {
  await runtime.startWorkflow(preparationWorkflowName,`hima-prepare:${runId}`,{runId});
}
/** Recover the fixed preparation identity even if the Host died between PG opening and DBOS start. */
export async function recoverDurablePreparations(runtime:DurableRuntime):Promise<void> {
  for(const run of await runtime.store.runs()) {
    // Historical executable versions are read-only here; U9 owns their explicit active-run boundary.
    if(run.applicationVersion!==runtime.applicationVersion)continue;
    const data=run.opening.data as unknown as Partial<ProductRunData>;
    if(data.product?.method&&data.start?.flow) {await scheduleFlowDeadline(runtime,run.runId);await startDurablePreparation(runtime,run.runId);}
  }
}
/** This finite product workflow composes the existing copier and then the one interpreter. */
export function preparationWorkflowDefinitions(options: { readonly sitesDir: string }): readonly DurableWorkflowDefinition[] {
  return [{name:preparationWorkflowName,async execute(runtime,input):Promise<JsonValue> {
    const runId = (input as {runId:string}).runId, original = await runtime.store.run(runId), data = dataOf(original);
    const identity: TaskIdentity = {runId,taskId:'hima.prepare',effectId:`hima-prepare-effect:${runId}`,inputSha256:original.inputSha256,
      packSha256:data.start.flow.packSha256,irSha256:data.start.flow.irSha256,applicationVersion:original.applicationVersion,adapterVersion:taskEffectAdapterVersion};
    await runtime.store.prepareEffect(identity,json({workspace:data.product.workspace,method:data.product.method,inputs:data.inputs??{}}));
    let prepared:WorkspaceFilesResult;
    let preparationClosed=false;
    for (let attempt=0;;attempt++) {
      const authority=await taskEffectStep('hima.prepare.control-snapshot',async()=>{
        const current=await runtime.store.run(runId);
        return {cancelled:current.cancelled,hold:current.hold,deadlineAt:current.deadlineAt,at:Date.now()};
      });
      if (authority.cancelled || authority.at >= Date.parse(authority.deadlineAt)) return {state:'cancelled',reason:'Preparation stopped under original control/deadline'};
      if (authority.hold) { await DBOS.sleep(Math.min(5000,100*2**Math.min(attempt,6),Math.max(0,Date.parse(authority.deadlineAt)-authority.at)));continue; }
      const result = await taskEffectStep('hima.product.prepare-workspace',async()=>{
        let writeDispatched=false;
        const completed=await runtime.store.externalEffectFact(identity,'preparation-copy-completed');
        if(completed)return {prepared:completed as unknown as WorkspaceFilesResult,closed:true};
        // A killed Step must not convert its original write intent into a clean occupied result.
        const originalWrite=await runtime.store.externalEffectFact(identity,'preparation-write-intent');
        if(originalWrite)return {prepared:{kind:'occupied' as const,workspace:data.product.workspace,reason:'Original preparation write has no completed-copy receipt; retain partial files for reconciliation'},closed:false};
        try {
          const site = loadSite(options.sitesDir,data.product.siteId);
          if (jsonDigest(json(site)) !== data.product.siteDigest) throw new Error('Original Site identity changed before preparation');
          const folder = snapshotPackFolder(data.product.method.retainedPackDir);
          if (folder.digest(packDigestExcludes) !== data.product.method.packDigest) throw new Error('Original retained method bytes changed before preparation');
          const prepared=await prepareWorkspaceFiles({site:data.inputs?{...site,bindings:{...site.bindings,...data.inputs}}:site,folder,campaignId:data.product.campaignId,
            async beforeWrite(target) {
              // Workflow authority follows explicit recorded control; this is not a caller identity refresh.
              for(;;) {
                const current=await runtime.store.run(runId);
                if(current.cancelled||Date.now()>=Date.parse(current.deadlineAt)) throw new Error('Preparation stopped under original control/deadline');
                if(current.hold) { await new Promise(resolve=>setTimeout(resolve,100)); continue; }
                try {
                  await runtime.store.assertEffectAdmission({runId,effectId:identity.effectId,owner:current.owner,epoch:current.epoch,revision:current.revision},async()=>{
                    const fresh=loadSite(options.sitesDir,data.product.siteId);
                    return jsonDigest(json(fresh))===data.product.siteDigest && (await decideWrite(fresh,target,channelFor(fresh))).ok;
                  });
                } catch(error) {
                  // Exit may win after the uncached read. It is a lifetime fence, not an
                  // occupied workspace or terminal preparation outcome. Keep the original Step.
                  if(await runtime.store.hostExit()){await new Promise(resolve=>setTimeout(resolve,100));continue;}
                  throw error;
                }
                await runtime.store.recordExternalEffectFact(identity,'preparation-write-intent',json({workspace:data.product.workspace}));
                writeDispatched=true;
                return;
              }
            }});
          // A normal copier result has no outstanding command. A transport exception after
          // a write was admitted has no such proof, even if the same result label is occupied.
          if(prepared.kind==='prepared'||prepared.kind==='reused')await runtime.store.recordExternalEffectFact(identity,'preparation-copy-completed',json(prepared));
          return {prepared,closed:true};
        } catch(error) {
          return {prepared:{kind:'occupied' as const,workspace:data.product.workspace,reason:`Preparation is incomplete or unavailable: ${(error as Error).message}`},closed:!writeDispatched}; }
      });
      prepared=result.prepared;preparationClosed=result.closed;break;
    }
    await runtime.store.putFlowFact(runId,'preparation',json(prepared));
    if(prepared.kind!=='prepared'&&prepared.kind!=='reused') return {state:'waiting',preparation:json(prepared),preparationClosed};
    if(prepared.file.workspace!==data.product.workspace) throw new Error('Prepared workspace differs from original Run intent');
    await startFlow(runtime,data.start);
    return {state:'prepared',workspace:prepared.file.workspace};
  }},revisionPreparationWorkflowDefinition(options)];
}
export interface DurableExecutionContext extends ExecutionContext {
  readonly run:DurableRunView;
  readonly engine: typeof durableEngine;
  readonly durable: Awaited<ReturnType<typeof readFlow>> & { readonly preparation: WorkspaceFilesResult | null; readonly outcome: JsonValue | null; readonly revisionPreparation: Awaited<ReturnType<typeof DBOS.getWorkflowStatus>>; readonly preparationWorkflow: Awaited<ReturnType<typeof DBOS.getWorkflowStatus>> };
}
const readMethods = new WeakMap<DurableRuntime, Map<string, Pack>>();
/** Read the immutable PG method receipt; this never invokes the adapter's materializing writer. */
export async function readFrozenProductMethod(runtime: DurableRuntime, run: DurableRun): Promise<Pack> {
  const product = dataOf(run).product;
  const id = factIdentity('flow-fact', run.runId, `product-method:${product.method.packDigest}`);
  let cache = readMethods.get(runtime);
  const key = `${product.method.retainedPackDir}:${product.method.packDigest}`;
  const cached = cache?.get(key);
  if (cached) return cached;
  const fact = await runtime.store.fact(id);
  if (!fact) {
    // Before the first task captures its immutable method receipt, preparation owns these bytes.
    const folder = snapshotPackFolder(product.method.retainedPackDir);
    if (folder.digest(packDigestExcludes) !== product.method.packDigest) throw new Error('Original retained method bytes changed');
    const pack=loadPackFrom(folder);
    if (!cache) {cache=new Map();readMethods.set(runtime,cache);}
    cache.set(key,pack);return pack;
  }
  if (fact.runId !== run.runId || fact.kind !== 'flow-fact') throw new Error('Original method receipt source differs');
  const held = fact.payload as unknown as {value:{dir:string;packSha256:string;files:[string,string,number][];directories:string[];entries:string[]}};
  const frozen = held.value;
  if (frozen.dir !== product.method.retainedPackDir || frozen.packSha256 !== product.method.packDigest) throw new Error('Original frozen method has another source identity');
  const files = new Map(frozen.files.map(([name,bytes]) => [name,Buffer.from(bytes,'base64')]));
  const folder=packFolderViews(frozen.dir,files,new Set(frozen.directories),new Set(frozen.entries),new Map(frozen.files.map(([name,,mode])=>[name,mode])));
  if (folder.digest(packDigestExcludes) !== product.method.packDigest) throw new Error('Original frozen method bytes differ from the Run identity');
  const pack=loadPackFrom(folder);
  if (!cache) { cache=new Map();readMethods.set(runtime,cache); }
  cache.set(key,pack);return pack;
}

export async function readDurableExecutionContext(deps: FabricDeps, runId: string): Promise<DurableExecutionContext> {
  const runtime = durableRuntimeOf(deps), flow = await readFlow(runtime,runId);
  const preparationWorkflow = await DBOS.getWorkflowStatus(`hima-prepare:${runId}`);
  const prepared = await runtime.store.flowFact(runId,'preparation') as unknown as WorkspaceFilesResult | null;
  const outcome = await runtime.store.flowFact(runId,`outcome:${flow.run.revision}`);
  let run = await readDurableRunView(runtime,flow.run,prepared,outcome);
  const revisionFact=await runtime.store.flowFact(runId,`revision:${flow.run.revision}`) as {evidence?:JsonValue}|null;
  let revisionPreparation:Awaited<ReturnType<typeof DBOS.getWorkflowStatus>> = null;
  const revisionControl=revisionFact?flow.controls.find(value=>(value as {action?:string;change?:{evidence?:JsonValue}}).action==='revise'&&jsonDigest((value as {change:{evidence:JsonValue}}).change.evidence)===jsonDigest(revisionFact.evidence)):undefined;
  if(revisionControl) {const command=revisionControl as unknown as DurableCommand;const held=await runtime.store.flowFact(runId,`facade-command:${command.commandId}`) as unknown as PreparedFacadeCommand|null;
    if(held?.revision&&jsonDigest(json(held.command))===jsonDigest(revisionControl))revisionPreparation=await DBOS.getWorkflowStatus(`hima-prepare-revision:${jsonDigest([runId,command.commandId,held.requestDigest])}`);}

  const data = dataOf(flow.run), pack = await readFrozenProductMethod(runtime, flow.run);
  const tasks = flow.tasks as unknown as {identity:TaskIdentity;version:number;iterations:{repeatId:string;iteration:number}[];branches:FlowBranch[];valid:boolean;state:{state:string;reason?:string};result:unknown}[];
  if(flow.run.cancelled) {
    const unclosedResources=(flow.resources as unknown as {released:boolean}[]).filter(resource=>!resource.released).length;
    const effectsWithoutStopProof=tasks.filter(task=>(flow.stopped[task.identity.effectId] as {closed?:boolean}|undefined)?.closed!==true).length;
    const preparationOutput=preparationWorkflow?.output as {state?:string;preparationClosed?:boolean}|undefined;
    const preparationClosed=preparationWorkflow?.status==='SUCCESS'&&(preparationOutput?.state!=='waiting'||preparationOutput.preparationClosed===true);
    const revisionClosed=!revisionPreparation||revisionPreparation.status==='SUCCESS'&&(revisionPreparation.output as {preparationClosed?:boolean}|undefined)?.preparationClosed!==false;
    const closed=unclosedResources===0&&effectsWithoutStopProof===0&&preparationClosed&&revisionClosed;
    run={...run,status:closed?'cancelled':'waiting',stopState:{state:closed?'closed':preparationWorkflow?.status==='ERROR'||revisionPreparation?.status==='ERROR'||preparationOutput?.preparationClosed===false||(revisionPreparation?.output as {preparationClosed?:boolean}|undefined)?.preparationClosed===false?'unknown':'closing',closed,unclosedResources,effectsWithoutStopProof}};
  }
  const holds:NonNullable<ExecutionContext['holds']>[number][]=flow.run.hold?[{scope:'*',source:flow.run.holdSource??'unknown'}]:[];
  for(const control of await runtime.store.branchControls(runId))if(control.hold) {
    const scopes=new Set(Object.keys(data.start.flow.tasks).filter(taskId=>branchContains(control.branches,flowTaskBranches(data.start.flow,taskId))));
    for(const task of tasks)if(task.valid&&branchContains(control.branches,task.branches))scopes.add(task.identity.taskId);
    for(const scope of scopes)holds.push({scope,source:control.holdSource??'unknown'});
  }
  if(run.control)run={...run,control:{...run.control,paused:[...new Set(holds.map(hold=>hold.scope))]}};
  const executions:NodeExecution[] = tasks.map(task=>({id:task.identity.effectId,nodeId:task.identity.taskId,kind:pack.graph.nodes.find(node=>node.id===task.identity.taskId)?.kind??'act',methodDigest:task.identity.packSha256,inputDigest:task.identity.inputSha256,phase:task.result?'completed':task.state.state==='failed'?'failed':task.state.state==='unknown'?'uncertain':'begun',attempt:task.version+1,generation:(task.iterations?.at(-1)?.iteration??0)+1,...(task.iterations?.length?{loopId:task.iterations.at(-1)!.repeatId,loopGeneration:task.iterations.at(-1)!.iteration+1}:{})}));
  return {engine:durableEngine,run,nodes:pack.graph.nodes,budget:budgetStanding(run,0),available:[],executions,growths:[],revisions:[],
    holds,
    method:{id:pack.id,version:pack.contract.version,digest:data.product.method.packDigest,dir:pack.dir,contract:pack.contract,reference:pack.graph},
    reason:flow.run.applicationVersion!==runtime.applicationVersion?'This Run requires its original frozen executable version for control/continuation; retained facts remain readable':flow.run.cancelled&&!run.stopState?.closed?'Cancellation accepted; original resource closure is not yet proved':flow.run.hold??(revisionPreparation?.status==='ERROR'?'Admitted revision material preparation failed; inspect its original error':revisionPreparation&&revisionPreparation.status!=='SUCCESS'?'Approved revision material preparation is pending':preparationWorkflow?.status==='ERROR'?'Durable preparation failed; inspect its workflow error':flow.workflow?.status==='ERROR'?'Durable execution failed; inspect its workflow error':!prepared?'Durable workspace preparation is pending':prepared.kind!=='prepared'&&prepared.kind!=='reused'?'Workspace preparation requires attention':undefined),
    durable:{...flow,preparation:prepared,preparationWorkflow,revisionPreparation,outcome}};
}
/** Actor and expected control identity are always supplied by the caller, never silently refreshed. */
export async function controlDurableRun(deps: FabricDeps, command: DurableCommand) {
  const runtime = durableRuntimeOf(deps);
  if(command.action==='handoff' && !deps.host?.get('agents')?.list().some(agent=>String(agent.id)===command.nextOwner)) throw new Error('Handoff target must be a live conversation on this Host');
  const handle=await controlFlow(runtime,command);
  return acknowledgedCommand(runtime,command,handle.workflowID);
}
/** A receipt proves acceptance; resource closure remains a separate PG/DBOS fact. */
async function acknowledgedCommand(runtime:DurableRuntime,command:DurableCommand,workflowId:string) {
  for(;;) {
    const view=await readFlow(runtime,command.runId);
    const recorded=view.controls.find(value=>(value as {commandId?:string}).commandId===command.commandId);
    if(recorded) {
      if(jsonDigest(recorded)!==jsonDigest(json(command)))throw new Error('Command identity was reused with different intent');
      return {commandAccepted:true,run:json(view.run),workflowId,notificationOwner:view.run.owner};
    }
    const status=await DBOS.getWorkflowStatus(workflowId);
    if(status&&['ERROR','CANCELLED','MAX_RECOVERY_ATTEMPTS_EXCEEDED'].includes(status.status))throw new Error(`Control was not admitted: ${String(status.error??status.status)}`);
    await new Promise(resolve=>setTimeout(resolve,20));
  }
}

interface PreparedFacadeCommand {
  readonly requestDigest:string; readonly command:DurableCommand; readonly duplicate?:boolean; readonly observedFailure?:JsonValue;
  readonly revision?:{readonly revisionId:string;readonly changes:readonly import('./workspace.js').WorkspaceRevisionChange[];readonly assets:readonly import('./workspace.js').WorkspaceRevisionAsset[];readonly selected:import('./flow-definition.js').FlowInvocationPath;readonly branches:readonly import('./flow-definition.js').FlowBranch[]};
}
const recordObject=(value:unknown):Record<string,unknown>=>{
  if(!value||Array.isArray(value)||typeof value!=='object')throw new Error('Research intent must be one object');return value as Record<string,unknown>;
};
function unchangedIdentity(raw:Record<string,unknown>,key:string,expected:unknown):unknown {
  if(raw[key]!==undefined&&jsonDigest(json(raw[key]))!==jsonDigest(json(expected)))throw new Error(`Provided ${key} conflicts with the original PG invocation/method facts`);
  return expected;
}
async function selectedInvocation(runtime:DurableRuntime,runId:string,taskId:string,effectId?:string) {
  const projection=await runtime.store.flowProjection(runId);
  const valid=new Set((projection.tasks as unknown as {identity:TaskIdentity;valid:boolean}[]).filter(task=>task.valid).map(task=>task.identity.effectId));
  const candidates=(await runtime.store.flowInvocations(runId)).filter(invocation=>valid.has(invocation.identity.effectId)&&invocation.identity.taskId===taskId&&(!effectId||invocation.identity.effectId===effectId));
  if(candidates.length!==1)throw new Error('Research intent must select the current original executionId/effectId; the task is missing, stale or ambiguous across invocations');
  return candidates[0]!;
}
async function invocationInputFacts(runtime:DurableRuntime,invocation:import('./run-store.js').FlowInvocationRecord) {
  const context=invocation.context as unknown as {committed:Record<string,import('./task-contract.js').TaskResult>};
  const result=[] as import('./run-store.js').DurableFact[];
  for(const effectId of new Set(Object.values(context.committed).map(result=>result.identity.effectId))) {
    const fact=await runtime.store.fact(factIdentity('task-result',effectId));
    if(!fact||fact.runId!==invocation.identity.runId||fact.kind!=='task-result')throw new Error('Original committed input fact is unavailable');
    result.push(fact);
  }
  if(!result.length) {const fact=await runtime.store.fact(factIdentity('flow-fact',invocation.identity.runId,'preparation'));if(fact)result.push(fact);}
  return result;
}
function canonicalInputs(raw:unknown,facts:readonly import('./run-store.js').DurableFact[]) {
  const references=raw===undefined?facts.map(fact=>fact.factId):raw;
  if(!Array.isArray(references)||!references.length)throw new Error('Research intent needs existing committed PG input evidence');
  const inputs=references.map(reference=>{
    const supplied=reference&&typeof reference==='object'&&!Array.isArray(reference)?reference as {recordId:unknown;contentIdentity?:unknown}:undefined;
    const key=supplied?.recordId??reference,fact=facts.find(fact=>typeof key==='number'?fact.seq===key:fact.factId===key);
    if(!fact)throw new Error(`Input ${String(key)} is not an original committed invocation fact`);
    const contentIdentity=jsonDigest(fact.payload);
    if(supplied?.contentIdentity!==undefined&&supplied.contentIdentity!==contentIdentity)throw new Error(`Input ${fact.factId} has another content identity`);
    return {recordId:fact.factId,contentIdentity};
  });
  if(new Set(inputs.map(input=>input.recordId)).size!==inputs.length)throw new Error('Research inputs must cite distinct actual PG facts');
  return inputs;
}
export async function prepareDurableResearchCommand(deps:FabricDeps,req:import('./fabric.js').ExecutionActionRequest):Promise<PreparedFacadeCommand> {
  const runtime=durableRuntimeOf(deps),requestDigest=jsonDigest(json(req)),key=`facade-command:${req.requestId}`;
  const previous=await runtime.store.flowFact(req.runId,key) as unknown as PreparedFacadeCommand|null;
  if(previous){if(previous.requestDigest!==requestDigest)throw new Error('Research request identity was reused with different intent');return previous;}
  const authority=await runtime.store.flowAuthority(req.runId),run=authority.run,data=dataOf(run);
  if(run.owner!==req.actor||run.epoch!==req.expectedEpoch||run.revision!==req.expectedRevision||run.cancelled)throw new Error('Control owner/epoch/revision is stale; refresh this Run');
  if(authority.at>=Date.parse(run.deadlineAt)-(data.budget.closingReserveMs??0))throw new Error('Original Run is closing; new growth/revision is not admitted');
  if(data.budget.attemptLimit!==undefined&&authority.dispatchedEffects.length>=data.budget.attemptLimit)throw new Error('Original Run attempt budget is exhausted; no growth/revision can add a fresh experiment');
  if(req.action==='grow'&&!req.growthDisposition) {
    const intent=recordObject(req.proposal),proposalId=intent.proposalId;
    if(typeof proposalId==='string') {
      const held=await runtime.store.flowFact(req.runId,`growth-proposal:${proposalId}`) as unknown as {intentDigest:string;prepared:PreparedFacadeCommand}|null;
      if(held) {
        const {proposalId:_proposalId,method,parent,inputThroughSeq,inputs,...business}=intent;
        if(held.intentDigest!==jsonDigest(json(business)))throw new Error('Growth proposal identity was reused with different business intent');
        const proposal=recordObject(recordObject(held.prepared.command.change!.evidence).proposal);
        for(const name of ['method','parent','inputThroughSeq'])if(intent[name]!==undefined)unchangedIdentity(intent,name,proposal[name]);
        if(inputs!==undefined) {const facts=await Promise.all((proposal.inputs as {recordId:string}[]).map(input=>runtime.store.fact(input.recordId)));if(facts.some(fact=>!fact))throw new Error('Original growth input facts are unavailable');if(jsonDigest(canonicalInputs(inputs,facts as import('./run-store.js').DurableFact[]))!==jsonDigest(proposal.inputs))throw new Error('Growth proposal inputs conflict with the original accepted identity');}
        const alias={...held.prepared,requestDigest,duplicate:true};await runtime.store.putFlowFact(req.runId,key,json(alias));return alias;
      }
    }
  }
  const folder=snapshotPackFolder(data.product.method.retainedPackDir),pack=loadPackFrom(folder);
  if(folder.digest(packDigestExcludes)!==data.product.method.packDigest)throw new Error('Original retained method bytes changed');
  const base={runId:req.runId,commandId:req.requestId,action:'revise' as const,owner:req.actor,actor:req.actor,origin:req.origin==='human'?'human' as const:'agent' as const,epoch:req.expectedEpoch,revision:req.expectedRevision};
  let prepared:PreparedFacadeCommand;
  if(req.action==='grow') {
    if(req.growthDisposition) {
      if(!req.proposalId)throw new Error('Optional disposition needs its original accepted proposal identity');
      const matches:{producerEffectId:string;slotId:string;outcome:JsonValue|null}[]=[];
      for(const invocation of await runtime.store.flowInvocations(req.runId))for(const slot of data.start.flow.extensions.filter(slot=>slot.afterTask===invocation.identity.taskId)) {
        const fragment=await runtime.store.flowFact(req.runId,`fragment:${invocation.identity.effectId}:${slot.id}`) as {proposalId?:string;optional?:boolean}|null;
        if(fragment?.proposalId===req.proposalId&&fragment.optional&&(!req.executionId||invocation.identity.effectId===req.executionId))matches.push({producerEffectId:invocation.identity.effectId,slotId:slot.id,outcome:await runtime.store.flowFact(req.runId,`fragment-outcome:${invocation.identity.effectId}:${slot.id}`)});
      }
      if(matches.length!==1)throw new Error('Disposition must select one original frozen optional fragment/proposal');
      const selected=matches[0]!,scope={producerEffectId:selected.producerEffectId,slotId:selected.slotId};
      if(req.growthDisposition==='failed'&&(selected.outcome as {status?:string}|null)?.status!=='failed')throw new Error('Failed disposition needs an actual recorded optional fragment failure');
      if(req.growthDisposition!=='failed'&&selected.outcome)throw new Error('That optional fragment already returned with its retained disposition');
      prepared={requestDigest,command:{...base,action:'cancel',scope:{extension:scope},...(req.growthDisposition==='failed'?{}:{disposition:req.growthDisposition}),rationale:req.rationale??`Optional fragment ${req.growthDisposition}`},...(req.growthDisposition==='failed'?{observedFailure:selected.outcome!}:{})};
      await runtime.store.putFlowFact(req.runId,key,json(prepared));return prepared;
    }
    const raw=recordObject(req.proposal),declared=pack.graph.nodes.filter(node=>node.kind==='explore'&&node.parameters.growth);
    if(pack.flow?.source!=='legacy'||declared.length!==1)throw new Error('Grow needs one original declared legacy Explore extension position');
    const taskId=req.nodeId??(raw.parent as {nodeId?:string}|undefined)?.nodeId??declared[0]!.id;
    if(taskId!==declared[0]!.id)throw new Error('Grow must target the original declared Explore position');
    const invocation=await selectedInvocation(runtime,req.runId,taskId,req.executionId),context=invocation.context as unknown as {input:JsonValue;iterations:{iteration:number}[]};
    const facts=await invocationInputFacts(runtime,invocation),boundary=Math.max(...facts.map(fact=>fact.seq));
    const proposal={...raw,proposalId:raw.proposalId??`grow-${jsonDigest([req.runId,req.requestId]).slice(0,24)}`,
      method:unchangedIdentity(raw,'method',{id:pack.id,version:pack.contract.version,digest:data.product.method.packDigest}),
      parent:unchangedIdentity(raw,'parent',{nodeId:taskId,generation:(context.iterations.at(-1)?.iteration??0)+1}),
      inputThroughSeq:unchangedIdentity(raw,'inputThroughSeq',boundary),inputs:canonicalInputs(raw.inputs,facts)};
    const {compileLegacyGrowth}=await import('./flow-compiler.js');const extension=compileLegacyGrowth(pack,proposal);
    prepared={requestDigest,command:{...base,change:{taskId,effectId:invocation.identity.effectId,input:json({...recordObject(context.input),extension}),evidence:json({kind:'legacy-growth',proposal})}}};
  }else {
    prepared=await prepareLegacyRevision(deps,req,pack,run,requestDigest,base);
  }
  await runtime.store.putFlowFact(req.runId,key,json(prepared));
  if(req.action==='grow'&&!req.growthDisposition) {const {proposalId:_proposalId,method,parent,inputThroughSeq,inputs,...business}=recordObject(req.proposal);const proposal=recordObject(recordObject(prepared.command.change!.evidence).proposal);await runtime.store.putFlowFact(req.runId,`growth-proposal:${String(proposal.proposalId)}`,json({intentDigest:jsonDigest(json(business)),prepared}));}
  return prepared;
}

async function prepareLegacyRevision(deps:FabricDeps,req:import('./fabric.js').ExecutionActionRequest,pack:Pack,run:DurableRun,requestDigest:string,base:Omit<DurableCommand,'change'>):Promise<PreparedFacadeCommand> {
  const runtime=durableRuntimeOf(deps),data=dataOf(run),raw=recordObject(req.revision),site=loadSite(deps.sitesDir,data.product.siteId);
  if(jsonDigest(json(site))!==data.product.siteDigest)throw new Error('Original Site/Permit identity changed before revision');
  if(!Array.isArray(raw.changedNodes)||!raw.changedNodes.length||raw.changedNodes.some(id=>typeof id!=='string')||new Set(raw.changedNodes).size!==raw.changedNodes.length)throw new Error('Revision changedNodes must name distinct method tasks');
  const declaredNodes=raw.changedNodes as string[],{revisionImpactOf,revisionDependencyRoots}=await import('./fabric.js');
  if(!Array.isArray(raw.changes)||raw.changes.length>16)throw new Error('Revision changes must be a bounded list of actual code/input edits');
  const originalInvocations=await runtime.store.flowInvocations(req.runId),projection=await runtime.store.flowProjection(req.runId);
  const validIds=new Set((projection.tasks as unknown as {identity:TaskIdentity;valid:boolean}[]).filter(task=>task.valid).map(task=>task.identity.effectId));
  const anchors=originalInvocations.filter(invocation=>validIds.has(invocation.identity.effectId)&&invocation.identity.taskId===declaredNodes[0]&&(!req.executionId||invocation.identity.effectId===req.executionId));
  if(anchors.length>1)throw new Error('Shared revision must select the current original executionId/effectId');
  const anchorContext=anchors[0]?.context as unknown as {carry?:Record<string,JsonValue>;strategy?:JsonValue}|undefined;
  const currentStrategy=recordObject(anchorContext?.carry?.strategy??anchorContext?.strategy??data.start.strategy);
  let revisedStrategy:import('./ledger.js').RunStrategy|undefined;
  if(raw.strategy!==undefined) {
    const {strategyFrom}=await import('./run-arguments.js');const values:Record<string,import('./run-arguments.js').StrategyValue>={};
    for(const [name,value] of Object.entries({...currentStrategy,...recordObject(raw.strategy)})){if(typeof value!=='number'&&typeof value!=='string')throw new Error(`Strategy ${name} must be a declared primitive value`);values[name]=value;}
    const updated=strategyFrom(pack.contract.strategy,values);if('error' in updated)throw new Error(updated.error);revisedStrategy=updated.strategy;
  }
  const workspacePaths=new Map((raw.changes as {nodeId:string;scope:string;path:string}[]).filter(change=>change.scope==='workspace').map(change=>[`${change.nodeId}:${change.path}`,pathsOf(site).join(data.product.workspace,change.path)]));
  const captures:{nodeId:string;path:string}[]=[];
  for(const invocation of originalInvocations.filter(invocation=>validIds.has(invocation.identity.effectId))) for(const entry of await runtime.store.orderedExternalEffectFacts(invocation.identity,'knowledge:')) {
    const fact=entry.fact as {origin?:string;exposedBytes?:number;nodeId?:string;path?:string};if(fact.origin==='input'&&fact.exposedBytes===0&&fact.nodeId&&fact.path)captures.push({nodeId:fact.nodeId,path:fact.path});
  }
  const dependencies=revisionDependencyRoots(pack,currentStrategy as import('./ledger.js').RunStrategy,declaredNodes,raw.changes as import('./fabric.js').RevisionProposal['changes'],revisedStrategy,workspacePaths,captures);
  if(!dependencies.roots)throw new Error(dependencies.reason);
  const changedNodes=dependencies.roots,affected=revisionImpactOf(pack,changedNodes);
  if(raw.affectedNodes!==undefined&&(!Array.isArray(raw.affectedNodes)||raw.affectedNodes.length!==affected.length||affected.some(id=>!(raw.affectedNodes as unknown[]).includes(id))))throw new Error(`affectedNodes must equal the actual declared and recorded dependency closure: ${affected.join(', ')}`);
  const taskId=req.nodeId??declaredNodes[0]!;
  if(!changedNodes.includes(taskId))throw new Error('Revision must select an actual current changed dependency root');
  const selected=await selectedInvocation(runtime,req.runId,taskId,req.executionId),context=selected.context as unknown as {input:JsonValue;iterations:{iteration:number}[];carry:Record<string,JsonValue>;strategy:JsonValue;flow:import('./flow-definition.js').CompiledFlow};
  const facts=await invocationInputFacts(runtime,selected);
  const changes=[] as import('./workspace.js').WorkspaceRevisionChange[];
  const canonicalChanges=[] as Record<string,unknown>[];
  if(!Array.isArray(raw.changes)||raw.changes.length>16)throw new Error('Revision changes must be a bounded list of actual code/input edits');
  for(const item of raw.changes) {
    const change=recordObject(item),nodeId=String(change.nodeId),scope=change.scope,logicalPath=String(change.path);
    if(!changedNodes.includes(nodeId)||!['workspace','workshop'].includes(String(scope)))throw new Error('Each code change must name one declared changed node and actual scope');
    if(!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(logicalPath)||logicalPath.split('/').some(part=>part==='..'||part==='.'||part===''))throw new Error('Revision path must be a normalized relative file');
    if(typeof change.content!=='string'||change.content.length>1024*1024)throw new Error('Revision content must be bounded actual code bytes');
    const invocation=nodeId===taskId?selected:await selectedInvocation(runtime,req.runId,nodeId);
    const node=(invocation.context as unknown as {flow:import('./flow-definition.js').CompiledFlow}).flow.tasks[nodeId]?.legacy as unknown as import('./packs.js').PackNode|undefined;
    if(!node)throw new Error(`Revision node ${nodeId} is not in its frozen original invocation`);
    let sourcePath:string,beforeSha256:string,sourceRecordId:string|undefined;
    if(scope==='workshop') {
      if(node.kind!=='act'||!node.parameters.workshop)throw new Error('Workshop code revision must name its original declared Workshop act');
      const declaration=pack.contract.workshops.find(workshop=>workshop.id===node.parameters.workshop)!;
      const expectedPath=pathsOf(site).join(data.product.workspace,declaration.directory,'.executions',importedSha(invocation.identity.effectId).slice(0,32),logicalPath);
      const sources=[...await runtime.store.orderedExternalEffectFacts(invocation.identity,'code:'),...await runtime.store.orderedExternalEffectFacts(invocation.identity,'revision-source:')].sort((a,b)=>a.seq-b.seq);
      const eligible=sources.flatMap(item=>{const source=item.fact as unknown as {path?:string;nodeId?:string;sha256?:string;asset?:import('./workspace.js').WorkspaceRevisionAsset};
        const code=item.phase.startsWith('revision-source:')?{path:source.path,nodeId:source.nodeId??source.asset?.nodeId,sha256:source.sha256??source.asset?.afterSha256}:source;
        return code.nodeId===nodeId&&code.path===expectedPath?[{...item,fact:json(code)}]:[];});
      const source=change.sourceRecordId===undefined?eligible.at(-1):eligible.find(item=>factIdentity('effect-fact',invocation.identity.effectId,'native:'+item.phase)===change.sourceRecordId);
      if(!source)throw new Error('Workshop revision needs the current source-linked PG Code fact for this original invocation/path');
      const code=source.fact as {path:string;sha256:string};sourcePath=code.path;beforeSha256=code.sha256;
      sourceRecordId=factIdentity('effect-fact',invocation.identity.effectId,'native:'+source.phase);
      const fact=await runtime.store.fact(sourceRecordId);if(!fact)throw new Error('Original PG Code source fact is unavailable');facts.push(fact);
      if(change.fromSha256!==undefined&&change.fromSha256!==beforeSha256)throw new Error('Workshop revision source SHA conflicts with its current PG Code version');
    }else {
      if(logicalPath==='workspace.json'||logicalPath.startsWith('.hima/'))throw new Error('Revision cannot overwrite Harness-owned workspace/revision metadata');
      sourcePath=pathsOf(site).join(data.product.workspace,logicalPath);
      const {decideRead}=await import('./shell.js'),read=await decideRead(site,sourcePath,channelFor(site));if(!read.ok)throw new Error(read.reason);
      beforeSha256=(await import('node:crypto')).createHash('sha256').update(await channelFor(site).readFile(read.absPath)).digest('hex');sourcePath=read.absPath;
      if(change.fromSha256!==undefined&&change.fromSha256!==beforeSha256)throw new Error('Workspace revision source SHA conflicts with its actual before-version');
      if(change.sourceRecordId!==undefined&&!facts.some(fact=>fact.factId===change.sourceRecordId))throw new Error('Workspace revision source record is not original committed input evidence');
    }
    changes.push({nodeId,scope:scope as 'workshop'|'workspace',logicalPath,sourcePath,beforeSha256,content:change.content});
    canonicalChanges.push({...change,fromSha256:beforeSha256,...(sourceRecordId?{sourceRecordId}:{})});
  }
  if(new Set(changes.map(change=>`${change.scope}:${change.logicalPath}`)).size!==changes.length)throw new Error('Revision changes must name distinct scope/node/path identities');
  const revisionId=raw.revisionId??`rev-${jsonDigest([req.runId,req.requestId]).slice(0,24)}`;
  if(typeof revisionId!=='string'||!/^[a-z0-9][a-z0-9-]{0,79}$/.test(revisionId))throw new Error('Revision identity must be a safe stable method-local name');
  if(typeof raw.reason!=='string'||!raw.reason.trim()||raw.reason.length>4000)throw new Error('Revision needs its bounded business reason');
  const nextInput={...recordObject(context.input)};
  if(revisedStrategy) {
    const selectedTask=context.flow.tasks[taskId]!;
    for(const [name,binding] of Object.entries(selectedTask.inputs)) {
      const path=binding.source==='strategy'?binding.path:binding.source==='carry'&&binding.path[0]==='strategy'?binding.path.slice(1):undefined;
      if(path){let value:unknown=revisedStrategy;for(const key of path)value=recordObject(value)[key];nextInput[name]=json(value);}
    }
    nextInput.__strategy=json(revisedStrategy);
  }
  if(!changes.length&&raw.strategy===undefined)throw new Error('Revision must change actual code/input bytes or declared strategy');
  const {verifyWorkspaceRevisionSources}=await import('./workspace.js');await verifyWorkspaceRevisionSources(site,data.product.workspace,revisionId,changes);
  const boundary=facts.length?Math.max(...facts.map(fact=>fact.seq)):0;
  const proposal={...raw,revisionId,reason:raw.reason,changedNodes,affectedNodes:affected,changes:canonicalChanges,
    method:unchangedIdentity(raw,'method',{id:pack.id,version:pack.contract.version,digest:data.product.method.packDigest}),
    inputThroughSeq:unchangedIdentity(raw,'inputThroughSeq',boundary),inputs:canonicalInputs(raw.inputs,facts)};
  const p=pathsOf(site),root=p.join(data.product.workspace,'.hima','revisions',revisionId);
  const assets=changes.map(change=>({nodeId:change.nodeId,scope:change.scope,logicalPath:change.logicalPath,path:change.sourcePath,
    beforeVersionPath:p.join(root,'before',change.logicalPath),afterVersionPath:p.join(root,'after',change.logicalPath),beforeSha256:change.beforeSha256,
    afterSha256:importedSha(change.content),bytes:Buffer.byteLength(change.content,'utf8')}));
  const additionalEffects=[] as {taskId:string;effectId:string}[];
  // Legacy graph edges declare dependency even when a tool reads workspace bytes outside an IR binding.
  // Translate that exact existing closure into actual occurrence roots; never invalidate an unrelated sibling.
  const selectedFrontier=jsonDigest(json([context.iterations,(selected.context as {extensions?:JsonValue}).extensions??[]]));
  for(const root of affected.filter(node=>node!==taskId)) {
    const candidates=originalInvocations.filter(invocation=>{
      const candidate=invocation.context as unknown as {flow:import('./flow-definition.js').CompiledFlow;iterations:JsonValue;extensions?:JsonValue};
      return validIds.has(invocation.identity.effectId)&&invocation.identity.taskId===root&&candidate.flow.irSha256===context.flow.irSha256&&jsonDigest(json([candidate.iterations,candidate.extensions??[]]))===selectedFrontier;
    });
    if(!candidates.length){if(changedNodes.includes(root)&&!revisionImpactOf(pack,[taskId]).includes(root))throw new Error(`Revision dependency root ${root} needs its current original invocation in the selected iteration`);continue;}
    if(candidates.length!==1)throw new Error(`Revision dependency consumer ${root} is ambiguous in the selected iteration`);
    additionalEffects.push({taskId:root,effectId:candidates[0]!.identity.effectId});
  }
  const inputPatches=[] as {taskId:string;fields:Record<string,JsonValue>}[];
  for(const id of affected) {const task=context.flow.tasks[id];if(!task)continue;const fields:Record<string,JsonValue>=revisedStrategy?{__strategy:json(revisedStrategy)}:{};
    if(revisedStrategy)for(const [name,binding] of Object.entries(task.inputs)){const path=binding.source==='strategy'?binding.path:binding.source==='carry'&&binding.path[0]==='strategy'?binding.path.slice(1):undefined;if(path){let value:unknown=revisedStrategy;for(const key of path)value=recordObject(value)[key];fields[name]=json(value);}}inputPatches.push({taskId:id,fields});}
  const workflowId=`hima-prepare-revision:${jsonDigest([req.runId,req.requestId,requestDigest])}`;
  return {requestDigest,command:{...base,action:'revise',change:{taskId,effectId:selected.identity.effectId,input:json(nextInput),...(additionalEffects.length?{additionalEffects}:{}),...(inputPatches.length?{inputPatches}:{}),evidence:json({kind:'legacy-revision',proposal,assets,workflowId,assetReadyFact:`prepared-revision:${req.requestId}`,commandId:req.requestId})}},
    revision:{revisionId,changes,assets,selected:{flowSha256:context.flow.irSha256,taskId,iterations:(selected.context as unknown as {iterations:{repeatId:string;iteration:number}[]}).iterations,branches:selected.branches,extensions:(selected.context as unknown as {extensions?:import('./flow-definition.js').FlowExtensionScope[]}).extensions??[]},branches:selected.branches}};
}
import { createHash as hashRevisionBytes } from 'node:crypto';
const importedSha=(content:string)=>hashRevisionBytes('sha256').update(content).digest('hex');
export async function submitDurableResearchCommand(deps:FabricDeps,prepared:PreparedFacadeCommand) {
  const runtime=durableRuntimeOf(deps);
  if(prepared.observedFailure)return {commandAccepted:false,observedFailure:prepared.observedFailure};
  if(!prepared.revision){const receipt=await controlDurableRun(deps,prepared.command);return {...receipt,...(prepared.duplicate?{duplicate:true}:{})};}
  const workflowId=`hima-prepare-revision:${jsonDigest([prepared.command.runId,prepared.command.commandId,prepared.requestDigest])}`;
  await runtime.startWorkflow('hima.prepare-revision',workflowId,json(prepared));
  return acknowledgedCommand(runtime,prepared.command,workflowId);
}

function revisionPreparationWorkflowDefinition(options:{readonly sitesDir:string}):DurableWorkflowDefinition {
  return {name:'hima.prepare-revision',async execute(runtime,value):Promise<JsonValue> {
    const prepared=value as unknown as PreparedFacadeCommand,command=prepared.command,plan=prepared.revision;
    if(!plan||!command.change)throw new Error('Revision preparation needs its frozen accepted command and byte plan');
    const original=await runtime.store.run(command.runId),data=dataOf(original);
    const identity:TaskIdentity={runId:command.runId,taskId:'hima.prepare-revision',effectId:`hima-revision-effect:${jsonDigest([command.runId,command.commandId])}`,
      inputSha256:prepared.requestDigest,packSha256:data.start.flow.packSha256,irSha256:data.start.flow.irSha256,applicationVersion:original.applicationVersion,adapterVersion:taskEffectAdapterVersion};
    await runtime.store.prepareEffect(identity,json(prepared));
    for(const [index,change] of plan.changes.entries()) {
      const reservation=await taskEffectStep('hima.revision.reserve-original-write',()=>runtime.store.reserveExternalResearchWrite(identity,{
        callId:`revision:${plan.revisionId}:${index}`,nodeId:change.nodeId,attempt:1,sessionId:command.owner,scope:change.scope,path:change.logicalPath,
        requestedBytes:Buffer.byteLength(change.content,'utf8'),contentSha256:importedSha(change.content)}));
      if(!reservation.allowed)throw new Error(reservation.reason);
    }
    // Establish control atomically before Site bytes. The same command later drives cleanup/root launch.
    const receipt=await runtime.store.command(command);
    // Acceptance must independently own cleanup even when subsequent Site material is unavailable.
    const control=await controlFlow(runtime,command);
    let writeAdmitted=false;
    const snapshot=()=>taskEffectStep('hima.revision.preparation-control',async()=>{
      const authority=await runtime.store.currentFlowAuthority(command.runId),current=authority.run;
      const {flowInvocationRevision}=await import('./flow-definition.js'),{branchContains}=await import('./run-store.js');
      const accepted=authority.revisionRules.find(rule=>rule.revision===receipt.revision);
      return {at:Date.now(),deadlineAt:current.deadlineAt,
        stopped:current.cancelled||!accepted||flowInvocationRevision(authority.revisionRules,accepted.selected).version!==receipt.revision,
        hold:!!current.hold||authority.branches.some(member=>(member.hold||member.cancelled)&&branchContains(member.branches,plan.branches)),
        incompleteWrites:!!await runtime.store.externalEffectFact(identity,'revision-retain-intent')&&!await runtime.store.externalEffectFact(identity,'revision-retain-completed')||!!await runtime.store.externalEffectFact(identity,'revision-workspace-intent')&&!await runtime.store.externalEffectFact(identity,'revision-workspace-completed')};
    });
    const wait=async(attempt:number,state:{at:number;deadlineAt:string})=>DBOS.sleep(Math.min(5000,100*2**Math.min(attempt,6),Math.max(0,Date.parse(state.deadlineAt)-state.at)));
    const beforeWrite=(effectId:string)=>async(target:string)=>{
      for(;;) {
        const authority=await runtime.store.currentFlowAuthority(command.runId),current=authority.run;
        const {flowInvocationRevision}=await import('./flow-definition.js'),{branchContains}=await import('./run-store.js');
        const accepted=authority.revisionRules.find(rule=>rule.revision===receipt.revision);
        if(current.cancelled||Date.now()>=Date.parse(current.deadlineAt)||!accepted||flowInvocationRevision(authority.revisionRules,accepted.selected).version!==receipt.revision)throw new Error('Revision preparation stopped under original control/deadline');
        if(current.hold||authority.branches.some(member=>(member.hold||member.cancelled)&&branchContains(member.branches,plan.branches)))throw new Error('Revision preparation is paused before its actual write');
        try {
          await runtime.store.assertEffectAdmission({runId:command.runId,effectId,owner:current.owner,epoch:current.epoch,revision:current.revision},async()=>{
            const fresh=loadSite(options.sitesDir,data.product.siteId);return jsonDigest(json(fresh))===data.product.siteDigest&&(await decideWrite(fresh,target,channelFor(fresh))).ok;
          });
        } catch(error) {
          if(await runtime.store.hostExit()){await new Promise(resolve=>setTimeout(resolve,100));continue;}
          throw error;
        }
        await runtime.store.recordExternalEffectFact(identity,effectId===identity.effectId?'revision-retain-intent':'revision-workspace-intent',json({commandId:command.commandId}));
        writeAdmitted=true;return;
      }
    };

    let assets:import('./workspace.js').WorkspaceRevisionAsset[];
    for(let attempt=0;;attempt++) {
      const state=await snapshot();
      if(state.stopped||state.at>=Date.parse(state.deadlineAt))return {state:'waiting',preparationClosed:!state.incompleteWrites,reason:'Revision material preparation stopped under original control/deadline'};
      if(state.hold){await wait(attempt,state);continue;}
      const retained=await taskEffectStep('hima.revision.retain-immutable-byte-versions',async()=>{
        try {
          const {applyWorkspaceRevision}=await import('./workspace.js'),site=loadSite(options.sitesDir,data.product.siteId);
          if(jsonDigest(json(site))!==data.product.siteDigest)throw new Error('Original Site/Permit identity changed before revision material preparation');
          // This specific operation reconciles exact immutable hashes before each mutation. A
          // partial or different retained file is kept unknown; it is never blindly overwritten.
          const assets=await applyWorkspaceRevision(site,data.product.workspace,plan.revisionId,plan.changes,{retainOnly:true,beforeWrite:beforeWrite(identity.effectId)});
          await runtime.store.recordExternalEffectFact(identity,'revision-retain-completed',json({assetsDigest:jsonDigest(json(assets))}));
          return {assets,writeAdmitted};
        }catch(error){return {reason:(error as Error).message,writeAdmitted};}
      });
      writeAdmitted=retained.writeAdmitted;
      if('assets' in retained&&retained.assets){assets=retained.assets;break;}
      await wait(attempt,state);
    }
    if(jsonDigest(json(assets))!==jsonDigest(json(plan.assets)))throw new Error('Actual retained revision assets differ from their admitted immutable intent');
    let workspaceApplied:JsonValue|null=null;
    if(assets.some(asset=>asset.scope==='workspace')) {
      let parent:import('./run-store.js').FlowInvocationRecord;
      for(let attempt=0;;attempt++) {
        // Store datasource reads are durable operations themselves; compose them outside Steps.
        const authority=await runtime.store.flowAuthority(command.runId);
          const {flowInvocationKey,flowInvocationRevision}=await import('./flow-definition.js');
          const candidates=(await runtime.store.flowInvocations(command.runId)).filter(invocation=>{const context=invocation.context as unknown as {flow:import('./flow-definition.js').CompiledFlow;taskId:string;iterations:import('./flow-definition.js').FlowInvocationPath['iterations']};
            const path={flowSha256:context.flow.irSha256,taskId:context.taskId,iterations:context.iterations,branches:invocation.branches,extensions:(invocation.context as unknown as {extensions?:import('./flow-definition.js').FlowExtensionScope[]}).extensions??[]};return flowInvocationKey(path)===flowInvocationKey(plan.selected)&&invocation.version===receipt.revision&&flowInvocationRevision(authority.revisionRules,path,invocation.consumedVersions).version===invocation.version;});
        const observed={at:authority.at,deadlineAt:authority.run.deadlineAt,stopped:authority.run.cancelled,parent:candidates.length===1?candidates[0]!:null};
        if(observed.stopped||observed.at>=Date.parse(observed.deadlineAt)){const closure=await snapshot();return {state:'waiting',preparationClosed:!closure.incompleteWrites,reason:'Shared input preparation stopped under original control/deadline'};}
        if(observed.parent){parent=observed.parent;break;}await wait(attempt,observed);
      }
      const writer:TaskIdentity={...parent.identity,taskId:'hima.apply-revision-input',effectId:`hima-workspace-revision:${jsonDigest([command.runId,command.commandId])}`,inputSha256:jsonDigest(json(assets))};
      await runtime.store.bindDerivedEffect(parent.identity,writer);await runtime.store.prepareEffect(writer,json({assets,commandDigest:jsonDigest(json(command))}));
      for(let attempt=0;;attempt++) {
        const state=await snapshot();
        if(state.stopped||state.at>=Date.parse(state.deadlineAt))return {state:'waiting',preparationClosed:!state.incompleteWrites,reason:'Shared input application stopped under original control/deadline'};
        if(state.hold){await wait(attempt,state);continue;}
        const applied=await taskEffectStep('hima.revision.apply-shared-input-once',async()=>{
          try {
            const {materializeWorkspaceRevision}=await import('./workspace.js'),site=loadSite(options.sitesDir,data.product.siteId);
            if(jsonDigest(json(site))!==data.product.siteDigest)throw new Error('Original Site/Permit identity changed before shared input application');
            // An absent acknowledgement is reconciled against the exact after hash. This path
            // submits no Job and never repeats a claimed unknown engineering effect.
            await materializeWorkspaceRevision(site,assets,data.product.workspace,{beforeWrite:beforeWrite(writer.effectId)});
            await runtime.store.recordExternalEffectFact(identity,'revision-workspace-completed',json({assetsDigest:jsonDigest(json(assets))}));
            return {proof:json({identity:writer,assets:assets.filter(asset=>asset.scope==='workspace').map(asset=>({path:asset.path,sha256:asset.afterSha256})),closed:true}),writeAdmitted};
          }catch(error){return {reason:(error as Error).message,writeAdmitted};}
        });
        writeAdmitted=applied.writeAdmitted;
        if('proof' in applied&&applied.proof){workspaceApplied=applied.proof;break;}await wait(attempt,state);
      }
      await runtime.store.recordEffectFact(writer,'workspace-input-applied',workspaceApplied);
    }
    await runtime.store.putFlowFact(command.runId,`prepared-revision:${command.commandId}`,json({commandDigest:jsonDigest(json(command)),requestDigest:prepared.requestDigest,taskId:command.change.taskId,effectId:command.change.effectId,selected:plan.selected,assetsDigest:jsonDigest(json(assets)),assets,revision:receipt.revision,workspaceApplied}));
    return {state:'prepared',controlWorkflowId:control.workflowID,revision:receipt.revision};
  }};
}

/** Capture current PG authority once; source I/O never refreshes its actor/control boundary. */
export async function bindDurableKnowledge(deps:FabricDeps,runId:string,owner:string,scope:string) {
  const context=await readDurableExecutionContext(deps,runId),runtime=durableRuntimeOf(deps);
  const {campaignKnowledgeScope}=await import('./workshop.js');
  if(context.run.status!=='running'||context.budget.phase!=='active'||context.budget.attemptLimitSpent) throw new Error('Campaign knowledge evidence requires an active writable Campaign');
  if(context.run.control?.owner!==owner) throw new Error('Campaign knowledge evidence belongs to the current owning Campaign Agent');
  if(!context.run.proposalId||campaignKnowledgeScope(context.run.proposalId)!==scope) throw new Error('current knowledge scope does not belong to this Campaign proposal');
  const projection=await runtime.store.flowProjection(runId);
  const tasks=projection.tasks as unknown as {identity:TaskIdentity;version:number;valid:boolean;iterations:{repeatId:string;iteration:number}[];branches:FlowBranch[];state:{state:string};result:unknown}[];
  const active=tasks.filter(task=>task.valid&&!task.result&&['running','waiting'].includes(task.state.state));
  if(active.length!==1) throw new Error('Campaign knowledge evidence requires exactly one currently admitted node execution');
  const task=active[0]!,loop=task.iterations.at(-1),branch=task.branches.at(-1);
  if(context.holds?.some(hold=>hold.scope==='*'||hold.scope===task.identity.taskId)) throw new Error('Campaign knowledge evidence requires an active writable Campaign');
  const execution:NodeExecution={id:task.identity.effectId,nodeId:task.identity.taskId,kind:context.nodes.find(node=>node.id===task.identity.taskId)?.kind??'act',
    methodDigest:task.identity.packSha256,inputDigest:task.identity.inputSha256,phase:'begun',attempt:task.version+1,generation:(loop?.iteration??0)+1,
    ...(loop?{loopId:loop.repeatId,loopGeneration:loop.iteration+1}:{}),...(branch?{branchId:branch.branch}:{})};
  return {identity:task.identity,execution,scope,admission:{runId,effectId:task.identity.effectId,owner,epoch:context.run.control!.epoch,revision:context.run.control!.revision}};
}
export type DurableKnowledgeBinding=Awaited<ReturnType<typeof bindDurableKnowledge>>;
/** A bounded filesystem operation executes under the same Run lock as its captured control. */
export async function clearDurableKnowledge(deps:FabricDeps,binding:DurableKnowledgeBinding,clear:()=>Promise<boolean>):Promise<boolean> {
  return durableRuntimeOf(deps).store.externalEffectTransaction(binding.identity,{admission:binding.admission,permit:async()=>true,soleCurrentInvocation:true},async()=>clear());
}
export async function recordDurableDocumentKnowledge(deps:FabricDeps,binding:DurableKnowledgeBinding,input:Parameters<typeof import('./workshop.js').prepareDocumentKnowledgeRead>[0],retainedMaterialsDir:string,callId:string) {
  if(!callId) throw new Error('Campaign knowledge evidence requires its actual DSH tool call identity');
  const {prepareDocumentKnowledgeRead}=await import('./workshop.js'),{retainNativeMaterial}=await import('./native-task-adapters.js');
  const prepared=await prepareDocumentKnowledgeRead(input);
  const retainedPath=await retainNativeMaterial(retainedMaterialsDir,prepared.bytes,prepared.data.sha256);
  const data={...prepared.data,retainedPath,generation:binding.execution.generation,
    ...(binding.execution.loopId?{loopId:binding.execution.loopId,loopGeneration:binding.execution.loopGeneration}:{}),toolCallId:callId};
  const phase=`knowledge:document:${jsonDigest([input.sessionId,callId])}`,store=durableRuntimeOf(deps).store;
  await store.externalEffectTransaction(binding.identity,{admission:binding.admission,permit:async()=>true,soleCurrentInvocation:true},async(_run,_facts,record)=>record(phase,json(data)));
  const id=factIdentity('effect-fact',binding.identity.effectId,`native:${phase}`),fact=await store.fact(id);
  if(!fact) throw new Error('Campaign knowledge source fact is unavailable');
  return {hit:prepared.hit,recordId:id};
}
