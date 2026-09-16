// One node's own form, state glyph, caption and marks — the shapes `docs/specs/campaign-workspace-ui`
// fixes: act a rounded rect, judge a diamond, explore a circle with a small chooser mark, wait an
// octagon. State is shape and colour together (Global Constraints): every state below draws its own
// glyph on top of the kind's own form, never colour alone. Coordinates come from `PlacedNode` alone —
// nothing here computes a position.
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { NODE } from '../canvas-layout.js';
import type { PlacedNode } from '../canvas-layout.js';
import { fetchLogTail } from './api.js';
import { Glyph } from './glyphs.js';

/** The `<pattern>` id `FabricCanvas` declares once in its own `<defs>` for an affected node's hatch
 *  fill; shared here so the two files agree on one id without a third module for a single string. */
export const HATCH_PATTERN_ID = 'hima-node-hatch';

const HALF = NODE / 2;
const OCTAGON_K = HALF * 0.414;

/** A caption shown at a glance, one line, ellipsized rather than wrapped; the full text always
 *  travels in a `<title>` so a person can still read it by hovering. */
function truncate(text: string, max = 12): string {
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

function NodeShape({ node }: { node: PlacedNode }): ReactElement {
  const fillClass = node.revised === 'affected' ? { fill: `url(#${HATCH_PATTERN_ID})` } : {};
  switch (node.kind) {
    case 'act':
      return <rect className="hima-node-shape" x={-HALF} y={-HALF} width={NODE} height={NODE} rx={6} {...fillClass} />;
    case 'judge':
      return <path className="hima-node-shape" d={`M 0 ${-HALF} L ${HALF} 0 L 0 ${HALF} L ${-HALF} 0 Z`} {...fillClass} />;
    case 'explore':
      return <><circle className="hima-node-shape" r={HALF} {...fillClass} /><circle className="hima-node-mark-chooser" r={4} /></>;
    case 'wait': {
      const k = OCTAGON_K;
      return <path className="hima-node-shape" {...fillClass}
        d={`M ${-k} ${-HALF} L ${k} ${-HALF} L ${HALF} ${-k} L ${HALF} ${k} L ${k} ${HALF} L ${-k} ${HALF} L ${-HALF} ${k} L ${-HALF} ${-k} Z`} />;
    }
    default: { const exhaustive: never = node.kind; void exhaustive; return <></>; }
  }
}

/** The state glyph: a small mark centred on the node, layered over its own kind-shape. Absent for
 *  `pending`/`available`, whose hollow-or-accent stroke is the whole of what they say. */
function StateGlyph({ node, reducedMotion }: { node: PlacedNode; reducedMotion: boolean }): ReactElement | null {
  switch (node.state) {
    case 'pending': case 'available': return null;
    case 'running':
      return <g className="hima-node-running-mark">
        <circle r={4} className="hima-node-running-dot" />
        {reducedMotion ? null : <circle r={8} className="hima-node-running-pulse" />}
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

/** The determinate bar under a node whose state carries a fraction: a running node's own progress,
 *  or a blocked/cancelled node's spent allowance shown full. */
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
  readonly reducedMotion: boolean;
  onSelect(id: string): void;
}

export function FabricNode({ node, runId, labelsVisible, reducedMotion, onSelect }: FabricNodeProps): ReactElement {
  const running = node.current && node.state === 'running';
  const logLine = useLastLogLine(runId, node.id, running);
  const labelY = HALF + 20;
  return (
    <g
      data-hima-region={`campaign-node-${node.id}`}
      data-hima-state-kind={node.kind}
      data-hima-state-state={node.state}
      data-hima-state-current={String(node.current)}
      data-hima-control={`node-${node.id}`}
      className={`hima-node hima-node-${node.kind} hima-node-state-${node.state}${node.current ? ' hima-node-current' : ''}${node.state === 'cancelled' ? ' hima-node-faded' : ''}`}
      transform={`translate(${node.x},${node.y})`}
      role="button"
      tabIndex={0}
      onClick={() => onSelect(node.id)}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(node.id); } }}
    >
      <NodeShape node={node} />
      <StateGlyph node={node} reducedMotion={reducedMotion} />
      <StateBar node={node} />
      {node.revised === 'changed' ? <path className="hima-node-mark-changed" d={`M ${HALF - 6} ${-HALF} L ${HALF} ${-HALF} L ${HALF} ${-HALF + 6} Z`} /> : null}
      {node.waitedForSlot && node.state === 'done' ? <g transform={`translate(${HALF - 10},${HALF - 10})`} className="hima-node-mark-waited"><Glyph name="hourglass" size={10} /></g> : null}
      <g className={`hima-node-labels${labelsVisible ? '' : ' hima-node-labels-hidden'}`}>
        <text className="hima-node-label" y={labelY} textAnchor="middle">{truncate(node.id, 11)}<title>{node.id}</title></text>
        {node.caption === undefined ? null : (
          <text className="hima-node-caption" y={labelY + 15} textAnchor="middle">{truncate(node.caption)}<title>{node.caption}</title></text>
        )}
        {logLine === undefined ? null : <text className="hima-node-log" y={labelY + 30} textAnchor="middle">{truncate(logLine, 40)}<title>{logLine}</title></text>}
      </g>
    </g>
  );
}
