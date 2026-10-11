import { createHash } from 'node:crypto';
import { z } from 'zod';
import { materialRef, TeamError, type MaterialRef, type TeamActor, type GuideActor } from './team-contract.js';

export type TeamAttachmentActor = TeamActor | GuideActor;
export interface AttachmentTaskRef { readonly projectId: string; readonly teamId: string; readonly taskId: string }
const identity = z.string().min(1).max(512);
export const stageAttachmentRequest = z.strictObject({ projectId: identity, teamId: identity, taskId: identity,
  requestId: identity, sessionId: identity, receiptId: identity });
export type StageAttachmentRequest = z.infer<typeof stageAttachmentRequest>;
/** DSH public storage reference; never an absolute host path or Agent receipt. */
export interface TeamAttachmentFileRef { readonly attachmentId: string; readonly name: string; readonly bytes: number }
export type AttachmentParserStatus = 'parsed' | 'partial' | 'unsupported' | 'failed' | 'no-text';
export interface AttachmentChunk { readonly location: string; readonly text: string; readonly sha256: string }
export interface AttachmentParse { readonly status: AttachmentParserStatus; readonly revision: string;
  readonly warnings: readonly string[]; readonly chunks: readonly AttachmentChunk[] }
export interface StagedAttachment { readonly stageId: string; readonly material: MaterialRef; readonly parser: AttachmentParse }
/** Private persistence DTO, excluded from wire output. Native original reference is retained independently of receipt lifetime. */
export interface PersistedAttachmentOriginal { readonly fileRef: TeamAttachmentFileRef; readonly sha256: string;
  readonly bytes: number; readonly mediaType: string }
export interface AuthorizedAttachment extends StagedAttachment { readonly original: PersistedAttachmentOriginal }
export interface TeamAttachmentStore {
  /** Each method reauthorizes within its PG transaction, including replay and read. */
  saveOriginal(actor: TeamAttachmentActor, request: StageAttachmentRequest, original: PersistedAttachmentOriginal): Promise<PersistedAttachmentOriginal>;
  stage(actor: TeamAttachmentActor, request: StageAttachmentRequest, value: { readonly original: PersistedAttachmentOriginal; readonly parser: AttachmentParse }): Promise<StagedAttachment>;
  readStage(actor: TeamAttachmentActor, ref: AttachmentTaskRef, stageId: string): Promise<StagedAttachment>;
  /** Reentry lists operator-owned drafts and authorized linked versions; each query reauthorizes. */
  listStages?(actor: TeamAttachmentActor, ref: AttachmentTaskRef): Promise<{ readonly materials: readonly StagedAttachment[]; readonly draftStageIds: readonly string[] }>;
  removeDraft(actor: TeamAttachmentActor, ref: AttachmentTaskRef, stageId: string): Promise<void>;
  /** Only task-linked originals with current read-material permission. Draft ownership does not grant member reads. */
  readAuthorized(actor: TeamAttachmentActor, ref: AttachmentTaskRef, stageId: string): Promise<AuthorizedAttachment>;
}
export interface TeamAttachmentNative {
  /** Resolve receiving Agent from Host session; call ctx.fileUploads.resolve(agent, receiptId). */
  resolveUpload(sessionId: string, receiptId: string): Promise<TeamAttachmentFileRef>;
  readFileStream(ref: TeamAttachmentFileRef, signal?: AbortSignal): AsyncIterable<Uint8Array>;
}
export interface TeamAttachmentParser {
  readonly revision: string;
  parse(bytes: Uint8Array, name: string, mediaType: string): Promise<AttachmentParse>;
}
export interface TeamAttachmentPorts { readonly store: TeamAttachmentStore; readonly native: TeamAttachmentNative; readonly parser: TeamAttachmentParser }
const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
export function attachmentMediaType(name: string): string {
  const extension = name.toLowerCase().split('.').pop();
  return extension === 'pdf' ? 'application/pdf' : extension === 'md' || extension === 'markdown' ? 'text/markdown' : extension === 'txt' ? 'text/plain' : 'application/octet-stream';
}
function safeName(name: string): string { return name.replace(/^.*[\\/]/, '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 255) || 'attachment'; }
function checkedParse(value: AttachmentParse, revision: string): AttachmentParse {
  if (!['parsed', 'partial', 'unsupported', 'failed', 'no-text'].includes(value.status) || value.revision !== revision
    || !Array.isArray(value.warnings) || !value.warnings.every(warning => typeof warning === 'string') || !Array.isArray(value.chunks)) throw new Error('Invalid attachment parser result');
  if ((value.status === 'parsed' || value.status === 'partial') !== (value.chunks.length > 0)) throw new Error('Attachment parser status does not match extracted text');
  for (const chunk of value.chunks) if (!chunk.location || !chunk.text.trim() || chunk.text.length > 2400 || chunk.sha256 !== sha256(chunk.text)) throw new Error('Invalid attachment excerpt provenance');
  return value;
}
/** Original intake is native DSH only. A parse failure cannot discard a saved original. */
export async function stageAttachment(ports: TeamAttachmentPorts, actor: TeamAttachmentActor, wireRequest: StageAttachmentRequest, signal?: AbortSignal): Promise<StagedAttachment> {
  const request = stageAttachmentRequest.parse(wireRequest);
  signal?.throwIfAborted();
  const nativeRef = await ports.native.resolveUpload(request.sessionId, request.receiptId);
  if (!/^sha256:[a-f0-9]{64}$/.test(nativeRef.attachmentId) || !Number.isSafeInteger(nativeRef.bytes) || nativeRef.bytes < 0) throw new TeamError('hima/team-invalid', 'Invalid native file reference');
  const chunks: Uint8Array[] = []; let total = 0;
  for await (const chunk of ports.native.readFileStream(nativeRef, signal)) {
    signal?.throwIfAborted(); total += chunk.byteLength;
    if (total > nativeRef.bytes) throw new TeamError('hima/team-invalid', 'Native original size changed');
    chunks.push(new Uint8Array(chunk));
  }
  const bytes = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  if (total !== nativeRef.bytes || `sha256:${sha256(bytes)}` !== nativeRef.attachmentId) throw new TeamError('hima/team-invalid', 'Native original hash or size mismatch');
  const name = safeName(nativeRef.name); const mediaType = attachmentMediaType(name);
  const original = await ports.store.saveOriginal(actor, request, { fileRef: { attachmentId: nativeRef.attachmentId, name: nativeRef.name, bytes: nativeRef.bytes }, bytes: total, sha256: sha256(bytes), mediaType });
  let parser: AttachmentParse;
  if (mediaType === 'application/octet-stream') parser = { status: 'unsupported', revision: ports.parser.revision, warnings: ['Supported formats: PDF, Markdown and plain text.'], chunks: [] };
  else try { parser = checkedParse(await ports.parser.parse(new Uint8Array(bytes), name, mediaType), ports.parser.revision); }
  catch (error) { parser = { status: 'failed', revision: ports.parser.revision, warnings: [error instanceof Error ? error.message : 'Document parsing failed'], chunks: [] }; }
  return ports.store.stage(actor, request, { original, parser });
}
export async function readAttachment(ports: Pick<TeamAttachmentPorts, 'store'>, actor: TeamAttachmentActor, ref: AttachmentTaskRef, stageId: string): Promise<StagedAttachment> {
  const { original: _original, ...publicValue } = await ports.store.readAuthorized(actor, ref, stageId);
  materialRef.parse(publicValue.material); return publicValue;
}
/** Authorized persisted bytes, independent of the original Agent-scoped upload receipt. */
export async function* materializeAttachment(ports: Pick<TeamAttachmentPorts, 'store' | 'native'>, actor: TeamAttachmentActor, ref: AttachmentTaskRef, stageId: string, signal?: AbortSignal): AsyncGenerator<Uint8Array> {
  const value = await ports.store.readAuthorized(actor, ref, stageId);
  const digest = createHash('sha256'); let total = 0;
  for await (const chunk of ports.native.readFileStream(value.original.fileRef, signal)) {
    signal?.throwIfAborted(); total += chunk.byteLength;
    if (total > value.material.bytes) throw new TeamError('hima/team-invalid', 'Persisted original size mismatch');
    digest.update(chunk); yield chunk;
  }
  if (total !== value.material.bytes || digest.digest('hex') !== value.material.sha256) throw new TeamError('hima/team-invalid', 'Persisted original integrity mismatch');
}
export async function readAttachmentExcerpt(ports: Pick<TeamAttachmentPorts, 'store'>, actor: TeamAttachmentActor, ref: AttachmentTaskRef, stageId: string, location: string): Promise<AttachmentChunk> {
  const value = await ports.store.readAuthorized(actor, ref, stageId);
  const chunk = value.parser.chunks.find(item => item.location === location);
  if (!chunk) throw new TeamError('hima/not-found', 'Attachment excerpt not found');
  if (sha256(chunk.text) !== chunk.sha256) throw new TeamError('hima/team-invalid', 'Attachment excerpt integrity mismatch');
  return chunk;
}
