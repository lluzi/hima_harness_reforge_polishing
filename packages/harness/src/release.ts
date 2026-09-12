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
import { randomUUID } from 'node:crypto';
import { closeSync, constants, fstatSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';
import { runIdPattern } from './ledger.js';
import { PackNotFoundError } from './errors.js';
import { packFilePath, packId, packSha256, pipelineFiles, type PackFolderSnapshot } from './pack-folder.js';
import { checkTestRecord, installedPackFolder, loadPackFrom, packFiles, packStageFrom, runNamedByTestRecord, type PackContract, type ReleaseDeps } from './packs.js';

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
  const now = new Map(folder.sealFiles());
  for (const [at, sha] of Object.entries(sealed.files)) {
    const here = now.get(at);
    if (here === undefined) return said(`${at} is listed in it and is not in this folder`);
    if (here !== sha) return said(`${at} no longer hashes to it`);
  }
  for (const [at] of now) {
    if (!Object.hasOwn(sealed.files, at)) return said(`${at} is not listed in it`);
  }
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
  let fd: number;
  try {
    fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (err) {
    throw new Error(`${pipelineFiles.version} cannot be read back: ${(err as Error).message}`);
  }
  try {
    if (!fstatSync(fd).isFile()) throw new Error(`${pipelineFiles.version} is not a plain file`);
    return readFileSync(fd, 'utf8');
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
 * is a rewrite of `VERSION.yml` and is allowed, which is what a pack author does after fixing a
 * script and re-running the test stage. What may not happen is a release over a folder whose test
 * record no longer holds, and that is the refusal below.
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

  const files = folder.sealFiles();
  const composed = {
    pack: pack.id,
    version: pack.contract.version,
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
  try {
    writeFileSync(temporary, lines.join('\n'), { flag: 'wx' });
    renameSync(temporary, file);
  } catch (err) {
    // Whatever stopped the write, the folder is left as it was found: the temporary name is this
    // call's own and nothing else can be looking at it.
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
