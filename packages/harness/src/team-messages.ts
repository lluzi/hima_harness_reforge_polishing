import { createHash } from 'node:crypto';
import { z } from 'zod';
import { TeamError, type MaterialRef, type TeamActor, type GuideActor } from './team-contract.js';

export type TeamMessageActor = TeamActor | GuideActor;
export interface TaskRef { readonly projectId: string; readonly teamId: string; readonly taskId: string }
export interface TeamMessageSender { readonly kind: 'human' | 'member' | 'guide'; readonly actorId: string; readonly memberId?: string; readonly runId?: string; readonly effectId?: string; readonly generation?: number }
export interface SendTeamMessageRequest extends TaskRef {
  readonly kind?: 'requirement' | 'question' | 'handoff' | 'review'; readonly replyToMessageId?: string;
  readonly requestId: string; readonly recipientMemberIds: readonly string[]; readonly text: string; readonly stagedAttachmentIds: readonly string[];
}
export interface TeamMessageEnvelope extends TaskRef {
  readonly kind: 'requirement' | 'question' | 'handoff' | 'review'; readonly replyToMessageId?: string;
  readonly messageId: string; readonly requestId: string; readonly contentDigest: string;
  readonly sender: TeamMessageSender; readonly createdAt: string; readonly materialRefs: readonly MaterialRef[];
  readonly recipientMemberIds: readonly string[]; readonly text: string;
}
export interface TeamDeliveryTarget {
  readonly runId: string; readonly effectId: string; readonly memberId: string; readonly generation: number; readonly attemptId: string;
}
export interface TeamDeliveryReceipt { readonly nativeReceiptId: string; readonly receivedAt: string; readonly target: TeamDeliveryTarget }
export type TeamDeliveryResult =
  | { readonly state: 'accepted'; readonly received: TeamDeliveryReceipt }
  | { readonly state: 'unknown' | 'rejected'; readonly reason: string };
export interface TeamMessageDelivery {
  readonly deliveryId: string; readonly messageId: string; readonly recipientMemberId: string;
  readonly state: 'pending' | 'accepted' | 'unknown' | 'rejected'; readonly revision: number;
  readonly reason?: string; readonly target?: TeamDeliveryTarget; readonly received?: TeamDeliveryReceipt;
}
export interface TeamMessageSendResult { readonly message: TeamMessageEnvelope; readonly deliveries: readonly TeamMessageDelivery[] }
export interface TeamReadPage { readonly cursor?: number; readonly limit: number }
export interface TeamMessagesPage { readonly messages: readonly TeamMessageEnvelope[]; readonly deliveries: readonly TeamMessageDelivery[]; readonly nextCursor?: number }
export interface TeamActivityRecord {
  readonly activityId: string; readonly createdAt: string; readonly kind: 'message' | 'work' | 'result' | 'dependency' | 'control';
  readonly summary: string; readonly memberId?: string; readonly messageId?: string; readonly effectId?: string;
  readonly materialRefs?: readonly MaterialRef[];
}
export interface TeamActivityPage extends TaskRef { readonly records: readonly TeamActivityRecord[]; readonly nextCursor?: number }
export interface PendingTeamRequest {
  readonly requestId: string; readonly messageId: string; readonly memberId: string; readonly effectId: string; readonly generation: number;
  readonly createdAt: string; readonly kind: 'question' | 'handoff' | 'review' | 'human-approval'; readonly text: string;
}
export interface PendingTeamRequestsPage extends TaskRef { readonly requests: readonly PendingTeamRequest[]; readonly nextCursor?: number }
export interface TeamMemberWorkRecord {
  readonly recordId: string; readonly runId: string; readonly effectId: string; readonly generation: number | null;
  readonly sessionId?: string; readonly createdAt: string | null; readonly kind: 'work' | 'result' | 'transcript';
  /** Already redacted by the Host's authenticated projection. Never native credentials or local paths. */
  readonly text: string; readonly source: 'retained'; readonly redacted?:boolean; readonly truncated?:boolean; readonly result?:{readonly effectId:string;readonly sha256:string;readonly text:string;readonly redacted:boolean;readonly truncated:boolean};
}
export interface TeamMemberWorkPage extends TaskRef {
  readonly memberId: string; readonly records: readonly TeamMemberWorkRecord[]; readonly nextCursor?: number;
  readonly connection: 'connected' | 'disconnected' | 'unavailable';
  readonly trace: { readonly state: 'retained' | 'missing' | 'unavailable'; readonly reason?: string };
}

/** Each method authorizes the resolved actor inside its own PG transaction against current grants/control.
 * commitSend alone owns stage links + digest replay/conflict + pending recipient rows atomically.
 * claimDelivery marks unknown BEFORE external send, returns only its fresh CAS claim, retains an attempt and binds the actual invocation; unknown is never claimable.
 * recordDelivery compares revision, attempt, target and current generation, returning latest on stale CAS.
 */
export interface TeamMessageStore {
  commitSend(actor: TeamMessageActor, request: SendTeamMessageRequest): Promise<TeamMessageSendResult>;
  readMessages(actor: TeamMessageActor, ref: TaskRef, page: TeamReadPage): Promise<TeamMessagesPage>;
  readDelivery(actor: TeamMessageActor, ref: TaskRef, deliveryId: string): Promise<TeamMessageDelivery>;
  claimDelivery(actor: TeamMessageActor, ref: TaskRef, deliveryId: string, expectedRevision: number): Promise<TeamMessageDelivery | undefined>;
  recordDelivery(actor: TeamMessageActor, ref: TaskRef, deliveryId: string, expectedRevision: number, attemptId: string, result: TeamDeliveryResult): Promise<TeamMessageDelivery>;
  readActivity(actor: TeamMessageActor, ref: TaskRef, page: TeamReadPage): Promise<TeamActivityPage>;
  readPendingRequests(actor: TeamMessageActor, ref: TaskRef, page: TeamReadPage): Promise<PendingTeamRequestsPage>;
  readMemberWork(actor: TeamMessageActor, ref: TaskRef, memberId: string, page: TeamReadPage): Promise<TeamMemberWorkPage>;
}
/** No run creation, wake loop, retries or scheduling. Delivery is native receive evidence only. */
export interface TeamTransport {
  /** Read-only native readiness. Missing runtime identity leaves the durable message pending. */
  canDeliver?(message:TeamMessageEnvelope,delivery:TeamMessageDelivery):Promise<boolean>;
  deliver(message: TeamMessageEnvelope, delivery: TeamMessageDelivery): Promise<TeamDeliveryResult>;
  observeDelivery(delivery: TeamMessageDelivery): Promise<TeamDeliveryResult | { readonly state: 'unavailable'; readonly reason: string }>;
}
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/);
const refShape = { projectId: z.string().min(1).max(4096), teamId: id, taskId: id };
const taskRef = z.strictObject(refShape);
const distinct = (min: number, max: number) => z.array(id).min(min).max(max).refine(values => new Set(values).size === values.length, 'Identities must be distinct.');
const sendRequest = z.strictObject({ ...refShape, requestId: id, recipientMemberIds: distinct(1, 64), text: z.string().max(16000), stagedAttachmentIds: distinct(0, 32), kind: z.enum(['requirement', 'question', 'handoff', 'review']).optional(), replyToMessageId: id.optional() })
  .refine(value => value.text.trim().length > 0 || value.stagedAttachmentIds.length > 0, 'Send text or staged material.');
const readPage = z.strictObject({ cursor: z.number().int().nonnegative().optional(), limit: z.number().int().min(1).max(100) });
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const value = schema.safeParse(input);
  if (!value.success) throw new TeamError('hima/team-invalid', value.error.message);
  return value.data;
}
export function parseSendTeamMessageRequest(input: unknown): SendTeamMessageRequest { return parse(sendRequest, input); }
/** Store calls this with its transaction-resolved sender. Set order does not change semantic content. */
export function teamMessageDigest(request: SendTeamMessageRequest, sender: TeamMessageSender): string {
  return createHash('sha256').update(JSON.stringify({ projectId: request.projectId, teamId: request.teamId, taskId: request.taskId,
    sender: { kind: sender.kind, actorId: sender.actorId, ...(sender.memberId === undefined ? {} : { memberId: sender.memberId }),
      ...(sender.runId === undefined ? {} : { runId: sender.runId }), ...(sender.effectId === undefined ? {} : { effectId: sender.effectId }), ...(sender.generation === undefined ? {} : { generation: sender.generation }) },
    kind: request.kind ?? 'requirement', replyToMessageId: request.replyToMessageId ?? null,
    recipientMemberIds: [...request.recipientMemberIds].sort(), text: request.text, stagedAttachmentIds: [...request.stagedAttachmentIds].sort(),
  })).digest('hex');
}
/** Native adapter uses this structured wrapper; peer text cannot close delimiters or claim Host authority. */
export function teamMessageNativeInput(message: TeamMessageEnvelope): string {
  return JSON.stringify({ schema: 'hima-team-message/1', authority: 'host-resolved-provenance',
    source: { projectId: message.projectId, teamId: message.teamId, taskId: message.taskId, messageId: message.messageId,
      sender: message.sender, contentDigest: message.contentDigest, createdAt: message.createdAt },
    kind: message.kind, replyToMessageId: message.replyToMessageId, materialRefs: message.materialRefs, peerText: { trust: 'untrusted', text: message.text }, receiptMeaning: 'received-only' });
}
function checkedResult(delivery: TeamMessageDelivery, result: TeamDeliveryResult): TeamDeliveryResult {
  if (result.state !== 'accepted') return result;
  const target = delivery.target;
  const receipt = result.received;
  if (target === undefined || !receipt || !receipt.nativeReceiptId || !Number.isFinite(Date.parse(receipt.receivedAt))
    || receipt.target?.runId !== target.runId || receipt.target.effectId !== target.effectId || receipt.target.memberId !== target.memberId
    || receipt.target.generation !== target.generation || receipt.target.attemptId !== target.attemptId) {
    return { state: 'unknown', reason: 'Native receipt is missing or does not match the claimed invocation.' };
  }
  return result;
}
export async function claimTeamDelivery(store: TeamMessageStore, actor: TeamMessageActor, ref: TaskRef, deliveryId: string, expectedRevision: number): Promise<TeamMessageDelivery | undefined> {
  parse(taskRef, ref); parse(id, deliveryId);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new TeamError('hima/team-invalid', 'An observed delivery revision is required.');
  return store.claimDelivery(actor, ref, deliveryId, expectedRevision);
}
export async function sendTeamMessage(store: TeamMessageStore, actor: TeamMessageActor, input: SendTeamMessageRequest, transport?: TeamTransport): Promise<TeamMessageSendResult> {
  const request = parseSendTeamMessageRequest(input);
  const committed = await store.commitSend(actor, request);
  if (transport === undefined) return committed;
  const deliveries: TeamMessageDelivery[] = [];
  for (const retained of committed.deliveries) {
    if (retained.state !== 'pending') { deliveries.push(retained); continue; }
    if(transport.canDeliver&&!await transport.canDeliver(committed.message,retained)) {deliveries.push(retained);continue;}
    const claimed = await claimTeamDelivery(store, actor, requestRef(request), retained.deliveryId, retained.revision);
    if (claimed?.target === undefined) { deliveries.push(claimed ?? await store.readDelivery(actor, requestRef(request), retained.deliveryId)); continue; }
    let result: TeamDeliveryResult;
    try { result = checkedResult(claimed, await transport.deliver(committed.message, claimed)); }
    catch { result = { state: 'unknown', reason: 'Native send response was lost; observe this attempt before any repeat.' }; }
    deliveries.push(await store.recordDelivery(actor, requestRef(request), claimed.deliveryId, claimed.revision, claimed.target.attemptId, result));
  }
  return { message: committed.message, deliveries };
}
function requestRef(ref: TaskRef): TaskRef { return { projectId: ref.projectId, teamId: ref.teamId, taskId: ref.taskId }; }
export async function reconcileTeamMessageDelivery(store: TeamMessageStore, actor: TeamMessageActor, ref: TaskRef, deliveryId: string, transport: TeamTransport): Promise<TeamMessageDelivery> {
  parse(taskRef, ref); parse(id, deliveryId);
  const delivery = await store.readDelivery(actor, ref, deliveryId);
  if (delivery.state !== 'unknown' || delivery.target === undefined) return delivery;
  let observed;
  try { observed = await transport.observeDelivery(delivery); } catch { return delivery; }
  if (observed.state === 'unavailable') return delivery;
  return store.recordDelivery(actor, ref, deliveryId, delivery.revision, delivery.target.attemptId, checkedResult(delivery, observed));
}
export async function readTeamMessages(store: TeamMessageStore, actor: TeamMessageActor, ref: TaskRef, page: TeamReadPage): Promise<TeamMessagesPage> {
  return store.readMessages(actor, parse(taskRef, ref), parse(readPage, page));
}
export async function readTaskActivity(store: TeamMessageStore, actor: TeamMessageActor, ref: TaskRef, page: TeamReadPage): Promise<TeamActivityPage> {
  return store.readActivity(actor, parse(taskRef, ref), parse(readPage, page));
}
export async function readPendingTeamRequests(store: TeamMessageStore, actor: TeamMessageActor, ref: TaskRef, page: TeamReadPage): Promise<PendingTeamRequestsPage> {
  return store.readPendingRequests(actor, parse(taskRef, ref), parse(readPage, page));
}
export async function readMemberWork(store: TeamMessageStore, actor: TeamMessageActor, ref: TaskRef, memberId: string, page: TeamReadPage): Promise<TeamMemberWorkPage> {
  return store.readMemberWork(actor, parse(taskRef, ref), parse(id, memberId), parse(readPage, page));
}
