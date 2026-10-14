// The workspace pane opens itself once, on the Campaign tab, when a receipt in this conversation
// shows a Run that has just started (the person approved it a moment ago). Before a Run exists
// nothing opens. A transcript re-rendered or replayed later must not reopen it: the receipt (or,
// when the receipt carries no time of its own, the Run) must be under two minutes old, and each Run
// opens the pane at most once per window session (sessionStorage, plus an in-memory set when
// storage is unavailable). Ported from `demo/andes-openc910` (slice D,
// `docs/plans/hug/2026-10-14-andes-port-plan.md`); the tool list is HUG's own: unlike the demo,
// HUG-DBOS confirms and starts a Run with `hima_run` alone — `hima_execute` only controls an
// already-running Run (pause/continue/cancel/handoff/respond/revise/grow/engineering, `tools.ts`),
// and `hima_context` only reads facts, so neither receipt signals a fresh start.

/** How fresh a receipt must be to open the pane. */
export const AUTO_OPEN_WINDOW_MS = 2 * 60_000;
/** The one receipt that may open it: confirming and starting a Run (`tools.ts` `hima_run`). */
export const AUTO_OPEN_TOOLS: readonly string[] = ['hima_run'];
const KEY = 'hima.workspace.opened.';
const openedHere = new Set<string>();

/** A time a receipt or Run states, as epoch ms; undefined when it states none readable. */
export function timeOf(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value < 1e12 ? value * 1000 : value;
  if (typeof value === 'string' && value !== '') { const ms = Date.parse(value); return Number.isNaN(ms) ? undefined : ms; }
  return undefined;
}

/** The receipt's own time, when the transcript block carries one (`startedAt`, `endedAt`, …). */
export function receiptTime(block: object): number | undefined {
  const fields = block as { readonly endedAt?: unknown; readonly startedAt?: unknown; readonly createdAt?: unknown; readonly timestamp?: unknown; readonly at?: unknown };
  for (const value of [fields.endedAt, fields.startedAt, fields.createdAt, fields.timestamp, fields.at]) {
    const ms = timeOf(value);
    if (ms !== undefined) return ms;
  }
  return undefined;
}

export interface AutoOpenInput {
  readonly toolName?: string;
  /** The Run's status (`RunHeadView.status`, `remote.ts`). An ended Run (`cancelled` or `ended-*`,
   *  the `hasEnded` set in `ledger.ts`) never opens the pane; an absent status is a DBOS Run still
   *  preparing (`durableStartResult` `preparing`), which is treated as just started. */
  readonly status?: string;
  /** The receipt's own time, else the Run's creation time. */
  readonly at?: number;
  readonly now: number;
  /** This window has already opened the pane for this Run. */
  readonly opened: boolean;
}

/** Whether this receipt opens the workspace pane. */
export function shouldAutoOpen(input: AutoOpenInput): boolean {
  if (input.opened || input.toolName === undefined || !AUTO_OPEN_TOOLS.includes(input.toolName)) return false;
  // An ended Run never opens (same set as `ledger.ts` `hasEnded`); undefined is a Run still
  // preparing on DBOS — `durableRunView` yields no status until the `preparation` fact is written —
  // so it is treated as just started, and the effect re-fires when the status later resolves.
  if (input.status === 'cancelled' || input.status?.startsWith('ended-') === true) return false;
  if (input.at === undefined) return false;
  const age = input.now - input.at;
  return age >= -30_000 && age <= AUTO_OPEN_WINDOW_MS;
}

/** Whether this window has already opened the pane for `runId`. */
export function autoOpened(runId: string): boolean {
  if (openedHere.has(runId)) return true;
  try { return globalThis.sessionStorage?.getItem(KEY + runId) === '1'; } catch { return false; }
}

/** Marks `runId` as opened; true when this call is the one that marked it. */
export function claimAutoOpen(runId: string): boolean {
  if (autoOpened(runId)) return false;
  openedHere.add(runId);
  try { globalThis.sessionStorage?.setItem(KEY + runId, '1'); } catch { /* the in-memory mark still holds */ }
  return true;
}
