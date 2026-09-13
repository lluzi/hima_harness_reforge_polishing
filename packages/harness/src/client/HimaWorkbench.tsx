// The existing Hima Run projection, presented inside the native dsh document dock.
// Local state is selection, drafts and the last HTTP response; the Agent requests work and Fabric validates its facts.
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import type { RunView } from '../remote.js';
import type { StartChoices } from '../workbench.js';
import { bannerLines, cancelAsked, cancelObserved, duration, labelled, meterRows, nodeStateLabel, runPurposeMark, runStatusLabel, startForm, startGoalField, startKnobField, START_STATIC_LIMIT } from '../card-labels.js';
import { reportBlocks } from '../experience-report.js';
import { runPath } from '../paths.js';
import { fetchRun, fetchRuns, fetchStartChoices, reviewPackTransfer, startCampaign, type HimaResult } from './api.js';
import { ArchiveSection, DecisionRow, ExperienceSection, GenerationsTable, GrowthSection, MaterialSection, ObservationRow, ReportBlockRow, RunControls, useRunActions, VerdictRow, WorkshopSection } from './HimaRunCard.js';

/** The public tab-info hook is supplied by the installed dsh sidebar slot. */
export interface WorkbenchProps {
  sessionId: string;
  openOwner(id: string): void;
  sendToOwner(id: string, text: string): Promise<void>;
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
const stateGlyph = (state: string): string => {
  if (state === 'done' || state === 'ended-goal-met') return '✓';
  if (state === 'running') return '◉';
  if (['waiting', 'ended-converged', 'retrying', 'waiting-for-slot'].includes(state)) return '◇';
  if (['blocked', 'cancelled', 'ended-goal-not-met', 'ended-budget-exhausted'].includes(state)) return '×';
  return '○';
};

export function HimaWorkbench({ sessionId, useTabInfo, openFiles, openOwner, sendToOwner }: WorkbenchProps): ReactElement {
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
  const view = snapshot.value;
  const acting = useRunActions(selected, (updated, action, nodeId) => {
    snapshot.refresh(); list.refresh();
    if (updated.run.control) void sendToOwner(updated.run.control.owner,
      `I requested ${action} for Hima Run ${updated.run.id}${nodeId ? `, node ${nodeId}` : ''} in Live Run. The control request was accepted; read hima_context for its actual effect and any in-flight Jobs. ${action === 'continue' ? 'Continue the authorized work in this conversation from current facts.' : 'Honor the recorded control state before starting any new work.'}`,
    ).catch((error: unknown) => setNotice(`The control request was accepted, but its conversation notification failed: ${(error as Error).message}. The Run's recorded control state still applies.`));
  }, sessionId, view);

  useEffect(() => {
    if (requested !== undefined && !startPending.current) { setSelected(requested); setCreating(false); setSection('live'); }
  }, [requested, tab.navigation.revision]);
  useEffect(() => {
    setSaved(undefined);
    return () => { savedRead.current?.abort(); };
  }, [selected, sessionId]);
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

  return <div className='hima-studio' data-hima-region='studio' data-hima-state-session={sessionId} data-hima-state-run={selected ?? ''} data-stale={snapshot.error !== undefined}>
    <header className='hima-studio-header'>
      <div><h2>Research workspace</h2></div>
      <button className='hima-button' disabled={starting} onClick={openFiles} title='Open the native workspace files and code panel'>Files & code</button>
      <button className='hima-button' disabled={starting} data-hima-control='studio-pack-owner' onClick={() => setManagingPack(value => !value)}>Pack & assets</button>
      <button className='hima-button hima-primary' disabled={starting} data-hima-control='studio-new' onClick={() => { if (!startPending.current) setCreating(true); }}>＋ New run</button>
    </header>
    <div className='hima-run-picker'>
      <span className='hima-studio-eyebrow'>VIEWED RUN</span>
      <select aria-label='Run on this host' disabled={starting} data-hima-control='studio-run' value={selected ?? ''} onChange={(e) => { if (!startPending.current) { setSelected(e.target.value || undefined); setCreating(false); } }}>
        <option value=''>Select a run on this host</option>
        {selected && !list.value?.runs.some((run) => run.id === selected) ? <option value={selected}>{selected}</option> : null}
        {list.value?.runs.map((run) => <option key={run.id} value={run.id}>{run.packId ?? run.campaignId}{runPurposeMark(run.purpose) ? ` · ${runPurposeMark(run.purpose)}` : ''} · {shortTime(run.createdAt)} · {run.id.slice(-6)}</option>)}
      </select>
      <button className='hima-icon-button' aria-label='Refresh Run data' onClick={() => { list.refresh(); snapshot.refresh(); }}>↻</button>
    </div>
    {list.error ? <p className='hima-notice' role='status'>Run list unavailable: {list.error}</p> : null}
    {notice ? <p role='alert' className='hima-error'>{notice}</p> : null}
    {managingPack ? <PackOwnerPanel key={sessionId} sessionId={sessionId} initialPack={view?.run.packId ?? ''} /> : null}
    {view?.run.control && view.run.control.owner !== sessionId ? <button type='button' className='hima-button' data-hima-control='open-owner' onClick={() => openOwner(view.run.control!.owner)}>Open owning conversation</button> : null}
    {creating ? <StartRunForm key={sessionId} sessionId={sessionId} onBusy={startBusy} onClose={() => { if (!startPending.current) setCreating(false); }} onStarted={(run) => { setSelected(run.run.id); setCreating(false); setSection('live'); list.refresh(); snapshot.refresh(); setNotice(undefined); if (run.run.control) void sendToOwner(run.run.control.owner, `Start the prepared Hima Run ${run.run.id} in this conversation. Read hima_context, inspect the Pack reference nodes and current facts, then use hima_execute to admit and perform each authorized node. You are the execution owner; choose the next step from actual evidence. Keep this conversation available during Jobs and honor pause/stop instructions. Do not create another Run or hidden execution Agent.`).catch((error: unknown) => setNotice(`Run ${run.run.id} is prepared, but the conversation message was not delivered: ${(error as Error).message}. Ask this conversation to inspect the Run; do not start a duplicate.`)); }} />
      : selected === undefined ? <div className='hima-empty'><div className='hima-empty-glyph'>⌘</div><h3>Explore. Experiment. Build evidence.</h3><p>Keep the engineering conversation here while Hima tracks each experiment beside it.</p><button className='hima-button hima-primary' onClick={() => setCreating(true)}>Start a research run</button><p className='hima-small'>Choose an existing run above, or start from an installed Pack.</p></div>
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
                <ExecutionTrace view={view} />
                <GrowthSection view={view} />
                <JobActivity view={view} />
                {view.workshop ? <WorkshopSection view={view} workshop={view.workshop} /> : null}
                <MaterialSection view={view} />
                <ArchiveSection view={view} />
              </> : section === 'experiments' ? <div className='hima-detail'><h3>Experiment history</h3><p className='hima-small'>Recorded generations, measurements and decisions.</p>{view.generations.length ? <GenerationsTable view={view} /> : <p>No generation has been recorded.</p>}</div>
                : section === 'evidence' ? <EvidenceTrail view={view} />
                  : <div className='hima-detail hima-report'><h3>Technical report</h3>{saved ? <><button className='hima-button' onClick={() => { savedRead.current?.abort(); setSaved(undefined); }}>← Current ledger preview</button><p className='hima-small'>{saved.markdown !== undefined ? 'Saved Markdown · original bytes verified by the Host' : saved.loading ? 'Reading and verifying the saved file…' : 'Saved file could not be verified'}</p>{saved.loading ? <p>Reading saved report…</p> : saved.error ? <p role='alert' className='hima-notice'>{saved.error}</p> : reportBlocks(saved.markdown!).map((block, index) => <ReportBlockRow key={index} block={block} />)}</> : view.experience ? <ExperienceSection view={view} experience={view.experience} onOpenSaved={() => { void openSaved(); }} /> : <p>{view.experienceUnavailable ?? 'A technical report will appear here when the Run closes.'}</p>}</div>}
            </div>
            {section === 'report' ? <ArchiveSection view={view} /> : null}
            <footer className='hima-studio-footer'><span>{snapshot.error ? '◇ Updates unavailable' : `✓ Read ${snapshot.at ? shortTime(snapshot.at) : '—'}`}</span><span title={view.run.id}>{view.run.id}</span><span>Fabric / Ledger</span></footer>
          </>}
        </>}
  </div>;
}

/** Same-session owner reviews actual local file hashes before applying a transfer. */
function PackOwnerPanel({ sessionId, initialPack }: { sessionId: string; initialPack: string }): ReactElement {
  const [pack, setPack] = useState(initialPack);
  const [mode, setMode] = useState<'share' | 'migrate' | 'upgrade'>('share');
  const [location, setLocation] = useState('');
  const [assets, setAssets] = useState('');
  const [review, setReview] = useState<import('../release.js').PackTransferReview>();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const controller = useRef<AbortController | undefined>();
  useEffect(() => () => controller.current?.abort(), []);
  const invalidate = () => { setReview(undefined); setMessage(''); };
  const submit = async (confirm: boolean) => {
    if (pending.current || (confirm && !review)) return;
    pending.current = true; setBusy(true); setMessage('');
    const own = new AbortController(); controller.current = own;
    const result = await reviewPackTransfer({ sessionId, pack, mode, to: mode === 'upgrade' ? '' : location,
      ...(mode === 'upgrade' ? { source: location } : {}),
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
    <p className='hima-small'>This local owner controls method upgrades and which research materials leave the installed Pack.</p>
    <fieldset disabled={busy} style={{ border: 0, padding: 0, minWidth: 0, display: 'grid', gap: 14 }}>
      <div className='hima-fields'>
        <label>Installed Pack<input data-hima-control='owner-pack' value={pack} onChange={event => { invalidate(); setPack(event.target.value); }} /></label>
        <label>Action<select data-hima-control='owner-mode' value={mode} onChange={event => { invalidate(); setMode(event.target.value as typeof mode); }}>
          <option value='share'>Share method / selected materials</option><option value='migrate'>Migrate my Pack with all assets</option><option value='upgrade'>Install tested method upgrade</option>
        </select></label>
        <label>{mode === 'upgrade' ? 'Tested release source folder' : 'New destination Pack folder'}<input data-hima-control='owner-location' value={location} onChange={event => { invalidate(); setLocation(event.target.value); }} /></label>
      </div>
      {mode === 'share' ? <label style={{ display: 'grid', gap: 8 }}>Optional material paths, one per line<textarea style={{ boxSizing: 'border-box', width: '100%', minHeight: 72, resize: 'vertical', padding: 10, font: 'inherit', color: 'inherit', background: 'transparent', border: '1px solid var(--dsw-alias-border-primary, #ddd)', borderRadius: 6 }} data-hima-control='owner-assets' value={assets} placeholder='Empty shares only the method. Select paths inside run-assets/ to include research.' onChange={event => { invalidate(); setAssets(event.target.value); }} /></label>
        : <p className='hima-small'>{mode === 'migrate' ? 'Migration includes your private run-assets and historical methods. Use only your own destination.' : 'The current method remains unchanged until you confirm a tested release. Old methods and run-assets are retained.'}</p>}
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
    <div className='hima-run-title'><h3>{run.packId ?? run.campaignId}{runPurposeMark(run.purpose) ? ` · ${runPurposeMark(run.purpose)}` : ''}</h3><span className='hima-state' data-state={run.status}>{stateGlyph(run.status ?? 'unknown')} {status?.said ?? 'No Fabric state recorded'}</span></div>
    <p className='hima-run-context'>{view.workspace?.design ?? 'Design not recorded'} <span>·</span> {run.siteId} {run.packVersion ? <><span>·</span> Pack v{run.packVersion}</> : null}</p>
    <div className='hima-headlines'><div><span className='hima-studio-eyebrow'>RESEARCH GOAL</span><p>{lines.goal ?? 'No goal recorded'}</p></div><div><span className='hima-studio-eyebrow'>CURRENT STEP</span><p>{run.currentNode ?? 'No current node recorded'}</p></div></div>
    <div className='hima-metrics'>
      <div><span>Generation</span><strong>{run.generation ?? '—'} <small>/ {run.budget?.generationLimit ?? '—'}</small></strong></div>
      <div><span>Elapsed</span><strong>{run.meters ? duration(run.meters.elapsedMs) : '—'}</strong></div>
      <div><span>Observations</span><strong>{view.observations.length}</strong></div>
    </div>
    <details className='hima-budget'><summary>Budget and resource use</summary><dl>{meterRows(view).map((row) => <div key={row.key}><dt>{row.label}</dt><dd>{row.detail}</dd></div>)}</dl></details>
    {blocker ? <div className='hima-blocker'><strong>◇ Needs attention · {blocker.nodeId}</strong><p>{blocker.reason}</p></div> : null}
  </section>;
}

function ExecutionTrace({ view }: { view: RunView }): ReactElement {
  return <section className='hima-fabric'>
    <div className='hima-section-heading'><h3>Execution trace</h3><span>Recorded order · {view.nodes.filter((node) => node.state === 'done').length} / {view.nodes.length} done</span></div>
    <div className='hima-trace-scroll'><ol className='hima-trace'>{view.nodes.map((node) => <li key={node.nodeId} data-state={node.state}>
      <span className='hima-station' aria-hidden='true'>{stateGlyph(node.state)}</span><strong>{node.nodeId}</strong><span>{labelled(nodeStateLabel, node.state).said}</span><small>{node.kind} · attempt {node.attempt}</small>
    </li>)}</ol></div>
    {view.nodes.length === 0 ? <p className='hima-small'>No node transition has been recorded.</p> : null}
    {view.run.fork ? <p className='hima-small'>Parallel work at {view.run.fork.from}. Inspect Experiments for each branch.</p> : null}
    <div className='hima-trace-caption'><span>✓ Done</span><span>◉ Running</span><span>◇ Waiting</span><span>× Stopped / blocked</span></div>
  </section>;
}

function JobActivity({ view }: { view: RunView }): ReactElement {
  const log = view.run.status === 'waiting' ? view.blockers.at(-1)?.logTail : undefined;
  return <section className='hima-activity'><header><span>▤ {log ? 'Captured job output' : 'Job activity'}</span><span>{log ? 'Blocker log tail' : 'Ledger events'}</span></header>
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
  const [values, setValues] = useState<Record<string, string>>({});
  const [goals, setGoals] = useState<Record<string, string>>({});
  const [knobs, setKnobs] = useState<Record<string, string>>({});
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [checkRevision, setCheckRevision] = useState(0);
  const checkPending = useRef(true);
  const request = useRef<AbortController | undefined>(undefined);
  const previous = useRef<StartChoices | undefined>(undefined);
  useEffect(() => {
    const own = new AbortController();
    checkPending.current = true; setChecking(true); setError(undefined);
    void fetchStartChoices(selection.pack, selection.site, own.signal).then((result) => {
      if (own.signal.aborted) return;
      setChecking(false);
      if (!result.ok) { setError(result.error.message); return; }
      const next = result.value;
      const prior = previous.current;
      setKnobs((current) => Object.fromEntries(Object.entries(next.strategy ?? {}).map(([name, knob]) => {
        const old = prior?.strategy?.[name];
        const held = current[name];
        const compatible = old?.type === knob.type && (knob.type === 'choice' ? held !== undefined && knob.options.includes(held) : old?.type === 'number' && old.unit === knob.unit);
        return [name, compatible && held !== undefined ? held : String(knob.default)];
      })));
      setGoals((current) => Object.fromEntries(Object.entries(next.goal ?? {}).map(([name, parameter]) => [name,
        prior?.goal?.[name]?.unit === parameter.unit && current[name] !== undefined ? current[name] : String(parameter.default),
      ])));
      previous.current = next; setPrepared(next); checkPending.current = false;
    });
    return () => own.abort();
  }, [selection.pack, selection.site, checkRevision]);
  useEffect(() => () => { request.current?.abort(); onBusy(false); }, [onBusy]);
  const numeric = (raw: string | undefined): number | string | undefined => raw?.trim() ? (Number.isFinite(Number(raw)) ? Number(raw) : raw) : undefined;
  const submit = async () => {
    if (request.current || checkPending.current || prepared?.check?.fit !== true) return;
    const own = new AbortController(); request.current = own; setSubmitting(true); onBusy(true); setError(undefined);
    const strategy = Object.fromEntries(Object.entries(prepared.strategy ?? {}).map(([name, knob]) => [name, knobs[name]]));
    const result = await startCampaign({ sessionId, pack: prepared.pack, site: prepared.site, goal: goals, strategy, timeBox: numeric(values.timeBox), retries: numeric(values.retries), generations: numeric(values.generations) }, own.signal);
    if (own.signal.aborted) return;
    request.current = undefined; setSubmitting(false); onBusy(false);
    if (result.ok) onStarted(result.value); else setError(result.error.message);
  };
  return <form className='hima-start-form' data-hima-region='studio-start' onSubmit={(event) => { event.preventDefault(); void submit(); }}>
    <div className='hima-section-heading'><h3>New research run</h3><button type='button' className='hima-icon-button' aria-label='Close new Run form' disabled={submitting} onClick={onClose}>×</button></div>
    <p className='hima-small'>The Pack supplies the method. Set the objective and bounds for this experiment.</p>
    <div className='hima-fields'>{(['pack', 'site'] as const).map((kind) => <label key={kind}>{kind === 'pack' ? 'Method / Pack' : 'Execution Site'}<select data-hima-control={`studio-${kind}`} disabled={submitting} value={selection[kind] ?? prepared?.[kind] ?? ''} onChange={(event) => { checkPending.current = true; setChecking(true); setSelection({ pack: prepared?.pack, site: prepared?.site, ...selection, [kind]: event.target.value }); }}><option value='' disabled>Choose…</option>{(kind === 'pack' ? prepared?.packs : prepared?.sites)?.map((value) => <option key={value} value={value} disabled={kind === 'pack' && prepared?.cannotStart?.includes(value)}>{value}{kind === 'pack' && prepared?.marks?.[value] ? ` — ${prepared.marks[value]}` : ''}</option>)}</select></label>)}</div>
    <div className='hima-fields'>{Object.entries(prepared?.goal ?? {}).map(([name, parameter]) => { const field = startGoalField(name, parameter, prepared?.words?.goal[name]); return <label key={name}>{field.said}<input data-hima-control={field.control.replace('start-', 'studio-')} value={goals[name] ?? ''} onChange={(event) => setGoals({ ...goals, [name]: event.target.value })} /><small>{field.hint}</small></label>; })}
      {Object.entries(prepared?.strategy ?? {}).map(([name, knob]) => { const field = startKnobField(name, knob, prepared?.words?.strategy[name]); return <label key={name}>{field.said}{knob.type === 'choice' ? <select data-hima-control={`studio-knob-${name}`} value={knobs[name] ?? ''} onChange={(event) => setKnobs({ ...knobs, [name]: event.target.value })}>{knob.options.map((option) => <option key={option}>{option}</option>)}</select> : <input data-hima-control={`studio-knob-${name}`} value={knobs[name] ?? ''} onChange={(event) => setKnobs({ ...knobs, [name]: event.target.value })} />}<small>{field.hint}</small></label>; })}
    </div>
    <h4>Exploration budget</h4><div className='hima-fields'>{(['timeBox', 'retries', 'generations'] as const).map((name) => <label key={name}>{startForm[name].said}<input data-hima-control={`studio-${name}`} value={values[name] ?? ''} onChange={(event) => setValues({ ...values, [name]: event.target.value })} placeholder='Default' /></label>)}</div>
    <div className='hima-preflight' role='status' data-hima-region='studio-preflight' data-hima-state-status={checking ? 'checking' : checkPending.current ? 'unavailable' : prepared?.check?.fit ? 'fit' : 'unfit'}>{checking ? 'Checking Pack and Site…' : checkPending.current ? 'Preparation check unavailable; retry before starting.' : prepared?.check?.fit ? '✓ Pack and Site declarations match' : prepared?.preparation?.message ?? 'Pack and Site declarations need attention.'}{prepared?.check?.errors.map((message) => <p key={message}>{message}</p>)}</div>
    {error ? <div className='hima-notice' role='alert'><p>{error}</p><button type='button' className='hima-button' data-hima-control='studio-recheck' onClick={() => { checkPending.current = true; setCheckRevision((value) => value + 1); }}>Retry preparation check</button></div> : null}
    <div className='hima-start-footer'><button className='hima-button hima-primary' data-hima-control='studio-start' disabled={checking || checkPending.current || submitting || prepared?.check?.fit !== true}>{submitting ? 'Starting…' : 'Start experiment →'}</button><details><summary>Checks and data source</summary><p>{START_STATIC_LIMIT}</p></details></div>
  </form>;
}
