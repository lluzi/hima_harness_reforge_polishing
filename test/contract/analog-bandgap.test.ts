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
import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
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
  assert.deepEqual(Object.keys(parts), ['nominal', 'loopv', 'loopi', 'off', 'powerUp', 'en1us', 'en50us']);
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
  assert.ok(parts.off!.includes('VEN4 (en4 0) vsource dc=0'));
  assert.ok(parts.powerUp!.includes('VDD5 (vdd5 0) vsource type=pwl wave=[0 0 10u 2]') && parts.powerUp!.includes('X5 (vdd5 0 vdd5 ib5 vbg5 g5 g5) bandgap_lb'),
    'power-up: vdd ramps from 0 with en tied to it');
  assert.ok(parts.en1us!.includes('VEN6 (en6 0) vsource type=pwl wave=[0 0 10u 0 11u 2]'));
  assert.ok(parts.en50us!.includes('VEN7 (en7 0) vsource type=pwl wave=[0 0 10u 0 60u 2]'));
  for (const p of ['powerUp', 'en1us', 'en50us']) assert.ok(parts[p]!.some((l) => /^tr_p27 tran stop=300u maxstep=1u/.test(l)));
  const ng: string[] = out.ng;
  assert.ok(ng.includes('.lib "/pdk/synth180/bandgap.lib" mos_ss') && ng.includes('.options tnom=27 cshunt=1e-14'));
  assert.equal(ng.filter((l) => /^X\d /.test(l)).length, 7, 'ngspice holds all seven copies');
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
    'print(json.dumps(dict(ok=bg.start_time_us(time, v, 10.0, 1.2), stuck=bg.start_time_us(time, [0.56] * len(time), 10.0, 1.2))))',
  ].join('\n'));
  assert.ok(Math.abs(out.ok[0] - 5 * Math.log(50)) < 0.05, `${out.ok[0]} vs ${5 * Math.log(50)} us`);
  assert.equal(out.stuck[0], null);
});

test('Monte Carlo statistics from recorded Spectre iterations', () => {
  const out = py([
    `values, iq = bg.mc_values(${JSON.stringify(path.join(fixtures, 'spectre-mc/mc.raw'))})`,
    'print(json.dumps(dict(values=values, stats=bg.mc_stats(values, 1.2, 2.0))))',
  ].join('\n'));
  const v: number[] = out.values;
  assert.equal(v.length, 30, 'mc1-001 to mc1-030, the nominal run left out');
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
  const iCore = (0.8 * SPEC.iqMaxUa - 0.5 - 1.0 - 0.025) / (2 * kHot);
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
    // A Monte Carlo run needs Spectre.
    const mc = bgcli(ws, 'mc', '20', '1.2', '2');
    assert.notEqual(mc.status, 0);
    assert.match(mc.stderr, /Monte Carlo runs on Spectre/);
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
