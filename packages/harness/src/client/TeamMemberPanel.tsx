import { useEffect, useState, type ReactElement } from 'react';
import type { TaskRef, TeamMemberWorkPage, TeamReadPage } from '../team-messages.js';
export interface TeamMemberOperations {
  readMemberWork(ref: TaskRef, memberId: string, page: TeamReadPage, signal?: AbortSignal): Promise<TeamMemberWorkPage>;
}
export interface TeamMemberPanelProps { readonly taskRef: TaskRef; readonly memberId: string; readonly role: string; readonly operations?: TeamMemberOperations }
export function TeamMemberPanel({ taskRef, memberId, role, operations }: TeamMemberPanelProps): ReactElement {
  const [work, setWork] = useState<TeamMemberWorkPage>();
  const [error, setError] = useState<string>();
  const [cursor, setCursor] = useState<number>();
  const [refresh, setRefresh] = useState(0);
  const key = JSON.stringify([taskRef.projectId, taskRef.teamId, taskRef.taskId, memberId]);
  useEffect(() => { setWork(undefined); setError(undefined); setCursor(undefined); }, [key]);
  useEffect(() => {
    if (operations === undefined) return;
    const controller = new AbortController();
    void operations.readMemberWork(taskRef, memberId, { limit: 50, ...(cursor === undefined ? {} : { cursor }) }, controller.signal).then(page => {
      if (controller.signal.aborted) return;
      if (page.projectId !== taskRef.projectId || page.teamId !== taskRef.teamId || page.taskId !== taskRef.taskId || page.memberId !== memberId) throw new Error('The Host returned a different member work identity.');
      setWork(page); setError(undefined);
    }).catch(caught => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : String(caught)); });
    return () => controller.abort();
  }, [key, operations, cursor, refresh]);
  return <section data-hima-region='team-member-work'><h3>{role} · {memberId}</h3>
    <button type='button' className='hima-button' disabled={!operations} onClick={() => setRefresh(value => value + 1)}>Refresh member work</button>
    {!operations ? <p role='status'>Actual member work and native trace are unavailable on this Host.</p> : null}{error ? <p role='alert'>{error}</p> : null}
    {work ? <><p role='status'>Native connection: {work.connection}. Trace: {work.trace.state}. {work.trace.reason}</p>
      <p className='hima-small'>These are retained, Host-redacted facts. A disconnected session does not erase retained work.</p>
      {work.records.map(record => <article key={record.recordId}><h4>{record.kind} · generation {record.generation ?? 'unknown'}</h4><p className='hima-small'>{record.source} · Run {record.runId} · effect {record.effectId}{record.sessionId ? ` · session ${record.sessionId}` : ''} · {record.createdAt ?? 'historical time unavailable'}</p>{record.redacted?<p>Credentials or local paths omitted.</p>:null}{record.truncated?<p>Bounded excerpt: input is truncated.</p>:null}<pre className='hima-team-value'>{record.text}</pre>{record.result?<><p>Retained committed result · {record.result.effectId} · {record.result.sha256}</p>{record.result.redacted?<p>Result credentials or local paths omitted.</p>:null}{record.result.truncated?<p>Bounded result excerpt: content is truncated.</p>:null}<pre className='hima-team-value'>{record.result.text}</pre></>:null}</article>)}
      {work.records.length === 0 ? <p>No retained work in this page. No transcript is inferred.</p> : null}
      {work.nextCursor !== undefined ? <button type='button' className='hima-button' onClick={() => setCursor(work.nextCursor)}>Next work page</button> : null}{cursor !== undefined ? <button type='button' className='hima-button' onClick={() => setCursor(undefined)}>First work page</button> : null}
    </> : null}
  </section>;
}
