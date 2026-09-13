// PLS-11 L2: real Host, Ledger, local files and local tmux Workshop Job.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { bootInProcess, createRootAgent, type InProcessHost } from './support/boot-inprocess.ts';
import { localHome, sessionsOf, killSessions, waitUntil } from './support/fabric.ts';
import { repoRoot } from './support/dsh-home.ts';
import { currentRecordsIn, retainedRecordMaterial, type ExecutionActionRequest, type LedgerRecord, type RevisionProposal } from '@hima/harness';

process.env.HIMA_TEST_SILENT_AGENT = '1';
process.env.HIMA_TEST_LEGACY_AUTO_DRIVE = '0';

const identity = (value: unknown): string => {
  const stable = (item: unknown): unknown => Array.isArray(item) ? item.map(stable) : item && typeof item === 'object'
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([key, field]) => [key, stable(field)])) : item;
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
};

test('owner revision preserves finished Workshop bytes and seeds the affected rerun without launching it', async (t) => {
  const home = await localHome(t, { sleepSeconds: 0 }); assert.ok(home);
  const packDir = path.join(home.h.home, 'hima/packs/authored-workshop'); await mkdir(packDir, { recursive: true });
  for (const file of ['contract.yml', 'graph.yml', 'semantics.yml', 'readers', 'rules', 'tools', 'knowledge']) {
    await cp(path.join(repoRoot, 'test/fixtures/pipeline/workshop', file), path.join(packDir, file), { recursive: true });
  }
  await writeFile(path.join(packDir, 'PACK.md'), '# PLS-11 revision fixture\n');
  await writeFile(path.join(home.flow.root, 'numbers.txt'), '3\n7\n11\n');
  const host = await bootInProcess(home.h); let restarted: InProcessHost | undefined; let firstDisposed = false; let runId: string | undefined;
  try {
    const owner = await createRootAgent(host.ctx, home.h.workspace);
    const started = await host.ctx.hima.startRun({ pack: 'authored-workshop', site: 'local', goal: { target_period_ns: 2 }, ownerSessionId: String(owner.id) });
    assert.equal(started.kind, 'ran'); if (started.kind !== 'ran') return; runId = started.run.id;
    let n = 0;
    const act = (action: ExecutionActionRequest['action'], fields: Partial<ExecutionActionRequest> = {}) => {
      const control = host.ctx.hima.ledger.run(runId!)!.control!;
      return host.ctx.hima.executionAction({ runId: runId!, actor: String(owner.id), expectedEpoch: control.epoch,
        expectedRevision: control.revision, requestId: `revision-${++n}`, action, ...fields });
    };
    const begun = await act('begin', { nodeId: 'analyze' }); const first = begun.receipt!.executionId!;
    await act('recommend', { executionId: first });
    const original = 'mkdir -p "$2/research/analysis"\nawk -v scale="$3" \'{sum+=$1} END {print sum*scale}\' "$2/flow/numbers.txt" > "$2/research/analysis/result.txt"\n';
    await act('write', { executionId: first, path: 'entry.sh', content: original });
    await act('work', { executionId: first });
    await waitUntil('first Workshop ready', () => host.ctx.hima.executionContext(runId!).executions.some((execution) => execution.id === first && execution.phase === 'ready'));
    assert.equal((await act('complete', { executionId: first })).kind, 'accepted');
    const readBegun = await act('begin', { nodeId: 'read-analysis' }); const firstRead = readBegun.receipt!.executionId!;
    await act('work', { executionId: firstRead });
    await waitUntil('first downstream read ready', () => host.ctx.hima.executionContext(runId!).executions.some((execution) => execution.id === firstRead && execution.phase === 'ready'));
    assert.equal((await act('complete', { executionId: firstRead })).kind, 'accepted');
    const source = host.ctx.hima.ledger.records({ runId, type: 'code' }).findLast((record) => record.type === 'code')!;
    assert.equal(source.type, 'code');
    const beforeLaunches = host.ctx.hima.ledger.records({ runId, type: 'job' }).filter((record) => record.type === 'job' && record.event === 'launched').length;
    const ctx = host.ctx.hima.executionContext(runId); const evidence = host.ctx.hima.ledger.records({ runId }).find((record) => record.type === 'workspace')!;
    const revised = `${original}# accepted revision\n`;
    const proposal: RevisionProposal = { revisionId: 'rev-analyze-v2', method: { id: ctx.method!.id, version: ctx.method!.version, digest: ctx.method!.digest },
      inputThroughSeq: ctx.run.nextSeq - 1, inputs: [{ recordId: evidence.id, contentIdentity: identity(evidence) }],
      reason: 'correct the analysis algorithm while preserving the completed version', changedNodes: ['analyze'], affectedNodes: ['analyze', 'read-analysis', 'judge'],
      changes: [{ nodeId: 'analyze', scope: 'workshop', path: 'entry.sh', fromSha256: source.sha256, content: revised, sourceRecordId: source.id }] };
    const applied = await act('revise', { revision: proposal });
    assert.equal(applied.kind, 'accepted', JSON.stringify(applied));
    const chargedAfterRevision = host.ctx.hima.ledger.records({ runId, type: 'research-write' });
    assert.equal(chargedAfterRevision.length, 2, 'the original writer call and the revision content are charged once each');
    assert.equal(chargedAfterRevision[1]?.type === 'research-write' && chargedAfterRevision[1].scope, 'workshop');
    assert.equal(chargedAfterRevision[1]?.type === 'research-write' && chargedAfterRevision[1].sessionId, String(owner.id));
    assert.equal(host.ctx.hima.ledger.records({ runId, type: 'job' }).filter((record) => record.type === 'job' && record.event === 'launched').length, beforeLaunches);
    assert.equal(await readFile(source.path, 'utf8'), original, 'finished executable bytes are not mutated');
    const retained = retainedRecordMaterial(host.ctx.hima.ledger.records({ runId }), source.id); assert.ok(retained);
    assert.equal(await readFile(retained!.path, 'utf8'), original);
    assert.equal(host.ctx.hima.executionContext(runId).executions.find((execution) => execution.id === first)?.supersededBy, proposal.revisionId);
    assert.equal(host.ctx.hima.executionContext(runId).executions.find((execution) => execution.id === firstRead)?.supersededBy, proposal.revisionId,
      'the affected downstream C execution is preserved but invalidated');
    assert.equal(currentRecordsIn(host.ctx.hima.ledger.records({ runId })).some((record) => record.type === 'observation'), false,
      'the prior downstream observation remains historical and cannot support the revised path');
    const rerun = await act('begin', { nodeId: 'analyze' }); const second = rerun.receipt!.executionId!;
    assert.notEqual(second, first);
    assert.equal((await act('recommend', { executionId: second })).kind, 'accepted');
    assert.equal(host.ctx.hima.ledger.records({ runId, type: 'research-write' }).length, 2,
      'deterministic revision materialization does not charge the logical change a second time');
    const seeded = host.ctx.hima.ledger.records({ runId, type: 'code' }).findLast((record) => record.type === 'code' && record.attempt === 2)!;
    assert.equal(seeded.type, 'code'); assert.equal(await readFile(seeded.path, 'utf8'), revised);
    assert.equal(host.ctx.hima.ledger.records({ runId, type: 'job' }).filter((record) => record.type === 'job' && record.event === 'launched').length, beforeLaunches,
      'recommend/materialization does not launch business work');
    assert.equal((await act('work', { executionId: second })).kind, 'accepted');
    await waitUntil('revised Workshop ready', () => host.ctx.hima.executionContext(runId!).executions.some((execution) => execution.id === second && execution.phase === 'ready'));
    assert.equal((await act('complete', { executionId: second })).kind, 'accepted');
    assert.equal(host.ctx.hima.ledger.records({ runId, type: 'job' }).filter((record) => record.type === 'job' && record.event === 'launched').length, beforeLaunches + 1,
      'only the explicit owner work request launches the revised node');
    const remote = await import(new URL('../../packages/harness/lib/remote.js', import.meta.url).href);
    const view = remote.runView(host.ctx.hima.ledger, host.ctx.hima.ledger.run(runId)!);
    assert.equal(view.observations.length, 1, 'the prior observation remains visible in full history');
    assert.equal(view.generations[0]?.observation, undefined, 'the current generation excludes the invalidated observation until C reruns');
    assert.equal(view.revisions[0]?.revisionId, proposal.revisionId);
    if (evidence.type !== 'workspace') throw new Error('workspace evidence missing');
    const inputPath = path.join(evidence.workspace, 'flow/numbers.txt');
    const inputBefore = await readFile(inputPath); const inputBeforeSha = createHash('sha256').update(inputBefore).digest('hex');
    await writeFile(inputPath, 'same path, different bytes\n');
    const now = host.ctx.hima.executionContext(runId);
    const staleInput: RevisionProposal = { ...proposal, revisionId: 'stale-same-path-input',
      inputThroughSeq: now.run.nextSeq - 1, method: { id: now.method!.id, version: now.method!.version, digest: now.method!.digest },
      inputs: [{ recordId: evidence.id, contentIdentity: identity(evidence) }],
      changes: [{ nodeId: 'analyze', scope: 'workspace', path: 'flow/numbers.txt', fromSha256: inputBeforeSha, content: '3\n7\n13\n' }] };
    const refused = await act('revise', { revision: staleInput });
    assert.equal(refused.kind, 'refused'); assert.match(refused.reason!, /not declared/);
    assert.equal(host.ctx.hima.ledger.records({ runId, type: 'job' }).filter((record) => record.type === 'job' && record.event === 'launched').length, beforeLaunches + 1);
    const strategyContext = host.ctx.hima.executionContext(runId);
    const strategyRevision: RevisionProposal = { ...proposal, revisionId: 'strategy-scale-three', changes: [], strategy: { scale: 3 },
      inputThroughSeq: strategyContext.run.nextSeq - 1,
      method: { id: strategyContext.method!.id, version: strategyContext.method!.version, digest: strategyContext.method!.digest } };
    assert.equal((await act('revise', { revision: strategyRevision })).kind, 'accepted');
    assert.equal(host.ctx.hima.executionContext(runId).run.strategy?.scale, 3);
    assert.equal(host.ctx.hima.ledger.records({ runId, type: 'job' }).filter((record) => record.type === 'job' && record.event === 'launched').length, beforeLaunches + 1,
      'strategy acceptance also launches no node');
    await host.dispose(); firstDisposed = true;
    restarted = await bootInProcess(home.h);
    const recovered = restarted.ctx.hima.executionContext(runId);
    assert.equal(recovered.run.currentNode, 'analyze');
    assert.equal(recovered.revisions.findLast((record) => record.event === 'applied')?.revisionId, strategyRevision.revisionId);
    assert.equal(recovered.executions.find((execution) => execution.id === first)?.supersededBy, proposal.revisionId);
    assert.deepEqual(recovered.available, ['analyze'], 'restart waits for the owner to request work under the accepted strategy');
    assert.equal(restarted.ctx.hima.ledger.records({ runId, type: 'job' }).filter((record) => record.type === 'job' && record.event === 'launched').length, beforeLaunches + 1,
      'restart reconstructs facts and launches no business work');
  } finally {
    const active = restarted ?? host;
    if (runId) { killSessions(sessionsOf(active, runId)); await active.ctx.hima.cancelRun(runId); }
    if (restarted) await restarted.dispose();
    if (!firstDisposed) await host.dispose();
    await home.h.dispose();
  }
});
