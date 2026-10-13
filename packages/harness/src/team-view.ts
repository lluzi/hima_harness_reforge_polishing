// The team view (2026-10-13): a Pack's `view.yml` folded with a Run's task records into what the
// Live tab draws in place of the full canvas — a few stations, each a step box with a checklist or a
// team of agents, for the current round. Pure and DOM-free (type imports only), so it runs under
// Node's own loader in the contract tests, like `canvas-layout.ts` beside it.
//
// Semantics:
// - Round: a task inside a `repeat` carries its iteration path; the round is the highest iteration
//   any task has reached, plus one. Round 1 when nothing has run inside a repeat yet.
// - A node's state in the round: the invocation of that round for a repeated node, else its latest
//   invocation. A node that has not been invoked in the round is pending.
// - A checklist line is hidden when `rounds` excludes the round, done when all its nodes succeeded,
//   active when one is running or waiting, failed when one failed, else pending.
// - A team member is the one node it names; an AI member is a node whose tool is outsourced to a
//   resident agent. A station is active when any of its nodes is, done when all its shown lines and
//   members are done, else waiting.
// - An edge is lit when its target station is active and its source station already has work done
//   in this round (the hand-over that is happening now).
import type { PackContract, PackGraph, PackView } from './packs.js';
import type { DurableTaskView, RunView } from './remote.js';

export type TeamNodeState = 'pending' | 'active' | 'done' | 'failed';
export type TeamStationState = 'waiting' | 'active' | 'done' | 'failed';

export interface TeamLine { readonly label: string; readonly nodes: readonly string[]; readonly state: TeamNodeState | 'hidden' }
export interface TeamMember {
  readonly node: string;
  readonly label: string;
  readonly role?: string;
  readonly ai: boolean;
  readonly state: TeamNodeState;
  /** The member's own one-line delivery summary in this round, when it has delivered one. */
  readonly summary?: string;
  /** How many rounds this member has delivered in. */
  readonly delivered: number;
}
export interface TeamStation {
  readonly id: string;
  readonly label: string;
  readonly about?: string;
  readonly ai: boolean;
  readonly state: TeamStationState;
  readonly lines: readonly TeamLine[];
  readonly team?: readonly TeamMember[];
  /** The station's active AI node, when it has one (for its live line). */
  readonly activeNode?: string;
  /** For a single-agent station: its delivery summary in this round. */
  readonly summary?: string;
}
export interface TeamEdge { readonly from: string; readonly to: string; readonly label?: string; readonly back: boolean; readonly lit: boolean }
export interface TeamMetric { readonly label: string; readonly value: string; readonly goal?: string; readonly better?: 'lower' | 'higher' }
export interface TeamViewState {
  readonly round: number;
  readonly title?: string;
  readonly stations: readonly TeamStation[];
  readonly edges: readonly TeamEdge[];
  readonly metrics: readonly TeamMetric[];
  readonly ended: boolean;
}

type Tools = PackContract['tools'];
const lastIteration = (task: DurableTaskView): number | undefined => task.iterations?.at(-1)?.iteration;
const ENDED = (status: string | undefined): boolean => status !== undefined && (status.startsWith('ended-') || status === 'cancelled');
const shows = (rounds: string | undefined, round: number): boolean => rounds === 'first' ? round === 1 : rounds === 'later' ? round >= 2 : true;

/** The value of a committed output at a key path, or undefined. */
export function outputAt(task: DurableTaskView | undefined, path: readonly string[]): unknown {
  let at: unknown = (task?.result ?? task?.retainedResult)?.value;
  for (const key of path) {
    if (at === null || typeof at !== 'object' || Array.isArray(at)) return undefined;
    at = (at as Record<string, unknown>)[key];
  }
  return at;
}

function stateOf(task: DurableTaskView | undefined): TeamNodeState {
  switch (task?.projection.state) {
    case 'succeeded': return 'done';
    case 'running': case 'waiting': return 'active';
    case 'failed': return 'failed';
    default: return 'pending';
  }
}

/** A number as a person reads it: grouped thousands, at most one decimal. */
export function said(value: unknown, unit?: string): string | undefined {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  if (!Number.isFinite(n)) return undefined;
  const text = n.toLocaleString('en-US', { maximumFractionDigits: Number.isInteger(n) ? 0 : 1 });
  return unit === undefined || unit === '' ? text : `${text} ${unit}`;
}

function summaryOf(task: DurableTaskView | undefined): string | undefined {
  const text = outputAt(task, ['engineering', 'summary']);
  return typeof text === 'string' && text.trim() !== '' ? text.trim() : undefined;
}

export function teamViewState(graph: Pick<PackGraph, 'nodes'> & { readonly view?: PackView }, tools: Tools | undefined,
  view: Pick<RunView, 'run' | 'tasks'> | undefined): TeamViewState | undefined {
  const declared = graph.view;
  if (declared === undefined) return undefined;
  const tasks = (view?.tasks ?? []).filter((task) => task.current !== false && task.rootFlow !== false);
  const reached = tasks.map(lastIteration).filter((n): n is number => n !== undefined);
  const round = reached.length === 0 ? 1 : Math.max(...reached) + 1;
  const ended = ENDED(view?.run.status);

  const repeated = new Set(tasks.filter((task) => lastIteration(task) !== undefined).map((task) => task.taskId));
  const inRound = (id: string): DurableTaskView | undefined => {
    const own = tasks.filter((task) => task.taskId === id);
    const pool = repeated.has(id) ? own.filter((task) => lastIteration(task) === round - 1) : own;
    // A started invocation outranks a declared-but-pending one; the latest started wins.
    return pool.find((task) => task.projection.state !== 'pending' && task.projection.state !== 'succeeded')
      ?? pool.filter((task) => task.projection.state === 'succeeded').at(-1) ?? pool.at(-1);
  };
  const delivered = (id: string): number => tasks.filter((task) => task.taskId === id && task.projection.state === 'succeeded').length;
  const latest = (id: string): DurableTaskView | undefined => {
    const done = tasks.filter((task) => task.taskId === id && (task.result ?? task.retainedResult) !== undefined);
    return done.sort((a, b) => (lastIteration(a) ?? -1) - (lastIteration(b) ?? -1)).at(-1);
  };

  const aiTools = new Set((tools ?? []).filter((tool) => tool.outsourcing !== undefined).map((tool) => tool.id));
  const aiNodes = new Set(graph.nodes.filter((node) => node.kind === 'act' && node.parameters.tool !== undefined && aiTools.has(node.parameters.tool)).map((node) => node.id));

  const stations: TeamStation[] = declared.stations.map((station) => {
    const lines: TeamLine[] = station.checklist.map((item) => {
      if (!shows(item.rounds, round)) return { label: item.label, nodes: item.nodes, state: 'hidden' as const };
      const states = item.nodes.map((id) => stateOf(inRound(id)));
      const state: TeamNodeState = states.every((s) => s === 'done') ? 'done' : states.includes('failed') ? 'failed'
        : states.includes('active') ? 'active' : 'pending';
      return { label: item.label, nodes: item.nodes, state };
    });
    const team = station.team?.map((member): TeamMember => {
      const task = inRound(member.node);
      const state = stateOf(task);
      const summary = state === 'done' ? summaryOf(task) : undefined;
      return { node: member.node, label: member.label, ...(member.role === undefined ? {} : { role: member.role }),
        ai: aiNodes.has(member.node), state, ...(summary === undefined ? {} : { summary }), delivered: delivered(member.node) };
    });
    const nodeIds = [...station.checklist.flatMap((item) => item.nodes), ...(station.team ?? []).map((member) => member.node)];
    const shown = [...lines.filter((line) => line.state !== 'hidden').map((line) => line.state as TeamNodeState), ...(team ?? []).map((m) => m.state)];
    const activeNode = nodeIds.find((id) => aiNodes.has(id) && stateOf(inRound(id)) === 'active');
    const state: TeamStationState = !ended && shown.includes('active') ? 'active' : shown.includes('failed') ? 'failed'
      : shown.length > 0 && shown.every((s) => s === 'done') ? 'done' : 'waiting';
    const soleAi = team === undefined ? station.checklist.flatMap((item) => item.nodes).find((id) => aiNodes.has(id)) : undefined;
    const summary = soleAi === undefined ? undefined : stateOf(inRound(soleAi)) === 'done' ? summaryOf(inRound(soleAi)) : undefined;
    return { id: station.id, label: station.label, ...(station.about === undefined ? {} : { about: station.about }),
      ai: nodeIds.some((id) => aiNodes.has(id)), state, lines, ...(team === undefined ? {} : { team }),
      ...(activeNode === undefined || ended ? {} : { activeNode }), ...(summary === undefined ? {} : { summary }) };
  });

  const byId = new Map(stations.map((station) => [station.id, station]));
  const worked = (station: TeamStation | undefined): boolean => station !== undefined
    && (station.lines.some((line) => line.state === 'done') || (station.team ?? []).some((m) => m.state === 'done') || station.state === 'done');
  const edges: TeamEdge[] = declared.edges.map((edge) => ({
    from: edge.from, to: edge.to, ...(edge.label === undefined ? {} : { label: edge.label }), back: edge.back === true,
    lit: !ended && byId.get(edge.to)?.state === 'active' && worked(byId.get(edge.from)),
  }));

  const metrics: TeamMetric[] = [];
  for (const metric of declared.metrics) {
    const value = said(outputAt(latest(metric.node), metric.path), metric.unit);
    if (value === undefined) continue;
    const goal = metric.goal === undefined ? undefined : said(view?.run.goal?.[metric.goal], metric.unit);
    metrics.push({ label: metric.label, value, ...(goal === undefined ? {} : { goal }), ...(metric.better === undefined ? {} : { better: metric.better }) });
  }
  return { round, ...(declared.title === undefined ? {} : { title: declared.title }), stations, edges, metrics, ended };
}
