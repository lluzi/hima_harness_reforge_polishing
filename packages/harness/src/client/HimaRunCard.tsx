// The HimaGuide card for a Hima tool call: where the Run stands, the path it took to get there, what
// it read, what was concluded about it, and what it decided next. A presentation component and
// nothing else — it holds no Cordis context and no transport, and it reads the run through the one
// Hima fetch wrapper.
//
// It renders one Run whichever tool reported it: `hima_observe` answers with a Probe-campaign Run
// that has no fabric state at all, and `hima_run` with a Run HimaFabric drove through a graph. The
// card shows whatever the view carries and omits the rest, so one component serves both rather than
// two components drifting apart over the same JSON.
//
// What the card says — the words for every status and state, the colours, the banner's lines, every
// meter of the Budget against the bound it was started under, the decision's phrase, the two
// controls and what a cancel was observed to do — is `../card-labels.ts`,
// which the workbench page the host serves at `/hima/` (`../workbench.ts`) reads too, so the two
// mounts of the card say the same thing. The markers a driver reads and clicks (`data-hima-region`,
// `data-hima-state-*`, `data-hima-control`) are the same on both, and are listed there.
import { Fragment, useEffect, useState, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import type { BranchView, GenerationJoinView, GenerationVerdictView, GenerationView, LoopView } from '../generations.js';
import type { BlockerView, Citation, DecisionView, ExperienceView, NodeView, ObservationView, RunView, RunWords, VerdictView } from '../remote.js';
import { experienceReport, reportBlocks, type ReportBlock } from '../experience-report.js';
import type { SemanticValue } from '../semantics.js';
import { bad, bannerLines, branchesIn, branchesState, branchLines, branchStateLabel, cancelAsked, cancelObserved, chosenSaid, citedSaid, counted, decisionColour, decisionState, duration, EXPERIENCE_HEADING, EXPERIENCE_MARKDOWN_LINK, experienceFileSaid, experienceMarkdownHref, experienceState, experienceWrittenSaid, factQuestions, generationColumns, generationDecisionSaid, generationsState, generationStateLabel, good, groupSaid, jobEnding, joinSaid, labelled, LEDGER_ORDER, ledgerRows, loopClosedSaid, loopOpenedSaid, loopOutcomeLabel, loopSaid, loopsIn, loopsState, meterRows, metersState, nameOf, NO_FABRIC_STATE, nodeStateLabel, NOT_HELD, NOTHING_JUDGED, outcomeColour, askedObservedSaid, plain, runControls, runStatusLabel, showsCancel, showsResume, slackSaid, warn } from '../card-labels.js';
import { actOnRun, fetchRun, type HimaFailure } from './api.js';

/** The slice of the tool block this card reads. The owner passes the frozen call or result node. */
export interface ToolBlock {
  readonly callId: string;
  /** Present only on a settled result; a running call has no `kind`. */
  readonly kind?: string;
  readonly content?: readonly { readonly type: string; readonly text?: string }[];
  readonly isError?: boolean;
}

/** What a Hima tool answers with; only the run id is load-bearing for this card. */
interface RunBearingToolValue { readonly runId?: unknown }

/** Every text the tool block carries, as one string; empty when it carries none. */
function toolText(block: ToolBlock): string {
  return (block.content ?? [])
    .filter((item) => item.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text!)
    .join('\n')
    .trim();
}

/** The run this call belongs to, read from the tool's own result value. */
function runIdOf(block: ToolBlock): string | undefined {
  if (block.kind === undefined || block.isError === true) return undefined;
  for (const item of block.content ?? []) {
    if (item.type !== 'text' || typeof item.text !== 'string') continue;
    try {
      const value = JSON.parse(item.text) as RunBearingToolValue;
      if (typeof value.runId === 'string' && value.runId !== '') return value.runId;
    } catch {
      // Not this block's JSON; keep looking rather than guessing.
    }
  }
  return undefined;
}

const card: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, lineHeight: '20px' };
const muted: CSSProperties = { color: 'var(--dsw-alias-label-tertiary, #6b7280)' };
const mono: CSSProperties = { fontFamily: 'var(--ds-font-family-code, monospace)', overflowWrap: 'anywhere' };
const block: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 2, paddingLeft: 12, borderLeft: '2px solid var(--dsw-alias-border-l2, #e5e7eb)' };
const heading: CSSProperties = { ...muted, textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: 11 };
const logTail: CSSProperties = {
  ...mono,
  whiteSpace: 'pre-wrap',
  maxHeight: 180,
  overflow: 'auto',
  margin: 0,
  padding: 6,
  background: 'var(--dsw-alias-fill-secondary, #f3f4f6)',
  borderRadius: 4,
};

/** The `data-hima-state-*` attributes of a region, from the state it carries. */
const stateAttributes = (state: Readonly<Record<string, string>>): Record<string, string> =>
  Object.fromEntries(Object.entries(state).map(([key, value]) => [`data-hima-state-${key}`, value]));

/** A section with a heading, rendered only when it has something in it; marked as a region when a driver reads it. */
function Section({ title, region, state, children }: { title: string; region?: string; state?: Readonly<Record<string, string>>; children: ReactNode }): ReactElement {
  const marked = region === undefined ? {} : { 'data-hima-region': region, ...stateAttributes(state ?? {}) };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }} {...marked}>
      <div style={heading}>{title}</div>
      {children}
    </div>
  );
}

/**
 * The banner: where the Run stands, what it is for, and how far into its Loop it is. Everything here
 * comes off the run row, so a Run HimaFabric never started — an observation's own Probe-campaign Run
 * — shows only its identity and says nothing it does not know.
 *
 * What the Run has *spent* is the section under it and not a clause here (#27b): a Budget said both
 * ways at once is two Budgets, and the one that pairs each meter with its bound is the one to keep.
 */
function StatusBanner({ view }: { view: RunView }): ReactElement {
  const { run } = view;
  const status = run.status === undefined ? undefined : labelled(runStatusLabel, run.status);
  const lines = bannerLines(view.run);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }} data-hima-region="run-status" {...(run.status === undefined ? {} : { 'data-hima-state-status': run.status })}>
      <div>
        {status === undefined
          ? <span style={muted}>{NO_FABRIC_STATE}</span>
          : <span style={{ color: status.colour, fontWeight: 500 }}>{status.said}</span>}
        {run.packId === undefined ? null : <span style={{ ...muted, ...mono }}> · {run.packId}</span>}
      </div>
      {[lines.goal, lines.strategy, lines.generation].filter((l): l is string => l !== undefined).map((line) => <div key={line} style={muted}>{line}</div>)}
    </div>
  );
}

/**
 * One meter of the Budget as a bar against its bound: the track is the bound, the fill is what has
 * been spent, and the tick is where the bound falls.
 *
 * Only a meter whose bound accumulates in the same kind carries one, which is `meterRows`' call and
 * not this mount's — the page draws the same three, from the same two numbers, so the two mounts
 * cannot come to draw a Budget differently.
 */
function MeterBar({ bar, spent }: { bar: { readonly now: number; readonly bound: number }; spent: boolean }): ReactElement {
  const scale = Math.max(bar.bound, bar.now, 1);
  const filled = Math.min(100, (bar.now / scale) * 100);
  const tick = Math.min(100, (bar.bound / scale) * 100);
  return (
    <span style={{ position: 'relative', width: 96, height: 6, borderRadius: 3, background: 'var(--dsw-alias-fill-secondary, #f3f4f6)', color: spent ? bad : plain }}>
      <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${filled.toFixed(1)}%`, borderRadius: 3, background: 'currentColor' }} />
      <span style={{ position: 'absolute', top: -2, bottom: -2, left: `calc(${tick.toFixed(1)}% - 1px)`, width: 2, background: 'var(--dsw-alias-label-tertiary, #6b7280)' }} />
    </span>
  );
}

/**
 * What the Campaign has spent, every meter against the bound it was started under — the same region,
 * the same state keys and the same sentences the workbench page shows under its own third question
 * (`../workbench.ts`, `meterSection`). One Budget, one wording, both mounts.
 *
 * The same three columns as the page's, too: what the meter is called, the meter drawn against its
 * bound, and the rest of the sentence that says it, from `meterRows`' own split of the two — so the
 * bars line up in one column beside the names of the meters they draw, and a meter no bar can
 * honestly draw leaves that column empty. One grid and not one row each, because columns that are
 * not shared are not columns.
 *
 * It answers the question the page's headline board asks in those words, so the heading is that
 * question and not a second name for the same section.
 */
function MetersSection({ view }: { view: RunView }): ReactElement | null {
  const rows = meterRows(view);
  if (rows.length === 0) return null;
  return (
    <Section title={factQuestions.spent} region="run-meters" state={metersState(view)}>
      <div style={{ display: 'grid', gridTemplateColumns: 'max-content 96px minmax(0, max-content)', gap: '2px 8px', alignItems: 'center' }}>
        {rows.map((row) => (
          <Fragment key={row.key}>
            <span style={muted}>{row.label}</span>
            {row.bar === undefined ? <span /> : <MeterBar bar={row.bar} spent={row.spent === true} />}
            <span style={muted}>{row.detail}</span>
          </Fragment>
        ))}
      </div>
    </Section>
  );
}

/**
 * The generations table: one row per Generation the Run has opened, oldest first — what a Campaign
 * has done, as against the path below it, which is where it stands. The same six columns, the same
 * words and the same markers as the workbench page's table (`../workbench.ts`).
 *
 * A Generation whose Explore node drilled down carries the Loop it opened as a group of rows under
 * its own (#28): a head naming the Loop and where it opened, its Generations rendered by this same
 * row component, and a foot saying what closed it. The whole table is the region `run-loops` when
 * there is one — how many Loops a Campaign opened is a fact about the Campaign and not about any one
 * of its rows — and the region is absent on a Run that opened none, exactly as on the page.
 *
 * Under it on such a Run, one line saying what the order of the rows is (`LEDGER_ORDER`): the
 * ledger's own and not the clock's, because an outer generation's measurement can be taken after
 * the Loop it opened has closed and is still listed above that Loop's rows. The page says the same
 * sentence under its plot, which is where the order is easiest to misread.
 *
 * It scrolls inside its own box: six columns, one of them a whole convergence rule in words, is
 * wider than a chat's tool view, and a card that made the conversation scroll sideways would be
 * unreadable everywhere else.
 */
function GenerationsTable({ view }: { view: RunView }): ReactElement {
  const heads = [generationColumns.generation, generationColumns.period, generationColumns.slack, generationColumns.verdicts, generationColumns.decision, generationColumns.wall];
  const loops = loopsIn(view);
  const marked = loops.length === 0 ? {} : { 'data-hima-region': 'run-loops', ...stateAttributes(loopsState(view)) };
  // The fork's region wraps the same table, exactly as the drill-down's does and for the same
  // reasons: how many branches a Campaign forked into and which fork it is inside are facts about
  // the Campaign, not about one of its rows. Absent on a Run that forked nowhere.
  const forked = branchesIn(view).length === 0 ? {} : { 'data-hima-region': 'run-branches', ...stateAttributes(branchesState(view)) };
  // Every row from the one walk the workbench page renders from too (`ledgerRows`), in the one
  // order: which rows there are, where a Loop's group hangs and where a fork's branches hang is said
  // once, for both mounts.
  // The caption stands outside the region, as it does on the workbench page: a region's text is what
  // a driver reads, and the two mounts must read the same.
  return (
    <>
    <div {...marked}>
    <div {...forked}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', font: 'inherit' }}>
          <thead>
            <tr>
              {heads.map((head) => <th key={head} style={{ ...muted, textAlign: 'left', fontWeight: 500, padding: '2px 12px 2px 0', whiteSpace: 'nowrap' }}>{head}</th>)}
            </tr>
          </thead>
          <tbody>
            {ledgerRows(view.generations).map((entry) => {
              if (entry.kind === 'generation') return <GenerationRow key={`${entry.loop?.id ?? 'g'}-${entry.row.generation}`} row={entry.row} loop={entry.loop} words={view.run.words} />;
              if (entry.kind === 'branch') return <BranchRow key={`b${entry.row.generation}-${entry.branch.id}`} view={view} branch={entry.branch} />;
              if (entry.kind === 'join') return <JoinRow key={`b${entry.row.generation}-join`} join={entry.join} branches={entry.branches} />;
              return entry.kind === 'loop-head'
                ? <LoopHeadRow key={`${entry.loop.id}-head`} loop={entry.loop} />
                : <LoopFootRow key={`${entry.loop.id}-foot`} loop={entry.loop} />;
            })}
          </tbody>
        </table>
      </div>
    </div>
    </div>
    {loops.length === 0 ? null : <div style={muted}>{LEDGER_ORDER}</div>}
    </>
  );
}

/** What a nested row and the head and foot around it are stepped in by, and the rule that says they
 *  belong to the row above rather than beside it. */
const nested: CSSProperties = { paddingLeft: 12, borderLeft: '2px solid var(--dsw-alias-border-l2, #e5e7eb)' };

/** The head of a drill-down Loop's group of rows: what the Loop is, what it came to and in how many
 *  Generations, and the Explore node it was opened at — which is the row directly above it. */
function LoopHeadRow({ loop }: { loop: LoopView }): ReactElement {
  const outcome = loop.outcome === undefined ? undefined : labelled(loopOutcomeLabel, loop.outcome);
  return (
    <tr data-hima-loop={loop.id}>
      <td colSpan={6} style={{ ...nested, paddingTop: 6, borderTop: '1px solid var(--dsw-alias-border-l2, #e5e7eb)' }}>
        <span style={{ color: outcome?.colour ?? plain, fontWeight: 500 }}>{loopSaid(loop)}</span>{' '}
        <span style={muted}>{loopOpenedSaid(loop)}</span>
      </td>
    </tr>
  );
}

/** The foot of the group: what closed the Loop, or that nothing has and the Run is still inside it. */
function LoopFootRow({ loop }: { loop: LoopView }): ReactElement {
  return (
    <tr data-hima-loop={loop.id}>
      <td colSpan={6} style={{ ...nested, ...muted }}>{loopClosedSaid(loop)}</td>
    </tr>
  );
}

/** The cell every row's verdicts are shown in: what each rule concluded and which rule it was. One
 *  component for a generation's verdicts and for a branch's, which are the same records read one
 *  level apart. Keyed by position as well as by rule, because a forked generation carries one
 *  verdict per rule *per branch* and two of them name the same rule. */
function VerdictCell({ verdicts }: { verdicts: readonly GenerationVerdictView[] }): ReactElement {
  if (verdicts.length === 0) return <div style={muted}>{NOTHING_JUDGED}</div>;
  return (
    <>
      {verdicts.map((v, index) => (
        <div key={`${String(index)}-${v.ruleId}`}>
          <span style={{ color: outcomeColour[v.outcome] ?? plain, fontWeight: 500 }}>{v.outcome}</span>{' '}
          <span style={mono}>{v.ruleId}</span>
        </div>
      ))}
    </>
  );
}

/** The six columns of one row of the ledger, at either depth and for a branch too. */
const ledgerCell: CSSProperties = { textAlign: 'left', verticalAlign: 'top', padding: '2px 12px 2px 0', borderTop: '1px solid var(--dsw-alias-border-l2, #e5e7eb)' };

/** One generation's row, at either depth: what it asked for and measured, what was concluded,
 *  decided, and spent. One component for both, because a Loop's turn is a Generation in exactly the
 *  sense the outer Loop's is — a nested row carries the Loop's id and its step in from the margin,
 *  and says everything else the same way. */
function GenerationRow({ row, loop, words }: { row: GenerationView; loop?: LoopView; words?: RunWords }): ReactElement {
  const state = labelled(generationStateLabel, row.state);
  const cell = ledgerCell;
  return (
    <tr {...(loop === undefined ? {} : { 'data-hima-loop': loop.id })}>
      <td style={loop === undefined ? cell : { ...cell, ...nested }}>
        <span style={mono}>{row.generation}</span>{' '}
        <span style={{ color: state.colour, fontWeight: 500 }}>{state.said}</span>
      </td>
      <td style={{ ...cell, ...mono }}>{askedObservedSaid(row, words?.strategy)}</td>
      <td style={{ ...cell, ...mono }}>{slackSaid(row)}</td>
      <td style={cell}><VerdictCell verdicts={row.verdicts} /></td>
      <td style={cell}>{generationDecisionSaid(row)}</td>
      <td style={{ ...cell, ...mono }}>{duration(row.wallMs)}</td>
    </tr>
  );
}

/**
 * One branch of a fork, as a row of the same table under the generation that forked it (#29b): what
 * it is and where it stands, the reading it took, what the join concluded of it, and what it did.
 *
 * The same six columns and the same words as the workbench page's branch row (`../workbench.ts`) —
 * the head being which branch it is and what it is doing, one under the other as the page sets them,
 * so the two mounts read alike.
 * Two of them a branch does not hold: it asked for what its own act node was given, which the ledger
 * does not carry, and it decided nothing — a fork is decided at its join, whose line is under these
 * rows — and the wall time is the generation's, which is where a person reads it.
 */
function BranchRow({ view, branch }: { view: RunView; branch: BranchView }): ReactElement {
  const state = labelled(branchStateLabel, branch.state);
  const cell = ledgerCell;
  return (
    <tr data-hima-branch={branch.id}>
      <td style={{ ...cell, ...nested }}>
        <div style={mono}>{branch.id}</div>
        <div style={{ color: state.colour, fontWeight: 500 }}>{state.said}</div>
      </td>
      <td style={{ ...cell, ...mono }}>{askedObservedSaid(branch, view.run.words?.strategy)}</td>
      <td style={{ ...cell, ...mono }}>{slackSaid(branch)}</td>
      <td style={cell}><VerdictCell verdicts={branch.verdicts} /></td>
      <td style={cell}>
        {/* Keyed by position as well as by text, for the reason the verdict cell is: two lines of one
            branch can read alike — two Jobs that ended the same way — and React would take them for
            one line and drop the other. */}
        {branchLines(view, branch).map((line, at) => <div key={`${String(at)}-${line}`} style={muted}>{line}</div>)}
      </td>
      <td style={{ ...cell, ...mono, ...muted }}>{NOT_HELD}</td>
    </tr>
  );
}

/** The foot of a forked generation's group: what the join concluded over all its branches, in the
 *  rule's own words — the other end of the bracket the first branch row opened. */
function JoinRow({ join, branches }: { join?: GenerationJoinView; branches: readonly BranchView[] }): ReactElement {
  return (
    <tr>
      <td colSpan={6} style={{ ...ledgerCell, ...nested, ...muted }}>{joinSaid(join, branches)}</td>
    </tr>
  );
}

/**
 * One node of the Run's path: where it stands now, which attempt it is on, the Job it waited for and
 * how that Job ended, and — when it is not simply done — why. One row per node the Run touched, in
 * the order it reached them; the transitions behind each row are the `node` records, which the
 * records route answers and this card does not repeat.
 */
function PathRow({ node, index, view }: { node: NodeView; index: number; view: RunView }): ReactElement {
  const state = labelled(nodeStateLabel, node.state);
  const exit = jobEnding(view, node.jobSession);
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
      <span style={{ ...muted, ...mono, minWidth: 16, textAlign: 'right' }}>{index + 1}</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <div>
          <span style={mono}>{node.nodeId}</span>{' '}
          <span style={muted}>({node.kind})</span>{' '}
          <span style={{ color: state.colour, fontWeight: 500 }}>{state.said}</span>
          <span style={muted}>
            {', '}attempt {node.attempt}
            {node.outcome === undefined ? '' : `, ${node.outcome}`}
            {exit === undefined ? '' : `, ${exit}`}
            {node.waitedForSlot === true ? ', waited for a slot' : ''}
          </span>
        </div>
        {node.jobSession === undefined ? null : <div style={{ ...muted, ...mono }}>{node.jobSession}</div>}
        {node.reason === undefined ? null : <div style={muted}>{node.reason}</div>}
      </div>
    </div>
  );
}

/**
 * The Hard blocker a waiting Run needs a person for: the node that gave up, how many attempts it
 * made, what its last Job exited with, and the tail of that Job's own log — so nobody has to log in
 * to the Site to see why.
 */
function BlockerRow({ blocker, latest }: { blocker: BlockerView; latest: boolean }): ReactElement {
  return (
    <div style={block}>
      <div>
        <span style={{ color: bad, fontWeight: 500 }}>blocked</span>{' '}
        <span style={mono}>{blocker.nodeId}</span>{' '}
        <span style={muted}>
          after {counted(blocker.attempts, 'attempt')}
          {blocker.lastExitCode === undefined ? '' : `, last exit ${blocker.lastExitCode}`}
        </span>
      </div>
      <div style={muted}>{blocker.reason}</div>
      {blocker.logTail === undefined
        ? null
        : <pre style={logTail} {...(latest ? { 'data-hima-region': 'run-blocker-tail' } : {})}>{blocker.logTail}</pre>}
    </div>
  );
}

/** What the card's controls need: which one is in flight, why the last one was refused, and how to act. */
interface Acting {
  readonly inFlight?: 'cancel' | 'resume';
  readonly refusal?: HimaFailure;
  act(action: 'cancel' | 'resume'): void;
}

/**
 * The two controls a person acts on a Run with, each shown only where it can act: cancel while the
 * Run is running or waiting, resume only while it waits. Beside them, the reason a click was
 * refused — a control that silently does nothing is a control nobody can trust.
 *
 * Both act over the same fenced routes the card reads through (ADR-0002), and the answer they get is
 * the Run itself, which is what the card then shows. Nothing here holds Run state: HimaGuide never
 * does (CONTEXT.md, *HimaGuide*).
 */
function RunControls({ view, acting }: { view: RunView; acting: Acting }): ReactElement {
  const shown: ('cancel' | 'resume')[] = [
    ...(showsCancel(view.run.status) ? ['cancel' as const] : []),
    ...(showsResume(view.run.status) ? ['resume' as const] : []),
  ];
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      {shown.map((name) => (
        <button
          key={name}
          type="button"
          data-hima-control={runControls[name].control}
          disabled={acting.inFlight !== undefined}
          onClick={() => { acting.act(name); }}
        >
          {runControls[name].said}
        </button>
      ))}
      <span data-hima-region="run-error" style={{ color: bad }}>{acting.refusal === undefined ? '' : acting.refusal.message}</span>
    </div>
  );
}

/**
 * What the Explore node chose and what it chose from. Each cited record is named beside what it is
 * where this same view carries it — the citations of a decision are verdicts as well as an
 * observation, and the view already holds both, so nothing has to be fetched again to resolve them.
 */
function DecisionRow({ decision, view }: { decision: DecisionView; view: RunView }): ReactElement {
  return (
    <div style={block}>
      <div>
        <span style={{ color: decisionColour(decision), fontWeight: 500 }}>{chosenSaid(decision, view.run.words)}</span>{' '}
        <span style={muted}>by {decision.chooser} at {decision.nodeId}</span>
      </div>
      <div style={muted}>from {Object.entries(decision.rationale).map(([name, value]) => `${name} ${value}`).join(', ')}</div>
      {decision.cites.map((recordId) => <div key={recordId} style={muted}>cites {citedSaid(view, recordId)}</div>)}
    </div>
  );
}

/**
 * The typed values an observation carried, which are the whole reason a report was read: a verdict
 * cites the observation, and this is what the observation actually said. A value the reader could
 * not find shows the reason it gave, never a zero standing in for it. A value read out of one of the
 * tool's path groups names that group beside itself, because a period from the design's clock group
 * and one from a synthesis tool's built-in group are not the same reading.
 */
function ValueRows({ values }: { values: readonly SemanticValue[] }): ReactElement | null {
  if (values.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {values.map((v) => (
        <div key={nameOf(v)} style={mono}>
          {nameOf(v)}:{' '}
          {v.value === null
            ? <span style={muted}>unknown — {v.unknownReason}</span>
            : <span>{v.value} {v.unit}</span>}
          {v.group ? <span style={muted}>{groupSaid(v)}</span> : null}
        </div>
      ))}
    </div>
  );
}

/** One observation: the declared path, the content hash, the reader, the time, and what was read. */
function ObservationRow({ observation }: { observation: ObservationView }): ReactElement {
  return (
    <div style={block}>
      <div style={mono}>{observation.path}</div>
      <div style={{ ...muted, ...mono }}>sha256 {observation.contentSha256}</div>
      <div style={muted}>
        read by {observation.reader.id}@{observation.reader.version} · {observation.bytes} bytes · {observation.at}
      </div>
      <ValueRows values={observation.values} />
    </div>
  );
}

/** One record a verdict cited. A citation that did not resolve is shown as such, never dropped. */
function CitationRow({ citation }: { citation: Citation }): ReactElement {
  return citation.observation === null
    ? <div style={{ ...muted, ...mono }}>cited record {citation.recordId} is not an observation of this run</div>
    : <ObservationRow observation={citation.observation} />;
}

/** One verdict: the outcome, the rule that produced it, and every observation it cited. */
function VerdictRow({ verdict }: { verdict: VerdictView }): ReactElement {
  return (
    <div style={block}>
      <div>
        <span style={{ color: outcomeColour[verdict.outcome], fontWeight: 500 }}>{verdict.outcome}</span>{' '}
        <span style={mono}>
          {verdict.ruleId}@{verdict.ruleVersion}
        </span>
      </div>
      {verdict.reason === undefined ? null : <div style={muted}>{verdict.reason}</div>}
      {verdict.cites.length === 0
        ? <div style={muted}>cites nothing</div>
        : verdict.cites.map((c) => <CitationRow key={c.recordId} citation={c} />)}
    </div>
  );
}

/**
 * The Campaign's technical report, the last section of the card on a Run that has ended and had one
 * written (#30): where both files are on the Site, what each hashes to, a link to the Markdown as
 * the Site has it, and the report itself.
 *
 * The same section the workbench page shows, in the same words, from the same composition
 * (`experience-report.ts`): the report is a function of this very run view and of the instant the
 * record kept, so what the chat's card renders is what is in the file, and neither mount reads a
 * Site to show it.
 */
function ExperienceSection({ view, experience }: { view: RunView; experience: ExperienceView }): ReactElement {
  return (
    <Section title={EXPERIENCE_HEADING} region="run-experience" state={experienceState(experience)}>
      <div style={block}>
        <div style={muted}>{experienceWrittenSaid(experience)}</div>
        <div style={{ ...muted, ...mono }}>{experienceFileSaid('markdown', experience.markdown)}</div>
        <div style={{ ...muted, ...mono }}>{experienceFileSaid('json', experience.json)}</div>
        <div><a href={experienceMarkdownHref(view.run.id)}>{EXPERIENCE_MARKDOWN_LINK}</a></div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {reportBlocks(experienceReport(view, experience.writtenAt).markdown).map((entry, index) => (
          <ReportBlockRow key={index} block={entry} />
        ))}
      </div>
    </Section>
  );
}

/**
 * One block of the report: a heading, a paragraph, a table or a fenced block of a Job's own log.
 *
 * The card's own renderer and no Markdown library, for the reason the page's is its own: the dialect
 * is closed (`experience-report.ts` writes it and `reportBlocks` reads it), a library in this bundle
 * would be a second opinion about what the file says, and this bundle ships beside React in a chat.
 */
function ReportBlockRow({ block: entry }: { block: ReportBlock }): ReactElement {
  if (entry.kind === 'heading') {
    // The report's own levels, stepped down under the section's heading: its title is the largest
    // thing in the section and never larger than the section itself.
    const size = entry.level <= 1 ? 14 : entry.level === 2 ? 13 : 12;
    return <div style={{ fontWeight: 600, fontSize: size, marginTop: 4 }}>{entry.text}</div>;
  }
  if (entry.kind === 'paragraph') return <div style={{ lineHeight: '20px' }}>{entry.text}</div>;
  if (entry.kind === 'code') {
    return <pre style={{ ...mono, margin: 0, padding: 8, overflowX: 'auto', whiteSpace: 'pre-wrap', background: 'var(--dsw-alias-fill-l2, #f3f4f6)' }}>{entry.text}</pre>;
  }
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', font: 'inherit' }}>
        <thead>
          <tr>
            {entry.head.map((head) => <th key={head} style={{ ...muted, textAlign: 'left', fontWeight: 500, padding: '2px 12px 2px 0', whiteSpace: 'nowrap' }}>{head}</th>)}
          </tr>
        </thead>
        <tbody>
          {entry.rows.map((cells, row) => (
            <tr key={row}>
              {cells.map((value, column) => <td key={column} style={{ padding: '2px 12px 2px 0', verticalAlign: 'top' }}>{value}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The coded reason there is nothing to show. Rendered, never swallowed. */
function FailureRow({ error }: { error: HimaFailure }): ReactElement {
  return (
    <div style={block}>
      <div style={{ color: bad }}>HimaHarness could not read this run</div>
      <div style={mono}>{error.code}</div>
      <div style={muted}>{error.message}</div>
    </div>
  );
}

/**
 * The whole Run, in the order a person asks about it: where it stands, the path it took, what a
 * person still has to clear, what it read and concluded, and what it decided next. Every section is
 * rendered only when the view carries one, so an observation's Run shows what an observation has and
 * a driven Run shows the rest.
 */
function RunBody({ view, acting }: { view: RunView; acting: Acting }): ReactElement {
  const latestCancel = view.cancels[view.cancels.length - 1];
  return (
    <>
      <StatusBanner view={view} />
      <MetersSection view={view} />
      <RunControls view={view} acting={acting} />
      {view.generations.length === 0
        ? null
        : (
          <Section title="generations" region="run-generations" state={generationsState(view.generations)}>
            <GenerationsTable view={view} />
          </Section>
        )}
      {view.nodes.length === 0
        ? null
        : (
          <Section title="path" region="run-nodes" state={Object.fromEntries(view.nodes.map((n) => [n.nodeId, n.state]))}>
            {view.nodes.map((node, index) => <PathRow key={node.nodeId} node={node} index={index} view={view} />)}
          </Section>
        )}
      {latestCancel === undefined
        ? null
        : (
          <Section title="cancel" region="run-cancel" state={{ observed: cancelObserved(view, latestCancel).key }}>
            {view.cancels.map((c) => (
              <div key={c.recordId} style={block}>
                <div style={muted}>{cancelAsked(c)}</div>
                <div style={muted}>{cancelObserved(view, c).said}</div>
              </div>
            ))}
          </Section>
        )}
      {view.blockers.length === 0
        ? null
        : (
          <Section title="blocker" region="run-blocker" state={{ count: String(view.blockers.length), node: view.blockers[view.blockers.length - 1]!.nodeId }}>
            {view.blockers.map((b, i) => <BlockerRow key={b.recordId} blocker={b} latest={i === view.blockers.length - 1} />)}
          </Section>
        )}
      {view.refusals.length === 0
        ? null
        : (
          <Section title="refused">
            {view.refusals.map((r) => (
              <div key={r.recordId} style={block}>
                <div style={{ color: warn }}>refused</div>
                <div style={mono}>{r.path}</div>
                <div style={muted}>{r.reason}</div>
              </div>
            ))}
          </Section>
        )}
      {view.observations.length === 0
        ? null
        : (
          <Section title="observed" region="run-observation" state={{ count: String(view.observations.length) }}>
            {view.observations.map((o) => <ObservationRow key={o.recordId} observation={o} />)}
          </Section>
        )}
      {view.verdicts.length === 0
        ? null
        : (
          <Section title="verdicts">
            {view.verdicts.map((v) => <VerdictRow key={v.recordId} verdict={v} />)}
          </Section>
        )}
      {view.decision === null
        ? null
        : (
          <Section title="decision" region="run-decision" state={decisionState(view.decision)}>
            <DecisionRow decision={view.decision} view={view} />
          </Section>
        )}
      {view.experience === undefined ? null : <ExperienceSection view={view} experience={view.experience} />}
    </>
  );
}

/**
 * Render one Hima tool call: the Run it reported, where that Run stands, the path it took, and
 * everything it wrote down on the way.
 *
 * @param props - the keyed toolview payload; only the frozen call/result block is read.
 * @returns the Hima run card.
 */
export function HimaRunCard({ block: toolBlock }: { block: ToolBlock }): ReactElement {
  const runId = runIdOf(toolBlock);
  const [state, setState] = useState<{ view?: RunView; error?: HimaFailure }>({});
  const [acted, setActed] = useState<{ inFlight?: 'cancel' | 'resume'; refusal?: HimaFailure }>({});

  useEffect(() => {
    if (runId === undefined) return;
    const controller = new AbortController();
    setState({});
    setActed({});
    void fetchRun(runId, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setState(result.ok ? { view: result.value } : { error: result.error });
    });
    return () => { controller.abort(); };
  }, [runId]);

  // A control's answer is the Run itself, so the card renders it and nothing is fetched again. A
  // refusal leaves the card showing the Run as it was last read and says why beside the control that
  // was clicked — which is the honest thing to show, because the Run may not have moved at all (a
  // Site that could not be asked writes nothing) and this card is not the place to guess.
  const acting: Acting = {
    ...acted,
    act: (action) => {
      if (runId === undefined || acted.inFlight !== undefined) return;
      setActed({ inFlight: action });
      void actOnRun(runId, action).then((result) => {
        setActed(result.ok ? {} : { refusal: result.error });
        if (result.ok) setState({ view: result.value });
      });
    },
  };

  if (runId === undefined) {
    // A failed call has something to say, and it is the tool's own words: saying "this call reported
    // no run" over the top of an error would hide the only explanation there is.
    if (toolBlock.kind !== undefined && toolBlock.isError === true) {
      const said = toolText(toolBlock);
      return (
        <div style={card}>
          <div style={{ color: bad }}>this HimaHarness call failed</div>
          <div style={{ ...muted, ...mono }}>{said === '' ? 'the tool reported an error with no text' : said}</div>
        </div>
      );
    }
    return <div style={{ ...card, ...muted }}>{toolBlock.kind === undefined ? 'working…' : 'this call reported no run'}</div>;
  }
  return (
    <div style={card}>
      <div style={{ ...muted, ...mono }}>{runId}</div>
      {state.error !== undefined ? <FailureRow error={state.error} /> : null}
      {state.view !== undefined ? <RunBody view={state.view} acting={acting} /> : null}
      {state.error === undefined && state.view === undefined ? <div style={muted}>reading the run…</div> : null}
    </div>
  );
}
