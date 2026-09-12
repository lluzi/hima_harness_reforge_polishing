// L2 prerequisite for the one native desktop route: real Agent loop and real tools, scripted model output.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localHome, waitUntil, killSessions, sessionsOf } from './support/fabric.ts';
import { bootInProcess, createRootAgent, sayAsUser, toolCalls, toolResults, saidByModel } from './support/boot-inprocess.ts';
import { writeExecutionReplay, replayJobStarted, replayPaused, replayCompleted } from './support/agent-execution-replay.ts';
import { timingProbePackId } from './support/pack.ts';

process.env.HIMA_TEST_LEGACY_AUTO_DRIVE = '0';
process.env.HIMA_TEST_SILENT_AGENT = '1';

test('replay uses real conversational tool results for dynamic execution identities and normal user steering', async (t) => {
  const local = await localHome(t, { sleepSeconds: 6 });
  assert.ok(local);
  await writeExecutionReplay(local.h);
  const host = await bootInProcess(local.h);
  let runId: string | undefined;
  try {
    const owner = await createRootAgent(host.ctx, local.h.workspace);
    const prepared = await host.ctx.hima.startRun({ pack: timingProbePackId, site: 'local', goal: { target_period_ns: 2.0 }, ownerSessionId: String(owner.id) });
    assert.equal(prepared.kind, 'ran');
    if (prepared.kind !== 'ran') return;
    runId = prepared.run.id;
    await sayAsUser(owner, `Start the prepared Hima Run ${runId}; perform only its first node.`);
    assert.ok(saidByModel(owner).includes(replayJobStarted), JSON.stringify(toolResults(owner)));
    const get = () => host.ctx.hima.executionContext(runId!);
    assert.equal(get().executions.length, 1);
    assert.equal(get().executions[0]?.phase, 'working');
    const jobs = () => host.ctx.hima.ledger.records({ runId: runId!, type: 'job' });
    assert.equal(jobs().filter((record) => record.type === 'job' && record.event === 'launched').length, 1);
    await sayAsUser(owner, 'Pause synthesize now and inspect the current facts. Keep this conversation responsive.');
    assert.ok(saidByModel(owner).includes(replayPaused), JSON.stringify(toolResults(owner)));
    assert.deepEqual(get().run.control?.paused, ['synthesize']);
    assert.equal(get().executions[0]?.phase, 'working', 'the normal typed steer was handled before the long Job ended');
    await waitUntil('only the admitted Job finishes while pause remains', () => get().executions[0]?.phase === 'ready');
    const control = get().run.control!;
    const human = await host.ctx.hima.executionAction({ runId, actor: String(owner.id), origin: 'human', expectedEpoch: control.epoch, expectedRevision: control.revision, requestId: 'native-continue', action: 'continue', nodeId: 'synthesize' });
    assert.equal(human.kind, 'accepted');
    await sayAsUser(owner, `I requested continue for Hima Run ${runId}. Complete only the admitted node from its actual result.`);
    assert.ok(saidByModel(owner).includes(replayCompleted), JSON.stringify(toolResults(owner)));
    assert.equal(get().executions[0]?.phase, 'completed');
    assert.equal(get().run.currentNode, 'read-qor');
    assert.equal(jobs().filter((record) => record.type === 'job' && record.event === 'launched').length, 1);
    assert.ok(toolResults(owner).every((result) => !result.failed && !result.text.includes('"kind":"refused"')), JSON.stringify(toolResults(owner)));
    assert.deepEqual(toolCalls(owner).map((call) => call.name), ['hima_context', 'hima_execute', 'hima_execute', 'hima_context', 'hima_execute', 'hima_context', 'hima_execute']);
  } finally {
    if (runId) killSessions(sessionsOf(host, runId));
    await host.dispose(); await local.h.dispose();
  }
});
