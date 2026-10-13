// The analog-bandgap Pack's flow engine without a simulator (group local): the shared adapters, the cell
// and bench netlists for both simulators, the measurement arithmetic on recorded Spectre output, the
// first-cut equations and the refusals.
//
// The expectations are independent of the code under test where they can be: the box TC, the PSRR, the
// loop gain (Middlebrook's double injection), the start-up time and the Monte Carlo statistics are
// recomputed here from the simulator's raw facts; the first cut is checked against the Kuijk equations
// on the characterized PNP and resistor. The simulator-backed steps are in analog-bandgap-sim.test.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { himaChart } from '@hima/harness';
import { repoRoot } from './support/dsh-home.ts';

const packDir = path.join(repoRoot, 'packs/analog-bandgap');
const flowDir = path.join(packDir, 'flow');
const fixtures = path.join(repoRoot, 'test/fixtures/analog-bandgap');
const SPEC = { vbgV: 1.2, vbgTolPct: 2, iqMaxUa: 8, isdMaxNa: 2, tcMaxPpm: 100, pmMinDeg: 60, tStartMaxUs: 100, psrrMinDb: 40, ibiasUa: 0.5 };
const K_Q = 8.617333262e-5;

type Json = Record<string, any>;

/** Run Python against the Pack's flow (bg_cli as bg); the script prints one JSON value. */
function py(script: string): any {
  const head = [
    'import json, sys, math',
    `sys.path.insert(0, ${JSON.stringify(flowDir)})`,
    'import bg_cli as bg',
    `card = json.load(open(${JSON.stringify(path.join(flowDir, 'pdks.json'))}))["cards"]["synth180"]`,
    `table = json.load(open(${JSON.stringify(path.join(fixtures, 'synth180-tables/tables-design.json'))}))`,
    `devices = json.load(open(${JSON.stringify(path.join(fixtures, 'synth180-tables/devices.json'))}))`,
    `spec = ${JSON.stringify(SPEC)}`,
    'def design_of(topology, choices=None):',
    '    intent = bg.first_cut_intent(spec, card, table, devices, choices, topology)',
    '    d = bg.size_from_intent(table, devices, card, intent, topology)',
    '    return dict(d, schema=bg.DESIGN_SCHEMA, pdk="synth180", topology=topology, round=1, intent=intent, summary="s", reason="r",',
    '                report="reports/size-agent/r1/analysis.md")',
  ].join('\n');
  const run = spawnSync('python3', ['-B', '-c', `${head}\n${script}`], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout);
}

test('the bandgap Pack carries a byte-identical copy of the OTA Pack\'s simulator adapters', async () => {
  const ota = await readFile(path.join(repoRoot, 'packs/analog-ota-migrate/flow/ota_cli.py'));
  const copy = await readFile(path.join(flowDir, 'ota_cli.py'));
  assert.ok(ota.equals(copy), 'packs/analog-bandgap/flow/ota_cli.py drifted from packs/analog-ota-migrate/flow/ota_cli.py');
});

test('the cell is one SPICE subcircuit for both simulators, the loop broken between go and g', () => {
  const out = py([
    'res = {}',
    'for t in ("kuijk-p5t", "kuijk-p5t-mirror"):',
    '    d = design_of(t)',
    '    res[t] = dict(design=d, cell=bg.cell_spice(card, d), mc=bg.cell_spice(card, d, True))',
    'print(json.dumps(res))',
  ].join('\n'));
  for (const [topology, { design, cell, mc }] of Object.entries(out) as [string, Json][]) {
    const lines: string[] = cell.split('\n');
    assert.ok(lines.includes('.subckt bandgap_lb vdd vss en ibias vbg go g'), `${topology}: the loop-break subcircuit`);
    assert.ok(lines.includes('.subckt bandgap vdd vss en ibias vbg') && lines.includes('xlb vdd vss en ibias vbg g g bandgap_lb'),
      `${topology}: the closed cell joins go and g`);
    assert.ok(lines.includes('XQ1 vss vss a spnp '), 'Q1 at a, collector and base at vss');
    assert.equal(lines.filter((l) => /^XQ2_\d+ vss vss c spnp $/.test(l)).length, design.n, 'n unit PNPs at c');
    const r = (name: string) => design.resistors[name];
    for (const [name, nets] of [['R1', 'b c'], ['R2a', 'vbg a'], ['R2b', 'vbg b']]) {
      assert.ok(lines.includes(`X${name} ${nets} vss sres r_length=${r(name!).lUm}u r_width=${r(name!).wUm}u s=${r(name!).s}`), `${topology} ${name}`);
    }
    assert.doesNotMatch(cell, /\sm=\d/, 'no multiplicity: segments and units are instances or s');
    const mos = lines.filter((l) => /^M/.test(l));
    assert.equal(mos.length, Object.keys(design.devices).length);
    for (const l of mos) assert.match(l, /^M\w+ \S+ \S+ \S+ \S+ (nch33|pch33) w=[\d.]+u l=[\d.]+u$/);
    // Mismatch: every MOS is the PDK's mismatch subcircuit (X), nothing else changes.
    assert.equal(mc.split('\n').filter((l: string) => /^M/.test(l)).length, 0);
    assert.equal(mc.split('\n').filter((l: string) => /^XM\w+ .* (nch33|pch33) w=/.test(l)).length, mos.length);
    if (topology === 'kuijk-p5t') {
      assert.ok(lines.includes(`M2 go a tail vdd pch33 w=${design.devices.M2.wUm}u l=${design.devices.M2.lUm}u`), 'the OTA output is go');
      assert.ok(lines.some((l) => /^M1 d1 b tail vdd /.test(l)) && lines.some((l) => /^XCC g vdd scap /.test(l)));
      assert.equal(design.devices.M5, undefined);
    } else {
      assert.ok(lines.some((l) => /^M1 d1 a tail vdd /.test(l)) && lines.some((l) => /^M2 o1 b tail vdd /.test(l)), 'inputs swapped');
      assert.ok(lines.some((l) => /^M5 go o1 ls vss nch33 /.test(l)) && lines.some((l) => /^M6 go go vdd vdd pch33 /.test(l)));
      assert.ok(lines.some((l) => /^XCC o1 vss scap /.test(l)));
      assert.ok(Math.abs(design.devices.MO.wUm / design.devices.M6.wUm - design.intent.driveRatio) < 0.05, 'MO mirrors M6');
    }
    assert.ok(lines.some((l) => /^MEN3 ls en vss vss /.test(l)), 'the load foot switch');
    assert.deepEqual(design.devices.MSU2, { wUm: 0.5, lUm: 20 }, 'the start-up sense device is long and narrow');
  }
});

test('the bench: one Spectre netlist per copy of the cell, all seven copies in one ngspice netlist', () => {
  const out = py([
    'inputs = dict(pdkRoot="/pdk", topology="kuijk-p5t", pdks=dict(design=dict(name="synth180", card=card)))',
    'parts = {p: bg.bench_spectre(inputs, "ss", 2.0, 0.5, "/w/cell.spice", bg.TEMPS, p) for p, _ in bg.SPECTRE_PARTS}',
    'from pathlib import Path',
    'ng, files = bg.bench_ngspice(inputs, "ss", 2.0, 0.5, "/w/cell.spice", bg.TEMPS, Path("/w/bg-ss-2V"))',
    'print(json.dumps(dict(parts=parts, ng=ng, files=files)))',
  ].join('\n'));
  const parts: Record<string, string[]> = out.parts;
  assert.deepEqual(Object.keys(parts), ['nominal', 'loopv', 'loopi', 'off', 'powerUp', 'en1us', 'en50us', 'offref']);
  for (const [part, lines] of Object.entries(parts)) {
    assert.ok(lines.includes('.lib "/pdk/synth180/bandgap.lib" mos_ss') && lines.includes('.lib "/pdk/synth180/bandgap.lib" bjt_ss'),
      `${part}: the process corner's MOS and BJT sections`);
    assert.ok(lines.includes('.include "/w/cell.spice"'));
    assert.ok(lines.some((l) => /^opts options .*rawfmt=psfascii save=selected cmin=1e-14$/.test(l)), `${part}: options`);
    assert.equal(lines.filter((l) => /^X\d /.test(l)).length, 1, `${part}: one copy of the cell`);
    assert.deepEqual(lines.filter((l) => / alter param=temp /.test(l)).map((l) => l.split('value=')[1]), ['-40', '27', '125']);
  }
  assert.ok(parts.nominal!.includes('VDD1 (vdd1 0) vsource dc=2 mag=1') && parts.nominal!.includes('dcT dc param=temp start=-40 stop=125 step=5'));
  assert.ok(parts.nominal!.includes('GIB1 (ib1 0 en1 0) vccs gm=2.5e-07'), 'the reference current follows en');
  assert.ok(parts.loopv!.includes('VI2 (g2 go2) vsource dc=0 mag=1') && parts.loopv!.includes('X2 (vdd2 0 en2 ib2 vbg2 go2 g2) bandgap_lb'));
  assert.ok(parts.loopi!.includes('II3 (0 g3) isource dc=0 mag=1') && parts.loopi!.includes('VI3 (g3 go3) vsource dc=0'));
  assert.ok(parts.off!.includes('VEN4 (en4 0) vsource dc=0') && parts.off!.includes('GIB4 (ib4 0 en4 0) vccs gm=2.5e-07'),
    'shutdown: en low turns the reference off too');
  assert.ok(parts.offref!.includes('VEN8 (en8 0) vsource dc=0') && parts.offref!.includes('GIB8 (ib8 0 vdd8 0) vccs gm=2.5e-07'),
    'information only: en low with the reference left on');
  assert.ok(parts.powerUp!.includes('VDD5 (vdd5 0) vsource type=pwl wave=[0 0 10u 2]') && parts.powerUp!.includes('X5 (vdd5 0 vdd5 ib5 vbg5 g5 g5) bandgap_lb'),
    'power-up: vdd ramps from 0 with en tied to it');
  assert.ok(parts.en1us!.includes('VEN6 (en6 0) vsource type=pwl wave=[0 0 10u 0 11u 2]'));
  assert.ok(parts.en50us!.includes('VEN7 (en7 0) vsource type=pwl wave=[0 0 10u 0 60u 2]'));
  for (const p of ['powerUp', 'en1us', 'en50us']) assert.ok(parts[p]!.some((l) => /^tr_p27 tran stop=300u maxstep=1u/.test(l)));
  const ng: string[] = out.ng;
  assert.ok(ng.includes('.lib "/pdk/synth180/bandgap.lib" mos_ss') && ng.includes('.options tnom=27 cshunt=1e-14'));
  assert.equal(ng.filter((l) => /^X\d /.test(l)).length, 8, 'ngspice holds all eight copies');
  assert.ok(ng.includes('dc temp -40 125 5') && ng.includes('option temp=125') && ng.includes('VDD5 vdd5 0 dc 0 pwl(0u 0 10u 2)'));
  assert.ok(ng.includes(`wrdata ${out.files.ac_p27} v(vbg1) v(go2) v(g2) i(vi3)`));
});

/** Complex numbers for the independent loop-gain arithmetic. */
type C = [number, number];
const cAdd = (a: C, b: C): C => [a[0] + b[0], a[1] + b[1]];
const cMul = (a: C, b: C): C => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const cDiv = (a: C, b: C): C => { const d = b[0] ** 2 + b[1] ** 2; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]; };
const cNeg = (a: C): C => [-a[0], -a[1]];
const cAbs = (a: C) => Math.hypot(a[0], a[1]);
/** Middlebrook: Tv = -vL/vR, Ti = -s/(s + 1), T = (Tv Ti - 1)/(Tv + Ti + 2). */
function middlebrook(vl: C, vr: C, s: C): C {
  const tv = cNeg(cDiv(vl, vr));
  const ti = cNeg(cDiv(s, cAdd(s, [1, 0])));
  return cDiv(cAdd(cMul(tv, ti), [-1, 0]), cAdd(cAdd(tv, ti), [2, 0]));
}
function loglog(xs: number[], ys: number[], x: number): number {
  for (let i = 1; i < xs.length; i += 1) {
    if (xs[i - 1]! <= x && x <= xs[i]!) {
      const u = (Math.log10(x) - Math.log10(xs[i - 1]!)) / (Math.log10(xs[i]!) - Math.log10(xs[i - 1]!));
      return 10 ** (Math.log10(ys[i - 1]!) + u * (Math.log10(ys[i]!) - Math.log10(ys[i - 1]!)));
    }
  }
  throw new Error(`${x} is outside the sweep`);
}

test('measures on recorded Spectre output: TC, PSRR, loop gain and start-up recomputed independently', () => {
  const out = py([
    'from pathlib import Path',
    `F = Path(${JSON.stringify(path.join(fixtures, 'spectre-tt'))})`,
    'raws = {p: F / ("bg-tt-3.3V-%s.raw" % p) for p, _ in bg.SPECTRE_PARTS}',
    'facts = bg.spectre_facts(raws, (27,))',
    'facts.update(process="tt", vdd=3.3)',
    'm = bg.bench_measures(facts)',
    'cx = lambda xs: [[x.real, x.imag] for x in xs]',
    'f = facts["temps"]["27"]',
    'ac = dict(freq=f["ac"]["freq"], vbg=cx(f["ac"]["vbg"]), vl=cx(f["ac"]["vl"]), vr=cx(f["ac"]["vr"]), s=cx(f["ac"]["s"]))',
    'print(json.dumps(dict(m=m, dc=facts["dc"], ac=ac, op=dict(vbg=f["vbg"], iq=f["iq"], isd=f["isd"]), tran=f["tran"]), default=lambda x: None))',
  ].join('\n'));
  const { m, dc, ac, op, tran } = out;
  const t27 = m.temps['27'];
  // Box TC from the DC sweep.
  const i27 = dc.temp.findIndex((t: number) => t > 27);
  const v27 = dc.vbg[i27 - 1] + (27 - dc.temp[i27 - 1]) / (dc.temp[i27] - dc.temp[i27 - 1]) * (dc.vbg[i27] - dc.vbg[i27 - 1]);
  const tc = 1e6 * (Math.max(...dc.vbg) - Math.min(...dc.vbg)) / (v27 * 165);
  assert.ok(Math.abs(tc - m.tcPpm) < 1e-6 * tc, `TC ${tc} vs ${m.tcPpm}`);
  assert.ok(Math.abs(op.vbg - v27) < 2e-4, 'the operating point sits on the sweep at 27 C');
  assert.ok(op.vbg > 1.1 && op.vbg < 1.3 && op.iq > 1e-6 && op.iq < 8e-6 && op.isd < 1e-9, 'a working bandgap');
  // PSRR at 1 kHz: unit AC on vdd.
  const psrr = -20 * Math.log10(loglog(ac.freq, ac.vbg.map((c: C) => cAbs(c)), 1e3));
  assert.ok(Math.abs(psrr - t27.psrrDb) < 1e-6, `PSRR ${psrr} vs ${t27.psrrDb}`);
  // Loop gain by double injection; negative feedback at low frequency; one falling crossing.
  const T: C[] = ac.freq.map((_: number, i: number) => middlebrook(ac.vl[i], ac.vr[i], ac.s[i]));
  assert.ok(T[0]![0] > 0 && Math.abs(T[0]![1]) < 0.1 * T[0]![0], 'T is positive and real at 0.1 Hz');
  let pm: number | undefined;
  let phase = 0;
  for (let i = 1; i < T.length; i += 1) {
    let p = Math.atan2(T[i]![1], T[i]![0]) * 180 / Math.PI;
    while (p - phase > 180) p -= 360;
    while (p - phase < -180) p += 360;
    const prev = phase;
    phase = p;
    const a = cAbs(T[i - 1]!), b = cAbs(T[i]!);
    if (a >= 1 && b < 1) {
      const u = Math.log10(a) / (Math.log10(a) - Math.log10(b));
      pm = 180 + prev + u * (phase - prev);
    }
  }
  assert.ok(pm !== undefined && Math.abs(pm - t27.pmDeg) < 0.05, `PM ${pm} vs ${t27.pmDeg}`);
  assert.ok(Math.abs(20 * Math.log10(cAbs(T[0]!)) - t27.loop.dcGainDb) < 1e-6);
  // Start-up: from the trigger at 50 % until VBG stays within 2 % of its final value.
  for (const [key, t0] of [['powerUp', 5], ['en1us', 10.5], ['en50us', 35]] as const) {
    const { time, v } = tran[key];
    const final = v.at(-1);
    let last = -1;
    v.forEach((x: number, i: number) => { if (Math.abs(x - final) > 0.02 * final) last = i; });
    const a = Math.abs(v[last] - final), b = Math.abs(v[last + 1] - final);
    const t = time[last] + (a - 0.02 * final) / (a - b) * (time[last + 1] - time[last]);
    assert.ok(Math.abs((t * 1e6 - t0) - t27.starts[key].us) < 2e-3, `${key}: ${t * 1e6 - t0} vs ${t27.starts[key].us}`);
  }
  assert.equal(t27.startUs, Math.max(...Object.values(t27.starts).map((s: any) => s.us)));
});

test('Middlebrook\'s double injection recovers a known loop gain and its phase margin', () => {
  // A unilateral loop: the driver at the break is a transconductance y12 into its own admittance y11;
  // the load side is y22. T = y12 / (y11 + y22) = A0 / ((1 + s/p1)(1 + s/p2)).
  const out = py([
    'A0, p1, p2 = 1000.0, 2 * math.pi * 100.0, 2 * math.pi * 2e5',
    'freq = [10 ** (k / 40.0) for k in range(-40, 361)]',
    'vl, vr, s, true = [], [], [], []',
    'for f in freq:',
    '    w = 1j * 2 * math.pi * f',
    '    y11, y22 = 1e-6 * (1 + w / p1), 2e-6 * (1 + w / p2)',
    '    t = A0 / ((1 + w / p1) * (1 + w / p2))',
    '    y12 = t * (y11 + y22)',
    '    S = y11 + y12 + y22',
    '    vl.append(-(y12 + y22) / S); vr.append(y11 / S); s.append(-(y11 + y12) / S); true.append(t)',
    'T = bg.loop_gain(vl, vr, s)',
    'err = max(abs(a - b) / abs(b) for a, b in zip(T, true))',
    'print(json.dumps(dict(err=err, pm=bg.phase_margins(freq, T), flat=bg.phase_margins(freq, [0.5 + 0j] * len(freq)),',
    '                      positive=bg.phase_margins(freq, [-10 + 0j] * len(freq)))))',
  ].join('\n'));
  assert.ok(out.err < 1e-6, `T recovered (${out.err})`);
  // The analytic phase margin: |T| = 1 where (1 + (f/f1)^2)(1 + (f/f2)^2) = A0^2.
  const [A0, f1, f2] = [1000, 100, 2e5];
  let lo = 1e3, hi = 1e7;
  for (let k = 0; k < 200; k += 1) {
    const mid = Math.sqrt(lo * hi);
    if ((1 + (mid / f1) ** 2) * (1 + (mid / f2) ** 2) > A0 ** 2) hi = mid; else lo = mid;
  }
  const pm = 180 - (Math.atan(lo / f1) + Math.atan(lo / f2)) * 180 / Math.PI;
  assert.equal(out.pm.crossings.length, 1);
  assert.ok(Math.abs(out.pm.pmDeg - pm) < 0.3, `PM ${out.pm.pmDeg} vs ${pm}`);
  assert.ok(Math.abs(out.pm.ugfHz - lo) / lo < 0.01);
  assert.equal(out.flat.pmDeg, null, 'no unity crossing is not a pass');
  assert.match(out.flat.note, /never crosses 1/);
  assert.equal(out.positive.pmDeg, null);
  assert.match(out.positive.note, /positive feedback/);
});

test('start-up: a copy that settles away from its DC solution did not start; a settled one is timed', () => {
  const out = py([
    'time = [k * 1e-7 for k in range(3001)]',
    'tau = 5e-6',
    'v = [0.0 if t < 10e-6 else 1.2 * (1 - math.exp(-(t - 10e-6) / tau)) for t in time]',
    'dead = [0.05] * len(time)',
    'print(json.dumps(dict(ok=bg.start_time_us(time, v, 10.0, 1.2), stuck=bg.start_time_us(time, [0.56] * len(time), 10.0, 1.2),',
    '                      dead=bg.start_time_us(time, dead, 10.0, 0.05))))',
  ].join('\n'));
  assert.ok(Math.abs(out.ok[0] - 5 * Math.log(50)) < 0.05, `${out.ok[0]} vs ${5 * Math.log(50)} us`);
  assert.equal(out.stuck[0], null);
  assert.equal(out.dead[0], null, 'a dead circuit that "settles" at its dead DC solution did not start');
});

test('Monte Carlo statistics from recorded Spectre iterations', () => {
  const out = py([
    `values, iq = bg.mc_values(${JSON.stringify(path.join(fixtures, 'spectre-mc/mc.raw'))})`,
    `part, _ = bg.mc_values(${JSON.stringify(path.join(fixtures, 'spectre-mc/mc.raw'))}, 11, 10)`,
    'lines = bg.mc_spectre_lines(dict(pdkRoot="/pdk", topology="kuijk-p5t-mirror", pdks=dict(design=dict(name="synth180", card=card))), "/w/c.spice", 3.3, 0.5, 25, 7, 26)',
    'print(json.dumps(dict(values=values, stats=bg.mc_stats(values, 1.2, 2.0), part=part, chunk=[l for l in lines if "montecarlo" in l], chunk_n=bg.MC_CHUNK)))',
  ].join('\n'));
  const v: number[] = out.values;
  assert.equal(v.length, 30, 'mc1-001 to mc1-030, the nominal run left out');
  // A chunk: iterations 11 to 20 only; Spectre draws them as in the whole run when the netlist says firstrun.
  assert.deepEqual(out.part, v.slice(10, 20));
  assert.deepEqual(out.chunk, ['mc1 montecarlo numruns=25 seed=7 firstrun=26 variations=mismatch donominal=yes savefamilyplots=yes {']);
  assert.equal(out.chunk_n, 25);
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const sigma = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / (v.length - 1));
  assert.ok(sigma > 1e-4, 'mismatch moved VBG');
  assert.ok(Math.abs(out.stats.meanV - mean) < 1e-12 && Math.abs(out.stats.sigmaV - sigma) < 1e-12);
  assert.ok(Math.abs(out.stats.hi3V - (mean + 3 * sigma)) < 1e-12 && Math.abs(out.stats.lo3V - (mean - 3 * sigma)) < 1e-12);
  assert.equal(out.stats.inBand, mean - 3 * sigma >= 1.176 && mean + 3 * sigma <= 1.224);
});

test('the first cut follows the Kuijk equations on the characterized PNP and resistor, and Pelgrom', () => {
  const out = py([
    'd = design_of("kuijk-p5t-mirror")',
    'p = d["devices"]["M1"]',
    'print(json.dumps(dict(design=d, pairArea=bg.eff_area(card, "pmos", p["wUm"], p["lUm"]), card=card)))',
  ].join('\n'));
  const { design, pairArea } = out;
  const intent = design.intent;
  const dev = JSON.parse(spawnSync('cat', [path.join(fixtures, 'synth180-tables/devices.json')], { encoding: 'utf8' }).stdout);
  const temps: number[] = dev.temps;
  const at = (row: number[], t: number) => {
    const i = temps.findIndex((x) => x >= t);
    return temps[i] === t ? row[i]! : row[i - 1]! + (t - temps[i - 1]!) / (temps[i]! - temps[i - 1]!) * (row[i]! - row[i - 1]!);
  };
  // The resistor per segment, R = a L + b at width W, from the two characterized lengths.
  const fit = (corner: string, w: number, t: number) => {
    const r10 = at(dev.res.r[corner][`${w}/10`], t), r40 = at(dev.res.r[corner][`${w}/40`], t);
    const a = (r40 - r10) / 30;
    return [a, r10 - 10 * a] as const;
  };
  const [a27, b27] = fit('tt', 2, 27);
  const [a125] = fit('tt', 2, 125);
  const aff = Math.min(...Object.keys(dev.res.r).map((c) => fit(c, 2, 27)[0]));
  // IQ budget: 80 % of the line less the reference, tail and start-up, two branches at hot, low R.
  const kHot = (398.15 / 300.15) * (a27 / a125) * (a27 / aff);
  // kuijk-p5t-mirror: the drive branch M5/M6 carries 2 iCore / driveRatio too.
  const iCore = (0.8 * SPEC.iqMaxUa - 0.5 - 1.0 - 0.025) / ((2 + 2 / intent.driveRatio) * kHot);
  assert.ok(Math.abs(intent.iCoreUa - iCore) < 1e-3, `core current ${intent.iCoreUa} vs ${iCore}`);
  // R1 = VT ln n / I at 27 C.
  const R = (r: Json) => r.s * (a27 * r.lUm + b27);
  const r1 = K_Q * 300.15 * Math.log(intent.n) / (intent.iCoreUa * 1e-6);
  assert.ok(Math.abs(R(design.resistors.R1) - r1) / r1 < 0.002, `R1 ${R(design.resistors.R1)} vs ${r1}`);
  assert.ok(Math.abs(R(design.resistors.R2a) / R(design.resistors.R1) - intent.r2r1) / intent.r2r1 < 0.003, 'R2/R1');
  // dVBG/dT = 0 at 27 C: R2/R1 from the PNP slope at the core current (log-interpolated) and the
  // resistor's TC (the current is VT ln n / R(T)).
  const cur: number[] = dev.pnp.currentsUa;
  const k = cur.findIndex((c) => c >= intent.iCoreUa);
  const u = Math.log(intent.iCoreUa / cur[k - 1]!) / Math.log(cur[k]! / cur[k - 1]!);
  const vbe = (t: number) => at(dev.pnp.vbe.tt[k - 1], t) + u * (at(dev.pnp.vbe.tt[k], t) - at(dev.pnp.vbe.tt[k - 1], t));
  const slope = (vbe(32) - vbe(22)) / 10;
  const tcr = (a125 - a27) / a27 / 98;
  const r2r1 = -(slope + K_Q * (1 - 300.15 * tcr)) / (K_Q * Math.log(intent.n));
  assert.ok(Math.abs(intent.r2r1 - r2r1) < 2e-4, `R2/R1 ${intent.r2r1} vs ${r2r1}`);
  // Pelgrom: 3 sigma(VBG) in half the band; the pair takes 80 % of the variance.
  const sigmaVos = 1.2 * 0.02 * 0.5 / 3 / (1 + intent.r2r1);
  const avt = out.card.devices.pmos.avtMvUm * 1e-3;
  const need = 2 * avt ** 2 / (0.8 * sigmaVos ** 2);
  const lim = out.card.devices.pmos;
  assert.ok(pairArea >= need || design.devices.M1.lUm === Math.max(...lim.lengthsUm) || design.devices.M1.wUm * 1.6 > lim.wMaxUm,
    `the pair's area ${pairArea} um2 reaches Pelgrom's ${need} um2 or the PDK's limit`);
});

/** A Campaign workspace with the Pack's flow and the recorded characterization, bound without a simulator. */
async function workspace(topology = 'kuijk-p5t-mirror'): Promise<{ readonly ws: string; readonly done: () => Promise<void> }> {
  const ws = await mkdtemp(path.join(os.tmpdir(), 'bandgap-ws-'));
  await mkdir(path.join(ws, 'flow'));
  await mkdir(path.join(ws, 'state'));
  for (const file of ['bg_cli.py', 'ota_cli.py', 'pdks.json']) await cp(path.join(flowDir, file), path.join(ws, 'flow', file));
  for (const file of ['tables-design.json', 'devices.json']) await cp(path.join(fixtures, 'synth180-tables', file), path.join(ws, 'state', file));
  const card = JSON.parse(await readFile(path.join(flowDir, 'pdks.json'), 'utf8')).cards.synth180;
  const sim = { name: 'ngspice', path: 'ngspice', version: 'ngspice-47' };
  await writeFile(path.join(ws, 'state/inputs.json'), JSON.stringify({ schema: 'hima-bandgap-inputs/1', simulators: { ngspice: sim },
    pdkRoot: path.join(repoRoot, 'test/fixtures/analog-pdks'), topology, pdks: { design: { name: 'synth180', card, files: [], simulator: sim } } }));
  await writeFile(path.join(ws, 'state/lessons.json'), JSON.stringify({ schema: 'hima-bandgap-lessons/1', rounds: [] }));
  await mkdir(path.join(ws, 'reports/size-agent/r1'), { recursive: true });
  await writeFile(path.join(ws, 'reports/size-agent/r1/analysis.md'), '# analysis\n');
  return { ws, done: () => rm(ws, { recursive: true, force: true }) };
}
function bgcli(ws: string, ...args: string[]) {
  return spawnSync('python3', ['-B', path.join(ws, 'flow/bg_cli.py'), args[0]!, ws, ...args.slice(1)], { encoding: 'utf8', cwd: ws });
}

test('precheck refuses what is not a legal design of the template and the intent', async () => {
  const { ws, done } = await workspace();
  try {
    await writeFile(path.join(ws, 'sheet.json'), JSON.stringify({ ...SPEC, choices: { n: 24 } }));
    const intent = bgcli(ws, 'draft', 'intent', path.join(ws, 'sheet.json'));
    assert.equal(intent.status, 0, intent.stderr);
    assert.equal(JSON.parse(intent.stdout).n, 24, 'a choice is kept');
    await writeFile(path.join(ws, 'sheet-ib.json'), JSON.stringify({ ...SPEC, choices: { ibiasUa: 1 } }));
    assert.match(bgcli(ws, 'draft', 'intent', path.join(ws, 'sheet-ib.json')).stderr, /ibiasUa must be 0.5 uA/);
    await writeFile(path.join(ws, 'intent.json'), intent.stdout);
    const drafted = bgcli(ws, 'draft', 'size', path.join(ws, 'intent.json'));
    assert.equal(drafted.status, 0, drafted.stderr);
    const good: Json = { ...JSON.parse(drafted.stdout), summary: 'first cut', reason: 'the method' };
    const check = async (doc: Json) => {
      await writeFile(path.join(ws, 'd.json'), JSON.stringify(doc));
      return bgcli(ws, 'precheck', path.join(ws, 'd.json'), ws);
    };
    const pass = await check(good);
    assert.equal(pass.status, 0, pass.stderr);
    assert.match(pass.stdout, /precheck PASS/);
    const cases: [string, (d: Json) => void, RegExp][] = [
      ['a measurement', (d) => { d.vbgV = 1.2; }, /unknown field\(s\) vbgV/],
      ['an unmatched pair', (d) => { d.devices.M2.wUm += 1; }, /M1 and M2 are a matched pair/],
      ['off grid', (d) => { d.devices.MT.wUm = 3.333; }, /MT W=3.333 um is off the 0.01 um grid/],
      ['unmatched R2', (d) => { d.resistors.R2b.s += 1; }, /R2a and R2b are matched/],
      ['a PNP ratio of 30', (d) => { d.n = 30; }, /n \(the PNP ratio\) must be a whole number from 2 to 24/],
      ['another template\'s devices', (d) => { delete d.devices.M5; }, /devices must be exactly/],
      ['sizes that are not the intent\'s', (d) => { d.devices.MO.wUm += 1; d.devices.M6.wUm += 0; }, /do not follow the intent/],
      ['a report elsewhere', (d) => { d.report = 'reports/size-agent/r1/notes.md'; }, /report must be reports\/size-agent\/r1\/analysis.md/],
      ['a capacitor multiplicity', (d) => { d.caps.CC.m = 0; }, /CC m \(capacitors in parallel\)/],
      ['another reference current', (d) => { d.ibiasUa = 0.6; }, /ibiasUa must be 0.5, the reference current the bench provides/],
      ['an unknown intent field', (d) => { d.intent.vbgV = 1.2; }, /intent has unknown field\(s\) vbgV/],
    ];
    for (const [label, edit, why] of cases) {
      const doc = JSON.parse(JSON.stringify(good));
      edit(doc);
      const run = await check(doc);
      assert.notEqual(run.status, 0, `${label} is refused`);
      assert.match(run.stderr, why, label);
    }
    // The cell for layout: the accepted design's, the same text the benches simulate.
    await writeFile(path.join(ws, 'state/design.json'), JSON.stringify(good));
    const cell = bgcli(ws, 'cell');
    assert.equal(cell.status, 0, cell.stderr);
    assert.match(cell.stdout, /^\.subckt bandgap_lb vdd vss en ibias vbg go g$/m);
    assert.equal(cell.stdout, bgcli(ws, 'cell', path.join(ws, 'd.json')).stdout);
    // A repair may name analysis-2.md (support paths are immutable).
    await writeFile(path.join(ws, 'reports/size-agent/r1/analysis-2.md'), '# repaired\n');
    assert.equal((await check({ ...good, report: 'reports/size-agent/r1/analysis-2.md' })).status, 0);
    // The spec's template has no M5/M6 and no driveRatio.
    const { ws: ws2, done: done2 } = await workspace('kuijk-p5t');
    try {
      await writeFile(path.join(ws2, 'd.json'), JSON.stringify(good));
      const run = bgcli(ws2, 'precheck', path.join(ws2, 'd.json'), ws2);
      assert.notEqual(run.status, 0);
      assert.match(run.stderr, /topology must be 'kuijk-p5t'/);
    } finally { await done2(); }
  } finally { await done(); }
});

test('the Pelgrom step scales the pair and load areas to the measured Monte Carlo sigma', async () => {
  const { ws, done } = await workspace();
  try {
    await writeFile(path.join(ws, 'sheet.json'), JSON.stringify(SPEC));
    const intent = JSON.parse(bgcli(ws, 'draft', 'intent', path.join(ws, 'sheet.json')).stdout);
    await writeFile(path.join(ws, 'intent.json'), JSON.stringify(intent));
    const want = 1.2 * 0.02 * intent.mcBandSharePct / 100 / 3;
    await writeFile(path.join(ws, 'state/mc.json'), JSON.stringify({ spec: { vbgV: 1.2, vbgTolPct: 2 }, stats: { sigmaV: 2 * want } }));
    const run = bgcli(ws, 'draft', 'mc', path.join(ws, 'intent.json'));
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stderr, /area x 4/);
    const next = JSON.parse(run.stdout);
    const area = (i: Json) => JSON.parse(spawnSync('python3', ['-B', '-c', [
      'import json, sys', `sys.path.insert(0, ${JSON.stringify(flowDir)})`, 'import bg_cli as bg',
      `card = json.load(open(${JSON.stringify(path.join(flowDir, 'pdks.json'))}))["cards"]["synth180"]`,
      `table = json.load(open(${JSON.stringify(path.join(fixtures, 'synth180-tables/tables-design.json'))}))`,
      `devices = json.load(open(${JSON.stringify(path.join(fixtures, 'synth180-tables/devices.json'))}))`,
      `intent = json.loads(${JSON.stringify(JSON.stringify(i))})`,
      'd = bg.size_from_intent(table, devices, card, intent, "kuijk-p5t-mirror")["devices"]',
      'print(json.dumps([bg.eff_area(card, "pmos", d["M1"]["wUm"], d["M1"]["lUm"]), bg.eff_area(card, "nmos", d["M3"]["wUm"], d["M3"]["lUm"])]))',
    ].join('\n')], { encoding: 'utf8' }).stdout);
    const [p0, l0] = area(intent);
    const [p1, l1] = area(next);
    assert.ok(p1 > 2 * p0 || next.pair.lUm === 40, `the pair grows (${p0} -> ${p1} um2)`);
    assert.ok(l1 > 2 * l0 || next.load.lUm === 40, `the load grows (${l0} -> ${l1} um2)`);
    for (const key of ['n', 'iCoreUa', 'r2r1', 'out', 'mirror']) assert.deepEqual(next[key], intent[key], `${key} is untouched`);
  } finally { await done(); }
});

test('the round record takes only measurements of the accepted design under this spec sheet', async () => {
  const { ws, done } = await workspace();
  try {
    await writeFile(path.join(ws, 'sheet.json'), JSON.stringify(SPEC));
    await writeFile(path.join(ws, 'intent.json'), bgcli(ws, 'draft', 'intent', path.join(ws, 'sheet.json')).stdout);
    const doc = { ...JSON.parse(bgcli(ws, 'draft', 'size', path.join(ws, 'intent.json')).stdout), summary: 's', reason: 'r' };
    await writeFile(path.join(ws, 'state/design.json'), JSON.stringify(doc));
    // Monte Carlo needs at least two runs.
    const mc = bgcli(ws, 'mc', '1', '1.2', '2');
    assert.notEqual(mc.status, 0);
    assert.match(mc.stderr, /N must be 2 to 1000 runs/);
    await writeFile(path.join(ws, 'state/measure-schematic.json'), JSON.stringify({ round: 1, designSha256: '0'.repeat(64) }));
    const args = ['1.2', '2', '8', '2', '100', '60', '100', '40'];
    const run = bgcli(ws, 'record', ...args);
    assert.equal(run.status, 0, run.stderr);
    const round = JSON.parse(await readFile(path.join(ws, 'state/round.json'), 'utf8'));
    assert.equal(round.roundValid, false);
    assert.ok(round.problems.includes('the measure-schematic result is not of the accepted design'));
    assert.ok(round.problems.includes('no PVT measurement of the accepted design this round'));
    assert.equal(round.failing, null, 'nothing measured is not "no failing line"');
  } finally { await done(); }
});

test('a missing saved trace is an error, never a zero; ngspice tables are checked for shape', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'bandgap-trace-'));
  try {
    await cp(path.join(fixtures, 'spectre-tt'), path.join(tmp, 'tt'), { recursive: true });
    const ac = path.join(tmp, 'tt/bg-tt-3.3V-loopv.raw/ac_p27.ac');
    await writeFile(ac, (await readFile(ac, 'utf8')).replace(/"go2"/g, '"gox"'));
    await writeFile(path.join(tmp, 'bad.dat'), ' frequency v(vbg1)\n1 2 3\n4 5\n');
    const out = py([
      'from pathlib import Path',
      `F = Path(${JSON.stringify(path.join(tmp, 'tt'))})`,
      'res = {}',
      'try:',
      '    bg.spectre_facts({p: F / ("bg-tt-3.3V-%s.raw" % p) for p, _ in bg.SPECTRE_PARTS}, (27,))',
      'except bg.ToolError as e:',
      '    res["spectre"] = str(e)',
      'try:',
      `    bg.checked_rows(${JSON.stringify(path.join(tmp, 'bad.dat'))}, 3, None)`,
      'except bg.ToolError as e:',
      '    res["rows"] = str(e)',
      'print(json.dumps(res))',
    ].join('\n'));
    assert.match(out.spectre, /loopv output .* lacks go2/);
    assert.match(out.rows, /rows of \[2, 3\] numbers/);
  } finally { await rm(tmp, { recursive: true, force: true }); }
});

test('worst corner and verdicts: a missing PSRR is unknown, a missing PM is a miss, the smallest of several crossings counts', () => {
  const out = py([
    'from pathlib import Path',
    `F = Path(${JSON.stringify(path.join(fixtures, 'spectre-tt'))})`,
    'facts = bg.spectre_facts({p: F / ("bg-tt-3.3V-%s.raw" % p) for p, _ in bg.SPECTRE_PARTS}, (27,))',
    'facts.update(process="tt", vdd=3.3)',
    'b = bg.bench_measures(facts)',
    'import copy',
    'b2 = copy.deepcopy(b); b2["vdd"] = 2.0; b2["temps"]["27"]["psrrDb"] = None',
    'b3 = copy.deepcopy(b); b3["process"] = "ss"; b3["temps"]["27"]["pmDeg"] = None',
    'spec = dict(vbgV=1.2, vbgTolPct=2, iqMaxUa=8, isdMaxNa=2, tcMaxPpm=100, pmMinDeg=60, tStartMaxUs=100, psrrMinDb=40)',
    'w = bg.worst_of([b, b2, b3], 1.2)',
    'freq = [1.0, 10.0, 100.0, 1000.0, 1e4]',
    'mag = [10, 0.5, 2, 0.5, 0.1]; ph = [-10, -100, -120, -150, -170]',
    'T = [m * complex(math.cos(math.radians(p)), math.sin(math.radians(p))) for m, p in zip(mag, ph)]',
    'print(json.dumps(dict(w=w, met=bg.line_met(w, spec), pm=bg.phase_margins(freq, T), mag=mag, ph=ph, freq=freq), default=lambda x: None))',
  ].join('\n'));
  assert.equal(out.w.psrr.value, null);
  assert.deepEqual(out.w.psrr.missing, ['tt 2V 27C']);
  assert.equal(out.met.psrr, null, 'a missing PSRR is unknown');
  assert.equal(out.w.pm.value, null);
  assert.equal(out.met.pm, false, 'a missing phase margin (no crossing) is a miss');
  // Three crossings; the margin at each, interpolated in log |T|.
  const expected: number[] = [];
  for (let i = 1; i < out.mag.length; i += 1) {
    const a = out.mag[i - 1], b = out.mag[i];
    if ((a - 1) * (b - 1) >= 0) continue;
    const u = Math.log10(a) / (Math.log10(a) - Math.log10(b));
    expected.push(180 + out.ph[i - 1] + u * (out.ph[i] - out.ph[i - 1]));
  }
  assert.equal(out.pm.crossings.length, 3);
  assert.deepEqual(out.pm.crossings.map((c: Json) => c.falling), [true, false, true]);
  assert.ok(Math.abs(out.pm.pmDeg - Math.min(...expected)) < 0.01, `${out.pm.pmDeg} vs ${Math.min(...expected)}`);
});

test('the post-layout cell must be the clean extraction of the accepted design; the record recomputes its verdict and takes N', async () => {
  const { ws, done } = await workspace();
  try {
    await writeFile(path.join(ws, 'sheet.json'), JSON.stringify(SPEC));
    await writeFile(path.join(ws, 'intent.json'), bgcli(ws, 'draft', 'intent', path.join(ws, 'sheet.json')).stdout);
    const doc = { ...JSON.parse(bgcli(ws, 'draft', 'size', path.join(ws, 'intent.json')).stdout), summary: 's', reason: 'r' };
    await writeFile(path.join(ws, 'state/design.json'), JSON.stringify(doc));
    const designSha = createHash('sha256').update(await readFile(path.join(ws, 'state/design.json'))).digest('hex');
    const args = ['1.2', '2', '8', '2', '100', '60', '100', '40'];
    // C1: no layout record, a stale extraction, a dirty layout: refused before any simulation.
    const cell = '.subckt bandgap_lb vdd vss en ibias vbg go g\nR1 vdd vss 1k\n.ends\n';
    await writeFile(path.join(ws, 'state/cell-post.spice'), cell);
    const cellSha = createHash('sha256').update(cell).digest('hex');
    assert.match(bgcli(ws, 'simulate', 'post', ...args).stderr, /not bound to the accepted design/);
    const layout = { round: 1, designSha256: designSha, postCellSha256: cellSha, clean: true, drcMagic: 0, drcKlayout: 0, lvsNetgen: true,
      lvsKlayout: true, areaUm2: 1 };
    await writeFile(path.join(ws, 'state/layout.json'), JSON.stringify({ ...layout, postCellSha256: '0'.repeat(64) }));
    assert.match(bgcli(ws, 'simulate', 'post', ...args).stderr, /not the extraction state\/layout.json recorded/);
    await writeFile(path.join(ws, 'state/layout.json'), JSON.stringify({ ...layout, clean: false }));
    assert.match(bgcli(ws, 'simulate', 'post', ...args).stderr, /layout of the accepted design is not clean/);
    await writeFile(path.join(ws, 'state/layout.json'), JSON.stringify(layout));
    // C2 and I5: a post-layout result that claims meetsSpec while its worst corner misses PSRR, and a
    // Monte Carlo of 50 runs where the Pack asks for 100.
    const worst = { vbg: { value: 1.2, where: 'tt' }, iq: { value: 5, where: 'tt' }, isd: { value: 0.1, where: 'tt' }, tc: { value: 20, where: 'tt' },
      pm: { value: 70, where: 'tt' }, start: { value: 50, where: 'tt' }, psrr: { value: 30, where: 'ss 2V -40C' } };
    const spec = { vbgV: 1.2, vbgTolPct: 2, iqMaxUa: 8, isdMaxNa: 2, tcMaxPpm: 100, pmMinDeg: 60, tStartMaxUs: 100, psrrMinDb: 40 };
    const measure = { round: 1, designSha256: designSha, spec, worst: { ...worst, psrr: { value: 50, where: 'tt' } } };
    await writeFile(path.join(ws, 'state/measure-schematic.json'), JSON.stringify(measure));
    await writeFile(path.join(ws, 'state/measure-post.json'), JSON.stringify({ ...measure, worst, cellSha256: cellSha, meetsSpec: true }));
    await writeFile(path.join(ws, 'state/mc.json'), JSON.stringify({ round: 1, designSha256: designSha, spec: { vbgV: 1.2, vbgTolPct: 2, n: 50 },
      stats: { n: 50, meanV: 1.2, sigmaV: 0.002, inBand: true } }));
    const run = bgcli(ws, 'record', ...args, '100');
    assert.equal(run.status, 0, run.stderr);
    const round = JSON.parse(await readFile(path.join(ws, 'state/round.json'), 'utf8'));
    assert.equal(round.postMet, false, 'the post verdict is recomputed from its worst corner');
    assert.equal(round.postLineMet.psrr, false);
    assert.ok(round.problems.includes('the Monte Carlo result has 50 runs, fewer than the 100 the Pack requires'));
    assert.equal(round.signedOff, false);
  } finally { await done(); }
});

test('a step refuses to record when the accepted design changed while it ran', async () => {
  const { ws, done } = await workspace();
  try {
    await writeFile(path.join(ws, 'sheet.json'), JSON.stringify(SPEC));
    await writeFile(path.join(ws, 'intent.json'), bgcli(ws, 'draft', 'intent', path.join(ws, 'sheet.json')).stdout);
    const doc = { ...JSON.parse(bgcli(ws, 'draft', 'size', path.join(ws, 'intent.json')).stdout), summary: 's', reason: 'r' };
    await writeFile(path.join(ws, 'state/design.json'), JSON.stringify(doc));
    const run = spawnSync('python3', ['-B', '-c', [
      'import json, sys', `sys.path.insert(0, ${JSON.stringify(path.join(ws, 'flow'))})`, 'import bg_cli as bg',
      `ws = ${JSON.stringify(ws)}`,
      'doc, facts = bg.validate_design(ws)',
      'first = bg.unchanged(ws, facts)',
      'doc["summary"] = "changed"; open(bg.design_path(ws), "w").write(json.dumps(doc))',
      'try:', '    bg.unchanged(ws, facts); print("recorded")', 'except bg.ToolError as e:', '    print(json.dumps(dict(first=first, error=str(e))))',
    ].join('\n')], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const out = JSON.parse(run.stdout);
    assert.match(out.first, /^[0-9a-f]{64}$/);
    assert.match(out.error, /state\/design.json changed while this step ran/);
  } finally { await done(); }
});

test('layout: every step of the layout tool must exit 0, and the extraction must be this run\'s', async () => {
  const { ws, done } = await workspace();
  try {
    await writeFile(path.join(ws, 'sheet.json'), JSON.stringify(SPEC));
    await writeFile(path.join(ws, 'intent.json'), bgcli(ws, 'draft', 'intent', path.join(ws, 'sheet.json')).stdout);
    const doc = { ...JSON.parse(bgcli(ws, 'draft', 'size', path.join(ws, 'intent.json')).stdout), summary: 's', reason: 'r' };
    await writeFile(path.join(ws, 'state/design.json'), JSON.stringify(doc));
    // A stand-in layout tool: `<tool> <netlist> bandgap_lb <out>` writes its facts; RC names the failing step.
    const tool = path.join(ws, 'fake-layout.py');
    await writeFile(tool, [
      '#!/usr/bin/env python3',
      'import json, os, sys',
      'netlist, cell, out = sys.argv[1:4]',
      'os.makedirs(out, exist_ok=True)',
      'bad = os.environ.get("FAKE_BAD", "")',
      'rc = lambda name: 1 if name == bad else 0',
      'facts = dict(schema="hima-cell-layout/1", cell=cell, netlist=netlist,',
      '             draw=dict(rc=rc("draw"), magicDrcErrors=0), klayoutDrc=dict(block=dict(rc=rc("block"), total=0), density=dict(rc=rc("density"), total=3)),',
      '             lvs=dict(rc=[0, rc("lvs")], match=True), klayoutLvs=dict(rc=rc("klvs"), match=True), pex=dict(rc=[0, 0], netlists={}),',
      '             render=dict(rc=rc("render"), bboxUm=[10, 20]))',
      'if bad == "norender": del facts["render"]["rc"]',
      'if bad == "": facts.update(densityRulesFilled=1, drcKlayoutFilled=0, klayoutLvsFilled=dict(match=True), pexOn="unfilled")',
      'if bad in ("fillfail", "onlyfillfail"): facts["fillFailures"] = ["fill: klayout exit code 1", "filled LVS did not run"]',
      'if bad == "fillfail": facts.update(densityRulesFilled=4, drcKlayoutFilled=None, klayoutLvsFilled={}, pexOn="unfilled")',
      'json.dump(facts, open(os.path.join(out, "layout.json"), "w"))',
      'open(os.path.join(out, "bandgap_lb_pex_c.spice"), "w").write(".subckt bandgap_lb vdd vss en ibias vbg go g\\n.ends\\n")',
    ].join('\n'));
    // The CLI passes the tool path as one argv entry; wrap the script in an executable.
    const wrapper = path.join(ws, 'layout-tool');
    await writeFile(wrapper, `#!/bin/sh\nexec python3 ${tool} "$@"\n`, { mode: 0o755 });
    const run = (bad: string) => spawnSync('python3', ['-B', path.join(ws, 'flow/bg_cli.py'), 'layout', ws, wrapper, 'c'],
      { encoding: 'utf8', cwd: ws, env: { ...process.env, FAKE_BAD: bad } });
    for (const [bad, why] of [['draw', /draw exit code 1/], ['density', /klayoutDrc.density exit code 1/], ['lvs', /lvs exit code \[0, 1\]/],
      ['klvs', /klayoutLvs exit code 1/], ['norender', /render exit code missing/]] as const) {
      const r = run(bad);
      assert.notEqual(r.status, 0, `${bad} is refused`);
      assert.match(r.stderr, why);
    }
    const good = run('');
    assert.equal(good.status, 0, good.stderr);
    const rec = JSON.parse(await readFile(path.join(ws, 'state/layout.json'), 'utf8'));
    assert.equal(rec.clean, true);
    assert.deepEqual(rec.fill, { densityRules: 1, drcKlayout: 0, lvsKlayout: true, pexOn: 'unfilled' }, 'the fill step is carried, not judged');
    // The fill step's problems (fillFailures) are carried and shown, never judged: the layout stays clean.
    const failures = ['fill: klayout exit code 1', 'filled LVS did not run'];
    const rpt = async () => {
      const dir = path.join(ws, 'reports/layout/r1');
      return readFile(path.join(dir, 'layout.rpt'), 'utf8');
    };
    for (const bad of ['fillfail', 'onlyfillfail']) {
      const r = run(bad);
      assert.equal(r.status, 0, r.stderr);
      const withFail = JSON.parse(await readFile(path.join(ws, 'state/layout.json'), 'utf8'));
      assert.equal(withFail.clean, true, `${bad}: fill problems never make a clean layout unclean`);
      assert.deepEqual(withFail.fill.failures, failures);
      if (bad === 'onlyfillfail') assert.deepEqual(withFail.fill, { failures }, 'fill is created for the failures alone');
      assert.match(await rpt(), /\| Fill step problems \(reported, not judged\) \| fill: klayout exit code 1; filled LVS did not run \|/);
      assert.match(await rpt(), /\| Verdict \| clean \|/);
    }
  } finally { await done(); }
});

test('every chart the flow writes is a valid hima-chart', () => {
  const out = py([
    'from pathlib import Path',
    'import ota_cli as ota',
    `F = Path(${JSON.stringify(path.join(fixtures, 'spectre-tt'))})`,
    'facts = bg.spectre_facts({p: F / ("bg-tt-3.3V-%s.raw" % p) for p, _ in bg.SPECTRE_PARTS}, (27,))',
    'facts.update(process="tt", vdd=3.3)',
    'b = bg.bench_measures(facts)',
    'spec_ = dict(vbgV=1.2, vbgTolPct=2, iqMaxUa=8, isdMaxNa=2, tcMaxPpm=100, pmMinDeg=60, tStartMaxUs=100, psrrMinDb=40)',
    'record = dict(spec=spec_, worst=bg.worst_of([b], 1.2), benches=[b])',
    `v, _ = bg.mc_values(${JSON.stringify(path.join(fixtures, 'spectre-mc/mc.raw'))})`,
    'mc = dict(stats=bg.mc_stats(v, 1.2, 2.0), simulator="spectre-23.1.0", conditions=dict(vdd=3.3))',
    'lay = dict(drcMagic=0, drcKlayout=0, lvsNetgen=True, lvsKlayout=True, areaUm2=12345.6, pdk="gf180mcuD", clean=True)',
    'print(json.dumps(dict(lines=bg.lines_chart(record, "Bandgap spec lines, worst corner (schematic)", "spectre, 10 corners (simulate-pvt)"),',
    '                      mc=bg.mc_chart(mc), layout=bg.layout_chart(lay), gmid=ota.gmid_chart(table))))',
  ].join('\n'));
  for (const [kind, doc] of Object.entries(out)) {
    const parsed = himaChart.safeParse(doc);
    assert.ok(parsed.success, `${kind}: ${JSON.stringify(parsed.error?.issues ?? [])}`);
  }
});

// ---------------------------------------------------------------- bgcore: the competitor's case (ladder, BGOK, 0.2 uA)

const TAPS = Array.from({ length: 120 }, (_, i) => `vref_${i + 1}`);

test('bgcore: the cell adds bgok and 120 tap pins, a 122.5-unit ladder from vbg, an en inverter and a VBE-referenced, bias-charged BGOK', () => {
  const out = py([
    'd = design_of("bgcore")',
    'print(json.dumps(dict(design=d, cell=bg.cell_spice(card, d), mc=bg.cell_spice(card, d, True))))',
  ].join('\n'));
  const { design, cell, mc } = out;
  const lines: string[] = cell.split('\n');
  assert.ok(lines.includes(`.subckt bandgap_lb vdd vss en ibias vbg go g bgok ${TAPS.join(' ')}`), 'bandgap_lb pins, in order, on one line');
  assert.ok(lines.includes(`.subckt bandgap vdd vss en ibias vbg bgok ${TAPS.join(' ')}`), 'bandgap: the same without go and g');
  assert.ok(lines.includes(`xlb vdd vss en ibias vbg g g bgok ${TAPS.join(' ')} bandgap_lb`), 'the closed cell joins go and g');
  assert.equal(design.ibiasUa, 0.2, 'the bgcore reference is 0.2 uA');
  const u = design.ladder;
  assert.deepEqual(Object.keys(u).sort(), ['lUm', 'wUm'], 'the ladder unit is one segment: W and L');
  const unit = (p: string, q: string, name: string) => `X${name} ${p} ${q} vss sres r_length=${u.lUm}u r_width=${u.wUm}u s=1`;
  const ladder = lines.filter((l) => /^XRL/.test(l));
  assert.equal(ladder.length, 124, 'RL0 as two parallel halves, then RL1..RL122');
  assert.ok(lines.includes(unit('vbg', 'vref_122', 'RL0a')) && lines.includes(unit('vbg', 'vref_122', 'RL0b')), 'RL0: two units in parallel');
  for (let k = 1; k <= 122; k += 1) {
    assert.ok(lines.includes(unit(`vref_${k}`, k === 1 ? 'vss' : `vref_${k - 1}`, `RL${k}`)), `RL${k} joins vref_${k} and vref_${k - 1}`);
  }
  // Tap k sits at VBG k / 122.5: the series resistance below vref_k over the whole.
  assert.equal(new Set(ladder.map((l) => l.split(' ').slice(3).join(' '))).size, 1, 'every segment is the same unit');
  // The en inverter, and o1 (with CC) held at vss while en is low.
  assert.ok(lines.includes('MENI1 enb en vdd vdd pch33 w=1u l=1u') && lines.includes('MENI2 enb en vss vss nch33 w=1u l=1u'));
  assert.ok(lines.includes('MEN5 o1 enb vss vss nch33 w=1u l=1u'));
  assert.ok(lines.includes('MEN7 su enb vss vss nch33 w=1u l=1u'), 'en low: the start-up node at vss');
  // BGOK: the ladder tap the method chose against VBE1 (node a), gates only, on a bias-mirror tail; equal inputs read
  // "not OK" (MOK8 is 4 x MOK7); okc drives okcb against a bias pull-up; okcb gates okf's bias charger and its discharge;
  // okf (with the MOS capacitor MOKC) is buffered into bgok; en low holds okc low and okcb high.
  const tap = design.bgokTap;
  assert.ok(Number.isInteger(tap) && tap >= 1 && tap <= 120 && design.intent.bgokTap === tap);
  const mos = (name: string) => lines.find((l) => l.startsWith(`${name} `));
  const dev = (name: string) => `w=${design.devices[name].wUm}u l=${design.devices[name].lUm}u`;
  assert.equal(mos('MOK2'), `MOK2 okt ibias vdd vdd pch33 ${dev('MOK2')}`);
  assert.equal(mos('MOK5'), `MOK5 okd vref_${tap} okt vdd pch33 w=10u l=1u`);
  assert.equal(mos('MOK6'), 'MOK6 okc a okt vdd pch33 w=10u l=1u');
  assert.equal(mos('MOK7'), 'MOK7 okd okd vss vss nch33 w=2u l=4u');
  assert.equal(mos('MOK8'), 'MOK8 okc okd vss vss nch33 w=8u l=4u');
  assert.equal(mos('MOK1'), 'MOK1 okc enb vss vss nch33 w=1u l=1u');
  assert.equal(mos('MOKI1'), `MOKI1 okcb ibias vdd vdd pch33 ${dev('MOKI1')}`);
  assert.equal(mos('MOKI2'), 'MOKI2 okcb okc vss vss nch33 w=1u l=1u');
  assert.equal(mos('MEN6'), 'MEN6 okcb en vdd vdd pch33 w=1u l=1u');
  assert.equal(mos('MOKF1'), `MOKF1 okp ibias vdd vdd pch33 ${dev('MOKF1')}`);
  assert.equal(mos('MOKF2'), 'MOKF2 okf okcb okp vdd pch33 w=1u l=1u');
  assert.equal(mos('MOKF3'), 'MOKF3 okf okcb vss vss nch33 w=1u l=1u');
  assert.equal(mos('MOKC'), 'MOKC vss okf vss vss nch33 w=10u l=10u');
  assert.equal(mos('MOKO1'), 'MOKO1 okg okf vdd vdd pch33 w=1u l=1u');
  assert.equal(mos('MOKB'), `MOKB okq ibias vdd vdd pch33 ${dev('MOKB')}`);
  assert.equal(mos('MOK3'), 'MOK3 bgok okg okq vdd pch33 w=1u l=1u');
  assert.equal(mos('MOK4'), 'MOK4 bgok okg vss vss nch33 w=4u l=1u');
  assert.equal(mos('MOKCB'), 'MOKCB vss bgok vss vss nch33 w=8u l=8u');
  assert.equal(mos('MEN4'), undefined);
  assert.equal(lines.filter((l) => / a /.test(` ${l.split(' ').slice(1, 5).join(' ')} `) && /^M/.test(l)).map((l) => l.split(' ')[0]).sort().join(','),
    'M1,MOK6', 'node a carries gates only (the OTA pair and the comparator)');
  assert.ok(lines.includes('MSU3 g su sux vss nch33 w=2u l=4u'), 'the start-up switch\'s gate gives su capacitance at 0.2 uA');
  for (const name of ['MOK2', 'MOKI1', 'MOKB']) assert.equal(design.devices[name].lUm, design.devices.MB0.lUm, `${name} mirrors the reference diode`);
  const wl = (name: string) => design.devices[name].wUm / design.devices[name].lUm;
  assert.ok(Math.abs(wl('MOKF1') / wl('MOK2') - 0.125) < 0.02, `the charger runs at an eighth of bgokNa (${wl('MOKF1') / wl('MOK2')})`);
  // The core is kuijk-p5t-mirror's.
  assert.ok(lines.some((l) => /^M5 go o1 ls vss nch33 /.test(l)) && lines.some((l) => /^M6 go go vdd vdd pch33 /.test(l)));
  assert.equal(lines.filter((l) => /^M/.test(l)).length, Object.keys(design.devices).length);
  // Mismatch: the MOS become the PDK's mismatch subcircuits; the ladder's resistors are in the cell either way.
  assert.equal(mc.split('\n').filter((l: string) => /^XRL/.test(l)).length, 124);
  assert.equal(mc.split('\n').filter((l: string) => /^M/.test(l)).length, 0);
});

test('bgcore: both benches wire bgok and the taps per copy, save bgok, and draw the design\'s 0.2 uA', () => {
  const out = py([
    'inputs = dict(pdkRoot="/pdk", topology="bgcore", pdks=dict(design=dict(name="synth180", card=card)))',
    'parts = {p: bg.bench_spectre(inputs, "tt", 3.3, 0.2, "/w/cell.spice", bg.TEMPS, p) for p, _ in bg.SPECTRE_PARTS}',
    'from pathlib import Path',
    'ng, files = bg.bench_ngspice(inputs, "tt", 3.3, 0.2, "/w/cell.spice", bg.TEMPS, Path("/w/bg-tt-3.3V"))',
    'mcs = bg.mc_spectre_lines(inputs, "/w/cell.spice", 3.3, 0.2, 10, 1)',
    'mcn = bg.mc_ngspice_lines(inputs, "/w/cell.spice", 3.3, 0.2, 10, 1)',
    'old = dict(inputs, topology="kuijk-p5t-mirror")',
    'print(json.dumps(dict(parts=parts, ng=ng, mcs=mcs, mcn=mcn, old=bg.mc_spectre_lines(old, "/w/cell.spice", 3.3, 0.5, 10, 1))))',
  ].join('\n'));
  const taps = (k: number) => TAPS.map((t) => `vr${k}_${t.split('_')[1]}`).join(' ');
  const parts: Record<string, string[]> = out.parts;
  for (const [part, k] of [['nominal', 1], ['loopv', 2], ['loopi', 3], ['off', 4], ['powerUp', 5], ['en1us', 6], ['en50us', 7], ['offref', 8]] as const) {
    const x = parts[part]!.filter((l) => /^X\d /.test(l));
    assert.equal(x.length, 1, part);
    const head = k === 5 ? 'X5 (vdd5 0 vdd5 ib5 vbg5 g5 g5' : k === 2 || k === 3 ? `X${k} (vdd${k} 0 en${k} ib${k} vbg${k} go${k} g${k}` : `X${k} (vdd${k} 0 en${k} ib${k} vbg${k} g${k} g${k}`;
    assert.equal(x[0], `${head} bgok${k} ${taps(k)}) bandgap_lb`, `${part}: copy ${k}'s pins`);
    assert.ok(parts[part]!.includes(`GIB${k} (ib${k} 0 ${k === 5 ? 'vdd5' : k === 8 ? 'vdd8' : `en${k}`} 0) vccs gm=6.06061e-08`), `${part}: 0.2 uA at 3.3 V`);
  }
  const save = (p: string) => parts[p]!.find((l) => l.startsWith('save '))!.split(' ').slice(1);
  assert.ok(save('nominal').includes('bgok1') && save('off').includes('bgok4'), 'bgok saved enabled and with en low');
  assert.ok(!save('offref').includes('bgok8') && !save('loopv').some((s) => s.startsWith('bgok')));
  const ng: string[] = out.ng;
  const nx = ng.filter((l) => /^X\d /.test(l));
  assert.equal(nx.length, 8);
  assert.equal(nx[0], `X1 vdd1 0 en1 ib1 vbg1 g1 g1 bgok1 ${taps(1)} bandgap_lb`);
  assert.equal(nx[1], `X2 vdd2 0 en2 ib2 vbg2 go2 g2 bgok2 ${taps(2)} bandgap_lb`);
  assert.ok(ng.includes('let hb1 = v(bgok1)') && ng.includes('let hb4 = v(bgok4)'));
  assert.ok(ng.some((l) => /^echo HIMA op p27 .* \$&hb1 \$&hb4$/.test(l)));
  assert.ok(out.mcs.includes(`X1 (vdd1 0 en1 ib1 vbg1 g1 g1 bgok1 ${taps(1)}) bandgap_lb`) && out.mcs.includes('GIB1 (ib1 0 en1 0) vccs gm=6.06061e-08'));
  assert.ok(out.mcn.includes(`X1 vdd1 0 en1 ib1 vbg1 g1 g1 bgok1 ${taps(1)} bandgap_lb`));
  assert.ok(out.old.includes('X1 (vdd1 0 en1 ib1 vbg1 g1 g1) bandgap_lb'), 'the other templates keep their pins');
});

/** The recorded tt 3.3 V bench with BGOK readings (bgcore) set per case; the judge's view of it. */
function bgokCase(on: number | null, off: number | null): Json {
  return py([
    'from pathlib import Path',
    `F = Path(${JSON.stringify(path.join(fixtures, 'spectre-tt'))})`,
    'facts = bg.spectre_facts({p: F / ("bg-tt-3.3V-%s.raw" % p) for p, _ in bg.SPECTRE_PARTS}, (27,))',
    'facts.update(process="tt", vdd=3.3)',
    'plain = bg.bench_measures(facts)',
    `facts["temps"]["27"].update(bgokOn=${on ?? 'None'}, bgokOff=${off ?? 'None'})`,
    'b = bg.bench_measures(facts)',
    'spec_ = dict(vbgV=1.2, vbgTolPct=2, iqMaxUa=8, isdMaxNa=2, tcMaxPpm=100, pmMinDeg=60, tStartMaxUs=100, psrrMinDb=40)',
    'w = bg.worst_of([b], 1.2)',
    'pw = bg.worst_of([plain], 1.2)',
    'record = dict(spec=spec_, worst=w, benches=[b], specMet=bg.line_met(w, spec_), marginPct=bg.margins_pct(w, spec_), meetsSpec=None,',
    '              pdk="synth180", stage="schematic", conditions=dict(corners=["tt"], supplies=[3.3]), simulator="spectre", elapsedS=1.0,',
    '              design=dict(n=8, ibiasUa=0.2, devices={}, resistors=json.load(open(F / "design.json"))["resistors"], caps={},',
    '                          ladder=dict(wUm=2.0, lUm=38.8)), claimBoundary=bg.claim_boundary(0.2))',
    'print(json.dumps(dict(t27=b["temps"]["27"], w=w, met=record["specMet"], margin=record["marginPct"], rpt=bg.measure_rpt(record),',
    '                      chart=bg.lines_chart(record, "Bandgap spec lines, worst corner (schematic)", "spectre, 1 corner (simulate-pvt)"),',
    '                      plain=dict(w=pw, met=bg.line_met(pw, spec_), margin=bg.margins_pct(pw, spec_))), default=lambda x: None))',
  ].join('\n'));
}

test('bgcore: the BGOK line passes high-when-enabled and low-with-en-low, fails either level, and is absent elsewhere', () => {
  const pass = bgokCase(3.29, 0.002);
  assert.ok(Math.abs(pass.t27.bgokOnRatio - 3.29 / 3.3) < 1e-12 && Math.abs(pass.t27.bgokOffRatio - 0.002 / 3.3) < 1e-12);
  const err = Math.max(100 * (1 - 3.29 / 3.3), 100 * 0.002 / 3.3);
  assert.ok(Math.abs(pass.w.bgok.value - err) < 1e-9, `the worst level error ${pass.w.bgok.value} vs ${err} % of vdd`);
  assert.equal(pass.w.bgok.onWhere, 'tt 3.3V 27C');
  assert.equal(pass.met.bgok, true);
  assert.ok(Math.abs(pass.margin.bgok - Math.round(100 * (10 - err) / 10 * 100) / 100) < 1e-9);
  assert.match(pass.rpt, /\| BGOK level error \| > 90 % vdd en high, < 10 % en low \| 0\.3 % vdd \| tt 3\.3V 27C \(en high\) \| /);
  assert.match(pass.rpt, /\| tt 3\.3V \| 0\.997 \| 0\.001 \|/);
  assert.match(pass.rpt, /0\.2 uA reference current/);
  const chart = himaChart.safeParse(pass.chart);
  assert.ok(chart.success, JSON.stringify(chart.error?.issues ?? []));
  assert.deepEqual(pass.chart.categories.slice(-2), ['BGOK level error', 'BGOK trip VBG']);
  assert.equal(pass.met.bgokTrip, false, 'no bgok trace in the transients: the trip line misses');
  // Enabled but low (an 0.85 vdd bgok): the line fails, at the enabled copy.
  const low = bgokCase(0.85 * 3.3, 0.0);
  assert.equal(low.met.bgok, false);
  assert.match(low.w.bgok.where, /\(en high\)$/);
  assert.ok(low.margin.bgok < 0);
  // Disabled but high (0.2 vdd with en low): fails at the en-low copy.
  const high = bgokCase(3.3, 0.2 * 3.3);
  assert.equal(high.met.bgok, false);
  assert.match(high.w.bgok.where, /\(en low\)$/);
  assert.ok(Math.abs(high.w.bgok.offMaxRatio - 0.2) < 1e-12);
  // A missing reading is a miss, never a pass.
  const missing = bgokCase(null, 0.0);
  assert.equal(missing.w.bgok.value, null);
  assert.equal(missing.met.bgok, false);
  // The other templates: no BGOK line anywhere.
  assert.equal(pass.plain.w.bgok, undefined);
  assert.deepEqual(Object.keys(pass.plain.met).sort(), ['iq', 'isd', 'pm', 'psrr', 'start', 'tc', 'vbg']);
  assert.equal(pass.plain.margin.bgok, undefined);
  assert.equal(pass.plain.w.bgokTrip, undefined);
});

test('start-up is causal: VBG inside its final band before en starts rising is a miss with a reason, never 0 us', () => {
  const out = py([
    'time = [k * 1e-7 for k in range(3001)]',
    'early = [1.2 if t >= 9.45e-6 else 0.0 for t in time]',
    'late = [1.2 * (1 - math.exp(-(t - 10e-6) / 5e-6)) if t >= 10e-6 else 0.0 for t in time]',
    'from pathlib import Path',
    `F = Path(${JSON.stringify(path.join(fixtures, 'spectre-tt'))})`,
    'facts = bg.spectre_facts({p: F / ("bg-tt-3.3V-%s.raw" % p) for p, _ in bg.SPECTRE_PARTS}, (27,))',
    'facts.update(process="tt", vdd=3.3)',
    'tr = facts["temps"]["27"]["tran"]',
    'final = tr["en1us"]["v"][-1]',
    'tr["en1us"]["v"] = [final] * len(tr["en1us"]["v"])',
    'tr["powerUp"]["v"] = [final] * len(tr["powerUp"]["v"])',
    'b = bg.bench_measures(facts)',
    'spec_ = dict(vbgV=1.2, vbgTolPct=2, iqMaxUa=8, isdMaxNa=2, tcMaxPpm=100, pmMinDeg=60, tStartMaxUs=100, psrrMinDb=40)',
    'w = bg.worst_of([b], 1.2)',
    'print(json.dumps(dict(early=bg.start_time_us(time, early, 10.5, 1.2, trigger_us=10.0), untriggered=bg.start_time_us(time, early, 10.5, 1.2),',
    '                      late=bg.start_time_us(time, late, 10.5, 1.2, trigger_us=10.0), t27=b["temps"]["27"], w=w["start"],',
    '                      met=bg.line_met(w, spec_)), default=lambda x: None))',
  ].join('\n'));
  assert.equal(out.early[0], null, 'in band 0.5 us before en rises: a miss');
  assert.match(out.early[2], /inside its final \+\/-2 % band at 9\.500 us, before en started rising at 10 us/);
  assert.equal(out.untriggered[0], 0, 'without a trigger (the power-up ramp) the same trace is not refused');
  assert.ok(Math.abs(out.late[0] - (5 * Math.log(50) - 0.5)) < 0.05, `a causal start is timed (${out.late[0]} us)`);
  assert.equal(out.late[2], null);
  // In the bench: the en ramp that was already up is a miss; the power-up ramp is unaffected.
  assert.equal(out.t27.starts.en1us.us, null);
  assert.match(out.t27.starts.en1us.reason, /before en started rising at 10 us/);
  assert.equal(out.t27.starts.powerUp.us, 0);
  assert.ok(out.t27.starts.en50us.us > 0);
  assert.equal(out.t27.startUs, null);
  assert.match(out.t27.startReason, /^en1us: VBG was inside/);
  assert.equal(out.w.value, null);
  assert.match(out.w.reasons['tt 3.3V 27C'], /en1us: .*en did not start it/);
  assert.equal(out.met.start, false, 'the start-up line misses');
});

test('bgcore: the first cut takes the ladder and the BGOK pull-up out of the IQ budget at 0.2 uA', () => {
  const out = py([
    'd = design_of("bgcore")',
    'm = design_of("kuijk-p5t-mirror")',
    'print(json.dumps(dict(design=d, mirror=m)))',
  ].join('\n'));
  const { design, mirror } = out;
  const intent = design.intent;
  const dev = JSON.parse(spawnSync('cat', [path.join(fixtures, 'synth180-tables/devices.json')], { encoding: 'utf8' }).stdout);
  const temps: number[] = dev.temps;
  const at = (row: number[], t: number) => {
    const i = temps.findIndex((x) => x >= t);
    return temps[i] === t ? row[i]! : row[i - 1]! + (t - temps[i - 1]!) / (temps[i]! - temps[i - 1]!) * (row[i]! - row[i - 1]!);
  };
  const fit = (corner: string, w: number, t: number) => {
    const r10 = at(dev.res.r[corner][`${w}/10`], t), r40 = at(dev.res.r[corner][`${w}/40`], t);
    const a = (r40 - r10) / 30;
    return [a, r10 - 10 * a] as const;
  };
  const [a27, b27] = fit('tt', 2, 27);
  const [a125] = fit('tt', 2, 125);
  const corners = Object.keys(dev.res.r);
  const aff = Math.min(...corners.map((c) => fit(c, 2, 27)[0]));
  const aMin = Math.min(...corners.flatMap((c) => [-40, 27, 125].map((t) => fit(c, 2, t)[0])));
  const kHot = (398.15 / 300.15) * (a27 / a125) * (a27 / aff);
  // The ladder draws IQ/16 at the VBG target through 122.5 units; the unit rounds to 0.1 kOhm.
  assert.equal(intent.ladderRUnitKohm, Math.round(1.2 / 122.5 / (8 / 16 * 1e-6) / 1e3 * 10) / 10);
  assert.equal(intent.bgokNa, 50);
  assert.deepEqual([intent.ibiasUa, intent.itailUa], [0.2, 0.4]);
  assert.equal(intent.ccPf, 4, 'CC scales with the tail: the 0.5 uA design\'s slew rate and gm/CC');
  // The ladder carries the VBG the core makes: VBE of Q1 at the core current plus (R2/R1) VT ln n (tt, 27 C).
  const cur: number[] = dev.pnp.currentsUa;
  const vbeAt = (i: number) => {
    const k = cur.findIndex((c) => c >= i);
    const u = Math.log(i / cur[k - 1]!) / Math.log(cur[k]! / cur[k - 1]!);
    return at(dev.pnp.vbe.tt[k - 1], 27) + u * (at(dev.pnp.vbe.tt[k], 27) - at(dev.pnp.vbe.tt[k - 1], 27));
  };
  const vbgCore = vbeAt(intent.iCoreUa) + intent.r2r1 * K_Q * 300.15 * Math.log(intent.n);
  assert.ok(vbgCore > 1.1 && vbgCore < 1.3, `the core's VBG ${vbgCore}`);
  const iL = vbgCore / (122.5 * intent.ladderRUnitKohm * 1e3) * 1e6;
  const iLHot = iL * a27 / aMin;
  const drive = 1 + 1 / intent.driveRatio;
  // The BGOK block draws two bias mirrors at bgokNa (the comparator's tail, okcb's pull-up once OK).
  const iCore = (0.8 * 8 - 0.2 - 0.4 - 0.025 - 0.1 - iLHot * drive) / ((2 + 2 / intent.driveRatio) * kHot);
  assert.ok(Math.abs(intent.iCoreUa - iCore) < 1e-3, `core current ${intent.iCoreUa} vs ${iCore}`);
  // The worst-case IQ the budget allows: 80 % of the line, the ladder included.
  const iq = 0.2 + 0.4 + 0.025 + 0.1 + (2 * intent.iCoreUa * kHot + iLHot) * drive;
  // The tap: the lowest whose settled voltage sits 50 mV above the PNP's highest VBE1 at -40 C at the core current plus
  // the comparator's offset there, 1.3 VT ln 4.
  const offset = 1.3 * K_Q * 233.15 * Math.log(4);
  const vbeCold = Math.max(...Object.keys(dev.pnp.vbe).map((c) => {
    const k = cur.findIndex((x) => x >= intent.iCoreUa);
    const u = Math.log(intent.iCoreUa / cur[k - 1]!) / Math.log(cur[k]! / cur[k - 1]!);
    return dev.pnp.vbe[c][k - 1][0] + u * (dev.pnp.vbe[c][k][0] - dev.pnp.vbe[c][k - 1][0]);
  }));
  assert.equal(temps[0], -40);
  assert.equal(intent.bgokTap, Math.ceil(122.5 * (vbeCold + offset + 0.05) / vbgCore - 1e-9), `tap ${intent.bgokTap}`);
  assert.ok(intent.bgokTap / 122.5 * vbgCore >= vbeCold + offset + 0.05 && (intent.bgokTap - 1) / 122.5 * vbgCore < vbeCold + offset + 0.05);
  assert.ok(Math.abs(iq - 6.4) < 0.01, `IQ budget ${iq} uA`);
  // The unit segment is ladderRUnitKohm at the core resistors' width, one segment.
  const unit = a27 * design.ladder.lUm + b27;
  assert.ok(Math.abs(unit - intent.ladderRUnitKohm * 1e3) / unit < 0.002, `unit ${unit} Ohm`);
  assert.equal(design.ladder.wUm, intent.resWUm);
  // The output device carries the core and the ladder; M6 is 1 / driveRatio of it.
  assert.equal(design.intent.out.gmId, 10, 'the mirror templates\' output device in moderate inversion');
  assert.ok(design.devices.MO.wUm > mirror.devices.MO.wUm * (2 * intent.iCoreUa + iL) / (2 * mirror.intent.iCoreUa) * 0.97);
  assert.ok(Math.abs(design.devices.MO.wUm / design.devices.M6.wUm - intent.driveRatio) < 0.05);
  // kuijk-p5t-mirror is unchanged: no ladder, no BGOK, 0.5 uA.
  assert.equal(mirror.ladder, undefined);
  assert.equal(mirror.intent.ladderRUnitKohm, undefined);
  assert.equal(mirror.intent.bgokNa, undefined);
  assert.equal(mirror.ibiasUa, 0.5);
  assert.equal(mirror.intent.ccPf, 10);
  assert.equal(mirror.devices.MOK1, undefined);
  assert.deepEqual(mirror.devices.MSU3, { wUm: 1, lUm: 1 });
});

test('bgcore: precheck, cell, the post-layout pins and the record judge the case\'s own fields and lines', async () => {
  const { ws, done } = await workspace('bgcore');
  try {
    await writeFile(path.join(ws, 'sheet.json'), JSON.stringify(SPEC));
    const intentRun = bgcli(ws, 'draft', 'intent', path.join(ws, 'sheet.json'));
    assert.equal(intentRun.status, 0, intentRun.stderr);
    await writeFile(path.join(ws, 'intent.json'), intentRun.stdout);
    await writeFile(path.join(ws, 'sheet-ib.json'), JSON.stringify({ ...SPEC, choices: { ibiasUa: 0.5 } }));
    assert.match(bgcli(ws, 'draft', 'intent', path.join(ws, 'sheet-ib.json')).stderr, /ibiasUa must be 0.2 uA/);
    await writeFile(path.join(ws, 'sheet-big.json'), JSON.stringify({ ...SPEC, choices: { ladderRUnitKohm: 500 } }));
    const big = bgcli(ws, 'draft', 'intent', path.join(ws, 'sheet-big.json'));
    assert.equal(big.status, 0, big.stderr);
    await writeFile(path.join(ws, 'intent-big.json'), big.stdout);
    assert.match(bgcli(ws, 'draft', 'size', path.join(ws, 'intent-big.json')).stderr, /a ladder unit of 500 kOhm is longer than one 200 um segment/);
    // A tap choice is a whole number; a mirror too small for the PDK's longest device is refused, never capped.
    await writeFile(path.join(ws, 'sheet-tap.json'), JSON.stringify({ ...SPEC, choices: { bgokTap: 88.7 } }));
    assert.match(bgcli(ws, 'draft', 'intent', path.join(ws, 'sheet-tap.json')).stderr, /choices bgokTap must be a whole number \(a tap\), not 88.7/);
    await writeFile(path.join(ws, 'intent-tiny.json'), JSON.stringify({ ...JSON.parse(intentRun.stdout), bgokNa: 0.5 }));
    assert.match(bgcli(ws, 'draft', 'size', path.join(ws, 'intent-tiny.json')).stderr,
      /a 0.5 nA mirror of the 0.2 uA reference needs L [\d.]+ um, past the PDK's 50 um/);
    const drafted = bgcli(ws, 'draft', 'size', path.join(ws, 'intent.json'));
    assert.equal(drafted.status, 0, drafted.stderr);
    const good: Json = { ...JSON.parse(drafted.stdout), summary: 'first cut', reason: 'the method' };
    // The cell of a draft (cell <file>) checks the tap too: no traceback, no floating comparator gate.
    for (const [tap, why] of [[undefined, /found None/], [500, /found 500/]] as const) {
      const doc = JSON.parse(JSON.stringify(good));
      if (tap === undefined) delete doc.bgokTap; else doc.bgokTap = tap;
      await writeFile(path.join(ws, 'draft-tap.json'), JSON.stringify(doc));
      const r = bgcli(ws, 'cell', path.join(ws, 'draft-tap.json'));
      assert.equal(r.status, 3, r.stderr);
      assert.match(r.stderr, why);
      assert.doesNotMatch(r.stderr, /Traceback/);
    }
    const check = async (doc: Json) => {
      await writeFile(path.join(ws, 'd.json'), JSON.stringify(doc));
      return bgcli(ws, 'precheck', path.join(ws, 'd.json'), ws);
    };
    assert.equal((await check(good)).status, 0);
    const cases: [string, (d: Json) => void, RegExp][] = [
      ['no ladder', (d) => { delete d.ladder; }, /ladder \(the reference ladder's unit segment, \{wUm, lUm\}\) is missing/],
      ['a ladder off grid', (d) => { d.ladder.lUm = 38.805; }, /ladder L=38.805 um is off the 0.01 um grid/],
      ['the old reference', (d) => { d.ibiasUa = 0.5; }, /ibiasUa must be 0.2, the reference current the bench provides/],
      ['no BGOK pull-up', (d) => { delete d.devices.MOK2; }, /devices must be exactly/],
      ['a ladder that is not the intent\'s', (d) => { d.ladder.lUm += 1; }, /do not follow the intent/],
      ['no BGOK tap', (d) => { delete d.bgokTap; }, /bgokTap \(the ladder tap BGOK senses\) must be a whole number from 1 to 120 \(found None\)/],
      ['a BGOK tap of 0', (d) => { d.bgokTap = 0; }, /must be a whole number from 1 to 120 \(found 0\)/],
      ['a BGOK tap past the pins', (d) => { d.bgokTap = 121; }, /must be a whole number from 1 to 120 \(found 121\)/],
      ['a fractional BGOK tap', (d) => { d.bgokTap = 88.5; }, /must be a whole number from 1 to 120 \(found 88.5\)/],
      ['a boolean BGOK tap', (d) => { d.bgokTap = true; }, /must be a whole number from 1 to 120 \(found True\)/],
    ];
    for (const [label, edit, why] of cases) {
      const doc = JSON.parse(JSON.stringify(good));
      edit(doc);
      const run = await check(doc);
      assert.notEqual(run.status, 0, `${label} is refused`);
      assert.match(run.stderr, why, label);
    }
    await writeFile(path.join(ws, 'state/design.json'), JSON.stringify(good));
    const cell = bgcli(ws, 'cell');
    assert.equal(cell.status, 0, cell.stderr);
    assert.match(cell.stdout, new RegExp(`^\\.subckt bandgap_lb vdd vss en ibias vbg go g bgok ${TAPS.join(' ')}$`, 'm'));
    // The extracted cell must carry the 128 pins in order: a 7-pin extraction is refused before any simulation.
    const designSha = createHash('sha256').update(await readFile(path.join(ws, 'state/design.json'))).digest('hex');
    const post = '.subckt bandgap_lb vdd vss en ibias vbg go g\nR1 vdd vss 1k\n.ends\n';
    await writeFile(path.join(ws, 'state/cell-post.spice'), post);
    await writeFile(path.join(ws, 'state/layout.json'), JSON.stringify({ round: 1, designSha256: designSha, clean: true,
      postCellSha256: createHash('sha256').update(post).digest('hex') }));
    const args = ['1.2', '2', '8', '2', '100', '60', '100', '40'];
    assert.match(bgcli(ws, 'simulate', 'post', ...args).stderr, /bandgap_lb pins are not, in order, vdd vss en ibias vbg go g bgok \.\.\. vref_120/);
    await rm(path.join(ws, 'state/layout.json'));
    // The record: a bgcore measurement without a BGOK line is a problem; a failing BGOK line keeps the round unsigned.
    const worst = { vbg: { value: 1.2, where: 'tt' }, iq: { value: 5, where: 'tt' }, isd: { value: 0.1, where: 'tt' }, tc: { value: 20, where: 'tt' },
      pm: { value: 70, where: 'tt' }, start: { value: 50, where: 'tt' }, psrr: { value: 50, where: 'tt' } };
    const spec = { vbgV: 1.2, vbgTolPct: 2, iqMaxUa: 8, isdMaxNa: 2, tcMaxPpm: 100, pmMinDeg: 60, tStartMaxUs: 100, psrrMinDb: 40 };
    await writeFile(path.join(ws, 'state/measure-schematic.json'), JSON.stringify({ round: 1, designSha256: designSha, spec, worst }));
    let run = bgcli(ws, 'record', ...args);
    assert.equal(run.status, 0, run.stderr);
    let round = JSON.parse(await readFile(path.join(ws, 'state/round.json'), 'utf8'));
    assert.ok(round.problems.includes('the measure-schematic result has no bgok or bgokTrip line (the bgcore template judges it)'));
    assert.equal(round.roundValid, false);
    await writeFile(path.join(ws, 'state/lessons.json'), JSON.stringify({ schema: 'hima-bandgap-lessons/1', rounds: [] }));
    await writeFile(path.join(ws, 'state/measure-schematic.json'), JSON.stringify({ round: 1, designSha256: designSha, spec,
      worst: { ...worst, bgok: { value: 24.2, where: 'ss 2V -40C (en high)' }, bgokTrip: { value: 70, where: 'tt 3.3V 27C powerUp' } } }));
    run = bgcli(ws, 'record', ...args);
    assert.equal(run.status, 0, run.stderr);
    round = JSON.parse(await readFile(path.join(ws, 'state/round.json'), 'utf8'));
    assert.deepEqual(round.problems, []);
    assert.equal(round.pvtMet.bgok, false);
    assert.equal(round.pvtMet.bgokTrip, true);
    assert.deepEqual(round.failing, ['bgok', 'mc']);
    assert.equal(round.pvtWorst.bgok, 24.2);
    assert.equal(round.signedOff, false);
    assert.match(round.claimBoundary, /ideal 0\.2 uA reference current/);
    assert.match(await readFile(path.join(ws, 'derived/round-1.md'), 'utf8'), /\| BGOK level error \| 24\.2 % vdd \| ss 2V -40C \(en high\) \| no \|/);
    // After layout: the extracted cell's measurement is judged on both BGOK lines too; one without them is dropped.
    const post128 = `.subckt bandgap_lb vdd vss en ibias vbg go g bgok ${TAPS.join(' ')}\n.ends\n`;
    await writeFile(path.join(ws, 'state/cell-post.spice'), post128);
    const postSha = createHash('sha256').update(post128).digest('hex');
    await writeFile(path.join(ws, 'state/layout.json'), JSON.stringify({ round: 1, designSha256: designSha, postCellSha256: postSha, clean: true,
      drcMagic: 0, drcKlayout: 0, lvsNetgen: true, lvsKlayout: true, areaUm2: 1 }));
    const passing = { ...worst, bgok: { value: 0.1, where: 'tt' }, bgokTrip: { value: 70, where: 'tt' } };
    await writeFile(path.join(ws, 'state/measure-schematic.json'), JSON.stringify({ round: 1, designSha256: designSha, spec, worst: passing }));
    await writeFile(path.join(ws, 'state/mc.json'), JSON.stringify({ round: 1, designSha256: designSha, spec: { vbgV: 1.2, vbgTolPct: 2, n: 100 },
      stats: { n: 100, meanV: 1.2, sigmaV: 0.002, inBand: true } }));
    const postRecord = async (w: Json) => {
      await writeFile(path.join(ws, 'state/lessons.json'), JSON.stringify({ schema: 'hima-bandgap-lessons/1', rounds: [] }));
      await writeFile(path.join(ws, 'state/measure-post.json'), JSON.stringify({ round: 1, designSha256: designSha, spec, worst: w, cellSha256: postSha }));
      const r = bgcli(ws, 'record', ...args, '100');
      assert.equal(r.status, 0, r.stderr);
      return JSON.parse(await readFile(path.join(ws, 'state/round.json'), 'utf8'));
    };
    round = await postRecord(passing);
    assert.deepEqual(round.problems, []);
    assert.equal(round.signedOff, true, 'every line before and after layout, Monte Carlo and a clean layout');
    round = await postRecord({ ...passing, bgokTrip: { value: 16.5, where: 'ff 3.3V 125C powerUp' } });
    assert.equal(round.postLineMet.bgokTrip, false);
    assert.equal(round.postMet, false);
    assert.equal(round.signedOff, false);
    assert.match(await readFile(path.join(ws, 'derived/round-1.md'), 'utf8'), /\| BGOK trip VBG \| 16\.5 % final \| ff 3\.3V 125C powerUp \| no \|/);
    round = await postRecord(worst);
    assert.ok(round.problems.includes('the measure-post result has no bgok or bgokTrip line (the bgcore template judges it)'));
    assert.equal(round.postMet, null, 'a post-layout result without the BGOK lines is not taken');
    assert.equal(round.signedOff, false);
    // The other template's record keeps its seven lines and its 0.5 uA boundary.
    const { ws: ws2, done: done2 } = await workspace('kuijk-p5t-mirror');
    try {
      await writeFile(path.join(ws2, 'd.json'), JSON.stringify(good));
      assert.match(bgcli(ws2, 'precheck', path.join(ws2, 'd.json'), ws2).stderr, /ladder: the kuijk-p5t-mirror template has no reference ladder/);
      await writeFile(path.join(ws2, 'd2.json'), JSON.stringify({ ...good, ladder: undefined, topology: 'kuijk-p5t-mirror' }));
      assert.match(bgcli(ws2, 'precheck', path.join(ws2, 'd2.json'), ws2).stderr, /bgokTap: the kuijk-p5t-mirror template has no reference ladder/);
    } finally { await done2(); }
  } finally { await done(); }
});

test('a fresh workspace seeds its Spectre runs from the Site\'s copy beside the wrapper; its own copy wins after', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bg-seed-'));
  try {
    const ws = path.join(dir, 'ws');
    const wrapper = path.join(dir, 'bin', 'spectre');
    await mkdir(path.join(ws, 'state'), { recursive: true });
    await mkdir(`${wrapper}.ahdl-seed/mod.ahdlcmi`, { recursive: true });
    await writeFile(`${wrapper}.ahdl-seed/mod.ahdlcmi/code`, 'site');
    await writeFile(path.join(ws, 'state', 'inputs.json'), JSON.stringify({ simulators: { spectre: { path: wrapper } } }));
    const seeded = py([
      'from pathlib import Path',
      `ws = Path(${JSON.stringify(ws)})`,
      'seed = ws / "work" / "spectre-ahdl"',
      'bg.ahdl_seed(seed, ws)',
      'first = (seed / "mod.ahdlcmi" / "code").read_text()',
      '(seed / "mod.ahdlcmi" / "code").write_text("own")',
      'bg.ahdl_seed(seed, ws)',
      'print(json.dumps(dict(first=first, after=(seed / "mod.ahdlcmi" / "code").read_text(), current=str(bg.AHDL_SEED[0]))))',
    ].join('\n'));
    assert.equal(seeded.first, 'site', 'a fresh workspace starts from the Site\'s copy');
    assert.equal(seeded.after, 'own', 'a workspace that has its own compiled code keeps it');
    assert.equal(seeded.current, path.join(ws, 'work', 'spectre-ahdl'));
    const none = py([
      'from pathlib import Path',
      `ws = Path(${JSON.stringify(path.join(dir, 'other'))})`,
      'bg.ahdl_seed(ws / "work" / "spectre-ahdl", ws)',
      'print(json.dumps((ws / "work" / "spectre-ahdl").exists()))',
    ].join('\n'));
    assert.equal(none, false, 'no inputs and no Site copy: nothing is invented');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('bgcore: BGOK stays low until VBG reaches half its final value in every start-up transient, and ends high', () => {
  const out = py([
    'time = [k * 1e-7 for k in range(3001)]',
    'vbg = [0.0 if t < 10e-6 else 1.2 * (1 - math.exp(-(t - 10e-6) / 5e-6)) for t in time]',
    'at = lambda frac: [3.3 if v >= frac * 1.2 and t >= 10e-6 else 0.0 for t, v in zip(time, vbg)]',
    'cases = dict(good=bg.bgok_trip(time, vbg, at(0.7), 3.3), early=bg.bgok_trip(time, vbg, at(0.3), 3.3),',
    '             follows=bg.bgok_trip(time, vbg, [3.3 if t >= 10e-6 else 0.0 for t in time], 3.3),',
    '             never=bg.bgok_trip(time, vbg, [0.0] * len(time), 3.3), missing=bg.bgok_trip(time, vbg, None, 3.3))',
    'from pathlib import Path',
    `F = Path(${JSON.stringify(path.join(fixtures, 'spectre-tt'))})`,
    'res = {}',
    'for name, frac in (("pass", 0.7), ("early", 0.3), ("never", None)):',
    '    facts = bg.spectre_facts({p: F / ("bg-tt-3.3V-%s.raw" % p) for p, _ in bg.SPECTRE_PARTS}, (27,))',
    '    facts.update(process="tt", vdd=3.3)',
    '    f = facts["temps"]["27"]',
    '    f.update(bgokOn=3.3, bgokOff=0.0)',
    '    for key, tr in f["tran"].items():',
    '        fin = tr["v"][-1]',
    '        k = None if frac is None else next(i for i, x in enumerate(tr["v"]) if x >= frac * fin)',
    '        tr["bgok"] = [0.0 if k is None or i <= k else 3.3 for i in range(len(tr["v"]))]   # high from the sample after VBG passed frac',
    '    b = bg.bench_measures(facts)',
    '    spec_ = dict(vbgV=1.2, vbgTolPct=2, iqMaxUa=8, isdMaxNa=2, tcMaxPpm=100, pmMinDeg=60, tStartMaxUs=100, psrrMinDb=40)',
    '    w = bg.worst_of([b], 1.2)',
    '    res[name] = dict(trips=b["temps"]["27"]["bgokTrips"], w=w["bgokTrip"], met=bg.line_met(w, spec_)["bgokTrip"], margin=bg.margins_pct(w, spec_)["bgokTrip"])',
    'print(json.dumps(dict(cases=cases, bench=res)))',
  ].join('\n'));
  const { cases, bench } = out;
  // The trip is VBG when bgok first leaves its low level (10 % vdd), as a fraction of VBG's final value.
  assert.ok(Math.abs(cases.good.pct - 70) < 1.5 && cases.good.reason === null, JSON.stringify(cases.good));
  assert.ok(Math.abs(cases.early.pct - 30) < 1.5);
  assert.ok(cases.follows.pct < 1, 'a monitor that follows en trips with VBG near 0');
  assert.equal(cases.never.pct, null);
  assert.match(cases.never.reason, /bgok ends at 0\.000 V, not above 90 % of vdd/);
  assert.equal(cases.missing.pct, null);
  assert.match(cases.missing.reason, /no bgok trace/);
  // Judged at every transient of every corner: the lowest trip counts, with where.
  assert.equal(bench.pass.met, true);
  assert.ok(Math.abs(bench.pass.w.value - Math.min(...Object.values(bench.pass.trips).map((x: any) => x.pct))) < 1e-9);
  assert.match(bench.pass.w.where, /^tt 3\.3V 27C (powerUp|en1us|en50us)$/);
  assert.ok(bench.pass.w.tripV > 0 && bench.pass.margin > 0);
  assert.deepEqual(Object.keys(bench.pass.w.perCornerV), ['tt 3.3V 27C']);
  assert.equal(bench.early.met, false, 'an early trip fails');
  assert.ok(bench.early.margin < 0);
  assert.equal(bench.never.met, false, 'a bgok that never rises fails');
  assert.equal(bench.never.w.value, null);
  assert.equal(Object.keys(bench.never.w.reasons).length, 3, 'each transient says why');
});

test('bgcore on recorded Spectre output: bgok read from the operating points and the start-up transients, the trip recomputed', () => {
  const F = path.join(fixtures, 'spectre-bgcore');
  const out = py([
    'from pathlib import Path',
    `F = Path(${JSON.stringify(F)})`,
    'raws = {p: F / ("bg-tt-3.3V-%s.raw" % p) for p, _ in bg.SPECTRE_PARTS}',
    'facts = bg.spectre_facts(raws, (27,), bgok=True)',
    'facts.update(process="tt", vdd=3.3)',
    'm = bg.bench_measures(facts)',
    'old = Path(' + JSON.stringify(path.join(fixtures, 'spectre-tt')) + ')',
    'try:',
    '    bg.spectre_facts({p: old / ("bg-tt-3.3V-%s.raw" % p) for p, _ in bg.SPECTRE_PARTS}, (27,), bgok=True)',
    '    err = None',
    'except bg.ToolError as e:',
    '    err = str(e)',
    'design = json.load(open(F / "design.json"))',
    'print(json.dumps(dict(f=facts["temps"]["27"], m=m["temps"]["27"], err=err, same=bg.cell_spice(card, dict(design, topology="bgcore")) == (F / "cell.spice").read_text()),',
    '                 default=lambda x: None))',
  ].join('\n'));
  const { f, m } = out;
  assert.ok(out.same, 'the fixture is this engine\'s bgcore cell');
  assert.ok(f.bgokOn > 0.9 * 3.3 && f.bgokOff < 0.1 * 3.3, `op: bgok ${f.bgokOn} V enabled, ${f.bgokOff} V with en low`);
  for (const key of ['powerUp', 'en1us', 'en50us']) {
    const tr = f.tran[key];
    assert.equal(tr.bgok.length, tr.time.length, `${key}: one bgok sample per time point`);
    // Independent trip: VBG where bgok first passes 0.33 V, interpolated.
    const i = tr.bgok.findIndex((b: number) => b > 0.33);
    assert.ok(i > 0, `${key}: bgok starts low`);
    const u = (0.33 - tr.bgok[i - 1]) / (tr.bgok[i] - tr.bgok[i - 1]);
    const v = tr.v[i - 1] + u * (tr.v[i] - tr.v[i - 1]);
    assert.ok(Math.abs(m.bgokTrips[key].v - v) < 1e-5, `${key}: trip ${m.bgokTrips[key].v} vs ${v} V`);
    assert.ok(Math.abs(m.bgokTrips[key].pct - 100 * v / tr.v.at(-1)) < 1e-2);
  }
  assert.equal(m.bgokTripPct, Math.min(...Object.values(m.bgokTrips).map((x: any) => x.pct)));
  assert.match(out.err, /lacks bgok\d/, 'a missing bgok trace is an error, never a zero');
});

test('bgcore: the ladder carries the core\'s VBG at any spec target; the first cut and the sizes agree', () => {
  const out = py([
    'res = {}',
    'for target in (1.2, 1.25):',
    '    sp = dict(spec, vbgV=target)',
    '    intent = bg.first_cut_intent(sp, card, table, devices, None, "bgcore")',
    '    d = bg.size_from_intent(table, devices, card, intent, "bgcore")',
    '    vbg = bg.core_vbg(devices, intent["n"], intent["iCoreUa"], intent["r2r1"])',
    '    import ota_cli as ota',
    '    i_out = 2 * intent["iCoreUa"] + vbg / (122.5 * intent["ladderRUnitKohm"] * 1e3) * 1e6',
    '    w, _ = ota.width_for(table, card, "pmos", intent["out"]["lUm"], intent["out"]["gmId"], i_out)',
    '    w12, _ = ota.width_for(table, card, "pmos", intent["out"]["lUm"], intent["out"]["gmId"], 2 * intent["iCoreUa"] + 1.2 / (122.5 * intent["ladderRUnitKohm"] * 1e3) * 1e6)',
    '    res[str(target)] = dict(intent=intent, mo=d["devices"]["MO"]["wUm"], want=w, at12=w12, vbg=vbg)',
    'print(json.dumps(res))',
  ].join('\n'));
  for (const [target, r] of Object.entries(out) as [string, Json][]) {
    assert.equal(r.mo, r.want, `${target} V: MO sized for 2 iCore plus the core's VBG over the ladder`);
    assert.equal(r.intent.ladderRUnitKohm, Math.round(Number(target) / 122.5 / (8 / 16 * 1e-6) / 1e3 * 10) / 10, 'the unit from the target');
  }
  assert.notEqual(out['1.25'].intent.ladderRUnitKohm, out['1.2'].intent.ladderRUnitKohm);
  assert.ok(Math.abs(out['1.25'].vbg - out['1.2'].vbg) < 0.01, 'the core makes the same VBG whatever the target');
  assert.ok(Math.abs(out['1.2'].vbg - 1.2) > 0.01 && out['1.2'].mo !== out['1.2'].at12, 'on these decks the core sits below 1.2 V: a 1.2 V constant would size MO wrong');
});

test('the Site seed is copied whole or not at all, a concurrent first copy is used, and the measurements say where the seed came from', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bg-seed2-'));
  try {
    const wrapper = path.join(dir, 'bin', 'spectre');
    await mkdir(`${wrapper}.ahdl-seed/mod.ahdlcmi`, { recursive: true });
    await writeFile(`${wrapper}.ahdl-seed/mod.ahdlcmi/code`, 'site');
    const wsOf = async (name: string) => {
      const ws = path.join(dir, name);
      await mkdir(path.join(ws, 'state'), { recursive: true });
      await writeFile(path.join(ws, 'state', 'inputs.json'), JSON.stringify({ simulators: { spectre: { path: wrapper } } }));
      return ws;
    };
    const [plain, race, broken] = [await wsOf('plain'), await wsOf('race'), await wsOf('broken')];
    const out = py([
      'import os, shutil',
      'from pathlib import Path',
      'leftovers = lambda ws: sorted(n for n in os.listdir(Path(ws) / "work") if n.startswith("."))',
      'res = {}',
      `ws = Path(${JSON.stringify(plain)}); seed = ws / "work" / "spectre-ahdl"`,
      'bg.ahdl_seed(seed, ws)',
      'res["plain"] = dict(facts=bg.seed_facts(), code=(seed / "mod.ahdlcmi" / "code").read_text(), left=leftovers(ws),',
      '                    origin=json.load(open(str(seed) + ".origin.json")))',
      'bg.ahdl_seed(seed, ws)',
      'res["again"] = bg.seed_facts()',
      'facts = dict(process="tt", vdd=3.3, dc=dict(temp=[-40, 27, 125], vbg=[1.2, 1.2, 1.2], iq=[1e-6] * 3), temps={}, spectreSeed=bg.seed_facts())',
      'res["bench"] = bg.bench_measures(facts)["spectreSeed"]',
      'real_copy = shutil.copytree',
      // Another step renames its copy into place while this one is still copying: this one keeps the other's.
      `ws = Path(${JSON.stringify(race)}); seed = ws / "work" / "spectre-ahdl"`,
      'def racing(src, dst, *a, **k):',
      '    real_copy(src, dst, *a, **k)',
      '    os.makedirs(seed / "other", exist_ok=True); (seed / "other" / "mark").write_text("first")',
      'shutil.copytree = racing',
      'bg.ahdl_seed(seed, ws)',
      'shutil.copytree = real_copy',
      'res["race"] = dict(facts=bg.seed_facts(), names=sorted(os.listdir(seed)), left=leftovers(ws))',
      // A copy that fails half-way leaves no seed behind: the step compiles afresh.
      `ws = Path(${JSON.stringify(broken)}); seed = ws / "work" / "spectre-ahdl"`,
      'def failing(src, dst, *a, **k):',
      '    os.makedirs(Path(dst) / "half"); raise OSError("disk full")',
      'shutil.copytree = failing',
      'bg.ahdl_seed(seed, ws)',
      'shutil.copytree = real_copy',
      'res["broken"] = dict(facts=bg.seed_facts(), seeded=seed.exists(), left=leftovers(ws))',
      'bg.ahdl_seed(seed, ws)',
      'res["retry"] = dict(facts=bg.seed_facts(), code=(seed / "mod.ahdlcmi" / "code").read_text())',
      'print(json.dumps(res))',
    ].join('\n'));
    const site = { origin: 'site', site: `${wrapper}.ahdl-seed` };
    assert.deepEqual(out.plain.facts, site);
    assert.equal(out.plain.code, 'site');
    assert.deepEqual(out.plain.origin, site);
    assert.deepEqual(out.plain.left, [], 'no temporary copy is left beside the seed');
    assert.deepEqual(out.again, site, 'a later step reads where the seed came from');
    assert.deepEqual(out.bench, site, 'each bench\'s measurement carries the provenance');
    assert.deepEqual(out.race.facts, site);
    assert.deepEqual(out.race.names, ['other'], 'the copy renamed first is the seed; this step\'s copy is dropped');
    assert.deepEqual(out.race.left, []);
    assert.deepEqual(out.broken.facts, { origin: 'none' }, 'a failed copy is not a seed');
    assert.equal(out.broken.seeded, false);
    assert.deepEqual(out.broken.left, []);
    assert.deepEqual(out.retry.facts, site, 'the next step copies again');
    assert.equal(out.retry.code, 'site');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('Spectre Monte Carlo runs in firstrun chunks; a chunk that keeps crashing is split, and the draws are the same', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bg-mc-split-'));
  try {
    // A stand-in Spectre: a montecarlo of more than FAKE_MAX runs crashes; otherwise it writes run k's VBG = 1.2 + k * 1e-4.
    const template = await readFile(path.join(fixtures, 'spectre-mc/mc.raw/mc1-001_op1.dc'), 'utf8');
    await writeFile(path.join(dir, 'template.dc'), template);
    const fake = path.join(dir, 'spectre');
    await writeFile(fake, [
      '#!/usr/bin/env python3',
      'import os, re, sys',
      'netlist, raw = sys.argv[3], sys.argv[5]',
      'text = open(netlist).read()',
      'n = int(re.search(r"numruns=(\\d+)", text).group(1)); m = re.search(r"firstrun=(\\d+)", text); first = int(m.group(1)) if m else 1',
      'first += int(os.environ.get("FAKE_SHIFT", "0"))    # a Spectre that numbers its iterations wrong',
      'if n > int(os.environ["FAKE_MAX"]):',
      '    print("FATAL (SPECTRE-18): Segmentation fault."); sys.exit(139)',
      'os.makedirs(raw)',
      `t = open(${JSON.stringify(path.join(dir, 'template.dc'))}).read()`,
      'for k in range(first, first + n):',
      '    open(os.path.join(raw, "mc1-%03d_op1.dc" % k), "w").write(re.sub(r\'"vbg1" "V" \\S+\', \'"vbg1" "V" %.6e\' % (1.2 + k * 1e-4), t))',
      'print("spectre completes with 0 errors")',
    ].join('\n'), { mode: 0o755 });
    const run = (max: number, n = 20, shift = 0) => {
      const r = spawnSync('python3', ['-B', '-c', [
        'import json, sys', `sys.path.insert(0, ${JSON.stringify(flowDir)})`, 'import bg_cli as bg',
        `card = json.load(open(${JSON.stringify(path.join(flowDir, 'pdks.json'))}))["cards"]["synth180"]`,
        `table = json.load(open(${JSON.stringify(path.join(fixtures, 'synth180-tables/tables-design.json'))}))`,
        `devices = json.load(open(${JSON.stringify(path.join(fixtures, 'synth180-tables/devices.json'))}))`,
        `spec = ${JSON.stringify(SPEC)}`,
        'intent = bg.first_cut_intent(spec, card, table, devices, None, "kuijk-p5t-mirror")',
        'design = dict(bg.size_from_intent(table, devices, card, intent, "kuijk-p5t-mirror"), topology="kuijk-p5t-mirror", pdk="synth180", round=1)',
        `inputs = dict(pdkRoot="/pdk", topology="kuijk-p5t-mirror", pdks=dict(design=dict(name="synth180", card=card, simulator=dict(name="spectre", path=${JSON.stringify(fake)}))))`,
        `out = ${JSON.stringify(path.join(dir, `out-${String(max)}-${String(n)}-${String(shift)}`))}`,
        'try:',
        `    values, iq, info = bg.run_mc(out, inputs, design, ${String(n)}, 1, out)`,
        '    print(json.dumps(dict(values=values, info=info)))',
        'except bg.ToolError as e:',
        '    print(json.dumps(dict(error=str(e), crash=isinstance(e, bg.SpectreCrash))))',
      ].join('\n')], { encoding: 'utf8', env: { ...process.env, FAKE_MAX: String(max), FAKE_SHIFT: String(shift) } });
      assert.equal(r.status, 0, r.stderr);
      return { ...JSON.parse(r.stdout), stderr: r.stderr };
    };
    const whole = run(100);
    const split = run(6);
    const want = Array.from({ length: 20 }, (_, i) => Number((1.2 + (i + 1) * 1e-4).toExponential(6)));
    assert.deepEqual(whole.values, want);
    assert.deepEqual(split.values, want, 'split chunks give the same runs, in order');
    assert.equal(whole.info.netlist, 'mc.scs');
    assert.equal(split.info.netlist.split(', ').length, 4, `20 runs as 4 chunks of 5: ${split.info.netlist}`);
    assert.match(split.stderr, /runs 1 to 20 crashed Spectre 2 times: split in two/);
    assert.equal(split.info.spectreAttempts, 2 + 2 * 2 + 4, 'the crashed attempts count too');
    assert.match(split.info.method, /chunks of 25 runs \(firstrun/);
    // 60 runs: three top-level chunks (25, 25, 10); with crashes past 13 runs the two full chunks split (12 + 13), the last does not.
    const want60 = Array.from({ length: 60 }, (_, i) => Number((1.2 + (i + 1) * 1e-4).toExponential(6)));
    const big = run(100, 60);
    assert.deepEqual(big.values, want60);
    assert.deepEqual(big.info.netlist.split(', '), ['mc.scs', 'mc-26.scs', 'mc-51.scs']);
    const bigSplit = run(13, 60);
    assert.deepEqual(bigSplit.values, want60, 'the same 60 draws, in order');
    assert.deepEqual(bigSplit.info.netlist.split(', ').map((x: string) => x.replace(/\.attempt-\d+/, '')),
      ['mc.scs', 'mc-13.scs', 'mc-26.scs', 'mc-38.scs', 'mc-51.scs']);
    // A chunk whose files carry other iteration numbers is refused, never read as these runs.
    const shifted = run(100, 20, 3);
    assert.match(shifted.error, /Monte Carlo asked for runs 1 to 20 and Spectre wrote 17/);
    const never = run(0);
    assert.equal(never.crash, true, 'a single run that crashes every time is an error, never a gap');
    assert.match(never.error, /crashed \(segmentation fault\)/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
