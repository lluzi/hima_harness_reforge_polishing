// The analog-bandgap Pack's flow engine with a real SPICE simulator (group analog-sim).
//
// The synthetic 180 nm-class decks (test/fixtures/analog-pdks/synth180: 3.3 V MOS, a vertical PNP, a
// poly resistor; made up, no foundry data) stand in for the open PDKs a Site installs. The simulator is
// ngspice: HIMA_NGSPICE or `ngspice` on PATH. Without one every test here is skipped and says so; a skip
// is not a pass.
//
// Exact simulator numbers are not asserted beyond what the physics fixes (they move with the ngspice
// version): the PNP's VBE and its slope, a working reference at every corner, the worst corner
// recomputed here from the per-corner numbers, the SHA binding, and ngspice agreeing with the recorded
// Spectre output of the same cell on the same decks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { repoRoot } from './support/dsh-home.ts';

const packDir = path.join(repoRoot, 'packs/analog-bandgap');
const pdkRoot = path.join(repoRoot, 'test/fixtures/analog-pdks');
const fixtures = path.join(repoRoot, 'test/fixtures/analog-bandgap');
const SPEC = { vbgV: 1.2, vbgTolPct: 2, iqMaxUa: 8, isdMaxNa: 2, tcMaxPpm: 100, pmMinDeg: 60, tStartMaxUs: 100, psrrMinDb: 40, ibiasUa: 0.5 };
const SPEC_ARGS = ['1.2', '2', '8', '2', '100', '60', '100', '40'];

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

async function workspace(): Promise<{ readonly ws: string; readonly done: () => Promise<void> }> {
  const ws = await mkdtemp(path.join(os.tmpdir(), 'bandgap-sim-'));
  await mkdir(path.join(ws, 'flow'));
  for (const file of ['bg_cli.py', 'ota_cli.py', 'pdks.json']) await cp(path.join(packDir, 'flow', file), path.join(ws, 'flow', file));
  return { ws, done: () => rm(ws, { recursive: true, force: true }) };
}
function bg(ws: string, ...args: string[]) {
  return spawnSync('python3', ['-B', path.join(ws, 'flow/bg_cli.py'), args[0]!, ws, ...args.slice(1)], { encoding: 'utf8', cwd: ws });
}
function ok(ws: string, ...args: string[]): string {
  const run = bg(ws, ...args);
  assert.equal(run.status, 0, `bg ${args.join(' ')}\n${run.stdout}\n${run.stderr}`);
  return run.stdout;
}
const readJson = async (file: string): Promise<Json> => JSON.parse(await readFile(file, 'utf8'));
const sha256 = async (file: string) => createHash('sha256').update(await readFile(file)).digest('hex');

test('bind and characterize: gm/Id curves, the PNP\'s VBE(I, T) and the resistor at every corner', { skip }, async () => {
  const { ws, done } = await workspace();
  try {
    assert.match(ok(ws, 'bind', `ngspice=${ngspice!}`, pdkRoot, 'synth180', 'kuijk-p5t-mirror'), /template kuijk-p5t-mirror/);
    assert.match(bg(ws, 'bind', `ngspice=${ngspice!}`, pdkRoot, 'synth180', 'folded').stderr, /topology must be one of kuijk-p5t, kuijk-p5t-mirror/);
    ok(ws, 'characterize');
    const tables = await readJson(path.join(ws, 'state/tables.json'));
    assert.equal(tables.curves, tables.expected);
    assert.deepEqual(tables.pnpCorners, ['ff', 'fs', 'sf', 'ss', 'tt']);
    const dev = await readJson(path.join(ws, 'state/devices.json'));
    const i27 = dev.temps.indexOf(25), i32 = dev.temps.indexOf(30);
    const k1 = dev.pnp.currentsUa.indexOf(1);
    for (const corner of tables.pnpCorners) {
      const row = dev.pnp.vbe[corner][k1];
      const slope = (row[i32] - row[i27]) / 5;
      assert.ok(row[i27] > 0.5 && row[i27] < 0.8, `${corner}: VBE at 1 uA`);
      assert.ok(slope < -1.5e-3 && slope > -2.3e-3, `${corner}: dVBE/dT ${slope}`);
      // VBE rises by VT ln(I2/I1) per decade of current (ideality 1 in the synthetic card).
      const k10 = dev.pnp.currentsUa.indexOf(8);
      const dv = dev.pnp.vbe[corner][k10][i27] - row[i27];
      assert.ok(Math.abs(dv - 8.617e-5 * 298.15 * Math.log(8)) < 3e-3, `${corner}: VBE(8 uA) - VBE(1 uA) = ${dv}`);
    }
    const r = dev.res.r.tt;
    assert.ok(r['2/40'][i27] > r['2/10'][i27] && r['1/10'][i27] > r['2/10'][i27], 'R grows with L and falls with W');
    assert.ok(dev.res.r.ss['2/40'][i27] > r['2/40'][i27] && dev.res.r.ff['2/40'][i27] < r['2/40'][i27], 'the resistor corners');
  } finally { await done(); }
});

test('a design end to end on ngspice: first cut, precheck, every corner, the record bound to the design', { skip }, async () => {
  const { ws, done } = await workspace();
  try {
    ok(ws, 'bind', `ngspice=${ngspice!}`, pdkRoot, 'synth180', 'kuijk-p5t-mirror');
    ok(ws, 'characterize');
    await writeFile(path.join(ws, 'sheet.json'), JSON.stringify(SPEC));
    await writeFile(path.join(ws, 'intent.json'), ok(ws, 'draft', 'intent', path.join(ws, 'sheet.json')));
    const design: Json = { ...JSON.parse(ok(ws, 'draft', 'size', path.join(ws, 'intent.json'))), summary: 'first cut', reason: 'the method' };
    await mkdir(path.join(ws, 'reports/size-agent/r1'), { recursive: true });
    await writeFile(path.join(ws, 'reports/size-agent/r1/analysis.md'), '# analysis\n');
    await writeFile(path.join(ws, 'design.json'), JSON.stringify(design));
    ok(ws, 'precheck', path.join(ws, 'design.json'), ws);
    // The agent's own try at one corner: both supplies, three temperatures.
    const own = JSON.parse(ok(ws, 'sim', path.join(ws, 'design.json'), 'tt', path.join(ws, 'sheet.json'), path.join(ws, 'own')));
    assert.deepEqual(own.benches.map((b: Json) => [b.process, b.vdd]), [['tt', 2], ['tt', 3.3]]);
    // The Pack's step on the accepted design: every corner.
    await cp(path.join(ws, 'design.json'), path.join(ws, 'state/design.json'));
    ok(ws, 'simulate', 'schematic', ...SPEC_ARGS);
    const m = await readJson(path.join(ws, 'state/measure-schematic.json'));
    assert.equal(m.designSha256, await sha256(path.join(ws, 'state/design.json')));
    assert.equal(m.benches.length, 10, 'five process corners x two supplies');
    for (const b of m.benches) {
      for (const [t, x] of Object.entries(b.temps) as [string, Json][]) {
        assert.ok(x.vbgV > 1.1 && x.vbgV < 1.3, `${b.process} ${b.vdd} V ${t} C: VBG ${x.vbgV}`);
        assert.ok(x.pmDeg > 45, `${b.process} ${b.vdd} V ${t} C: a stable loop (${x.pmDeg} deg)`);
        assert.ok(x.startUs !== null && x.startUs < 300, `${b.process} ${b.vdd} V ${t} C: it starts, from vdd = 0 too`);
        assert.ok(x.isdNa < 1, `${b.process} ${b.vdd} V ${t} C: shutdown is leakage only`);
      }
    }
    // `option temp` takes effect: the operating point at -40 C and 125 C sits on the DC temperature sweep.
    for (const b of m.benches) {
      const at = (t: number) => b.sweep.vbg[b.sweep.temp.indexOf(t)];
      for (const t of [-40, 27, 125]) {
        if (t === 27) continue;
        assert.ok(Math.abs(b.temps[String(t)].vbgV - at(t)) < 3e-5, `${b.process} ${b.vdd} V: op at ${t} C ${b.temps[String(t)].vbgV} vs sweep ${at(t)}`);
      }
      assert.ok(Math.abs(at(-40) - at(125)) > 1e-4 || b.tcPpm < 5, 'the sweep moves with temperature');
    }
    // The worst corner, recomputed here.
    const extremes = m.benches.flatMap((b: Json) => [b.vbgMinV, b.vbgMaxV]);
    const vbgWorst = extremes.reduce((a: number, b: number) => (Math.abs(b - 1.2) > Math.abs(a - 1.2) ? b : a));
    assert.equal(m.worst.vbg.value, vbgWorst);
    assert.equal(m.worst.iq.value, Math.max(...m.benches.map((b: Json) => b.iqMaxUa)));
    assert.equal(m.worst.pm.value, Math.min(...m.benches.flatMap((b: Json) => Object.values(b.temps).map((x: any) => x.pmDeg))));
    assert.equal(m.worst.psrr.value, Math.min(...m.benches.flatMap((b: Json) => Object.values(b.temps).map((x: any) => x.psrrDb))));
    assert.equal(m.specMet.vbg, Math.abs(vbgWorst - 1.2) <= 0.024);
    assert.equal(m.meetsSpec, Object.values(m.specMet).every((v) => v === true));
    // The record takes it; a changed design voids it.
    ok(ws, 'record', ...SPEC_ARGS);
    const round = await readJson(path.join(ws, 'state/round.json'));
    assert.deepEqual(round.problems, []);
    assert.deepEqual(round.failing, [...Object.entries(m.specMet).filter(([, v]) => v !== true).map(([k]) => k), 'mc'],
      'Monte Carlo was not run, so the round is not signed off');
    assert.equal(round.roundValid, true, 'a valid measurement of the accepted design');
    assert.equal(round.signedOff, false);
  } finally { await done(); }
});

test('ngspice and the recorded Spectre output agree on the same cell at the same corner', { skip }, async () => {
  const { ws, done } = await workspace();
  try {
    ok(ws, 'bind', `ngspice=${ngspice!}`, pdkRoot, 'synth180', 'kuijk-p5t-mirror');
    const script = [
      'import json, sys',
      'from pathlib import Path',
      `sys.path.insert(0, ${JSON.stringify(path.join(ws, 'flow'))})`,
      'import bg_cli as bg',
      `F = Path(${JSON.stringify(path.join(fixtures, 'spectre-tt'))})`,
      `inputs = bg.load_inputs(${JSON.stringify(ws)})`,
      'design = json.load(open(F / "design.json"))',
      'cell = bg.cell_spice(bg.card_of(inputs), design)',
      `out = Path(${JSON.stringify(path.join(ws, 'agree'))}); out.mkdir()`,
      '(out / "cell.spice").write_text(cell)',
      'sim, command = bg.simulator_for(inputs)',
      'ng = bg.bench_measures(bg.run_bench(sim, command, inputs, "tt", 3.3, design["ibiasUa"], out / "cell.spice", out, "agree", temps=(27,)))',
      'facts = bg.spectre_facts({p: F / ("bg-tt-3.3V-%s.raw" % p) for p, _ in bg.SPECTRE_PARTS}, (27,))',
      'facts.update(process="tt", vdd=3.3)',
      'sp = bg.bench_measures(facts)',
      'print(json.dumps(dict(same=cell == (F / "cell.spice").read_text(), ng=ng, sp=sp), default=lambda x: None))',
    ].join('\n');
    const run = spawnSync('python3', ['-B', '-c', script], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const { same, ng, sp } = JSON.parse(run.stdout);
    assert.ok(same, 'the fixture is this design\'s cell');
    const a = ng.temps['27'], b = sp.temps['27'];
    assert.ok(Math.abs(a.vbgV - b.vbgV) < 1e-3, `VBG ${a.vbgV} vs ${b.vbgV}`);
    assert.ok(Math.abs(a.iqUa - b.iqUa) / b.iqUa < 0.01, `IQ ${a.iqUa} vs ${b.iqUa}`);
    assert.ok(Math.abs(ng.tcPpm - sp.tcPpm) < 3, `TC ${ng.tcPpm} vs ${sp.tcPpm}`);
    assert.ok(Math.abs(a.psrrDb - b.psrrDb) < 1, `PSRR ${a.psrrDb} vs ${b.psrrDb}`);
    assert.ok(Math.abs(a.loop.dcGainDb - b.loop.dcGainDb) < 0.5, `loop gain ${a.loop.dcGainDb} vs ${b.loop.dcGainDb}`);
    assert.ok(Math.abs(a.pmDeg - b.pmDeg) < 2, `PM ${a.pmDeg} vs ${b.pmDeg}`);
    for (const key of ['powerUp', 'en1us', 'en50us']) {
      assert.ok(Math.abs(a.starts[key].us - b.starts[key].us) < 0.15 * b.starts[key].us + 1, `${key}: ${a.starts[key].us} vs ${b.starts[key].us} us`);
    }
    assert.ok(a.isdNa < 0.1 && b.isdNa < 0.1, 'both see leakage only in shutdown');
  } finally { await done(); }
});

test('the spec\'s template on ngspice: the OTA drives the gate directly, starts from vdd = 0 and shuts down', { skip }, async () => {
  const { ws, done } = await workspace();
  try {
    ok(ws, 'bind', `ngspice=${ngspice!}`, pdkRoot, 'synth180');
    ok(ws, 'characterize');
    await writeFile(path.join(ws, 'sheet.json'), JSON.stringify(SPEC));
    await writeFile(path.join(ws, 'intent.json'), ok(ws, 'draft', 'intent', path.join(ws, 'sheet.json')));
    const design: Json = { ...JSON.parse(ok(ws, 'draft', 'size', path.join(ws, 'intent.json'))), summary: 's', reason: 'r' };
    assert.equal(design.topology, 'kuijk-p5t');
    assert.equal(design.devices.M5, undefined);
    await writeFile(path.join(ws, 'design.json'), JSON.stringify(design));
    const own = JSON.parse(ok(ws, 'sim', path.join(ws, 'design.json'), 'tt', '-', path.join(ws, 'own')));
    const top = own.benches.find((b: Json) => b.vdd === 3.3);
    const t27 = top.temps['27'];
    assert.ok(t27.vbgV > 1.1 && t27.vbgV < 1.3 && t27.isdNa < 1);
    assert.ok(t27.starts.powerUp.us !== null, 'it starts when vdd ramps from 0 with en tied high');
    assert.ok(t27.loop.dcGainDb > 0 && t27.pmDeg > 45, 'a working, stable loop at tt 3.3 V');
    assert.equal(own.worst, undefined, 'no spec sheet, no verdict');
  } finally { await done(); }
});

test('Monte Carlo on ngspice: the PDK\'s mismatch draws anew per run, seeded, and agrees with Spectre', { skip }, async () => {
  const { ws, done } = await workspace();
  try {
    ok(ws, 'bind', `ngspice=${ngspice!}`, pdkRoot, 'synth180', 'kuijk-p5t-mirror');
    ok(ws, 'characterize');
    await writeFile(path.join(ws, 'sheet.json'), JSON.stringify(SPEC));
    await writeFile(path.join(ws, 'intent.json'), ok(ws, 'draft', 'intent', path.join(ws, 'sheet.json')));
    const design: Json = { ...JSON.parse(ok(ws, 'draft', 'size', path.join(ws, 'intent.json'))), summary: 's', reason: 'r' };
    await mkdir(path.join(ws, 'reports/size-agent/r1'), { recursive: true });
    await writeFile(path.join(ws, 'reports/size-agent/r1/analysis.md'), '# analysis\n');
    await writeFile(path.join(ws, 'state/design.json'), JSON.stringify(design));
    // The Pack's step on the measuring simulator, ngspice here.
    assert.match(ok(ws, 'mc', '40', '1.2', '2', '7'), /Monte Carlo round 1: 40 runs/);
    const mc = await readJson(path.join(ws, 'state/mc.json'));
    assert.match(mc.simulator, /^ngspice-\d+/);
    assert.equal(mc.conditions.variations, 'mismatch');
    assert.match(mc.conditions.method, /ngspice.*setseed S\+i.*mismatch only/);
    assert.equal(mc.designSha256, await sha256(path.join(ws, 'state/design.json')));
    const v: number[] = mc.vbgV;
    assert.equal(v.length, 40);
    assert.ok(new Set(v).size >= 38, 'every run draws its own mismatch');
    const mean = v.reduce((a, b) => a + b, 0) / v.length;
    const sigma = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / (v.length - 1));
    assert.ok(sigma > 1e-4, `sigma ${sigma}`);
    assert.ok(Math.abs(mc.stats.sigmaV - sigma) < 1e-12 && Math.abs(mc.stats.meanV - mean) < 1e-12);
    // The same seed draws the same runs; another seed draws others.
    const again = JSON.parse(ok(ws, 'sim', path.join(ws, 'state/design.json'), 'mc:5', '-', path.join(ws, 'own-a')));
    const same = JSON.parse(ok(ws, 'sim', path.join(ws, 'state/design.json'), 'mc:5', '-', path.join(ws, 'own-b')));
    assert.deepEqual(again.stats, same.stats, 'sim mc uses seed 1: reproducible');
    assert.notEqual(again.stats.meanV, mc.stats.meanV);
    // Spectre's montecarlo on the recorded design (30 runs) and ngspice's (30 runs) agree on sigma.
    const fixtureDesign = path.join(fixtures, 'spectre-tt/design.json');
    const ng = JSON.parse(ok(ws, 'sim', fixtureDesign, 'mc:30', '-', path.join(ws, 'own-fixture'))).stats;
    const run = spawnSync('python3', ['-B', '-c', [
      'import json, sys', `sys.path.insert(0, ${JSON.stringify(path.join(ws, 'flow'))})`, 'import bg_cli as bg',
      `v, _ = bg.mc_values(${JSON.stringify(path.join(fixtures, 'spectre-mc/mc.raw'))})`, 'print(json.dumps(bg.mc_stats(v, 1.2, 2.0)))',
    ].join('\n')], { encoding: 'utf8' });
    const sp = JSON.parse(run.stdout);
    assert.ok(Math.abs(ng.sigmaV - sp.sigmaV) / sp.sigmaV < 0.3, `sigma: ngspice ${ng.sigmaV}, Spectre ${sp.sigmaV}`);
    assert.ok(Math.abs(ng.meanV - sp.meanV) < 3e-3, `mean: ngspice ${ng.meanV}, Spectre ${sp.meanV}`);
  } finally { await done(); }
});

test('the bench\'s loop injection on an ideal two-pole loop gives the analytic phase margin', { skip }, async () => {
  const { ws, done } = await workspace();
  try {
    ok(ws, 'bind', `ngspice=${ngspice!}`, pdkRoot, 'synth180', 'kuijk-p5t-mirror');
    // go = -A(s) g with A = 100 / ((1 + s/2pi100)(1 + s/2pi1e5)): the loop gain T = A, negative feedback.
    const cell = [
      '.subckt bandgap_lb vdd vss en ibias vbg go g',
      'Rg g vss 1e12',
      'G1 vss x1 g vss 1e-3', 'R1 x1 vss 1e5', `C1 x1 vss ${1 / (2 * Math.PI * 100 * 1e5)}`,
      'G2 vss x2 x1 vss 1e-3', 'R2 x2 vss 1e3', `C2 x2 vss ${1 / (2 * Math.PI * 1e5 * 1e3)}`,
      'E1 go vss x2 vss -1',
      'Rvbg vbg vss 1k', 'Rdd vdd vss 1meg', 'Ren en vss 1meg', 'Rib ibias vss 1meg',
      // The nodes the bench reports at each temperature.
      'Rt tail vss 1k', 'Rd d1 vss 1k', 'Ra a vss 1k', 'Rb b vss 1k', 'Rs su vss 1k',
      '.ends bandgap_lb', '',
    ].join('\n');
    await writeFile(path.join(ws, 'loop.spice'), cell);
    const script = [
      'import json, sys',
      'from pathlib import Path',
      `sys.path.insert(0, ${JSON.stringify(path.join(ws, 'flow'))})`,
      'import bg_cli as bg',
      `inputs = bg.load_inputs(${JSON.stringify(ws)})`,
      'sim, command = bg.simulator_for(inputs)',
      `out = Path(${JSON.stringify(path.join(ws, 'loop'))}); out.mkdir()`,
      `m = bg.bench_measures(bg.run_bench(sim, command, inputs, "tt", 3.3, 0.5, Path(${JSON.stringify(path.join(ws, 'loop.spice'))}), out, "loop", temps=(27,)))`,
      'print(json.dumps(m["temps"]["27"], default=lambda x: None))',
    ].join('\n');
    const run = spawnSync('python3', ['-B', '-c', script], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const t27 = JSON.parse(run.stdout);
    assert.ok(t27.loop.crossings.length === 1, JSON.stringify(t27.loop));
    let lo = 10, hi = 1e7;
    for (let k = 0; k < 200; k += 1) {
      const mid = Math.sqrt(lo * hi);
      if ((1 + (mid / 100) ** 2) * (1 + (mid / 1e5) ** 2) > 1e4) hi = mid; else lo = mid;
    }
    const pm = 180 - (Math.atan(lo / 100) + Math.atan(lo / 1e5)) * 180 / Math.PI;
    assert.equal(t27.loop.crossings.length, 1);
    assert.ok(Math.abs(t27.pmDeg - pm) < 0.3, `PM ${t27.pmDeg} vs ${pm}`);
    assert.ok(Math.abs(t27.loop.ugfHz - lo) / lo < 0.01, `UGF ${t27.loop.ugfHz} vs ${lo}`);
    assert.ok(Math.abs(t27.loop.dcGainDb - 40) < 0.01, `T0 ${t27.loop.dcGainDb} dB`);
    assert.equal(t27.startUs, null, 'a dead circuit never counts as started');
  } finally { await done(); }
});
