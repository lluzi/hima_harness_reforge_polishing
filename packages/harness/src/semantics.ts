// What a typed value *is*, and where the vocabulary it is drawn from comes from.
//
// Until #61 this file was the vocabulary: an enum of eight value types, an enum of four units, and a
// table binding each type to one of them. That made the harness the author of every quantity a
// Campaign could ever measure — a pack whose method yields a candidate count, an adoption ratio or a
// verification pass could declare a reader for it (#57) and had nowhere to say what the numbers
// meant. D46 says the method is the pack's, so the vocabulary is the pack's too.
//
// So this file is now three things and no list of names:
//
// - the **shape** of a typed value (`semanticValue`), which is the one thing the harness does own:
//   a type, a unit, a number or an honest unknown, and the two fixed qualifier vocabularies;
// - the **loader and resolver** of a `semantics.yml` — the pack's own file first, the bundle's
//   second, exactly as `readDataFile` orders a rule's two directories (#57);
// - the **one validator** every reader's output passes through before it becomes an observation,
//   pack script or bundled reader alike (#61).
//
// A leaf, as `pack-data.ts` is: it reads a file and parses YAML and imports nothing else of this
// bundle, so `ledger.ts`, `rules.ts`, `choosers.ts` and `packs.ts` can all take their shapes from it
// without any two of them coming to hold different answers.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { z } from 'zod';

/**
 * Which analysis pass a timing value came from.
 *
 * One of the harness's two *fixed* qualifier vocabularies, and they stay fixed while the value types
 * themselves become the pack's. A qualifier is not a measurement: it says which of a tool's passes or
 * path groups a number belongs to, every timing tool this harness has met states both, and a rule, a
 * chooser and a reader all narrow by them. A pack that could invent a third mode would be a pack
 * whose values no shipped rule could ever select.
 */
export const analysisMode = z.enum(['setup', 'hold']);
export type AnalysisMode = z.infer<typeof analysisMode>;

/** Which path group a timing value covers. The second fixed qualifier vocabulary; see `analysisMode`. */
export const pathScope = z.enum(['all', 'reg2reg']);
export type PathScope = z.infer<typeof pathScope>;

/**
 * What a value type name and a unit may look like: a lower-case slug.
 *
 * Held to a shape rather than to a list, because the list is now a pack's to write. The shape is what
 * keeps a declared name safe to put in a sentence, a state attribute, a JSON key and a card: no
 * whitespace, no quote, no dollar, nothing a face would have to escape twice or a shell could expand.
 */
export const semanticSlug = z
  .string()
  .regex(/^[a-z][a-z0-9_]*$/, 'a value type or unit is a lower-case letter followed by lower-case letters, digits or underscores');

/**
 * One typed value an observation carries. `value` is `null` exactly when the reader could not find
 * it in the report; then `unknownReason` says why. A reader never substitutes zero or another
 * default for a value it could not find.
 *
 * The unit is *not* free, and neither are `mode` and `scope` — but what binds them is no longer a
 * table in this file. It is the resolved semantics, and `validateReading` below is where every
 * reader's output is held against them, before a single value reaches the ledger. This schema states
 * the one rule that needs nothing declared to be true: a value nobody could read says why.
 *
 * **Strict**, as every schema this harness stores is: a reader writing `unknownReson` has said
 * nothing about why a number is missing, and a schema that dropped the key would store the value as
 * one nobody explained — the very record the refinement below exists to prevent, arrived at through
 * a typo rather than an omission. Every value meets this schema at one gate, `appendReading`,
 * whichever reader produced it: `readingDocument` below parses a pack script's *envelope* and leaves
 * the values in it unparsed, so what a script may write and what a bundled reader may produce are
 * held to this one shape in one place rather than to two spellings of it.
 *
 * `group` names the tool's own path group this value was read out of, when one group is its source.
 * A timing report states several, and which one a number came from is part of what the number means:
 * a setup slack from a synthesis tool's built-in group and a clock period from the design's clock
 * group are both true and are not about the same paths. A value folded over every group (a sum) or
 * stated outside them all (an area) names none. It is deliberately a free string, the tool's own
 * name for the group, because a reader reports what a report says rather than translating it.
 */
export const semanticValue = z
  .strictObject({
    type: semanticSlug,
    value: z.number().nullable(),
    unit: semanticSlug,
    mode: analysisMode.optional(),
    scope: pathScope.optional(),
    group: z.string().optional(),
    unknownReason: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.value === null && !v.unknownReason) {
      ctx.addIssue({ code: 'custom', message: 'unknownReason is required when value is null', path: ['unknownReason'] });
    }
  });
export type SemanticValue = z.infer<typeof semanticValue>;

// ---------------------------------------------------------------------------------------------
// The semantics file: what a value type means, declared by whoever owns the method
// ---------------------------------------------------------------------------------------------

/**
 * What one value type is: the unit it is measured in, and which of the two fixed qualifier
 * vocabularies a value of it carries.
 *
 * `mode` and `scope` list the words a value of this type **must** carry — `setup_wns` carries a mode
 * of `setup` and a scope of `all` or `reg2reg` — and their absence means a value of this type carries
 * none at all. Absence rather than an empty list, because "this quantity is not narrowed by an
 * analysis pass" is a fact about the quantity, exactly as an omitted key is everywhere else here, and
 * a `mode: []` would be a type no value could ever satisfy.
 *
 * Strict, because a hand-written file with a misspelled key is the author's mistake and not a field
 * to drop in silence.
 */
export const semanticDeclaration = z.strictObject({
  unit: semanticSlug,
  mode: z.array(analysisMode).min(1).optional(),
  scope: z.array(pathScope).min(1).optional(),
  description: z.string().optional(),
});
export type SemanticDeclaration = z.infer<typeof semanticDeclaration>;

/** A whole `semantics.yml`: one entry per value type, keyed by the name a reader emits it under. */
export const semanticsFile = z.strictObject({ values: z.record(semanticSlug, semanticDeclaration) });
export type SemanticsFile = z.infer<typeof semanticsFile>;

/** Every value type that resolved, by name: what a reader's output and a pack's rules are held to. */
export type Semantics = Readonly<Record<string, SemanticDeclaration>>;

/** The file name a pack folder — and this bundle — declares its own value types in. */
export const semanticsFileName = 'semantics.yml';

/** The bundle's own semantics, `semantics.yml` beside `lib/` in this package, exactly as `rules/`
 *  and `choosers/` are found. */
export const shippedSemanticsFile: string = fileURLToPath(new URL(`../${semanticsFileName}`, import.meta.url));

/**
 * Read one `semantics.yml`, or say it is not there.
 *
 * Fails closed on everything but absence, for the reason `readDataFile` does (#57): a file that is
 * there and will not open — one this process may not read, a `semantics.yml` that is a directory, a
 * disk that answered with an error — is not the same fact as a pack that declares no semantics of its
 * own. Reading it as absence would run a Campaign on the bundle's vocabulary while a file nobody
 * could open sat in the pack folder saying something else. Only `ENOENT` is absence.
 *
 * @param at - the file.
 * @returns the file's declarations, or undefined when there is no such file at all.
 * @throws naming the file, when it is there and cannot be read or does not parse.
 */
export function readSemanticsFile(at: string): SemanticsFile | undefined {
  let text: string;
  try {
    text = readFileSync(at, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new Error(`cannot read the semantics file ${at}: ${(err as Error).message}`);
  }
  return semanticsFromText(text, at);
}

/**
 * The same file out of text already in hand, named by where that text came from (#64).
 *
 * Apart from the read because a pack's own `semantics.yml` reaches this bundle two ways — off the
 * disk as a node runs, and out of the one reading of the pack folder a check is being made from —
 * and what the two must never differ in is what the file *means* or what is said when it does not
 * read as one. One parse, one set of sentences, two sources of bytes.
 *
 * @param text - the file's text.
 * @param at - where it is, for every sentence said about it.
 * @throws naming the file, when it is not YAML or does not read as a semantics file.
 */
export function semanticsFromText(text: string, at: string): SemanticsFile {
  // The parse, and its own failure wrapped in the same sentence a wrong shape gets. A YAML syntax
  // error says the line and the column and nothing about which file it was reading, and a pack folder
  // holds a contract, a graph, rules, choosers and readers beside this one — so a message that
  // escaped from here would be true, unattributable, and the one thing a person needed was the path.
  let document: unknown;
  try {
    document = parse(text);
  } catch (err) {
    throw new Error(`the semantics file ${at} is not YAML: ${(err as Error).message}`);
  }
  const parsed = semanticsFile.safeParse(document);
  if (!parsed.success) {
    const wrong = parsed.error.issues.map((i) => `${i.path.join('.') || '<the file itself>'}: ${i.message}`).join('; ');
    throw new Error(`the semantics file ${at} does not read as one: ${wrong}`);
  }
  return parsed.data;
}

/** The bundle's own file, read once. */
let shipped: SemanticsFile | undefined;

/**
 * The value types this bundle declares, read from `packages/harness/semantics.yml` the first time
 * anything asks and kept after that.
 *
 * Cached because every observation, every pack check and every rule check resolves through it and the
 * file does not change under a running host; read lazily rather than at import because this module is
 * a leaf that `ledger.ts` imports, and a bundle whose *import* touched the filesystem would fail in
 * places that have nothing to do with semantics.
 *
 * An absent file is an error here and not an absence: the bundle ships this file (it is in
 * `package.json`'s `files`), so a bundle without one is a broken install, and answering "no types at
 * all" would refuse every reading in the product with a sentence about the reading.
 */
export function bundleSemantics(): SemanticsFile {
  if (shipped === undefined) {
    const read = readSemanticsFile(shippedSemanticsFile);
    if (read === undefined) {
      throw new Error(`this bundle ships no ${semanticsFileName}: nothing at ${shippedSemanticsFile}, so no value type is declared at all`);
    }
    shipped = read;
  }
  return shipped;
}

/**
 * The value types in force, out of an ordered list of files: **the first that declares a name wins**.
 *
 * The order is the caller's and is never sorted here — the pack's own `semantics.yml` first, the
 * bundle's second — which is what "the pack comes first" means in this harness (D46), and the same
 * order `readDataFile` resolves a rule or a chooser in. A pack that redeclares a bundled type
 * therefore runs on its own declaration, and one that declares a type the bundle never heard of runs
 * on that; nothing merges the two entries for one name, because a type measured in two units by two
 * files is not one quantity.
 *
 * @param files - the files, in order, each already read (an absent one is undefined).
 */
export function resolveSemantics(files: readonly (SemanticsFile | undefined)[]): Semantics {
  const resolved: Record<string, SemanticDeclaration> = {};
  for (const file of files) {
    if (file === undefined) continue;
    for (const [type, declaration] of Object.entries(file.values)) {
      if (!Object.hasOwn(resolved, type)) resolved[type] = declaration;
    }
  }
  return resolved;
}

/**
 * **The document a reader script writes**: one JSON object holding the values it read (#61).
 *
 * Strict, so a script writing `"valuse"` has written a document holding nothing and is told so,
 * rather than having a key dropped and a reading of nothing pass — the envelope is this schema's
 * whole business.
 *
 * What a *value* is, is deliberately not asked here. It is asked at the one gate (`appendReading`),
 * which both this path and a bundled reader's go through, so a defect in a value says the same
 * sentence whichever reader produced it and there is exactly one place that decides the shape of a
 * value at all. A second strict parse here would be a second place for that sentence to be written,
 * and the bundled path — the one with no schema anywhere else — would still be the one uncovered.
 */
export const readingDocument = z.strictObject({ values: z.array(z.unknown()) });
export type ReadingDocument = z.infer<typeof readingDocument>;

// ---------------------------------------------------------------------------------------------
// The one validator: what a reader produced, against what the semantics and the reader declare
// ---------------------------------------------------------------------------------------------

/** The reader as the validator reads it: who it is and what it said it would emit. */
export interface ReadingDeclaration {
  readonly id: string;
  readonly emits: readonly string[];
}

/** `"a", "b"` — a list of names as a refusal spells them. */
const said = (names: readonly string[]): string => (names.length === 0 ? 'nothing' : names.map((n) => `"${n}"`).join(', '));

/** One value as a refusal names it: the type, and the qualifiers it happened to carry. */
function valueSaid(value: SemanticValue): string {
  const narrowing = [value.mode && `mode ${value.mode}`, value.scope && `scope ${value.scope}`].filter(Boolean);
  return narrowing.length > 0 ? `${value.type} (${narrowing.join(', ')})` : value.type;
}

/**
 * What one qualifier of one value disagrees with, or undefined when it agrees.
 *
 * One function for `mode` and `scope` because they are one rule: a value carries the qualifier
 * exactly when its declaration lists that qualifier's words, and the word it carries is one of them.
 * Two spellings of it would be two answers to what a declared type means.
 */
function qualifierIssue(
  what: 'mode' | 'scope',
  carried: string | undefined,
  allowed: readonly string[] | undefined,
): string | undefined {
  if (allowed === undefined) {
    return carried === undefined ? undefined : `carries ${what} "${carried}", and the semantics declare no ${what} for it`;
  }
  if (carried === undefined) return `carries no ${what}, and the semantics declare it is one of ${said(allowed)}`;
  return allowed.includes(carried) ? undefined : `carries ${what} "${carried}", and the semantics declare it is one of ${said(allowed)}`;
}

/**
 * **Hold what a reader produced against what it and the semantics declare.** The one validator, and
 * the one place a value is allowed to become an observation (#61).
 *
 * Applied to every reader's output alike — a pack's script, read back out of the JSON it wrote, and a
 * reader this bundle ships, whose values are TypeScript objects. Both paths are a claim about a
 * report, and a claim nothing checked is what the Judge would then rule on: a candidate count in
 * nanoseconds compared against a slack threshold, a setup slack that forgot to say which pass it came
 * from, a reader that declared it emits an adoption ratio and quietly emitted none.
 *
 * Two questions, in this order, and every failure of both is answered rather than the first:
 *
 * 1. **Each value against the semantics**: a value of null says why it is unknown; the type is
 *    declared somewhere in the resolved list; the unit is the declared one; `mode` and `scope` are
 *    carried exactly when declared and are among the declared words.
 * 2. **The output against the reader's own declaration**: the set of types produced is the set
 *    `emits` names. A type emitted and not declared is a reader doing something its record does not
 *    say; a type declared and not produced is a report that did not hold what the pack promised, and
 *    reading it as an absent value would put a Campaign's whole conclusion on a rule that quietly
 *    went UNDETERMINED for want of a number nobody noticed was missing.
 *
 * @param reader - the reader's id and what it declares it emits.
 * @param values - what it produced for one report.
 * @param semantics - the resolved value types, the pack's ahead of the bundle's.
 * @returns one sentence per disagreement, in the order they were found; empty when there is none.
 */
export function validateReading(reader: ReadingDeclaration, values: readonly SemanticValue[], semantics: Semantics): string[] {
  const failures: string[] = [];
  const of = (why: string): string => `reader "${reader.id}" ${why}`;
  for (const value of values) {
    // The one rule that needs nothing declared to be true, asked here as well as in the schema above
    // — the schema says a value with no number carries a reason, and this says it again naming the
    // reader and the type, which is what a person reads. Both paths reach it through the one gate,
    // which parses every value with that schema before this validator is called at all, so neither a
    // pack script's JSON nor a bundled reader's objects can be stored past it.
    if (value.value === null && (value.unknownReason === undefined || value.unknownReason === '')) {
      failures.push(of(`read ${valueSaid(value)} as unknown and says nothing about why; a value nobody could read carries the reason it could not`));
    }
    const declaration = semantics[value.type];
    if (declaration === undefined) {
      failures.push(of(`emitted the value type "${value.type}", which no semantics file declares; the ones in force are ${said(Object.keys(semantics))}`));
      continue;
    }
    if (value.unit !== declaration.unit) {
      failures.push(of(`read ${valueSaid(value)} in "${value.unit}", and the semantics declare it is measured in "${declaration.unit}"`));
    }
    const modeIssue = qualifierIssue('mode', value.mode, declaration.mode);
    if (modeIssue !== undefined) failures.push(of(`read ${value.type} and it ${modeIssue}`));
    const scopeIssue = qualifierIssue('scope', value.scope, declaration.scope);
    if (scopeIssue !== undefined) failures.push(of(`read ${value.type} and it ${scopeIssue}`));
  }
  const produced = new Set(values.map((v) => v.type));
  const declared = new Set(reader.emits);
  for (const type of produced) {
    if (!declared.has(type)) failures.push(of(`emitted the value type "${type}", which it does not declare in \`emits\`; it declares ${said([...declared])}`));
  }
  for (const type of declared) {
    if (!produced.has(type)) failures.push(of(`declares it emits "${type}" and its output misses it; it produced ${said([...produced])}`));
  }
  return failures;
}
