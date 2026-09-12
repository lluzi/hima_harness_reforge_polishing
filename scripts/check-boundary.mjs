// Enforces the pack-first boundary (D46): the harness names no design, no technology, no vendor's
// tool, no mining route and no report of one. Those belong to a HimaPack, which is a folder of plain
// files a pack author owns; a harness that named one would be a harness with a customer's method
// compiled into it, and the next customer's method would need a second harness.
//
// A rule three reviews had to re-read the diff for is a rule that lives in a check (the engineering
// constitution: enforce, don't remind). So: one noun list, one exemption list, both at the top of
// this file, and each exemption naming the ticket that removes it.
//
// What is scanned is the harness — `packages/*/src`, and the rules and choosers the bundle ships
// beside `lib/`. Not `packs/`, which is a pack and is *supposed* to name its own design and its own
// tools; not `test/`, whose fixtures imitate a vendor's reports on purpose; not `scripts/`, which
// drives the reference site by its own name; not `docs/`, which records what happened there.
//
// An exemption is for code that genuinely reads or imitates a vendor's artefacts, and nothing else.
// An illustrative comment — "two and a half minutes of Design Compiler" — is reworded generically,
// because the sentence is about a licensed synthesis and not about whose.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------------------------
// The list. Everything this check knows lives here and nowhere else.
// ---------------------------------------------------------------------------------------------

/**
 * The nouns the harness may not name, by what kind of thing each is.
 *
 * Matched case-insensitively, on word boundaries, with a space in a noun matching a space, a hyphen
 * or an underscore — so one entry covers `Design Compiler`, `design_compiler` and `Design-Compiler`,
 * and the list stays a list of things rather than a list of spellings.
 */
const NOUNS = {
  design: ['AES', 'aes_cipher_top'],
  technology: ['TSMC28', 'tcbn28'],
  tools: ['Design Compiler', 'dc_shell', 'Library Compiler', 'lc_shell', 'Innovus', 'Genus', 'PrimeTime', 'pt_shell', 'bool2cmos', 'celluzi', 'lclayout', 'librecell'],
  routes: ['timing_criticality', 'hierarchy_reuse', 'structure_frequency', 'structure_compaction', 'mapper_compatibility', 'functional_diversity'],
  reports: ['qor.rpt', 'report_qor', 'verifyGeometry', 'verify_drc'],
  goal: ['target_period_ns'],
};

/**
 * The files `target_period_ns` is still named in, and the one ticket that removes it from all of
 * them (#72: the Goal side's own nouns).
 *
 * The Goal's parameter names come from the Run and not from the harness, but the reference pack's
 * one number is spelled out in this bundle's product text — a route's example body, a card's label,
 * a start form's field, and the bundle's own `clock-period-at-most` rule, whose declared parameter
 * it is. Listed file by file rather than as a directory, because a list that shrinks to nothing is
 * how the day #72 lands announces itself.
 */
const GOAL_PARAMETER_FILES = [
  'packages/harness/rules/clock-period-at-most.yml',
  'packages/harness/src/card-labels.ts',
  'packages/harness/src/fabric.ts',
  'packages/harness/src/ledger.ts',
  'packages/harness/src/packs.ts',
  'packages/harness/src/remote.ts',
  'packages/harness/src/tools.ts',
  'packages/harness/src/workbench.ts',
  // PLS-21 / polishing #24 owns the same existing Goal field in the unified workspace.
  'packages/harness/src/client/HimaWorkbench.tsx',
];

/**
 * Where a noun is allowed, and why. Each entry is one file, the nouns it may name, and the ticket
 * that takes the exemption away.
 *
 * An exemption whose file no longer holds its noun is itself a failure: the ticket landed, or the
 * sentence was reworded, and a list nobody prunes stops being a list of what is actually there.
 */
const EXEMPTIONS = [
  {
    file: 'packages/harness/src/readers.ts',
    nouns: ['Design Compiler', 'Innovus', 'report_qor', 'verify_drc'],
    ticket: 'a later ticket — since #61 a reader may be a script in a pack folder, validated against the pack\'s own declared semantics; this file stays as the bundle\'s default readers, which do read a vendor\'s reports, and goes when a pack ships scripts for these report kinds',
  },
  {
    file: 'packages/desktop/src/local-site.ts',
    nouns: ['Design Compiler', 'dc_shell', 'qor.rpt', 'Innovus', 'verify_drc', 'target_period_ns'],
    ticket: 'carve-out, permanent (D46) — the stand-in flow imitates the shapes of the vendor reports the bundled readers read, which is the one imitation D46 names; since #60 that is three of them, one per reader a stage\'s report is read by',
  },
  ...GOAL_PARAMETER_FILES.map((file) => ({ file, nouns: ['target_period_ns'], ticket: 'PLS-21 / #24 (upstream #72) — the Goal side\'s own nouns' })),
];

/** What is scanned, relative to the root. Directories are walked; a file is scanned as itself. */
const SCANNED = ['packages/*/src', 'packages/harness/rules', 'packages/harness/choosers', 'packages/harness/skills'];

/**
 * Which files are read at all: sources, the data the bundle ships beside them, and — since #63 — the
 * Markdown the bundle ships as instructions.
 *
 * A skill body and its knowledge files are text a model follows with real tools on a person's
 * machine, which makes them the one kind of prose in `packages/` that can carry a method. A vendor's
 * tool named in one of them would put that vendor's flow in the harness as surely as a line of code
 * would — more surely, because the model would act on it. So the skills directory is scanned, and
 * Markdown is read.
 */
const SCANNED_FILES = /\.(ts|tsx|mts|js|mjs|yml|yaml|md)$/;

// ---------------------------------------------------------------------------------------------
// The check.
// ---------------------------------------------------------------------------------------------

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

const argv = process.argv.slice(2);
const at = argv.indexOf('--root');
if (at >= 0 && argv[at + 1] === undefined) {
  console.error('--root was given no directory');
  process.exit(2);
}
/** The tree to scan. The repository's own unless a caller names another, which is how the contract
 *  test shows the check saying no without writing a forbidden noun into these sources. */
const root = at >= 0 ? path.resolve(argv[at + 1]) : repoRoot;
const ownTree = root === repoRoot;

/** One noun as a pattern: case-insensitive, on word boundaries, a space matching any separator. */
function patternFor(noun) {
  const body = noun
    .split(/\s+/)
    .map((word) => word.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[\\s_-]+');
  return new RegExp(`\\b${body}\\b`, 'i');
}

const every = Object.entries(NOUNS).flatMap(([kind, nouns]) => nouns.map((noun) => ({ kind, noun, pattern: patternFor(noun) })));

/** Every noun one line names, in the order the list declares them. */
function nounsIn(line) {
  return every.filter(({ pattern }) => pattern.test(line));
}

/** The nouns this file is allowed to name, lowercased for comparison. */
function exemptedIn(relative) {
  return EXEMPTIONS.filter((e) => e.file === relative).flatMap((e) => e.nouns.map((n) => n.toLowerCase()));
}

/** Every file under `where`, which may be a directory or a single file. A `*` stands for one path
 *  segment, which is how `packages/<pkg>/src` reaches both packages without naming either. */
function filesUnder(where) {
  const star = where.indexOf('*');
  if (star >= 0) {
    const before = where.slice(0, star).replace(/\/$/, '');
    const after = where.slice(star + 1).replace(/^\//, '');
    return entriesOf(path.join(root, before)).flatMap((name) => filesUnder(path.join(before, name, after)));
  }
  const abs = path.join(root, where);
  const stats = statOf(abs);
  if (stats === undefined) return [];
  if (stats.isFile()) return SCANNED_FILES.test(abs) ? [where] : [];
  return entriesOf(abs).flatMap((name) => filesUnder(path.join(where, name)));
}

/**
 * What is at this path, or nothing when there is nothing there.
 *
 * **Only `ENOENT` is absence.** A scanned root a tree does not hold contributes no files — the
 * contract test points `--root` at a fixture tree holding one of the five, and the other four being
 * absent is a fact about the fixture, not a fault. Every other error is a path this check was asked
 * to read and could not, and a scan that answered "nothing here" for one would be a D46 check that
 * passed for a directory it never looked at. So it stops, naming the path.
 */
function statOf(abs) {
  try {
    return statSync(abs);
  } catch (err) {
    if (err.code === 'ENOENT') return undefined;
    throw new Error(`boundary: ${abs} cannot be read (${err.code ?? err.message}), so this check cannot say what is in it`);
  }
}

/** What one directory holds, less the trees nothing is scanned in. Fails closed the same way. */
function entriesOf(abs) {
  try {
    return readdirSync(abs).filter((name) => name !== 'node_modules' && name !== 'lib');
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw new Error(`boundary: ${abs} cannot be read (${err.code ?? err.message}), so this check cannot say what is in it`);
  }
}

const hits = [];
/** Which exemptions were actually used, keyed `<file> <noun>`. */
const used = new Set();
/** Every file this run scanned, so an exemption can be held against what is actually there. */
const scanned = new Set();

try {
  for (const where of SCANNED) {
    for (const relative of filesUnder(where)) {
      scanned.add(relative);
      const allowed = exemptedIn(relative);
      const lines = readFileSync(path.join(root, relative), 'utf8').split('\n');
      lines.forEach((line, i) => {
        for (const { kind, noun } of nounsIn(line)) {
          if (allowed.includes(noun.toLowerCase())) {
            used.add(`${relative} ${noun.toLowerCase()}`);
            continue;
          }
          hits.push({ where: `${relative}:${i + 1}`, kind, noun, line: line.trim() });
        }
      });
    }
  }
} catch (err) {
  // A path this check was told to read and could not. It is said as itself and nothing is scanned
  // further: a partial scan reported as a pass is the failure mode this catch exists to refuse.
  console.error(err.message);
  process.exit(1);
}

const failures = hits.map(
  ({ where, kind, noun, line }) => `${where}: names the ${kind} "${noun}" — reword it generically, or list the file in EXEMPTIONS with the ticket that removes it\n    ${line}`,
);

// An exemption nobody needed is a fact worth failing on: its ticket landed, or the sentence was
// reworded, and the list is meant to say what is actually in this tree rather than what was once
// true of it. Two ways for one to go stale, and each is said as itself:
//
// - the file is scanned and no longer names the noun — the ordinary case, and the one that makes
//   the list shrink to nothing the day a ticket lands;
// - the file is not among the files scanned at all, which is a path that moved or a file that went.
//   Asked of this repository's own tree alone, because a fixture tree the contract test points at
//   holds none of these files and "your whole list is missing" would be an answer about the fixture.
for (const { file, nouns, ticket } of EXEMPTIONS) {
  if (!scanned.has(file)) {
    if (ownTree) failures.push(`${file}: is exempted (${ticket}) and is not a file this check scans — remove the exemption, or correct the path`);
    continue;
  }
  for (const noun of nouns) {
    if (used.has(`${file} ${noun.toLowerCase()}`)) continue;
    failures.push(`${file}: is exempted for "${noun}" (${ticket}) and no longer names it — remove the exemption`);
  }
}

if (failures.length > 0) {
  console.error(`boundary: the harness may name no design, technology, vendor tool, mining route or report of one (D46)\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log(`boundary: nothing under ${SCANNED.join(', ')} names a design, a technology, a vendor tool, a mining route or a report of one, beyond ${EXEMPTIONS.length} exemption(s) each naming its ticket`);
