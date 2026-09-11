// What a Run's numeric arguments may be, what its Strategy's knobs may be, and how a face says so
// when they are not.
//
// A leaf module with no imports of its own, for the same reason `errors.ts` is one: all three faces
// need it — `/hima run`'s flags, the `hima_run` tool's parameters, and `POST /hima/api/runs`'s body —
// and `remote.ts` is also imported by the browser bundle for its pure contract. Were this table in
// `fabric.ts`, importing it into `remote.ts` would pull that module's Node builtins into a bundle
// that has none. It is also why the *shape* of a declared knob is stated here rather than beside the
// schema that parses it (`packs.ts`, which opens directories): the browser bundle renders a knob's
// field, the routes carry a knob's value, and neither can read that module.
//
// One table, three callers. Three faces onto one operation must refuse the same values for the same
// reason and say so in the same words: a period one face refuses and another synthesizes at is not a
// validation gap, it is two different products.

/** Each argument: what it may be, in words a caller reads, and the predicate that decides it. */
export const runArguments = {
  timeBox: { what: 'a number of minutes greater than zero', allowed: (n: number) => n > 0 },
  // Bounded above, not just below: `retryAllowance` is stored exactly as given, and HimaLedger's own
  // schema for it is `z.number().int().nonnegative()`, which zod itself refuses past
  // `Number.MAX_SAFE_INTEGER` — a bound `Number.isInteger` alone does not enforce, since a double past
  // that point can still read as integral. Without this, `--retries 1e20` passed this check, was
  // stored, and only the ledger's schema ever caught it, on the next open.
  retries: {
    what: `a whole number of attempts, zero or more, at most ${Number.MAX_SAFE_INTEGER}`,
    allowed: (n: number) => Number.isInteger(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER,
  },
  // Bounded above at a thousand, and the bound is a judgement rather than a type's limit: a
  // Generation of the reference pack is two and a half minutes of licensed Design Compiler, so a
  // thousand of them is already several days of one Campaign — past anything a person means by
  // "keep exploring" and well short of the numbers that only fail when the ledger is next opened.
  // Bounded below at one because a Loop that may open no generation at all is a Campaign that
  // cannot start; a person who wants one generation asks for one.
  generations: {
    what: 'a whole number of generations, one or more, at most 1000',
    allowed: (n: number) => Number.isInteger(n) && n >= 1 && n <= 1000,
  },
} as const;
export type RunArgumentName = keyof typeof runArguments;

/** Is this a value that argument may take? A non-finite number never is. */
export const allowsRunArgument = (name: RunArgumentName, value: number): boolean =>
  Number.isFinite(value) && runArguments[name].allowed(value);

/**
 * What a face tells its caller about a value this argument may not take.
 *
 * @param name - the argument.
 * @param spelling - how this face spells it: `--time-box` on a command line, `timeBox` in a request
 *                   body or a tool call. The only part of the message the three faces differ in.
 * @param given - what the caller gave, as they gave it.
 */
export const badRunArgument = (name: RunArgumentName, spelling: string, given: unknown): string =>
  `invalid ${spelling} ${JSON.stringify(given)}; expected ${runArguments[name].what}`;

// ---------------------------------------------------------------------------------------------
// The Strategy's knobs: what the pack declares, and what a value for one may be (#58).
// ---------------------------------------------------------------------------------------------

/**
 * One knob a pack's contract declares its Strategy to be made of: a number in a unit with bounds, or
 * a choice out of a list. Both carry the default a Run of that pack starts at, because a knob a pack
 * declares and states no starting value for is a Run nobody could start without saying so.
 *
 * The harness owns the two *kinds* and nothing else (#58). What the knobs are, what they are called,
 * what they are measured in and what they may be is the pack's — the method that named them is the
 * only thing that knows — and this is the shape it says so in.
 */
export type StrategyKnob =
  | { readonly type: 'number'; readonly unit: string; readonly min: number; readonly max: number; readonly default: number }
  | { readonly type: 'choice'; readonly options: readonly string[]; readonly default: string };

/** A pack's whole declaration: one knob per name, which is the name every face carries it under. */
export type StrategyDeclaration = Readonly<Record<string, StrategyKnob>>;

/** What one knob is set to: a number for a number knob, one of the options for a choice knob. */
export type StrategyValue = number | string;

/** What this knob may be, in words a caller reads — the `what` of the table above, per knob. */
export const strategyKnobWhat = (knob: StrategyKnob): string =>
  (knob.type === 'number'
    ? `a number in ${knob.unit} from ${String(knob.min)} through ${String(knob.max)}`
    : `one of ${knob.options.map((o) => JSON.stringify(o)).join(', ')}`);

/**
 * What a face tells its caller about a value a knob may not take: the knob, the value as they gave
 * it, and the bound or the list it is outside of.
 *
 * One sentence for every face, exactly as `badRunArgument` is one: the window's form, `--set` on the
 * command line and a `strategy` in a request body are three ways of setting one knob, and a value
 * one of them refuses and another starts a synthesis at is two different products.
 */
export const badStrategyValue = (name: string, knob: StrategyKnob, given: unknown): string =>
  `invalid strategy knob "${name}" ${JSON.stringify(given)}; expected ${strategyKnobWhat(knob)}`;

/** What a face says about a knob no pack declares: a caller setting a knob that is not there is
 *  setting nothing, and a Run started for them would run at the defaults without saying so. */
export const unknownStrategyKnob = (name: string, declared: readonly string[]): string =>
  `unknown strategy knob "${name}"; this pack declares ${declared.map((n) => `"${n}"`).join(', ')}`;

/**
 * One knob's value as the declaration allows it, or why it does not.
 *
 * A value arrives as a number from a caller that composed JSON and as text from one that typed into
 * a field or a command line, so text is read as the knob's own type: a number knob parses it, a
 * choice knob takes it as it stands. Nothing else is coerced — a number handed to a choice knob is
 * refused naming the list, because a pack's option is a word and `2` is not one of them.
 *
 * @param name - the knob, as the pack declares and every face carries it.
 * @param knob - what the pack declared it to be.
 * @param given - what the caller set it to.
 */
export function strategyValue(name: string, knob: StrategyKnob, given: StrategyValue): { readonly value: StrategyValue } | { readonly error: string } {
  const refuse = { error: badStrategyValue(name, knob, given) };
  if (knob.type === 'choice') return typeof given === 'string' && knob.options.includes(given) ? { value: given } : refuse;
  const value = typeof given === 'number' ? given : (given.trim() === '' ? Number.NaN : Number(given));
  if (!Number.isFinite(value) || value < knob.min || value > knob.max) return refuse;
  return { value };
}

/**
 * The whole Strategy a Run starts at: the pack's declared defaults, overlaid with what the caller
 * set, with every value held against the declaration.
 *
 * The one place a Strategy is composed, for every face. A knob nobody set takes the pack's own
 * default — the contract declares one for every knob — and a knob nobody declares is refused rather
 * than carried along as a value no node could ever read.
 *
 * @param declaration - the pack's `strategy:` block.
 * @param given - what the caller set, by knob name; empty for a caller that set none.
 * @returns the Strategy, or the first reason it could not be composed.
 */
export function strategyFrom(
  declaration: StrategyDeclaration,
  given: Readonly<Record<string, StrategyValue>> = {},
): { readonly strategy: Record<string, StrategyValue> } | { readonly error: string } {
  const declared = Object.keys(declaration);
  for (const name of Object.keys(given)) {
    if (!Object.hasOwn(declaration, name)) return { error: unknownStrategyKnob(name, declared) };
  }
  const strategy: Record<string, StrategyValue> = {};
  for (const [name, knob] of Object.entries(declaration)) {
    // A knob nobody set takes the pack's own declared default, which every knob has: the contract
    // schema requires one of both kinds, so there is no such thing as a declared knob with no value
    // to fall back on and no sentence here about one.
    const set = Object.hasOwn(given, name) ? given[name]! : knob.default;
    const held = strategyValue(name, knob, set);
    if ('error' in held) return held;
    strategy[name] = held.value;
  }
  return { strategy };
}

/**
 * Why a Run that is not waiting was not resumed, in the one sentence all three faces say it in.
 *
 * Here for the reason the table above is here: `/hima resume`, the `hima_resume` tool and
 * `POST /hima/api/runs/<id>/resume` are three faces onto one operation, and three faces onto one
 * operation must refuse the same thing for the same reason and say so in the same words. Built three
 * times, they had already drifted — one of them alone told the caller that nothing had been written,
 * which is the half of the answer that decides whether they have anything to undo.
 *
 * @param status - where the Run stands, or undefined for a Run HimaFabric never started.
 */
export const notWaitingToResume = (status: string | undefined): string =>
  `this run is ${status ?? 'not a run HimaFabric started'}, and only a waiting run can be resumed; nothing was written`;

/**
 * Why a Run that is waiting could not be re-entered anyway, in the one sentence all three faces say
 * it in: HimaFabric's own reason, closed with the half that says nothing was written.
 *
 * Here for the reason `notWaitingToResume` is here, and it is the same drift caught twice: the three
 * faces built this sentence themselves and only the command told the caller that nothing had been
 * written, which is the half that decides whether they have anything to undo. It is a separate
 * builder rather than a second argument to that one because the two refusals differ in what they
 * know — one has only the Run's status, the other has a reason HimaFabric worked out — and only in
 * the clause they share.
 *
 * @param reason - why HimaFabric would not re-enter this Run, as it said it.
 */
export const unresumableReason = (reason: string): string => `${reason}; nothing was written`;

/**
 * What HimaLedger's own schema declares a Run's stored time box may be, in milliseconds — the unit
 * the ledger keeps, not the unit `--time-box` is spelled in. `timeBox` above only ever sees the
 * minutes a caller typed; every face converts that to milliseconds itself before the value reaches
 * `createRun`, so no face's own check above ever looks at the number that is actually stored. A
 * caller can type a number of minutes this file allows and still produce a millisecond value the
 * ledger's schema does not: `1e15` minutes rounds to `6e19` ms, past `Number.MAX_SAFE_INTEGER`, and
 * `0.000005` minutes rounds to `0` ms, not positive. Either poisons the stored run row: the schema
 * only runs when the domain is opened, so the write itself succeeds and the *next* host start fails
 * to open the ledger at all.
 *
 * Restated here rather than imported from `ledger.ts`'s zod schema (`runBudget.timeBoxMs`) so this
 * module keeps the one property that lets `remote.ts` import it into a browser bundle: no imports of
 * its own, and none of the ledger's storage machinery. `startRun` checks a Run's Budget against this
 * before `createRun`, the same way it composes the first Strategy through `strategyFrom` — a value
 * computed after a face's own validation ran is a value that validation never saw.
 */
export const timeBoxMsBounds = {
  what: `a whole number of milliseconds, from 1 through ${Number.MAX_SAFE_INTEGER}`,
  allowed: (ms: number): boolean => Number.isInteger(ms) && ms > 0 && ms <= Number.MAX_SAFE_INTEGER,
};

/** Is this a value the ledger's schema will accept for a Run's stored time box? */
export const allowsTimeBoxMs = (ms: number): boolean => Number.isFinite(ms) && timeBoxMsBounds.allowed(ms);
