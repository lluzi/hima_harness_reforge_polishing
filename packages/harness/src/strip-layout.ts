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
//   the target sits on a later row, a back edge otherwise. Each is drawn from square to square (see
//   Placement below); `side` stays the strip side the spec names for a back edge.
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
//
// Each station puts its square at the left of its column and its name, activity and checklist to the
// right of the square, so the column under every square is free. Every edge starts on its source
// square and ends on its target square: it leaves through the square's bottom (target below or on the
// same row) or top (target above), runs straight down the square column when the two squares line up,
// else turns once in the gap between the two rows, and enters the target square's top or bottom. The
// edges between one pair of stations run side by side, one each way; an edge that skips a row runs
// along a lane at the strip's left side. Edges never cross text.

export const STRIP_NODE = 36;
const HALF = STRIP_NODE / 2;
/** Room around a square for its rings (the AI ring at +2, the current-node ring at +4). */
const RING = 4;
/** One text line (label, activity, checklist); the type stays at 12-13 px. */
export const STRIP_LINE = 14;
/** Width estimates per character: 13 px semibold label, 12 px checklist and activity text. */
const LABEL_CHAR = 7, TEXT_CHAR = 6.3;
/** A checklist line's box and the gap before its text. */
export const STRIP_CHECK_INDENT = 15;
/** A station with more shown lines than this folds its leading done lines into one. */
export const STRIP_FOLD_OVER = 4;
const TOP = 6, BOTTOM = 8, COL_GAP = 12, MARGIN = 8, LANE0 = 6, LANE_STEP = 7;
/** From the square's right edge to its text. */
const TEXT_GAP = 10;
/** The least room between two rows. */
const ROW_GAP = 22;
/** Edges side by side on one square side; turns stacked in one row gap. */
const PORT_STEP = 7, CHANNEL_STEP = 7;
/** The least straight run before a square, so the arrowhead (up to 14 px when lit) sits on it. */
const ARROW_ROOM = 18;
const CORNER = 5;

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

export interface StripBox { readonly x: number; readonly y: number; readonly w: number; readonly h: number }

export interface PlacedStripLine extends StripLine {
  /** Top of the line's check box; the text's first baseline is `y + 9`, each wrapped line 14 below. */
  readonly x: number; readonly y: number;
  readonly text: readonly string[];
  /** The first of a folded run of done lines: how many lines this one line stands for. */
  readonly folds?: number;
  /** A done line folded into the line before it: not drawn. */
  readonly folded?: true;
}

export interface PlacedStation extends StripStationView {
  /** The square's centre. */
  readonly cx: number; readonly cy: number;
  /** The station's own block: its column and its height. */
  readonly left: number; readonly width: number; readonly top: number; readonly bottom: number;
  /** Where the label, activity and checklist start (left-aligned, right of the square). */
  readonly textX: number;
  /** The box every text of the station sits in: from `textX` to the column's right edge, from the
   *  label's top to the last checklist line. No edge enters it. */
  readonly textBox: StripBox;
  readonly labelLines: readonly string[];
  /** Baseline of the first label line. */
  readonly labelY: number;
  /** Baseline of the activity line; its tool-call count sits one line below (an active AI station
   *  reserves the two). */
  readonly activityY?: number;
  /** Characters an activity line may run to. */
  readonly textChars: number;
  readonly placedLines: readonly PlacedStripLine[];
}

export interface PlacedStripEdge extends StripEdgeView {
  readonly path: string;
  /** The orthogonal polyline the path rounds: first point on the source square, last on the target's. */
  readonly points: readonly (readonly [number, number])[];
}

export interface StripScene {
  readonly width: number; readonly height: number; readonly round: number;
  readonly stations: readonly PlacedStation[];
  readonly edges: readonly PlacedStripEdge[];
}

/** An orthogonal path through `points`, its corners rounded by `r`. */
function orthogonal(points: readonly (readonly [number, number])[], r = CORNER): string {
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

export interface StripWords {
  /** The folded line's count, e.g. "4 done". */
  readonly done: (n: number) => string;
}
const ENGLISH: StripWords = { done: (n) => `${String(n)} done` };

/** One line standing for a run of done lines: "First … Last · N done", shortened to fit `max`,
 *  the count always kept. */
export function foldedSaid(labels: readonly string[], max: number, words: StripWords = ENGLISH): string {
  const count = words.done(labels.length);
  const first = labels[0] ?? '', last = labels[labels.length - 1] ?? '';
  const full = `${first} … ${last} · ${count}`;
  if (full.length <= max) return full;
  const room = max - count.length - 3;
  if (room >= 8) return `${last.length <= room ? last : `${last.slice(0, room - 1).trimEnd()}…`} · ${count}`;
  return count;
}

/** A station's text, placed relative to the station's top. */
interface StationText {
  readonly labelLines: readonly string[]; readonly labelY: number; readonly activityY?: number;
  readonly textChars: number; readonly lines: readonly PlacedStripLine[]; readonly textBottom: number; readonly height: number;
}

function stationText(station: StripStationView, textX: number, textW: number, words: StripWords): StationText {
  const labelLines = wrapWords(station.label, Math.max(6, Math.floor(textW / LABEL_CHAR)));
  // The label's first line stands level with the square's top edge.
  const labelY = RING + 10;
  let y = labelY + STRIP_LINE * (labelLines.length - 1);
  const textChars = Math.max(8, Math.floor(textW / TEXT_CHAR));
  let activityY: number | undefined;
  if (station.ai && station.state === 'active') { activityY = y + STRIP_LINE; y += 2 * STRIP_LINE; }
  const shown = station.lines.filter((line) => line.state !== 'hidden');
  const lineChars = Math.max(6, Math.floor((textW - STRIP_CHECK_INDENT) / TEXT_CHAR));
  // More than four lines: the leading run of done lines folds into one, so the line being worked and
  // the ones after it stay in view while the ticks still count up.
  let run = 0;
  while (run < shown.length && shown[run]!.state === 'done') run += 1;
  const fold = shown.length > STRIP_FOLD_OVER && run >= 2 ? run : 0;
  const texts = shown.map((line, i) => (fold > 0 && i === 0 ? [foldedSaid(shown.slice(0, fold).map((l) => l.label), lineChars, words)]
    : fold > 0 && i < fold ? [] : wrapWords(line.label, lineChars, 3)));
  let lineTop = y + 6;
  const lines: PlacedStripLine[] = [];
  const indexOf = new Map(shown.map((line, i) => [line, i]));
  for (const line of station.lines) {
    const i = indexOf.get(line);
    if (i === undefined) { lines.push({ ...line, x: textX, y: lineTop, text: [] }); continue; }
    if (fold > 0 && i > 0 && i < fold) { lines.push({ ...line, x: textX, y: lineTop, text: [], folded: true }); continue; }
    const text = texts[i]!;
    lines.push({ ...line, x: textX, y: lineTop, text, ...(fold > 0 && i === 0 ? { folds: fold } : {}) });
    lineTop += STRIP_LINE * text.length + 1;
  }
  const textBottom = shown.length === 0 ? y + 4 : lineTop;
  return { labelLines, labelY, ...(activityY === undefined ? {} : { activityY }), textChars, lines, textBottom, height: Math.max(RING * 2 + STRIP_NODE, textBottom) + 1 };
}

type Side = 'top' | 'bottom';
/** The edges between one pair of stations (or one edge that skips rows), in their order side by side. */
interface Road {
  readonly key: string;
  /** The upper end (or, on one row, the left one) and the end it reaches. */
  readonly a: string; readonly b: string;
  readonly aSide: Side; readonly bSide: Side;
  readonly kind: 'adjacent' | 'same' | 'skip';
  readonly edges: StripEdgeView[];
}

/**
 * Places a strip state in a pane `width` pixels wide (clamped to at least 280): rows top to bottom,
 * two stations side by side or one across, each a square with its name, an activity line while an AI
 * agent works there, and its checklist to the square's right; edges from square to square.
 */
export function layoutStrip(state: StripState, width: number, words: StripWords = ENGLISH): StripScene {
  const W = Math.max(280, Math.floor(width));
  const rows = [...new Set(state.stations.map((station) => station.row))].sort((a, b) => a - b);
  const rowAt = new Map(rows.map((row, index) => [row, index]));
  const byId = new Map(state.stations.map((station) => [station.id, station]));

  // Roads: the edges between one pair of stations share one; an edge that skips a row has its own.
  const roads: Road[] = [];
  for (const edge of state.edges) {
    const source = byId.get(edge.from)!, target = byId.get(edge.to)!;
    const ra = rowAt.get(source.row)!, rb = rowAt.get(target.row)!;
    const kind = ra === rb ? 'same' : Math.abs(ra - rb) === 1 ? 'adjacent' : 'skip';
    const [a, b] = ra < rb || (ra === rb && source.col <= target.col) ? [source.id, target.id] : [target.id, source.id];
    const key = kind === 'skip' ? `skip:${edge.from}>${edge.to}` : `${a}|${b}`;
    const road = roads.find((candidate) => candidate.key === key);
    if (road !== undefined) { road.edges.push(edge); continue; }
    roads.push({ key, a, b, aSide: 'bottom', bSide: kind === 'same' ? 'bottom' : 'top', kind, edges: [edge] });
  }
  // Down edges first, then the edges back.
  for (const road of roads) road.edges.sort((p, q) => (p.from === road.a ? 0 : 1) - (q.from === road.a ? 0 : 1));
  const skips = roads.filter((road) => road.kind === 'skip');

  // Columns: a lane per skipping edge at the left; otherwise a plain margin.
  const ML = skips.length === 0 ? MARGIN : LANE0 + LANE_STEP * (skips.length - 1) + 10, MR = MARGIN;
  const inner = W - ML - MR;
  const colWidth = (span: 1 | 2) => (span === 2 ? inner : (inner - COL_GAP) / 2);
  const geometry = new Map(state.stations.map((station) => {
    const w = colWidth(station.span);
    const left = station.span === 2 || station.col === 0 ? ML : ML + w + COL_GAP;
    const cx = left + RING + HALF;
    const textX = cx + HALF + TEXT_GAP;
    return [station.id, { left, w, cx, textX, text: stationText(station, textX, left + w - textX, words) }] as const;
  }));
  const cxOf = (id: string) => geometry.get(id)!.cx;

  // Ports: on each square side, the roads in the order of where they go (left first), each road's
  // edges side by side in its own order, so no two edges of one side cross at the square.
  const port = new Map<string, number>(); // `${road}#${edge index}@${station}` -> x
  const sides = new Map<string, { road: Road; other: number }[]>();
  for (const road of roads) {
    const otherX = (id: string) => (road.kind === 'skip' ? -Infinity : cxOf(id));
    for (const [id, side, other] of [[road.a, road.aSide, road.b], [road.b, road.bSide, road.a]] as const) {
      const list = sides.get(`${id}:${side}`) ?? [];
      list.push({ road, other: otherX(other) });
      sides.set(`${id}:${side}`, list);
    }
  }
  const portCount = new Map<string, number>();
  for (const [key, list] of sides) {
    const id = key.slice(0, key.lastIndexOf(':'));
    list.sort((p, q) => p.other - q.other);
    const n = list.reduce((sum, item) => sum + item.road.edges.length, 0);
    portCount.set(key, n);
    const step = n > 1 ? Math.min(PORT_STEP, (STRIP_NODE - 12) / (n - 1)) : PORT_STEP;
    const offsets = spread(n, step);
    let at = 0;
    for (const { road } of list) road.edges.forEach((_, i) => port.set(`${road.key}#${String(i)}@${id}`, cxOf(id) + offsets[at++]!));
  }
  // Two squares one above the other: the side with fewer edges takes the other side's places, so the
  // road runs straight.
  for (const road of roads) {
    if (road.kind !== 'adjacent' || Math.abs(cxOf(road.a) - cxOf(road.b)) > 0.5) continue;
    const na = portCount.get(`${road.a}:${road.aSide}`)!, nb = portCount.get(`${road.b}:${road.bSide}`)!;
    if (na === nb) continue;
    const [lead, follow] = na > nb ? [road.a, road.b] : [road.b, road.a];
    if ((sides.get(`${follow}:${follow === road.a ? road.aSide : road.bSide}`) ?? []).length !== 1) continue;
    road.edges.forEach((_, i) => port.set(`${road.key}#${String(i)}@${follow}`, port.get(`${road.key}#${String(i)}@${lead}`)!));
  }
  const portX = (road: Road, i: number, id: string) => port.get(`${road.key}#${String(i)}@${id}`)!;

  // Turns: each edge that does not run straight turns in a row gap, at its own level there. Of a road
  // turning right, the rightmost edge turns highest; turning left, the leftmost: so they never cross.
  const levels = new Map<string, number>(); // `${road}#${i}:${gap}` -> level
  const levelCount = new Map<number, number>();
  const take = (gap: number, key: string) => { const n = levelCount.get(gap) ?? 0; levels.set(`${key}:${String(gap)}`, n); levelCount.set(gap, n + 1); };
  const ordered = [...roads].sort((p, q) => Math.min(cxOf(p.a), cxOf(p.b)) - Math.min(cxOf(q.a), cxOf(q.b)));
  for (const road of ordered) {
    const ga = rowAt.get(byId.get(road.a)!.row)!, gb = rowAt.get(byId.get(road.b)!.row)! - 1;
    const order = road.edges.map((_, i) => i);
    if (road.kind === 'adjacent') {
      if (road.edges.every((_, i) => Math.abs(portX(road, i, road.a) - portX(road, i, road.b)) < 0.5)) continue;
      if (cxOf(road.b) > cxOf(road.a)) order.reverse();
    }
    for (const i of order) take(ga, `${road.key}#${String(i)}`);
    if (road.kind === 'skip') for (const i of order) take(gb, `${road.key}#${String(i)}`);
  }

  // Rows top to bottom; each gap holds its turns, with room for an arrowhead on either side.
  const placed: PlacedStation[] = [];
  const gapStart = new Map<number, number>();
  let top = TOP;
  rows.forEach((row, index) => {
    const members = state.stations.filter((station) => station.row === row);
    let bottom = top;
    for (const station of members) {
      const g = geometry.get(station.id)!;
      const t = g.text;
      const shift = (n: number) => top + n;
      bottom = Math.max(bottom, top + t.height);
      placed.push({
        ...station, cx: g.cx, cy: top + RING + HALF, left: g.left, width: g.w, top, bottom: top + t.height, textX: g.textX,
        textBox: { x: g.textX, y: top + RING - 1, w: g.left + g.w - g.textX, h: t.textBottom - RING + 1 },
        labelLines: t.labelLines, labelY: shift(t.labelY), ...(t.activityY === undefined ? {} : { activityY: shift(t.activityY) }),
        textChars: t.textChars, placedLines: t.lines.map((line) => ({ ...line, y: shift(line.y) })),
      });
    }
    const squareBottom = top + RING + STRIP_NODE;
    const start = Math.max(bottom + 6, squareBottom + ARROW_ROOM);
    gapStart.set(index, start);
    const turns = levelCount.get(index) ?? 0;
    const lastTurn = turns === 0 ? bottom : start + CHANNEL_STEP * (turns - 1);
    top = Math.max(bottom + ROW_GAP, lastTurn + ARROW_ROOM - RING);
  });
  const at = new Map(placed.map((station) => [station.id, station]));
  const sideY = (id: string, side: Side) => { const s = at.get(id)!; return side === 'top' ? s.cy - HALF : s.cy + HALF; };
  const levelY = (key: string, gap: number) => gapStart.get(gap)! + CHANNEL_STEP * levels.get(`${key}:${String(gap)}`)!;

  const edges: PlacedStripEdge[] = [];
  for (const road of roads) {
    const ga = rowAt.get(byId.get(road.a)!.row)!, gb = rowAt.get(byId.get(road.b)!.row)! - 1;
    road.edges.forEach((edge, i) => {
      const key = `${road.key}#${String(i)}`;
      const xa = portX(road, i, road.a), xb = portX(road, i, road.b);
      const ya = sideY(road.a, road.aSide), yb = sideY(road.b, road.bSide);
      let points: [number, number][];
      if (road.kind === 'skip') {
        const lane = LANE0 + LANE_STEP * skips.indexOf(road);
        const g1 = levelY(key, ga), g2 = levelY(key, gb);
        points = [[xa, ya], [xa, g1], [lane, g1], [lane, g2], [xb, g2], [xb, yb]];
      } else if (Math.abs(xa - xb) < 0.5) {
        points = [[xa, ya], [xb, yb]];
      } else {
        const g = levelY(key, ga);
        points = [[xa, ya], [xa, g], [xb, g], [xb, yb]];
      }
      if (edge.from !== road.a) points.reverse();
      edges.push({ ...edge, path: orthogonal(points), points });
    });
  }
  // Keep the state's edge order.
  const order = new Map(state.edges.map((edge, index) => [`${edge.from}>${edge.to}`, index]));
  edges.sort((p, q) => order.get(`${p.from}>${p.to}`)! - order.get(`${q.from}>${q.to}`)!);

  const lastGap = gapStart.get(rows.length - 1);
  const lastTurns = levelCount.get(rows.length - 1) ?? 0;
  const contentBottom = placed.length === 0 ? TOP : Math.max(...placed.map((station) => station.bottom));
  const height = Math.ceil(Math.max(contentBottom, lastTurns === 0 || lastGap === undefined ? 0 : lastGap + CHANNEL_STEP * (lastTurns - 1)) + BOTTOM);
  return { width: W, height, round: state.round, stations: placed, edges };
}
