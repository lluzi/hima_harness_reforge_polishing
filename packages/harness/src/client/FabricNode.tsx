// One node's own form, state glyph, caption and marks — the shapes `docs/specs/campaign-workspace-ui`
// fixes: act a rounded rect, judge a diamond, explore a circle with a small chooser mark, wait an
// octagon. State is shape and colour together (Global Constraints): every state below draws its own
// glyph on top of the kind's own form, never colour alone. Coordinates come from `PlacedNode` alone —
// nothing here computes a position.
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { NODE, PITCH } from '../canvas-layout.js';
import type { NodeKind, PlacedNode } from '../canvas-layout.js';
import { fetchLogTail } from './api.js';
import { Glyph } from './glyphs.js';

/** The `<pattern>` id `FabricCanvas` declares once in its own `<defs>` for an affected node's hatch
 *  fill; shared here so the two files agree on one id without a third module for a single string. */
export const HATCH_PATTERN_ID = 'hima-node-hatch';

const HALF = NODE / 2;

/** A rough width estimate for the sans-serif label font at 13 px — every id and caption fits inside
 *  one node's own pitch (90 units) rather than reading into its neighbour's, at any zoom, because the
 *  text scales with the same transform as the pitch does. Not a measured width (no DOM to measure
 *  against in a pure layout pass); a hair conservative is what a canvas that must never overlap a
 *  reader's next node wants. */
const LABEL_CHAR_WIDTH_PX = 6.5;
const LABEL_PADDING_PX = 8;
const LABEL_MAX_CHARS = Math.floor((PITCH - LABEL_PADDING_PX) / LABEL_CHAR_WIDTH_PX);

/** A caption, id or goal word shown at a glance, one line, ellipsized rather than wrapped; the full
 *  text always travels in a `<title>` so a person can still read it by hovering. Exported for
 *  `FabricCanvas`'s own Goal roundel label, which reads at the same 13 px font and must fit inside
 *  one node's own pitch exactly as a node's id or caption does. */
export function truncate(text: string, max = LABEL_MAX_CHARS): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** The running node's own last log line, polled every 2 s while it stays the running node — the one
 *  place raw output reaches the canvas, and only ever the bounded tail the Host already caps.
 *  Exported for the Diagnostics sheet (#41 task 8), which reads the same current node's own line
 *  rather than a second poll of its own. */
export function useLastLogLine(runId: string, nodeId: string, active: boolean): string | undefined {
  const [line, setLine] = useState<string>();
  useEffect(() => {
    if (!active) { setLine(undefined); return; }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      const result = await fetchLogTail(runId, nodeId, 1, controller.signal);
      if (controller.signal.aborted) return;
      if (result.ok) setLine(result.value.lines.at(-1));
      timer = setTimeout(() => { void poll(); }, 2000);
    };
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [runId, nodeId, active]);
  return line;
}

/**
 * A kind's own outline alone — no state colour, no fill logic — at any half-width. Shared by the
 * node's own 36 px form (`NodeShape`), the legend's 12 px icons and the current node's 44 px ring, so
 * "the legend shows the real node forms" and "the current ring matches its own node's shape" are both
 * true of the one function that draws a kind rather than three drawings that could drift apart.
 *
 * `mark` draws the explore kind's small inner chooser circle, proportional to `half`; the legend asks
 * for it (the real form, chooser mark included) and the current-node ring does not (a ring around an
 * already-marked shape needs no second one).
 */
export function KindOutline({ kind, half = HALF, mark = false }: { kind: NodeKind; half?: number; mark?: boolean }): ReactElement {
  switch (kind) {
    case 'act':
      return <rect x={-half} y={-half} width={half * 2} height={half * 2} rx={half / 3} />;
    case 'judge':
      return <path d={`M 0 ${-half} L ${half} 0 L 0 ${half} L ${-half} 0 Z`} />;
    case 'explore':
      return <>
        <circle r={half} />
        {mark ? <circle r={half / 4.5} className="hima-node-mark-chooser" /> : null}
      </>;
    case 'wait': {
      const k = half * 0.414;
      return <path d={`M ${-k} ${-half} L ${k} ${-half} L ${half} ${-k} L ${half} ${k} L ${k} ${half} L ${-k} ${half} L ${-half} ${k} L ${-half} ${-k} Z`} />;
    }
    default: { const exhaustive: never = kind; void exhaustive; return <></>; }
  }
}

function NodeShape({ node }: { node: PlacedNode }): ReactElement {
  const fillClass = node.revised === 'affected' ? { fill: `url(#${HATCH_PATTERN_ID})` } : {};
  return <g className="hima-node-shape" {...fillClass}><KindOutline kind={node.kind} mark={node.kind === 'explore'} /></g>;
}

/** The current node's own distinct ring — the mockup's own accent ring, 2 px, offset 4 px past the
 *  node's own form — in addition to (never instead of) its state's own shape and colour. */
function CurrentRing({ node }: { node: PlacedNode }): ReactElement {
  return <g className="hima-node-current-ring"><KindOutline kind={node.kind} half={HALF + 4} /></g>;
}

/** The selected node's own halo — the same accent as `available`/`CurrentRing`, offset 6 px past the
 *  node's own form at 40% opacity, so a selected node reads distinctly from the current-node ring
 *  (which sits at 4 px, full opacity) without either one crowding the other when a person selects the
 *  currently-running node. Drawn with the same `KindOutline` every other ring here shares, so the
 *  halo always matches its own node's real shape. */
function SelectedHalo({ node }: { node: PlacedNode }): ReactElement {
  return <g className="hima-node-selected-halo"><KindOutline kind={node.kind} half={HALF + 6} /></g>;
}

/** The state glyph: a small mark centred on the node, layered over its own kind-shape. Absent for
 *  `pending`/`available`, whose hollow-or-accent stroke is the whole of what they say. */
function StateGlyph({ node, motionOff }: { node: PlacedNode; motionOff: boolean }): ReactElement | null {
  switch (node.state) {
    case 'pending': case 'available': return null;
    case 'running':
      return <g className="hima-node-running-mark">
        <circle r={4} className="hima-node-running-dot" />
        {motionOff ? null : <circle r={8} className="hima-node-running-pulse" />}
      </g>;
    case 'waiting-for-slot':
      return <g transform="translate(-8,-8)" className="hima-node-glyph-waiting"><Glyph name="hourglass" size={16} /></g>;
    case 'retrying':
      return <g transform="translate(-8,-8)" className="hima-node-glyph-retrying"><Glyph name="retry" size={16} /></g>;
    case 'blocked':
      return <><g transform="translate(-8,-8)" className="hima-node-glyph-blocked"><Glyph name="square" size={16} /></g>
        <circle cx={HALF} cy={-HALF} r={4} className="hima-node-badge-blocked" /></>;
    case 'cancelled':
      return <g transform="translate(-8,-8)" className="hima-node-glyph-cancelled"><Glyph name="square" size={16} /></g>;
    case 'done':
      return <g transform="translate(-8,-8)" className="hima-node-glyph-done"><Glyph name="check" size={16} /></g>;
    case 'reconciled':
      return <><g transform="translate(-8,-8)" className="hima-node-glyph-reconciled"><Glyph name="ring" size={16} /></g>
        <line x1={-10} y1={HALF + 4} x2={10} y2={HALF + 4} className="hima-node-dashed-segment" /></>;
    default: { const exhaustive: never = node.state; void exhaustive; return null; }
  }
}

/** The determinate bar under a blocked or cancelled node: its spent allowance, shown full. There is
 *  no running-node progress bar — nothing in `RunView`/`ExecutionContext` ever reports a running
 *  node's fractional progress, so `PlacedNode` carries no `progress` field for this to read (removed
 *  rather than kept as a chain with no producer). */
function StateBar({ node }: { node: PlacedNode }): ReactElement | null {
  const fraction = node.state === 'blocked' || node.state === 'cancelled' ? 1 : undefined;
  if (fraction === undefined) return null;
  // `HALF + 4`, not `HALF + 10`: the id label sits at `HALF + 20` (`labelY` below), and a bar drawn
  // any lower than +4 strikes through that 13px text (finding C2) — +4 clears the node's own shape
  // with room to spare and stays well clear of the label line.
  return <g className={`hima-node-bar hima-node-bar-${node.state}`} transform={`translate(${-HALF},${HALF + 4})`}>
    <rect className="hima-node-bar-track" width={NODE} height={3} rx={1.5} />
    <rect className="hima-node-bar-fill" width={NODE * Math.min(1, Math.max(0, fraction))} height={3} rx={1.5} />
  </g>;
}

export interface FabricNodeProps {
  readonly node: PlacedNode;
  readonly runId: string;
  readonly labelsVisible: boolean;
  /** Reduced motion, or a stale snapshot — the caller ORs the two before handing this down, since a
   *  stale canvas stops every animation exactly as reduced motion does. */
  readonly reducedMotion: boolean;
  readonly selected: boolean;
  /** A3: this node is the Run's own current node, sitting `available` while the Run's own status is
   *  `running` — the Campaign Agent has not yet begun it. Drawn as the node's own caption line so a
   *  screenshot of a "running" Run never shows a node that looks merely idle with no explanation. */
  readonly awaitingAgent?: boolean;
  onSelect(id: string): void;
}

export function FabricNode({ node, runId, labelsVisible, reducedMotion, selected, awaitingAgent, onSelect }: FabricNodeProps): ReactElement {
  // C19: the log-tail poll never runs while stale/reduced-motion (the caller hands this component
  // `reducedMotion || stale` as one flag, `FabricCanvas.tsx`) — a stale node is already showing a
  // frozen fact, not a live one, so polling for a fresh log line underneath it would only ever
  // answer with output nobody watching believes is still current.
  const running = node.current && node.state === 'running' && !reducedMotion;
  const logLine = useLastLogLine(runId, node.id, running);
  const labelY = HALF + 20;
  return (
    <g
      data-hima-region={`campaign-node-${node.id}`}
      data-hima-state-kind={node.kind}
      data-hima-state-state={node.state}
      data-hima-state-current={String(node.current)}
      data-hima-state-selected={String(selected)}
      className={`hima-node hima-node-${node.kind} hima-node-state-${node.state}${node.current ? ' hima-node-current' : ''}${node.state === 'cancelled' ? ' hima-node-faded' : ''}${selected ? ' hima-node-selected' : ''}`}
      transform={`translate(${node.x},${node.y})`}
      role="button"
      tabIndex={0}
      onClick={() => onSelect(node.id)}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(node.id); } }}
    >
      {/* A driver's own click lands at the centre of the marked element's bounding box — which for
          this `<g>` includes the label text below the shape, so that centre can fall in the empty
          gap where an SVG group paints nothing. This transparent rect is the node's own square hit
          area (NODE units on each side), first so later siblings (the ring, the shape itself) still
          paint over it, and it is what actually carries `data-hima-control`: the click marker and
          the node's own paint area are the same rectangle, so a driver's centre-of-bounding-box
          click always lands on it. */}
      {/* US21: a person hovering the node's own group reads its id, kind and state at a glance,
          plus its caption when the Pack gave it one — the same words the label and caption texts
          below already show, gathered into one tooltip so hovering anywhere on the node (not only
          its label text) reads them. */}
      <title>{`${node.id} · ${node.kind} · ${node.state}${node.caption === undefined ? '' : ` · ${node.caption}`}`}</title>
      <rect data-hima-control={`node-${node.id}`} x={-HALF} y={-HALF} width={NODE} height={NODE} fill="transparent" pointerEvents="all" />
      {selected ? <SelectedHalo node={node} /> : null}
      {node.current ? <CurrentRing node={node} /> : null}
      <NodeShape node={node} />
      <StateGlyph node={node} motionOff={reducedMotion} />
      <StateBar node={node} />
      {node.revised === 'changed' ? <path className="hima-node-mark-changed" d={`M ${HALF - 6} ${-HALF} L ${HALF} ${-HALF} L ${HALF} ${-HALF + 6} Z`} /> : null}
      {node.waitedForSlot && node.state === 'done' ? <g transform={`translate(${HALF - 10},${HALF - 10})`} className="hima-node-mark-waited"><Glyph name="hourglass" size={10} /></g> : null}
      <g className={`hima-node-labels${labelsVisible ? '' : ' hima-node-labels-hidden'}`}>
        <text className="hima-node-label" y={labelY} textAnchor="middle">{truncate(node.id)}<title>{node.id}</title></text>
        {node.caption === undefined ? null : (
          <text className="hima-node-caption" y={labelY + 15} textAnchor="middle">{truncate(node.caption)}<title>{node.caption}</title></text>
        )}
        {/* A3: drawn on its own line, below the Pack's own caption (if any) rather than replacing
            it — a node's declared caption and "the Run is running but has not yet begun this node"
            are two different facts, never folded into one truncated line. */}
        {awaitingAgent !== true ? null : (
          <text className="hima-node-caption" y={labelY + (node.caption === undefined ? 15 : 30)} textAnchor="middle">
            awaiting the Campaign Agent<title>awaiting the Campaign Agent</title>
          </text>
        )}
        {logLine === undefined ? null : <text className="hima-node-log" y={labelY + 30} textAnchor="middle">{truncate(logLine, 40)}<title>{logLine}</title></text>}
      </g>
    </g>
  );
}
