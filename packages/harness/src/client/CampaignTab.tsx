// The Campaign tab: the masthead, the view switch (Live, Generations, Evidence, Report) and the
// HimaFabric canvas that makes the Live view. Everything the four stacked Live sections
// (`RunSummary`, `CampaignGraph`, `JobActivity`, `EvidenceTrail`) used to say separately is said here
// instead — the canvas for where the Run stands, and the other three views for what it has recorded.
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { layoutCanvas } from '../canvas-layout.js';
import type { ExecutionContext } from '../fabric.js';
import { cancelAsked, cancelObserved } from '../card-labels.js';
import { runPath } from '../paths.js';
import { reportBlocks } from '../experience-report.js';
import type { RunView } from '../remote.js';
import { sceneInputs } from '../scene.js';
import { FabricCanvas } from './FabricCanvas.js';
import {
  ArchiveSection, DecisionRow, ExperienceSection, GenerationsTable, GrowthSection,
  MaterialSection, ObservationRow, ReportBlockRow, RevisionSection, VerdictRow, WorkshopSection, type Acting,
} from './HimaRunCard.js';
import { Masthead } from './Masthead.js';
import { isOwner as isOwnerOf } from './owned-run.js';

export interface CampaignTabProps {
  readonly sessionId: string;
  readonly runId: string;
  readonly view: RunView | undefined;
  readonly context: ExecutionContext | undefined;
  readonly acting: Acting;
  readonly stale: boolean;
  /** When `view` was last read successfully — the masthead's elapsed figure ticks forward from
   *  here, and the stale banner names the moment the last good read stopped being current. */
  readonly readAt?: number;
  /** The Campaign file's own name (Task 7); the campaign id stands in until then. */
  readonly name?: string;
  openOwner(id: string): void;
  openFiles(): void;
  refresh(): void;
}

type Section = 'live' | 'generations' | 'evidence' | 'report';
const SECTIONS: readonly { readonly key: Section; readonly said: string }[] = [
  { key: 'live', said: 'Live' }, { key: 'generations', said: 'Generations' },
  { key: 'evidence', said: 'Evidence' }, { key: 'report', said: 'Report' },
];

const shortTime = (at: number): string => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** `prefers-reduced-motion`, tracked live: a stale snapshot already stops every animation, and this
 *  is the other half of the Global Constraints' "reduced motion... stop everything". */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

/** The Evidence view: what a Campaign has read, recorded and concluded — material and archived
 *  knowledge first, since those are what a Run leaves behind, then the observations, verdicts,
 *  decision and blockers that read them, and finally its Workshop, growths and revisions. Says so
 *  plainly when none of that exists yet, rather than an empty pane a person might read as broken. */
function EvidenceView({ view }: { view: RunView }): ReactElement {
  const hasMaterial = view.code.length > 0 || view.knowledge.length > 0;
  const hasGrowth = view.generations.some((generation) => (generation.growths ?? []).length > 0);
  const empty = !hasMaterial && view.archive === undefined && view.workshop === undefined && !hasGrowth
    && (view.revisions ?? []).length === 0 && view.observations.length === 0 && view.verdicts.length === 0
    && (view.decision === null || view.decision === undefined) && view.blockers.length === 0
    && view.refusals.length === 0 && view.cancels.length === 0;
  if (empty) return <div className="hima-detail hima-evidence"><p>No verified evidence has been recorded for this Campaign yet.</p></div>;
  return (
    <div className="hima-detail hima-evidence">
      <MaterialSection view={view} />
      <ArchiveSection view={view} />
      {view.workshop === undefined ? null : <WorkshopSection view={view} workshop={view.workshop} />}
      <GrowthSection view={view} />
      <RevisionSection view={view} />
      {view.observations.length === 0 ? null : (
        <section>
          <h3>Observations</h3>
          {view.observations.map((observation) => (
            <details key={observation.recordId}>
              <summary>{observation.path.split('/').at(-1)} · observation</summary>
              <ObservationRow observation={observation} />
            </details>
          ))}
        </section>
      )}
      {view.verdicts.length === 0 ? null : (
        <section>
          <h3>Verdicts</h3>
          {view.verdicts.map((verdict) => (
            <details key={verdict.recordId} open={verdict.outcome !== 'PASS'}>
              <summary>{verdict.outcome} · {verdict.ruleId}@{verdict.ruleVersion}</summary>
              <VerdictRow verdict={verdict} />
            </details>
          ))}
        </section>
      )}
      {view.decision === null || view.decision === undefined ? null : (
        <details open><summary>Decision</summary><DecisionRow decision={view.decision} view={view} /></details>
      )}
      {view.blockers.map((blocker) => (
        <details key={blocker.recordId} open>
          <summary>{blocker.nodeId} · blocker</summary>
          <p>{blocker.reason}</p>
          {blocker.logTail === undefined ? null : <pre>{blocker.logTail}</pre>}
        </details>
      ))}
      {view.refusals.map((refusal, index) => (
        <details key={index} open><summary>Refused access</summary><p>{refusal.path}</p><p>{refusal.reason}</p></details>
      ))}
      {view.cancels.map((cancel) => (
        <details key={cancel.recordId}>
          <summary>Cancellation</summary>
          <p>{cancelAsked(cancel)}</p>
          <p>{cancelObserved(view, cancel).said}</p>
        </details>
      ))}
    </div>
  );
}

/** The Report view: the Campaign's technical report, as a current ledger preview or — on request —
 *  the saved file itself, read back and held to its recorded hash. */
function ReportView({ view, runId }: { view: RunView; runId: string }): ReactElement {
  const [saved, setSaved] = useState<{ markdown?: string; error?: string; loading?: boolean }>();
  const pending = useRef<AbortController>();
  useEffect(() => { setSaved(undefined); return () => pending.current?.abort(); }, [runId]);
  const openSaved = async () => {
    pending.current?.abort();
    const own = new AbortController(); pending.current = own;
    setSaved({ loading: true });
    try {
      // The JSON route (no `.md` suffix), never `experienceMarkdownPath` — that one answers with the
      // raw file itself (`media: 'text/markdown'`, `remote.ts`'s own `experienceOperation`), which is
      // what the anchor's own `href` is for, not this fetch.
      const response = await fetch(`${runPath(runId)}/experience`, { signal: own.signal, headers: { accept: 'application/json' } });
      const body = await response.json() as { markdown?: string; error?: { message?: string } };
      if (!response.ok || typeof body.markdown !== 'string') throw new Error(body.error?.message ?? `Report read failed (HTTP ${String(response.status)})`);
      if (!own.signal.aborted) setSaved({ markdown: body.markdown });
    } catch (error) { if (!own.signal.aborted) setSaved({ error: (error as Error).message }); }
  };
  return (
    <div className="hima-detail hima-report">
      <h3>Technical report</h3>
      {saved ? (
        <>
          <button type="button" className="hima-button" onClick={() => { pending.current?.abort(); setSaved(undefined); }}>Current ledger preview</button>
          <p className="hima-small">{saved.markdown !== undefined ? 'Saved Markdown · original bytes verified by the Host' : saved.loading ? 'Reading and verifying the saved file…' : 'Saved file could not be verified'}</p>
          {saved.loading ? <p>Reading saved report…</p>
            : saved.error ? <p role="alert" className="hima-notice">{saved.error}</p>
              : reportBlocks(saved.markdown!).map((block, index) => <ReportBlockRow key={index} block={block} />)}
        </>
      ) : view.experience ? (
        <ExperienceSection view={view} experience={view.experience} onOpenSaved={() => { void openSaved(); }} />
      ) : (
        <p>{view.experienceUnavailable ?? 'A technical report will appear here when the Run closes.'}</p>
      )}
    </div>
  );
}

export function CampaignTab({ sessionId, runId, view, context, acting, stale, readAt, name, openOwner, openFiles }: CampaignTabProps): ReactElement {
  const [section, setSection] = useState<Section>('live');
  const [selectedNodeId, setSelectedNodeId] = useState<string>();
  const reducedMotion = useReducedMotion();
  const control = view?.run.control;
  const isOwner = isOwnerOf(control, sessionId);
  const reference = context?.method?.reference;
  // `sceneInputs`+`layoutCanvas` recompute only when the reference graph, the Run view or the
  // execution context actually change identity (a fresh poll) — not on every render this component
  // takes for a reason of its own (switching views, selecting a node, the masthead's own tick).
  const scene = useMemo(() => {
    if (reference === undefined) return undefined;
    const built = sceneInputs(reference, view, context);
    return layoutCanvas(built.graph, built.facts);
  }, [reference, view, context]);

  useEffect(() => { setSelectedNodeId(undefined); }, [runId]);

  return (
    <div className="hima-campaign" data-hima-region="campaign" data-hima-state-run={runId}
      data-hima-state-status={view?.run.status ?? ''} data-hima-state-owner={isOwner ? 'owner' : 'side-talk'}>
      <Masthead name={name} view={view} context={context} stale={stale} reducedMotion={reducedMotion} isOwner={isOwner} ownerId={control?.owner} readAt={readAt} openOwner={openOwner} />
      <nav className="hima-campaign-views" aria-label="Campaign views">
        {SECTIONS.map(({ key, said }) => (
          <button key={key} type="button" aria-pressed={section === key} data-hima-control={`studio-${key}`} onClick={() => setSection(key)}>{said}</button>
        ))}
      </nav>
      <div className="hima-campaign-content">
        {section === 'live' ? (
          scene === undefined
            ? <div className="hima-empty"><p>{context?.reason ?? 'Reading the reference graph…'}</p></div>
            : <FabricCanvas runId={runId} scene={scene} entryNodeId={reference?.entry} view={view} context={context}
                stale={stale} reducedMotion={reducedMotion} isOwner={isOwner} selectedNodeId={selectedNodeId} onSelectNode={setSelectedNodeId}
                openOwner={openOwner} openFiles={openFiles} acting={acting} />
        ) : view === undefined
          ? <div className="hima-empty"><p>Reading Run records…</p></div>
          : section === 'generations'
            ? <div className="hima-detail"><h3>Generations</h3>{view.generations.length ? <GenerationsTable view={view} /> : <p>No Generation has opened yet.</p>}</div>
            : section === 'evidence' ? <EvidenceView view={view} /> : <ReportView view={view} runId={runId} />}
      </div>
      {!stale ? null : (
        <div className="hima-campaign-stale" role="status" data-hima-region="campaign-stale" data-hima-state-at={readAt === undefined ? '' : String(readAt)}>
          Showing the last read at {readAt === undefined ? '—' : shortTime(readAt)}; the Host could not be reached.
        </div>
      )}
    </div>
  );
}
