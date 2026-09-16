// The existing Hima Run projection, presented inside the native dsh document dock.
// Local state is selection, drafts and the last HTTP response; the Agent requests work and Fabric validates its facts.
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import type { RunView } from '../remote.js';
import type { StartChoices } from '../workbench.js';
import type { ExecutionContext } from '../fabric.js';
import { bannerLines, cancelAsked, cancelObserved, duration, labelled, meterRows, nodeStateLabel, runPurposeMark, runStatusLabel, START_STATIC_LIMIT } from '../card-labels.js';
import { reportBlocks } from '../experience-report.js';
import { runPath } from '../paths.js';
import { fetchExecutionContext, fetchRun, fetchRuns, fetchStartChoices, reviewPackTransfer, startCampaign, type HimaResult } from './api.js';
import { ArchiveSection, DecisionRow, ExperienceSection, GenerationsTable, GrowthSection, MaterialSection, ObservationRow, ReportBlockRow, RevisionSection, RunControls, useRunActions, VerdictRow, WorkshopSection } from './HimaRunCard.js';
import { Glyph, type GlyphName } from './glyphs.js';

/** The public tab-info hook is supplied by the installed dsh sidebar slot. */
export interface WorkbenchProps {
  sessionId: string;
  useSessions<T>(selector: (state: { current?: string }) => T): T;
  openOwner(id: string): void;
  useTabInfo(): { tab: { visible: boolean; navigation: { revision: number; params: unknown } } };
  openFiles(): void;
}

/** Serial, abortable reads. Failed reads retain an explicitly stale snapshot of the same identity. */
function usePollingRead<T>(key: string, read: (signal: AbortSignal) => Promise<HimaResult<T>>, active: boolean) {
  const [snapshot, setSnapshot] = useState<{ key: string; value?: T; error?: string; at?: number }>({ key });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      const result = await read(controller.signal);
      if (controller.signal.aborted) return;
      setSnapshot((previous) => result.ok
        ? { key, value: result.value, at: Date.now() }
        : { ...(previous.key === key ? previous : { key }), error: result.error.message });
      timer = setTimeout(() => { void poll(); }, 2000);
    };
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [key, read, active, revision]);
  const current = snapshot.key === key ? snapshot : { key };
  return { ...current, refresh: useCallback(() => setRevision((n) => n + 1), []) };
}

const shortTime = (at: string | number): string => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const stateGlyphName = (state: string): GlyphName => {
  if (state === 'done' || state === 'ended-goal-met') return 'check';
  if (state === 'running') return 'dot';
  if (['waiting', 'ended-converged', 'retrying', 'waiting-for-slot'].includes(state)) return 'diamond';
  if (['blocked', 'cancelled', 'ended-goal-not-met', 'ended-budget-exhausted'].includes(state)) return 'square';
  if (state === 'available' || state === 'added') return 'ring';
  return 'circle';
};

export function HimaWorkbench({ sessionId, useSessions, useTabInfo, openFiles, openOwner }: WorkbenchProps): ReactElement {
  const activeSessionId = useSessions((state) => state.current) ?? sessionId;
  const { tab } = useTabInfo();
  const params = tab.navigation.params as { runId?: unknown } | undefined;
  const requested = typeof params?.runId === 'string' ? params.runId : undefined;
  const [selected, setSelected] = useState<string | undefined>(requested);
  const [creating, setCreating] = useState(false);
  const [managingPack, setManagingPack] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [starting, setStarting] = useState(false);
  const startPending = useRef(false);
  const startBusy = useCallback((busy: boolean) => { startPending.current = busy; setStarting(busy); }, []);
  const [section, setSection] = useState<'live' | 'experiments' | 'evidence' | 'report'>('live');
  const [saved, setSaved] = useState<{ markdown?: string; error?: string; loading?: boolean }>();
  const savedRead = useRef<AbortController | undefined>(undefined);
  const list = usePollingRead('runs', fetchRuns, tab.visible);
  const read = useCallback((signal: AbortSignal) => fetchRun(selected!, signal), [selected]);
  const snapshot = usePollingRead(selected ?? '', read, selected !== undefined && tab.visible && !creating);
  const readContext = useCallback((signal: AbortSignal) => fetchExecutionContext(selected!, signal), [selected]);
  const execution = usePollingRead(selected ?? '', readContext, selected !== undefined && tab.visible && !creating);
  const view = snapshot.value;
  const acting = useRunActions(selected, () => { snapshot.refresh(); list.refresh(); }, activeSessionId, view);

  useEffect(() => {
    if (requested !== undefined && !startPending.current) { setSelected(requested); setCreating(false); setSection('live'); }
  }, [requested, tab.navigation.revision]);
  useEffect(() => {
    setSaved(undefined);
    return () => { savedRead.current?.abort(); };
  }, [selected, activeSessionId]);
  const openSaved = async () => {
    if (selected === undefined) return;
    savedRead.current?.abort();
    const own = new AbortController(); savedRead.current = own;
    setSaved({ loading: true });
    try {
      const response = await fetch(`${runPath(selected)}/experience`, { signal: own.signal, headers: { accept: 'application/json' } });
      const body = await response.json() as { markdown?: string; error?: { message?: string } };
      if (!response.ok || typeof body.markdown !== 'string') throw new Error(body.error?.message ?? `Report read failed (HTTP ${response.status})`);
      if (!own.signal.aborted) setSaved({ markdown: body.markdown });
    } catch (error) { if (!own.signal.aborted) setSaved({ error: (error as Error).message }); }
  };

  return <div className='hima-studio hima-root' data-hima-region='studio' data-hima-state-session={activeSessionId} data-hima-state-run={selected ?? ''} data-stale={snapshot.error !== undefined}>
    <header className='hima-studio-header'>
      <div><h2>Campaign workspace</h2></div>
      <button className='hima-button' disabled={starting} onClick={openFiles} title='Open the native workspace files and code panel'>Files & code</button>
      <button className='hima-button' disabled={starting} data-hima-control='studio-pack-owner' onClick={() => setManagingPack(value => !value)}>Pack & assets</button>
      <button className='hima-button hima-primary' disabled={starting} data-hima-control='studio-new' onClick={() => { if (!startPending.current) setCreating(true); }}>New Campaign</button>
    </header>
    <div className='hima-run-picker'>
      <span className='hima-studio-eyebrow'>CAMPAIGN</span>
      <select aria-label='Campaign on this host' disabled={starting} data-hima-control='studio-run' value={selected ?? ''} onChange={(e) => { if (!startPending.current) { setSelected(e.target.value || undefined); setCreating(false); } }}>
        <option value=''>Select a Campaign</option>
        {selected && !list.value?.runs.some((run) => run.id === selected) ? <option value={selected}>{selected}</option> : null}
        {list.value?.runs.map((run) => <option key={run.id} value={run.id}>{run.packId ?? run.campaignId}{runPurposeMark(run.purpose) ? ` · ${runPurposeMark(run.purpose)}` : ''} · {shortTime(run.createdAt)} · {run.id.slice(-6)}</option>)}
      </select>
      <button className='hima-icon-button' aria-label='Refresh Run data' onClick={() => { list.refresh(); snapshot.refresh(); }}><Glyph name='retry' /></button>
    </div>
    {list.error ? <p className='hima-notice' role='status'>Run list unavailable: {list.error}</p> : null}
    {notice ? <p role='alert' className='hima-error'>{notice}</p> : null}
    {managingPack ? <PackOwnerPanel key={activeSessionId} sessionId={activeSessionId} initialPack={view?.run.packId ?? ''} /> : null}
    {view?.run.control && view.run.control.owner !== activeSessionId ? <button type='button' className='hima-button' data-hima-control='open-owner' onClick={() => openOwner(view.run.control!.owner)}>Open Campaign Agent</button> : null}
    {creating ? <StartRunForm key={activeSessionId} sessionId={activeSessionId} onBusy={startBusy} onClose={() => { if (!startPending.current) setCreating(false); }} onStarted={(run) => { setSelected(run.run.id); setCreating(false); setSection('live'); list.refresh(); snapshot.refresh(); setNotice(undefined); }} />
      : selected === undefined ? <div className='hima-empty'><div className='hima-empty-glyph'><Glyph name='ring' size={32} /></div><h3>Complete a chip-design Campaign.</h3><p>Keep coding and conversation available while HimaGuide prepares the inputs and the Campaign Agent executes the method.</p><button className='hima-button hima-primary' onClick={() => setCreating(true)}>Prepare a Campaign</button><p className='hima-small'>Choose an existing Campaign above, install a HimaPack, or connect a Site.</p></div>
        : <>
          {snapshot.error ? <div className='hima-notice' role='alert'>Updates unavailable. {snapshot.at ? `Showing the last successful read at ${shortTime(snapshot.at)}.` : 'No Run data has been read.'} {snapshot.error}</div> : null}
          {view === undefined ? <div className='hima-empty'><p>{snapshot.error ? 'Retry the data read to continue.' : 'Reading Run records…'}</p></div> : <>
            <nav className='hima-studio-tabs' aria-label='Research views'>
              {(['live', 'experiments', 'evidence', 'report'] as const).map((name) => <button key={name} aria-pressed={section === name} data-hima-control={`studio-${name}`} onClick={() => setSection(name)}>{({ live: 'Live Run', experiments: 'Experiments', evidence: 'Evidence', report: 'Report' })[name]}</button>)}
            </nav>
            <div className='hima-studio-content'>
              {section === 'live' ? <>
                <RunSummary view={view} />
                <div className='hima-run-controls'><RunControls view={view} acting={acting} /></div>
                <CampaignGraph view={view} context={execution.value} owner={view.run.control?.owner === activeSessionId} />
                <GrowthSection view={view} />
                <RevisionSection view={view} />
                <JobActivity view={view} />
                {view.workshop ? <WorkshopSection view={view} workshop={view.workshop} /> : null}
                <MaterialSection view={view} />
                <ArchiveSection view={view} />
              </> : section === 'experiments' ? <div className='hima-detail'><h3>Experiment history</h3><p className='hima-small'>Recorded generations, measurements and decisions.</p>{view.generations.length ? <GenerationsTable view={view} /> : <p>No generation has been recorded.</p>}</div>
                : section === 'evidence' ? <EvidenceTrail view={view} />
                  : <div className='hima-detail hima-report'><h3>Technical report</h3>{saved ? <><button className='hima-button' onClick={() => { savedRead.current?.abort(); setSaved(undefined); }}>← Current ledger preview</button><p className='hima-small'>{saved.markdown !== undefined ? 'Saved Markdown · original bytes verified by the Host' : saved.loading ? 'Reading and verifying the saved file…' : 'Saved file could not be verified'}</p>{saved.loading ? <p>Reading saved report…</p> : saved.error ? <p role='alert' className='hima-notice'>{saved.error}</p> : reportBlocks(saved.markdown!).map((block, index) => <ReportBlockRow key={index} block={block} />)}</> : view.experience ? <ExperienceSection view={view} experience={view.experience} onOpenSaved={() => { void openSaved(); }} /> : <p>{view.experienceUnavailable ?? 'A technical report will appear here when the Run closes.'}</p>}</div>}
            </div>
            {section === 'report' ? <ArchiveSection view={view} /> : null}
            <footer className='hima-studio-footer'><span>{snapshot.error ? <><Glyph name='diamond' /> Updates unavailable</> : <><Glyph name='check' /> Read {snapshot.at ? shortTime(snapshot.at) : '—'}</>}</span><span title={view.run.id}>{view.run.id}</span><span>Fabric / Ledger</span></footer>
          </>}
        </>}
  </div>;
}

/** Same-session owner reviews actual local file hashes before applying a transfer. */
function PackOwnerPanel({ sessionId, initialPack }: { sessionId: string; initialPack: string }): ReactElement {
  const [pack, setPack] = useState(initialPack);
  const [mode, setMode] = useState<'install' | 'share' | 'migrate' | 'upgrade'>(initialPack ? 'share' : 'install');
  const [location, setLocation] = useState('');
  const [assets, setAssets] = useState('');
  const [review, setReview] = useState<import('../release.js').PackTransferReview>();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const fromSource = mode === 'install' || mode === 'upgrade';
  const pending = useRef(false);
  const controller = useRef<AbortController | undefined>();
  useEffect(() => () => controller.current?.abort(), []);
  const invalidate = () => { setReview(undefined); setMessage(''); };
  const submit = async (confirm: boolean) => {
    if (pending.current || (confirm && !review)) return;
    pending.current = true; setBusy(true); setMessage('');
    const own = new AbortController(); controller.current = own;
    const result = await reviewPackTransfer({ sessionId, pack, mode, to: fromSource ? '' : location,
      ...(fromSource ? { source: location } : {}),
      ...(mode === 'share' ? { assets: assets.split('\n').map(line => line.trim()).filter(Boolean) } : {}),
      ...(confirm ? { reviewSha256: review!.reviewSha256 } : {}) }, own.signal);
    if (own.signal.aborted) return;
    pending.current = false; setBusy(false);
    if (!result.ok) { setReview(undefined); setMessage(result.error.message); return; }
    setReview(result.value);
    setMessage(confirm ? 'Confirmed files verified and written. No public upload was performed.' : 'Review the exact files and destination before confirming.');
    if (confirm) setReview(undefined);
  };
  return <section className='hima-detail' data-hima-region='pack-owner'>
    <h3>Pack & knowledge assets</h3>
    <p className='hima-small'>Install a transparent Pack folder, then inspect or move its method and local research assets.</p>
    <fieldset disabled={busy} style={{ border: 0, padding: 0, minWidth: 0, display: 'grid', gap: 14 }}>
      <div className='hima-fields'>
        <label>Installed Pack<input data-hima-control='owner-pack' value={pack} onChange={event => { invalidate(); setPack(event.target.value); }} /></label>
        <label>Action<select data-hima-control='owner-mode' value={mode} onChange={event => { invalidate(); setMode(event.target.value as typeof mode); }}>
          <option value='install'>Install Pack from folder</option><option value='share'>Share method / selected materials</option><option value='migrate'>Migrate my Pack with all assets</option><option value='upgrade'>Install tested method upgrade</option>
        </select></label>
        <label>{fromSource ? (mode === 'install' ? 'Pack source folder' : 'Tested release source folder') : 'New destination Pack folder'}<input data-hima-control='owner-location' value={location} onChange={event => { invalidate(); setLocation(event.target.value); }} /></label>
      </div>
      {mode === 'share' ? <label style={{ display: 'grid', gap: 8 }}>Optional material paths, one per line<textarea style={{ boxSizing: 'border-box', width: '100%', minHeight: 72, resize: 'vertical', padding: 10, font: 'inherit', color: 'inherit', background: 'transparent', border: '1px solid var(--dsw-alias-border-primary, #ddd)', borderRadius: 6 }} data-hima-control='owner-assets' value={assets} placeholder='Empty shares only the method. Select paths inside run-assets/ to include research.' onChange={event => { invalidate(); setAssets(event.target.value); }} /></label>
        : <p className='hima-small'>{mode === 'install' ? 'Review shows every method and knowledge file before this fixed Pack is installed. Author status is displayed and does not change execution.' : mode === 'migrate' ? 'Migration includes your private run-assets and historical methods. Use only your own destination.' : 'The current method remains unchanged until you confirm a tested release. Old methods and run-assets are retained.'}</p>}
      <button style={{ justifySelf: 'start' }} className='hima-button' data-hima-control='owner-review' disabled={!pack || !location} onClick={() => { void submit(false); }}>Review files</button>
      {review ? <div data-hima-region='pack-review'>
        <p style={{ overflowWrap: 'anywhere' }}>Destination: <code>{review.to}</code></p>
        <p className='hima-small'>{review.files.length} files · {review.changes.length} changes · review <code title={review.reviewSha256}>{review.reviewSha256.slice(0, 12)}</code></p>
        <div style={{ maxHeight: 240, overflow: 'auto' }}><table style={{ width: '100%', tableLayout: 'fixed', fontSize: 12, textAlign: 'left' }}><thead><tr><th style={{ width: '56%' }}>File</th><th style={{ width: '16%' }}>Bytes</th><th>SHA-256</th></tr></thead><tbody>{review.files.map(file => <tr key={file.path}><td style={{ padding: '8px 6px 8px 0', overflowWrap: 'anywhere' }}>{file.path}</td><td>{file.bytes}</td><td><code title={file.sha256}>{file.sha256.slice(0, 12)}</code></td></tr>)}</tbody></table></div>
        <details style={{ margin: '12px 0' }}><summary>Full manifest and changes</summary><pre style={{ maxHeight: 220, overflow: 'auto', fontSize: 11 }}>{JSON.stringify(review, null, 2)}</pre></details>
        <button className='hima-button hima-primary' data-hima-control='owner-confirm' onClick={() => { void submit(true); }}>Confirm these exact files</button>
      </div> : null}
    </fieldset>
    {message ? <p role='status' data-hima-region='pack-owner-message'>{message}</p> : null}
  </section>;
}

function RunSummary({ view }: { view: RunView }): ReactElement {
  const { run } = view;
  const status = run.status === undefined ? undefined : labelled(runStatusLabel, run.status);
  const lines = bannerLines(run);
  const blocker = run.status === 'waiting' ? view.blockers.at(-1) : undefined;
  return <section className='hima-run-summary' data-hima-region='studio-status' data-hima-state-status={run.status ?? 'unknown'} data-hima-state-purpose={run.purpose ?? 'campaign'}>
    <div className='hima-run-title'><h3>{run.packId ?? run.campaignId}{runPurposeMark(run.purpose) ? ` · ${runPurposeMark(run.purpose)}` : ''}</h3><span className='hima-state' data-state={run.status}><Glyph name={stateGlyphName(run.status ?? 'unknown')} /> {status?.said ?? 'No Fabric state recorded'}</span></div>
    <p className='hima-run-context'>{view.workspace?.design ?? 'Design not recorded'} <span>·</span> {run.siteId} {run.packVersion ? <><span>·</span> Pack v{run.packVersion}</> : null}</p>
    <div className='hima-headlines'><div><span className='hima-studio-eyebrow'>CAMPAIGN GOAL</span><p>{lines.goal ?? 'No goal recorded'}</p></div><div><span className='hima-studio-eyebrow'>CURRENT STEP</span><p>{run.currentNode ?? 'No current node recorded'}</p></div></div>
    <div className='hima-metrics'>
      <div><span>Generation</span><strong>{run.generation ?? '—'} <small>/ {run.budget?.generationLimit ?? '—'}</small></strong></div>
      <div><span>Elapsed</span><strong>{run.meters ? duration(run.meters.elapsedMs) : '—'}</strong></div>
      <div><span>Observations</span><strong>{view.observations.length}</strong></div>
    </div>
    <details className='hima-budget'><summary>Budget and resource use</summary><dl>{meterRows(view).map((row) => <div key={row.key}><dt>{row.label}</dt><dd>{row.detail}</dd></div>)}</dl></details>
    {blocker ? <div className='hima-blocker'><strong><Glyph name='diamond' /> Needs attention · {blocker.nodeId}</strong><p>{blocker.reason}</p></div> : null}
  </section>;
}

type CampaignNodeState = 'planned' | 'available' | 'running' | 'waiting' | 'done' | 'blocked' | 'cancelled' | 'invalidated' | 'added';
type GraphNode = ExecutionContext['nodes'][number];
interface GraphEdge { readonly from: string; readonly to: string; readonly outcome?: string; readonly revisit?: boolean }

function graphNodeSummary(node: GraphNode): string {
  const parameters = (node.parameters ?? {}) as Record<string, unknown>;
  const action = parameters.tool ?? parameters.workshop ?? parameters.observes ?? parameters.chooser ?? parameters.opens;
  return `${node.kind}${typeof action === 'string' ? ` · ${action}` : ''}`;
}

function campaignNodeState(node: GraphNode, referenceIds: ReadonlySet<string>, context: ExecutionContext, view: RunView): CampaignNodeState {
  const execution = context.executions.filter((item) => item.nodeId === node.id).at(-1);
  if (execution?.supersededBy !== undefined) return 'invalidated';
  if (execution?.phase === 'working') return 'running';
  if (execution?.phase === 'ready') return 'waiting';
  if (execution?.phase === 'completed') return 'done';
  if (execution?.phase === 'failed' || execution?.phase === 'uncertain') return 'blocked';
  const transition = view.nodes.filter((item) => item.nodeId === node.id).at(-1);
  if (transition?.state === 'done') return 'done';
  if (transition?.state === 'running') return 'running';
  if (transition?.state === 'cancelled') return 'cancelled';
  if (transition && ['blocked', 'retrying', 'waiting-for-slot'].includes(transition.state)) return 'blocked';
  if (view.run.currentNode === node.id && view.run.status === 'waiting') return 'waiting';
  if (context.available.includes(node.id)) return 'available';
  return referenceIds.has(node.id) ? 'planned' : 'added';
}

function CampaignGraph({ view, context, owner }: { view: RunView; context?: ExecutionContext; owner: boolean }): ReactElement {
  const [selected, setSelected] = useState<string>();
  const [zoom, setZoom] = useState(100);
  const graphRef = useRef<HTMLDivElement>(null);
  if (!context?.method) return <section className='hima-fabric'><div className='hima-section-heading'><h3>Campaign graph</h3></div><p className='hima-small'>{context?.reason ?? 'Reading the complete reference graph…'}</p></section>;
  const reference = context.method.reference;
  const loopGraphs = Object.values(reference.loops ?? {});
  const nodes = [...reference.nodes, ...loopGraphs.flatMap((loop) => loop.nodes)];
  const referenceIds = new Set(nodes.map((node) => node.id));
  const added = context.nodes.filter((node) => !referenceIds.has(node.id));
  nodes.push(...added);
  const edges: GraphEdge[] = [...reference.edges, ...loopGraphs.flatMap((loop) => loop.edges)];
  for (const opener of reference.nodes) {
    const opens = opener.kind === 'explore' ? opener.parameters.opens : undefined;
    const loop = opens === undefined ? undefined : reference.loops?.[opens];
    if (loop) edges.push({ from: opener.id, to: loop.entry });
  }
  for (const growth of context.growths.filter((item) => item.event === 'accepted' && item.entry && item.parentNode)) edges.push({ from: growth.parentNode!, to: growth.entry! });
  const ranks = new Map<string, number>(nodes.map((node) => [node.id, node.id === reference.entry ? 0 : 0]));
  for (let pass = 0; pass < nodes.length; pass++) for (const edge of edges) {
    if (edge.revisit) continue;
    const next = Math.min(nodes.length, (ranks.get(edge.from) ?? 0) + 1);
    if (next > (ranks.get(edge.to) ?? 0)) ranks.set(edge.to, next);
  }
  const columns = new Map<number, GraphNode[]>();
  for (const node of nodes) { const rank = ranks.get(node.id) ?? 0; columns.set(rank, [...columns.get(rank) ?? [], node]); }
  const positions = new Map<string, { x: number; y: number }>();
  for (const [rank, column] of columns) column.forEach((node, row) => positions.set(node.id, { x: 34 + rank * 190, y: 34 + row * 104 }));
  const width = 80 + (Math.max(0, ...columns.keys()) + 1) * 190;
  const height = 80 + Math.max(1, ...[...columns.values()].map((column) => column.length)) * 104;
  const chosen = nodes.find((node) => node.id === (selected ?? view.run.currentNode));
  const chosenState = chosen ? campaignNodeState(chosen, referenceIds, context, view) : undefined;
  const chosenEvidence = chosen ? context.evidence?.filter((item) => item.nodeId === chosen.id) ?? [] : [];
  const chosenJobs = chosen ? view.jobs.filter((job) => job.nodeId === chosen.id) : [];
  const locate = () => {
    const current = view.run.currentNode;
    if (!current) return;
    setSelected(current);
    graphRef.current?.querySelector<HTMLElement>(`[data-hima-node="${CSS.escape(current)}"]`)?.scrollIntoView({ block: 'nearest', inline: 'center' });
  };
  return <section className='hima-fabric' data-hima-region='campaign-graph' data-hima-state-nodes={String(nodes.length)} data-hima-state-current={view.run.currentNode ?? ''}>
    <div className='hima-section-heading'><div><h3>Campaign graph</h3><p className='hima-small'>Complete Pack method with actual execution, growth and revision facts.</p></div><div className='hima-graph-tools'><button className='hima-button' onClick={locate}>Locate current</button><label>Zoom <input aria-label='Campaign graph zoom' type='range' min='65' max='135' value={zoom} onChange={(event) => setZoom(Number(event.target.value))}/></label></div></div>
    <div className='hima-graph-scroll' ref={graphRef}><div className='hima-graph-canvas' style={{ width: width * zoom / 100, height: height * zoom / 100 }}><div style={{ width, height, transform: `scale(${zoom / 100})`, transformOrigin: 'top left', position: 'relative' }}>
      <svg width={width} height={height} aria-hidden='true'><defs><marker id='hima-arrow' viewBox='0 0 10 10' refX='9' refY='5' markerWidth='5' markerHeight='5' orient='auto-start-reverse'><path d='M 0 0 L 10 5 L 0 10 z'/></marker></defs>{edges.map((edge, index) => { const from = positions.get(edge.from), to = positions.get(edge.to); if (!from || !to) return null; return <g key={`${edge.from}-${edge.to}-${index}`}><path d={`M ${from.x + 146} ${from.y + 32} C ${from.x + 168} ${from.y + 32}, ${to.x - 22} ${to.y + 32}, ${to.x} ${to.y + 32}`} className={edge.revisit ? 'hima-graph-edge hima-revisit' : 'hima-graph-edge'} markerEnd='url(#hima-arrow)'/>{edge.outcome ? <text x={(from.x + to.x + 146) / 2} y={(from.y + to.y) / 2 + 22}>{edge.outcome}</text> : null}</g>; })}</svg>
      {nodes.map((node) => { const at = positions.get(node.id)!; const state = campaignNodeState(node, referenceIds, context, view); return <button key={node.id} type='button' className='hima-graph-node' data-state={state} data-hima-node={node.id} title={`${node.id}: ${graphNodeSummary(node)} · ${state}`} style={{ left: at.x, top: at.y }} onClick={() => setSelected(node.id)}><span><Glyph name={stateGlyphName(state)} /></span><strong>{node.id}</strong><small>{graphNodeSummary(node)}</small></button>; })}
    </div></div></div>
    <div className='hima-trace-caption'><span><Glyph name='circle' /> Planned</span><span><Glyph name='ring' /> Available / added</span><span><Glyph name='dot' /> Running</span><span><Glyph name='check' /> Done</span><span><Glyph name='diamond' /> Waiting</span><span><Glyph name='square' /> Blocked / stopped</span></div>
    {chosen ? <aside className='hima-node-inspector' data-hima-region='campaign-node-inspector' data-hima-state-node={chosen.id}>
      <header><div><span className='hima-studio-eyebrow'>NODE</span><h4>{chosen.id}</h4></div><span className='hima-state' data-state={chosenState}><Glyph name={stateGlyphName(chosenState ?? 'planned')} /> {chosenState}</span></header>
      <p>{graphNodeSummary(chosen)}. {owner ? 'Campaign Agent controls are available when Fabric admits this node.' : 'Open the Campaign Agent to perform owner actions.'}</p>
      <dl><div><dt>Inputs / action</dt><dd><pre>{JSON.stringify(chosen.parameters, null, 2)}</pre></dd></div><div><dt>Evidence</dt><dd>{chosenEvidence.length ? chosenEvidence.map((item) => item.recordId).join(', ') : 'No evidence formed for this node.'}</dd></div><div><dt>Jobs</dt><dd>{chosenJobs.length ? chosenJobs.map((job) => `${job.event} · ${job.job.session}`).join('; ') : 'No Job recorded for this node.'}</dd></div></dl>
    </aside> : null}
  </section>;
}

function JobActivity({ view }: { view: RunView }): ReactElement {
  const log = view.run.status === 'waiting' ? view.blockers.at(-1)?.logTail : undefined;
  return <section className='hima-activity'><header><span><Glyph name='bar' /> {log ? 'Captured job output' : 'Job activity'}</span><span>{log ? 'Blocker log tail' : 'Ledger events'}</span></header>
    <pre>{log ?? (view.jobs.length ? view.jobs.slice(-12).map((job) => `${shortTime(job.at)}  ${job.nodeId ?? 'job'}  ${job.event}${job.exitCode === undefined ? '' : `  exit ${job.exitCode}`}\n  ${job.job.session}`).join('\n') : 'Waiting for the first recorded Job event.')}</pre>
    <footer>{log ? 'Original output retained in the blocker record.' : 'Job lifecycle events from the Run record.'}</footer>
  </section>;
}

function EvidenceTrail({ view }: { view: RunView }): ReactElement {
  return <div className='hima-detail hima-evidence'>
    <h3>Evidence trail</h3><p className='hima-small'>Recorded measurements, judgments and their original sources.</p>
    {view.observations.length === 0 ? <p>No observation has been recorded.</p> : null}
    {view.observations.map((observation) => <details key={observation.recordId}>
      <summary>{observation.path.split('/').at(-1)} · {shortTime(observation.at)} · observation</summary>
      <p className='hima-small'>{observation.recordId}</p><ObservationRow observation={observation} />
    </details>)}
    {view.verdicts.map((verdict) => <details key={verdict.recordId} open={verdict.outcome !== 'PASS'}>
      <summary>{verdict.outcome} · {verdict.ruleId}@{verdict.ruleVersion}</summary><VerdictRow verdict={verdict} />
    </details>)}
    {view.decision ? <details><summary>Recorded decision and citations</summary><DecisionRow decision={view.decision} view={view} /></details> : null}
    {view.refusals.map((refusal, index) => <details key={index} open><summary>Refused access</summary><p>{refusal.path}</p><p>{refusal.reason}</p></details>)}
    {view.blockers.map((blocker) => <details key={blocker.recordId}><summary>{blocker.nodeId} · {shortTime(blocker.at)} · blocker</summary>
      <p>{blocker.reason}</p><p className='hima-small'>{blocker.recordId} · {blocker.attempts} attempts · exit {blocker.lastExitCode ?? 'not recorded'}</p>{blocker.logTail ? <pre>{blocker.logTail}</pre> : null}
    </details>)}
    {view.cancels.map((cancel) => <details key={cancel.recordId}><summary>Cancellation · {shortTime(cancel.at)}</summary><p>{cancelAsked(cancel)}</p><p>{cancelObserved(view, cancel).said}</p></details>)}
  </div>;
}

function StartRunForm({ sessionId, onStarted, onClose, onBusy }: { sessionId: string; onStarted(view: RunView): void; onClose(): void; onBusy(busy: boolean): void }): ReactElement {
  const [selection, setSelection] = useState<{ pack?: string; site?: string }>({});
  const [prepared, setPrepared] = useState<StartChoices>();
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [checkRevision, setCheckRevision] = useState(0);
  const checkPending = useRef(true);
  const request = useRef<AbortController | undefined>(undefined);
  useEffect(() => {
    const own = new AbortController();
    checkPending.current = true; setChecking(true); setError(undefined);
    void fetchStartChoices(selection.pack, selection.site, own.signal).then((result) => {
      if (own.signal.aborted) return;
      setChecking(false);
      if (!result.ok) { setError(result.error.message); return; }
      const next = result.value;
      setPrepared(next); checkPending.current = false;
    });
    return () => own.abort();
  }, [selection.pack, selection.site, checkRevision]);
  useEffect(() => () => { request.current?.abort(); onBusy(false); }, [onBusy]);
  const submit = async () => {
    if (request.current || checkPending.current || prepared?.proposal?.ready !== true) return;
    const own = new AbortController(); request.current = own; setSubmitting(true); onBusy(true); setError(undefined);
    const result = await startCampaign({ sessionId, proposalId: prepared.proposal.id, pack: prepared.pack, site: prepared.site,
      goal: prepared.proposal.goal, strategy: prepared.proposal.strategy }, own.signal);
    if (own.signal.aborted) return;
    request.current = undefined; setSubmitting(false); onBusy(false);
    if (result.ok) onStarted(result.value); else setError(result.error.message);
  };
  return <form className='hima-start-form' data-hima-region='studio-start' onSubmit={(event) => { event.preventDefault(); void submit(); }}>
    <div className='hima-section-heading'><h3>Prepare a Campaign</h3><button type='button' className='hima-icon-button' aria-label='Close Campaign preparation' disabled={submitting} onClick={onClose}><Glyph name='close' /></button></div>
    <p className='hima-small'>Choose a business capability and execution Site. HimaGuide checks the method, inputs, knowledge and environment before one confirmation creates the Campaign.</p>
    {prepared?.packs.length === 0 ? <div className='hima-notice' data-hima-region='studio-empty-pack'><strong>No HimaPack is installed.</strong><p>Ask HimaGuide to install a Pack, or open Pack &amp; assets to review and install a fixed Pack folder.</p></div> : null}
    {prepared?.sites.length === 0 ? <div className='hima-notice' data-hima-region='studio-empty-site'><strong>No execution Site is saved.</strong><p>Give HimaGuide an SSH host or OpenSSH alias. It can discover a safe Site profile before Campaign preparation.</p></div> : null}
    <div className='hima-fields'>{(['pack', 'site'] as const).map((kind) => <label key={kind}>{kind === 'pack' ? 'Method / Pack' : 'Execution Site'}<select data-hima-control={`studio-${kind}`} disabled={submitting} value={selection[kind] ?? prepared?.[kind] ?? ''} onChange={(event) => { checkPending.current = true; setChecking(true); setSelection({ pack: prepared?.pack, site: prepared?.site, ...selection, [kind]: event.target.value }); }}><option value='' disabled>Choose…</option>{(kind === 'pack' ? prepared?.packs : prepared?.sites)?.map((value) => <option key={value} value={value} disabled={kind === 'pack' && prepared?.cannotStart?.includes(value)}>{value}{kind === 'pack' && prepared?.marks?.[value] ? ` — ${prepared.marks[value]}` : ''}</option>)}</select></label>)}</div>
    {prepared?.proposal ? <section className='hima-preparation' data-hima-region='studio-proposal' data-hima-state-ready={String(prepared.proposal.ready)}>
      <h4>{prepared.proposal.pack.title}</h4><p className='hima-small'>Pack {prepared.proposal.pack.id}@{prepared.proposal.pack.version}{prepared.proposal.pack.status ? ` · ${prepared.proposal.pack.status.raw}` : ''}</p>
      <div className='hima-headlines'><div><strong>Business goal</strong><p>{Object.entries(prepared.proposal.goal).map(([name, value]) => `${prepared.words?.goal[name]?.label ?? name}: ${String(value)}${prepared.words?.goal[name]?.unit ? ` ${prepared.words.goal[name]!.unit}` : ''}`).join(' · ') || 'Pack-defined goal'}</p></div><div><strong>Method</strong><p>{prepared.proposal.referenceGraph.nodes.length} reference nodes · {prepared.proposal.knowledge.documents} Pack knowledge documents · {prepared.proposal.site?.kind ?? 'Site needed'}</p></div></div>
      <details><summary>Inputs and readiness</summary>{prepared.proposal.inputs.map((input) => <p key={input.name}>{input.ready ? <Glyph name='check' /> : <Glyph name='circle' />}<span className='hima-visually-hidden'>{input.ready ? 'ready' : 'not ready'}</span> <strong>{input.name}</strong>{input.value ? ` · ${input.value}` : ''}<br/><span className='hima-small'>{input.description}</span></p>)}{prepared.proposal.unknowns.map((unknown) => <p key={unknown} className='hima-notice'>{unknown}</p>)}</details>
      <details><summary>Reference graph and tools</summary><p>{prepared.proposal.referenceGraph.nodes.map((node) => `${node.id} (${node.kind})`).join(' → ')}</p><p className='hima-small'>{prepared.proposal.pack.tools.map((tool) => `${tool.id}${tool.recommendedVersion ? ` · ${tool.recommendedVersion}` : ''}`).join('; ') || 'No external tool declared.'}</p></details>
    </section> : null}
    <details className='hima-advanced'><summary>Proposed Campaign settings</summary>
      <p className='hima-small'>HimaGuide selected the Pack defaults after checking the actual inputs and Site. Confirming uses these exact values and the Pack budget.</p>
      <div className='hima-headlines'><div><strong>Goal</strong><p>{Object.entries(prepared?.proposal?.goal ?? {}).map(([name, value]) => `${name}: ${String(value)}`).join(' · ') || 'Unavailable'}</p></div>
        <div><strong>Initial strategy</strong><p>{Object.entries(prepared?.proposal?.strategy ?? {}).map(([name, value]) => `${name}: ${String(value)}`).join(' · ') || 'Unavailable'}</p></div></div>
    </details>
    <div className='hima-preflight' role='status' data-hima-region='studio-preflight' data-hima-state-status={checking ? 'checking' : checkPending.current ? 'unavailable' : prepared?.proposal?.ready ? 'ready' : 'needs-input'}>{checking ? 'Preparing Campaign proposal…' : checkPending.current ? 'Preparation unavailable; retry before confirming.' : prepared?.proposal?.ready ? <><Glyph name='check' /> Inputs, Pack, Site and method are ready for one Campaign confirmation.</> : prepared?.preparation?.message ?? prepared?.proposal?.nextActions.join(' ') ?? 'Choose a Pack and Site to continue.'}</div>
    {error ? <div className='hima-notice' role='alert'><p>{error}</p><button type='button' className='hima-button' data-hima-control='studio-recheck' onClick={() => { checkPending.current = true; setCheckRevision((value) => value + 1); }}>Retry preparation check</button></div> : null}
    <div className='hima-start-footer'><button className='hima-button hima-primary' data-hima-control='studio-start' disabled={checking || checkPending.current || submitting || prepared?.proposal?.ready !== true}>{submitting ? 'Creating Campaign…' : <>Confirm and start Campaign <Glyph name='arrow-right' /></>}</button><details><summary>Checks and data source</summary><p>{START_STATIC_LIMIT}</p></details></div>
  </form>;
}
