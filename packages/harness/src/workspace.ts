// Preparing a Campaign workspace: site → pack → check → permit → channel → ledger.
//
// A Campaign gets one directory of its own under the Site's workspace root, with the flow the run
// contract names copied into `<workspace>/flow/`. Every generation then runs in that copy. This is
// D19 made real: the flow derives its project root from its own location, so a copy builds into the
// copy and the Site's baseline results are never written, and the workspace root is the one tree the
// Permit allows writes under, so cleanup and quotas stay the Site owner's.
//
// The one thing the copy's location does not settle is the container the flow's wrapper runs in: it
// creates a container by name and binds the project root into it, so a copy run under the Site's own
// container name would write the Site's results after all. Preparation therefore names a container
// per Campaign and records that name, which is also the only way a later cleanup could remove it.
//
// Every write here — the directories, the copy, the `workspace.json` — is decided by the Permit
// first (`decideWrite`), and a refusal means nothing was sent to the Site at all. The flow being
// copied *from* is decided as a read (`decideRead`), because that is what it is.
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { channelFor, mustRun, type Channel } from './channel.js';
import { decideRead, decideWrite } from './shell.js';
import { loadSite, pathsOf } from './sites.js';
import {
  boundInputs,
  checkPack,
  flowDirName,
  loadInstalledPack,
  loadPackFrom,
  substitute,
  workspaceFileName,
  type Pack,
  type PackCheck,
} from './packs.js';
import { packDigestExcludes, packSha256, type PackFolderSnapshot } from './pack-folder.js';
import { runFor } from './runs.js';
import type { Ledger, RefusalRecord, RunRecord, WorkspaceRecord } from './ledger.js';

/**
 * What a Campaign may be called. It becomes a directory name, part of a container name, and part of
 * what a person types, so it is constrained rather than trusted: lower-case letters, digits, dashes
 * and underscores, starting with a letter or digit. No dot and no colon, which tmux will not hold in
 * a session name and podman will not hold at the head of one; no slash, which would put a workspace
 * somewhere other than under the workspace root.
 */
const campaignIdPattern = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** What is wrong with this campaign id, or undefined when nothing is. */
export function campaignIdIssue(id: string): string | undefined {
  return campaignIdPattern.test(id)
    ? undefined
    : `invalid campaign id "${id}": 1 to 64 characters of lower-case letters, digits, "-" and "_", starting with a letter or digit`;
}

/** The container the pack's tools bind this Campaign's flow copy into. Never the Site's own name. */
export const containerNameFor = (campaignId: string): string => `hima-${campaignId}`;

/**
 * A Campaign id for a pack started now: the pack it runs, when, and four hex digits drawn at random.
 *
 * The time alone is a second's resolution, and `/hima run` mints one of these per Run with no way to
 * name a Campaign of its own. Two Runs of one pack started inside the same second would then share a
 * Campaign id — and therefore a workspace directory and a container name — and each generation would
 * synthesize into the other's results. That is not a rare race now that the Site's job cap makes a
 * second Run wait for the first: the natural way to reach the cap is to start two Runs at once.
 *
 * So the id carries a suffix. Four hex digits are not a uniqueness proof, but the workspace they
 * name is: a workspace already prepared for another Campaign is refused rather than run in, so a
 * collision costs a clear refusal, never a generation written over another's.
 */
export function campaignIdFor(pack: Pack, now: Date): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  return `${pack.id}-${stamp}-${randomBytes(2).toString('hex')}`;
}

/**
 * `workspace.json`, the file a prepared workspace carries. It says what the workspace is for, what
 * was copied into it, and — the part nothing else on the Site records — the container name the
 * pack's tools use, without which a later cleanup could not know what to remove.
 *
 * Parsed strictly on the way back in: a workspace whose file is not this shape is a workspace in a
 * state nobody can reason about, and preparing over the top of it would be a guess.
 */
export const workspaceFile = z.strictObject({
  format: z.literal(1),
  campaign: z.string(),
  pack: z.strictObject({ id: z.string(), version: z.string(), digest: packSha256.optional() }),
  site: z.string(),
  design: z.string().optional(),
  flowRoot: z.string(),
  workspace: z.string(),
  containerName: z.string(),
  preparedAt: z.string(),
  copied: z.array(z.string()),
});
export type WorkspaceFile = z.infer<typeof workspaceFile>;

export interface WorkspaceDeps { readonly ledger: Ledger; readonly sitesDir: string; readonly packsDir: string }

export interface PrepareRequest {
  readonly site: string;
  readonly pack: string;
  /** The Campaign to prepare for. Absent, one is named after the pack and the time. */
  readonly campaign?: string;
  /** An existing Run to record against; absent, preparation opens the Campaign's own Run. */
  readonly run?: string;
  /**
   * The reading of the pack's folder the caller is already acting on (#64).
   *
   * `startRun` passes the very reading its check accepted and its row recorded, so the workspace is
   * copied from the bytes that Run says it ran: unthreaded, a folder replaced between the start and
   * this call would put a copy list nobody recorded into a workspace a Run claims otherwise about.
   * A caller that is only preparing — the acceptance script, a person at `/hima pack prepare` — is
   * its own operation and takes its own reading.
   */
  readonly folder?: PackFolderSnapshot;
  /**
   * Campaign-file input overrides (#41 task 3), merged over the Site's own bindings in memory before
   * this preparation reads or copies anything: `{...site, bindings: {...site.bindings, ...inputs}}`.
   * The Permit is untouched — every overridden path still resolves through this same Site's own
   * `permitFile`/`permitRules`, so it still passes `decideRead`/`decideWrite` exactly as a bound path
   * from the site file would. Absent, this call reads and copies exactly as it always has.
   */
  readonly inputs?: Readonly<Record<string, string>>;
}

export type PrepareResult =
  /** The workspace was created and the flow copied into it. */
  | { readonly kind: 'prepared'; readonly run: RunRecord; readonly record: WorkspaceRecord; readonly file: WorkspaceFile }
  /** It was already there, prepared earlier; nothing was copied and nothing was overwritten. */
  | { readonly kind: 'reused'; readonly run: RunRecord; readonly record: WorkspaceRecord; readonly file: WorkspaceFile }
  /** The Permit refused a path, before anything was sent. Recorded by the shell. */
  | { readonly kind: 'refused'; readonly run: RunRecord; readonly record: RefusalRecord }
  /**
   * Something is already at the workspace path and it is not this preparation's to use: a directory
   * carrying no `workspace.json`, one whose `workspace.json` cannot be read as one, a workspace
   * prepared for another Campaign, pack, design, Site or flow root, or one prepared from a copy list
   * that is no longer the pack's. Nothing was copied, and nothing
   * was removed — this harness removes nothing on a Site — so a person decides what becomes of it.
   * An outcome rather than an exception, because it is a fact about the Site that the caller must be
   * told, not a fault in the harness. The Run it names holds no record: nothing happened to record.
   */
  | { readonly kind: 'occupied'; readonly run: RunRecord; readonly workspace: string; readonly reason: string }
  /**
   * This Site cannot host this pack: an input it binds nothing for, a wrapper its Permit will not
   * run, a rule or reader that does not exist. No Run is opened and no record is written — nothing
   * happened on any Site, and there is no Campaign yet for a record to belong to. The caller is
   * handed the whole check and reports it.
   */
  | { readonly kind: 'unfit'; readonly check: PackCheck };

/** A path the Permit refused, carried out of the steps below so the one caller records it once. */
class Refusal extends Error {
  constructor(readonly refused: string, readonly why: string) { super(why); }
}

/** What was found where a prepared workspace keeps its `workspace.json`. */
type FoundWorkspaceFile =
  /** Nothing to read: this Campaign was not prepared here. */
  | { readonly kind: 'none' }
  | { readonly kind: 'file'; readonly file: WorkspaceFile }
  /**
   * Something is there and it is not a `workspace.json`: a preparation killed during the `tee`, or a
   * file somebody else put there. A fact about the Site, told the way the half-prepared directory is
   * told, and not an exception — the caller asked what is in that workspace and this is the answer.
   */
  | { readonly kind: 'unreadable'; readonly why: string };

/**
 * The `workspace.json` a workspace already carries, and what to make of it.
 *
 * Asked with `cat`, which is a read-only probe, so finding out whether a Campaign is already
 * prepared costs the Site one read and creates nothing. Any non-zero exit reads as "not prepared":
 * `cat` gives the same status for a file that is not there and one that cannot be read, and the
 * preparation that follows would fail loudly on the second case rather than quietly succeed.
 */
async function existingWorkspaceFile(on: Channel, at: string): Promise<FoundWorkspaceFile> {
  const r = await on.exec(['cat', '--', at]);
  if (r.code !== 0) return { kind: 'none' };
  const text = Buffer.from(r.stdout).toString('utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { kind: 'unreadable', why: `it is not JSON: ${(err as Error).message}` };
  }
  const shaped = workspaceFile.safeParse(parsed);
  if (shaped.success) return { kind: 'file', file: shaped.data };
  const wrong = shaped.error.issues.map((i) => `${i.path.join('.') || '<the file itself>'}: ${i.message}`).join('; ');
  return { kind: 'unreadable', why: `it is JSON of the wrong shape: ${wrong}` };
}

/**
 * Is the workspace already there this preparation's own, or does it belong to something else?
 *
 * A workspace is one Campaign's copy of one pack's flow, bound by one Site. Everything it was
 * prepared for is written in its `workspace.json`, and every one of those is compared here, because
 * a workspace reused for anything else would have a generation run one pack's tools in a flow copied
 * for another — the Site owner rebinding `design:` after a Campaign was prepared, or a second pack
 * prepared under the same campaign id. What differs is named, since which workspace this is is
 * exactly what the person has to be told.
 *
 * The copy list is one of those things, and the one with a history: commit 5bb2903 added the flow's
 * `tools/` to this pack's list because the Design Zoo's prepare target runs a script out of it. A
 * workspace prepared before that commit carries a flow copy without `tools/`, and reusing it would
 * run exactly the failure that commit fixed — silently, behind "already prepared; nothing was
 * copied". So what a workspace carries is held against what the pack now copies, as a set: a piece
 * copied in a different order is the same copy, a piece absent from either side is not.
 *
 * @returns why that workspace is not this one's, or undefined when it is.
 */
function belongsElsewhere(file: WorkspaceFile, asked: PreparationIdentity): string | undefined {
  const differs: string[] = [];
  if (file.campaign !== asked.campaign) differs.push(`campaign ${asked.campaign}`);
  if (file.pack.id !== asked.packId) differs.push(`pack ${asked.packId}`);
  if (file.site !== asked.site) differs.push(`site ${asked.site}`);
  if (file.design !== asked.design) differs.push(`design ${asked.design ?? '(not declared)'}`);
  if (file.flowRoot !== asked.flowRoot) differs.push(`flow root ${asked.flowRoot}`);
  if (differs.length > 0) {
    return (
      `that workspace belongs to campaign ${file.campaign} of pack ${file.pack.id}@${file.pack.version}, design ${file.design ?? '(not declared)'}, `
      + `flow root ${file.flowRoot}, on site ${file.site}; this preparation asked for ${differs.join(', ')}. `
      + 'A flow copied for one pack, design and Site is not the flow another\'s tools run in. Nothing here removes a path '
      + 'on a Site — prepare under a campaign id of its own, or move or remove that workspace yourself'
    );
  }
  const missing = asked.copied.filter((rel) => !file.copied.includes(rel));
  const stale = file.copied.filter((rel) => !asked.copied.includes(rel));
  if (missing.length === 0 && stale.length === 0) {
    return file.pack.digest === asked.packDigest ? undefined
      : `that workspace records ${file.pack.digest ?? 'no method digest'}, and this preparation asks for method ${asked.packDigest}; the original method cannot be reused as a different method. Nothing was copied`;
  }
  return (
    `that workspace was prepared from a different copy list: it carries ${file.copied.join(', ')}, and pack `
    + `${file.pack.id}@${asked.packVersion} copies ${asked.copied.join(', ')}`
    + (missing.length > 0 ? `; its flow copy is missing ${missing.join(', ')}` : '')
    + (stale.length > 0 ? `; it carries ${stale.join(', ')}, which the pack no longer copies` : '')
    + '. A generation would run in a flow copy that is not the one this pack declares. Nothing here removes a path '
    + 'on a Site — prepare under a campaign id of its own, or move or remove that workspace yourself'
  );
}

/** What a preparation is for: the six things a prepared workspace records about itself. */
interface PreparationIdentity {
  readonly campaign: string;
  readonly packId: string;
  readonly packVersion: string;
  readonly packDigest: string;
  readonly site: string;
  readonly design?: string;
  readonly flowRoot: string;
  /** The contract's copy list with this Site's bindings substituted: what a copy made now would be. */
  readonly copied: readonly string[];
}

/**
 * Prepare (or find) the Campaign workspace for a pack on a Site.
 *
 * @param deps - the ledger and where sites and packs are installed.
 * @param req - the pack, the site, and the Campaign to prepare for.
 * @returns what was prepared, what was already there, what the Permit refused, or why the Site
 *          cannot host the pack at all.
 */
export async function prepareWorkspace(deps: WorkspaceDeps, req: PrepareRequest): Promise<PrepareResult> {
  const loadedSite = loadSite(deps.sitesDir, req.site);
  const site = req.inputs === undefined ? loadedSite : { ...loadedSite, bindings: { ...loadedSite.bindings, ...req.inputs } };
  // One reading of the pack's folder, which the pack is parsed out of and the check is made from
  // (#64): a preparation that loaded the pack from one reading and checked it against another could
  // copy a workspace for a folder neither of them describes. The caller's, where the caller is
  // already acting on one.
  const { folder, pack } = req.folder === undefined
    ? loadInstalledPack(deps.packsDir, req.pack)
    : { folder: req.folder, pack: loadPackFrom(req.folder) };
  // A pack the Site cannot host is answered before a Run exists: nothing was attempted anywhere. Out
  // of the reading the pack carries (#64), which is the caller's own where the caller had one, so
  // this second check re-reads nothing at all.
  const check = checkPack(pack, site);
  if (!check.fit) return { kind: 'unfit', check };
  const bindings = boundInputs(pack, site);
  const named = req.run === undefined ? undefined : await runFor(deps.ledger, site, req.run);
  const campaignId = req.campaign ?? named?.campaignId ?? campaignIdFor(pack, new Date());
  const issue = campaignIdIssue(campaignId);
  if (issue) throw new Error(issue);
  const run = named ?? (await deps.ledger.createRun({ campaignId, siteId: site.name }));

  const p = pathsOf(site);
  // One channel for the whole operation: every permit decision resolves its path on the Site, and the
  // same warm connection then carries the commands those decisions allowed.
  const channel = channelFor(site);
  const refuse = async (refused: string, reason: string): Promise<PrepareResult> => ({
    kind: 'refused',
    run,
    record: await deps.ledger.appendRefusal(run.id, { path: refused, reason }),
  });

  /** One directory, decided and then created. Returns where it actually is on the Site. */
  const mkdirAt = async (target: string): Promise<string> => {
    const decision = await decideWrite(site, target, channel);
    if (!decision.ok) throw new Refusal(decision.refused, decision.reason);
    await mustRun(channel, ['mkdir', '-p', '--', decision.absPath], `create ${decision.absPath} on site ${site.name}`);
    return decision.absPath;
  };

  const containerName = containerNameFor(campaignId);
  const preparedAt = new Date().toISOString();
  try {
    const workspaceRoot = bindings.workspaceRoot!;
    const asked = p.join(workspaceRoot, campaignId);
    const rootDecision = await decideWrite(site, asked, channel);
    if (!rootDecision.ok) throw new Refusal(rootDecision.refused, rootDecision.reason);
    const workspace = rootDecision.absPath;

    // Preparing twice for one Campaign is a no-op that says so: the flow copy is 56 MB on the
    // reference site, and a second preparation that copied it again over a workspace with results in
    // it would destroy a generation nobody asked it to. Twice for *this* Campaign, though: a
    // workspace prepared for another pack, design or Site is not this preparation's to reuse, and a
    // file that cannot be read as a `workspace.json` says nothing about whose it is at all. Both are
    // the same answer as the half-prepared directory below — a fact about the Site, no record
    // written, and a person to decide what becomes of it.
    // Substituted once, before anything is asked of the Site: this is both what a copy made now
    // would carry and what a workspace prepared earlier is held against, so the two cannot drift.
    const askedCopy = pack.contract.workspace.copy.map((entry) => substitute(entry, bindings, `workspace copy entry "${entry}"`));
    const methodDigest = folder.digest(packDigestExcludes);
    const flowSource = pack.contract.workspace.source === 'pack' ? `pack:${pack.id}@${methodDigest}` : bindings.flowRoot!;
    const identity: PreparationIdentity = {
      campaign: campaignId,
      packId: pack.id,
      packVersion: pack.contract.version,
      packDigest: methodDigest,
      site: site.name,
      ...(bindings.design === undefined ? {} : { design: bindings.design }),
      flowRoot: flowSource,
      copied: askedCopy,
    };
    const already = await existingWorkspaceFile(channel, p.join(workspace, workspaceFileName));
    if (already.kind === 'unreadable') {
      return {
        kind: 'occupied',
        run,
        workspace,
        reason: `its ${workspaceFileName} cannot be read as one (${already.why}): it was left half-prepared. Nothing here removes a path on a Site — move or remove it yourself, then prepare again`,
      };
    }
    if (already.kind === 'file') {
      const elsewhere = belongsElsewhere(already.file, identity);
      if (elsewhere) return { kind: 'occupied', run, workspace, reason: elsewhere };
      return {
        kind: 'reused',
        run,
        file: already.file,
        record: await deps.ledger.appendWorkspace(run.id, { event: 'reused', ...recordOf(already.file) }),
      };
    }

    // The workspace was not prepared, and something is nevertheless there: a preparation that did not
    // finish, or a directory somebody else made. Copying into it would nest each piece of the flow
    // inside a directory of its own name, and nothing in this harness removes a path on a Site, so a
    // person decides what becomes of it.
    if (rootDecision.exists) {
      return {
        kind: 'occupied',
        run,
        workspace,
        reason: `it is already there but carries no ${workspaceFileName}: it was left half-prepared. Nothing here removes a path on a Site — move or remove it yourself, then prepare again`,
      };
    }
    // Already decided, two lines above, and nothing has changed since: create it.
    await mustRun(channel, ['mkdir', '-p', '--', workspace], `create ${workspace} on site ${site.name}`);
    const flowDir = await mkdirAt(p.join(workspace, flowDirName));
    const copied: string[] = [];
    for (const rel of askedCopy) {
      if (pack.contract.workspace.source === 'pack') {
        const sourcePrefix = `${flowDirName}/${rel}`;
        const files = [...folder.files].filter(([name]) => name === sourcePrefix || name.startsWith(`${sourcePrefix}/`));
        if (files.length === 0) throw new Refusal(sourcePrefix, `installed Pack ${pack.id} does not hold the declared flow entry ${sourcePrefix}`);
        for (const [name, bytes] of files) {
          const relative = name.slice(`${flowDirName}/`.length);
          const target = p.join(flowDir, relative);
          const parent = p.dirname(target);
          if (parent !== flowDir) await mkdirAt(parent);
          const destination = await decideWrite(site, target, channel);
          if (!destination.ok) throw new Refusal(destination.refused, destination.reason);
          await mustRun(channel, ['tee', '--', destination.absPath], `deploy ${name} into ${flowDir}`, { stdin: bytes });
          const landed = await channel.readFile(destination.absPath);
          if (createHash('sha256').update(landed).digest('hex') !== createHash('sha256').update(bytes).digest('hex')) {
            throw new Error(`deployed Pack flow file failed read-back identity: ${destination.absPath}`);
          }
        }
        copied.push(rel);
        continue;
      }
      // The Site's own flow is read, never written: the source is a read decision, exactly as a
      // report the harness observes is.
      const source = await decideRead(site, p.join(bindings.flowRoot!, rel), channel);
      if (!source.ok) throw new Refusal(p.join(bindings.flowRoot!, rel), source.reason);
      const parent = p.dirname(p.join(flowDir, rel));
      if (parent !== flowDir) await mkdirAt(parent);
      const destination = await decideWrite(site, p.join(flowDir, rel), channel);
      if (!destination.ok) throw new Refusal(destination.refused, destination.reason);
      // The full destination path, never the parent directory: `cp` into an existing directory would
      // mean one thing for a piece already there and another for one that is not.
      await mustRun(channel, ['cp', '-R', '--', source.absPath, destination.absPath], `copy ${rel} into ${flowDir}`);
      copied.push(rel);
    }

    // The same values `belongsElsewhere` compares a later preparation against, so what is written
    // and what is checked cannot drift apart.
    const file: WorkspaceFile = {
      format: 1,
      campaign: identity.campaign,
      pack: { id: identity.packId, version: identity.packVersion, digest: identity.packDigest },
      site: identity.site,
      ...(identity.design === undefined ? {} : { design: identity.design }),
      flowRoot: identity.flowRoot,
      workspace,
      containerName,
      preparedAt,
      copied,
    };
    const marker = await decideWrite(site, p.join(workspace, workspaceFileName), channel);
    if (!marker.ok) throw new Refusal(marker.refused, marker.reason);
    // `tee` writes what it is given on standard input to the file it names. The content travels the
    // connection, not the command line, so a wire that stays a command carries a payload of any shape.
    await mustRun(channel, ['tee', '--', marker.absPath], `record ${workspaceFileName} in ${workspace}`, {
      stdin: Buffer.from(`${JSON.stringify(file, null, 2)}\n`, 'utf8'),
    });

    return {
      kind: 'prepared',
      run,
      file,
      record: await deps.ledger.appendWorkspace(run.id, { event: 'prepared', ...recordOf(file) }),
    };
  } catch (err) {
    if (err instanceof Refusal) return refuse(err.refused, err.why);
    throw err;
  }
}

/** The ledger record's own fields, taken from the file the workspace carries, so the two agree. */
function recordOf(file: WorkspaceFile): Omit<WorkspaceRecord, 'id' | 'runId' | 'siteId' | 'seq' | 'at' | 'writer' | 'type' | 'event'> {
  return {
    campaignId: file.campaign,
    packId: file.pack.id,
    packVersion: file.pack.version,
    ...(file.pack.digest === undefined ? {} : { packDigest: file.pack.digest }),
    workspace: file.workspace,
    flowRoot: file.flowRoot,
    ...(file.design === undefined ? {} : { design: file.design }),
    containerName: file.containerName,
    copied: file.copied,
    preparedAt: file.preparedAt,
  };
}

export interface WorkspaceRevisionChange {
  readonly nodeId: string;
  readonly scope: 'workshop' | 'workspace';
  readonly logicalPath: string;
  /** Existing path for a workspace file, or the historical codeRecord path for a Workshop. */
  readonly sourcePath: string;
  readonly beforeSha256: string;
  readonly content: string;
}

export interface WorkspaceRevisionAsset {
  readonly nodeId: string; readonly scope: 'workshop' | 'workspace'; readonly logicalPath: string;
  readonly path: string; readonly beforeVersionPath: string; readonly afterVersionPath: string;
  readonly beforeSha256: string; readonly afterSha256: string; readonly bytes: number;
}

const sha256Of = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/** Read-only admission check for revision sources. Applying repeats these checks because a Site can
 * change after admission; this first pass keeps a plainly stale proposal from becoming an admitted
 * interrupted effect when no revision byte has been written. */
export async function verifyWorkspaceRevisionSources(site: ReturnType<typeof loadSite>, workspace: string,
  revisionId: string, changes: readonly WorkspaceRevisionChange[]): Promise<void> {
  const channel = channelFor(site); const p = pathsOf(site);
  const root = p.join(workspace, '.hima', 'revisions', revisionId);
  for (const change of changes) {
    const target = change.scope === 'workspace' ? p.join(workspace, change.logicalPath) : change.sourcePath;
    const decided = await decideRead(site, target, channel);
    if (!decided.ok) throw new Error(`revision source ${target} cannot be read: ${decided.reason}`);
    const currentSha = sha256Of(await channel.readFile(decided.absPath));
    const afterSha = sha256Of(Buffer.from(change.content, 'utf8'));
    if (currentSha === change.beforeSha256) continue;
    if (change.scope !== 'workspace' || currentSha !== afterSha) {
      throw new Error(`revision source ${decided.absPath} is ${currentSha}, not declared ${change.beforeSha256}`);
    }
    const held = p.join(root, 'before', change.logicalPath);
    const old = await decideRead(site, held, channel);
    if (!old.ok || sha256Of(await channel.readFile(old.absPath)) !== change.beforeSha256) {
      throw new Error(`revision target changed but retained before-version ${held} is unavailable`);
    }
  }
}

/** Preserve both byte versions and apply only workspace-scoped changes. Workshop history is never
 * overwritten; node-turns copies its accepted after-version into each new execution directory. */
export async function applyWorkspaceRevision(site: ReturnType<typeof loadSite>, workspace: string, revisionId: string,
  changes: readonly WorkspaceRevisionChange[]): Promise<WorkspaceRevisionAsset[]> {
  const channel = channelFor(site);
  const p = pathsOf(site);
  const root = p.join(workspace, '.hima', 'revisions', revisionId);
  const inspected: { change: WorkspaceRevisionChange; before: Uint8Array; after: Uint8Array; target: string }[] = [];
  for (const change of changes) {
    const after = Buffer.from(change.content, 'utf8');
    const target = change.scope === 'workspace' ? p.join(workspace, change.logicalPath) : change.sourcePath;
    const decided = await decideRead(site, target, channel);
    if (!decided.ok) throw new Error(`revision source ${target} cannot be read: ${decided.reason}`);
    const current = await channel.readFile(decided.absPath);
    const currentSha = sha256Of(current);
    const afterSha = sha256Of(after);
    if (currentSha !== change.beforeSha256 && !(change.scope === 'workspace' && currentSha === afterSha)) {
      throw new Error(`revision source ${decided.absPath} is ${currentSha}, not declared ${change.beforeSha256}`);
    }
    // A retried workspace application may already show the after bytes; its before bytes must have
    // reached the immutable store first or this is an unaccountable partial write.
    let before = current;
    if (currentSha === afterSha && currentSha !== change.beforeSha256) {
      const held = p.join(root, 'before', change.logicalPath);
      const old = await decideRead(site, held, channel);
      if (!old.ok) throw new Error(`revision target changed but retained before-version ${held} is unavailable`);
      before = await channel.readFile(old.absPath);
      if (sha256Of(before) !== change.beforeSha256) throw new Error(`retained before-version ${held} has changed`);
    }
    inspected.push({ change, before, after, target: decided.absPath });
  }
  const writeVersion = async (at: string, bytes: Uint8Array, expected: string): Promise<string> => {
    const existing = await decideRead(site, at, channel);
    if (existing.ok) {
      if (sha256Of(await channel.readFile(existing.absPath)) !== expected) throw new Error(`retained revision version ${at} has different bytes`);
      return existing.absPath;
    }
    const parent = p.dirname(at);
    const dir = await decideWrite(site, parent, channel);
    if (!dir.ok) throw new Error(dir.reason);
    await mustRun(channel, ['mkdir', '-p', '--', dir.absPath], `create revision directory ${dir.absPath}`);
    const output = await decideWrite(site, at, channel);
    if (!output.ok) throw new Error(output.reason);
    await mustRun(channel, ['tee', '--', output.absPath], `preserve revision bytes at ${output.absPath}`, { stdin: Buffer.from(bytes) });
    if (sha256Of(await channel.readFile(output.absPath)) !== expected) throw new Error(`retained revision version ${output.absPath} did not verify`);
    return output.absPath;
  };
  const assets: WorkspaceRevisionAsset[] = [];
  for (const item of inspected) {
    const afterSha256 = sha256Of(item.after);
    const beforeVersionPath = await writeVersion(p.join(root, 'before', item.change.logicalPath), item.before, item.change.beforeSha256);
    const afterVersionPath = await writeVersion(p.join(root, 'after', item.change.logicalPath), item.after, afterSha256);
    if (item.change.scope === 'workspace') {
      const output = await decideWrite(site, item.target, channel);
      if (!output.ok) throw new Error(output.reason);
      if (sha256Of(await channel.readFile(output.absPath)) !== afterSha256) {
        await mustRun(channel, ['tee', '--', output.absPath], `apply revision ${revisionId} to ${output.absPath}`, { stdin: Buffer.from(item.after) });
      }
      if (sha256Of(await channel.readFile(output.absPath)) !== afterSha256) throw new Error(`applied revision target ${output.absPath} did not verify`);
    }
    assets.push({ nodeId: item.change.nodeId, scope: item.change.scope, logicalPath: item.change.logicalPath,
      path: item.target, beforeVersionPath, afterVersionPath, beforeSha256: item.change.beforeSha256,
      afterSha256, bytes: item.after.byteLength });
  }
  return assets;
}

/** Copy accepted Workshop algorithm bytes into a new execution's private directory. */
export async function materializeWorkshopRevision(site: ReturnType<typeof loadSite>, assets: readonly WorkspaceRevisionAsset[],
  targetRoot: string): Promise<void> {
  const channel = channelFor(site); const p = pathsOf(site);
  for (const asset of assets.filter((item) => item.scope === 'workshop')) {
    const source = await decideRead(site, asset.afterVersionPath, channel);
    if (!source.ok) throw new Error(`retained Workshop revision is unavailable: ${source.reason}`);
    const bytes = await channel.readFile(source.absPath);
    if (sha256Of(bytes) !== asset.afterSha256) throw new Error(`retained Workshop revision ${source.absPath} has changed`);
    const target = p.join(targetRoot, asset.logicalPath); const parent = p.dirname(target);
    const dir = await decideWrite(site, parent, channel); if (!dir.ok) throw new Error(dir.reason);
    await mustRun(channel, ['mkdir', '-p', '--', dir.absPath], `create revised Workshop directory ${dir.absPath}`);
    const output = await decideWrite(site, target, channel); if (!output.ok) throw new Error(output.reason);
    await mustRun(channel, ['tee', '--', output.absPath], `materialize revised Workshop file ${output.absPath}`, { stdin: Buffer.from(bytes) });
    if (sha256Of(await channel.readFile(output.absPath)) !== asset.afterSha256) throw new Error(`materialized Workshop file ${output.absPath} did not verify`);
  }
}
