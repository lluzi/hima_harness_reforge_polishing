import { HimaViewerSession } from './viewer-session.js';
// The existing Hima Run projection, presented inside the native dsh document dock.
// Local state is selection, drafts and the last HTTP response; the Agent requests work and Fabric validates its facts.
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { fetchGuideContext, fetchExecutionContext, fetchRun, resolveReportAddress, type HimaResult } from './api.js';
import { CampaignTab } from './CampaignTab.js';
import { ConfigurationPage, draftToGuide } from './ConfigurationPage.js';
import { Diagnostics } from './Diagnostics.js';
import { useRunActions } from './HimaRunCard.js';
import { campaignEvents, isOwner as isOwnerOf, useRunsList } from './owned-run.js';
import { PackOwnerPanel } from './PackOwnerPanel.js';
import { runPurposeMark } from '../card-labels.js';
import { Glyph } from './glyphs.js';
import { shortTime } from './time.js';
import { HIMA_STYLE } from './workbench-style.js';
import { runIdForWorkbenchAddress, workbenchAddressKey, workbenchAddressOf, type WorkbenchAddress } from './workbench-address.js';

/** The public tab-info hook is supplied by the installed dsh sidebar slot; `tab.id` is the tab
 *  record's own stable identity, read here only to scope the `'diagnostics'` event (`owned-run.ts`)
 *  to the tab whose own menu opened it, never passed on as a control's own state. */
export interface WorkbenchProps {
  sessionId: string;
  useSessions<T>(selector: (state: { current?: string }) => T): T;
  openOwner(id: string): void;
  openChild(address: { parentSessionId: string; childSessionId: string; mode: 'one-shot' | 'continuable' }): void;
  useTabInfo(): { tab: { id: string; visible: boolean; navigation: { revision: number; params: unknown } } };
  openFiles(): void;
  /** The shell's own composer, for "Ask HimaGuide" (#41 task 8); absent falls back to the native
   *  contenteditable `ConfigurationPage` already knows to write into.
   *
   *  C19: `getDraft` is optional because not every shell version that offers `setDraft` also offers
   *  a way to read the composer's own current text back — `askGuide` (below) only ever appends
   *  through `setDraft` when it can first read what is already there; otherwise it drops straight to
   *  the same caret-insert fallback an absent `inputActions` uses, rather than call `setDraft` blind
   *  and silently discard whatever a person had already begun typing. */
  inputActions?: { setDraft(text: string): void; getDraft?(): string };
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

export function HimaWorkbench({ sessionId, useSessions, useTabInfo, openFiles, openOwner, openChild, inputActions, pickFolder }: WorkbenchProps): ReactElement {
  const activeSessionId = useSessions((state) => state.current) ?? sessionId;
  const { tab } = useTabInfo();
  const requestedAddress = workbenchAddressOf(tab.navigation.params);
  const [address, setAddress] = useState<WorkbenchAddress>(requestedAddress);
  const lastCampaignAddress = useRef<WorkbenchAddress>(requestedAddress.kind === 'campaign' ? requestedAddress : { kind: 'campaign' });
  const lastInsightAddress = useRef<WorkbenchAddress>(requestedAddress.kind === 'insight' ? requestedAddress : { kind: 'insight' });
  const selected = runIdForWorkbenchAddress(address);
  const [managingPack, setManagingPack] = useState(false);
  const [managingPackLocation, setManagingPackLocation] = useState<string>();
  const [confirming, setConfirming] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  // Bug 3 fix: the top-level "Refresh Run data" button used to only bump `snapshot`/`list`, both of
  // which this page never reads while no Run is selected (`selected === undefined`, exactly the
  // state `ConfigurationPage` renders in) — so on the Configuration page that click was a no-op, and
  // a stale readiness row only cleared through its own row-level "Retry". This is handed to
  // `ConfigurationPage` as `refreshSignal`, which its own poll effect re-runs on every change.
  const [configRefresh, setConfigRefresh] = useState(0);
  const list = useRunsList(activeSessionId);
  const read = useCallback((signal: AbortSignal) => fetchRun(selected!, signal, activeSessionId), [selected, activeSessionId]);
  const runReadKey = JSON.stringify([activeSessionId, selected ?? '']);
  const snapshot = usePollingRead(runReadKey, read, selected !== undefined && tab.visible);
  const readContext = useCallback((signal: AbortSignal) => fetchExecutionContext(selected!, signal, activeSessionId), [selected, activeSessionId]);
  const execution = usePollingRead(runReadKey, readContext, selected !== undefined && tab.visible);
  const view = snapshot.value;
  const acting = useRunActions(selected, () => { snapshot.refresh(); list.refresh(); }, activeSessionId, view);
  const isOwner = isOwnerOf(view?.run.control, activeSessionId);
  const [childCheck, setChildCheck] = useState<{ key: string; ready: boolean; error?: string; nativeAddress?: { parentSessionId: string; childSessionId: string; mode: 'one-shot' | 'continuable' } }>({ key: '', ready: false });
  const [childRefresh, setChildRefresh] = useState(0);
  const childKey = address.kind === 'child' ? JSON.stringify([activeSessionId, workbenchAddressKey(address)]) : '';
  useEffect(() => {
    if (address.kind !== 'child' || !tab.visible) return;
    const controller = new AbortController();
    setChildCheck({ key: childKey, ready: false });
    void fetchGuideContext({ sessionId: activeSessionId, requestId: `child-${crypto.randomUUID()}`, target: { kind: 'child', parentSessionId: address.parentSessionId, childSessionId: address.childSessionId } }, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      if (!result.ok || result.value.target.kind !== 'child' || result.value.target.parentSessionId !== address.parentSessionId || result.value.target.childSessionId !== address.childSessionId) {
        setChildCheck({ key: childKey, ready: false, error: result.ok ? 'The Host returned a different child identity.' : result.error.message }); return;
      }
      const facts = result.value.facts as { nativeAddress?: { parentSessionId: string; childSessionId: string; mode: 'one-shot' | 'continuable' } } | undefined;
      setChildCheck({ key: childKey, ready: true, ...(facts?.nativeAddress === undefined ? {} : { nativeAddress: facts.nativeAddress }) });
    });
    return () => controller.abort();
  }, [activeSessionId, address, childKey, childRefresh, tab.visible]);

  useEffect(() => {
    if (requestedAddress.kind === 'campaign') lastCampaignAddress.current = requestedAddress;
    if (requestedAddress.kind === 'insight') lastInsightAddress.current = requestedAddress;
    setAddress(requestedAddress);
  }, [tab.navigation.revision, workbenchAddressKey(requestedAddress)]);

  const chooseCampaign = (next: WorkbenchAddress) => {
    lastCampaignAddress.current = next;
    setAddress(next);
  };

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

  // C19: append to whatever draft the composer already holds, never replace it silently — only
  // possible when the composer also exposes `getDraft`; without it, this falls through to the exact
  // same caret-insert fallback (`draftToGuide`) an absent `inputActions` prop already uses, which is
  // always append-safe on a plain contenteditable regardless of what the shell exposes.
  const askGuide = inputActions ? (text: string) => {
    const existing = inputActions.getDraft?.();
    if (existing === undefined) { draftToGuide(text); return; }
    inputActions.setDraft(existing === '' ? text : `${existing}\n${text}`);
  } : undefined;

  return <HimaViewerSession value={activeSessionId}><div className='hima-studio hima-root' data-hima-region='studio' data-hima-state-session={activeSessionId} data-hima-state-mode={address.kind} data-hima-state-run={selected ?? ''} data-stale={snapshot.error !== undefined}>
    {/* C8: this is `sidebar.right.pane.tab`'s own root mount, a separate tree from `CampaignChip`,
        `CampaignTabTitle` and `WorkbenchEntry`, each of which already carries its own `<style>` copy
        (`index.ts`) — this root carried `hima-root` but never the sheet itself, so no `--hima-*`
        token actually resolved inside the whole Campaign tab body. Same hardening as the transcript
        receipt (`HimaRunCard.tsx`). */}
    <style>{HIMA_STYLE}</style>
    {/* The masthead and the session-header chip (`CampaignChip`) now carry Campaign's identity, so
        this header names no "Campaign workspace" heading of its own (Design bar) — one 40 px row:
        the CAMPAIGN picker at the left, `Files & code`/`Pack & assets` at the right. A separate,
        otherwise-empty band above this one for only those two buttons was Task 9's own design
        review finding (a blank strip with nothing in it but two right-aligned buttons); merging
        loses no control and no marker. Both controls keep their established names and text:
        `studio-pack-owner` is a plain, always-present button rather than a tab-menu item, because
        the pack-owner desktop test drives it with one click and no menu it would first have to
        open, and `Files & code`'s own visible text is what `markText('button', 'Files & code', …)`
        matches in the existing desktop suites — restyled compact (`.hima-icon-button`) here, never
        replaced with an icon-only control that text could not still match. */}
    <header className='hima-studio-header'>
      <div className='hima-studio-modes' role='tablist' aria-label='Hima work mode'>
        <button type='button' role='tab' aria-selected={address.kind === 'campaign'} data-hima-control='studio-mode-campaign' onClick={() => setAddress(lastCampaignAddress.current)}>Campaign</button>
        <button type='button' role='tab' aria-selected={address.kind === 'insight'} data-hima-control='studio-mode-insight' onClick={() => setAddress(lastInsightAddress.current)}>Data Insight</button>
      </div>
      {address.kind !== 'campaign' ? null : <select aria-label='Campaign on this host' data-hima-control='studio-run' disabled={confirming} value={selected ?? ''} onChange={(e) => { chooseCampaign({ kind: 'campaign', ...(e.target.value === '' ? {} : { runId: e.target.value }) }); }}>
        <option value=''>Select a Campaign</option>
        {selected && !list.runs.some((run) => run.id === selected) ? <option value={selected}>{selected}</option> : null}
        {list.runs.map((run) => <option key={run.id} value={run.id}>{run.packId ?? run.campaignId}{runPurposeMark(run.purpose) ? ` · ${runPurposeMark(run.purpose)}` : ''} · {shortTime(run.createdAt)} · {run.id.slice(-6)}</option>)}
      </select>}
      {address.kind !== 'campaign' ? null : <button className='hima-icon-button' aria-label='Refresh Run data' onClick={() => { list.refresh(); snapshot.refresh(); setConfigRefresh((n) => n + 1); }}><Glyph name='retry' /></button>}
      {address.kind === 'campaign' && selected !== undefined ? <button className='hima-button' data-hima-control='studio-configure' disabled={confirming} onClick={() => chooseCampaign({ kind: 'campaign' })}>Start another Campaign</button> : null}
      <div className='hima-studio-header-actions'>
        {/* C19: bordered `.hima-button`s, not the borderless `.hima-icon-button` this row's earlier
            compacting pass reached for — both read as text-only actions inside a row that already
            carries a select and an icon-only refresh control, and the missing border made them easy
            to miss beside those. Same markers, same visible text. */}
        <button className='hima-button' onClick={openFiles} title='Open the native workspace files and code panel'>Files & code</button>
        <button className='hima-button' data-hima-control='studio-pack-owner' onClick={() => setManagingPack((value) => !value)}>Pack & assets</button>
      </div>
    </header>
    {list.error ? <p className='hima-notice' role='status'>Run list unavailable: {list.error}</p> : null}
    {managingPack
      // The Pack owner panel replaces the Configuration page or the Live canvas below it rather than
      // stacking above it (review MINOR: "give the canvas its full height") — the two once shared one
      // scrollable column, which starved the Live canvas of the height its own camera fit depends on
      // the moment both were open, and is also what "close" toggling this same state on and off was
      // found not to reliably tear down while a second, independently polling section stayed mounted
      // beside it. Mutually exclusive rendering removes the concurrent-mount case entirely.
      ? <PackOwnerPanel key={activeSessionId} sessionId={activeSessionId} initialPack={view?.run.packId ?? ''} initialLocation={managingPackLocation} pickFolder={pickFolder} />
      : address.kind === 'invalid'
        ? <InvalidAddress message={address.message} />
        : address.kind === 'insight'
        ? <InsightPreparation scope={address.scope} reportRef={address.reportRef} />
        : address.kind === 'child'
          ? <ChildUnavailable parentSessionId={address.parentSessionId} childSessionId={address.childSessionId} openChild={openChild} nativeAddress={childCheck.key === childKey ? childCheck.nativeAddress : undefined} checked={childCheck.key === childKey && childCheck.ready} error={childCheck.key === childKey ? childCheck.error : undefined} retry={() => setChildRefresh(value => value + 1)} />
        : selected === undefined
        ? <ConfigurationPage key={activeSessionId} sessionId={activeSessionId}
            askGuide={askGuide} pickFolder={pickFolder}
            openPackOwner={(location) => { setManagingPackLocation(location); setManagingPack(true); }}
            onBusy={setConfirming} refreshSignal={configRefresh}
            onStarted={(started) => { chooseCampaign({ kind: 'campaign', runId: started.run.id }); list.refresh(); }} />
        : <CampaignTab sessionId={activeSessionId} runId={selected} view={view} context={execution.value} acting={acting} stale={snapshot.error !== undefined} readAt={snapshot.at} openOwner={openOwner} openFiles={openFiles} />}
    {!diagnosticsOpen ? null : <Diagnostics view={view} isOwner={isOwner} acting={acting} readAt={snapshot.at} openOwner={openOwner} onClose={() => setDiagnosticsOpen(false)} />}
  </div></HimaViewerSession>;
}

function InsightPreparation({ scope, reportRef }: { scope?: string; reportRef?: string }): ReactElement {
  return <section className='hima-insight-preparation' data-hima-region='insight-preparation' data-hima-state-report={reportRef ?? ''}>
    <span className='hima-studio-eyebrow'>DATA INSIGHT</span>
    <h2>{reportRef === undefined ? 'Choose data to inspect' : 'Report data is not available in this Host yet'}</h2>
    <p>{reportRef === undefined ? 'Choose a Library report or data scope. Browsing this preparation page does not create a Campaign, start a Job, or call a model.' : `The selected report reference ${reportRef} still needs the Host’s typed, hash-bound report payload.`}</p>
    {scope === undefined ? null : <p className='hima-small'>Requested scope: {scope}</p>}
  </section>;
}

function InvalidAddress({ message }: { message: string }): ReactElement {
  return <section className='hima-insight-preparation' data-hima-region='invalid-view-address' role='alert'>
    <span className='hima-studio-eyebrow'>WORKBENCH ADDRESS</span>
    <h2>hima/invalid-view-address</h2>
    <p>{message}</p>
  </section>;
}

function ChildUnavailable({ parentSessionId, childSessionId, openChild, nativeAddress, checked, error, retry }: { parentSessionId: string; childSessionId: string; openChild(address: { parentSessionId: string; childSessionId: string; mode: 'one-shot' | 'continuable' }): void; nativeAddress?: { parentSessionId: string; childSessionId: string; mode: 'one-shot' | 'continuable' }; checked: boolean; error?: string; retry(): void }): ReactElement {
  return <section className='hima-insight-preparation' data-hima-region='child-unavailable'>
    <span className='hima-studio-eyebrow'>AGENT TASK</span>
    <h2>Child details need an authorized Host view</h2>
    <p>{checked ? 'This shell keeps the original child identity and does not copy a transcript. Native transcript availability is owned by the session UI.' : error ?? 'Checking the child identity with the Host…'}</p>
    {checked && nativeAddress ? <button type='button' className='hima-button' onClick={() => openChild(nativeAddress)}>Open child session</button> : checked ? <p className='hima-small'>Native catalog has no usable descriptor for this child.</p> : error ? <button type='button' className='hima-button' data-hima-control='child-retry' onClick={retry}>Retry</button> : null}
    <p className='hima-small'>Parent: {parentSessionId}</p>
  </section>;
}
