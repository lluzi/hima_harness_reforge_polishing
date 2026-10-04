import { useCallback, useEffect, useState, type FormEvent, type ReactElement } from 'react';
import type { ReadExperienceResult } from '../experience.js';
import { reportBlocks } from '../experience-report.js';
import { fetchCampaignFile, fetchGuideContext, fetchRun, fetchSites, fetchStartChoices, resolveReportAddress, saveCampaignFile, startCampaign } from './api.js';
import type { SiteHeadView } from '../remote.js';
import { duration } from '../card-labels.js';
import type { LibraryInsightReportView } from '../library-insight-report.js';
import { LibraryInsightPanel } from './LibraryInsightPanel.js';
import { ReportBlockRow } from './HimaRunCard.js';
import { GenerationFeedbackPanel } from './GenerationFeedbackPanel.js';
import { readGenerationFeedbackView, type GenerationFeedbackReportView } from './generation-feedback-view.js';
import { readLibraryInsightView } from './library-insight-view.js';
import { useHimaT, labelKeyed } from './locale/index.js';
import {
  ANALYSIS_TIME_BOX_MINUTES, analysisCampaignFile, analysisOutcome, defaultLibraryFolder,
  discoverLibraryAnalysisPacks, goalDefaults, libraryKitKnob, LIBRARY_KIT_KNOB,
  type PackChoicesEntry,
} from './library-analysis.js';
import type { StartChoices } from '../workbench.js';

type RetainedReport = Extract<ReadExperienceResult, { readonly kind: 'read' }>;

function retainedReport(value: unknown): value is RetainedReport {
  if (value === null || typeof value !== 'object' || !('kind' in value) || value.kind !== 'read') return false;
  return 'markdown' in value && typeof value.markdown === 'string' && 'json' in value && value.json !== null && typeof value.json === 'object'
    && 'record' in value && value.record !== null && typeof value.record === 'object';
}

function reportFailure(value: unknown): string {
  if (value === null || typeof value !== 'object' || !('kind' in value) || typeof value.kind !== 'string') return 'The Host did not return a retained Experience report.';
  if ('why' in value && typeof value.why === 'string') return value.why;
  if ('path' in value && typeof value.path === 'string') return `The retained report bytes at ${value.path} are ${value.kind}.`;
  return `The retained report is ${value.kind}.`;
}

export interface AvailableInsightReport { readonly reportRef: string; readonly label: string; readonly detail: string }

export function InsightView({ sessionId, scope, reportRef, availableReports, onReference, onSelectReportRef, pickFolder, openRun }: { readonly sessionId: string; readonly scope?: string; readonly reportRef?: string; readonly availableReports: readonly AvailableInsightReport[]; readonly onReference:(text:string)=>void; onSelectReportRef(reportRef?: string): void; readonly pickFolder?: () => Promise<string | null>; openRun(runId: string): void }): ReactElement {
  const [library, setLibrary] = useState<LibraryInsightReportView>();
  const [feedback, setFeedback] = useState<GenerationFeedbackReportView>();
  const [report, setReport] = useState<RetainedReport>();
  const [identity, setIdentity] = useState<{ readonly version: string; readonly sha256: string }>();
  const [failure, setFailure] = useState<string>();
  const [loading, setLoading] = useState(reportRef !== undefined);
  useEffect(() => {
    setLibrary(undefined); setFeedback(undefined); setReport(undefined); setIdentity(undefined); setFailure(undefined); setLoading(reportRef !== undefined);
    if (reportRef === undefined) return;
    const controller = new AbortController();
    void resolveReportAddress({ sessionId, reportRef }, controller.signal).then(async address => {
      if (controller.signal.aborted) return;
      if (!address.ok) { setLoading(false); setFailure(address.error.message); return; }
      const context = await fetchGuideContext({ sessionId, requestId: `report-${crypto.randomUUID()}`, target: address.value }, controller.signal);
      if (controller.signal.aborted) return;
      setLoading(false);
      if (!context.ok) { setFailure(context.error.message); return; }
      if (context.value.target.kind !== 'report' || context.value.target.reportRef !== reportRef) { setFailure('The Host returned a different retained report identity.'); return; }
      const typed=readLibraryInsightView(context.value.facts);
      if(typed){if(typed.reportRef!==reportRef||typed.source.sha256!==address.value.sha256||typed.version!==address.value.version){setFailure('Library report source identity differs from the requested bytes.');return;}setLibrary(typed);return;}
      const generationFeedback = readGenerationFeedbackView(context.value.facts);
      if (generationFeedback) {
        if (generationFeedback.reportRef !== reportRef || generationFeedback.source.sha256 !== address.value.sha256 || generationFeedback.version !== address.value.version) { setFailure('Generation feedback source identity differs from the requested bytes.'); return; }
        setFeedback(generationFeedback); return;
      }
      if (!retainedReport(context.value.facts)) { setFailure(context.value.missing.join(' ') || reportFailure(context.value.facts)); return; }
      setIdentity({ version: address.value.version, sha256: address.value.sha256 }); setReport(context.value.facts);
    });
    return () => controller.abort();
  }, [reportRef, sessionId]);

  if(library)return <LibraryInsightPanel key={`${sessionId}:${library.reportRef}:${library.source.sha256}`} report={library} viewer={sessionId} onReference={onReference} onChooseAnother={() => onSelectReportRef()}/>;
  if(feedback)return <GenerationFeedbackPanel key={`${sessionId}:${feedback.reportRef}:${feedback.source.sha256}`} view={feedback} viewer={sessionId} onReference={onReference} onChooseAnother={() => onSelectReportRef()}/>;
  if (reportRef === undefined) return <ReportPreparation sessionId={sessionId} scope={scope} availableReports={availableReports} onSelect={onSelectReportRef} pickFolder={pickFolder} openRun={openRun}/>;
  return <section className='hima-insight-report' data-hima-region='insight-report' data-hima-state-report={reportRef}>
    <header><div><span className='hima-studio-eyebrow'>RETAINED INSIGHT</span><h2>Campaign Experience report</h2></div><button type='button' className='hima-button' onClick={() => onSelectReportRef()}>Choose another report</button></header>
    {loading ? <p>Resolving and verifying the retained report bytes…</p> : failure ? <p role='alert'>Verified report unavailable: {failure}</p> : report && identity ? <>
      <p>This view renders the verified saved Experience report. It does not claim native Liberty analysis.</p>
      <dl className='hima-report-identity'><dt>Report record</dt><dd>{report.record.id}</dd><dt>Run</dt><dd>{report.json.runId}</dd><dt>Schema</dt><dd>{report.json.schema}</dd><dt>Version</dt><dd>{identity.version}</dd><dt>SHA-256</dt><dd>{identity.sha256}</dd></dl>
      <div className='hima-detail hima-report'>{reportBlocks(report.markdown).map((block, index) => <ReportBlockRow key={index} block={block}/>)}</div>
    </> : null}
    {scope === undefined ? null : <p className='hima-small'>View scope: {scope}</p>}
  </section>;
}

const rememberedReportRefs = new Map<string, string>();
function ReportPreparation({ sessionId, scope, availableReports, onSelect, pickFolder, openRun }: { readonly sessionId: string; readonly scope?: string; readonly availableReports: readonly AvailableInsightReport[]; onSelect(reportRef: string): void; readonly pickFolder?: () => Promise<string | null>; openRun(runId: string): void }): ReactElement {
  const t = useHimaT();
  const [draft, setDraft] = useState(() => rememberedReportRefs.get(sessionId) ?? '');
  const change = (value: string) => { setDraft(value); rememberedReportRefs.delete(sessionId); rememberedReportRefs.set(sessionId, value); if (rememberedReportRefs.size > 64) { const oldest = rememberedReportRefs.keys().next().value; if (oldest !== undefined) rememberedReportRefs.delete(oldest); } };
  const submit = (event: FormEvent) => { event.preventDefault(); const reportRef = draft.trim(); if (reportRef !== '') onSelect(reportRef); };
  return <section className='hima-insight-preparation' data-hima-region='insight-preparation'>
    <span className='hima-studio-eyebrow'>DATA INSIGHT</span><h2>{t('insight.prep.heading')}</h2><p>{t('insight.prep.intro')}</p>
    <LibraryAnalysisSection sessionId={sessionId} pickFolder={pickFolder} openRun={openRun} onAnalysed={onSelect} />
    {availableReports.length === 0 ? <p className='hima-small'>{t('insight.prep.noCandidate')}</p> : <label>{t('insight.prep.candidates')}<select data-hima-control='insight-report-candidate' value={availableReports.some(option => option.reportRef === draft) ? draft : ''} onChange={event => change(event.target.value)}><option value=''>{t('insight.prep.chooseCandidate')}</option>{availableReports.map(option => <option value={option.reportRef} key={option.reportRef}>{option.label}</option>)}</select></label>}
    {availableReports.map(option => option.reportRef === draft ? <p className='hima-small' key={option.reportRef}>{option.detail}</p> : null)}
    <form className='hima-report-selector' onSubmit={submit}><label>{t('insight.prep.exactRef')}<input data-hima-control='insight-report-ref' value={draft} onChange={event => change(event.target.value)} placeholder={t('insight.prep.recordIdentity')}/></label><button type='submit' className='hima-button' data-hima-control='insight-open-report' disabled={draft.trim() === ''}>{t('insight.prep.openReport')}</button></form>
    <p className='hima-small'>{t('insight.prep.candidatesNote')}</p>{scope === undefined ? null : <p className='hima-small'>Requested scope: {scope}</p>}
  </section>;
}

/** How a started analysis Run is tracked inside the tab: idle before one is asked for, starting while
 *  its Campaign file is written and confirmed, running while HimaFabric drives it, failed with a
 *  reason and the Run to open when it ends with no report or blocks. A finished Run with its report
 *  present never lands here — it opens the report and leaves this section. */
type AnalysisPhase =
  | { readonly phase: 'idle' }
  | { readonly phase: 'starting' }
  | { readonly phase: 'running'; readonly runId: string }
  | { readonly phase: 'failed'; readonly reason: string; readonly runId?: string };

/**
 * The "Analyse a library folder" section of the QuaLib Insight preparation view (when no report is
 * open). It discovers the installed library-analysis Packs (those declaring the library-root input),
 * offers a folder and a library kit, and starts a controlled, recorded Run from them — through the
 * same Host path the Configuration page confirms a Campaign from (a Campaign file, its proposal, and
 * `startCampaign({ fromCampaignFile })`) — then shows a compact progress line and opens the Run's own
 * verified library report in this tab when it finishes. The person's own `hima/campaign.yml` draft is
 * read, saved aside and restored around the start, never clobbered (`library-analysis.ts`).
 */
function LibraryAnalysisSection({ sessionId, pickFolder, openRun, onAnalysed }: { readonly sessionId: string; readonly pickFolder?: () => Promise<string | null>; openRun(runId: string): void; onAnalysed(reportRef: string): void }): ReactElement | null {
  const t = useHimaT();
  const [packs, setPacks] = useState<readonly PackChoicesEntry[]>();
  const [sites, setSites] = useState<readonly SiteHeadView[]>([]);
  const [packId, setPackId] = useState('');
  const [siteName, setSiteName] = useState('');
  const [active, setActive] = useState<StartChoices>();
  const [folder, setFolder] = useState('');
  const [folderTouched, setFolderTouched] = useState(false);
  const [kit, setKit] = useState('');
  const [run, setRun] = useState<AnalysisPhase>({ phase: 'idle' });
  const [runElapsed, setRunElapsed] = useState<{ readonly node?: string; readonly elapsedMs?: number }>();
  const [notice, setNotice] = useState<string>();

  const statusLabel = useCallback((status: string) => labelKeyed(t, `status.${status}`, status), [t]);

  // Discover the installed library-analysis Packs and the Sites once, by asking the Host what it has
  // and, per Pack, what it declares — no Pack id is named here (`discoverLibraryAnalysisPacks`).
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      const [choices, siteList] = await Promise.all([fetchStartChoices(undefined, undefined, controller.signal), fetchSites(controller.signal)]);
      if (controller.signal.aborted || !choices.ok) { if (!controller.signal.aborted && !choices.ok) setNotice(choices.error.message); return; }
      const entries = await Promise.all(choices.value.packs.map(async (id): Promise<PackChoicesEntry | undefined> => {
        const per = await fetchStartChoices(id, undefined, controller.signal);
        return per.ok ? { packId: id, choices: per.value } : undefined;
      }));
      if (controller.signal.aborted) return;
      const found = discoverLibraryAnalysisPacks(entries.filter((entry): entry is PackChoicesEntry => entry !== undefined));
      setPacks(found);
      if (siteList.ok) setSites(siteList.value.sites);
      setPackId((current) => current !== '' ? current : found[0]?.packId ?? '');
      const preferred = siteList.ok ? (siteList.value.sites.find((site) => site.readiness === 'ready') ?? siteList.value.sites[0]) : undefined;
      setSiteName((current) => current !== '' ? current : preferred?.name ?? '');
    })();
    return () => controller.abort();
  }, [sessionId]);

  // The preparation for the selected Pack and Site, which carries the library-root binding the folder
  // defaults to, the kit knob's own options, and the Pack's Goal defaults.
  useEffect(() => {
    if (packId === '' || siteName === '') { setActive(undefined); return; }
    const controller = new AbortController();
    void fetchStartChoices(packId, siteName, controller.signal).then((result) => {
      if (controller.signal.aborted || !result.ok) return;
      setActive(result.value);
      const defaultFolder = defaultLibraryFolder(result.value);
      setFolder((current) => folderTouched ? current : defaultFolder);
      const kitInfo = libraryKitKnob(result.value);
      if (kitInfo !== undefined) setKit((current) => kitInfo.knob.options.includes(current) ? current : kitInfo.knob.default);
    });
    return () => controller.abort();
    // `folderTouched` is read, not depended on: a later Pack/Site change still refreshes the default,
    // and once the person edits the folder their value stands until they change Pack or Site again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packId, siteName]);

  // Poll the started Run, show where it stands, and open its library report the moment it finishes
  // with one; a Run that ends with no report or blocks becomes a failed line with a link to open it.
  useEffect(() => {
    if (run.phase !== 'running') return;
    const runId = run.runId;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      const result = await fetchRun(runId, controller.signal, sessionId);
      if (controller.signal.aborted) return;
      if (result.ok) {
        setRunElapsed({ node: result.value.run.currentNode, elapsedMs: result.value.run.meters?.elapsedMs });
        const outcome = analysisOutcome(result.value, statusLabel, result.value.blockers.at(-1)?.reason);
        if (outcome.kind === 'report') { onAnalysed(outcome.reportRef); return; }
        if (outcome.kind === 'failed') { setRun({ phase: 'failed', reason: outcome.reason, runId }); return; }
      }
      timer = setTimeout(() => { void poll(); }, 2000);
    };
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [run, sessionId, statusLabel, onAnalysed]);

  const kitInfo = libraryKitKnob(active);

  /** Start the analysis: save the person's draft aside, write and confirm a derived Campaign file,
   *  then restore their draft. Nothing here overwrites `hima/campaign.yml` without putting it back. */
  const analyse = async () => {
    const trimmed = folder.trim();
    if (packId === '' || siteName === '' || trimmed === '') { setNotice(t('insight.analyse.needFolder')); return; }
    setNotice(undefined); setRun({ phase: 'starting' }); setRunElapsed(undefined);
    const existing = await fetchCampaignFile(sessionId);
    if (!existing.ok) { setRun({ phase: 'failed', reason: existing.error.message }); return; }
    const original = existing.value.file;
    const restore = () => saveCampaignFile(sessionId, original);
    const derived = analysisCampaignFile({
      packId, siteName, folder: trimmed, kitKnob: kitInfo?.name ?? LIBRARY_KIT_KNOB, kit,
      goal: goalDefaults(active), timeBoxMinutes: ANALYSIS_TIME_BOX_MINUTES,
    });
    const saved = await saveCampaignFile(sessionId, derived, existing.value.mtimeMs);
    // A conflict means the file changed since this read and the derived file was never written, so
    // there is nothing of the person's to restore — report and stop.
    if (!saved.ok) { setRun({ phase: 'failed', reason: saved.error.message }); return; }
    const prepared = await fetchCampaignFile(sessionId);
    const proposal = prepared.ok ? prepared.value.preparation?.proposal : undefined;
    if (!prepared.ok || proposal === undefined || proposal.ready !== true) {
      await restore();
      const reason = prepared.ok ? (proposal?.unknowns.join(' ') || t('insight.analyse.notReady', { reason: '' })) : prepared.error.message;
      setRun({ phase: 'failed', reason: t('insight.analyse.notReady', { reason }) }); return;
    }
    const started = await startCampaign({ fromCampaignFile: true, sessionId, pack: packId, site: siteName, proposalId: proposal.id });
    await restore();
    if (!started.ok) { setRun({ phase: 'failed', reason: started.error.message }); return; }
    setRun({ phase: 'running', runId: started.value.run.id });
  };

  const choose = async () => {
    if (!pickFolder) return;
    const picked = await pickFolder().catch(() => null);
    if (picked !== null) { setFolder(picked); setFolderTouched(true); }
  };

  if (packs === undefined) return null;
  const busy = run.phase === 'starting' || run.phase === 'running';
  return <section className='hima-insight-analyse' data-hima-region='insight-analyse'>
    <span className='hima-studio-eyebrow'>{t('insight.analyse.heading')}</span>
    <p className='hima-small'>{t('insight.analyse.intro')}</p>
    {packs.length === 0 ? <p className='hima-small' data-hima-region='insight-analyse-none'>{t('insight.analyse.noPack')}</p> : <>
      {packs.length > 1 ? <label>{t('config.eyebrow.pack')}<select data-hima-control='insight-analyse-pack' value={packId} disabled={busy} onChange={(event) => setPackId(event.target.value)}>{packs.map((entry) => <option key={entry.packId} value={entry.packId}>{entry.packId}</option>)}</select></label> : null}
      <label>{t('insight.analyse.site')}<select data-hima-control='insight-analyse-site' value={siteName} disabled={busy} onChange={(event) => setSiteName(event.target.value)}>
        <option value=''>{t('config.chooseSite')}</option>
        {sites.map((site) => <option key={site.name} value={site.name}>{site.name} — {site.kind}{site.readiness !== 'ready' ? ` (${site.readiness})` : ''}</option>)}
      </select></label>
      <label>{t('insight.analyse.folder')}<input data-hima-control='insight-analyse-folder' value={folder} disabled={busy} placeholder={t('insight.analyse.folderPlaceholder')} onChange={(event) => { setFolder(event.target.value); setFolderTouched(true); }} /></label>
      {pickFolder ? <button type='button' className='hima-button' data-hima-control='insight-analyse-pick' disabled={busy} onClick={() => { void choose(); }}>{t('insight.analyse.pick')}</button> : null}
      {kitInfo ? <label>{t('insight.analyse.kit')}<select data-hima-control='insight-analyse-kit' value={kit} disabled={busy} onChange={(event) => setKit(event.target.value)}>{kitInfo.knob.options.map((option) => <option key={option} value={option}>{option}</option>)}</select></label> : null}
      <button type='button' className='hima-button hima-primary' data-hima-control='insight-analyse-start' disabled={busy || folder.trim() === '' || siteName === ''} onClick={() => { void analyse(); }}>{run.phase === 'starting' ? t('insight.analyse.starting') : t('insight.analyse.analyse')}</button>
      {run.phase === 'running' ? <p className='hima-small' role='status' data-hima-region='insight-analyse-progress'>{t('insight.analyse.running')} · {runElapsed?.node ?? '…'} · {duration(runElapsed?.elapsedMs ?? 0)}</p> : null}
      {run.phase === 'failed' ? <div className='hima-config-readiness-row' role='alert' data-hima-region='insight-analyse-failed'><span>{t('insight.analyse.failed', { reason: run.reason })}</span>{run.runId ? <button type='button' className='hima-button' data-hima-control='insight-analyse-open-run' onClick={() => openRun(run.runId!)}>{t('insight.analyse.openRun')}</button> : null}</div> : null}
      {notice ? <p className='hima-notice' role='alert'>{notice}</p> : null}
    </>}
  </section>;
}
