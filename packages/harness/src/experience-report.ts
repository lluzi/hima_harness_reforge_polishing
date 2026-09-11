// The Campaign's technical report: what it says, in both files, and how a face reads it back (#30).
//
// One reason to change: what a Campaign's experience says. Where it is written is `experience.ts`,
// which reaches a Site; nothing here does. This module is pure — a run view in, two documents out —
// so the three places that need the report can each have it: the writer, the workbench page, and the
// card in the chat, which is a browser bundle and can reach no Site at all.
//
// **The two documents are one report.** The JSON is composed first and the Markdown is composed from
// it, so every number a person reads is a number a machine reads, and a fact that reached one file
// and not the other is not a shape this module can produce. What the Markdown adds is order, tables
// and a paragraph of reasoning per generation — the report is a document and not a dump.
//
// A freshly composed report is a ledger projection made by the current renderer. A saved report
// may have been written by an earlier version. Only readExperience reads and verifies those original
// bytes; the two must never be described as interchangeable.
//
// The Markdown's dialect is this file's own and deliberately small: headings, paragraphs, tables and
// fenced code, no inline markup at all. `reportBlocks` below reads exactly that dialect back, so the
// renderer on each mount has nothing to guess and the text a person sees is character for character
// the text in the file. A report is evidence; a renderer that could interpret a report differently
// from the file it came from would be a second account of it.
import {
  branchLines,
  branchSaid,
  cancelObserved,
  chosenSaid,
  counted,
  duration,
  generationColumns,
  generationDecisionSaid,
  labelled,
  joinSaid,
  labelledEndedBy,
  ledgerRows,
  loopClosedSaid,
  loopOpenedSaid,
  loopSaid,
  LOCAL_DEMO_SOURCE,
  meterRows,
  NOT_HELD,
  NOTHING_JUDGED,
  pathColumns,
  askedObservedSaid,
  runStatusLabel,
  slackSaid,
  strategySaid,
  tailSaid,
} from './card-labels.js';
import type { BranchView, GenerationView, LoopView } from './generations.js';
import type { RunBudget, RunMeters, RunStatus } from './ledger.js';
import type { BlockerView, CancelView, NodeView, ObservationView, RunView, VerdictView } from './remote.js';

/**
 * What the machine's file says it is. Read by whoever opens it: a schema key is what lets a later
 * reader know it is holding a HimaExperience report and which shape of one, without guessing from
 * the keys it happens to find. It is versioned separately from the ledger's own domain, because the
 * file outlives the ledger that wrote it — it is the Site owner's, kept beside the results (D44).
 */
export const EXPERIENCE_SCHEMA = 'hima-experience/2';

/** The directory the two files live in, under the Campaign workspace, beside the results. */
export const EXPERIENCE_DIR = 'hima-experience';

/** How a Campaign ended: the ledger's own word for it, the meter that ended it where one did, and
 *  the sentence behind it — the same sentence the card's seal shows. */
export interface ExperienceEnding {
  readonly status: RunStatus;
  /** The meter that ended the Run, on a Run a meter or a person ended rather than the graph. */
  readonly endedBy?: NonNullable<RunMeters['endedBy']>;
  readonly reason: string;
}

/** The pack that produced this experience, and the version of it: what a later reader needs to know
 *  which method the facts came from (D16, user story 12). */
export interface ExperiencePack {
  readonly id: string;
  readonly version: string;
}

/**
 * The machine's file: one Campaign's technical report, as the JSON on the Site holds it.
 *
 * Every field is the run view's own, copied and never recomputed — the generations with their nested
 * Loops and branches are exactly the rows the card's table showed, and the path is exactly the path
 * it drew. A report that recomputed anything would be a second account of a Campaign that has ended.
 */
export interface ExperienceJsonV1 {
  readonly schema: 'hima-experience/1';
  readonly runId: string;
  readonly campaignId: string;
  readonly pack: ExperiencePack;
  /** The Site this Campaign ran on, as the Site's own file names it. */
  readonly site: string;
  /** The Goal as bound parameters, immutable for the life of the Campaign (D3). */
  readonly goal?: Readonly<Record<string, number>>;
  readonly budget?: RunBudget;
  readonly ending: ExperienceEnding;
  /** One row per Generation of the Loop, oldest first, with drill-down Loops and branches nested. */
  readonly generations: readonly GenerationView[];
  readonly meters?: RunMeters;
  /** One entry per node, carrying the latest transition of it, in the order the Run reached them. */
  readonly path: readonly NodeView[];
  readonly blockers: readonly BlockerView[];
  readonly cancels: readonly CancelView[];
  /** The instant this report was composed; the `experience` record carries the same one. */
  readonly writtenAt: string;
}

/** Schema 1 remains a readable historical document; only new writes use schema 2. */
export interface ExperienceJsonV2 extends Omit<ExperienceJsonV1, 'schema'> {
  readonly schema: typeof EXPERIENCE_SCHEMA;
  readonly research: ExperienceResearch;
}
export type ExperienceJson = ExperienceJsonV1 | ExperienceJsonV2;

export interface ExperienceTrial {
  readonly generation: number;
  readonly loopId?: string;
  readonly branchId?: string;
  /** Absent for a branch whose requested knobs were never recorded. */
  readonly strategy?: GenerationView['strategy'];
  readonly status: 'judged' | 'incomplete' | 'undetermined';
  readonly reason: string;
  readonly observation?: ObservationView;
  readonly verdicts: readonly VerdictView[];
  /** The completed judge node's recorded outcome, never recalculated from the measured number. */
  readonly constraintOutcome?: GenerationView['verdicts'][number]['outcome'];
}

export interface ExperienceResearch {
  readonly conclusion: 'goal-supported' | 'measured-negative' | 'goal-not-established' | 'insufficient-evidence';
  readonly summary: string;
  readonly trials: readonly ExperienceTrial[];
  readonly untestedNextStrategy?: GenerationView['strategy'];
  readonly limitations: readonly string[];
  readonly environment: {
    readonly site: string;
    readonly declaredDesign: string;
    readonly declaredFlowRoot: string;
    readonly declaredContainer: string;
    readonly toolVersions: 'not recorded';
    readonly operatingSystem: 'not recorded';
  };
}

/** The two documents of one newly composed report. Historical files are read without recomposition. */
export interface ExperienceReport {
  readonly json: ExperienceJsonV2;
  readonly markdown: string;
}

/**
 * The Campaign's technical report, composed from the Run as HimaGuide shows it.
 *
 * @param view - the ended Run, exactly as the routes and both mounts of the card read it.
 * @param writtenAt - the instant this report states as its own, kept on the `experience` record so
 *                    that a later composition of the same Run is the same document.
 * @returns the machine's file and the person's, the second composed from the first.
 */
export function experienceReport(view: RunView, writtenAt: string): ExperienceReport {
  const json = experienceJson(view, writtenAt);
  return { json, markdown: experienceMarkdown(json, view) };
}

/** The machine's file, from the run view and nothing else. */
function experienceJson(view: RunView, writtenAt: string): ExperienceJsonV2 {
  const { run } = view;
  return {
    schema: EXPERIENCE_SCHEMA,
    runId: run.id,
    campaignId: run.campaignId,
    pack: { id: run.packId ?? '', version: run.packVersion ?? '' },
    site: run.siteId,
    // An absent key, never an undefined one, as everywhere else a view is composed: a Run that was
    // given no Goal and no Budget says so by omission rather than with an empty object.
    ...(run.goal === undefined ? {} : { goal: run.goal }),
    ...(run.budget === undefined ? {} : { budget: run.budget }),
    ending: endingOf(view),
    research: researchOf(view),
    generations: view.generations,
    ...(run.meters === undefined ? {} : { meters: run.meters }),
    path: view.nodes,
    blockers: view.blockers,
    cancels: view.cancels,
    writtenAt,
  };
}

/** Read completed judge evidence, without re-running rules or deciding whether a Run may advance. */
function researchOf(view: RunView): ExperienceResearch {
  const observations = new Map(view.observations.map((observation) => [observation.recordId, observation]));
  const verdicts = new Map(view.verdicts.map((verdict) => [verdict.recordId, verdict]));
  const trials: ExperienceTrial[] = [];
  let pendingDecisionId: string | undefined;
  const trial = (generation: GenerationView, loopId?: string, branch?: BranchView): ExperienceTrial => {
    const source = branch ?? generation;
    const observation = source.observation === undefined ? undefined : observations.get(source.observation.recordId);
    const nodes = source.nodes ?? [];
    const lastAct = nodes.findLastIndex((node) => node.kind === 'act');
    const lastJudge = nodes.findLastIndex((node) => node.kind === 'judge');
    const judge = nodes[lastJudge];
    // A later act (including a failed retry) must not borrow the previous judge's answer. A branch
    // is judged by its generation's join, whose transition is outside the branch's own records.
    const settled = lastAct >= 0 && nodes[lastAct]!.state === 'done'
      && (branch === undefined
        ? lastJudge > lastAct && judge?.state === 'done'
        : branch.state === 'done' && generation.join?.outcome !== undefined);
    const latest = new Map(source.verdicts.map((verdict) => [verdict.ruleId, verdict]));
    const cited = [...latest.values()].flatMap((verdict) => {
      const held = verdict.recordId === undefined ? undefined : verdicts.get(verdict.recordId);
      return held === undefined ? [] : [held];
    });
    const traced = observation !== undefined && cited.length > 0 && cited.length === latest.size
      && cited.every((verdict) => verdict.cites.length > 0 && verdict.cites.every((citation) =>
        citation.recordId === observation.recordId && citation.observation?.contentSha256 === observation.contentSha256));
    const status = !settled || !traced ? 'incomplete'
      : cited.some((verdict) => verdict.outcome === 'UNDETERMINED') ? 'undetermined' : 'judged';
    const reason = !settled ? 'Execution and a subsequent completed judge are not both recorded for this trial.'
      : !traced ? 'The complete verdict set cannot be traced to this trial\'s own observation; it does not support a result.'
        : status === 'undetermined' ? 'The judge recorded missing or unknown evidence; no definite result is established.'
          : 'The experiment completed and its judge verdicts cite this observation. FAIL is a measured negative result, not an execution fault.';
    const constraintOutcome = branch === undefined ? judge?.outcome : undefined;
    return {
      generation: generation.generation,
      ...(loopId === undefined ? {} : { loopId }),
      ...(branch === undefined ? { strategy: generation.strategy } : { branchId: branch.id }),
      status, reason,
      ...(observation === undefined ? {} : { observation }),
      verdicts: cited,
      ...(status !== 'judged' || constraintOutcome === undefined ? {} : { constraintOutcome }),
    };
  };
  const visit = (generations: readonly GenerationView[], loopId?: string): void => {
    for (const generation of generations) {
      if (generation === generations.at(-1) && generation.decisionRecordId === view.decision?.recordId) pendingDecisionId = generation.decisionRecordId;
      if (generation.branches?.length) {
        for (const branch of generation.branches) trials.push(trial(generation, loopId, branch));
      } else trials.push(trial(generation, loopId));
      for (const loop of generation.loops ?? []) visit(loop.generations, loop.id);
    }
  };
  visit(view.generations);
  const judged = trials.filter((entry) => entry.status === 'judged');
  const decision = view.decision;
  const supportedGoal = view.run.status === 'ended-goal-met' && decision !== null && 'goalMet' in decision.chosen
    && judged.some((entry) => entry.observation !== undefined
      && decision.cites.includes(entry.observation.recordId)
      && entry.verdicts.every((verdict) => verdict.outcome === 'PASS')
      && trials.filter((peer) => peer.generation === entry.generation && peer.loopId === entry.loopId)
        .every((peer) => peer.status === 'judged' && peer.verdicts.every((verdict) => verdict.outcome === 'PASS'))
      && decision.cites.every((id) => id === entry.observation!.recordId || entry.verdicts.some((verdict) => verdict.recordId === id))
      && entry.verdicts.every((verdict) => decision.cites.includes(verdict.recordId)));
  const negative = judged.some((entry) => entry.verdicts.some((verdict) => verdict.outcome === 'FAIL'));
  const conclusion = supportedGoal ? 'goal-supported' : judged.length === 0 ? 'insufficient-evidence'
    : negative ? 'measured-negative' : 'goal-not-established';
  const summary = supportedGoal ? 'The recorded goal-met decision is supported by completed, cited judge evidence in this Campaign.'
    : conclusion === 'measured-negative' ? 'Completed experiments include negative judge results. These results apply only to the recorded trials and do not establish that every strategy or the Campaign proposition is ineffective.'
      : conclusion === 'goal-not-established' ? 'Completed judge evidence is recorded, but it does not establish the Campaign goal.'
        : 'No complete, traceable judge evidence establishes a research result. Execution status alone is not a research conclusion.';
  const next = decision !== null && pendingDecisionId === decision.recordId && 'strategy' in decision.chosen ? decision.chosen.strategy : undefined;
  return {
    conclusion, summary, trials,
    ...(next === undefined ? {} : { untestedNextStrategy: next }),
    limitations: [
      LOCAL_DEMO_SOURCE,
      'Reported clock periods are report values, not measured Fmax. Requested strategy values are inputs, not measurements.',
      'Convergence records the Pack rule over the tried values; it does not prove an optimum or general strategy failure.',
      'Incomplete trials and unresolved or stale citations are retained as history and excluded from the definite result.',
      'Workspace design, flow and container names are declarations, not verified runtime identity. Design-content identity, tool versions and operating system were not recorded; cross-trial comparability is unknown.',
      'No causal research explanation or AI analysis was recorded by this deterministic report. No improvement percentage is inferred.',
    ],
    environment: { site: view.run.siteId, declaredDesign: view.workspace?.design ?? 'not recorded', declaredFlowRoot: view.workspace?.flowRoot ?? 'not recorded', declaredContainer: view.workspace?.containerName ?? 'not recorded', toolVersions: 'not recorded', operatingSystem: 'not recorded' },
  };
}

/** Each statement links back to a reading and its judge records; coverage is separate from ending. */
function researchSection(research: ExperienceResearch): string[] {
  const trialRows = research.trials.map((trial) => [
    [trial.loopId, `generation ${trial.generation}`, trial.branchId].filter(Boolean).join(' / '),
    trial.status,
    trial.constraintOutcome ?? NOT_HELD,
    trial.observation === undefined ? 'no observation recorded' : `${trial.observation.recordId}: ${trial.observation.path}; sha256 ${trial.observation.contentSha256}`,
    trial.verdicts.map((verdict) => `${verdict.recordId}: ${verdict.outcome} ${verdict.ruleId}@${verdict.ruleVersion}`).join('; ') || 'no resolvable verdicts',
    trial.reason,
  ]);
  return [
    '## Research result and evidence limits', '', research.summary, '',
    ...table(['trial', 'evidence', 'recorded constraint outcome', 'observation', 'judge records', 'scope'], trialRows), '',
    ...(research.untestedNextStrategy === undefined ? [] : [
      `The next strategy was proposed but not executed as a subsequent trial: ${JSON.stringify(research.untestedNextStrategy)}. It is unmeasured.`, '',
    ]),
    ...research.limitations.flatMap((line) => [line, '']),
    ...table(['environment', 'recorded value'], Object.entries(research.environment)), '',
  ];
}

/**
 * How this Campaign ended, in the ledger's word and in the card's sentence.
 *
 * A report is composed only for a Run that has ended, so the row has a status. A Run with none is
 * one HimaFabric never started, and there is no ending of it to state: rather than write a status
 * nobody recorded into a file that is evidence, this says so and stops. `writeExperience`'s own
 * guard is what keeps such a Run from reaching here, and both mounts compose only from a Run that
 * carries an `experience` record — so this throw is the guard's statement and not a second one.
 */
function endingOf(view: RunView): ExperienceEnding {
  const status = view.run.status;
  if (status === undefined) {
    throw new Error(`run ${view.run.id} has no status: HimaFabric never started it, so there is no campaign experience to compose`);
  }
  const endedBy = view.run.meters?.endedBy;
  return {
    status,
    ...(endedBy === undefined ? {} : { endedBy }),
    reason: endingReason(view),
  };
}

/**
 * Why this Campaign ended, in one sentence — the card's own words, never a second wording.
 *
 * The four endings say four different things and are read off four different places, which is why
 * this is a function and not a table: a cancel is what was *observed* to stop (the seal's sentence),
 * a spent Budget is the meter that ran out, the Goal met and the convergence are the Explore node's
 * own decision, and a Run whose graph simply ran out of edges is the one ending nothing decided —
 * so it says where it stopped and what it would have tried next.
 */
export function endingReason(view: RunView): string {
  const { status, meters, currentNode } = view.run;
  const said = status === undefined ? '' : labelled(runStatusLabel, status).said;
  if (status === 'cancelled') {
    const cancel = view.cancels[view.cancels.length - 1];
    return cancel === undefined ? said : cancelObserved(view, cancel).said;
  }
  if (status === 'ended-budget-exhausted') {
    return meters?.endedBy === undefined ? said : `${labelledEndedBy(meters.endedBy)} ran out`;
  }
  const decision = view.decision;
  if (status === 'ended-goal-met' || status === 'ended-converged') {
    return decision === null ? said : chosenSaid(decision, view.run.words);
  }
  if (status !== 'ended-goal-not-met') return said;
  const next = decision !== null && 'strategy' in decision.chosen
    ? `; the strategy it would have tried next was ${strategySaid(decision.chosen.strategy, view.run.words?.strategy)}`
    : '';
  return `nothing led out of ${currentNode ?? 'the node it stood at'}${next}`;
}

// ---------------------------------------------------------------------------------------------
// The person's file
// ---------------------------------------------------------------------------------------------

/**
 * A cell of a table: its own text, made into one cell of one line.
 *
 * The pipe is held apart from the text, so a reason carrying one is still one cell and reads back as
 * it was written. A newline becomes a space, because a row of this dialect is a line: a reason built
 * from a Site's own words or an errno's can be several lines long, and one left in a cell would end
 * the row where the text broke and leave the rest of it to be read as a paragraph.
 */
const cell = (text: string): string => text.replaceAll('|', '\\|').replace(/\r?\n/g, ' ');

/** One row of a table, from its cells. */
const row = (cells: readonly string[]): string => `| ${cells.map(cell).join(' | ')} |`;

/** A whole table: the head, the rule under it, and the rows. Empty for a table with no rows at all,
 *  because a table of column heads over nothing is a shape with nothing in it. */
function table(head: readonly string[], rows: readonly (readonly string[])[]): string[] {
  if (rows.length === 0) return [];
  return [row(head), `|${head.map(() => ' --- ').join('|')}|`, ...rows.map(row)];
}

/**
 * A fence longer than any run of backticks inside what it holds, so a Job's own log is quoted whole
 * and never edited to fit the report that quotes it.
 */
function fenced(text: string): string[] {
  const longest = [...text.matchAll(/`+/g)].reduce((most, m) => Math.max(most, m[0].length), 0);
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return [fence, ...text.split('\n'), fence];
}

/** The person's file, composed from the machine's so the two cannot say different numbers. */
function experienceMarkdown(json: ExperienceJsonV2, view: RunView): string {
  const lines: string[] = [
    `# Campaign ${json.campaignId}`,
    '',
    endingLine(json.ending),
    '',
    ...table(['fact', 'value'], [
      ['pack', `${json.pack.id}@${json.pack.version}`],
      ['site', json.site],
      ['run', json.runId],
      ['campaign', json.campaignId],
      ['goal', json.goal === undefined ? NOT_HELD : Object.entries(json.goal).map(([name, value]) => `${name}=${String(value)}`).join(', ')],
      ['written at', json.writtenAt],
    ]),
    '',
    ...researchSection(json.research),
    ...budgetSection(view),
    ...generationsSection(json.generations, view),
    ...reasoningSection(json.generations, view),
    ...pathSection(json.path),
    ...blockersSection(json.blockers),
    ...cancelsSection(json.cancels, view),
  ];
  // One trailing newline, as every file this harness writes has: a document that ends mid-line is a
  // document a reader cannot tell from a truncated one.
  return `${assembled(lines).join('\n').trimEnd()}\n`;
}

/**
 * The document's own lines from the sections': one blank line between two sections, never two.
 *
 * Each section above ends with a blank line of its own and any of them can be empty, so the seams
 * between them hold runs of blank lines that a document should not. They are closed here, line by
 * line, and **a fence suspends the whole rule**: everything between the fence `fenced` opened and
 * the one that closes it is the Job's own log, which is quoted and never edited — a tail with two
 * blank lines in it that this trimmed would leave the Markdown saying something the JSON does not,
 * which is the one shape this module must not produce.
 *
 * A single pass over the lines rather than a regular expression over the finished text, for exactly
 * that reason: a collapse of the text cannot see where a fence begins.
 */
function assembled(lines: readonly string[]): string[] {
  const out: string[] = [];
  let fence: string | undefined;
  for (const line of lines) {
    if (fence !== undefined) {
      out.push(line);
      if (line === fence) fence = undefined;
      continue;
    }
    // `fenced` opens with a line of backticks and nothing else, and closes with the same line.
    if (/^`{3,}$/.test(line)) fence = line;
    else if (line === '' && out[out.length - 1] === '') continue;
    out.push(line);
  }
  return out;
}

/**
 * The one line under the title: where the Campaign got to, and why.
 *
 * The reason is left off where the status already is it — `ended — goal met` and a reason of
 * `goal met` are one fact, and a report that said it twice on its first line would read as two.
 * Every other ending says something the status does not: which meter ran out, what was observed to
 * stop, the whole convergence rule.
 */
function endingLine(ending: ExperienceEnding): string {
  const said = labelled(runStatusLabel, ending.status).said;
  return said.toLowerCase().endsWith(ending.reason.toLowerCase()) ? `${said}.` : `${said}: ${ending.reason}.`;
}

/** Every meter of the Budget against the bound the Campaign was started under, in the card's words. */
function budgetSection(view: RunView): string[] {
  const rows = meterRows(view).map((meter) => [meter.label, meter.detail]);
  if (rows.length === 0) return [];
  return ['## The budget', '', ...table(['meter', 'against its bound'], rows), ''];
}

/** The generations table: the card's own six columns, at every depth, in the ledger's own order. */
function generationsSection(generations: readonly GenerationView[], view: RunView): string[] {
  const rows: string[][] = [];
  for (const entry of ledgerRows(generations)) {
    if (entry.kind === 'generation') {
      rows.push(generationRow(entry.row, entry.loop, view));
      continue;
    }
    // A fork's branches are rows of this table for the reason they are rows of the card's (#29b):
    // two branches read two reports at two periods, and the generation's own row carries neither, so
    // a report that left them out would show a forked generation as a generation that measured
    // nothing. The join's line closes the group under them, as it does on the card.
    if (entry.kind === 'branch') {
      rows.push(branchRow(entry.branch, view));
      continue;
    }
    if (entry.kind === 'join') {
      rows.push(['↳ join', joinSaid(entry.join, entry.branches), '', '', '', '']);
      continue;
    }
    // The two rows that bracket a nested Loop's group, said in the card's own words: where it opened
    // and what closed it. The four columns after them are the Generations' and stay empty here.
    const said = entry.kind === 'loop-head' ? loopOpenedSaid(entry.loop) : loopClosedSaid(entry.loop);
    rows.push([`↳ ${entry.kind === 'loop-head' ? loopSaid(entry.loop) : entry.loop.name}`, said, '', '', '', '']);
  }
  if (rows.length === 0) return [];
  const heads = [
    generationColumns.generation,
    generationColumns.period,
    generationColumns.slack,
    generationColumns.verdicts,
    generationColumns.decision,
    generationColumns.wall,
  ];
  return ['## The generations', '', ...table(heads, rows), ''];
}

/**
 * One branch of a fork as a row of the same six columns, under the generation that forked it — the
 * card's own branch row (`branchRow`, `workbench.ts`) in the columns a document has.
 *
 * Two of the six a branch does not hold, and they are the card's two: it asked for what its own act
 * node was given, which the ledger does not carry, so the asked side of the period column is the em
 * dash a number nobody recorded is always shown as; and the wall time is the generation's, which is
 * where a person reads it. What the branch did is its own lines, joined the way this file joins a
 * branch's phrases everywhere else, because a table cell is one line.
 */
function branchRow(branch: BranchView, view: RunView): string[] {
  return [
    `↳ ${branchSaid(branch)}`,
    askedObservedSaid(branch, view.run.words?.strategy),
    slackSaid(branch),
    branch.verdicts.length === 0 ? NOTHING_JUDGED : branch.verdicts.map((v) => `${v.outcome} ${v.ruleId}`).join(', '),
    branchLines(view, branch).join('; '),
    NOT_HELD,
  ];
}

/** One generation's row, at either depth: a nested one says which Loop it is a turn of. */
function generationRow(gen: GenerationView, loop: LoopView | undefined, view: RunView): string[] {
  return [
    loop === undefined ? String(gen.generation) : `${loop.name} ${String(gen.generation)}`,
    askedObservedSaid(gen, view.run.words?.strategy),
    slackSaid(gen),
    gen.verdicts.length === 0 ? NOTHING_JUDGED : gen.verdicts.map((v) => `${v.outcome} ${v.ruleId}`).join(', '),
    generationDecisionSaid(gen),
    duration(gen.wallMs),
  ];
}

/** One paragraph of reasoning per generation: what it asked for, what it measured, what was
 *  concluded of it, what it forked into, and what was decided — the report's own prose. */
function reasoningSection(generations: readonly GenerationView[], view: RunView): string[] {
  const lines: string[] = [];
  for (const entry of ledgerRows(generations)) {
    if (entry.kind !== 'generation') continue;
    const { row: gen } = entry;
    const which = entry.loop === undefined
      ? `Generation ${String(gen.generation)}`
      : `Generation ${String(gen.generation)} of loop ${entry.loop.name}`;
    lines.push(`### ${which}`, '', reasoningOf(gen, view), '');
  }
  return lines.length === 0 ? [] : ['## Recorded experiment history', '', ...lines];
}

/** The paragraph itself: the Strategy, the measurement, the verdicts, the branches and the decision,
 *  every one of them in the pack's own words where the pack declares any (#58). */
function reasoningOf(gen: GenerationView, view: RunView): string {
  const asked = `It asked the flow for ${strategySaid(gen.strategy, view.run.words?.strategy)}`;
  const measured = gen.observedPeriodNs === undefined
    ? ' and no report of it has been read'
    : ` and the report stated a clock period of ${String(gen.observedPeriodNs)} ns`
      + (gen.slackNs === undefined ? '' : `, with ${String(gen.slackNs)} ns of setup slack`);
  const judged = gen.verdicts.length === 0
    ? ` ${NOTHING_JUDGED[0]!.toUpperCase()}${NOTHING_JUDGED.slice(1)}.`
    : ` HimaJudge found ${gen.verdicts.map((v) => `${v.outcome} on ${v.ruleId}`).join(', ')}.`;
  const forked = gen.branches === undefined || gen.branches.length === 0
    ? ''
    : ` It forked into ${counted(gen.branches.length, 'branch')}: ${gen.branches.map(branchSaid).join('; ')}.`;
  const drilled = gen.loops === undefined || gen.loops.length === 0
    ? ''
    : ` It drilled down into ${counted(gen.loops.length, 'loop')}: ${gen.loops.map(loopSaid).join('; ')}.`;
  const decided = gen.decision === undefined ? ' Nothing was decided.' : ` The decision was ${gen.decision}.`;
  return `${asked}${measured}.${judged}${forked}${drilled}${decided} It took ${duration(gen.wallMs)}.`;
}

/** The path the Run took: one row per node, the latest transition of it, in the card's own columns. */
function pathSection(path: readonly NodeView[]): string[] {
  const rows = path.map((node, index) => [
    String(index + 1),
    node.nodeId,
    node.kind,
    node.state,
    String(node.attempt),
    [node.outcome, node.jobSession === undefined ? undefined : `session ${node.jobSession}`, node.reason]
      .filter((s) => s !== undefined)
      .join(', '),
  ]);
  if (rows.length === 0) return [];
  const heads = [pathColumns.index, pathColumns.node, pathColumns.kind, pathColumns.state, pathColumns.attempt, pathColumns.said];
  return ['## The path', '', ...table(heads, rows), ''];
}

/** Every Hard blocker the Campaign hit, each with the last lines its Job wrote, quoted whole. */
function blockersSection(blockers: readonly BlockerView[]): string[] {
  if (blockers.length === 0) return [];
  const lines: string[] = ['## The blockers', ''];
  for (const blocker of blockers) {
    const exit = blocker.lastExitCode === undefined ? '' : `, last exit ${String(blocker.lastExitCode)}`;
    lines.push(`${blocker.nodeId} after ${counted(blocker.attempts, 'attempt')}${exit}: ${blocker.reason}`, '');
    if (blocker.logTail !== undefined) lines.push(`${tailSaid(blocker.logTail)}:`, '', ...fenced(blocker.logTail), '');
  }
  return lines;
}

/** Every request to stop the Campaign, beside what was observed of the stop it asked for. */
function cancelsSection(cancels: readonly CancelView[], view: RunView): string[] {
  if (cancels.length === 0) return [];
  return [
    '## The cancels',
    '',
    ...table(['asked', 'observed'], cancels.map((cancel) => [cancel.at, cancelObserved(view, cancel).said])),
    '',
  ];
}

// ---------------------------------------------------------------------------------------------
// Reading the report back: the dialect above, and nothing else
// ---------------------------------------------------------------------------------------------

/** One block of the report as a face renders it. Four kinds, which is the whole dialect above. */
export type ReportBlock =
  | { readonly kind: 'heading'; readonly level: number; readonly text: string }
  | { readonly kind: 'paragraph'; readonly text: string }
  | { readonly kind: 'table'; readonly head: readonly string[]; readonly rows: readonly (readonly string[])[] }
  | { readonly kind: 'code'; readonly text: string };

/** The cells of one table line, with the escape `cell` above put back. */
const cellsOf = (line: string): string[] =>
  line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim().replaceAll('\\|', '|'));

/** Is this the rule under a table's head, `| --- | --- |`? */
const isRule = (line: string): boolean => /^\|(\s*:?-{3,}:?\s*\|)+$/.test(line.trim());

/**
 * Read a report back into the blocks a face renders — the one reader of the dialect this file
 * writes, shared by both mounts of the card so neither can render a report the other would not.
 *
 * Deliberately not a Markdown parser. It reads headings, paragraphs, tables and fenced code, which
 * is everything above and nothing else, and anything it does not recognise it keeps as a paragraph:
 * a report is evidence, and text this reader cannot name must still reach the person who opened it.
 *
 * @param markdown - the report, as the file on the Site holds it.
 * @returns its blocks, in the order the document has them.
 */
export function reportBlocks(markdown: string): ReportBlock[] {
  const lines = markdown.split('\n');
  const blocks: ReportBlock[] = [];
  let paragraph: string[] = [];
  const flush = (): void => {
    if (paragraph.length > 0) blocks.push({ kind: 'paragraph', text: paragraph.join(' ') });
    paragraph = [];
  };
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const fence = /^(`{3,})\s*\S*\s*$/.exec(line.trim());
    if (fence) {
      flush();
      const held: string[] = [];
      for (i += 1; i < lines.length && lines[i]!.trim() !== fence[1]!; i += 1) held.push(lines[i]!);
      blocks.push({ kind: 'code', text: held.join('\n') });
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      blocks.push({ kind: 'heading', level: heading[1]!.length, text: heading[2]!.trim() });
      continue;
    }
    if (line.trim().startsWith('|') && isRule(lines[i + 1] ?? '')) {
      flush();
      const head = cellsOf(line);
      const rows: string[][] = [];
      for (i += 2; i < lines.length && lines[i]!.trim().startsWith('|'); i += 1) rows.push(cellsOf(lines[i]!));
      i -= 1;
      blocks.push({ kind: 'table', head, rows });
      continue;
    }
    if (line.trim() === '') { flush(); continue; }
    paragraph.push(line.trim());
  }
  flush();
  return blocks;
}
