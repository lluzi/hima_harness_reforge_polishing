// Pure leaf seams only: no Host, PG, native service or product-model proof.
import { test } from 'node:test';
import assert from 'node:assert/strict';
const m = await import(process.env.HIMA_MEMORY_LEAF_MODULE ?? '../../packages/harness/lib/team-memory.js');
test('strict requests reject caller-minted authority and malformed scope selectors', () => {
  const feedback = {requestId:'request-1',target:{kind:'team'},text:'SRAM cap 37 ns',reason:'human feedback'};
  assert.throws(() => m.parseFeedbackRequest({...feedback,projectId:'forged'}));
  assert.throws(() => m.parseFeedbackRequest({...feedback,target:{kind:'team',memberId:'other'}}));
  assert.throws(() => m.parseFeedbackRequest({...feedback,target:{kind:'member'}}));
  assert.throws(() => m.parseFeedbackRequest({...feedback,text:'bad\u0000text'}));
  assert.throws(() => m.parseFeedbackRequest({...feedback,text:'bad\ud800'}));
  assert.equal(m.parseFeedbackRequest(feedback).text, 'SRAM cap 37 ns');
});

import type {MemoryView, RetentionOperation, TeamMemoryPorts, TeamMemoryStore, MemorySource} from '@hima/harness';
const actor = {kind:'human' as const,actorId:'operator',projectId:'project-a'};
const ref = {projectId:'project-a',teamId:'team-a',taskId:'task-a'};
const source:MemorySource = {kind:'feedback',eventId:'feedback-event',sha256:'1'.repeat(64)};
function fixture(state:MemoryView['tip']['state']='adopted') {
  const operation:RetentionOperation = {schemaVersion:1,operationId:'11111111-1111-4111-8111-111111111111',memoryId:'memory-a',version:1,
    adoptionRevision:0,documentId:'document-a',contentSha256:m.memoryTextSha256('SRAM cap 37 ns'),payloadSha256:'2'.repeat(64),bankId:'bank-a',
    state:'pending',revision:1,createdAt:'2026-10-13T00:00:00.000Z',updatedAt:'2026-10-13T00:00:00.000Z'};
  const scope = {projectId:'project-a',teamId:'team-a',kind:'team' as const};
  const view:MemoryView = {record:{schemaVersion:1,memoryId:'memory-a',version:1,scope:{...scope},sourceTaskId:'task-a',sourceRunId:'run-a',
    team:{teamId:'team-a',version:1,sha256:'3'.repeat(64)},kind:'feedback',text:'SRAM cap 37 ns',sha256:operation.contentSha256,
    conditions:[],sources:[source],createdAt:operation.createdAt,createdBy:{kind:'human',actorId:'operator'}},
    tip:{schemaVersion:1,eventId:'event-a',requestId:'request-a',payloadSha256:operation.payloadSha256,memoryId:'memory-a',version:1,revision:2,
      event:state === 'candidate' ? 'feedback':'adopted',state,actor:{kind:'human',actorId:'operator'},taskId:'task-a',runId:'run-a',
      createdAt:operation.createdAt,reason:'Accepted source',evidenceRefs:[],conditions:[]},index:m.publicRetentionView(operation)};
  let authorized = true; let persisted = false; let resolves=0;
  const trace:string[] = [];
  let recall:() => Promise<void> = async () => {};
  let verify:() => Promise<readonly MemorySource[]> = async () => [source];
  const uuids:string[]=[];
  const store:TeamMemoryStore = {
    async resolve() {resolves++;if (!authorized) throw Error('revoked');return {scopes:[{scope,bankId:'bank-a'}]};},
    async commitFeedback() {persisted=true;trace.push('persist');return view;},
    async commitProposal() {persisted=true;trace.push('persist');return view;},
    async changeAdoption() {return view;}, async correct() {return view;},
    async read() {return {records:[view]};}, async record() {if(!authorized) throw Error('revoked');return view;},
    async candidates(documentsActor,documentsRef,documents) {if(!authorized) throw Error('revoked');return documents.includes('document-a') ? [structuredClone(view)]:[];},
    async claimRetention(claimActor,claimRef,id,revision) {assert.equal(id,operation.operationId);if(revision !== operation.revision) return undefined;operation.state='unknown';operation.revision++;trace.push('claim-unknown');return structuredClone(operation);},
    async recordRetention(id,revision,observation) {assert.equal(id,operation.operationId);if(revision===operation.revision) {Object.assign(operation,observation);operation.revision++;}return structuredClone(operation);},
    async readOperation() {return structuredClone(operation);}, async readRetention() {return m.publicRetentionView(operation);},
    async pendingRetentions() {return [structuredClone(operation)];},async correctionsAfter() {return {events:[]};},
  };
  const fakeFetch:typeof fetch = async (input,init) => {
    const url = String(input); trace.push('network');
    if (url.endsWith('/memories/recall')) {await recall();return Response.json({results:[{document_id:'document-a',text:'Native prose says cap 999 ns',type:'experience',memory_type:'experience'}]});}
    if (url.includes('/operations/')) return Response.json({operation_id:operation.operationId,status:'completed',operation_type:'batch_retain'});
    if (url.endsWith('/memories')) {
      assert.equal(persisted,true,'network cannot precede persistence');assert.equal(operation.state,'unknown','unknown must be recorded before network');
      const body=JSON.parse(String(init?.body));uuids.push(body.operation_id);return Response.json({success:true,async:true,operation_id:operation.operationId}, {status:202});
    }
    if (url.includes('/documents/')) return Response.json({id:'document-a',bank_id:'bank-a',original_text:view.record.text,document_metadata:{hima_memory_id:'memory-a',hima_memory_version:'1',hima_content_sha256:operation.contentSha256,hima_operation_id:operation.operationId},content_hash:'native-hash'});
    throw Error('Unexpected fixture endpoint '+url);
  };
  const ports:TeamMemoryPorts = {store,sourceReader:{verify:async () => verify()},hindsight:{connection:() => ({origin:'http://fixture.test',apiKey:'fixture-secret',generation:'generation-a'}),fetch:fakeFetch}};
  return {ports,view,operation,trace,uuids,get resolves(){return resolves;},get persisted(){return persisted;},revoke:() => {authorized=false;},setRecall:(f:typeof recall) => {recall=f;},setVerify:(f:typeof verify) => {verify=f;}};
}
test('candidate memory is suppressed and native prose never becomes adopted text',async () => {
  const f=fixture('candidate');assert.deepEqual((await m.readTeamMemoryContext(f.ports,actor,ref,{query:'SRAM latency'})).records,[]);
  f.view.tip.state='adopted';const result=await m.readTeamMemoryContext(f.ports,actor,ref,{query:'SRAM latency',limit:1});
  assert.equal(result.records[0]?.record.text,'SRAM cap 37 ns');assert.equal(result.records[0]?.retrieval.excerpt,'Native prose says cap 999 ns');
  assert.equal(result.records[0]?.retrieval.label,'retrieval-evidence');assert.ok(f.resolves>=4);
});
test('disabled and corrected versions during delayed recall cannot apply',async () => {
  for(const mutation of ['disabled','corrected'] as const) {
    const f=fixture();f.setRecall(async () => {f.view.tip.revision++;if(mutation==='disabled') f.view.tip.state='disabled';else {f.view.record.version=2;f.view.tip.version=2;f.view.tip.state='candidate';f.view.record.text='SRAM cap 23 ns';f.view.record.sha256=m.memoryTextSha256(f.view.record.text);}});
    assert.deepEqual((await m.readTeamMemoryContext(f.ports,actor,ref,{query:'cap'})).records,[]);
  }
});
test('correction or disable during source byte verification cannot return old text',async () => {
  const f=fixture();f.setVerify(async () => {f.view.tip.state='disabled';f.view.tip.revision++;return [source];});
  assert.deepEqual((await m.readTeamMemoryContext(f.ports,actor,ref,{query:'cap'})).records,[]);
});
test('authority change during recall or source check fails closed',async () => {
  for(const stage of ['recall','source']) {
    const f=fixture();if(stage==='recall')f.setRecall(async () => f.revoke());else f.setVerify(async () => {f.revoke();return [source];});
    await assert.rejects(m.readTeamMemoryContext(f.ports,actor,ref,{query:'cap'}),/revoked/);
  }
});
test('missing, changed or throwing source suppresses retrieval',async () => {
  for(const mode of ['missing','changed','throwing']) {
    const f=fixture();f.setVerify(async () => {if(mode==='throwing')throw Error('absent');return mode==='missing'?[]:[{...source,sha256:'f'.repeat(64)}];});
    const result=await m.readTeamMemoryContext(f.ports,actor,ref,{query:'cap'});assert.deepEqual(result.records,[]);assert.ok(result.diagnostics.includes('Memory source is unavailable.'));
  }
});
test('forged record scope and mismatched content cannot become context',async () => {
  for(const mode of ['scope','text']) {const f=fixture();if(mode==='scope')f.view.record.scope.teamId='clone-team';else f.view.record.text='forged 23 ns';
    assert.deepEqual((await m.readTeamMemoryContext(f.ports,actor,ref,{query:'cap'})).records,[]);}
});
test('offline feedback persists pending operation and public history remains readable',async () => {
  const f=fixture('candidate');f.ports.hindsight.connection=() => undefined;
  const result=await m.saveFeedback(f.ports,actor,ref,{requestId:'request-a',target:{kind:'team'},text:'SRAM cap 37 ns',reason:'Feedback'});
  assert.equal(f.persisted,true);assert.equal(result.index.state,'pending');assert.equal(f.trace.includes('network'),false);
  assert.equal((await m.readTeamMemory(f.ports,actor,ref,{limit:1})).records[0]?.record.text,'SRAM cap 37 ns');
  assert.deepEqual((await m.readTeamMemoryContext(f.ports,actor,ref,{query:'cap'})).records,[]);
});
test('feedback returns before network completes and dispatch persists unknown first',async () => {
  const f=fixture('candidate');let release!:() => void;const gate=new Promise<void>(resolve => {release=resolve;});
  f.ports.hindsight.fetch=async () => {assert.equal(f.persisted,true);assert.equal(f.operation.state,'unknown');await gate;return Response.json({success:true,async:true,operation_id:f.operation.operationId},{status:202});};
  const result=await m.saveFeedback(f.ports,actor,ref,{requestId:'request-a',target:{kind:'team'},text:'SRAM cap 37 ns',reason:'Feedback'});
  assert.equal(result.index.state,'pending');release();await new Promise(resolve => setImmediate(resolve));assert.equal(f.operation.state,'submitted');
});
test('lost retain ACK reconciles persisted same UUID without a fresh identity',async () => {
  const f=fixture();await f.ports.store.commitFeedback(actor,ref,m.parseFeedbackRequest({requestId:'request-a',target:{kind:'team'},text:'SRAM cap 37 ns',reason:'Feedback'}));
  const base=f.ports.hindsight.fetch!;let first=true;
  f.ports.hindsight.fetch=async (input,init) => {if(String(input).endsWith('/memories') && first) {first=false;f.uuids.push(JSON.parse(String(init?.body)).operation_id);throw Error('lost ACK');}return base(input,init);};
  await m.dispatchRetention(f.ports,actor,ref,f.operation.operationId);assert.equal(f.operation.state,'unknown');
  await m.dispatchRetention(f.ports,actor,ref,f.operation.operationId);assert.equal(f.operation.state,'confirmed');
  assert.deepEqual(f.uuids,[f.operation.operationId]);
});
test('Guide/member cannot forge human feedback, adoption or correction authority',async () => {
  const f=fixture();const guide={kind:'guide',actorId:'guide',projectId:'project-a'};
  await assert.rejects(m.saveFeedback(f.ports,guide,ref,{}),/human/);
  await assert.rejects(m.changeExperienceAdoption(f.ports,guide,ref,{}),/human/);
  await assert.rejects(m.correctExperience(f.ports,guide,ref,{}),/human/);
  assert.equal(f.persisted,false);
});
test('query and source bounds are strict and public retention excludes native authority',() => {
  const f=fixture();assert.equal('bankId' in f.view.index,false);assert.equal('payloadSha256' in f.view.index,false);assert.equal('serviceGeneration' in f.view.index,false);
  assert.throws(() => m.parseProposalRequest({requestId:'a',target:{kind:'team'},text:'x',reason:'r',sources:[]}));
  assert.throws(() => m.parseProposalRequest({requestId:'a',target:{kind:'team'},text:'x',reason:'r',sources:[{...source,path:'/forged'}]}));
  assert.notEqual(m.memoryBankId(f.view.record.scope),m.memoryBankId({...f.view.record.scope,teamId:'clone-team'}));
});
test('invalid public query budget is rejected before any bank lookup',async () => {
  const f=fixture();for(const input of [{query:'x'.repeat(4001)},{query:'x',limit:9},{query:'x',limit:0},{query:'x',bankId:'forged'}])await assert.rejects(m.readTeamMemoryContext(f.ports,actor,ref,input));
  assert.equal(f.resolves,0);
});

test('changed source bytes prevent any new native dispatch',async () => {
  const f=fixture();f.setVerify(async () => [{...source,sha256:'f'.repeat(64)}]);
  await m.dispatchRetention(f.ports,actor,ref,f.operation.operationId);
  assert.equal(f.trace.includes('network'),false);assert.equal(f.operation.state,'pending');
});
test('service failure with proven operation and document absence resubmits same UUID once',async () => {
  const f=fixture();await f.ports.store.commitFeedback(actor,ref,m.parseFeedbackRequest({requestId:'r',target:{kind:'team'},text:'SRAM cap 37 ns',reason:'feedback'}));
  const base=f.ports.hindsight.fetch!;let unavailable=true;
  f.ports.hindsight.fetch=async(input,init) => {
    if(String(input).endsWith('/memories') && unavailable) {unavailable=false;f.uuids.push(JSON.parse(String(init?.body)).operation_id);throw Error('service unavailable');}
    if(String(input).includes('/operations/') || String(input).includes('/documents/')) return new Response('',{status:404});
    return base(input,init);
  };
  await m.dispatchRetention(f.ports,actor,ref,f.operation.operationId);
  assert.equal(f.operation.state,'unknown');
  await m.dispatchRetention(f.ports,actor,ref,f.operation.operationId);
  assert.equal(f.operation.state,'submitted');assert.deepEqual(f.uuids,[f.operation.operationId,f.operation.operationId]);
  assert.equal(f.trace.filter(v => v==='claim-unknown').length,3);
});
test('pruned parent with an existing document stays unknown without resubmission',async () => {
  const f=fixture();f.operation.state='unknown';const base=f.ports.hindsight.fetch!;
  f.ports.hindsight.fetch=async(input,init) => String(input).includes('/operations/') ? new Response('',{status:404}) : base(input,init);
  await m.dispatchRetention(f.ports,actor,ref,f.operation.operationId);
  assert.equal(f.operation.state,'unknown');assert.deepEqual(f.uuids,[]);
});
test('revocation or correction after absence proof suppresses resubmission',async () => {
  for(const change of ['revoke','correct','source']) {
    const f=fixture();f.operation.state='unknown';let retainRequests=0;
    f.ports.hindsight.fetch=async input => {
      if(String(input).endsWith('/memories'))retainRequests++;
      if(String(input).includes('/documents/')) {
        if(change==='revoke')f.revoke();
        if(change==='correct'){f.view.tip.version=2;f.view.tip.state='candidate';f.view.tip.revision++;}
        if(change==='source')f.setVerify(async () => []);
      }
      return new Response('',{status:404});
    };
    await m.dispatchRetention(f.ports,actor,ref,f.operation.operationId);
    assert.deepEqual(f.uuids,[]);assert.equal(retainRequests,0);assert.equal(f.operation.state,'unknown');
  }
});

// The same role/scope policy executes inside both Store authorization transactions.
test('member adoption policy distinguishes personal authorship, frozen leadership and human feedback',()=>{
  const f=fixture('candidate');f.view.record.kind='experience';
  const definition={leaderMemberId:'leader'};
  const member={kind:'member',grant:{memberId:'worker'}};
  f.view.record.createdBy={kind:'member',actorId:'worker',memberId:'worker',runId:'run-a',effectId:'effect-a',generation:0};
  f.view.record.scope={...f.view.record.scope,kind:'member',memberId:'worker'};
  assert.doesNotThrow(()=>m.assertMemberMemoryAdoption(member,f.view,definition),'ordinary member can adopt their own technique');
  assert.throws(()=>m.assertMemberMemoryAdoption({kind:'member',grant:{memberId:'leader'}},f.view,definition),/personal|member/,'leader cannot adopt a different member private technique');
  f.view.record.scope={...f.view.record.scope,kind:'team',memberId:undefined};
  assert.throws(()=>m.assertMemberMemoryAdoption(member,f.view,definition),/leader/);
  assert.doesNotThrow(()=>m.assertMemberMemoryAdoption({kind:'member',grant:{memberId:'leader'}},f.view,definition));
  f.view.record.scope.kind='project';
  assert.throws(()=>m.assertMemberMemoryAdoption(member,f.view,definition),/leader/);
  f.view.record.kind='feedback';
  assert.throws(()=>m.assertMemberMemoryAdoption({kind:'member',grant:{memberId:'leader'}},f.view,definition),/human/);
  f.view.record.kind='experience';f.view.record.createdBy={kind:'human',actorId:'operator'};
  assert.throws(()=>m.assertMemberMemoryAdoption(member,f.view,definition),/human/);
});
