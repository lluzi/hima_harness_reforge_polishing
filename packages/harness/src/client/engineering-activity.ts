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

/** A title that only repeats the tool's own name ("read", "bash") says nothing a person can use:
 *  the agent's tool call announced itself before its arguments arrived. */
const BARE_TOOL_WORDS = new Set(['read', 'edit', 'write', 'bash', 'grep', 'glob', 'list', 'ls', 'todowrite', 'todoread', 'webfetch', 'fetch', 'task', 'patch', 'search', 'execute', 'plan', 'message', 'other']);

/** The activity line's text: the plain verb, then what it acts on when that says something. */
export function activityPhrase(verb: string, title: string): string {
  const said = title.trim();
  return said === '' || BARE_TOOL_WORDS.has(said.toLowerCase()) ? `${verb}…` : `${verb} ${said}`;
}

/** Whether the AI agent at a node is working: an execution there in a non-terminal phase (begun,
 *  working, ready), or its reported activity in a working state. */
export function aiWorking(view: RunView | undefined, nodeId: string): boolean {
  const executing = Object.values(view?.run.control?.executions ?? {}).some((execution) =>
    execution.nodeId === nodeId && (execution.phase === 'begun' || execution.phase === 'working' || execution.phase === 'ready'));
  const state = engineeringActivityOf(view, nodeId)?.state;
  return executing || state === 'running' || state === 'working' || state === 'waiting';
}
