import { useState, type ReactElement } from 'react';
import type { LibraryInsightReportView } from '../library-insight-report.js';
import { pageRows } from './generation-feedback-view.js';
import { filterLoadedLibraryFindings, libraryInsightIdentity, type LibraryInsightFilters } from './library-insight-view.js';

interface ViewState { readonly filters: LibraryInsightFilters; readonly page: number }
const rememberedViews = new Map<string, ViewState>();
const PAGE_SIZE = 25;

export function LibraryInsightPanel({ report, viewer, onReference, onChooseAnother }: { readonly report: LibraryInsightReportView; readonly viewer: string; readonly onReference: (text: string) => void; onChooseAnother(): void }): ReactElement {
  const reportIdentity = libraryInsightIdentity(report);
  const identity = JSON.stringify([viewer, reportIdentity.reportRef, reportIdentity.version, reportIdentity.recordId, reportIdentity.sha256]);
  const [local, setLocal] = useState<ViewState>(() => rememberedViews.get(identity) ?? { filters: {}, page: 0 });
  const remember = (next: ViewState) => {
    setLocal(next); rememberedViews.delete(identity); rememberedViews.set(identity, next);
    if (rememberedViews.size > 128) { const oldest = rememberedViews.keys().next().value; if (oldest !== undefined) rememberedViews.delete(oldest); }
  };
  const change = (key: keyof LibraryInsightFilters, value: string) => {
    remember({ filters: { ...local.filters, [key]: value || undefined }, page: 0 });
  };
  const findings = filterLoadedLibraryFindings(report, local.filters);
  const page = pageRows(findings, local.page, PAGE_SIZE);
  return <section className='hima-library-panel' data-hima-region='library-insight' data-hima-state-origin={report.evidenceClass}>
    <header><h2>Library Insight · retained report</h2><button type='button' className='hima-button' onClick={onChooseAnother}>Choose another report</button></header>
    <p role='note'>Evidence class: {report.evidenceClass}. This retained report is read-only; it is not a qualified design conclusion.</p>
    <dl className='hima-report-identity'><dt>Report</dt><dd>{report.reportRef}</dd><dt>Version</dt><dd>{report.version}</dd><dt>Source record</dt><dd>{report.source.recordId}</dd><dt>SHA-256</dt><dd>{report.source.sha256}</dd><dt>Created</dt><dd>{report.source.createdAt}</dd><dt>Analysis</dt><dd>{report.analysis}</dd><dt>Family</dt><dd>{report.conditions.family}</dd></dl>
    <div className='hima-team-actions'>
      <label>Corner <select data-hima-control='insight-corner' aria-label='Insight corner' value={local.filters.corner ?? ''} onChange={event => change('corner', event.target.value)}><option value=''>All loaded corners</option>{report.conditions.corners.map(item => <option key={item}>{item}</option>)}</select></label>
      <label>View <select data-hima-control='insight-view' aria-label='Insight view' value={local.filters.view ?? ''} onChange={event => change('view', event.target.value)}><option value=''>All loaded views</option>{report.conditions.views.map(item => <option key={item}>{item}</option>)}</select></label>
      <label>Library severity <select data-hima-control='insight-severity' aria-label='Insight severity' value={local.filters.severity ?? ''} onChange={event => change('severity', event.target.value)}><option value=''>All severities</option>{['critical', 'warning', 'info'].map(item => <option key={item}>{item}</option>)}</select></label>
    </div>
    <p>{findings.length} of {report.findings.length} loaded findings. Filters only slice this retained payload: they do not run models or tools, recalculate values, or change report conditions.</p>
    {report.conditions.load ? <p>Loaded load: {report.conditions.load.min}–{report.conditions.load.max} {report.conditions.load.unit}</p> : null}
    {report.conditions.slew ? <p>Loaded slew: {report.conditions.slew.min}–{report.conditions.slew.max} {report.conditions.slew.unit}</p> : null}
    {report.conditions.unknowns.map(reason => <p key={reason} className='hima-muted'>Condition unknown: {reason}</p>)}
    <p className='hima-small'>A new calculation is not available from this view. It must use a controlled Run and publish a distinct report, version, source record, and SHA-256; this report will not be overwritten.</p>
    {page.rows.map(finding => <article className='hima-memory-panel' key={finding.id}>
      <h3>{finding.title}</h3><p>Library: {finding.librarySeverity} · Design relevance: {finding.designRelevance} · {finding.corner}/{finding.view}</p>
      <p>Ranking basis: {finding.rankingReason}</p>
      <ul>{finding.values.map(value => <li key={value.name}>{value.name}: {value.value === null ? `Unknown — ${value.missingReason}` : `${value.value} ${value.unit ?? 'unit not provided'}`}</li>)}</ul>
      <ul>{finding.provenance.map((source, index) => <li key={index}>Provenance {index + 1}: {source.status}; source {source.recordId ?? source.sourceRef ?? 'not recorded'}; SHA-256 {source.sha256 ?? 'not recorded'}{source.reason === undefined ? '' : `; ${source.reason}`}</li>)}</ul>
      {finding.unknowns.map(reason => <p className='hima-muted' key={reason}>Finding unknown: {reason}</p>)}
      <button type='button' data-hima-control={`insight-finding-${finding.id}`} className='hima-button' onClick={() => onReference(`Inspect ${report.evidenceClass} finding ${finding.id} in report ${report.reportRef}, version ${report.version}, SHA-256 ${report.source.sha256}. Keep its stated conditions and unknowns; this is not a qualified design conclusion.`)}>Add finding reference to draft</button>
    </article>)}
    {page.pages <= 1 ? null : <div className='hima-team-actions'><button type='button' className='hima-button' disabled={page.page === 0} onClick={() => remember({ ...local, page: page.page - 1 })}>Previous findings</button><span>Page {page.page + 1} of {page.pages}</span><button type='button' className='hima-button' disabled={page.page + 1 >= page.pages} onClick={() => remember({ ...local, page: page.page + 1 })}>Next findings</button></div>}
    <details><summary>Producer summary</summary><p>Best: {report.summary.best.join(', ') || 'No best finding declared.'}</p><p>Unresolved: {report.summary.unresolved.join(', ') || 'No unresolved finding declared.'}</p>{report.summary.nextActions.map((action, index) => <p key={index}>{action.text} · {action.findingIds.join(', ')}</p>)}</details>
  </section>;
}
