// Which Run an operation's records belong to. One answer for every operation that writes to the
// ledger — observing a report, launching a Job — so that a Run spanning both is opened and joined
// the one way (D36).
import type { Ledger, RunRecord } from './ledger.js';
import type { Site } from './sites.js';
import { RunReferenceError } from './errors.js';

/** The Probe campaign of the day: what work outside any fabric Run belongs to. */
const campaignIdFor = (now: Date): string => `probe-${now.toISOString().slice(0, 10)}`;

/**
 * The Run this operation belongs to: the one the caller named, or a new Probe-campaign Run. A named
 * Run must exist and must be a Run of this Site — a record inherits its Run's `siteId`, so appending
 * to another Site's Run would put a claim in the ledger that nothing on that Site made.
 *
 * @param ledger - the ledger the Run lives in.
 * @param site - the Site the operation acts on.
 * @param named - a run id the caller gave, or undefined to open a Run of its own.
 * @returns the Run to record against.
 * @throws RunReferenceError when the named Run is unknown or belongs to another Site.
 */
export function runFor(ledger: Ledger, site: Site, named: string | undefined, projectSessionId?: string): Promise<RunRecord> {
  if (named === undefined) return ledger.createRun({ campaignId: campaignIdFor(new Date()), siteId: site.name, ...(projectSessionId ? { projectSessionId } : {}) });
  const run = ledger.run(named);
  if (!run) throw new RunReferenceError(`unknown run "${named}": the HimaLedger holds no such run`);
  if (run.siteId !== site.name) {
    throw new RunReferenceError(`run ${named} is a run of site ${run.siteId}, not ${site.name}: a record may not claim a site its run never named`);
  }
  return Promise.resolve(run);
}

/**
 * The Run a caller named, which must exist. Used by the operations that act on something a Run
 * already holds — the status, tail, or kill of a Job it launched — where opening a new Run would be
 * meaningless.
 *
 * @throws RunReferenceError when the ledger holds no such Run.
 */
export function existingRun(ledger: Ledger, runId: string): RunRecord {
  const run = ledger.run(runId);
  if (!run) throw new RunReferenceError(`unknown run "${runId}": the HimaLedger holds no such run`);
  return run;
}

/**
 * Is this Run still one a drive may move? Asked of a row a caller is already holding.
 *
 * Here, beside the row every caller reads it from, because three modules ask it — the driver before
 * each turn, a fork's branches before each of their own writes, and the claim step before it says on
 * the row that a branch is queued — and a Run that is "still going" in two spellings is two rules.
 * A Run that has ended does not say `running`, and neither does one another face moved to `waiting`,
 * so this one test is the whole of it.
 */
export const driving = (run: RunRecord): boolean => run.status === 'running';

/** The old driver exists only as an explicitly opted-in Node regression fixture. */
export const legacyAutomaticAllowed = (): boolean =>
  process.env.NODE_TEST_CONTEXT !== undefined && process.env.HIMA_TEST_LEGACY_AUTO_DRIVE === '1';
