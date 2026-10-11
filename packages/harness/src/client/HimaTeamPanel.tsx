import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { TeamDefinition, TeamTaskRequest, TeamTaskView, TeamView } from '../team-contract.js';
import type { WorkbenchAddress } from './workbench-address.js';

type TeamAddress = Extract<WorkbenchAddress, { kind: 'team' }>;
type ReadRequest = { readonly teamId: string; readonly version?: number };
/** Operations are bound to the authenticated project by the Host API adapter, never by member/session fields. */
export interface HimaTeamOperations {
  readonly projectId: string;
  list(signal?: AbortSignal): Promise<readonly TeamView[]>;
  read(request: ReadRequest, signal?: AbortSignal): Promise<TeamView>;
  save(request: { readonly teamId?: string; readonly definition: TeamDefinition; readonly expectedVersion: number | null }, signal?: AbortSignal): Promise<TeamView>;
  clone(request: ReadRequest & { readonly title?: string }, signal?: AbortSignal): Promise<TeamView>;
  export(request: ReadRequest, signal?: AbortSignal): Promise<TeamDefinition>;
  startTask(request: TeamTaskRequest, signal?: AbortSignal): Promise<TeamTaskView>;
  listTasks?(request: { readonly teamId: string }, signal?: AbortSignal): Promise<readonly TeamTaskView[]>;
  control?(request: { readonly teamId: string; readonly taskId: string; readonly request: { readonly requestId: string; readonly action: 'pause' | 'continue' | 'cancel'; readonly expectedEpoch: number; readonly expectedRevision: number } }, signal?: AbortSignal): Promise<TeamTaskView>;
  readTask?(request: { readonly teamId: string; readonly taskId: string }, signal?: AbortSignal): Promise<TeamTaskView>;
}
export interface HimaTeamPanelProps {
  readonly address: TeamAddress;
  readonly operations?: HimaTeamOperations;
  onAddress(address: TeamAddress): void;
}

const newMember = (): TeamDefinition['members'][number] => ({ id: `member-${crypto.randomUUID()}`, role: 'Team lead', runtime: 'pi', modelRef: 'default', skills: [], instructions: '', toolRefs: [], knowledgeRefs: [] });
const emptyDefinition = (): TeamDefinition => {
  const member = newMember();
  return { schema: 'hima-team-definition/1', title: 'New team', members: [member], leaderMemberId: member.id, collaboration: '', delivery: { description: 'Return the agreed deliverable and evidence.', output: { version: 'result/1', schema: { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object' } } } };
};
const errorText = (caught: unknown): string => caught instanceof Error ? caught.message : String(caught);
const references = (value: string): string[] => value.split(',').map(item => item.trim()).filter(Boolean);

export function HimaTeamPanel({ address, operations, onAddress }: HimaTeamPanelProps): ReactElement {
  const [teams, setTeams] = useState<readonly TeamView[]>([]);
  const [view, setView] = useState<TeamView>();
  const [draft, setDraft] = useState<TeamDefinition>(emptyDefinition);
  const [outputSchema, setOutputSchema] = useState(() => JSON.stringify(emptyDefinition().delivery.output, null, 2));
  const [tasks, setTasks] = useState<readonly TeamTaskView[]>([]);
  const [task, setTask] = useState<TeamTaskView>();
  const [exported, setExported] = useState<string>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [goal, setGoal] = useState('');
  const [input, setInput] = useState('{}');
  const [deadline, setDeadline] = useState('');
  const [closure, setClosure] = useState('');
  const pending = useRef<AbortController>();
  const requestIdentity = useRef<string>();
  const editor = useRef(new Map<string, { view?: TeamView; draft: TeamDefinition; outputSchema: string; goal: string; input: string; deadline: string; closure: string }>());
  const editorKey = `${operations?.projectId ?? ''}/${address.teamId ?? ''}`;
  const latestEditor = useRef({ view, draft, outputSchema, goal, input, deadline, closure });
  latestEditor.current = { view, draft, outputSchema, goal, input, deadline, closure };
  useEffect(() => () => {
    if (address.taskId === undefined) editor.current.set(editorKey, latestEditor.current);
  }, [editorKey, address.taskId]);
  const validateTask = (value: TeamTaskView, taskId?: string) => {
    if (value.projectId !== operations?.projectId || value.team.teamId !== address.teamId || (taskId !== undefined && value.taskId !== taskId)) throw new Error('The Host returned a different task identity.');
  };
  const choose = (value: TeamView) => {
    setView(value); setDraft(value.definition); setOutputSchema(JSON.stringify(value.definition.delivery.output, null, 2));
  };

  useEffect(() => {
    pending.current?.abort();
    const own = new AbortController(); pending.current = own;
    setError(undefined); setNotice(undefined); setExported(undefined); setTask(undefined); setTasks([]); setView(undefined);
    requestIdentity.current = undefined;
    const blank = emptyDefinition(); setDraft(blank); setOutputSchema(JSON.stringify(blank.delivery.output, null, 2));
    setGoal(''); setInput('{}'); setDeadline(''); setClosure('');
    if (operations === undefined) { setBusy(false); return () => own.abort(); }
    setBusy(true);
    void (async () => {
      const [listed, selected] = await Promise.all([operations.list(own.signal), address.teamId === undefined ? Promise.resolve(undefined) : operations.read({ teamId: address.teamId }, own.signal)]);
      if (own.signal.aborted) return;
      if (listed.some(item => item.projectId !== operations.projectId) || (selected !== undefined && (selected.projectId !== operations.projectId || selected.teamId !== address.teamId))) throw new Error('The Host returned a different project or team identity.');
      setTeams(listed);
      const retainedEditor = address.taskId === undefined ? editor.current.get(editorKey) : undefined;
      if (retainedEditor !== undefined) { setView(retainedEditor.view); setDraft(retainedEditor.draft); setOutputSchema(retainedEditor.outputSchema); setGoal(retainedEditor.goal); setInput(retainedEditor.input); setDeadline(retainedEditor.deadline); setClosure(retainedEditor.closure); }
      else if (selected !== undefined) choose(selected);
      else { const next = emptyDefinition(); setDraft(next); setOutputSchema(JSON.stringify(next.delivery.output, null, 2)); }
      if (address.taskId !== undefined) {
        if (operations.readTask === undefined) throw new Error('Task details are unavailable on this Host. The task identity is retained in the address.');
        const retained = await operations.readTask({ teamId: address.teamId!, taskId: address.taskId }, own.signal);
        if (own.signal.aborted) return;
        if (retained.taskId !== address.taskId || retained.team.teamId !== address.teamId || retained.projectId !== operations.projectId) throw new Error('The Host returned a different task identity.');
        const frozen = retained.team.version === selected?.version ? selected : await operations.read({ teamId: retained.team.teamId, version: retained.team.version }, own.signal);
        if (own.signal.aborted) return;
        if (frozen === undefined || frozen.projectId !== operations.projectId || frozen.teamId !== retained.team.teamId || frozen.version !== retained.team.version || frozen.sha256 !== retained.team.sha256) throw new Error('The Host returned a different frozen team definition.');
        choose(frozen); setTask(retained);
      }
    })().catch(caught => { if (!own.signal.aborted) setError(errorText(caught)); }).finally(() => { if (!own.signal.aborted) setBusy(false); });
    return () => own.abort();
  }, [operations, address.teamId, address.taskId]);

  // List refresh and task polling never replace the editable definition or opening draft.
  useEffect(() => {
    if (operations === undefined) return;
    const own = new AbortController();
    void (async () => {
      const listed = await operations.list(own.signal);
      if (own.signal.aborted) return;
      if (listed.some(value => value.projectId !== operations.projectId)) throw new Error('The Host returned a different project identity.');
      setTeams(listed);
      if (address.teamId !== undefined && operations.listTasks !== undefined) {
        const retained = await operations.listTasks({ teamId: address.teamId }, own.signal);
        if (own.signal.aborted) return;
        retained.forEach(value => validateTask(value)); setTasks(retained);
      }
    })().catch(caught => { if (!own.signal.aborted) setError(errorText(caught)); });
    return () => own.abort();
  }, [operations, address.teamId, refresh, address.taskId]);

  useEffect(() => {
    if (operations?.readTask === undefined || address.teamId === undefined || address.taskId === undefined) return;
    const own = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const latest = await operations.readTask!({ teamId: address.teamId!, taskId: address.taskId! }, own.signal);
        if (own.signal.aborted) return;
        validateTask(latest, address.taskId);
        setTask(current => current?.execution !== undefined && latest.execution !== undefined && (current.execution.epoch > latest.execution.epoch || (current.execution.epoch === latest.execution.epoch && current.execution.revision > latest.execution.revision)) ? current : latest);
      } catch (caught) { if (!own.signal.aborted) setError(errorText(caught)); }
      if (!own.signal.aborted) timer = setTimeout(() => void poll(), 1500);
    };
    timer = setTimeout(() => void poll(), 1500);
    return () => { own.abort(); clearTimeout(timer); };
  }, [operations, address.teamId, address.taskId]);

  const act = async (operation: (signal: AbortSignal) => Promise<void>) => {
    if (busy || operations === undefined) return;
    pending.current?.abort(); const own = new AbortController(); pending.current = own;
    setBusy(true); setError(undefined); setNotice(undefined);
    try { await operation(own.signal); }
    catch (caught) { if (!own.signal.aborted) setError(errorText(caught)); }
    finally { if (!own.signal.aborted) setBusy(false); }
  };
  const save = () => act(async signal => {
    const definition: TeamDefinition = { ...draft, delivery: { ...draft.delivery, output: JSON.parse(outputSchema) } };
    const saved = await operations!.save({ ...(view === undefined ? {} : { teamId: view.teamId }), definition, expectedVersion: view?.version ?? null }, signal);
    if (signal.aborted) return;
    choose(saved); setTeams(current => [...current.filter(item => item.teamId !== saved.teamId), saved]);
    onAddress({ kind: 'team', teamId: saved.teamId });
    setNotice(`Saved version ${saved.version}. Existing tasks keep their frozen definition.`);
  });
  const clone = () => act(async signal => {
    if (view === undefined) return;
    const copy = await operations!.clone({ teamId: view.teamId, version: view.version }, signal);
    if (signal.aborted) return;
    choose(copy); onAddress({ kind: 'team', teamId: copy.teamId });
  });
  const exportDefinition = () => act(async signal => {
    if (view === undefined) return;
    const definition = await operations!.export({ teamId: view.teamId, version: view.version }, signal);
    if (!signal.aborted) setExported(JSON.stringify(definition, null, 2));
  });
  const start = () => act(async signal => {
    if (view === undefined) return;
    const content = { teamId: view.teamId, expectedVersion: view.version, goal, input: JSON.parse(input), deadlineAt: new Date(deadline).toISOString(), closure };
    // Retrying unchanged content preserves the opening identity after a lost response.
    const fingerprint = JSON.stringify(content);
    if (requestIdentity.current?.startsWith(`${fingerprint}\n`) !== true) requestIdentity.current = `${fingerprint}\nui-${crypto.randomUUID()}`;
    const request: TeamTaskRequest = { ...content, requestId: requestIdentity.current.slice(fingerprint.length + 1) };
    const opened = await operations!.startTask(request, signal);
    if (signal.aborted) return;
    if (opened.projectId !== operations!.projectId || opened.team.teamId !== view.teamId || opened.team.version !== view.version) throw new Error('The Host returned a different task source.');
    setTask(opened); onAddress({ kind: 'team', teamId: opened.team.teamId, taskId: opened.taskId });
  });
  const control = (action: 'pause' | 'continue' | 'cancel') => act(async signal => {
    if (task?.execution === undefined || operations?.control === undefined || !task.allowedActions?.includes(action)) return;
    const updated = await operations.control({ teamId: task.team.teamId, taskId: task.taskId, request: { requestId: `ui-${crypto.randomUUID()}`, action, expectedEpoch: task.execution.epoch, expectedRevision: task.execution.revision } }, signal);
    if (signal.aborted) return;
    validateTask(updated, task.taskId); setTask(updated);
    setNotice(`Host accepted ${action} request. Resource closure: ${updated.execution?.resourceState ?? 'unknown'}.`);
    setRefresh(value => value + 1);
  });
  const member = draft.members.find(item => item.id === address.memberId);
  const disabled = busy || operations === undefined || address.taskId !== undefined || (address.teamId !== undefined && view === undefined);
  const beginNew = () => {
    const blank = emptyDefinition(); setView(undefined); setDraft(blank); setOutputSchema(JSON.stringify(blank.delivery.output, null, 2)); setExported(undefined); setError(undefined); setNotice(undefined);
    onAddress({ kind: 'team' });
  };
  return <section className='hima-team-panel hima-memory-editor hima-fields' data-hima-region='himateam' data-hima-state-team={address.teamId ?? ''} data-hima-state-task={address.taskId ?? ''} data-hima-state-member={address.memberId ?? ''}>
    <header><h2>Teams</h2><button type='button' className='hima-button' disabled={busy || operations === undefined} onClick={beginNew}>New team</button><button type='button' className='hima-button' disabled={busy || operations === undefined} onClick={() => setRefresh(value => value + 1)}>Refresh teams</button></header>
    {operations === undefined ? <p role='status'>Team definitions are unavailable on this Host.</p> : <p className='hima-small'>Project: {operations.projectId}. Save reusable definitions; each task uses a frozen version.</p>}
    <label>Saved team<select aria-label='Saved team' disabled={busy || operations === undefined} value={address.teamId ?? ''} onChange={event => onAddress({ kind: 'team', ...(event.target.value === '' ? {} : { teamId: event.target.value }) })}><option value=''>New definition</option>{teams.map(item => <option key={item.teamId} value={item.teamId}>{item.definition.title} · v{item.version}</option>)}</select></label>
    {address.teamId === undefined ? null : <nav aria-label='Retained team tasks' data-hima-region='team-tasks'>{operations?.listTasks === undefined ? <p>Retained task discovery is unavailable on this Host.</p> : tasks.length === 0 ? <p>No retained tasks.</p> : tasks.map(item => <button type='button' className='hima-button' data-hima-control={`team-task-${item.taskId}`} key={item.taskId} onClick={() => onAddress({ kind: 'team', teamId: item.team.teamId, taskId: item.taskId })}>{item.goal} · frozen v{item.team.version} · {item.execution?.state ?? 'waiting'}</button>)}</nav>}
    {error ? <p role='alert'>{error}</p> : null}{notice ? <p role='status'>{notice}</p> : null}{busy ? <p role='status'>Reading or saving Host facts…</p> : null}
    {address.taskId === undefined ? <>
      <label>Team title<input data-hima-control='team-title' disabled={disabled} value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })}/></label>
      {draft.members.map(item => <fieldset className='hima-memory-candidates' key={item.id} disabled={disabled}><legend>{item.role || 'Member'} · {item.id}</legend>
        <label>Role<input value={item.role} onChange={event => setDraft({ ...draft, members: draft.members.map(value => value.id === item.id ? { ...value, role: event.target.value } : value) })}/></label>
        <label>Runtime<select value={item.runtime} onChange={event => setDraft({ ...draft, members: draft.members.map(value => value.id === item.id ? { ...value, runtime: event.target.value as 'pi' | 'opencode' } : value) })}><option value='pi'>Pi</option><option value='opencode'>OpenCode</option></select></label>
        <label>Model reference<input value={item.modelRef} onChange={event => setDraft({ ...draft, members: draft.members.map(value => value.id === item.id ? { ...value, modelRef: event.target.value } : value) })}/></label>
        {(['skills', 'toolRefs', 'knowledgeRefs'] as const).map(field => <label key={field}>{field} (reference IDs, comma separated)<input value={item[field].join(', ')} onChange={event => setDraft({ ...draft, members: draft.members.map(value => value.id === item.id ? { ...value, [field]: references(event.target.value) } : value) })}/></label>)}
        <label>Instructions<textarea value={item.instructions} onChange={event => setDraft({ ...draft, members: draft.members.map(value => value.id === item.id ? { ...value, instructions: event.target.value } : value) })}/></label>
        <button type='button' className='hima-button' disabled={draft.members.length === 1} onClick={() => setDraft({ ...draft, members: draft.members.filter(value => value.id !== item.id), leaderMemberId: draft.leaderMemberId === item.id ? draft.members.find(value => value.id !== item.id)!.id : draft.leaderMemberId })}>Remove member</button>
      </fieldset>)}
      <button type='button' className='hima-button' disabled={disabled} onClick={() => setDraft({ ...draft, members: [...draft.members, { ...newMember(), role: 'Member' }] })}>Add member</button>
      <label>Team leader<select disabled={disabled} value={draft.leaderMemberId} onChange={event => setDraft({ ...draft, leaderMemberId: event.target.value })}>{draft.members.map(item => <option key={item.id} value={item.id}>{item.role} · {item.id}</option>)}</select></label>
      <label>Collaboration agreement<textarea disabled={disabled} value={draft.collaboration} onChange={event => setDraft({ ...draft, collaboration: event.target.value })}/></label>
      <label>Delivery agreement<textarea disabled={disabled} value={draft.delivery.description} onChange={event => setDraft({ ...draft, delivery: { ...draft.delivery, description: event.target.value } })}/></label>
      <label>Delivery schema declaration (version and JSON schema)<textarea disabled={disabled} value={outputSchema} onChange={event => setOutputSchema(event.target.value)}/></label>
      <div className='hima-team-actions'><button type='button' className='hima-button' data-hima-control='team-save' disabled={disabled} onClick={() => void save()}>Save definition</button><button type='button' className='hima-button' data-hima-control='team-clone' disabled={disabled || view === undefined} onClick={() => void clone()}>Clone team</button><button type='button' className='hima-button' data-hima-control='team-export' disabled={disabled || view === undefined} onClick={() => void exportDefinition()}>Export definition</button></div>
      {exported ? <label>Shareable definition (local bindings and private memory excluded)<textarea readOnly value={exported}/></label> : null}
      <fieldset disabled={disabled || view === undefined}><legend>Open an independent task using saved v{view?.version ?? '—'}</legend>
        <label>Goal<textarea data-hima-control='team-goal' value={goal} onChange={event => setGoal(event.target.value)}/></label><label>Input JSON<textarea data-hima-control='team-input' value={input} onChange={event => setInput(event.target.value)}/></label>
        <label>Absolute deadline<input data-hima-control='team-deadline' type='datetime-local' value={deadline} onChange={event => setDeadline(event.target.value)}/></label><label>Closure requirement<textarea data-hima-control='team-closure' value={closure} onChange={event => setClosure(event.target.value)}/></label>
        <button type='button' className='hima-button' data-hima-control='team-start-task' disabled={goal.trim() === '' || deadline === '' || closure.trim() === ''} onClick={() => void start()}>Open controlled task</button>
      </fieldset>
    </> : <>
      <button type='button' className='hima-button' onClick={() => onAddress({ kind: 'team', teamId: address.teamId })}>Back to team definition</button>
      <h3>Task {address.taskId}</h3>{task === undefined ? null : <><p>{task.goal}</p><p className='hima-small'>Frozen v{task.team.version} · deadline {task.deadlineAt} · Run {task.currentRunId}</p><p role='status'>{task.readiness.ready ? 'Host reports task execution ready.' : `Task is not ready: ${task.readiness.missing.join(', ')}`}</p><details><summary>Task input and closure</summary><pre className='hima-team-value'>{JSON.stringify(task.input, null, 2)}</pre><p>{task.closure}</p></details>{task.execution ? <section aria-label='Task execution'><p role='status'>Execution: {task.execution.state}</p><p data-hima-region='team-resource-state'>Resources: {task.execution.resourceState}. {task.execution.cancellationRequested ? 'Stop requested; resource closure is reported separately.' : ''}</p>{task.execution.reason ? <p>{task.execution.reason}</p> : null}<div className='hima-team-actions'>{(task.allowedActions ?? []).map(action => <button type='button' className='hima-button' data-hima-control={`team-${action}`} key={action} disabled={busy || operations?.control === undefined} onClick={() => void control(action)}>{action === 'pause' ? 'Pause task' : action === 'continue' ? 'Continue task' : 'Stop task'}</button>)}</div>{task.execution.tasks.map(item => <article key={item.effectId}><h4>{item.taskId}: {item.state}</h4>{item.reason ? <p>{item.reason}</p> : null}{item.result ? <><p>Retained result · {item.effectId}</p><pre className='hima-team-value'>{JSON.stringify(item.result.value,null,2)}</pre>{item.result.artifacts.map(artifact => <p key={artifact.name}>{artifact.name} · {artifact.sha256}</p>)}</> : null}</article>)}</section> : null}</>}
      <nav aria-label='Team task members'>{draft.members.map(item => <button type='button' className='hima-button' key={item.id} onClick={() => onAddress({ ...address, memberId: item.id })}>{item.role}</button>)}</nav>
      {address.memberId === undefined ? null : member === undefined ? <p role='alert'>This member is absent from the displayed definition.</p> : <article><h3>{member.role}</h3><p>{member.id} · {member.runtime} · {member.modelRef}</p><p>Actual member execution detail is unavailable.</p></article>}
    </>}
    <fieldset disabled><legend>Capabilities awaiting Host integration</legend><button type='button'>Activate via OAR</button><button type='button'>Send member message</button><button type='button'>Attach material</button><button type='button'>Query member memory</button><button type='button'>Apply definition to running tasks</button></fieldset>
    <p className='hima-small'>OAR, message delivery, materials and member memory are unavailable here. Opening a task is not evidence of member execution or delivery.</p>
  </section>;
}
