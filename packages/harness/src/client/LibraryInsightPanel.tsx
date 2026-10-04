import { useState, type ReactElement } from 'react';
import type { LibraryInsightReportView } from '../library-insight-report.js';
import { pageRows } from './generation-feedback-view.js';
import { filterLoadedLibraryFindings, libraryInsightIdentity, type LibraryInsightFilters } from './library-insight-view.js';
import { useHimaT } from './locale/index.js';

interface ViewState { readonly filters: LibraryInsightFilters; readonly page: number }
const rememberedViews = new Map<string, ViewState>();
const PAGE_SIZE = 25;

export function LibraryInsightPanel({ report, viewer, onReference, onChooseAnother }: { readonly report: LibraryInsightReportView; readonly viewer: string; readonly onReference: (text: string) => void; onChooseAnother(): void }): ReactElement {
  // The panel's chrome and labels are localized; report data (titles, values, corners, record ids,
  // ranking text, evidence class) is never translated and is interpolated as-is, and the draft
  // `onReference` writes stays English because it is read by the model, not the person.
  const t = useHimaT();
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
    <header><h2>{t('insight.panel.heading')}</h2><button type='button' className='hima-button' onClick={onChooseAnother}>{t('insight.panel.chooseAnother')}</button></header>
    <p role='note'>{t('insight.panel.evidenceNote', { evidenceClass: report.evidenceClass })}</p>
    <dl className='hima-report-identity'><dt>{t('insight.panel.id.report')}</dt><dd>{report.reportRef}</dd><dt>{t('insight.panel.id.version')}</dt><dd>{report.version}</dd><dt>{t('insight.panel.id.sourceRecord')}</dt><dd>{report.source.recordId}</dd><dt>{t('insight.panel.id.sha')}</dt><dd>{report.source.sha256}</dd><dt>{t('insight.panel.id.created')}</dt><dd>{report.source.createdAt}</dd><dt>{t('insight.panel.id.analysis')}</dt><dd>{report.analysis}</dd><dt>{t('insight.panel.id.family')}</dt><dd>{report.conditions.family}</dd></dl>
    <div className='hima-team-actions'>
      <label>{t('insight.panel.corner')} <select data-hima-control='insight-corner' aria-label={t('insight.panel.cornerAria')} value={local.filters.corner ?? ''} onChange={event => change('corner', event.target.value)}><option value=''>{t('insight.panel.allCorners')}</option>{report.conditions.corners.map(item => <option key={item}>{item}</option>)}</select></label>
      <label>{t('insight.panel.view')} <select data-hima-control='insight-view' aria-label={t('insight.panel.viewAria')} value={local.filters.view ?? ''} onChange={event => change('view', event.target.value)}><option value=''>{t('insight.panel.allViews')}</option>{report.conditions.views.map(item => <option key={item}>{item}</option>)}</select></label>
      <label>{t('insight.panel.severity')} <select data-hima-control='insight-severity' aria-label={t('insight.panel.severityAria')} value={local.filters.severity ?? ''} onChange={event => change('severity', event.target.value)}><option value=''>{t('insight.panel.allSeverities')}</option>{['critical', 'warning', 'info'].map(item => <option key={item}>{item}</option>)}</select></label>
    </div>
    <p>{t('insight.panel.findingCount', { n: findings.length, m: report.findings.length })}</p>
    {report.conditions.load ? <p>{t('insight.panel.loadedLoad', { min: report.conditions.load.min, max: report.conditions.load.max, unit: report.conditions.load.unit })}</p> : null}
    {report.conditions.slew ? <p>{t('insight.panel.loadedSlew', { min: report.conditions.slew.min, max: report.conditions.slew.max, unit: report.conditions.slew.unit })}</p> : null}
    {report.conditions.unknowns.map(reason => <p key={reason} className='hima-muted'>{t('insight.panel.conditionUnknown', { reason })}</p>)}
    <p className='hima-small'>{t('insight.panel.newCalc')}</p>
    {page.rows.map(finding => <article className='hima-memory-panel' key={finding.id}>
      <h3>{finding.title}</h3><p>{t('insight.panel.findingLine', { severity: finding.librarySeverity, relevance: finding.designRelevance, corner: finding.corner, view: finding.view })}</p>
      <p>{t('insight.panel.rankingBasis', { reason: finding.rankingReason })}</p>
      <ul>{finding.values.map(value => <li key={value.name}>{value.name}: {value.value === null ? t('insight.panel.valueUnknown', { reason: value.missingReason ?? '' }) : `${value.value} ${value.unit ?? t('insight.panel.unitMissing')}`}</li>)}</ul>
      <ul>{finding.provenance.map((source, index) => <li key={index}>{t('insight.panel.provenance', { index: index + 1, status: source.status, source: source.recordId ?? source.sourceRef ?? t('insight.panel.notRecorded'), sha: source.sha256 ?? t('insight.panel.notRecorded') })}{source.reason === undefined ? '' : `; ${source.reason}`}</li>)}</ul>
      {finding.unknowns.map(reason => <p className='hima-muted' key={reason}>{t('insight.panel.findingUnknown', { reason })}</p>)}
      <button type='button' data-hima-control={`insight-finding-${finding.id}`} className='hima-button' onClick={() => onReference(`Inspect ${report.evidenceClass} finding ${finding.id} in report ${report.reportRef}, version ${report.version}, SHA-256 ${report.source.sha256}. Keep its stated conditions and unknowns; this is not a qualified design conclusion.`)}>{t('insight.panel.addReference')}</button>
    </article>)}
    {page.pages <= 1 ? null : <div className='hima-team-actions'><button type='button' className='hima-button' disabled={page.page === 0} onClick={() => remember({ ...local, page: page.page - 1 })}>{t('insight.panel.prevFindings')}</button><span>{t('insight.panel.page', { page: page.page + 1, pages: page.pages })}</span><button type='button' className='hima-button' disabled={page.page + 1 >= page.pages} onClick={() => remember({ ...local, page: page.page + 1 })}>{t('insight.panel.nextFindings')}</button></div>}
    <details><summary>{t('insight.panel.producerSummary')}</summary><p>{t('insight.panel.best', { items: report.summary.best.join(', ') || t('insight.panel.noBest') })}</p><p>{t('insight.panel.unresolved', { items: report.summary.unresolved.join(', ') || t('insight.panel.noUnresolved') })}</p>{report.summary.nextActions.map((action, index) => <p key={index}>{action.text} · {action.findingIds.join(', ')}</p>)}</details>
  </section>;
}
