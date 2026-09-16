// The Diagnostics sheet (#41 task 8): the one place a Run id, an owner session's UUID, its epoch and
// revision appear (Design bar) — everything the masthead and the chip deliberately leave out because
// a person reading the canvas needs the seal word and the node, never the ledger's own bookkeeping.
// Opened from the tab's own menu (`open-diagnostics`) or closed by Escape or `diagnostics-close`.
import { useEffect, useState, type ReactElement } from 'react';
import { meterRows } from '../card-labels.js';
import type { RunView } from '../remote.js';
import type { Acting } from './HimaRunCard.js';
import { useLastLogLine } from './FabricNode.js';
import { Glyph } from './glyphs.js';

/** Shown in place of the current Job's own last shell line when the Run has none right now: it is
 *  not running, or it is running a node with no Job open. */
const NO_JOB_LINE = 'No Job output line is available for this Run right now.';

export interface DiagnosticsProps {
  readonly view: RunView | undefined;
  readonly isOwner: boolean;
  readonly acting: Acting;
  /** When `view` was last read successfully — the sheet's own "last Ledger read" line. */
  readonly readAt?: number;
  onClose(): void;
}

type ConfirmKey = 'diagnostics-pause' | 'diagnostics-stop';

const shortTime = (at: number): string => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export function Diagnostics({ view, isOwner, acting, readAt, onClose }: DiagnosticsProps): ReactElement {
  const [confirming, setConfirming] = useState<ConfirmKey>();

  // Escape closes the sheet; `stopPropagation` so an outer Escape handler (the node card's own) does
  // not also react to the same key press this sheet already took.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const run = view?.run;
  const control = run?.control;
  const active = run?.status === 'running' || run?.status === 'waiting';
  const currentNode = run?.currentNode;
  const line = useLastLogLine(run?.id ?? '', currentNode ?? '', active === true && currentNode !== undefined);
  const rows = view === undefined ? [] : meterRows(view);

  const toggle = (key: ConfirmKey) => setConfirming((current) => (current === key ? undefined : key));
  const confirmBlock = (key: ConfirmKey, sentence: string, confirmLabel: string, onConfirm: () => void) => (
    confirming !== key ? null : (
      <div className="hima-node-card-confirm" data-hima-region={`${key}-confirm`}>
        <p>{sentence}</p>
        <div className="hima-node-card-footer-row">
          <button type="button" className="hima-button hima-primary" data-hima-control={`${key}-confirm`} disabled={acting.inFlight !== undefined} onClick={() => { onConfirm(); setConfirming(undefined); }}>{confirmLabel}</button>
          <button type="button" className="hima-button" onClick={() => setConfirming(undefined)}>Cancel</button>
        </div>
      </div>
    )
  );

  return (
    <div className="hima-diagnostics" data-hima-region="campaign-diagnostics" role="dialog" aria-label="Diagnostics">
      <header className="hima-diagnostics-header">
        <span className="hima-studio-eyebrow">Diagnostics</span>
        <button type="button" className="hima-icon-button" data-hima-control="diagnostics-close" aria-label="Close diagnostics" onClick={onClose}><Glyph name="close" /></button>
      </header>
      {run === undefined ? <p className="hima-small">Choose a Campaign to see its diagnostics.</p> : (
        <>
          <dl className="hima-diagnostics-facts">
            <dt>Run id</dt><dd className="hima-mono">{run.id}</dd>
            <dt>Owner session</dt><dd className="hima-mono">{control?.owner ?? '—'}</dd>
            <dt>Epoch</dt><dd className="hima-mono">{control?.epoch ?? '—'}</dd>
            <dt>Revision</dt><dd className="hima-mono">{control?.revision ?? '—'}</dd>
          </dl>
          {rows.length === 0 ? null : (
            <div className="hima-diagnostics-meters">
              {rows.map((row) => <p key={row.key} className="hima-small">{row.said}</p>)}
            </div>
          )}
          <p className="hima-small">Last Ledger read: {readAt === undefined ? 'never' : shortTime(readAt)}</p>
          <pre className="hima-diagnostics-line">{line ?? NO_JOB_LINE}</pre>
          {isOwner ? null : (
            <div className="hima-diagnostics-emergency" data-hima-region="diagnostics-emergency">
              <p className="hima-node-card-owner">Owned by Campaign Agent{control?.owner === undefined ? '' : ` ${control.owner.slice(-6)}`}</p>
              {!active ? null : (
                <div className="hima-node-card-footer-row">
                  <button type="button" className="hima-button" data-hima-control="diagnostics-pause" disabled={acting.inFlight !== undefined} onClick={() => toggle('diagnostics-pause')}>Pause run</button>
                  <button type="button" className="hima-button" data-hima-control="diagnostics-stop" disabled={acting.inFlight !== undefined} onClick={() => toggle('diagnostics-stop')}>Stop run</button>
                </div>
              )}
              {confirmBlock('diagnostics-pause', 'Jobs already running will continue; no new work starts anywhere in this run.', 'Confirm pause', () => { acting.act('pause'); })}
              {confirmBlock('diagnostics-stop', 'This asks every Job this run holds to stop; work already running may take a moment to end.', 'Confirm stop', () => { acting.act('cancel'); })}
              {acting.notice === undefined ? null : <p role="status">{acting.notice}</p>}
              {acting.refusal === undefined ? null : <p role="alert" data-hima-region="run-error">{acting.refusal.message}</p>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
