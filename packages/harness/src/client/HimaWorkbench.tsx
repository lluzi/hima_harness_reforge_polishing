// The existing Hima Run projection, presented inside the native dsh document dock.
// Local state is selection, drafts and the last HTTP response; the Agent requests work and Fabric validates its facts.
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { fetchExecutionContext, fetchRun, fetchRuns, type HimaResult } from './api.js';
import { CampaignTab } from './CampaignTab.js';
import { ConfigurationPage } from './ConfigurationPage.js';
import { Diagnostics } from './Diagnostics.js';
import { useRunActions } from './HimaRunCard.js';
import { campaignEvents } from './owned-run.js';
import { PackOwnerPanel } from './PackOwnerPanel.js';
import { runPurposeMark } from '../card-labels.js';
import { Glyph } from './glyphs.js';

/** The public tab-info hook is supplied by the installed dsh sidebar slot; `tab.id` is the tab
 *  record's own stable identity, read here only to scope the `'diagnostics'` event (`owned-run.ts`)
 *  to the tab whose own menu opened it, never passed on as a control's own state. */
export interface WorkbenchProps {
  sessionId: string;
  useSessions<T>(selector: (state: { current?: string }) => T): T;
  openOwner(id: string): void;
  useTabInfo(): { tab: { id: string; visible: boolean; navigation: { revision: number; params: unknown } } };
  openFiles(): void;
  /** The shell's own composer, for "Ask HimaGuide" (#41 task 8); absent falls back to the native
   *  contenteditable `ConfigurationPage` already knows to write into. */
  inputActions?: { setDraft(text: string): void };
  /** The native folder picker, when the shell's own `uiWorkspace` service is installed. */
  pickFolder?: () => Promise<string | null>;
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

export function HimaWorkbench({ sessionId, useSessions, useTabInfo, openFiles, openOwner, inputActions, pickFolder }: WorkbenchProps): ReactElement {
  const activeSessionId = useSessions((state) => state.current) ?? sessionId;
  const { tab } = useTabInfo();
  const params = tab.navigation.params as { runId?: unknown } | undefined;
  const requested = typeof params?.runId === 'string' ? params.runId : undefined;
  const [selected, setSelected] = useState<string | undefined>(requested);
  const [managingPack, setManagingPack] = useState(false);
  const [managingPackLocation, setManagingPackLocation] = useState<string>();
  const [confirming, setConfirming] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const list = usePollingRead('runs', fetchRuns, tab.visible);
  const read = useCallback((signal: AbortSignal) => fetchRun(selected!, signal), [selected]);
  const snapshot = usePollingRead(selected ?? '', read, selected !== undefined && tab.visible);
  const readContext = useCallback((signal: AbortSignal) => fetchExecutionContext(selected!, signal), [selected]);
  const execution = usePollingRead(selected ?? '', readContext, selected !== undefined && tab.visible);
  const view = snapshot.value;
  const acting = useRunActions(selected, () => { snapshot.refresh(); list.refresh(); }, activeSessionId, view);
  const isOwner = view?.run.control === undefined || view.run.control.owner === activeSessionId;

  useEffect(() => {
    if (requested !== undefined) setSelected(requested);
  }, [requested, tab.navigation.revision]);

  // The tab's own menu (`open-diagnostics`, `index.ts`) dispatches this event with the tab's own id
  // rather than calling a prop directly: the menu item is a separate slot registration with no
  // component tree in common with this one, so a shared module-level target is the whole seam
  // (Design bar: "the Diagnostics open state lives in HimaWorkbench").
  useEffect(() => {
    const onDiagnostics = (event: Event) => {
      const detail = (event as CustomEvent<{ tabId?: string }>).detail;
      if (detail?.tabId === tab.id) setDiagnosticsOpen(true);
    };
    campaignEvents.addEventListener('diagnostics', onDiagnostics);
    return () => { campaignEvents.removeEventListener('diagnostics', onDiagnostics); };
  }, [tab.id]);

  const askGuide = inputActions ? (text: string) => { inputActions.setDraft(text); } : undefined;

  return <div className='hima-studio hima-root' data-hima-region='studio' data-hima-state-session={activeSessionId} data-hima-state-run={selected ?? ''} data-stale={snapshot.error !== undefined}>
    {/* The masthead and the session-header chip (`CampaignChip`) now carry Campaign's identity, so
        this header stays two small icon-labelled controls and nothing else — no "Campaign workspace"
        heading repeats what the chip and the tab title already say (Design bar). Both controls keep
        their established names and text: `studio-pack-owner` is a plain, always-present button rather
        than a tab-menu item, because the pack-owner desktop test drives it with one click and no menu
        it would first have to open. */}
    <header className='hima-studio-header'>
      <div className='hima-studio-header-actions'>
        <button className='hima-button' onClick={openFiles} title='Open the native workspace files and code panel'>Files & code</button>
        <button className='hima-button' data-hima-control='studio-pack-owner' onClick={() => setManagingPack((value) => !value)}>Pack & assets</button>
      </div>
    </header>
    <div className='hima-run-picker'>
      <span className='hima-studio-eyebrow'>CAMPAIGN</span>
      <select aria-label='Campaign on this host' data-hima-control='studio-run' disabled={confirming} value={selected ?? ''} onChange={(e) => { setSelected(e.target.value || undefined); }}>
        <option value=''>Select a Campaign</option>
        {selected && !list.value?.runs.some((run) => run.id === selected) ? <option value={selected}>{selected}</option> : null}
        {list.value?.runs.map((run) => <option key={run.id} value={run.id}>{run.packId ?? run.campaignId}{runPurposeMark(run.purpose) ? ` · ${runPurposeMark(run.purpose)}` : ''} · {shortTime(run.createdAt)} · {run.id.slice(-6)}</option>)}
      </select>
      <button className='hima-icon-button' aria-label='Refresh Run data' onClick={() => { list.refresh(); snapshot.refresh(); }}><Glyph name='retry' /></button>
      {selected !== undefined
        ? <button className='hima-button' data-hima-control='studio-configure' disabled={confirming} onClick={() => setSelected(undefined)}>Start another Campaign</button>
        : null}
    </div>
    {list.error ? <p className='hima-notice' role='status'>Run list unavailable: {list.error}</p> : null}
    {managingPack
      // The Pack owner panel replaces the Configuration page or the Live canvas below it rather than
      // stacking above it (review MINOR: "give the canvas its full height") — the two once shared one
      // scrollable column, which starved the Live canvas of the height its own camera fit depends on
      // the moment both were open, and is also what "close" toggling this same state on and off was
      // found not to reliably tear down while a second, independently polling section stayed mounted
      // beside it. Mutually exclusive rendering removes the concurrent-mount case entirely.
      ? <PackOwnerPanel key={activeSessionId} sessionId={activeSessionId} initialPack={view?.run.packId ?? ''} initialLocation={managingPackLocation} pickFolder={pickFolder} />
      : selected === undefined
        ? <ConfigurationPage key={activeSessionId} sessionId={activeSessionId}
            askGuide={askGuide} pickFolder={pickFolder}
            openPackOwner={(location) => { setManagingPackLocation(location); setManagingPack(true); }}
            onBusy={setConfirming}
            onStarted={(started) => { setSelected(started.run.id); list.refresh(); }} />
        : <CampaignTab sessionId={activeSessionId} runId={selected} view={view} context={execution.value} acting={acting} stale={snapshot.error !== undefined} readAt={snapshot.at} openOwner={openOwner} openFiles={openFiles} refresh={() => { snapshot.refresh(); execution.refresh(); }} />}
    {!diagnosticsOpen ? null : <Diagnostics view={view} isOwner={isOwner} acting={acting} readAt={snapshot.at} onClose={() => setDiagnosticsOpen(false)} />}
  </div>;
}

