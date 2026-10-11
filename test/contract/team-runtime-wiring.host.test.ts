// Real Host/PG and authenticated HTTP; missing optional assets must not break Guide.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHimaHome } from './support/dsh-home.ts';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

// The standard runner supplies this authority. Standalone focused runs own a separate
// authority too, so deleted test Homes leave no records in the person's ~/.hima.
async function isolatedHome() {
  const home=await createHimaHome();
  if(home.env.HIMA_TEST_LINEAGE_DIR)return home;
  const authority=await mkdtemp(path.join(tmpdir(),'hima-team-lineage-'));
  home.env.HIMA_TEST_LINEAGE_DIR=authority;
  return {...home,dispose:async()=>{await home.dispose();await rm(authority,{recursive:true,force:true});}};
}
import { bootHimaHost } from './support/boot-host.ts';
import { api, openSession, createLiveSession } from './support/hima-api.ts';

test('optional Team runtime status and missing-asset diagnostics survive Host reopening without blocking Guide',async t=>{
  const home=await isolatedHome();
  delete home.env.HIMA_TEAM_RUNTIME;
  let host=await bootHimaHost(home);
  t.after(async()=>{await host.stop();await home.dispose();});
  let cookie=await openSession(host);
  const call=async(action:string)=>{
    const response=await api(host,cookie,'/hima/api/team-runtime',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,serviceId:'hindsight'})});
    assert.equal(response.status,200);return await response.json() as any;
  };
  const anonymous=await fetch(new URL('/hima/api/team-runtime',host.url),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'status',serviceId:'hindsight'})});
  assert.equal(anonymous.status,401);
  const first=await call('status');assert.equal(first.receipt.state,'unavailable');assert.equal(first.receipt.owned.quiescent,true);
  const started=await call('start');assert.equal(started.receipt.state,'unavailable');assert.equal(started.receipt.diagnostic.code,'missing-assets');
  assert.ok(await createLiveSession(host,cookie,home.workspace));
  const firstGeneration=started.receipt.generation;
  assert.equal(await host.stop(),0);
  host=await bootHimaHost(home);cookie=await openSession(host);
  const reopened=await call('status');
  assert.ok(reopened.history.some((receipt:any)=>receipt.generation===firstGeneration&&receipt.operation==='start'));
  assert.ok(reopened.history.some((receipt:any)=>receipt.generation===firstGeneration&&receipt.operation==='stop'&&receipt.owned.quiescent));
  assert.equal(JSON.stringify(reopened).includes('apiKey'),false);
  assert.ok(await createLiveSession(host,cookie,home.workspace));
});

test('native Hindsight starts and exports through real Host receipts, then closes before PostgreSQL',async t=>{
  const runtime=process.env.HIMA_TEST_TEAM_NATIVE_RUNTIME;
  if(!runtime){t.skip('Explicit retained native Team runtime required; local tests do not install or download it.');return;}
  const {createServer}=await import('node:http');
  const {readFile}=await import('node:fs/promises');
  const {createHash}=await import('node:crypto');
  const path=await import('node:path');
  const home=await isolatedHome();
  const llm=createServer((_request,response)=>{response.end(JSON.stringify({choices:[{message:{content:'Qualification fixture'}}]}));});
  await new Promise<void>(resolve=>llm.listen(0,'127.0.0.1',resolve));
  const address=llm.address();assert.ok(address&&typeof address!=='string');
  Object.assign(home.env,{HIMA_TEAM_RUNTIME:runtime,HIMA_POSTGRES_RUNTIME:path.join(runtime,'postgres'),
    HIMA_HINDSIGHT_LLM_PROVIDER:'openai',HIMA_HINDSIGHT_LLM_MODEL:'qualification-fixture',HIMA_HINDSIGHT_LLM_API_KEY:'qualification-only',
    HIMA_HINDSIGHT_LLM_BASE_URL:`http://127.0.0.1:${address.port}/v1`,HIMA_HINDSIGHT_SKIP_LLM_VERIFICATION:'true',
    HIMA_HINDSIGHT_EMBEDDINGS_LOCAL_MODEL:path.join(runtime,'models/BAAI-bge-small-en-v1.5'),
    HIMA_HINDSIGHT_RERANKER_LOCAL_MODEL:path.join(runtime,'models/cross-encoder-ms-marco-MiniLM-L-6-v2')});
  let host:Awaited<ReturnType<typeof bootHimaHost>>|undefined;
  t.after(async()=>{await host?.stop();await home.dispose();await new Promise<void>(resolve=>llm.close(()=>resolve()));});
  host=await bootHimaHost(home);
  const cookie=await openSession(host);
  const call=async(request:unknown)=>{const response=await api(host,cookie,'/hima/api/team-runtime',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(request)});assert.equal(response.status,200);return await response.json() as any;};
  const started=await call({action:'start',serviceId:'hindsight'});
  assert.equal(started.receipt.state,'running',JSON.stringify(started));
  assert.ok(started.receipt.owned.pid);const pid=started.receipt.owned.pid;
  assert.equal((await call({action:'status',serviceId:'hindsight'})).receipt.generation,started.receipt.generation);
  const exported=await call({action:'export',serviceId:'hindsight',cutId:'host-cut',destination:'host-cut.zip'});
  assert.equal(exported.receipt.generation,started.receipt.generation);
  const bytes=await readFile(exported.receipt.export.file);
  assert.ok(bytes.length>0);assert.equal(createHash('sha256').update(bytes).digest('hex'),exported.receipt.export.sha256);
  assert.equal(bytes.subarray(0,2).toString(),'PK');
  assert.equal(JSON.stringify(exported).includes('qualification-only'),false);
  assert.equal(await host.stop(),0);assert.throws(()=>process.kill(pid,0));
  t.diagnostic(JSON.stringify({generation:started.receipt.generation,servicePid:pid,exportBytes:bytes.length,sha256:exported.receipt.export.sha256,closedBeforeHomeDeletion:true,model:'declared fixture; no business acceptance'}));
});

test('current App exit fences service startup while status remains readable',async t=>{
  const home=await isolatedHome();delete home.env.HIMA_TEAM_RUNTIME;
  const token='a'.repeat(64);home.env.HIMA_DESKTOP_CONTROL_TOKEN=token;
  const host=await bootHimaHost(home);t.after(async()=>{await host.stop();await home.dispose();});
  const cookie=await openSession(host);
  const exit=await fetch(new URL('/hima/api/lifecycle/exit',host.url),{method:'POST',headers:{'content-type':'application/json','x-hima-desktop-control':token},body:JSON.stringify({requestId:'service-current-exit',mode:'keep-jobs'})});
  assert.equal(exit.status,200);
  const start=await api(host,cookie,'/hima/api/team-runtime',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'start',serviceId:'hindsight'})});
  assert.equal(start.status,400,'no new optional process can be admitted after current App exit');
  const status=await api(host,cookie,'/hima/api/team-runtime',{method:'POST',body:JSON.stringify({action:'status',serviceId:'hindsight'})});
  assert.equal(status.status,200);
});

test('operator engine controls retain missing-asset receipts and never expose namespace or member authority',async t=>{
  const home=await isolatedHome();delete home.env.HIMA_TEAM_RUNTIME;
  const host=await bootHimaHost(home);t.after(async()=>{await host.stop();await home.dispose();});
  const cookie=await openSession(host);await createLiveSession(host,cookie,home.workspace);
  const call=async(body:unknown)=>{const response=await api(host,cookie,'/hima/api/team-runtime',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});return {status:response.status,body:await response.json() as any};};
  const started=await call({action:'start',serviceId:'engineering-engine'});assert.equal(started.status,200,JSON.stringify(started.body));
  assert.equal(started.body.receipt.serviceId,'engineering-engine');assert.equal(started.body.receipt.state,'unavailable');
  const status=await call({action:'status',serviceId:'engineering-engine'});assert.equal(status.status,200);assert.equal(status.body.receipt.generation,started.body.receipt.generation);
  assert.ok(status.body.history.length>=2);
  assert.equal((await call({action:'prepareNamespace',serviceId:'engineering-engine',argv:['untrusted']})).status,400);
  assert.equal((await call({action:'start',serviceId:'engineering-engine',pid:process.pid})).status,400);
  const member=await fetch(new URL('/hima/api/team-runtime',host.url),{method:'POST',headers:{authorization:'Bearer fixture-member'},body:JSON.stringify({action:'start',serviceId:'engineering-engine'})});assert.equal(member.status,401);
  const stopped=await call({action:'stop',serviceId:'engineering-engine'});assert.equal(stopped.status,200);assert.equal(stopped.body.receipt.owned.quiescent,true);
});
