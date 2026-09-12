// A HimaPack is a folder of plain files (D28), never code: a human-readable spec, a run contract
// naming what a Site must bind and what a generation produces, a graph of the four node kinds, a
// tools directory, and references by identity to the rules its judge nodes apply and the choosers
// its explore nodes pick by. This module is what reads that folder and says whether a given Site can
// host it.
//
// Two things follow from a pack being data. The first is that every part of it can be diffed and
// reviewed by a person who does not read TypeScript, which is the point of D28. The second is that
// nothing here decides anything about a Site: a pack states which wrapper its tools run, and the
// Site's Permit — not the pack — decides whether that wrapper may run there. `checkPack` asks that
// question of the Permit for every tool before a Campaign starts, using the very function
// `decideLaunch` will use when one does, so a check that says a pack fits cannot disagree with the
// decision that later refuses it.
import { campaignRelativePath } from './paths.js';
import { lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';
import { loadRuleFrom, shippedRulesDir, type Rule } from './rules.js';
import { loadChooserFrom, namesIn, shippedChoosersDir, type Chooser } from './choosers.js';
import { hasEnded, loopOutcome, packReaderFilePath, runIdPattern, verdictOutcome, type PackDataOrigin, type ReaderRef, type RunRecord, type VerdictOutcome } from './ledger.js';
import { dataInReading, dataOnDisk, packDataDirs, readDataFile, type DataPlace } from './pack-data.js';
import { readerNamed } from './readers.js';
import { bundleSemantics, readSemanticsFile, resolveSemantics, semanticsFileName, semanticSlug, semanticsFromText, type Semantics, type SemanticsFile } from './semantics.js';
import { permitsWrapper, refusedWrapper } from './shell.js';
import { licenceName, loadSite, type Site } from './sites.js';
// Type-only, and erased: the shape a face renders a pack's words in is declared beside the rest of
// the run view (`remote.ts`), which the browser bundle reads and this module — which opens
// directories — cannot be reached from.
import type { RunWords } from './remote.js';
// Type-only, and erased: what a knob may be is declared in the leaf module all three faces read it
// from (`run-arguments.ts`), so the browser bundle that renders a knob's field and the routes that
// carry a knob's value share one shape with the schema here that parses it.
import { literalArgument, strategyValue, legacyPeriodGoal, type GoalDeclaration, type StrategyDeclaration, type StrategyKnob } from './run-arguments.js';
import { PackFolderError, PackNotFoundError } from './errors.js';
// The one reading of a pack folder every answer about that folder is derived from (#64), and the
// names and grammars that reading is defined in terms of.
import { packDigestExcludes, packFilePath, packId, pipelineFiles, snapshotPackFolder, snapshotPackFolderIfThere, type PackFolderSnapshot } from './pack-folder.js';
// The seal, which the ladder's top rung and the check both hold a released folder against. The two
// modules name each other — this one climbs the ladder for the release, that one reads the seal for
// the ladder — and neither reads a value of the other's while it is being evaluated: every use is
// inside a function, which is what keeps the pair loadable in either order.
import { releaseIssue } from './release.js';

// Re-exported so a caller of `loadPack` finds the error it can throw right beside it.
export { PackNotFoundError };

/**
 * Where a Campaign's copy of the Site's flow lives inside its workspace. Part of the anatomy rather
 * than of any one pack: a pack's outputs are named relative to the workspace and its tools drive the
 * copy, so there is one place for it and no pack gets to choose another.
 */
export const flowDirName = 'flow';

/**
 * Where a pack reader's script and the file it writes live inside the Campaign workspace (#61): one
 * directory per reader, so a person looking at a workspace sees which reader wrote which file.
 *
 * Part of the workspace anatomy and so declared here beside the flow copy's own directory, rather
 * than in the turn that makes it: since #62 a second thing under the workspace is a directory this
 * harness owns — a workshop's — and a pack declaring its workshop at this name would put the model's
 * own files where a reader's belong. A rule needs one place to be read from, and the module that
 * validates a pack cannot import the module that runs one.
 */
export const readersDirName = 'hima-readers';

/** The file a prepared workspace carries, saying what it is and what was copied into it. */
export const workspaceFileName = 'workspace.json';

/** The files a pack is made of, in the order a person reads them. */
export const packFiles = { spec: 'PACK.md', contract: 'contract.yml', graph: 'graph.yml' } as const;

/** A pack id is a directory name, so it is constrained to a safe shape rather than trusted. */
/** What a binding, an input, an output or a tool's variable may be called. */
const declaredName = z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/, 'a name is a letter followed by letters, digits or underscores');

// ---------------------------------------------------------------------------------------------
// The run contract: what a Site must bind, what a generation produces, and what the pack runs.
// ---------------------------------------------------------------------------------------------

export const contractInput = z.strictObject({ name: declaredName, description: z.string().default('') });

/**
 * A knowledge file is a plain Markdown file name and never a path: a pack states what it carries
 * under its own `knowledge/`, and a name with a directory in it would be a pack reaching outside
 * its own folder for the knowledge it claims to be made of.
 */
const knowledgeFileName = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*\.md$/, 'a knowledge file is a plain Markdown file name under the pack\'s knowledge/, as in `push-method.md`');

/**
 * One knowledge file this pack carries (#57): the file under its own `knowledge/`, and what it is
 * for in the author's own words.
 *
 * The purpose is required and is the whole reason this is a declaration rather than a directory
 * listing: a Model moment is opened for one purpose with the instructions and tools of that purpose
 * only (CONTEXT.md), so what a file is for is what decides whether that moment may read it. The
 * workshop's knowledge tool (#62) reads one for the model on the model's request; the harness itself
 * never reads a knowledge file as data.
 */
export const contractKnowledge = z.strictObject({ file: knowledgeFileName, purpose: z.string().min(1) });
export type ContractKnowledge = z.infer<typeof contractKnowledge>;

/**
 * A reader id, held to the same safe shape a rule id and a chooser id are.
 *
 * Since #57 a reader id is a *file name* — `readers/<id>.yml` in the pack's own folder — so a
 * reference carrying `../` would be a path out of the pack folder that the check would then report
 * as the pack's own. What a pack may name is what a pack folder may hold, and nothing above it.
 */
const readerId = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'a reader id is lowercase letters, digits and dashes');

/** The four values the harness substitutes into a reader's `argv`, each computed by the harness
 *  itself from a path the Permit already decided. Nothing a pack wrote is substituted into one. */
export const readerArgvPlaceholders = ['READER', 'REPORT', 'OUT', 'WORKSPACE'] as const;

/**
 * One word of a reader's command line: either a literal, or exactly one of the four placeholders.
 *
 * A grammar and not a substitution pass, because this is the one string a pack author writes that
 * becomes a command line on somebody else's machine. A literal carries no `$` at all — so nothing in
 * it can be expanded by anything, whatever a later wrapper does with it. Spaces remain part of one
 * argv operand; expansion and control characters are rejected before a reader is launched. A placeholder is the
 * *whole* word, so no value the harness computes is ever pasted into the middle of something else.
 * Every other `${…}` is refused at load naming the word, rather than reaching `substitute` and being
 * refused there as an unbound name, which would be the same refusal one layer too late.
 */
const readerArgvWord = z.string().min(1).superRefine((word, ctx) => {
  const placeholder = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(word);
  if (placeholder !== null) {
    if ((readerArgvPlaceholders as readonly string[]).includes(placeholder[1]!)) return;
    ctx.addIssue({
      code: 'custom',
      message: `the word "${word}" references \${${placeholder[1]!}}, and a reader's argv may reference only ${readerArgvPlaceholders.map((n) => `\${${n}}`).join(', ')}`,
    });
    return;
  }
  if (word.includes('$')) {
    ctx.addIssue({ code: 'custom', message: `the word "${word}" holds a "$", and a literal word of a reader's argv holds none: a whole word is either a literal or one of ${readerArgvPlaceholders.map((n) => `\${${n}}`).join(', ')}` });
    return;
  }
  if (/[`\x00-\x1f\x7f]/.test(word)) {
    ctx.addIssue({ code: 'custom', message: `the word "${word}" holds expansion or control characters, which are not literal data` });
  }
});

/**
 * A reader a pack declares in its own `readers/<id>.yml`: since #61 **a script of the pack's own**,
 * and the command line that runs it.
 *
 * `file` is the script, under the pack's own `tools/` (`packReaderFilePath`, the shape an observation
 * records it in). `argv` is what HimaFabric launches on the Site, held to the grammar above; its
 * first word is the wrapper the Site's Permit decides on, exactly as a tool's is, and is held below
 * to being a **literal** word: pack check reads that word unsubstituted and the launch runs the word
 * it substituted, so a placeholder there would be a pack that checked fit against one thing and ran
 * another. `reportKind` is a word for the record and is never sniffed — a pack script accepts the
 * report its contract pointed it at, and a second opinion about the bytes would be the harness
 * deciding something about a pack's method. `emits` is every value type the script writes, each of
 * which must be declared in the semantics the pack and the bundle resolve to between them, and
 * **exactly** what the script writes: the one validator holds the set produced against this set.
 *
 * Strict, because a hand-written file with a misspelled key is a pack author's mistake and not a
 * field to drop in silence.
 */
export const packReaderDeclaration = z
  .strictObject({
    id: readerId,
    version: z.string(),
    file: packReaderFilePath,
    argv: z.array(readerArgvWord).min(1),
    reportKind: z.string().min(1),
    emits: z.array(semanticSlug).min(1),
  })
  .superRefine((declaration, ctx) => {
    // The wrapper, and a literal one. `checkPack` holds `argv[0]` against the contract's declared
    // wrappers and against the Site's Permit as the word stands in this file; the launch decides on
    // the word after substitution. A placeholder here would make those two different words — a
    // contract could declare `${READER}` as a wrapper and a Permit could allow it, the check would
    // pass, and the launch would then ask the Permit about the absolute path of a shipped script,
    // which no Permit allows. One word, checked and run.
    const head = declaration.argv[0]!;
    if (/^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(head)) {
      ctx.addIssue({
        code: 'custom',
        path: ['argv', 0],
        message: `the first word of a reader's argv is the wrapper itself, a literal word this contract declares and the site's permit allows; "${head}" is a placeholder the harness substitutes`,
      });
    }
  });
export type PackReaderDeclaration = z.infer<typeof packReaderDeclaration>;

/** One thing a generation leaves in its workspace: a path relative to the workspace, and the reader
 *  that makes sense of it when one does. `${input}` in the path is bound from the Site's bindings. */
export const contractOutput = z.strictObject({
  name: declaredName,
  path: z.string().min(1),
  reader: readerId.optional(),
  description: z.string().default(''),
});

/**
 * One tool: the file a person reads and can run by hand, and the command line HimaFabric launches on
 * the Site. `argv` is authoritative — it is what actually runs — and its first word is what the
 * Permit decides on. The script beside it is the same command line written for a person; that the
 * two agree is asserted of the shipped pack by the contract suite, where a reader can see both.
 */
export const packTool = z.strictObject({
  id: packId,
  file: z.string().min(1),
  description: z.string().default(''),
  /** The variables the tool's script reads, and the only names `argv` may reference. */
  inputs: z.array(declaredName).default([]),
  /**
   * How many seats of each licence a Job of this tool holds for as long as it runs — one Design
   * Compiler seat for a synthesis. Declared by the pack because it is a fact about the tool, and
   * held against the Site's own `capacity.licences` by `checkPack`, which is where a pack that could
   * never launch on a Site is said to be unfit.
   *
   * A tool that holds none declares none: the counts here are positive, so "this tool needs no seat"
   * is said by omission rather than by a zero, exactly as every other absent fact in this harness is.
   */
  licences: z.record(licenceName, z.number().int().positive()).default({}),
  argv: z.array(z.string().min(1)).min(1),
});

/**
 * One segment of a path a pack names inside the Campaign workspace: a plain name, never `.`, never
 * `..`, never empty. The grammar `packReaderFilePath` holds a reader's script to, stated once here
 * because a workshop's directory and the entry file inside it are held to the same one.
 */
const workspaceSegment = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Where a workshop's files go, relative to the Campaign workspace (#62): one or more segments of the
 * grammar above.
 *
 * A grammar in the schema and not a check at the node, for the reason a reader's `file` is one: this
 * is a path a pack author writes that becomes a directory on somebody else's machine, and a refusal
 * that arrived at the node would arrive after a workspace, a licence and a synthesis. Absolute paths
 * and every spelling that climbs are refused here, before the Permit is ever asked — which is the
 * first of the two containments, the Permit's write roots being the second.
 */
const workshopDirectory = z.string().min(1).superRefine((value, ctx) => {
  if (value.startsWith('/')) {
    ctx.addIssue({ code: 'custom', message: `the directory "${value}" is absolute, and a workshop's directory is relative to the campaign workspace` });
    return;
  }
  for (const segment of value.split('/')) {
    if (workspaceSegment.test(segment)) continue;
    ctx.addIssue({
      code: 'custom',
      message: `the directory "${value}" names "${segment}", which is not a plain path segment: a workshop's directory is one or more names of letters, digits, dots, dashes and underscores, each beginning with a letter or a digit`,
    });
    return;
  }
});

/** The one file of a workshop the fabric runs: a plain file name, one segment of the same grammar. */
const workshopEntryName = z.string().regex(workspaceSegment, 'a workshop\'s entry is one plain file name, as in `entry.sh`');

/** The word a code record carries for every file of one workshop: a slug the pack invents, which
 *  this harness never reads as anything but a word. */
const languageSlug = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'a language is lowercase letters, digits and dashes');

/**
 * The four values the harness substitutes into **any** act node's command line, tool or workshop:
 * the Campaign's own workspace and the three bindings the Site resolved, each computed by the
 * harness from a path it already decided.
 *
 * A tool *declares* these under its `inputs`, because a tool's `inputs` are the variables its script
 * reads and these four are among them; what no pack may do is *bind* one at a node, which is
 * `validateGraph`'s rule below.
 */
export const harnessArgvValues = ['WORKSPACE', 'FLOW_ROOT', 'DESIGN', 'CAMPAIGN'] as const;

/**
 * The six values the harness substitutes into a workshop's `argv` beyond the arguments the node
 * supplies (#62), each computed by the harness itself from a path it already decided.
 *
 * `ENTRY` and `WORKSHOP` are the Permit-resolved absolute paths of the file that runs and of the
 * directory it was written in; the other four are the Run's own facts, exactly as a tool's command
 * line takes them.
 */
export const workshopArgvValues = ['ENTRY', 'WORKSHOP', ...harnessArgvValues] as const;

/** The names a node's `arguments` may not bind, by what that node opens: the harness is the author
 *  of each of them, and a pack that bound one would substitute its own value under a name every
 *  record of that Job describes as the harness's. */
export const reservedArgumentNames = (opens: 'tool' | 'workshop'): readonly string[] =>
  (opens === 'workshop' ? workshopArgvValues : harnessArgvValues);

/** The reserved names of one kind, as a sentence lists them: `A, B, C and D`. Called with the two
 *  lists above and with nothing else, both of which have more than one name in them. */
const listed = (names: readonly string[]): string => `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]!}`;

/**
 * One workshop: the scope on an act node where the AI writes code and the fabric runs it (#62).
 *
 * Everything a Model moment opened at such a node is composed from, declared by the pack and by
 * nothing else — what to write and why (`purpose`, the pack's own words, which become part of the
 * moment's instructions verbatim), where it may write (`directory`, under the Campaign workspace),
 * what runs (`entry`, and the `argv` that runs it), what it may read (`reads`, the contract's own
 * outputs; `knowledge`, the pack's own files), and what it must produce (`produces`, an output whose
 * reader turns it into an observation).
 *
 * `produces` must name an output that declares a reader, and `validatePack` holds it to that: an
 * output with no reader never becomes an observation, so a workshop that produced one would be a node
 * that wrote a file no Campaign could judge.
 *
 * Strict, because a hand-written declaration with a misspelled key is a pack author's mistake and not
 * a field to drop in silence.
 */
export const packWorkshop = z.strictObject({
  id: packId,
  /** The pack's own words to the model: what to write and why. Verbatim in the instructions. */
  purpose: z.string().min(1),
  directory: workshopDirectory,
  entry: workshopEntryName,
  language: languageSlug,
  /** The argument names the node supplies that `argv` may reference, exactly as a tool's `inputs`. */
  inputs: z.array(declaredName).default([]),
  /** The contract outputs the model may read, by name. */
  reads: z.array(declaredName).default([]),
  /** The files of the contract's `knowledge:` list the model may read, by `file`. */
  knowledge: z.array(knowledgeFileName).default([]),
  /** The contract output the script must write. It must declare a reader. */
  produces: declaredName,
  /** What a Job of this workshop holds of the Site, exactly as a tool's does. */
  licences: z.record(licenceName, z.number().int().positive()).default({}),
  /** The command line, `argv[0]` a literal wrapper the contract declares and the Permit allows. */
  argv: z.array(z.string().min(1)).min(1),
})
  .superRefine((workshop, ctx) => {
    // **The six names are the harness's, and a workshop may not declare one as its own.** `inputs`
    // are the names the *node* supplies; the six below the harness computes for itself from paths it
    // already decided. A declaration listing one of them is a pack asking to be handed a value the
    // harness is the author of — and the node that then bound it would put a word of the pack's
    // choosing where `${ENTRY}` stands, while the `code` record, the read-back and the `launched`
    // block all went on describing the file the harness resolved. Refused here, in the schema, so
    // that the other half of the rule (`validateGraph`, over the node's `arguments`) has nothing left
    // to be lenient about.
    workshop.inputs.forEach((name, at) => {
      if (!workshopArgvValues.includes(name as (typeof workshopArgvValues)[number])) return;
      ctx.addIssue({
        code: 'custom',
        path: ['inputs', at],
        message: `a workshop declares the input "${name}", which the harness binds itself for a workshop: ${listed(workshopArgvValues)} are the harness's own, and a workshop's inputs are the names its node supplies`,
      });
    });

    // The wrapper, and a **literal** word, held exactly where `packReaderDeclaration` holds a
    // reader's and for the same reason. `validatePack` and `checkPack` read `argv[0]` as it stands
    // in this file — against the contract's declared wrappers and against the Site's Permit — and the
    // launch decides on the word after substitution. A placeholder here would make those two
    // different words: a contract could declare `${ENTRY}` as a wrapper and a Permit could allow it,
    // the check would report fit, and the launch would then ask the Permit about the absolute path of
    // a script a model wrote, which no Permit allows. One word, checked and run.
    //
    // The whole word, and not only a word that is nothing but a placeholder: `runner-${ENTRY}` is
    // judged by the check as `runner-${ENTRY}` and launched as `runner-/…/miner.sh`, which are two
    // different wrappers just as surely. Any `${` at all in the first word is the fault.
    const head = workshop.argv[0]!;
    if (head.includes('${')) {
      ctx.addIssue({
        code: 'custom',
        path: ['argv', 0],
        message: `the first word of a workshop's argv is the wrapper itself, a literal word this contract declares and the site's permit allows; "${head}" holds a placeholder the harness substitutes`,
      });
    }

    // **The command line is the wrapper, then the entry as its first operand, then the rest** (#62).
    //
    // Everything else about a workshop's Job is evidence *about the entry*: the `code` record hashes
    // the bytes the model wrote at `<workshop>/<entry>`, the launch re-reads them and must find that
    // same hash, and the `launched` record then carries `workshop.entry` as the claim of what ran.
    // None of that is true of a declaration whose `argv` never names the entry — `[sh, -c, exit 0]`
    // passes every other rule, runs an inline program the ledger holds no record of at all, and is
    // recorded beside the hash of a file nothing executed.
    //
    // A count of one is not enough to say the entry is what the wrapper acts on, which is why this
    // is a rule about **position**: `[sh, -c, exit 0, ${ENTRY}]` names it exactly once and still runs
    // an inline program, with the verified file handed to it as its `$0`. So `argv[1]` is the whole
    // word `${ENTRY}` and no other word references `ENTRY` at all — `sh -c … ${ENTRY}` cannot be
    // declared, and a word that merely contains the placeholder (`--script=${ENTRY}`) is a second
    // reference rather than a second entry. Naming it twice is refused from the same side: the entry
    // would be run with itself as an argument, and a person reading the launch could not say which
    // of the two the Job is.
    //
    // What this buys the launch record is stated where that record is declared (`ledger.ts`): its
    // `workshop.entry` is the file the wrapper was given as its first operand, at the hash it had
    // when the Job was launched. What the wrapper then *does* with its first operand is the Site
    // owner's business, settled when they allowed that wrapper in their Permit.
    const entryWord = '${ENTRY}';
    const saidThe = `a workshop's command line is the wrapper, then the entry as its first operand (argv[1] is exactly ${entryWord}), then the rest`;
    if (workshop.argv[1] !== entryWord) {
      ctx.addIssue({
        code: 'custom',
        path: ['argv', 1],
        message: `${saidThe}; this one's ${workshop.argv.length < 2 ? 'argv has no second word' : `argv[1] is "${workshop.argv[1]!}"`}`,
      });
    }
    // Every other word, `argv[0]` included — the rule above refuses a `${` there in any shape, and
    // this says which `${` it was when the shape is this one.
    const again = workshop.argv.findIndex((word, i) => i !== 1 && word.includes(entryWord));
    if (again !== -1) {
      ctx.addIssue({
        code: 'custom',
        path: ['argv', again],
        message: `${saidThe}; this one also references the entry in argv[${String(again)}] ("${workshop.argv[again]!}")`,
      });
    }
  });
export type PackWorkshop = z.infer<typeof packWorkshop>;

/**
 * What a pack calls one of the values a Run is stated in, and what it is measured in (#42):
 * `declared_parameter: { label: clock period at most, unit: ns }`.
 *
 * The label is required and non-empty. A pack that has nothing to say about a number says nothing
 * about it — the faces then show it under the name the wire carries — and a label with no unit
 * beside it would put a bare number in front of a person on a page whose whole subject is
 * nanoseconds.
 *
 * The unit is optional for one case and `checkPack` holds it to exactly that one (#58): a Strategy
 * knob of type `choice`, whose value is one of the pack's own words and is measured in nothing.
 * Every other name declared here states a unit, because every other name is a number.
 */
export const packWord = z.strictObject({ label: z.string().min(1), unit: z.string().min(1).optional() });
export type PackWord = z.infer<typeof packWord>;

/**
 * One knob of the Strategy a Run of this pack is set to (#58): a number in a unit with bounds, or a
 * choice out of a list, each with the default a Run starts at.
 *
 * What a Strategy is made of is the pack's, not the harness's: the harness owns the two kinds above
 * and validates every value against what is declared here, and that is the whole of what it knows
 * about a knob. The words a person reads it under are declared beside every other word, under
 * `words:`, keyed by the knob's own name.
 *
 * Every field is required, so a knob says all of itself in one place, and the two bounds hold: a
 * `min` above its `max` is a knob nothing could be set to, and a default outside the bounds or
 * outside the list is a Run nobody could start without overriding it.
 */
export const strategyKnob = z
  .discriminatedUnion('type', [
    z.strictObject({
      type: z.literal('number'),
      unit: z.string().min(1),
      min: z.number(),
      max: z.number(),
      default: z.number(),
      precision: z.number().int().min(0).max(15).optional(),
    }),
    z.strictObject({
      type: z.literal('choice'),
      options: z.array(z.string().min(1)).min(1),
      default: z.string().min(1),
    }),
  ])
  .superRefine((knob, ctx) => {
    if (knob.type === 'choice') {
      if (new Set(knob.options).size !== knob.options.length) ctx.addIssue({ code: 'custom', message: 'choice options contain duplicates', path: ['options'] });
      for (const option of knob.options) {
        try { literalArgument(option, 'choice option'); } catch (error) { ctx.addIssue({ code: 'custom', message: (error as Error).message, path: ['options'] }); }
      }
      if (!knob.options.includes(knob.default)) {
        ctx.addIssue({ code: 'custom', message: `default "${knob.default}" is not one of ${knob.options.map((o) => `"${o}"`).join(', ')}`, path: ['default'] });
      }
      return;
    }
    if (knob.min > knob.max) {
      ctx.addIssue({ code: 'custom', message: `min ${String(knob.min)} is above max ${String(knob.max)}`, path: ['min'] });
      return;
    }
    const held = strategyValue('default', knob, knob.default);
    if ('error' in held) ctx.addIssue({ code: 'custom', message: held.error, path: ['default'] });
    if (knob.default < knob.min || knob.default > knob.max) {
      ctx.addIssue({ code: 'custom', message: `default ${String(knob.default)} is outside ${String(knob.min)} through ${String(knob.max)}`, path: ['default'] });
    }
  });

export const packContract = z.strictObject({
  id: packId,
  version: z.string(),
  title: z.string(),
  inputs: z.array(contractInput).min(1),
  outputs: z.array(contractOutput).default([]),
  /** What the Site must let this pack run: every wrapper its tools' command lines begin with. */
  environment: z.strictObject({ wrappers: z.array(z.string().min(1)).default([]) }),
  /** What preparing a Campaign workspace copies out of the bound flow root, into `<workspace>/flow/`. */
  workspace: z.strictObject({ copy: z.array(z.string().min(1)).default([]) }),
  tools: z.array(packTool).default([]),
  /**
   * The workshops of this pack (#62): the scopes where the AI writes code and the fabric runs it,
   * one entry per workshop an act node may name.
   *
   * Empty by default, exactly as `tools` is: a pack whose method needs no code written for it says so
   * by saying nothing. Everything a workshop is is declared here — nothing about one is the
   * harness's, which is what lets the harness know nothing about what gets written.
   */
  workshops: z.array(packWorkshop).default([]),
  rules: z.array(z.string().min(1)).default([]),
  /**
   * The domain knowledge this pack carries (#57), one entry per file under its own `knowledge/`.
   *
   * Empty by default: a pack that carries none says so by saying nothing, exactly as it does of
   * every other absent fact here. Every file declared must be there — `/hima pack check` refuses a
   * pack that promises knowledge its folder does not hold — and the bundle ships no knowledge
   * directory, so the pack's own folder is the only place one is ever looked for.
   */
  knowledge: z.array(contractKnowledge).default([]),
  /**
   * What a Run of this pack is set to for one generation, and what it may be set to (#58): one entry
   * per knob, keyed by the name every face carries that knob under.
   *
   * Required, and at least one knob, because a Strategy is what an Explore node chooses anew
   * (CONTEXT.md) and a pack with nothing to choose has no Loop to run. The harness owns no knob of
   * its own: this block is the whole of what a Strategy is for a Run of this pack, and every value —
   * the start form's, `--set`'s, a request body's — is held against it before the Run starts.
   *
   * The "at least one" is a rule of the schema beside the knob's own two — the bounds hold, and the
   * default is inside them — because a rule of the contract belongs where the contract is read. An
   * empty block that loaded would reach a person as a start form with no field on it, a chooser
   * every clause of which sets a knob nothing declares, and finally the ledger's own row schema
   * refusing a Strategy with nothing in it: a storage error in place of a sentence about the pack.
   */
  goal: z.record(declaredName, strategyKnob.refine((parameter) => parameter.type === 'number', { error: 'Goal parameters must be numbers' })).refine((goal) => Object.keys(goal).length > 0, { error: 'goal declares no parameter' }).optional(),
  strategy: z.record(declaredName, strategyKnob).refine((knobs) => Object.keys(knobs).length > 0, {
    error: 'strategy: declares no knob, and a pack whose Strategy has nothing in it has nothing for an Explore node to choose',
  }),
  /**
   * What this pack's numbers are called, for the faces a person reads (#42): one entry per Goal
   * parameter its graph binds and one per knob a Run's Strategy is made of, keyed by that very name.
   *
   * Declared by the pack because the pack is what knows: `declared_parameter` is a name the harness
   * carries and "clock period at most, in ns" is what it means, and only the method that named it
   * can say so. Optional, and empty by default — a pack that declares none renders under the names,
   * exactly as every pack did before this block existed. A name here that the pack neither takes
   * from the Goal nor sets as a Strategy knob is a label no face could ever reach, and
   * `/hima pack check` refuses it.
   */
  words: z.record(declaredName, packWord).default({}),
});
export type PackContract = z.infer<typeof packContract>;
export type PackTool = z.infer<typeof packTool>;
export type ContractOutput = z.infer<typeof contractOutput>;

// ---------------------------------------------------------------------------------------------
// The graph: four node kinds and outcome-labelled edges, and nothing else (CONTEXT.md).
// ---------------------------------------------------------------------------------------------

/** A value a node takes from the Run rather than from the pack: the current strategy, or the goal. */
export const runReference = z.strictObject({ from: z.enum(['strategy', 'goal']), name: declaredName });
export type RunReference = z.infer<typeof runReference>;

/** What a node parameter may be: a number or a word the pack fixes, or a value the Run supplies. */
export const nodeArgument = z.union([z.number(), z.string(), runReference]);
export type NodeArgument = z.infer<typeof nodeArgument>;

const actNode = z.strictObject({
  id: packId,
  kind: z.literal('act'),
  parameters: z
    .strictObject({
      /** A tool of the contract to run on the Site. */
      tool: packId.optional(),
      /** An output of the contract to read into HimaLedger. */
      observes: declaredName.optional(),
      /** A workshop of the contract to open here (#62): the AI writes a script inside the directory
       *  that workshop declares, and the fabric runs it as a Job like any other. */
      workshop: packId.optional(),
      /** What the Run supplies to that tool or workshop for this generation; the strategy knob and
       *  the like. */
      arguments: z.record(declaredName, nodeArgument).default({}),
    })
    .refine((p) => [p.tool, p.observes, p.workshop].filter((named) => named !== undefined).length === 1, {
      error: 'an act node either runs a tool, observes a contract output, or opens a workshop, and must name exactly one of the three',
    }),
});

const judgeNode = z.strictObject({
  id: packId,
  kind: z.literal('judge'),
  parameters: z.strictObject({
    /** The rules to apply, in order. The outgoing edge is chosen by the outcome of the first. */
    rules: z.array(z.string().min(1)).min(1),
    /** What binds each parameter a rule declares — the Run's goal, for the goal rule. */
    bind: z.record(declaredName, runReference).default({}),
  }),
});

/**
 * When a pack's Loop has stopped learning, in the chooser's own vocabulary (D43).
 *
 * `read` names one of the chooser's `reads`; `band` is a distance in that read's unit; `generations`
 * is how many successive generations must each have moved that measured value by less than the band,
 * from the generation before it, before the exploration is called converged. `generationLimit` is
 * this pack's default for the Budget meter of the same name — how many generations a Campaign of it
 * may open at all — which a person may override at start.
 *
 * Convergence is a fact about measurements, so it is stated here, over the values the ledger holds,
 * and evaluated by the harness: a chooser clause could only say what the pack thinks about *this*
 * generation, and "successive generations stopped moving" is not a thing one generation knows.
 *
 * The whole block is optional, and all four are required inside it: a pack that declares
 * convergence declares what it means by it, and one that declares none has a Loop bounded by the
 * generation limit alone.
 */
export const packConverge = z.strictObject({
  read: declaredName,
  band: z.number(),
  generations: z.number().int().positive(),
  generationLimit: z.number().int().positive(),
});
export type PackConverge = z.infer<typeof packConverge>;

const exploreNode = z.strictObject({
  id: packId,
  kind: z.literal('explore'),
  parameters: z.strictObject({
    /**
     * The chooser to apply, by identity — a file under `choosers/`, exactly as a rule is (D38).
     *
     * Optional because an Explore node has two things it can be: the one that applies a chooser and
     * decides, and the one that opens a Loop of its own and drills down (#28). Exactly one of
     * `chooser` and `opens`, held by `validatePack` rather than by this schema so a pack that names
     * both meets a person as a sentence about their file and not as a parse error.
     */
    chooser: packId.optional(),
    /**
     * The Loop this node opens instead of choosing: the name of one of `graph.loops` (CONTEXT.md,
     * *Explore node* — "drillable into its own small graph"). The fabric runs that graph to its own
     * ending with its own generation counter, and this node's outgoing edges are labelled by the
     * outcome it closed with.
     */
    opens: packId.optional(),
    /**
     * What binds each parameter the chooser declares: the guard band the pack leaves on the table on
     * purpose, and the like. The pack author's numbers, not the chooser's, which is why they are
     * here and not in the chooser file. Spelled as a judge node binds a rule's parameters.
     */
    bind: z.record(declaredName, z.number()).default({}),
    /** When this Loop has stopped learning, and how many generations it may take at most. */
    converge: packConverge.optional(),
  }),
});

const waitNode = z.strictObject({
  id: packId,
  kind: z.literal('wait'),
  parameters: z.strictObject({ blocker: z.string().min(1) }),
});

export const packNode = z.discriminatedUnion('kind', [actNode, judgeNode, exploreNode, waitNode]);
export type PackNode = z.infer<typeof packNode>;

/**
 * An edge, labelled with the outcome it is taken on where a judge chooses between several.
 *
 * `revisit` marks the one edge of a Loop that goes back: it leaves an Explore node, leads to an act
 * node, and following it opens the next Generation with the Strategy the decision chose (D43). It is
 * the only edge a graph may close a cycle with, which is what makes a Loop something a person can
 * see in `graph.yml` rather than something the engine does behind one. Stated by its presence alone
 * — `revisit: false` is not an edge that revisits, it is an ordinary edge spelled at length — so the
 * literal is `true` and an ordinary edge carries no key at all.
 */
export const packEdge = z.strictObject({
  from: packId,
  to: packId,
  /**
   * What this edge is taken on. A judge node's edges carry one of HimaJudge's three verdict
   * outcomes; an Explore node that opens a Loop carries one of the three a Loop can close with
   * (#28). Every other edge carries none, which `validatePack` holds: a label on an edge nothing
   * ever labels is a route a person would read and the engine would never take.
   */
  outcome: z.enum([...verdictOutcome.options, ...loopOutcome.options]).optional(),
  revisit: z.literal(true).optional(),
});
export type PackEdge = z.infer<typeof packEdge>;

/**
 * One Loop an Explore node may open: a graph of its own, with the same four node kinds, its own
 * entry, its own Explore node with its own `converge`, and its own revisit edge (#28).
 *
 * Declared beside the pack's graph rather than inside it because its nodes are not the outer graph's
 * to route between: no edge crosses in or out, and the only way in is an Explore node that names it.
 * Node ids are unique across the whole pack all the same, so a node record, a Job and an attempt all
 * say which node they are about with one id and nothing qualifying it.
 *
 * One level: a Loop's own Explore node applies a chooser and may not open a second Loop (spec,
 * *Out of Scope*).
 */
export const packLoop = z.strictObject({
  entry: packId,
  nodes: z.array(packNode).min(1),
  edges: z.array(packEdge).default([]),
});
export type PackLoop = z.infer<typeof packLoop>;

export const packGraph = z.strictObject({
  id: packId,
  version: z.string(),
  entry: packId,
  nodes: z.array(packNode).min(1),
  edges: z.array(packEdge).default([]),
  /** The Loops this pack's Explore nodes may open, by name. A pack that drills nowhere declares none. */
  loops: z.record(packId, packLoop).default({}),
});
export type PackGraph = z.infer<typeof packGraph>;

/**
 * What HimaFabric actually runs a Run through: an entry, some nodes, and the edges between them. The
 * pack's own graph and each of its Loops are both one of these, which is what lets `drive` run a
 * Loop with the code that runs a graph rather than with a second engine beside it.
 */
export interface RunGraph {
  readonly entry: string;
  readonly nodes: readonly PackNode[];
  readonly edges: readonly PackEdge[];
}

/** One pack as it was read off disk: where it is, and the two files that say what it does. */
export interface Pack {
  readonly id: string;
  readonly dir: string;
  readonly contract: PackContract;
  readonly graph: PackGraph;
  /**
   * **The one reading of the folder this pack was parsed out of** (#64).
   *
   * On the pack itself, and not beside it, because everything a *check* says about a pack is a
   * statement about the folder that pack came from, and a check handed a pack and a folder
   * separately is two readings waiting to happen. A caller holding a `Pack` therefore cannot ask
   * about its folder at any instant but the one the contract and the graph above were parsed at.
   *
   * What a *running node* reads is deliberately not this: `packDataAt` below says which is which.
   */
  readonly folder: PackFolderSnapshot;
  /**
   * Where a rule id this pack names resolves from, in order: its own `rules/` first, the bundle's
   * second (#57). Computed by `loadPack`, so every caller that resolves a rule for a Run resolves it
   * the one way — the run row names the pack, and `loadPack` is how a Run's pack is known.
   */
  readonly ruleDirs: readonly string[];
  /** Where a chooser id this pack names resolves from, in order, for the reason above. */
  readonly chooserDirs: readonly string[];
}

/**
 * **Which instant a pack's own data files are read at** (#64).
 *
 * Said at every call rather than defaulted, because the two are both right and for opposite
 * reasons, and a caller that inherited one would be silently making the other's claim:
 *
 * - `'the reading'` — out of `pack.folder`, the one reading the pack was parsed from. What the
 *   **check** uses, for every pack-local file it touches: a check is one statement about one folder
 *   at one instant, and a check that reported a rule the folder no longer holds would be describing
 *   a pack nobody can look up afterwards.
 * - `'as it stands'` — off the disk when the question is asked. What a **running node** uses (D46):
 *   a pack edited between two generations means the correction, so a rule, a chooser, a reader
 *   declaration and the semantics are read as that generation runs, and pinning them to the start of
 *   the Campaign would make a corrected rule take effect only on the next one.
 *
 * The bundle's own files are read by path either way: the bundle is not the folder, and no reading
 * of it exists.
 */
export type PackDataAt = 'the reading' | 'as it stands';

/** The pack's own copy of one of its data folders, as the given instant answers for it. */
const ownPlace = (pack: Pack, under: string, at: PackDataAt): DataPlace =>
  at === 'the reading'
    ? dataInReading(pack.dir, under, pack.folder)
    : dataOnDisk(path.join(pack.dir, under));

/**
 * The ordered places one of `dirs` resolves through at the given instant: the pack's own folder
 * first, the bundle's second.
 *
 * The ordered list itself is still `loadPack`'s, computed once and carried on the pack, so what this
 * chooses is only where the first place's bytes come from. The bundle's places are read off the disk
 * whichever instant is asked for.
 */
const placesFor = (pack: Pack, dirs: readonly string[], under: string, at: PackDataAt): DataPlace[] =>
  [ownPlace(pack, under, at), ...dirs.slice(1).map(dataOnDisk)];

/** Where this pack's own reader declarations are, when it carries any (#57). The bundle answers with
 *  a registry rather than a directory, which is why this is one place and not a list. */
export const packReadersDir = (pack: Pack): string => path.join(pack.dir, packDataDirs.readers);

/** The one folder of a pack that holds what it runs: the tool scripts a contract names, and since
 *  #61 the reader scripts its declarations name. Not one of `packDataDirs` — those four hold data
 *  the harness reads, and this one holds code the Site runs. */
const packToolsDir = 'tools';

/** Where this pack's own knowledge files are. The bundle ships no knowledge directory at all, so
 *  this is the only place one is ever looked for. */
export const packKnowledgeDir = (pack: Pack): string => path.join(pack.dir, packDataDirs.knowledge);

/** Where this pack declares the value types its own readers emit (#61), beside its `contract.yml`. */
export const packSemanticsFile = (pack: Pack): string => path.join(pack.dir, semanticsFileName);

/**
 * **The value types in force for a Run of this pack** (#61): its own `semantics.yml` first, the
 * bundle's second, and a type declared in both resolves to the pack's.
 *
 * The same order, and for the same reason, that `readDataFile` resolves a rule or a chooser in (#57):
 * a method is the pack's, and the harness supplies only what every pack of this kind would otherwise
 * write twice. Computed here rather than carried on the `Pack` because it is read at two different
 * instants, and `at` is which (#64): a **check** reads the pack's own file out of the one reading it
 * is being made from, and a **running node** reads it as it now stands, because a pack edited
 * between two generations means the correction (D46). The bundle's file is read by path either way.
 *
 * @param pack - the pack.
 * @param at - which instant the pack's own file is read at.
 * @returns every declared value type, by name.
 * @throws naming the file, when the pack's own is there and cannot be read or does not parse. Only
 *         `ENOENT` is a pack that declares none of its own; a file nobody can open is not one.
 */
export function semanticsOf(pack: Pack, at: PackDataAt): Semantics {
  return resolveSemantics([packOwnSemantics(pack, at), bundleSemantics()]);
}

/**
 * The pack's **own** `semantics.yml`, at the given instant, or undefined when it declares none
 * (#61, #64).
 *
 * Apart from `semanticsOf` because the check asks both questions and they are different: what is in
 * force is the pack's over the bundle's, and what the pack itself declares is what its own readers
 * are held to produce.
 *
 * Fails closed on everything but absence, exactly as reading it off the disk does: a file the
 * reading refused is a folder that was refused whole, and a file the disk cannot open throws naming
 * it. A pack that declares a vocabulary nobody can read has not thereby chosen the bundle's.
 */
function packOwnSemantics(pack: Pack, at: PackDataAt): SemanticsFile | undefined {
  if (at === 'as it stands') return readSemanticsFile(packSemanticsFile(pack));
  const text = pack.folder.text(semanticsFileName);
  if (text !== undefined) return semanticsFromText(text, packSemanticsFile(pack));
  // A *directory* standing at `semantics.yml` is `EISDIR` off the disk and is not a pack that
  // declares no value types of its own: answering absence would hold the whole Campaign to the
  // bundle's vocabulary while the pack's own path said something else nobody could read.
  if (pack.folder.directories.has(semanticsFileName)) {
    throw new Error(`cannot read the semantics file ${packSemanticsFile(pack)}: a directory stands there`);
  }
  return undefined;
}

/** What looking for a pack's own declaration of a reader id found (#61). */
export type PackReaderLookup =
  /** The pack declares this reader itself, and the declaration reads as one. */
  | { readonly kind: 'declared'; readonly declaration: PackReaderDeclaration; readonly at: string }
  /** The pack's own `readers/` holds no such file, so a bundled reader of that id is the answer. */
  | { readonly kind: 'absent' }
  /** There is a file and it is not a reader declaration. Never an absence: a pack that shadowed a
   *  bundled id with a file nobody can parse has not thereby chosen the bundle's reader. */
  | { readonly kind: 'broken'; readonly at: string; readonly reason: string };

/**
 * The pack's own declaration of a reader id, if it has one.
 *
 * Through the same `readDataFile` a rule and a chooser resolve through, so only `ENOENT` is absence
 * and a `readers` that is a plain file, or one this process may not read, throws naming the path
 * rather than falling quietly to the registry — which would run a bundled reader under a pack's name
 * and call that a pass.
 *
 * @param pack - the pack.
 * @param id - the reader id one of its outputs names.
 * @param at - which instant the declaration is read at: the check's one reading, or the disk as a
 *             node runs (#64).
 * @throws when the declaration file is there and cannot be read at all.
 */
export function resolvePackReader(pack: Pack, id: string, at: PackDataAt): PackReaderLookup {
  const found = readDataFile(id, [ownPlace(pack, packDataDirs.readers, at)]);
  if (!found.ok) return { kind: 'absent' };
  // The parse first, and its own failure wrapped: the YAML parser says the line and the column and
  // nothing about which file it was reading, and a pack folder holds a contract, a graph, rules,
  // choosers and readers. A syntax error that escaped from here would reach a person as a sentence
  // about a line number in a pack of a dozen files, and never as a `broken` reader at all — which is
  // the kind a bundled reader of the same id must not quietly answer for.
  let document: unknown;
  try {
    document = parse(found.text);
  } catch (err) {
    return { kind: 'broken', at: found.at, reason: `it is not YAML: ${(err as Error).message}` };
  }
  const parsed = packReaderDeclaration.safeParse(document);
  if (!parsed.success) {
    const wrong = parsed.error.issues.map((i) => `${i.path.join('.') || '<the file itself>'}: ${i.message}`).join('; ');
    return { kind: 'broken', at: found.at, reason: `it does not read as a reader declaration: ${wrong}` };
  }
  if (parsed.data.id !== id) return { kind: 'broken', at: found.at, reason: `it declares id "${parsed.data.id}", not "${id}"` };
  return { kind: 'declared', declaration: parsed.data, at: found.at };
}

/** Where a pack reader's script is on this machine, or why it is not something this harness will
 *  ship and run. */
export type PackReaderScript =
  | { readonly ok: true; readonly at: string }
  | { readonly ok: false; readonly reason: string };

/** Is one resolved path inside another resolved directory? Both are already `realpath`ed, so this is
 *  a string question and not a filesystem one. */
const within = (what: string, dir: string): boolean =>
  what === dir || what.startsWith(dir.endsWith(path.sep) ? dir : dir + path.sep);

/**
 * **Resolve a pack reader's script inside the pack's own tools folder, and refuse anything that
 * leaves it.**
 *
 * The declaration's `file` has already been held to a shape that begins `tools/`, has no `..` in it
 * and is not absolute. That is not containment: `tools` could itself be a symlink to somewhere else
 * on the machine, and every segment but the last is followed when the file is opened. So all three
 * are resolved for real — the file, the tools folder and the pack folder — and each has to be inside
 * the next. A `tools` that is a link out of the pack passes every name check there is and holds
 * scripts that are not the pack's, which is the whole of what the second question is for.
 *
 * A plain file, too, and asked with `lstat`: the entry itself must be the script, not a symlink
 * pointing at one. A pack folder is the thing a customer installs and reviews as a whole, and a
 * reader that ran bytes from outside it would be a pack shipping something nobody read.
 *
 * **At `'the reading'` there is nothing left to resolve** (#64): the walk that produced it `lstat`ed
 * every entry, refused the whole folder naming the path for anything that was not a plain file or a
 * directory, held every directory to one inode across reading its names, and opened every file with
 * `O_NOFOLLOW`. So a path the reading holds is a plain file of this folder reached through this
 * folder's own real directories — which is what the three `realpath`s below are for — and the
 * question collapses to whether the reading holds it.
 *
 * @param pack - the pack.
 * @param file - the declaration's `file`.
 * @param at - which instant the folder is asked about.
 * @returns where the script is, or why it is not the pack's own plain file under its own tools/. At
 *          `'the reading'` the path is the folder's own spelling, there being no link in it to
 *          resolve; at `'as it stands'` it is the resolved path the bytes are then read from.
 */
export function packReaderScript(pack: Pack, file: string, at: PackDataAt): PackReaderScript {
  return at === 'the reading' ? scriptInReading(pack, file) : scriptAsItStands(pack, file);
}

/** The script as the one reading of the folder answers for it: held, a directory standing where it
 *  should be, or not in this folder at all. */
function scriptInReading(pack: Pack, file: string): PackReaderScript {
  const at = path.join(pack.dir, file);
  if (pack.folder.files.has(file)) return { ok: true, at };
  if (pack.folder.directories.has(file)) {
    return { ok: false, reason: `${at} is not a plain file (a symlink, a directory or the like), and a pack reader runs the pack folder's own bytes` };
  }
  return { ok: false, reason: `there is no file at ${at}` };
}

/** The script as the folder stands now: what a node about to ship it asks, because the bytes it is
 *  going to read are the bytes that are there. */
function scriptAsItStands(pack: Pack, file: string): PackReaderScript {
  const at = path.resolve(pack.dir, file);
  const toolsAt = path.join(pack.dir, packToolsDir);
  const there = lstatSync(at, { throwIfNoEntry: false });
  if (there === undefined) return { ok: false, reason: `there is no file at ${at}` };
  if (!there.isFile()) {
    return { ok: false, reason: `${at} is not a plain file (a symlink, a directory or the like), and a pack reader runs the pack folder's own bytes` };
  }
  let realFile: string;
  let realTools: string;
  let realDir: string;
  try {
    realFile = realpathSync(at);
    realTools = realpathSync(toolsAt);
    realDir = realpathSync(pack.dir);
  } catch (err) {
    return { ok: false, reason: `cannot resolve ${at} inside ${toolsAt}: ${(err as Error).message}` };
  }
  if (!within(realTools, realDir)) {
    return { ok: false, reason: `${toolsAt} resolves to ${realTools}, which is outside the pack folder ${realDir}` };
  }
  if (!within(realFile, realTools)) {
    return { ok: false, reason: `${at} resolves to ${realFile}, which is outside the pack's tools folder ${realTools}` };
  }
  return { ok: true, at: realFile };
}

/**
 * Which of the two places an id a pack names resolved from (#57).
 *
 * Decided by comparing the directory the **lookup won in** against the first of the ordered list,
 * which is the pack's own folder by construction. Not by looking the file up a second time: between
 * the read and a second look a file can appear, disappear or stop opening, and the two answers would
 * then disagree — a check reporting one file while the Campaign ran another. There is one lookup,
 * and its own answer is the origin.
 *
 * Private, because the only honest way to obtain one is out of a resolution: `resolveRule` and
 * `resolveChooser` are what callers use, and neither lets an origin be computed apart from the load
 * that produced it.
 *
 * @param dirs - the pack's ordered list, `ruleDirs` or `chooserDirs`.
 * @param from - the directory the file was actually read from.
 */
function originOf(dirs: readonly string[], from: string): PackDataOrigin {
  return from === dirs[0] ? 'pack' : 'bundle';
}

/** One rule resolved through a pack, with the origin the resolution itself answered (#57). */
export interface ResolvedRule {
  readonly rule: Rule;
  readonly origin: PackDataOrigin;
}

/** One chooser resolved through a pack, with the origin the resolution itself answered (#57). */
export interface ResolvedChooser {
  readonly chooser: Chooser;
  readonly origin: PackDataOrigin;
}

/**
 * Resolve a rule id **through this pack**: its own `rules/` first, the bundle's second, and which of
 * the two answered.
 *
 * The one way either fact is obtained anywhere in this harness — the check that reports an origin,
 * the judge that applies the rule — so no two callers can come to disagree about which file a
 * Campaign ran on. Throws what `loadRuleFrom` throws: a rule the harness cannot produce is an error,
 * never a silent pass.
 *
 * @param at - which instant the pack's own `rules/` is read at (#64): `'the reading'` for a check,
 *             which is one statement about one folder; `'as it stands'` for a node that runs, because
 *             a pack edited between two generations means the correction (D46). `packDataAt` says
 *             why neither may be the default.
 */
export function resolveRule(pack: Pack, ref: string, at: PackDataAt): ResolvedRule {
  const found = loadRuleFrom(ref, placesFor(pack, pack.ruleDirs, packDataDirs.rules, at));
  return { rule: found.rule, origin: originOf(pack.ruleDirs, found.dir) };
}

/** Resolve a chooser id through this pack, with its origin, for the reason `resolveRule` states. */
export function resolveChooser(pack: Pack, ref: string, at: PackDataAt): ResolvedChooser {
  const found = loadChooserFrom(ref, placesFor(pack, pack.chooserDirs, packDataDirs.choosers, at));
  return { chooser: found.chooser, origin: originOf(pack.chooserDirs, found.dir) };
}

/** Every graph a pack holds: its own first, then each Loop with the name it is declared under. */
export const graphsOf = (pack: Pack): { readonly loop: string | undefined; readonly graph: RunGraph }[] => [
  { loop: undefined, graph: pack.graph },
  ...Object.entries(pack.graph.loops).map(([loop, graph]) => ({ loop, graph })),
];

/**
 * Where one node of a pack stands: the node itself, the graph it belongs to, and the Loop that graph
 * is, if it is one.
 *
 * The single lookup every caller uses, because a Run's `currentNode` is one id and node ids are
 * unique across a pack: the driver finds the node to run and the graph to route it in, a
 * reconciliation finds the node an interrupted Job belongs to, and a cancel finds the node to settle
 * — all with one answer, so none of them can come to disagree about which graph a node is in.
 *
 * @param pack - the pack the Run runs.
 * @param nodeId - the node, as the run row or a record names it.
 * @returns the node and its graph, or undefined when this pack has no such node.
 */
export function positionOf(pack: Pack, nodeId: string | undefined): { node: PackNode; graph: RunGraph; loop: string | undefined } | undefined {
  if (nodeId === undefined) return undefined;
  for (const { loop, graph } of graphsOf(pack)) {
    const node = graph.nodes.find((n) => n.id === nodeId);
    if (node) return { node, graph, loop };
  }
  return undefined;
}

/**
 * Every Goal parameter this pack binds: the names its graph takes `{ from: goal }`, in a judge
 * node's `bind` or an act node's `arguments`, across its own graph and every Loop it drills into.
 *
 * A Campaign's Goal is a map the *Run* supplies, so nothing about it is fixed by the harness — where
 * a pack says which of its numbers it reads is these references, and this is the one reading of
 * them, so a pack's declared words and the values its nodes are handed are held against one list.
 *
 * @param pack - the pack.
 * @returns the parameter names, without duplicates, in the order the graph first references them.
 */
export function goalParametersOf(pack: Pack): string[] {
  const found = new Set<string>();
  for (const { graph } of graphsOf(pack)) {
    for (const node of graph.nodes) {
      const references = node.kind === 'judge'
        ? Object.values(node.parameters.bind)
        : node.kind === 'act'
          ? Object.values(node.parameters.arguments).filter((a): a is RunReference => typeof a === 'object')
          : [];
      for (const reference of references) if (reference.from === 'goal') found.add(reference.name);
    }
  }
  return [...found];
}

/**
 * The knobs a Run of this pack's Strategy is made of: the pack's own, declared in its contract
 * (#58), in the order it declares them — which is the order its start form shows them in.
 *
 * A pack chooses which Goal parameters it reads, and it chooses what a Strategy is. Every Run
 * HimaFabric starts carries every one of these on its row and every face renders them, whether or
 * not any node of that pack happens to reference one — so a word for a knob is a word a person will
 * read, and a graph that never names the knob does not make it unreachable.
 */
export const strategyKnobsOf = (pack: Pack): string[] => Object.keys(pack.contract.strategy);

/** Old contracts obtained numeric Goal names from graph references. Keep that mapping readable. */
export function goalDeclarationOf(pack: Pack): GoalDeclaration {
  if (pack.contract.goal !== undefined) return pack.contract.goal as GoalDeclaration;
  const names = goalParametersOf(pack);
  return Object.fromEntries((names.length ? names : [legacyPeriodGoal.name]).map((name) => [name,
    name === legacyPeriodGoal.name ? legacyPeriodGoal.parameter : {
      type: 'number' as const, unit: pack.contract.words[name]?.unit ?? 'unspecified',
      min: -Number.MAX_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER, default: 0,
    },
  ]));
}


/**
 * What this pack calls the numbers a Run of it is stated in, filed by where each number comes from:
 * what the run view carries and every face renders (#42).
 *
 * Undefined — never an empty pair of maps — when the pack has nothing to say about any number a face
 * could look up, so a face has one question to ask and one fallback to take: the names, as before
 * this existed. A word declared for anything else is filed nowhere, which is the state `checkPack`
 * refuses; it is not this function's business to raise, because a card is not the place a pack
 * author is told their file is wrong.
 *
 * @param pack - the pack the Run runs.
 * @returns the words, or undefined when the pack declares none that reach a number.
 */
export function packWords(pack: Pack): RunWords | undefined {
  const declared = Object.entries(pack.contract.words);
  if (declared.length === 0) return undefined;
  const filed = (names: readonly string[]): Record<string, PackWord> =>
    Object.fromEntries(declared.filter(([name]) => names.includes(name)));
  const words = { goal: filed(goalParametersOf(pack)), strategy: filed(strategyKnobsOf(pack)) };
  return Object.keys(words.goal).length + Object.keys(words.strategy).length === 0 ? undefined : words;
}

/**
 * The words the pack a Run names declares, read off the installed packs directory — what the host
 * hands the run view for every Run it answers with (#42).
 *
 * Every way of not finding them answers undefined, including a pack that no longer loads: a Run
 * whose pack has since been uninstalled, renamed, or edited into something that does not hang
 * together still has a card, and that card shows the names HimaLedger itself holds. A page that
 * would not render because a directory moved is a worse answer than the names, and *why* a pack
 * cannot be loaded is what `/hima pack check` says at length — not something to raise from a render
 * that happens once a second.
 *
 * @param packsDir - the directory holding one directory per installed pack.
 * @param id - the pack the Run names, or undefined for a Probe-campaign Run, which names none.
 * @returns the words, or undefined when there are none to be had.
 */
export function installedPackWords(packsDir: string, id: string | undefined): RunWords | undefined {
  if (id === undefined) return undefined;
  try {
    return packWords(loadPack(packsDir, id));
  } catch {
    return undefined;
  }
}

/**
 * The knobs the pack a Run names declares, read off the installed packs directory — what the start
 * form renders one field per, and what the harness holds a start's values against (#58).
 *
 * Every way of not finding them answers undefined, for the reason `installedPackWords` does: a pack
 * that no longer loads still has a page, and *why* it cannot be loaded is what `/hima pack check`
 * says at length. A form with no knob fields is a form that starts a Run at the pack's own defaults,
 * and the start itself refuses what it cannot read.
 *
 * @param packsDir - the directory holding one directory per installed pack.
 * @param id - the pack, or undefined for a Probe-campaign Run, which names none.
 * @returns the declaration, or undefined when there is none to be had.
 */
export function installedPackStrategy(packsDir: string, id: string | undefined): StrategyDeclaration | undefined {
  if (id === undefined) return undefined;
  try {
    return loadPack(packsDir, id).contract.strategy;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------------------------
// Placeholders: `${name}` in a contract path or a tool's argv.
// ---------------------------------------------------------------------------------------------

const placeholder = /\$\{([A-Za-z][A-Za-z0-9_]*)\}/g;

/** Every `${name}` a string references, in order, without duplicates. */
export function placeholdersIn(text: string): string[] {
  return [...new Set([...text.matchAll(placeholder)].map((m) => m[1]!))];
}

/**
 * `text` with every `${name}` replaced by the value bound to it.
 *
 * @throws when a placeholder has no value. A pack whose paths and argv reference only declared names
 *         is checked at load, so reaching this means a caller passed an incomplete map — never a
 *         reason to substitute an empty string and write to a path nobody meant.
 */
export function substitute(text: string, values: Readonly<Record<string, string>>, what: string): string {
  return text.replace(placeholder, (_all, name: string) => {
    // Bound means the map's own property: a name the map only inherits — `toString`, `constructor`
    // — is not a value anybody bound, and reading it through the prototype chain would resolve the
    // placeholder to the text of a function instead of refusing.
    const value = Object.hasOwn(values, name) ? values[name] : undefined;
    if (value === undefined) throw new Error(`${what} references \${${name}}, which nothing bound`);
    return literalArgument(value, `${what} value ${name}`);
  });
}

/** A tool's command line with its inputs bound: what HimaFabric launches, and what the Permit decides. */
export function toolArgv(tool: PackTool, values: Readonly<Record<string, string>>): string[] {
  literalArgument(tool.argv[0]!, `tool "${tool.id}" wrapper`);
  return tool.argv.map((word) => literalArgument(substitute(word, values, `tool "${tool.id}"`), `tool "${tool.id}" argument`));
}

/** Where one of the contract's outputs is, relative to the Campaign workspace. */
/**
 * One workshop's command line, with every value substituted (#62): the arguments the node supplied
 * and the six the harness computes, and nothing a pack wrote beyond the literal words of its own
 * declaration.
 *
 * `toolArgv`'s twin, and deliberately its twin rather than its caller: the two take different
 * declarations and name different things in their refusals, and a shared function over a structural
 * `{ id, argv }` would say "tool" about a workshop or say neither about both.
 */
export function workshopArgv(workshop: PackWorkshop, values: Readonly<Record<string, string>>): string[] {
  literalArgument(workshop.argv[0]!, `workshop "${workshop.id}" wrapper`);
  return workshop.argv.map((word) => literalArgument(substitute(word, values, `workshop "${workshop.id}"`), `workshop "${workshop.id}" argument`));
}

export function outputPath(output: ContractOutput, bindings: Readonly<Record<string, string>>): string {
  return campaignRelativePath(literalArgument(substitute(output.path, bindings, `output "${output.name}"`), `output "${output.name}"`), `output "${output.name}"`);
}

// ---------------------------------------------------------------------------------------------
// Loading.
// ---------------------------------------------------------------------------------------------

/**
 * The folder a pack id names, held to being a plain directory under the packs directory (#64).
 *
 * One place, because every reader of a pack folder — the loader, the ladder, the digest, the seal —
 * has to mean the same thing by "the folder". A **link** named with a valid pack id is the whole
 * reason: followed, its contract, graph, rules, choosers and scripts are files nobody installed
 * here, lying wherever the link points, and they would be checked as this host's and run as this
 * host's. `lstat` and not `stat`, so what is asked is what stands there rather than what it leads to.
 *
 * A path that is simply not there is left to the caller: absence and a folder that cannot be one are
 * different answers, and the loader and the ladder say each of them in their own words.
 *
 * @param packsDir - the directory holding one directory per installed pack.
 * @param id - the pack id, which is the folder's name; a pack id already, by every caller.
 * @returns the folder's path, which is a directory or is not there at all.
 * @throws naming the path, when something that is not a directory stands there.
 */
function packFolderAt(packsDir: string, id: string): string {
  const dir = path.join(packsDir, id);
  const there = lstatSync(dir, { throwIfNoEntry: false });
  if (there !== undefined && !there.isDirectory()) {
    // A `PackNotFoundError`, because this is a fact about what somebody installed under that name
    // and not a fault of this harness: every face that names a pack already answers one of these in
    // words, and a person told which path is in the way can move it.
    throw new PackNotFoundError(`${dir} is not a directory: a pack folder is a plain directory under the packs directory`);
  }
  return dir;
}

/**
 * Load `<packsDir>/<id>/` and validate it against itself: the two YAML files, and every reference one
 * makes to the other. Throws `PackNotFoundError` when there is no such pack, and a plain `Error` when
 * there is one and it does not hang together — the same split `loadSite` makes between a site nobody
 * installed and a site file somebody wrote wrong.
 *
 * What is checked here is what a pack can be wrong about on its own. Whether a *Site* can host it —
 * bindings, wrappers, rules, readers — is `checkPack`, because those answers depend on the Site.
 */
export function loadPack(packsDir: string, id: string): Pack {
  const folder = installedPackFolder(packsDir, id);
  if (folder === undefined) {
    throw new PackNotFoundError(`unknown pack "${id}": no ${packFiles.contract} at ${path.join(packsDir, id, packFiles.contract)}`);
  }
  return loadPackFrom(folder);
}

/**
 * The same pack, parsed out of **one reading of its folder** (#64).
 *
 * Where every load inside this bundle goes, because a pack object and the digest of the folder it
 * came from have to be about the same bytes: a Run that parsed its graph from one reading and
 * recorded the digest of another would be driven by a pack nobody can look up afterwards. The
 * contract and the graph are parsed from the bytes in hand, and nothing here opens a path.
 *
 * The reading is carried **on** the pack (`pack.folder`), so that a caller holding a pack cannot ask
 * about its folder at any other instant. What the pack goes on to resolve as a Campaign runs — its
 * rules, its choosers, its readers, its semantics — is a different question and is asked at a
 * different instant: `packDataAt` says which, and each call site says which it wants. A pack edited
 * between two generations means the correction (D46), so those are read as the node runs and are a
 * statement about that generation and not about the folder as it stood when the Campaign started.
 *
 * @param folder - the reading.
 * @returns the pack, validated against itself.
 * @throws {PackNotFoundError} when the folder holds no contract, or is named something no pack can
 *         be; a plain Error when the pack does not hang together.
 */
export function loadPackFrom(folder: PackFolderSnapshot): Pack {
  const dir = folder.dir;
  const id = path.basename(dir);
  if (!packId.safeParse(id).success) throw new PackNotFoundError(`invalid pack id "${id}"; a pack id is lowercase letters, digits and dashes`);
  const contractText = folder.text(packFiles.contract);
  if (contractText === undefined) {
    throw new PackNotFoundError(`unknown pack "${id}": no ${packFiles.contract} at ${path.join(dir, packFiles.contract)}`);
  }
  const graphText = folder.text(packFiles.graph);
  if (graphText === undefined) throw new Error(`pack ${id} has a ${packFiles.contract} but no ${packFiles.graph} beside it`);
  const contract = packContract.parse(parse(contractText));
  const graph = packGraph.parse(parse(graphText));
  // Where the ids this pack names resolve from, computed once and carried on the pack (#57): its own
  // folder first, the bundle's second. Every caller that resolves a rule or a chooser at run time
  // takes these lists off the pack, so no two of them can come to disagree about which file a
  // Campaign ran on.
  const pack: Pack = {
    id,
    dir,
    contract,
    graph,
    folder,
    ruleDirs: [path.join(dir, packDataDirs.rules), shippedRulesDir],
    chooserDirs: [path.join(dir, packDataDirs.choosers), shippedChoosersDir],
  };
  validatePack(folder, pack);
  return pack;
}

/**
 * Every pack installed here, by id, in the order a person reads a list: what the workbench's start
 * form offers, so nobody has to know a pack id by heart to start a Campaign (#26).
 *
 * A directory holding a `contract.yml` is a pack; anything else under `packsDir` is not one and is
 * passed over in silence, because a stray file beside the installed packs is not this list's business
 * and a form that refused to render because of one would be a worse answer than a shorter list. The
 * pack is not loaded: the form offers a name to choose, and whether that pack hangs together and fits
 * the Site is what starting a Run answers, in the words `/hima pack check` uses.
 *
 * **Only `ENOENT` is absence, on the directory and on each `contract.yml` in it.** A packs directory
 * this process may not read, a name with an ordinary file under it where a pack folder would be
 * (`ENOTDIR`), and a contract that is there and cannot be stat'd are all faults: a list that
 * answered "no packs installed" for any of them would offer a person an empty start form and no
 * reason for it, which is the one failure a form cannot recover from by itself. The contract is
 * `lstat`ed, so a link standing where a pack's contract should be does not make a folder a pack.
 *
 * @param packsDir - the directory holding one directory per installed pack.
 * @returns the pack ids, sorted; empty when there is no such directory at all.
 * @throws naming the packs directory when it is there and cannot be read, naming the path when
 *         something that is not a directory stands under a pack id, and naming a folder's contract
 *         when that is there and cannot be asked about.
 */
export function installedPacks(packsDir: string): string[] {
  let names: string[];
  try {
    names = readdirSync(packsDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw new Error(`the installed packs directory ${packsDir} cannot be read: ${(err as Error).message}`);
  }
  const holdsAContract = (name: string): boolean => {
    const at = path.join(packsDir, name, packFiles.contract);
    let what;
    try {
      what = lstatSync(at, { throwIfNoEntry: false });
    } catch (err) {
      // **`ENOTDIR` is not absence.** Something that is not a directory stands where a pack folder
      // would be, under a name that is a perfectly good pack id — and a list that answered "then
      // there is no pack of that name" would leave a person looking at a start form their pack is
      // missing from, with nothing anywhere saying why. Said in the sentence `packFolderAt` says,
      // because it is the same fault met a moment earlier.
      if ((err as NodeJS.ErrnoException).code === 'ENOTDIR') {
        throw new Error(`${path.join(packsDir, name)} is not a directory: a pack folder is a plain directory under the packs directory`);
      }
      throw new Error(`${at} is there and cannot be asked about: ${(err as Error).message}`);
    }
    return what !== undefined && what.isFile();
  };
  return names.filter((name) => packId.safeParse(name).success && holdsAContract(name)).sort();
}

/** Every way a pack can contradict itself. Each one throws naming the file a person must edit.
 *  Asked of the one reading the pack was parsed out of, so that what the contract declares and what
 *  the folder holds are two facts about the same instant. */
function validatePack(folder: PackFolderSnapshot, pack: Pack): void {
  const { id, contract, graph } = pack;
  const broken = (file: string, why: string): never => { throw new Error(`pack ${id}: ${file} ${why}`); };
  if (contract.id !== id) broken(packFiles.contract, `declares id "${contract.id}", but it is installed as "${id}"`);
  if (graph.id !== id) broken(packFiles.graph, `declares id "${graph.id}", not "${id}"`);
  if (graph.version !== contract.version) broken(packFiles.graph, `is version ${graph.version} while ${packFiles.contract} is version ${contract.version}`);

  if (contract.goal !== undefined) {
    const used = goalParametersOf(pack);
    for (const name of used) if (!Object.hasOwn(contract.goal, name)) broken(packFiles.graph, `references undeclared Goal parameter "${name}"`);
    for (const name of Object.keys(contract.goal)) if (!used.includes(name)) broken(packFiles.contract, `Goal parameter "${name}" is not bound by the graph`);
  }
  for (const [kind, names] of [
    ['input', contract.inputs.map((input) => input.name)], ['output', contract.outputs.map((output) => output.name)],
    ['tool', contract.tools.map((tool) => tool.id)], ['workshop', contract.workshops.map((workshop) => workshop.id)],
    ...contract.tools.map((tool) => [`tool ${tool.id} input`, tool.inputs] as const),
  ] as const) {
    if (new Set(names).size !== names.length) broken(packFiles.contract, `duplicate ${kind} name`);
  }
  const inputNames = new Set(contract.inputs.map((i) => i.name));
  const referencesInputs = (text: string, what: string): void => {
    for (const name of placeholdersIn(text)) {
      if (!inputNames.has(name)) broken(packFiles.contract, `${what} references \${${name}}, which is not one of its inputs`);
    }
  };
  for (const output of contract.outputs) {
    referencesInputs(output.path, `output "${output.name}"`);
    try { campaignRelativePath(output.path, `output "${output.name}"`); } catch (error) { broken(packFiles.contract, (error as Error).message); }
  }
  for (const piece of contract.workspace.copy) referencesInputs(piece, `workspace copy entry "${piece}"`);

  // A tool's file must be there — a contract naming a script the directory does not hold is a pack
  // nobody can read, let alone run by hand — and its argv may reference only what it declares.
  const wrappers = new Set<string>();
  for (const tool of contract.tools) {
    if (!folder.files.has(tool.file)) broken(packFiles.contract, `names tool file ${tool.file} for "${tool.id}", which the pack does not hold`);
    try { literalArgument(tool.argv[0]!, `tool "${tool.id}" wrapper`); } catch (error) { broken(packFiles.contract, (error as Error).message); }
    const declared = new Set(tool.inputs);
    for (const word of tool.argv) {
      for (const name of placeholdersIn(word)) {
        if (!declared.has(name)) broken(packFiles.contract, `tool "${tool.id}" references \${${name}}, which is not one of its declared inputs`);
      }
    }
    wrappers.add(tool.argv[0]!);
  }
  // The pack states once, in `environment`, every wrapper a Site must allow it. A tool that runs one
  // the list does not carry is held here, at load, because both facts are in this one file.
  //
  // The other direction — a wrapper the list declares and nothing runs — moved to `checkPack` with
  // #61: a reader is a script with a command line of its own now, and its `argv[0]` is a wrapper this
  // pack runs as surely as a tool's is. Those declarations are files under `readers/`, read by the
  // check and deliberately not by the load (a declaration a person wrote wrong meets them as a
  // sentence about their file, not as a pack that will not load), so the only place both halves of
  // the list are known is the check.
  const declaredWrappers = new Set(contract.environment.wrappers);
  for (const w of wrappers) if (!declaredWrappers.has(w)) broken(packFiles.contract, `a tool runs "${w}", which environment.wrappers does not declare`);

  validateWorkshops(pack, broken);

  // A node id is unique across the whole pack — its graph and every loop — because a node record, a
  // Job, an attempt and a run row all name a node by that id and nothing else (#28). Two graphs each
  // holding a "synthesize" would make every one of those ambiguous.
  const declaredIn = new Map<string, string>();
  for (const { loop, graph: part } of graphsOf(pack)) {
    for (const node of part.nodes) {
      const already = declaredIn.get(node.id);
      if (already !== undefined) {
        broken(packFiles.graph, `declares two nodes called "${node.id}", one in ${already} and one in ${graphSaid(loop)}: a node id is unique across a whole pack, because every record names a node by that id alone`);
      }
      declaredIn.set(node.id, graphSaid(loop));
    }
  }
  for (const { loop, graph: part } of graphsOf(pack)) {
    const ids = new Set(part.nodes.map((n) => n.id));
    if (!ids.has(part.entry)) broken(packFiles.graph, `names "${part.entry}" as the entry of ${graphSaid(loop)}, which is not one of its nodes`);
    for (const edge of part.edges) {
      for (const end of ['from', 'to'] as const) {
        const id = edge[end];
        if (ids.has(id)) continue;
        // A node that *is* declared, only somewhere else, is the one mistake worth its own sentence:
        // an edge that crosses between a graph and a loop. The only way into a loop is an Explore
        // node that opens it, and the only way out is that loop closing.
        broken(packFiles.graph, declaredIn.has(id)
          ? `has an edge in ${graphSaid(loop)} ${end} "${id}", which is a node of ${declaredIn.get(id)!}: no edge crosses between a graph and a loop, because the only way into a loop is an explore node that opens it and the only way out is that loop closing`
          : `has an edge in ${graphSaid(loop)} ${end} "${id}", which is not one of its nodes`);
      }
    }
  }
  const toolIds = new Set(contract.tools.map((t) => t.id));
  const outputNames = new Set(contract.outputs.map((o) => o.name));
  const workshopIds = new Set(contract.workshops.map((w) => w.id));
  for (const { loop, graph: part } of graphsOf(pack)) {
    for (const node of part.nodes) {
      if (node.kind === 'act') {
        const { tool, observes } = node.parameters;
        if (tool !== undefined && !toolIds.has(tool)) broken(packFiles.graph, `node "${node.id}" runs tool "${tool}", which ${packFiles.contract} does not declare`);
        if (observes !== undefined && !outputNames.has(observes)) broken(packFiles.graph, `node "${node.id}" observes output "${observes}", which ${packFiles.contract} does not declare`);
        const { workshop } = node.parameters;
        if (workshop !== undefined && !workshopIds.has(workshop)) broken(packFiles.graph, `node "${node.id}" opens workshop "${workshop}", which ${packFiles.contract} does not declare`);

        // **A name the harness binds itself is not a node's to bind** (#62). `WORKSPACE`,
        // `FLOW_ROOT`, `DESIGN` and `CAMPAIGN` are the Campaign's own workspace and the bindings the
        // Site resolved; a workshop adds `ENTRY` and `WORKSHOP`, the two paths its turn resolved
        // under the Permit and then recorded. Every one of them is computed by the harness from a
        // path it already decided, and every record of the Job describes it as such — so an argument
        // of the same name is a pack substituting a word of its own choosing into a command line the
        // ledger goes on describing in the harness's terms. `ENTRY: '-c'` is the sharp end: `sh
        // ${ENTRY} …` launches as `sh -c …`, an inline program, beside a `launched` block carrying
        // the verified entry's path and its hash.
        //
        // **This is the boundary**; the substitution maps in `node-turns.ts` spread the harness's
        // values last as a second line, not as the rule. A rule that lived only there would be one
        // the pack author never hears about: the declaration would load, pass `/hima pack check`, and
        // then quietly not mean what it says.
        const opens = workshop !== undefined ? 'workshop' : tool !== undefined ? 'tool' : undefined;
        if (opens !== undefined) {
          const reserved = reservedArgumentNames(opens);
          for (const argument of Object.keys(node.parameters.arguments)) {
            if (!reserved.includes(argument)) continue;
            broken(
              packFiles.graph,
              `node "${node.id}" binds "${argument}", which the harness binds itself for a ${opens}: `
              + `${listed(reserved)} are the harness's own, computed from paths it already decided, and no node argument may name one`,
            );
          }
        }
        // Every argument this node takes from the Run's Strategy, held against the contract's own
        // declaration (#58), exactly as the tool and the output above are held against theirs. A
        // Strategy knob is the pack's own invention and the contract declares every one of them, so
        // the graph naming a knob the contract does not is one pack contradicting itself in two of
        // its files — which is what this function is. Unheld, such a node loads, passes
        // `/hima pack check`, prepares a 56 MB workspace and then blocks at the command line for a
        // value nothing could ever have bound.
        //
        // The Goal side cannot be held here and is not: a Goal's names come from the Run, not from
        // the pack, so an argument taken `{ from: goal }` is decided when the Run supplies one and
        // the node says which argument it could not bind.
        for (const [argument, value] of Object.entries(node.parameters.arguments)) {
          if (typeof value !== 'object' || value.from !== 'strategy') continue;
          if (Object.hasOwn(contract.strategy, value.name)) continue;
          broken(
            packFiles.graph,
            `node "${node.id}" takes argument "${argument}" from strategy knob "${value.name}", which ${packFiles.contract} does not declare; `
            + `it declares ${Object.keys(contract.strategy).map((n) => `"${n}"`).join(', ')}`,
          );
        }
      }
      if (node.kind === 'explore') validateExplore(pack, node, loop, broken);
    }
    validateEdgeLabels(part, loop, broken);
    validateLoopShape(part, loop, broken);
    validateForkShape(part, loop, broken);
  }
  validateGenerationLimit(graph, broken);
}

/**
 * Hold every workshop a pack declares to its own contract (#62) — everything about one that is
 * knowable from `contract.yml` alone, which is all of it.
 *
 * At load and not at the check, exactly as a tool's `argv` is held to its `inputs`: both facts are in
 * this one file, and a pack whose declaration contradicts itself is a pack nothing should run. What
 * needs a *Site* — whether the Permit allows the wrapper — is `checkPack`'s, and what needs the
 * pack's own folder — whether the knowledge file is really there — is `checkPack`'s too, because a
 * folder a person edits is a sentence about their file rather than a pack that will not load.
 *
 * @param pack - the pack, loaded.
 * @param broken - what says a file of this pack is not one, in the loader's own words.
 */
function validateWorkshops(pack: Pack, broken: (file: string, why: string) => never): void {
  const { contract } = pack;
  const outputs = new Map(contract.outputs.map((o) => [o.name, o]));
  const knowledgeFiles = new Set(contract.knowledge.map((k) => k.file));
  const declaredWrappers = new Set(contract.environment.wrappers);
  const seen = new Set<string>();
  for (const workshop of contract.workshops) {
    const named = `workshop "${workshop.id}"`;
    if (seen.has(workshop.id)) broken(packFiles.contract, `declares two workshops called "${workshop.id}": an act node names a workshop by that id alone`);
    seen.add(workshop.id);
    if (!workshop.purpose.trim()) broken(packFiles.contract, `${named} has no nonblank purpose`);
    const bound = graphsOf(pack).some(({ graph }) => graph.nodes.some((node) => node.kind === 'act' && node.parameters.workshop === workshop.id));
    if (!bound) broken(packFiles.contract, `${named} is not bound by any graph node`);

    // Where it writes, held against the two directories the workspace anatomy already owns. A pack
    // that put its workshop at either of them would have the model writing over a reader's own
    // shipped script or over the Campaign's copy of the Golden Flow — and the Permit would allow
    // both, because both are inside the workspace. The grammar in the schema has already refused
    // every spelling that climbs out of the workspace altogether.
    const head = workshop.directory.split('/')[0]!;
    if (head === flowDirName || head === readersDirName) {
      broken(packFiles.contract, `${named} names the directory "${workshop.directory}", and "${head}" is the campaign workspace's own: ${flowDirName} holds the copy of the golden flow and ${readersDirName} holds the pack's readers`);
    }

    // What it must produce, and that the produced output can become an observation at all. An output
    // with no reader is never read into the ledger, so a workshop producing one would write a file
    // no rule of this pack could ever be applied to.
    const produced = outputs.get(workshop.produces);
    if (!produced) broken(packFiles.contract, `${named} produces "${workshop.produces}", which is not one of this contract's outputs`);
    if (produced.reader === undefined) {
      broken(packFiles.contract, `${named} produces "${workshop.produces}", which declares no reader: a workshop's output is read into the ledger by the reader its contract names, and an output with none never becomes an observation`);
    }
    for (const name of workshop.reads) {
      if (!outputs.has(name)) broken(packFiles.contract, `${named} reads "${name}", which is not one of this contract's outputs`);
    }
    for (const file of workshop.knowledge) {
      if (!knowledgeFiles.has(file)) broken(packFiles.contract, `${named} names the knowledge file "${file}", which this contract's knowledge: does not declare`);
    }

    // The command line, held exactly as a tool's is: every `${NAME}` in it is one of the arguments
    // the node supplies or one of the six the harness computes, and the first word is a wrapper this
    // contract promises the Site.
    const supplied = new Set<string>([...workshop.inputs, ...workshopArgvValues]);
    for (const word of workshop.argv) {
      for (const name of placeholdersIn(word)) {
        if (supplied.has(name)) continue;
        broken(packFiles.contract, `${named} references \${${name}}, which is neither one of its declared inputs nor one of ${workshopArgvValues.map((v) => `\${${v}}`).join(', ')}`);
      }
    }
    const wrapper = workshop.argv[0]!;
    if (!declaredWrappers.has(wrapper)) broken(packFiles.contract, `${named} runs "${wrapper}", which environment.wrappers does not declare`);
  }
}

/** Which graph of a pack a rule is talking about, in the words a person reads their own file in. */
const graphSaid = (loop: string | undefined): string => (loop === undefined ? 'its graph' : `loop "${loop}"`);

/**
 * What is wrong between a chooser's clauses and the knobs a contract declares (#58), or undefined
 * when the two fit.
 *
 * Three ways they can disagree, and each of them is a decision the engine could not act on:
 *
 * - a clause sets a knob the contract does not declare, which is a value no node could ever read;
 * - a clause sets a *choice* knob to something outside its own list — including an arithmetic
 *   expression, which is not a word at all;
 * - a clause sets a *number* knob from a name this chooser cannot supply. A bare string under a
 *   number knob is arithmetic, so a chooser's typo lands here rather than at its own load, where
 *   nothing knows whether it was meant as a read or as a word.
 *
 * @param chooser - the chooser the Explore node names, loaded.
 * @param declaration - the contract's `strategy:` block.
 * @returns the fault as a clause of a sentence about that chooser, or undefined.
 */
function chooserKnobIssue(chooser: Chooser, declaration: Readonly<Record<string, StrategyKnob>>): string | undefined {
  const supplies = new Set([...Object.keys(chooser.reads), ...(chooser.parameter ? [chooser.parameter.name] : [])]);
  const declared = Object.keys(declaration);
  for (const [at, clause] of chooser.decide.entries()) {
    for (const [name, next] of Object.entries(clause.next ?? {})) {
      const knob = declaration[name];
      if (knob === undefined) {
        return `sets knob "${name}" in clause ${String(at + 1)}, which ${packFiles.contract} does not declare; it declares ${declared.map((n) => `"${n}"`).join(', ')}`;
      }
      if (knob.type === 'choice') {
        if (typeof next !== 'string' || !knob.options.includes(next)) {
          return `sets the choice knob "${name}" in clause ${String(at + 1)} to ${JSON.stringify(next)}, which is not one of ${knob.options.map((o) => `"${o}"`).join(', ')}`;
        }
        continue;
      }
      const unknown = namesIn(next).find((referenced) => !supplies.has(referenced));
      if (unknown !== undefined) {
        return `sets the number knob "${name}" in clause ${String(at + 1)} from "${unknown}", which is neither one of its reads nor its parameter`;
      }
    }
  }
  return undefined;
}

/**
 * What an Explore node may be (#28): the one that applies a chooser and decides, or the one that
 * opens a Loop of its own and drills down. Exactly one of the two, and drill-down goes one level.
 *
 * Held here rather than in the schema so that a pack naming both meets its author as a sentence
 * about their graph, in the words every other way a pack can contradict itself is said in, rather
 * than as a parse error naming a union branch.
 */
function validateExplore(pack: Pack, node: Extract<PackNode, { kind: 'explore' }>, loop: string | undefined, broken: (file: string, why: string) => never): void {
  const { chooser, opens } = node.parameters;
  const oneOfTwo = 'an explore node either applies a chooser and decides, or opens a loop and drills down, and states exactly one of the two';
  if (chooser !== undefined && opens !== undefined) {
    broken(packFiles.graph, `gives explore node "${node.id}" both chooser "${chooser}" and \`opens: ${opens}\`: ${oneOfTwo}`);
  }
  if (chooser === undefined && opens === undefined) {
    broken(packFiles.graph, `gives explore node "${node.id}" neither a chooser nor a loop to open: ${oneOfTwo}`);
  }
  if (opens === undefined) return;
  if (loop !== undefined) {
    broken(packFiles.graph, `has explore node "${node.id}" of loop "${loop}" open loop "${opens}": a loop's explore node applies a chooser, because drill-down goes one level and no further`);
  }
  if (!Object.hasOwn(pack.graph.loops, opens)) {
    broken(packFiles.graph, `has explore node "${node.id}" open loop "${opens}", which it does not declare under \`loops:\``);
  }
}

/**
 * What an edge may be labelled with, and by what (#28): a judge node's edges carry the verdict
 * outcome they are taken on, an Explore node that opens a Loop carries the outcome that Loop closed
 * with, and nothing else carries a label at all.
 *
 * A label the engine never matches on is a route a person would read in the file and the Run would
 * never take, which is the whole reason a graph is data. The rule runs in both directions, because
 * an edge the engine never matches is unreadable whichever half is missing:
 *
 * - a label on a node whose outcomes nothing branches on, or a label that is not one of that node's
 *   own outcomes, is an edge nothing takes;
 * - an edge out of an Explore node that opens a Loop carrying *no* label is the same edge from the
 *   other side. That node is left on the edge its Loop's outcome names and on no other, so an
 *   unlabelled one — a `revisit: true` among them — is a route the file shows and the Run cannot
 *   take, and the Run ends as though the node drew no edge at all;
 * - and two edges out of one node carrying the same label are a fork the engine resolves by taking
 *   the first that matches, which makes the order the lines happen to be written in decide where a
 *   Run goes.
 */
function validateEdgeLabels(part: RunGraph, loop: string | undefined, broken: (file: string, why: string) => never): void {
  const kindOf = new Map(part.nodes.map((n) => [n.id, n.kind]));
  const opensALoop = new Set(part.nodes.flatMap((n) => (n.kind === 'explore' && n.parameters.opens !== undefined ? [n.id] : [])));
  const allowed = (id: string): readonly string[] | undefined => {
    if (kindOf.get(id) === 'judge') return verdictOutcome.options;
    return opensALoop.has(id) ? loopOutcome.options : undefined;
  };
  const said = (options: readonly string[]): string => options.map((o) => `"${o}"`).join(', ');
  /** Where each label out of each node already leads, so a second edge saying the same thing is met
   *  with the first one rather than silently shadowed by it. Keyed by the node and the label with a
   *  space between them, which no pair of them can collide over: an outcome holds no space, so the
   *  label is whatever follows the last one and the node is the rest. */
  const leadsTo = new Map<string, string>();
  for (const edge of part.edges) {
    if (opensALoop.has(edge.from)) {
      if (edge.revisit === true) {
        broken(packFiles.graph, `gives explore node "${edge.from}" in ${graphSaid(loop)} a revisit edge to "${edge.to}": an explore node that opens a loop revisits nothing itself — the loop it opens carries its own revisit edge, and this node is left on the edge that loop's outcome labels`);
      }
      if (edge.outcome === undefined) {
        broken(packFiles.graph, `draws an edge in ${graphSaid(loop)} from explore node "${edge.from}" to "${edge.to}" with no outcome on it: that node opens a loop and is left on the edge its loop closed with, so every edge out of it carries one of ${said(loopOutcome.options)}`);
      }
    }
    if (edge.outcome === undefined) continue;
    const may = allowed(edge.from);
    if (may === undefined) {
      broken(packFiles.graph, `labels the edge in ${graphSaid(loop)} from "${edge.from}" with "${edge.outcome}", and that is a ${kindOf.get(edge.from) ?? 'missing'} node: only a judge node's edges carry a verdict outcome, and only an explore node that opens a loop carries the outcome that loop closed with`);
    }
    if (!may.includes(edge.outcome)) {
      broken(packFiles.graph, `labels the edge in ${graphSaid(loop)} from "${edge.from}" with "${edge.outcome}", which is not one of ${said(may)}`);
    }
    const already = leadsTo.get(`${edge.from} ${edge.outcome}`);
    if (already !== undefined) {
      broken(packFiles.graph, `draws two edges in ${graphSaid(loop)} out of "${edge.from}" labelled "${edge.outcome}", to "${already}" and to "${edge.to}": one outcome leads one way, because the engine takes the first edge that matches and a fork the line order decides is a route nobody can read off the file`);
    }
    leadsTo.set(`${edge.from} ${edge.outcome}`, edge.to);
  }
}

/**
 * What a Loop may look like in one graph (D43), checked at load so a pack whose Loop cannot be
 * executed is refused where a person can still read the file rather than after a licence-minute of
 * synthesis. Applied to the pack's own graph and to each of its drill-down loops alike, because each
 * of them is a graph HimaFabric runs and each may declare a Loop of its own (#28).
 *
 * Three rules, and they are the same rule from three sides: a Loop is one revisit edge from one
 * Explore node back into the act nodes it wants run again.
 *
 * - A revisit edge leaves an Explore node and enters an act node. Anywhere else it would mean
 *   re-judging or re-waiting, neither of which opens a Generation.
 * - With the revisit edges taken out, nothing cycles. That is what makes a revisit edge readable:
 *   every other way back is a loop the engine would run and `graph.yml` would not show.
 * - An Explore node that applies a chooser has at most one outgoing edge. Its decision chooses a
 *   Strategy or ends the Run; it labels no outcome, so a second edge is a fork nothing could choose
 *   between. An Explore node that *opens* a loop is the exception and has one edge per outcome that
 *   loop can close with, which `validateEdgeLabels` holds.
 *
 * And one rule about where a graph's Runs wait, which belongs here because it is the same kind of
 * fact: a graph declares at most one Wait node. Nothing draws an edge to a Wait node — the engine
 * routes a Hard blocker and an unlabelled UNDETERMINED there — so a graph declaring two says
 * nothing about which of them a person is sent to, and the engine would answer by the order the
 * nodes happen to be written in.
 */
function validateLoopShape(part: RunGraph, loop: string | undefined, broken: (file: string, why: string) => never): void {
  const kindOf = new Map(part.nodes.map((n) => [n.id, n.kind]));
  const waits = part.nodes.filter((n) => n.kind === 'wait');
  if (waits.length > 1) {
    broken(packFiles.graph, `declares ${String(waits.length)} wait nodes in ${graphSaid(loop)}, ${waits.map((n) => `"${n.id}"`).join(' and ')}: a graph declares at most one, because nothing draws an edge to a wait node and which one a run is sent to would be the order they are written in`);
  }
  for (const edge of part.edges) {
    if (edge.revisit !== true) continue;
    if (kindOf.get(edge.from) !== 'explore') {
      broken(packFiles.graph, `has a revisit edge from "${edge.from}", which is a ${kindOf.get(edge.from) ?? 'missing'} node: a revisit edge leaves an explore node`);
    }
    if (kindOf.get(edge.to) !== 'act') {
      broken(packFiles.graph, `has a revisit edge to "${edge.to}", which is a ${kindOf.get(edge.to) ?? 'missing'} node: a revisit edge leads to an act node, which is what the next generation runs`);
    }
  }
  for (const node of part.nodes) {
    if (node.kind !== 'explore' || node.parameters.opens !== undefined) continue;
    const out = part.edges.filter((e) => e.from === node.id);
    if (out.length > 1) {
      broken(packFiles.graph, `gives explore node "${node.id}" ${String(out.length)} outgoing edges, to ${out.map((e) => `"${e.to}"`).join(' and ')}: an explore node has at most one, because its decision chooses a strategy or ends the run and labels no outcome to branch on`);
    }
  }
  // Everything reachable from the entry, following every edge that is not a revisit. A node found
  // twice on one path is a cycle no revisit edge declared, so the graph says one thing and would do
  // another.
  const ordinary = part.edges.filter((e) => e.revisit !== true);
  const settled = new Set<string>();
  const walk = (nodeId: string, path: readonly string[]): void => {
    if (path.includes(nodeId)) {
      const cycle = [...path.slice(path.indexOf(nodeId)), nodeId].map((n) => `"${n}"`).join(' → ');
      const where = loop === undefined ? '' : ` in ${graphSaid(loop)}`;
      broken(packFiles.graph, `cycles${where} through ${cycle} without a revisit edge: a loop is declared with \`revisit: true\` on the edge that closes it, and nowhere else`);
    }
    if (settled.has(nodeId)) return;
    for (const edge of ordinary) if (edge.from === nodeId) walk(edge.to, [...path, nodeId]);
    settled.add(nodeId);
  };
  walk(part.entry, []);
}

/**
 * One branch of a fork as the graph draws it: the id it is known by, which is the id of its first
 * node, and the chain of act nodes it runs from there to the join.
 */
export interface ForkBranch {
  readonly id: string;
  readonly nodes: readonly string[];
}

/**
 * The fork one node draws, read off the edges (D29): where it branched, the judge node every branch
 * converges into, and the branches themselves — or, for a graph that draws something a fork cannot
 * be made of, why not.
 */
export type Fork =
  | { readonly ok: true; readonly from: string; readonly join: string; readonly branches: readonly ForkBranch[] }
  | { readonly ok: false; readonly why: string };

/**
 * **What a fork is, stated once** (D29, CONTEXT.md *Fork and join*): edges and not a node kind.
 *
 * An act node with two or more unlabelled outgoing edges branches. Each branch is the chain of act
 * nodes from that edge's target on, following the one edge out of each, until the first node with
 * two or more incoming edges — which is the join, and which must be a judge node, because that is
 * where branches converge and judging all of them is the only thing that can be done with several
 * answers at once. Every branch of one fork reaches the same join.
 *
 * Only an act node forks, and that is the whole of the widening this rule makes to the graph: an act
 * node's edge out was always the unlabelled "and then", and now there may be several of them. A
 * judge node is left along the edge its first rule's outcome labels, an explore node along the one
 * its decision allows, and a wait node when a person clears it — none of those has an unlabelled
 * "and then" to draw twice.
 *
 * Read here, in one place, by the validator that refuses a fork a Run could not be driven through
 * and by the driver that opens one, so the shape a person is refused for is exactly the shape the
 * engine would have run.
 *
 * @param graph - the graph this node belongs to; a Loop is a graph of its own.
 * @param node - the node that may draw a fork.
 * @returns the fork, why what it draws is not one, or undefined when it draws no fork at all.
 */
export function forkFrom(graph: RunGraph, node: PackNode): Fork | undefined {
  const out = graph.edges.filter((e) => e.from === node.id && e.outcome === undefined);
  if (out.length < 2 || node.kind !== 'act') return undefined;
  const kindOf = new Map(graph.nodes.map((n) => [n.id, n.kind]));
  const incoming = new Map<string, number>();
  for (const edge of graph.edges) incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
  const branches: ForkBranch[] = [];
  let join: string | undefined;
  for (const edge of out) {
    const nodes: string[] = [];
    let at = edge.to;
    for (;;) {
      if ((incoming.get(at) ?? 0) >= 2) break;
      const kind = kindOf.get(at);
      if (kind === undefined) return { ok: false, why: `branches to "${at}", which is not one of its nodes` };
      if (kind !== 'act') {
        return { ok: false, why: `has a ${kind} node, "${at}", inside the branch it forks to "${edge.to}": a branch is act nodes only, because a fork is judged where its branches converge and nowhere else` };
      }
      nodes.push(at);
      const on = graph.edges.filter((e) => e.from === at);
      if (on.length === 0) return { ok: false, why: `forks to "${edge.to}", whose branch ends at "${at}" with no edge out: every branch of a fork reaches the join, because the run waits for all of them` };
      if (on.length > 1) return { ok: false, why: `forks again at "${at}", inside the branch it forks to "${edge.to}": a fork holds no fork, because a branch is one chain of act nodes` };
      at = on[0]!.to;
      if (nodes.length > graph.nodes.length) return { ok: false, why: `has a branch from "${edge.to}" that never reaches a join` };
    }
    if (nodes.length === 0) return { ok: false, why: `forks straight to "${at}", which every branch converges into: a branch with nothing in it is an edge that does nothing` };
    if (kindOf.get(at) !== 'judge') {
      return { ok: false, why: `has the branches of the fork at "${node.id}" converge into "${at}", which is a ${kindOf.get(at) ?? 'missing'} node: branches converge into a judge node, because judging all of them together is what a join is` };
    }
    if (join !== undefined && join !== at) {
      return { ok: false, why: `has the branches of the fork at "${node.id}" converge into two different nodes, "${join}" and "${at}": every branch of one fork reaches one join, because the run waits for all of them at it` };
    }
    join = at;
    branches.push({ id: edge.to, nodes });
  }
  return { ok: true, from: node.id, join: join!, branches };
}

/**
 * The fork whose branches converge into this node, when one does: what makes a judge node a join.
 *
 * Asked of the graph and never of the run row, so it is the same answer before a fork opens, while
 * it is open, and after it has closed — which is what lets the join be judged as the join by a host
 * that picked the Run up between the fork closing and the judging.
 *
 * @param graph - the graph this node belongs to.
 * @param nodeId - the node that may be a join.
 * @returns the fork that converges here, or undefined when nothing forks into this node.
 */
export function forkJoinedAt(graph: RunGraph, nodeId: string): Extract<Fork, { ok: true }> | undefined {
  for (const node of graph.nodes) {
    const fork = forkFrom(graph, node);
    if (fork !== undefined && fork.ok && fork.join === nodeId) return fork;
  }
  return undefined;
}

/**
 * **What a fork concludes, stated once**: the one outcome a join settles on, over what each of its
 * branches was judged to be.
 *
 * PASS only when every branch passed — a fork is one question asked several ways, and an answer that
 * held for one branch and not another has not held. UNDETERMINED whenever any branch is, because a
 * rule that could not be applied to one branch leaves the whole question unanswered and this harness
 * never folds that into a PASS or a FAIL (D6). Otherwise FAIL.
 *
 * Read over the **first** rule's verdict per branch, which is the constraint the pack chose to
 * branch on, exactly as a judge node that judged one reading is (`judgeNode`). It is the outcome the
 * join's own edge is labelled with, so it is stated here beside what a fork is and pointed at from
 * `edgeFrom`, which is what takes that edge.
 *
 * @param outcomes - what each branch's first rule concluded, one per branch.
 * @returns the outcome the join settles on.
 */
export function forkOutcome(outcomes: readonly VerdictOutcome[]): VerdictOutcome {
  if (outcomes.some((o) => o === 'UNDETERMINED')) return 'UNDETERMINED';
  return outcomes.every((o) => o === 'PASS') ? 'PASS' : 'FAIL';
}

/**
 * What a fork may look like in one graph (D29), checked at load so a pack whose fork cannot be
 * executed is refused where a person can still read the file.
 *
 * The rules are `forkFrom`'s, said in the words a person reads their own file in, plus the two that
 * are about where a fork may be rather than about what it is. **Not inside a drill-down Loop and not
 * inside another fork**, because step 3 runs one level of each (spec, *Out of Scope*): a fork inside
 * a fork is refused by the walk itself, which finds the second fork's node drawing two edges inside
 * a branch; a fork inside a Loop is refused here, where the graph being walked knows it is a Loop.
 * And **nothing a fork's join leads to explores**, for the reason `exploreAfter` states.
 *
 * The act node's own rule is the same rule from the other side, and it is why every act node is
 * asked and not only the ones that look like a fork: an act node has **one** unlabelled edge out, or
 * it has a fork. Two edges that are not a fork the engine could drive would otherwise load as a
 * route a person would read and the Run would take the first line of.
 */
function validateForkShape(part: RunGraph, loop: string | undefined, broken: (file: string, why: string) => never): void {
  for (const node of part.nodes) {
    if (node.kind !== 'act') continue;
    const out = part.edges.filter((e) => e.from === node.id);
    if (out.length <= 1) continue;
    if (loop !== undefined) {
      broken(packFiles.graph, `forks at "${node.id}" in ${graphSaid(loop)}: a loop's graph holds no fork, because drill-down and fork each go one level in step 3 and neither is nested in the other`);
    }
    const fork = forkFrom(part, node);
    if (fork === undefined) {
      broken(packFiles.graph, `gives act node "${node.id}" in ${graphSaid(loop)} ${String(out.length)} outgoing edges, to ${out.map((e) => `"${e.to}"`).join(' and ')}, and they are not a fork: an act node has one unlabelled edge out, or several that fork to act nodes and converge into one judge node`);
    }
    // `why` is already a whole sentence about this file, in the words every other way a pack can
    // contradict itself is refused in; a fork inside a Loop is the one case above, and there is no
    // other graph one of these can be about.
    if (!fork.ok) broken(packFiles.graph, fork.why);
    const explores = exploreAfter(part, fork.join);
    if (explores !== undefined) {
      // No `graphSaid` here, unlike every refusal above: a fork inside a loop was refused a few
      // lines up, so the graph this can be about is always the pack's own.
      broken(packFiles.graph, `has explore node "${explores}" downstream of "${fork.join}", the join of the fork at "${node.id}": an explore node weighs one reading of its loop's latest generation, and a fork writes one reading per branch, so a chooser standing after a join would choose from whichever branch happened to append last`);
    }
  }
}

/**
 * The first explore node a fork's join leads to, when it leads to one at all.
 *
 * Refused at load in step 3, and this is the whole of the reason: a chooser is handed the
 * generation's *own* reading — `exploreNode` narrows the observation and the verdicts it weighs by
 * the Loop it is in and by nothing else — while a fork leaves one reading per branch in that same
 * generation. A chooser standing after a join would therefore decide on whichever branch appended
 * last, which is the site's job scheduling and not the pack's rule, and the decision record would
 * cite a value no person could have predicted from the file. What a fork's several answers mean is
 * a question the pack has not been given a way to answer yet; until it has, the graph may not ask
 * it. Refused where the file can still be read, like every other way a pack contradicts itself.
 *
 * Every node reachable from the join is walked, not only its immediate successors: the explore node
 * two act nodes past the join reads exactly the same branch observations as one drawn straight off
 * it. A revisit edge closes a cycle, so nodes already seen are not walked again.
 *
 * @param graph - the graph the fork belongs to; a Loop is a graph of its own.
 * @param join - the judge node the fork's branches converge into.
 * @returns the id of an explore node the join leads to, or undefined when it leads to none.
 */
function exploreAfter(graph: RunGraph, join: string): string | undefined {
  const kindOf = new Map(graph.nodes.map((n) => [n.id, n.kind]));
  const seen = new Set<string>([join]);
  const walking = [join];
  for (let at = walking.pop(); at !== undefined; at = walking.pop()) {
    for (const edge of graph.edges.filter((e) => e.from === at)) {
      if (seen.has(edge.to)) continue;
      seen.add(edge.to);
      if (kindOf.get(edge.to) === 'explore') return edge.to;
      walking.push(edge.to);
    }
  }
  return undefined;
}

/**
 * One Run, one Budget: the generation limit a Campaign is held to is a single number, and the pack's
 * own graph is where a pack states its default for it.
 *
 * The pack's own graph and no loop's, because a drill-down loop's `converge.generationLimit` bounds
 * that loop and nothing else — it is read off the Explore node whose decision would open the next
 * inner generation, so two Explore nodes in one loop naming two numbers each bound their own
 * decision and neither is ignored. The Budget's is the one number a whole Run is held to, and a
 * graph stating two of those would have the engine choosing which Campaign it is running.
 */
function validateGenerationLimit(graph: PackGraph, broken: (file: string, why: string) => never): void {
  const limits = new Map<number, string>();
  for (const node of graph.nodes) {
    if (node.kind !== 'explore' || node.parameters.converge === undefined) continue;
    limits.set(node.parameters.converge.generationLimit, node.id);
  }
  if (limits.size > 1) {
    const said = [...limits].map(([limit, id]) => `${String(limit)} on explore node "${id}"`).join(', ');
    broken(packFiles.graph, `declares ${String(limits.size)} different generation limits — ${said} — where a campaign has one budget: every explore node that declares \`converge\` states the same \`generationLimit\`, which is the number the whole run is held to`);
  }
}

// ---------------------------------------------------------------------------------------------
// The check: can this Site host this pack?
// ---------------------------------------------------------------------------------------------

export interface InputCheck { readonly name: string; readonly bound: string | undefined; readonly error: string | undefined }
export interface ToolCheck { readonly id: string; readonly file: string; readonly wrapper: string; readonly error: string | undefined }
/**
 * One id the pack names, and where it came from (#57).
 *
 * `origin` is undefined exactly when `resolved` is: an id that resolved nowhere came from neither
 * place, and saying it came from the bundle would be the report inventing a file. A resolved id
 * always has one, because resolution is a list and something answered.
 */
export interface RuleCheck { readonly ref: string; readonly resolved: string | undefined; readonly origin: PackDataOrigin | undefined; readonly error: string | undefined }
export interface ReaderCheck { readonly id: string; readonly output: string; readonly resolved: string | undefined; readonly origin: PackDataOrigin | undefined; readonly error: string | undefined }
export interface ChooserCheck { readonly ref: string; readonly node: string; readonly resolved: string | undefined; readonly origin: PackDataOrigin | undefined; readonly error: string | undefined }
/** One knowledge file the contract declares, and whether the pack folder holds it (#57). The origin
 *  is always `pack` when there is one: the bundle ships no knowledge directory to fall back to. */
export interface KnowledgeCheck {
  readonly file: string;
  readonly purpose: string;
  /** Where the file was found, absolute, or undefined when it is not there. */
  readonly resolved: string | undefined;
  readonly origin: PackDataOrigin | undefined;
  readonly error: string | undefined;
}
/**
 * One workshop the contract declares, held against the Site and against the pack's own folder (#62).
 *
 * What is reported is what a person editing the declaration needs to see at a glance: which wrapper a
 * Job of it runs, where the model writes and which file of that directory is the one that runs, and
 * which output it must produce with the reader that turns it into an observation. Everything else
 * about a workshop is refused at load, because everything else about one is in `contract.yml` alone.
 */
export interface WorkshopCheck {
  readonly id: string;
  /** The entry file, relative to the workshop's own directory. */
  readonly entry: string;
  readonly directory: string;
  readonly wrapper: string;
  readonly produces: string;
  /** The reader that output declares; always present, because a workshop with none does not load. */
  readonly reader: string;
  readonly error: string | undefined;
}

/** One licence one of the pack's tools or workshops holds, held against what the Site declares of it. */
export interface LicenceCheck {
  readonly name: string;
  /** The tool or the workshop that holds it, by id. */
  readonly tool: string;
  /**
   * Which of the two that id names (#62): a workshop's Job takes a seat of the Site exactly as a
   * tool's does, so both are held here — and an id alone would not say which declaration a person
   * has to go and edit, two of which may perfectly well be spelled the same.
   */
  readonly holder: 'tool' | 'workshop';
  /** How many seats a Job of it holds. */
  readonly held: number;
  /** How many the Site declares, or undefined for a licence the Site does not declare at all. */
  readonly declared: number | undefined;
  readonly error: string | undefined;
}

/**
 * What vocabulary a Run of this pack would speak (#61): the value types its own `semantics.yml`
 * declares, the ones that come from the bundle after them, and the file the pack's own would be in.
 *
 * Reported because a value type is now a pack's to invent, and which file declared one is the first
 * thing a person editing a rule or a reader needs — the same reason every resolved id says where it
 * came from. The pack's own are named; the bundle's are counted, because they are the same eight on
 * every pack and a list nobody reads twice is noise on a report a person reads for the exceptions.
 */
export interface SemanticsCheck {
  /** Where this pack's own file is, whether or not it has one. */
  readonly file: string;
  /** The value types this pack declares itself, in the order its file states them. */
  readonly pack: readonly string[];
  /** How many more the bundle declares that the pack does not redeclare. */
  readonly fromBundle: number;
}

/**
 * Everything `/hima pack check` found, as data. `errors` is every one of the errors below it in the
 * order they were found, so a caller can report the whole picture and still answer the one question
 * a person asked: may this Campaign start?
 */
export interface PackCheck {
  readonly packId: string;
  readonly packVersion: string;
  readonly siteName: string;
  /**
   * How far up the pack authoring pipeline this folder has come, and what the next stage needs (#63).
   *
   * Reported, and deliberately not judged: `fit` is about whether this Site can host this pack, and
   * a hand-written pack that never went through the pipeline is as fit as one that did. The stage is
   * here because it is the one thing a pack author asks of a folder and the check is where a folder
   * is looked at.
   */
  readonly stage: PackStage;
  readonly inputs: readonly InputCheck[];
  readonly tools: readonly ToolCheck[];
  /** Every workshop this pack declares (#62), and whether this Site could host one. */
  readonly workshops: readonly WorkshopCheck[];
  readonly rules: readonly RuleCheck[];
  readonly readers: readonly ReaderCheck[];
  /** The value types in force for this pack, and which file declared each (#61). */
  readonly semantics: SemanticsCheck;
  readonly choosers: readonly ChooserCheck[];
  readonly knowledge: readonly KnowledgeCheck[];
  readonly licences: readonly LicenceCheck[];
  /**
   * What this host's ledger says about the Run the folder's test record names (#64), when the folder
   * stands at `tested` and a ledger was in hand to ask.
   *
   * Absent from `checkPack`'s own answer always: `checkPack` opens files and asks a Site file
   * questions, and a ledger is neither. It is put here by `withTestRecord`, which the faces that
   * hold a ledger compose their answer through.
   */
  readonly testRecord?: TestRecordCheck;
  readonly errors: readonly string[];
  readonly fit: boolean;
}

/**
 * Which Run a test record's `Run` section names, or which way it names no one Run (#64).
 *
 * Three answers and not "the id or nothing", because "this record names no Run" and "this record
 * names two" are different faults with different fixes, and a rung that said the first for the
 * second would send an author to add a line the record already has twice.
 */
export type TestRecordRun =
  | { readonly kind: 'named'; readonly run: string }
  | { readonly kind: 'none' }
  | { readonly kind: 'many'; readonly runs: readonly string[] };

/** What this host's ledger says about the Run a folder's test record rests on (#64). */
export interface TestRecordCheck {
  /** The run id the record's `Run` section names. */
  readonly run: string;
  /** The line a person reads when the record holds; undefined when something differs. */
  readonly said: string | undefined;
  /** What differs, or undefined when the record and the ledger agree. */
  readonly error: string | undefined;
}

/**
 * Hold a pack against a Site: every input bound, every tool's first word a wrapper the Permit
 * allows, every rule, reader and chooser resolvable, every chooser's parameter bound by the node
 * that names it, every knowledge file the contract declares there in the pack's own folder, and
 * every licence a tool holds declared by the Site in at least that number.
 *
 * And **where each of those ids came from** (#57): a pack folder may carry its own `rules/`,
 * `choosers/` and `readers/`, resolved ahead of the bundle's, so which file answered is a fact about
 * a Campaign and not an implementation detail. Every resolved entry carries its `origin`, and
 * `/hima pack check` prints it.
 *
 * Nothing here touches the Site. Every one of those answers is in files this machine already holds —
 * the site file, its permit, the pack's own folder, the bundle's rules and choosers, the reader
 * registry — so a check can be run before a Site is reachable, and running one costs a customer's
 * machine nothing. That is what
 * makes this the right place for all of them: a pack that cannot be executed is said so before a
 * Campaign exists, rather than after a workspace, a licence and two and a half minutes of synthesis.
 *
 * **Every answer here is out of `pack.folder`** (#64): the rung the folder stands on, the rules,
 * choosers, reader declarations and semantics the pack carries itself, the knowledge files it holds,
 * and whether it matches its own seal. One reading, one instant, one statement — a check that read
 * the folder again for any of them would be describing a folder the pack was not parsed from, and a
 * folder is only ever one thing at one moment. The bundle's own rules, choosers, readers and
 * semantics are read by path, because the bundle is not the folder.
 *
 * What a *running node* reads is a different question at a different instant (D46), and `packDataAt`
 * is where the two are set beside each other.
 *
 * @param pack - the loaded pack, carrying the one reading of its folder it was parsed out of.
 * @param site - the Site it would run on.
 */
export function checkPack(pack: Pack, site: Site): PackCheck {
  const folder = pack.folder;
  const errors: string[] = [];
  const fail = <T>(entry: T, message: string): T => { errors.push(message); return entry; };

  const inputs: InputCheck[] = pack.contract.inputs.map((input) => {
    const bound = site.bindings[input.name];
    if (bound === undefined || bound === '') {
      return fail(
        { name: input.name, bound: undefined, error: `input "${input.name}" is not bound by site ${site.name}` },
        `input "${input.name}" is not bound by site ${site.name}: add it under bindings: in ${site.file}`,
      );
    }
    try { literalArgument(bound, `Site binding "${input.name}"`); }
    catch (error) { return fail({ name: input.name, bound, error: (error as Error).message }, (error as Error).message); }
    return { name: input.name, bound, error: undefined };
  });

  for (const output of pack.contract.outputs) {
    try { outputPath(output, site.bindings); } catch (error) { errors.push((error as Error).message); }
  }

  const tools: ToolCheck[] = pack.contract.tools.map((tool) => {
    const wrapper = tool.argv[0]!;
    const head = { id: tool.id, file: tool.file, wrapper };
    return permitsWrapper(site, wrapper)
      ? { ...head, error: undefined }
      : fail({ ...head, error: refusedWrapper(site, wrapper) }, `tool "${tool.id}": ${refusedWrapper(site, wrapper)}`);
  });

  // Every workshop this pack declares (#62), held against the Site's Permit and against the pack's
  // own knowledge folder. Its wrapper is a wrapper this pack runs as surely as a tool's is, so it
  // joins the set the unused-wrapper check below is made over.
  //
  // The knowledge files are held here rather than only in the `knowledge:` section below because a
  // workshop is what actually *reads* one: the section says the contract promises a file, and this
  // says the moment opened at this node would find the file it was composed to read. A file missing
  // is one error and not two — the section names it as well, and both sentences are about the same
  // file, which is the pack author's to write.
  const workshops: WorkshopCheck[] = pack.contract.workshops.map((workshop) => {
    const wrapper = workshop.argv[0]!;
    const produced = pack.contract.outputs.find((o) => o.name === workshop.produces);
    const head = {
      id: workshop.id,
      entry: workshop.entry,
      directory: workshop.directory,
      wrapper,
      produces: workshop.produces,
      // Always there past `validatePack`, which refuses a workshop producing an output with no
      // reader; the fall-back spelling is what keeps this a report rather than a second validator.
      reader: produced?.reader ?? '(none)',
    };
    const refuse = (why: string): WorkshopCheck => fail({ ...head, error: why }, `workshop "${workshop.id}": ${why}`);
    if (!permitsWrapper(site, wrapper)) return refuse(refusedWrapper(site, wrapper));
    for (const file of workshop.knowledge) {
      const at = path.join(packKnowledgeDir(pack), file);
      // Asked of the one reading of the folder, as the `knowledge:` section below is (#64): a check
      // is one statement about one instant, and a workshop's knowledge and the contract's promise of
      // the same file must not be able to answer differently because the folder moved between two
      // `lstat`s. A link there never reaches here — the reading refuses the whole folder naming it.
      const relative = `${packDataDirs.knowledge}/${file}`;
      if (!folder.has(relative)) {
        return refuse(`it may read the knowledge file "${file}", which is ${folder.directories.has(relative) ? `at ${at}, which is not a plain file` : `not at ${at}`}`);
      }
    }
    return { ...head, error: undefined };
  });

  // Every rule the pack references, wherever it references it: the contract's own summary list and
  // whatever each judge node applies. A rule named in only one of the two is still resolved here,
  // because a pack that references a rule which does not exist is unfit either way.
  //
  // Every graph the pack holds, its drill-down loops included, exactly as its choosers are collected
  // below: a Loop's judge node applies rules as the graph's own does, and a rule named only inside a
  // Loop would otherwise escape the check entirely and fail at the Loop's first judge — after a
  // workspace, a licence and however long the Loop took to reach it.
  const ruleRefs = [...new Set([
    ...pack.contract.rules,
    ...graphsOf(pack).flatMap(({ graph }) => graph.nodes).flatMap((n) => (n.kind === 'judge' ? n.parameters.rules : [])),
  ])];
  /** The rules that actually resolved, kept so their requirements can be held against the value
   *  types those requirements are written in (#61), below, where the semantics are read. */
  const resolvedRules: { readonly ref: string; readonly rule: Rule }[] = [];
  const rules: RuleCheck[] = ruleRefs.map((ref) => {
    try {
      const { rule, origin } = resolveRule(pack, ref, 'the reading');
      resolvedRules.push({ ref, rule });
      return { ref, resolved: `${rule.id}@${rule.version}`, origin, error: undefined };
    } catch (err) {
      return fail({ ref, resolved: undefined, origin: undefined, error: (err as Error).message }, (err as Error).message);
    }
  });

  // What every value type this pack speaks of means (#61): its own `semantics.yml` first, the
  // bundle's second. Read once, here, because three of the sections below are held against it — the
  // readers' `emits`, the rules' requirements and the choosers' reads.
  //
  // A pack whose own file is there and will not read is one error and not thirty: nothing can be said
  // about a type until the file that declares it can be opened, so the three cross-checks are left
  // undone rather than answered against a list that is missing whatever that file held. Every entry
  // still resolves and still reports where it came from, and the pack is unfit on the one sentence
  // that actually explains why.
  let semantics: Semantics | undefined;
  /** What the pack declares itself, kept apart from the resolved list: the coverage check below and
   *  the report both ask about the pack's own file and not about what it inherited. */
  let ownTypes: string[] = [];
  try {
    ownTypes = Object.keys(packOwnSemantics(pack, 'the reading')?.values ?? {});
    semantics = semanticsOf(pack, 'the reading');
  } catch (err) {
    errors.push((err as Error).message);
  }
  const semanticsCheck: SemanticsCheck = {
    file: packSemanticsFile(pack),
    pack: ownTypes,
    fromBundle: semantics === undefined ? 0 : Object.keys(semantics).length - ownTypes.length,
  };

  const readersDir = packReadersDir(pack);
  /** The resolved list again under a name a closure may narrow: `semantics` is reassigned above, so
   *  TypeScript widens it back to possibly-undefined inside the map below. */
  const inForce = semantics;
  /** Every wrapper this pack runs: its tools', its workshops' (#62), and its own readers' (#61). */
  const wrappersRun = new Set([...pack.contract.tools, ...pack.contract.workshops].map((runs) => runs.argv[0]!));
  /** Every value type the pack's own readers declare they emit, for the coverage check below. */
  const emittedByAPackReader = new Set<string>();
  const readers: ReaderCheck[] = pack.contract.outputs
    .filter((o) => o.reader !== undefined)
    .map((output) => {
      const id = output.reader!;
      const head = { id, output: output.name };
      const named = `reader "${id}", named by output "${output.name}"`;
      // The pack's own declaration first, exactly as a rule and a chooser resolve (#57), through the
      // same `readDataFile` they resolve through: only `ENOENT` is absence, and a file that is there
      // and will not open (a `readers` that is a plain file rather than a directory, one this
      // process may not read) is an error naming the path — never a quiet fall to the registry, which
      // would run a bundled reader under a pack's name and call that a pass.
      let found: PackReaderLookup;
      try {
        found = resolvePackReader(pack, id, 'the reading');
      } catch (err) {
        const message = (err as Error).message;
        return fail({ ...head, resolved: undefined, origin: undefined, error: message }, message);
      }
      if (found.kind === 'broken') {
        const message = `${named}, is declared at ${found.at}, and ${found.reason}`;
        return fail({ ...head, resolved: undefined, origin: undefined, error: message }, message);
      }
      if (found.kind === 'declared') {
        const { declaration, at } = found;
        const resolved = `${declaration.id}@${declaration.version}`;
        const refuse = (why: string): ReaderCheck => fail({ ...head, resolved, origin: 'pack' as const, error: why }, why);
        // What it declares it emits, recorded before anything below can refuse it: the coverage check
        // further down asks whether the pack's own semantics are produced by any of its readers, and a
        // reader refused for its wrapper still declares what it declares. Recording it afterwards
        // would make one fault report as two, the second about a file that is perfectly correct.
        for (const type of declaration.emits) emittedByAPackReader.add(type);
        // Then the three things a pack reader must be: a script of the pack's own, a wrapper the
        // contract declares and the Permit allows, and value types the resolved semantics declare.
        const script = packReaderScript(pack, declaration.file, 'the reading');
        if (!script.ok) return refuse(`${named}, declares its script at ${at} as "${declaration.file}", and ${script.reason}`);
        const wrapper = declaration.argv[0]!;
        wrappersRun.add(wrapper);
        // Both halves, exactly as a tool's `argv[0]` is held: the contract promises the Site every
        // wrapper this pack runs, and the Site's Permit decides each one. A reader running a wrapper
        // the contract never promised would be a pack whose `environment` understated what a Site
        // must allow it, which is the one thing a Site owner reads that block for.
        if (!pack.contract.environment.wrappers.includes(wrapper)) {
          return refuse(`${named}, runs its script with "${wrapper}", which ${packFiles.contract}'s environment.wrappers does not declare`);
        }
        if (!permitsWrapper(site, wrapper)) return refuse(`${named}, runs its script with ${refusedWrapper(site, wrapper)}`);
        if (inForce !== undefined) {
          const undeclared = declaration.emits.filter((type) => !Object.hasOwn(inForce, type));
          if (undeclared.length > 0) {
            return refuse(
              `${named}, declares it emits ${undeclared.map((n) => `"${n}"`).join(', ')}, which no semantics file declares; `
              + `add it to ${packSemanticsFile(pack)}`,
            );
          }
        }
        return { ...head, resolved, origin: 'pack' as const, error: undefined };
      }
      const reader = readerNamed(id);
      if (!reader) {
        const message = `unknown reader "${id}", named by output "${output.name}": no reader file at ${path.join(readersDir, `${id}.yml`)}, and no reader of that id ships with this harness`;
        return fail({ ...head, resolved: undefined, origin: undefined, error: message }, message);
      }
      return { ...head, resolved: `${reader.id}@${reader.version}`, origin: 'bundle' as const, error: undefined };
    });

  // And the other half of the wrapper list, which `validatePack` cannot answer because a reader's
  // command line lives in a file under `readers/` (#61): a wrapper this contract promises a Site must
  // allow and nothing at all runs is a promise no tool and no reader keeps.
  for (const w of pack.contract.environment.wrappers) {
    if (wrappersRun.has(w)) continue;
    errors.push(`${packFiles.contract}: environment.wrappers declares "${w}", which no tool, workshop or reader of this pack runs`);
  }

  // Every value type the pack's *own* semantics declare, held against what its own readers emit
  // (#61). A pack declaring what a quantity means and shipping nothing that produces it has written
  // a vocabulary no Campaign of it will ever speak: its rules would go UNDETERMINED for a value type
  // nothing emits, which is a Campaign that runs, costs a licence and concludes nothing.
  //
  // Only the pack's own file: the bundle's types are the default library's, and a pack that reads one
  // report with a bundled reader is not thereby promising to produce all eight.
  if (semantics !== undefined) {
    for (const type of ownTypes) {
      if (emittedByAPackReader.has(type)) continue;
      errors.push(
        `${semanticsFileName}: declares the value type "${type}", which none of this pack's own readers emits; `
        + `a value type nothing produces is a rule nothing can ever rule on`,
      );
    }
  }

  // Every rule this pack applies, held against what its value types mean (#61). A rule is data over a
  // vocabulary, and until this ticket that vocabulary was an enum in the bundle, so a rule could not
  // name a type that did not exist. Now it can — a pack brings its own — and a rule needing a type
  // nobody declares, or comparing against a threshold in the wrong unit, is a verdict that would go
  // UNDETERMINED or, worse, compare a count against a nanosecond threshold and call it FAIL.
  if (semantics !== undefined) {
    for (const { ref, rule } of resolvedRules) {
      const named = `rule "${ref}"`;
      for (const requirement of rule.requires) {
        if (!Object.hasOwn(semantics, requirement.type)) {
          errors.push(`${named} needs the value type "${requirement.type}", which no semantics file declares`);
        }
      }
      const subject = semantics[rule.subject.type];
      if (subject !== undefined && subject.unit !== rule.predicate.unit) {
        errors.push(
          `${named} compares "${rule.subject.type}" against a threshold in "${rule.predicate.unit}", `
          + `and the semantics declare that type is measured in "${subject.unit}"`,
        );
      }
    }
  }

  // Every chooser an Explore node names, resolved the way its rules are, and the parameter each one
  // declares held against what the node bound. A guard band nobody bound, or a negative one, inverts
  // what a guard band is for — and finding that out here costs nothing, where finding it out at the
  // Explore node costs a workspace, a licence and two and a half minutes of synthesis.
  //
  // Every graph the pack holds, its drill-down loops included: a loop's Explore node names a chooser
  // exactly as the graph's own does, and a Campaign that could not run one of its loops is as unfit
  // as one that could not run its graph. An Explore node that *opens* a loop names no chooser and is
  // not one of these — what it drills into is checked when the pack is loaded.
  const choosers: ChooserCheck[] = graphsOf(pack)
    .flatMap(({ graph }) => graph.nodes)
    .flatMap((n) => (n.kind === 'explore' && n.parameters.chooser !== undefined ? [{ node: n, ref: n.parameters.chooser }] : []))
    .map(({ node, ref }) => {
      const { bind, converge } = node.parameters;
      const head = { ref, node: node.id };
      let found;
      try {
        found = resolveChooser(pack, ref, 'the reading');
      } catch (err) {
        return fail({ ...head, resolved: undefined, origin: undefined, error: (err as Error).message }, `node "${node.id}": ${(err as Error).message}`);
      }
      const { chooser, origin } = found;
      const resolved = `${chooser.id}@${chooser.version}`;
      const declared = chooser.parameter;
      if (declared) {
        const bound = bind[declared.name];
        if (bound === undefined) {
          const message = `chooser "${ref}" declares parameter "${declared.name}" in ${declared.unit}, and node "${node.id}" binds no value for it`;
          return fail({ ...head, resolved, origin, error: message }, message);
        }
        if (bound < 0) {
          const message = `node "${node.id}" binds ${bound} to chooser parameter "${declared.name}", which must be zero or more`;
          return fail({ ...head, resolved, origin, error: message }, message);
        }
      }
      for (const name of Object.keys(bind)) {
        if (name !== declared?.name) {
          const message = `node "${node.id}" binds "${name}", which chooser "${ref}" does not declare`;
          return fail({ ...head, resolved, origin, error: message }, message);
        }
      }
      // Convergence is stated in the chooser's vocabulary (D43), so the read it names is held
      // against that chooser's own `reads` exactly as the bound parameter is held against its
      // `parameter`. A pack that converges on a value its chooser never reads is a Loop that could
      // only ever end at the generation limit, and finding that out here costs nothing.
      if (converge !== undefined && !Object.hasOwn(chooser.reads, converge.read)) {
        const message = `node "${node.id}" converges on "${converge.read}", which chooser "${ref}" does not read; it reads ${Object.keys(chooser.reads).map((r) => `"${r}"`).join(', ')}`;
        return fail({ ...head, resolved, origin, error: message }, message);
      }
      // Every knob the chooser sets, held against the contract's own declaration (#58): the name
      // declared, and the kind matching — arithmetic over this chooser's numbers for a number knob,
      // one of its own declared words for a choice knob. Here, where a chooser and a pack are held
      // to each other, because it is the one place both files are open at once: a chooser alone
      // cannot tell a read from a word, and a contract alone does not know which chooser it named.
      const knobIssue = chooserKnobIssue(chooser, pack.contract.strategy);
      if (knobIssue !== undefined) {
        const message = `node "${node.id}" applies chooser "${ref}", which ${knobIssue}`;
        return fail({ ...head, resolved, origin, error: message }, message);
      }
      // And every value it reads, held against what that value type means (#61) — the same holding
      // the rules get above and for the same reason. A chooser does arithmetic on what it reads, so a
      // read declared in the wrong unit is a next Strategy computed from a count as though it were a
      // period, which reaches a person as a number and not as a fault.
      if (semantics !== undefined) {
        for (const [name, read] of Object.entries(chooser.reads)) {
          const declared = semantics[read.type];
          if (declared === undefined) {
            const message = `node "${node.id}" applies chooser "${ref}", which reads "${name}" as the value type "${read.type}", which no semantics file declares`;
            return fail({ ...head, resolved, origin, error: message }, message);
          }
          if (declared.unit !== read.unit) {
            const message = `node "${node.id}" applies chooser "${ref}", which reads "${name}" (${read.type}) in "${read.unit}", and the semantics declare that type is measured in "${declared.unit}"`;
            return fail({ ...head, resolved, origin, error: message }, message);
          }
        }
      }
      return { ...head, resolved, origin, error: undefined };
    });

  // Every knowledge file the contract declares, held against the pack's own folder (#57). The
  // workshop's knowledge tool (#62) hands one to a model on request; what the harness itself knows
  // about knowledge is this: that a pack which says it carries a file carries it. A pack whose `knowledge:`
  // promises a file nobody wrote is a pack whose Model moments would open without the one thing they
  // were composed to read, and finding that out here costs nothing.
  //
  // One place looked and not two: the bundle ships no knowledge directory, and it is not going to —
  // domain knowledge is what a HimaPack *is* (CONTEXT.md), so there is nothing generic to fall back
  // to. The refusal says so, because "not found" with one path in it reads like a list that was cut.
  const knowledgeDir = packKnowledgeDir(pack);
  const knowledge: KnowledgeCheck[] = pack.contract.knowledge.map(({ file, purpose }) => {
    const at = path.join(knowledgeDir, file);
    // Asked of the one reading of the folder, which is what makes "a plain file of this pack's own
    // folder" one question rather than three. Nothing can read a directory as Markdown, and a pack
    // whose `knowledge/` holds one where a file was promised is exactly the pack this check exists to
    // catch — its Model moments would open without the thing they were composed to read. A link there
    // never gets this far: the reading refuses the whole folder naming it, because the one thing a
    // pack folder is supposed to hold entirely on its own is its own knowledge (CONTEXT.md).
    const relative = `${packDataDirs.knowledge}/${file}`;
    if (!folder.has(relative)) {
      const message = folder.directories.has(relative)
        ? `knowledge file "${file}" (${purpose}) is at ${at}, which is not a plain file`
        : `knowledge file "${file}" (${purpose}) is not at ${at}, and the bundle ships no knowledge directory to look in after it`;
      return fail({ file, purpose, resolved: undefined, origin: undefined, error: message }, message);
    }
    return { file, purpose, resolved: at, origin: 'pack' as const, error: undefined };
  });

  // Every licence one of the pack's tools holds, held against what the Site declares of it. A Site
  // that declares fewer seats than a tool holds — none at all, or the reference site's node-locked
  // zero, which says the owner reserves nothing of it — is a Site on which a Job of that tool can
  // never launch. Said here, where every other thing a Site cannot host is said, because the
  // alternative is a Run that sits in `waiting-for-slot` until its time box runs out: a slow, costly
  // way of answering a question two files already settle.
  //
  // A workshop's are held exactly as a tool's, and in the same list (#62): the Job a workshop
  // launches takes its seats the same way and would wait for them the same way, so a workshop
  // declaring a seat this Site has none of is a Campaign that would sit in `waiting-for-slot` until
  // its time box ran out. What each entry names is the declaration to go and edit.
  const holders: readonly { readonly id: string; readonly holder: 'tool' | 'workshop'; readonly licences: Readonly<Record<string, number>> }[] = [
    ...pack.contract.tools.map((tool) => ({ id: tool.id, holder: 'tool' as const, licences: tool.licences })),
    ...pack.contract.workshops.map((workshop) => ({ id: workshop.id, holder: 'workshop' as const, licences: workshop.licences })),
  ];
  const licences: LicenceCheck[] = holders.flatMap(({ id, holder, licences: held_ }) =>
    Object.entries(held_).map(([name, held]) => {
      const declared = site.capacity.licences[name];
      const head = { name, tool: id, holder, held, declared };
      const refuse = (why: string): LicenceCheck =>
        fail({ ...head, error: why }, `${holder} "${id}" holds ${held} of "${name}": ${why}`);
      if (declared === undefined) {
        return refuse(`site ${site.name} does not declare it; add it under capacity.licences: in ${site.file}`);
      }
      if (held > declared) {
        return refuse(`site ${site.name} declares ${declared} of it, so a job of this ${holder} could never launch there`);
      }
      return { ...head, error: undefined };
    }),
  );

  // Every word the contract declares, held against the names a face could ever look it up by (#42):
  // the Goal parameters this pack binds, and the knobs a Strategy is made of. A word keyed by
  // anything else is a label nothing will ever read — a face looks each number up by the name it
  // arrives under — so a pack author's clock period would go on being shown as `declared_parameter`
  // with nothing anywhere saying why.
  //
  // Here, with the other things a pack author is told at once, rather than at load: a pack whose
  // words have drifted from its graph is still a pack that runs, and refusing to *load* it would
  // stop a Campaign over a label. `/hima pack check` is where a pack is held to what it promises.
  for (const [name, parameter] of Object.entries(pack.contract.goal ?? {})) {
    const word = pack.contract.words[name];
    if (parameter.type === 'number' && (word === undefined || word.unit !== parameter.unit)) errors.push(`words: Goal parameter "${name}" must have a label and unit "${parameter.unit}" matching its declaration`);
  }
  const usable = [...goalParametersOf(pack), ...strategyKnobsOf(pack)];
  for (const name of Object.keys(pack.contract.words)) {
    if (usable.includes(name)) continue;
    errors.push(
      `words: declares "${name}", which this pack neither takes from its goal nor sets as a strategy knob; `
      + `it uses ${usable.map((n) => `"${n}"`).join(', ')}`,
    );
  }

  // And the same rule from the other side, for the knobs (#58): a knob this contract declares and
  // says no words for is a field on the start form, a line on the card and a column of the ledger
  // that a person reads under the name the wire carries — and a knob is the pack's own invention, so
  // there is nothing else anybody could read it as. The unit goes with the kind: a number is
  // measured in what the declaration says it is measured in, and a choice is measured in nothing.
  for (const [name, knob] of Object.entries(pack.contract.strategy)) {
    const word = pack.contract.words[name];
    if (word === undefined) {
      errors.push(`words: says nothing for strategy knob "${name}", which this pack declares; a knob a person reads is a knob its pack has words for`);
      continue;
    }
    if (knob.type === 'choice') {
      if (word.unit !== undefined) {
        errors.push(`words: gives strategy knob "${name}" the unit "${word.unit}", and it is a choice of ${knob.options.map((o) => `"${o}"`).join(', ')}: a choice is measured in nothing`);
      }
      continue;
    }
    if (word.unit !== knob.unit) {
      errors.push(
        `words: gives strategy knob "${name}" ${word.unit === undefined ? 'no unit' : `the unit "${word.unit}"`}, `
        + `and its declaration states ${knob.unit}: one knob is measured in one thing`,
      );
    }
  }
  // Every other word states a unit, which is what #42 declared a word to be: a choice knob is the
  // one thing a person reads that is not a number, and everything else here is one.
  for (const [name, word] of Object.entries(pack.contract.words)) {
    if (word.unit !== undefined || pack.contract.strategy[name]?.type === 'choice') continue;
    errors.push(`words: declares "${name}" with no unit, and only a choice knob has none: a number with nothing saying what it is measured in is a number nobody can read`);
  }

  // And a released pack held against its own seal (#64), whenever the folder carries one. Here, among
  // the things that make a pack unfit, and not only on the ladder: a Campaign names a pack that
  // cannot have changed under it, so `startRun` — which refuses on this very list before anything is
  // sent to a Site — must refuse a folder whose files are no longer the ones somebody released. A
  // folder carrying no `VERSION.yml` at all answers nothing here, which is every pack that has not
  // been through the release stage, the hand-written ones included.
  // Out of the caller's one reading: the seal is verified against the very bytes the caller goes on
  // to act on, and not against a second walk that would let a file change between the check and the
  // use of it.
  const sealIssue = releaseIssue(folder, pack.contract);
  if (sealIssue !== undefined) errors.push(sealIssue);

  return {
    packId: pack.id,
    packVersion: pack.contract.version,
    siteName: site.name,
    stage: packStageFrom(folder),
    inputs,
    tools,
    workshops,
    rules,
    readers,
    semantics: semanticsCheck,
    choosers,
    knowledge,
    licences,
    errors,
    fit: errors.length === 0,
  };
}

/**
 * What this Site bound for every input the pack's contract names.
 *
 * @throws when any input is unbound. Callers reach this only past a `checkPack` that found the pack
 *         fit, so an unbound input here is a programming fault, never a Site's misconfiguration
 *         reaching a caller as an empty string.
 */
export function boundInputs(pack: Pack, site: Site): Record<string, string> {
  const bindings: Record<string, string> = {};
  for (const input of pack.contract.inputs) {
    const bound = site.bindings[input.name];
    if (bound === undefined || bound === '') throw new Error(`site ${site.name} binds no "${input.name}" for pack ${pack.id}`);
    bindings[input.name] = bound;
  }
  return bindings;
}

// ---------------------------------------------------------------------------------------------
// The stage: how far up the pack authoring pipeline a folder has come (#63).
// ---------------------------------------------------------------------------------------------

// The files the pack authoring pipeline writes, beside the two a pack is executed from, are declared
// with the reading of the folder that leaves them out of a digest (`pack-folder.ts`). They are the
// *authoring* record, not the run template: a Campaign reads none of them, and a pack folder that has
// all of them runs no differently from one that has none. What they are for is answering "how far has
// this been authored, and what does the next stage need" without anyone having to remember the order.
export { pipelineFiles } from './pack-folder.js';

/** The sections a pack intent record holds, each of which must say something (#63, `/hima-grill`). */
export const HIMA_INTENT_SECTIONS = ['Business', 'Golden Flow', 'Answers', 'Ambiguities resolved', 'Knowledge applied'] as const;

/** The sections a pack spec holds, each of which must say something (#63, `/hima-spec`). */
export const HIMA_SPEC_SECTIONS = [
  'Goal template',
  'Constraints',
  'Run contract',
  'Semantics',
  'Judge rules',
  'Choosers',
  'Endings',
  'Workshops',
  'Knowledge',
] as const;

/**
 * The sections a fabric record holds, each of which must say something (#64, `/hima-fabric`).
 *
 * Three, and they are the three questions asked of a compilation rather than a summary of it: what
 * the stage put in the folder, what it could not write because the Golden Flow never showed it, and
 * what the author said about each script it did write. The pack's own files are the compilation; this
 * is the account of it, and `Gaps` and `Reviews` say `none` rather than going missing when there is
 * nothing to say — a section that disappears when it is empty is a record a reader cannot tell from
 * a record a stage never finished.
 */
export const HIMA_FABRIC_SECTIONS = ['Files written', 'Gaps', 'Reviews'] as const;

/**
 * The sections a test record holds, each of which must say something (#64, `/hima-test`).
 *
 * Every one of them is read back off the Run the `Run` section names, and that is the whole design
 * of this record: the stage writes down what HimaLedger already holds, so a person reading the folder
 * sees what a Campaign of this pack actually did without opening the ledger, and nothing in it is a
 * claim the ledger cannot be held against.
 */
export const HIMA_TEST_SECTIONS = ['Site', 'Run', 'Ending', 'Generations', 'Code', 'Refusals', 'Disagreements'] as const;

/**
 * How far up the ladder a pack folder has come. Cumulative: a rung is reached only when its own
 * files and every earlier rung's files are there and validate.
 *
 * `none` is below the first rung — which is where the packs this repository ships stand, because they
 * were written by hand rather than authored by the pipeline, and that is not a fault in them.
 */
export type PackStageName = 'none' | 'intent' | 'specified' | 'compiled' | 'tested' | 'released';

/** What a folder's stage is, and what the rung above it wants. */
export interface PackStage {
  /** The highest rung reached. */
  readonly stage: PackStageName;
  /** The files that validated, in ladder order; empty at `none`. */
  readonly validated: readonly string[];
  /** The rung above, or undefined at the top of the ladder. */
  readonly next: PackStageName | undefined;
  /** One sentence naming what that rung needs and who writes it; undefined at the top. */
  readonly needs: string | undefined;
  /**
   * Why the ladder stopped here, when it stopped on something that is *there* and wrong — a record
   * missing a section, a contract that will not load. Undefined when the next rung's files are
   * simply absent, which is not a fault and is not worth a sentence.
   */
  readonly issue: string | undefined;
}

/** One rung: what it is called, which files it adds, who writes them, and how it is judged. */
interface Rung {
  readonly stage: PackStageName;
  readonly files: readonly string[];
  /** The sentence `next:` says: the file(s) and the skill that writes them. */
  readonly needs: string;
  /** Reached, or not — and when not, whether there is something wrong worth naming. Asked of the
   *  one reading of the folder, never of the path: a ladder that re-read a record between rungs
   *  would be climbing two folders. */
  readonly reached: (folder: PackFolderSnapshot) => { readonly ok: true } | { readonly ok: false; readonly issue: string | undefined };
}

/**
 * The `##` sections one Markdown record holds and what each says, in the order they appear.
 *
 * A section runs from its own heading to the next `##` heading or the end of the file; its body is
 * everything between. Deeper headings (`###`) belong to the section above them.
 *
 * A list and not a map, deliberately: a map would answer "which sections are here" and lose the two
 * facts a record of this pipeline is judged on beside that — what order they came in, and whether
 * one of them came twice.
 */
function markdownSections(text: string): { name: string; body: string }[] {
  const sections: { name: string; body: string }[] = [];
  let name: string | undefined;
  let body: string[] = [];
  const close = (): void => { if (name !== undefined) sections.push({ name, body: body.join('\n') }); };
  for (const line of text.split('\n')) {
    const heading = /^## (.+?)\s*$/.exec(line);
    if (heading) { close(); name = heading[1]!; body = []; continue; }
    if (name !== undefined) body.push(line);
  }
  close();
  return sections;
}

/**
 * Read one record of the pipeline and say what is wrong with it, or nothing when it validates.
 *
 * **Exactly these sections, in this order, and no other heading** — which is word for word what both
 * skill bodies tell the stage that writes it. So the record's ordered `##` heading sequence has to
 * equal the declared list: nothing missing, nothing extra, nothing twice, nothing out of order, and
 * nothing empty. A record that holds another heading, or holds one of its own twice, is a record the
 * stage did not write as instructed, and the stage that reads it next — which reads it section by
 * section, in order — has to be able to tell rather than guessing at which of two `## Business`
 * blocks was meant.
 *
 * The first deviation is named, because a list of everything wrong with a half-written record is a
 * list nobody reads to the end.
 *
 * @param text - the record's whole text.
 * @param sections - the sections it must hold, in the order it must hold them.
 * @param file - the file's name, for the sentence this returns.
 * @param noun - what this record is called, for the sentence this returns ("the intent record").
 * @returns what is wrong, naming the first deviation, or undefined when the record validates.
 */
function recordIssue(text: string, sections: readonly string[], file: string, noun: string): string | undefined {
  const held = markdownSections(text);
  const said = (what: string): string => `${file} is there and does not validate: ${what}`;
  for (let i = 0; i < Math.max(held.length, sections.length); i += 1) {
    const here = held[i]?.name;
    const wanted = sections[i];
    if (here === wanted) continue;
    // A heading this record already used is a duplicate, whatever else is true of it: saying it is
    // "where something else belongs" would send a person looking for the wrong fault.
    if (here !== undefined && held.slice(0, i).some((s) => s.name === here)) return said(`holds "## ${here}" twice`);
    if (here === undefined) return said(`no "${wanted!}" section`);
    // A declared section that is nowhere in the file at all is missing rather than displaced, and
    // that is the more useful half of the truth: the author has a section to write.
    if (wanted !== undefined && !held.some((s) => s.name === wanted)) return said(`no "${wanted}" section`);
    if (!sections.includes(here)) {
      const after = i === 0 ? undefined : held[i - 1]!.name;
      return said(after === undefined
        ? `opens with "## ${here}", which is not a section of ${noun}`
        : `has "## ${here}" after "## ${after}", which is not a section of ${noun}`);
    }
    return said(`has "## ${here}" where "## ${wanted!}" belongs: the sections of ${noun} come in one order`);
  }
  for (const section of held) {
    if (section.body.trim() === '') return said(`the "${section.name}" section says nothing`);
  }
  return undefined;
}

/** A record rung: the file must be there and hold exactly the sections it declares, in order. */
function recordRung(file: string, sections: readonly string[], noun: string): Rung['reached'] {
  return (folder) => {
    const text = folder.text(file);
    if (text === undefined) return { ok: false, issue: undefined };
    const issue = recordIssue(text, sections, file, noun);
    return issue === undefined ? { ok: true } : { ok: false, issue };
  };
}

/**
 * The Run a test record names: the one line its `Run` section holds (#64).
 *
 * Read out of that section and not out of the whole file, because a run id is the one thing in this
 * record that another section may perfectly well quote — a `Generations` line naming the Run it
 * belonged to, a `Refusals` line naming the record it came from — and a rung that took the first id
 * it found anywhere would rest the whole stage on whichever line happened to come first.
 *
 * A record naming **two** Runs names none: a pack is tested by one Campaign, the record is evidence
 * from that Campaign, and taking the first line of two would let the stage — or a person editing
 * afterwards — leave a second Run in the file that nothing is ever held against.
 *
 * @param text - the record's whole text.
 * @returns the run id, or which way the record fails to name exactly one.
 */
export function runNamedByTestRecord(text: string): TestRecordRun {
  const section = markdownSections(text).find((s) => s.name === 'Run');
  if (section === undefined) return { kind: 'none' };
  const anchored = new RegExp(`^run: (${runIdPattern.source})\\s*$`);
  const named: string[] = [];
  for (const line of section.body.split('\n')) {
    const found = anchored.exec(line.trim());
    if (found) named.push(found[1]!);
  }
  if (named.length === 0) return { kind: 'none' };
  if (named.length > 1) return { kind: 'many', runs: named };
  return { kind: 'named', run: named[0]! };
}

/** The ladder, bottom rung first. */
const rungs: readonly Rung[] = [
  {
    stage: 'intent',
    files: [pipelineFiles.intent],
    needs: `${pipelineFiles.intent}, written by /hima-grill`,
    reached: recordRung(pipelineFiles.intent, HIMA_INTENT_SECTIONS, 'the intent record'),
  },
  {
    stage: 'specified',
    files: [pipelineFiles.spec],
    needs: `${pipelineFiles.spec}, written by /hima-spec`,
    reached: recordRung(pipelineFiles.spec, HIMA_SPEC_SECTIONS, 'the pack spec'),
  },
  {
    stage: 'compiled',
    files: [packFiles.contract, packFiles.graph, pipelineFiles.fabric],
    needs: `${packFiles.contract}, ${packFiles.graph} and ${pipelineFiles.fabric}, written by /hima-fabric`,
    // Reached exactly when `loadPack` returns, and not one condition looser. Two YAML files that
    // each pass their own schema are not a pack: the loader also holds the folder's name against the
    // id both files declare, every reference one file makes to the other, the tool files the
    // contract names, the wrappers, the node ids across every graph. A rung that checked the schemas
    // alone would let a folder stand at `compiled` while the thing that runs packs refuses it — and
    // `compiled` is the rung whose whole meaning is "this can be run".
    reached: (folder) => {
      const contractText = folder.text(packFiles.contract);
      const graphText = folder.text(packFiles.graph);
      if (contractText === undefined && graphText === undefined) return { ok: false, issue: undefined };
      // One of the two there without the other is a half-compiled folder, which is a fault and is
      // said as one: the pipeline writes them together, so whichever is missing went missing.
      if (contractText === undefined) return { ok: false, issue: `${packFiles.graph} is there and ${packFiles.contract} is not` };
      if (graphText === undefined) return { ok: false, issue: `${packFiles.contract} is there and ${packFiles.graph} is not` };
      try {
        loadPackFrom(folder);
      } catch (err) {
        return { ok: false, issue: `${packFiles.contract} is there and does not load: ${(err as Error).message}` };
      }
      // And the fabric record beside them (#64). A folder in the pipeline is compiled *by the fabric
      // stage*, and the record is how that stage says what it wrote, what it could not write and what
      // the author made of each script it did — so two YAML files somebody copied in are a pack that
      // loads and a folder nothing has compiled. The rung is deliberately both halves: `loadPack`
      // says the pack can be run, and this says a stage is answerable for it.
      return recordRung(pipelineFiles.fabric, HIMA_FABRIC_SECTIONS, 'the fabric record')(folder);
    },
  },
  {
    stage: 'tested',
    files: [pipelineFiles.test],
    needs: `${pipelineFiles.test}, written by /hima-test`,
    reached: (folder) => {
      const record = recordRung(pipelineFiles.test, HIMA_TEST_SECTIONS, 'the test record')(folder);
      if (!record.ok) return record;
      // The sections are there and say something; the one line the whole record rests on is the Run
      // it was written from. A test record naming no Run is a claim about a Campaign that nothing can
      // be held against — and the host's own check, which has the ledger in hand, is what then holds
      // it against one.
      const named = runNamedByTestRecord(folder.text(pipelineFiles.test)!);
      if (named.kind === 'named') return { ok: true };
      const why = named.kind === 'none'
        ? 'its "Run" section holds no "run: <run id>" line'
        : 'its "Run" section names two runs, and a pack is tested by one';
      return { ok: false, issue: `${pipelineFiles.test} is there and does not validate: ${why}` };
    },
  },
  {
    stage: 'released',
    files: [pipelineFiles.version],
    needs: `${pipelineFiles.version}, written by /hima-release`,
    reached: (folder) => {
      // A folder with no seal is simply a folder that has not been released. One that carries
      // something at that path which is not a plain file never reaches this rung at all: the reading
      // of the folder refused it, naming the path, before any question about the folder was asked.
      if (folder.text(pipelineFiles.version) === undefined) return { ok: false, issue: undefined };
      // The contract is loadable by construction — `compiled` is below this rung — so the seal is
      // held against what it now declares, and then against every file of the folder, all out of the
      // one reading.
      let contract: PackContract;
      try {
        contract = loadPackFrom(folder).contract;
      } catch (err) {
        return { ok: false, issue: `${pipelineFiles.version} is there and ${packFiles.contract} no longer loads: ${(err as Error).message}` };
      }
      const issue = releaseIssue(folder, contract);
      return issue === undefined ? { ok: true } : { ok: false, issue };
    },
  },
];

/**
 * How far up the pack authoring pipeline one folder has come, and what the next stage needs.
 *
 * Cumulative and ordered: the ladder climbs from `none` and stops at the first rung whose files are
 * not there or do not validate, so a folder holding a spec and no intent record is at `none` — the
 * record is what the spec was written from, and a folder missing it has not been authored, whatever
 * else is in it.
 *
 * **Only `ENOENT` is absence.** A file that is there and will not open — a directory where a record
 * should be, one this process may not read — throws naming the path, because "the author has not got
 * that far yet" and "this folder is broken" are different answers and a check that gave the first
 * for the second would send a person to write a file they had already written.
 *
 * @param dir - the pack folder, whether or not anything is in it. Read once, here; every rung is
 *              answered from that one reading.
 * @returns the rung reached, what validated, what the next rung wants, and what stopped the climb.
 * @throws when the folder is not there, holds something that is not a plain file, or cannot be read.
 */
export function packStage(dir: string): PackStage {
  return packStageFrom(snapshotPackFolder(dir));
}

/**
 * The same ladder, climbed over one reading of the folder (#64).
 *
 * The form every caller inside this bundle uses. A ladder that re-read the folder at each rung would
 * be climbing as many folders as it has rungs — and the top rung's whole question is whether the
 * files match a seal, which is a question about one instant or about nothing.
 *
 * @param folder - the one reading of the folder.
 * @returns the rung reached, what validated, what the next rung wants, and what stopped the climb.
 */
export function packStageFrom(folder: PackFolderSnapshot): PackStage {
  const validated: string[] = [];
  let stage: PackStageName = 'none';
  for (const rung of rungs) {
    const reached = rung.reached(folder);
    if (!reached.ok) return { stage, validated, next: rung.stage, needs: rung.needs, issue: reached.issue };
    validated.push(...rung.files);
    stage = rung.stage;
  }
  // Every rung climbed: the top of the ladder, where there is no next stage to name.
  return { stage, validated, next: undefined, needs: undefined, issue: undefined };
}

/**
 * The stage of a folder installed under `packsDir`, or nothing when there is no such folder.
 *
 * What `/hima pack check` asks when the pack it was given has no contract yet: a folder that is
 * there is one the pipeline is still authoring, and it deserves the ladder's answer rather than
 * "unknown pack"; a folder that is not there is a name nobody installed, and still does.
 *
 * **Only `ENOENT` is absence.** An id that is not a pack id, and a path that is there and is not a
 * directory, are both faults and are thrown as such — the first in `loadPack`'s own words, the
 * second naming the path. Answering "no such folder" for either would tell a pack author to author
 * into a folder that can never exist.
 *
 * @param packsDir - the directory holding one directory per installed pack.
 * @param id - the pack id, which is the folder's name.
 * @returns the folder's stage, or undefined when there is no such folder.
 * @throws {PackNotFoundError} when the id is not a pack id at all.
 * @throws when something that is not a directory stands at that path, or the folder cannot be read.
 */
export function packStageOf(packsDir: string, id: string): PackStage | undefined {
  const folder = installedPackFolder(packsDir, id);
  return folder === undefined ? undefined : packStageFrom(folder);
}

/**
 * A folder the reading refused, as the faces that list every installed folder carry it (#64).
 *
 * A value and not a thrown error, and only here: `packStageOf` and `loadPack` still throw, because a
 * caller that named *one* pack is asking about that pack and wants the fault. This is the answer for
 * a caller listing **every** installed folder, where one broken folder is one bad option and not a
 * page nobody can use.
 */
export interface UnreadablePackFolder {
  /** Why, in the reading's own sentence, which names the path. */
  readonly unreadable: string;
}

/** Where one installed folder stands, or why nothing can be said about it (#64). */
export type PackStageOrRefusal = PackStageName | UnreadablePackFolder;

/** Whether a folder's answer is a refusal rather than a rung. */
export const isUnreadablePackFolder = (what: PackStageOrRefusal): what is UnreadablePackFolder => typeof what !== 'string';

/**
 * **How far up the pipeline each installed folder has come, or why one of them cannot be read**
 * (#64).
 *
 * What the start form is marked from. Asked of every installed folder, one at a time, and a folder
 * whose reading refuses — a link out of it, a socket, a name no pack file can have, a file this
 * process cannot open — is that folder's own answer rather than the list's: a person with one broken
 * folder among their packs would otherwise be looking at a page with no start form on it and nothing
 * anywhere saying why, which is the one failure a form cannot recover from by itself.
 *
 * **Only the reading's own refusal is caught**, and nothing else. A packs directory that cannot be
 * listed, a name that is not a pack id, something that is not a directory standing under one: all of
 * those are faults of the *list* rather than of a folder in it, and they are thrown as they were.
 *
 * @param packsDir - the directory holding one directory per installed pack.
 * @returns every installed pack id, with its rung or its refusal.
 */
export function installedPackStages(packsDir: string): Readonly<Record<string, PackStageOrRefusal>> {
  const stages: Record<string, PackStageOrRefusal> = {};
  for (const id of installedPacks(packsDir)) {
    try {
      // A folder that vanished between the listing and the question is `none`, which is what a folder
      // with no pipeline files in it is.
      stages[id] = packStageOf(packsDir, id)?.stage ?? 'none';
    } catch (err) {
      if (!(err instanceof PackFolderError)) throw err;
      stages[id] = { unreadable: err.message };
    }
  }
  return stages;
}

/**
 * **One reading of an installed pack's folder**, or nothing when no folder of that name is there
 * (#64).
 *
 * The one way into a pack folder from a pack id, so that the loader, the ladder, the check, the
 * release and a Run all mean the same thing by "the folder" and all act on one reading of it.
 *
 * **Only `ENOENT` on the folder itself is absence.** An id that is not a pack id, and a path that is
 * there and is not a directory, are both faults and are thrown as such — the first in `loadPack`'s
 * own words, the second naming the path. Answering "no such folder" for either would tell a pack
 * author to author into a folder that can never exist.
 *
 * @param packsDir - the directory holding one directory per installed pack.
 * @param id - the pack id, which is the folder's name.
 * @returns the reading, or undefined when there is no such folder.
 * @throws {PackNotFoundError} when the id is not a pack id at all, or something that is not a
 *         directory stands at that path; naming the path, when the folder holds something that is
 *         not a plain file or cannot be read.
 */
export function installedPackFolder(packsDir: string, id: string): PackFolderSnapshot | undefined {
  // Not a pack id at all: `loadPack`'s own refusal, in `loadPack`'s own words. Answering "no such
  // folder" would say a folder is absent for a string no folder could ever be named, and the caller
  // would then tell a person to author one they cannot create.
  if (!packId.safeParse(id).success) {
    throw new PackNotFoundError(`invalid pack id "${id}"; a pack id is lowercase letters, digits and dashes`);
  }
  // Something there that is not a directory — a file, a link, a socket — throws naming the path, in
  // the one place that decides what a pack folder is (`packFolderAt`): that is not "no pack installed
  // under that name", it is a path a pack folder cannot be, and a person has to be told what is
  // standing in the way.
  return snapshotPackFolderIfThere(packFolderAt(packsDir, id));
}

/**
 * An installed pack and the one reading of its folder it was parsed from (#64).
 *
 * What a caller that is going to act on the folder — check it against a Site, start a Campaign of
 * it, prepare a workspace for it — takes instead of `loadPack`: the pack object and everything else
 * that caller asks about the folder are then the same bytes, so a contract replaced after the load
 * cannot make a Run record one folder's digest while it is driven by another's graph.
 *
 * @param packsDir - the directory holding one directory per installed pack.
 * @param id - the pack id.
 * @returns the reading and the pack parsed out of it.
 * @throws {PackNotFoundError} for a name no folder is installed under, and for an id that is not a
 *         pack id; a plain Error for a folder that is there and does not hang together.
 */
export function loadInstalledPack(packsDir: string, id: string): { readonly folder: PackFolderSnapshot; readonly pack: Pack } {
  const folder = installedPackFolder(packsDir, id);
  if (folder === undefined) {
    throw new PackNotFoundError(`unknown pack "${id}": no ${packFiles.contract} at ${path.join(packsDir, id, packFiles.contract)}`);
  }
  return { folder, pack: loadPackFrom(folder) };
}

// ---------------------------------------------------------------------------------------------
// The test record, held against a ledger (#64). The release itself is `release.ts`.
// ---------------------------------------------------------------------------------------------

/**
 * One record of a Run, as the test record's check reads one.
 *
 * The structural least of a `LedgerRecord`, and deliberately open about `sha256`: the `code` record a
 * generated file is written as (#62) carries one, and this check was written before that record
 * landed so that it would hold the day it did, without an edit that nobody would remember to make.
 */
export interface RunRecordSeen {
  readonly type: string;
  readonly id: string;
  /** The hash of the file a `code` record stands for; absent on every other kind of record. */
  readonly sha256?: string;
}

/**
 * The least of a HimaLedger this module needs: one Run by id, and that Run's own records.
 *
 * Declared here rather than taken as the `Ledger` class, because what the two operations below ask
 * of a ledger is exactly two questions, and a module that opens pack folders has no business being
 * able to write to one.
 */
export interface RunLookup {
  run(id: string): RunRecord | undefined;
  records(query: { readonly runId: string }): readonly RunRecordSeen[];
}

/** What the release and the check both need from a folder's test record and this host's ledger. */
export interface ReleaseDeps {
  readonly packsDir: string;
  readonly ledger: RunLookup;
}

/**
 * **Hold a folder's test record against this host's ledger** (#64): the Run it names exists, it ran
 * this pack, it was a test run, it ended, and it ran the files this folder now holds.
 *
 * The whole point of the test rung is that the record is *evidence* rather than a claim, and every
 * one of those five is a way the evidence can fail to be about this folder. The last is the one that
 * matters day to day: a person who edits a rule after the test stage has a pack nobody has tested,
 * and the record on the disk still says otherwise. The digest excludes the pipeline's own records
 * (`packDigestExcludes`), so writing this very record — and releasing afterwards — does not make the
 * pack disagree with the Run that tested it.
 *
 * And then **three of the record's own claims, held against that Run's records**: the ending it
 * states, the code it says the Run generated, and the refusals it says the Run made. Those five say
 * the record is *about* this Run; these three say the record tells the truth about it. Without them a
 * person could keep the `run:` line, rewrite every other sentence, and release the result — which is
 * the one thing a released pack's evidence chain exists to prevent. Three and not seven, because
 * these are the sections whose content the ledger can be asked about exactly: `Site`, `Generations`
 * and `Disagreements` are the stage's own reading of a Campaign, and a harness that graded prose
 * would be inventing a verdict rather than checking one.
 *
 * **The record and the digest are one reading's** (#64). The record's bytes and the digest they are
 * authorised against both come out of the one reading the pack carries, so there is no arrangement
 * of the filesystem in which the hash of the `TEST.md` a release seals and the Run that `TEST.md`
 * names come from two different instants. A digest passed in as a bare number was the earlier shape
 * of this and was exactly that hazard: whoever called it decided what the comparison compared; a
 * folder passed in beside the pack was the next, and left two readings one call apart.
 *
 * @param pack - the pack, loaded, carrying the one reading of the folder that holds the record.
 * @param runs - this host's ledger, for the Run and its records.
 * @returns what the record names and whether it holds, or undefined when the folder holds no test
 *          record that names one Run — which is a folder below `tested`, and the ladder's business
 *          rather than this one's.
 */
export function checkTestRecord(pack: Pack, runs: RunLookup): TestRecordCheck | undefined {
  const folder = pack.folder;
  const text = folder.text(pipelineFiles.test);
  if (text === undefined) return undefined;
  // What a Run of this folder records: the reading's own digest, less the pipeline's five records,
  // so that writing this very record — and sealing afterwards — does not make the pack disagree with
  // the Run that tested it.
  const digest = folder.digest(packDigestExcludes);
  const found = runNamedByTestRecord(text);
  if (found.kind !== 'named') return undefined;
  const named = found.run;
  const refuse = (why: string): TestRecordCheck => ({ run: named, said: undefined, error: `test record names run ${named}, ${why}` });
  const run = runs.run(named);
  if (run === undefined) return refuse('which this ledger does not hold');
  if (run.packId !== pack.id) {
    return refuse(`which ran ${run.packId === undefined ? 'no pack at all' : `pack ${run.packId}`} and not ${pack.id}`);
  }
  // Absent reads `campaign`, exactly as the row's own schema says: every Run written before this
  // field existed was an ordinary Campaign, and a Campaign is not a test of the pack it ran.
  if ((run.purpose ?? 'campaign') !== 'test') return refuse('which is a campaign run and not a test run');
  // `ended-*` and nothing else. A cancelled Run stopped because a person asked it to, and a Run still
  // running has not said anything yet; neither is a pack tested.
  if (run.status === undefined || !run.status.startsWith('ended-')) {
    return refuse(`which is ${run.status ?? 'a run HimaFabric never started'} and not a run that ended`);
  }
  if (run.packDigest === undefined) {
    return refuse('which recorded no digest of the files it ran: re-run the test stage');
  }
  if (run.packDigest !== digest) return refuse('which ran files that no longer match this folder: re-run the test stage');

  const bound = boundSectionsIssue(text, named, run.status, runs.records({ runId: named }));
  if (bound !== undefined) return { run: named, said: undefined, error: bound };
  return { run: named, said: `test record: run ${named}, ended ${run.status}, files as tested`, error: undefined };
}

/** The lines of one `##` section of a record, trimmed, with the blank ones dropped. */
function sectionLines(text: string, name: string): string[] {
  const section = markdownSections(text).find((s) => s.name === name);
  return (section?.body ?? '').split('\n').map((line) => line.trim()).filter((line) => line !== '');
}

/** The word a section of the test record says when the Run recorded nothing of that kind. */
const NOTHING_OF_THAT_KIND = 'none';

/**
 * The three claims of a test record a ledger can be asked about, held against the Run it names (#64).
 *
 * Each is a line the test stage writes in a form the harness reads, and each is a way an edited
 * record could go on passing every other check in this file: the hashes cover the folder's files and
 * not the record's sentences, and the `run:` line stays valid however the rest is rewritten.
 *
 * @param text - the record's whole text.
 * @param run - the run id it names.
 * @param status - what that Run ended as.
 * @param records - that Run's own records.
 * @returns what differs, naming the section, or undefined when all three hold.
 */
function boundSectionsIssue(text: string, run: string, status: string, records: readonly RunRecordSeen[]): string | undefined {
  const said = (section: string, what: string): string => `test record's ${section} ${what}`;

  // The ending, stated exactly, and stated **once**. `ended-goal-met` and `ended-goal-not-met` are
  // one word apart and mean opposite things about a pack, so the line is the ledger's own word and
  // not a paraphrase — and a record holding two such lines states two endings of one Campaign, of
  // which at most one can be that Run's. Taking the first would let the second stand unread in a
  // sealed record, which is the one thing a released pack's evidence exists to prevent: a run ends
  // once, as the `run:` line names one Run.
  const ending = sectionLines(text, 'Ending');
  const stated = ending.filter((line) => line.startsWith('status:'));
  if (stated.length === 0) return said('Ending', `holds no "status: ${status}" line, and that is what run ${run} ended as`);
  if (stated.length > 1) {
    const many = stated.length === 2 ? 'two' : String(stated.length);
    return said('Ending', `holds ${many} status lines, and a campaign ends once: ${stated.map((line) => `"${line}"`).join(' and ')}`);
  }
  if (stated[0] !== `status: ${status}`) return said('Ending', `says ${stated[0]!} and run ${run} ended ${status}`);

  // Every code record the Run wrote, by its hash: the file a Workshop generated is the part of a
  // Campaign a reader of the record cannot go and look at, so the record carries what identifies it.
  const code = records.filter((r) => r.type === 'code');
  const codeIssue = holdsEachOf(text, 'Code', code.map((r) => ({ what: `the code record ${r.id} wrote`, needle: r.sha256 ?? r.id })), run);
  if (codeIssue !== undefined) return codeIssue;

  // And every refusal, by its record id: a Campaign that refused something and a record that does not
  // say so is precisely the reading a release must not seal.
  const refusals = records.filter((r) => r.type === 'refusal');
  return holdsEachOf(text, 'Refusals', refusals.map((r) => ({ what: `refusal ${r.id}`, needle: r.id })), run);
}

/**
 * One section of the test record against the records it stands for: a line carrying each, or the
 * word `none` and no records at all.
 *
 * `none` exactly, because "there were none" has to be distinguishable from a section somebody
 * emptied: a check that took any prose for "nothing to declare" would accept a record that had been
 * rewritten to say nothing about the very thing it is evidence of.
 */
function holdsEachOf(
  text: string,
  section: string,
  wanted: readonly { readonly what: string; readonly needle: string }[],
  run: string,
): string | undefined {
  const lines = sectionLines(text, section);
  const said = (what: string): string => `test record's ${section} ${what}`;
  if (wanted.length === 0) {
    return lines.length === 1 && lines[0] === NOTHING_OF_THAT_KIND
      ? undefined
      : said(`says ${lines.length === 0 ? 'nothing' : `"${lines.join(' ')}"`}, and run ${run} recorded none: a section with nothing to declare says "${NOTHING_OF_THAT_KIND}"`);
  }
  if (lines.length === 1 && lines[0] === NOTHING_OF_THAT_KIND) {
    return said(`says "${NOTHING_OF_THAT_KIND}", and run ${run} recorded ${String(wanted.length)}`);
  }
  for (const { what, needle } of wanted) {
    if (!lines.some((line) => line.includes(needle))) return said(`holds no line naming ${what} (${needle})`);
  }
  return undefined;
}

/** The rung of the ladder by name; every rung is declared above, so every name has one. */
const rungNamed = (stage: PackStageName): Rung => rungs.find((r) => r.stage === stage)!;

/**
 * **The check, with its test record held against this host's ledger** (#64).
 *
 * `checkPack` opens files and reads a Site file; a ledger is neither, so the one fact that needs one
 * is composed here, by the faces that hold a ledger. A folder whose record no longer stands is
 * reported at the rung it really is on — `compiled`, with what went wrong as the ladder's issue —
 * because "this folder has been tested" is a claim about a Campaign and not about a file being
 * present, and the whole meaning of re-entering a stage after a change is that the change is retested.
 *
 * Only at `tested`, and deliberately not at `released`: a released folder's seal is `VERSION.yml`,
 * which names every file and every hash, and the ledger that holds its test Run is the *author's*.
 * A released pack installed on somebody else's machine would otherwise be unfit there for the one
 * reason a release exists to settle — and it is `releasePack` (`release.ts`), on the author's machine, that
 * refuses to seal a folder whose record does not hold.
 *
 * @param check - what `checkPack` found.
 * @param pack - the pack it was about.
 * @param runs - this host's ledger.
 * @returns the check, with the test record's line or its error in it.
 */
export function withTestRecord(check: PackCheck, pack: Pack, runs: RunLookup): PackCheck {
  if (check.stage.stage !== 'tested') return check;
  const record = checkTestRecord(pack, runs);
  if (record === undefined) return check;
  if (record.error === undefined) return { ...check, testRecord: record };
  const compiled = rungs.slice(0, rungs.findIndex((r) => r.stage === 'tested')).flatMap((r) => [...r.files]);
  const stage: PackStage = {
    stage: 'compiled',
    validated: compiled,
    next: 'tested',
    needs: rungNamed('tested').needs,
    issue: record.error,
  };
  return { ...check, stage, testRecord: record, errors: [...check.errors, record.error], fit: false };
}

/**
 * What asking `/hima pack check` of an installed folder found (#64): the whole check, or the ladder
 * alone for a folder that holds no pack yet.
 *
 * A union rather than a check with holes in it, because the two answers are about different things.
 * `checked` is "this Site can or cannot host this pack", which needs a pack; `not-compiled` is "there
 * is no pack here yet", which is a fact about how far a folder has been authored and is the answer a
 * person standing in their own half-written pack folder needs.
 */
export type PackCheckResult =
  | { readonly kind: 'checked'; readonly check: PackCheck }
  | {
    readonly kind: 'not-compiled';
    readonly pack: string;
    readonly siteName: string;
    /** `not compiled` for a folder with no contract, else the loader's own sentence about it. */
    readonly why: string;
    readonly stage: PackStage;
  };

/**
 * **Hold one installed pack folder against one Site, whatever stage that folder stands at** (#64).
 *
 * The operation behind `/hima pack check` and `hima_pack_check`, in one place so the command face
 * and the model face cannot come to answer a pack author two different things about one folder —
 * which matters more here than anywhere else in this harness, because the fabric stage checks its
 * own work with the model face and a person then checks it with the command face.
 *
 * The Site is loaded first and for itself: a check names a Site, and a Site nobody installed is the
 * caller's mistake whichever folder they asked about.
 *
 * @param deps - where Sites and packs are installed, and this host's ledger.
 * @param req - the pack and the Site.
 * @returns the check, or the ladder for a folder that holds no pack yet.
 * @throws {SiteNotFoundError} for a Site nobody installed; {@link PackNotFoundError} for a name no
 *         folder is installed under, and for an id that is not a pack id at all.
 */
export function checkInstalledPack(deps: ReleaseDeps & { readonly sitesDir: string }, req: { readonly pack: string; readonly site: string }): PackCheckResult {
  const site = loadSite(deps.sitesDir, req.site);
  // One reading of the folder, and every answer below is derived from it: whether it holds a pack at
  // all, which rung it stands on, whether this Site can host it, and whether its own test record
  // still describes it. A check that read the folder once to load it and again to hash it could
  // report a pack that fits and a record that does not, of two different folders.
  const folder = installedPackFolder(deps.packsDir, req.pack);
  if (folder === undefined) {
    throw new PackNotFoundError(`unknown pack "${req.pack}": no ${packFiles.contract} at ${path.join(deps.packsDir, req.pack, packFiles.contract)}`);
  }
  let loaded: Pack;
  try {
    loaded = loadPackFrom(folder);
  } catch (err) {
    // The pack did not load, and there are two ways for that to be true of a folder that is really
    // there: nothing has compiled it yet, or what was compiled does not hang together. Both are
    // answered by the ladder — "unknown pack" for the first would tell a pack author the folder they
    // are standing in does not exist, and the bare loader error for the second would say what is
    // broken without saying which rung it broke on or what writes the file that would fix it.
    //
    // `packStageOf` answers `undefined` only for a folder that is not there at all, which is a name
    // nobody installed and keeps the answer it has always had; for an id that is not a pack id, and
    // for a path holding something that is not a directory, it throws, and those throws are the
    // answer too.
    const why = err instanceof PackNotFoundError ? 'not compiled' : (err as Error).message;
    return { kind: 'not-compiled', pack: req.pack, siteName: site.name, why, stage: packStageFrom(folder) };
  }
  // The check, and then the one fact it cannot reach on its own: whether the Run this folder's test
  // record names is in this host's ledger and ran these very files.
  return { kind: 'checked', check: withTestRecord(checkPack(loaded, site), loaded, deps.ledger) };
}
