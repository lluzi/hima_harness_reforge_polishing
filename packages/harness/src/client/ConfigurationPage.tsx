// The Configuration page (#41 task 7): the Campaign file rendered as one editable document, in place
// of the old step-by-step start form. Every section is visible at once — Name, Pack, Site, Inputs,
// Goal, Strategy, Budget, Knowledge, Readiness — because a Campaign file is a document a person and
// HimaGuide both edit, never a wizard one of them steps through alone.
//
// The Host's own `preparation()` (index.ts) never fills a Goal from a default once a Campaign file
// exists (CampaignFileView.preparation is always computed with this file's own overrides, however
// empty) — this page relies on that rather than repeating the rule: every field here starts exactly
// at what `hima/campaign.yml` says, and nothing this component renders invents a value the file does
// not hold.
//
// Polling every three seconds is how this page notices HimaGuide's own edits to the same file: a
// changed `mtimeMs` whose text differs from the last text this session saw is marked field by field
// (`changedFields`, `campaign-file-diff.ts` — a leaf module with no Node imports, safe for this
// client bundle, that `campaign-file.ts` also re-exports for the Host's own side) until the person
// focuses that field, which is this page's own acknowledgement that they have seen it. The person's
// own edits save on blur or Enter, never on
// every keystroke, so a field mid-edit is never fighting the poll for the caret.
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import type { CampaignFile } from '../campaign-file.js';
import { changedFields } from '../campaign-file-diff.js';
import { layoutCanvas, NODE, type NodeKind } from '../canvas-layout.js';
import type { CampaignFileView, RunView, SiteHeadView } from '../remote.js';
import type { SiteDiscoveryResult } from '../sites.js';
import type { PreparationView, StartChoices } from '../workbench.js';
import { discoverSite, fetchCampaignFile, fetchSites, fetchStartChoices, saveCampaignFile, startCampaign } from './api.js';
import { KindOutline } from './FabricNode.js';
import { Glyph, type GlyphName } from './glyphs.js';

/** C17: a state roundel — a glyph coloured by the same good/warn/bad vocabulary the rest of the
 *  client already reads off `data-state` (`.hima-state-word`, `workbench-style.ts`) — so a person
 *  scanning this page for what still needs attention reads colour, not only shape. */
function StateRoundel({ state, glyph }: { state: 'good' | 'warn' | 'bad'; glyph: GlyphName }): ReactElement {
  return <span className="hima-config-state-roundel" data-state={state}><Glyph name={glyph} /></span>;
}

/** C17: the sentence every section whose own content depends on a chosen Pack shows in its place —
 *  Inputs, Goal and Strategy are all declared by the Pack's own contract, and an empty list there
 *  silently rendering nothing (an eyebrow over a blank space) reads as broken rather than "not yet
 *  applicable". */
function AvailableOncePackChosen(): ReactElement {
  return <p className="hima-muted">Available once a Pack is chosen.</p>;
}

export interface ConfigurationPageProps {
  readonly sessionId: string;
  askGuide?(text: string): void;
  pickFolder?: () => Promise<string | null>;
  onStarted(view: RunView): void;
  /** Opens the Pack owner panel; `location` is a folder `pickFolder` already picked, so the panel
   *  opens with its own "source folder" field already filled in rather than empty (review MINOR). */
  openPackOwner?: (location?: string) => void;
  /** Bug 3 fix: bumped by `HimaWorkbench`'s own top-level "Refresh Run data" button. That button
   *  previously only refreshed the Run list and a Run snapshot this page never renders (both no-ops
   *  while no Run is selected, which is exactly when this page is mounted) — the readiness poll below
   *  lived entirely inside this component's own effect and had no way to hear about it, so a stale
   *  readiness row (e.g. a since-fixed campaign.yml key) survived the click and only cleared through
   *  that row's own "Retry" button. Any change to this number re-runs the same poll `retry` already
   *  triggers, immediately rather than waiting out the rest of the 3 s interval. */
  refreshSignal?: number;
  /** Told `true` for as long as Confirm's own request is in flight, `false` once it settles either
   *  way — `HimaWorkbench` disables the Run picker while it is true (review MINOR: switching Runs
   *  mid-confirmation is not a case this page's own guard needs to also reason about). */
  onBusy?: (busy: boolean) => void;
}

/** Place a draft in the composer without ever sending it, the way every "Ask HimaGuide" control in
 *  this product works (Global Constraints). Task 8 wires the shell's own composer through `askGuide`;
 *  absent that, this falls back to the native contenteditable the shell always renders one of. */
export function draftToGuide(text: string): void {
  const composer = document.querySelector<HTMLElement>('[contenteditable="true"]');
  if (composer === null) return;
  composer.focus();
  document.execCommand('insertText', false, text);
}

/** A field's own bounds hint (review item 3, US58): `unit · min–max · precision`, each part left out
 *  when the declaration does not carry it — never `undefined – undefined`, and never a bare `·`
 *  where a missing part would otherwise leave one. */
function boundsHint(min: number | undefined, max: number | undefined, precision: number | undefined, unit?: string): string {
  const parts: string[] = [];
  if (unit) parts.push(unit);
  if (min !== undefined && max !== undefined) parts.push(`${min} – ${max}`);
  else if (min !== undefined) parts.push(`at least ${min}`);
  else if (max !== undefined) parts.push(`at most ${max}`);
  if (precision !== undefined) parts.push(`${precision} decimal place${precision === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

const withoutKey = <T extends Record<string, unknown>>(record: T, key: string): T => {
  if (!Object.hasOwn(record, key)) return record;
  const next = { ...record };
  delete next[key];
  return next;
};

/** One field whose live text is its own state, resynced from `value` only while the person is not
 *  focused on it — the fix for the classic controlled-input-vs-external-poll fight: a keystroke made
 *  while a poll lands must never be clobbered, and a value HimaGuide changed must still appear the
 *  moment the person is not in the middle of typing over it.
 *
 *  Saving is debounced rather than fired on every keystroke — a person typing "2.25" is one edit, not
 *  four requests — and flushed at once on blur or Enter, which is when a person moving on to the next
 *  field expects this one to be settled. */
function EditableField({ control, value, placeholder, disabled, ariaLabel, title, onCommit, onFocusMark, onPending }: {
  readonly control: string; readonly value: string; readonly placeholder?: string; readonly disabled?: boolean;
  /** C17: every `EditableField` names itself for assistive tech — this document has no `<label
   *  for>` of its own (the eyebrow beside a field is not programmatically associated with its
   *  input), so this is the only text a screen reader has for the field at all. */
  readonly ariaLabel: string;
  /** C17: the full value, for a field (the Inputs grid's own narrow "value" column, most often) that
   *  can visually truncate a long bound path — a native tooltip on hover reads it in full even when
   *  the field itself cannot show it all. */
  readonly title?: string;
  onCommit(next: string): void; onFocusMark?(): void;
  /** Told `true` the moment a keystroke has an unsaved debounce pending, `false` once it either
   *  flushes or is abandoned — how the page knows not to let Confirm read a proposal id an edit still
   *  in flight is about to invalidate (below, `pendingFields`). */
  onPending?(pending: boolean): void;
}): ReactElement {
  const [text, setText] = useState(value);
  const [focused, setFocused] = useState(false);
  const committed = useRef(value);
  const debounce = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => { if (!focused) { setText(value); committed.current = value; } }, [value, focused]);
  // C17: an unmount while a debounce is still pending (the Pack owner panel replacing this page
  // outright, a session switch) must still tell the caller the pending flag is over — otherwise
  // `pendingFields` keeps this control's own name forever, and `ready` (which reads
  // `pendingFields.size === 0`) never recovers even though nothing is actually mid-edit any more.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (debounce.current !== undefined) { clearTimeout(debounce.current); onPending?.(false); } }, []);
  const settle = () => { if (debounce.current !== undefined) { clearTimeout(debounce.current); debounce.current = undefined; onPending?.(false); } };
  const flush = (next: string) => {
    settle();
    if (next !== committed.current) { committed.current = next; onCommit(next); }
  };
  return <input data-hima-control={control} value={text} placeholder={placeholder} disabled={disabled} aria-label={ariaLabel} title={title}
    onFocus={() => { setFocused(true); onFocusMark?.(); }}
    onChange={(event) => {
      const next = event.target.value; setText(next);
      if (debounce.current === undefined) onPending?.(true); else clearTimeout(debounce.current);
      debounce.current = setTimeout(() => { debounce.current = undefined; onPending?.(false); flush(next); }, 400);
    }}
    onBlur={() => { setFocused(false); flush(text); }}
    onKeyDown={(event) => { if (event.key === 'Enter') { flush(text); event.currentTarget.blur(); } }} />;
}

/** The "HimaGuide · new" eyebrow (#41 task 7): shown on a field this session has not yet focused
 *  since the poll last saw it change under the person's own edit. */
function ChangedMark({ path, changed }: { path: string; changed: ReadonlySet<string> }): ReactElement | null {
  return changed.has(path) ? <span className="hima-config-mark">HimaGuide · new</span> : null;
}

const rowProps = (path: string, changed: ReadonlySet<string>) => ({
  className: `hima-config-field-row${changed.has(path) ? ' hima-changed' : ''}`,
  'data-hima-state-changed': String(changed.has(path)),
});

/** C17: the Inputs section's own row — a three-column grid (name | value | state) rather than the
 *  wrapping flex row every other section's `rowProps` still draws — carrying the same "changed"
 *  marking `rowProps` computes, under its own grid class. */
const inputRowProps = (path: string, changed: ReadonlySet<string>) => ({
  className: `hima-config-input-row${changed.has(path) ? ' hima-changed' : ''}`,
  'data-hima-state-changed': String(changed.has(path)),
});

/** The mini reference graph (Global Constraints: 50 px tall, hollow) — the same `layoutCanvas` the
 *  Live canvas uses, drawn at a fraction of the size and with no state colour: a Campaign that has
 *  not started yet has no execution facts to show, only the method's own shape. */
/** The mini reference graph scales by node size, never by the row's own box (review, second pass):
 *  a graph with more rows must not shrink every node into an unreadable smudge just to keep the
 *  whole shape under some fixed box height. `NODE` is `layoutCanvas`'s own 36-unit node diameter; a
 *  14 px rendered diameter is what stays legible at this document's own label/eyebrow sizes. */
/** The one true scale: a 36-unit (`NODE`) node rendered at a 14 px diameter, fixed regardless of how
 *  many rows the reference graph has — never derived from fitting the whole scene into some box (a
 *  many-row, many-node method must not shrink every node into an unreadable smudge just to keep the
 *  overall shape under a fixed height; see item 3 below for what happens to a *wide* one instead). */
const MINI_GRAPH_SCALE = 14 / NODE;
/** The desired on-screen node half-size in px (a 14 px diameter) — `KindOutline` draws in the same
 *  raw scene units `node.x`/`node.y` and the `viewBox` below are in, so this is divided by `k` before
 *  it reaches `KindOutline`, never passed through directly (that would be a raw-unit half-size of 7,
 *  rendering at 7 times `k`, about 2.7 px — the exact bug a prior round of this fix shipped). */
const MINI_GRAPH_NODE_HALF_PX = 7;
/** The vertical margin (raw scene units) kept above the highest node/goal and below the lowest, so a
 *  hung node's own stroke is never flush against the viewBox edge. */
const MINI_GRAPH_Y_MARGIN = 20;
/** The horizontal margin (raw scene units) kept to the right of the Goal roundel, the graph's own
 *  rightmost mark. */
const MINI_GRAPH_X_MARGIN = 24;

function MiniReferenceGraph({ graph }: { graph: PreparationView['referenceGraph'] }): ReactElement {
  const scene = useMemo(() => layoutCanvas({
    entry: graph.entry,
    nodes: graph.nodes.map((node) => ({ id: node.id, kind: node.kind as NodeKind, caption: node.id })),
    edges: graph.edges.map((edge) => ({ from: edge.from, to: edge.to, ...(edge.outcome === undefined ? {} : { outcome: edge.outcome }), ...(edge.revisit === true ? { revisit: true as const } : {}) })),
  }), [graph]);
  const k = MINI_GRAPH_SCALE;
  // The viewBox is trimmed to the node band, never the whole scene: `scene.height`/`scene.width`
  // carry `layoutCanvas`'s own generous top padding (`PAD_Y`) and goal-roundel margin meant for the
  // full-size canvas, which for even the shortest single-row graph is over 200 units tall — mapped by
  // one fixed `k`, that is most of this preview's own height spent on empty margin, not method.
  const ys = [...scene.nodes.map((node) => node.y), scene.goal.y];
  // C17: a revisit edge draws its own arc (and generation badge) above the spine — `canvas-layout.ts`'s
  // own `classifyEdge` pulls it up to 90 raw units past its endpoints — which the plain node/goal
  // band above under-counts for a graph with a revisit edge, clipping the arc's own apex against
  // this preview's own top edge. `min(node.y) − 70` is this preview's own fixed band extension for
  // that case (a flat figure, not a per-edge apex computation — nothing here needs the exact bezier
  // curve `layoutCanvas` draws, only room enough that it is never cut off).
  const hasRevisit = scene.edges.some((edge) => edge.kind === 'revisit');
  const top = hasRevisit ? Math.min(...scene.nodes.map((node) => node.y)) - 70 : Math.min(...ys) - MINI_GRAPH_Y_MARGIN;
  const bottom = Math.max(...ys) + MINI_GRAPH_Y_MARGIN;
  const left = 0;
  const right = scene.goal.x + MINI_GRAPH_X_MARGIN;
  const width = (right - left) * k;
  const height = (bottom - top) * k;
  const rawHalf = MINI_GRAPH_NODE_HALF_PX / k;
  return (
    <div className="hima-config-mini-graph-wrap">
      <svg className="hima-config-mini-graph" width={width} height={height} viewBox={`${left} ${top} ${right - left} ${bottom - top}`}
        preserveAspectRatio="xMinYMin meet" role="img" aria-label={`Reference graph, ${scene.nodes.length} nodes`}>
        {scene.edges.map((edge, index) => <path key={index} d={edge.path} className={edge.kind === 'revisit' ? 'hima-config-mini-edge-revisit' : 'hima-config-mini-edge'} />)}
        {scene.nodes.map((node) => (
          <g key={node.id} transform={`translate(${node.x},${node.y})`} className="hima-config-mini-node">
            <KindOutline kind={node.kind} half={rawHalf} mark={node.kind === 'explore'} />
          </g>
        ))}
        <circle cx={scene.goal.x} cy={scene.goal.y} r={rawHalf} className="hima-config-mini-goal" />
      </svg>
    </div>
  );
}

interface ServerSnapshot { readonly file: CampaignFile; readonly text: string; readonly mtimeMs?: number }

export function ConfigurationPage({ sessionId, askGuide, pickFolder, onStarted, openPackOwner, onBusy, refreshSignal }: ConfigurationPageProps): ReactElement {
  const ask = askGuide ?? draftToGuide;
  const [draft, setDraft] = useState<CampaignFile>();
  const [view, setView] = useState<CampaignFileView>();
  const [choices, setChoices] = useState<StartChoices>();
  const [sites, setSites] = useState<readonly SiteHeadView[]>([]);
  const [changed, setChanged] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string>();
  const [starting, setStarting] = useState(false);
  // A second click landing before the first confirmation's response comes back must not start a
  // second Run: `starting` (state) drives the button's own disabled look, but two clicks inside the
  // same synchronous tick both close over the pre-render `false`, so the guard itself is a ref.
  const confirming = useRef(false);
  const [sshDestination, setSshDestination] = useState('');
  const [siteHints, setSiteHints] = useState('');
  const [discovering, setDiscovering] = useState(false);
  // Bug 2: an existing ssh Site's own facts (e.g. which EDA tools are on its PATH) can go stale, and
  // until now the only GUI affordance for an existing Site was "Discover with HimaGuide", which only
  // drafts a chat message — HimaGuide's own `hima_site rediscover` tool call never writes a Site or
  // Permit file (by design: the person is the one who may grant a Permit's authority, never the
  // model). This holds a freshly rediscovered, *unsaved* draft for this page's own review, mirroring
  // the Pack install review-then-confirm pattern (`PackOwnerPanel`) rather than saving automatically.
  const [siteRediscovery, setSiteRediscovery] = useState<{ readonly name: string; readonly result: SiteDiscoveryResult; readonly reviewId: string } | undefined>();
  const [knowledgePath, setKnowledgePath] = useState('');
  // Which fields have an unsaved debounce pending, and how many saves are on the wire right now —
  // together, whether it is safe to say this page is ready: a Host answer that called the file ready
  // a moment ago is not ready to confirm while an edit still in flight is about to change the very
  // proposal id Confirm would read (`ready`, below `commitField`).
  const [pendingFields, setPendingFields] = useState<ReadonlySet<string>>(new Set());
  const [inFlight, setInFlight] = useState(0);
  /** One sentence per field whose last-typed value does not parse (review MINOR: "Enter a number for
   *  '‹label›'." and no PUT at all), keyed by the same dotted path `changed`/`pendingFields` use. */
  const [fieldErrors, setFieldErrors] = useState<ReadonlyMap<string, string>>(new Map());
  const server = useRef<ServerSnapshot>();
  // The latest draft, read synchronously: two fields blurred in the same tick (a person tabbing
  // fast, or a test driver's `fill` — which focuses the next control before setting it, blurring
  // whatever was focused before, all inside one synchronous script) each build their own write off
  // this ref rather than off `draft` state, which would still hold the pre-batch value for the
  // second handler and so would ship a request that silently drops the first handler's own edit.
  const draftRef = useRef<CampaignFile>();
  // Saves are queued rather than fired concurrently, for the same reason: two in-flight PUTs to the
  // same file can resolve out of order, and whichever answers last would overwrite `draft` with a
  // file that never saw the other one's edit even though the request body itself was correct.
  const queue = useRef(Promise.resolve());
  const saving = useRef(false);

  const adopt = (next: CampaignFile) => { draftRef.current = next; setDraft(next); };

  // Mounted-ness, read by `tick` after its own `await` — the Pack owner panel now replaces this page
  // outright (`HimaWorkbench`'s mutually-exclusive render, #41 task 7 review), so opening it unmounts
  // this component while a poll it started may still be in flight; that poll's `setState` calls must
  // not fire into an unmounted component once its `fetch`es finally resolve.
  const aliveRef = useRef(true);
  useEffect(() => { aliveRef.current = true; return () => { aliveRef.current = false; }; }, []);

  const tick = useRef(async () => {});
  tick.current = async () => {
    const [fileResult, choicesResult, sitesResult] = await Promise.all([
      fetchCampaignFile(sessionId), fetchStartChoices(), fetchSites(),
    ]);
    if (!aliveRef.current) return;
    if (choicesResult.ok) setChoices(choicesResult.value);
    if (sitesResult.ok) setSites(sitesResult.value.sites);
    if (!fileResult.ok) { setError(fileResult.error.message); return; }
    if (saving.current) return;
    const value = fileResult.value;
    const previous = server.current;
    if (previous === undefined) {
      server.current = { file: value.file, text: value.text, mtimeMs: value.mtimeMs };
      adopt(value.file); setView(value);
      return;
    }
    // Monotonic adoption (review item 2): a save that just completed already moved `server.current`
    // to its own (newer) mtime; a poll whose request raced that save and is only now answering with
    // what the file held *before* it must never roll this page back to that stale read, no matter
    // which response happens to arrive last. Equal or older mtimes still refresh `view` (a Site or
    // Pack list can change on its own) but never adopt the file or mark anything changed.
    const isNewer = value.mtimeMs !== undefined && (previous.mtimeMs === undefined || value.mtimeMs > previous.mtimeMs);
    if (isNewer && value.text !== previous.text) {
      const marks = changedFields(previous.file, value.file);
      server.current = { file: value.file, text: value.text, mtimeMs: value.mtimeMs };
      adopt(value.file); setView(value);
      setChanged((prior) => new Set([...prior, ...marks]));
    } else {
      setView(value);
    }
  };

  useEffect(() => {
    const poll = () => { if (aliveRef.current) void tick.current(); };
    poll();
    const timer = setInterval(poll, 3000);
    return () => { clearInterval(timer); };
    // `refreshSignal` (Bug 3 fix): a changed value re-runs this effect, which polls immediately and
    // restarts the interval — the same "poll now" `retry` already does for one readiness row, now
    // reachable from the page-level refresh button too.
  }, [sessionId, refreshSignal]);

  const clearChanged = (path: string) => setChanged((prior) => { if (!prior.has(path)) return prior; const next = new Set(prior); next.delete(path); return next; });
  const clearFieldError = (path: string) => setFieldErrors((prior) => { if (!prior.has(path)) return prior; const next = new Map(prior); next.delete(path); return next; });

  /** A field's debounce armed or fired — tracked by its own control name, so two fields pending at
   *  once are counted correctly and neither's flush clears the other's flag. */
  const trackPending = (control: string) => (pending: boolean) => setPendingFields((prior) => {
    if (prior.has(control) === pending) return prior;
    const next = new Set(prior);
    if (pending) next.add(control); else next.delete(control);
    return next;
  });

  /**
   * Save one edit, reconciling a save-conflict re-read (review item 1) rather than overwriting
   * whatever changed the file since this session's own last read: `updater` is the person's edit as
   * a pure function of the file it is applied to, so a 409 can recompute the very same edit onto the
   * fresh file the Host just handed back (`result.error.current`) and retry once with that file's own
   * mtime — never a second, independently-reasoned write.
   *
   * `expectedMtimeMs` reads off `server.current` at the moment the PUT is actually issued — inside
   * the queued callback, never captured when this call was made (review: two fields committed back
   * to back would otherwise each carry the mtime read *before either saved*, so the second request in
   * the queue would always name a now-stale mtime and 409 as the common case, rather than only when
   * something else genuinely changed the file first). Each save still reads whatever the *previous*
   * save in this same queue already moved `server.current` to, so a successful chain of edits never
   * conflicts with itself.
   */
  const attemptSave = (path: string, updater: (file: CampaignFile) => CampaignFile, next: CampaignFile) => {
    setInFlight((count) => count + 1);
    queue.current = queue.current.then(async () => {
      saving.current = true; setError(undefined);
      const result = await saveCampaignFile(sessionId, next, server.current?.mtimeMs);
      if (!result.ok && result.error.code === 'hima/campaign-file-changed' && result.error.current) {
        const remote = result.error.current;
        // HimaGuide's own changes are marked; the field this very save is retrying is not one of
        // them, even if it numerically differs — that field is the person's own unconfirmed edit,
        // not something to tell them arrived from elsewhere.
        const marks = changedFields(server.current?.file ?? remote.file, remote.file).filter((changedPath) => changedPath !== path);
        server.current = { file: remote.file, text: remote.text, mtimeMs: remote.mtimeMs };
        if (marks.length > 0) setChanged((prior) => new Set([...prior, ...marks]));
        const retried = updater(remote.file);
        adopt(retried);
        setInFlight((count) => count - 1);
        attemptSave(path, updater, retried);
        return;
      }
      saving.current = false;
      setInFlight((count) => count - 1);
      if (!result.ok) { setError(result.error.message); return; }
      server.current = { file: result.value.file, text: result.value.text, mtimeMs: result.value.mtimeMs };
      setView(result.value);
      // Adopt the server's own (normalized) echo only while nothing newer has been queued behind
      // this save — a later commit already moved `draftRef` on, and this echo must not roll it back.
      if (draftRef.current === next) adopt(result.value.file);
    });
  };

  const commitField = (path: string, updater: (file: CampaignFile) => CampaignFile) => {
    clearChanged(path);
    clearFieldError(path);
    const base = draftRef.current;
    if (base === undefined) return;
    const next = updater(base);
    adopt(next);
    attemptSave(path, updater, next);
  };

  /** A number field's own commit (review MINOR): text that does not parse as a finite number shows
   *  "Enter a number for '‹label›'." beside the field and saves nothing — silently rounding, coercing
   *  or ignoring it would tell the person their edit landed when it did not. */
  const commitNumericField = (path: string, label: string, text: string, apply: (file: CampaignFile, value: number | undefined) => CampaignFile) => {
    if (text === '') { clearFieldError(path); commitField(path, (file) => apply(file, undefined)); return; }
    const numeric = Number(text);
    if (!Number.isFinite(numeric)) { setFieldErrors((prior) => new Map(prior).set(path, `Enter a number for '${label}'.`)); return; }
    clearFieldError(path);
    commitField(path, (file) => apply(file, numeric));
  };

  if (draft === undefined) {
    return <div className="hima-config hima-root" data-hima-region="configuration" data-hima-state-ready="false" data-hima-state-pack="" data-hima-state-site="" data-hima-state-changed="0">
      <p className="hima-small">Reading the Campaign file…</p>
    </div>;
  }

  const proposal = view?.preparation?.proposal;
  const settled = pendingFields.size === 0 && inFlight === 0;
  // A failed save leaves `view` at its last successful read, which can still say `ready` about a
  // proposal the current draft has already moved past (the very edit that just failed to land) —
  // `error` is cleared the moment a fresh save is queued, so this only ever holds Confirm back for
  // an edit that is genuinely unconfirmed on the Host. C17: a field whose last-typed text does not
  // parse (`fieldErrors`) never saved at all — Confirm must not read a proposal as ready while a
  // person is still looking at "Enter a number for '…'." beside a field HimaGuide's own preparation
  // never actually saw.
  const ready = proposal?.ready === true && settled && error === undefined && fieldErrors.size === 0;
  const siteName = draft.site !== undefined && 'name' in draft.site ? draft.site.name : '';
  const siteHead = sites.find((site) => site.name === siteName);
  const siteNeedsAttention = siteHead !== undefined && siteHead.readiness !== 'ready';

  // Bug: some hosts advertise `uiWorkspace` but only serve its "browse" capability, not
  // "directoryPicker.pick" — `pickFolder()` then rejects instead of resolving `null`. Left
  // uncaught, that rejection escaped this fire-and-forget async handler silently: the button
  // looked dead (no dialog, no panel, no error) with nothing but an unhandled-rejection console
  // entry to show for it. The owner panel's own text field is the documented fallback for a
  // missing picker (see `PackOwnerPanel`'s `pickFolder` doc) — route a *failing* picker there too.
  const installPack = async () => {
    if (pickFolder) { const picked = await pickFolder().catch(() => null); openPackOwner?.(picked ?? undefined); return; }
    openPackOwner?.();
  };

  const discoverNewSite = async () => {
    const destination = sshDestination.trim();
    if (!destination) return;
    const host = destination.split('@')[1]?.split(':')[0] ?? destination;
    const name = host.replace(/[^A-Za-z0-9_.-]/g, '-').replace(/^[^A-Za-z]+/, 'site-');
    setDiscovering(true); setError(undefined);
    const workspaceRoot = siteHints.trim() || undefined;
    const result = await discoverSite({ sessionId, name, pack: draft.pack?.id, ssh: { destination }, save: true,
      ...(workspaceRoot === undefined ? {} : { hints: { workspaceRoot, allowedReadRoots: [workspaceRoot], allowedWriteRoots: [workspaceRoot] } }) });
    setDiscovering(false);
    if (!result.ok) { setError(result.error.message); return; }
    commitField('site', (file) => ({ ...file, site: { name } }));
  };

  /** Bug 2 fix: rediscover an already-saved ssh Site — the destination, jumps and permitted roots on
   *  file, no retyping — and hold the fresh, unsaved draft for review. Nothing is written yet. */
  const rediscoverSite = async () => {
    if (siteName === '') return;
    setDiscovering(true); setError(undefined);
    const result = await discoverSite({ sessionId, name: siteName, pack: draft.pack?.id, save: false });
    setDiscovering(false);
    if (!result.ok) { setError(result.error.message); return; }
    if (result.value.reviewId === undefined) { setError('Site rediscovery returned no review identity; nothing was saved.'); return; }
    setSiteRediscovery({ name: siteName, result: result.value.result, reviewId: result.value.reviewId });
  };

  /** The person's own save of the draft `rediscoverSite` produced: a second, identical discovery
   *  request, this time with `save: true` — the same protocol the "Discover with HimaGuide" button
   *  already uses for a brand-new Site (`discoverNewSite`), and the only thing in this page that ever
   *  writes a Site or Permit file. HimaGuide itself has no path to this call. */
  const saveSiteRediscovery = async () => {
    if (siteRediscovery === undefined) return;
    setDiscovering(true); setError(undefined);
    const result = await discoverSite({ sessionId, name: siteRediscovery.name, reviewId: siteRediscovery.reviewId, save: true });
    setDiscovering(false);
    if (!result.ok) { setError(result.error.message); return; }
    setSiteRediscovery(undefined);
    void tick.current();
  };

  /** C17: knowledge entries are always added by a typed path, never the native folder picker —
   *  unlike a Pack's own source folder (`installPack`, a whole directory), a knowledge document is
   *  one file, and `pickFolder` (a directory chooser) is the wrong tool for naming one. */
  const addKnowledge = () => {
    const value = knowledgePath.trim();
    if (value === '') return;
    setKnowledgePath('');
    commitField('knowledge', (file) => ({ ...file, knowledge: [...file.knowledge, value] }));
  };

  const onConfirm = async () => {
    if (!ready || confirming.current || draft.pack === undefined || proposal === undefined) return;
    confirming.current = true; setStarting(true); setError(undefined); onBusy?.(true);
    const result = await startCampaign({ fromCampaignFile: true, sessionId, pack: draft.pack.id, ...(siteName === '' ? {} : { site: siteName }), proposalId: proposal.id });
    confirming.current = false; setStarting(false); onBusy?.(false);
    if (!result.ok) { setError(result.error.message); return; }
    onStarted(result.value);
  };

  /** `config-retry` (review MINOR): clear the last save's error and re-run the same read the poll
   *  makes, at once rather than waiting out the rest of the 3 s interval. */
  const retry = () => { setError(undefined); void tick.current(); };

  const unknowns = proposal?.unknowns ?? (draft.pack === undefined ? ['Choose a HimaPack to begin Campaign preparation.'] : []);

  return <div className="hima-config hima-root" data-hima-region="configuration" data-hima-state-ready={String(ready)} data-hima-state-pack={draft.pack?.id ?? ''} data-hima-state-site={siteName} data-hima-state-changed={String(changed.size)}>
    <header className="hima-config-header">
      <h2>Campaign configuration</h2>
      <p className="hima-config-header-sub">hima/campaign.yml{changed.size > 0 ? ` · HimaGuide filled ${changed.size} field${changed.size === 1 ? '' : 's'} since you last looked` : ''}</p>
    </header>

    <section data-hima-region="config-name">
      <span className="hima-config-eyebrow">Name</span>
      <div {...rowProps('name', changed)}>
        <EditableField control="config-name" value={draft.name ?? ''} placeholder="Untitled Campaign" ariaLabel="Campaign name" onFocusMark={() => clearChanged('name')} onPending={trackPending('config-name')}
          onCommit={(text) => commitField('name', (file) => ({ ...file, name: text === '' ? undefined : text }))} />
        <ChangedMark path="name" changed={changed} />
      </div>
    </section>

    <section data-hima-region="config-pack">
      <span className="hima-config-eyebrow">Pack</span>
      <div {...rowProps('pack', changed)}>
        <select data-hima-control="config-pack" aria-label="Pack" value={draft.pack?.id ?? ''} onFocus={() => clearChanged('pack')}
          onChange={(event) => { const id = event.target.value; clearChanged('pack'); commitField('pack', (file) => ({ ...file, pack: id === '' ? undefined : { id } })); }}>
          <option value="">Choose a Pack…</option>
          {choices?.packs.map((id) => <option key={id} value={id} disabled={choices?.cannotStart?.includes(id)}>{id}{choices?.marks?.[id] ? ` — ${choices.marks[id]}` : ''}</option>)}
        </select>
        <ChangedMark path="pack" changed={changed} />
      </div>
      {proposal ? <>
        <p className="hima-config-detail">{proposal.pack.title} · {proposal.pack.id}@{proposal.pack.version}{proposal.pack.status ? <span className="hima-pill">{proposal.pack.status.normalized}</span> : null}</p>
        <MiniReferenceGraph graph={proposal.referenceGraph} />
      </> : draft.pack === undefined ? <div className="hima-config-empty-pack" data-hima-region="config-empty-pack">
        {choices?.packs.length === 0 ? <strong>No HimaPack is installed.</strong> : null}
        <button className="hima-button" data-hima-control="config-install-pack" onClick={() => { void installPack(); }}>Install a Pack</button>
        <button className="hima-button" data-hima-control="config-ask-pack" onClick={() => ask('What is a HimaPack and which one should I install for …?')}>Ask HimaGuide</button>
      </div> : null}
    </section>

    <section data-hima-region="config-site">
      <span className="hima-config-eyebrow">Site</span>
      <div {...rowProps('site', changed)}>
        <select data-hima-control="config-site" aria-label="Site" value={siteName} onFocus={() => clearChanged('site')}
          onChange={(event) => { const name = event.target.value; clearChanged('site'); commitField('site', (file) => ({ ...file, site: name === '' ? undefined : { name } })); }}>
          <option value="">Choose a Site…</option>
          {sites.map((site) => <option key={site.name} value={site.name}>{site.name} — {site.kind}{site.readiness !== 'ready' ? ` (${site.readiness})` : ''}</option>)}
        </select>
        <ChangedMark path="site" changed={changed} />
        {siteName !== '' && siteNeedsAttention
          ? <>
              <button className="hima-button" data-hima-control="config-discover" onClick={() => ask(`Discover the Site ${siteName} with hima_site and tell me what you find.`)}>Discover with HimaGuide</button>
              {/* Bug 2 fix: a real GUI save path for a Site's own facts and Permit, beside the
                  chat-only affordance above. Rediscovering only reads the Site; nothing is written
                  until the person reviews the draft below and clicks Save. */}
              <button className="hima-button" data-hima-control="config-site-rediscover" disabled={discovering} onClick={() => { void rediscoverSite(); }}>{discovering && siteRediscovery === undefined ? 'Rediscovering…' : 'Rediscover'}</button>
            </>
          : null}
      </div>
      {proposal?.site ? <p className="hima-config-detail">{proposal.site.name} · {proposal.site.kind} · {proposal.site.resources.cores} cores · {proposal.site.resources.memoryGiB} GiB · {proposal.site.resources.parallelJobs} parallel job(s)</p> : null}
      {siteRediscovery !== undefined && siteRediscovery.name === siteName ? <div className="hima-config-site-draft" data-hima-region="config-site-rediscovery">
        <p className="hima-config-detail">Rediscovered {siteRediscovery.result.unknowns.length} unknown(s){siteRediscovery.result.conflicts.length > 0 ? `, ${siteRediscovery.result.conflicts.length} conflict(s)` : ''} — not saved yet.</p>
        <p className="hima-small">Read roots: {siteRediscovery.result.permit.allowedReadRoots.join(', ') || 'none'}</p>
        <p className="hima-small">Write roots: {siteRediscovery.result.permit.allowedWriteRoots.join(', ') || 'none'}</p>
        <p className="hima-small">Wrappers: {siteRediscovery.result.permit.allowedWrappers.join(', ') || 'none'}</p>
        {siteRediscovery.result.unknowns.map((sentence, index) => <p key={index} className="hima-small">{sentence}</p>)}
        {siteRediscovery.result.conflicts.map((sentence, index) => <p key={index} className="hima-small">{sentence}</p>)}
        <button className="hima-button hima-primary" data-hima-control="config-site-rediscover-save" disabled={discovering} onClick={() => { void saveSiteRediscovery(); }}>{discovering ? 'Saving…' : 'Save reviewed Site'}</button>
        <button className="hima-button" data-hima-control="config-site-rediscover-discard" disabled={discovering} onClick={() => setSiteRediscovery(undefined)}>Discard</button>
      </div> : null}
      {/* C17: `align-items:flex-start` (`workbench-style.ts`) — a `flex-direction:column` container
          otherwise stretches each labelled field to the row's own full width, which reads oddly for
          two short-and-tall fields (an SSH destination line, a hints textarea) stacked in one column. */}
      {siteName === '' ? <div className="hima-config-site-new">
        <label className="hima-config-site-new-label">SSH destination<input data-hima-control="config-site-ssh" aria-label="SSH destination" value={sshDestination} placeholder="user@host" onChange={(event) => setSshDestination(event.target.value)} /></label>
        <label className="hima-config-site-new-label">Discovery hints<textarea data-hima-control="config-site-hints" aria-label="Discovery hints" value={siteHints} placeholder="Workspace root, e.g. /work/hima" onChange={(event) => setSiteHints(event.target.value)} /></label>
        <button className="hima-button" data-hima-control="config-discover" disabled={sshDestination.trim() === '' || discovering} onClick={() => { void discoverNewSite(); }}>{discovering ? 'Discovering…' : 'Discover with HimaGuide'}</button>
      </div> : null}
    </section>

    {/* C17: an aligned three-column grid (name | value | state) — `.hima-config-input-row`,
        `workbench-style.ts` — rather than a wrapping flex row whose columns drifted out of line
        from one input to the next. A bound value (whether typed by a person or resolved off the
        Site's own binding) is shown as the field's real text; the placeholder is reserved for a
        genuinely unbound input, never used to stand in for a value this page already knows. */}
    <section data-hima-region="config-inputs">
      <span className="hima-config-eyebrow">Inputs</span>
      {draft.pack === undefined ? <AvailableOncePackChosen /> : (proposal?.inputs ?? []).map((input) => {
        const path = `inputs.${input.name}`;
        const state = input.source === 'file' ? 'bound by HimaGuide' : input.source === 'site' ? 'bound by Site' : 'unbound';
        const draftValue = draft.inputs[input.name];
        const boundValue = draftValue ?? (input.ready ? input.value : undefined);
        return <div key={input.name} data-hima-region={`config-input-${input.name}`} data-hima-state-bound={String(input.ready)} {...inputRowProps(path, changed)}>
          <span className="hima-config-input-name">
            <StateRoundel state={input.ready ? 'good' : 'warn'} glyph={input.ready ? 'dot' : 'circle'} />
            <strong>{input.name}</strong>
          </span>
          <EditableField control={`config-input-${input.name}`} value={boundValue ?? ''} placeholder={input.ready ? undefined : input.value} title={boundValue}
            ariaLabel={`Input ${input.name}`} onFocusMark={() => clearChanged(path)} onPending={trackPending(`config-input-${input.name}`)}
            onCommit={(text) => commitField(path, (file) => ({ ...file, inputs: text === '' ? withoutKey(file.inputs, input.name) : { ...file.inputs, [input.name]: text } }))} />
          <span className="hima-config-input-state">{state}<ChangedMark path={path} changed={changed} /></span>
          <span className="hima-config-input-desc">{input.description}
            {input.ready ? null : <button className="hima-button" data-hima-control={`config-ask-${input.name}`} onClick={() => ask(`Bind the input '${input.name}': ${input.description}.`)}>Ask HimaGuide</button>}
          </span>
        </div>;
      })}
    </section>

    <section data-hima-region="config-goal">
      <span className="hima-config-eyebrow">Goal</span>
      {draft.pack === undefined ? <AvailableOncePackChosen /> : Object.entries(proposal?.goalDeclared ?? {}).map(([name, declared]) => {
        const path = `goal.${name}`;
        const label = declared.label + (declared.unit ? ` (${declared.unit})` : '');
        const hint = boundsHint(declared.min, declared.max, declared.precision);
        const packDefault = view?.preparation?.goal?.[name]?.default;
        return <div key={name} {...rowProps(path, changed)}>
          <span>{label}</span>
          <EditableField control={`config-goal-${name}`} value={draft.goal[name] !== undefined ? String(draft.goal[name]) : ''} ariaLabel={label}
            placeholder={packDefault !== undefined ? `default ${packDefault}` : 'required, not yet set'} onFocusMark={() => clearChanged(path)} onPending={trackPending(`config-goal-${name}`)}
            onCommit={(text) => commitNumericField(path, label, text, (file, value) => ({ ...file, goal: value === undefined ? withoutKey(file.goal, name) : { ...file.goal, [name]: value } }))} />
          <span className="hima-small">{hint}<ChangedMark path={path} changed={changed} /></span>
          {fieldErrors.get(path) ? <span className="hima-notice" role="alert">{fieldErrors.get(path)}</span> : null}
        </div>;
      })}
    </section>

    <section data-hima-region="config-strategy">
      <span className="hima-config-eyebrow">Strategy</span>
      {draft.pack === undefined ? <AvailableOncePackChosen /> : Object.entries(view?.preparation?.strategy ?? {}).map(([name, knob]) => {
        const path = `strategy.${name}`;
        const label = view?.preparation?.words?.strategy[name]?.label ?? name;
        const current = draft.strategy[name];
        return <div key={name} {...rowProps(path, changed)}>
          <span>{label}</span>
          {knob.type === 'choice'
            ? <select data-hima-control={`config-knob-${name}`} aria-label={label} value={current !== undefined ? String(current) : ''} onFocus={() => clearChanged(path)}
                onChange={(event) => { const value = event.target.value; commitField(path, (file) => ({ ...file, strategy: value === '' ? withoutKey(file.strategy, name) : { ...file.strategy, [name]: value } })); }}>
                <option value="">Pack default: {knob.default}</option>
                {knob.options.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            : <EditableField control={`config-knob-${name}`} value={current !== undefined ? String(current) : ''} placeholder={`Pack default ${knob.default}`} ariaLabel={label} onFocusMark={() => clearChanged(path)} onPending={trackPending(`config-knob-${name}`)}
                onCommit={(text) => commitNumericField(path, label, text, (file, value) => ({ ...file, strategy: value === undefined ? withoutKey(file.strategy, name) : { ...file.strategy, [name]: value } }))} />}
          <span className="hima-small">{knob.type === 'number' ? boundsHint(knob.min, knob.max, knob.precision, knob.unit) : `choice · ${knob.options.join(', ')}`}<ChangedMark path={path} changed={changed} /></span>
          {fieldErrors.get(path) ? <span className="hima-notice" role="alert">{fieldErrors.get(path)}</span> : null}
        </div>;
      })}
    </section>

    <section data-hima-region="config-budget">
      <span className="hima-config-eyebrow">Budget</span>
      {([['timeBoxMinutes', 'Time box (minutes)'], ['retries', 'Retries'], ['generations', 'Generations']] as const).map(([key, label]) => {
        const path = `budget.${key}`;
        const declared = proposal?.budget[key];
        return <div key={key} {...rowProps(path, changed)}>
          <span>{label}</span>
          <EditableField control={`config-budget-${key}`} value={draft.budget[key] !== undefined ? String(draft.budget[key]) : ''} placeholder={declared ? `${declared.source} default ${declared.value}` : ''} ariaLabel={label} onFocusMark={() => clearChanged(path)} onPending={trackPending(`config-budget-${key}`)}
            onCommit={(text) => commitNumericField(path, label, text, (file, value) => ({ ...file, budget: value === undefined ? withoutKey(file.budget, key) : { ...file.budget, [key]: value } }))} />
          <span className="hima-small">{declared ? declared.source : ''}<ChangedMark path={path} changed={changed} /></span>
          {fieldErrors.get(path) ? <span className="hima-notice" role="alert">{fieldErrors.get(path)}</span> : null}
        </div>;
      })}
      {proposal?.budget.jobCap !== undefined ? <p className="hima-small">Job cap · seats: {proposal.budget.jobCap}{proposal.budget.licences ? ` · ${Object.entries(proposal.budget.licences).map(([name, seats]) => `${name} ${seats}`).join(', ')}` : ''} · from Site, read-only</p> : null}
    </section>

    {/* C17: knowledge entries are always a typed path — no `pickFolder` branch, ever, for this
        control — plus `config-ask-knowledge`, which drafts a ready-to-send request to import
        whichever documents the person names, exactly as every other "Ask HimaGuide" control here
        drafts rather than sends. */}
    <section data-hima-region="config-knowledge">
      <span className="hima-config-eyebrow">Knowledge</span>
      <p>{proposal?.pack.knowledge.length ?? 0} Pack document(s) · {proposal?.knowledge.currentDocuments ?? 0} current document(s)</p>
      {draft.knowledge.length > 0 ? <ul>{draft.knowledge.map((item, index) => <li key={index} className="hima-small hima-wrap" title={item}>{item}</li>)}</ul> : null}
      <div className="hima-config-knowledge-add-row">
        <input data-hima-control="config-knowledge-path" aria-label="Path to a knowledge document" value={knowledgePath} placeholder="Path to a document" onChange={(event) => setKnowledgePath(event.target.value)} />
        <button className="hima-button" data-hima-control="config-knowledge-add" onClick={addKnowledge}>Add a document</button>
        <button className="hima-button" data-hima-control="config-ask-knowledge" onClick={() => ask('Import these documents as current knowledge for this Campaign: …')}>Ask HimaGuide</button>
      </div>
    </section>

    <section data-hima-region="config-readiness" data-hima-state-ready={String(ready)}>
      <span className="hima-config-eyebrow">Readiness</span>
      {unknowns.length > 0 || error !== undefined ? <div role="alert">
        {unknowns.map((sentence, index) => <div key={index} className="hima-config-readiness-row">
          <StateRoundel state="warn" glyph="circle" />
          <span>{sentence}</span>
          <button className="hima-button" data-hima-control={`config-ask-unknown-${index}`} onClick={() => ask(sentence)}>Ask HimaGuide</button>
        </div>)}
        {error ? <div className="hima-config-readiness-row"><StateRoundel state="bad" glyph="warning" /><span>{error}</span>
          <button className="hima-button" data-hima-control="config-retry" onClick={retry}>Retry</button>
        </div> : null}
      </div> : null}
      {ready ? <div className="hima-config-readiness-row"><StateRoundel state="good" glyph="check" /><span>Every check passes; confirming creates the Campaign.</span></div> : null}
      <div className="hima-config-confirm-row">
        <button className="hima-button hima-primary" data-hima-control="config-confirm" disabled={!ready || starting} onClick={() => { void onConfirm(); }}>{starting ? 'Starting Campaign…' : 'Confirm and start Campaign'}</button>
        <span className="hima-small">enabled when every check passes</span>
      </div>
    </section>
  </div>;
}
