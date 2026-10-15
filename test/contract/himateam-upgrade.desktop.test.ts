/** Main-process file/decision seam; native Electron window acceptance is separate. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { archive108 } from './support/issue108-backup-fixture.ts';
const lib=process.env.HIMA_DBOS_TEST_LIB??path.resolve('packages/harness/lib');
const desktop=process.env.HIMA_108_DESKTOP_LIB??path.resolve('packages/desktop/lib');
const loadApi=()=>import(pathToFileURL(path.join(lib,'run-backup.js')).href);
const load=()=>import(pathToFileURL(path.join(desktop,'data-maintenance.js')).href) as Promise<Record<string,any>>;
function dialogs(open:string,save:string,responses:number[]) {
  const messages: {title:string;message:string;detail?:string}[]=[];
  const dialog={showOpenDialog:async()=>({canceled:false,filePaths:[open]}),
    showSaveDialog:async()=>({canceled:false,filePath:save}),showMessageBox:async(options:{title:string;message:string;detail?:string})=>{messages.push(options);return {response:responses.shift()??0};}};
  return {dialog,messages};
}
const unusedOptions=async()=>{throw new Error('Offline inspection/held restore must not prepare runtime or distribution.');};

test('pre-Host maintenance inspects and restores a held Home with no runtime preparation or Host admission',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'hima-108-desktop-'));
  try {
    const fixture=await archive108(root,2),home=path.join(root,'existing-held'),target=path.join(root,'imported');
    await mkdir(path.join(home,'hima'),{recursive:true});await writeFile(path.join(home,'hima/restore-hold.json'),'{}');
    const native=dialogs(fixture.backup,target,[0,0]);let stoppedChecks=0;
    const module=await load();
    const inspected=await module.inspectRestoreCandidate(fixture.backup,loadApi);
    assert.equal(inspected.restoreState,'held');assert.equal(inspected.sensitive,true);
    const result=await module.runColdMaintenance({home,action:'restore',dialog:native.dialog,loadApi,backupOptions:unusedOptions,assertHostStopped:async()=>{stoppedChecks++;}});
    assert.equal(result.state,'held');assert.equal(stoppedChecks,2);
    assert.equal(await readFile(path.join(target,'hima/materials/revision.txt'),'utf8'),'actual revision bytes');
    assert.match(await readFile(path.join(target,'hima/restore-hold.json'),'utf8'),/hima-restore-hold/);
    assert.equal(await readFile(path.join(home,'hima/restore-hold.json'),'utf8'),'{}');
  }finally{await rm(root,{recursive:true,force:true});}
});

test('maintenance cancellation and actual Host/PG ownership refusal cannot import or start anything',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'hima-108-no-start-'));
  try {
    const module=await load();let loaded=0;const blockedLoad=async()=>{loaded++;throw new Error('API must remain unloaded');};
    const native=dialogs('/unused','/unused',[]);
    const cancelled=await module.runColdMaintenance({home:root,action:'restore',dialog:{...native.dialog,showOpenDialog:async()=>({canceled:true,filePaths:[]})},loadApi:blockedLoad,backupOptions:unusedOptions,assertHostStopped:async()=>{}});
    assert.equal(cancelled.state,'cancelled');assert.equal(loaded,0);
    await mkdir(path.join(root,'hima/database/host-owner'),{recursive:true});
    await writeFile(path.join(root,'hima/database/host-owner/owner.json'),JSON.stringify({pid:process.pid}));
    const refused=await module.runColdMaintenance({home:root,action:'restore',dialog:native.dialog,loadApi:blockedLoad,backupOptions:unusedOptions,assertHostStopped:async()=>{}});
    assert.equal(refused.state,'failed');if(refused.state==='failed')assert.match(refused.message,/live Host/);
    await rm(path.join(root,'hima/database/host-owner'),{recursive:true});await mkdir(path.join(root,'hima/database/data'));
    await writeFile(path.join(root,'hima/database/data/postmaster.pid'),'unknown');
    const pg=await module.runColdMaintenance({home:root,action:'restore',dialog:native.dialog,loadApi:blockedLoad,backupOptions:unusedOptions,assertHostStopped:async()=>{}});
    assert.equal(pg.state,'failed');if(pg.state==='failed')assert.match(pg.message,/PostgreSQL/);assert.equal(loaded,0);
  }finally{await rm(root,{recursive:true,force:true});}
});
