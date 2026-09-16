// The Campaign tab's one-line masthead (66 px): the Campaign's name, its status seal word, the node
// it stands at, its generation, an elapsed figure that ticks once a second while the Run is running,
// and where its Budget stands. A non-owner session sees who owns the Run and one way to reach them,
// and no business control — Task 6 adds emergency Pause/Stop to the card footer and the Diagnostics
// sheet, never here.
import { useEffect, useState, type ReactElement } from 'react';
import type { ExecutionContext } from '../fabric.js';
import type { RunView } from '../remote.js';
import { duration, labelled, runPurposeMark, runStatusLabel } from '../card-labels.js';

/** The Budget standing, in the one word the mockup's own sub-line uses beside the elapsed figure —
 *  read from `ExecutionContext.budget.phase` (`budgetStanding`'s own live computation), because
 *  nothing in `RunMeters` states whether a Run is still active, spending its closing reserve, or
 *  already exhausted; only the execution context knows that right now. */
const BUDGET_STANDING: Readonly<Record<ExecutionContext['budget']['phase'], string>> = {
  active: 'budget active', closing: 'budget closing reserve', exhausted: 'budget exhausted',
};

export interface MastheadProps {
  /** The file's own name (Task 7); the campaign id stands in until then. */
  readonly name?: string;
  readonly view: RunView | undefined;
  readonly context: ExecutionContext | undefined;
  readonly stale: boolean;
  readonly reducedMotion: boolean;
  /** This session owns the Run's business controls, or is a Side Talk looking in. */
  readonly isOwner: boolean;
  /** The owning session's id, for the non-owner line; absent on a Run with no conversational owner. */
  readonly ownerId?: string;
  /** When `view` was last read successfully, for the elapsed figure to tick forward from between polls. */
  readonly readAt?: number;
  openOwner(id: string): void;
}

/** Forces a re-render once a second while `active`, for the one figure the masthead ticks. */
function useTick(active: boolean): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [active]);
}

export function Masthead({ name, view, context, stale, reducedMotion, isOwner, ownerId, readAt, openOwner }: MastheadProps): ReactElement {
  const run = view?.run;
  const status = run?.status;
  const ticking = status === 'running' && !stale && !reducedMotion;
  useTick(ticking);
  const said = status === undefined ? undefined : labelled(runStatusLabel, status);
  const elapsedBase = run?.meters?.elapsedMs;
  const elapsedMs = elapsedBase === undefined ? undefined : elapsedBase + (ticking && readAt !== undefined ? Math.max(0, Date.now() - readAt) : 0);
  // One elapsed figure, not two: `elapsed <now> of a time box of <bound>`, both sides through the
  // same `duration()` a person reads everywhere else on the card — never this ticking value beside a
  // second, static rendering of the same fact.
  const elapsedPhrase = elapsedMs === undefined || run?.budget === undefined ? undefined
    : `elapsed ${duration(elapsedMs)} of a time box of ${duration(run.budget.timeBoxMs)}`;
  const budgetWord = context === undefined ? undefined : BUDGET_STANDING[context.budget.phase];
  const purposeMark = runPurposeMark(run?.purpose);

  return (
    <header className="hima-masthead" data-hima-region="campaign-masthead"
      data-hima-state-status={status ?? ''} data-hima-state-current={run?.currentNode ?? ''} data-hima-state-generation={run?.generation === undefined ? '' : String(run.generation)}
      data-hima-state-purpose={run?.purpose ?? 'campaign'}>
      <div className="hima-masthead-id">
        <h2>{name ?? run?.campaignId ?? 'Campaign'}{purposeMark === undefined ? null : ` · ${purposeMark}`}</h2>
        <p className="hima-masthead-sub">
          {said === undefined
            ? (view === undefined ? null : <span className="hima-masthead-seal">No Fabric state recorded</span>)
            : <span className={`hima-masthead-seal hima-masthead-seal-${status ?? 'unknown'}`}>{said.said}</span>}
          {run?.currentNode === undefined ? null : <span> · {run.currentNode}</span>}
          {run?.generation === undefined ? null : <span> · gen {run.generation}</span>}
          {elapsedPhrase === undefined ? null : <span> · {elapsedPhrase}</span>}
          {budgetWord === undefined ? null : <span> · {budgetWord}</span>}
        </p>
      </div>
      {isOwner || ownerId === undefined ? null : (
        <div className="hima-masthead-owner">
          <span>Owned by Campaign Agent {ownerId.slice(-6)}</span>
          <button type="button" className="hima-button" data-hima-control="open-owner" onClick={() => openOwner(ownerId)}>Open Campaign Agent</button>
        </div>
      )}
    </header>
  );
}
