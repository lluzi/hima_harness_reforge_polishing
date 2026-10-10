// The Campaign tab: the masthead, the view switch (Live, Rounds, Results, Report or Reports) and the
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
import type { PreparationView } from '../workbench.js';
import { sceneInputs } from '../scene.js';
import { fetchStartChoices, scoped } from './api.js';
import { FabricCanvas } from './FabricCanvas.js';
import { ReportsView } from './ReportsView.js';
import { StripCanvas } from './StripCanvas.js';
import {
  ArchiveSection, DecisionRow, ExperienceSection, GenerationsTable, GrowthSection,
  MaterialSection, ObservationRow, ReportBlockRow, RevisionSection, VerdictRow, WorkshopSection, type Acting,
} from './HimaRunCard.js';
import { Masthead } from './Masthead.js';
import { useHimaT } from './locale/index.js';
import { shortTime } from './time.js';
import { isOwner as isOwnerOf } from './owned-run.js';
import { useViewerSession } from './viewer-session.js';
import { groupGenerationAnalyses } from './generation-analysis.js';
import { resultsTable } from './results-view.js';
import type { PackResults } from '../packs.js';

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
}

type Section = 'live' | 'generations' | 'evidence' | 'report' | 'reports';
const SECTIONS: readonly Section[] = ['live', 'generations', 'evidence', 'report'];

/** The views a Pack's contract asks for: with a Results table, its round selector replaces Rounds;
 *  with a tool-report folder, Reports (whose last entry is the Run report) replaces Report. */
export function sectionsFor(contract: { readonly results?: unknown; readonly reports?: unknown } | undefined): readonly Section[] {
  return SECTIONS
    .filter((key) => !(key === 'generations' && contract?.results !== undefined))
    .map((key) => (key === 'report' && contract?.reports !== undefined ? 'reports' : key));
}


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
/** The Results face's before/after table, for the Pack that declares one (`contract.results`): the
 *  headline figure, a round selector, and one row per declared value with one column per Reader. */
function ResultsSection({ results, view }: { results: PackResults; view: RunView }): ReactElement {
  const t = useHimaT();
  const [round, setRound] = useState<number>();
  const table = resultsTable(results, view, round);
  return (
    <section className="hima-results" data-hima-region="results-table" data-hima-state-round={String(table.round)}>
      {table.headline === undefined ? null : (
        <div className="hima-results-headline" data-hima-region="results-headline">
          <span className="hima-results-headline-value">{table.headline.display}</span>
          <span className="hima-muted">{table.headline.label} · {t('results.round', { n: table.round })}</span>
        </div>
      )}
      {table.rounds.length < 2 ? null : (
        <div className="hima-results-rounds" role="group" aria-label={t('results.rounds')}>
          {table.rounds.map((n) => (
            <button key={n} type="button" className="hima-button" aria-pressed={n === table.round} data-hima-control={`results-round-${String(n)}`} onClick={() => setRound(n)}>{t('results.round', { n })}</button>
          ))}
        </div>
      )}
      <table className="hima-results-table">
        <thead><tr><th scope="col">{t('results.measure')}</th>{table.columns.map((column) => <th key={column} scope="col">{column}</th>)}</tr></thead>
        <tbody>
          {table.rows.map((row) => (
            <tr key={row.type} data-hima-region={`results-row-${row.type}`}>
              <th scope="row">{row.label}{row.unit === undefined ? '' : ` (${row.unit})`}</th>
              {row.cells.map((cell, index) => (
                <td key={index} className={cell.better === true ? 'hima-results-better' : undefined}>
                  {cell.display}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** The raw observations: which file each Reader read and what it hashed to. */
function ObservationsSection({ view }: { view: RunView }): ReactElement | null {
  const t = useHimaT();
  if (view.observations.length === 0) return null;
  return (
    <section>
      <h3>{t('campaign.observations')}</h3>
      {view.observations.map((observation) => (
        <details key={observation.recordId}>
          <summary>{observation.path.split('/').at(-1)} · {t('campaign.summaryObservation')}</summary>
          <ObservationRow observation={observation} />
        </details>
      ))}
    </section>
  );
}

function EvidenceView({ view, results }: { view: RunView; results?: PackResults }): ReactElement {
  const t = useHimaT();
  const hasMaterial = view.code.length > 0 || view.knowledge.length > 0;
  const hasGrowth = view.generations.some((generation) => (generation.growths ?? []).length > 0);
  const empty = !hasMaterial && view.archive === undefined && view.workshop === undefined && !hasGrowth
    && (view.revisions ?? []).length === 0 && view.observations.length === 0 && view.verdicts.length === 0
    && (view.decision === null || view.decision === undefined) && view.blockers.length === 0
    && view.refusals.length === 0 && view.cancels.length === 0;
  if (empty) return <div className="hima-detail hima-evidence"><p>{t('campaign.noEvidence')}</p></div>;
  return (
    <div className="hima-detail hima-evidence">
      {/* A Pack that declares a results table leads with it; the raw readings it came from fold
          under it, closed. Without one, the observations stay where they always were. */}
      {results === undefined ? null : <>
        <ResultsSection results={results} view={view} />
        {view.observations.length === 0 ? null : (
          <details className="hima-results-sources" data-hima-region="results-sources">
            <summary>{t('results.sources')}</summary>
            <ObservationsSection view={view} />
          </details>
        )}
      </>}
      <MaterialSection view={view} />
      <ArchiveSection view={view} />
      {view.workshop === undefined ? null : <WorkshopSection view={view} workshop={view.workshop} />}
      <GrowthSection view={view} />
      <RevisionSection view={view} />
      {results === undefined ? <ObservationsSection view={view} /> : null}
      {view.verdicts.length === 0 ? null : (
        <section>
          <h3>{t('campaign.verdicts')}</h3>
          {view.verdicts.map((verdict) => (
            <details key={verdict.recordId} open={verdict.outcome !== 'PASS'}>
              <summary>{verdict.outcome} · {verdict.ruleId}@{verdict.ruleVersion}</summary>
              <VerdictRow verdict={verdict} />
            </details>
          ))}
        </section>
      )}
      {view.decision === null || view.decision === undefined ? null : (
        <details open><summary>{t('campaign.decision')}</summary><DecisionRow decision={view.decision} view={view} /></details>
      )}
      {view.blockers.map((blocker) => (
        <details key={blocker.recordId} open>
          <summary>{blocker.nodeId} · {t('campaign.summaryBlocker')}</summary>
          <p>{blocker.reason}</p>
          {blocker.logTail === undefined ? null : <pre>{blocker.logTail}</pre>}
        </details>
      ))}
      {view.refusals.map((refusal, index) => (
        <details key={index} open><summary>{t('campaign.refusedAccess')}</summary><p>{refusal.path}</p><p>{refusal.reason}</p></details>
      ))}
      {view.cancels.map((cancel) => (
        <details key={cancel.recordId}>
          <summary>{t('campaign.cancellation')}</summary>
          <p>{cancelAsked(cancel)}</p>
          <p>{cancelObserved(view, cancel).said}</p>
        </details>
      ))}
    </div>
  );
}

/** The Report view: the Campaign's technical report, as a current ledger preview or — on request —
 *  the saved file itself, read back and held to its recorded hash. */
function ReportView({ view, runId, openEvidence }: { view: RunView; runId: string; openEvidence(): void }): ReactElement {
  const t = useHimaT();
  const viewer = useViewerSession();
  const [saved, setSaved] = useState<{ markdown?: string; error?: string; loading?: boolean }>();
  const pending = useRef<AbortController>();
  useEffect(() => { setSaved(undefined); return () => pending.current?.abort(); }, [runId, viewer]);
  const openSaved = async () => {
    pending.current?.abort();
    const own = new AbortController(); pending.current = own;
    setSaved({ loading: true });
    try {
      // The JSON route (no `.md` suffix), never `experienceMarkdownPath` — that one answers with the
      // raw file itself (`media: 'text/markdown'`, `remote.ts`'s own `experienceOperation`), which is
      // what the anchor's own `href` is for, not this fetch.
      const response = await fetch(scoped(`${runPath(runId)}/experience`, viewer), { signal: own.signal, headers: { accept: 'application/json' } });
      const body = await response.json() as { markdown?: string; error?: { message?: string } };
      if (!response.ok || typeof body.markdown !== 'string') throw new Error(body.error?.message ?? `Report read failed (HTTP ${String(response.status)})`);
      if (!own.signal.aborted) setSaved({ markdown: body.markdown });
    } catch (error) { if (!own.signal.aborted) setSaved({ error: (error as Error).message }); }
  };
  return (
    <div className="hima-detail hima-report">
      <h3>{t('campaign.technicalReport')}</h3>
      <button type="button" className="hima-button" onClick={openEvidence}>{t('campaign.openDeliverables')}</button>
      <p className="hima-small">{t('campaign.reportNote')}</p>
      {saved ? (
        <>
          <button type="button" className="hima-button" onClick={() => { pending.current?.abort(); setSaved(undefined); }}>{t('campaign.currentLedgerPreview')}</button>
          <p className="hima-small">{saved.markdown !== undefined ? t('campaign.savedMarkdown') : saved.loading ? t('campaign.readingVerifying') : t('campaign.savedUnverified')}</p>
          {saved.loading ? <p>{t('campaign.readingSavedReport')}</p>
            : saved.error ? <p role="alert" className="hima-notice">{saved.error}</p>
              : reportBlocks(saved.markdown!).map((block, index) => <ReportBlockRow key={index} block={block} />)}
        </>
      ) : view.experience ? (
        <ExperienceSection view={view} experience={view.experience} onOpenSaved={() => { void openSaved(); }} />
      ) : (
        <p>{view.experienceUnavailable ?? t('campaign.reportWhenClosed')}</p>
      )}
    </div>
  );
}

function GenerationResearch({ view }: { readonly view: RunView }): ReactElement {
  const t = useHimaT();
  const groups = groupGenerationAnalyses(view.analyses ?? []);
  return <section className='hima-generation-research' data-hima-region='generation-research'>
    <h3>{t('campaign.researchFeedback')}</h3>
    {groups.length === 0 ? <p>{t('campaign.noResearch')}</p> : groups.map((group, groupIndex) => {
      const heading = group.generation === undefined ? t('campaign.unclassifiedResearch') : `${group.loopId === undefined ? '' : `Loop ${group.loopId} · `}Generation ${String(group.generation)}`;
      return <details key={group.generation === undefined ? 'unclassified' : `${group.loopId ?? 'outer'}:${String(group.generation)}`} data-hima-state-generation={group.generation === undefined ? 'unclassified' : String(group.generation)} open={groupIndex === groups.length - 1}>
        <summary>{heading} · {group.analyses.length} analysis record{group.analyses.length === 1 ? '' : 's'}</summary>
        {group.generation === undefined ? <p className='hima-memory-warning'>{t('campaign.noGenerationIdentity')}</p> : null}
        {group.analyses.map(analysis => <article key={analysis.recordId}>
          <header><strong>{analysis.question}</strong><span>{analysis.recordId}</span></header>
          {analysis.comparisons.map((comparison, index) => <p key={`comparison:${String(index)}`}>{t('campaign.comparisonCondition', { text: comparison })}</p>)}
          {analysis.hypotheses.map((hypothesis, index) => <p key={`hypothesis:${String(index)}`}>{t('campaign.hypothesis', { text: hypothesis })}</p>)}
          {analysis.claims.map((claim, index) => <div key={`claim:${String(index)}`}><p>{t('campaign.interpretation', { text: claim.text })}</p><p className='hima-small'>{t('campaign.evidenceReferences', { refs: claim.cites.join(', ') })}</p></div>)}
          {analysis.nextExperiments.map((experiment, index) => <p key={`next:${String(index)}`}>{t('campaign.nextExperiment', { text: experiment })}</p>)}
          {analysis.limitations.map((limitation, index) => <p className='hima-small' key={`limit:${String(index)}`}>{t('campaign.limitation', { text: limitation })}</p>)}
        </article>)}
      </details>;
    })}
  </section>;
}

export function CampaignTab({ sessionId, runId, view, context, acting, stale, readAt, name, openOwner, openFiles }: CampaignTabProps): ReactElement {
  const t = useHimaT();
  const [section, setSection] = useState<Section>('live');
  const [selectedNodeId, setSelectedNodeId] = useState<string>();
  const reducedMotion = useReducedMotion();
  const control = view?.run.control;
  const isOwner = isOwnerOf(control, sessionId);
  const methodReference = context?.method?.reference;

  // A historical automatic Run (`control === undefined`) carries no `context.method` at all
  // (`executionContext`, `fabric.ts` computes it only for an owned Run) — a genuine HimaFabric fact,
  // not a reason the canvas itself cannot draw: the Pack the Run started from is still installed on
  // this Host (starting one requires it), and `/hima/api/start-options` answers that same Pack's own
  // reference graph with no Site and no live conversation needed. Fetched once per (run, pack) pair
  // — never on every poll, and never for a Run whose own `context.method` already has one — and kept
  // until either changes, so a Pack that gets uninstalled mid-poll still shows the graph fetched
  // while it was there rather than blanking a running Campaign.
  //
  // C19: the *installed* Pack answers this fetch with whatever version is on disk right now, which
  // is not necessarily the version `run.packVersion` (the workspace's own preparation) actually ran
  // — a Pack edited or reinstalled since this Campaign started. Drawing a newer/older Pack's own
  // reference graph under an older Run's execution facts (node ids and edges a since-changed Pack
  // may no longer declare the same way) would show a graph that never actually described this Run's
  // own history, so the fetched result also carries the version it answered with, checked below
  // against `run.packVersion` before it is ever handed to `sceneInputs`.
  const [fallback, setFallback] = useState<{ readonly key: string; readonly graph: PreparationView['referenceGraph'] | 'unavailable'; readonly version?: string }>();
  const packId = view?.run.packId;
  const packVersion = view?.run.packVersion;
  // Computed once (review C16) and reused everywhere this pair's own identity is compared — the
  // fetch effect below, and the two reads after it — rather than three separately-typed template
  // literals (one of which read `packId` un-defaulted) that happened to agree only because `packId`
  // is checked non-`undefined` before either read is reached.
  const fallbackKey = `${runId}:${packId ?? ''}`;
  useEffect(() => {
    if (methodReference !== undefined || packId === undefined) return;
    if (fallback?.key === fallbackKey) return;
    let cancelled = false;
    const controller = new AbortController();
    void fetchStartChoices(packId, undefined, controller.signal).then((result) => {
      if (cancelled) return;
      const proposal = result.ok ? result.value.proposal : undefined;
      setFallback({ key: fallbackKey, graph: proposal?.referenceGraph ?? 'unavailable', version: proposal?.pack.version });
    });
    return () => { cancelled = true; controller.abort(); };
  }, [methodReference, packId, fallbackKey, fallback?.key]);
  const fetched = fallback?.key === fallbackKey ? fallback : undefined;
  const fetchedGraph = fetched !== undefined && fetched.graph !== 'unavailable' ? fetched.graph : undefined;
  const fetchedUnavailable = fetched !== undefined && fetched.graph === 'unavailable';
  // `packVersion` absent (a Run whose preparation predates this field, or one this workbench cannot
  // read) is treated as "nothing to check against" — the installed Pack's own graph is shown rather
  // than held back on a comparison this Run never recorded either side of.
  const versionMatches = fetchedGraph !== undefined && (packVersion === undefined || fetched?.version === undefined || fetched.version === packVersion);
  const fallbackGraph = versionMatches ? fetchedGraph : undefined;
  const reference = methodReference ?? fallbackGraph;
  const packUnavailable = methodReference === undefined && fetchedUnavailable;
  const packVersionMismatch = methodReference === undefined && fetchedGraph !== undefined && !versionMatches;

  // `sceneInputs`+`layoutCanvas` recompute only when the reference graph, the Run view or the
  // execution context actually change identity (a fresh poll) — not on every render this component
  // takes for a reason of its own (switching views, selecting a node, the masthead's own tick).
  // A Pack graph that declares a strip (`view`) is drawn as the strip instead of the full canvas;
  // the full graph and its contract come with the owned Run's execution context.
  const strip = context?.method?.reference.view === undefined ? undefined : context.method;
  const sections = sectionsFor(context?.method?.contract);
  const scene = useMemo(() => {
    if (reference === undefined || strip !== undefined) return undefined;
    const built = sceneInputs(reference, view, context);
    return layoutCanvas(built.graph, built.facts);
  }, [reference, view, context, strip]);

  useEffect(() => { setSelectedNodeId(undefined); }, [runId]);
  // A view the Pack's contract does not offer (its contract arrived after the first render) falls
  // back to the one that replaced it.
  useEffect(() => {
    if (sections.includes(section)) return;
    setSection(section === 'report' ? 'reports' : section === 'reports' ? 'report' : 'live');
  }, [sections.join(), section]);

  return (
    <div className="hima-campaign" data-hima-region="campaign" data-hima-state-run={runId}
      data-hima-state-status={view?.run.status ?? ''} data-hima-state-owner={isOwner ? 'owner' : 'side-talk'}>
      <Masthead name={name} view={view} context={context} stale={stale} reducedMotion={reducedMotion} isOwner={isOwner} ownerId={control?.owner} readAt={readAt} openOwner={openOwner} />
      <nav className="hima-campaign-views" aria-label={t('campaign.views')}>
        {sections.map((key) => (
          <button key={key} type="button" aria-pressed={section === key} data-hima-control={`studio-${key}`} onClick={() => setSection(key)}>{t(`campaign.section.${key}`)}</button>
        ))}
      </nav>
      <div className="hima-campaign-content">
        {section === 'live' && strip !== undefined ? (
          <StripCanvas graph={strip.reference} contract={strip.contract} view={view} context={context} stale={stale}
            reducedMotion={reducedMotion} isOwner={isOwner} openOwner={openOwner} acting={acting} />
        ) : section === 'live' ? (
          scene === undefined
            ? <div className="hima-empty">
                <p>{packUnavailable && packId !== undefined
                  ? t('campaign.packNotInstalled', { pack: packId })
                  : packVersionMismatch && packId !== undefined
                    ? t('campaign.packVersionMismatch', { installed: `${packId}${fetched?.version === undefined ? '' : `@${fetched.version}`}`, ran: packVersion === undefined ? '' : ` ${packVersion}` })
                    : context?.reason ?? t('campaign.readingReferenceGraph')}</p>
              </div>
            : <FabricCanvas runId={runId} scene={scene} entryNodeId={reference?.entry} view={view} context={context}
                stale={stale} reducedMotion={reducedMotion} isOwner={isOwner} selectedNodeId={selectedNodeId} onSelectNode={setSelectedNodeId}
                openOwner={openOwner} openFiles={openFiles} acting={acting} />
        ) : view === undefined
          ? <div className="hima-empty"><p>{t('campaign.readingRunRecords')}</p></div>
          : section === 'generations'
            ? <div className="hima-detail"><h3>{t('campaign.generationsHeading')}</h3>{view.generations.length ? <GenerationsTable view={view} /> : <p>{t('campaign.noGenerationOpened')}</p>}<GenerationResearch view={view}/></div>
            : section === 'evidence' ? <EvidenceView view={view} results={context?.method?.contract.results} />
              : section === 'reports' ? <ReportsView runId={runId} view={view} graph={context?.method?.reference} runReport={() => <ReportView view={view} runId={runId} openEvidence={() => setSection('evidence')} />} />
                : <ReportView view={view} runId={runId} openEvidence={() => setSection('evidence')} />}
      </div>
      {!stale ? null : (
        <div className="hima-campaign-stale" role="status" data-hima-region="campaign-stale" data-hima-state-at={readAt === undefined ? '' : String(readAt)}>
          Showing the last read at {readAt === undefined ? '—' : shortTime(readAt)}; the Host could not be reached.
        </div>
      )}
    </div>
  );
}
