// The Campaign pane's Tool tab: the Site's own live tool display (today MAGE's xpra HTML5 session),
// framed in place. Modeled on `LibInsightAppPanel.tsx` — a first-look GET of the Host's forward
// status, an auto-open when it is `stopped`, a 15 s re-poll while visible, and an iframe pointed at
// the `localhost` URL the Host publishes. The difference is control: the view is view-only by
// default, a transparent shield over the frame swallowing every pointer event, and **Take control**
// lifts the shield so a person can click and type into the tool until they **Hand back**.
import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { ToolViewStatus } from '../tool-view.js';
import { fetchToolView, openToolView } from './api.js';
import { toolViewReaction, type ToolControl } from './tool-view-reaction.js';

export function ToolViewPanel({ sessionId, site, label, hidden }: {
  readonly sessionId: string; readonly site: string; readonly label: string; readonly hidden: boolean;
}): ReactElement {
  const [status, setStatus] = useState<ToolViewStatus>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [control, setControl] = useState<ToolControl>('viewing');
  const frame = useRef<HTMLIFrameElement>(null);
  const opening = useRef(false);

  // Fold a fresh forward status into the pane: `toolViewReaction` decides the control state (view-only
  // unless `ready`) in one tested place. The open decision belongs to the poll engine below, so a
  // status learned by any path — a poll, or the answer to `open()` itself — can set this without
  // risking a reopen loop.
  const applyStatus = (value: ToolViewStatus): void => {
    setStatus(value);
    setControl(previous => toolViewReaction(previous, value.state).control);
  };

  const open = async (restart?: boolean): Promise<void> => {
    if (opening.current) return;
    opening.current = true;
    setBusy(true); setError(undefined);
    const answer = await openToolView(sessionId, site, restart);
    opening.current = false;
    setBusy(false);
    if (!answer.ok) { setError(answer.error.message); return; }
    applyStatus(answer.value);
  };

  // One poll engine for the whole life of the pane. It keeps polling while visible for every live
  // state (`stopped`/`starting`/`ready`) so a forward that drops behind an open frame, or is restarted
  // from elsewhere, is followed to whatever it becomes — and a `stopped` one is reopened on its own,
  // instead of the pane sticking on "Opening…" for good. A failed forward (Retry only) and an
  // unavailable Site (no tab) stop the poll. The first look only reads status and opens a down forward,
  // so revealing this tab never restarts a session a person is already using. Re-keyed on the forward's
  // own state and url so Retry and a changed address restart the engine; a plain tab switch only hides.
  const state = status?.state;
  const readyUrl = status?.state === 'ready' ? status.url : undefined;
  useEffect(() => {
    if (hidden) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async (): Promise<void> => {
      const answer = await fetchToolView(sessionId, site);
      if (cancelled) return;
      // A transient status failure (Host restarting, network blip) is shown but never ends the engine:
      // the next tick looks again, so the pane heals once the Host answers.
      if (!answer.ok) { setError(answer.error.message); if (!cancelled) timer = setTimeout(() => { void tick(); }, 15_000); return; }
      const value = answer.value;
      applyStatus(value);
      // `open`/`poll` depend only on the forward's state, not on who holds control, so the control
      // argument here is immaterial; `applyStatus` is what carries the control reset.
      const reaction = toolViewReaction('viewing', value.state);
      if (reaction.open) void open();
      if (reaction.poll && !cancelled) timer = setTimeout(() => { void tick(); }, 15_000);
    };
    void tick();
    return () => { cancelled = true; if (timer !== undefined) clearTimeout(timer); };
  }, [hidden, sessionId, site, state, readyUrl]);

  const toggleControl = () => setControl(previous => {
    const next: ToolControl = previous === 'viewing' ? 'controlling' : 'viewing';
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
