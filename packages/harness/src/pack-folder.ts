// **One reading of a pack folder, in memory, that every decision about that folder is made from**
// (#64).
//
// A pack folder is plain files a person edits (D28), and until this module there were as many
// answers about one folder as there were readers of it: the ladder read the records by pathname, the
// loader parsed the contract by pathname, the digest walked and hashed, the release walked again and
// then re-read `TEST.md`. Each of those is a different instant, and a folder that changed between
// two of them produced a seal whose hashes and whose evidence were about different bytes — which is
// not a race anybody has to win to be wrong about, it is a claim the harness could not support.
//
// So: **one walk, one set of bytes, and every later question answered from it.** `snapshotPackFolder`
// reads the folder into `files`, and the digest a Run records, the file list a seal carries, the
// contract a Campaign is driven by and the records the ladder validates are all derived from that one
// map. Two answers about one folder become impossible rather than unlikely.
//
// **What the snapshot promises**, exactly:
//
// - `run-assets/` is customer knowledge, excluded from every method snapshot view. Its entries are
//   inspected for symlinks and special files, but their bytes are never read, sealed or exported;
// - no entry that was not a plain file when it was inspected enters a digest, a seal or a Run — every
//   entry of the folder, hidden or not, is `lstat`ed, and a hidden *directory* is walked too, so
//   nothing is left uninspected merely because its name begins with a dot. A hidden **regular file**
//   is `lstat`ed like any other and then skipped: it is never opened and never read, because it is
//   not a file of the pack and its bytes belong to no digest, no seal and no Campaign;
// - every byte it holds was read from a descriptor opened without following a link, and `fstat`ed
//   through that descriptor as the very inode the walk accepted (`dev` and `ino` compared);
// - every directory it descended was still the same directory after its names were read.
//
// **The limit, stated once here and once in the README.** Node offers no `openat`, so a path is
// resolved twice however this is written: once by the `lstat` that says what an entry is, once by the
// `open` or the second `lstat` that acts on it. A process racing this walk *with the user's own
// rights* can therefore make a later resolution find something else, and the two windows that opens
// are not the same:
//
// - **the file being read.** Refused naming the path, not hashed: the open refuses a link and the
//   `fstat` refuses a different inode, so what enters the snapshot is the inode that was inspected.
// - **a directory whose children have not been walked yet.** *Outside* the promise. The directory is
//   held to one inode across reading its names, and then its children are `lstat`ed and opened
//   afterwards, by path. A directory swapped for a link to somewhere else in that window is never
//   caught by the children's own checks — each child's `lstat` and `open` resolve through the same
//   replacement and agree with each other perfectly — so its children can enter this pack. That is a
//   window this walk narrows and does not close.
//
// Closing either window is outside what this module can promise, as it is for every Site operation
// this harness performs: a person who can rewrite the pack folder mid-release can rewrite it before
// the release instead.
//
// A leaf but for `errors.ts`, which is itself one: `packs.ts` and `release.ts` both stand on this
// module, which is what keeps them from coming to hold two different answers about what a pack
// folder's files are. Every refusal here is a `PackFolderError`, so that every face can answer "this
// folder is not a folder of plain files, and here is the path" in words rather than raising.
import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, readdirSync, readFileSync, type Stats } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { PackFolderError } from './errors.js';

/**
 * A pack id: the name a pack folder is installed under, and the same grammar every id *inside* a
 * pack is held to — a tool, a node, a chooser.
 *
 * Here rather than in `packs.ts` because the first of those is a fact about the folder, and the seal
 * `release.ts` writes names the pack by it; one grammar in one leaf is what stops the folder's name
 * and the seal's `pack:` from ever being parsed by two different rules.
 */
export const packId = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'a pack, tool, node or chooser id is lowercase letters, digits and dashes');

/**
 * The five records the authoring pipeline writes into a pack folder (#63, #64).
 *
 * Named here, with the walk, because the two derived views below are both defined by leaving some of
 * them out: a Run's digest is the folder without any of the five, and a seal lists every file but
 * itself.
 */
export const pipelineFiles = { intent: 'INTENT.md', spec: 'SPEC.md', fabric: 'FABRIC.md', test: 'TEST.md', version: 'VERSION.yml' } as const;

/** Customer knowledge has one home, and never forms part of reference-method identity. */
export const runAssetsDirectory = 'run-assets';
export const methodInstallFile = '.hima-method-install.json';
export const methodHistoryDirectory = '.hima-method-history';
export const methodUpdateFile = '.hima-method-update.json';
/** Private receipt for an owner-reviewed self migration. It is never method or public-share content. */
export const packTransferReceiptFile = '.hima-pack-transfer.json';

/**
 * The files a pack's digest is taken **without**: the pipeline's own records (#64).
 *
 * They are the authoring account and not the pack — a Campaign reads none of them — so a Run's
 * `packDigest` must not move when the test stage writes its record of that very Run, and the release
 * must be able to seal a folder without the seal changing what it sealed.
 */
export const packDigestExcludes: readonly string[] = [
  pipelineFiles.intent,
  pipelineFiles.spec,
  pipelineFiles.fabric,
  pipelineFiles.test,
  pipelineFiles.version,
];

/**
 * One file of a pack folder as a hash names it: a relative path with `/` between its segments, no
 * leading slash, no `..`, no hidden segment.
 *
 * The same grammar the walk holds a discovered path to and a seal's own keys are parsed against, so
 * a folder and the seal over it cannot disagree about what may be in either. A parse that accepted
 * `../..` or an absolute path would let a hand-edited seal name a file outside the folder, and every
 * entry of it is joined to the pack folder and opened.
 */
export const packFilePath = z
  .string()
  .regex(
    /^[A-Za-z0-9_][A-Za-z0-9._-]*(\/[A-Za-z0-9_][A-Za-z0-9._-]*)*$/,
    'a file of a pack is a relative path under the pack folder, as in "tools/synth.sh": letters, digits, dots, dashes and underscores in each segment, no leading slash, no ".." and no hidden segment',
  );

/** One hash as a seal spells it. */
export const packSha256 = z.string().regex(/^[0-9a-f]{64}$/, 'a sha256 is 64 lower-case hex digits');

/** A hidden entry: a leading dot. Nothing in a pack can declare one, so nothing in a pack is one. */
const hidden = (name: string): boolean => name.startsWith('.');

/**
 * A directory entry's name, decoded, or a refusal naming the directory and the bytes.
 *
 * Names are read as bytes because a name *is* bytes. `readdirSync`'s string mode decodes with
 * replacement, so two different on-disk names can come back as one string full of `U+FFFD` — and
 * every message about such a file would print a path that is not the file's. So the bytes are read,
 * decoded, and encoded again: a name that does not survive the round trip is refused naming the
 * directory and its bytes, which is the only spelling of it that is true.
 */
function nameOfEntry(at: string, bytes: Buffer): string {
  const name = bytes.toString('utf8');
  if (Buffer.from(name, 'utf8').equals(bytes)) return name;
  throw new PackFolderError(
    `the pack folder ${at} holds an entry whose name is not UTF-8 (${bytes.toString('hex')}), and a file of a pack is named in text:`
    + ' nothing can list it in a seal, and no two of its names can be told apart',
  );
}

/** What is said of an entry of a pack folder that is not a plain file or a directory. One sentence,
 *  because the walk and the reads below are one rule and a person meets it at whichever of them
 *  noticed first. */
const notAPlainFile = (file: string): string =>
  `${file} is not a plain file (a symlink, a socket or the like), and a pack folder is plain files:`
  + ' nothing can say what a campaign ran while one of them is somewhere else';

/**
 * **Two stats of one path are the same inode, or the path is refused** (#64).
 *
 * The rule the whole walk rests on, in one place because it is applied to both kinds of thing a walk
 * opens. A path is resolved twice — once by the `lstat` that says what an entry *is*, once by the
 * `open` or the second `lstat` that acts on it — and `O_NOFOLLOW` alone answers only the case where
 * the replacement is a link. An ordinary file replaced by another ordinary file, a directory
 * replaced by another directory: both open, both `fstat` as the right kind, and only `dev` and `ino`
 * say they are not the thing that was checked.
 *
 * Exported for the one test that can be deterministic about it: a swap has to happen *between* two
 * synchronous calls of this process, which no second call of this process can stage, so what a test
 * can hold is this comparison itself, over two real stats of two real files.
 *
 * @param at - the path, for the sentence.
 * @param was - what the entry was when it was inspected.
 * @param now - what it is at the moment it is being acted on.
 * @throws naming the path, when the two are not one inode.
 */
export function heldToOneInode(at: string, was: Pick<Stats, 'dev' | 'ino'>, now: Pick<Stats, 'dev' | 'ino'>): void {
  if (was.dev === now.dev && was.ino === now.ino) return;
  throw new PackFolderError(
    `${at} is not the file this walk inspected (it was ${String(was.dev)}:${String(was.ino)} and is now ${String(now.dev)}:${String(now.ino)}):`
    + ' the folder changed while it was being read, and a pack is the bytes one reading of it found',
  );
}

/**
 * The bytes of one file of a pack folder, read from the descriptor that was checked.
 *
 * Opened **once** with `O_NOFOLLOW` — which refuses a symlink at the open rather than following it —
 * `fstat`ed through that descriptor as a plain file and as the very inode the walk accepted, and read
 * from that same descriptor. What enters the snapshot is therefore the inode that was inspected,
 * whatever happens to the name afterwards.
 *
 * @param file - the file's absolute path.
 * @param was - what the walk's `lstat` said it was.
 * @returns its bytes.
 * @throws naming the path: for a name that is a link or anything else not a plain file, for a name
 *         standing for a different inode than the one inspected, and for a file that cannot be read
 *         — absence included, because the walk has just seen it and a file of a pack that vanished
 *         mid-read is a folder that changed, not a shorter pack.
 */
function bytesOfPlainFile(file: string, was: Stats): Buffer {
  let fd: number;
  try {
    fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // `ELOOP` is what `O_NOFOLLOW` answers for a symlink, and `ENOTDIR` what a path whose parent is
    // no longer a directory answers. Neither is "this file cannot be read": both are the folder
    // having changed under the walk, and they are said in the walk's own words.
    if (code === 'ELOOP' || code === 'ENOTDIR') throw new PackFolderError(notAPlainFile(file));
    if (code === 'ENOENT') {
      throw new PackFolderError(`${file} is a file of this pack and is no longer there: the folder changed while it was being read`);
    }
    throw new PackFolderError(`${file} is a file of this pack and cannot be read: ${(err as Error).message}`);
  }
  try {
    const now = fstatSync(fd);
    if (!now.isFile()) throw new PackFolderError(notAPlainFile(file));
    heldToOneInode(file, was, now);
    return readFileSync(fd);
  } catch (err) {
    // The two refusals above are this walk's own sentences and are not wrapped in a third one.
    if (err instanceof Error && (err.message === notAPlainFile(file) || err.message.startsWith(`${file} is not the file this walk inspected`))) throw err;
    throw new PackFolderError(`${file} is a file of this pack and cannot be read: ${(err as Error).message}`);
  } finally {
    closeSync(fd);
  }
}

/**
 * One directory of a pack folder, its names as bytes, held to being the same directory afterwards.
 *
 * `readdirSync` and not the directory handle, for one reason: `opendirSync`'s options carry no byte
 * encoding, and a name is bytes (`nameOfEntry`). So the enumeration goes by pathname, and what makes
 * that safe is the pair of `lstat`s around it: the directory is `lstat`ed before the names are read
 * — by the caller, which is what said it was a directory — and again after, and the two must be one
 * inode. A directory swapped for a link, or for another directory, between those two is refused
 * naming it, rather than its replacement's children entering this pack.
 *
 * @param at - the directory.
 * @param was - what the caller's `lstat` said it was.
 * The identity holds across *reading the names*, and no further: the children are `lstat`ed and
 * opened afterwards, by path, so a swap made after this returns is the window the module comment
 * calls outside the promise.
 *
 * @returns each entry's name, as the bytes the filesystem holds.
 * @throws naming the path, when it is no longer the directory that was inspected; naming the
 *         directory, when it cannot be read.
 */
function entriesOfDirectory(at: string, was: Stats): Buffer[] {
  let names: Buffer[];
  try {
    names = readdirSync(at, { encoding: 'buffer' });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOTDIR' || code === 'ELOOP') throw new PackFolderError(notAPlainFile(at));
    throw new PackFolderError(`the pack folder ${at} cannot be read: ${(err as Error).message}`);
  }
  let now: Stats;
  try {
    now = lstatSync(at);
  } catch (err) {
    throw new PackFolderError(`the pack folder ${at} cannot be read: ${(err as Error).message}`);
  }
  if (!now.isDirectory()) throw new PackFolderError(notAPlainFile(at));
  heldToOneInode(at, was, now);
  return names;
}

/**
 * **One reading of a pack folder**: every file of it, by path relative to the folder, with the bytes
 * that were read (#64).
 *
 * `files` is the reference method and its authoring records, never root `run-assets/` or hidden
 * installer metadata/history. The two views below derive from that map and take no second look
 * at anything, which is the point: a digest, a seal and the contract a Campaign is driven by are then
 * three statements about one instant rather than three instants.
 *
 * Hidden entries are **not** in it — a leading dot in any segment — because nothing in a pack can
 * declare one (`packFilePath` refuses a hidden segment), so a `.DS_Store` or a `.git/` must not make
 * a folder unhashable, unsealable and unrunnable. They are inspected all the same, and so is
 * everything beneath them.
 */
export interface PackFolderSnapshot {
  /** The folder this is a reading of. */
  readonly dir: string;
  /** Every method/authoring file, by path relative to `dir`; customer assets never enter this map. */
  readonly files: ReadonlyMap<string, Uint8Array>;
  /** Plain-file permissions for faithful method export; byte identity retains its existing format. */
  readonly modes: ReadonlyMap<string, number>;
  /** Every inspected entry, including private files; ownership checks must not mistake hidden for owned. */
  readonly entries: ReadonlySet<string>;
  /**
   * Every method directory the walk descended; run-assets and hidden subtrees excluded.
   *
   * Held because "this folder does not hold that file" and "a directory is standing where that file
   * should be" are different things to tell a person, and one reading is what knows both. Nothing is
   * hashed or sealed from it: a pack is its files.
   */
  readonly directories: ReadonlySet<string>;
  /** One file's bytes as text, or undefined when this folder holds no such file. */
  text(relative: string): string | undefined;
  /** Whether a plain file of this pack stands at exactly that path. The other half of `text` for the
   *  callers that ask whether a folder holds something rather than what it says. */
  has(relative: string): boolean;
  /**
   * The digest over this reading, less the named files: sha256 over `"<path> <sha256>\n"` for each
   * remaining file, sorted by path.
   *
   * Sorted pairs and not a hash of a tar, because the digest has to be reproducible by anybody with
   * the folder and `sha256sum`. The pairs carry the path as well as the content, so a file renamed
   * is a folder changed.
   */
  digest(except?: readonly string[]): string;
  /** Every file a seal lists — the whole folder but the seal itself — with its sha256, sorted by
   *  path. The pipeline's records are in it: a person installing a released pack is entitled to know
   *  that the intent, the spec and the records they are reading are the ones it was released with. */
  sealFiles(): readonly (readonly [string, string])[];
}

/** The digest a set of hashed pairs makes: sha256 over `"<path> <sha256>\n"` in the order given. */
const digestOver = (files: readonly (readonly [string, string])[]): string =>
  createHash('sha256').update(files.map(([at, sha]) => `${at} ${sha}\n`).join('')).digest('hex');

/** The snapshot's two derived views, over one map of bytes read once. */
function viewsOf(dir: string, files: ReadonlyMap<string, Uint8Array>, directories: ReadonlySet<string>, entries: ReadonlySet<string>, modes: ReadonlyMap<string, number>): PackFolderSnapshot {
  // Hashed once, on the first question that needs it: a Run asks for one digest, a release asks for
  // a digest and a file list, and hashing the same bytes twice would be two spellings of one number.
  let hashes: readonly (readonly [string, string])[] | undefined;
  const hashed = (): readonly (readonly [string, string])[] => {
    hashes ??= [...files.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
      .map((at) => [at, createHash('sha256').update(files.get(at)!).digest('hex')] as const);
    return hashes;
  };
  return {
    dir,
    files,
    modes,
    entries,
    directories,
    text: (relative) => {
      const bytes = files.get(relative);
      return bytes === undefined ? undefined : Buffer.from(bytes).toString('utf8');
    },
    has: (relative) => files.has(relative),
    digest: (except = []) => {
      const skipped = new Set(except);
      return digestOver(hashed().filter(([at]) => !skipped.has(at)));
    },
    sealFiles: () => hashed().filter(([at]) => at !== pipelineFiles.version),
  };
}

/**
 * **Read a pack folder once**: every entry inspected, every file's bytes taken from the descriptor
 * that was checked (#64).
 *
 * The rule, applied to every entry the walk meets:
 *
 * - **`lstat` first, hidden or not.** What an entry *is* is asked before its name decides anything. A
 *   symlink — a dangling one above all — makes every later question about the folder a question about
 *   bytes somewhere else that nobody reviewing the folder ever saw, and "hash the link" and "hash what
 *   it points at" are two different answers with no reason to prefer either. Anything that is not a
 *   plain file or a directory is refused naming the path.
 * - **A hidden directory is walked too.** Its contents are held to that same rule and then left out
 *   of `files`, exactly as a hidden file is. A namespace nobody may declare is not a namespace
 *   nobody has to look at: a socket or a link out of the folder under `.state/` is as much "this
 *   folder is not plain files" as one at the top.
 * - **Every other discovered path is a name a pack file can have** (`packFilePath`). A quote, a
 *   newline or a control character would reach a digest line and a YAML key, where neither is
 *   unambiguous.
 * - **Every file's bytes come from the descriptor that was `fstat`ed**, and every directory is still
 *   the same inode after its names were read.
 *
 * @param dir - the pack folder.
 * @returns the reading.
 * @throws naming the path, for an entry that is not a plain file or a directory, for one that
 *         changed inode under the walk, for a name that is not UTF-8, and for a name no pack file
 *         can have; naming the folder, when it is not there or cannot be read. Never a shorter map:
 *         a reading that quietly skipped an entry would let exactly the entry nobody may have decide
 *         nothing.
 */
export function snapshotPackFolder(dir: string): PackFolderSnapshot {
  const at = snapshotPackFolderIfThere(dir);
  if (at === undefined) throw new PackFolderError(`the pack folder ${dir} is not there`);
  return at;
}

/**
 * The same reading, and `undefined` for a folder that is simply not there.
 *
 * **Only `ENOENT` on the folder itself is absence.** A packs directory this process may not read, a
 * path that is not a directory, an entry of the folder that will not open: all faults, and all
 * thrown. "Nobody installed a pack of that name" and "this folder is broken" are different answers,
 * and the callers that have a word for the first — the loader, the ladder — say it themselves.
 */
export function snapshotPackFolderIfThere(dir: string): PackFolderSnapshot | undefined {
  const root = lstatSync(dir, { throwIfNoEntry: false });
  if (root === undefined) return undefined;
  if (!root.isDirectory()) throw new PackFolderError(notAPlainFile(dir));
  if (lstatSync(path.join(dir, methodUpdateFile), { throwIfNoEntry: false }) !== undefined) {
    throw new PackFolderError(`${dir} has an interrupted method update (${methodUpdateFile}); keep run-assets intact and restore the previous method from ${methodHistoryDirectory} before retrying`);
  }
  const manifestBefore = lstatSync(path.join(dir, methodInstallFile), { throwIfNoEntry: false });
  const files = new Map<string, Uint8Array>();
  const modes = new Map<string, number>();
  const directories = new Set<string>();
  const entries = new Set<string>();
  /**
   * @param folder - the directory being read.
   * @param was - what the caller's `lstat` said that directory was.
   * @param prefix - its path relative to the pack folder, `''` at the top.
   * @param beneathHidden - whether this whole subtree hangs under a hidden name, and so is inspected
   *                        but held by no pack file's grammar and carried into no digest.
   */
  const walk = (folder: string, was: Stats, prefix: string, beneathHidden: boolean): void => {
    for (const bytes of entriesOfDirectory(folder, was)) {
      const name = nameOfEntry(folder, bytes);
      const file = path.join(folder, name);
      // `lstat` and not `stat`: the question is what this entry *is*, not what it leads to. Asked of
      // every entry, and asked first — before a hidden name is set aside and before the name is held
      // to the grammar — because an entry nobody may have is an entry nobody may have whatever it is
      // called and wherever it is.
      const what = lstatSync(file);
      if (!what.isFile() && !what.isDirectory()) throw new PackFolderError(notAPlainFile(file));
      const relative = prefix === '' ? name : `${prefix}/${name}`;
      entries.add(relative);
      const outside = beneathHidden || hidden(name) || relative === runAssetsDirectory;
      if (relative === runAssetsDirectory && !what.isDirectory()) throw new PackFolderError(`${file} must be a plain directory for customer run assets`);
      if (!outside) {
        const held = packFilePath.safeParse(relative);
        if (!held.success) throw new PackFolderError(`${file} is not a name a pack file can have: ${held.error.issues[0]!.message}`);
      }
      if (what.isDirectory()) {
        if (!outside) directories.add(relative);
        walk(file, what, relative, outside);
        continue;
      }
      // A hidden regular file is inspected — it was `lstat`ed above, like every other entry — and
      // then skipped without ever being opened: it is not a file of this pack, and its bytes belong
      // to no digest, no seal and no Campaign.
      if (outside) continue;
      files.set(relative, bytesOfPlainFile(file, what));
      modes.set(relative, what.mode & 0o777);
    }
  };
  walk(dir, root, '', false);
  const manifestAfter = lstatSync(path.join(dir, methodInstallFile), { throwIfNoEntry: false });
  if (lstatSync(path.join(dir, methodUpdateFile), { throwIfNoEntry: false }) !== undefined
      || (manifestBefore === undefined) !== (manifestAfter === undefined)) {
    throw new PackFolderError(`${dir} changed during a method update; retry after the installation is complete`);
  }
  if (manifestBefore !== undefined && manifestAfter !== undefined) heldToOneInode(path.join(dir, methodInstallFile), manifestBefore, manifestAfter);
  return viewsOf(dir, files, directories, entries, modes);
}

/** What a Campaign of a pack folder ran, as the run row records it (#64): the digest of everything in
 *  the folder but the pipeline's records, over one reading of it. */
export const packDigestOf = (dir: string): string => snapshotPackFolder(dir).digest(packDigestExcludes);
