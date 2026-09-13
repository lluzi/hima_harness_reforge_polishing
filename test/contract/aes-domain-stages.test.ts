import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { aesDomainPack, createAesDomainFixture, sha256, writeSyntheticStageRecord } from './support/aes-domain-fixture.ts';
import { readingDocument, semanticValue } from '../../packages/harness/src/semantics.ts';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const stages = path.join(repoRoot, 'packs/aes-tsmc28-dtco/flow/stages.py');

function parseReading(text: string): { values: unknown[] } {
  const document = readingDocument.parse(JSON.parse(text));
  semanticValue.array().parse(document.values);
  return document;
}

test('library liveness queries use qualified leaf names and collection cardinality', async () => {
  const shared = await readFile(path.join(aesDomainPack, 'flow/domain/shared_synth.tcl'), 'utf8');
  const init = await readFile(path.join(aesDomainPack, 'flow/domain/init.tcl.tmpl'), 'utf8');
  assert.match(shared, /get_lib_cells -quiet \*\/\$_xs_pattern/);
  assert.match(shared, /sizeof_collection \$_xs_generated/);
  assert.match(init, /get_lib_cells -quiet \*\/@@GENERATED_LIB_CELL_PATTERN@@/);
  assert.match(init, /sizeof_collection \$_xs_libcells/);
});

test('DC version identity accepts the observed indented header and rejects ambiguity', () => {
  const moduleDir = path.join(aesDomainPack, 'flow');
  const code = 'import json,sys; sys.path.insert(0, sys.argv[1]); from stages import dc_version; print(json.dumps(dc_version(sys.stdin.read()), sort_keys=True))';
  const actual = '               Version X-2025.06-SP3 for linux64 - Oct 16, 2025 \n';
  const parsed = spawnSync('/usr/bin/python3', ['-c', code, moduleDir], { input: actual, encoding: 'utf8' });
  assert.equal(parsed.status, 0, parsed.stderr);
  assert.deepEqual(JSON.parse(parsed.stdout), { build:'Oct 16, 2025', platform:'linux64', version:'X-2025.06-SP3' });
  const ambiguous = spawnSync('/usr/bin/python3', ['-c', code, moduleDir], { input: actual + actual, encoding: 'utf8' });
  assert.notEqual(ambiguous.status, 0);
});

test('merge records a rejected stage when the six route evidence set is incomplete', async (t) => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'aes-domain-merge-'));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  await mkdir(path.join(workspace, 'flow/mining'), { recursive: true });
  await writeFile(path.join(workspace, 'flow/inputs.json'), JSON.stringify({
    evidenceClass: 'synthetic-fixture',
    design: 'aes_cipher_top', rtlGlob: '/synthetic/unused/*.v', foundryDb: '/synthetic/unused.db',
    edaWrapper: '/synthetic/unused-wrapper', legacy: { MAX_CELLS: 2 },
  }));

  const ran = spawnSync('/usr/bin/python3', [stages, 'merge', workspace], { encoding: 'utf8' });
  assert.equal(ran.status, 2, ran.stderr);
  const record = JSON.parse(await readFile(path.join(workspace, 'flow/records/merge.json'), 'utf8'));
  assert.equal(record.schema, 'aes-dtco-stage/1');
  assert.equal(record.stage, 'merge');
  assert.equal(record.status, 'rejected');
  assert.match(record.facts.rejected_reason, /six route/i);
  assert.deepEqual(record.artifacts, []);
  assert.deepEqual(record.executions, []);
});

test('paired synthesis, PnR, verification and comparison derive post-route facts from held synthetic reports', async (t) => {
  const fixture = await createAesDomainFixture();
  t.after(() => fixture.dispose());
  const flow = path.join(fixture.workspace, 'flow');
  const generatedLib = path.join(flow, 'fixture-generated.lib');
  await writeFile(generatedLib, '/* MODELLED, NOT MEASURED -- SYNTHETIC FIXTURE */\nlibrary (synthetic_generated) {\n  cell (XS_FIX_ZN) { pin(A) { direction : input; } pin(Z) { direction : output; function : "A"; } }\n}\n');
  await writeSyntheticStageRecord(fixture.workspace, 'characterize', [
    { role: 'generated_liberty', path: generatedLib, sourceType: 'learned-model-prediction' },
  ], { predicted_cell_count: 1, measured_characterization: false });

  const compiled = fixture.run('compile');
  assert.equal(compiled.status, 0, compiled.stderr);
  for (const stage of ['foundry-synth', 'custom-synth']) {
    const ran = fixture.run(stage); assert.equal(ran.status, 0, `${stage}: ${ran.stderr}`);
  }
  const abstractDir = path.join(flow, 'fixture-abstract');
  await mkdir(abstractDir, { recursive: true });
  const lef = path.join(abstractDir, 'XS_FIX_ZN.lef');
  const meta = path.join(abstractDir, 'XS_FIX_ZN.abstract.json');
  await writeFile(lef, 'VERSION 5.7 ;\nMACRO XS_FIX_ZN\n  CLASS CORE ;\nEND XS_FIX_ZN\nEND LIBRARY\n');
  await writeFile(meta, '{"cell":"XS_FIX_ZN","routing_complete":false}\n');
  await writeSyntheticStageRecord(fixture.workspace, 'layout', [
    { role: 'abstract_lef:XS_FIX_ZN', path: lef }, { role: 'abstract_metadata:XS_FIX_ZN', path: meta },
  ], { abstract_cell_count: 1 });
  for (const stage of ['pnr-foundry', 'pnr-generated', 'verify', 'adoption', 'compare']) {
    const ran = fixture.run(stage); assert.equal(ran.status, 0, `${stage}: ${ran.stderr}`);
  }
  const comparison = JSON.parse(await readFile(path.join(flow, 'records/compare.json'), 'utf8'));
  const conditionEvidence = async (stage: string) => {
    const record = JSON.parse(await readFile(path.join(flow, `records/${stage}.json`), 'utf8'));
    const ref = record.artifacts.find((item: { role: string }) => item.role === 'common_condition_identity');
    return JSON.parse(await readFile(path.join(fixture.workspace, ref.path), 'utf8'));
  };
  const conditionDiagnostic = JSON.stringify({
    foundrySynth: await conditionEvidence('foundry-synth'), customSynth: await conditionEvidence('custom-synth'),
    foundryPnr: await conditionEvidence('pnr-foundry'), generatedPnr: await conditionEvidence('pnr-generated'),
  });
  assert.deepEqual({
    clock: comparison.facts.clock_period, setup: comparison.facts.setup_wns,
    delta: comparison.facts.setup_wns_delta, failures: comparison.facts.full_constraint_failures,
  }, { clock: 0.5, setup: 0.02, delta: 0.01, failures: 0 }, conditionDiagnostic);
  const read = fixture.read(path.join(flow, 'records/compare.json'), 'compare');
  assert.equal(read.run.status, 0, read.run.stderr);
  const values = parseReading(await readFile(read.out, 'utf8')).values as { type: string; value: number }[];
  assert.equal(values.find((item) => item.type === 'setup_wns')!.value, 0.02);
  assert.equal(values.find((item) => item.type === 'full_constraint_failures')!.value, 0);

  await writeFile(path.join(flow, 'synthetic-custom-input-delay'), 'same clock, different input delay\n');
  assert.equal(fixture.run('custom-synth').status, 0);
  assert.equal(fixture.run('pnr-generated').status, 0);
  assert.equal(fixture.run('compare').status, 0);
  const delayMismatch = JSON.parse(await readFile(path.join(flow, 'records/compare.json'), 'utf8'));
  assert.equal(delayMismatch.facts.clock_period, 0.5);
  assert.equal(delayMismatch.facts.matched_conditions, false);
  assert.equal(delayMismatch.facts.full_constraint_failures, 1);
  const delayReading = fixture.read(path.join(flow, 'records/compare.json'), 'compare');
  assert.equal(delayReading.run.status, 0, delayReading.run.stderr);
  const delayValues = parseReading(await readFile(delayReading.out, 'utf8')).values as { type: string; value: number }[];
  assert.equal(delayValues.find((item) => item.type === 'matched_conditions')!.value, 0);
  await rm(path.join(flow, 'synthetic-custom-input-delay'));
  assert.equal(fixture.run('custom-synth').status, 0, 'restore the matching generated-arm SDC');
  assert.equal(fixture.run('pnr-generated').status, 0, 'restore PnR with the matching generated-arm SDC');

  const qrc = String((fixture.inputs.legacy as Record<string, unknown>).FOUNDRY_QRC_TECH);
  await writeFile(qrc, 'SYNTHETIC QRC CHANGED BETWEEN ARMS\n');
  assert.equal(fixture.run('pnr-generated').status, 0);
  assert.equal(fixture.run('compare').status, 0);
  const qrcMismatch = JSON.parse(await readFile(path.join(flow, 'records/compare.json'), 'utf8'));
  assert.equal(qrcMismatch.facts.matched_conditions, false);
  assert.equal(qrcMismatch.facts.full_constraint_failures, 1);
  const qrcReading = fixture.read(path.join(flow, 'records/compare.json'), 'compare');
  assert.equal(qrcReading.run.status, 0, qrcReading.run.stderr);
  const qrcValues = parseReading(await readFile(qrcReading.out, 'utf8')).values as { type: string; value: number }[];
  assert.equal(qrcValues.find((item) => item.type === 'matched_conditions')!.value, 0);
  const qrcFoundry = (await conditionEvidence('pnr-foundry')).commonInputs
    .find((item: { role: string }) => item.role === 'FOUNDRY_QRC_TECH').sha256;
  const qrcGenerated = (await conditionEvidence('pnr-generated')).commonInputs
    .find((item: { role: string }) => item.role === 'FOUNDRY_QRC_TECH').sha256;
  assert.notEqual(qrcFoundry, qrcGenerated, 'same QRC path with changed bytes is not a matched condition');

  assert.equal(fixture.run('pnr-foundry').status, 0, 'refresh the control on the changed synthetic QRC');
  await writeFile(path.join(flow, 'synthetic-innovus-version-mismatch'), 'synthetic counterexample\n');
  assert.equal(fixture.run('pnr-generated').status, 0);
  assert.equal(fixture.run('compare').status, 0);
  const versionMismatch = JSON.parse(await readFile(path.join(flow, 'records/compare.json'), 'utf8'));
  assert.equal(versionMismatch.facts.matched_conditions, false);
  assert.notDeepEqual((await conditionEvidence('pnr-foundry')).tool,
    (await conditionEvidence('pnr-generated')).tool, 'raw Innovus version headers differ');
  await rm(path.join(flow, 'synthetic-innovus-version-mismatch'));
  assert.equal(fixture.run('pnr-generated').status, 0, 'restore the matched synthetic tool version');

  await writeFile(path.join(flow, 'synthetic-changed-actual-clock'), 'synthetic counterexample\n');
  const changedPnr = fixture.run('pnr-generated');
  assert.equal(changedPnr.status, 0, changedPnr.stderr);
  const changedPnrReading = fixture.read(path.join(flow, 'records/pnr-generated.json'), 'pnr-generated');
  assert.notEqual(changedPnrReading.run.status, 0, 'the PnR reader must reject an exported clock that differs from its input SDC');
  const changedCompare = fixture.run('compare');
  assert.equal(changedCompare.status, 0, changedCompare.stderr);
  const changedRecord = JSON.parse(await readFile(path.join(flow, 'records/compare.json'), 'utf8'));
  assert.equal(changedRecord.facts.full_constraint_failures, null);
  assert.match(changedRecord.facts.unknownReason.join('; '), /actual post-route clock differs/);
  const changedReading = fixture.read(path.join(flow, 'records/compare.json'), 'compare');
  assert.equal(changedReading.run.status, 0, changedReading.run.stderr);
  assert.ok((parseReading(await readFile(changedReading.out, 'utf8')).values as { value: number | null }[])
    .every((value) => value.value === null));

  await rm(path.join(flow, 'synthetic-changed-actual-clock'));
  await writeFile(path.join(flow, 'synthetic-missing-actual-clock'), 'synthetic counterexample\n');
  const missingPnr = fixture.run('pnr-generated');
  assert.equal(missingPnr.status, 2, missingPnr.stderr);
  const missingRecord = JSON.parse(await readFile(path.join(flow, 'records/pnr-generated.json'), 'utf8'));
  assert.equal(missingRecord.status, 'rejected');
  assert.match(missingRecord.facts.rejected_reason, /postroute_sdc is missing/);
});

test('mine reruns retain immutable raw evidence and the selection reader checks its executed code identity', async (t) => {
  const fixture = await createAesDomainFixture();
  t.after(() => fixture.dispose());
  const flow = path.join(fixture.workspace, 'flow');
  const trial = path.join(flow, 'probes/trial-fixture');
  await mkdir(trial, { recursive: true });
  const source = String((fixture.inputs as { rtlGlob: string }).rtlGlob).replace('*.v', 'aes.v');
  const netlist = path.join(trial, 'netlist.v');
  const rawNetlist = await readFile(source); await writeFile(netlist, rawNetlist);
  await writeFile(path.join(flow, 'probe.json'), JSON.stringify({ format:'aes-probe/2', toolExit:0,
    evidence:{ 'netlist.v':{ path:'probes/trial-fixture/netlist.v', sha256:sha256(rawNetlist) } } }, null, 2) + '\n');

  const first = fixture.run('mine', 'structure_frequency');
  assert.equal(first.status, 0, first.stderr);
  const firstRecord = JSON.parse(await readFile(path.join(flow, 'records/mine-structure_frequency.json'), 'utf8'));
  const firstRaw = path.join(fixture.workspace, firstRecord.artifacts.find((item: { role: string }) => item.role === 'mining_raw').path);
  const firstBytes = await readFile(firstRaw);
  await fixture.select('structure_frequency', []);
  const selected = path.join(flow, 'mining/structure_frequency/selected.json');
  const read = fixture.read(selected, 'select-structure-frequency');
  assert.equal(read.run.status, 0, read.run.stderr);
  assert.equal((parseReading(await readFile(read.out, 'utf8')).values[0] as { value: number }).value, 0);

  const second = fixture.run('mine', 'structure_frequency');
  assert.equal(second.status, 0, second.stderr);
  const secondRecord = JSON.parse(await readFile(path.join(flow, 'records/mine-structure_frequency.json'), 'utf8'));
  const secondRaw = path.join(fixture.workspace, secondRecord.artifacts.find((item: { role: string }) => item.role === 'mining_raw').path);
  assert.notEqual(firstRaw, secondRaw);
  assert.equal(sha256(await readFile(firstRaw)), sha256(firstBytes));
  assert.equal(JSON.parse(await readFile(path.join(path.dirname(firstRaw), 'record.json'), 'utf8')).stage, 'mine-structure_frequency');
});

test('layout runs the production abstract generator with a synthetic external placement boundary', async (t) => {
  const fixture = await createAesDomainFixture();
  t.after(() => fixture.dispose());
  const cell = path.join(fixture.workspace, 'flow/fixture-cell/XS_FIX_ZN.sp');
  await mkdir(path.dirname(cell), { recursive: true });
  await writeFile(cell, '.subckt XS_FIX_ZN A Z vdd gnd\nMp0 Z A vdd vdd pmos\nMn0 Z A gnd gnd nmos\n.ends XS_FIX_ZN\n');
  await writeSyntheticStageRecord(fixture.workspace, 'generate', [
    { role: 'generated_spice:XS_FIX_ZN', path: cell, sourceType: 'generated-netlist' },
  ], { generated_cell_count: 1 });
  const ran = fixture.run('layout');
  let diagnostic = ran.stderr;
  if (ran.status !== 0) {
    const failed = JSON.parse(await readFile(path.join(fixture.workspace, 'flow/records/layout.json'), 'utf8'));
    const log = failed.executions[0]?.log?.path;
    if (log) diagnostic += await readFile(path.join(fixture.workspace, log), 'utf8');
  }
  assert.equal(ran.status, 0, diagnostic);
  const report = path.join(fixture.workspace, 'flow/records/layout.json');
  const read = fixture.read(report, 'layout');
  assert.equal(read.run.status, 0, read.run.stderr);
  assert.equal((parseReading(await readFile(read.out, 'utf8')).values[0] as { value: number }).value, 1);
});

test('Library Compiler error text is a tool failure even when a stale-looking DB and completion markers exist', async (t) => {
  const fixture = await createAesDomainFixture();
  t.after(() => fixture.dispose());
  const flow = path.join(fixture.workspace, 'flow');
  const liberty = path.join(flow, 'fixture-generated.lib');
  await writeFile(liberty, '/* MODELLED, NOT MEASURED -- SYNTHETIC FIXTURE */\nlibrary (fixture) {\n cell (XS_FIX_ZN) {}\n}\n');
  await writeSyntheticStageRecord(fixture.workspace, 'characterize', [
    { role: 'generated_liberty', path: liberty, sourceType: 'learned-model-prediction' },
  ]);
  await writeFile(path.join(flow, 'synthetic-lc-error'), 'synthetic fixture control\n');
  const ran = fixture.run('compile');
  assert.equal(ran.status, 3, ran.stderr);
  const record = JSON.parse(await readFile(path.join(flow, 'records/compile.json'), 'utf8'));
  assert.equal(record.status, 'tool-failure');
  assert.equal(record.facts.lc_accepted, undefined);
  assert.equal(record.executions[0].exitCode, 0, 'the result is rejected from raw LC error text, not exit status');
});

test('comparison preserves missing post-route evidence as nine explicit unknown values', async (t) => {
  const fixture = await createAesDomainFixture();
  t.after(() => fixture.dispose());
  const ran = fixture.run('compare');
  assert.equal(ran.status, 0, ran.stderr);
  const report = path.join(fixture.workspace, 'flow/records/compare.json');
  const reading = fixture.read(report, 'compare');
  assert.equal(reading.run.status, 0, reading.run.stderr);
  const values = parseReading(await readFile(reading.out, 'utf8')).values as
    { type: string; value: null; unknownReason: string }[];
  assert.equal(values.length, 9);
  assert.ok(values.every((value) => value.value === null && value.unknownReason.includes('cannot read')));
});
