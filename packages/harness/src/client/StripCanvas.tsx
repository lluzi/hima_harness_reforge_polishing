// The strip: the Live view of a Run whose Pack graph declares `view` (graph.yml) — a phone-width
// column of stations, each a node with its checklist for the current round, in place of the full
// canvas. `strip-layout.ts` decides every state and coordinate; this draws them with the canvas's own
// pieces (node square, state glyph, AI ring, current ring, check marks, edge styles), so the strip
// looks like the canvas it replaces. It does not pan or zoom: it fits the pane's width and scrolls down.
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import type { PlacedNode } from '../canvas-layout.js';
import type { ExecutionContext } from '../fabric.js';
import type { PackContract, PackGraph } from '../packs.js';
import type { RunView } from '../remote.js';
import { layoutStrip, stripFacts, stripState, STRIP_LINE, type PlacedStation } from '../strip-layout.js';
import { CanvasAttention, ExecutionMarkers } from './FabricCanvas.js';
import { AI_RING_ID, AI_RING_LIVE_ID, AiRing, CheckMark, CurrentRing, NodeShape, StateGlyph, truncate } from './FabricNode.js';
import { activityKindKey, aiWorking, engineeringActivityOf } from './engineering-activity.js';
import type { Acting } from './HimaRunCard.js';
import { labelKeyed, useHimaT } from './locale/index.js';
import { bestHeadline } from './results-view.js';
import { labelled, runStatusLabel } from '../card-labels.js';

export interface StripCanvasProps {
  readonly graph: PackGraph;
  readonly contract: PackContract;
  readonly view: RunView | undefined;
  readonly context: ExecutionContext | undefined;
  readonly stale: boolean;
  readonly reducedMotion: boolean;
  readonly isOwner: boolean;
  openOwner(id: string): void;
  readonly acting: Acting;
}

const LINE_STATE = { done: 'done', active: 'running', pending: 'pending', hidden: 'pending' } as const;
const STATION_STATE = { active: 'running', done: 'done', waiting: 'pending' } as const;

/** A Goal value as the top line says it: signed, with the headline's unit. */
function targetSaid(value: number, unit: string | undefined): string {
  return `${value > 0 ? '+' : ''}${String(value)}${unit === undefined ? '' : ` ${unit}`}`;
}

/** "Round k · best +x.xx % · target +y %", each part only when known; an ended Run adds its seal. */
function TopLine({ round, contract, view }: { round: number; contract: PackContract; view: RunView | undefined }): ReactElement {
  const t = useHimaT();
  const results = contract.results;
  const best = results === undefined || view === undefined ? undefined : bestHeadline(results, view);
  const headline = results?.headline;
  const goal = headline === undefined ? undefined : view?.run.goal?.[headline.type];
  const status = view?.run.status;
  const ended = status !== undefined && (status.startsWith('ended-') || status === 'cancelled');
  const parts = [
    t('strip.round', { n: round }),
    ...(best === undefined ? [] : [t('strip.best', { value: best.display })]),
    ...(goal === undefined ? [] : [t('strip.target', { value: targetSaid(goal, headline?.unit) })]),
  ];
  return (
    <p className="hima-strip-top" data-hima-region="strip-top" data-hima-state-round={String(round)}>
      <span>{parts.join(' · ')}</span>
      {!ended ? null : <span className={`hima-masthead-seal hima-masthead-seal-${status}`}>{' · '}{labelKeyed(t, `status.${status}`, labelled(runStatusLabel, status).said)}</span>}
    </p>
  );
}

function Station({ station, view, motionOff }: { station: PlacedStation; view: RunView | undefined; motionOff: boolean }): ReactElement {
  const t = useHimaT();
  const active = station.state === 'active';
  const node: PlacedNode = {
    id: station.id, kind: 'act', x: station.cx, y: station.cy, rank: 0, row: station.row,
    state: STATION_STATE[station.state], current: active, waitedForSlot: false, ...(station.ai ? { ai: true as const } : {}),
  };
  const members = station.lines.flatMap((line) => line.nodes);
  const working = station.ai && active && members.some((id) => aiWorking(view, id));
  const activity = station.activeNode === undefined ? undefined : engineeringActivityOf(view, station.activeNode);
  const activityLine = activity?.latest === undefined ? t('ai.kind.other') : `${t(activityKindKey(activity.latest.kind))} ${activity.latest.title}`;
  const counter = activity === undefined ? undefined
    : activity.planTotal > 0 ? t('ai.counter', { calls: activity.toolCalls, done: activity.planDone, total: activity.planTotal }) : t('ai.calls', { calls: activity.toolCalls });
  const labelTop = station.cy + 18 + 20;
  return (
    <g className="hima-strip-station" data-hima-region={`strip-station-${station.id}`} data-hima-state-state={station.state} data-hima-state-ai={String(station.ai)}>
      <title>{`${station.label}${station.about === undefined ? '' : ` — ${station.about}`}`}</title>
      <g className={`hima-node hima-node-act hima-node-state-${node.state}${active ? ' hima-node-current' : ''}`} transform={`translate(${station.cx},${station.cy})`}>
        {active ? <CurrentRing node={node} /> : null}
        {station.ai ? <AiRing node={node} working={working} motionOff={motionOff} /> : null}
        <NodeShape node={node} />
        <StateGlyph node={node} motionOff={motionOff} />
      </g>
      {station.labelLines.map((line, index) => (
        <text key={index} className="hima-node-label" x={station.cx} y={labelTop + index * STRIP_LINE} textAnchor="middle">{line}</text>
      ))}
      {station.activityY === undefined ? null : <>
        <text className="hima-node-activity" x={station.cx} y={station.activityY} textAnchor="middle" data-hima-region={`strip-activity-${station.id}`}>
          {truncate(activityLine, station.textChars)}<title>{activityLine}</title>
        </text>
        {counter === undefined ? null : <text className="hima-node-activity-count" x={station.cx} y={station.activityY + STRIP_LINE} textAnchor="middle">{counter}</text>}
      </>}
      {station.placedLines.map((line, index) => line.state === 'hidden' ? null : (
        <g key={index} className={`hima-strip-line hima-strip-line-${line.state}`} transform={`translate(${line.x},${line.y})`}
          data-hima-region={`strip-line-${station.id}-${String(index)}`} data-hima-state-state={line.state}>
          <title>{line.label}</title>
          <CheckMark state={LINE_STATE[line.state]} motionOff={motionOff} />
          {line.text.map((text, at) => <text key={at} className="hima-node-check-text" x={15} y={9 + at * STRIP_LINE}>{text}</text>)}
        </g>
      ))}
    </g>
  );
}

export function StripCanvas({ graph, contract, view, context, stale, reducedMotion, isOwner, openOwner, acting }: StripCanvasProps): ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(380);
  useEffect(() => {
    const el = containerRef.current; if (el === null) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]; if (entry === undefined) return;
      setWidth(Math.floor(entry.contentRect.width));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const motionOff = reducedMotion || stale;
  const state = useMemo(() => stripState(graph, contract.tools, stripFacts(view)), [graph, contract, view]);
  const scene = useMemo(() => layoutStrip(state, width), [state, width]);
  const current = state.stations.filter((station) => station.state === 'active').map((station) => station.id).join(' ');
  return (
    <div className="hima-canvas-wrap">
      <CanvasAttention view={view} context={context} isOwner={isOwner} openOwner={openOwner} acting={acting} />
      <TopLine round={state.round} contract={contract} view={view} />
      <div className="hima-strip" ref={containerRef} data-hima-region="campaign-strip"
        data-hima-state-round={String(state.round)} data-hima-state-current={current} data-hima-state-stale={String(stale)}>
        <svg width={scene.width} height={scene.height} viewBox={`0 0 ${scene.width} ${scene.height}`} className={stale ? 'hima-canvas-stale' : ''}>
          <defs>
            <marker id="hima-strip-arrow" viewBox="0 0 8 8" refX="7.5" refY="4" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M0 0.5L7.5 4L0 7.5z" className="hima-arrow-fill" />
            </marker>
            <marker id="hima-strip-arrow-lit" viewBox="0 0 8 8" refX="7.5" refY="4" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M0 0.5L7.5 4L0 7.5z" className="hima-arrow-fill-lit" />
            </marker>
            <linearGradient id={AI_RING_ID} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" className="hima-ai-stop-1" /><stop offset="0.5" className="hima-ai-stop-2" /><stop offset="1" className="hima-ai-stop-3" />
            </linearGradient>
            <linearGradient id={AI_RING_LIVE_ID} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" className="hima-ai-stop-1" /><stop offset="0.5" className="hima-ai-stop-2" /><stop offset="1" className="hima-ai-stop-3" />
              {motionOff ? null : <animateTransform attributeName="gradientTransform" type="rotate" from="0 0.5 0.5" to="360 0.5 0.5" dur="6s" repeatCount="indefinite" />}
            </linearGradient>
          </defs>
          {scene.edges.map((edge) => (
            <g key={`${edge.from}>${edge.to}`} className={`hima-edge hima-edge-dependency hima-strip-edge-${edge.kind}${edge.lit ? ' hima-edge-lit' : ''}${edge.lit && !motionOff ? ' hima-strip-edge-flow' : ''}`}
              data-hima-region={`strip-edge-${edge.from}-${edge.to}`} data-hima-state-kind={edge.kind} data-hima-state-lit={String(edge.lit)}>
              <path d={edge.path} className="hima-edge-path" markerEnd={`url(#${edge.lit ? 'hima-strip-arrow-lit' : 'hima-strip-arrow'})`} />
            </g>
          ))}
          {scene.stations.map((station) => <Station key={station.id} station={station} view={view} motionOff={motionOff} />)}
        </svg>
      </div>
      <ExecutionMarkers view={view} />
    </div>
  );
}
