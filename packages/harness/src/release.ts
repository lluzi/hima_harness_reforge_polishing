// The release (#64): the seal a tested pack folder is versioned with, and the two operations that
// write one and hold a folder against one.
//
// Out of `packs.ts` because it changes for its own reason. `packs.ts` says what a pack *is* and
// whether a Site can host it; this says what a released pack is — a folder somebody sealed, with one
// sha256 per file the harness computed and the test Run the seal rests on. A person editing the
// seal's shape, its YAML or the order the release does things in is not editing the loader.
//
// **One reading of the folder, and every part of a release derived from it** (#64). The seal's file
// list, the digest the ledger's test Run is compared against, the contract version stamped on it and
// the test record it rests on all come from one `PackFolderSnapshot`, and the check after the write
// holds the bytes on the disk against that same reading. There is no second walk anywhere in a
// release — first release and re-release alike — because a release is a statement about one instant,
// and a seal whose hashes, whose version and whose evidence came from three readings of a folder
// would be a document that was never true all at once.
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';
import { runIdPattern } from './ledger.js';
import { PackFolderError, PackNotFoundError } from './errors.js';
import { methodHistoryDirectory, methodInstallFile, methodUpdateFile, packDigestExcludes, packFilePath, packId, packSha256, pipelineFiles, runAssetsDirectory, snapshotPackFolder, snapshotPackFolderIfThere, type PackFolderSnapshot } from './pack-folder.js';
import { checkTestRecord, installedPackFolder, loadPackFrom, packFiles, packStageFrom, runNamedByTestRecord, type Pack, type PackContract, type ReleaseDeps } from './packs.js';

/**
 * The version file a release writes: which pack, which version, when, the test record it rests on,
 * and every file it is made of with its hash (#64).
 *
 * Strict, because a hand-edited seal with a key nobody reads is a seal that says less than it looks
 * like it says. `files` covers **every** regular file of the folder except this one — the pipeline's
 * records included, because a person installing a released pack is entitled to know that the intent,
 * the spec, the fabric record and the test record they are reading are the ones it was released with.
 */
export const packVersionFile = z.strictObject({
  pack: packId,
  version: z.string(),
  /** New seals state the same method identity as Run/test/workspace; old method-only seals remain readable. */
  methodDigest: packSha256.optional(),
  /**
   * When the release was written, as an ISO instant.
   *
   * Held to being one rather than taken as any string: a seal is a document a person opens and edits,
   * and a `released:` nobody can order against another release is a field that says nothing. Nothing
   * is decided on its value — it is the release's own word about when — which is exactly why the
   * schema is the only thing that can keep it meaning what it says.
   */
  released: z.string().datetime({ message: 'a release is stamped with an ISO instant, as in 2026-09-12T09:41:07.113Z' }),
  test: z.strictObject({
    record: z.literal(pipelineFiles.test),
    /**
     * The Run the sealed test record names. A run id and not any string: the whole evidence chain of
     * a released pack hangs off this field, and a seal carrying `banana` here would name no Run at
     * all while every hash in the file still verified.
     */
    run: z.string().regex(new RegExp(`^${runIdPattern.source}$`), 'a test record names a run this harness minted, as in run-0f0e0d0c-0b0a-4908-8706-050403020100'),
  }),
  // The keys are held by a refinement rather than by the record's own key schema, for the sentence
  // alone: a record whose key schema refuses answers "Invalid key in record", and a person who has
  // hand-edited a seal needs to be told *which* path is not one and why. The shape refused is the
  // same either way.
  files: z.record(z.string(), packSha256).superRefine((files, ctx) => {
    for (const at of Object.keys(files)) {
      const held = packFilePath.safeParse(at);
      if (held.success) continue;
      ctx.addIssue({ code: 'custom', path: [at], message: `"${at}" is not a file of this pack: ${held.error.issues[0]!.message}` });
    }
  }),
});
export type PackVersionFile = z.infer<typeof packVersionFile>;

/**
 * A folder's `VERSION.yml` as this reading of the folder holds it, or why what is there is not a seal.
 *
 * Read out of the snapshot and nowhere else: the walk has already refused a `VERSION.yml` that is not
 * a plain file, naming it, so by the time this is asked the bytes in hand are a plain file of this
 * pack's own folder. Absence is `undefined`, which is every folder that has not been released.
 */
function sealIn(folder: PackFolderSnapshot): { readonly ok: true; readonly sealed: PackVersionFile } | { readonly ok: false; readonly issue: string } | undefined {
  const text = folder.text(pipelineFiles.version);
  if (text === undefined) return undefined;
  let document: unknown;
  try {
    document = parse(text);
  } catch (err) {
    return { ok: false, issue: `${pipelineFiles.version} is there and is not YAML: ${(err as Error).message}` };
  }
  const parsed = packVersionFile.safeParse(document);
  if (!parsed.success) {
    const wrong = parsed.error.issues.map((i) => `${i.path.join('.') || '<the file itself>'}: ${i.message}`).join('; ');
    return { ok: false, issue: `${pipelineFiles.version} is there and does not read as a version file: ${wrong}` };
  }
  return { ok: true, sealed: parsed.data };
}

/**
 * **Hold a released folder against its own seal**: the pack and the version it names, every file it
 * lists present and hashing to its entry, and no regular file present that it does not list.
 *
 * Both directions, because a release is a claim about a folder and not about a list: a file changed
 * is a pack that is not the one somebody reviewed, and a file *added* is the same thing from the
 * other side — a rule, a chooser or a script that arrived after the seal runs in every Campaign of
 * this pack and nobody signed it.
 *
 * The first offending file is named and the rest are not: a person who has edited a released pack
 * has one thing to do about it, which is to run the stages again, and a list of forty hashes is not
 * what tells them so.
 *
 * And the seal's own `test.run` against the sealed test record's `run:` line: the seal is the only
 * evidence a machine that did not run the test has, and its two halves have to name one Run. A seal
 * whose `test.run` was edited changes no listed hash — `TEST.md`'s bytes are what the hashes cover,
 * not the seal's own — so nothing else here would ever notice.
 *
 * @param folder - the one reading of the folder every answer here is made from.
 * @param contract - the contract as that same reading holds it, whose id and version the seal must
 *                   agree with.
 * @returns what is wrong, or undefined when the folder is exactly what its seal says it is.
 *          `undefined` also for a folder carrying no `VERSION.yml` at all, which is not a fault.
 */
export function releaseIssue(folder: PackFolderSnapshot, contract: Pick<PackContract, 'id' | 'version'>): string | undefined {
  const read = sealIn(folder);
  if (read === undefined) return undefined;
  if (!read.ok) return read.issue;
  const { sealed } = read;
  const said = (what: string): string => `${pipelineFiles.version} is there and ${what}`;
  if (sealed.pack !== contract.id) return said(`seals pack "${sealed.pack}", and ${packFiles.contract} declares "${contract.id}"`);
  if (sealed.version !== contract.version) return said(`seals version ${sealed.version}, and ${packFiles.contract} declares version ${contract.version}`);
  if (Object.keys(sealed.files).some((at) => inTree(at, runAssetsDirectory))) return said('mixes run-assets with reference method files; this legacy seal needs owner review and a new tested release, not an invented replacement identity');
  const now = new Map(folder.sealFiles());
  for (const [at, sha] of Object.entries(sealed.files)) {
    const here = now.get(at);
    if (here === undefined) return said(`${at} is listed in it and is not in this folder`);
    if (here !== sha) return said(`${at} no longer hashes to it`);
  }
  for (const [at] of now) {
    if (!Object.hasOwn(sealed.files, at)) return said(`${at} is not listed in it`);
  }
  if (sealed.methodDigest !== undefined && sealed.methodDigest !== folder.digest(packDigestExcludes)) return said('names a methodDigest that does not match this reference method');
  // And the two halves of the evidence, which the hashes above cannot hold against each other.
  const record = folder.text(pipelineFiles.test);
  if (record === undefined) return said(`rests on ${pipelineFiles.test}, and this folder holds none`);
  const named = runNamedByTestRecord(record);
  if (named.kind !== 'named') {
    return said(`rests on ${pipelineFiles.test}, and that record ${named.kind === 'none' ? 'names no run' : 'names two runs'}`);
  }
  if (named.run !== sealed.test.run) {
    return said(`names run ${sealed.test.run} as the test it rests on, and ${pipelineFiles.test} names run ${named.run}`);
  }
  return undefined;
}

/** One scalar of the version file, quoted so that nothing a contract or a path can hold changes what
 *  the file means. Single-quoted YAML escapes exactly one character, the quote itself. */
const yamlScalar = (value: string): string => `'${value.replaceAll("'", "''")}'`;

/** What `/hima pack release` did, or why it did nothing. */
export type ReleaseResult =
  | { readonly kind: 'released'; readonly file: string; readonly sealed: PackVersionFile; readonly rewritten: boolean }
  | { readonly kind: 'refused'; readonly reason: string };

/**
 * The seal as it now stands on the disk, read back through a descriptor opened without following a
 * link.
 *
 * The one read of this folder that is deliberately *not* out of the snapshot, because its whole
 * question is what the write left behind: the bytes the rename put at that path. Everything it is
 * then compared against comes from the snapshot.
 */
function sealJustWritten(file: string): string {
  return plainFileBytes(file).toString('utf8');
}

function plainFileBytes(file: string): Buffer {
  let fd: number;
  try {
    fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (err) {
    throw new Error(`${pipelineFiles.version} cannot be read back: ${(err as Error).message}`);
  }
  try {
    if (!fstatSync(fd).isFile()) throw new Error(`${pipelineFiles.version} is not a plain file`);
    return readFileSync(fd);
  } finally {
    closeSync(fd);
  }
}

/**
 * **Seal a tested pack folder**: write `VERSION.yml` over every file it is made of, with the hashes
 * this harness computed (#64).
 *
 * The stage a person invokes writes nothing by hand, and this is why: a version file a model typed
 * would carry hashes nothing computed, and the whole point of a release is that a person can check
 * its hashes against the bytes. So the skill calls this verb and reports what it sealed.
 *
 * The version is the **contract's**. A pack declares its version once, in the file that also declares
 * what it runs, and the release seals whatever that says — so releasing again over the same version
 * is a rewrite of `VERSION.yml` and is allowed for unchanged method content. An installed method
 * whose content changes needs a new version; its previous ownership and method remain verifiable.
 * A folder whose test record no longer holds cannot be released.
 *
 * **One reading of the folder, at the top, and nothing here takes another** — the stage the folder
 * stands at, the pack that is sealed, the record the ledger is asked about, the hashes the seal
 * lists and the bytes that are written are all that one reading's, and the check after the write
 * holds what is on the disk against it. A re-release is no different: the ladder is climbed from the
 * snapshot too, so the seal that authorised the release and the seal being replaced are read from
 * the same bytes as the files being sealed.
 *
 * @param deps - where packs are installed, and this host's ledger.
 * @param req - the pack to release.
 * @returns what was sealed, or why nothing was.
 * @throws {PackNotFoundError} when no folder of that name is installed, or the id is not a pack id.
 */
export function releasePack(deps: ReleaseDeps, req: { readonly pack: string }): ReleaseResult {
  if (!packId.safeParse(req.pack).success) throw new PackNotFoundError(`unknown pack "${req.pack}": not a pack id`);
  const dir = path.resolve(deps.packsDir, req.pack);
  const lock = path.join(path.dirname(dir), `.${req.pack}.hima-install-lock`);
  try {
    plainAncestors(dir);
    if (lstatSync(dir, { throwIfNoEntry: false }) === undefined) throw new PackNotFoundError(`unknown pack "${req.pack}": no folder at ${dir}`);
    // Installation and publication change the same ownership facts, under the same lock.
    writeFileSync(lock, `${JSON.stringify({ pack: req.pack, operation: 'release' })}\n`, { flag: 'wx' });
  } catch (err) {
    if (err instanceof PackNotFoundError) throw err;
    return { kind: 'refused', reason: `pack ${req.pack} cannot be sealed: ${(err as Error).message}` };
  }
  try {
    return releaseLockedPack(deps, req);
  } finally {
    rmSync(lock);
  }
}

function releaseLockedPack(deps: ReleaseDeps, req: { readonly pack: string }): ReleaseResult {
  // The one reading. A folder holding anything that is not a plain file, or a name no pack file can
  // have, stops the release here, naming it, rather than being sealed as though it were a file of
  // this pack or written into a YAML key that cannot mean it — and it stops *before* the ladder, the
  // loader or the record have said anything, because what the folder **is** has to be settled before
  // what it claims is worth asking.
  let folder: PackFolderSnapshot | undefined;
  try {
    folder = installedPackFolder(deps.packsDir, req.pack);
  } catch (err) {
    if (err instanceof PackNotFoundError) throw err;
    return { kind: 'refused', reason: `pack ${req.pack} cannot be sealed: ${(err as Error).message}` };
  }
  if (folder === undefined) throw new PackNotFoundError(`unknown pack "${req.pack}": no folder at ${path.join(deps.packsDir, req.pack)}`);

  const stage = packStageFrom(folder);
  if (stage.stage !== 'tested' && stage.stage !== 'released') {
    const next = stage.next === undefined ? '' : `; next: ${stage.next} — ${stage.needs!}`;
    return {
      kind: 'refused',
      reason: `pack ${req.pack} stands at ${stage.stage} and a release seals a tested pack${next}${stage.issue === undefined ? '' : `; ${stage.issue}`}`,
    };
  }
  const pack = loadPackFrom(folder);

  // The record, held against this host's ledger over the very digest of the very bytes about to be
  // sealed. A release that hashed the folder again to check the Run would be authorising one set of
  // bytes and sealing another.
  const record = checkTestRecord(pack, deps.ledger);
  if (record === undefined) {
    return { kind: 'refused', reason: `pack ${req.pack} holds no ${pipelineFiles.test} naming a run, and a release rests on the test record` };
  }
  if (record.error !== undefined) return { kind: 'refused', reason: `pack ${req.pack} is not releasable: ${record.error}` };

  let owned: MethodManifest | undefined;
  try {
    owned = publicationOwnership(folder, pack);
  } catch (err) {
    return { kind: 'refused', reason: `pack ${req.pack} cannot be sealed: ${(err as Error).message}` };
  }

  const files = folder.sealFiles();
  const composed = {
    pack: pack.id,
    version: pack.contract.version,
    methodDigest: folder.digest(packDigestExcludes),
    released: new Date().toISOString(),
    test: { record: pipelineFiles.test, run: record.run },
    files: Object.fromEntries(files),
  };
  // Held to the schema **before** a byte is written, and not read back afterwards as the only check:
  // validating on the consuming side means the fault is discovered with an invalid seal already on
  // the disk, which is a folder that now claims a release nothing will accept. Every value here comes
  // from this process — the id, the contract's version, this clock, the run the record names, the
  // reading's own paths — so a refusal is a fault in the harness and says so.
  const held = packVersionFile.safeParse(composed);
  if (!held.success) {
    const wrong = held.error.issues.map((i) => `${i.path.join('.') || '<the file itself>'}: ${i.message}`).join('; ');
    return { kind: 'refused', reason: `pack ${req.pack} cannot be sealed: the seal this harness composed is not one: ${wrong}` };
  }
  const sealed: PackVersionFile = held.data;
  const lines = [
    `# The release seal of pack ${pack.id}, written by /hima-release through /hima pack release.`,
    '# Every hash here was computed by the harness over the bytes in this folder; nothing in it was',
    '# typed by hand. `/hima pack check` holds the folder against this file, and a campaign refuses a',
    '# pack whose files no longer match it.',
    `pack: ${yamlScalar(sealed.pack)}`,
    `version: ${yamlScalar(sealed.version)}`,
    `methodDigest: ${yamlScalar(sealed.methodDigest!)}`,
    `released: ${yamlScalar(sealed.released)}`,
    'test:',
    `  record: ${yamlScalar(sealed.test.record)}`,
    `  run: ${yamlScalar(sealed.test.run)}`,
    'files:',
    ...files.map(([at, sha]) => `  ${yamlScalar(at)}: ${yamlScalar(sha)}`),
    '',
  ];
  const file = path.join(pack.dir, pipelineFiles.version);
  const rewritten = stage.stage === 'released';
  // Written to a name of its own and renamed over the seal, never written *through* whatever stands
  // at the seal's path. `wx` so the temporary name is this call's or the call fails; a hidden name so
  // that one left behind by a process that died between the two steps is not a file of the pack and
  // makes no folder unsealable; and `rename`, which replaces the entry rather than the bytes, so a
  // reader either sees the old seal whole or the new one whole and never half of either.
  const temporary = path.join(pack.dir, `.${pipelineFiles.version}.${randomUUID()}`);
  const text = lines.join('\n');
  const next: MethodManifest = { format: 1, pack: pack.id, version: sealed.version, digest: sealed.methodDigest!, files: { ...sealed.files, [pipelineFiles.version]: createMethodHash(Buffer.from(text)) } };
  const marker = path.join(pack.dir, methodUpdateFile);
  try {
    // Two files cannot be renamed atomically. Keep the existing update marker until both agree;
    // an interrupted publication stays refused, with the old manifest and method history intact.
    if (owned !== undefined) writeFileSync(marker, `${JSON.stringify({ previous: owned, next }, null, 2)}\n`, { flag: 'wx' });
    writeFileSync(temporary, text, { flag: 'wx' });
    renameSync(temporary, file);
  } catch (err) {
    rmSync(temporary, { force: true });
    return { kind: 'refused', reason: `pack ${req.pack} could not be sealed: ${(err as Error).message}` };
  }
  // And read back what was just written — the only read of this folder outside the one reading, and
  // deliberately so: the question is what the rename left at that path. What it is held against is
  // the snapshot and nothing else — every file it lists and the hash beside it, the version the
  // reading's own contract declares, the pack it names, and the Run the reading's own record names.
  // A seal whose file list, whose version and whose test Run came from three different readings of a
  // folder is exactly what this pass exists to make impossible, so the comparison is against bytes
  // held in memory rather than against a second walk of a folder that may have moved since.
  const issue = sealWrittenIssue(file, sealed, files);
  if (issue !== undefined) {
    return { kind: 'refused', reason: `pack ${req.pack} was sealed and the seal does not verify: ${issue}; the folder changed while it was being released` };
  }
  if (owned !== undefined) {
    try {
      const tempManifest = path.join(pack.dir, `${methodInstallFile}.next`);
      writeFileSync(tempManifest, `${JSON.stringify(next, null, 2)}\n`, { flag: 'wx' });
      renameSync(tempManifest, path.join(pack.dir, methodInstallFile));
      rmSync(marker);
    } catch (err) {
      return { kind: 'refused', reason: `pack ${req.pack} publication was interrupted while updating its method manifest: ${(err as Error).message}` };
    }
  }
  return { kind: 'released', file, sealed, rewritten };
}

/**
 * What the seal on the disk says that the seal this release composed does not, or nothing when the
 * two are the same document.
 *
 * A read-back and not a second opinion about the folder: it parses the bytes the rename left and
 * holds them against the values already in hand. A write that landed short, a filesystem that gave
 * the name back to something else, a seal somebody replaced in the instant between the rename and
 * this read — each is a released folder that would otherwise have gone on claiming to be one.
 */
function sealWrittenIssue(file: string, sealed: PackVersionFile, files: readonly (readonly [string, string])[]): string | undefined {
  let written: PackVersionFile;
  try {
    const parsed = packVersionFile.safeParse(parse(sealJustWritten(file)));
    if (!parsed.success) {
      return `${pipelineFiles.version} on the disk does not read as a version file: ${parsed.error.issues.map((i) => `${i.path.join('.') || '<the file itself>'}: ${i.message}`).join('; ')}`;
    }
    written = parsed.data;
  } catch (err) {
    return (err as Error).message;
  }
  if (written.pack !== sealed.pack) return `${pipelineFiles.version} on the disk seals pack "${written.pack}" and this release sealed "${sealed.pack}"`;
  if (written.version !== sealed.version) return `${pipelineFiles.version} on the disk seals version ${written.version} and this release sealed ${sealed.version}`;
  if (written.methodDigest !== sealed.methodDigest) return `${pipelineFiles.version} on the disk names a different methodDigest`;
  if (written.test.run !== sealed.test.run) return `${pipelineFiles.version} on the disk rests on run ${written.test.run} and this release sealed run ${sealed.test.run}`;
  for (const [at, sha] of files) {
    const there = written.files[at];
    if (there === undefined) return `${pipelineFiles.version} on the disk does not list ${at}, which this release sealed`;
    if (there !== sha) return `${pipelineFiles.version} on the disk gives ${at} a hash this release did not compute`;
  }
  for (const at of Object.keys(written.files)) {
    if (!files.some(([here]) => here === at)) return `${pipelineFiles.version} on the disk lists ${at}, which is not a file this release sealed`;
  }
  return undefined;
}

/** Installer ownership is a verified file list, never an inference from a directory name. */
const methodManifest = z.strictObject({
  format: z.literal(1),
  pack: packId,
  version: z.string(),
  digest: packSha256,
  files: z.record(packFilePath, packSha256),
});
type MethodManifest = z.infer<typeof methodManifest>;

const inTree = (at: string, root: string): boolean => at === root || at.startsWith(`${root}/`);
const hashFiles = (folder: PackFolderSnapshot): Readonly<Record<string, string>> =>
  Object.fromEntries([...folder.sealFiles(), ...(folder.has(pipelineFiles.version)
    ? [[pipelineFiles.version, createMethodHash(folder.files.get(pipelineFiles.version)!)]] as const : [])]);

function createMethodHash(bytes: Uint8Array): string {
  // Same SHA-256 bytes as the snapshot's named file list; this includes the seal itself for installation.
  return createHash('sha256').update(bytes).digest('hex');
}

function manifestOf(folder: PackFolderSnapshot): MethodManifest {
  const pack = loadPackFrom(folder);
  const issue = releaseIssue(folder, pack.contract);
  if (issue !== undefined) throw new PackFolderError(issue);
  return { format: 1, pack: pack.id, version: pack.contract.version, digest: folder.digest(packDigestExcludes), files: hashFiles(folder) };
}

/** Inspect every ancestor: refusing only the final symlink would still write through its parent. */
function plainAncestors(at: string): void {
  const absolute = path.resolve(at);
  const parent = path.dirname(absolute);
  if (parent !== absolute) plainAncestors(parent);
  const entry = lstatSync(absolute, { throwIfNoEntry: false });
  // macOS's immutable system aliases are how os.tmpdir() spells its root. No customer-controlled
  // link beneath them is accepted, and no arbitrary symlink target is treated as an alias.
  if (process.platform === 'darwin' && ['/var', '/tmp', '/etc'].includes(absolute)
      && entry?.isSymbolicLink() && realpathSync(absolute) === `/private${absolute}`) return;
  if (entry !== undefined && !entry.isDirectory()) throw new PackFolderError(`${absolute} is not a plain directory; method installation cannot follow symlinks`);
}

function declaredManifest(folder: PackFolderSnapshot): MethodManifest | undefined {
  const file = path.join(folder.dir, methodInstallFile);
  if (lstatSync(file, { throwIfNoEntry: false }) === undefined) return undefined;
  const parsed = methodManifest.safeParse(JSON.parse(sealJustWritten(file)));
  if (!parsed.success) throw new PackFolderError(`${file} is not a verified method manifest: ${parsed.error.message}`);
  return parsed.data;
}

function readManifest(folder: PackFolderSnapshot): MethodManifest | undefined {
  const declared = declaredManifest(folder);
  if (declared === undefined) return undefined;
  const actual = manifestOf(folder);
  if (JSON.stringify(Object.entries(declared.files).sort()) !== JSON.stringify(Object.entries(actual.files).sort())
      || declared.pack !== actual.pack || declared.version !== actual.version || declared.digest !== actual.digest) {
    throw new PackFolderError(`${folder.dir} differs from its method manifest (unknown or changed method files); nothing was overwritten`);
  }
  return declared;
}

/** A tested publication may update known method files, never adopt unknown customer files. */
function publicationOwnership(folder: PackFolderSnapshot, pack: Pack): MethodManifest | undefined {
  const owned = declaredManifest(folder);
  if (owned === undefined) return undefined;
  verifyInstallOwnership(folder);
  const originalDir = path.join(folder.dir, methodHistoryDirectory, owned.digest, owned.pack);
  const original = snapshotPackFolderIfThere(originalDir);
  if (original === undefined) throw new PackFolderError(`${originalDir} has no verified original method; publication cannot infer ownership`);
  const previous = readManifest(original);
  const methodFiles = (files: Readonly<Record<string, string>>) => Object.entries(files).filter(([at]) => !packDigestExcludes.includes(at)).sort();
  // Pipeline records can be regenerated for the same method. Every other ownership claim must
  // agree with the already preserved method, so editing a manifest cannot adopt a customer file.
  if (previous === undefined || owned.pack !== pack.id || previous.pack !== owned.pack || previous.version !== owned.version || previous.digest !== owned.digest
      || JSON.stringify(methodFiles(previous.files)) !== JSON.stringify(methodFiles(owned.files))) {
    throw new PackFolderError(`${folder.dir} has no verified original method ownership; nothing was overwritten`);
  }
  for (const at of folder.files.keys()) {
    if (!Object.hasOwn(owned.files, at) && !packDigestExcludes.includes(at)) {
      throw new PackFolderError(`${folder.dir}/${at} has unknown ownership; publish added method files from an explicitly authored source`);
    }
  }
  if (owned.version === pack.contract.version && owned.digest !== folder.digest(packDigestExcludes)) {
    throw new PackFolderError(`pack ${pack.id}@${owned.version} has different method content; declare a new version before publishing`);
  }
  return owned;
}

function verifyInstallOwnership(folder: PackFolderSnapshot, history = true): void {
  const id = path.basename(folder.dir);
  const digests = new Set<string>();
  for (const entry of folder.entries) {
    if ((history && inTree(entry, runAssetsDirectory)) || entry === methodInstallFile) continue;
    if (history && inTree(entry, methodHistoryDirectory)) {
      const [, digest, archivedId] = entry.split('/');
      if (digest === undefined) continue;
      if (!packSha256.safeParse(digest).success || (archivedId !== undefined && archivedId !== id)) {
        throw new PackFolderError(`${folder.dir}/${entry} has unknown ownership in method history; nothing was overwritten`);
      }
      digests.add(digest);
      continue;
    }
    if (entry.split('/').some((segment) => segment.startsWith('.'))) throw new PackFolderError(`${folder.dir}/${entry} has unknown ownership; nothing was overwritten`);
    if (!folder.files.has(entry) && ![...folder.files.keys()].some((file) => file.startsWith(`${entry}/`))) {
      throw new PackFolderError(`${folder.dir}/${entry} has unknown directory ownership; nothing was overwritten`);
    }
  }
  for (const digest of digests) {
    const archived = snapshotPackFolder(path.join(folder.dir, methodHistoryDirectory, digest, id));
    verifyInstallOwnership(archived, false);
    if (readManifest(archived)?.digest !== digest) throw new PackFolderError(`${archived.dir} has no verified method manifest`);
  }
}

/** Write exactly the method snapshot's explicit list; private assets and hidden files are never copied. */
function writeMethodFiles(folder: PackFolderSnapshot, to: string): void {
  for (const [relative, bytes] of folder.files) {
    packFilePath.parse(relative);
    const target = path.join(to, relative);
    plainAncestors(path.dirname(target));
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, bytes, { flag: 'wx', mode: folder.modes.get(relative) });
  }
}

/** Method-only sharing uses an explicit file list from one verified snapshot, into a new directory. */
export function exportPackMethod(req: { readonly from: string; readonly to: string }): { readonly dir: string; readonly files: readonly string[]; readonly digest: string } {
  plainAncestors(req.from);
  const folder = snapshotPackFolder(path.resolve(req.from));
  if (readManifest(folder) !== undefined) verifyInstallOwnership(folder);
  const manifest = manifestOf(folder);
  const dir = path.resolve(req.to);
  plainAncestors(path.dirname(dir));
  mkdirSync(dir, { recursive: false });
  writeMethodFiles(folder, dir);
  return { dir, files: Object.keys(manifest.files), digest: manifest.digest };
}

/** Preserve the actual bytes an identified Run used. Old rows with no digest receive no invented identity. */
export function preservePackMethod(folder: PackFolderSnapshot): string {
  return preserveMethodAt(folder, folder.dir);
}

function preserveMethodAt(folder: PackFolderSnapshot, installedDir: string): string {
  const manifest = manifestOf(folder);
  const dir = path.join(installedDir, methodHistoryDirectory, manifest.digest, manifest.pack);
  plainAncestors(path.dirname(dir));
  const existing = snapshotPackFolderIfThere(dir);
  if (existing !== undefined) {
    const held = readManifest(existing);
    verifyInstallOwnership(existing, false);
    if (held?.digest !== manifest.digest || held.pack !== manifest.pack) throw new PackFolderError(`${dir} is not the preserved method ${manifest.digest}`);
    return dir;
  }
  mkdirSync(path.dirname(dir), { recursive: true });
  mkdirSync(dir);
  writeMethodFiles(folder, dir);
  writeFileSync(path.join(dir, methodInstallFile), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  return dir;
}

/** Resolve historical execution against its own verified method, or refuse before interpreting it. */
export function loadRunPack(packsDir: string, id: string, digest: string | undefined): Pack {
  packId.parse(id);
  if (digest === undefined) throw new PackFolderError(`Run of pack ${id} has no recorded method digest; its original method cannot be verified`);
  packSha256.parse(digest);
  const installed = path.resolve(packsDir, id);
  plainAncestors(installed);
  const history = path.join(installed, methodHistoryDirectory, digest, id);
  plainAncestors(history);
  const preserved = snapshotPackFolderIfThere(history);
  const folder = preserved ?? snapshotPackFolder(installed);
  if (folder.digest(packDigestExcludes) !== digest) throw new PackFolderError(`Run of pack ${id} needs method ${digest}; the installed method differs and no verified original snapshot is available`);
  if (preserved !== undefined && readManifest(preserved)?.digest !== digest) throw new PackFolderError(`${history} is not a verified original method snapshot`);
  if (preserved !== undefined) verifyInstallOwnership(preserved, false);
  return loadPackFrom(preserved === undefined ? snapshotPackFolder(preservePackMethod(folder)) : folder);
}

/**
 * Install declared method bytes while leaving run-assets in place. The marker is written before
 * changing any installed method file; a crash leaves a refused installation and both old/new
 * method snapshots for explicit repair. No failure path removes a customer directory.
 */
export function installPackMethod(req: { readonly from: string; readonly to: string }): { readonly dir: string; readonly digest: string; readonly changed: boolean } {
  plainAncestors(req.from);
  const source = snapshotPackFolder(path.resolve(req.from));
  if (readManifest(source) !== undefined) verifyInstallOwnership(source);
  const next = manifestOf(source);
  const dir = path.resolve(req.to);
  if (path.basename(dir) !== next.pack) throw new PackFolderError(`method ${next.pack} cannot be installed as ${path.basename(dir)}`);
  plainAncestors(dir);
  mkdirSync(path.dirname(dir), { recursive: true });
  const lock = path.join(path.dirname(dir), `.${next.pack}.hima-install-lock`);
  try {
    writeFileSync(lock, `${JSON.stringify({ pack: next.pack, digest: next.digest })}\n`, { flag: 'wx' });
  } catch (err) {
    throw new PackFolderError(`${lock} cannot be acquired; another installation may be running or interrupted: ${(err as Error).message}`);
  }
  try {
    return installMethodSnapshot(source, next, dir);
  } finally {
    rmSync(lock);
  }
}

/** Recover only the verified old/new method bytes of an interrupted installation. Customer assets
 * stay in place. An unexpected file is a conflict to inspect, never permission to remove it. */
export function recoverPackMethod(req: { readonly to: string; readonly action: 'finish' | 'rollback' }): { readonly dir: string; readonly digest: string } {
  if (!['finish', 'rollback'].includes(req.action)) throw new PackFolderError('choose finish or rollback for this interrupted method update');
  const dir = path.resolve(req.to);
  plainAncestors(dir);
  const id = packId.parse(path.basename(dir));
  const lock = path.join(path.dirname(dir), `.${id}.hima-install-lock`);
  writeFileSync(lock, `${JSON.stringify({ pack: id, recovery: req.action })}\n`, { flag: 'wx' });
  try {
    const marker = path.join(dir, methodUpdateFile);
    if (lstatSync(marker, { throwIfNoEntry: false }) === undefined) {
      const installed = snapshotPackFolder(dir);
      verifyInstallOwnership(installed);
      const held = readManifest(installed);
      if (!held) throw new PackFolderError('no interrupted update or verified installed method exists');
      return { dir, digest: held.digest };
    }
    const update = z.strictObject({ previous: methodManifest.nullable(), next: methodManifest })
      .parse(JSON.parse(sealJustWritten(marker)));
    if (update.next.pack !== id || (update.previous && update.previous.pack !== id)) throw new PackFolderError('interrupted update belongs to another Pack');
    const snapshots = new Map<string, PackFolderSnapshot>();
    for (const manifest of [update.previous, update.next]) {
      if (!manifest) continue;
      const held = snapshotPackFolder(path.join(dir, methodHistoryDirectory, manifest.digest, id));
      verifyInstallOwnership(held, false);
      const actual = readManifest(held);
      if (!actual || JSON.stringify(Object.entries(actual.files).sort()) !== JSON.stringify(Object.entries(manifest.files).sort())
          || actual.pack !== manifest.pack || actual.version !== manifest.version || actual.digest !== manifest.digest) {
        throw new PackFolderError('interrupted update does not match its preserved method; nothing was overwritten');
      }
      snapshots.set(manifest.digest, held);
    }
    const target = req.action === 'finish' ? update.next : update.previous;
    if (!target) throw new PackFolderError('first installation has no previous method to roll back to; finish the verified installation');
    const owned = new Set([...Object.keys(update.previous?.files ?? {}), ...Object.keys(update.next.files)]);
    const metadata = new Set([methodInstallFile, `${methodInstallFile}.next`, methodUpdateFile]);
    const directories: string[] = [];
    const inspect = (relative: string): void => {
      const at = path.join(dir, relative);
      const entry = lstatSync(at);
      if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) throw new PackFolderError(`${at} is not a plain recovery path`);
      if (relative === runAssetsDirectory || relative === methodHistoryDirectory) {
        if (!entry.isDirectory()) throw new PackFolderError(`${at} is not a plain directory`);
        return;
      }
      if (entry.isDirectory()) {
        if (relative && ![...owned].some(file => file.startsWith(`${relative}/`))) throw new PackFolderError(`${at} has unknown directory ownership`);
        for (const name of readdirSync(at)) inspect(relative ? `${relative}/${name}` : name);
        if (relative) directories.push(relative);
        return;
      }
      if (metadata.has(relative)) return;
      if (!owned.has(relative)) throw new PackFolderError(`${at} has unknown ownership; nothing was overwritten`);
      const sha = createMethodHash(plainFileBytes(at));
      if (sha !== update.previous?.files[relative] && sha !== update.next.files[relative]) throw new PackFolderError(`${at} differs from both preserved methods; nothing was overwritten`);
    };
    inspect('');
    for (const relative of owned) {
      const at = path.join(dir, relative);
      if (lstatSync(at, { throwIfNoEntry: false })?.isFile()) rmSync(at);
    }
    for (const relative of directories) rmdirSync(path.join(dir, relative));
    writeMethodFiles(snapshots.get(target.digest)!, dir);
    const temp = path.join(dir, `${methodInstallFile}.next`);
    if (lstatSync(temp, { throwIfNoEntry: false })) rmSync(temp);
    writeFileSync(temp, `${JSON.stringify(target, null, 2)}\n`, { flag: 'wx' });
    renameSync(temp, path.join(dir, methodInstallFile));
    rmSync(marker);
    // Re-read the final installation through the normal loader, not a recovery-only interpretation.
    const verified = snapshotPackFolder(dir);
    verifyInstallOwnership(verified);
    if (readManifest(verified)?.digest !== target.digest) throw new PackFolderError('recovered method failed final verification');
    return { dir, digest: target.digest };
  } finally { rmSync(lock); }
}

function installMethodSnapshot(source: PackFolderSnapshot, next: MethodManifest, dir: string): { readonly dir: string; readonly digest: string; readonly changed: boolean } {
  const previous = snapshotPackFolderIfThere(dir);
  let owned: MethodManifest | undefined;
  if (previous !== undefined) {
    owned = readManifest(previous);
    verifyInstallOwnership(previous);
    if (owned === undefined) {
      // A legacy installation can be adopted only by byte equality, never by matching its version alone.
      const actual = manifestOf(previous);
      if (JSON.stringify(Object.entries(actual.files).sort()) !== JSON.stringify(Object.entries(next.files).sort())) {
        throw new PackFolderError(`${dir} has no verified method manifest and differs from the source; nothing was overwritten`);
      }
      owned = actual;
    }
    if (owned.version === next.version && owned.digest !== next.digest) throw new PackFolderError(`pack ${next.pack}@${next.version} has different method content; declare a new version before updating`);
    preservePackMethod(previous);
    if (JSON.stringify(Object.entries(owned.files).sort()) === JSON.stringify(Object.entries(next.files).sort())) {
      if (!previous.entries.has(methodInstallFile)) writeFileSync(path.join(dir, methodInstallFile), `${JSON.stringify(owned, null, 2)}\n`, { flag: 'wx' });
      return { dir, digest: next.digest, changed: false };
    }
  } else {
    mkdirSync(dir, { recursive: true });
  }
  preserveMethodAt(source, dir);
  const marker = path.join(dir, methodUpdateFile);
  writeFileSync(marker, `${JSON.stringify({ previous: owned ?? null, next }, null, 2)}\n`, { flag: 'wx' });
  // Only files owned and checked above can be replaced or removed. run-assets is absent from both lists.
  for (const relative of Object.keys(owned?.files ?? {})) rmSync(path.join(dir, relative));
  // Remove only the now-empty declared method directories. Never recursively remove a directory:
  // a concurrent customer addition stops the transaction instead of being swept up with it.
  for (const relative of [...previous?.directories ?? []].sort((a, b) => b.length - a.length)) rmdirSync(path.join(dir, relative));
  writeMethodFiles(source, dir);
  const tempManifest = path.join(dir, `${methodInstallFile}.next`);
  writeFileSync(tempManifest, `${JSON.stringify(next, null, 2)}\n`, { flag: 'wx' });
  renameSync(tempManifest, path.join(dir, methodInstallFile));
  rmSync(marker);
  return { dir, digest: next.digest, changed: true };
}

export interface PackTransferRequest {
  readonly from: string;
  readonly to: string;
  readonly mode: 'share' | 'migrate' | 'upgrade';
  /** Explicit relative material paths; absent for method-only sharing. Migration carries all assets. */
  readonly assets?: readonly string[];
}
export interface PackTransferReview {
  readonly from: string;
  readonly to: string;
  readonly mode: PackTransferRequest['mode'];
  readonly pack: string;
  readonly methodDigest: string;
  readonly previousDigest?: string;
  readonly files: readonly { readonly path: string; readonly sha256: string; readonly bytes: number }[];
  readonly changes: readonly { readonly path: string; readonly before?: string; readonly after?: string }[];
  readonly reviewSha256: string;
}

/** Review and application share one byte snapshot. The review digest includes source, destination,
 * mode, selected material bytes and previous method identity, so earlier approval is not reusable
 * for changed contents. This is a local owner operation, not a multi-tenant permission system. */
function transferSnapshot(request: PackTransferRequest): { review: PackTransferReview; bytes: Map<string, Uint8Array>; modes: Map<string, number> } {
  if (!['share', 'migrate', 'upgrade'].includes(request.mode)) throw new PackFolderError('unknown Pack transfer mode');
  const from = path.resolve(request.from), to = path.resolve(request.to);
  if (to === from || to.startsWith(`${from}${path.sep}`) || from.startsWith(`${to}${path.sep}`)) throw new PackFolderError('source and destination must be separate Pack directories');
  plainAncestors(from); plainAncestors(to);
  const folder = snapshotPackFolder(from);
  const owned = readManifest(folder);
  if (owned) verifyInstallOwnership(folder);
  const method = manifestOf(folder);
  if (path.basename(to) !== method.pack) throw new PackFolderError(`destination must be named ${method.pack}`);
  if (request.mode !== 'upgrade' && lstatSync(to, { throwIfNoEntry: false })) throw new PackFolderError('export destination already exists; no existing files will be overwritten');
  if (request.mode !== 'share' && request.assets?.length) throw new PackFolderError('explicit materials are only selected for sharing');
  const bytes = new Map(folder.files), modes = new Map(folder.modes);
  const take = (relative: string): void => {
    const at = path.join(from, relative);
    plainAncestors(path.dirname(at));
    const stat = lstatSync(at);
    if (!stat.isFile()) throw new PackFolderError(`${at} is not a plain material file`);
    bytes.set(relative, plainFileBytes(at)); modes.set(relative, stat.mode & 0o777);
  };
  const walk = (relative: string): void => {
    const at = path.join(from, relative), stat = lstatSync(at, { throwIfNoEntry: false });
    if (!stat) return;
    if (stat.isDirectory()) for (const child of readdirSync(at).sort()) walk(`${relative}/${child}`);
    else take(relative);
  };
  if (request.mode === 'migrate') {
    if (!owned) throw new PackFolderError('migration requires a verified installed method');
    walk(runAssetsDirectory); walk(methodHistoryDirectory); take(methodInstallFile);
  } else if (request.mode === 'share') {
    for (const relative of new Set(request.assets ?? [])) {
      if (!packFilePath.safeParse(relative).success || !relative.startsWith(`${runAssetsDirectory}/`)) throw new PackFolderError('shared materials must name files inside run-assets');
      take(relative);
    }
  }
  let previous: MethodManifest | undefined;
  if (request.mode === 'upgrade') {
    const installed = snapshotPackFolder(to);
    previous = readManifest(installed);
    if (!previous) throw new PackFolderError('upgrade requires a verified installed method');
    verifyInstallOwnership(installed);
    if (previous.pack !== method.pack) throw new PackFolderError('upgrade source belongs to another Pack');
    if (previous.version === method.version && previous.digest !== method.digest) throw new PackFolderError('changed method needs a new version');
    if (packStageFrom(folder).stage !== 'released') throw new PackFolderError('upgrade candidate must have a tested release');
  }
  const files = [...bytes].sort(([a], [b]) => a.localeCompare(b)).map(([at, content]) => ({ path: at, sha256: createMethodHash(content), bytes: content.byteLength }));
  const changes = [...new Set([...Object.keys(previous?.files ?? {}), ...files.map(file => file.path)])].sort().flatMap(at => {
    const before = previous?.files[at], after = files.find(file => file.path === at)?.sha256;
    return before === after ? [] : [{ path: at, ...(before ? { before } : {}), ...(after ? { after } : {}) }];
  });
  const facts = { from, to, mode: request.mode, pack: method.pack, methodDigest: method.digest,
    ...(previous ? { previousDigest: previous.digest } : {}), files, changes };
  return { review: { ...facts, reviewSha256: createMethodHash(Buffer.from(JSON.stringify(facts))) }, bytes, modes };
}

export function previewPackTransfer(request: PackTransferRequest): PackTransferReview {
  return transferSnapshot(request).review;
}

/** Called only after owner review of this exact manifest. No network publishing is performed. */
export function applyPackTransfer(request: PackTransferRequest & { readonly reviewSha256: string }): PackTransferReview {
  const held = transferSnapshot(request);
  if (held.review.reviewSha256 !== request.reviewSha256) throw new PackFolderError('Pack transfer contents changed since review; inspect and confirm a fresh manifest');
  if (request.mode === 'upgrade') {
    installPackMethod({ from: held.review.from, to: held.review.to });
    return held.review;
  }
  const destination = held.review.to;
  mkdirSync(path.dirname(destination), { recursive: true });
  const staging = path.join(path.dirname(destination), `.${path.basename(destination)}.transfer-${held.review.reviewSha256}`);
  // A prior interrupted staging directory is retained for inspection; no claim that it completed.
  // A retry verifies/reuses its exact files and adds only missing ones, never replaces changed bytes.
  plainAncestors(staging); mkdirSync(staging, { recursive: true });
  const expected = new Set(held.review.files.map(file => file.path));
  const verifyExisting = (relative: string): void => {
    const at = path.join(staging, relative), stat = lstatSync(at);
    if (stat.isDirectory()) {
      if (relative && ![...expected].some(file => file.startsWith(`${relative}/`))) throw new PackFolderError(`${at} is not part of this reviewed transfer`);
      for (const child of readdirSync(at)) verifyExisting(relative ? `${relative}/${child}` : child);
    } else {
      if (!stat.isFile() || !expected.has(relative)) throw new PackFolderError(`${at} is not part of this reviewed transfer`);
      if (createMethodHash(plainFileBytes(at)) !== held.review.files.find(file => file.path === relative)!.sha256) throw new PackFolderError(`${at} changed in interrupted transfer`);
    }
  };
  verifyExisting('');
  for (const file of held.review.files) {
    const at = path.join(staging, file.path);
    plainAncestors(path.dirname(at)); mkdirSync(path.dirname(at), { recursive: true });
    if (!lstatSync(at, { throwIfNoEntry: false })) writeFileSync(at, held.bytes.get(file.path)!, { flag: 'wx', mode: held.modes.get(file.path) });
    if (createMethodHash(plainFileBytes(at)) !== file.sha256) throw new PackFolderError(`${at} failed transferred content verification`);
  }
  if (lstatSync(destination, { throwIfNoEntry: false })) throw new PackFolderError('destination appeared during transfer; nothing was replaced');
  renameSync(staging, destination);
  return held.review;
}
