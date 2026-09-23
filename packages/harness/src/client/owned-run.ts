// Which Run a session owns, polled — shared by the session-header chip, the tab title and the tab
// body's own runs list (#41 task 8), so all three read the same one snapshot rather than each
// opening their own `GET /hima/api/runs` cadence. A Side Talk session owns none and `useOwnedRun`
// says so by answering with no `run`, which is what makes the chip and the "Campaign · configure"
// tab title absent for it.
import { useSyncExternalStore } from 'react';
import { fetchRuns } from './api.js';
import { labelled, runStatusLabel } from '../card-labels.js';
import type { RunStatus } from '../ledger.js';
import type { RunHeadView } from '../remote.js';
import { isOwner, pickOwnedRun, recordEndedSeenAt } from '../run-ownership.js';
import type { GlyphName } from './glyphs.js';

export { isOwner, pickOwnedRun };

/** This module's own instance of the recently-ended bookkeeping `pickOwnedRun` reads: written only
 *  from `poll`'s own notify path below (never from render, which is what keeps `pickOwnedRun` a pure
 *  function of its arguments), and shared by every session's own `useOwnedRun` call, since a Run's
 *  ended-ness is a fact about the Run, not about any one session reading it. */
const endedSeenAt = new Map<string, number>();

/** How often the one shared read of `/hima/api/runs` repeats while anything is subscribed. */
const OWNED_RUN_POLL_MS = 5000;

/** One event, `'diagnostics'`, dispatched with `{ detail: { tabId } }` by the tab's own menu item and
 *  heard by that same tab's `HimaWorkbench` mount to open its Diagnostics sheet. A module-level
 *  target rather than a store: the menu item and the tab body are two separate slot registrations
 *  with no shared component tree of their own to hold state in. */
export const campaignEvents = new EventTarget();

export interface OwnedRun {
  readonly run?: RunHeadView;
  readonly readAt?: number;
  /** The last read failed; `run` (when present) is the last snapshot known good, not a live fact. */
  readonly stale: boolean;
}

/** The status word the chip and the tab title both say, agreeing exactly because both read it from
 *  here rather than composing their own: `card-labels.ts`'s own `runStatusLabel`, or "no fabric
 *  state" for a Run HimaFabric never started (a Probe-campaign Run, `status` absent). */
export const statusSaid = (status: RunStatus | undefined): string =>
  status === undefined ? 'no fabric state' : labelled(runStatusLabel, status).said;

/** The state glyph the chip and tab title draw beside a Run's status word — the same shape-and-colour
 *  rule the canvas and masthead already follow (Global Constraints). Total over `RunStatus`, so a
 *  status the ledger adds without a glyph here is a build error rather than a blank icon. */
export const STATUS_GLYPH: Readonly<Record<RunStatus, GlyphName>> = {
  running: 'ring',
  waiting: 'hourglass',
  cancelled: 'close',
  'ended-goal-met': 'check',
  'ended-goal-not-met': 'warning',
  'ended-converged': 'diamond',
  'ended-budget-exhausted': 'warning',
};

// --- The one shared subscription -----------------------------------------------------------------
// `fetchRuns` answers only Runs visible to the native viewing session. There is no reason
// for the chip, the tab title and the tab body's own runs list to each hold a separate poll of the
// exact same scoped read. One `setTimeout` chain per viewer, reference-counted by every mounted consumer through
// `useSyncExternalStore`; the last unsubscribe stops it, the next subscribe restarts it from the
// last snapshot rather than a blank one, so a brief 0-to-1 subscriber gap never flashes "reading…".

interface RunsSnapshot {
  readonly runs?: readonly RunHeadView[];
  readonly readAt?: number;
  readonly error?: string;
}

function createRunsStore(sessionId: string) {
  let snapshot: RunsSnapshot = {};
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: AbortController | undefined;
  const stop = () => { clearTimeout(timer); timer = undefined; inFlight?.abort(); inFlight = undefined; };
  const poll = () => {
    if (!sessionId || inFlight) return;
    const own = new AbortController(); inFlight = own;
    void fetchRuns(own.signal, sessionId).then(result => {
      if (own.signal.aborted) return;
      inFlight = undefined;
      if (result.ok) {
        const readAt = Date.now(); recordEndedSeenAt(result.value.runs, readAt, endedSeenAt);
        snapshot = { runs: result.value.runs, readAt };
      } else snapshot = { ...snapshot, error: result.error.message };
      for (const listener of listeners) listener();
      if (listeners.size > 0) timer = setTimeout(poll, OWNED_RUN_POLL_MS);
    });
  };
  return {
    getSnapshot: () => snapshot,
    refresh: () => { if (listeners.size) { stop(); poll(); } },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      if (!timer && !inFlight) poll();
      return () => { listeners.delete(listener); if (!listeners.size) stop(); };
    },
  };
}
// UI snapshots are keyed by the native viewing session. They carry no execution authority.
const stores = new Map<string, ReturnType<typeof createRunsStore>>();
function runsStore(sessionId: string) {
  let store = stores.get(sessionId);
  if (!store) { store = createRunsStore(sessionId); stores.set(sessionId, store); }
  return store;
}
export function refreshRuns(): void { for (const store of stores.values()) store.refresh(); }

export function useRunsList(sessionId: string): { readonly runs: readonly RunHeadView[]; readonly readAt?: number; readonly error?: string; refresh(): void } {
  const store = runsStore(sessionId);
  const shared = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return { runs: shared.runs ?? [], readAt: shared.readAt, error: shared.error, refresh: store.refresh };
}

/**
 * The Run this session owns, read from the one shared poll above. Side Talk sessions — every session
 * that never started or was never handed a Run — answer with `run: undefined` forever, which is
 * exactly the "no chip, no tab identity" state the chip and tab title read. Kept subscribed (and
 * updating) whether or not the Campaign tab itself is open or visible: the chip lives in the session
 * header, not inside the tab.
 *
 * @param sessionId - the session whose own Run this is.
 */
export function useOwnedRun(sessionId: string): OwnedRun {
  const shared = useRunsList(sessionId);
  return {
    run: shared.runs === undefined ? undefined : pickOwnedRun(shared.runs, sessionId, endedSeenAt),
    readAt: shared.readAt,
    stale: shared.error !== undefined,
  };
}
