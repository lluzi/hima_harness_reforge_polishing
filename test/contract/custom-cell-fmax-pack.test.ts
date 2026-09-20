import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { parse } from 'yaml';
import { checkPack, choose, installPackMethod, loadPack, loadSite, packKnowledgeManifestOf, packOverview, resolveChooser, searchPackKnowledge } from '@hima/harness';
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

test('the LFR Pack declares one fixed multi-index graph before the preserved commercial tail', async () => {
  type GraphNode = { id: string; kind: 'act' | 'judge' | 'explore' | 'wait'; parameters: {
    tool?: string; observes?: string; workshop?: string; arguments?: Record<string, unknown>;
    rules?: string[]; chooser?: string; growth?: boolean;
    converge?: { generationLimit?: number };
  } };
  type GraphEdge = { from: string; to: string; outcome?: string; revisit?: boolean };
  const graph = parse(await readFile(path.join(packDir, 'graph.yml'), 'utf8')) as {
    id: string; version: string; entry: string; nodes: GraphNode[]; edges: GraphEdge[]; loops: Record<string, unknown>;
  };
  assert.deepEqual(Object.keys(graph).sort(), ['edges', 'entry', 'id', 'loops', 'nodes', 'version']);
  assert.equal(graph.id, 'custom-cell-fmax-dtco');
  assert.equal(graph.version, '5.2.7');
  assert.ok(graph.nodes.every((item) => item.id && item.kind && item.parameters));
  assert.ok(graph.edges.every((item) => item.from && item.to));
  const node = new Map(graph.nodes.map((item) => [item.id, item]));
  const edge = (from: string, to: string, outcome?: string, revisit?: boolean) => graph.edges.some((item) =>
    item.from === from && item.to === to && item.outcome === outcome && item.revisit === revisit);
  const chain = (ids: readonly string[]) => ids.slice(0, -1).every((from, at) => edge(from, ids[at + 1]!));

  assert.equal(graph.entry, 'bind-inputs');
  assert.deepEqual(graph.loops, {}, 'the license-free baseline replaces the nested commercial probe');
  assert.equal(node.has('probe'), false);
  assert.equal(node.has('synthesize'), false);
  assert.ok(chain(['bind-inputs', 'evaluation-baseline', 'read-evaluation-baseline']));

  const phases = graph.nodes.flatMap((item) => item.kind === 'act'
    && item.parameters.tool === 'evaluate-library-richness'
    ? [item.parameters.arguments?.EVALUATION_PHASE]
    : []);
  assert.deepEqual(phases, ['baseline', 'function-local', 'design-mapping-timing']);

  const routes = ['timing-criticality', 'timing-context', 'structure-frequency', 'structure-compaction',
    'mapper-compatibility', 'functional-diversity'];
  for (const route of routes) {
    assert.ok(edge('read-evaluation-baseline', `mine-${route}`), `${route} starts as an independent free branch`);
    assert.ok(chain([`mine-${route}`, `select-${route}`, 'merge-join']), `${route} retains its own observation before the join`);
  }
  assert.equal(graph.edges.filter((candidate) => candidate.from === 'read-evaluation-baseline').length, routes.length,
    'all six licence-free mining routes are available together instead of serialized');
  assert.ok(edge('merge-join', 'function-local-evaluation', 'PASS'));
  assert.ok(chain(['function-local-evaluation', 'read-function-local-evaluation',
    'function-local-gate']));
  assert.ok(chain(['research-candidates', 'read-research-selection', 'merge']));
  assert.ok(edge('function-local-gate', 'research-candidates', 'PASS'));
  assert.ok(edge('function-local-gate', 'research-candidates', 'FAIL'),
    'free-factor incompleteness remains evidence but cannot suppress the creative Workshop');

  assert.ok(chain(['merge', 'read-merge', 'generate', 'read-generate', 'layout', 'read-layout',
    'characterize', 'read-characterize', 'calibration-gate']));
  assert.ok(edge('calibration-gate', 'design-mapping-timing-evaluation', 'PASS'));
  assert.ok(edge('calibration-gate', 'calibration-research', 'FAIL'));
  assert.ok(edge('calibration-research', 'evaluation-baseline', undefined, true));
  assert.ok(chain(['design-mapping-timing-evaluation',
    'read-design-mapping-timing-evaluation', 'portfolio-gate']));
  assert.ok(edge('portfolio-gate', 'freeze-cumulative-library', 'PASS'));
  assert.ok(edge('portfolio-gate', 'next-research', 'FAIL'));
  assert.ok(chain(['freeze-cumulative-library', 'read-cumulative-library', 'compile', 'read-compile',
    'foundry-synth', 'read-foundry-synth', 'custom-synth', 'read-custom-synth', 'adoption',
    'read-adoption', 'adoption-gate']));
  assert.ok(edge('adoption-gate', 'pnr-foundry', 'PASS'));
  assert.ok(chain(['pnr-foundry', 'read-pnr-foundry', 'pnr-generated', 'read-pnr-generated', 'verify',
    'read-verify', 'compare', 'read-compare', 'final-judge']));
  assert.ok(edge('final-judge', 'next-research', 'FAIL'));
  assert.ok(edge('final-judge', 'next-research', 'PASS'),
    'a successful final judge must reach the goal-met chooser instead of falling through as goal-not-met');
  assert.ok(edge('next-research', 'evaluation-baseline', undefined, true));
  assert.equal(node.get('next-research')?.parameters.converge?.generationLimit, 8,
    'the graph generation bound stays aligned with bind-inputs cumulative-capacity readiness');

  assert.deepEqual(graph.nodes.flatMap((item) => item.kind === 'act' && item.parameters.workshop !== undefined
    ? [item.parameters.workshop] : []), ['research-candidates']);
  assert.deepEqual(graph.nodes.filter((item) => item.kind === 'explore').map((item) => item.id),
    ['calibration-research', 'next-research']);
  assert.deepEqual(node.get('calibration-gate')?.parameters.rules,
    ['mock-liberty-calibration-accepted', 'cell-demand-feedback-available']);
  assert.deepEqual(node.get('portfolio-gate')?.parameters.rules,
    ['proxy-metric-vector-complete', 'proxy-pairwise-relation-valid', 'portfolio-frontier-member',
      'e0-library-validation-candidate']);
  assert.deepEqual(node.get('final-judge')?.parameters.rules,
    ['fmax-improvement-at-least-target', 'comparison-evidence-valid', 'fmax-improved', 'clock-period-at-most'],
    'the first rule is the branch outcome: a valid goal miss must revisit research');
});

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
  const pressure = resolveChooser(loaded, 'maintain-reg2reg-pressure', 'the reading').chooser;
  const observation = (slack: number) => ({ id: 'pressure-observation', values: [
    { type: 'clock_period', unit: 'ns', value: 0.5 },
    { type: 'reg2reg_wns', unit: 'ns', mode: 'setup', scope: 'reg2reg', value: slack },
  ] }) as any;
  const verdict = (outcome: 'PASS' | 'FAIL', ruleId: string) => ({ outcome, ruleId }) as any;
  const chooserInput = { bound: { pressureMagnitudeNs: 0.1 }, knobs: loaded.contract.strategy,
    strategy: { periodNs: 0.5, floorplanUtilization: 0.25, algorithmRevision: 0 },
    goal: verdict('PASS', 'clock-period-at-most') };
  assert.deepEqual(choose(pressure, { ...chooserInput, observation: observation(-0.104597),
    constraint: verdict('PASS', 'reg2reg-pressure-at-least-100ps') }), {
    ok: true, chosen: { goalMet: true }, rationale: { period: 0.5, slack: -0.104597, pressureMagnitudeNs: 0.1 },
  });
  assert.deepEqual((choose(pressure, { ...chooserInput, observation: observation(-0.05),
    constraint: verdict('FAIL', 'reg2reg-pressure-at-least-100ps') }) as any).chosen.strategy.periodNs, 0.45);
  const calibration = resolveChooser(loaded, 'research-calibration-miss', 'the reading').chooser;
  const calibrationDecision = choose(calibration, {
    bound: { revisionStep: 1 }, knobs: loaded.contract.strategy,
    strategy: { periodNs: 0.5, floorplanUtilization: 0.25, algorithmRevision: 0 },
    observation: { id: 'calibration-observation', values: [
      { type: 'cell_demand_coverage_pct', unit: 'percent', value: 80 },
    ] } as any,
    constraint: verdict('FAIL', 'mock-liberty-calibration-accepted'),
    goal: verdict('PASS', 'cell-demand-feedback-available'),
  });
  assert.deepEqual(calibrationDecision, {
    ok: true,
    chosen: { strategy: { periodNs: 0.5, floorplanUtilization: 0.25, algorithmRevision: 1 } },
    rationale: { coverage: 80, revisionStep: 1 },
  }, 'a complete calibration miss becomes a recorded next-generation research decision');
  assert.deepEqual(loaded.contract.workshops.map((workshop) => workshop.id), ['research-candidates'],
    'one cross-route AI research moment replaces six narrow selector moments');
  const workshop = loaded.contract.workshops[0]!;
  assert.deepEqual(workshop.inputs, []);
  assert.deepEqual(workshop.reads.slice(0, 2),
    ['record_evaluation_baseline', 'record_function_local_evaluation']);
  assert.equal(workshop.reads.includes('record_design_mapping_timing_evaluation'), false,
    'the cold-start Workshop cannot require evidence produced only after its own delta');
  assert.deepEqual(workshop.knowledge,
    ['full-mining-method.md', 'library-richness-evaluation.md', 'active-frontier-v5.md']);
  assert.deepEqual(workshop.argv, ['/usr/bin/python3', '${ENTRY}', '--lfr-residual', '${WORKSPACE}',
    '${WORKSPACE}/flow/research/research.json']);
  assert.match(await readFile(path.join(packDir, 'flow/research-template.py'), 'utf8'),
    /WORKSPACE_ARG = 2 if .*--lfr-residual.* else 1/,
    'the residual entry resolves WORKSPACE after the mode flag');
  assert.ok(loaded.contract.workspace.copy.includes('library_richness.py'));
  assert.ok(graph.nodes.some((node) => node.id === 'research-candidates'));
  assert.ok(graph.nodes.some((node) => node.id === 'read-research-selection'));
  assert.deepEqual((graph.nodes.find((node) => node.id === 'final-judge')?.parameters as any)?.rules,
    ['fmax-improvement-at-least-target', 'comparison-evidence-valid', 'fmax-improved', 'clock-period-at-most']);
  const pnrTemplate = await readFile(path.join(packDir, 'flow/domain/pnr.tcl.tmpl'), 'utf8');
  assert.match(pnrTemplate, /^saveNetlist @@POSTROUTE_NETLIST@@$/m);
  assert.match(pnrTemplate, /^set_ccopt_property buffer_cells \$_ccfmax_clock_buffers$/m);
  assert.match(pnrTemplate, /^set_ccopt_property inverter_cells \$_ccfmax_clock_inverters$/m);
  assert.match(pnrTemplate, /^set_ccopt_property use_inverters true$/m);
  assert.match(pnrTemplate, /-numPaths 100 -expandReg2Reg -pathreports/);
  assert.match(await readFile(path.join(packDir, 'flow/domain/shared_synth.tcl'), 'utf8'),
    /set _route_uncertainty \[expr \{\$CLK_NS \* 0\.25 \+ 0\.050\}\]/);
  assert.deepEqual((graph as any).loops, {},
    'the Pack starts from one license-free baseline instead of a nested commercial probe loop');
  const pressureRule = parse(await readFile(path.join(packDir, 'rules/reg2reg-pressure-at-least-100ps.yml'), 'utf8')) as any;
  assert.deepEqual(pressureRule.predicate, { op: 'lte', threshold: -0.1, unit: 'ns' });
  const pressureChooser = parse(await readFile(path.join(packDir, 'choosers/maintain-reg2reg-pressure.yml'), 'utf8')) as any;
  assert.deepEqual(pressureChooser.parameter, { name: 'pressureMagnitudeNs', unit: 'ns' });
  assert.deepEqual(pressureChooser.decide[2].next.periodNs,
    { sum: ['period', { neg: 'pressureMagnitudeNs' }, { neg: 'slack' }] },
    'insufficient pressure tightens the period instead of relaxing toward timing closure');
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
  assert.doesNotMatch(files.join('\n'), /aes_cipher_top|\/[^\s"']*tsmc28/i);
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
  assert.equal(packOverview(pack).status?.normalized, 'released');
  assert.equal(packOverview(pack).minimumHarnessVersion, '0.1.0');
  assert.equal(packKnowledgeManifestOf(pack)?.documents.length, 5);
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

  const noWorkspaceRead = await writeLocalSite(h, {
    bindings: { ...bindings, physicalInputs: path.join(h.workspace, 'physicalInputs') },
    allowedReadRoots: [], allowedWriteRoots: [], allowedWrappers: ['/usr/bin/python3'],
    licences: { 'Design-Compiler': 1, 'Library-Compiler': 1, Innovus: 1 },
  });
  const permitErrors = checkPack(pack, loadSite(noWorkspaceRead.sitesDir, noWorkspaceRead.name)).errors.join('\n');
  assert.match(permitErrors, /workspaceRoot.*permitted read roots/, 'preparation catches the read permission before a node reads its own record');
  assert.match(permitErrors, /workspaceRoot.*permitted write roots/, 'preparation catches the write permission before a node creates work');

  const overriddenWorkspace = path.join(os.tmpdir(), 'campaign-workspace-outside-site-permit');
  const outside = await writeLocalSite(h, {
    bindings: { ...bindings, physicalInputs: path.join(h.workspace, 'physicalInputs'), workspaceRoot: overriddenWorkspace },
    allowedReadRoots: [h.workspace], allowedWriteRoots: [h.workspace], allowedWrappers: ['/usr/bin/python3'],
    licences: { 'Design-Compiler': 1, 'Library-Compiler': 1, Innovus: 1 },
  });
  const outsideErrors = checkPack(pack, loadSite(outside.sitesDir, outside.name)).errors.join('\n');
  assert.match(outsideErrors, new RegExp(overriddenWorkspace.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'readiness names the effective workspace binding, not the permitted Site fallback');
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
  const directory = path.join(fixture.workspace, 'research/ai-discovery/.executions/execution-test');
  await mkdir(directory, { recursive: true });
  const entry = `from pathlib import Path\nimport sys\nFLOW=Path(sys.argv[1]).resolve()/"flow"\nsys.path.insert(0,str(FLOW))\nfrom ai_research_runner import run\ndef research(candidates,context):\n assert context["raw_candidate_count"]==6\n if context["retained_candidate_count"]:\n  assert len(candidates)==0 and context["candidate_pool_count"]==0\n else:\n  assert len(candidates)==1 and len(candidates[0]["source_methods"])==6 and context["candidate_pool_count"]==1\n  assert context["target_gain_pct"]==5 and candidates[0]["theoretical_gain"]["target_gain_pct"]==5\n e=lambda r:r.get("evidence") or {}\n ranked=sorted(candidates,key=lambda r:(-(e(r).get("reg2reg_path_hits") or 0),-(e(r).get("non_overlapping_support") or 0),r["candidate_id"]))\n hs=[{"name":"path","question":"actual reg2reg coverage?","signals":["reg2reg_path_hits"]},{"name":"reuse","question":"mapped reuse?","signals":["non_overlapping_support"]},{"name":"fit","question":"mapper fit?","signals":["implementation_route"]}]\n selected=[]\n for row in ranked:\n  selected.append({"route":row["route"],"candidate_id":row["candidate_id"],"hypothesis":"path" if e(row).get("reg2reg_path_hits") else "reuse","rationale":"current evidence rank"})\n return {"hypotheses":hs,"selected":selected,"stop_reason":"one unified Cell screen is filled"}\nif __name__=="__main__": run(research,sys.argv)\n`;
  const entryPath = path.join(directory, 'entry.py'); await writeFile(entryPath, entry);
  const executed = spawnSync('/usr/bin/python3', [entryPath, fixture.workspace, '0', '5'], { encoding: 'utf8' });
  assert.equal(executed.status, 0, executed.stderr);
  const reportPath = path.join(flow, 'research/research.json');
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  assert.deepEqual({ design_top: report.target.design_top, path_group: report.target.path_group,
    reg2reg_wns_ns: report.target.reg2reg_wns_ns, reg2reg_path_count: report.target.reg2reg_path_count,
    timing_report_sha256: report.target.timing_report_sha256, source_phase: report.target.source_phase,
    target_gain_pct: report.target.target_gain_pct },
  { design_top: 'held_out_datapath', path_group: 'reg2reg', reg2reg_wns_ns: -0.1,
    reg2reg_path_count: 1, timing_report_sha256: sha256(timing), source_phase: 'dc-probe', target_gain_pct: 5 });
  assert.equal(report.hypotheses.length, 3); assert.equal(report.selected.length, 1);
  assert.equal(report.theoreticalEstimates.length, 1);
  assert.ok(Math.abs(report.target.required_incremental_fmax_gain_pct - 5) < 1e-12);
  assert.ok(Math.abs(report.target.required_closed_period_reduction_ns - 0.02857142857142858) < 1e-12);
  assert.equal(report.theoreticalEstimates[0].meets_remaining_target_upper_bound, true);
  assert.equal(report.algorithm.rawCandidateCount, 6); assert.equal(report.algorithm.candidatePoolCount, 1);
  assert.equal(report.algorithm.entrySha256, sha256(entry));
  const read = fixture.read(reportPath, 'research-selection');
  assert.equal(read.run.status, 0, read.run.stderr);
  assert.deepEqual(JSON.parse(await readFile(read.out, 'utf8')).values.map((value: any) => value.type),
    ['research_hypothesis_count', 'selected_count', 'retained_candidate_count', 'theoretical_gain_upper_pct']);
  await mkdir(path.join(flow, 'library'), { recursive: true });
  await writeFile(path.join(flow, 'library/cumulative-manifest.json'), JSON.stringify({
    schema: 'custom-cell-cumulative-library/1',
    baselineReference: { source: 'held-out-foundry.lib', bytes: 1, sha256: '0'.repeat(64) },
    shards: [], functions: [],
  }, null, 2) + '\n');
  const merged = fixture.run('merge'); assert.equal(merged.status, 0, merged.stderr);
  const mergedReport = JSON.parse(await readFile(path.join(flow, 'mining/merged.json'), 'utf8'));
  assert.equal(mergedReport.search_bound.validation_flow_count, 1);
  assert.equal(mergedReport.candidate_set_accounting.source_candidate_count, 6);
  assert.equal(mergedReport.candidate_set_accounting.unique_buildable_pool_count, 1);
  assert.equal(mergedReport.generation_requests.length, 1);
  assert.equal(mergedReport.generation_requests[0].discovery_evidence.strategy_ids.length, 6,
    'all methods keep credit on the one Cell sent to the common validation flow');
  const priorPatterns = path.join(flow, 'prior-characterized-patterns.json');
  await writeFile(priorPatterns, JSON.stringify(mergedReport, null, 2) + '\n');
  await writeCustomSyntheticRecord(fixture.workspace, 'characterize', [
    { role: 'characterized_patterns', path: priorPatterns },
  ]);
  await writeCustomSyntheticRecord(fixture.workspace, 'adoption', [], { candidate_rows: [{
    candidate_id: mergedReport.generation_requests[0].candidate_id, generation_rank: 1,
    adopted_instance_count: 7, source_methods: mergedReport.generation_requests[0].discovery_evidence.strategy_ids,
  }] });
  const revised = spawnSync('/usr/bin/python3', [entryPath, fixture.workspace, '1', '5'], { encoding: 'utf8' });
  assert.equal(revised.status, 0, revised.stderr);
  const revisedReport = JSON.parse(await readFile(reportPath, 'utf8'));
  assert.equal(revisedReport.retainedCandidates.length, 1);
  assert.equal(revisedReport.selected.length, 0, 'an adopted equivalent is retained, not rediscovered as new work');
  const revisedRead = fixture.read(reportPath, 'research-selection');
  assert.equal(revisedRead.run.status, 0, revisedRead.run.stderr);
  const revisedMerge = fixture.run('merge'); assert.equal(revisedMerge.status, 0, revisedMerge.stderr);
  const cumulative = JSON.parse(await readFile(path.join(flow, 'mining/merged.json'), 'utf8'));
  assert.equal(cumulative.candidate_set_accounting.retained_candidate_count, 1);
  assert.equal(cumulative.candidate_set_accounting.new_candidate_count, 0);
  assert.deepEqual(cumulative.generation_requests.map((row: any) => row.candidate_id),
    [mergedReport.generation_requests[0].candidate_id]);
});

test('a later mining generation reads the generated routed netlist and post-route reg2reg timing', async (t) => {
  const fixture = await createCustomCellFmaxFixture(); t.after(() => fixture.dispose());
  const flow = path.join(fixture.workspace, 'flow');
  const netlist = path.join(flow, 'routed.v');
  const timing = path.join(flow, 'routed.tarpt.gz');
  const generatedLiberty = path.join(flow, 'prior-generated.lib');
  await writeFile(netlist, 'module held_out_datapath(input a,b,c,d,output z1,z2);\nNAND2_X1 U0(.A(a),.B(b),.ZN(n0));\nXS_PRIOR X0(.I(n0),.Y(nx));\nINV_X1 U1(.A(nx),.ZN(z1));\nNAND2_X1 U2(.A(c),.B(d),.ZN(n2));\nINV_X1 U3(.A(n2),.ZN(z2));\nendmodule\n');
  await writeFile(generatedLiberty, 'library (prior_generated) {\n  cell (\"XS_PRIOR\") {\n    area : 1;\n    pin (\"I\") {\n      direction : input;\n    }\n    pin (\"Y\") {\n      direction : output;\n      function : \"I\";\n    }\n  }\n}\n');
  await writeFile(timing, gzipSync(`#  Design:            held_out_datapath\nPath 1: VIOLATED Setup Check\nEndpoint: U1/ZN\nBeginpoint: U0/A\nPath Groups: {flop2flop}\nAnalysis View: view_generated\n= Slack Time                   -0.020\n     Timing Path:\n     | U0/A  | ^ | a  | NAND2_X1 | 0.002 | 0.002 | 0.000 |\n     | U0/ZN | v | n0 | NAND2_X1 | 0.020 | 0.022 | 0.000 |\n     | X0/I  | v | n0 | XS_PRIOR | 0.001 | 0.023 | 0.000 |\n     | X0/Y  | v | nx | XS_PRIOR | 0.012 | 0.035 | 0.000 |\n     | U1/A  | v | nx | INV_X1   | 0.001 | 0.036 | 0.000 |\n     | U1/ZN | ^ | z1 | INV_X1   | 0.010 | 0.033 | 0.000 |\n     Other End Path:\n`));
  await writeCustomSyntheticRecord(fixture.workspace, 'pnr-generated', [
    { role: 'postroute_netlist', path: netlist }, { role: 'postroute_timing_paths', path: timing },
    { role: 'generated_liberty', path: generatedLiberty },
  ]);
  await writeCustomSyntheticRecord(fixture.workspace, 'compare', [], { comparison_valid: true });
  const ran = fixture.run('mine', 'timing_criticality'); assert.equal(ran.status, 0, ran.stderr);
  const record = JSON.parse(await readFile(path.join(flow, 'records/mine-timing_criticality.json'), 'utf8'));
  const raw = JSON.parse(await readFile(path.join(flow, 'mining/timing_criticality/raw.json'), 'utf8'));
  assert.equal(record.facts.sourcePhase, 'generated-postroute');
  assert.equal(record.facts.sourceNetlistSha256, sha256(await readFile(netlist)));
  assert.ok(record.inputs.some((row: any) => row.role === 'postroute_generated_liberty'));
  assert.equal(raw.search_definition.source_phase, 'generated-postroute');
  const parsedLibrary = spawnSync('/usr/bin/python3', ['-c',
    `import json,sys\nsys.path.insert(0,sys.argv[1])\nfrom cell_need_miner.liberty import parse_skeleton\nprint(json.dumps(sorted(parse_skeleton(sys.argv[2:]))))`,
    path.join(packDir, 'flow/domain'), String(fixture.inputs.LIBERTY_SKELETON), generatedLiberty], { encoding: 'utf8' });
  assert.equal(parsedLibrary.status, 0, parsedLibrary.stderr);
  assert.ok(JSON.parse(parsedLibrary.stdout).includes('XS_PRIOR'),
    'the prior generated Cell remains parseable instead of becoming an unknown post-route boundary');
  assert.match(JSON.stringify(raw.algorithm_records.critical_subgraph), /XS_PRIOR/,
    'later timing mining reserves graph anchors around an adopted generated Cell on a sampled critical path');
});

test('Innovus post-route data-path tables map physical delay back to routed instances', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hima-postroute-parser-')); t.after(() => rm(root, { recursive: true, force: true }));
  const netlist = path.join(root, 'routed.v'); const timing = path.join(root, 'timing.rpt');
  await writeFile(netlist, 'module held_out_datapath(input a,b,c,d,output z,z2);\nNAND2_X1 U0(.A(a),.B(b),.ZN(n));\nINV_X1 U1(.A(n),.ZN(z));\nNAND2_X1 U2(.A(c),.B(d),.ZN(n2));\nINV_X1 U3(.A(n2),.ZN(z2));\nendmodule\n');
  await writeFile(timing, `#  Design:            held_out_datapath
Path 1: VIOLATED Setup Check
Endpoint: U1/ZN
Beginpoint: U0/A
Path Groups: {reg2reg}
Analysis View: view_generated
= Slack Time                   -0.019
     Timing Path:
     | CTS_ccl_a_buf_00001/Z | ^ | clk | BUFFD8BWP40P140 | 0.100 | 0.100 | 0.000 |
     | U0/A  | ^ | a | NAND2_X1 | 0.002 | 0.002 | 0.000 |
     | U0/ZN | v | n | NAND2_X1 | 0.020 | 0.022 | 0.000 |
     | U1/A  | v | n | INV_X1   | 0.001 | 0.023 | 0.000 |
     | U1/ZN | ^ | z | INV_X1   | 0.010 | 0.033 | 0.000 |
     Other End Path:
     | CTS/I | ^ | clk | BUFFD8BWP40P140 | 0.100 | 0.100 | 0.000 |
Path 2: VIOLATED Setup Check
Endpoint: U3/ZN
Beginpoint: U2/A
Path Groups: {reg2reg}
Analysis View: view_generated
= Slack Time                   -0.017
     Timing Path:
     | U2/A  | ^ | c  | NAND2_X1 | 0.002 | 0.002 | 0.000 |
     | U2/ZN | v | n2 | NAND2_X1 | 0.018 | 0.020 | 0.000 |
     | U3/A  | v | n2 | INV_X1   | 0.001 | 0.021 | 0.000 |
     | U3/ZN | ^ | z2 | INV_X1   | 0.009 | 0.030 | 0.000 |
     Other End Path:
`);
  const parsed = spawnSync('/usr/bin/python3', ['-c', `import importlib.util,json,pathlib,sys
spec=importlib.util.spec_from_file_location('m',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
mods=m.parse_modules(pathlib.Path(sys.argv[2]).read_text());print(json.dumps(m.parse_reg2reg_timing_graph(pathlib.Path(sys.argv[3]),sys.argv[4],mods),sort_keys=True))`,
  path.join(packDir, 'flow/domain/mine_timing_route.py'), netlist, timing, 'held_out_datapath'], { encoding: 'utf8' });
  assert.equal(parsed.status, 0, parsed.stderr);
  const graph = JSON.parse(parsed.stdout);
  const mapped = graph.instances.held_out_datapath;
  assert.equal(mapped.U0.path_hits, 1); assert.equal(mapped.U0.max_increment_ns, 0.02);
  assert.equal(mapped.U0.path_family_count, 1); assert.equal(mapped.U0.path_family_ids[0], 'U#->U#');
  assert.equal(mapped.U0.path_family_support, 2, 'one timing family covers both sampled graph paths');
  assert.equal(mapped.U0.worst_path_slack_ns, -0.019);
  assert.equal(graph.graph.path_count, 2); assert.equal(graph.graph.path_family_count, 1);
  assert.equal(graph.graph.path_families[0].path_count, 2);
  assert.equal(mapped.CTS, undefined, 'capture-clock table is not admitted as data-path opportunity evidence');
});

test('the routed-netlist audit admits only Site-declared DCCK clock-tree masters', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hima-clock-tree-audit-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const good = path.join(root, 'good.v'); const bad = path.join(root, 'bad.v');
  await writeFile(good, 'module top(input clk,output z);\nDCCKBD4 CTS_ccl_a_buf_00001(.I(clk),.Z(z));\nendmodule\n');
  await writeFile(bad, 'module top(input clk,output z);\nBUFFD8 CTS_ccl_a_buf_00001(.I(clk),.Z(z));\nendmodule\n');
  const code = `import importlib.util,json,sys\nspec=importlib.util.spec_from_file_location('s',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)\nprint(json.dumps(m.clock_tree_identity(sys.argv[2],'DCCKBD4 DCCKBD8','DCCKND4 DCCKND8'),sort_keys=True))`;
  const admitted = spawnSync('/usr/bin/python3', ['-c', code, path.join(packDir, 'flow/stages.py'), good], { encoding: 'utf8' });
  assert.equal(admitted.status, 0, admitted.stderr);
  assert.deepEqual(JSON.parse(admitted.stdout).clock_tree_used_cells, ['DCCKBD4']);
  const rejected = spawnSync('/usr/bin/python3', ['-c', code, path.join(packDir, 'flow/stages.py'), bad], { encoding: 'utf8' });
  assert.notEqual(rejected.status, 0); assert.match(rejected.stderr, /non-declared or non-DCCK Cells: BUFFD8/);
});

test('one synthesis adoption result attributes used Cells to every contributing mining method', async () => {
  const moduleDir = path.join(packDir, 'flow/domain');
  const code = `import json,sys\nsys.path.insert(0,sys.argv[1])\nfrom _cell_adoption_projection import project_attributed_texts\nd=json.load(sys.stdin)\nprint(json.dumps(project_attributed_texts(d["netlist"],d["liberty"],d["patterns"]),sort_keys=True))`;
  const netlist = 'module top;\n  XS_A_Z U0();\n  XS_A_Z U1();\n  FOUNDRY_X U2();\nendmodule\n';
  const liberty = 'library (generated) { cell (XS_A_Z) { } cell (XS_B_Z) { } }\n';
  const request = (id: string, methods: string[]) => ({ candidate_id: id,
    generator_contract: { interface: { inputs: [], outputs: [{ name: 'Z', liberty_function: '1' }] } },
    discovery_evidence: { strategy_ids: methods,
      strategy_rankings: Object.fromEntries(methods.map((method, index) => [method,
        { candidate_id: `${id}_${method}`, local_rank: index + 1, search_objective: method }])) } });
  const patterns = { generation_requests: [request('CAND_A', ['timing_criticality', 'structure_frequency']),
    request('CAND_B', ['functional_diversity'])] };
  const ran = spawnSync('/usr/bin/python3', ['-c', code, moduleDir],
    { input: JSON.stringify({ netlist, liberty, patterns }), encoding: 'utf8' });
  assert.equal(ran.status, 0, ran.stderr);
  const result = JSON.parse(ran.stdout);
  assert.equal(result.adopted_candidate_count, 1);
  assert.equal(result.adopted_instance_count, 2);
  assert.equal(result.candidate_rows[0].adopted_instance_count, 2);
  assert.deepEqual(result.method_rows.map((row: any) => [row.method, row.adopted_candidate_count, row.adopted_instance_count]), [
    ['structure_frequency', 1, 2], ['timing_criticality', 1, 2], ['functional_diversity', 0, 0],
  ]);
  assert.match(result.attribution_policy, /non-additive/);
  const retained = spawnSync('/usr/bin/python3', ['-c',
    'import json,sys;sys.path.insert(0,sys.argv[1]);from _generation_projection import retained_candidate_ids;print(json.dumps(retained_candidate_ids(json.load(sys.stdin),6)))',
    moduleDir], { input: JSON.stringify([
      { candidate_id: 'CAND_A', generation_rank: 1, adopted_instance_count: 2 },
      { candidate_id: 'CAND_B', generation_rank: 2, adopted_instance_count: 9 },
      { candidate_id: 'CAND_C', generation_rank: 3, adopted_instance_count: 4 },
      { candidate_id: 'CAND_D', generation_rank: 4, adopted_instance_count: 1 },
    ]), encoding: 'utf8' });
  assert.equal(retained.status, 0, retained.stderr);
  assert.deepEqual(JSON.parse(retained.stdout), ['CAND_B', 'CAND_C', 'CAND_A'],
    'the next generation keeps at most half of the active library by actual adoption, leaving discovery slots');
});

test('cross-generation candidate-id collisions use an identifier-safe digest suffix', () => {
  const code = `import importlib.util,sys\nspec=importlib.util.spec_from_file_location('s',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)\nprint(m.collision_safe_candidate_id('CAND_ROUTE_0001','sha256:ce8b-123',{'CAND_ROUTE_0001'}))`;
  const ran = spawnSync('/usr/bin/python3', ['-c', code, path.join(packDir, 'flow/stages.py')], { encoding: 'utf8' });
  assert.equal(ran.status, 0, ran.stderr);
  assert.equal(ran.stdout.trim(), 'CAND_ROUTE_0001_SHA256_CE8B_');
  assert.match(ran.stdout.trim(), /^[A-Za-z_][A-Za-z0-9_$]*$/);
});

test('one failed abstract Cell is retained as a refusal while successful Cells remain admitted', async (t) => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'hima-layout-admission-'));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const flow = path.join(workspace, 'flow');
  await mkdir(path.join(flow, 'records'), { recursive: true });
  await cp(path.join(packDir, 'flow/domain'), path.join(flow, 'domain'), { recursive: true });
  const candidate = (id: string) => ({ candidate_id: id,
    generator_contract: { interface: { inputs: [], outputs: [{ name: 'Z', liberty_function: '1' }] } } });
  const filtered = spawnSync('/usr/bin/python3', ['-c',
    'import json,sys;sys.path.insert(0,sys.argv[1]);from stages import admitted_patterns;d=json.load(sys.stdin);print(json.dumps(admitted_patterns(d,{"XS_A_Z"}),sort_keys=True))',
    path.join(packDir, 'flow')], { input: JSON.stringify({ generation_requests: [candidate('CAND_A'), candidate('CAND_B')] }), encoding: 'utf8' });
  assert.equal(filtered.status, 0, filtered.stderr);
  const admitted = JSON.parse(filtered.stdout);
  assert.deepEqual(admitted.generation_requests.map((row: any) => row.candidate_id), ['CAND_A']);
  assert.deepEqual(admitted.candidate_set_accounting,
    { layout_admitted_candidate_count: 1, layout_refused_candidate_count: 1 });
  const attempts = [
    { cell_name: 'XS_A_Z', exit_code: 0, admitted: true, diagnostic: null },
    { cell_name: 'XS_B_Z', exit_code: 124, admitted: false, diagnostic: 'tool exited 124' },
  ];
  const attemptsPath = path.join(flow, 'layout-attempts.json');
  const lef = path.join(flow, 'XS_A_Z.lef'); const meta = path.join(flow, 'XS_A_Z.abstract.json');
  await Promise.all([writeFile(attemptsPath, JSON.stringify(attempts)),
    writeFile(lef, 'VERSION 5.7 ;\nMACRO XS_A_Z\nEND XS_A_Z\nEND LIBRARY\n'),
    writeFile(meta, '{"cell":"XS_A_Z"}\n')]);
  await writeCustomSyntheticRecord(workspace, 'layout', [
    { role: 'layout_attempts', path: attemptsPath },
    { role: 'abstract_lef:XS_A_Z', path: lef },
    { role: 'abstract_metadata:XS_A_Z', path: meta },
  ], { layout_attempt_count: 2, abstract_cell_count: 1, layout_refused_count: 1,
    layout_refusals: [attempts[1]] });
  const report = path.join(flow, 'records/layout.json');
  const layoutRecord = JSON.parse(await readFile(report, 'utf8'));
  layoutRecord.executions = [{ exitCode: 0 }, { exitCode: 124 }];
  await writeFile(report, JSON.stringify(layoutRecord, null, 2) + '\n');
  const out = path.join(workspace, 'layout-reading.json');
  const read = spawnSync('/usr/bin/python3', [path.join(packDir, 'flow/read-stage.py'), report, out, 'layout'], { encoding: 'utf8' });
  assert.equal(read.status, 0, read.stderr);
  assert.deepEqual(JSON.parse(await readFile(out, 'utf8')).values, [
    { type: 'abstract_cell_count', unit: 'count', value: 1 },
    { type: 'layout_refused_count', unit: 'count', value: 1 },
  ]);
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
  await writeFile(report, 'Begin Summary\n    Found no problems or warnings.\nEnd Summary\n');
  for (const [module, functionName] of [['flow/stages.py', 'parse_connectivity'], ['flow/read-stage.py', 'connectivity_count']] as const) {
    const read = spawnSync('/usr/bin/python3', ['-c', `import importlib.util,pathlib,sys;spec=importlib.util.spec_from_file_location('checked',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);print(getattr(m,sys.argv[2])(pathlib.Path(sys.argv[3])))`,
      path.join(packDir, module), functionName, report], { encoding: 'utf8' });
    assert.equal(read.status, 0, `${module}: ${read.stderr}`); assert.equal(read.stdout.trim(), '0');
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
  const foundryLib = path.join(designRoot, 'foundry.lib'), foundryDb = path.join(designRoot, 'foundry.db');
  const physical = path.join(designRoot, 'physical.json'), tools = path.join(designRoot, 'tools.json');
  await writeFile(rtl, 'module held_out(input clk); endmodule\n'); await writeFile(constraints, 'create_clock -name clk -period 1 [get_ports clk]\n');
  await writeFile(foundryLib, 'library (fixture) {}\n'); await writeFile(foundryDb, 'fixture compiled db\n');
  const profile = path.join(designRoot, 'profile'); const helper = path.join(profile, 'helpers');
  await mkdir(helper, { recursive: true });
  await Promise.all(['estimate_lib.py', 'mock_char.py'].map((name) => writeFile(path.join(helper, name), `# fixture ${name}\n`)));
  const profileFiles = ['foundry.lib', 'foundry.spi', 'foundry.lef', 'qrc', 'foundry.gds', 'tech.lef', 'pdk.json',
    'skeleton.lib', 'tech.py', 'rules.json', 'timing.json', 'power.json', 'area.json', 'map'];
  await Promise.all(profileFiles.map((name) => writeFile(path.join(profile, name), `fixture ${name}\n`)));
  const proxyToolSha256 = sha256(await readFile('/usr/bin/true'));
  const physicalProfile = {
    CLOCK_NAME: 'clk', FOUNDRY_LIB: foundryLib, FOUNDRY_CDL: path.join(profile, 'foundry.spi'),
    FOUNDRY_DB_FILE: foundryDb,
    FOUNDRY_LEF: path.join(profile, 'foundry.lef'),
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
    CCFMAX_CLOCK_BUFFER_CELLS: 'DCCKBD4FIXTURE', CCFMAX_CLOCK_INVERTER_CELLS: 'DCCKND4FIXTURE',
    CCFMAX_FILLER_CELLS: 'FILL', CCFMAX_SWITCHING_ACTIVITY: 0.2, PLACE_SITE: 'core',
    CCFMAX_DCAP_CELL: 'DCAP', CCFMAX_DCAP_ROW_STRIDE: 4,
    CCFMAX_DCAP_X_PITCH_UM: 14, CCFMAX_DCAP_EDGE_MARGIN_UM: 2.8,
    CCFMAX_MAX_EFFECTIVE_DENSITY: 0.85,
    CCFMAX_PG_HORIZONTAL_LAYER: 'M7', CCFMAX_PG_VERTICAL_LAYER: 'M6',
    CCFMAX_PG_RING_WIDTH_UM: 0.4, CCFMAX_PG_RING_SPACING_UM: 0.4,
    CCFMAX_PG_STRIPE_WIDTH_UM: 0.2, CCFMAX_PG_STRIPE_SPACING_UM: 0.2,
    CCFMAX_PG_STRIPE_SET_DISTANCE_UM: 20, CCFMAX_PG_STRIPE_START_OFFSET_UM: 4,
    MAX_NEW_CELLS: 50, MAX_CELLS: 400, MAX_ROUTE_CANDIDATES: 40,
    GENERATION_TIMEOUT_SEC: 30, ABSTRACT_TIMEOUT_SEC: 30, CHARACTERIZE_TIMEOUT_SEC: 30, LC_TIMEOUT_SEC: 30, MULTI_CPU: 1,
    PNR_TIMEOUT_SEC: 30, DRC_LIMIT: 1000, VERIFY_TIMEOUT_SEC: 30,
  };
  const toolProfile = {
    EDA_WRAPPER: '/usr/bin/true', SYNTH_TIMEOUT_SEC: 30,
    LFR_YOSYS_BIN: '/usr/bin/true', LFR_ABC_BIN: '/usr/bin/true',
    LFR_YOSYS_SHA256: proxyToolSha256, LFR_ABC_SHA256: proxyToolSha256,
    LFR_YOSYS_COMMIT: 'fixture-yosys', LFR_ABC_COMMIT: 'fixture-abc',
    LFR_YOSYS_BUILD_FLAGS: ['--fixture'], LFR_ABC_BUILD_FLAGS: ['--fixture'],
    LFR_PROXY_CONTAINER_DIGEST: `sha256:${'1'.repeat(64)}`,
    LFR_PROXY_TIMEOUT_SEC: 30, LFR_PROXY_CPU_COUNT: 1, LFR_PROXY_MEMORY_MB: 512,
  };
  const rejectedPhysical = { ...physicalProfile }; delete (rejectedPhysical as Record<string, unknown>).CCFMAX_TAP_INTERVAL;
  await writeFile(physical, JSON.stringify(rejectedPhysical)); await writeFile(tools, JSON.stringify(toolProfile));
  const rejectedWorkspace = path.join(h.workspace, 'rejected-bind'); await mkdir(path.join(rejectedWorkspace, 'flow'), { recursive: true });
  const rejected = spawnSync('/usr/bin/python3', [path.join(packDir, 'flow/bind-inputs.py'), '--workspace', rejectedWorkspace,
    '--design-root', designRoot, '--rtl-glob', rtl, '--design-top', 'held_out', '--constraints', constraints,
    '--foundry-library', foundryLib, '--physical-inputs', physical, '--tool-stack', tools], { encoding: 'utf8' });
  assert.notEqual(rejected.status, 0); assert.match(rejected.stderr, /CCFMAX_TAP_INTERVAL/);
  const ordinaryClockProfile = { ...physicalProfile, CCFMAX_CLOCK_BUFFER_CELLS: 'BUFFD8FIXTURE' };
  await writeFile(physical, JSON.stringify(ordinaryClockProfile));
  const rejectedClock = spawnSync('/usr/bin/python3', [path.join(packDir, 'flow/bind-inputs.py'), '--workspace', rejectedWorkspace,
    '--design-root', designRoot, '--rtl-glob', rtl, '--design-top', 'held_out', '--constraints', constraints,
    '--foundry-library', foundryLib, '--physical-inputs', physical, '--tool-stack', tools], { encoding: 'utf8' });
  assert.notEqual(rejectedClock.status, 0); assert.match(rejectedClock.stderr, /CCFMAX_CLOCK_BUFFER_CELLS.*DCCK-prefixed/);
  await writeFile(physical, JSON.stringify({ ...physicalProfile, MAX_CELLS: 160 }));
  const rejectedCumulativeCapacity = spawnSync('/usr/bin/python3', [path.join(packDir, 'flow/bind-inputs.py'), '--workspace', rejectedWorkspace,
    '--design-root', designRoot, '--rtl-glob', rtl, '--design-top', 'held_out', '--constraints', constraints,
    '--foundry-library', foundryLib, '--physical-inputs', physical, '--tool-stack', tools], { encoding: 'utf8' });
  assert.notEqual(rejectedCumulativeCapacity.status, 0);
  assert.match(rejectedCumulativeCapacity.stderr, /MAX_CELLS.*at least 400.*8-generation/);
  await writeFile(physical, JSON.stringify(physicalProfile));
  await writeFile(tools, JSON.stringify({ ...toolProfile, LFR_ABC_SHA256: '0'.repeat(64) }));
  const rejectedProxyIdentity = spawnSync('/usr/bin/python3', [path.join(packDir, 'flow/bind-inputs.py'), '--workspace', rejectedWorkspace,
    '--design-root', designRoot, '--rtl-glob', rtl, '--design-top', 'held_out', '--constraints', constraints,
    '--foundry-library', foundryLib, '--physical-inputs', physical, '--tool-stack', tools], { encoding: 'utf8' });
  assert.notEqual(rejectedProxyIdentity.status, 0); assert.match(rejectedProxyIdentity.stderr, /LFR_ABC_SHA256 does not match/);
  await writeFile(tools, JSON.stringify(toolProfile));
  await writeFile(physical, JSON.stringify({ ...physicalProfile, FOUNDRY_DB: foundryDb }));
  const rejectedAmbiguousDb = spawnSync('/usr/bin/python3', [path.join(packDir, 'flow/bind-inputs.py'), '--workspace', rejectedWorkspace,
    '--design-root', designRoot, '--rtl-glob', rtl, '--design-top', 'held_out', '--constraints', constraints,
    '--foundry-library', foundryLib, '--physical-inputs', physical, '--tool-stack', tools], { encoding: 'utf8' });
  assert.notEqual(rejectedAmbiguousDb.status, 0); assert.match(rejectedAmbiguousDb.stderr, /redefine Campaign identity: FOUNDRY_DB/);
  const legacyPhysicalProfile = { ...physicalProfile }; delete (legacyPhysicalProfile as Record<string, unknown>).FOUNDRY_DB_FILE;
  await writeFile(physical, JSON.stringify(legacyPhysicalProfile));
  const legacyWorkspace = path.join(h.workspace, 'legacy-single-library-bind');
  await mkdir(path.join(legacyWorkspace, 'flow'), { recursive: true });
  const legacy = spawnSync('/usr/bin/python3', [path.join(packDir, 'flow/bind-inputs.py'), '--workspace', legacyWorkspace,
    '--design-root', designRoot, '--rtl-glob', rtl, '--design-top', 'held_out', '--constraints', constraints,
    '--foundry-library', foundryDb, '--physical-inputs', physical, '--tool-stack', tools], { encoding: 'utf8' });
  assert.equal(legacy.status, 0, legacy.stderr);
  const legacyMaterialized = JSON.parse(await readFile(path.join(legacyWorkspace, 'flow/inputs.json'), 'utf8')) as Record<string, unknown>;
  assert.equal(legacyMaterialized.FOUNDRY_DB, await realpath(foundryDb));
  await writeFile(physical, JSON.stringify(physicalProfile));
  const destination = path.join(h.home, 'hima/packs/custom-cell-fmax-dtco');
  installPackMethod({ from: packDir, to: destination });
  await writeLocalSite(h, { bindings: { designRoot, rtlGlob: rtl, designTop: 'held_out', constraints, foundryLibrary: foundryLib,
    physicalInputs: physical, toolStack: tools, workspaceRoot: h.workspace }, allowedReadRoots: [h.home, h.workspace],
    allowedWriteRoots: [h.workspace], allowedWrappers: ['/usr/bin/python3'], licences: { 'Design-Compiler': 1, 'Library-Compiler': 1, Innovus: 1 } });
  const host = await bootInProcess(h);
  try {
    const owner = await createRootAgent(host.ctx, h.workspace);
    const started = await host.ctx.hima.startRun({ pack: 'custom-cell-fmax-dtco', site: 'local',
      goal: { target_period_ns: 1, target_fmax_improvement_pct: 5 },
      strategy: { periodNs: 1, floorplanUtilization: 0.5, algorithmRevision: 0 }, ownerSessionId: String(owner.id), generationLimit: 1 });
    assert.equal(started.kind, 'ran', JSON.stringify(started)); if (started.kind !== 'ran') return;
    assert.equal(started.run.budget?.timeBoxMs, 43_200_000,
      'the bounded eight-generation method owns its reviewed twelve-hour box');
    assert.equal(started.run.currentNode, 'bind-inputs');
    const begin = await host.ctx.hima.executionAction({ runId: started.run.id, actor: String(owner.id), expectedEpoch: 1, expectedRevision: 0,
      requestId: 'bind-begin', action: 'begin', nodeId: 'bind-inputs' });
    const executionId = begin.receipt?.executionId; assert.ok(executionId);
    const work = await host.ctx.hima.executionAction({ runId: started.run.id, actor: String(owner.id), expectedEpoch: 1, expectedRevision: 1,
      requestId: 'bind-work', action: 'work', executionId });
    assert.equal(work.kind, 'accepted', work.reason);
    await waitUntil('the Pack input adapter finishes', () => host.ctx.hima.executionContext(started.run.id).executions.some(item => item.id === executionId && item.phase === 'ready'));
    const materialized = JSON.parse(await readFile(path.join(started.workspace, 'flow/inputs.json'), 'utf8')) as Record<string, unknown>;
    const canonicalDesignRoot = await realpath(designRoot);
    assert.equal(materialized.designRoot, canonicalDesignRoot); assert.equal(materialized.DESIGN_ROOT, canonicalDesignRoot);
    assert.equal(materialized.designTop, 'held_out'); assert.equal(materialized.DESIGN_TOP, 'held_out');
    assert.equal(materialized.edaWrapper, '/usr/bin/true');
    assert.equal(materialized.FOUNDRY_LIB, await realpath(foundryLib));
    assert.equal(materialized.FOUNDRY_DB, await realpath(foundryDb));
    assert.equal(materialized.foundryDb, await realpath(foundryDb));
    assert.equal(materialized.MAX_NEW_CELLS, 50); assert.equal(materialized.MAX_CELLS, 400);
    assert.equal(materialized.MAX_ROUTE_CANDIDATES, 40);
    assert.equal(materialized.GENERATION_TIMEOUT_SEC, 3600);
    assert.equal(materialized.GENERATION_TIMEOUT_SEC_REQUESTED, 30);
    assert.equal(materialized.SYNTH_TIMEOUT_SEC, 7200);
    assert.equal(materialized.PNR_TIMEOUT_SEC, 14400);
    assert.equal(materialized.PNR_TIMEOUT_SEC_REQUESTED, 30);
    assert.equal(materialized.VERIFY_TIMEOUT_SEC, 7200);
    assert.equal(materialized.LFR_YOSYS_SHA256, proxyToolSha256);
    assert.equal(materialized.LFR_MAPPING_PROFILE, 'lfr-yosys-abc-deterministic/1');
    assert.equal(materialized.LFR_PROXY_STA_PROFILE, 'lfr-round-evaluation/3:proxy-sta');
    assert.equal(materialized.LFR_LOCAL_PORTFOLIO, path.join(started.workspace, 'flow/library-richness/local-portfolio.json'));
    assert.equal(materialized.LFR_CANDIDATE_POOL, path.join(started.workspace, 'flow/library-richness/candidate-pool.json'));
    assert.equal(materialized.LFR_CUMULATIVE_LIBRARY_MANIFEST, path.join(started.workspace, 'flow/library/cumulative-manifest.json'));
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
  const characterizedPatterns = path.join(flow, 'fixture-characterized-patterns.json');
  await writeFile(generatedLib, 'library (synthetic_generated) { cell (XS_FIX_ZN) { pin(A) { direction : input; } pin(Z) { direction : output; function : "A"; } } }\n');
  await writeFile(generatedLef, 'VERSION 5.7 ;\nMACRO XS_FIX_ZN\n  CLASS CORE ;\nEND XS_FIX_ZN\nEND LIBRARY\n');
  await writeFile(characterizedPatterns, JSON.stringify({ generation_requests: [{ candidate_id: 'CAND_FIX',
    generator_contract: { interface: { inputs: [{ name: 'A' }], outputs: [{ name: 'ZN', liberty_function: 'A' }] } },
    discovery_evidence: { strategy_ids: ['structure_frequency'], strategy_rankings: { structure_frequency:
      { candidate_id: 'CAND_FIX', local_rank: 1, search_objective: 'fixture' } } },
  }] }, null, 2) + '\n');
  await writeCustomSyntheticRecord(fixture.workspace, 'characterize', [
    { role: 'generated_liberty', path: generatedLib },
    { role: 'characterized_patterns', path: characterizedPatterns },
  ], { predicted_cell_count: 1 });
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
    assert.equal(synthesis.facts.route_uncertainty_ns, 0.135,
      `${arm} must emit 25% route uncertainty plus the fixed 50 ps APR pressure`);
  }
  const foundryPnr = JSON.parse(await readFile(path.join(fixture.workspace, 'flow/records/pnr-foundry.json'), 'utf8'));
  const generatedPnr = JSON.parse(await readFile(path.join(fixture.workspace, 'flow/records/pnr-generated.json'), 'utf8'));
  for (const record of [foundryPnr, generatedPnr]) {
    const script = record.artifacts.find((item: { role: string }) => item.role === `pnr_script:${record.facts.arm}`);
    const text = await readFile(path.join(fixture.workspace, script.path), 'utf8');
    assert.doesNotMatch(text, /setPlaceMode[^\n]*baseline placement/,
      'multi-line pin placeholders must not expand into a template comment');
  }
  assert.equal(foundryPnr.facts.floorplan_requested_utilization, 0.25);
  assert.equal(foundryPnr.facts.floorplan_utilization, 0.125);
  assert.equal(foundryPnr.facts.floorplan_area_expansion, 2);
  assert.deepEqual(generatedPnr.facts.floorplan_core_box, foundryPnr.facts.floorplan_core_box);
  assert.deepEqual(generatedPnr.facts.pin_plan_identity, foundryPnr.facts.pin_plan_identity);
  assert.equal(compare.facts.fmax_improved, true);
  assert.ok(compare.facts.fmax_improvement_pct > 0);
  assert.equal(compare.facts.comparison_valid, true);
  assert.ok(compare.facts.generated_fmax_mhz > compare.facts.foundry_fmax_mhz);
  assert.equal(compare.facts.full_constraint_failures, 0);
  const read = fixture.read(path.join(fixture.workspace, 'flow/records/compare.json'), 'compare');
  assert.equal(read.run.status, 0, read.run.stderr);
  assert.ok(JSON.parse(await readFile(read.out, 'utf8')).values.some((value: any) => value.type === 'fmax_improvement_pct' && value.value > 0));
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
