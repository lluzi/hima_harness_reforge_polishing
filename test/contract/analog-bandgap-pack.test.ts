// The analog-bandgap Pack's shape: it loads at stage compiled with the spec sheet as its Goal, its
// graph signs a bandgap off in four judged stages (every corner, Monte Carlo, layout, after layout),
// every tool argv name is bound, the strip places every node, the harness's own chooser ends only on a
// signed-off valid round, and each Reader states what the flow's records say (and refuses another
// record kind). No simulator: the records here are written by the test in the flow's shapes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { checkPack, choose, loadPack, loadSite, packStageOf, resolveChooser } from '@hima/harness';
import { repoRoot } from './support/dsh-home.ts';

const packsDir = path.join(repoRoot, 'packs');
const packId = 'analog-bandgap';
const packDir = path.join(packsDir, packId);
const HARNESS_ARGV = new Set(['WORKSPACE']);

test('the Pack loads at stage compiled with the eight-line spec sheet as its Goal and one resident design agent', async () => {
  const pack = loadPack(packsDir, packId);
  assert.equal(packStageOf(packsDir, packId)?.stage, 'compiled');
  assert.equal(pack.contract.version, '0.1.0');
  const goal = pack.contract.goal!;
  assert.deepEqual(Object.fromEntries(Object.entries(goal).map(([k, v]) => [k, (v as any).default])), {
    vbg_v: 1.2, vbg_tol_pct: 2, max_iq_ua: 8, max_isd_na: 2, max_tc_ppm: 100, min_pm_deg: 60, max_tstart_us: 100, min_psrr_db: 40,
  });
  assert.equal(pack.contract.results?.headline.type, 'worst_margin_pct');
  assert.deepEqual(pack.contract.results?.columns.map((c: any) => c.reader), ['bg-pvt', 'bg-post']);
  const agents = pack.contract.tools.filter((tool: any) => tool.outsourcing);
  assert.deepEqual(agents.map((tool: any) => [tool.id, tool.outsourcing.artifactPrefix, tool.outsourcing.produces]),
    [['size-agent', 'reports/size-agent', 'design']]);
  for (const file of agents[0]!.outsourcing.knowledge) await readFile(path.join(packDir, 'knowledge', file), 'utf8');
  const bind = pack.contract.tools.find((tool: any) => tool.id === 'bind-inputs')!;
  assert.equal(bind.argv.at(-1), 'kuijk-p5t-mirror', 'the Pack fixes the mirror template');
  const shown = JSON.stringify([pack.contract.words, pack.contract.results, pack.graph.nodes.map((n: any) => [n.label, n.about])]);
  assert.doesNotMatch(shown, /\bmock\b|\bmodel\b/i, 'App words are plain');
});

test('the graph signs off in four judged stages and a failing stage goes straight to the round record', () => {
  const pack = loadPack(packsDir, packId);
  const judge = (id: string) => (pack.graph.nodes.find((n: any) => n.id === id) as any).parameters.rules;
  assert.deepEqual(judge('check-pvt'), ['meets-spec']);
  assert.deepEqual(judge('check-mc'), ['mc-in-band']);
  assert.deepEqual(judge('check-layout'), ['layout-clean']);
  assert.deepEqual(judge('check-post'), ['meets-spec']);
  assert.deepEqual(judge('judge-round'), ['round-valid', 'signed-off'], 'constraint, then goal');
  const to = (from: string, outcome?: string) => pack.graph.edges.filter((e: any) => e.from === from && e.outcome === outcome).map((e: any) => e.to);
  assert.deepEqual(to('check-pvt', 'PASS'), ['monte-carlo']);
  assert.deepEqual(to('check-mc', 'PASS'), ['layout']);
  assert.deepEqual(to('check-layout', 'PASS'), ['simulate-post']);
  for (const check of ['check-pvt', 'check-mc', 'check-layout', 'check-post']) {
    for (const outcome of ['FAIL', 'UNDETERMINED']) assert.deepEqual(to(check, outcome), ['record-round'], `${check} ${outcome}`);
  }
  const revisit = pack.graph.edges.filter((e: any) => e.revisit);
  assert.deepEqual(revisit.map((e: any) => [e.from, e.to]), [['next-round', 'size-agent']]);
});

test('every ${NAME} in a tool argv is bound by its node or the harness, and the strip places every node once', () => {
  const pack = loadPack(packsDir, packId);
  const bound = new Map<string, Record<string, unknown>>();
  for (const node of pack.graph.nodes as any[]) if (node.kind === 'act' && node.parameters.tool) bound.set(node.parameters.tool, node.parameters.arguments ?? {});
  for (const tool of pack.contract.tools as any[]) {
    for (const word of tool.argv) for (const m of word.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g)) assert.ok(tool.inputs.includes(m[1]!), `${tool.id}: ${m[1]}`);
    for (const name of tool.inputs) if (!HARNESS_ARGV.has(name)) assert.ok(Object.hasOwn(bound.get(tool.id) ?? {}, name), `${tool.id} input ${name} is bound`);
  }
  const placed = (pack.graph as any).view.stations.flatMap((s: any) => s.checklist.flatMap((c: any) => c.nodes));
  const hidden = (pack.graph as any).view.hidden ?? [];
  assert.deepEqual([...placed, ...hidden].sort(), pack.graph.nodes.map((n: any) => n.id).sort());
  assert.equal(new Set(placed).size, placed.length);
});

test('the chooser ends only on a valid, signed-off round and otherwise asks for another round', () => {
  const pack = loadPack(packsDir, packId);
  const chooser = resolveChooser(pack, 'bg-next', 'the round').chooser;
  const verdict = (ruleId: string, outcome: 'PASS' | 'FAIL' | 'UNDETERMINED') => ({ ruleId, outcome }) as any;
  const observation = (best: number) => ({ id: 'round', values: [{ type: 'best_margin_pct', unit: 'percent', value: best }] }) as any;
  const base = { bound: { roundStep: 1 }, knobs: pack.contract.strategy, strategy: { mcRuns: 100, pex: 'c', roundRevision: 0 } };
  const decide = (c: 'PASS' | 'FAIL' | 'UNDETERMINED', g: 'PASS' | 'FAIL' | 'UNDETERMINED', best: number) =>
    choose(chooser, { ...base, observation: observation(best), constraint: verdict('round-valid', c), goal: verdict('signed-off', g),
      verdicts: [verdict('round-valid', c), verdict('signed-off', g)] }) as any;
  assert.deepEqual(decide('PASS', 'PASS', 4.8), { ok: true, chosen: { goalMet: true }, rationale: { bestMargin: 4.8, roundStep: 1 } });
  for (const [c, g, best] of [['PASS', 'FAIL', 4.8], ['PASS', 'UNDETERMINED', -100], ['FAIL', 'FAIL', -100], ['UNDETERMINED', 'UNDETERMINED', -100]] as const) {
    const next = decide(c, g, best);
    assert.equal(next.ok, true, `${c}/${g}: ${next.reason}`);
    assert.notEqual(next.chosen.goalMet, true, `${c}/${g}`);
    assert.equal(next.chosen.strategy.roundRevision, 1, `${c}/${g}`);
  }
});

test('the deployed analog Site analog_sim_01 fits the Pack, with its layout tool allowed', async () => {
  const siteDir = path.join(repoRoot, 'sites/analog_sim_01');
  const root = await mkdtemp(path.join(os.tmpdir(), 'bg-site-'));
  try {
    const sitesDir = path.join(root, 'sites');
    await mkdir(sitesDir, { recursive: true });
    await writeFile(path.join(sitesDir, 'analog_sim_01.yml'), await readFile(path.join(siteDir, 'site.yml'), 'utf8'));
    await writeFile(path.join(sitesDir, 'permit.yml'), await readFile(path.join(siteDir, 'permit.yml'), 'utf8'));
    const site = loadSite(sitesDir, 'analog_sim_01');
    const fit = checkPack(loadPack(packsDir, packId), site);
    assert.equal(fit.fit, true, fit.errors.join('\n'));
    const bindings = site.bindings as Record<string, string>;
    assert.equal(bindings.pdk, 'gf180mcuD');
    assert.ok(site.permitRules.allowedWrappers.includes(bindings.layoutTool!), 'the layout tool is an allowed wrapper');
  } finally { await rm(root, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------- the Readers on the flow's record shapes

let readings = 0;
async function read(script: string, record: unknown): Promise<{ status: number | null; stderr: string; values: Record<string, any> }> {
  readings += 1;
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bg-reader-'));
  try {
    const report = path.join(dir, 'report.json');
    const out = path.join(dir, 'out.json');
    await writeFile(report, JSON.stringify(record));
    const run = spawnSync('python3', [path.join(packDir, 'tools', script), report, out], { encoding: 'utf8' });
    const values = run.status === 0 ? Object.fromEntries(JSON.parse(await readFile(out, 'utf8')).values.map((v: any) => [v.type, v])) : {};
    return { status: run.status, stderr: run.stderr, values };
  } finally { await rm(dir, { recursive: true, force: true }); }
}
const v = (r: { values: Record<string, any> }, type: string) => r.values[type]?.value;

const bench = (vmin: number, vmax: number) => ({ vbgMinV: vmin, vbgMaxV: vmax });
const measure = (meets: boolean | null, pm: number | null) => ({
  schema: 'hima-bandgap-measure/1', meetsSpec: meets, benches: [bench(1.19, 1.205), bench(1.195, 1.21)],
  marginPct: { vbg: 50, iq: 4.8, isd: 98, tc: 80, pm: pm === null ? null : 29, start: 30, psrr: 39 },
  worst: { vbg: { value: 1.21 }, iq: { value: 7.61 }, isd: { value: 0.033 }, tc: { value: 19.6 }, pm: { value: pm }, start: { value: 70.8 }, psrr: { value: 55.8 } },
});

test('the measurement Reader states the worst corner of every line and an unknown line stays unknown', async () => {
  const ok = await read('read-measure.py', measure(true, 77.5));
  assert.equal(ok.status, 0, ok.stderr);
  assert.deepEqual([v(ok, 'meets_spec'), v(ok, 'worst_margin_pct'), v(ok, 'vbg_min_v'), v(ok, 'vbg_max_v'), v(ok, 'iq_ua'), v(ok, 'pm_deg'), v(ok, 'psrr_db')],
    [1, 4.8, 1.19, 1.21, 7.61, 77.5, 55.8]);
  const unknown = await read('read-measure.py', measure(null, null));
  assert.equal(v(unknown, 'meets_spec'), null);
  assert.ok(unknown.values.meets_spec.unknownReason);
  assert.equal(v(unknown, 'worst_margin_pct'), null, 'a margin over an unknown line is unknown, not the others\' worst');
  assert.equal(v(unknown, 'pm_deg'), null);
  assert.notEqual((await read('read-measure.py', { schema: 'hima-bandgap-mc/1' })).status, 0, 'another record kind is refused');
});

test('the Monte Carlo, layout and round Readers state the record, and the layout is clean only with zero DRC and both LVS', async () => {
  const mc = await read('read-mc.py', { schema: 'hima-bandgap-mc/1', stats: { inBand: true, n: 100, meanV: 1.2052, sigmaV: 0.00363, lo3V: 1.1943, hi3V: 1.2161 } });
  assert.deepEqual([v(mc, 'mc_in_band'), v(mc, 'mc_runs'), v(mc, 'mc_sigma_mv')], [1, 100, 3.63]);
  const layout = (drcMagic: number, drcKlayout: number, lvsNetgen: boolean, lvsKlayout: boolean) =>
    ({ schema: 'hima-bandgap-layout/1', drcMagic, drcKlayout, lvsNetgen, lvsKlayout, areaUm2: 8261.7 });
  assert.equal(v(await read('read-layout.py', layout(0, 0, true, true)), 'layout_clean'), 1);
  for (const bad of [layout(1, 0, true, true), layout(0, 2, true, true), layout(0, 0, false, true), layout(0, 0, true, false)]) {
    assert.equal(v(await read('read-layout.py', bad), 'layout_clean'), 0, JSON.stringify(bad));
  }
  const round = await read('read-round.py', { schema: 'hima-bandgap-round/1', roundValid: true, signedOff: false, worstMarginPct: null,
    bestMarginPct: -100, roundImproved: false, problems: ['the post-layout result is not of this round\'s extracted layout'] });
  assert.deepEqual([v(round, 'round_valid'), v(round, 'signed_off'), v(round, 'best_margin_pct')], [1, 0, -100]);
  assert.match(round.values.worst_margin_pct.unknownReason, /post-layout result is not of this round/);
});
