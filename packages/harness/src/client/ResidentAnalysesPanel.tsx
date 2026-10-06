// Data Insight's Resident analyses (ADR-0020, 2026-10-05 revision): a person asks a library question,
// the Host prepares one bounded Run of the analysis Pack, and one confirmation starts it. This panel
// is the whole surface: the composer, the proposal card, the list of this conversation's analyses and
// the Reader-accepted result of the selected one. Facts come from the Host's
// `/hima/api/libinsight/analyses` answers alone: the list is summaries, and the selected Run's result
// is read once per result hash and kept, so polling neither refetches nor re-projects it. The panel
// keeps only the draft and the selection, and is hidden rather than unmounted so both survive a trip
// to another Data Insight surface.
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactElement } from 'react';
import type { LibInsightAnalysesStatus, LibInsightAnalysisDetail, LibInsightAnalysisEntry, LibInsightAnalysisProposal, LibInsightAnalysisResult } from '../libinsight-analyses.js';
import { confirmResidentAnalysis, fetchResidentAnalyses, fetchResidentAnalysis, proposeResidentAnalysis } from './api.js';
import { AnalysisPlot } from './AnalysisPlot.js';
import { admittedAnalysisRefs, analysisFinished, analysisState as stateOf, rememberDetail } from './resident-analyses-view.js';

const POLL_MS = 10_000;
type DetailRead = { readonly sha: string; readonly detail?: LibInsightAnalysisDetail; readonly error?: string };
const when = (at: string) => { const date = new Date(at); return Number.isNaN(date.getTime()) ? at : date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); };
const shortSha = (sha: string) => sha.slice(0, 12);

export function ResidentAnalysesPanel({ sessionId, hidden, tabVisible = true, onShowLibInsight, onShowReports }: {
  readonly sessionId: string; readonly hidden: boolean; readonly tabVisible?: boolean; onShowLibInsight(): void; onShowReports(): void;
}): ReactElement {
  const [data, setData] = useState<{ readonly status: LibInsightAnalysesStatus; readonly analyses: readonly LibInsightAnalysisEntry[] }>();
  const [listError, setListError] = useState<string>();
  const [question, setQuestion] = useState('');
  const [sources, setSources] = useState('');
  const [buildsOn, setBuildsOn] = useState('');
  const [proposal, setProposal] = useState<LibInsightAnalysisProposal>();
  const [actionError, setActionError] = useState<string>();
  const [busy, setBusy] = useState<'prepare' | 'confirm'>();
  const [selected, setSelected] = useState<string>();
  const [read, setRead] = useState<DetailRead>();
  const [retry, setRetry] = useState(0);
  const details = useRef(new Map<string, LibInsightAnalysisDetail>());
  const active = !hidden && tabVisible;

  const load = useCallback(async (signal?: AbortSignal) => {
    const answer = await fetchResidentAnalyses(sessionId, signal);
    if (signal?.aborted) return;
    if (!answer.ok) { setListError(answer.error.message); return; }
    setListError(undefined); setData(answer.value);
  }, [sessionId]);
  // Read on every return to the surface; poll only while it is shown and something is still running.
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [active, load]);
  const unfinished = data?.analyses.some(entry => !analysisFinished(entry)) ?? false;
  useEffect(() => {
    if (!active || !unfinished) return;
    const timer = setInterval(() => { void load(); }, POLL_MS);
    return () => clearInterval(timer);
  }, [active, unfinished, load]);

  const prepare = async (event: FormEvent) => {
    event.preventDefault();
    if (question.trim() === '' || busy !== undefined) return;
    setBusy('prepare'); setActionError(undefined);
    const answer = await proposeResidentAnalysis(sessionId, { question: question.trim(), sources: sources.split('\n').map(line => line.trim()).filter(Boolean), buildsOn: buildsOn === '' ? [] : [buildsOn] });
    setBusy(undefined);
    if (!answer.ok) { setActionError(answer.error.message); return; }
    setProposal(answer.value);
  };
  const confirm = async () => {
    if (proposal === undefined || !proposal.ready || busy !== undefined) return;
    setBusy('confirm'); setActionError(undefined);
    const answer = await confirmResidentAnalysis(sessionId, proposal.proposalId);
    setBusy(undefined);
    if (!answer.ok) { setActionError(answer.error.message); return; }
    setProposal(undefined); setQuestion(''); setSources(''); setBuildsOn('');
    setSelected(answer.value.runId);
    void load();
  };

  const analyses = data?.analyses ?? [];
  const admitted = admittedAnalysisRefs(analyses);
  const shown = selected === undefined ? analyses[0] : analyses.find(entry => entry.runId === selected);
  const status = data?.status;

  // The selected Run's result, read only when its Reader-accepted hash is one not read before.
  const shownRun = shown?.runId, shownSha = shown?.analysis?.resultSha256;
  useEffect(() => {
    if (shownRun === undefined || shownSha === undefined) return;
    const cached = details.current.get(shownSha);
    if (cached !== undefined) { setRead({ sha: shownSha, detail: cached }); return; }
    if (!active) return;
    const controller = new AbortController();
    setRead({ sha: shownSha });
    void fetchResidentAnalysis(sessionId, shownRun, controller.signal).then(answer => {
      if (controller.signal.aborted) return;
      if (!answer.ok) { setRead({ sha: shownSha, error: answer.error.message }); return; }
      rememberDetail(details.current, shownSha, answer.value);
      setRead({ sha: shownSha, detail: answer.value });
    });
    return () => controller.abort();
  }, [sessionId, shownRun, shownSha, active, retry]);
  const shownRead = read !== undefined && read.sha === shownSha ? read : undefined;

  return <section className='hima-resident' data-hima-region='resident-analyses' data-hima-state-available={status === undefined ? 'loading' : String(status.available)} hidden={hidden}>
    <header className='hima-libinsight-bar'>
      <span className='hima-studio-eyebrow'>RESIDENT ANALYSES</span>
      {status?.available ? <span className='hima-small'>{status.pack} on {status.site}</span> : null}
      <div className='hima-libinsight-actions'>
        <button type='button' className='hima-button' data-hima-control='resident-show-libinsight' onClick={onShowLibInsight}>LibInsight pages</button>
        <button type='button' className='hima-button' data-hima-control='resident-show-reports' onClick={onShowReports}>Retained reports</button>
      </div>
    </header>
    {listError === undefined ? null : <p className='hima-notice' role='alert'>Resident analyses unavailable: {listError}</p>}
    <div className='hima-resident-body'>
      <div className='hima-resident-side'>
        {status === undefined ? <p className='hima-small'>Reading Resident analyses…</p>
          : !status.available ? <div className='hima-resident-unavailable' role='status'><p>{status.reason}</p><p className='hima-small'>Install the analysis Pack and its Site in this Home to ask a resident question.</p></div>
          : <form className='hima-resident-composer' onSubmit={event => { void prepare(event); }}>
              <label>Question for the resident agent<textarea data-hima-control='resident-question' value={question} maxLength={4000} rows={4} onChange={event => setQuestion(event.target.value)} placeholder='Which cells lose the most delay margin between the slow and fast corners?' /></label>
              <label>Library files on the Site <span className='hima-small'>(optional, one absolute path per line)</span><textarea data-hima-control='resident-sources' value={sources} rows={3} onChange={event => setSources(event.target.value)} placeholder='/path/on/site/library.lib' /></label>
              <label>Build on an admitted analysis <span className='hima-small'>(optional)</span>
                <select data-hima-control='resident-builds-on' value={buildsOn} onChange={event => setBuildsOn(event.target.value)}>
                  <option value=''>Start fresh</option>
                  {admitted.map(ref => <option key={ref} value={ref}>{ref}</option>)}
                </select></label>
              <button type='submit' className='hima-button hima-primary' data-hima-control='resident-prepare' disabled={question.trim() === '' || busy !== undefined}>{busy === 'prepare' ? 'Preparing…' : 'Prepare'}</button>
            </form>}
        {actionError === undefined ? null : <p className='hima-notice' role='alert'>{actionError}</p>}
        {proposal === undefined ? null : <ProposalCard proposal={proposal} busy={busy === 'confirm'} onConfirm={() => { void confirm(); }} onDiscard={() => setProposal(undefined)} />}
        <ol className='hima-resident-list' data-hima-control='resident-list' aria-label='Resident analyses, newest first'>
          {data !== undefined && analyses.length === 0 ? <li className='hima-small'>No resident analysis in this conversation yet.</li> : null}
          {analyses.map(entry => {
            const state = stateOf(entry);
            const reason = entry.task?.reason !== undefined && (entry.task.state === 'waiting' || entry.task.state === 'failed') ? entry.task.reason : undefined;
            return <li key={entry.runId}>
              <button type='button' className='hima-resident-item' aria-current={shown?.runId === entry.runId} data-hima-state-run={entry.runId} onClick={() => setSelected(entry.runId)}>
                <span className='hima-resident-question'>{entry.question ?? '(question not recorded)'}</span>
                <span className='hima-resident-meta'><span className='hima-resident-chip' data-state={state}>{state}</span><span className='hima-small'>{when(entry.createdAt)}</span>{entry.analysis !== undefined && !entry.analysis.admitted ? <span className='hima-resident-flag'>not admitted</span> : null}</span>
                {reason === undefined ? null : <span className='hima-resident-reason'>{reason}</span>}
              </button>
            </li>;
          })}
        </ol>
      </div>
      <div className='hima-resident-main'>
        {shown === undefined
          ? selected === undefined ? <p className='hima-resident-empty'>Ask a question to start a resident analysis; its result appears here.</p>
            : <p className='hima-resident-empty' role='status'>Analysis {selected} has started; it appears here on the next read.</p>
          : <AnalysisDetail entry={shown} read={shownRead} onRetry={() => setRetry(value => value + 1)} />}
      </div>
    </div>
  </section>;
}

function ProposalCard({ proposal, busy, onConfirm, onDiscard }: { readonly proposal: LibInsightAnalysisProposal; readonly busy: boolean; onConfirm(): void; onDiscard(): void }): ReactElement {
  return <article className='hima-resident-proposal' data-hima-control='resident-proposal' data-hima-state-ready={String(proposal.ready)}>
    <h3>Proposed analysis</h3>
    <p className='hima-resident-proposal-question'>{proposal.question}</p>
    <dl>
      <dt>Library files</dt><dd>{proposal.sources.length === 0 ? 'None named; the agent works from the question.' : <ul>{proposal.sources.map(source => <li key={source}><code>{source}</code></li>)}</ul>}</dd>
      <dt>Builds on</dt><dd>{proposal.buildsOn.length === 0 ? 'Nothing; a fresh analysis.' : proposal.buildsOn.map(ref => <code key={ref}>{ref}</code>)}</dd>
      <dt>Pack</dt><dd><code>{proposal.pack.id}</code> {proposal.pack.version}</dd>
      <dt>Site</dt><dd><code>{proposal.site}</code></dd>
      <dt>Time box</dt><dd>{proposal.timeBoxMinutes} min</dd>
      <dt>Request</dt><dd><code>{proposal.requestId}</code></dd>
    </dl>
    {proposal.ready ? <p className='hima-resident-ready'>Ready. Confirming starts one bounded Run; nothing has started yet.</p>
      : <div className='hima-resident-unready' role='status'><p>Not ready to start:</p>
          <ul>{proposal.unknowns.map(item => <li key={`u-${item}`}>{item}</li>)}</ul>
          {proposal.nextActions.length === 0 ? null : <><p>Next:</p><ul>{proposal.nextActions.map(item => <li key={`n-${item}`}>{item}</li>)}</ul></>}</div>}
    <div className='hima-resident-actions'>
      <button type='button' className='hima-button hima-primary' data-hima-control='resident-confirm' disabled={!proposal.ready || busy} onClick={onConfirm}>{busy ? 'Starting…' : 'Confirm and start'}</button>
      <button type='button' className='hima-button' data-hima-control='resident-discard' disabled={busy} onClick={onDiscard}>Discard</button>
    </div>
  </article>;
}

function AnalysisDetail({ entry, read, onRetry }: { readonly entry: LibInsightAnalysisEntry; readonly read?: DetailRead; onRetry(): void }): ReactElement {
  const state = stateOf(entry), analysis = entry.analysis, detail = read?.detail, result = detail?.result;
  // Admission is the detail's word when it has been read, the summary's until then.
  // Admission comes from the summary, refreshed on every poll; a cached detail may predate admission.
  const admitted = analysis?.admitted ?? detail?.admission.admitted;
  const notAdmitted = analysis?.notAdmittedReason ?? detail?.admission.reason ?? 'reason not recorded';
  const ref = analysis?.id !== undefined && analysis.version !== undefined ? `${analysis.id}@${String(analysis.version)}` : undefined;
  return <article className='hima-resident-detail' data-hima-control='resident-detail' data-hima-state-run={entry.runId} data-hima-state-status={state} data-hima-state-admitted={admitted === undefined ? '' : String(admitted)}>
    <header>
      <h3>{result?.question ?? entry.question ?? '(question not recorded)'}</h3>
      <p className='hima-small'><span className='hima-resident-chip' data-state={state}>{state}</span><span>Run <code>{entry.runId}</code></span><span>{when(entry.createdAt)}</span>{ref === undefined ? null : <span>Analysis <code>{ref}</code></span>}</p>
    </header>
    {entry.task?.reason === undefined ? null : <p className='hima-resident-reason' role='status'>{entry.task.reason}</p>}
    {analysis !== undefined && admitted === false ? <p className='hima-resident-not-admitted' role='status' data-hima-control='resident-not-admitted'>Reader-accepted, not admitted: {notAdmitted}</p> : null}
    {analysis === undefined
      ? analysisFinished(entry) ? <p className='hima-small'>This analysis ended without a Reader-accepted result.</p>
        : <p className='hima-small'>The resident agent is still working; this view reads again every 10 seconds while it is open.</p>
      : read?.error !== undefined ? <div className='hima-notice' role='alert'>The result could not be read: {read.error} <button type='button' className='hima-button' data-hima-control='resident-detail-retry' onClick={onRetry}>Try again</button></div>
      : detail === undefined ? <p className='hima-small'>Reading the result{analysis.plotCount === undefined ? '' : ` (${String(analysis.plotCount)} plot${analysis.plotCount === 1 ? '' : 's'})`}…</p>
      : result !== undefined ? <ResultBody result={result} />
      : <p className='hima-notice' role='alert'>{detail.resultUnavailable ?? 'The Host returned no result for this analysis.'}</p>}
  </article>;
}

function ResultBody({ result }: { readonly result: LibInsightAnalysisResult }): ReactElement {
  return <>
    <p className='hima-resident-summary'>{result.summary}</p>
    {result.plots.map(plot => <AnalysisPlot key={plot.id} result={result} plot={plot} />)}
    <TextList title='Assumptions' items={result.assumptions} />
    <TextList title='Limits' items={result.limits} />
    <section className='hima-resident-facts'>
      <h4>Sources</h4>
      {result.sources.length === 0 ? <p className='hima-small'>No library file was named.</p>
        : <table className='hima-plot-table'><thead><tr><th scope='col'>Path</th><th scope='col'>sha256 before</th><th scope='col'>sha256 after</th></tr></thead>
            <tbody>{result.sources.map(source => <tr key={source.path}><td><code>{source.path}</code></td><td><code title={source.sha256Before}>{shortSha(source.sha256Before)}</code></td>
              <td><code title={source.sha256After}>{shortSha(source.sha256After)}</code>{source.sha256After === source.sha256Before ? null : <span className='hima-resident-changed'> changed</span>}</td></tr>)}</tbody></table>}
      <h4>Run</h4>
      <dl>
        <dt>Command</dt><dd><code>{result.run.command}</code></dd>
        <dt>Exit code</dt><dd>{result.run.exitCode}</dd>
        <dt>Elapsed</dt><dd>{result.run.elapsedSeconds} s</dd>
        <dt>Used QuaLib</dt><dd>{result.run.usedQualib ? 'yes' : 'no'}</dd>
      </dl>
      <details className='hima-resident-code'>
        <summary>Main script <code>{result.code.main.path}</code> · sha256 <code title={result.code.main.sha256}>{shortSha(result.code.main.sha256)}</code>{result.code.files.length === 0 ? null : ` · ${String(result.code.files.length)} more file${result.code.files.length === 1 ? '' : 's'}`}</summary>
        <pre>{result.code.main.text}</pre>
        {result.code.files.length === 0 ? null : <ul>{result.code.files.map(file => <li key={file.path}><code>{file.path}</code> <code title={file.sha256}>{shortSha(file.sha256)}</code></li>)}</ul>}
      </details>
    </section>
  </>;
}

function TextList({ title, items }: { readonly title: string; readonly items: readonly string[] }): ReactElement | null {
  if (items.length === 0) return null;
  return <section className='hima-resident-facts'><h4>{title}</h4><ul>{items.map((item, i) => <li key={i}>{item}</li>)}</ul></section>;
}
