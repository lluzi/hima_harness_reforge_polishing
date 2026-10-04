// The QuaLib Insight tab's own analysis seam: how the client decides which installed Pack is a
// library-analysis Pack, what to pre-fill its Analyse form with, what Campaign file to drive one from,
// and when a started Run has produced the library report it should open.
//
// A leaf module with no React and no Node imports (the same discipline `campaign-file-diff.ts`
// follows), so both the InsightView component and the local contract tests read one copy of this
// logic. It names no Pack id and no technology: a Pack qualifies by the generic input it declares and
// the report kind its reader emits, which is what keeps this a library-analysis surface rather than a
// surface compiled around one customer's Pack (D46, polishing module map: Desktop presentation
// re-arranges existing facts; the Pack and the Host keep the authority).
import type { CampaignFile } from '../campaign-file.js';
import type { RunView } from '../remote.js';
import type { StartChoices, PreparationView } from '../workbench.js';
import type { StrategyKnob } from '../run-arguments.js';

/** The generic input a library-analysis Pack declares: the read-only folder of a prepared library
 *  store the analysis runs over. This is the signal discovery keys on — never a Pack id — so any Pack
 *  whose own contract declares this input is offered, and a Pack that does not is ignored. */
export const LIB_INSIGHT_ROOT_INPUT = 'libInsightRoot';

/** The report identity a library-analysis Pack's reader emits (`hima-library-insight-report/1`). The
 *  same literal `library-insight-report.ts` validates against; used here to find, among a finished
 *  Run's observations, the one whose bytes the Host will render as a library report. A report kind,
 *  not a Pack id, so it holds for any Pack whose reader produces this report. */
export const LIBRARY_INSIGHT_REPORT_KIND = 'hima-library-insight-report/1';

/** The declared choice knob the Analyse form offers as the "library kit": the knob named `kit` when a
 *  Pack declares one, else the first choice knob it declares. A knob name, read off the Pack's own
 *  declaration — the kit option values themselves are the Pack's and are never written here. */
export const LIBRARY_KIT_KNOB = 'kit';

/** One installed Pack paired with the preparation the Host answered for it. */
export interface PackChoicesEntry { readonly packId: string; readonly choices: StartChoices }

/** Does this preparation declare the library-root input? Read off the proposal's own declared inputs,
 *  which is what the Host answers for a Pack whether or not a Site has bound them yet. */
export function declaresLibraryRoot(choices: StartChoices | undefined): boolean {
  return choices?.proposal?.inputs?.some((input) => input.name === LIB_INSIGHT_ROOT_INPUT) === true;
}

/** The installed Packs that are library-analysis Packs, in the order given: those whose contract
 *  declares {@link LIB_INSIGHT_ROOT_INPUT}. A Pack that declares no such input is left out. */
export function discoverLibraryAnalysisPacks(entries: readonly PackChoicesEntry[]): readonly PackChoicesEntry[] {
  return entries.filter((entry) => declaresLibraryRoot(entry.choices));
}

/** The library-kit knob a preparation declares, with the options and default the Analyse form shows;
 *  `undefined` when the Pack declares no choice knob at all. */
export function libraryKitKnob(choices: StartChoices | undefined): { readonly name: string; readonly knob: Extract<StrategyKnob, { type: 'choice' }> } | undefined {
  const strategy = choices?.strategy;
  if (strategy === undefined) return undefined;
  const named = strategy[LIBRARY_KIT_KNOB];
  if (named !== undefined && named.type === 'choice') return { name: LIBRARY_KIT_KNOB, knob: named };
  for (const [name, knob] of Object.entries(strategy)) if (knob.type === 'choice') return { name, knob };
  return undefined;
}

/** The library folder the form starts at: the value the Site has already bound the library-root input
 *  to, when a Site is selected and has bound it. Empty when nothing has bound it, so the field is a
 *  genuinely unbound field rather than one standing in a value it does not have. */
export function defaultLibraryFolder(choices: StartChoices | undefined): string {
  const input = choices?.proposal?.inputs?.find((entry) => entry.name === LIB_INSIGHT_ROOT_INPUT);
  return input?.ready === true && input.value !== undefined ? input.value : '';
}

/** Every Goal parameter this Pack declares, each at the default its own declaration states, so a
 *  Campaign-file analysis starts with a Goal the Pack itself considers complete rather than one left
 *  unset. A declared parameter with no default is left out (nothing here invents a Goal value). */
export function goalDefaults(choices: StartChoices | undefined): Record<string, number> {
  const declared = choices?.goal;
  const goal: Record<string, number> = {};
  if (declared === undefined) return goal;
  for (const [name, parameter] of Object.entries(declared)) if (parameter.default !== undefined) goal[name] = parameter.default;
  return goal;
}

/** What the Analyse button builds a Campaign file from. The folder and kit are the person's choices in
 *  the tab; the Goal and the time box are the Pack's own default and this tab's modest box. A Pack
 *  that declares no choice knob at all leaves `kitKnob`/`kit` out, and the analysis file then carries
 *  no Strategy override rather than a `{ '': … }` knob no Pack declares. */
export interface AnalysisRequest {
  readonly packId: string;
  readonly siteName: string;
  readonly folder: string;
  readonly kitKnob?: string;
  readonly kit?: string;
  readonly goal: Readonly<Record<string, number>>;
  readonly timeBoxMinutes: number;
}

/** The time box a QuaLib Insight analysis is driven under: a modest fixed box, in the minutes every
 *  face spells a time box in. */
export const ANALYSIS_TIME_BOX_MINUTES = 60;

/**
 * The Campaign file a QuaLib Insight analysis is driven from.
 *
 * Built purely from the request — it never reads, and so can never clobber, whatever draft the person
 * already has in `hima/campaign.yml`; the InsightView component saves that draft aside and restores
 * it after the start. The library folder overrides the library-root input (the Site's own binding
 * stays the default); the kit is the chosen knob; the Goal is the Pack's own default; the Budget is
 * this tab's time box. The calculation it starts is still a controlled, recorded Run — this file only
 * hides the Campaign wording and fills the fields.
 */
export function analysisCampaignFile(request: AnalysisRequest): CampaignFile {
  const schema: CampaignFile['schema'] = 'hima-campaign/1';
  return {
    schema,
    name: 'QuaLib Insight analysis',
    pack: { id: request.packId },
    site: { name: request.siteName },
    inputs: { [LIB_INSIGHT_ROOT_INPUT]: request.folder },
    goal: { ...request.goal },
    strategy: request.kitKnob === undefined ? {} : { [request.kitKnob]: request.kit ?? '' },
    budget: { timeBoxMinutes: request.timeBoxMinutes },
    knowledge: [],
    notes: '',
  };
}

/** The observation a finished Run produced that the Host will render as a library report: the one its
 *  reader emitted under {@link LIBRARY_INSIGHT_REPORT_KIND}. The latest such observation, so a Run
 *  that read more than once opens its most recent report. `undefined` when none is present. */
export function libraryReportRef(view: RunView | undefined): string | undefined {
  const observations = view?.observations ?? [];
  for (let index = observations.length - 1; index >= 0; index -= 1) {
    const observation = observations[index];
    if (observation !== undefined && observation.reader.reportKind === LIBRARY_INSIGHT_REPORT_KIND) return observation.recordId;
  }
  return undefined;
}

/** How a started analysis Run now stands, read off the one Run view the tab polls:
 *  - `running` while HimaFabric is still driving it, or it has no status yet;
 *  - `report` once it has ended with its library report observation present — the ref to open;
 *  - `failed` when it ended with no report, or stopped waiting on a person (blocked), with the reason
 *    to show and the Run to open for diagnosis. */
export type AnalysisOutcome =
  | { readonly kind: 'running' }
  | { readonly kind: 'report'; readonly reportRef: string }
  | { readonly kind: 'failed'; readonly reason: string };

const ENDED_STATUSES = new Set(['ended-goal-met', 'ended-converged', 'ended-goal-not-met', 'ended-budget-exhausted', 'cancelled']);

/** Classify the analysis Run. `statusLabel` is the host-worded label for a terminal status with no
 *  report (the caller passes the same words the rest of the client reads), and `blockerReason` the
 *  latest blocker's own sentence when the Run is waiting. */
export function analysisOutcome(view: RunView | undefined, statusLabel: (status: string) => string, blockerReason?: string): AnalysisOutcome {
  const status = view?.run.status;
  if (status === undefined) return { kind: 'running' };
  const reportRef = libraryReportRef(view);
  if (ENDED_STATUSES.has(status)) {
    return reportRef !== undefined ? { kind: 'report', reportRef } : { kind: 'failed', reason: statusLabel(status) };
  }
  if (status === 'waiting') return { kind: 'failed', reason: blockerReason ?? statusLabel(status) };
  return { kind: 'running' };
}

/** Read a preparation's own ready/unknowns, so the Analyse handler can say why a folder or kit is not
 *  yet startable rather than failing opaquely at the start route. */
export function preparationBlock(proposal: PreparationView | undefined): { readonly ready: boolean; readonly unknowns: readonly string[] } {
  return { ready: proposal?.ready === true, unknowns: proposal?.unknowns ?? [] };
}
