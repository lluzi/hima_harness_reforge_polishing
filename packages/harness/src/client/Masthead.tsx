// The Campaign tab's one-line masthead (66 px): the Campaign's name, its status seal word, the node
// it stands at, its generation, an elapsed figure that ticks once a second while the Run is running,
// and where its Budget stands. A non-owner session sees who owns the Run and one way to reach them,
// and no business control — Task 6 adds emergency Pause/Stop to the card footer and the Diagnostics
// sheet, never here.
import { useEffect, useState, type ReactElement } from 'react';
import type { ExecutionContext } from '../fabric.js';
import type { RunView } from '../remote.js';
import { duration, labelled, runPurposeMark, runStatusLabel } from '../card-labels.js';
import { labelKeyed, useHimaT } from './locale/index.js';

/** The Budget standing, read from `ExecutionContext.budget.phase` (`budgetStanding`'s own live
 *  computation), because nothing in `RunMeters` states whether a Run is still active, spending its
 *  closing reserve, or already exhausted; only the execution context knows that right now. The phase
 *  maps to a Hima dictionary key so the standing reads in the active locale. */
const BUDGET_STANDING: Readonly<Record<ExecutionContext['budget']['phase'], string>> = {
  active: 'masthead.budget.active', closing: 'masthead.budget.closing', exhausted: 'masthead.budget.exhausted',
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
  const t = useHimaT();
  const run = view?.run;
  const status = run?.status;
  const ticking = status === 'running' && !stale && !reducedMotion;
  useTick(ticking);
  // The seal word is drawn in the active locale when this build knows the status, falling back to the
  // exact card-labels English for a status a newer host added (see `labelKeyed`).
  const said = status === undefined ? undefined : labelKeyed(t, `status.${status}`, labelled(runStatusLabel, status).said);
  const elapsedBase = run?.meters?.elapsedMs;
  const elapsedMs = elapsedBase === undefined ? undefined : elapsedBase + (ticking && readAt !== undefined ? Math.max(0, Date.now() - readAt) : 0);
  // One elapsed figure, not two: `elapsed <now> of a time box of <bound>`, both sides through the
  // same `duration()` a person reads everywhere else on the card — never this ticking value beside a
  // second, static rendering of the same fact. The numbers come from `duration()` unchanged; only the
  // wording around them is translated.
  const elapsedPhrase = elapsedMs === undefined || run?.budget === undefined ? undefined
    : t('masthead.elapsed', { now: duration(elapsedMs), box: duration(run.budget.timeBoxMs) });
  const budgetWord = context === undefined ? undefined : t(BUDGET_STANDING[context.budget.phase]);
  const purposeMark = runPurposeMark(run?.purpose);
  // The node the Run stands at, in the Pack's own words when it gave the node a label.
  // While a fork is open the run row names the join; the steps actually running are its branches'.
  const labelOf = (id: string) => context?.method?.reference.nodes.find((node) => node.id === id)?.label ?? id;
  const branches = Object.values(run?.fork?.branches ?? {}).filter((branch) => branch.state !== 'done').map((branch) => branch.currentNode);
  const currentNode = run?.currentNode;
  const currentSaid = branches.length > 0 ? branches.map(labelOf).join(', ') : currentNode === undefined ? undefined : labelOf(currentNode);
  // C19: a Campaign with no name of its own (`name` absent — no Campaign file, or one that never
  // set `name`) never falls back to the raw campaign id (a bare uuid-shaped identifier means nothing
  // to a person reading this masthead) — `‹packId› · gen N` says what the Run actually is instead,
  // the same two facts the sub-line beside it already reads off `run.currentNode`/`run.generation`,
  // named here where a title is expected instead of an opaque id.
  // The Pack's own title, when the execution context carries its contract, says what the work is.
  const packSaid = context?.method?.contract.title ?? run?.packId;
  const fallbackTitle = packSaid === undefined ? t('masthead.campaign') : `${packSaid}${run?.generation === undefined ? '' : ` · ${t('masthead.gen', { n: run.generation })}`}`;

  return (
    <header className="hima-masthead" data-hima-region="campaign-masthead"
      data-hima-state-status={status ?? ''} data-hima-state-current={run?.currentNode ?? ''} data-hima-state-generation={run?.generation === undefined ? '' : String(run.generation)}
      data-hima-state-purpose={run?.purpose ?? 'campaign'}>
      <div className="hima-masthead-id">
        <h2>{name ?? fallbackTitle}{purposeMark === undefined ? null : ` · ${purposeMark}`}</h2>
        <p className="hima-masthead-sub">
          {said === undefined
            ? (view === undefined ? null : <span className="hima-masthead-seal">{t('masthead.noFabricState')}</span>)
            : <span className={`hima-masthead-seal hima-masthead-seal-${status ?? 'unknown'}`}>{said}</span>}
          {currentSaid === undefined ? null : <span> · {currentSaid}</span>}
          {run?.generation === undefined ? null : <span> · {t('masthead.gen', { n: run.generation })}</span>}
          {elapsedPhrase === undefined ? null : <span className="hima-masthead-elapsed"> · {elapsedPhrase}</span>}
          {budgetWord === undefined ? null : <span className="hima-masthead-budget"> · {budgetWord}</span>}
        </p>
      </div>
      {isOwner || ownerId === undefined ? null : (
        <div className="hima-masthead-owner">
          <span>{t('masthead.ownedBy', { id: ownerId.slice(-6) })}</span>
          <button type="button" className="hima-button" data-hima-control="open-owner" onClick={() => openOwner(ownerId)}>{t('canvas.openAgent')}</button>
        </div>
      )}
    </header>
  );
}
