// Issue #64 live Campaign defects D1/D2: a Workshop that exits 0 without writing its declared output,
// and the recovery that must start new work again at the upstream Workshop. Real Host, local Jobs,
// a small generic fixture Pack; no model and no Electron.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, rm, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { localHome, waitUntil } from './support/fabric.ts';
import { bootInProcess, createRootAgent } from './support/boot-inprocess.ts';
import { repoRoot } from './support/dsh-home.ts';
import { recordValidityOf, currentRecordsIn, type ExecutionActionRequest } from '@hima/harness';
import type { LocalHome } from './support/fabric.ts';

process.env.HIMA_TEST_SILENT_AGENT = '1';
process.env.HIMA_TEST_LEGACY_AUTO_DRIVE = '0';

const writes = 'set -eu\nmkdir -p "$2/research/analysis"\nawk -v scale="$3" \'{sum+=$1} END {print sum*scale}\' "$2/flow/numbers.txt" > "$2/research/analysis/result.txt"\n';
const probeOnly = 'set -eu\n# explores the inputs and prints a summary; writes nothing\nwc -l "$2/flow/numbers.txt"\n';

/** The generic Workshop fixture Pack: analyze (Workshop) -> read-analysis (Reader) -> judge. */
async function workshopPack(home: LocalHome): Promise<void> {
  const packDir = path.join(home.h.home, 'hima/packs/authored-workshop');
  await mkdir(packDir, { recursive: true });
  for (const file of ['contract.yml', 'graph.yml', 'semantics.yml', 'readers', 'rules', 'tools', 'knowledge']) {
    await cp(path.join(repoRoot, 'test/fixtures/pipeline/workshop', file), path.join(packDir, file), { recursive: true });
  }
  await writeFile(path.join(packDir, 'PACK.md'), '# Workshop recovery fixture\n');
  await writeFile(path.join(home.flow.root, 'numbers.txt'), '3\n7\n11\n');
}

test('a Workshop Job that exits 0 without writing its declared output is a failed attempt the owner can retry', async (t) => {
  const home = await localHome(t, { sleepSeconds: 0 });
  assert.ok(home);
  await workshopPack(home);
  const host = await bootInProcess(home.h);
  let runId: string | undefined;
  try {
    const owner = await createRootAgent(host.ctx, home.h.workspace);
    const started = await host.ctx.hima.startRun({ pack: 'authored-workshop', site: 'local', goal: { target_period_ns: 2 },
      ownerSessionId: String(owner.id) });
    assert.equal(started.kind, 'ran');
    if (started.kind !== 'ran') return;
    runId = started.run.id;
    let serial = 0;
    const act = (action: ExecutionActionRequest['action'], fields: Partial<ExecutionActionRequest> = {}) => {
      const control = host.ctx.hima.ledger.run(runId!)!.control!;
      return host.ctx.hima.executionAction({ runId: runId!, actor: String(owner.id), expectedEpoch: control.epoch,
        expectedRevision: control.revision, requestId: `missing-output-${++serial}`, action, ...fields });
    };
    const begun = await act('begin', { nodeId: 'analyze' });
    const executionId = begun.receipt?.executionId; assert.ok(executionId, begun.reason);
    assert.equal((await act('recommend', { executionId })).kind, 'accepted');
    assert.equal((await act('write', { executionId, path: 'entry.sh', content: probeOnly })).kind, 'accepted');
    assert.equal((await act('work', { executionId })).kind, 'accepted');
    await waitUntil('the exit-0 Workshop execution settles', () => {
      const phase = host.ctx.hima.executionContext(runId!).executions.find((item) => item.id === executionId)?.phase;
      return phase === 'failed' || phase === 'ready';
    }, 10_000, 25);
    const after = host.ctx.hima.executionContext(runId);
    const settled = after.executions.find((item) => item.id === executionId)!;
    assert.equal(settled.phase, 'failed', 'exit 0 with the declared output missing is not a completed Workshop');
    assert.equal(settled.result?.kind, 'retrying');
    const node = host.ctx.hima.ledger.records({ runId, type: 'node' }).findLast((record) => record.type === 'node' && record.nodeId === 'analyze');
    assert.ok(node?.type === 'node');
    assert.equal(node.state, 'retrying');
    assert.match(node.reason ?? '', /Workshop output research\/analysis\/result\.txt was not written/);
    assert.equal(host.ctx.hima.ledger.records({ runId, type: 'node' }).some((record) => record.type === 'node' && record.nodeId === 'analyze' && record.state === 'done'), false);
    assert.equal(host.ctx.hima.ledger.records({ runId, type: 'blocker' }).length, 0, 'no person is needed to open the next attempt');
    assert.deepEqual(after.run.control?.paused, []);
    assert.equal((await act('complete', { executionId })).kind, 'refused', 'a missing output can never be completed');
    assert.ok(after.available.includes('analyze'), 'the owner may begin a new attempt at the Workshop');
    const second = await act('begin', { nodeId: 'analyze' });
    const secondId = second.receipt?.executionId; assert.ok(secondId, second.reason);
    assert.equal(second.context.executions.find((item) => item.id === secondId)?.attempt, 2);
    assert.equal((await act('recommend', { executionId: secondId })).kind, 'accepted');
    assert.equal((await act('write', { executionId: secondId, path: 'entry.sh', content: writes })).kind, 'accepted');
    assert.equal((await act('work', { executionId: secondId })).kind, 'accepted');
    await waitUntil('the corrected Workshop is ready', () =>
      host.ctx.hima.executionContext(runId!).executions.find((item) => item.id === secondId)?.phase === 'ready', 10_000, 25);
    assert.equal((await act('complete', { executionId: secondId })).kind, 'accepted');
  } finally {
    if (runId !== undefined) await host.ctx.hima.cancelRun(runId);
    await host.dispose(); await home.h.dispose();
  }
});

test('the owner is told plainly that a Workshop entry is its one result and must write the declared output', async (t) => {
  const home = await localHome(t, { sleepSeconds: 0 });
  assert.ok(home);
  await workshopPack(home);
  const host = await bootInProcess(home.h);
  let runId: string | undefined;
  try {
    const owner = await createRootAgent(host.ctx, home.h.workspace);
    const started = await host.ctx.hima.startRun({ pack: 'authored-workshop', site: 'local', goal: { target_period_ns: 2 },
      ownerSessionId: String(owner.id) });
    assert.equal(started.kind, 'ran');
    if (started.kind !== 'ran') return;
    runId = started.run.id;
    const begun = await host.ctx.hima.executionAction({ runId, actor: String(owner.id), action: 'begin', nodeId: 'analyze',
      requestId: 'prompt-begin', expectedEpoch: 1, expectedRevision: 0 });
    const executionId = begun.receipt?.executionId; assert.ok(executionId);
    const control = host.ctx.hima.ledger.run(runId)!.control!;
    const advice = await host.ctx.hima.executionAction({ runId, actor: String(owner.id), action: 'recommend', executionId,
      requestId: 'prompt-recommend', expectedEpoch: control.epoch, expectedRevision: control.revision });
    assert.equal(advice.kind, 'accepted');
    const instruction = (advice.data as { instruction?: string }).instruction ?? '';
    assert.match(instruction, /single entry execution is this Workshop's result/);
    assert.match(instruction, /must write .*research\/analysis\/result\.txt/);
    assert.match(instruction, /explor.*before writing the entry/i);
    assert.match(instruction, /missing .*failed attempt/i);
  } finally {
    if (runId !== undefined) await host.ctx.hima.cancelRun(runId);
    await host.dispose(); await home.h.dispose();
  }
});

test('continuing an upstream Workshop clears the downstream Reader it supersedes and starts new work there', async (t) => {
  const home = await localHome(t, { sleepSeconds: 0 });
  assert.ok(home);
  await workshopPack(home);
  const host = await bootInProcess(home.h);
  let runId: string | undefined;
  try {
    const owner = await createRootAgent(host.ctx, home.h.workspace);
    const actor = String(owner.id);
    const started = await host.ctx.hima.startRun({ pack: 'authored-workshop', site: 'local', goal: { target_period_ns: 2 },
      ownerSessionId: actor });
    assert.equal(started.kind, 'ran');
    if (started.kind !== 'ran') return;
    runId = started.run.id;
    let serial = 0;
    const act = (action: ExecutionActionRequest['action'], fields: Partial<ExecutionActionRequest> = {}, origin: 'agent' | 'human' = 'agent') => {
      const control = host.ctx.hima.ledger.run(runId!)!.control!;
      return host.ctx.hima.executionAction({ runId: runId!, actor, expectedEpoch: control.epoch, origin,
        expectedRevision: control.revision, requestId: `upstream-${++serial}`, action, ...fields });
    };
    const settle = async (executionId: string, phase: 'ready' | 'failed') => waitUntil(`${executionId} is ${phase}`, () =>
      host.ctx.hima.executionContext(runId!).executions.find((item) => item.id === executionId)?.phase === phase, 10_000, 25);
    const first = await act('begin', { nodeId: 'analyze' });
    const firstId = first.receipt?.executionId; assert.ok(firstId, first.reason);
    assert.equal((await act('recommend', { executionId: firstId })).kind, 'accepted');
    assert.equal((await act('write', { executionId: firstId, path: 'entry.sh', content: writes })).kind, 'accepted');
    assert.equal((await act('work', { executionId: firstId })).kind, 'accepted');
    await settle(firstId, 'ready');
    assert.equal((await act('complete', { executionId: firstId })).kind, 'accepted');
    // The produced file disappears before its Reader runs, as a Workshop that never wrote it would
    // leave it: the Reader cannot resolve its input and blocks, which pauses it.
    const workspace = host.ctx.hima.ledger.records({ runId, type: 'workspace' }).findLast((record) => record.type === 'workspace');
    assert.ok(workspace?.type === 'workspace');
    await rm(path.join(workspace.workspace, 'research/analysis/result.txt'));
    const reading = await act('begin', { nodeId: 'read-analysis' });
    const readingId = reading.receipt?.executionId; assert.ok(readingId, reading.reason);
    assert.equal((await act('work', { executionId: readingId })).kind, 'accepted');
    await settle(readingId, 'failed');
    const blocked = host.ctx.hima.executionContext(runId);
    assert.deepEqual(blocked.run.control?.paused, ['read-analysis']);
    const readerNode = host.ctx.hima.ledger.records({ runId, type: 'node' }).findLast((record) => record.type === 'node' && record.nodeId === 'read-analysis');
    assert.ok(readerNode?.type === 'node');
    assert.match(readerNode.reason ?? '', /node analyze .*must run again before this Reader.*a person must continue analyze/,
      'the blocked Reader names the upstream producer and who can start it again');
    const early = await act('begin', { nodeId: 'analyze' });
    assert.equal(early.kind, 'refused', 'before the continuation the upstream Workshop cannot restart');
    assert.match(early.reason ?? '', /not currently available/);
    // A deliberate person hold downstream is not stuck work and outlives the continuation (I1).
    assert.equal((await act('pause', { nodeId: 'judge' }, 'human')).kind, 'accepted');

    // Superseding a blocked node grants it a new allowance, which only a person may do (I4).
    const agentContinue = await act('continue', { nodeId: 'analyze' }, 'agent');
    assert.equal(agentContinue.kind, 'refused');
    assert.match(agentContinue.reason ?? '', /only a person can start new work again at analyze/);
    assert.equal(host.ctx.hima.ledger.run(runId)!.currentNode, 'read-analysis', 'an Agent continue does not supersede a blocked Reader');
    assert.deepEqual(host.ctx.hima.ledger.run(runId)!.control?.paused, ['read-analysis', 'judge']);

    const firstCode = host.ctx.hima.ledger.records({ runId, type: 'code' }).find((record) => record.type === 'code' && record.nodeId === 'analyze');
    const readerRefusal = host.ctx.hima.ledger.records({ runId, type: 'refusal' }).findLast((record) => record.type === 'refusal');
    assert.ok(firstCode && readerRefusal);
    const continued = await act('continue', { nodeId: 'analyze' }, 'human');
    assert.equal(continued.kind, 'accepted', continued.reason);
    assert.deepEqual(continued.context.run.control?.paused, ['judge'], 'the stuck Reader pause is cleared; the person hold on judge is kept');
    assert.equal(continued.context.run.currentNode, 'analyze', 'new work starts again at the continued node');
    assert.ok(continued.context.available.includes('analyze'));
    assert.deepEqual((continued.receipt?.data as { clearedScopes?: string[] }).clearedScopes?.sort(), ['analyze', 'read-analysis']);
    const supersededReader = continued.context.executions.find((item) => item.id === readingId);
    assert.ok(supersededReader?.supersededBy, 'the blocked Reader execution is superseded by the continuation');
    assert.equal(host.ctx.hima.ledger.records({ runId, type: 'resumed' }).some((record) => record.type === 'resumed' && record.nodeId === 'read-analysis'), true);
    // The superseded results are no longer current evidence (I3).
    const all = host.ctx.hima.ledger.records({ runId });
    assert.equal(recordValidityOf(all, firstCode.id).valid, false, 'the superseded Workshop version is not current');
    assert.equal(recordValidityOf(all, readerRefusal.id).valid, false, 'the superseded Reader facts are not current');
    assert.equal(currentRecordsIn(all).some((record) => record.type === 'node' && record.nodeId === 'analyze' && record.state === 'done'), false);
    assert.equal(continued.context.evidence?.some((item) => item.recordId === firstCode.id), false, 'owner evidence omits superseded records');

    const again = await act('begin', { nodeId: 'analyze' });
    const againId = again.receipt?.executionId; assert.ok(againId, again.reason);
    assert.equal((await act('recommend', { executionId: againId })).kind, 'accepted');
    assert.equal((await act('write', { executionId: againId, path: 'entry.sh', content: writes })).kind, 'accepted');
    assert.equal((await act('work', { executionId: againId })).kind, 'accepted');
    await settle(againId, 'ready');
    assert.equal((await act('complete', { executionId: againId })).kind, 'accepted');
    const reread = await act('begin', { nodeId: 'read-analysis' });
    const rereadId = reread.receipt?.executionId; assert.ok(rereadId, reread.reason);
    assert.equal((await act('work', { executionId: rereadId })).kind, 'accepted');
    await settle(rereadId, 'ready');
    assert.equal((await act('complete', { executionId: rereadId })).kind, 'accepted');
  } finally {
    if (runId !== undefined) await host.ctx.hima.cancelRun(runId);
    await host.dispose(); await home.h.dispose();
  }
});

test('a Workshop output left by earlier work is not the result of this execution', async (t) => {
  const home = await localHome(t, { sleepSeconds: 0 });
  assert.ok(home);
  await workshopPack(home);
  const host = await bootInProcess(home.h);
  let runId: string | undefined;
  try {
    const owner = await createRootAgent(host.ctx, home.h.workspace);
    const started = await host.ctx.hima.startRun({ pack: 'authored-workshop', site: 'local', goal: { target_period_ns: 2 },
      ownerSessionId: String(owner.id) });
    assert.equal(started.kind, 'ran');
    if (started.kind !== 'ran') return;
    runId = started.run.id;
    // One workspace serves every generation: an earlier generation's output is still at the path.
    const stale = path.join(started.workspace, 'research/analysis/result.txt');
    await mkdir(path.dirname(stale), { recursive: true });
    await writeFile(stale, '999\n');
    const past = new Date(Date.now() - 3_600_000);
    await utimes(stale, past, past);
    let serial = 0;
    const act = (action: ExecutionActionRequest['action'], fields: Partial<ExecutionActionRequest> = {}) => {
      const control = host.ctx.hima.ledger.run(runId!)!.control!;
      return host.ctx.hima.executionAction({ runId: runId!, actor: String(owner.id), expectedEpoch: control.epoch,
        expectedRevision: control.revision, requestId: `stale-output-${++serial}`, action, ...fields });
    };
    const begun = await act('begin', { nodeId: 'analyze' });
    const executionId = begun.receipt?.executionId; assert.ok(executionId, begun.reason);
    assert.equal((await act('recommend', { executionId })).kind, 'accepted');
    assert.equal((await act('write', { executionId, path: 'entry.sh', content: probeOnly })).kind, 'accepted');
    assert.equal((await act('work', { executionId })).kind, 'accepted');
    await waitUntil('the exit-0 Workshop execution settles', () => {
      const phase = host.ctx.hima.executionContext(runId!).executions.find((item) => item.id === executionId)?.phase;
      return phase === 'failed' || phase === 'ready';
    }, 10_000, 25);
    const settled = host.ctx.hima.executionContext(runId).executions.find((item) => item.id === executionId)!;
    assert.equal(settled.phase, 'failed', 'an output older than this execution\'s entry was not written by it');
    const node = host.ctx.hima.ledger.records({ runId, type: 'node' }).findLast((record) => record.type === 'node' && record.nodeId === 'analyze');
    assert.ok(node?.type === 'node');
    assert.match(node.reason ?? '', /Workshop output research\/analysis\/result\.txt was not written by this execution/);
    const second = await act('begin', { nodeId: 'analyze' });
    const secondId = second.receipt?.executionId; assert.ok(secondId, second.reason);
    assert.equal((await act('recommend', { executionId: secondId })).kind, 'accepted');
    assert.equal((await act('write', { executionId: secondId, path: 'entry.sh', content: writes })).kind, 'accepted');
    assert.equal((await act('work', { executionId: secondId })).kind, 'accepted');
    await waitUntil('the rewritten output settles the Workshop', () =>
      host.ctx.hima.executionContext(runId!).executions.find((item) => item.id === secondId)?.phase === 'ready', 10_000, 25);
  } finally {
    if (runId !== undefined) await host.ctx.hima.cancelRun(runId);
    await host.dispose(); await home.h.dispose();
  }
});

test('a person pausing and continuing a passed node only lifts that pause; nothing is restarted', async (t) => {
  const home = await localHome(t, { sleepSeconds: 0 });
  assert.ok(home);
  await workshopPack(home);
  const host = await bootInProcess(home.h);
  let runId: string | undefined;
  try {
    const owner = await createRootAgent(host.ctx, home.h.workspace);
    const actor = String(owner.id);
    const started = await host.ctx.hima.startRun({ pack: 'authored-workshop', site: 'local', goal: { target_period_ns: 2 }, ownerSessionId: actor });
    assert.equal(started.kind, 'ran');
    if (started.kind !== 'ran') return;
    runId = started.run.id;
    let serial = 0;
    const act = (action: ExecutionActionRequest['action'], fields: Partial<ExecutionActionRequest> = {}, origin: 'agent' | 'human' = 'agent') => {
      const control = host.ctx.hima.ledger.run(runId!)!.control!;
      return host.ctx.hima.executionAction({ runId: runId!, actor, expectedEpoch: control.epoch, origin,
        expectedRevision: control.revision, requestId: `hold-${++serial}`, action, ...fields });
    };
    const settle = (id: string) => waitUntil(`${id} ready`, () =>
      host.ctx.hima.executionContext(runId!).executions.find((item) => item.id === id)?.phase === 'ready', 10_000, 25);
    const a = await act('begin', { nodeId: 'analyze' }); const aId = a.receipt!.executionId!;
    await act('recommend', { executionId: aId });
    await act('write', { executionId: aId, path: 'entry.sh', content: writes });
    await act('work', { executionId: aId }); await settle(aId);
    assert.equal((await act('complete', { executionId: aId })).kind, 'accepted');
    const r = await act('begin', { nodeId: 'read-analysis' }); const rId = r.receipt!.executionId!;
    await act('work', { executionId: rId }); await settle(rId);
    assert.equal((await act('complete', { executionId: rId })).kind, 'accepted');
    const before = host.ctx.hima.ledger.run(runId)!;
    assert.equal((await act('pause', { nodeId: 'judge' }, 'human')).kind, 'accepted');
    assert.equal((await act('pause', { nodeId: 'analyze' }, 'human')).kind, 'accepted');
    const continued = await act('continue', { nodeId: 'analyze' }, 'human');
    assert.equal(continued.kind, 'accepted', continued.reason);
    const after = host.ctx.hima.ledger.run(runId)!;
    assert.equal(after.currentNode, before.currentNode, 'lifting a pause never moves the Run');
    assert.deepEqual(after.control?.paused, ['judge']);
    assert.equal(Object.values(after.control!.executions).some((execution) => execution.supersededBy !== undefined), false);
    // With no stuck work downstream, a continue of a passed node that was never paused is also just a continue.
    const plain = await act('continue', { nodeId: 'read-analysis' }, 'human');
    assert.equal(plain.kind, 'accepted', plain.reason);
    assert.equal(host.ctx.hima.ledger.run(runId)!.currentNode, before.currentNode);
  } finally {
    if (runId !== undefined) await host.ctx.hima.cancelRun(runId);
    await host.dispose(); await home.h.dispose();
  }
});
