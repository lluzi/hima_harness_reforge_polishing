import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rename } from 'node:fs/promises';
import path from 'node:path';
import { localHome, waitUntil, sessionsOf } from './support/fabric.ts';
import { bootInProcess, createRootAgent, resumeTestAgent } from './support/boot-inprocess.ts';
import { timingProbePackId } from './support/pack.ts';

process.env.HIMA_TEST_LEGACY_AUTO_DRIVE = '0';
process.env.HIMA_TEST_SILENT_AGENT = '1';

test('App exit drains the original Job, fences new work, and reopens without cancelling the Campaign or clearing human hold', async t => {
  const home = await localHome(t, { sleepSeconds: 0.4 }); assert.ok(home);
  let host = await bootInProcess(home.h);
  let runId: string | undefined; let resumed: Awaited<ReturnType<typeof resumeTestAgent>> | undefined;
  try {
    const owner = await createRootAgent(host.ctx, home.h.workspace); const actor = String(owner.id);
    const started = await host.ctx.hima.startRun({ pack: timingProbePackId, site: 'local', goal: { target_period_ns: 2 }, ownerSessionId: actor });
    assert.equal(started.kind, 'ran'); if (started.kind !== 'ran') return; runId=started.run.id;
    let serial=0;
    const act = (action: 'begin'|'work'|'complete'|'pause', nodeId?: string, executionId?: string, origin: 'agent'|'human'='agent') => {
      const control=host.ctx.hima.executionContext(runId!).run.control!;
      return host.ctx.hima.executionAction({ runId:runId!,actor,action,nodeId,executionId,origin,
        expectedEpoch:control.epoch,expectedRevision:control.revision,requestId:`lifecycle-${++serial}` });
    };
    const begun=await act('begin',started.run.currentNode); assert.equal(begun.kind,'accepted');
    assert.equal((await act('work',undefined,begun.receipt!.executionId)).kind,'accepted');
    assert.equal((await act('pause',started.run.currentNode,undefined,'human')).kind,'accepted');
    const pending=await host.ctx.hima.prepareExit({mode:'drain',requestId:'exit-fixture'});
    assert.equal(pending.ready,false);
    const denied=await act('begin','read-qor'); assert.equal(denied.kind,'refused'); assert.match(denied.reason!,/exit|closing/i);
    await assert.rejects(host.ctx.hima.startRun({pack:timingProbePackId,site:'local',goal:{target_period_ns:2},ownerSessionId:actor}),/exit|closing/i);
    await waitUntil('the same Job reaches its durable exit boundary',()=>host.ctx.hima.exitStatus().ready);
    const settled=host.ctx.hima.exitStatus(); assert.equal(settled.runs[0]?.runId,runId);
    assert.equal(sessionsOf(host,runId).length,1);
    assert.notEqual(host.ctx.hima.ledger.run(runId)?.status,'cancelled');
    await host.dispose(); host=await bootInProcess(home.h); await host.ctx.hima.reconciled;
    resumed=await resumeTestAgent(host.ctx,actor);
    assert.deepEqual(host.ctx.hima.executionContext(runId).run.control?.paused,[started.run.currentNode]);
    assert.equal(sessionsOf(host,runId).length,1);
    assert.notEqual(host.ctx.hima.ledger.run(runId)?.status,'cancelled');
  } finally { if(runId)await host.ctx.hima.cancelRun(runId); await resumed?.dispose();await host.dispose();await home.h.dispose(); }
});

test('a failed Stop jobs request releases only its App exit fence and leaves original Job facts inspectable', async t => {
  const home=await localHome(t,{sleepSeconds:60});assert.ok(home);
  const host=await bootInProcess(home.h);let original:string|undefined, successor:string|undefined;
  const site=path.join(home.h.home,'hima/sites/local.yml');const held=`${site}.temporarily-unavailable`;
  let moved=false;
  try {
    const owner=await createRootAgent(host.ctx,home.h.workspace);const actor=String(owner.id);
    const first=await host.ctx.hima.startRun({pack:timingProbePackId,site:'local',goal:{target_period_ns:2},ownerSessionId:actor});
    assert.equal(first.kind,'ran');if(first.kind!=='ran')return;original=first.run.id;
    const control=()=>host.ctx.hima.executionContext(original!).run.control!;
    const begun=await host.ctx.hima.executionAction({runId:original,actor,action:'begin',nodeId:first.run.currentNode,requestId:'exit-failure-begin',expectedEpoch:control().epoch,expectedRevision:control().revision});
    assert.equal(begun.kind,'accepted');
    assert.equal((await host.ctx.hima.executionAction({runId:original,actor,action:'work',executionId:begun.receipt!.executionId,requestId:'exit-failure-work',expectedEpoch:control().epoch,expectedRevision:control().revision})).kind,'accepted');
    assert.equal(sessionsOf(host,original).length,1);
    await rename(site,held);moved=true;
    await assert.rejects(host.ctx.hima.prepareExit({mode:'stop-jobs',requestId:'exit-failed-kill'}));
    assert.equal(host.ctx.hima.exitStatus().requestId,undefined,'failed exit does not leave an in-memory closing request');
    const receipt=control().requests['exit:exit-failed-kill'];
    assert.ok(receipt&&receipt.receipt.action==='host-exit'&&(receipt.receipt.data as {releasedAt?:string})?.releasedAt,'the original control journal records release; human holds are independent');
    assert.equal(sessionsOf(host,original).length,1,'the Job identity was not deleted to make exit appear clean');
    await rename(held,site);moved=false;
    const again=await host.ctx.hima.startRun({pack:timingProbePackId,site:'local',goal:{target_period_ns:2},ownerSessionId:actor});
    assert.equal(again.kind,'ran','original admission was restored');if(again.kind==='ran')successor=again.run.id;
  }finally{
    if(moved)await rename(held,site);
    if(original)await host.ctx.hima.cancelRun(original);
    if(successor)await host.ctx.hima.cancelRun(successor);
    await host.dispose();await home.h.dispose();
  }
});
