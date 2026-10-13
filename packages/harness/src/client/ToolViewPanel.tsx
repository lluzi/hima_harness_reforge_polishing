// The Campaign pane's Tool tab: the Site's own live tool display (today MAGE's xpra HTML5 session),
// framed in place. Modeled on `LibInsightAppPanel.tsx` — a first-look GET of the Host's forward
// status, an auto-open when it is `stopped`, a 15 s re-poll while visible, and an iframe pointed at
// the `localhost` URL the Host publishes. The difference is control: the view is view-only by
// default, a transparent shield over the frame swallowing every pointer event, and **Take control**
// lifts the shield so a person can click and type into the tool until they **Hand back**.
import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { ToolViewStatus } from '../tool-view.js';
import { fetchToolView, openToolView } from './api.js';

/** Whether the person is only watching the tool, or driving it. Default `viewing` on every mount and
 *  whenever the forward leaves `ready`, so a frame that reloads or drops never lands a person in a
 *  live tool they did not ask to touch. */
type Control = 'viewing' | 'controlling';

export function ToolViewPanel({ sessionId, site, label, hidden }: {
  readonly sessionId: string; readonly site: string; readonly label: string; readonly hidden: boolean;
}): ReactElement {
  const [status, setStatus] = useState<ToolViewStatus>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [control, setControl] = useState<Control>('viewing');
  const frame = useRef<HTMLIFrameElement>(null);

  const open = async (restart?: boolean) => {
    setBusy(true); setError(undefined);
    const answer = await openToolView(sessionId, site, restart);
    setBusy(false);
    if (!answer.ok) { setError(answer.error.message); return; }
    setStatus(answer.value);
  };
  // The first look only reads the forward's status, and opens it when it is down — so revealing this
  // tab never restarts a session a person is already using, exactly as LibInsight's own panel does.
  useEffect(() => {
    if (hidden || status !== undefined) return;
    const controller = new AbortController();
    void fetchToolView(sessionId, site, controller.signal).then(answer => {
      if (controller.signal.aborted) return;
      if (!answer.ok) { setError(answer.error.message); return; }
      setStatus(answer.value);
      if (answer.value.state === 'stopped' || answer.value.state === 'starting') void open();
    });
    return () => controller.abort();
  }, [hidden, sessionId, site, status === undefined]);
  // A forward that dropped behind an open frame is followed to whatever it becomes, and one restarted
  // from elsewhere to its new address; a plain tab switch never triggers it (the frame is only hidden).
  const readyUrl = status?.state === 'ready' ? status.url : undefined;
  useEffect(() => {
    if (hidden || readyUrl === undefined) return;
    const timer = setInterval(() => {
      void fetchToolView(sessionId, site).then(answer => { if (answer.ok && (answer.value.state !== 'ready' || answer.value.url !== readyUrl)) setStatus(answer.value); });
    }, 15_000);
    return () => clearInterval(timer);
  }, [hidden, sessionId, site, readyUrl]);
  // Leaving `ready` — a reload, a drop, a restart — always hands control back to view-only.
  const state = status?.state;
  useEffect(() => { if (state !== 'ready') setControl('viewing'); }, [state]);

  const toggleControl = () => setControl(previous => {
    const next: Control = previous === 'viewing' ? 'controlling' : 'viewing';
    // Handing back takes the keyboard off the tool too, not only the mouse: the shield returns and
    // the frame is blurred so a key pressed afterwards never reaches it.
    if (next === 'viewing') frame.current?.blur();
    return next;
  });

  const ready = status?.state === 'ready' ? status : undefined;
  const failed = status?.state === 'failed' ? status : undefined;

  return <section className='hima-toolview' data-hima-region='toolview' data-hima-state-viewer={status?.state ?? 'loading'} data-hima-state-control={control} hidden={hidden}>
    <header className='hima-toolview-bar'>
      <span className='hima-studio-eyebrow'>{label.toUpperCase()}</span>
      {ready === undefined ? null : <span className='hima-small'>Live display of {label} on {site} {control === 'controlling' ? '· you are in control' : '· view only'}</span>}
      {ready === undefined ? null : <button type='button' className='hima-button' data-hima-control='tool-take-control' onClick={toggleControl}>{control === 'controlling' ? 'Hand back' : 'Take control'}</button>}
    </header>
    {error === undefined ? null : <p className='hima-notice' role='alert'>Tool view unavailable: {error}</p>}
    {ready !== undefined ? (
      <div className='hima-toolview-stage'>
        {/* `key` is the URL, so a changed forward reloads the frame but a tab switch (hidden, never
            unmounted) does not. The LibInsight sandbox minus `allow-downloads`, no `allow=`, and a
            no-referrer policy: a tool a person can drive still cannot pull files or reach the Host's
            own session by those paths. */}
        <iframe ref={frame} key={ready.url} className='hima-toolview-frame' src={ready.url} title={label}
          data-hima-control='tool-frame' tabIndex={-1}
          sandbox='allow-scripts allow-same-origin allow-forms' referrerPolicy='no-referrer'/>
        {control === 'viewing' ? <div className='hima-toolview-shield' aria-hidden='true' data-hima-control='tool-shield'/> : null}
      </div>
    ) : failed !== undefined ? (
      <div className='hima-toolview-note' role='alert'>
        <p>{failed.reason}</p>
        <button type='button' className='hima-button' disabled={busy} data-hima-control='tool-retry' onClick={() => { void open(true); }}>Retry</button>
        {failed.log.length === 0 ? null : <details><summary>Forward output</summary><pre>{failed.log}</pre></details>}
      </div>
    ) : (
      <p className='hima-toolview-note'>Opening the {label} tool view on {site}…</p>
    )}
  </section>;
}
