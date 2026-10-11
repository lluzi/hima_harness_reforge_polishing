import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { AttachmentTaskRef, StagedAttachment } from '../team-attachments.js';

/** The adapter performs native DSH fileUploads.uploadStream, then Host stage. No local-path authority. */
export interface TeamMaterialOperations {
  upload(ref: AttachmentTaskRef, file: File, requestId: string, signal: AbortSignal): Promise<StagedAttachment>;
  removeDraft(ref: AttachmentTaskRef, stageId: string): Promise<void>;
  openOriginal(ref: AttachmentTaskRef, stageId: string): Promise<void>;
  readExcerpt(ref: AttachmentTaskRef, stageId: string, location: string): Promise<{ readonly text: string; readonly sha256: string }>;
}
export interface TeamMaterialPanelProps {
  readonly task: AttachmentTaskRef;
  readonly operations?: TeamMaterialOperations;
  readonly materials: readonly StagedAttachment[];
  readonly draftStageIds: readonly string[];
  onDraftChange(stageIds: readonly string[]): void;
  onStaged(material: StagedAttachment): void;
}
interface Intake { readonly id: string; readonly file: File; readonly status: 'uploading' | 'failed'; readonly error?: string }
const statusLabel = { parsed: 'Text parsed', partial: 'Partially readable', failed: 'Parsing failed; original saved', unsupported: 'Format unsupported; original saved', 'no-text': 'No extractable text; original saved' };
export function TeamMaterialPanel({ task, operations, materials, draftStageIds, onDraftChange, onStaged }: TeamMaterialPanelProps): ReactElement {
  const [intakes, setIntakes] = useState<readonly Intake[]>([]);
  const [error, setError] = useState(''); const [excerpt, setExcerpt] = useState('');
  const controllers = useRef(new Set<AbortController>());
  const taskKey = `${task.projectId}\0${task.teamId}\0${task.taskId}`;
  const currentTask = useRef(taskKey); currentTask.current = taskKey;
  const drafts = useRef(draftStageIds); drafts.current = draftStageIds;
  useEffect(() => { setIntakes([]); setError(''); setExcerpt(''); return () => { for (const controller of controllers.current) controller.abort(); controllers.current.clear(); }; }, [taskKey]);
  async function upload(file: File, id: string = crypto.randomUUID()): Promise<void> {
    if (!operations) return;
    const identity = taskKey; const controller = new AbortController(); controllers.current.add(controller);
    setIntakes(items => [...items.filter(item => item.id !== id), { id, file, status: 'uploading' }]);
    try {
      const material = await operations.upload(task, file, id, controller.signal);
      if (currentTask.current !== identity || controller.signal.aborted) return;
      onStaged(material); drafts.current = [...new Set([...drafts.current, material.stageId])]; onDraftChange(drafts.current);
      setIntakes(items => items.filter(item => item.id !== id));
    } catch (failure) {
      if (currentTask.current === identity && !controller.signal.aborted) setIntakes(items => items.map(item => item.id === id ? { ...item, status: 'failed', error: failure instanceof Error ? failure.message : 'Upload failed' } : item));
    } finally { controllers.current.delete(controller); }
  }
  async function action(work: () => Promise<void>): Promise<void> { setError(''); try { await work(); } catch (failure) { setError(failure instanceof Error ? failure.message : 'Material operation failed'); } }
  return <section aria-label='Task materials' data-hima-region='team-materials' onDragOver={event => { event.preventDefault(); }} onDrop={event => { event.preventDefault(); if (operations) for (const file of Array.from(event.dataTransfer.files)) void upload(file); }}>
    <h3>Materials</h3><p>PDF, Markdown and plain text. Saving and parsing a file do not mean a member has read it.</p>
    <label>Choose or drop documents<input type='file' multiple disabled={!operations} data-hima-control='team-material-input' onChange={event => { for (const file of Array.from(event.target.files ?? [])) void upload(file); event.target.value = ''; }}/></label>
    {!operations ? <p role='status'>Material upload is unavailable.</p> : null}
    {error ? <p role='alert'>{error}</p> : null}
    {intakes.map(item => <article key={item.id}><p>{item.file.name} · {item.status === 'uploading' ? 'Uploading and saving…' : 'Upload failed'}</p>{item.error ? <p role='alert'>{item.error}</p> : null}{item.status === 'failed' ? <button type='button' onClick={() => void upload(item.file, item.id)}>Retry upload</button> : null}</article>)}
    {materials.map(material => <article key={material.stageId} data-hima-material={material.stageId}>
      <p>{material.material.source} · {material.material.bytes} bytes</p><p role='status'>{statusLabel[material.parser.status]} · parser {material.parser.revision}</p><p>{draftStageIds.includes(material.stageId) ? 'Draft: access is granted when the message is sent.' : 'Retained material version'}</p>
      <code>{material.material.sha256}</code>{material.parser.warnings.map((warning, index) => <p key={index}>{warning}</p>)}
      <button type='button' disabled={!operations} onClick={() => void action(() => operations!.openOriginal(task, material.stageId))}>Open original</button>
      {material.parser.chunks.map(chunk => <button type='button' key={chunk.location} disabled={!operations} onClick={() => void action(async () => { const value = await operations!.readExcerpt(task, material.stageId, chunk.location); setExcerpt(`${chunk.location}\n${value.text}\nSHA256 ${value.sha256}`); })}>Read {chunk.location}</button>)}
      {draftStageIds.includes(material.stageId) ? <button type='button' disabled={!operations} onClick={() => void action(async () => { await operations!.removeDraft(task, material.stageId); drafts.current = drafts.current.filter(id => id !== material.stageId); onDraftChange(drafts.current); })}>Remove from draft</button> : null}
    </article>)}
    {excerpt ? <pre aria-label='Material excerpt'>{excerpt}</pre> : null}
  </section>;
}
