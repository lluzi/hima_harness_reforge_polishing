// Configuration and explicit staging-port fixtures only; no engine, OS probe or model calls.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import os from 'node:os';
import {mkdtemp,rm} from 'node:fs/promises';
const lib=path.resolve('packages/harness/lib');
const {resolveSharedDeepSeek,sharedDeepSeekNativeBaseUrl,readHostDeepSeekConfiguration,readSharedDeepSeekEnvironment}=await import(pathToFileURL(path.join(lib,'oar-model-configuration.js')).href);
const fallback={apiKey:'fixture-host-key',baseUrl:'https://api.deepseek.com/anthropic',model:'host-selected-model',provider:'anthropic-messages',sources:{apiKey:'host:credentials:file',baseUrl:'host:provider-settings',model:'host:agentDefaultModel',provider:'host:deepseek-messages-adapter'}};
test('shared default reuses Host configuration without a member profile',()=>{
 const result=resolveSharedDeepSeek({},fallback);
 assert.deepEqual(result.configuration,{apiKey:fallback.apiKey,baseUrl:fallback.baseUrl,model:fallback.model,provider:fallback.provider});
 assert.deepEqual(result.sources,fallback.sources);
 assert.equal(JSON.stringify(result.sources).includes(fallback.apiKey),false);
});
test('explicit environment overrides are resolved together and select the actual documented endpoint protocol',()=>{
 const result=resolveSharedDeepSeek({DEEPSEEK_API_KEY:'fixture-env-key',DEEPSEEK_BASE_URL:'https://api.deepseek.com/v1',DEEPSEEK_MODEL:'env-selected-model'},fallback);
 assert.deepEqual(result.configuration,{apiKey:'fixture-env-key',baseUrl:'https://api.deepseek.com/v1',model:'env-selected-model',provider:'openai-completions'});
 assert.equal(result.sources.apiKey,'environment:DEEPSEEK_API_KEY');assert.equal(result.sources.model,'environment:DEEPSEEK_MODEL');
 assert.equal(resolveSharedDeepSeek({DEEPSEEK_BASE_URL:'https://api.deepseek.com/anthropic'},fallback).configuration.provider,'anthropic-messages');
});
test('custom endpoint retains known Host protocol or an explicit protocol without guessing a replacement URL',()=>{
 const host={...fallback,baseUrl:'http://model.example/messages-root'};
 assert.equal(resolveSharedDeepSeek({},host).configuration.baseUrl,host.baseUrl);
 assert.equal(resolveSharedDeepSeek({DEEPSEEK_BASE_URL:host.baseUrl},host).configuration.provider,'anthropic-messages');
 assert.throws(()=>resolveSharedDeepSeek({DEEPSEEK_BASE_URL:'https://other.example/v1'},host),/protocol is unknown/);
 const explicit=resolveSharedDeepSeek({DEEPSEEK_BASE_URL:'https://other.example/v1',DEEPSEEK_API:'openai-completions'},host);
 assert.equal(explicit.configuration.baseUrl,'https://other.example/v1');assert.equal(explicit.configuration.provider,'openai-completions');
});
test('missing or explicitly empty values refuse configuration without silently falling back',()=>{
 for(const field of ['apiKey','baseUrl','model'])assert.throws(()=>resolveSharedDeepSeek({},{...fallback,[field]:undefined}),/missing/);
 for(const field of ['DEEPSEEK_API_KEY','DEEPSEEK_BASE_URL','DEEPSEEK_MODEL'])assert.throws(()=>resolveSharedDeepSeek({[field]:''},fallback),/missing/);
 assert.throws(()=>resolveSharedDeepSeek({DEEPSEEK_API:'unknown'},fallback),/DEEPSEEK_API/);
 assert.throws(()=>resolveSharedDeepSeek({DEEPSEEK_BASE_URL:'https://user:password@api.deepseek.com'},fallback),/without credentials/);
});
test('two native formats address the same Messages resource and leave Chat Completions bases unchanged',()=>{
 for(const base of ['https://api.deepseek.com/anthropic','https://api.deepseek.com/anthropic/v1']){
  assert.equal(sharedDeepSeekNativeBaseUrl('pi',base,'anthropic-messages')+'/v1/messages','https://api.deepseek.com/anthropic/v1/messages');
  assert.equal(sharedDeepSeekNativeBaseUrl('opencode',base,'anthropic-messages')+'/messages','https://api.deepseek.com/anthropic/v1/messages');
 }
 for(const runtime of ['pi','opencode'])assert.equal(sharedDeepSeekNativeBaseUrl(runtime,'https://api.deepseek.com/v1','openai-completions'),'https://api.deepseek.com/v1');
});
test('Host reader uses the live provider settings namespace and existing credential reference',async()=>{
 const refs:string[]=[],settingsOptions:unknown[]=[];
 const ports={agentDefaultModel:{currentSelection:()=>({provider:'deepseek-official',model:'current-host-model'})},llm:{listConfigurableProviders:()=>[{provider:'deepseek-official',settingsNs:'live-provider',settingsPath:['profile']}]},settings:{describe:(options:unknown)=>{settingsOptions.push(options);return[{ns:'live-provider',value:{profile:{baseURL:'https://proxy.example/anthropic',apiKeyEnv:'EXISTING_HOST_KEY'}}}];}},credentials:{resolve:async(ref:string)=>{refs.push(ref);return{value:'fixture-existing-secret',source:'file'};}}};
 const ctx={get:(name:string)=>(ports as Record<string,unknown>)[name]};
 const host=await readHostDeepSeekConfiguration(ctx);
 assert.equal(host.model,'current-host-model');assert.equal(host.baseUrl,'https://proxy.example/anthropic');assert.equal(host.apiKey,'fixture-existing-secret');assert.deepEqual(refs,['EXISTING_HOST_KEY']);assert.deepEqual(settingsOptions,[{redactSecrets:true}]);
 await readHostDeepSeekConfiguration(ctx,false);assert.deepEqual(refs,['EXISTING_HOST_KEY'],'environment key needs no extra credential read');
 const shared=resolveSharedDeepSeek({DEEPSEEK_API_KEY:'fixture-env-key'},host);assert.equal(shared.configuration.apiKey,'fixture-env-key');assert.equal(shared.configuration.model,'current-host-model');
});
test('launch environment supplies existing values and explicit process values remain first',()=>{
 const before=process.env.DEEPSEEK_MODEL;
 try{
  delete process.env.DEEPSEEK_MODEL;
  const ctx={get:(name:string)=>name==='launchEnvironment'?{get:(key:string)=>key==='DEEPSEEK_MODEL'?{value:'launch-model',source:'user-env'}:undefined}:undefined};
  assert.equal(readSharedDeepSeekEnvironment(ctx).DEEPSEEK_MODEL,'launch-model');
  process.env.DEEPSEEK_MODEL='process-model';assert.equal(readSharedDeepSeekEnvironment(ctx).DEEPSEEK_MODEL,'process-model');
 }finally{if(before===undefined)delete process.env.DEEPSEEK_MODEL;else process.env.DEEPSEEK_MODEL=before;}
});
test('default shared values reach both guest configurations while explicit profile semantics stay unchanged',async()=>{
 const {createOarMemberExecutor,saveTeamModel}=await import(pathToFileURL(path.join(lib,'oar-member-process.js')).href);
 const home=await mkdtemp(path.join(os.tmpdir(),'hima-model-config-'));

 try{
  for(const runtime of ['pi','opencode'])for(const explicit of [false,true]){
   const projectId=runtime+'-'+String(explicit),facts=new Map<string,unknown>(),staged:any[]=[];
   if(explicit)await saveTeamModel(home,projectId,{modelRef:'default',runtime,provider:'openai-completions',model:'explicit-profile-model',baseUrl:'https://profile.example/v1',apiKey:'fixture-profile-key'});
   const member={id:'member',runtime,modelRef:'default',skills:[],toolRefs:[],knowledgeRefs:[],instructions:'configuration fixture'};
   const prepared={schema:'hima-oar-task/1',identity:{runId:'run',taskId:'task',effectId:'effect',source:{kind:'team',projectId,team:{teamId:'team'},taskId:'task'}},projectId,memberId:'member',runtime,modelRef:'default',sessionKey:'session',generation:1,inputId:'input',deadlineAt:new Date(Date.now()+240000).toISOString(),prompt:'configuration only'};
   const store={orderedExternalEffectFacts:async()=>[{fact:{namespaceGeneration:'fixture-existing-lease',validUntil:prepared.deadlineAt}}],teamServiceReceipts:async()=>[],readTeamGrant:async()=>({}),run:async()=>({deadlineAt:prepared.deadlineAt,opening:{data:{definition:{members:[member],delivery:{output:{version:'output/1'}}}}}}),externalEffectFact:async(_identity:unknown,key:string)=>facts.get(key),recordExternalEffectFact:async(_identity:unknown,key:string,value:unknown)=>{facts.set(key,value);}};
   const services={};const runtimeAssets=async()=>({oarModule:'/fixture/oar.js',nodeExecutable:process.execPath,opencodeCommand:'/fixture/opencode',opencodeVersion:'fixture'});const localRuntime={stage:async(config:any)=>{staged.push({path:'/hima-home/config.json',bytes:Buffer.from(JSON.stringify(config))});return{sessionKey:prepared.sessionKey,generation:1,memberId:'member',controlDirectory:'fixture-control',workDirectory:'fixture-work'};},stopAll:async()=>[]};
   const executor=createOarMemberExecutor({home,retainedMaterialsDir:home,store,services,localRuntime,runtimeAssets,memberContext:async()=>({}),privatePorts:()=>[],modelEnvironment:()=>({DEEPSEEK_API_KEY:'fixture-env-key',DEEPSEEK_MODEL:'shared-model'}),sharedDeepSeekModel:async()=>fallback});
   try{
    assert.equal((await executor.readiness({members:[member]},projectId)).ready,true,'default model readiness needs no extra profile');
    const adapter=await executor.resolve({request:{identity:prepared.identity},task:{memberId:member.id},flow:{method:{sha256:'a'.repeat(64)}}});assert.equal(typeof adapter.prepare,'function','configuration materializes without another setup flow');
    await executor.port.stage(prepared,async()=>{});
    const guest=JSON.parse(Buffer.from(staged.find(file=>file.path==='/hima-home/config.json').bytes).toString());
    assert.equal(guest.model.apiKey,explicit?'fixture-profile-key':'fixture-env-key');assert.equal(guest.model.model,explicit?'explicit-profile-model':'shared-model');
    assert.equal(guest.model.baseUrl,explicit?'https://profile.example/v1':fallback.baseUrl);
    assert.equal(guest.model.provider,explicit?'openai-completions':'anthropic-messages');
    assert.equal(guest.model.nativeBaseUrl,explicit?undefined:runtime==='pi'?fallback.baseUrl:fallback.baseUrl+'/v1');
   }finally{await executor.dispose();}
  }
 }finally{await rm(home,{recursive:true,force:true});}
});

test('Host endpoint resolution includes the same launch environment used by its adapter',async()=>{
 const endpoint='https://proxy.example/anthropic-root';
 const ports={agentDefaultModel:{currentSelection:()=>({provider:'deepseek-official',model:'host-model'})},llm:{listConfigurableProviders:()=>[{provider:'deepseek-official',settingsNs:'provider',settingsPath:[]}]},settings:{describe:()=>[{ns:'provider',value:{}}]},launchEnvironment:{get:(name:string)=>name==='DEEPSEEK_BASE_URL'?{value:endpoint,source:'user-env'}:name==='DEEPSEEK_API_KEY'?{value:'fixture-launch-key',source:'user-env'}:undefined}};
 const host=await readHostDeepSeekConfiguration({get:(name:string)=>(ports as Record<string,unknown>)[name]});
 assert.equal(host.baseUrl,endpoint);assert.equal(host.sources.baseUrl,'host:launch-environment:user-env');
 assert.equal(resolveSharedDeepSeek({DEEPSEEK_BASE_URL:endpoint},host).configuration.provider,'anthropic-messages','working Host protocol survives a custom launch endpoint');
 assert.equal(resolveSharedDeepSeek({DEEPSEEK_BASE_URL:'https://api.deepseek.com/v1'},{...host,baseUrl:'https://api.deepseek.com/v1'}).configuration.provider,'openai-completions','documented explicit endpoint wins over a Messages-only Host default');
});

test('a changed process override cannot masquerade as the Host frozen launch endpoint',async()=>{
 const previous=process.env.DEEPSEEK_BASE_URL;
 try{
  process.env.DEEPSEEK_BASE_URL='https://new-unknown.example/v1';
  const ports={agentDefaultModel:{currentSelection:()=>({provider:'deepseek-official',model:'host-model'})},launchEnvironment:{get:()=>undefined}};
  const host=await readHostDeepSeekConfiguration({get:(name:string)=>(ports as Record<string,unknown>)[name]},false);
  assert.equal(host.baseUrl,'https://api.deepseek.com/anthropic');assert.equal(host.sources.baseUrl,'host:deepseek-adapter-default');
  assert.throws(()=>resolveSharedDeepSeek({DEEPSEEK_API_KEY:'fixture-key',DEEPSEEK_BASE_URL:process.env.DEEPSEEK_BASE_URL},host),/protocol is unknown/);
 }finally{if(previous===undefined)delete process.env.DEEPSEEK_BASE_URL;else process.env.DEEPSEEK_BASE_URL=previous;}
});
