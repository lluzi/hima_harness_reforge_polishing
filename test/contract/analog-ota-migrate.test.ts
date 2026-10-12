// The analog-ota-migrate Pack without a simulator: load and stage, plain words, the two resident
// agents, the graph (source judge, migration, round record, the round loop), the strip, argv
// bindings, and the fit against a local Site that binds what the Pack needs.
//
// The simulator-backed steps are in analog-ota-migrate-sim.test.ts (group analog-sim).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkPack, choose, loadPack, loadSite, packStageOf, resolveChooser } from '@hima/harness';
import { repoRoot } from './support/dsh-home.ts';

const packId = 'analog-ota-migrate';
const packsDir = path.join(repoRoot, 'packs');
const packDir = path.join(packsDir, packId);
const HARNESS_ARGV = new Set(['WORKSPACE', 'FLOW_ROOT', 'DESIGN', 'CAMPAIGN']);
const AGENTS = [
  ['size-agent', 'designSource', ['analog-flow.md', 'gmid-sizing-playbook.md', 'design-format.md', 'evidence-and-claims.md']],
  ['migrate-agent', 'designTarget', ['analog-flow.md', 'migration-playbook.md', 'gmid-sizing-playbook.md', 'design-format.md', 'evidence-and-claims.md']],
] as const;

test('the Pack loads at stage compiled with a spec-sheet Goal, a before-and-after table and two resident agents', () => {
  const pack = loadPack(packsDir, packId);
  assert.equal(pack.contract.version, '0.1.0');
  assert.equal(pack.graph.version, pack.contract.version);
  assert.equal(packStageOf(packsDir, packId)?.stage, 'compiled');
  assert.deepEqual(pack.contract.reports, { dir: 'reports' });
  assert.deepEqual(pack.contract.tools.map((t) => t.id), ['bind-inputs', 'characterize', 'size-agent', 'simulate-source', 'migrate-agent',
    'simulate-target', 'record-round']);
  for (const tool of pack.contract.tools) {
    assert.ok((pack.contract.workspace.copy ?? []).includes(path.relative('flow', tool.file)), `${tool.id} file is copied`);
    assert.ok(existsSync(path.join(packDir, tool.file)));
  }
  assert.deepEqual(pack.contract.workspace.copy, ['ota_cli.py', 'pdks.json']);
  for (const [id, produces, knowledge] of AGENTS) {
    const tool = pack.contract.tools.find((t) => t.id === id)!;
    assert.equal(tool.outsourcing?.role, 'resident-engineering-agent');
    assert.equal(tool.outsourcing?.produces, produces);
    assert.equal(tool.outsourcing?.artifactPrefix, `reports/${id}`);
    assert.deepEqual(tool.outsourcing?.knowledge, knowledge);
    assert.equal(pack.contract.outputs.find((o) => o.name === produces)?.reader, 'ota-design');
    for (const file of knowledge) assert.ok(existsSync(path.join(packDir, 'knowledge', file)), `${id} knowledge ${file}`);
    assert.match(tool.description ?? '', /ota_cli\.py precheck <campaign>/, `${id} prechecks its delivery`);
    assert.match(tool.description ?? '', /Never type a performance number/, `${id} never types a number`);
  }
  // The spec sheet is the Goal; load and common mode are the testbench's conditions.
  assert.deepEqual(Object.fromEntries(Object.entries(pack.contract.goal ?? {}).map(([k, v]) => [k, v.default])),
    { min_gain_db: 60, min_gbw_mhz: 10, min_pm_deg: 60, max_power_uw: 200 });
  assert.deepEqual(Object.keys(pack.contract.strategy ?? {}), ['loadPf', 'inputCmPct', 'roundRevision']);
  assert.equal(pack.contract.results?.headline?.type, 'target_margin_pct');
  assert.deepEqual(pack.contract.results?.columns.map((c) => c.reader), ['ota-source', 'ota-round']);
  assert.deepEqual(pack.contract.results?.rows.map((r) => r.type), ['gain_db', 'gbw_mhz', 'pm_deg', 'power_uw', 'area_um2']);
  const shown: string[] = [pack.contract.title, ...Object.values(pack.contract.words).map((w) => w.label)];
  for (const node of pack.graph.nodes) {
    assert.ok(node.label && node.label.length <= 40, `${node.id} has a plain label`);
    assert.ok(node.about && node.about.length <= 240, `${node.id} has a one-line about`);
    assert.doesNotMatch(`${node.label} ${node.about}`, /\b(arm|campaign|judge|gen)\b/i, `${node.id} words are designer words`);
    shown.push(node.label!, node.about!);
  }
  for (const entry of pack.graph.autopilot) if ('from' in entry) { assert.ok(entry.label && entry.about, 'every segment has words'); shown.push(entry.label!, entry.about!); }
  for (const station of pack.graph.view!.stations) shown.push(station.label, station.about ?? '', ...station.checklist.map((line) => line.label));
  for (const text of shown) assert.doesNotMatch(text, /mock|synthetic/i, `the App shows no "mock" or "synthetic": ${text}`);
});

test('the graph judges the source before migrating, records every round and loops back to the sizing agent', () => {
  const pack = loadPack(packsDir, packId);
  const out = (from: string) => pack.graph.edges.filter((e) => e.from === from).map((e) => [e.to, e.outcome ?? null, e.revisit ?? false]);
  const node = (id: string) => pack.graph.nodes.find((n) => n.id === id);
  assert.deepEqual(out('check-tables'), [['size-agent', 'PASS', false], ['blocked', 'FAIL', false], ['blocked', 'UNDETERMINED', false]]);
  assert.deepEqual(out('size-agent'), [['simulate-source', null, false]]);
  assert.deepEqual(out('check-source'), [['migrate-agent', 'PASS', false], ['record-round', 'FAIL', false], ['record-round', 'UNDETERMINED', false]]);
  assert.deepEqual(out('migrate-agent'), [['simulate-target', null, false]]);
  assert.deepEqual(out('simulate-target'), [['record-round', null, false]]);
  assert.deepEqual(out('next-round'), [['size-agent', null, true]]);
  const source = node('check-source');
  assert.ok(source?.kind === 'judge');
  // A judge takes its edge from its FIRST rule; a chooser weighs its first two (constraint, goal).
  assert.deepEqual(source.parameters.rules, ['source-meets-spec', 'devices-saturated', 'gain-spec', 'gbw-spec', 'pm-spec', 'power-spec']);
  const round = node('judge-round');
  assert.ok(round?.kind === 'judge');
  assert.deepEqual(round.parameters.rules, ['round-valid', 'target-margin', 'gain-spec', 'gbw-spec', 'pm-spec', 'power-spec']);
  for (const judge of [source, round]) {
    assert.deepEqual(Object.keys(judge.parameters.bind ?? {}).sort(), ['max_power_uw', 'min_gain_db', 'min_gbw_mhz', 'min_pm_deg']);
  }
  const next = node('next-round');
  assert.ok(next?.kind === 'explore');
  assert.equal(next.parameters.converge?.generationLimit, 3);
  assert.equal(next.parameters.converge?.read, 'bestMargin');
  // The agents are never inside a segment: the owner drives both resident nodes.
  const segments = pack.graph.autopilot.flatMap((entry) => ('from' in entry ? [[entry.from, entry.until]] : []));
  assert.deepEqual(segments, [
    [['bind-inputs'], ['size-agent', 'blocked']],
    [['simulate-source'], ['migrate-agent', 'record-round', 'blocked']],
    [['simulate-target'], ['record-round', 'blocked']],
    [['record-round'], ['next-round', 'blocked']],
  ]);
});

test('the strip places every node once: the simulator on top, the two agents side by side', () => {
  const pack = loadPack(packsDir, packId);
  const view = pack.graph.view!;
  assert.deepEqual(view.stations.map((s) => [s.id, s.row]), [['simulator', 0], ['sizing', 1], ['migration', 1]]);
  const placed = [...view.stations.flatMap((s) => s.checklist.flatMap((line) => line.nodes)), ...view.hidden].sort();
  assert.deepEqual(placed, pack.graph.nodes.map((n) => n.id).sort(), 'every node in exactly one place');
});

test('every ${NAME} in a tool argv is bound by the contract or the harness', () => {
  const pack = loadPack(packsDir, packId);
  const bound = new Map<string, Record<string, unknown>>();
  for (const node of pack.graph.nodes) if (node.kind === 'act' && node.parameters.tool) bound.set(node.parameters.tool, node.parameters.arguments);
  for (const tool of pack.contract.tools) {
    for (const word of tool.argv) for (const m of word.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g)) assert.ok(tool.inputs.includes(m[1]!), `${tool.id}: ${m[1]}`);
    for (const name of tool.inputs) if (!HARNESS_ARGV.has(name)) assert.ok(Object.hasOwn(bound.get(tool.id) ?? {}, name), `${tool.id} input ${name} is bound`);
  }
});

test('a local Site binding the simulator, the PDK root and both PDKs fits the Pack; one without a PDK does not', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'analog-site-'));
  try {
    const sitesDir = path.join(root, 'sites');
    const workspace = path.join(root, 'workspace');
    const pdkRoot = path.join(repoRoot, 'test/fixtures/analog-pdks');
    await Promise.all([mkdir(sitesDir, { recursive: true }), mkdir(workspace, { recursive: true })]);
    await writeFile(path.join(sitesDir, 'local.permit.yml'), [
      'allowedReadRoots:', `  - ${workspace}`, `  - ${pdkRoot}`,
      'allowedWriteRoots:', `  - ${workspace}`,
      'allowedWrappers:', '  - /usr/bin/python3',
      'forbidden:', '  - deletions', '',
    ].join('\n'));
    const site = (bindings: string[]) => [
      'name: local', 'kind: local', `workspaceRoot: ${workspace}`, 'permit: ./local.permit.yml', 'bindings:', ...bindings,
      `  workspaceRoot: ${workspace}`, 'capacity: { cores: 2, memoryGiB: 2, parallelJobs: 1, licences: {} }', '',
    ].join('\n');
    const all = ['  simulators: spectre=/opt/site/bin/spectre,ngspice=/opt/site/bin/ngspice', `  pdkRoot: ${pdkRoot}`, '  sourcePdk: synth180', '  targetPdk: synth130',
      `  engineeringCapabilities: ${path.join(root, 'capabilities.json')}`];
    await writeFile(path.join(sitesDir, 'local.yml'), site(all));
    const fit = checkPack(loadPack(packsDir, packId), loadSite(sitesDir, 'local'));
    assert.equal(fit.fit, true, fit.errors.join('\n'));
    await writeFile(path.join(sitesDir, 'local.yml'), site(all.filter((line) => !line.includes('targetPdk'))));
    const refused = checkPack(loadPack(packsDir, packId), loadSite(sitesDir, 'local'));
    assert.equal(refused.fit, false);
    assert.match(refused.errors.join('\n'), /targetPdk/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------- the Spectre adapter, offline

const spectreFixture = path.join(repoRoot, 'test/fixtures/analog-spectre');

/** Run a few lines of Python against the Pack's ota_cli module; answer its JSON. */
function pack(code: string): any {
  const script = [
    'import importlib.util, json, sys',
    `spec = importlib.util.spec_from_file_location("ota_cli", ${JSON.stringify(path.join(packDir, 'flow/ota_cli.py'))})`,
    'cli = importlib.util.module_from_spec(spec); spec.loader.exec_module(cli)',
    code,
  ].join('\n');
  const run = spawnSync('python3', ['-c', script], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout);
}

test('the Spectre adapter reads PSF ASCII: operating points, supply power and the AC response of the OTA', async () => {
  const facts = pack(`insts = {d: d for d in cli.DEVICES}
f = cli.Spectre.facts(${JSON.stringify(path.join(spectreFixture, 'ota-tt'))}, insts, 1.8)
m = cli.corner_measures(f)
print(json.dumps(dict(power=f["powerW"], ac0=list(f["ac"][0]), points=len(f["ac"]), op=f["op"], m={k: v for k, v in m.items() if k != "devices"})))`);
  // Independent reading of the same files.
  const dc = await readFile(path.join(spectreFixture, 'ota-tt/dcop.dc'), 'utf8');
  const supply = Number(/^"VSUP:p" "I" (\S+)$/m.exec(dc)![1]);
  assert.ok(Math.abs(facts.power - -supply * 1.8) < 1e-15, 'power = -I(VSUP) x 1.8 V');
  const ac = await readFile(path.join(spectreFixture, 'ota-tt/acan.ac'), 'utf8');
  const out0 = /^"out" \((\S+) (\S+)\)$/m.exec(ac)!;
  assert.deepEqual(facts.ac0, [0.1, Number(out0[1]), Number(out0[2])]);
  assert.equal(facts.points, 1 + 40 * 11, '0.1 Hz to 10 GHz at 40 points per decade');
  for (const device of ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8']) {
    const op = facts.op[device];
    assert.ok(op && ['vds', 'vdsat', 'id', 'gm', 'gds'].every((p) => Number.isFinite(op[p])), `${device} operating point`);
  }
  assert.ok(Math.abs(facts.op.M1.id - facts.op.M2.id) / facts.op.M1.id < 0.01, 'the pair splits the tail current');
  const gain = 20 * Math.log10(Math.hypot(Number(out0[1]), Number(out0[2])));
  assert.ok(Math.abs(facts.m.gainDb - gain) < 1e-9);
  assert.ok(facts.m.gbwMhz > 1 && facts.m.gbwMhz < 100 && facts.m.pmDeg > 30 && facts.m.pmDeg < 90, JSON.stringify(facts.m));
  assert.equal(facts.m.saturated, true);
});

test('the Spectre adapter reads a characterization sweep: one row per VGS point, every length', () => {
  const rows = pack(`rows = cli.Spectre.sweep_rows(${JSON.stringify(path.join(spectreFixture, 'sweep/sw.dc'))}, ["MC%d" % i for i in range(5)])
print(json.dumps(rows))`);
  assert.equal(rows.length, 61, 'VGS 0 to 1.2 V in 60 steps');
  assert.equal(rows[0].vgs, 0);
  assert.ok(Math.abs(rows.at(-1).vgs - 1.2) < 1e-9);
  for (const row of rows) assert.equal(row.devices.length, 5);
  // Longer devices carry less current at the same bias.
  const last = rows.at(-1).devices.map((d: any) => d.id);
  for (let i = 1; i < last.length; i += 1) assert.ok(last[i] < last[i - 1], `L${i} below L${i - 1}`);
});

test('the AC arithmetic finds gain, unity-gain frequency and phase margin of a known two-pole response', () => {
  // H(s) = A / ((1 + s/p1)(1 + s/p2)), A = 1000, p1 = 2 pi 10 kHz, p2 = 2 pi 20 MHz.
  const m = pack(`import math, cmath
A, p1, p2 = 1000.0, 1e4, 2e7
ac = []
for i in range(0, 441):
    f = 0.1 * 10 ** (i / 40.0)
    h = A / ((1 + 1j * f / p1) * (1 + 1j * f / p2))
    ac.append((f, h.real, h.imag))
print(json.dumps(cli.ac_measures(ac)))`);
  // Independent closed form: |H| = 1 where (1 + (f/p1)^2)(1 + (f/p2)^2) = A^2.
  let lo = 1e6, hi = 1e9;
  for (let i = 0; i < 200; i += 1) { const f = Math.sqrt(lo * hi); if ((1 + (f / 1e4) ** 2) * (1 + (f / 2e7) ** 2) > 1e6) hi = f; else lo = f; }
  const ugf = Math.sqrt(lo * hi);
  const pm = 180 - (Math.atan(ugf / 1e4) + Math.atan(ugf / 2e7)) * 180 / Math.PI;
  assert.ok(Math.abs(m[0] - 60) < 1e-6, `gain ${m[0]}`);
  assert.ok(Math.abs(m[1] - ugf / 1e6) / (ugf / 1e6) < 0.002, `ugf ${m[1]} vs ${ugf / 1e6}`);
  assert.ok(Math.abs(m[2] - pm) < 0.2, `pm ${m[2]} vs ${pm}`);
});

test('the next-round chooser ends only on a valid round whose migrated OTA meets every line, and otherwise asks for another round', () => {
  const pack = loadPack(packsDir, packId);
  const chooser = resolveChooser(pack, 'ota-next', 'the round').chooser;
  const verdict = (ruleId: string, outcome: 'PASS' | 'FAIL' | 'UNDETERMINED') => ({ ruleId, outcome }) as any;
  const observation = (best: number) => ({ id: 'round', values: [{ type: 'best_margin_pct', unit: 'percent', value: best }] }) as any;
  const base = { bound: { roundStep: 1 }, knobs: pack.contract.strategy, strategy: { loadPf: 2, inputCmPct: 60, roundRevision: 0 } };
  const lines = (outcome: 'PASS' | 'FAIL') => ['gain-spec', 'gbw-spec', 'pm-spec', 'power-spec'].map((id) => verdict(id, outcome));
  // A valid round that meets every line: goal met.
  assert.deepEqual(choose(chooser, { ...base, observation: observation(4.3), constraint: verdict('round-valid', 'PASS'),
    goal: verdict('target-margin', 'PASS'), verdicts: [verdict('round-valid', 'PASS'), verdict('target-margin', 'PASS'), ...lines('PASS')] }),
  { ok: true, chosen: { goalMet: true }, rationale: { bestMargin: 4.3, roundStep: 1 } });
  // Gain met but another line missed: the composite goal fails, and the chooser asks for another round.
  const missed = choose(chooser, { ...base, observation: observation(-100), constraint: verdict('round-valid', 'PASS'),
    goal: verdict('target-margin', 'FAIL'), verdicts: [verdict('round-valid', 'PASS'), verdict('target-margin', 'FAIL'), verdict('gain-spec', 'PASS')] }) as any;
  assert.equal(missed.ok, true, missed.reason);
  assert.equal(missed.chosen.strategy.roundRevision, 1);
  // An invalid round (the naive port out of saturation) before any valid round: the floor is a number, so the chooser still decides.
  const invalid = choose(chooser, { ...base, observation: observation(-100), constraint: verdict('round-valid', 'FAIL'), goal: verdict('target-margin', 'FAIL') }) as any;
  assert.equal(invalid.ok, true, invalid.reason);
  assert.equal(invalid.chosen.strategy.roundRevision, 1);
  // A round without a migrated OTA (the source missed the spec): the goal is undetermined; another round.
  const undetermined = choose(chooser, { ...base, observation: observation(-100), constraint: verdict('round-valid', 'FAIL'), goal: verdict('target-margin', 'UNDETERMINED') }) as any;
  assert.equal(undetermined.ok, true, undetermined.reason);
  const unknownGoal = choose(chooser, { ...base, observation: observation(-100), constraint: verdict('round-valid', 'PASS'), goal: verdict('target-margin', 'UNDETERMINED') }) as any;
  assert.equal(unknownGoal.ok, true, unknownGoal.reason);
});

test('the PSF reader keeps every struct whatever order Spectre writes them in', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'analog-psf-'));
  try {
    const file = path.join(root, 'op.info');
    await writeFile(file, [
      'HEADER', '"PSFversion" "1.00"', 'TYPE',
      '"capacitor" STRUCT(', '"cap" FLOAT DOUBLE PROP(', '"units" "F"', ')', '"i" FLOAT DOUBLE PROP(', '"units" "A"', ')', ') PROP(', '"key" "inst"', ')',
      '"bsim4" STRUCT(', '"ids" FLOAT DOUBLE PROP(', '"units" "A"', ')', '"vds" FLOAT DOUBLE PROP(', '"units" "V"', ')', ') PROP(', '"key" "inst"', ')',
      'VALUE', '"CL" "capacitor" (', '2e-12', '0', ')', '"M1" "bsim4" (', '3e-06', '0.88', ')', 'END', '',
    ].join('\n'));
    const insts = pack(`_, insts = cli.psf_ascii(${JSON.stringify(file)})
print(json.dumps(insts))`);
    assert.deepEqual(insts, { CL: { cap: 2e-12, i: 0 }, M1: { ids: 3e-6, vds: 0.88 } });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('the AC arithmetic refuses to read a gain or phase margin from a response that is not flat and in phase at the sweep start', () => {
  const m = pack(`ac = []
for i in range(0, 521):
    f = 1e-3 * 10 ** (i / 40.0)
    h_low = 1e6 / (1 + 1j * f / 1e-3)          # first pole at the sweep start
    h_inv = -1000 / (1 + 1j * f / 1e4)         # an inverting response
    ac.append((f, h_low, h_inv))
print(json.dumps([cli.ac_measures([(f, h.real, h.imag) for f, h, _ in ac]), cli.ac_measures([(f, h.real, h.imag) for f, _, h in ac])]))`);
  const [low, inverted] = m;
  assert.equal(low[0], null, 'gain unknown: not flat at the sweep start');
  assert.equal(low[2], null, 'phase margin unknown: not flat at the sweep start');
  assert.ok(low[1] > 0, 'the unity-gain frequency is still where |H| crosses 1');
  assert.ok(Math.abs(inverted[0] - 60) < 1e-6, 'an inverting response still has its gain');
  assert.equal(inverted[2], null, 'phase margin unknown: the response is not in phase');
});
