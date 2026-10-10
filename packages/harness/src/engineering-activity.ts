/**
 * Live activity of a resident engineering task, as the Workbench shows it on the AI node.
 *
 * The task wrapper keeps `state.json.activity` from the native ACP session (tool calls, plan
 * progress, latest action); `observeResidentEngineering` polls that file and keeps the last parsed
 * value here per Run and node. In memory only: these are display facts, never Ledger authority, and
 * a Host restart simply starts empty until the next poll. The last value stays after the execution
 * ends so a finished node still shows its totals.
 */
import type { Ledger } from './ledger.js';

export type EngineeringActivityKind = 'read' | 'edit' | 'execute' | 'search' | 'plan' | 'message' | 'other';

export interface EngineeringActivityLatest {
  readonly kind: EngineeringActivityKind;
  readonly title: string;
  readonly at: string;
}

export interface EngineeringActivityView {
  readonly executionId: string;
  /** The wrapper's task phase when this was read (running, waiting, delivered, ...). */
  readonly state: string;
  readonly toolCalls: number;
  readonly planDone: number;
  readonly planTotal: number;
  readonly latest?: EngineeringActivityLatest;
  /** The wrapper's own `updatedAt` for the state this was read from. */
  readonly updatedAt: string;
}

const KINDS = new Set<EngineeringActivityKind>(['read', 'edit', 'execute', 'search', 'plan', 'message', 'other']);
const count = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;

/** Lenient: anything that is not the declared shape yields undefined; a bad `latest` is dropped. */
export function parseEngineeringActivity(value: unknown): Omit<EngineeringActivityView, 'executionId' | 'state' | 'updatedAt'> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const toolCalls = count(raw.toolCalls);
  const planDone = count(raw.planDone);
  const planTotal = count(raw.planTotal);
  if (toolCalls === undefined || planDone === undefined || planTotal === undefined) return undefined;
  const latest = raw.latest as Record<string, unknown> | undefined;
  const valid = latest !== null && typeof latest === 'object' && KINDS.has(latest.kind as EngineeringActivityKind)
    && typeof latest.title === 'string' && typeof latest.at === 'string';
  return {
    toolCalls, planDone: Math.min(planDone, planTotal), planTotal,
    ...(valid ? { latest: { kind: latest.kind as EngineeringActivityKind, title: (latest.title as string).slice(0, 120), at: latest.at as string } } : {}),
  };
}

const activityByLedger = new WeakMap<Ledger, Map<string, Map<string, EngineeringActivityView>>>();

/** Keep the latest polled activity of one resident execution; malformed activity is ignored. */
export function noteEngineeringActivity(ledger: Ledger, runId: string, nodeId: string, executionId: string,
  state: { readonly phase: string; readonly updatedAt: string; readonly activity?: unknown }): void {
  const parsed = parseEngineeringActivity(state.activity);
  if (parsed === undefined) return;
  const runs = activityByLedger.get(ledger) ?? new Map<string, Map<string, EngineeringActivityView>>();
  activityByLedger.set(ledger, runs);
  const nodes = runs.get(runId) ?? new Map<string, EngineeringActivityView>();
  runs.set(runId, nodes);
  nodes.set(nodeId, { executionId, state: state.phase, ...parsed, updatedAt: state.updatedAt });
}

/** The Run's per-node activity, or undefined when no resident execution has reported any. */
export function engineeringActivityOf(ledger: Ledger, runId: string): Readonly<Record<string, EngineeringActivityView>> | undefined {
  const nodes = activityByLedger.get(ledger)?.get(runId);
  return nodes === undefined || nodes.size === 0 ? undefined : Object.fromEntries(nodes);
}
