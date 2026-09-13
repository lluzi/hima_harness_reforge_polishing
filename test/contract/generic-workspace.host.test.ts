// Generic Pack workspace persistence through the real Host; no model, Electron or EDA.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHimaHome, repoRoot } from './support/dsh-home.ts';
import { bootInProcess, createRootAgent, type InProcessHost } from './support/boot-inprocess.ts';
import { writeLocalSite } from './support/site.ts';
import { waitUntil } from './support/fabric.ts';
import { importLegacyLedger, prepareWorkspace, type ExecutionActionRequest } from '@hima/harness';

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
    if (!declareDesign) await writeFile(contractFile, contract.replace('  - { name: design, description: Input set }\n', ''));
    await writeFile(path.join(packDir, 'PACK.md'), '# Generic numeric persistence fixture\n');
    await writeLocalSite(h, { allowedReadRoots: [h.workspace, flowRoot], allowedWriteRoots: [h.workspace],
      bindings: { flowRoot, workspaceRoot: h.workspace, ...(siteDesign === undefined ? {} : { design: siteDesign }) } });
    return h;
  } catch (error) { await h.dispose(); throw error; }
}

function ownerActions(host: InProcessHost, runId: string, actor: string) {
  let next = 0;
  return (action: ExecutionActionRequest['action'], fields: Partial<ExecutionActionRequest> = {}) => {
    const control = host.ctx.hima.ledger.run(runId)!.control!;
    return host.ctx.hima.executionAction({ runId, actor, expectedEpoch: control.epoch,
      expectedRevision: control.revision, requestId: `numeric-${++next}`, action, ...fields });
  };
}

async function analyze(host: InProcessHost, runId: string, actor: string) {
  const act = ownerActions(host, runId, actor);
  const begun = await act('begin', { nodeId: 'analyze' });
  const executionId = begun.receipt?.executionId;
  assert.ok(executionId);
  const script = 'set -eu\nmkdir -p "$2/research/analysis"\nawk -v scale="$3" \'{sum+=$1} END {print sum*scale}\' "$2/flow/numbers.txt" > "$2/research/analysis/result.txt"\n';
  assert.equal((await act('write', { executionId, path: 'entry.sh', content: script })).kind, 'accepted');
  assert.equal((await act('work', { executionId })).kind, 'accepted');
  await waitUntil('numeric analysis Job is ready', () => host.ctx.hima.executionContext(runId).executions.some((item) => item.id === executionId && item.phase === 'ready'));
  assert.equal((await act('complete', { executionId })).kind, 'accepted');
  return act;
}

test('a generic Pack without design reopens its completed Run without rewriting workspace facts', async () => {
  const h = await numericHome();
  let host: InProcessHost | undefined;
  try {
    host = await bootInProcess(h);
    const owner = await createRootAgent(host.ctx, h.workspace);
    const started = await host.ctx.hima.startRun({ pack: 'authored-workshop', site: 'local',
      goal: { target_period_ns: 2 }, ownerSessionId: String(owner.id) });
    assert.equal(started.kind, 'ran');
    if (started.kind !== 'ran') return;
    const act = await analyze(host, started.run.id, String(owner.id));
    for (const nodeId of ['read-analysis', 'judge']) {
      const begun = await act('begin', { nodeId });
      const executionId = begun.receipt?.executionId;
      assert.ok(executionId);
      assert.equal((await act('work', { executionId })).kind, 'accepted');
      await waitUntil(`${nodeId} is ready`, () => host!.ctx.hima.executionContext(started.run.id).executions.some((item) => item.id === executionId && item.phase === 'ready'));
      assert.equal((await act('complete', { executionId })).kind, 'accepted');
    }
    // This fixture checks a fixed sum but binds no Goal rule; its honest ending is goal-not-met.
    assert.equal(host.ctx.hima.ledger.run(started.run.id)?.status, 'ended-goal-not-met');
    assert.ok(host.ctx.hima.ledger.records({ runId: started.run.id, type: 'observation' }).some((record) => record.type === 'observation' && record.values.some((value) => value.type === 'scaled_sum' && value.value === 42)));
    const original = host.ctx.hima.ledger.records({ runId: started.run.id, type: 'workspace' });
    assert.equal(original.length, 1);
    assert.equal(Object.hasOwn(original[0]!, 'design'), false);
    const metadata = await readFile(path.join(started.workspace, 'workspace.json'), 'utf8');
    assert.equal(Object.hasOwn(JSON.parse(metadata), 'design'), false);
    await host.dispose();
    host = undefined;
    const storageFile = path.join(h.home, 'storages/hima_ledger.json');
    const stored = await readFile(storageFile);
    assert.equal(JSON.parse(stored.toString()).unit.version, 21);
    host = await bootInProcess(h);
    await host.ctx.hima.reconciled;
    assert.equal(host.ctx.hima.ledger.run(started.run.id)?.status, 'ended-goal-not-met');
    assert.deepEqual(host.ctx.hima.ledger.records({ runId: started.run.id, type: 'workspace' }), original);
    assert.equal(await readFile(path.join(started.workspace, 'workspace.json'), 'utf8'), metadata);
    assert.deepEqual(await readFile(storageFile), stored, 'cold open leaves the stored ledger bytes unchanged');
    assert.equal(await readFile(path.join(h.home, 'numeric-flow/numbers.txt'), 'utf8'), '3\n7\n11\n');
  } finally { await host?.dispose(); await h.dispose(); }
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
    assert.equal(started.kind, 'ran');
    if (started.kind !== 'ran') return;
    await host.ctx.hima.cancelRun(started.run.id);
    const original = host.ctx.hima.ledger.records({ runId: started.run.id, type: 'workspace' });
    assert.equal(original[0]?.type === 'workspace' && original[0].design, design);
    const metadata = await readFile(path.join(started.workspace, 'workspace.json'));
    assert.equal(JSON.parse(metadata.toString()).design, design);
    await host.dispose();
    host = undefined;
    host = await bootInProcess(h);
    await host.ctx.hima.reconciled;
    assert.deepEqual(host.ctx.hima.ledger.records({ runId: started.run.id, type: 'workspace' }), original);
    assert.deepEqual(await readFile(path.join(started.workspace, 'workspace.json')), metadata);
  } finally { await host?.dispose(); await h.dispose(); }
});

test('generic recovery and explicit adoption preserve absent design while rejecting changed metadata and invalid v19 input', async () => {
  const h = await numericHome();
  let host: InProcessHost | undefined;
  try {
    host = await bootInProcess(h);
    const owner = await createRootAgent(host.ctx, h.workspace);
    const started = await host.ctx.hima.startRun({ pack: 'authored-workshop', site: 'local',
      goal: { target_period_ns: 2 }, ownerSessionId: String(owner.id) });
    assert.equal(started.kind, 'ran');
    if (started.kind !== 'ran') return;
    await analyze(host, started.run.id, String(owner.id));
    // A private historical fixture at a real collected Job boundary; no original home is used.
    await host.ctx.hima.ledger.advanceRun(started.run.id, { control: undefined });
    const original = host.ctx.hima.ledger.records({ runId: started.run.id });
    await host.dispose();
    host = undefined;
    const stored = JSON.parse(await readFile(path.join(h.home, 'storages/hima_ledger.json'), 'utf8'));
    stored.unit.version = 19;
    for (const record of Object.values<{ type: string; packDigest?: string }>(stored.tables.records)) {
      if (record.type === 'workspace') delete record.packDigest;
    }
    const sourceFile = path.join(h.home, 'invalid-v19.json');
    const source = JSON.stringify(stored);
    await writeFile(sourceFile, source);
    await assert.rejects(importLegacyLedger({ sourceFile, home: path.join(h.home, 'must-not-import') }), /design/);
    assert.equal(await readFile(sourceFile, 'utf8'), source, 'v19 design requirement and source bytes remain unchanged');
    host = await bootInProcess(h);
    await host.ctx.hima.reconciled;
    assert.equal(host.ctx.hima.ledger.run(started.run.id)?.currentNode, 'read-analysis');
    assert.deepEqual(host.ctx.hima.ledger.records({ runId: started.run.id }), original);
    const nextOwner = await createRootAgent(host.ctx, h.workspace);
    const request = { runId: started.run.id, actor: String(nextOwner.id), expectedEpoch: 0, expectedRevision: 0,
      requestId: 'adopt-generic', action: 'adopt' as const };
    const metadataFile = path.join(started.workspace, 'workspace.json');
    const metadata = await readFile(metadataFile, 'utf8');
    await writeFile(metadataFile, JSON.stringify({ ...JSON.parse(metadata), design: 'injected-design' }));
    const refused = await host.ctx.hima.executionAction(request);
    assert.equal(refused.kind, 'refused');
    assert.match(refused.reason ?? '', /workspace\/input metadata|input bindings/);
    await writeFile(metadataFile, metadata);
    const adopted = await host.ctx.hima.executionAction(request);
    assert.equal(adopted.kind, 'accepted', adopted.reason);
    assert.deepEqual(host.ctx.hima.ledger.records({ runId: started.run.id }), original);
    assert.equal(await readFile(metadataFile, 'utf8'), metadata);
    await host.ctx.hima.cancelRun(started.run.id);
  } finally { await host?.dispose(); await h.dispose(); }
});
