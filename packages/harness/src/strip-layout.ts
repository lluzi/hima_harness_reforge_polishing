// The strip (2026-10-10): a Pack's compact view of its graph for a narrow pane (`graph.yml` `view`).
// A few stations, each drawn as one node with a checklist for the current round, in rows of at most
// two; edges between stations come from the graph's own edges that cross from one station to
// another. Two pure steps, like `canvas-layout.ts` beside it: `stripState` folds the Run's facts into
// station, line and edge states, and `layoutStrip` places them in a pane of a given width. No DOM,
// and only type imports, so both run under Node's own loader in the contract tests.
//
// Semantics (`.hima-tmp/andes-spec/STRIP-SPEC.md`, frozen):
// - Round: a revisit edge opens the Run's next generation in one write of the run row (`fabric.ts`),
//   so round k is generation k and its records are the generation's own (`GenerationView`).
// - A checklist line is hidden when `rounds` excludes the round, done when every node of the line has
//   completed in the round, active when one of its nodes is current, else pending.
// - A station is active when one of its nodes is current, done when all its shown lines are, else
//   waiting. While a fork is open the Run's `currentNode` is the join; the nodes being worked are the
//   branches' own current nodes, so those are what "current" means here.
// - Station edges: every graph edge between two stations, one per (from, to) pair; a down edge when
//   the target sits on a later row, a back edge otherwise, drawn along the strip's outer side.
// - Lit: the edges the active station was entered through in this visit — from a node completed in
//   this round into the station's current node or a node of the same visit before it. One edge
//   usually; both at a fork (two stations entered at once) and at a join (one station entered from two).
import type { PackContract, PackGraph, PackView } from './packs.js';
import type { RunView } from './remote.js';

export type StripLineState = 'hidden' | 'done' | 'active' | 'pending';
export type StripStationState = 'active' | 'done' | 'waiting';
export type StripEdgeKind = 'down' | 'back';

/** One node transition of the current round, as the Ledger wrote it (oldest first by `at`). */
export interface StripTransition { readonly nodeId: string; readonly state: string; readonly at: string }

/** What the strip reads from a Run. */
export interface StripFacts {
  readonly round: number;
  /** The node transitions of the current round, oldest first. */
  readonly transitions: readonly StripTransition[];
  /** The nodes the Run is working on now: its current node, or an open fork's unfinished branches. */
  readonly current: readonly string[];
}

export interface StripLine { readonly label: string; readonly nodes: readonly string[]; readonly state: StripLineState }

export interface StripStationView {
  readonly id: string;
  readonly label: string;
  readonly about?: string;
  readonly row: number;
  /** 0 left, 1 right; a station alone on its row spans the strip (`span: 2`, col 0). */
  readonly col: 0 | 1;
  readonly span: 1 | 2;
  readonly state: StripStationState;
  /** One of its nodes is an outsourced (resident AI agent) tool node. */
  readonly ai: boolean;
  /** The current AI node of this station, whose activity line the station shows. */
  readonly activeNode?: string;
  /** Every line of the checklist, hidden ones included (they take no room). */
  readonly lines: readonly StripLine[];
}

export interface StripEdgeView {
  readonly from: string;
  readonly to: string;
  readonly kind: StripEdgeKind;
  readonly lit: boolean;
  /** For a back edge: the strip side it runs along. */
  readonly side?: 'left' | 'right';
}

export interface StripState {
  readonly round: number;
  readonly stations: readonly StripStationView[];
  readonly edges: readonly StripEdgeView[];
}

type ContractTools = PackContract['tools'];
const COMPLETED = new Set(['done', 'reconciled']);
const ENDED = (status: string | undefined) => status !== undefined && (status.startsWith('ended-') || status === 'cancelled');

/**
 * The strip's facts from a `RunView`: the round is the Run's generation, its transitions are that
 * generation's own node records (the generation row's and every fork branch's), and the current nodes
 * are the open fork's unfinished branches, else the Run's current node. An ended Run works on nothing.
 */
export function stripFacts(view: Pick<RunView, 'run' | 'generations' | 'nodes'> | undefined): StripFacts {
  if (view === undefined) return { round: 1, transitions: [], current: [] };
  const generations = view.generations;
  const round = view.run.generation ?? generations.at(-1)?.generation ?? 1;
  const row = generations.find((generation) => generation.generation === round);
  const own = row === undefined
    ? (generations.length === 0 && round === 1 ? view.nodes : [])
    : [...(row.nodes ?? []), ...(row.branches ?? []).flatMap((branch) => branch.nodes)];
  const transitions = own.map((node) => ({ nodeId: node.nodeId, state: node.state, at: node.at }))
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  let current: string[] = [];
  if (!ENDED(view.run.status)) {
    const fork = view.run.fork;
    const working = fork === undefined ? [] : Object.values(fork.branches).filter((branch) => branch.state !== 'done').map((branch) => branch.currentNode);
    current = working.length > 0 ? working : view.run.currentNode === undefined ? [] : [view.run.currentNode];
  }
  return { round, transitions, current };
}

/** Whether a line shows in a round: `first` in round 1 only, `later` from round 2, `all` always. */
const shows = (rounds: string | undefined, round: number): boolean =>
  rounds === 'first' ? round === 1 : rounds === 'later' ? round >= 2 : true;

/**
 * Station, line and edge states for one round. `tools` are the contract's tools (an act node whose
 * tool declares `outsourcing` is worked by a resident AI agent). Hidden nodes draw no edges.
 */
export function stripState(graph: Pick<PackGraph, 'nodes' | 'edges'> & { readonly view?: PackView }, tools: ContractTools | undefined, facts: StripFacts): StripState {
  const view = graph.view;
  if (view === undefined) return { round: facts.round, stations: [], edges: [] };
  const hidden = new Set(view.hidden);
  const stationOf = new Map<string, string>();
  for (const station of view.stations) for (const item of station.checklist) for (const id of item.nodes) stationOf.set(id, station.id);

  // The latest transition of each node in this round says whether it has completed, and when.
  const latest = new Map<string, StripTransition>();
  for (const transition of facts.transitions) latest.set(transition.nodeId, transition);
  const completedAt = new Map<string, string>();
  for (const [id, transition] of latest) if (COMPLETED.has(transition.state)) completedAt.set(id, transition.at);
  const current = new Set(facts.current);

  const aiTools = new Set((tools ?? []).filter((tool) => tool.outsourcing !== undefined).map((tool) => tool.id));
  const aiNodes = new Set(graph.nodes.filter((node) => node.kind === 'act' && node.parameters.tool !== undefined && aiTools.has(node.parameters.tool)).map((node) => node.id));

  const perRow = new Map<number, string[]>();
  for (const station of view.stations) perRow.set(station.row, [...(perRow.get(station.row) ?? []), station.id]);

  const stations: StripStationView[] = view.stations.map((station) => {
    const lines: StripLine[] = station.checklist.map((item) => {
      const state: StripLineState = !shows(item.rounds, facts.round) ? 'hidden'
        : item.nodes.every((id) => completedAt.has(id)) ? 'done'
          : item.nodes.some((id) => current.has(id)) ? 'active' : 'pending';
      return { label: item.label, nodes: item.nodes, state };
    });
    const members = station.checklist.flatMap((item) => item.nodes);
    const shown = lines.filter((line) => line.state !== 'hidden');
    const state: StripStationState = members.some((id) => current.has(id)) ? 'active'
      : shown.length > 0 && shown.every((line) => line.state === 'done') ? 'done' : 'waiting';
    const row = perRow.get(station.row) ?? [station.id];
    const col = (row.length === 2 && row[1] === station.id ? 1 : 0) as 0 | 1;
    const activeNode = members.find((id) => current.has(id) && aiNodes.has(id));
    return {
      id: station.id, label: station.label, ...(station.about === undefined ? {} : { about: station.about }),
      row: station.row, col, span: (row.length === 2 ? 1 : 2) as 1 | 2, state,
      ai: members.some((id) => aiNodes.has(id)), ...(activeNode === undefined ? {} : { activeNode }), lines,
    };
  });
  const byId = new Map(stations.map((station) => [station.id, station]));

  // The nodes of each active station's current visit: its current nodes, and walking back along the
  // station's own (non-revisit) edges, every node completed in this round that led to them.
  const visit = new Set<string>();
  for (const id of current) {
    if (!stationOf.has(id)) continue;
    const walk = [id];
    for (let at = walk.pop(); at !== undefined; at = walk.pop()) {
      if (visit.has(at)) continue;
      visit.add(at);
      for (const edge of graph.edges) {
        if (edge.to !== at || edge.revisit === true || stationOf.get(edge.from) !== stationOf.get(at)) continue;
        if (completedAt.has(edge.from) && !visit.has(edge.from)) walk.push(edge.from);
      }
    }
  }

  const edges: StripEdgeView[] = [];
  const index = new Map<string, number>();
  for (const edge of graph.edges) {
    if (hidden.has(edge.from) || hidden.has(edge.to)) continue;
    const from = stationOf.get(edge.from), to = stationOf.get(edge.to);
    if (from === undefined || to === undefined || from === to) continue;
    const source = byId.get(from)!, target = byId.get(to)!;
    const lit = visit.has(edge.to) && completedAt.has(edge.from);
    const key = `${from}>${to}`;
    const at = index.get(key);
    if (at !== undefined) {
      if (lit && !edges[at]!.lit) edges[at] = { ...edges[at]!, lit: true };
      continue;
    }
    const kind: StripEdgeKind = target.row > source.row ? 'down' : 'back';
    const sideOf = (station: StripStationView) => (station.col === 1 ? 'right' : 'left') as 'left' | 'right';
    const side = kind === 'down' ? undefined : source.span === 1 ? sideOf(source) : target.span === 1 ? sideOf(target) : 'left';
    index.set(key, edges.length);
    edges.push({ from, to, kind, lit, ...(side === undefined ? {} : { side }) });
  }
  return { round: facts.round, stations, edges };
}

// ---------------------------------------------------------------------------------------------------
// Placement. Pixel units at scale 1 (an SVG user unit is a CSS pixel): the node square keeps the
// canvas's own 36 px, its label the 13 px label step, the checklist the 12 px eyebrow step.

export const STRIP_NODE = 36;
const HALF = STRIP_NODE / 2;
/** Room above a square for its rings (the AI ring at +2, the current-node ring at +4). */
const RING = 6;
/** One text line (label, activity, checklist). */
export const STRIP_LINE = 15;
/** Width estimates per character: 13 px semibold label, 12 px checklist and activity text. */
const LABEL_CHAR = 7, TEXT_CHAR = 6.3;
/** A checklist line's box and the gap before its text. */
export const STRIP_CHECK_INDENT = 15;
const ROW_GAP = 40, TOP = 8, BOTTOM = 12, COL_GAP = 14, LANE0 = 8, LANE_STEP = 8, PORT = 7;

/** A line of text, wrapped between words into at most `lines` lines of `max` characters; the last is
 *  ellipsized if the text runs on. */
export function wrapWords(text: string, max: number, lines = 2): readonly string[] {
  const out: string[] = [];
  let rest = text.trim();
  while (rest !== '' && out.length < lines) {
    if (rest.length <= max) { out.push(rest); rest = ''; break; }
    if (out.length === lines - 1) { out.push(`${rest.slice(0, Math.max(1, max - 1)).trimEnd()}…`); rest = ''; break; }
    const cut = rest.lastIndexOf(' ', max);
    const head = cut > 0 ? rest.slice(0, cut) : rest.slice(0, max);
    out.push(head);
    rest = rest.slice(head.length).trim();
  }
  return out;
}

export interface PlacedStripLine extends StripLine {
  /** Top of the line's check box; the text's first baseline is `y + 9`, each wrapped line 15 below. */
  readonly x: number; readonly y: number;
  readonly text: readonly string[];
}

export interface PlacedStation extends StripStationView {
  /** The square's centre. */
  readonly cx: number; readonly cy: number;
  /** The station's own block: its column and its height. */
  readonly left: number; readonly width: number; readonly top: number; readonly bottom: number;
  readonly labelLines: readonly string[];
  /** Baseline of the first activity line (an active AI station reserves two lines). */
  readonly activityY?: number;
  /** Characters an activity line may run to. */
  readonly textChars: number;
  readonly placedLines: readonly PlacedStripLine[];
}

export interface PlacedStripEdge extends StripEdgeView { readonly path: string }

export interface StripScene {
  readonly width: number; readonly height: number; readonly round: number;
  readonly stations: readonly PlacedStation[];
  readonly edges: readonly PlacedStripEdge[];
}

/** An orthogonal path through `points`, its corners rounded by `r`. */
function orthogonal(points: readonly (readonly [number, number])[], r = 6): string {
  const fmt = (n: number) => String(Math.round(n * 10) / 10);
  let d = `M${fmt(points[0]![0])} ${fmt(points[0]![1])}`;
  for (let i = 1; i < points.length; i++) {
    const [x, y] = points[i]!;
    const next = points[i + 1];
    if (next === undefined) { d += ` L${fmt(x)} ${fmt(y)}`; break; }
    const [px, py] = points[i - 1]!;
    const inLen = Math.hypot(x - px, y - py), outLen = Math.hypot(next[0] - x, next[1] - y);
    const k = Math.min(r, inLen / 2, outLen / 2);
    const ax = x - ((x - px) / (inLen || 1)) * k, ay = y - ((y - py) / (inLen || 1)) * k;
    const bx = x + ((next[0] - x) / (outLen || 1)) * k, by = y + ((next[1] - y) / (outLen || 1)) * k;
    d += ` L${fmt(ax)} ${fmt(ay)} Q${fmt(x)} ${fmt(y)} ${fmt(bx)} ${fmt(by)}`;
  }
  return d;
}

/** Evenly spread offsets for `n` ports around 0, `step` apart. */
const spread = (n: number, step: number): number[] => Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * step);

/**
 * Places a strip state in a pane `width` pixels wide (clamped to at least 280): rows top to bottom,
 * two stations side by side or one across, each a square with its label, an activity line while an
 * AI agent works there, and its checklist under it; down edges straight from a station's foot to the
 * next station's square; back edges in lanes along the outer sides, entering the square's side.
 */
export function layoutStrip(state: StripState, width: number): StripScene {
  const W = Math.max(280, Math.floor(width));
  const rows = [...new Set(state.stations.map((station) => station.row))].sort((a, b) => a - b);
  const sameRow = (edge: StripEdgeView) => state.stations.find((s) => s.id === edge.from)!.row === state.stations.find((s) => s.id === edge.to)!.row;
  const sideEdges = state.edges.filter((edge) => edge.kind === 'back' && !sameRow(edge));
  // One lane per back edge on its side, so two edges never read as one line; the margins keep every
  // station clear of them.
  const lanesOn = (side: 'left' | 'right') => sideEdges.filter((edge) => edge.side === side).length;
  const marginFor = (lanes: number) => Math.max(14, LANE0 + LANE_STEP * Math.max(0, lanes - 1) + 14);
  const ML = marginFor(lanesOn('left')), MR = marginFor(lanesOn('right'));
  const inner = W - ML - MR;
  const colWidth = (span: 1 | 2) => (span === 2 ? inner : (inner - COL_GAP) / 2);

  const placed: PlacedStation[] = [];
  let top = TOP;
  for (const row of rows) {
    const members = state.stations.filter((station) => station.row === row);
    let bottom = top;
    for (const station of members) {
      const w = colWidth(station.span);
      const left = station.span === 2 ? ML : station.col === 0 ? ML : ML + w + COL_GAP;
      const cx = left + w / 2, cy = top + RING + HALF;
      const labelLines = wrapWords(station.label, Math.max(8, Math.floor((w - 8) / LABEL_CHAR)));
      let y = cy + HALF + 20 + STRIP_LINE * (labelLines.length - 1);
      const textChars = Math.max(10, Math.floor((w - 8) / TEXT_CHAR));
      let activityY: number | undefined;
      if (station.ai && station.state === 'active') { activityY = y + STRIP_LINE; y += 2 * STRIP_LINE; }
      const shown = station.lines.filter((line) => line.state !== 'hidden');
      const lineChars = Math.max(8, Math.floor((w - 8 - STRIP_CHECK_INDENT) / TEXT_CHAR));
      const texts = shown.map((line) => wrapWords(line.label, lineChars, 3));
      const longest = Math.max(0, ...texts.flat().map((text) => text.length));
      const blockW = Math.min(w - 8, STRIP_CHECK_INDENT + longest * TEXT_CHAR);
      const x = Math.max(left + 4, cx - blockW / 2);
      let lineTop = y + 10;
      const placedLines: PlacedStripLine[] = [];
      const textOf = new Map(shown.map((line, i) => [line, texts[i]!]));
      for (const line of station.lines) {
        if (line.state === 'hidden') { placedLines.push({ ...line, x, y: lineTop, text: [] }); continue; }
        const text = textOf.get(line)!;
        placedLines.push({ ...line, x, y: lineTop, text });
        lineTop += STRIP_LINE * text.length + 3;
      }
      const stationBottom = (shown.length === 0 ? y + 4 : lineTop) + 2;
      bottom = Math.max(bottom, stationBottom);
      placed.push({ ...station, cx, cy, left, width: w, top, bottom: stationBottom, labelLines, ...(activityY === undefined ? {} : { activityY }), textChars, placedLines });
    }
    top = bottom + ROW_GAP;
  }
  const at = new Map(placed.map((station) => [station.id, station]));

  // Down edges: spread where several leave one foot or enter one square.
  const downs = state.edges.filter((edge) => edge.kind === 'down');
  const outX = new Map<string, number>(), inX = new Map<string, number>();
  for (const station of placed) {
    const leaving = downs.filter((edge) => edge.from === station.id).sort((a, b) => at.get(a.to)!.cx - at.get(b.to)!.cx);
    spread(leaving.length, 12).forEach((dx, i) => outX.set(`${leaving[i]!.from}>${leaving[i]!.to}`, dx));
    const entering = downs.filter((edge) => edge.to === station.id).sort((a, b) => at.get(a.from)!.cx - at.get(b.from)!.cx);
    spread(entering.length, 12).forEach((dx, i) => inX.set(`${entering[i]!.from}>${entering[i]!.to}`, dx));
  }

  // Back-edge ports on each square's side: leaving edges above, arriving ones below.
  const portY = new Map<string, number>();
  for (const station of placed) {
    for (const side of ['left', 'right'] as const) {
      const leaving = sideEdges.filter((edge) => edge.from === station.id && edge.side === side).sort((a, b) => at.get(a.to)!.row - at.get(b.to)!.row);
      const arriving = sideEdges.filter((edge) => edge.to === station.id && edge.side === side).sort((a, b) => at.get(a.from)!.row - at.get(b.from)!.row);
      const ports = [...leaving.map((edge) => `out:${edge.from}>${edge.to}`), ...arriving.map((edge) => `in:${edge.from}>${edge.to}`)];
      spread(ports.length, 14).forEach((dy, i) => portY.set(ports[i]!, station.cy + dy));
    }
  }

  // Lanes: the longer run outside; of two equal runs, the one reaching higher. Then a run's
  // horizontal ends never cross another run's vertical.
  const laneOf = new Map<string, number>();
  for (const side of ['left', 'right'] as const) {
    const runs = sideEdges.filter((edge) => edge.side === side).map((edge) => {
      const a = portY.get(`out:${edge.from}>${edge.to}`)!, b = portY.get(`in:${edge.from}>${edge.to}`)!;
      return { key: `${edge.from}>${edge.to}`, lo: Math.min(a, b), hi: Math.max(a, b) };
    }).sort((p, q) => (q.hi - q.lo) - (p.hi - p.lo) || p.lo - q.lo);
    runs.forEach((run, lane) => laneOf.set(run.key, lane));
  }

  const edges: PlacedStripEdge[] = state.edges.map((edge) => {
    const key = `${edge.from}>${edge.to}`;
    const source = at.get(edge.from)!, target = at.get(edge.to)!;
    if (edge.kind === 'down') {
      const x1 = source.cx + (outX.get(key) ?? 0), y1 = source.bottom + 2;
      const x2 = target.cx + (inX.get(key) ?? 0), y2 = target.cy - HALF - 5;
      return { ...edge, path: `M${x1.toFixed(1)} ${y1.toFixed(1)} L${x2.toFixed(1)} ${y2.toFixed(1)}` };
    }
    if (source.row === target.row) {
      const toRight = target.cx > source.cx;
      const x1 = source.cx + (toRight ? HALF + PORT : -HALF - PORT), x2 = target.cx + (toRight ? -HALF - PORT : HALF + PORT);
      return { ...edge, path: `M${x1.toFixed(1)} ${source.cy.toFixed(1)} L${x2.toFixed(1)} ${target.cy.toFixed(1)}` };
    }
    const left = edge.side === 'left';
    const lane = laneOf.get(key) ?? 0;
    const laneX = left ? LANE0 + LANE_STEP * lane : W - LANE0 - LANE_STEP * lane;
    const y1 = portY.get(`out:${key}`) ?? source.cy, y2 = portY.get(`in:${key}`) ?? target.cy;
    const x1 = source.cx + (left ? -HALF - PORT : HALF + PORT), x2 = target.cx + (left ? -HALF - PORT : HALF + PORT);
    return { ...edge, path: orthogonal([[x1, y1], [laneX, y1], [laneX, y2], [x2, y2]]) };
  });

  const height = Math.ceil((placed.length === 0 ? TOP : Math.max(...placed.map((station) => station.bottom))) + BOTTOM);
  return { width: W, height, round: state.round, stations: placed, edges };
}
