import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { TeamServiceReceipt } from '../../packages/harness/lib/types/team-service-runtime.js';
const {TeamServiceRuntime}=await import(new URL('../../packages/harness/lib/team-service-runtime.js',import.meta.url).href) as typeof import('../../packages/harness/lib/types/team-service-runtime.js');

// Real owned subprocess substituting the selected Hindsight HTTP/CLI dependency. This verifies Host
// mechanics through Hindsight's real HTTP/native CLI interface only. Not Hindsight qualification.
async function fixture(delay = 0, backupDelay = 0, readinessDelay = 0, timeoutMs = 10000) {
  const root = await mkdtemp(path.join(tmpdir(), 'hima-service-process-'));
  const runtime = path.join(root, 'runtime'); await mkdir(runtime);
  await cp(process.execPath, path.join(runtime, 'node'));
  const script = `import {createServer} from 'node:http'; import {writeFileSync} from 'node:fs'; import {spawn} from 'node:child_process';
if(process.argv.includes('--descendant')) {setInterval(()=>{},1000);} else if(process.argv.includes('backup')) {writeFileSync(process.argv[process.argv.indexOf('backup')+1]+'.started','started');setTimeout(()=>writeFileSync(process.argv[process.argv.indexOf('backup')+1],JSON.stringify({snapshot:'fixture-online-backup',environment:process.env})),${backupDelay});} else {
setTimeout(()=>createServer((req,res)=>{if(req.url==='/health/ready' && ${readinessDelay}>0) {writeFileSync(process.env.HOME+'/readiness.started','started');setTimeout(()=>res.end('{}'),${readinessDelay});return;}if(req.url==='/environment'){res.end(JSON.stringify(process.env));return;}if(req.url==='/leader-close'){res.end('{}');setImmediate(()=>process.exit(0));return;}if(req.url?.startsWith('/leader-exit/')) {const child=spawn(process.execPath,['service.mjs','--descendant',req.url.split('/').pop()],{stdio:'ignore'});child.once('spawn',()=>{res.end(JSON.stringify({pid:child.pid}));setImmediate(()=>process.exit(0));});return;}if(req.url==='/v1/default/banks' && req.headers.authorization!=='Bearer '+process.env.HINDSIGHT_API_TENANT_API_KEY){res.writeHead(401);return res.end();}res.writeHead(200);res.end('{}');}).listen(Number(process.env.HINDSIGHT_API_PORT),'127.0.0.1'),${delay});}`;
  await writeFile(path.join(runtime, 'service.mjs'), script); await writeFile(path.join(runtime, 'LICENSE'), 'Test fixture only');
  const files: Record<string,string> = {};
  for (const file of ['node','service.mjs','LICENSE']) files[file] = createHash('sha256').update(await readFile(path.join(runtime,file))).digest('hex');
  await writeFile(path.join(runtime,'team-runtime.json'),JSON.stringify({format:'hima-team-runtime/1',platform:`${process.platform}-${process.arch}`,qualification:'mechanism-test-only',files,
    components:[{id:'hindsight',version:'fixture',source:'https://example.invalid/test-fixture',license:'test-only',notices:['LICENSE'],requiredFiles:['node','service.mjs']}],
    services:[{id:'hindsight',executable:'node',argv:['service.mjs'],timeoutMs,stopGraceMs:500,backupExecutable:'node',backupArgv:['service.mjs']}]}));
  const receipts: TeamServiceReceipt[] = [];
  const service = new TeamServiceRuntime({home:path.join(root,'home'),runtimeDirectory:runtime,recordReceipt:async r=>{receipts.push(r);},configuration:async()=>({databaseUrl:'postgresql://fixture:private@127.0.0.1:1/hindsight'})});
  return {root,runtime,receipts,service};
}
test('owned service exports while live and stops the exact generation', async()=>{
  const f=await fixture();
  try {
    const start=await f.service.start('hindsight'); assert.equal(start.state,'running'); assert.ok(start.owned.pid);assert.equal((await f.service.status('hindsight')).state,'running');
    const exported=await f.service.export('hindsight',{cutId:'cut-1',destination:'cut-1.zip'}); assert.equal(exported.state,'running');
    assert.equal(JSON.parse(await readFile(exported.export!.file,'utf8')).snapshot,'fixture-online-backup');assert.equal(exported.generation,start.generation);
    const stopped=await f.service.stop('hindsight'); assert.equal(stopped.state,'stopped'); assert.equal(stopped.owned.quiescent,true);
    assert.equal(stopped.generation,start.generation); assert.throws(()=>process.kill(start.owned.pid!,0));
    await assert.rejects(f.service.export('hindsight',{cutId:'cut-2',destination:'cut-2.zip'}),/live owned/);
  } finally {await f.service.stopAll(); await rm(f.root,{recursive:true,force:true});}
});
test('online export may exceed thirty seconds within its installed service budget', {timeout:45000}, async()=>{
  const f=await fixture(0,31000,0,40000);
  try {
    const started=await f.service.start('hindsight');assert.equal(started.state,'running');
    const exported=await f.service.export('hindsight',{cutId:'native-cold-backup',destination:'native-cold-backup.zip'});
    assert.equal(exported.state,'running');assert.equal(exported.generation,started.generation);
    assert.equal(JSON.parse(await readFile(exported.export!.file,'utf8')).snapshot,'fixture-online-backup');
    assert.equal((await f.service.status('hindsight')).state,'running');
    assert.equal((await f.service.stop('hindsight')).owned.quiescent,true);
  }finally{await f.service.stopAll();await rm(f.root,{recursive:true,force:true});}
});
test('online export exceeding its installed service budget rejects and retains the live generation', {timeout:20000}, async()=>{
  const f=await fixture(0,6000,0,5000);
  try {
    const started=await f.service.start('hindsight');assert.equal(started.state,'running');
    await assert.rejects(f.service.export('hindsight',{cutId:'over-budget',destination:'over-budget.zip'}),/online backup failed/);
    const status=await f.service.status('hindsight');assert.equal(status.state,'running');assert.equal(status.generation,started.generation);
    await assert.rejects(readFile(path.join(f.root,'home/hima/team-service-exports',started.generation,'over-budget.zip')),/ENOENT/);
    assert.equal((await f.service.stop('hindsight')).owned.quiescent,true);
  }finally{await f.service.stopAll();await rm(f.root,{recursive:true,force:true});}
});
test('stop fences a late ready event and missing/hash/platform failures launch nothing',async()=>{
  const f=await fixture(500);
  try {
    const starting=f.service.start('hindsight');
    // Wait for an actual spawned child, then fence it before its delayed HTTP listener starts.
    const deadline=Date.now()+5000;let spawning=await f.service.status('hindsight');
    while(!spawning.owned.pid && Date.now()<deadline){await new Promise(resolve=>setTimeout(resolve,10));spawning=await f.service.status('hindsight');}
    assert.ok(spawning.owned.pid);const stopping=f.service.stop('hindsight');
    assert.equal((await starting).state,'stopped'); assert.equal((await stopping).owned.quiescent,true);
    await writeFile(path.join(f.runtime,'LICENSE'),'changed'); assert.equal((await f.service.start('hindsight')).diagnostic?.code,'asset-integrity');
    const manifest=JSON.parse(await readFile(path.join(f.runtime,'team-runtime.json'),'utf8')); manifest.platform='wrong-arch';
    await writeFile(path.join(f.runtime,'team-runtime.json'),JSON.stringify(manifest)); assert.equal((await f.service.start('hindsight')).diagnostic?.code,'platform');
    assert.equal(f.receipts.filter(r=>r.state==='running').length,0);
    const missing=new TeamServiceRuntime({home:path.join(f.root,'empty'),recordReceipt:async()=>{}});
    assert.equal((await missing.start('hindsight')).state,'unavailable');
  } finally {await f.service.stopAll(); await rm(f.root,{recursive:true,force:true});}
});

async function until(check:()=>Promise<boolean>, message:string) {
  const deadline=Date.now()+5000;
  while(Date.now()<deadline) {if(await check())return;await new Promise(resolve=>setTimeout(resolve,10));}
  assert.fail(message);
}
test('status before start retains one unavailable generation without creating a process',async()=>{
  const f=await fixture();
  try {
    const first=await f.service.status('hindsight');const second=await f.service.status('hindsight');
    assert.equal(first.state,'unavailable');assert.equal(first.owned.quiescent,true);assert.equal(first.owned.pid,undefined);
    assert.equal(second.generation,first.generation);assert.equal(f.receipts.some(r=>r.operation==='start'),false);
    const started=await f.service.start('hindsight');assert.equal(started.state,'running');assert.notEqual(started.generation,first.generation);
  }finally{await f.service.stopAll();await rm(f.root,{recursive:true,force:true});}
});
test('leader exit retains unresolved descendant generation and refuses restart',async()=>{
  const f=await fixture();let descendant:number|undefined;let token='';let leader:number|undefined;
  try {
    const started=await f.service.start('hindsight');leader=started.owned.pid;token=randomUUID();
    const connection=f.service.connection('hindsight')!;
    descendant=(await (await fetch(`${connection.origin}/leader-exit/${token}`)).json() as {pid:number}).pid;
    await until(async()=>{const status=await f.service.status('hindsight');return status.state==='failed' && status.owned.pid===undefined;},'leader did not exit');
    await assert.rejects(f.service.start('hindsight'),/unresolved|quiescen|process group/i);
    const stopped=await f.service.stop('hindsight');assert.equal(stopped.owned.quiescent,false);assert.equal(stopped.diagnostic?.code,'unresolved-descendants');
    await assert.rejects(f.service.start('hindsight'),/unresolved|quiescen|process group/i);
    assert.equal((await f.service.status('hindsight')).generation,started.generation);
  }finally{
    if(descendant) {
      // Prove this exact test-spawned PID, unique argv token and original process group before cleanup.
      const identity=execFileSync('/bin/ps',['-p',String(descendant),'-o','pgid=,command='],{encoding:'utf8'}).trim();
      assert.equal(Number(identity.split(/\s+/)[0]),leader);assert.ok(identity.includes(token));
      process.kill(descendant,'SIGTERM');
      await until(async()=>{try{process.kill(descendant!,0);return false;}catch{return true;}},'test descendant did not exit');
    }
    await f.service.stopAll();await rm(f.root,{recursive:true,force:true});
  }
});
test('ordinary stop permits restart and fixed Python isolation reaches HTTP service and backup CLI',async()=>{
  const f=await fixture();
  try {
    const first=await f.service.start('hindsight');assert.equal((await f.service.stop('hindsight')).owned.quiescent,true);
    const restarted=await f.service.start('hindsight');assert.equal(restarted.state,'running');assert.notEqual(restarted.generation,first.generation);
    const exported=await f.service.export('hindsight',{cutId:'env',destination:'env.zip'});
    const output=JSON.parse(await readFile(exported.export!.file,'utf8'));
    const serviceEnvironment=await (await fetch(`${f.service.connection('hindsight')!.origin}/environment`)).json() as Record<string,string>;
    for(const key of ['PYTHON_DOTENV_DISABLED','PYTHONNOUSERSITE','PYTHONDONTWRITEBYTECODE','HF_HUB_OFFLINE','TRANSFORMERS_OFFLINE']){assert.equal(output.environment[key],'1',key);assert.equal(serviceEnvironment[key],'1',key);}
  }finally{await f.service.stopAll();await rm(f.root,{recursive:true,force:true});}
});
test('terminal shutdown immediately fences start/export while awaiting an online backup',async()=>{
  const f=await fixture(0,300);
  try {
    const started=await f.service.start('hindsight');const backup=f.service.export('hindsight',{cutId:'shutdown',destination:'shutdown.zip'});
    const file=path.join(f.root,'home/hima/team-service-exports',started.generation,'shutdown.zip.started');
    await until(async()=>!!await readFile(file).catch(()=>undefined),'backup did not start');
    assert.equal((await f.service.start('hindsight')).generation,started.generation,'idempotent start retains the running generation during its backup');
    const shutdown=f.service.stopAll();
    await assert.rejects(f.service.start('other'),/shutdown/i);
    await assert.rejects(f.service.export('hindsight',{cutId:'late',destination:'late.zip'}),/shutdown/i);
    assert.ok((await backup).export);const receipts=await shutdown;assert.equal(receipts[0]!.owned.quiescent,true);
    await assert.rejects(f.service.start('hindsight'),/shutdown/i);assert.equal(f.service.connection('hindsight'),undefined);
  }finally{await f.service.stopAll();await rm(f.root,{recursive:true,force:true});}
});
test('terminal shutdown fences a starting generation and late readiness',async()=>{
  const f=await fixture(0,0,400);
  try {
    const starting=f.service.start('hindsight');
    await until(async()=>!!(await f.service.status('hindsight')).owned.pid,'service did not spawn');
    const generation=(await f.service.status('hindsight')).generation;
    await until(async()=>!!await readFile(path.join(f.root,'home/hima/team-services/hindsight',generation,'readiness.started')).catch(()=>undefined),'readiness request did not begin');
    const shutdown=f.service.stopAll();await assert.rejects(f.service.start('hindsight'),/shutdown/i);
    assert.equal((await starting).state,'stopped');assert.equal((await shutdown)[0]!.owned.quiescent,true);
    assert.equal(f.receipts.some(r=>r.state==='running'),false);assert.equal(f.service.connection('hindsight'),undefined);
  }finally{await f.service.stopAll();await rm(f.root,{recursive:true,force:true});}
});

test('durable startup intent cannot claim quiescence while it can still create a service',async()=>{
  const f=await fixture(100);
  try {
    const starting=f.service.start('hindsight');
    const intent=f.receipts.find(receipt=>receipt.operation==='start'&&receipt.state==='starting');
    assert.ok(intent,'the ownership intent is recorded before optional startup');
    assert.equal(intent.owned.quiescent,false,'cold Host recovery must not mistake pending startup for proved closure');
    const stopped=await f.service.stop('hindsight');
    await starting;
    assert.equal(stopped.owned.quiescent,true);
    assert.equal(stopped.state,'stopped');
  }finally{await f.service.stopAll();await rm(f.root,{recursive:true,force:true});}
});

test('an unfinished owned backup prevents quiescence after the service leader exits',async()=>{
  const f=await fixture(0,2000);
  try {
    const started=await f.service.start('hindsight');
    const backup=f.service.export('hindsight',{cutId:'leader-gone',destination:'leader-gone.zip'});
    const rejected=assert.rejects(backup,/exited before export/);
    await until(async()=>!!await readFile(path.join(f.root,'home/hima/team-service-exports',started.generation,'leader-gone.zip.started')).catch(()=>undefined),'backup did not start');
    await fetch(`${f.service.connection('hindsight')!.origin}/leader-close`);
    await until(async()=>{const receipt=await f.service.status('hindsight');return receipt.state==='failed'&&receipt.owned.pid===undefined;},'leader did not exit');
    assert.equal((await f.service.status('hindsight')).owned.quiescent,false,'the owned backup is still live');
    await assert.rejects(f.service.start('hindsight'),/backup|export/,'replacement must not drop the old live backup from shutdown ownership');
    await rejected;
    assert.equal((await f.service.status('hindsight')).owned.quiescent,true,'quiescence follows actual backup exit');
  }finally{await f.service.stopAll();await rm(f.root,{recursive:true,force:true});}
});
