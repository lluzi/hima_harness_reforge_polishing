import { pathToFileURL } from 'node:url';
// Real Host/PG configuration and actor boundary; model/runtime execution is separate L4.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir,readFile,stat } from 'node:fs/promises';
import path from 'node:path';
import { bootInProcess,createRootAgent } from './support/boot-inprocess.ts';
import { localHome } from './support/fabric.ts';
import { teamFixture } from './support/himateam.ts';
process.env.HIMA_TEST_SILENT_AGENT='1';process.env.HIMA_TEST_LEGACY_AUTO_DRIVE='0';
test('member model settings use authenticated human configuration, private credentials and project scope',async t=>{
  const home=await localHome(t,{sleepSeconds:0});assert.ok(home);const host=await bootInProcess(home.h);
  try {
    const agent=await createRootAgent(host.ctx,home.h.workspace),id=String(agent.id);
    const profile={modelRef:'private-model',runtime:'pi',provider:'openai-completions',model:'explicit-model',baseUrl:'https://model.example/v1',apiKey:'member-key-only'};
    await assert.rejects(host.ctx.hima.teamOperation(id,{action:'configure-model',request:profile}),/authenticated human/);
    await assert.rejects(host.ctx.hima.teamOperation(id,{action:'configure-model',request:{...profile,baseUrl:'http://127.0.0.1:1/admin'}},'human'),/HTTP/);
    const saved=await host.ctx.hima.teamOperation(id,{action:'configure-model',request:profile},'human') as any;
    assert.equal(saved.configured,true);assert.equal('apiKey' in saved,false);
    const listed=await host.ctx.hima.teamOperation(id,{action:'list-models'},'human') as any;
    assert.equal(listed.models.length,1);assert.equal(JSON.stringify(listed).includes(profile.apiKey),false);
    const created=await host.ctx.hima.teamOperation(id,{action:'save',definition:{...teamFixture,members:[{...teamFixture.members[0],runtime:'pi',modelRef:profile.modelRef}]},expectedVersion:null}) as any;
    assert.equal(JSON.stringify(created).includes(profile.apiKey),false,'shareable definition has no credential');
    const {jsonDigest}=await import(pathToFileURL(path.resolve('packages/harness/lib/run-store.js')).href);
    const file=path.join(home.h.home,'hima/team-models',jsonDigest(created.projectId)+'.json');
    assert.equal((await stat(file)).mode&0o777,0o600);assert.match(await readFile(file,'utf8'),/member-key-only/);
    const peer=path.join(home.h.workspace,'peer-project');await mkdir(peer);
    const other=await createRootAgent(host.ctx,peer);
    const isolated=await host.ctx.hima.teamOperation(String(other.id),{action:'list-models'},'human') as any;
    assert.equal(isolated.models.length,0);
  }finally{await host.dispose();await home.h.dispose();}
});

// Explicit observation-port fixture: this checks receipt semantics, not OS provenance.
test('member output needs the same received native turn to finish before it can be ready',async()=>{
  const {createOarMemberExecutor}=await import(pathToFileURL(path.resolve('packages/harness/lib/oar-member-process.js')).href);
  const prepared={schema:'hima-oar-task/1' as const,identity:{runId:'run',taskId:'task',effectId:'effect',inputSha256:'a'.repeat(64),packSha256:'b'.repeat(64),irSha256:'c'.repeat(64),applicationVersion:'test',adapterVersion:'hima-task-effect/2'},projectId:'project',memberId:'member',runtime:'pi' as const,modelRef:'default',generation:1,sessionKey:'session',inputId:'input',deadlineAt:new Date(Date.now()+240000).toISOString(),prompt:'measured task'};
  const identity={schema:'hima-oar-observation/1',sessionKey:'session',generation:1,memberId:'member',nativeSession:'native',streamGeneration:'stream',time:new Date().toISOString()};
  const received={...identity,kind:'received',seq:0,payload:{inputId:'input'}};
  const output={schemaVersion:'output/1',value:{answer:'measured'},artifacts:[],diagnostics:[]};
  const result={...identity,inputId:'input',output};
  let rows:unknown[]=[received];
  let delivered=JSON.stringify(result);
  const options={home:'unused',retainedMaterialsDir:'unused',privatePorts:()=>[],sharedDeepSeekModel:async()=>({model:'unused'}),memberContext:async()=>({}),
    store:{readTeamExecutionBinding:async(identity:unknown)=>{assert.deepEqual(identity,prepared.identity);return {deadlineAt:prepared.deadlineAt};},readTeamEffectHead:async(identity:unknown)=>{assert.deepEqual(identity,prepared.identity);return {state:'active',invocation:{identity:prepared.identity,version:1,branches:[],context:null,consumedEffects:[],consumedVersions:[]}};},orderedExternalEffectFacts:async()=>[{fact:{namespaceGeneration:'namespace',validUntil:prepared.deadlineAt}}],teamServiceReceipts:async()=>[],recordExternalEffectFact:async()=>{},externalEffectFact:async(_identity:unknown,key:string)=>key==='oar:native-session'?{nativeSession:'native'}:undefined},
    services:{},runtimeAssets:async()=>({}),localRuntime:{recover:async()=>({sessionKey:prepared.sessionKey,generation:prepared.generation,memberId:prepared.memberId,controlDirectory:'fixture-control',workDirectory:'fixture-work'}),read:async()=>({journal:rows.map(row=>JSON.stringify(row)).join('\n'),result:delivered,state:JSON.stringify({phase:'completed'}),requests:[]}),stopAll:async()=>[]}};
  const executor=createOarMemberExecutor(options);
  const assertUnknown=async()=>{const observation=await executor.port.observe(prepared,undefined);assert.equal(observation.state,'unknown');assert.match(observation.reason,/Native result has no matching completed turn evidence/);};
  try{
    await assertUnknown();
    rows.push({...identity,kind:'terminal',seq:1,payload:{inputId:'input',received:true,outcome:{kind:'failed'}}});
    await assertUnknown();
    rows=[received,{...identity,kind:'terminal',seq:1,payload:{inputId:'input',received:true,outcome:{kind:'completed'}}}];
    assert.equal((await executor.port.observe(prepared,undefined)).state,'ready');
    delivered=JSON.stringify({...result,deliveryInputId:'delivery-correction'});
    await assertUnknown();
    rows.push({...identity,kind:'terminal',seq:2,payload:{inputId:'delivery-correction',received:true,outcome:{kind:'completed'}}});
    await assertUnknown();
    rows.push({...identity,kind:'received',seq:3,payload:{inputId:'delivery-correction'}});
    assert.equal((await executor.port.observe(prepared,undefined)).state,'ready');
  }finally{await executor.dispose();}
});

// Publication bound must produce a usable MCP error, never poison observation retries.
test('oversized member context replies remain bounded and recover without another Host call', async()=>{
  const {createOarMemberExecutor}=await import(pathToFileURL(path.resolve('packages/harness/lib/oar-member-process.js')).href);
  const prepared={schema:'hima-oar-task/1',identity:{runId:'run',taskId:'task',effectId:'effect'},projectId:'project',memberId:'member',runtime:'pi',modelRef:'default',generation:1,sessionKey:'session',inputId:'input',deadlineAt:new Date(Date.now()+20000).toISOString(),prompt:'task'};
  const received={schema:'hima-oar-observation/1',sessionKey:'session',generation:1,memberId:'member',nativeSession:'native',streamGeneration:'stream',time:new Date().toISOString(),kind:'received',seq:0,payload:{inputId:'input'}};
  const id='00000000-0000-4000-8000-000000000001',facts=new Map<string,unknown>(),replies:string[]=[];let calls=0;
  const lease={sessionKey:'session',generation:1,memberId:'member',controlDirectory:'control',workDirectory:'work'};
  const executor=createOarMemberExecutor({home:'unused',retainedMaterialsDir:'unused',services:{},runtimeAssets:async()=>({}),sharedDeepSeekModel:async()=>({}),
    memberContext:async()=>{calls++;return {text:'x'.repeat(20000)};},
    store:{readTeamExecutionBinding:async(identity:unknown)=>{assert.deepEqual(identity,prepared.identity);return {deadlineAt:prepared.deadlineAt};},readTeamEffectHead:async(identity:unknown)=>{assert.deepEqual(identity,prepared.identity);return {state:'active',invocation:{identity:prepared.identity,version:1,branches:[],context:null,consumedEffects:[],consumedVersions:[]}};},recordExternalEffectFact:async(_identity:unknown,key:string,value:unknown)=>{facts.set(key,value);},externalEffectFact:async(_identity:unknown,key:string)=>facts.get(key),readTeamGrant:async()=>({})},
    localRuntime:{recover:async()=>lease,read:async()=>({journal:JSON.stringify(received),result:null,state:JSON.stringify({phase:'running'}),requests:[{id,body:JSON.stringify({id,action:'read-messages',request:{page:{limit:100}}})}]}),reply:async(_lease:unknown,_id:string,body:string)=>{assert.ok(Buffer.byteLength(body)<=16384);replies.push(body);},stopAll:async()=>[]}});
  try {
    assert.equal((await executor.port.observe(prepared)).state,'running');
    assert.equal((await executor.port.observe(prepared)).state,'running');
    assert.equal(calls,1);assert.equal(JSON.parse(replies[0]!).ok,false);assert.match(JSON.parse(replies[0]!).error,/smaller page/);
    facts.set('oar:tool-reply:'+id,{ok:true,value:{text:'x'.repeat(20000)}});
    assert.equal((await executor.port.observe(prepared)).state,'running');
    assert.equal(calls,1);assert.equal(JSON.parse(replies.at(-1)!).ok,false);
  }finally{await executor.dispose();}
});
