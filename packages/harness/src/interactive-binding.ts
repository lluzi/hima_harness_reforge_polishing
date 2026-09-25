// Production bridge from an exact retained Pack/Site execution to the generic
// interactive runtime. No model-facing request supplies argv, workspace or qualification.
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { z } from 'zod';
import { boundInputs, interactiveToolArgv, runGraphsOf, type Pack, type PackNode, type PackTool } from './packs.js';
import { nodeArguments } from './node-turns.js';
import { loadRunPack } from './release.js';
import { packDigestExcludes } from './pack-folder.js';
import type { NodeExecution, RunRecord } from './ledger.js';
import { loadSite, type Site } from './sites.js';
import { channelFor } from './channel.js';
import type {
  DerivedInteractiveOperation, EncodedInteractiveCommand, InteractiveBinding,
  VerifiedBindingEvidence,
} from './interactive-runtime.js';

export const BUILTIN_TCL_ADAPTER_ID = 'hima-tcl-line-v1';
/** Test authorization is unavailable from any module physically shipped in a signed App. */
export function testFixtureCanRunHere(): boolean {
  const modulePath = fileURLToPath(import.meta.url);
  return process.env.NODE_TEST_CONTEXT !== undefined
    && !/\/[^/]+\.app\/Contents\/Resources\/app\//.test(modulePath);
}
const adapterDescription = [
  BUILTIN_TCL_ADAPTER_ID,
  'typed command name classified by retained Pack declaration',
  'scalar arguments encoded as literal Tcl double-quoted words',
  'single submitted Tcl line builds list then invokes fixed catch expansion',
  'host nonce emits exact ACK then DONE or FAIL lines',
  'typed close emits DONE before a fixed interpreter exit',
  'no eval, source, exec, uplevel or caller Tcl script',
].join('\n');
export const BUILTIN_TCL_ADAPTER_DIGEST = createHash('sha256').update(adapterDescription).digest('hex');

const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const bindingRow = z.strictObject({
  id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9:._-]{0,159}$/),
  site: z.string().min(1), packDigest: sha256, toolId: z.string().min(1),
  adapter: z.literal(BUILTIN_TCL_ADAPTER_ID), adapterHash: sha256, commandsDigest: sha256,
  environment: z.strictObject({ id: z.string().min(1), file: z.string().min(1), sha256 }),
  mutation: z.enum(['qualified', 'unavailable']),
});
export type InteractiveBindingRow = z.infer<typeof bindingRow>;
export const interactiveBindingsDocument = z.strictObject({
  schema: z.literal('hima-interactive-bindings/1'), bindings: z.array(bindingRow).max(256),
});
export type InteractiveBindingsDocument = z.infer<typeof interactiveBindingsDocument>;

const absolutePath = z.string().regex(/^\//);
/** Site-owner evidence whose exact wrapper bytes carry the enforcing runtime policy. */
export const interactiveEnvironmentEvidence = z.strictObject({
  schema: z.literal('hima-interactive-environment/1'),
  site: z.string().min(1),
  toolId: z.string().min(1),
  pack: z.strictObject({ id: z.string().min(1), digest: sha256 }),
  adapter: z.strictObject({ id: z.literal(BUILTIN_TCL_ADAPTER_ID), digest: sha256 }),
  commandsDigest: sha256,
  wrapper: z.strictObject({ path: absolutePath, sha256 }),
  image: z.strictObject({ reference: z.string().min(1), digest: z.string().regex(/^sha256:[0-9a-f]{64}$/) }),
  sourceTemplate: z.strictObject({ path: z.string().regex(/^[A-Za-z0-9_][A-Za-z0-9._-]*(\/[A-Za-z0-9_][A-Za-z0-9._-]*)*$/), sha256 }),
  confinement: z.strictObject({
    rootFilesystem: z.literal('read-only'), dataRoot: absolutePath, dataMount: z.literal('read-only'),
    privateWriteRoot: absolutePath, network: z.literal('host-localhost-licence-only'),
    capabilities: z.literal('dropped-all'), noNewPrivileges: z.literal(true),
  }),
  qualification: z.strictObject({
    status: z.literal('passed'), transcriptSha256: sha256, logicalEcoSha256: sha256, physicalEcoSha256: sha256,
    xtopReady: z.literal(true), identityQuery: z.literal(true), mutation: z.literal(true), save: z.literal(true),
    sourceWriteDenied: z.literal(true), execWriteDenied: z.literal(true), normalExit: z.literal(true),
  }),
});
export type InteractiveEnvironmentEvidence = z.infer<typeof interactiveEnvironmentEvidence>;

export interface InteractiveBindingBridgeConfig {
  readonly packsDir: string;
  readonly sitesDir: string;
  readonly interactiveBindingsFile?: string;
  /** Explicit test-only row; honored only under Node's test runner. */
  readonly trustedTestBinding?: InteractiveBindingRow;
}

export interface ResolveInteractiveBindingRequest {
  /** Exact retained/execution Pack, including accepted growth graphs when applicable. */
  readonly pack: Pack;
  readonly run: RunRecord;
  readonly execution: NodeExecution;
  readonly site: Site;
  readonly workspace: string;
  /** Optional exact node supplied by Fabric; otherwise resolved from the retained Pack graphs. */
  readonly node?: Extract<PackNode, { kind: 'act' }>;
}

export interface InteractiveBindingBridge {
  resolve(request: ResolveInteractiveBindingRequest): Promise<DerivedInteractiveOperation | undefined>;
  verifyAdminBinding(binding: InteractiveBinding): Promise<VerifiedBindingEvidence>;
  encodeCommand(binding: InteractiveBinding, request: {
    readonly commandId: string; readonly protocolToken: string; readonly name: string; readonly args: unknown;
    readonly replyToCommandId?: string;
  }): Promise<EncodedInteractiveCommand>;
}

const maxAdminFileBytes = 2 * 1024 * 1024;
const forbiddenReadCommands = new Set(['eval', 'exec', 'source', 'uplevel']);
const scalar = z.union([z.string().max(64 * 1024), z.number().finite(), z.boolean()]);
const commandArgs = z.strictObject({ arguments: z.array(scalar).max(256).default([]) });

const hash = (bytes: string | Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
export const interactiveCommandsDigest = (tool: PackTool): string => hash(JSON.stringify(tool.interactive?.commands ?? null));

function plainAdminFile(file: string, what: string): { readonly path: string; readonly bytes: Buffer; readonly sha256: string } {
  if (!path.isAbsolute(file)) throw new Error(`${what} path must be absolute`);
  const stat = lstatSync(file, { throwIfNoEntry: false });
  if (!stat || !stat.isFile() || stat.isSymbolicLink()) throw new Error(`${what} must be an existing plain file, not a symlink`);
  if (stat.size > maxAdminFileBytes) throw new Error(`${what} exceeds ${String(maxAdminFileBytes)} bytes`);
  const real = realpathSync(file); const bytes = readFileSync(real);
  return { path: real, bytes, sha256: hash(bytes) };
}

function adminDocument(file: string): { readonly file: ReturnType<typeof plainAdminFile>; readonly document: InteractiveBindingsDocument } {
  const read = plainAdminFile(file, 'interactive bindings file');
  let raw: unknown;
  try { raw = parse(read.bytes.toString('utf8')); }
  catch (error) { throw new Error(`interactive bindings file is not YAML: ${error instanceof Error ? error.message : String(error)}`); }
  return { file: read, document: interactiveBindingsDocument.parse(raw) };
}

function resolvedRoot(root: string): string {
  try { return realpathSync(root); } catch { return path.resolve(root); }
}
const within = (candidate: string, root: string): boolean => candidate === root || candidate.startsWith(root.endsWith(path.sep) ? root : root + path.sep);

function assertOutsideWriteRoots(file: string, site: Site, what: string): void {
  const at = realpathSync(file);
  for (const declared of site.permitRules.allowedWriteRoots) {
    const root = resolvedRoot(declared);
    if (within(at, root)) throw new Error(`${what} ${at} is inside task-writable Permit root ${root}`);
  }
}

function matchingRow(document: InteractiveBindingsDocument, request: { site: string; packDigest: string; toolId: string }): InteractiveBindingRow | undefined {
  const matches = document.bindings.filter((row) => row.site === request.site && row.packDigest === request.packDigest && row.toolId === request.toolId);
  if (matches.length > 1) throw new Error(`interactive admin config has ${String(matches.length)} bindings for site ${request.site}, Pack ${request.packDigest}, tool ${request.toolId}`);
  return matches[0];
}

function classified(tool: PackTool, name: string): 'read' | 'mutate' | 'save' | 'close' | undefined {
  const commands = tool.interactive?.commands;
  if (!commands) return undefined;
  if (commands.read.includes(name)) return 'read';
  if (commands.mutate.includes(name)) return 'mutate';
  if (commands.save.includes(name)) return 'save';
  if (commands.close.includes(name)) return 'close';
  return undefined;
}

function tclLiteralWord(value: string | number | boolean): string {
  const text = typeof value === 'boolean' ? (value ? '1' : '0') : String(value);
  return `"${text.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('$', '\\$')
    .replaceAll('[', '\\[').replaceAll('{', '\\{').replaceAll('}', '\\}')
    .replaceAll('\r', '\\r').replaceAll('\n', '\\n').replaceAll('\t', '\\t')}"`;
}

function encodeTcl(tool: PackTool, request: Parameters<InteractiveBindingBridge['encodeCommand']>[1]): EncodedInteractiveCommand {
  if (request.replyToCommandId !== undefined) throw new Error(`${BUILTIN_TCL_ADAPTER_ID} accepts typed commands, not untyped terminal replies`);
  const effect = classified(tool, request.name);
  if (effect === undefined) throw new Error(`interactive command "${request.name}" is not classified by retained tool ${tool.id}`);
  const primitive = request.name.split('::').filter(Boolean).at(-1) ?? request.name;
  if (effect === 'read' && forbiddenReadCommands.has(primitive)) throw new Error(`read command "${request.name}" could execute arbitrary Tcl and is refused`);
  const args = commandArgs.parse(request.args).arguments.map(tclLiteralWord).join(' ');
  const invocation = `${request.name}${args === '' ? '' : ` ${args}`}`;
  const token = request.protocolToken;
  const success = effect === 'close'
    ? `puts "HIMA:${token}:DONE"; exit`
    : `puts "HIMA:${token}:DONE"`;
  const text = [
    `puts "HIMA:${token}:ACK"`,
    `set __hima_command [list ${invocation}]`,
    'set __hima_code [catch {{*}$__hima_command} __hima_result __hima_options]',
    'if {$__hima_result ne ""} { puts $__hima_result }',
    `if {$__hima_code != 0} { puts stderr "HIMA-ADAPTER-ERROR:$__hima_code:$__hima_result"; puts "HIMA:${token}:FAIL" } else { ${success} }`,
  ].join('; ');
  return { text, submit: true, effect: effect === 'read' ? 'read' : effect === 'close' ? 'close' : 'mutation' };
}

function parseProductionEnvironment(bytes: Uint8Array): InteractiveEnvironmentEvidence | undefined {
  let raw: unknown;
  try { raw = JSON.parse(Buffer.from(bytes).toString('utf8')); } catch { return undefined; }
  if (!raw || typeof raw !== 'object' || (raw as { schema?: unknown }).schema !== 'hima-interactive-environment/1') return undefined;
  return interactiveEnvironmentEvidence.parse(raw);
}

const sitePath = (value: string): string => path.posix.resolve(value);
const withinAnySiteRoot = (candidate: string, roots: readonly string[]): boolean =>
  roots.some((root) => within(sitePath(candidate), sitePath(root)));

function exactNode(request: ResolveInteractiveBindingRequest): Extract<PackNode, { kind: 'act' }> | undefined {
  if (request.node !== undefined) return request.node.id === request.execution.nodeId ? request.node : undefined;
  const found = runGraphsOf(request.pack).flatMap(({ graph }) => graph.nodes).filter((node) => node.id === request.execution.nodeId);
  return found.length === 1 && found[0]?.kind === 'act' ? found[0] : undefined;
}

/** Build one bridge over one optional Host Config file; no registry or mutable cache is created. */
export function createInteractiveBindingBridge(config: InteractiveBindingBridgeConfig): InteractiveBindingBridge {
  const rowFor = (request: { site: string; packDigest: string; toolId: string }): {
    row: InteractiveBindingRow; source: { kind: 'admin-file'; path: string; sha256: string } | { kind: 'trusted-test-fixture'; id: string };
  } | undefined => {
    if (config.interactiveBindingsFile !== undefined) {
      const loaded = adminDocument(config.interactiveBindingsFile);
      const row = matchingRow(loaded.document, request);
      if (row) {
        const testId = testFixtureCanRunHere() ? process.env.HIMA_TEST_INTERACTIVE_BINDING_ID : undefined;
        if (testId === row.id) {
          const site = loadSite(config.sitesDir, row.site);
          assertOutsideWriteRoots(loaded.file.path, site, 'interactive bindings file');
          const environment = plainAdminFile(row.environment.file, 'interactive environment evidence');
          assertOutsideWriteRoots(environment.path, site, 'interactive environment evidence');
          if (environment.sha256 !== row.environment.sha256) throw new Error('interactive environment evidence changed or does not match the pinned digest');
          return { row, source: { kind: 'trusted-test-fixture', id: row.id } };
        }
        return { row, source: { kind: 'admin-file', path: loaded.file.path, sha256: loaded.file.sha256 } };
      }
    }
    const test = config.trustedTestBinding;
    if (testFixtureCanRunHere() && test !== undefined
        && test.site === request.site && test.packDigest === request.packDigest && test.toolId === request.toolId) {
      return { row: test, source: { kind: 'trusted-test-fixture', id: test.id } };
    }
    return undefined;
  };

  return {
    async resolve(request) {
      if (request.run.packId !== request.pack.id || request.run.packDigest === undefined
          || request.pack.folder.digest(packDigestExcludes) !== request.run.packDigest) {
        throw new Error('interactive resolver was not given the exact retained Run Pack');
      }
      const node = exactNode(request);
      if (!node || node.parameters.tool === undefined) return undefined;
      if (request.execution.methodDigest !== request.run.packDigest) return undefined;
      const tool = request.pack.contract.tools.find((candidate) => candidate.id === node.parameters.tool);
      if (!tool?.interactive) return undefined;
      const configured = rowFor({ site: request.site.name, packDigest: request.run.packDigest, toolId: tool.id });
      if (!configured) return undefined;
      const { row, source } = configured;
      if (row.adapterHash !== BUILTIN_TCL_ADAPTER_DIGEST) throw new Error(`interactive binding ${row.id} pins unsupported adapter hash ${row.adapterHash}`);
      if (row.commandsDigest !== interactiveCommandsDigest(tool)) throw new Error(`interactive binding ${row.id} does not pin the retained Pack command classification`);
      if (row.adapter !== tool.interactive.adapter) throw new Error(`interactive binding ${row.id} and retained tool ${tool.id} name different adapters`);
      const bindings = boundInputs(request.pack, request.site);
      const taken = nodeArguments(node, request.run, bindings);
      if (!taken.ok) throw new Error(taken.reason);
      const flowRoot = bindings.flowRoot; const design = bindings.design;
      if (!flowRoot || !design) throw new Error(`site ${request.site.name} does not bind flowRoot/design for interactive tool ${tool.id}`);
      const argv = interactiveToolArgv(tool, { ...taken.values, WORKSPACE: request.workspace,
        FLOW_ROOT: flowRoot, DESIGN: design, CAMPAIGN: request.run.campaignId });
      const binding: InteractiveBinding = {
        id: row.id, packId: request.pack.id, packDigest: request.run.packDigest, nodeId: node.id, toolId: tool.id,
        source, adapter: { id: BUILTIN_TCL_ADAPTER_ID, version: '1', digest: BUILTIN_TCL_ADAPTER_DIGEST,
          completionProtocol: 'versioned-marker', allowsMultiline: false },
        environment: { id: row.environment.id, digest: row.environment.sha256 }, mutation: row.mutation,
        limits: { startupWaitMs: 5_000, callWaitMaxMs: 60_000, commandMaxMs: 10 * 60_000,
          sessionMaxMs: 60 * 60_000, idleMaxMs: 10 * 60_000 },
      };
      return { binding, site: request.site.name, workspace: request.workspace, argv,
        name: `${node.id}-interactive`, licences: tool.licences };
    },

    async verifyAdminBinding(binding) {
      const configuredFile = binding.source.kind === 'admin-file' ? binding.source.path : config.interactiveBindingsFile;
      if (configuredFile === undefined) throw new Error('interactive verification requires the administrator bindings file');
      const loaded = adminDocument(configuredFile);
      if (binding.source.kind === 'admin-file' && loaded.file.sha256 !== binding.source.sha256) throw new Error('interactive bindings file changed after resolution');
      const row = loaded.document.bindings.find((candidate) => candidate.id === binding.id);
      if (!row || row.packDigest !== binding.packDigest || row.toolId !== binding.toolId
          || row.adapterHash !== binding.adapter.digest || row.environment.sha256 !== binding.environment.digest) {
        throw new Error('interactive binding row no longer matches the effective Pack/tool/adapter/environment identity');
      }
      const retained = loadRunPack(config.packsDir, binding.packId, binding.packDigest);
      const tool = retained.contract.tools.find((candidate) => candidate.id === binding.toolId);
      if (!tool?.interactive || row.commandsDigest !== interactiveCommandsDigest(tool)
          || tool.interactive.adapter !== row.adapter) throw new Error('retained Pack interactive command classification changed or does not match the pinned digest');
      // Site is loaded through the ordinary parser by the caller's resolver; these two files are
      // Host-admin evidence and must stay outside every Permit write root.
      const site = loadSite(config.sitesDir, row.site);
      assertOutsideWriteRoots(loaded.file.path, site, 'interactive bindings file');
      const environment = plainAdminFile(row.environment.file, 'interactive environment evidence');
      assertOutsideWriteRoots(environment.path, site, 'interactive environment evidence');
      if (environment.sha256 !== row.environment.sha256) throw new Error('interactive environment evidence changed or does not match the pinned digest');
      const production = parseProductionEnvironment(environment.bytes);
      if (production === undefined) return { bindingFileRealpath: loaded.file.path, bindingFileSha256: loaded.file.sha256,
        environmentDigest: environment.sha256, confinement: 'unqualified' };
      if (production.site !== row.site || production.toolId !== row.toolId) throw new Error('interactive environment evidence names a different Site or tool');
      if (production.pack.id !== binding.packId || production.pack.digest !== binding.packDigest
          || production.adapter.id !== binding.adapter.id || production.adapter.digest !== binding.adapter.digest
          || production.commandsDigest !== row.commandsDigest) {
        throw new Error('interactive environment qualification does not name the exact retained Pack/adapter/commands');
      }
      if (tool.interactive.argv?.[0] !== production.wrapper.path) throw new Error('retained Pack interactive startup does not name the qualified Site wrapper');
      if (!site.permitRules.allowedWrappers.includes(production.wrapper.path)) throw new Error('qualified Site wrapper is not allowed by the retained Site Permit');
      if (!withinAnySiteRoot(production.wrapper.path, site.permitRules.allowedReadRoots)) throw new Error('qualified Site wrapper is outside every Permit read root');
      if (withinAnySiteRoot(production.wrapper.path, site.permitRules.allowedWriteRoots)) throw new Error('qualified Site wrapper is inside a task-writable Permit root');
      const writeRoot = sitePath(production.confinement.privateWriteRoot);
      const declaredWorkspace = sitePath(site.workspaceRoot);
      if (writeRoot !== declaredWorkspace || !withinAnySiteRoot(writeRoot, site.permitRules.allowedWriteRoots)
          || !withinAnySiteRoot(writeRoot, site.permitRules.allowedReadRoots)) {
        throw new Error('qualified private write root does not exactly match the Site workspaceRoot inside both Permit read/write roots');
      }
      if (!within(production.wrapper.path, production.confinement.dataRoot)
          || !within(writeRoot, production.confinement.dataRoot)) throw new Error('qualified wrapper/write root is outside the read-only data mount');
      const source = retained.folder.text(production.sourceTemplate.path);
      if (source === undefined || hash(source) !== production.sourceTemplate.sha256) throw new Error('retained Pack interactive source template changed or does not match production evidence');
      const channel = channelFor(site);
      const wrapperRealpath = await channel.realpath(production.wrapper.path);
      if (sitePath(wrapperRealpath) !== sitePath(production.wrapper.path)) throw new Error('qualified Site wrapper resolves through a symlink or to a different path');
      const wrapperBytes = await channel.readFile(wrapperRealpath);
      if (hash(wrapperBytes) !== production.wrapper.sha256) throw new Error('qualified Site wrapper bytes changed or do not match the pinned digest');
      const writeRealpath = await channel.realpath(writeRoot);
      if (sitePath(writeRealpath) !== writeRoot) throw new Error('qualified private write root resolves to a different path');
      return { bindingFileRealpath: loaded.file.path, bindingFileSha256: loaded.file.sha256,
        environmentDigest: environment.sha256, confinement: 'enforced', writableRoot: writeRoot };
    },

    async encodeCommand(binding, request) {
      if (binding.adapter.id !== BUILTIN_TCL_ADAPTER_ID || binding.adapter.digest !== BUILTIN_TCL_ADAPTER_DIGEST) throw new Error('effective binding does not use the built-in versioned Tcl adapter');
      const retained = loadRunPack(config.packsDir, binding.packId, binding.packDigest);
      const tool = retained.contract.tools.find((candidate) => candidate.id === binding.toolId);
      if (!tool) throw new Error(`retained Pack ${binding.packId} declares no tool ${binding.toolId}`);
      return encodeRetainedInteractiveCommand(tool, binding, request);
    },
  };
}

/** Encoder closure used by Host wiring after resolve retained the exact Pack tool. */
export const encodeRetainedInteractiveCommand = (tool: PackTool, binding: InteractiveBinding,
  request: Parameters<InteractiveBindingBridge['encodeCommand']>[1]): EncodedInteractiveCommand => {
  if (tool.id !== binding.toolId || tool.interactive?.adapter !== binding.adapter.id) throw new Error('retained Pack tool does not match the effective interactive binding');
  return encodeTcl(tool, request);
};
