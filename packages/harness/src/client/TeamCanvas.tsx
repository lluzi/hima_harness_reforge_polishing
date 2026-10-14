// The team view: the Live tab of a Run whose Pack ships a `view.yml` — a column of stations (a step
// box with its checklist, a single AI agent, or a team of AI agents) for the current round, with the
// hand-overs between them drawn as arrows. `team-view.ts` decides every state; this draws it with
// HTML boxes and one SVG overlay for the arrows, measured from the boxes themselves, so it fits any
// pane width without pan or zoom.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement } from 'react';
import { runWaitingReason } from '../card-labels.js';
import type { PackContract, PackGraph } from '../packs.js';
import type { RunView } from '../remote.js';
import { changedEntries, teamEdgePath, teamGridArea, teamRowOrder, teamViewState, type TeamBox, type TeamLine, type TeamMember, type TeamNodeState, type TeamStation } from '../team-view.js';
import type { ResidentActivity } from '../resident-activity.js';

export interface TeamCanvasProps {
  readonly graph: PackGraph;
  readonly tools: PackContract['tools'] | undefined;
  readonly view: RunView | undefined;
  readonly stale: boolean;
  readonly reducedMotion: boolean;
}

function Spark(): ReactElement {
  return <svg viewBox="-10 -10 20 20" width="16" height="16" aria-hidden="true"><path className="hima-team-spark" d="M0 -8C1 -2.5 2.5 -1 8 0C2.5 1 1 2.5 0 8C-1 2.5 -2.5 1 -8 0C-2.5 -1 -1 -2.5 0 -8Z" /></svg>;
}
function Steps(): ReactElement {
  return <svg viewBox="-10 -10 20 20" width="16" height="16" aria-hidden="true"><path className="hima-team-steps" d="M-6 -4.5H6M-6 0H6M-6 4.5H2" /></svg>;
}
function Mark({ state }: { state: TeamNodeState }): ReactElement {
  return (
    <svg className={`hima-team-mark hima-team-mark-${state}`} viewBox="-7 -7 14 14" width="14" height="14" aria-hidden="true">
      {state === 'done' ? <><circle r="6.2" /><path d="M-3 0.2L-0.8 2.4L3.2 -2.2" /></>
        : state === 'failed' ? <><circle r="6.2" /><path d="M-2.5 -2.5L2.5 2.5M2.5 -2.5L-2.5 2.5" /></>
          : state === 'active' ? <><circle r="6.2" /><circle className="hima-team-mark-dot" r="2.6" /></>
            : <circle r="5.6" />}
    </svg>
  );
}

/** The square at the left of a box: a spark for an AI agent, steps for a tool station. */
function Square({ ai, state, motionOff }: { ai: boolean; state: string; motionOff: boolean }): ReactElement {
  const live = ai && state === 'active' && !motionOff;
  return (
    <span className={`hima-team-square${ai ? ' hima-team-square-ai' : ''}${live ? ' hima-team-square-live' : ''} hima-team-square-${state}`}>
      <span className="hima-team-square-face">{ai ? <Spark /> : <Steps />}</span>
    </span>
  );
}

const MEMBER_SAID: Record<TeamNodeState, string> = { pending: 'Waiting', active: 'Working', done: 'Delivered', failed: 'Failed' };

const KIND_SAID: Record<string, string> = { read: 'Reading', edit: 'Editing', execute: 'Running', search: 'Searching', plan: 'Planning', message: 'Thinking', other: 'Working' };

/** A title that only repeats the tool's own name ("read", "bash") says nothing a person can use: the
 *  tool call announced itself before its arguments arrived (demo `BARE_TOOL_WORDS`). */
const BARE_TOOL_WORDS = new Set(['read', 'edit', 'write', 'bash', 'grep', 'glob', 'list', 'ls', 'todowrite', 'todoread', 'webfetch', 'fetch', 'task', 'patch', 'search', 'execute', 'plan', 'message', 'other']);

/** A path-like token keeps its last two segments: "…/flow/rounds.py", not the Site's long root. */
export function shortPaths(text: string): string {
  return text
    .replace(/\b([A-Za-z][\w-]*?)-[0-9a-f]{12,}\b/g, '$1')
    .replace(/^(?:cd \S+ *(?:&&|;) *|export \S+ *(?:&&|;) *|[A-Z_]+=\S+ +)+/, '')
    .replace(/\/?(?:[\w.~$-]+\/){2,}[\w.-]+/g, (path) => `…/${path.split('/').slice(-2).join('/')}`);
}

/** What a working agent is doing now: its latest action, then its tool-call and plan counters. */
function LiveLine({ activity, fallback }: { activity: ResidentActivity | undefined; fallback: string }): ReactElement {
  const latest = activity?.latest;
  const title = latest === undefined ? '' : shortPaths(latest.title);
  // A bare tool word says nothing beyond the verb, so drop it: "Running…", not "Running bash".
  const bare = title.trim() === '' || BARE_TOOL_WORDS.has(title.trim().toLowerCase());
  const verb = latest === undefined ? '' : KIND_SAID[latest.kind] ?? KIND_SAID.other;
  const text = latest === undefined ? fallback
    : bare ? `${verb}…`
      : latest.kind === 'message' ? `${KIND_SAID.message}: ${title}` : `${verb} ${title}`;
  const counter = activity === undefined ? undefined
    : `${String(activity.toolCalls)} tool call${activity.toolCalls === 1 ? '' : 's'}${activity.planTotal > 0 ? ` · plan ${String(activity.planDone)}/${String(activity.planTotal)}` : ''}`;
  return <>
    <span className="hima-team-live" title={text} key={latest?.at ?? 'none'}>{text}</span>
    {counter === undefined ? null : <span className="hima-team-count">{counter}</span>}
  </>;
}

function Member({ member, motionOff }: { member: TeamMember; motionOff: boolean }): ReactElement {
  return (
    <div className={`hima-team-member hima-team-member-${member.state}`} data-hima-region={`team-member-${member.node}`} data-hima-state-state={member.state}>
      <Square ai={member.ai} state={member.state} motionOff={motionOff} />
      <div className="hima-team-member-text">
        <strong>{member.label}</strong>
        {member.role === undefined ? null : <span className="hima-team-role">{member.role}</span>}
        {member.state === 'active'
          ? <LiveLine activity={member.activity} fallback="Reviewing the candidate" />
          : <span className={`hima-team-status hima-team-status-${member.state}`}>{MEMBER_SAID[member.state]}</span>}
        {member.summary === undefined ? null : <span className="hima-team-summary" title={member.summary}>{member.summary}</span>}
      </div>
    </div>
  );
}

/** A checklist line's text: a folded leading run reads "N done", every other line its own label. */
function lineText(line: TeamLine): string {
  return line.folds === undefined ? line.label : `${String(line.folds)} done`;
}

function Station({ station, motionOff, refFor, style, changed }: { station: TeamStation; motionOff: boolean; refFor: (el: HTMLElement | null) => void; style?: CSSProperties; changed: boolean }): ReactElement {
  const team = station.team;
  const lines = station.lines.filter((line) => line.state !== 'hidden' && line.folded !== true);
  const active = station.activeNode !== undefined || station.state === 'active';
  // A finished context station — or one whose round hides its whole checklist — folds to a slim row:
  // a title and a trailing state mark, no empty card. The active station and the ones still to run
  // keep their checklist, so the flow reads as "done · working now · still ahead" and fits in view.
  const quiet = !active && team === undefined && station.summary === undefined
    && (station.state === 'done' || lines.length === 0);
  const showLines = !quiet && team === undefined && lines.length > 0;
  return (
    <section ref={refFor} style={style} className={`hima-team-station hima-team-station-${station.state}${quiet ? ' hima-team-station-quiet' : ''}${team === undefined ? '' : ' hima-team-station-team'}${station.ai ? ' hima-team-station-ai' : ''}${active && !motionOff ? ' hima-team-station-live' : ''}${changed && !motionOff ? ' hima-team-station-bump' : ''}`}
      data-hima-region={`team-station-${station.id}`} data-hima-state-state={station.state} data-hima-state-col={String(station.col)} data-hima-state-span={String(station.span)} title={station.about}>
      <header className="hima-team-head">
        {team === undefined ? <Square ai={station.ai} state={station.state} motionOff={motionOff} /> : null}
        <div className="hima-team-head-text">
          <strong>{station.label}</strong>
          {station.activeNode !== undefined && team === undefined
            ? <LiveLine activity={station.activity} fallback="Working" />
            : station.about === undefined || team === undefined ? null : <span className="hima-team-about">{station.about}</span>}
        </div>
        {quiet && (station.state === 'done' || station.state === 'failed') ? <Mark state={station.state === 'done' ? 'done' : 'failed'} /> : null}
      </header>
      {!showLines ? null : (
        <ul className="hima-team-lines">
          {lines.map((line, index) => (
            <li key={index} className={`hima-team-line hima-team-line-${line.state}${line.folds === undefined ? '' : ' hima-team-line-fold'}${line.state === 'active' && !motionOff ? ' hima-team-line-live' : ''}`}><Mark state={line.state as TeamNodeState} /><span>{lineText(line)}</span></li>
          ))}
        </ul>
      )}
      {station.summary === undefined ? null : <p className="hima-team-summary hima-team-summary-station" title={station.summary}>{station.summary}</p>}
      {team === undefined ? null : (
        <div className="hima-team-grid">
          {team.map((member) => <Member key={member.node} member={member} motionOff={motionOff} />)}
        </div>
      )}
    </section>
  );
}

export function TeamCanvas({ graph, tools, view, stale, reducedMotion }: TeamCanvasProps): ReactElement {
  const motionOff = reducedMotion || stale;
  const state = useMemo(() => teamViewState(graph, tools, view), [graph, tools, view]);
  // A new best metric or a station that just finished flashes once; a steady poll re-reading the same
  // facts flashes nothing (`changedEntries`), and reduced motion/stale skips the flash entirely.
  const metricDigest = (state?.metrics ?? []).map((m) => `${m.label}=${m.value}`).join('|');
  const stationDigest = (state?.stations ?? []).map((s) => `${s.id}=${s.state}`).join('|');
  const prevMetrics = useRef<Map<string, string>>();
  const prevStations = useRef<Map<string, string>>();
  const [flash, setFlash] = useState<{ readonly metrics: ReadonlySet<string>; readonly stations: ReadonlySet<string> }>({ metrics: new Set(), stations: new Set() });
  useEffect(() => {
    const metricsNow = new Map((state?.metrics ?? []).map((m) => [m.label, m.value] as const));
    const stationsNow = new Map((state?.stations ?? []).map((s) => [s.id, s.state] as const));
    if (motionOff) { prevMetrics.current = metricsNow; prevStations.current = stationsNow; return; }
    const metrics = changedEntries(prevMetrics.current, metricsNow);
    const stations = changedEntries(prevStations.current, stationsNow);
    prevMetrics.current = metricsNow; prevStations.current = stationsNow;
    if (metrics.size === 0 && stations.size === 0) return;
    setFlash({ metrics, stations });
    const timer = setTimeout(() => setFlash({ metrics: new Set(), stations: new Set() }), 1300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metricDigest, stationDigest, motionOff]);
  const wrapRef = useRef<HTMLDivElement>(null);
  const boxes = useRef(new Map<string, HTMLElement>());
  const [measured, setMeasured] = useState<{ readonly width: number; readonly height: number; readonly at: ReadonlyMap<string, TeamBox> }>();
  useLayoutEffect(() => {
    const wrap = wrapRef.current; if (wrap === null) return;
    const measure = (): void => {
      const origin = wrap.getBoundingClientRect();
      const at = new Map<string, TeamBox>();
      for (const [id, el] of boxes.current) {
        const r = el.getBoundingClientRect();
        at.set(id, { top: r.top - origin.top + wrap.scrollTop, bottom: r.bottom - origin.top + wrap.scrollTop, left: r.left - origin.left, right: r.right - origin.left });
      }
      const bottom = Math.max(0, ...[...at.values()].map((box) => box.bottom));
      setMeasured({ width: wrap.clientWidth, height: Math.ceil(bottom) + 4, at });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(wrap);
    for (const el of boxes.current.values()) observer.observe(el);
    return () => observer.disconnect();
  }, [state]);
  if (state === undefined) return <div className="hima-empty"><p>This Pack declares no team view.</p></div>;
  const waiting = runWaitingReason(view);
  const goalSaid = (m: (typeof state.metrics)[number]): string => m.goal === undefined ? '' : `goal ${m.better === 'lower' ? '≤ ' : m.better === 'higher' ? '≥ ' : ''}${m.goal}`;
  // A view that declares rows is drawn as a two-column grid with back edges down the left gutter; a
  // view without rows (MAGE) keeps the single column and its right-margin back edges, unchanged.
  const gridded = state.stations.some((station) => station.row !== undefined);
  const rowOrder = teamRowOrder(state.stations);
  return (
    <div className="hima-canvas-wrap">
      <style>{TEAM_STYLE}</style>
      {waiting === undefined ? null : <div className="hima-canvas-attention hima-canvas-attention-waiting" data-hima-region="campaign-attention"><span>{waiting}</span></div>}
      <p className="hima-team-top" data-hima-region="team-top" data-hima-state-round={String(state.round)}>
        {state.title === undefined ? null : <strong>{state.title}</strong>}
        <span className="hima-team-chip hima-team-chip-round">Round {state.round}</span>
        {state.metrics.map((m) => (
          <span key={m.label} className={`hima-team-chip${flash.metrics.has(m.label) ? ' hima-team-chip-bump' : ''}`}><span>{m.label}</span> <b>{m.value}</b>{m.goal === undefined ? null : <i>{goalSaid(m)}</i>}</span>
        ))}
      </p>
      <div className={`hima-team${gridded ? ' hima-team-rows' : ''}`} ref={wrapRef} data-hima-region="campaign-team" data-hima-state-round={String(state.round)}>
        {measured === undefined ? null : (
          <svg className="hima-team-edges" width={measured.width} height={measured.height} aria-hidden="true">
            <defs>
              <marker id="hima-team-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0.5L7.5 4L0 7.5z" className="hima-team-arrow" /></marker>
              <marker id="hima-team-arrow-lit" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0.5L7.5 4L0 7.5z" className="hima-team-arrow-lit" /></marker>
            </defs>
            {state.edges.map((edge) => {
              const from = measured.at.get(edge.from), to = measured.at.get(edge.to);
              if (from === undefined || to === undefined) return null;
              const { d, lx, ly } = teamEdgePath(edge, from, to, measured.width, gridded ? 'left' : 'right');
              return (
                <g key={`${edge.from}>${edge.to}`} className={`hima-team-edge${edge.lit ? ' hima-team-edge-lit' : ''}${edge.lit && !motionOff ? ' hima-team-edge-flow' : ''}${edge.back ? ' hima-team-edge-back' : ''}`}
                  data-hima-region={`team-edge-${edge.from}-${edge.to}`} data-hima-state-lit={String(edge.lit)}>
                  <path d={d} markerEnd={`url(#${edge.lit ? 'hima-team-arrow-lit' : 'hima-team-arrow'})`} />
                  {edge.label === undefined ? null : edge.back
                    ? <text x={lx} y={ly} textAnchor="middle" transform={`rotate(-90 ${String(lx)} ${String(ly)})`}>{edge.label}</text>
                    : <text x={lx} y={ly}>{edge.label}</text>}
                </g>
              );
            })}
          </svg>
        )}
        {state.stations.map((station) => (
          <Station key={station.id} station={station} motionOff={motionOff} changed={flash.stations.has(station.id)}
            style={gridded ? teamGridArea(station, rowOrder) : undefined}
            refFor={(el) => { if (el === null) boxes.current.delete(station.id); else boxes.current.set(station.id, el); }} />
        ))}
      </div>
    </div>
  );
}

export const TEAM_STYLE = `
.hima-team-top{flex:none;margin:0;padding:var(--hima-sp-2) var(--hima-sp-4);display:flex;flex-wrap:wrap;gap:var(--hima-sp-2);align-items:baseline;font-size:var(--hima-fs-label);color:var(--hima-ink-2);border-bottom:1px solid var(--hima-line)}
.hima-team-top strong{color:var(--hima-ink);font-size:var(--hima-fs-body);flex-basis:100%}
.hima-team-chip{display:inline-flex;gap:5px;align-items:baseline;padding:2px 9px;border-radius:999px;background:var(--hima-soft);border:1px solid var(--hima-line);white-space:nowrap}
.hima-team-chip b{color:var(--hima-ink);font-size:var(--hima-fs-body)} .hima-team-chip i{font-style:normal;color:var(--hima-ink-3)}
.hima-team-chip-round{background:var(--hima-accent);border-color:var(--hima-accent);color:var(--hima-on-solid);font-weight:600}
.hima-team{position:relative;flex:1;min-height:0;overflow:auto;padding:var(--hima-sp-4) 34px var(--hima-sp-6) var(--hima-sp-4);display:flex;flex-direction:column;gap:30px}
.hima-team-rows{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);column-gap:12px;row-gap:18px;padding:var(--hima-sp-4) 12px var(--hima-sp-6) 34px;align-items:start;align-content:start}
.hima-team-line-fold{color:var(--hima-ink-3);font-style:italic}
.hima-team-edges{position:absolute;left:0;top:0;pointer-events:none;overflow:visible}
.hima-team-edge path{fill:none;stroke:var(--hima-line-strong);stroke-width:1.5}
.hima-team-edge-back path{stroke-dasharray:4 4}
.hima-team-edge text{font-size:12px;fill:var(--hima-ink-3)}
.hima-team-edge-lit path{stroke:var(--hima-accent);stroke-width:2;stroke-dasharray:6 5}
.hima-team-edge-lit text{fill:var(--hima-accent);font-weight:600}
.hima-team-edge-flow path{animation:hima-team-flow .9s linear infinite}
@keyframes hima-team-flow{from{stroke-dashoffset:22}to{stroke-dashoffset:0}}
.hima-team-arrow{fill:var(--hima-line-strong)} .hima-team-arrow-lit{fill:var(--hima-accent)}
.hima-team-station{position:relative;z-index:1;min-width:0;background:var(--hima-paper);border:1px solid var(--hima-line);border-radius:var(--hima-r-l);padding:var(--hima-sp-3);box-shadow:var(--hima-shadow);transition:border-color .3s,box-shadow .3s,background .3s,transform .18s}
.hima-team-station-active{border-color:var(--hima-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--hima-accent) 16%,transparent),var(--hima-shadow)}
.hima-team-station-live{animation:hima-team-breathe 2.6s ease-in-out infinite}
@keyframes hima-team-breathe{0%,100%{box-shadow:0 0 0 3px color-mix(in srgb,var(--hima-accent) 16%,transparent),var(--hima-shadow)}50%{box-shadow:0 0 0 6px color-mix(in srgb,var(--hima-accent) 9%,transparent),var(--hima-shadow)}}
.hima-team-station-bump{animation:hima-team-pop .7s ease}
@keyframes hima-team-pop{0%{transform:scale(1)}32%{transform:scale(1.014)}100%{transform:scale(1)}}
.hima-team-station-done{border-color:color-mix(in srgb,var(--hima-good) 45%,var(--hima-line))}
.hima-team-station-failed{border-color:var(--hima-bad)}
.hima-team-head{display:flex;gap:var(--hima-sp-3);align-items:center}
.hima-team-head-text{display:flex;flex-direction:column;min-width:0}
.hima-team-head-text strong{font-size:var(--hima-fs-title);line-height:var(--hima-lh-tight)}
.hima-team-about,.hima-team-role{font-size:12px;color:var(--hima-ink-3)}
.hima-team-live{font-size:12px;color:var(--hima-accent);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;animation:hima-team-in .35s ease-out}
.hima-team-member .hima-team-live{white-space:normal;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.hima-team-count{font-size:11px;color:var(--hima-ink-3);font-variant-numeric:tabular-nums}
@keyframes hima-team-in{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}
.hima-team-lines{list-style:none;margin:var(--hima-sp-2) 0 0 44px;padding:0;display:flex;flex-direction:column;gap:3px;font-size:var(--hima-fs-label)}
.hima-team-line{display:flex;gap:var(--hima-sp-2);align-items:center;color:var(--hima-ink-3)}
.hima-team-line-done,.hima-team-line-active{color:var(--hima-ink)} .hima-team-line-active{font-weight:600}
.hima-team-line-live span{animation:hima-team-line-pulse 1.7s ease-in-out infinite}
@keyframes hima-team-line-pulse{0%,100%{color:var(--hima-ink)}50%{color:var(--hima-accent)}}
.hima-team-mark circle{fill:none;stroke:var(--hima-line-strong);stroke-width:1.3}
.hima-team-mark path{fill:none;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
.hima-team-mark-done circle{fill:var(--hima-good);stroke:var(--hima-good)} .hima-team-mark-done path{stroke:var(--hima-on-solid)}
.hima-team-mark-failed circle{fill:var(--hima-bad);stroke:var(--hima-bad)} .hima-team-mark-failed path{stroke:var(--hima-on-solid)}
.hima-team-mark-active circle{stroke:var(--hima-accent)} .hima-team-mark-active .hima-team-mark-dot{fill:var(--hima-accent);stroke:none;animation:hima-team-blink 1.2s ease-in-out infinite}
@keyframes hima-team-blink{50%{opacity:.25}}
.hima-team-square{position:relative;flex:none;width:34px;height:34px;border-radius:9px;display:grid;place-items:center;overflow:hidden;background:var(--hima-line)}
.hima-team-square-ai{background:conic-gradient(from 0deg,#4f5fd8,#b8532f,#d9a032,#2f7a45,#4f5fd8)}
.hima-team-square-done.hima-team-square:not(.hima-team-square-ai){background:var(--hima-good)}
.hima-team-square-live::before{content:'';position:absolute;inset:-60%;background:conic-gradient(from 0deg,transparent 0 55%,#ffffffcc 70%,transparent 85%);animation:hima-team-spin 1.6s linear infinite}
.hima-team-square-face{position:relative;width:28px;height:28px;border-radius:7px;background:var(--hima-paper);display:grid;place-items:center}
.hima-team-square-ai.hima-team-square-done .hima-team-square-face{background:color-mix(in srgb,var(--hima-good) 14%,var(--hima-paper))}
.hima-team-square-live{box-shadow:0 0 0 4px color-mix(in srgb,var(--hima-accent) 22%,transparent);animation:hima-team-glow 1.8s ease-in-out infinite}
@keyframes hima-team-spin{to{transform:rotate(360deg)}}
@keyframes hima-team-glow{50%{box-shadow:0 0 0 7px color-mix(in srgb,var(--hima-accent) 10%,transparent)}}
.hima-team-spark{fill:var(--hima-accent)} .hima-team-steps{fill:none;stroke:var(--hima-ink-2);stroke-width:1.8;stroke-linecap:round}
.hima-team-square-live .hima-team-spark{animation:hima-team-twinkle 1.4s ease-in-out infinite;transform-origin:center}
@keyframes hima-team-twinkle{50%{transform:scale(.72) rotate(45deg)}}
.hima-team-station-team{background:color-mix(in srgb,var(--hima-accent) 4%,var(--hima-paper))}
.hima-team-grid{margin-top:var(--hima-sp-3);display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:var(--hima-sp-2)}
.hima-team-member{display:flex;gap:var(--hima-sp-2);align-items:flex-start;padding:var(--hima-sp-2);border:1px solid var(--hima-line);border-radius:var(--hima-r-m);background:var(--hima-paper);min-width:0}
.hima-team-member-active{border-color:var(--hima-accent);box-shadow:0 0 0 2px color-mix(in srgb,var(--hima-accent) 14%,transparent)}
.hima-team-member-text{display:flex;flex-direction:column;min-width:0;font-size:12px}
.hima-team-member-text strong{font-size:var(--hima-fs-label)}
.hima-team-status{color:var(--hima-ink-3)} .hima-team-status-done{color:var(--hima-good)} .hima-team-status-failed{color:var(--hima-bad)}
.hima-team-summary{font-size:12px;color:var(--hima-ink-2);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.hima-team-summary-station{margin:var(--hima-sp-2) 0 0 44px}
/* A metric chip flashes once when its value moves (a new best): a brief pop and a colour pulse on
   the number, nothing while the poll re-reads the same value. */
.hima-team-chip-bump{animation:hima-team-chip-pop .8s ease}
.hima-team-chip-bump b{animation:hima-team-chip-flash .8s ease}
@keyframes hima-team-chip-pop{0%{transform:scale(1)}26%{transform:scale(1.07)}100%{transform:scale(1)}}
@keyframes hima-team-chip-flash{0%{color:var(--hima-ink)}26%{color:var(--hima-live)}100%{color:var(--hima-ink)}}
/* Compact: the whole flow — every station, with the round loop — fits the Live pane at side-pane
   width without scrolling (2026-10-14 launch take, 1280x770 window). A finished or round-hidden
   station folds to a slim row so the active station and the ones still ahead keep the room. */
.hima-workbench-body>.hima-campaign:has([data-hima-region="campaign-team"]){height:100%;min-height:440px}
.hima-team-top{padding:5px 12px;gap:5px 7px;font-size:12px;row-gap:4px}
.hima-team-top strong{flex-basis:auto;font-size:13px;margin-right:4px;display:none}
.hima-team-chip{padding:1px 8px;gap:4px}
.hima-team-chip b{font-size:13px}
.hima-team{padding:6px 26px 7px 12px;gap:9px}
.hima-team-rows{row-gap:12px;column-gap:10px;padding:6px 12px 7px 28px}
.hima-team-station{padding:6px 10px;border-radius:10px}
.hima-team-head{gap:10px}
.hima-team-head-text strong{font-size:14px}
.hima-team-square{width:29px;height:29px;border-radius:8px}
.hima-team-square-face{width:24px;height:24px;border-radius:6px}
.hima-team-lines{margin:2px 0 0 39px;gap:1px;font-size:12px}
.hima-team-station-team .hima-team-about{display:none}
.hima-team-grid{margin-top:6px;gap:6px;grid-template-columns:repeat(2,minmax(0,1fr))}
.hima-team-member{padding:6px;gap:7px}
.hima-team-member .hima-team-square{width:26px;height:26px;border-radius:7px}
.hima-team-member .hima-team-square-face{width:22px;height:22px;border-radius:5px}
.hima-team-role{display:none}
.hima-team-summary{-webkit-line-clamp:1}
.hima-team-summary-station{margin:4px 0 0 39px}
/* A slim done/round-hidden station: one tight row, a trailing state mark, a quiet backdrop so it
   recedes behind the station working now. */
.hima-team-station-quiet{padding:3px 10px}
.hima-team-station-quiet .hima-team-head{align-items:center}
.hima-team-station-quiet .hima-team-square{width:22px;height:22px;border-radius:6px}
.hima-team-station-quiet .hima-team-square-face{width:18px;height:18px;border-radius:4px}
.hima-team-station-quiet .hima-team-head-text strong{font-size:13px}
.hima-team-station-quiet>.hima-team-head>.hima-team-mark{margin-left:auto;flex:none}
.hima-team-station-quiet.hima-team-station-done{background:color-mix(in srgb,var(--hima-good) 6%,var(--hima-paper));border-color:color-mix(in srgb,var(--hima-good) 30%,var(--hima-line))}
@media (prefers-reduced-motion: reduce){
  .hima-team-square-live::before,.hima-team-square-live,.hima-team-edge-flow path,.hima-team-mark-dot,.hima-team-spark,
  .hima-team-station-live,.hima-team-station-bump,.hima-team-line-live span,.hima-team-chip-bump,.hima-team-chip-bump b{animation:none}
}
`;
