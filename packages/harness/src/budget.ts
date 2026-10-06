// The Budget: what one Run may spend, and the ending spending it all causes. One reason to change:
// what a Run is allowed — the time box, the time a person is not charged for, the Retry allowance —
// and how what it has spent is counted, in time and in the Site's licence seats. (The bound on those
// seats is the job cap's, beside the other scarcity of the Site; what a Run held of them is here,
// with every other meter.)
//
// Agent-owned Runs keep charging their total time box while an ordinary human `pause` stands open —
// nothing of the design or the Site is waiting on a person then, so nothing is exempt. A Hard blocker
// or a Pack Wait node is different (CONTEXT.md: "a Hard blocker is by definition a failure only a
// person can clear"): the minutes a Run stands at one, and the one-time historical allowance a
// pre-owned Run's adoption verified, both widen the deadline the same way, through `run.meters.waitedMs`
// (`advance`, `waitedMsOf`) — `ownedWaitedMs` is what every owned-Run admission gate reads it through.
// Every number here is computed from what the ledger already holds and never from a driving process's
// memory, which is what lets a second host pick a Run up and compute the same deadline, the same
// attempt number and the same allowance the first one would have.
import type { RunRecord } from './ledger.js';

/** How long a Run may take when nobody says: an hour, well past the two and a half minutes one
 *  opene902 generation costs on the reference Site, and short enough that a stuck Job cannot hold a
 *  licence overnight. */
export const defaultTimeBoxMs = 60 * 60_000;

/** How many attempts a node may make before its failure is a Hard blocker (CONTEXT.md). */
export const defaultRetryAllowance = 3;

/**
 * How many Generations a Campaign may open when neither the person who started it nor the pack says:
 * six. Enough for a push chooser to walk in from a first guess and converge — the reference pack's
 * own Loop converges in three on the stand-in — and few enough that a pack with no convergence
 * declared cannot spend a night of licensed synthesis discovering that.
 *
 * The pack's own `converge.generationLimit` is what usually decides, and a person's `--generations`
 * before that; this is the floor under both, so a Loop is always bounded by something.
 */
export const defaultGenerationLimit = 6;

/** Finite legacy-compatible Campaign ceiling; existing multi-stage methods remain below it. */
export const defaultAttemptLimit = 1000;

/**
 * When the original time box runs out, widened by whatever wait term the caller hands it.
 * `undefined` for a Run with no Budget, which spends nothing.
 *
 * The caller decides what "waited" means for the Run it holds: an owned Run's admission gates pass
 * `ownedWaitedMs(run)`, the ledger-persisted `Math.max(waitedMsOf(...), legacy adoption offset)` that
 * already accounts for every Hard blocker or Wait node a person has cleared; the legacy automatic
 * drive and its resume pass `waitedMsOf` fresh off the records it is about to act on. Both read this
 * one function so a Run is never held to two different deadlines by two different callers.
 *
 * **The deadline, stated once.** Everything that asks whether a Run may go on asks it here — the loop
 * at the top of every turn, the poll waiting on a Job, the wait for one of the Site's job slots, and
 * the resume deciding whether re-entering a Run could only end it — because a Run held to two
 * different deadlines by two of those is a Run whose Budget means nothing.
 */
const deadlineOf = (run: RunRecord, waitedMs: number): number | undefined =>
  run.budget === undefined ? undefined : Date.parse(run.createdAt) + run.budget.timeBoxMs + waitedMs;

export type BudgetPhase = 'active' | 'closing' | 'exhausted';
export interface BudgetStanding {
  readonly phase: BudgetPhase;
  readonly hardRemainingMs?: number;
  readonly experimentRemainingMs?: number;
  readonly closingReserveMs: number;
  readonly attempts: number;
  readonly attemptLimit?: number;
  readonly attemptRemaining?: number;
  readonly attemptLimitSpent: boolean;
}

/** The reserve begins inside the original hard box; it never extends the hard deadline. */
export function budgetStandingAt(run: RunRecord, waitedMs: number, at: number): BudgetStanding {
  const hard = deadlineOf(run, waitedMs);
  const attempts = run.meters?.attempts ?? 0;
  const attemptLimit = run.budget?.attemptLimit;
  const attemptState = attemptLimit === undefined ? {} : { attemptLimit, attemptRemaining: Math.max(0, attemptLimit - attempts) };
  const attemptLimitSpent = attemptLimit !== undefined && attempts >= attemptLimit;
  if (hard === undefined) return { phase: 'active', closingReserveMs: 0, attempts, attemptLimitSpent, ...attemptState };
  const reserve = run.budget?.closingReserveMs ?? 0;
  const experiment = hard - reserve;
  return {
    phase: at >= hard ? 'exhausted' : at >= experiment ? 'closing' : 'active',
    hardRemainingMs: Math.max(0, hard - at),
    experimentRemainingMs: Math.max(0, experiment - at),
    closingReserveMs: reserve,
    attempts,
    attemptLimitSpent,
    ...attemptState,
  };
}

export const budgetStanding = (run: RunRecord, waitedMs: number): BudgetStanding => budgetStandingAt(run, waitedMs, Date.now());

/**
 * The wait term an Agent-owned Run's own admission gates should widen its deadline by: `advance`
 * already computes and persists this on every write (`run.meters.waitedMs`, from `waitedMsOf` and any
 * adoption offset, `Math.max`-ratcheted so it never falls back), so a gate reads the same number the
 * row itself carries rather than assuming a Run in its own `control` never waited on a person. A Hard
 * blocker or a Pack Wait node is a failure only a person can clear (CONTEXT.md; `waitedMsOf` above);
 * the minutes spent standing at one are not minutes the design or the Site spent, and must not read as
 * spent time box here any more than they do at legacy `resumeRun`'s own deadline check.
 */
export const ownedWaitedMs = (run: RunRecord): number => run.meters?.waitedMs ?? 0;

export interface ResearchWriteRequest {
  readonly nodeId: string; readonly attempt: number; readonly sessionId: string;
  readonly scope: 'workshop' | 'workspace'; readonly workshop?: string;
  readonly path: string; readonly requestedBytes: number; readonly callId?: string;
  readonly branchId?: string;
}
export interface ResearchWriteAdmission {
  readonly allowed: boolean; readonly callId: string; readonly recordId: string;
  readonly reason?: string; readonly usedWriteAttempts: number; readonly usedBytes: number;
}

