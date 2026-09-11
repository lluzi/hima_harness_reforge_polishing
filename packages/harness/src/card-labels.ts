// What the card says, in words and colours, shared by its two mounts: the HimaGuide tool view in
// dsh's chat (`client/HimaRunCard.tsx`, React in the browser) and the workbench page the harness
// serves at `/hima/` (`workbench.ts`, HTML from the host). One table per state, keyed by the ledger's
// own types, so a status or a node state added to the ledger is a build error here rather than a
// blank in either mount — and one place for the words, so a driver test that read "ended — goal not
// met" off the page is reading what the chat's card would have said.
//
// The workbench page's own start form (#26) has its words here too, at the end. It has one mount and
// not two, so it is not the card — but it is the same kind of thing, what a person reads, and one
// place for that is what keeps a form's promise and its route's refusal the same sentence.
//
// Plain TypeScript with no DOM and no React in it: the host bundle compiles it, and the client build
// bundles it. Nothing here renders; it says what the card says — and, where the two mounts must not
// disagree about more than the words, the little that decides them: in what order the generation
// ledger says it (`ledgerRows`), and the two meters that are read off the records rather than off
// the run row (`attemptsAt`, `seatsHeld`), which are pairings a face would otherwise make twice.
import type { BranchState, BranchView, GenerationJoinView, GenerationState, GenerationView, LoopView } from './generations.js';
import type { DecisionChoice, LoopOutcome, NodeKind, NodeState, RunBudget, RunMeters, RunStatus, RunStrategy } from './ledger.js';
import type { CancelView, DecisionView, ExperienceFileView, ExperienceView, RunHeadView, RunView, RunWord, RunWords } from './remote.js';
import type { SemanticValue } from './semantics.js';
import { experienceMarkdownPath } from './paths.js';
import { cancelSessions, chosenAs, chosenKind, type ChosenKind, type ConvergedChoice } from './record-views.js';
import { runArguments, strategyKnobWhat, type StrategyKnob } from './run-arguments.js';
import { counted } from './words.js';

/** The card's four colours, as dsh's design tokens with a fallback for a page that has none. */
export const good = 'var(--dsw-alias-state-success-primary, #1a7f37)';
export const bad = 'var(--dsw-alias-state-error-primary, #b42318)';
export const warn = 'var(--dsw-alias-state-warn-primary, #a15c07)';
export const plain = 'var(--dsw-alias-label-secondary, #374151)';

export const outcomeColour: Readonly<Record<string, string>> = { PASS: good, FAIL: bad, UNDETERMINED: warn };

/** What a state is called on screen, and the colour it is said in. */
export interface StateLabel { readonly said: string; readonly colour: string }

/**
 * Where a Run stands, in the ledger's own seven words plus what each of them means to a person.
 *
 * Keyed by every `RunStatus` there is, so a status added to the ledger cannot reach a person as a
 * blank: the type makes the omission a build error rather than an empty banner.
 */
export const runStatusLabel: Readonly<Record<RunStatus, StateLabel>> = {
  running: { said: 'running', colour: plain },
  waiting: { said: 'waiting for a person', colour: warn },
  cancelled: { said: 'cancelled by a person', colour: warn },
  'ended-goal-met': { said: 'ended — goal met', colour: good },
  'ended-goal-not-met': { said: 'ended — goal not met', colour: bad },
  // Converged is neither of the other two: the Campaign learned what this flow closes at and stopped
  // spending to learn it again. Said in the warning colour because the Goal was not met and a person
  // reading it has a decision to make, not a failure to fix.
  'ended-converged': { said: 'ended — converged', colour: warn },
  'ended-budget-exhausted': { said: 'ended — budget exhausted', colour: bad },
};

/**
 * What ended a Run where the graph did not, in words: the meter that ran out, or the person who
 * stopped it.
 *
 * Keyed by every `endedBy` the ledger can write, for the reason the statuses are keyed by every
 * status: a meter added to the ledger is a build error here rather than a raw key on a person's
 * screen. `endedBy` is the ledger's own vocabulary — `time-box`, `generation-limit`, `cancel` — and
 * a face printing it as it stands is a face making a person guess which of a Campaign's five
 * allowances that names.
 *
 * One table, every face: `/hima status`, `/hima run`'s ending answer and both mounts of the card say
 * it here, because a Run ended by one thing said two ways is two endings to whoever reads them.
 */
export const endedByLabel: Readonly<Record<NonNullable<RunMeters['endedBy']>, string>> = {
  'time-box': 'the time box',
  'generation-limit': 'the generation limit',
  cancel: 'a person\'s cancel',
};

/**
 * The words for what ended a Run, and the ledger's own key where this build has no words for it.
 *
 * Total for the reason `labelled` is total: the table above is keyed by the type, so a build that
 * compiles knows every meter — but a browser is not the build, and a bundle a week old against a
 * host upgraded this morning would otherwise render `undefined` where the ending should be. A key a
 * person does not recognise is better than a card that says nothing about how the Run ended.
 */
export function labelledEndedBy(endedBy: string): string {
  const words: Readonly<Record<string, string | undefined>> = endedByLabel;
  return words[endedBy] ?? endedBy;
}

/** What each node state means to a person, keyed by every state the ledger can write, for the same
 *  reason the statuses are: a state this card cannot name must not reach a person as a blank. */
export const nodeStateLabel: Readonly<Record<NodeState, StateLabel>> = {
  pending: { said: 'pending', colour: plain },
  running: { said: 'running', colour: plain },
  done: { said: 'done', colour: good },
  retrying: { said: 'retrying', colour: warn },
  blocked: { said: 'blocked', colour: bad },
  cancelled: { said: 'cancelled', colour: warn },
  'waiting-for-slot': { said: 'waiting for a slot', colour: warn },
  reconciled: { said: 'reconciled', colour: plain },
};

/**
 * The word for a state, and the state itself when this build has no word for it.
 *
 * The tables above are keyed by the types, so a state added to the ledger is a build error here —
 * but a *browser* is not the build: it may be running last week's bundle against a host that was
 * upgraded this morning, and then the lookup misses. A miss must render as what the ledger actually
 * says, because the alternatives are both worse than an unfamiliar word: the banner used to print
 * "no fabric state: HimaFabric never started this run", which is a false statement about the Run, and
 * a path row would have read a colour off `undefined` and taken the whole card down with it.
 *
 * @param table - the labels this build knows.
 * @param state - the state the host sent.
 * @returns the label, or the raw state said plainly.
 */
export function labelled(table: Readonly<Record<string, StateLabel | undefined>>, state: string): StateLabel {
  return table[state] ?? { said: state, colour: plain };
}

/** What the banner says of a Run HimaFabric never started: an observation's own Probe-campaign Run. */
export const NO_FABRIC_STATE = 'no fabric state: HimaFabric never started this run';

/** A duration a person reads at a glance: seconds under a minute, then minutes. */
export function duration(ms: number): string {
  if (ms < 1000) return `${String(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${(ms / 60_000).toFixed(1)} min`;
}

// `n thing` or `n things`, so no line reads "1 attempts". The harness says this in one place
// (`words.ts`, which imports nothing, so the browser bundle can have it too) and both cards read it
// from here, where every other word they share is.
export { counted };

/** One typed value as a person reads it: `setup_wns (setup, all)`, or the bare type where neither applies. */
export function nameOf(value: SemanticValue): string {
  const narrowing = [value.mode, value.scope].filter(Boolean);
  return narrowing.length > 0 ? `${value.type} (${narrowing.join(', ')})` : value.type;
}

/**
 * Which of the tool's own path groups a value was read out of, said beside the value itself — and
 * empty for a value that came from no one group.
 *
 * Here rather than in either mount because a period read from the design's clock group and one from
 * a synthesis tool's built-in group are not the same reading, and a person must be told which in the
 * same words wherever the card is: the chat's tool view and the workbench page.
 */
export const groupSaid = (value: SemanticValue): string => (value.group === undefined ? '' : ` · in ${value.group}`);

/**
 * The banner's second line onwards: what the Run is for, what it is set to, and how far into its
 * Loop it is. Each line is absent when the row does not hold it, and each is its own line, so a line
 * the row has not been written yet takes no other with it.
 *
 * What the Run is *allowed* and what it has *spent* are not here, and were until #27b: both mounts
 * carried a compact `budget:` clause and a compact `meters:` clause under this banner, at the same
 * time as `/hima status` printed every meter against its bound. One Budget said two ways is two
 * Budgets, and the one that pairs each meter with the bound it is held to is the one worth keeping —
 * so the card shows the `run-meters` region (`meterRows`), and this says where the Run stands.
 * `/hima status` keeps its own `budget:` line, which is the Budget as the Run was *started* under
 * and belongs beside a command's other start-time facts.
 *
 * The goal and the strategy are said in the pack's own words where the pack declares them (#42), and
 * under the names the wire carries where it does not. Both, from here: the two mounts render these
 * strings, and `/hima status` prints them, so a person who reads a Campaign at a terminal and a
 * person who watches it in the window are reading one sentence about one Goal.
 *
 * @param run - the Run's own row as the view carries it, its pack's words included. The head and not
 *              the whole view, because that is all these three lines are read off — and because
 *              `/hima status` composes them for a row it holds without composing a whole view.
 */
export function bannerLines(run: BannerRun): { readonly goal?: string; readonly strategy?: string; readonly generation?: string } {
  const generation = generationSaid(run);
  return {
    // The name is joined to its value by `=` and the knob to its by a space, which is how each has
    // read since the day it was first printed: a Goal is bound at the start, the way a person spells
    // it on the command line, and a Strategy is what the Run is set to right now.
    ...(run.goal === undefined
      ? {}
      : { goal: `goal: ${Object.entries(run.goal).map(([name, value]) => valueSaid(run.words?.goal?.[name], name, value, '=')).join(', ')}` }),
    ...(run.strategy === undefined ? {} : { strategy: `strategy: ${strategySaid(run.strategy, run.words?.strategy)}` }),
    ...(generation === undefined ? {} : { generation }),
  };
}

/**
 * A whole Strategy as a person reads it: every knob the pack declares, in the pack's own words,
 * separated the way a line of facts is (#58).
 *
 * One function for every face that says a Strategy — the card's banner on both mounts, the decision
 * a chooser made, `/hima status`, the generations table, the Campaign's report — because a Strategy
 * said two ways is two Strategies, and this harness has already paid once for that (#42).
 *
 * @param strategy - the knobs, by the name the wire carries each under.
 * @param words - what the pack calls them; a knob it says nothing about is shown under its name.
 */
export const strategySaid = (strategy: RunStrategy, words: Readonly<Record<string, RunWord>> | undefined): string =>
  Object.entries(strategy).map(([name, value]) => valueSaid(words?.[name], name, value, ' ')).join(', ');

/** What the banner is read off: the Run's own numbers, how far into its Loop it is, and what its
 *  pack calls those numbers. */
export type BannerRun = Pick<RunHeadView, 'goal' | 'strategy' | 'generation' | 'budget' | 'words'>;

/**
 * One of the values a Run is stated in, as a person reads it: the pack's own words for it where the
 * pack declares them, and the name the wire carries it under where it does not.
 *
 * The precision is the number's own, either way. A Goal of 2.3 ns is shown as `2.3` and not as
 * `2.30`: what a person typed, and what the ledger holds, is what they are shown — a face that
 * rounded to a fixed width would be a face that could show two different Runs the same number.
 */
const valueSaid = (word: RunWord | undefined, name: string, value: number | string, separator: string): string => {
  if (word === undefined) return `${name}${separator}${String(value)}`;
  // A knob the pack declared as a choice is measured in nothing, so there is nothing to put after it
  // (#58): `mining profile dense`, where a number reads `clock period 2.25 ns`.
  return word.unit === undefined ? `${word.label} ${String(value)}` : `${word.label} ${String(value)} ${word.unit}`;
};

/**
 * Which Generation of its Loop the Run is in, against what the Budget allows it, in the words
 * `/hima status` says it in — one Campaign, one sentence, wherever a person reads it.
 *
 * Its own line and not a rider on the Strategy's, because the two are written at different moments:
 * a Run is opened in generation one and gets its `strategy` only when HimaFabric moves it to
 * `running`, so a Campaign a person is watching start would say nothing at all about how far in it
 * was if this hung off a line that was not there yet. A Run HimaFabric never started is in no
 * generation and says nothing.
 */
const generationSaid = (run: Pick<RunHeadView, 'generation' | 'budget'>): string | undefined =>
  (run.generation === undefined ? undefined : `generation ${String(run.generation)}${run.budget === undefined ? '' : ` of at most ${String(run.budget.generationLimit)}`}`);

/** How a node's Job ended, as the path row says it, or undefined while nothing has settled it. */
export function jobEnding(view: RunView, jobSession: string | undefined): string | undefined {
  const settled = view.jobs.find((j) => j.job.session === jobSession && j.event !== 'launched');
  if (settled === undefined) return undefined;
  if (settled.event === 'killed') return 'killed';
  return settled.exitCode === undefined ? 'no exit status' : `exit ${String(settled.exitCode)}`;
}

/**
 * What the decision chose, in the card's words — including the whole of the convergence rule, since
 * "converged" on its own is a verdict a person cannot check and this card is where they read it.
 *
 * Takes the choice and not the whole view, because the same sentence is said in two places about two
 * shapes that carry it: the decision section, off the run view's latest `DecisionView`, and each row
 * of the generations table, off that generation's own decision record (#25b). A second wording for
 * the second place would be the card saying one decision two ways.
 */
export function chosenSaid(decision: { readonly chosen: DecisionChoice }, words?: RunWords): string {
  const chosen = chosenAs(decision);
  switch (chosen.kind) {
    case 'goal-met': return 'goal met';
    case 'converged': return convergedSaid(chosen.converged);
    // The whole Strategy chosen, in the pack's words (#58): every knob, the ones the chooser moved
    // and the ones it carried over, because what the next generation is set to is what a person
    // reads this decision against.
    default: return `next strategy: ${strategySaid(chosen.strategy, words?.strategy)}`;
  }
}

/** The convergence rule as a sentence: which read, over how many generations, against which band,
 *  and the values it compared. */
export const convergedSaid = (converged: ConvergedChoice): string =>
  `converged: ${converged.read} moved by less than ${String(converged.band)} over `
  + `${counted(converged.generations, 'generation')}, at ${converged.values.map(String).join(' then ')}`;

/**
 * The colour each kind of choice is said in, keyed by every kind there is for the reason the status
 * table is: a kind the ledger gains cannot reach a person in a colour nobody chose.
 *
 * Converged is the plain colour and not the success colour. The success colour is what the card says
 * the Goal met in, and converged is precisely the Goal *not* met — the exploration stopped learning
 * — which the banner beside it already says in the warning colour. Said in green, the sentence and
 * the banner above it would be the card saying two things about one ending.
 */
const chosenColour: Readonly<Record<ChosenKind, string>> = {
  'goal-met': good,
  converged: plain,
  'next-strategy': good,
};

/** The colour the card says this decision in, on both of its mounts. */
export const decisionColour = (decision: DecisionView): string => chosenColour[chosenKind(decision)];

/**
 * What a decision's state attributes say: which kind of choice, and the whole Strategy when it chose
 * one.
 *
 * The Strategy goes on as JSON and not as one attribute per knob (#58), for a reason the DOM
 * decides: an attribute name is case-folded, so a knob whose name carries a capital would be read
 * back without it, and two knobs whose names differ only in case would be one attribute. A driver
 * reads the knobs by the names the pack actually declares, which is what every other face carries
 * them under, or reads the words themselves out of the region's text.
 */
export function decisionState(decision: DecisionView): Readonly<Record<string, string>> {
  const chosen = chosenAs(decision);
  switch (chosen.kind) {
    case 'converged': return { chosen: chosen.kind, read: chosen.converged.read };
    case 'next-strategy': return { chosen: chosen.kind, strategy: JSON.stringify(chosen.strategy) };
    default: return { chosen: chosen.kind };
  }
}

/**
 * One cited record named as what it is where this same view carries it — a verdict or an
 * observation — and as its bare id when the view does not.
 */
export function citedSaid(view: RunView, recordId: string): string {
  const verdict = view.verdicts.find((v) => v.recordId === recordId);
  if (verdict) return `${verdict.outcome} of ${verdict.ruleId}@${verdict.ruleVersion}`;
  const observation = view.observations.find((o) => o.recordId === recordId);
  return observation ? `the observation of ${observation.path}` : recordId;
}

// ---------------------------------------------------------------------------------------------
// The generations table (#25b): what a Campaign has done, generation by generation
// ---------------------------------------------------------------------------------------------

/**
 * The generations table's column heads, in the order the table shows them: what the Campaign asked
 * for and measured, what was concluded of it, what was decided, and what it cost in wall clock.
 *
 * Keyed rather than a bare list so each mount names the column it is rendering, and so the two
 * mounts cannot come to show the same six columns in two orders.
 */
export const generationColumns: Readonly<Record<'generation' | 'period' | 'slack' | 'verdicts' | 'decision' | 'wall', string>> = {
  generation: 'generation',
  // Two things in one column because they are read against each other: what the Strategy asked the
  // flow for, and the clock period the report it produced states. A generation where the two differ
  // is a generation whose tool did not synthesize at what it was given, which is the first thing a
  // person wants to see. The asked side is the whole Strategy in the pack's words (#58), because
  // what a Strategy is made of is the pack's — this column shows every knob it set.
  period: 'strategy → period (asked → observed)',
  slack: 'slack',
  verdicts: 'verdicts',
  decision: 'decision',
  wall: 'wall time',
};

/**
 * A number the ledger does not hold for this row, in the one place both mounts read it from.
 *
 * An em dash and not a zero, and not an empty cell either: a generation whose report has not been
 * read yet is a fact about what is known, and a zero in a period column is a measurement nobody
 * took. Exactly the reason a reader never substitutes a default for a value it could not find.
 */
export const NOT_HELD = '—';

/** What a generation's verdicts column says while its Judge node has not run: here beside `NOT_HELD`
 *  for the reason every other word of the card is, so the two mounts cannot come to say it two ways. */
export const NOTHING_JUDGED = 'nothing judged yet';

/**
 * One row's first quantity column: the Strategy it asked for in the pack's words, then the clock
 * period the report stated.
 *
 * On a Generation's own row the asked side is always known — the run row keeps the Strategy the Run
 * started with — so only the measurement can be missing there. A branch of a fork is the one row
 * where it is not (#29b): what a branch's act node was given is the pack's to state, a Strategy knob
 * for one branch and a literal in the graph for another, and the ledger carries neither, so that
 * side is the em dash and never the generation's asked Strategy standing in for it.
 *
 * @param row - the generation's row, or a branch's, whichever of the two it holds.
 * @param words - what the pack calls its knobs; a knob it says nothing about is shown under its name.
 */
export const askedObservedSaid = (
  row: { readonly strategy?: RunStrategy; readonly observedPeriodNs?: number },
  words?: Readonly<Record<string, RunWord>>,
): string =>
  `${row.strategy === undefined ? NOT_HELD : strategySaid(row.strategy, words)} → ${row.observedPeriodNs === undefined ? NOT_HELD : String(row.observedPeriodNs)}`;

/** One row's slack column: the setup slack that generation closed with, or that none was read. */
export const slackSaid = (row: { readonly slackNs?: number }): string =>
  (row.slackNs === undefined ? NOT_HELD : String(row.slackNs));

/** One row's decision column, said as the decision section says it, or that it has not decided yet. */
export const generationDecisionSaid = (row: { readonly decision?: string }): string => row.decision ?? NOT_HELD;

/** What each generation state is called on its row, keyed by every one there is, for the reason the
 *  statuses and node states are: a state this card cannot name must not reach a person as a blank. */
export const generationStateLabel: Readonly<Record<GenerationState, StateLabel>> = {
  running: { said: 'running', colour: plain },
  done: { said: 'done', colour: good },
  blocked: { said: 'blocked', colour: bad },
};

/**
 * What the generations region's state attributes say: how many rows there are, which row a person is
 * looking at now — the one running, else the last, because a Campaign that has ended is read from
 * its end — and the state of each row under its own key, `g<n>`.
 *
 * Here rather than in either mount, for the reason `decisionState` is: a driver reads one set of
 * keys, and two mounts computing them separately are two sets waiting to disagree.
 */
export function generationsState(rows: readonly GenerationView[]): Readonly<Record<string, string>> {
  const current = rows.find((r) => r.state === 'running') ?? rows[rows.length - 1];
  return {
    count: String(rows.length),
    ...(current === undefined ? {} : { current: String(current.generation) }),
    ...Object.fromEntries(rows.map((r) => [`g${String(r.generation)}`, r.state])),
  };
}

// ---------------------------------------------------------------------------------------------
// Drill-down (#28): what a nested Loop is called on the card, and what the region says of them all
// ---------------------------------------------------------------------------------------------

/**
 * What each ending a drill-down Loop can reach is called on screen, keyed by every one there is for
 * the reason the statuses and the node states are: an outcome this card cannot name must not reach a
 * person as a blank.
 *
 * The colours are the Run statuses' read one level down. A Loop that met its Goal answers its
 * sub-question, so it is the success colour; converged is plain, for the reason a converged decision
 * is — it is the Goal *not* met and the card must not say two things about one ending; and a spent
 * generation limit is the warning colour, because the sub-question was not answered and the outer
 * graph is going on regardless, which is a thing a person may want to look at.
 */
export const loopOutcomeLabel: Readonly<Record<LoopOutcome, StateLabel>> = {
  'goal-met': { said: 'goal met', colour: good },
  converged: { said: 'converged', colour: plain },
  'generation-limit': { said: 'generation limit', colour: warn },
};

/** What a Loop that has not closed yet is called: open, and still counting. */
export const LOOP_OPEN = 'open';

/**
 * One nested Loop in one line: what it is called, what it came to, and how many Generations that
 * took. Here rather than in either mount, for the reason every other word of the card is here.
 *
 * The count is of the rows the view holds and not of a field on any record, so an open Loop says how
 * far it has got and a closed one says what it took — one sentence either way, and never a Loop that
 * reads as finished because its ending happens to be missing.
 */
export const loopSaid = (loop: LoopView): string =>
  `${loop.name}: ${loop.outcome === undefined ? LOOP_OPEN : labelled(loopOutcomeLabel, loop.outcome).said}, ${counted(loop.generations.length, 'generation')}`;

/**
 * Where a nested Loop's group of rows begins: the Explore node whose `opens:` it is, which is the row
 * of the outer graph the group hangs under.
 *
 * Said beside `loopSaid` at the head of the group, so the two moments of a Loop are both on the card
 * — this is where it opened, and `loopClosedSaid` under the last of its rows is what closed it. The
 * node id sits inside the sentence rather than in a face of its own, exactly as the decision block's
 * `by <chooser> at <nodeId>` does.
 */
export const loopOpenedSaid = (loop: LoopView): string => `opened at ${loop.nodeId}`;

/** What the foot of a group says for a Loop nothing has closed: the Run is still inside it, and the
 *  rows above are how far it has got, not what it came to. */
export const LOOP_NOT_CLOSED = 'still open';

/**
 * Where a nested Loop's group of rows ends: what closed it, in the outcome's own words, or that
 * nothing has.
 *
 * The outcome is said twice on a closed group — once in the head's one line and once here — because
 * a group of rows a person scrolls through has two ends, and the ending is what the outer graph then
 * acted on. `LOOP_NOT_CLOSED` is the one thing the head cannot say: `loopSaid` calls an open Loop
 * "open" among its counts, and this says it where an ending would have been.
 */
export const loopClosedSaid = (loop: LoopView): string =>
  (loop.outcome === undefined ? LOOP_NOT_CLOSED : `closed — ${labelled(loopOutcomeLabel, loop.outcome).said}`);

/**
 * What the loops region's state attributes say: how many drill-down Loops this Run has opened, and
 * the name of the one that is still open — empty when none is, which is every Run that is not
 * standing inside a Loop right now.
 *
 * Takes the whole view because a Loop hangs off the generation that opened it, and how many a
 * Campaign opened is a fact about the Campaign rather than about any one of its generations. Here
 * for the reason `generationsState` is: a driver reads one set of keys, and two mounts computing
 * them separately are two sets waiting to disagree.
 */
export function loopsState(view: RunView): Readonly<Record<string, string>> {
  const loops = loopsIn(view);
  return { count: String(loops.length), open: loops.find((l) => l.outcome === undefined)?.name ?? '' };
}

/** Every drill-down Loop this Run opened, in the order its generations opened them. */
export const loopsIn = (view: RunView): LoopView[] => view.generations.flatMap((g) => g.loops ?? []);

/**
 * One row of the generation ledger: a Generation's own row at either depth, or one of the two rows
 * that bracket a nested Loop's group of them.
 *
 * The siblings are the Loop's own rows for a nested Generation and the outer graph's for an outer
 * one, because "how much did this generation move the period" is a question about the Generation
 * before it *in the same Loop* — a nested row measured against the outer row above it would be a
 * move nothing made.
 */
export interface LedgerGenerationRow {
  readonly kind: 'generation';
  readonly row: GenerationView;
  /** The Loop this row is a Generation of, absent on a row of the outer graph. */
  readonly loop?: LoopView;
  readonly siblings: readonly GenerationView[];
}

/** The head or the foot of one nested Loop's group: the bracket around its Generations' rows. */
export interface LedgerBracketRow {
  readonly kind: 'loop-head' | 'loop-foot';
  readonly loop: LoopView;
}

/**
 * One branch of a fork as a row of the same table (#29b): what that branch ran, read and was judged
 * to be, under the row of the generation that forked it.
 *
 * A row of its own and not a clause of the generation's, because a fork is several things happening
 * at once and one row can only say one of them: two branches read two reports at two periods, and a
 * table that folded them together would show one branch's measurement beside another's verdict.
 */
export interface LedgerBranchRow {
  readonly kind: 'branch';
  readonly branch: BranchView;
  /** The generation that forked, whose row is directly above this one. */
  readonly row: GenerationView;
}

/** The foot of a forked generation's group: what the join concluded once every branch reached it. */
export interface LedgerJoinRow {
  readonly kind: 'join';
  readonly row: GenerationView;
  readonly branches: readonly BranchView[];
  /** **This** generation's join, as its own records say (`generations.ts`), so a row's line is the
   *  join of the fork on that row and never the latest transition of a judge node the Run reached
   *  in some later generation. Absent for a fork that neither closed nor is still open. */
  readonly join?: GenerationJoinView;
}

export type LedgerRow = LedgerGenerationRow | LedgerBracketRow | LedgerBranchRow | LedgerJoinRow;

/**
 * Every row the generation ledger shows, at both depths, in the order it shows them: an outer
 * generation, then — for each branch of the fork it ran — that branch's row, and the join's line
 * under them; then, for each Loop that generation opened, that Loop's head, its Generations' rows
 * and its foot; then the next outer generation.
 *
 * A generation's branches come before the Loops it opened for the reason they come after its own
 * row: the branches ran *inside* this generation, so its own row and the fork it drew are read
 * together before anything a later node of it opened.
 *
 * The one walk of the tree. Both mounts render their rows from this list and the workbench page's
 * plot lays its x-axis out over the Generation rows of it, so "one order for the picture and the
 * table, and never two" is a property of this function rather than a promise three hand-kept walks
 * have to keep agreeing on. Here, beside `loopsIn` and for the same reason `generationsState` is
 * here: what the two mounts must say identically is said once.
 *
 * It is the ledger's order and not wall-clock time. A Loop's turns run *inside* the generation
 * whose row they hang under, and the view carries no instant to lay them against; what the order
 * says is "these rows, in this order", which is what `LEDGER_ORDER` says on screen.
 */
export function ledgerRows(rows: readonly GenerationView[]): LedgerRow[] {
  return rows.flatMap((row): LedgerRow[] => [
    { kind: 'generation', row, siblings: rows },
    ...(row.branches === undefined ? [] : [
      ...row.branches.map((branch): LedgerRow => ({ kind: 'branch', branch, row })),
      // An absent key, never an undefined one, as everywhere else a row is composed.
      { kind: 'join', row, branches: row.branches, ...(row.join === undefined ? {} : { join: row.join }) } satisfies LedgerRow,
    ]),
    ...(row.loops ?? []).flatMap((loop): LedgerRow[] => [
      { kind: 'loop-head', loop },
      ...loop.generations.map((inner): LedgerRow => ({ kind: 'generation', row: inner, loop, siblings: loop.generations })),
      { kind: 'loop-foot', loop },
    ]),
  ]);
}

/**
 * What the ledger's left-to-right actually is, said on the card of a Campaign that drilled down.
 *
 * The rows are in the ledger's own order and the plot's axis follows them, which on a Campaign with
 * a Loop in it is not the order of the clock: an outer generation's own measurement can be taken
 * after the Loop it opened has closed, and it is still drawn and listed above that Loop's rows,
 * because a picture ordered differently from the rows beneath it would be two accounts of one
 * Campaign. That is worth keeping and it is not self-evident, so the card says it.
 *
 * Only on a Campaign that opened a Loop: with no Loop the ledger's order *is* the clock's, and a
 * line correcting a reading nobody could have made is a line in the way.
 */
export const LEDGER_ORDER = 'the ledger\'s own order, not the clock\'s: a drill-down\'s generations ran inside the outer generation whose row they hang under';

// ---------------------------------------------------------------------------------------------
// Fork and join (#29): what one branch is called on the card, and what the region says of them all
// ---------------------------------------------------------------------------------------------

/**
 * What each state a branch of a fork can be in is called on screen, keyed by every one there is for
 * the reason the statuses and the node states are: a state this card cannot name must not reach a
 * person as a blank.
 *
 * The colours are the node states' read one branch up, because a branch is a little chain of act
 * nodes and what it is doing is what its current node is doing: running is plain, a branch queued
 * behind the Site's cap is the warning colour — nothing is wrong, but a person watching a fork that
 * is taking a long time is looking for exactly this — done is the success colour, and a branch whose
 * allowance is spent is the error colour, because that one is a person's to clear.
 */
export const branchStateLabel: Readonly<Record<BranchState, StateLabel>> = {
  running: { said: 'running', colour: plain },
  'waiting-for-slot': { said: 'waiting for a job slot', colour: warn },
  done: { said: 'done', colour: good },
  blocked: { said: 'blocked', colour: bad },
};

/**
 * How many Jobs this branch has launched of its own — the number a person watching a fork under a
 * job cap is reading, because it is what says whether a branch has had its turn on the Site yet.
 */
export const branchJobsSaid = (branch: BranchView): string =>
  counted(branch.jobs.filter((j) => j.event === 'launched').length, 'job');

/**
 * One branch of a fork in one line: which branch, where it stands, and how many Jobs it launched.
 * Here rather than in either mount, for the reason every other word of the card is here.
 *
 * One line is a command line's shape (`/hima status`). The card has columns instead: the ledger's
 * generation column is 104 px wide, because that is the proportion every other row of that table is
 * read by, so it heads the branch's row with the id and the state's own pill and says the Job count
 * beside the Job itself (`branchLines`). Both faces are composed of the same words either way.
 */
export const branchSaid = (branch: BranchView): string =>
  `${branch.id}: ${labelled(branchStateLabel, branch.state).said}, ${branchJobsSaid(branch)}`;

/**
 * What one branch did, in the sentences under its numbers: the Job it launched and how that Job
 * ended, the moment it queued behind a full Site, and the blocker it stopped at.
 *
 * The branch's own records and nothing else — how many Jobs it has launched, its latest launch, its
 * `waiting-for-slot` transition and its `blocked` one, the last two carrying the sentence the engine
 * wrote at the time. A card that composed its own sentence for a blocked branch would be a second
 * account of a failure a person is being asked to clear.
 *
 * The Job count leads, because it is what a person watching a fork under a job cap is looking for and
 * because it is the one thing here that is true of a branch that has launched nothing at all.
 *
 * @param view - the Run the card is showing, which is where a Job's ending is read from.
 * @param branch - the branch this row is about.
 * @returns one sentence per thing there is to say, in the order they happened; empty for a branch
 *          that has launched nothing and stopped at nothing.
 */
export function branchLines(view: RunView, branch: BranchView): string[] {
  const launched = branch.jobs.findLast((j) => j.event === 'launched');
  const ending = launched === undefined ? undefined : jobEnding(view, launched.job.session);
  const waited = branch.nodes.findLast((n) => n.state === 'waiting-for-slot');
  const blocked = branch.nodes.findLast((n) => n.state === 'blocked');
  return [
    `${branchJobsSaid(branch)}${launched === undefined ? '' : ` · session ${launched.job.session}`}${ending === undefined ? '' : ` · ${ending}`}`,
    ...(waited?.reason === undefined ? [] : [waited.reason]),
    ...(blocked?.reason === undefined ? [] : [blocked.reason]),
  ];
}

/**
 * **What a fork concludes**, in words, under the branches it concluded it over.
 *
 * The rule itself is the engine's and is stated once (`forkOutcome`, `packs.ts`): PASS only where
 * every branch passed, UNDETERMINED wherever any is, else FAIL. This is that rule said to a person
 * beside the outcome the join actually wrote, and never a second computation of it — the card reads
 * the judge node's own outcome off the Run's path, so a card and an engine that came to disagree
 * would show the engine's answer.
 */
export const FORK_RULE = 'a fork passes only when every branch does';

/**
 * The join's line, under a forked generation's branches: which judge node they converge into, what it
 * concluded over all of them, and the rule it concluded by.
 *
 * Said off **that generation's own join** (`GenerationView.join`) and off nothing wider. The Run's
 * path holds one entry per node, so a card that read the judge node's outcome there would write the
 * join's latest transition on every generation that ever forked — and a fork still open would
 * relabel the closed fork above it. Which is why "it has judged nothing yet" is said for exactly one
 * generation: the one whose fork is open, whose join is the one with an id and no outcome.
 *
 * The outcome itself is never recomputed here. It is what the join's own turn wrote (`forkOutcome`,
 * `packs.ts`: PASS only where every branch passed), so a card and an engine that came to disagree
 * would show the engine's answer; this adds the rule in words beside it.
 *
 * @param join - this generation's join, as the run view folded it.
 * @param branches - the branches of the generation this line sits under.
 */
export function joinSaid(join: GenerationJoinView | undefined, branches: readonly BranchView[]): string {
  if (join === undefined) return 'the join has judged nothing';
  if (join.outcome === undefined) return `the join at ${join.nodeId} has judged nothing yet: it waits for every branch`;
  return `the join at ${join.nodeId} judged ${counted(branches.length, 'branch')}: ${join.outcome} — ${FORK_RULE}`;
}

/**
 * What the branches region's state attributes say: how many branches this Run has forked into, and
 * the join of the fork it is standing inside — empty when it is standing inside none, which is every
 * Run whose branches have all reached their join.
 *
 * `open` names the **fork** and not a branch of it, exactly as `loopsState`'s names the Loop: what
 * the region says is which fork is open, and a fork's name on this card is the judge node its
 * branches converge into — the node the run row itself stands at for as long as the fork is open.
 * Which branch is still running is each branch's own row (`branchSaid`), where a person reads it
 * beside what that branch has done.
 *
 * Read off the run row, which is the one thing that says whether a fork is open at all: a Run
 * cancelled inside a fork leaves branches that are neither done nor running, and the row is what
 * still says the Run was stopped inside one.
 *
 * Takes the whole view because a branch hangs off the generation that forked, and how many a
 * Campaign forked into is a fact about the Campaign rather than about any one of its generations.
 * Here for the reason `loopsState` and `generationsState` are: a driver reads one set of keys, and
 * two mounts computing them separately are two sets waiting to disagree.
 */
export function branchesState(view: RunView): Readonly<Record<string, string>> {
  return { count: String(branchesIn(view).length), open: view.run.fork?.join ?? '' };
}

/** Every branch this Run forked into, in the order its generations forked them.
 *
 *  Takes the generations and not the whole view, because that is all it reads and because the one
 *  face that has generations without a view is `/hima status`, which folds them itself. */
export const branchesIn = (view: { readonly generations: readonly GenerationView[] }): BranchView[] =>
  view.generations.flatMap((g) => g.branches ?? []);

// ---------------------------------------------------------------------------------------------
// The Budget's meters (#27): every meter of a Campaign against the bound it was started under
// ---------------------------------------------------------------------------------------------

/**
 * What the meters are read off: the Run's row, where it stands in its graph, the Hard blockers it
 * has hit, and the Jobs it has launched.
 *
 * Narrower than the whole run view on purpose, and structural rather than named: a `RunView`
 * satisfies it, and so does what `/hima status` already has in its hands — the run row and the
 * records it is describing. Both faces show the same meters against the same bounds, and a face that
 * had to build a whole run view to say a line of text would be a second answer waiting to happen.
 *
 * Almost no number here is one this module works out: every meter is on the row, put there by
 * `advance` out of the records, and every bound is on the Budget, copied at start, so what is mostly
 * done here is the pairing and the words. The two exceptions are read off the records because they
 * are not facts about the Run as a whole and the row does not carry them — which node the Run is
 * actually spending its Retry allowance at and how many attempts it has made there (`attemptsAt`),
 * and how many seats of each licence its open Jobs are holding right now (`seatsHeld`). Both are
 * here rather than in each mount for the reason the words are: two faces computing them separately
 * are two answers waiting to disagree.
 */
export interface MeteredRun {
  readonly run: {
    readonly budget?: RunBudget;
    readonly meters?: RunMeters;
    readonly generation?: number;
    readonly currentNode?: string;
  };
  /** One entry per node the Run touched, carrying the state it is in now — the run view's `nodes`,
   *  and the same fold `/hima status` prints its node lines from. */
  readonly nodes: readonly { readonly nodeId: string; readonly kind: NodeKind; readonly state: NodeState; readonly attempt: number }[];
  readonly blockers: readonly { readonly nodeId: string; readonly attempts: number }[];
  readonly jobs: readonly {
    readonly event: 'launched' | 'finished' | 'killed';
    readonly job: { readonly session: string };
    readonly licences?: Readonly<Record<string, number>>;
  }[];
}

/**
 * The node whose attempts the Retry allowance is being spent at, and how many it has made.
 *
 * Where the Run stands — except at the graph's Wait node, which is where a Run is parked *because*
 * some other node's allowance ran out, and the attempts a person wants to see there are that node's.
 * That is the same pairing `resumeRun` makes when it re-enters a waiting Run: the last Hard
 * blocker's node, not the node the row happens to name. A meter that said "attempt 1 of 2" about the
 * Wait node would be telling a person the allowance is untouched at the very moment it is spent.
 *
 * The blocker taken there is the last one whose node is *still* blocked, because a blocker stays on
 * the record after the resume that cleared it: a Run that blocked at generation one, was resumed,
 * and reached the Wait node again in generation three for a reason of its own — an UNDETERMINED the
 * pack labelled no edge for — must not be shown the attempts of a node that has been `done` since.
 * A Run at the Wait node with no such blocker is one routed there by something that spent no
 * allowance at all, and the Wait node's own attempt is then what there is to say.
 *
 * Undefined for a Run standing at no node this view knows about, which is a Run that has not begun.
 */
function attemptsAt(view: MeteredRun): { readonly nodeId: string; readonly attempts: number } | undefined {
  const standing = view.nodes.find((n) => n.nodeId === view.run.currentNode);
  if (standing !== undefined && standing.kind !== 'wait') return { nodeId: standing.nodeId, attempts: standing.attempt };
  const blocker = view.blockers.findLast((b) => view.nodes.some((n) => n.nodeId === b.nodeId && n.state === 'blocked'));
  if (blocker !== undefined) return { nodeId: blocker.nodeId, attempts: blocker.attempts };
  return standing === undefined ? undefined : { nodeId: standing.nodeId, attempts: standing.attempt };
}

/**
 * The seats of each licence this Run's Jobs are holding at this moment.
 *
 * A Job holds its seats for exactly as long as its launch is open, which is the rule the job cap
 * counts a Site's slots by. What settles one here is the Job's own `finished` or `killed` record —
 * the two the harness writes from something actually observed on the Site — and nothing else.
 *
 * So this is deliberately the stricter half of `licenceMs`'s rule (`budget.ts`), which also lets the
 * node record by which the *Run* gave up on a launch stop the clock. The two answer different
 * questions and a line carrying both says both: `licenceMs` is what this Campaign has accounted for,
 * and stops when the Run stops waiting; this is what has been seen released, and a Job that vanished
 * without writing an exit status has released nothing anybody watched. A blocked Run still saying it
 * holds the Site's only seat is a Run worth going and looking at, which is the direction a licence
 * meter has to err in: a card saying a seat is free while dc_shell still holds it is the one wrong
 * answer it must never give.
 */
function seatsHeld(view: MeteredRun): Readonly<Record<string, number>> {
  const held: Record<string, number> = {};
  for (const launch of view.jobs) {
    if (launch.event !== 'launched' || launch.licences === undefined) continue;
    if (view.jobs.some((j) => j.event !== 'launched' && j.job.session === launch.job.session)) continue;
    for (const [name, seats] of Object.entries(launch.licences)) held[name] = (held[name] ?? 0) + seats;
  }
  return held;
}

/**
 * What the meters region's state attributes say: every meter beside the bound it is held to, so a
 * driver — and a person reading the page's own attributes — can compare the two without parsing a
 * sentence.
 *
 * One key per number rather than one per line, and the ledger's own units throughout
 * (milliseconds, counts), because a state attribute is read by a machine and `meterLines` below is
 * what is read by a person. A meter the row does not hold yet is an absent key, never a zero: a Run
 * HimaFabric never started has spent nothing and been allowed nothing, and a zero elapsed against a
 * zero box would say something false about both.
 *
 * `licence-<name>` is `held/declared` — the seats this Run's open Jobs hold, over what the Site
 * declared and the Budget copied at start — one key per licence the Site declares, so a licence
 * nothing is holding still says the Run has seats available to it. The name is lower-cased there,
 * and this is the only key where that shows: every key here becomes a `data-hima-state-<key>`
 * attribute on both mounts, and an HTML attribute name is lower-cased by the DOM whether it was
 * written by the parser or by React — so a key spelled `licence-Design-Compiler` here would be read
 * back off the page as `licence-design-compiler`, which is two key sets disagreeing, which is the
 * one thing this function exists to prevent. The licence's own spelling is on the line a person
 * reads (`meterLines`), where it is the Site's word and not an attribute name.
 */
export function metersState(view: MeteredRun): Readonly<Record<string, string>> {
  const { budget, meters, generation } = view.run;
  const attempts = attemptsAt(view);
  const held = seatsHeld(view);
  return {
    ...(meters === undefined ? {} : { 'elapsed-ms': String(meters.elapsedMs), jobs: String(meters.jobsLaunched) }),
    ...(generation === undefined ? {} : { generation: String(generation) }),
    ...(budget === undefined ? {} : {
      'time-box-ms': String(budget.timeBoxMs),
      'generation-limit': String(budget.generationLimit),
      'job-cap': String(budget.jobCap),
      'retry-allowance': String(budget.retryAllowance),
      ...Object.fromEntries(Object.entries(budget.licences).map(([name, seats]) => [`licence-${name.toLowerCase()}`, `${String(held[name] ?? 0)}/${String(seats)}`])),
    }),
    ...(attempts === undefined ? {} : { attempts: String(attempts.attempts) }),
    ...(meters?.endedBy === undefined ? {} : { 'ended-by': meters.endedBy }),
  };
}

/**
 * Which meter a row is, spelled exactly as `metersState` spells that meter's numbers: the five
 * meters there are, and the ending, and one open arm for the licences — a Site names those, so that
 * arm cannot be closed, and the name is lower-cased there for the reason `metersState` says.
 *
 * A union and not a `string`, so a mount pairing a row with a state attribute is pairing two words
 * the compiler knows, and a sixth meter added to `meterRows` without a key of its own does not
 * compile.
 */
export type MeterKey = 'elapsed' | 'generation' | 'jobs' | 'attempts' | 'ended-by' | `licence-${string}`;

/**
 * One meter of the Budget as a face shows it: which meter it is, what it is called, the whole
 * sentence that says it, that sentence beside its name, and — for a meter a bar can honestly draw —
 * the two numbers that bar is drawn from.
 *
 * The sentence is finished, so a mount renders it and words none of its own; the key is the same
 * word `metersState` puts that meter's numbers under, so a mount pairing a row with a state
 * attribute does it by name and never by position.
 *
 * The name is here and not in either mount because a card that draws its meters puts the name in a
 * column of its own — name, bar, sentence, the three columns the verdict band's meters have had
 * since #41 — while a face that draws nothing prints the sentence whole. Both readings are the same
 * words: `said` is what it always was, byte for byte, so `/hima status` is untouched by this.
 *
 * A bar says "this much of that much", so only a quantity that accumulates against a bound of the
 * same kind carries one: elapsed against the time box, the generation against the limit, and the
 * attempts at the node the Retry allowance is being spent at against that allowance. The Job line
 * has none, because `jobsLaunched` counts every launch over a Run's life while the job cap bounds
 * how many may run *at once* — a bar of one against the other would read as an overrun of a bound
 * nothing overran. A licence line has none for the same reason: seats held is a count at this
 * moment, and the licence-milliseconds beside it are a duration of another kind altogether.
 */
export interface MeterRow {
  /** Which meter this is, in the word `metersState` puts its numbers under. */
  readonly key: MeterKey;
  /** What this meter is called, for a face that gives the name a column of its own: `elapsed`,
   *  `generation`, `jobs`, `attempts`, the licence's own spelling, `ended by`. The Site's word for a
   *  licence and not the lower-cased attribute name — this is read by a person. */
  readonly label: string;
  /** The whole line, in the words every face says it in. */
  readonly said: string;
  /** What goes beside the label on a face that shows one: the sentence, less the label where the
   *  label is the word the sentence opens with, and the whole sentence where it is not. Split here,
   *  once, so that neither mount takes a word off the front of a sentence of its own. */
  readonly detail: string;
  /** What a bar of this meter is drawn from, where one may be drawn at all. */
  readonly bar?: { readonly now: number; readonly bound: number };
  /** True for the meter that ended this Run — the one a person opening the card is looking for, and
   *  the one a mount draws in the colour it says an ending in. Absent — never `false` — on every
   *  other row, because a meter that ended nothing has nothing to say here. */
  readonly spent?: boolean;
}

/** A row as `meterRows` writes it, before the sentence is set beside its name. */
type NamedMeter = Omit<MeterRow, 'detail'>;

/**
 * The sentence as it is read beside its own name: `elapsed 10.4 s of a time box of 10.0 min` is the
 * name `elapsed` and the rest of it, and `3 jobs launched, at most 1 job at a time` is the whole
 * sentence beside the name `jobs`, because the word "jobs" is not what that sentence opens with and
 * cutting one out of the middle would be a second wording of a meter.
 *
 * So a name is split off only where it is already the first word — which is every meter whose
 * sentence names itself first (elapsed, the generation, each licence, the ending) — and added beside
 * the sentence otherwise. Either way the words are the ones `said` has, and a face with no column
 * for a name still prints `said`.
 */
const besideItsName = (row: NamedMeter): MeterRow =>
  ({ ...row, detail: row.said.startsWith(`${row.label} `) ? row.said.slice(row.label.length + 1) : row.said });

/**
 * Every meter of this Campaign against its bound, one row each, in the words a person reads them
 * in: `/hima status` prints the sentences and the card's own `run-meters` region shows them beside
 * their bars, and there is one wording of each because a Budget said two ways is two Budgets.
 *
 * A row is there only when the run row holds both halves of it — a Run HimaFabric never started has
 * no Budget and no meters, and says nothing here rather than a list of dashes.
 *
 * The Job line pairs two numbers that bound different things and says so: `jobsLaunched` counts
 * every Job this Run has ever launched, while the job cap bounds how many may be running at once. It
 * is still the Job meter's bound — it is the only thing that ever refuses a launch — so the two are
 * shown together and the sentence is careful not to read as an overrun.
 */
export function meterRows(view: MeteredRun): MeterRow[] {
  const { budget, meters, generation } = view.run;
  const endedBy = meters?.endedBy;
  const rows: NamedMeter[] = [];
  if (meters !== undefined && budget !== undefined) {
    rows.push({
      key: 'elapsed',
      label: 'elapsed',
      said: `elapsed ${duration(meters.elapsedMs)} of a time box of ${duration(budget.timeBoxMs)}`
        + (meters.waitedMs === undefined ? '' : `, ${duration(meters.waitedMs)} of it waiting on a person, which widens the box by as much`),
      bar: { now: meters.elapsedMs, bound: budget.timeBoxMs },
      ...(endedBy === 'time-box' ? { spent: true } : {}),
    });
  }
  if (generation !== undefined && budget !== undefined) {
    // The time each Generation took, said inline after the count: what a Campaign's box was actually
    // spent on is one generation getting slower or one going nowhere, and that is only legible as
    // the list of them beside the bound the count is held to.
    const spent = meters?.generationMs ?? [];
    rows.push({
      key: 'generation',
      label: 'generation',
      said: `generation ${String(generation)} of at most ${String(budget.generationLimit)}`
        + (spent.length === 0 ? '' : `, ${spent.map(duration).join(' then ')}`),
      bar: { now: generation, bound: budget.generationLimit },
      ...(endedBy === 'generation-limit' ? { spent: true } : {}),
    });
  }
  if (meters !== undefined && budget !== undefined) {
    rows.push({ key: 'jobs', label: 'jobs', said: `${counted(meters.jobsLaunched, 'job')} launched, at most ${counted(budget.jobCap, 'job')} at a time` });
  }
  const attempts = attemptsAt(view);
  if (meters !== undefined) {
    // The Retry allowance is per node per generation, so the bound belongs to the node the Run is
    // spending it at; the Campaign's own count of turns taken has no bound at all and is said beside
    // it, because it is the number that says what the exploration has cost in tries. A Run standing
    // at no node this view knows about has the count and no bound, so it has no bar either.
    const at = attempts === undefined || budget === undefined
      ? ''
      : `${attempts.nodeId}: attempt ${String(attempts.attempts)} of a retry allowance of ${String(budget.retryAllowance)}, and `;
    rows.push({
      key: 'attempts',
      label: 'attempts',
      said: `${at}${counted(meters.attempts, 'attempt')} in the campaign so far`,
      ...(attempts === undefined || budget === undefined ? {} : { bar: { now: attempts.attempts, bound: budget.retryAllowance } }),
    });
  }
  if (budget !== undefined) {
    const held = seatsHeld(view);
    for (const [name, seats] of Object.entries(budget.licences)) {
      const spent = meters?.licenceMs?.[name];
      rows.push({
        key: `licence-${name.toLowerCase()}`,
        label: name,
        said: `${name} ${counted(held[name] ?? 0, 'seat')} of ${String(seats)} declared`
          + (spent === undefined ? '' : `, held for ${duration(spent)}`),
      });
    }
  }
  if (endedBy !== undefined) rows.push({ key: 'ended-by', label: 'ended by', said: `ended by ${labelledEndedBy(endedBy)}` });
  return rows.map(besideItsName);
}

/**
 * The same meters as bare sentences, for a face that draws nothing: `/hima status` and `/hima run`'s
 * ending answer print one line each.
 *
 * The rows above and nothing else, so a command and a card cannot come to say a Budget two ways.
 */
export const meterLines = (view: MeteredRun): string[] => meterRows(view).map((row) => row.said);

// ---------------------------------------------------------------------------------------------
// The two controls on the card, and what a cancel actually did (#26)
// ---------------------------------------------------------------------------------------------

/** One control a person clicks, and a driver clicks after them: its marker and its word. */
export interface ControlLabel { readonly control: string; readonly said: string }

/**
 * The card's two controls, in the one place both mounts read them: the workbench page the window
 * shows and the tool view in dsh's chat. A control's marker is its `data-hima-control` value, and it
 * is the same string on both mounts because a driver clicks one control, not two spellings of it.
 */
export const runControls: Readonly<Record<'cancel' | 'resume', ControlLabel>> = {
  cancel: { control: 'cancel', said: 'cancel this run' },
  resume: { control: 'resume', said: 'resume this run' },
};

/**
 * **What a face says when a request to the harness came back with nothing it can render**, in the
 * one wording every face says it in.
 *
 * There are two mounts of this card and three places a request is made from them — the workbench
 * page's start form, the same page's cancel and resume controls, and the React card's own fetches —
 * and each had built these sentences itself, in three spellings of one condition (the final review
 * of step 3b, H4). A person meeting the same failure on the chat's card and on the window's page
 * must read the same sentence, which is exactly what this module is for.
 *
 * They take their number and their reason already spelled, so the page's inline scripts can compose
 * them at render time out of a page expression (`scriptSaid`, `workbench.ts`) — a browser script is
 * text by the time it runs, and text is what these are.
 */
export const answeredWithNoCode = (status: string): string => `the harness answered ${status} with no coded error`;

/** The same, for an answer whose body was not JSON at all: the harness spoke and said nothing a
 *  caller can act on, which is the same failure one step earlier. */
export const answeredWithoutJson = (status: string): string => `the harness answered ${status} with a body that is not JSON`;

/** And when nothing answered at all: the request never reached the harness, with whatever the
 *  browser said about why. */
export const couldNotReach = (why: string): string => `the harness could not be reached: ${why}`;

/** Is this a Run a person can still stop? The two states a cancel writes anything for; a Run that has
 *  ended answers a cancel with its own status, so offering the control would be offering a no-op. */
export const showsCancel = (status: RunStatus | undefined): boolean => status === 'running' || status === 'waiting';

/** Is this a Run a person can carry on? Only a waiting one: every other status is refused with
 *  `notWaitingToResume`'s words, so the control is not shown where it cannot act. */
export const showsResume = (status: RunStatus | undefined): boolean => status === 'waiting';

/**
 * What a cancel request's key says, keyed by every answer there is, for the reason the status and
 * node-state tables are keyed by their types: what a person reads must never be a blank.
 */
export type CancelObservedKey = 'no-job' | 'killed' | 'already-gone' | 'not-taken' | 'not-asked';

/**
 * What was observed of the stop a cancel asked for, said in one sentence.
 *
 * A cancel is two records and never one (#9): the `cancel` record says a person asked, and the Job
 * and node records say what actually stopped. The card shows the request beside what came of it,
 * because "cancelled" without the observed stop is exactly the guess a person clicked the control to
 * avoid — a licence is not free until dc_shell has really gone.
 *
 * Read off this Run's own records rather than off the route's answer to the click, so a card opened
 * an hour later says the same thing as the card that was open when the click happened.
 *
 * @param view - the Run the card is showing.
 * @param cancel - the request this line is about.
 * @returns the key for the region's state attribute, and the sentence for the person.
 */
export function cancelObserved(view: RunView, cancel: CancelView): { readonly key: CancelObservedKey; readonly said: string } {
  const sessions = cancelSessions(cancel);
  if (sessions.length === 0) return { key: 'no-job', said: 'no job of this run was open when the request was read, so there was no stop to observe' };
  const stops = sessions.map((session) => stopObserved(view, session));
  // Every Job, one sentence each, and the key the one with the most left for a person to do: a
  // request that stopped one Job of two and could not stop the other has not been observed to stop
  // the Run, and a region that said `killed` of it would be the guess this card exists to avoid.
  return {
    key: CANCEL_LEFT_TO_DO.find((k) => stops.some((s) => s.key === k)) ?? 'killed',
    said: stops.map((s) => s.said).join('; '),
  };
}

/**
 * The order the observed stops of one request are folded in: the state with the most left for a
 * person first.
 *
 * A kill that did not take is a Job still running on the Site and a licence still held, which is
 * what a person must go and look at; a stop nobody could ask about is next, because the Site is the
 * thing that could not be reached; a Job that had already ended is nothing left to do but is also
 * nothing that was stopped; and `killed` is the whole request answered. `no-job` is not in the fold:
 * it is what a request with no session at all says, and a request with one session cannot be it.
 */
const CANCEL_LEFT_TO_DO: readonly CancelObservedKey[] = ['not-taken', 'not-asked', 'already-gone', 'killed'];

/** What was observed of the stop of **one** Job, which is what the sentences above are made of. */
function stopObserved(view: RunView, session: string): { readonly key: CancelObservedKey; readonly said: string } {
  const settled = view.jobs.find((j) => j.job.session === session && j.event !== 'launched');
  if (settled?.event === 'killed') return { key: 'killed', said: `the kill was observed: tmux session ${session} is gone` };
  // A settled Job that was not killed is one that ended by itself between the request and the kill:
  // nothing was stopped, and nothing here may say it was.
  if (settled !== undefined) return { key: 'already-gone', said: `nothing was killed: tmux session ${session} had already ended when the kill was asked for` };
  // No settling record at all. A Run left waiting is the kill that did not take — the node is blocked
  // naming that session — and anything else is a stop nobody has been able to observe yet.
  if (view.run.status === 'waiting') return { key: 'not-taken', said: `the kill was not taken: tmux session ${session} is still on the site` };
  return { key: 'not-asked', said: `no stop of tmux session ${session} was observed: the site could not be asked` };
}

/**
 * What a person asked for, said of the moment the request was read: where the Run stood, and every
 * Job it was holding. The observed stops are the sentences above; this is the asking.
 *
 * Every Job and not one of them (#29): one `cancel` record is written however many Jobs a Run had
 * open, and a Run inside a fork has one per branch — so a line naming one of two would leave a
 * person believing the Site was clear of a Campaign that still had a synthesis on it.
 */
export function cancelAsked(cancel: CancelView): string {
  const at = cancel.nodeId === undefined ? '' : `, at node ${cancel.nodeId}`;
  const sessions = cancelSessions(cancel);
  const holding = sessions.length === 0 ? '' : `, holding ${sessions.length === 1 ? 'session' : 'sessions'} ${sessions.join(', ')}`;
  return `a person asked this run to stop at ${cancel.at}${at}${holding}`;
}

// ---------------------------------------------------------------------------------------------
// The workbench's start form (#26)
// ---------------------------------------------------------------------------------------------

/** One field of the start form: the control a person fills, what it is called, and the sentence
 *  under it saying what may go in it. */
export interface StartField extends ControlLabel { readonly hint: string }

/**
 * The start form's words, here with the card's for the same reason the card's are here: one place
 * for what a person reads, so the page's structure and its wording change separately.
 *
 * Three of the hints are the shared validator's own sentence (`run-arguments.ts`), not a second
 * wording of it, and so is every knob field's (`strategyKnobWhat`, through `startKnobField` below).
 * Three faces onto one operation must refuse the same values for the same reason and say so in the
 * same words — and a form whose hint promised something its own route then refused would be the
 * fourth face doing exactly what that table exists to prevent.
 *
 * The form itself lives on the workbench page only: a chat has `/hima run`.
 */
export const startForm: Readonly<Record<'pack' | 'site' | 'target' | 'timeBox' | 'retries' | 'generations', StartField>> = {
  pack: { control: 'start-pack', said: 'pack', hint: 'the HimaPack this campaign runs, as it is installed here' },
  site: { control: 'start-site', said: 'site', hint: 'the Site its jobs run on' },
  target: { control: 'start-target', said: 'target period (ns)', hint: 'the Goal, bound as target_period_ns and immutable for this campaign' },
  timeBox: { control: 'start-time-box', said: 'time box (minutes)', hint: runArguments.timeBox.what },
  retries: { control: 'start-retries', said: 'retry allowance', hint: runArguments.retries.what },
  // The Loop's own bound, beside the box and the allowance because all three are the Budget (#27):
  // a Campaign started from the window is bounded in generations as well as in time, and a person
  // who leaves it empty gets the pack's own `converge.generationLimit`.
  generations: { control: 'start-generations', said: 'generations', hint: runArguments.generations.what },
};

/**
 * One field of the start form for one knob the selected pack declares (#58): its control, the pack's
 * own word for it, and the sentence under it saying what may go in it.
 *
 * The words are the pack's and the sentence is the shared validator's, which is the whole of what
 * this function is for: the harness owns no knob, so a form that labelled one would be the harness
 * saying what a pack's Strategy is — and a hint written here rather than taken from
 * `strategyKnobWhat` would be a fourth face promising something the start route then refused.
 *
 * A knob the pack declares no words for is shown under its own name, exactly as every other value a
 * pack says nothing about is (#42). `/hima pack check` refuses such a pack, so a person meets that
 * before a Campaign — but a form that would not render is a worse answer than a name.
 *
 * @param name - the knob, as the contract declares it and the wire carries it.
 * @param knob - what the pack declared it to be.
 * @param word - what the pack calls it, where it says.
 */
export const startKnobField = (name: string, knob: StrategyKnob, word: RunWord | undefined): StartField => ({
  control: `start-knob-${name}`,
  said: word === undefined ? name : (knob.type === 'number' && word.unit !== undefined ? `${word.label} (${word.unit})` : word.label),
  hint: strategyKnobWhat(knob),
});

/** The control that submits the form, and the heading above it. */
export const startControl: ControlLabel = { control: 'start', said: 'start campaign' };
export const START_HEADING = 'start a campaign';
export const LOCAL_DEMO_SOURCE = 'The built-in local demo uses simulated synthesis reports. Establish the source of a particular Run from its inputs and original reports.';
export const START_STATIC_LIMIT = 'Connections, available licences and tools have not been tested. Starting a Campaign checks these declarations again. ' + LOCAL_DEMO_SOURCE;
export const START_STATIC_FIT = 'Static declarations match.';
export const START_STATIC_UNFIT = 'The selected Pack and Site do not match. Site owner: check bindings, allowed wrappers and declared capacity. Pack owner: check rules, readers and chooser declarations.';
export const START_NO_PACK = 'No HimaPack is installed. Ask the Pack owner to install a Pack, then reload this page.';
export const START_NO_SITE = 'No Site is configured. Ask the Site owner to prepare the Site bindings and Permit, then reload this page.';

// ---------------------------------------------------------------------------------------------
// The workbench page's own headline board and its path table (#41)
// ---------------------------------------------------------------------------------------------

/**
 * The four questions the verdict band answers, in the order a person asks them — a fixed contract
 * and never a feed, which is the one thing the prior product's headline board got exactly right.
 *
 * Here with the start form's words for the reason the start form's are here: one place for what a
 * person reads is what keeps two faces saying one thing. `spent` is the first of the four to be
 * shared: the chat's card heads its own `run-meters` section with it (#27b), so the question the
 * page's board asks and the question that section answers are one question.
 */
export const factQuestions: Readonly<Record<'exploring' | 'standing' | 'spent' | 'todo', string>> = {
  exploring: 'what is being explored',
  standing: 'where it stands',
  spent: 'what it has spent',
  todo: 'what a person must do',
};

/** What the fourth question answers when no control is offered, keyed by why none is. Two sentences
 *  and not one blank cell: an empty answer to "what must a person do" is the one answer a person
 *  cannot act on. */
export const NOTHING_TO_DO_ENDED = 'nothing — this campaign has ended';
export const NOTHING_TO_DO_NO_FABRIC = 'nothing — no campaign was started on this run';

/** A fact the ledger does not hold for this Run, said rather than left blank — the honesty the prior
 *  product carried and the one habit worth keeping wholesale. */
export const NOT_RECORDED = 'not recorded';

/**
 * The path table's column heads, in the order the table shows them: which node, what kind of node it
 * is, where it stands, which attempt, and what was recorded about it.
 *
 * Keyed rather than a bare list, and here rather than in the page, for the reason `generationColumns`
 * is: the path is shown on the workbench page today and under a generation's row when #28 nests the
 * loops, and two places rendering one table must not head it two ways.
 */
export const pathColumns: Readonly<Record<'index' | 'node' | 'kind' | 'state' | 'attempt' | 'said', string>> = {
  index: '#',
  node: 'node',
  kind: 'kind',
  state: 'state',
  attempt: 'attempt',
  said: 'what was recorded',
};

/** The run list's column heads on the workbench page: one Run per row, newest first. */
export const runColumns: Readonly<Record<'run' | 'status' | 'pack' | 'started' | 'generation', string>> = {
  run: 'run',
  status: 'status',
  pack: 'pack',
  started: 'started',
  generation: 'generation',
};

/** What the run list says when the HimaLedger holds no Run at all. */
export const NO_RUNS = 'no runs in the HimaLedger yet';

/**
 * A period written on the convergence plot itself, beside the mark it belongs to: the number with
 * its unit, because a value drawn on a picture is read where it stands and not against the column
 * head one band below it.
 */
export const plotValue = (ns: number): string => `${String(ns)} ns`;

/**
 * The convergence plot's caption and its keys: what the two lanes draw, and against what.
 *
 * `inLoop` is the key of the span a drill-down Loop's own generations are drawn in (#28), shown only
 * on a Campaign that opened one — a key for a mark that is not on the picture is a legend for
 * something else. `branches` is the same for a fork's own readings (#29b), which are drawn at the
 * generation that forked them because that is when they were read.
 */
export const plotLabels: Readonly<Record<'caption' | 'period' | 'target' | 'slackOk' | 'slackBad' | 'inLoop' | 'branches', string>> = {
  caption: 'period per generation against the goal\'s target period, and setup slack against zero',
  period: 'clock period, ns',
  target: 'target period, ns',
  slackOk: 'setup slack ≥ 0, ns',
  slackBad: 'setup slack < 0, ns',
  inLoop: 'inside a drill-down loop',
  branches: 'a fork\'s branches, at the generation they ran in',
};

/**
 * One branch's own reading, labelled on the plot beside the point that draws it: which branch, and
 * what it measured.
 *
 * Labelled at all because a fork's branches share one place on the axis — they ran in one generation
 * — so two points sit above one another with nothing but this to tell them apart. Written in the
 * HTML over the drawing, as the plot's other two values are, so the picture scales with the band
 * without a letter of it scaling too.
 */
export const branchPointSaid = (branch: BranchView, ns: number): string => `${branch.id} ${plotValue(ns)}`;

/** How many lines of the failed Job's own log the blocker carried, said above the well that holds
 *  them — a tail with no range on it is a tail a person cannot tell from a whole log. */
export const tailSaid = (logTail: string): string =>
  `the last ${counted(logTail.split('\n').length, 'line')} of the job's own log, as it wrote them`;

// ---------------------------------------------------------------------------------------------
// The Campaign's technical report (#30): what the evidence drawer's last section says about it
// ---------------------------------------------------------------------------------------------

/** The drawer's own head, beside `cancel`, `blocker`, `observed`, `verdicts` and `decision`. */
export const EXPERIENCE_HEADING = 'experience';

/** Saved-file metadata and a current preview are distinct, including after renderer upgrades. */
export const experienceWrittenSaid = (experience: ExperienceView): string =>
  `written at ${experience.writtenAt}, and left on the site beside the campaign's results;`
  + ' the text below is a current preview from recorded facts, not the saved file.'
  + ' Open the saved report to verify its hash; its original wording may differ.';

/**
 * One file of the report: which of the two it is, where it is on the Site, what it hashes to and how
 * big it is — the whole of what the ledger keeps about it, said in one line.
 *
 * The path first, because it is what a person copies to go and read the file on the Site; the hash
 * because it is what makes the file evidence rather than a file.
 */
export const experienceFileSaid = (which: 'markdown' | 'json', file: ExperienceFileView): string =>
  `${which}: ${file.path} · sha256 ${file.sha256} · ${counted(file.bytes, 'byte')}`;

/** What the link under the report offers: the file itself, as the Site has it, read back and held
 *  against its hash on the way through. */
export const EXPERIENCE_MARKDOWN_LINK = 'open and verify the saved markdown';

/**
 * Where that link goes: the `.md` route of the Hima namespace, for this Run.
 *
 * The route is `paths.ts`'s, like every other path this harness serves. It was a literal here until
 * the final review of step 3b (H3) — on the ground that `remote.ts` imports the page renderer, so
 * nothing browser-side could import the prefix back — which was a dependency direction to fix once
 * rather than to spell around a third time. `experience.test.ts` holds this route by driving it.
 */
export const experienceMarkdownHref = (runId: string): string => experienceMarkdownPath(runId);

/** These are the saved file's metadata, not a hash of the current preview. `sha256` is retained
 * as a compatibility alias for older drivers; the explicit key and source remove the ambiguity. */
export function experienceState(experience: ExperienceView): Readonly<Record<string, string>> {
  return { source: 'ledger-preview', 'recorded-file-sha256': experience.markdown.sha256, sha256: experience.markdown.sha256, 'written-at': experience.writtenAt };
}
