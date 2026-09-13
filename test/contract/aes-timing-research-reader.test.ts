// @hima-seam reader CLI
// Synthetic finite data only: this proves the Pack reader's public file contract, not AES research.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { repoRoot } from './support/dsh-home.ts';
import { localHome, waitUntil } from './support/fabric.ts';
import { writeLocalSite } from './support/site.ts';
import { bootInProcess, createRootAgent } from './support/boot-inprocess.ts';
import { packStage, type ExecutionActionRequest } from '@hima/harness';

const reader = path.join(repoRoot, 'packs/aes-timing-research/tools/read-selection.py');

async function fixture(t: test.TestContext) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aes-selection-reader-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const report = path.join(root, 'selection.json');
  const sample = {
    schema: 'aes-path-motifs/1', budget: 2,
    paths: [
      { id: 'p1', points: [{ instance: 'u1', master: 'M1', sourceLine: 1 }] }, { id: 'p2', points: [{ instance: 'u1', master: 'M1', sourceLine: 2 }] },
      { id: 'p3', points: [{ instance: 'u1', master: 'M1', sourceLine: 30 }, { instance: 'u2', master: 'M2', sourceLine: 31 }] }, { id: 'p4', points: [{ instance: 'u3', master: 'M3', sourceLine: 4 }] },
      { id: 'p5', points: [{ instance: 'u2', master: 'M2', sourceLine: 5 }] }, { id: 'p6', points: [{ instance: 'u3', master: 'M3', sourceLine: 6 }] },
    ],
    candidates: [
      { id: 'a', cells: ['u1'], masters: ['M1'], occurrences: [{ path: 'p1', begin: 0, sourceLines: [1] }, { path: 'p2', begin: 0, sourceLines: [2] }] },
      { id: 'b', cells: ['u1', 'u2'], masters: ['M1', 'M2'], occurrences: [{ path: 'p3', begin: 0, sourceLines: [30, 31] }] },
      { id: 'c', cells: ['u3'], masters: ['M3'], occurrences: [{ path: 'p4', begin: 0, sourceLines: [4] }] },
    ],
  };
  const samplePath = path.join(root, 'sample.json');
  await writeFile(samplePath, JSON.stringify(sample));
  return { report, sample, samplePath, out: path.join(root, 'read.json'), digest: createHash('sha256').update(await readFile(samplePath)).digest('hex') };
}

test('owner-controlled two-generation Workshop retains code and turns a measured overlap FAIL into PASS on synthetic finite data', async (t) => {
  const home = await localHome(t, { sleepSeconds: 0, parallelJobs: 1 });
  assert.ok(home);
  const packDir = path.join(home.h.home, 'hima/packs/aes-timing-research');
  const flow = path.join(home.h.home, 'finite-selection-flow');
  await mkdir(flow, { recursive: true });
  await (await import('node:fs/promises')).cp(path.join(repoRoot, 'packs/aes-timing-research'), packDir, { recursive: true });
  assert.ok(['compiled', 'tested', 'released'].includes(packStage(packDir).stage), JSON.stringify(packStage(packDir)));
  const sample = { schema: 'aes-path-motifs/1', budget: 2, paths: [
    ...['p1', 'p2', 'p3'].map((id, i) => ({ id, points: [{ instance: 'u1', master: 'M1', sourceLine: i + 1 }] })),
    ...['p4', 'p5'].map((id, i) => ({ id, points: [{ instance: 'u1', master: 'M1', sourceLine: 40 + i * 10 }, { instance: 'u2', master: 'M2', sourceLine: 41 + i * 10 }] })),
    ...['p6', 'p7'].map((id, i) => ({ id, points: [{ instance: 'u3', master: 'M3', sourceLine: 60 + i * 10 }, { instance: 'u4', master: 'M4', sourceLine: 61 + i * 10 }] })),
  ], candidates: [
    { id: 'a', cells: ['u1'], masters: ['M1'], occurrences: [{ path: 'p1', begin: 0, sourceLines: [1] }, { path: 'p2', begin: 0, sourceLines: [2] }, { path: 'p3', begin: 0, sourceLines: [3] }] },
    { id: 'b', cells: ['u1', 'u2'], masters: ['M1', 'M2'], occurrences: [{ path: 'p4', begin: 0, sourceLines: [40, 41] }, { path: 'p5', begin: 0, sourceLines: [50, 51] }] },
    { id: 'c', cells: ['u3', 'u4'], masters: ['M3', 'M4'], occurrences: [{ path: 'p6', begin: 0, sourceLines: [60, 61] }, { path: 'p7', begin: 0, sourceLines: [70, 71] }] },
  ] };
  await writeFile(path.join(flow, 'sample.json'), JSON.stringify(sample));
  await (await import('node:fs/promises')).cp(path.join(repoRoot, 'packs/aes-timing-research/tools/baseline.py'), path.join(flow, 'baseline.py'));
  await writeFile(path.join(flow, 'prepare.py'), `import shutil,sys,pathlib\nw=pathlib.Path(sys.argv[1]); [shutil.copyfile(w/'flow'/n,w/n) for n in ('sample.json','baseline.py')]\n`);
  await writeLocalSite(home.h, { allowedReadRoots: [home.h.workspace, flow], allowedWriteRoots: [home.h.workspace],
    allowedWrappers: ['/usr/bin/python3'], bindings: { flowRoot: flow, workspaceRoot: home.h.workspace } });
  const host = await bootInProcess(home.h);
  let runId: string | undefined;
  try {
    const owner = await createRootAgent(host.ctx, home.h.workspace);
    const started = await host.ctx.hima.startRun({ pack: 'aes-timing-research', site: 'local', test: true, goal: { minimum_score: 7 },
      strategy: { algorithmRevision: 0 }, generationLimit: 2, retryAllowance: 1, timeBoxMs: 90_000, ownerSessionId: String(owner.id) });
    assert.equal(started.kind, 'ran', JSON.stringify(started)); if (started.kind !== 'ran') return;
    runId = started.run.id;
    let request = 0;
    const act = (action: ExecutionActionRequest['action'], fields: Partial<ExecutionActionRequest> = {}) => {
      const c = host.ctx.hima.ledger.run(runId!)!.control!;
      return host.ctx.hima.executionAction({ runId: runId!, actor: String(owner.id), expectedEpoch: c.epoch, expectedRevision: c.revision, requestId: `selection-${++request}`, action, ...fields });
    };
    const complete = async (nodeId: string) => {
      const begun = await act('begin', { nodeId }); assert.equal(begun.kind, 'accepted', begun.reason);
      const executionId = begun.receipt?.executionId; assert.ok(executionId);
      assert.equal((await act('work', { executionId })).kind, 'accepted');
      await waitUntil(`${nodeId} settles`, () => host.ctx.hima.executionContext(runId!).executions.some(e => e.id === executionId && ['ready', 'failed'].includes(e.phase)));
      assert.equal((await act('complete', { executionId })).kind, 'accepted');
      return executionId;
    };
    await complete('prepare');
    const first = await act('begin', { nodeId: 'analyze' }); const firstId = first.receipt?.executionId; assert.ok(firstId);
    const baselineRead = await act('read', { executionId: firstId, output: 'baselineCode' });
    assert.equal(baselineRead.kind, 'accepted');
    const baselineEntry = (baselineRead.data as { text?: unknown }).text; assert.ok(typeof baselineEntry === 'string');
    const sampleRead = await act('read', { executionId: firstId, output: 'sample' }); assert.equal(sampleRead.kind, 'accepted');
    const methodRead = await act('knowledge', { executionId: firstId, file: 'selection-method.md' }); assert.equal(methodRead.kind, 'accepted');
    assert.equal((await act('write', { executionId: firstId, path: 'entry.py', content: baselineEntry })).kind, 'accepted');
    assert.equal((await act('work', { executionId: firstId })).kind, 'accepted');
    await waitUntil('baseline Workshop settles', () => host.ctx.hima.executionContext(runId!).executions.some(e => e.id === firstId && e.phase === 'ready'));
    assert.equal((await act('complete', { executionId: firstId })).kind, 'accepted');
    await complete('read-selection'); await complete('judge');
    const firstVerdicts = host.ctx.hima.ledger.records({ runId, type: 'verdict' });
    assert.deepEqual(firstVerdicts.map(v => v.type === 'verdict' && v.outcome), ['FAIL', 'PASS']);
    const refine = await act('begin', { nodeId: 'refine' }); const refineId = refine.receipt?.executionId; assert.ok(refineId);
    assert.equal((await act('work', { executionId: refineId })).kind, 'accepted');
    const cites = host.ctx.hima.ledger.records({ runId }).filter(r => r.type === 'observation' || r.type === 'verdict').map(r => r.id);
    assert.equal((await act('complete', { executionId: refineId, decision: 'next-strategy', strategy: { algorithmRevision: 1 }, rationale: 'Measured shared cell u1 requires a disjoint data-dependent selection.', cites })).kind, 'accepted');
    const corrected = `import hashlib,json,pathlib,sys\nw=pathlib.Path(sys.argv[1]); s=json.loads((w/'sample.json').read_text()); used=set(); chosen=[]\nfor c in sorted(s['candidates'],key=lambda x:(-len(x['cells'])*len({o['path'] for o in x['occurrences']}),x['id'])):\n if len(chosen)<s['budget'] and not used.intersection(c['cells']): chosen.append(c['id']); used.update(c['cells'])\n(w/'selection.json').write_text(json.dumps({'sampleSha256':hashlib.sha256((w/'sample.json').read_bytes()).hexdigest(),'selected':chosen}))\n`;
    const second = await act('begin', { nodeId: 'analyze' }); const secondId = second.receipt?.executionId; assert.ok(secondId);
    assert.equal((await act('write', { executionId: secondId, path: 'entry.py', content: corrected })).kind, 'accepted');
    assert.equal((await act('work', { executionId: secondId })).kind, 'accepted');
    await waitUntil('corrected Workshop settles', () => host.ctx.hima.executionContext(runId!).executions.some(e => e.id === secondId && e.phase === 'ready'));
    assert.equal((await act('complete', { executionId: secondId })).kind, 'accepted');
    await complete('read-selection'); await complete('judge');
    const final = await act('begin', { nodeId: 'refine' }); const finalId = final.receipt?.executionId; assert.ok(finalId);
    assert.equal((await act('work', { executionId: finalId })).kind, 'accepted');
    const finalCites = host.ctx.hima.ledger.records({ runId }).filter(r => (r.type === 'observation' || r.type === 'verdict') && r.generation === 2).map(r => r.id);
    assert.equal((await act('complete', { executionId: finalId, decision: 'goal-met', rationale: 'Second generation has no shared cells and reaches the declared synthetic score.', cites: finalCites })).kind, 'accepted');
    assert.equal(host.ctx.hima.ledger.run(runId)?.status, 'ended-goal-met');
    const code = host.ctx.hima.ledger.records({ runId, type: 'code' });
    assert.equal(code.length, 2, 'both authored algorithm versions remain recorded');
    assert.deepEqual(code.map(record => record.type === 'code' && record.sha256), [
      createHash('sha256').update(baselineEntry).digest('hex'), createHash('sha256').update(corrected).digest('hex'),
    ], 'each CodeRecord names the exact bytes that the Workshop executed');
    assert.ok(host.ctx.hima.ledger.records({ runId, type: 'knowledge' }).length >= 1, 'the successful scoped knowledge read is durable evidence');
  } finally {
    if (runId) await host.ctx.hima.cancelRun(runId);
    await host.dispose(); await home.h.dispose();
  }
});

test('selection reader derives score and physical-cell conflict from the parent sample rather than model fields', async (t) => {
  const f = await fixture(t);
  await writeFile(f.report, JSON.stringify({ sampleSha256: f.digest, selected: ['a', 'b'] }));
  const result = spawnSync('/usr/bin/python3', [reader, f.report, f.out], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(await readFile(f.out, 'utf8')).values, [
    { type: 'selection_score', unit: 'count', value: 4 },
    { type: 'selected_count', unit: 'count', value: 2 },
    { type: 'conflict_count', unit: 'count', value: 1 },
  ]);
});

for (const selection of [
  { sampleSha256: 'wrong', selected: [] },
  { sampleSha256: '', selected: ['a', 'a'] },
  { sampleSha256: '', selected: ['missing'] },
  { sampleSha256: '', selected: ['a', 'b', 'c'] },
  { sampleSha256: '', selected: [], inventedScore: 999 },
]) {
  test(`selection reader refuses structural input ${JSON.stringify(selection)}`, async (t) => {
    const f = await fixture(t);
    const value = { ...selection, sampleSha256: selection.sampleSha256 || f.digest };
    await writeFile(f.report, JSON.stringify(value));
    const result = spawnSync('/usr/bin/python3', [reader, f.report, f.out], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    await assert.rejects(readFile(f.out), { code: 'ENOENT' });
  });
}


test('distinct physical cells may share a master, but occurrence indexing and ordered provenance must match exactly', async (t) => {
  const f = await fixture(t);
  f.sample.candidates[1]!.masters = ['M1', 'M1'];
  f.sample.paths[2]!.points[1]!.master = 'M1';
  await writeFile(f.samplePath, JSON.stringify(f.sample));
  const digest = createHash('sha256').update(await readFile(f.samplePath)).digest('hex');
  await writeFile(f.report, JSON.stringify({ sampleSha256: digest, selected: ['b'] }));
  const valid = spawnSync('/usr/bin/python3', [reader, f.report, f.out], { encoding: 'utf8' });
  assert.equal(valid.status, 0, valid.stderr);
  assert.equal(JSON.parse(await readFile(f.out, 'utf8')).values[0].value, 2);
  for (const [i, occurrence] of [
    { path: 'p3', begin: 1, sourceLines: [30, 31] },
    { path: 'p3', begin: 0, sourceLines: [31, 30] },
    { path: 'p3', begin: 0, sourceLines: [30] },
  ].entries()) {
    const changed = structuredClone(f.sample);
    changed.candidates[1]!.occurrences = [occurrence];
    await writeFile(f.samplePath, JSON.stringify(changed));
    const hash = createHash('sha256').update(await readFile(f.samplePath)).digest('hex');
    await writeFile(f.report, JSON.stringify({ sampleSha256: hash, selected: ['b'] }));
    const output = f.out + '.bad-' + i;
    const invalid = spawnSync('/usr/bin/python3', [reader, f.report, output], { encoding: 'utf8' });
    assert.notEqual(invalid.status, 0); await assert.rejects(readFile(output), { code: 'ENOENT' });
  }
});
