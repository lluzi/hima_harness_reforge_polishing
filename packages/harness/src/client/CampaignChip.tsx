// The Campaign chip (#41 task 8): one quiet control in the native session header, title-adjacent to
// the shell's own job list and agent-preset chips. Renders nothing for a Side Talk session — the one
// that owns no Run — so the header stays exactly as quiet as it always was for a conversation that
// never touched Campaign at all.
import type { ReactElement } from 'react';
import { Glyph } from './glyphs.js';
import { statusSaid, STATUS_GLYPH, useOwnedRun } from './owned-run.js';
import { HIMA_STYLE } from './workbench-style.js';

export interface CampaignChipProps {
  readonly sessionId: string;
  openRun(runId: string): void;
}

/** Registered on `conversation.session.header.actions`. Standard session props deliver `sessionId`;
 *  `openRun` is this registration's own inject (`index.ts`). */
export function CampaignChip({ sessionId, openRun }: CampaignChipProps): ReactElement | null {
  const { run, stale } = useOwnedRun(sessionId);
  if (run === undefined) return null;
  const status = run.status;
  const said = statusSaid(status);
  const waiting = status === 'waiting';
  // A stale read keeps showing the last known state (never blanks or collapses it) — the same rule
  // the tab title follows — dimmed by CSS off `data-hima-state-stale`, with the tooltip saying so.
  const title = `Campaign — ${said}${run.currentNode === undefined ? '' : ` at ${run.currentNode}`}`
    + (stale ? ' — the last read did not answer; showing the last known state' : '');
  return (
    // C9: `hima-campaign-chip-wrap` keeps this mount from stretching to fill the shell's own header
    // actions flexbox — without it, the chip collided with the shell's own header chips beside it
    // (`running-node-card-light.png`) rather than sitting at its own natural width.
    <span className="hima-root hima-campaign-chip-wrap">
      <style>{HIMA_STYLE}</style>
      <button type="button" className="hima-campaign-chip" data-hima-region="campaign-chip"
        data-hima-state-status={status ?? ''} data-hima-state-current={run.currentNode ?? ''} data-hima-state-waiting={String(waiting)}
        data-hima-state-stale={String(stale)}
        title={title}
        onClick={() => { openRun(run.id); }}>
        <Glyph name={status === undefined ? 'circle' : STATUS_GLYPH[status]} size={13} />
        <span>{said}</span>
        {run.currentNode === undefined ? null : <span className="hima-mono hima-campaign-chip-node">{' · '}{run.currentNode}</span>}
        {waiting ? <span className="hima-campaign-chip-badge" aria-hidden="true" /> : null}
      </button>
    </span>
  );
}
