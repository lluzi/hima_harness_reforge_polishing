// PLS-30: offline PDF/current-knowledge indexing and source-linked Ledger use. No model, Desktop,
// network or EDA process is started.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { copyFile, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { createHimaHome, repoRoot } from './support/dsh-home.ts';
import { bootInProcess, createRootAgent } from './support/boot-inprocess.ts';
import { installPack, packsDirOf, timingProbePackId } from './support/pack.ts';
import { localHome } from './support/fabric.ts';
import { clearCurrentKnowledge, importCurrentKnowledge, indexKnowledgeDocument, listCurrentKnowledge,
  packDigestOf, readCurrentKnowledge, recordDocumentKnowledgeRead, searchCurrentKnowledge } from '@hima/harness';

// These cases prove the visible Campaign-owner path, never the legacy automatic fixture mode.
process.env.HIMA_TEST_LEGACY_AUTO_DRIVE = '0';

const fixture = path.join(repoRoot, 'test/fixtures/knowledge/eda-clock-guide.pdf');

test('a PDF is indexed offline into bounded page-cited excerpts and search reads the exact excerpt', async () => {
  const indexed = await indexKnowledgeDocument({ file: fixture, scope: 'fixture', source: 'current', title: 'EDA Timing Preparation Guide', version: '1' });
  assert.equal(indexed.document.mediaType, 'application/pdf');
  assert.ok(indexed.chunks.length > 0);
  assert.ok(indexed.chunks.every((chunk) => chunk.page === 1 && chunk.text.length <= 2_400));
  const h = await createHimaHome();
  try {
    const root = path.join(h.home, 'hima/current-knowledge');
    const imported = await importCurrentKnowledge({ root, scope: 'workspace-a', file: fixture, title: 'EDA Timing Preparation Guide', version: '1' });
    assert.equal((await stat(imported.document.sourcePath)).isFile(), true, 'the durable identity names the source after atomic publication');
    const hits = await searchCurrentKnowledge(root, 'workspace-a', 'custom cell adopted final routed database');
    assert.ok(hits.length > 0);
    assert.equal(hits[0]?.document.id, imported.document.id);
    assert.equal(hits[0]?.page, 1);
    assert.match(hits[0]?.snippet ?? '', /effective instance/);
    const read = await readCurrentKnowledge(root, 'workspace-a', imported.document.id, hits[0]!.id);
    assert.equal(read.sha256, hits[0]?.sha256);
    assert.deepEqual(await listCurrentKnowledge(root, 'workspace-b'), [], 'another workspace cannot see this current document');
  } finally { await h.dispose(); }
});

test('current knowledge rejects symlink ancestors and index/source tampering before list, read or clear', async () => {
  const h = await createHimaHome();
  try {
    const root = path.join(h.home, 'hima/current-knowledge');
    const source = path.join(h.home, 'guide.txt');
    await writeFile(source, 'clock uncertainty comes from the actual routed database');
    const imported = await importCurrentKnowledge({ root, scope: 'isolated', file: source });
    const indexAt = path.join(path.dirname(imported.document.sourcePath), 'index.json');
    await writeFile(indexAt, '{ damaged derived cache');
    assert.equal((await listCurrentKnowledge(root, 'isolated'))[0]?.id, imported.document.id,
      'a damaged derived index is rebuilt from the owned source and independent metadata');
    assert.match(await readFile(indexAt, 'utf8'), /hima-knowledge-index\/1/);
    const sourceText = await readFile(imported.document.sourcePath, 'utf8');
    await writeFile(imported.document.sourcePath, `${sourceText} changed after indexing`);
    await assert.rejects(() => listCurrentKnowledge(root, 'isolated'), /source bytes do not match/);

    const scopeDir = path.dirname(path.dirname(imported.document.sourcePath));
    const outside = path.join(h.home, 'outside');
    await mkdir(outside);
    await rm(imported.document.sourcePath);
    await symlink(source, imported.document.sourcePath);
    await assert.rejects(() => readCurrentKnowledge(root, 'isolated', imported.document.id, `${imported.document.id}:0`), /symbolic link/);
    await rm(scopeDir, { recursive: true, force: true });
    await symlink(outside, scopeDir);
    await assert.rejects(() => clearCurrentKnowledge(root, 'isolated', imported.document.id), /symbolic link/);
  } finally { await h.dispose(); }
});

test('Campaign-attached document evidence is bound to one owner execution and its reviewed proposal scope', async (t) => {
  const home = await localHome(t, { sleepSeconds: 0 });
  if (!home) return;
  await writeFile(path.join(packsDirOf(home.h), timingProbePackId, 'graph.yml'), `id: ${timingProbePackId}\nversion: '2'\nentry: review-knowledge\nnodes:\n  - id: review-knowledge\n    kind: wait\n    parameters: { blocker: Review current knowledge before business work }\nedges: []\n`);
  const contractPath = path.join(packsDirOf(home.h), timingProbePackId, 'contract.yml');
  await writeFile(contractPath, (await readFile(contractPath, 'utf8')).replace('  target_period_ns: { label: clock period at most, unit: ns }\n', ''));
  let host = await bootInProcess(home.h);
  const originalPackDigest=packDigestOf(path.join(packsDirOf(home.h),timingProbePackId));
  try {
    const owner = await createRootAgent(host.ctx, home.h.workspace);
    const other = await createRootAgent(host.ctx, home.h.workspace);
    let serial = 0;
    const invoke = async (agent: typeof owner, args: Record<string, unknown>, callId = `bound-knowledge-${++serial}`) => host.ctx.tools.execute({
      name: 'hima_knowledge', arguments: args, agent, callId: callId as never, signal: AbortSignal.timeout(20_000),
    });
    const product = async (name: 'hima_prepare' | 'hima_run', args: Record<string, unknown>) => host.ctx.tools.execute({
      name, arguments: args, agent: owner, callId: `bound-product-${++serial}` as never, signal: AbortSignal.timeout(20_000),
    });
    const source = path.join(home.h.workspace, 'guide.pdf');
    await copyFile(fixture, source);
    const prepared = await product('hima_prepare', { pack: timingProbePackId, site: 'local' });
    assert.equal(prepared.isError, false, JSON.stringify(prepared));
    const proposal = JSON.parse(prepared.content.filter((item) => item.type === 'text').map((item) => item.text).join('')) as Record<string, any>;
    assert.equal(proposal.ready, true);
    const importedAnswer = await invoke(owner, { action: 'import', source: 'current', scope: proposal.id, file: source });
    assert.equal(importedAnswer.isError, false, JSON.stringify(importedAnswer));
    const imported = JSON.parse(importedAnswer.content.filter((item) => item.type === 'text').map((item) => item.text).join('')) as Record<string, any>;
    const searchedAnswer = await invoke(owner, { action: 'search', source: 'current', scope: proposal.id, query: 'final routed database' });
    const searched = JSON.parse(searchedAnswer.content.filter((item) => item.type === 'text').map((item) => item.text).join('')) as Record<string, any>;
    const started = await product('hima_run', { proposalId: proposal.id, pack: timingProbePackId, site: 'local', goal: proposal.goal, strategy: proposal.strategy });
    assert.equal(started.isError, false, JSON.stringify(started));
    const run = JSON.parse(started.content.filter((item) => item.type === 'text').map((item) => item.text).join('')) as Record<string, any>;
    assert.equal(run.kind, 'preparing', JSON.stringify(run));
    let context = await host.ctx.hima.readExecutionContext(run.runId);
    const readyDeadline = Date.now() + 12_000;
    while (!context.executions.some(item => item.nodeId === 'review-knowledge') && Date.now() < readyDeadline) {
      await new Promise(resolve => setTimeout(resolve, 25));
      context = await host.ctx.hima.readExecutionContext(run.runId);
    }
    assert.equal(context.run.status, 'running');
    assert.equal(context.executions.length, 1);
    assert.equal(context.budget.phase, 'active');
    assert.equal(context.run.currentNode, undefined, 'PG authority never invents a legacy currentNode');
    const laterPreparation = await product('hima_prepare', { pack: timingProbePackId, site: 'local' });
    const laterProposal = JSON.parse(laterPreparation.content.filter((item) => item.type === 'text').map((item) => item.text).join('')) as Record<string, any>;
    assert.notEqual(laterProposal.id, proposal.id, 'a later Campaign with the same facts has a distinct current-knowledge scope');
    const crossCampaignSearch = await invoke(owner, { action: 'search', source: 'current', scope: laterProposal.id, query: 'final routed database' });
    assert.equal(crossCampaignSearch.isError, false, JSON.stringify(crossCampaignSearch));
    assert.deepEqual(JSON.parse(crossCampaignSearch.content.filter((item) => item.type === 'text').map((item) => item.text).join('')).hits, []);
    const control = context.run.control!;
    const executionOwner = host.ctx.get('agents')!.get(control.owner as never)!;
    assert.notEqual(String(executionOwner.id), String(owner.id));
    assert.equal(control.guideSessionId, String(owner.id));
    const execution = context.executions[0]!;
    const readArgs = { action: 'read', source: 'current', scope: proposal.id, run: run.runId,
      documentId: imported.document.id, chunkId: searched.hits[0].id };
    const read = await invoke(executionOwner, readArgs,'knowledge-idempotent');
    assert.equal(read.isError, false, JSON.stringify(read));
    const returned=JSON.parse(read.content.filter(item=>item.type==='text').map(item=>item.text).join(''));
    const recorded=await host.ctx.hima.readMaterial(run.runId,returned.recordId);
    assert.ok(recorded.kind==='read');
    const record=recorded.record;
    assert.equal(recorded.text,returned.text);
    assert.match(record.id,/^hima-fact:/);
    assert.ok(record?.type === 'knowledge');
    assert.equal(record.attempt, execution.attempt);
    assert.equal(record.generation, execution.generation);
    assert.equal(record.nodeId, execution.nodeId);
    assert.ok(record.conditions?.some((condition) => /current Campaign conclusions still require current execution evidence/.test(condition)));
    const store=host.ctx.hima.durable.store;
    const originalInvocation=(await store.flowInvocations(run.runId)).find(item=>item.identity.effectId===execution.id)!;
    const fact=await store.fact(record.id);
    assert.ok(fact && fact.kind==='effect-fact');
    assert.equal((fact.payload as any).identity.effectId,execution.id);
    assert.equal((fact.payload as any).fact.generation,execution.generation);
    const knowledgeFacts=async()=> (await store.orderedExternalEffectFacts(originalInvocation.identity,'knowledge:')).length;
    assert.equal(await knowledgeFacts(),1);
    const repeated=await invoke(executionOwner,readArgs,'knowledge-idempotent');
    assert.equal(repeated.isError,false,JSON.stringify(repeated));
    assert.equal(JSON.parse(repeated.content.filter(item=>item.type==='text').map(item=>item.text).join('')).recordId,record.id);
    assert.equal(await knowledgeFacts(),1,'same DSH call retains one immutable PG fact');
    const alternateSource=path.join(home.h.workspace,'different-knowledge.txt');
    await writeFile(alternateSource,'Another exact background excerpt from a different current document.');
    const alternateAnswer=await invoke(owner,{action:'import',scope:proposal.id,run:run.runId,file:alternateSource});
    assert.equal(alternateAnswer.isError,false,JSON.stringify(alternateAnswer));
    const alternate=JSON.parse(alternateAnswer.content.filter(item=>item.type==='text').map(item=>item.text).join(''));
    const alternateSearch=await invoke(owner,{action:'search',scope:proposal.id,run:run.runId,query:'Another exact'});
    assert.equal(alternateSearch.isError,false,JSON.stringify(alternateSearch));
    const alternateHits=JSON.parse(alternateSearch.content.filter(item=>item.type==='text').map(item=>item.text).join('')).hits;
    assert.ok(alternateHits.length>0);
    const conflict=await invoke(executionOwner,{...readArgs,documentId:alternate.document.id,chunkId:alternateHits[0]!.id},'knowledge-idempotent');
    assert.equal(conflict.isError,true,JSON.stringify(conflict));
    assert.match(JSON.stringify(conflict.content),/Effect fact identity/);
    assert.equal(await knowledgeFacts(),1);
    const wrongProposal=await invoke(executionOwner,{...readArgs,scope:laterProposal.id});
    assert.equal(wrongProposal.isError,true);
    assert.match(JSON.stringify(wrongProposal.content),/does not belong to this Campaign proposal/);
    const foreignWorkspace=path.join(home.h.home,'foreign-project');
    await mkdir(foreignWorkspace);
    const outsider=await createRootAgent(host.ctx,foreignWorkspace);
    const wrongProject=await invoke(outsider,readArgs);
    assert.equal(wrongProject.isError,true);
    assert.match(JSON.stringify(wrongProject.content),/project|workspace/i);
    const nonowner = await invoke(other, readArgs);
    assert.equal(nonowner.isError, true);
    assert.match(JSON.stringify(nonowner.content), /owning Campaign Agent/);
    const crossScope = await invoke(executionOwner, { ...readArgs, scope: '0'.repeat(64) });
    assert.equal(crossScope.isError, true);
    assert.match(JSON.stringify(crossScope.content), /full, current HimaGuide Campaign proposal token/);
    // Hold the real asynchronous retention mkdir, then change PG authority before final append.
    let releaseRetention!:()=>void,enteredRetention!:()=>void;
    const heldRetention=new Promise<void>(resolve=>{releaseRetention=resolve;});
    const retentionEntered=new Promise<void>(resolve=>{enteredRetention=resolve;});
    const originalMkdir=fs.promises.mkdir;
    const retainedRoot=path.dirname(record.retainedPath!);
    const mkdirMock=t.mock.method(fs.promises,'mkdir',async(...args:any[])=>{
      if(String(args[0])===retainedRoot){enteredRetention();await heldRetention;}
      return (originalMkdir as any)(...args);
    });
    syncBuiltinESMExports();
    const racingRead=invoke(executionOwner,readArgs,'knowledge-handoff-race');
    try {
      let retentionTimer:NodeJS.Timeout|undefined;
      try { await Promise.race([retentionEntered,new Promise((_,reject)=>{retentionTimer=setTimeout(()=>reject(new Error('retention gate not reached')),5000);})]); }
      finally {clearTimeout(retentionTimer);}
      const handoff=await host.ctx.hima.executionAction({runId:run.runId,actor:String(executionOwner.id),expectedEpoch:control.epoch,expectedRevision:control.revision,requestId:'knowledge-handoff',action:'handoff',targetOwner:String(other.id)});
      assert.equal(handoff.kind,'accepted',JSON.stringify(handoff));
    } finally {releaseRetention();mkdirMock.mock.restore();syncBuiltinESMExports();}
    const raced=await racingRead;
    assert.equal(raced.isError,true,JSON.stringify(raced));
    assert.match(JSON.stringify(raced.content),/current owner|admission/);
    assert.equal(await knowledgeFacts(),1,'handoff during retained I/O appends no Knowledge fact');
    assert.equal(JSON.stringify(raced.content).includes(returned.text),false,'failed final fence exposes no excerpt');
    const staleClear=await invoke(executionOwner,{action:'clear',scope:proposal.id,run:run.runId,documentId:imported.document.id});
    assert.equal(staleClear.isError,true);
    // Clear owns the Run lock through the real exact-directory rm; newer pause waits behind it.
    let clearEntered!:()=>void,clearRelease!:()=>void;
    const clearGate=new Promise<void>(resolve=>{clearEntered=resolve;}),clearHold=new Promise<void>(resolve=>{clearRelease=resolve;});
    const originalRm=fs.promises.rm;
    const rmMock=t.mock.method(fs.promises,'rm',async(...args:any[])=>{
      if(String(args[0])===path.dirname(imported.document.sourcePath)){clearEntered();await clearHold;}
      return (originalRm as any)(...args);
    });syncBuiltinESMExports();
    const clearRequest=invoke(other,{action:'clear',scope:proposal.id,run:run.runId,documentId:imported.document.id});
    let pauseRequest:Promise<any>|undefined,pauseSettled=false;
    try {
      let clearTimer:NodeJS.Timeout|undefined;
      try {await Promise.race([clearGate,new Promise((_,reject)=>{clearTimer=setTimeout(()=>reject(new Error('clear rm gate not reached')),5000);})]);}
      finally {clearTimeout(clearTimer);}
      const beforePause=(await store.run(run.runId));
      pauseRequest=host.ctx.hima.executionAction({runId:run.runId,actor:String(other.id),expectedEpoch:beforePause.epoch,expectedRevision:beforePause.revision,requestId:'knowledge-clear-pause',action:'pause'}).then(result=>{pauseSettled=true;return result;});
      await new Promise(resolve=>setTimeout(resolve,25));
      assert.equal(pauseSettled,false,'new control cannot commit across the clear transaction');
      assert.equal((await store.run(run.runId)).revision,beforePause.revision);
    } finally {clearRelease();rmMock.mock.restore();syncBuiltinESMExports();}
    const cleared=await clearRequest;
    assert.equal(cleared.isError,false,JSON.stringify(cleared));
    assert.equal(JSON.parse(cleared.content.filter(item=>item.type==='text').map(item=>item.text).join('')).cleared,true);
    const paused=await pauseRequest!;
    assert.equal(paused.kind,'accepted');
    const heldRead=await invoke(other,{...readArgs,documentId:alternate.document.id,chunkId:alternateHits[0]!.id});
    assert.equal(heldRead.isError,true);
    assert.match(JSON.stringify(heldRead.content),/active writable Campaign/);
    const heldClear=await invoke(other,{action:'clear',scope:proposal.id,run:run.runId,documentId:alternate.document.id});
    assert.equal(heldClear.isError,true);
    const resume=await host.ctx.hima.executionAction({runId:run.runId,actor:String(other.id),expectedEpoch:paused.context.run.control!.epoch,expectedRevision:paused.context.run.control!.revision,requestId:'knowledge-clear-continue',action:'continue'});
    assert.equal(resume.kind,'accepted');
    const clearedAgain=await invoke(other,{action:'clear',scope:proposal.id,run:run.runId,documentId:imported.document.id});
    assert.equal(clearedAgain.isError,false);
    assert.equal(JSON.parse(clearedAgain.content.filter(item=>item.type==='text').map(item=>item.text).join('')).cleared,false);
    assert.equal((await host.ctx.hima.readMaterial(run.runId,record.id) as any).text,returned.text);
    const currentControl=(await host.ctx.hima.readExecutionContext(run.runId)).run.control!;
    let cancelRelease!:()=>void,cancelEntered!:()=>void;
    const cancelHold=new Promise<void>(resolve=>{cancelRelease=resolve;}),cancelGate=new Promise<void>(resolve=>{cancelEntered=resolve;});
    const cancelMkdir=t.mock.method(fs.promises,'mkdir',async(...args:any[])=>{
      if(String(args[0])===retainedRoot){cancelEntered();await cancelHold;}
      return (originalMkdir as any)(...args);
    });syncBuiltinESMExports();
    const cancelRead=invoke(other,{...readArgs,documentId:alternate.document.id,chunkId:alternateHits[0]!.id},'knowledge-cancel-race');
    try {
      let cancelTimer:NodeJS.Timeout|undefined;
      try {await Promise.race([cancelGate,new Promise((_,reject)=>{cancelTimer=setTimeout(()=>reject(new Error('cancel retention gate not reached')),5000);})]);}
      finally {clearTimeout(cancelTimer);}
      const cancel=await host.ctx.hima.executionAction({runId:run.runId,actor:String(other.id),expectedEpoch:currentControl.epoch,expectedRevision:currentControl.revision,requestId:'knowledge-cancel',action:'cancel'});
      assert.equal(cancel.kind,'accepted');
    } finally {cancelRelease();cancelMkdir.mock.restore();syncBuiltinESMExports();}
    const cancelledRead=await cancelRead;
    assert.equal(cancelledRead.isError,true,JSON.stringify(cancelledRead));
    assert.equal(await knowledgeFacts(),1,'cancel during retained I/O appends no Knowledge fact');

    const closedDeadline=Date.now()+12_000;
    let closed=await host.ctx.hima.readExecutionContext(run.runId);
    while(closed.run.status!=='cancelled'&&Date.now()<closedDeadline) {await new Promise(resolve=>setTimeout(resolve,25));closed=await host.ctx.hima.readExecutionContext(run.runId);}
    assert.equal(closed.run.status,'cancelled');
    assert.equal((closed.run as any).stopState.unclosedResources,0);
    assert.equal((closed.run as any).stopState.effectsWithoutStopProof,0);
    assert.equal((closed.run as any).stopState.closed,true);
    console.log('KNOWLEDGE_CLOSURE',JSON.stringify({runId:run.runId,status:closed.run.status,stopState:(closed.run as any).stopState,goalState:(closed.run as any).goalState,knowledgeFacts:await knowledgeFacts()}));
    assert.equal((closed.run as any).goalState,'unknown');
    const material=await host.ctx.hima.readMaterial(run.runId,record.id);
    assert.ok(material.kind==='read');
    assert.equal(material.text,JSON.parse(read.content.filter(item=>item.type==='text').map(item=>item.text).join('')).text);
    const ended = await invoke(executionOwner, readArgs);
    assert.equal(ended.isError, true);
    assert.match(JSON.stringify(ended.content), /active writable Campaign/);
    const endedClear = await invoke(executionOwner, { action: 'clear', source: 'current', scope: proposal.id, run: run.runId,
      documentId: imported.document.id });
    assert.equal(endedClear.isError, true);
    assert.match(JSON.stringify(endedClear.content), /active writable Campaign/);
    assert.equal(packDigestOf(path.join(packsDirOf(home.h),timingProbePackId)),originalPackDigest);
    await host.dispose();
    host=await bootInProcess(home.h);
    const afterRestart=await host.ctx.hima.readMaterial(run.runId,record.id);
    assert.ok(afterRestart.kind==='read');
    assert.equal(afterRestart.text,returned.text,'PG recorded exact excerpt survives clear and Host restart');
    assert.equal((await host.ctx.hima.readExecutionContext(run.runId)).run.status,'cancelled');
  } finally { await host.dispose(); await home.h.dispose(); }
});

test('current knowledge and recorded excerpts survive Host restart for an ended historical Run, clear explicitly, and never change the Pack digest', async () => {
  const h = await createHimaHome();
  const root = path.join(h.home, 'hima/current-knowledge');
  await installPack(h);
  const before = packDigestOf(path.join(packsDirOf(h), timingProbePackId));
  const imported = await importCurrentKnowledge({ root, scope: 'campaign-proposal', file: fixture, title: 'EDA Timing Preparation Guide', version: '1' });
  assert.equal(packDigestOf(path.join(packsDirOf(h), timingProbePackId)), before);
  let history: { runId: string; record: Awaited<ReturnType<typeof recordDocumentKnowledgeRead>>; excerpt: string } | undefined;
  let host = await bootInProcess(h);
  try {
    // Seed an already-ended historical Run: this proves retained knowledge, not active DBOS execution recovery.
    const run = await host.ctx.hima.ledger.createRun({ campaignId: 'knowledge-fixture', siteId: 'local', packId: timingProbePackId, status: 'cancelled' });
    const [hit] = await searchCurrentKnowledge(root, 'campaign-proposal', 'clock uncertainty baseline custom-cell arm');
    assert.ok(hit);
    const excerpt = await readCurrentKnowledge(root, 'campaign-proposal', imported.document.id, hit.id);
    const record = await recordDocumentKnowledgeRead({ ledger: host.ctx.hima.ledger, packsDir: packsDirOf(h), runId: run.id,
      nodeId: 'prepare', attempt: 1, sessionId: 'session-current-knowledge', workshop: 'analysis', root, hit: hit!, origin: 'current' });
    assert.equal(record.origin, 'current');
    assert.equal(record.documentId, imported.document.id);
    assert.equal(record.chunkId, hit?.id);
    assert.equal(record.page, 1);
    assert.equal(record.sourceMaterialSha256, imported.document.sha256);
    assert.equal(record.sha256, excerpt.sha256);
    assert.equal(record.bytes, Buffer.byteLength(excerpt.text));
    assert.equal(record.exposedBytes, Buffer.byteLength(excerpt.text));
    assert.equal(record.knowledgeScope, 'campaign-proposal');
    assert.match(excerpt.text, /clock uncertainty/i);
    history = { runId: run.id, record, excerpt: excerpt.text };
  } finally { await host.dispose(); }

  host = await bootInProcess(h);
  try {
    assert.ok(history);
    assert.equal(host.ctx.hima.ledger.run(history.runId)?.status, 'cancelled');
    assert.deepEqual(host.ctx.hima.ledger.records({ runId: history.runId, type: 'knowledge' }), [history.record]);
    const retained = await host.ctx.hima.readMaterial(history.runId, history.record.id);
    assert.equal(retained.kind, 'read');
    assert.ok(retained.kind === 'read');
    assert.deepEqual(retained.record, history.record);
    assert.equal(retained.text, history.excerpt);
    assert.deepEqual(await listCurrentKnowledge(root, 'campaign-proposal'), [imported.document]);
    const current = await readCurrentKnowledge(root, 'campaign-proposal', history.record.documentId!, history.record.chunkId!);
    assert.equal(current.text, history.excerpt);
    assert.equal(current.sha256, history.record.sha256);
    assert.equal(await clearCurrentKnowledge(root, 'campaign-proposal', imported.document.id), true);
    assert.deepEqual(await listCurrentKnowledge(root, 'campaign-proposal'), []);
    assert.equal(await clearCurrentKnowledge(root, 'campaign-proposal', imported.document.id), false);
    const retainedAfterClear = await host.ctx.hima.readMaterial(history.runId, history.record.id);
    assert.equal(retainedAfterClear.kind, 'read');
    assert.ok(retainedAfterClear.kind === 'read');
    assert.equal(retainedAfterClear.text, history.excerpt, 'clearing current knowledge preserves the recorded historical excerpt');
    assert.equal(packDigestOf(path.join(packsDirOf(h), timingProbePackId)), before);
  } finally { await host.dispose(); await h.dispose(); }
});

test('HimaGuide reaches current knowledge through one bounded product tool without treating search as evidence', async () => {
  const h = await createHimaHome();
  await installPack(h);
  await installPack(h, 'custom-cell-fmax-dtco');
  const host = await bootInProcess(h);
  try {
    const agent = await createRootAgent(host.ctx, h.workspace);
    let serial = 0;
    const call = async (args: Record<string, unknown>) => {
      const answer = await host.ctx.tools.execute({ name: 'hima_knowledge', arguments: args, agent,
        callId: `knowledge-${++serial}` as never, signal: AbortSignal.timeout(20_000) });
      assert.equal(answer.isError, false, JSON.stringify(answer));
      return JSON.parse(answer.content.filter((item) => item.type === 'text').map((item) => item.text).join('')) as Record<string, any>;
    };
    assert.ok(host.ctx.tools.schemas().some((schema) => schema.name === 'hima_knowledge'));
    const prepared = await host.ctx.tools.execute({ name: 'hima_prepare', arguments: { pack: timingProbePackId }, agent,
      callId: `knowledge-prepare-${++serial}` as never, signal: AbortSignal.timeout(20_000) });
    assert.equal(prepared.isError, false, JSON.stringify(prepared));
    const scope = JSON.parse(prepared.content.filter((item) => item.type === 'text').map((item) => item.text).join('')).id;
    const workspaceFixture = path.join(h.workspace, 'guide.pdf');
    await copyFile(fixture, workspaceFixture);
    const forgedScope = await host.ctx.tools.execute({ name: 'hima_knowledge', arguments: { action: 'import', source: 'current', scope: 'a'.repeat(64), file: workspaceFixture }, agent,
      callId: `knowledge-forged-${++serial}` as never, signal: AbortSignal.timeout(20_000) });
    assert.equal(forgedScope.isError, true);
    assert.match(JSON.stringify(forgedScope.content), /full, current HimaGuide Campaign proposal token/);
    const imported = await call({ action: 'import', source: 'current', scope, file: workspaceFixture,
      title: 'EDA Timing Preparation Guide', version: '1' });
    const outsideWorkspace = await host.ctx.tools.execute({ name: 'hima_knowledge', arguments: { action: 'import', source: 'current', scope, file: fixture }, agent,
      callId: `knowledge-outside-${++serial}` as never, signal: AbortSignal.timeout(20_000) });
    assert.equal(outsideWorkspace.isError, true);
    assert.match(JSON.stringify(outsideWorkspace.content), /limited to this Agent workspace/);
    const preparedAgain = await host.ctx.tools.execute({ name: 'hima_prepare', arguments: { pack: timingProbePackId }, agent,
      callId: `knowledge-prepare-again-${++serial}` as never, signal: AbortSignal.timeout(20_000) });
    const refreshed = JSON.parse(preparedAgain.content.filter((item) => item.type === 'text').map((item) => item.text).join('')) as Record<string, any>;
    assert.equal(refreshed.knowledge.currentDocuments, 1);
    const searched = await call({ action: 'search', source: 'current', scope, query: 'final routed database' });
    assert.ok(searched.hits.length > 0);
    assert.equal(searched.hits[0].text, undefined, 'search exposes a bounded preview, not the source excerpt');
    assert.ok(searched.hits[0].snippet.length <= 360);
    const read = await call({ action: 'read', source: 'current', scope,
      documentId: imported.document.id, chunkId: searched.hits[0].id });
    assert.match(read.text, /routed database/i);
    assert.ok(read.text.length <= 2_400);
    const packSearch = await call({ action: 'search', source: 'pack', pack: 'custom-cell-fmax-dtco', query: 'matched physical' });
    assert.ok(packSearch.hits.length > 0);
    const packRead = await call({ action: 'read', source: 'pack', pack: 'custom-cell-fmax-dtco',
      documentId: packSearch.hits[0].documentId, chunkId: packSearch.hits[0].id });
    assert.match(packRead.text, /matched physical/i);
    assert.equal(host.ctx.hima.ledger.runs().length, 0,
      'a read outside a Campaign remains session knowledge and does not invent a Campaign');
  } finally { await host.dispose(); await h.dispose(); }
});
