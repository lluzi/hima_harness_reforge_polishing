import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import type { RunView } from '../remote.js';
import { controlDelegation, fetchDelegations, type DelegationActionRequest, type DelegationEntry } from './api.js';
import { delegationActionRequest } from './workbench-state.js';

export interface TeamPanelProps {
  readonly sessionId: string;
  readonly runId: string;
  readonly view?: RunView;
  onChanged(): void;
  onInspect(entry: DelegationEntry): void;
}

export function TeamPanel({ sessionId, runId, view, onChanged, onInspect }: TeamPanelProps): ReactElement {
  const [delegations, setDelegations] = useState<readonly DelegationEntry[]>([]);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [refreshToken, setRefreshToken] = useState(0);
  const controller = useRef<AbortController>();
  const refresh = useCallback(() => setRefreshToken(value => value + 1), []);

  useEffect(() => {
    controller.current?.abort();
    const own = new AbortController(); controller.current = own;
    setLoading(true); setError(undefined);
    void fetchDelegations(sessionId, runId, own.signal).then(result => {
      if (own.signal.aborted) return;
      setLoading(false);
      if (result.ok) setDelegations(result.value.delegations);
      else setError(result.error.message);
    });
    return () => own.abort();
  }, [sessionId, runId, refreshToken, view?.run.control?.revision]);

  const changed = () => { refresh(); onChanged(); };
  return <section className='hima-team-panel' data-hima-region='agent-team'>
    <header><span className='hima-studio-eyebrow'>AGENT TEAM</span><button type='button' className='hima-button' onClick={refresh}>Refresh team</button></header>
    {error ? <p role='alert'>Team unavailable: {error}</p> : delegations.length === 0 ? <p>{loading ? 'Reading retained delegation receipts…' : 'No child task has been delegated from this Campaign.'}</p>
      : <>{loading ? <p className='hima-small' role='status'>Refreshing retained delegation receipts…</p> : null}{delegations.map(entry => <DelegationCard key={entry.delegationId} sessionId={sessionId} runId={runId} view={view} entry={entry} onChanged={changed} onInspect={() => onInspect(entry)}/>)}</>}
  </section>;
}

function DelegationCard({ sessionId, runId, view, entry, onChanged, onInspect }: { readonly sessionId: string; readonly runId: string; readonly view?: RunView; readonly entry: DelegationEntry; onChanged(): void; onInspect(): void }): ReactElement {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState<DelegationActionRequest['action']>();
  const [status, setStatus] = useState<string>();
  const [resultLines, setResultLines] = useState<readonly string[]>([]);
  const [resultUnknowns, setResultUnknowns] = useState<readonly string[]>([]);
  const pending = useRef<AbortController>();
  useEffect(() => () => pending.current?.abort(), []);
  const control = view?.run.control;
  const followupAvailable = control !== undefined && view?.run.status === 'running' && !control.stop
    && control.paused.length === 0 && ['accepted', 'completed'].includes(entry.status)
    && entry.followups < entry.effective.budgetShare.maxFollowups
    && Date.now() < Date.parse(entry.reservation.deadlineAt);
  const act = async (action: DelegationActionRequest['action']) => {
    if (control === undefined || busy !== undefined) return;
    let request;
    try { request = delegationActionRequest({ sessionId, runId, control, delegationId: entry.delegationId, action, ...(action === 'followup' ? { text: draft } : {}), requestId: `ui-${crypto.randomUUID()}` }); }
    catch (caught) { setStatus((caught as Error).message); return; }
    pending.current?.abort(); const own = new AbortController(); pending.current = own;
    setBusy(action); setStatus(undefined);
    const result = await controlDelegation(request, own.signal);
    if (own.signal.aborted) return;
    setBusy(undefined);
    if (!result.ok) { setStatus(result.error.message); return; }
    if (action === 'followup') setDraft('');
    const value = result.value;
    const resultStatus = value.status;
    const reason = 'reason' in value ? value.reason : undefined;
    setStatus(`${action === 'followup' ? 'Follow-up delivery' : action === 'cancel' ? 'Cancel request' : 'Result check'}: ${resultStatus}${reason ? ` · ${reason}` : ''}`);
    setResultUnknowns(value.unknowns);
    if (action === 'result') {
      if ('output' in value && value.output) {
        setResultLines(value.output.map(block => block.type === 'text' ? block.text : `Native ${block.type} output is retained in the child transcript.`));
      } else if ('transcript' in value && value.transcript.availability === 'available' && value.transcript.lastAssistantText) {
        setResultLines([value.transcript.lastAssistantText]);
      } else setResultLines([]);
    }
    onChanged();
  };
  return <article className='hima-team-card'>
    <header><strong>{entry.contract.task}</strong><span>{entry.status}</span></header>
    <p className='hima-small'>{entry.contract.role} · child {entry.childSessionId} · parent {entry.parentSessionId}</p>
    <details><summary>Requested and effective scope</summary>
      <p className='hima-small'>Requested tools: {entry.requested.allowedTools.join(', ') || 'none'}</p>
      <p className='hima-small'>Effective tools: {entry.effective.tools.join(', ') || 'none'}</p>
      <p className='hima-small'>Read root: {entry.effective.readScope?.root ?? 'Explicit granted inputs only'}</p>
      <p className='hima-small'>Write root: {entry.effective.writeScope?.root ?? 'read-only'}</p>
      <p className='hima-small'>Deadline: {entry.reservation.deadlineAt} · follow-ups {entry.followups}/{entry.effective.budgetShare.maxFollowups}</p>
      {entry.unknowns.map((unknown, index) => <p className='hima-memory-warning' key={`${String(index)}:${unknown}`}>{unknown}</p>)}
    </details>
    {entry.stopObserved==='unknown'?<p className='hima-memory-warning'>Stop requested; actual native stop is not confirmed.</p>:entry.stopObserved===true?<p className='hima-small'>Native stop confirmed.</p>:null}
    {entry.evidence?<details><summary>Candidate evidence observed in the retained result</summary>{entry.evidence.artifactRefs.map(item=><p key={item.toolCallId}>{item.path} · {item.sha256} · {item.bytes} bytes</p>)}{entry.evidence.diffRefs.map(item=><p key={item.toolCallId}>Recorded edit: {item.path} · {item.hunks} hunks</p>)}{entry.evidence.testRefs.map(item=><p key={item.toolCallId}>Tool-observed test: {item.name} · {item.status}</p>)}{entry.evidence.limitations.map(item=><p key={item}>{item}</p>)}</details>:null}
    <div className='hima-team-actions'><button type='button' className='hima-button' onClick={onInspect}>Inspect transcript</button><button type='button' className='hima-button' disabled={control === undefined || busy !== undefined} onClick={() => void act('result')}>Read result</button><button type='button' className='hima-button' disabled={control === undefined || busy !== undefined || ['completed','cancelled','expired'].includes(entry.status)} onClick={() => void act('cancel')}>Request cancel</button></div>
    <label>Follow up with {entry.childSessionId}<textarea value={draft} onChange={event => setDraft(event.target.value)} placeholder='Message the exact child task'/></label>
    <button type='button' className='hima-button' disabled={!followupAvailable || busy !== undefined || draft.trim() === ''} onClick={() => void act('followup')}>{busy === 'followup' ? 'Sending…' : 'Send follow-up'}</button>
    {control === undefined ? <p className='hima-small'>This retained task is read-only because the Campaign has no current owner control.</p> : null}
    {status ? <p role='status'>{status}</p> : null}
    {resultLines.length === 0 ? null : <section className='hima-delegation-result'><h4>Candidate child result</h4>{resultLines.map((line, index) => <pre key={`${String(index)}:${line.slice(0, 40)}`}>{line}</pre>)}</section>}
    {resultUnknowns.map((unknown, index) => <p className='hima-memory-warning' key={`${String(index)}:${unknown}`}>Unknown: {unknown}</p>)}
  </article>;
}
