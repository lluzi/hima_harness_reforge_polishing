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
    inputs: bindings, optionalInputs: z.array(z.string().min(1)).optional() }),
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
