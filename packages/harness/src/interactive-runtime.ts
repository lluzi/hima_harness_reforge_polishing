// Interactive operation contract: request parsing, admin binding qualification and the fold of
// recorded interactive protocol facts. DBOS tasks operate sessions through task-interactive; the
// historical Ledger fold stays readable here.
import path from 'node:path';
import { testFixtureCanRunHere } from './interactive-binding.js';
import { z } from 'zod';
import { identityOf } from './fabric.js';
import { parseInteractiveRecord, type InteractiveAddress, type InteractiveCloseResult, type InteractiveInputResult, type InteractiveJobIdentity, type InteractiveOpenResult, type InteractiveQualification, type InteractiveReceipt, type InteractiveRecord as ProtocolRecord, type InteractiveSession, type InteractiveSignalResult, type TranscriptRead } from './interactive-job.js';
import type { InteractiveRecord as LedgerInteractiveRecord, JobRecord, Ledger } from './ledger.js';
import type { InteractiveCommandContract } from './packs.js';


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
    readonly commandMaxMs: number; readonly sessionMaxMs: number; readonly idleMaxMs: number;
    /** The retained tool's declared close grace (`interactive.closeGraceMs`); the default when absent. */
    readonly closeGraceMs?: number };
}

export interface DerivedInteractiveOperation {
  readonly binding: InteractiveBinding;
  readonly site: string;
  readonly workspace: string;
  readonly argv: readonly string[];
  readonly name: string;
  readonly licences: Readonly<Record<string, number>>;
  /** Exact retained Pack command surface shown to a qualified Operator child. */
  readonly commands: readonly InteractiveCommandContract[];
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

export interface InteractiveSessionView {
  readonly runId: string; readonly executionId: string; readonly nodeId: string; readonly toolSessionId: string;
  /** Authenticated child that opened this session; production follow-up operations stay bound to it. */
  readonly operatorSessionId: string;
  readonly status: 'intent' | 'starting' | 'ready' | 'uncertain' | 'closed';
  readonly job?: InteractiveJobIdentity; readonly qualification?: InteractiveQualification;
  readonly transcriptPath?: string; readonly exitPath?: string; readonly sessionDeadlineAt?: string;
  readonly openReceipt?: { readonly status: 'opened'; readonly readiness: 'starting' | 'ready' }
    | { readonly status: 'uncertain' | 'released'; readonly reason: string };
  readonly activeCommand?: { readonly requestId: string; readonly commandId: string; readonly inputDigest: string;
    readonly callerDigest: string; readonly requestDigest: string; readonly operationDigest: string; readonly protocolToken: string; readonly cursorBefore: number;
    readonly commandDeadlineAt: string; readonly state: 'intent' | 'sent' | 'uncertain' };
  readonly lastCursor?: number; readonly reason?: string;
  /** The Job's process group a close recorded as surviving hangup and TERM (#64 D-T01-3). */
  readonly survivedPid?: number;
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
  requestId: z.string().regex(idPattern), ownerEpoch: z.number().int().nonnegative(),
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

type AdmissionKind = 'open' | 'input' | 'signal' | 'close';

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

export async function qualifyInteractiveOperation(deps: {
  /** Re-read and hash the admin-owned binding/environment at each admission and dispatch. */
  readonly verifyAdminBinding: (binding: InteractiveBinding) => Promise<VerifiedBindingEvidence>;
  /** Explicit test-only qualification. There is no production default. */
  readonly trustedTestQualification?: { readonly bindingId: string };
}, derived: DerivedInteractiveOperation): Promise<InteractiveQualification> {
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

function lastEvent(records: readonly { readonly payload: ProtocolRecord }[], events: readonly string[]): ProtocolRecord | undefined {
  return records.findLast((item) => events.includes(item.payload.event))?.payload;
}

export function foldInteractiveSessions(runId: string, payloads: readonly ProtocolRecord[],
  jobs: readonly { readonly event: string; readonly job: InteractiveJobIdentity }[]): InteractiveSessionView[] {
  const records = payloads.map(payload => ({ payload }));
  const sessions = new Map<string, InteractiveSessionView>();
  for (const item of records) {
    const record = item.payload;
    const previous = sessions.get(record.toolSessionId);
    if (record.event === 'open-intent') {
      sessions.set(record.toolSessionId, { runId, executionId: record.executionId, nodeId: record.nodeId,
        toolSessionId: record.toolSessionId, operatorSessionId: record.actor, status: 'intent', transcriptPath: record.transcriptPath,
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
    if (record.event === 'close-uncertain' || record.event === 'process-survived') sessions.set(record.toolSessionId, { ...previous, status: 'uncertain', reason: record.reason,
      ...(record.event === 'process-survived' && record.pid !== undefined ? { survivedPid: record.pid } : {}) });
  }
  return [...sessions.values()].map((session) => {
    // A finished Job is authoritative process exit even when the tool's normal
    // exit did not produce an interactive closed receipt. Keep command evidence:
    // process exit alone does not prove an in-flight command completed.
    const finished = jobs.some((record) => record.event === 'finished' && record.job.session === session.toolSessionId);
    return finished ? { ...session, status: 'closed' as const } : session;
  });
}

export const listInteractiveSessions = (ledger: Ledger, runId: string, executionId?: string): InteractiveSessionView[] =>
  foldInteractiveSessions(runId, protocolRecords(ledger, runId).map(item => item.payload),
    ledger.records({ runId, type: 'job' }).filter((item): item is JobRecord => item.type === 'job')).filter((session) => executionId === undefined || session.executionId === executionId);

export function nativeInteractiveSession(view: InteractiveSessionView): InteractiveSession | undefined {
  return view.job && view.qualification && view.transcriptPath && view.exitPath && view.sessionDeadlineAt
    ? { job: view.job, toolSessionId: view.toolSessionId, qualification: view.qualification,
      transcriptPath: view.transcriptPath, exitPath: view.exitPath, sessionDeadlineAt: view.sessionDeadlineAt } : undefined;
}

export function interactiveDuplicateReceipt(kind: AdmissionKind, records: readonly { readonly payload: ProtocolRecord }[], view?: InteractiveSessionView): InteractiveReceipt {
  if (kind === 'open') {
    const outcome = records.findLast((item) => ['opened', 'open-uncertain', 'open-released'].includes(item.payload.event))?.payload;
    if (outcome?.event === 'open-uncertain') return { status: 'uncertain', reason: outcome.reason ?? 'native open outcome is uncertain' };
    if (outcome?.event === 'open-released') return { status: 'uncertain', reason: outcome.reason };
    const session = view && nativeInteractiveSession(view);
    return session && outcome?.event === 'opened'
      ? { status: 'duplicate', session, readiness: outcome.readiness ?? 'starting' }
      : { status: 'uncertain', reason: 'open intent has no complete native Job/session receipt' };
  }
  const intent = records[0]?.payload;
  if (kind === 'input' && intent?.event === 'input-intent') {
    const completed = lastEvent(records, ['command-completed', 'command-failed']);
    const uncertain = lastEvent(records, ['input-uncertain']);
    const sent = lastEvent(records, ['input-sent']);
    return uncertain && !completed || !sent && !completed ? { status: 'outcome-unknown', commandId: intent.commandId, inputDigest: intent.inputDigest,
      reason: uncertain?.event === 'input-uncertain' ? uncertain.reason ?? 'dispatch outcome is unknown' : 'input intent has no durable dispatch outcome' }
      : { status: 'duplicate', commandId: intent.commandId, inputDigest: intent.inputDigest,
        outcome: completed?.event === 'command-failed' ? 'failed' : completed?.event === 'command-completed' ? 'completed' : 'sent',
        ...((completed?.event === 'command-completed' || completed?.event === 'command-failed') && completed.cursorAfter !== undefined ? { cursorAfter: completed.cursorAfter } : {}) };
  }
  if (kind === 'signal') return lastEvent(records, ['signal-delivered']) ? { status: 'duplicate', process: 'running-or-exited' }
    : { status: 'uncertain', reason: 'signal intent has no delivered receipt' };
  if (lastEvent(records, ['closed'])) return { status: 'duplicate', process: 'exited' };
  const survived = lastEvent(records, ['process-survived']);
  return survived?.event === 'process-survived' && survived.pid !== undefined
    ? { status: 'process-survived', pid: survived.pid, reason: survived.reason ?? `process group ${String(survived.pid)} survived the close` }
    : { status: 'uncertain', reason: 'close intent has no confirmed process exit' };
}

