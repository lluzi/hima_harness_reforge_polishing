// Which Run a session owns, polled — shared by the session-header chip, the tab title and the tab
// body's Diagnostics sheet (#41 task 8), so the three cannot come to name a different Run for the
// same session. A Side Talk session owns none and this hook says so by answering with no `run`,
// which is what makes the chip and the "Campaign · configure" tab title absent for it.
import { useEffect, useState } from 'react';
import { fetchRuns } from './api.js';
import type { RunHeadView } from '../remote.js';
import type { GlyphName } from './glyphs.js';

/** How often this session's own Run is re-read. Not the 2 s the open Campaign tab polls at: a chip
 *  and a tab title that nobody is looking at yet do not need the canvas's own cadence. */
const OWNED_RUN_POLL_MS = 5000;

/** How long a Run this session owns keeps showing in the chip and tab title after it ends, so a
 *  person who just watched it end still sees the seal for a while rather than the chip vanishing out
 *  from under them. Measured from `createdAt`, the only timestamp a `RunHeadView` carries — an
 *  approximation of "ended within the hour" rather than the exact fact, which the head view does not
 *  hold (review note, task 8 report). */
const RECENTLY_ENDED_WINDOW_MS = 60 * 60 * 1000;

/** One event, `'diagnostics'`, dispatched with `{ detail: { tabId } }` by the tab's own menu item and
 *  heard by that same tab's `HimaWorkbench` mount to open its Diagnostics sheet. A module-level
 *  target rather than a store: the menu item and the tab body are two separate slot registrations
 *  with no shared component tree of their own to hold state in. */
export const campaignEvents = new EventTarget();

export interface OwnedRun {
  readonly run?: RunHeadView;
  readonly readAt?: number;
  readonly error?: string;
}

const active = (run: RunHeadView): boolean => run.status === 'running' || run.status === 'waiting';

/** The newest of a list, by `createdAt` (ISO-8601, so lexical order is chronological order). */
function newest(runs: readonly RunHeadView[]): RunHeadView | undefined {
  return runs.reduce<RunHeadView | undefined>((found, run) => (found === undefined || run.createdAt > found.createdAt ? run : found), undefined);
}

/** The one Run this session owns and should be shown for: the running-or-waiting one first, else the
 *  most recently ended one still inside the recently-ended window, else none. */
export function pickOwnedRun(runs: readonly RunHeadView[], sessionId: string, now = Date.now()): RunHeadView | undefined {
  const owned = runs.filter((run) => run.control?.owner === sessionId);
  const live = newest(owned.filter(active));
  if (live !== undefined) return live;
  const recentlyEnded = owned.filter((run) => !active(run) && now - new Date(run.createdAt).getTime() < RECENTLY_ENDED_WINDOW_MS);
  return newest(recentlyEnded);
}

/**
 * The Run this session owns, polled every {@link OWNED_RUN_POLL_MS}. Side Talk sessions — every
 * session that never started or was never handed a Run — answer with `run: undefined` forever, which
 * is exactly the "no chip, no tab identity" state the chip and tab title read.
 *
 * @param sessionId - the session whose own Run this is.
 */
export function useOwnedRun(sessionId: string): OwnedRun {
  const [state, setState] = useState<OwnedRun>({});
  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      const result = await fetchRuns(controller.signal);
      if (!alive || controller.signal.aborted) return;
      setState(result.ok
        ? { run: pickOwnedRun(result.value.runs, sessionId), readAt: Date.now() }
        : (previous) => ({ ...previous, error: result.error.message }));
      timer = setTimeout(() => { void poll(); }, OWNED_RUN_POLL_MS);
    };
    void poll();
    return () => { alive = false; controller.abort(); clearTimeout(timer); };
  }, [sessionId]);
  return state;
}

/** The state glyph the chip and tab title draw beside a Run's status word — the same shape-and-colour
 *  rule the canvas and masthead already follow (Global Constraints), read off `card-labels.ts`'s own
 *  `runStatusLabel` colours through the state instead of a second table of them. */
export const STATUS_GLYPH: Readonly<Record<string, GlyphName>> = {
  running: 'ring',
  waiting: 'hourglass',
  cancelled: 'close',
  'ended-goal-met': 'check',
  'ended-goal-not-met': 'warning',
  'ended-converged': 'diamond',
  'ended-budget-exhausted': 'warning',
};
