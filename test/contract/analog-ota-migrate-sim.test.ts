// The analog-ota-migrate Pack's deterministic steps with a real SPICE simulator (group analog-sim).
//
// Two synthetic BSIM4 processes (test/fixtures/analog-pdks: synth180 at 1.8 V, synth130 at 1.2 V,
// made up, no foundry data) stand in for the open PDKs a Site installs. The simulator is ngspice:
// HIMA_NGSPICE or `ngspice` on PATH. Without one every test here is skipped and says so; a skip is
// not a pass.
//
// The expectations are independent of the code under test: the first cut is recomputed from the
// textbook equations, the worst corner from the per-corner numbers, the spec verdicts from the Goal
// defaults. Exact simulator numbers are not asserted (they move with the ngspice version); the
// spec-level outcomes the Pack's story rests on are: the sized source meets the spec, the naive
// port to 1.2 V does not, the re-biased port does.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { himaChart } from '@hima/harness';
import { repoRoot } from './support/dsh-home.ts';

const packDir = path.join(repoRoot, 'packs/analog-ota-migrate');
const pdkRoot = path.join(repoRoot, 'test/fixtures/analog-pdks');
const SPEC = { gainDb: 60, gbwMhz: 10, pmDeg: 60, powerUw: 200 };
const LOAD_PF = '2';
const CM_PCT = '60';

function findNgspice(): string | undefined {
  for (const candidate of [process.env.HIMA_NGSPICE, 'ngspice']) {
    if (!candidate) continue;
    const run = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
    if (run.status === 0 && /ngspice-\d+/.test(run.stdout + run.stderr)) return candidate;
  }
  return undefined;
}
const ngspice = findNgspice();
const skip = ngspice === undefined ? 'no ngspice (set HIMA_NGSPICE or put ngspice on PATH)' : false;

type Json = Record<string, any>;

/** A Campaign workspace with the Pack's flow files copied in, as preparation places them. */
async function workspace(): Promise<{ readonly ws: string; readonly done: () => Promise<void> }> {
  const ws = await mkdtemp(path.join(os.tmpdir(), 'analog-ws-'));
  await mkdir(path.join(ws, 'flow'));
  for (const file of ['ota_cli.py', 'pdks.json']) await cp(path.join(packDir, 'flow', file), path.join(ws, 'flow', file));
  return { ws, done: () => rm(ws, { recursive: true, force: true }) };
}

function ota(ws: string, ...args: string[]): { status: number | null; stdout: string; stderr: string } {
  return spawnSync('python3', [path.join(ws, 'flow/ota_cli.py'), args[0]!, ws, ...args.slice(1)], { encoding: 'utf8', cwd: ws });
}
function ok(ws: string, ...args: string[]): string {
  const run = ota(ws, ...args);
  assert.equal(run.status, 0, `ota ${args.join(' ')}\n${run.stdout}\n${run.stderr}`);
  return run.stdout;
}
let readings = 0;
function reader(script: string, report: string, ws?: string): Json[] {
  readings += 1;
  const out = path.join(os.tmpdir(), `analog-reader-${process.pid}-${readings}.json`);
  const run = spawnSync('python3', [path.join(packDir, 'tools', script), report, out, ...(ws ? [ws] : [])], { encoding: 'utf8' });
  assert.equal(run.status, 0, `${script}: ${run.stderr}`);
  return JSON.parse(spawnSync('cat', [out], { encoding: 'utf8' }).stdout).values;
}
const valueOf = (values: Json[], type: string) => values.find((v) => v.type === type)?.value;
const readJson = async (file: string): Promise<Json> => JSON.parse(await readFile(file, 'utf8'));

/** Deliver a drafted design as the agent would: summary, reason and the analysis report filled. */
async function deliver(ws: string, stage: 'source' | 'target', doc: Json): Promise<string> {
  doc.summary = `${stage} design for the test`;
  doc.reason = 'the gm/Id intent below';
  await mkdir(path.join(ws, path.dirname(doc.report)), { recursive: true });
  await writeFile(path.join(ws, doc.report), '# analysis\n');
  const file = path.join(ws, `${stage}-delivery.json`);
  await writeFile(file, JSON.stringify(doc, null, 2));
  return file;
}
async function accept(ws: string, stage: 'source' | 'target', doc: Json): Promise<void> {
  const file = await deliver(ws, stage, doc);
  ok(ws, 'precheck', stage, file, ws);
  await cp(file, path.join(ws, 'state', `design-${stage}.json`));
  const values = reader('read-design.py', path.join(ws, 'state', `design-${stage}.json`), ws);
  assert.equal(valueOf(values, 'design_valid'), 1);
}

/** The worst corner, recomputed here from the per-corner numbers. */
function worstOf(corners: Json): Json {
  const all = Object.values(corners) as Json[];
  return {
    gainDb: Math.min(...all.map((c) => c.gainDb)), gbwMhz: Math.min(...all.map((c) => c.gbwMhz)),
    pmDeg: Math.min(...all.map((c) => c.pmDeg)), powerUw: Math.max(...all.map((c) => c.powerUw)),
  };
}
const meets = (w: Json) => w.gainDb >= SPEC.gainDb && w.gbwMhz >= SPEC.gbwMhz && w.pmDeg >= SPEC.pmDeg && w.powerUw <= SPEC.powerUw;

const SOURCE_INTENT = { ibiasUa: 10, i1Ua: 4, i6Ua: 50, ccPf: 0.6, rzKohm: 2.0,
  input: { gmId: 15, lUm: 0.5 }, load: { gmId: 10, lUm: 0.5 }, sink: { gmId: 10, lUm: 1.0 } };
const REBIASED_PORT = { ibiasUa: 10, i1Ua: 4, i6Ua: 50, ccPf: 0.8, rzKohm: 2.5,
  input: { gmId: 24, lUm: 0.36 }, load: { gmId: 12, lUm: 0.36 }, sink: { gmId: 22, lUm: 0.72 } };

test('bind and characterize build complete gm/Id curves for both PDKs on the simulator', { skip }, async () => {
  const { ws, done } = await workspace();
  try {
    assert.match(ok(ws, 'bind', `ngspice=${ngspice!}`, pdkRoot, 'synth180', 'synth130'), /ngspice-\d+/);
    const inputs = await readJson(path.join(ws, 'state/inputs.json'));
    assert.deepEqual([inputs.pdks.source.name, inputs.pdks.target.name], ['synth180', 'synth130']);
    assert.ok(inputs.pdks.source.files.every((f: Json) => /^[0-9a-f]{64}$/.test(f.sha256)));
    ok(ws, 'characterize');
    const tables = reader('read-tables.py', path.join(ws, 'state/tables.json'));
    assert.equal(valueOf(tables, 'tables_valid'), 1);
    assert.equal(valueOf(tables, 'tables_curves'), 20, 'two PDKs x two device types x five lengths');
    const source = await readJson(path.join(ws, 'state/tables-source.json'));
    for (const kind of ['nmos', 'pmos']) {
      for (const [length, points] of Object.entries(source.devices[kind].lengths) as [string, Json[]][]) {
        // Physics, not the code: gm/Id falls as the device goes into strong inversion, and stays below
        // the weak-inversion limit 1/(n kT/q) < 40 /V at room temperature.
        const byVgs = [...points].sort((a, b) => a.vgs - b.vgs);
        assert.ok(byVgs.at(-1)!.gmId < byVgs[0]!.gmId, `${kind} L=${length}: gm/Id falls with VGS`);
        assert.ok(Math.max(...points.map((p) => p.gmId)) < 40, `${kind} L=${length}: below the weak-inversion limit`);
      }
    }
    // Wrong PDK and the same PDK twice are refused.
    assert.match(ota(ws, 'bind', `ngspice=${ngspice!}`, pdkRoot, 'synth180', 'nosuch').stderr, /no PDK card for nosuch/);
    assert.match(ota(ws, 'bind', `ngspice=${ngspice!}`, pdkRoot, 'synth180', 'synth180').stderr, /the same/);
  } finally { await done(); }
});

test('the first cut from the spec sheet follows the textbook two-stage equations', { skip }, async () => {
  const { ws, done } = await workspace();
  try {
    ok(ws, 'bind', `ngspice=${ngspice!}`, pdkRoot, 'synth180', 'synth130');
    await writeFile(path.join(ws, 'spec.json'), JSON.stringify({ ...SPEC, loadPf: 2 }));
    const intent = JSON.parse(ok(ws, 'draft', 'intent', path.join(ws, 'spec.json')));
    const cc = 0.3 * 2e-12;
    const gm1 = 2 * Math.PI * 10e6 * cc * 1.25;
    const gm6 = Math.max(2.5 * 2 * Math.PI * 10e6 * 2e-12, 10 * gm1);
    assert.equal(intent.ccPf, 0.6);
    assert.ok(Math.abs(intent.i1Ua - (1e6 * gm1) / 15) < 0.01);
    assert.ok(Math.abs(intent.i6Ua - (1e6 * gm6) / 10) < 0.01);
    assert.ok(Math.abs(intent.rzKohm - 1e-3 / gm6) < 0.001);
    assert.deepEqual([intent.input.lUm, intent.load.lUm, intent.sink.lUm], [0.5, 0.5, 0.5], 'about three times the 0.18 um minimum');
  } finally { await done(); }
});

test('precheck refuses illegal designs and any number an agent types', { skip }, async () => {
  const { ws, done } = await workspace();
  try {
    ok(ws, 'bind', `ngspice=${ngspice!}`, pdkRoot, 'synth180', 'synth130');
    ok(ws, 'characterize');
    await writeFile(path.join(ws, 'intent.json'), JSON.stringify(SOURCE_INTENT));
    const good: Json = JSON.parse(ok(ws, 'draft', 'size', path.join(ws, 'intent.json')));
    const refused = async (change: (d: Json) => void, why: RegExp, stage: 'source' | 'target' = 'source') => {
      const doc = structuredClone(good);
      change(doc);
      const file = await deliver(ws, stage, doc);
      const run = ota(ws, 'precheck', stage, file, ws);
      assert.notEqual(run.status, 0, `refused: ${why}`);
      assert.match(run.stderr, why);
    };
    await refused((d) => { d.devices.M1.lUm = 0.1; d.devices.M2.lUm = 0.1; }, /M1 L=0\.1 um is outside synth180's \[0\.18, 10\] um/);
    await refused((d) => { d.devices.M2.wUm = d.devices.M1.wUm + 1; }, /M1 and M2 are a matched pair/);
    await refused((d) => { d.devices.M5.wUm = 2.355; }, /M5 W=2\.355 um is off the 0\.01 um grid/);
    await refused((d) => { d.gainDb = 70; }, /unknown field\(s\) gainDb/);
    await refused((d) => { d.round = 2; }, /round must be 1/);
    await refused((d) => { delete d.devices.M8; }, /devices must be exactly M1, M2/);
    await refused((d) => { d.ccPf = 50; }, /ccPf must be a number in \[0\.05, 20\]/);
    await refused((d) => { d.stage = 'target'; d.pdk = 'synth130'; }, /migratedFrom must name the accepted source design|no accepted source design/, 'target');
    // The draft itself passes.
    const file = await deliver(ws, 'source', structuredClone(good));
    assert.match(ok(ws, 'precheck', 'source', file, ws), /precheck PASS: source design round 1 \(synth180\)/);
  } finally { await done(); }
});

test('one round: the source meets the spec, the naive port to 1.2 V does not; the next round re-biases and meets it', { skip }, async () => {
  const { ws, done } = await workspace();
  try {
    ok(ws, 'bind', `ngspice=${ngspice!}`, pdkRoot, 'synth180', 'synth130');
    ok(ws, 'characterize');
    // Round 1: the sized source design.
    await writeFile(path.join(ws, 'intent.json'), JSON.stringify(SOURCE_INTENT));
    await accept(ws, 'source', JSON.parse(ok(ws, 'draft', 'size', path.join(ws, 'intent.json'))));
    ok(ws, 'simulate', 'source', LOAD_PF, CM_PCT);
    const source = await readJson(path.join(ws, 'state/measure-source.json'));
    assert.deepEqual(Object.keys(source.corners).sort(), ['ff', 'ss', 'tt']);
    const sourceWorst = worstOf(source.corners);
    for (const key of ['gainDb', 'gbwMhz', 'pmDeg', 'powerUw']) assert.equal(source.worst[key], sourceWorst[key], `worst ${key}`);
    assert.ok(meets(sourceWorst), `the sized source meets the spec: ${JSON.stringify(sourceWorst)}`);
    assert.equal(source.worst.saturated, true);
    // The Reader states the worst corner and nothing else.
    const read = reader('read-measure.py', path.join(ws, 'state/measure-source.json'));
    assert.deepEqual([valueOf(read, 'gain_db'), valueOf(read, 'gbw_mhz'), valueOf(read, 'pm_deg'), valueOf(read, 'power_uw'), valueOf(read, 'saturated')],
      [sourceWorst.gainDb, sourceWorst.gbwMhz, sourceWorst.pmDeg, sourceWorst.powerUw, 1]);
    // Round 1: the naive gm/Id-preserving port.
    const port: Json = JSON.parse(ok(ws, 'draft', 'migrate'));
    assert.equal(port.pdk, 'synth130');
    assert.deepEqual([port.intent.input.lUm, port.intent.load.lUm, port.intent.sink.lUm], [0.36, 0.36, 0.72], 'same multiple of the minimum length');
    await accept(ws, 'target', port);
    ok(ws, 'simulate', 'target', LOAD_PF, CM_PCT);
    const naive = await readJson(path.join(ws, 'state/measure-target.json'));
    assert.ok(!meets(worstOf(naive.corners)) || naive.worst.saturated !== true, 'the naive port misses the spec at 1.2 V');
    ok(ws, 'record', String(SPEC.gainDb), String(SPEC.gbwMhz), String(SPEC.pmDeg), String(SPEC.powerUw));
    const round1 = reader('read-round.py', path.join(ws, 'state/round.json'));
    assert.ok(valueOf(round1, 'round_valid') === 0 || valueOf(round1, 'specs_met') < 4, 'round 1 does not meet the Goal');
    // Round 2: keep the source, re-bias the port.
    await accept(ws, 'source', JSON.parse(ok(ws, 'draft', 'keep')));
    ok(ws, 'simulate', 'source', LOAD_PF, CM_PCT);
    await writeFile(path.join(ws, 'port.json'), JSON.stringify(REBIASED_PORT));
    await accept(ws, 'target', JSON.parse(ok(ws, 'draft', 'migrate', path.join(ws, 'port.json'))));
    ok(ws, 'simulate', 'target', LOAD_PF, CM_PCT);
    const rebiased = await readJson(path.join(ws, 'state/measure-target.json'));
    const targetWorst = worstOf(rebiased.corners);
    assert.ok(meets(targetWorst) && rebiased.worst.saturated === true, `the re-biased port meets the spec: ${JSON.stringify(targetWorst)}`);
    ok(ws, 'record', String(SPEC.gainDb), String(SPEC.gbwMhz), String(SPEC.pmDeg), String(SPEC.powerUw));
    const round2 = reader('read-round.py', path.join(ws, 'state/round.json'));
    assert.equal(valueOf(round2, 'round_valid'), 1);
    assert.equal(valueOf(round2, 'specs_met'), 4);
    const margin = Math.min((targetWorst.gainDb - 60) / 60, (targetWorst.gbwMhz - 10) / 10, (targetWorst.pmDeg - 60) / 60, (200 - targetWorst.powerUw) / 200) * 100;
    assert.ok(Math.abs(valueOf(round2, 'target_margin_pct') - margin) < 0.01, 'the margin is the worst normalized line');
    assert.equal(valueOf(round2, 'best_margin_pct'), valueOf(round2, 'target_margin_pct'));
    assert.equal(valueOf(round2, 'round_improved'), 1);
    assert.equal(valueOf(round2, 'gain_db'), targetWorst.gainDb);
    const lessons = await readJson(path.join(ws, 'state/lessons.json'));
    assert.deepEqual(lessons.rounds.map((r: Json) => [r.round, r.roundValid]), [[1, false], [2, true]]);
    const summary = await readFile(path.join(ws, 'derived/summary.md'), 'utf8');
    assert.match(summary, /\| 2 \| 4 \| 4 \|/);
    assert.match(summary, /not silicon/);
    // Every chart a person sees validates.
    let charts = 0;
    for (const entry of await readdir(path.join(ws, 'reports'), { recursive: true })) {
      if (!String(entry).endsWith('.chart.json')) continue;
      const parsed = himaChart.safeParse(await readJson(path.join(ws, 'reports', String(entry))));
      assert.ok(parsed.success, `${entry}: ${JSON.stringify(parsed.error?.issues)}`);
      charts += 1;
    }
    assert.ok(charts >= 7, `charts: ${charts}`);
  } finally { await done(); }
});

test('a measurement of a design that is not the accepted one makes the round invalid', { skip }, async () => {
  const { ws, done } = await workspace();
  try {
    ok(ws, 'bind', `ngspice=${ngspice!}`, pdkRoot, 'synth180', 'synth130');
    ok(ws, 'characterize');
    await writeFile(path.join(ws, 'intent.json'), JSON.stringify(SOURCE_INTENT));
    await accept(ws, 'source', JSON.parse(ok(ws, 'draft', 'size', path.join(ws, 'intent.json'))));
    ok(ws, 'simulate', 'source', LOAD_PF, CM_PCT);
    await writeFile(path.join(ws, 'port.json'), JSON.stringify(REBIASED_PORT));
    await accept(ws, 'target', JSON.parse(ok(ws, 'draft', 'migrate', path.join(ws, 'port.json'))));
    ok(ws, 'simulate', 'target', LOAD_PF, CM_PCT);
    // The target design changes after it was simulated.
    const target = await readJson(path.join(ws, 'state/design-target.json'));
    target.summary = 'edited after the simulation';
    await writeFile(path.join(ws, 'state/design-target.json'), JSON.stringify(target));
    ok(ws, 'record', String(SPEC.gainDb), String(SPEC.gbwMhz), String(SPEC.pmDeg), String(SPEC.powerUw));
    const round = await readJson(path.join(ws, 'state/round.json'));
    assert.equal(round.roundValid, false);
    assert.match(round.problems.join('; '), /the target measurement is not of the accepted target design/);
  } finally { await done(); }
});

test('ngspice and the committed Spectre output agree on the same OTA at the same corner', { skip }, async () => {
  // The Spectre fixture is the tt corner of SOURCE_INTENT's design on synth180 (load 2 pF, input
  // common mode 60 %). The agents iterate in ngspice; the Site measures with Spectre: the two must
  // tell the same story on the same BSIM4 decks.
  const { ws, done } = await workspace();
  try {
    ok(ws, 'bind', `ngspice=${ngspice!}`, pdkRoot, 'synth180', 'synth130');
    ok(ws, 'characterize');
    await writeFile(path.join(ws, 'intent.json'), JSON.stringify(SOURCE_INTENT));
    await writeFile(path.join(ws, 'd.json'), ok(ws, 'draft', 'size', path.join(ws, 'intent.json')));
    const ng = JSON.parse(ok(ws, 'sim', 'source', path.join(ws, 'd.json'), LOAD_PF, CM_PCT, path.join(ws, 'own'))).corners.tt;
    const netlist = await readFile(path.join(repoRoot, 'test/fixtures/analog-spectre/ota-tt/ota-tt.scs'), 'utf8');
    const design: Json = JSON.parse(await readFile(path.join(ws, 'd.json'), 'utf8'));
    for (const [name, d] of Object.entries(design.devices) as [string, Json][]) {
      assert.match(netlist, new RegExp(`^${name} \\(.*\\) \\w+ w=${d.wUm}u l=${d.lUm}u$`, 'm'), `the fixture is this design's ${name}`);
    }
    const script = [
      'import importlib.util, json',
      `spec = importlib.util.spec_from_file_location("c", ${JSON.stringify(path.join(packDir, 'flow/ota_cli.py'))})`,
      'cli = importlib.util.module_from_spec(spec); spec.loader.exec_module(cli)',
      `m = cli.corner_measures(cli.Spectre.facts(${JSON.stringify(path.join(repoRoot, 'test/fixtures/analog-spectre/ota-tt'))}, {d: d for d in cli.DEVICES}, 1.8))`,
      'print(json.dumps(m))',
    ].join('\n');
    const sp = JSON.parse(spawnSync('python3', ['-c', script], { encoding: 'utf8' }).stdout);
    assert.ok(Math.abs(ng.gainDb - sp.gainDb) < 0.2, `gain ${ng.gainDb} vs ${sp.gainDb}`);
    assert.ok(Math.abs(ng.gbwMhz - sp.gbwMhz) / sp.gbwMhz < 0.02, `GBW ${ng.gbwMhz} vs ${sp.gbwMhz}`);
    assert.ok(Math.abs(ng.pmDeg - sp.pmDeg) < 1, `PM ${ng.pmDeg} vs ${sp.pmDeg}`);
    assert.ok(Math.abs(ng.powerUw - sp.powerUw) / sp.powerUw < 0.02, `power ${ng.powerUw} vs ${sp.powerUw}`);
    assert.equal(ng.saturated, sp.saturated);
  } finally { await done(); }
});
