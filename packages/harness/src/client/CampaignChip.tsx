// The Campaign chip (#41 task 8): one quiet control in the native session header, title-adjacent to
// the shell's own job list and agent-preset chips. Renders nothing for a Side Talk session — the one
// that owns no Run — so the header stays exactly as quiet as it always was for a conversation that
// never touched Campaign at all.
import type { ReactElement } from 'react';
import { labelled, runStatusLabel } from '../card-labels.js';
import { Glyph } from './glyphs.js';
import { STATUS_GLYPH, useOwnedRun } from './owned-run.js';
import { HIMA_STYLE } from './workbench-style.js';

export interface CampaignChipProps {
  readonly sessionId: string;
  openRun(runId: string): void;
}

/** Registered on `conversation.session.header.actions`. Standard session props deliver `sessionId`;
 *  `openRun` is this registration's own inject (`index.ts`). */
export function CampaignChip({ sessionId, openRun }: CampaignChipProps): ReactElement | null {
  const { run } = useOwnedRun(sessionId);
  if (run === undefined) return null;
  const status = run.status;
  const said = status === undefined ? 'no fabric state' : labelled(runStatusLabel, status).said;
  const waiting = status === 'waiting';
  return (
    <span className="hima-root">
      <style>{HIMA_STYLE}</style>
      <button type="button" className="hima-campaign-chip" data-hima-region="campaign-chip"
        data-hima-state-status={status ?? ''} data-hima-state-current={run.currentNode ?? ''} data-hima-state-waiting={String(waiting)}
        title={`Campaign — ${said}${run.currentNode === undefined ? '' : ` at ${run.currentNode}`}`}
        onClick={() => { openRun(run.id); }}>
        <Glyph name={status === undefined ? 'circle' : STATUS_GLYPH[status] ?? 'circle'} size={13} />
        <span>{said}</span>
        {run.currentNode === undefined ? null : <span className="hima-mono">{' · '}{run.currentNode}</span>}
        {waiting ? <span className="hima-campaign-chip-badge" aria-hidden="true" /> : null}
      </button>
    </span>
  );
}
