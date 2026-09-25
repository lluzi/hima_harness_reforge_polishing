// @hima-seam session-query wrapped
// A read-only carrier for summaries of ordinary and child DSH conversations.
//
// The summary itself remains a bounded workspace file.  This module never opens a
// write handle and never appends a DSH event: SessionQuery replays the native log
// and SessionPersistence supplies the durable identity that the summary names.
import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import type { Context } from '@deepseek-ai/cordis';
import type { NativeSessionMemoryEvidence } from './experience.js';

const identity = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');

const headerIdentity = (header: { id: unknown; createdAt: unknown; cwd?: unknown; parentSession?: unknown; version?: unknown }) =>
  identity({ id: header.id, createdAt: header.createdAt, cwd: header.cwd, parentSession: header.parentSession, version: header.version });

type SessionHeader = { readonly id: unknown; readonly createdAt: unknown; readonly cwd?: string; readonly parentSession?: unknown; readonly version?: unknown };
type SessionLog = { readonly session: SessionHeader; readonly events: readonly unknown[] };
type SessionSurface = { readonly session: SessionHeader; readonly events: readonly unknown[]; readonly capturedThroughSeq: unknown };
type SessionQuery = { readSession(id: never): Promise<SessionLog>; readSurface(id: never): Promise<SessionSurface> };
type SessionPersistence = { stat(id: never): Promise<{ readonly header: SessionHeader } | undefined> };

/** Text carried by a native message/event payload. Structural event metadata is deliberately ignored. */
function payloadText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(payloadText).join('');
  if (value && typeof value === 'object') return Object.entries(value).filter(([key]) => !['type', 'id', 'seq', 'time', 'timestamp'].includes(key)).map(([, item]) => payloadText(item)).join('');
  return '';
}
const semanticText = (event: unknown): string =>
  event && typeof event === 'object' && 'data' in event ? payloadText((event as { data: unknown }).data).trim() : '';

/**
 * Read one exact persisted native Session through the pinned public services.
 * A summary is allowed to name it only when the replayed transcript prefix
 * contains semantic text. Empty roots, metadata-only sessions, and
 * unavailable/corrupt logs therefore remain unavailable instead of becoming
 * invented long-term context. The surface is a native
 * projection, not evidence that a provider will retain or inject it as prompt.
 */
export async function nativeSessionMemoryEvidence(ctx: Context, request: {
  readonly sessionId: string;
  readonly workspaceRef: string;
  readonly parentSessionId?: string;
  /** Inclusive native event watermark. Omit only when minting fresh evidence. */
  readonly throughSeq?: number;
}): Promise<NativeSessionMemoryEvidence> {
  const query = ctx.get('sessionQuery' as never) as SessionQuery | undefined;
  const persistence = ctx.get('sessionPersistence' as never) as SessionPersistence | undefined;
  if (!query || !persistence) throw new Error('native session memory requires the public SessionQuery and SessionPersistence services');
  const persisted = await persistence.stat(request.sessionId as never);
  if (!persisted) throw new Error(`native session ${request.sessionId} is not durably available`);
  const log = await query.readSession(request.sessionId as never);
  let surface: SessionSurface | undefined;
  try { surface = await query.readSurface(request.sessionId as never); } catch { /* retained transcript remains usable without a current context projection */ }
  const header = log.session;
  if (String(header.id) !== request.sessionId || (surface && String(surface.session.id) !== request.sessionId) || String(persisted.header.id) !== request.sessionId) {
    throw new Error('native session memory source identity conflicts with the requested session');
  }
  if ((surface && headerIdentity(header) !== headerIdentity(surface.session)) || headerIdentity(header) !== headerIdentity(persisted.header)) {
    throw new Error('native session memory source headers conflict');
  }
  if (header.cwd === undefined) throw new Error('native session memory source has no workspace identity');
  let sessionWorkspace: string; let requestedWorkspace: string;
  try { [sessionWorkspace, requestedWorkspace] = await Promise.all([realpath(header.cwd), realpath(request.workspaceRef)]); }
  catch { throw new Error('native session memory source does not belong to the authenticated workspace'); }
  if (sessionWorkspace !== requestedWorkspace) throw new Error('native session memory source does not belong to the authenticated workspace');
  if ((header.parentSession === undefined ? undefined : String(header.parentSession)) !== request.parentSessionId) {
    throw new Error('native session memory source lineage does not match the requested scope');
  }
  const sequences = log.events.map((event) => Number((event as { seq?: unknown }).seq));
  if (sequences.some((seq, index) => !Number.isInteger(seq) || seq !== index)) {
    throw new Error('native session memory source is not a complete contiguous retained replay log');
  }
  const currentThroughSeq = sequences.at(-1) ?? -1;
  const capturedThroughSeq = request.throughSeq ?? currentThroughSeq;
  if (!Number.isInteger(capturedThroughSeq) || capturedThroughSeq < -1 || capturedThroughSeq > currentThroughSeq) {
    throw new Error(`native session memory source does not retain requested event revision ${String(request.throughSeq)}`);
  }
  const retainedPrefix = log.events.slice(0, capturedThroughSeq + 1);
  const transcript = retainedPrefix.map(semanticText).filter((text) => text !== '');
  if (transcript.length === 0) throw new Error('native session memory source has no replayed transcript text through the requested revision');
  return {
    sessionId: request.sessionId,
    workspaceRef: sessionWorkspace,
    ...(request.parentSessionId === undefined ? {} : { parentSessionId: request.parentSessionId }),
    headerIdentity: headerIdentity(header),
    transcriptIdentity: identity(retainedPrefix),
    ...(surface === undefined ? { surfaceAvailability: 'unavailable' as const } : { surfaceAvailability: 'available' as const, surfaceIdentity: identity(surface.events) }),
    capturedFromSeq: 0,
    capturedThroughSeq,
    transcriptCoverage: 'retained-prefix' as const,
    currentThroughSeq,
  };
}
