// Where an id a pack names resolves from (#57): the pack's own folder first, the bundle's second.
//
// A HimaPack is a folder of plain files, and since this ticket that folder may carry its own
// `rules/`, `choosers/`, `readers/` and `knowledge/`. A pack that brings a rule the bundle never
// shipped is the ordinary case — a method is the pack's, and the harness only supplies what every
// pack would otherwise write twice — so resolution looks in the pack first and falls back to the
// bundle, and a miss says both places rather than the one the bundle happens to keep.
//
// **A leaf: it imports nothing of this bundle**, and that is the whole point of the file.
// `rules.ts` and `choosers.ts` load two kinds of file by the same rule and cannot import one
// another; `packs.ts` computes the ordered lists and imports both. Two spellings of "the first of
// these directories that holds `<id>.yml`" would be two answers to which file a Campaign ran on.
//
// Since #64 a place also carries the *instant* its bytes are from — the disk as the question is
// asked, or the one reading of the pack folder a check is being made from — for the same reason: one
// lookup, whichever way the bytes arrive.
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The folders a pack may carry its own data in, under its own directory (#57).
 *
 * Named here rather than beside each loader because a pack author reads them as one anatomy — four
 * folders beside `contract.yml` and `graph.yml` — and because the check that reports where every id
 * came from has to spell the same four.
 */
export const packDataDirs = { rules: 'rules', choosers: 'choosers', readers: 'readers', knowledge: 'knowledge' } as const;

/**
 * **One place `<id>.yml` is looked for, and the instant its bytes are from** (#57, #64).
 *
 * A place is always a directory, because that is what a person edits, what a refusal names and what
 * an origin is decided by. What differs between the two below is *when* the bytes were read, and
 * that is a difference the caller has to state rather than inherit:
 *
 * - a **check** is one statement about one folder at one instant, so its pack-local places answer
 *   out of the one reading the pack was parsed from (`dataInReading`);
 * - a **running node** is about the folder as it now stands, because a pack edited between two
 *   generations means the correction (D46), so its places read the disk when the question is asked
 *   (`dataOnDisk`).
 *
 * One interface and one lookup for both, so that "the pack's own folder first, the bundle's second"
 * is spelled once however the bytes arrive — two spellings of that order would be two answers to
 * which file a Campaign ran on.
 */
export interface DataPlace {
  /** The directory, as an origin and a refusal name it. */
  readonly dir: string;
  /** `<id>.yml` in it as text, or undefined when this place holds no such file. */
  text(id: string): string | undefined;
}

/**
 * A directory on this machine, read at the moment the question is asked.
 *
 * **Only `ENOENT` is absence.** Every other fault — a file this process may not read, a `rules` that
 * is a file rather than a directory, a disk that answered with an error — is thrown, because it is
 * not an answer to the question asked. A pack that says which rule its Campaign runs on and whose
 * file will not open has not thereby chosen the bundle's copy of that id, and a resolution that
 * quietly moved on to the bundle here would run a Campaign on a rule nobody selected.
 */
export function dataOnDisk(dir: string): DataPlace {
  return {
    dir,
    text: (id) => {
      try {
        return readFileSync(path.join(dir, `${id}.yml`), 'utf8');
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
        return undefined;
      }
    },
  };
}

/**
 * What one reading of a pack folder answers about a path, as this leaf needs it.
 *
 * Structural on purpose, so this file still imports nothing of the bundle: `PackFolderSnapshot`
 * satisfies it by being what it is.
 */
export interface HeldByAReading {
  /** One file's bytes as text, or undefined when the folder holds no plain file at that path. */
  text(relative: string): string | undefined;
  /** Whether a plain file of the folder stands at exactly that path. */
  has(relative: string): boolean;
  /** Every directory of the folder, by the same relative paths. */
  readonly directories: ReadonlySet<string>;
}

/**
 * A directory **inside a pack folder**, answered out of one reading of that folder (#64).
 *
 * Nothing is opened: the reading already opened every file of the folder once, refusing anything
 * that was not a plain file and naming the path. So absence here is the folder holding no such file
 * at the instant it was read, which is the only absence a check about that instant can mean.
 *
 * **And absence is all it may answer.** A reading in which `readers` is a plain file, or in which a
 * *directory* stands at `rules/<id>.yml`, is not a pack that declares nothing of that kind: on the
 * disk those two are `ENOTDIR` and `EISDIR`, which `dataOnDisk` throws, and a place that answered
 * "absent" for either would fall to the bundle behind a pack that shadowed it — running a bundled
 * rule, chooser or reader under the pack's own id and reporting it as a pass. So both are refused
 * here too, naming the path, in the same breath the disk names it.
 *
 * @param packDir - the pack folder.
 * @param under - the folder's own subdirectory, one of `packDataDirs`.
 * @param held - the reading.
 */
export function dataInReading(packDir: string, under: string, held: HeldByAReading): DataPlace {
  const dir = path.join(packDir, under);
  return {
    dir,
    text: (id) => {
      const relative = `${under}/${id}.yml`;
      const text = held.text(relative);
      if (text !== undefined) return text;
      if (held.has(under)) {
        throw new Error(`cannot read ${path.join(dir, `${id}.yml`)}: ${dir} is a plain file of this pack folder and not a directory`);
      }
      if (held.directories.has(relative)) {
        throw new Error(`cannot read ${path.join(dir, `${id}.yml`)}: a directory stands there, and a pack's data file is a plain file`);
      }
      return undefined;
    },
  };
}

/** What one lookup found: the file's text and where it was read from, or every place looked at. */
export type DataFileLookup =
  | { readonly ok: true; readonly text: string; readonly dir: string; readonly at: string }
  | { readonly ok: false; readonly looked: readonly string[] };

/**
 * `<id>.yml` in the first of `places` that holds one.
 *
 * Order is the caller's and is never sorted here: `places` arrives as the pack's own folder followed
 * by the bundle's, which is what "the pack comes first" means in this harness (D46). A place that
 * holds no such file is passed over and the next asked; a place that cannot answer at all throws,
 * which is `dataOnDisk`'s rule and is stated there.
 *
 * @param id - the rule's or chooser's id, already held to its own safe shape by its loader.
 * @param places - where to look, in order, each saying which instant its bytes are from.
 * @returns the file and the directory it came from, or the paths that were looked at and are not
 *          there — every one of them, so a refusal can name both places.
 */
export function readDataFile(id: string, places: readonly DataPlace[]): DataFileLookup {
  const looked: string[] = [];
  for (const place of places) {
    looked.push(path.join(place.dir, `${id}.yml`));
    const text = place.text(id);
    // Absent, and only absent. The next place is then asked, and if none of them has it the whole
    // list is what the refusal names: a person told only about the bundle would go on editing the
    // wrong folder.
    if (text !== undefined) return { ok: true, text, dir: place.dir, at: path.join(place.dir, `${id}.yml`) };
  }
  return { ok: false, looked };
}

/** The places a lookup looked, as a refusal names them: `at <a> or at <b>`. */
export const placesLooked = (looked: readonly string[]): string => looked.join(' or at ');
