import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import {
  correctExperience,
  fetchExperienceCandidates,
  fetchMemorySources,
  readMemory,
  saveMemory,
  type ExperienceCandidate,
  type MemoryAnswer,
  type MemorySourcesAnswer,
} from './api.js';
import {
  experienceCorrectionRequest,
  memoryEvidenceMatches,
  memoryScopeKey,
  memorySummaryInput,
  type MemoryDraft,
} from './workbench-state.js';

export interface WorkMemoryPanelProps {
  readonly sessionId: string;
  readonly runId?: string;
  readonly draft: MemoryDraft;
  onDraft(draft: MemoryDraft): void;
}

export function WorkMemoryPanel({ sessionId, runId, draft, onDraft }: WorkMemoryPanelProps): ReactElement {
  const scopeKey = memoryScopeKey(sessionId, runId);
  const [answer, setAnswer] = useState<MemoryAnswer>();
  const [evidence, setEvidence] = useState<MemorySourcesAnswer>();
  const [candidates, setCandidates] = useState<readonly ExperienceCandidate[]>([]);
  const [error, setError] = useState<string>();
  const [candidateError, setCandidateError] = useState<string>();
  const [correctionNotice, setCorrectionNotice] = useState<string>();
  const [saving, setSaving] = useState(false);
  const pending = useRef<AbortController[]>([]);

  const startRequest = () => {
    const controller = new AbortController();
    pending.current.push(controller);
    return controller;
  };
  const settleRequest = (controller: AbortController) => {
    pending.current = pending.current.filter(item => item !== controller);
  };

  const refresh = useCallback(async () => {
    const controller = startRequest();
    const requestedScope = scopeKey;
    try {
      const result = await readMemory({ sessionId, ...(runId === undefined ? {} : { runId }) }, controller.signal);
      if (controller.signal.aborted || requestedScope !== memoryScopeKey(sessionId, runId)) return;
      if (result.ok) { setAnswer(result.value); setError(undefined); }
      else setError(result.error.message);
    } finally { settleRequest(controller); }
  }, [runId, scopeKey, sessionId]);

  const refreshCandidates = useCallback(async () => {
    if (runId === undefined) { setCandidates([]); setCandidateError(undefined); return; }
    const controller = startRequest();
    try {
      const result = await fetchExperienceCandidates({ sessionId, runId }, controller.signal);
      if (controller.signal.aborted) return;
      if (result.ok) { setCandidates(result.value.candidates); setCandidateError(undefined); }
      else setCandidateError(result.error.message);
    } finally { settleRequest(controller); }
  }, [runId, sessionId]);

  useEffect(() => {
    setAnswer(undefined); setEvidence(undefined); setCandidates([]); setError(undefined); setCandidateError(undefined); setCorrectionNotice(undefined); setSaving(false);
    void refresh(); void refreshCandidates();
    return () => { for (const controller of pending.current) controller.abort(); pending.current = []; };
  }, [scopeKey, refresh, refreshCandidates]);

  const refreshSources = async () => {
    const controller = startRequest();
    const requestedScope = scopeKey;
    try {
      const result = await fetchMemorySources({ sessionId, ...(runId === undefined ? {} : { runId }) }, controller.signal);
      if (controller.signal.aborted || requestedScope !== scopeKey) return;
      if (!result.ok) { setError(result.error.message); return; }
      if (!memoryEvidenceMatches(result.value, sessionId, runId)) { setError('The Host returned sources for a different work-memory scope.'); return; }
      setEvidence(result.value); setError(undefined);
    } finally { settleRequest(controller); }
  };

  const save = async () => {
    if (evidence === undefined || saving) return;
    let summary;
    try { summary = memorySummaryInput(draft, evidence); }
    catch (caught) { setError((caught as Error).message); return; }
    const controller = startRequest();
    const requestedScope = scopeKey;
    setSaving(true); setError(undefined);
    try {
      const result = await saveMemory({ sessionId, ...(runId === undefined ? {} : { runId }), summary }, controller.signal);
      if (controller.signal.aborted || requestedScope !== scopeKey) return;
      if (!result.ok) { setError(result.error.message); return; }
      setAnswer(result.value); setEvidence(undefined);
      onDraft({ subject: '', decisions: '', openQuestions: '', todo: '' });
    } finally {
      if (!controller.signal.aborted && requestedScope === scopeKey) setSaving(false);
      settleRequest(controller);
    }
  };

  const summary = answer !== undefined && 'summary' in answer ? answer.summary : undefined;
  return <section className='hima-memory-panel' data-hima-region='work-memory' data-hima-state-memory={answer?.kind ?? 'loading'}>
    <header><span className='hima-studio-eyebrow'>WORK MEMORY</span><button type='button' className='hima-button' onClick={() => void refresh()}>Refresh memory</button></header>
    {error ? <p role='alert'>Memory unavailable: {error}</p>
      : answer?.kind === 'none' ? <p>No verified summary is saved for this exact {runId === undefined ? 'Guide' : 'Campaign'} scope.</p>
        : answer?.kind === 'unavailable' ? <p>Memory unavailable: {answer.reason}</p>
          : summary ? <><h3>{summary.subject}</h3>{answer?.kind !== 'current' ? <p className='hima-memory-warning'>Summary is {answer?.kind}: {answer?.reason ?? 're-read current authority before acting.'}</p> : null}
            <MemoryList title='Decisions' values={summary.decisions}/><MemoryList title='Open questions' values={summary.openQuestions}/><MemoryList title='Next' values={summary.todo}/>
            <p className='hima-small'>Evidence: {summary.references.length} records · {summary.nativeSources?.length ?? 0} native sources · generated {summary.generatedAt}</p></>
            : <p>Checking the authenticated Host memory projection…</p>}
    <div className='hima-memory-editor'>
      <label>Subject<input value={draft.subject} onChange={event => onDraft({ ...draft, subject: event.target.value })}/></label>
      <label>Confirmed decisions<textarea value={draft.decisions} onChange={event => onDraft({ ...draft, decisions: event.target.value })} placeholder='One decision per line'/></label>
      <label>Open questions<textarea value={draft.openQuestions} onChange={event => onDraft({ ...draft, openQuestions: event.target.value })} placeholder='One question per line'/></label>
      <label>Next steps<textarea value={draft.todo} onChange={event => onDraft({ ...draft, todo: event.target.value })} placeholder='One next step per line'/></label>
      <div className='hima-memory-actions'><button type='button' className='hima-button' onClick={() => void refreshSources()}>Refresh exact sources</button><button type='button' className='hima-button' disabled={evidence === undefined || draft.subject.trim() === '' || saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save source-linked summary'}</button></div>
      <p className='hima-small'>{evidence === undefined ? 'Refresh exact Host sources before saving.' : `Ready with ${String(evidence.references.length)} record references and ${String(evidence.sources.length + (evidence.nativeSources?.length ?? 0))} source carrier(s).`}</p>
    </div>
    {runId === undefined ? null : <div className='hima-memory-candidates'><h3>Experience corrections</h3>
      {correctionNotice ? <p role='status'>{correctionNotice}</p> : null}
      {candidateError ? <p role='alert'>Experience candidates unavailable: {candidateError}</p> : candidates.length === 0 ? <p>No verified experience candidate is available for this Campaign.</p>
        : candidates.map(candidate => <ExperienceCorrectionEditor key={`${candidate.candidate.sourceRun}:${candidate.candidate.sourceMaterialSha256}:${candidate.adoption?.id ?? ''}`} sessionId={sessionId} runId={runId} candidate={candidate} onSaved={async message => { setCorrectionNotice(message); await refreshCandidates(); }}/>)}
    </div>}
  </section>;
}

function MemoryList({ title, values }: { readonly title: string; readonly values: readonly string[] }): ReactElement | null {
  return values.length === 0 ? null : <div><h4>{title}</h4><ul>{values.map((value, index) => <li key={`${String(index)}:${value}`}>{value}</li>)}</ul></div>;
}

function ExperienceCorrectionEditor({ sessionId, runId, candidate, onSaved }: { readonly sessionId: string; readonly runId: string; readonly candidate: ExperienceCandidate; onSaved(message: string): Promise<void> }): ReactElement {
  const [reason, setReason] = useState('');
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string>();
  const pending = useRef<AbortController>();
  useEffect(() => () => pending.current?.abort(), []);
  const action = candidate.adoption?.event === 'disabled' ? 'Re-adopt' : 'Disable';
  const submit = async () => {
    let request;
    try { request = experienceCorrectionRequest({ sessionId, runId, candidate, reason, evidenceRefs: selected, requestId: `ui-${crypto.randomUUID()}` }); }
    catch (caught) { setStatus((caught as Error).message); return; }
    pending.current?.abort(); const controller = new AbortController(); pending.current = controller;
    setBusy(true); setStatus(undefined);
    const result = await correctExperience(request, controller.signal);
    if (controller.signal.aborted) return;
    setBusy(false);
    if (!result.ok) { setStatus(result.error.message); return; }
    const message = `${action} recorded against the exact archived experience identity.`;
    setReason(''); setSelected([]); setStatus(message); await onSaved(message);
  };
  return <article>
    <strong>{candidate.title}</strong>
    <p className='hima-small'>Run {candidate.candidate.sourceRun}</p>
    <p className='hima-identity'>Manifest {candidate.candidate.sourceManifestSha256}<br/>Material {candidate.candidate.sourceMaterialSha256}</p>
    {candidate.adoption === undefined ? <p className='hima-small'>Candidate only; no correction has been recorded.</p> : <p className='hima-small'>Current state: {candidate.adoption.event} · {candidate.adoption.reason}</p>}
    <fieldset><legend>Select current evidence</legend>{candidate.availableEvidence.map(item => <label key={item.recordId}><input type='checkbox' checked={selected.includes(item.recordId)} onChange={event => setSelected(event.target.checked ? [...selected, item.recordId] : selected.filter(recordId => recordId !== item.recordId))}/>{item.label}</label>)}</fieldset>
    <label>Reason<textarea value={reason} onChange={event => setReason(event.target.value)} placeholder={`Why should this experience be ${action === 'Disable' ? 'disabled' : 'used again'}?`}/></label>
    <button type='button' className='hima-button' disabled={busy || reason.trim() === '' || selected.length === 0} onClick={() => void submit()}>{busy ? 'Recording…' : `${action} exact experience`}</button>
    {status ? <p role='status'>{status}</p> : null}
  </article>;
}
