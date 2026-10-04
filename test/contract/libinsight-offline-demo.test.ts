import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { mkdtemp, mkdir, readFile, rm, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkPack, loadPack, loadSite, libraryInsightDocument } from '@hima/harness';
import { repoRoot } from './support/dsh-home.ts';

const packId = 'libinsight-offline-demo';
const packsDir = path.join(repoRoot, 'packs');
const packDir = path.join(packsDir, packId);
const reportTool = path.join(packDir, 'flow/tools/report.py');
const readerTool = path.join(packDir, 'tools/read-insight.py');

// The names the harness binds itself into any tool's argv; a tool may declare them without a node
// binding one. Everything else a tool declares must be bound by the node that runs it.
const HARNESS_ARGV = new Set(['WORKSPACE', 'FLOW_ROOT', 'DESIGN', 'CAMPAIGN']);
// Vendor-runtime surfaces a demo-only offline Pack must never reference in anything it executes.
const FORBIDDEN = [/extract\//, /tmlib/, /edarun/, /EMPYREAN/, /calibrate/, /batch\s+convert/, /licence/i, /license/i, /['"]convert['"]/];

test('the demo Pack loads, validates, and declares the offline analysis-to-report method', () => {
  const pack = loadPack(packsDir, packId);
  assert.equal(pack.contract.id, packId);
  assert.equal(pack.contract.version, '0.1.1');
  // A source: pack workspace copies each entry from the Pack's own flow/ directory.
  for (const entry of pack.contract.workspace.copy ?? []) assert.ok(existsSync(path.join(packDir, 'flow', entry)), `flow/${entry} must exist in the Pack`);
  assert.equal(pack.graph.version, pack.contract.version, 'graph and contract versions must match');
  assert.equal(pack.graph.entry, 'analyse');
  assert.deepEqual(pack.contract.tools.map((t) => t.id), ['analyse', 'report']);
  assert.deepEqual(pack.contract.environment.wrappers, ['/usr/bin/python3']);
  assert.equal(pack.contract.workspace.source, 'pack');
  assert.deepEqual(pack.contract.workspace.copy, ['tools']);
  // No licence seat is declared by any tool.
  for (const tool of pack.contract.tools) assert.deepEqual(tool.licences, {});
  // The kit Strategy knob offers exactly the two prepared kits.
  const kit = pack.contract.strategy.kit;
  assert.equal(kit?.type, 'choice');
  if (kit?.type === 'choice') {
    assert.deepEqual(kit.options, ['tsmc28-180a', 'n12-100']);
    assert.equal(kit.default, 'tsmc28-180a');
  }
  assert.ok(pack.contract.goal && 'min_findings' in pack.contract.goal, 'declares the min_findings goal');
});

test('every ${NAME} in a tool argv is bound by the contract or the harness', () => {
  const pack = loadPack(packsDir, packId);
  const nodesByTool = new Map<string, Record<string, unknown>>();
  for (const node of pack.graph.nodes) {
    if (node.kind === 'act' && node.parameters.tool) nodesByTool.set(node.parameters.tool, node.parameters.arguments);
  }
  for (const tool of pack.contract.tools) {
    const declared = new Set(tool.inputs);
    const placeholders = new Set<string>();
    for (const word of tool.argv) for (const m of word.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g)) placeholders.add(m[1]!);
    for (const name of placeholders) {
      assert.ok(declared.has(name), `tool ${tool.id} argv uses \${${name}} but does not declare it as an input`);
    }
    const bound = nodesByTool.get(tool.id) ?? {};
    for (const name of tool.inputs) {
      if (HARNESS_ARGV.has(name)) continue;
      assert.ok(Object.prototype.hasOwnProperty.call(bound, name),
        `tool ${tool.id} input ${name} is bound by no graph node argument`);
    }
  }
});

test('nothing the Pack executes references the vendor Liberty runtime, seat, or write steps', async () => {
  // Scan only executable/declared surfaces, not the .md documentation (which explains the boundary).
  const surfaces = ['contract.yml', 'graph.yml', 'semantics.yml',
    'flow/tools/analyse.py', 'flow/tools/report.py', 'tools/read-insight.py',
    'readers/libinsight-insight.yml', 'choosers/libinsight-complete.yml',
    'rules/libinsight-report-valid.yml', 'rules/libinsight-findings-reported.yml', 'rules/libinsight-files-analysed.yml'];
  for (const relative of surfaces) {
    const text = await readFile(path.join(packDir, relative), 'utf8');
    for (const pattern of FORBIDDEN) {
      assert.ok(!pattern.test(text), `${relative} references ${pattern} in an executable surface`);
    }
  }
  // The analyse tool only ever drives the offline analyse subcommand.
  const analyse = await readFile(path.join(packDir, 'flow/tools/analyse.py'), 'utf8');
  assert.ok(analyse.includes('"analyse"'), 'analyse tool invokes the analyse subcommand');
  assert.ok(analyse.includes('PYTHONDONTWRITEBYTECODE'), 'analyse tool keeps bytecode out of the read-only root');
});

test('checkPack fits a local Site that permits /usr/bin/python3 and reads the LibInsight root', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'libinsight-demo-site-'));
  try {
    const sitesDir = path.join(root, 'sites');
    const workspace = path.join(root, 'workspace');
    const libRoot = path.join(root, 'lib_insight');
    await Promise.all([mkdir(sitesDir, { recursive: true }), mkdir(workspace, { recursive: true }), mkdir(libRoot, { recursive: true })]);
    const permit = [
      'allowedReadRoots:', `  - ${workspace}`, `  - ${libRoot}`,
      'allowedWriteRoots:', `  - ${workspace}`,
      'allowedWrappers:', '  - /usr/bin/python3',
      'forbidden:', '  - deletions', '',
    ].join('\n');
    await writeFile(path.join(sitesDir, 'local.permit.yml'), permit);
    await writeFile(path.join(sitesDir, 'local.yml'), [
      'name: local', 'kind: local', `workspaceRoot: ${workspace}`,
      'permit: ./local.permit.yml', 'bindings:',
      `  libInsightRoot: ${libRoot}`, `  workspaceRoot: ${workspace}`,
      'capacity: { cores: 4, memoryGiB: 8, parallelJobs: 1, licences: {} }', '',
    ].join('\n'));
    const pack = loadPack(packsDir, packId);
    const site = loadSite(sitesDir, 'local');
    const fit = checkPack(pack, site);
    assert.equal(fit.fit, true, fit.errors.join('\n'));

    // A Site whose permit does not allow /usr/bin/python3 must be refused, naming the wrapper.
    await writeFile(path.join(sitesDir, 'local.permit.yml'), permit.replace('  - /usr/bin/python3', '  - /bin/false'));
    const refused = checkPack(pack, loadSite(sitesDir, 'local'));
    assert.equal(refused.fit, false);
    assert.match(refused.errors.join('\n'), /\/usr\/bin\/python3.*not an allowed wrapper/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('the committed local Site template loads once its workspace placeholder is filled', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'libinsight-demo-template-'));
  try {
    const sitesDir = path.join(root, 'sites');
    const home = path.join(root, 'home');
    await mkdir(sitesDir, { recursive: true });
    const siteText = (await readFile(path.join(repoRoot, 'sites/libinsight-local/site.yml'), 'utf8')).replaceAll('__DSH_HOME__', home);
    const permitText = (await readFile(path.join(repoRoot, 'sites/libinsight-local/permit.yml'), 'utf8')).replaceAll('__DSH_HOME__', home);
    await writeFile(path.join(sitesDir, 'libinsight-local.yml'), siteText);
    // The committed site.yml points at `./permit.yml`, so the permit keeps that name beside it.
    await writeFile(path.join(sitesDir, 'permit.yml'), permitText);
    const site = loadSite(sitesDir, 'libinsight-local');
    assert.equal(site.kind, 'local');
    assert.deepEqual(site.permitRules.allowedWrappers, ['/usr/bin/python3']);
    assert.ok(site.permitRules.allowedWriteRoots.every((r) => !r.includes('lib_insight')),
      'the read-only LibInsight checkout is never a write root');
    assert.equal(site.bindings.libInsightRoot, '/Users/lluzi/code/lib_insight');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('the report writer produces a v1 schema-valid report, most severe first, under the cap', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'libinsight-demo-report-'));
  try {
    const kit = 'demo-kit';
    const derived = path.join(workspace, 'derived');
    const out = path.join(derived, kit);
    await mkdir(path.join(out, 'findings'), { recursive: true });

    const kitInfo = {
      schema: 'lib-insight-derived/1',
      kit: { id: kit, kit: 'demo-hpcplus', release: '1', primary_view: 'NLDM',
        variants: [{ id: '7T-SVT', track: '7T', vt: 'SVT', corners: ['tt'] }] },
      run: { version: '0.1.0', python: '3.9.6', numpy: '2.0.2', findings: 3, causes: 1, signatures: 1, seconds: 1.0 },
      files: [{ status: 'ok', ref: { variant: '7T-SVT', corner: 'tt', view: 'NLDM' } }],
      counts: { '7T-SVT': { tt: { E14: { n: 2, ratio_max: 3.2 }, E20: { n: 1, ratio_max: 1.1 } } } },
    };
    await writeFile(path.join(out, 'kit.json'), JSON.stringify(kitInfo));

    const rows = [
      { expectation: 'E14', group: 'Precision', subject: 'AN2/Z table spike', variant: '7T-SVT', corner: 'tt', view: 'NLDM', cell: 'AN2', detail: 'kink at 0.16ns', magnitude: 42.0, unit: '% worst-case', ratio: 3.2, severity: 'Error', id: 'F-E14-aaa' },
      { expectation: 'E14', group: 'Precision', subject: 'OR2/Z monotonicity', variant: '7T-SVT', corner: 'tt', view: 'NLDM', cell: 'OR2', detail: 'non-monotone load row', magnitude: 10.0, unit: '% worst-case', ratio: 1.8, severity: 'Warning', id: 'F-E14-bbb' },
      { expectation: 'E20', group: 'Optimization', subject: 'AO21 drive ladder gap', variant: '7T-SVT', corner: 'tt', view: 'NLDM', cell: '', detail: 'drive step 2.6 vs median 1.6', magnitude: 161.0, unit: '% oversize', ratio: 1.1, severity: 'Opportunity', id: 'F-E20-ccc' },
    ];
    const shard = rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
    await writeFile(path.join(out, 'findings', 'shard.jsonl.gz'), gzipSync(Buffer.from(shard)));
    await writeFile(path.join(derived, 'run-manifest.json'), JSON.stringify({
      schema: 'hima-libinsight-offline-run/1', kit, libInsightRoot: path.join(workspace, 'lib_insight'),
      libInsightCommit: 'deadbeef', files_analysed: 1, findingsTotal: 3,
    }));

    const run = spawnSync('python3', [reportTool, workspace, kit], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);

    const reportPath = path.join(derived, 'insight-report.json');
    const report = JSON.parse(await readFile(reportPath, 'utf8'));
    // The report validates against the exported v1 schema.
    const parsed = libraryInsightDocument.safeParse(report);
    assert.ok(parsed.success, JSON.stringify(parsed.error?.issues));
    assert.equal(report.evidenceClass, 'native-qualified');
    assert.equal(report.analysis, 'library-health');
    assert.ok(report.findings.length <= 5000 && report.findings.length === 3);
    // Most severe first: the critical Error ranks ahead of the Opportunity.
    assert.equal(report.findings[0].librarySeverity, 'critical');
    assert.equal(report.findings.at(-1).librarySeverity, 'info');
    // Each finding stays within the loaded conditions.
    for (const f of report.findings) {
      assert.ok(report.conditions.corners.includes(f.corner));
      assert.ok(report.conditions.views.includes(f.view));
    }
    // An honest note of the total finding count and the cap is recorded.
    assert.ok(report.conditions.unknowns.some((u: string) => /\b3\b/.test(u) && /cap/i.test(u)),
      'conditions.unknowns states the total count and the cap');
    // Under the 2 MiB retained-report ceiling.
    const bytes = Buffer.byteLength(JSON.stringify(report));
    assert.ok(bytes < 2 * 1024 * 1024, `report is ${bytes} bytes`);

    // The companion artifacts are written.
    const files = await readdir(derived);
    for (const name of ['insight-report.json', 'summary.md', 'prototype-app.json']) assert.ok(files.includes(name), `missing ${name}`);

    // The reader validates the report and emits exactly the three readings.
    const outPath = path.join(workspace, 'reading.json');
    const reader = spawnSync('python3', [readerTool, reportPath, outPath], { encoding: 'utf8' });
    assert.equal(reader.status, 0, reader.stderr);
    const reading = JSON.parse(await readFile(outPath, 'utf8'));
    const byType = Object.fromEntries(reading.values.map((v: { type: string; value: number }) => [v.type, v.value]));
    assert.deepEqual(Object.keys(byType).sort(), ['files_analysed', 'findings_reported', 'report_valid']);
    assert.equal(byType.report_valid, 1);
    assert.equal(byType.findings_reported, 3);
    assert.equal(byType.files_analysed, 1);
  } finally { await rm(workspace, { recursive: true, force: true }); }
});

test('the reader refuses a report that does not match the v1 schema', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'libinsight-demo-bad-'));
  try {
    const reportPath = path.join(workspace, 'insight-report.json');
    await writeFile(reportPath, JSON.stringify({ schema: 'hima-library-insight-report/1', evidenceClass: 'native-qualified',
      analysis: 'library-health', conditions: { family: 'x', corners: ['tt'], views: ['v'], unknowns: [] },
      findings: [{ id: 'f1', title: 't', librarySeverity: 'critical', designRelevance: 'unknown', corner: 'OUTSIDE',
        view: 'v', values: [], provenance: [{ status: 'available', recordId: 'r' }], unknowns: [], rankingReason: 'r' }],
      summary: { best: [], unresolved: [], nextActions: [] } }));
    const reader = spawnSync('python3', [readerTool, reportPath, path.join(workspace, 'out.json')], { encoding: 'utf8' });
    assert.notEqual(reader.status, 0);
    assert.match(reader.stderr, /outside loaded conditions/);
  } finally { await rm(workspace, { recursive: true, force: true }); }
});
