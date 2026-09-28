import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFile,mkdir,readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { localHome,waitUntil } from './support/fabric.ts';
import { bootInProcess,createRootAgent,resumeTestAgent } from './support/boot-inprocess.ts';
import { appendReplaySession,writeMomentScenario } from './support/moments.ts';
import { repoRoot } from './support/dsh-home.ts';
import { writeReplayOverlay } from '../../packages/desktop/src/hima-home.ts';
import { QUIET_TITLE_ROW } from './support/pipeline.ts';
import { timingProbePackId } from './support/pack.ts';
import { delegationRuntimePolicy,delegationToolDenial,readNativeSessionContext,retainRunMaterial,runDelegations } from '@hima/harness';

process.env.HIMA_TEST_LEGACY_AUTO_DRIVE='0';
process.env.HIMA_TEST_SILENT_AGENT='1';
test('two independent native children share one Run budget and retain separate results',async t=>{
 const home=await localHome(t,{sleepSeconds:0});assert.ok(home);
 let replay=await writeMomentScenario(home.h,'coding',path.join(repoRoot,'test/fixtures/delegation'));
 replay=await appendReplaySession(replay,'parallel-reviewer',[{kind:'chunks',chunks:[
  {type:'block-start',index:0,blockType:'text'},
  {type:'block-end',index:0,block:{type:'text',text:'Independent reviewer completed its own task.'}},
  {type:'finish',reason:{kind:'stop'}},
 ]}]);
 await writeReplayOverlay(home.h.home,{file:replay.file,overrideFile:replay.override,childFiles:replay.children});
 await appendFile(path.join(home.h.profileDir,'cordis.patch.yml'),QUIET_TITLE_ROW);
 const host=await bootInProcess(home.h);let runId:string|undefined;
 try{
  const owner=await createRootAgent(host.ctx,home.h.home);const actor=String(owner.id);
  const started=await host.ctx.hima.startRun({pack:timingProbePackId,site:'local',goal:{target_period_ns:2},ownerSessionId:actor,timeBoxMs:60000});
  assert.equal(started.kind,'ran');if(started.kind!=='ran')return;runId=started.run.id;
  const privateRoot=path.dirname(replay.readyFile);await mkdir(privateRoot,{recursive:true});
  const inputRecord=host.ctx.hima.ledger.records({runId})[0];assert.ok(inputRecord);
  const coder=await host.ctx.hima.delegate({runId,actor,action:'create',requestId:'parallel-coder',expectedEpoch:1,expectedRevision:0,
   contract:{delegationId:'coder',role:'coding',task:'Write only the assigned private file.',inputRefs:[],allowedTools:['read','write','edit'],writeScope:{root:privateRoot},budgetShare:{maxElapsedMs:25000,maxFollowups:0},dependencyIds:[],recipient:{kind:'run-owner',sessionId:actor}}}) as any;
  assert.equal(coder.status,'created',JSON.stringify(coder));
  let control=host.ctx.hima.executionContext(runId).run.control!;
  const reviewer=await host.ctx.hima.delegate({runId,actor,action:'create',requestId:'parallel-reviewer',expectedEpoch:control.epoch,expectedRevision:control.revision,
   contract:{delegationId:'reviewer',role:'reviewer',task:'Inspect the retained Run input independently and report.',inputRefs:[inputRecord.id],allowedTools:['hima_delegation_input'],budgetShare:{maxElapsedMs:25000,maxFollowups:0},dependencyIds:[],recipient:{kind:'run-owner',sessionId:actor}}}) as any;
  assert.equal(reviewer.status,'created',JSON.stringify(reviewer));
  assert.deepEqual(reviewer.effectiveContract.tools,['hima_delegation_input']);
  const firstId=coder.receipt.childSessionId,secondId=reviewer.receipt.childSessionId;
  assert.notEqual(firstId,secondId);
  assert.equal(runDelegations((host.ctx.hima as any).deps(),runId).length,2);
  control=host.ctx.hima.executionContext(runId).run.control!;
  const excess=await host.ctx.hima.delegate({runId,actor,action:'create',requestId:'parallel-excess',expectedEpoch:control.epoch,expectedRevision:control.revision,
   contract:{delegationId:'excess',role:'reviewer',task:'This share exceeds the parent time box.',inputRefs:[inputRecord.id],allowedTools:['hima_delegation_input'],budgetShare:{maxElapsedMs:15000,maxFollowups:0},dependencyIds:[],recipient:{kind:'run-owner',sessionId:actor}}}) as any;
  assert.equal(excess.status,'refused');assert.match(excess.reason,/Child shares exceed/);
  await waitUntil('both native child results are retained',async()=>{
   try{
    const written=await readFile(replay.readyFile,'utf8');
    const log=await host.ctx.get('sessionQuery')!.readSession(secondId as never);
    return written==='export const answer = 42;\n' && JSON.stringify(log.events).includes('Independent reviewer completed its own task');
   }catch{return false;}
  },5000,25);
  assert.equal(await readFile(replay.readyFile,'utf8'),'export const answer = 42;\n');
  const reviewerLog=await host.ctx.get('sessionQuery')!.readSession(secondId as never);
  assert.match(JSON.stringify(reviewerLog.events),/Independent reviewer completed its own task/);
  assert.equal(host.ctx.hima.ledger.records({runId,type:'delegation'}).filter(row=>row.type==='delegation'&&row.event==='create-intent').length,2);
 }finally{if(runId)await host.ctx.hima.cancelRun(runId);await host.dispose();await home.h.dispose();}
});
test('delegated structured observations compact JSON without discarding endpoint evidence',async t=>{
 const home=await localHome(t,{sleepSeconds:0});assert.ok(home);const host=await bootInProcess(home.h);let runId:string|undefined;
 try{
  const owner=await createRootAgent(host.ctx,home.h.home);const actor=String(owner.id);
  const started=await host.ctx.hima.startRun({pack:timingProbePackId,site:'local',goal:{target_period_ns:2},ownerSessionId:actor,timeBoxMs:60000});
  assert.equal(started.kind,'ran');if(started.kind!=='ran')return;runId=started.run.id;
  const value={schema:'xtop-timing-closure-state/1',database:{files:Array.from({length:200},(_,index)=>({path:`db/file-${index}.bin`,sha256:'a'.repeat(64),bytes:1}))},
   endpointSlackNs:Object.fromEntries(Array.from({length:200},(_,index)=>[`scenario|hold|endpoint/${index}`,-0.1])),metrics:{setup_wns_ns:-0.04,hold_wns_ns:-0.16}};
  const text=JSON.stringify(value,null,2);const digest=createHash('sha256').update(text).digest('hex');
  assert.ok(Buffer.byteLength(JSON.stringify({material:{text,truncated:false}}))>40000&&Buffer.byteLength(JSON.stringify({material:{encoding:'json',value,truncated:false}}))<40000);
  const retainedPath=await retainRunMaterial({ledger:host.ctx.hima.ledger,packsDir:path.join(home.h.home,'hima/packs')},runId,Buffer.from(text),digest);assert.ok(retainedPath);
  const observation=await host.ctx.hima.ledger.appendObservation(runId,{path:'flow/state/current.json',contentSha256:digest,retainedPath,bytes:Buffer.byteLength(text),
   reader:{id:'xtop-closure-state',version:'1',reportKind:'xtop-timing-closure-state/1',emits:['xtop_hold_wns']},values:[{type:'xtop_hold_wns',unit:'ns',value:-0.16}]});
  const child=await host.ctx.hima.delegate({runId,actor,action:'create',requestId:'compact-observation-child',expectedEpoch:1,expectedRevision:0,
   contract:{delegationId:'compact-observation-child',role:'researcher',task:'Read the exact structured observation.',inputRefs:[observation.id],allowedTools:['hima_delegation_input'],
    budgetShare:{maxElapsedMs:5000,maxFollowups:0},dependencyIds:[],recipient:{kind:'run-owner',sessionId:actor}}}) as any;
  assert.equal(child.status,'created',JSON.stringify(child));
  const supplied=await host.ctx.hima.delegationInput(child.receipt.childSessionId,{runId,recordId:observation.id}) as any;
  assert.equal(supplied.kind,'record-fact',JSON.stringify(supplied));assert.equal(supplied.payload.material.encoding,'json');
  assert.equal(supplied.payload.material.value.endpointSlackNs['scenario|hold|endpoint/199'],-0.1);
  assert.equal(supplied.payload.contentSha256,digest,'the compact view remains bound to the original retained report bytes');
 }finally{if(runId)await host.ctx.hima.cancelRun(runId);await host.dispose();await home.h.dispose();}
});
test('real Run delegation recovers a cold completed result, gates dependencies, and keeps lifecycle/tool authority truthful',async t=>{
 const home=await localHome(t,{sleepSeconds:0});assert.ok(home);
 const replay=await writeMomentScenario(home.h,'coding',path.join(repoRoot,'test/fixtures/delegation'));
 await writeReplayOverlay(home.h.home,{file:replay.file,overrideFile:replay.override,childFiles:replay.children});
 await appendFile(path.join(home.h.profileDir,'cordis.patch.yml'),QUIET_TITLE_ROW);
 let host=await bootInProcess(home.h);let runId:string|undefined;let ownerModel:{provider:string;model:string}|undefined;
 try{
  const owner=await createRootAgent(host.ctx,home.h.home);const actor=String(owner.id);ownerModel={provider:owner.options.provider!,model:owner.options.model!};const privateRoot=path.dirname(replay.readyFile);await mkdir(privateRoot,{recursive:true});
  const started=await host.ctx.hima.startRun({pack:timingProbePackId,site:'local',goal:{target_period_ns:2},ownerSessionId:actor,timeBoxMs:60000});assert.equal(started.kind,'ran');if(started.kind!=='ran')return;runId=started.run.id;
  const request={runId,actor,action:'create' as const,requestId:'create-coder',expectedEpoch:1,expectedRevision:0,contract:{delegationId:'coder',role:'coding',task:'Write the requested candidate into the assigned private directory.',inputRefs:[],allowedTools:['read','write','edit'],writeScope:{root:privateRoot},budgetShare:{maxElapsedMs:30000,maxFollowups:1},dependencyIds:[],recipient:{kind:'run-owner',sessionId:actor}}};
  const first=await host.ctx.hima.delegate(request) as any;assert.equal(first.status,'created',JSON.stringify(first));
  const childId=first.receipt.childSessionId;assert.ok(childId);
  const nativeChild=host.ctx.get('agents')?.get(childId as never);assert.ok(nativeChild);
  let watchdog:ReturnType<typeof setTimeout>|undefined;try {await Promise.race([nativeChild.whenIdle(),new Promise((_,reject)=>{watchdog=setTimeout(()=>reject(new Error(JSON.stringify({status:nativeChild.status,messages:nativeChild.session.deriveMessages()}))),4000);})]);}finally{clearTimeout(watchdog);}
  const unrelated=await createRootAgent(host.ctx,home.h.home);
  await assert.rejects(readNativeSessionContext(host.ctx,{sessionId:String(unrelated.id),targetSessionId:childId,parentSessionId:actor},host.ctx.hima.ledger),{code:'hima/not-authorized'},'same workspace does not grant an unrelated conversation the child transcript');
  assert.equal(await readFile(replay.readyFile,'utf8'),'export const answer = 42;\n');
  assert.equal(host.ctx.hima.ledger.records({runId,type:'delegation'}).some(r=>r.type==='delegation'&&r.event==='result-observed'),false,'completion is not invented before the native result is explicitly observed');
  const repeat=await host.ctx.hima.delegate(request) as any;assert.equal(repeat.status,'duplicate');assert.equal(repeat.receipt.childSessionId,childId);
  const list=await host.ctx.hima.delegations(actor,runId) as any;assert.equal(list.delegations.length,1);assert.equal(list.delegations[0].effective.budgetShare.maxElapsedMs,30000);
  let control=host.ctx.hima.executionContext(runId).run.control!;
  const over=await host.ctx.hima.delegate({...request,requestId:'over-budget',expectedRevision:control.revision,contract:{...request.contract,delegationId:'over',budgetShare:{maxElapsedMs:60000,maxFollowups:0}}}) as any;assert.equal(over.status,'refused');
  await host.dispose();
  // The resumed owner is replay session #1, so the cold child is #2. Both
  // scripted calls answer with one distinct refinement, without re-running
  // the initial file write when the Host starts a new replay adapter.
  const coldReplay=await writeMomentScenario(home.h,'cold-followup',path.join(repoRoot,'test/fixtures/delegation'));
  await writeReplayOverlay(home.h.home,{file:coldReplay.file,overrideFile:coldReplay.override,childFiles:coldReplay.children});
  await appendFile(path.join(home.h.profileDir,'cordis.patch.yml'),QUIET_TITLE_ROW);
  host=await bootInProcess(home.h);await host.ctx.hima.reconciled;
  await resumeTestAgent(host.ctx,actor,ownerModel);
  assert.equal(host.ctx.hima.ledger.records({runId,type:'delegation'}).filter(r=>r.type==='delegation'&&r.event==='create-intent').length,1);
  assert.equal(host.ctx.get('agents')?.get(childId as never),undefined,'restart does not respawn or drive the completed child');

  control=host.ctx.hima.executionContext(runId).run.control!;
  const cold=await host.ctx.hima.delegate({runId,actor,action:'result',delegationId:'coder',requestId:'observe-cold-result',expectedEpoch:control.epoch,expectedRevision:control.revision}) as any;
  assert.equal(cold.status,'candidate',JSON.stringify(cold));assert.equal(cold.source,'native-persisted-session');
  control=host.ctx.hima.executionContext(runId).run.control!;
  const sameTurn=await host.ctx.hima.delegate({runId,actor,action:'result',delegationId:'coder',requestId:'observe-same-completed-turn-again',expectedEpoch:control.epoch,expectedRevision:control.revision}) as any;
  assert.equal(sameTurn.status,'unavailable',JSON.stringify(sameTurn));assert.match(sameTurn.unknowns.join(' '),/no newer completed turn/);
  assert.equal(host.ctx.hima.ledger.records({runId,type:'delegation'}).filter(r=>r.type==='delegation'&&r.event==='result-observed').length,1,
    'a new request id cannot relabel the same completed native turn as a new candidate');
  control=host.ctx.hima.executionContext(runId).run.control!;
  const cancelComplete=await host.ctx.hima.delegate({runId,actor,action:'cancel',delegationId:'coder',requestId:'cancel-completed',expectedEpoch:control.epoch,expectedRevision:control.revision}) as any;
  assert.equal(cancelComplete.status,'refused');
  assert.equal(cold.evidence.artifactRefs.length,1);assert.match(cold.evidence.artifactRefs[0].sha256,/^[0-9a-f]{64}$/);
  const resultRecord=host.ctx.hima.ledger.records({runId,type:'delegation'}).find(r=>r.type==='delegation'&&r.event==='result-observed');assert.ok(resultRecord);assert.equal(resultRecord.type,'delegation');
  const contractRecord=host.ctx.hima.ledger.records({runId,type:'delegation'}).find(r=>r.type==='delegation'&&r.delegationId==='coder'&&r.event==='create-intent');assert.ok(contractRecord);assert.equal(contractRecord.type,'delegation');
  const retainedHandoff=(resultRecord.payload as any).handoff;
  assert.match(retainedHandoff.outputIdentity,/^[0-9a-f]{64}$/);
  assert.equal(retainedHandoff.contract.recordId,contractRecord.id,'the handoff traces task/inputRefs to the exact retained contract instead of copying another task fact');
  assert.equal(retainedHandoff.contract.requestDigest,contractRecord.requestDigest);
  assert.deepEqual(retainedHandoff.completedTurn,cold.completedTurn);
  assert.match(retainedHandoff.output.text,/owner|parent/);
  assert.deepEqual(retainedHandoff.unknowns,cold.unknowns);
  assert.deepEqual(retainedHandoff.evidence,cold.evidence);
  assert.equal('nativeMessages' in retainedHandoff,false,'the Ledger handoff does not mirror the native transcript');
  assert.equal(runDelegations((host.ctx.hima as any).deps?.()??{ledger:host.ctx.hima.ledger},runId).find(row=>row.delegationId==='coder')?.state,'completed');
  control=host.ctx.hima.executionContext(runId).run.control!;
  const adopted=await host.ctx.hima.delegate({runId,actor,action:'adopt',delegationId:'coder',requestId:'adopt-coder-result',expectedEpoch:control.epoch,expectedRevision:control.revision}) as any;
  assert.equal(adopted.status,'accepted',JSON.stringify(adopted));assert.equal(adopted.resultRecordId,resultRecord.id);
  const adoptedRow=runDelegations((host.ctx.hima as any).deps?.()??{ledger:host.ctx.hima.ledger},runId).find(row=>row.delegationId==='coder');
  assert.match(adoptedRow?.adoptedRecordId??'',/^run-/);assert.equal(adoptedRow?.state,'completed');
  control=host.ctx.hima.executionContext(runId).run.control!;
  const duplicateAdoption=await host.ctx.hima.delegate({runId,actor,action:'adopt',delegationId:'coder',requestId:'adopt-coder-result',expectedEpoch:control.epoch,expectedRevision:control.revision}) as any;
  assert.equal(duplicateAdoption.status,'duplicate');assert.equal(duplicateAdoption.adoptedRecordId,adopted.adoptedRecordId);

  control=host.ctx.hima.executionContext(runId).run.control!;
  const reviewer=await host.ctx.hima.delegate({runId,actor,action:'create',requestId:'create-reviewer',expectedEpoch:control.epoch,expectedRevision:control.revision,contract:{delegationId:'reviewer',role:'reviewer',task:'Review only the exact retained child result supplied by the parent.',inputRefs:[resultRecord.id],allowedTools:['hima_delegation_input'],budgetShare:{maxElapsedMs:5000,maxFollowups:0},dependencyIds:['coder'],recipient:{kind:'run-owner',sessionId:actor}}}) as any;
  assert.equal(reviewer.status,'created',JSON.stringify(reviewer));const reviewerId=reviewer.receipt.childSessionId as string;
  const supplied=await host.ctx.hima.delegationInput(reviewerId,{runId,recordId:resultRecord.id}) as any;
  assert.equal(supplied.kind,'record-fact',JSON.stringify(supplied));assert.equal(supplied.payload.candidateOnly,true);assert.match(supplied.payload.text,/owner|parent/);
  await assert.rejects(host.ctx.hima.delegationInput(reviewerId,{runId,recordId:'not-granted'}),/no current grant/);
  control=host.ctx.hima.executionContext(runId).run.control!;
  const follow=await host.ctx.hima.delegate({runId,actor,action:'followup',delegationId:'coder',requestId:'refine-after-result',text:'Confirm this same native child received the refinement.',expectedEpoch:control.epoch,expectedRevision:control.revision}) as any;
  assert.equal(follow.status,'accepted',JSON.stringify(follow));
  assert.equal(follow.receipt.childSessionId,childId,'one result does not force a new child or reset the Run');
  try {await waitUntil('same persisted child receives the follow-up',async()=>{
    const log=await host.ctx.get('sessionQuery')?.readSession(childId as never);
    return JSON.stringify(log?.events).includes('Follow-up received in the same native child session.');
  },5000,50);}catch(error){
    const log=await host.ctx.get('sessionQuery')?.readSession(childId as never);
    t.diagnostic(JSON.stringify({child:host.ctx.get('agents')?.get(childId as never)?.status,
      policy:delegationRuntimePolicy((host.ctx.hima as any).deps(),childId),
      events:log?.events.slice(-12).map((event:{seq:number;type?:string;data?:unknown})=>({seq:event.seq,type:event.type,body:JSON.stringify(event.data).slice(0,500)}))}));
    throw error;
  }
  const returned=await host.ctx.get('sessionQuery')!.readSession(childId as never);
  assert.equal(String(returned.session.id),childId,'cold follow-up uses the existing native session');
  const retainedAfterFollowup=await host.ctx.hima.delegationInput(reviewerId,{runId,recordId:resultRecord.id}) as any;
  assert.equal(retainedAfterFollowup.kind,'record-fact',JSON.stringify(retainedAfterFollowup));
  assert.equal(retainedAfterFollowup.payload.outputIdentity,retainedHandoff.outputIdentity);
  assert.equal(retainedAfterFollowup.payload.contractRecordId,contractRecord.id);
  assert.equal(retainedAfterFollowup.payload.task,request.contract.task);
  assert.deepEqual(retainedAfterFollowup.payload.inputRefs,request.contract.inputRefs);
  assert.match(retainedAfterFollowup.payload.text,/owner|parent/);
  assert.doesNotMatch(retainedAfterFollowup.payload.text,/Follow-up received/,'an old result record remains bound to its original completed turn');
  control=host.ctx.hima.executionContext(runId).run.control!;
  const refinedResult=await host.ctx.hima.delegate({runId,actor,action:'result',delegationId:'coder',requestId:'observe-refined-result',expectedEpoch:control.epoch,expectedRevision:control.revision}) as any;
  assert.equal(refinedResult.status,'candidate',JSON.stringify(refinedResult));
  const refinedRow=runDelegations((host.ctx.hima as any).deps(),runId).find(row=>row.delegationId==='coder');
  assert.equal(refinedRow?.adoptedRecordId,undefined,
    'a prior adoption never floats forward to a later follow-up result');
  await host.dispose();host=await bootInProcess(home.h);await host.ctx.hima.reconciled;await resumeTestAgent(host.ctx,actor,ownerModel);
  const retainedAfterRestart=await host.ctx.hima.delegationInput(reviewerId,{runId,recordId:resultRecord.id}) as any;
  assert.equal(retainedAfterRestart.kind,'record-fact',JSON.stringify(retainedAfterRestart));
  assert.equal(retainedAfterRestart.payload.outputIdentity,retainedHandoff.outputIdentity);
  assert.equal(retainedAfterRestart.payload.text,retainedAfterFollowup.payload.text,'Host restart reads the immutable handoff instead of the child latest turn');
  const reopened=runDelegations((host.ctx.hima as any).deps(),runId).find(row=>row.delegationId==='coder');
  assert.equal(reopened?.state,'completed','the refined completed turn remains a new candidate, not an inherited adoption');
  control=host.ctx.hima.executionContext(runId).run.control!;
  const exhausted=await host.ctx.hima.delegate({runId,actor,action:'followup',delegationId:'coder',requestId:'refine-over-cap',text:'Do not spend another child turn.',expectedEpoch:control.epoch,expectedRevision:control.revision}) as any;
  assert.equal(exhausted.status,'refused');



  control=host.ctx.hima.executionContext(runId).run.control!;
  await host.ctx.hima.executionAction({runId,actor,origin:'human',action:'pause',requestId:'hold-parent',expectedEpoch:control.epoch,expectedRevision:control.revision});
  control=host.ctx.hima.executionContext(runId).run.control!;
  const heldAdoption=await host.ctx.hima.delegate({runId,actor,action:'adopt',delegationId:'coder',requestId:'adopt-while-held',expectedEpoch:control.epoch,expectedRevision:control.revision}) as any;
  assert.equal(heldAdoption.status,'refused','durable handoff readability does not weaken active unheld owner adoption');
  const pausedPolicy=delegationRuntimePolicy((host.ctx.hima as any).deps(),reviewerId);assert.equal(pausedPolicy?.toolsAllowed,true);assert.equal(pausedPolicy?.writesAllowed,false);
  const reviewerAgent={id:reviewerId,options:{provider:reviewer.effectiveContract.model.provider,model:reviewer.effectiveContract.model.model,maxTokens:reviewer.effectiveContract.model.maxTokensPerTurn}};
  assert.equal(delegationToolDenial(id=>delegationRuntimePolicy((host.ctx.hima as any).deps(),id),{name:'hima_delegation_input',arguments:{runId,recordId:resultRecord.id},agent:reviewerAgent} as never),undefined,'human pause preserves exact read-only observation');
  control=host.ctx.hima.executionContext(runId).run.control!;
  const cancelled=await host.ctx.hima.delegate({runId,actor,action:'cancel',delegationId:'reviewer',requestId:'cancel-reviewer',expectedEpoch:control.epoch,expectedRevision:control.revision}) as any;
  assert.equal(cancelled.status,'accepted');
  const cancelledRow=runDelegations((host.ctx.hima as any).deps(),runId).find(row=>row.delegationId==='reviewer')!;
  assert.equal(cancelledRow.state,cancelled.receipt.effect==='confirmed'?'cancelled':'cancel-requested');
  assert.equal(cancelledRow.stopObserved,cancelled.receipt.effect==='confirmed'?true:'unknown');
  const cancelledPolicy=delegationRuntimePolicy((host.ctx.hima as any).deps(),reviewerId);assert.equal(cancelledPolicy?.toolsAllowed,false,JSON.stringify(cancelledPolicy));
  assert.match(delegationToolDenial(id=>delegationRuntimePolicy((host.ctx.hima as any).deps(),id),{name:'hima_delegation_input',arguments:{runId,recordId:resultRecord.id},agent:reviewerAgent} as never)??'',/cancel/,'cancel fences reads as well as writes');

  control=host.ctx.hima.executionContext(runId).run.control!;
  await host.ctx.hima.executionAction({runId,actor,origin:'human',action:'continue',requestId:'continue-parent',expectedEpoch:control.epoch,expectedRevision:control.revision});
  control=host.ctx.hima.executionContext(runId).run.control!;
  const expiringRoot=path.join(privateRoot,'expiring');await mkdir(expiringRoot);
  const expiring=await host.ctx.hima.delegate({runId,actor,action:'create',requestId:'create-expiring',expectedEpoch:control.epoch,expectedRevision:control.revision,contract:{delegationId:'expiring',role:'coding',task:'Inspect the empty private task directory.',inputRefs:[],allowedTools:['read'],writeScope:{root:expiringRoot},budgetShare:{maxElapsedMs:100,maxFollowups:0},dependencyIds:[],recipient:{kind:'run-owner',sessionId:actor}}}) as any;
  assert.equal(expiring.status,'created',JSON.stringify(expiring));
  await waitUntil('the durable delegation deadline is folded truthfully',()=>runDelegations((host.ctx.hima as any).deps(),runId!).find(row=>row.delegationId==='expiring')?.state==='expired',3000,20);
  const expired=runDelegations((host.ctx.hima as any).deps(),runId).find(row=>row.delegationId==='expiring')!;
  assert.equal(expired.state,'expired');assert.ok(expired.stopObserved===true||expired.stopObserved==='unknown');
  control=host.ctx.hima.executionContext(runId).run.control!;
  const cancelExpired=await host.ctx.hima.delegate({runId,actor,action:'cancel',delegationId:'expiring',requestId:'cancel-expired',expectedEpoch:control.epoch,expectedRevision:control.revision}) as any;
  assert.equal(cancelExpired.status,'refused');

  control=host.ctx.hima.executionContext(runId).run.control!;
  await host.ctx.hima.delegate({runId,actor,action:'result',delegationId:'expiring',requestId:'observe-expired-result',expectedEpoch:control.epoch,expectedRevision:control.revision});
  assert.equal(runDelegations((host.ctx.hima as any).deps(),runId).find(row=>row.delegationId==='expiring')?.state,'expired','reading retained output cannot rewrite an expired task as completed');
  assert.equal(host.ctx.hima.ledger.records({runId,type:'delegation'}).some(r=>r.type==='delegation'&&r.delegationId==='expiring'&&r.event==='result-observed'),false);
 }finally{if(runId)await host.ctx.hima.cancelRun(runId);await host.dispose();await home.h.dispose();}
});

// #64 Task 2b: delegation admission counts what a Run's children can still use. A child is charged its
// whole share while it may still run (or take a follow-up), and only the time it actually held once it
// has ended; the Run's delegation time is its time box on each of the Site job lanes it was started with.
const minutes=(n:number)=>n*60_000;
async function admissionRun(t:import('node:test').TestContext,parallelJobs:number,timeBoxMs:number,children:number){
 const home=await localHome(t,{sleepSeconds:0,parallelJobs});assert.ok(home);
 // Every replayed child answers each of up to two turns in prose and goes idle; no child result is read from a model here.
 let replay=await writeMomentScenario(home.h,'notice',path.join(repoRoot,'test/fixtures/delegation'));
 const turn={kind:'chunks' as const,chunks:[{type:'block-start',index:0,blockType:'text'},
  {type:'block-end',index:0,block:{type:'text',text:'Child turn answered.'}},{type:'finish',reason:{kind:'stop'}}]} as never;
 for(let n=replay.children.length;n<children;n+=1)replay=await appendReplaySession(replay,`admission-child-${n}`,[turn,turn]);
 await writeReplayOverlay(home.h.home,{file:replay.file,overrideFile:replay.override,childFiles:replay.children});
 await appendFile(path.join(home.h.profileDir,'cordis.patch.yml'),QUIET_TITLE_ROW);
 const host=await bootInProcess(home.h);let runId:string|undefined;
 t.after(async()=>{if(runId)await host.ctx.hima.cancelRun(runId);await host.dispose();await home.h.dispose();});
 const owner=await createRootAgent(host.ctx,home.h.home);const actor=String(owner.id);
 const started=await host.ctx.hima.startRun({pack:timingProbePackId,site:'local',goal:{target_period_ns:2},ownerSessionId:actor,timeBoxMs});
 assert.equal(started.kind,'ran',JSON.stringify(started));if(started.kind!=='ran')throw new Error('unreachable');runId=started.run.id;
 assert.equal(started.run.budget?.jobCap,parallelJobs);
 const input=host.ctx.hima.ledger.records({runId})[0];assert.ok(input);
 const id=runId;const control=()=>host.ctx.hima.executionContext(id).run.control!;
 const rows=()=>runDelegations((host.ctx.hima as any).deps(),id);
 const create=(delegationId:string,role:string,maxElapsedMs:number,maxFollowups=0,dependencyIds:string[]=[])=>host.ctx.hima.delegate({runId:id,actor,action:'create',
  requestId:`create-${delegationId}`,expectedEpoch:control().epoch,expectedRevision:control().revision,contract:{delegationId,role,task:`Answer as ${delegationId}.`,
   inputRefs:[input.id],allowedTools:['hima_delegation_input'],budgetShare:{maxElapsedMs,maxFollowups},dependencyIds,recipient:{kind:'run-owner',sessionId:actor}}}) as Promise<Record<string,any>>;
 // The production Ledger handoff shape of one proven completed turn; the model's content is not under test.
 let results=0;
 const complete=async(delegationId:string)=>{
  const row=rows().find(item=>item.delegationId===delegationId)!;const text=JSON.stringify({schema:'fixture/1',from:delegationId});
  await host.ctx.hima.ledger.appendDelegation(id,{delegationId,parentSessionId:actor,childSessionId:row.childSessionId,requestId:`result-${delegationId}-${++results}`,
   requestDigest:'a'.repeat(64),event:'result-observed',payload:{candidate:true,source:'native-live-session',handoff:{
    outputIdentity:createHash('sha256').update(text).digest('hex'),contract:{recordId:row.contractRecordId,requestDigest:row.requestDigest},
    output:{text,content:[{type:'text',text}],truncated:false},completedTurn:{turn:1,endSeq:1},unknowns:[],
    evidence:{artifactRefs:[],diffRefs:[],testRefs:[],limitations:['synthetic model result']}}}});
 };
 return {host,runId:id,actor,rows,create,complete};
}

test('six parallel Teams of three fit two generations in a 180-minute box on six Site lanes when every child uses its whole share',async t=>{
 // The ATCS budget (notes/t2b-admission.md): Researcher 10 min and Reviewer 10 min, each keeping one follow-up,
 // and Operator 20 min, on a Site of parallelJobs 6, so 6 x 180 = 1080 min of delegation time.
 // Worst case: no child ends early. Researchers and Reviewers complete with a follow-up still allowed, so each
 // keeps its whole share reserved; Operators never end. 6 slots x 40 min x 2 generations = 480 min charged.
 // (On one lane the same Teams would need 480 of 180 min: generation 1 alone, 240 min, does not fit.)
 const {rows,create,complete}=await admissionRun(t,6,minutes(180),48);
 const team=[['researcher','researcher',minutes(10),1],['reviewer','reviewer',minutes(10),1],['operator','analyst',minutes(20),0]] as const;
 for(const generation of [1,2]){
  for(const [index,[member,role,share,followups]] of team.entries()){
   for(const slot of [1,2,3,4,5,6]){
    const delegationId=`g${generation}-s${slot}-${member}`;
    const dependency=index===0?[]:[`g${generation}-s${slot}-${team[index-1]![0]}`];
    const created=await create(delegationId,role,share,followups,dependency);
    assert.equal(created.status,'created',`${delegationId}: ${JSON.stringify(created)}`);
    assert.equal(created.effectiveContract.budgetShare.maxElapsedMs,share,'an admitted share is never narrowed');
   }
   // Operators are left running: their whole share stays charged.
   if(member!=='operator')for(const slot of [1,2,3,4,5,6])await complete(`g${generation}-s${slot}-${member}`);
  }
 }
 assert.equal(rows().length,36);
 assert.equal(rows().filter(row=>row.state==='accepted').length,12,'both generations\' Operators still hold their whole share');
 assert.equal(rows().filter(row=>row.state==='completed').length,24,'every Researcher and Reviewer keeps a follow-up, so its whole share too');
 // The charge is the full 480 min: three 175-min children fit (1005 min), a fourth (1180 min) does not.
 for(const n of [1,2,3])assert.equal((await create(`probe-${n}`,'analyst',minutes(175))).status,'created',`probe-${n}`);
 const over=await create('probe-4','analyst',minutes(175));
 assert.equal(over.status,'refused',JSON.stringify(over));assert.match(over.reason,/Child shares exceed/);
});

test('ended children are charged only the time they held, so a second generation reuses the lanes the first one ended on',async t=>{
 // Six worker slots on a Site of six job lanes: each slot's Team is Researcher -> Reviewer -> Operator stand-in,
 // with ATCS-like follow-up allowances. Full shares: 6 x 95 min = 570 min a generation, 1140 min for two, which
 // exceeds 1080: generation 2 is admitted only because generation 1's Operators ended within moments.
 const {rows,create,complete}=await admissionRun(t,6,minutes(180),48);
 const team=[['researcher','researcher',minutes(20),1],['reviewer','reviewer',minutes(15),1],['operator','analyst',minutes(60),0]] as const;
 const slots=[1,2,3,4,5,6];
 for(const generation of [1,2]){
  for(const [index,[member,role,share,followups]] of team.entries()){
   // The six Teams run side by side: every slot's member is admitted before any slot's next member.
   for(const slot of slots){
    const delegationId=`g${generation}-s${slot}-${member}`;
    const dependency=index===0?[]:[`g${generation}-s${slot}-${team[index-1]![0]}`];
    const created=await create(delegationId,role,share,followups,dependency);
    assert.equal(created.status,'created',`${delegationId}: ${JSON.stringify(created)}`);
    assert.equal(created.effectiveContract.budgetShare.maxElapsedMs,share,'an admitted share is never narrowed');
   }
   for(const slot of slots)await complete(`g${generation}-s${slot}-${member}`);
  }
 }
 assert.equal(rows().length,36,'two generations of six three-member Teams: more than the old 32-delegation lifetime limit');
 // Charged now: generation-1 and -2 Researchers and Reviewers keep their whole share while a follow-up is still
 // allowed (2 x 6 x 35 = 420 min); both generations' Operators completed within moments. 1080 - 420 = 660 min unreserved.
 const wide=await create('wide-1','analyst',minutes(175));
 assert.equal(wide.status,'created',JSON.stringify(wide));
 const tooLong=await create('too-long','analyst',minutes(181));
 assert.equal(tooLong.status,'refused','a share longer than the remaining time box is refused however many lanes are free');
 assert.match(tooLong.reason,/Child shares exceed/);
 // 420 + 175 = 595 min charged: three more wide children would need 525 min of the 485 left.
 assert.equal((await create('wide-2','analyst',minutes(175))).status,'created');
 assert.equal((await create('wide-3','analyst',minutes(175))).status,'created');
 const overLanes=await create('wide-4','analyst',minutes(175));
 assert.equal(overLanes.status,'refused','children still share the lanes x time box: running children are charged their whole share');
 assert.match(overLanes.reason,/Child shares exceed/);
 assert.equal((await create('narrow','analyst',minutes(10))).status,'created','what the lanes still hold is admitted');
});

test('runaway delegation is still refused: 32 children may run at once, an ended child frees its place, and one Run admits at most 128',async t=>{
 const {host,runId,actor,rows,create,complete}=await admissionRun(t,1,minutes(60),132);
 for(let n=1;n<=32;n+=1){const created=await create(`live-${n}`,'reviewer',60_000,1);assert.equal(created.status,'created',`live-${n}: ${JSON.stringify(created)}`);}
 const runaway=await create('live-33','reviewer',60_000);
 assert.equal(runaway.status,'refused','a 33rd child while 32 may be running is refused');
 assert.match(runaway.reason,/32 children that may be running/);
 // A completed child no longer runs, even while it may still take a follow-up, so its place is free.
 await complete('live-1');
 assert.equal(rows().find(item=>item.delegationId==='live-1')!.state,'completed');
 const freed=await create('live-33','reviewer',60_000);
 assert.equal(freed.status,'created',`a completed child frees its place: ${JSON.stringify(freed)}`);
 // Reopening that child with a follow-up makes it run again, so it needs a free place too.
 const reopen=(requestId:string)=>host.ctx.hima.delegate({runId,actor,action:'followup',delegationId:'live-1',requestId,text:'Refine your answer.',
  expectedEpoch:host.ctx.hima.executionContext(runId).run.control!.epoch,expectedRevision:host.ctx.hima.executionContext(runId).run.control!.revision}) as Promise<Record<string,any>>;
 const crowded=await reopen('reopen-crowded');
 assert.equal(crowded.status,'refused','a follow-up that would make a 33rd child run is refused');
 assert.match(crowded.reason,/32 children that may be running/);
 await complete('live-2');
 const reopened=await reopen('reopen-free');
 assert.equal(reopened.status,'accepted',`a free place admits the follow-up: ${JSON.stringify(reopened)}`);
 // Ended children no longer run, but a create-and-end loop still stops at the lifetime bound.
 for(const row of rows().filter(item=>item.state==='accepted'))await complete(row.delegationId);
 let n=34;
 while(rows().length<128){const delegationId=`loop-${n++}`;const created=await create(delegationId,'reviewer',60_000);
  assert.equal(created.status,'created',`${delegationId}: ${JSON.stringify(created)}`);await complete(delegationId);}
 const beyond=await create('beyond','reviewer',60_000);
 assert.equal(beyond.status,'refused','a Run admits at most 128 children in its whole life');
 assert.match(beyond.reason,/128-delegation admission limit/);
});
