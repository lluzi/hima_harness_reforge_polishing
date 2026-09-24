import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import type { ReadExperienceResult } from '../experience.js';
import { reportBlocks } from '../experience-report.js';
import { fetchGuideContext, resolveReportAddress } from './api.js';
import type { LibraryInsightReportView } from '../library-insight-report.js';
import { LibraryInsightPanel } from './LibraryInsightPanel.js';
import { ReportBlockRow } from './HimaRunCard.js';
import { GenerationFeedbackPanel } from './GenerationFeedbackPanel.js';
import { readGenerationFeedbackView, type GenerationFeedbackReportView } from './generation-feedback-view.js';
import { readLibraryInsightView } from './library-insight-view.js';

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

export function InsightView({ sessionId, scope, reportRef, availableReports, onReference, onSelectReportRef }: { readonly sessionId: string; readonly scope?: string; readonly reportRef?: string; readonly availableReports: readonly AvailableInsightReport[]; readonly onReference:(text:string)=>void; onSelectReportRef(reportRef?: string): void }): ReactElement {
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
  if (reportRef === undefined) return <ReportPreparation sessionId={sessionId} scope={scope} availableReports={availableReports} onSelect={onSelectReportRef}/>;
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
function ReportPreparation({ sessionId, scope, availableReports, onSelect }: { readonly sessionId: string; readonly scope?: string; readonly availableReports: readonly AvailableInsightReport[]; onSelect(reportRef: string): void }): ReactElement {
  const [draft, setDraft] = useState(() => rememberedReportRefs.get(sessionId) ?? '');
  const change = (value: string) => { setDraft(value); rememberedReportRefs.delete(sessionId); rememberedReportRefs.set(sessionId, value); if (rememberedReportRefs.size > 64) { const oldest = rememberedReportRefs.keys().next().value; if (oldest !== undefined) rememberedReportRefs.delete(oldest); } };
  const submit = (event: FormEvent) => { event.preventDefault(); const reportRef = draft.trim(); if (reportRef !== '') onSelect(reportRef); };
  return <section className='hima-insight-preparation' data-hima-region='insight-preparation'>
    <span className='hima-studio-eyebrow'>DATA INSIGHT</span><h2>Choose retained data to inspect</h2><p>Opening a retained report creates no Campaign, Job, analysis, or model call. The Host validates the selected record and supported schema.</p>
    {availableReports.length === 0 ? <p className='hima-small'>No retained report candidate is visible from the last Campaign view. Paste an exact record reference below.</p> : <label>Visible retained candidates<select data-hima-control='insight-report-candidate' value={availableReports.some(option => option.reportRef === draft) ? draft : ''} onChange={event => change(event.target.value)}><option value=''>Choose a visible candidate…</option>{availableReports.map(option => <option value={option.reportRef} key={option.reportRef}>{option.label}</option>)}</select></label>}
    {availableReports.map(option => option.reportRef === draft ? <p className='hima-small' key={option.reportRef}>{option.detail}</p> : null)}
    <form className='hima-report-selector' onSubmit={submit}><label>Exact report or observation reference<input data-hima-control='insight-report-ref' value={draft} onChange={event => change(event.target.value)} placeholder='record identity'/></label><button type='submit' className='hima-button' data-hima-control='insight-open-report' disabled={draft.trim() === ''}>Open verified report</button></form>
    <p className='hima-small'>Visible observations are candidates only. Their reader label does not claim the bytes are a supported feedback report.</p>{scope === undefined ? null : <p className='hima-small'>Requested scope: {scope}</p>}
  </section>;
}
