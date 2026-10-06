// Generic Pack workspace persistence through the real Host; no model, Electron or EDA.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse, stringify } from 'yaml';
import { createHimaHome, repoRoot } from './support/dsh-home.ts';
import { bootInProcess, createRootAgent, type InProcessHost } from './support/boot-inprocess.ts';
import { writeLocalSite } from './support/site.ts';
import { waitUntil } from './support/fabric.ts';
import { importLegacyLedger, prepareWorkspace } from '@hima/harness';

process.env.HIMA_TEST_LEGACY_AUTO_DRIVE = '0';
process.env.HIMA_TEST_SILENT_AGENT = '1';

async function numericHome(declareDesign = false, siteDesign?: string) {
  const h = await createHimaHome();
  try {
    const flowRoot = path.join(h.home, 'numeric-flow');
    await mkdir(flowRoot);
    await writeFile(path.join(flowRoot, 'numbers.txt'), '3\n7\n11\n');
    const packDir = path.join(h.home, 'hima/packs/authored-workshop');
    await cp(path.join(repoRoot, 'test/fixtures/pipeline/workshop'), packDir, { recursive: true });
    const contractFile = path.join(packDir, 'contract.yml');
    const contract = await readFile(contractFile, 'utf8');
    assert.ok(contract.includes('  - { name: design, description: Input set }\n'));
    const declared=parse(contract);
    if(!declareDesign)declared.inputs=declared.inputs.filter((input:{name:string})=>input.name!=='design');
    declared.workshops=[];
    declared.workspace.copy.push('numeric.sh');
    declared.tools=[{id:'numeric',file:'flow/numeric.sh',inputs:['WORKSPACE','TASK_OUTPUT','SCALE'],argv:['sh','${WORKSPACE}/flow/numeric.sh','${WORKSPACE}','${TASK_OUTPUT}','${SCALE}']}];
    await writeFile(contractFile,stringify(declared));
    const script=`set -eu
sum=$(awk -v scale="$3" '{sum+=$1} END {print sum*scale}' "$1/flow/numbers.txt")
printf 'once\\n' >> "$1/program-calls"
printf '{"schemaVersion":"1","value":{"sum":%s},"artifacts":[],"diagnostics":[]}\\n' "$sum" > "$2"
`;
    await mkdir(path.join(packDir,'flow'),{recursive:true});
    await writeFile(path.join(flowRoot,'numeric.sh'),script);await writeFile(path.join(packDir,'flow/numeric.sh'),script);
    const schema=(properties:Record<string,unknown>,required:string[])=>({version:'1',schema:{$schema:'https://json-schema.org/draft/2020-12/schema',type:'object',additionalProperties:false,properties,required}});
    await writeFile(path.join(packDir,'graph.yml'),stringify({schema:'hima-flow/1',id:'authored-workshop',version:'1',flow:{kind:'task',id:'calculate',tool:'numeric',inputs:{SCALE:{source:'strategy',path:['scale']}},contract:{input:schema({SCALE:{type:'number'}},['SCALE']),output:schema({sum:{type:'number'}},['sum'])}}}));
    await writeFile(path.join(packDir, 'PACK.md'), '# Generic numeric persistence fixture\n');
    await writeLocalSite(h, { allowedReadRoots: [h.workspace, flowRoot], allowedWriteRoots: [h.workspace],
      bindings: { flowRoot, workspaceRoot: h.workspace, ...(siteDesign === undefined ? {} : { design: siteDesign }) } });
    return h;
  } catch (error) { await h.dispose(); throw error; }
}

test('durable workspace preparation fences Site writes and reuses the same verified files', async () => {
  const h = await numericHome();
  try {
    const module = (name: string) => import(pathToFileURL(path.join(process.env.HIMA_U6_FACADE_PACKAGE ?? path.join(repoRoot, 'packages/harness'), 'lib', `${name}.js`)).href);
    const { prepareWorkspaceFiles } = await module('workspace');
    const { loadSite } = await module('sites');
    const { loadPack } = await module('packs');
    const site = loadSite(path.join(h.home, 'hima/sites'), 'local');
    const folder = loadPack(path.join(h.home, 'hima/packs'), 'authored-workshop').folder;
    const options = { site, folder, campaignId: 'durable-workspace' };
    await assert.rejects(prepareWorkspaceFiles({ ...options, beforeWrite: async () => { throw new Error('paused before actual write'); } }), /paused before actual write/);
    await assert.rejects(access(path.join(h.workspace, options.campaignId)), /ENOENT/);
    let writes = 0;
    const targets: string[] = [];
    const prepared = await prepareWorkspaceFiles({ ...options, beforeWrite: async (target: string) => { writes++; targets.push(target); } });
    assert.equal(prepared.kind, 'prepared');
    assert.ok(writes > 0);
    assert.ok(targets.every(target => target === prepared.file.workspace || target.startsWith(prepared.file.workspace + path.sep)));
    assert.equal(await readFile(path.join(prepared.file.workspace, 'flow/numbers.txt'), 'utf8'), '3\n7\n11\n');
    const priorWrites = writes;
    const reused = await prepareWorkspaceFiles({ ...options, beforeWrite: async (target: string) => { writes++; targets.push(target); } });
    assert.equal(reused.kind, 'reused');
    assert.deepEqual(reused.file, prepared.file);
    assert.equal(writes, priorWrites);
    const partial = path.join(h.workspace, 'durable-partial');
    await mkdir(partial);
    await writeFile(path.join(partial, 'retained.txt'), 'unknown original bytes');
    const unknown = await prepareWorkspaceFiles({ ...options, campaignId: 'durable-partial', beforeWrite: async () => { writes++; } });
    assert.equal(unknown.kind, 'occupied');
    assert.equal(await readFile(path.join(partial, 'retained.txt'), 'utf8'), 'unknown original bytes');
    assert.equal(writes, priorWrites, 'an unknown partial workspace is read without any overwrite');

  } finally { await h.dispose(); }
});

async function completed(host:InProcessHost,runId:string) {
  let context=await host.ctx.hima.readExecutionContext(runId);
  await waitUntil('the automatic numeric task completes',async()=>{context=await host.ctx.hima.readExecutionContext(runId);return context.durable?.workflow?.status==='SUCCESS';});
  assert.equal((context.durable?.outcome as {state?:string})?.state,'succeeded',JSON.stringify(context.durable));
  return context;
}

test('a generic Pack without design reopens its completed Run without rewriting workspace facts', async () => {
  const h=await numericHome();let host:InProcessHost|undefined;
  try {
    host=await bootInProcess(h);const owner=await createRootAgent(host.ctx,h.workspace);
    const started=await host.ctx.hima.startRun({pack:'authored-workshop',site:'local',goal:{target_period_ns:2},ownerSessionId:String(owner.id)});
    assert.ok(started.kind==='preparing'||started.kind==='ran',JSON.stringify(started));
    const current=await completed(host,started.run.id);assert.equal(current.engine,'dbos/5.2.11');
    const outcome=current.durable!.outcome as unknown as {committed:Record<string,{value:{sum:number}}>};assert.equal(outcome.committed.calculate!.value.sum,42);
    assert.equal('goalState' in current.run&&current.run.goalState,'unknown','A completed numeric tool with no Goal claim does not invent a Goal result');
    const original=await host.ctx.hima.durable.store.flowFact(started.run.id,'preparation');
    const metadata=await readFile(path.join(started.workspace,'workspace.json'),'utf8');assert.equal(Object.hasOwn(JSON.parse(metadata),'design'),false);
    assert.equal(await readFile(path.join(started.workspace,'program-calls'),'utf8'),'once\n');
    await host.dispose();host=undefined;host=await bootInProcess(h);await host.ctx.hima.reconciled;
    const reopened=await completed(host,started.run.id);assert.equal('goalState' in reopened.run&&reopened.run.goalState,'unknown');
    assert.deepEqual(await host.ctx.hima.durable.store.flowFact(started.run.id,'preparation'),original);
    assert.equal(await readFile(path.join(started.workspace,'workspace.json'),'utf8'),metadata);
    assert.equal(await readFile(path.join(started.workspace,'program-calls'),'utf8'),'once\n','Reopen never launches another actual program');
    assert.equal(await readFile(path.join(h.home,'numeric-flow/numbers.txt'),'utf8'),'3\n7\n11\n');
  }finally{await host?.dispose();await h.dispose();}
});

test('an undeclared Site design is neither bound nor invented when generic workspace metadata is reused', async () => {
  const h = await numericHome(false, 'unrelated-site-design');
  const host = await bootInProcess(h);
  try {
    const deps = { ledger: host.ctx.hima.ledger, packsDir: path.join(h.home, 'hima/packs'), sitesDir: path.join(h.home, 'hima/sites') };
    const request = { pack: 'authored-workshop', site: 'local', campaign: 'generic-reuse' };
    const first = await prepareWorkspace(deps, request);
    assert.equal(first.kind, 'prepared');
    if (first.kind !== 'prepared') return;
    const at = path.join(first.file.workspace, 'workspace.json');
    const original = await readFile(at);
    assert.equal(Object.hasOwn(first.file, 'design'), false);
    assert.equal(Object.hasOwn(first.record, 'design'), false);
    const second = await prepareWorkspace(deps, { ...request, run: first.run.id });
    assert.equal(second.kind, 'reused');
    if (second.kind !== 'reused') return;
    assert.equal(Object.hasOwn(second.record, 'design'), false);
    assert.deepEqual(await readFile(at), original);
    // An actual design appearing in metadata changes identity, even for a generic Pack.
    await writeFile(at, JSON.stringify({ ...first.file, design: 'invented-design' }));
    const mismatch = await prepareWorkspace(deps, { ...request, run: first.run.id });
    assert.equal(mismatch.kind, 'occupied');
    if (mismatch.kind === 'occupied') assert.match(mismatch.reason, /design \(not declared\)/);
    assert.equal(host.ctx.hima.ledger.records({ runId: first.run.id, type: 'workspace' }).length, 2);
  } finally { await host.dispose(); await h.dispose(); }
});

for (const design of [undefined, 'declared-numbers']) test(`a Pack declaring design ${design === undefined ? 'refuses its missing binding before a Run' : 'preserves its binding across cold restart'}`, async () => {
  const h = await numericHome(true, design);
  let host: InProcessHost | undefined;
  try {
    host = await bootInProcess(h);
    const owner = await createRootAgent(host.ctx, h.workspace);
    const started = await host.ctx.hima.startRun({ pack: 'authored-workshop', site: 'local',
      goal: { target_period_ns: 2 }, ownerSessionId: String(owner.id) });
    if (design === undefined) {
      assert.equal(started.kind, 'unfit');
      assert.match(JSON.stringify(started), /input \\"design\\" is not bound/);
      assert.equal(host.ctx.hima.ledger.runs().length, 0);
      return;
    }
    assert.ok(started.kind==='preparing'||started.kind==='ran',JSON.stringify(started));
    await completed(host,started.run.id);
    const original=await host.ctx.hima.durable.store.flowFact(started.run.id,'preparation');
    assert.equal((original as unknown as {file:{design:string}}).file.design,design);
    const metadata = await readFile(path.join(started.workspace, 'workspace.json'));
    assert.equal(JSON.parse(metadata.toString()).design, design);
    await host.dispose();
    host = undefined;
    host = await bootInProcess(h);
    await host.ctx.hima.reconciled;
    assert.deepEqual(await host.ctx.hima.durable.store.flowFact(started.run.id,'preparation'),original);
    assert.deepEqual(await readFile(path.join(started.workspace, 'workspace.json')), metadata);
  } finally { await host?.dispose(); await h.dispose(); }
});

test('generic legacy workspace history stays readable without hot adoption and invalid v19 input stays unchanged',async()=>{
  const h=await numericHome();let host:InProcessHost|undefined;
  try {
    host=await bootInProcess(h);
    // Build only historical record data through the legacy projection helper; no legacy engine,
    // owner turn, model or Job executes. New production startRun is qualified above through DBOS.
    const deps={ledger:host.ctx.hima.ledger,packsDir:path.join(h.home,'hima/packs'),sitesDir:path.join(h.home,'hima/sites')};
    const prepared=await prepareWorkspace(deps,{pack:'authored-workshop',site:'local',campaign:'retained-generic-history'});
    assert.equal(prepared.kind,'prepared');if(prepared.kind!=='prepared')throw new Error('Historical fixture preparation failed');
    const original=host.ctx.hima.ledger.records({runId:prepared.run.id});
    const metadataFile=path.join(prepared.file.workspace,'workspace.json'),metadata=await readFile(metadataFile,'utf8');assert.equal(Object.hasOwn(JSON.parse(metadata),'design'),false);
    await host.dispose();host=undefined;
    const storageFile=path.join(h.home,'storages/hima_ledger.json'),storedBytes=await readFile(storageFile),stored=JSON.parse(storedBytes.toString());
    stored.unit.version=19;for(const record of Object.values<{type:string;packDigest?:string}>(stored.tables.records))if(record.type==='workspace')delete record.packDigest;
    const sourceFile=path.join(h.home,'invalid-v19.json'),source=JSON.stringify(stored);await writeFile(sourceFile,source);
    await assert.rejects(importLegacyLedger({sourceFile,home:path.join(h.home,'must-not-import')}),/design/);assert.equal(await readFile(sourceFile,'utf8'),source);
    host=await bootInProcess(h);await host.ctx.hima.reconciled;
    assert.deepEqual(host.ctx.hima.ledger.records({runId:prepared.run.id}),original);
    assert.deepEqual(await host.ctx.hima.durable.store.runs(),[],'History reading creates no durable Run and performs no hot conversion');
    assert.equal(await readFile(metadataFile,'utf8'),metadata);assert.deepEqual(await readFile(storageFile),storedBytes);
  }finally{await host?.dispose();await h.dispose();}
});
