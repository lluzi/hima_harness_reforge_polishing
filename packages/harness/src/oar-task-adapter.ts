// OAR is an external member transport. RunStore/executeTaskEffect own intent, admission,
// recovery and commit; this adapter creates no native session while preparing the plan.
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { createTaskResult, taskIdentity, taskJsonValue, taskToolOutput, type JsonValue, type TaskToolOutput } from './task-contract.js';
import type { TaskEffectAdapter, TaskEffectRequest, EffectClosure } from './task-effects.js';
import type { TeamDefinition } from './team-contract.js';

export const oarPrepared = z.strictObject({
  schema: z.literal('hima-oar-task/1'), identity: taskIdentity,
  projectId: z.string().min(1), memberId: z.string().min(1), runtime: z.enum(['pi', 'opencode']),
  modelRef: z.string().min(1), generation: z.number().int().nonnegative(),
  sessionKey: z.string().min(1), inputId: z.string().min(1), deadlineAt: z.iso.datetime(), prompt: z.string().min(1),
  continuation: z.strictObject({continuationId:z.string().min(1),predecessorEffectId:z.string().min(1),
    contextSha256:z.string().regex(/^[a-f0-9]{64}$/),kind:z.enum(['native-resume','reconstruction'])}).optional(),
});
export type OarPrepared = Readonly<z.infer<typeof oarPrepared>>;
export type OarObservation = { readonly state: 'unknown' | 'running'; readonly reason: string }
  | { readonly state: 'failed'; readonly reason: string; readonly receipt?: JsonValue }
  | { readonly state: 'ready'; readonly receipt: JsonValue; readonly output: TaskToolOutput };
export interface OarMemberPort {
  /** These callbacks fence the actual staging/native send; the port must not send first. */
  stage(prepared: OarPrepared, beforeStage: () => Promise<void>): Promise<void>;
  submit(prepared: OarPrepared, beforeSubmit: () => Promise<void>): Promise<JsonValue>;
  /** Query the original native input/session/generation. OAR queue ACK alone is unknown. */
  observe(prepared: OarPrepared, receipt: JsonValue | undefined): Promise<OarObservation>;
  permit(prepared: OarPrepared, operation: 'submit' | 'message' | 'release'): Promise<boolean>;
  /** Cleanup remains permitted under original ownership after stop/revocation. */
  close(prepared: OarPrepared, receipt: JsonValue | undefined,
    beforeCleanup?: (id: string, input: JsonValue) => Promise<boolean>): Promise<EffectClosure>;
  /** Return only confirmed native reception; throw on queue-only or unknown ACK. */
  send(prepared: OarPrepared, id: string, input: JsonValue, beforeSubmit: () => Promise<void>): Promise<JsonValue>;
  observeMessage(prepared: OarPrepared, id: string, input: JsonValue): Promise<JsonValue | undefined>;
  handoff?(prepared:OarPrepared,request:{readonly waitId:string},beforeCleanup:(id:string,input:JsonValue)=>Promise<boolean>):
    Promise<{readonly closure:EffectClosure;readonly capture:import('./oar-local-member.js').LocalContextCapture}>;
}
export interface OarTaskAdapterOptions {
  readonly member: TeamDefinition['members'][number]; readonly deadlineAt: string; readonly port: OarMemberPort;
  readonly projectId?: string;
  /** Private frozen post-exit reconstruction, appended to the ordinary new task prompt. */
  readonly initialHostPrompt?:string;
  readonly resources: TaskEffectAdapter['resources']; readonly capacity: TaskEffectAdapter['capacity'];
  /** Host-retained successor plan only; never supplied by a native/model payload. */
  readonly continuation?:NonNullable<OarPrepared['continuation']> & {readonly hostInputId:string;readonly hostPrompt:string};
}
const completion = z.strictObject({ schema: z.literal('hima-oar-completion/1'),
  identity: taskIdentity, generation: z.number().int().nonnegative(), sessionKey: z.string(), inputId: z.string(),
  receipt: taskJsonValue, output: taskToolOutput });
// Canonical comparison avoids property-order differences in retained JSON facts.
function canonical(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key]!)}`).join(',')}}`;
  return JSON.stringify(value);
}
const json = (value: unknown): JsonValue => taskJsonValue.parse(value);
const identityDigest = (identity: OarPrepared['identity']) => createHash('sha256').update(canonical(json(identity))).digest('hex').slice(0, 32);
// The custom JSON value validator has no JSON-Schema representation; its
// business schema is supplied separately by the frozen delivery contract.
const deliveryEnvelopeSchema = JSON.stringify(z.toJSONSchema(taskToolOutput, {unrepresentable:'any'}));
function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
export function oarTaskAdapter(options: OarTaskAdapterOptions): TaskEffectAdapter {
  const member = structuredClone(options.member);
  const plan = (request: TaskEffectRequest): OarPrepared => {
    const projectId = 'source' in request.identity ? request.identity.source.projectId : options.projectId;
    if (!projectId || (options.projectId !== undefined && options.projectId !== projectId)) throw new Error('OAR task requires its frozen project identity');
    if (request.admission.runId !== request.identity.runId || request.admission.effectId !== request.identity.effectId) throw new Error('OAR admission belongs to another effect');
    const digest = identityDigest(request.identity);
    const artifactIdentity={runId:request.identity.runId,taskId:request.identity.taskId,effectId:request.identity.effectId};
    return freeze(oarPrepared.parse({ schema: 'hima-oar-task/1', identity: request.identity, projectId,
      memberId: member.id, runtime: member.runtime, modelRef: member.modelRef, generation: request.admission.epoch,
      sessionKey: `hima-oar-${digest}`, inputId: options.continuation?.hostInputId??`hima-input-${digest}`, deadlineAt: options.deadlineAt,
      ...(options.continuation?{continuation:{continuationId:options.continuation.continuationId,predecessorEffectId:options.continuation.predecessorEffectId,contextSha256:options.continuation.contextSha256,kind:options.continuation.kind}}:{}),
      prompt: options.continuation?.hostPrompt??`${member.instructions}\nNative Skills selected: ${member.skills.join(", ")}\n\nTask identity (JSON):\n${JSON.stringify(request.identity)}\n\nTask input (JSON):\n${JSON.stringify(request.input)}\n\nDelivery contract (JSON):\n${JSON.stringify(request.contract.output)}\n\nTaskToolOutput envelope schema (JSON):\n${deliveryEnvelopeSchema}\n\nArtifact identity: copy these three fields exactly into every artifact (JSON):\n${JSON.stringify(artifactIdentity)}\nReturn only the TaskToolOutput JSON envelope. Set schemaVersion to ${JSON.stringify(request.contract.output.version)}; value must satisfy the delivery contract schema. The artifact taskId is the execution node identity above; readTask.actor.taskId and readTask.task.taskId identify the containing team task. Artifacts also require a relative work-directory path and the SHA256 of the actual bytes. Empty artifacts and diagnostics are []. Use these supplied schemas for delivery. Preserve your native context, Skills, tools, compression and subagents within the authorized task scope.${options.initialHostPrompt?`\n\n${options.initialHostPrompt}`:''}`,
    }));
  };
  const held = (prepared: JsonValue): OarPrepared => {
    const parsed = oarPrepared.parse(prepared);
    const digest = identityDigest(parsed.identity);
    if (parsed.sessionKey !== `hima-oar-${digest}` || parsed.inputId !== `hima-input-${digest}`
      || ('source' in parsed.identity && parsed.projectId !== parsed.identity.source.projectId)) throw new Error('Retained OAR session/input differs from its frozen effect identity');
    if (parsed.memberId !== member.id || parsed.runtime !== member.runtime || parsed.modelRef !== member.modelRef
      || parsed.deadlineAt !== options.deadlineAt || (options.projectId !== undefined && parsed.projectId !== options.projectId)) throw new Error('Retained OAR plan differs from the frozen member binding');
    if(options.initialHostPrompt&&!parsed.prompt.endsWith(`\n\n${options.initialHostPrompt}`))throw new Error('Retained OAR prompt differs from the frozen post-exit reconstruction');
    return freeze(parsed);
  };
  const nativeReceipt = (prepared: OarPrepared, receipt: JsonValue | undefined): JsonValue | undefined => {
    if (receipt && typeof receipt === 'object' && !Array.isArray(receipt) && receipt.schema === 'hima-oar-completion/1') {
      const selected = completion.parse(receipt);
      if (canonical(json(selected.identity)) !== canonical(json(prepared.identity)) || selected.generation !== prepared.generation
        || selected.sessionKey !== prepared.sessionKey || selected.inputId !== prepared.inputId) throw new Error('OAR completion belongs to another session/input/generation');
      return selected.receipt;
    }
    return receipt;
  };
  return {
    kind: 'team', version: 'hima-task-effect/2', resources: options.resources, capacity: options.capacity,
    async prepare(request) { return json(plan(request)); },
    async permit(prepared, operation) { return options.port.permit(held(prepared), operation); },
    async stage(prepared, beforeStage) { await options.port.stage(held(prepared), beforeStage); },
    ...(options.port.handoff?{handoff:(prepared:JsonValue,request:{readonly waitId:string},beforeCleanup:(id:string,input:JsonValue)=>Promise<boolean>)=>options.port.handoff!(held(prepared),request,beforeCleanup)}:{}),
    async submit(prepared, beforeSubmit) { return options.port.submit(held(prepared), beforeSubmit); },
    async reconcile(prepared, receipt) {
      const fixed = held(prepared), observed = await options.port.observe(fixed, nativeReceipt(fixed, receipt));
      if (observed.state !== 'ready') return observed;
      return { state: 'ready', receipt: json(completion.parse({ schema: 'hima-oar-completion/1',
        identity: fixed.identity, generation: fixed.generation, sessionKey: fixed.sessionKey, inputId: fixed.inputId,
        receipt: observed.receipt, output: observed.output })) };
    },
    async collect(prepared, receipt, request) {
      const fixed = held(prepared), expected = plan(request);
      if (canonical(json(fixed)) !== canonical(json(expected))) throw new Error('OAR collection request identity, input or current generation differs from retained intent');
      const selected = completion.parse(receipt);
      nativeReceipt(fixed, receipt);
      createTaskResult(request.identity, request.contract, selected.output, request.localSchemas);
      return selected.output;
    },
    async release(prepared, receipt, beforeCleanup) {
      const fixed = held(prepared); return options.port.close(fixed, nativeReceipt(fixed, receipt), beforeCleanup);
    },
    async stop(prepared, receipt, beforeCleanup) {
      const fixed = held(prepared); return options.port.close(fixed, nativeReceipt(fixed, receipt), beforeCleanup);
    },
    async message(prepared, id, input, beforeSubmit) { return options.port.send(held(prepared), id, input, beforeSubmit); },
    async reconcileMessage(prepared, id, input) { return options.port.observeMessage(held(prepared), id, input); },
  };
}
