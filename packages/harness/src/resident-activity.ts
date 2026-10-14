// Live display facts a resident agent's wrapper publishes in its signed state.json (`activity`):
// tool calls, plan progress and the latest action. Never authority — nothing decides on them. The
// Host keeps the last value it read per Run and node in memory and shows it on the running task.
export interface ResidentActivity {
  readonly toolCalls: number;
  readonly planDone: number;
  readonly planTotal: number;
  readonly latest?: { readonly kind: string; readonly title: string; readonly at: string };
}

const live = new Map<string, ResidentActivity>();
const key = (runId: string, nodeId: string): string => `${runId}\u0000${nodeId}`;
const count = (value: unknown): number | undefined => typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;

/** Lenient: a malformed value is dropped, never an error. */
export function residentActivityOf(value: unknown): ResidentActivity | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const o = value as Record<string, unknown>;
  const toolCalls = count(o.toolCalls), planDone = count(o.planDone), planTotal = count(o.planTotal);
  if (toolCalls === undefined || planDone === undefined || planTotal === undefined) return undefined;
  const latest = o.latest as Record<string, unknown> | undefined;
  const ok = latest !== null && typeof latest === 'object' && typeof latest.kind === 'string' && typeof latest.title === 'string' && typeof latest.at === 'string';
  return { toolCalls, planDone, planTotal, ...(ok ? { latest: { kind: latest.kind as string, title: (latest.title as string).slice(0, 160), at: latest.at as string } } : {}) };
}

export function noteResidentActivity(runId: string, nodeId: string, value: unknown): void {
  const activity = residentActivityOf(value);
  if (activity !== undefined) live.set(key(runId, nodeId), activity);
  if (live.size > 512) live.delete(live.keys().next().value!);
}

export function residentActivity(runId: string, nodeId: string): ResidentActivity | undefined {
  return live.get(key(runId, nodeId));
}
