// The task-local filesystem adapter for a Pack-declared resident engineering execution.  This is
// deliberately a private leaf: Fabric remains the owner of execution admission and Jobs remain the
// process/lifecycle authority.  The files here only let the already admitted execution converse
// with the Site's fixed wrapper without keeping an in-memory session handle.
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { channelFor, mustRun, type Channel } from './channel.js';
import { decideRead, decideWrite } from './shell.js';
import { outputPath, packKnowledgeDir, toolArgv, type EngineeringOutsourcing, type Pack, type PackTool } from './packs.js';
import { pathsOf, type Site } from './sites.js';
import { jobKill, jobStatus, jobTail, launchJob, type JobDeps, type LaunchIntent } from './jobs.js';
import { claimSlot, claimSlotAndLaunch, type Claim } from './job-cap.js';
import type { NodeExecution, RunRecord } from './ledger.js';

export const engineeringProtocol = 'hima-resident-engineering/1' as const;

const absolute = z.string().min(1).refine((value) => value.startsWith('/'), 'must be an absolute path');
const environmentName = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/);
export const engineeringCapability = z.strictObject({
  schema: z.literal('hima-resident-engineering-capability/1'),
  protocol: z.literal(engineeringProtocol),
  wrapper: z.strictObject({ argv: z.array(z.string().min(1)).min(2).max(32)
    .refine((argv) => argv[0]!.startsWith('/'), 'wrapper argv[0] must be an absolute path') }),
  native: z.strictObject({
    executable: absolute, version: z.string().min(1), argv: z.array(z.string()).max(32),
    model: z.string().min(1), protocolVersion: z.literal(1),
  }),
  sandbox: z.union([
    z.strictObject({ kind: z.literal('podman'), executable: absolute, image: z.string().min(1),
      readOnlyRoots: z.array(absolute).min(1), privateWorkspace: z.string().min(1), privateHome: z.string().min(1), network: z.literal('host') }),
    z.strictObject({ kind: z.literal('none'), testOnly: z.literal(true), privateWorkspace: z.string().min(1), privateHome: z.string().min(1) }),
  ]),
  environment: z.strictObject({
    inherit: z.array(environmentName).max(128), set: z.record(environmentName, z.string()),
    toolPaths: z.array(absolute).max(128), credentialReadPaths: z.array(absolute).max(128),
  }),
  permissions: z.strictObject({ autoApprove: z.array(z.string().min(1)).max(128), denyUnknown: z.literal(true) }),
  delivery: z.strictObject({ candidate: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/)
    .refine((value) => !value.split('/').includes('..') && !value.startsWith('/')) }),
  stopGraceSeconds: z.number().positive().max(300),
});
export type EngineeringCapability = z.infer<typeof engineeringCapability>;

export type EngineeringOperation = 'start' | 'message' | 'status' | 'cancel' | 'delivery' | 'release';
export const engineeringRequest = z.discriminatedUnion('operation', [
  z.strictObject({ operation: z.literal('start'), goal: z.string().trim().min(1).max(64 * 1024), context: z.string().max(256 * 1024).optional() }),
  z.strictObject({ operation: z.literal('message'), message: z.string().trim().min(1).max(64 * 1024) }),
  z.strictObject({ operation: z.literal('status') }),
  z.strictObject({ operation: z.literal('cancel') }),
  z.strictObject({ operation: z.literal('delivery') }),
  z.strictObject({ operation: z.literal('release') }),
]);
export type EngineeringRequest = z.infer<typeof engineeringRequest>;

const digestHex = z.string().regex(/^[0-9a-f]{64}$/);
const statePhase = z.enum(['starting', 'running', 'waiting', 'delivered', 'cancelling', 'stopped', 'failed', 'released']);
const engineeringStateBody = z.strictObject({
  schema: z.literal(engineeringProtocol), taskId: z.string(), sessionId: z.string().optional(), phase: statePhase,
  activeRequestId: z.string().optional(), detail: z.json().optional(), updatedAt: z.string(),
});
const engineeringState = engineeringStateBody.extend({ sha256: digestHex });
const engineeringReceiptBody = z.strictObject({
  schema: z.literal(engineeringProtocol), taskId: z.string(), requestId: z.string(), requestSha256: digestHex,
  sessionId: z.string().optional(), status: z.enum(['accepted', 'completed', 'rejected', 'unknown']),
  result: z.json().optional(), error: z.string().optional(),
});
const engineeringReceipt = engineeringReceiptBody.extend({ sha256: digestHex });
const relativeArtifactPath = z.string().min(1).refine((value) => !value.startsWith('/')
  && value.split('/').every((part) => part !== '' && part !== '.' && part !== '..'),
'must be a normalized workspace-relative path');
const deliveryArtifact = z.strictObject({ path: relativeArtifactPath, sha256: digestHex, kind: z.string().min(1) });
const engineeringDeliveryBody = z.strictObject({
  schema: z.literal('hima-resident-engineering-delivery/1'), taskId: z.string(), executionId: z.string(),
  runId: z.string(), nodeId: z.string(), sessionId: z.string(),
  outcome: z.enum(['completed', 'best-effort', 'blocked', 'cancelled']),
  summary: z.string().min(1), stopReason: z.string(),
  candidate: z.strictObject({ path: relativeArtifactPath, sha256: digestHex }),
  artifactRoot: relativeArtifactPath,
  artifacts: z.array(deliveryArtifact).min(1).max(1024), createdAt: z.string(),
});
const engineeringDelivery = engineeringDeliveryBody.extend({ sha256: digestHex });
const engineeringOwnedBody = z.strictObject({
  schema: z.literal('hima-resident-engineering-owned/1'), taskId: z.string(), sandbox: z.enum(['podman', 'none']),
  processPid: z.number().int().positive(), processIdentity: z.string().min(1), processGroupId: z.number().int().positive(),
  containerCidFile: z.string().min(1), quiescent: z.boolean(), updatedAt: z.string(), detail: z.json().optional(),
  containerId: digestHex.optional(),
  descendants: z.array(z.strictObject({ pid: z.number().int().positive(), processIdentity: z.string().min(1) })).max(4096).optional(),
});
const engineeringNeverStartedOwnedBody = z.strictObject({
  schema: z.literal('hima-resident-engineering-owned/1'), taskId: z.string(), sandbox: z.enum(['podman', 'none']),
  quiescent: z.literal(true), updatedAt: z.string(),
  detail: z.strictObject({ reason: z.literal('never-started') }),
});
const engineeringOwned = z.union([
  engineeringOwnedBody.extend({ sha256: digestHex }),
  engineeringNeverStartedOwnedBody.extend({ sha256: digestHex }),
]);

export type EngineeringState = z.infer<typeof engineeringState>;
export type EngineeringReceiptFrame = z.infer<typeof engineeringReceipt>;
export type EngineeringDelivery = z.infer<typeof engineeringDelivery>;
export type EngineeringOwned = z.infer<typeof engineeringOwned>;

/** Canonical JSON shared with the production wrapper. Object keys are Unicode-code-point sorted. */
export function canonicalEngineeringJson(value: unknown): string {
  return canonicalJson(value, false);
}

function canonicalWrapperJson(value: unknown): string {
  return canonicalJson(value, true);
}

function canonicalJson(value: unknown, allowIntegerNumbers: boolean): string {
  const normalize = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(normalize);
    if (item !== null && typeof item === 'object') {
      const entries = Object.entries(item as Record<string, unknown>);
      if (entries.some(([key]) => !/^[\x20-\x7e]+$/.test(key))) throw new Error('engineering protocol JSON object keys must be printable ASCII');
      return Object.fromEntries(entries
        .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
        .map(([key, child]) => [key, normalize(child)]));
    }
    if (typeof item === 'number' && (!allowIntegerNumbers || !Number.isSafeInteger(item))) {
      throw new Error(allowIntegerNumbers ? 'wrapper engineering protocol numbers must be safe integers' : 'signed Host engineering protocol JSON does not carry numbers');
    }
    if (item === undefined) throw new Error('engineering protocol JSON contains undefined');
    return item;
  };
  return JSON.stringify(normalize(value));
}

const sha256 = (bytes: string | Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
function framed<T extends Record<string, unknown>>(body: T): T & { readonly sha256: string } {
  return { ...body, sha256: sha256(canonicalEngineeringJson(body)) };
}

export interface EngineeringTaskPlan {
  readonly taskId: string;
  readonly taskDir: string;
  readonly capability: EngineeringCapability;
  readonly capabilityPath: string;
  readonly capabilitySha256: string;
  readonly envelope: Record<string, unknown> & { readonly sha256: string };
  readonly knowledge: readonly { readonly path: string; readonly bytes: Uint8Array; readonly sha256: string }[];
  readonly methodFiles: readonly { readonly path: string; readonly bytes: Uint8Array; readonly sha256: string }[];
  readonly outputPath: string;
}

export interface EngineeringTaskIdentity {
  readonly run: RunRecord;
  readonly execution: NodeExecution;
  readonly site: Site;
  readonly pack: Pack;
  readonly workspace: string;
  readonly bindings: Readonly<Record<string, string>>;
  readonly outsourcing: EngineeringOutsourcing;
  readonly licences: Readonly<Record<string, number>>;
  readonly tool: PackTool;
  readonly boundInputs: Readonly<Record<string, string>>;
  readonly siteIdentityMatches: boolean;
  readonly expectedCapabilitySha256?: string;
  readonly expectedTaskEnvelopeSha256?: string;
}

export const engineeringTaskId = (runId: string, executionId: string): string =>
  `resident-${sha256(canonicalEngineeringJson({ runId, executionId })).slice(0, 24)}`;

export const engineeringTaskDirectory = (site: Site, workspace: string, taskId: string): string =>
  pathsOf(site).join(workspace, '.hima-engineering', taskId);

async function decidedBytes(site: Site, channel: Channel, at: string, what: string): Promise<{ path: string; bytes: Uint8Array }> {
  const decision = await decideRead(site, at, channel);
  if (!decision.ok) throw new Error(`${what} is not readable: ${decision.reason}`);
  return { path: decision.absPath, bytes: await channel.readFile(decision.absPath) };
}

export async function loadEngineeringCapability(site: Site): Promise<{ readonly capability: EngineeringCapability; readonly path: string; readonly sha256: string }> {
  const configured = site.bindings.engineeringCapabilities;
  if (configured === undefined) throw new Error(`site ${site.name} has no engineeringCapabilities binding`);
  const capabilityFile = await decidedBytes(site, channelFor(site), configured, 'engineering capability');
  const capability = engineeringCapability.parse(JSON.parse(Buffer.from(capabilityFile.bytes).toString('utf8')));
  if (capability.sandbox.kind === 'none' && process.env.HIMA_RESIDENT_TESTING !== '1') {
    throw new Error('an unsandboxed resident engineering capability is test-only');
  }
  const capabilityAt = capability.wrapper.argv.indexOf('--capability');
  if (capabilityAt < 0 || capability.wrapper.argv[capabilityAt + 1] !== capabilityFile.path) {
    throw new Error('engineering capability wrapper argv does not bind its exact capability file');
  }
  if (capability.wrapper.argv.includes('--task-dir') || capability.wrapper.argv.includes('--reconcile')) {
    throw new Error('engineering capability wrapper argv must leave task-dir and recovery mode binding to the Host');
  }
  return { capability, path: capabilityFile.path, sha256: sha256(capabilityFile.bytes) };
}

/** Resolve every fixed input before an engineering start is admitted; this function writes nothing. */
export async function planEngineeringTask(identity: EngineeringTaskIdentity, request: Extract<EngineeringRequest, { operation: 'start' }>): Promise<EngineeringTaskPlan> {
  const { run, execution, site, pack, workspace, bindings, outsourcing, tool, boundInputs } = identity;
  if (outsourcing.artifactPrefix === undefined) {
    throw new Error(`tool ${tool.id} resident engineering start needs an artifactPrefix; preserved older methods remain readable but cannot start new engineering work`);
  }
  const channel = channelFor(site);
  const loadedCapability = await loadEngineeringCapability(site);
  const { capability } = loadedCapability;
  const taskId = engineeringTaskId(run.id, execution.id);
  const p = pathsOf(site);
  const taskDir = engineeringTaskDirectory(site, workspace, taskId);
  const inputs = [] as { name: string; path: string; sha256: string }[];
  for (const name of outsourcing.reads) {
    const output = pack.contract.outputs.find((item) => item.name === name)!;
    const found = await decidedBytes(site, channel, p.join(workspace, outputPath(output, bindings)), `engineering input ${name}`);
    inputs.push({ name, path: found.path, sha256: sha256(found.bytes) });
  }
  const knowledge = outsourcing.knowledge.map((file) => {
    const bytes = readFileSync(path.join(packKnowledgeDir(pack), file));
    return { path: p.join(taskDir, 'knowledge', file), bytes, sha256: sha256(bytes) };
  });
  const toolBytes = readFileSync(path.join(pack.dir, tool.file));
  const methodFiles = [{ path: p.join(taskDir, 'method', tool.file), bytes: toolBytes, sha256: sha256(toolBytes) }];
  const produced = pack.contract.outputs.find((item) => item.name === outsourcing.produces)!;
  const producedPath = p.join(workspace, outputPath(produced, bindings));
  const envelope = framed({
    schema: engineeringProtocol, taskId, runId: run.id, executionId: execution.id, nodeId: execution.nodeId,
    actor: run.control!.owner, ownerEpoch: String(run.control!.epoch), controlRevision: String(run.control!.revision),
    site: site.name, campaignWorkspace: workspace,
    workspace: p.join(taskDir, capability.sandbox.privateWorkspace), goal: request.goal, constraints: {
      campaignGoal: Object.fromEntries(Object.entries(run.goal ?? {}).map(([name, value]) => [name, String(value)])),
      output: { name: outsourcing.produces, path: producedPath }, protocol: engineeringProtocol,
    }, inputs, knowledge: knowledge.map(({ path: at, sha256: digest }) => ({ path: at, sha256: digest })),
    task: {
      toolId: tool.id, description: tool.description, file: { path: methodFiles[0]!.path, sha256: methodFiles[0]!.sha256 },
      declaredInputs: tool.inputs, boundInputs, referenceArgv: toolArgv(tool, boundInputs), flow: p.join(workspace, 'flow'),
      method: { id: pack.id, version: pack.contract.version, digest: run.packDigest },
    },
    delivery: { manifest: p.join(taskDir, 'delivery', 'manifest.json'), candidate: capability.delivery.candidate },
    ...(request.context === undefined ? {} : { context: request.context }), createdAt: new Date().toISOString(),
  });
  return { taskId, taskDir, capability, capabilityPath: loadedCapability.path,
    capabilitySha256: loadedCapability.sha256, envelope, knowledge, methodFiles, outputPath: producedPath };
}

async function ensureDirectory(site: Site, channel: Channel, at: string): Promise<string> {
  const decision = await decideWrite(site, at, channel);
  if (!decision.ok) throw new Error(decision.reason);
  await mustRun(channel, ['mkdir', '-p', '--', decision.absPath], `create engineering task directory ${decision.absPath}`);
  return decision.absPath;
}

async function writeVerified(site: Site, channel: Channel, at: string, bytes: Uint8Array): Promise<string> {
  const decision = await decideWrite(site, at, channel);
  if (!decision.ok) throw new Error(decision.reason);
  if (!await channel.absent(decision.absPath)) {
    const existing = await channel.readFile(decision.absPath);
    if (sha256(existing) !== sha256(bytes)) throw new Error(`engineering protocol path ${decision.absPath} already contains different bytes`);
    return decision.absPath;
  }
  await mustRun(channel, ['tee', '--', decision.absPath], `write engineering protocol file ${decision.absPath}`, { stdin: bytes });
  const landed = await channel.readFile(decision.absPath);
  if (sha256(landed) !== sha256(bytes)) throw new Error(`engineering protocol file ${decision.absPath} failed digest verification`);
  return decision.absPath;
}

function requestBody(taskId: string, requestId: string, operation: EngineeringOperation, payload: unknown): Record<string, unknown> & { readonly sha256: string } {
  return framed({ schema: engineeringProtocol, taskId, requestId, operation, payload });
}

/** Materialize immutable task/envelope/start files and launch the fixed wrapper as an ordinary Job. */
export async function launchEngineeringTask(
  deps: JobDeps,
  identity: EngineeringTaskIdentity,
  plan: EngineeringTaskPlan,
  requestId: string,
  request: Extract<EngineeringRequest, { operation: 'start' }>,
  waitedMs: number,
  beforeLaunch: (intent: LaunchIntent) => Promise<void>,
): Promise<Claim> {
  return claimSlotAndLaunch(deps, {
    site: identity.site, run: identity.run, workspace: identity.workspace,
    node: { id: identity.execution.nodeId, kind: identity.execution.kind }, attempt: identity.execution.attempt,
    argv: [...plan.capability.wrapper.argv, '--task-dir', plan.taskDir], licences: identity.licences, waitedMs,
    nonblocking: true, beforeLaunch: async (intent) => {
      // Persist the ordinary launch intent before the first task-file write. An at-cap answer never
      // reaches this boundary and therefore leaves no filesystem task that a retry could conflict
      // with; a fault after this point is correctly uncertain and remains fenced by that intent.
      await beforeLaunch(intent);
      const channel = channelFor(identity.site);
      await ensureDirectory(identity.site, channel, path.posix.join(plan.taskDir, 'requests'));
      await ensureDirectory(identity.site, channel, path.posix.join(plan.taskDir, 'receipts'));
      await ensureDirectory(identity.site, channel, path.posix.join(plan.taskDir, 'events'));
      await ensureDirectory(identity.site, channel, path.posix.join(plan.taskDir, 'delivery'));
      await ensureDirectory(identity.site, channel, path.posix.join(plan.taskDir, 'knowledge'));
      await ensureDirectory(identity.site, channel, path.posix.join(plan.taskDir, 'method'));
      for (const item of plan.knowledge) await writeVerified(identity.site, channel, item.path, item.bytes);
      for (const item of plan.methodFiles) {
        await ensureDirectory(identity.site, channel, path.posix.dirname(item.path));
        await writeVerified(identity.site, channel, item.path, item.bytes);
      }
      await writeVerified(identity.site, channel, path.posix.join(plan.taskDir, 'task.json'), Buffer.from(`${canonicalEngineeringJson(plan.envelope)}\n`));
      const start = requestBody(plan.taskId, requestId, 'start', { goal: request.goal, ...(request.context === undefined ? {} : { context: request.context }), envelopeSha256: plan.envelope.sha256 });
      await writeVerified(identity.site, channel, path.posix.join(plan.taskDir, 'requests', `${requestId}.json`), Buffer.from(`${canonicalEngineeringJson(start)}\n`));
    }, jobName: `engineering-${identity.execution.nodeId}`,
    ...(identity.execution.branchId === undefined ? {} : { branchId: identity.execution.branchId }),
  });
}

export async function writeEngineeringRequest(identity: EngineeringTaskIdentity, taskId: string, requestId: string, request: Exclude<EngineeringRequest, { operation: 'start' }>, payloadOverride?: Readonly<Record<string, unknown>>): Promise<{ readonly frame: Record<string, unknown> & { readonly sha256: string }; readonly taskDir: string }> {
  const p = pathsOf(identity.site);
  const taskDir = engineeringTaskDirectory(identity.site, identity.workspace, taskId);
  const payload = payloadOverride ?? (request.operation === 'message' ? { text: request.message } : {});
  const frame = requestBody(taskId, requestId, request.operation, payload);
  await writeVerified(identity.site, channelFor(identity.site), p.join(taskDir, 'requests', `${requestId}.json`), Buffer.from(`${canonicalEngineeringJson(frame)}\n`));
  return { frame, taskDir };
}

async function readFramed<T extends z.ZodTypeAny>(site: Site, at: string, schema: T): Promise<z.infer<T> | undefined> {
  const channel = channelFor(site);
  if (await channel.absent(at)) return undefined;
  const decision = await decideRead(site, at, channel);
  if (!decision.ok) throw new Error(decision.reason);
  const parsed = schema.parse(JSON.parse(Buffer.from(await channel.readFile(decision.absPath)).toString('utf8')));
  const { sha256: claimed, ...body } = parsed as Record<string, unknown> & { sha256: string };
  if (sha256(canonicalWrapperJson(body)) !== claimed) throw new Error(`${at} has an invalid engineering protocol digest`);
  return parsed;
}

export async function readEngineeringState(site: Site, taskDir: string, taskId: string): Promise<EngineeringState | undefined> {
  const state = await readFramed(site, pathsOf(site).join(taskDir, 'state.json'), engineeringState);
  if (state !== undefined && state.taskId !== taskId) throw new Error('engineering state belongs to another task');
  return state;
}

export async function readEngineeringReceipt(site: Site, taskDir: string, taskId: string, requestId: string, requestSha256: string): Promise<EngineeringReceiptFrame | undefined> {
  const receipt = await readFramed(site, pathsOf(site).join(taskDir, 'receipts', `${requestId}.json`), engineeringReceipt);
  if (receipt === undefined) return undefined;
  if (receipt.taskId !== taskId || receipt.requestId !== requestId || receipt.requestSha256 !== requestSha256) {
    throw new Error('engineering receipt does not bind the exact task request');
  }
  return receipt;
}

export async function waitEngineeringReceipt(site: Site, taskDir: string, taskId: string, requestId: string, requestSha256: string, timeoutMs: number): Promise<EngineeringReceiptFrame | undefined> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const receipt = await readEngineeringReceipt(site, taskDir, taskId, requestId, requestSha256);
    if (receipt !== undefined) return receipt;
    if (Date.now() >= deadline) return undefined;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

export async function readEngineeringDelivery(site: Site, taskDir: string, taskId: string, executionId: string): Promise<EngineeringDelivery> {
  const manifest = await readFramed(site, pathsOf(site).join(taskDir, 'delivery', 'manifest.json'), engineeringDelivery);
  if (manifest === undefined) throw new Error('the engineering task has no delivery manifest');
  if (manifest.taskId !== taskId || manifest.executionId !== executionId) throw new Error('engineering delivery belongs to another task execution');
  const channel = channelFor(site);
  for (const artifact of manifest.artifacts) {
    const found = await decidedDigest(site, channel, pathsOf(site).join(taskDir, manifest.artifactRoot, artifact.path), `engineering artifact ${artifact.path}`);
    if (found.sha256 !== artifact.sha256) throw new Error(`engineering artifact ${artifact.path} does not match its delivery digest`);
  }
  return manifest;
}

export async function readEngineeringOwned(site: Site, taskDir: string, taskId: string): Promise<EngineeringOwned | undefined> {
  const owned = await readFramed(site, pathsOf(site).join(taskDir, 'native', 'owned.json'), engineeringOwned);
  if (owned !== undefined && owned.taskId !== taskId) throw new Error('engineering ownership facts belong to another task');
  return owned;
}

async function readEngineeringTaskEnvelopeIdentity(site: Site, taskDir: string, taskId: string, executionId: string): Promise<string> {
  const at = pathsOf(site).join(taskDir, 'task.json');
  const found = await decidedBytes(site, channelFor(site), at, 'engineering task envelope');
  const document = JSON.parse(Buffer.from(found.bytes).toString('utf8')) as Record<string, unknown>;
  const claimed = document.sha256;
  if (typeof claimed !== 'string' || !/^[0-9a-f]{64}$/.test(claimed)) throw new Error('engineering task envelope has no valid digest');
  const { sha256: _claimed, ...body } = document;
  if (sha256(canonicalWrapperJson(body)) !== claimed) throw new Error('engineering task envelope digest is invalid');
  if (body.schema !== engineeringProtocol || body.taskId !== taskId || body.executionId !== executionId) {
    throw new Error('engineering task envelope identity differs from the retained execution');
  }
  return claimed;
}

export type EngineeringReconcileResult =
  | { readonly status: 'stopped'; readonly session: string; readonly state: EngineeringState; readonly owned: EngineeringOwned }
  | { readonly status: 'at-cap' | 'unknown'; readonly reason: string; readonly session?: string };

/**
 * Run the fixed same-task cleanup mode as one ordinary Job. It starts no native session and replays
 * no request; the signed owned/state files plus the recovery Job's actual exit are the authority.
 */
export async function reconcileEngineeringTask(
  deps: JobDeps,
  identity: EngineeringTaskIdentity,
  taskId: string,
  beforeLaunch: (intent: LaunchIntent) => Promise<void>,
): Promise<EngineeringReconcileResult> {
  const loaded = await loadEngineeringCapability(identity.site);
  if (!identity.siteIdentityMatches) return { status: 'unknown', reason: 'the Site identity changed since engineering start; recovery was not dispatched' };
  if (identity.expectedCapabilitySha256 === undefined || loaded.sha256 !== identity.expectedCapabilitySha256) {
    return { status: 'unknown', reason: 'the engineering capability identity changed since start; recovery was not dispatched' };
  }
  const taskDir = engineeringTaskDirectory(identity.site, identity.workspace, taskId);
  if (identity.expectedTaskEnvelopeSha256 === undefined
      || await readEngineeringTaskEnvelopeIdentity(identity.site, taskDir, taskId, identity.execution.id) !== identity.expectedTaskEnvelopeSha256) {
    return { status: 'unknown', reason: 'the engineering task/material identity changed since start; recovery was not dispatched' };
  }
  const slots = {
    name: identity.site.name,
    jobs: identity.run.budget?.jobCap ?? identity.site.capacity.parallelJobs,
    licences: identity.run.budget?.licences ?? identity.site.capacity.licences,
  };
  const claimed = await claimSlot(deps, {
    site: slots, holds: {}, launch: () => launchJob(deps, {
      site: identity.site.name, run: identity.run.id, workspace: identity.workspace,
      argv: [...loaded.capability.wrapper.argv, '--task-dir', taskDir, '--reconcile'],
      name: `engineering-reconcile-${identity.execution.nodeId}`, nodeId: identity.execution.nodeId,
      attempt: identity.execution.attempt,
      ...(identity.execution.branchId === undefined ? {} : { branchId: identity.execution.branchId }),
      beforeLaunch,
    }),
  });
  if (claimed.kind === 'unreadable') return { status: 'unknown', reason: claimed.error.message };
  if (claimed.kind === 'at-cap') return { status: 'at-cap', reason: `site ${identity.site.name} has no free recovery Job slot` };
  if (claimed.launched.kind !== 'launched') return { status: 'unknown', reason: claimed.launched.record.reason };
  const session = claimed.launched.record.job.session;
  const deadline = Date.now() + Math.ceil((loaded.capability.stopGraceSeconds + 5) * 1000);
  let actual = await jobStatus(deps, { run: identity.run.id, session });
  while (actual.state.state === 'running' && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    actual = await jobStatus(deps, { run: identity.run.id, session });
  }
  if (actual.state.state === 'running') {
    await jobKill(deps, { run: identity.run.id, session });
    return { status: 'unknown', session, reason: 'the bounded engineering reconciliation Job did not finish; orphan quiescence is unknown' };
  }
  const state = await readEngineeringState(identity.site, taskDir, taskId);
  const owned = await readEngineeringOwned(identity.site, taskDir, taskId);
  // The original wrapper signal handler and the bounded reconciler can race to the same signed final
  // facts. Those facts, not which process returned zero first, are the ownership authority.
  if (state?.phase === 'stopped' && owned?.quiescent === true) return { status: 'stopped', session, state, owned };
  if (actual.state.state !== 'finished' || actual.state.exitCode !== 0) {
    const tail = await jobTail(deps, { run: identity.run.id, session, lines: 20 }).catch(() => undefined);
    return { status: 'unknown', session, reason: `engineering reconciliation Job ${session} did not confirm cleanup${tail?.text.trim() ? `: ${tail.text.trim()}` : ''}` };
  }
  if (state?.phase !== 'stopped' || owned?.quiescent !== true) {
    return { status: 'unknown', session, reason: 'engineering reconciliation exited without signed stopped/quiescent facts' };
  }
  return { status: 'stopped', session, state, owned };
}

async function decidedDigest(site: Site, channel: Channel, at: string, label: string): Promise<{ readonly path: string; readonly sha256: string }> {
  const decision = await decideRead(site, at, channel);
  if (!decision.ok) throw new Error(`${label}: ${decision.reason}`);
  const output = await mustRun(channel, ['sha256sum', '--', decision.absPath], `hash ${label} ${decision.absPath}`);
  const digest = /^([0-9a-f]{64})\s/.exec(output)?.[1];
  if (digest === undefined) throw new Error(`${label}: sha256sum returned an invalid digest`);
  return { path: decision.absPath, sha256: digest };
}

async function plainDirectory(channel: Channel, at: string, label: string): Promise<string> {
  const link = await channel.exec(['test', '-L', at]);
  if (link.code === 0) throw new Error(`${label} must be a plain non-symlink directory: ${at}`);
  const directory = await channel.exec(['test', '-d', at]);
  if (directory.code !== 0) throw new Error(`${label} is not a directory: ${at}`);
  return channel.realpath(at);
}

const beneath = (candidate: string, root: string): boolean => candidate.startsWith(root.endsWith('/') ? root : `${root}/`);

/** Materialize the result and the Pack-confined immutable support tree before its Reader runs. */
export async function materializeEngineeringResult(identity: EngineeringTaskIdentity, taskDir: string, delivery: EngineeringDelivery): Promise<{ readonly path: string; readonly sha256: string }> {
  const results = delivery.artifacts.filter((artifact) => artifact.kind === 'result');
  if (results.length !== 1) throw new Error(`engineering delivery needs exactly one result artifact; found ${results.length}`);
  const channel = channelFor(identity.site);
  const p = pathsOf(identity.site);
  const produced = identity.pack.contract.outputs.find((item) => item.name === identity.outsourcing.produces)!;
  const resultTarget = p.join(identity.workspace, outputPath(produced, identity.bindings));
  const artifactPrefix = identity.outsourcing.artifactPrefix;
  if (artifactPrefix === undefined) throw new Error('resident engineering delivery has no Pack artifactPrefix');
  const prefix = `${artifactPrefix}/`;
  const prefixTarget = p.join(identity.workspace, artifactPrefix);
  const seenPaths = new Set<string>();
  const planned: { readonly artifact: EngineeringDelivery['artifacts'][number]; readonly source: string;
    readonly target: string; readonly absPath: string; readonly write: boolean }[] = [];
  const prefixWasAbsent = await channel.absent(prefixTarget);
  if (!prefixWasAbsent) await plainDirectory(channel, prefixTarget, 'engineering artifactPrefix');

  // Read, hash, authorize and collision-check the complete manifest before creating even a parent
  // directory. Support files are immutable once published: a repair must name a fresh revisioned
  // checkpoint/artifact path, so omitted old members cannot contaminate the selected tree digest.
  for (const artifact of delivery.artifacts) {
    if (seenPaths.has(artifact.path)) throw new Error(`engineering delivery repeats artifact path ${artifact.path}`);
    seenPaths.add(artifact.path);
    if (artifact.kind !== 'result' && !artifact.path.startsWith(prefix)) {
      throw new Error(`engineering support artifact ${artifact.path} is outside Pack prefix ${artifactPrefix}`);
    }
    const source = p.join(taskDir, delivery.artifactRoot, artifact.path);
    const retained = await decidedDigest(identity.site, channel, source, `retained engineering artifact ${artifact.path}`);
    if (retained.sha256 !== artifact.sha256) throw new Error(`retained engineering artifact ${artifact.path} digest changed`);
    const target = artifact.kind === 'result' ? resultTarget : p.join(identity.workspace, artifact.path);
    const decision = await decideWrite(identity.site, target, channel);
    if (!decision.ok) throw new Error(decision.reason);
    if (planned.some((item) => item.absPath === decision.absPath
      || item.absPath.startsWith(`${decision.absPath}/`) || decision.absPath.startsWith(`${item.absPath}/`))) {
      throw new Error(`engineering artifacts collide at Campaign path ${decision.absPath}`);
    }
    let needsWrite = true;
    if (artifact.kind !== 'result' && decision.exists) {
      const existing = await decidedDigest(identity.site, channel, decision.absPath, `existing engineering support artifact ${artifact.path}`);
      if (existing.sha256 !== artifact.sha256) {
        throw new Error(`engineering support path ${decision.absPath} already contains different bytes; use a fresh revisioned artifact path`);
      }
      needsWrite = false;
    }
    planned.push({ artifact, source: retained.path, target, absPath: decision.absPath, write: needsWrite });
  }
  if (prefixWasAbsent) await ensureDirectory(identity.site, channel, prefixTarget);
  const realPrefix = await plainDirectory(channel, prefixTarget, 'engineering artifactPrefix');
  for (const item of planned.filter((candidate) => candidate.artifact.kind !== 'result')) {
    const decision = await decideWrite(identity.site, item.target, channel);
    if (!decision.ok) throw new Error(decision.reason);
    if (!beneath(decision.absPath, realPrefix)) throw new Error(`engineering support path ${decision.absPath} escapes resolved Pack prefix ${realPrefix}`);
  }
  for (const item of planned) await ensureDirectory(identity.site, channel, p.dirname(item.absPath));
  for (const item of planned) {
    if (item.write) await mustRun(channel, item.artifact.kind === 'result'
      ? ['cp', '-f', '--', item.source, item.absPath]
      : ['cp', '-n', '--', item.source, item.absPath], `materialize engineering artifact ${item.absPath}`);
  }
  for (const item of planned) {
    const landed = await decidedDigest(identity.site, channel, item.absPath, `materialized engineering artifact ${item.absPath}`);
    if (landed.sha256 !== item.artifact.sha256) throw new Error(`materialized engineering artifact ${item.absPath} failed digest verification`);
  }
  const materializedResult = planned.find((item) => item.artifact.kind === 'result')!;
  return { path: materializedResult.absPath, sha256: materializedResult.artifact.sha256 };
}
