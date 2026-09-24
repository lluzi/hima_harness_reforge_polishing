import type {
  ExperienceCandidate,
  ExperienceCorrectionRequest,
  DelegationActionRequest,
  MemorySourcesAnswer,
  MemorySummaryInput,
  NativeSessionContext,
  NativeSessionEvent,
  SessionContextAnswer,
} from './api.js';
import type { RunView } from '../remote.js';

export interface MemoryDraft {
  readonly subject: string;
  readonly decisions: string;
  readonly openQuestions: string;
  readonly todo: string;
}

export const EMPTY_MEMORY_DRAFT: MemoryDraft = { subject: '', decisions: '', openQuestions: '', todo: '' };

export const memoryScopeKey = (sessionId: string, runId?: string): string =>
  JSON.stringify([sessionId, runId ?? null]);

export function memoryEvidenceMatches(evidence: MemorySourcesAnswer, sessionId: string, runId?: string): boolean {
  return runId === undefined
    ? (evidence.scope.kind === 'session' || evidence.scope.kind === 'child') && evidence.scope.sessionId === sessionId
    : evidence.scope.kind === 'campaign' && evidence.scope.runId === runId;
}

const nonemptyLines = (text: string): string[] => text.split('\n').map(line => line.trim()).filter(line => line !== '');

/** Compose only editable text with the exact evidence minted by the Host for this scope. */
export function memorySummaryInput(draft: MemoryDraft, evidence: MemorySourcesAnswer): MemorySummaryInput {
  const subject = draft.subject.trim();
  if (subject === '') throw new Error('Add a subject before saving this work memory.');
  if (evidence.sources.length + (evidence.nativeSources?.length ?? 0) === 0) {
    throw new Error('Refresh verified sources before saving this work memory.');
  }
  return {
    subject,
    decisions: nonemptyLines(draft.decisions),
    openQuestions: nonemptyLines(draft.openQuestions),
    todo: nonemptyLines(draft.todo),
    references: evidence.references,
    sources: evidence.sources,
    nativeSources: evidence.nativeSources,
  };
}

export interface ExperienceCorrectionInput {
  readonly sessionId: string;
  readonly runId: string;
  readonly candidate: ExperienceCandidate;
  readonly reason: string;
  readonly evidenceRefs: readonly string[];
  readonly requestId: string;
}

/** Refuse implicit evidence selection: a correction always records the person's reason and choices. */
export function experienceCorrectionRequest(input: ExperienceCorrectionInput): ExperienceCorrectionRequest {
  const reason = input.reason.trim();
  if (reason === '') throw new Error('Explain why this experience should change.');
  if (input.evidenceRefs.length === 0) throw new Error('Select at least one current evidence record.');
  const available = new Set(input.candidate.availableEvidence.map(evidence => evidence.recordId));
  if (input.evidenceRefs.some(recordId => !available.has(recordId))) throw new Error('A selected evidence record is no longer available.');
  const event = input.candidate.adoption?.event === 'disabled' ? 're-adopted' : 'disabled';
  return {
    sessionId: input.sessionId,
    runId: input.runId,
    requestId: input.requestId,
    event,
    reason,
    candidate: input.candidate.candidate,
    evidenceRefs: [...input.evidenceRefs],
    ...(input.candidate.adoption === undefined ? {} : { supersedes: input.candidate.adoption.id }),
  };
}

export interface SessionTranscript {
  readonly identity: string;
  readonly events: readonly NativeSessionEvent[];
  readonly nextSeq?: number;
  readonly truncated: boolean;
  readonly context: NativeSessionContext;
  readonly asOf: string;
}

/** Append a requested native page; a response for another child identity cannot enter this state. */
export function appendTranscriptPage(identity: string, previous: SessionTranscript | undefined, page: SessionContextAnswer): SessionTranscript {
  if (page.sessionId !== identity) throw new Error('The Host returned a different child session identity.');
  const priorEvents = previous?.identity === identity ? previous.events : [];
  const bySeq = new Map(priorEvents.map(event => [event.seq, event]));
  for (const event of page.events) bySeq.set(event.seq, event);
  return {
    identity,
    events: [...bySeq.values()].sort((left, right) => left.seq - right.seq),
    ...(page.nextSeq === undefined ? {} : { nextSeq: page.nextSeq }),
    truncated: page.truncated === true,
    context: page.context,
    asOf: page.asOf,
  };
}

export function delegationActionRequest(input: {
  readonly sessionId: string;
  readonly runId: string;
  readonly control: NonNullable<RunView['run']['control']>;
  readonly delegationId: string;
  readonly action: DelegationActionRequest['action'];
  readonly text?: string;
  readonly requestId: string;
}): DelegationActionRequest {
  const text = input.text?.trim();
  if (input.action === 'followup' && !text) throw new Error('Write a follow-up for this child first.');
  return {
    sessionId: input.sessionId,
    runId: input.runId,
    action: input.action,
    requestId: input.requestId,
    expectedEpoch: input.control.epoch,
    expectedRevision: input.control.revision,
    delegationId: input.delegationId,
    ...(text === undefined ? {} : { text }),
  };
}
