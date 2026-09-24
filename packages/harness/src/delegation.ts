// @hima-seam agent wrapped
// @hima-seam tools wrapped
// Bounded delegation over DSH's durable continuable-child API.  Run admission and
// accounting stay with Fabric/Ledger through DelegationAuthority; this module owns
// only validation, native child lifecycle calls, and the monotonic tool guard.
import { createHash } from 'node:crypto';
import { lstatSync, realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import type { ToolExecution } from '@deepseek-ai/dsh-tools';

export type DelegationRole = 'analyst' | 'reviewer' | 'researcher' | 'coding' | 'operator';

export interface DelegationBudgetShare {
  /** Durable allocation inside the parent task/Run budget. Fabric owns the meter. */
  readonly maxElapsedMs: number;
  /** Maximum accepted follow-ups, including cold resumes, after the initial task. */
  readonly maxFollowups: number;
  /** The only model-token limit exposed by the pinned native API: one request, not the whole task. */
  readonly maxTokensPerTurn?: number;
  /** Unsupported by the pinned continuable API. Naming one makes admission fail closed. */
  readonly maxTotalTokens?: number;
  /** Unsupported by the pinned continuable API. Naming one makes admission fail closed. */
  readonly maxCost?: number;
}

export interface DelegationContract {
  readonly delegationId: string;
  readonly parentSessionId: string;
  readonly role: DelegationRole;
  readonly task: string;
  readonly inputRefs: readonly string[];
  readonly workspaceRef?: string;
  readonly runRef?: { readonly runId: string; readonly expectedEpoch: number; readonly expectedRevision: number };
  readonly nodeRef?: string;
  readonly allowedTools: readonly string[];
  /** A private, existing directory strictly below the parent session workspace. */
  readonly writeScope?: { readonly root: string };
  readonly budgetShare: DelegationBudgetShare;
  readonly dependencyIds: readonly string[];
  readonly recipient: { readonly kind: 'parent' | 'run-owner'; readonly sessionId: string };
  readonly status: 'requested';
}

export interface EffectiveDelegationContract {
  readonly delegationId: string;
  readonly parentSessionId: string;
  readonly childSessionId: string;
  readonly role: DelegationRole;
  readonly workspace: string;
  readonly model: { readonly provider: string; readonly model: string; readonly maxTokensPerTurn?: number };
  readonly tools: readonly string[];
  /** Exact recorded Run facts made available through hima_delegation_input. */
  readonly inputRefs: readonly string[];
  /** Generic file tools exist only for a coding child's private task directory. */
  readonly readScope?: { readonly root: string };
  readonly writeScope?: { readonly root: string };
  readonly budgetShare: Pick<DelegationBudgetShare, 'maxElapsedMs' | 'maxFollowups' | 'maxTokensPerTurn'>;
  readonly runRef?: DelegationContract['runRef'];
  readonly nodeRef?: string;
  readonly recipient: DelegationContract['recipient'];
  readonly unavailable: readonly string[];
}

export interface DelegationReservation {
  readonly reservationId: string;
  readonly deadlineAt: string;
  /** Epoch/revision re-read by Fabric while holding the existing Run control lock. */
  readonly admittedEpoch?: number;
  readonly admittedRevision?: number;
}

export interface DurableDelegationState {
  readonly requestDigest: string;
  readonly state: 'intent' | 'accepted' | 'refused' | 'uncertain' | 'cancel-requested' | 'cancelled' | 'expired' | 'completed';
  readonly childSessionId?: string;
  readonly initialMessageId?: string;
  readonly effective?: EffectiveDelegationContract;
  readonly reason?: string;
}

export type DelegationAdmission =
  | { readonly kind: 'reserved'; readonly reservation: DelegationReservation }
  | { readonly kind: 'duplicate'; readonly durable: DurableDelegationState }
  | { readonly kind: 'refused'; readonly reason: string };

export interface DelegationAuthority {
  /** Re-read Run owner/epoch/revision, holds, dependencies and total budget under the existing lock. */
  admitCreation(input: { readonly contract: DelegationContract; readonly requestDigest: string;
    readonly proposed: EffectiveDelegationContract }): Promise<DelegationAdmission>;
  recordCreation(input: { readonly contract: DelegationContract; readonly requestDigest: string;
    readonly reservation: DelegationReservation; readonly effective: EffectiveDelegationContract;
    readonly childSessionId?: string; readonly initialMessageId?: string;
    readonly outcome: 'accepted' | 'refused' | 'uncertain'; readonly reason?: string }): Promise<void>;
  /** Same lock/read discipline as creation; this owns duplicate request ids and the follow-up cap. */
  admitFollowup(input: { readonly parentSessionId: string; readonly childSessionId: string;
    readonly requestId: string; readonly requestDigest: string }): Promise<
      | { readonly kind: 'reserved'; readonly reservationId: string }
      | { readonly kind: 'duplicate'; readonly messageId?: string; readonly uncertain?: boolean }
      | { readonly kind: 'refused'; readonly reason: string }>;
  recordFollowup(input: { readonly parentSessionId: string; readonly childSessionId: string;
    readonly requestId: string; readonly requestDigest: string; readonly reservationId: string;
    readonly outcome: 'accepted' | 'uncertain'; readonly messageId?: string; readonly reason?: string }): Promise<void>;
  /** Re-read exact parent/child lineage and make cancel requestId idempotent before any interrupt. */
  admitCancel(input: { readonly parentSessionId: string; readonly childSessionId: string;
    readonly requestId: string; readonly requestDigest: string }): Promise<
      | { readonly kind: 'reserved'; readonly reservationId: string }
      | { readonly kind: 'duplicate'; readonly effect?: 'confirmed' | 'unknown' }
      | { readonly kind: 'refused'; readonly reason: string }>;
  recordCancel(input: { readonly parentSessionId: string; readonly childSessionId: string;
    readonly requestId: string; readonly requestDigest: string; readonly reservationId: string;
    readonly effect: 'confirmed' | 'unknown'; readonly reason?: string }): Promise<void>;
}

/** Dynamic, Ledger-derived policy. The guard asks again for every tool call. */
export interface DelegationRuntimePolicy {
  readonly effective: EffectiveDelegationContract;
  readonly state: DurableDelegationState['state'];
  /** Dynamic Ledger-derived permission for every tool, including reads. */
  readonly toolsAllowed: boolean;
  /** Human pause may keep observation tools while freezing mutations. */
  readonly writesAllowed: boolean;
  readonly reason?: string;
}

export type DelegationPolicyLookup = (childSessionId: string) => DelegationRuntimePolicy | undefined;

export interface DelegationReceipt {
  readonly requestDigest: string;
  readonly reservationId?: string;
  readonly childSessionId?: string;
  readonly initialMessageId?: string;
  readonly effect?: 'confirmed' | 'unknown';
}

export interface DelegationResult {
  readonly status: 'created' | 'accepted' | 'refused' | 'duplicate' | 'uncertain' | 'completed';
  readonly effectiveContract?: EffectiveDelegationContract;
  readonly receipt?: DelegationReceipt;
  readonly artifacts: readonly string[];
  readonly unknowns: readonly string[];
  readonly reason?: string;
}

type PersistedHeader = { readonly cwd?: string; readonly parentSession?: string };
type Persistence = { stat(id: string): Promise<{ readonly header: PersistedHeader } | undefined> };
type NativeSessionEvent = { readonly seq: number; readonly type: string; readonly data?: unknown };
type SessionQuery = { readSession(id: string): Promise<{ readonly session: PersistedHeader & { readonly id: unknown }; readonly events: readonly NativeSessionEvent[] }> };
type NativeChildEntry = { readonly kind: 'child'; readonly id: string; readonly mode: 'one-shot' | 'continuable'; readonly label?: string }
  | { readonly kind: 'diagnostic'; readonly id: string; readonly reason: string };
type NativeSubagents = {
  startContinuable(spec: { readonly provider: string; readonly label: string; readonly childId: string;
    readonly request: { readonly prompt: ContentBlock[]; readonly parent: Agent; readonly agentOptions: { provider: string; model: string; maxTokens?: number };
      readonly maxDepth: number; readonly toolFilter: { readonly allow: readonly string[] }; readonly persona: string };
    readonly signal: AbortSignal }): Promise<{ readonly childId: string; readonly messageId: string }>;
  listChildren(parentSessionId: string, signal?: AbortSignal): Promise<NativeChildEntry[]>;
  sendMessage(sender: Agent, targetId: string, content: ContentBlock[], options: { readonly signal: AbortSignal }): Promise<string>;
  interrupt(targetSessionId: string, authority: { readonly kind: 'ancestor'; readonly agent: Agent }): void;
};

const idPattern = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,159}$/;
const plainRef = /^[A-Za-z0-9][A-Za-z0-9:._/@+#-]{0,511}$/;
const terminalTools = new Set(['bash', 'terminal_open', 'terminal_send', 'terminal_read', 'terminal_signal', 'terminal_close', 'terminal_list']);
const recursiveTools = new Set(['subagent', 'subagent_fork']);
const readTools = new Set(['read', 'glob', 'grep']);
const writeTools = new Set(['write', 'edit']);
const delegationInputTool = 'hima_delegation_input';
const roleTools: Readonly<Record<Exclude<DelegationRole, 'operator'>, ReadonlySet<string>>> = {
  analyst: new Set(['web_search', 'web_fetch', delegationInputTool]),
  reviewer: new Set(['web_search', 'web_fetch', delegationInputTool]),
  researcher: new Set(['web_search', 'web_fetch', delegationInputTool]),
  coding: new Set(['read', 'glob', 'grep', 'write', 'edit', delegationInputTool]),
};

export class DelegationError extends Error {
  readonly code: 'hima/delegation-invalid' | 'hima/delegation-unavailable' | 'hima/delegation-refused';
  constructor(code: 'hima/delegation-invalid' | 'hima/delegation-unavailable' | 'hima/delegation-refused', message: string) {
    super(message); this.code = code;
  }
}

const stable = (value: unknown): string => JSON.stringify(value, (_key, item) => {
  if (item === null || Array.isArray(item) || typeof item !== 'object') return item;
  return Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)));
});

export const delegationRequestDigest = (contract: DelegationContract): string =>
  createHash('sha256').update(stable(contract)).digest('hex');

export const delegationChildSessionId = (parentSessionId: string, delegationId: string): string =>
  `hima-child-${createHash('sha256').update(`${parentSessionId}\0${delegationId}`).digest('hex').slice(0, 32)}`;

const labelOf = (contract: DelegationContract, digest: string): string =>
  `hima:${contract.delegationId}:${digest.slice(0, 16)}`;

const delegationContractSchema = z.strictObject({
  delegationId:z.string(),parentSessionId:z.string(),role:z.enum(['analyst','reviewer','researcher','coding','operator']),
  task:z.string(),inputRefs:z.array(z.string()).max(64),workspaceRef:z.string().optional(),
  runRef:z.strictObject({runId:z.string(),expectedEpoch:z.number().int().nonnegative(),expectedRevision:z.number().int().nonnegative()}).optional(),
  nodeRef:z.string().optional(),allowedTools:z.array(z.string().min(1)).max(32),writeScope:z.strictObject({root:z.string()}).optional(),
  budgetShare:z.strictObject({maxElapsedMs:z.number(),maxFollowups:z.number(),maxTokensPerTurn:z.number().optional(),maxTotalTokens:z.number().optional(),maxCost:z.number().optional()}),
  dependencyIds:z.array(z.string()).max(32),recipient:z.strictObject({kind:z.enum(['parent','run-owner']),sessionId:z.string()}),status:z.literal('requested'),
});
function assertContract(contract: DelegationContract): void {
  delegationContractSchema.parse(contract);
  if (!idPattern.test(contract.delegationId) || !idPattern.test(contract.parentSessionId)) throw new DelegationError('hima/delegation-invalid', 'Delegation and parent session identities must be bounded plain identifiers.');
  if (contract.task.trim() === '' || contract.task.length > 8_000) throw new DelegationError('hima/delegation-invalid', 'A bounded non-empty delegated task is required.');
  for (const ref of [...contract.inputRefs, ...contract.dependencyIds]) if (!plainRef.test(ref)) throw new DelegationError('hima/delegation-invalid', `Delegation reference ${JSON.stringify(ref)} is invalid.`);
  if (!Number.isSafeInteger(contract.budgetShare.maxElapsedMs) || contract.budgetShare.maxElapsedMs <= 0
      || !Number.isSafeInteger(contract.budgetShare.maxFollowups) || contract.budgetShare.maxFollowups < 0) {
    throw new DelegationError('hima/delegation-invalid', 'Delegation time and follow-up bounds must be non-negative safe integers, with positive elapsed time.');
  }
  if (contract.budgetShare.maxTokensPerTurn !== undefined
      && (!Number.isSafeInteger(contract.budgetShare.maxTokensPerTurn) || contract.budgetShare.maxTokensPerTurn <= 0)) {
    throw new DelegationError('hima/delegation-invalid', 'maxTokensPerTurn must be a positive safe integer.');
  }
  if (contract.budgetShare.maxTotalTokens !== undefined || contract.budgetShare.maxCost !== undefined) {
    throw new DelegationError('hima/delegation-refused', 'The pinned continuable-child API exposes no enforceable task-total token or cost meter; request elapsed/follow-up limits and record token/cost as unmeasured.');
  }
  if (contract.role === 'operator') throw new DelegationError('hima/delegation-refused', 'Operator delegation is unavailable until the qualified Site/Fabric interactive terminal and single-writer protocol exist.');
}

const within = (candidate: string, root: string): boolean => candidate === root || candidate.startsWith(root + path.sep);

function realDirectory(named: string, what: string): string {
  if (!path.isAbsolute(named)) throw new DelegationError('hima/delegation-invalid', `${what} must be an absolute path.`);
  const stat = lstatSync(named, { throwIfNoEntry: false });
  if (!stat || !stat.isDirectory() || stat.isSymbolicLink()) throw new DelegationError('hima/delegation-refused', `${what} must be an existing plain directory.`);
  return realpathSync(named);
}

function effectiveContract(ctx: Context, parent: Agent, contract: DelegationContract, childSessionId: string): EffectiveDelegationContract {
  const cwd = parent.session.header.cwd;
  const provider = parent.options.provider; const model = parent.options.model;
  if (!cwd || !provider || !model) throw new DelegationError('hima/delegation-unavailable', 'The live parent lacks an effective workspace or model route.');
  const workspace = realDirectory(cwd, 'Parent workspace');
  if (contract.workspaceRef !== undefined && realDirectory(contract.workspaceRef, 'Delegation workspace') !== workspace) {
    throw new DelegationError('hima/delegation-refused', 'The delegation workspace does not match the live parent workspace.');
  }
  const ceiling = roleTools[contract.role as Exclude<DelegationRole, 'operator'>];
  const visible = new Set(ctx.tools.schemas(parent).map((schema) => schema.name));
  const unavailable: string[] = [];
  let writeScope: { readonly root: string } | undefined;
  if (contract.writeScope !== undefined) {
    const root = realDirectory(contract.writeScope.root, 'Delegation write scope');
    if (root === workspace || !within(root, workspace)) throw new DelegationError('hima/delegation-refused', 'Coding writes require a private directory strictly below the parent workspace.');
    if (contract.role !== 'coding') unavailable.push('write scope removed: this role is read-only');
    else writeScope = { root };
  }
  const tools = [...new Set(contract.allowedTools)].filter((name) => {
    if (!ceiling.has(name) || terminalTools.has(name) || recursiveTools.has(name) || !visible.has(name)) { unavailable.push(`tool unavailable: ${name}`); return false; }
    if (writeTools.has(name) && writeScope === undefined) { unavailable.push(`tool unavailable without guarded private write scope: ${name}`); return false; }
    if (readTools.has(name) && writeScope === undefined) { unavailable.push(`generic file tool unavailable without a coding private task directory: ${name}`); return false; }
    if (name === delegationInputTool && (contract.runRef === undefined || contract.inputRefs.length === 0)) { unavailable.push(`tool unavailable without exact recorded Run inputs: ${name}`); return false; }
    return true;
  });
  if (tools.length === 0) throw new DelegationError('hima/delegation-refused', 'No requested tool is both installed and allowed for this role.');
  return {
    delegationId: contract.delegationId, parentSessionId: contract.parentSessionId, childSessionId,
    role: contract.role, workspace, model: { provider, model, ...(contract.budgetShare.maxTokensPerTurn === undefined ? {} : { maxTokensPerTurn: contract.budgetShare.maxTokensPerTurn }) },
    tools, inputRefs: [...contract.inputRefs], ...(writeScope === undefined ? {} : { readScope: { root: writeScope.root }, writeScope }),
    budgetShare: { maxElapsedMs: contract.budgetShare.maxElapsedMs, maxFollowups: contract.budgetShare.maxFollowups,
      ...(contract.budgetShare.maxTokensPerTurn === undefined ? {} : { maxTokensPerTurn: contract.budgetShare.maxTokensPerTurn }) },
    ...(contract.runRef === undefined ? {} : { runRef: contract.runRef }), ...(contract.nodeRef === undefined ? {} : { nodeRef: contract.nodeRef }),
    recipient: contract.recipient, unavailable,
  };
}

function requireNative(ctx: Context): { parentRegistry: NonNullable<ReturnType<Context['get']>>; subagents: NativeSubagents; persistence: Persistence } {
  const agents = ctx.get('agents');
  const subagents = ctx.get('subagents') as NativeSubagents | undefined;
  const persistence = ctx.get('sessionPersistence') as Persistence | undefined;
  if (!agents || !subagents || !persistence) throw new DelegationError('hima/delegation-unavailable', 'Native Agent, continuable-child, and session persistence services are required.');
  return { parentRegistry: agents as never, subagents, persistence };
}

async function verifyChild(ctx: Context, parent: Agent, childId: string, workspace: string, expectedLabel?: string, signal?: AbortSignal): Promise<boolean> {
  const { subagents, persistence } = requireNative(ctx);
  const child = await persistence.stat(childId);
  if (!child || child.header.parentSession !== String(parent.id) || child.header.cwd === undefined) return false;
  let childWorkspace: string;
  try { childWorkspace = realDirectory(child.header.cwd, 'Persisted child workspace'); } catch { return false; }
  if (childWorkspace !== workspace) return false;
  const entries = await subagents.listChildren(String(parent.id), signal);
  const entry = entries.find((candidate) => candidate.kind === 'child' && candidate.id === childId);
  return entry?.kind === 'child' && entry.mode === 'continuable' && (expectedLabel === undefined || entry.label === expectedLabel);
}

const taskPrompt = (contract: DelegationContract, effective: EffectiveDelegationContract): string => [
  `Role: ${effective.role}.`,
  `Task: ${contract.task.trim()}`,
  `Inputs: ${contract.inputRefs.length === 0 ? '(none)' : contract.inputRefs.join(', ')}`,
  contract.inputRefs.length === 0 ? 'Recorded input reader: unavailable; no Run facts were granted.'
    : effective.tools.includes(delegationInputTool)
      ? `Recorded input reader: use ${delegationInputTool} with Run ${effective.runRef?.runId ?? '(unavailable)'} and only one of the exact input identities above.`
      : 'Recorded input reader: unavailable in this effective tool grant; ask the owner to coordinate rather than reading the parent workspace.',
  `Recipient: ${effective.recipient.kind} session ${effective.recipient.sessionId}.`,
  effective.writeScope === undefined ? 'Write capability: unavailable; return proposed changes and verification needs as candidate results.'
    : `Write capability: only the guarded private directory ${effective.writeScope.root}; owner verification is still required.`,
  'Do not claim a Campaign action, verdict, tool result, or file change that the corresponding tool/session transcript does not record.',
].join('\n');

export async function createDelegation(ctx: Context, contract: DelegationContract, authority: DelegationAuthority, signal: AbortSignal): Promise<DelegationResult> {
  try { assertContract(contract); } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { status: 'refused', artifacts: [], unknowns: [], reason };
  }
  let native: ReturnType<typeof requireNative>;
  try { native = requireNative(ctx); } catch (error) {
    return { status: 'refused', artifacts: [], unknowns: [], reason: error instanceof Error ? error.message : String(error) };
  }
  const { parentRegistry, subagents } = native;
  const parent = (parentRegistry as unknown as { get(id: string): Agent | undefined }).get(contract.parentSessionId);
  if (!parent) return { status: 'refused', artifacts: [], unknowns: [], reason: 'The exact parent session is not live on this Host.' };
  const childSessionId = delegationChildSessionId(contract.parentSessionId, contract.delegationId);
  let proposed: EffectiveDelegationContract;
  try { proposed = effectiveContract(ctx, parent, contract, childSessionId); } catch (error) {
    return { status: 'refused', artifacts: [], unknowns: [], reason: error instanceof Error ? error.message : String(error) };
  }
  const requestDigest = delegationRequestDigest(contract);
  const label = labelOf(contract, requestDigest);
  const admission = await authority.admitCreation({ contract, requestDigest, proposed });
  if (admission.kind === 'refused') return { status: 'refused', artifacts: [], unknowns: proposed.unavailable, reason: admission.reason };
  if (admission.kind === 'duplicate') {
    if (admission.durable.requestDigest !== requestDigest) return { status: 'refused', artifacts: [], unknowns: [], reason: 'Delegation identity was reused with different intent.' };
    const effective = admission.durable.effective ?? proposed;
    const recordedChildId = admission.durable.childSessionId;
    if (recordedChildId !== undefined) {
      const found = await verifyChild(ctx, parent, recordedChildId, effective.workspace, label, signal);
      if (!found) return { status: 'uncertain', effectiveContract: effective, artifacts: [], unknowns: ['The durable receipt names a child whose native lineage/descriptor is unavailable.'], reason: admission.durable.reason };
    }
    if (admission.durable.state === 'intent') {
      const deterministicChildExists = recordedChildId !== undefined
        || await verifyChild(ctx, parent, childSessionId, effective.workspace, label, signal);
      return { status: 'uncertain', effectiveContract: effective,
        receipt: deterministicChildExists ? { requestDigest, childSessionId } : { requestDigest }, artifacts: [],
        unknowns: [deterministicChildExists
          ? 'The deterministic native child exists, but its accepted receipt was not durably confirmed; automatic delivery/re-spawn is refused.'
          : 'A durable spawn intent exists without a confirmed native child; automatic respawn is refused.'] };
    }
    return { status: 'duplicate', effectiveContract: effective, receipt: { requestDigest, childSessionId: admission.durable.childSessionId,
      initialMessageId: admission.durable.initialMessageId }, artifacts: [], unknowns: [], reason: admission.durable.reason };
  }
  let nativeAccepted: { readonly childId: string; readonly messageId: string };
  try {
    const started = await subagents.startContinuable({
      provider: 'spawn', label, childId: childSessionId,
      request: { parent, prompt: [{ type: 'text', text: taskPrompt(contract, proposed) }],
        agentOptions: { provider: proposed.model.provider, model: proposed.model.model,
          ...(proposed.model.maxTokensPerTurn === undefined ? {} : { maxTokens: proposed.model.maxTokensPerTurn }) },
        maxDepth: 1, toolFilter: { allow: proposed.tools }, persona: `You are Hima's bounded ${proposed.role} child. Work only inside the effective contract and return candidate evidence to the named recipient.` },
      signal,
    });
    if (String(started.childId) !== childSessionId) throw new DelegationError('hima/delegation-unavailable', 'Native continuable creation returned a different child identity.');
    nativeAccepted = { childId: String(started.childId), messageId: String(started.messageId) };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    try { await authority.recordCreation({ contract, requestDigest, reservation: admission.reservation, effective: proposed,
      outcome: 'uncertain', reason }); } catch { /* original failure remains the useful boundary */ }
    const uncertain = true; // Native creation can fail after accepting its process effect.
    return { status: uncertain ? 'uncertain' : 'refused', effectiveContract: proposed, artifacts: [], unknowns: uncertain ? ['Native creation may have crossed the acceptance boundary; inspect the deterministic child identity before retrying.'] : [], reason };
  }
  try {
    await authority.recordCreation({ contract, requestDigest, reservation: admission.reservation, effective: proposed,
      childSessionId: nativeAccepted.childId, initialMessageId: nativeAccepted.messageId, outcome: 'accepted' });
  } catch (error) {
    return { status: 'uncertain', effectiveContract: proposed, receipt: { requestDigest, reservationId: admission.reservation.reservationId,
      childSessionId: nativeAccepted.childId, initialMessageId: nativeAccepted.messageId }, artifacts: [],
      unknowns: ['The native inbox accepted the task, but the durable accepted receipt failed; do not retry automatically.'],
      reason: error instanceof Error ? error.message : String(error) };
  }
  return { status: 'created', effectiveContract: proposed, receipt: { requestDigest, reservationId: admission.reservation.reservationId,
    childSessionId: nativeAccepted.childId, initialMessageId: nativeAccepted.messageId }, artifacts: [], unknowns: proposed.unavailable };
}

export async function followupDelegation(ctx: Context, request: { readonly parentSessionId: string; readonly childSessionId: string;
  readonly requestId: string; readonly message: string }, authority: DelegationAuthority, signal: AbortSignal): Promise<DelegationResult> {
  if (!idPattern.test(request.requestId) || request.message.trim() === '' || request.message.length > 8_000) return { status: 'refused', artifacts: [], unknowns: [], reason: 'A bounded request id and non-empty follow-up are required.' };
  let native: ReturnType<typeof requireNative>;
  try { native = requireNative(ctx); } catch (error) {
    return { status: 'refused', artifacts: [], unknowns: [], reason: error instanceof Error ? error.message : String(error) };
  }
  const { parentRegistry, subagents } = native;
  const parent = (parentRegistry as unknown as { get(id: string): Agent | undefined }).get(request.parentSessionId);
  if (!parent) return { status: 'refused', artifacts: [], unknowns: [], reason: 'The exact direct parent is not live.' };
  const digest = createHash('sha256').update(stable(request)).digest('hex');
  const admitted = await authority.admitFollowup({ parentSessionId: request.parentSessionId, childSessionId: request.childSessionId, requestId: request.requestId, requestDigest: digest });
  if (admitted.kind === 'refused') return { status: 'refused', artifacts: [], unknowns: [], reason: admitted.reason };
  if (admitted.kind === 'duplicate') return { status: admitted.uncertain ? 'uncertain' : 'duplicate', receipt: { requestDigest: digest, childSessionId: request.childSessionId, initialMessageId: admitted.messageId }, artifacts: [], unknowns: admitted.uncertain ? ['Prior delivery has no confirmed native inbox receipt.'] : [] };
  let messageId: string;
  try { messageId = String(await subagents.sendMessage(parent, request.childSessionId, [{ type: 'text', text: request.message }], { signal })); }
  catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    try { await authority.recordFollowup({ ...request, requestDigest: digest, reservationId: admitted.reservationId, outcome: 'uncertain', reason }); } catch { /* preserve native failure */ }
    return { status: 'uncertain', receipt: { requestDigest: digest, reservationId: admitted.reservationId, childSessionId: request.childSessionId }, artifacts: [], unknowns: ['Delivery did not return a native inbox receipt; do not resend automatically.'], reason };
  }
  try { await authority.recordFollowup({ ...request, requestDigest: digest, reservationId: admitted.reservationId, outcome: 'accepted', messageId }); }
  catch (error) { return { status: 'uncertain', receipt: { requestDigest: digest, reservationId: admitted.reservationId,
    childSessionId: request.childSessionId, initialMessageId: messageId }, artifacts: [],
    unknowns: ['The native inbox accepted the follow-up, but its durable receipt failed; do not resend automatically.'],
    reason: error instanceof Error ? error.message : String(error) }; }
  return { status: 'accepted', receipt: { requestDigest: digest, reservationId: admitted.reservationId,
    childSessionId: request.childSessionId, initialMessageId: messageId }, artifacts: [], unknowns: [] };
}

export async function cancelDelegation(ctx: Context, request: { readonly parentSessionId: string; readonly childSessionId: string;
  readonly requestId: string }, authority: DelegationAuthority): Promise<DelegationResult> {
  if (!idPattern.test(request.requestId)) return { status: 'refused', artifacts: [], unknowns: [], reason: 'A bounded cancel request id is required.' };
  let native: ReturnType<typeof requireNative>;
  try { native = requireNative(ctx); } catch (error) {
    return { status: 'refused', artifacts: [], unknowns: [], reason: error instanceof Error ? error.message : String(error) };
  }
  const { parentRegistry, subagents } = native;
  const parent = (parentRegistry as unknown as { get(id: string): Agent | undefined }).get(request.parentSessionId);
  if (!parent) return { status: 'refused', artifacts: [], unknowns: [], reason: 'The exact direct parent is not live.' };
  const requestDigest = createHash('sha256').update(stable(request)).digest('hex');
  const admitted = await authority.admitCancel({ ...request, requestDigest });
  if (admitted.kind === 'refused') return { status: 'refused', artifacts: [], unknowns: [], reason: admitted.reason };
  if (admitted.kind === 'duplicate') return { status: 'duplicate', receipt: { requestDigest,
    childSessionId: request.childSessionId, effect: admitted.effect }, artifacts: [], unknowns: admitted.effect === 'unknown' ? ['The prior stop request has no confirmed quiescence.'] : [] };
  try {
    subagents.interrupt(request.childSessionId, { kind: 'ancestor', agent: parent });
    const child = (parentRegistry as unknown as { get(id: string): Agent | undefined }).get(request.childSessionId);
    const effect = child?.status === 'idle' ? 'confirmed' : 'unknown';
    await authority.recordCancel({ ...request, requestDigest, reservationId: admitted.reservationId,
      effect, ...(effect === 'unknown' ? { reason: 'Native interrupt is accepted before quiescence.' } : {}) });
    return { status: 'accepted', receipt: { requestDigest, reservationId: admitted.reservationId,
      childSessionId: request.childSessionId, effect }, artifacts: [], unknowns: effect === 'unknown' ? ['Stop was requested but child quiescence is not yet observed.'] : [] };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    try { await authority.recordCancel({ ...request, requestDigest, reservationId: admitted.reservationId, effect: 'unknown', reason }); } catch { /* preserve native failure */ }
    return { status: 'uncertain', receipt: { requestDigest, reservationId: admitted.reservationId,
      childSessionId: request.childSessionId, effect: 'unknown' }, artifacts: [], unknowns: ['Native stop acceptance is unknown.'], reason };
  }
}

export interface DelegationTranscriptView {
  readonly childSessionId: string;
  readonly source: 'native-live-session';
  readonly availability: 'available';
  /** Complete native messages, including tool calls/results and their durable source metadata. */
  readonly nativeMessages: ReturnType<Agent['session']['deriveMessages']>;
  /** Bounded text projection for simple Host summaries; nativeMessages remains authoritative. */
  readonly messages: readonly { readonly role: string; readonly text: string; readonly source: string }[];
  readonly lastAssistantText?: string;
}

/** Read only actual native Session messages; an absent live child is reported, never reconstructed. */
export function readDelegationTranscript(ctx: Context, childSessionId: string): DelegationTranscriptView | { readonly childSessionId: string; readonly source: 'native-session'; readonly availability: 'unavailable'; readonly reason: string } {
  const child = ctx.get('agents')?.get(childSessionId as never);
  if (!child) return { childSessionId, source: 'native-session', availability: 'unavailable', reason: 'The child is not live; C2 owns persisted transcript reopening and no history is synthesized here.' };
  const messages = child.session.deriveMessages().map((message) => ({ role: message.role,
    text: message.content.filter((block) => block.type === 'text').map((block) => block.text).join('\n'), source: message.source.kind }));
  const lastAssistantText = messages.findLast((message) => message.role === 'assistant' && message.text !== '')?.text;
  return { childSessionId, source: 'native-live-session', availability: 'available', nativeMessages: child.session.deriveMessages(), messages,
    ...(lastAssistantText === undefined ? {} : { lastAssistantText }) };
}

export interface DelegationCandidateResult {
  readonly status: 'candidate' | 'unavailable';
  readonly childSessionId: string;
  /** Native assistant blocks are candidate output only; Fabric/Judge/owner adoption stays separate. */
  readonly output?: readonly ContentBlock[];
  readonly transcript: ReturnType<typeof readDelegationTranscript>;
  readonly source?: 'native-live-session' | 'native-persisted-session';
  readonly completedTurn?: { readonly turn: number; readonly endSeq: number };
  readonly evidence: {
    readonly artifactRefs: readonly { readonly path: string; readonly sha256: string; readonly bytes: number;
      readonly tool: 'write' | 'edit'; readonly toolCallId: string }[];
    readonly diffRefs: readonly { readonly path: string; readonly sha256: string; readonly hunks: number;
      readonly toolCallId: string }[];
    /** Empty unless an admitted tool result itself proves a test invocation and outcome. */
    readonly testRefs: readonly { readonly name: string; readonly status: 'passed' | 'failed'; readonly toolCallId: string }[];
    readonly limitations: readonly string[];
  };
  readonly unknowns: readonly string[];
}

const noEvidence = (limitations: readonly string[] = []) => ({ artifactRefs: [], diffRefs: [], testRefs: [], limitations });

type ToolCallEvent = { readonly seq: number; readonly turn: number; readonly callId: string; readonly name: string; readonly arguments: string };
type ToolResultEvent = { readonly seq: number; readonly turn: number; readonly callId: string; readonly isError: boolean; readonly meta?: unknown };

function toolEvents(events: readonly NativeSessionEvent[], throughSeq: number): { calls: Map<string, ToolCallEvent>; results: ToolResultEvent[] } {
  const calls = new Map<string, ToolCallEvent>(); const results: ToolResultEvent[] = [];
  for (const event of events) {
    if (event.seq > throughSeq || !event.data || typeof event.data !== 'object') continue;
    const data = event.data as Record<string, unknown>;
    if (event.type === 'tool/call' && Number.isSafeInteger(data.turn) && typeof data.callId === 'string'
        && typeof data.name === 'string' && typeof data.arguments === 'string') {
      calls.set(data.callId, { seq: event.seq, turn: data.turn as number, callId: data.callId, name: data.name, arguments: data.arguments });
    }
    if (event.type === 'tool/result' && Number.isSafeInteger(data.turn)) {
      const message = data.message;
      if (!message || typeof message !== 'object') continue;
      const blocks = (message as { content?: unknown }).content;
      const block = Array.isArray(blocks) ? blocks[0] as { type?: unknown; toolCallId?: unknown; isError?: unknown } | undefined : undefined;
      if (block?.type !== 'tool-result' || typeof block.toolCallId !== 'string') continue;
      results.push({ seq: event.seq, turn: data.turn as number, callId: block.toolCallId, isError: block.isError === true,
        ...('meta' in data ? { meta: data.meta } : {}) });
    }
  }
  return { calls, results };
}

function diffHunks(meta: unknown): readonly { path: string; oldText: string | null; newText: string }[] | undefined {
  if (!meta || typeof meta !== 'object' || !Array.isArray((meta as { diffs?: unknown }).diffs)) return undefined;
  const diffs = (meta as { diffs: unknown[] }).diffs;
  if (diffs.length === 0 || !diffs.every(item => item && typeof item === 'object'
      && typeof (item as { path?: unknown }).path === 'string'
      && ((item as { oldText?: unknown }).oldText === null || typeof (item as { oldText?: unknown }).oldText === 'string')
      && typeof (item as { newText?: unknown }).newText === 'string')) return undefined;
  return diffs as { path: string; oldText: string | null; newText: string }[];
}

async function resultEvidence(events: readonly NativeSessionEvent[], endSeq: number, effective: EffectiveDelegationContract): Promise<DelegationCandidateResult['evidence']> {
  const root = effective.writeScope?.root;
  if (root === undefined) return noEvidence(['This read-only delegation declared no writable output scope, so it has no verified file, diff, or test references.']);
  const { calls, results } = toolEvents(events, endSeq);
  const artifacts = new Map<string, { path: string; sha256: string; bytes: number; tool: 'write' | 'edit'; toolCallId: string }>();
  const diffRefs: { path: string; sha256: string; hunks: number; toolCallId: string }[] = [];
  const limitations: string[] = [];
  for (const result of results) {
    if (result.isError) continue;
    const call = calls.get(result.callId);
    if (!call || (call.name !== 'write' && call.name !== 'edit') || call.seq >= result.seq) continue;
    let args: { file_path?: unknown };
    try { args = JSON.parse(call.arguments) as { file_path?: unknown }; } catch { continue; }
    if (typeof args.file_path !== 'string' || args.file_path === '') continue;
    const named = path.isAbsolute(args.file_path) ? args.file_path : path.resolve(effective.workspace, args.file_path);
    const target = resolvedTarget(named); const stat = target === undefined ? undefined : lstatSync(target, { throwIfNoEntry: false });
    if (target === undefined || !within(target, root) || !stat?.isFile() || stat.isSymbolicLink()) continue;
    const bytes = await readFile(target);
    const relative = path.relative(root, target) || path.basename(target);
    artifacts.set(relative, { path: relative, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.byteLength,
      tool: call.name, toolCallId: call.callId });
    const hunks = diffHunks(result.meta)?.filter(diff => {
      const at = resolvedTarget(path.isAbsolute(diff.path) ? diff.path : path.resolve(effective.workspace, diff.path));
      return at !== undefined && within(at, root) && at === target;
    });
    if (hunks?.length) diffRefs.push({ path: relative, sha256: createHash('sha256').update(stable(hunks)).digest('hex'), hunks: hunks.length, toolCallId: call.callId });
  }
  if (artifacts.size > 0) limitations.push('Artifact hashes prove the current private-scope bytes reached by successful native write/edit results; no immutable copy was created.');
  else limitations.push('No successful native write/edit result could be matched to a current plain file inside the private task directory.');
  if (diffRefs.length === 0) limitations.push('No validated contextual diff metadata was retained for the successful output tool results.');
  limitations.push('No admitted test tool result was recorded; no test outcome is claimed.');
  return { artifactRefs: [...artifacts.values()], diffRefs, testRefs: [], limitations };
}

/** Read one actual native completed turn, live or cold, without waking or reconstructing an Agent. */
export async function readDelegationResult(ctx: Context, address: { readonly effective: EffectiveDelegationContract;
  readonly requestDigest: string }): Promise<DelegationCandidateResult> {
  const { effective } = address; const childSessionId = effective.childSessionId;
  const transcript = readDelegationTranscript(ctx, childSessionId);
  const unavailable = (reason: string): DelegationCandidateResult => ({ status: 'unavailable', childSessionId, transcript,
    evidence: noEvidence(), unknowns: [reason] });
  const parent = (ctx.get('agents') as unknown as { get(id: string): Agent | undefined } | undefined)?.get(effective.parentSessionId);
  if (!parent) return unavailable('The exact direct parent is not live, so native child lineage cannot be reverified.');
  let lineage: boolean;
  try { lineage = await verifyChild(ctx, parent, childSessionId, effective.workspace,
    `hima:${effective.delegationId}:${address.requestDigest.slice(0, 16)}`); }
  catch (error) { return unavailable(`Native child lineage is unavailable: ${error instanceof Error ? error.message : String(error)}`); }
  if (!lineage) return unavailable('The retained native child identity, parent, workspace, or continuable descriptor does not match this delegation.');
  const query = ctx.get('sessionQuery' as never) as SessionQuery | undefined;
  if (!query) return unavailable('The native SessionQuery service is unavailable.');
  let log: Awaited<ReturnType<SessionQuery['readSession']>>;
  try { log = await query.readSession(childSessionId); }
  catch (error) { return unavailable(`The native child result could not be read: ${error instanceof Error ? error.message : String(error)}`); }
  if (String(log.session.id) !== childSessionId || String(log.session.parentSession) !== effective.parentSessionId
      || log.session.cwd !== effective.workspace) return unavailable('The retained native Session lineage or workspace differs from the effective delegation.');
  const lastEnd = log.events.findLast(event => event.type === 'turn/end');
  const ended = lastEnd?.data as { turn?: unknown; reason?: { kind?: unknown } } | undefined;
  if (!lastEnd || !Number.isSafeInteger(ended?.turn) || ended?.reason?.kind !== 'completed') {
    return unavailable('The latest native child turn has no explicit completed boundary; candidate completion remains unknown.');
  }
  const assistantEvent = log.events.findLast(event => event.seq < lastEnd.seq && event.type === 'assistant/message'
    && (event.data as { turn?: unknown } | undefined)?.turn === ended.turn);
  const assistantData = assistantEvent?.data as { interrupted?: unknown; message?: { role?: unknown; content?: unknown } } | undefined;
  if (!assistantEvent || assistantData?.interrupted === true || assistantData?.message?.role !== 'assistant'
      || !Array.isArray(assistantData.message.content) || assistantData.message.content.length === 0) {
    return unavailable('The explicitly completed native turn has no complete assistant output.');
  }
  const source = ctx.get('agents')?.get(childSessionId as never) ? 'native-live-session' as const : 'native-persisted-session' as const;
  return { status: 'candidate', childSessionId, output: assistantData.message.content as ContentBlock[], transcript, source,
    completedTurn: { turn: ended.turn as number, endSeq: lastEnd.seq }, evidence: await resultEvidence(log.events, lastEnd.seq, effective), unknowns: [] };
}

function pathArgument(execution: Readonly<ToolExecution>, workspace: string): string | undefined {
  const args = execution.arguments as { file_path?: unknown; path?: unknown } | undefined;
  const named = execution.name === 'read' || writeTools.has(execution.name) ? args?.file_path : args?.path;
  // Omitted search roots and relative paths resolve against the child's actual native cwd: the
  // parent workspace. Never reinterpret them as private-scope paths in the guard, because the
  // underlying tool would still reach the broader cwd after admission.
  return typeof named === 'string' && named !== '' ? (path.isAbsolute(named) ? named : path.resolve(workspace, named)) : undefined;
}

function resolvedTarget(named: string): string | undefined {
  const parts: string[] = [];
  let at = path.resolve(named);
  for (let depth = 0; depth <= 32; depth += 1) {
    const stat = lstatSync(at, { throwIfNoEntry: false });
    if (stat) {
      const real = realpathSync(at);
      return path.join(real, ...parts.reverse());
    }
    const parent = path.dirname(at);
    if (parent === at) return undefined;
    parts.push(path.basename(at)); at = parent;
  }
  return undefined;
}

/** Monotonic per-call denial. `lookup` must derive current state from Ledger/Fabric, not cache it. */
export function delegationToolDenial(lookup: DelegationPolicyLookup, execution: Readonly<ToolExecution>): string | undefined {
  const childId = execution.agent === undefined ? undefined : String(execution.agent.id);
  if (childId === undefined) return undefined;
  const policy = lookup(childId);
  if (policy === undefined) return undefined;
  if (!policy.toolsAllowed) return policy.reason ?? `delegated child ${childId} has no current tool grant`;
  if (execution.agent?.options.provider !== policy.effective.model.provider || execution.agent.options.model !== policy.effective.model.model) return `delegated child ${childId} changed its effective model route`;
  if (policy.effective.model.maxTokensPerTurn !== undefined && execution.agent.options.maxTokens !== policy.effective.model.maxTokensPerTurn) return `delegated child ${childId} changed its token limit`;
  if (!policy.effective.tools.includes(execution.name)) return `delegated child ${childId} was not granted tool ${execution.name}`;
  if (terminalTools.has(execution.name) || recursiveTools.has(execution.name)) return `delegated child ${childId} may not open a shell, terminal, or recursive delegation`;
  if (execution.name === delegationInputTool) {
    const args = execution.arguments as { runId?: unknown; recordId?: unknown } | undefined;
    if (!args || args.runId !== policy.effective.runRef?.runId || typeof args.recordId !== 'string' || !policy.effective.inputRefs.includes(args.recordId)) {
      return `delegated child ${childId} may read only its explicitly contracted Run inputs`;
    }
  }
  if (readTools.has(execution.name) || writeTools.has(execution.name)) {
    const scope = policy.effective.readScope?.root;
    if (scope === undefined) return `delegated child ${childId} has no generic file scope`;
    const named = pathArgument(execution, policy.effective.workspace);
    const target = named === undefined ? undefined : resolvedTarget(named);
    if (target === undefined || !within(target, scope)) return `delegated child ${childId} may access files only in its private task directory`;
    if (writeTools.has(execution.name)) {
      const args = execution.arguments as { sandbox_permissions?: unknown } | undefined;
      if (args?.sandbox_permissions !== undefined) return `delegated child ${childId} may not widen its file sandbox`;
      if (!policy.writesAllowed || policy.effective.writeScope === undefined) return policy.reason ?? `delegated child ${childId} has no current write grant`;
      if (!within(target, policy.effective.writeScope.root)) return `delegated child ${childId} may write only inside its guarded private directory`;
    }
  }
  return undefined;
}

export function registerDelegationGuard(ctx: Context, lookup: DelegationPolicyLookup): () => void {
  return ctx.tools.guard((execution) => delegationToolDenial(lookup, execution));
}
