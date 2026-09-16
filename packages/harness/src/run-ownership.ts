// Which Run a session owns (#41 task 8): the one pure rule the client's session-header chip, tab
// title and tab body all read (`client/owned-run.ts`), kept here in the server-facing `src` tree —
// not under `client/` — so it is reachable through the ordinary `@hima/harness` barrel and its
// compiled `.d.ts`/`.js`, the same way every other pure function this package tests at L1 is. A raw
// relative import of a `client/*` source file would drag this whole package's Host-side import graph
// into whichever project imported it; the barrel's compiled output carries none of that.
import type { RunHeadView } from './remote.js';

/** How long a Run this session owns keeps showing in the chip and tab title after it ends, so a
 *  person who just watched it end still sees the seal for a while rather than the chip vanishing out
 *  from under them. Measured from the moment this module first observed the Run in an ended state
 *  (`endedSeenAt`), never from `createdAt`: a Run started an hour ago and only just now read as
 *  ended must still get its own full window, not one already spent before anyone saw the ending. */
const RECENTLY_ENDED_WINDOW_MS = 60 * 60 * 1000;

const active = (run: RunHeadView): boolean => run.status === 'running' || run.status === 'waiting';

/** The newest of a list, by `createdAt` (ISO-8601, so lexical order is chronological order). */
function newest(runs: readonly RunHeadView[]): RunHeadView | undefined {
  return runs.reduce<RunHeadView | undefined>((found, run) => (found === undefined || run.createdAt > found.createdAt ? run : found), undefined);
}

/** The moment this module first read each ended Run's id as no longer active — the recently-ended
 *  window's own clock. Pruned to the runs a read still names, so a Run that scrolls out of the
 *  Host's own list does not hold its entry forever. */
const endedSeenAt = new Map<string, number>();

/** The one Run this session owns and should be shown for: the running-or-waiting one first, else the
 *  most recently ended one still inside its own recently-ended window, else none. A Run with no
 *  `control` at all (no conversational owner ever recorded) is never owned by any session. */
export function pickOwnedRun(runs: readonly RunHeadView[], sessionId: string, now = Date.now()): RunHeadView | undefined {
  for (const id of [...endedSeenAt.keys()]) if (!runs.some((run) => run.id === id)) endedSeenAt.delete(id);
  const owned = runs.filter((run) => run.control?.owner === sessionId);
  const live = newest(owned.filter(active));
  if (live !== undefined) return live;
  const ended = owned.filter((run) => !active(run));
  for (const run of ended) if (!endedSeenAt.has(run.id)) endedSeenAt.set(run.id, now);
  const recentlyEnded = ended.filter((run) => now - endedSeenAt.get(run.id)! < RECENTLY_ENDED_WINDOW_MS);
  return newest(recentlyEnded);
}

/** Whether `sessionId` holds business control of a Run whose `control` reads as given — the one rule
 *  the masthead, the node card footer, the Configuration page's Run picker and the Diagnostics sheet
 *  must all agree on: a Run with no conversational owner recorded belongs to nobody in particular
 *  yet, so every session reads it as its own until one claims it. */
export const isOwner = (control: { readonly owner: string } | undefined, sessionId: string): boolean =>
  control === undefined || control.owner === sessionId;
