// The existing Hima Run projection, presented inside the native dsh document dock.
// Local state is selection, drafts and the last HTTP response; the Agent requests work and Fabric validates its facts.
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { fetchExecutionContext, fetchRun, fetchRuns, type HimaResult } from './api.js';
import { CampaignTab } from './CampaignTab.js';
import { ConfigurationPage } from './ConfigurationPage.js';
import { useRunActions } from './HimaRunCard.js';
import { PackOwnerPanel } from './PackOwnerPanel.js';
import { runPurposeMark } from '../card-labels.js';
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
  const [managingPack, setManagingPack] = useState(false);
  const list = usePollingRead('runs', fetchRuns, tab.visible);
  const read = useCallback((signal: AbortSignal) => fetchRun(selected!, signal), [selected]);
  const snapshot = usePollingRead(selected ?? '', read, selected !== undefined && tab.visible);
  const readContext = useCallback((signal: AbortSignal) => fetchExecutionContext(selected!, signal), [selected]);
  const execution = usePollingRead(selected ?? '', readContext, selected !== undefined && tab.visible);
  const view = snapshot.value;
  const acting = useRunActions(selected, () => { snapshot.refresh(); list.refresh(); }, activeSessionId, view);

  useEffect(() => {
    if (requested !== undefined) setSelected(requested);
  }, [requested, tab.navigation.revision]);

  return <div className='hima-studio hima-root' data-hima-region='studio' data-hima-state-session={activeSessionId} data-hima-state-run={selected ?? ''} data-stale={snapshot.error !== undefined}>
    <header className='hima-studio-header'>
      <div><h2>Campaign workspace</h2></div>
      <button className='hima-button' onClick={openFiles} title='Open the native workspace files and code panel'>Files & code</button>
      <button className='hima-button' data-hima-control='studio-pack-owner' onClick={() => setManagingPack(value => !value)}>Pack & assets</button>
    </header>
    <div className='hima-run-picker'>
      <span className='hima-studio-eyebrow'>CAMPAIGN</span>
      <select aria-label='Campaign on this host' data-hima-control='studio-run' value={selected ?? ''} onChange={(e) => { setSelected(e.target.value || undefined); }}>
        <option value=''>Select a Campaign</option>
        {selected && !list.value?.runs.some((run) => run.id === selected) ? <option value={selected}>{selected}</option> : null}
        {list.value?.runs.map((run) => <option key={run.id} value={run.id}>{run.packId ?? run.campaignId}{runPurposeMark(run.purpose) ? ` · ${runPurposeMark(run.purpose)}` : ''} · {shortTime(run.createdAt)} · {run.id.slice(-6)}</option>)}
      </select>
      <button className='hima-icon-button' aria-label='Refresh Run data' onClick={() => { list.refresh(); snapshot.refresh(); }}><Glyph name='retry' /></button>
    </div>
    {list.error ? <p className='hima-notice' role='status'>Run list unavailable: {list.error}</p> : null}
    {managingPack ? <PackOwnerPanel key={activeSessionId} sessionId={activeSessionId} initialPack={view?.run.packId ?? ''} /> : null}
    {selected === undefined
      ? <ConfigurationPage key={activeSessionId} sessionId={activeSessionId} openPackOwner={() => setManagingPack(true)} onStarted={(started) => { setSelected(started.run.id); list.refresh(); }} />
      : <CampaignTab sessionId={activeSessionId} runId={selected} view={view} context={execution.value} acting={acting} stale={snapshot.error !== undefined} readAt={snapshot.at} openOwner={openOwner} openFiles={openFiles} refresh={() => { snapshot.refresh(); execution.refresh(); }} />}
  </div>;
}

