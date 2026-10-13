import type { MemoryView, MemoryPage, MemorySource, TeamMemoryContext } from '../team-memory.js';
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
  readonly teamTarget?: TeamMemoryTarget;
  readonly teamOperations?: TeamMemoryOperations;
}

export interface TeamMemoryTarget {
  readonly teamId: string;
  readonly taskId: string;
  readonly members: readonly { readonly id: string; readonly role: string }[];
}
export interface TeamMemoryOperations {
  call(action: 'status' | 'query' | 'feedback' | 'propose' | 'adopt' | 'correct' | 'corrections', request: unknown, signal?: AbortSignal): Promise<unknown>;
}
export function WorkMemoryPanel(props: WorkMemoryPanelProps): ReactElement {
  return props.teamTarget === undefined ? <LegacyWorkMemoryPanel {...props}/> : <TeamMemoryPanel key={`${props.sessionId}:${props.teamTarget.teamId}:${props.teamTarget.taskId}`} target={props.teamTarget} operations={props.teamOperations}/>;
}
function LegacyWorkMemoryPanel({ sessionId, runId, draft, onDraft }: WorkMemoryPanelProps): ReactElement {
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
  const authority = answer !== undefined && 'authority' in answer ? answer.authority : [];
  return <section className='hima-memory-panel' data-hima-region='work-memory' data-hima-state-memory={answer?.kind ?? 'loading'}>
    <header><span className='hima-studio-eyebrow'>WORK MEMORY</span><button type='button' className='hima-button' onClick={() => void refresh()}>Refresh memory</button></header>
    {error ? <p role='alert'>Memory unavailable: {error}</p>
      : answer?.kind === 'none' ? <p>No verified summary is saved for this exact {runId === undefined ? 'Guide' : 'Campaign'} scope.</p>
        : answer?.kind === 'unavailable' ? <p>Memory unavailable: {answer.reason}</p>
          : summary ? <><h3>{summary.subject}</h3>{answer?.kind !== 'current' ? <p className='hima-memory-warning'>Summary is {answer?.kind}: {answer?.reason ?? 're-read current authority before acting.'}</p> : null}
            {authority.map(current => <p className='hima-small' key={current.runId}>Current authority: {current.runId} · {current.status ?? 'status unavailable'} · node {current.currentNode ?? 'unavailable'} · generation {current.generation} · holds {current.holds.join(', ') || 'none'} · Jobs {current.jobs.map(job => `${job.session}:${job.event}`).join(', ') || 'none'} · retained reports {current.reportRefs.length}</p>)}
            <MemoryList title='Decisions' values={summary.decisions}/><MemoryList title='Open questions' values={summary.openQuestions}/><MemoryList title='Next' values={summary.todo}/>
            <p className='hima-small'>Evidence: {summary.references.length} records · {summary.nativeSources?.length ?? 0} native sources · {summary.modelGenerated ? 'model-generated' : 'person-authored'} {summary.generatedAt}</p></>
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

function TeamMemoryPanel({ target, operations }: { readonly target: TeamMemoryTarget; readonly operations?: TeamMemoryOperations }): ReactElement {
  const [scope, setScope] = useState('team');
  const [page, setPage] = useState<MemoryPage>();
  const [text, setText] = useState('');
  const [reason, setReason] = useState('');
  const [conditions, setConditions] = useState('');
  const [query, setQuery] = useState('');
  const [context, setContext] = useState<TeamMemoryContext>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);
  const pending = useRef<AbortController[]>([]);
  const selectedTarget = scope.startsWith('member:') ? { kind: 'member' as const, memberId: scope.slice(7) } : { kind: scope === 'project' ? 'project' as const : 'team' as const };
  const call = useCallback(async (action: Parameters<TeamMemoryOperations['call']>[0], request: unknown) => {
    if (operations === undefined) { setError('Team memory connection unavailable.'); return undefined; }
    const controller = new AbortController(); pending.current.push(controller); setError(undefined); setBusy(true);
    try {
      const result = await operations.call(action, request, controller.signal);
      return controller.signal.aborted ? undefined : result;
    } catch (caught) {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : String(caught));
      return undefined;
    } finally {
      pending.current = pending.current.filter(item => item !== controller);
      if (!controller.signal.aborted) setBusy(pending.current.length > 0);
    }
  }, [operations]);
  const refresh = useCallback(async (cursor?: number) => {
    const result = await call('status', { reconcile:true,page: { limit: 30, ...(cursor === undefined ? {} : { cursor }) } }) as MemoryPage | undefined;
    if (result !== undefined) setPage(previous => cursor === undefined ? result : { ...result, records: [...(previous?.records ?? []), ...result.records] });
  }, [call]);
  useEffect(() => {
    setPage(undefined); setText(''); setReason(''); setConditions(''); setQuery(''); setContext(undefined); setError(undefined); setNotice(undefined); setBusy(false);
    void refresh();
    return () => { for (const controller of pending.current) controller.abort(); pending.current = []; };
  }, [scope, refresh]);
  const scopeMatches = (item: MemoryView) => item.record.scope.kind === selectedTarget.kind && (selectedTarget.kind !== 'member' || item.record.scope.memberId === selectedTarget.memberId);
  const records = page?.records.filter(scopeMatches) ?? [];
  const save = async () => {
    const result = await call('feedback', { requestId: `ui-${crypto.randomUUID()}`, target: selectedTarget, text, reason, conditions: conditions.split('\n').map(value => value.trim()).filter(Boolean) }) as MemoryView | undefined;
    if (result === undefined) return;
    setPage(previous => ({ ...previous, records: [result, ...(previous?.records.filter(item => item.record.memoryId !== result.record.memoryId) ?? [])] }));
    setText(''); setReason(''); setConditions(''); setNotice('Feedback saved as a candidate. Adopt explicitly before it can be applied.'); setContext(undefined);
  };
  const search = async () => {
    setContext(undefined);
    const result = await call('query', { query, limit: 8, ...(selectedTarget.kind === 'member' ? { memberId: selectedTarget.memberId } : {}) }) as TeamMemoryContext | undefined;
    if (result !== undefined) setContext(result);
  };
  const feedback = page?.records.filter(item => item.record.kind === 'feedback') ?? [];
  return <section className='hima-memory-panel' data-hima-region='work-memory' data-hima-state-memory='team'>
    <header><span className='hima-studio-eyebrow'>TEAM MEMORY</span><button type='button' className='hima-button' disabled={busy} onClick={() => void refresh()}>Refresh memory</button></header>
    <p className='hima-small'>Team {target.teamId} · Task {target.taskId}. Saved sources remain readable when indexing is offline.</p>
    <label>Memory scope<select value={scope} onChange={event => setScope(event.target.value)}><option value='team'>Team methods</option><option value='project'>Project experience for this Team</option>{target.members.map(member => <option key={member.id} value={`member:${member.id}`}>{member.role} · {member.id}</option>)}</select></label>
    {error ? <p role='alert'>{error}</p> : null}{notice ? <p role='status'>{notice}</p> : null}
    <div className='hima-memory-editor'><label>Feedback<textarea value={text} maxLength={16000} onChange={event => setText(event.target.value)}/></label><label>Conditions<textarea value={conditions} onChange={event => setConditions(event.target.value)} placeholder='One visible condition per line'/></label><label>Reason<textarea value={reason} onChange={event => setReason(event.target.value)}/></label><button type='button' className='hima-button' disabled={busy || operations === undefined || !text.trim() || !reason.trim()} onClick={() => void save()}>Save feedback candidate</button><p className='hima-small'>Saving feedback does not adopt it. Adoption and correction require an authenticated human.</p></div>
    <div><label>Query memory<input value={query} maxLength={4000} onChange={event => setQuery(event.target.value)}/></label><button type='button' className='hima-button' disabled={busy || operations === undefined || !query.trim()} onClick={() => void search()}>Query memory</button>
      {context ? <div><h3>Query results with provenance</h3>{context.diagnostics.map((diagnostic, index) => <p key={index} className='hima-small'>{diagnostic}</p>)}{context.records.filter(scopeMatches).length === 0 ? <p>No verified adopted result in this scope.</p> : context.records.filter(scopeMatches).map(item => <article key={`${item.record.memoryId}:${item.record.version}`}><TeamMemoryDetails item={item}/><p className='hima-small'>Retrieval evidence ({item.retrieval.documentId}): {item.retrieval.excerpt}</p></article>)}</div> : null}
    </div>
    <h3>Saved memory and candidates</h3>{page === undefined ? <p>Checking authenticated Host records…</p> : records.length === 0 ? <p>No saved memory in this scope.</p> : records.map(item => <TeamMemoryEditor key={`${item.record.memoryId}:${item.record.version}:${item.tip.eventId}`} item={item} feedback={feedback} busy={busy} call={call} onSaved={result => { setPage(previous => ({ ...previous, records: (previous?.records ?? []).map(current => current.record.memoryId === result.record.memoryId ? result : current) })); setContext(undefined); setNotice(result.tip.event === 'corrected' ? 'Correction saved as a replacement candidate. Adopt it separately.' : `${result.tip.event} recorded.`); }}/>) }
    {page?.nextCursor === undefined ? null : <button type='button' className='hima-button' disabled={busy} onClick={() => void refresh(page.nextCursor)}>Load more saved memory</button>}
  </section>;
}
function TeamMemoryDetails({ item }: { readonly item: MemoryView }): ReactElement {
  const { record, tip, index } = item;
  return <><p>{record.text}</p><p className='hima-small'>{tip.state === 'candidate' ? 'Candidate — requires explicit adoption' : `Current state: ${tip.state}`} · {record.scope.kind}{record.scope.memberId ? ` ${record.scope.memberId}` : ''} · version {record.version} · revision {tip.revision}</p><p className='hima-identity'>Memory {record.memoryId} · SHA256 {record.sha256}<br/>Source Task {record.sourceTaskId} · Run {record.sourceRunId}<br/>Event {tip.eventId} · {tip.event} · {tip.actor.kind} {tip.actor.actorId} · {tip.createdAt}</p><p className='hima-small'>Reason: {tip.reason}</p><MemoryList title='Conditions' values={tip.conditions}/><ul aria-label='Memory sources'>{record.sources.map((source, ordinal) => <li key={ordinal}>{JSON.stringify(source)}</li>)}</ul><p className='hima-small'>Index: {index.state} · document {index.documentId} · operation {index.operationId}{index.reason ? ` · ${index.reason}` : ''}</p></>;
}
function feedbackRefs(item: MemoryView): readonly Extract<MemorySource, { kind: 'feedback' }>[] {
  return item.record.kind !== 'feedback' ? [] : item.tip.event === 'feedback' ? [{ kind: 'feedback', eventId: item.tip.eventId, sha256: item.record.sha256 }] : item.record.sources.filter(source => source.kind === 'feedback');
}
function TeamMemoryEditor({ item, feedback, busy, call, onSaved }: { readonly item: MemoryView; readonly feedback: readonly MemoryView[]; readonly busy: boolean; call: (action: Parameters<TeamMemoryOperations['call']>[0], request: unknown) => Promise<unknown>; onSaved(result: MemoryView): void }): ReactElement {
  const [reason, setReason] = useState('');
  const [text, setText] = useState('');
  const [conditions, setConditions] = useState(item.tip.conditions.join('\n'));
  const [selected, setSelected] = useState<readonly string[]>([]);
  const evidence = feedback.filter(current => current.record.scope.kind === item.record.scope.kind && current.record.scope.memberId === item.record.scope.memberId && (item.tip.state !== 'disabled' || current.record.createdAt > item.tip.createdAt)).flatMap(current => feedbackRefs(current).map(source => ({ source, text: current.record.text })));
  const evidenceRefs = evidence.filter(entry => entry.source.kind === 'feedback' && selected.includes(entry.source.eventId)).map(entry => entry.source);
  const mutation = async (action: 'adopted' | 'disabled' | 're-adopted' | 'correct') => {
    const base = { requestId: `ui-${crypto.randomUUID()}`, memoryId: item.record.memoryId, expectedVersion: item.record.version, expectedRevision: item.tip.revision, supersedesEventId: item.tip.eventId, reason, evidenceRefs, conditions: conditions.split('\n').map(value => value.trim()).filter(Boolean) };
    const result = await call(action === 'correct' ? 'correct' : 'adopt', action === 'correct' ? { ...base, text, sources: evidenceRefs } : { ...base, action }) as MemoryView | undefined;
    if (result !== undefined) onSaved(result);
  };
  const applied = item.tip.state === 'adopted' || item.tip.state === 're-adopted';
  return <article><TeamMemoryDetails item={item}/><fieldset disabled={busy}><legend>{item.tip.state === 'disabled' ? 'New feedback after disable is required to re-adopt' : 'Optional supporting feedback evidence'}</legend>{evidence.length === 0 ? <p>{item.tip.state === 'disabled' ? 'Save new feedback in this scope after disable to re-adopt.' : 'No supporting feedback available. Initial adoption uses the candidate’s verified original sources.'}</p> : evidence.map(entry => entry.source.kind === 'feedback' ? <label key={entry.source.eventId}><input type='checkbox' checked={selected.includes(entry.source.eventId)} onChange={event => setSelected(event.target.checked ? [...selected, entry.source.eventId] : selected.filter(id => id !== entry.source.eventId))}/>{entry.text} · event {entry.source.eventId}</label> : null)}</fieldset><label>Change reason<textarea value={reason} onChange={event => setReason(event.target.value)}/></label>
    {applied ? <button type='button' className='hima-button' disabled={busy || !reason.trim()} onClick={() => void mutation('disabled')}>Disable</button> : <button type='button' className='hima-button' disabled={busy || !reason.trim() || (item.tip.state === 'disabled' ? evidenceRefs.length === 0 : item.record.sources.length === 0)} onClick={() => void mutation(item.tip.state === 'disabled' ? 're-adopted' : 'adopted')}>{item.tip.state === 'disabled' ? 'Re-adopt with new evidence' : 'Adopt'}</button>}
    <label>Replacement text<textarea value={text} maxLength={16000} onChange={event => setText(event.target.value)} placeholder='Enter the corrected fact'/></label><label>Replacement conditions<textarea value={conditions} onChange={event => setConditions(event.target.value)}/></label><button type='button' className='hima-button' disabled={busy || !reason.trim() || !text.trim()} onClick={() => void mutation('correct')}>Correct to replacement candidate</button>
  </article>;
}
