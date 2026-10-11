import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { TeamDefinition, TeamTaskView } from '../team-contract.js';
import type { TaskRef, SendTeamMessageRequest, TeamMessageSendResult, TeamMessagesPage, TeamActivityPage, PendingTeamRequestsPage, TeamReadPage } from '../team-messages.js';

export interface TeamTaskOperations {
  send(request: SendTeamMessageRequest, signal?: AbortSignal): Promise<TeamMessageSendResult>;
  readMessages(ref: TaskRef, page: TeamReadPage, signal?: AbortSignal): Promise<TeamMessagesPage>;
  readActivity(ref: TaskRef, page: TeamReadPage, signal?: AbortSignal): Promise<TeamActivityPage>;
  readPendingRequests(ref: TaskRef, page: TeamReadPage, signal?: AbortSignal): Promise<PendingTeamRequestsPage>;
}
export interface TeamMessageDraft { text: string; recipientMemberIds: string[]; stagedAttachmentIds: string[]; kind?: 'requirement' | 'question' | 'handoff' | 'review'; replyToMessageId?: string; requestId?: string; fingerprint?: string }
export interface TeamTaskPanelProps {
  readonly task: TeamTaskView; readonly members: TeamDefinition['members']; readonly operations?: TeamTaskOperations;
  /** Parent retains this map across navigation/unmount; draft editing never controls execution. */
  readonly drafts?: Map<string, TeamMessageDraft>;
  readonly stagedAttachmentIds?: readonly string[];
  readonly onMember?: (memberId: string) => void;
  readonly onSent?: (sent: TeamMessageSendResult) => void;
}
const keyFor = (ref: TaskRef): string => JSON.stringify([ref.projectId, ref.teamId, ref.taskId]);
const blank = (): TeamMessageDraft => ({ text: '', recipientMemberIds: [], stagedAttachmentIds: [] });
const sameRef = (value: TaskRef, ref: TaskRef): boolean => value.projectId === ref.projectId && value.teamId === ref.teamId && value.taskId === ref.taskId;
export function TeamTaskPanel({ task, members, operations, drafts, stagedAttachmentIds, onMember, onSent }: TeamTaskPanelProps): ReactElement {
  const localDrafts = useRef(new Map<string, TeamMessageDraft>());
  const retained = drafts ?? localDrafts.current;
  const ref: TaskRef = { projectId: task.projectId, teamId: task.team.teamId, taskId: task.taskId };
  const key = keyFor(ref);
  const [draft, setDraft] = useState<TeamMessageDraft>(() => retained.get(key) ?? blank());
  const [messages, setMessages] = useState<TeamMessagesPage>();
  const [activity, setActivity] = useState<TeamActivityPage>();
  const [pending, setPending] = useState<PendingTeamRequestsPage>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [sending, setSending] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [cursor, setCursor] = useState<number>();
  const [activityCursor, setActivityCursor] = useState<number>();
  const [pendingCursor, setPendingCursor] = useState<number>();
  const currentKey = useRef(key); currentKey.current = key;
  const sendController = useRef<AbortController>();
  const updateDraft = (next: TeamMessageDraft) => { retained.set(key, next); setDraft(next); };
  useEffect(() => {
    setDraft(retained.get(key) ?? blank()); setMessages(undefined); setActivity(undefined); setPending(undefined);
    setError(undefined); setNotice(undefined); setCursor(undefined); setActivityCursor(undefined); setPendingCursor(undefined); setSending(false);
    return () => sendController.current?.abort();
  }, [key, retained]);
  useEffect(() => {
    if (stagedAttachmentIds === undefined) return;
    const next = { ...(retained.get(key) ?? blank()), stagedAttachmentIds: [...stagedAttachmentIds] };
    retained.set(key, next); setDraft(next);
  }, [key, retained, stagedAttachmentIds]);
  useEffect(() => {
    if (operations === undefined) return;
    const controller = new AbortController();
    const page = { limit: 50, ...(cursor === undefined ? {} : { cursor }) };
    void Promise.all([operations.readMessages(ref, page, controller.signal), operations.readActivity(ref, { limit: 50, ...(activityCursor === undefined ? {} : { cursor: activityCursor }) }, controller.signal), operations.readPendingRequests(ref, { limit: 50, ...(pendingCursor === undefined ? {} : { cursor: pendingCursor }) }, controller.signal)])
      .then(([messagePage, activityPage, pendingPage]) => {
        if (controller.signal.aborted) return;
        if (messagePage.messages.some(value => !sameRef(value, ref)) || !sameRef(activityPage, ref) || !sameRef(pendingPage, ref)) throw new Error('The Host returned a different task identity.');
        setMessages(messagePage); setActivity(activityPage); setPending(pendingPage); setError(undefined);
      }).catch(caught => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : String(caught)); });
    return () => controller.abort();
  }, [key, operations, refresh, cursor, activityCursor, pendingCursor]);
  const send = async () => {
    if (operations === undefined || sending) return;
    const content = { ...ref, recipientMemberIds: [...draft.recipientMemberIds], text: draft.text, stagedAttachmentIds: [...draft.stagedAttachmentIds], kind: draft.kind ?? 'requirement', replyToMessageId: draft.replyToMessageId };
    const fingerprint = JSON.stringify(content);
    const saved = { ...draft, fingerprint, requestId: draft.fingerprint === fingerprint && draft.requestId ? draft.requestId : `ui-${crypto.randomUUID()}` };
    updateDraft(saved);
    const controller = new AbortController(); sendController.current = controller; setSending(true); setError(undefined);
    try {
      const sent = await operations.send({ ...content, requestId: saved.requestId }, controller.signal);
      if (controller.signal.aborted || currentKey.current !== key) return;
      if (!sameRef(sent.message, ref) || sent.message.requestId !== saved.requestId) throw new Error('The Host returned a different message identity.');
      onSent?.(sent);
      const latest = retained.get(key);
      if (latest && JSON.stringify({ ...ref, recipientMemberIds: latest.recipientMemberIds, text: latest.text, stagedAttachmentIds: latest.stagedAttachmentIds, kind: latest.kind ?? 'requirement', replyToMessageId: latest.replyToMessageId }) === fingerprint) updateDraft(blank());
      setNotice(`Message retained. ${sent.deliveries.filter(value => value.state === 'accepted').length}/${sent.deliveries.length} native receipts; business completion is separate.`);
      setRefresh(value => value + 1);
    } catch (caught) { if (!controller.signal.aborted && currentKey.current === key) setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { if (!controller.signal.aborted && currentKey.current === key) setSending(false); }
  };
  return <section className='hima-fields' data-hima-region='team-task-work'>
    <h3>Task work and communication</h3><button type='button' className='hima-button' disabled={!operations} onClick={() => setRefresh(value => value + 1)}>Refresh task work</button>
    {!operations ? <p role='status'>Task communication is unavailable on this Host. Draft is retained.</p> : null}
    {error ? <p role='alert'>{error} Draft is retained; retrying unchanged content uses the same request.</p> : null}{notice ? <p role='status'>{notice}</p> : null}
    <fieldset><legend>Recipients from the frozen team</legend>{members.map(member => <label key={member.id}><input type='checkbox' checked={draft.recipientMemberIds.includes(member.id)} onChange={event => updateDraft({ ...draft, recipientMemberIds: event.target.checked ? [...draft.recipientMemberIds, member.id] : draft.recipientMemberIds.filter(id => id !== member.id) })}/>{member.role} · {member.id}</label>)}</fieldset>
    <label>Message kind<select value={draft.kind ?? 'requirement'} onChange={event => updateDraft({ ...draft, kind: event.target.value as TeamMessageDraft['kind'] })}><option value='requirement'>Requirement</option><option value='question'>Question</option><option value='handoff'>Handoff</option><option value='review'>Review</option></select></label>{draft.replyToMessageId ? <p>Reply to {draft.replyToMessageId}</p> : null}
    <label>Directed message<textarea data-hima-control='team-message-text' maxLength={16000} value={draft.text} onChange={event => updateDraft({ ...draft, text: event.target.value })}/></label>
    <p className='hima-small'>{draft.stagedAttachmentIds.length} staged materials. Editing this draft does not pause execution.</p>
    <button type='button' className='hima-button' data-hima-control='team-message-send' disabled={!operations || sending || draft.recipientMemberIds.length === 0 || (draft.text.trim() === '' && draft.stagedAttachmentIds.length === 0)} onClick={() => void send()}>{sending ? 'Sending…' : 'Send message'}</button>
    <section aria-label='Retained task messages'>{messages?.messages.map(message => <article key={message.messageId}><h4>{message.sender.kind} · {message.sender.memberId ?? message.sender.actorId}</h4><p className='hima-small'>{message.createdAt} · {message.messageId} · Host source</p><pre className='hima-team-value'>{message.text}</pre>{message.materialRefs.map(material => <p key={material.materialId}>Material {material.materialId} · {material.state} · {material.sha256}</p>)}{messages.deliveries.filter(value => value.messageId === message.messageId).map(delivery => <p key={delivery.deliveryId} data-hima-delivery-state={delivery.state}>{delivery.recipientMemberId}: {delivery.state === 'accepted' ? 'Native received; business completion separate' : delivery.state} {delivery.reason}{delivery.target ? ` · generation ${delivery.target.generation}` : ''}</p>)}</article>)}{messages?.messages.length === 0 ? <p>No retained messages in this page.</p> : null}
      {messages?.nextCursor !== undefined ? <button type='button' className='hima-button' onClick={() => setCursor(messages.nextCursor)}>Next message page</button> : null}{cursor !== undefined ? <button type='button' className='hima-button' onClick={() => setCursor(undefined)}>First message page</button> : null}</section>
    <section aria-label='Task activity and results'><h4>Retained activity, results and dependencies</h4>{activity?.records.map(record => <article key={record.activityId}><p>{record.kind} · {record.summary}</p><p className='hima-small'>{record.createdAt}{record.effectId ? ` · ${record.effectId}` : ''}</p></article>)}{activity?.nextCursor !== undefined ? <button type='button' className='hima-button' onClick={() => setActivityCursor(activity.nextCursor)}>Next activity page</button> : null}{activityCursor !== undefined ? <button type='button' className='hima-button' onClick={() => setActivityCursor(undefined)}>First activity page</button> : null}</section>
    <section aria-label='Pending human requests'><h4>Awaiting an answer</h4>{pending?.requests.map(request => <article key={request.requestId}><p>{request.kind} · generation {request.generation}</p><pre className='hima-team-value'>{request.text}</pre><button type='button' className='hima-button' onClick={() => { updateDraft({ ...draft, recipientMemberIds: [request.memberId], replyToMessageId: request.messageId }); onMember?.(request.memberId); }}>Select asking member</button></article>)}{pending?.requests.length === 0 ? <p>No pending human requests reported by the Host in this page.</p> : null}{pending?.nextCursor !== undefined ? <button type='button' className='hima-button' onClick={() => setPendingCursor(pending.nextCursor)}>Next pending request page</button> : null}{pendingCursor !== undefined ? <button type='button' className='hima-button' onClick={() => setPendingCursor(undefined)}>First pending request page</button> : null}</section>
  </section>;
}
