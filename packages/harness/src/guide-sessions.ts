// @hima-seam agent wrapped
// Independent execution sessions are ordinary DSH roots; only Fabric grants Campaign ownership.
import { createHash } from 'node:crypto';
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-agent';
import type {} from '@deepseek-ai/dsh-tools';
import type { Agent, AgentHandle, AgentRegistry } from '@deepseek-ai/dsh-agent';

const handles = new WeakMap<Context, Map<string, AgentHandle>>();
const creating = new WeakMap<Context, Map<string, Promise<PreparedCampaignSession>>>();

export class GuideSessionError extends Error {
  constructor(readonly code: 'hima/guide-session-missing' | 'hima/guide-session-unavailable', message: string) { super(message); }
}

export interface PreparedCampaignSession {
  readonly sessionId: string;
  readonly guideSessionId: string;
  readonly workspace: string;
  readonly created: boolean;
  readonly effectiveModel: { readonly provider: string; readonly model: string };
  readonly effectiveTools: readonly string[];
  readonly parentSessionId?: string;
}

const idFor = (guideSessionId: string, proposalId: string): string =>
  `hima-campaign-${createHash('sha256').update(`${guideSessionId}\0${proposalId}`).digest('hex').slice(0, 32)}`;

const services = (ctx: Context) => ({
  agentPresets: ctx.get('agentPresets') as { mount(agentCtx: Context, id: string): Promise<unknown> } | undefined,
});

interface PersistedSession { readonly header: { readonly cwd?: string; readonly parentSession?: string; readonly agentPreset?: string }; }

export interface ChildSessionView {
  readonly parentSessionId: string; readonly childSessionId: string; readonly nativeOpen: boolean;
  readonly effectiveModel?: { readonly provider: string; readonly model: string };
  readonly effectiveTools?: readonly string[];
  readonly transcript: { readonly availability: 'available' | 'unavailable'; readonly reason?: string };
  readonly context: { readonly availability: 'unavailable'; readonly reason: string };
  readonly nativeAddress?: { readonly parentSessionId: string; readonly childSessionId: string; readonly mode: 'one-shot' | 'continuable' };
}

type Persistence = { stat(id: string): Promise<PersistedSession | undefined>; list(): Promise<readonly PersistedSession[]> };

function viewerWorkspace(ctx: Context, viewerSessionId: string): string {
  const viewer = ctx.get('agents')?.get(viewerSessionId as never);
  const cwd = viewer?.session.header.cwd;
  if (!cwd) throw new GuideSessionError('hima/guide-session-missing', 'The viewing session is not live with a workspace.');
  return cwd;
}

async function verifiedChild(ctx: Context, viewerSessionId: string, parentSessionId: string, childSessionId: string): Promise<{ persistence: Persistence; child: PersistedSession; workspace: string }> {
  const workspace = viewerWorkspace(ctx, viewerSessionId);
  const persistence = ctx.get('sessionPersistence') as Persistence | undefined;
  if (!persistence) throw new GuideSessionError('hima/guide-session-unavailable', 'This Host has no public session persistence service.');
  const [parent, child] = await Promise.all([persistence.stat(parentSessionId), persistence.stat(childSessionId)]);
  if (!parent || !child || parent.header.cwd !== workspace || child.header.cwd !== workspace || child.header.parentSession !== parentSessionId) {
    throw new GuideSessionError('hima/guide-session-missing', 'The requested child is not a workspace-visible child of the requested parent.');
  }
  return { persistence, child, workspace };
}

/** Read bounded native child metadata only; transcript/context remain in the original DSH session UI. */
export async function readChildSessionView(ctx: Context, request: { readonly viewerSessionId: string; readonly parentSessionId: string; readonly childSessionId: string }): Promise<ChildSessionView> {
  await verifiedChild(ctx, request.viewerSessionId, request.parentSessionId, request.childSessionId);
  const live = ctx.get('agents')?.get(request.childSessionId as never);
  const entries = await (ctx.get('subagents') as { listChildren(parent: string): Promise<readonly { id: string; mode?: string }[]> } | undefined)?.listChildren(request.parentSessionId) ?? [];
  const native = entries.find((entry) => entry.id === request.childSessionId);
  const nativeAddress: ChildSessionView['nativeAddress'] = native?.mode === 'one-shot' || native?.mode === 'continuable'
    ? { parentSessionId: request.parentSessionId, childSessionId: request.childSessionId, mode: native.mode } : undefined;
  return { parentSessionId: request.parentSessionId, childSessionId: request.childSessionId, nativeOpen: live !== undefined,
    ...(live?.options.provider && live.options.model ? { effectiveModel: { provider: live.options.provider, model: live.options.model }, effectiveTools: ctx.tools.schemas(live).map((schema) => schema.name) } : {}),
    transcript: live ? { availability: 'available' } : { availability: 'unavailable', reason: 'The child is not live; this projection does not reopen it to copy transcript history.' },
    context: { availability: 'unavailable', reason: 'No retained per-step context snapshot is exposed by this read-only projection.' },
    ...(nativeAddress === undefined ? {} : { nativeAddress }) };
}

export async function listSessionChildren(ctx: Context, request: { readonly viewerSessionId: string; readonly parentSessionId: string }): Promise<{ readonly children: readonly { readonly childSessionId: string; readonly nativeOpen: boolean }[]; readonly hasMore: boolean }> {
  const workspace = viewerWorkspace(ctx, request.viewerSessionId);
  const persistence = ctx.get('sessionPersistence') as Persistence | undefined;
  if (!persistence) throw new GuideSessionError('hima/guide-session-unavailable', 'This Host has no public session persistence service.');
  const parent = await persistence.stat(request.parentSessionId);
  if (!parent || parent.header.cwd !== workspace) throw new GuideSessionError('hima/guide-session-missing', 'The requested parent is not visible in this workspace.');
  const matches = (await persistence.list()).filter((item) => item.header.cwd === workspace && item.header.parentSession === request.parentSessionId).slice(0, 101);
  const agents = ctx.get('agents');
  return { children: matches.slice(0, 100).map((item) => ({ childSessionId: String((item.header as { id?: string }).id ?? ''), nativeOpen: agents?.get((item.header as { id?: string }).id as never) !== undefined })), hasMore: matches.length > 100 };
}

/** Create or reopen one deterministic, empty-context ordinary session for an actual live Guide. */
export async function prepareCampaignSession(ctx: Context, request: { readonly guideSessionId: string; readonly proposalId: string }): Promise<PreparedCampaignSession> {
  if (request.guideSessionId === '' || request.proposalId === '') throw new GuideSessionError('hima/guide-session-missing', 'Guide session id and authenticated proposal id are required.');
  const agents = ctx.get('agents');
  const guide = agents?.get(request.guideSessionId as never);
  if (!agents || !guide) throw new GuideSessionError('hima/guide-session-missing', 'The requested Guide session is not live on this Host.');
  const workspace = guide.session.header.cwd;
  if (!workspace) throw new GuideSessionError('hima/guide-session-unavailable', 'The live Guide session has no workspace.');
  const provider = guide.options.provider; const model = guide.options.model;
  if (!provider || !model) throw new GuideSessionError('hima/guide-session-unavailable', 'The live Guide session has no effective provider/model.');
  const sessionId = idFor(request.guideSessionId, request.proposalId);
  let pending = creating.get(ctx);
  if (!pending) { pending = new Map(); creating.set(ctx, pending); }
  const inFlight = pending.get(sessionId);
  if (inFlight) return inFlight;
  const prepared = prepare(ctx, agents, guide, request.guideSessionId, sessionId, workspace, provider, model);
  pending.set(sessionId, prepared);
  try { return await prepared; } finally { pending.delete(sessionId); }
}

async function prepare(ctx: Context, agents: AgentRegistry, guide: Agent, guideSessionId: string, sessionId: string, workspace: string, provider: string, model: string): Promise<PreparedCampaignSession> {
  const preset = guide.session.header.agentPreset;
  const existing = agents.get(sessionId as never);
  const persistence = ctx.get('sessionPersistence') as { stat(id: string): Promise<PersistedSession | undefined> } | undefined;
  if (!persistence) throw new GuideSessionError('hima/guide-session-unavailable', 'This Host has no public session persistence service.');
  const persisted = await persistence.stat(sessionId);
  const controller = ctx.get('sessionController') as { create(request: { sessionId: string; workspaceId?: string; cwd?: string; agentPreset?: string }): Promise<{ sessionId: string }> } | undefined;
  const registry = ctx.get('workspaceRegistry') as { list(): readonly { readonly id: string; readonly path: string; readonly sessionIds: readonly unknown[] }[] } | undefined;
  if (controller !== undefined) {
    const memberships = registry?.list().filter(candidate => candidate.sessionIds.some(id => String(id) === guideSessionId)) ?? [];
    if (memberships.length > 1 || (memberships.length === 1 && memberships[0]!.path !== workspace)) {
      throw new GuideSessionError('hima/guide-session-unavailable', 'The live Guide has ambiguous or mismatched registered native Workspace membership.');
    }
    const registered = memberships[0];
    if (persisted !== undefined) validateHeader(persisted.header, workspace, preset);
    const made = await controller.create({ sessionId, ...(registered === undefined ? { cwd: workspace } : { workspaceId: registered.id }),
      ...(preset === undefined ? {} : { agentPreset: preset }) });
    if (made.sessionId !== sessionId) throw new GuideSessionError('hima/guide-session-unavailable', 'Native session controller returned a different execution identity.');
    const native = agents.get(made.sessionId as never);
    if (!native) throw new GuideSessionError('hima/guide-session-unavailable', 'Native session controller returned without a live session.');
    if (registered !== undefined && !registered.sessionIds.some(id => String(id) === sessionId)) throw new GuideSessionError('hima/guide-session-unavailable', 'Native session controller returned without attaching the execution session to the Guide Workspace.');
    return result(ctx, native, guideSessionId, workspace, existing === undefined && persisted === undefined, preset);
  }
  if (registry !== undefined) throw new GuideSessionError('hima/guide-session-unavailable', 'Native Workspace grouping is present without its session controller.');
  // Headless compositions intentionally have no native Workspace grouping. They preserve the
  // existing root-session behavior and bind only the immutable Session cwd.
  if (existing) return result(ctx, existing, guideSessionId, workspace, false, preset);
  let handle: AgentHandle;
  if (persisted !== undefined) {
    validateHeader(persisted.header, workspace, preset);
    handle = await agents.resume({ resumeSessionId: sessionId as never, agentOptions: { provider, model }, setup: async (agentCtx) => {
      const presets = services(agentCtx).agentPresets;
      if (preset !== undefined && presets) await presets.mount(agentCtx, preset);
    } });
  } else {
    handle = await agents.create({ sessionId: sessionId as never,
      meta: { cwd: workspace, ...(preset === undefined ? {} : { agentPreset: preset }) },
      agentOptions: { provider, model }, setup: async (agentCtx) => {
        const presets = services(agentCtx).agentPresets;
        if (preset !== undefined && presets) await presets.mount(agentCtx, preset);
      } });
  }
  let owned = handles.get(ctx);
  if (!owned) { owned = new Map(); handles.set(ctx, owned); }
  owned.set(sessionId, handle);
  return result(ctx, handle.agent, guideSessionId, workspace, persisted === undefined, preset);
}

function result(ctx: Context, agent: Agent, guideSessionId: string, workspace: string, created: boolean, preset: string | undefined): PreparedCampaignSession {
  const provider = agent.options.provider; const model = agent.options.model;
  if (!provider || !model) throw new GuideSessionError('hima/guide-session-unavailable', 'The execution session has no effective provider/model.');
  validateHeader(agent.session.header, workspace, preset);
  return { sessionId: String(agent.id), guideSessionId, workspace, created, effectiveModel: { provider, model }, effectiveTools: ctx.tools.schemas(agent).map((schema) => schema.name), ...(agent.session.header.parentSession === undefined ? {} : { parentSessionId: String(agent.session.header.parentSession) }) };
}

function validateHeader(header: PersistedSession['header'], workspace: string, preset: string | undefined): void {
  if (header.cwd !== workspace || header.parentSession !== undefined || (preset !== undefined && header.agentPreset !== preset)) {
    throw new GuideSessionError('hima/guide-session-unavailable', 'The deterministic execution session identity is already bound to a different workspace, preset, or child lineage.');
  }
}
