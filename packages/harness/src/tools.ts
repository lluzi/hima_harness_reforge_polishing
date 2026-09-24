// @hima-seam tools direct
// The `hima_*` tool face: what an agent may ask this harness to do, and the JSON it is answered in.
// One reason to change: what an agent can call, and the shape of the answer.
//
// A tool call is a caller like any other: the same table of what a Run's arguments may be refuses
// here the values `/hima run` refuses on a command line, because a value no person could type must
// not be a value a model can. Every tool value is lossless JSON — an absent key, never an undefined
// one — since a key that arrives as `undefined` is a key that did not survive the wire.
//
// The two sentences a tool answers a refusal with are the command face's own (`describePackCheck`,
// `describePrepare`): one unfit pack told two ways by two faces of one harness is two products.
import { defineTool } from '@deepseek-ai/dsh-tools';
import type { Agent } from '@deepseek-ai/dsh-agent';
import path from 'node:path';
import { realpathSync } from 'node:fs';
import { assertRunProject } from './guide-context.js';
import { currentRecordsIn, type NodeExecution, type VerdictRecord } from './ledger.js';
import { legacyAutomaticAllowed } from './runs.js';
import { observe, type ObserveRequest, type ObserveResult } from './observe.js';
import { authenticCampaignProposalId, identityOf, revisionImpactForRun, executionAction, executionContext, sameCampaignProposalFacts, type ExecutionActionRequest, resumeRun, startRun, type FabricDeps, type ResumeResult, type StartRunResult, type StartRunRequest } from './fabric.js';
import { cancelRun, type CancelResult } from './recovery.js';
import { describePackCheck, describePackCheckResult, describePrepare, packCheckFit, packCheckStage } from './commands.js';
import { checkInstalledPack, loadPack, runPackWords } from './packs.js';
import { campaignKnowledgeScope, clearCurrentKnowledge, importCurrentKnowledge, listCurrentKnowledge, readCurrentKnowledge, readPackKnowledge, recordDocumentKnowledgeRead, searchCurrentKnowledge, searchPackKnowledge } from './workshop.js';
import { releasePack } from './release.js';
import { runView, type RunWords, type SiteDiscoverBody, type SiteHeadView } from './remote.js';
import type { SiteDiscoveryResult } from './sites.js';
import type { PreparationView } from './workbench.js';
import { CAMPAIGN_FILE_RELATIVE, CampaignFileError, overridesOf, readCampaignFile, type PreparationOverrides } from './campaign-file.js';
import { allowsRunArgument, badRunArgument, notWaitingToResume, unresumableReason, type RunArgumentName, type StrategyValue } from './run-arguments.js';

type ToolJson = null | string | number | boolean | ToolJson[] | { [key: string]: ToolJson };
/** Shared execution context crosses the same JSON boundary as the HTTP view. */
function toolJson(value: object): Record<string, ToolJson> { return JSON.parse(JSON.stringify(value)) as Record<string, ToolJson>; }

async function assertProjectAccess(deps: FabricDeps, agent: Agent | undefined, runId: string): Promise<void> {
  if (legacyAutomaticAllowed()) return;
  if (!agent) throw new Error('reading a task requires a live project conversation');
  await assertRunProject(deps, String(agent.id), agentWorkspaceOf(agent), runId);
}

/**
 * The Agent's own workspace cwd: dsh's own session header, with a fallback to the Agent's own meta
 * for an older path. The one resolver every cwd-dependent Hima surface uses (#41 task 3) — current
 * knowledge import roots below, the Campaign file `hima_prepare`/`hima_run` apply, and a live
 * session's workspace looked up by id (`index.ts`'s own `sessionWorkspace`) — so no two of them can
 * read the same two fields in a subtly different order.
 */
export function agentWorkspaceOf(agent: Agent | undefined): string | undefined {
  if (!agent) return undefined;
  const carrier = agent as unknown as { meta?: { cwd?: unknown }; session?: { header?: { cwd?: unknown } } };
  const cwd = carrier.session?.header?.cwd ?? carrier.meta?.cwd;
  return typeof cwd === 'string' && cwd.trim() !== '' ? cwd : undefined;
}

/** DSH already gives each Agent a workspace. Current knowledge import is confined to that workspace
 * instead of turning HimaGuide into a general local-file scanner. An explicit native picker can be
 * passed here later through the same `allowedRoots` seam without changing the knowledge runtime. */
function knowledgeImportRoots(agent: Agent): readonly string[] {
  const cwd = agentWorkspaceOf(agent);
  return cwd === undefined ? [] : [path.resolve(cwd)];
}

/**
 * The Campaign file `hima_prepare`/`hima_run` apply (#41 task 3): the Agent's own workspace holds
 * `hima/campaign.yml` and its declared `pack.id` equals the pack this call names. `useFile: false`
 * (only `hima_prepare`'s own argument offers this) never looks: an Agent asking to prepare a Pack
 * plainly, in spite of a stale or unrelated file sitting in its workspace, gets exactly that.
 *
 * Reported back on both tools' JSON as `campaignFile: { path, applied }` so a person reading either
 * receipt knows whether the numbers it saw came from that file or from the Pack's own declaration —
 * and so a caller comparing a confirmation to a preparation is comparing like with like.
 *
 * H9: a file this workspace holds that does not read as `hima-campaign/1` (bad YAML, or a value the
 * schema refuses — the same fault the `/hima/api/campaign` route answers 400 for) is the caller's own
 * stale or hand-edited file, not a reason to fail the tool call it happened to be sitting under: it is
 * reported as `campaignFile: { applied: false, error: <sentence> }` and this call proceeds exactly as
 * `useFile: false` would, with no overrides applied. Any other fault (a workspace this process cannot
 * read, `EACCES` and the like) is not this — it still propagates, the same as every other unexpected
 * filesystem fault this bundle does not turn into a business answer.
 */
function campaignFileApplication(agent: Agent | undefined, packId: string, useFile: boolean):
  { readonly campaignFile: { readonly path: string; readonly applied: boolean; readonly error?: string }; readonly overrides?: PreparationOverrides } {
  const workspace = useFile ? agentWorkspaceOf(agent) : undefined;
  let found: ReturnType<typeof readCampaignFile>;
  try {
    found = workspace === undefined ? undefined : readCampaignFile(workspace);
  } catch (err) {
    if (err instanceof CampaignFileError) return { campaignFile: { path: CAMPAIGN_FILE_RELATIVE, applied: false, error: err.message } };
    throw err;
  }
  const applied = found !== undefined && found.file.pack?.id === packId;
  return { campaignFile: { path: CAMPAIGN_FILE_RELATIVE, applied }, ...(applied ? { overrides: overridesOf(found!.file) } : {}) };
}

function authorizedKnowledgeImport(agent: Agent, file: string): string | undefined {
  for (const root of knowledgeImportRoots(agent)) {
    const candidate = path.isAbsolute(file) ? path.resolve(file) : path.resolve(root, file);
    let actualRoot: string, actual: string;
    try { actualRoot = realpathSync(root); actual = realpathSync(candidate); } catch { continue; }
    const relative = path.relative(actualRoot, actual);
    if (relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))) return actual;
  }
  return undefined;
}

/** Before a Campaign exists, only the opaque HMAC-bearing token HimaGuide just returned may select
 * current knowledge.  Once a Campaign exists, its durable proposal token is the authority across a
 * Host restart; a bare facts hash alone never becomes a general-purpose scope capability. */
function productKnowledgeScope(given: string | undefined, runProposalId?: string): string | undefined {
  if (given === undefined) return undefined;
  if (runProposalId !== undefined && (given === runProposalId || given === campaignKnowledgeScope(runProposalId))) return campaignKnowledgeScope(runProposalId);
  if (!authenticCampaignProposalId(given)) throw new Error('current knowledge scope must be the full, current HimaGuide Campaign proposal token');
  return campaignKnowledgeScope(given);
}

/** A knowledge read that becomes Campaign evidence must name the actual owner execution.  The
 * record is therefore attached to the attempt Fabric admitted, rather than a tool-local default. */
function writableCampaignKnowledgeExecution(deps: FabricDeps, runId: string, agent: Agent, scope: string): { readonly execution: NodeExecution; readonly scope: string } {
  const context = executionContext(deps, runId);
  const run = context.run;
  if (run.status !== 'running' || run.control === undefined || run.control.stop !== undefined || context.budget.phase !== 'active') {
    throw new Error('Campaign knowledge evidence requires an active writable Campaign');
  }
  if (run.control.owner !== String(agent.id)) throw new Error('Campaign knowledge evidence belongs to the current owning Campaign Agent');
  if (run.proposalId === undefined) throw new Error('Campaign knowledge evidence requires the confirmed Campaign proposal identity');
  const expectedScope = campaignKnowledgeScope(run.proposalId);
  if (scope !== expectedScope) throw new Error('current knowledge scope does not belong to this Campaign proposal');
  const executions = context.executions.filter((item) => item.supersededBy === undefined && item.nodeId === run.currentNode
    && item.generation === (run.generation ?? 1) && ['begun', 'working', 'ready'].includes(item.phase));
  if (executions.length !== 1) throw new Error('Campaign knowledge evidence requires exactly one currently admitted node execution');
  return { execution: executions[0]!, scope: expectedScope };
}

/** The Agent supplies research intent. Mechanical identities are attached from this Run before the
 * existing executor performs its owner, epoch, validity and graph checks. Explicit identities are
 * never repaired. Replaying a proposal reuses its held defaults, not a later Ledger boundary. */
function modelResearchProposal(deps: FabricDeps, runId: string, kind: 'growth' | 'revision', raw: Record<string, unknown>): Record<string, unknown> {
  const context = executionContext(deps, runId);
  const records = deps.ledger.records({ runId });
  const prior = records.find(record => (kind === 'growth' ? record.type === 'growth' && record.proposalId === raw.proposalId : record.type === 'revision' && record.revisionId === raw.revisionId) && (record.type === 'growth' || record.type === 'revision') && record.event === 'proposed');
  const held = (prior?.type === 'growth' || prior?.type === 'revision') && prior.proposal !== null && typeof prior.proposal === 'object' && !Array.isArray(prior.proposal)
    ? prior.proposal as Record<string, unknown> : undefined;
  const available = currentRecordsIn(records);
  const ref = (value: unknown): unknown => {
    const object = value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
    const key = object?.recordId ?? value;
    const record = available.find(record => typeof key === 'number' ? record.seq === key : record.id === key);
    return { ...(object ?? {}), recordId: record?.id ?? key,
      ...(object?.contentIdentity !== undefined ? { contentIdentity: object.contentIdentity } : record ? { contentIdentity: identityOf(record) } : {}) };
  };
  const inputs = raw.inputs === undefined ? held?.inputs ?? available.filter(record =>
    record.generation === context.run.generation && ['observation', 'verdict', 'code', 'knowledge'].includes(record.type)).slice(-64).map(record => ({ recordId: record.id, contentIdentity: identityOf(record) }))
    : Array.isArray(raw.inputs) ? raw.inputs.map(ref) : raw.inputs;
  const common = {
    method: held?.method ?? (context.method ? { id: context.method.id, version: context.method.version, digest: context.method.digest } : undefined),
    ...(kind === 'growth' ? { parent: held?.parent ?? { nodeId: context.run.currentNode, generation: context.run.generation } } : {}),
    inputThroughSeq: held?.inputThroughSeq ?? context.run.nextSeq - 1,
    ...raw, inputs,
  };
  if (kind === 'growth') return common;
  const changes = Array.isArray(raw.changes) ? raw.changes.map(item => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return item;
    const change = item as Record<string, unknown>;
    const previous = Array.isArray(held?.changes) ? held.changes.find(item => item && typeof item === 'object' && item.nodeId === change.nodeId && item.scope === change.scope && item.path === change.path) as Record<string, unknown> | undefined : undefined;
    const source = available.findLast(record => change.sourceRecordId !== undefined ? record.id === change.sourceRecordId
      : change.scope === 'workshop' && record.type === 'code' && record.nodeId === change.nodeId && record.path.endsWith(`/${String(change.path)}`));
    return { ...change,
      ...(change.scope === 'workshop' && change.sourceRecordId === undefined && (previous?.sourceRecordId !== undefined || source) ? { sourceRecordId: previous?.sourceRecordId ?? source?.id } : {}),
      ...(change.fromSha256 === undefined && (previous?.fromSha256 !== undefined || source && ('sha256' in source || 'contentSha256' in source))
        ? { fromSha256: previous?.fromSha256 ?? (source && ('sha256' in source ? source.sha256 : 'contentSha256' in source ? source.contentSha256 : undefined)) } : {}),
    };
  }) : raw.changes;
  return { ...common, changes, affectedNodes: raw.affectedNodes !== undefined ? raw.affectedNodes : held?.affectedNodes
    ?? revisionImpactForRun(deps, runId, Array.isArray(raw.changedNodes) && raw.changedNodes.every(node => typeof node === 'string') ? raw.changedNodes : []) };
}

/** Keep action data visible to the model; the lossless value remains available to the UI/API. */
function executionText(value: Record<string, ToolJson>): string {
  const object = (x: ToolJson | undefined): Record<string, ToolJson> =>
    x !== null && typeof x === 'object' && !Array.isArray(x) ? x : {};
  const context = object(value.context);
  const run = object(context.run);
  const control = object(run.control);
  const method = object(context.method);
  const executions = Array.isArray(context.executions) ? context.executions.map(item => {
    const e = object(item);
    return { id: e.id, nodeId: e.nodeId, phase: e.phase, attempt: e.attempt,
      branchId: e.branchId, jobSession: e.jobSession, result: e.result };
  }) : [];
  return JSON.stringify({ runId: value.runId, kind: value.kind, reason: value.reason,
    receipt: value.receipt, data: value.data,
    context: { run: { id: run.id, status: run.status, generation: run.generation,
      currentNode: run.currentNode, nextSeq: run.nextSeq, goal: run.goal, strategy: run.strategy, budget: run.budget,
      loop: run.loop, control: { owner: control.owner, epoch: control.epoch, revision: control.revision,
        paused: control.paused, stop: control.stop } }, available: context.available, executions,
      reason: context.reason, method: { id: method.id, version: method.version, digest: method.digest } },
    more: 'hima_context provides the full reference graph and recorded evidence when needed',
  });
}

/** One tool as `ctx.tools.register` takes it: whatever `defineTool` makes of a definition. */
type ToolDefinition = ReturnType<typeof defineTool>;

/** Guide reads and derived memory share the same authenticated Host projection as the UI. */
export function guideTools(operations: {
  inspect(sessionId: string, requestId: string, target: unknown): Promise<object>;
  memory(sessionId: string, request: { action: 'read' | 'sources' | 'save'; runId?: string; summary?: unknown }): Promise<object>;
  delegate?(request: import('./delegation-runtime.js').RunDelegationRequest):Promise<object>;
  interactive?(sessionId:string,request:unknown):Promise<object>;
  delegationInput?(sessionId:string,request:{runId:string;recordId:string}):Promise<object>;
}): ToolDefinition[] {
  return [defineTool({
    name:'hima_delegation_input',description:'Read one exact input reference granted to this child by its recorded delegation. No file path or record enumeration; unavailable or invalidated evidence is refused. Material hashes refer to original verified bytes and any text truncation is explicit.',
    parameters:{runId:{type:'string',required:true},recordId:{type:'string',required:true}},
    output:{schema:{type:'object',additionalProperties:true},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},
    execute:async(args,execution)=>{if(!execution.agent||!operations.delegationInput)throw new Error('Delegated input reader is unavailable.');return toolJson(await operations.delegationInput(String(execution.agent.id),args));},
  }),defineTool({
    name:'hima_interactive',description:'Operate the exact qualified interactive Pack tool of an already admitted Run execution through its existing Site Job. Actions: open, input {toolSessionId,commandId,command:{name,args}}, observe, read, signal, close. Supply runId/executionId/nodeId/requestId/ownerEpoch/controlRevision; actor, argv, workspace and qualification are Host-owned. Poll timeout never cancels work. A command completion is not business validation. If qualification is absent, report unavailable; never use a raw terminal to bypass it.',
    parameters:{request:{type:'object',required:true,additionalProperties:true}},
    output:{schema:{type:'object',additionalProperties:true},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},
    execute:async(args,execution)=>{if(!execution.agent||!operations.interactive)throw new Error('Qualified interactive operations are unavailable.');return toolJson(await operations.interactive(String(execution.agent.id),args.request));},
  }),defineTool({
    name:'hima_delegate',description:'Delegate bounded research or coding to a real independent native child inside this existing Run. Read current Run epoch/revision first. Children return candidates; they never own the Run. Original time and follow-up allowances are enforced; total-token/cost caps are unavailable and rejected. Coding writes require an existing private subdirectory; shell/terminal/recursive tasks are not granted.',
    parameters:{runId:{type:'string',required:true},action:{type:'string',required:true,enum:['create','followup','cancel','result']},requestId:{type:'string',required:true},expectedEpoch:{type:'number',required:true},expectedRevision:{type:'number',required:true},delegationId:{type:'string'},contract:{type:'object',additionalProperties:true},text:{type:'string'}},
    output:{schema:{type:'object',additionalProperties:true},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},
    execute:async(args,execution)=>{if(!execution.agent||!operations.delegate)throw new Error('Run delegation is unavailable');return toolJson(await operations.delegate({...args,actor:String(execution.agent.id),origin:'agent'}));},
  }),defineTool({
    name: 'hima_inspect',
    description: 'Inspect an exact Run, node execution/generation, retained report version, or native child in this project. Read-only, sourced current facts; selecting a target never grants ownership.',
    parameters: { requestId: { type: 'string', required: true }, target: { type: 'object', required: true, additionalProperties: true,
      description: 'TargetAddress: run{runId}; node{runId,nodeId,executionId or generation}; report{reportRef,version,sha256}; child{parentSessionId,childSessionId}. Include kind.' } },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: async (args, execution) => {
      if (!execution.agent) throw new Error('a live conversation is required');
      return toolJson(await operations.inspect(String(execution.agent.id), args.requestId, args.target));
    },
  }), defineTool({
    name: 'hima_memory',
    description: 'Read or save a source-linked working summary in this project. It never resumes work or changes measurements, authority, pauses, or budgets. Re-read current sources on recovery; stale or unavailable memory must not direct execution. Use sources first to obtain Host-minted Run or retained native-session references; then save semantic text with those references. Newer events make an older source-linked summary stale, not current authority.',
    parameters: { action: { type: 'string', required: true, enum: ['read', 'sources', 'save'] }, runId: { type: 'string' }, summary: { type: 'object', additionalProperties: true } },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: async (args, execution) => {
      if (!execution.agent) throw new Error('a live conversation is required');
      return toolJson(await operations.memory(String(execution.agent.id), args));
    },
  })];
}

/** One numeric argument of a tool call, validated the same way. Absent is absent; wrong is refused. */
function toolNumber(name: RunArgumentName, given: number | undefined): number | undefined {
  if (given === undefined) return undefined;
  if (!allowsRunArgument(name, given)) throw new Error(badRunArgument(name, name, given));
  return given;
}

/**
 * Every entry of a caller-supplied `params` object, validated the way `--param` and the POST body
 * already do: a value that is not a finite number is the caller's mistake, named and returned as an
 * error — never silently dropped, which would leave a rule's declared parameter looking unbound
 * instead of wrong.
 */
function numericParams(raw: Record<string, unknown> | undefined): { params: Record<string, number> } | { error: string } {
  const params: Record<string, number> = Object.create(null);
  for (const [name, value] of Object.entries(raw ?? {})) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return { error: `params.${name} must be a finite number; got ${JSON.stringify(value)}` };
    }
    params[name] = value;
  }
  return { params };
}

/**
 * The `strategy` of a `hima_run` call: the knobs to set, by name (#58).
 *
 * A value is a finite number or a non-empty word, because those are the two kinds a pack can declare
 * a knob to be; which knob takes which, and whether the value is one that pack allows, is
 * `startRun`'s to say against its declaration. Refused rather than dropped, exactly as a bad
 * `params` entry is: a knob silently ignored would start a Campaign at a value nobody asked for.
 */
function strategyArgument(raw: unknown, what = 'strategy'): Record<string, StrategyValue> | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error(`${what} must be an object of knob values; got ${JSON.stringify(raw)}`);
  const strategy: Record<string, StrategyValue> = Object.create(null);
  for (const [name, value] of Object.entries(raw)) {
    const ok = typeof value === 'number' ? Number.isFinite(value) : typeof value === 'string' && value !== '';
    if (!ok) throw new Error(`${what}.${name} must be a finite number or a non-empty string; got ${JSON.stringify(value)}`);
    strategy[name] = value as StrategyValue;
  }
  return strategy;
}

/** Preparation values are shallow contract scalars; canonicalise numeric strings and key order. */
function samePreparedFacts(expected: Readonly<Record<string, unknown>>, actual: Readonly<Record<string, unknown>>): boolean {
  const scalar = (value: unknown): unknown => {
    if (typeof value !== 'string' || value.trim() === '') return value;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : value;
  };
  const ordered = (value: Readonly<Record<string, unknown>>) => Object.fromEntries(Object.keys(value).sort().map((key) => [key, scalar(value[key])]));
  return JSON.stringify(ordered(expected)) === JSON.stringify(ordered(actual));
}

interface VerdictToolValue { outcome: VerdictRecord['outcome']; ruleId: string; ruleVersion: string; recordId: string; cites: string[]; reason?: string; boundParameters?: Record<string, number> }

function verdictToolValue(v: VerdictRecord): VerdictToolValue {
  const head = { outcome: v.outcome, ruleId: v.ruleId, ruleVersion: v.ruleVersion, recordId: v.id, cites: v.cites };
  // An absent key, never an undefined one: a tool value must be lossless JSON.
  const withReason = v.reason === undefined ? head : { ...head, reason: v.reason };
  return v.boundParameters === undefined ? withReason : { ...withReason, boundParameters: v.boundParameters };
}

interface ObserveToolValue { kind: 'observed' | 'refused'; runId: string; recordId: string; contentSha256?: string; bytes?: number; reason?: string; verdicts?: VerdictToolValue[] }

function toolResult(result: ObserveResult): ObserveToolValue {
  const head = { kind: result.kind, runId: result.run.id, recordId: result.record.id };
  return result.kind === 'observed'
    ? { ...head, contentSha256: result.record.contentSha256, bytes: result.record.bytes }
    : { ...head, reason: result.record.reason };
}

interface RunToolValue {
  kind: StartRunResult['kind'];
  runId?: string;
  campaignId?: string;
  status?: string;
  currentNode?: string;
  strategy?: Readonly<Record<string, StrategyValue>>;
  reason?: string;
}

/** What `hima_run` answers with: where the Run got to, or why it could not start. An absent key,
 *  never an undefined one, so a tool value is lossless JSON. */
function runToolValue(result: StartRunResult): RunToolValue {
  if (result.kind === 'unfit') return { kind: 'unfit', reason: describePackCheck(result.check) };
  const head: RunToolValue = { kind: result.kind, runId: result.run.id, campaignId: result.run.campaignId };
  if (result.kind === 'unprepared') return { ...head, reason: describePrepare(result.prepared) };
  const { run } = result;
  const withStatus = run.status === undefined ? head : { ...head, status: run.status };
  const withNode = run.currentNode === undefined ? withStatus : { ...withStatus, currentNode: run.currentNode };
  return run.strategy === undefined ? withNode : { ...withNode, strategy: run.strategy };
}

interface CancelToolValue {
  kind: CancelResult['kind'];
  runId: string;
  status?: string;
  /** The tmux session this cancel stopped, when it stopped one. */
  stoppedSession?: string;
  /** The killed job record, when a stop was observed and recorded. */
  recordId?: string;
  reason?: string;
}

/** What `hima_cancel` answers with: what was stopped, or why nothing was. An absent key, never an
 *  undefined one, so a tool value is lossless JSON. */
function cancelToolValue(result: CancelResult): CancelToolValue {
  const head: CancelToolValue = { kind: result.kind, runId: result.run.id };
  const withStatus = result.run.status === undefined ? head : { ...head, status: result.run.status };
  if (result.kind === 'not-stopped') return { ...withStatus, stoppedSession: result.session, reason: result.reason };
  if (result.kind !== 'cancelled' || !result.stopped) return withStatus;
  return { ...withStatus, stoppedSession: result.stopped.job.session, recordId: result.stopped.id };
}

interface ResumeToolValue {
  kind: ResumeResult['kind'];
  runId: string;
  status?: string;
  currentNode?: string;
  /** The node the Run was re-entered at, on a resume that took. */
  nodeId?: string;
  /** The `resumed` record this action wrote, on a resume that took. */
  recordId?: string;
  /** Why nothing was resumed and nothing written, on the two that do neither. */
  reason?: string;
}

/** What `hima_resume` answers with: where the Run got to, or why it was not resumed. An absent key,
 *  never an undefined one, so a tool value is lossless JSON. */
function resumeToolValue(result: ResumeResult): ResumeToolValue {
  const head: ResumeToolValue = { kind: result.kind, runId: result.run.id };
  const status = result.run.status;
  if (result.kind === 'unresumable') return { ...head, reason: unresumableReason(result.reason) };
  if (result.kind === 'not-waiting') {
    const said = notWaitingToResume(status);
    return status === undefined ? { ...head, reason: said } : { ...head, status, reason: said };
  }
  const withStatus = status === undefined ? head : { ...head, status };
  const withNode = result.run.currentNode === undefined ? withStatus : { ...withStatus, currentNode: result.run.currentNode };
  return { ...withNode, nodeId: result.nodeId, recordId: result.record.id };
}

/**
 * Every `hima_*` tool, built against one host's dependencies.
 *
 * Answered as a list rather than registered here, because registering is the plugin entry's own
 * effect — a tool registration unwinds when the plugin unloads, the way dsh's own plugins do it —
 * and this module has nothing to say about that.
 */
export function himaTools(deps: FabricDeps, author?: (request: import('./authoring.js').AuthoringRequest, agent?: Agent) => Promise<{ pack: string; folder: string; sessionId: string; created: boolean }>,
  prepare?: (pack: string, site?: string, overrides?: PreparationOverrides) => PreparationView, knowledge?: { root: string },
  sites?: {
    readonly list: () => readonly SiteHeadView[];
    /** The tool's own discover/rediscover never passes `save` — a Site or Permit is written only
     *  from the HTTP route's own `save: true`, which requires a live browser session (Q47/ADR-0009):
     *  HimaGuide proposes a draft, and only a person's own action from the Configuration page saves
     *  it. `saved` on this answer is therefore always absent for a tool caller. */
    readonly discover: (request: Omit<SiteDiscoverBody, 'sessionId' | 'save'>) => Promise<{ readonly result: SiteDiscoveryResult; readonly saved?: SiteHeadView }>;
    /** A saved ssh Site's own destination/jumps and its Permit's own roots, for `rediscover` (#41
     *  task 4 review, important 3, minor 9): undefined when there is no such saved ssh Site to reuse. */
    readonly rediscoverInput: (name: string) => { readonly ssh: SiteDiscoverBody['ssh']; readonly hints: NonNullable<SiteDiscoverBody['hints']>; readonly bindings: Readonly<Record<string, string>> } | undefined;
  }, guidedStart?: (request: StartRunRequest) => Promise<StartRunResult>): ToolDefinition[] {
  return [
    ...author ? [defineTool({
      name: 'hima_author',
      description: 'Create or select a Pack folder and open its native authoring session. Returns the session identity for Open authoring session in this conversation. Invoke only for a user request to author a Pack; the new session uses the configured default model and writes only inside that Pack. No model turn or Site Job starts. Continue the five /hima-* skills in the returned session.',
      parameters: {
        pack: { type: 'string', required: true, description: 'Pack folder id: lowercase letters, digits and dashes.' },
        create: { type: 'boolean', description: 'True explicitly allows creation of a new folder. Existing Pack files are retained.' },
        handoff: {type:'object',additionalProperties:false,properties:{goal:{type:'string',required:true},sourcePaths:{type:'array',items:{type:'string'},required:true},inputGaps:{type:'array',items:{type:'string'}}},description:'Optional project-local SOP/script/report paths. Host hashes their bytes and queues a source-linked handoff without running a model or stage.'},
      },
      output: { schema: { type: 'object', additionalProperties: false, properties: {
        pack: { type: 'string', required: true }, folder: { type: 'string', required: true },
        sessionId: { type: 'string', required: true }, created: { type: 'boolean', required: true }, handoffMessageId:{type:'string'},
      } }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      execute: (args, execution) => author(args, execution.agent),
    })] : [],
    ...knowledge === undefined ? [] : [defineTool({
      name: 'hima_knowledge',
      description: 'Manage Hima-owned offline knowledge without any upload. import copies one explicitly selected PDF, Markdown or text file from this Agent workspace into the Campaign proposal scope returned by hima_prepare. list and search return identities and bounded snippets only. read returns bounded exact source text; when run is supplied, only the owning Agent at its currently admitted node may append a KnowledgeRecord. clear removes one exact current document. Pack knowledge remains read-only and is selected with source=pack and pack.',
      parameters: {
        action: { type: 'string', required: true, enum: ['import', 'list', 'search', 'read', 'clear'] },
        source: { type: 'string', enum: ['current', 'pack'], description: 'Defaults to current. Pack source is read-only.' },
        scope: { type: 'string', description: 'Required for current knowledge and Campaign-attached Pack reads: the full proposal token returned by hima_prepare. It is never a filesystem path.' },
        file: { type: 'string', description: 'Local source path for import only.' },
        title: { type: 'string' }, version: { type: 'string' }, query: { type: 'string' }, limit: { type: 'integer' },
        documentId: { type: 'string', description: 'Exact identity returned by list or search.' },
        chunkId: { type: 'string', description: 'Exact identity returned by search.' },
        pack: { type: 'string', description: 'Installed Pack id for Pack knowledge.' },
        run: { type: 'string', description: 'Optional attached Campaign. Only read records evidence, and only with a live Agent.' },
      },
      output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      execute: async (args, execution) => {
        const source = args.source === 'pack' ? 'pack' : 'current';
        const attachedRun = args.run === undefined ? undefined : deps.ledger.run(args.run);
        const currentScope = productKnowledgeScope(args.scope, attachedRun?.proposalId);
        if (args.action === 'import') {
          if (source !== 'current' || currentScope === undefined || !args.file || !execution.agent) throw new Error('import requires current source, a prepared Campaign scope, a file and a live Agent');
          const authorized = authorizedKnowledgeImport(execution.agent, args.file);
          if (authorized === undefined) throw new Error('knowledge import is limited to this Agent workspace or an explicit product-selected path');
          return toolJson(await importCurrentKnowledge({ root: knowledge.root, scope: currentScope, file: authorized, ...(args.title === undefined ? {} : { title: args.title }), ...(args.version === undefined ? {} : { version: args.version }) }));
        }
        if (args.action === 'list') {
          if (source !== 'current' || currentScope === undefined) throw new Error('list requires current source and a prepared Campaign scope');
          return toolJson({ documents: await listCurrentKnowledge(knowledge.root, currentScope) });
        }
        if (args.action === 'clear') {
          if (source !== 'current' || currentScope === undefined || !args.documentId || !args.run || !execution.agent) {
            throw new Error('clear requires current source, an active owning Campaign, its proposal scope and documentId');
          }
          writableCampaignKnowledgeExecution(deps, args.run, execution.agent, currentScope);
          return toolJson({ cleared: await clearCurrentKnowledge(knowledge.root, currentScope, args.documentId) });
        }
        if (args.action === 'search') {
          if (!args.query) throw new Error('search requires query');
          const limit = args.limit === undefined ? undefined : args.limit;
          if (source === 'current') {
            if (currentScope === undefined) throw new Error('current search requires a prepared Campaign scope');
            return toolJson({ hits: await searchCurrentKnowledge(knowledge.root, currentScope, args.query, limit) });
          }
          if (!args.pack) throw new Error('Pack search requires pack');
          return toolJson({ hits: await searchPackKnowledge(loadPack(deps.packsDir, args.pack), args.query, limit) });
        }
        if (!args.documentId || !args.chunkId) throw new Error('read requires documentId and chunkId');
        const attached = args.run === undefined ? undefined : (() => {
          if (!execution.agent) throw new Error('a Campaign knowledge read requires a live conversational Agent');
          if (currentScope === undefined) throw new Error('a Campaign knowledge read requires the Campaign proposal scope');
          return writableCampaignKnowledgeExecution(deps, args.run, execution.agent, currentScope);
        })();
        const hit = source === 'current'
          ? currentScope === undefined ? undefined : await readCurrentKnowledge(knowledge.root, currentScope, args.documentId, args.chunkId)
          : !args.pack ? undefined : await readPackKnowledge(loadPack(deps.packsDir, args.pack), args.documentId, args.chunkId);
        if (!hit) throw new Error(source === 'current' ? 'current read requires a prepared Campaign scope' : 'Pack read requires pack');
        if (args.run !== undefined) {
          const binding = attached!;
          const agent = execution.agent!;
          const record = await recordDocumentKnowledgeRead({ ledger: deps.ledger, packsDir: deps.packsDir, runId: args.run,
            nodeId: binding.execution.nodeId, attempt: binding.execution.attempt, sessionId: String(agent.id), workshop: 'knowledge', hit,
            root: knowledge.root,
            origin: source === 'current' ? 'current' : 'document', ...(binding.execution.branchId === undefined ? {} : { branchId: binding.execution.branchId }) });
          return toolJson({ ...hit, recordId: record.id });
        }
        return toolJson(hit);
      },
    })],
    defineTool({
      name: 'hima_context',
      description: 'Read current Run execution facts, owner/epoch/revision, reference nodes, available node ids and admitted executions, plus recorded Jobs, code, observations and verdicts. This read starts no business work. Use the current context already returned by hima_run or hima_execute for the next action; refresh here when asynchronous facts change or that context is missing or stale. A different selected Run does not change its owner.',
      parameters: { run: { type: 'string', required: true, description: 'Exact Run id.' } },
      output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      execute: async (args, execution) => {
        await assertProjectAccess(deps, execution.agent, args.run);
        const context = executionContext(deps, args.run);
        let words: RunWords | undefined;
        try { words = runPackWords(deps.packsDir, context.run); }
        catch { /* Keep execution facts readable when the original method is unavailable. */ }
        return toolJson({ runId: args.run, ...context, facts: runView(deps.ledger, context.run, words) });
      },
    }),
    defineTool({
      name: 'hima_execute',
      description: 'Request one controlled node or Run action as this actual conversational Agent. adopt verifies an unowned historical Run at epoch/revision 0 before binding this conversation; begin admits a node. For a Workshop, begin returns nextAction=recommend: use recommend with that executionId before work to obtain the actual private directory, entry, argv, inputs, Pack knowledge and bounded history, then write the entry. read/write/knowledge operate within that admitted scope. A rejected authored Workshop program is a coding diagnostic: open the next available attempt and revise it without asking a person to clear a mechanical retry. When context.available lists independent branches, begin/work their licence-free Jobs up to the Site job cap before waiting; never repeat one already working. knowledge with file reads current Pack method knowledge; assetRun/assetPath reads only a verified in-scope Run archive. Historical text is background and cannot change Goal, method or permissions. work performs the mechanical operation and returns a Job identity promptly; complete validates actual evidence. Submit an Explore strategy decision, rationale, cites and any next strategy together on complete; work does not commit that decision. grow submits one structured additive branch. revise accepts a byte-identified bounded code/input change, preserves both versions, invalidates exactly its dependency closure and starts no Job; each rerun is still an explicit owner action. Use each response context for the next action and its epoch/revision; refresh with hima_context for asynchronous changes or missing/stale facts. No action drives the rest of the graph. pause blocks new work while in-flight Jobs may still run; cancel requests real stop. Preserve requestId only for an identical retry; inspect refused responses before deciding again.',
      parameters: {
        run: { type: 'string', required: true, description: 'Exact Run id.' },
        action: { type: 'string', required: true, enum: ['adopt', 'begin', 'work', 'complete', 'pause', 'continue', 'cancel', 'handoff', 'revise', 'grow', 'read', 'write', 'knowledge', 'recommend', 'analyze'] },
        expectedEpoch: { type: 'integer', required: true, description: 'Owner epoch from the latest context.' },
        expectedRevision: { type: 'integer', required: true, description: 'Control revision from the latest context.' },
        requestId: { type: 'string', required: true, description: 'Unique bounded request identity, reused only for an identical retry.' },
        nodeId: { type: 'string', description: 'Exact reference node for begin, or optional pause scope.' },
        executionId: { type: 'string', description: 'Admitted execution identity for node work and completion.' },
        targetOwner: { type: 'string', description: 'Explicit handoff target; must be a real Host conversation.' },
        path: { type: 'string', description: 'Workshop code path relative to this execution\'s private workshop.directory returned by recommend, not the Campaign workspace. For the executable use the returned entry exactly, e.g. analyze.sh, without prepending research/analysis or the absolute entryPath. Helper paths use the same private base.' },
        content: { type: 'string', description: 'Exact code/file content for write.' },
        output: { type: 'string', description: 'Declared output name, or @job-log for this execution’s actual Job log.' },
        file: { type: 'string', description: 'Declared knowledge file.' },
        assetRun: { type: 'string', description: 'Optional verified historical source Run. Omit with file to preserve current Pack knowledge reads; omit both to read the best automatically applicable archived source.' },
        assetPath: { type: 'string', description: 'Optional material path from the selected source Run\'s verified archive; defaults to experience.json. It never names an arbitrary filesystem path.' },
        analysis: { type: 'object', additionalProperties: false, description: 'For analyze before the Run ends. Cite actual records of this Run; quoted numbers must match their observations. Model text remains interpretation, never a Judge verdict.', properties: {
          question: { type: 'string', required: true }, hypotheses: { type: 'array', items: { type: 'string' }, required: true },
          comparisons: { type: 'array', items: { type: 'string' }, required: true }, limitations: { type: 'array', items: { type: 'string' }, required: true },
          nextExperiments: { type: 'array', items: { type: 'string' }, required: true },
          claims: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
            text: { type: 'string', required: true }, cites: { type: 'array', items: { type: 'string' }, required: true },
            measurements: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
              recordId: { type: 'string', required: true }, field: { type: 'string', required: true }, value: { type: 'number', required: true }, unit: { type: 'string' },
            } } },
          } } },
        } },
        decision: { type: 'string', enum: ['goal-met', 'converged', 'next-strategy'], description: 'For an Explore strategy decision, submit this on complete together with rationale and cites. work does not submit a decision.' },
        strategy: { type: 'object', additionalProperties: true, description: 'Declared strategy values supplied with decision next-strategy on Explore complete; omit for goal-met or converged.' },
        rationale: { type: 'string', description: 'Reason for the Explore decision, grounded in cited facts; submit with decision on complete.' },
        cites: { type: 'array', items: { type: 'string' }, description: 'Current-generation observation and required Judge verdict record ids supporting the Explore decision; submit with decision on complete.' },
        proposal: { type: 'object', additionalProperties: false,
          description: 'For grow, express the research intent with the exact named fields below. Omit method, parent and inputThroughSeq to let Harness attach current Run identities. Omit inputs to use current-generation evidence, or give record sequence numbers/ids; Harness computes record identities. Reuse proposalId only for identical intent; correcting a refused proposal uses a new proposalId/requestId. Explicit wrong hashes are still refused.',
          properties: {
            proposalId: { type: 'string', required: true },
            impactNodes: { type: 'array', items: { type: 'string' }, required: true },
            expectedChanges: { type: 'array', items: { type: 'string' }, required: true },
            nodes: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
              id: { type: 'string', required: true }, kind: { type: 'string', enum: ['act', 'judge', 'explore', 'wait'], required: true },
              parameters: { type: 'object', additionalProperties: true, required: true, description: 'Existing node parameters: act uses tool/observes/workshop and arguments; judge uses rules and bind; explore/wait retain their Pack semantics.' },
            } } },
            edges: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
              from: { type: 'string', required: true }, to: { type: 'string', required: true },
              outcome: { type: 'string', enum: ['PASS', 'FAIL', 'UNDETERMINED'] }, revisit: { type: 'boolean' },
            } } },
            requiredOutputs: { type: 'array', items: { type: 'string' }, required: true },
            endCondition: { type: 'string', required: true }, returnNode: { type: 'string', required: true }, optional: { type: 'boolean', required: true },
            method: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', required: true }, version: { type: 'string', required: true }, digest: { type: 'string', required: true } } },
            parent: { type: 'object', additionalProperties: false, properties: { nodeId: { type: 'string', required: true }, generation: { type: 'integer', required: true } } },
            inputThroughSeq: { type: 'integer' },
            inputs: { type: 'array', items: { oneOf: [{ type: 'string' }, { type: 'integer' }, { type: 'object', additionalProperties: false, properties: { recordId: { type: 'string', required: true }, contentIdentity: { type: 'string' } } }] } },
          },
        },
        revision: { type: 'object', additionalProperties: false, description: 'For revise, provide revisionId, reason, changedNodes, changes and optional strategy. Harness fills omitted method/input identities and affectedNodes from the effective graph. Workshop changes can omit fromSha256/sourceRecordId to use the latest valid code for that node/path; workspace changes require a verified fromSha256 or captured sourceRecordId. Explicit false identities/impact are refused. Use a new revisionId for changed intent.', properties: {
          revisionId: { type: 'string', required: true }, reason: { type: 'string', required: true },
          changedNodes: { type: 'array', items: { type: 'string' }, required: true },
          affectedNodes: { type: 'array', items: { type: 'string' } }, strategy: { type: 'object', additionalProperties: true },
          changes: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
            nodeId: { type: 'string', required: true }, scope: { type: 'string', enum: ['workshop', 'workspace'], required: true }, path: { type: 'string', required: true },
            content: { type: 'string', required: true }, fromSha256: { type: 'string' }, sourceRecordId: { type: 'string' },
          } } },
          method: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', required: true }, version: { type: 'string', required: true }, digest: { type: 'string', required: true } } },
          inputThroughSeq: { type: 'integer' }, inputs: { type: 'array', items: { oneOf: [{ type: 'string' }, { type: 'integer' }, { type: 'object', additionalProperties: false, properties: { recordId: { type: 'string', required: true }, contentIdentity: { type: 'string' } } }] } },
        } },
        proposalId: { type: 'string', description: 'Accepted proposal identity when settling an active optional growth branch.' },
        growthDisposition: { type: 'string', enum: ['failed', 'cancelled', 'abandoned'], description: 'For grow on an active optional branch: preserve this outcome and return to its declared parent after confirming no in-flight Job.' },
      },
      output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: executionText(value) }] },
      execute: async (args, execution) => {
        await assertProjectAccess(deps, execution.agent, args.run);
        if (!execution.agent) throw new Error('this operation requires a live conversational Agent');
        const { run, strategy, ...fields } = args;
        const request: ExecutionActionRequest = { ...fields, runId: run, actor: String(execution.agent.id), origin: 'agent', ...(strategy === undefined ? {} : { strategy: strategyArgument(strategy) }) };
        const bound = request.action === 'grow' && args.proposal !== undefined ? { ...request, proposal: modelResearchProposal(deps, run, 'growth', args.proposal) }
          : request.action === 'revise' && args.revision !== undefined ? { ...request, revision: modelResearchProposal(deps, run, 'revision', args.revision) } : request;
        return toolJson({ runId: run, ...await executionAction(deps, bound) });
      },
    }),
    defineTool({
      name: 'hima_observe',
      description: 'Observe one file on a named Site: read it under the site permit, hash it, and append an observation record to the HimaLedger. Refusals are recorded too. With `judge`, HimaJudge then rules on the observation and appends its verdicts.',
      parameters: {
        site: { type: 'string', required: true, description: 'Site name, as in the site file.' },
        path: { type: 'string', required: true, description: 'File path on the site, absolute or relative to its workspace root.' },
        reader: { type: 'string', description: 'Reader id; defaults to raw.' },
        run: { type: 'string', description: 'An existing run id to append this observation to. Omitted, the observation opens a run of its own.' },
        judge: { type: 'array', items: { type: 'string' }, description: 'Rule ids (or id@version) for HimaJudge to rule on this observation. Verdicts are written by the judge, never by this tool.' },
        params: {
          type: 'object',
          additionalProperties: true,
          description: 'Named values for any parameter a rule in `judge` declares, e.g. { "declared_parameter": 2.3 }. Every value must be a finite number; a non-numeric value is rejected, never silently dropped. A declared parameter with no matching entry here leaves that rule UNDETERMINED.',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            kind: { type: 'string', required: true, enum: ['observed', 'refused'] },
            runId: { type: 'string', required: true },
            recordId: { type: 'string', required: true },
            contentSha256: { type: 'string' },
            bytes: { type: 'integer' },
            reason: { type: 'string' },
            verdicts: {
              type: 'array',
              description: 'One entry per requested rule; absent when no rules were asked for.',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  outcome: { type: 'string', required: true, enum: ['PASS', 'FAIL', 'UNDETERMINED'] },
                  ruleId: { type: 'string', required: true },
                  ruleVersion: { type: 'string', required: true },
                  recordId: { type: 'string', required: true },
                  cites: { type: 'array', required: true, items: { type: 'string' } },
                  reason: { type: 'string' },
                  boundParameters: { type: 'object', additionalProperties: true, description: 'The value bound to each parameter this rule declared, when it declared one.' },
                },
              },
            },
          },
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      execute: async (args, execution) => {
        if (!legacyAutomaticAllowed() && !execution.agent) throw new Error('a Probe needs a live project conversation');
        if (args.run) await assertProjectAccess(deps, execution.agent, args.run);
        // Validated before anything is read: a bad `params` entry must leave no observation and
        // no verdict behind, the same as a malformed `--param` on the command line.
        const parsedParams = numericParams(args.params as Record<string, unknown> | undefined);
        if ('error' in parsedParams) throw new Error(parsedParams.error);
        if (args.run && deps.ledger.run(args.run)?.control) throw new Error('Agent-owned Run observations require hima_execute with an admitted execution; direct observation is refused');
        const result = await observe(deps, { ...args, projectSessionId: execution.agent ? String(execution.agent.id) : undefined } as ObserveRequest);
        const value = toolResult(result);
        if (result.kind === 'observed' && args.judge?.length) {
          value.verdicts = (await deps.judge.evaluate({ runId: result.run.id, ruleIds: args.judge, params: parsedParams.params })).map(verdictToolValue);
        }
        return value;
      },
    }),
    defineTool({
      name: 'hima_prepare',
      description: 'Inspect one installed HimaPack and, when named, one saved Site. Returns a read-only Campaign proposal with purpose, inputs, tools, knowledge, reference graph, unknowns and next actions. When this Agent\'s own workspace holds hima/campaign.yml naming this same Pack, its Goal, Strategy, input and Budget overrides are applied (report: campaignFile.applied). Creates no Campaign, Run, workspace, Job, Ledger row or hidden Agent. Use this before hima_run; ask the user only for unresolved business choices or facts Hima cannot discover.',
      parameters: {
        pack: { type: 'string', required: true, description: 'Installed HimaPack id.' },
        site: { type: 'string', description: 'Saved Site name. Omit while helping the user connect one.' },
        file: { type: 'boolean', description: 'Apply this workspace\'s own hima/campaign.yml when it names this same Pack. Default true; false prepares the Pack plainly, ignoring any Campaign file present.' },
      },
      output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      execute: (args, execution) => {
        if (!prepare) throw new Error('Campaign preparation is unavailable on this Host');
        const { campaignFile, overrides } = campaignFileApplication(execution.agent, args.pack, args.file !== false);
        return Promise.resolve(toolJson({ ...prepare(args.pack, args.site, overrides), campaignFile }));
      },
    }),
    defineTool({
      name: 'hima_run',
      description: 'Confirm a prepared Campaign on the named Site and arrange an independent execution conversation. The returned context names its actual owner. This Guide stays available; it does not acquire execution ownership. Open the owner conversation for node work; Guide may read current facts and explain progress. Goal and total budget remain fixed. When this Agent\'s own workspace holds hima/campaign.yml naming this same Pack, its Goal, Strategy, input and Budget overrides are applied by default (report: campaignFile.applied), the same file hima_prepare applies.',
      parameters: {
        proposalId: { type: 'string', description: 'The current id returned by hima_prepare. Supply it when confirming a prepared Campaign.' },
        pack: { type: 'string', required: true, description: 'Pack id, as the packs directory holds it.' },
        site: { type: 'string', required: true, description: 'Site name, as in the site file.' },
        goal: {
          type: 'object',
          required: true,
          additionalProperties: true,
          description: 'The Goal parameters declared by contract.goal, with their units, bounds and precision. Values are finite numbers or lossless decimal strings. Immutable for the run: a new goal is a new campaign.',
        },
        strategy: {
          type: 'object',
          additionalProperties: true,
          description: 'What to set the pack\'s own strategy knobs to for the first generation, by the names its contract declares, e.g. { "<knob>": <value> }. A knob left out takes the default that pack declares; a knob it does not declare, or a value outside the bounds or the list it declares, is refused and no run is started.',
        },
        file: { type: 'boolean', description: 'Apply this workspace\'s own hima/campaign.yml when it names this same Pack. Default true; false confirms plainly, ignoring any Campaign file present.' },
        ...(legacyAutomaticAllowed() ? {
          test: { type: 'boolean', description: 'Contract-test purpose only.' },
          timeBox: { type: 'number', description: 'Contract-test budget only.' },
          retries: { type: 'integer', description: 'Contract-test budget only.' },
          generations: { type: 'integer', description: 'Contract-test budget only.' },
        } : {}),
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            kind: { type: 'string', required: true, enum: ['ran', 'unfit', 'unprepared'] },
            runId: { type: 'string' },
            campaignId: { type: 'string' },
            context: { type: 'object', additionalProperties: true, description: 'Current reference and execution facts for this same Agent.' },
            status: { type: 'string' },
            currentNode: { type: 'string' },
            strategy: { type: 'object', additionalProperties: true, description: 'The strategy the run now stands at: the next one to try, or the one that met the goal.' },
            reason: { type: 'string', description: 'Why the run could not start, on an unfit pack or a workspace that is not this campaign\'s.' },
            campaignFile: { type: 'object', additionalProperties: false, description: 'Whether this Agent\'s own hima/campaign.yml was applied (#41 task 3).', properties: {
              path: { type: 'string', required: true }, applied: { type: 'boolean', required: true },
              error: { type: 'string', description: 'A file present but not readable as hima-campaign/1 (H9): the one sentence naming the field, and applied is false.' } } },
          },
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      execute: async (args, execution) => {
        if (!execution.agent) throw new Error('hima_run requires a live conversational Agent');
        if (args.proposalId === undefined && !legacyAutomaticAllowed()) {
          throw new Error('confirm the current Campaign proposal returned by hima_prepare before starting a Run');
        }
        const goal = strategyArgument(args.goal, 'goal') ?? {};
        const strategy = strategyArgument(args.strategy);
        // The same file `hima_prepare` applied by default, applied here the same way (#41 task 3),
        // so a confirmation compares like with like: the freshness check below and the actual start
        // both see the workspace's own input overrides, whether or not this Agent's workspace holds
        // one naming this Pack.
        const { campaignFile, overrides } = campaignFileApplication(execution.agent, args.pack, args.file !== false);
        if (args.proposalId !== undefined) {
          if (args.test === true) throw new Error('a confirmed product Campaign cannot be changed into a Pack test');
          const current = prepare?.(args.pack, args.site, overrides);
          if (current === undefined || !current.ready || !sameCampaignProposalFacts(current.id, args.proposalId)) {
            throw new Error('Campaign preparation changed or is no longer ready; call hima_prepare again before confirming');
          }
          if (!samePreparedFacts(current.goal, goal) || !samePreparedFacts(current.strategy, strategy ?? current.strategy)) {
            throw new Error('the submitted Goal or Strategy differs from the reviewed Campaign proposal; prepare the edited Campaign again before confirming');
          }
          if (args.timeBox !== undefined || args.retries !== undefined || args.generations !== undefined) {
            throw new Error('a confirmed Campaign uses the reviewed Pack budget; budget overrides require a new preparation and are unavailable in this product path');
          }
        }
        // The same checks the command face and the route make, from the same tables: a tool call is
        // a caller like any other, and a time box no person could type must not be one a model can.
        const timeBox = toolNumber('timeBox', args.timeBox);
        // The confirmation already held this Agent's own Strategy to the reviewed proposal's above
        // (`samePreparedFacts`), which tolerates an omitted `args.strategy` because it already equals
        // `current.strategy` — but the *actual* Run must still start at that same Strategy, not
        // silently fall back to the Pack's plain defaults, when the file's own knob is what put it
        // there. Budget is the same shape: a confirmed Campaign is refused explicit budget args
        // above, so the file's own Budget override — the only other source — is what reaches the Run.
        const result = await (guidedStart ?? ((request: StartRunRequest) => startRun(deps, request)))({
          ownerSessionId: legacyAutomaticAllowed() ? undefined : String(execution.agent.id),
          ...(args.proposalId === undefined ? {} : { proposalId: args.proposalId }),
          pack: args.pack,
          site: args.site,
          goal,
          strategy: strategy ?? overrides?.strategy,
          ...(overrides?.inputs === undefined ? {} : { inputs: overrides.inputs }),
          ...(overrides === undefined ? {} : { overrides }),
          // An absent key, never an undefined one, as everywhere else a request is composed here:
          // the schema above has already held it to a boolean, so a caller that said nothing has
          // said nothing and the pack folder decides.
          ...(args.test === undefined ? {} : { test: args.test }),
          timeBoxMs: timeBox !== undefined ? Math.round(timeBox * 60_000)
            : overrides?.budget?.timeBoxMinutes !== undefined ? Math.round(overrides.budget.timeBoxMinutes * 60_000) : undefined,
          retryAllowance: toolNumber('retries', args.retries) ?? overrides?.budget?.retries,
          generationLimit: toolNumber('generations', args.generations) ?? overrides?.budget?.generations,
        });
        return { ...runToolValue(result), campaignFile, ...(result.kind === 'ran' ? { context: toolJson(executionContext(deps, result.run.id)) } : {}) };
      },
    }),
    // The resume face as a tool, beside the run face: a waiting Run is cleared the same way from
    // an agent as from the command line.
    defineTool({
      name: 'hima_resume',
      description: 'Legacy compatibility only. Agent-owned Runs refuse this operation: read hima_context and use hima_execute continue with current owner epoch/revision. No automatic continuation is available in production.',
      parameters: {
        run: { type: 'string', required: true, description: 'The run id to resume, as /hima status names it.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            kind: { type: 'string', required: true, enum: ['resumed', 'not-waiting', 'unresumable'] },
            runId: { type: 'string', required: true },
            status: { type: 'string' },
            currentNode: { type: 'string' },
            nodeId: { type: 'string', description: 'The node the run was re-entered at.' },
            recordId: { type: 'string', description: 'The `resumed` record this action wrote.' },
            reason: { type: 'string', description: 'Why nothing was resumed and nothing written.' },
          },
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      // The calling agent's session is who the ledger records; a call arriving without one is
      // the workbench's, as the resume route's is.
      execute: async (args, exec) => {
        await assertProjectAccess(deps, exec.agent, args.run);
        return resumeToolValue(await resumeRun(deps, { runId: args.run, who: exec.agent === undefined ? 'workbench' : String(exec.agent.id) }));
      },
    }),
    // ---------------------------------------------------------------------------------------
    // The three the pack authoring pipeline's stages call (#64). A stage is a model following a
    // skill body with the tools that exist, and what a stage must never do is *compute* — a hash, a
    // folder digest, a check against the ledger. Each of these is one of those computations, so the
    // skill asks for it and writes down the answer rather than working one out.
    //
    // Registered globally with the rest, which is what puts them within reach of an authoring
    // session: the guard governs `write`, `edit` and `bash` and nothing else, so a chat whose working
    // directory is a pack folder can ask these three exactly as any other session can.
    // ---------------------------------------------------------------------------------------------
    defineTool({
      name: 'hima_pack_check',
      description: 'Hold a HimaPack against a named Site and answer how far up the authoring pipeline its folder has come: whether the site can host it, which rung the folder stands on, what the next rung needs, and the whole check in the words `/hima pack check` prints. A folder with no contract in it yet is answered by the ladder rather than as an unknown pack.',
      parameters: {
        pack: { type: 'string', required: true, description: 'Pack id, which is the folder name under the packs directory.' },
        site: { type: 'string', required: true, description: 'Site name, as in the site file.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            fit: { type: 'boolean', required: true, description: 'Whether this site can host this pack as the folder now stands.' },
            stage: { type: 'string', required: true, description: 'The highest rung of the authoring pipeline this folder has reached.' },
            next: { type: 'string', description: 'The rung above, or absent at the top of the ladder.' },
            needs: { type: 'string', description: 'What that rung needs and which stage writes it; absent at the top.' },
            issue: { type: 'string', description: 'Why the ladder stopped here, when it stopped on a file that is there and wrong.' },
            text: { type: 'string', required: true, description: 'The whole check as `/hima pack check` prints it.' },
          },
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      execute: async (args) => {
        const result = checkInstalledPack(deps, { pack: args.pack, site: args.site });
        const stage = packCheckStage(result);
        // An absent key, never an undefined one: at the top of the ladder there is no next rung, and
        // a rung that stopped on nothing has no issue to name.
        const head = { fit: packCheckFit(result), stage: stage.stage, text: describePackCheckResult(result) };
        const withNext = stage.next === undefined ? head : { ...head, next: stage.next, needs: stage.needs! };
        return Promise.resolve(stage.issue === undefined ? withNext : { ...withNext, issue: stage.issue });
      },
    }),
    defineTool({
      name: 'hima_status',
      description: 'Read one HimaHarness run back out of the HimaLedger: the run row, every observation, refusal and verdict, the state of each node, one row per generation of its loop, its jobs, its blockers, its latest decision and its experience report. What the run view route answers, without a browser. A run this ledger does not hold is answered in words and nothing is read, and a run whose pack cannot be loaded is answered as unreadable naming the pack rather than as a view with the pack\'s own words missing.',
      parameters: {
        run: { type: 'string', required: true, description: 'The run id, as /hima run or /hima status names it.' },
      },
      output: {
        schema: {
          // Open, because what a run view carries is the run view's own declaration (`remote.ts`) and
          // it grows with the harness: a closed schema here would be a second spelling of it, and the
          // first ticket to add a section to a Run would make this tool refuse its own answer.
          type: 'object',
          additionalProperties: true,
          properties: {
            kind: { type: 'string', required: true, enum: ['run', 'unknown', 'unreadable'], description: 'Whether this ledger holds that run, and whether its pack could be read.' },
            reason: { type: 'string', description: 'Why there is nothing to read, when there is nothing.' },
            run: { type: 'json', description: 'The run row: its identity, status, pack, purpose, goal, budget, strategy and meters.' },
          },
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      execute: async (args, execution) => {
        await assertProjectAccess(deps, execution.agent, args.run);
        const run = deps.ledger.run(args.run);
        // A refusal in words, as `hima_resume` answers one: the caller asked about a run and there is
        // no such run, which is a fact about their request and not a fault of this host.
        if (!run) return Promise.resolve({ kind: 'unknown' as const, reason: `no run ${args.run} in the HimaLedger; nothing was read` });
        // A pipeline stage records this answer, so a verified identity that cannot be read must be
        // reported as unreadable. An unreadable current installation is irrelevant when this Run's
        // own method is retained. Legacy rows with no digest retain raw names, never today's labels.
        let words: RunWords | undefined;
        try {
          words = runPackWords(deps.packsDir, run);
        } catch (err) {
          return Promise.resolve({
            kind: 'unreadable' as const,
            reason: `run ${args.run} names pack ${run.packId!}, and that pack cannot be read: ${(err as Error).message}`,
          });
        }
        // The very JSON the run view route puts on the wire, round-tripped through it: a view whose
        // arrays are readonly is a TypeScript shape, and what a tool answers with is a JSON document.
        // Doing it here rather than retyping the view's sections as tool schema keeps this tool's
        // answer and the route's one answer — the day a section is added to a Run it is in both.
        const view: unknown = JSON.parse(JSON.stringify(runView(deps.ledger, run, words)));
        return Promise.resolve({ kind: 'run' as const, ...(view as Record<string, never>) });
      },
    }),
    defineTool({
      name: 'hima_pack_release',
      description: 'Seal a tested HimaPack: write VERSION.yml over every file the folder is made of, with the hashes this harness computed, the version its contract declares, and the test record it rests on. Refuses a folder that is not tested, one whose test record no longer holds against the ledger, and one holding anything that is not a plain file. Releasing again over the same version rewrites the seal, which is what follows a fixed script and a re-run test stage.',
      parameters: {
        pack: { type: 'string', required: true, description: 'Pack id, which is the folder name under the packs directory.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            kind: { type: 'string', required: true, enum: ['released', 'refused'] },
            pack: { type: 'string', description: 'The pack that was sealed.' },
            version: { type: 'string', description: 'The version its contract declares, which is what was sealed.' },
            released: { type: 'string', description: 'When the seal was written.' },
            run: { type: 'string', description: 'The run its test record rests on.' },
            files: { type: 'integer', description: 'How many files the seal covers.' },
            file: { type: 'string', description: 'Where the seal was written.' },
            rewritten: { type: 'boolean', description: 'Whether this replaced a seal the folder already carried.' },
            reason: { type: 'string', description: 'Why nothing was sealed, when nothing was.' },
          },
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      execute: (args) => {
        const result = releasePack(deps, { pack: args.pack });
        if (result.kind === 'refused') return Promise.resolve({ kind: 'refused' as const, reason: result.reason });
        const { sealed } = result;
        return Promise.resolve({
          kind: 'released' as const,
          pack: sealed.pack,
          version: sealed.version,
          released: sealed.released,
          run: sealed.test.run,
          files: Object.keys(sealed.files).length,
          file: result.file,
          rewritten: result.rewritten,
        });
      },
    }),
    defineTool({
      name: 'hima_cancel',
      description: 'Stop a Run: kill the Job it has open on its Site, wait for the session to be observed gone, and end the Run as cancelled. A Run is not cancelled until the stop is observed, so a kill that does not take answers that nothing was stopped rather than claiming it was. Cancelling a Run that already ended answers with its status and writes nothing.',
      parameters: {
        run: { type: 'string', required: true, description: 'The run id to stop, as /hima run or /hima status names it.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            kind: { type: 'string', required: true, enum: ['cancelled', 'ended', 'not-started', 'not-stopped'] },
            runId: { type: 'string', required: true },
            status: { type: 'string', description: 'The run\'s status now: `cancelled` when this call ended it.' },
            stoppedSession: { type: 'string', description: 'The tmux session that was stopped, or the one still there on `not-stopped`.' },
            recordId: { type: 'string', description: 'The killed job record the observed stop was written as.' },
            reason: { type: 'string', description: 'Why nothing was stopped, when nothing was.' },
          },
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      execute: async (args, execution) => {
        await assertProjectAccess(deps, execution.agent, args.run);
        if (deps.ledger.run(args.run)?.control) throw new Error('use hima_context then hima_execute cancel with the current owner epoch and control revision');
        return cancelToolValue(await cancelRun(deps, args.run));
      },
    }),
    ...sites === undefined ? [] : [defineTool({
      name: 'hima_site',
      description: 'List every saved Site, or learn one through the caller\'s own SSH identity, keys and agent — no credential is read or stored. list returns each saved Site\'s readiness and capacity. discover and rediscover run the same bounded, read-only probe vocabulary on an ssh destination and answer a draft (site, permit, unknowns, conflicts); rediscover reuses a saved Site\'s own destination, jumps and permitted roots, so it takes only name. Neither ever writes a Site or Permit file: this tool creates no Run, workspace, Job or Ledger row, and HimaGuide cannot grant a Permit\'s authority by itself — the person saves a reviewed draft from the Configuration page, which is a live browser session\'s own action.',
      parameters: {
        action: { type: 'string', required: true, enum: ['list', 'discover', 'rediscover'] },
        name: { type: 'string', description: 'Site name for discover/rediscover: starts with a letter, then letters, digits, ".", "_" or "-".' },
        destination: { type: 'string', description: 'user@host or user@host:port for discover. Ignored for rediscover, which reuses the saved Site\'s own destination.' },
        jumps: { type: 'array', items: { type: 'string' }, description: 'Bastion hosts to pass through, in order, each user@host[:port]. discover only; rediscover reuses the saved Site\'s own.' },
        hints: {
          type: 'object', additionalProperties: false,
          description: 'Non-secret direction for discover: never a command, environment or credential. Ignored for rediscover, which reuses the saved Site\'s own workspace root and permitted roots.',
          properties: {
            workspaceRoot: { type: 'string', description: 'Absolute path this Site\'s Campaign workspaces are created under.' },
            allowedReadRoots: { type: 'array', items: { type: 'string' } },
            allowedWriteRoots: { type: 'array', items: { type: 'string' } },
            allowedWrappers: { type: 'array', items: { type: 'string' } },
            toolCommands: { type: 'array', items: { type: 'string' }, description: 'Executable names the selected Pack requires; discovery only asks which of these are on the Site\'s PATH.' },
          },
        },
      },
      output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      execute: async (args) => {
        if (args.action === 'list') return toolJson({ sites: sites.list() });
        const nextAction = 'Ask the person to save this Site from the Configuration page; HimaGuide cannot write a Site Permit.';
        if (args.action === 'rediscover') {
          if (!args.name) throw new Error('rediscover requires name');
          const input = sites.rediscoverInput(args.name);
          if (!input) throw new Error(`no saved ssh Site named "${args.name}" to rediscover`);
          const { result } = await sites.discover({ name: args.name, ssh: input.ssh, hints: input.hints });
          return toolJson({ result, nextAction });
        }
        if (!args.name || !args.destination) throw new Error('discover requires name and destination');
        const { result } = await sites.discover({
          name: args.name,
          ssh: { destination: args.destination, ...(args.jumps ? { jumps: args.jumps } : {}) },
          ...(args.hints === undefined ? {} : { hints: args.hints as SiteDiscoverBody['hints'] }),
        });
        return toolJson({ result, nextAction });
      },
    })],
  ];
}
