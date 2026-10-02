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
import type { JobDeps, LaunchIntent } from './jobs.js';
import { claimSlotAndLaunch, type Claim } from './job-cap.js';
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
const relativeArtifactPath = z.string().min(1).refine((value) => !value.startsWith('/') && !value.split('/').includes('..'), 'must be a workspace-relative path without ..');
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

export type EngineeringState = z.infer<typeof engineeringState>;
export type EngineeringReceiptFrame = z.infer<typeof engineeringReceipt>;
export type EngineeringDelivery = z.infer<typeof engineeringDelivery>;

/** Canonical JSON shared with the production wrapper. Object keys are Unicode-code-point sorted. */
export function canonicalEngineeringJson(value: unknown): string {
  const normalize = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(normalize);
    if (item !== null && typeof item === 'object') {
      const entries = Object.entries(item as Record<string, unknown>);
      if (entries.some(([key]) => !/^[\x20-\x7e]+$/.test(key))) throw new Error('engineering protocol JSON object keys must be printable ASCII');
      return Object.fromEntries(entries
        .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
        .map(([key, child]) => [key, normalize(child)]));
    }
    if (typeof item === 'number') throw new Error('signed Host engineering protocol JSON does not carry numbers');
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

/** Resolve every fixed input before an engineering start is admitted; this function writes nothing. */
export async function planEngineeringTask(identity: EngineeringTaskIdentity, request: Extract<EngineeringRequest, { operation: 'start' }>): Promise<EngineeringTaskPlan> {
  const { run, execution, site, pack, workspace, bindings, outsourcing, tool, boundInputs } = identity;
  const channel = channelFor(site);
  const configured = site.bindings.engineeringCapabilities;
  if (configured === undefined) throw new Error(`site ${site.name} has no engineeringCapabilities binding`);
  const capabilityFile = await decidedBytes(site, channel, configured, 'engineering capability');
  const capability = engineeringCapability.parse(JSON.parse(Buffer.from(capabilityFile.bytes).toString('utf8')));
  if (capability.sandbox.kind === 'none' && process.env.HIMA_RESIDENT_TESTING !== '1') {
    throw new Error('an unsandboxed resident engineering capability is test-only');
  }
  const capabilityAt = capability.wrapper.argv.indexOf('--capability');
  if (capabilityAt < 0 || capability.wrapper.argv[capabilityAt + 1] !== capabilityFile.path) {
    throw new Error('engineering capability wrapper argv does not bind its exact capability file');
  }
  if (capability.wrapper.argv.includes('--task-dir')) throw new Error('engineering capability wrapper argv must leave task-dir binding to the Host');
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
  return { taskId, taskDir, capability, capabilityPath: capabilityFile.path,
    capabilitySha256: sha256(capabilityFile.bytes), envelope, knowledge, methodFiles, outputPath: producedPath };
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
  if (sha256(canonicalEngineeringJson(body)) !== claimed) throw new Error(`${at} has an invalid engineering protocol digest`);
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
    const found = await decidedBytes(site, channel, pathsOf(site).join(taskDir, manifest.artifactRoot, artifact.path), `engineering artifact ${artifact.path}`);
    if (sha256(found.bytes) !== artifact.sha256) throw new Error(`engineering artifact ${artifact.path} does not match its delivery digest`);
  }
  return manifest;
}

/** Put the one declared result into the Pack output location and verify the bytes after the copy. */
export async function materializeEngineeringResult(identity: EngineeringTaskIdentity, taskDir: string, delivery: EngineeringDelivery): Promise<{ readonly path: string; readonly sha256: string }> {
  const results = delivery.artifacts.filter((artifact) => artifact.kind === 'result');
  if (results.length !== 1) throw new Error(`engineering delivery needs exactly one result artifact; found ${results.length}`);
  const channel = channelFor(identity.site);
  const p = pathsOf(identity.site);
  const source = p.join(taskDir, delivery.artifactRoot, results[0]!.path);
  const retained = await decidedBytes(identity.site, channel, source, 'retained engineering result');
  if (sha256(retained.bytes) !== results[0]!.sha256) throw new Error('retained engineering result digest changed');
  const produced = identity.pack.contract.outputs.find((item) => item.name === identity.outsourcing.produces)!;
  const target = p.join(identity.workspace, outputPath(produced, identity.bindings));
  await ensureDirectory(identity.site, channel, p.dirname(target));
  const write = await decideWrite(identity.site, target, channel);
  if (!write.ok) throw new Error(write.reason);
  await mustRun(channel, ['tee', '--', write.absPath], `materialize engineering result ${write.absPath}`, { stdin: retained.bytes });
  const bytes = await channel.readFile(write.absPath);
  const digest = sha256(bytes);
  if (digest !== results[0]!.sha256) throw new Error(`materialized engineering result ${write.absPath} failed digest verification`);
  return { path: write.absPath, sha256: digest };
}
