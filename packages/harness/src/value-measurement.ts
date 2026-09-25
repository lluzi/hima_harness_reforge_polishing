// A value-study receipt over facts Hima already owns. This module observes Ledger, Job, Run-control
// and Model-moment records; it does not start a timer, contact a provider or create another telemetry
// store. Missing provider or human-effort facts remain unmeasured rather than becoming zero.
import { givesUpLaunch, hasEnded, type JobRecord, type LedgerRecord, type RunRecord, type SessionRecord } from './ledger.js';

export const VALUE_MEASUREMENT_SCHEMA = 'hima-value-measurement/1' as const;

export interface MeasuredCount {
  readonly status: 'measured';
  readonly value: number;
  readonly unit: 'count';
  readonly sources: readonly string[];
}

export interface MeasuredDuration {
  readonly status: 'measured';
  readonly value: number;
  readonly unit: 'ms';
  readonly sources: readonly string[];
  readonly claimLimit?: string;
}

export interface UnmeasuredValue {
  readonly status: 'unmeasured';
  readonly reason: string;
}

export interface SeatTimeMeasurement {
  readonly status: 'measured' | 'partial' | 'unmeasured';
  readonly unit: 'seat-ms';
  readonly values?: Readonly<Record<string, number>>;
  readonly sources: readonly string[];
  readonly reason?: string;
}

export interface ValueMeasurementReceipt {
  readonly schema: typeof VALUE_MEASUREMENT_SCHEMA;
  readonly runId: string;
  readonly throughSeq: number;
  readonly controlRevision?: number;
  readonly final: boolean;
  readonly human: {
    readonly businessDecisionTime: UnmeasuredValue;
    readonly environmentRecoveryTime: UnmeasuredValue;
    readonly evidenceReviewTime: UnmeasuredValue;
    /** Campaign wait is context only. It is not active human labour. */
    readonly observedWaitTime: MeasuredDuration | UnmeasuredValue;
    readonly controlRequests: MeasuredCount;
  };
  readonly model: {
    readonly sessionsOpened: MeasuredCount;
    readonly sessionsClosed: MeasuredCount;
    readonly incompleteSessionIds: readonly string[];
    readonly requests: UnmeasuredValue;
    readonly inputTokens: UnmeasuredValue;
    readonly outputTokens: UnmeasuredValue;
  };
  readonly jobs: {
    readonly launched: MeasuredCount;
    readonly finished: MeasuredCount;
    readonly killed: MeasuredCount;
    readonly unsettledSessionIds: readonly string[];
  };
  readonly commercialToolSeatTime: SeatTimeMeasurement;
  readonly claimLimits: readonly string[];
}

const unmeasuredHuman = (category: string): UnmeasuredValue => ({
  status: 'unmeasured',
  reason: `Existing Run records do not bracket active human ${category} time. Record it with an explicit study stopwatch receipt; do not infer it from Campaign wall or wait time.`,
});

const modelUsageUnmeasured = (what: string): UnmeasuredValue => ({
  status: 'unmeasured',
  reason: `Model-moment records identify sessions and outcomes but the pinned provider surface does not expose ${what} to this receipt.`,
});

const count = (value: number, sources: readonly string[]): MeasuredCount => ({ status: 'measured', value, unit: 'count', sources });

/**
 * Project one reproducible value-study receipt from a Run snapshot and its existing Ledger records.
 * Callers retain this JSON beside a matched study; the receipt itself adds no record or telemetry.
 */
export function valueMeasurementReceipt(run: RunRecord, records: readonly LedgerRecord[]): ValueMeasurementReceipt {
  const own = records.filter((record) => record.runId === run.id && record.seq < run.nextSeq);
  const jobs = own.filter((record): record is JobRecord => record.type === 'job');
  const launches = jobs.filter((record): record is JobRecord & { readonly event: 'launched' } => record.event === 'launched');
  const finished = jobs.filter((record): record is JobRecord & { readonly event: 'finished' } => record.event === 'finished');
  const killed = jobs.filter((record): record is JobRecord & { readonly event: 'killed' } => record.event === 'killed');
  const settledSessions = new Set([...finished, ...killed].map((record) => record.job.session));
  for (const record of own) {
    if (record.type === 'node' && record.jobSession !== undefined && givesUpLaunch(record)) settledSessions.add(record.jobSession);
  }
  const unsettled = launches.map((record) => record.job.session).filter((session) => !settledSessions.has(session));

  const opened = own.filter((record): record is SessionRecord & { readonly event: 'opened' } => record.type === 'session' && record.event === 'opened');
  const closed = own.filter((record): record is SessionRecord & { readonly event: 'closed' } => record.type === 'session' && record.event === 'closed');
  const closedSessions = new Set(closed.map((record) => record.sessionId));
  const incompleteSessions = opened.map((record) => record.sessionId).filter((session) => !closedSessions.has(session));
  const humanRequests = Object.entries(run.control?.requests ?? {}).filter(([, request]) => request.origin === 'human');

  const licensedOpen = launches.filter((record) => record.licences !== undefined && !settledSessions.has(record.job.session));
  const final = hasEnded(run.status) && unsettled.length === 0 && incompleteSessions.length === 0;
  const seatSources = run.meters === undefined ? [] : ['run.meters', ...launches.flatMap((record) => record.licences === undefined ? [] : [record.id])];
  const commercialToolSeatTime: SeatTimeMeasurement = run.meters === undefined
    ? { status: 'unmeasured', unit: 'seat-ms', sources: [], reason: 'This Run has no meters; commercial-tool seat time was not projected.' }
    : licensedOpen.length > 0
      ? { status: 'partial', unit: 'seat-ms', values: run.meters.licenceMs ?? {}, sources: seatSources,
        reason: `Open licensed Jobs are excluded until their stop is observed: ${licensedOpen.map((record) => record.job.session).join(', ')}.` }
      : { status: 'measured', unit: 'seat-ms', values: run.meters.licenceMs ?? {}, sources: seatSources };

  return {
    schema: VALUE_MEASUREMENT_SCHEMA,
    runId: run.id,
    throughSeq: run.nextSeq - 1,
    ...(run.control === undefined ? {} : { controlRevision: run.control.revision }),
    final,
    human: {
      businessDecisionTime: unmeasuredHuman('business-decision'),
      environmentRecoveryTime: unmeasuredHuman('environment-recovery'),
      evidenceReviewTime: unmeasuredHuman('evidence-review'),
      observedWaitTime: run.meters === undefined
        ? { status: 'unmeasured', reason: 'This Run has no meters; Campaign wait time was not projected.' }
        : { status: 'measured', value: run.meters.waitedMs ?? 0, unit: 'ms', sources: ['run.meters.waitedMs'],
          claimLimit: 'Campaign wait is elapsed time between a blocker/hold and continuation. It is not active human labour.' },
      controlRequests: count(humanRequests.length, humanRequests.map(([requestId]) => `run.control.requests.${requestId}`)),
    },
    model: {
      sessionsOpened: count(opened.length, opened.map((record) => record.id)),
      sessionsClosed: count(closed.length, closed.map((record) => record.id)),
      incompleteSessionIds: incompleteSessions,
      requests: modelUsageUnmeasured('provider request counts'),
      inputTokens: modelUsageUnmeasured('input-token usage'),
      outputTokens: modelUsageUnmeasured('output-token usage'),
    },
    jobs: {
      launched: count(launches.length, launches.map((record) => record.id)),
      finished: count(finished.length, finished.map((record) => record.id)),
      killed: count(killed.length, killed.map((record) => record.id)),
      unsettledSessionIds: unsettled,
    },
    commercialToolSeatTime,
    claimLimits: [
      'Unmeasured is not zero.',
      'Campaign elapsed and wait time do not establish active human labour.',
      'A model session count does not establish provider request count, token usage or spend.',
      'Seat time is licence seats multiplied by the settled hold duration; it is not a licence-server billing statement.',
      'A value or ROI claim requires a matched control receipt with the same measurement definitions.',
    ],
  };
}
