import test from 'node:test';
import assert from 'node:assert/strict';
import { localHome, waitUntil } from './support/fabric.ts';
import { bootInProcess, createRootAgent } from './support/boot-inprocess.ts';
import { timingProbePackId } from './support/pack.ts';

process.env.HIMA_TEST_LEGACY_AUTO_DRIVE = '0';
process.env.HIMA_TEST_SILENT_AGENT = '0';

const messageText = (message: { readonly content: readonly { readonly type: string; readonly text?: string }[] }): string =>
  message.content.filter((block) => block.type === 'text').map((block) => block.text ?? '').join('\n');

test('execution facts coalesce to one queued wake-up while human controls stay immediate', async (t) => {
  const home = await localHome(t, { sleepSeconds: 0.01 });
  assert.ok(home);
  const host = await bootInProcess(home.h);
  let runId: string | undefined;
  let maintenance: Promise<void> | undefined;
  try {
    const owner = await createRootAgent(host.ctx, home.h.workspace);
    maintenance = owner.runMaintenance((signal) => new Promise<void>((resolve) => {
      signal.addEventListener('abort', () => resolve(), { once: true });
    }));
    const started = await host.ctx.hima.startRun({
      pack: timingProbePackId, site: 'local', goal: { target_period_ns: 2 },
      ownerSessionId: String(owner.id), notifyOwnerOnOpen: true,
    });
    assert.equal(started.kind, 'ran');
    if (started.kind !== 'ran') return;
    runId = started.run.id;
    assert.equal(owner.inbox.nextTurn.length, 1, 'Campaign start remains an immediate control notification');
    owner.inbox.clear();

    let request = 0;
    const act = (action: 'begin' | 'work' | 'complete', executionId?: string, nodeId?: string) => {
      const control = host.ctx.hima.ledger.run(runId!)!.control!;
      return host.ctx.hima.executionAction({
        runId: runId!, actor: String(owner.id), expectedEpoch: control.epoch,
        expectedRevision: control.revision, requestId: `queue-${++request}`,
        action, executionId, nodeId,
      });
    };
    const first = await act('begin', undefined, started.run.currentNode);
    const firstId = first.receipt?.executionId;
    assert.ok(firstId);
    assert.equal((await act('work', firstId)).kind, 'accepted');
    await waitUntil('the first execution facts are ready', () =>
      host.ctx.hima.executionContext(runId!).executions.some((execution) =>
        execution.id === firstId && execution.phase === 'ready'));
    assert.equal(owner.inbox.nextTurn.length, 1);
    assert.equal((await act('complete', firstId)).kind, 'accepted');

    const secondNode = host.ctx.hima.ledger.run(runId)!.currentNode;
    const second = await act('begin', undefined, secondNode);
    const secondId = second.receipt?.executionId;
    assert.ok(secondId);
    assert.equal((await act('work', secondId)).kind, 'accepted');
    await waitUntil('the second execution facts are ready', () =>
      host.ctx.hima.executionContext(runId!).executions.some((execution) =>
        execution.id === secondId && execution.phase === 'ready'));
    assert.equal(owner.inbox.nextTurn.length, 1,
      'many execution completions replace one pending progress wake-up instead of growing the queue');
    assert.match(messageText(owner.inbox.nextTurn[0]!), new RegExp(secondId),
      'the one pending wake-up points at the latest execution while hima_context retains every fact');

    const control = host.ctx.hima.ledger.run(runId)!.control!;
    const paused = await host.ctx.hima.executionAction({
      runId, actor: String(owner.id), expectedEpoch: control.epoch,
      expectedRevision: control.revision, requestId: 'human-pause', action: 'pause',
      nodeId: secondNode, origin: 'human',
    });
    assert.equal(paused.kind, 'accepted');
    assert.equal(owner.inbox.nextTurn.length, 2,
      'a human control message is never hidden behind the coalesced progress notification');
    assert.match(messageText(owner.inbox.nextTurn[1]!), /user paused/);

    owner.cancel({ kind: 'hook', reason: 'notification coalescing test complete' });
    await maintenance;
    maintenance = undefined;
  } finally {
    if (runId !== undefined) await host.ctx.hima.cancelRun(runId);
    await host.dispose(); await home.h.dispose();
  }
});
