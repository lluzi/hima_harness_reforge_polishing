import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHimaHome } from './support/dsh-home.ts';
import { bootHimaHost } from './support/boot-host.ts';
import { api, openSession, createLiveSession } from './support/hima-api.ts';
import { teamFixture } from './support/himateam.ts';
import { readTeamMemoryContext, type ActorGrant, type MemorySourceReader, type MemoryView, type TeamMemoryPorts } from '@hima/harness';
import { bootInProcess, createRootAgent } from './support/boot-inprocess.ts';
import { waitUntil } from './support/fabric.ts';

test('Host memory persists feedback before offline indexing, enforces replay and exact adoption/correction', { timeout: 120000 }, async t => {
  const home=await createHimaHome(); let host=await bootHimaHost(home);
  t.after(async()=>{await host.stop();await home.dispose();});
  let cookie=await openSession(host),sessionId=await createLiveSession(host,cookie,home.workspace);
  const team=async(request:unknown)=>{const response=await api(host,cookie,'/hima/api/teams',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sessionId,request})});return {status:response.status,body:await response.json() as any};};
  const saved=await team({action:'save',definition:teamFixture,expectedVersion:null}); assert.equal(saved.status,200,JSON.stringify(saved.body));
  const opened=await team({action:'startTask',teamId:saved.body.teamId,request:{requestId:'memory-opening',teamId:saved.body.teamId,expectedVersion:1,goal:'Save scoped feedback',input:{},deadlineAt:new Date(Date.now()+600000).toISOString(),closure:'Retain feedback without model execution.'}});
  assert.equal(opened.status,200,JSON.stringify(opened.body));const target={teamId:saved.body.teamId,taskId:opened.body.taskId};
  const call=async(action:string,request:unknown)=>{const response=await api(host,cookie,'/hima/api/memory',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sessionId,action,...target,request})});return {status:response.status,body:await response.json() as any};};
  const feedback={requestId:'sram-feedback',target:{kind:'member',memberId:'lead'},text:'项目 A 的 SRAM access latency 上限是 37 ns。',conditions:['项目 A，SRAM'],reason:'工程师提供事实'};
  const first=await call('feedback',feedback);assert.equal(first.status,200,JSON.stringify(first.body));
  assert.equal(first.body.record.text,feedback.text);assert.equal(first.body.tip.state,'candidate');assert.equal(first.body.tip.actor.kind,'human');assert.equal(first.body.index.state,'pending');
  assert.equal(JSON.stringify(first.body).includes('bankId'),false);
  const replay=await call('feedback',feedback);assert.equal(replay.status,200);assert.equal(replay.body.record.memoryId,first.body.record.memoryId);
  assert.equal((await call('feedback',{...feedback,text:'Changed request body'})).status,409);
  assert.equal((await call('feedback',{...feedback,requestId:'forged',bankId:'another-project'})).status,400);
  const cas=(view:any)=>({memoryId:view.record.memoryId,expectedVersion:view.record.version,expectedRevision:view.tip.revision,supersedesEventId:view.tip.eventId});
  const proof={kind:'feedback',eventId:first.body.tip.eventId,sha256:first.body.record.sha256};
  const adopted=await call('adopt',{requestId:'sram-adopt',...cas(first.body),action:'adopted',reason:'确认上限',evidenceRefs:[proof]});assert.equal(adopted.status,200,JSON.stringify(adopted.body));assert.equal(adopted.body.tip.state,'adopted');
  const corrected=await call('correct',{requestId:'sram-correct',...cas(adopted.body),text:'项目 A 的 SRAM access latency 上限是 23 ns。',conditions:feedback.conditions,reason:'中文纠正',sources:[proof]});assert.equal(corrected.status,200,JSON.stringify(corrected.body));assert.equal(corrected.body.record.version,2);assert.equal(corrected.body.tip.state,'candidate');assert.equal(corrected.body.record.text.includes('23 ns'),true);
  assert.equal((await call('adopt',{requestId:'stale-adoption',...cas(adopted.body),action:'adopted',reason:'迟到旧版',evidenceRefs:[proof]})).status,409);
  const list=await call('status',{page:{limit:10}});assert.equal(list.status,200);assert.equal(list.body.records.length,1);assert.equal(list.body.records[0].record.version,2);
  await host.stop();host=await bootHimaHost(home);cookie=await openSession(host);sessionId=await createLiveSession(host,cookie,home.workspace);
  const reopened=await call('status',{page:{limit:10}});assert.equal(reopened.status,200);assert.equal(reopened.body.records[0].record.text,corrected.body.record.text);assert.equal(reopened.body.records[0].tip.state,'candidate');
  const cloned=await team({action:'clone',teamId:saved.body.teamId,title:'Empty-memory clone'});assert.equal(cloned.status,200);
  const cloneTask=await team({action:'startTask',teamId:cloned.body.teamId,request:{requestId:'clone-opening',teamId:cloned.body.teamId,expectedVersion:1,goal:'No inherited bank',input:{},deadlineAt:new Date(Date.now()+600000).toISOString(),closure:'Retain empty bank.'}});assert.equal(cloneTask.status,200);
  const response=await api(host,cookie,'/hima/api/memory',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sessionId,action:'status',teamId:cloned.body.teamId,taskId:cloneTask.body.taskId,request:{page:{limit:10}}})});assert.equal(response.status,200);assert.equal((await response.json() as any).records.length,0);
});

// Real Host/application PG authority. Only the external Hindsight network is substituted;
// the returned native prose is deliberately false. This is not native/Chinese/model acceptance.
test('real Host/PG memory rejects stale retention, source forgery and grants revoked during recall', { timeout: 120000 }, async t => {
  const savedEnv = {silent:process.env.HIMA_TEST_SILENT_AGENT,drive:process.env.HIMA_TEST_LEGACY_AUTO_DRIVE};
  process.env.HIMA_TEST_SILENT_AGENT='1';process.env.HIMA_TEST_LEGACY_AUTO_DRIVE='0';
  const home=await createHimaHome();
  let ownedHost:Awaited<ReturnType<typeof bootInProcess>>|undefined;
  t.after(async()=>{
    await ownedHost?.dispose();
    await home.dispose();
    for(const [key,value] of [['HIMA_TEST_SILENT_AGENT',savedEnv.silent],['HIMA_TEST_LEGACY_AUTO_DRIVE',savedEnv.drive]] as const) {
      if(value===undefined)delete process.env[key];else process.env[key]=value;
    }
  });
  const host=await bootInProcess(home);ownedHost=host;
  const guide=await createRootAgent(host.ctx,home.workspace),sessionId=String(guide.id);
  const created=await host.ctx.hima.teamOperation(sessionId,{action:'save',definition:{...teamFixture,members:[...teamFixture.members,{...teamFixture.members[0],id:'peer',role:'Peer'}]},expectedVersion:null}) as any;
  const opening={requestId:'memory-counterexample-opening',teamId:created.teamId,expectedVersion:1,goal:'Retain feedback with a controlled waiting executor',input:{},deadlineAt:new Date(Date.now()+90000).toISOString(),closure:'No native or model execution.'};
  const task=await host.ctx.hima.teamOperation(sessionId,{action:'startTask',teamId:created.teamId,request:opening}) as any;
  assert.equal(task.readiness.ready,false);
  const store=host.ctx.hima.durable.store;
  const ref={projectId:task.projectId as string,teamId:created.teamId as string,taskId:task.taskId as string};
  const human={kind:'human' as const,projectId:ref.projectId,actorId:await store.operatorIdentity()};
  // All sources used here are immutable feedback; no byte-reader substitute is needed.
  const sourceReader:MemorySourceReader={verify:async(actor,scope,sources)=>(await store.memorySources(actor,scope,sources)).map(row=>row.source)};
  const memory=store.teamMemory(sourceReader);
  const cas=(view:MemoryView)=>({memoryId:view.record.memoryId,expectedVersion:view.record.version,expectedRevision:view.tip.revision,supersedesEventId:view.tip.eventId});
  const proof=(view:MemoryView)=>({kind:'feedback' as const,eventId:view.tip.eventId,sha256:view.record.sha256});
  const feedback={requestId:'concurrent-feedback',target:{kind:'member' as const,memberId:'lead'},text:'Project A SRAM access latency cap is 37 ns.',conditions:['Project A SRAM'],reason:'Controlled human feedback',sources:[]};
  const [first,replayed]=await Promise.all([memory.commitFeedback(human,ref,feedback),memory.commitFeedback(human,ref,feedback)]);
  assert.equal(first.record.memoryId,replayed.record.memoryId);
  assert.equal(first.tip.eventId,replayed.tip.eventId);
  assert.equal(first.index.operationId,replayed.index.operationId);
  assert.equal((await memory.read(human,ref,{limit:10})).records.length,1,'concurrent replay creates one durable memory');
  await assert.rejects(memory.commitFeedback(human,ref,{...feedback,text:'Changed body'}),/different content|conflict/i);
  await assert.rejects(sourceReader.verify(human,ref,[{...proof(first),sha256:'f'.repeat(64)}]),/unavailable|changed/i);
  await assert.rejects(sourceReader.verify(human,ref,[{...proof(first),eventId:'forged-feedback-event'}]),/unavailable|changed/i);
  await assert.rejects(memory.commitProposal(human,ref,{...feedback,requestId:'forged-source-proposal',sources:[{...proof(first),sha256:'f'.repeat(64)}]}),/unavailable|changed/i);
  const oldClaim=await memory.claimRetention(human,ref,first.index.operationId,first.index.revision);assert.ok(oldClaim);
  const adopted=await memory.changeAdoption(human,ref,{requestId:'adopt-v1',...cas(first),action:'adopted',reason:'Explicit human adoption',conditions:feedback.conditions,evidenceRefs:[proof(first)]});
  const corrected=await memory.correct(human,ref,{requestId:'correct-v2',...cas(adopted),text:'Project A SRAM access latency cap is 23 ns.',conditions:feedback.conditions,reason:'Correct the cap',sources:[proof(first)],evidenceRefs:[]});
  assert.equal(corrected.record.version,2);assert.equal(corrected.tip.state,'candidate');
  assert.notEqual(corrected.index.documentId,first.index.documentId);
  const immutableV1=await memory.record(human,ref,first.record.memoryId,1);
  assert.equal(immutableV1.record.text,'Project A SRAM access latency cap is 37 ns.');
  assert.equal(immutableV1.record.sha256,first.record.sha256);
  assert.equal(immutableV1.tip.version,2,'old content read retains the current applicability tip');
  await assert.rejects(memory.changeAdoption(human,ref,{requestId:'stale-v1-adopt',...cas(adopted),action:'adopted',reason:'Late old adoption',conditions:[],evidenceRefs:[proof(first)]}),/changed|current version/i);
  const delayed=await memory.recordRetention(oldClaim.operationId,oldClaim.revision,{state:'confirmed',nativeStatus:'completed',confirmedAt:new Date().toISOString()});
  assert.equal(delayed.version,1);assert.equal(delayed.state,'confirmed');
  assert.equal((await memory.record(human,ref,first.record.memoryId)).tip.state,'candidate');

  let recallDocuments=[first.index.documentId];
  let onRecall:()=>Promise<void>=async()=>{};
  const network:typeof fetch=async(input)=>{
    assert.match(String(input),/\/memories\/recall$/,'fixture exposes only external retrieval');
    await onRecall();
    return Response.json({results:recallDocuments.map(documentId=>({document_id:documentId,text:'Untrusted fixture says cap 999 ns.',type:'experience',memory_type:'experience'}))});
  };
  const ports:TeamMemoryPorts={store:memory,sourceReader,hindsight:{connection:()=>({origin:'http://hindsight-network-fixture.test',apiKey:'test-only',generation:'fixture-generation'}),fetch:network}};
  assert.deepEqual((await readTeamMemoryContext(ports,human,ref,{query:'SRAM cap',memberId:'lead'})).records,[],'late completed v1 cannot become applicable after correction');
  const adoptedV2=await memory.changeAdoption(human,ref,{requestId:'adopt-v2',...cas(corrected),action:'adopted',reason:'Accept corrected cap',conditions:feedback.conditions,evidenceRefs:[proof(corrected)]});
  recallDocuments=[first.index.documentId,corrected.index.documentId,'unknown-native-document'];
  const recalled=await readTeamMemoryContext(ports,human,ref,{query:'SRAM latency',memberId:'lead'});
  assert.equal(recalled.records.length,1);assert.equal(recalled.records[0]?.record.text,'Project A SRAM access latency cap is 23 ns.');
  assert.equal(recalled.records[0]?.retrieval.documentId,corrected.index.documentId);
  assert.equal(recalled.records[0]?.retrieval.excerpt,'Untrusted fixture says cap 999 ns.');
  assert.equal(recalled.records[0]?.retrieval.label,'retrieval-evidence');
  let disabled:MemoryView|undefined;
  onRecall=async()=>{disabled=await memory.changeAdoption(human,ref,{requestId:'disable-during-recall',...cas(adoptedV2),action:'disabled',reason:'Withdraw during retrieval',conditions:[],evidenceRefs:[]});};
  assert.deepEqual((await readTeamMemoryContext(ports,human,ref,{query:'SRAM cap',memberId:'lead'})).records,[],'disable committed while recall is in flight suppresses context');
  onRecall=async()=>{};assert.ok(disabled);
  await assert.rejects(memory.changeAdoption(human,ref,{requestId:'readopt-old-evidence',...cas(disabled),action:'re-adopted',reason:'Old feedback is insufficient',conditions:[],evidenceRefs:[proof(corrected)]}),/newly verified|after the disable|withdrawn/i);
  const fresh=await memory.commitFeedback(human,ref,{...feedback,requestId:'fresh-feedback-after-disable',text:'The corrected SRAM cap remains 23 ns.'});
  await memory.changeAdoption(human,ref,{requestId:'readopt-fresh-evidence',...cas(disabled),action:'re-adopted',reason:'Fresh confirmation after withdrawal',conditions:[],evidenceRefs:[proof(fresh)]});
  assert.equal((await readTeamMemoryContext(ports,human,ref,{query:'SRAM cap',memberId:'lead'})).records[0]?.record.text,'Project A SRAM access latency cap is 23 ns.');

  await waitUntil('persisted Host member invocation for memory capability',async()=>(await store.flowProjection(task.currentRunId)).tasks.length===1,10000,25);
  const invocation=(await store.flowProjection(task.currentRunId)).tasks[0] as any;
  const grant:ActorGrant={grantId:'query-memory-grant',actorId:'lead',projectId:ref.projectId,teamId:ref.teamId,taskId:ref.taskId,memberId:'lead',runId:task.currentRunId,effectId:invocation.identity.effectId,generation:0,capabilities:['query-memory'],expiresAt:opening.deadlineAt,revokedAt:null};
  const issued=await store.issueTeamGrant(grant),member={kind:'member' as const,grant:issued.grant};
  const offline:TeamMemoryPorts={...ports,hindsight:{connection:()=>undefined}};
  assert.equal((await memory.read(member,ref,{limit:10})).records.length,2);
  assert.deepEqual((await readTeamMemoryContext(offline,member,ref,{query:'SRAM cap'})).records,[],'offline retrieval does not prevent authorized status reads');
  const memberStatus=await host.ctx.hima.memberTeamContext(issued.token,{action:'memory-status',request:{page:{limit:10}}}) as {records:unknown[]};
  assert.equal(memberStatus.records.length,2);
  await assert.rejects(host.ctx.hima.memberTeamContext('forged',{action:'query-memory',request:{query:'SRAM cap'}}),/Unknown member/i);
  await assert.rejects(memory.resolve({kind:'member',grant:{...issued.grant,memberId:'peer',actorId:'peer'}},ref),/capability|member/i);
  await assert.rejects(memory.resolve(member,{...ref,projectId:'other-project'}),/project|unavailable/i);
  await assert.rejects(memory.resolve(member,ref,{kind:'member',memberId:'peer'}),/private|member/i);
  await assert.rejects(store.issueTeamGrant({...grant,grantId:'forged-query-effect',effectId:'unrelated'}),/exact Host member/i);
  await assert.rejects(store.issueTeamGrant({...grant,grantId:'forged-query-project',projectId:'other-project'}),/does not match/i);
  await assert.rejects(store.issueTeamGrant({...grant,grantId:'forged-query-member',actorId:'peer',memberId:'peer'}),/exact Host member/i);
  const expiring=await store.issueTeamGrant({...grant,grantId:'expiring-query-grant',expiresAt:new Date(Date.now()+1000).toISOString()});
  await waitUntil('controlled query grant expiration',async()=>Date.now()>=Date.parse(expiring.grant.expiresAt),2000,25);
  await assert.rejects(memory.read({kind:'member',grant:expiring.grant},ref,{limit:10}),/capability/i);
  await assert.rejects(host.ctx.hima.memberTeamContext(expiring.token,{action:'memory-status',request:{page:{limit:10}}}),/expired|revoked/i);
  onRecall=async()=>{await store.revokeTeamGrant(issued.grant.grantId);};
  await assert.rejects(readTeamMemoryContext(ports,member,ref,{query:'SRAM cap',memberId:'lead'}),/capability|revoked/i,'persisted grant revocation during external retrieval fails closed');
  onRecall=async()=>{};
  await assert.rejects(memory.read(member,ref,{limit:10}),/capability/i,'offline/status reads do not bypass a revoked actor');
  await assert.rejects(host.ctx.hima.memberTeamContext(issued.token,{action:'query-memory',request:{query:'SRAM cap'}}),/revoked/i);
  assert.equal((await memory.record(human,ref,first.record.memoryId)).tip.state,'re-adopted','revoking one member leaves human-authorized history intact');

  // A human's selected member consumes this Team's authorized shared scopes too.
  // Added after grant/status cases so their exact persisted record counts stay independent.
  const shared=[];
  for(const kind of ['project','team'] as const) {
    const candidate=await memory.commitFeedback(human,ref,{...feedback,requestId:`shared-${kind}-feedback`,target:{kind},text:kind==='project'?'Project SRAM operating voltage is 0.72 V.':'Team SRAM review interval is 11 days.',conditions:['Source observation conditions']});
    const applied=kind==='project'?['Only project revision P3']:['Only Team review cycle T7'];
    shared.push(await memory.changeAdoption(human,ref,{requestId:`shared-${kind}-adopt`,...cas(candidate),action:'adopted',reason:'Explicitly restrict applicability',conditions:applied,evidenceRefs:[proof(candidate)]}));
  }
  const resolved=await memory.resolve(human,ref,{kind:'member',memberId:'lead'});
  assert.deepEqual(resolved.scopes.map(entry=>entry.scope.kind).sort(),['member','project','team']);
  recallDocuments=shared.map(view=>view.index.documentId);
  const sharedContext=await readTeamMemoryContext(ports,human,ref,{query:'SRAM guidance',memberId:'lead'});
  assert.deepEqual(sharedContext.records.map(view=>view.record.text).sort(),['Project SRAM operating voltage is 0.72 V.','Team SRAM review interval is 11 days.']);
  for(const kind of ['project','team'] as const) {
    const applied=sharedContext.records.find(view=>view.record.scope.kind===kind);assert.ok(applied);
    assert.deepEqual(applied.record.conditions,['Source observation conditions'],'adoption cannot rewrite immutable feedback conditions');
    assert.ok('appliedConditions' in applied);
    assert.deepEqual(applied.appliedConditions,kind==='project'?['Only project revision P3']:['Only Team review cycle T7'],'automatic context carries the current adoption conditions');
  }

  for(const sourceChange of ['corrected','disabled'] as const) {
    const sourceA=await memory.commitFeedback(human,ref,{...feedback,requestId:`source-a-${sourceChange}`,text:'Source fixture: SRAM safety margin is 4 ns.'});
    const derivedB=await memory.commitProposal(human,ref,{...feedback,requestId:`derived-b-${sourceChange}`,text:'Derived fixture: use SRAM safety margin of 4 ns.',sources:[proof(sourceA)]});
    const adoption={requestId:`derived-b-adopt-${sourceChange}`,...cas(derivedB),action:'adopted' as const,reason:'Adopt source-backed fixture',conditions:['Qualified source A'],evidenceRefs:[proof(sourceA)]};
    const adoptedB=await memory.changeAdoption(human,ref,adoption);
    recallDocuments=[derivedB.index.documentId];
    assert.equal((await readTeamMemoryContext(ports,human,ref,{query:'SRAM safety margin',memberId:'lead'})).records[0]?.record.text,'Derived fixture: use SRAM safety margin of 4 ns.');
    if(sourceChange==='corrected') {
      await memory.correct(human,ref,{requestId:'replace-source-a',...cas(sourceA),text:'Source fixture: SRAM safety margin is 6 ns.',conditions:[],reason:'Source measurement corrected',sources:[],evidenceRefs:[]});
    } else {
      await memory.changeAdoption(human,ref,{requestId:'withdraw-source-a',...cas(sourceA),action:'disabled',reason:'Source measurement withdrawn',conditions:[],evidenceRefs:[]});
    }
    assert.deepEqual((await readTeamMemoryContext(ports,human,ref,{query:'SRAM safety margin',memberId:'lead'})).records,[],'derived adopted text is suppressed when its real persisted source is corrected or withdrawn');
    const adoptionReplay=await memory.changeAdoption(human,ref,adoption);
    assert.equal(adoptionReplay.tip.eventId,adoptedB.tip.eventId,'same accepted request returns its original event after source validity changes');
    assert.equal(adoptionReplay.tip.revision,adoptedB.tip.revision);
    await assert.rejects(memory.changeAdoption(human,ref,{...adoption,requestId:`stale-derived-adopt-${sourceChange}`}),/changed|current version/i,'new stale CAS conflicts before checking the now-unavailable source');
    const withdrawnB=await memory.changeAdoption(human,ref,{requestId:`withdraw-derived-b-${sourceChange}`,...cas(adoptedB),action:'disabled',reason:'Withdraw dependent guidance',conditions:[],evidenceRefs:[]});
    assert.equal(withdrawnB.tip.state,'disabled','unavailable old evidence cannot block human withdrawal');
    assert.equal((await memory.changeAdoption(human,ref,adoption)).tip.eventId,adoptedB.tip.eventId);
    assert.equal((await memory.record(human,ref,derivedB.record.memoryId)).tip.eventId,withdrawnB.tip.eventId,'adoption replay is a historical receipt and must not reapply the old decision');
    const newB=await memory.correct(human,ref,{requestId:`human-new-b-${sourceChange}`,...cas(withdrawnB),text:'New human fixture: use SRAM safety margin of 8 ns.',conditions:['Fresh independent human fact'],reason:'Replace invalid dependent guidance',sources:[],evidenceRefs:[]});
    assert.equal(newB.record.version,2);assert.equal(newB.tip.state,'candidate');
    assert.deepEqual(newB.record.sources,[proof(newB)],'new human correction depends on its newly minted immutable feedback, not invalid historic source A');
    const historicB=await memory.record(human,ref,derivedB.record.memoryId,1);
    assert.equal(historicB.record.text,'Derived fixture: use SRAM safety margin of 4 ns.');
    assert.deepEqual(historicB.record.sources,[proof(sourceA)],'old dependent provenance remains in immutable history');
    await memory.changeAdoption(human,ref,{requestId:`adopt-independent-b-${sourceChange}`,...cas(newB),action:'adopted',reason:'Accept fresh human fact',conditions:['Current independent margin'],evidenceRefs:[proof(newB)]});
    recallDocuments=[derivedB.index.documentId,newB.index.documentId];
    const independent=await readTeamMemoryContext(ports,human,ref,{query:'SRAM safety margin',memberId:'lead'});
    assert.deepEqual(independent.records.map(view=>view.record.text),['New human fixture: use SRAM safety margin of 8 ns.']);
  }

  // Source applicability can change while a different candidate's source is awaited.
  // Both candidates and their dependencies are actual PG records; only the timing of
  // the existing source-reader boundary is controlled, with no substituted authority.
  const raceFixtures=[];
  for(const label of ['alpha','beta'] as const) {
    const source=await memory.commitFeedback(human,ref,{...feedback,requestId:`cascade-source-${label}`,text:`Independent ${label} SRAM calibration source.`});
    const expectedText=label==='alpha'?'Alpha SRAM guardband is 5 ns.':'Beta SRAM guardband is 9 ns.';
    const candidate=await memory.commitProposal(human,ref,{...feedback,requestId:`cascade-proposal-${label}`,text:expectedText,sources:[proof(source)]});
    const adopted=await memory.changeAdoption(human,ref,{requestId:`cascade-adopt-${label}`,...cas(candidate),action:'adopted',reason:'Adopt independently sourced guardband',conditions:[],evidenceRefs:[proof(source)]});
    raceFixtures.push({source,adopted,expectedText});
  }
  recallDocuments=raceFixtures.map(row=>row.adopted.index.documentId);
  // Public candidate order selects which dependency to withdraw; SQL insertion order
  // and random memory IDs are not assumed. Expectations remain authored fixture values.
  const candidateOrder=await memory.candidates(human,ref,recallDocuments);assert.equal(candidateOrder.length,2);
  const b=raceFixtures.find(row=>row.adopted.record.memoryId===candidateOrder[0]?.record.memoryId);
  const c=raceFixtures.find(row=>row.adopted.record.memoryId===candidateOrder[1]?.record.memoryId);assert.ok(b);assert.ok(c);
  let bVerified=false,sourceWithdrawn=false;
  const delayedReader:MemorySourceReader={verify:async(actor,scope,sources)=>{
    const verified=await sourceReader.verify(actor,scope,sources);
    if(sources.some(source=>source.kind==='feedback'&&source.eventId===b.source.tip.eventId))bVerified=true;
    if(sources.some(source=>source.kind==='feedback'&&source.eventId===c.source.tip.eventId)) {
      assert.equal(bVerified,true,'the race must withdraw source A only after candidate B source verification');
      await memory.changeAdoption(human,ref,{requestId:'cascade-withdraw-earlier-source',...cas(b.source),action:'disabled',reason:'Withdraw source while later candidate verification is pending',conditions:[],evidenceRefs:[]});
      sourceWithdrawn=true;
    }
    return verified;
  }};
  const cascade=await readTeamMemoryContext({...ports,sourceReader:delayedReader},human,ref,{query:'SRAM guardband',memberId:'lead'});
  assert.equal(sourceWithdrawn,true,'the intended persisted source invalidation occurred during the later verification');
  assert.deepEqual(cascade.records.map(view=>view.record.text),[c.expectedText],'final context excludes earlier adopted B after its dependency is withdrawn while valid C remains');
  assert.equal((await memory.record(human,ref,b.adopted.record.memoryId)).tip.state,'adopted','dependent history remains adopted while source applicability is withdrawn');
});
