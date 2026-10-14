import { randomUUID } from 'node:crypto';
import { compileTaskSchema } from './task-contract.js';
import { TeamError, teamDefinition, type TeamDefinitionActor, type TeamDefinition, type TeamDefinitionRef, type TeamView } from './team-contract.js';

/** RunStore owns atomic create/CAS and immutable versions. No task or runtime mutation is exposed. */
export interface TeamDefinitionVersionsPage {
  readonly projectId: string; readonly teamId: string;
  readonly versions: readonly (TeamDefinitionRef & { readonly title: string })[];
  readonly nextCursor?: number;
}
export interface TeamDefinitionVersionsReadPage { readonly limit: number; readonly cursor?: number }
export interface TeamDefinitionStore {
  versions(projectId: string, teamId: string, page: TeamDefinitionVersionsReadPage): Promise<TeamDefinitionVersionsPage>;
  list(projectId: string): Promise<readonly TeamView[]>;
  read(projectId: string, teamId: string, version?: number): Promise<TeamView | undefined>;
  save(request: { readonly projectId: string; readonly teamId: string; readonly definition: TeamDefinition; readonly expectedVersion: number | null }): Promise<TeamView>;
}
export interface SaveTeamDefinitionRequest {
  readonly projectId: string;
  readonly teamId?: string;
  readonly definition: unknown;
  /** null is create-only; an existing team requires its exact observed version. */
  readonly expectedVersion: number | null;
  readonly applyToRunning?: boolean;
}
export interface ReadTeamRequest { readonly projectId: string; readonly teamId: string; readonly version?: number }

const validId = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
function authorize(actor: TeamDefinitionActor, projectId: string): void {
  if (!['human', 'guide'].includes(actor?.kind) || typeof actor.actorId !== 'string' || actor.actorId.length === 0
    || typeof projectId !== 'string' || projectId.length === 0 || actor.projectId !== projectId) {
    throw new TeamError('hima/not-authorized', 'A Host-resolved operator or Guide bound to this project is required.');
  }
}
function checkIdentity(teamId: string, version?: number): void {
  if (!validId.test(teamId) || (version !== undefined && (!Number.isSafeInteger(version) || version < 1))) {
    throw new TeamError('hima/team-invalid', 'A valid team identity and positive version are required.');
  }
}
function parseDefinition(value: unknown): TeamDefinition {
  const parsed = teamDefinition.safeParse(value);
  if (!parsed.success) throw new TeamError('hima/team-invalid', parsed.error.message);
  try { compileTaskSchema(parsed.data.delivery.output); }
  catch (caught) { throw new TeamError('hima/team-invalid', caught instanceof Error ? caught.message : String(caught)); }
  return parsed.data;
}

export async function listTeams(store: TeamDefinitionStore, actor: TeamDefinitionActor, projectId: string): Promise<readonly TeamView[]> {
  authorize(actor, projectId);
  return store.list(projectId);
}
export async function listTeamDefinitionVersions(store: TeamDefinitionStore, actor: TeamDefinitionActor,
  request: { readonly projectId: string; readonly teamId: string; readonly page: TeamDefinitionVersionsReadPage }): Promise<TeamDefinitionVersionsPage> {
  authorize(actor, request.projectId); checkIdentity(request.teamId);
  const page = request.page;
  if (!page || !Number.isSafeInteger(page.limit) || page.limit < 1 || page.limit > 50
    || (page.cursor !== undefined && (!Number.isSafeInteger(page.cursor) || page.cursor < 1))) {
    throw new TeamError('hima/team-invalid', 'A version page requires a limit of 1–50 and a positive version cursor.');
  }
  return store.versions(request.projectId, request.teamId, page);
}
export async function readTeam(store: TeamDefinitionStore, actor: TeamDefinitionActor, request: ReadTeamRequest): Promise<TeamView> {
  authorize(actor, request.projectId); checkIdentity(request.teamId, request.version);
  const view = await store.read(request.projectId, request.teamId, request.version);
  if (view === undefined) throw new TeamError('hima/not-found', 'The requested team version does not exist in this project.');
  return view;
}
export async function saveTeamDefinition(store: TeamDefinitionStore, actor: TeamDefinitionActor, request: SaveTeamDefinitionRequest): Promise<TeamView> {
  authorize(actor, request.projectId);
  if (request.applyToRunning === true) throw new TeamError('hima/team-conflict', 'Save the definition first, then explicitly apply its saved version from the task controls.');
  const definition = parseDefinition(request.definition);
  const teamId = request.teamId ?? `team-${randomUUID()}`;
  checkIdentity(teamId);
  if (request.expectedVersion !== null && (!Number.isSafeInteger(request.expectedVersion) || request.expectedVersion < 1)) {
    throw new TeamError('hima/team-invalid', 'expectedVersion must be null for creation or a positive observed version.');
  }
  if (request.teamId === undefined && request.expectedVersion !== null) {
    throw new TeamError('hima/team-invalid', 'A new team requires create-only expectedVersion null.');
  }
  return store.save({ projectId: request.projectId, teamId, definition, expectedVersion: request.expectedVersion });
}
export async function cloneTeam(store: TeamDefinitionStore, actor: TeamDefinitionActor, request: ReadTeamRequest & { readonly title?: string }): Promise<TeamView> {
  const source = await readTeam(store, actor, request);
  const memberIds = new Map(source.definition.members.map(member => [member.id, `member-${randomUUID()}`]));
  const definition = parseDefinition({ ...source.definition, title: request.title ?? `${source.definition.title.slice(0, 153)} (copy)`,
    members: source.definition.members.map(member => ({ ...member, id: memberIds.get(member.id)! })),
    leaderMemberId: memberIds.get(source.definition.leaderMemberId)!,
  });
  return saveTeamDefinition(store, actor, { projectId: request.projectId, definition, expectedVersion: null });
}
/** Shareable schema only: native bindings, credentials, paths, task state and private memory cannot be exported. */
export async function exportTeamDefinition(store: TeamDefinitionStore, actor: TeamDefinitionActor, request: ReadTeamRequest): Promise<TeamDefinition> {
  const source = await readTeam(store, actor, request);
  return parseDefinition(source.definition);
}
