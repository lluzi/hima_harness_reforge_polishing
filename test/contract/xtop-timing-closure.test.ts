import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { choose, loadPack, checkPack, packStage, loadSite, installPackMethod, resolveChooser, type ObservationRecord, type VerdictRecord } from '@hima/harness';
import { createHimaHome, repoRoot } from './support/dsh-home.ts';
import { bootInProcess, createRootAgent } from './support/boot-inprocess.ts';
import { himaCommand } from './support/command.ts';
import { writeLocalSite } from './support/site.ts';
import { waitUntil } from './support/fabric.ts';

const packId = 'xtop-timing-closure';

test('the XTop closure Pack loads, fits its declared execution surface and passes its cheap data-contract tests', async (t) => {
  const h = await createHimaHome();
  t.after(() => h.dispose());
  const local = await writeLocalSite(h, {
    allowedWrappers: ['/usr/bin/python3'],
    bindings: {
      inputInnovusDatabase: path.join(h.workspace, 'input.enc.dat'),
      siteProfile: path.join(h.workspace, 'site-profile.json'),
      sourceManifest: path.join(h.workspace, 'source-manifest.sha256'),
      workspaceRoot: h.workspace,
    },
    licences: { Innovus: 1, StarRC: 1, PrimeTime: 1, XTop: 1 },
  });
  const packDir = path.join(repoRoot, 'packs', packId);
  const pack = loadPack(path.join(repoRoot, 'packs'), packId);
  assert.equal(packStage(packDir).stage, 'compiled');
  assert.equal(pack.graph.nodes.length, 28);
  assert.equal(pack.graph.edges.length, 28);
  const check = checkPack(pack, loadSite(local.sitesDir, local.name));
  assert.equal(check.fit, true, check.errors.join('\n'));
  installPackMethod({ from: packDir, to: path.join(h.home, 'hima/packs', packId) });
  const host = await bootInProcess(h);
  try {
    const throughHost = await himaCommand(host, h.workspace, `/hima pack check ${packId} --site local`);
    assert.equal(throughHost.kind, 'success', throughHost.text);
    assert.match(throughHost.text, /xtop-timing-closure@1\.0\.10.*fit/s);
  } finally { await host.dispose(); }

  const tests = spawnSync('python3', ['-m', 'unittest', 'discover', '-s', path.join(packDir, 'flow/tests'), '-v'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(tests.status, 0, `${tests.stdout}\n${tests.stderr}`);
});

test('a real Host reads XTop physical evidence through its Pack observation node', async t => {
  const h = await createHimaHome(); t.after(() => h.dispose());
  const variant = path.join(h.home, 'xtop-observe-variant', packId);
  await mkdir(path.dirname(variant), { recursive: true });
  await cp(path.join(repoRoot, 'packs', packId), variant, { recursive: true });
  const originalGraph=await readFile(path.join(variant,'graph.yml'),'utf8');
  await writeFile(path.join(variant, 'graph.yml'),originalGraph
    .replace(/^entry: prepare$/m,'entry: host-read-physical')
    .replace(/^nodes:$/m,'nodes:\n  - id: host-read-physical\n    kind: act\n    parameters: { observes: closureState }')
    .replace(/^loops:/m,'  - { from: host-read-physical, to: prepare }\nloops:'));
  installPackMethod({ from: variant, to: path.join(h.home, 'hima/packs', packId) });
  const inputDb=path.join(h.workspace,'input.enc.dat');await mkdir(inputDb);await writeFile(path.join(inputDb,'db.bin'),'fixture database');
  const siteProfile=path.join(h.workspace,'site-profile.json');await writeFile(siteProfile,'{}\n');
  const sourceManifest=path.join(h.workspace,'source-manifest.sha256');await writeFile(sourceManifest,'fixture source\n');
  await writeLocalSite(h,{allowedReadRoots:[h.workspace],allowedWriteRoots:[h.workspace],allowedWrappers:['/usr/bin/python3'],
    bindings:{inputInnovusDatabase:inputDb,siteProfile,sourceManifest,workspaceRoot:h.workspace},
    licences:{Innovus:1,StarRC:1,PrimeTime:1,XTop:1}});
  const host=await bootInProcess(h);let runId:string|undefined;
  try{
    const owner=await createRootAgent(host.ctx,h.workspace);const actor=String(owner.id);
    const started=await host.ctx.hima.startRun({pack:packId,site:'local',goal:{target_setup_wns_ns:0,target_hold_wns_ns:0},ownerSessionId:actor});
    assert.equal(started.kind,'ran',JSON.stringify(started));if(started.kind!=='ran')return;runId=started.run.id;
    const record=host.ctx.hima.ledger.records({runId,type:'workspace'}).find(row=>row.type==='workspace');assert.ok(record);
    const workspace=record.workspace;
    const physicalRoot=path.join(workspace,'flow/iterations/g000/PHYSICAL');await mkdir(physicalRoot,{recursive:true});
    const drc=path.join(physicalRoot,'verify_drc.rpt');await writeFile(drc,'#  Command: verify_drc -limit 1000000 -report /site/drc.rpt\n  Total Violations : 0 Viols.\n');
    const connectivity=path.join(physicalRoot,'verify_connectivity.rpt');await writeFile(connectivity,'#  Command: verifyConnectivity -noAntenna -error 1000000 -report /site/conn.rpt\nBegin Summary\n    0 Problem(s) (IMPVFC-200): Special Wires.\n    0 total info(s) created.\nEnd Summary\n');
    const manifest=path.join(physicalRoot,'physical-check.json');await writeFile(manifest,JSON.stringify({schema:'xtop-timing-closure-physical-check/2',coverage:'complete',drcLimit:1000000,connectivityLimit:1000000,drcReport:'verify_drc.rpt',connectivityReport:'verify_connectivity.rpt'}));
    const measurement=path.join(workspace,'flow/iterations/g000/measurement.txt');await writeFile(measurement,'retained measurement\n');
    const retainedProfile=path.join(workspace,'flow/site-profile.json');await writeFile(retainedProfile,'{}\n');
    const retainedManifest=path.join(workspace,'flow/source-manifest.sha256');await writeFile(retainedManifest,'fixture source\n');
    const fileRef=async(file:string,role:string)=>{const raw=await readFile(file);return {role,path:path.relative(workspace,file),sha256:createHash('sha256').update(raw).digest('hex'),bytes:raw.length};};
    const state={schema:'xtop-timing-closure-state/1',iteration:0,
      reportFiles:[await fileRef(measurement,'sta-report')],
      physical:{schema:'xtop-timing-closure-physical-check/2',coverage:'complete',drcLimit:1000000,connectivityLimit:1000000,
        drc:{count:0,report:await fileRef(drc,'physical-drc')},connectivity:{count:0,report:await fileRef(connectivity,'physical-connectivity')},
        manifest:await fileRef(manifest,'physical-check-manifest')},
      measurement:{scenariosSha256:'a'.repeat(64),profile:await fileRef(retainedProfile,'site-profile'),sourceManifest:await fileRef(retainedManifest,'source-manifest'),spef:{worst:await fileRef(measurement,'spef')}},
      metrics:{setup_wns_ns:0,setup_tns_ns:0,setup_violations:0,hold_wns_ns:0,hold_tns_ns:0,hold_violations:0,unconstrained_endpoints:0,closure_score:0},endpointSlackNs:{}};
    const current=path.join(workspace,'flow/state/current.json');await mkdir(path.dirname(current),{recursive:true});await writeFile(current,JSON.stringify(state));
    let serial=0;
    const act=(action:'begin'|'work'|'complete',executionId?:string)=>{const control=host.ctx.hima.ledger.run(runId!)!.control!;return host.ctx.hima.executionAction({runId:runId!,actor,action,requestId:`xtop-reader-${++serial}`,expectedEpoch:control.epoch,expectedRevision:control.revision,...(action==='begin'?{nodeId:'host-read-physical'}:{executionId})});};
    const begun=await act('begin');assert.equal(begun.kind,'accepted',begun.reason);const executionId=begun.receipt?.executionId;assert.ok(executionId);
    const work=await act('work',executionId);assert.equal(work.kind,'accepted',work.reason);
    try { await waitUntil('XTop state reader completes',()=>host.ctx.hima.executionContext(runId!).executions.some(item=>item.id===executionId&&item.phase==='ready'),5000,20); }
    catch(error){
      const control=host.ctx.hima.ledger.run(runId)!.control!;
      const log=await host.ctx.hima.executionAction({runId,actor,action:'read',executionId,output:'@job-log',requestId:'xtop-reader-failed-log',expectedEpoch:control.epoch,expectedRevision:control.revision});
      t.diagnostic(JSON.stringify({execution:host.ctx.hima.executionContext(runId).executions.find(item=>item.id===executionId)?.result,log:log.data}));throw error;
    }
    const reading=host.ctx.hima.ledger.records({runId,type:'observation'}).find(row=>row.type==='observation');assert.ok(reading);
    assert.equal(reading.reader.id,'xtop-closure-state');
    assert.ok(reading.values.some(value=>value.type==='xtop_setup_wns'&&value.value===0));
  }finally{if(runId)await host.ctx.hima.cancelRun(runId);await host.dispose();}
});

test('XTop recommendation cannot claim completion while any required verdict fails or is undetermined', () => {
  const pack = loadPack(path.join(repoRoot, 'packs'), packId);
  const chooser = resolveChooser(pack, 'xtop-next-iteration', 'the reading').chooser;
  const base = { runId: 'run-xtop', siteId: 'site-local', seq: 1, at: '2026-09-23T00:00:00.000Z', generation: 1 } as const;
  const observation: ObservationRecord = {
    ...base, id: 'observation-xtop', writer: 'executor', type: 'observation', path: '/work/iteration.json',
    contentSha256: 'a'.repeat(64), bytes: 1, reader: {
      id: 'xtop-iteration-result', version: '1', reportKind: 'xtop-timing-closure-iteration/1',
      emits: ['xtop_closure_score', 'xtop_endpoint_remaining_count'], file: 'tools/read-output.py', sha256: 'b'.repeat(64),
    }, values: [
      { type: 'xtop_closure_score', unit: 'score', value: 1 },
      { type: 'xtop_endpoint_remaining_count', unit: 'count', value: 1 },
    ],
  };
  const verdict = (outcome: VerdictRecord['outcome'], ruleId: string, reason?: string): VerdictRecord => ({
    ...base, id: `verdict-${ruleId}`, writer: 'judge', type: 'verdict', outcome, ruleId, ruleVersion: '1',
    cites: [observation.id], valuesAsRead: [], ...(reason === undefined ? {} : { reason }),
  });
  const input = {
    bound: { revisionStep: 1 }, knobs: pack.contract.strategy, strategy: { strategyRevision: 0 },
    observation,
    constraint: verdict('PASS', 'xtop-iteration-evidence-valid'),
    goal: verdict('PASS', 'xtop-setup-clean'),
  };
  assert.deepEqual(choose(chooser, { ...input, verdicts: [...[input.constraint, input.goal], verdict('PASS', 'xtop-hold-clean')] }),
    { ok: true, chosen: { goalMet: true }, rationale: { score: 1, iteration: 1, revisionStep: 1 } });
  for (const outcome of ['FAIL', 'UNDETERMINED'] as const) {
    const result = choose(chooser, { ...input, verdicts: [...[input.constraint, input.goal], verdict(outcome, 'xtop-hold-clean', 'held evidence')] });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /xtop-hold-clean is/);
  }
  assert.deepEqual(choose(chooser, input), { ok: true, chosen: { goalMet: true }, rationale: { score: 1, iteration: 1, revisionStep: 1 } },
    'two-rule callers retain their existing chooser behavior');
});
