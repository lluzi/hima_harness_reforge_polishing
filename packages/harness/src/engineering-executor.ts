// The task-local filesystem adapter for a Pack-declared resident engineering execution.  This is
// deliberately a private leaf: Fabric remains the owner of execution admission and Jobs remain the
// process/lifecycle authority.  The files here only let the already admitted execution converse
// with the Site's fixed wrapper without keeping an in-memory session handle.
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isUtf8 } from 'node:buffer';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import { channelFor, mustRun, type Channel } from './channel.js';
import { decideRead, decideWrite } from './shell.js';
import { outputPath, packKnowledgeDir, toolArgv, type EngineeringOutsourcing, type Pack, type PackTool } from './packs.js';
import { pathsOf, type Site } from './sites.js';
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

/** The same immutable filesystem preparation is shared with DBOS Job effects. It never starts
 * a native session; the actual Job callback remains the current-admission boundary. */
export async function stageEngineeringTask(identity:EngineeringTaskIdentity,plan:EngineeringTaskPlan,requestId:string,
  request:Extract<EngineeringRequest,{operation:'start'}>):Promise<void> {
  const channel=channelFor(identity.site);
  for(const directory of ['requests','receipts','events','delivery','knowledge','method']) await ensureDirectory(identity.site,channel,path.posix.join(plan.taskDir,directory));
  for(const item of plan.knowledge) await writeVerified(identity.site,channel,item.path,item.bytes);
  for(const item of plan.methodFiles) {
    await ensureDirectory(identity.site,channel,path.posix.dirname(item.path));
    await writeVerified(identity.site,channel,item.path,item.bytes);
  }
  await writeVerified(identity.site,channel,path.posix.join(plan.taskDir,'task.json'),Buffer.from(`${canonicalEngineeringJson(plan.envelope)}\n`));
  const start=requestBody(plan.taskId,requestId,'start',{goal:request.goal,...(request.context===undefined?{}:{context:request.context}),envelopeSha256:plan.envelope.sha256});
  await writeVerified(identity.site,channel,path.posix.join(plan.taskDir,'requests',`${requestId}.json`),Buffer.from(`${canonicalEngineeringJson(start)}\n`));
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


export interface EngineeringDeliveryView {
  readonly executionId: string; readonly requestId: string; readonly taskId: string;
  readonly manifestSha256: string; readonly summary: string;
  readonly artifacts: readonly { readonly id: string; readonly path: string; readonly sha256: string; readonly kind: string }[];
}
export interface EngineeringAssetRef {
  readonly id: string; readonly path: string; readonly kind: 'file' | 'directory';
  readonly sha256?: string; readonly digest?: string; readonly bytes?: number; readonly treeId?: string;
}
export type EngineeringAssetRead =
  | { readonly kind: 'file'; readonly ref: EngineeringAssetRef; readonly bytes: Uint8Array;
      readonly text?: string; readonly truncated: boolean; readonly references: readonly EngineeringAssetRef[] }
  | { readonly kind: 'directory'; readonly ref: EngineeringAssetRef; readonly entries: readonly EngineeringAssetRef[] };
const assetId = (kind: string, at: string, digest: string) => sha256(`${kind}\0${at}\0${digest}`);

/** Ledger-verified delivery provenance, projected without altering the completed Run/archive. */
export function engineeringDeliveriesOf(run: RunRecord): EngineeringDeliveryView[] {
  return Object.values(run.control?.requests ?? {}).flatMap(request => {
    const receipt = request.receipt;
    const data = receipt.data as { operation?: unknown; status?: unknown; taskId?: unknown; manifestSha256?: unknown; summary?: unknown; artifacts?: unknown } | undefined;
    if (request.state !== 'done' || receipt.action !== 'engineering' || !receipt.executionId
      || data?.operation !== 'delivery' || data.status !== 'verified') return [];
    const taskId = engineeringTaskId(run.id, receipt.executionId);
    if (data.taskId !== taskId) throw new Error('retained engineering delivery has a different task identity');
    const manifestSha256 = digestHex.parse(data.manifestSha256);
    const artifacts = z.array(deliveryArtifact).min(1).max(1024).parse(data.artifacts);
    return [{ executionId: receipt.executionId, requestId: receipt.requestId, taskId, manifestSha256,
      summary: typeof data.summary === 'string' ? data.summary : 'Engineering delivery',
      artifacts: artifacts.map(artifact => ({ ...artifact, id: assetId('delivery', artifact.path, artifact.sha256) })) }];
  });
}

// Explicit user reads, not background polling. Large native checkpoint members are downloadable;
// text previews stay small. The current retained 105 MiB layout fits this finite per-file bound.
const engineeringFileLimit = 256 * 1024 * 1024;
const engineeringTreeFileLimit = 2048;
const engineeringTreeByteLimit = 1024 * 1024 * 1024;

async function plainEngineeringDirectories(site: Site, channel: Channel, anchor: string, directory: string): Promise<void> {
  const p = pathsOf(site), relative = p.relative(anchor, directory);
  if (relative === '..' || relative.startsWith('../') || p.isAbsolute(relative)) throw new Error('engineering path is outside its original Campaign');
  await plainDirectory(channel, anchor, 'Campaign root');
  let current = anchor;
  for (const part of relative.split('/').filter(Boolean)) {
    current = p.join(current, part);
    await plainDirectory(channel, current, 'engineering path ancestor');
  }
}

export async function readRetainedAssetBytes(site: Site, at: string, root: string, expected: string, size?: number, anchor = root): Promise<Buffer> {
  const channel = channelFor(site), p = pathsOf(site);
  await plainEngineeringDirectories(site, channel, anchor, p.dirname(at));
  const realRoot = await plainDirectory(channel, root, 'retained engineering root');
  const decision = await decideRead(site, at, channel);
  if (!decision.ok) throw new Error(decision.reason);
  if (!beneath(decision.absPath, realRoot)) throw new Error('engineering asset escapes its retained root');
  await plainDirectory(channel, p.dirname(at), 'engineering asset parent');
  if ((await channel.exec(['test', '-L', at])).code === 0 || (await channel.exec(['test', '-f', decision.absPath])).code !== 0) {
    throw new Error('engineering asset must be a plain file, not a link');
  }
  const measuredSize = Number(/^\s*(\d+)/.exec(await mustRun(channel, ['wc', '-c', '--', decision.absPath], 'measure retained asset'))?.[1]);
  if (!Number.isSafeInteger(measuredSize) || measuredSize < 0 || measuredSize > engineeringFileLimit) throw new Error('engineering asset exceeds its file byte limit or has unreadable size');
  if (size !== undefined && measuredSize !== size) throw new Error('engineering asset size differs from its verified inventory');
  const read = await channel.exec(['tail', '-c', String(engineeringFileLimit + 1), '--', decision.absPath]);
  if (read.code !== 0) throw new Error(`cannot read retained engineering asset: ${read.stderr}`);
  const bytes = Buffer.from(read.stdout);
  if (bytes.length > engineeringFileLimit) throw new Error(`engineering asset exceeds ${engineeringFileLimit} byte read/download limit`);
  if (bytes.length !== measuredSize || sha256(bytes) !== expected || size !== undefined && bytes.length !== size) throw new Error('retained engineering asset bytes changed from their recorded identity');
  return bytes;
}

/** Read only published delivery files or content-addressed references from the verified result.
 * Linked references stay inside the original Run's declared artifact prefix (including its native
 * private workspace). No actor-provided filesystem path or new business request is accepted. */
export async function readRetainedEngineeringAsset(identity: EngineeringTaskIdentity, delivery: EngineeringDeliveryView,
  requestedId: string, treeId?: string, download = false): Promise<EngineeringAssetRead> {
  const { site, run, execution } = identity, p = pathsOf(site), channel = channelFor(site);
  if (delivery.executionId !== execution.id || delivery.taskId !== engineeringTaskId(run.id, execution.id)
    || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,159}$/.test(delivery.requestId)) throw new Error('engineering delivery identity is invalid');
  const taskDir = engineeringTaskDirectory(site, identity.workspace, delivery.taskId);
  const manifestPath = p.join(taskDir, 'delivery', 'manifests', `${delivery.requestId}.json`);
  await plainEngineeringDirectories(site, channel, identity.workspace, p.dirname(manifestPath));
  if ((await channel.exec(['test', '-L', manifestPath])).code === 0) throw new Error('engineering manifest must be a plain file');
  const manifest = await readFramed(site, manifestPath, engineeringDelivery);
  if (!manifest || manifest.sha256 !== delivery.manifestSha256 || manifest.taskId !== delivery.taskId
    || manifest.executionId !== execution.id || manifest.runId !== run.id) throw new Error('retained engineering manifest differs from the verified delivery');
  const artifactRoot = p.join(taskDir, manifest.artifactRoot);
  const resultArtifact = manifest.artifacts.find(artifact => artifact.kind === 'result');
  if (!resultArtifact || manifest.artifacts.filter(artifact => artifact.kind === 'result').length !== 1) throw new Error('verified delivery needs one result');
  const resultBytes = await readRetainedAssetBytes(site, p.join(artifactRoot, resultArtifact.path), artifactRoot, resultArtifact.sha256, undefined, identity.workspace);
  const prefix = identity.outsourcing.artifactPrefix;
  if (!prefix) throw new Error('retained method has no engineering artifact prefix');
  // Use the original content-addressed task envelope, not mutable current native configuration.
  const envelopeAt = p.join(taskDir, 'task.json');
  if ((await channel.exec(['test', '-L', envelopeAt])).code === 0) throw new Error('retained engineering envelope must be a plain file');
  const envelopeBytes = await decidedBytes(site, channel, envelopeAt, 'retained engineering envelope');
  const envelope = JSON.parse(Buffer.from(envelopeBytes.bytes).toString('utf8')) as Record<string, unknown>;
  const { sha256: envelopeHash, ...envelopeBody } = envelope;
  const start = Object.values(run.control!.requests).findLast(request => request.receipt.action === 'engineering'
    && request.receipt.executionId === execution.id && (request.receipt.data as { operation?: unknown } | undefined)?.operation === 'start'
    && !['at-cap', 'refused', 'budget-exhausted', 'stopped'].includes(String((request.receipt.data as { status?: unknown }).status)));
  const expectedEnvelope = (start?.receipt.data as { taskEnvelopeSha256?: unknown } | undefined)?.taskEnvelopeSha256;
  if (envelopeHash !== expectedEnvelope || sha256(canonicalWrapperJson(envelopeBody)) !== expectedEnvelope
    || envelopeBody.taskId !== delivery.taskId || envelopeBody.executionId !== execution.id || typeof envelopeBody.workspace !== 'string'
    || !beneath(envelopeBody.workspace, taskDir)) throw new Error('retained engineering envelope identity changed');
  const roots = [p.join(identity.workspace, prefix), p.join(envelopeBody.workspace, prefix)];
  const rootFor = (at: string) => roots.find(root => beneath(at, root) || at === root);
  const references: EngineeringAssetRef[] = [];
  const visit = (value: unknown, depth = 0): void => {
    if (depth > 32 || references.length >= 2048 || !value || typeof value !== 'object') return;
    if (Array.isArray(value)) { for (const child of value) visit(child, depth + 1); return; }
    const obj = value as Record<string, unknown>;
    const relative = relativeArtifactPath.safeParse(obj.path);
    if (relative.success) {
      const at = p.join(identity.workspace, relative.data);
      const hash = digestHex.safeParse(obj.sha256), digest = digestHex.safeParse(obj.digest);
      if (rootFor(at) && (hash.success || digest.success)) {
        const kind = hash.success ? 'file' as const : 'directory' as const;
        const expected = hash.success ? hash.data : digestHex.parse(obj.digest);
        const id = assetId(kind, relative.data, expected);
        if (!references.some(ref => ref.id === id)) references.push({ id, path: relative.data, kind,
          ...(kind === 'file' ? { sha256: expected } : { digest: expected }) });
      }
    }
    for (const child of Object.values(obj)) visit(child, depth + 1);
  };
  if (resultBytes.length <= 8 * 1024 * 1024) { try { visit(JSON.parse(resultBytes.toString('utf8'))); } catch { /* A generic result need not be JSON. */ } }
  // The original declared task inputs (for example a matched reference result) remain useful
  // provenance after Run end. They were supplied by the Host, not invented by result JSON.
  const inputRoots = new Map<string, string>();
  if (Array.isArray(envelopeBody.inputs)) for (const input of envelopeBody.inputs) {
    const parsed = z.object({ path: z.string(), sha256: digestHex }).safeParse(input);
    if (!parsed.success || !beneath(parsed.data.path, identity.workspace)) continue;
    const relative = p.relative(identity.workspace, parsed.data.path);
    if (!relativeArtifactPath.safeParse(relative).success) continue;
    const id = assetId('input', relative, parsed.data.sha256);
    references.push({ id, path: relative, kind: 'file', sha256: parsed.data.sha256 });
    inputRoots.set(id, identity.workspace);
  }
  const fileAnswer = (ref: EngineeringAssetRef, bytes: Buffer): EngineeringAssetRead => {
    const text = isUtf8(bytes) && !bytes.includes(0) ? bytes.toString('utf8', 0, 1024 * 1024) : undefined;
    return { kind: 'file', ref: { ...ref, bytes: bytes.length }, bytes,
      ...(text === undefined ? {} : { text }), truncated: text !== undefined && bytes.length > 1024 * 1024,
      references: ref.id === assetId('delivery', resultArtifact.path, resultArtifact.sha256) ? references : [] };
  };
  const declared = delivery.artifacts.find(artifact => artifact.id === requestedId);
  if (declared && treeId === undefined) {
    const held = manifest.artifacts.find(artifact => artifact.path === declared.path && artifact.sha256 === declared.sha256);
    if (!held) throw new Error('artifact is absent from the retained verified manifest');
    const bytes = held === resultArtifact ? resultBytes : await readRetainedAssetBytes(site, p.join(artifactRoot, held.path), artifactRoot, held.sha256, undefined, identity.workspace);
    return fileAnswer({ ...declared, kind: 'file' }, bytes);
  }
  const ref = references.find(item => item.id === (treeId ?? requestedId));
  if (!ref) throw new Error('requested artifact is not a retained result reference');
  const at = p.join(identity.workspace, ref.path), root = inputRoots.get(ref.id) ?? rootFor(at)!;
  if (ref.kind === 'file' && treeId === undefined) return fileAnswer(ref, await readRetainedAssetBytes(site, at, root, ref.sha256!, undefined, identity.workspace));
  if (ref.kind !== 'directory') throw new Error('requested member has no checkpoint directory');
  await plainEngineeringDirectories(site, channel, identity.workspace, at);
  const read = await decideRead(site, at, channel);
  if (!read.ok) throw new Error(read.reason);
  const realRoot = await plainDirectory(channel, root, 'engineering reference root');
  const realTree = await plainDirectory(channel, at, 'engineering checkpoint');
  if (realTree !== realRoot && !beneath(realTree, realRoot)) throw new Error('checkpoint escapes engineering root');
  const listed = (await mustRun(channel, ['find', realTree, '-maxdepth', '33', '-mindepth', '1', '-print0'], 'inspect retained checkpoint')).split('\0').filter(Boolean);
  if (listed.length > engineeringTreeFileLimit * 2) throw new Error('checkpoint inventory exceeds its entry limit');
  const entries: { path: string; sha256: string; size: number }[] = [];
  let total = 0;
  for (const full of listed) {
    const relative = p.relative(realTree, full);
    if (!beneath(full, realTree) || relative.split('/').length > 32 || (await channel.exec(['test', '-L', full])).code === 0) throw new Error('checkpoint contains a link, deep path or escaping member');
    if ((await channel.exec(['test', '-d', full])).code === 0) continue;
    if ((await channel.exec(['test', '-f', full])).code !== 0) throw new Error('checkpoint contains a non-regular file');
    const permit = await decideRead(site, full, channel);
    if (!permit.ok || permit.absPath !== full) throw new Error('checkpoint member is outside its permitted plain path');
    const sizeText = await mustRun(channel, ['wc', '-c', '--', full], 'measure checkpoint member');
    const size = Number(/^\s*(\d+)/.exec(sizeText)?.[1]);
    if (!Number.isSafeInteger(size) || size < 0) throw new Error('checkpoint member size is unreadable');
    if (size > engineeringFileLimit || entries.length >= engineeringTreeFileLimit || total + size > engineeringTreeByteLimit) throw new Error('checkpoint exceeds its file/byte limit');
    total += size;
    const hash = await decidedDigest(site, channel, full, 'checkpoint member');
    entries.push({ path: relative, sha256: hash.sha256, size });
  }
  entries.sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
  if (sha256(canonicalWrapperJson(entries)) !== ref.digest) throw new Error('retained checkpoint tree differs from its recorded digest');
  const members = entries.map(entry => ({ id: assetId(ref.id, entry.path, entry.sha256), path: `${ref.path}/${entry.path}`,
    kind: 'file' as const, sha256: entry.sha256, bytes: entry.size, treeId: ref.id }));
  if (treeId === undefined) {
    if (!download) return { kind: 'directory', ref, entries: members };
    // A complete checkpoint is useful as one download, not dozens of disconnected files. Stage
    // verified bytes only in a fresh local directory; never change the original Site or archive.
    const scratch = await mkdtemp(path.join(tmpdir(), 'hima-checkpoint-download-'));
    try {
      const contents = path.join(scratch, 'contents'); await mkdir(contents);
      for (let index = 0; index < entries.length; index++) {
        const entry = entries[index]!, member = members[index]!;
        const bytes = await readRetainedAssetBytes(site, p.join(identity.workspace, member.path), root, entry.sha256, entry.size, identity.workspace);
        const target = path.join(contents, ...entry.path.split('/'));
        await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, bytes, { flag: 'wx', mode: 0o600 });
      }
      const archive = path.join(scratch, 'checkpoint.tar');
      await promisify(execFile)('tar', ['-cf', archive, '-C', contents, '.'], { timeout: 30_000, maxBuffer: 1024 * 1024 });
      if ((await stat(archive)).size > engineeringTreeByteLimit + 32 * 1024 * 1024) throw new Error('checkpoint download archive exceeds its byte limit');
      const bytes = await readFile(archive);
      return { kind: 'file', ref: { id: ref.id, path: `${ref.path}.tar`, kind: 'file', sha256: sha256(bytes), bytes: bytes.length }, bytes, truncated: false, references: [] };
    } finally { await rm(scratch, { recursive: true, force: true }); }
  }
  const member = members.find(item => item.id === requestedId);
  if (!member) throw new Error('requested file is not a verified checkpoint member');
  return fileAnswer(member, await readRetainedAssetBytes(site, p.join(identity.workspace, member.path), root, member.sha256, member.bytes, identity.workspace));
}
