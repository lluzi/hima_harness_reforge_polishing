// The HimaFabric canvas: one SVG sized to its container, a transform group for zoom and pan, the
// scene `layoutCanvas` positioned drawn verbatim (every edge's `path` string, every frame's box,
// every node at its own `x`/`y`), the Goal roundel, and the attention strip above it all. Nothing
// here computes a coordinate; `canvas-layout.ts` already has.
import { useEffect, useRef, useState, type PointerEvent, type ReactElement } from 'react';
import { fitToWidth, labelsVisibleAt } from '../canvas-layout.js';
import type { CanvasScene, Frame, PlacedEdge } from '../canvas-layout.js';
import type { ExecutionContext } from '../fabric.js';
import { goalSaid, sealSaid } from '../card-labels.js';
import type { RunView } from '../remote.js';
import { FabricNode, HATCH_PATTERN_ID } from './FabricNode.js';
import { Glyph } from './glyphs.js';

export interface FabricCanvasProps {
  readonly runId: string;
  readonly scene: CanvasScene;
  readonly view: RunView | undefined;
  readonly context: ExecutionContext | undefined;
  readonly stale: boolean;
  readonly reducedMotion: boolean;
  /** The masthead already carries its own "Open Campaign Agent" for a non-owner (Side Talk); the
   *  attention strip offers the same link only for the owner, so the page never shows two controls
   *  under the one marker `open-owner` at once. */
  readonly isOwner: boolean;
  openOwner(id: string): void;
}

interface Transform { readonly scale: number; readonly tx: number; readonly ty: number }

const clampScale = (scale: number): number => Math.min(2, Math.max(0.4, scale));

/** One edge, drawn verbatim from its own `path`; a newly lit edge animates once, tracked by a ref
 *  so a later re-render (a poll that changes nothing about this edge) never restarts it. */
function Edge({ edge, litSeen }: { edge: PlacedEdge; litSeen: Set<string> }): ReactElement {
  const key = `${edge.from}->${edge.to}:${edge.kind}`;
  const firstLit = edge.lit && !litSeen.has(key);
  if (edge.lit) litSeen.add(key); else litSeen.delete(key);
  const dashed = edge.kind === 'revisit' || edge.kind === 'return';
  const arrowed = edge.kind === 'dependency' || edge.kind === 'outcome';
  const chipWidth = edge.chip === undefined ? 0 : edge.chip.text.length * 7 + 16;
  return (
    <g className={`hima-edge hima-edge-${edge.kind}${edge.lit ? ' hima-edge-lit' : ''}${firstLit ? ' hima-edge-lit-enter' : ''}`}>
      <path d={edge.path} className={`hima-edge-path${dashed ? ' hima-edge-dashed' : ''}`} markerEnd={arrowed ? `url(#${edge.lit ? 'hima-arrow-lit' : 'hima-arrow'})` : undefined} />
      {edge.chip === undefined ? null : (
        <g transform={`translate(${edge.chip.x},${edge.chip.y})`} className={`hima-edge-chip hima-edge-chip-${edge.chip.text.toLowerCase()}`}>
          <rect x={-chipWidth / 2} y={-9} width={chipWidth} height={18} rx={9} />
          <text y={4} textAnchor="middle">{edge.chip.text}</text>
        </g>
      )}
      {edge.badge === undefined ? null : (
        <g transform={`translate(${edge.badge.x},${edge.badge.y})`} className="hima-edge-badge">
          <rect x={-17} y={-9} width={34} height={18} rx={9} />
          <text y={4} textAnchor="middle">{`x${String(edge.badge.count)}`}</text>
        </g>
      )}
    </g>
  );
}

/** A Loop's or a growth's own frame: a collapsed pill hanging under its explore node, or an open
 *  dashed box around the nodes it now draws — the label is always shown, at every zoom. */
function FrameBox({ frame }: { frame: Frame }): ReactElement {
  const collapsed = !frame.open;
  return (
    <g className={`hima-frame hima-frame-${frame.kind}${collapsed ? ' hima-frame-collapsed' : ' hima-frame-open'}`} data-hima-region={`campaign-frame-${frame.id}`} data-hima-state-open={String(frame.open)}>
      <rect x={frame.x} y={frame.y} width={frame.width} height={frame.height} rx={collapsed ? frame.height / 2 : 10} className="hima-frame-box" />
      <text x={frame.x + frame.width / 2} y={collapsed ? frame.y + frame.height / 2 + 4 : frame.y - 8} textAnchor="middle" className="hima-frame-label">{frame.label}</text>
    </g>
  );
}

export function FabricCanvas({ runId, scene, view, context, stale, reducedMotion, isOwner, openOwner }: FabricCanvasProps): ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [viewport, setViewport] = useState({ width: 760, height: 618 });
  const [transform, setTransform] = useState<Transform>({ scale: 1, tx: 16, ty: 16 });
  const fittedFor = useRef<string>();
  // `ResizeObserver` never fires synchronously with mount, so the very first fit-to-width would
  // otherwise run against this state's placeholder guess rather than the container's real size —
  // and a later, correctly-measured resize would then read as "the running node left the viewport"
  // and recentre on it instead of refitting, throwing most of the scene off to one side. Nothing
  // fits until at least one real measurement has actually arrived.
  const measured = useRef(false);
  const dragging = useRef<{ x: number; y: number; tx: number; ty: number } | undefined>();
  const litSeen = useRef<Set<string>>(new Set()).current;

  useEffect(() => {
    const el = containerRef.current; if (el === null) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]; if (entry === undefined) return;
      measured.current = true;
      setViewport({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // A native listener, not React's `onWheel`: React attaches wheel listeners passively at the root,
  // so a synthetic handler's own `preventDefault` would silently do nothing and the page would
  // scroll under the canvas as well as zooming it.
  useEffect(() => {
    const el = svgRef.current; if (el === null) return;
    const onWheel = (event: globalThis.WheelEvent) => {
      event.preventDefault();
      const rect = el.getBoundingClientRect();
      const cx = event.clientX - rect.left, cy = event.clientY - rect.top;
      setTransform((previous) => {
        const next = clampScale(previous.scale * (event.deltaY < 0 ? 1.1 : 1 / 1.1));
        const ratio = next / previous.scale;
        return { scale: next, tx: cx - (cx - previous.tx) * ratio, ty: cy - (cy - previous.ty) * ratio };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const currentNode = scene.nodes.find((node) => node.current);

  // Fit to width the first time this Run's scene is seen; afterwards follow the running node,
  // recentring only once it would otherwise leave the viewport, over a 300 ms eased transition
  // (`.hima-canvas-transform`'s own CSS) unless reduced motion asks for none.
  useEffect(() => {
    if (!measured.current) return;
    if (fittedFor.current !== runId) {
      fittedFor.current = runId;
      setTransform(fitToWidth(scene, viewport));
      return;
    }
    if (currentNode === undefined || reducedMotion) return;
    setTransform((previous) => {
      const px = previous.tx + currentNode.x * previous.scale;
      const py = previous.ty + currentNode.y * previous.scale;
      const margin = 60;
      if (px >= margin && px <= viewport.width - margin && py >= margin && py <= viewport.height - margin) return previous;
      return { ...previous, tx: viewport.width / 2 - currentNode.x * previous.scale, ty: viewport.height / 2 - currentNode.y * previous.scale };
    });
    // Only the identity of the running node and the viewport's own size decide a re-centre; the
    // scene's other facts (a lit edge, a fresh log line) must never nudge the camera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, currentNode?.id, viewport.width, viewport.height]);

  const zoomBy = (factor: number): void => setTransform((previous) => {
    const next = clampScale(previous.scale * factor);
    const ratio = next / previous.scale;
    const cx = viewport.width / 2, cy = viewport.height / 2;
    return { scale: next, tx: cx - (cx - previous.tx) * ratio, ty: cy - (cy - previous.ty) * ratio };
  });
  const locate = (): void => {
    const target = currentNode ?? scene.nodes[scene.nodes.length - 1];
    if (target === undefined) return;
    setTransform((previous) => ({ scale: previous.scale, tx: viewport.width / 2 - target.x * previous.scale, ty: viewport.height / 2 - target.y * previous.scale }));
  };
  const onPointerDown = (event: PointerEvent<SVGSVGElement>): void => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragging.current = { x: event.clientX, y: event.clientY, tx: transform.tx, ty: transform.ty };
  };
  const onPointerMove = (event: PointerEvent<SVGSVGElement>): void => {
    const drag = dragging.current; if (drag === undefined) return;
    setTransform((previous) => ({ ...previous, tx: drag.tx + (event.clientX - drag.x), ty: drag.ty + (event.clientY - drag.y) }));
  };
  const onPointerUp = (): void => { dragging.current = undefined; };

  const labelsVisible = labelsVisibleAt(transform.scale);
  const run = view?.run;
  const ended = run?.status !== undefined && (run.status.startsWith('ended-') || run.status === 'cancelled');
  const goalText = run?.goal === undefined ? '' : goalSaid(run.goal, run.words);
  const seal = run?.status === undefined ? undefined : sealSaid(run.status, run.meters?.endedBy);

  const blocker = run?.status === 'waiting' ? view?.blockers.at(-1) : undefined;
  const fenceReason = context !== undefined && (context.budget.phase !== 'active' || context.reason !== undefined)
    ? context.reason ?? (context.budget.phase === 'exhausted' ? 'the Budget is exhausted' : 'the Budget is closing')
    : undefined;
  const attention = blocker !== undefined ? { kind: 'waiting' as const, reason: blocker.reason }
    : fenceReason !== undefined ? { kind: 'fence' as const, reason: fenceReason } : undefined;

  return (
    <div className="hima-canvas-wrap">
      {attention === undefined ? null : (
        <div className={`hima-canvas-attention hima-canvas-attention-${attention.kind}`} data-hima-region="campaign-attention" data-hima-state-kind={attention.kind}>
          <span>{attention.reason}</span>
          {attention.kind === 'waiting' && isOwner && run?.control?.owner !== undefined ? (
            <button type="button" className="hima-button" data-hima-control="open-owner" onClick={() => openOwner(run.control!.owner)}>Open Campaign Agent</button>
          ) : null}
        </div>
      )}
      <div className="hima-canvas" ref={containerRef} data-hima-region="campaign-graph"
        data-hima-state-nodes={String(scene.nodes.length)} data-hima-state-current={currentNode?.id ?? ''}
        data-hima-state-scale={transform.scale.toFixed(2)} data-hima-state-stale={String(stale)}>
        <svg ref={svgRef} width="100%" height="100%" viewBox={`0 0 ${viewport.width} ${viewport.height}`}
          className={stale ? 'hima-canvas-stale' : ''}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp}>
          <defs>
            <marker id="hima-arrow" viewBox="0 0 8 8" refX="7.5" refY="4" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M0 0.5L7.5 4L0 7.5z" className="hima-arrow-fill" />
            </marker>
            <marker id="hima-arrow-lit" viewBox="0 0 8 8" refX="7.5" refY="4" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M0 0.5L7.5 4L0 7.5z" className="hima-arrow-fill-lit" />
            </marker>
            <pattern id={HATCH_PATTERN_ID} width={6} height={6} patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
              <line x1={0} y1={0} x2={0} y2={6} className="hima-node-hatch-line" />
            </pattern>
          </defs>
          <g className="hima-canvas-transform" transform={`translate(${transform.tx},${transform.ty}) scale(${transform.scale})`}>
            {scene.frames.map((frame) => <FrameBox key={frame.id} frame={frame} />)}
            {scene.edges.map((edge, index) => <Edge key={`${edge.from}-${edge.to}-${edge.kind}-${String(index)}`} edge={edge} litSeen={litSeen} />)}
            {scene.nodes.map((node) => (
              <FabricNode key={`${node.frame ?? ''}/${node.id}`} node={node} runId={runId} labelsVisible={labelsVisible} reducedMotion={reducedMotion} onSelect={() => {}} />
            ))}
            <g data-hima-region="campaign-goal" data-hima-state-status={run?.status ?? ''} transform={`translate(${scene.goal.x},${scene.goal.y})`}>
              {ended ? (
                <>
                  <circle r={22} className="hima-goal-seal" />
                  <text className="hima-goal-title" y={5} textAnchor="middle">{seal?.title}</text>
                  {seal?.reason === '' || seal?.reason === undefined ? null : <text className="hima-goal-reason" y={40} textAnchor="middle">{seal.reason}</text>}
                </>
              ) : (
                <>
                  <circle r={22} className="hima-goal-roundel" />
                  <circle r={5} className="hima-goal-mark" />
                  <circle r={1.5} className="hima-goal-mark-dot" />
                  {goalText === '' ? null : <text className="hima-goal-label" y={40} textAnchor="middle">{goalText}</text>}
                </>
              )}
            </g>
          </g>
        </svg>
        <div className="hima-canvas-legend">
          <span><svg width={14} height={14} viewBox="0 0 14 14" aria-hidden="true"><rect x={1.5} y={3.5} width={11} height={7} rx={2.5} fill="none" stroke="currentColor" strokeWidth={1.3} /></svg>act</span>
          <span><svg width={14} height={14} viewBox="0 0 14 14" aria-hidden="true"><path d="M7 1l6 6-6 6-6-6z" fill="none" stroke="currentColor" strokeWidth={1.3} /></svg>judge</span>
          <span><Glyph name="circle" />explore</span>
          <span><Glyph name="octagon" />wait</span>
        </div>
        <div className="hima-canvas-tools">
          <button type="button" className="hima-icon-button" data-hima-control="canvas-locate" aria-label="Locate current node" onClick={locate}><Glyph name="locate" /></button>
          <button type="button" className="hima-icon-button" data-hima-control="canvas-zoom-in" aria-label="Zoom in" onClick={() => zoomBy(1.2)}><Glyph name="zoom-in" /></button>
          <button type="button" className="hima-icon-button" data-hima-control="canvas-zoom-out" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.2)}><Glyph name="zoom-out" /></button>
        </div>
      </div>
    </div>
  );
}
