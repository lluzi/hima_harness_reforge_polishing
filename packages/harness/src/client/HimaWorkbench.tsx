// The existing Hima Run projection, presented inside the native dsh document dock.
// Local state is selection, drafts and the last HTTP response; the Agent requests work and Fabric validates its facts.
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import type { RunView } from '../remote.js';
import type { StartChoices } from '../workbench.js';
import { runPurposeMark, START_STATIC_LIMIT } from '../card-labels.js';
import { fetchExecutionContext, fetchRun, fetchRuns, fetchStartChoices, reviewPackTransfer, startCampaign, type HimaResult } from './api.js';
import { CampaignTab } from './CampaignTab.js';
import { RunControls, useRunActions } from './HimaRunCard.js';
import { Glyph } from './glyphs.js';

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
  const list = usePollingRead('runs', fetchRuns, tab.visible);
  const read = useCallback((signal: AbortSignal) => fetchRun(selected!, signal), [selected]);
  const snapshot = usePollingRead(selected ?? '', read, selected !== undefined && tab.visible && !creating);
  const readContext = useCallback((signal: AbortSignal) => fetchExecutionContext(selected!, signal), [selected]);
  const execution = usePollingRead(selected ?? '', readContext, selected !== undefined && tab.visible && !creating);
  const view = snapshot.value;
  const acting = useRunActions(selected, () => { snapshot.refresh(); list.refresh(); }, activeSessionId, view);

  useEffect(() => {
    if (requested !== undefined && !startPending.current) { setSelected(requested); setCreating(false); }
  }, [requested, tab.navigation.revision]);

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
    {creating ? <StartRunForm key={activeSessionId} sessionId={activeSessionId} onBusy={startBusy} onClose={() => { if (!startPending.current) setCreating(false); }} onStarted={(run) => { setSelected(run.run.id); setCreating(false); list.refresh(); snapshot.refresh(); setNotice(undefined); }} />
      : selected === undefined ? <div className='hima-empty'><div className='hima-empty-glyph'><Glyph name='ring' size={32} /></div><h3>Complete a chip-design Campaign.</h3><p>Keep coding and conversation available while HimaGuide prepares the inputs and the Campaign Agent executes the method.</p><button className='hima-button hima-primary' onClick={() => setCreating(true)}>Prepare a Campaign</button><p className='hima-small'>Choose an existing Campaign above, install a HimaPack, or connect a Site.</p></div>
        : <>
          {view === undefined ? null : <div className='hima-run-controls'><RunControls view={view} acting={acting} /></div>}
          <CampaignTab sessionId={activeSessionId} runId={selected} view={view} context={execution.value} stale={snapshot.error !== undefined} readAt={snapshot.at} openOwner={openOwner} openFiles={openFiles} refresh={() => { snapshot.refresh(); execution.refresh(); }} />
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
