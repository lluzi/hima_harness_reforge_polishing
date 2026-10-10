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
    assert.match(messageText(owner.inbox.nextTurn[0]!), /^HimaHarness: [^\n]+ finished\.\n\n/,
      'the chat reader sees one plain line first; the owner detail follows a blank line');

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
    assert.match(messageText(owner.inbox.nextTurn[1]!), /^HimaHarness: Paused [^\n]+\.\n\n/);

    owner.cancel({ kind: 'hook', reason: 'notification coalescing test complete' });
    await maintenance;
    maintenance = undefined;
  } finally {
    if (runId !== undefined) await host.ctx.hima.cancelRun(runId);
    await host.dispose(); await home.h.dispose();
  }
});

test('a human clearing a blocked node queues a wake-up turn for the idle owner without any person message', async (t) => {
  const home = await localHome(t, { sleepSeconds: 0.01, failures: 9 });
  assert.ok(home);
  const host = await bootInProcess(home.h);
  let runId: string | undefined;
  let maintenance: Promise<void> | undefined;
  try {
    const owner = await createRootAgent(host.ctx, home.h.workspace);
    // Holds the owner in its idle phase so the queued turn stays observable instead of calling a model.
    maintenance = owner.runMaintenance((signal) => new Promise<void>((resolve) => {
      signal.addEventListener('abort', () => resolve(), { once: true });
    }));
    const started = await host.ctx.hima.startRun({ pack: timingProbePackId, site: 'local', goal: { target_period_ns: 2 },
      ownerSessionId: String(owner.id), retryAllowance: 1 });
    assert.equal(started.kind, 'ran');
    if (started.kind !== 'ran') return;
    runId = started.run.id;
    const nodeId = started.run.currentNode!;
    let request = 0;
    const act = (action: 'begin' | 'work' | 'continue', fields: { executionId?: string; nodeId?: string; origin?: 'human' | 'agent' } = {}) => {
      const control = host.ctx.hima.ledger.run(runId!)!.control!;
      return host.ctx.hima.executionAction({ runId: runId!, actor: String(owner.id), expectedEpoch: control.epoch,
        expectedRevision: control.revision, requestId: `clear-${++request}`, action, ...fields });
    };
    const begun = await act('begin', { nodeId });
    const executionId = begun.receipt?.executionId;
    assert.ok(executionId);
    assert.equal((await act('work', { executionId })).kind, 'accepted');
    await waitUntil('the node is blocked for a person', () =>
      host.ctx.hima.ledger.run(runId!)!.control!.paused.includes(nodeId));
    owner.inbox.clear();

    const cleared = await act('continue', { nodeId, origin: 'human' });
    assert.equal(cleared.kind, 'accepted', cleared.reason);
    assert.deepEqual(cleared.context.run.control?.paused, []);
    assert.equal(cleared.notification?.status, 'queued', 'the person is told the owner was notified');
    assert.equal(owner.inbox.nextTurn.length, 1, 'the clearance is an ordinary follow-up turn that wakes an idle owner');
    assert.match(messageText(owner.inbox.nextTurn[0]!), new RegExp(`user continued node ${nodeId}`));
    assert.match(messageText(owner.inbox.nextTurn[0]!), /^HimaHarness: Continued [^\n]+\.\n\n/);
    assert.equal(owner.status, 'idle', 'nothing but the queued notification is needed to start the owner');

    owner.cancel({ kind: 'hook', reason: 'clearance notification test complete' });
    await maintenance;
    maintenance = undefined;
  } finally {
    if (runId !== undefined) await host.ctx.hima.cancelRun(runId);
    await host.dispose(); await home.h.dispose();
  }
});

test('segment status lines name the step with its read values, stay quiet for deferred tools and passing judges', async () => {
  const { segmentStatusLine } = await import(new URL('../../packages/harness/lib/fabric.js', import.meta.url).href);
  const observation = { id: 'o1', type: 'observation', seq: 7, runId: 'r', values: [
    { type: 'design_fmax_mhz', value: 957.674, unit: 'mhz' }, { type: 'design_wns_ns', value: -0.0441, unit: 'ns' },
    { type: 'route_drc_errors', value: 0, unit: 'count' },
  ] };
  const deps = { ledger: { run: () => ({ generation: 2 }), records: () => [observation] } };
  const act = (id: string, label: string, parameters: Record<string, unknown>) => ({ id, kind: 'act', label, parameters });
  const pack = {
    contract: { words: { route_drc_errors: { label: 'route DRC errors' } }, results: { columns: [], rows: [
      { type: 'design_fmax_mhz', label: 'Fmax', unit: 'MHz', digits: 2 }, { type: 'design_wns_ns', label: 'Worst slack', unit: 'ns', digits: 3 },
    ] } },
    graph: { nodes: [
      act('reference-build', 'Reference build', { tool: 'build' }), act('read-reference', 'Read the reference build', { observes: 'referenceBuild' }),
      { id: 'check', kind: 'judge', label: 'Reference build is clean', parameters: { rules: ['valid'] } },
      act('screen-cells', 'Qualib cell screen', { tool: 'screen' }),
    ], edges: [{ from: 'reference-build', to: 'read-reference' }, { from: 'read-reference', to: 'check' }, { from: 'check', to: 'screen-cells', outcome: 'PASS' }] },
  };
  const line = (nodeId: string, result: Record<string, unknown>) =>
    segmentStatusLine(deps, 'r', pack, { id: `e-${nodeId}`, nodeId, inputThroughSeq: 3 }, result);
  assert.equal(line('read-reference', { kind: 'settled' }),
    'HimaHarness: Reference build finished (round 2) — Fmax 957.67 MHz, Worst slack -0.044 ns, route DRC errors 0.');
  assert.equal(line('reference-build', { kind: 'settled' }), undefined, 'the Reader step after it reports for the tool step');
  assert.equal(line('check', { kind: 'settled', outcome: 'PASS' }), undefined, 'a passing judge is quiet');
  assert.equal(line('check', { kind: 'settled', outcome: 'FAIL' }), 'HimaHarness: Reference build is clean: check failed (round 2).');
  assert.equal(line('screen-cells', { kind: 'settled' }), 'HimaHarness: Qualib cell screen finished (round 2).');
  assert.equal(line('screen-cells', { kind: 'blocked' }), 'HimaHarness: Qualib cell screen failed (round 2).');
});

test('running status lines reach the owner once each, coalesce while unclaimed, and ask for no reply', async (t) => {
  const home = await localHome(t, { sleepSeconds: 0.01 });
  assert.ok(home);
  const host = await bootInProcess(home.h);
  let maintenance: Promise<void> | undefined;
  try {
    const owner = await createRootAgent(host.ctx, home.h.workspace);
    maintenance = owner.runMaintenance((signal) => new Promise<void>((resolve) => {
      signal.addEventListener('abort', () => resolve(), { once: true });
    }));
    const started = await host.ctx.hima.startRun({ pack: timingProbePackId, site: 'local', goal: { target_period_ns: 2 }, ownerSessionId: String(owner.id) });
    assert.equal(started.kind, 'ran');
    if (started.kind !== 'ran') return;
    owner.inbox.clear();
    const status = (host.ctx.hima as any).deps().status as (owner: string, runId: string, key: string, line: string) => void;
    status(String(owner.id), started.run.id, 'node:a', 'HimaHarness: Reference build finished — Fmax 957.67 MHz.');
    status(String(owner.id), started.run.id, 'node:a', 'HimaHarness: Reference build finished — Fmax 957.67 MHz.');
    status(String(owner.id), started.run.id, 'node:b', 'HimaHarness: Reference build finished — Fmax 957.67 MHz.');
    status(String(owner.id), started.run.id, 'node:c', 'HimaHarness: Qualib cell screen finished.');
    assert.equal(owner.inbox.nextTurn.length, 1, 'unclaimed status lines share one pending turn');
    const message = owner.inbox.nextTurn[0]!;
    const text = messageText(message);
    assert.equal(text.match(/Reference build finished/g)?.length, 1, 'never the same line twice');
    assert.match(text, /^HimaHarness: Reference build finished — Fmax 957\.67 MHz\.\nHimaHarness: Qualib cell screen finished\.\n\n/);
    assert.match(text, /no reply is needed/);
    assert.deepEqual(message.source, { kind: 'plugin', plugin: 'hima', form: 'notice', summary: 'HimaHarness: Qualib cell screen finished.' });
    await host.ctx.hima.cancelRun(started.run.id);
    owner.cancel({ kind: 'hook', reason: 'status line test complete' });
    await maintenance;
    maintenance = undefined;
  } finally {
    if (maintenance !== undefined) await maintenance;
    await host.dispose(); await home.h.dispose();
  }
});
