// Finite registered DBOS workflows interpret frozen method data. PG retains business facts;
// neither a Ledger projection nor the adapter resolver chooses the next task.
import { DBOS, type WorkflowHandle } from '@dbos-inc/dbos-sdk';
import type { DurableRuntime, DurableWorkflowDefinition } from './durable-runtime.js';
import { flowTaskCountsExperiment, flowInvocationRevision, flowExtensionKey, type FlowRevisionRule, type FlowInvocationPath, type FlowExtensionScope, type CompiledFlow, type CompiledTask, type FlowBranch, type FrozenFlowFragment, type FrozenLegacyFlowFragment } from './flow-definition.js';
import { freezeFlowFragment, freezeLegacyFlowFragment } from './flow-compiler.js';
import { branchContains, jsonDigest, type DurableCommand, type FlowInvocationRecord } from './run-store.js';
import { createTaskResult, validateTaskInput, type JsonValue, type TaskInputBinding, type TaskResult, type TaskDiagnostic, } from './task-contract.js';
import { executeTaskEffect, sendTaskEffectMessage, taskEffectAdapterVersion, taskEffectStep, type TaskEffectAdapter, type TaskEffectRequest, type TaskCollectionPending } from './task-effects.js';

export interface FlowStart {
  readonly runId: string; readonly flow: CompiledFlow;
  readonly runInput: JsonValue; readonly goal: JsonValue; readonly strategy: JsonValue;
}
export interface FlowInvocation {
  readonly iterations: readonly { readonly repeatId: string; readonly iteration: number }[];
  readonly branches: readonly FlowBranch[]; readonly revision: number;readonly extensions:readonly FlowExtensionScope[];
}
export interface FlowAdapterContext {
  readonly runtime: DurableRuntime; readonly flow: CompiledFlow; readonly task: CompiledTask;
  readonly request: TaskEffectRequest; readonly invocation: FlowInvocation;
  readonly committed: Readonly<Record<string, TaskResult>>;
  readonly extensionResults: Readonly<Record<string, JsonValue>>;
  readonly namedResults: Readonly<Record<string, JsonValue>>;
  readonly bindings: { readonly runInput: JsonValue; readonly goal: JsonValue; readonly strategy: JsonValue; readonly carry: Readonly<Record<string, JsonValue>> };
}
export interface FlowWorkflowOptions {
  /** Materialize the existing domain/native adapter. This is composition, never a Step and
   * never permission to schedule another method node. Raw adapter I/O uses taskEffectStep.
   * Receipt materialization availability/diagnostics before throwing the typed recoverable
   * error so restoring files during replay cannot change an earlier operation branch. */
  readonly resolveAdapter: (context: FlowAdapterContext) => Promise<TaskEffectAdapter|TaskCollectionPending>;
}
/** Only retained method/Site availability failures use this recoverable resolver boundary.
 * Actual adapter effects keep their own identity/reconciliation error protocol. */
export class TaskAdapterMaterializationError extends Error {
  constructor(readonly diagnostic: TaskDiagnostic) {
    super(diagnostic.message);
    this.name = 'TaskAdapterMaterializationError';
  }
}
export interface FlowOutcome {
  readonly state: 'succeeded' | 'failed' | 'waiting' | 'cancelled' | 'superseded';
  readonly reason?: string;
  readonly committed: Record<string, TaskResult>;
  readonly extensionResults: Record<string, JsonValue>;
  readonly namedResults: Record<string, JsonValue>;
  readonly terminal: { readonly taskId: string; readonly effectId: string } | null;
  readonly extensionEffects: Record<string,string>;
  readonly controls: string[]; readonly effectVersions: Record<string, number>; readonly taskEffects: Record<string, string>;
  readonly producedTasks:string[];readonly producedExtensions:string[];readonly producedNames:string[];
}
interface Execution extends FlowStart {
  readonly blockId: string; readonly revision: number;
  readonly revisionRules: FlowRevisionRule[];
  readonly iterations: { repeatId: string; iteration: number }[];
  readonly branches: FlowBranch[];readonly extensions:FlowExtensionScope[]; readonly carry: Record<string, JsonValue>;
  readonly committed: Record<string, TaskResult>;
  readonly extensionResults: Record<string, JsonValue>; readonly namedResults: Record<string, JsonValue>;
  readonly extensionEffects: Record<string, string>; readonly carryEffects: Record<string, string>;
  readonly controls: string[]; readonly effectVersions: Record<string, number>; readonly taskEffects: Record<string, string>;
  readonly producedTasks:string[];readonly producedExtensions:string[];readonly producedNames:string[];
  readonly terminal: { taskId: string; effectId: string } | null;
}
interface TaskExecution extends Execution { readonly taskId: string; readonly input: JsonValue }
const names = { root: 'hima.flow', block: 'hima.flow.block', task: 'hima.flow.task', control: 'hima.flow.control', cleanup: 'hima.flow.cleanup', message: 'hima.flow.message', deadline: 'hima.flow.deadline' } as const;
const asJson = (value: unknown): JsonValue => value as JsonValue;
const rootId = (runId: string, revision = 0): string => `hima-flow:${jsonDigest([runId, revision])}`;
const text = (error: unknown): string => error instanceof Error ? error.message : String(error);
function valueAt(value: JsonValue | undefined, path: readonly string[]): JsonValue | undefined {
  let current = value;
  for (const key of path) {
    if (current === null || typeof current !== 'object' || !Object.hasOwn(current, key)) return undefined;
    current = (current as Record<string, JsonValue>)[key];
  }
  return current;
}
function required(value: JsonValue | undefined, description: string): JsonValue {
  if (value === undefined) throw new Error(`Missing committed ${description}`); return value;
}
function output(context: Execution, binding: { taskId: string; path: readonly string[] }): JsonValue | undefined {
  return valueAt(context.committed[binding.taskId]?.value, binding.path);
}
function bind(context: Execution, binding: TaskInputBinding): JsonValue | undefined {
  switch (binding.source) {
    case 'literal': return binding.value;
    case 'runInput': return valueAt(context.runInput, binding.path);
    case 'goal': return valueAt(context.goal, binding.path);
    case 'strategy': return valueAt(context.strategy, binding.path);
    case 'carry': return valueAt(context.carry, binding.path);
    case 'committedOutput': return output(context, binding);
    case 'artifactRef': return context.committed[binding.taskId]?.artifacts.find(artifact => artifact.name === binding.name) as unknown as JsonValue | undefined;
    case 'extensionResult': return valueAt(context.extensionResults[binding.slotId], binding.path);
  }
}
function taskPath(context:Execution,taskId:string):FlowInvocationPath { return {flowSha256:context.flow.irSha256,taskId,iterations:context.iterations,branches:context.branches,extensions:context.extensions}; }
function consumedEffects(context:Execution,taskId:string):string[] {
  const effects=new Set(context.controls), task=context.flow.tasks[taskId]!;
  for(const producer of context.flow.dependencies[taskId]??[])if(context.taskEffects[producer])effects.add(context.taskEffects[producer]!);
  for(const binding of Object.values(task.inputs)) {
    if((binding.source==='committedOutput'||binding.source==='artifactRef')&&context.taskEffects[binding.taskId])effects.add(context.taskEffects[binding.taskId]!);
    else if(binding.source==='carry'&&context.carryEffects[binding.path[0]!])effects.add(context.carryEffects[binding.path[0]!]!);
    else if(binding.source==='extensionResult'&&context.extensionEffects[binding.slotId])effects.add(context.extensionEffects[binding.slotId]!);
  }
  return [...effects].sort();
}
function revisionAt(context:Execution,taskId:string) { return flowInvocationRevision(context.revisionRules,taskPath(context,taskId),consumedEffects(context,taskId).map(effect=>context.effectVersions[effect]??0)); }
function taskInput(context: Execution, task: CompiledTask): JsonValue {
  const override=revisionAt(context,task.id).input;
  let value:JsonValue;
  if(override!==null)value=override;
  else {
    const bound:Record<string,JsonValue>=Object.create(null);
    for(const [key,binding]of Object.entries(task.inputs)){
      const input=bind(context,binding);if(input===undefined&&task.optionalInputs?.includes(key))continue;
      bound[key]=required(input,`input ${task.id}.${key}`);
    }
    value=bound;
  }
  for(const rule of context.revisionRules)if(JSON.stringify(context.iterations)===JSON.stringify(rule.selected.iterations)&&JSON.stringify(context.extensions)===JSON.stringify(rule.selected.extensions??[])) {
    const patch=rule.inputPatches?.find(patch=>patch.taskId===task.id);if(!patch)continue;
    if(value===null||Array.isArray(value)||typeof value!=='object')throw new Error("Revision field patch requires this task's object input schema");
    value={...value,...patch.fields};
  }
  return validateTaskInput(task.contract.input,value,context.flow.localSchemas);
}
const outcome = (context: Execution, state: FlowOutcome['state'] = 'succeeded', reason?: string): FlowOutcome => ({ state,
  ...(reason === undefined ? {} : { reason }), committed: context.committed,
  extensionResults: context.extensionResults, extensionEffects:context.extensionEffects, namedResults: context.namedResults, terminal: context.terminal,
  controls: context.controls, effectVersions: context.effectVersions, taskEffects: context.taskEffects,producedTasks:context.producedTasks,producedExtensions:context.producedExtensions,producedNames:context.producedNames });
function merge(context: Execution, result: FlowOutcome): Execution {
  const committed={...context.committed},taskEffects={...context.taskEffects},extensionResults={...context.extensionResults},extensionEffects={...context.extensionEffects},namedResults={...context.namedResults};
  for(const task of result.producedTasks){if(result.committed[task])committed[task]=result.committed[task]!;else delete committed[task];if(result.taskEffects[task])taskEffects[task]=result.taskEffects[task]!;}
  for(const slot of result.producedExtensions){extensionResults[slot]=result.extensionResults[slot]!;extensionEffects[slot]=result.extensionEffects[slot]!;}
  for(const name of result.producedNames)namedResults[name]=result.namedResults[name]!;
  return {...context,committed,taskEffects,extensionResults,extensionEffects,namedResults,terminal:result.terminal,
    controls:[...new Set([...context.controls,...result.controls])],effectVersions:{...context.effectVersions,...result.effectVersions},
    producedTasks:[...new Set([...context.producedTasks,...result.producedTasks])],producedExtensions:[...new Set([...context.producedExtensions,...result.producedExtensions])],producedNames:[...new Set([...context.producedNames,...result.producedNames])]};
}
async function child(runtime: DurableRuntime, context: Execution, blockId: string): Promise<FlowOutcome> {
  const input = { ...context, blockId,producedTasks:[],producedExtensions:[],producedNames:[] };
  // ID covers immutable inputs and path. Parallel child starts occur in fixed branch order;
  // completion order never changes operation ordering or the next routing decision.
  const id = `hima-block:${jsonDigest(input)}`;
  return await (await runtime.startWorkflow(names.block, id, asJson(input))).getResult() as unknown as FlowOutcome;
}
function adapterContext(runtime: DurableRuntime, context: TaskExecution, request: TaskEffectRequest): FlowAdapterContext {
  return { runtime, flow: context.flow, task: context.flow.tasks[context.taskId]!, request,
    invocation: { iterations: context.iterations, branches: context.branches,extensions:context.extensions, revision: revisionAt(context, context.taskId).version },
    committed: context.committed, extensionResults: context.extensionResults, namedResults: context.namedResults,
    bindings: { runInput: context.runInput, goal: context.goal, strategy: context.strategy, carry: context.carry } };
}
function identity(runtime: DurableRuntime, context: TaskExecution): TaskEffectRequest['identity'] {
  const version = revisionAt(context, context.taskId).version;
  const inputSha256 = jsonDigest(context.input);
  return { runId: context.runId, taskId: context.taskId,
    effectId: `hima-effect:${jsonDigest([context.runId, context.flow.irSha256, context.taskId, context.iterations, context.branches,context.extensions, version, inputSha256])}`,
    inputSha256, packSha256: context.flow.packSha256, irSha256: context.flow.irSha256,
    applicationVersion: runtime.applicationVersion, adapterVersion: taskEffectAdapterVersion };
}
function heldReason(authority: Awaited<ReturnType<DurableRuntime['store']['flowAuthority']>>, context: Execution): string | undefined {
  if (authority.run.hold) return authority.run.hold;
  return authority.branches.find(control => control.hold && branchContains(control.branches, context.branches))?.hold ?? undefined;
}
function budgetCutoff(authority: Awaited<ReturnType<DurableRuntime['store']['flowAuthority']>>): number {
  const data = authority.run.opening.data as { budget?: { closingReserveMs?: number } };
  return Date.parse(authority.run.deadlineAt) - (data.budget?.closingReserveMs ?? 0);
}
// Receipt-derived time and attempt keep replay deterministic. The cap bounds idle receipt
// growth; clamping keeps both cleanup and task waits inside the original absolute deadline.
async function waitForOriginalDeadline(attempt: number, at: number, deadlineAt: number, maximumMs = 5000): Promise<void> {
  await DBOS.sleep(Math.min(maximumMs, 100 * 2 ** Math.min(attempt, 9), Math.max(0, deadlineAt - at)));
}
async function executeTask(runtime: DurableRuntime, input: TaskExecution, options: FlowWorkflowOptions): Promise<FlowOutcome> {
  const fixedIdentity = identity(runtime, input);
  const retained = await runtime.store.recordFlowInvocation({ identity: fixedIdentity,
    version: revisionAt(input,input.taskId).version, branches: input.branches, context: asJson(input),
    consumedEffects:consumedEffects(input,input.taskId),consumedVersions:consumedEffects(input,input.taskId).map(effect=>input.effectVersions[effect]??0) });
  // A valid sibling may be reused after revision. Its first frozen context remains authoritative.
  const original = retained.context as unknown as TaskExecution;
  const committedBefore={...original.committed};delete committedBefore[original.taskId];
  const context:TaskExecution={...original,committed:committedBefore,producedTasks:[original.taskId],taskEffects:{...original.taskEffects,[original.taskId]:fixedIdentity.effectId},effectVersions:{...original.effectVersions,[fixedIdentity.effectId]:retained.version}};
  const task = context.flow.tasks[context.taskId]!;
  let lastReason = 'Waiting for the original task';
  for (let attempt = 0; ; attempt++) {
    const authority = await runtime.store.flowAuthority(context.runId);
    const admission = { runId: context.runId, effectId: fixedIdentity.effectId,
      owner: authority.run.owner, epoch: authority.run.epoch, revision: authority.run.revision };
    const request: TaskEffectRequest = { identity: fixedIdentity, admission, input: context.input,
      contract: task.contract, localSchemas: context.flow.localSchemas };
    const superseded = flowInvocationRevision(authority.revisionRules,taskPath(context,task.id),retained.consumedVersions).version !== retained.version;
    let retainedDelivery=false,collecting=false;
    const extensionStop=context.extensions.map(scope=>authority.extensionDispositions[flowExtensionKey(scope)]).find(Boolean);
    const cancelled = Boolean(extensionStop)||authority.run.cancelled || authority.branches.some(control => control.cancelled && branchContains(control.branches, context.branches));
    if (superseded) return outcome(context, 'superseded', 'This invocation was revised; its immutable history is retained');
    if (cancelled) {
      let stopped = await runtime.store.flowFact(context.runId, `stopped:${fixedIdentity.effectId}`);
      if(!stopped){const closing=await runtime.startWorkflow(names.cleanup,`hima-cancel-close:${jsonDigest(fixedIdentity.effectId)}`,asJson({runId:context.runId,invocation:retained,reason:'cancel'}));await closing.getResult();stopped=await runtime.store.flowFact(context.runId,`stopped:${fixedIdentity.effectId}`);}
      if(stopped){const leases=await taskEffectStep('hima.cancel.remaining-lease',()=>runtime.store.effectResources(fixedIdentity.effectId));if(leases.length&&!leases[0]!.released)await runtime.store.releaseEffectResources(fixedIdentity,{closed:true,unstarted:true});}
      const state = stopped ? 'cancelled' : 'waiting';
      await runtime.store.flowState(context.runId, fixedIdentity.effectId, attempt * 3, { state, reason: stopped ? 'Original task resources are closed' : 'Cancellation requested; original resource closure is unproved' });
      if (stopped || authority.at >= Date.parse(authority.run.deadlineAt)) return outcome(context, state, stopped ? 'Original resources closed' : 'Cancellation requested; closure unknown');
      await waitForOriginalDeadline(attempt, authority.at, Date.parse(authority.run.deadlineAt)); continue;
    }
    const exit=authority.hostExit,dispatched=authority.submittedEffects.includes(fixedIdentity.effectId);
    const held = heldReason(authority, context);
    if ((exit && (!dispatched || exit.mode !== 'drain')) || (held && !dispatched)) {
      await runtime.store.flowState(context.runId, fixedIdentity.effectId, attempt * 3, { state: 'waiting', reason: held ?? 'App exit fences the next business task' });
      if (authority.at >= Date.parse(authority.run.deadlineAt)) return outcome(context, 'waiting', 'Original deadline reached under human hold');
      await waitForOriginalDeadline(attempt, authority.at, Date.parse(authority.run.deadlineAt)); continue;
    }
    const attemptLimit = (authority.run.opening.data as { budget?: { attemptLimit?: number } }).budget?.attemptLimit;
    if (flowTaskCountsExperiment(context.flow, task.id) && attemptLimit !== undefined && authority.dispatchedEffects.length >= attemptLimit && !authority.dispatchedEffects.includes(fixedIdentity.effectId)) {
      await runtime.store.flowState(context.runId, fixedIdentity.effectId, attempt * 3, { state: 'waiting', reason: 'Original Run attempt budget reached' });
      return outcome(context, 'waiting', 'Original Run attempt budget reached; no fresh child budget');
    }
    if (task.tool === 'builtin/human-wait') {
      await runtime.store.prepareEffect(fixedIdentity, { kind: 'human-wait', version: taskEffectAdapterVersion, input: context.input });
      const existing = await runtime.store.effectSnapshot(fixedIdentity);
      if (existing.result) return outcome({ ...context, committed: { ...context.committed, [task.id]: existing.result },terminal:{taskId:task.id,effectId:existing.result.identity.effectId} });
      const response = await runtime.store.flowFact(context.runId, `response:${fixedIdentity.effectId}`);
      if (response) {
        const result = createTaskResult(fixedIdentity, task.contract, response, context.flow.localSchemas);
        await runtime.store.recordEffectFact(fixedIdentity, 'validated-result', asJson(result));
        await runtime.store.reserveEffectResources(fixedIdentity, { siteId: '@human', jobs: 0, licences: {} }, { jobs: 0, licences: {} });
        if (!existing.resourcesReleased) await runtime.store.releaseEffectResources(fixedIdentity, { humanResponse: true, closed: true });
        const committed = await runtime.store.commitResult(result);
        await runtime.store.flowState(context.runId, fixedIdentity.effectId, attempt * 3 + 2, { state: 'succeeded' });
        return outcome({ ...context, committed: { ...context.committed, [task.id]: committed },terminal:{taskId:task.id,effectId:committed.identity.effectId} });
      }
      lastReason = 'Declared business intervention needs a schema-valid response';
      await runtime.store.flowState(context.runId, fixedIdentity.effectId, attempt * 3, { state: 'waiting', reason: lastReason,
        diagnostic: { code: 'human-response', message: lastReason, source: fixedIdentity.effectId } });
    } else {
      let adapter: TaskEffectAdapter | TaskCollectionPending;
      try { adapter = await options.resolveAdapter(adapterContext(runtime, context, request)); }
      catch (error) {
        if (error instanceof TaskAdapterMaterializationError) {
          await runtime.store.flowState(context.runId, fixedIdentity.effectId, attempt * 3, asJson({ state: 'waiting', reason: error.diagnostic.message, diagnostic: error.diagnostic }));
          if (authority.at >= Date.parse(authority.run.deadlineAt)) return outcome(context, 'waiting', error.diagnostic.message);
          await waitForOriginalDeadline(attempt, authority.at, Date.parse(authority.run.deadlineAt));
          continue;
        }
        const reason = text(error);
        await runtime.store.flowState(context.runId, fixedIdentity.effectId, attempt * 3, { state: 'failed', reason });
        return outcome(context, 'failed', reason);
      }
      if('pending' in adapter) {
        await runtime.store.flowState(context.runId,fixedIdentity.effectId,attempt*3,asJson({state:adapter.state,reason:adapter.reason.message,diagnostic:adapter.reason}));
        if(authority.at>=Date.parse(authority.run.deadlineAt))return outcome(context,'waiting',adapter.reason.message);
        await waitForOriginalDeadline(attempt, authority.at, Date.parse(authority.run.deadlineAt));continue;
      }
      if(attempt===0)await runtime.store.flowState(context.runId, fixedIdentity.effectId, attempt * 3 + 1, { state: 'running' });
      const result = await executeTaskEffect(runtime.store, request, adapter);
      await runtime.store.flowState(context.runId, fixedIdentity.effectId, attempt * 3 + 2, asJson(result.state === 'succeeded'
        ? { state: 'succeeded' } : { state: result.state, reason: result.reason.message, diagnostic: result.reason }));
      if (result.state === 'succeeded') return outcome({ ...context, committed: { ...context.committed, [task.id]: result.result },terminal:{taskId:task.id,effectId:result.result.identity.effectId} });
      if (result.state === 'failed') return outcome(context, 'failed', result.reason.message);
      lastReason = result.reason.message;
      retainedDelivery=Boolean(result.retainedResult);collecting=Boolean(result.collecting)||result.reason.code==='reader-rejected';
    }
    const alreadyAdmitted=authority.dispatchedEffects.includes(fixedIdentity.effectId);
    const stoppingAt=flowTaskCountsExperiment(context.flow,task.id)&&!collecting&&!alreadyAdmitted?budgetCutoff(authority):Date.parse(authority.run.deadlineAt);
    if (authority.at >= stoppingAt) {
      // Independent cleanup executes even when the main task is waiting on unknown external work.
      const cleanup = await runtime.startWorkflow(names.cleanup, `hima-close:${jsonDigest([fixedIdentity.effectId, 'deadline'])}`,
        asJson({ runId: context.runId, invocation: retained, reason: 'deadline' }));
      const closure = await cleanup.getResult() as unknown as { closed: boolean; reason?: string };
      if(closure.closed&&retainedDelivery&&authority.at<Date.parse(authority.run.deadlineAt)){await waitForOriginalDeadline(attempt, authority.at, Date.parse(authority.run.deadlineAt));continue;}
      return outcome(context, 'waiting', closure.closed ? `Original budget reached; ${lastReason}` : `Original budget reached; resource closure unknown: ${closure.reason ?? lastReason}`);
    }
    await waitForOriginalDeadline(attempt, authority.at, stoppingAt);
  }
}

async function executeBlock(runtime: DurableRuntime, initial: Execution): Promise<FlowOutcome> {
  let context = initial;
  const block = context.flow.blocks[context.blockId];
  if (!block) throw new Error(`Frozen block ${context.blockId} is missing`);
  if (block.kind === 'task') {
    let input: JsonValue;
    try { input = taskInput(context, context.flow.tasks[block.taskId]!); }
    catch (error) { return outcome(context, 'failed', text(error)); }
    const taskContext: TaskExecution = { ...context, taskId: block.taskId, input };
    const id = identity(runtime, taskContext);
    const result = await (await runtime.startWorkflow(names.task, `hima-task:${jsonDigest(id)}`, asJson(taskContext))).getResult() as unknown as FlowOutcome;
    if (result.state !== 'succeeded') return result;
    context = merge(context, result);
    for (const slot of context.flow.extensions.filter(slot => slot.afterTask === block.taskId)) {
      const proposed = valueAt(context.committed[block.taskId]!.value, slot.fragmentPath);
      if (proposed === undefined || proposed === null) continue;
      try {
        const candidate = proposed as unknown as FrozenFlowFragment;
        let fragment: FrozenFlowFragment;
        if (candidate.flow?.schema === 'hima-flow-ir/1') {
          fragment = freezeLegacyFlowFragment(context.flow, slot.id, candidate);
        } else fragment = freezeFlowFragment(context.flow, slot.id, proposed as unknown as { flow: unknown; return: unknown });
        const frozen = await runtime.store.putFlowFact(context.runId, `fragment:${id.effectId}:${slot.id}`, asJson(fragment)) as unknown as FrozenFlowFragment;
        const result = await child(runtime, { ...context, flow: frozen.flow,extensions:[...context.extensions,{producerEffectId:id.effectId,slotId:slot.id}],controls:[...new Set([...context.controls,id.effectId])] }, frozen.flow.entry);
        if (result.state !== 'succeeded') {
          const optional=(frozen as FrozenLegacyFlowFragment).optional===true;
          if(!optional||!['failed','cancelled'].includes(result.state))return result;
          const disposition=await runtime.store.flowFact(context.runId,`extension-disposition:${flowExtensionKey({producerEffectId:id.effectId,slotId:slot.id})}`) as {disposition?:string;rationale?:string}|null;
          const status=result.state==='failed'?'failed':disposition?.disposition==='abandoned'?'abandoned':'cancelled';
          const negative={proposalId:(frozen as FrozenLegacyFlowFragment).proposalId,status,reason:disposition?.rationale??result.reason??status,results:Object.fromEntries(Object.entries(result.committed).map(([task,result])=>[task,result.value]))};
          await runtime.store.putFlowFact(context.runId,`fragment-outcome:${id.effectId}:${slot.id}`,asJson({...negative,flowState:result.state}));
          context={...merge(context,result),flow:initial.flow,extensionResults:{...context.extensionResults,[slot.id]:asJson(negative)},extensionEffects:{...context.extensionEffects,[slot.id]:result.taskEffects[result.producedTasks.at(-1)??'']??id.effectId},producedExtensions:[...new Set([...context.producedExtensions,slot.id])]};
          continue;
        }
        const returned = required(valueAt(result.committed[frozen.return.taskId]?.value, frozen.return.path), `extension return ${slot.id}`);
        context = { ...merge(context, result), extensionResults: { ...context.extensionResults, [slot.id]: returned },
          extensionEffects:{...context.extensionEffects,[slot.id]:result.committed[frozen.return.taskId]!.identity.effectId},producedExtensions:[...new Set([...context.producedExtensions,slot.id])] };
      } catch (error) { return outcome(context, 'failed', `Extension ${slot.id}: ${text(error)}`); }
    }
    return outcome(context);
  }
  if (block.kind === 'sequence') {
    for (const step of block.steps) {
      const result = await child(runtime, context, step); context = merge(context, result);
      if (result.state !== 'succeeded') return { ...outcome(context, result.state), ...(result.reason ? { reason: result.reason } : {}) };
    }
    return outcome(context);
  }
  if (block.kind === 'choice') {
    const selected = required(output(context, block.select), `choice ${block.id}`);
    if (typeof selected !== 'string' || !Object.hasOwn(block.cases, selected)) return outcome(context, 'failed', `Choice ${block.id} has no declared enum case ${String(selected)}`);
    await runtime.store.putFlowFact(context.runId, `choice:${jsonDigest([context.flow.irSha256, block.id, context.iterations, context.branches, context.revision])}`, { selected });
    return child(runtime, { ...context, controls:[...new Set([...context.controls,context.committed[block.select.taskId]!.identity.effectId])] }, block.cases[selected]!);
  }
  if (block.kind === 'parallel') {
    const handles: { required: boolean; name: string; handle: WorkflowHandle<JsonValue> }[] = [];
    for (const branch of block.branches) {
      const input = { ...context, blockId: branch.flow, branches: [...context.branches, { parallelId: block.id, branch: branch.name }],producedTasks:[],producedExtensions:[],producedNames:[] };
      handles.push({ ...branch, handle: await runtime.startWorkflow(names.block, `hima-block:${jsonDigest(input)}`, asJson(input)) });
    }
    // All branches have been started before any is joined: actual execution overlaps.
    const results = await Promise.all(handles.map(async branch => ({ ...branch, result: await branch.handle.getResult() as unknown as FlowOutcome })));
    for (const branch of results) context = merge(context, branch.result);
    context={...context,terminal:null,controls:[...new Set([...context.controls,...results.filter(branch=>branch.required&&branch.result.terminal).map(branch=>branch.result.terminal!.effectId)])]};
    const requiredFailure = results.find(branch => branch.required && branch.result.state !== 'succeeded');
    if (requiredFailure) return outcome(context, requiredFailure.result.state, `${requiredFailure.name}: ${requiredFailure.result.reason ?? requiredFailure.result.state}`);
    for (const [name, result] of Object.entries(block.results)) {
      const value = output(context, result.output);
      if (value === undefined && result.required) return outcome(context, 'failed', `Required parallel result ${name} is missing`);
      if (value !== undefined) context = { ...context, namedResults: { ...context.namedResults, [name]: value },producedNames:[...new Set([...context.producedNames,name])] };
    }
    return outcome(context);
  }
  let entry = { body: block.body, carry: block.carry, stop: block.stop };
  let carryEffects=Object.fromEntries(Object.entries(entry.carry).flatMap(([key,value])=>value.initial.source==='committedOutput'||value.initial.source==='artifactRef'?[[key,context.taskEffects[value.initial.taskId]!]]:value.initial.source==='carry'&&context.carryEffects[value.initial.path[0]!] ? [[key,context.carryEffects[value.initial.path[0]!]!]]:[]));
  let carry = Object.fromEntries(Object.entries(entry.carry).map(([key, value]) => [key, required(bind(context, value.initial), `initial carry ${key}`)]));
  for (let iteration = 0; ; iteration++) {
    const authority = await runtime.store.flowAuthority(context.runId);
    const budget = (authority.run.opening.data as { budget?: { generationLimit?: number; attemptLimit?: number } }).budget;
    const limit = block.maxIterations ?? budget?.generationLimit;
    if (limit !== undefined && iteration >= limit) return outcome(context, 'failed', 'Declared repeat generation limit reached');
    if (authority.at >= budgetCutoff(authority)) return outcome(context, 'waiting', 'Original Run budget reached before another iteration');
    const before = context.committed;
    const result = await child(runtime, { ...context, carry, carryEffects, iterations: [...context.iterations, { repeatId: block.id, iteration }] }, entry.body);
    context = merge(context, result);
    if (result.state !== 'succeeded') return outcome(context, result.state, result.reason);
    if (block.entries) {
      const selected = Object.keys(block.entries).sort().find(task => context.committed[task] && context.committed[task] !== before[task]
        && context.committed[task]!.identity.effectId !== before[task]?.identity.effectId);
      if (!selected) return outcome(context);
      entry = block.entries[selected]!;
    }
    const stop = required(output(context, entry.stop.output), `repeat stop ${block.id}`);
    const nextCarry = Object.fromEntries(Object.entries(entry.carry).map(([key, value]) => [key, required(output(context, value.next), `next carry ${key}`)]));
    await runtime.store.putFlowFact(context.runId, `repeat:${jsonDigest([context.flow.irSha256, block.id, context.branches, context.iterations, context.revision, iteration])}`, { stop, carry: nextCarry, body: entry.body });
    context={...context,controls:[...new Set([...context.controls,context.committed[entry.stop.output.taskId]!.identity.effectId])]};
    if (stop === entry.stop.equals) return outcome(context);
    carry = nextCarry;
    carryEffects=Object.fromEntries(Object.entries(entry.carry).map(([key,value])=>[key,context.committed[value.next.taskId]!.identity.effectId]));
  }
}

async function cleanupAttempt(runtime: DurableRuntime, input: { runId: string; invocation: FlowInvocationRecord; reason: string; exitRequestId?:string }, options: FlowWorkflowOptions): Promise<JsonValue> {
  if(input.reason==='app-exit') {
    const active=await runtime.store.hostExit();
    if(!input.exitRequestId||active?.requestId!==input.exitRequestId||active.mode!=='stop-jobs')return {closed:false,reason:'App exit stop request is stale or no longer active'};
  }
  const context = input.invocation.context as unknown as TaskExecution;
  const authority = await runtime.store.flowAuthority(input.runId);
  const request: TaskEffectRequest = { identity: input.invocation.identity, input: context.input,
    contract: context.flow.tasks[context.taskId]!.contract, localSchemas: context.flow.localSchemas,
    admission: { runId: input.runId, effectId: input.invocation.identity.effectId, owner: authority.run.owner, epoch: authority.run.epoch, revision: authority.run.revision } };
  const key = `stopped:${request.identity.effectId}`;
  if (await runtime.store.flowFact(input.runId, key)) return { closed: true };
  const effect = await taskEffectStep('hima.control.original-effect', () => runtime.store.effect(request.identity.effectId));
  if (!effect) {
    const held=await taskEffectStep('hima.control.unstarted-derived-resources',async()=>{for(const child of await runtime.store.derivedEffects(request.identity))if((await runtime.store.effectResources(child.identity.effectId)).some(lease=>!lease.released))return true;return false;});
    if(held)return {closed:false,reason:'Registered preparation has original derived work still awaiting actual closure'};
    await runtime.store.confirmFlowStopped(request.identity);return {closed:true};
  }
  const snapshot = await runtime.store.effectSnapshot(request.identity);
  if (snapshot.resourcesReleased) {
    const owned=await taskEffectStep('hima.control.derived-tree',()=>runtime.store.derivedEffects(request.identity));
    const held=await taskEffectStep('hima.control.derived-leases',async()=>{for(const child of owned)if((await runtime.store.effectResources(child.identity.effectId)).some(lease=>!lease.released))return true;return false;});
    if(!held){await runtime.store.confirmFlowStopped(request.identity);return {closed:true};}
  }
  const prepared = snapshot.facts.prepared;
  const dispatched = await taskEffectStep('hima.control.original-dispatch', () => runtime.store.effectDispatchExists(request.identity, 'submit'));
  if (!dispatched) {
    const leases = await taskEffectStep('hima.control.original-leases', () => runtime.store.effectResources(request.identity.effectId));
    if (leases.length && !leases[0]!.released) await runtime.store.releaseEffectResources(request.identity, { closed: true, unstarted: true });
    await runtime.store.confirmFlowStopped(request.identity); return { closed: true };
  }
  if (prepared === undefined) return { closed: false, reason: 'Original dispatch has no retained preparation; reconcile its original identity' };
  let adapter: TaskEffectAdapter | TaskCollectionPending | undefined;
  try { adapter = context.flow.tasks[context.taskId]!.tool === 'builtin/human-wait' ? undefined : await options.resolveAdapter(adapterContext(runtime, context, request)); }
  catch (error) {
    if (error instanceof TaskAdapterMaterializationError) return asJson({ closed: false, reason: error.diagnostic.message, diagnostic: error.diagnostic });
    throw error;
  }
  if(adapter&&'pending' in adapter)return {closed:false,reason:`Original prepared effect awaits its retained adapter: ${adapter.reason.message}`};
  if (!adapter?.stop) return { closed: false, reason: 'Original adapter has no physical stop proof; cancellation remains requested' };
  const result = await taskEffectStep('hima.control.stop-original', async () => {
    if (!await adapter.permit(prepared, 'release')) return { closed: false as const, reason: 'Current Site Permit blocks original cleanup' };
    return adapter.stop!(prepared, snapshot.facts.submitted, (id, value) => runtime.store.claimEffectCleanup(request.identity,
      () => adapter.permit(prepared, 'release'), `stop:${id}`, jsonDigest(value),input.reason==='app-exit'?input.exitRequestId:undefined));
  }).catch(error => ({ closed: false as const, reason: text(error) }));
  if (result.closed) {
    await runtime.store.releaseEffectResources(request.identity, result.proof);
    await runtime.store.confirmFlowStopped(request.identity);
  }
  return asJson(result);
}
async function cleanup(runtime:DurableRuntime,input:Parameters<typeof cleanupAttempt>[1],options:FlowWorkflowOptions):Promise<JsonValue> {
  for(let attempt=0;;attempt++){
    const result=await cleanupAttempt(runtime,input,options) as unknown as {closed:boolean;reason?:string};
    if(input.reason==='app-exit')return asJson(result);
    const authority=await runtime.store.flowAuthority(input.runId);
    if(result.closed||result.reason?.includes('no physical stop')||authority.at>=Date.parse(authority.run.deadlineAt))return asJson(result);
    // Query the original identity while a launch/stop acknowledgement is uncertain. Stable raw
    // cleanup claims prevent resending; this loop owns no business admission or new budget.
    await waitForOriginalDeadline(attempt, authority.at, Date.parse(authority.run.deadlineAt));
  }
}
export interface FlowTaskMessage {
  readonly runId:string;readonly effectId:string;readonly requestId:string;readonly owner:string;
  readonly epoch:number;readonly revision:number;readonly message:string;
}
export function flowWorkflowDefinitions(options: FlowWorkflowOptions): readonly DurableWorkflowDefinition[] {
  return [
    { name:names.message,async execute(runtime,value) {
      const input=value as unknown as FlowTaskMessage;
      const invocation=(await runtime.store.flowInvocations(input.runId)).find(item=>item.identity.effectId===input.effectId);
      if(!invocation)throw new Error('Native message needs its original recorded task invocation');
      const context=invocation.context as unknown as TaskExecution,task=context.flow.tasks[context.taskId]!;
      const request:TaskEffectRequest={identity:invocation.identity,input:context.input,contract:task.contract,localSchemas:context.flow.localSchemas,
        admission:{runId:input.runId,effectId:input.effectId,owner:input.owner,epoch:input.epoch,revision:input.revision}};
      for(let attempt=0;;attempt++) {
        let result:Awaited<ReturnType<typeof sendTaskEffectMessage>>|{state:'failed';reason:TaskDiagnostic};
        try {
          const adapter=await options.resolveAdapter(adapterContext(runtime,context,request));
          result='pending' in adapter ? {state:'waiting',reason:adapter.reason}
            : await sendTaskEffectMessage(runtime.store,request,adapter,input.requestId,input.message);
        } catch(error) {
          result=error instanceof TaskAdapterMaterializationError ? {state:'waiting',reason:error.diagnostic}
            : {state:'failed',reason:{code:'message-failed',message:text(error),source:'task-message'}};
        }
        const authority=await runtime.store.flowAuthority(input.runId);
        const sent=await taskEffectStep('hima.message.dispatch',()=>runtime.store.effectDispatchExists(request.identity,`message:${input.requestId}`));
        if(result.state==='completed'||result.state==='failed'||authority.at>=Date.parse(authority.run.deadlineAt)||!sent&&
          (authority.run.cancelled||authority.run.hold||authority.hostExit||authority.run.owner!==input.owner||authority.run.epoch!==input.epoch||authority.run.revision!==input.revision)) {
          await runtime.store.putFlowFact(input.runId,`task-message-result:${input.requestId}`,asJson(result));
          return asJson(result);
        }
        await waitForOriginalDeadline(attempt,authority.at,Date.parse(authority.run.deadlineAt));
      }
    } },
    { name: names.root, async execute(runtime, value) {
      const input = value as unknown as FlowStart;
      const authority = await runtime.store.flowAuthority(input.runId);
      const context: Execution = { ...input, blockId: input.flow.entry, revision: authority.run.revision,
        revisionRules: authority.revisionRules, iterations: [], branches: [],extensions:[], carry: {}, committed: {}, extensionResults: {}, namedResults: {},
        extensionEffects:{},carryEffects:{},controls:[],effectVersions:{},taskEffects:{},terminal:null,producedTasks:[],producedExtensions:[],producedNames:[] };
      const result = await child(runtime, context, input.flow.entry);
      const after = await runtime.store.flowAuthority(input.runId);
      const final = after.run.cancelled&&result.state==='succeeded'?{...result,state:'cancelled' as const,reason:'Cancellation applied; verified Task results and closure proofs are retained'}:after.run.revision !== context.revision ? { ...result, state: 'superseded' as const, reason: 'A fresh root owns the accepted revision' } : result;
      await runtime.store.putFlowFact(input.runId, `outcome:${context.revision}`, asJson(final));
      return asJson(final);
    } },
    { name: names.block, execute: (runtime, input) => executeBlock(runtime, input as unknown as Execution).then(asJson) },
    { name: names.task, execute: (runtime, input) => executeTask(runtime, input as unknown as TaskExecution, options).then(asJson) },
    {name:names.deadline,async execute(runtime,input):Promise<JsonValue>{
      const runId=(input as {runId:string}).runId;
      for(let attempt=0;;attempt++){
        const snapshot=await runtime.store.flowDeadlineSnapshot(runId);
        const status=await DBOS.getWorkflowStatus(rootId(runId,snapshot.revision));
        if(status&&['SUCCESS','ERROR','CANCELLED'].includes(status.status)&&!snapshot.hasUnreleasedResources)return {closed:true,completedBeforeDeadline:snapshot.at<Date.parse(snapshot.deadlineAt),deadlineAt:snapshot.deadlineAt};
        if(snapshot.at>=Date.parse(snapshot.deadlineAt)){
          const invocations=await runtime.store.flowInvocations(runId),handles:WorkflowHandle<JsonValue>[]=[];
          for(const invocation of invocations)handles.push(await runtime.startWorkflow(names.cleanup,`hima-hard-close:${jsonDigest(invocation.identity.effectId)}`,asJson({runId,invocation,reason:'hard-deadline'})));
          const results=await Promise.all(handles.map(handle=>handle.getResult()));
          await runtime.store.putFlowFact(runId,`hard-deadline-closure:${snapshot.revision}`,{deadlineAt:snapshot.deadlineAt,results});
          return {deadlineAt:snapshot.deadlineAt,cleanup:results};
        }
        // The watchdog retains only original deadline/revision/resource presence, not the
        // immutable opening/IR or complete resource history on each idle observation.
        await waitForOriginalDeadline(attempt, snapshot.at, Date.parse(snapshot.deadlineAt), 30000);
      }
    }},
    { name: names.cleanup, execute: (runtime, input) => cleanup(runtime, input as unknown as Parameters<typeof cleanupAttempt>[1], options) },
    { name: names.control, async execute(runtime, input) {
      const command = input as unknown as DurableCommand;
      const receipt = await runtime.store.command(command);
      const results: JsonValue[] = [];
      if (command.action === 'cancel' || command.action === 'revise') {
        const invocations = await runtime.store.flowInvocations(command.runId);
        const scope = command.scope&&'taskId' in command.scope ? await runtime.store.flowBranchScope(command.runId, command.scope.taskId) : [];
        const extension=command.scope&&'extension' in command.scope?command.scope.extension:undefined;
        const authority = await runtime.store.flowAuthority(command.runId);
        const handles: WorkflowHandle<JsonValue>[] = [];
        for (const invocation of invocations) {
          const context=invocation.context as unknown as TaskExecution;
          const revised = flowInvocationRevision(authority.revisionRules,taskPath(context,context.taskId),invocation.consumedVersions).version !== invocation.version;
          if(command.action==='revise'?!revised:extension?!context.extensions.some(member=>flowExtensionKey(member)===flowExtensionKey(extension)):!branchContains(scope,invocation.branches))continue;
          handles.push(await runtime.startWorkflow(names.cleanup, `hima-cleanup:${jsonDigest([command.runId, command.commandId, invocation.identity.effectId])}`,
            asJson({ runId: command.runId, invocation, reason: command.action })));
        }
        results.push(...await Promise.all(handles.map(handle => handle.getResult())));
      }
      let workflowId: string | null = null;
      if (command.action === 'revise') {
        const definition = await runtime.store.flowFact(command.runId, 'definition');
        workflowId = rootId(command.runId, receipt.revision);
        await scheduleFlowDeadline(runtime,command.runId);
        await runtime.startWorkflow(names.root, workflowId, definition!);
      }
      return { run: asJson(receipt), cleanup: results, notificationOwner: receipt.owner, workflowId };
    } },
  ];
}
/** Consume the existing prepared Run: owner, absolute deadline and budget come only from PG. */
export async function startFlow(runtime: DurableRuntime, input: FlowStart): Promise<WorkflowHandle<JsonValue>> {
  const run = await runtime.store.run(input.runId);
  if (run.applicationVersion !== runtime.applicationVersion) throw new Error('Flow needs its original executable version');
  await runtime.store.putFlowFact(input.runId, 'definition', asJson(input));
  await scheduleFlowDeadline(runtime,input.runId);
  return runtime.startWorkflow(names.root, rootId(input.runId, run.revision), asJson(input));
}
export async function scheduleFlowDeadline(runtime:DurableRuntime,runId:string):Promise<WorkflowHandle<JsonValue>> {
  const run=await runtime.store.run(runId);
  return runtime.startWorkflow(names.deadline,`hima-deadline:${jsonDigest([runId,run.revision])}`,{runId,revision:run.revision});
}
/** A message is a stable external effect on the existing task, never a new task or budget. */
export async function messageFlowTask(runtime:DurableRuntime,input:FlowTaskMessage):Promise<WorkflowHandle<JsonValue>> {
  if(!input.requestId.trim()||!input.message.trim())throw new Error('Native message needs nonempty request identity and business text');
  const key=`task-message:${input.requestId}`,previous=await runtime.store.flowFact(input.runId,key);
  if(previous) {
    if(jsonDigest(previous)!==jsonDigest(input))throw new Error('Native message identity was reused with different input');
  } else {
    const run=await runtime.store.run(input.runId);
    if(run.owner!==input.owner||run.epoch!==input.epoch||run.revision!==input.revision||run.cancelled||run.hold)throw new Error('Native message owner/control is stale or held; refresh current Run facts');
    await runtime.store.putFlowFact(input.runId,key,asJson(input));
  }
  return runtime.startWorkflow(names.message,`hima-message:${jsonDigest([input.runId,input.requestId])}`,asJson(input));
}
export async function controlFlow(runtime: DurableRuntime, command: DurableCommand): Promise<WorkflowHandle<JsonValue>> {
  return runtime.startWorkflow(names.control, `hima-control:${jsonDigest([command.runId, command.commandId, command])}`, asJson(command));
}
export async function readFlow(runtime: DurableRuntime, runId: string) {
  const projection = await runtime.store.flowProjection(runId);
  return { ...projection, ...await runtime.store.flowPhysicalFacts(runId), workflow: await DBOS.getWorkflowStatus(rootId(runId, projection.run.revision)) };
}
