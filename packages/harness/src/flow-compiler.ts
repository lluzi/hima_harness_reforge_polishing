// Compilation is pure Pack-data work. This module never launches a task or advances a Run.
import { createHash } from 'node:crypto';
import path from 'node:path';
import { flowSource, flowSourceVersion, flowIRVersion, type Flow, type FlowBlock, type FlowSource, type CompiledFlow,
  type CompiledTask, type FlowExtensionSlot, type FrozenFlowFragment, type FrozenLegacyFlowFragment } from './flow-definition.js';
import { compileTaskSchema, taskSchemaDraft, taskContract, taskOutputBinding, type JsonValue, type TaskInputBinding,
  type TaskLocalSchemas, type TaskOutputBinding, type TaskSchema } from './task-contract.js';
import { validateGrowthGraph, type Pack, type PackContract, type PackGraph, type PackNode, type RunGraph } from './packs.js';
import type { PackFolderSnapshot } from './pack-folder.js';
import { packDigestExcludes, packFilePath } from './pack-folder.js';

export class FlowCompileError extends Error {
  readonly path: string;
  constructor(at: string, message: string) {
    super(`graph.yml ${at}: ${message}`); this.name = 'FlowCompileError'; this.path = at;
  }
}
const fail: (at: string, message: string) => never = (at, message) => { throw new FlowCompileError(at, message); };
/** Object-key order is irrelevant; declared sequence order remains significant. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, child]) => child !== undefined)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(',')}}`;
  return JSON.stringify(value);
}
const digest = (value: unknown): string => createHash('sha256').update(canonical(value)).digest('hex');
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function finish(data: Omit<CompiledFlow, 'irSha256'>): CompiledFlow {
  const copy = structuredClone(data); return freeze({ ...copy, irSha256: digest(copy) });
}

// Visit only schema locations: '$ref' inside an example is business data, not a file request.
const schemaMaps = ['$defs', 'definitions', 'properties', 'patternProperties', 'dependentSchemas'];
const schemaSingles = ['items', 'contains', 'additionalProperties', 'unevaluatedProperties', 'unevaluatedItems', 'propertyNames', 'not', 'if', 'then', 'else'];
const schemaLists = ['allOf', 'anyOf', 'oneOf', 'prefixItems'];
function visitSchema(schema: unknown, visit: (schema: Record<string, JsonValue>) => void): void {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return;
  const object = schema as Record<string, JsonValue>; visit(object);
  for (const key of schemaMaps) { const map = object[key]; if (map && typeof map === 'object' && !Array.isArray(map)) Object.values(map).forEach(child => visitSchema(child, visit)); }
  schemaSingles.forEach(key => visitSchema(object[key], visit));
  schemaLists.forEach(key => { const list = object[key]; if (Array.isArray(list)) list.forEach(child => visitSchema(child, visit)); });
}
function localRef(ref: string, at: string, owner = ''): string | undefined {
  if (ref.startsWith('#')) return undefined;
  const file = ref.split('#')[0]!;
  if (!packFilePath.safeParse(file).success || file.includes(':') || file.split('/').some(part => part === '..' || part === '.')) {
    return fail(at, `replace schema reference ${ref} with a Pack-local schema file or # fragment`);
  }
  return owner ? path.posix.join(path.posix.dirname(owner), file) : file;
}
/** Resolve bytes from the loader's single snapshot; never request a network or today's disk. */
export function flowLocalSchemas(source: FlowSource, folder: PackFolderSnapshot): TaskLocalSchemas {
  const locals: Record<string, Record<string, JsonValue>> = {};
  const collect = (schema: unknown, owner = ''): void => visitSchema(schema, object => {
    for (const key of ['$ref', '$dynamicRef']) {
      const ref = object[key]; if (typeof ref !== 'string') continue;
      const file = localRef(ref, `/schema/${key}`, owner); if (!file || Object.hasOwn(locals, file)) continue;
      const text = folder.text(file); if (text === undefined) fail(`/schema/${key}`, `schema ${file} is absent; add it inside this Pack`);
      let parsed: unknown; try { parsed = JSON.parse(text!); } catch { fail(`/schema/${key}`, `schema ${file} must contain JSON Schema 2020-12 JSON`); }
      const held = taskContract.shape.input.shape.schema.safeParse(parsed);
      if (!held.success) fail(`/schema/${key}`, `schema ${file} must be a JSON object`);
      locals[file] = held.data; collect(held.data, file);
    }
  });
  const walk = (flow: Flow): void => {
    if (flow.kind === 'task') { collect(flow.contract.input.schema); collect(flow.contract.output.schema); }
    else if (flow.kind === 'sequence') flow.steps.forEach(walk);
    else if (flow.kind === 'choice') Object.values(flow.cases).forEach(walk);
    else if (flow.kind === 'parallel') Object.values(flow.branches).forEach(branch => walk(branch.flow));
    else walk(flow.body);
  };
  walk(source.flow); return locals;
}
function checkSchema(locals: TaskLocalSchemas, declaration: TaskSchema, at: string): void {
  try { compileTaskSchema(declaration, locals); } catch (error) { fail(at, `correct schema or supply its Pack-local reference: ${(error as Error).message}`); }
}
// Routing requires a named enum. This resolves local references and properties, not general types.
function enumAt(schema: Record<string, JsonValue>, fieldPath: readonly string[], locals: TaskLocalSchemas): readonly string[] | undefined {
  let current: unknown = schema;
  let document: unknown = schema;
  let owner = '';
  const seen = new Set<unknown>();
  const resolve = (): boolean => {
    while (current && typeof current === 'object' && !Array.isArray(current) && typeof (current as Record<string, unknown>).$ref === 'string') {
      if (seen.has(current)) return false; seen.add(current);
      const ref = (current as Record<string, string>).$ref!;
      const [file, fragment] = ref.split('#');
      if (file) { owner = localRef(ref, '/schema/$ref', owner)!; document = locals[owner]; }
      current = document;
      if (fragment) {
        if (!fragment.startsWith('/')) return false;
        for (const key of fragment.slice(1).split('/').map(key => key.replaceAll('~1', '/').replaceAll('~0', '~'))) {
          current = current && typeof current === 'object' ? (current as Record<string, unknown>)[key] : undefined;
        }
      }
    }
    return current !== undefined;
  };
  for (const key of fieldPath) {
    if (!resolve()) return undefined;
    const properties = current && typeof current === 'object' ? (current as Record<string, unknown>).properties : undefined;
    current = properties && typeof properties === 'object' ? (properties as Record<string, unknown>)[key] : undefined;
  }
  if (!resolve()) return undefined;
  const values = current && typeof current === 'object' ? (current as Record<string, unknown>).enum : undefined;
  return Array.isArray(values) && values.length > 0 && values.every(value => typeof value === 'string') ? values as string[] : undefined;
}
interface Availability { readonly all: Set<string>; readonly required: Set<string> }
const copied = (value: Availability): Availability => ({ all: new Set(value.all), required: new Set(value.required) });
export interface CompileFlowOptions { readonly packSha256: string; readonly localSchemas?: TaskLocalSchemas; readonly tools?: readonly string[] }

/** Proves named sources and control reachability. Business data/type validity is checked at handoff. */
export function compileFlow(source: unknown, options: CompileFlowOptions): CompiledFlow {
  const parsed = flowSource.safeParse(source);
  if (!parsed.success) fail(`/${parsed.error.issues[0]?.path.join('/') ?? ''}`, `${parsed.error.issues[0]?.message}; correct this flow declaration`);
  return compileSource(parsed.data, options);
}
function compileSource(source: FlowSource, options: CompileFlowOptions, external: Readonly<Record<string, CompiledTask>> = {}, initial: Availability = { all: new Set(), required: new Set() }, initialCarry: ReadonlySet<string> = new Set()): CompiledFlow {
  const locals = options.localSchemas ?? {};
  const blocks: Record<string, FlowBlock> = {};
  const tasks: Record<string, CompiledTask> = {};
  const dependencies: Record<string, string[]> = {};
  const names = new Set(Object.keys(external));
  const declare = (flow: Flow, at: string): void => {
    if (names.has(flow.id)) fail(`${at}/id`, `duplicate ID ${flow.id}; give each task and composition one unique ID`);
    names.add(flow.id);
    if (flow.kind === 'task') {
      taskContract.parse(flow.contract);
      checkSchema(locals, flow.contract.input, `${at}/contract/input`); checkSchema(locals, flow.contract.output, `${at}/contract/output`);
      if (options.tools && !options.tools.includes(flow.tool) && flow.tool !== 'builtin/human-wait') fail(`${at}/tool`, `declare tool ${flow.tool} in contract.yml tools`);
      for (const key of flow.optionalInputs ?? []) if (!Object.hasOwn(flow.inputs, key)) fail(`${at}/optionalInputs`, `optional input ${key} has no binding; add it to inputs`);
      tasks[flow.id] = flow; dependencies[flow.id] = [];
    } else if (flow.kind === 'sequence') flow.steps.forEach((step, index) => declare(step, `${at}/steps/${index}`));
    else if (flow.kind === 'choice') Object.entries(flow.cases).forEach(([name, step]) => declare(step, `${at}/cases/${name}`));
    else if (flow.kind === 'parallel') Object.entries(flow.branches).forEach(([name, branch]) => declare(branch.flow, `${at}/branches/${name}/flow`));
    else declare(flow.body, `${at}/body`);
  };
  declare(source.flow, '/flow');
  const reference = (binding: TaskOutputBinding, available: Availability, at: string, optional = false): CompiledTask => {
    const producer = tasks[binding.taskId] ?? external[binding.taskId];
    if (!producer) return fail(at, `unknown task ${binding.taskId}; name a declared producer`);
    if (!available.all.has(binding.taskId)) fail(at, `task ${binding.taskId} is not a committed predecessor here; move the consumer after it`);
    if (!optional && !available.required.has(binding.taskId)) fail(at, `task ${binding.taskId} may be absent; consume it through an optional input or require its parallel branch`);
    return producer;
  };
  const input = (binding: TaskInputBinding, available: Availability, at: string, consumer?: string, optional = false, carryScope: ReadonlySet<string> = new Set()): void => {
    if (binding.source === 'extensionResult') {
      const slot = source.extensions?.find(slot => slot.id === binding.slotId);
      if (!slot) fail(at, `unknown extension slot ${binding.slotId}; declare its producer and return task`);
      if (consumer !== slot.returnTo) fail(at, `consume extension ${slot.id} at its declared return task ${slot.returnTo}`);
      reference({ taskId: slot.afterTask, path: [] }, available, at, optional);
      if (consumer && !dependencies[consumer]!.includes(slot.afterTask)) dependencies[consumer]!.push(slot.afterTask);
    }
    if (binding.source === 'carry' && (!binding.path.length || !carryScope.has(binding.path[0]!))) fail(at, 'name a carry key declared by the enclosing repeat; carry is available only inside its body');
    if (binding.source === 'committedOutput' || binding.source === 'artifactRef') {
      reference({ taskId: binding.taskId, path: binding.source === 'artifactRef' ? [] : binding.path }, available, at, optional);
      if (consumer && !dependencies[consumer]!.includes(binding.taskId)) dependencies[consumer]!.push(binding.taskId);
    }
  };
  const selector = (binding: TaskOutputBinding, available: Availability, at: string): readonly string[] => {
    const producer = reference(binding, available, at);
    return enumAt(producer.contract.output.schema, binding.path, locals) ?? fail(at, 'route on a declared, committed string enum field; add enum to the producer output schema');
  };
  const walk = (flow: Flow, before: Availability, at: string, carryScope: ReadonlySet<string> = new Set()): Availability => {
    const available = copied(before);
    if (flow.kind === 'task') {
      for (const [key, binding] of Object.entries(flow.inputs)) input(binding, available, `${at}/inputs/${key}`, flow.id, flow.optionalInputs?.includes(key), carryScope);
      available.all.add(flow.id); available.required.add(flow.id);
      blocks[flow.id] = { kind: 'task', id: flow.id, taskId: flow.id }; return available;
    }
    if (flow.kind === 'sequence') {
      let next = available; flow.steps.forEach((step, index) => { next = walk(step, next, `${at}/steps/${index}`, carryScope); });
      blocks[flow.id] = { kind: 'sequence', id: flow.id, steps: flow.steps.map(step => step.id) }; return next;
    }
    if (flow.kind === 'choice') {
      const values = selector(flow.select, available, `${at}/select`);
      if (canonical([...values].sort()) !== canonical(Object.keys(flow.cases).sort())) fail(`${at}/cases`, `map every enum case exactly once: ${values.join(', ')}`);
      const outcomes = Object.entries(flow.cases).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([name, step]) => walk(step, available, `${at}/cases/${name}`, carryScope));
      blocks[flow.id] = { kind: 'choice', id: flow.id, select: flow.select, cases: Object.fromEntries(Object.entries(flow.cases).map(([name, step]) => [name, step.id])) };
      return { all: new Set(outcomes.flatMap(result => [...result.all])), required: new Set([...outcomes[0]!.required].filter(id => outcomes.every(result => result.required.has(id)))) };
    }
    if (flow.kind === 'parallel') {
      if (!Object.keys(flow.branches).length) fail(`${at}/branches`, 'declare at least one named parallel branch');
      const outcomes = Object.entries(flow.branches).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([name, branch]) => ({ name, branch, outcome: walk(branch.flow, available, `${at}/branches/${name}/flow`, carryScope) }));
      for (const { branch, outcome } of outcomes) {
        outcome.all.forEach(id => available.all.add(id));
        if (branch.required) outcome.required.forEach(id => available.required.add(id));
      }
      for (const [name, result] of Object.entries(flow.results)) reference(result.output, available, `${at}/results/${name}/output`, !result.required);
      blocks[flow.id] = { kind: 'parallel', id: flow.id, branches: outcomes.map(({ name, branch }) => ({ name, required: branch.required, flow: branch.flow.id })), results: flow.results };
      return available;
    }
    for (const [key, carry] of Object.entries(flow.carry)) input(carry.initial, available, `${at}/carry/${key}/initial`, undefined, false, carryScope);
    const after = walk(flow.body, available, `${at}/body`, new Set(Object.keys(flow.carry)));
    const bodyTasks = blockTaskIds(blocks, flow.body.id);
    if (!bodyTasks.has(flow.stop.output.taskId)) fail(`${at}/stop/output`, 'stop must read a task committed by this repeat body');
    for (const [key, carry] of Object.entries(flow.carry)) if (!bodyTasks.has(carry.next.taskId)) fail(`${at}/carry/${key}/next`, 'next carry must read a task committed by this repeat body');
    const stopCases = selector(flow.stop.output, after, `${at}/stop/output`);
    if (!stopCases.includes(flow.stop.equals)) fail(`${at}/stop/equals`, `choose one of the committed enum values ${stopCases.join(', ')}`);
    for (const [key, carry] of Object.entries(flow.carry)) reference(carry.next, after, `${at}/carry/${key}/next`);
    blocks[flow.id] = { kind: 'repeat', id: flow.id, body: flow.body.id, carry: flow.carry, stop: flow.stop, maxIterations: flow.maxIterations, budget: flow.budget };
    return after;
  };
  walk(source.flow, initial, '/flow', initialCarry);
  const extensions = source.extensions ?? [];
  const slotNames = new Set<string>();
  for (const [index, slot] of extensions.entries()) {
    const at = `/extensions/${index}`;
    if (slotNames.has(slot.id) || names.has(slot.id)) fail(`${at}/id`, `duplicate extension ID ${slot.id}; use a unique slot ID`);
    slotNames.add(slot.id);
    if (!tasks[slot.afterTask]) fail(`${at}/afterTask`, 'name a task that produces the diagnostic fragment');
    if (!tasks[slot.returnTo]) fail(`${at}/returnTo`, 'name a declared return task');
    if (!precedes(blocks, source.flow.id, slot.afterTask, slot.returnTo)) fail(`${at}/returnTo`, 'return must be a later task in this flow; place the slot before its consumer');
  }
  return finish({ schema: flowIRVersion, source: 'flow', packId: source.id, version: source.version,
    entry: source.flow.id, blocks, tasks, localSchemas: locals, toolIds: options.tools ?? [...new Set(Object.values(tasks).map(task => task.tool))].sort(), dependencies, extensions,
    packSha256: options.packSha256 });
}
function blockTaskIds(blocks: Readonly<Record<string, FlowBlock>>, entry: string, seen = new Set<string>()): Set<string> {
  if (seen.has(entry)) return new Set(); seen.add(entry);
  const block = blocks[entry]; if (!block) return new Set();
  if (block.kind === 'task') return new Set([block.taskId]);
  const children = block.kind === 'sequence' ? block.steps : block.kind === 'choice' ? Object.values(block.cases)
    : block.kind === 'parallel' ? block.branches.map(branch => branch.flow) : [block.body];
  return new Set(children.flatMap(child => [...blockTaskIds(blocks, child, seen)]));
}
function precedes(blocks: Readonly<Record<string, FlowBlock>>, entry: string, from: string, to: string): boolean {
  const block = blocks[entry]; if (!block) return false;
  if (block.kind === 'sequence') {
    const groups = block.steps.map(child => blockTaskIds(blocks, child));
    const a = groups.findIndex(ids => ids.has(from)), b = groups.findIndex(ids => ids.has(to));
    if (a >= 0 && b > a) return true;
    return block.steps.some(child => precedes(blocks, child, from, to));
  }
  if (block.kind === 'choice') return Object.values(block.cases).some(child => precedes(blocks, child, from, to));
  if (block.kind === 'parallel') return block.branches.some(branch => precedes(blocks, branch.flow, from, to));
  return block.kind === 'repeat' && precedes(blocks, block.body, from, to);
}

/** The fragment is data in a committed task result. The returned digest is the freeze boundary. */
export function freezeFlowFragment(base: CompiledFlow, slotId: string, fragment: { readonly flow: unknown; readonly return: unknown }): FrozenFlowFragment {
  const slot = base.extensions.find(candidate => candidate.id === slotId) ?? fail('/extension', `slot ${slotId} is not declared by this method`);
  const returned = taskOutputBinding.safeParse(fragment.return);
  if (!returned.success) fail('/extension/return', 'declare a taskId and exact field path for the fragment return');
  // Only committed predecessors of the slot producer are visible; siblings/later tasks are not.
  const available = availableAtTask(base.blocks, base.entry, slot.afterTask) ?? fail('/extension/afterTask', 'slot producer is not reachable in the frozen flow');
  const predecessors = available.all;
  const external = Object.fromEntries([...predecessors].filter(id => base.tasks[id] !== undefined).map(id => [id, base.tasks[id]!]));
  const source = flowSource.parse({ schema: flowSourceVersion, id: base.packId, version: base.version, flow: fragment.flow });
  const compiled = compileSource(source, { packSha256: base.packSha256, localSchemas: base.localSchemas, tools: base.toolIds }, external,
    available, carryScopeAtTask(base.blocks, base.entry, slot.afterTask));
  if (base.tasks[slot.afterTask]?.budget !== 'closing' && Object.values(compiled.tasks).some(task => task.budget === 'closing')) {
    fail('/extension/flow/budget', 'this slot does not grant the closing reserve; keep diagnostic tasks in the original work budget');
  }
  for (const id of Object.keys(compiled.blocks)) if (Object.hasOwn(base.blocks, id)) fail('/extension/flow/id', `fragment ID ${id} conflicts with the frozen method; use a new ID`);
  const returnTask = compiled.tasks[returned.data.taskId];
  if (!returnTask || !guaranteedTasks(compiled.blocks, compiled.entry).has(returned.data.taskId)) fail('/extension/return', 'return a task output produced on every successful fragment path');
  const data = { slotId, returnTo: slot.returnTo, return: returned.data, flow: compiled };
  return freeze({ ...data, sha256: digest(data) });
}
function carryScopeAtTask(blocks: Readonly<Record<string, FlowBlock>>, entry: string, taskId: string, scope: ReadonlySet<string> = new Set()): ReadonlySet<string> {
  const block = blocks[entry]; if (!block || block.kind === 'task') return scope;
  const nextScope = block.kind === 'repeat' ? new Set(Object.keys(block.carry)) : scope;
  const children = block.kind === 'sequence' ? block.steps : block.kind === 'choice' ? Object.values(block.cases)
    : block.kind === 'parallel' ? block.branches.map(branch => branch.flow) : [block.body];
  for (const child of children) if (blockTaskIds(blocks, child).has(taskId)) return carryScopeAtTask(blocks, child, taskId, nextScope);
  return scope;
}
function availableAtTask(blocks: Readonly<Record<string, FlowBlock>>, entry: string, taskId: string, before: Availability = { all: new Set(), required: new Set() }): Availability | undefined {
  const block = blocks[entry]; if (!block) return undefined;
  if (block.kind === 'task') {
    if (block.taskId !== taskId) return undefined;
    const after = copied(before); after.all.add(taskId); after.required.add(taskId); return after;
  }
  if (block.kind === 'sequence') {
    let available = copied(before);
    for (const child of block.steps) {
      const found = availableAtTask(blocks, child, taskId, available); if (found) return found;
      blockTaskIds(blocks, child).forEach(id => available.all.add(id));
      guaranteedTasks(blocks, child).forEach(id => available.required.add(id));
    }
    return undefined;
  }
  const children = block.kind === 'choice' ? Object.values(block.cases)
    : block.kind === 'parallel' ? block.branches.map(branch => branch.flow) : [block.body];
  for (const child of children) { const found = availableAtTask(blocks, child, taskId, before); if (found) return found; }
  return undefined;
}
function guaranteedTasks(blocks: Readonly<Record<string, FlowBlock>>, entry: string): Set<string> {
  const block = blocks[entry]!;
  if (block.kind === 'task') return new Set([block.taskId]);
  if (block.kind === 'sequence') return new Set(block.steps.flatMap(child => [...guaranteedTasks(blocks, child)]));
  if (block.kind === 'parallel') return new Set(block.branches.filter(branch => branch.required).flatMap(branch => [...guaranteedTasks(blocks, branch.flow)]));
  if (block.kind === 'repeat') return guaranteedTasks(blocks, block.body);
  const branches = Object.values(block.cases).map(child => guaranteedTasks(blocks, child));
  return new Set([...(branches[0] ?? [])].filter(id => branches.every(branch => branch.has(id))));
}

const legacySchema = (properties: Record<string, JsonValue> = {}): TaskSchema => ({ version: 'legacy-projection/1',
  schema: { $schema: taskSchemaDraft, type: 'object', properties, additionalProperties: true } });
const legacyContract = (node: PackNode): CompiledTask['contract'] => ({ input: legacySchema(), output: legacySchema(
  node.kind === 'judge' ? { outcome: { type: 'string', enum: ['PASS', 'FAIL', 'UNDETERMINED'] } }
    : node.kind === 'explore' && node.parameters.opens ? { outcome: { type: 'string', enum: ['goal-met', 'converged', 'generation-limit'] } }
      : node.kind === 'explore' ? { route: { type: 'string', enum: ['repeat', 'stop'] }, strategy: { type: 'object' } } : {}) });
/** Called only after the existing loader has validated the supported legacy declaration. */
export function compileLegacyFlow(graph: PackGraph, contract: PackContract, packSha256: string): CompiledFlow {
  return lowerLegacyFlow(graph, contract, packSha256);
}
function lowerLegacyFlow(graph: PackGraph, contract: PackContract, packSha256: string, boundary?: { readonly id: string; readonly task: CompiledTask }, inheritedCarry = false): CompiledFlow {
  const blocks: Record<string, FlowBlock> = {}, tasks: Record<string, CompiledTask> = {};
  const dependencies: Record<string, string[]> = {}, extensions: FlowExtensionSlot[] = [];
  // Generated composition IDs occupy a namespace legacy packId cannot spell.
  const internal = (id: string, role: string): string => `@${id}/${role}`;
  const sequence = (id: string, steps: readonly string[]): string => { blocks[id] = { kind: 'sequence', id, steps }; return id; };
  const empty = sequence('@terminal', []);
  const allParts: RunGraph[] = [graph, ...Object.values(graph.loops)];
  for (const part of allParts) for (const node of part.nodes) {
    const carriesStrategy = inheritedCarry || part.edges.some(edge => edge.revisit) || (part !== graph && graph.edges.some(edge => edge.revisit));
    const inputs: Record<string, TaskInputBinding> = {};
    if (node.kind === 'act') for (const [name, value] of Object.entries(node.parameters.arguments)) {
      inputs[name] = typeof value === 'object'
        ? value.from === 'strategy' && carriesStrategy ? { source: 'carry', path: ['strategy', value.name] }
          : { source: value.from === 'input' ? 'runInput' : value.from, path: [value.name] }
        : { source: 'literal', value };
    }
    if (node.kind === 'judge') for (const [name, value] of Object.entries(node.parameters.bind)) inputs[name] = value.from === 'strategy' && carriesStrategy
      ? { source: 'carry', path: ['strategy', value.name] } : { source: value.from, path: [value.name] };
    const tool = node.kind === 'act' ? node.parameters.tool ?? (node.parameters.workshop ? 'builtin/workshop' : 'builtin/observe')
      : `builtin/${node.kind === 'wait' ? 'human-wait' : node.kind}`;
    // The whole declaration supplies all Judge rules, Reader names, Explore convergence/bindings,
    // Workshop revision and Team recipes to the same task adapters. No business meaning is guessed.
    tasks[node.id] = { kind: 'task', id: node.id, tool, contract: legacyContract(node), inputs,
      legacy: structuredClone(node) as unknown as JsonValue };
    dependencies[node.id] = [];
    blocks[node.id] = { kind: 'task', id: node.id, taskId: node.id };
    if(node.kind==='explore' && node.parameters.growth) {
      const id=internal(node.id,'growth-resume'),slotId=internal(node.id,'growth');
      tasks[id]={kind:'task',id,tool:'builtin/legacy-growth-resume',contract:legacyContract(node),
        inputs:{priorDecision:{source:'committedOutput',taskId:node.id,path:[]},diagnostic:{source:'extensionResult',slotId,path:[]}},
        optionalInputs:['diagnostic'],legacy:structuredClone(node) as unknown as JsonValue};
      dependencies[id]=[node.id];blocks[id]={kind:'task',id,taskId:id};
      extensions.push({id:slotId,afterTask:node.id,fragmentPath:['extension'],returnTo:id});
    }
  }
  const decisionSource=(id:string):string=>tasks[internal(id,'growth-resume')]?internal(id,'growth-resume'):id;
  if (boundary) {
    tasks[boundary.task.id] = boundary.task; dependencies[boundary.task.id] = [];
    blocks[boundary.task.id] = { kind: 'task', id: boundary.task.id, taskId: boundary.task.id };
  }
  const built = new Set<string>();
  const partEntry = (part: RunGraph, name: string, inheritedCarry = false): string => {
    const revisit = part.edges.filter(edge => edge.revisit);
    const repeatId = internal(name, 'repeat');
    const target = (id: string): string => boundary?.id === id ? boundary.task.id : internal(id, 'step');
    const wait = part.nodes.find(node => node.kind === 'wait') ?? graph.nodes.find(node => node.kind === 'wait');
    const humanWait = (): string => {
      if (wait) return target(wait.id);
      const id = internal(name, 'human-wait');
      if (!tasks[id]) {
        tasks[id] = { kind: 'task', id, tool: 'builtin/human-wait', contract: { input: legacySchema(), output: legacySchema() }, inputs: {},
          legacy: { reason: 'unlabelled UNDETERMINED', resume: 'rejudge', graph: name } };
        dependencies[id] = []; blocks[id] = { kind: 'task', id, taskId: id };
      }
      return id;
    };
    const lower = (id: string): void => {
      if (boundary?.id === id) return;
      const stepId = target(id); if (built.has(stepId)) return; built.add(stepId);
      const node = part.nodes.find(node => node.id === id)!;
      const edges = part.edges.filter(edge => edge.from === id && !edge.revisit);
      edges.forEach(edge => lower(edge.to));
      let work = node.id;
      if (node.kind === 'explore' && node.parameters.opens) {
        const loopName = node.parameters.opens;
        const loop = partEntry(graph.loops[loopName]!, `loop-${loopName}`, inheritedCarry || revisit.length > 0);
        // The Explore adapter consumes the child composition result and emits its named outcome.
        work = sequence(internal(id, 'open-loop'), [loop, node.id]);
      }
      if(node.kind==='explore'&&node.parameters.growth)work=sequence(internal(id,'growth-sequence'),[work,decisionSource(id)]);
      let route = edges[0] ? target(edges[0].to) : empty;
      if (node.kind === 'judge' || (node.kind === 'explore' && node.parameters.opens)) {
        const values = node.kind === 'judge' ? ['PASS', 'FAIL', 'UNDETERMINED'] : ['goal-met', 'converged', 'generation-limit'];
        const cases = Object.fromEntries(values.map(outcome => {
          const edge = edges.find(edge => edge.outcome === outcome);
          return [outcome, edge ? target(edge.to) : outcome === 'UNDETERMINED' ? humanWait() : empty];
        }));
        const choiceId = internal(id, 'choice');
        blocks[choiceId] = { kind: 'choice', id: choiceId, select: { taskId: decisionSource(id), path: ['outcome'] }, cases };
        route = choiceId;
      } else if (node.kind === 'explore') {
        const choiceId = internal(id, 'continue');
        blocks[choiceId] = { kind: 'choice', id: choiceId, select: { taskId: decisionSource(id), path: ['route'] }, cases: { repeat: route, stop: empty } };
        route = choiceId;
      } else if (node.kind === 'act' && edges.length > 1) {
        // Existing validateForkShape proves a linear chain per branch and one common Judge join.
        const incoming = new Map<string, number>(); part.edges.forEach(edge => incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1));
        let join = '';
        const branches = edges.map(edge => {
          const chain: string[] = []; let at = edge.to;
          while ((incoming.get(at) ?? 0) < 2) {
            chain.push(at); at = part.edges.find(candidate => candidate.from === at)!.to;
          }
          join = at;
          const branchId = internal(edge.to, 'branch');
          return { name: edge.to, flow: sequence(branchId, chain), required: true };
        }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
        const parallelId = internal(id, 'parallel');
        blocks[parallelId] = { kind: 'parallel', id: parallelId, branches,
          results: Object.fromEntries(branches.map(branch => {
            const branchBlock = blocks[branch.flow] as Extract<FlowBlock, { kind: 'sequence' }>;
            return [branch.name, { output: { taskId: branchBlock.steps.at(-1)!, path: [] }, required: true }];
          })) };
        route = sequence(internal(id, 'join'), [parallelId, target(join)]);
      }
      sequence(stepId, [work, route]);
    };
    // Preserve dormant Wait/human intervention positions, not just currently reachable nodes.
    part.nodes.forEach(node => lower(node.id));
    if (revisit.length === 0) return target(part.entry);
    const first = revisit[0]!;
    const initial: TaskInputBinding = inheritedCarry ? { source: 'carry', path: ['strategy'] } : { source: 'strategy', path: [] };
    const carry = { strategy: { initial, next: { taskId: decisionSource(first.from), path: ['strategy'] } } };
    blocks[repeatId] = { kind: 'repeat', id: repeatId, body: target(part.entry), carry,
      stop: { output: { taskId: decisionSource(first.from), path: ['route'] }, equals: 'stop' }, budget: 'original-run',
      entries: Object.fromEntries(revisit.map(edge => [decisionSource(edge.from), { body: target(edge.to),
        carry: { strategy: { initial, next: { taskId: decisionSource(edge.from), path: ['strategy'] } } },
        stop: { output: { taskId: decisionSource(edge.from), path: ['route'] }, equals: 'stop' } }])),
      // Original Run/loop meters use the declaration in compatibility; no fresh child budget.
    };
    return repeatId;
  };
  const entry = partEntry(graph, graph.id, inheritedCarry);

  // Explicit dependencies derive from bindings and legacy reader-consumer references. U6 may also
  // depend on committed control decisions, without invalidating independent sibling results.
  for (const task of Object.values(tasks)) {
    const legacy=task.legacy as unknown as PackNode;
    const originId=legacy?.id??task.id;
    const part = allParts.find(part => part.nodes.some(node => node.id === originId));
    const ancestors = new Set<string>();
    const collect = (id: string): void => {
      for (const edge of part?.edges ?? []) if (!edge.revisit && edge.to === id && !ancestors.has(edge.from)) { ancestors.add(edge.from); collect(edge.from); }
    };
    collect(originId);
    const node = task.legacy as unknown as PackNode;
    const outputNames = node?.kind === 'act' && node.parameters.workshop
      ? contract.workshops.find(workshop => workshop.id === node.parameters.workshop)?.reads ?? []
      : node?.kind === 'act' ? contract.agentTeams.filter(team=>team.triggerNode===originId).flatMap(team=>team.members.flatMap(member=>member.inputs))
        : node?.kind === 'judge' || node?.kind === 'explore' ? contract.outputs.map(output => output.name) : [];
    const producers = Object.values(tasks).filter(candidate => {
      const producer = candidate.legacy as unknown as PackNode;
      return ancestors.has(candidate.id) && producer?.kind === 'act' && producer.parameters.observes && outputNames.includes(producer.parameters.observes);
    }).map(candidate => candidate.id).filter(id => id !== task.id);
    const bound=Object.values(task.inputs).flatMap(binding=>binding.source==='committedOutput'||binding.source==='artifactRef'?[binding.taskId]:[]);
    dependencies[task.id] = [...new Set([...(dependencies[task.id]??[]),...producers,...bound])].sort();
  }
  return finish({ schema: flowIRVersion, source: 'legacy', packId: graph.id, version: graph.version,
    entry, blocks, tasks, localSchemas: {}, toolIds: contract.tools.map(tool => tool.id), dependencies, extensions, packSha256,
    compatibility: { graph: structuredClone(graph), contract: structuredClone(contract),
      revision: 'new-invocation-version', humanIntervention: 'declared-wait-or-current-task',
      budget: 'original-run' } as unknown as JsonValue });
}

/** Validate the existing proposal with the existing authority, then freeze only its additive work.
 * Effect admission and cited input-fact verification remain the Run repository's responsibility. */
export function compileLegacyGrowth(pack: Pack, candidate: unknown): FrozenLegacyFlowFragment {
  const accepted = validateGrowthGraph(pack, candidate);
  if (!accepted.ok) fail('/growth', accepted.reason);
  const { proposal, graph } = accepted;
  const base = pack.flow ?? compileLegacyFlow(pack.graph, pack.contract, pack.folder.digest(packDigestExcludes));
  const slot = base.extensions.find(slot => slot.afterTask === graph.parentNode) ?? fail('/growth/parent', 'use a declared growth position');
  const id = `@${proposal.proposalId}/return`;
  const returned: CompiledTask = { kind: 'task', id, tool: 'builtin/legacy-growth-result',
    contract: { input: legacySchema(), output: legacySchema() }, inputs: {},
    legacy: { proposal: structuredClone(proposal), requiredOutputs: graph.requiredOutputs, optional: graph.optional,
      returnNode: graph.returnNode } as unknown as JsonValue };
  const fragmentGraph: PackGraph = { id: pack.id, version: pack.contract.version,
    entry: graph.graph.entry, nodes: [...graph.graph.nodes], edges: [...graph.graph.edges], loops: {}, autopilot: [] };
  const flow = lowerLegacyFlow(fragmentGraph, pack.contract, base.packSha256, { id: graph.returnNode, task: returned },
    carryScopeAtTask(base.blocks, base.entry, graph.parentNode).has('strategy'));
  const data = { slotId: slot.id, returnTo: slot.returnTo, return: { taskId: id, path: [] }, flow,
    proposalId: proposal.proposalId, requiredOutputs: proposal.requiredOutputs, optional: proposal.optional };
  return freeze({ ...data, sha256: digest(data) });
}

/** A compiled fragment returned by a producer is still untrusted data. Re-derive it from its
 * proposal and the frozen original method, instead of accepting a self-reported SHA as proof. */
export function freezeLegacyFlowFragment(base:CompiledFlow,slotId:string,candidate:unknown):FrozenLegacyFlowFragment {
  const proposed=candidate as FrozenLegacyFlowFragment;
  const compatibility=base.compatibility as unknown as {graph:PackGraph;contract:PackContract}|undefined;
  if(base.source!=='legacy'||!compatibility?.graph||!compatibility.contract||!proposed?.flow?.tasks||!proposed.return)fail('/extension','compiled legacy growth needs its frozen reference method and proposal');
  const declaration=proposed.flow.tasks[proposed.return.taskId]?.legacy as unknown as {proposal?:unknown}|undefined;
  if(!declaration?.proposal)fail('/extension','compiled legacy growth must retain its original validated proposal');
  // validateGrowthGraph reads only these immutable method fields and the already-frozen digest.
  // No current Pack disk bytes, Ledger projection or executable adapter is involved.
  const authority={id:base.packId,graph:compatibility.graph,contract:compatibility.contract,flow:base,
    folder:{digest:()=>base.packSha256}} as unknown as Pack;
  const frozen=compileLegacyGrowth(authority,declaration.proposal);
  if(frozen.slotId!==slotId||canonical(frozen)!==canonical(proposed))fail('/extension','compiled legacy fragment differs from its validated proposal and frozen method');
  return frozen;
}

/** Existing faces read this declaration projection. It is never the execution source for new Runs. */
export function projectFlowGraph(source: FlowSource): PackGraph {
  const nodes: PackNode[] = [];
  const edges: PackGraph['edges'][number][] = [];
  const walk = (flow: Flow): { first: string[]; last: string[]; empty: boolean } => {
    if (flow.kind === 'task') {
      nodes.push(flow.tool === 'builtin/human-wait' ? { id: flow.id, kind: 'wait', parameters: { blocker: 'Waiting for a durable human response' } }
        : { id: flow.id, kind: 'act', parameters: { tool: flow.tool, arguments: {} } });
      return { first: [flow.id], last: [flow.id], empty: false };
    }
    if (flow.kind === 'sequence') {
      let first: string[] = [], last: string[] = [], empty = true;
      for (const step of flow.steps) {
        const next = walk(step);
        for (const from of last) for (const to of next.first) edges.push({ from, to });
        if (empty) first = [...new Set([...first, ...next.first])];
        last = next.empty ? [...new Set([...last, ...next.last])] : next.last;
        empty = empty && next.empty;
      }
      return { first, last, empty };
    }
    // Show possible handoffs at branches; the frozen IR still owns selection and joining.
    // A repeated body is drawn once, with actual iteration identities in its task facts.
    if (flow.kind === 'repeat') return walk(flow.body);
    const branches = flow.kind === 'choice' ? Object.values(flow.cases) : Object.values(flow.branches).map(branch => branch.flow);
    const ends = branches.map(walk);
    return { first: ends.flatMap(end => end.first), last: ends.flatMap(end => end.last),
      empty: flow.kind === 'choice' ? ends.some(end => end.empty) : ends.every(end => end.empty) };
  };
  walk(source.flow);
  const uniqueEdges = [...new Map(edges.map(edge => [JSON.stringify([edge.from, edge.to]), edge])).values()];
  return { id: source.id, version: source.version, entry: nodes[0]?.id ?? source.flow.id, nodes, edges: uniqueEdges, loops: {}, autopilot: [] };
}

/** One normal loader entry derives compilation and digest from exactly the same method bytes. */
export function compilePackFlow(source: FlowSource, folder: PackFolderSnapshot, contract: PackContract): CompiledFlow {
  if (source.id !== contract.id || source.version !== contract.version) fail('/id', 'make graph id/version agree with contract.yml');
  return compileFlow(source, { packSha256: folder.digest(packDigestExcludes), localSchemas: flowLocalSchemas(source, folder), tools: contract.tools.map(tool => tool.id) });
}
