// Data Insight's LibInsight pages, shown in place (ADR-0019). The pages are LibInsight's own web app,
// served by the Host's one local viewer process; this panel asks where it is, frames it, and offers
// the three things a person can change here: the data folder, a reload, and a restart.
import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import type { LibInsightViewerStatus } from '../libinsight-viewer.js';
import { fetchLibInsightViewer, openLibInsightViewer } from './api.js';

const folderName = (folder: string) => folder.split(/[\\/]/).filter(Boolean).slice(-2).join('/') || folder;

export function LibInsightAppPanel({ sessionId, hidden, pickFolder, onShowReports }: { readonly sessionId: string; readonly hidden: boolean; readonly pickFolder?: () => Promise<string | null>; onShowReports(): void }): ReactElement {
  const [status, setStatus] = useState<LibInsightViewerStatus>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [draft, setDraft] = useState('');
  const [reload, setReload] = useState(0);

  const open = async (request: { dataFolder?: string; restart?: boolean } = {}) => {
    setBusy(true); setError(undefined);
    if (request.dataFolder !== undefined || request.restart) setStatus(current => current === undefined || current.state === 'unavailable' ? current : { state: 'starting', code: current.code, dataFolder: request.dataFolder ?? current.dataFolder });
    const answer = await openLibInsightViewer({ sessionId, ...request });
    setBusy(false);
    if (!answer.ok) { setError(answer.error.message); return; }
    setStatus(answer.value);
    if (answer.value.state === 'ready') { setChoosing(false); setReload(value => value + 1); }
  };
  // The first look starts the viewer on the remembered folder; a later look only reads its status,
  // so switching back to this tab never restarts LibInsight under a person's open page.
  useEffect(() => {
    if (hidden || status !== undefined) return;
    const controller = new AbortController();
    void fetchLibInsightViewer(sessionId, controller.signal).then(answer => {
      if (controller.signal.aborted) return;
      if (!answer.ok) { setError(answer.error.message); return; }
      if (answer.value.state === 'ready') { setStatus(answer.value); return; }
      if (answer.value.state === 'stopped' || answer.value.state === 'starting') { setStatus(answer.value); void open(); return; }
      setStatus(answer.value);
    });
    return () => controller.abort();
  }, [hidden, sessionId, status === undefined]);
  // A viewer that stopped behind an open page is shown as stopped, not as a blank frame; one
  // restarted from another view is followed to its new address.
  const readyUrl = status?.state === 'ready' ? status.url : undefined;
  useEffect(() => {
    if (hidden || readyUrl === undefined) return;
    const timer = setInterval(() => {
      void fetchLibInsightViewer(sessionId).then(answer => { if (answer.ok && (answer.value.state !== 'ready' || answer.value.url !== readyUrl)) setStatus(answer.value); });
    }, 15_000);
    return () => clearInterval(timer);
  }, [hidden, sessionId, readyUrl]);

  // The shell's picker answers null when it has no workspace picker to offer (or the person closed
  // it), so a typed path is always the way that remains, never a click that does nothing.
  const choose = async () => {
    const picked = pickFolder ? await pickFolder().catch(() => null) : null;
    if (picked) { await open({ dataFolder: picked }); return; }
    setChoosing(true);
  };
  const submit = (event: FormEvent) => { event.preventDefault(); if (draft.trim() !== '') void open({ dataFolder: draft.trim() }); };
  const folder = status !== undefined && 'dataFolder' in status ? status.dataFolder : undefined;
  const code = status !== undefined && 'code' in status ? status.code : undefined;

  return <section className='hima-libinsight' data-hima-region='libinsight' data-hima-state-viewer={status?.state ?? 'loading'} hidden={hidden}>
    <header className='hima-libinsight-bar'>
      <span className='hima-studio-eyebrow'>LIBINSIGHT</span>
      {folder === undefined ? null : <span className='hima-small' title={folder}>Data: {folderName(folder)}</span>}
      {code?.commit === undefined ? null : <span className='hima-small' title={`${code.source ?? 'LibInsight'} @ ${code.commit}`}>Version {code.commit.slice(0, 8)}</span>}
      <div className='hima-libinsight-actions'>
        <button type='button' className='hima-button' data-hima-control='libinsight-choose-data' disabled={busy || status?.state === 'unavailable' && code === undefined} onClick={() => { void choose(); }}>Data folder…</button>
        <button type='button' className='hima-button' data-hima-control='libinsight-reload' disabled={status?.state !== 'ready'} onClick={() => setReload(value => value + 1)}>Reload pages</button>
        <button type='button' className='hima-button' data-hima-control='libinsight-restart' disabled={busy || code === undefined || folder === undefined} onClick={() => { void open({ restart: true }); }}>Restart viewer</button>
        <button type='button' className='hima-button' data-hima-control='insight-show-reports' onClick={onShowReports}>Retained reports</button>
      </div>
    </header>
    {choosing ? <form className='hima-report-selector hima-libinsight-chooser' onSubmit={submit}><label>LibInsight data folder (holds app.json)<input data-hima-control='libinsight-data-folder' value={draft} onChange={event => setDraft(event.target.value)} placeholder={folder ?? '/path/to/lib_insight/data'}/></label><button type='submit' className='hima-button' disabled={busy || draft.trim() === ''}>Open</button><button type='button' className='hima-button' onClick={() => setChoosing(false)}>Cancel</button></form> : null}
    {error === undefined ? null : <p className='hima-notice' role='alert'>LibInsight unavailable: {error}</p>}
    {status === undefined ? <p className='hima-libinsight-note'>Looking for the LibInsight viewer…</p>
      : status.state === 'ready' ? <iframe key={`${status.url}#${String(reload)}`} className='hima-libinsight-frame' src={status.url} title='LibInsight' data-hima-control='libinsight-frame'
          sandbox='allow-scripts allow-same-origin allow-forms allow-downloads' referrerPolicy='no-referrer'/>
      : status.state === 'starting' || status.state === 'stopped' ? <p className='hima-libinsight-note'>Starting LibInsight on {folderName(status.dataFolder)}… Large Kits are read before the first page.</p>
      : status.state === 'unavailable' ? <div className='hima-libinsight-note' role='status'><p>{status.reason}</p>{code === undefined ? null : <button type='button' className='hima-button' onClick={() => { void choose(); }}>Choose data folder…</button>}</div>
      : <div className='hima-libinsight-note' role='alert'><p>{status.reason}</p><button type='button' className='hima-button' disabled={busy} onClick={() => { void open({ restart: true }); }}>Try again</button>
          {status.log.length === 0 ? null : <details><summary>Viewer output</summary><pre>{status.log.join('\n')}</pre></details>}</div>}
  </section>;
}
