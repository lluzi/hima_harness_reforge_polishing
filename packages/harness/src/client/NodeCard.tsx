// The node card (#41 task 6): anchored to its own node inside the canvas, kind-specific tabs, the
// owner/non-owner footer, and the compact tool receipt's sibling for what a person reads about one
// node rather than the whole Run.
//
// Mounted as a plain HTML overlay — a sibling of the canvas's own `<svg>`, not a `<foreignObject>`
// inside it — so the card's own wheel scroll, text selection and pointer events are the card's own
// DOM events and never reach the canvas's wheel-zoom or pointer-drag-pan listeners (those live on
// the `<svg>` itself; a sibling's events never bubble through it), and so the card's own type never
// scales with the canvas's own zoom. Its position is two numbers (`cardPosition`) applied to the host
// element's own `left`/`top` through the DOM style property in an effect — never a JSX inline style
// prop, which the client style contract test bans — because a canvas-anchored overlay's position is
// a per-render layout computation no static class can state.
//
// Every fact this cannot find is a sentence (`absentSaid`), never an empty tab or raw JSON: a node
// card a person opens on a node the Run has not reached yet still reads as prose, not as a blank.
import { useEffect, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import type { PlacedNode } from '../canvas-layout.js';
import type { ExecutionContext } from '../fabric.js';
import type { PackNode } from '../packs.js';
import { cardPosition, NODE_CARD_HEIGHT, NODE_CARD_WIDTH, TABS_BY_KIND, type NodeCardTabKey } from '../node-card-layout.js';
import type { ObservationView, RunView } from '../remote.js';
import { absentSaid, counted, jobFolded, loopsIn, strategySaid } from '../card-labels.js';
import { fetchLogTail } from './api.js';
import { BlockerRow, CancelRow, DecisionRow, GenerationsTable, ObservationRow, VerdictRow, type Acting } from './HimaRunCard.js';
import { Glyph } from './glyphs.js';

export interface NodeCardProps {
  readonly node: PlacedNode;
  readonly view: RunView;
  readonly context?: ExecutionContext;
  readonly runId: string;
  readonly sessionId: string;
  /** Whether this session owns the Run's business controls (ADR-0008: one visible Campaign Agent
   *  owns the Run at a time). A Side Talk sees who does and only an emergency Pause/Stop. */
  readonly owner: boolean;
  /** The node's own screen position, already through the canvas's pan/zoom transform. */
  readonly anchor: { readonly x: number; readonly y: number };
  /** The canvas's own viewport, for clamping the card fully inside it. */
  readonly canvas: { readonly width: number; readonly height: number };
  onClose(): void;
  openFiles(): void;
  readonly acting: Acting;
}

const TAB_LABEL: Readonly<Record<NodeCardTabKey, string>> = {
  facts: 'Facts', job: 'Job', code: 'Code', knowledge: 'Knowledge', evidence: 'Evidence',
  rules: 'Rules', verdicts: 'Verdicts', decision: 'Decision', strategy: 'Strategy',
  generations: 'Generations', blocker: 'Blocker', clearance: 'Clearance',
};

/** The node's own declared parameters, read off the Pack's reference graph the execution context
 *  carries — the one place a node's `observes`/`rules`/`opens` word lives; absent before a Run has
 *  read a method at all. */
function packNodeOf(context: ExecutionContext | undefined, nodeId: string): PackNode | undefined {
  return context?.nodes.find((candidate) => candidate.id === nodeId);
}

/**
 * The latest observation an act node's own declared output produced, and the type name it was
 * correlated by. `ObservationView` carries no node id of its own — the one correlation there is is
 * the semantic value type its reader wrote, which is the same name the node's `observes` parameter
 * names — so this is never a run-wide list, only ever the one, latest reading of that type.
 * `type` is undefined for a node this cannot correlate at all (a tool node, or a Run whose method
 * this view cannot read), which the Facts tab reads as "no correlation", not as "nothing observed".
 */
function latestObservationOf(node: PlacedNode, view: RunView, context: ExecutionContext | undefined): { readonly type?: string; readonly observation?: ObservationView } {
  const packNode = packNodeOf(context, node.id);
  if (packNode?.kind !== 'act' || packNode.parameters.observes === undefined) return {};
  const type = packNode.parameters.observes;
  return { type, observation: view.observations.findLast((observation) => observation.values.some((value) => value.type === type)) };
}

function FactsTab({ node, view, context }: { node: PlacedNode; view: RunView; context?: ExecutionContext }): ReactElement {
  const inputs = context?.method?.contract.inputs ?? [];
  const bindings = view.workspace?.bindings;
  const { type, observation } = latestObservationOf(node, view, context);
  return (
    <>
      <h5>Declared inputs</h5>
      {inputs.length === 0 ? <p className="hima-muted">{absentSaid('declared input')}</p> : (
        <ul>{inputs.map((input) => (
          <li key={input.name}>
            <span className="hima-mono">{input.name}</span>: <span className="hima-mono">{bindings?.[input.name] ?? 'unbound'}</span>
            {input.description === '' ? null : <span className="hima-muted"> — {input.description}</span>}
          </li>
        ))}</ul>
      )}
      <h5>{type === undefined ? 'Observation' : `Latest reading of ${type}`}</h5>
      {observation === undefined ? <p className="hima-muted">{absentSaid('observation')}</p> : <ObservationRow observation={observation} />}
    </>
  );
}

/** The running node's own last 40 lines, polled every 2 s while it stays the running node — the same
 *  bounded tail `FabricNode`'s own single-line poll reads, on the dark glass surface raw output gets. */
function useNodeLog(runId: string, nodeId: string, active: boolean): { readonly lines: readonly string[]; readonly truncated?: boolean } {
  const [state, setState] = useState<{ lines: readonly string[]; truncated?: boolean }>({ lines: [] });
  useEffect(() => {
    if (!active) { setState({ lines: [] }); return; }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      const result = await fetchLogTail(runId, nodeId, 40, controller.signal);
      if (controller.signal.aborted) return;
      if (result.ok) setState({ lines: result.value.lines, truncated: result.value.truncated });
      timer = setTimeout(() => { void poll(); }, 2000);
    };
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [runId, nodeId, active]);
  return state;
}

function JobTab({ node, view, runId }: { node: PlacedNode; view: RunView; runId: string }): ReactElement {
  const folded = jobFolded(view, node.id);
  const running = node.current && node.state === 'running';
  const log = useNodeLog(runId, node.id, running);
  const executions = Object.values(view.run.control?.executions ?? {}).filter((execution) => execution.nodeId === node.id);
  return (
    <>
      {folded.launched === undefined ? <p className="hima-muted">{absentSaid('job launch')}</p> : (
        <p className="hima-muted">
          launched {folded.launched}
          {folded.finished === undefined ? '' : ` · finished ${folded.finished}`}
          {folded.exit === undefined ? '' : ` · exit ${folded.exit}`}
        </p>
      )}
      {folded.licences === undefined ? null : (
        <p className="hima-muted">{Object.entries(folded.licences).map(([name, seats]) => `${name} ${counted(seats, 'seat')}`).join(', ')}</p>
      )}
      {executions.map((execution) => (
        <div key={execution.id} data-hima-region="node-execution" data-hima-state-execution={execution.id} data-hima-state-phase={execution.phase} className="hima-muted">
          {execution.nodeId} · {execution.phase} · generation {execution.generation} · attempt {execution.attempt}<br /><span className="hima-mono">{execution.id}</span>
        </div>
      ))}
      {!running ? null : (
        <div className="hima-activity">
          <header><span>live log</span><span>{node.id}</span></header>
          <pre>{log.lines.length === 0 ? 'Waiting for output…' : log.lines.join('\n')}</pre>
          {log.truncated !== true ? null : <footer><span>truncated to the bounded tail the Host caps</span></footer>}
        </div>
      )}
    </>
  );
}

function CodeTab({ node, view, openFiles }: { node: PlacedNode; view: RunView; openFiles(): void }): ReactElement {
  const files = view.code.filter((code) => code.nodeId === node.id);
  if (files.length === 0) return <p className="hima-muted">{absentSaid('code')}</p>;
  return <>{files.map((code) => (
    <button key={code.recordId} type="button" className="hima-material-row" data-hima-control={`open-code-${code.recordId}`} onClick={openFiles}>
      <span className="hima-mono">{code.path.split(/[\\/]/).at(-1)}</span>
      <span className="hima-muted">{code.sha256.slice(0, 12)} · {counted(code.bytes, 'byte')} · {code.language}</span>
    </button>
  ))}</>;
}

function KnowledgeTab({ node, view }: { node: PlacedNode; view: RunView }): ReactElement {
  const files = view.knowledge.filter((entry) => entry.nodeId === node.id);
  if (files.length === 0) return <p className="hima-muted">{absentSaid('knowledge')}</p>;
  return <>{files.map((entry) => (
    <div key={entry.recordId} className="hima-block">
      <div className="hima-mono">{entry.file}</div>
      <div className="hima-muted">{entry.purpose}</div>
    </div>
  ))}</>;
}

function EvidenceTab({ node, view, context }: { node: PlacedNode; view: RunView; context?: ExecutionContext }): ReactElement {
  const { observation } = latestObservationOf(node, view, context);
  const packNode = packNodeOf(context, node.id);
  const ruleIds = packNode?.kind === 'judge' ? packNode.parameters.rules : [];
  const verdicts = view.verdicts.filter((verdict) => ruleIds.includes(verdict.ruleId) || verdict.cites.some((cite) => cite.recordId === observation?.recordId));
  if (verdicts.length === 0) return <p className="hima-muted">{absentSaid('verdict')}</p>;
  return <>{verdicts.map((verdict) => <VerdictRow key={verdict.recordId} verdict={verdict} />)}</>;
}

function RulesTab({ node, context }: { node: PlacedNode; context?: ExecutionContext }): ReactElement {
  const packNode = packNodeOf(context, node.id);
  const rules = packNode?.kind === 'judge' ? packNode.parameters.rules : [];
  if (rules.length === 0) return <p className="hima-muted">{absentSaid('rule')}</p>;
  return <ol>{rules.map((rule) => <li key={rule} className="hima-mono">{rule}</li>)}</ol>;
}

function VerdictsTab({ node, view, context }: { node: PlacedNode; view: RunView; context?: ExecutionContext }): ReactElement {
  const packNode = packNodeOf(context, node.id);
  const ruleIds = packNode?.kind === 'judge' ? packNode.parameters.rules : [];
  const verdicts = view.verdicts.filter((verdict) => ruleIds.includes(verdict.ruleId));
  if (verdicts.length === 0) return <p className="hima-muted">{absentSaid('verdict')}</p>;
  return <>{verdicts.map((verdict) => <VerdictRow key={verdict.recordId} verdict={verdict} />)}</>;
}

function DecisionTab({ node, view }: { node: PlacedNode; view: RunView }): ReactElement {
  const decision = view.decision;
  if (decision === null || decision === undefined || decision.nodeId !== node.id) return <p className="hima-muted">{absentSaid('decision')}</p>;
  return <DecisionRow decision={decision} view={view} />;
}

function StrategyTab({ view }: { view: RunView }): ReactElement {
  const strategy = view.run.strategy;
  if (strategy === undefined) return <p className="hima-muted">{absentSaid('strategy')}</p>;
  return <p className="hima-mono">{strategySaid(strategy, view.run.words?.strategy)}</p>;
}

/**
 * The Generations tab: a drill-down explore node (its own `opens:`) shows the rows of the Loop(s)
 * opened at this node — never the outer graph's — and a top-level chooser explore shows the
 * top-level rows, since neither is "every generation the Campaign has ever opened" (#41 task 6
 * review). `markRegions={false}`: a subset's own loop/branch counts are not the whole-run fact the
 * `run-loops`/`run-branches` regions promise a driver, so this table attaches neither.
 */
function GenerationsTab({ node, view, context }: { node: PlacedNode; view: RunView; context?: ExecutionContext }): ReactElement {
  const packNode = packNodeOf(context, node.id);
  const opensLoop = packNode?.kind === 'explore' && packNode.parameters.opens !== undefined;
  const rows = opensLoop ? loopsIn(view).filter((loop) => loop.nodeId === node.id).flatMap((loop) => loop.generations) : view.generations;
  if (rows.length === 0) return <p className="hima-muted">{absentSaid('generation')}</p>;
  return <div className="hima-run-card-ledger"><GenerationsTable view={view} rows={rows} markRegions={false} /></div>;
}

function BlockerTab({ node, view }: { node: PlacedNode; view: RunView }): ReactElement {
  const blocker = view.blockers.filter((candidate) => candidate.nodeId === node.id).at(-1);
  if (blocker === undefined) return <p className="hima-muted">{absentSaid('blocker')}</p>;
  return <BlockerRow blocker={blocker} latest />;
}

/**
 * Who cleared this node's blocker, and — separately, never folded into the same sentence — any
 * request to cancel the Run while it stood here. A cancel is a request to stop; a resume is a person
 * carrying a stopped Run on; the two are different facts and this tab keeps them two, exactly as
 * `RunView` keeps `cancels` and `resumes` two lists (#41 task 6 review).
 */
function ClearanceTab({ node, view }: { node: PlacedNode; view: RunView }): ReactElement {
  const resume = view.resumes.filter((candidate) => candidate.nodeId === node.id).at(-1);
  const cancels = view.cancels.filter((cancel) => cancel.nodeId === node.id);
  return (
    <>
      <h5>Clearance</h5>
      {resume === undefined ? <p className="hima-muted">{absentSaid('clearance')}</p> : <p>Cleared by <span className="hima-mono">{resume.who}</span> at {resume.at}</p>}
      {cancels.length === 0 ? null : (
        <>
          <h5>Cancel requests</h5>
          {cancels.map((cancel) => <CancelRow key={cancel.recordId} view={view} cancel={cancel} />)}
        </>
      )}
    </>
  );
}

function TabContent({ tab, node, view, context, runId, openFiles }: { tab: NodeCardTabKey; node: PlacedNode; view: RunView; context?: ExecutionContext; runId: string; openFiles(): void }): ReactElement {
  switch (tab) {
    case 'facts': return <FactsTab node={node} view={view} context={context} />;
    case 'job': return <JobTab node={node} view={view} runId={runId} />;
    case 'code': return <CodeTab node={node} view={view} openFiles={openFiles} />;
    case 'knowledge': return <KnowledgeTab node={node} view={view} />;
    case 'evidence': return <EvidenceTab node={node} view={view} context={context} />;
    case 'rules': return <RulesTab node={node} context={context} />;
    case 'verdicts': return <VerdictsTab node={node} view={view} context={context} />;
    case 'decision': return <DecisionTab node={node} view={view} />;
    case 'strategy': return <StrategyTab view={view} />;
    case 'generations': return <GenerationsTab node={node} view={view} context={context} />;
    case 'blocker': return <BlockerTab node={node} view={view} />;
    case 'clearance': return <ClearanceTab node={node} view={view} />;
    default: { const exhaustive: never = tab; void exhaustive; return <></>; }
  }
}

type ConfirmKey = 'node-pause' | 'node-continue' | 'run-pause' | 'run-stop';

/**
 * The footer: node-scoped Pause/Continue for the owner, each behind its own inline confirm naming
 * the consequence; for a Side Talk, who owns the Run and — under a disclosed "Emergency" — the two
 * human-origin controls ADR-0008 still allows: Pause and Stop, never Continue.
 *
 * Both branches act through the one `acting` prop the caller already built with `useRunActions`
 * (`CampaignTab`'s own, keyed to this viewer's session) — there is no second action state here. That
 * object already fences 'pause'/'cancel' through `controlRun`/`actOnRun` however this Run is owned,
 * which is exactly the emergency route: `RunControls` already lets any session with an id cancel or
 * pause a Run it does not own, and this footer is a node-scoped reflection of that same control.
 */
function Footer({ node, view, owner, acting }: { node: PlacedNode; view: RunView; owner: boolean; acting: Acting }): ReactElement {
  const [confirming, setConfirming] = useState<ConfirmKey>();
  const toggle = (key: ConfirmKey) => setConfirming((current) => (current === key ? undefined : key));
  const active = view.run.status === 'running' || view.run.status === 'waiting';

  const confirmBlock = (key: ConfirmKey, sentence: string, confirmLabel: string, onConfirm: () => void): ReactNode => (
    confirming !== key ? null : (
      <div className="hima-node-card-confirm" data-hima-region={`${key}-confirm`}>
        <p>{sentence}</p>
        <div className="hima-node-card-footer-row">
          <button type="button" className="hima-button hima-primary" data-hima-control={`${key}-confirm`} disabled={acting.inFlight !== undefined} onClick={() => { onConfirm(); setConfirming(undefined); }}>{confirmLabel}</button>
          <button type="button" className="hima-button" onClick={() => setConfirming(undefined)}>Cancel</button>
        </div>
      </div>
    )
  );

  if (owner) {
    return (
      <footer className="hima-node-card-footer" data-hima-region="node-card-footer">
        {!active ? null : (
          <div className="hima-node-card-footer-row">
            <button type="button" className="hima-button" data-hima-control="node-pause" disabled={acting.inFlight !== undefined} onClick={() => toggle('node-pause')}>Pause this node</button>
            <button type="button" className="hima-button" data-hima-control="node-continue" disabled={acting.inFlight !== undefined} onClick={() => toggle('node-continue')}>Continue this node</button>
          </div>
        )}
        {confirmBlock('node-pause', `Jobs already running will continue; no new work starts at ${node.id}.`, 'Confirm pause', () => { acting.act('pause', node.id); })}
        {confirmBlock('node-continue', `New work starts again at ${node.id}.`, 'Confirm continue', () => { acting.act('continue', node.id); })}
        {acting.notice === undefined ? null : <p role="status">{acting.notice}</p>}
        {acting.refusal === undefined ? null : <p role="alert" data-hima-region="run-error">{acting.refusal.message}</p>}
      </footer>
    );
  }
  return (
    <footer className="hima-node-card-footer" data-hima-region="node-card-footer">
      <p className="hima-node-card-owner">Owned by Campaign Agent{view.run.control?.owner === undefined ? '' : ` ${view.run.control.owner.slice(-6)}`}</p>
      <details className="hima-node-card-emergency" data-hima-region="emergency">
        <summary>Emergency</summary>
        {!active ? null : (
          <div className="hima-node-card-footer-row">
            <button type="button" className="hima-button" data-hima-control="run-pause" disabled={acting.inFlight !== undefined} onClick={() => toggle('run-pause')}>Pause run</button>
            <button type="button" className="hima-button" data-hima-control="run-stop" disabled={acting.inFlight !== undefined} onClick={() => toggle('run-stop')}>Stop run</button>
          </div>
        )}
        {confirmBlock('run-pause', 'Jobs already running will continue; no new work starts anywhere in this run.', 'Confirm pause', () => { acting.act('pause'); })}
        {confirmBlock('run-stop', 'This asks every Job this run holds to stop; work already running may take a moment to end.', 'Confirm stop', () => { acting.act('cancel'); })}
        {acting.notice === undefined ? null : <p role="status">{acting.notice}</p>}
        {acting.refusal === undefined ? null : <p role="alert" data-hima-region="run-error">{acting.refusal.message}</p>}
      </details>
    </footer>
  );
}

export function NodeCard({ node, view, context, runId, owner, anchor, canvas, onClose, openFiles, acting }: NodeCardProps): ReactElement {
  const tabs = TABS_BY_KIND[node.kind];
  const [tab, setTab] = useState<NodeCardTabKey>(tabs[0]!);
  useEffect(() => { setTab(TABS_BY_KIND[node.kind][0]!); }, [node.id, node.kind]);

  // Escape closes the card. `stopPropagation` while it is open, so an outer Escape handler (a
  // dialog, a future sheet) does not also react to the same key press this card already handled.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Position is two numbers applied to the DOM element directly, in a layout effect — see the file
  // header for why this is not a JSX inline style prop. `useLayoutEffect` so the card never paints one
  // frame at its stale position when the anchor moves (a follow, a zoom).
  const hostRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = hostRef.current; if (el === null) return;
    const { x, y } = cardPosition(anchor, canvas);
    el.style.setProperty('left', `${String(x)}px`);
    el.style.setProperty('top', `${String(y)}px`);
  }, [anchor.x, anchor.y, canvas.width, canvas.height]);

  const nodeView = view.nodes.find((candidate) => candidate.nodeId === node.id);

  return (
    <div ref={hostRef} className="hima-node-card" data-hima-region="campaign-node-card" data-hima-state-node={node.id} data-hima-state-tab={tab}>
      <header className="hima-node-card-header">
        <div>
          <h4>{node.id}</h4>
          <p className="hima-muted">{node.kind}{nodeView === undefined ? '' : <> · <span className="hima-state-word" data-state={nodeView.state}>{nodeView.state}</span></>}</p>
        </div>
        <button type="button" className="hima-icon-button" data-hima-control="node-card-close" aria-label="Close node" onClick={onClose}><Glyph name="close" /></button>
      </header>
      <nav className="hima-node-card-tabs" aria-label={`${node.id} tabs`}>
        {tabs.map((key) => (
          <button key={key} type="button" aria-pressed={tab === key} data-hima-control={`node-card-tab-${key}`} onClick={() => setTab(key)}>{TAB_LABEL[key]}</button>
        ))}
      </nav>
      <div className="hima-node-card-content">
        <TabContent tab={tab} node={node} view={view} context={context} runId={runId} openFiles={openFiles} />
      </div>
      <Footer node={node} view={view} owner={owner} acting={acting} />
    </div>
  );
}

export { NODE_CARD_WIDTH, NODE_CARD_HEIGHT, cardPosition, TABS_BY_KIND } from '../node-card-layout.js';
