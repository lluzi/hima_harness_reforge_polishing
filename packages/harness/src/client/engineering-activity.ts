// What a resident AI agent is doing at its node right now, as the Host polls it from the agent's own
// state file (`RunView.engineeringActivity`, keyed by node id). Read defensively: a Host that does
// not answer the field yet simply draws an AI node without its activity lines.
import type { RunView } from '../remote.js';

export interface EngineeringActivityView {
  readonly executionId: string;
  readonly state: string;
  readonly toolCalls: number;
  readonly planDone: number;
  readonly planTotal: number;
  readonly latest?: { readonly kind: string; readonly title: string; readonly at: string };
  readonly updatedAt: string;
}

/** The latest activity the Host knows for one node, or undefined when it reports none. */
export function engineeringActivityOf(view: RunView | undefined, nodeId: string): EngineeringActivityView | undefined {
  const all = (view as unknown as { readonly engineeringActivity?: Readonly<Record<string, EngineeringActivityView>> } | undefined)?.engineeringActivity;
  return all?.[nodeId];
}

/** The dictionary key for an action kind's plain word ("reading", "running", …). */
export const activityKindKey = (kind: string): string =>
  ['read', 'edit', 'execute', 'search', 'plan', 'message'].includes(kind) ? `ai.kind.${kind}` : 'ai.kind.other';
