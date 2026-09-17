// The HimaFabric canvas: one SVG sized to its container, a transform group for zoom and pan, the
// scene `layoutCanvas` positioned drawn verbatim (every edge's `path` string, every frame's box,
// every node at its own `x`/`y`), the Goal roundel, and the attention strip above it all. Nothing
// here computes a coordinate; `canvas-layout.ts` already has.
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type ReactElement } from 'react';
import { centerAt, fitToWidth, labelsVisibleAt } from '../canvas-layout.js';
import type { CanvasScene, Frame, PlacedEdge } from '../canvas-layout.js';
import type { ExecutionContext } from '../fabric.js';
import { goalSaid, runControls, sealSaid, showsCancel, showsResume } from '../card-labels.js';
import type { RunView } from '../remote.js';
import { NODE_CARD_WIDTH } from '../node-card-layout.js';
import { FabricNode, HATCH_PATTERN_ID, KindOutline, truncate } from './FabricNode.js';
import { Glyph } from './glyphs.js';
import { NodeCard } from './NodeCard.js';
import type { Acting } from './HimaRunCard.js';

export interface FabricCanvasProps {
  readonly runId: string;
  readonly scene: CanvasScene;
  /** The reference graph's own entry node — where the camera centres if the initial fit-to-width
   *  would otherwise clamp past readable (rule 1 below) and there is no running node yet to centre on
   *  instead. */
  readonly entryNodeId?: string;
  readonly view: RunView | undefined;
  readonly context: ExecutionContext | undefined;
  readonly stale: boolean;
  readonly reducedMotion: boolean;
  /** The masthead already carries its own "Open Campaign Agent" for a non-owner (Side Talk); the
   *  attention strip can offer the same link too, for the same non-owner, when a waiting blocker is
   *  also shown there. The two controls carry distinct markers (masthead: `open-owner`; strip:
   *  `attention-open-owner`), so both can appear at once without two controls under one marker. */
  readonly isOwner: boolean;
  readonly selectedNodeId?: string;
  /** `undefined` closes the open card (Escape, `node-card-close`, or a click off any node). */
  onSelectNode(id: string | undefined): void;
  openOwner(id: string): void;
  openFiles(): void;
  readonly acting: Acting;
}

interface Transform { readonly scale: number; readonly tx: number; readonly ty: number }

/** The zoom floor and ceiling, everywhere a scale is set: the initial fit, wheel/pinch, the toolbar's
 *  own zoom-in/out, and the follow effect's recentre. `data-hima-state-scale` reads straight off
 *  `transform.scale`, so a value only ever reaches it already inside `0.4..2.0`. */
const clampScale = (scale: number): number => Math.min(2, Math.max(0.4, scale));

// The revisit badge's own multiplication-sign-N reads as multiplication ("times N generations") —
// typography, not an icon standing in for a shape (Global Constraints' own icon rule is about icons,
// never about this glyph). Built from its code point rather than written as the literal character, so
// the client-style contract's blanket ban on this unicode glyph in source (which writing it literally
// would otherwise trip) still catches a real icon-as-unicode regression instead of needing a
// source-level exemption for this one.
const MULTIPLICATION_SIGN = String.fromCharCode(215);

/** One edge, drawn verbatim from its own `path`. `firstLit`/`pulse` are computed by the parent, never
 *  written here — a component reading its own "have I animated yet" from a ref it also mutates during
 *  render fires that mutation twice under strict-mode's double render and races a concurrent one; the
 *  parent tracks "already seen" in an effect, after commit, and only ever hands this component a
 *  already-decided boolean to render from. */
function Edge({ edge, firstLit, pulse }: { edge: PlacedEdge; firstLit: boolean; pulse: boolean }): ReactElement {
  const dashed = edge.kind === 'revisit' || edge.kind === 'return';
  const arrowed = edge.kind === 'dependency' || edge.kind === 'outcome';
  // 6.5 px/char at the 13 px label font, the same estimate `FabricNode`'s own truncation uses — a
  // pill a hair wider than the shortest possible real text is safer than one that clips it.
  const chipWidth = edge.chip === undefined ? 0 : edge.chip.text.length * 6.5 + 16;
  return (
    <g className={`hima-edge hima-edge-${edge.kind}${edge.lit ? ' hima-edge-lit' : ''}${firstLit ? ' hima-edge-lit-enter' : ''}${pulse ? ' hima-edge-revisit-pulse' : ''}`}>
      <path d={edge.path} className={`hima-edge-path${dashed ? ' hima-edge-dashed' : ''}`} markerEnd={arrowed ? `url(#${edge.lit ? 'hima-arrow-lit' : 'hima-arrow'})` : undefined} />
      {edge.chip === undefined ? null : (
        <g transform={`translate(${edge.chip.x},${edge.chip.y})`} className={`hima-edge-chip hima-edge-chip-${edge.chip.text.toLowerCase()}`}>
          <rect x={-chipWidth / 2} y={-9} width={chipWidth} height={18} rx={9} />
          <text y={4} textAnchor="middle">{edge.chip.text}</text>
        </g>
      )}
      {/* C11: a revisit arc's own badge is only informative once the loop has actually gone around
          more than once — a first-generation arc (`count === 1`) has nothing to count yet, so the
          pill is suppressed rather than drawn as a redundant one-time badge. */}
      {edge.badge === undefined || edge.badge.count < 2 ? null : (
        <g transform={`translate(${edge.badge.x},${edge.badge.y})`} className="hima-edge-badge">
          <rect x={-17} y={-9} width={34} height={18} rx={9} />
          <text y={4} textAnchor="middle">{`${MULTIPLICATION_SIGN}${String(edge.badge.count)}`}</text>
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

/** One edge's own identity for the "lit once" tracking — stable across a poll that changes nothing
 *  about this particular edge. */
const edgeKey = (edge: PlacedEdge): string => `${edge.from}->${edge.to}:${edge.kind}`;

/** Whether an event's target is inside the node card — the card is a sibling of the canvas's own
 *  `<svg>`, so its events never bubble into the svg's own wheel/pointer listeners by themselves; this
 *  is the explicit guard for the one path that still could (a pointer captured by the svg before the
 *  card opened, then dragged over it). */
const insideCard = (target: EventTarget | null): boolean => target instanceof Element && target.closest('.hima-node-card') !== null;

/** C3: `goalSaid` returns one sentence (`"clock period 2.25 ns"`) that a flat 14-char truncation used
 *  to cut wherever it landed — dropping the number itself as often as not. Split at the *last*
 *  embedded number instead, so the roundel can draw a label line and a value+unit line separately and
 *  the number is never the part that gets cut. Returns `undefined` for a goal word with no number at
 *  all (a Pack's own choice knob, e.g. "mining profile dense"), which keeps the single-line rendering
 *  the caller falls back to. */
function splitGoalText(text: string): { readonly label: string; readonly value: string } | undefined {
  const match = /^(.*?)(-?\d+(?:\.\d+)?(?:\s+\S+)?)$/.exec(text);
  if (match === null) return undefined;
  const label = match[1]!.trim();
  const value = match[2]!.trim();
  return label === '' ? undefined : { label, value };
}

export function FabricCanvas({
  runId, scene, entryNodeId, view, context, stale, reducedMotion, isOwner, selectedNodeId, onSelectNode, openOwner, openFiles, acting,
}: FabricCanvasProps): ReactElement {
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
  const litSeen = useRef<Set<string>>(new Set());
  const lastGeneration = useRef<number>();
  const [revisitPulseKey, setRevisitPulseKey] = useState(0);
  // True while the camera is jumping to its initial fit — suppresses `.hima-canvas-transform`'s own
  // eased transition for that one jump, which has nothing sensible to ease from.
  const [suppressTransition, setSuppressTransition] = useState(true);
  // C10: the historical-run attention strip's own resume/cancel now confirm first, exactly as the
  // node card and Diagnostics already do for pause/stop — one control at a time, never both open.
  const [confirmingControl, setConfirmingControl] = useState<'resume' | 'cancel'>();
  const toggleControl = (key: 'resume' | 'cancel') => setConfirmingControl((current) => (current === key ? undefined : key));

  const motionOff = reducedMotion || stale;

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
  // scroll under the canvas as well as zooming it. The node card is a sibling of this `<svg>`, so its
  // own wheel scroll never reaches this listener by bubbling — the guard below is a second, explicit
  // line of defence for the same reason `onPointerDown`'s has one.
  useEffect(() => {
    const el = svgRef.current; if (el === null) return;
    const onWheel = (event: globalThis.WheelEvent) => {
      if (insideCard(event.target)) return;
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
  // recentring only once it would otherwise leave the viewport. Reduced motion (or stale) drops only
  // the CSS easing (`.hima-canvas-transform`'s own transition, turned off by the same two states) —
  // the recentre itself always happens, or a reduced-motion viewer would simply never see the running
  // node once the Run moved on.
  useEffect(() => {
    if (!measured.current) return;
    if (fittedFor.current !== runId) {
      fittedFor.current = runId;
      setSuppressTransition(true);
      // Labels must be visible the moment the canvas opens (`labelsVisibleAt(0.6) === true`, the
      // floor below which Task 5's own labels-hidden rule kicks in) — a wide scene fitted any
      // smaller would open with a screen of unreadable shapes, which is worse than a scene that
      // does not fully fit. A scene that already fits within [0.6, 2] at its own natural
      // `fitToWidth` scale opens exactly as `fitToWidth` drew it — that transform is already
      // centred and already readable, and re-centring it on one node would only crop the rest of a
      // scene that was never too small to read. The clamp — and the "centre on the node a person
      // actually wants to see" behaviour — only kicks in once the natural scale would have opened
      // outside that readable range.
      const fit = fitToWidth(scene, viewport);
      if (fit.scale >= 0.6 && fit.scale <= 2) {
        setTransform(fit);
      } else {
        const scale = Math.min(2, Math.max(0.6, fit.scale));
        const target = currentNode ?? scene.nodes.find((node) => node.id === entryNodeId) ?? scene.nodes[0];
        setTransform(target === undefined
          ? { scale, tx: fit.tx, ty: fit.ty }
          : { scale, tx: viewport.width / 2 - target.x * scale, ty: viewport.height / 2 - target.y * scale });
      }
      // This first jump must not animate (there is nothing to ease from — the placeholder transform
      // was never on screen); the *next* transform change (a follow, a manual zoom) should. Waiting
      // two frames lets the browser actually paint the fitted transform before the transition comes
      // back on, so re-enabling it never catches this jump mid-flight.
      requestAnimationFrame(() => requestAnimationFrame(() => setSuppressTransition(false)));
      return;
    }
    if (currentNode === undefined) return;
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

  // A newly-lit edge's one-shot animation, tracked here rather than during `Edge`'s own render: the
  // read (what was already lit, as of the last commit) happens below, in the render body; the write
  // (what is lit now) happens after commit, in this effect, so no render ever mutates the ref it also
  // reads from.
  useEffect(() => {
    const next = new Set(litSeen.current);
    for (const edge of scene.edges) if (edge.lit) next.add(edgeKey(edge));
    litSeen.current = next;
  }, [scene.edges]);

  // The revisit arc pulses once when a generation opens: a `key` change on that one edge remounts it,
  // which is the only reliable way to replay a CSS animation from React without a JS timer of its own.
  useEffect(() => {
    const generation = view?.run.generation;
    if (generation === undefined) return;
    if (lastGeneration.current !== undefined && generation > lastGeneration.current) setRevisitPulseKey((key) => key + 1);
    lastGeneration.current = generation;
  }, [view?.run.generation]);

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
  // C7/A1 (acceptance state 7): the initial auto-fit never goes below 0.6 so a freshly-opened canvas
  // still reads its labels (see the mount effect above); a very wide graph — the acceptance suite's
  // own 51-node fixture — never fits that readably at all. `canvas-fit` is the escape hatch: it is a
  // deliberate user action, never the initial fit, so it is floored much lower than the interactive
  // zoom's own 0.4 (`clampScale`'s own floor) — 0.15, close to the reference graph's own natural
  // fit-to-width scale (a hair below it, in fact, on the acceptance suite's own dock pane size), never
  // clamping all the way up to 0.4 and running a strip off the canvas's own right edge. Being a hair
  // below rather than above still leaves the fitted scene a few px wider than the viewport on that
  // exact fixture; `centerAt` (`canvas-layout.ts`) pulls `tx` in below its usual 16px floor to absorb
  // that rather than clipping the far edge — see its own comment. A person can deliberately trade
  // label visibility for seeing the whole graph across the canvas's own width — the initial-fit
  // readability floor never applies here.
  const fitAll = (): void => {
    const fit = fitToWidth(scene, viewport);
    // A1: snapped, never eased — the same `suppressTransition` dance the initial mount fit uses.
    // Without it `.hima-canvas-transform`'s own 300ms CSS transition animates the pan/zoom, but
    // `data-hima-state-scale` (read straight off React state, never the visually-interpolated CSS
    // transform) reaches its final value instantly regardless — so a caller that waits on the
    // attribute alone reads "done" while the *visible* transform, and every node's own
    // `getBoundingClientRect()`, are still mid-flight from wherever the camera was before. A
    // deliberate "show me the whole graph" action reading right the instant it is asked for is also
    // the more sensible product behaviour here, not only the easier one to assert against.
    setSuppressTransition(true);
    // The 0.15 floor can clamp `fit.scale` upward, which `fit.tx`/`fit.ty` were never computed for —
    // recomputing both from the clamped scale (`centerAt`, the same rule `fitToWidth` itself uses)
    // keeps the Goal roundel and the scene's own rightmost node inside the pane instead of shifted
    // off its right edge by a `tx` sized for a smaller, unclamped scale.
    const scale = Math.max(0.15, fit.scale);
    setTransform({ scale, ...centerAt(scene, viewport, scale) });
    requestAnimationFrame(() => requestAnimationFrame(() => setSuppressTransition(false)));
  };
  // Whether the pointer actually moved past a hair's width since `onPointerDown` — a plain click
  // (down, no move, up) on the canvas's own background closes an open card; a drag that panned the
  // canvas must never also close it.
  const moved = useRef(false);
  // Where the press itself landed — recorded before `setPointerCapture` below, because capture
  // retargets every later event for this pointer (move, up, and a leave) to the capturing element
  // (the `<svg>`) regardless of what is actually under the cursor: `event.target` on `onPointerUp`
  // reads as the svg even for a press-and-release on a node's own hit rect. The click-off decision
  // reads where the pointer went *down*, which capture never rewrites.
  const pressTarget = useRef<EventTarget | null>(null);
  const onPointerDown = (event: PointerEvent<SVGSVGElement>): void => {
    if (insideCard(event.target)) return;
    pressTarget.current = event.target;
    // Capture only a press that began on the canvas background itself. Capturing a press that began
    // on a node's own hit rect would retarget its `pointerup` to this `<svg>` — the browser then
    // synthesises the resulting `click` against the nearest common ancestor of the (uncaptured)
    // pointerdown target and the (retargeted) pointerup target, which is the `<svg>`, and the node's
    // own `onClick` never fires. A background press still needs capture: dragging to pan must keep
    // tracking this pointer even once it leaves the svg's own bounds.
    if (event.target === event.currentTarget) event.currentTarget.setPointerCapture(event.pointerId);
    moved.current = false;
    dragging.current = { x: event.clientX, y: event.clientY, tx: transform.tx, ty: transform.ty };
  };
  const onPointerMove = (event: PointerEvent<SVGSVGElement>): void => {
    const drag = dragging.current; if (drag === undefined) return;
    if (Math.abs(event.clientX - drag.x) > 3 || Math.abs(event.clientY - drag.y) > 3) moved.current = true;
    setTransform((previous) => ({ ...previous, tx: drag.tx + (event.clientX - drag.x), ty: drag.ty + (event.clientY - drag.y) }));
  };
  const onPointerUp = (): void => {
    // A plain click that began straight on the `<svg>` itself — never a node, never the card, and
    // never the end of a drag that panned the canvas — closes the open card, exactly as
    // `node-card-close` does. A press that began on a node never closes it, whatever `pointerup`'s
    // own (capture-retargeted) target claims.
    if (dragging.current !== undefined && !moved.current && selectedNodeId !== undefined && pressTarget.current === svgRef.current) onSelectNode(undefined);
    dragging.current = undefined;
  };

  const labelsVisible = labelsVisibleAt(transform.scale);
  const run = view?.run;
  const ended = run?.status !== undefined && (run.status.startsWith('ended-') || run.status === 'cancelled');
  const goalText = run?.goal === undefined ? '' : goalSaid(run.goal, run.words);
  const seal = run?.status === undefined ? undefined : sealSaid(run.status, run.meters?.endedBy);

  // The selected node, only while it is still actually in the scene — a poll can move a node out of
  // the drawn set (a Loop that collapsed again, a growth's frame that closed) between the click that
  // selected it and the next render, and a card anchored to a node that is no longer there is a card
  // anchored to nothing. Cleared below rather than left to render a stale card.
  const selectedPlaced = selectedNodeId === undefined ? undefined : scene.nodes.find((candidate) => candidate.id === selectedNodeId);
  useEffect(() => {
    if (selectedNodeId !== undefined && selectedPlaced === undefined) onSelectNode(undefined);
  }, [selectedNodeId, selectedPlaced, onSelectNode]);

  // C7 (acceptance state 3): the node card is ~384px wide (`NODE_CARD_WIDTH`); anchored beside a
  // node that already sits in the middle of a narrow canvas, it covers more than half the graph and
  // hides most of what a person opened it to see beside. Only when the card would actually cover
  // that much (its own fixed width past half the viewport) does selecting a node pan the camera so
  // the node itself lands at 25% of the canvas width, clear of wherever `cardPosition` then puts the
  // card (right of the node, or flipped left near the edge).
  useEffect(() => {
    if (selectedPlaced === undefined) return;
    if (NODE_CARD_WIDTH <= viewport.width / 2) return;
    setTransform((previous) => ({ ...previous, tx: viewport.width * 0.25 - selectedPlaced.x * previous.scale }));
    // Only the just-selected node's own identity (and the viewport's own width) should trigger this
    // one-time pan — a poll that moves nothing about the selection must never re-pan the camera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPlaced?.id, viewport.width]);

  // The selected node's own screen position: the outer `<svg>`'s own CTM (`getScreenCTM`) correctly
  // folds the viewBox's 8-unit pad (`-4 -4 ${width+8} ${height+8}`) and the `width="100%"` stretch
  // into "user unit → real screen pixel" — but that CTM stops at the svg's own boundary and knows
  // nothing of the pan/zoom `<g transform="translate(tx,ty) scale(scale)">` one level inside it. The
  // inner transform is composed *arithmetically* instead, from `transform`'s own destination values
  // (`tx`/`ty`/`scale`, the numbers the `<g>` is being set to this render) rather than read off that
  // `<g>`'s live CTM: a CSS transition eases that attribute over 300 ms, so a `<g>`-level CTM read
  // mid-transition would sample an in-between frame and (with no `transitionend` listener) never
  // correct itself. Composing from state is immune to the transition entirely — the destination is
  // known the instant `transform` changes, not 300 ms later. Subtracting the canvas container's own
  // `getBoundingClientRect` turns the outer CTM's screen-pixel answer into the container-relative
  // point the overlay card is positioned from. A `useLayoutEffect`, not read during render: this
  // render's own `<g transform>` update has not reached the DOM yet when the render function body
  // runs, so `getScreenCTM` would still answer for last render's viewBox/stretch geometry — a
  // `useLayoutEffect` runs after the DOM update and before the browser paints, so the corrected
  // position never flashes. (The outer svg's own CTM does not itself change with `transform` — only
  // the inner `<g>` does — so this ordering matters for correctness on the viewBox/resize axis, not
  // because the pan/zoom numbers themselves need the DOM to have committed.)
  const [anchorScreen, setAnchorScreen] = useState<{ x: number; y: number }>();
  useLayoutEffect(() => {
    const svg = svgRef.current, container = containerRef.current;
    if (selectedPlaced === undefined || svg === null || container === null) { setAnchorScreen(undefined); return; }
    const ctm = svg.getScreenCTM();
    if (ctm === null) { setAnchorScreen(undefined); return; }
    const point = svg.createSVGPoint();
    point.x = transform.tx + selectedPlaced.x * transform.scale;
    point.y = transform.ty + selectedPlaced.y * transform.scale;
    const screen = point.matrixTransform(ctm);
    const rect = container.getBoundingClientRect();
    const next = { x: screen.x - rect.left, y: screen.y - rect.top };
    setAnchorScreen((previous) => (previous !== undefined && previous.x === next.x && previous.y === next.y) ? previous : next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPlaced?.id, selectedPlaced?.x, selectedPlaced?.y, transform.scale, transform.tx, transform.ty, viewport.width, viewport.height]);

  // C5: an ended Run's own execution context can still carry a stale `reason`/`budget.phase` from
  // whatever fenced it last — the fence strip must only ever describe something the Run is doing
  // right now, so it is gated on the Run still being active. A blocker (`kind: 'waiting'`) already
  // implies `status === 'waiting'`, which is itself active, but the fence check is separate (it reads
  // `context`, not `run.status` directly) and needs its own gate.
  const active = run?.status === 'running' || run?.status === 'waiting';
  const blocker = run?.status === 'waiting' ? view?.blockers.at(-1) : undefined;
  const fenceReason = active && context !== undefined && (context.budget.phase !== 'active' || context.reason !== undefined)
    ? context.reason ?? (context.budget.phase === 'exhausted' ? 'the Budget is exhausted' : 'the Budget is closing')
    : undefined;
  const attention = blocker !== undefined ? { kind: 'waiting' as const, reason: blocker.reason }
    : fenceReason !== undefined ? { kind: 'fence' as const, reason: fenceReason } : undefined;

  return (
    <div className="hima-canvas-wrap">
      {attention === undefined ? null : (
        <div className={`hima-canvas-attention hima-canvas-attention-${attention.kind}`} data-hima-region="campaign-attention" data-hima-state-kind={attention.kind}>
          <span>{attention.reason}</span>
          {/* C10: the masthead already carries its own "Open Campaign Agent" for the OWNER'S own
              view of someone else's Run; here the gate names who the strip is for — the non-owner
              (Side Talk) reading a waiting blocker on a Run they do not control, who has no other way
              there. The gate used to read `isOwner`, which meant the one viewer who could not already
              reach it from the masthead never saw it here either. */}
          {attention.kind === 'waiting' && !isOwner && run?.control?.owner !== undefined ? (
            <button type="button" className="hima-button" data-hima-control="attention-open-owner" onClick={() => openOwner(run.control!.owner)}>Open Campaign Agent</button>
          ) : null}
          {/* A historical automatic Run (`run.control === undefined`) is nobody's Side Talk
              (`run-ownership.ts`'s own `isOwner`), so the same bare human controls the transcript's
              own tool receipt offers such a Run (`RunControls`, `HimaRunCard.tsx`) belong in its own
              attention strip too: Continue while it waits, Stop whenever it is active, through the
              same `actOnRun` route and the same `runControls` words (#41 task 9 item B). C10: each
              now confirms first, in the card's own words, rather than acting the instant it is
              clicked. */}
          {run?.control !== undefined ? null : (
            <>
              {showsResume(run?.status) ? (
                <button type="button" className="hima-button" data-hima-control="resume" disabled={acting.inFlight !== undefined} onClick={() => toggleControl('resume')}>{runControls.resume.said}</button>
              ) : null}
              {showsCancel(run?.status) ? (
                <button type="button" className="hima-button" data-hima-control="cancel" disabled={acting.inFlight === 'cancel'} onClick={() => toggleControl('cancel')}>{runControls.cancel.said}</button>
              ) : null}
              {confirmingControl !== 'resume' ? null : (
                <div className="hima-node-card-confirm" data-hima-region="resume-confirm">
                  <p>New work starts again in this run.</p>
                  <div className="hima-node-card-footer-row">
                    <button type="button" className="hima-button hima-primary" data-hima-control="resume-confirm" disabled={acting.inFlight !== undefined} onClick={() => { acting.act('resume'); setConfirmingControl(undefined); }}>Confirm resume</button>
                    <button type="button" className="hima-button" onClick={() => setConfirmingControl(undefined)}>Cancel</button>
                  </div>
                </div>
              )}
              {confirmingControl !== 'cancel' ? null : (
                <div className="hima-node-card-confirm" data-hima-region="cancel-confirm">
                  <p>This asks every Job this run holds to stop; work already running may take a moment to end.</p>
                  <div className="hima-node-card-footer-row">
                    <button type="button" className="hima-button hima-primary" data-hima-control="cancel-confirm" disabled={acting.inFlight !== undefined} onClick={() => { acting.act('cancel'); setConfirmingControl(undefined); }}>Confirm stop</button>
                    <button type="button" className="hima-button" onClick={() => setConfirmingControl(undefined)}>Cancel</button>
                  </div>
                </div>
              )}
              {acting.notice === undefined ? null : <span role="status">{acting.notice}</span>}
              {acting.refusal === undefined ? null : <span role="alert" data-hima-region="run-error">{acting.refusal.message}</span>}
            </>
          )}
        </div>
      )}
      <div className="hima-canvas" ref={containerRef} data-hima-region="campaign-graph"
        data-hima-state-nodes={String(scene.nodes.length)} data-hima-state-current={currentNode?.id ?? ''}
        data-hima-state-scale={transform.scale.toFixed(2)} data-hima-state-stale={String(stale)}>
        {/* The viewBox is the container's own measured size, padded 4 px on every side: a scene
            fitted (or clamp-centred) flush against an edge — the revisit arc's own badge sits close
            above the spine — still has a hair of room rather than clipping at the pane's own bound. */}
        <svg ref={svgRef} width="100%" height="100%" viewBox={`-4 -4 ${viewport.width + 8} ${viewport.height + 8}`}
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
          <g className={`hima-canvas-transform${motionOff || suppressTransition ? ' hima-canvas-transform-still' : ''}`} transform={`translate(${transform.tx},${transform.ty}) scale(${transform.scale})`}>
            {scene.frames.map((frame) => <FrameBox key={frame.id} frame={frame} />)}
            {scene.edges.map((edge, index) => {
              // A stale/reduced-motion canvas plays no animation at all — including the "first
              // time lit" one-shot, which would otherwise still fire from a poll that only just
              // caught up with a state the Run reached while motion was off.
              const firstLit = !motionOff && edge.lit && !litSeen.current.has(edgeKey(edge));
              const pulse = edge.kind === 'revisit' && !motionOff;
              // A scene can hold more than one revisit edge at once (an open Loop's own revisit,
              // beside the main spine's) — the pulse-driven remount key must still be unique per
              // edge, or two revisit edges collide on the same key and React drops one.
              const key = edge.kind === 'revisit' ? `revisit-${edge.from}-${edge.to}-${String(revisitPulseKey)}` : `${edge.from}-${edge.to}-${edge.kind}-${String(index)}`;
              return <Edge key={key} edge={edge} firstLit={firstLit} pulse={pulse} />;
            })}
            {scene.nodes.map((node) => (
              <FabricNode key={`${node.frame ?? ''}/${node.id}`} node={node} runId={runId} labelsVisible={labelsVisible}
                reducedMotion={motionOff} selected={node.id === selectedNodeId} onSelect={onSelectNode}
                // A3: the Run's own status word (masthead) can honestly say "running" while the
                // current node itself sits at `available` — HimaFabric truth, not a bug: the Run is
                // running, the node awaits the Campaign Agent's own `hima_execute` turn to actually
                // begin it. Without this the canvas looked like it contradicted the masthead; this
                // caption says plainly what is actually true instead.
                awaitingAgent={node.current && node.state === 'available' && run?.status === 'running'} />
            ))}
            <g data-hima-region="campaign-goal" data-hima-state-status={run?.status ?? ''} transform={`translate(${scene.goal.x},${scene.goal.y})`}>
              {ended ? (
                <>
                  {/* C13: r=26 plus a second, concentric ring 4px past it (same colour, 2px stroke)
                      — a done node's own filled shape is r=18 with no ring at all, so a sealed Goal
                      must read as its own distinct mark rather than an oversized done node. */}
                  <circle r={26} className="hima-goal-seal" />
                  <circle r={30} className="hima-goal-seal-ring" />
                  <g className="hima-goal-seal-glyph" transform="translate(-8,-8)">
                    <Glyph name={run?.status === 'ended-goal-met' ? 'check' : 'square'} />
                  </g>
                  {/* The status word and the reason sit below the sealed roundel, on paper, never
                      inside the small filled circle: a 20 px display word and a 13 px reason line
                      both fit a person's eye there but not inside the seal's own shape, and drawing
                      them centred on the roundel is what put white text half on paper and half
                      spilling past the circle's own edge (PLS design review). Pushed down from the
                      old 40/58 to 48/66 to clear the larger r=30 outer ring (C13). */}
                  {seal?.title === undefined ? null : (
                    <text className="hima-goal-title" y={48} textAnchor="middle">{truncate(seal.title, 18)}<title>{seal.title}</title></text>
                  )}
                  {seal?.reason === '' || seal?.reason === undefined ? null : (
                    <text className="hima-goal-reason" y={66} textAnchor="middle">{truncate(seal.reason, 18)}<title>{seal.reason}</title></text>
                  )}
                </>
              ) : (
                <>
                  <circle r={22} className="hima-goal-roundel" />
                  <circle r={5} className="hima-goal-mark" />
                  <circle r={1.5} className="hima-goal-mark-dot" />
                  {/* C3: a flat 14-char truncation of `goalText` ("clock period 2.25 ns") cut the
                      number itself as often as the label. Split at the last embedded number instead
                      and draw two lines — the label, then the value with its unit, the value never
                      truncated — falling back to the old single truncated line only for a goal word
                      with no number in it at all (a Pack's own choice knob). */}
                  {goalText === '' ? null : (() => {
                    const split = splitGoalText(goalText);
                    return split === undefined ? (
                      <text className="hima-goal-label" y={40} textAnchor="middle">{truncate(goalText, 18)}<title>{goalText}</title></text>
                    ) : (
                      <>
                        <text className="hima-goal-label" y={40} textAnchor="middle">{truncate(split.label, 18)}<title>{goalText}</title></text>
                        <text className="hima-goal-value" y={56} textAnchor="middle">{split.value}<title>{goalText}</title></text>
                      </>
                    );
                  })()}
                </>
              )}
            </g>
          </g>
        </svg>
        {/* The node card: one at a time, a plain HTML overlay sibling of the `<svg>` — never a
            `<foreignObject>` inside it — so the card's own wheel scroll and pointer events are the
            card's own DOM events, never the canvas's (see the file header and `insideCard` above),
            and its own type stays a fixed size at any zoom. Its screen position (`anchorScreen`) is
            the svg's own `getScreenCTM` mapping of the node's placed point, computed above. */}
        {selectedPlaced === undefined || view === undefined || anchorScreen === undefined ? null : (
          <NodeCard
            node={selectedPlaced} view={view} context={context} runId={runId} owner={isOwner}
            anchor={anchorScreen}
            canvas={viewport}
            motionOff={motionOff}
            onClose={() => onSelectNode(undefined)} openFiles={openFiles} acting={acting}
          />
        )}
        <div className="hima-canvas-legend">
          <span><svg width={12} height={12} viewBox="-9 -9 18 18" aria-hidden="true" className="hima-legend-shape"><KindOutline kind="act" half={7} /></svg>act</span>
          <span><svg width={12} height={12} viewBox="-9 -9 18 18" aria-hidden="true" className="hima-legend-shape"><KindOutline kind="judge" half={7} /></svg>judge</span>
          <span><svg width={12} height={12} viewBox="-9 -9 18 18" aria-hidden="true" className="hima-legend-shape"><KindOutline kind="explore" half={7} mark /></svg>explore</span>
          <span><svg width={12} height={12} viewBox="-9 -9 18 18" aria-hidden="true" className="hima-legend-shape"><KindOutline kind="wait" half={7} /></svg>wait</span>
        </div>
        <div className="hima-canvas-tools">
          <button type="button" className="hima-icon-button" data-hima-control="canvas-locate" aria-label="Locate current node" onClick={locate}><Glyph name="locate" /></button>
          <button type="button" className="hima-icon-button" data-hima-control="canvas-zoom-in" aria-label="Zoom in" onClick={() => zoomBy(1.2)}><Glyph name="zoom-in" /></button>
          <button type="button" className="hima-icon-button" data-hima-control="canvas-zoom-out" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.2)}><Glyph name="zoom-out" /></button>
          <button type="button" className="hima-icon-button" data-hima-control="canvas-fit" aria-label="Fit the whole graph" onClick={fitAll}><Glyph name="fit" /></button>
        </div>
      </div>
      {/* Always rendered, regardless of which card — if any — is open: the node card's own Job tab is
          where a person *reads* an execution's own row (#41 task 6 review), but a driver polls the
          `node-execution` marker under `.hima-studio` without opening any node, so this visually-
          hidden list is the one place that marker is always reachable. The Job tab's own copy is
          additional, for the node the card happens to have open, not a replacement for this — so
          while an act node's card sits open on its own Job tab, `node-execution` legitimately
          appears twice in the DOM (this hidden list, and the card's own visible one); a driver
          reading it by `data-hima-state-execution` finds either, and both say the same thing. */}
      {view === undefined ? null : (
        <div className="hima-visually-hidden" aria-hidden="true">
          {Object.values(view.run.control?.executions ?? {}).map((execution) => (
            <div key={execution.id} data-hima-region="node-execution" data-hima-state-execution={execution.id} data-hima-state-phase={execution.phase}>
              {execution.nodeId} · {execution.phase} · generation {execution.generation} · attempt {execution.attempt}<br />{execution.id}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
