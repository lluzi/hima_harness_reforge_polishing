import { useState, type ReactElement } from 'react';
import type { GenerationFeedbackCategory, GenerationFeedbackReport } from '../generation-feedback-report.js';
import { pageRows, technicalFieldLines, type GenerationFeedbackReportView } from './generation-feedback-view.js';

const CATEGORY_LABELS: Readonly<Record<GenerationFeedbackCategory, string>> = {
  fixed: 'Fixed', remaining: 'Remaining', entrant: 'Entrant', regressed: 'Regressed', missing: 'Missing',
};
const PAGE_SIZE = 24;
interface ViewState { readonly category: GenerationFeedbackCategory; readonly page: number }
const rememberedViews = new Map<string, ViewState>();

export function GenerationFeedbackPanel({ view, viewer, onReference, onChooseAnother }: { readonly view: GenerationFeedbackReportView; readonly viewer: string; onReference(text: string): void; onChooseAnother(): void }): ReactElement {
  const identity = `${viewer}:${view.reportRef}:${view.source.sha256}`;
  const [local, setLocal] = useState<ViewState>(() => rememberedViews.get(identity) ?? { category: 'remaining', page: 0 });
  const remember = (next: ViewState) => {
    setLocal(next); rememberedViews.delete(identity); rememberedViews.set(identity, next);
    if (rememberedViews.size > 128) { const oldest = rememberedViews.keys().next().value; if (oldest !== undefined) rememberedViews.delete(oldest); }
  };
  const report = view.report;
  const selected = report.endpointChanges[local.category];
  const page = pageRows(selected.ids, local.page, PAGE_SIZE);
  return <section className='hima-feedback-panel' data-hima-region='generation-feedback' data-hima-state-subject={report.subject}>
    <header><div><span className='hima-studio-eyebrow'>RETAINED GENERATION FEEDBACK</span><h2>Generation {String(report.generation)} · {report.subject === 'timing-endpoint' ? 'timing endpoints' : 'Cell Demand'}</h2></div><button type='button' className='hima-button' onClick={onChooseAnother}>Choose another report</button></header>
    <p role='note'>Counts and categories are declarations from the verified producer bytes. This view does not recalculate them, independently qualify them, or treat a local result as a global PPA or Library pass.</p>
    <dl className='hima-report-identity'><dt>Report</dt><dd>{view.reportRef}</dd><dt>Version</dt><dd>{view.version}</dd><dt>Source record</dt><dd>{view.source.recordId}</dd><dt>SHA-256</dt><dd>{view.source.sha256}</dd><dt>Created</dt><dd>{view.source.createdAt}</dd></dl>
    <section><h3>Original denominator</h3><p>{report.denominator.originalCount} {report.denominator.kind}{report.denominator.originalCount === 1 ? '' : 's'} declared by the producer.</p><details><summary>Original identities</summary><IdentityRows rows={report.denominator.originalIds}/></details></section>
    <section className='hima-feedback-coverage'><h3>Coverage before and after</h3><Coverage label='Before' coverage={report.coverage.before}/><Coverage label='After' coverage={report.coverage.after}/></section>
    <section><h3>Comparability</h3><p>{report.comparability.status}</p>{report.comparability.reasons.map(reason => <p className='hima-memory-warning' key={reason}>{reason}</p>)}</section>
    <section><h3>Producer categories</h3><div className='hima-feedback-counts'>{(Object.keys(CATEGORY_LABELS) as GenerationFeedbackCategory[]).map(category => {
      const row = report.endpointChanges[category]; const count = row.status === 'measured' ? row.ids.length : undefined;
      return <article key={category} data-hima-state-category={category}><strong>{CATEGORY_LABELS[category]}</strong>{count === undefined ? <p>Unknown · {row.status === 'unknown' ? row.reason : 'producer did not measure this category'}</p> : <p>{count} declared</p>}</article>;
    })}</div>
      <label>Inspect category <select data-hima-control='feedback-category' value={local.category} onChange={event => remember({ category: event.target.value as GenerationFeedbackCategory, page: 0 })}>{(Object.keys(CATEGORY_LABELS) as GenerationFeedbackCategory[]).map(category => <option value={category} key={category}>{CATEGORY_LABELS[category]}</option>)}</select></label>
      {selected.status === 'unknown' ? <p className='hima-memory-warning'>Unknown: {selected.reason}. No zero count is implied.</p> : <><p>{page.rows.length === 0 ? 'The producer measured this category as empty.' : `${selected.ids.length} producer-declared identities.`}</p><IdentityRows rows={page.rows}/><PageControls page={page.page} pages={page.pages} onPage={next => remember({ ...local, page: next })}/></>}
    </section>
    <section><h3>Next action</h3><p>{report.next.kind} · {report.next.status} · {report.next.reason}</p>{report.next.items.map(item => <NextAction key={item.id} item={item} reportRef={view.reportRef} version={view.version} sourceSha={view.source.sha256} onReference={onReference}/>)}</section>
    {report.unknowns.length === 0 ? null : <section><h3>Unknowns</h3>{report.unknowns.map(reason => <p className='hima-memory-warning' key={reason}>{reason}</p>)}</section>}
    <button type='button' className='hima-button' data-hima-control='feedback-add-report-reference' onClick={() => onReference(`Inspect generation feedback report ${view.reportRef}, version ${view.version}, SHA-256 ${view.source.sha256}. Keep generation ${String(report.generation)}, original denominator ${String(report.denominator.originalCount)}, producer-declared categories, comparability, and unknowns unchanged; do not infer global PPA or Library qualification.`)}>Add report reference to draft</button>
  </section>;
}

function Coverage({ label, coverage }: { readonly label: string; readonly coverage: GenerationFeedbackReport['coverage']['before'] }): ReactElement {
  return <article><h4>{label}</h4><p>{coverage.status === 'measured' ? 'Measured by producer.' : `Unknown: ${coverage.reason}. Retained identities below are not reclassified.`}</p><p>Covered identities: {coverage.coveredIds.length || (coverage.status === 'unknown' ? 'unknown, no zero implied' : 0)}</p><IdentityRows rows={coverage.coveredIds}/><p>Missing identities: {coverage.missingIds.length || (coverage.status === 'unknown' ? 'unknown, no zero implied' : 0)}</p><IdentityRows rows={coverage.missingIds}/></article>;
}

function IdentityRows({ rows }: { readonly rows: readonly string[] }): ReactElement {
  return rows.length === 0 ? <p className='hima-small'>No identities supplied.</p> : <ul className='hima-identity-list'>{rows.map(row => <li key={row}>{row}</li>)}</ul>;
}

function PageControls({ page, pages, onPage }: { readonly page: number; readonly pages: number; onPage(page: number): void }): ReactElement | null {
  return pages <= 1 ? null : <div className='hima-team-actions'><button type='button' className='hima-button' disabled={page === 0} onClick={() => onPage(page - 1)}>Previous identities</button><span>Page {page + 1} of {pages}</span><button type='button' className='hima-button' disabled={page + 1 >= pages} onClick={() => onPage(page + 1)}>Next identities</button></div>;
}

function NextAction({ item, reportRef, version, sourceSha, onReference }: { readonly item: GenerationFeedbackReport['next']['items'][number]; readonly reportRef: string; readonly version: string; readonly sourceSha: string; onReference(text: string): void }): ReactElement {
  return <article className='hima-feedback-action'><header><strong>{item.id}</strong><span>{item.targetIds.join(', ') || 'No targets declared'}</span></header><p>Change: {item.change}</p><p>Expected local effect: {item.expectedEffect}</p>
    <p>Validation: {item.validation.status === 'known' ? item.validation.method : `Unknown · ${item.validation.reason}`}</p><p>Stop condition: {item.stopCondition.status === 'known' ? item.stopCondition.text : `Unknown · ${item.stopCondition.reason}`}</p><p className='hima-small'>Evidence sources: {item.sourceIds.join(', ')}</p>
    {item.demand ? <CellDemand demand={item.demand}/> : null}
    <button type='button' className='hima-button' data-hima-control={`feedback-action-${item.id}`} onClick={() => onReference(`Inspect next action ${item.id} from generation feedback report ${reportRef}, version ${version}, SHA-256 ${sourceSha}. Targets: ${item.targetIds.join(', ') || 'none declared'}. Evidence sources: ${item.sourceIds.join(', ')}. Preserve the producer's validation, stop condition, and unknowns; do not infer global PPA improvement.`)}>Add action reference to draft</button>
  </article>;
}

function CellDemand({ demand }: { readonly demand: NonNullable<GenerationFeedbackReport['next']['items'][number]['demand']> }): ReactElement {
  return <details open><summary>Concrete Cell Demand</summary><p>Input pins: {demand.inputPins.join(', ') || 'none declared'}</p><p>Outputs: {demand.outputs.map(output => `${output.name}=${output.function ?? 'function unknown'}`).join(', ') || 'none declared'}</p>
    <p>Truth-table inputs: {demand.truthTable.inputOrder.join(', ') || 'none'} · outputs: {demand.truthTable.outputOrder.join(', ') || 'none'}</p>{Object.entries(demand.truthTable.outputTruthTablesHex).map(([output, table]) => <p className='hima-identity' key={output}>{output}: {table}</p>)}
    <p>Conditional delay target: {demand.conditionalDelayTarget.requiredDelayNs} ns · endpoints {demand.conditionalDelayTarget.targetEndpoints.join(', ') || 'none'} · slew {demand.conditionalDelayTarget.slewNs ?? 'unknown'} ns · load {demand.conditionalDelayTarget.loadPf ?? 'unknown'} pF · corner {demand.conditionalDelayTarget.corner ?? 'unknown'}</p>
    {demand.conditionalDelayTarget.unknowns.map(reason => <p className='hima-memory-warning' key={reason}>{reason}</p>)}
    <h4>Timing arcs</h4>{demand.timingArcs.length === 0 ? <p>No timing arcs declared.</p> : demand.timingArcs.map((arc, index) => <ul key={index}>{technicalFieldLines(arc).map(line => <li key={line}>{line}</li>)}</ul>)}
    <h4>Implementation identity</h4><ul>{technicalFieldLines(demand.implementation).map(line => <li key={line}>{line}</li>)}</ul>
  </details>;
}
