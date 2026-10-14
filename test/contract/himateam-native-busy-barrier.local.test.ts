// L2: actual public Local runtime + managed Node IPC/OS, zero product model.
// Controlled raw protocol oracle is NOT genuine Pi/OpenCode SDK qualification.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp,readFile,writeFile,rm,realpath,readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { calculatorBarrier,digest,mappedInputId,nativeCommandEvidence,proveBusy,releaseAfterHuman,assertBarrierOrder,publishCompleteMarker } from './support/native-busy-barrier.ts';
import { waitUntil } from './support/fabric.ts';
const lib=process.env.HIMA_DBOS_TEST_LIB??path.resolve('packages/harness/lib');
const localModule=await import(pathToFileURL(path.join(lib,'oar-local-member.js')).href) as typeof import('../../packages/harness/lib/types/oar-local-member.js');

for(const runtimeKind of ['pi','opencode'] as const)test(`public Local ${runtimeKind} protocol queues persisted human input behind actual Node barrier, then receives exactly once and closes`, {timeout:20000},async t=>{
  const home=await realpath(await mkdtemp(path.join(os.tmpdir(),'hima-native-barrier-')));
  const deadlineAt=new Date(Date.now()+15000).toISOString(),barrier=calculatorBarrier(deadlineAt);
  const prepared={schema:'hima-oar-task/1' as const,identity:{runId:'run',taskId:'task',effectId:'effect',inputSha256:'a'.repeat(64),packSha256:'b'.repeat(64),irSha256:'c'.repeat(64),applicationVersion:'test',adapterVersion:'test'},projectId:'project',memberId:'worker',runtime:runtimeKind,modelRef:'controlled-node',generation:0,sessionKey:'barrier-worker',inputId:'original-input',deadlineAt,prompt:barrier.command};
  const runner=path.join(home,'oracle.mjs');
  await writeFile(runner,`
import {spawn} from 'node:child_process';
const script=${JSON.stringify(barrier.script)},command=${JSON.stringify(barrier.command)},nativeId=${JSON.stringify(mappedInputId(prepared.sessionKey,prepared.inputId))};
let c;const runtimeKind=${JSON.stringify(runtimeKind)};const session='controlled-native-node';let sdkSeq=0;
const send=(type,payload)=>process.send({type,payload});
const raw=(kind,body,extra={})=>{const r={kind,sessionId:session,agentPath:[],seq:sdkSeq++,receivedAt:Date.now(),body,...extra};send('raw',r);return r;};
process.send({type:'ready'});
process.on('message',m=>{
 if(m.type==='config'){c=m.config;send('created',{runtime:c.prepared.runtime,nativeSession:session});}
 if(m.type==='input'){
  if(m.initial){
   raw('request',{kind:'prompt',input:m.input,inputId:nativeId},{direction:'toRuntime',id:'controlled-request'});
   send('control',{action:'prompt_ack',inputId:m.id,nativeInputId:nativeId,acknowledgement:{kind:'accepted'}});
   const callId='original-calculator';
   if(runtimeKind==='opencode'){
    const opening=raw('frame',{type:'tool_call',native:{sessionId:session,update:{sessionUpdate:'tool_call',toolCallId:callId,title:'Bash',kind:'execute',status:'pending',rawInput:{cwd:c.workDirectory}}},events:[]});
    send('event',{kind:'tool_call_started',callId,tool:'Bash',input:JSON.stringify({cwd:c.workDirectory}),sessionId:session,agentPath:[],seq:opening.seq,receivedAt:opening.receivedAt});
    for(let repeat=0;repeat<3;repeat++){
     const frame=raw('frame',{type:'tool_call_update',native:{sessionId:session,update:{sessionUpdate:'tool_call_update',toolCallId:callId,status:'in_progress',rawInput:{command,cwd:c.workDirectory}}},events:[]});
     // Pinned ACP projection emits input only when it changes. Repeated raw
     // command updates remain present even when they yield no normalized event.
     if(repeat===0)send('event',{kind:'tool_call_input',callId,input:JSON.stringify({command,cwd:c.workDirectory}),sessionId:session,agentPath:[],seq:frame.seq,receivedAt:frame.receivedAt});
    }
   }else{
    const frame=raw('frame',{type:'tool_execution_start',native:{type:'tool_execution_start',toolName:'bash',toolCallId:callId,args:{command}},events:[]});
    send('event',{kind:'tool_call_started',callId,tool:'bash',input:JSON.stringify({command}),sessionId:session,agentPath:[],seq:frame.seq,receivedAt:frame.receivedAt});
   }
   const child=spawn(process.execPath,['-e',script],{cwd:c.workDirectory,stdio:['ignore','pipe','pipe']});
   let stdout='';child.stdout.on('data',b=>stdout+=b);
   child.on('close',code=>{
    if(code!==0){process.send({type:'failure',reason:'Actual calculator failed'});return;}
    const measured=JSON.parse(stdout);
    const end=runtimeKind==='opencode'
     ?raw('frame',{type:'tool_call_update',native:{sessionId:session,update:{sessionUpdate:'tool_call_update',toolCallId:callId,status:'completed'}},events:[]})
     :raw('frame',{type:'tool_execution_end',native:{type:'tool_execution_end',toolCallId:callId},events:[]});
    send('event',{kind:'tool_call_ended',callId,sessionId:session,agentPath:[],seq:end.seq,receivedAt:end.receivedAt});
    send('received',{inputId:m.id,evidence:'actual-controlled-node-calculator-completed'});
    send('terminal',{inputId:m.id,outcome:{kind:'completed'}});
    process.send({type:'finished',inputId:m.id,text:JSON.stringify({schemaVersion:'oracle/1',value:{answer:measured.answer},artifacts:[{name:'product',path:'product.txt',sha256:measured.sha256,runId:'run',taskId:'task',effectId:'effect'}],diagnostics:[]})});
   });
  }else{
   send('received',{inputId:m.id,evidence:'actual-controlled-node-ordinary-ipc'});
   send('terminal',{inputId:m.id,outcome:{kind:'completed'}});
   process.send({type:'finished',inputId:m.id,text:'Observed the ordinary human question.'});
  }
 }
});setInterval(()=>{},1000);
`);
  const assets={oarModule:'controlled-no-sdk',nodeExecutable:process.execPath,opencodeCommand:'controlled-no-cli',opencodeVersion:'fixture'};
  const runtime=new localModule.OarLocalMemberRuntime({home,nodeExecutable:process.execPath,runnerModule:runner,assets});
  let primaryCloseUnknown=false;
  t.after(async()=>{
    const closed=await runtime.stopAll();
    if(closed.some(receipt=>!receipt.closed)){
      t.diagnostic('Retained unproved native barrier Home: '+home);
      throw Error('Test-owned native family closure remains unproved: '+JSON.stringify(closed));
    }
    if(primaryCloseUnknown){t.diagnostic('Retained failed primary native barrier Home: '+home);return;}
    await rm(home,{recursive:true,force:true});
  });
  const lease=await runtime.stage({prepared,model:{provider:'fixture',model:'controlled-node',baseUrl:'https://fixture.invalid',apiKey:'test-private'},outputSchemaVersion:'oracle/1',assets},[]);
  await runtime.start(lease);
  const rows=async()=>(await runtime.read(lease)).journal.trim().split('\n').filter(Boolean).map((line:string)=>JSON.parse(line));
  await waitUntil('actual managed Node created',async()=> (await rows()).some((r:any)=>r.kind==='created'),3000,10);
  await runtime.authorize(lease,{sessionKey:prepared.sessionKey,generation:0,nativeSession:'controlled-native-node',inputId:prepared.inputId});
  const born=await runtime.recover(prepared.sessionKey);assert.ok(born);
  let proof:any;
  await waitUntil('actual calculator PID entered marker',async()=>{
    const current=await rows();if(!current.some((r:any)=>r.kind==='control'&&r.payload?.action==='prompt_ack'))return false;
    if(runtimeKind==='opencode'&&current.filter((r:any)=>r.kind==='raw'&&r.payload.body?.native?.update?.status==='in_progress').length!==3)return false;
    proof=await proveBusy(prepared,born,current,barrier);return !!proof;
  },3000,10);
  const before=await rows();
  if(runtimeKind==='opencode'){
    const repeated=before.filter((r:any)=>r.kind==='raw'&&r.payload.body?.native?.update?.status==='in_progress');
    assert.equal(repeated.length,3);assert.deepEqual(proof.matchedSdkSeqs,repeated.map((r:any)=>r.payload.seq));
    assert.equal(proof.sdkSeq,repeated[0].payload.seq,'earliest native exact-command frame owns normalized input proof');
    assert.equal(before.filter((r:any)=>r.kind==='event'&&r.payload?.kind==='tool_call_input').length,1,'identical ACP repeats have no duplicate projected input');
    const secondCall=structuredClone(repeated[2]);secondCall.payload.body.native.update.toolCallId='second-distinct-calculator';
    secondCall.payload.seq++;secondCall.seq++;
    assert.throws(()=>nativeCommandEvidence(prepared,[...before,secondCall],barrier),/second distinct native calculator call/);
    const omittedCwd=structuredClone(before);
    for(const row of omittedCwd.filter((r:any)=>r.kind==='raw'&&r.payload.body?.native?.update?.status==='in_progress'))
      delete row.payload.body.native.update.rawInput.cwd;
    const actualCwdProof=await proveBusy(prepared,born,omittedCwd,barrier);
    assert.equal(actualCwdProof?.commandCwd,undefined,'ACP may omit an optional CWD field');
    assert.equal(actualCwdProof?.entered.cwd,lease.workDirectory,'actual managed calculator still proves its CWD');
  }
  // Independent negative oracle predicates; no product permission claim.
  assert.throws(()=>nativeCommandEvidence(prepared,[...before,{...before[0],kind:'event',payload:{kind:'tool_call_ended',callId:proof.callId}}],barrier),/already completed/);
  const wrongSession=structuredClone(before);wrongSession.find((r:any)=>r.kind==='raw'&&r.payload.body?.type===(runtimeKind==='opencode'?'tool_call_update':'tool_execution_start')).payload.sessionId='foreign';
  assert.throws(()=>nativeCommandEvidence(prepared,wrongSession,barrier));
  const wrongCall=structuredClone(before);wrongCall.find((r:any)=>r.kind==='event'&&r.payload.kind==='tool_call_started').payload.callId='foreign';
  assert.throws(()=>nativeCommandEvidence(prepared,wrongCall,barrier));
  assert.equal(nativeCommandEvidence(prepared,before,{...barrier,command:barrier.command.replace(barrier.nonce,'wrong-nonce')}),undefined);
  const markerPath=path.join(lease.workDirectory,barrier.enteredName);
  await writeFile(markerPath,JSON.stringify({...proof.entered,nonce:'wrong-marker-nonce'}));
  await assert.rejects(()=>proveBusy(prepared,born,before,barrier));
  await writeFile(markerPath,JSON.stringify(proof.entered));
  await assert.rejects(()=>releaseAfterHuman(proof,barrier,new Date(Date.parse(proof.entered.enteredAt)-1).toISOString()),/entered must precede/);
  // Atomic complete publication has an executable positive path and refuses
  // overwrite/deadline expiry without exposing or retaining partial final JSON.
  const publication=path.join(home,'publication-probe.json'),published={nonce:barrier.nonce,payload:'x'.repeat(2048)};
  await publishCompleteMarker(publication,published,deadlineAt);
  assert.deepEqual(JSON.parse(await readFile(publication,'utf8')),published);
  await assert.rejects(()=>publishCompleteMarker(publication,{nonce:'replacement'},deadlineAt),(e:any)=>e.code==='EEXIST');
  assert.deepEqual(JSON.parse(await readFile(publication,'utf8')),published);
  const expired=path.join(home,'expired-publication.json');
  await assert.rejects(()=>publishCompleteMarker(expired,published,new Date(Date.now()-1).toISOString()),/deadline exceeded/);
  await assert.rejects(()=>readFile(expired,'utf8'),(e:any)=>e.code==='ENOENT');
  assert.equal((await readdir(home)).filter(name=>name.startsWith('publication-probe.json.')||name.startsWith('expired-publication.json.')).length,0,'owned temporary files removed after publication/refusal');
  assert.equal((await readdir(lease.workDirectory)).filter(name=>name.startsWith(barrier.enteredName+'.')).length,0,'native entered marker published complete with temporary removed');
  const human={schema:'hima-team-message/1',source:{sender:{kind:'human'},createdAt:new Date().toISOString()},peerText:{trust:'untrusted',text:'Observation only.'}};
  await writeFile(path.join(home,'persisted-human.json'),JSON.stringify(human),{flag:'wx'});
  await runtime.sendInput(lease,'ordinary-question',JSON.stringify(human));
  assert.deepEqual(JSON.parse(await readFile(path.join(home,'persisted-human.json'),'utf8')),human);
  const queued=await rows();assert.equal(queued.filter((r:any)=>r.kind==='received'&&r.payload?.inputId==='ordinary-question').length,0);
  assert.ok(await proveBusy(prepared,born,queued,barrier));
  const release=await releaseAfterHuman(proof,barrier,human.source.createdAt);
  await waitUntil('actual ordinary native IPC receipt and terminal after release',async()=> (await rows()).some((r:any)=>r.kind==='terminal'&&r.payload?.inputId==='ordinary-question'),3000,10);
  const after=await rows(),original=after.find((r:any)=>r.kind==='terminal'&&r.payload?.inputId===prepared.inputId);
  assertBarrierOrder(proof,release,human.source.createdAt,after,original);
  assert.throws(()=>assertBarrierOrder(proof,{...release,releasedAt:new Date(Date.parse(human.source.createdAt)-1).toISOString()},human.source.createdAt,after,original));
  const originalReceives=after.filter((r:any)=>r.kind==='received'&&r.payload?.inputId===prepared.inputId);
  const ordinaryReceives=after.filter((r:any)=>r.kind==='received'&&r.payload?.inputId==='ordinary-question');
  const ordinaryTerminals=after.filter((r:any)=>r.kind==='terminal'&&r.payload?.inputId==='ordinary-question');
  assert.equal(originalReceives.length,1);assert.equal(ordinaryReceives.length,1);assert.equal(ordinaryTerminals.length,1);
  assert.ok(original.seq<ordinaryReceives[0].seq&&ordinaryReceives[0].seq<ordinaryTerminals[0].seq);
  assert.equal(await readFile(path.join(lease.workDirectory,'product.txt'),'utf8'),'703');
  const delivered=await runtime.read(lease);
  assert.ok(delivered.result,'same-value artifact must remain deliverable when its JSON keys arrive in a different order');
  assert.deepEqual(JSON.parse(delivered.result).output.artifacts[0],{
    runId:'run',taskId:'task',effectId:'effect',name:'product',path:'product.txt',sha256:digest('703'),
  });
  const closure=await runtime.close(lease);
  if(!closure.closed){primaryCloseUnknown=true;await writeFile(path.join(home,'primary-close.json'),JSON.stringify(closure),{mode:0o600});}
  assert.equal(closure.closed,true,JSON.stringify(closure));assert.ok(closure.proof?.absent);
  for(const pid of closure.proof?.pids??[])assert.throws(()=>process.kill(pid,0),(e:any)=>e.code==='ESRCH');
  t.diagnostic(JSON.stringify({level:'L2-public-Local-actual-Node',productModelCalls:0,nativeSdkCalls:0,protocolRuntime:runtimeKind,qualification:'controlled protocol oracle only; no actual Pi/OpenCode receive qualification'}));
});
