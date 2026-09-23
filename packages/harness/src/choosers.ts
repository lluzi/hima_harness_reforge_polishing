// A chooser is data, never code — the same thing a judge rule is, and for the same reason. An
// Explore node names one by id; this module loads that YAML file and applies it. D38: choosers ship
// as YAML under `choosers/` beside the built bundle, so a pack author who wants a different push
// rule edits a file next to `rules/` rather than TypeScript they were told they would never read.
//
// The form is deliberately tiny, exactly as a rule's predicate is: the values it reads out of an
// observation, the one parameter the pack binds, and an ordered list of clauses over the verdicts —
// the first whose `when` matches wins. A clause sets the pack's own strategy knobs by name (#58): a
// number knob from the arithmetic `sum`, `neg`, `abs`, a name it reads and the parameter's name, and
// nothing else; a choice knob to one of that knob's own declared words. A knob the clause does not
// name carries over. A chooser is checkable, not programmable: a form these cannot state is a reason
// to widen this file deliberately, not a reason to embed an expression language.
//
// Determinism is the point (D6): given the verdicts HimaJudge wrote and the values a reader read,
// the same ledger always yields the same next strategy, and a person can re-derive it from the
// decision record and this file alone.
import { strategyFrom } from './run-arguments.js';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { z } from 'zod';
import { analysisMode, pathScope, semanticSlug } from './semantics.js';
import { dataOnDisk, placesLooked, readDataFile, type DataPlace } from './pack-data.js';
import { ChooserReferenceError } from './errors.js';
import type { StrategyDeclaration, StrategyValue } from './run-arguments.js';
import type { DecisionChoice, ObservationRecord, RunStrategy, VerdictRecord } from './ledger.js';
import type { PackConverge } from './packs.js';
import type { SemanticValue } from './semantics.js';

// Re-exported so a caller of `loadChooser` finds the error it can throw right beside it.
export { ChooserReferenceError };

/** What a chooser reads and what its parameter is called: a name a clause may reference. */
const declaredName = z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/, 'a name is a letter followed by letters, digits or underscores');

/** The three outcomes a verdict can have, as a clause matches on them. */
const outcome = z.enum(['PASS', 'FAIL', 'UNDETERMINED']);

/**
 * One value a chooser reads out of an observation: a value type, narrowed by analysis mode and path
 * scope the way a rule's requirement narrows one, and the unit it is measured in. An omitted `mode`
 * or `scope` does not narrow. The unit is not free — it must be the one the semantics bind to the
 * type — so a chooser cannot read a cell area and do nanosecond arithmetic with it.
 *
 * *Which* semantics bind it is no longer a table in this bundle (#61): a value type is declared in a
 * `semantics.yml`, the pack's own ahead of the bundle's, so the pair is held by `/hima pack check`
 * against the file that actually answered — the one place both files are open at once, and the same
 * place a chooser's knobs are already held against the contract that names it.
 */
export const chooserRead = z.strictObject({
  type: semanticSlug,
  unit: semanticSlug,
  mode: analysisMode.optional(),
  scope: pathScope.optional(),
});
export type ChooserRead = z.infer<typeof chooserRead>;

/**
 * What a clause may compute: a name (one of `reads`, or the declared parameter), the sum of several
 * such expressions, or one of them negated or made absolute. Three forms and a name — enough for
 * "period minus slack plus guard band" and for "period plus the violation plus guard band", and not
 * enough to hide a program in a pack.
 */
export type ChooserExpression =
  | string
  | { readonly sum: readonly ChooserExpression[] }
  | { readonly neg: ChooserExpression }
  | { readonly abs: ChooserExpression };

const chooserExpression: z.ZodType<ChooserExpression> = z.lazy(() =>
  z.union([
    declaredName,
    z.strictObject({ sum: z.array(chooserExpression).min(1) }),
    z.strictObject({ neg: chooserExpression }),
    z.strictObject({ abs: chooserExpression }),
  ]),
);

/** What a clause matches on. A key it does not state does not narrow, so `{ constraint: FAIL }`
 *  matches whatever the goal rule concluded. */
const chooserWhen = z
  .strictObject({ constraint: outcome.optional(), goal: outcome.optional() })
  .refine((w) => w.constraint !== undefined || w.goal !== undefined, {
    error: 'a `when` states at least one of `constraint` and `goal`; one matching everything is not a decision',
  });

/**
 * One clause: what it matches, and what it concludes. Exactly one of the two conclusions — a clause
 * saying both the Goal is met and what to try next, or saying neither, is not a decision.
 *
 * `next` is a map of knob name to what that knob is set to (#58) — an expression over this chooser's
 * own numbers for a knob the pack declared as a number, the word it is set to for one the pack
 * declared as a choice, which of the two a bare string is being the pack's declaration to say — and
 * a knob the clause does not name carries over from the Strategy the Run is on: a clause states what
 * it changes, and a generation that changed one knob of three is a generation that says so. At least
 * one knob, because a `next` that changed nothing would be a Loop revisiting its act nodes with the
 * Strategy that just ran.
 */
export const chooserClause = z
  .strictObject({
    when: chooserWhen,
    goalMet: z.literal(true).optional(),
    next: z.record(declaredName, chooserExpression).optional(),
  })
  .refine((c) => (c.goalMet === undefined) !== (c.next === undefined), {
    error: 'a clause either states `goalMet: true` or states `next`, and must state exactly one of the two',
  })
  .refine((c) => c.next === undefined || Object.keys(c.next).length > 0, {
    error: 'a `next` sets at least one knob; one setting none is the strategy that just ran',
  });
export type ChooserClause = z.infer<typeof chooserClause>;

export const chooserSchema = z
  .strictObject({
    id: z.string(),
    version: z.string(),
    title: z.string(),
    /** The one parameter a pack binds in its Explore node. A chooser with none takes its numbers
     *  from its own file alone. */
    parameter: z.strictObject({ name: declaredName, unit: semanticSlug }).optional(),
    reads: z.record(declaredName, chooserRead),
    decide: z.array(chooserClause).min(1),
  })
  .superRefine((c, ctx) => {
    // Every name an *arithmetic* expression references must be something this chooser can supply.
    // Checked here, at load, so a typo inside a `sum` is a broken chooser rather than a Run that
    // blocks after a licence-minute of synthesis.
    //
    // A bare string is not checked here and cannot be (#58): under a number knob it is a read, under
    // a choice knob it is that knob's own word, and which knob a clause is setting is the pack's
    // declaration to say. `checkPack` holds every one of them against that declaration before a
    // Campaign starts, which is where a chooser and a pack are held to each other anyway.
    const known = new Set([...Object.keys(c.reads), ...(c.parameter ? [c.parameter.name] : [])]);
    c.decide.forEach((clause, at) => {
      for (const [knob, next] of Object.entries(clause.next ?? {})) {
        if (typeof next === 'string') continue;
        for (const name of namesIn(next)) {
          if (!known.has(name)) {
            ctx.addIssue({ code: 'custom', message: `clause ${at + 1} sets "${knob}" from "${name}", which is neither one of \`reads\` nor this chooser's parameter`, path: ['decide', at, 'next', knob] });
          }
        }
      }
    });
  });
export type Chooser = z.infer<typeof chooserSchema>;

/**
 * Every name an expression references, so a chooser's references can be checked against what it can
 * supply. Exported because the check a bare string needs is `checkPack`'s — it is the pack's
 * declaration that says whether a knob takes an expression or a word — and one spelling of "what
 * does this expression reach for" is what keeps the two checks the same check.
 */
export function namesIn(expression: ChooserExpression | undefined): string[] {
  if (expression === undefined) return [];
  if (typeof expression === 'string') return [expression];
  if ('sum' in expression) return expression.sum.flatMap(namesIn);
  if ('neg' in expression) return namesIn(expression.neg);
  return namesIn(expression.abs);
}

// ---------------------------------------------------------------------------------------------
// Loading, exactly as a rule loads.
// ---------------------------------------------------------------------------------------------

/** A chooser id is a file name, so it is constrained to a safe shape rather than trusted. */
const CHOOSER_ID = /^[a-z0-9][a-z0-9-]*$/;

/** The shipped choosers directory, `choosers/` beside `lib/` in this package. */
export const shippedChoosersDir: string = fileURLToPath(new URL('../choosers/', import.meta.url));

/** One chooser as it was loaded, and which of the directories asked it came out of (#57), for the
 *  reason `LoadedRule` states: the directory is carried out of the lookup that won, never worked out
 *  again from the filesystem afterwards. */
export interface LoadedChooser {
  readonly chooser: Chooser;
  /** The directory of the place the file was read from. */
  readonly dir: string;
  /** The file itself. */
  readonly at: string;
}

/**
 * Load one chooser by reference, and say where it was read from: `<id>` or `<id>@<version>`. An
 * unknown id, a file that declares a different id, a chooser that fails its schema, or a version
 * that does not match all throw — a chooser the harness cannot produce is an error, never a silent
 * pass.
 *
 * `places` is an ordered list and the first of them holding `<id>.yml` wins, exactly as a rule's is
 * (#57): the pack's own `choosers/` first, the bundle's second, and a miss names both places. A
 * push rule is the *method* a pack sells, so the pack folder is where one belongs; the bundle keeps
 * the few any pack of this kind would otherwise write out again.
 *
 * @param ref - `<id>` or `<id>@<version>`.
 * @param places - where to look, in order, each saying which instant its bytes are from (#64). The
 *                 bundle's own choosers read off the disk, when nothing says otherwise.
 */
export function loadChooserFrom(ref: string, places: readonly DataPlace[] = [dataOnDisk(shippedChoosersDir)]): LoadedChooser {
  const [id = '', wantVersion, ...extra] = ref.split('@');
  if (extra.length > 0 || !CHOOSER_ID.test(id)) throw new ChooserReferenceError(`invalid chooser reference "${ref}"; expected <id> or <id>@<version>`);
  const found = readDataFile(id, places);
  if (!found.ok) throw new ChooserReferenceError(`unknown chooser "${id}": no chooser file at ${placesLooked(found.looked)}`);
  const file = found.at;
  const loaded = chooserSchema.parse(parse(found.text));
  if (loaded.id !== id) throw new Error(`chooser file ${file} declares id "${loaded.id}", not "${id}"`);
  if (wantVersion !== undefined && loaded.version !== wantVersion) {
    throw new ChooserReferenceError(`chooser "${id}" is at version ${loaded.version}, not ${wantVersion}`);
  }
  return { chooser: loaded, dir: found.dir, at: found.at };
}

/** The chooser alone, for the callers that apply one and have no report to make about where it came
 *  from. Everything else is `loadChooserFrom`'s. */
export function loadChooser(ref: string, places: readonly DataPlace[] = [dataOnDisk(shippedChoosersDir)]): Chooser {
  return loadChooserFrom(ref, places).chooser;
}

// ---------------------------------------------------------------------------------------------
// Applying: the verdicts, the observation, and what the pack bound.
// ---------------------------------------------------------------------------------------------

/** What an Explore node hands its chooser: what the pack bound, what was judged, and what was read. */
export interface ChooserInput {
  /** What the Explore node's `bind:` states for each parameter the chooser declares. */
  readonly bound: Readonly<Record<string, number>>;
  /**
   * The knobs this pack's contract declares its Strategy to be made of (#58), and the Strategy the
   * Run is on now.
   *
   * Both, because a chooser states what it *changes*: the declaration says whether a clause's value
   * for a knob is arithmetic or one of that knob's own words, and the current Strategy is what every
   * knob the clause does not name carries over from. A chooser that could not see them would have to
   * state a whole Strategy in every clause, which is a pack repeating itself once per outcome.
   */
  readonly knobs: StrategyDeclaration;
  readonly strategy: RunStrategy;
  /** The verdict of the judge node's FIRST rule — the constraint the outgoing edge was chosen by. */
  readonly constraint: VerdictRecord;
  /** The verdict of its goal rule: whether this generation reached what the Run was started for. */
  readonly goal: VerdictRecord;
  /** The observation both verdicts were read from. */
  readonly observation: ObservationRecord;
  /** Every current required verdict; `goalMet` is refused unless they all passed. */
  readonly verdicts?: readonly VerdictRecord[];
  /** What the Explore node declares convergence to be, when it declares any (D43). */
  readonly converge?: PackConverge;
  /**
   * The read's measured value in each of the Run's *earlier* generations, oldest first — this
   * generation's is read from `observation` above, as everything else here is. Empty in the first
   * generation of a Loop, and empty for a pack that declares no convergence.
   */
  readonly earlier?: readonly number[];
}

/**
 * What a chooser answered. A chooser that cannot choose says why rather than guessing: an unknown
 * value, an unbound parameter, or a pair of verdicts no clause matches is a fact about the
 * generation the Run must be told, never a period computed from a substituted zero.
 */
export type ChooserResult =
  | {
    readonly ok: true;
    readonly chosen: DecisionChoice;
    /** The named numbers used, exactly as the decision record carries them. */
    readonly rationale: Readonly<Record<string, number>>;
  }
  | { readonly ok: false; readonly reason: string };

/** A computed number as a strategy states it, rounded to three decimals — a picosecond where the
 *  number is a period in ns, which is past any tool's resolution. Exported so a caller re-deriving a
 *  decision rounds it the one way the chooser does, rather than a second way. */
export const roundNs = (ns: number): number => Math.round(ns * 1000) / 1000;

/**
 * What one of a chooser's `reads` measured in one observation, or undefined when that observation
 * does not state it, states it as unknown, or states it in another unit.
 *
 * Exported because convergence is decided over the *same* read across generations (D43), and the
 * caller that gathers the earlier generations' values — the Explore node's turn — must narrow each
 * observation exactly as `choose` narrows this one. Two spellings of "the chooser's read out of an
 * observation" would be two answers about whether a Campaign has stopped learning.
 */
export function measuredRead(chooser: Chooser, name: string, observation: ObservationRecord): number | undefined {
  const read = chooser.reads[name];
  if (read === undefined) return undefined;
  const value = valueOf(observation, read);
  if (!value || value.value === null || value.unit !== read.unit) return undefined;
  return value.value;
}

/** One typed value of an observation, narrowed the way a rule's requirement narrows one: a `mode` or
 *  `scope` the read does not state does not narrow, and the last matching value wins. */
function valueOf(record: ObservationRecord, read: ChooserRead): SemanticValue | undefined {
  let found: SemanticValue | undefined;
  for (const value of record.values) {
    if (value.type === read.type && (read.mode === undefined || value.mode === read.mode) && (read.scope === undefined || value.scope === read.scope)) {
      found = value;
    }
  }
  return found;
}

/**
 * Apply a chooser to one generation.
 *
 * Everything it needs is resolved before any clause is matched — every `reads` entry and every
 * declared parameter — because those are what the chooser needs to have chosen at all, exactly as a
 * rule's `requires` are. A chooser that cannot resolve one of them answers with the reason, which is
 * what the Explore node writes onto its blocked node record.
 *
 * Three outcomes, weighed in one order and never another (D43):
 *
 * 1. **Goal met**, when the chooser's own clauses say so. A Campaign that has reached what it was
 *    started for stops there whatever the exploration was doing, because there is nothing left to
 *    learn about a question already answered.
 * 2. **Converged**, when the Explore node declared what that means and the measurements say it has
 *    happened. Weighed before the next Strategy because the next Strategy is exactly what
 *    convergence says is not worth trying: the chooser would otherwise hand back a period the last
 *    two generations already showed makes no difference.
 * 3. **The next Strategy** the matching clause computes.
 *
 * Convergence is the harness's arithmetic over the pack's declaration and not a clause of the
 * chooser file, because a clause sees one generation and this is a statement about several.
 *
 * @param chooser - the chooser file, loaded.
 * @param input - what the pack bound, the two verdicts, the observation they were read from, what
 *                this Explore node calls convergence, and the earlier generations' measured values.
 * @returns the choice with the numbers it was made from, or why no choice could be made.
 */
export function choose(chooser: Chooser, input: ChooserInput): ChooserResult {
  const rationale: Record<string, number> = {};
  for (const [name, read] of Object.entries(chooser.reads)) {
    const value = valueOf(input.observation, read);
    if (!value) {
      return { ok: false, reason: `chooser ${chooser.id} reads "${name}" (${describeRead(read)}), which observation ${input.observation.id} does not state` };
    }
    if (value.value === null) {
      return { ok: false, reason: `chooser ${chooser.id} reads "${name}" (${describeRead(read)}), which is unknown in observation ${input.observation.id}: ${value.unknownReason}` };
    }
    if (value.unit !== read.unit) {
      return { ok: false, reason: `chooser ${chooser.id} reads "${name}" in ${read.unit}, but observation ${input.observation.id} states it in ${value.unit}` };
    }
    rationale[name] = value.value;
  }
  if (chooser.parameter) {
    const bound = input.bound[chooser.parameter.name];
    if (bound === undefined || !Number.isFinite(bound)) {
      return { ok: false, reason: `chooser ${chooser.id} declares parameter "${chooser.parameter.name}" in ${chooser.parameter.unit}, which the explore node binds no number for` };
    }
    rationale[chooser.parameter.name] = bound;
  }

  const clause = chooser.decide.find((c) => matchesWhen(c.when, input));
  if (!clause) {
    return { ok: false, reason: `chooser ${chooser.id} has no clause for a ${input.constraint.outcome} constraint (${input.constraint.ruleId}) with a ${input.goal.outcome} goal (${input.goal.ruleId})${undeterminedReason(input)}` };
  }
  if (clause.goalMet) {
    const unmet = input.verdicts?.find((verdict) => verdict.outcome !== 'PASS');
    if (unmet !== undefined) return { ok: false,
      reason: `chooser ${chooser.id} cannot recommend goal-met because required verdict ${unmet.ruleId} is ${unmet.outcome}${unmet.reason === undefined ? '' : `: ${unmet.reason}`}` };
    return { ok: true, chosen: { goalMet: true }, rationale };
  }
  const converged = convergence(input, rationale);
  if (converged) return converged;
  return nextStrategy(chooser, clause, input, rationale);
}

/**
 * The whole Strategy the matching clause chose: every knob the pack declares, set to what the clause
 * states for it or carried over from the Strategy the Run is on (#58).
 *
 * Which of the two kinds a clause's value is, is the *pack's* declaration and never the chooser's
 * syntax: a number knob's value is arithmetic over what this generation read, a choice knob's is one
 * of that knob's own words. `checkPack` holds every clause against the declaration before a Campaign
 * starts, so reaching one that does not fit here means the pack or the chooser changed under a Run —
 * and that is answered with a reason, exactly as an unreadable read is, never with a knob quietly
 * left where it was.
 */
function nextStrategy(chooser: Chooser, clause: ChooserClause, input: ChooserInput, rationale: Readonly<Record<string, number>>): ChooserResult {
  const undeclared = Object.keys(clause.next ?? {}).find((name) => !Object.hasOwn(input.knobs, name));
  if (undeclared !== undefined) {
    return { ok: false, reason: `chooser ${chooser.id} sets knob "${undeclared}", which this pack's contract does not declare` };
  }
  const strategy: Record<string, StrategyValue> = {};
  for (const [name, knob] of Object.entries(input.knobs)) {
    const next = clause.next?.[name];
    if (next === undefined) {
      // Carried over. A knob the Run is not yet set to is a Strategy the start never composed, which
      // is not a state a Run HimaFabric started can be in.
      const held = input.strategy[name];
      if (held === undefined) return { ok: false, reason: `chooser ${chooser.id} carries knob "${name}" over, and this run is set to no such knob` };
      strategy[name] = held;
      continue;
    }
    if (knob.type === 'choice') {
      if (typeof next !== 'string' || !knob.options.includes(next)) {
        return { ok: false, reason: `chooser ${chooser.id} sets knob "${name}" to ${JSON.stringify(next)}, which is not one of ${knob.options.map((o) => `"${o}"`).join(', ')}` };
      }
      strategy[name] = next;
      continue;
    }
    const unknown = namesIn(next).find((referenced) => !Object.hasOwn(rationale, referenced));
    if (unknown !== undefined) {
      return { ok: false, reason: `chooser ${chooser.id} sets knob "${name}" from "${unknown}", which is neither one of its reads nor its parameter` };
    }
    strategy[name] = knob.precision === undefined ? roundNs(evaluate(next, rationale)) : evaluate(next, rationale);
  }
  const admitted = strategyFrom(input.knobs, strategy);
  if ('error' in admitted) return { ok: false, reason: `chooser ${chooser.id}: ${admitted.error}` };
  return { ok: true, chosen: { strategy: admitted.strategy }, rationale };
}

/**
 * Has this Loop stopped learning? The rule the Explore node declared, applied to the values the
 * ledger holds: the last `generations` moves of the read — each generation against the one before
 * it, this one included — every one of them smaller than the band.
 *
 * `generations + 1` values are needed to make `generations` moves, so a Loop cannot converge before
 * it has run that many: the first generation of a Campaign has moved from nothing, and calling that
 * "no change" would end every Campaign at its second generation.
 *
 * The comparison is strict (`<`), as the declaration says: a move of exactly the band is a move the
 * pack asked to keep exploring on.
 *
 * And it is the *rounded* move that is compared — the very number the rationale below states, in the
 * three decimals every period on the ledger is rounded to. A synthesis tool prints a period at two
 * decimals, so real generations differ by whole hundredths, and in IEEE doubles 2.30 − 2.25 is
 * 0.04999999999999982 while 2.29 − 2.24 is 0.05000000000000004: comparing the raw values would have
 * a band of 0.05 keep exploring on one of those pairs and stop on the other, and would let a record
 * read `values: [2.25, 2.30], band: 0.05, convergeMovedBy: 0.05` — converged on a move equal to its
 * own band. The ending has to be re-derivable from the record (D43), which it is only if the
 * arithmetic the record states is the arithmetic that was applied.
 *
 * @returns the converged decision, or undefined when this Loop has not converged (or declares no
 *          convergence at all, or has not the values to say).
 */
function convergence(input: ChooserInput, rationale: Readonly<Record<string, number>>): ChooserResult | undefined {
  const converge = input.converge;
  if (converge === undefined) return undefined;
  const now = rationale[converge.read];
  // Every one of `reads` is resolved above, and `checkPack` holds the declared read against them
  // before a Campaign starts, so this is a pack whose chooser changed underneath it: not converged,
  // and the Run goes on to the next Strategy rather than being ended on a value nobody has.
  if (now === undefined) return undefined;
  const values = [...(input.earlier ?? []), now];
  const compared = values.slice(-(converge.generations + 1));
  if (compared.length < converge.generations + 1) return undefined;
  const moves = compared.slice(1).map((value, i) => roundNs(Math.abs(value - compared[i]!)));
  if (moves.some((move) => move >= converge.band)) return undefined;
  return {
    ok: true,
    chosen: { converged: { read: converge.read, band: converge.band, generations: converge.generations, values: compared } },
    // The rule's own numbers beside the generation's, so a person re-derives the ending from this
    // record alone: how far the read moved at its most, over how many generations, against which
    // band. Which read it was, and the values themselves, are on the decision's `chosen`.
    rationale: {
      ...rationale,
      convergeBand: converge.band,
      convergeGenerations: converge.generations,
      convergeMovedBy: Math.max(...moves),
    },
  };
}

/** A read as a person reads it in a chooser's reason: `setup_wns (mode setup, scope all)`. */
function describeRead(read: ChooserRead): string {
  const narrowing = [read.mode && `mode ${read.mode}`, read.scope && `scope ${read.scope}`].filter(Boolean);
  return narrowing.length ? `${read.type}, ${narrowing.join(', ')}` : read.type;
}

/** Why a verdict could not be acted on, when one of the two was UNDETERMINED — the usual reason a
 *  chooser has no matching clause, and the one a person most needs spelled out. */
function undeterminedReason(input: ChooserInput): string {
  const said = [input.constraint, input.goal].find((v) => v.outcome === 'UNDETERMINED')?.reason;
  return said === undefined ? '' : `: ${said}`;
}

/** Does this clause match what was judged? A key the clause does not state does not narrow. */
function matchesWhen(when: ChooserClause['when'], input: ChooserInput): boolean {
  return (when.constraint === undefined || when.constraint === input.constraint.outcome)
    && (when.goal === undefined || when.goal === input.goal.outcome);
}

/**
 * One expression, over the numbers already resolved. Every name is known to be one of them — the
 * schema checked that at load — so this cannot reach for a value that is not there.
 */
function evaluate(expression: ChooserExpression, values: Readonly<Record<string, number>>): number {
  if (typeof expression === 'string') return values[expression]!;
  if ('sum' in expression) return expression.sum.reduce((total, term) => total + evaluate(term, values), 0);
  if ('neg' in expression) return -evaluate(expression.neg, values);
  return Math.abs(evaluate(expression.abs, values));
}
