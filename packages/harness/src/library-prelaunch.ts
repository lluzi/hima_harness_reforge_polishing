import { createHash } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import type { Channel } from './channel.js';
import type { LaunchIntent } from './jobs.js';
import type { Ledger } from './ledger.js';
import { decideLaunch, decideRead, decideWrite } from './shell.js';
import { pathsOf, type Site } from './sites.js';
import { permitsWrapper, refusedWrapper } from './shell.js';

const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const absolute = z.string().regex(/^\//);
const qualificationRole = z.enum(['vendor-fixture', 'saed14', ['tsmc', '28'].join('')]);

const qualificationManifest = z.strictObject({
  schema: z.literal('hima-library-qualification-input/1'),
  runtime: z.strictObject({
    wrapper: z.literal('/usr/local/bin/edarun'),
    wrapperRealpath: absolute,
    wrapperSha256: sha256,
    python: absolute,
    pythonSha256: sha256,
    pythonVersion: z.string().min(1),
    apiRoot: absolute,
    apiBuild: z.string().min(1),
    apiMarker: z.literal('tmlib.py'),
    apiMarkerSha256: sha256,
    nativeModule: z.literal('_tmlib.so'),
    nativeModuleSha256: sha256,
    parserLibrarySha256: sha256,
    adapterSha256: sha256,
  }),
  permit: z.strictObject({ path: absolute, sha256 }),
  license: z.strictObject({
    product: z.literal('QuaLib'),
    release: z.literal('2026'),
    selection: z.literal('new'),
    port: z.literal(59099),
    claim: z.literal('QuaLib-2026-new-59099'),
    excludesClaim: z.literal('XTop'),
  }),
  sources: z.array(z.strictObject({
    role: qualificationRole,
    path: absolute,
    sha256,
  })).length(3),
});

export interface LibraryQualificationPrelaunchRequest {
  readonly packId: string;
  readonly site: Site;
  readonly bindings: Readonly<Record<string, string>>;
  readonly workspace: string;
  readonly intent: LaunchIntent;
  readonly channel: Channel;
}

const inside = (target: string, root: string, p: path.PlatformPath): boolean =>
  target === root || target.startsWith(root.endsWith(p.sep) ? root : `${root}${p.sep}`);

const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

async function permittedRead(site: Site, channel: Channel, requested: string, what: string): Promise<string> {
  const decided = await decideRead(site, requested, channel);
  if (!decided.ok) throw new Error(`Library qualification ${what} is not authorized by the loaded Site Permit: ${decided.reason}`);
  return decided.absPath;
}

/**
 * Attest the Site-owned inputs of the one native Library qualification launch.
 *
 * This runs from Fabric's existing `beforeLaunch` callback, after ordinary Permit/workspace
 * resolution and inside the serialized Site slot claim. Every other Pack and every other Library
 * node returns without I/O, preserving the ordinary launch path.
 */
export async function attestLibraryQualificationPrelaunch(req: LibraryQualificationPrelaunchRequest): Promise<void> {
  if (req.packId !== 'library-intelligence' || req.intent.nodeId !== 'qualify-api') return;
  if (req.intent.attempt === undefined) throw new Error('Library qualification launch attempt identity is absent');

  const manifestPath = req.bindings.qualificationManifest;
  if (manifestPath === undefined) throw new Error('Library qualification Site binding qualificationManifest is absent');
  const admittedManifest = await permittedRead(req.site, req.channel, manifestPath, 'manifest');
  let manifest: z.infer<typeof qualificationManifest>;
  let manifestBytes: Uint8Array;
  try {
    manifestBytes = await req.channel.readFile(admittedManifest);
    manifest = qualificationManifest.parse(JSON.parse(Buffer.from(manifestBytes).toString('utf8')));
  } catch (error) {
    throw new Error(`Library qualification manifest is invalid: ${(error as Error).message}`);
  }

  const loadedPermit = await permittedRead(req.site, req.channel, manifest.permit.path, 'Permit');
  const stagedPermitSha256 = digest(await req.channel.readFile(loadedPermit));
  if (manifest.permit.sha256 !== req.site.permitSha256 || stagedPermitSha256 !== req.site.permitSha256) {
    throw new Error('Library qualification manifest does not match the loaded Site Permit identity');
  }

  const boundPython = req.bindings.qualificationPython;
  if (boundPython === undefined) throw new Error('Library qualification Site binding qualificationPython is absent');
  const admittedBoundPython = await permittedRead(req.site, req.channel, boundPython, 'Site-bound Python');
  const admittedManifestPython = await permittedRead(req.site, req.channel, manifest.runtime.python, 'manifest runtime Python');
  if (admittedBoundPython !== admittedManifestPython) {
    throw new Error('Library qualification Site binding qualificationPython differs from the manifest runtime Python');
  }
  if (digest(await req.channel.readFile(admittedBoundPython)) !== manifest.runtime.pythonSha256) {
    throw new Error('Library qualification Site-bound Python SHA-256 differs');
  }

  const runtimePaths = [
    manifest.runtime.apiRoot,
    path.posix.join(manifest.runtime.apiRoot, manifest.runtime.apiMarker),
    path.posix.join(manifest.runtime.apiRoot, manifest.runtime.nativeModule),
    path.posix.join(manifest.runtime.apiRoot, 'lib/libparser_wrapper.so'),
  ];
  for (const nested of runtimePaths) await permittedRead(req.site, req.channel, nested, 'Python/API path');
  for (const source of manifest.sources) await permittedRead(req.site, req.channel, source.path, `${source.role} source`);

  const wrapperRealpath = await permittedRead(req.site, req.channel, manifest.runtime.wrapper, 'edarun wrapper');
  if (!permitsWrapper(req.site, wrapperRealpath)) {
    throw new Error(`Library qualification resolved edarun target is not an allowed wrapper: ${refusedWrapper(req.site, wrapperRealpath)}`);
  }
  if (wrapperRealpath !== manifest.runtime.wrapperRealpath) {
    throw new Error(`Library qualification edarun realpath differs: expected ${manifest.runtime.wrapperRealpath}, got ${wrapperRealpath}`);
  }
  if (digest(await req.channel.readFile(wrapperRealpath)) !== manifest.runtime.wrapperSha256) {
    throw new Error('Library qualification edarun SHA-256 differs');
  }

  const claims = req.intent.licences ?? {};
  if (Object.keys(claims).join(',') !== 'QuaLib-2026-new-59099'
      || claims['QuaLib-2026-new-59099'] !== 1) {
    throw new Error('Library qualification launch does not hold the exact QuaLib 2026 new/59099 claim');
  }
  if ((req.site.capacity.licences['QuaLib-2026-new-59099'] ?? 0) < 1) {
    throw new Error('Library qualification Site does not reserve the QuaLib 2026 new/59099 claim');
  }
  if (req.site.capacity.parallelJobs !== 1) {
    throw new Error('Library qualification requires a one-Job Site so QuaLib and XTop cannot overlap');
  }

  const launch = await decideLaunch(req.site, req.workspace, [manifest.runtime.wrapper], req.channel);
  if (!launch.ok) throw new Error(`Library qualification private workspace is not authorized by the loaded Site Permit: ${launch.reason}`);
  const offeredWorkspace = await req.channel.realpath(req.intent.job.workspace);
  if (offeredWorkspace !== launch.workspace) throw new Error('Library qualification Job workspace differs from the admitted private workspace');
  const rootBinding = req.bindings.workspaceRoot;
  if (rootBinding === undefined) throw new Error('Library qualification Site binding workspaceRoot is absent');
  const privateRoot = await req.channel.realpath(rootBinding);
  if (!inside(launch.workspace, privateRoot, pathsOf(req.site))) {
    throw new Error('Library qualification Job workspace is outside the Site-bound private write root');
  }

  const attestation = `${JSON.stringify({
    schema: 'hima-library-host-attestation/1',
    siteId: req.site.name,
    manifestPath: admittedManifest,
    manifestSha256: digest(manifestBytes),
    permitPath: loadedPermit,
    permitSha256: req.site.permitSha256,
    workspace: launch.workspace,
    wrapper: manifest.runtime.wrapper,
    wrapperRealpath,
    wrapperSha256: manifest.runtime.wrapperSha256,
    license: manifest.license,
    licenseClaims: { 'QuaLib-2026-new-59099': 1 },
    launch: { runId: req.intent.runId, nodeId: req.intent.nodeId, attempt: req.intent.attempt,
      jobSession: req.intent.job.session },
  })}\n`;
  const attestationPath = pathsOf(req.site).join(launch.workspace, 'hima-library-host-attestation.json');
  const write = await decideWrite(req.site, attestationPath, req.channel);
  if (!write.ok) throw new Error(`Library qualification Host attestation cannot be written in the private workspace: ${write.reason}`);
  if (write.exists) {
    const previousBytes = Buffer.from(await req.channel.readFile(write.absPath)).toString('utf8');
    if (previousBytes !== attestation) {
      let previous: Record<string, unknown>;
      try { previous = JSON.parse(previousBytes) as Record<string, unknown>; }
      catch { throw new Error('Library qualification private workspace contains a different Host attestation'); }
      const prior = previous.launch as { runId?: unknown; nodeId?: unknown; attempt?: unknown; jobSession?: unknown } | undefined;
      const next = { runId: req.intent.runId, nodeId: req.intent.nodeId, attempt: req.intent.attempt,
        jobSession: req.intent.job.session };
      const sameMethod = prior?.runId === next.runId && prior.nodeId === next.nodeId;
      const increasing = typeof prior?.attempt === 'number' && next.attempt > prior.attempt;
      const onlyLaunchDiffers = JSON.stringify({ ...previous, launch: next }) === attestation.trim();
      if (!sameMethod || !increasing || !onlyLaunchDiffers) {
        throw new Error('Library qualification private workspace contains a different Host attestation');
      }
      const output = pathsOf(req.site).join(launch.workspace, 'flow/qualification');
      if (!(await req.channel.absent(output))) {
        throw new Error('Library qualification has retained output from an earlier attempt; safe in-place retry is unavailable, use a new Campaign workspace');
      }
      const replaced = await req.channel.exec(['tee', '--', write.absPath], { stdin: Buffer.from(attestation) });
      if (replaced.code !== 0) throw new Error(`Library qualification Host attestation replacement failed: ${replaced.stderr}`);
    }
  } else {
    const written = await req.channel.exec(['tee', '--', write.absPath], { stdin: Buffer.from(attestation) });
    if (written.code !== 0) throw new Error(`Library qualification Host attestation write failed: ${written.stderr}`);
  }
  if (Buffer.from(await req.channel.readFile(write.absPath)).toString('utf8') !== attestation) {
    throw new Error('Library qualification Host attestation bytes differ after write');
  }
}

/** Refuse a positive Library qualification reading unless its launch is in this Run's durable Job history. */
export function libraryQualificationObservationRefusal(request: {
  readonly packId: string;
  readonly nodeId: string;
  readonly runId: string;
  readonly receiptBytes: Uint8Array;
  readonly values: readonly unknown[];
  readonly ledger: Ledger;
}): string | undefined {
  if (request.packId !== 'library-intelligence' || request.nodeId !== 'read-qualification'
      || !request.values.some((value) => typeof value === 'object' && value !== null
        && (value as { type?: unknown }).type === 'library_qualification_ok'
        && (value as { value?: unknown }).value === 1)) return undefined;
  let receipt: unknown;
  try { receipt = JSON.parse(Buffer.from(request.receiptBytes).toString('utf8')); }
  catch { return 'positive Library qualification receipt is not valid JSON'; }
  const launch = z.strictObject({ runId: z.string().min(1), nodeId: z.literal('qualify-api'),
    attempt: z.number().int().positive(), jobSession: z.string().min(1) })
    .safeParse((receipt as { launch?: unknown }).launch);
  if (!launch.success || launch.data.runId !== request.runId) {
    return 'positive Library qualification receipt has no launch identity for this Run';
  }
  const jobs = request.ledger.records({ runId: request.runId, type: 'job' }).filter((record) => record.type === 'job');
  const started = jobs.find((record) => record.event === 'launched'
    && record.nodeId === launch.data.nodeId && record.attempt === launch.data.attempt
    && record.job.session === launch.data.jobSession
    && record.licences?.['QuaLib-2026-new-59099'] === 1);
  const finished = jobs.find((record) => record.event === 'finished'
    && record.job.session === launch.data.jobSession && record.exitCode === 0
    && (started === undefined || record.seq > started.seq));
  if (started === undefined || finished === undefined) {
    return 'positive Library qualification has no matching launched and successfully finished Host Job record';
  }
  return undefined;
}
