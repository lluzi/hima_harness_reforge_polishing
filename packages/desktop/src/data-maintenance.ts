/** Native main-process maintenance. Importing this module cannot start a Host, SDK or PG. */
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ColdBackupOptions } from '@hima/harness/run-backup';

type BackupApi = typeof import('@hima/harness/run-backup');
export interface MaintenanceDialogs {
  showOpenDialog(options:{title:string;properties:['openDirectory']}):Promise<{canceled:boolean;filePaths:string[]}>;
  showSaveDialog(options:{title:string;buttonLabel:string;defaultPath?:string}):Promise<{canceled:boolean;filePath?:string}>;
  showMessageBox(options:{type:'info'|'warning'|'error'|'question';title:string;message:string;detail?:string;buttons:string[];defaultId:number;cancelId:number;noLink:boolean}):Promise<{response:number}>;
}
export type ColdMaintenanceAction = 'inspect'|'backup'|'retire'|'restore'|'qualify';
export type ColdMaintenanceResult = {state:'cancelled'}|{state:'failed';message:string}|{
  state:'inspected'|'backed-up'|'retired'|'held'|'qualified';home?:string;backup:string;manifestSha256:string;restoreTarget?:string;
};
export interface ColdMaintenanceOptions {
  home:string;dialog:MaintenanceDialogs;
  /** Desktop joins its own pending launch/stop before entering. It must serialize this call
   * against startup; the disk checks below also refuse another App's Home owner. */
  assertHostStopped:()=>Promise<void>;
  backupOptions:()=>Promise<Omit<ColdBackupOptions,'home'|'destination'>>;
  action?:ColdMaintenanceAction;
  loadApi?:()=>Promise<BackupApi>;
}
const loadBackupApi=():Promise<BackupApi>=>import('@hima/harness/run-backup');
async function optionalFile(file:string):Promise<string|undefined> {
  try {const info=await lstat(file);if(!info.isFile()||info.isSymbolicLink())throw new Error(`Inspect the original unsafe maintenance path: ${file}`);return await readFile(file,'utf8');}
  catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw error;}
}
async function stoppedHome(home:string):Promise<void> {
  const database=path.join(home,'hima/database');
  if(await optionalFile(path.join(database,'data/postmaster.pid'))!==undefined)throw new Error('PostgreSQL still has a PID receipt. Preserve this Home and finish its original shutdown before maintenance.');
  const bytes=await optionalFile(path.join(database,'host-owner/owner.json'));
  if(bytes!==undefined) {
    const owner=JSON.parse(bytes) as {pid?:number};
    if(!Number.isSafeInteger(owner.pid)||(owner.pid ?? 0)<2)throw new Error('The Host owner identity is unknown. Preserve this Home for inspection.');
    try {process.kill(owner.pid!,0);throw new Error('This Home still has a live Host owner. Quit its original App before maintenance.');}
    catch(error){if((error as NodeJS.ErrnoException).code!=='ESRCH')throw error;}
  }
}
export async function inspectRestoreCandidate(backup:string,loadApi:()=>Promise<BackupApi>=loadBackupApi) {
  const archive=await (await loadApi()).inspectColdBackup(backup);
  return {backup:archive.backup,manifestSha256:archive.manifestSha256,format:archive.manifest.format,
    platform:archive.manifest.platform,applicationVersion:archive.manifest.applicationVersion,roots:archive.manifest.roots.length,
    compatible:archive.manifest.platform===`${process.platform}-${process.arch}`,restoreState:'held' as const,sensitive:true as const};
}
let active=false;
export async function runColdMaintenance(options:ColdMaintenanceOptions):Promise<ColdMaintenanceResult> {
  if(active)throw new Error('A native data maintenance operation is already open.');
  active=true;
  const message=(type:'info'|'warning'|'error'|'question',title:string,text:string,detail:string,buttons=['OK'],cancelId=0)=>
    options.dialog.showMessageBox({type,title,message:text,detail,buttons,defaultId:cancelId,cancelId,noLink:true});
  const stopped=async()=>{await options.assertHostStopped();await stoppedHome(options.home);};
  const pick=async(title:string)=>{const selected=await options.dialog.showOpenDialog({title,properties:['openDirectory']});return selected.canceled?undefined:selected.filePaths[0];};
  const target=async(title:string,buttonLabel:string)=>{const selected=await options.dialog.showSaveDialog({title,buttonLabel});return selected.canceled?undefined:selected.filePath;};
  const load=options.loadApi??loadBackupApi;
  try {
    await stopped();
    let action=options.action;
    if(!action) {
      const selected=await message('question','Data maintenance','Choose an offline operation.',`Selected Home: ${options.home}\nNo task is resumed by maintenance.`,
        ['Inspect backup','Create backup','Final backup for transfer','Restore held','Qualify restored Home','Cancel'],5);
      action=(['inspect','backup','retire','restore','qualify'] as const)[selected.response];
      if(!action)return {state:'cancelled'};
    }
    if(action==='backup'||action==='retire') {
      const restoreTarget=action==='retire'?await target('New Home for the final transfer','Select new Home'):undefined;
      if(action==='retire'&&!restoreTarget)return {state:'cancelled'};
      const destination=await target('New backup directory (must not exist)','Create backup');
      if(!destination)return {state:'cancelled'};
      const answer=await message('warning','Complete private backup',action==='retire'?'Retire this source Home into a final backup?':'Create a complete cold backup?',
        `Source: ${options.home}\nBackup: ${destination}${restoreTarget?`\nOnly authorized restore target: ${restoreTarget}`:''}\nThe backup includes credentials, private conversations, memory and engineering materials. Protect the entire directory.`,['Continue','Cancel'],1);
      if(answer.response!==0)return {state:'cancelled'};
      await stopped();const api=await load(),base={...await options.backupOptions(),home:options.home,destination};
      const archive=restoreTarget?await api.retireSource({...base,targetHome:restoreTarget}):await api.createColdBackup(base);
      await message('info','Backup complete','The verified backup is complete.',`${archive.backup}\nManifest SHA256: ${archive.manifestSha256}${restoreTarget?`\nSource retired. Restore only into: ${restoreTarget}`:''}`);
      return {state:restoreTarget?'retired':'backed-up',backup:archive.backup,manifestSha256:archive.manifestSha256,...(restoreTarget?{restoreTarget}:{})};
    }
    const selected=await pick(action==='qualify'?'Select the final source-retired backup':'Select a complete backup directory');
    if(!selected)return {state:'cancelled'};
    const candidate=await inspectRestoreCandidate(selected,load);
    const detail=`${candidate.format}\nPlatform: ${candidate.platform}\nExecutable: ${candidate.applicationVersion}\nManifest SHA256: ${candidate.manifestSha256}\nPrivate bytes and credentials are included.`;
    if(action==='inspect') {
      await message('info','Verified backup','The retained bytes match the manifest.',`${detail}\n${candidate.compatible?'Same platform; restore still requires a new held Home and final retirement checks.':'This platform cannot restore this archive.'}`);
      return {state:'inspected',backup:candidate.backup,manifestSha256:candidate.manifestSha256};
    }
    if(!candidate.compatible)throw new Error('Restore requires the original OS and architecture. The backup was not modified.');
    const newHome=action==='qualify'?options.home:await target('New restored Home (must not exist)','Restore held');
    if(!newHome)return {state:'cancelled'};
    const answer=await message('warning',action==='qualify'?'Review final retirement':'Restore held',action==='qualify'?'Qualify this held Home against the final original cut?':'Copy this backup into a new held Home?',
      `${detail}\nTarget: ${newHome}\n${action==='qualify'?'Confirm the final source is retired and review later decisions, external effects and path conflicts. Original physical facts and surviving lineage must pass; no workflow is resumed.':'The Home remains held. No Host, service or task is started.'}`,['Continue','Cancel'],1);
    if(answer.response!==0)return {state:'cancelled'};
    await stopped();const api=await load();
    if(action==='qualify') {
      const result=await api.qualifyHeldRestore({newHome,retiredBackup:candidate.backup,harnessRoot:(await options.backupOptions()).distribution.harnessRoot});
      await message('info','Restore qualified','The final original archive passed qualification.','Open this Home explicitly when ready. Team tasks still require their recorded human continue decision.');
      return {state:'qualified',home:result.home,backup:candidate.backup,manifestSha256:result.manifestSha256};
    }
    const restored=await api.restoreColdBackup({backup:candidate.backup,newHome});
    await message('info','Restore held','The restored Home remains held.',`${restored.home}\nSelect this Home for qualification with its final source-retired backup. No business work has started.`);
    return {state:'held',home:restored.home,backup:candidate.backup,manifestSha256:restored.manifestSha256};
  }catch(error){
    const detail=error instanceof Error?error.message:String(error);
    await message('error','Maintenance incomplete','The operation did not complete.',detail);
    return {state:'failed',message:detail};
  }finally{active=false;}
}
