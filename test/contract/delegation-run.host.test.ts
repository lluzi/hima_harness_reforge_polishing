import assert from 'node:assert/strict';
import { appendFile,mkdir,readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { localHome,waitUntil } from './support/fabric.ts';
import { bootInProcess,createRootAgent,resumeTestAgent } from './support/boot-inprocess.ts';
import { writeMomentScenario } from './support/moments.ts';
import { repoRoot } from './support/dsh-home.ts';
import { writeReplayOverlay } from '../../packages/desktop/src/hima-home.ts';
import { QUIET_TITLE_ROW } from './support/pipeline.ts';
import { timingProbePackId } from './support/pack.ts';
import { delegationRuntimePolicy,delegationToolDenial,readNativeSessionContext,runDelegations } from '@hima/harness';

process.env.HIMA_TEST_LEGACY_AUTO_DRIVE='0';
process.env.HIMA_TEST_SILENT_AGENT='1';
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
  const cancelComplete=await host.ctx.hima.delegate({runId,actor,action:'cancel',delegationId:'coder',requestId:'cancel-completed',expectedEpoch:control.epoch,expectedRevision:control.revision}) as any;
  assert.equal(cancelComplete.status,'refused');
  assert.equal(cold.evidence.artifactRefs.length,1);assert.match(cold.evidence.artifactRefs[0].sha256,/^[0-9a-f]{64}$/);
  const resultRecord=host.ctx.hima.ledger.records({runId,type:'delegation'}).find(r=>r.type==='delegation'&&r.event==='result-observed');assert.ok(resultRecord);
  assert.equal(runDelegations((host.ctx.hima as any).deps?.()??{ledger:host.ctx.hima.ledger},runId).find(row=>row.delegationId==='coder')?.state,'completed');

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
  const reopened=runDelegations((host.ctx.hima as any).deps(),runId).find(row=>row.delegationId==='coder');
  assert.equal(reopened?.state,'accepted','followup admission reopens tool authority for the exact retained child');
  control=host.ctx.hima.executionContext(runId).run.control!;
  const exhausted=await host.ctx.hima.delegate({runId,actor,action:'followup',delegationId:'coder',requestId:'refine-over-cap',text:'Do not spend another child turn.',expectedEpoch:control.epoch,expectedRevision:control.revision}) as any;
  assert.equal(exhausted.status,'refused');



  control=host.ctx.hima.executionContext(runId).run.control!;
  await host.ctx.hima.executionAction({runId,actor,origin:'human',action:'pause',requestId:'hold-parent',expectedEpoch:control.epoch,expectedRevision:control.revision});
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
