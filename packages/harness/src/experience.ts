// HimaExperience: the Campaign's technical report, written on the Site when a Run ends (#30, D44).
//
// One reason to change: where a Campaign's experience is put and how it is read back. What it *says*
// is `experience-report.ts`, which is pure and reaches nothing; this is the half that touches a Site
// and the ledger.
//
// Two files, under the Campaign workspace beside the results: `<workspace>/hima-experience/<runId>.md`
// for the people who read it and `<runId>.json` for the programs that do. They are written where the
// results are, and left there, because the evidence of a Campaign belongs to the Site owner and
// outlives this harness's session (D19, D16, user story 35) — the ledger keeps only a hash of each,
// which is what lets a later reader hold the file it fetched against what the Campaign actually
// wrote.
//
// Every write goes through the Permit first (`decideWrite`), exactly as preparing a workspace does,
// and is sent with the same two verbs of the channel's workspace plumbing: `mkdir` for the directory
// and `tee` for the file, whose content travels on standard input and never on the wire. Reading a
// report back is `cat`, which is a read-only probe. Nothing here removes anything on a Site.
//
// **Written once, and only after both files are on the Site.** The `experience` record is the claim
// that the report is there, so it is appended last: a host that dies between the two files leaves a
// Run without the record, and the next boot's reconciliation writes the report again from records
// that have not moved. That is also the idempotence — a Run that carries the record is a Run whose
// report is written, and this module leaves the Site alone.
import { createHash } from 'node:crypto';
import { constants, lstatSync } from 'node:fs';
import { link, lstat, mkdir, open, readFile as readLocalFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { channelFor, mustRun, type Channel } from './channel.js';
import { experienceReport, EXPERIENCE_DIR, RUN_ASSET_MANIFEST_SCHEMA, type ExperienceJson, type RunAssetManifest } from './experience-report.js';
import { hasEnded, type ArchiveRecord, type CodeRecord, type ExperienceFile, type ExperienceRecord, type KnowledgeRecord, type Ledger, type ObservationRecord, type RunRecord, type WorkspaceRecord } from './ledger.js';
import { runView, type RunWords } from './remote.js';
import { installedPackFolder, runPackWords } from './packs.js';
import { methodHistoryDirectory, runAssetsDirectory } from './pack-folder.js';
import { verifiedPackRelocation } from './release.js';
import { existingRun } from './runs.js';
import { decideRead, decideWrite } from './shell.js';
import { loadSite, pathsOf, type Site } from './sites.js';

/** What writing or reading an experience needs: the ledger it is recorded on, and where the Sites
 *  are installed. Narrower than `FabricDeps` on purpose — this reaches no pack and no judge — and
 *  structural, so a caller holding the whole of `FabricDeps` satisfies it. */
export interface ExperienceDeps {
  readonly ledger: Ledger;
  readonly sitesDir: string;
  /**
   * Where the packs are installed, for the words the report is written in (#42, #58): a Campaign's
   * report says its Goal and every generation's Strategy in the pack's own words, exactly as the
   * card does, and the pack is the only thing that knows them. A pack that can no longer be read
   * leaves the report saying the names, which is what every other face falls back to.
   */
  readonly packsDir: string;
}

/** What became of writing one Run's report. */
export type WriteExperienceResult =
  /** The two files are on the Site and the record is on the ledger. */
  | { readonly kind: 'written'; readonly record: ExperienceRecord }
  /** This Run already had its report; the Site was not touched and nothing was written. */
  | { readonly kind: 'already'; readonly record: ExperienceRecord }
  /**
   * There is no report to write, and that is an answer rather than a fault: a Run that has not
   * ended, a Run HimaFabric never started, one with no Campaign workspace to write beside, or one
   * whose Permit refused the path (which is recorded as a refusal, as every refused path is).
   */
  | { readonly kind: 'nothing'; readonly why: string };

/** What became of reading one Run's report back off the Site. */
export type ReadExperienceResult =
  | { readonly kind: 'read'; readonly record: ExperienceRecord; readonly markdown: string; readonly json: ExperienceJson }
  /** This Run has no `experience` record: it has not ended, or its report is still to be written. */
  | { readonly kind: 'none'; readonly why?: string }
  /** The file on the Site is not the one the record hashed: somebody has changed it since. */
  | { readonly kind: 'changed'; readonly file: 'markdown' | 'json'; readonly path: string; readonly recorded: string; readonly found: string }
  /** The Site answered, and what it said was that the file the record names cannot be read. */
  | { readonly kind: 'unreadable'; readonly file: 'markdown' | 'json'; readonly path: string; readonly recorded: string; readonly why: string };

/** A recorded code or knowledge version read back at its own recorded content hash. */
export type ReadMaterialResult =
  | { readonly kind: 'read'; readonly record: CodeRecord | KnowledgeRecord; readonly text: string }
  | { readonly kind: 'none'; readonly why: string }
  | { readonly kind: 'changed'; readonly path: string; readonly recorded: string; readonly found: string }
  | { readonly kind: 'unreadable'; readonly path: string; readonly recorded: string; readonly why: string };

/**
 * One write of one Run's report at a time, per Ledger and per Run.
 *
 * A Run can reach its ending from two faces at once — the drive returning from a Job that finished
 * while a person's cancel was composing the ending — and both of them ask for the report afterwards.
 * The idempotence above is a read of the ledger followed by two writes to a Site, so two callers
 * that both read "no record yet" would both write, and the Run would end up with two reports and two
 * records of one Campaign. Chained here, the second caller finds the first one's record and leaves.
 *
 * Keyed exactly as `claimingSlotOn` is keyed on a Site and `advancingRun` on a Run: a WeakMap on the
 * Ledger, so a disposed host's chains go with it.
 */
const writesPerRun = new WeakMap<Ledger, Map<string, Promise<unknown>>>();
const assetsPerRun = new WeakMap<Ledger, Map<string, Promise<unknown>>>();

function writingExperience(ledger: Ledger, runId: string, write: () => Promise<WriteExperienceResult>): Promise<WriteExperienceResult> {
  const chains = writesPerRun.get(ledger) ?? new Map<string, Promise<unknown>>();
  writesPerRun.set(ledger, chains);
  const ahead = chains.get(runId) ?? Promise.resolve();
  const mine = ahead.then(write);
  // Chained on a copy that settles either way, so one write that throws neither takes the next one
  // down with it nor leaves an unhandled rejection behind.
  chains.set(runId, mine.then(() => undefined, () => undefined));
  return mine;
}

/**
 * Write this Run's technical report, if it has ended and has not got one.
 *
 * Called from the three places a Run can be found ended: after `drive` returns, after `cancelRun`
 * ends one, and by `reconcileRuns` for a Run whose ending landed under a host that then went away.
 * All three call it the same way, and this decides whether there is anything to do — a caller that
 * asked the question itself would be a fourth answer to it.
 *
 * A Site that cannot be written raises, exactly as every other Site fault does: the Run's ending is
 * already on the ledger and stands, nothing here writes a record claiming a report that is not
 * there, and the next boot's reconciliation writes it.
 *
 * @param deps - the ledger, and where the Sites are installed.
 * @param runId - the Run whose Campaign this is.
 * @returns the record it wrote, the one that was already there, or why there was nothing to write.
 */
export function writeExperience(deps: ExperienceDeps, runId: string): Promise<WriteExperienceResult> {
  return writingExperience(deps.ledger, runId, () => writeOnce(deps, runId));
}

async function writeOnce(deps: ExperienceDeps, runId: string): Promise<WriteExperienceResult> {
  const run = existingRun(deps.ledger, runId);
  const held = experienceOf(deps.ledger, runId);
  if (held !== undefined) {
    await writeRunAssets(deps, runId);
    return { kind: 'already', record: held };
  }
  if (!hasEnded(run.status)) {
    return { kind: 'nothing', why: `run ${runId} is ${run.status ?? 'not a run HimaFabric started'}, and a campaign's experience is written when its run ends` };
  }
  const prepared = workspaceOf(deps.ledger, runId);
  if (prepared === undefined) {
    // The one ending a Run can reach without a workspace: a Campaign blocked at its entry node
    // because preparation never finished, then cancelled. There is nowhere beside the results to
    // write, because there are no results — and this harness writes nothing outside a workspace.
    await writeRunAssets(deps, runId);
    return { kind: 'nothing', why: `run ${runId} has no campaign workspace: no Site report was written; Pack-local delivery records the local execution facts when its installed Pack is available` };
  }
  const site = loadSite(deps.sitesDir, run.siteId);
  const p = pathsOf(site);
  const channel = channelFor(site);
  const writtenAt = new Date().toISOString();
  let words: RunWords | undefined;
  try { words = runPackWords(deps.packsDir, run); }
  catch { /* Preserve the report's raw-name fallback if its original method is unavailable. */ }
  const report = experienceReport(runView(deps.ledger, run, words), writtenAt);

  const dir = p.join(prepared.workspace, EXPERIENCE_DIR);
  const directory = await decideWrite(site, dir, channel);
  if (!directory.ok) {
    const result = await refused(deps, runId, directory.refused, directory.reason);
    await writeRunAssets(deps, runId);
    return result;
  }
  let record: ExperienceRecord;
  try {
    await mustRun(channel, ['mkdir', '-p', '--', directory.absPath], `create ${directory.absPath} on site ${site.name}`);

    const markdown = await writeFile(site, channel, p.join(directory.absPath, `${runId}.md`), report.markdown);
    if ('refusal' in markdown) {
      const result = await refused(deps, runId, markdown.refusal.refused, markdown.refusal.reason);
      await writeRunAssets(deps, runId);
      return result;
    }
    const json = await writeFile(site, channel, p.join(directory.absPath, `${runId}.json`), `${JSON.stringify(report.json, null, 2)}\n`);
    if ('refusal' in json) {
      const result = await refused(deps, runId, json.refusal.refused, json.refusal.reason);
      await writeRunAssets(deps, runId);
      return result;
    }

    // Last, and only now: the record is the claim that both files are there.
    record = await deps.ledger.appendExperience(runId, { writtenAt, markdown: markdown.file, json: json.file });
  } catch (error) {
    // The Site report remains owed, but local ledger facts can still be delivered to the installed
    // Pack. writeRunAssets records its own failure rather than claiming incomplete bytes complete.
    await writeRunAssets(deps, runId);
    throw error;
  }
  await writeRunAssets(deps, runId);
  return { kind: 'written', record };
}

/** This Run's experience record, which is the one thing that says its report is already written. */
export const experienceOf = (ledger: Ledger, runId: string): ExperienceRecord | undefined =>
  ledger.records({ runId, type: 'experience' }).findLast((r): r is ExperienceRecord => r.type === 'experience');

/** The Campaign workspace this Run was prepared in, and the pack that prepared it. */
const workspaceOf = (ledger: Ledger, runId: string): WorkspaceRecord | undefined =>
  ledger.records({ runId, type: 'workspace' }).findLast((r): r is WorkspaceRecord => r.type === 'workspace');

/** One file, decided by the Permit and then written; `tee` takes its content on standard input, so
 *  the wire stays a command whatever the report holds. */
async function writeFile(
  site: Site,
  channel: Channel,
  target: string,
  content: string,
): Promise<{ readonly file: ExperienceFile } | { readonly refusal: { readonly refused: string; readonly reason: string } }> {
  const decision = await decideWrite(site, target, channel);
  if (!decision.ok) return { refusal: { refused: decision.refused, reason: decision.reason } };
  const bytes = Buffer.from(content, 'utf8');
  await mustRun(channel, ['tee', '--', decision.absPath], `write ${decision.absPath} on site ${site.name}`, { stdin: bytes });
  return { file: { path: decision.absPath, sha256: hashOf(bytes), bytes: bytes.byteLength } };
}

/** The hash the record keeps, over the bytes the Site was given — never over the string that made
 *  them, so what is hashed is what is in the file. */
const hashOf = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/** A path the Permit refused: recorded as a refusal, as every refused path in this harness is, and
 *  answered as nothing written rather than as a fault. The Run's ending is untouched. */
async function refused(deps: ExperienceDeps, runId: string, path: string, reason: string): Promise<WriteExperienceResult> {
  await deps.ledger.appendRefusal(runId, { path, reason });
  return { kind: 'nothing', why: `the permit refused ${path}: ${reason}` };
}

/**
 * Read this Run's report back off the Site, and hold both files against the hashes the ledger keeps.
 *
 * The point of reading it back at all is the holding: a report is evidence, and evidence nobody
 * checked is a file on a machine. So a file that no longer hashes to what the Campaign wrote is
 * reported as changed and never served as the report — the whole answer of the route this backs.
 *
 * @param deps - the ledger, and where the Sites are installed.
 * @param runId - the Run whose report to read.
 * @returns both files, or that there is no record, or which of the two no longer matches it.
 */
export async function readExperience(deps: ExperienceDeps, runId: string): Promise<ReadExperienceResult> {
  return (await readExperienceWithBytes(deps, runId)).result;
}

/** Keep the exact verified file bytes private to the Site/archive adapter. Public readers receive
 * the parsed document and original Markdown; the archive needs the bytes the Experience record
 * actually hashed, including a historical JSON file's formatting and final newline choice. */
async function readExperienceWithBytes(deps: ExperienceDeps, runId: string): Promise<{
  readonly result: ReadExperienceResult;
  readonly markdownBytes?: Uint8Array;
  readonly jsonBytes?: Uint8Array;
}> {
  const run = existingRun(deps.ledger, runId);
  const record = experienceOf(deps.ledger, runId);
  if (record === undefined) return { result: { kind: 'none', why: runView(deps.ledger, run).experienceUnavailable ?? `run ${runId} has not ended and has no saved report` } };
  const site = loadSite(deps.sitesDir, run.siteId);
  const channel = channelFor(site);
  const markdown = await readFile(site, channel, 'markdown', record.markdown);
  if ('problem' in markdown) return { result: markdown.problem };
  const json = await readFile(site, channel, 'json', record.json);
  if ('problem' in json) return { result: json.problem };
  let document: ExperienceJson;
  try {
    const parsed = JSON.parse(Buffer.from(json.bytes).toString('utf8'));
    if (parsed === null || typeof parsed !== 'object' || !['hima-experience/1', 'hima-experience/2', 'hima-experience/3', 'hima-experience/4'].includes(parsed.schema)
      || parsed.runId !== runId || parsed.writtenAt !== record.writtenAt) {
      throw new Error('unsupported report schema or report identity does not match the recorded Run and write time');
    }
    document = parsed as ExperienceJson;
  } catch (error) {
    return { result: { kind: 'unreadable', file: 'json', path: record.json.path, recorded: record.json.sha256, why: `the verified bytes are not a supported report: ${(error as Error).message}` } };
  }
  return {
    result: {
      kind: 'read', record,
      markdown: Buffer.from(markdown.bytes).toString('utf8'),
      json: document,
    },
    markdownBytes: markdown.bytes,
    jsonBytes: json.bytes,
  };
}

/** One file read back with `cat`, a read-only probe, and held against the hash on the record. */
async function readFile(
  site: Site,
  channel: Channel,
  which: 'markdown' | 'json',
  file: ExperienceFile,
): Promise<{ readonly bytes: Uint8Array } | { readonly problem: ReadExperienceResult }> {
  const unreadable = (why: string): { readonly problem: ReadExperienceResult } =>
    ({ problem: { kind: 'unreadable', file: which, path: file.path, recorded: file.sha256, why } });
  const decision = await decideRead(site, file.path, channel);
  if (!decision.ok) return unreadable(decision.reason);
  const answer = await channel.exec(['cat', '--', decision.absPath]);
  if (answer.code !== 0) {
    const said = answer.stderr.trim();
    return unreadable(`cat exited ${answer.code} on site ${site.name}${said === '' ? '' : `: ${said}`}`);
  }
  const found = hashOf(answer.stdout);
  if (found !== file.sha256) {
    return { problem: { kind: 'changed', file: which, path: file.path, recorded: file.sha256, found } };
  }
  if (answer.stdout.byteLength !== file.bytes) return unreadable(`recorded size ${String(file.bytes)} differs from found ${String(answer.stdout.byteLength)}`);
  return { bytes: answer.stdout };
}

/**
 * Read one persisted material record only from the Run it belongs to. Code remains on its Site;
 * Pack knowledge is local to the Host. Neither branch falls back to current content after a hash
 * mismatch, so a changed file never impersonates the historical version.
 */
export async function readMaterial(deps: ExperienceDeps, runId: string, recordId: string): Promise<ReadMaterialResult> {
  const run = existingRun(deps.ledger, runId);
  const record = deps.ledger.records({ runId }).find((item) => item.id === recordId && (item.type === 'code' || item.type === 'knowledge'));
  if (record?.type !== 'code' && record?.type !== 'knowledge') return { kind: 'none', why: `no recorded code or knowledge version ${recordId} belongs to run ${runId}` };
  if (record.type === 'code') {
    if (record.retainedPath !== undefined) {
      const held = await readRetainedMaterial(deps, run, record.retainedPath, record.sha256, record.bytes);
      if (held.kind === 'read') return { kind: 'read', record, text: held.bytes.toString('utf8') };
      return held.kind === 'changed' ? { kind: 'changed', path: record.retainedPath, recorded: record.sha256, found: held.found }
        : { kind: 'unreadable', path: record.retainedPath, recorded: record.sha256, why: held.why };
    }
    const site = loadSite(deps.sitesDir, run.siteId);
    const decision = await decideRead(site, record.path, channelFor(site));
    if (!decision.ok) return archivedOrOriginal(deps, runId, record, { kind: 'unreadable', path: record.path, recorded: record.sha256, why: decision.reason });
    const answer = await channelFor(site).exec(['cat', '--', decision.absPath]);
    if (answer.code !== 0) return archivedOrOriginal(deps, runId, record, { kind: 'unreadable', path: record.path, recorded: record.sha256, why: answer.stderr.trim() || `cat exited ${answer.code} on site ${site.name}` });
    const found = hashOf(answer.stdout);
    if (found === record.sha256 && answer.stdout.byteLength !== record.bytes) return archivedOrOriginal(deps, runId, record, { kind: 'unreadable', path: record.path, recorded: record.sha256, why: `recorded size ${String(record.bytes)} differs from found ${String(answer.stdout.byteLength)}` });
    return found === record.sha256
      ? { kind: 'read', record, text: Buffer.from(answer.stdout).toString('utf8') }
      : archivedOrOriginal(deps, runId, record, { kind: 'changed', path: record.path, recorded: record.sha256, found });
  }
  const expected = run.packId === undefined || run.packDigest === undefined
    ? ''
    : path.resolve(deps.packsDir, run.packId, methodHistoryDirectory, run.packDigest, run.packId, 'knowledge', record.file);
  if (path.resolve(record.path) !== expected) return { kind: 'unreadable', path: record.path, recorded: record.sha256, why: 'the recorded knowledge path is outside this Run\'s Pack knowledge directory' };
  try {
    const stat = lstatSync(record.path, { throwIfNoEntry: false });
    if (stat === undefined) return archivedOrOriginal(deps, runId, record, { kind: 'unreadable', path: record.path, recorded: record.sha256, why: 'the recorded knowledge file is no longer present' });
    if (!stat.isFile()) return archivedOrOriginal(deps, runId, record, { kind: 'unreadable', path: record.path, recorded: record.sha256, why: 'the recorded knowledge path is no longer a plain file' });
    const bytes = await readLocalFile(record.path);
    const found = hashOf(bytes);
    if (found === record.sha256 && bytes.byteLength !== record.bytes) return archivedOrOriginal(deps, runId, record, { kind: 'unreadable', path: record.path, recorded: record.sha256, why: `recorded size ${String(record.bytes)} differs from found ${String(bytes.byteLength)}` });
    return found === record.sha256
      ? { kind: 'read', record, text: bytes.toString('utf8') }
      : archivedOrOriginal(deps, runId, record, { kind: 'changed', path: record.path, recorded: record.sha256, found });
  } catch (err) {
    return archivedOrOriginal(deps, runId, record, { kind: 'unreadable', path: record.path, recorded: record.sha256, why: (err as Error).message });
  }
}

async function archivedOrOriginal(deps: ExperienceDeps, runId: string, record: CodeRecord | KnowledgeRecord, original: Exclude<ReadMaterialResult, { readonly kind: 'read' }>): Promise<ReadMaterialResult> {
  const archive = await readRunAssets(deps, runId);
  if (archive.kind !== 'read') return original;
  const held = archive.manifest.materials.find((material) => material.recordId === record.id && material.type === record.type);
  if (held === undefined) return original;
  const archived = await readArchivedMaterial(deps, runId, held.path);
  return archived.kind === 'read' && archived.material.sha256 === record.sha256 && archived.material.bytes === record.bytes
    ? { kind: 'read', record, text: archived.text } : original;
}

/** Whether this Run is one an ending left without its report — what a reconciliation asks of every
 *  Run it passes over, so the question is stated once and asked the same way everywhere. */
export const owesAnExperience = (ledger: Ledger, run: RunRecord): boolean =>
  hasEnded(run.status) && experienceOf(ledger, run.id) === undefined;

/** A failed archive is retried by the existing reconciliation path; only a complete record settles it. */
export const owesRunAssets = (ledger: Ledger, run: RunRecord): boolean =>
  hasEnded(run.status) && ledger.records({ runId: run.id, type: 'archive' }).findLast((record) => record.type === 'archive')?.delivery !== 'complete';

/** Result of publishing (or checking) the Pack-local, portable copy of an Experience. */
export type WriteRunAssetsResult =
  | { readonly kind: 'written'; readonly manifest: RunAssetManifest; readonly directory: string; readonly manifestPath: string }
  | { readonly kind: 'already'; readonly manifest: RunAssetManifest; readonly directory: string; readonly manifestPath: string }
  | { readonly kind: 'nothing'; readonly why: string }
  | { readonly kind: 'failed'; readonly why: string };

export type ReadRunAssetsResult =
  | { readonly kind: 'read'; readonly manifest: RunAssetManifest; readonly directory: string; readonly manifestPath: string }
  | { readonly kind: 'none'; readonly why: string }
  | { readonly kind: 'changed'; readonly path: string; readonly recorded: string; readonly found: string }
  | { readonly kind: 'unreadable'; readonly path: string; readonly why: string };
export type ReadArchivedMaterialResult =
  | { readonly kind: 'read'; readonly manifest: RunAssetManifest; readonly material: RunAssetManifest['materials'][number]; readonly text: string }
  | Exclude<ReadRunAssetsResult, { readonly kind: 'read' }>;

function writingRunAssets(ledger: Ledger, runId: string, write: () => Promise<WriteRunAssetsResult>): Promise<WriteRunAssetsResult> {
  const chains = assetsPerRun.get(ledger) ?? new Map<string, Promise<unknown>>();
  assetsPerRun.set(ledger, chains);
  const ahead = chains.get(runId) ?? Promise.resolve();
  const mine = ahead.then(write);
  chains.set(runId, mine.then(() => undefined, () => undefined));
  return mine;
}

const archiveManifestSchema = z.strictObject({
  schema: z.literal(RUN_ASSET_MANIFEST_SCHEMA), runId: z.string().min(1), campaignId: z.string().min(1), siteId: z.string().min(1),
  pack: z.strictObject({ id: z.string().min(1), version: z.string().min(1) }), methodDigest: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  createdAt: z.string().min(1), delivery: z.literal('complete'), reason: z.string().min(1).optional(),
  materials: z.array(z.strictObject({ path: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/), source: z.string().min(1), recordId: z.string().min(1).optional(), type: z.enum(['experience', 'observation', 'code', 'knowledge']).optional(), sha256: z.string().regex(/^[0-9a-f]{64}$/), bytes: z.number().int().nonnegative(), required: z.boolean(), missingReason: z.string().min(1).optional() })).min(2),
}).superRefine((value, ctx) => {
  const paths = new Set<string>();
  for (const material of value.materials) {
    if (paths.has(material.path)) ctx.addIssue({ code: 'custom', message: `duplicate material path ${material.path}` });
    paths.add(material.path);
    if (material.required && material.missingReason !== undefined) ctx.addIssue({ code: 'custom', message: `required material ${material.path} cannot be declared missing` });
  }
  for (const required of ['experience.md', 'experience.json']) if (!paths.has(required)) ctx.addIssue({ code: 'custom', message: `required report material ${required} is absent` });
});

const archiveCompleteOf = (ledger: Ledger, runId: string): ArchiveRecord | undefined =>
  ledger.records({ runId, type: 'archive' }).findLast((record): record is ArchiveRecord => record.type === 'archive' && record.delivery === 'complete');

/**
 * Copy the two already-verified Experience bytes into the installed Pack's customer-asset area.
 * This deliberately does not reach into a Site: Site reads remain governed by `readExperience` and
 * no remote path becomes a substitute for a delivered required file.  A local report composed for
 * an early no-workspace ending remains deliverable when its Pack is installed.
 */
export function writeRunAssets(deps: ExperienceDeps, runId: string): Promise<WriteRunAssetsResult> {
  return writingRunAssets(deps.ledger, runId, () => writeRunAssetsOnce(deps, runId));
}

async function writeRunAssetsOnce(deps: ExperienceDeps, runId: string): Promise<WriteRunAssetsResult> {
  const run = existingRun(deps.ledger, runId);
  if (!hasEnded(run.status)) return { kind: 'nothing', why: `run ${runId} has not ended` };
  if (run.packId === undefined) return archiveFailure(deps, runId, deps.packsDir, `run ${runId} has no HimaPack to receive customer assets`);
  let folder: ReturnType<typeof installedPackFolder>;
  try { folder = installedPackFolder(deps.packsDir, run.packId); }
  catch (error) { return archiveFailure(deps, runId, deps.packsDir, (error as Error).message); }
  if (folder === undefined) return archiveFailure(deps, runId, deps.packsDir, `installed Pack ${run.packId} is unavailable; no archive directory was created`);
  const directory = path.join(folder.dir, runAssetsDirectory, runId);
  try { await archivePathSafe(folder.dir, runId, false); }
  catch (error) { return archiveFailure(deps, runId, directory, (error as Error).message); }
  const recordedPackVersion = runView(deps.ledger, run).run.packVersion ?? 'not recorded';
  const existing = await readRunAssetsAt(directory, runId, run, undefined, recordedPackVersion);
  if (existing.kind === 'read') {
    try { await completeArchive(deps, runId, directory, existing.manifest, existing.manifestPath); }
    catch (error) { return archiveFailure(deps, runId, directory, `published archive completion could not be recorded: ${(error as Error).message}`); }
    return { kind: 'already', manifest: existing.manifest, directory, manifestPath: existing.manifestPath };
  }
  if (existing.kind === 'changed' || existing.kind === 'unreadable') return { kind: 'failed', why: `refusing to overwrite existing delivery: ${existing.kind === 'changed' ? existing.path : existing.path}` };

  let words: RunWords | undefined;
  try { words = runPackWords(deps.packsDir, run); } catch { /* Archive the raw-name fallback. */ }
  const savedFiles = experienceOf(deps.ledger, runId) === undefined ? undefined : await readExperienceWithBytes(deps, runId);
  const saved = savedFiles?.result;
  if (saved !== undefined && saved.kind !== 'read') {
    const why = saved.kind === 'changed' ? `${saved.path} changed from ${saved.recorded} to ${saved.found}`
      : saved.kind === 'unreadable' ? `${saved.path}: ${saved.why}` : saved.why ?? 'saved Experience is unavailable';
    return archiveFailure(deps, runId, directory, `required saved Experience cannot be archived: ${why}`);
  }
  // A Pack-local fallback can be recomposed after a crash. Its timestamp therefore comes from the
  // immutable Run row, rather than from whichever retry happened to render it; otherwise an earlier
  // pending reservation would reject the retry as different content.
  const report = saved?.kind === 'read' ? undefined : experienceReport(runView(deps.ledger, run, words), run.createdAt);
  const reportFiles = [
    { path: 'experience.md', source: saved?.kind === 'read' ? `site:${saved.record.markdown.path}` : 'generated:experience-markdown', bytes: saved?.kind === 'read' ? Buffer.from(savedFiles!.markdownBytes!) : Buffer.from(report!.markdown, 'utf8') },
    { path: 'experience.json', source: saved?.kind === 'read' ? `site:${saved.record.json.path}` : 'generated:experience-json', bytes: saved?.kind === 'read' ? Buffer.from(savedFiles!.jsonBytes!) : Buffer.from(`${JSON.stringify(report!.json, null, 2)}\n`, 'utf8') },
  ] as const;
  const materialFiles: { path: string; source: string; bytes: Buffer; recordId: string; type: 'observation' | 'code' | 'knowledge' }[] = [];
  for (const record of deps.ledger.records({ runId })) {
    if (record.type === 'observation') {
      const observed = await readObservedAsset(deps, run, record);
      if (typeof observed === 'string') return archiveFailure(deps, runId, directory, `required observation ${record.id} cannot be archived: ${observed}`);
      materialFiles.push({ path: `materials/observation-${String(record.seq)}.dat`, source: `observation:${record.path}`, recordId: record.id, type: 'observation', bytes: observed });
      continue;
    }
    if (record.type !== 'code' && record.type !== 'knowledge') continue;
    const held = await readMaterial(deps, runId, record.id);
    if (held.kind !== 'read') {
      const why = held.kind === 'none' ? held.why : held.kind === 'changed'
        ? `${held.path} changed from ${held.recorded} to ${held.found}` : `${held.path}: ${held.why}`;
      return archiveFailure(deps, runId, directory, `required ${record.type} material ${record.id} cannot be archived: ${why}`);
    }
    materialFiles.push({ path: `materials/${record.type}-${String(record.seq)}.txt`, source: `${record.type}:${record.path}`, recordId: record.id, type: record.type, bytes: Buffer.from(held.text, 'utf8') });
  }
  const files = [...reportFiles, ...materialFiles];
  const manifest: RunAssetManifest = {
    schema: RUN_ASSET_MANIFEST_SCHEMA, runId, campaignId: run.campaignId, siteId: run.siteId,
    pack: { id: run.packId, version: runView(deps.ledger, run, words).run.packVersion ?? 'not recorded' },
    ...(run.packDigest === undefined ? {} : { methodDigest: run.packDigest }),
    createdAt: saved?.kind === 'read' ? saved.json.writtenAt : run.createdAt, delivery: 'complete',
    materials: files.map((file) => ({ path: file.path, source: file.source, ...('recordId' in file ? { recordId: file.recordId, type: file.type } : { type: 'experience' as const }), sha256: hashOf(file.bytes), bytes: file.bytes.byteLength, required: true })),
  };
  const parent = path.dirname(directory);
  const stage = path.join(parent, `.${runId}.stage-${randomSuffix()}`);
  try {
    await reserveArchive(deps, runId, directory, manifest);
    await mkdir(parent, { recursive: true });
    await mkdir(stage, { recursive: false, mode: 0o700 });
    for (const file of files) {
      await writeArchiveFile(stage, file.path, file.bytes);
    }
    for (const material of manifest.materials) {
      const bytes = await readArchiveFile(stage, material.path);
      if (hashOf(bytes) !== material.sha256 || bytes.byteLength !== material.bytes) throw new Error(`staged material ${material.path} did not verify`);
    }
    await writeArchiveFile(stage, 'manifest.json', Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`));
    // Rename publishes one complete directory. A competing publisher is never overwritten.
    await rename(stage, directory);
    await completeArchive(deps, runId, directory, manifest, path.join(directory, 'manifest.json'));
    return { kind: 'written', manifest, directory, manifestPath: path.join(directory, 'manifest.json') };
  } catch (error) {
    await rm(stage, { recursive: true, force: true });
    const after = await readRunAssetsAt(directory, runId, run, undefined, recordedPackVersion);
    if (after.kind === 'read') {
      try { await completeArchive(deps, runId, directory, after.manifest, after.manifestPath); return { kind: 'already', manifest: after.manifest, directory, manifestPath: after.manifestPath }; }
      catch (completionError) { return archiveFailure(deps, runId, directory, `published archive completion could not be recorded: ${(completionError as Error).message}`); }
    }
    return archiveFailure(deps, runId, directory, (error as Error).message);
  }
}

/** Read a published archive only after each required material still matches its manifest. */
export async function readRunAssets(deps: ExperienceDeps, runId: string): Promise<ReadRunAssetsResult> {
  const run = existingRun(deps.ledger, runId);
  if (run.packId === undefined) return { kind: 'none', why: `run ${runId} has no HimaPack archive` };
  let folder: ReturnType<typeof installedPackFolder>;
  try { folder = installedPackFolder(deps.packsDir, run.packId); }
  catch (error) { return { kind: 'unreadable', path: deps.packsDir, why: (error as Error).message }; }
  if (folder === undefined) return { kind: 'none', why: `installed Pack ${run.packId} is unavailable` };
  const completion = archiveCompleteOf(deps.ledger, runId);
  if (completion === undefined) return { kind: 'none', why: `run ${runId} has no Ledger-confirmed completed archive` };
  const directory = path.join(folder.dir, runAssetsDirectory, runId);
  let relocated = false;
  if (completion.directory !== directory) {
    try {
      if (completion.manifestSha256 === undefined
          || verifiedPackRelocation({ packDir: folder.dir, originalPath: path.join(completion.directory, 'manifest.json'), sha256: completion.manifestSha256 }) !== path.join(directory, 'manifest.json')) {
        return { kind: 'unreadable', path: path.join(directory, 'manifest.json'), why: 'the Ledger-recorded completion names a different archive directory without an exact reviewed migration' };
      }
      for (const material of completion.materials) {
        if (material.missingReason !== undefined) continue;
        const current = path.join(directory, material.path);
        if (verifiedPackRelocation({ packDir: folder.dir, originalPath: path.join(completion.directory, material.path), sha256: material.sha256, bytes: material.bytes }) !== current) {
          return { kind: 'unreadable', path: current, why: `the migration receipt does not verify Ledger material ${material.path}` };
        }
      }
    } catch (error) {
      return { kind: 'unreadable', path: path.join(directory, 'manifest.json'), why: (error as Error).message };
    }
    relocated = true;
  }
  try { await archivePathSafe(folder.dir, runId, true); }
  catch (error) { return { kind: 'unreadable', path: directory, why: (error as Error).message }; }
  return readRunAssetsAt(directory, runId, run, completion, runView(deps.ledger, run).run.packVersion ?? 'not recorded', relocated);
}

/** Read a named archived byte without contacting its original Site. */
export async function readArchivedMaterial(deps: ExperienceDeps, runId: string, materialPath: string): Promise<ReadArchivedMaterialResult> {
  const archive = await readRunAssets(deps, runId);
  if (archive.kind !== 'read') return archive;
  const material = archive.manifest.materials.find((item) => item.path === materialPath);
  if (material === undefined) return { kind: 'none', why: `run ${runId} archive has no material ${materialPath}` };
  const at = path.resolve(archive.directory, material.path);
  try {
    const bytes = await readArchiveFile(archive.directory, material.path);
    const found = hashOf(bytes);
    if (found !== material.sha256) return { kind: 'changed', path: at, recorded: material.sha256, found };
    return { kind: 'read', manifest: archive.manifest, material, text: bytes.toString('utf8') };
  } catch (error) { return { kind: 'unreadable', path: at, why: (error as Error).message }; }
}

async function readRunAssetsAt(directory: string, runId: string, run?: RunRecord, completion?: ArchiveRecord, packVersion?: string, relocated = false): Promise<ReadRunAssetsResult> {
  const manifestPath = path.join(directory, 'manifest.json');
  let manifest: RunAssetManifest;
  try {
    const bytes = await readArchiveFile(directory, 'manifest.json');
    manifest = archiveManifestSchema.parse(JSON.parse(bytes.toString('utf8'))) as RunAssetManifest;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === 'ENOENT' ? { kind: 'none', why: `no published manifest at ${manifestPath}` } : { kind: 'unreadable', path: manifestPath, why: (error as Error).message };
  }
  if (manifest.runId !== runId || manifest.delivery !== 'complete') {
    return { kind: 'unreadable', path: manifestPath, why: 'manifest is not a complete hima-run-assets/1 delivery for this Run' };
  }
  if (run !== undefined && (manifest.campaignId !== run.campaignId || manifest.siteId !== run.siteId || manifest.pack.id !== run.packId || manifest.pack.version !== packVersion || manifest.methodDigest !== run.packDigest)) return { kind: 'unreadable', path: manifestPath, why: 'manifest identity does not match the ended Run and recorded method' };
  if (completion !== undefined) {
    if (completion.directory !== directory && !relocated) return { kind: 'unreadable', path: manifestPath, why: 'the Ledger-recorded completion names a different archive directory' };
    const raw = await readArchiveFile(directory, 'manifest.json');
    if (completion.manifestSha256 !== hashOf(raw) || JSON.stringify(completion.materials) !== JSON.stringify(manifest.materials)) return { kind: 'unreadable', path: manifestPath, why: 'manifest is not the Ledger-recorded completed delivery' };
  }
  for (const material of manifest.materials) {
    // Optional means that absence can be represented with a reason. It does not mean a manifest may
    // list an allegedly delivered file and then evade integrity verification by setting a flag.
    if (material.missingReason !== undefined) continue;
    const at = path.resolve(directory, material.path);
    if (!at.startsWith(`${path.resolve(directory)}${path.sep}`)) return { kind: 'unreadable', path: manifestPath, why: `material path escapes archive: ${material.path}` };
    let bytes: Buffer;
    try { bytes = await readArchiveFile(directory, material.path); }
    catch (error) { return { kind: 'unreadable', path: at, why: (error as Error).message }; }
    const found = hashOf(bytes);
    if (found !== material.sha256) return { kind: 'changed', path: at, recorded: material.sha256, found };
    if (bytes.byteLength !== material.bytes) return { kind: 'unreadable', path: at, why: `recorded size ${String(material.bytes)} differs from found ${String(bytes.byteLength)}` };
  }
  return { kind: 'read', manifest, directory, manifestPath };
}

const randomSuffix = (): string => `${process.pid}-${Math.random().toString(16).slice(2)}`;

/** The customer-asset branch is never allowed to cross a link after the Pack snapshot selected it. */
async function archivePathSafe(packDir: string, runId: string, requireRun: boolean): Promise<void> {
  for (const at of [packDir, path.join(packDir, runAssetsDirectory), path.join(packDir, runAssetsDirectory, runId)]) {
    try {
      const state = await lstat(at);
      if (state.isSymbolicLink()) throw new Error(`archive path refuses symlink: ${at}`);
      if (!state.isDirectory()) throw new Error(`archive path is not a directory: ${at}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' && !requireRun) return;
      throw error;
    }
  }
}

async function readArchiveFile(directory: string, relative: string): Promise<Buffer> {
  const at = await archiveFilePath(directory, relative, false);
  const state = await lstat(at);
  if (!state.isFile() || state.isSymbolicLink()) throw new Error(`archive material is not a plain file: ${at}`);
  const handle = await open(at, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const held = await handle.stat();
    if (!held.isFile() || held.dev !== state.dev || held.ino !== state.ino) throw new Error(`archive material changed while opening: ${at}`);
    return await handle.readFile();
  } finally { await handle.close(); }
}

/** Resolve one archive file only through plain directory ancestors. The final open still carries
 * O_NOFOLLOW, so both a linked parent and a linked leaf are refused. */
async function archiveFilePath(directory: string, relative: string, createParents: boolean): Promise<string> {
  const root = path.resolve(directory);
  const at = path.resolve(root, relative);
  if (!at.startsWith(`${root}${path.sep}`)) throw new Error(`archive material path escapes ${root}: ${relative}`);
  const parent = path.dirname(at);
  const below = path.relative(root, parent);
  const ancestors = [root];
  if (below !== '') {
    let current = root;
    for (const part of below.split(path.sep)) { current = path.join(current, part); ancestors.push(current); }
  }
  for (const ancestor of ancestors) {
    if (createParents) {
      try { await mkdir(ancestor, { mode: 0o700 }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    }
    const state = await lstat(ancestor);
    if (state.isSymbolicLink() || !state.isDirectory()) throw new Error(`archive material ancestor is not a plain directory: ${ancestor}`);
  }
  return at;
}

async function writeArchiveFile(directory: string, relative: string, bytes: Uint8Array): Promise<void> {
  const at = await archiveFilePath(directory, relative, true);
  const handle = await open(at, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(bytes); }
  finally { await handle.close(); }
}

async function completeArchive(deps: ExperienceDeps, runId: string, directory: string, manifest: RunAssetManifest, manifestPath: string): Promise<void> {
  const held = archiveCompleteOf(deps.ledger, runId);
  const bytes = await readArchiveFile(directory, 'manifest.json');
  const sha256 = hashOf(bytes);
  if (held !== undefined) {
    if (held.directory !== directory || held.manifestSha256 !== sha256 || JSON.stringify(held.materials) !== JSON.stringify(manifest.materials)) throw new Error('a different completed archive is already recorded for this Run');
    return;
  }
  const pending = deps.ledger.records({ runId, type: 'archive' }).findLast((record): record is ArchiveRecord => record.type === 'archive' && record.delivery === 'pending');
  if (pending === undefined || pending.directory !== directory || pending.manifestSha256 !== sha256 || JSON.stringify(pending.materials) !== JSON.stringify(manifest.materials)) throw new Error('no matching pre-publication archive reservation exists');
  await deps.ledger.appendArchive(runId, { delivery: 'complete', directory, manifestSha256: sha256, materials: [...manifest.materials] });
}

async function reserveArchive(deps: ExperienceDeps, runId: string, directory: string, manifest: RunAssetManifest): Promise<void> {
  const bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  const sha256 = hashOf(bytes);
  const prior = deps.ledger.records({ runId, type: 'archive' }).findLast((record): record is ArchiveRecord => record.type === 'archive' && record.delivery === 'pending');
  if (prior !== undefined) {
    if (prior.directory !== directory || prior.manifestSha256 !== sha256 || JSON.stringify(prior.materials) !== JSON.stringify(manifest.materials)) throw new Error('a different archive publication is already pending for this Run');
    return;
  }
  await deps.ledger.appendArchive(runId, { delivery: 'pending', directory, manifestSha256: sha256, materials: [...manifest.materials] });
}

async function archiveFailure(deps: ExperienceDeps, runId: string, directory: string, why: string): Promise<WriteRunAssetsResult> {
  await deps.ledger.appendArchive(runId, { delivery: 'failed', directory, materials: [], reason: why });
  return { kind: 'failed', why };
}

async function readObservedAsset(deps: ExperienceDeps, run: RunRecord, record: ObservationRecord): Promise<Buffer | string> {
  if (record.retainedPath !== undefined && run.packId !== undefined) {
    const held = await readRetainedMaterial(deps, run, record.retainedPath, record.contentSha256, record.bytes);
    return held.kind === 'read' ? held.bytes : held.kind === 'changed' ? `retained observation changed to ${held.found}` : held.why;
  }
  const site = loadSite(deps.sitesDir, run.siteId);
  const channel = channelFor(site);
  const decision = await decideRead(site, record.path, channel);
  if (!decision.ok) return decision.reason;
  const answer = await channel.exec(['cat', '--', decision.absPath]);
  if (answer.code !== 0) return answer.stderr.trim() || `cat exited ${String(answer.code)} on site ${site.name}`;
  const found = hashOf(answer.stdout);
  if (found !== record.contentSha256) return `${record.path} changed from ${record.contentSha256} to ${found}`;
  if (answer.stdout.byteLength !== record.bytes) return `${record.path} recorded size ${String(record.bytes)} differs from found ${String(answer.stdout.byteLength)}`;
  return Buffer.from(answer.stdout);
}

/** Hold exact observed bytes before later generations overwrite their Site pathname. This is
 * private Pack evidence staging, not a completed archive or another observation authority. */
export async function retainRunMaterial(deps: Pick<ExperienceDeps, 'ledger' | 'packsDir'>, runId: string,
  bytes: Uint8Array, expectedSha256: string): Promise<string | undefined> {
  const run = existingRun(deps.ledger, runId);
  if (run.packId === undefined) return undefined;
  if (hashOf(bytes) !== expectedSha256) throw new Error('source report changed before its observation was retained');
  const folder = installedPackFolder(deps.packsDir, run.packId);
  if (!folder) throw new Error('installed Pack is unavailable for retaining observation bytes');
  await archivePathSafe(folder.dir, run.id, false);
  const root = path.join(folder.dir, runAssetsDirectory);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const relative = `.evidence/${run.id}/${expectedSha256}.dat`;
  const target = await archiveFilePath(root, relative, true);
  const temporary = `${relative}.${randomSuffix()}.tmp`;
  const tempPath = await archiveFilePath(root, temporary, true);
  try {
    await writeArchiveFile(root, temporary, bytes);
    try { await link(tempPath, target); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    const held = await readArchiveFile(root, relative);
    if (hashOf(held) !== expectedSha256 || held.byteLength !== bytes.byteLength) throw new Error('retained observation conflicts with existing bytes');
    return target;
  } finally { await rm(tempPath, { force: true }); }
}

async function readRetainedMaterial(deps: ExperienceDeps, run: RunRecord, retainedPath: string, sha256: string, size: number): Promise<
  { kind: 'read'; bytes: Buffer } | { kind: 'changed'; found: string } | { kind: 'unreadable'; why: string }
> {
  try {
    if (!run.packId) throw new Error('Run has no Pack for retained material');
    const folder = installedPackFolder(deps.packsDir, run.packId);
    if (!folder) throw new Error('installed Pack for retained material is unavailable');
    const root = path.join(folder.dir, runAssetsDirectory), relative = `.evidence/${run.id}/${sha256}.dat`;
    const canonical = path.join(root, relative);
    if (path.resolve(retainedPath) !== canonical && verifiedPackRelocation({ packDir: folder.dir, originalPath: retainedPath, sha256, bytes: size }) !== canonical) throw new Error('retained material is outside its Run and content identity or has no verified migration');
    const bytes = await readArchiveFile(root, relative), found = hashOf(bytes);
    if (found !== sha256) return { kind: 'changed', found };
    if (bytes.byteLength !== size) throw new Error('retained material byte count differs from the record');
    return { kind: 'read', bytes };
  } catch (error) { return { kind: 'unreadable', why: (error as Error).message }; }
}
