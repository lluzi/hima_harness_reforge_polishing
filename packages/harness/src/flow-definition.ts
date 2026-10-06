// Versioned Pack data. Runtime identities and durable scheduling are deliberately absent here.
import { z } from 'zod';
import { packId } from './pack-folder.js';
import { taskContract, taskInputBinding, taskOutputBinding, type TaskContract, type TaskInputBinding,
  type TaskLocalSchemas, type TaskOutputBinding, type JsonValue } from './task-contract.js';

export const flowSourceVersion = 'hima-flow/1' as const;
export const flowIRVersion = 'hima-flow-ir/1' as const;
export interface FlowTask {
  readonly kind: 'task'; readonly id: string; readonly tool: string;
  readonly contract: TaskContract; readonly inputs: Readonly<Record<string, TaskInputBinding>>;
  /** Missing optional producer results omit these keys; input schema still validates the value. */
  readonly optionalInputs?: readonly string[];
  /** Closing tasks may consume the original closing reserve; no task extends the hard deadline. */
  readonly budget?: 'work' | 'closing';
}
export interface FlowSequence { readonly kind: 'sequence'; readonly id: string; readonly steps: readonly Flow[] }
export interface FlowChoice {
  readonly kind: 'choice'; readonly id: string; readonly select: TaskOutputBinding;
  readonly cases: Readonly<Record<string, Flow>>;
}
export interface FlowParallel {
  readonly kind: 'parallel'; readonly id: string;
  readonly branches: Readonly<Record<string, { readonly flow: Flow; readonly required: boolean }>>;
  readonly results: Readonly<Record<string, { readonly output: TaskOutputBinding; readonly required: boolean }>>;
}
export interface FlowRepeat {
  readonly kind: 'repeat'; readonly id: string; readonly body: Flow;
  readonly carry: Readonly<Record<string, { readonly initial: TaskInputBinding; readonly next: TaskOutputBinding }>>;
  readonly stop: { readonly output: TaskOutputBinding; readonly equals: string };
  readonly maxIterations: number; readonly budget: 'original-run';
}
export type Flow = FlowTask | FlowSequence | FlowChoice | FlowParallel | FlowRepeat;
export interface FlowExtensionSlot {
  readonly id: string; readonly afterTask: string; readonly fragmentPath: readonly string[];
  readonly returnTo: string;
}
export interface FlowSource {
  readonly schema: typeof flowSourceVersion; readonly id: string; readonly version: string;
  readonly flow: Flow; readonly extensions?: readonly FlowExtensionSlot[];
}
const bindings = z.record(z.string().min(1), taskInputBinding);
export const flowElement: z.ZodType<Flow> = z.lazy(() => z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('task'), id: packId, tool: z.string().min(1), contract: taskContract,
    inputs: bindings, optionalInputs: z.array(z.string().min(1)).optional(), budget: z.enum(['work', 'closing']).optional() }),
  z.strictObject({ kind: z.literal('sequence'), id: packId, steps: z.array(flowElement) }),
  z.strictObject({ kind: z.literal('choice'), id: packId, select: taskOutputBinding, cases: z.record(z.string().min(1), flowElement) }),
  z.strictObject({ kind: z.literal('parallel'), id: packId,
    branches: z.record(packId, z.strictObject({ flow: flowElement, required: z.boolean() })),
    results: z.record(z.string().min(1), z.strictObject({ output: taskOutputBinding, required: z.boolean() })) }),
  z.strictObject({ kind: z.literal('repeat'), id: packId, body: flowElement,
    carry: z.record(z.string().min(1), z.strictObject({ initial: taskInputBinding, next: taskOutputBinding })),
    stop: z.strictObject({ output: taskOutputBinding, equals: z.string().min(1) }),
    maxIterations: z.number().int().positive(), budget: z.literal('original-run') }),
]));
export const flowExtensionSlot = z.strictObject({ id: packId, afterTask: packId,
  fragmentPath: z.array(z.string()), returnTo: packId });
export const flowSource: z.ZodType<FlowSource> = z.strictObject({ schema: z.literal(flowSourceVersion), id: packId,
  version: z.string().min(1), flow: flowElement, extensions: z.array(flowExtensionSlot).optional() });

/** Flat references avoid duplicating shared legacy joins. Every block uses the same five elements. */
export type FlowBlock =
  | { readonly kind: 'task'; readonly id: string; readonly taskId: string }
  | { readonly kind: 'sequence'; readonly id: string; readonly steps: readonly string[] }
  | { readonly kind: 'choice'; readonly id: string; readonly select: TaskOutputBinding; readonly cases: Readonly<Record<string, string>> }
  | { readonly kind: 'parallel'; readonly id: string;
      readonly branches: readonly { readonly name: string; readonly flow: string; readonly required: boolean }[];
      readonly results: Readonly<Record<string, { readonly output: TaskOutputBinding; readonly required: boolean }>> }
  | { readonly kind: 'repeat'; readonly id: string; readonly body: string;
      readonly carry: FlowRepeat['carry']; readonly stop: FlowRepeat['stop']; readonly maxIterations?: number;
      readonly budget: 'original-run';
      /** Revisit exit task -> next body/carry/stop. Only an exit actually committed in this
       * iteration can select an entry; no matching exit means this composition has ended. */
      readonly entries?: Readonly<Record<string, { readonly body: string; readonly carry: FlowRepeat['carry']; readonly stop: FlowRepeat['stop'] }>> };
export interface CompiledTask extends FlowTask {
  /** Whole legacy business declaration, including Reader/rules/chooser/Team/revision references. */
  readonly legacy?: JsonValue;
}
export interface CompiledFlow {
  readonly schema: typeof flowIRVersion; readonly source: 'flow' | 'legacy'; readonly packId: string;
  readonly version: string; readonly entry: string; readonly blocks: Readonly<Record<string, FlowBlock>>;
  readonly tasks: Readonly<Record<string, CompiledTask>>; readonly localSchemas: TaskLocalSchemas;
  /** Declared method tools are data, including tools reserved for an extension. */
  readonly toolIds: readonly string[];
  /** Direct business-data producers only (legacy: named observable predecessors). Revision
   * invalidation also traverses choice selectors, repeat stop/carry and extension/control reachability. */
  readonly dependencies: Readonly<Record<string, readonly string[]>>;
  readonly extensions: readonly FlowExtensionSlot[];
  readonly packSha256: string; readonly irSha256: string;
  /** Immutable method data for adapters, never an executable second scheduler. */
  readonly compatibility?: JsonValue;
}
export interface FrozenFlowFragment {
  readonly slotId: string; readonly returnTo: string; readonly return: TaskOutputBinding;
  readonly flow: CompiledFlow; readonly sha256: string;
}

/** Existing accepted growth proposals freeze through the same composition/task IR. */
export interface FrozenLegacyFlowFragment extends FrozenFlowFragment {
  readonly proposalId: string; readonly requiredOutputs: readonly string[]; readonly optional: boolean;
}

export interface FlowBranch { readonly parallelId: string; readonly branch: string }
/** Preserve the legacy Act pool. Deterministic Judge/Explore/continuation and human responses
 * may consume retained facts during closing, without becoming fresh experiments. */
export function flowTaskCountsExperiment(flow: CompiledFlow, taskId: string): boolean {
  const task = flow.tasks[taskId];
  if (!task) throw new Error(`Unknown frozen task ${taskId}`);
  if (task.tool === 'builtin/human-wait') return false;
  return flow.source === 'legacy' ? (task.legacy as { kind?: string } | undefined)?.kind === 'act' : task.budget !== 'closing';
}
/** Membership comes only from the frozen IR; callers cannot assign a task to another branch. */
export function flowTaskBranches(flow: CompiledFlow, taskId: string): readonly FlowBranch[] {
  let found: readonly FlowBranch[] | undefined;
  const walk = (id: string, branches: readonly FlowBranch[], seen: Set<string>): void => {
    if (seen.has(id)) return;
    const block = flow.blocks[id]; if (!block) throw new Error(`Unknown frozen block ${id}`);
    const next = new Set(seen).add(id);
    if (block.kind === 'task' && block.taskId === taskId) {
      if (found && JSON.stringify(found) !== JSON.stringify(branches)) throw new Error(`Task ${taskId} has ambiguous branch membership`);
      found = branches;
    } else if (block.kind === 'parallel') block.branches.forEach(branch => walk(branch.flow, [...branches, { parallelId: id, branch: branch.name }], next));
    else if (block.kind === 'sequence') block.steps.forEach(child => walk(child, branches, next));
    else if (block.kind === 'choice') Object.values(block.cases).forEach(child => walk(child, branches, next));
    else if (block.kind === 'repeat') {
      walk(block.body, branches, next);
      Object.values(block.entries ?? {}).forEach(entry => walk(entry.body, branches, next));
    }
  };
  walk(flow.entry, [], new Set());
  if (!found) throw new Error(`Task ${taskId} is not reachable in the frozen method`);
  return found;
}
/** Data and control consumers, without treating an independent parallel sibling as a consumer. */
export function flowRevisionConsumers(flow: CompiledFlow, changed: string, fragments: readonly FrozenFlowFragment[] = []): readonly string[] {
  const methods = [flow, ...fragments.map(fragment => fragment.flow)];
  if (!methods.some(method => method.tasks[changed])) throw new Error(`Unknown revision task ${changed}`);
  const dependencies: Record<string, Set<string>> = {};
  for (const method of methods) for (const id of Object.keys(method.tasks)) {
    const sources = dependencies[id] ??= new Set();
    (method.dependencies[id] ?? []).forEach(task => sources.add(task));
  }
  for (const method of methods) {
    const walk = (id: string, controls: Set<string>, seen: Set<string>): Set<string> => {
      if (seen.has(id)) return controls;
      const next = new Set(seen).add(id), block = method.blocks[id]!;
      if (block.kind === 'task') { controls.forEach(task => { if (task !== block.taskId) dependencies[block.taskId]!.add(task); }); return controls; }
      if (block.kind === 'sequence') {
        let current = new Set(controls); for (const step of block.steps) current = walk(step, current, next); return current;
      }
      if (block.kind === 'choice') {
        const gated = new Set(controls).add(block.select.taskId);
        const outcomes = Object.values(block.cases).map(child => walk(child, new Set(gated), next));
        for (const outcome of outcomes) outcome.forEach(task => gated.add(task));
        return gated;
      }
      if (block.kind === 'parallel') {
        const after = new Set(controls);
        for (const branch of block.branches) walk(branch.flow, new Set(controls), next).forEach(task => after.add(task));
        return after;
      }
      const gated = new Set(controls);
      const entries = [{ body: block.body, carry: block.carry, stop: block.stop }, ...Object.values(block.entries ?? {})];
      for (const entry of entries) {
        gated.add(entry.stop.output.taskId);
        for (const carry of Object.values(entry.carry)) {
          gated.add(carry.next.taskId);
          if (carry.initial.source === 'committedOutput' || carry.initial.source === 'artifactRef') gated.add(carry.initial.taskId);
        }
      }
      const outcomes = entries.map(entry => walk(entry.body, new Set(gated), next));
      for (const outcome of outcomes) outcome.forEach(task => gated.add(task));
      return gated;
    };
    const fragment = fragments.find(fragment => fragment.flow === method);
    const slot = fragment && flow.extensions.find(slot => slot.id === fragment.slotId);
    walk(method.entry, new Set(slot ? [slot.afterTask] : []), new Set());
    for (const extension of method.extensions) dependencies[extension.returnTo]?.add(extension.afterTask);
    if (fragment) dependencies[fragment.returnTo]?.add(fragment.return.taskId);
  }
  const affected = new Set([changed]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [task, sources] of Object.entries(dependencies)) if (!affected.has(task) && [...sources].some(source => affected.has(source))) { affected.add(task); grew = true; }
  }
  return [...affected].sort();
}

export interface FlowExtensionScope {readonly producerEffectId:string;readonly slotId:string}
export function flowExtensionKey(scope:FlowExtensionScope):string{return JSON.stringify([scope.producerEffectId,scope.slotId]);}
export interface FlowInvocationPath {
  readonly flowSha256: string; readonly taskId: string;readonly extensions?:readonly FlowExtensionScope[];
  readonly iterations: readonly { readonly repeatId: string; readonly iteration: number }[];
  readonly branches: readonly FlowBranch[];
}
export interface FlowRevisionRule {
  readonly revision: number; readonly changedTask: string; readonly changedEffectId: string;
  readonly selected: FlowInvocationPath; readonly selectedKey: string; readonly input: JsonValue;
  readonly evidence: JsonValue; readonly affected: readonly string[]; readonly invalidatedKeys: readonly string[]; readonly invalidatedEffects: readonly string[];
  readonly preserved: Readonly<Record<string, { readonly version: number; readonly input: JsonValue | null }>>;
  readonly inputPatches?:readonly {readonly taskId:string;readonly fields:Readonly<Record<string,JsonValue>>}[];
}
export function flowInvocationKey(scope: FlowInvocationPath): string {
  // The tuple preserves invocation path ordering and exact original names, without expressions.
  return JSON.stringify([scope.flowSha256, scope.taskId, scope.iterations.map(item => [item.repeatId, item.iteration]), scope.branches.map(item => [item.parallelId, item.branch]),(scope.extensions??[]).map(flowExtensionKey)]);
}
function atOrAfter(scope:FlowInvocationPath,frontier:FlowInvocationPath):boolean {
  for(let index=0;index<Math.min(scope.iterations.length,frontier.iterations.length);index++) {
    const actual=scope.iterations[index]!, selected=frontier.iterations[index]!;
    if(actual.repeatId!==selected.repeatId)break;
    if(actual.iteration!==selected.iteration)return actual.iteration>selected.iteration;
  }
  // Tasks outside the selected loop are filtered by actual/static data and control dependencies;
  // existing prior logical keys have an explicit preserved version and never reach this fallback.
  return true;
}
export function flowInvocationRevision(rules:readonly FlowRevisionRule[],scope:FlowInvocationPath,consumedVersions:readonly number[]=[]):{version:number;input:JsonValue|null} {
  const key=flowInvocationKey(scope);let value:{version:number;input:JsonValue|null}={version:0,input:null};
  for(const rule of rules) {
    if(rule.selectedKey===key)value={version:rule.revision,input:rule.input};
    else if(rule.invalidatedKeys.includes(key))value={version:rule.revision,input:value.input};
    else if(Object.hasOwn(rule.preserved,key))value=consumedVersions.some(version=>version>=rule.revision)?{version:rule.revision,input:value.input}:{...rule.preserved[key]!};
    else if(rule.affected.includes(scope.taskId)&&atOrAfter(scope,rule.selected))value={version:rule.revision,input:value.input};
  }
  return value;
}

export function flowRevisionApplies(rule:FlowRevisionRule,scope:FlowInvocationPath,consumedVersions:readonly number[]):boolean {
  const key=flowInvocationKey(scope);
  if(rule.selectedKey===key||rule.invalidatedKeys.includes(key))return true;
  if(!rule.affected.includes(scope.taskId))return false;
  return Object.hasOwn(rule.preserved,key)?consumedVersions.some(version=>version>=rule.revision):atOrAfter(scope,rule.selected);
}
