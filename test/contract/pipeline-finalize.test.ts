// Finalization scope and upgrade provenance; no model/provider, existing Run or customer home.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { finalizationDenial, sameScientificFacts, sameTestClaims, verifyRuntimeUpgrade, type RuntimeUpgrade } from '../../scripts/live-check-pipeline-finalize.ts';
import { sha256 } from '../../scripts/live-check-workshop.ts';
import { createHimaHome } from './support/dsh-home.ts';
import { bootInProcess, createRootAgent } from './support/boot-inprocess.ts';
import { digestTrees } from './support/pipeline.ts';

const run = 'run-00000000-0000-4000-8000-000000000000';
const original = `## Run\n\nrun: ${run} — goal minimum 1; limit 16.\n\n## Ending\n\nstatus: ended-goal-met — observed sum 169; Judge PASS.\n`;
const repaired = original.replace(' — goal', '\n\ngoal').replace(' — observed', '\n\nobserved');

test('scientific facts survive cold-decode key reordering but reject changed budgets readings and record order', () => {
  const before = { runs: [{ id: run, status: 'ended-goal-met', budget: { generationLimit: 1, timeBoxMs: 480000 }, control: { owner: 'same-agent', revision: 17 } }],
    records: [{ id: 'observation', values: [{ type: 'numeric_sum', value: 169 }] }, { id: 'verdict', outcome: 'PASS', cites: ['observation'] }] };
  const decoded = { runs: [{ control: { revision: 17, owner: 'same-agent' }, budget: { timeBoxMs: 480000, generationLimit: 1 }, status: 'ended-goal-met', id: run }],
    records: [{ values: [{ value: 169, type: 'numeric_sum' }], id: 'observation' }, { cites: ['observation'], outcome: 'PASS', id: 'verdict' }] };
  assert.notEqual(JSON.stringify(before), JSON.stringify(decoded), 'the fixture must exercise the actual false-failure pattern');
  assert.equal(sameScientificFacts(decoded, before), true);
  const budget = structuredClone(decoded); budget.runs[0]!.budget.generationLimit = 2;
  assert.equal(sameScientificFacts(budget, before), false);
  const reading = structuredClone(decoded); reading.records[0]!.values![0]!.value = 170;
  assert.equal(sameScientificFacts(reading, before), false);
  assert.equal(sameScientificFacts({ ...decoded, records: [...decoded.records].reverse() }, before), false);
});

test('finalization permits only formatting, preserving numeric and narrative facts', () => {
  assert.equal(sameTestClaims(original, repaired), true);
  assert.equal(sameTestClaims(original, repaired.replace('169', '170')), false);
  assert.equal(sameTestClaims(original, repaired.replace('PASS', 'FAIL')), false);
  assert.equal(sameTestClaims(original, repaired.replace('Judge PASS', 'JudgePASS')), false);
  assert.equal(sameTestClaims(original, repaired + '\nnew unverified conclusion\n'), false);
});

test('actual native tools cannot start a Run or write method/version files during finalization', async () => {
  const h = await createHimaHome(); const host = await bootInProcess(h);
  let phase: 'repair' | 'release' = 'repair'; let requests = 0;
  host.ctx.on('agent/request', () => { requests++; throw new Error('keyless finalization scope test forbids models'); });
  try {
    const author = await createRootAgent(host.ctx, h.workspace);
    writeFileSync(path.join(h.workspace, 'TEST.md'), original);
    host.ctx.tools.guard((execution) => finalizationDenial(execution.name, execution.arguments, h.workspace, original, phase));
    let serial = 0;
    const call = (name: string, args: object) => host.ctx.tools.execute({ name, arguments: args, agent: author, callId: `finalize-${++serial}` as never, signal: AbortSignal.timeout(5000) });
    assert.equal((await call('read', { file_path: 'TEST.md' })).isError, false, 'native edits require an observed file');
    const deniedRun = await call('hima_run', { pack: 'authored-numeric', site: 'local', goal: { minimum: 1 } });
    assert.equal(deniedRun.isError, true);
    assert.match(JSON.stringify(deniedRun), /finalization forbids/);
    for (const file of ['contract.yml', 'VERSION.yml']) assert.equal((await call('write', { file_path: file, content: 'not authorized' })).isError, true);
    assert.equal((await call('write', { file_path: 'TEST.md', content: repaired.replace('169', '170') })).isError, true);
    assert.equal((await call('hima_pack_release', { pack: 'authored-numeric' })).isError, true);
    const edit = await call('edit', { file_path: 'TEST.md', old_string: original, new_string: repaired });
    assert.equal(edit.isError, false, JSON.stringify(edit));
    assert.equal(readFileSync(path.join(h.workspace, 'TEST.md'), 'utf8'), repaired);
    phase = 'release';
    assert.equal((await call('write', { file_path: 'TEST.md', content: repaired })).isError, true);
    assert.equal((await call('hima_run', { pack: 'authored-numeric', site: 'local', goal: { minimum: 1 } })).isError, true);
    assert.equal(host.ctx.hima.ledger.runs().length, 0); assert.equal(requests, 0);
  } finally { await host.dispose(); await h.dispose(); }
});

test('runtime upgrade manifest binds preserved old bytes, current installed bytes and unchanged protected data', async () => {
  const root = realpathSync(mkdtempSync('/tmp/hima-upgrade-test-')); const home = path.join(root, 'home');
  const bundle = path.join(home, 'profiles/hima/node_modules/@hima/harness'); const backupBundle = path.join(root, 'old-bundle');
  mkdirSync(bundle, { recursive: true }); mkdirSync(backupBundle);
  writeFileSync(path.join(bundle, 'runtime.js'), 'corrected schema\n'); writeFileSync(path.join(backupBundle, 'runtime.js'), 'original schema\n');
  const roots = ['hima', 'sessions', 'storages', 'workspace', 'numeric-flow'].map((at) => path.join(home, at));
  roots.forEach((at) => mkdirSync(at, { recursive: true }));
  writeFileSync(path.join(home, 'storages', 'ledger.json'), 'unchanged completed Run\n');
  const protectedHashes = Object.fromEntries(await digestTrees(roots, home + '.excluded'));
  const manifest: RuntimeUpgrade = { kind: 'hima-installed-runtime-upgrade', sourceSha: 'a'.repeat(40), bundle, backupBundle,
    oldHashes: { 'runtime.js': sha256('original schema\n') }, newHashes: { 'runtime.js': sha256('corrected schema\n') }, protectedRoots: roots, protectedBefore: protectedHashes, protectedAfter: protectedHashes };
  try {
    await verifyRuntimeUpgrade(manifest, home, manifest.oldHashes);
    writeFileSync(path.join(home, 'storages', 'ledger.json'), 'changed Run\n');
    await assert.rejects(verifyRuntimeUpgrade(manifest, home, manifest.oldHashes), /protected data changed/);
    writeFileSync(path.join(home, 'storages', 'ledger.json'), 'unchanged completed Run\n');
    writeFileSync(path.join(backupBundle, 'runtime.js'), 'changed original\n');
    await assert.rejects(verifyRuntimeUpgrade(manifest, home, manifest.oldHashes), /preserved old bundle differs/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
