import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parse } from 'yaml';
import { checkPack, installPackMethod, loadPack, loadSite, packKnowledgeManifestOf, packOverview, searchPackKnowledge } from '@hima/harness';
import { repoRoot } from './support/dsh-home.ts';
import { writeLocalSite } from './support/site.ts';
import { createHimaHome } from './support/dsh-home.ts';
import { bootInProcess, createRootAgent } from './support/boot-inprocess.ts';
import { waitUntil } from './support/fabric.ts';
import { createCustomCellFmaxFixture, sha256 } from './support/aes-domain-fixture.ts';

const packDir = path.join(repoRoot, 'packs/custom-cell-fmax-dtco');

const contractInputs = [
  'designRoot', 'rtlGlob', 'designTop', 'constraints',
  'foundryLibrary', 'physicalInputs', 'toolStack', 'workspaceRoot',
];

async function writeCustomSyntheticRecord(workspace: string, stage: string,
  artifacts: readonly { role: string; path: string; sourceType?: string }[], facts: Record<string, unknown> = {}) {
  const rows = await Promise.all(artifacts.map(async (item) => {
    const raw = await readFile(item.path);
    return { role: item.role, path: path.relative(workspace, item.path), sha256: sha256(raw), bytes: raw.length,
      sourceType: item.sourceType ?? 'synthetic-fixture-artifact' };
  }));
  const target = path.join(workspace, 'flow/records', `${stage}.json`);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify({ schema: 'custom-cell-fmax-stage/1', stage, status: 'passed',
    evidenceClass: 'synthetic-fixture', inputs: [], artifacts: rows, executions: [], facts, method: { fixture: true },
    scope: 'synthetic fixture only; no custom Cell PPA or real EDA claim' }, null, 2) + '\n');
}

test('the portable Pack has no AES, process-node, or customer-flow binding and declares Site-owned production inputs', async () => {
  const contract = parse(await readFile(path.join(packDir, 'contract.yml'), 'utf8')) as {
    id: string; inputs: { name: string }[];
    tools: { id: string; recommendedVersion?: string; inputs?: string[]; argv?: string[] }[];
  };
  assert.equal(contract.id, 'custom-cell-fmax-dtco');
  assert.deepEqual(contract.inputs.map((item) => item.name), contractInputs);
  for (const id of ['synthesize', 'compile', 'pnr-foundry', 'pnr-generated', 'verify']) {
    assert.match(contract.tools.find((tool) => tool.id === id)?.recommendedVersion ?? '', /current Site-supported release/);
  }
  const graph = parse(await readFile(path.join(packDir, 'graph.yml'), 'utf8')) as {
    nodes: Array<{ id: string; parameters?: { observes?: string; workshop?: string; arguments?: Record<string, { from?: string; name?: string }> } }>;
    edges: Array<{ from: string; to: string; outcome?: string }>;
  };
  for (const id of ['foundry-synth', 'custom-synth']) {
    const tool = contract.tools.find((item) => item.id === id);
    assert.ok(tool?.inputs?.includes('PERIOD_NS'));
    assert.equal(tool?.argv?.at(-1), '${PERIOD_NS}');
    assert.deepEqual(graph.nodes.find((node) => node.id === id)?.parameters?.arguments?.PERIOD_NS,
      { from: 'strategy', name: 'periodNs' });
  }
  assert.ok(graph.nodes.some((node) => node.id === 'adoption-gate'));
  assert.ok(graph.edges.some((edge) => edge.from === 'read-adoption' && edge.to === 'adoption-gate'));
  assert.ok(graph.edges.some((edge) => edge.from === 'adoption-gate' && edge.to === 'pnr-foundry' && edge.outcome === 'PASS'));
  assert.ok(graph.edges.some((edge) => edge.from === 'adoption-gate' && edge.to === 'blocked' && edge.outcome === 'FAIL'));
  const loaded = loadPack(path.join(repoRoot, 'packs'), 'custom-cell-fmax-dtco');
  assert.deepEqual(loaded.contract.workshops.map((workshop) => workshop.id), ['research-candidates'],
    'one cross-route AI research moment replaces six narrow selector moments');
  assert.ok(graph.nodes.some((node) => node.id === 'research-candidates'));
  assert.ok(graph.nodes.some((node) => node.id === 'read-research-selection'));
  for (const route of ['timing-criticality', 'timing-context', 'structure-frequency', 'structure-compaction',
    'mapper-compatibility', 'functional-diversity']) {
    assert.deepEqual(graph.nodes.find((node) => node.id === `select-${route}`)?.parameters,
      { observes: `research_${route.replaceAll('-', '_')}` });
  }
  const adoptionRule = parse(await readFile(path.join(packDir, 'rules/custom-cell-adopted.yml'), 'utf8')) as Record<string, any>;
  assert.equal(adoptionRule.subject.type, 'adopted_instance_count');
  assert.deepEqual(adoptionRule.predicate, { op: 'gte', threshold: 1, unit: 'count' });
  const files = await Promise.all([
    'INTENT.md', 'SPEC.md', 'FABRIC.md', 'TEST.md', 'contract.yml', 'graph.yml', 'semantics.yml',
    'flow/probe.py', 'flow/stages.py', 'flow/read-stage.py', 'knowledge/full-mining-method.md',
  ].map((file) => readFile(path.join(packDir, file), 'utf8')));
  assert.doesNotMatch(files.join('\n'), /aes_cipher_top|\/[^\s"']*tsmc28|Golden Flow/i);
});

test('two different Site bindings fit the Pack and a missing production binding is named', async (t) => {
  const h = await createHimaHome();
  t.after(() => h.dispose());
  const bindings = Object.fromEntries(contractInputs.map((name) => [name, path.join(h.workspace, name)]));
  const site = await writeLocalSite(h, {
    bindings,
    allowedWrappers: ['/usr/bin/python3'],
    licences: { 'Design-Compiler': 1, 'Library-Compiler': 1, Innovus: 1 },
  });
  const pack = loadPack(path.join(repoRoot, 'packs'), 'custom-cell-fmax-dtco');
  assert.equal(packOverview(pack).status?.normalized, 'development');
  assert.equal(packOverview(pack).minimumHarnessVersion, '0.1.0');
  assert.equal(packKnowledgeManifestOf(pack)?.documents.length, 3);
  const knowledge = await searchPackKnowledge(pack, 'matched comparison custom cell adoption');
  assert.ok(knowledge.length > 0);
  assert.equal(knowledge[0]?.document.source, 'pack');
  assert.deepEqual(checkPack(pack, loadSite(site.sitesDir, site.name)).errors, []);
  for (const designTop of ['held_out_control', 'held_out_datapath']) {
    const varied = { ...bindings, designTop };
    const variedSite = await writeLocalSite(h, {
      bindings: varied,
      allowedWrappers: ['/usr/bin/python3'],
      licences: { 'Design-Compiler': 1, 'Library-Compiler': 1, Innovus: 1 },
    });
    assert.deepEqual(checkPack(pack, loadSite(variedSite.sitesDir, variedSite.name)).errors, []);
  }
  delete bindings.physicalInputs;
  const missing = await writeLocalSite(h, {
    bindings,
    allowedWrappers: ['/usr/bin/python3'],
    licences: { 'Design-Compiler': 1, 'Library-Compiler': 1, Innovus: 1 },
  });
  assert.match(checkPack(pack, loadSite(missing.sitesDir, missing.name)).errors.join('\n'), /physicalInputs/);
});

test('the probe identity accepts different tops and makes its data identity depend on current RTL', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'custom-cell-fmax-pack-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const makeBinding = async (top: string, rtl: string) => {
    const workspace = path.join(root, top);
    const flow = path.join(workspace, 'flow');
    await mkdir(flow, { recursive: true });
    const synth = await readFile(path.join(packDir, 'flow/synth.tcl'), 'utf8');
    await Promise.all([
      writeFile(path.join(flow, 'rtl.v'), rtl),
      writeFile(path.join(flow, 'foundry.db'), 'synthetic database\n'),
      writeFile(path.join(flow, 'constraints.tcl'), `create_clock -name site_clk -period 0.5 [get_ports clk]\n`),
      writeFile(path.join(flow, 'wrapper'), '#!/bin/sh\nexit 0\n'),
      writeFile(path.join(flow, 'synth.tcl'), synth),
      writeFile(path.join(flow, 'inputs.json'), JSON.stringify({
        designTop: top, rtlGlob: path.join(flow, 'rtl.v'), foundryDb: path.join(flow, 'foundry.db'),
        edaWrapper: path.join(flow, 'wrapper'), constraintsTcl: path.join(flow, 'constraints.tcl'), clockName: 'site_clk',
      })),
    ]);
    return spawnSync('/usr/bin/python3', [path.join(packDir, 'flow/probe.py'), '--workspace', workspace,
      '--period', '0.5', '--check-inputs'], { encoding: 'utf8' });
  };
  const first = await makeBinding('held_out_control', 'module held_out_control; endmodule\n');
  const second = await makeBinding('held_out_datapath', 'module held_out_datapath; wire changed; endmodule\n');
  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  assert.notEqual(first.stdout, second.stdout, 'top and RTL bytes are held as distinct input identities');
});

test('the Pack miner changes its source-linked candidates when the held-out netlist changes', async (t) => {
  const mine = async (secondOccurrence: boolean) => {
    const fixture = await createCustomCellFmaxFixture(); t.after(() => fixture.dispose());
    const flow = path.join(fixture.workspace, 'flow');
    const netlist = path.join(flow, 'held-out-netlist.v');
    const text = `module held_out_datapath(input a,b,c,d,e,f,output z1,z2);\nNAND2_X1 U0(.A(a),.B(b),.ZN(n0));\nNAND2_X1 U1(.A(n0),.B(c),.ZN(z1));\n${secondOccurrence ? 'NAND2_X1 U2(.A(d),.B(e),.ZN(n2));\nNAND2_X1 U3(.A(n2),.B(f),.ZN(z2));' : ''}\nendmodule\n`;
    await writeFile(netlist, text);
    const timing = 'Report : timing\nDesign : held_out_datapath\n  Startpoint: r0\n  Endpoint: r1\n  Path Group: reg2reg\n  Path Type: max\n  slack (VIOLATED) -0.10\n';
    await writeFile(path.join(flow, 'timing.rpt'), timing);
    await writeFile(path.join(flow, 'probe.json'), JSON.stringify({ format: 'custom-cell-fmax-probe/2', toolExit: 0,
      evidence: { 'netlist.v': { path: 'held-out-netlist.v', sha256: sha256(text) },
        'timing.rpt': { path: 'timing.rpt', sha256: sha256(timing) } } }));
    const ran = fixture.run('mine', 'structure_frequency'); assert.equal(ran.status, 0, ran.stderr);
    const raw = await readFile(path.join(flow, 'mining/structure_frequency/raw.json'), 'utf8');
    const record = JSON.parse(await readFile(path.join(flow, 'records/mine-structure_frequency.json'), 'utf8'));
    return { raw, source: record.facts.sourceNetlistSha256, candidates: JSON.parse(raw).generation_requests };
  };
  const first = await mine(false);
  const second = await mine(true);
  assert.notEqual(first.source, second.source);
  assert.notEqual(sha256(first.raw), sha256(second.raw), 'the source-linked mining record is recomputed from the current netlist');
  assert.deepEqual(first.candidates, []);
  assert.equal(second.candidates.length, 1);
  assert.match(second.candidates[0].candidate_id, /^CAND_STRUCTURE_FREQUENCY_/);
});

test('one AI research program sees actual reg2reg membership across all routes and emits a hash-bound finite screen', async (t) => {
  const fixture = await createCustomCellFmaxFixture(); t.after(() => fixture.dispose());
  const flow = path.join(fixture.workspace, 'flow');
  await Promise.all([
    cp(path.join(packDir, 'flow/ai_research_runner.py'), path.join(flow, 'ai_research_runner.py')),
    cp(path.join(packDir, 'flow/read-stage.py'), path.join(flow, 'read-stage.py')),
  ]);
  const netlist = 'module held_out_datapath(input clk,a,b,c,d,output z,z2);\n'
    + 'NAND2_X1 U0(.A(a),.B(b),.ZN(n));\nINV_X1 U1(.A(n),.ZN(m));\nNAND2_X1 U4(.A(m),.B(c),.ZN(z));\n'
    + 'NAND2_X1 U2(.A(a),.B(b),.ZN(n2));\nINV_X1 U3(.A(n2),.ZN(m2));\nNAND2_X1 U5(.A(m2),.B(d),.ZN(z2));\nendmodule\n';
  const timing = `Report : timing\nDesign : held_out_datapath\n  Startpoint: r0\n  Endpoint: r1\n  Path Group: reg2reg\n  Path Type: max\n  U0/A (NAND2_X1) 0.01 0.00 0.10\n  U0/ZN (NAND2_X1) 0.01 0.03 0.13\n  U1/A (INV_X1) 0.01 0.00 0.13\n  U1/ZN (INV_X1) 0.01 0.02 0.15\n  slack (VIOLATED) -0.10\n`;
  const metrics = 'asked_period_ns\t0.500000\nworst_slack_ns\t-0.100000\ncell_area_um2\t2.000000\n';
  await Promise.all([
    writeFile(path.join(flow, 'probe-netlist.v'), netlist),
    writeFile(path.join(flow, 'timing.rpt'), timing),
    writeFile(path.join(flow, 'metrics.tsv'), metrics),
  ]);
  await writeFile(path.join(flow, 'probe.json'), JSON.stringify({
    format: 'custom-cell-fmax-probe/2', toolExit: 0, askedPeriodNs: 0.5,
    effectiveIdentity: { inputs: { designTop: 'held_out_datapath' } },
    evidence: {
      'netlist.v': { path: 'probe-netlist.v', sha256: sha256(netlist) },
      'timing.rpt': { path: 'timing.rpt', sha256: sha256(timing) },
      metrics: { path: 'metrics.tsv', sha256: sha256(metrics) },
    },
  }, null, 2) + '\n');
  const parsed = spawnSync('/usr/bin/python3', ['-c', `import importlib.util,json,pathlib,sys
spec=importlib.util.spec_from_file_location('m',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
mods=m.parse_modules(pathlib.Path(sys.argv[2]).read_text());print(json.dumps(m.parse_reg2reg_path_membership(pathlib.Path(sys.argv[3]),sys.argv[4],mods)))`,
  path.join(packDir, 'flow/domain/mine_timing_route.py'), path.join(flow, 'probe-netlist.v'),
  path.join(flow, 'timing.rpt'), 'held_out_datapath'], { encoding: 'utf8' });
  assert.equal(parsed.status, 0, parsed.stderr);
  assert.equal(JSON.parse(parsed.stdout).held_out_datapath.U0.path_hits, 1,
    'the real timing-path parser maps actual reg2reg points to mapped instances');
  const routes = ['timing_criticality', 'timing_context', 'structure_frequency', 'structure_compaction',
    'mapper_compatibility', 'functional_diversity'];
  const mined = fixture.run('mine', 'structure_frequency'); assert.equal(mined.status, 0, mined.stderr);
  const baseRaw = JSON.parse(await readFile(path.join(flow, 'mining/structure_frequency/raw.json'), 'utf8'));
  assert.ok(baseRaw.generation_requests.length > 0);
  for (const route of routes) {
    const raw = structuredClone(baseRaw); raw.strategy_id = route;
    if (route.startsWith('timing_')) for (const candidate of raw.generation_requests) {
      candidate.discovery_evidence.reg2reg_path_hits = 1;
      candidate.discovery_evidence.reg2reg_increment_ns = 0.03;
    }
    const rawPath = path.join(flow, `mining/${route}/raw.json`); await mkdir(path.dirname(rawPath), { recursive: true });
    const bytes = JSON.stringify(raw, null, 2) + '\n'; await writeFile(rawPath, bytes);
    await writeFile(path.join(flow, `records/mine-${route}.json`), JSON.stringify({ schema: 'custom-cell-fmax-stage/1',
      stage: `mine-${route}`, status: 'passed', facts: { codeSha256: 'a'.repeat(64) },
      artifacts: [{ role: 'mining_raw', path: path.relative(fixture.workspace, rawPath), sha256: sha256(bytes), bytes: Buffer.byteLength(bytes) }],
    }, null, 2) + '\n');
  }
  const directory = path.join(fixture.workspace, 'research/ai-discovery'); await mkdir(directory, { recursive: true });
  const entry = `from pathlib import Path\nimport sys\nFLOW=Path(__file__).resolve().parents[2]/"flow"\nsys.path.insert(0,str(FLOW))\nfrom ai_research_runner import run\ndef research(candidates,context):\n e=lambda r:r.get("discovery_evidence") or {}\n ranked=sorted(candidates,key=lambda r:(-(e(r).get("reg2reg_path_hits") or 0),-(e(r).get("non_overlapping_support") or 0),r["candidate_id"]))\n hs=[{"name":"path","question":"actual reg2reg coverage?","signals":["reg2reg_path_hits"]},{"name":"reuse","question":"mapped reuse?","signals":["non_overlapping_support"]},{"name":"fit","question":"mapper fit?","signals":["implementation_route"]}]\n seen=set(); selected=[]\n for row in ranked:\n  d=((row.get("generator_contract") or {}).get("equivalence_reference") or {}).get("digest")\n  if d in seen: continue\n  seen.add(d); selected.append({"route":row["route"],"candidate_id":row["candidate_id"],"hypothesis":"path" if e(row).get("reg2reg_path_hits") else "reuse","rationale":"current evidence rank"})\n  if len(selected)>=context["max_cells"]: break\n return {"hypotheses":hs,"selected":selected,"stop_reason":"finite budget filled for one DC screen"}\nif __name__=="__main__": run(research,sys.argv)\n`;
  const entryPath = path.join(directory, 'entry.py'); await writeFile(entryPath, entry);
  const executed = spawnSync('/usr/bin/python3', [entryPath, fixture.workspace, '0'], { encoding: 'utf8' });
  assert.equal(executed.status, 0, executed.stderr);
  const reportPath = path.join(flow, 'research/research.json');
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  assert.deepEqual(report.target, { design_top: 'held_out_datapath', path_group: 'reg2reg',
    reg2reg_wns_ns: -0.1, reg2reg_path_count: 1, timing_report_sha256: sha256(timing) });
  assert.equal(report.hypotheses.length, 3); assert.equal(report.selected.length, 1);
  assert.equal(report.algorithm.entrySha256, sha256(entry));
  const read = fixture.read(reportPath, 'research-selection');
  assert.equal(read.run.status, 0, read.run.stderr);
  assert.deepEqual(JSON.parse(await readFile(read.out, 'utf8')).values.map((value: any) => value.type),
    ['research_hypothesis_count', 'selected_count']);
});

test('Innovus 23.14 connectivity summary grammar is read as a physical violation count', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hima-connectivity-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const report = path.join(directory, 'connectivity.rpt');
  await writeFile(report, 'Begin Summary\n    2 Problem(s) (IMPVFC-98): Net has no global routing.\n    2 total info(s) created.\nEnd Summary\n');
  for (const [module, functionName] of [['flow/stages.py', 'parse_connectivity'], ['flow/read-stage.py', 'connectivity_count']] as const) {
    const read = spawnSync('/usr/bin/python3', ['-c', `import importlib.util,pathlib,sys;spec=importlib.util.spec_from_file_location('checked',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);print(getattr(m,sys.argv[2])(pathlib.Path(sys.argv[3])))`,
      path.join(packDir, module), functionName, report], { encoding: 'utf8' });
    assert.equal(read.status, 0, `${module}: ${read.stderr}`); assert.equal(read.stdout.trim(), '2');
  }
});

test('Innovus 23.14 Path 1 slack accepts the observed optional equals marker without weakening WNS equality', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hima-timing-path-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const summary = path.join(directory, 'post.summary');
  const paths = path.join(directory, 'post.paths');
  const command = 'timeDesign -postRoute -outDir /tmp/report -prefix post';
  await writeFile(summary, `# Command: ${command}\n| Setup mode | all |\n| WNS (ns): | -0.004 |\n| TNS (ns): | -0.004 |\n| Violating Paths: | 1 |\n| All Paths: | 5 |\n`);
  const check = async (slackLine: string, expectedStatus: number) => {
    await writeFile(paths, `# Command: ${command}\nPath 1: VIOLATED Setup Check\nAnalysis View: view_foundry\n${slackLine}\n`);
    for (const [module, functionName] of [['flow/stages.py', 'parse_timing_summary'], ['flow/read-stage.py', 'timing'], ['tools/read-stage.py', 'timing']] as const) {
      const read = spawnSync('/usr/bin/python3', ['-c', `import importlib.util,pathlib,sys;spec=importlib.util.spec_from_file_location('checked',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);print(getattr(m,sys.argv[2])(pathlib.Path(sys.argv[3]),pathlib.Path(sys.argv[4])))`,
        path.join(packDir, module), functionName, summary, paths], { encoding: 'utf8' });
      assert.equal(read.status, expectedStatus, `${module}: ${read.stderr}`);
    }
  };
  await check('Slack Time                   -0.004', 0);
  await check('= Slack Time                 -0.004', 0);
  await check('Slack Time                   -0.003', 1);
});

test('DC pressure evidence must be aes_cipher_top reg2reg rather than an I/O path or another top', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hima-dc-pressure-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const report = path.join(directory, 'timing.rpt');
  const render = (top: string, group: string, slack = '-0.090') =>
    `Report : timing\nDesign : ${top}\n  Startpoint: state_reg_0\n  Endpoint: state_reg_1\n  Path Group: ${group}\n  Path Type: max\n  slack (VIOLATED) ${slack}\n`;
  const audit = (top: string, group: string) => {
    writeFileSync(report, render(top, group));
    return spawnSync('/usr/bin/python3', [path.join(repoRoot, 'scripts/audit-dc-target-pressure.py'),
      '--report', report, '--expected-top', 'aes_cipher_top', '--maximum-slack-ns', '0'], { encoding: 'utf8' });
  };
  assert.equal(audit('dynamic_node_top_wrap', 'clk').status, 2);
  assert.equal(audit('aes_cipher_top', 'clk').status, 2);
  const accepted = audit('aes_cipher_top', 'reg2reg');
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.equal(JSON.parse(accepted.stdout).observed.worstSlackNs, -0.09);
  for (const module of ['flow/stages.py', 'flow/read-stage.py', 'tools/read-stage.py']) {
    const read = spawnSync('/usr/bin/python3', ['-c', `import importlib.util,pathlib,sys;spec=importlib.util.spec_from_file_location('checked',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);print(m.dc_target_pressure(pathlib.Path(sys.argv[2]),'aes_cipher_top'))`,
      path.join(packDir, module), report], { encoding: 'utf8' });
    assert.equal(read.status, 0, `${module}: ${read.stderr}`);
  }
});

test('probe reader preserves precise reg2reg WNS while accepting only the timing report print resolution', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hima-probe-resolution-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const metrics = 'asked_period_ns\t0.500000\nworst_slack_ns\t-0.104597\ncell_area_um2\t8597.862007\n';
  const timing = (slack: string) => `Design : aes_cipher_top\n  Startpoint: state_reg_0\n  Endpoint: state_reg_1\n  Path Group: reg2reg\n  Path Type: max\n  slack (VIOLATED) ${slack}\n`;
  const identity = { schema: 1, inputs: { designTop: 'aes_cipher_top' }, method: {}, tool: {} };
  const pinned = JSON.stringify(identity);
  await writeFile(path.join(directory, 'probe-inputs.json'), pinned);
  await writeFile(path.join(directory, 'metrics.tsv'), metrics);
  const report = path.join(directory, 'probe.json');
  const run = async (printedSlack: string) => {
    const timingText = timing(printedSlack); await writeFile(path.join(directory, 'timing.rpt'), timingText);
    await writeFile(report, JSON.stringify({ format: 'custom-cell-fmax-probe/2', toolExit: 0, askedPeriodNs: 0.5,
      effectiveIdentity: identity, identity: { path: 'probe-inputs.json', sha256: sha256(pinned) },
      evidence: { metrics: { path: 'metrics.tsv', sha256: sha256(metrics) },
        'timing.rpt': { path: 'timing.rpt', sha256: sha256(timingText) } } }));
    return ['flow/read-probe.py', 'tools/read-probe.py'].map((reader) => spawnSync('/usr/bin/python3',
      [path.join(packDir, reader), report, path.join(directory, `${reader.replaceAll('/', '-')}.json`)], { encoding: 'utf8' }));
  };
  for (const result of await run('-0.10')) assert.equal(result.status, 0, result.stderr);
  for (const result of await run('-0.09')) assert.notEqual(result.status, 0);
});

test('a real Pack-sourced workspace materializes declared Site inputs without a Golden Flow or legacy object', async (t) => {
  const h = await createHimaHome(); t.after(() => h.dispose());
  const designRoot = path.join(h.home, 'held-out-design'); await mkdir(designRoot);
  const rtl = path.join(designRoot, 'top.v'), constraints = path.join(designRoot, 'constraints.tcl');
  const foundry = path.join(designRoot, 'foundry.db'), physical = path.join(designRoot, 'physical.json'), tools = path.join(designRoot, 'tools.json');
  await writeFile(rtl, 'module held_out(input clk); endmodule\n'); await writeFile(constraints, 'create_clock -name clk -period 1 [get_ports clk]\n'); await writeFile(foundry, 'fixture\n');
  const profile = path.join(designRoot, 'profile'); const helper = path.join(profile, 'helpers');
  await mkdir(helper, { recursive: true });
  await Promise.all(['estimate_lib.py', 'mock_char.py'].map((name) => writeFile(path.join(helper, name), `# fixture ${name}\n`)));
  const profileFiles = ['foundry.lib', 'foundry.lef', 'qrc', 'foundry.gds', 'tech.lef', 'pdk.json',
    'skeleton.lib', 'tech.py', 'rules.json', 'timing.json', 'power.json', 'area.json', 'map'];
  await Promise.all(profileFiles.map((name) => writeFile(path.join(profile, name), `fixture ${name}\n`)));
  const physicalProfile = {
    CLOCK_NAME: 'clk', FOUNDRY_LIB: path.join(profile, 'foundry.lib'), FOUNDRY_LEF: path.join(profile, 'foundry.lef'),
    FOUNDRY_QRC_TECH: path.join(profile, 'qrc'), FOUNDRY_GDS: path.join(profile, 'foundry.gds'), TECH_LEF: path.join(profile, 'tech.lef'),
    BOOL2CMOS_CMD: 'python3 -m bool2cmos.cli', BOOL2CMOS_CWD: profile, BOOL2CMOS_PDK_PROFILE: path.join(profile, 'pdk.json'),
    LIBERTY_SKELETON: path.join(profile, 'skeleton.lib'), LIBRECELL_TECH_PY: path.join(profile, 'tech.py'),
    GEOMETRY_RULE_DECK: path.join(profile, 'rules.json'), CHARMODEL_TIMING_MODEL: path.join(profile, 'timing.json'),
    CHARMODEL_POWER_MODEL: path.join(profile, 'power.json'), CHARMODEL_AREA_MODEL: path.join(profile, 'area.json'),
    CCFMAX_GDS_MAP: path.join(profile, 'map'), CCFMAX_CHARMODEL_HELPER_DIR: helper,
    PROCESS_FAMILY: 'fixture', CELL_ARCHITECTURE_REF: 'fixture://architecture', CHARACTERIZATION_PROFILE_REF: 'fixture://characterization',
    DRIVE_STRENGTH: 'fixture', VT_CLASS: 'fixture', CCFMAX_CONTAINER_RUNTIME: '/usr/bin/true', CCFMAX_CONTAINER_IMAGE: 'fixture-image',
    CCFMAX_CONTAINER_HOST_ROOT: h.workspace, CCFMAX_CONTAINER_MOUNT_POINT: '/workspace', CCFMAX_LCLAYOUT_ACTIVATE: '/opt/fixture/activate',
    CCFMAX_POWER_PIN: 'vdd', CCFMAX_GROUND_PIN: 'gnd', CCFMAX_POWER_TEMPLATE_BASE_CELL: 'FIXTURE_CELL',
    GENERATED_LIBRARY_NAME: 'fixture_generated', GENERATED_LIB_CELL_PATTERN: 'XS_*', CLOCK_NS: 1, CCFMAX_RC_TEMPERATURE: 25,
    CCFMAX_PROCESS_NODE: 12, CCFMAX_MAX_ROUTE_LAYER: 'M8', CCFMAX_TAP_CELL: 'TAP', CCFMAX_TAP_INTERVAL: 10,
    CCFMAX_FILLER_CELLS: 'FILL', CCFMAX_SWITCHING_ACTIVITY: 0.2, PLACE_SITE: 'core', MAX_CELLS: 1, MAX_ROUTE_CANDIDATES: 2,
    GENERATION_TIMEOUT_SEC: 30, ABSTRACT_TIMEOUT_SEC: 30, CHARACTERIZE_TIMEOUT_SEC: 30, LC_TIMEOUT_SEC: 30, MULTI_CPU: 1,
    PNR_TIMEOUT_SEC: 30, DRC_LIMIT: 1000, VERIFY_TIMEOUT_SEC: 30,
  };
  const toolProfile = { EDA_WRAPPER: '/usr/bin/true', SYNTH_TIMEOUT_SEC: 30 };
  const rejectedPhysical = { ...physicalProfile }; delete (rejectedPhysical as Record<string, unknown>).CCFMAX_TAP_INTERVAL;
  await writeFile(physical, JSON.stringify(rejectedPhysical)); await writeFile(tools, JSON.stringify(toolProfile));
  const rejectedWorkspace = path.join(h.workspace, 'rejected-bind'); await mkdir(path.join(rejectedWorkspace, 'flow'), { recursive: true });
  const rejected = spawnSync('/usr/bin/python3', [path.join(packDir, 'flow/bind-inputs.py'), '--workspace', rejectedWorkspace,
    '--design-root', designRoot, '--rtl-glob', rtl, '--design-top', 'held_out', '--constraints', constraints,
    '--foundry-library', foundry, '--physical-inputs', physical, '--tool-stack', tools], { encoding: 'utf8' });
  assert.notEqual(rejected.status, 0); assert.match(rejected.stderr, /CCFMAX_TAP_INTERVAL/);
  await writeFile(physical, JSON.stringify(physicalProfile));
  const destination = path.join(h.home, 'hima/packs/custom-cell-fmax-dtco');
  installPackMethod({ from: packDir, to: destination });
  await writeLocalSite(h, { bindings: { designRoot, rtlGlob: rtl, designTop: 'held_out', constraints, foundryLibrary: foundry,
    physicalInputs: physical, toolStack: tools, workspaceRoot: h.workspace }, allowedReadRoots: [h.home, h.workspace],
    allowedWriteRoots: [h.workspace], allowedWrappers: ['/usr/bin/python3'], licences: { 'Design-Compiler': 1, 'Library-Compiler': 1, Innovus: 1 } });
  const host = await bootInProcess(h);
  try {
    const owner = await createRootAgent(host.ctx, h.workspace);
    const started = await host.ctx.hima.startRun({ pack: 'custom-cell-fmax-dtco', site: 'local', goal: { target_period_ns: 1 },
      strategy: { periodNs: 1, floorplanUtilization: 0.5, algorithmRevision: 0 }, ownerSessionId: String(owner.id), generationLimit: 1 });
    assert.equal(started.kind, 'ran', JSON.stringify(started)); if (started.kind !== 'ran') return;
    assert.equal(started.run.currentNode, 'bind-inputs');
    const begin = await host.ctx.hima.executionAction({ runId: started.run.id, actor: String(owner.id), expectedEpoch: 1, expectedRevision: 0,
      requestId: 'bind-begin', action: 'begin', nodeId: 'bind-inputs' });
    const executionId = begin.receipt?.executionId; assert.ok(executionId);
    const work = await host.ctx.hima.executionAction({ runId: started.run.id, actor: String(owner.id), expectedEpoch: 1, expectedRevision: 1,
      requestId: 'bind-work', action: 'work', executionId });
    assert.equal(work.kind, 'accepted', work.reason);
    await waitUntil('the Pack input adapter finishes', () => host.ctx.hima.executionContext(started.run.id).executions.some(item => item.id === executionId && item.phase === 'ready'));
    const materialized = JSON.parse(await readFile(path.join(started.workspace, 'flow/inputs.json'), 'utf8')) as Record<string, unknown>;
    assert.equal(materialized.designTop, 'held_out'); assert.equal(materialized.DESIGN_TOP, 'held_out');
    assert.equal(materialized.edaWrapper, '/usr/bin/true');
    assert.equal(materialized.rtlGlob, rtl); assert.equal(materialized.legacy, undefined);
    assert.equal(await readFile(path.join(started.workspace, 'flow/stages.py'), 'utf8'), await readFile(path.join(packDir, 'flow/stages.py'), 'utf8'));
    await host.ctx.hima.cancelRun(started.run.id);
  } finally { await host.dispose(); }
});

async function runHeldOutPhysicalComparison(flags: readonly string[] = []) {
  const fixture = await createCustomCellFmaxFixture();
  const flow = path.join(fixture.workspace, 'flow');
  for (const flag of flags) await writeFile(path.join(flow, flag), 'fixture control\n');
  const generatedLib = path.join(flow, 'fixture-generated.lib');
  const generatedLef = path.join(flow, 'fixture-generated.lef');
  await writeFile(generatedLib, 'library (synthetic_generated) { cell (XS_FIX_ZN) { pin(A) { direction : input; } pin(Z) { direction : output; function : "A"; } } }\n');
  await writeFile(generatedLef, 'VERSION 5.7 ;\nMACRO XS_FIX_ZN\n  CLASS CORE ;\nEND XS_FIX_ZN\nEND LIBRARY\n');
  await writeCustomSyntheticRecord(fixture.workspace, 'characterize', [{ role: 'generated_liberty', path: generatedLib }]);
  await writeCustomSyntheticRecord(fixture.workspace, 'layout', [{ role: 'abstract_lef:XS_FIX_ZN', path: generatedLef }]);
  for (const stage of ['compile', 'foundry-synth', 'custom-synth', 'pnr-foundry', 'pnr-generated', 'verify', 'compare']) {
    const argument = stage.startsWith('pnr-') ? '0.25' : stage.endsWith('-synth') ? '0.34' : undefined;
    const result = fixture.run(stage, argument);
    if (result.status !== 0) {
      const record = JSON.parse(await readFile(path.join(flow, `records/${stage}.json`), 'utf8'));
      const log = record.executions?.[0]?.log?.path;
      throw new Error(`${stage}: ${result.stderr}\n${record.facts?.rejected_reason ?? record.facts?.tool_failure_reason ?? ''}\n${log ? await readFile(path.join(fixture.workspace, log), 'utf8') : ''}`);
    }
  }
  return fixture;
}

test('held-out flat bindings accept only a matched final-database custom-Cell Fmax improvement', async (t) => {
  const fixture = await runHeldOutPhysicalComparison(); t.after(() => fixture.dispose());
  const compare = JSON.parse(await readFile(path.join(fixture.workspace, 'flow/records/compare.json'), 'utf8'));
  assert.equal(fixture.inputs.designTop, 'held_out_datapath');
  assert.equal(fixture.inputs.legacy, undefined);
  assert.equal(compare.facts.adopted_instance_count, 1, 'the restored generated final database has a custom Cell instance');
  for (const arm of ['foundry-synth', 'custom-synth']) {
    const synthesis = JSON.parse(await readFile(path.join(fixture.workspace, `flow/records/${arm}.json`), 'utf8'));
    assert.equal(synthesis.facts.clock_ns, 0.34, `${arm} must use the current Campaign period`);
    assert.equal(synthesis.facts.dc_uncertainty_ns, 0.17, `${arm} must use 50% DC uncertainty`);
    assert.equal(synthesis.facts.route_uncertainty_ns, 0.085, `${arm} must emit 25% route uncertainty`);
  }
  const foundryPnr = JSON.parse(await readFile(path.join(fixture.workspace, 'flow/records/pnr-foundry.json'), 'utf8'));
  const generatedPnr = JSON.parse(await readFile(path.join(fixture.workspace, 'flow/records/pnr-generated.json'), 'utf8'));
  for (const record of [foundryPnr, generatedPnr]) {
    const script = record.artifacts.find((item: { role: string }) => item.role === `pnr_script:${record.facts.arm}`);
    const text = await readFile(path.join(fixture.workspace, script.path), 'utf8');
    assert.doesNotMatch(text, /setPlaceMode[^\n]*baseline placement/,
      'multi-line pin placeholders must not expand into a template comment');
  }
  assert.equal(foundryPnr.facts.floorplan_utilization, 0.25);
  assert.deepEqual(generatedPnr.facts.floorplan_core_box, foundryPnr.facts.floorplan_core_box);
  assert.deepEqual(generatedPnr.facts.pin_plan_identity, foundryPnr.facts.pin_plan_identity);
  assert.equal(compare.facts.fmax_improved, true);
  assert.equal(compare.facts.comparison_valid, true);
  assert.ok(compare.facts.generated_fmax_mhz > compare.facts.foundry_fmax_mhz);
  assert.equal(compare.facts.full_constraint_failures, 0);
  const read = fixture.read(path.join(fixture.workspace, 'flow/records/compare.json'), 'compare');
  assert.equal(read.run.status, 0, read.run.stderr);
  const pnrRead = fixture.read(path.join(fixture.workspace, 'flow/records/pnr-generated.json'), 'pnr-generated');
  assert.equal(pnrRead.run.status, 0, pnrRead.run.stderr);
  const physicalTypes = new Set((JSON.parse(await readFile(pnrRead.out, 'utf8')).values as { type: string }[]).map((value) => value.type));
  for (const type of ['hold_wns', 'hold_violating_paths', 'route_drc_violations', 'connectivity_violations',
    'postroute_power', 'gate_count', 'cell_count', 'postroute_cell_area', 'route_instance_count', 'route_density', 'congestion_overflow']) assert.ok(physicalTypes.has(type), type);
});

test('final comparison re-reads physical reports and rejects a stage record that contradicts them', async (t) => {
  const fixture = await runHeldOutPhysicalComparison(); t.after(() => fixture.dispose());
  const recordPath = path.join(fixture.workspace, 'flow/records/pnr-generated.json');
  const record = JSON.parse(await readFile(recordPath, 'utf8'));
  const reference = record.artifacts.find((item: { role: string }) => item.role === 'route_drc_report');
  const reportPath = path.join(fixture.workspace, reference.path);
  const report = `# Command: verify_drc -limit 100000 -report ${reportPath}\nTotal Violations: 2\n`;
  await writeFile(reportPath, report); reference.sha256 = sha256(report); reference.bytes = Buffer.byteLength(report);
  await writeFile(recordPath, JSON.stringify(record, null, 2) + '\n');
  const compared = fixture.run('compare'); assert.equal(compared.status, 0, compared.stderr);
  const result = JSON.parse(await readFile(path.join(fixture.workspace, 'flow/records/compare.json'), 'utf8'));
  assert.equal(result.facts.full_constraint_failures, null);
  assert.match(result.facts.unknownReason.join('; '), /physical fact disagrees with retained report/);
  const read = fixture.read(path.join(fixture.workspace, 'flow/records/compare.json'), 'compare');
  assert.equal(read.run.status, 0, read.run.stderr);
  assert.ok((JSON.parse(await readFile(read.out, 'utf8')).values as { value: number | null }[]).every((value) => value.value === null));
});

for (const [name, flags] of [
  ['equal Fmax', ['synthetic-equal-fmax']],
  ['lower Fmax', ['synthetic-lower-fmax']],
  ['zero final-database custom Cell adoption', ['synthetic-zero-final-adoption']],
  ['route DRC violations', ['synthetic-route-drc']],
  ['connectivity violations', ['synthetic-connectivity']],
  ['hold violations', ['synthetic-hold-violation']],
] as const) {
  const physicalFinding = ['route DRC violations', 'connectivity violations', 'hold violations'].includes(name);
  test(physicalFinding
    ? `held-out comparison discloses ${name} without erasing otherwise valid Fmax evidence`
    : `held-out comparison rejects ${name} as a successful Campaign conclusion`, async (t) => {
    const fixture = await runHeldOutPhysicalComparison(flags); t.after(() => fixture.dispose());
    const compare = JSON.parse(await readFile(path.join(fixture.workspace, 'flow/records/compare.json'), 'utf8'));
    assert.ok(compare.facts.full_constraint_failures > 0);
    assert.equal(compare.facts.fmax_improved, name.includes('Fmax') ? false : true);
    assert.equal(compare.facts.comparison_valid, name === 'zero final-database custom Cell adoption' ? false : true,
      'physical findings stay visible but do not erase a valid matched Fmax comparison');
  });
}

test('held-out comparison refuses to turn mismatched setup conditions into a conclusion', async (t) => {
  const fixture = await runHeldOutPhysicalComparison(['synthetic-custom-input-delay']); t.after(() => fixture.dispose());
  const compare = JSON.parse(await readFile(path.join(fixture.workspace, 'flow/records/compare.json'), 'utf8'));
  assert.equal(compare.facts.matched_conditions, false);
  assert.equal(compare.facts.comparison_valid, false);
  assert.ok(compare.facts.full_constraint_failures > 0);
});
