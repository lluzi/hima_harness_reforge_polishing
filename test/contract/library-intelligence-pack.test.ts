import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cp, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkPack, claimSlotAndLaunch, launchJob, loadPack, loadSite } from '@hima/harness';
import { repoRoot } from './support/dsh-home.ts';
import { createHimaHome } from './support/dsh-home.ts';
import { bootInProcess, createRootAgent } from './support/boot-inprocess.ts';
import { installPack } from './support/pack.ts';
import { writeLocalSite } from './support/site.ts';
import { waitUntil } from './support/fabric.ts';
import type { Channel, LaunchIntent } from '@hima/harness';

const { attestLibraryQualificationPrelaunch } = await import(
  new URL('../../packages/harness/lib/adapters/library-qualification.js', import.meta.url).href
) as { attestLibraryQualificationPrelaunch(request: {
  packId: string; site: ReturnType<typeof loadSite>; bindings: Readonly<Record<string, string>>;
  workspace: string; intent: LaunchIntent; channel: Channel;
}): Promise<void> };

const packDir = path.join(repoRoot, 'packs/library-intelligence');
const worker = path.join(packDir, 'tools/libapi_worker.py');
const reader = path.join(packDir, 'tools/read-qualification.py');
const analysisWorker = path.join(packDir, 'tools/library-analysis.py');
const stageWorker = path.join(packDir, 'tools/library-stages.py');
const stageReader = path.join(packDir, 'tools/read-library-stage.py');
const sha = (bytes: string | Buffer): string => createHash('sha256').update(bytes).digest('hex');
const refreshIdentity = (value: Record<string, any>, field: 'recordSha256' | 'proposalSha256') => {
  const content = structuredClone(value); delete content[field];
  const calculated = spawnSync('python3', ['-c', 'import hashlib,json,sys; value=json.load(sys.stdin); print(hashlib.sha256(json.dumps(value,sort_keys=True,separators=(",", ":")).encode()).hexdigest())'],
    { input: JSON.stringify(content), encoding: 'utf8' });
  assert.equal(calculated.status, 0, calculated.stderr);
  value[field] = calculated.stdout.trim(); return value;
};
const wrapperBytes = Buffer.from('#!/bin/sh\nexec "$@"\n');
let analysisInvocation = 0;

function runLibraryAnalysis(mode: 'facts' | 'delta' | 'proposal', input: unknown, workspace?: string) {
  const root = workspace ?? path.join(os.tmpdir(), `hima-library-analysis-${process.pid}`);
  const invocation = analysisInvocation++;
  const inputPath = path.join(root, `${mode}-${invocation}-input.json`);
  const outputPath = path.join(root, `${mode}-${invocation}-output.json`);
  writeFileSync(inputPath, JSON.stringify(input));
  const run = spawnSync('python3', [analysisWorker, mode, inputPath, outputPath], { encoding: 'utf8' });
  return { ...run, outputPath };
}

test('E2 facts preserve typed Library/PVT/cell/pin/arc/table provenance and reject incomparable or unknown-as-zero deltas', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'hima-library-e2-')));
  try {
    const source = path.join(root, 'baseline.lib');
    await writeFile(source, 'synthetic baseline\n');
    const request = {
      schema: 'hima-library-facts-request/1',
      source: { path: source, sha256: sha(await readFile(source)), bytes: 19, role: 'baseline', family: 'core', corner: 'ss_0p72v_125c', view: 'nldm' },
      producer: { apiBuild: 'synthetic', python: '/usr/bin/python3', adapterSha256: 'a'.repeat(64) },
      library: { name: 'core_ss', units: { time: 'ns', capacitance: 'pf', voltage: 'V', area: 'um2' }, pvt: { process: 'ss', voltage: 0.72, temperature: 125, voltageUnit: 'V', temperatureUnit: 'C' } },
      cells: [{ id: 'AN2_X1', name: 'AN2_X1', area: { value: 1.2, unit: 'um2' }, pins: [{ name: 'A', direction: 'input' }, { name: 'Z', direction: 'output' }], arcs: [{ id: 'AN2_X1:A>Z:combinational', relatedPin: 'A', outputPin: 'Z', type: 'combinational', sense: 'positive_unate', when: null, sourceLocator: { line: 12 }, tables: [{ id: 'cell_rise', model: 'nldm', axes: [{ variable: 'input_net_transition', unit: 'ns', indexes: [0.01, 0.1] }], shape: [2], values: [0.02, 0.04], unit: 'ns' }] }] }],
      coverage: { declaredCells: 1, observedCells: 1, complete: true }, unknowns: [],
    };
    const facts = runLibraryAnalysis('facts', request, root);
    assert.equal(facts.status, 0, facts.stderr);
    const record = JSON.parse(await readFile(facts.outputPath, 'utf8'));
    assert.equal(record.schema, 'hima-library-facts/1');
    assert.equal(record.cells[0].arcs[0].tables[0].axes[0].unit, 'ns');
    assert.equal(record.cells[0].provenance.derivationLevel, 'explicit');
    assert.equal(record.cells[0].arcs[0].tables[0].provenance.sourceDomain, 'Liberty');
    assert.equal(record.coverage.complete, true);

    const candidate = structuredClone(record);
    candidate.source.role = 'candidate';
    candidate.source.sha256 = 'b'.repeat(64);
    candidate.cells[0].area.value = 1.1;
    delete candidate.recordSha256;
    const delta = runLibraryAnalysis('delta', { schema: 'hima-library-delta-request/1', baseline: record, candidate }, root);
    assert.equal(delta.status, 0, delta.stderr);
    const comparison = JSON.parse(await readFile(delta.outputPath, 'utf8'));
    assert.equal(comparison.schema, 'hima-library-delta/1');
    assert.equal(comparison.conditions.corner, 'ss_0p72v_125c');
    assert.ok(Math.abs(comparison.cellDeltas[0].area.delta + 0.1) < 1e-12);

    candidate.source.corner = 'ff_0p88v_0c';
    const incomparable = runLibraryAnalysis('delta', { schema: 'hima-library-delta-request/1', baseline: record, candidate }, root);
    assert.notEqual(incomparable.status, 0);
    assert.match(incomparable.stderr, /comparable family, corner, and view/i);

    candidate.source.corner = record.source.corner;
    candidate.cells[0].area = { unknown: { reason: 'source omits area' } };
    const unknown = runLibraryAnalysis('delta', { schema: 'hima-library-delta-request/1', baseline: record, candidate }, root);
    assert.equal(unknown.status, 0, unknown.stderr);
    assert.equal(JSON.parse(await readFile(unknown.outputPath, 'utf8')).cellDeltas[0].area, null);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('E4 proposal is versioned, hash-bound, budgeted and private-workspace only', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'hima-library-e4-')));
  try {
    const rule = path.join(root, 'customer-rule.py');
    await writeFile(rule, '# frozen customer rule\n');
    const request = {
      schema: 'hima-library-rule-proposal-request/1',
      rule: { id: 'slew-envelope', version: '1.0.0', path: rule, sha256: sha(await readFile(rule)), inputSchema: 'hima-library-facts/1', outputSchema: 'hima-library-rule-result/1' },
      inputs: [{ ref: 'facts:baseline', schema: 'hima-library-facts/1', sha256: 'c'.repeat(64) }],
      policy: { applicability: { family: 'core', corner: 'ss_0p72v_125c', view: 'nldm' }, budget: { maxInputs: 2, maxOutputBytes: 4096 }, permit: { workspaceRoot: root, writeRoot: root } },
      result: { ref: 'analysis:slew-envelope', schema: 'hima-library-rule-result/1', sha256: 'd'.repeat(64), bytes: 128, unknowns: ['design evidence unavailable'] },
      independentValidation: { required: true, recommendation: 'Re-run against an independently loaded facts record before any Library or release decision.' },
    };
    const proposal = runLibraryAnalysis('proposal', request, root);
    assert.equal(proposal.status, 0, proposal.stderr);
    const value = JSON.parse(await readFile(proposal.outputPath, 'utf8'));
    assert.equal(value.schema, 'hima-library-analysis-proposal/1');
    assert.equal(value.rule.version, '1.0.0');
    assert.equal(value.writeBoundary, 'private-workspace-only');
    assert.equal(value.independentValidation.required, true);
    assert.deepEqual(value.mutations, []);

    const outside = runLibraryAnalysis('proposal', { ...request, policy: { ...request.policy, permit: { ...request.policy.permit, writeRoot: path.dirname(root) } } }, root);
    assert.notEqual(outside.status, 0);
    assert.match(outside.stderr, /write root must equal private workspace root/i);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('E1 receipt drives the Pack-local E2 to E4 graph artifacts with an explicit same-source zero delta', async () => {
  const f = await fixture();
  try {
    assert.equal(f.run().status, 0);
    const receipt = path.join(f.workspace, 'flow/qualification/receipt.json');
    const library = path.join(f.workspace, 'flow/library');
    const baseline = path.join(library, 'baseline-facts.json');
    const candidate = path.join(library, 'candidate-facts.json');
    const delta = path.join(library, 'delta.json');
    const report = path.join(library, 'insight-report.json');
    const result = path.join(library, 'rule-result.json');
    const proposal = path.join(library, 'proposal.json');
    for (const args of [
      ['facts', receipt, f.analysisManifest, 'baseline', baseline], ['facts', receipt, f.analysisManifest, 'candidate', candidate],
      ['delta', baseline, candidate, delta], ['report', delta, report], ['result', report, result], ['proposal', report, result, stageWorker, proposal],
    ]) {
      const run = spawnSync('python3', [stageWorker, ...args], { encoding: 'utf8' });
      assert.equal(run.status, 0, run.stderr);
    }
    const facts = JSON.parse(await readFile(baseline, 'utf8'));
    const comparison = JSON.parse(await readFile(delta, 'utf8'));
    const method = JSON.parse(await readFile(proposal, 'utf8'));
    assert.equal(facts.schema, 'hima-library-facts/1');
    assert.equal(facts.source.role, 'tsmc28');
    assert.equal(facts.coverage.scope, 'representative-query-only');
    assert.equal(facts.analysisRef.path, f.analysisManifest);
    assert.ok(facts.unknowns.length > 0, 'representative E2 facts must preserve absent PVT/corpus fields as unknown');
    assert.deepEqual(facts.cells[0].arcs[0].tables[0].shape, [7, 7]);
    assert.equal(facts.cells[0].arcs[0].tables[0].axes.length, 2);
    assert.equal(facts.cells[0].arcs[0].tables[0].values.length, 49);
    assert.equal(comparison.comparisonKind, 'same-qualified-source-zero-delta');
    assert.equal(comparison.cellDeltas[0].area.delta, 0);
    assert.equal(method.writeAuthorization, 'none');
    assert.equal(method.independentValidation.required, true);
    assert.equal(method.rule.algorithmSha256, sha(await readFile(stageWorker)), 'proposal names the executed rule-result producer bytes');
    for (const [artifact, expectedType] of [[baseline, 'library_facts_complete'], [delta, 'library_delta_complete'], [report, 'library_insight_report_available'], [result, 'library_rule_result_available'], [proposal, 'library_proposal_available']] as const) {
      const output = path.join(f.root, `${expectedType}.json`);
      const run = spawnSync('python3', [stageReader, artifact, output], { encoding: 'utf8' });
      assert.equal(run.status, 0, run.stderr);
      assert.equal(JSON.parse(await readFile(output, 'utf8')).values[0].type, expectedType);
    }
    const tampered = JSON.parse(await readFile(proposal, 'utf8'));
    tampered.writeAuthorization = 'golden-library-write';
    const tamperedProposal = path.join(library, 'tampered-proposal.json');
    await writeFile(tamperedProposal, JSON.stringify(tampered));
    const refused = spawnSync('python3', [stageReader, tamperedProposal, path.join(f.root, 'refused.json')], { encoding: 'utf8' });
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /identity differs|write boundary/i);

    const forgedFacts = JSON.parse(await readFile(baseline, 'utf8'));
    forgedFacts.library.pvt = { process: 'tt', voltage: 0, temperature: 0 };
    forgedFacts.unknowns = [];
    refreshIdentity(forgedFacts, 'recordSha256');
    const forgedFactsPath = path.join(library, 'forged-facts.json');
    await writeFile(forgedFactsPath, JSON.stringify(forgedFacts));
    const refusedFacts = spawnSync('python3', [stageReader, forgedFactsPath, path.join(f.root, 'refused-facts.json')], { encoding: 'utf8' });
    assert.notEqual(refusedFacts.status, 0);
    assert.match(refusedFacts.stderr, /PVT|unavailable fields/i, 'a self-consistent hash cannot turn unknown PVT into numeric zero');

    const forgedTable = JSON.parse(await readFile(baseline, 'utf8'));
    forgedTable.cells[0].arcs[0].tables[0].axes = [];
    refreshIdentity(forgedTable, 'recordSha256');
    const forgedTablePath = path.join(library, 'forged-table.json');
    await writeFile(forgedTablePath, JSON.stringify(forgedTable));
    const refusedTable = spawnSync('python3', [stageReader, forgedTablePath, path.join(f.root, 'refused-table.json')], { encoding: 'utf8' });
    assert.notEqual(refusedTable.status, 0);
    assert.match(refusedTable.stderr, /axes\/shape differ/i);

    const forgedDelta = JSON.parse(await readFile(delta, 'utf8'));
    forgedDelta.conditions.corner = 'forged-corner';
    refreshIdentity(forgedDelta, 'recordSha256');
    const forgedDeltaPath = path.join(library, 'forged-delta.json');
    await writeFile(forgedDeltaPath, JSON.stringify(forgedDelta));
    const refusedDelta = spawnSync('python3', [stageReader, forgedDeltaPath, path.join(f.root, 'refused-delta.json')], { encoding: 'utf8' });
    assert.notEqual(refusedDelta.status, 0);
    assert.match(refusedDelta.stderr, /conditions are not comparable/i);

    const forgedReport = JSON.parse(await readFile(report, 'utf8'));
    forgedReport.findings[0].provenance[0].sha256 = '0'.repeat(64);
    const forgedReportPath = path.join(library, 'forged-report.json');
    await writeFile(forgedReportPath, JSON.stringify(forgedReport));
    const refusedReport = spawnSync('python3', [stageReader, forgedReportPath, path.join(f.root, 'refused-report.json')], { encoding: 'utf8' });
    assert.notEqual(refusedReport.status, 0);
    assert.match(refusedReport.stderr, /exact delta/i);

    const forgedResult = JSON.parse(await readFile(result, 'utf8'));
    forgedResult.inputRefs[0].sha256 = '0'.repeat(64);
    refreshIdentity(forgedResult, 'recordSha256');
    const forgedResultPath = path.join(library, 'forged-result.json');
    await writeFile(forgedResultPath, JSON.stringify(forgedResult));
    const refusedResult = spawnSync('python3', [stageReader, forgedResultPath, path.join(f.root, 'refused-result.json')], { encoding: 'utf8' });
    assert.notEqual(refusedResult.status, 0);
    assert.match(refusedResult.stderr, /input reference differs/i);

    const forgedAlgorithm = JSON.parse(await readFile(proposal, 'utf8'));
    forgedAlgorithm.rule.algorithmPath = analysisWorker;
    forgedAlgorithm.rule.algorithmSha256 = sha(await readFile(analysisWorker));
    refreshIdentity(forgedAlgorithm, 'proposalSha256');
    const forgedAlgorithmPath = path.join(library, 'forged-algorithm.json');
    await writeFile(forgedAlgorithmPath, JSON.stringify(forgedAlgorithm));
    const refusedAlgorithm = spawnSync('python3', [stageReader, forgedAlgorithmPath, path.join(f.root, 'refused-algorithm.json')], { encoding: 'utf8' });
    assert.notEqual(refusedAlgorithm.status, 0);
    assert.match(refusedAlgorithm.stderr, /algorithm identity differs/i, 'a proposal cannot attribute a result to unexecuted candidate bytes');
  } finally { await f.dispose(); }
});

const stub = `
import os, signal, shutil
class Array(list):
    def size(self): return len(self)
class Values(Array): pass
class Template:
    def isNull(self): return False
    def getVariableStr(self, dim): return ["input_net_transition", "total_output_net_capacitance"][dim]
class Table:
    def isCcsModel(self): return False
    def isVectorModel(self): return False
    def getValues(self): return Values([0.125] * 49)
    def getTypeStr(self): return "cell_rise"
    def getDimension(self): return 2
    def getDimSize(self, _): return 7
    def getIndexData(self, dim): return Values(([0.01, 0.02, 0.04, 0.08, 0.16, 0.32, 0.64] if dim == 0 else [0.001, 0.002, 0.004, 0.008, 0.016, 0.032, 0.064]))
    def getTemplate(self): return Template()
class Arc:
    def getDataGroups(self): return Array([Table()])
    def getRelatedPinName(self): return "A"
    def getTimingTypeStr(self): return "combinational"
class Pin:
    def isPgPin(self): return False
    def getTimingGroups(self, _): return Array([Arc()])
    def name(self): return "Z"
    def getDirectionStr(self): return "output"
class Cell:
    def getAllLibertyPins(self): return Array([Pin()])
    def name(self): return "AN2"
    def getArea(self): return 1.25
class Lib:
    def __init__(self, source): self.source = source
    def isNull(self): return False
    def name(self):
        if "CRASH" in open(self.source).read():
            os.kill(os.getpid(), signal.SIGSEGV)
        return "synthetic"
    def getTimeUnit(self): return 1e-9
    def getCapUnit(self): return 1e-12
    def getVoltageUnit(self): return 1.0
    def getLibertyCells(self): return Array([Cell()])
    def outputLib(self, copy):
        shutil.copyfile(self.source, copy)
        if "MUTATE" in open(self.source).read():
            open(self.source, "a").write("changed after copy\\n")
        return True
def readTmlib(source, log):
    open(log, "w").write("stub parser only\\n")
    return Lib(source)
def releaseTmlib(_): pass
`;

interface Fixture {
  root: string;
  workspace: string;
  manifest: string;
  analysisManifest: string;
  permit: string;
  python: string;
  sources: string[];
  run(): { status: number | null; stderr: string };
  receipt(): Promise<any>;
  read(): { status: number | null; stderr: string; output: string };
  dispose(): Promise<void>;
}

async function fixture(additionalRoot?: string): Promise<Fixture> {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'hima-library-e1-')));
  const workspace = path.join(root, 'workspace');
  const flow = path.join(workspace, 'flow');
  const api = path.join(root, 'api');
  const site = path.join(root, 'sites');
  await Promise.all([mkdir(path.join(flow, 'tools'), { recursive: true }),
    mkdir(path.join(api, 'lib'), { recursive: true }), mkdir(site)]);
  await cp(worker, path.join(flow, 'tools/libapi_worker.py'));
  await cp(reader, path.join(flow, 'tools/read-qualification.py'));
  await writeFile(path.join(api, 'tmlib.py'), stub);
  await writeFile(path.join(api, '_tmlib.so'), 'synthetic native marker only\n');
  await writeFile(path.join(api, 'lib/libparser_wrapper.so'), 'synthetic parser marker only\n');
  const py = spawnSync('python3', ['-c', 'import sys; print(sys.executable); print("%d.%d" % sys.version_info[:2])'], { encoding: 'utf8' });
  assert.equal(py.status, 0, py.stderr);
  const [python, pythonVersion] = py.stdout.trim().split('\n');
  assert.ok(python && pythonVersion);
  const sources = await Promise.all(['vendor-fixture', 'saed14', 'tsmc28'].map(async (role) => {
    const target = path.join(root, role + '.lib');
    await writeFile(target, 'SYNTHETIC LIBERTY ' + role + '\n');
    return target;
  }));
  const analysisManifest = path.join(root, 'analysis.json');
  const selected = { qualificationRole: 'tsmc28', expectedSourceSha256: sha(await readFile(sources[2]!)),
    family: 'synthetic-tsmc28', corner: 'tt0p9v25c', view: 'NLDM' };
  await writeFile(analysisManifest, JSON.stringify({ schema: 'hima-library-analysis-input/1',
    comparisonKind: 'same-qualified-source-control', baseline: selected, candidate: selected }));
  const permit = path.join(site, 'local.permit.yml');
  const permitText = [
    'allowedReadRoots:', `  - ${root}`, `  - ${path.dirname(await realpath(python))}`, '  - /usr/local/bin', '  - /bin',
    ...(additionalRoot ? [`  - ${additionalRoot}`] : []),
    'allowedWriteRoots:', `  - ${root}`,
    ...(additionalRoot ? [`  - ${additionalRoot}`] : []),
    'allowedWrappers:', '  - /usr/local/bin/edarun', '  - /usr/bin/python3',
    'forbidden:', '  - deletions', '',
  ].join('\n');
  await writeFile(permit, permitText);
  const manifest = path.join(root, 'qualification.json');
  const manifestValue = {
    schema: 'hima-library-qualification-input/1',
    runtime: { wrapper: '/usr/local/bin/edarun', wrapperRealpath: '/usr/local/bin/edarun',
      wrapperSha256: sha(wrapperBytes), python,
      pythonSha256: sha(await readFile(python)), pythonVersion,
      apiRoot: api, apiBuild: 'synthetic-test-only',
      apiMarker: 'tmlib.py', apiMarkerSha256: sha(stub),
      nativeModule: '_tmlib.so', nativeModuleSha256: sha('synthetic native marker only\n'),
      parserLibrarySha256: sha('synthetic parser marker only\n'),
      adapterSha256: sha(await readFile(worker)) },
    permit: { path: permit, sha256: sha(permitText) },
    license: { product: 'QuaLib', release: '2026', selection: 'new', port: 59099,
      claim: 'QuaLib-2026-new-59099', excludesClaim: 'XTop' },
    sources: await Promise.all(sources.map(async (source, index) => ({
      role: ['vendor-fixture', 'saed14', 'tsmc28'][index],
      path: source, sha256: sha(await readFile(source)),
    }))),
  };
  await writeFile(manifest, JSON.stringify(manifestValue));
  await writeFile(path.join(site, 'local.yml'), [
    'name: local', 'kind: local', `workspaceRoot: ${workspace}`,
    'permit: ./local.permit.yml', 'bindings:',
    `  qualificationManifest: ${manifest}`,
    `  qualificationPython: ${python}`,
    `  analysisManifest: ${analysisManifest}`,
    `  workspaceRoot: ${workspace}`,
    'capacity: { cores: 2, memoryGiB: 2, parallelJobs: 1, licences: {} }', '',
  ].join('\n'));
  return {
    root, workspace, manifest, analysisManifest, permit, python, sources,
    run() {
      const value = JSON.parse(readFileSync(manifest, 'utf8'));
      writeFileSync(path.join(workspace, 'hima-library-host-attestation.json'), JSON.stringify({
        schema: 'hima-library-host-attestation/1', siteId: 'local', manifestPath: manifest,
        manifestSha256: sha(readFileSync(manifest)), permitPath: permit,
        permitSha256: value.permit.sha256, workspace,
        wrapper: '/usr/local/bin/edarun', wrapperRealpath: '/usr/local/bin/edarun',
        wrapperSha256: sha(wrapperBytes), license: value.license,
        licenseClaims: { 'QuaLib-2026-new-59099': 1 },
        launch: { runId: 'run-library-e1', nodeId: 'qualify-api', attempt: 1,
          jobSession: 'hima-library-e1' },
      }) + '\n');
      const run = spawnSync(python, [path.join(flow, 'tools/libapi_worker.py'), manifest, workspace], { encoding: 'utf8' });
      return { status: run.status, stderr: run.stderr };
    },
    async receipt() {
      return JSON.parse(await readFile(path.join(flow, 'qualification/receipt.json'), 'utf8'));
    },
    read() {
      const output = path.join(root, 'reading.json');
      const run = spawnSync(python, [path.join(flow, 'tools/read-qualification.py'),
        path.join(flow, 'qualification/receipt.json'), output], { encoding: 'utf8' });
      return { status: run.status, stderr: run.stderr, output };
    },
    async dispose() { await rm(root, { recursive: true, force: true }); },
  };
}

test('loaded Site retains the Permit byte identity despite a forged Pack claim or later file edit', async () => {
  const f = await fixture();
  try {
    const sitesDir = path.join(f.root, 'sites');
    const originalBytes = await readFile(f.permit);
    const original = loadSite(sitesDir, 'local');
    assert.equal(original.permitFile, f.permit);
    assert.equal(original.permitSha256, sha(originalBytes));

    const manifest = JSON.parse(await readFile(f.manifest, 'utf8'));
    manifest.permit.sha256 = '0'.repeat(64);
    await writeFile(f.manifest, JSON.stringify(manifest));
    assert.equal(loadSite(sitesDir, 'local').permitSha256, sha(originalBytes),
      'the Pack manifest cannot assert the Host Site Permit identity');

    const editedBytes = Buffer.concat([originalBytes, Buffer.from('# owner comment changes the bytes only\n')]);
    await writeFile(f.permit, editedBytes);
    const reloaded = loadSite(sitesDir, 'local');
    assert.deepEqual(reloaded.permitRules, original.permitRules, 'a comment leaves the parsed policy unchanged');
    assert.equal(original.permitSha256, sha(originalBytes), 'the loaded Site keeps its read-time identity');
    assert.equal(reloaded.permitSha256, sha(editedBytes), 'a fresh load binds the edited Permit bytes');
    assert.notEqual(reloaded.permitSha256, original.permitSha256);
  } finally { await f.dispose(); }
});

test('Host prelaunch attests Permit, nested roots, pinned edarun, exact QuaLib claim and one-Job XTop exclusion', async () => {
  const f = await fixture();
  try {
    const site = loadSite(path.join(f.root, 'sites'), 'local');
    const manifest = JSON.parse(await readFile(f.manifest, 'utf8'));
    await writeFile(f.manifest, JSON.stringify(manifest));
    const channel: Channel = {
      siteName: site.name,
      readFile: (target) => target === '/usr/local/bin/edarun' ? Promise.resolve(wrapperBytes) : readFile(target),
      realpath: (target) => target === '/usr/local/bin/edarun' ? Promise.resolve(target) : realpath(target),
      absent: async (target) => { try { await lstat(target); return false; } catch { return true; } },
      exec: async (argv, options) => {
        assert.deepEqual(argv.slice(0, 2), ['tee', '--']);
        assert.ok(options?.stdin);
        await writeFile(argv[2]!, options!.stdin!);
        return { code: 0, stdout: options!.stdin!, stderr: '' };
      },
    };
    const intent: LaunchIntent = {
      runId: 'run-library-e1', siteId: site.name, nodeId: 'qualify-api', attempt: 1,
      licences: { 'QuaLib-2026-new-59099': 1 },
      job: { session: 'hima-library-e1', workspace: f.workspace, name: 'qualify-api',
        startedAt: '2026-09-24T00:00:00.000Z', wire: 'bounded fixture only' },
    };
    const qualifiedSite = { ...site, permitFile: '/host-only/loaded-site-policy.yml', capacity: { ...site.capacity,
      licences: { 'QuaLib-2026-new-59099': 1 } } };
    const request = { packId: 'library-intelligence', site: qualifiedSite, bindings: site.bindings,
      workspace: f.workspace, intent, channel };

    await assert.doesNotReject(attestLibraryQualificationPrelaunch(request));
    const attestation = JSON.parse(await readFile(path.join(f.workspace, 'hima-library-host-attestation.json'), 'utf8'));
    assert.deepEqual(attestation.licenseClaims, { 'QuaLib-2026-new-59099': 1 });
    assert.equal(attestation.permitSha256, site.permitSha256);
    assert.equal(attestation.wrapperSha256, sha(wrapperBytes));
    assert.deepEqual(attestation.launch, { runId: intent.runId, nodeId: intent.nodeId,
      attempt: intent.attempt, jobSession: intent.job.session });

    await assert.rejects(attestLibraryQualificationPrelaunch({ ...request,
      bindings: { ...request.bindings, qualificationPython: '/bin/sh' } }),
    /qualificationPython.*manifest runtime Python/i);

    await assert.rejects(attestLibraryQualificationPrelaunch({ ...request,
      intent: { ...intent, licences: {} } }), /exact QuaLib 2026 new\/59099 claim/i);
    await assert.rejects(attestLibraryQualificationPrelaunch({ ...request,
      site: { ...qualifiedSite, capacity: { ...qualifiedSite.capacity, parallelJobs: 2 } } }),
    /one-Job Site.*cannot overlap/i);
    const resolvedWrapper = path.join(f.root, 'resolved-edarun');
    await writeFile(resolvedWrapper, wrapperBytes);
    await assert.rejects(attestLibraryQualificationPrelaunch({ ...request,
      channel: { ...channel, realpath: (target) => target === '/usr/local/bin/edarun'
        ? Promise.resolve(resolvedWrapper) : realpath(target) } }), /resolved edarun target.*not an allowed wrapper/i);
    await assert.rejects(attestLibraryQualificationPrelaunch({ ...request, workspace: '/',
      intent: { ...intent, job: { ...intent.job, workspace: '/' } } }), /private workspace.*not authorized/i);

    const originalSource = manifest.sources[0];
    manifest.sources[0] = { ...originalSource, path: '/etc/hosts', sha256: sha(await readFile('/etc/hosts')) };
    await writeFile(f.manifest, JSON.stringify(manifest));
    await assert.rejects(attestLibraryQualificationPrelaunch(request), /vendor-fixture source.*not authorized/i);
    manifest.sources[0] = originalSource;

    await writeFile(f.manifest, JSON.stringify(manifest));
    await assert.rejects(attestLibraryQualificationPrelaunch({ ...request,
      intent: { ...intent, job: { ...intent.job, session: 'hima-library-replay' } } }),
    /different Host attestation/i);

    const secondIntent = { ...intent, attempt: 2,
      job: { ...intent.job, session: 'hima-library-e1-attempt2' } };
    await assert.doesNotReject(attestLibraryQualificationPrelaunch({ ...request, intent: secondIntent }));
    assert.deepEqual(JSON.parse(await readFile(path.join(f.workspace, 'hima-library-host-attestation.json'), 'utf8')).launch,
      { runId: intent.runId, nodeId: 'qualify-api', attempt: 2, jobSession: 'hima-library-e1-attempt2' });
    await mkdir(path.join(f.workspace, 'flow/qualification'));
    await assert.rejects(attestLibraryQualificationPrelaunch({ ...request,
      intent: { ...secondIntent, attempt: 3, job: { ...secondIntent.job, session: 'hima-library-e1-attempt3' } } }),
    /retained output.*safe in-place retry is unavailable/i);

    manifest.permit.sha256 = '0'.repeat(64);
    await writeFile(f.manifest, JSON.stringify(manifest));
    await assert.rejects(attestLibraryQualificationPrelaunch(request), /loaded Site Permit identity/i);
  } finally { await f.dispose(); }
});

test('real Host vetoes a Site-bound Python that differs from the manifest before recording a Job', async () => {
  const h = await createHimaHome();
  const f = await fixture(h.workspace);
  let runId: string | undefined;
  try {
    await installPack(h, 'library-intelligence');
    const installedSite = await writeLocalSite(h, {
      bindings: { qualificationManifest: f.manifest, qualificationPython: f.sources[0]!, analysisManifest: f.analysisManifest, workspaceRoot: h.workspace },
      allowedReadRoots: [h.workspace, f.root, path.dirname(await realpath(f.python)), path.join(h.home, 'hima/sites'), '/usr/local/bin'], allowedWriteRoots: [h.workspace],
      allowedWrappers: ['/usr/local/bin/edarun', '/usr/bin/python3'],
      licences: { 'QuaLib-2026-new-59099': 1 },
    });
    const manifest = JSON.parse(await readFile(f.manifest, 'utf8'));
    const loadedPermit = await readFile(installedSite.permitPath);
    manifest.permit = { path: installedSite.permitPath, sha256: sha(loadedPermit) };
    await writeFile(f.manifest, JSON.stringify(manifest));
    const host = await bootInProcess(h);
    try {
      const owner = await createRootAgent(host.ctx, h.workspace);
      const started = await host.ctx.hima.startRun({ pack: 'library-intelligence', site: 'local',
        goal: { qualification_required: 1 }, strategy: { qualificationRevision: 0 }, ownerSessionId: String(owner.id) });
      assert.equal(started.kind, 'ran', JSON.stringify(started));
      if (started.kind !== 'ran') return;
      runId = started.run.id;
      assert.equal(started.run.currentNode, 'qualify-api');
      assert.equal(sha(await readFile(path.join(started.workspace, 'flow/tools/libapi_worker.py'))), sha(await readFile(worker)),
        'actual Campaign preparation stages the exact Pack worker named by the tool argv');
      assert.equal(sha(await readFile(path.join(started.workspace, 'flow/tools/library-stages.py'))), sha(await readFile(stageWorker)),
        'actual Campaign preparation stages the exact E2-E4 producer bytes named by every post-E1 tool argv');
      const begin = await host.ctx.hima.executionAction({ runId, actor: String(owner.id), expectedEpoch: 1,
        expectedRevision: 0, requestId: 'attest-begin', action: 'begin', nodeId: 'qualify-api' });
      const executionId = begin.receipt?.executionId;
      assert.ok(executionId);
      const work = await host.ctx.hima.executionAction({ runId, actor: String(owner.id), expectedEpoch: 1,
        expectedRevision: 1, requestId: 'attest-work', action: 'work', executionId });
      assert.match(work.reason ?? '', /qualificationPython.*manifest runtime Python/i);
      assert.equal(host.ctx.hima.ledger.records({ runId, type: 'job' }).length, 0);
      assert.equal(host.ctx.hima.executionContext(runId).executions.find((item) => item.id === executionId)?.phase, 'failed');
    } finally {
      if (runId) await host.ctx.hima.cancelRun(runId);
      await host.dispose();
    }
  } finally { await f.dispose(); await h.dispose(); }
});

test('eligible Pack exposes the attested E1 tool followed by the bounded E2-E4 tools and checkPack refuses a missing wrapper', async () => {
  const f = await fixture();
  try {
    const pack = loadPack(path.join(repoRoot, 'packs'), 'library-intelligence');
    assert.deepEqual(pack.contract.tools.map((tool) => tool.id), [
      'qualify-api', 'index-baseline', 'index-candidate', 'semantic-delta', 'library-insight', 'propose-library-rule',
      'evaluate-library-rule',
    ]);
    assert.equal(pack.graph.entry, 'qualify-api');
    assert.deepEqual(pack.contract.tools[0]!.licences, { 'QuaLib-2026-new-59099': 1 });
    const loaded = loadSite(path.join(f.root, 'sites'), 'local');
    const site = { ...loaded, capacity: { ...loaded.capacity,
      licences: { 'QuaLib-2026-new-59099': 1 } } };
    const fit = checkPack(pack, site);
    assert.equal(fit.fit, true, fit.errors.join('\n'));
    const permitText = (await readFile(f.permit, 'utf8')).replace('  - /usr/local/bin/edarun\n', '');
    await writeFile(f.permit, permitText);
    const refusedLoaded = loadSite(path.join(f.root, 'sites'), 'local');
    const refused = checkPack(pack, { ...refusedLoaded, capacity: { ...refusedLoaded.capacity,
      licences: { 'QuaLib-2026-new-59099': 1 } } });
    assert.equal(refused.fit, false);
    assert.match(refused.errors.join('\n'), /tool.*\/usr\/local\/bin\/edarun.*not an allowed wrapper/);
  } finally { await f.dispose(); }
});

test('one-Job Site cap excludes Hima-managed Library and XTop jobs in both launch orders', async () => {
  for (const [firstName, firstLicences, secondName, secondLicences] of [
    ['Library', { 'QuaLib-2026-new-59099': 1 }, 'XTop', { XTop: 1 }],
    ['XTop', { XTop: 1 }, 'Library', { 'QuaLib-2026-new-59099': 1 }],
  ] as const) {
    const h = await createHimaHome();
    const siteFiles = await writeLocalSite(h, { parallelJobs: 1,
      licences: { 'QuaLib-2026-new-59099': 1, XTop: 1 } });
    const script = path.join(h.workspace, 'hold-site-slot.sh');
    await writeFile(script, 'sleep 5\n');
    const host = await bootInProcess(h);
    try {
      const deps = { ledger: host.ctx.hima.ledger, sitesDir: siteFiles.sitesDir };
      const first = await launchJob(deps, { site: 'local', workspace: h.workspace,
        argv: ['sh', script], name: firstName, licences: firstLicences });
      assert.equal(first.kind, 'launched');
      const second = await claimSlotAndLaunch(deps, { site: loadSite(siteFiles.sitesDir, 'local'),
        run: first.run, workspace: h.workspace, node: { id: secondName, kind: 'act' }, attempt: 1,
        argv: ['sh', script], licences: secondLicences, waitedMs: 0, nonblocking: true });
      assert.equal(second.kind, 'at-cap', `${firstName} must exclude a later ${secondName} Hima Job`);
      assert.equal(host.ctx.hima.ledger.records({ runId: first.run.id, type: 'job' })
        .filter((record) => record.type === 'job' && record.event === 'launched').length, 1);
    } finally {
      for (const record of host.ctx.hima.ledger.runs().flatMap((run) =>
        host.ctx.hima.ledger.records({ runId: run.id, type: 'job' }))) {
        if (record.type === 'job' && record.event === 'launched') {
          spawnSync('tmux', ['kill-session', '-t', `=${record.job.session}`]);
        }
      }
      await host.dispose(); await h.dispose();
    }
  }
});

test('Host-attested isolated synthetic API probes yield three native passes and one eligible E1 indicator', async () => {
  const f = await fixture();
  try {
    const original = await Promise.all(f.sources.map((source) => readFile(source)));
    const run = f.run();
    assert.equal(run.status, 0, run.stderr);
    const receipt = await f.receipt();
    assert.equal(receipt.nativeStatus, 'passed');
    assert.equal(receipt.status, 'passed');
    assert.equal(receipt.reason, null);
    assert.equal(receipt.permitAttestation, 'host-prelaunch');
    assert.equal(receipt.facts, null);
    assert.deepEqual(receipt.results.map((item: any) => item.status), ['passed', 'passed', 'passed']);
    for (const [index, item] of receipt.results.entries()) {
      assert.equal(item.sourceSha256, sha(original[index]!));
      assert.equal(item.sourceAfterSha256, sha(original[index]!));
      assert.equal(item.exitCode, 0);
      assert.equal(item.queryEvidence.library, 'synthetic');
      assert.equal(item.queryEvidence.sample.tableSize, 49);
      assert.ok(Object.values(item.steps).every((status) => status === 'passed'));
      assert.deepEqual(await readFile(f.sources[index]!), original[index]);
    }
    const reading = f.read();
    assert.equal(reading.status, 0, reading.stderr);
    assert.deepEqual(JSON.parse(await readFile(reading.output, 'utf8')),
      { values: [{ type: 'library_qualification_ok', unit: 'count', value: 1 }] });
  } finally { await f.dispose(); }
});

test('SIGSEGV in one synthetic child blocks later input with signal and log hash, no partial facts', async () => {
  const f = await fixture();
  try {
    await writeFile(f.sources[1]!, 'CRASH\n');
    const value = JSON.parse(await readFile(f.manifest, 'utf8'));
    value.sources[1].sha256 = sha('CRASH\n');
    await writeFile(f.manifest, JSON.stringify(value));
    const run = f.run();
    assert.equal(run.status, 0, run.stderr);
    const receipt = await f.receipt();
    assert.equal(receipt.nativeStatus, 'blocked');
    assert.equal(receipt.status, 'blocked');
    assert.equal(receipt.facts, null);
    assert.deepEqual(receipt.results.map((item: any) => item.status), ['passed', 'blocked', 'blocked']);
    assert.equal(receipt.results[1].reason, 'hima/library-worker-crashed');
    assert.ok(receipt.results[1].signal === 11);
    assert.match(receipt.results[1].logSha256, /^[0-9a-f]{64}$/);
    assert.equal(receipt.results[2].reason, 'hima/library-not-run');
    assert.equal(receipt.results[2].logSha256, null);
    assert.equal(f.read().status, 0);
  } finally { await f.dispose(); }
});

test('source hash mismatch and Site-root refusal stop before any native child starts', async () => {
  const f = await fixture();
  try {
    await writeFile(f.sources[0]!, 'CHANGED\n');
    const run = f.run();
    assert.equal(run.status, 0, run.stderr);
    const receipt = await f.receipt();
    assert.equal(receipt.reason, 'hima/library-source-identity');
    assert.ok(receipt.results.every((item: any) => item.logSha256 === null));
    assert.equal(f.read().status, 0);
  } finally { await f.dispose(); }

  const g = await fixture();
  try {
    const permitText = (await readFile(g.permit, 'utf8')).replace(`  - ${g.root}\n`, '');
    await writeFile(g.permit, permitText);
    const value = JSON.parse(await readFile(g.manifest, 'utf8'));
    value.permit.sha256 = sha(permitText);
    await writeFile(g.manifest, JSON.stringify(value));
    const run = g.run();
    assert.equal(run.status, 0, run.stderr);
    const receipt = await g.receipt();
    assert.equal(receipt.reason, 'hima/library-preflight-refused');
    assert.ok(receipt.results.every((item: any) => item.logSha256 === null));
    assert.equal(g.read().status, 0, 'a preflight refusal remains a readable blocked receipt');
  } finally { await g.dispose(); }
});

test('changed native binary blocks at runtime identity before any parser child', async () => {
  const f = await fixture();
  try {
    await writeFile(path.join(f.root, 'api/_tmlib.so'), 'changed native marker\n');
    const run = f.run();
    assert.equal(run.status, 0, run.stderr);
    const receipt = await f.receipt();
    assert.equal(receipt.reason, 'hima/library-runtime-identity');
    assert.equal(receipt.results[0].steps.permit, 'passed');
    assert.equal(receipt.results[0].steps.runtime, 'blocked');
    assert.ok(receipt.results.every((item: any) => item.logSha256 === null));
    assert.equal(f.read().status, 0);
  } finally { await f.dispose(); }
});

test('source mutation during a synthetic native call blocks the receipt and keeps the changed hash', async () => {
  const f = await fixture();
  try {
    await writeFile(f.sources[2]!, 'MUTATE\n');
    const value = JSON.parse(await readFile(f.manifest, 'utf8'));
    value.sources[2].sha256 = sha('MUTATE\n');
    await writeFile(f.manifest, JSON.stringify(value));
    const run = f.run();
    assert.equal(run.status, 0, run.stderr);
    const receipt = await f.receipt();
    assert.equal(receipt.reason, 'hima/library-source-mutated');
    assert.equal(receipt.nativeStatus, 'blocked');
    assert.deepEqual(receipt.results.map((item: any) => item.status), ['passed', 'passed', 'blocked']);
    assert.notEqual(receipt.results[2].sourceAfterSha256, receipt.results[2].expectedSha256);
    assert.equal(receipt.results[2].steps['source-after-hash'], 'blocked');
    assert.equal(receipt.results[2].queryEvidence, null);
    assert.equal(f.read().status, 0);
  } finally { await f.dispose(); }
});

test('Reader refuses a changed worker log even when the receipt says native probes passed', async () => {
  const f = await fixture();
  try {
    assert.equal(f.run().status, 0);
    await writeFile(path.join(f.workspace, 'flow/qualification/vendor-fixture/worker.log'), 'tampered\n');
    const reading = f.read();
    assert.notEqual(reading.status, 0);
    assert.match(reading.stderr, /worker log bytes differ/);
  } finally { await f.dispose(); }
});

test('Reader refuses queryEvidence edited without changing the hashed child result', async () => {
  const f = await fixture();
  try {
    assert.equal(f.run().status, 0);
    const receiptPath = path.join(f.workspace, 'flow/qualification/receipt.json');
    const receipt = await f.receipt();
    receipt.results[0].queryEvidence.sample.firstValue = 0.875;
    await writeFile(receiptPath, JSON.stringify(receipt));
    const reading = f.read();
    assert.notEqual(reading.status, 0);
    assert.match(reading.stderr, /query evidence differs from hashed child result/);
  } finally { await f.dispose(); }
});

test('Reader refuses a Host attestation path outside the exact Campaign workspace location', async () => {
  const f = await fixture();
  try {
    assert.equal(f.run().status, 0);
    const receiptPath = path.join(f.workspace, 'flow/qualification/receipt.json');
    const receipt = await f.receipt();
    const replay = path.join(f.root, 'replayed-host-attestation.json');
    await cp(path.join(f.workspace, 'hima-library-host-attestation.json'), replay);
    receipt.hostAttestationPath = replay;
    receipt.hostAttestationSha256 = sha(await readFile(replay));
    await writeFile(receiptPath, JSON.stringify(receipt));
    const reading = f.read();
    assert.notEqual(reading.status, 0);
    assert.match(reading.stderr, /exact Campaign workspace location/i);
  } finally { await f.dispose(); }
});

test('Reader refuses launch identity tampered independently of the Host attestation', async () => {
  const f = await fixture();
  try {
    assert.equal(f.run().status, 0);
    const receiptPath = path.join(f.workspace, 'flow/qualification/receipt.json');
    const receipt = await f.receipt();
    receipt.launch.jobSession = 'hima-library-tampered';
    await writeFile(receiptPath, JSON.stringify(receipt));
    const reading = f.read();
    assert.notEqual(reading.status, 0);
    assert.match(reading.stderr, /launch identity differs/i);
  } finally { await f.dispose(); }
});

test('real local Host refuses a self-consistent positive receipt with no matching qualification Job', async () => {
  const h = await createHimaHome();
  const f = await fixture(h.workspace);
  let runId: string | undefined;
  try {
    const installed = await installPack(h, 'library-intelligence');
    const graphPath = path.join(installed.dir, 'graph.yml');
    const graph = await readFile(graphPath, 'utf8');
    await writeFile(graphPath, graph.replace('entry: qualify-api', 'entry: read-qualification'));
    await writeLocalSite(h, {
      bindings: { qualificationManifest: f.manifest, qualificationPython: f.python, analysisManifest: f.analysisManifest, workspaceRoot: h.workspace },
      allowedReadRoots: [h.workspace, f.root],
      allowedWriteRoots: [h.workspace],
      allowedWrappers: ['/usr/local/bin/edarun', '/usr/bin/python3'],
      licences: { 'QuaLib-2026-new-59099': 1 },
    });
    const run = f.run();
    assert.equal(run.status, 0, run.stderr);
    const host = await bootInProcess(h);
    try {
      const owner = await createRootAgent(host.ctx, h.workspace);
      const started = await host.ctx.hima.startRun({
        pack: 'library-intelligence', site: 'local', goal: { qualification_required: 1 },
        strategy: { qualificationRevision: 0 }, ownerSessionId: String(owner.id),
      });
      assert.equal(started.kind, 'ran', JSON.stringify(started));
      if (started.kind !== 'ran') return;
      runId = started.run.id;
      assert.equal(started.run.currentNode, 'read-qualification');
      await mkdir(path.join(started.workspace, 'flow/tools'), { recursive: true });
      await cp(worker, path.join(started.workspace, 'flow/tools/libapi_worker.py'));
      await cp(path.join(f.workspace, 'flow/qualification'),
        path.join(started.workspace, 'flow/qualification'), { recursive: true });
      const launch = { runId, nodeId: 'qualify-api', attempt: 1, jobSession: 'forged-no-job' };
      const attestation = JSON.parse(await readFile(path.join(f.workspace, 'hima-library-host-attestation.json'), 'utf8'));
      attestation.workspace = started.workspace;
      attestation.launch = launch;
      const attestationPath = path.join(started.workspace, 'hima-library-host-attestation.json');
      await writeFile(attestationPath, JSON.stringify(attestation) + '\n');
      const receiptPath = path.join(started.workspace, 'flow/qualification/receipt.json');
      const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
      receipt.hostAttestationPath = attestationPath;
      receipt.hostAttestationSha256 = sha(await readFile(attestationPath));
      receipt.launch = launch;
      await writeFile(receiptPath, JSON.stringify(receipt));
      const act = (action: 'begin' | 'work' | 'complete', executionId?: string, nodeId?: string) => {
        const control = host.ctx.hima.ledger.run(runId!)!.control!;
        return host.ctx.hima.executionAction({ runId: runId!, actor: String(owner.id),
          expectedEpoch: control.epoch, expectedRevision: control.revision,
          requestId: `e1-${action}-${control.revision}`, action, executionId, nodeId });
      };
      const begin = await act('begin', undefined, 'read-qualification');
      const id = begin.receipt?.executionId;
      assert.ok(id);
      assert.equal((await act('work', id)).kind, 'accepted');
      await waitUntil('Library Host refuses positive evidence without its qualification Job', () =>
        host.ctx.hima.executionContext(runId!).executions.some((item) => item.id === id && item.phase !== 'working'));
      assert.equal(host.ctx.hima.executionContext(runId).executions.find((item) => item.id === id)?.phase, 'failed');
      const observations = host.ctx.hima.ledger.records({ runId, type: 'observation' });
      assert.equal(observations.length, 0);
      const refusal = host.ctx.hima.ledger.records({ runId, type: 'refusal' }).at(-1);
      assert.equal(refusal?.type, 'refusal');
      if (refusal?.type === 'refusal') assert.match(refusal.reason,
        /no matching launched and successfully finished Host Job record/i);
    } finally {
      if (runId) await host.ctx.hima.cancelRun(runId);
      await host.dispose();
    }
  } finally { await f.dispose(); await h.dispose(); }
});
