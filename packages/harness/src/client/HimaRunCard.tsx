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
import { Fragment, useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import type { BranchView, GenerationJoinView, GenerationVerdictView, GenerationView, LoopView } from '../generations.js';
import type { BlockerView, Citation, CodeView, DecisionView, ExperienceView, KnowledgeView, NodeView, ObservationView, RunView, RunWords, VerdictView, WorkshopView } from '../remote.js';
import { experienceReport, reportBlocks, type ReportBlock } from '../experience-report.js';
import type { SemanticValue } from '../semantics.js';
import { bannerLines, runPurposeMark, branchesIn, branchesState, branchLines, branchStateLabel, cancelAsked, cancelObserved, chosenSaid, citedSaid, counted, decisionState, duration, EXPERIENCE_HEADING, EXPERIENCE_MARKDOWN_LINK, experienceFileSaid, experienceMarkdownHref, experienceState, experienceWrittenSaid, factQuestions, generationColumns, generationDecisionSaid, generationsState, generationStateLabel, groupSaid, jobEnding, joinSaid, labelled, LEDGER_ORDER, ledgerRows, loopClosedSaid, loopOpenedSaid, loopOutcomeLabel, loopSaid, loopsIn, loopsState, meterRows, metersState, nameOf, NO_FABRIC_STATE, nodeStateLabel, NOT_HELD, NOTHING_JUDGED, askedObservedSaid, readerSaid, runControls, runStatusLabel, showsCancel, showsResume, slackSaid, codeOfWorkshop, codeSaid, workshopSaid, workshopState, workshopStateLabel } from '../card-labels.js';
import { actOnRun, controlRun, fetchArchive, fetchMaterial, fetchRun, type HimaFailure, type HimaResult } from './api.js';
import { Glyph } from './glyphs.js';

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

/** The `data-hima-state-*` attributes of a region, from the state it carries. */
const stateAttributes = (state: Readonly<Record<string, string>>): Record<string, string> =>
  Object.fromEntries(Object.entries(state).map(([key, value]) => [`data-hima-state-${key}`, value]));

/** A section with a heading, rendered only when it has something in it; marked as a region when a driver reads it. */
function Section({ title, region, state, children }: { title: string; region?: string; state?: Readonly<Record<string, string>>; children: ReactNode }): ReactElement {
  const marked = region === undefined ? {} : { 'data-hima-region': region, ...stateAttributes(state ?? {}) };
  return (
    <div className="hima-run-card-section" {...marked}>
      <div className="hima-run-card-heading">{title}</div>
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
    <div className="hima-run-card-section" data-hima-region="run-status" {...(run.status === undefined ? {} : { 'data-hima-state-status': run.status })}>
      <div>
        {status === undefined
          ? <span className="hima-muted">{NO_FABRIC_STATE}</span>
          : <span className="hima-state-word" data-state={run.status}>{status.said}</span>}
        {run.packId === undefined ? null : <span className="hima-muted hima-mono"> · {run.packId}</span>}
        {runPurposeMark(run.purpose) === undefined ? null : <span className="hima-muted" data-hima-state-purpose={run.purpose}> · {runPurposeMark(run.purpose)}</span>}
      </div>
      {[lines.goal, lines.strategy, lines.generation].filter((l): l is string => l !== undefined).map((line) => <div key={line} className="hima-muted">{line}</div>)}
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
  const filled = Math.min(96, (bar.now / scale) * 96);
  const tick = Math.min(96, (bar.bound / scale) * 96);
  return (
    <svg className="hima-meter-bar" width={96} height={10} viewBox="0 0 96 10" aria-hidden="true">
      <rect className="hima-meter-track" y={2} width={96} height={6} rx={3} />
      <rect className="hima-meter-fill" data-hima-spent={spent} y={2} width={filled} height={6} rx={3} />
      <rect className="hima-meter-tick" x={Math.max(0, tick - 1)} width={2} height={10} />
    </svg>
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
      <div className="hima-meter-grid">
        {rows.map((row) => (
          <Fragment key={row.key}>
            <span className="hima-muted">{row.label}</span>
            {row.bar === undefined ? <span /> : <MeterBar bar={row.bar} spent={row.spent === true} />}
            <span className="hima-muted">{row.detail}</span>
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
export function GenerationsTable({ view }: { view: RunView }): ReactElement {
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
      <div className="hima-run-card-ledger">
        <table>
          <thead>
            <tr>
              {heads.map((head) => <th key={head}>{head}</th>)}
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
    {loops.length === 0 ? null : <div className="hima-muted">{LEDGER_ORDER}</div>}
    </>
  );
}

/** The head of a drill-down Loop's group of rows: what the Loop is, what it came to and in how many
 *  Generations, and the Explore node it was opened at — which is the row directly above it. */
function LoopHeadRow({ loop }: { loop: LoopView }): ReactElement {
  return (
    <tr data-hima-loop={loop.id}>
      <td colSpan={6} className="hima-run-card-cell hima-run-card-cell-nested">
        <span className="hima-outcome-word" data-outcome={loop.outcome ?? 'open'}>{loopSaid(loop)}</span>{' '}
        <span className="hima-muted">{loopOpenedSaid(loop)}</span>
      </td>
    </tr>
  );
}

/** The foot of the group: what closed the Loop, or that nothing has and the Run is still inside it. */
function LoopFootRow({ loop }: { loop: LoopView }): ReactElement {
  return (
    <tr data-hima-loop={loop.id}>
      <td colSpan={6} className="hima-run-card-cell hima-run-card-cell-nested hima-muted">{loopClosedSaid(loop)}</td>
    </tr>
  );
}

/** The cell every row's verdicts are shown in: what each rule concluded and which rule it was. One
 *  component for a generation's verdicts and for a branch's, which are the same records read one
 *  level apart. Keyed by position as well as by rule, because a forked generation carries one
 *  verdict per rule *per branch* and two of them name the same rule. */
function VerdictCell({ verdicts }: { verdicts: readonly GenerationVerdictView[] }): ReactElement {
  if (verdicts.length === 0) return <div className="hima-muted">{NOTHING_JUDGED}</div>;
  return (
    <>
      {verdicts.map((v, index) => (
        <div key={`${String(index)}-${v.ruleId}`}>
          <span className="hima-outcome-word" data-outcome={v.outcome}>{v.outcome}</span>{' '}
          <span className="hima-mono">{v.ruleId}</span>
        </div>
      ))}
    </>
  );
}

/** One generation's row, at either depth: what it asked for and measured, what was concluded,
 *  decided, and spent. One component for both, because a Loop's turn is a Generation in exactly the
 *  sense the outer Loop's is — a nested row carries the Loop's id and its step in from the margin,
 *  and says everything else the same way. */
function GenerationRow({ row, loop, words }: { row: GenerationView; loop?: LoopView; words?: RunWords }): ReactElement {
  const state = labelled(generationStateLabel, row.state);
  const cell = loop === undefined ? 'hima-run-card-cell' : 'hima-run-card-cell hima-run-card-cell-nested';
  return (
    <tr {...(loop === undefined ? {} : { 'data-hima-loop': loop.id })}>
      <td className={cell}>
        <span className="hima-mono">{row.generation}</span>{' '}
        <span className="hima-state-word" data-state={row.state}>{state.said}</span>
      </td>
      <td className="hima-run-card-cell hima-mono">{askedObservedSaid(row, words?.strategy)}</td>
      <td className="hima-run-card-cell hima-mono">{slackSaid(row)}</td>
      <td className="hima-run-card-cell"><VerdictCell verdicts={row.verdicts} /></td>
      <td className="hima-run-card-cell">{generationDecisionSaid(row)}</td>
      <td className="hima-run-card-cell hima-mono">{duration(row.wallMs)}</td>
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
  return (
    <tr data-hima-branch={branch.id}>
      <td className="hima-run-card-cell hima-run-card-cell-nested">
        <div className="hima-mono">{branch.id}</div>
        <div className="hima-state-word" data-state={branch.state}>{state.said}</div>
      </td>
      <td className="hima-run-card-cell hima-mono">{askedObservedSaid(branch, view.run.words?.strategy)}</td>
      <td className="hima-run-card-cell hima-mono">{slackSaid(branch)}</td>
      <td className="hima-run-card-cell"><VerdictCell verdicts={branch.verdicts} /></td>
      <td className="hima-run-card-cell">
        {/* Keyed by position as well as by text, for the reason the verdict cell is: two lines of one
            branch can read alike — two Jobs that ended the same way — and React would take them for
            one line and drop the other. */}
        {branchLines(view, branch).map((line, at) => <div key={`${String(at)}-${line}`} className="hima-muted">{line}</div>)}
      </td>
      <td className="hima-run-card-cell hima-mono hima-muted">{NOT_HELD}</td>
    </tr>
  );
}

/** The foot of a forked generation's group: what the join concluded over all its branches, in the
 *  rule's own words — the other end of the bracket the first branch row opened. */
function JoinRow({ join, branches }: { join?: GenerationJoinView; branches: readonly BranchView[] }): ReactElement {
  return (
    <tr>
      <td colSpan={6} className="hima-run-card-cell hima-run-card-cell-nested hima-muted">{joinSaid(join, branches)}</td>
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
    <div className="hima-path-row">
      <span className="hima-muted hima-mono hima-path-index">{index + 1}</span>
      <div className="hima-path-body">
        <div>
          <span className="hima-mono">{node.nodeId}</span>{' '}
          <span className="hima-muted">({node.kind})</span>{' '}
          <span className="hima-state-word" data-state={node.state}>{state.said}</span>
          <span className="hima-muted">
            {', '}attempt {node.attempt}
            {node.outcome === undefined ? '' : `, ${node.outcome}`}
            {exit === undefined ? '' : `, ${exit}`}
            {node.waitedForSlot === true ? ', waited for a slot' : ''}
          </span>
        </div>
        {node.jobSession === undefined ? null : <div className="hima-muted hima-mono">{node.jobSession}</div>}
        {node.reason === undefined ? null : <div className="hima-muted">{node.reason}</div>}
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
    <div className="hima-block">
      <div>
        <span className="hima-state-word" data-state="blocked">blocked</span>{' '}
        <span className="hima-mono">{blocker.nodeId}</span>{' '}
        <span className="hima-muted">
          after {counted(blocker.attempts, 'attempt')}
          {blocker.lastExitCode === undefined ? '' : `, last exit ${blocker.lastExitCode}`}
        </span>
      </div>
      <div className="hima-muted">{blocker.reason}</div>
      {blocker.logTail === undefined
        ? null
        : <pre className="hima-logtail" {...(latest ? { 'data-hima-region': 'run-blocker-tail' } : {})}>{blocker.logTail}</pre>}
    </div>
  );
}

/** What the card's controls need: which one is in flight, why the last one was refused, and how to act. */
export interface Acting {
  readonly inFlight?: 'cancel' | 'resume' | 'pause' | 'continue';
  readonly sessionId?: string;
  readonly refusal?: HimaFailure;
  readonly notice?: string;
  act(action: 'cancel' | 'resume' | 'pause' | 'continue', nodeId?: string): void;
}

/** One action owner for both presentations. Cancel may supersede a long-running Resume reply. */
export function useRunActions(runId: string | undefined, onChanged: (view: RunView, action: NonNullable<Acting['inFlight']>, nodeId?: string) => void, sessionId?: string, view?: RunView): Acting {
  const [state, setState] = useState<{ runId?: string; inFlight?: Acting['inFlight']; refusal?: HimaFailure; notice?: string }>({ runId });
  const pending = useRef<{ runId: string; kind: NonNullable<Acting['inFlight']>; controller: AbortController } | undefined>(undefined);
  const latest = useRef({ runId, onChanged, view, sessionId });
  latest.current = { runId, onChanged, view, sessionId };
  useEffect(() => {
    setState({ runId });
    return () => {
      const active = pending.current;
      if (active !== undefined && active.runId === runId) { active.controller.abort(); pending.current = undefined; }
    };
  }, [runId]);
  return {
    ...(state.runId === runId ? state : {}),
    sessionId,
    act: (kind, nodeId) => {
      if (runId === undefined) return;
      const prior = pending.current;
      if (prior && !(prior.kind === 'resume' && kind === 'cancel')) return;
      prior?.controller.abort();
      const own = { runId, kind, controller: new AbortController() };
      pending.current = own; setState({ runId, inFlight: kind });
      const current = latest.current;
      const action: Promise<HimaResult<{ readonly view: RunView; readonly notice?: string }>> = current.view?.run.control
        ? current.sessionId ? controlRun(current.view, current.sessionId, kind === 'resume' ? 'continue' : kind, nodeId, own.controller.signal)
          .then((result) => result.ok ? { ok: true as const, value: { view: result.value.run, notice: result.value.notification.message } } : result)
          : Promise.resolve({ ok: false as const, error: { code: 'hima/not-authorized' as const, message: 'Open the owning conversation in Live Run to control this Run.' } })
        : kind === 'pause' || kind === 'continue' ? Promise.resolve({ ok: false as const, error: { code: 'hima/run-not-in-state' as const, message: 'This historical Run requires explicit ownership migration.' } })
          : actOnRun(runId, kind, own.controller.signal).then((result) => result.ok ? { ok: true as const, value: { view: result.value } } : result);
      void action.then((result) => {
        if (own.controller.signal.aborted || pending.current !== own || latest.current.runId !== runId) return;
        pending.current = undefined;
        setState(result.ok ? { runId, ...(result.value.notice === undefined ? {} : { notice: result.value.notice }) } : { runId, refusal: result.error });
        if (result.ok) {
          latest.current.onChanged(result.value.view, kind, nodeId);
        }
      });
    },
  };
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
export function RunControls({ view, acting, showDiagnostics = true }: { view: RunView; acting: Acting; showDiagnostics?: boolean }): ReactElement {
  const control = view.run.control;
  if (control) {
    const owner = control.owner === acting.sessionId;
    const active = view.run.status === 'running' || view.run.status === 'waiting';
    return <div className="hima-run-card-control-row" data-hima-region='execution-control' data-hima-state-owner={control.owner} data-hima-state-epoch={control.epoch} data-hima-state-revision={control.revision}>
      {showDiagnostics ? <span className="hima-muted">Owner {control.owner} · epoch {control.epoch} · revision {control.revision}</span> : null}
      <span>{control.paused.length ? `New work paused: ${control.paused.join(', ')}. Existing Jobs may still be running.` : 'New work requires this conversation’s explicit Agent action.'}</span>
      <div className="hima-run-card-control-buttons">
        {active && acting.sessionId ? <button type='button' className="hima-button" data-hima-control='pause' disabled={acting.inFlight !== undefined} onClick={() => acting.act('pause')}>Pause Run</button> : null}
        {active && owner && view.run.currentNode ? <button type='button' className="hima-button" data-hima-control='pause-node' disabled={acting.inFlight !== undefined} onClick={() => acting.act('pause', view.run.currentNode)}>Pause {view.run.currentNode}</button> : null}
        {active && owner ? control.paused.map((scope) => <button key={scope} type='button' className="hima-button" data-hima-control={scope === '*' ? 'continue' : `continue-node-${scope}`} disabled={acting.inFlight !== undefined} onClick={() => acting.act('continue', scope === '*' ? undefined : scope)}>Continue {scope === '*' ? 'Run' : scope}</button>) : null}
        {active && acting.sessionId ? <button type='button' className="hima-button" data-hima-control='cancel' disabled={acting.inFlight === 'cancel'} onClick={() => acting.act('cancel')}>Stop Run</button> : null}
      </div>
      {!owner ? <span className="hima-muted">Viewing this Run does not transfer execution ownership. You may pause or stop it as a human; enter its owning conversation to continue or perform node work.</span> : null}
      {acting.notice ? <span role='status' data-hima-region='control-notification'>{acting.notice}</span> : null}
      {Object.values(control.executions).map((execution) => <div key={execution.id} data-hima-region='node-execution' data-hima-state-execution={execution.id} data-hima-state-phase={execution.phase}>
        {execution.nodeId} · {execution.phase} · generation {execution.generation} · attempt {execution.attempt}<br /><span className="hima-mono">{execution.id}</span>
      </div>)}
      <span data-hima-region='run-error' className="hima-run-card-error">{acting.refusal?.message ?? ''}</span>
    </div>;
  }
  const shown: ('cancel' | 'resume')[] = [
    ...(showsCancel(view.run.status) ? ['cancel' as const] : []),
    ...(showsResume(view.run.status) ? ['resume' as const] : []),
  ];
  return (
    <div className="hima-run-card-control-buttons">
      {shown.map((name) => (
        <button
          key={name}
          type="button"
          className="hima-button"
          data-hima-control={runControls[name].control}
          disabled={acting.inFlight === 'cancel' || acting.inFlight === name}
          onClick={() => { acting.act(name); }}
        >
          {runControls[name].said}
        </button>
      ))}
      <span data-hima-region="run-error" className="hima-run-card-error">{acting.refusal === undefined ? '' : acting.refusal.message}</span>
    </div>
  );
}

/**
 * What the Explore node chose and what it chose from. Each cited record is named beside what it is
 * where this same view carries it — the citations of a decision are verdicts as well as an
 * observation, and the view already holds both, so nothing has to be fetched again to resolve them.
 */
export function DecisionRow({ decision, view }: { decision: DecisionView; view: RunView }): ReactElement {
  const state = decisionState(decision);
  return (
    <div className="hima-block">
      <div>
        <span className="hima-outcome-word" data-outcome={state.chosen}>{chosenSaid(decision, view.run.words)}</span>{' '}
        <span className="hima-muted">{decision.agent ? `by the conversational Agent at ${decision.nodeId}` : `by ${decision.chooser} at ${decision.nodeId}`}</span>
      </div>
      {decision.agent ? <div data-hima-region='decision-agent-rationale'><p>{decision.agent.rationale}</p><div className="hima-muted">session {decision.agent.sessionId} · execution {decision.agent.executionId} · Pack reference {decision.chooser}</div></div> : null}
      {Object.keys(decision.rationale).length ? <div className="hima-muted">from {Object.entries(decision.rationale).map(([name, value]) => `${name} ${value}`).join(', ')}</div> : null}
      {decision.cites.map((recordId) => <div key={recordId} className="hima-muted">cites {citedSaid(view, recordId)}</div>)}
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
    <div className="hima-run-card-section">
      {values.map((v) => (
        <div key={nameOf(v)} className="hima-mono">
          {nameOf(v)}:{' '}
          {v.value === null
            ? <span className="hima-muted">unknown — {v.unknownReason}</span>
            : <span>{v.value} {v.unit}</span>}
          {v.group ? <span className="hima-muted">{groupSaid(v)}</span> : null}
        </div>
      ))}
    </div>
  );
}

/** One observation: the declared path, the content hash, the reader, the time, and what was read. */
export function ObservationRow({ observation }: { observation: ObservationView }): ReactElement {
  return (
    <div className="hima-block">
      <div className="hima-mono">{observation.path}</div>
      <div className="hima-muted hima-mono">sha256 {observation.contentSha256}</div>
      <div className="hima-muted">
        read by {readerSaid(observation.reader)} · {observation.bytes} bytes · {observation.at}
      </div>
      <ValueRows values={observation.values} />
    </div>
  );
}

/**
 * The workshop of the node the Run stands at: where it stands, and what its current attempt wrote.
 *
 * The same block the Workbench mount draws, from the same view and in the same words (ADR-0004: a
 * card change lands in both mounts). The state's own colour beside the standing line, then the node,
 * the attempt, the entry and the session, then one row per file — its path, the head of its hash, its
 * size, and the language the pack says it is in. The hash is what a person holds the file on the Site
 * against; the file's *contents* are not shown, and reading one is #66.
 */
export function WorkshopSection({ view, workshop }: { view: RunView; workshop: WorkshopView }): ReactElement {
  const label = labelled(workshopStateLabel, workshop.state);
  const files = codeOfWorkshop(view);
  const job = workshop.jobSession === undefined ? undefined : view.jobs.findLast((record) => record.job.session === workshop.jobSession);
  return (
    <Section title="workshop" region="run-workshop" state={workshopState(workshop)}>
      <div className="hima-block">
        <div className="hima-state-word" data-state={workshop.state}>{workshopSaid(workshop)}</div>
        <div className="hima-muted">
          node {workshop.nodeId}, attempt {workshop.attempt}, entry {workshop.entry}
          {workshop.sessionId === undefined ? '' : `, session ${workshop.sessionId}`}
        </div>
        {workshop.executionId ? <div className="hima-muted">Conversational Agent · execution {workshop.executionId}<br />Model identity not recorded for this execution.</div> : null}
        {job ? <div className="hima-muted">Job {job.job.session} · {job.event}{job.exitCode === undefined ? '' : ` · exit ${job.exitCode}`}</div> : null}
        {files.length === 0
          ? <div className="hima-muted">nothing written yet — {label.said}</div>
          : files.map((code) => <div key={code.recordId} className="hima-mono">{codeSaid(code)}{workshop.executionId ? <span className="hima-muted"> · author session {code.sessionId}</span> : null}</div>)}
      </div>
    </Section>
  );
}

/**
 * The Run's complete material history. A click reads the selected record through the Host; it never
 * substitutes today's bytes for an old hash. The same component is used in chat and the workbench.
 */
export function MaterialSection({ view }: { view: RunView }): ReactElement | null {
  const [selected, setSelected] = useState<string>();
  const [answer, setAnswer] = useState<{ recordId: string; text?: string; error?: string; loading?: boolean }>();
  const request = useRef<AbortController | undefined>();
  const content = useRef<HTMLDivElement | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    request.current?.abort();
    setSelected(undefined);
    setAnswer(undefined);
  }, [view.run.id]);
  useEffect(() => {
    if (answer && !answer.loading) content.current?.scrollIntoView({ block: 'nearest' });
  }, [answer]);
  if (view.code.length === 0 && view.knowledge.length === 0) return null;
  const open = (record: CodeView | KnowledgeView) => {
    request.current?.abort();
    const own = new AbortController(); request.current = own;
    setSelected(record.recordId); setAnswer({ recordId: record.recordId, loading: true });
    void fetchMaterial(view.run.id, record.recordId, own.signal).then((result) => {
      if (own.signal.aborted) return;
      setAnswer(result.ok ? { recordId: record.recordId, text: result.value.text } : { recordId: record.recordId, error: result.error.message });
    });
  };
  const row = (record: CodeView | KnowledgeView, kind: 'code' | 'knowledge') => {
    const location = kind === 'code' ? (record as CodeView).path : (record as KnowledgeView).file;
    const provenance = kind === 'code' ? 'code' : (record as KnowledgeView).origin === 'input'
      ? ((record as KnowledgeView).exposedBytes ?? 0) > 0 ? 'input read' : 'input captured'
      : (record as KnowledgeView).origin === 'history' ? 'history read' : 'method knowledge';
    const superseded = view.revisions?.some(revision => revision.invalidatedRecordIds.includes(record.recordId));
    return <button type="button" key={record.recordId} onClick={() => open(record)} data-hima-control={`material-${record.recordId}`}
      data-selected={selected === record.recordId}
      title={`${location}${kind === 'knowledge' ? `\n${(record as KnowledgeView).purpose}` : ''}\nsource ${record.sessionId}\nsha256 ${record.sha256}`}
      className="hima-run-card-material-row">
      <span><strong>{location.split(/[\\/]/).at(-1)}</strong> · {provenance}{superseded ? ' · superseded' : ''} · {record.nodeId} · g{record.generation ?? '?'} / a{record.attempt}</span>
      <span>{record.sha256}</span>
    </button>;
  };
  const chosen = [...view.code, ...view.knowledge].find(record => record.recordId === selected);
  return <Section title="Code, inputs & knowledge" region="run-material" state={{ code: String(view.code.length), knowledge: String(view.knowledge.length) }}>
    <div className="hima-block">{view.code.map((record) => row(record, 'code'))}{view.knowledge.map((record) => row(record, 'knowledge'))}</div>
    {selected === undefined || chosen === undefined ? <div className="hima-muted">Choose a recorded version to verify and read its contents.</div>
      : <div ref={content}>{answer?.loading ? <div className="hima-muted">Reading the recorded version and verifying its hash…</div>
        : answer?.error ? <div role="alert" className="hima-run-card-error">Historical content unavailable: {answer.error}</div>
          : <><details className="hima-muted"><summary>Verified source · {chosen.nodeId}</summary>
            {'purpose' in chosen ? <div>{chosen.purpose}</div> : null}
            {'purpose' in chosen && chosen.origin === 'input' ? <div>Captured input · {chosen.exposedBytes ?? 0} bytes returned through the read interface.</div> : null}
            {'purpose' in chosen && chosen.sourceRun ? <div>Historical source: {chosen.sourceRun} · {chosen.sourcePurpose}<br />{chosen.sourceMaterialPath}<br />{chosen.conditions?.join(' ')}</div> : null}
            <div className="hima-mono">{chosen.path}<br />sha256 {chosen.sha256}<br />source {chosen.sessionId}</div>
          </details><pre data-hima-region="material-content" data-hima-state-record={selected} className="hima-logtail">{answer?.text}</pre></>}</div>}
  </Section>;
}

/** Pack-local delivered bytes, verified on explicit read; no Site polling on each UI refresh. */
export function ArchiveSection({ view }: { view: RunView }): ReactElement | null {
  const [manifest, setManifest] = useState<import('../experience-report.js').RunAssetManifest>();
  const [reading, setReading] = useState<{ path?: string; text?: string; error?: string; loading?: boolean }>({});
  const pending = useRef<AbortController | undefined>();
  useEffect(() => { pending.current?.abort(); setManifest(undefined); setReading({}); return () => pending.current?.abort(); }, [view.run.id]);
  const read = (material?: string) => {
    pending.current?.abort(); const controller = new AbortController(); pending.current = controller;
    setReading({ path: material, loading: true });
    void fetchArchive(view.run.id, material, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      if (!result.ok) { setReading({ path: material, error: result.error.message }); return; }
      setManifest(result.value.manifest); setReading({ path: material, text: result.value.text });
    });
  };
  if (!view.archive) return null;
  return <Section title='Knowledge archived in this Pack' region='run-archive' state={{ delivery: view.archive.delivery }}>
    <p className="hima-muted">Recorded delivery: {view.archive.delivery}{view.archive.reason ? ` · ${view.archive.reason}` : ''}</p>
    <button className='hima-button' data-hima-control='archive-verify' onClick={() => read()} disabled={reading.loading}>Verify archived materials</button>
    {reading.loading ? <p className="hima-muted">Reading and checking recorded content hashes…</p> : null}
    {reading.error ? <p role='alert' className="hima-run-card-error">{reading.error}</p> : null}
    {manifest ? <><p className="hima-muted hima-wrap">Run {manifest.runId} · Site {manifest.siteId} · Pack {manifest.pack.id}@{manifest.pack.version}</p>
      {manifest.materials.map(material => <button className='hima-button hima-run-card-archive-row' key={material.path} data-hima-control={`archive-material-${material.path}`} onClick={() => read(material.path)} title={`${material.source}\nsha256 ${material.sha256}`}>{material.path} · {material.bytes} bytes · {material.sha256.slice(0, 12)}</button>)}
      {reading.text !== undefined ? <div data-hima-region='archive-content'>{reading.path?.endsWith('.md') ? reportBlocks(reading.text).map((block, index) => <ReportBlockRow key={index} block={block} />) : <pre className="hima-logtail">{reading.text}</pre>}</div> : null}
    </> : null}
  </Section>;
}

export function GrowthSection({ view }: { view: RunView }): ReactElement | null {
  const branches = view.generations.flatMap(generation => (generation.growths ?? []).map(growth => ({ generation: generation.generation, growth })));
  if (!branches.length) return null;
  return <Section title='Additional research · Pack reference preserved' region='run-growth'>
    {branches.map(({ generation, growth }) => <details key={growth.recordId} data-hima-region={`growth-${growth.proposalId}`} data-hima-state-event={growth.event} className="hima-block">
      <summary data-hima-control={`growth-expand-${growth.proposalId}`}>{growth.proposalId} · generation {generation} · {growth.event}</summary>
      <p className="hima-muted">From {growth.parentNode ?? 'not admitted'} · Return to {growth.returnNode ?? 'not admitted'}</p>
      {growth.reason ? <p className="hima-muted">{growth.reason}</p> : null}
      {growth.nodes.map(node => <div key={node.recordId} className="hima-mono">{node.nodeId} · {node.kind} · {node.state}</div>)}
      <details><summary>{growth.evidence.length} evidence references</summary><pre className="hima-logtail">{growth.evidence.join('\n')}</pre></details>
    </details>)}
  </Section>;
}

export function RevisionSection({ view }: { view: RunView }): ReactElement | null {
  if (!view.revisions?.length) return null;
  return <Section title='Revisions · history retained' region='run-revisions'>
    {view.revisions.map(revision => <details key={revision.recordId} className="hima-block" data-hima-region={`revision-${revision.revisionId}`}>
      <summary data-hima-control={`revision-expand-${revision.revisionId}`}>Version {revision.version} · {revision.revisionId}</summary>
      <p className="hima-muted">Changed: {revision.changedNodes.join(', ')}<br />Rerun affected nodes: {revision.affectedNodes.join(', ')}</p>
      <p>{revision.invalidatedRecordIds.length} earlier records excluded from current evidence · {revision.reusedRecordIds.length} records reused</p>
      <p className="hima-muted">Superseded code remains readable under Code, inputs & knowledge. A new result requires the affected nodes to execute again.</p>
      <details><summary>Evidence identities</summary><pre className="hima-logtail">{JSON.stringify({ superseded: revision.invalidatedRecordIds, reused: revision.reusedRecordIds }, null, 2)}</pre></details>
    </details>)}
  </Section>;
}

/** One record a verdict cited. A citation that did not resolve is shown as such, never dropped. */
function CitationRow({ citation }: { citation: Citation }): ReactElement {
  return citation.observation === null
    ? <div className="hima-muted hima-mono">cited record {citation.recordId} is not an observation of this run</div>
    : <ObservationRow observation={citation.observation} />;
}

/** One verdict: the outcome, the rule that produced it, and every observation it cited. */
export function VerdictRow({ verdict }: { verdict: VerdictView }): ReactElement {
  return (
    <div className="hima-block">
      <div>
        <span className="hima-outcome-word" data-outcome={verdict.outcome}>{verdict.outcome}</span>{' '}
        <span className="hima-mono">
          {verdict.ruleId}@{verdict.ruleVersion}
        </span>
      </div>
      {verdict.reason === undefined ? null : <div className="hima-muted">{verdict.reason}</div>}
      {verdict.cites.length === 0
        ? <div className="hima-muted">cites nothing</div>
        : verdict.cites.map((c) => <CitationRow key={c.recordId} citation={c} />)}
    </div>
  );
}

/**
 * The Campaign's technical report, the last section of the card on a Run that has ended and had one
 * written (#30): where both files are on the Site, what each hashes to, a link to the Markdown as
 * the Site has it, and the report itself.
 *
 * Both mounts show a current ledger preview. The saved document may use an older renderer; only
 * the link reads and verifies its original bytes. No Site read is implied by this preview.
 */
export function ExperienceSection({ view, experience, onOpenSaved }: { view: RunView; experience: ExperienceView; onOpenSaved?: () => void }): ReactElement {
  return (
    <Section title={EXPERIENCE_HEADING} region="run-experience" state={experienceState(experience)}>
      <div className="hima-block">
        <div className="hima-muted">{experienceWrittenSaid(experience)}</div>
        <div className="hima-muted hima-mono">{experienceFileSaid('markdown', experience.markdown)}</div>
        <div className="hima-muted hima-mono">{experienceFileSaid('json', experience.json)}</div>
        <div><a href={experienceMarkdownHref(view.run.id)} onClick={onOpenSaved === undefined ? undefined : (event) => { event.preventDefault(); onOpenSaved(); }}>{EXPERIENCE_MARKDOWN_LINK}</a></div>
      </div>
      <div className="hima-run-card-section">
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
export function ReportBlockRow({ block: entry }: { block: ReportBlock }): ReactElement {
  if (entry.kind === 'heading') {
    // The report's own levels, stepped down under the section's heading: its title is the largest
    // thing in the section and never larger than the section itself.
    const level = entry.level <= 1 ? 1 : entry.level === 2 ? 2 : 3;
    return <div className="hima-run-card-report-heading" data-level={level}>{entry.text}</div>;
  }
  if (entry.kind === 'paragraph') return <div className="hima-run-card-report-paragraph">{entry.text}</div>;
  if (entry.kind === 'code') {
    return <pre className="hima-run-card-report-code">{entry.text}</pre>;
  }
  return (
    <div className="hima-run-card-ledger">
      <table>
        <thead>
          <tr>
            {entry.head.map((head) => <th key={head}>{head}</th>)}
          </tr>
        </thead>
        <tbody>
          {entry.rows.map((cells, row) => (
            <tr key={row}>
              {cells.map((value, column) => <td key={column} className="hima-run-card-cell">{value}</td>)}
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
    <div className="hima-block">
      <div className="hima-run-card-error">HimaHarness could not read this run</div>
      <div className="hima-mono">{error.code}</div>
      <div className="hima-muted">{error.message}</div>
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
              <div key={c.recordId} className="hima-block">
                <div className="hima-muted">{cancelAsked(c)}</div>
                <div className="hima-muted">{cancelObserved(view, c).said}</div>
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
          <Section title="refused" region="run-refusal" state={{ count: String(view.refusals.length) }}>
            {view.refusals.map((r) => (
              <div key={r.recordId} className="hima-block">
                <div className="hima-state-word" data-state="waiting">refused</div>
                <div className="hima-mono">{r.path}</div>
                <div className="hima-muted">{r.reason}</div>
              </div>
            ))}
          </Section>
        )}
      {/*
        The workshop of the node the Run stands at, where that node is one (#62). Before the reading,
        exactly as the Workbench mount orders it: a person watching a workshop is watching something
        being written now, and what was read is what the generation before it produced.
      */}
      {view.workshop === undefined ? null : <WorkshopSection view={view} workshop={view.workshop} />}
      <MaterialSection view={view} />
      <ArchiveSection view={view} />
      <GrowthSection view={view} />
      <RevisionSection view={view} />
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
      {view.experience === undefined
        ? (view.experienceUnavailable === undefined ? null : <Section title={EXPERIENCE_HEADING} region="run-experience" state={{ source: 'not-written' }}><div>{view.experienceUnavailable}</div></Section>)
        : <ExperienceSection view={view} experience={view.experience} />}
    </>
  );
}

/**
 * Render one Hima tool call: the compact receipt a transcript reads at a glance — the tool, where
 * the Run stands and its current node, and one sentence of notice or refusal — with the whole of
 * `RunBody` (every region the contract suite and the Diagnostics sheet read) kept reachable under
 * `receipt-details`, open by default so nothing that used to be on the card stops being on the page.
 *
 * @param props - the keyed toolview payload; only the frozen call/result block is read. `toolName`
 *                is the slot's own registration key (`hima_run`, `hima_observe`, …), passed by
 *                `client/index.ts` since the tool block itself carries no name of its own.
 * @returns the Hima run card.
 */
export function HimaRunCard({ block: toolBlock, openRun, sessionId, toolName }: { block: ToolBlock; openRun?: (runId: string) => void; sessionId?: string; toolName?: string }): ReactElement {
  const runId = runIdOf(toolBlock);
  const [state, setState] = useState<{ view?: RunView; error?: HimaFailure }>({});
  const acting = useRunActions(runId, (view) => setState({ view }), sessionId, state.view);

  useEffect(() => {
    if (runId === undefined) return;
    const controller = new AbortController();
    setState({});
    void fetchRun(runId, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setState(result.ok ? { view: result.value } : { error: result.error });
    });
    return () => { controller.abort(); };
  }, [runId]);

  if (runId === undefined) {
    // A failed call has something to say, and it is the tool's own words: saying "this call reported
    // no run" over the top of an error would hide the only explanation there is.
    if (toolBlock.kind !== undefined && toolBlock.isError === true) {
      const said = toolText(toolBlock);
      return (
        <div className="hima-run-card">
          <div className="hima-run-card-error">this HimaHarness call failed</div>
          <div className="hima-muted hima-mono">{said === '' ? 'the tool reported an error with no text' : said}</div>
        </div>
      );
    }
    return <div className="hima-run-card hima-muted">{toolBlock.kind === undefined ? 'working…' : 'this call reported no run'}</div>;
  }
  const status = state.view?.run.status;
  const statusWord = status === undefined ? NO_FABRIC_STATE : labelled(runStatusLabel, status).said;
  const notice = acting.refusal?.message ?? acting.notice ?? 'Nothing further to report for this run.';
  return (
    <div className="hima-run-card" title={runId}>
      {state.error !== undefined ? <FailureRow error={state.error} /> : null}
      {state.view === undefined ? (state.error === undefined ? <div className="hima-muted">reading the run…</div> : null) : (
        <>
          <div className="hima-run-card-receipt" data-hima-region="run-receipt">
            <div className="hima-run-card-receipt-line">
              <span className="hima-mono">{toolName ?? 'hima'}</span>
              <span className="hima-muted">·</span>
              <span className="hima-state-word" data-state={status ?? ''}>{statusWord}</span>
              {state.view.run.currentNode === undefined ? null : <><span className="hima-muted">·</span><span className="hima-mono">{state.view.run.currentNode}</span></>}
            </div>
            <div className="hima-run-card-receipt-notice">{notice}</div>
            {openRun === undefined ? null : (
              <button type="button" className="hima-button" data-hima-control="open-run" onClick={() => { openRun(runId); }}>
                Open Campaign <Glyph name="arrow-right" size={12} />
              </button>
            )}
          </div>
          <details data-hima-control="receipt-details" open>
            <summary>Run detail</summary>
            <RunBody view={state.view} acting={acting} />
          </details>
        </>
      )}
    </div>
  );
}
