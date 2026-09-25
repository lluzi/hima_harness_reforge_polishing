// Interactive Run authority: one durable Ledger fold over the existing Job,
// Fabric control, Site/Pack binding and the tmux transport in interactive-job.
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { testFixtureCanRunHere } from './interactive-binding.js';
import { z } from 'zod';
import { advance, budgetStanding, ownedWaitedMs } from './budget.js';
import { controlling, identityOf, type FabricDeps } from './fabric.js';
import {
  closeInteractiveJob, observeInteractiveToken, parseInteractiveRecord, readInteractiveTranscript,
  sendInteractiveInput, signalInteractiveJob,
  type InteractiveAddress, type InteractiveAuthority, type InteractiveChannel, type InteractiveCloseResult,
  type InteractiveInputResult, type InteractiveJobIdentity, type InteractiveOpenResult, type InteractiveQualification,
  type InteractiveReceipt, type InteractiveRecord as ProtocolRecord, type InteractiveSession,
  type InteractiveSignalResult, type TranscriptRead,
} from './interactive-job.js';
import { launchInteractiveJob, reconcileInteractiveLaunchReservations, type InteractiveJobLaunchResult, type InteractiveLaunchReservationResult } from './jobs.js';
import type { InteractiveRecord as LedgerInteractiveRecord, JobRecord, Ledger, NodeExecution, RunRecord } from './ledger.js';
import { runExitFence } from './host-exit.js';
import { channelFor } from './channel.js';
import { loadSite } from './sites.js';

export { reconcileInteractiveLaunchReservations } from './jobs.js';
export type { InteractiveLaunchReservationResult } from './jobs.js';

const sha256Pattern = /^[0-9a-f]{64}$/;
const idPattern = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,159}$/;

export interface InteractiveBinding {
  readonly id: string;
  readonly packId: string;
  readonly packDigest: string;
  readonly nodeId: string;
  readonly toolId: string;
  readonly source: { readonly kind: 'admin-file'; readonly path: string; readonly sha256: string }
    | { readonly kind: 'trusted-test-fixture'; readonly id: string };
  readonly adapter: { readonly id: string; readonly version: string; readonly digest: string;
    readonly completionProtocol: 'versioned-marker' | 'none'; readonly allowsMultiline: boolean };
  readonly environment: { readonly id: string; readonly digest: string };
  readonly mutation: 'qualified' | 'unavailable';
  readonly limits: { readonly startupWaitMs: number; readonly callWaitMaxMs: number;
    readonly commandMaxMs: number; readonly sessionMaxMs: number; readonly idleMaxMs: number };
}

export interface DerivedInteractiveOperation {
  readonly binding: InteractiveBinding;
  readonly site: string;
  readonly workspace: string;
  readonly argv: readonly string[];
  readonly name: string;
  readonly licences: Readonly<Record<string, number>>;
}

export interface VerifiedBindingEvidence {
  readonly bindingFileRealpath: string;
  readonly bindingFileSha256: string;
  readonly environmentDigest: string;
  /** Config/evidence hashes identify inputs; only an actual enforcing verifier may say enforced. */
  readonly confinement: 'unqualified' | 'enforced';
  /** Exact Site workspace root whose one derived Campaign child may be mounted writable. */
  readonly writableRoot?: string;
}

export interface EncodedInteractiveCommand {
  readonly text: string;
  readonly submit: boolean;
  readonly effect: 'read' | 'mutation' | 'reply' | 'close';
}

export interface InteractiveRuntimeDeps {
  readonly fabric: FabricDeps;
  /** Resolve only from the retained Pack, admitted execution and Site; never from request argv/path/tool strings. */
  readonly resolveOperation: (run: RunRecord, execution: NodeExecution) => Promise<DerivedInteractiveOperation | undefined>;
  /** Re-read and hash the admin-owned binding/environment at each admission and dispatch. */
  readonly verifyAdminBinding: (binding: InteractiveBinding) => Promise<VerifiedBindingEvidence>;
  /** Encode one typed adapter operation; the host token is supplied separately from model-authored args. */
  readonly encodeCommand: (binding: InteractiveBinding, request: {
    readonly commandId: string; readonly protocolToken: string; readonly name: string; readonly args: unknown;
    readonly replyToCommandId?: string;
  }) => Promise<EncodedInteractiveCommand>;
  /** Existing Site-wide Job/licence serialization. Omission makes interactive open unavailable. */
  readonly claimJobSlot?: (request: { readonly run: RunRecord; readonly site: string;
    readonly licences: Readonly<Record<string, number>>; readonly launch: () => Promise<InteractiveJobLaunchResult> }) => Promise<
      | { readonly kind: 'claimed'; readonly launched: InteractiveJobLaunchResult }
      | { readonly kind: 'at-cap' | 'unreadable' | 'stopped'; readonly reason: string }>;
  /** Explicit test-only qualification. There is no production default. */
  readonly trustedTestQualification?: { readonly bindingId: string };
  readonly now?: () => number;
  readonly mintProtocolToken?: () => string;
  /** Required Host callback: issue the qualified interrupt/close path and record its actual outcome. */
  readonly onDeadline: (deadline: InteractiveDeadline) => Promise<void>;
}

export interface InteractiveSessionView {
  readonly runId: string; readonly executionId: string; readonly nodeId: string; readonly toolSessionId: string;
  readonly status: 'intent' | 'starting' | 'ready' | 'uncertain' | 'closed';
  readonly job?: InteractiveJobIdentity; readonly qualification?: InteractiveQualification;
  readonly transcriptPath?: string; readonly exitPath?: string; readonly sessionDeadlineAt?: string;
  readonly openReceipt?: { readonly status: 'opened'; readonly readiness: 'starting' | 'ready' }
    | { readonly status: 'uncertain' | 'released'; readonly reason: string };
  readonly activeCommand?: { readonly requestId: string; readonly commandId: string; readonly inputDigest: string;
    readonly callerDigest: string; readonly requestDigest: string; readonly operationDigest: string; readonly protocolToken: string; readonly cursorBefore: number;
    readonly commandDeadlineAt: string; readonly state: 'intent' | 'sent' | 'uncertain' };
  readonly lastCursor?: number; readonly reason?: string;
}

export type InteractiveOperateRequest = InteractiveAddress & ({
  readonly action: 'open';
} | {
  readonly action: 'input'; readonly toolSessionId: string; readonly commandId: string;
  readonly command: { readonly name: string; readonly args: unknown }; readonly replyToCommandId?: string; readonly waitMs?: number;
} | {
  readonly action: 'observe'; readonly toolSessionId: string; readonly commandId: string; readonly waitMs?: number;
} | {
  readonly action: 'read'; readonly toolSessionId: string; readonly cursor?: number; readonly maxBytes?: number;
} | {
  readonly action: 'signal'; readonly toolSessionId: string; readonly signal: 'interrupt';
} | {
  readonly action: 'close'; readonly toolSessionId: string;
});

const requestIdentityFields = {
  runId: z.string().min(1), executionId: z.string().min(1), nodeId: z.string().min(1),
  requestId: z.string().regex(idPattern), ownerEpoch: z.number().int().positive(),
  controlRevision: z.number().int().nonnegative(),
};
/** Model/HTTP input: Host actor, argv, workspace and qualification are deliberately absent. */
export const interactiveOperateRequestInput = z.discriminatedUnion('action', [
  z.strictObject({ ...requestIdentityFields, action: z.literal('open') }),
  z.strictObject({ ...requestIdentityFields, action: z.literal('input'), toolSessionId: z.string().min(1),
    commandId: z.string().regex(idPattern), command: z.strictObject({ name: z.string().min(1), args: z.json() }),
    replyToCommandId: z.string().regex(idPattern).optional(), waitMs: z.number().int().min(0).max(60_000).optional() }),
  z.strictObject({ ...requestIdentityFields, action: z.literal('observe'), toolSessionId: z.string().min(1),
    commandId: z.string().regex(idPattern), waitMs: z.number().int().min(0).max(60_000).optional() }),
  z.strictObject({ ...requestIdentityFields, action: z.literal('read'), toolSessionId: z.string().min(1),
    cursor: z.number().int().nonnegative().optional(), maxBytes: z.number().int().min(1).max(1024 * 1024).optional() }),
  z.strictObject({ ...requestIdentityFields, action: z.literal('signal'), toolSessionId: z.string().min(1), signal: z.literal('interrupt') }),
  z.strictObject({ ...requestIdentityFields, action: z.literal('close'), toolSessionId: z.string().min(1) }),
]);

export function parseInteractiveRequest(raw: unknown, actor: string): InteractiveOperateRequest {
  if (actor.trim() === '') throw new Error('interactive request requires the authenticated Host actor');
  const parsed = interactiveOperateRequestInput.parse(raw);
  return { ...parsed, actor } as InteractiveOperateRequest;
}

export type InteractiveOperateResult = InteractiveOpenResult | InteractiveInputResult | InteractiveSignalResult
  | InteractiveCloseResult | { readonly status: 'read'; readonly transcript: TranscriptRead }
  | { readonly status: 'refused'; readonly reason: string };

export interface InteractiveDeadline {
  readonly kind: 'command' | 'idle' | 'session'; readonly runId: string; readonly executionId: string;
  readonly nodeId: string; readonly toolSessionId: string; readonly commandId?: string; readonly at: string;
}

type AdmissionKind = 'open' | 'input' | 'signal' | 'close';

const nowOf = (deps: InteractiveRuntimeDeps): number => deps.now?.() ?? Date.now();
/** Stable caller intent excludes waitMs and control revision so a completed effect remains retryable after time/revision drift. */
export function interactiveCallerDigest(request: InteractiveOperateRequest): string {
  const base = { action: request.action, runId: request.runId, executionId: request.executionId,
    nodeId: request.nodeId, actor: request.actor };
  if (request.action === 'open') return identityOf(base);
  if (request.action === 'input') return identityOf({ ...base, toolSessionId: request.toolSessionId,
    commandId: request.commandId, command: request.command,
    ...(request.replyToCommandId === undefined ? {} : { replyToCommandId: request.replyToCommandId }) });
  if (request.action === 'observe') return identityOf({ ...base, toolSessionId: request.toolSessionId, commandId: request.commandId });
  if (request.action === 'read') return identityOf({ ...base, toolSessionId: request.toolSessionId,
    cursor: request.cursor ?? 0, maxBytes: request.maxBytes ?? 64 * 1024 });
  if (request.action === 'signal') return identityOf({ ...base, toolSessionId: request.toolSessionId, signal: request.signal });
  return identityOf({ ...base, toolSessionId: request.toolSessionId });
}
const within = (candidate: string, root: string): boolean => candidate === root || candidate.startsWith(root.endsWith(path.posix.sep) ? root : root + path.posix.sep);
const protocolRecords = (ledger: Ledger, runId: string): { ledger: LedgerInteractiveRecord; payload: ProtocolRecord }[] =>
  ledger.records({ runId, type: 'interactive' }).filter((item): item is LedgerInteractiveRecord => item.type === 'interactive').map((item) => ({ ledger: item, payload: parseInteractiveRecord(item.payload) }));

function currentExecution(run: RunRecord, executionId: string, nodeId: string, allowSettled = false): NodeExecution | undefined {
  const execution = run.control?.executions[executionId];
  return execution?.nodeId === nodeId && execution.supersededBy === undefined
    && (allowSettled || execution.phase !== 'completed' && execution.phase !== 'failed') ? execution : undefined;
}

function hardDeadline(run: RunRecord, at: number): number | undefined {
  const standing = budgetStanding(run, ownedWaitedMs(run));
  return standing.hardRemainingMs === undefined ? undefined : at + standing.hardRemainingMs;
}

function validateControl(run: RunRecord, request: InteractiveAddress, operation: AdmissionKind, effect?: EncodedInteractiveCommand['effect']): string | undefined {
  const control = run.control;
  if (!control) return 'this historical Run has no conversational owner';
  if (runExitFence(run) && (operation === 'open' || operation === 'input' && effect !== 'read')) return 'the App is closing; no new interactive mutation may start before recovery';
  if (run.status !== 'running' && !['signal', 'close'].includes(operation) && !(operation === 'input' && effect === 'read')) return `run ${run.id} is ${run.status ?? 'not running'}`;
  if (control.stop !== undefined && operation !== 'close' && operation !== 'signal') return 'the Run has a stop request; no new interactive command may start';
  if (control.owner !== request.actor || control.epoch !== request.ownerEpoch || control.revision !== request.controlRevision) return 'owner, epoch or control revision is stale';
  if (!currentExecution(run, request.executionId, request.nodeId, ['signal', 'close'].includes(operation) || operation === 'input' && effect === 'read')) return 'the interactive execution is absent, settled, failed or superseded';
  const execution = run.control?.executions[request.executionId];
  if (operation === 'open' && (execution?.phase !== 'begun' || execution.intent !== undefined
      || execution.jobSession !== undefined || execution.result !== undefined
      || Object.values(control.requests).some((pending) => pending.state === 'admitted'
        && pending.receipt.executionId === request.executionId && pending.receipt.action === 'work'))) {
    return 'interactive open requires the freshly begun execution with no batch Job, launch intent or pending work request';
  }
  const held = control.paused.includes('*') || control.paused.includes(request.nodeId);
  if (held && (operation === 'open' || operation === 'input' && effect !== 'read')) return 'the Run or node is held; new interactive mutation is refused while read-only observation remains available';
  const phase = budgetStanding(run, ownedWaitedMs(run)).phase;
  if (phase === 'exhausted' && !['signal', 'close'].includes(operation) && !(operation === 'input' && effect === 'read')) return 'the original Campaign hard time budget is exhausted';
  if (phase === 'closing' && (operation === 'open' || operation === 'input' && effect !== 'read')) return 'the Campaign is in its closing reserve; no new interactive mutation may start';
  return undefined;
}

function validateBindingShape(run: RunRecord, execution: NodeExecution, derived: DerivedInteractiveOperation): string | undefined {
  const binding = derived.binding;
  if (!idPattern.test(binding.id) || !sha256Pattern.test(binding.packDigest) || !sha256Pattern.test(binding.adapter.digest)
      || !sha256Pattern.test(binding.environment.digest)) return 'interactive binding identities or digests are invalid';
  if (binding.packId !== run.packId || binding.packDigest !== run.packDigest || binding.nodeId !== execution.nodeId) return 'interactive binding does not match the retained Run method and execution';
  if (!path.posix.isAbsolute(derived.workspace) || derived.argv.length === 0 || derived.argv.some((word) => word.includes('\0'))) return 'retained interactive workspace/argv is invalid';
  const limits = binding.limits;
  if (![limits.startupWaitMs, limits.callWaitMaxMs, limits.commandMaxMs, limits.sessionMaxMs, limits.idleMaxMs]
      .every((value) => Number.isSafeInteger(value) && value > 0)) return 'interactive binding limits must be positive safe integers';
  return undefined;
}

async function effectiveQualification(deps: InteractiveRuntimeDeps, derived: DerivedInteractiveOperation): Promise<InteractiveQualification> {
  const binding = derived.binding;
  if (binding.source.kind === 'trusted-test-fixture') {
    if (!testFixtureCanRunHere() || deps.trustedTestQualification?.bindingId !== binding.id
        || deps.trustedTestQualification.bindingId !== binding.source.id) throw new Error('trusted synthetic qualification is not explicitly enabled for this test binding');
    const verified = await deps.verifyAdminBinding(binding);
    if (verified.environmentDigest !== binding.environment.digest) throw new Error('trusted test environment evidence changed or does not match the pinned digest');
  } else {
    if (!path.posix.isAbsolute(binding.source.path)) throw new Error('admin binding path must be absolute');
    const verified = await deps.verifyAdminBinding(binding);
    if (verified.bindingFileSha256 !== binding.source.sha256 || verified.environmentDigest !== binding.environment.digest
        || !sha256Pattern.test(verified.bindingFileSha256) || !path.posix.isAbsolute(verified.bindingFileRealpath)) {
      throw new Error('admin binding/environment digest verification failed');
    }
    const workspace = path.posix.resolve(derived.workspace);
    const bindingPath = path.posix.resolve(verified.bindingFileRealpath);
    if (within(bindingPath, workspace)) throw new Error('admin qualification file is inside the task-writable workspace');
    if (verified.confinement !== 'enforced') throw new Error('interactive environment evidence is identified but confinement is not enforced; production open is unavailable');
    if (verified.writableRoot === undefined || !path.posix.isAbsolute(verified.writableRoot)
        || !within(workspace, path.posix.resolve(verified.writableRoot)) || workspace === path.posix.resolve(verified.writableRoot)) {
      throw new Error('interactive workspace is not a derived Campaign workspace inside the qualified private write root');
    }
  }
  return {
    bindingDigest: identityOf(binding), adapter: { ...binding.adapter }, environment: { ...binding.environment },
    mutation: binding.mutation, testOnly: binding.source.kind === 'trusted-test-fixture',
  };
}

function recordForRequest(records: ReturnType<typeof protocolRecords>, requestId: string): typeof records {
  return records.filter((item) => item.payload.requestId === requestId);
}
const outcomeBase = (record: ProtocolRecord) => ({ runId: record.runId, executionId: record.executionId,
  nodeId: record.nodeId, toolSessionId: record.toolSessionId, requestId: record.requestId,
  actor: record.actor, ownerEpoch: record.ownerEpoch, controlRevision: record.controlRevision,
  callerDigest: record.callerDigest, operationDigest: record.operationDigest, at: record.at });

function lastEvent(records: ReturnType<typeof protocolRecords>, events: readonly string[]): ProtocolRecord | undefined {
  return records.findLast((item) => events.includes(item.payload.event))?.payload;
}

function reconstructSessions(ledger: Ledger, runId: string): InteractiveSessionView[] {
  const records = protocolRecords(ledger, runId);
  const jobs = ledger.records({ runId, type: 'job' }).filter((item): item is JobRecord => item.type === 'job');
  const sessions = new Map<string, InteractiveSessionView>();
  for (const item of records) {
    const record = item.payload;
    const previous = sessions.get(record.toolSessionId);
    if (record.event === 'open-intent') {
      sessions.set(record.toolSessionId, { runId, executionId: record.executionId, nodeId: record.nodeId,
        toolSessionId: record.toolSessionId, status: 'intent', transcriptPath: record.transcriptPath,
        exitPath: record.exitPath, sessionDeadlineAt: record.sessionDeadlineAt });
      continue;
    }
    if (!previous) continue;
    if (record.event === 'opened' || record.event === 'open-uncertain') {
      const job = jobs.findLast((candidate) => candidate.event === 'launched' && candidate.job.session === record.toolSessionId)?.job;
      sessions.set(record.toolSessionId, { ...previous, ...(job === undefined ? {} : { job }), qualification: record.qualification,
        status: record.event === 'open-uncertain' ? 'uncertain' : record.readiness ?? 'starting',
        openReceipt: record.event === 'open-uncertain'
          ? { status: 'uncertain', reason: record.reason ?? 'native open outcome is uncertain' }
          : { status: 'opened', readiness: record.readiness ?? 'starting' },
        ...(record.reason === undefined ? {} : { reason: record.reason }) });
      continue;
    }
    if (record.event === 'open-released') {
      sessions.set(record.toolSessionId, { ...previous, status: 'closed', activeCommand: undefined,
        openReceipt: { status: 'released', reason: record.reason }, reason: record.reason });
      continue;
    }
    if (record.event === 'input-intent') {
      sessions.set(record.toolSessionId, { ...previous, activeCommand: { requestId: record.requestId,
        commandId: record.commandId, inputDigest: record.inputDigest, operationDigest: record.operationDigest,
        callerDigest: record.callerDigest, requestDigest: record.requestDigest, protocolToken: record.protocolToken, cursorBefore: record.cursorBefore,
        commandDeadlineAt: record.commandDeadlineAt, state: 'intent' } });
      continue;
    }
    if ((record.event === 'input-sent' || record.event === 'input-uncertain') && previous.activeCommand?.commandId === record.commandId) {
      sessions.set(record.toolSessionId, { ...previous, activeCommand: { ...previous.activeCommand,
        state: record.event === 'input-sent' ? 'sent' : 'uncertain' }, ...(record.reason === undefined ? {} : { reason: record.reason }) });
      continue;
    }
    if ((record.event === 'command-completed' || record.event === 'command-failed') && previous.activeCommand?.commandId === record.commandId) {
      const { activeCommand: _done, ...rest } = previous;
      sessions.set(record.toolSessionId, { ...rest, ...(record.cursorAfter === undefined ? {} : { lastCursor: record.cursorAfter }) });
      continue;
    }
    if (record.event === 'closed') sessions.set(record.toolSessionId, { ...previous, status: 'closed', activeCommand: undefined });
    if (record.event === 'close-uncertain') sessions.set(record.toolSessionId, { ...previous, status: 'uncertain', reason: record.reason });
  }
  return [...sessions.values()];
}

export const listInteractiveSessions = (ledger: Ledger, runId: string, executionId?: string): InteractiveSessionView[] =>
  reconstructSessions(ledger, runId).filter((session) => executionId === undefined || session.executionId === executionId);

function nativeSession(view: InteractiveSessionView): InteractiveSession | undefined {
  return view.job && view.qualification && view.transcriptPath && view.exitPath && view.sessionDeadlineAt
    ? { job: view.job, toolSessionId: view.toolSessionId, qualification: view.qualification,
      transcriptPath: view.transcriptPath, exitPath: view.exitPath, sessionDeadlineAt: view.sessionDeadlineAt } : undefined;
}

function duplicateReceipt(kind: AdmissionKind, records: ReturnType<typeof protocolRecords>, view?: InteractiveSessionView): InteractiveReceipt {
  if (kind === 'open') {
    const outcome = records.findLast((item) => ['opened', 'open-uncertain', 'open-released'].includes(item.payload.event))?.payload;
    if (outcome?.event === 'open-uncertain') return { status: 'uncertain', reason: outcome.reason ?? 'native open outcome is uncertain' };
    if (outcome?.event === 'open-released') return { status: 'uncertain', reason: outcome.reason };
    const session = view && nativeSession(view);
    return session && outcome?.event === 'opened'
      ? { status: 'duplicate', session, readiness: outcome.readiness ?? 'starting' }
      : { status: 'uncertain', reason: 'open intent has no complete native Job/session receipt' };
  }
  const intent = records[0]?.payload;
  if (kind === 'input' && intent?.event === 'input-intent') {
    const completed = lastEvent(records, ['command-completed', 'command-failed']);
    const uncertain = lastEvent(records, ['input-uncertain']);
    const sent = lastEvent(records, ['input-sent']);
    return uncertain || !sent && !completed ? { status: 'outcome-unknown', commandId: intent.commandId, inputDigest: intent.inputDigest,
      reason: uncertain?.event === 'input-uncertain' ? uncertain.reason ?? 'dispatch outcome is unknown' : 'input intent has no durable dispatch outcome' }
      : { status: 'duplicate', commandId: intent.commandId, inputDigest: intent.inputDigest,
        outcome: completed?.event === 'command-failed' ? 'failed' : completed?.event === 'command-completed' ? 'completed' : 'sent',
        ...((completed?.event === 'command-completed' || completed?.event === 'command-failed') && completed.cursorAfter !== undefined ? { cursorAfter: completed.cursorAfter } : {}) };
  }
  if (kind === 'signal') return lastEvent(records, ['signal-delivered']) ? { status: 'duplicate', process: 'running-or-exited' }
    : { status: 'uncertain', reason: 'signal intent has no delivered receipt' };
  return lastEvent(records, ['closed']) ? { status: 'duplicate', process: 'exited' }
    : { status: 'uncertain', reason: 'close intent has no confirmed process exit' };
}

class RunInteractiveAuthority implements InteractiveAuthority {
  private readonly deps: InteractiveRuntimeDeps;
  private readonly request: InteractiveAddress;
  private readonly derived: DerivedInteractiveOperation;
  private readonly qualification: InteractiveQualification;
  private readonly callerDigest: string;
  constructor(deps: InteractiveRuntimeDeps, request: InteractiveAddress, derived: DerivedInteractiveOperation, qualification: InteractiveQualification, callerDigest: string) {
    this.deps = deps; this.request = request; this.derived = derived; this.qualification = qualification; this.callerDigest = callerDigest;
  }

  async admit(intent: Parameters<InteractiveAuthority['admit']>[0]): ReturnType<InteractiveAuthority['admit']> {
    return controlling(this.deps.fabric, this.request.runId, async () => {
      const run = this.deps.fabric.ledger.run(this.request.runId);
      if (!run) return { kind: 'refused', reason: `unknown Run ${this.request.runId}` };
      if (intent.record.callerDigest !== this.callerDigest) return { kind: 'refused', reason: 'interactive helper intent does not match the retained caller digest' };
      const records = protocolRecords(this.deps.fabric.ledger, run.id);
      const prior = recordForRequest(records, intent.record.requestId);
      if (prior.length > 0) {
        const original = prior.find((item) => item.payload.event.endsWith('-intent'))?.payload;
        if (!original || original.actor !== this.request.actor || original.callerDigest !== this.callerDigest
            || original.event !== intent.record.event) return { kind: 'refused', reason: 'request identity was reused with different action, target, actor or command intent' };
        const view = listInteractiveSessions(this.deps.fabric.ledger, run.id).find((item) => item.toolSessionId === original.toolSessionId);
        return { kind: 'duplicate', receipt: duplicateReceipt(intent.action, prior, view) };
      }
      const effect = intent.action === 'input' ? intent.record.effect : undefined;
      const refused = validateControl(run, this.request, intent.action, effect);
      if (refused) return { kind: 'refused', reason: refused };
      const freshExecution = currentExecution(run, this.request.executionId, this.request.nodeId,
        intent.action === 'signal' || intent.action === 'close' || intent.action === 'input' && effect === 'read');
      if (!freshExecution) return { kind: 'refused', reason: 'interactive execution is no longer current' };
      let fresh: DerivedInteractiveOperation | undefined;
      try { fresh = await this.deps.resolveOperation(run, freshExecution); }
      catch (error) { return { kind: 'refused', reason: error instanceof Error ? error.message : String(error) }; }
      if (!fresh) return { kind: 'refused', reason: 'the retained Pack declares no qualified interactive operation for this execution' };
      const shape = validateBindingShape(run, freshExecution, fresh);
      if (shape) return { kind: 'refused', reason: shape };
      let qualification: InteractiveQualification;
      try { qualification = await effectiveQualification(this.deps, fresh); }
      catch (error) { return { kind: 'refused', reason: error instanceof Error ? error.message : String(error) }; }
      if (identityOf(qualification) !== identityOf(this.qualification)) return { kind: 'refused', reason: 'interactive qualification changed since the operation was resolved' };
      const view = listInteractiveSessions(this.deps.fabric.ledger, run.id).find((item) => item.toolSessionId === intent.record.toolSessionId);
      if (intent.action === 'open' && listInteractiveSessions(this.deps.fabric.ledger, run.id, this.request.executionId)
        .some((session) => session.nodeId === this.request.nodeId && session.status !== 'closed')) {
        return { kind: 'refused', reason: 'this execution already has an open or uncertain interactive Job' };
      }
      if (intent.action === 'input' && view?.activeCommand !== undefined) {
        const reply = view.activeCommand.state === 'sent' && intent.record.effect === 'reply'
          && intent.record.replyToCommandId === view.activeCommand.commandId;
        if (!reply) return { kind: 'refused', reason: `interactive command ${view.activeCommand.commandId} still owns the single-writer lease (${view.activeCommand.state})` };
      }
      const appended = await this.deps.fabric.ledger.appendInteractive(run.id, {
        executionId: intent.record.executionId, toolSessionId: intent.record.toolSessionId,
        requestId: intent.record.requestId, event: intent.record.event, payload: intent.record as never,
      });
      return { kind: 'reserved', reservationId: appended.id, qualification };
    });
  }

  async authorizeBeforeDispatch(input: Parameters<InteractiveAuthority['authorizeBeforeDispatch']>[0]): ReturnType<InteractiveAuthority['authorizeBeforeDispatch']> {
    return controlling(this.deps.fabric, this.request.runId, async () => {
      const run = this.deps.fabric.ledger.run(this.request.runId);
      if (!run) return { kind: 'refused', reason: `unknown Run ${this.request.runId}` };
      const reservation = this.deps.fabric.ledger.records({ runId: run.id, type: 'interactive' })
        .find((record): record is LedgerInteractiveRecord => record.type === 'interactive' && record.id === input.reservationId);
      if (!reservation) return { kind: 'refused', reason: 'interactive reservation is absent after restart or rollback' };
      const intent = parseInteractiveRecord(reservation.payload);
      if (intent.operationDigest !== input.operationDigest) return { kind: 'refused', reason: 'interactive reservation digest does not match dispatch' };
      const effect = intent.event === 'input-intent' ? intent.effect : undefined;
      const action: AdmissionKind = intent.event === 'open-intent' ? 'open' : intent.event === 'input-intent' ? 'input'
        : intent.event === 'signal-intent' ? 'signal' : 'close';
      const refused = validateControl(run, this.request, action, effect);
      if (refused) return { kind: 'refused', reason: refused };
      if (intent.event === 'input-intent') {
        const session = listInteractiveSessions(this.deps.fabric.ledger, run.id).find((item) => item.toolSessionId === intent.toolSessionId);
        if (!session?.sessionDeadlineAt || nowOf(this.deps) >= Date.parse(session.sessionDeadlineAt)) return { kind: 'refused', reason: 'interactive session deadline is exhausted' };
        if (nowOf(this.deps) >= Date.parse(intent.commandDeadlineAt)) return { kind: 'refused', reason: 'interactive command deadline is exhausted' };
      }
      let current: InteractiveQualification;
      try { current = await effectiveQualification(this.deps, this.derived); }
      catch (error) { return { kind: 'refused', reason: error instanceof Error ? error.message : String(error) }; }
      return identityOf(current) === identityOf(this.qualification) ? { kind: 'authorized', qualification: current }
        : { kind: 'refused', reason: 'interactive adapter/environment qualification changed before dispatch' };
    });
  }

  async record(record: ProtocolRecord): Promise<void> {
    const parsed = parseInteractiveRecord(record);
    await controlling(this.deps.fabric, this.request.runId, async () => {
      if (parsed.runId !== this.request.runId || parsed.executionId !== this.request.executionId
          || parsed.nodeId !== this.request.nodeId || parsed.actor !== this.request.actor
          || parsed.ownerEpoch !== this.request.ownerEpoch) throw new Error('interactive outcome identity does not match its runtime authority');
      const intents = protocolRecords(this.deps.fabric.ledger, this.request.runId).filter((item) =>
        item.payload.requestId === parsed.requestId && item.payload.operationDigest === parsed.operationDigest
        && item.payload.callerDigest === parsed.callerDigest);
      if (intents.length === 0) throw new Error('interactive outcome has no durable matching intent');
      await this.deps.fabric.ledger.appendInteractive(this.request.runId, {
        executionId: parsed.executionId, toolSessionId: parsed.toolSessionId,
        requestId: parsed.requestId, event: parsed.event, payload: parsed as never,
      });
    });
  }

  async recordJobLaunch(job: InteractiveJobIdentity): Promise<void> {
    await controlling(this.deps.fabric, this.request.runId, async () => {
      const run = this.deps.fabric.ledger.run(this.request.runId);
      if (!run) throw new Error(`unknown Run ${this.request.runId}`);
      const refused = validateControl(run, this.request, 'open');
      if (refused) throw new Error(refused);
      await this.deps.fabric.ledger.appendJob(run.id, { event: 'launched', job,
        nodeId: this.request.nodeId, ...(Object.keys(this.derived.licences).length === 0 ? {} : { licences: { ...this.derived.licences } }) });
      await advance(this.deps.fabric.ledger, run.id, { jobs: 1 });
    });
  }

  async recordJobStop(job: InteractiveJobIdentity, outcome: { readonly wasRunning: boolean; readonly observedGone: boolean }): Promise<void> {
    if (!outcome.wasRunning || !outcome.observedGone) return;
    await controlling(this.deps.fabric, this.request.runId, async () => {
      const ended = this.deps.fabric.ledger.records({ runId: this.request.runId, type: 'job' })
        .some((record) => record.type === 'job' && record.job.session === job.session && record.event !== 'launched');
      if (!ended) await this.deps.fabric.ledger.appendJob(this.request.runId, { event: 'killed', job, nodeId: this.request.nodeId });
    });
  }
}

async function resolved(deps: InteractiveRuntimeDeps, request: InteractiveAddress, operation: AdmissionKind, effect?: EncodedInteractiveCommand['effect']): Promise<{
  run: RunRecord; execution: NodeExecution; derived: DerivedInteractiveOperation; qualification: InteractiveQualification;
} | { reason: string }> {
  const run = deps.fabric.ledger.run(request.runId);
  if (!run) return { reason: `unknown Run ${request.runId}` };
  const refused = validateControl(run, request, operation, effect);
  if (refused && !refused.includes('held')) return { reason: refused };
  const execution = currentExecution(run, request.executionId, request.nodeId,
    ['signal', 'close'].includes(operation) || operation === 'input' && effect === 'read');
  if (!execution) return { reason: 'interactive execution is no longer current' };
  let derived: DerivedInteractiveOperation | undefined;
  try { derived = await deps.resolveOperation(run, execution); }
  catch (error) { return { reason: error instanceof Error ? error.message : String(error) }; }
  if (!derived) return { reason: 'the retained Pack declares no interactive operation for this execution' };
  const shape = validateBindingShape(run, execution, derived);
  if (shape) return { reason: shape };
  try { return { run, execution, derived, qualification: await effectiveQualification(deps, derived) }; }
  catch (error) { return { reason: error instanceof Error ? error.message : String(error) }; }
}

function sessionFor(ledger: Ledger, request: InteractiveAddress & { readonly toolSessionId: string }): InteractiveSessionView | undefined {
  return listInteractiveSessions(ledger, request.runId, request.executionId)
    .find((session) => session.toolSessionId === request.toolSessionId && session.nodeId === request.nodeId);
}

export async function operateInteractive(deps: InteractiveRuntimeDeps, request: InteractiveOperateRequest): Promise<InteractiveOperateResult> {
  if (!idPattern.test(request.requestId)) return { status: 'refused', reason: 'interactive requestId is invalid' };
  const callerDigest = interactiveCallerDigest(request);
  const operation: AdmissionKind = request.action === 'open' ? 'open' : request.action === 'signal' ? 'signal'
    : request.action === 'close' ? 'close' : 'input';
  const retained = recordForRequest(protocolRecords(deps.fabric.ledger, request.runId), request.requestId);
  if (retained.length > 0) {
    const original = retained.find((item) => item.payload.event.endsWith('-intent'))?.payload;
    const expectedEvent = request.action === 'open' ? 'open-intent' : request.action === 'input' ? 'input-intent'
      : request.action === 'signal' ? 'signal-intent' : request.action === 'close' ? 'close-intent' : undefined;
    if (!original || expectedEvent === undefined || original.event !== expectedEvent
        || original.actor !== request.actor || original.callerDigest !== callerDigest) {
      return { status: 'refused', reason: 'request identity was reused with different action, target, actor or typed command intent' };
    }
    const view = listInteractiveSessions(deps.fabric.ledger, request.runId)
      .find((item) => item.toolSessionId === original.toolSessionId);
    return duplicateReceipt(operation, retained, view);
  }
  // Typed input resolves the retained adapter under read-only admission first; the encoder then
  // classifies the exact command and the locked intent admission enforces its actual effect.
  const facts = await resolved(deps, request, operation,
    request.action === 'read' || request.action === 'observe' || request.action === 'input' ? 'read' : undefined);
  if ('reason' in facts) return { status: 'refused', reason: facts.reason };
  const authority = new RunInteractiveAuthority(deps, request, facts.derived, facts.qualification, callerDigest);
  if (request.action === 'open') {
    if (!deps.claimJobSlot) return { status: 'refused', reason: 'interactive Job/licence slot authority is unavailable' };
    const refused = validateControl(facts.run, request, 'open');
    if (refused) return { status: 'refused', reason: refused };
    const at = nowOf(deps); const runDeadline = hardDeadline(facts.run, at);
    const sessionDeadline = Math.min(at + facts.derived.binding.limits.sessionMaxMs, runDeadline ?? Number.MAX_SAFE_INTEGER);
    const claimed = await deps.claimJobSlot({ run: facts.run, site: facts.derived.site, licences: facts.derived.licences,
      launch: () => launchInteractiveJob({ ledger: deps.fabric.ledger, sitesDir: deps.fabric.sitesDir }, {
        site: facts.derived.site, run: request.runId, executionId: request.executionId, nodeId: request.nodeId,
        requestId: request.requestId, callerDigest, actor: request.actor, ownerEpoch: request.ownerEpoch,
        controlRevision: request.controlRevision, workspace: facts.derived.workspace, argv: facts.derived.argv,
        name: facts.derived.name, sessionDeadlineAt: new Date(sessionDeadline).toISOString(),
        startupWaitMs: facts.derived.binding.limits.startupWaitMs,
      }, authority) });
    return claimed.kind === 'claimed' ? claimed.launched.result : { status: 'refused', reason: claimed.reason };
  }
  const view = sessionFor(deps.fabric.ledger, request);
  const session = view && nativeSession(view);
  if (!view || !session) return { status: 'refused', reason: 'interactive session is absent, incomplete or not owned by this execution' };
  const on: InteractiveChannel = channelFor(loadSite(deps.fabric.sitesDir, facts.run.siteId));
  if (request.action === 'read') {
    const refused = validateControl(facts.run, request, 'input', 'read');
    if (refused && !refused.includes('held')) return { status: 'refused', reason: refused };
    return { status: 'read', transcript: await readInteractiveTranscript(on, session, request.cursor ?? 0, request.maxBytes ?? 64 * 1024) };
  }
  if (request.action === 'observe') {
    const command = view.activeCommand;
    if (!command || command.commandId !== request.commandId) return { status: 'refused', reason: 'the named command is not the active durable single-writer lease' };
    return observeInteractiveToken(on, { ...request, requestId: command.requestId, session, protocolToken: command.protocolToken,
      callerDigest: command.callerDigest,
      inputDigest: command.inputDigest, operationDigest: command.operationDigest,
      cursorBefore: command.cursorBefore, waitMs: Math.min(request.waitMs ?? 0, facts.derived.binding.limits.callWaitMaxMs) }, authority);
  }
  if (request.action === 'input') {
    if (view.status !== 'ready') return { status: 'refused', reason: `interactive mutation requires one ready admitted session; current state is ${view.status}` };
    const requestDigest = callerDigest;
    const token = deps.mintProtocolToken?.() ?? randomBytes(24).toString('base64url');
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) return { status: 'refused', reason: 'Host protocol-token mint returned an invalid token' };
    let encoded: EncodedInteractiveCommand;
    try { encoded = await deps.encodeCommand(facts.derived.binding, { commandId: request.commandId,
      protocolToken: token, name: request.command.name, args: request.command.args,
      ...(request.replyToCommandId === undefined ? {} : { replyToCommandId: request.replyToCommandId }) }); }
    catch (error) { return { status: 'refused', reason: error instanceof Error ? error.message : String(error) }; }
    const refused = validateControl(facts.run, request, 'input', encoded.effect);
    if (refused) return { status: 'refused', reason: refused };
    if (encoded.effect === 'mutation' && facts.qualification.mutation !== 'qualified') return { status: 'refused', reason: 'mutation is unavailable for this exact adapter/environment binding' };
    const at = nowOf(deps); const runDeadline = hardDeadline(facts.run, at);
    const commandDeadline = Math.min(at + facts.derived.binding.limits.commandMaxMs,
      Date.parse(session.sessionDeadlineAt), runDeadline ?? Number.MAX_SAFE_INTEGER);
    return sendInteractiveInput(on, { ...request, session, callerDigest, protocolToken: token, requestDigest, text: encoded.text,
      submit: encoded.submit, effect: encoded.effect, cursorBefore: view.lastCursor ?? 0,
      waitMs: Math.min(request.waitMs ?? 0, facts.derived.binding.limits.callWaitMaxMs),
      commandDeadlineAt: new Date(commandDeadline).toISOString() }, authority);
  }
  if (request.action === 'signal') return signalInteractiveJob(on, { ...request, callerDigest, session }, authority);
  return closeInteractiveJob(on, { ...request, callerDigest, session }, authority);
}

export interface InteractiveTimerController {
  reconcile(): Promise<readonly InteractiveDeadline[]>;
  dispose(): void;
}

/**
 * Turn pre-crash intents into durable uncertainty before any route can consider retrying them.
 * It never sends transport input and never manufactures a Job outcome.
 */
export async function reconcileInteractiveState(deps: InteractiveRuntimeDeps): Promise<InteractiveSessionView[]> {
  for (const siteName of new Set(deps.fabric.ledger.runs().map((run) => run.siteId))) {
    await reconcileInteractiveLaunchReservations({ ledger: deps.fabric.ledger, sitesDir: deps.fabric.sitesDir }, siteName);
  }
  for (const run of deps.fabric.ledger.runs()) await controlling(deps.fabric, run.id, async () => {
    const records = protocolRecords(deps.fabric.ledger, run.id);
    for (const candidate of records.filter((item) => ['open-intent', 'input-intent', 'signal-intent', 'close-intent'].includes(item.payload.event))) {
      const intent = candidate.payload;
      const same = records.filter((item) => item.payload.requestId === intent.requestId
        && item.payload.operationDigest === intent.operationDigest && item.ledger.seq > candidate.ledger.seq);
      const settled = same.some((item) => {
        if (intent.event === 'open-intent') return ['opened', 'open-uncertain', 'open-released'].includes(item.payload.event);
        if (intent.event === 'input-intent') return ['input-sent', 'input-uncertain', 'command-completed', 'command-failed'].includes(item.payload.event);
        if (intent.event === 'signal-intent') return ['signal-delivered', 'signal-uncertain'].includes(item.payload.event);
        return ['closed', 'close-uncertain'].includes(item.payload.event);
      });
      if (settled) continue;
      let outcome: ProtocolRecord;
      if (intent.event === 'open-intent') {
        const execution = currentExecution(run, intent.executionId, intent.nodeId);
        let derived: DerivedInteractiveOperation | undefined;
        try { derived = execution ? await deps.resolveOperation(run, execution) : undefined; } catch { derived = undefined; }
        if (!derived) continue;
        let qualified: InteractiveQualification;
        try { qualified = await effectiveQualification(deps, derived); } catch { continue; }
        outcome = parseInteractiveRecord({ ...outcomeBase(intent), event: 'open-uncertain', jobSession: intent.jobSession,
          qualification: qualified, reason: 'Host restarted with an open intent lacking a confirmed native receipt', at: new Date(nowOf(deps)).toISOString() });
      } else if (intent.event === 'input-intent') {
        outcome = parseInteractiveRecord({ ...outcomeBase(intent), event: 'input-uncertain', commandId: intent.commandId,
          inputDigest: intent.inputDigest, reason: 'Host restarted with an input intent lacking a confirmed dispatch receipt', at: new Date(nowOf(deps)).toISOString() });
      } else if (intent.event === 'signal-intent') {
        outcome = parseInteractiveRecord({ ...outcomeBase(intent), event: 'signal-uncertain', signal: intent.signal,
          reason: 'Host restarted with a signal intent lacking a delivered receipt', at: new Date(nowOf(deps)).toISOString() });
      } else {
        outcome = parseInteractiveRecord({ ...outcomeBase(intent), event: 'close-uncertain',
          reason: 'Host restarted with a close intent lacking a confirmed exit receipt', at: new Date(nowOf(deps)).toISOString() });
      }
      await deps.fabric.ledger.appendInteractive(run.id, { executionId: outcome.executionId,
        toolSessionId: outcome.toolSessionId, requestId: outcome.requestId, event: outcome.event, payload: outcome as never });
    }
  });
  return deps.fabric.ledger.runs().flatMap((run) => listInteractiveSessions(deps.fabric.ledger, run.id));
}

/** Process-local timers project durable absolute deadlines; disposal never stops a Job by itself. */
export function createInteractiveTimerController(deps: InteractiveRuntimeDeps): InteractiveTimerController {
  const timers = new Map<string, ReturnType<typeof setTimeout>>(); let disposed = false;
  const schedule = (deadline: InteractiveDeadline): void => {
    const key = `${deadline.kind}:${deadline.runId}:${deadline.toolSessionId}:${deadline.commandId ?? ''}`;
    if (timers.has(key) || disposed) return;
    const fire = (): void => {
      if (disposed) return;
      const remaining = Date.parse(deadline.at) - nowOf(deps);
      if (remaining > 0) { timers.set(key, setTimeout(fire, Math.min(remaining, 2_147_000_000))); return; }
      timers.delete(key);
      void deps.onDeadline(deadline).catch((error) => deps.fabric.log?.(`interactive deadline callback failed for ${deadline.toolSessionId}: ${String(error)}`));
    };
    fire();
  };
  return {
    async reconcile() {
      await reconcileInteractiveState(deps);
      const deadlines: InteractiveDeadline[] = [];
      for (const run of deps.fabric.ledger.runs()) for (const session of listInteractiveSessions(deps.fabric.ledger, run.id)) {
        if (session.status === 'closed') continue;
        if (session.sessionDeadlineAt) deadlines.push({ kind: 'session', runId: run.id, executionId: session.executionId,
          nodeId: session.nodeId, toolSessionId: session.toolSessionId, at: session.sessionDeadlineAt });
        if (session.activeCommand) deadlines.push({ kind: 'command', runId: run.id, executionId: session.executionId,
          nodeId: session.nodeId, toolSessionId: session.toolSessionId,
          commandId: session.activeCommand.commandId, at: session.activeCommand.commandDeadlineAt });
        else {
          const execution = currentExecution(run, session.executionId, session.nodeId);
          let derived: DerivedInteractiveOperation | undefined;
          try { derived = execution ? await deps.resolveOperation(run, execution) : undefined; } catch { derived = undefined; }
          if (derived) {
            const latest = deps.fabric.ledger.records({ runId: run.id, type: 'interactive' })
              .filter((record): record is LedgerInteractiveRecord => record.type === 'interactive' && record.toolSessionId === session.toolSessionId).at(-1);
            if (latest) {
              const idleAt = Math.min(Date.parse(latest.at) + derived.binding.limits.idleMaxMs,
                session.sessionDeadlineAt === undefined ? Number.MAX_SAFE_INTEGER : Date.parse(session.sessionDeadlineAt));
              deadlines.push({ kind: 'idle', runId: run.id, executionId: session.executionId,
                nodeId: session.nodeId, toolSessionId: session.toolSessionId, at: new Date(idleAt).toISOString() });
            }
          }
        }
      }
      const current = new Set(deadlines.map((deadline) => `${deadline.kind}:${deadline.runId}:${deadline.toolSessionId}:${deadline.commandId ?? ''}`));
      for (const [key, timer] of timers) if (!current.has(key)) { clearTimeout(timer); timers.delete(key); }
      for (const deadline of deadlines) schedule(deadline);
      return deadlines;
    },
    dispose() { disposed = true; for (const timer of timers.values()) clearTimeout(timer); timers.clear(); },
  };
}
