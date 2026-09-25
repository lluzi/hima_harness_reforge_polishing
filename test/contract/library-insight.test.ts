import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { libraryInsightDocument, filterLibraryFindings, readReportMaterial, retainRunMaterial, readGuideContext, resolveReportAddress } from '@hima/harness';
import { repoRoot } from './support/dsh-home.ts';
import { localHome } from './support/fabric.ts';
import { bootInProcess, createRootAgent } from './support/boot-inprocess.ts';
import { timingProbePackId } from './support/pack.ts';

process.env.HIMA_TEST_LEGACY_AUTO_DRIVE='0';
process.env.HIMA_TEST_SILENT_AGENT='1';
const fixture=()=>readFile(path.join(repoRoot,'test/fixtures/library-insight/report.json'),'utf8');

test('synthetic Insight validates unknowns, two independent severity axes, summary references and immutable local filters',async()=>{
  const report=libraryInsightDocument.parse(JSON.parse(await fixture()));
  const before=JSON.stringify(report);
  assert.equal(filterLibraryFindings(report,{corner:'slow'})[0]!.values[0]!.value,0);
  assert.equal(filterLibraryFindings(report,{corner:'slow'})[0]!.designRelevance,'none');
  assert.equal(filterLibraryFindings(report,{corner:'fast'})[0]!.values[0]!.value,null);
  assert.equal(filterLibraryFindings(report,{severity:'critical'}).length,1);
  assert.equal(JSON.stringify(report),before);
  const missing=structuredClone(report);delete missing.findings[1]!.values[0]!.missingReason;
  assert.equal(libraryInsightDocument.safeParse(missing).success,false);
  assert.equal(libraryInsightDocument.safeParse({...report,evidenceClass:'native-qualified'}).success,true);
  assert.equal(libraryInsightDocument.safeParse({...report,evidenceClass:'unqualified'}).success,false);
  assert.equal(libraryInsightDocument.safeParse({...report,summary:{...report.summary,best:['invented']}}).success,false);
  assert.equal(libraryInsightDocument.safeParse({...report,findings:[...report.findings,report.findings[0]]}).success,false);
});

test('real Host resolves only recorded/hash-verified Insight bytes and refuses wrong project or changed payload',async t=>{
  const home=await localHome(t,{sleepSeconds:0});assert.ok(home);const host=await bootInProcess(home.h);
  try {
    const viewer=await createRootAgent(host.ctx,home.h.workspace);
    const started=await host.ctx.hima.startRun({pack:timingProbePackId,site:'local',goal:{target_period_ns:2},ownerSessionId:String(viewer.id)});assert.equal(started.kind,'ran');if(started.kind!=='ran')return;
    const text=await fixture();const file=path.join(home.h.workspace,'synthetic-insight.json');await writeFile(file,text);
    const digest=createHash('sha256').update(text).digest('hex');
    const retainedPath=await retainRunMaterial({ledger:host.ctx.hima.ledger,packsDir:path.join(home.h.home,'hima/packs')},started.run.id,Buffer.from(text),digest);
    assert.ok(retainedPath);
    const record=await host.ctx.hima.ledger.appendCode(started.run.id,{nodeId:started.run.currentNode!,attempt:1,sessionId:String(viewer.id),workshop:'fixture',path:file,retainedPath,sha256:digest,bytes:Buffer.byteLength(text),language:'json'});
    const deps={ctx:host.ctx,ledger:host.ctx.hima.ledger,executionContext:(id:string)=>host.ctx.hima.executionContext(id),readExperience:(id:string)=>host.ctx.hima.readExperience(id),readReportMaterial:(id:string,ref:string)=>readReportMaterial({ledger:host.ctx.hima.ledger,sitesDir:path.join(home.h.home,'hima/sites'),packsDir:path.join(home.h.home,'hima/packs')},id,ref)};
    const target=await resolveReportAddress(deps,String(viewer.id),record.id);
    assert.equal(target.sha256,record.sha256);
    const view=await readGuideContext(deps,{sessionId:String(viewer.id),requestId:'read-fixture',target});
    assert.ok(view.facts&&'schema' in view.facts);assert.equal(view.facts.schema,'hima-library-insight-report/1');
    assert.deepEqual(view.sources,[record.id]);assert.match(view.missing.join(' '),/Synthetic/);

    const nativeText=JSON.stringify({...JSON.parse(text),evidenceClass:'native-qualified'})+'\n';
    const nativeFile=path.join(home.h.workspace,'native-qualified-insight.json');await writeFile(nativeFile,nativeText);
    const nativeDigest=createHash('sha256').update(nativeText).digest('hex');
    const nativeRetained=await retainRunMaterial({ledger:host.ctx.hima.ledger,packsDir:path.join(home.h.home,'hima/packs')},started.run.id,Buffer.from(nativeText),nativeDigest);
    assert.ok(nativeRetained);
    const nativeRecord=await host.ctx.hima.ledger.appendCode(started.run.id,{nodeId:started.run.currentNode!,attempt:1,sessionId:String(viewer.id),workshop:'fixture',path:nativeFile,retainedPath:nativeRetained,sha256:nativeDigest,bytes:Buffer.byteLength(nativeText),language:'json'});
    const nativeTarget=await resolveReportAddress(deps,String(viewer.id),nativeRecord.id);
    const nativeView=await readGuideContext(deps,{sessionId:String(viewer.id),requestId:'read-native-qualified',target:nativeTarget});
    assert.ok(nativeView.facts&&'evidenceClass' in nativeView.facts);assert.equal(nativeView.facts.evidenceClass,'native-qualified');
    assert.deepEqual(nativeView.missing,[],'a native-qualified report is not mislabeled as a synthetic fixture');

    await writeFile(file,text+'changed');
    assert.equal((await resolveReportAddress(deps,String(viewer.id),record.id)).sha256,digest,'the retained source stays readable after its live pathname changes');
    await writeFile(retainedPath,Buffer.alloc(2*1024*1024+1,65));
    await assert.rejects(resolveReportAddress(deps,String(viewer.id),record.id),{code:'hima/context-stale'},'a grown retained file is rejected before it can be buffered into this view');
    assert.equal(host.ctx.hima.ledger.runs().length,1,'viewing does not start analysis');
  }finally{await host.dispose();await home.h.dispose();}
});
