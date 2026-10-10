// Hima-owned identities and references. Native sessions, credentials and machine paths stay local.
import { z } from 'zod';
import { taskJsonValue, taskSchema, type JsonValue, type TaskResult, type TaskProjectionState } from './task-contract.js';
export { taskSource, methodRef, type TaskSource, type MethodRef } from './task-contract.js';

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.iso.datetime();
export const teamDefinition = z.strictObject({
  schema: z.literal('hima-team-definition/1'),
  title: z.string().trim().min(1).max(160),
  members: z.array(z.strictObject({
    id, role: z.string().trim().min(1).max(160), runtime: z.enum(['pi', 'opencode']),
    modelRef: id, skills: z.array(id), instructions: z.string().max(16000),
    toolRefs: z.array(id), knowledgeRefs: z.array(id),
  })).min(1),
  leaderMemberId: id,
  collaboration: z.string().max(16000),
  delivery: z.strictObject({ description: z.string().trim().min(1).max(16000), output: taskSchema }),
}).superRefine((value, ctx) => {
  const ids = value.members.map(member => member.id);
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', path: ['members'], message: 'Member identities must be unique.' });
  if (!ids.includes(value.leaderMemberId)) ctx.addIssue({ code: 'custom', path: ['leaderMemberId'], message: 'Choose an existing member as leader.' });
});
export type TeamDefinition = z.infer<typeof teamDefinition>;
export const teamDefinitionRef = z.strictObject({ teamId: id, version: z.number().int().positive(), sha256 });
export type TeamDefinitionRef = z.infer<typeof teamDefinitionRef>;
export const actorGrant = z.strictObject({
  grantId: id, actorId: id, projectId: z.string().min(1), teamId: id, taskId: id, memberId: id,
  runId: id, effectId: z.string().min(1), generation: z.number().int().nonnegative(),
  capabilities: z.array(z.enum(['read-task', 'send-message', 'read-material', 'query-memory', 'delegate'])),
  expiresAt: timestamp, revokedAt: timestamp.nullable(),
});
export type ActorGrant = z.infer<typeof actorGrant>;
export interface HumanActor { readonly kind: 'human'; readonly actorId: string; readonly projectId: string }
export interface GuideActor { readonly kind: 'guide'; readonly actorId: string; readonly projectId: string }
export type TeamDefinitionActor = HumanActor | GuideActor;
export interface MemberActor { readonly kind: 'member'; readonly grant: ActorGrant }
export type TeamActor = HumanActor | MemberActor;
export const materialRef = z.strictObject({ materialId: id, sha256, bytes: z.number().int().nonnegative(), mediaType: z.string().min(1),
  origin: z.enum(['verbatim', 'normalized']), state: z.enum(['saved', 'parsed', 'partial', 'unsupported']), source: z.string().min(1) });
export type MaterialRef = z.infer<typeof materialRef>;
export const memoryRef = z.strictObject({ memoryId: id, revision: z.number().int().positive(), sha256,
  state: z.enum(['candidate', 'adopted', 'disabled', 're-adopted']), projectId: z.string().min(1), memberId: id.optional(), sources: z.array(id) });
export type MemoryRef = z.infer<typeof memoryRef>;
export interface TeamView extends TeamDefinitionRef { readonly projectId: string; readonly definition: TeamDefinition }
export interface TeamReadiness { readonly ready: boolean; readonly missing: readonly string[] }
export interface TeamTaskView {
  readonly taskId: string; readonly team: TeamDefinitionRef; readonly projectId: string;
  readonly goal: string; readonly input: JsonValue; readonly deadlineAt: string; readonly closure: string;
  readonly runIds: readonly string[]; readonly currentRunId: string; readonly readiness: TeamReadiness;
  readonly allowedActions?:readonly ('pause'|'continue'|'cancel')[];
  readonly execution?: { readonly epoch:number; readonly revision:number; readonly state:TaskProjectionState; readonly resourceState:'closed'|'active'|'unknown'; readonly cancellationRequested:boolean; readonly reason?:string;
    readonly tasks:readonly {readonly taskId:string;readonly effectId:string;readonly state:TaskProjectionState;readonly reason?:string;readonly result?:TaskResult}[] };
}
export const teamTaskRequest = z.strictObject({ requestId: id, teamId: id, expectedVersion: z.number().int().positive(),
  goal: z.string().trim().min(1).max(16000), input: taskJsonValue,
  deadlineAt: timestamp, closure: z.string().trim().min(1).max(16000) });
export type TeamTaskRequest = z.infer<typeof teamTaskRequest>;
export interface TeamMessageRef { readonly messageId: string; readonly taskId: string; readonly teamId: string }
export interface TeamDelegationRef { readonly delegationId: string; readonly taskId: string; readonly parentEffectId: string; readonly memberId: string }
export class TeamError extends Error {
  constructor(readonly code: 'hima/team-invalid' | 'hima/team-conflict' | 'hima/not-authorized' | 'hima/not-found' | 'hima/team-not-ready', message: string) {
    super(message); this.name = 'TeamError';
  }
}
