// PLS-11 L2: real Host, Ledger, local files and local tmux Workshop Job.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { bootInProcess, createRootAgent, type InProcessHost } from './support/boot-inprocess.ts';
import { localHome, sessionsOf, killSessions, waitUntil } from './support/fabric.ts';
import { repoRoot } from './support/dsh-home.ts';
import { currentRecordsIn, retainedRecordMaterial, type ExecutionActionRequest, type JobRecord, type LedgerRecord, type RevisionProposal, type RunRecord } from '@hima/harness';

process.env.HIMA_TEST_SILENT_AGENT = '1';
process.env.HIMA_TEST_LEGACY_AUTO_DRIVE = '0';

const identity = (value: unknown): string => {
  const stable = (item: unknown): unknown => Array.isArray(item) ? item.map(stable) : item && typeof item === 'object'
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([key, field]) => [key, stable(field)])) : item;
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
};

async function installRevisionFork(home: string, packDir: string): Promise<void> {
  await mkdir(packDir, { recursive: true });
  for (const file of ['semantics.yml', 'readers', 'rules', 'tools', 'knowledge']) {
    await cp(path.join(repoRoot, 'test/fixtures/pipeline/workshop', file), path.join(packDir, file), { recursive: true });
  }
  await writeFile(path.join(packDir, 'PACK.md'), '# PLS-11 real fork revision fixture\n');
  await writeFile(path.join(packDir, 'contract.yml'), `id: revision-fork
version: '1'
title: Revision fork
inputs:
  - { name: flowRoot, description: Source numbers }
  - { name: design, description: Input set }
  - { name: workspaceRoot, description: Campaign workspaces }
outputs:
  - { name: numbers, path: flow/numbers.txt, description: Source measurements }
  - { name: seed, path: flow/seed.txt, reader: sum-file, description: Fork source evidence }
  - { name: analysis, path: research/analysis/result.txt, reader: sum-file, description: Revised branch evidence }
  - { name: independent, path: research/independent/result.txt, reader: sum-file, description: Independent branch evidence }
environment: { wrappers: [sh] }
workspace: { copy: [numbers.txt, seed.txt] }
workshops:
  - id: analyze
    purpose: Produce the revised branch result.
    directory: research/analysis
    entry: entry.sh
    language: sh
    inputs: [SCALE]
    reads: [numbers]
    knowledge: [sum.md]
    produces: analysis
    argv: [sh, '\${ENTRY}', '\${WORKSHOP}', '\${WORKSPACE}', '\${SCALE}']
  - id: independent
    purpose: Produce independent branch evidence.
    directory: research/independent
    entry: entry.sh
    language: sh
    inputs: [SCALE]
    reads: [numbers]
    knowledge: [sum.md]
    produces: independent
    argv: [sh, '\${ENTRY}', '\${WORKSHOP}', '\${WORKSPACE}', '\${SCALE}']
rules: [sum-valid]
knowledge: [{ file: sum.md, purpose: How to calculate the scaled sum }]
strategy:
  scale: { type: number, unit: count, min: 1, max: 4, default: 2 }
words: { scale: { label: scale factor, unit: count } }
`);
  await writeFile(path.join(packDir, 'graph.yml'), `id: revision-fork
version: '1'
entry: start
nodes:
  - { id: start, kind: act, parameters: { observes: seed } }
  - id: analyze
    kind: act
    parameters: { workshop: analyze, arguments: { SCALE: { from: strategy, name: scale } } }
  - { id: read-analysis, kind: act, parameters: { observes: analysis } }
  - id: independent
    kind: act
    parameters: { workshop: independent, arguments: { SCALE: { from: strategy, name: scale } } }
  - { id: read-independent, kind: act, parameters: { observes: independent } }
  - { id: judge, kind: judge, parameters: { rules: [sum-valid] } }
edges:
  - { from: start, to: analyze }
  - { from: start, to: independent }
  - { from: analyze, to: read-analysis }
  - { from: read-analysis, to: judge }
  - { from: independent, to: read-independent }
  - { from: read-independent, to: judge }
`);
  await writeFile(path.join(home, 'numbers.txt'), '3\n7\n11\n');
  await writeFile(path.join(home, 'seed.txt'), '42\n');
}

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
    const original = 'sleep 1\nmkdir -p "$2/research/analysis"\nawk -v scale="$3" \'{sum+=$1} END {print sum*scale}\' "$2/flow/numbers.txt" > "$2/research/analysis/result.txt"\n';
    await act('write', { executionId: first, path: 'entry.sh', content: original });
    await act('work', { executionId: first });
    const liveContext = host.ctx.hima.executionContext(runId); const liveSource = host.ctx.hima.ledger.records({ runId, type: 'code' }).findLast((record) => record.type === 'code')!;
    const liveEvidence = host.ctx.hima.ledger.records({ runId }).find((record) => record.type === 'workspace')!;
    assert.equal(liveSource.type, 'code');
    const liveRevision: RevisionProposal = { revisionId: 'revision-during-live-job', method: { id: liveContext.method!.id, version: liveContext.method!.version, digest: liveContext.method!.digest },
      inputThroughSeq: liveContext.run.nextSeq - 1, inputs: [{ recordId: liveEvidence.id, contentIdentity: identity(liveEvidence) }],
      reason: 'must wait for the real Workshop Job boundary', changedNodes: ['analyze'], affectedNodes: ['analyze', 'read-analysis', 'judge'],
      changes: [{ nodeId: 'analyze', scope: 'workshop', path: 'entry.sh', fromSha256: liveSource.sha256,
        content: `${original}# too early\n`, sourceRecordId: liveSource.id }] };
    const liveRefusal = await act('revise', { revision: liveRevision });
    assert.equal(liveRefusal.kind, 'refused'); assert.match(liveRefusal.reason!, /safe boundary with no live or uncertain Job/);
    assert.equal(host.ctx.hima.ledger.records({ runId, type: 'revision' }).length, 0, 'a live Job refusal records no partial revision');
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

test('a completed real fork reopens only the revised branch and keeps sibling evidence current', async (t) => {
  const home = await localHome(t, { sleepSeconds: 0 }); assert.ok(home);
  const packDir = path.join(home.h.home, 'hima/packs/revision-fork');
  await installRevisionFork(home.flow.root, packDir);
  const host = await bootInProcess(home.h); let runId: string | undefined;
  try {
    const owner = await createRootAgent(host.ctx, home.h.workspace);
    const started = await host.ctx.hima.startRun({ pack: 'revision-fork', site: 'local', goal: { target_period_ns: 2 }, ownerSessionId: String(owner.id) });
    assert.equal(started.kind, 'ran'); if (started.kind !== 'ran') return; runId = started.run.id;
    let request = 0;
    const act = (action: ExecutionActionRequest['action'], fields: Partial<ExecutionActionRequest> = {}) => {
      const control = host.ctx.hima.ledger.run(runId!)!.control!;
      return host.ctx.hima.executionAction({ runId: runId!, actor: String(owner.id), expectedEpoch: control.epoch,
        expectedRevision: control.revision, requestId: `fork-revision-${++request}`, action, ...fields });
    };
    const work = async (nodeId: string, code?: string, workshop = code !== undefined): Promise<string> => {
      const begun = await act('begin', { nodeId }); assert.equal(begun.kind, 'accepted', JSON.stringify(begun));
      const executionId = begun.receipt!.executionId!;
      if (workshop) {
        assert.equal((await act('recommend', { executionId })).kind, 'accepted');
      }
      if (code !== undefined) {
        assert.equal((await act('write', { executionId, path: 'entry.sh', content: code })).kind, 'accepted');
      }
      assert.equal((await act('work', { executionId })).kind, 'accepted');
      await waitUntil(`${nodeId} settled`, () => host.ctx.hima.executionContext(runId!).executions
        .some((execution) => execution.id === executionId && (execution.phase === 'ready' || execution.phase === 'failed')));
      assert.equal(host.ctx.hima.executionContext(runId!).executions.find((execution) => execution.id === executionId)?.phase, 'ready',
        JSON.stringify(host.ctx.hima.executionContext(runId!)));
      assert.equal((await act('complete', { executionId })).kind, 'accepted');
      return executionId;
    };
    const originalB = 'mkdir -p "$2/research/analysis"\nawk -v scale="$3" \'{sum+=$1} END {print sum*scale}\' "$2/flow/numbers.txt" > "$2/research/analysis/result.txt"\n';
    const originalD = 'mkdir -p "$2/research/independent"\nawk -v scale="$3" \'{sum+=$1} END {print sum*scale}\' "$2/flow/numbers.txt" > "$2/research/independent/result.txt"\n';
    await work('start');
    assert.deepEqual([...host.ctx.hima.executionContext(runId).available].sort(), ['analyze', 'independent']);
    const oldB = await work('analyze', originalB); await work('read-analysis');
    const oldD = await work('independent', originalD); await work('read-independent');
    const before = host.ctx.hima.executionContext(runId);
    assert.deepEqual(before.available, ['judge']);
    assert.equal(host.ctx.hima.ledger.records({ runId, type: 'verdict' }).length, 0, 'the unexecuted join makes no final claim');
    const source = host.ctx.hima.ledger.records({ runId, type: 'code' }).findLast((record) => record.type === 'code' && record.nodeId === 'analyze')!;
    assert.equal(source.type, 'code');
    const evidence = host.ctx.hima.ledger.records({ runId }).find((record) => record.type === 'workspace')!;
    const revisedCode = `${originalB}# revised B only\n`;
    const proposal: RevisionProposal = { revisionId: 'fork-b-v2', method: { id: before.method!.id, version: before.method!.version, digest: before.method!.digest },
      inputThroughSeq: before.run.nextSeq - 1, inputs: [{ recordId: evidence.id, contentIdentity: identity(evidence) }],
      reason: 'change branch B while retaining A and completed independent D', changedNodes: ['analyze'],
      affectedNodes: ['analyze', 'read-analysis', 'judge'],
      changes: [{ nodeId: 'analyze', scope: 'workshop', path: 'entry.sh', fromSha256: source.sha256, content: revisedCode, sourceRecordId: source.id }] };
    const launchesBefore = host.ctx.hima.ledger.records({ runId, type: 'job' }).filter((record): record is JobRecord => record.type === 'job' && record.event === 'launched');
    const oldDLaunches = launchesBefore.filter((record) => record.branchId === 'independent').map((record) => record.id);
    const revised = await act('revise', { revision: proposal });
    assert.equal(revised.kind, 'accepted', JSON.stringify(revised));
    const reopened = host.ctx.hima.executionContext(runId);
    assert.equal(reopened.run.currentNode, 'judge');
    assert.deepEqual(reopened.run.fork?.branches, {
      analyze: { currentNode: 'analyze', state: 'running' },
      independent: { currentNode: 'judge', state: 'done' },
    });
    assert.deepEqual(reopened.available, ['analyze']);
    assert.equal(reopened.executions.find((execution) => execution.id === oldB)?.supersededBy, proposal.revisionId);
    assert.equal(reopened.executions.find((execution) => execution.id === oldD)?.supersededBy, undefined);
    const current = currentRecordsIn(host.ctx.hima.ledger.records({ runId }));
    assert.equal(current.some((record) => record.type === 'observation' && record.branchId === 'analyze'), false);
    assert.equal(current.some((record) => record.type === 'observation' && record.branchId === 'independent'), true);
    assert.equal(current.some((record) => record.type === 'observation' && record.branchId === undefined), true);
    assert.deepEqual(host.ctx.hima.ledger.records({ runId, type: 'job' }).filter((record) => record.type === 'job' && record.event === 'launched').map((record) => record.id), launchesBefore.map((record) => record.id),
      'admission launches no Job and preserves every prior launch identity');
    await work('analyze', undefined, true);
    const seeded = host.ctx.hima.ledger.records({ runId, type: 'code' }).findLast((record) => record.type === 'code' && record.nodeId === 'analyze')!;
    assert.equal(seeded.type, 'code'); assert.equal(await readFile(seeded.path, 'utf8'), revisedCode);
    await work('read-analysis');
    const afterRerun = host.ctx.hima.executionContext(runId);
    assert.equal(afterRerun.run.fork, undefined);
    assert.deepEqual(afterRerun.available, ['judge']);
    assert.equal(host.ctx.hima.ledger.records({ runId, type: 'verdict' }).length, 0, 'C still has no claim until the owner runs it');
    const launchesAfter = host.ctx.hima.ledger.records({ runId, type: 'job' }).filter((record): record is JobRecord => record.type === 'job' && record.event === 'launched');
    assert.equal(launchesAfter.length, launchesBefore.length + 2, 'only revised B and its reader launched again');
    assert.deepEqual(launchesAfter.filter((record) => record.branchId === 'independent').map((record) => record.id), oldDLaunches);
    const oldWorkshop = launchesBefore.find((record) => record.nodeId === 'analyze')?.workshop;
    const newWorkshop = launchesAfter.findLast((record) => record.nodeId === 'analyze')?.workshop;
    assert.ok(oldWorkshop && newWorkshop); assert.equal(oldWorkshop.entry.sha256, source.sha256); assert.notEqual(newWorkshop.entry.sha256, oldWorkshop.entry.sha256);
    await work('judge');
    assert.equal(host.ctx.hima.ledger.records({ runId, type: 'verdict' }).length, 2, 'C compares both current branch results after explicit owner action');
  } finally {
    if (runId) { killSessions(sessionsOf(host, runId)); await host.ctx.hima.cancelRun(runId); }
    await host.dispose(); await home.h.dispose();
  }
});

test('strategy and shared workspace revisions derive every declared consumer before writing', async (t) => {
  const home = await localHome(t, { sleepSeconds: 0 }); assert.ok(home);
  const packDir = path.join(home.h.home, 'hima/packs/revision-fork'); await installRevisionFork(home.flow.root, packDir);
  const host = await bootInProcess(home.h); let runId: string | undefined;
  try {
    const owner = await createRootAgent(host.ctx, home.h.workspace);
    const started = await host.ctx.hima.startRun({ pack: 'revision-fork', site: 'local', goal: { target_period_ns: 2 }, ownerSessionId: String(owner.id) });
    assert.equal(started.kind, 'ran'); if (started.kind !== 'ran') return; runId = started.run.id;
    let request = 0;
    const revise = (proposal: RevisionProposal) => {
      const control = host.ctx.hima.ledger.run(runId!)!.control!;
      return host.ctx.hima.executionAction({ runId: runId!, actor: String(owner.id), expectedEpoch: control.epoch,
        expectedRevision: control.revision, requestId: `dependency-revision-${++request}`, action: 'revise', revision: proposal });
    };
    const context = host.ctx.hima.executionContext(runId); const workspace = host.ctx.hima.ledger.records({ runId }).find((record) => record.type === 'workspace')!;
    const common = { method: { id: context.method!.id, version: context.method!.version, digest: context.method!.digest },
      inputThroughSeq: context.run.nextSeq - 1, inputs: [{ recordId: workspace.id, contentIdentity: identity(workspace) }],
      reason: 'dependency ownership must come from the retained method', changedNodes: ['analyze'],
      affectedNodes: ['analyze', 'read-analysis', 'judge'] };
    const strategy = await revise({ revisionId: 'understated-shared-strategy', ...common, strategy: { scale: 3 }, changes: [] });
    assert.equal(strategy.kind, 'refused');
    assert.match(strategy.reason!, /actual declared and recorded dependency closure: (?=.*analyze)(?=.*read-analysis)(?=.*independent)(?=.*read-independent)(?=.*judge)/);
    const inputPath = path.join((workspace as Extract<LedgerRecord, { type: 'workspace' }>).workspace, 'flow/numbers.txt');
    const before = await readFile(inputPath); const beforeSha = createHash('sha256').update(before).digest('hex');
    const sharedInput = await revise({ revisionId: 'understated-shared-input', ...common,
      changes: [{ nodeId: 'analyze', scope: 'workspace', path: 'flow/numbers.txt', fromSha256: beforeSha, content: '3\n7\n13\n' }] });
    assert.equal(sharedInput.kind, 'refused');
    assert.match(sharedInput.reason!, /actual declared and recorded dependency closure: (?=.*analyze)(?=.*read-analysis)(?=.*independent)(?=.*read-independent)(?=.*judge)/);
    const falseOwner = await revise({ revisionId: 'false-shared-input-owner', ...common, changedNodes: ['judge'], affectedNodes: ['judge'],
      changes: [{ nodeId: 'judge', scope: 'workspace', path: 'flow/numbers.txt', fromSha256: beforeSha, content: '3\n7\n13\n' }] });
    assert.equal(falseOwner.kind, 'refused'); assert.match(falseOwner.reason!, /is not owned by claimed node judge; actual consumers are analyze, independent/);
    assert.deepEqual(await readFile(inputPath), before, 'understated dependency claims are refused before workspace writes');
    assert.equal(host.ctx.hima.ledger.records({ runId, type: 'revision' }).length, 0);
    assert.equal(host.ctx.hima.ledger.records({ runId, type: 'job' }).length, 0);
  } finally {
    if (runId) await host.ctx.hima.cancelRun(runId);
    await host.dispose(); await home.h.dispose();
  }
});

test('restart completes an applied revision control prefix and fences semantically tampered facts', async (t) => {
  const home = await localHome(t, { sleepSeconds: 0 }); assert.ok(home);
  const packDir = path.join(home.h.home, 'hima/packs/authored-workshop'); await mkdir(packDir, { recursive: true });
  for (const file of ['contract.yml', 'graph.yml', 'semantics.yml', 'readers', 'rules', 'tools', 'knowledge']) {
    await cp(path.join(repoRoot, 'test/fixtures/pipeline/workshop', file), path.join(packDir, file), { recursive: true });
  }
  await writeFile(path.join(packDir, 'PACK.md'), '# PLS-11 recovery fixture\n');
  await writeFile(path.join(home.flow.root, 'numbers.txt'), '3\n7\n11\n');
  let host = await bootInProcess(home.h); let validRun: string | undefined; let tamperedRun: string | undefined;
  try {
    const owner = await createRootAgent(host.ctx, home.h.workspace); const actor = String(owner.id);
    const makeRevision = async (revisionId: string, requestId: string) => {
      const started = await host.ctx.hima.startRun({ pack: 'authored-workshop', site: 'local', goal: { target_period_ns: 2 }, ownerSessionId: actor });
      assert.equal(started.kind, 'ran'); if (started.kind !== 'ran') throw new Error('run did not start');
      const runId = started.run.id; const before = structuredClone(host.ctx.hima.ledger.run(runId)!);
      const context = host.ctx.hima.executionContext(runId); const evidence = host.ctx.hima.ledger.records({ runId }).find((record) => record.type === 'workspace')!;
      const proposal: RevisionProposal = { revisionId, method: { id: context.method!.id, version: context.method!.version, digest: context.method!.digest },
        inputThroughSeq: context.run.nextSeq - 1, inputs: [{ recordId: evidence.id, contentIdentity: identity(evidence) }],
        reason: 'change the bound strategy and recover its accepted state', changedNodes: ['analyze'],
        affectedNodes: ['analyze', 'read-analysis', 'judge'], strategy: { scale: 3 }, changes: [] };
      const request: ExecutionActionRequest = { runId, actor, expectedEpoch: before.control!.epoch, expectedRevision: before.control!.revision,
        requestId, action: 'revise', revision: proposal };
      const applied = await host.ctx.hima.executionAction(request); assert.equal(applied.kind, 'accepted', JSON.stringify(applied));
      return { runId, before, completed: structuredClone(host.ctx.hima.ledger.run(runId)!), request, proposal };
    };
    const valid = await makeRevision('recover-valid-strategy', 'recover-valid-request'); validRun = valid.runId;
    const tampered = await makeRevision('recover-tampered-strategy', 'recover-tampered-request'); tamperedRun = tampered.runId;
    await host.dispose();
    const ledgerPath = path.join(home.h.home, 'storages/hima_ledger.json');
    const persisted = JSON.parse(await readFile(ledgerPath, 'utf8')) as { tables: { runs: Record<string, RunRecord>; records: Record<string, LedgerRecord> } };
    const restoreAppliedPrefix = (fixture: typeof valid) => {
      const row = persisted.tables.runs[fixture.runId]!; const completedRequest = row.control!.requests[fixture.request.requestId]!;
      persisted.tables.runs[fixture.runId] = { ...row, currentNode: fixture.before.currentNode, strategy: fixture.before.strategy,
        ...(fixture.before.fork === undefined ? { fork: undefined } : { fork: fixture.before.fork }),
        control: { ...row.control!, executions: fixture.before.control!.executions, requests: { ...row.control!.requests,
          [fixture.request.requestId]: { ...completedRequest, state: 'admitted', receipt: {
            requestId: fixture.request.requestId, action: 'revise', data: { revisionId: fixture.proposal.revisionId },
          } },
        } },
      };
    };
    restoreAppliedPrefix(valid); restoreAppliedPrefix(tampered);
    const tamperedApplied = Object.values(persisted.tables.records).find((record) => record.type === 'revision'
      && record.revisionId === tampered.proposal.revisionId && record.event === 'applied')!;
    assert.equal(tamperedApplied.type, 'revision');
    if (tamperedApplied.type === 'revision') tamperedApplied.affectedNodes = tamperedApplied.affectedNodes.filter((nodeId) => nodeId !== 'judge');
    await writeFile(ledgerPath, `${JSON.stringify(persisted, null, 2)}\n`);
    host = await bootInProcess(home.h); await host.ctx.hima.reconciled;
    const recovered = host.ctx.hima.executionContext(valid.runId);
    assert.equal(recovered.run.strategy?.scale, 3);
    assert.equal(recovered.run.currentNode, 'analyze');
    assert.equal(recovered.run.control?.requests[valid.request.requestId]?.state, 'done');
    assert.deepEqual(recovered.available, ['analyze']);
    assert.equal(host.ctx.hima.ledger.records({ runId: valid.runId, type: 'revision' }).filter((record) => record.type === 'revision' && record.event === 'applied').length, 1);
    assert.equal(host.ctx.hima.ledger.records({ runId: valid.runId, type: 'job' }).length, 0, 'recovery launches no hidden Job');
    assert.equal((await host.ctx.hima.executionAction(valid.request)).kind, 'duplicate', 'the exact original request remains idempotent');
    assert.equal(host.ctx.hima.ledger.records({ runId: valid.runId, type: 'revision' }).filter((record) => record.type === 'revision' && record.event === 'applied').length, 1);
    assert.equal(host.ctx.hima.ledger.records({ runId: valid.runId, type: 'job' }).length, 0);

    const refused = host.ctx.hima.executionContext(tampered.runId);
    assert.equal(refused.run.strategy?.scale, 2, 'tampered applied facts do not change accepted strategy state');
    assert.equal(refused.run.control?.requests[tampered.request.requestId]?.state, 'uncertain');
    assert.deepEqual(refused.available, []);
    assert.match(refused.reason!, /admitted completion, revision or human clearance/);
    const repeatedTamper = await host.ctx.hima.executionAction(tampered.request);
    assert.equal(repeatedTamper.kind, 'refused'); assert.match(repeatedTamper.reason!, /inconsistent or incomplete persisted facts/);
    assert.equal(host.ctx.hima.ledger.records({ runId: tampered.runId, type: 'job' }).length, 0);
  } finally {
    if (validRun) await host.ctx.hima.cancelRun(validRun);
    if (tamperedRun) await host.ctx.hima.cancelRun(tamperedRun);
    await host.dispose(); await home.h.dispose();
  }
});

test('restart finishes admitted Workshop bytes interrupted before the applied record save', async (t) => {
  const home = await localHome(t, { sleepSeconds: 0 }); assert.ok(home);
  const packDir = path.join(home.h.home, 'hima/packs/authored-workshop'); await mkdir(packDir, { recursive: true });
  for (const file of ['contract.yml', 'graph.yml', 'semantics.yml', 'readers', 'rules', 'tools', 'knowledge']) {
    await cp(path.join(repoRoot, 'test/fixtures/pipeline/workshop', file), path.join(packDir, file), { recursive: true });
  }
  await writeFile(path.join(packDir, 'PACK.md'), '# PLS-11 interrupted save fixture\n');
  await writeFile(path.join(home.flow.root, 'numbers.txt'), '3\n7\n11\n');
  let host = await bootInProcess(home.h); let runId: string | undefined;
  try {
    const owner = await createRootAgent(host.ctx, home.h.workspace); const actor = String(owner.id);
    const started = await host.ctx.hima.startRun({ pack: 'authored-workshop', site: 'local', goal: { target_period_ns: 2 }, ownerSessionId: actor });
    assert.equal(started.kind, 'ran'); if (started.kind !== 'ran') return; runId = started.run.id;
    let count = 0;
    const act = (action: ExecutionActionRequest['action'], fields: Partial<ExecutionActionRequest> = {}) => {
      const control = host.ctx.hima.ledger.run(runId!)!.control!;
      return host.ctx.hima.executionAction({ runId: runId!, actor, expectedEpoch: control.epoch, expectedRevision: control.revision,
        requestId: `save-boundary-${++count}`, action, ...fields });
    };
    const begun = await act('begin', { nodeId: 'analyze' }); const executionId = begun.receipt!.executionId!;
    await act('recommend', { executionId });
    const original = 'mkdir -p "$2/research/analysis"\nawk -v scale="$3" \'{sum+=$1} END {print sum*scale}\' "$2/flow/numbers.txt" > "$2/research/analysis/result.txt"\n';
    await act('write', { executionId, path: 'entry.sh', content: original }); await act('work', { executionId });
    await waitUntil('Workshop result before revision', () => host.ctx.hima.executionContext(runId!).executions.some((execution) => execution.id === executionId && execution.phase === 'ready'));
    await act('complete', { executionId });
    const before = structuredClone(host.ctx.hima.ledger.run(runId)!);
    const source = host.ctx.hima.ledger.records({ runId, type: 'code' }).findLast((record) => record.type === 'code')!;
    assert.equal(source.type, 'code');
    const context = host.ctx.hima.executionContext(runId); const evidence = host.ctx.hima.ledger.records({ runId }).find((record) => record.type === 'workspace')!;
    const proposal: RevisionProposal = { revisionId: 'recover-unsaved-workshop', method: { id: context.method!.id, version: context.method!.version, digest: context.method!.digest },
      inputThroughSeq: context.run.nextSeq - 1, inputs: [{ recordId: evidence.id, contentIdentity: identity(evidence) }],
      reason: 'recover exact admitted Workshop bytes', changedNodes: ['analyze'], affectedNodes: ['analyze', 'read-analysis', 'judge'],
      changes: [{ nodeId: 'analyze', scope: 'workshop', path: 'entry.sh', fromSha256: source.sha256,
        content: `${original}# persisted before applied record\n`, sourceRecordId: source.id }] };
    const control = before.control!;
    const request: ExecutionActionRequest = { runId, actor, expectedEpoch: control.epoch, expectedRevision: control.revision,
      requestId: 'recover-unsaved-workshop-request', action: 'revise', revision: proposal };
    assert.equal((await host.ctx.hima.executionAction(request)).kind, 'accepted');
    const completed = structuredClone(host.ctx.hima.ledger.run(runId)!);
    const launches = host.ctx.hima.ledger.records({ runId, type: 'job' }).filter((record) => record.type === 'job' && record.event === 'launched').length;
    await host.dispose();
    const ledgerPath = path.join(home.h.home, 'storages/hima_ledger.json');
    const persisted = JSON.parse(await readFile(ledgerPath, 'utf8')) as { tables: { runs: Record<string, RunRecord>; records: Record<string, LedgerRecord> } };
    const appliedEntry = Object.entries(persisted.tables.records).find(([, record]) => record.type === 'revision'
      && record.revisionId === proposal.revisionId && record.event === 'applied')!;
    const applied = appliedEntry[1]; assert.equal(applied.type, 'revision');
    delete persisted.tables.records[appliedEntry[0]];
    const completedRequest = completed.control!.requests[request.requestId]!;
    persisted.tables.runs[runId] = { ...completed, nextSeq: applied.seq, currentNode: before.currentNode, strategy: before.strategy,
      control: { ...completed.control!, executions: before.control!.executions, requests: { ...completed.control!.requests,
        [request.requestId]: { ...completedRequest, state: 'admitted', receipt: { requestId: request.requestId, action: 'revise', data: { revisionId: proposal.revisionId } } },
      } } };
    await writeFile(ledgerPath, `${JSON.stringify(persisted, null, 2)}\n`);
    host = await bootInProcess(home.h); await host.ctx.hima.reconciled;
    const recovered = host.ctx.hima.executionContext(runId);
    assert.equal(recovered.run.control?.requests[request.requestId]?.state, 'done');
    assert.deepEqual(recovered.available, ['analyze']);
    assert.equal(recovered.executions.find((execution) => execution.id === executionId)?.supersededBy, proposal.revisionId);
    const recoveredApplied = recovered.revisions.filter((record) => record.revisionId === proposal.revisionId && record.event === 'applied');
    assert.equal(recoveredApplied.length, 1);
    assert.equal(host.ctx.hima.ledger.records({ runId, type: 'job' }).filter((record) => record.type === 'job' && record.event === 'launched').length, launches,
      'finishing the admitted save boundary launches no Job');
    assert.equal((await host.ctx.hima.executionAction(request)).kind, 'duplicate');
  } finally {
    if (runId) { killSessions(sessionsOf(host, runId)); await host.ctx.hima.cancelRun(runId); }
    await host.dispose(); await home.h.dispose();
  }
});
