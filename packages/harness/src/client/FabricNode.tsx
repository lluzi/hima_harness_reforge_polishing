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
 *  place raw output reaches the canvas, and only ever the bounded tail the Host already caps. */
function useLastLogLine(runId: string, nodeId: string, active: boolean): string | undefined {
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

/** The determinate bar under a node whose state carries a fraction: a running node's own progress, or
 *  a blocked/cancelled node's spent allowance shown full.
 *
 *  `PlacedNode.progress` is reserved: nothing in `RunView`/`ExecutionContext` reports a running
 *  node's fractional progress today, so this bar never actually draws for `running` in practice — it
 *  draws the day a source for that number exists, without a second change here. */
function StateBar({ node }: { node: PlacedNode }): ReactElement | null {
  const fraction = node.state === 'running' ? node.progress : node.state === 'blocked' || node.state === 'cancelled' ? 1 : undefined;
  if (fraction === undefined) return null;
  return <g className={`hima-node-bar hima-node-bar-${node.state}`} transform={`translate(${-HALF},${HALF + 10})`}>
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
  onSelect(id: string): void;
}

export function FabricNode({ node, runId, labelsVisible, reducedMotion, selected, onSelect }: FabricNodeProps): ReactElement {
  const running = node.current && node.state === 'running';
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
      <rect data-hima-control={`node-${node.id}`} x={-HALF} y={-HALF} width={NODE} height={NODE} fill="transparent" pointerEvents="all" />
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
        {logLine === undefined ? null : <text className="hima-node-log" y={labelY + 30} textAnchor="middle">{truncate(logLine, 40)}<title>{logLine}</title></text>}
      </g>
    </g>
  );
}
