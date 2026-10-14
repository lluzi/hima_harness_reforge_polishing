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
//
// 2026-10-14 (slice A): the strip's layout declarations fold into this one view. A station takes an
// optional `row` (stations sharing a row sit side by side, at most two; a lone station spans both
// columns; a station without a row keeps the single-column team layout). When `view.yml` declares no
// `edges`, the station edges are derived from the graph's own edges that cross stations, a `back`
// edge when the target sits on the same row or above the source. A station showing more than four
// lines folds its leading run of done lines into one "N done" line. A metric may read a Reader's
// semantic value over the Run's observations instead of a node's committed output.
import type { PackContract, PackGraph, PackView } from './packs.js';
import type { DurableTaskView, ObservationView, RunView } from './remote.js';
import type { ResidentActivity } from './resident-activity.js';

export type TeamNodeState = 'pending' | 'active' | 'done' | 'failed';
export type TeamStationState = 'waiting' | 'active' | 'done' | 'failed';

export interface TeamLine {
  readonly label: string;
  readonly nodes: readonly string[];
  readonly state: TeamNodeState | 'hidden';
  /** The first of a folded leading run of done lines: how many lines this one stands for ("N done"). */
  readonly folds?: number;
  /** A done line folded into the leading line before it: shown nowhere. */
  readonly folded?: true;
}
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
  /** While it works: its wrapper's live display facts. */
  readonly activity?: ResidentActivity;
}
export interface TeamStation {
  readonly id: string;
  readonly label: string;
  readonly about?: string;
  /** The declared row, 0 at the top; absent keeps the single-column team layout. */
  readonly row?: number;
  /** 0 left, 1 right. A station alone on its row (or with no row) is col 0 and spans both columns. */
  readonly col: 0 | 1;
  readonly span: 1 | 2;
  readonly ai: boolean;
  readonly state: TeamStationState;
  readonly lines: readonly TeamLine[];
  readonly team?: readonly TeamMember[];
  /** The station's active AI node, when it has one (for its live line). */
  readonly activeNode?: string;
  /** For a single-agent station: its delivery summary in this round. */
  readonly summary?: string;
  /** The active AI node's live display facts. */
  readonly activity?: ResidentActivity;
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
/** A station with more shown lines than this folds its leading run of done lines into one (demo
 *  `STRIP_FOLD_OVER`). */
export const TEAM_FOLD_OVER = 4;
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

/** A Reader-sourced number, printed with its own `digits` (else as written) and unit; `sign` adds a
 *  leading `+` for a positive value, as a gain headline reads. Ports the format of `bestHeadline`. */
function saidReader(value: number, digits: number | undefined, unit: string | undefined, sign: boolean): string {
  const text = digits === undefined ? String(value) : value.toFixed(digits);
  const signed = sign && value > 0 ? `+${text}` : text;
  return unit === undefined || unit === '' ? signed : `${signed} ${unit}`;
}

/**
 * The value a Reader metric shows, folded from the Run's observations (one reading per Reader per
 * round). `best` keeps the best over every round under `better` (higher when none is stated), the
 * strip's best line; otherwise the latest round's reading. Ports the math of `bestHeadline`
 * (`demo:results-view.ts:89-104`). Absent until that Reader has read the value type.
 */
function readerValue(observations: readonly ObservationView[], reader: string, type: string, pick: 'latest' | 'best',
  better: 'lower' | 'higher' | undefined): number | undefined {
  let best: { value: number; generation: number } | undefined;
  for (const observation of observations) {
    if (observation.reader.id !== reader) continue;
    const found = observation.values.find((value) => value.type === type);
    if (found === undefined || found.value === null) continue;
    const generation = observation.generation ?? 0;
    // Observations are oldest first: on a tie the later reading wins the latest; `best` takes the
    // better value under `better`, higher when it states none.
    const take = best === undefined || (pick === 'best'
      ? (better === 'lower' ? found.value < best.value : found.value > best.value)
      : generation >= best.generation);
    if (take) best = { value: found.value, generation };
  }
  return best?.value;
}

export function teamViewState(graph: Pick<PackGraph, 'nodes' | 'edges'> & { readonly view?: PackView }, tools: Tools | undefined,
  view: Pick<RunView, 'run' | 'tasks' | 'observations'> | undefined): TeamViewState | undefined {
  const declared = graph.view;
  if (declared === undefined) return undefined;

  // The stations sharing each declared row, in declared order: at most two sit side by side, a lone
  // station (or one without a row) spans both columns. Ports the strip's `perRow` placement.
  const perRow = new Map<number, string[]>();
  for (const station of declared.stations) if (station.row !== undefined) perRow.set(station.row, [...(perRow.get(station.row) ?? []), station.id]);
  const placementOf = (id: string, row: number | undefined): { col: 0 | 1; span: 1 | 2 } => {
    const siblings = row === undefined ? [id] : perRow.get(row) ?? [id];
    return { col: (siblings.length === 2 && siblings[1] === id ? 1 : 0) as 0 | 1, span: (siblings.length === 2 ? 1 : 2) as 1 | 2 };
  };
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
    // More than four shown lines, with a leading run of at least two done ones: that run folds into
    // the first line, so the line being worked and the ones after it stay in view (demo STRIP_FOLD_OVER).
    const shownAt = lines.map((line, index) => ({ line, index })).filter((entry) => entry.line.state !== 'hidden');
    let run = 0;
    while (run < shownAt.length && shownAt[run]!.line.state === 'done') run += 1;
    const fold = shownAt.length > TEAM_FOLD_OVER && run >= 2 ? run : 0;
    if (fold > 0) {
      lines[shownAt[0]!.index] = { ...lines[shownAt[0]!.index]!, folds: fold };
      for (let k = 1; k < fold; k += 1) lines[shownAt[k]!.index] = { ...lines[shownAt[k]!.index]!, folded: true };
    }
    const team = station.team?.map((member): TeamMember => {
      const task = inRound(member.node);
      const state = stateOf(task);
      const summary = state === 'done' ? summaryOf(task) : undefined;
      const activity = state === 'active' && !ended ? task?.activity : undefined;
      return { node: member.node, label: member.label, ...(member.role === undefined ? {} : { role: member.role }),
        ai: aiNodes.has(member.node), state, ...(summary === undefined ? {} : { summary }), delivered: delivered(member.node),
        ...(activity === undefined ? {} : { activity }) };
    });
    const nodeIds = [...station.checklist.flatMap((item) => item.nodes), ...(station.team ?? []).map((member) => member.node)];
    const shown = [...lines.filter((line) => line.state !== 'hidden').map((line) => line.state as TeamNodeState), ...(team ?? []).map((m) => m.state)];
    const activeNode = nodeIds.find((id) => aiNodes.has(id) && stateOf(inRound(id)) === 'active');
    const state: TeamStationState = !ended && shown.includes('active') ? 'active' : shown.includes('failed') ? 'failed'
      : shown.length > 0 && shown.every((s) => s === 'done') ? 'done' : 'waiting';
    const soleAi = team === undefined ? station.checklist.flatMap((item) => item.nodes).find((id) => aiNodes.has(id)) : undefined;
    const summary = soleAi === undefined ? undefined : stateOf(inRound(soleAi)) === 'done' ? summaryOf(inRound(soleAi)) : undefined;
    const { col, span } = placementOf(station.id, station.row);
    return { id: station.id, label: station.label, ...(station.about === undefined ? {} : { about: station.about }),
      ...(station.row === undefined ? {} : { row: station.row }), col, span,
      ai: nodeIds.some((id) => aiNodes.has(id)), state, lines, ...(team === undefined ? {} : { team }),
      ...(activeNode === undefined || ended ? {} : { activeNode }), ...(summary === undefined ? {} : { summary }),
      ...(activeNode === undefined || ended || inRound(activeNode)?.activity === undefined ? {} : { activity: inRound(activeNode)!.activity! }) };
  });

  const byId = new Map(stations.map((station) => [station.id, station]));
  const worked = (station: TeamStation | undefined): boolean => station !== undefined
    && (station.lines.some((line) => line.state === 'done') || (station.team ?? []).some((m) => m.state === 'done') || station.state === 'done');
  const litInto = (from: string, to: string): boolean => !ended && byId.get(to)?.state === 'active' && worked(byId.get(from));

  let edges: TeamEdge[];
  if (declared.deriveEdges) {
    // No `edges` declared: derive them from the graph's own edges that cross from one station to
    // another, one per (from, to) pair (demo:strip-layout.ts:169-188). A `back` edge when the target
    // sits on the same row as the source or above it; an edge touching a hidden node draws none. The
    // lit rule is the team view's own — the target station active and the source already worked.
    const hidden = new Set(declared.hidden);
    const stationOf = new Map<string, string>();
    for (const station of declared.stations) {
      for (const item of station.checklist) for (const id of item.nodes) stationOf.set(id, station.id);
      for (const member of station.team ?? []) stationOf.set(member.node, station.id);
    }
    const rowOf = (id: string): number => byId.get(id)?.row ?? declared.stations.findIndex((station) => station.id === id);
    const index = new Map<string, number>();
    const derived: TeamEdge[] = [];
    for (const edge of graph.edges) {
      if (hidden.has(edge.from) || hidden.has(edge.to)) continue;
      const from = stationOf.get(edge.from), to = stationOf.get(edge.to);
      if (from === undefined || to === undefined || from === to) continue;
      const lit = litInto(from, to);
      const key = `${from}>${to}`;
      const at = index.get(key);
      if (at !== undefined) { if (lit && !derived[at]!.lit) derived[at] = { ...derived[at]!, lit: true }; continue; }
      index.set(key, derived.length);
      derived.push({ from, to, back: rowOf(to) <= rowOf(from), lit });
    }
    edges = derived;
  } else {
    edges = declared.edges.map((edge) => ({
      from: edge.from, to: edge.to, ...(edge.label === undefined ? {} : { label: edge.label }), back: edge.back === true,
      lit: litInto(edge.from, edge.to),
    }));
  }

  const metrics: TeamMetric[] = [];
  for (const metric of declared.metrics) {
    let value: string | undefined;
    let goal: string | undefined;
    if (metric.kind === 'reader') {
      const number = readerValue(view?.observations ?? [], metric.reader, metric.type, metric.pick === 'best' ? 'best' : 'latest', metric.better);
      if (number === undefined) continue;
      value = saidReader(number, metric.digits, metric.unit, true);
      const target = metric.goal === undefined ? undefined : view?.run.goal?.[metric.goal];
      goal = typeof target === 'number' ? saidReader(target, metric.digits, metric.unit, false) : undefined;
    } else {
      value = said(outputAt(latest(metric.node), metric.path), metric.unit);
      if (value === undefined) continue;
      goal = metric.goal === undefined ? undefined : said(view?.run.goal?.[metric.goal], metric.unit);
    }
    metrics.push({ label: metric.label, value, ...(goal === undefined ? {} : { goal }), ...(metric.better === undefined ? {} : { better: metric.better }) });
  }
  return { round, ...(declared.title === undefined ? {} : { title: declared.title }), stations, edges, metrics, ended };
}

// ---------------------------------------------------------------------------------------------------
// Drawing geometry (pure, DOM-free). The stations are placed by `TeamCanvas` in a two-column CSS
// grid — `teamGridArea` says which column(s) and which row a station takes — and one SVG overlay
// draws the edges between the boxes once they are measured. `teamEdgePath` turns a measured source
// and target box into the edge's path: a straight drop when the boxes line up, an elbow when they
// sit in different columns (a fork 1 → 2 or a join 2 → 1), and a run through a side gutter for a back
// edge. Kept here beside the state so both are testable under Node's own loader, like the strip's
// `layoutStrip` sat beside `stripState`.

/** A measured station box in the canvas's own pixel frame (left/top origin). */
export interface TeamBox { readonly top: number; readonly bottom: number; readonly left: number; readonly right: number }

/** The CSS grid placement of a station: which rows share which grid row (top to bottom), a lone
 *  station (span 2) across both columns, a paired station in its own column. */
export function teamGridArea(station: Pick<TeamStation, 'row' | 'col' | 'span'>, rowOrder: readonly number[]): { readonly gridColumn: string; readonly gridRow?: string } {
  const gridColumn = station.span === 2 ? '1 / 3' : station.col === 1 ? '2 / 3' : '1 / 2';
  if (station.row === undefined) return { gridColumn };
  const at = rowOrder.indexOf(station.row);
  return at < 0 ? { gridColumn } : { gridColumn, gridRow: String(at + 1) };
}

/** The declared rows, top to bottom, for the grid's row placement. */
export const teamRowOrder = (stations: readonly Pick<TeamStation, 'row'>[]): number[] =>
  [...new Set(stations.map((station) => station.row).filter((row): row is number => row !== undefined))].sort((a, b) => a - b);

/**
 * The SVG path of one edge between two measured boxes, with the point for its label. A forward edge
 * whose boxes overlap horizontally drops straight down the overlap; one whose boxes sit in different
 * columns turns once in the gap between the rows (the fork and join elbow). A back edge runs out of
 * the source, along the gutter — the left margin for a gridded strip, the right for the single
 * column — and into the target.
 */
export function teamEdgePath(edge: Pick<TeamEdge, 'back'>, from: TeamBox, to: TeamBox, width: number, gutter: 'left' | 'right' = 'right'): { readonly d: string; readonly lx: number; readonly ly: number } {
  if (!edge.back && to.top >= from.bottom) {
    const overlapLeft = Math.max(from.left, to.left), overlapRight = Math.min(from.right, to.right);
    if (overlapRight > overlapLeft) {
      const x = Math.round((overlapLeft + overlapRight) / 2);
      return { d: `M${x} ${from.bottom + 1}V${to.top - 2}`, lx: x + 8, ly: (from.bottom + to.top) / 2 + 4 };
    }
    // Different columns: a single turn in the row gap — the fork (1 → 2) and join (2 → 1) elbow.
    const sx = Math.round((from.left + from.right) / 2), tx = Math.round((to.left + to.right) / 2);
    const midY = Math.round((from.bottom + to.top) / 2);
    return { d: `M${sx} ${from.bottom + 1}V${midY}H${tx}V${to.top - 2}`, lx: (sx + tx) / 2, ly: midY - 4 };
  }
  const y1 = (from.top + from.bottom) / 2, y2 = Math.min(to.bottom - 14, to.top + 22);
  if (gutter === 'left') {
    const lane = 14;
    return { d: `M${from.left} ${y1}H${lane}V${y2}H${to.left - 2}`, lx: lane + 7, ly: (y1 + y2) / 2 };
  }
  const lane = width - 20;
  return { d: `M${from.right} ${y1}H${lane}V${y2}H${to.right + 2}`, lx: width - 7, ly: (y1 + y2) / 2 };
}
