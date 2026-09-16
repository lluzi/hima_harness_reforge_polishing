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
import { isOwner, pickOwnedRun } from '../run-ownership.js';
import type { GlyphName } from './glyphs.js';

export { isOwner, pickOwnedRun };

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
// `fetchRuns` answers with every Run on the Host, not one session's own — there was never a reason
// for the chip, the tab title and the tab body's own runs list to each hold a separate poll of the
// exact same read. One `setTimeout` chain, reference-counted by every mounted consumer through
// `useSyncExternalStore`; the last unsubscribe stops it, the next subscribe restarts it from the
// last snapshot rather than a blank one, so a brief 0-to-1 subscriber gap never flashes "reading…".

interface RunsSnapshot {
  readonly runs?: readonly RunHeadView[];
  readonly readAt?: number;
  readonly error?: string;
}

let snapshot: RunsSnapshot = {};
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | undefined;
let inFlight: AbortController | undefined;

function notify(): void {
  for (const listener of listeners) listener();
}

function poll(): void {
  const own = new AbortController();
  inFlight = own;
  void fetchRuns(own.signal).then((result) => {
    if (own.signal.aborted) return;
    snapshot = result.ok ? { runs: result.value.runs, readAt: Date.now() } : { ...snapshot, error: result.error.message };
    notify();
    timer = setTimeout(poll, OWNED_RUN_POLL_MS);
  });
}

function ensurePolling(): void {
  if (timer !== undefined || inFlight !== undefined) return;
  poll();
}

function stopPolling(): void {
  if (timer !== undefined) { clearTimeout(timer); timer = undefined; }
  inFlight?.abort();
  inFlight = undefined;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  ensurePolling();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stopPolling();
  };
}

function getSnapshot(): RunsSnapshot {
  return snapshot;
}

/** Force an immediate re-read on top of the shared cadence, e.g. right after this session's own
 *  control action lands — a no-op while nobody is subscribed, since there is then nothing to serve. */
export function refreshRuns(): void {
  if (listeners.size === 0) return;
  stopPolling();
  ensurePolling();
}

/** Every Run on the Host, from the one shared poll — what the tab body's own Run picker reads,
 *  in place of a second independent `GET /hima/api/runs` cadence of its own. */
export function useRunsList(): { readonly runs: readonly RunHeadView[]; readonly readAt?: number; readonly error?: string; refresh(): void } {
  const shared = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { runs: shared.runs ?? [], readAt: shared.readAt, error: shared.error, refresh: refreshRuns };
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
  const shared = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return {
    run: shared.runs === undefined ? undefined : pickOwnedRun(shared.runs, sessionId),
    readAt: shared.readAt,
    stale: shared.error !== undefined,
  };
}
