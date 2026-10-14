import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { TeamDefinition, TeamDefinitionRef, TeamTaskView, TeamView } from '../team-contract.js';
import type { TaskRef, SendTeamMessageRequest, TeamMessageSendResult, TeamMessagesPage, TeamActivityPage, PendingTeamRequestsPage, TeamReadPage } from '../team-messages.js';
import type { TeamHumanRequest, TeamHumanResponse } from '../flow-workflow.js';
import type { TeamDefinitionVersionsPage, TeamDefinitionVersionsReadPage } from '../team.js';
import type { JsonValue } from '../task-contract.js';

interface TeamTaskControlIdentity extends TaskRef {
  readonly requestId: string;
  readonly expectedRunId: string; readonly expectedEpoch: number; readonly expectedRevision: number;
}
export type TeamTaskControlRequest = TeamTaskControlIdentity & (
  | { readonly action: 'pause' | 'continue' | 'cancel' }
  | { readonly action: 'resume'; readonly definitionVersion?: number }
  | { readonly action: 'applyDefinition'; readonly definitionVersion: number }
);
export interface TeamTaskControlView extends TeamTaskView {
  readonly humanRequests?: readonly TeamHumanRequest[];
  readonly resumeGate?: { readonly allowed: boolean; readonly reason?: string };
  readonly campaign?: { readonly runId: string; readonly nodeId: string };
}

export interface TeamTaskOperations {
  readDefinitionVersions?(ref: TaskRef, page: TeamDefinitionVersionsReadPage, signal?: AbortSignal): Promise<TeamDefinitionVersionsPage>;
  readDefinition?(ref: TaskRef, version: number, signal?: AbortSignal): Promise<TeamView>;
  send(request: SendTeamMessageRequest, signal?: AbortSignal): Promise<TeamMessageSendResult>;
  readMessages(ref: TaskRef, page: TeamReadPage, signal?: AbortSignal): Promise<TeamMessagesPage>;
  readActivity(ref: TaskRef, page: TeamReadPage, signal?: AbortSignal): Promise<TeamActivityPage>;
  readPendingRequests(ref: TaskRef, page: TeamReadPage, signal?: AbortSignal): Promise<PendingTeamRequestsPage>;
  readTask?(ref: TaskRef, signal?: AbortSignal): Promise<TeamTaskControlView>;
  control?(request: TeamTaskControlRequest, signal?: AbortSignal): Promise<TeamTaskControlView>;
  respond?(ref: TaskRef, response: TeamHumanResponse, signal?: AbortSignal): Promise<TeamTaskControlView>;
}
export interface TeamMessageDraft { text: string; recipientMemberIds: string[]; stagedAttachmentIds: string[]; kind?: 'requirement' | 'question' | 'handoff' | 'review'; replyToMessageId?: string; requestId?: string; fingerprint?: string }
export interface TeamTaskPanelProps {
  readonly task: TeamTaskControlView; readonly members: TeamDefinition['members']; readonly operations?: TeamTaskOperations;
  /** Parent retains this map across navigation/unmount; draft editing never controls execution. */
  readonly drafts?: Map<string, TeamMessageDraft>;
  readonly stagedAttachmentIds?: readonly string[];
  readonly onMember?: (memberId: string) => void;
  readonly onSent?: (sent: TeamMessageSendResult) => void;
  readonly onTaskChanged?: (task: TeamTaskControlView) => void;
  readonly onCampaign?: (campaign: { readonly runId: string; readonly nodeId: string }) => void;
}
const keyFor = (ref: TaskRef): string => JSON.stringify([ref.projectId, ref.teamId, ref.taskId]);
const blank = (): TeamMessageDraft => ({ text: '', recipientMemberIds: [], stagedAttachmentIds: [] });
const sameRef = (value: TaskRef, ref: TaskRef): boolean => value.projectId === ref.projectId && value.teamId === ref.teamId && value.taskId === ref.taskId;
function latestTaskObservation(current: TeamTaskControlView, next: TeamTaskControlView): TeamTaskControlView {
  if (current.taskId !== next.taskId || current.projectId !== next.projectId || current.team.teamId !== next.team.teamId) return next;
  if (current.currentRunId !== next.currentRunId) return next.runIds.length > current.runIds.length
    && current.runIds.every((id, index) => next.runIds[index] === id) && next.runIds.at(-1) === next.currentRunId ? next : current;
  return current.execution && next.execution && (current.execution.epoch > next.execution.epoch
    || current.execution.epoch === next.execution.epoch && current.execution.revision > next.execution.revision) ? current : next;
}
export function TeamTaskPanel({ task: sourceTask, members, operations, drafts, stagedAttachmentIds, onMember, onSent, onTaskChanged, onCampaign }: TeamTaskPanelProps): ReactElement {
  const [task, setTask] = useState(sourceTask);
  const localDrafts = useRef(new Map<string, TeamMessageDraft>());
  const retained = drafts ?? localDrafts.current;
  const ref: TaskRef = { projectId: sourceTask.projectId, teamId: sourceTask.team.teamId, taskId: sourceTask.taskId };
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
  const [controlling, setControlling] = useState(false);
  const [versionPage, setVersionPage] = useState<TeamDefinitionVersionsPage>();
  const [versionCursor, setVersionCursor] = useState<number>();
  const [selectedRef, setSelectedRef] = useState<TeamDefinitionRef>();
  const [selectedDefinition, setSelectedDefinition] = useState<TeamView>();
  const [frozenDefinition, setFrozenDefinition] = useState<TeamView>();
  const [versionError, setVersionError] = useState<string>();
  const [frozenError, setFrozenError] = useState<string>();
  const [selectedError, setSelectedError] = useState<string>();
  const [deadlineExpired, setDeadlineExpired] = useState(() => Date.parse(sourceTask.deadlineAt) <= Date.now());
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const controlRequests = useRef(new Map<string, string>());
  const controlController = useRef<AbortController>();
  const currentKey = useRef(key); currentKey.current = key;
  const sendController = useRef<AbortController>();
  const updateDraft = (next: TeamMessageDraft) => { retained.set(key, next); setDraft(next); };
  useEffect(() => {
    setTask(previous => latestTaskObservation(previous, sourceTask));
  }, [sourceTask]);
  useEffect(() => {
    setDraft(retained.get(key) ?? blank()); setMessages(undefined); setActivity(undefined); setPending(undefined);
    setError(undefined); setNotice(undefined); setCursor(undefined); setActivityCursor(undefined); setPendingCursor(undefined); setSending(false);
    setControlling(false); setAnswers({}); setVersionPage(undefined); setVersionCursor(undefined);
    setSelectedRef(undefined); setSelectedDefinition(undefined); setFrozenDefinition(undefined); setVersionError(undefined); setFrozenError(undefined); setSelectedError(undefined);
    return () => { sendController.current?.abort(); controlController.current?.abort(); };
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
    void Promise.all([operations.readMessages(ref, page, controller.signal), operations.readActivity(ref, { limit: 50, ...(activityCursor === undefined ? {} : { cursor: activityCursor }) }, controller.signal), operations.readPendingRequests(ref, { limit: 50, ...(pendingCursor === undefined ? {} : { cursor: pendingCursor }) }, controller.signal), operations.readTask?.(ref, controller.signal)])
      .then(([messagePage, activityPage, pendingPage, currentTask]) => {
        if (controller.signal.aborted) return;
        if (messagePage.messages.some(value => !sameRef(value, ref)) || !sameRef(activityPage, ref) || !sameRef(pendingPage, ref)) throw new Error('The Host returned a different task identity.');
        setMessages(messagePage); setActivity(activityPage); setPending(pendingPage); setError(undefined);
        if (currentTask) {
          if (!sameRef({ ...currentTask, teamId: currentTask.team.teamId }, ref)) throw new Error('The Host returned a different task identity.');
          setTask(previous => latestTaskObservation(previous, currentTask)); onTaskChanged?.(currentTask);
        }
      }).catch(caught => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : String(caught)); });
    return () => controller.abort();
  }, [key, operations, refresh, cursor, activityCursor, pendingCursor]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const checkDeadline = () => {
      const remaining = Date.parse(task.deadlineAt) - Date.now();
      setDeadlineExpired(!Number.isFinite(remaining) || remaining <= 0);
      if (Number.isFinite(remaining) && remaining > 0) timer = setTimeout(checkDeadline, Math.min(remaining, 2_147_483_647));
    };
    checkDeadline();
    return () => { if (timer !== undefined) clearTimeout(timer); };
  }, [key, task.deadlineAt, refresh]);
  useEffect(() => {
    if (!operations?.readDefinitionVersions) return;
    const controller = new AbortController();
    void operations.readDefinitionVersions(ref, { limit: 20, ...(versionCursor === undefined ? {} : { cursor: versionCursor }) }, controller.signal)
      .then(page => {
        if (controller.signal.aborted) return;
        if (page.projectId !== ref.projectId || page.teamId !== ref.teamId || page.versions.some(version => version.teamId !== ref.teamId)) throw new Error('The Host returned a different definition inventory.');
        setVersionPage(page); setVersionError(undefined);
      }).catch(caught => { if (!controller.signal.aborted) setVersionError(caught instanceof Error ? caught.message : String(caught)); });
    return () => controller.abort();
  }, [key, operations, versionCursor, refresh]);
  useEffect(() => {
    if (!operations?.readDefinition) return;
    const controller = new AbortController();
    setFrozenDefinition(undefined);
    void operations.readDefinition(ref, task.team.version, controller.signal).then(view => {
      if (controller.signal.aborted) return;
      if (view.projectId !== ref.projectId || view.teamId !== task.team.teamId || view.version !== task.team.version || view.sha256 !== task.team.sha256) throw new Error('The Host returned a different frozen definition.');
      setFrozenDefinition(view); setFrozenError(undefined);
      const latest = retained.get(key) ?? blank();
      const ids = new Set(view.definition.members.map(member => member.id));
      const recipients = latest.recipientMemberIds.filter(id => ids.has(id));
      if (recipients.length !== latest.recipientMemberIds.length) {
        const next = { ...latest, recipientMemberIds: recipients }; retained.set(key, next); setDraft(next);
      }
    }).catch(caught => { if (!controller.signal.aborted) setFrozenError(caught instanceof Error ? caught.message : String(caught)); });
    return () => controller.abort();
  }, [key, operations, task.team.teamId, task.team.version, task.team.sha256, retained]);
  useEffect(() => {
    setSelectedDefinition(undefined); setSelectedError(undefined);
    if (!selectedRef || !operations?.readDefinition) return;
    const controller = new AbortController();
    void operations.readDefinition(ref, selectedRef.version, controller.signal).then(view => {
      if (controller.signal.aborted) return;
      if (view.projectId !== ref.projectId || view.teamId !== selectedRef.teamId || view.version !== selectedRef.version || view.sha256 !== selectedRef.sha256) throw new Error('The Host returned a different selected saved definition.');
      setSelectedDefinition(view); setSelectedError(undefined);
    }).catch(caught => { if (!controller.signal.aborted) setSelectedError(caught instanceof Error ? caught.message : String(caught)); });
    return () => controller.abort();
  }, [key, operations, selectedRef]);
  useEffect(() => {
    if (task.definitionHandoff?.state !== 'closing' || !operations?.readTask) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const next = await operations.readTask!(ref, controller.signal);
        if (controller.signal.aborted) return;
        if (!sameRef({ ...next, teamId: next.team.teamId }, ref)) throw new Error('The Host returned a different task identity.');
        setTask(previous => latestTaskObservation(previous, next)); onTaskChanged?.(next);
        if (next.definitionHandoff?.state !== 'closing') return;
      } catch (caught) {
        if (controller.signal.aborted) return;
        setError(caught instanceof Error ? caught.message : String(caught));
      }
      timer = setTimeout(() => void poll(), 1000);
    };
    timer = setTimeout(() => void poll(), 1000);
    return () => { controller.abort(); if (timer !== undefined) clearTimeout(timer); };
  }, [key, operations, task.definitionHandoff?.requestId, task.definitionHandoff?.state]);
  const terminal = task.execution !== undefined && ['succeeded', 'failed', 'cancelled'].includes(task.execution.state);
  const selectedReady = selectedRef !== undefined && selectedDefinition !== undefined
    && selectedDefinition.version === selectedRef.version && selectedDefinition.sha256 === selectedRef.sha256;
  const applyBlocked = !operations?.control || !operations.readTask || !operations.readDefinitionVersions || !operations.readDefinition ? 'Saved-version controls are unavailable on this Host.'
    : !task.execution ? 'Execution observation is unavailable.' : terminal ? 'The task is terminal.'
    : task.execution.cancellationRequested ? 'The task is stopping.' : deadlineExpired ? 'The task deadline has expired.'
    : task.definitionHandoff && task.definitionHandoff.state !== 'adopted' ? task.definitionHandoff.reason ?? 'A saved-definition handoff is already retained.'
    : !task.applyDefinitionGate?.allowed ? task.applyDefinitionGate?.reason ?? 'The Host has not allowed a saved-definition handoff.'
    : !selectedReady ? 'Select and review a saved version.' : selectedRef!.version === task.team.version ? 'This saved version is already frozen for the task.' : undefined;
  const frozenReady = frozenDefinition !== undefined && frozenDefinition.version === task.team.version && frozenDefinition.sha256 === task.team.sha256;
  const currentMembers = operations?.readDefinition ? (frozenReady ? frozenDefinition!.definition.members : []) : members;
  const acceptControlView = (next: TeamTaskControlView): void => {
    if (!sameRef({ ...next, teamId: next.team.teamId }, ref)) throw new Error('The Host returned a different task identity.');
    setTask(previous => latestTaskObservation(previous, next)); onTaskChanged?.(next); setRefresh(value => value + 1);
  };
  const performControl = async (action: TeamTaskControlRequest['action']) => {
    if (!operations?.control || controlling || !task.execution) return;
    if (action === 'applyDefinition' && (applyBlocked || Date.parse(task.deadlineAt) <= Date.now())) return;
    if (action === 'continue' && task.definitionHandoff?.state !== undefined && task.definitionHandoff.state !== 'adopted') return;
    const observed = { ...ref, expectedRunId: task.currentRunId, expectedEpoch: task.execution.epoch, expectedRevision: task.execution.revision };
    const selection = action === 'applyDefinition' ? { action, definitionVersion: selectedRef!.version }
      : action === 'resume' ? { action, ...(selectedReady ? { definitionVersion: selectedRef!.version } : {}) } : { action };
    const content = { ...observed, ...selection };
    const fingerprint = JSON.stringify(content);
    const requestId = controlRequests.current.get(fingerprint) ?? `control-${crypto.randomUUID()}`;
    controlRequests.current.set(fingerprint, requestId);
    const controller = new AbortController(); controlController.current = controller; setControlling(true); setError(undefined);
    try {
      const next = await operations.control({ ...content, requestId }, controller.signal);
      if (!controller.signal.aborted && currentKey.current === key) { acceptControlView(next); setNotice('Control retained. Resource state reflects the Host observation.'); }
    } catch (caught) { if (!controller.signal.aborted && currentKey.current === key) setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { if (!controller.signal.aborted && currentKey.current === key) setControlling(false); }
  };
  const respond = async (request: TeamHumanRequest) => {
    if (!operations?.respond || controlling) return;
    const controller = new AbortController(); controlController.current = controller;
    setControlling(true); setError(undefined);
    try {
      const value = JSON.parse(answers[request.binding.requestId] ?? '') as JsonValue;
      const next = await operations.respond(ref, { requestId: request.binding.requestId, binding: request.binding,
        output: { schemaVersion: request.output.version, value, artifacts: [], diagnostics: [] } }, controller.signal);
      if (!controller.signal.aborted && currentKey.current === key) { acceptControlView(next); setNotice('Answer accepted by the Host.'); }
    } catch (caught) { if (!controller.signal.aborted && currentKey.current === key) setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { if (!controller.signal.aborted && currentKey.current === key) setControlling(false); }
  };
  const send = async () => {
    if (operations === undefined || sending || draft.recipientMemberIds.some(id => !currentMembers.some(member => member.id === id))) return;
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
    {task.execution ? <section aria-label='Task controls'><p>{task.execution.state} · resources {task.execution.resourceState}{task.execution.reason ? ` · ${task.execution.reason}` : ''}</p>
      <p className='hima-small'>Current run {task.currentRunId} · generation {task.execution.epoch} · revision {task.execution.revision}</p>
      {(task.allowedActions ?? []).filter(action => action !== 'continue' || !task.definitionHandoff || task.definitionHandoff.state === 'adopted').map(action => <button key={action} type='button' className='hima-button' data-hima-control={`team-${action}`} disabled={!operations?.control || controlling} onClick={() => void performControl(action)}>{action === 'cancel' ? 'Stop task' : action === 'continue' ? 'Continue task' : 'Pause task'}</button>)}
      {task.resumeGate ? <><p>{task.resumeGate.reason ?? 'This task requires explicit continuation after exit.'}</p><button type='button' className='hima-button' data-hima-control='team-resume' disabled={!operations?.control || controlling || !task.resumeGate.allowed || (selectedRef !== undefined && !selectedReady)} onClick={() => void performControl('resume')}>Resume retained task</button></> : null}
    </section> : null}
    <section aria-label='Saved team definition'>
      <h4>Saved team definition</h4>
      <p>Current frozen version {task.team.version} · {task.team.sha256}</p>
      {frozenReady ? <p>{frozenDefinition!.definition.delivery.description}</p> : null}
      <label>Saved version<select data-hima-control='team-definition-version' value={selectedRef?.version ?? ''} disabled={!operations?.readDefinitionVersions || controlling} onChange={event => {
        const next = versionPage?.versions.find(version => version.version === Number(event.target.value));
        setSelectedRef(next); setSelectedDefinition(undefined);
      }}><option value=''>Choose a saved version</option>
        {selectedRef && !versionPage?.versions.some(version => version.version === selectedRef.version) ? <option value={selectedRef.version}>Version {selectedRef.version} (selected)</option> : null}
        {versionPage?.versions.map(version => <option key={version.version} value={version.version}>Version {version.version} · {version.title}</option>)}
      </select></label>
      {versionPage?.nextCursor !== undefined ? <button type='button' className='hima-button' disabled={controlling} onClick={() => setVersionCursor(versionPage.nextCursor)}>Next saved-version page</button> : null}
      {versionCursor !== undefined ? <button type='button' className='hima-button' disabled={controlling} onClick={() => setVersionCursor(undefined)}>First saved-version page</button> : null}
      {selectedRef && !selectedReady ? <p>Loading selected saved version…</p> : null}
      {task.resumeGate ? <p>Resume uses the reviewed selected version, or the current frozen version when no version is selected.</p> : null}
      {selectedReady ? <><p>Selected saved version {selectedDefinition!.version} · {selectedDefinition!.sha256}</p><p>{selectedDefinition!.definition.delivery.description}</p><details><summary>Selected delivery format</summary><pre className='hima-team-value'>{JSON.stringify(selectedDefinition!.definition.delivery.output, null, 2)}</pre></details></> : null}
      {[versionError, frozenError, selectedError].filter(Boolean).map((message, index) => <p key={index} role='alert'>{message}</p>)}
      {applyBlocked ? <p>{applyBlocked}</p> : null}
      <button type='button' className='hima-button' data-hima-control='team-apply-definition' disabled={controlling || applyBlocked !== undefined} onClick={() => void performControl('applyDefinition')}>Apply saved version to this task</button>
      {task.definitionHandoff ? <p role='status' data-hima-definition-handoff={task.definitionHandoff.state}>Saved version {task.definitionHandoff.selected.version}: {task.definitionHandoff.state}{task.definitionHandoff.reason ? ` · ${task.definitionHandoff.reason}` : ''}{task.definitionHandoff.successorRunId ? ` · successor ${task.definitionHandoff.successorRunId}` : ''}</p> : null}
    </section>
    {task.campaign && onCampaign ? <button type='button' className='hima-button' data-hima-control='team-return-campaign' onClick={() => onCampaign(task.campaign!)}>Return to Campaign</button> : null}
    {!operations ? <p role='status'>Task communication is unavailable on this Host. Draft is retained.</p> : null}
    {error ? <p role='alert'>{error} Draft is retained; retrying unchanged content uses the same request.</p> : null}{notice ? <p role='status'>{notice}</p> : null}
    <fieldset><legend>Recipients from the frozen team</legend>{currentMembers.map(member => <label key={member.id}><input type='checkbox' checked={draft.recipientMemberIds.includes(member.id)} onChange={event => updateDraft({ ...draft, recipientMemberIds: event.target.checked ? [...draft.recipientMemberIds, member.id] : draft.recipientMemberIds.filter(id => id !== member.id) })}/>{member.role} · {member.id}</label>)}</fieldset>
    <label>Message kind<select value={draft.kind ?? 'requirement'} onChange={event => updateDraft({ ...draft, kind: event.target.value as TeamMessageDraft['kind'] })}><option value='requirement'>Requirement</option><option value='question'>Question</option><option value='handoff'>Handoff</option><option value='review'>Review</option></select></label>{draft.replyToMessageId ? <p>Reply to {draft.replyToMessageId}</p> : null}
    <label>Directed message<textarea data-hima-control='team-message-text' maxLength={16000} value={draft.text} onChange={event => updateDraft({ ...draft, text: event.target.value })}/></label>
    <p className='hima-small'>{draft.stagedAttachmentIds.length} staged materials. Editing this draft does not pause execution.</p>
    <button type='button' className='hima-button' data-hima-control='team-message-send' disabled={!operations || sending || draft.recipientMemberIds.length === 0 || draft.recipientMemberIds.some(id => !currentMembers.some(member => member.id === id)) || (draft.text.trim() === '' && draft.stagedAttachmentIds.length === 0)} onClick={() => void send()}>{sending ? 'Sending…' : 'Send message'}</button>
    <section aria-label='Retained task messages'>{messages?.messages.map(message => <article key={message.messageId}><h4>{message.sender.kind} · {message.sender.memberId ?? message.sender.actorId}</h4><p className='hima-small'>{message.createdAt} · {message.messageId} · Host source</p><pre className='hima-team-value'>{message.text}</pre>{message.materialRefs.map(material => <p key={material.materialId}>Material {material.materialId} · {material.state} · {material.sha256}</p>)}{messages.deliveries.filter(value => value.messageId === message.messageId).map(delivery => <p key={delivery.deliveryId} data-hima-delivery-state={delivery.state}>{delivery.recipientMemberId}: {delivery.state === 'accepted' ? 'Native received; business completion separate' : delivery.state} {delivery.reason}{delivery.target ? ` · generation ${delivery.target.generation}` : ''}</p>)}</article>)}{messages?.messages.length === 0 ? <p>No retained messages in this page.</p> : null}
      {messages?.nextCursor !== undefined ? <button type='button' className='hima-button' onClick={() => setCursor(messages.nextCursor)}>Next message page</button> : null}{cursor !== undefined ? <button type='button' className='hima-button' onClick={() => setCursor(undefined)}>First message page</button> : null}</section>
    <section aria-label='Task activity and results'><h4>Retained activity, results and dependencies</h4>{activity?.records.map(record => <article key={record.activityId}><p>{record.kind} · {record.summary}</p><p className='hima-small'>{record.createdAt}{record.effectId ? ` · ${record.effectId}` : ''}</p></article>)}{activity?.nextCursor !== undefined ? <button type='button' className='hima-button' onClick={() => setActivityCursor(activity.nextCursor)}>Next activity page</button> : null}{activityCursor !== undefined ? <button type='button' className='hima-button' onClick={() => setActivityCursor(undefined)}>First activity page</button> : null}</section>
    <section aria-label='Pending human requests'><h4>Awaiting an answer</h4>{pending?.requests.map(request => <article key={request.requestId}><p>{request.kind} · generation {request.generation}</p><pre className='hima-team-value'>{request.text}</pre><button type='button' className='hima-button' onClick={() => { updateDraft({ ...draft, recipientMemberIds: [request.memberId], replyToMessageId: request.messageId }); onMember?.(request.memberId); }}>Select asking member</button></article>)}{pending?.requests.length === 0 ? <p>No pending human requests reported by the Host in this page.</p> : null}{pending?.nextCursor !== undefined ? <button type='button' className='hima-button' onClick={() => setPendingCursor(pending.nextCursor)}>Next pending request page</button> : null}{pendingCursor !== undefined ? <button type='button' className='hima-button' onClick={() => setPendingCursor(undefined)}>First pending request page</button> : null}</section>
    {task.humanRequests?.map(request => <section key={request.binding.requestId} aria-label='Human decision'>
      <h4>Human decision</h4><p>{request.text}</p><p className='hima-small'>Expires {request.binding.expiresAt}</p>
      <details><summary>Expected answer format</summary><pre className='hima-team-value'>{JSON.stringify(request.output.schema, null, 2)}</pre></details>
      <label>Answer (JSON)<textarea value={answers[request.binding.requestId] ?? ''} onChange={event => setAnswers(previous => ({ ...previous, [request.binding.requestId]: event.target.value }))}/></label>
      <button type='button' className='hima-button' data-hima-control='team-human-respond' disabled={!operations?.respond || controlling || !answers[request.binding.requestId]?.trim()} onClick={() => void respond(request)}>Submit answer</button>
    </section>)}
  </section>;
}
