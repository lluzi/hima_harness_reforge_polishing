import { useEffect, useState } from 'react';
import type { TeamModelConfiguration, TeamModelView } from '../oar-member-process.js';
export interface TeamModelOperations {
  listModels(signal?:AbortSignal):Promise<readonly TeamModelView[]>;
  configureModel(profile:TeamModelConfiguration,signal?:AbortSignal):Promise<TeamModelView>;
}
export function TeamModelPanel({operations}:{operations?:TeamModelOperations}) {
  const [profiles,setProfiles]=useState<readonly TeamModelView[]>([]);
  const [draft,setDraft]=useState<TeamModelConfiguration>({modelRef:'',runtime:'pi',provider:'openai-completions',model:'',baseUrl:'https://api.deepseek.com/v1',apiKey:''});
  const [error,setError]=useState<string>();const [busy,setBusy]=useState(false);
  useEffect(()=>{const controller=new AbortController();void operations?.listModels(controller.signal).then(setProfiles).catch(e=>{if(!controller.signal.aborted)setError(String(e));});return()=>controller.abort();},[operations]);
  return <details data-hima-region='team-models'><summary>Member models and credentials</summary>
    <p>Default members reuse the current DeepSeek settings automatically. These profiles are optional overrides; credentials stay on this Host.</p>
    {profiles.map(profile=><p key={profile.modelRef}>{profile.modelRef} · {profile.runtime} · {profile.model} · {profile.baseUrl}</p>)}
    <form onSubmit={event=>{event.preventDefault();if(!operations)return;setBusy(true);setError(undefined);void operations.configureModel(draft).then(saved=>{setProfiles(current=>[...current.filter(row=>row.modelRef!==saved.modelRef),saved]);setDraft(current=>({...current,apiKey:''}));}).catch(e=>setError(e instanceof Error?e.message:String(e))).finally(()=>setBusy(false));}}>
      <fieldset disabled={busy||!operations}><label>Model reference<input required value={draft.modelRef} onChange={e=>setDraft({...draft,modelRef:e.target.value})}/></label>
      <label>Runtime<select value={draft.runtime} onChange={e=>setDraft({...draft,runtime:e.target.value as 'pi'|'opencode'})}><option value='pi'>Pi</option><option value='opencode'>OpenCode</option></select></label>
      <label>Model ID<input required value={draft.model} onChange={e=>setDraft({...draft,model:e.target.value})}/></label>
      <label>Model API endpoint<input required type='url' value={draft.baseUrl} onChange={e=>setDraft({...draft,baseUrl:e.target.value})}/></label>
      <label>API key<input required type='password' autoComplete='off' value={draft.apiKey} onChange={e=>setDraft({...draft,apiKey:e.target.value})}/></label>
      <button type='submit' className='hima-button'>Save member model</button></fieldset>
    </form>{error?<p role='alert'>{error}</p>:null}
  </details>;
}
