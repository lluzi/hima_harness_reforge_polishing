// The node card (#41 task 6): anchored to its own node inside the canvas, kind-specific tabs, the
// owner/non-owner footer, and the compact tool receipt's sibling for what a person reads about one
// node rather than the whole Run. Mounted as an SVG `<foreignObject>` at the node's own screen
// position — computed once per render from the canvas's own transform and clamped inside the
// viewport — so its position is a plain numeric attribute and never an inline style.
//
// Every fact this cannot find is a sentence (`absentSaid`), never an empty tab or raw JSON: a node
// card a person opens on a node the Run has not reached yet still reads as prose, not as a blank.
import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import type { NodeKind, PlacedNode } from '../canvas-layout.js';
import type { ExecutionContext } from '../fabric.js';
import type { PackNode } from '../packs.js';
import type { CancelView, ObservationView, RunView, VerdictView } from '../remote.js';
import {
  absentSaid, cancelAsked, cancelObserved, chosenSaid, citedSaid, counted, decisionState, groupSaid, jobFolded, nameOf, strategySaid,
} from '../card-labels.js';
import { actOnRun, controlRun, fetchLogTail } from './api.js';
import { GenerationsTable, type Acting } from './HimaRunCard.js';
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

const CARD_WIDTH = 384;
const CARD_HEIGHT = 320;
const GAP = 28;
const MARGIN = 8;

/** Where the card sits: to the right of its node, or to the left when the right would clip past the
 *  canvas's own edge, then clamped fully inside the viewport on both axes. */
function cardPosition(anchor: { readonly x: number; readonly y: number }, canvas: { readonly width: number; readonly height: number }): { readonly x: number; readonly y: number } {
  const rightX = anchor.x + GAP;
  const leftX = anchor.x - GAP - CARD_WIDTH;
  const fitsRight = rightX + CARD_WIDTH <= canvas.width - MARGIN;
  const maxX = Math.max(MARGIN, canvas.width - CARD_WIDTH - MARGIN);
  const maxY = Math.max(MARGIN, canvas.height - CARD_HEIGHT - MARGIN);
  return {
    x: Math.min(Math.max(fitsRight ? rightX : leftX, MARGIN), maxX),
    y: Math.min(Math.max(anchor.y - CARD_HEIGHT / 2, MARGIN), maxY),
  };
}

type TabKey = 'facts' | 'job' | 'code' | 'knowledge' | 'evidence' | 'rules' | 'verdicts' | 'decision' | 'strategy' | 'generations' | 'blocker' | 'clearance';

/** The tab set for each node kind, in the order the card shows them; the first is the default. */
const TABS_BY_KIND: Readonly<Record<NodeKind, readonly TabKey[]>> = {
  act: ['facts', 'job', 'code', 'knowledge', 'evidence'],
  judge: ['rules', 'verdicts', 'evidence'],
  explore: ['decision', 'strategy', 'generations'],
  wait: ['blocker', 'clearance'],
};

const TAB_LABEL: Readonly<Record<TabKey, string>> = {
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
 * The observations an act node's own declared output produced. An observation record carries no
 * node id of its own (`ObservationView`); the one correlation there is is the semantic value type
 * its reader wrote, which is the same name the node's `observes` parameter names. Empty for a node
 * this cannot correlate — a tool node, or a Run whose method this view cannot read.
 */
function observationsOf(node: PlacedNode, view: RunView, context: ExecutionContext | undefined): readonly ObservationView[] {
  const packNode = packNodeOf(context, node.id);
  if (packNode?.kind !== 'act' || packNode.parameters.observes === undefined) return [];
  const observes = packNode.parameters.observes;
  return view.observations.filter((observation) => observation.values.some((value) => value.type === observes));
}

/** One typed value, exactly as the run card's own `ValueRows` reads it — kept local rather than
 *  exported, since the two mounts read different node facts around it. */
function ValueLine({ observation }: { observation: ObservationView }): ReactElement {
  return (
    <div className="hima-fact-block">
      <div className="hima-mono">{observation.path}</div>
      {observation.values.map((value) => (
        <div key={nameOf(value)} className="hima-mono">
          {nameOf(value)}:{' '}
          {value.value === null ? <span className="hima-muted">unknown — {value.unknownReason}</span> : <span>{value.value} {value.unit}</span>}
          {value.group === undefined ? null : <span className="hima-muted">{groupSaid(value)}</span>}
        </div>
      ))}
    </div>
  );
}

function FactsTab({ node, view, context }: { node: PlacedNode; view: RunView; context?: ExecutionContext }): ReactElement {
  const inputs = context?.method?.contract.inputs ?? [];
  const observations = observationsOf(node, view, context);
  return (
    <>
      <h5>Declared inputs</h5>
      {inputs.length === 0 ? <p className="hima-muted">{absentSaid('declared input')}</p> : (
        <ul>{inputs.map((input) => (
          <li key={input.name}><span className="hima-mono">{input.name}</span>{input.description === '' ? null : <span className="hima-muted"> — {input.description}</span>}</li>
        ))}</ul>
      )}
      <h5>Latest observation</h5>
      {observations.length === 0 ? <p className="hima-muted">{absentSaid('observation')}</p> : observations.map((observation) => <ValueLine key={observation.recordId} observation={observation} />)}
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
    <div key={entry.recordId} className="hima-fact-block">
      <div className="hima-mono">{entry.file}</div>
      <div className="hima-muted">{entry.purpose}</div>
    </div>
  ))}</>;
}

function VerdictLine({ verdict, view }: { verdict: VerdictView; view: RunView }): ReactElement {
  return (
    <div className="hima-fact-block">
      <div><span className="hima-outcome-word" data-outcome={verdict.outcome}>{verdict.outcome}</span> <span className="hima-mono">{verdict.ruleId}@{verdict.ruleVersion}</span></div>
      {verdict.cites.length === 0 ? <div className="hima-muted">cites nothing</div> : verdict.cites.map((cite) => <div key={cite.recordId} className="hima-muted">cites {citedSaid(view, cite.recordId)}</div>)}
    </div>
  );
}

function EvidenceTab({ node, view, context }: { node: PlacedNode; view: RunView; context?: ExecutionContext }): ReactElement {
  const observations = observationsOf(node, view, context);
  const packNode = packNodeOf(context, node.id);
  const ruleIds = packNode?.kind === 'judge' ? packNode.parameters.rules : [];
  const ids = new Set(observations.map((observation) => observation.recordId));
  const verdicts = view.verdicts.filter((verdict) => ruleIds.includes(verdict.ruleId) || verdict.cites.some((cite) => ids.has(cite.recordId)));
  if (verdicts.length === 0) return <p className="hima-muted">{absentSaid('verdict')}</p>;
  return <>{verdicts.map((verdict) => <VerdictLine key={verdict.recordId} verdict={verdict} view={view} />)}</>;
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
  return <>{verdicts.map((verdict) => <VerdictLine key={verdict.recordId} verdict={verdict} view={view} />)}</>;
}

function DecisionTab({ node, view }: { node: PlacedNode; view: RunView }): ReactElement {
  const decision = view.decision;
  if (decision === null || decision === undefined || decision.nodeId !== node.id) return <p className="hima-muted">{absentSaid('decision')}</p>;
  const state = decisionState(decision);
  return (
    <div className="hima-fact-block">
      <div>
        <span className="hima-outcome-word" data-outcome={state.chosen}>{chosenSaid(decision, view.run.words)}</span>{' '}
        <span className="hima-muted">{decision.agent ? `by the conversational Agent at ${decision.nodeId}` : `by ${decision.chooser} at ${decision.nodeId}`}</span>
      </div>
      {decision.cites.map((recordId) => <div key={recordId} className="hima-muted">cites {citedSaid(view, recordId)}</div>)}
    </div>
  );
}

function StrategyTab({ view }: { view: RunView }): ReactElement {
  const strategy = view.run.strategy;
  if (strategy === undefined) return <p className="hima-muted">{absentSaid('strategy')}</p>;
  return <p className="hima-mono">{strategySaid(strategy, view.run.words?.strategy)}</p>;
}

function GenerationsTab({ view }: { view: RunView }): ReactElement {
  if (view.generations.length === 0) return <p className="hima-muted">{absentSaid('generation')}</p>;
  return <div className="hima-run-card-ledger"><GenerationsTable view={view} /></div>;
}

function BlockerTab({ node, view }: { node: PlacedNode; view: RunView }): ReactElement {
  const blocker = view.blockers.filter((candidate) => candidate.nodeId === node.id).at(-1);
  if (blocker === undefined) return <p className="hima-muted">{absentSaid('blocker')}</p>;
  return (
    <div className="hima-fact-block">
      <p>
        <span className="hima-state-word" data-state="blocked">blocked</span>{' '}
        after {counted(blocker.attempts, 'attempt')}{blocker.lastExitCode === undefined ? '' : `, last exit ${blocker.lastExitCode}`}
      </p>
      <p className="hima-muted">{blocker.reason}</p>
      {blocker.logTail === undefined ? null : <pre className="hima-node-card-tail" data-hima-region="run-blocker-tail">{blocker.logTail}</pre>}
    </div>
  );
}

/** A resumed fact: whichever cancel requests named this node, since a resumed blocker's own "who
 *  cleared it" is not yet on `RunView` — a known gap, noted in the task 6 report. */
function ClearanceTab({ node, view }: { node: PlacedNode; view: RunView }): ReactElement {
  const cancels: readonly CancelView[] = view.cancels.filter((cancel) => cancel.nodeId === node.id);
  if (cancels.length === 0) return <p className="hima-muted">{absentSaid('clearance')}</p>;
  return <>{cancels.map((cancel) => (
    <div key={cancel.recordId} className="hima-fact-block">
      <p className="hima-muted">{cancelAsked(cancel)}</p>
      <p className="hima-muted">{cancelObserved(view, cancel).said}</p>
    </div>
  ))}</>;
}

function TabContent({ tab, node, view, context, runId, openFiles }: { tab: TabKey; node: PlacedNode; view: RunView; context?: ExecutionContext; runId: string; openFiles(): void }): ReactElement {
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
    case 'generations': return <GenerationsTab view={view} />;
    case 'blocker': return <BlockerTab node={node} view={view} />;
    case 'clearance': return <ClearanceTab node={node} view={view} />;
    default: { const exhaustive: never = tab; void exhaustive; return <></>; }
  }
}

type ConfirmKey = 'node-pause' | 'node-continue' | 'run-pause' | 'run-stop';

/** The footer: node-scoped Pause/Continue for the owner, each behind its own inline confirm naming
 *  the consequence; for a Side Talk, who owns the Run and — under a disclosed "Emergency" — the two
 *  human-origin controls ADR-0008 still allows: Pause and Stop, never Continue. */
function Footer({ node, view, sessionId, owner, acting }: { node: PlacedNode; view: RunView; sessionId: string; owner: boolean; acting: Acting }): ReactElement {
  const [confirming, setConfirming] = useState<ConfirmKey>();
  const [emergency, setEmergency] = useState<{ pending?: boolean; notice?: string; error?: string }>({});
  const toggle = (key: ConfirmKey) => setConfirming((current) => (current === key ? undefined : key));

  const confirmBlock = (key: ConfirmKey, region: string, sentence: string, confirmLabel: string, onConfirm: () => void): ReactNode => (
    confirming !== key ? null : (
      <div className="hima-node-card-confirm" data-hima-region={region}>
        <p>{sentence}</p>
        <div className="hima-node-card-footer-row">
          <button type="button" className="hima-button hima-primary" data-hima-control={region} onClick={() => { onConfirm(); setConfirming(undefined); }}>{confirmLabel}</button>
          <button type="button" className="hima-button" onClick={() => setConfirming(undefined)}>Cancel</button>
        </div>
      </div>
    )
  );

  if (owner) {
    return (
      <footer className="hima-node-card-footer" data-hima-region="node-card-footer">
        <div className="hima-node-card-footer-row">
          <button type="button" className="hima-button" data-hima-control="node-pause" disabled={acting.inFlight !== undefined} onClick={() => toggle('node-pause')}>Pause this node</button>
          <button type="button" className="hima-button" data-hima-control="node-continue" disabled={acting.inFlight !== undefined} onClick={() => toggle('node-continue')}>Continue this node</button>
        </div>
        {confirmBlock('node-pause', 'node-pause-confirm', `Jobs already running will continue; no new work starts at ${node.id}.`, 'Confirm pause', () => { acting.act('pause', node.id); })}
        {confirmBlock('node-continue', 'node-continue-confirm', `New work starts again at ${node.id}.`, 'Confirm continue', () => { acting.act('continue', node.id); })}
        {acting.refusal === undefined ? null : <p role="alert" data-hima-region="run-error">{acting.refusal.message}</p>}
      </footer>
    );
  }

  const runEmergency = (action: 'pause' | 'stop') => {
    setEmergency({ pending: true });
    const request = action === 'pause' ? controlRun(view, sessionId, 'pause') : actOnRun(view.run.id, 'cancel');
    void request.then((result) => {
      setEmergency(result.ok ? { notice: 'notification' in result.value ? result.value.notification.message : 'The run was asked to stop.' } : { error: result.error.message });
    });
  };

  return (
    <footer className="hima-node-card-footer" data-hima-region="node-card-footer">
      <p className="hima-node-card-owner">Owned by Campaign Agent{view.run.control?.owner === undefined ? '' : ` ${view.run.control.owner.slice(-6)}`}</p>
      <details className="hima-node-card-emergency" data-hima-region="emergency">
        <summary>Emergency</summary>
        <div className="hima-node-card-footer-row">
          <button type="button" className="hima-button" data-hima-control="run-pause" disabled={emergency.pending === true} onClick={() => toggle('run-pause')}>Pause run</button>
          <button type="button" className="hima-button" data-hima-control="run-stop" disabled={emergency.pending === true} onClick={() => toggle('run-stop')}>Stop run</button>
        </div>
        {confirmBlock('run-pause', 'run-pause-confirm', 'Jobs already running will continue; no new work starts anywhere in this run.', 'Confirm pause', () => runEmergency('pause'))}
        {confirmBlock('run-stop', 'run-stop-confirm', 'This asks every Job this run holds to stop; work already running may take a moment to end.', 'Confirm stop', () => runEmergency('stop'))}
        {emergency.error === undefined ? null : <p role="alert">{emergency.error}</p>}
        {emergency.notice === undefined ? null : <p role="status">{emergency.notice}</p>}
      </details>
    </footer>
  );
}

export function NodeCard({ node, view, context, runId, sessionId, owner, anchor, canvas, onClose, openFiles, acting }: NodeCardProps): ReactElement {
  const tabs = TABS_BY_KIND[node.kind];
  const [tab, setTab] = useState<TabKey>(tabs[0]!);
  useEffect(() => { setTab(TABS_BY_KIND[node.kind][0]!); }, [node.id, node.kind]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const { x, y } = cardPosition(anchor, canvas);
  const nodeView = view.nodes.find((candidate) => candidate.nodeId === node.id);

  return (
    <foreignObject x={x} y={y} width={CARD_WIDTH} height={CARD_HEIGHT} className="hima-node-card-anchor">
      <div className="hima-node-card" data-hima-region="campaign-node-card" data-hima-state-node={node.id} data-hima-state-tab={tab}>
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
        <Footer node={node} view={view} sessionId={sessionId} owner={owner} acting={acting} />
      </div>
    </foreignObject>
  );
}
